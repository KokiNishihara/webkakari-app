// 営業用のサービスサイト（院のWeb係・飲食店のWeb係）を、このサーバーで配信できるよう app/service-sites/ に取り込む。
// 元は ~/仕事/05_HP制作保守事業/service-site（院）と service-site-food（飲食店）。
// 公開に必要なファイル（HTMLから参照されているもの）だけを集め、大きな写真は縮めてから入れる。
// 使い方：node scripts/sync-service-sites.mjs   （サイトを直したら、もう一度実行してから GitHub に上げる）
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const SRC = path.join(os.homedir(), '仕事/05_HP制作保守事業');
const OUT = path.resolve('service-sites');
const SITES = { clinic: 'service-site', food: 'service-site-food' };
const ENTRY = ['index.html', 'tokushoho.html', 'privacy.html'];
// デザインの見本（架空の店・医院）。各サービスサイトの中の mihon/<名前>/ に入れる（例：/service/food/mihon/toshin/）
const MIHON = {
  'food/mihon/toshin': '見本_高級和食_灯心', 'food/mihon/shirahi': '見本_寿司', 'food/mihon/suginoya': '見本_蕎麦',
  'food/mihon/hinoji': '見本_焼肉', 'food/mihon/chispa': '見本_タコス',
  'clinic/mihon/nagi': '見本_美容外科', 'clinic/mihon/hanamizuki': '見本_歯科', 'clinic/mihon/sorano': '見本_整骨院',
};
const JOBS = [...Object.entries(SITES).map(([k, d]) => [k, d, ENTRY]), ...Object.entries(MIHON).map(([k, d]) => [k, d, ['index.html']])];

for (const [key, dir, entry] of JOBS) {
  const root = path.join(SRC, dir);
  const out = path.join(OUT, key);
  rmSync(out, { recursive: true, force: true });
  const queue = entry.filter((f) => existsSync(path.join(root, f)));
  const seen = new Set();
  let bytes = 0;
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = path.join(root, rel);
    if (!existsSync(src) || !src.startsWith(root)) { console.warn(`  見つからない：${key}/${rel}`); continue; }
    const dst = path.join(out, rel);
    mkdirSync(path.dirname(dst), { recursive: true });
    if (rel.endsWith('.html') || rel.endsWith('.css')) {
      const text = readFileSync(src, 'utf8');
      writeFileSync(dst, text);
      bytes += Buffer.byteLength(text);
      // このファイルから参照されている自サイト内のファイルを集める
      const refs = [...text.matchAll(/(?:src|href|content)="([^"#?:]+\.(?:jpg|jpeg|png|webp|svg|html|css|js|ico))"|url\(\s*["']?([^)"'?:]+\.(?:jpg|jpeg|png|webp|svg))/gi)].map((m) => m[1] || m[2]);
      for (const r of refs) {
        if (/^(https?:|\/\/|data:)/.test(r)) continue;
        const next = path.normalize(path.join(path.dirname(rel), r));
        if (!next.startsWith('..')) queue.push(next);
      }
    } else if (/\.(jpe?g)$/i.test(rel) && statSync(src).size > 400 * 1024) {
      const buf = await sharp(src).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true, progressive: true }).toBuffer();
      writeFileSync(dst, buf); bytes += buf.length;
    } else {
      const buf = readFileSync(src); writeFileSync(dst, buf); bytes += buf.length;
    }
  }
  console.log(`${key}: ${seen.size} ファイル・${(bytes / 1024 / 1024).toFixed(1)}MB → service-sites/${key}`);
}
