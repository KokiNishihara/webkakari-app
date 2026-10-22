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

-- 口座振替・請求書払いの入金の記録（カード払いは Stripe の請求書から読む）
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  month TEXT NOT NULL,                  -- 'YYYY-MM'（何月分か）
  amount INTEGER NOT NULL,
  paid_on TEXT NOT NULL,                -- 入金日 YYYY-MM-DD
  note TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (customer_id, month)
);

-- 小さな設定値（Stripeの商品IDなど）
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
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
for (const [table, col, def] of [
  ['admins', 'totp_secret', 'TEXT'],
  ['customers', 'billing_json', 'TEXT'],          // 料金の条件（商品・追加・値引き・初期費用）
  ['customers', 'state_codes', 'TEXT'],           // 契約前の状態（社内用の状態別プラン表の記号 例：A3,B1,C1）
  ['customers', 'stripe_customer_id', 'TEXT'],
  ['customers', 'stripe_subscription_id', 'TEXT'],
  ['customers', 'billed_json', 'TEXT'],           // いまStripeで請求している内容（変更の差分確認用）
  ['customers', 'terms_agreed_at', 'INTEGER'],    // 利用規約・特商法への同意（決済画面で記録）
  ['customers', 'pending_quote_json', 'TEXT'],
  ['customers', 'cancel_at', 'TEXT'],             // 解約日（YYYY-MM-DD）。この日で請求と提供を終える
  ['customers', 'cancel_reason', 'TEXT'],
  ['customers', 'cancel_requested_at', 'INTEGER'], // お客さまがマイページから解約を申し込んだ日時
  ['customers', 'cancel_request_note', 'TEXT'],     // 申し込み時の希望日・理由
  ['requests', 'admin_flag', 'INTEGER NOT NULL DEFAULT 0'],
  ['requests', 'layout_issues', 'TEXT'],
  ['requests', 'reminded_at', 'INTEGER'],         // 確認待ちのお知らせを送った日時（1回だけ）          // 確認画面のスマホ幅点検で見つかった崩れ（あれば公開を止める）  // 一部だけ自動でできた依頼（担当者の対応が残っている）    // 決済リンクを送った時点の見積り（決済完了でこの内容を請求中にする）
]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export const getSetting = (k) => one('SELECT v FROM settings WHERE k = ?', k)?.v ?? null;
export const setSetting = (k, v) => run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v));
