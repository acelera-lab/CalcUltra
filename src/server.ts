import { app } from './app.js';
import { config } from './config.js';
import { paymentConfig } from './mercadopago.js';
import { emailConfig } from './mailer.js';
import { startReminderScheduler } from './reminders.js';

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.listen(config.port, () => {
  console.log(`CalcUltra Deluxe Edition rodando em ${config.appUrl}`);
  if (!paymentConfig().configured) {
    console.log('⚠️  Mercado Pago NÃO configurado — pagamentos em modo simulado (coloca MP_ACCESS_TOKEN no .env)');
  }
  if (!emailConfig().configured) {
    console.log('⚠️  SMTP NÃO configurado — emails de lembrete em modo simulado (coloca EMAIL_HOST no .env)');
  } else {
    startReminderScheduler();
  }
});
