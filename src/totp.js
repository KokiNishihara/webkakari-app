// 管理画面の二段階認証（Google Authenticator 等の6桁コード／RFC 6238）。外部ライブラリなし。
import { createHmac, randomBytes } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret() {
  const bytes = randomBytes(20);
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function decode(secret) {
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function code(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
// 前後30秒のずれまで許す
export function verifyTotp(secret, token) {
  const t = Math.floor(Date.now() / 30000);
  const s = String(token || '').replace(/\s/g, '');
  return [-1, 0, 1].some((d) => code(secret, t + d) === s);
}
export const otpauthUrl = (secret, email) =>
  `otpauth://totp/${encodeURIComponent('Web係 管理:' + email)}?secret=${secret}&issuer=${encodeURIComponent('Web係 管理')}`;
