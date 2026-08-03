import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, PLANS, PlanId } from './config.js';
import { db, UserRow, SqliteSessionStore } from './db.js';
import { canSwitchToPlan, getPlanInfo, hasFullAccess, activatePlan, claimDailyCredit } from './plans.js';
import { evaluate } from './calculator.js';
import { solveWordProblem } from './ai-client.js';
import { sendMail, welcomeEmail } from './mailer.js';
import {
  createPixPayment,
  getPayment,
  handlePaymentNotification,
  paymentConfig,
  verifyPaymentForUser,
  verifyWebhookSignature,
} from './mercadopago.js';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    csrfToken?: string;
  }
}

const app = express();

app.set('view engine', 'ejs');
app.set('views', import.meta.dirname + '/../views');
app.set('trust proxy', config.env === 'production' ? 1 : false);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(import.meta.dirname + '/../public'));
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});
app.use(
  session({
    store: new SqliteSessionStore(),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
    },
  }),
);

if (config.env !== 'test') {
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Muitas tentativas de login. Descansa um pouco e volta (a calculadora calcula que você precisa).',
  });
  const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Muitos registros. Ou você é um bot, ou está desesperado por créditos.',
  });
  app.use('/entrar', loginLimiter);
  app.use('/registrar', registerLimiter);
  const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 6,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Muitas resoluções por minuto. A IA também precisa respirar (6 a cada 15 minutos).',
  });
  app.use('/api/resolver', aiLimiter);
}

function csrfTokenFor(req: express.Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  return req.session.csrfToken;
}

function getLoggedUser(req: express.Request): UserRow | null {
  if (!req.session.userId) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) as UserRow | undefined ?? null;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.session.userId) {
    const wantsJson =
      (req.headers['content-type'] || '').includes('application/json') ||
      (req.headers['accept'] || '').includes('application/json');
    if (wantsJson) {
      return res.status(401).json({ error: 'Você não está logado. Entre para ver a resposta (e para não pagar a conta do café dos outros).' });
    }
    return res.redirect('/');
  }
  next();
}

app.use((req, res, next) => {
  res.locals.csrfToken = csrfTokenFor(req);
  res.locals.error = null;
  const user = getLoggedUser(req);
  res.locals.user = user;
  res.locals.planStatus = user ? getPlanInfo(user) : null;
  res.locals.fullAccess = user ? hasFullAccess(user) : false;
  res.locals.planGates = user
    ? Object.fromEntries(
        (Object.keys(PLANS) as PlanId[]).map((id) => [id, canSwitchToPlan(user, id)]),
      )
    : null;
  res.locals.aiModel = config.openRouterModel;
  res.locals.aiCost = config.aiSolveCredits;
  res.locals.aiDailyLimit = config.aiDailyLimit;
  res.locals.plans = PLANS;
  res.locals.payment = paymentConfig();
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.appUrl = config.appUrl;
  res.locals.seo = { canonical: config.appUrl + req.path };
  next();
});

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.path === '/webhooks/mercadopago') return next();

  const sent = req.headers['x-csrf-token'] || req.body?._csrf;
  if (!sent || sent !== req.session.csrfToken) {
    const wantsJson = (req.headers['content-type'] || '').includes('application/json');
    const message =
      'Sessão expirada ou token CSRF inválido. Recarrega a página e tenta de novo (e não, o problema não é você... é a sessão).';
    if (wantsJson) return res.status(403).json({ error: message });
    return res.status(403).render('erro', { message });
  }
  next();
});

app.get('/entrar', (_req, res) => res.redirect('/#acesso'));
app.get('/registrar', (_req, res) => res.redirect('/#acesso'));

app.post('/registrar', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const invalid = (error: string) => res.status(400).render('home', { error });

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return invalid('E-mail inválido. A calculadora não aceita e-mail fake (ou aceita, mas a gente fica triste).');
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return invalid('Nome de usuário deve ter 3-20 caracteres (letras, números, _).');
  }
  if (password.length < 6) {
    return invalid('Senha precisa ter pelo menos 6 caracteres.');
  }
  if (db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username)) {
    return invalid('E-mail ou usuário já cadastrado. Tenta ser original.');
  }

  const hash = bcrypt.hashSync(password, 10);
  let userId: number;
  try {
    const result = db
      .prepare('INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(email, username, hash, Date.now());
    userId = Number(result.lastInsertRowid);
  } catch {
    return invalid('E-mail ou usuário já cadastrado. Tenta ser original.');
  }

  req.session.userId = userId;
  const mail = welcomeEmail({ id: userId, email, username, password_hash: hash, plan: 'free', plan_expires_at: null, credits: 0, last_credit_claim: null, created_at: Date.now(), last_reminder_at: null });
  sendMail(email, mail.subject, mail.html);
  res.redirect('/');
});

app.post('/entrar', (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  const password = String(req.body.password || '');

  const user = db
    .prepare('SELECT * FROM users WHERE email = ? OR username = ?')
    .get(identifier.toLowerCase(), identifier) as UserRow | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('home', {
      error: 'Credenciais inválidas. Nem a calculadora consegue calcular o que você digitou.',
    });
  }

  req.session.userId = user.id;
  res.redirect('/');
});

app.post('/sair', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/conta/deletar', requireAuth, (_req, res) => {
  res.render('deletar');
});

app.post('/conta/deletar', requireAuth, (req, res) => {
  const user = getLoggedUser(req)!;
  db.prepare('DELETE FROM calc_usage WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM payments WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  req.session.destroy(() => {
    res.redirect('/?msg=' + encodeURIComponent('Conta deletada. A calculadora respeita sua decisão (e calcula que você voltará).'));
  });
});

app.get('/', (_req, res) => {
  res.locals.seo = {
    title: 'Início',
    description:
      'A calculadora mais completa do mundo. Cálculo científico, resolvedor de contas de prova com IA e edições a partir de R$ 1 por semana, pagas via Pix.',
    canonical: config.appUrl + '/',
  };
  res.render('home');
});

app.get('/planos', (_req, res) => {
  res.locals.seo = {
    title: 'Edições',
    description:
      'Escolha sua edição: Gratuita com 1 crédito por dia, Semanal por R$ 1, Mensal por R$ 5 ou Vitalícia por R$ 50. Tudo via Pix, sem burocracia.',
    canonical: config.appUrl + '/planos',
  };
  res.render('planos');
});

app.post('/creditos/resgatar', requireAuth, (req, res) => {
  const user = getLoggedUser(req)!;
  const result = claimDailyCredit(user);
  res.redirect('/?msg=' + encodeURIComponent(result.message));
});

app.post('/api/calcular', requireAuth, (req, res) => {
  const user = getLoggedUser(req)!;
  const expression = String(req.body.expression || '');
  res.json(evaluate(user, expression));
});

app.post('/api/resolver', requireAuth, async (req, res) => {
  const user = getLoggedUser(req)!;
  const question = String(req.body.question || '').trim();

  if (!question) {
    return res.status(400).json({ error: 'Escreve a conta da prova primeiro. A IA não é vidente (ainda).' });
  }
  if (question.length > config.maxQuestionLength) {
    return res.status(400).json({
      error: `Pergunta longa demais (máximo ${config.maxQuestionLength} caracteres). Enxuga o problema.`,
    });
  }

  const full = hasFullAccess(user);
  if (!full && user.credits < config.aiSolveCredits) {
    return res.status(402).json({
      error: `Resolver com IA custa ${config.aiSolveCredits} créditos e você tem ${user.credits}. Resgata o crédito do dia ou assina uma edição paga.`,
    });
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const usedToday = db
    .prepare("SELECT COUNT(*) as c FROM calc_usage WHERE user_id = ? AND source = 'ai' AND created_at >= ?")
    .get(user.id, dayStart.getTime()) as { c: number };
  if (usedToday.c >= config.aiDailyLimit) {
    return res.status(429).json({
      error: `Você já resolveu ${config.aiDailyLimit} contas hoje. Volta amanhã — a IA também precisa de descanso (e você, de créditos).`,
    });
  }

  try {
    const result = await solveWordProblem(question);
    if (!full) {
      db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(config.aiSolveCredits, user.id);
      user.credits -= config.aiSolveCredits;
    }
    db.prepare("INSERT INTO calc_usage (user_id, expression, credits_used, source, created_at) VALUES (?, ?, ?, 'ai', ?)")
      .run(user.id, question.slice(0, 500), full ? 0 : config.aiSolveCredits, Date.now());
    res.json({ ...result, usedCredits: full ? 0 : config.aiSolveCredits, full });
  } catch (err) {
    console.error('[resolver] erro:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro desconhecido ao chamar a IA.',
    });
  }
});

app.get('/api/status', requireAuth, (req, res) => {
  const user = getLoggedUser(req)!;
  const planInfo = getPlanInfo(user);
  const daysLeft =
    planInfo.status === 'active' && user.plan !== 'vitalicio' && planInfo.expiresAt
      ? Math.ceil((planInfo.expiresAt - Date.now()) / 86400000)
      : null;
  res.json({
    id: user.id,
    full: hasFullAccess(user),
    credits: user.credits,
    plan: user.plan,
    plan_expires_at: user.plan_expires_at,
    days_left: daysLeft,
  });
});

app.get('/pagar/:plan', requireAuth, async (req, res) => {
  const planId = req.params.plan as PlanId;
  if (!Object.keys(PLANS).includes(planId)) return res.status(404).send('Plano inexistente. Até nisso você errou a conta.');

  const user = getLoggedUser(req)!;

  const gate = canSwitchToPlan(user, planId);
  if (!gate.allowed) {
    return res.status(403).render('erro', { message: gate.reason || 'Essa troca não é permitida.' });
  }

  if (!paymentConfig().configured) {
    activatePlan(user.id, planId);
    db.prepare(
      'INSERT INTO payments (user_id, plan, amount, status, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(user.id, planId, PLANS[planId].price, 'approved', Date.now());
    return res.redirect(
      '/?msg=' +
        encodeURIComponent(
          `${PLANS[planId].title} ativado em modo simulação (sem MP_ACCESS_TOKEN). A calculadora agora é sua por ${PLANS[planId].tag}.`,
        ),
    );
  }

  try {
    const pix = await createPixPayment(user.id, user.email, user.username, planId);
    return res.render('pagar', {
      paymentId: pix.id,
      qrBase64: pix.qrBase64,
      qrCode: pix.qrCode,
      plan: PLANS[planId],
      planId,
    });
  } catch (err) {
    console.error('Erro ao criar Pix:', err);
    res.status(500).render('erro', {
      message: err instanceof Error ? err.message : 'Erro desconhecido ao falar com o Mercado Pago.',
    });
  }
});

app.get('/api/pagamento/:id/status', requireAuth, async (req, res) => {
  const paymentId = Number(req.params.id);
  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    return res.status(400).json({ error: 'id de pagamento inválido' });
  }
  try {
    const payment = await getPayment(paymentId);
    const mine = payment.external_reference === String(req.session.userId);
    if (payment.status === 'approved' && mine) {
      await handlePaymentNotification(paymentId);
      return res.json({ status: 'approved', approved: true });
    }
    return res.json({ status: payment.status, approved: false });
  } catch (err) {
    console.error('[pagamento status] erro:', err);
    res.status(500).json({ error: 'Falha ao consultar o pagamento no Mercado Pago.' });
  }
});

app.get('/pago/sucesso', requireAuth, async (req, res) => {
  const user = getLoggedUser(req)!;
  const paymentId = Number(req.query.payment_id || req.query.paymentId || 0);
  const planId = req.query.plan as PlanId | undefined;

  if (!paymentId || !planId || !Object.keys(PLANS).includes(planId)) {
    return res.render('erro', { message: 'Pagamento não identificado. Estranho, até o Mercado Pago te abandonou.' });
  }

  try {
    const ok = await verifyPaymentForUser(paymentId, user.id, planId);
    if (ok) {
      return res.redirect(
        '/?msg=' + encodeURIComponent(`Pagamento aprovado! A calculadora agora é sua por ${PLANS[planId].tag}.`),
      );
    }
    const payment = await getPayment(paymentId);
    return res.render('erro', {
      message: `Pagamento ${payment.status === 'approved' ? 'não bate com o plano' : 'ainda não aprovado'} (status: ${payment.status}). Se já pagou, espera 1 minuto e volta.`,
    });
  } catch (err) {
    res.render('erro', {
      message: err instanceof Error ? err.message : 'Erro ao consultar o pagamento.',
    });
  }
});

app.get('/pago/pendente', (_req, res) => {
  res.render('erro', { message: 'Pagamento pendente. O Mercado Pago ainda está coçando a cabeça.' });
});

app.get('/pago/falha', (_req, res) => {
  res.render('erro', { message: 'Pagamento falhou. Ou você desistiu, ou o cartão te traiu.' });
});

app.post('/webhooks/mercadopago', async (req, res) => {
  const body = req.body as { type?: string; data?: { id?: number } };
  if (config.mpWebhookSecret) {
    const signature = req.headers['x-signature'] as string | undefined;
    const dataId = String(body.data?.id ?? '');
    if (!verifyWebhookSignature(signature, dataId, config.mpWebhookSecret)) {
      return res.status(401).json({ error: 'assinatura inválida' });
    }
  }

  const paymentId = body.type === 'payment' ? Number(body.data?.id) : 0;
  if (!paymentId) {
    return res.status(400).json({ error: 'sem payment id' });
  }
  try {
    const result = await handlePaymentNotification(paymentId);
    console.log('[webhook]', result.detail);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] erro:', err);
    res.status(500).json({ error: 'falha ao processar' });
  }
});

app.use((_req, res) => {
  res.status(404).render('erro', { message: 'Página não encontrada. Erro 404, o erro mais triste da matemática.' });
});

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  console.error('[erro interno]', err);
  const status = typeof (err as { status?: number } | null)?.status === 'number' ? (err as { status: number }).status : 500;
  if (res.locals.csrfToken === undefined) res.locals.csrfToken = '';
  if (res.locals.user === undefined) res.locals.user = null;
  if (res.locals.appUrl === undefined) res.locals.appUrl = config.appUrl;
  if (res.locals.path === undefined) res.locals.path = _req.path;
  if (res.locals.plans === undefined) res.locals.plans = PLANS;
  if (res.locals.seo === undefined) res.locals.seo = {};
  res.status(status).render('erro', {
    message: status === 400 ? 'Requisição malformada. A calculadora não entendeu o que você mandou.' : 'Erro interno no servidor. A calculadora pifou, mas a gente finge que vai resolver logo.',
  });
});

export { app };
