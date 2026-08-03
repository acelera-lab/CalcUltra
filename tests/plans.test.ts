import { describe, expect, it } from 'vitest';
import { db, UserRow } from '../src/db.js';
import { activatePlan, canSwitchToPlan, claimDailyCredit, getPlanInfo, hasFullAccess, todayKey } from '../src/plans.js';

function createUser(overrides: Partial<UserRow> = {}): UserRow {
  const result = db
    .prepare('INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(`u${Date.now()}-${Math.random()}@test.com`, `user${Math.random()}`, 'hash', Date.now());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow;
  return { ...user, ...overrides };
}

describe('planos', () => {
  it('usuário novo nasce no plano free', () => {
    const user = createUser();
    expect(user.plan).toBe('free');
    expect(hasFullAccess(user)).toBe(false);
    expect(getPlanInfo(user).status).toBe('free');
  });

  it('plano mensal ativa por 30 dias', () => {
    const user = createUser();
    activatePlan(user.id, 'mensal');
    const after = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    expect(after.plan).toBe('mensal');
    expect(after.plan_expires_at).toBeGreaterThan(Date.now() + 29 * 86400000);
    expect(hasFullAccess(after)).toBe(true);
  });

  it('plano semanal ativa por 7 dias', () => {
    const user = createUser();
    activatePlan(user.id, 'semanal');
    const after = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    expect(after.plan_expires_at).toBeLessThan(Date.now() + 8 * 86400000);
  });

  it('renovação estende o prazo a partir do vencimento atual', () => {
    const user = createUser();
    activatePlan(user.id, 'mensal');
    const first = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    activatePlan(user.id, 'mensal');
    const second = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    expect(second.plan_expires_at).toBeGreaterThan((first.plan_expires_at as number) + 29 * 86400000);
  });

  it('plano vitalício nunca expira', () => {
    const user = createUser();
    activatePlan(user.id, 'vitalicio');
    const after = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    expect(after.plan).toBe('vitalicio');
    expect(after.plan_expires_at).toBeNull();
    expect(hasFullAccess(after)).toBe(true);
    expect(getPlanInfo(after).status).toBe('active');
  });

  it('plano expirado perde o acesso', () => {
    const user = createUser();
    activatePlan(user.id, 'semanal');
    const expired = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    expired.plan_expires_at = Date.now() - 1000;
    expect(hasFullAccess(expired)).toBe(false);
    expect(getPlanInfo(expired).status).toBe('expired');
  });
});

describe('troca de plano', () => {
  it('usuário grátis pode assinar qualquer plano', () => {
    const user = createUser();
    for (const plan of ['semanal', 'mensal', 'vitalicio'] as const) {
      expect(canSwitchToPlan(user, plan).allowed).toBe(true);
    }
  });

  it('plano ativo permite renovar o mesmo plano', () => {
    const user = createUser();
    activatePlan(user.id, 'semanal');
    const active = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    expect(canSwitchToPlan(active, 'semanal').allowed).toBe(true);
  });

  it('plano ativo permite upgrade e renovação', () => {
    const user = createUser();
    activatePlan(user.id, 'semanal');
    const active = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;

    expect(canSwitchToPlan(active, 'semanal').allowed).toBe(true);
    expect(canSwitchToPlan(active, 'mensal').allowed).toBe(true);
    expect(canSwitchToPlan(active, 'vitalicio').allowed).toBe(true);
  });

  it('plano mensal ativo bloqueia downgrade pra semanal', () => {
    const user = createUser();
    activatePlan(user.id, 'mensal');
    const active = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    const gate = canSwitchToPlan(active, 'semanal');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('está ativo');
  });

  it('plano expirado pode voltar pro mais barato', () => {
    const user = createUser();
    activatePlan(user.id, 'mensal');
    const expired = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    expired.plan_expires_at = Date.now() - 1000;
    expect(canSwitchToPlan(expired, 'semanal').allowed).toBe(true);
    expect(canSwitchToPlan(expired, 'mensal').allowed).toBe(true);
    expect(canSwitchToPlan(expired, 'vitalicio').allowed).toBe(true);
  });

  it('vitalício não troca nunca', () => {
    const user = createUser();
    activatePlan(user.id, 'vitalicio');
    const vitalicio = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    for (const plan of ['semanal', 'mensal', 'vitalicio'] as const) {
      const gate = canSwitchToPlan(vitalicio, plan);
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain('vitalício');
    }
  });
});

describe('créditos diários', () => {
  it('resgata 1 crédito por dia', () => {
    const user = createUser();
    const first = claimDailyCredit(user);
    expect(first.claimed).toBe(true);
    expect(first.credits).toBe(1);

    const second = claimDailyCredit(user);
    expect(second.claimed).toBe(false);
    expect(second.credits).toBe(1);
  });

  it('só pode resgatar de novo no dia seguinte', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const user = createUser({ last_credit_claim: todayKey(yesterday), credits: 0 });
    const result = claimDailyCredit(user);
    expect(result.claimed).toBe(true);
    expect(result.credits).toBe(1);
  });

  it('todayKey formata YYYY-MM-DD', () => {
    const d = new Date(2026, 0, 5);
    expect(todayKey(d)).toBe('2026-01-05');
  });
});
