import { create, all } from 'mathjs';
import { UserRow } from './db.js';
import { hasFullAccess } from './plans.js';
import { db } from './db.js';

const math = create(all, {});

const BASIC_EXPR_RE = /^[\d\s+\-*/%()^.,!]+$/;

const BLOCKED_FUNCTIONS = /(^|[^\w])import\s*\(|(^|[^\w])createUnit\s*\(/;

export const MAX_EXPRESSION_LENGTH = 300;

export interface CalcResult {
  result: string;
  usedCredit: boolean;
  full: boolean;
  error: string | null;
}

function formatResult(value: number): string {
  if (!Number.isFinite(value)) return 'Infinito (agora você viu a calculadora chorar)';
  if (Number.isNaN(value)) return 'NaN. Não, não é o "NaN" do seu grupo do WhatsApp.';
  const formatted = math.format(value, { precision: 14 });
  return formatted;
}

function isBasicExpression(expression: string): boolean {
  return BASIC_EXPR_RE.test(expression);
}

export function evaluate(user: UserRow, expression: string): CalcResult {
  const full = hasFullAccess(user);
  const trimmed = expression.trim();

  if (!trimmed) {
    return { result: '', usedCredit: false, full, error: 'Digite algo, a calculadora não é vidente.' };
  }

  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    return {
      result: '',
      usedCredit: false,
      full,
      error: `Expressão longa demais (máximo ${MAX_EXPRESSION_LENGTH} caracteres). Menos é mais, como o seu raciocínio.`,
    };
  }

  if (BLOCKED_FUNCTIONS.test(trimmed)) {
    return {
      result: '',
      usedCredit: false,
      full,
      error: 'Essa função não está no cardápio. O mathjs é poderoso, mas a gente não deixa ele brincar com fogo.',
    };
  }

  if (!full) {
    if (user.credits <= 0) {
      return {
        result: '',
        usedCredit: false,
        full,
        error: 'Sem créditos! Resgata teu crédito diário no painel ou paga os R$5 e usa à vontade.',
      };
    }
    if (!isBasicExpression(trimmed)) {
      return {
        result: '',
        usedCredit: false,
        full,
        error: 'Funções avançadas (sin, cos, log, √, π...) são exclusivas do plano pago. Cientistas pagam R$5/mês, assim como você. (ou R$1 na semana, ou R$50 pra sempre)',
      };
    }
  }

  try {
    const evaluated = math.evaluate(trimmed);
    let result: string;
    if (typeof evaluated === 'number') {
      result = formatResult(evaluated);
    } else if (Array.isArray(evaluated)) {
      result = `[${evaluated.map((v) => (typeof v === 'number' ? formatResult(v) : String(v))).join(', ')}]`;
    } else {
      result = math.format(evaluated, { precision: 14 });
    }

    let usedCredit = false;
    if (!full) {
      db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ?').run(user.id);
      user.credits -= 1;
      usedCredit = true;
    }

    db.prepare('INSERT INTO calc_usage (user_id, expression, credits_used, created_at) VALUES (?, ?, ?, ?)')
      .run(user.id, trimmed.slice(0, 500), usedCredit ? 1 : 0, Date.now());

    return { result, usedCredit, full, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      result: '',
      usedCredit: false,
      full,
      error: `Erro: ${message}. Nem a calculadora mais completa do mundo conseguiu com isso.`,
    };
  }
}
