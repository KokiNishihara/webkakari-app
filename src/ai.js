// チャットの依頼 → 変更案（JSON）。HPの「印の付いた場所」だけを変える。
// ANTHROPIC_API_KEY が無いときは、仮の動作（モック）で流れだけ確認できる。
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const MODEL = 'claude-opus-5-5';

const ProposalSchema = z.object({
  understood: z.boolean(),                 // 依頼を理解して変更案を作れたか
  needs_admin: z.boolean(),                // デザイン変更・ページ追加など、自動では対応しない依頼か
  admin_reason: z.string(),                // needs_admin のときの理由（社内向け）
  question: z.string(),                    // 情報が足りないときにお客さまへ聞くこと（不要なら空）
  summary: z.string(),                     // 変更内容のひとこと要約（お客さま向け）
  changes: z.array(z.object({
    key: z.string(),                       // 変える場所の key（regions にあるものだけ）
    new_value: z.string(),                 // 新しい中身（文章、または画像のパス）
  })),
  guideline_warnings: z.array(z.string()), // 医療広告ガイドライン等で気になる表現（なければ空）
});

// プライバシーポリシー：AIには掲載予定の情報と依頼内容だけを渡す。個人情報らしきものは伏せる。
export function maskPersonalInfo(text) {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '［メールアドレス］')
    .replace(/0\d{1,4}[-‐ー−\s]?\d{1,4}[-‐ー−\s]?\d{3,4}/g, '［電話番号］');
}

// 医療広告ガイドラインで使えない代表的な表現（AIとは別に機械的にも確認する）
const CLINIC_NG = ['日本一', 'No.1', 'ナンバーワン', '最高', '最先端', '絶対', '必ず治', '痛くない', '100%', '完全', '安心安全'];
export function guidelineCheck(businessType, changes) {
  if (businessType !== 'clinic') return [];
  const hits = [];
  for (const c of changes) for (const w of CLINIC_NG) if (c.new_value.includes(w)) hits.push(`「${w}」は医療広告ガイドラインで使えない可能性があります`);
  return hits;
}

const SYSTEM = `あなたは小さな飲食店・医院のホームページを運用する「Web係」です。
お客さま（店主・院長）からチャットで届いた修正依頼を、ホームページの変更案にします。

守ること：
- 変更できるのは regions に並んだ場所だけ。key は regions にあるものを正確に使う。
- デザイン・レイアウト・色・ページの追加・新しい機能の依頼は自動では対応しない。needs_admin を true にし、admin_reason に理由を書く。
- 依頼があいまいで決めきれないとき（日付や金額が不明など）は、changes を空にして question に短い質問を書く。
- 写真が添付されたら、どの画像の場所を替えるべきか判断し、new_value に添付写真のパス（attached_image）を入れる。
- 文章はお店のこれまでの口調に合わせ、丁寧で短く。誇大な表現や事実でないことは書かない。
- 医院のサイトでは、医療広告ガイドラインで使えない表現（最上級・効果の保証・体験談など）を避け、気になる点は guideline_warnings に書く。
- summary はお客さま向けに、何をどう変えたかを1〜2文で。`;

export async function proposeChanges({ businessType, businessName, regions, requestText, attachedImage }) {
  const masked = maskPersonalInfo(requestText);
  if (!process.env.ANTHROPIC_API_KEY) return mockProposal({ regions, requestText: masked, attachedImage });

  const client = new Anthropic();
  const payload = {
    business: { name: businessName, type: businessType === 'clinic' ? '医院・治療院' : '飲食店' },
    regions: regions.map(({ key, type, label, value }) => ({ key, type, label, current: value })),
    request: masked,
    attached_image: attachedImage || null,
  };
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: zodOutputFormat(ProposalSchema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  if (res.stop_reason === 'refusal') {
    return { understood: false, needs_admin: true, admin_reason: 'AIが応答を控えました', question: '', summary: '', changes: [], guideline_warnings: [] };
  }
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const parsed = ProposalSchema.parse(JSON.parse(text));
  const validKeys = new Set(regions.map((r) => r.key));
  parsed.changes = parsed.changes.filter((c) => validKeys.has(c.key));
  return parsed;
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
    question: '',
    summary: changes.length ? '（仮の動作）お知らせ欄にご依頼の内容を載せました。' : '',
    changes,
    guideline_warnings: [],
    mock: true,
  };
}
