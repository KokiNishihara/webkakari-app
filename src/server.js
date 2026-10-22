import express from 'express';
import path from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { db, one, all, run, now, audit } from './db.js';
import { hashPassword, passwordProblem, attemptLogin, createSession, readSession, destroySession, cookieOptions, newToken } from './auth.js';
import { extractRegions, applyChanges, readVersionHtml, createVersion, publishVersion, versionDir, SITES_DIR } from './sites.js';
import { proposeChanges, guidelineCheck } from './ai.js';
import * as V from './views.js';
import { sendMail, mails } from './mail.js';
import { newSecret, verifyTotp, otpauthUrl } from './totp.js';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { ensureAdmin, recoverStuck, startJobs, backupNow, listBackups, BACKUP_DIR } from './jobs.js';
import { computeQuote, readBillingForm } from './pricing.js';
import { stripeMode, startCheckout, syncCheckout, markPaid, portalUrl, applyToSubscription, addOneTimeCharge, verifyWebhook, handleEvent } from './billing.js';

const app = express();
const PORT = Number(process.env.PORT || 4900);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MAX_REQUESTS_PER_HOUR = 20; // AI費用の暴走を防ぐ

app.disable('x-powered-by');
app.set('trust proxy', 1); // Render の前段（ロードバランサー）越しに https とお客さまのIPを正しく扱う
const APP_HOST = new URL(BASE_URL).host;

// 死活確認（Render のヘルスチェック用）。DB が読めることまで確かめる
app.get('/healthz', (req, res) => { try { one('SELECT 1 AS ok'); res.send('ok'); } catch { res.status(500).send('db error'); } });

// 営業用のサービスサイト（院のWeb係・飲食店のWeb係）。SERVICE_DOMAIN_CLINIC / SERVICE_DOMAIN_FOOD のドメインで来たら返す。
// 中身は scripts/sync-service-sites.mjs で service-sites/ に取り込んだもの。確認用に /service/clinic/・/service/food/ でも見られる
const SERVICE_DIR = path.resolve('service-sites');
const serviceDomains = () => Object.fromEntries([['clinic', process.env.SERVICE_DOMAIN_CLINIC], ['food', process.env.SERVICE_DOMAIN_FOOD]]
  .filter(([, d]) => d).flatMap(([k, d]) => [[d.toLowerCase(), k], [`www.${d.toLowerCase()}`, k]]));
function sendServiceSite(req, res, key, relPath, origin) {
  const rel = decodeURIComponent(relPath).replace(/^\/+/, '') || 'index.html';
  if (rel.includes('..')) return res.status(400).end();
  const file = rel.endsWith('/') ? rel + 'index.html' : rel;
  const full = path.join(SERVICE_DIR, key, file);
  if (!full.startsWith(path.join(SERVICE_DIR, key)) || !existsSync(full)) return res.status(404).send(V.notFound());
  if (file.endsWith('.html')) {
    // OGP の画像は絶対URLでないとSNSで表示されないため、配信時に書き換える
    const html = readFileSync(full, 'utf8').replace(/content="assets\//g, `content="${origin}/assets/`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.type('html').send(html);
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(full);
}
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  const key = serviceDomains()[host];
  if (!key) return next();
  if (host.startsWith('www.')) return res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`);
  sendServiceSite(req, res, key, req.path, `https://${host}`);
});
app.get(['/service/:key', '/service/:key/*'], (req, res) => {
  const key = ['clinic', 'food'].includes(req.params.key) ? req.params.key : null;
  if (!key) return res.status(404).send(V.notFound());
  if (!req.params[0] && !req.path.endsWith('/')) return res.redirect(`/service/${key}/`);
  res.setHeader('X-Robots-Tag', 'noindex'); // 確認用のURLは検索に出さない
  sendServiceSite(req, res, key, req.params[0] || '', BASE_URL + `/service/${key}`);
});

// お客さまの独自ドメインで来たアクセスは、そのお店のHP（公開中の版）を返す
// 例：minato-shokudo.jp を DNS でこのサーバーに向け、管理画面の「独自ドメイン」に登録すると表示される
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (!host || host === APP_HOST.split(':')[0] || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.onrender.com')) return next();
  const bare = host.replace(/^www\./, '');
  const site = one('SELECT * FROM sites WHERE domain = ? OR domain = ?', bare, host);
  if (!site?.live_version_id) return res.status(404).send(V.notFound());
  if (host.startsWith('www.') && site.domain === bare) return res.redirect(301, `https://${bare}${req.originalUrl}`);
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  const rel = decodeURIComponent(req.path).replace(/^\/+/, '') || 'index.html';
  if (rel.includes('..')) return res.status(400).end();
  res.setHeader('Cache-Control', rel.endsWith('.html') ? 'public, max-age=60' : 'public, max-age=86400');
  res.sendFile(rel.endsWith('/') ? rel + 'index.html' : rel, { root: versionDir(site.slug, site.live_version_id), dotfiles: 'deny' }, (err) => { if (err && !res.headersSent) res.status(404).send(V.notFound()); });
});

// Stripe からの通知は、署名の確認のため加工前の本文で受け取る（JSONの読み込みより前に置く）
app.post('/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  let event;
  try { event = verifyWebhook(req.body, req.headers['stripe-signature']); }
  catch (e) { console.warn('[Stripe通知の確認に失敗]', e.message); return res.status(400).send('invalid'); }
  try { handleEvent(event, { onPaymentFailed: notifyPaymentFailed }); } catch (e) { console.error('[Stripe通知の処理に失敗]', e); }
  res.json({ received: true });
});
function notifyPaymentFailed(c) {
  sendMail(mails.paymentFailed(c, `${BASE_URL}/app/billing`));
  sendMail(mails.adminNotice(`【要確認】${c.business_name} の月額の決済に失敗しました`, `${BASE_URL}/admin/customers/${c.id}`));
}

app.use(express.urlencoded({ extended: false, limit: '6mb' }));
app.use(express.json({ limit: '8mb' }));
app.use('/static', express.static(path.resolve('public'), { maxAge: '1h' }));

// --- 共通：Cookie と CSRF 対策（POSTは同じサイトからのみ受け付ける）
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1))]; }));
app.use((req, res, next) => {
  req.cookies = cookies(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // 管理画面・マイページは他サイトに埋め込ませない（確認画面のiframeは同じサイトなので可）
  if (!req.path.startsWith('/s/')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return res.status(403).send('不正なリクエストです');
  }
  next();
});
const setFlash = (res, type, msg) => res.cookie('flash', JSON.stringify({ type, msg }), { maxAge: 10000, path: '/', sameSite: 'lax' });
const takeFlash = (req, res) => { if (!req.cookies.flash) return null; res.clearCookie('flash', { path: '/' }); try { return JSON.parse(req.cookies.flash); } catch { return null; } };

const requireCustomer = (req, res, next) => {
  const s = readSession(req.cookies.sid, 'customer');
  if (!s) return res.redirect('/login');
  req.customer = one('SELECT * FROM customers WHERE id = ?', s.user_id);
  if (!req.customer || req.customer.status === 'canceled') return res.redirect('/login');
  next();
};
const requireAdmin = (req, res, next) => {
  const s = readSession(req.cookies.asid, 'admin');
  if (!s) return res.redirect('/admin/login');
  req.admin = one('SELECT * FROM admins WHERE id = ?', s.user_id);
  next();
};

// ================= お客さま：ログイン =================
app.get('/', (req, res) => res.redirect('/app'));
app.get('/login', (req, res) => res.send(V.loginPage({ flash: takeFlash(req, res) })));
app.post('/login', (req, res) => {
  const r = attemptLogin('customers', req.body.email, req.body.password);
  if (!r.ok) return res.status(401).send(V.loginPage({ flash: { type: 'err', msg: r.msg }, email: req.body.email }));
  if (r.user.status === 'canceled') return res.status(403).send(V.loginPage({ flash: { type: 'err', msg: 'ご契約が終了しているため、ログインできません' } }));
  res.cookie('sid', createSession('customer', r.user.id), cookieOptions());
  audit(`customer:${r.user.id}`, 'login');
  res.redirect('/app');
});
app.post('/logout', (req, res) => { destroySession(req.cookies.sid); res.clearCookie('sid', { path: '/' }); res.redirect('/login'); });

function validToken(token) {
  const t = one('SELECT * FROM tokens WHERE token = ?', String(token || ''));
  if (!t || t.used_at || t.expires_at < now()) return null;
  return t;
}
app.get('/set-password', (req, res) => {
  const t = validToken(req.query.token);
  if (!t) return res.send(V.loginPage({ flash: { type: 'err', msg: 'リンクの有効期限が切れています。お手数ですが、もう一度お申し込みください' } }));
  const c = one('SELECT * FROM customers WHERE id = ?', t.customer_id);
  res.send(V.setPasswordPage({ token: t.token, name: c.contact_name, purpose: t.purpose }));
});
app.post('/set-password', (req, res) => {
  const t = validToken(req.body.token);
  if (!t) return res.redirect('/login');
  const c = one('SELECT * FROM customers WHERE id = ?', t.customer_id);
  const problem = passwordProblem(req.body.password) || (String(req.body.password).normalize('NFKC') !== String(req.body.password2).normalize('NFKC') ? '2回の入力が一致しません' : null);
  if (problem) return res.status(400).send(V.setPasswordPage({ token: t.token, name: c.contact_name, purpose: t.purpose, flash: { type: 'err', msg: problem } }));
  run('UPDATE customers SET password_hash = ?, failed_count = 0, locked_until = NULL WHERE id = ?', hashPassword(req.body.password), c.id);
  run('UPDATE tokens SET used_at = ? WHERE token = ?', now(), t.token);
  run('DELETE FROM sessions WHERE kind = ? AND user_id = ?', 'customer', c.id);
  audit(`customer:${c.id}`, 'set-password', t.purpose);
  res.cookie('sid', createSession('customer', c.id), cookieOptions());
  setFlash(res, 'ok', 'パスワードを設定しました');
  res.redirect('/app');
});
app.get('/forgot', (req, res) => res.send(V.forgotPage({})));
app.post('/forgot', (req, res) => {
  const c = one('SELECT * FROM customers WHERE email = ?', String(req.body.email || '').normalize('NFKC').trim().toLowerCase());
  if (c) {
    const token = newToken();
    run('INSERT INTO tokens (token, customer_id, purpose, expires_at) VALUES (?,?,?,?)', token, c.id, 'reset', now() + 60 * 60 * 1000);
    // TODO: メール送信（送信サービスを決めたら実装）。いまはサーバーのログに出す。
    sendMail(mails.reset(c, `${BASE_URL}/set-password?token=${token}`));
    audit(`customer:${c.id}`, 'reset-request');
  }
  // 登録の有無は答えない（メールアドレスの存在確認に悪用されないため）
  res.send(V.forgotPage({ flash: { type: 'ok', msg: 'ご登録のメールアドレスであれば、再設定のリンクをお送りしました（1時間有効）' } }));
});

// ================= お客さま：マイページ =================
const firstText = `(SELECT body FROM messages m WHERE m.request_id = r.id AND m.sender = 'customer' ORDER BY m.id LIMIT 1)`;
app.get('/app', requireCustomer, (req, res) => {
  const c = req.customer;
  const site = one('SELECT * FROM sites WHERE customer_id = ?', c.id);
  const requests = all(`SELECT r.*, ${firstText} AS first_text FROM requests r WHERE r.customer_id = ? ORDER BY r.updated_at DESC LIMIT 30`, c.id);
  res.send(V.homePage({ customer: c, site, requests, flash: takeFlash(req, res) }));
});

function previewInfo(r) {
  if (!r.preview_version_id) return null;
  const site = one('SELECT * FROM sites WHERE id = ?', r.site_id);
  const sys = one(`SELECT data FROM messages WHERE request_id = ? AND data IS NOT NULL ORDER BY id DESC LIMIT 1`, r.id);
  return { slug: site.slug, version_id: r.preview_version_id, data: sys ? JSON.parse(sys.data) : null };
}
function ownRequest(req) {
  return one('SELECT * FROM requests WHERE id = ? AND customer_id = ?', Number(req.params.id), req.customer.id);
}
app.get('/app/r/:id', requireCustomer, (req, res) => {
  const r = ownRequest(req); if (!r) return res.status(404).send(V.notFound());
  const messages = all('SELECT * FROM messages WHERE request_id = ? ORDER BY id', r.id);
  const p = r.status === 'published' ? { slug: one('SELECT slug FROM sites WHERE id = ?', r.site_id).slug } : previewInfo(r);
  res.send(V.requestPage({ customer: req.customer, request: r, messages, preview: p, flash: takeFlash(req, res) }));
});
app.get('/app/r/:id/status', requireCustomer, (req, res) => {
  const r = ownRequest(req); if (!r) return res.status(404).json({});
  res.json({ status: r.status });
});

// 写真は受け取った時点で ①向きを直す ②位置情報などの撮影データを消す ③大きすぎるものは縮める
async function saveImage(site, dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('写真の形式に対応していません（JPEGかPNGでお送りください）');
  const raw = Buffer.from(m[2], 'base64');
  if (raw.length > 5 * 1024 * 1024) throw new Error('写真が大きすぎます');
  let buf, meta;
  try {
    buf = await sharp(raw).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    meta = await sharp(buf).metadata();
  } catch { throw new Error('写真を読み込めませんでした。別の写真でお試しください'); }
  const dir = path.join(SITES_DIR, site.slug, 'uploads'); mkdirSync(dir, { recursive: true });
  const name = `${now()}-${newToken().slice(0, 8)}.jpg`;
  writeFileSync(path.join(dir, name), buf);
  return { name, buffer: buf, url: `/u/${site.slug}/${name}`, width: meta.width, height: meta.height };
}

// HPの写真の場所に合わせて、幅をそろえて軽くする（表示が速く、どの写真も同じ見え方になる）
async function fitImageForSlot(buf, slotWidth) {
  const meta = await sharp(buf).metadata();
  const out = await sharp(buf).resize({ width: slotWidth, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true, progressive: true }).toBuffer();
  return { buffer: out, small: meta.width < slotWidth * 0.6, width: meta.width };
}

async function addCustomerMessage(c, site, r, body) {
  const text = String(body.text || '').slice(0, 2000);
  if (!text && !body.image) throw new Error('変えたいことを書いてください');
  const recent = one(`SELECT COUNT(*) n FROM messages m JOIN requests r ON r.id = m.request_id WHERE r.customer_id = ? AND m.sender = 'customer' AND m.created_at > ?`, c.id, now() - 3600000).n;
  if (recent >= MAX_REQUESTS_PER_HOUR) throw new Error('短い時間にたくさんのご依頼をいただいたため、少し時間をおいてお送りください');
  const img = await saveImage(site, body.image);
  run('INSERT INTO messages (request_id, sender, body, image_path, created_at) VALUES (?,?,?,?,?)', r.id, 'customer', text || '（写真を送りました）', img?.url || null, now());
  run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'working', now(), r.id);
  setImmediate(() => processRequest(r.id).catch((e) => failRequest(r.id, e)));
}

app.post('/app/requests', requireCustomer, async (req, res) => {
  const c = req.customer;
  const site = one('SELECT * FROM sites WHERE customer_id = ?', c.id);
  if (!site || !site.live_version_id) return res.status(400).json({ error: 'ホームページの準備がまだ整っていません。担当者からのご連絡をお待ちください' });
  try {
    const info = run('INSERT INTO requests (customer_id, site_id, status, created_at, updated_at) VALUES (?,?,?,?,?)', c.id, site.id, 'working', now(), now());
    const r = one('SELECT * FROM requests WHERE id = ?', Number(info.lastInsertRowid));
    try { await addCustomerMessage(c, site, r, req.body); }
    catch (e) { run('DELETE FROM requests WHERE id = ?', r.id); throw e; }
    res.json({ redirect: `/app/r/${r.id}` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/app/r/:id/messages', requireCustomer, async (req, res) => {
  const r = ownRequest(req); if (!r) return res.status(404).json({ error: '見つかりません' });
  if (['published', 'discarded'].includes(r.status)) return res.status(400).json({ error: 'このご依頼は完了しています。新しくお送りください' });
  const site = one('SELECT * FROM sites WHERE id = ?', r.site_id);
  try { await addCustomerMessage(req.customer, site, r, req.body); res.json({ redirect: `/app/r/${r.id}` }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
// 確認画面（スマホ幅）での自動点検の結果。崩れが見つかったら公開を止め、担当者に回す
app.post('/app/r/:id/layout-check', requireCustomer, (req, res) => {
  const r = ownRequest(req);
  if (!r || r.status !== 'review') return res.json({});
  const issues = [].concat(req.body.issues || []).map((x) => String(x).slice(0, 120)).slice(0, 10);
  if (!issues.length || r.layout_issues) return res.json({ blocked: !!r.layout_issues });
  run('UPDATE requests SET layout_issues = ?, admin_flag = 1, updated_at = ? WHERE id = ?', JSON.stringify(issues), now(), r.id);
  audit('system', 'layout-issues', `request=${r.id} ${issues.join(' / ')}`);
  sendMail(mails.adminNotice(`【表示の崩れ】${req.customer.business_name} の修正案`, `${BASE_URL}/admin/r/${r.id}`));
  res.json({ blocked: true });
});
app.post('/app/r/:id/publish', requireCustomer, async (req, res) => {
  const r = ownRequest(req);
  if (!r || r.status !== 'review' || !r.preview_version_id || r.layout_issues) return res.redirect(r ? `/app/r/${r.id}` : '/app');
  try {
    await publishVersion(r.site_id, r.preview_version_id, `customer:${req.customer.id}`);
    run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'published', now(), r.id);
    run('INSERT INTO messages (request_id, sender, body, created_at) VALUES (?,?,?,?)', r.id, 'system', '公開しました。ホームページに反映されています。', now());
    setFlash(res, 'ok', '公開しました');
  } catch (e) { setFlash(res, 'err', '公開できませんでした。担当者に知らせました'); audit('system', 'publish-failed', e.message); }
  res.redirect(`/app/r/${r.id}`);
});

// ================= 依頼の処理（AI） =================
async function processRequest(requestId) {
  const r = one('SELECT * FROM requests WHERE id = ?', requestId);
  const site = one('SELECT * FROM sites WHERE id = ?', r.site_id);
  const c = one('SELECT * FROM customers WHERE id = ?', r.customer_id);
  const baseVersion = r.preview_version_id || site.live_version_id; // 確認中の修正には、その上から重ねる
  const html = readVersionHtml(site.slug, baseVersion);
  const regions = extractRegions(html);
  const msgs = all(`SELECT * FROM messages WHERE request_id = ? AND sender IN ('customer','admin') ORDER BY id`, r.id);
  const lastImg = [...msgs].reverse().find((m) => m.image_path);
  const conversation = msgs.map((m) => `${m.sender === 'customer' ? 'お客さま' : '担当'}：${m.body}`).join('\n');
  const attached = lastImg ? `assets/${path.basename(lastImg.image_path)}` : null;

  const p = await proposeChanges({ businessType: c.business_type, businessName: c.business_name, regions, requestText: conversation, attachedImage: attached });

  if (p.question) {
    run('INSERT INTO messages (request_id, sender, body, created_at) VALUES (?,?,?,?)', r.id, 'system', p.question, now());
    return run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'waiting_customer', now(), r.id);
  }
  const listChanges = p.list_changes || [];
  // 書き直しても長さ・件数の決まりに収まらないものは、デザインが崩れるので担当者に回す
  const layoutIssues = (p.style_issues || []).filter((x) => /長すぎ|件まで|空です|空には|改行が多すぎ|曜日が違います/.test(x));
  const hasChanges = p.changes.length || listChanges.length;
  if ((p.needs_admin && !hasChanges) || !hasChanges || layoutIssues.length) {
    run('INSERT INTO messages (request_id, sender, body, created_at) VALUES (?,?,?,?)', r.id, 'system', 'ありがとうございます。このご依頼は担当者が確認して、1営業日以内にご連絡します。', now());
    audit('ai', 'needs-admin', `request=${r.id} ${p.admin_reason || ''} ${layoutIssues.join(' / ')}`);
    return run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'needs_admin', now(), r.id);
  }
  if (p.needs_admin) { // 一部だけ自動でできた：できた分は確認画面へ、残りは担当者へ
    audit('ai', 'needs-admin-partial', `request=${r.id} ${p.admin_reason || ''}`);
    run('UPDATE requests SET admin_flag = 1 WHERE id = ?', r.id);
    sendMail(mails.adminNotice(`【一部対応が必要】${c.business_name} のご依頼`, `${BASE_URL}/admin/r/${r.id}`));
  }
  if (p.style_issues?.length) audit('ai', 'style-issues', `request=${r.id} ${p.style_issues.join(' / ')}`);
  const extraFiles = [];
  const notes = [];
  if (lastImg && p.changes.some((x) => x.new_value === attached)) {
    const src = readFileSync(path.join(SITES_DIR, site.slug, 'uploads', path.basename(lastImg.image_path)));
    const slot = regions.find((x) => x.type === 'image' && p.changes.some((ch) => ch.key === x.key && ch.new_value === attached));
    const fitted = await fitImageForSlot(src, slot?.width || 1600);
    if (fitted.small) notes.push('お送りいただいた写真が小さめのため、画面によっては少し粗く見えるかもしれません。気になる場合は、元の大きさの写真をお送りください。');
    extraFiles.push({ relPath: attached, buffer: fitted.buffer });
  }
  const newHtml = applyChanges(html, p.changes, listChanges);
  const vid = createVersion({ site, parentId: baseVersion, html: newHtml, note: p.summary, createdBy: 'ai', requestId: r.id, extraFiles });
  const before = Object.fromEntries(regions.map((x) => [x.key, x]));
  const listText = (region, items) => items.map((it) => region.fields.map((f) => it[f.name] ?? '').join('　')).join('\n');
  const diffs = [
    ...p.changes.map((x) => ({
      key: x.key, label: before[x.key]?.label || x.key, type: before[x.key]?.type || 'text',
      before: before[x.key]?.value || '', after: x.new_value,
      after_url: before[x.key]?.type === 'image' ? `/p/${site.slug}/v${vid}/${x.new_value}` : undefined,
    })),
    ...listChanges.map((l) => ({ key: l.key, label: before[l.key].label, type: 'list', before: listText(before[l.key], before[l.key].items), after: listText(before[l.key], l.items) })),
  ];
  if (p.needs_admin && p.customer_note) notes.unshift(p.customer_note);
  const warnings = [...new Set([...(p.guideline_warnings || []), ...guidelineCheck(c.business_type, p.changes, listChanges), ...notes])];
  run('INSERT INTO messages (request_id, sender, body, data, created_at) VALUES (?,?,?,?,?)', r.id, 'system',
    '直したあとの画面ができました。内容を確かめて、よろしければ「公開する」を押してください。', JSON.stringify({ summary: p.summary, diffs, warnings, mock: !!p.mock }), now());
  run('UPDATE requests SET status = ?, preview_version_id = ?, summary = ?, layout_issues = NULL, updated_at = ? WHERE id = ?', 'review', vid, p.summary, now(), r.id);
  sendMail(mails.review(c, `${BASE_URL}/app/r/${r.id}`));
}
function failRequest(id, e) {
  console.error('[依頼の処理に失敗]', id, e.message);
  audit('ai', 'failed', `request=${id} ${e.message}`);
  run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'failed', now(), id);
  const c = one('SELECT c.business_name FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.id = ?', id);
  sendMail(mails.adminNotice(`【要対応】${c?.business_name || ''} のご依頼をAIで処理できませんでした`, `${BASE_URL}/admin/r/${id}\n\n理由：${e.message}`));
}
process.on('unhandledRejection', (e) => console.error('[未処理のエラー]', e));

// ================= HPの配信 =================
// 本番の版（だれでも見られる）
app.get(['/s/:slug', '/s/:slug/*'], (req, res) => {
  const site = one('SELECT * FROM sites WHERE slug = ?', req.params.slug);
  if (!site?.live_version_id) return res.status(404).send(V.notFound());
  if (!req.params[0] && !req.path.endsWith('/')) return res.redirect(`/s/${site.slug}/`);
  res.sendFile(req.params[0] || 'index.html', { root: versionDir(site.slug, site.live_version_id), dotfiles: 'deny' });
});
// 確認用の版（そのお客さまと管理者だけが見られる）
app.get(['/p/:slug/v:vid', '/p/:slug/v:vid/*'], (req, res) => {
  const site = one('SELECT * FROM sites WHERE slug = ?', req.params.slug);
  const cs = readSession(req.cookies.sid, 'customer'), as = readSession(req.cookies.asid, 'admin');
  if (!site || !(as || (cs && cs.user_id === site.customer_id))) return res.status(404).send(V.notFound());
  if (!one('SELECT id FROM versions WHERE id = ? AND site_id = ?', Number(req.params.vid), site.id)) return res.status(404).send(V.notFound());
  if (!req.params[0] && !req.path.endsWith('/')) return res.redirect(`/p/${site.slug}/v${req.params.vid}/`);
  res.setHeader('X-Robots-Tag', 'noindex');
  res.sendFile(req.params[0] || 'index.html', { root: versionDir(site.slug, Number(req.params.vid)), dotfiles: 'deny' });
});
// チャットに添付された写真（本人と管理者だけ）
app.get('/u/:slug/:name', (req, res) => {
  const site = one('SELECT * FROM sites WHERE slug = ?', req.params.slug);
  const cs = readSession(req.cookies.sid, 'customer'), as = readSession(req.cookies.asid, 'admin');
  if (!site || !(as || (cs && cs.user_id === site.customer_id))) return res.status(404).end();
  res.sendFile(path.basename(req.params.name), { root: path.join(SITES_DIR, site.slug, 'uploads'), dotfiles: 'deny' });
});


// ================= 規約・特商法・プライバシーポリシー（決済画面から開く） =================
app.get('/legal/:brand/:file', (req, res) => {
  const brand = req.params.brand === 'clinic' ? 'clinic' : req.params.brand === 'food' ? 'food' : null;
  if (!brand) return res.status(404).send(V.notFound());
  if (req.params.file === 'terms.html') return res.send(V.termsPage(readFileSync(path.resolve('legal/terms.md'), 'utf8'), brand === 'clinic' ? '院のWeb係' : '飲食店のWeb係'));
  if (!['tokushoho.html', 'privacy.html'].includes(req.params.file)) return res.status(404).send(V.notFound());
  const html = readFileSync(path.resolve('legal', brand, req.params.file), 'utf8')
    .replace(/href="index.html"/g, `href="${process.env[brand === 'clinic' ? 'SITE_URL_CLINIC' : 'SITE_URL_FOOD'] || '#'}"`);
  res.send(html);
});

// ================= お支払い =================
// 管理画面で決めた見積り → お客さまに決済リンクを送る → Stripeの画面でカード入力 → 戻ってきたら契約者DBに反映
const quoteOf = (c) => computeQuote(c.billing_json ? JSON.parse(c.billing_json) : null, c.business_type);
function validPayToken(token) {
  const t = validToken(token);
  return t && t.purpose === 'pay' ? t : null;
}
app.get('/pay/:token', (req, res) => {
  const t = validPayToken(req.params.token);
  if (!t) return res.status(404).send(V.payExpired());
  const c = one('SELECT * FROM customers WHERE id = ?', t.customer_id);
  const quote = JSON.parse(c.pending_quote_json || 'null');
  if (!quote) return res.status(404).send(V.payExpired());
  res.send(V.payPage({ c, quote, token: t.token, mode: stripeMode(), flash: takeFlash(req, res) }));
});
app.post('/pay/:token', async (req, res) => {
  const t = validPayToken(req.params.token);
  if (!t) return res.status(404).send(V.payExpired());
  const c = one('SELECT * FROM customers WHERE id = ?', t.customer_id);
  const quote = JSON.parse(c.pending_quote_json || 'null');
  if (!req.body.agree) { setFlash(res, 'err', '利用規約と特定商取引法に基づく表記をご確認のうえ、チェックを入れてください'); return res.redirect(`/pay/${t.token}`); }
  run('UPDATE customers SET terms_agreed_at = ? WHERE id = ?', now(), c.id);
  audit(`customer:${c.id}`, 'terms-agreed', `token=${t.token.slice(0, 6)}`);
  try {
    const r = await startCheckout(c, quote, { successUrl: `${BASE_URL}/pay/${t.token}/done`, cancelUrl: `${BASE_URL}/pay/${t.token}` });
    if (r.mock) { // 仮の決済：Stripe未設定のときは、そのまま完了扱いにして流れを確認する
      markPaid(c.id, { quote });
      run('UPDATE tokens SET used_at = ? WHERE token = ?', now(), t.token);
      audit(`customer:${c.id}`, 'paid-mock');
      return res.send(V.payDone({ c, quote, mock: true }));
    }
    res.redirect(303, r.url);
  } catch (e) {
    console.error('[決済画面の作成に失敗]', e.message);
    setFlash(res, 'err', 'お支払い画面を開けませんでした。時間をおいてお試しいただくか、担当者にご連絡ください');
    res.redirect(`/pay/${t.token}`);
  }
});
app.get('/pay/:token/done', async (req, res) => {
  const t = one('SELECT * FROM tokens WHERE token = ? AND purpose = ?', req.params.token, 'pay');
  if (!t) return res.status(404).send(V.payExpired());
  const c = one('SELECT * FROM customers WHERE id = ?', t.customer_id);
  const quote = JSON.parse(c.pending_quote_json || 'null');
  try {
    const s = req.query.session_id ? await syncCheckout(String(req.query.session_id)) : null;
    if (!s || s.customerId !== c.id) return res.redirect(`/pay/${t.token}`);
    markPaid(c.id, { stripeCustomerId: s.stripeCustomerId, subscriptionId: s.subscriptionId, quote });
    run('UPDATE tokens SET used_at = COALESCE(used_at, ?) WHERE token = ?', now(), t.token);
    audit(`customer:${c.id}`, 'paid', s.subscriptionId);
    sendMail(mails.adminNotice(`【決済完了】${c.business_name}（月額 ${quote.monthlyTotal.toLocaleString()}円）`, `${BASE_URL}/admin/customers/${c.id}`));
    res.send(V.payDone({ c, quote }));
  } catch (e) { console.error('[決済の確認に失敗]', e); res.send(V.payDone({ c, quote, pending: true })); }
});
// マイページ → お支払い情報（カードの変更・領収書）
app.get('/app/billing', requireCustomer, async (req, res) => {
  const c = req.customer;
  try {
    const url = await portalUrl(c, `${BASE_URL}/app`);
    if (url) return res.redirect(303, url);
  } catch (e) { console.error('[お支払い画面の作成に失敗]', e); }
  res.send(V.billingInfoPage({ c, quote: c.billed_json ? JSON.parse(c.billed_json) : null, mode: stripeMode() }));
});

// 管理：料金の条件を保存
app.post('/admin/customers/:id/billing', requireAdmin, (req, res) => {
  const c = one('SELECT * FROM customers WHERE id = ?', Number(req.params.id)); if (!c) return res.status(404).send(V.notFound());
  const billing = readBillingForm(req.body);
  const states = [].concat(req.body.state ?? []).map(String).filter((x) => /^[A-E]\d$/.test(x)).join(',');
  run('UPDATE customers SET billing_json = ?, state_codes = ? WHERE id = ?', JSON.stringify(billing), states, c.id);
  const q = computeQuote(billing, c.business_type);
  if (!c.stripe_subscription_id) run('UPDATE customers SET monthly_fee = ?, plan = ? WHERE id = ?', q.monthlyTotal, q.planCode, c.id);
  audit(`admin:${req.admin.id}`, 'billing-save', c.id);
  setFlash(res, q.problems.length ? 'err' : 'ok', q.problems.length ? q.problems.join('／') : '料金の条件を保存しました');
  res.redirect(`/admin/customers/${c.id}#billing`);
});
// 管理：決済リンクを作ってお客さまに送る（14日間有効）
app.post('/admin/customers/:id/paylink', requireAdmin, (req, res) => {
  const c = one('SELECT * FROM customers WHERE id = ?', Number(req.params.id)); if (!c) return res.status(404).send(V.notFound());
  const q = quoteOf(c);
  if (q.problems.length) { setFlash(res, 'err', q.problems.join('／')); return res.redirect(`/admin/customers/${c.id}#billing`); }
  if (c.stripe_subscription_id) { setFlash(res, 'err', 'すでに月額の決済が始まっています。金額を変えるときは「請求中の内容を変更する」を使ってください'); return res.redirect(`/admin/customers/${c.id}#billing`); }
  run(`UPDATE tokens SET used_at = ? WHERE customer_id = ? AND purpose = 'pay' AND used_at IS NULL`, now(), c.id); // 古いリンクは無効に
  const token = newToken();
  run('INSERT INTO tokens (token, customer_id, purpose, expires_at) VALUES (?,?,?,?)', token, c.id, 'pay', now() + 14 * 24 * 3600 * 1000);
  run('UPDATE customers SET pending_quote_json = ? WHERE id = ?', JSON.stringify(q), c.id);
  const url = `${BASE_URL}/pay/${token}`;
  if (req.body.send_mail) sendMail(mails.payLink(c, url, q));
  audit(`admin:${req.admin.id}`, 'paylink', c.id);
  setFlash(res, 'ok', req.body.send_mail ? '決済のご案内メールを送りました' : '決済リンクを作りました（メールは送っていません）');
  res.redirect(`/admin/customers/${c.id}?paylink=${encodeURIComponent(token)}#billing`);
});
// 管理：請求中の内容を変更（次回の請求から）
app.post('/admin/customers/:id/apply-billing', requireAdmin, async (req, res) => {
  const c = one('SELECT * FROM customers WHERE id = ?', Number(req.params.id)); if (!c) return res.status(404).send(V.notFound());
  const q = quoteOf(c);
  if (q.problems.length) { setFlash(res, 'err', q.problems.join('／')); return res.redirect(`/admin/customers/${c.id}#billing`); }
  try { await applyToSubscription(c, q); audit(`admin:${req.admin.id}`, 'billing-apply', `${c.id} ${q.monthlyTotal}`); setFlash(res, 'ok', `次回の請求から月額 ${q.monthlyTotal.toLocaleString()}円 にしました`); }
  catch (e) { console.error(e); setFlash(res, 'err', `変更できませんでした：${e.message}`); }
  res.redirect(`/admin/customers/${c.id}#billing`);
});
// 管理：単発の請求（次回の月額と一緒に）
app.post('/admin/customers/:id/charge', requireAdmin, async (req, res) => {
  const c = one('SELECT * FROM customers WHERE id = ?', Number(req.params.id)); if (!c) return res.status(404).send(V.notFound());
  const label = String(req.body.label || '').trim().slice(0, 60);
  const amount = Math.round(Number(String(req.body.amount || '').normalize('NFKC').replace(/[,円\s]/g, '')));
  if (!label || !(amount > 0)) { setFlash(res, 'err', '内容と金額を入れてください'); return res.redirect(`/admin/customers/${c.id}#billing`); }
  try { await addOneTimeCharge(c, { label, amount }); audit(`admin:${req.admin.id}`, 'charge', `${c.id} ${label} ${amount}`); setFlash(res, 'ok', `「${label}」${amount.toLocaleString()}円を次回の請求に追加しました`); }
  catch (e) { setFlash(res, 'err', e.message); }
  res.redirect(`/admin/customers/${c.id}#billing`);
});

// ================= 管理画面 =================
app.get('/admin/login', (req, res) => res.send(V.adminLoginPage({ flash: takeFlash(req, res) })));
app.post('/admin/login', (req, res) => {
  const r = attemptLogin('admins', req.body.email, req.body.password);
  if (!r.ok) return res.status(401).send(V.adminLoginPage({ flash: { type: 'err', msg: r.msg } }));
  // パスワードの次に、二段階認証（6桁コード）へ
  res.cookie('amfa', createSession('admin_mfa', r.user.id), { ...cookieOptions(), maxAge: 10 * 60 * 1000 });
  res.redirect(r.user.totp_secret ? '/admin/mfa' : '/admin/mfa/setup');
});
const mfaUser = (req) => { const s = readSession(req.cookies.amfa, 'admin_mfa'); return s && one('SELECT * FROM admins WHERE id = ?', s.user_id); };
function finishAdminLogin(req, res, admin) {
  destroySession(req.cookies.amfa); res.clearCookie('amfa', { path: '/' });
  res.cookie('asid', createSession('admin', admin.id), { ...cookieOptions(), maxAge: 12 * 3600 * 1000 });
  audit(`admin:${admin.id}`, 'login');
  res.redirect('/admin');
}
app.get('/admin/mfa', (req, res) => { if (!mfaUser(req)) return res.redirect('/admin/login'); res.send(V.adminMfaPage({})); });
app.post('/admin/mfa', (req, res) => {
  const a = mfaUser(req); if (!a) return res.redirect('/admin/login');
  if (!verifyTotp(a.totp_secret, req.body.code)) return res.status(401).send(V.adminMfaPage({ flash: { type: 'err', msg: 'コードが違います。最新の6桁を入れてください' } }));
  finishAdminLogin(req, res, a);
});
app.get('/admin/mfa/setup', async (req, res) => {
  const a = mfaUser(req); if (!a || a.totp_secret) return res.redirect('/admin/login');
  const secret = req.cookies.mfasecret || newSecret();
  res.cookie('mfasecret', secret, { ...cookieOptions(), maxAge: 10 * 60 * 1000 });
  const qr = await QRCode.toDataURL(otpauthUrl(secret, a.email), { margin: 1, width: 220 });
  res.send(V.adminMfaSetupPage({ qr, secret }));
});
app.post('/admin/mfa/setup', async (req, res) => {
  const a = mfaUser(req); const secret = req.cookies.mfasecret;
  if (!a || a.totp_secret || !secret) return res.redirect('/admin/login');
  if (!verifyTotp(secret, req.body.code)) {
    const qr = await QRCode.toDataURL(otpauthUrl(secret, a.email), { margin: 1, width: 220 });
    return res.status(401).send(V.adminMfaSetupPage({ qr, secret, flash: { type: 'err', msg: 'コードが違います。アプリに表示されている6桁を入れてください' } }));
  }
  run('UPDATE admins SET totp_secret = ? WHERE id = ?', secret, a.id);
  res.clearCookie('mfasecret', { path: '/' });
  audit(`admin:${a.id}`, 'mfa-enabled');
  finishAdminLogin(req, res, a);
});
app.post('/admin/logout', (req, res) => { destroySession(req.cookies.asid); res.clearCookie('asid', { path: '/' }); res.redirect('/admin/login'); });

app.get('/admin', requireAdmin, (req, res) => {
  const customers = all('SELECT * FROM customers ORDER BY created_at DESC');
  const queue = all(`SELECT r.*, c.business_name, ${firstText} AS first_text FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.status IN ('needs_admin','failed') OR r.admin_flag = 1 ORDER BY r.updated_at`);
  const active = customers.filter((c) => c.status === 'active');
  const stats = { active: active.length, mrr: active.reduce((s, c) => s + c.monthly_fee, 0), attention: queue.length, pastDue: customers.filter((c) => c.payment_status === 'past_due').length };
  res.send(V.adminDashboard({ stats, queue, customers, flash: takeFlash(req, res) }));
});
app.get('/admin/customers/new', requireAdmin, (req, res) => res.send(V.adminCustomerNew({})));

const SAMPLE = path.resolve('templates');
app.post('/admin/customers', requireAdmin, (req, res) => {
  const b = req.body;
  const email = String(b.email || '').normalize('NFKC').trim().toLowerCase();
  if (one('SELECT id FROM customers WHERE email = ?', email)) return res.send(V.adminCustomerNew({ flash: { type: 'err', msg: 'このメールアドレスはすでに登録されています' } }));
  const info = run(`INSERT INTO customers (business_name, business_type, contact_name, email, phone, plan, monthly_fee, payment_method, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    b.business_name, b.business_type === 'clinic' ? 'clinic' : 'food', b.contact_name, email, b.phone || null, b.plan || 'hp', Number(b.monthly_fee) || 9800, b.payment_method || 'card', now());
  const cid = Number(info.lastInsertRowid);
  // サイトを用意（まずはひな形。あとで実際のHTMLに差し替える）
  const slug = `s${cid}-${newToken().slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  const sid = Number(run('INSERT INTO sites (customer_id, slug, created_at) VALUES (?,?,?)', cid, slug, now()).lastInsertRowid);
  const site = one('SELECT * FROM sites WHERE id = ?', sid);
  const tpl = (existsSync(path.join(SAMPLE, `${b.business_type === 'clinic' ? 'clinic' : 'food'}.html`)))
    ? (await_read(path.join(SAMPLE, `${b.business_type === 'clinic' ? 'clinic' : 'food'}.html`))).replaceAll('{{NAME}}', V.esc(b.business_name))
    : `<!doctype html><title>${V.esc(b.business_name)}</title><h1 data-edit="title">${V.esc(b.business_name)}</h1>`;
  const heroPath = path.join(SAMPLE, `hero-${b.business_type === 'clinic' ? 'clinic' : 'food'}.jpg`);
  const extraFiles = existsSync(heroPath) ? [{ relPath: 'assets/hero.jpg', buffer: readFileSync(heroPath) }] : [];
  const vid = createVersion({ site, parentId: null, html: tpl, note: 'ひな形', createdBy: 'admin', extraFiles });
  run('UPDATE sites SET live_version_id = ? WHERE id = ?', vid, sid);
  const token = newToken();
  run('INSERT INTO tokens (token, customer_id, purpose, expires_at) VALUES (?,?,?,?)', token, cid, 'invite', now() + 7 * 24 * 3600 * 1000);
  audit(`admin:${req.admin.id}`, 'customer-create', cid);
  sendMail(mails.invite(one('SELECT * FROM customers WHERE id = ?', cid), `${BASE_URL}/set-password?token=${token}`));
  res.redirect(`/admin/customers/${cid}?invite=${encodeURIComponent(token)}`);
});
import { readFileSync } from 'node:fs';
const await_read = (p) => readFileSync(p, 'utf8');

app.get('/admin/customers/:id', requireAdmin, (req, res) => {
  const c = one('SELECT * FROM customers WHERE id = ?', Number(req.params.id)); if (!c) return res.status(404).send(V.notFound());
  const site = one('SELECT * FROM sites WHERE customer_id = ?', c.id);
  const versions = site ? all('SELECT * FROM versions WHERE site_id = ? ORDER BY id DESC LIMIT 30', site.id) : [];
  const requests = all(`SELECT r.*, ${firstText} AS first_text FROM requests r WHERE customer_id = ? ORDER BY updated_at DESC`, c.id);
  const inviteUrl = req.query.invite ? `${BASE_URL}/set-password?token=${req.query.invite}` : null;
  const payUrl = req.query.paylink ? `${BASE_URL}/pay/${req.query.paylink}` : null;
  const audits = all(`SELECT * FROM audit_log WHERE (action IN ('billing-save','billing-apply','charge','paylink') AND (detail = ? OR detail LIKE ?)) OR actor = ? ORDER BY id DESC LIMIT 12`, String(c.id), `${c.id} %`, `customer:${c.id}`);
  res.send(V.adminCustomerPage({ c, site, versions, requests, inviteUrl, payUrl, quote: quoteOf(c), billed: c.billed_json ? JSON.parse(c.billed_json) : null, mode: stripeMode(), audits, flash: takeFlash(req, res) }));
});
app.post('/admin/customers/:id', requireAdmin, (req, res) => {
  const b = req.body, id = Number(req.params.id);
  let minEnd = null;
  if (b.contract_start) { const d = new Date(b.contract_start); d.setMonth(d.getMonth() + 6); minEnd = d.toISOString().slice(0, 10); }
  run(`UPDATE customers SET contact_name=?, phone=?, plan=?, monthly_fee=?, payment_method=?, payment_status=?, status=?, contract_start=?, min_term_end=?, notes=? WHERE id=?`,
    b.contact_name, b.phone || null, b.plan, Number(b.monthly_fee) || 0, b.payment_method, b.payment_status, b.status, b.contract_start || null, minEnd, b.notes || null, id);
  audit(`admin:${req.admin.id}`, 'customer-update', id);
  setFlash(res, 'ok', '保存しました');
  res.redirect(`/admin/customers/${id}`);
});
// 独自ドメインの登録（DNSでこのサーバーに向けたあとに登録すると、そのドメインでHPが表示される）
app.post('/admin/sites/:id/domain', requireAdmin, (req, res) => {
  const site = one('SELECT * FROM sites WHERE id = ?', Number(req.params.id)); if (!site) return res.status(404).send(V.notFound());
  const d = String(req.body.domain || '').normalize('NFKC').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (d && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) { setFlash(res, 'err', 'ドメインの形が正しくありません（例：minato-shokudo.jp）'); return res.redirect(`/admin/customers/${site.customer_id}`); }
  if (d && one('SELECT id FROM sites WHERE domain = ? AND id != ?', d, site.id)) { setFlash(res, 'err', 'このドメインは別の契約者に登録されています'); return res.redirect(`/admin/customers/${site.customer_id}`); }
  run('UPDATE sites SET domain = ? WHERE id = ?', d || null, site.id);
  audit(`admin:${req.admin.id}`, 'domain', `${site.slug} ${d}`);
  setFlash(res, 'ok', d ? `独自ドメイン ${d} を登録しました` : '独自ドメインを外しました');
  res.redirect(`/admin/customers/${site.customer_id}`);
});
// バックアップ（毎日自動で取る分の一覧と、手元への保存）
app.get('/admin/backups', requireAdmin, (req, res) => res.send(V.adminBackupsPage({ backups: listBackups(), flash: takeFlash(req, res) })));
app.post('/admin/backups', requireAdmin, (req, res) => {
  try { const b = backupNow(); audit(`admin:${req.admin.id}`, 'backup', b.name); setFlash(res, 'ok', `バックアップを作りました（${b.name}）`); }
  catch (e) { setFlash(res, 'err', e.message); }
  res.redirect('/admin/backups');
});
app.get('/admin/backups/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  if (!/^app-\d{4}-\d{2}-\d{2}\.db$/.test(name)) return res.status(404).end();
  audit(`admin:${req.admin.id}`, 'backup-download', name);
  res.download(path.join(BACKUP_DIR, name));
});

app.post('/admin/sites/:id/upload', requireAdmin, (req, res) => {
  const site = one('SELECT * FROM sites WHERE id = ?', Number(req.params.id));
  const html = Buffer.from(String(req.body.html_b64 || ''), 'base64').toString('utf8');
  if (!site || !/<html|<!doctype/i.test(html)) { setFlash(res, 'err', 'HTMLを読み込めませんでした'); return res.redirect('back'); }
  const vid = createVersion({ site, parentId: site.live_version_id, html, note: 'HTMLを差し替え', createdBy: 'admin' });
  audit(`admin:${req.admin.id}`, 'upload', `site=${site.slug} v=${vid}`);
  // チャットで変えられる場所の点検（印が無い・文字数の上限が無い場所を知らせる）
  const regs = extractRegions(html);
  const noMax = regs.filter((x) => x.type === 'text' && !x.max).map((x) => x.label);
  const note = !regs.length ? '。注意：チャットで変えられる場所の印（data-edit）が1つもありません'
    : `。チャットで変えられる場所 ${regs.length} か所${noMax.length ? `（文字数の上限なし：${noMax.slice(0, 6).join('、')}${noMax.length > 6 ? ' ほか' : ''}）` : ''}`;
  setFlash(res, regs.length ? 'ok' : 'err', `版 ${vid} として登録しました（まだ公開していません）${note}`);
  res.redirect(`/admin/customers/${site.customer_id}`);
});
app.post('/admin/sites/:id/publish/:vid', requireAdmin, async (req, res) => {
  const site = one('SELECT * FROM sites WHERE id = ?', Number(req.params.id));
  try { await publishVersion(site.id, Number(req.params.vid), `admin:${req.admin.id}`); setFlash(res, 'ok', `版 ${req.params.vid} を公開しました`); }
  catch (e) { setFlash(res, 'err', e.message); }
  res.redirect(`/admin/customers/${site.customer_id}`);
});

app.get('/admin/r/:id', requireAdmin, (req, res) => {
  const r = one('SELECT * FROM requests WHERE id = ?', Number(req.params.id)); if (!r) return res.status(404).send(V.notFound());
  const c = one('SELECT * FROM customers WHERE id = ?', r.customer_id);
  const messages = all('SELECT * FROM messages WHERE request_id = ? ORDER BY id', r.id);
  res.send(V.adminRequestPage({ r, c, messages, preview: previewInfo(r) }));
});
app.post('/admin/r/:id/reply', requireAdmin, (req, res) => {
  const r = one('SELECT * FROM requests WHERE id = ?', Number(req.params.id));
  run('UPDATE requests SET admin_flag = 0 WHERE id = ?', r.id);
  run('INSERT INTO messages (request_id, sender, body, created_at) VALUES (?,?,?,?)', r.id, 'admin', String(req.body.text).slice(0, 2000), now());
  run('UPDATE requests SET status = CASE WHEN status IN (\'needs_admin\',\'failed\') THEN \'waiting_customer\' ELSE status END, updated_at = ? WHERE id = ?', now(), r.id);
  sendMail(mails.reply(one('SELECT * FROM customers WHERE id = ?', r.customer_id), `${BASE_URL}/app/r/${r.id}`));
  res.redirect(`/admin/r/${r.id}`);
});
app.post('/admin/r/:id/retry', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'working', now(), id);
  setImmediate(() => processRequest(id).catch((e) => failRequest(id, e)));
  res.redirect(`/admin/r/${id}`);
});
app.post('/admin/r/:id/publish', requireAdmin, async (req, res) => {
  const r = one('SELECT * FROM requests WHERE id = ?', Number(req.params.id));
  await publishVersion(r.site_id, r.preview_version_id, `admin:${req.admin.id}`);
  run('UPDATE requests SET status = ?, admin_flag = 0, layout_issues = NULL, updated_at = ? WHERE id = ?', 'published', now(), r.id);
  run('INSERT INTO messages (request_id, sender, body, created_at) VALUES (?,?,?,?)', r.id, 'system', '公開しました。ホームページに反映されています。', now());
  const pc = one('SELECT * FROM customers WHERE id = ?', r.customer_id), ps = one('SELECT * FROM sites WHERE id = ?', r.site_id);
  sendMail(mails.published(pc, ps.domain ? `https://${ps.domain}/` : `${BASE_URL}/s/${ps.slug}/`));
  res.redirect(`/admin/r/${r.id}`);
});
app.post('/admin/r/:id/discard', requireAdmin, (req, res) => {
  run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'discarded', now(), Number(req.params.id));
  res.redirect(`/admin/r/${req.params.id}`);
});

app.use((req, res) => res.status(404).send(V.notFound()));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('エラーが起きました。時間をおいてお試しください'); });

ensureAdmin();
recoverStuck();
startJobs({ baseUrl: BASE_URL });
app.listen(PORT, () => console.log(`Web係 管理システム: ${BASE_URL}  （AI: ${process.env.ANTHROPIC_API_KEY ? 'Claude' : '仮の動作'}／決済: ${{ mock: '仮の決済', test: 'Stripeテスト', live: 'Stripe本番' }[stripeMode()]}）`));
