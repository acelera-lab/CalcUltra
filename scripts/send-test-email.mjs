import { config } from '../src/config.js';
import { sendMail } from '../src/mailer.js';

const to = process.argv[2] || 'flazo0@proton.me';

const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#F5F0EB;font-family:Montserrat,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0EB;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#FFFFFF;border:3px solid #1A1A1A;border-radius:12px;box-shadow:6px 6px 0 0 #1A1A1A;">
        <tr><td style="padding:8px 12px;background:#1E4FE8;border-bottom:3px solid #1A1A1A;">
          <p style="margin:0;font-size:11px;letter-spacing:3px;color:#FFFFFF;font-weight:700;text-transform:uppercase;">CalcUltra Deluxe Edition</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:26px;font-weight:900;">Email de teste</h1>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#4A4A4A;">
            Se você recebeu isso, o SMTP da CalcUltra está funcionando. Remetente:
            <strong>${config.emailFrom}</strong>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const result = await sendMail(to, 'Teste de email da CalcUltra', html);
console.log('para:', to);
console.log('remetente:', config.emailFrom || '(vazio)');
console.log('resultado:', JSON.stringify(result));
if (!result.sent) {
  console.log('Dica: verifica se o domínio do EMAIL_FROM existe e está verificado na Hostinger.');
}
process.exit(result.sent ? 0 : 1);
