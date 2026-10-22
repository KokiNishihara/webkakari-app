// パスワードは scrypt でハッシュ化して保存（元に戻せない）。ログインは連続失敗で一時ロック。
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { one, run, now } from './db.js';

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

// 全角で入力されても受け付ける（日本語入力オンのまま打つ方が多いため）
export const normalizeInput = (v) => String(v ?? '').normalize('NFKC').trim();

export function hashPassword(pw) {
  pw = normalizeInput(pw);
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  if (!stored) return false;
  pw = normalizeInput(pw);
  const [, saltHex, hashHex] = stored.split('$');
  const hash = scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

// パスワードの決まり：8文字以上・英字と数字を両方含む
export function passwordProblem(pw) {
  pw = normalizeInput(pw);
  if (!pw || pw.length < 8) return '8文字以上にしてください';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return '英字と数字を両方入れてください';
  return null;
}

export const newToken = () => randomBytes(32).toString('base64url');

// table: 'customers' | 'admins'
export function attemptLogin(table, email, pw) {
  const user = one(`SELECT * FROM ${table} WHERE email = ?`, normalizeInput(email).toLowerCase());
  if (!user) return { ok: false, msg: 'メールアドレスかパスワードが違います。入力が全角になっていないか、スペースが入っていないかもご確認ください' };
  if (user.locked_until && user.locked_until > now()) {
    const min = Math.ceil((user.locked_until - now()) / 60000);
    return { ok: false, msg: `ログインに続けて失敗したため、${min}分ほどお待ちください` };
  }
  if (!user.password_hash) return { ok: false, msg: 'まだパスワードが設定されていません。届いたメールのリンクから設定してください' };
  if (!verifyPassword(pw, user.password_hash)) {
    const failed = user.failed_count + 1;
    run(`UPDATE ${table} SET failed_count = ?, locked_until = ? WHERE id = ?`,
      failed >= LOCK_AFTER ? 0 : failed, failed >= LOCK_AFTER ? now() + LOCK_MS : null, user.id);
    return { ok: false, msg: 'メールアドレスかパスワードが違います。入力が全角になっていないかもご確認ください' };
  }
  run(`UPDATE ${table} SET failed_count = 0, locked_until = NULL WHERE id = ?`, user.id);
  return { ok: true, user };
}

export function createSession(kind, userId) {
  const token = newToken();
  run('INSERT INTO sessions (token, kind, user_id, expires_at) VALUES (?,?,?,?)', token, kind, userId, now() + SESSION_MS);
  return token;
}

export function readSession(token, kind) {
  if (!token) return null;
  const s = one('SELECT * FROM sessions WHERE token = ? AND kind = ?', token, kind);
  if (!s || s.expires_at < now()) return null;
  return s;
}

export const destroySession = (token) => run('DELETE FROM sessions WHERE token = ?', token);

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MS,
    path: '/',
  };
}
