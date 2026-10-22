# Web係 管理システム（院のWeb係／飲食店のWeb係）

契約者DB・お客さま用マイページ（チャットで修正依頼）・AIによる自動修正・確認画面・公開・管理画面。

## 動かし方（ローカル）
```
npm install
npm run seed      # 管理者とデモ契約者を作成（初回のみ）
npm start         # http://localhost:4900
```
- お客さま：/login（デモ demo-food@example.com / demo1234、demo-clinic@example.com / demo1234）
- 管理画面：/admin/login（admin@example.com / admin1234 ※本番では ADMIN_EMAIL / ADMIN_PASSWORD で作成）

## 環境変数
| 名前 | 内容 |
|---|---|
| ANTHROPIC_API_KEY | 設定するとAI（claude-opus-5-5）で修正案を作る。未設定なら仮の動作 |
| PORT / BASE_URL | 待ち受けポート／招待リンク等に使うURL |
| DATA_DIR / SITES_DIR | DB と HPファイルの置き場所（Renderでは永続ディスク） |
| NODE_ENV=production | Cookie を Secure にする |
| DEPLOY_TARGET=cloudflare | 公開先を Cloudflare Pages にする（未実装） |

## 仕組み
- お客さまのHPに `data-edit="key" data-label="営業時間"`（文章）／`data-edit-img="key"`（画像）の印を付けた場所だけ、AIが変更できる
- 変更はすべて「版」として保存。公開＝本番の版を切り替えるだけなので、管理画面からいつでも前の版に戻せる
- 確認用の画面（/p/…）は本人と管理者だけが見られる
- プライバシーポリシーどおり、AIに渡す前に依頼文のメールアドレス・電話番号を伏せる
- 医院のサイトは、医療広告ガイドラインで使えない表現をAIと機械チェックの二重で確認
- パスワードは scrypt でハッシュ化、5回失敗で15分ロック、1時間に20件までの依頼制限

## 実装済み（追加分）
- メール通知（招待・パスワード再設定・確認のお願い・担当者の返信・公開完了）：SMTP_* を設定すると送信、未設定ならログに出すだけ
- 管理画面の二段階認証（認証アプリの6桁コード。初回ログイン時にQRコードで設定）

## 実装済み（2026-10-22 追加）
- Stripe 決済：料金の条件（商品の組み合わせ・毎月の追加・値引き・初回のみ費用）→ 決済リンク → Checkout → 反映、Webhook、カード変更画面、契約変更、単発請求（`src/pricing.js` `src/billing.js`）
- チャット修正の品質チェック（`src/style.js`）と、確認画面のスマホ幅自動点検（崩れたら公開を止める）
- 本番運用：`/healthz`、毎日のバックアップ（`data/backups`・14日分）、再起動時の復旧、失敗時の担当者通知、確認待ちのリマインド（`src/jobs.js`）
- 独自ドメインでの表示：DNS をこのサーバーに向け、管理画面で登録すると、そのドメインで公開中の版を返す
- 本番の初回起動で `ADMIN_EMAIL` / `ADMIN_PASSWORD`（12文字以上）から管理者を作る（seed は使わない）

## 未実装（あとで）
- Cloudflare Pages への公開（HP を管理システムと切り離して配信する。API トークンが用意でき次第）

公開までの手順は `../公開前チェックリスト.md` を参照。
