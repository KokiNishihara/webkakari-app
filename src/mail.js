// お客さまへのお知らせメール（招待・パスワード再設定・確認のお願い・公開完了・担当者からの返信）。
// SMTP_HOST / SMTP_USER / SMTP_PASS が無いときは送らず、サーバーのログに出すだけ。
import nodemailer from 'nodemailer';

const smtp = {
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM || process.env.SMTP_USER,
};
export const hasSmtp = () => Boolean(smtp.host && smtp.user && smtp.pass);

const SIGN = `\n\n――――――――――\n株式会社プラチナ企画　Web係\n東京都港区白金台3-7-15\nnishihara@platinum-kikaku.co.jp\n※このメールは送信専用ではありません。ご不明な点はこのまま返信してください。`;

export async function sendMail({ to, subject, text }) {
  if (!hasSmtp()) {
    console.log(`[メール未設定のため送信せず] ${to} / ${subject}\n${text}\n`);
    return { sent: false };
  }
  const transporter = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass },
  });
  try {
    await transporter.sendMail({ from: smtp.from, to, subject, text: text + SIGN });
    return { sent: true };
  } catch (e) {
    console.warn('[メール送信失敗]', to, e.message);
    return { sent: false, error: e.message };
  }
}

const brand = (c) => (c.business_type === 'clinic' ? '院のWeb係' : '飲食店のWeb係');

export const mails = {
  invite: (c, url) => ({
    to: c.email, subject: `【${brand(c)}】マイページのご案内`,
    text: `${c.contact_name}様\n\nこのたびは${brand(c)}をお申し込みいただき、ありがとうございます。\nホームページの変更をお送りいただく「マイページ」をご用意しました。\n\n下のリンクから、パスワードを決めてください（7日間有効です）。\n${url}\n\n次回からは、メールアドレスとこのパスワードでログインできます。`,
  }),
  reset: (c, url) => ({
    to: c.email, subject: `【${brand(c)}】パスワードの再設定`,
    text: `${c.contact_name}様\n\nパスワードの再設定のお申し込みを受け付けました。\n下のリンクから、新しいパスワードを決めてください（1時間有効です）。\n${url}\n\nお心当たりがない場合は、このメールは破棄してください。パスワードは変わりません。`,
  }),
  review: (c, url) => ({
    to: c.email, subject: `【${brand(c)}】直したあとの画面ができました`,
    text: `${c.contact_name}様\n\nご依頼いただいた変更の、直したあとの画面ができました。\n内容を確かめて、よろしければ「公開する」を押してください。\n${url}\n\n「公開する」を押すまで、ホームページは変わりません。`,
  }),
  cancelReceived: (c, end) => ({
    to: c.email, subject: `【${brand(c)}】解約のお申し込みを承りました`,
    text: `${c.contact_name}様\n\n${brand(c)}の解約のお申し込みを承りました。\n担当者が内容を確認し、1営業日以内に解約日をメールでお知らせします。\n${end ? `\nお申し込みの時点で、最も早い解約日は ${end} です（利用規約 第4条により、最低利用期間の終わり、または次回の請求日の前日まで）。\n` : ''}\n解約日までは、これまでどおりホームページの修正をお受けします。\nお申し込みを取り消したい場合は、このメールにご返信ください。`,
  }),
  cancelScheduled: (c, date) => ({
    to: c.email, subject: `【${brand(c)}】解約日のお知らせ`,
    text: `${c.contact_name}様\n\n解約のお手続きが完了しました。\n\n解約日：${date}\n\n解約日までは月額料金のお支払いとサービスが続き、翌日からマイページとホームページの表示が止まります。\nホームページのデータの引き渡しをご希望の場合は、解約日までにこのメールにご返信ください（利用規約 第5条）。\n\nこれまでご利用いただき、ありがとうございました。`,
  }),
  reviewReminder: (c, url) => ({
    to: c.email, subject: `【${brand(c)}】直したあとの画面のご確認をお願いします`,
    text: `${c.contact_name}様\n\n2日前にお送りした「直したあとの画面」が、まだ確認待ちになっています。\nよろしければ内容を確かめて「公開する」を押してください。\n${url}\n\n直したい点があれば、同じ画面からお送りください。不要になった場合は、このままで問題ありません。`,
  }),
  published: (c, url) => ({
    to: c.email, subject: `【${brand(c)}】ホームページに反映しました`,
    text: `${c.contact_name}様\n\nご依頼の変更を、ホームページに反映しました。\n${url}\n\nまた変えたいことがあれば、マイページからお気軽にお送りください。`,
  }),
  payLink: (c, url, q) => ({
    to: c.email, subject: `【${brand(c)}】お申し込み内容とお支払いのご案内`,
    text: `${c.contact_name}様\n\nご相談いただいた内容で、お申し込みの準備ができました。\n下のリンクから内容をご確認のうえ、お支払い方法（クレジットカード）をご登録ください（14日間有効です）。\n${url}\n\n月額：${q.monthlyTotal.toLocaleString()}円（税込）${q.oneTimeTotal ? `\n初回のみ：${q.oneTimeTotal.toLocaleString()}円（税込）` : ''}\n\nカード番号はStripe（決済代行会社）の画面で入力していただき、当社には届きません。\nカードでのお支払いが難しい場合は、このメールにご返信ください。`,
  }),
  paymentFailed: (c, url) => ({
    to: c.email, subject: `【${brand(c)}】月額のお支払いができませんでした`,
    text: `${c.contact_name}様\n\nご登録のカードで、今月のお支払いができませんでした。\nカードの有効期限が切れている場合などに起こります。\n\n下のリンク（マイページ → お支払い情報）から、カードを登録し直してください。\n${url}\n\nご不明な点は、このメールにご返信ください。`,
  }),
  adminNotice: (subject, url) => ({ to: process.env.ADMIN_NOTIFY_EMAIL || 'nishihara@platinum-kikaku.co.jp', subject, text: `管理画面で確認してください。\n${url}` }),
  reply: (c, url) => ({
    to: c.email, subject: `【${brand(c)}】担当者からご連絡があります`,
    text: `${c.contact_name}様\n\nご依頼について、担当者からご連絡しました。\nマイページでご確認ください。\n${url}`,
  }),
};
