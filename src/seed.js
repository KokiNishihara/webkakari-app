// 動作確認用の初期データ（管理者1名＋デモの契約者2件）。本番では使わない。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { one, run, now } from './db.js';
import { hashPassword } from './auth.js';
import { createVersion } from './sites.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin1234';
if (!one('SELECT id FROM admins WHERE email = ?', ADMIN_EMAIL)) {
  run('INSERT INTO admins (email, password_hash, created_at) VALUES (?,?,?)', ADMIN_EMAIL, hashPassword(ADMIN_PW), now());
  console.log(`管理者を作成: ${ADMIN_EMAIL} / ${ADMIN_PW}`);
}
for (const d of [
  { type: 'food', name: 'お食事処 みなと（デモ）', contact: '港', email: 'demo-food@example.com' },
  { type: 'clinic', name: 'あおば内科クリニック（デモ）', contact: '青葉', email: 'demo-clinic@example.com' },
]) {
  if (one('SELECT id FROM customers WHERE email = ?', d.email)) continue;
  const cid = Number(run(`INSERT INTO customers (business_name, business_type, contact_name, email, password_hash, status, payment_status, contract_start, min_term_end, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    d.name, d.type, d.contact, d.email, hashPassword('demo1234'), 'active', 'active', '2026-10-21', '2027-04-21', now()).lastInsertRowid);
  const slug = `demo-${d.type}`;
  const sid = Number(run('INSERT INTO sites (customer_id, slug, created_at) VALUES (?,?,?)', cid, slug, now()).lastInsertRowid);
  const site = one('SELECT * FROM sites WHERE id = ?', sid);
  const html = readFileSync(path.resolve(`templates/${d.type}.html`), 'utf8').replaceAll('{{NAME}}', d.name);
  const hero = path.resolve(`templates/hero-${d.type}.jpg`);
  const vid = createVersion({ site, parentId: null, html, note: 'ひな形', createdBy: 'seed', extraFiles: existsSync(hero) ? [{ relPath: 'assets/hero.jpg', buffer: readFileSync(hero) }] : [] });
  run('UPDATE sites SET live_version_id = ? WHERE id = ?', vid, sid);
  console.log(`デモ契約者: ${d.email} / demo1234`);
}
