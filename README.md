# CalcUltra Deluxe Edition — A Calculadora Mais Completa do Mundo

> Link oficial: **https://calc.esc-software.com/**

![Node](https://img.shields.io/badge/Node-24-2e4fe8?style=flat-square&labelColor=1a1a1a)
![TypeScript](https://img.shields.io/badge/TypeScript-5-2e4fe8?style=flat-square&labelColor=1a1a1a)
![Tailwind](https://img.shields.io/badge/Tailwind-4-2e4fe8?style=flat-square&labelColor=1a1a1a)
![EJS](https://img.shields.io/badge/View-EJS-2e4fe8?style=flat-square&labelColor=1a1a1a)
![Testes](https://img.shields.io/badge/testes-87%20passando-brightgreen?style=flat-square&labelColor=1a1a1a)

Meme SaaS em Node.js + TypeScript + EJS + Tailwind + SQLite, com **Pix do Mercado Pago**, **IA via OpenRouter**, **emails de cobrança via SMTP** e visual neo-brutalista.

## ✨ O que tem

- **Calculadora** com motor `mathjs` completo nas edições pagas (seno, log, raiz, conversão de unidades, porcentagem, fatorial...) e operações básicas na gratuita.
- **Resolvedor de contas de prova** (`POST /api/resolver`): resolve problemas em linguagem natural ("João tinha 10 maçãs e deu 6 pro Pedro. Quantas sobraram?") com resposta final, passo a passo, abordagem avançada (álgebra) e métodos alternativos — via OpenRouter com few-shot em pt-BR.
- **4 edições**, do grátis ao vitalício, com Pix direto (QR Code + copia e cola), webhook assinado e ativação idempotente.
- **Emails automáticos**: boas-vindas, plano expirado e lembrete de upgrade — com design na cara da marca.
- **Página de deletar conta** (`/conta/deletar`) com confirmação.
- Visual neo-brutalista (papel, tinta, azul royal, dourado), 100% responsivo.

## 💎 As edições

| Edição | Preço | O que dá |
|---|---|---|
| Gratuita | R$ 0 | 1 crédito por dia (resgatado no painel). Cada cálculo básico gasta 1 crédito. |
| Semanal | R$ 1 | Calculadora completa por 7 dias. |
| Mensal | R$ 5 | Calculadora completa por 30 dias. |
| Vitalícia | R$ 50 | Calculadora completa pra sempre. |

- Plano pago ativo **soma dias** ao que já existe na renovação.
- Aviso de expiração no painel e no badge da calculadora quando faltam ≤ 2 dias.
- O resolvedor custa **3 créditos** na edição gratuita e é incluso nas pagas (limite anti-abuso: 6 consultas/15min por IP + 30/dia por usuário).

## 🚀 Rodando local

```bash
npm install
npm run css      # compila o Tailwind (styles/input.css -> public/css/style.css)
npm run dev      # servidor em http://localhost:6000 (tsx watch)
```

Sem `MP_ACCESS_TOKEN`, o `/pagar/:plano` entra em **modo simulação** e ativa o plano na hora. Sem SMTP, os emails são apenas logados.

Copie `.env.example` para `.env` e preencha o que for usar.

## 🐳 Docker

### Local

```bash
docker compose up -d --build
# http://localhost:6000
```

- Build em 2 estágios; `data/` (SQLite) fica num volume persistente.
- Roda como usuário não-root, com `HEALTHCHECK` em `GET /health`.
- **Atenção (Windows/Docker Desktop):** o SQLite usa WAL — não edite `data/db.sqlite` pelo host enquanto o contêiner estiver rodando. Escreva sempre pelas rotas do app ou com `docker exec` dentro de `/app`.

### Coolify (produção)

1. Adicione o repositório em **New Resource → Dockerfile** (ou Docker Compose, se preferir).
2. Defina a porta pública **6000** e o domínio **calc.esc-software.com** (HTTPS automático).
3. Configure as variáveis de ambiente (todas via painel):

| Variável | Obrigatória | Valor de produção |
|---|---|---|
| `APP_URL` | ✅ | `https://calc.esc-software.com` |
| `SESSION_SECRET` | ✅ | string aleatória longa |
| `MP_ACCESS_TOKEN` | ✅ | token da aplicação no Mercado Pago |
| `MP_WEBHOOK_SECRET` | recomendada | segredo pro webhook assinado |
| `OPENROUTER_KEY` | ✅ | key do OpenRouter |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASS` / `EMAIL_FROM` | recomendada | SMTP (ex.: Hostinger) |
| `REMINDER_INTERVAL_HOURS` | opcional | ciclo dos lembretes (padrão 6) |
| `REMINDER_MIN_DAYS` | opcional | mínimo de dias entre emails por usuário (padrão 3) |

4. Adicione **Persistent Storage**: `/app/data` (o banco SQLite mora lá).
5. Deploy. O webhook do Pix usa `notification_url` = `APP_URL/webhooks/mercadopago`.

## 💳 Mercado Pago — Pix sem burocracia

1. Crie uma aplicação em https://www.mercadopago.com.br/developers e pegue o **Access Token**.
2. Preencha `MP_ACCESS_TOKEN` (e `MP_WEBHOOK_SECRET` pra assinar o webhook).
3. `APP_URL` deve ser a URL pública (HTTPS).

Fluxo: `/pagar/:plano` cria um **pagamento Pix direto** (via API de payments, sem checkout) e renderiza `views/pagar.ejs` com **QR Code + código copia-e-cola**. A página faz poll em `/api/pagamento/:id/status` (4s) e redireciona quando aprova. O webhook em `POST /webhooks/mercadopago` valida **assinatura, status, valor, external_reference e descrição** antes de ativar o plano.

## 📧 Emails automáticos

| Email | Quando |
|---|---|
| Boas-vindas | no registro |
| Plano expirado | quando a edição paga vence |
| Lembrete de upgrade | usuários gratuitos (ciclo `REMINDER_INTERVAL_HOURS`, respeitando `REMINDER_MIN_DAYS` por usuário) |

Todos os emails incluem link pra deletar conta (`/conta/deletar`). Sem SMTP configurado, nada é enviado — só logado.

## 🧪 Testes

```bash
npm test           # vitest run — 87 testes
npm run typecheck
```

- `tests/plans.test.ts` — ativação, expiração, renovação, créditos diários.
- `tests/calculator.test.ts` — motor de cálculo (grátis vs pago), créditos.
- `tests/app.test.ts` — fluxo completo HTTP: auth, créditos, upgrade, webhook, páginas.
- `tests/security.test.ts` — CSRF, XSS, SQL injection, brute force, forja de webhook.
- `tests/ai-client.test.ts` — resolvedor (mock do OpenRouter).

## 🔒 Segurança

| Ameaça | Mitigação |
|---|---|
| CSRF | Token em sessão + `x-csrf-token` / `_csrf` (webhook fora da checagem) |
| SQL injection | 100% de queries parametrizadas (better-sqlite3) |
| XSS | Regex rígida no username + escape do EJS |
| Brute force | `express-rate-limit` no login/registro |
| Sessões | Store em SQLite, cookie `httpOnly + sameSite=lax + secure` em produção |
| Forjar pagamento | Webhook valida status + valor + ref + descrição na API do MP |
| Webhook spoof | `x-signature` (HMAC-SHA256) quando `MP_WEBHOOK_SECRET` setado |
| Dupla ativação | `verifyPaymentForUser` idempotente (UNIQUE em `mp_payment_id`) |
| Abuso da calculadora | Expressão limitada a 300 chars; `import()`/`createUnit` bloqueados |
| Timeouts | Fetch do MP (15s) e da IA (60s) com `AbortController` |
| Segredos | `SESSION_SECRET` padrão bloqueia subida em produção |

## 🗺️ Rotas

| Rota | O que é |
|---|---|
| `/` | Tudo: calculadora, resolvedor, login/registro, créditos e status da edição |
| `/planos` | As 4 edições + pagamento |
| `/pagar/:plano` | Página do Pix (QR + copia e cola) |
| `/conta/deletar` | Deletar conta (GET form + POST) |
| `/api/resolver` | Resolvedor de contas de prova (IA) |
| `/api/status` | Status da edição + créditos (badge da calculadora) |
| `/webhooks/mercadopago` | Webhook do Pix |
| `/health` | Healthcheck pro Docker/Coolify |

## 📁 Estrutura

```
src/
  app.ts            # tudo: app Express, auth, CSRF, rotas (testável via supertest)
  server.ts         # sobe o servidor + /health + scheduler de lembretes
  config.ts         # env + tabela de planos (+ trava de segredo em prod)
  db.ts             # SQLite (better-sqlite3) + sessões persistentes
  plans.ts          # ativação, expiração, créditos diários
  calculator.ts     # motor de cálculo (mathjs) + limites
  ai-client.ts      # Resolvedor de contas de prova (OpenRouter + few-shot pt-BR)
  mp-client.ts      # cliente HTTP do Mercado Pago (mockável nos testes)
  mercadopago.ts    # lógica de negócio (webhook, assinatura, verificação)
  mailer.ts         # emails (boas-vindas, expiração, lembrete) + layout
  reminders.ts      # ciclo de lembretes (intervalo + mínimo por usuário)
views/              # EJS — home, planos, pagar, deletar, erro (+ partials)
styles/input.css    # fonte do Tailwind
public/js/          # calculator.js + resolver.js
scripts/            # make-og.mjs (banner OG) + send-test-email.mjs
tests/              # vitest + supertest
Dockerfile / docker-compose.yml
```
