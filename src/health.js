// 停止の予防：外部（Cloudflare R2）へのバックアップ・独自ドメインの点検・週1回の点検レポート
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statfsSync, statSync, readdirSync } from 'node:fs';
import { promises as dns } from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { db, one, all, getSetting, setSetting, audit } from './db.js';
import { SITES_DIR } from './sites.js';
import { sendMail } from './mail.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const RENDER_IP = '216.24.57.1';
const ADMIN_TO = () => process.env.ADMIN_NOTIFY_EMAIL || 'nishihara@platinum-kikaku.co.jp';
const KEEP_DAYS = 30;
const jstDay = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const daysUntil = (d) => Math.floor((new Date(d).getTime() - Date.now()) / 86400000);

// ---------- 外部バックアップ（Cloudflare R2・S3互換） ----------
const r2 = () => {
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: key, R2_SECRET_ACCESS_KEY: secret, R2_BUCKET: bucket } = process.env;
  return account && key && secret && bucket ? { account, key, secret, bucket } : null;
};
export const offsiteReady = () => !!r2();

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// AWS 署名 v4（R2 は region=auto, service=s3）
async function r2Request(method, objectKey, body = Buffer.alloc(0)) {
  const c = r2(); if (!c) throw new Error('R2 の設定がありません');
  const host = `${c.account}.r2.cloudflarestorage.com`;
  const uri = `/${enc(c.bucket)}/${objectKey.split('/').map(enc).join('/')}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signed = Object.keys(headers).sort();
  const canonical = [method, uri, '', ...signed.map((h) => `${h}:${headers[h]}`), '', signed.join(';'), payloadHash].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + c.secret, day), 'auto'), 's3'), 'aws4_request');
  const sig = createHmac('sha256', kSign).update(toSign).digest('hex');
  const res = await fetch(`https://${host}${uri}`, {
    method, body: method === 'PUT' ? body : undefined,
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${c.key}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}` },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`R2 ${method} ${res.status}：${(await res.text()).slice(0, 200)}`);
  return res;
}

// DB（その時点の写し）と、全店のHPのファイルを1つにまとめて R2 に送る。30日より古い分は消す
export async function offsiteBackup() {
  if (!r2()) throw new Error('外部バックアップの設定（R2_ACCOUNT_ID ほか4つ）がまだありません');
  const tmp = path.join(os.tmpdir(), `webkakari-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const snap = path.join(tmp, 'app.db');
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
    const out = path.join(tmp, 'backup.tar.gz');
    const args = ['-czf', out, '-C', tmp, 'app.db'];
    if (existsSync(SITES_DIR)) args.push('-C', path.dirname(SITES_DIR), path.basename(SITES_DIR));
    execFileSync('tar', args);
    const body = readFileSync(out);
    const day = jstDay();
    await r2Request('PUT', `daily/webkakari-${day}.tar.gz`, body);
    await r2Request('DELETE', `daily/webkakari-${jstDay(Date.now() - KEEP_DAYS * 86400000)}.tar.gz`).catch(() => {});
    setSetting('offsite_last_ok', String(Date.now()));
    setSetting('offsite_last_size', String(body.length));
    setSetting('offsite_last_err', '');
    audit('system', 'offsite-backup', `${day} ${body.length}`);
    return { day, size: body.length };
  } catch (e) {
    setSetting('offsite_last_err', `${jstDay()} ${e.message}`);
    throw e;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---------- 独自ドメインの点検 ----------
async function dnsCheck(domain) {
  const a = await dns.resolve4(domain).catch(() => []);
  const cname = await dns.resolveCname(domain).catch(() => []);
  const ok = a.includes(RENDER_IP) || cname.some((c) => /onrender\.com\.?$/.test(c));
  return { ok, detail: ok ? 'サーバーを向いています' : `サーバーを向いていません（A: ${a.join(', ') || 'なし'}${cname.length ? ` / CNAME: ${cname.join(', ')}` : ''}）` };
}
function certCheck(domain) {
  return new Promise((resolve) => {
    const s = tls.connect({ host: domain, servername: domain, port: 443, timeout: 10000 }, () => {
      const cert = s.getPeerCertificate(); s.end();
      if (!s.authorized) return resolve({ ok: false, days: null, detail: `SSL証明書のエラー（${s.authorizationError}）` });
      const days = daysUntil(cert.valid_to);
      resolve({ ok: days > 10, days, detail: `SSL証明書の残り ${days} 日` });
    });
    s.on('error', (e) => resolve({ ok: false, days: null, detail: `HTTPSでつながりません（${e.code || e.message}）` }));
    s.on('timeout', () => { s.destroy(); resolve({ ok: false, days: null, detail: 'HTTPSの応答がありません' }); });
  });
}
async function pageCheck(domain) {
  try {
    const r = await fetch(`https://${domain}/`, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    return { ok: r.ok, detail: r.ok ? 'ページが表示されます' : `ページの応答が ${r.status} です` };
  } catch (e) { return { ok: false, detail: `ページを開けません（${e.cause?.code || e.message}）` }; }
}
// ドメインの有効期限：.jp は JPRS の whois、それ以外は RDAP
function whoisJp(domain) {
  return new Promise((resolve) => {
    let buf = '';
    const s = net.connect(43, 'whois.jprs.jp', () => s.write(`${domain}/e\r\n`));
    s.setTimeout(10000, () => { s.destroy(); resolve(null); });
    s.on('data', (d) => { buf += d.toString('utf8'); });
    s.on('end', () => {
      const m = buf.match(/\[(?:Expires on|State)\][^\n]*?(\d{4}\/\d{2}\/\d{2})/);
      resolve(m ? m[1].replace(/\//g, '-') : null);
    });
    s.on('error', () => resolve(null));
  });
}
async function domainExpiry(domain) {
  const base = domain.split('.').slice(-2).join('.');
  const reg = /\.(co|or|ne|ac|ad|ed|go|gr|lg)\.jp$/.test(domain) ? domain.split('.').slice(-3).join('.') : base;
  try {
    if (reg.endsWith('.jp')) return await whoisJp(reg);
    const r = await fetch(`https://rdap.org/domain/${reg}`, { headers: { accept: 'application/rdap+json', 'user-agent': 'webkakari-health/1.0 (+https://webkakari-app.onrender.com)' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const ev = (await r.json()).events?.find((e) => e.eventAction === 'expiration');
    return ev ? ev.eventDate.slice(0, 10) : null;
  } catch { return null; }
}

export async function checkDomains({ withExpiry = true } = {}) {
  const rows = all(`SELECT s.domain, c.business_name FROM sites s JOIN customers c ON c.id = s.customer_id
    WHERE s.domain IS NOT NULL AND s.domain != '' AND s.live_version_id IS NOT NULL AND c.status != 'canceled' ORDER BY c.business_name`);
  const out = [];
  for (const r of rows) out.push({ ...r, ...(await checkOneDomain(r.domain, { withExpiry })) });
  return out;
}
export async function checkOneDomain(domain, { withExpiry = true } = {}) {
  const [d, cert, page] = await Promise.all([dnsCheck(domain), certCheck(domain), pageCheck(domain)]);
  const exp = withExpiry ? await domainExpiry(domain) : null;
  return { dns: d, cert, page, expiry: exp, expDays: exp ? daysUntil(exp) : null };
}

// ---------- 点検の本体 ----------
const item = (level, area, title, detail = '') => ({ level, area, title, detail });

export async function runCheck({ withExpiry = true } = {}) {
  const items = [];
  // サーバーとディスク
  try {
    const st = statfsSync(DATA_DIR);
    const used = 1 - st.bavail / st.blocks;
    const pct = Math.round(used * 100);
    items.push(item(pct >= 90 ? 'ng' : pct >= 80 ? 'warn' : 'ok', 'サーバー', `ディスクの使用量 ${pct}%`, pct >= 80 ? 'Render の Disks で容量を増やしてください（1GB→2GB など）' : ''));
  } catch (e) { items.push(item('warn', 'サーバー', 'ディスクの使用量を読めませんでした', e.message)); }
  items.push(item('ok', 'サーバー', `起動から ${Math.floor(process.uptime() / 3600)} 時間`));

  // バックアップ
  const backups = (() => { try { return readdirSync(path.join(DATA_DIR, 'backups')).filter((f) => /^app-.*\.db$/.test(f)).sort(); } catch { return []; } })();
  const lastLocal = backups.at(-1)?.slice(4, 14);
  items.push(item(lastLocal && daysUntil(lastLocal) >= -2 ? 'ok' : 'ng', 'バックアップ', `サーバー内のバックアップ：最新 ${lastLocal || 'なし'}`));
  if (!offsiteReady()) items.push(item('ng', 'バックアップ', '外部のバックアップが未設定です', 'Render の Environment に R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET を入れてください'));
  else {
    const okAt = Number(getSetting('offsite_last_ok') || 0), err = getSetting('offsite_last_err');
    const fresh = okAt && Date.now() - okAt < 2 * 86400000;
    items.push(item(fresh ? 'ok' : 'ng', 'バックアップ', `外部（R2）のバックアップ：最新 ${okAt ? jstDay(okAt) : 'なし'}${okAt ? `（${Math.round(Number(getSetting('offsite_last_size') || 0) / 1024)}KB）` : ''}`, err ? `直近のエラー：${err}` : ''));
  }

  // 通知が届くか
  const smtp = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
  items.push(item(smtp ? 'ok' : 'ng', '通知', smtp ? 'メール送信の設定あり' : 'メール送信の設定がありません', smtp ? '' : '決済失敗・解約・この点検の通知が届きません。SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS を設定してください'));
  if (process.env.ADMIN_PASSWORD) items.push(item('warn', '設定', 'ADMIN_PASSWORD が残っています', '管理者は作成済みなので、Render の Environment から消してください'));

  // 手で管理するもの（Render の支払いカード）
  const card = getSetting('render_card_exp');
  if (!card) items.push(item('warn', '支払い', 'Render の支払いカードの有効期限が未登録です', 'この画面の下で登録すると、期限の2か月前から知らせます'));
  else {
    const [y, m] = card.split('-').map(Number), end = new Date(y, m, 0), d = Math.floor((end - Date.now()) / 86400000);
    items.push(item(d < 0 ? 'ng' : d <= 60 ? 'warn' : 'ok', '支払い', `Render の支払いカード：${card} まで（残り ${d} 日）`, d <= 60 ? 'Render の Billing でカードを更新してください' : ''));
  }

  // 契約と支払い
  for (const c of all(`SELECT * FROM customers WHERE status != 'canceled' AND payment_status = 'canceled'`))
    items.push(item('ng', '契約', `${c.business_name}：Stripe の月額は止まっているのに、HPは公開中です`, '解約にするか、決済をやり直してもらってください'));
  for (const c of all(`SELECT * FROM customers WHERE status != 'canceled' AND payment_status = 'past_due'`))
    items.push(item('warn', '契約', `${c.business_name}：決済に失敗しています`, 'お客さまにカードの更新をお願いしてください（2か月以上で解除できます・規約第11条）'));
  for (const c of all(`SELECT * FROM customers WHERE status != 'canceled' AND cancel_at IS NOT NULL ORDER BY cancel_at`)) {
    const d = daysUntil(c.cancel_at);
    if (d <= 14) items.push(item('info', '契約', `${c.business_name}：${c.cancel_at} で解約（翌日にHPが止まります）`, 'データの引き渡しの希望がないか確かめてください'));
  }

  // 独自ドメイン
  let domains = [];
  try { domains = await checkDomains({ withExpiry }); } catch (e) { items.push(item('warn', 'ドメイン', 'ドメインの点検に失敗しました', e.message)); }
  for (const d of domains) {
    const bad = [d.dns, d.cert, d.page].filter((x) => !x.ok);
    items.push(item(bad.length ? 'ng' : (d.cert.days ?? 99) <= 21 ? 'warn' : 'ok', 'ドメイン', `${d.business_name}（${d.domain}）`, [d.dns, d.cert, d.page].map((x) => x.detail).join('／')));
    if (withExpiry) {
      if (d.expDays == null) items.push(item('warn', 'ドメイン', `${d.domain}：有効期限を確かめられませんでした`, '登録先の管理画面で、自動更新がオンかを確認してください'));
      else items.push(item(d.expDays <= 30 ? 'ng' : d.expDays <= 60 ? 'warn' : 'ok', 'ドメイン', `${d.domain}：有効期限 ${d.expiry}（残り ${d.expDays} 日）`, d.expDays <= 60 ? 'お客さまに自動更新とカードの期限を確かめてもらってください' : ''));
    }
  }
  if (!domains.length) items.push(item('info', 'ドメイン', '独自ドメインで公開中のHPはまだありません'));

  const order = { ng: 0, warn: 1, info: 2, ok: 3 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  const result = { at: Date.now(), items, ng: items.filter((x) => x.level === 'ng').length, warn: items.filter((x) => x.level === 'warn').length };
  setSetting('health_last', JSON.stringify(result));
  return result;
}
export const lastCheck = () => { try { return JSON.parse(getSetting('health_last') || 'null'); } catch { return null; } };

const LABEL = { ng: '【要対応】', warn: '【注意】', info: '【お知らせ】', ok: '【問題なし】' };
export function reportText(r, baseUrl) {
  const lines = r.items.map((x) => `${LABEL[x.level]} ${x.area}｜${x.title}${x.detail ? `\n　　${x.detail}` : ''}`);
  return `停止につながる問題がないか、自動で点検しました（${jstDay(r.at)}）。\n要対応 ${r.ng} 件／注意 ${r.warn} 件\n\n${lines.join('\n')}\n\n■ 手で確かめること（毎週）\n・GitHub から「監視」の失敗メールが来ていないか\n・今週のシステム更新は、お店の営業時間外（平日 6:00〜10:00 など）に行ったか\n\n点検の画面：${baseUrl}/admin/health`;
}

// /healthz/full（外部の監視が1時間ごとに見る）：お客さまの情報は出さない
export function quickStatus() {
  const problems = [];
  try { one('SELECT 1 AS ok'); } catch { problems.push('db'); }
  try { const st = statfsSync(DATA_DIR); if (1 - st.bavail / st.blocks >= 0.95) problems.push('disk'); } catch {}
  if (!existsSync(SITES_DIR)) problems.push('sites');
  try { statSync(path.join(SITES_DIR)); } catch { problems.push('sites'); }
  return problems;
}

// 毎日：外部バックアップ＋ドメインの簡易点検（問題があるときだけメール）。毎週月曜 9時：点検レポート
export function startHealthJobs({ baseUrl }) {
  const tick = async () => {
    const day = jstDay(), hourJst = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
    try {
      if (offsiteReady() && getSetting('offsite_day') !== day && hourJst >= 4) {
        setSetting('offsite_day', day);
        try { const b = await offsiteBackup(); console.log(`[外部バックアップ] ${b.day}（${Math.round(b.size / 1024)}KB）`); }
        catch (e) { console.error('[外部バックアップの失敗]', e.message); sendMail({ to: ADMIN_TO(), subject: '【要対応】外部へのバックアップに失敗しました', text: `${e.message}\n\n点検の画面：${baseUrl}/admin/health` }); }
      }
      if (getSetting('domain_check_day') !== day && hourJst >= 7) {
        setSetting('domain_check_day', day);
        const bad = (await checkDomains({ withExpiry: false })).filter((d) => !d.dns.ok || !d.cert.ok || !d.page.ok);
        if (bad.length) sendMail({ to: ADMIN_TO(), subject: `【要対応】表示できていない可能性があるHPが ${bad.length} 件あります`,
          text: bad.map((d) => `・${d.business_name}（${d.domain}）\n　${[d.dns, d.cert, d.page].map((x) => x.detail).join('／')}`).join('\n') + `\n\n点検の画面：${baseUrl}/admin/health` });
      }
      const dow = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();
      if (dow === 1 && hourJst >= 9 && getSetting('weekly_check_day') !== day) {
        setSetting('weekly_check_day', day);
        const r = await runCheck();
        sendMail({ to: ADMIN_TO(), subject: `【Web係】週1回の停止リスク点検：要対応 ${r.ng} 件／注意 ${r.warn} 件`, text: reportText(r, baseUrl) });
      }
    } catch (e) { console.error('[点検の失敗]', e.message); }
  };
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 30 * 60 * 1000).unref();
}
