import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

let mockExternalRef = '1';
let mockAmount = 5;
let mockDescription = 'CalcUltra Deluxe Edition - Plano Mensal (5 reais/mês)';
let mockStatus = 'approved';

vi.mock('../src/mp-client.js', async () => {
  return {
    createPixPayment: vi.fn(async () => ({
      id: 701,
      qrBase64: 'cWItZmFrZQ==',
      qrCode: '00020126580014BR.GOV.BCB.PIX0136fake-pix-code-123456',
    })),
    getPayment: vi.fn(async (paymentId: number) => {
      if (paymentId === 777 || paymentId === 778 || paymentId === 701) {
        return {
          id: paymentId,
          status: mockStatus,
          external_reference: mockExternalRef,
          transaction_amount: mockAmount,
          description: mockDescription,
        };
      }
      throw new Error(`pagamento ${paymentId} não encontrado no mock`);
    }),
  };
});

vi.mock('../src/ai-client.js', () => ({
  solveWordProblem: vi.fn(async () => ({
    resposta: 'Sobraram 4 maçãs.',
    passos_simples: [{ titulo: 'Subtrair o que foi dado', texto: '10 - 6 = 4' }],
    passos_avancados: [{ titulo: 'Generalizando', texto: 'x - y, com x = 10 e y = 6, resulta em 4.' }],
    alternativas: [{ titulo: 'Conferindo pela soma', texto: '4 + 6 = 10. Confere!' }],
    suposicoes: [],
  })),
}));

import { app } from '../src/app.js';
import { db } from '../src/db.js';

let agent: ReturnType<typeof request.agent>;

beforeEach(() => {
  agent = request.agent(app);
  mockExternalRef = '1';
  mockAmount = 5;
  mockDescription = 'CalcUltra Deluxe Edition - Plano Mensal (5 reais/mês)';
  mockStatus = 'approved';
});

async function getCsrf(ag: ReturnType<typeof request.agent>, path = '/') {
  const res = await ag.get(path);
  const m = (res.text || '').match(/name="csrf-token" content="([^"]+)"/);
  return m ? m[1] : '';
}

async function postForm(ag: ReturnType<typeof request.agent>, path: string, body: Record<string, string>) {
  const token = await getCsrf(ag, '/');
  return ag.post(path).type('form').set('x-csrf-token', token).send(body);
}

async function registerAgent(body: { username?: string; email?: string; password?: string } = {}) {
  return postForm(agent, '/registrar', {
    username: body.username ?? `teste${Date.now()}`,
    email: body.email ?? `teste${Date.now()}@test.com`,
    password: body.password ?? 'senha123',
  });
}

async function login(ag: ReturnType<typeof request.agent>, identifier: string, password: string) {
  return postForm(ag, '/entrar', { identifier, password });
}

describe('autenticação', () => {
  it('registro redireciona pra home e cria sessão', async () => {
    const res = await registerAgent();
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('registro rejeita e-mail inválido', async () => {
    const res = await registerAgent({ email: 'nao-e-email' });
    expect(res.status).toBe(400);
  });

  it('registro rejeita usuário duplicado', async () => {
    const uname = `dup${Date.now()}`;
    await registerAgent({ username: uname });
    const res = await registerAgent({ username: uname });
    expect(res.status).toBe(400);
  });

  it('login funciona com usuário ou e-mail', async () => {
    const uname = `login${Date.now()}`;
    const email = `${uname}@test.com`;
    await registerAgent({ username: uname, email });

    const a2 = request.agent(app);
    const byUsername = await login(a2, uname, 'senha123');
    expect(byUsername.status).toBe(302);
    expect(byUsername.headers.location).toBe('/');
  });

  it('login errado retorna 401', async () => {
    const res = await login(request.agent(app), 'ghost@test.com', 'x');
    expect(res.status).toBe(401);
  });

  it('rotas protegidas redirecionam deslogado', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });
});

describe('créditos e cálculo na API', () => {
  it('resgata crédito diário e calcula gastando crédito', async () => {
    await registerAgent();
    await postForm(agent, '/creditos/resgatar', {});

    const status = await agent.get('/api/status');
    expect(status.body).toMatchObject({ full: false, credits: 1, plan: 'free' });

    const calc = await agent.post('/api/calcular').set('x-csrf-token', await getCsrf(agent)).send({ expression: '2+2' });
    expect(calc.status).toBe(200);
    expect(calc.body.result).toBe('4');
    expect(calc.body.usedCredit).toBe(true);

    const statusAfter = await agent.get('/api/status');
    expect(statusAfter.body.credits).toBe(0);
  });

  it('não deixa resgatar 2x no mesmo dia', async () => {
    await registerAgent();
    await postForm(agent, '/creditos/resgatar', {});
    await postForm(agent, '/creditos/resgatar', {});
    const status = await agent.get('/api/status');
    expect(status.body.credits).toBe(1);
  });

  it('função avançada é bloqueada no grátis via API', async () => {
    await registerAgent();
    await postForm(agent, '/creditos/resgatar', {});
    const calc = await agent.post('/api/calcular').set('x-csrf-token', await getCsrf(agent)).send({ expression: 'cos(0)' });
    expect(calc.body.error).toContain('exclusivas do plano pago');
  });

  it('sem créditos, cálculo retorna aviso', async () => {
    await registerAgent();
    const calc = await agent.post('/api/calcular').set('x-csrf-token', await getCsrf(agent)).send({ expression: '1+1' });
    expect(calc.body.error).toContain('Sem créditos');
  });
});

describe('resolvedor de contas de prova (IA)', () => {
  it('resolve no plano grátis gastando 3 créditos', async () => {
    await registerAgent();
    const st = await agent.get('/api/status');
    db.prepare('UPDATE users SET credits = 5 WHERE id = ?').run(st.body.id);

    const res = await agent
      .post('/api/resolver')
      .set('x-csrf-token', await getCsrf(agent))
      .send({ question: 'João tinha 10 maçãs e deu 6 pro Pedro. Quantas sobraram?' });

    expect(res.status).toBe(200);
    expect(res.body.resposta).toContain('4 maçãs');
    expect(res.body.passos_simples.length).toBeGreaterThan(0);
    expect(res.body.passos_avancados.length).toBeGreaterThan(0);
    expect(res.body.alternativas.length).toBeGreaterThan(0);
    expect(res.body.usedCredits).toBe(3);

    const status = await agent.get('/api/status');
    expect(status.body.credits).toBe(2);
  });

  it('sem créditos suficientes retorna 402', async () => {
    await registerAgent();
    const res = await agent
      .post('/api/resolver')
      .set('x-csrf-token', await getCsrf(agent))
      .send({ question: '2 + 2?' });
    expect(res.status).toBe(402);
  });

  it('edição paga resolve de graça', async () => {
    await registerAgent();
    await agent.get('/pagar/mensal');
    const res = await agent
      .post('/api/resolver')
      .set('x-csrf-token', await getCsrf(agent))
      .send({ question: 'Uma loja vende camisetas a R$25. Quanto custam 4?' });
    expect(res.status).toBe(200);
    expect(res.body.usedCredits).toBe(0);
    expect(res.body.full).toBe(true);
  });

  it('pergunta vazia ou gigante é recusada', async () => {
    await registerAgent();
    await postForm(agent, '/creditos/resgatar', {});
    const vazia = await agent.post('/api/resolver').set('x-csrf-token', await getCsrf(agent)).send({ question: '   ' });
    expect(vazia.status).toBe(400);
    const gigante = await agent
      .post('/api/resolver')
      .set('x-csrf-token', await getCsrf(agent))
      .send({ question: 'x'.repeat(2000) });
    expect(gigante.status).toBe(400);
  });

  it('API do resolvedor exige token CSRF', async () => {
    const res = await request(app).post('/api/resolver').send({ question: '2+2?' });
    expect(res.status).toBe(403);
  });

  it('limite diário de resoluções é respeitado', async () => {
    await registerAgent();
    await agent.get('/pagar/mensal');
    const st = await agent.get('/api/status');
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const ins = db.prepare("INSERT INTO calc_usage (user_id, expression, credits_used, source, created_at) VALUES (?, 'x', 0, 'ai', ?)");
    for (let i = 0; i < 30; i++) ins.run(st.body.id, dayStart.getTime());

    const res = await agent
      .post('/api/resolver')
      .set('x-csrf-token', await getCsrf(agent))
      .send({ question: '2+2?' });
    expect(res.status).toBe(429);
  });
});

describe('pagamento simulado e upgrade', () => {
  it('compra simulada ativa o plano e libera funções avançadas', async () => {
    await registerAgent();
    await postForm(agent, '/creditos/resgatar', {});

    const blocked = await agent.post('/api/calcular').set('x-csrf-token', await getCsrf(agent)).send({ expression: 'sin(90 deg)' });
    expect(blocked.body.error).toBeDefined();

    const buy = await agent.get('/pagar/semanal');
    expect(buy.status).toBe(302);
    expect(buy.headers.location).toContain('/?msg=');
    const buyMsg = await agent.get(buy.headers.location);
    expect(buyMsg.text).toContain('Plano Semanal ativado em modo simulação');

    const status = await agent.get('/api/status');
    expect(status.body).toMatchObject({ full: true, plan: 'semanal' });

    const calc = await agent.post('/api/calcular').set('x-csrf-token', await getCsrf(agent)).send({ expression: 'sin(90 deg)' });
    expect(calc.body.error).toBeNull();
    expect(calc.body.result).toBe('1');
    expect(calc.body.usedCredit).toBe(false);
  });

  it('plano inexistente retorna 404', async () => {
    await registerAgent();
    const res = await agent.get('/pagar/vitaliciozinho');
    expect(res.status).toBe(404);
  });

  it('renovar enquanto ativo soma dias', async () => {
    await registerAgent();
    await agent.get('/pagar/mensal');
    const first = await agent.get('/api/status');
    await agent.get('/pagar/mensal');
    const second = await agent.get('/api/status');
    expect(second.body.plan_expires_at).toBeGreaterThan(first.body.plan_expires_at + 29 * 86400000);
  });

  it('downgrade de plano ativo é bloqueado com 403', async () => {
    await registerAgent();
    await agent.get('/pagar/mensal');
    const res = await agent.get('/pagar/semanal');
    expect(res.status).toBe(403);
    expect(res.text).toContain('está ativo');
    const after = await agent.get('/api/status');
    expect(after.body.plan).toBe('mensal');
  });

  it('upgrade de plano ativo continua funcionando', async () => {
    await registerAgent();
    await agent.get('/pagar/semanal');
    const res = await agent.get('/pagar/vitalicio');
    expect(res.status).toBe(302);
    const after = await agent.get('/api/status');
    expect(after.body.plan).toBe('vitalicio');
  });

  it('plano expirado pode voltar pro semanal', async () => {
    await registerAgent();
    await agent.get('/pagar/mensal');
    const st = await agent.get('/api/status');
    db.prepare('UPDATE users SET plan_expires_at = ? WHERE id = ?').run(Date.now() - 1000, st.body.id);
    const res = await agent.get('/pagar/semanal');
    expect(res.status).toBe(302);
    const after = await agent.get('/api/status');
    expect(after.body.plan).toBe('semanal');
  });

  it('vitalício não consegue trocar de plano', async () => {
    await registerAgent();
    await agent.get('/pagar/vitalicio');
    const res = await agent.get('/pagar/mensal');
    expect(res.status).toBe(403);
    expect(res.text).toContain('vitalício');
  });

  it('modo real renderiza a página do Pix (QR + código copia e cola)', async () => {
    const { config } = await import('../src/config.js');
    const original = config.mpAccessToken;
    config.mpAccessToken = 'TEST-mock';
    try {
      await registerAgent();
      mockExternalRef = String((await agent.get('/api/status')).body.id);
      const res = await agent.get('/pagar/mensal');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Pix');
      expect(res.text).toContain('base64,cWItZmFrZQ==');
      expect(res.text).toContain('00020126580014');
    } finally {
      config.mpAccessToken = original;
    }
  });

  it('endpoint de status do Pix ativa o plano quando aprovado', async () => {
    await registerAgent();
    mockExternalRef = String((await agent.get('/api/status')).body.id);
    mockStatus = 'approved';
    mockAmount = 5;
    const res = await agent.get('/api/pagamento/701/status');
    expect(res.body).toMatchObject({ status: 'approved', approved: true });
    const after = await agent.get('/api/status');
    expect(after.body.full).toBe(true);
  });

  it('dashboard avisa quando faltam 2 dias ou menos de plano', async () => {
    await registerAgent();
    await agent.get('/pagar/semanal');
    const st = await agent.get('/api/status');
    db.prepare('UPDATE users SET plan_expires_at = ? WHERE id = ?').run(Date.now() + 86400000, st.body.id);
    const home = await agent.get('/');
    expect(home.text).toContain('Falta 1 dia');
    expect(home.text).toContain('Renovar agora');
  });
});

describe('webhook do Mercado Pago', () => {
  it('ativa o plano quando o pagamento é aprovado', async () => {
    await registerAgent();
    const status = await agent.get('/api/status');
    mockExternalRef = String(status.body.id);

    const res = await agent.post('/webhooks/mercadopago').send({ type: 'payment', data: { id: 777 } });
    expect(res.status).toBe(200);

    const after = await agent.get('/api/status');
    expect(after.body).toMatchObject({ full: true, plan: 'mensal' });
  });

  it('webhook duplicado não quebra (idempotente)', async () => {
    await registerAgent();
    const status = await agent.get('/api/status');
    mockExternalRef = String(status.body.id);

    await agent.post('/webhooks/mercadopago').send({ type: 'payment', data: { id: 777 } });
    const second = await agent.post('/webhooks/mercadopago').send({ type: 'payment', data: { id: 777 } });
    expect(second.status).toBe(200);
  });

  it('pagamento com valor errado não ativa plano', async () => {
    await registerAgent();
    const status = await agent.get('/api/status');
    mockExternalRef = String(status.body.id);
    mockAmount = 4.99;

    await agent.post('/webhooks/mercadopago').send({ type: 'payment', data: { id: 777 } });
    const after = await agent.get('/api/status');
    expect(after.body.full).toBe(false);
  });

  it('pagamento com external_reference de outro usuário não ativa plano', async () => {
    await registerAgent();
    mockExternalRef = '999999';

    await agent.post('/webhooks/mercadopago').send({ type: 'payment', data: { id: 777 } });
    const after = await agent.get('/api/status');
    expect(after.body.full).toBe(false);
  });

  it('pagamento não aprovado não ativa plano', async () => {
    await registerAgent();
    const status = await agent.get('/api/status');
    mockExternalRef = String(status.body.id);
    mockStatus = 'rejected';

    await agent.post('/webhooks/mercadopago').send({ type: 'payment', data: { id: 777 } });
    const after = await agent.get('/api/status');
    expect(after.body.full).toBe(false);
  });
});

describe('páginas', () => {
  it('home carrega com o marketing', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('mais completa');
    expect(res.text).toContain('CalcUltra');
  });

  it('planos carregam com preços', async () => {
    const res = await request(app).get('/planos');
    expect(res.status).toBe(200);
    expect(res.text).toContain('R$ 5');
    expect(res.text).toContain('R$ 50');
  });

  it('404 renderiza a página de erro', async () => {
    const res = await request(app).get('/nao-existe');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Algo saiu do esperado');
  });
});
