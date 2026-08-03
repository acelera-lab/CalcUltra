import crypto from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

let mockExternalRef = '1';
let mockAmount = 5;

vi.mock('../src/mp-client.js', async () => {
  return {
    createPreference: vi.fn(async () => ({ init_point: 'https://checkout.mercadopago.com.br/mock', id: 'pref-mock' })),
    getPayment: vi.fn(async (paymentId: number) => ({
      id: paymentId,
      status: 'approved',
      external_reference: mockExternalRef,
      transaction_amount: mockAmount,
      description: 'CalcUltra Deluxe Edition - Plano Mensal (5 reais/mês)',
    })),
  };
});

import { app } from '../src/app.js';
import { SqliteSessionStore } from '../src/db.js';
import { verifyWebhookSignature } from '../src/mercadopago.js';
import { db } from '../src/db.js';

async function getCsrf(ag: ReturnType<typeof request.agent>, path = '/') {
  const res = await ag.get(path);
  const m = (res.text || '').match(/name="csrf-token" content="([^"]+)"/);
  return m ? m[1] : '';
}

async function register(ag: ReturnType<typeof request.agent>) {
  const token = await getCsrf(ag, '/');
  const username = `seg${Date.now() % 1000000000}${Math.floor(Math.random() * 1000)}`;
  const res = await ag
    .post('/registrar')
    .type('form')
    .set('x-csrf-token', token)
    .send({ username, email: `${username}@test.com`, password: 'senha123' });
  expect(res.status).toBe(302);
  return res;
}

describe('headers de segurança (helmet)', () => {
  it('responde com headers de proteção', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-download-options']).toBe('noopen');
  });
});

describe('CSRF', () => {
  it('POST sem token CSRF é rejeitado com 403 (formulário recebe página amigável)', async () => {
    const res = await request(app).post('/entrar').type('form').send({ identifier: 'x', password: 'y' });
    expect(res.status).toBe(403);
    expect(res.text).toContain('Sessão expirada');
  });

  it('POST sem token CSRF na API é rejeitado com 403 JSON', async () => {
    const res = await request(app).post('/entrar').set('Content-Type', 'application/json').send({ identifier: 'x', password: 'y' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
  });

  it('POST com token CSRF errado é rejeitado com 403', async () => {
    const ag = request.agent(app);
    await getCsrf(ag);
    const res = await ag.post('/entrar').type('form').set('x-csrf-token', 'token-fake').send({ identifier: 'x', password: 'y' });
    expect(res.status).toBe(403);
  });

  it('API de cálculo também exige token', async () => {
    const ag = request.agent(app);
    await register(ag);
    const res = await ag.post('/api/calcular').send({ expression: '1+1' });
    expect(res.status).toBe(403);
  });

  it('webhook do MP fica fora da checagem de CSRF', async () => {
    const res = await request(app).post('/webhooks/mercadopago').send({ type: 'payment', data: {} });
    expect(res.status).not.toBe(403);
  });
});

describe('injeção de SQL', () => {
  it('tentativas de SQL injection no login não quebram nem logam', async () => {
    const ag = request.agent(app);
    const payloads = [
      `' OR 1=1 --`,
      `admin'--`,
      `'; DROP TABLE users;--`,
      `" OR ""="`,
      `x' UNION SELECT password_hash FROM users--`,
    ];
    for (const payload of payloads) {
      const token = await getCsrf(ag, '/');
      const res = await ag
        .post('/entrar')
        .type('form')
        .set('x-csrf-token', token)
        .send({ identifier: payload, password: 'x' });
      expect(res.status).toBe(401);
    }
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
    expect(typeof count.c).toBe('number');
  });

  it('injeção no registro não cria usuários maliciosos', async () => {
    const ag = request.agent(app);
    const token = await getCsrf(ag, '/');
    const res = await ag
      .post('/registrar')
      .type('form')
      .set('x-csrf-token', token)
      .send({ username: `x'; DROP TABLE users;--`, email: 'x@x.com', password: 'senha123' });
    expect(res.status).toBe(400);
  });
});

describe('XSS', () => {
  it('username com script é rejeitado no registro', async () => {
    const ag = request.agent(app);
    const token = await getCsrf(ag, '/');
    const res = await ag
      .post('/registrar')
      .type('form')
      .set('x-csrf-token', token)
      .send({ username: '<script>alert(1)</script>', email: 'x@x.com', password: 'senha123' });
    expect(res.status).toBe(400);
  });

  it('username é renderizado escapado (EJS auto-escape)', async () => {
    const ag = request.agent(app);
    const username = 'xss_ok';
    const token = await getCsrf(ag, '/');
    await ag.post('/registrar').type('form').set('x-csrf-token', token).send({
      username,
      email: `${username}@test.com`,
      password: 'senha123',
    });
    const home = await ag.get('/');
    expect(home.text).toContain('xss_ok');
    expect(home.text).not.toMatch(/<script[\s\S]*xss_ok/);
  });
});

describe('motor de cálculo — limites e abusos', () => {
  it('expressão gigante é recusada', async () => {
    const ag = request.agent(app);
    await register(ag);
    await ag.post('/creditos/resgatar').type('form').set('x-csrf-token', await getCsrf(ag)).send({});
    const res = await ag
      .post('/api/calcular')
      .set('x-csrf-token', await getCsrf(ag))
      .send({ expression: '1+1'.repeat(5000) });
    expect(res.body.error).toContain('longa demais');
  });

  it('import() do mathjs é bloqueado', async () => {
    const ag = request.agent(app);
    await register(ag);
    await ag.get('/pagar/vitalicio');
    const res = await ag
      .post('/api/calcular')
      .set('x-csrf-token', await getCsrf(ag))
      .send({ expression: 'import("module:whatever")' });
    expect(res.body.error).toContain('não está no cardápio');
  });

  it('createUnit é bloqueado', async () => {
    const ag = request.agent(app);
    await register(ag);
    await ag.get('/pagar/vitalicio');
    const res = await ag
      .post('/api/calcular')
      .set('x-csrf-token', await getCsrf(ag))
      .send({ expression: 'createUnit("hack")' });
    expect(res.body.error).toContain('não está no cardápio');
  });

  it('body com tipo errado não causa 500', async () => {
    const ag = request.agent(app);
    await register(ag);
    const res = await ag.post('/api/calcular').set('x-csrf-token', await getCsrf(ag)).send({ expression: { nao: 'string' } });
    expect([200, 400]).toContain(res.status);
  });

  it('JSON malformado retorna página de erro renderizada, não 500 genérico', async () => {
    const res = await request(app)
      .post('/api/calcular')
      .set('Content-Type', 'application/json')
      .send('{expression invalida}');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Algo saiu do esperado');
    expect(res.text).not.toContain('Internal Server Error');
  });

  it('API sem login devolve 401 JSON (calculadora mostra aviso de entrar, não redirect)', async () => {
    const ag = request.agent(app);
    const csrf = await getCsrf(ag);
    const res = await ag.post('/api/calcular').set('Content-Type', 'application/json').set('x-csrf-token', csrf).send({ expression: '2+2' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Entre');
  });
});

describe('pagamentos — dupla verificação', () => {
  it('visitar /pago/sucesso 2x não dobra a duração do plano', async () => {
    const ag = request.agent(app);
    await register(ag);
    const status = await ag.get('/api/status');
    mockExternalRef = String(status.body.id);

    const first = await ag.get('/pago/sucesso?payment_id=778&plan=mensal');
    expect(first.status).toBe(302);
    const second = await ag.get('/pago/sucesso?payment_id=778&plan=mensal');
    expect(second.status).toBe(302);

    const after = await ag.get('/api/status');
    expect(after.body.plan).toBe('mensal');
    expect(after.body.plan_expires_at).toBeLessThan(Date.now() + 31 * 86400000);
  });
});

describe('assinatura do webhook (x-signature)', () => {
  it('aceita assinatura válida', () => {
    const secret = 'segredo-do-webhook';
    const dataId = '1234567890';
    const ts = '1700000000';
    const requestId = 'abc-123';
    const expected = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const sig = crypto.createHmac('sha256', secret).update(expected).digest('hex');
    const header = `ts=${ts};v1=${sig};x-request-id=${requestId}`;
    expect(verifyWebhookSignature(header, dataId, secret)).toBe(true);
  });

  it('rejeita assinatura com segredo errado', () => {
    const secret = 'segredo-do-webhook';
    const dataId = '1234567890';
    const ts = '1700000000';
    const expected = `id:${dataId};request-id:;ts:${ts};`;
    const sig = crypto.createHmac('sha256', secret).update(expected).digest('hex');
    const header = `ts=${ts};v1=${sig}`;
    expect(verifyWebhookSignature(header, dataId, 'outro-segredo')).toBe(false);
  });

  it('rejeita payload adulterado', () => {
    const secret = 'segredo-do-webhook';
    const dataId = '1234567890';
    const ts = '1700000000';
    const expected = `id:${dataId};request-id:;ts:${ts};`;
    const sig = crypto.createHmac('sha256', secret).update(expected).digest('hex');
    const header = `ts=${ts};v1=${sig}`;
    expect(verifyWebhookSignature(header, '999999', secret)).toBe(false);
  });

  it('rejeita header ausente ou malformado', () => {
    expect(verifyWebhookSignature(undefined, '1', 'segredo')).toBe(false);
    expect(verifyWebhookSignature('v1=abc', '1', 'segredo')).toBe(false);
  });
});

describe('sessões no SQLite', () => {
  it('store persiste, lê e destrói sessões', () => {
    const store = new SqliteSessionStore();
    const sid = 'teste-sid-123';
    const sess = { userId: 1, cookie: { expires: new Date(Date.now() + 100000), maxAge: 100000 } };

    store.set(sid, sess, (err) => {
      expect(err).toBeUndefined();
      store.get(sid, (err2, data) => {
        expect(err2).toBeNull();
        expect(data).toMatchObject({ userId: 1 });
        store.destroy(sid, (err3) => {
          expect(err3).toBeUndefined();
          store.get(sid, (_e, data2) => {
            expect(data2).toBeNull();
          });
        });
      });
    });
  });

  it('sessão expirada não é devolvida', () => {
    const store = new SqliteSessionStore();
    const sid = 'teste-sid-expirada';
    const sess = { userId: 2, cookie: { expires: new Date(Date.now() - 1000), maxAge: 100000 } };
    store.set(sid, sess, () => {
      store.get(sid, (_e, data) => {
        expect(data).toBeNull();
      });
    });
  });
});
