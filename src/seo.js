// SEO（検索対策）のうち、HPの中身から機械的に作れるものを配信時に入れる。
// チャットで営業時間や住所を変えると、Google 向けの情報（構造化データ・説明文）も自動で新しくなる。
// 中身の判断（キーワードの選び方・文章）は人が制作時に行う。根拠：web-design-pro スキルの references/local-seo.md
import { extractRegions } from './sites.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAYS = [['月', 'Monday'], ['火', 'Tuesday'], ['水', 'Wednesday'], ['木', 'Thursday'], ['金', 'Friday'], ['土', 'Saturday'], ['日', 'Sunday']];

// 「11:30〜14:00／17:30〜22:00」＋「日曜日・祝日」→ 構造化データの営業時間（読めないときは入れない）
export function openingHours(hoursText, holidayText) {
  const ranges = [...String(hoursText || '').normalize('NFKC').matchAll(/(\d{1,2}):(\d{2})\s*[~〜～\-ー－]\s*(\d{1,2}):(\d{2})/g)]
    .map((m) => [`${m[1].padStart(2, '0')}:${m[2]}`, `${m[3].padStart(2, '0')}:${m[4]}`]);
  if (!ranges.length) return null;
  const hol = String(holidayText || '');
  if (/午後|午前|第\d|隔週|不定/.test(hol)) return null; // 曜日の一部だけ休み等は機械で正しく書けないので入れない
  const open = DAYS.filter(([jp]) => !new RegExp(`${jp}(曜|・|、|，|,|\\s|$)`).test(hol)).map(([, en]) => en);
  if (!open.length) return null;
  return ranges.map(([opens, closes]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: open, opens, closes }));
}

const textOf = (regions, key) => regions.find((r) => r.key === key && r.type === 'text')?.value || '';
const ward = (addr) => (String(addr).match(/([^\s都道府県]{1,6}?[区市町村])/) || [])[1] || '';

export function seoInject(html, { site, customer, baseUrl }) {
  const regions = extractRegions(html);
  const name = textOf(regions, 'name') || customer.business_name;
  const address = textOf(regions, 'address');
  const tel = textOf(regions, 'tel');
  const intro = textOf(regions, 'intro') || textOf(regions, 'catch');
  const origin = site.domain ? `https://${site.domain}` : `${baseUrl}/s/${site.slug}`;
  const kind = customer.business_type === 'clinic' ? '医院' : '飲食店';
  const area = ward(address);
  let out = html;

  // タイトル：店名だけなら「店名｜地域の業種」にする（制作時に人が書いたタイトルはそのまま）
  out = out.replace(/<title>([^<]*)<\/title>/, (m, t) => (t.trim() === name.trim() && area ? `<title>${esc(`${name}｜${area}の${kind}`)}</title>` : m));
  // 説明文：無ければ紹介文から作る（検索結果の2行の説明になる）
  if (!/<meta\s+name="description"/i.test(out) && intro) {
    const d = intro.replace(/\s+/g, ' ').slice(0, 110);
    out = out.replace(/<\/title>/, `</title>\n<meta name="description" content="${esc(d)}">`);
  }
  // 正規のURL（同じ中身が複数のURLで見えても、検索エンジンにはこのURLを正とする）
  if (!/rel="canonical"/i.test(out)) out = out.replace(/<\/head>/i, `<link rel="canonical" href="${esc(origin)}/">\n</head>`);
  // 構造化データ（Google に店名・住所・電話・営業時間を正確に伝える）
  const ld = {
    '@context': 'https://schema.org',
    '@type': customer.business_type === 'clinic' ? 'MedicalClinic' : 'Restaurant',
    name,
    url: `${origin}/`,
    ...(address ? { address: { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'JP' } } : {}),
    ...(tel ? { telephone: tel } : {}),
    ...(regions.find((r) => r.key === 'hero' && r.type === 'image') ? { image: `${origin}/${regions.find((r) => r.key === 'hero').value}` } : {}),
  };
  const oh = openingHours(textOf(regions, 'hours'), textOf(regions, 'holiday'));
  if (oh) ld.openingHoursSpecification = oh;
  out = out.replace(/<script type="application\/ld\+json" id="ld-auto">[\s\S]*?<\/script>\s*/, '');
  out = out.replace(/<\/head>/i, `<script type="application/ld+json" id="ld-auto">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n</head>`);
  return out;
}

export const robotsTxt = (origin) => `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
export const sitemapXml = (origin, lastmod) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc><lastmod>${lastmod}</lastmod></url></urlset>\n`;
