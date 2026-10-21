// SQLite（Node 組み込みの node:sqlite）。本番では Render の永続ディスクに置く。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL
);

-- 契約者（お店・医院）
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  business_name TEXT NOT NULL,          -- 店名・医院名
  business_type TEXT NOT NULL,          -- 'food' | 'clinic'
  contact_name TEXT NOT NULL,           -- ご担当者名
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT,                   -- 初回設定前は NULL
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  plan TEXT NOT NULL DEFAULT 'hp',      -- hp / hp+gmap / ...（カンマ区切り）
  monthly_fee INTEGER NOT NULL DEFAULT 9800,
  payment_method TEXT NOT NULL DEFAULT 'card', -- card / bank_debit / invoice
  payment_status TEXT NOT NULL DEFAULT 'pending', -- pending / active / past_due / canceled
  contract_start TEXT,                  -- 公開日（最低期間の起算日）YYYY-MM-DD
  min_term_end TEXT,                    -- 最低利用期間の終了日
  status TEXT NOT NULL DEFAULT 'onboarding', -- onboarding / active / canceled
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  slug TEXT UNIQUE NOT NULL,            -- 配信用の識別子
  domain TEXT,                          -- 独自ドメイン（任意）
  live_version_id INTEGER,              -- 本番で公開中の版
  created_at INTEGER NOT NULL
);

-- 版（すべての変更を残す。取り消しはこの中から選び直すだけ）
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  parent_id INTEGER,
  request_id INTEGER,
  note TEXT,
  created_by TEXT NOT NULL,             -- 'ai' | 'admin' | 'seed'
  created_at INTEGER NOT NULL
);

-- 修正の依頼（チャットの1スレッド）
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  site_id INTEGER NOT NULL REFERENCES sites(id),
  status TEXT NOT NULL,                 -- working / review / published / needs_admin / failed / discarded
  preview_version_id INTEGER,
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  sender TEXT NOT NULL,                 -- 'customer' | 'system' | 'admin'
  body TEXT NOT NULL,
  data TEXT,                            -- JSON（変更点の一覧など）
  image_path TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                   -- 'customer' | 'admin'
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (    -- 初回パスワード設定・再設定のリンク
  token TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  purpose TEXT NOT NULL,                -- 'invite' | 'reset'
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
`);

export const now = () => Date.now();
export const one = (sql, ...a) => db.prepare(sql).get(...a);
export const all = (sql, ...a) => db.prepare(sql).all(...a);
export const run = (sql, ...a) => db.prepare(sql).run(...a);
export const audit = (actor, action, detail = '') =>
  run('INSERT INTO audit_log (actor, action, detail, created_at) VALUES (?,?,?,?)', actor, action, String(detail), now());

// 追加の列（既存DBにも安全に足す）
for (const [table, col, def] of [['admins', 'totp_secret', 'TEXT']]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
