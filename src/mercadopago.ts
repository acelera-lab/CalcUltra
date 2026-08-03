import crypto from 'node:crypto';
import { config, PLANS, PlanId } from './config.js';
import { db } from './db.js';
import { activatePlan } from './plans.js';
import { getPayment, MpPayment } from './mp-client.js';

export { getPayment, createPixPayment } from './mp-client.js';

export async function handlePaymentNotification(paymentId: number): Promise<{ handled: boolean; detail: string }> {
  const payment: MpPayment = await getPayment(paymentId);

  const existing = db.prepare('SELECT id FROM payments WHERE mp_payment_id = ?').get(paymentId);
  if (existing) {
    return { handled: false, detail: `pagamento ${paymentId} já processado` };
  }

  const userId = Number(payment.external_reference || '');
  if (!Number.isInteger(userId)) {
    return { handled: false, detail: `external_reference inválida: ${payment.external_reference}` };
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) {
    return { handled: false, detail: `usuário ${userId} não existe` };
  }

  const description = payment.description || '';
  let planId: PlanId | null = null;
  for (const id of Object.keys(PLANS) as PlanId[]) {
    if (description.includes(PLANS[id].title)) {
      planId = id;
      break;
    }
  }

  if (!planId) {
    const match = description.match(/Plano (\w+)/);
    if (match && Object.keys(PLANS).includes(match[1])) planId = match[1] as PlanId;
  }

  const now = Date.now();
  if (payment.status === 'approved' && planId && Math.abs(payment.transaction_amount - PLANS[planId].price) < 0.01) {
    activatePlan(userId, planId);
    db.prepare(
      'INSERT INTO payments (user_id, plan, mp_payment_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, planId, paymentId, payment.transaction_amount, 'approved', now);
    return { handled: true, detail: `plano ${planId} ativado para usuário ${userId}` };
  }

  db.prepare(
    'INSERT INTO payments (user_id, plan, mp_payment_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userId, planId || 'free', paymentId, payment.transaction_amount || 0, payment.status, now);

  return { handled: false, detail: `status ${payment.status} não aprovado (ou plano não identificado)` };
}

export async function verifyPaymentForUser(
  paymentId: number,
  userId: number,
  planId: PlanId,
): Promise<boolean> {
  const existing = db
    .prepare('SELECT status FROM payments WHERE mp_payment_id = ?')
    .get(paymentId) as { status: string } | undefined;
  if (existing) {
    return existing.status === 'approved';
  }

  const payment: MpPayment = await getPayment(paymentId);
  const expected = PLANS[planId].price;
  if (
    payment.status === 'approved' &&
    payment.external_reference === String(userId) &&
    Math.abs(payment.transaction_amount - expected) < 0.01
  ) {
    activatePlan(userId, planId);
    db.prepare(
      'INSERT INTO payments (user_id, plan, mp_payment_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, planId, paymentId, payment.transaction_amount, 'approved', Date.now());
    return true;
  }
  return false;
}

export function verifyWebhookSignature(
  header: string | undefined,
  dataId: string,
  secret: string,
): boolean {
  if (!header || !secret || !dataId) return false;
  const parts = Object.fromEntries(
    header
      .split(';')
      .map((p) => p.split('='))
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  ) as { ts?: string; v1?: string; 'x-request-id'?: string };
  if (!parts.ts || !parts.v1) return false;

  const expected = `id:${dataId};request-id:${parts['x-request-id'] || ''};ts:${parts.ts};`;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(expected)
    .digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function paymentConfig(): { configured: boolean; mode: 'teste' | 'producao' } {
  const configured = config.mpAccessToken.length > 0;
  return { configured, mode: configured ? 'producao' : 'teste' };
}
