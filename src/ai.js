// チャットの依頼 → 変更案（JSON）。HPの「印の付いた場所」だけを変える。
// ANTHROPIC_API_KEY が無いときは、仮の動作（モック）で流れだけ確認できる。
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { siteNotation, normalizeValue, reviewProposal, lengthLimit, WRITING_RULES } from './style.js';

const MODEL = 'claude-opus-5-5';

const ProposalSchema = z.object({
  understood: z.boolean(),                 // 依頼を理解して変更案を作れたか
  needs_admin: z.boolean(),                // デザイン変更・ページ追加など、自動では対応しない依頼か
  admin_reason: z.string(),                // needs_admin のときの理由（社内向け）
  customer_note: z.string(),               // 一部だけ自動でできたとき、できなかった部分の説明（お客さま向け・やさしい言葉で1文。なければ空）
  question: z.string(),                    // 情報が足りないときにお客さまへ聞くこと（不要なら空）
  summary: z.string(),                     // 変更内容のひとこと要約（お客さま向け）
  changes: z.array(z.object({
    key: z.string(),                       // 変える場所の key（regions にあるものだけ）
    new_value: z.string(),                 // 新しい中身（文章、または画像のパス）
  })),
  list_changes: z.array(z.object({         // 一覧（メニュー・料金表など）を変えるときは、変更後の全件を入れる
    key: z.string(),
    items: z.array(z.array(z.object({ field: z.string(), value: z.string() }))),
  })),
  guideline_warnings: z.array(z.string()), // 医療広告ガイドライン等で気になる表現（なければ空）
});

// プライバシーポリシー：AIには掲載予定の情報と依頼内容だけを渡す。電話番号・メールアドレスは
// ［電話番号1］のような印に置き換えて渡し（AIは番号そのものを見ない）、AIの案ができたあとで元に戻す。
// こうすると「電話番号が変わりました」のような依頼も、番号をAIに渡さずに反映できる。
export function maskPersonalInfo(text) {
  const map = {};
  const n = { mail: 0, tel: 0 };
  const masked = String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => { const k = `［メールアドレス${++n.mail}］`; map[k] = m; return k; })
    .replace(/0\d{1,4}[-‐ー−\s]?\d{1,4}[-‐ー−\s]?\d{3,4}/g, (m) => { const k = `［電話番号${++n.tel}］`; map[k] = m.replace(/[‐ー−\s]/g, '-'); return k; });
  return { text: masked, map };
}
const unmask = (v, map) => Object.entries(map).reduce((s, [k, real]) => s.replaceAll(k, real), String(v));

// 医療広告ガイドラインで使えない代表的な表現（AIとは別に機械的にも確認する）
const CLINIC_NG = ['日本一', 'No.1', 'ナンバーワン', '最高', '最先端', '絶対', '必ず治', '痛くない', '100%', '完全', '安心安全'];
export function guidelineCheck(businessType, changes, listChanges = []) {
  if (businessType !== 'clinic') return [];
  const hits = [];
  const values = [...changes.map((c) => c.new_value), ...listChanges.flatMap((l) => l.items.flatMap((it) => Object.values(it)))];
  for (const v of values) for (const w of CLINIC_NG) if (v.includes(w)) hits.push(`「${w}」は医療広告ガイドラインで使えない可能性があります`);
  return hits;
}

const SYSTEM = `あなたは小さな飲食店・医院のホームページを運用する「Web係」です。
お客さま（店主・院長）からチャットで届いた修正依頼を、ホームページの変更案にします。

守ること：
- 変更できるのは regions に並んだ場所だけ。key は regions にあるものを正確に使う。
- type が list の場所（メニュー・料金表など）は list_changes に「変更後の全件」を入れる。1件は fields の name ごとに {field, value} で表す。件数は max_items まで。
- 文字数は各場所の max_chars 以内に必ず収める。収まらないときは要点だけに短くする。
- デザイン・レイアウト・色・文字の大きさ・ページの追加・新しい機能の依頼は自動では対応しない。needs_admin を true にし、admin_reason に理由を書く。
- 依頼の一部だけが自動でできる場合は、できる部分を changes / list_changes に入れたうえで needs_admin を true にし、できなかった部分を customer_note にお客さま向けに書く（例：「目立たせる見た目の変更は、担当者からご相談のご連絡をします。」）。
- 「来週の水曜」のような言い方は today をもとに日付にする。依頼文の日付と曜日が食い違うとき（例：10/29は木曜なのに「水曜」）は、どちらか決めつけず question で確認する。
- 依頼があいまいで決めきれないとき（日付や金額が不明など）は、changes を空にして question に短い質問を書く。
- ［電話番号1］［メールアドレス1］のような印は、お客さまが書いた番号・アドレスの代わり。載せるときは印をそのまま書く（あとで本物に置き換わる）。
- 写真が添付されたら、どの画像の場所を替えるべきか判断し、new_value に添付写真のパス（attached_image）を入れる。
- 文章はお店のこれまでの口調に合わせ、丁寧で短く。誇大な表現や事実でないことは書かない。
- 医院のサイトでは、医療広告ガイドラインで使えない表現（最上級・効果の保証・体験談など）を避け、気になる点は guideline_warnings に書く。
- summary はお客さま向けに、何をどう変えたかを1文・50文字以内で（一覧に表示するため）。補足や確認したいことは question か customer_note に書く。

${WRITING_RULES}`;

export async function proposeChanges({ businessType, businessName, regions, requestText, attachedImage }) {
  const { text: masked, map } = maskPersonalInfo(requestText);
  if (!process.env.ANTHROPIC_API_KEY) return mockProposal({ regions, requestText: masked, attachedImage });

  const client = new Anthropic();
  const notation = siteNotation(regions);
  const payload = {
    business: { name: businessName, type: businessType === 'clinic' ? '医院・治療院' : '飲食店' },
    today: new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
    notation,
    regions: regions.map((r) => (r.type === 'list'
      ? { key: r.key, type: 'list', label: r.label, max_items: r.maxItems, fields: r.fields.map((f) => ({ name: f.name, label: f.label, max_chars: f.max })), current: r.items }
      : { key: r.key, type: r.type, label: r.label, current: r.value, ...(r.type === 'text' ? { max_chars: lengthLimit(r) } : {}) })),
    request: masked,
    attached_image: attachedImage || null,
  };
  const messages = [{ role: 'user', content: JSON.stringify(payload) }];
  let parsed, issues = [];
  // 1回目の案を確認し、決まりに合わない点があれば理由を伝えて1回だけ書き直してもらう
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: zodOutputFormat(ProposalSchema) },
      system: SYSTEM,
      messages,
    });
    if (res.stop_reason === 'refusal') {
      return { understood: false, needs_admin: true, admin_reason: 'AIが応答を控えました', customer_note: '', question: '', summary: '', changes: [], list_changes: [], guideline_warnings: [] };
    }
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    parsed = tidy(ProposalSchema.parse(JSON.parse(text)), regions, notation, map);
    if (parsed.question || (parsed.needs_admin && !parsed.changes.length && !parsed.list_changes.length)) return parsed;
    issues = reviewProposal({ regions, changes: parsed.changes, listChanges: parsed.list_changes });
    if (!issues.length) break;
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: `次の点を直して、同じ形式で出し直してください。\n- ${issues.join('\n- ')}` });
  }
  parsed.style_issues = issues; // 書き直しても残った指摘（担当者が確認する）
  return parsed;
}

// AIの案を整える：存在しない場所への変更を捨て、表記をそろえ、一覧を {項目: 値} の形にする
function tidy(p, regions, notation, map = {}) {
  const byKey = Object.fromEntries(regions.map((r) => [r.key, r]));
  p.changes = p.changes.filter((c) => byKey[c.key] && byKey[c.key].type !== 'list')
    .map((c) => (byKey[c.key].type === 'text' ? { ...c, new_value: normalizeValue(unmask(c.new_value, map), notation) } : c));
  p.list_changes = (p.list_changes || []).filter((l) => byKey[l.key]?.type === 'list').map((l) => {
    const names = new Set(byKey[l.key].fields.map((f) => f.name));
    return { key: l.key, items: l.items.map((pairs) => Object.fromEntries(pairs.filter((x) => names.has(x.field)).map((x) => [x.field, normalizeValue(unmask(x.value, map), notation)]))) };
  });
  return p;
}

// 仮の動作：お知らせ欄（key に news を含む場所）に依頼文を載せる。写真はトップ画像を差し替える。
function mockProposal({ regions, requestText, attachedImage }) {
  const changes = [];
  const news = regions.find((r) => r.type === 'text' && /news|notice/.test(r.key));
  const last = requestText.split('\n').filter((l) => l.startsWith('お客さま：')).pop()?.replace('お客さま：', '') || requestText;
  if (news) changes.push({ key: news.key, new_value: last.slice(0, 120) });
  const img = regions.find((r) => r.type === 'image');
  if (attachedImage && img) changes.push({ key: img.key, new_value: attachedImage });
  return {
    understood: changes.length > 0,
    needs_admin: changes.length === 0,
    admin_reason: changes.length ? '' : '（仮の動作）変更できる場所が見つかりませんでした',
    customer_note: '',
    question: '',
    summary: changes.length ? '（仮の動作）お知らせ欄にご依頼の内容を載せました。' : '',
    changes,
    list_changes: [],
    guideline_warnings: [],
    style_issues: [],
    mock: true,
  };
}
