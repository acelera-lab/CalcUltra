import { config } from './config.js';
import { db, UserRow } from './db.js';
import { getPlanInfo } from './plans.js';
import { emailConfig, sendMail, planExpiredEmail, upgradeReminderEmail } from './mailer.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function runReminderCycle(): void {
  if (!emailConfig().configured) return;

  const now = Date.now();
  const minInterval = config.reminderMinDays * DAY_MS;
  const users = db.prepare('SELECT * FROM users').all() as UserRow[];

  for (const user of users) {
    const last = user.last_reminder_at ?? 0;
    if (now - last < minInterval) continue;

    const info = getPlanInfo(user);
    let mail: { subject: string; html: string } | null = null;
    if (info.status === 'expired') {
      mail = planExpiredEmail(user);
    } else if (user.plan === 'free') {
      mail = upgradeReminderEmail(user);
    }
    if (!mail) continue;

    sendMail(user.email, mail.subject, mail.html).then((result) => {
      if (result.sent) {
        db.prepare('UPDATE users SET last_reminder_at = ? WHERE id = ?').run(now, user.id);
      }
    });
  }
}

export function startReminderScheduler(): void {
  const interval = config.reminderIntervalHours * 60 * 60 * 1000;
  const firstRunIn = Math.min(30_000, interval);
  setTimeout(runReminderCycle, firstRunIn);
  setInterval(runReminderCycle, interval);
}
