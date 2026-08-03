import nodemailer from 'nodemailer';
import { config } from './config.js';
import { UserRow } from './db.js';

export function emailConfig() {
  return {
    configured: Boolean(config.emailHost && config.emailUser && config.emailPass && config.emailFrom),
  };
}

let transport: nodemailer.Transporter | null = null;
function getTransport(): nodemailer.Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.emailHost,
      port: config.emailPort,
      secure: config.emailPort === 465,
      auth: { user: config.emailUser, pass: config.emailPass },
    });
  }
  return transport;
}

export interface MailResult {
  sent: boolean;
  simulated?: boolean;
  error?: unknown;
}

export async function sendMail(to: string, subject: string, html: string): Promise<MailResult> {
  if (!emailConfig().configured || config.env === 'test') {
    if (!emailConfig().configured && config.env !== 'test') {
      console.log(`[mailer] (simulado, sem SMTP) para=${to} assunto="${subject}"`);
    }
    return { sent: true, simulated: true };
  }
  try {
    await getTransport().sendMail({ from: config.emailFrom, to, subject, html });
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mailer] erro ao enviar para ${to}: ${msg}`);
    return { sent: false, error: err };
  }
}

const layout = (title: string, body: string, prefsLink = true): string => `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#F5F0EB;font-family:Montserrat,Arial,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0EB;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#FFFFFF;border:3px solid #1A1A1A;border-radius:12px;box-shadow:6px 6px 0 0 #1A1A1A;">
          <tr>
            <td style="padding:8px 12px;background:#1E4FE8;border-bottom:3px solid #1A1A1A;border-radius:9px 9px 0 0;">
              <p style="margin:0;font-size:11px;letter-spacing:3px;color:#FFFFFF;font-weight:700;text-transform:uppercase;">CalcUltra Deluxe Edition</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;">
              <h1 style="margin:0 0 16px;font-size:26px;font-weight:900;line-height:1.15;">${title}</h1>
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 24px;border-top:3px solid #1A1A1A;">
              <p style="margin:0;font-size:11px;line-height:1.8;color:#4A4A4A;">
                CalcUltra Deluxe Edition — a calculadora mais completa do mundo.<br/>
                Pagamento via Pix, sem cartão, sem burocracia.
              </p>
              ${prefsLink ? `<p style="margin:10px 0 0;font-size:10px;color:#4A4A4A;"><a href="${config.appUrl}/conta/deletar" style="color:#4A4A4A;">Não quer mais receber emails da gente? Deletar minha conta</a></p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const cta = (url: string, label: string): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 24px;">
    <tr>
      <td style="background:#F5C518;border:3px solid #1A1A1A;border-radius:9999px;box-shadow:4px 4px 0 0 #1A1A1A;">
        <a href="${url}" style="display:inline-block;padding:12px 28px;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1A1A1A;text-decoration:none;">${label}</a>
      </td>
    </tr>
  </table>`;

const planChips = (): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;">
    <tr>
      <td style="background:#2EC4B6;border:3px solid #1A1A1A;border-radius:9999px;padding:6px 14px;font-size:12px;font-weight:700;color:#1A1A1A;">SEMANAL R$ 1</td>
      <td style="width:8px;"></td>
      <td style="background:#F5C518;border:3px solid #1A1A1A;border-radius:9999px;padding:6px 14px;font-size:12px;font-weight:700;color:#1A1A1A;">MENSAL R$ 5</td>
      <td style="width:8px;"></td>
      <td style="background:#1A1A1A;border:3px solid #1A1A1A;border-radius:9999px;padding:6px 14px;font-size:12px;font-weight:700;color:#F5F0EB;">VITALÍCIA R$ 50</td>
    </tr>
  </table>`;

export function welcomeEmail(user: UserRow): { subject: string; html: string } {
  const subject = 'Bem-vindo à CalcUltra. Aqui começa o apelo comercial.';
  const html = layout(
    `Bem-vindo, ${user.username}!`,
    `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#4A4A4A;">
      Sua conta gratuita está no ar: 1 crédito por dia, resgatado todo santo dia.
      Suficiente para contas básicas — mas não para a vida.
    </p>
    <p style="margin:0 0 8px;font-size:14px;font-weight:700;">Edições pagas, sem limite de uso:</p>
    ${planChips()}
    ${cta(`${config.appUrl}/planos`, 'Conhecer as edições')}
    <p style="margin:0;font-size:12px;line-height:1.7;color:#4A4A4A;">
      Tudo via Pix. Ativa sozinha quando o pagamento cai. E sim, dá pra renovar sem cartão na mão.
    </p>
    `,
  );
  return { subject, html };
}

export function planExpiredEmail(user: UserRow): { subject: string; html: string } {
  const subject = 'Sua edição expirou. A calculadora sente sua falta.';
  const html = layout(
    `Sua edição acabou, ${user.username}.`,
    `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#4A4A4A;">
      O acesso completo expirou e você voltou ao mundo real: 1 crédito por dia.
      Não precisa ser assim. A edição semanal custa R$ 1 — menos que uma coxinha.
    </p>
    ${cta(`${config.appUrl}/planos`, 'Voltar ao acesso completo')}
    <p style="margin:0;font-size:12px;line-height:1.7;color:#4A4A4A;">
      Sem assinatura recorrente, sem fidelidade. Você paga quando quiser, via Pix.
    </p>
    `,
  );
  return { subject, html };
}

export function upgradeReminderEmail(user: UserRow): { subject: string; html: string } {
  const subject = 'Lembrete amigável: as edições pagas continuam existindo.';
  const html = layout(
    `Oi, ${user.username}. É um lembrete, não uma cobrança.`,
    `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#4A4A4A;">
      Você está na edição gratuita. Ela é boa. As pagas são melhores:
      calculadora completa, sem limite, com todas as funções científicas liberadas.
    </p>
    ${planChips()}
    ${cta(`${config.appUrl}/planos`, 'Ver as edições')}
    <p style="margin:0;font-size:12px;line-height:1.7;color:#4A4A4A;">
      Se nunca for assinar, tudo bem também. A calculadora continua lá, gratuita, digna.
    </p>
    `,
  );
  return { subject, html };
}
