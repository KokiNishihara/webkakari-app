import express from 'express';
import path from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { db, one, all, run, now, audit } from './db.js';
import { hashPassword, passwordProblem, attemptLogin, createSession, readSession, destroySession, cookieOptions, newToken } from './auth.js';
import { extractRegions, applyChanges, readVersionHtml, createVersion, publishVersion, versionDir, SITES_DIR } from './sites.js';
import { proposeChanges, guidelineCheck } from './ai.js';
import * as V from './views.js';

const app = express();
const PORT = Number(process.env.PORT || 4900);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MAX_REQUESTS_PER_HOUR = 20; // AI費用の暴走を防ぐ

app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '6mb' }));
app.use(express.json({ limit: '8mb' }));
app.use('/static', express.static(path.resolve('public'), { maxAge: '1h' }));

// --- 共通：Cookie と CSRF 対策（POSTは同じサイトからのみ受け付ける）
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1))]; }));
app.use((req, res, next) => {
  req.cookies = cookies(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
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
  const problem = passwordProblem(req.body.password) || (req.body.password !== req.body.password2 ? '2回の入力が一致しません' : null);
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
  const c = one('SELECT * FROM customers WHERE email = ?', String(req.body.email || '').trim().toLowerCase());
  if (c) {
    const token = newToken();
    run('INSERT INTO tokens (token, customer_id, purpose, expires_at) VALUES (?,?,?,?)', token, c.id, 'reset', now() + 60 * 60 * 1000);
    // TODO: メール送信（送信サービスを決めたら実装）。いまはサーバーのログに出す。
    console.log(`[パスワード再設定] ${c.email} → ${BASE_URL}/set-password?token=${token}`);
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

function saveImage(site, dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('写真の形式に対応していません（JPEGかPNGでお送りください）');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) throw new Error('写真が大きすぎます');
  const dir = path.join(SITES_DIR, site.slug, 'uploads'); mkdirSync(dir, { recursive: true });
  const name = `${now()}-${newToken().slice(0, 8)}.${m[1] === 'png' ? 'png' : 'jpg'}`;
  writeFileSync(path.join(dir, name), buf);
  return { name, buffer: buf, url: `/u/${site.slug}/${name}` };
}

function addCustomerMessage(c, site, r, body) {
  const text = String(body.text || '').slice(0, 2000);
  if (!text && !body.image) throw new Error('変えたいことを書いてください');
  const recent = one(`SELECT COUNT(*) n FROM messages m JOIN requests r ON r.id = m.request_id WHERE r.customer_id = ? AND m.sender = 'customer' AND m.created_at > ?`, c.id, now() - 3600000).n;
  if (recent >= MAX_REQUESTS_PER_HOUR) throw new Error('短い時間にたくさんのご依頼をいただいたため、少し時間をおいてお送りください');
  const img = saveImage(site, body.image);
  run('INSERT INTO messages (request_id, sender, body, image_path, created_at) VALUES (?,?,?,?,?)', r.id, 'customer', text || '（写真を送りました）', img?.url || null, now());
  run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'working', now(), r.id);
  setImmediate(() => processRequest(r.id).catch((e) => failRequest(r.id, e)));
}

app.post('/app/requests', requireCustomer, (req, res) => {
  const c = req.customer;
  const site = one('SELECT * FROM sites WHERE customer_id = ?', c.id);
  if (!site || !site.live_version_id) return res.status(400).json({ error: 'ホームページの準備がまだ整っていません。担当者からのご連絡をお待ちください' });
  try {
    const info = run('INSERT INTO requests (customer_id, site_id, status, created_at, updated_at) VALUES (?,?,?,?,?)', c.id, site.id, 'working', now(), now());
    const r = one('SELECT * FROM requests WHERE id = ?', Number(info.lastInsertRowid));
    addCustomerMessage(c, site, r, req.body);
    res.json({ redirect: `/app/r/${r.id}` });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/app/r/:id/messages', requireCustomer, (req, res) => {
  const r = ownRequest(req); if (!r) return res.status(404).json({ error: '見つかりません' });
  if (['published', 'discarded'].includes(r.status)) return res.status(400).json({ error: 'このご依頼は完了しています。新しくお送りください' });
  const site = one('SELECT * FROM sites WHERE id = ?', r.site_id);
  try { addCustomerMessage(req.customer, site, r, req.body); res.json({ redirect: `/app/r/${r.id}` }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/app/r/:id/publish', requireCustomer, async (req, res) => {
  const r = ownRequest(req);
  if (!r || r.status !== 'review' || !r.preview_version_id) return res.redirect('/app');
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
  if (p.needs_admin || !p.changes.length) {
    run('INSERT INTO messages (request_id, sender, body, created_at) VALUES (?,?,?,?)', r.id, 'system', 'ありがとうございます。このご依頼は担当者が確認して、1営業日以内にご連絡します。', now());
    audit('ai', 'needs-admin', `request=${r.id} ${p.admin_reason}`);
    return run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'needs_admin', now(), r.id);
  }
  const extraFiles = [];
  if (lastImg && p.changes.some((x) => x.new_value === attached)) {
    const buf = (await import('node:fs')).readFileSync(path.join(SITES_DIR, site.slug, 'uploads', path.basename(lastImg.image_path)));
    extraFiles.push({ relPath: attached, buffer: buf });
  }
  const newHtml = applyChanges(html, p.changes);
  const vid = createVersion({ site, parentId: baseVersion, html: newHtml, note: p.summary, createdBy: 'ai', requestId: r.id, extraFiles });
  const before = Object.fromEntries(regions.map((x) => [x.key, x]));
  const diffs = p.changes.map((x) => ({
    key: x.key, label: before[x.key]?.label || x.key, type: before[x.key]?.type || 'text',
    before: before[x.key]?.value || '', after: x.new_value,
    after_url: before[x.key]?.type === 'image' ? `/p/${site.slug}/v${vid}/${x.new_value}` : undefined,
  }));
  const warnings = [...new Set([...(p.guideline_warnings || []), ...guidelineCheck(c.business_type, p.changes)])];
  run('INSERT INTO messages (request_id, sender, body, data, created_at) VALUES (?,?,?,?,?)', r.id, 'system',
    '直したあとの画面ができました。内容を確かめて、よろしければ「公開する」を押してください。', JSON.stringify({ summary: p.summary, diffs, warnings, mock: !!p.mock }), now());
  run('UPDATE requests SET status = ?, preview_version_id = ?, summary = ?, updated_at = ? WHERE id = ?', 'review', vid, p.summary, now(), r.id);
}
function failRequest(id, e) {
  console.error('[依頼の処理に失敗]', id, e);
  audit('ai', 'failed', `request=${id} ${e.message}`);
  run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'failed', now(), id);
}

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

// ================= 管理画面 =================
app.get('/admin/login', (req, res) => res.send(V.adminLoginPage({ flash: takeFlash(req, res) })));
app.post('/admin/login', (req, res) => {
  const r = attemptLogin('admins', req.body.email, req.body.password);
  if (!r.ok) return res.status(401).send(V.adminLoginPage({ flash: { type: 'err', msg: r.msg } }));
  res.cookie('asid', createSession('admin', r.user.id), { ...cookieOptions(), maxAge: 12 * 3600 * 1000 });
  audit(`admin:${r.user.id}`, 'login');
  res.redirect('/admin');
});
app.post('/admin/logout', (req, res) => { destroySession(req.cookies.asid); res.clearCookie('asid', { path: '/' }); res.redirect('/admin/login'); });

app.get('/admin', requireAdmin, (req, res) => {
  const customers = all('SELECT * FROM customers ORDER BY created_at DESC');
  const queue = all(`SELECT r.*, c.business_name, ${firstText} AS first_text FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.status IN ('needs_admin','failed') ORDER BY r.updated_at`);
  const active = customers.filter((c) => c.status === 'active');
  const stats = { active: active.length, mrr: active.reduce((s, c) => s + c.monthly_fee, 0), attention: queue.length, pastDue: customers.filter((c) => c.payment_status === 'past_due').length };
  res.send(V.adminDashboard({ stats, queue, customers, flash: takeFlash(req, res) }));
});
app.get('/admin/customers/new', requireAdmin, (req, res) => res.send(V.adminCustomerNew({})));

const SAMPLE = path.resolve('templates');
app.post('/admin/customers', requireAdmin, (req, res) => {
  const b = req.body;
  const email = String(b.email || '').trim().toLowerCase();
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
  res.send(V.adminCustomerPage({ c, site, versions, requests, inviteUrl, flash: takeFlash(req, res) }));
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
app.post('/admin/sites/:id/upload', requireAdmin, (req, res) => {
  const site = one('SELECT * FROM sites WHERE id = ?', Number(req.params.id));
  const html = Buffer.from(String(req.body.html_b64 || ''), 'base64').toString('utf8');
  if (!site || !/<html|<!doctype/i.test(html)) { setFlash(res, 'err', 'HTMLを読み込めませんでした'); return res.redirect('back'); }
  const vid = createVersion({ site, parentId: site.live_version_id, html, note: 'HTMLを差し替え', createdBy: 'admin' });
  audit(`admin:${req.admin.id}`, 'upload', `site=${site.slug} v=${vid}`);
  setFlash(res, 'ok', `版 ${vid} として登録しました（まだ公開していません）`);
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
  run('INSERT INTO messages (request_id, sender, body, created_at) VALUES (?,?,?,?)', r.id, 'admin', String(req.body.text).slice(0, 2000), now());
  run('UPDATE requests SET status = CASE WHEN status IN (\'needs_admin\',\'failed\') THEN \'waiting_customer\' ELSE status END, updated_at = ? WHERE id = ?', now(), r.id);
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
  run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'published', now(), r.id);
  run('INSERT INTO messages (request_id, sender, body, created_at) VALUES (?,?,?,?)', r.id, 'system', '公開しました。ホームページに反映されています。', now());
  res.redirect(`/admin/r/${r.id}`);
});
app.post('/admin/r/:id/discard', requireAdmin, (req, res) => {
  run('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?', 'discarded', now(), Number(req.params.id));
  res.redirect(`/admin/r/${req.params.id}`);
});

app.use((req, res) => res.status(404).send(V.notFound()));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('エラーが起きました。時間をおいてお試しください'); });

app.listen(PORT, () => console.log(`Web係 管理システム: ${BASE_URL}  （AI: ${process.env.ANTHROPIC_API_KEY ? 'Claude' : '仮の動作'}）`));
