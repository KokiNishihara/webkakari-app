// チャット修正で「デザインの統一感」と「読みやすさ」を守るための決まりごと。
// AIの出力をそのまま載せず、ここで ①表記をそろえる ②長さ・言い回しを確認する。
// 引っかかったら AI に理由を伝えて1回だけ書き直させ、それでもだめなら担当者に回す。

// --- 表記のそろえ方（このサイトでいま使っている書き方を調べて、それに合わせる）
export function siteNotation(regions) {
  const all = regions.filter((r) => r.type === 'text').map((r) => r.value).join('\n')
    + regions.filter((r) => r.type === 'list').flatMap((r) => r.items.flatMap((it) => Object.values(it))).join('\n');
  const count = (re) => (all.match(re) || []).length;
  return {
    tilde: count(/〜/g) >= count(/～/g) ? '〜' : '～',             // 時間・期間の「から」
    yenSuffix: count(/\d円/g) >= count(/[¥￥]\s?\d/g),             // 1,000円 か ¥1,000 か
    comma: count(/\d,\d{3}/g) >= count(/\d{4,}円/g),               // 1,000 か 1000 か
    timeColon: count(/\d{1,2}:\d{2}/g) >= count(/\d{1,2}時/g),     // 11:30 か 11時30分 か
  };
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/gu;

// 機械的にそろえられるものは、ここで直してしまう
export function normalizeValue(value, notation) {
  let v = String(value ?? '');
  v = v.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));  // 数字は半角
  v = v.replace(/[Ａ-Ｚａ-ｚ]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
  v = v.replace(EMOJI, '');
  v = v.replace(/！{2,}|!{2,}/g, '！').replace(/!/g, '！').replace(/\?/g, '？');
  v = v.replace(/(\d{1,2}:\d{2})\s*[-~〜～ー－]\s*(\d{1,2}:\d{2})/g, `$1${notation.tilde}$2`);     // 時間の範囲
  v = v.replace(/[〜～]/g, notation.tilde);
  if (notation.yenSuffix) v = v.replace(/[¥￥]\s?([\d,]+)/g, '$1円');
  if (notation.comma) v = v.replace(/(\d{4,})(?=円)/g, (n) => Number(n).toLocaleString('ja-JP'));
  v = v.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return v;
}

// AIが書きがちで、小さなお店のHPでは浮いてしまう言い回し（見つけたら書き直させる）
const AI_PHRASES = [
  'こだわりの', '心を込めて', '至福', '極上', '贅沢なひととき', '特別なひととき', '素敵なひととき', 'ひとときを',
  '実現します', 'お届けします', '提供いたします', 'お待ちしております！', 'ぜひ一度', 'ぜひお気軽に',
  '魅力', '厳選', '唯一無二', '最高の', '珠玉', '五感で', '彩り豊か', '新たな', '〜しませんか', 'しませんか？',
  '—', '──', '「」',
];

// 場所ごとの長さの上限：HTMLに data-max があればそれ、なければ今の長さから決める
export function lengthLimit(region) {
  if (region.max) return region.max;
  const cur = [...String(region.value || '')].length;
  if (/catch|title|name|cta/.test(region.key)) return Math.max(cur + 6, Math.ceil(cur * 1.3));
  if (cur <= 20) return Math.max(24, cur + 12);
  return Math.ceil(cur * 1.8) + 20;
}

// 変更案の確認。返すのは「AIに伝える指摘」の一覧
export function reviewProposal({ regions, changes, listChanges }) {
  const issues = [];
  const byKey = Object.fromEntries(regions.map((r) => [r.key, r]));
  const check = (where, region, value, limit) => {
    const len = [...value].length;
    if (limit && len > limit) issues.push(`${where}が長すぎます（${len}文字。${limit}文字以内に。デザインが崩れるため）`);
    const lines = value.split('\n').length, curLines = String(region?.value ?? '').split('\n').length;
    if (lines > Math.max(curLines + 2, 3)) issues.push(`${where}の改行が多すぎます（${lines}行）`);
    for (const p of AI_PHRASES) if (value.includes(p)) issues.push(`${where}の「${p}」は広告っぽく浮くので、ふつうの言い方に`);
    if (/[!！]/.test(value) && (value.match(/[!！]/g) || []).length > 1) issues.push(`${where}の「！」は1つまでに`);
  };
  for (const c of changes) {
    const r = byKey[c.key];
    if (!r || r.type !== 'text') continue;
    check(`「${r.label}」`, r, c.new_value, lengthLimit(r));
  }
  for (const lc of listChanges || []) {
    const r = byKey[lc.key];
    if (!r || r.type !== 'list') continue;
    if (lc.items.length > r.maxItems) issues.push(`「${r.label}」は${r.maxItems}件までです（${lc.items.length}件）`);
    if (!lc.items.length) issues.push(`「${r.label}」を空にはできません`);
    lc.items.forEach((it, i) => {
      for (const f of r.fields) {
        const v = it[f.name] ?? '';
        if (!v.trim()) issues.push(`「${r.label}」${i + 1}件目の「${f.label}」が空です`);
        else check(`「${r.label}」${i + 1}件目の「${f.label}」`, null, v, f.max);
      }
    });
  }
  return [...new Set(issues)];
}

// AIへの書き方の決まり（system プロンプトに入れる）
export const WRITING_RULES = `文章の決まり（デザインと読みやすさを守るため、必ず守る）：
- これまでのサイトの文章と同じ口調・同じ長さ感で書く。current の文字数を大きく超えない。
- 店主がふだん話す言葉で、短く、事実だけ。飾った形容詞・キャッチコピー調・宣伝文句は使わない。
- 使わない言い回し：${AI_PHRASES.filter((p) => p.length > 1).join('、')}。絵文字、「！」の連発、ダッシュ（—）も使わない。
- 表記は今のサイトに合わせる（数字は半角、時間の範囲は notation.tilde、価格は notation の書き方）。
- 改行は今と同じくらいにとどめる。箇条書きの記号（・や-）を新しく足さない。
- 一覧（type: list）は、1件の中身を fields の項目に分けて入れる。並び順は、指示がなければ今の順番を保つ。`;
