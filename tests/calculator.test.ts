import { describe, expect, it } from 'vitest';
import { db, UserRow } from '../src/db.js';
import { evaluate } from '../src/calculator.js';
import { activatePlan } from '../src/plans.js';

function createUser(overrides: Partial<UserRow> = {}): UserRow {
  const result = db
    .prepare('INSERT INTO users (email, username, password_hash, credits, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(`calc${Date.now()}-${Math.random()}@test.com`, `calc${Math.random()}`, 'hash', overrides.credits ?? 0, Date.now());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid) as UserRow;
  return { ...user, ...overrides };
}

describe('motor de cálculo — plano grátis', () => {
  it('calcula operação básica e gasta 1 crédito', () => {
    const user = createUser({ credits: 2 });
    const result = evaluate(user, '2+2');
    expect(result.error).toBeNull();
    expect(result.result).toBe('4');
    expect(result.usedCredit).toBe(true);
    const after = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id) as { credits: number };
    expect(after.credits).toBe(1);
  });

  it('suporta percentual, potência e parênteses no básico', () => {
    const user = createUser({ credits: 5 });
    expect(evaluate(user, '200*10%').result).toBe('20');
    expect(evaluate(user, '2^10').result).toBe('1024');
    expect(evaluate(user, '(1+2)*3').result).toBe('9');
  });

  it('bloqueia funções avançadas no plano grátis', () => {
    const user = createUser({ credits: 3 });
    const result = evaluate(user, 'sin(30)');
    expect(result.error).not.toBeNull();
    expect(result.error).toContain('exclusivas do plano pago');
    const after = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id) as { credits: number };
    expect(after.credits).toBe(3);
  });

  it('bloqueia conversão de unidades no plano grátis', () => {
    const user = createUser({ credits: 3 });
    const result = evaluate(user, '10 km to miles');
    expect(result.error).not.toBeNull();
  });

  it('sem créditos, nem o básico funciona', () => {
    const user = createUser({ credits: 0 });
    const result = evaluate(user, '1+1');
    expect(result.error).toContain('Sem créditos');
    expect(result.result).toBe('');
  });

  it('expressão inválida retorna erro sem gastar crédito', () => {
    const user = createUser({ credits: 1 });
    const result = evaluate(user, '2+');
    expect(result.error).not.toBeNull();
    const after = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id) as { credits: number };
    expect(after.credits).toBe(1);
  });
});

describe('motor de cálculo — plano pago', () => {
  it('usuário vitalício tem acesso completo sem gastar crédito', () => {
    const user = createUser();
    activatePlan(user.id, 'vitalicio');
    const paid = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    const result = evaluate(paid, 'sin(30 deg)');
    expect(result.error).toBeNull();
    expect(result.result).toBe('0.5');
    expect(result.usedCredit).toBe(false);
  });

  it('usuário mensal usa funções avançadas', () => {
    const user = createUser();
    activatePlan(user.id, 'mensal');
    const paid = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    expect(evaluate(paid, 'log10(1000)').result).toBe('3');
    expect(evaluate(paid, 'sqrt(144)').result).toBe('12');
    expect(evaluate(paid, '5!').result).toBe('120');
  });

  it('usuário pago faz conversão de unidades', () => {
    const user = createUser();
    activatePlan(user.id, 'vitalicio');
    const paid = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    const result = evaluate(paid, '10 km to miles');
    expect(result.error).toBeNull();
    expect(result.result).not.toBe('');
  });
});
