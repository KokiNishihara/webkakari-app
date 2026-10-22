// 料金の計算。正は ~/仕事/05_HP制作保守事業/商品一覧_料金表.md（2026-10-19改定）。
// 月額は「選んだ商品」でセット料金が自動で決まり、そこに契約ごとの追加・調整を足す。
// 金額はすべて税込・円。

export const PRODUCTS = {
  hp: { label: 'ホームページ', monthly: 9800 },
  gmap: { label: 'Googleマップ', monthly: 14800 },
  line: { label: '公式LINE', monthly: 9800 },
};

// セット料金（キーは商品の組み合わせを並べ替えたもの）
const SETS = {
  'hp+line': 16800,
  'gmap+hp': 21800,
  'gmap+line': 21800,
  'gmap+hp+line': 29800,
};

// 契約ごとに足す行のひな形（金額は相談して決める）
export const ONE_TIME_PRESETS = [
  { key: 'domain', label: '独自ドメインの取得（初年度・実費）', hint: 'HPなし・ドメインなし（状態A1/A4）のとき。年1,500〜4,000円' },
  { key: 'line_setup', label: '公式LINEの初期構築', hint: '公式LINEを新しく始める（状態C1）とき。お見積り' },
  { key: 'extra_build', label: '追加の制作', hint: 'ページ追加・原稿作成・撮影手配など。お見積り' },
  { key: 'setup', label: '初期設定費', hint: '相談時に決めた初期費用（要相談）' },
];
export const MONTHLY_PRESETS = [
  { key: 'lstep', label: 'Lステップの運用', hint: '医院向け。お見積り' },
];

export const BRAND = (businessType) => (businessType === 'clinic' ? '院のWeb係' : '飲食店のWeb係');

const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;
const toInt = (v) => { const n = Math.round(Number(String(v ?? '').normalize('NFKC').replace(/[,円\s]/g, ''))); return Number.isFinite(n) ? n : 0; };

// 管理画面のフォーム → 料金の条件（DBに JSON で保存する形）
export function readBillingForm(body) {
  const products = Object.keys(PRODUCTS).filter((k) => body[`p_${k}`]);
  const rows = (prefix) => {
    const labels = [].concat(body[`${prefix}_label`] ?? []), amounts = [].concat(body[`${prefix}_amount`] ?? []);
    return labels.map((l, i) => ({ label: String(l).trim().slice(0, 60), amount: toInt(amounts[i]) })).filter((r) => r.label && r.amount > 0);
  };
  return {
    products,
    monthly_extras: rows('m'),
    one_time: rows('o'),
    discount: { amount: Math.max(0, toInt(body.discount_amount)), reason: String(body.discount_reason || '').trim().slice(0, 60) },
    note: String(body.billing_note || '').trim().slice(0, 300),
  };
}

// 料金の条件 → 見積り（お客さまに見せる明細と合計）
export function computeQuote(billing, businessType) {
  const b = billing || { products: ['hp'], monthly_extras: [], one_time: [], discount: { amount: 0 } };
  const products = Object.keys(PRODUCTS).filter((k) => b.products?.includes(k));
  const brand = BRAND(businessType);
  const problems = [];
  if (!products.length) problems.push('商品を1つ以上選んでください');

  const base = products.length ? (SETS[[...products].sort().join('+')] ?? products.reduce((s, k) => s + PRODUCTS[k].monthly, 0)) : 0;
  const single = products.reduce((s, k) => s + PRODUCTS[k].monthly, 0);
  const monthly = [];
  if (products.length) {
    monthly.push({
      kind: 'base',
      label: `${brand} 月額（${products.map((k) => PRODUCTS[k].label).join('＋')}）`,
      amount: base,
      note: base < single ? `セット料金（単品合計より${yen(single - base)}お得）` : '',
    });
  }
  for (const r of b.monthly_extras || []) monthly.push({ kind: 'extra', label: r.label, amount: r.amount });
  const monthlyGross = monthly.reduce((s, r) => s + r.amount, 0);
  const discount = Math.min(b.discount?.amount || 0, monthlyGross);
  if ((b.discount?.amount || 0) > 0 && !b.discount.reason) problems.push('値引きには理由を入れてください（あとで経緯が分からなくなるため）');
  const oneTime = (b.one_time || []).map((r) => ({ label: r.label, amount: r.amount }));

  return {
    products,
    monthly,
    discount: discount ? { amount: discount, reason: b.discount.reason } : null,
    monthlyTotal: monthlyGross - discount,
    oneTime,
    oneTimeTotal: oneTime.reduce((s, r) => s + r.amount, 0),
    firstPayment: monthlyGross - discount + oneTime.reduce((s, r) => s + r.amount, 0),
    planCode: products.join(','),
    problems,
  };
}

export const fmtYen = yen;
