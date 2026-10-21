// お客さまのHPの版管理。
// HP側で「AIが触ってよい場所」に印を付けておく：
//   文章  <p data-edit="hours" data-label="営業時間">…</p>
//   画像  <img data-edit-img="hero" data-label="トップの写真" src="…">
// AIはこの印の中身しか変えられない（デザインやページ構成は壊れない）。
import { mkdirSync, readFileSync, writeFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { one, run, now, audit } from './db.js';

export const SITES_DIR = process.env.SITES_DIR || path.resolve('sites');

export const versionDir = (slug, versionId) => path.join(SITES_DIR, slug, `v${versionId}`);

const TEXT_RE = /<([a-z0-9]+)\b([^>]*?)\sdata-edit="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/gi;
const IMG_RE = /<img\b([^>]*?)\sdata-edit-img="([^"]+)"([^>]*?)>/gi;
const attr = (s, name) => (s.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

const toPlain = (html) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
const toHtml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

export function extractRegions(html) {
  const out = [];
  for (const m of html.matchAll(TEXT_RE)) {
    const attrs = m[2] + m[4];
    out.push({ key: m[3], type: 'text', label: attr(attrs, 'data-label') || m[3], value: toPlain(m[5]) });
  }
  for (const m of html.matchAll(IMG_RE)) {
    const attrs = m[1] + m[3];
    out.push({ key: m[2], type: 'image', label: attr(attrs, 'data-label') || m[2], value: attr(attrs, 'src') || '' });
  }
  return out;
}

// changes: [{ key, new_value }]。印のない場所への変更は無視する。
export function applyChanges(html, changes) {
  const byKey = new Map(changes.map((c) => [c.key, c.new_value]));
  let out = html.replace(TEXT_RE, (full, tag, a1, key, a2, inner) =>
    byKey.has(key) ? `<${tag}${a1} data-edit="${key}"${a2}>${toHtml(byKey.get(key))}</${tag}>` : full);
  out = out.replace(IMG_RE, (full, a1, key, a2) => {
    if (!byKey.has(key)) return full;
    const replaced = (a1 + a2).replace(/\ssrc="[^"]*"/, '');
    return `<img${replaced.startsWith(' ') ? '' : ' '}${replaced.trim()} data-edit-img="${key}" src="${byKey.get(key)}">`;
  });
  return out;
}

export function readVersionHtml(slug, versionId) {
  return readFileSync(path.join(versionDir(slug, versionId), 'index.html'), 'utf8');
}

// 新しい版を作る（親の版をまるごと複製してから中身を差し替える）
export function createVersion({ site, parentId, html, note, createdBy, requestId = null, extraFiles = [] }) {
  const info = run('INSERT INTO versions (site_id, parent_id, request_id, note, created_by, created_at) VALUES (?,?,?,?,?,?)',
    site.id, parentId, requestId, note, createdBy, now());
  const vid = Number(info.lastInsertRowid);
  const dir = versionDir(site.slug, vid);
  if (parentId) cpSync(versionDir(site.slug, parentId), dir, { recursive: true });
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), html);
  for (const f of extraFiles) writeFileSync(path.join(dir, f.relPath), f.buffer);
  return vid;
}

// 公開＝本番の版を切り替えるだけ（ファイルは消さないので、いつでも戻せる）
export async function publishVersion(siteId, versionId, actor) {
  const site = one('SELECT * FROM sites WHERE id = ?', siteId);
  const v = one('SELECT * FROM versions WHERE id = ? AND site_id = ?', versionId, siteId);
  if (!site || !v) throw new Error('版が見つかりません');
  await deploy(site, versionId);
  run('UPDATE sites SET live_version_id = ? WHERE id = ?', versionId, siteId);
  audit(actor, 'publish', `site=${site.slug} version=${versionId}`);
}

// 公開先。いまは管理システム自身が /s/:slug で配信する。
// 本番では Cloudflare Pages に版ごとにアップロードし、本番の向き先を切り替える（未実装）。
async function deploy(site, versionId) {
  if (process.env.DEPLOY_TARGET === 'cloudflare') {
    throw new Error('Cloudflare Pages への公開は未実装です（アカウント作成後に実装）');
  }
  if (!existsSync(path.join(versionDir(site.slug, versionId), 'index.html'))) throw new Error('版のファイルがありません');
}

export function listVersionFiles(slug, versionId) {
  return readdirSync(versionDir(slug, versionId), { recursive: true });
}
