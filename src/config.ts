import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 6000),
  sessionSecret: process.env.SESSION_SECRET || 'trocame-isso-ou-vai-ser-hackeado-por-um-chucknorris',
  mpAccessToken: process.env.MP_ACCESS_TOKEN || '',
  mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || '',
  openRouterKey: process.env.OPENROUTER_KEY || '',
  openRouterModel: process.env.OPENROUTER_MODEL || 'inclusionai/ling-3.0-flash:free',
  openRouterFallbackModels: (process.env.OPENROUTER_FALLBACK_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
  emailHost: process.env.EMAIL_HOST || '',
  emailPort: Number(process.env.EMAIL_PORT || 587),
  emailUser: process.env.EMAIL_USER || '',
  emailPass: process.env.EMAIL_PASS || '',
  emailFrom: process.env.EMAIL_FROM || process.env.EMAIL_USER || '',
  reminderIntervalHours: Number(process.env.REMINDER_INTERVAL_HOURS || 6),
  reminderMinDays: Number(process.env.REMINDER_MIN_DAYS || 3),
  appUrl: process.env.APP_URL || `http://localhost:${Number(process.env.PORT || 6000)}`,
  dbPath: process.env.DB_PATH || './data/db.sqlite',
  maxQuestionLength: 1000,
  aiSolveCredits: 3,
  aiDailyLimit: 30,
  secureCookies:
    process.env.SECURE_COOKIES === 'true'
      ? true
      : process.env.SECURE_COOKIES === 'false'
        ? false
        : (process.env.APP_URL || '').startsWith('https'),
};

const DEFAULT_SECRET = 'trocame-isso-ou-vai-ser-hackeado-por-um-chucknorris';
if (config.env === 'production' && config.sessionSecret === DEFAULT_SECRET) {
  throw new Error('Define SESSION_SECRET no .env antes de ir pra produção. O padrão é só pra dev.');
}

export const PLANS = {
  semanal: {
    id: 'semanal',
    title: 'Plano Semanal',
    price: 1,
    days: 7,
    tag: '1 real/semana',
  },
  mensal: {
    id: 'mensal',
    title: 'Plano Mensal',
    price: 5,
    days: 30,
    tag: '5 reais/mês',
  },
  vitalicio: {
    id: 'vitalicio',
    title: 'Plano Vitalício',
    price: 50,
    days: Infinity,
    tag: '50 reais pra sempre',
  },
} as const;

export type PlanId = keyof typeof PLANS;

export const FREE_DAILY_CREDITS = 1;
