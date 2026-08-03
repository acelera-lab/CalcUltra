import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import session from 'express-session';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_at INTEGER,
  credits INTEGER NOT NULL DEFAULT 0,
  last_credit_claim TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan TEXT NOT NULL,
  mp_payment_id INTEGER UNIQUE,
  mp_preference_id TEXT,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS calc_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  expression TEXT NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'calc',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`);

const usageCols = db.prepare('PRAGMA table_info(calc_usage)').all() as { name: string }[];
if (!usageCols.some((c) => c.name === 'source')) {
  db.exec("ALTER TABLE calc_usage ADD COLUMN source TEXT NOT NULL DEFAULT 'calc'");
}

const userCols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
if (!userCols.some((c) => c.name === 'last_reminder_at')) {
  db.exec('ALTER TABLE users ADD COLUMN last_reminder_at INTEGER');
}

export interface UserRow {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  plan: string;
  plan_expires_at: number | null;
  credits: number;
  last_credit_claim: string | null;
  created_at: number;
  last_reminder_at: number | null;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export class SqliteSessionStore extends session.Store {
  get(sid: string, cb: (err: unknown, session?: session.SessionData | null) => void): void {
    try {
      const row = db
        .prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?')
        .get(sid, Date.now()) as { sess: string } | undefined;
      if (!row) return cb(null, null);
      cb(null, JSON.parse(row.sess) as session.SessionData);
    } catch (err) {
      cb(err);
    }
  }

  set(sid: string, sess: session.SessionData, cb?: (err?: unknown) => void): void {
    try {
      let expires = Date.now() + SESSION_TTL_MS;
      if (sess.cookie?.expires) {
        const t = new Date(sess.cookie.expires).getTime();
        if (Number.isFinite(t)) expires = t;
      }
      db.prepare(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
      ).run(sid, JSON.stringify(sess), expires);
      db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid: string, cb?: (err?: unknown) => void): void {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb?.();
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid: string, sess: session.SessionData, cb?: () => void): void {
    this.set(sid, sess, cb);
  }
}
