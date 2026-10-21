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
  published: (c, url) => ({
    to: c.email, subject: `【${brand(c)}】ホームページに反映しました`,
    text: `${c.contact_name}様\n\nご依頼の変更を、ホームページに反映しました。\n${url}\n\nまた変えたいことがあれば、マイページからお気軽にお送りください。`,
  }),
  reply: (c, url) => ({
    to: c.email, subject: `【${brand(c)}】担当者からご連絡があります`,
    text: `${c.contact_name}様\n\nご依頼について、担当者からご連絡しました。\nマイページでご確認ください。\n${url}`,
  }),
};
