import { db, UserRow } from './db.js';
import { FREE_DAILY_CREDITS, PLANS, PlanId } from './config.js';

const PLAN_RANK: Record<PlanId | 'free', number> = { free: 0, semanal: 1, mensal: 2, vitalicio: 3 };

export function hasFullAccess(user: UserRow): boolean {
  if (user.plan === 'free') return false;
  if (user.plan === 'vitalicio') return true;
  return user.plan_expires_at !== null && user.plan_expires_at > Date.now();
}

export function getPlanInfo(user: UserRow): {
  status: 'free' | 'active' | 'expired';
  expiresAt: number | null;
  planName: string;
} {
  if (user.plan === 'free' || user.plan === 'vitalicio') {
    return { status: user.plan === 'vitalicio' ? 'active' : 'free', expiresAt: null, planName: user.plan };
  }
  if (user.plan_expires_at !== null && user.plan_expires_at > Date.now()) {
    return { status: 'active', expiresAt: user.plan_expires_at, planName: user.plan };
  }
  return { status: 'expired', expiresAt: user.plan_expires_at, planName: user.plan };
}

export function canSwitchToPlan(user: UserRow, planId: PlanId): { allowed: boolean; reason: string | null } {
  if (user.plan === 'vitalicio') {
    return { allowed: false, reason: 'Você já é vitalício, para sempre. Não tem o que trocar.' };
  }
  const info = getPlanInfo(user);
  if (info.status === 'active') {
    if (PLAN_RANK[planId] < PLAN_RANK[user.plan as PlanId]) {
      return {
        allowed: false,
        reason: `Seu plano ${info.planName} está ativo: só dá pra trocar por uma edição maior (ou renovar essa). Quando ele acabar, você pode assinar qualquer uma.`,
      };
    }
  }
  return { allowed: true, reason: null };
}

export function activatePlan(userId: number, planId: PlanId): void {
  const plan = PLANS[planId];
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!user) return;

  let expiresAt: number | null = null;
  if (plan.days !== Infinity) {
    const base = user.plan !== 'free' && user.plan_expires_at && user.plan_expires_at > Date.now()
      ? user.plan_expires_at
      : Date.now();
    expiresAt = base + plan.days * 24 * 60 * 60 * 1000;
  }

  db.prepare('UPDATE users SET plan = ?, plan_expires_at = ? WHERE id = ?').run(planId, expiresAt, userId);
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function claimDailyCredit(user: UserRow): { claimed: boolean; credits: number; message: string } {
  const today = todayKey();
  if (user.last_credit_claim === today) {
    return { claimed: false, credits: user.credits, message: 'Você já resgatou o crédito de hoje. Volta amanhã, espertinho.' };
  }
  const credits = user.credits + FREE_DAILY_CREDITS;
  db.prepare('UPDATE users SET credits = ?, last_credit_claim = ? WHERE id = ?').run(credits, today, user.id);
  user.credits = credits;
  user.last_credit_claim = today;
  return { claimed: true, credits, message: `+1 crédito grátis resgatado! Você tem ${credits} crédito(s).` };
}
