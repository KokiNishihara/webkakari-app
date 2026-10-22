// 画面のHTML。文字はすべて esc() で無害化してから埋め込む。
import * as ill from './illust.js';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MARK = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 10h30a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H20l-8 7v-7H8a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" fill="#1E9BD7"/><path d="M56 26H30a4 4 0 0 0-4 4v14a4 4 0 0 0 4 4h14l8 7v-7h4a4 4 0 0 0 4-4V30a4 4 0 0 0-4-4z" fill="#0E3A57"/><path d="M36 37.5l4 4 8-8" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON = {
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="#137BB0" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="#4C5A66" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
};

export const STATUS_LABEL = {
  working: '作成中', review: '確認待ち', published: '公開済み', needs_admin: '担当者が対応中',
  waiting_customer: 'お返事待ち', failed: 'うまくいきませんでした', discarded: '取り下げ',
};
export const badge = (s) => `<span class="badge b-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
const when = (ms) => new Date(ms).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const head = (title) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/app.css?v=${ASSET_V}"><script src="/static/app.js?v=${ASSET_V}" defer></script></head>`;

const ASSET_V = Date.now().toString(36);
const flash = (f) => (f ? `<div class="flash ${esc(f.type)}" role="status">${esc(f.msg)}</div>` : '');

// ---------- お客さま：ログインまわり ----------
export function loginPage({ flash: f, email = '' }) {
  return `${head('ログイン｜Web係 マイページ')}<body><main class="auth">
<div class="ill">${ill.login}</div>
<h1>Web係 マイページ</h1>
<p class="lead">ホームページの変更は、ここから送れます。</p>
<div class="card">${flash(f)}
<form method="post" action="/login" novalidate>
<label class="f" for="email">メールアドレス</label>
<input class="input" id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required value="${esc(email)}">
<label class="f" for="password">パスワード</label>
<input class="input" id="password" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required>
<label class="show-pw"><input type="checkbox" data-toggle-pw="password"> パスワードを表示する</label>
<button class="btn block" style="margin-top:20px">ログインする</button>
</form>
<p style="text-align:center;margin-top:16px"><a href="/forgot">パスワードを忘れた方はこちら</a></p>
</div>
<p class="muted" style="text-align:center;margin-top:18px">ログインできないときは nishihara@platinum-kikaku.co.jp までご連絡ください。</p>
</main></body></html>`;
}

export function setPasswordPage({ flash: f, token, name, purpose }) {
  const title = purpose === 'invite' ? 'はじめに、<br>パスワードを決めましょう' : '新しいパスワードを決めてください';
  return `${head('パスワードの設定｜Web係 マイページ')}<body><main class="auth">
<div class="ill">${ill.welcome}</div>
<h1>${title}</h1>
<p class="lead">${purpose === 'invite' ? `${esc(name)}さん、ようこそ。次回から、このパスワードでログインします。` : 'このあと、すぐにログインできます。'}</p>
<div class="card">${flash(f)}
<form method="post" action="/set-password" data-pw-form>
<input type="hidden" name="token" value="${esc(token)}">
<label class="f" for="password">パスワード</label>
<input class="input" id="password" name="password" type="password" autocomplete="new-password" required data-pw>
<ul class="pw-rules" aria-live="polite"><li data-rule="len">8文字以上</li><li data-rule="mix">英字と数字を両方入れる</li></ul>
<label class="f" for="password2">もう一度入力</label>
<input class="input" id="password2" name="password2" type="password" autocomplete="new-password" required>
<label class="show-pw"><input type="checkbox" data-toggle-pw="password,password2"> パスワードを表示する</label>
<button class="btn block" style="margin-top:20px">この内容で設定する</button>
</form></div></main></body></html>`;
}

export function forgotPage({ flash: f }) {
  return `${head('パスワードの再設定｜Web係 マイページ')}<body><main class="auth">
<div class="ill">${ill.login}</div><h1>パスワードの再設定</h1>
<p class="lead">ご登録のメールアドレスに、再設定のリンクをお送りします。</p>
<div class="card">${flash(f)}<form method="post" action="/forgot">
<label class="f" for="email">メールアドレス</label><input class="input" id="email" name="email" type="email" autocomplete="email" required>
<button class="btn block" style="margin-top:20px">リンクを送る</button></form>
<p style="text-align:center;margin-top:16px"><a href="/login">ログイン画面に戻る</a></p></div></main></body></html>`;
}

// ---------- お客さま：ホーム ----------
const topBar = (c) => `<header class="top"><div class="in"><a class="brand" href="/app">${MARK}${esc(c.business_type === 'clinic' ? '院のWeb係' : '飲食店のWeb係')}</a>
<div class="right"><form method="post" action="/logout"><button class="btn quiet">ログアウト</button></form></div></div></header>`;

const CHIPS_FOOD = ['営業時間を変えたい', '臨時休業を知らせたい', 'メニュー・価格を変えたい', '写真を変えたい', 'お知らせを載せたい'];
const CHIPS_CLINIC = ['休診日を知らせたい', '診療時間を変えたい', 'お知らせを載せたい', '料金表を変えたい', '写真を変えたい'];

const composer = (c, { action, placeholder }) => `<div class="composer"><div class="in">
<div class="chips" role="list" aria-label="よくある変更"><span class="chips-h">よくある変更</span>${(c.business_type === 'clinic' ? CHIPS_CLINIC : CHIPS_FOOD).map((t) => `<button type="button" class="chip" role="listitem" data-chip="${esc(t)}">${esc(t)}</button>`).join('')}</div>
<form data-composer action="${esc(action)}">
<div class="thumb" hidden data-thumb><img alt=""><span>写真を1枚添付しました</span><button type="button" class="btn quiet" data-unattach>外す</button></div>
<div class="row">
<label class="attach" title="写真を添付">${ICON.camera}<span class="sr">写真を添付</span><input type="file" accept="image/jpeg,image/png" hidden data-file></label>
<label class="sr" for="msg">変えたいこと</label>
<textarea id="msg" name="text" rows="1" placeholder="${esc(placeholder)}" data-text></textarea>
<button class="send" disabled aria-label="送る">${ICON.send}</button>
</div></form></div></div>`;

export function homePage({ customer: c, site, requests, flash: f }) {
  const siteUrl = site ? `/s/${site.slug}/` : '';
  const list = requests.length
    ? `<div class="req-list">${requests.map((r) => `<a class="card req" href="/app/r/${r.id}"><b style="font-family:var(--kaku)">${esc(r.summary || r.first_text || '変更のご依頼')}</b>${badge(r.status)}<p>${esc(r.first_text || '')}</p><time>${when(r.updated_at)}</time></a>`).join('')}</div>`
    : `<div class="card empty">${ill.empty}<p>まだご依頼はありません。<br>下の入力欄に、変えたいことをふだんの言葉で書いて送ってください。</p></div>`;
  return `${head('マイページ｜Web係')}<body>${topBar(c)}<main class="wrap">${flash(f)}
<section class="hello"><div><h1>${esc(c.contact_name)}さん、<br>こんにちは。</h1><p>変えたいことを送るだけで、直したあとの画面をお返しします。</p></div><div>${ill.welcome}</div></section>
${site ? `<div class="card site-card"><div class="ico">${ICON.globe}</div><div><b>${esc(c.business_name)}</b><div class="url">${esc(site.domain || 'いまのホームページ')}</div></div><a class="btn ghost" href="${siteUrl}" target="_blank" rel="noopener">見る</a></div>` : ''}
<h2 class="sec-h">これまでのご依頼</h2>${list}
<p class="muted" style="margin-top:22px">デザインの変更やページの追加は、担当者がお見積りしてからご案内します。</p>
<p class="muted" style="margin-top:8px"><a href="/app/billing">お支払い情報・領収書</a></p>
</main>${composer(c, { action: '/app/requests', placeholder: '例：木曜日を休みにしたい' })}</body></html>`;
}

// ---------- お客さま：依頼のやり取り ----------
function stepsFor(status) {
  const order = ['sent', 'working', 'review', 'published'];
  const at = { working: 1, waiting_customer: 1, needs_admin: 1, failed: 1, review: 2, published: 3, discarded: 3 }[status] ?? 1;
  return `<ol class="steps" aria-label="進みぐあい">${['送った', '作成中', '確認', '公開'].map((t, i) => `<li class="${i < at ? 'done' : i === at ? 'on' : ''}">${t}</li>`).join('')}</ol>`;
}

function statusBlock(r, c, preview) {
  if (r.status === 'working') return `<div class="card status-card" data-poll="/app/r/${r.id}/status">${ill.working}<b>直したあとの画面を作っています</b><p>1分ほどで、ここに表示されます。この画面は閉じても大丈夫です。</p></div>`;
  if (r.status === 'needs_admin') return `<div class="card status-card">${ill.person}<b>担当者が確認しています</b><p>このご依頼は担当者が対応します。1営業日以内にこの画面でご連絡します。</p></div>`;
  if (r.status === 'waiting_customer') return `<div class="card status-card">${ill.empty}<b>少しだけ教えてください</b><p>上の質問に、下の入力欄からお返事ください。</p></div>`;
  if (r.status === 'published') return `<div class="card status-card">${ill.done}<b>公開しました</b><p>ホームページに反映されています。</p><a class="preview-link" style="margin-top:14px" href="/s/${esc(preview?.slug)}/" target="_blank" rel="noopener">${ICON.eye}いまのホームページを見る</a></div>`;
  if (r.status === 'failed') return `<div class="card status-card">${ill.person}<b>うまく作れませんでした</b><p>担当者に知らせました。もう一度、言い方を変えて送っていただいても大丈夫です。</p></div>`;
  if (r.status === 'review' && preview) {
    const d = preview.data || {};
    const listDiff = (x) => {
      const b = String(x.before).split('\n'), a = String(x.after).split('\n');
      const removed = b.filter((l) => !a.includes(l)).map((l) => `<div class="before">${esc(l)}</div>`);
      return `<div class="ld">${a.map((l) => `<div class="${b.includes(l) ? 'same' : 'add'}">${esc(l)}</div>`).join('')}${removed.join('')}</div>`;
    };
    const diffs = (d.diffs || []).map((x) => `<li><div class="lbl">${esc(x.label)}</div>${x.type === 'image'
      ? `<img src="${esc(x.after_url)}" alt="新しい写真">`
      : x.type === 'list' ? listDiff(x)
      : `<div class="before">${esc(x.before)}</div><div class="after">${esc(x.after)}</div>`}</li>`).join('');
    // 一覧（メニューなど）は複数行のまま見せる
    const warns = (d.warnings || []).map((w) => `<div class="warn">${esc(w)}</div>`).join('');
    return `<div class="card review"><h2>直したあとの画面ができました</h2><p class="sum">${esc(d.summary || '')}</p>
<ul class="diff">${diffs}</ul>${warns}
<div class="pv" data-pv data-check="/app/r/${r.id}/layout-check">
<div class="pv-tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-pv-w="390">スマホで見る</button><button type="button" role="tab" aria-selected="false" data-pv-w="1100">パソコンで見る</button></div>
<div class="pv-frame"><iframe src="/p/${esc(preview.slug)}/v${preview.version_id}/" title="直したあとの画面" loading="lazy"></iframe></div>
</div>
<div class="actions">
<a class="preview-link" href="/p/${esc(preview.slug)}/v${preview.version_id}/" target="_blank" rel="noopener">${ICON.eye}別の画面で大きく見る</a>
${r.layout_issues ? `<div class="warn" data-layout-warn>スマホで表示が崩れている可能性があるため、担当者が確認してから公開します。確認が済みしだい、この画面でご連絡します。</div>` : `<form method="post" action="/app/r/${r.id}/publish"><button class="btn block">この内容で公開する</button></form>`}
<button type="button" class="btn ghost block" data-focus-composer>もう少し直したい</button>
</div><p class="muted" style="margin-top:12px;text-align:center">「公開する」を押すまで、ホームページは変わりません。</p></div>`;
  }
  return '';
}

export function requestPage({ customer: c, request: r, messages, preview, flash: f }) {
  const bubbles = messages.map((m) => {
    const me = m.sender === 'customer';
    const who = me ? 'あなた' : m.sender === 'admin' ? '担当 西原' : 'Web係';
    return `<div class="bub ${me ? 'me' : 'us'}">${esc(m.body)}${m.image_path ? `<img src="${esc(m.image_path)}" alt="添付した写真">` : ''}</div><p class="meta ${me ? 'r' : ''}">${who}　${when(m.created_at)}</p>`;
  }).join('');
  return `${head('ご依頼｜Web係')}<body>${topBar(c)}<main class="wrap">${flash(f)}
<p style="margin-bottom:10px"><a href="/app">← ご依頼の一覧へ</a></p>
${stepsFor(r.status)}
<div class="thread">${bubbles}</div>
<div style="margin-top:16px">${statusBlock(r, c, preview)}</div>
</main>${['published', 'discarded'].includes(r.status) ? composer(c, { action: '/app/requests', placeholder: '新しく変えたいこと' }) : composer(c, { action: `/app/r/${r.id}/messages`, placeholder: r.status === 'review' ? '例：18時までにしてください' : 'お返事を書く' })}</body></html>`;
}

// ---------- 管理画面 ----------
const adminTop = () => `<header class="top"><div class="in"><a class="brand" href="/admin">${MARK}Web係 管理</a>
<div class="right"><a class="btn quiet" href="/admin">ダッシュボード</a><a class="btn quiet" href="/admin/customers/new">契約者を追加</a><a class="btn quiet" href="/admin/backups">バックアップ</a><form method="post" action="/admin/logout"><button class="btn quiet">ログアウト</button></form></div></div></header>`;

export function adminLoginPage({ flash: f }) {
  return `${head('管理ログイン')}<body class="admin"><main class="auth"><h1>Web係 管理画面</h1><div class="card">${flash(f)}
<form method="post" action="/admin/login"><label class="f" for="email">メールアドレス</label><input class="input" id="email" name="email" type="email" autocomplete="username" required>
<label class="f" for="password">パスワード</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required>
<button class="btn block" style="margin-top:20px">ログイン</button></form></div></main></body></html>`;
}

export function adminMfaPage({ flash: f }) {
  return `${head('二段階認証｜Web係 管理')}<body class="admin"><main class="auth"><h1>確認コード</h1><p class="lead">認証アプリに表示されている6桁の数字を入れてください。</p><div class="card">${flash(f)}
<form method="post" action="/admin/mfa"><label class="f" for="code">6桁のコード</label><input class="input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required autofocus>
<button class="btn block" style="margin-top:20px">ログイン</button></form></div></main></body></html>`;
}
export function adminMfaSetupPage({ qr, secret, flash: f }) {
  return `${head('二段階認証の設定｜Web係 管理')}<body class="admin"><main class="auth"><h1>二段階認証の設定</h1><p class="lead">管理画面を守るため、最初に一度だけ設定します。</p><div class="card">${flash(f)}
<ol style="padding-left:1.2em;font-size:14.5px;color:var(--text-2);display:grid;gap:6px"><li>スマホに認証アプリ（Google Authenticator など）を入れる</li><li>アプリで下のQRコードを読み取る</li><li>アプリに出た6桁を入れる</li></ol>
<img src="${qr}" alt="二段階認証のQRコード" style="margin:16px auto;width:200px;height:200px">
<p class="hint" style="text-align:center">読み取れない場合は、このキーを手入力：<br><code style="word-break:break-all">${esc(secret)}</code></p>
<form method="post" action="/admin/mfa/setup"><label class="f" for="code">6桁のコード</label><input class="input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
<button class="btn block" style="margin-top:20px">設定してログイン</button></form></div></main></body></html>`;
}

export function adminDashboard({ stats, queue, customers, flash: f }) {
  return `${head('ダッシュボード｜Web係 管理')}<body class="admin">${adminTop()}<main class="wrap">${flash(f)}
<h1>ダッシュボード</h1>
<div class="kpis"><div class="kpi"><b>${stats.active}</b><span>契約中</span></div><div class="kpi"><b>${stats.mrr.toLocaleString()}円</b><span>月額の合計</span></div><div class="kpi"><b>${stats.attention}</b><span>対応が必要な依頼</span></div><div class="kpi"><b>${stats.pastDue}</b><span>支払いの遅れ</span></div></div>
<h2 class="sec-h">対応が必要な依頼</h2>
${queue.length ? `<table class="t"><tr><th>契約者</th><th>状態</th><th>内容</th><th>更新</th></tr>${queue.map((r) => `<tr><td>${esc(r.business_name)}</td><td>${badge(r.status)}</td><td><a href="/admin/r/${r.id}">${esc(r.first_text || '')}</a></td><td>${when(r.updated_at)}</td></tr>`).join('')}</table>` : '<p class="muted">いまはありません。</p>'}
<h2 class="sec-h">契約者</h2>
<table class="t"><tr><th>店名・医院名</th><th>種別</th><th>月額</th><th>支払い</th><th>状態</th><th>最低期間の終了</th></tr>
${customers.map((c) => `<tr><td><a href="/admin/customers/${c.id}">${esc(c.business_name)}</a><div class="muted">${esc(c.email)}</div></td><td>${c.business_type === 'clinic' ? '医院' : '飲食店'}</td><td>${Number(c.monthly_fee).toLocaleString()}円</td><td>${esc({ card: 'カード', bank_debit: '口座振替', invoice: '請求書' }[c.payment_method])}／${esc({ pending: '未開始', active: '正常', past_due: '遅れ', canceled: '停止' }[c.payment_status])}</td><td>${esc({ onboarding: '準備中', active: '契約中', canceled: '解約' }[c.status])}</td><td>${esc(c.min_term_end || '—')}</td></tr>`).join('')}
</table></main></body></html>`;
}

export function adminCustomerNew({ flash: f }) {
  return `${head('契約者を追加｜Web係 管理')}<body class="admin">${adminTop()}<main class="wrap">${flash(f)}<h1>契約者を追加</h1>
<form method="post" action="/admin/customers" class="card" enctype="application/x-www-form-urlencoded">
<div class="form-grid">
<div><label class="f">店名・医院名</label><input class="input" name="business_name" required></div>
<div><label class="f">種別</label><select class="input" name="business_type"><option value="food">飲食店</option><option value="clinic">医院・治療院</option></select></div>
<div><label class="f">ご担当者名</label><input class="input" name="contact_name" required></div>
<div><label class="f">メールアドレス（ログインID）</label><input class="input" name="email" type="email" required></div>
<div><label class="f">電話番号</label><input class="input" name="phone"></div>
<div><label class="f">月額（税込）</label><input class="input" name="monthly_fee" type="number" value="9800"></div>
<div><label class="f">プラン</label><input class="input" name="plan" value="hp" placeholder="hp, gmap, line など"></div>
<div><label class="f">支払方法</label><select class="input" name="payment_method"><option value="card">クレジットカード（原則）</option><option value="bank_debit">口座振替</option><option value="invoice">請求書（例外）</option></select></div>
</div>
<p class="hint" style="margin-top:14px">登録すると、お客さまに「パスワード設定のご案内」メールを送ります。メールが届かない場合に備えて、リンクは次の画面にも表示します。</p>
<button class="btn" style="margin-top:16px">登録する</button></form></main></body></html>`;
}

export function adminCustomerPage({ c, site, versions, requests, inviteUrl, payUrl, quote, billed, mode, audits, flash: f }) {
  return `${head(`${c.business_name}｜Web係 管理`)}<body class="admin">${adminTop()}<main class="wrap">${flash(f)}
<h1>${esc(c.business_name)}</h1>
${inviteUrl ? `<div class="card" style="margin-bottom:16px"><b>初回のパスワード設定リンク</b><p class="hint">お客さまに送ってください（7日間有効）。</p><div class="copy" style="margin-top:8px"><input class="input" readonly value="${esc(inviteUrl)}" data-copy-src><button type="button" class="btn ghost" data-copy>コピー</button></div></div>` : ''}
<div class="grid2">
<form method="post" action="/admin/customers/${c.id}" class="card"><h2 class="sec-h" style="margin-top:0">契約の内容</h2><div class="form-grid">
<div><label class="f">ご担当者名</label><input class="input" name="contact_name" value="${esc(c.contact_name)}"></div>
<div><label class="f">電話番号</label><input class="input" name="phone" value="${esc(c.phone || '')}"></div>
<input type="hidden" name="plan" value="${esc(c.plan)}"><input type="hidden" name="monthly_fee" value="${esc(c.monthly_fee)}">
<div><label class="f">支払方法</label><select class="input" name="payment_method">${[['card', 'クレジットカード'], ['bank_debit', '口座振替'], ['invoice', '請求書']].map(([v, l]) => `<option value="${v}" ${c.payment_method === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
<div><label class="f">支払い状況</label><select class="input" name="payment_status">${[['pending', '未開始'], ['active', '正常'], ['past_due', '遅れ'], ['canceled', '停止']].map(([v, l]) => `<option value="${v}" ${c.payment_status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
<div><label class="f">契約の状態</label><select class="input" name="status">${[['onboarding', '準備中'], ['active', '契約中'], ['canceled', '解約']].map(([v, l]) => `<option value="${v}" ${c.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
<div><label class="f">公開日（最低期間の起算日）</label><input class="input" name="contract_start" type="date" value="${esc(c.contract_start || '')}"></div>
</div><p class="hint">最低利用期間の終了日：${esc(c.min_term_end || '公開日を入れると自動で計算します')}</p>
<label class="f">メモ</label><textarea class="input" name="notes" rows="3">${esc(c.notes || '')}</textarea>
<button class="btn" style="margin-top:14px">保存する</button></form>
<div class="card"><h2 class="sec-h" style="margin-top:0">ホームページ</h2>
${site ? `<p>公開中：<a href="/s/${esc(site.slug)}/" target="_blank">/s/${esc(site.slug)}/</a>（版 ${esc(site.live_version_id ?? '—')}）</p>
<form method="post" action="/admin/sites/${site.id}/domain" class="line" style="margin-top:10px"><input class="input" name="domain" value="${esc(site.domain || '')}" placeholder="独自ドメイン（例：minato-shokudo.jp）"><button class="btn ghost">登録</button></form>
<p class="hint">DNS の設定：ドメインの管理画面で、<b>${esc(new URL(process.env.BASE_URL || 'http://localhost:4900').host)}</b> に向ける CNAME（www 付き）を作り、Render の「Custom Domains」にも同じドメインを追加してから登録してください。</p>
<form method="post" action="/admin/sites/${site.id}/upload" style="margin-top:12px" data-html-upload><label class="f">HTMLを差し替える（新しい版として登録）</label><input type="file" name="html" accept=".html,text/html" data-upload-html><input type="hidden" name="html_b64"><button class="btn ghost" style="margin-top:8px">登録する</button></form>
<table class="t" style="margin-top:14px"><tr><th>版</th><th>内容</th><th>作成</th><th></th></tr>${versions.map((v) => `<tr><td>${v.id}${site.live_version_id === v.id ? ' <span class="badge b-published">公開中</span>' : ''}</td><td>${esc(v.note || '')}</td><td>${esc(v.created_by)}　${when(v.created_at)}</td><td><a href="/p/${esc(site.slug)}/v${v.id}/" target="_blank">見る</a>${site.live_version_id === v.id ? '' : `<form method="post" action="/admin/sites/${site.id}/publish/${v.id}" style="display:inline"><button class="btn quiet">この版を公開</button></form>`}</td></tr>`).join('')}</table>` : '<p class="muted">サイトが未登録です。</p>'}
</div></div>
${billingCard({ c, quote, billed, payUrl, mode, audits })}
<h2 class="sec-h">ご依頼</h2>
<table class="t"><tr><th>状態</th><th>内容</th><th>更新</th></tr>${requests.map((r) => `<tr><td>${badge(r.status)}</td><td><a href="/admin/r/${r.id}">${esc(r.first_text || '')}</a></td><td>${when(r.updated_at)}</td></tr>`).join('')}</table>
</main></body></html>`;
}

export function adminRequestPage({ r, c, messages, preview }) {
  const bubbles = messages.map((m) => `<div class="bub ${m.sender === 'customer' ? 'me' : 'us'}">${esc(m.body)}${m.image_path ? `<img src="${esc(m.image_path)}" alt="">` : ''}</div><p class="meta ${m.sender === 'customer' ? 'r' : ''}">${esc(m.sender)}　${when(m.created_at)}</p>`).join('');
  return `${head('依頼｜Web係 管理')}<body class="admin">${adminTop()}<main class="wrap" style="max-width:760px">
<h1>${esc(c.business_name)} のご依頼 ${badge(r.status)}</h1>
${preview ? `<p><a href="/p/${esc(preview.slug)}/v${preview.version_id}/" target="_blank">確認用の画面を開く（版 ${preview.version_id}）</a></p>` : ''}
${r.layout_issues ? `<div class="warn">スマホ幅の自動点検で見つかった崩れ（お客さまの公開は止めています）：<br>${JSON.parse(r.layout_issues).map(esc).join('<br>')}<br>確認して問題なければ「代わりに公開する」、直す場合はHTMLを差し替えるか「AIでもう一度作る」。</div>` : ''}
<div class="thread" style="margin-top:14px">${bubbles}</div>
<form method="post" action="/admin/r/${r.id}/reply" class="card" style="margin-top:16px"><label class="f" style="margin-top:0">お客さまへ返信（担当 西原 として表示）</label><textarea class="input" name="text" rows="3" required></textarea>
<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="btn">返信する</button></div></form>
<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
${r.preview_version_id ? `<form method="post" action="/admin/r/${r.id}/publish"><button class="btn ghost">代わりに公開する</button></form>` : ''}
<form method="post" action="/admin/r/${r.id}/retry"><button class="btn ghost">AIでもう一度作る</button></form>
<form method="post" action="/admin/r/${r.id}/discard"><button class="btn danger">取り下げにする</button></form></div>
</main></body></html>`;
}

export const notFound = () => `${head('ページが見つかりません')}<body><main class="auth"><div class="ill">${ill.empty}</div><h1>ページが見つかりません</h1><p class="lead"><a href="/app">マイページへ戻る</a></p></main></body></html>`;

// ---------- お支払い ----------
const yen = (n) => `${Number(n || 0).toLocaleString('ja-JP')}円`;
const brandOf = (c) => (c.business_type === 'clinic' ? '院のWeb係' : '飲食店のWeb係');
const legalBase = (c) => `/legal/${c.business_type === 'clinic' ? 'clinic' : 'food'}`;
const payTop = (c) => `<header class="top"><div class="in"><span class="brand">${MARK}${esc(brandOf(c))}</span></div></header>`;

function quoteTable(q) {
  return `<table class="bill">
<tr class="grp"><th colspan="2">毎月のお支払い</th></tr>
${q.monthly.map((r) => `<tr><td>${esc(r.label)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</td><td class="n">${yen(r.amount)}</td></tr>`).join('')}
${q.discount ? `<tr><td>お値引き<small>${esc(q.discount.reason)}</small></td><td class="n">−${yen(q.discount.amount)}</td></tr>` : ''}
<tr class="sum"><td>月額（税込）</td><td class="n">${yen(q.monthlyTotal)}</td></tr>
${q.oneTime.length ? `<tr class="grp"><th colspan="2">初回のみ</th></tr>${q.oneTime.map((r) => `<tr><td>${esc(r.label)}</td><td class="n">${yen(r.amount)}</td></tr>`).join('')}<tr class="sum"><td>初回のみの合計（税込）</td><td class="n">${yen(q.oneTimeTotal)}</td></tr>` : ''}
</table>`;
}

export function payPage({ c, quote: q, token, mode, flash: f }) {
  return `${head('お申し込み内容のご確認')}<body>${payTop(c)}<main class="wrap narrow">${flash(f)}
<h1 class="page-h">お申し込み内容のご確認</h1>
<p class="lead-l">${esc(c.business_name)}　${esc(c.contact_name)}様</p>
<div class="card">${quoteTable(q)}
<dl class="facts">
<div><dt>初回のお支払い</dt><dd>${yen(q.firstPayment)}（月額${q.oneTimeTotal ? '＋初回のみの費用' : ''}）</dd></div>
<div><dt>2回目から</dt><dd>毎月、同じ日に ${yen(q.monthlyTotal)} を自動でお支払い</dd></div>
<div><dt>最低利用期間</dt><dd>ホームページの公開日から6か月。その後は月単位で解約できます</dd></div>
</dl></div>
<form method="post" action="/pay/${esc(token)}" class="card" style="margin-top:14px">
<p>次の画面で、クレジットカードを登録します。カード番号は決済代行会社（Stripe）の画面で入力していただき、当社には届きません。</p>
<label class="agree"><input type="checkbox" name="agree" value="1" required> <span><a href="${legalBase(c)}/terms.html" target="_blank" rel="noopener">利用規約</a>と<a href="${legalBase(c)}/tokushoho.html" target="_blank" rel="noopener">特定商取引法に基づく表記</a>、<a href="${legalBase(c)}/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>を確認し、同意します</span></label>
<button class="btn block" style="margin-top:18px">${mode === 'mock' ? '仮の決済で進む（テスト）' : 'カードの登録へ進む'}</button>
${mode === 'mock' ? '<p class="hint" style="margin-top:10px">いまは決済の設定前のため、お金は動きません（テスト用の表示です）。</p>' : mode === 'test' ? '<p class="hint" style="margin-top:10px">テスト環境です。実際の請求は行われません。</p>' : ''}
</form>
<p class="muted" style="margin-top:18px">カードでのお支払いが難しい場合は、口座振替もお選びいただけます。nishihara@platinum-kikaku.co.jp までご連絡ください。</p>
</main></body></html>`;
}

export function payDone({ c, quote: q, mock, pending }) {
  return `${head('お申し込みありがとうございます')}<body>${payTop(c)}<main class="auth">
<div class="ill">${ill.done}</div>
<h1>${pending ? 'お支払いを確認しています' : 'お申し込みが完了しました'}</h1>
<p class="lead">${pending ? '確認が済みしだい、メールでお知らせします。' : `ありがとうございます。月額 ${yen(q?.monthlyTotal)}（税込）で承りました。`}</p>
<div class="card"><p>このあとの流れ</p><ol class="flow"><li>担当者から、ホームページ作成に使う材料（写真・文章など）についてご連絡します</li><li>できあがった画面をご確認いただき、公開します</li><li>公開後は、マイページから変えたいことを送るだけです</li></ol>
${mock ? '<p class="hint" style="margin-top:12px">（テスト）仮の決済で完了扱いにしました。</p>' : ''}
<a class="btn block" href="/app" style="margin-top:16px">マイページへ</a></div></main></body></html>`;
}

export const payExpired = () => `${head('リンクの有効期限が切れています')}<body><main class="auth"><div class="ill">${ill.empty}</div><h1>このリンクは使えません</h1><p class="lead">有効期限が切れたか、お手続きがすでに済んでいます。お手数ですが、担当者（nishihara@platinum-kikaku.co.jp）までご連絡ください。</p></main></body></html>`;

export function billingInfoPage({ c, quote: q, mode }) {
  return `${head('お支払い情報｜Web係')}<body>${topBar(c)}<main class="wrap narrow">
<p style="margin-bottom:10px"><a href="/app">← マイページへ</a></p>
<h1 class="page-h">お支払い情報</h1>
${q ? `<div class="card">${quoteTable({ ...q, oneTime: [], oneTimeTotal: 0 })}</div>` : '<div class="card"><p>まだお支払いの登録はありません。</p></div>'}
<p class="muted" style="margin-top:16px">${mode === 'mock' ? '（テスト）決済の設定前のため、カードの変更画面は開けません。' : c.payment_method === 'card' ? 'カードの変更画面を開けませんでした。時間をおいてお試しください。' : 'お支払い方法の変更は、担当者までご連絡ください。'}</p>
</main></body></html>`;
}

// 管理：料金の条件（契約者ページの中）
import { PRODUCTS, ONE_TIME_PRESETS, MONTHLY_PRESETS } from './pricing.js';
const STATES = [
  ['A', 'ホームページ', [['A1', 'HPなし'], ['A2', '自社ドメインあり'], ['A3', '制作会社が管理'], ['A4', 'Wix等で自作'], ['A5', '大きいサイト']]],
  ['B', 'Googleマップ', [['B1', '権限あり'], ['B2', '権限なし'], ['B3', '未登録']]],
  ['C', '公式LINE', [['C1', 'なし'], ['C2', 'あり'], ['C3', 'Lステップ希望']]],
];
export function billingCard({ c, quote: q, billed, payUrl, mode, audits }) {
  const b = c.billing_json ? JSON.parse(c.billing_json) : { products: ['hp'], monthly_extras: [], one_time: [], discount: { amount: 0, reason: '' }, note: '' };
  const states = new Set((c.state_codes || '').split(',').filter(Boolean));
  const rowsOf = (prefix, list, presets) => {
    const filled = list.map((r) => ({ ...r }));
    while (filled.length < Math.max(2, list.length + 1)) filled.push({ label: '', amount: '' });
    return `${filled.map((r) => `<div class="line"><input class="input" name="${prefix}_label" value="${esc(r.label)}" placeholder="内容" list="${prefix}-presets"><input class="input n" name="${prefix}_amount" value="${esc(r.amount)}" inputmode="numeric" placeholder="金額"></div>`).join('')}
<datalist id="${prefix}-presets">${presets.map((p) => `<option value="${esc(p.label)}">${esc(p.hint)}</option>`).join('')}</datalist>`;
  };
  const hints = [];
  if ((states.has('A1') || states.has('A4')) && !b.one_time.some((r) => r.label.includes('ドメイン'))) hints.push('A1/A4：独自ドメインの実費（年1,500〜4,000円）を初回のみに入れてください');
  if (states.has('C1') && !b.one_time.some((r) => r.label.includes('LINE'))) hints.push('C1：公式LINEの初期構築費を初回のみに入れてください');
  if ((states.has('C1') || states.has('C2')) && !b.products.includes('line')) hints.push('公式LINEの状態を選んでいますが、商品に公式LINEが入っていません');
  if (states.has('C3') && c.business_type !== 'clinic') hints.push('C3（Lステップ）は医院向けのみの扱いです');
  if (states.has('A3')) hints.push('A3：制作会社の解約日と、ドメイン移管の可否を確認してから公開日を決めてください');
  if (states.has('B2')) hints.push('B2：Googleのオーナー権限を取り戻すまで、Googleマップの運用は始められません');
  const changed = billed && JSON.stringify([billed.monthly, billed.discount]) !== JSON.stringify([q.monthly, q.discount]);
  return `<div class="card" id="billing"><h2 class="sec-h" style="margin-top:0">料金とお支払い <span class="muted" style="font-weight:500">決済：${{ mock: '仮の決済（Stripe未設定）', test: 'Stripeテスト', live: 'Stripe本番' }[mode]}</span></h2>
<form method="post" action="/admin/customers/${c.id}/billing">
<label class="f">契約前の状態（社内用_契約前の状態別プラン表）</label>
<div class="states">${STATES.map(([, name, opts]) => `<div><span>${name}</span>${opts.map(([v, l]) => `<label><input type="checkbox" name="state" value="${v}" ${states.has(v) ? 'checked' : ''}> ${v} ${l}</label>`).join('')}</div>`).join('')}</div>
<label class="f">商品（組み合わせでセット料金になります）</label>
<div class="checks">${Object.entries(PRODUCTS).map(([k, p]) => `<label><input type="checkbox" name="p_${k}" value="1" ${b.products.includes(k) ? 'checked' : ''}> ${p.label}（${yen(p.monthly)}）</label>`).join('')}</div>
<label class="f">毎月の追加（Lステップなど・お見積り）</label>${rowsOf('m', b.monthly_extras, MONTHLY_PRESETS)}
<label class="f">初回のみ（初期設定費・ドメイン実費・LINE構築・追加の制作）</label>${rowsOf('o', b.one_time, ONE_TIME_PRESETS)}
<label class="f">毎月の値引き</label><div class="line"><input class="input" name="discount_reason" value="${esc(b.discount?.reason || '')}" placeholder="理由（例：紹介のため）"><input class="input n" name="discount_amount" value="${esc(b.discount?.amount || '')}" inputmode="numeric" placeholder="金額"></div>
<label class="f">メモ（社内）</label><textarea class="input" name="billing_note" rows="2">${esc(b.note || '')}</textarea>
<button class="btn ghost" style="margin-top:12px">料金の条件を保存</button></form>
${hints.length ? `<div class="warn" style="margin-top:14px">${hints.map(esc).join('<br>')}</div>` : ''}
<h3 class="sub-h">お客さまに見せる明細</h3>${quoteTable(q)}
${q.problems.length ? `<div class="warn">${q.problems.map(esc).join('<br>')}</div>` : ''}
${billed ? `<p class="hint" style="margin-top:12px">いま請求中：月額 ${yen(billed.monthlyTotal)}${changed ? '　<b style="color:#B4532A">← 上の明細と違います</b>' : ''}</p>` : ''}
<div class="btn-row">
${c.stripe_subscription_id || (mode === 'mock' && billed)
    ? `<form method="post" action="/admin/customers/${c.id}/apply-billing" onsubmit="return confirm('次回の請求から、月額 ${yen(q.monthlyTotal)} に変更します。よろしいですか？')"><button class="btn" ${changed ? '' : 'disabled'}>請求中の内容を変更する</button></form>`
    : `<form method="post" action="/admin/customers/${c.id}/paylink"><input type="hidden" name="send_mail" value="1"><button class="btn">決済のご案内メールを送る</button></form>
<form method="post" action="/admin/customers/${c.id}/paylink"><button class="btn ghost">リンクだけ作る</button></form>`}
</div>
${payUrl ? `<div class="copy" style="margin-top:12px"><input class="input" readonly value="${esc(payUrl)}" data-copy-src><button type="button" class="btn ghost" data-copy>コピー</button></div><p class="hint">14日間有効。新しく作ると前のリンクは使えなくなります。</p>` : ''}
${c.stripe_customer_id || mode === 'mock' ? `<form method="post" action="/admin/customers/${c.id}/charge" class="line" style="margin-top:16px"><input class="input" name="label" placeholder="単発の請求（例：ドメイン更新費 2027年分）" list="o-presets"><input class="input n" name="amount" inputmode="numeric" placeholder="金額"><button class="btn ghost">次回の請求に追加</button></form>` : ''}
${c.terms_agreed_at ? `<p class="hint" style="margin-top:12px">利用規約などへの同意：${when(c.terms_agreed_at)}</p>` : ''}
${audits?.length ? `<details style="margin-top:12px"><summary class="hint">履歴</summary><ul class="hint">${audits.map((a) => `<li>${when(a.created_at)}　${esc(a.action)}　${esc(a.detail || '')}</li>`).join('')}</ul></details>` : ''}
</div>`;
}

// 利用規約（Markdown の下書きをそのまま表示。見出し・箇条書き・段落だけ対応）
export function termsPage(md, brand) {
  const body = md.replace(/^# .*\n/, '').replace(/^作成：.*\n/m, '').replace(/^---\s*$/m, '')
    .replace(/\{サービス名\}|院のWeb係/g, brand).replace(/^制定日：.*$/m, '').replace(/^株式会社プラチナ企画　.*$/m, '株式会社プラチナ企画　東京都港区白金台3-7-15').replace(/^(## .*)$/gm, '\n$1\n')
    .split(/\n{2,}/).map((blk) => {
      blk = blk.trim(); if (!blk) return '';
      if (blk.startsWith('## ')) return `<h2>${esc(blk.slice(3))}</h2>`;
      const lines = blk.split('\n');
      if (lines.every((l) => /^\s*(\d+\.|-)\s/.test(l) || /^\s{2,}/.test(l))) {
        return `<ol>${lines.filter((l) => /^\d+\./.test(l)).map((l, i, arr) => {
          const idx = lines.indexOf(l); const subs = [];
          for (let j = idx + 1; j < lines.length && !/^\d+\./.test(lines[j]); j++) subs.push(lines[j].replace(/^\s*-\s*/, ''));
          return `<li>${esc(l.replace(/^\d+\.\s*/, '').replace(/\*\*/g, ''))}${subs.length ? `<ul>${subs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</li>`;
        }).join('')}</ol>`;
      }
      return `<p>${esc(blk.replace(/\*\*/g, '')).replace(/\n/g, '<br>')}</p>`;
    }).join('\n');
  return `${head(`利用規約｜${brand}`)}<body><main class="wrap narrow legal"><h1 class="page-h">${esc(brand)} 利用規約</h1>${body}</main></body></html>`;
}

export function adminBackupsPage({ backups, flash: f }) {
  return `${head('バックアップ｜Web係 管理')}<body class="admin">${adminTop()}<main class="wrap" style="max-width:760px">${flash(f)}
<h1>バックアップ</h1>
<p class="hint">契約者・依頼・料金などのデータ（DB）を毎日自動で保存しています（14日分）。HPのファイルは版ごとにすべて残しています。サーバーのディスク自体も Render が毎日スナップショットを取っています。月に1回は、ここから手元（会社のPC）にも保存してください。</p>
<form method="post" action="/admin/backups" style="margin:14px 0"><button class="btn ghost">いまバックアップを作る</button></form>
<table class="t"><tr><th>ファイル</th><th>大きさ</th><th></th></tr>${backups.map((b) => `<tr><td>${esc(b.name)}</td><td>${Math.round(b.size / 1024).toLocaleString()} KB</td><td><a href="/admin/backups/${esc(b.name)}">手元に保存</a></td></tr>`).join('') || '<tr><td colspan="3" class="muted">まだありません</td></tr>'}</table>
</main></body></html>`;
}
