// 本番運用のための裏方の仕事：管理者の初回作成・再起動時の復旧・毎日のバックアップ・古いデータの掃除・確認待ちのリマインド
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { db, one, all, run, now, audit } from './db.js';
import { hashPassword } from './auth.js';
import { sendMail, mails } from './mail.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = 14;

// 本番の最初の起動で、ADMIN_EMAIL / ADMIN_PASSWORD から管理者を1人だけ作る（すでにいれば何もしない）
export function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').normalize('NFKC').trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || '';
  if (one('SELECT id FROM admins LIMIT 1')) return;
  if (!email || pw.length < 12) {
    console.warn('[管理者が未作成] ADMIN_EMAIL と ADMIN_PASSWORD（12文字以上）を設定して再起動してください');
    return;
  }
  run('INSERT INTO admins (email, password_hash, created_at) VALUES (?,?,?)', email, hashPassword(pw), now());
  audit('system', 'admin-bootstrap', email);
  console.log(`管理者を作成しました：${email}（初回ログイン時に二段階認証を設定します。作成後は ADMIN_PASSWORD を消してください）`);
}

// サーバーが作業中に再起動すると「作成中」のまま止まるので、起動時に担当者へ回す
export function recoverStuck() {
  const stuck = all(`SELECT * FROM requests WHERE status = 'working' AND updated_at < ?`, now() - 3 * 60 * 1000);
  for (const r of stuck) {
    run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'failed', now(), r.id);
    audit('system', 'recover-stuck', `request=${r.id}`);
  }
  if (stuck.length) console.warn(`[復旧] 作成中のまま止まっていた依頼 ${stuck.length} 件を「担当者が対応」に回しました`);
}

// DB のバックアップ（同じディスク内に14日分。Render の永続ディスクは別途、毎日スナップショットが取られる）
export function backupNow() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `app-${new Date().toISOString().slice(0, 10)}.db`;
  const file = path.join(BACKUP_DIR, name);
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const files = readdirSync(BACKUP_DIR).filter((f) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) rmSync(path.join(BACKUP_DIR, f), { force: true });
  return { name, size: statSync(file).size };
}
export const listBackups = () => {
  try { return readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort().reverse().map((f) => ({ name: f, size: statSync(path.join(BACKUP_DIR, f)).size })); }
  catch { return []; }
};

// 期限切れのログイン・リンクを消す
function cleanup() {
  run('DELETE FROM sessions WHERE expires_at < ?', now());
  run('DELETE FROM tokens WHERE expires_at < ?', now() - 30 * 24 * 3600 * 1000); // 切れてから30日たったリンク
}

// 確認待ちのまま2日たった依頼に、1回だけお知らせを送る（公開は承認したものだけ。利用規約 第6条）
function remindReviews(baseUrl) {
  const rows = all(`SELECT r.*, c.email, c.contact_name, c.business_type FROM requests r JOIN customers c ON c.id = r.customer_id
    WHERE r.status = 'review' AND r.layout_issues IS NULL AND r.updated_at < ? AND r.reminded_at IS NULL`, now() - 48 * 3600 * 1000);
  for (const r of rows) {
    sendMail(mails.reviewReminder(r, `${baseUrl}/app/r/${r.id}`));
    run('UPDATE requests SET reminded_at = ? WHERE id = ?', now(), r.id);
  }
}

// 解約日を過ぎた契約者を「解約」にする（ログイン・HPの表示を止める。データと版は残すので、再開や引き渡しもできる）
function applyCancellations() {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // 日本時間の今日
  for (const c of all(`SELECT * FROM customers WHERE cancel_at IS NOT NULL AND cancel_at < ? AND status != 'canceled'`, today)) {
    run(`UPDATE customers SET status = 'canceled', payment_status = CASE WHEN payment_status = 'active' THEN 'canceled' ELSE payment_status END WHERE id = ?`, c.id);
    run('DELETE FROM sessions WHERE kind = ? AND user_id = ?', 'customer', c.id);
    audit('system', 'canceled', `${c.id} ${c.cancel_at}`);
    sendMail(mails.adminNotice(`【解約】${c.business_name}（${c.cancel_at}）の提供を終了しました`, '管理画面で確認してください。HPのデータと版は残しています。'));
  }
}

// 1時間ごとに掃除とリマインド、1日1回バックアップ
export function startJobs({ baseUrl }) {
  let lastBackupDay = '';
  const tick = () => {
    try {
      cleanup();
      remindReviews(baseUrl);
      applyCancellations();
      const day = new Date().toISOString().slice(0, 10);
      if (day !== lastBackupDay) { const b = backupNow(); lastBackupDay = day; console.log(`[バックアップ] ${b.name}（${Math.round(b.size / 1024)}KB）`); }
    } catch (e) { console.error('[定期処理の失敗]', e.message); }
  };
  setTimeout(tick, 10 * 1000);
  setInterval(tick, 60 * 60 * 1000).unref();
}
