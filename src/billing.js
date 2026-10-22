// Stripe での月額課金。カード番号は当社では一切受け取らない（Stripeの画面で入力してもらう）。
// STRIPE_SECRET_KEY が無いときは「仮の決済」で流れだけ確認できる。
// 本番のキー（sk_live_）は STRIPE_ALLOW_LIVE=1 のときだけ使う（テストのつもりで本番に請求しないため）。
import Stripe from 'stripe';
import { one, run, now, audit, getSetting, setSetting } from './db.js';
import { BRAND } from './pricing.js';

const KEY = process.env.STRIPE_SECRET_KEY || '';
export const stripeMode = () => (!KEY ? 'mock' : KEY.startsWith('sk_live_') ? 'live' : 'test');
let client = null;
function stripe() {
  if (!KEY) return null;
  if (stripeMode() === 'live' && process.env.STRIPE_ALLOW_LIVE !== '1') throw new Error('本番のStripeキーが入っていますが、STRIPE_ALLOW_LIVE=1 が未設定のため止めました');
  client ??= new Stripe(KEY);
  return client;
}

// 明細の名前ごとに Stripe の商品を1つ用意し、ID を覚えておく（同じ名前は使い回す）
async function productId(name) {
  const k = `stripe_product:${stripeMode()}:${name}`;
  const cached = getSetting(k);
  if (cached) return cached;
  const p = await stripe().products.create({ name, metadata: { app: 'webkakari' } });
  setSetting(k, p.id);
  return p.id;
}

async function couponFor(discount) {
  if (!discount) return null;
  const c = await stripe().coupons.create({ amount_off: discount.amount, currency: 'jpy', duration: 'forever', name: `値引き：${discount.reason}`.slice(0, 40) });
  return c.id;
}

const monthlyItem = async (r) => ({ price_data: { currency: 'jpy', product: await productId(r.label), unit_amount: r.amount, recurring: { interval: 'month' } }, quantity: 1 });

// 決済画面（Stripe Checkout）を作る。初回は「月額＋初期費用」をまとめて決済し、翌月から月額だけ自動で請求する。
export async function startCheckout(c, quote, { successUrl, cancelUrl }) {
  if (stripeMode() === 'mock') return { url: null, mock: true };
  const s = stripe();
  const line_items = [];
  for (const r of quote.monthly) line_items.push(await monthlyItem(r));
  for (const r of quote.oneTime) line_items.push({ price_data: { currency: 'jpy', product: await productId(r.label), unit_amount: r.amount }, quantity: 1 });
  const coupon = await couponFor(quote.discount);
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    locale: 'ja',
    // 支払い方法（カードなど）は Stripe の管理画面「設定 → 決済手段」で決める（APIでは指定できない）
    line_items,
    ...(coupon ? { discounts: [{ coupon }] } : {}),
    ...(c.stripe_customer_id ? { customer: c.stripe_customer_id } : { customer_email: c.email }),
    client_reference_id: String(c.id),
    metadata: { customer_id: String(c.id) },
    subscription_data: { metadata: { customer_id: String(c.id), brand: BRAND(c.business_type) }, description: `${BRAND(c.business_type)}（${c.business_name}）` },
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
  });
  return { url: session.url };
}

// 支払いが終わったら、契約者DBに反映する（決済完了の戻り画面と webhook の両方から呼ぶ。何度呼んでも同じ結果）
export function markPaid(customerId, { stripeCustomerId = null, subscriptionId = null, quote }) {
  const c = one('SELECT * FROM customers WHERE id = ?', customerId);
  if (!c) return null;
  run(`UPDATE customers SET payment_status = 'active', payment_method = 'card',
       stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id),
       monthly_fee = ?, plan = ?, billed_json = ? WHERE id = ?`,
    stripeCustomerId, subscriptionId, quote.monthlyTotal, quote.planCode, JSON.stringify(quote), customerId);
  return one('SELECT * FROM customers WHERE id = ?', customerId);
}

export async function syncCheckout(sessionId) {
  const s = await stripe().checkout.sessions.retrieve(sessionId);
  if (s.status !== 'complete') return null;
  const customerId = Number(s.metadata?.customer_id || s.client_reference_id);
  return { customerId, stripeCustomerId: s.customer, subscriptionId: s.subscription };
}

// お客さまの「お支払い情報」画面（カードの変更・領収書）。解約・プラン変更はここではできない（最低期間・料金の相談があるため）
async function portalConfig() {
  const k = `stripe_portal:${stripeMode()}`;
  const cached = getSetting(k);
  if (cached) return cached;
  const conf = await stripe().billingPortal.configurations.create({
    business_profile: { headline: 'お支払い方法の変更・領収書のダウンロード' },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address'] },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
    },
  });
  setSetting(k, conf.id);
  return conf.id;
}
export async function portalUrl(c, returnUrl) {
  if (stripeMode() === 'mock' || !c.stripe_customer_id) return null;
  const p = await stripe().billingPortal.sessions.create({ customer: c.stripe_customer_id, return_url: returnUrl, configuration: await portalConfig(), locale: 'ja' });
  return p.url;
}

// 契約内容の変更（商品の追加・値引きの変更など）。次回の請求から新しい金額にする（日割りはしない）
export async function applyToSubscription(c, quote) {
  if (stripeMode() === 'mock' || !c.stripe_subscription_id) {
    run('UPDATE customers SET monthly_fee = ?, plan = ?, billed_json = ? WHERE id = ?', quote.monthlyTotal, quote.planCode, JSON.stringify(quote), c.id);
    return { mock: stripeMode() === 'mock' };
  }
  const s = stripe();
  const sub = await s.subscriptions.retrieve(c.stripe_subscription_id);
  const items = [
    ...sub.items.data.map((it) => ({ id: it.id, deleted: true })),
    ...(await Promise.all(quote.monthly.map(monthlyItem))),
  ];
  const coupon = await couponFor(quote.discount);
  await s.subscriptions.update(sub.id, { items, proration_behavior: 'none', discounts: coupon ? [{ coupon }] : '' });
  run('UPDATE customers SET monthly_fee = ?, plan = ?, billed_json = ? WHERE id = ?', quote.monthlyTotal, quote.planCode, JSON.stringify(quote), c.id);
  return {};
}

// 単発の請求（ドメインの更新費・追加の制作など）。次回の月額と一緒に請求する
export async function addOneTimeCharge(c, { label, amount }) {
  if (stripeMode() === 'mock') return { mock: true };
  if (!c.stripe_customer_id) throw new Error('まだカード決済が済んでいないため、単発の請求を追加できません');
  await stripe().invoiceItems.create({ customer: c.stripe_customer_id, amount, currency: 'jpy', description: label, ...(c.stripe_subscription_id ? { subscription: c.stripe_subscription_id } : {}) });
  return {};
}

// Stripe からの通知（支払い成功・失敗・解約など）
export function verifyWebhook(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET が未設定です');
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}

const byStripeCustomer = (id) => (id ? one('SELECT * FROM customers WHERE stripe_customer_id = ?', id) : null);

export function handleEvent(event, { onPaymentFailed } = {}) {
  const o = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const c = one('SELECT * FROM customers WHERE id = ?', Number(o.metadata?.customer_id || o.client_reference_id));
      if (c && o.status === 'complete') {
        const quote = JSON.parse(c.pending_quote_json || 'null');
        if (quote) markPaid(c.id, { stripeCustomerId: o.customer, subscriptionId: o.subscription, quote });
        else run('UPDATE customers SET payment_status = ?, stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?', 'active', o.customer, o.subscription, c.id);
      }
      break;
    }
    case 'invoice.paid': {
      const c = byStripeCustomer(o.customer);
      if (c) run('UPDATE customers SET payment_status = ? WHERE id = ?', 'active', c.id);
      break;
    }
    case 'invoice.payment_failed': {
      const c = byStripeCustomer(o.customer);
      if (c) { run('UPDATE customers SET payment_status = ? WHERE id = ?', 'past_due', c.id); onPaymentFailed?.(c); }
      break;
    }
    case 'customer.subscription.updated': {
      const c = byStripeCustomer(o.customer);
      const map = { active: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'canceled' };
      if (c && map[o.status]) run('UPDATE customers SET payment_status = ? WHERE id = ?', map[o.status], c.id);
      break;
    }
    case 'customer.subscription.deleted': {
      const c = byStripeCustomer(o.customer);
      if (c) run('UPDATE customers SET payment_status = ? WHERE id = ?', 'canceled', c.id);
      break;
    }
  }
  audit('stripe', event.type, event.id);
}

export const nowMs = now;
