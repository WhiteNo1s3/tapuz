'use strict';

/**
 * v2.68 — PayPal sandbox checkout, the demo shop's empty-root gate, and the
 * card-inquiry button that used to appear on a payment row with no card driver.
 *
 * Hermetic: one temp TAPUZ_ROOT for the PayPal cases, more temp roots for the
 * seed gate. PayPal itself is a fake transport (TAPUZ_PAYPAL_FAKE=1). No
 * credential in this file is a real secret; the string is what we assert
 * gets redacted.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-paypal-'));
const extras = [];
process.env.TAPUZ_ROOT = ROOT;
process.env.TAPUZ_PAYPAL_FAKE = '1';
process.env.PAYPAL_CLIENT_ID = 'AWdemoSandboxClientId0001';
process.env.PAYPAL_CLIENT_SECRET = 'sandbox-demo-not-a-real-secret';
delete process.env.PAYPAL_MODE;
delete process.env.TAPUZ_PAYPAL_LIVE;
delete process.env.TAPUZ_DEMO_STORE;

const SECRET = process.env.PAYPAL_CLIENT_SECRET;
let fail = 0;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

process.on('exit', () => {
  for (const d of [ROOT, ...extras]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

const { db } = require('../src/db');
const store = require('../src/store');
const paypal = store.paypal;
const gateway = store.gateway;
const pages = require('../src/pages');

function tables() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
}
function cols(table) {
  return db.prepare('PRAGMA table_info(' + table + ')').all().map((c) => c.name).join(',');
}
const tablesBefore = tables();
const payColsBefore = cols('store_payments');
const orderColsBefore = cols('store_orders');
const appId = db.pragma('application_id', { simple: true });
check('the database is branded TPUZ', appId === 0x5450555A);
check('store tables are already in the initialized schema', ['store_orders', 'store_payments', 'store_products'].every((t) => tablesBefore.includes(t)));

store.settings.saveSettings({
  open: true,
  name: 'חנות בדיקה',
  currency: 'ILS',
  vatRate: 18,
  pricesIncludeVat: true,
  shipping: [
    { id: 'pickup', label: 'איסוף', price: 0, address: false },
    { id: 'delivery', label: 'משלוח', price: 2500, address: true }
  ],
  payments: [
    { id: 'phone', kind: 'call', label: 'טלפון', details: 'נתקשר', phone: '0500000000', url: '' },
    { id: 'paypal', kind: 'paypal', label: 'PayPal', details: 'ארגז חול', phone: '', url: '' }
  ]
});
store.catalog.createProduct({ slug: 'widget', title: 'פריט בדיקה', price: '10', stock: 40, status: 'active', delivery: true });
store.catalog.createProduct({ slug: 'note', title: 'פתק', price: '5', stock: 5, status: 'active', delivery: false });
store.coupons.saveCoupon({ code: 'TEN', kind: 'percent', value: 10 });
const quotedPay = (store.pricing.quote({ items: [{ sku: 'note', qty: 1 }], payment: 'paypal' }).payments || []).find((p) => p.id === 'paypal');
check('a ready paypal method is marked sandbox on the quote', quotedPay && quotedPay.sandbox === true && quotedPay.live !== true);
pages.createPage({ title: 'דף שאינו חנות', slug: 'about', blocks: [], status: 'published' });

const buyer = { name: 'דנה דמו', phone: '0501234567', email: 'dana@example.com' };
const address = { city: 'חיפה', street: 'הנמל 1' };

const phoneOrder = store.orders.placeOrder({
  items: [{ sku: 'note', qty: 1, price: 1 }],
  payment: 'phone',
  customer: buyer
});
check('a non-paypal order still places', phoneOrder.ok === true);
const phoneRow = store.orders.getOrder(phoneOrder.order.number);
const phoneSnapshot = { total: phoneRow.total, status: phoneRow.status, paid: phoneRow.paid_at, title: 'דף שאינו חנות' };

db.prepare(`INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status)
  VALUES (?, 'nope', 'test', ?, 'SESSION123', ?, 'ILS', 'pending')`).run(phoneRow.id, 'ref-nope-' + phoneRow.id, phoneRow.total);
db.prepare(`INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status)
  VALUES (?, 'cardcom', 'test', ?, 'LOWPROFILE1', ?, 'ILS', 'pending')`).run(phoneRow.id, 'ref-card-' + phoneRow.id, phoneRow.total);
// two more rows no card driver wrote: a PayPal one still pending at PayPal, and a demo shop's pretend payment
db.prepare(`INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status)
  VALUES (?, 'paypal', 'test', ?, 'PAYPALROW0001', ?, 'ILS', 'pending')`).run(phoneRow.id, 'ref-pp-' + phoneRow.id, phoneRow.total);
db.prepare(`INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status)
  VALUES (?, 'demo', 'test', ?, '', ?, 'ILS', 'paid')`).run(phoneRow.id, 'ref-demo-' + phoneRow.id, phoneRow.total);
const described = gateway.describePayments(phoneRow);
const nope = described.find((p) => p.provider === 'nope');
const card = described.find((p) => p.provider === 'cardcom');
const ppRow = described.find((p) => p.provider === 'paypal');
const demoRow = described.find((p) => p.provider === 'demo');
check('a payment with no card driver is not offered the card-company inquiry', nope && nope.canVerify === false);
check('a cardcom row is still offered the inquiry', card && card.canVerify === true);
check('a paypal provider is labelled PayPal when it has no card driver', !!ppRow && ppRow.providerLabel === 'PayPal' && nope.providerLabel === 'nope');
check('a pending PayPal row can be asked about, and the button names PayPal — not a card company',
  !!ppRow && ppRow.canVerify === true && ppRow.verifyWith === 'PayPal' && ppRow.refundable === false && card.verifyWith === 'חברת הסליקה');
check('a demo payment row is labelled הדגמה, says no money came, and has neither a refund nor an inquiry',
  !!demoRow && demoRow.providerLabel === 'הדגמה' && demoRow.statusLabel.includes('לא התקבל כסף') && demoRow.refundable === false && demoRow.canVerify === false);
check('a demo payment does not make the order "paid through the gateway"', gateway.isGatewayPaid(phoneRow.id) === false && !store.orders.getOrder(phoneRow.number).paid_at);

const calls = [];
let behavior = 'ok';
// what PayPal answers when it is ASKED about an order (the inquiry):
// 'approved' | 'voided' | 'gone' | 'down', or an amount ("43.00") = completed and captured for that sum
let inquiry = 'approved';
let seq = 0;
async function transport(call) {
  calls.push({ url: call.url, body: call.body || '', method: call.method || 'POST', headers: call.headers || {} });
  if (call.url.endsWith('/v1/oauth2/token')) {
    return { status: 200, json: { access_token: 'tok-test', expires_in: 3000 } };
  }
  if (call.method === 'GET' && /\/v2\/checkout\/orders\/[A-Z0-9]+$/.test(call.url)) {
    const id = call.url.split('/').pop();
    if (inquiry === 'down') return { status: 0, error: 'network down ' + SECRET, transient: true };
    if (inquiry === 'gone') return { status: 404, json: { name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.' }, transient: false };
    if (inquiry === 'voided') return { status: 200, json: { id, status: 'VOIDED' } };
    if (inquiry === 'approved') return { status: 200, json: { id, status: 'APPROVED' } };
    return { status: 200, json: { id, status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAPQ' + id, status: 'COMPLETED', amount: { currency_code: 'ILS', value: inquiry } }] } }] } };
  }
  if (call.url.endsWith('/v2/checkout/orders')) {
    seq += 1;
    const id = ('TESTORDER' + String(10000000 + seq)).slice(0, 18);
    return { status: 201, json: { id, status: 'CREATED' } };
  }
  if (/\/v2\/checkout\/orders\/[A-Z0-9]+\/capture$/.test(call.url)) {
    if (behavior === 'down') return { status: 0, error: 'network down ' + SECRET, transient: true };
    if (behavior === 'echo') return { status: 422, json: { message: 'declined ' + SECRET }, transient: false };
    if (behavior === 'declined') {
      return { status: 201, json: { status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAPDECLINE0001', status: 'DECLINED', amount: { currency_code: 'ILS', value: '43.00' } }] } }] } };
    }
    const created = calls.filter((c) => c.url.endsWith('/v2/checkout/orders')).pop();
    const sent = JSON.parse(created.body);
    const value = behavior === 'mismatch' ? '1.00' : sent.purchase_units[0].amount.value;
    const id = call.url.split('/').slice(-2)[0];
    return {
      status: 201,
      json: {
        id: id,
        status: 'COMPLETED',
        purchase_units: [{
          payments: {
            captures: [{
              id: 'CAP' + id,
              status: 'COMPLETED',
              amount: { currency_code: 'ILS', value: value }
            }]
          }
        }]
      }
    };
  }
  return { status: 500, json: { message: 'unexpected' }, transient: true };
}
paypal.setTestTransport(transport);

function placePaypal() {
  return store.orders.placeOrder({
    items: [{ sku: 'widget', qty: 2, price: 1 }],
    shipping: 'delivery',
    payment: 'paypal',
    coupon: 'TEN',
    customer: buyer,
    address
  });
}

(async () => {
  const placed = placePaypal();
  check('paypal order places at the server total, ignoring a client price', placed.ok && placed.order.totalText === '₪43');
  const order = store.orders.getOrder(placed.order.number);
  check('vat-inclusive total is subtotal − discount + shipping', order.subtotal === 2000 && order.discount === 200 && order.shipping === 2500 && order.total === 4300);
  check('stock moved by the order, not by the client', store.catalog.getProduct('widget').stock === 38);

  calls.length = 0;
  const created = await paypal.createForOrder(order.token, { transport });
  check('create returns a PayPal order id', created.ok && /^TESTORDER/.test(created.orderId));
  const createCall = calls.find((c) => c.url.endsWith('/v2/checkout/orders'));
  const sent = JSON.parse(createCall.body);
  const unit = sent.purchase_units[0];
  check('create talks only to the sandbox host', createCall.url.startsWith('https://api-m.sandbox.paypal.com/'));
  check('the secret is not in the create URL or body', !createCall.url.includes(SECRET) && !createCall.body.includes(SECRET));
  check('PayPal is charged the server total, with lines that add up',
    unit.amount.value === '43.00'
    && unit.amount.breakdown.item_total.value === '20.00'
    && unit.amount.breakdown.discount.value === '2.00'
    && unit.amount.breakdown.shipping.value === '25.00'
    && unit.items.length === 1
    && unit.items[0].quantity === '2'
    && unit.items[0].unit_amount.value === '10.00'
    && unit.items[0].name === 'פריט בדיקה');
  const creates = calls.filter((c) => c.url.endsWith('/v2/checkout/orders')).length;
  const again = await paypal.createForOrder(order.token);
  check('a second create reuses the open PayPal order', again.ok && again.reused && again.orderId === created.orderId
    && calls.filter((c) => c.url.endsWith('/v2/checkout/orders')).length === creates);

  const express = require('express');
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(require('../src/routes/store-paypal'));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  async function hit(pathname, headers, body) {
    const res = await fetch('http://127.0.0.1:' + port + pathname, { method: 'POST', headers, body });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }
  const form = await hit('/api/store/paypal/create', { 'Content-Type': 'application/x-www-form-urlencoded' }, 'token=' + order.token + '&amount=1');
  check('a cross-site form cannot open a PayPal order', form.status === 415 && form.json.code === 'JSON_ONLY');
  const tamper = await hit('/api/store/paypal/create', { 'Content-Type': 'application/json' }, JSON.stringify({ token: order.token, amount: 1, price: 0 }));
  check('the HTTP create ignores a client amount and reuses the server order', tamper.status === 200 && tamper.json.orderId === created.orderId && tamper.json.sandbox === true);
  check('the HTTP reply does not carry the secret', !JSON.stringify(tamper.json).includes(SECRET));
  server.close();

  const view = store.orders.publicOrder(order);
  check('the order page is offered a sandbox button and not a secret', view.payment.paypal && view.payment.paypal.sandbox && view.payment.paypal.canPay
    && view.payment.paypal.sdk.startsWith('https://www.sandbox.paypal.com/sdk/js?')
    && !JSON.stringify(view).includes(SECRET));
  const checkoutHtml = require('../src/store/render').renderCheckout();
  check('checkout says sandbox out loud and does not print the secret',
    checkoutHtml.includes('ארגז חול של PayPal — לא יחויב כסף אמיתי') && !checkoutHtml.includes(SECRET));

  behavior = 'ok';
  const cap1 = await paypal.captureForOrder(order.token, created.orderId);
  check('capture records a test payment and does not mark the order paid', cap1.ok && cap1.test && cap1.status === 'paid' && !store.orders.getOrder(order.number).paid_at);
  const captures = () => calls.filter((c) => /\/capture$/.test(c.url)).length;
  const nCap = captures();
  const cap2 = await paypal.captureForOrder(order.token, created.orderId);
  check('a second capture is a no-op and does not call PayPal again', cap2.ok && cap2.already && captures() === nCap);
  const payRow = paypal.paymentsOf(order.id).find((r) => r.session_id === created.orderId);
  check('the payment row is paid, test mode, and did not set the order paid', payRow && payRow.status === 'paid' && payRow.mode === 'test' && payRow.set_paid === 0);
  const describedPaypal = gateway.describePayments(order).find((p) => p.provider === 'paypal');
  check('the paid sandbox row is labelled and is not given the card inquiry', describedPaypal && describedPaypal.providerLabel === 'PayPal' && describedPaypal.canVerify === false
    && describedPaypal.statusLabel.includes('לא התקבל כסף'));

  behavior = 'mismatch';
  const mismatchPlaced = placePaypal();
  const mismatchCreated = await paypal.createForOrder(mismatchPlaced.order.token);
  const mismatch = await paypal.captureForOrder(mismatchPlaced.order.token, mismatchCreated.orderId);
  const mismatchOrder = store.orders.getOrder(mismatchPlaced.order.number);
  check('a capture whose amount is not the order is a mismatch and unpaid', mismatch.ok === false && mismatch.code === 'MISMATCH' && !mismatchOrder.paid_at
    && paypal.paymentsOf(mismatchOrder.id)[0].status === 'mismatch');

  behavior = 'declined';
  const declinedPlaced = placePaypal();
  const declinedCreated = await paypal.createForOrder(declinedPlaced.order.token);
  const declined = await paypal.captureForOrder(declinedPlaced.order.token, declinedCreated.orderId);
  check('a declined capture is said as unpaid, and the order stays', declined.ok === false && declined.code === 'FAILED'
    && !store.orders.getOrder(declinedPlaced.order.number).paid_at
    && paypal.paymentsOf(store.orders.getOrder(declinedPlaced.order.number).id)[0].status === 'failed');

  behavior = 'down';
  const downPlaced = placePaypal();
  const downCreated = await paypal.createForOrder(downPlaced.order.token);
  const down = await paypal.captureForOrder(downPlaced.order.token, downCreated.orderId);
  const downRow = paypal.paymentsOf(store.orders.getOrder(downPlaced.order.number).id)[0];
  check('a network failure stays pending and does not store the secret', down.code === 'TRANSIENT' && downRow.status === 'pending' && !String(downRow.error).includes(SECRET) && String(downRow.error).includes('[redacted]'));

  behavior = 'echo';
  const echoPlaced = placePaypal();
  const echoCreated = await paypal.createForOrder(echoPlaced.order.token);
  await paypal.captureForOrder(echoPlaced.order.token, echoCreated.orderId);
  const echoRow = paypal.paymentsOf(store.orders.getOrder(echoPlaced.order.number).id)[0];
  check('a provider error that echoes the secret is stored redacted', echoRow.status === 'failed' && !String(echoRow.error).includes(SECRET));

  behavior = 'ok';
  const cancelPlaced = placePaypal();
  await paypal.createForOrder(cancelPlaced.order.token);
  const cancelled = paypal.cancelForOrder(cancelPlaced.order.token);
  const cancelOrder = store.orders.getOrder(cancelPlaced.order.number);
  check('cancel is honest and leaves the order open', cancelled.cancelled && cancelled.message.includes('לא חויב') && cancelOrder.status !== 'cancelled' && !cancelOrder.paid_at);

  const livePlaced = placePaypal();
  check('an order can be placed before anyone switches PayPal to live', livePlaced.ok === true);
  process.env.PAYPAL_MODE = 'live';
  delete process.env.TAPUZ_PAYPAL_LIVE;
  const beforeLiveCalls = calls.length;
  const refused = await paypal.createForOrder(livePlaced.order.token);
  check('live mode without TAPUZ_PAYPAL_LIVE does not call PayPal', refused.code === 'LIVE_REFUSED' && calls.length === beforeLiveCalls);
  process.env.TAPUZ_PAYPAL_LIVE = '1';
  paypal.setTestTransport(transport);
  const armed = await paypal.createForOrder(livePlaced.order.token);
  const liveCall = calls.filter((c) => c.url.includes('/v2/checkout/orders')).pop();
  check('live mode with the arm uses the live host and not the sandbox one', armed.ok && liveCall.url.startsWith('https://api-m.paypal.com/') && !liveCall.url.includes('sandbox'));
  delete process.env.PAYPAL_MODE;
  delete process.env.TAPUZ_PAYPAL_LIVE;
  paypal.setTestTransport(transport);

  // ── v2.69: the wiring the first smoke never held ───────────────────────
  // (a block of its own: the seed section below declares names of its own)
  {
  db.prepare("UPDATE store_products SET stock = 500 WHERE slug = 'widget'").run();
  const createCalls = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/checkout/orders')).length;
  const inquiries = () => calls.filter((c) => c.method === 'GET').length;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

  // the Content-Security-Policy list: nothing unless PayPal is ready AND the shop has a paypal method
  const SANDBOX_HOSTS = ['https://www.sandbox.paypal.com', 'https://www.paypalobjects.com'];
  const LIVE_HOSTS = ['https://www.paypal.com', 'https://www.paypalobjects.com'];
  const none = { script: [], frame: [], connect: [], img: [] };
  const csp = paypal.cspSources();
  check('cspSources in sandbox: exactly the sandbox host and the static host, for script, frame and connect — and no image host',
    same(csp, { script: SANDBOX_HOSTS, frame: SANDBOX_HOSTS, connect: SANDBOX_HOSTS, img: [] }));
  check('cspSources names no wildcard and never the live host while in sandbox', !JSON.stringify(csp).includes('*') && !csp.script.includes('https://www.paypal.com'));
  const noMethod = store.settings.normalize({ payments: [{ id: 'phone', kind: 'call', label: 'טלפון' }] }, store.settings.loadSettings()).settings;
  check('cspSources is empty when the shop has no paypal method, keys or not', same(paypal.cspSources(noMethod), none));
  const keptId = process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_ID;
  check('cspSources is empty without keys', same(paypal.cspSources(), none) && paypal.status().ready === false);
  const openOrderNoKeys = placePaypal();
  check('with the keys gone a paypal order is not even placeable: the method is not offered', openOrderNoKeys.ok === false && openOrderNoKeys.code === 'PAYMENT_REQUIRED');
  const unready = store.orders.publicOrder(store.orders.getOrder(cancelPlaced.order.number)).payment.paypal;
  check('an open PayPal order whose keys are gone says PayPal is unavailable — not "you can pay" over no button',
    unready.canPay === false && unready.sdk === '' && unready.message === 'תשלום ב-PayPal אינו זמין כרגע — צרו איתנו קשר');
  check('readinessNote tells the owner why PayPal is not at the checkout', /PayPal מוגדר כאמצעי תשלום אבל אינו מוצע/.test(paypal.readinessNote()) && /חסרים מפתחות PayPal/.test(paypal.readinessNote()));
  process.env.PAYPAL_CLIENT_ID = keptId;
  check('readinessNote is empty when every configured method is offered', paypal.readinessNote() === '');
  process.env.PAYPAL_MODE = 'live';
  check('cspSources is empty while live is asked for and the server is not armed', same(paypal.cspSources(), none));
  process.env.TAPUZ_PAYPAL_LIVE = '1';
  check('cspSources in live: exactly the live host and the static host — never the sandbox',
    same(paypal.cspSources(), { script: LIVE_HOSTS, frame: LIVE_HOSTS, connect: LIVE_HOSTS, img: [] }));
  delete process.env.PAYPAL_MODE;
  delete process.env.TAPUZ_PAYPAL_LIVE;
  paypal.setTestTransport(transport);

  // what the create call asks of PayPal's own window, and the two request ids
  behavior = 'ok';
  const ctxPlaced = placePaypal();
  const ctxOrder = store.orders.getOrder(ctxPlaced.order.number);
  check('placeOrder keeps the KIND of the method beside its id', ctxOrder.payment_kind === 'paypal' && ctxOrder.payment_method === 'paypal');
  calls.length = 0;
  const ctxCreated = await paypal.createForOrder(ctxOrder.token);
  const ctxCreate = calls.find((c) => c.url.endsWith('/v2/checkout/orders'));
  const ctx = JSON.parse(ctxCreate.body).payment_source.paypal.experience_context;
  check('create tells PayPal not to ask for an address, to say "pay now", the shop\'s name, and Hebrew',
    ctx.shipping_preference === 'NO_SHIPPING' && ctx.user_action === 'PAY_NOW' && ctx.brand_name === 'חנות בדיקה' && ctx.locale === 'he-IL');
  await paypal.captureForOrder(ctxOrder.token, ctxCreated.orderId);
  const ctxCapture = calls.find((c) => /\/capture$/.test(c.url));
  check('create and capture each carry their own PayPal-Request-Id',
    !!ctxCreate.headers['PayPal-Request-Id'] && ctxCapture.headers['PayPal-Request-Id'] === ctxCreate.headers['PayPal-Request-Id'] + '-c');

  // paid or cancelled: refused BEFORE anything leaves
  const paidPlaced = placePaypal();
  store.orders.markPaid(paidPlaced.order.number, true);
  calls.length = 0;
  const paidCreate = await paypal.createForOrder(paidPlaced.order.token);
  check('create for an order already marked paid: 409 PAID and not one call to PayPal', paidCreate.http === 409 && paidCreate.code === 'PAID' && calls.length === 0);

  const lateCancel = placePaypal();
  const lateCreated = await paypal.createForOrder(lateCancel.order.token);
  store.orders.setStatus(lateCancel.order.number, 'cancelled', { notify: false });
  calls.length = 0;
  const cancelCapture = await paypal.captureForOrder(lateCancel.order.token, lateCreated.orderId);
  check('capture for an order cancelled after the buyer opened PayPal: 409 CANCELLED and not one call — no money is taken',
    cancelCapture.http === 409 && cancelCapture.code === 'CANCELLED' && calls.length === 0 && paypal.paymentsOf(store.orders.getOrder(lateCancel.order.number).id)[0].status === 'pending');
  const cancelCreate = await paypal.createForOrder(lateCancel.order.token);
  check('create for a cancelled order: 409 CANCELLED and not one call', cancelCreate.http === 409 && cancelCreate.code === 'CANCELLED' && calls.length === 0);

  const latePaid = placePaypal();
  const latePaidCreated = await paypal.createForOrder(latePaid.order.token);
  store.orders.markPaid(latePaid.order.number, true);
  calls.length = 0;
  const paidCapture = await paypal.captureForOrder(latePaid.order.token, latePaidCreated.orderId);
  check('capture for an order paid another way meanwhile: 409 PAID and not one call', paidCapture.http === 409 && paidCapture.code === 'PAID' && calls.length === 0);
  const stillAlready = await paypal.captureForOrder(order.token, created.orderId);
  check('…while a paid row of the same order still answers "already"', stillAlready.ok && stillAlready.already === true);

  // a sum above ₪10,000,000 that PayPal reports to the agora is a payment, not a mismatch
  const bigPlaced = placePaypal();
  db.prepare('UPDATE store_orders SET total = 1200000000, subtotal = 1200000000, discount = 0, shipping = 0 WHERE number = ?').run(bigPlaced.order.number);
  const bigCreated = await paypal.createForOrder(bigPlaced.order.token);
  const bigSent = JSON.parse(calls.filter((c) => c.url.endsWith('/v2/checkout/orders')).pop().body).purchase_units[0].amount.value;
  const bigCap = await paypal.captureForOrder(bigPlaced.order.token, bigCreated.orderId);
  check('₪12,000,000 captured exactly is recorded as paid — not declared a mismatch',
    bigSent === '12000000.00' && bigCap.ok === true && bigCap.status === 'paid' && paypal.paymentsOf(store.orders.getOrder(bigPlaced.order.number).id)[0].status === 'paid');
  check('the amount parser is strict and has no ceiling', paypal.paypalToMinor('12000000.00') === 1200000000 && Number.isNaN(paypal.paypalToMinor('43'))
    && Number.isNaN(paypal.paypalToMinor('43.0')) && Number.isNaN(paypal.paypalToMinor('43,00')) && Number.isNaN(paypal.paypalToMinor('-43.00')) && paypal.paypalToMinor('0.13') === 13);

  // the inquiry: what a capture left unknown is found out
  behavior = 'down';
  const lostPlaced = placePaypal();
  const lostOrder = store.orders.getOrder(lostPlaced.order.number);
  const lostCreated = await paypal.createForOrder(lostOrder.token);
  await paypal.captureForOrder(lostOrder.token, lostCreated.orderId);
  behavior = 'ok';
  const lostRow = () => paypal.paymentsOf(lostOrder.id).find((r) => r.session_id === lostCreated.orderId);
  check('a capture that got no answer leaves the row pending', lostRow().status === 'pending');
  let asked = inquiries();
  const first = await paypal.verifyRow(lostRow(), { source: 'page' });
  const second = await paypal.verifyRow(lostRow(), { source: 'page' });
  check('from the order page a capture that got no answer is asked about at once — a row in doubt has no clock to start — and the next ask is throttled', first.asked === true && !first.deferred && second.throttled === true && inquiries() === asked + 1);
  inquiry = 'down';
  const down1 = await paypal.verifyRow(lostRow(), { source: 'admin' });
  check('an inquiry that cannot reach PayPal leaves the row pending and stores no secret',
    down1.ok === false && down1.transient === true && lostRow().status === 'pending' && !String(lostRow().error).includes(SECRET));
  inquiry = 'approved';
  const waiting = await paypal.verifyRow(lostRow(), { source: 'admin' });
  check('an order PayPal has not completed stays pending', waiting.ok === true && waiting.changed === false && lostRow().status === 'pending' && /APPROVED/.test(waiting.message || ''));
  inquiry = '43.00';
  asked = inquiries();
  const found = await gateway.adminVerify(lostOrder, lostRow().id);
  check('verifyRow settles an order PayPal reports COMPLETED — through the admin\'s own check, as a test payment',
    found.ok === true && found.changed === true && found.status === 'paid' && inquiries() === asked + 1
    && lostRow().status === 'paid' && lostRow().transaction_id === 'CAPQ' + lostCreated.orderId && !store.orders.getOrder(lostOrder.number).paid_at
    && found.message === 'תשלום בדיקה אושר ונרשם — לא התקבל כסף');
  const again2 = await paypal.verifyRow(lostRow(), { source: 'admin' });
  check('a settled row is not asked about again', again2.changed === false && again2.status === 'paid' && inquiries() === asked + 1);

  behavior = 'down';
  const wrongPlaced = placePaypal();
  const wrongOrder = store.orders.getOrder(wrongPlaced.order.number);
  const wrongCreated = await paypal.createForOrder(wrongOrder.token);
  await paypal.captureForOrder(wrongOrder.token, wrongCreated.orderId);
  behavior = 'ok';
  inquiry = '1.00';
  const wrong = await paypal.verifyRow(paypal.paymentsOf(wrongOrder.id)[0], { source: 'admin' });
  check('an inquiry that reports another sum is a mismatch, exactly as a capture would be', wrong.status === 'mismatch' && wrong.changed === true
    && paypal.paymentsOf(wrongOrder.id)[0].status === 'mismatch' && /PayPal דיווח על ₪1/.test(paypal.paymentsOf(wrongOrder.id)[0].error));

  behavior = 'down';
  const gonePlaced = placePaypal();
  const goneOrder = store.orders.getOrder(gonePlaced.order.number);
  const goneCreated = await paypal.createForOrder(goneOrder.token);
  await paypal.captureForOrder(goneOrder.token, goneCreated.orderId);
  behavior = 'ok';
  inquiry = 'gone';
  const gone = await paypal.verifyRow(paypal.paymentsOf(goneOrder.id)[0], { source: 'admin' });
  check('an order PayPal no longer knows closes the row, and the history says nothing was charged', gone.status === 'failed' && gone.changed === true
    && store.orders.listEvents(goneOrder.id).some((e) => /פג בלי שהושלם/.test(e.text)));
  inquiry = 'approved';

  // a method renamed under an open order
  const renamePlaced = placePaypal();
  const renameOrder = store.orders.getOrder(renamePlaced.order.number);
  store.settings.saveSettings({ payments: [
    { id: 'phone', kind: 'call', label: 'טלפון', details: 'נתקשר', phone: '0500000000', url: '' },
    { id: 'pp-new', kind: 'paypal', label: 'PayPal חדש', details: '', phone: '', url: '' }
  ] });
  const renamedView = store.orders.publicOrder(renameOrder);
  const renamedCreate = await paypal.createForOrder(renameOrder.token);
  check('an order placed before its PayPal method was renamed is still a PayPal order: the page has its button and create opens',
    renamedView.payment.kind === 'paypal' && renamedView.payment.paypal && renamedView.payment.paypal.canPay === true && renamedCreate.ok === true && /^TESTORDER/.test(renamedCreate.orderId));
  store.settings.saveSettings({ payments: [{ id: 'phone', kind: 'call', label: 'טלפון', details: 'נתקשר', phone: '0500000000', url: '' }] });
  const removedView = store.orders.publicOrder(renameOrder);
  const removedCreate = await paypal.createForOrder(renameOrder.token);
  check('with the method removed altogether the order still says PayPal — and says it is unavailable, opening nothing',
    removedView.payment.kind === 'paypal' && removedView.payment.paypal.canPay === false && removedCreate.code === 'NOT_READY' && same(paypal.cspSources(), none));
  store.settings.saveSettings({ payments: [
    { id: 'phone', kind: 'call', label: 'טלפון', details: 'נתקשר', phone: '0500000000', url: '' },
    { id: 'paypal', kind: 'paypal', label: 'PayPal', details: 'ארגז חול', phone: '', url: '' }
  ] });

  // the caps: a button that could only answer "too many" is not offered, and a crash's leftover does not count
  const capPlaced = placePaypal();
  const capOrder = store.orders.getOrder(capPlaced.order.number);
  db.prepare(`INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status, created_at)
    VALUES (?, 'paypal', 'test', ?, '', ?, 'ILS', 'pending', datetime('now', '-5 minutes'))`).run(capOrder.id, 'ref-stale-' + capOrder.id, capOrder.total);
  const afterStale = await paypal.createForOrder(capOrder.token);
  const staleRow = db.prepare('SELECT * FROM store_payments WHERE reference = ?').get('ref-stale-' + capOrder.id);
  check('a pending row that never got a PayPal order id is closed after a minute, and a new payment still opens', afterStale.ok === true && staleRow.status === 'failed' && /לא התקבלה תשובה/.test(staleRow.error));
  for (let i = 0; i < 10; i++) {
    db.prepare(`INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status, created_at)
      VALUES (?, 'paypal', 'test', ?, ?, 1, 'ILS', 'failed', datetime('now', '-1 day'))`).run(capOrder.id, 'ref-cap-' + capOrder.id + '-' + i, 'CAPPEDORDER' + i);
  }
  db.prepare("UPDATE store_payments SET status = 'failed' WHERE order_id = ? AND status = 'pending'").run(capOrder.id);
  const capped = store.orders.publicOrder(capOrder).payment.paypal;
  const cappedCreate = await paypal.createForOrder(capOrder.token);
  check('past the attempt cap the order page offers no button and says why', capped.canPay === false && capped.sdk === '' && /יותר מדי ניסיונות/.test(capped.message) && cappedCreate.code === 'TOO_MANY');

  // the keys in the admin: a value goes in and never comes back
  const envId = process.env.PAYPAL_CLIENT_ID;
  const envSecret = process.env.PAYPAL_CLIENT_SECRET;
  const viaEnv = paypal.adminSettings();
  check('adminSettings marks keys the environment supplies, with a tail and never a value',
    viaEnv.fields.clientId.env === true && viaEnv.fields.clientSecret.env === true && viaEnv.fields.clientSecret.tail === SECRET.slice(-4) && !JSON.stringify(viaEnv).includes(SECRET));
  // fixture values are joined from plain words: obviously not credentials, and never a key-colon-quoted literal
  const words = (...w) => w.join('-');
  const OTHER_VALUE = words('another', 'value', 'for', 'tests');
  const blockedSave = paypal.saveAdminSettings({ clientSecret: OTHER_VALUE });
  check('a key the environment supplies is not written to the file', blockedSave.errors.some((e) => /משתני הסביבה/.test(e)) && !fs.existsSync(path.join(ROOT, 'config', 'payments.json')));
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  const FILE_SECRET = words('typed', 'in', 'the', 'admin', 'for', 'tests', 'tail');
  const saved = paypal.saveAdminSettings({ clientId: 'AWfileSandboxClientId0002', clientSecret: FILE_SECRET, mode: 'test' });
  const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'payments.json'), 'utf8'));
  check('keys typed in the admin land in gitignored payments.json and make PayPal ready',
    saved.errors.length === 0 && onDisk.paypal.clientId === 'AWfileSandboxClientId0002' && onDisk.paypal.clientSecret === FILE_SECRET && paypal.status().ready === true && paypal.status().sandbox === true);
  check('the reply to a save carries the tail and never the secret', saved.settings.fields.clientSecret.set === true && saved.settings.fields.clientSecret.tail === 'tail' && !JSON.stringify(saved).includes(FILE_SECRET));
  const badId = paypal.saveAdminSettings({ clientId: 'no' });
  check('a Client ID that cannot be one is refused and the stored one stays', badId.errors.length === 1 && JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'payments.json'), 'utf8')).paypal.clientId === 'AWfileSandboxClientId0002');
  const liveNoArm = paypal.saveAdminSettings({ mode: 'live', confirmLive: true });
  check('"live" is refused from the screen while the server is not armed — the mode stays sandbox', liveNoArm.errors.some((e) => /TAPUZ_PAYPAL_LIVE=1/.test(e)) && paypal.status().sandbox === true);
  process.env.TAPUZ_PAYPAL_LIVE = '1';
  const liveNoConfirm = paypal.saveAdminSettings({ mode: 'live' });
  check('…and on an armed server it still needs the explicit confirmation', liveNoConfirm.errors.some((e) => /אישור מפורש/.test(e)) && paypal.status().sandbox === true);
  delete process.env.TAPUZ_PAYPAL_LIVE;
  calls.length = 0;
  const tested = await paypal.testConnection();
  check('the connection check asks PayPal for a token on the sandbox host and says it worked',
    tested.ok === true && /תקין/.test(tested.message) && calls.length === 1 && calls[0].url === 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
  paypal.setTestTransport(async (call) => (call.url.endsWith('/v1/oauth2/token')
    ? { status: 401, json: { error: 'invalid_client', error_description: 'Client Authentication failed ' + FILE_SECRET } }
    : { status: 500, json: {}, transient: true }));
  const rejected = await paypal.testConnection();
  check('keys PayPal rejects are said so, with the secret blanked out of PayPal\'s own words', rejected.ok === false && /דחה את המפתחות/.test(rejected.message) && !rejected.message.includes(FILE_SECRET));
  const cleared = paypal.saveAdminSettings({ clientId: '', clientSecret: '' });
  check('✕ clears a stored key, and PayPal is not ready again', cleared.settings.fields.clientSecret.set === false && paypal.status().ready === false);
  const noKeysTest = await paypal.testConnection();
  check('without keys the connection check says so and calls nobody', noKeysTest.ok === false && /חסרים מפתחות/.test(noKeysTest.message));
  process.env.PAYPAL_CLIENT_ID = envId;
  process.env.PAYPAL_CLIENT_SECRET = envSecret;
  paypal.setTestTransport(transport);

  // the owner hears about a PayPal payment the way a card payment is said — and the order's history says whether the mail went
  store.settings.saveSettings({ notifyEmail: 'owner@shop.example' });
  behavior = 'ok';
  const mailPlaced = placePaypal();
  const mailOrder = store.orders.getOrder(mailPlaced.order.number);
  const mailCreated = await paypal.createForOrder(mailOrder.token);
  await paypal.captureForOrder(mailOrder.token, mailCreated.orderId);
  await tick();
  const mailEvents = store.orders.listEvents(mailOrder.id).filter((e) => e.kind === 'mail').map((e) => e.text);
  check('after a PayPal payment settles the owner is written to, and with no SMTP the history says WHICH mail did not go — three lines, no two alike',
    mailEvents.length === 3 && mailEvents.includes('ההתראה על ההזמנה לא נשלחה לבעל החנות: SMTP לא מוגדר')
    && mailEvents.includes('הודעת התשלום לא נשלחה לבעל החנות: SMTP לא מוגדר') && mailEvents.includes('אישור ההזמנה לא נשלח ללקוח/ה: SMTP לא מוגדר')
    && !mailEvents.some((t) => t.includes('dana@example.com')));
  store.settings.saveSettings({ notifyEmail: '' });
  }

  const phoneAfter = store.orders.getOrder(phoneOrder.order.number);
  const about = pages.getPageByFullPath('about');
  check('the earlier non-paypal order is untouched', phoneAfter.total === phoneSnapshot.total && phoneAfter.status === phoneSnapshot.status && phoneAfter.paid_at === phoneSnapshot.paid);
  check('the non-store page is untouched', about && about.title === phoneSnapshot.title);
  require('../src/store/schema').initializeStore(db);
  check('opening the schema again does not change store tables or columns',
    tables().join(',') === tablesBefore.join(',') && cols('store_payments') === payColsBefore && cols('store_orders') === orderColsBefore);

  delete process.env.TAPUZ_PAYPAL_FAKE;
  let threw = false;
  try { paypal.setTestTransport(() => {}); } catch (e) { threw = true; }
  process.env.TAPUZ_PAYPAL_FAKE = '1';
  check('a test transport cannot be installed unless the fake flag is on', threw);

  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const seedSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'seed-content.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'seed', 'manifest.json'), 'utf8');
  check('boot arms the demo only through maybeDemoStore', serverSrc.includes("require('./store/demo-seed').maybeDemoStore()"));
  check('the content seed does not know the demo catalog', !seedSrc.includes('demo-seed') && !seedSrc.includes('TAPUZ_DEMO_STORE') && !manifest.includes('חנות הדברים'));
  const storeJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'tz-store.js'), 'utf8');
  check('the checkout script rebuilds payment choices from the quote as text',
    storeJs.includes('[data-tz-pay-choices]') && storeJs.includes("el('span', 'bent-choice-label', p.label || p.id || '')"));

  function runSeed(env, args) {
    const childEnv = Object.assign({}, process.env);
    delete childEnv.TAPUZ_DEMO_STORE;
    for (const [k, v] of Object.entries(env)) {
      if (v == null) delete childEnv[k];
      else childEnv[k] = v;
    }
    return spawnSync(process.execPath, [path.join(__dirname, 'seed-demo-store.js'), ...args], {
      cwd: path.join(__dirname, '..'),
      env: childEnv,
      encoding: 'utf8'
    });
  }

  const pinned = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-paypal-pin-'));
  extras.push(pinned);
  fs.writeFileSync(path.join(pinned, 'SENTINEL'), 'do-not-touch', 'utf8');
  const pinFile = path.join(os.tmpdir(), 'tapuz-paypal-pinfile-' + process.pid);
  fs.writeFileSync(pinFile, pinned + '\n', 'utf8');
  const noRoot = runSeed({ TAPUZ_ROOT: null, TAPUZ_PIN_FILE: pinFile }, ['--apply']);
  check('without TAPUZ_ROOT the demo refuses and does not follow a pin', noRoot.status === 2 && fs.readFileSync(path.join(pinned, 'SENTINEL'), 'utf8') === 'do-not-touch');
  fs.rmSync(pinFile, { force: true });

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-paypal-bare-'));
  extras.push(bare);
  const noApply = runSeed({ TAPUZ_ROOT: bare }, []);
  check('without --apply nothing is written', noApply.status === 2 && !fs.existsSync(path.join(bare, 'db', 'tapuz.db')));

  const living = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-paypal-living-'));
  extras.push(living);
  fs.mkdirSync(path.join(living, 'config'));
  fs.writeFileSync(path.join(living, 'config', 'site.json'), '{"title":"אתר קיים"}\n', 'utf8');
  fs.mkdirSync(path.join(living, 'db'));
  fs.writeFileSync(path.join(living, 'db', 'tapuz.db'), 'not-a-database-but-do-not-touch', 'utf8');
  const beforeHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(living, 'db', 'tapuz.db'))).digest('hex');
  const refusedLiving = runSeed({ TAPUZ_ROOT: living }, ['--apply']);
  const afterHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(living, 'db', 'tapuz.db'))).digest('hex');
  check('an existing site is refused before the database is opened', refusedLiving.status === 2 && beforeHash === afterHash
    && fs.readFileSync(path.join(living, 'config', 'site.json'), 'utf8').includes('אתר קיים'));

  const dbOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-paypal-dbonly-'));
  extras.push(dbOnly);
  const seeded = spawnSync(process.execPath, ['-e', `
    process.env.TAPUZ_ROOT = ${JSON.stringify(dbOnly)};
    require('./src/pages').createPage({ title: 'קיים בדאטאבייס', slug: 'keep-me', blocks: [], status: 'published' });
    console.log('SEEDED');
  `], { cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { TAPUZ_ROOT: dbOnly }), encoding: 'utf8' });
  check('a database-only site could be prepared', seeded.status === 0 && seeded.stdout.includes('SEEDED'));
  fs.rmSync(path.join(dbOnly, 'config'), { recursive: true, force: true });
  fs.rmSync(path.join(dbOnly, 'pages'), { recursive: true, force: true });
  fs.rmSync(path.join(dbOnly, 'content'), { recursive: true, force: true });
  const refusedDb = runSeed({ TAPUZ_ROOT: dbOnly }, ['--apply']);
  const Database = require('better-sqlite3');
  const existing = new Database(path.join(dbOnly, 'db', 'tapuz.db'), { readonly: true, fileMustExist: true });
  const kept = existing.prepare("SELECT title FROM pages WHERE slug = 'keep-me'").get();
  const productsThere = existing.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'store_products'").get();
  const productCount = productsThere ? existing.prepare('SELECT COUNT(*) AS n FROM store_products').get().n : 0;
  existing.close();
  check('a root whose database already has a page is refused and gains no catalog', refusedDb.status === 2 && kept && kept.title === 'קיים בדאטאבייס' && productCount === 0);

  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-paypal-fresh-'));
  extras.push(fresh);
  const applied = runSeed({ TAPUZ_ROOT: fresh }, ['--apply']);
  check('an empty root with --apply gets the demo shop', applied.status === 0 && applied.stdout.includes('DEMO_APPLIED'));
  const demo = new Database(path.join(fresh, 'db', 'tapuz.db'), { readonly: true, fileMustExist: true });
  const sock = demo.prepare("SELECT title, price FROM store_products WHERE slug = 'left-sock'").get();
  const cloud = demo.prepare("SELECT price FROM store_products WHERE slug = 'named-cloud'").get();
  const open = demo.prepare("SELECT value FROM store_meta WHERE key = 'settings'").get();
  const settings = open ? JSON.parse(open.value) : {};
  const pay = (settings.payments || []).find((p) => p.kind === 'paypal');
  demo.close();
  const site = JSON.parse(fs.readFileSync(path.join(fresh, 'config', 'site.json'), 'utf8'));
  const theme = JSON.parse(fs.readFileSync(path.join(fresh, 'config', 'theme-overrides.json'), 'utf8'));
  check('the demo catalog is the gag shop, with absurd prices and a paypal method',
    sock && sock.title.includes('גרב') && sock.price === 13 && cloud && cloud.price === 100000100 && pay && settings.open === true);
  // v2.69 (demo version 2): the home page and the shop are two pages — `home` is crowned
  check('the home page is its own page and the theme is the demo palette', site.homepage === 'home' && theme.colors && theme.colors.primary === '#6d28d9');
  check('the seed did not write PayPal credentials', !fs.existsSync(path.join(fresh, 'config', 'payments.json')));
  // version 2's art is written under demo2-<name>.svg, and no version 1 file name is written any more
  check('original art landed in the new root only', fs.existsSync(path.join(fresh, 'public', 'assets', 'demo2-left-sock.svg'))
    && !fs.existsSync(path.join(fresh, 'public', 'assets', 'demo-left-sock.svg'))
    && !fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'demo2-left-sock.svg')));
  const scriptMarker = fs.readFileSync(path.join(fresh, 'config', 'seeded.json'), 'utf8');
  check('the script leaves a marked demo, like the boot', scriptMarker.includes('"demo-store"') && scriptMarker.includes('"demo-store-v2"'));
  const second = runSeed({ TAPUZ_ROOT: fresh }, ['--apply']);
  check('a second apply refuses now that the root is a site', second.status === 2);

  function hashFile(p) {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  function bootDemo(env) {
    const childEnv = Object.assign({}, process.env);
    for (const k of ['TAPUZ_ROOT', 'TAPUZ_DEMO_STORE', 'TAPUZ_PIN_FILE', 'TAPUZ_SEED', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MODE', 'TAPUZ_PAYPAL_LIVE', 'TAPUZ_PAYPAL_FAKE']) {
      delete childEnv[k];
    }
    for (const [k, v] of Object.entries(env)) {
      if (v == null) delete childEnv[k];
      else childEnv[k] = v;
    }
    return spawnSync(process.execPath, ['-e', `
      const r = require('./src/store/demo-seed').maybeDemoStore();
      console.log('BOOT ' + JSON.stringify(r));
    `], { cwd: path.join(__dirname, '..'), env: childEnv, encoding: 'utf8' });
  }

  const quiet = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-demo-quiet-'));
  extras.push(quiet);
  const noFlag = bootDemo({ TAPUZ_ROOT: quiet });
  check('boot without the flag writes nothing', noFlag.status === 0 && noFlag.stdout.includes('"reason":"not armed"')
    && !fs.existsSync(path.join(quiet, 'db')) && !fs.existsSync(path.join(quiet, 'config')));

  const pinBare = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-demo-pinbare-'));
  extras.push(pinBare);
  fs.writeFileSync(path.join(pinBare, 'SENTINEL'), 'do-not-touch', 'utf8');
  const pinBareFile = path.join(os.tmpdir(), 'tapuz-demo-pinbare-file-' + process.pid);
  fs.writeFileSync(pinBareFile, pinBare + '\n', 'utf8');
  const pinOnly = bootDemo({ TAPUZ_PIN_FILE: pinBareFile });
  check('a pin without the flag does not seed', pinOnly.status === 0 && pinOnly.stdout.includes('"reason":"not armed"')
    && fs.readFileSync(path.join(pinBare, 'SENTINEL'), 'utf8') === 'do-not-touch'
    && !fs.existsSync(path.join(pinBare, 'db')));
  fs.rmSync(pinBareFile, { force: true });

  const once = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-demo-once-'));
  extras.push(once);
  const firstBoot = bootDemo({ TAPUZ_ROOT: once, TAPUZ_DEMO_STORE: '1' });
  const checkoutPath = path.join(once, 'public', 'checkout.html');
  const dbPath = path.join(once, 'db', 'tapuz.db');
  const markerPath = path.join(once, 'config', 'seeded.json');
  check('an empty root with the flag seeds once', firstBoot.status === 0 && firstBoot.stdout.includes('"ran":true'));
  const checkoutBefore = fs.readFileSync(checkoutPath, 'utf8');
  const dbBefore = hashFile(dbPath);
  const markerBefore = fs.readFileSync(markerPath, 'utf8');
  const homeHtml = fs.readFileSync(path.join(once, 'public', 'index.html'), 'utf8');
  check('both markers are written, PayPal waits for keys, and the showcase copy is on the home page',
    markerBefore.includes('"demo-store"') && markerBefore.includes('"demo-store-v2"')
    && !checkoutBefore.includes('value="paypal"') && homeHtml.includes('מחירים מומצאים'));
  // with nobody's keys the demo shop can still take an order: the demo payment is on the exported checkout
  check('a keyless demo offers the demo payment at checkout', /name="payment" value="[^"]+" data-kind="demo"/.test(checkoutBefore));
  const secondBoot = bootDemo({ TAPUZ_ROOT: once, TAPUZ_DEMO_STORE: '1' });
  check('a second boot is a no-op', secondBoot.status === 0 && secondBoot.stdout.includes('"reason":"already applied"')
    && hashFile(dbPath) === dbBefore
    && fs.readFileSync(markerPath, 'utf8') === markerBefore
    && fs.readFileSync(checkoutPath, 'utf8') === checkoutBefore);

  const withKeys = bootDemo({
    TAPUZ_ROOT: once,
    TAPUZ_DEMO_STORE: '1',
    PAYPAL_CLIENT_ID: 'AWdemoSandboxClientId0001',
    PAYPAL_CLIENT_SECRET: 'sandbox-demo-not-a-real-secret'
  });
  const checkoutAfter = fs.readFileSync(checkoutPath, 'utf8');
  const demoDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  const stillSock = demoDb.prepare("SELECT price FROM store_products WHERE slug = 'left-sock'").get();
  demoDb.close();
  check('a later boot with PayPal env republishes checkout and leaves the catalog',
    withKeys.status === 0 && withKeys.stdout.includes('"reason":"already applied"')
    && withKeys.stdout.includes('"refreshed":true')
    && checkoutAfter.includes('value="paypal"') && checkoutAfter.includes('ארגז חול של PayPal')
    && stillSock && stillSock.price === 13
    && !fs.existsSync(path.join(once, 'config', 'payments.json')));

  const armedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-demo-armed-'));
  extras.push(armedRoot);
  const armedBoot = bootDemo({
    TAPUZ_ROOT: armedRoot,
    TAPUZ_DEMO_STORE: '1',
    PAYPAL_CLIENT_ID: 'AWdemoSandboxClientId0001',
    PAYPAL_CLIENT_SECRET: 'sandbox-demo-not-a-real-secret'
  });
  const armedHtml = fs.readFileSync(path.join(armedRoot, 'public', 'checkout.html'), 'utf8');
  check('a first boot that already has the PayPal env exports the button',
    armedBoot.status === 0 && armedBoot.stdout.includes('"ran":true')
    && armedHtml.includes('value="paypal"') && armedHtml.includes('ארגז חול של PayPal'));

  const pinEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-demo-pinempty-'));
  extras.push(pinEmpty);
  const pinEmptyFile = path.join(os.tmpdir(), 'tapuz-demo-pinempty-file-' + process.pid);
  fs.writeFileSync(pinEmptyFile, pinEmpty + '\n', 'utf8');
  const pinSeed = bootDemo({ TAPUZ_PIN_FILE: pinEmptyFile, TAPUZ_DEMO_STORE: '1' });
  check('the flag seeds a pinned empty root, and the pin alone is not the arm',
    pinSeed.status === 0 && pinSeed.stdout.includes('"ran":true')
    && fs.existsSync(path.join(pinEmpty, 'config', 'seeded.json')));
  fs.rmSync(pinEmptyFile, { force: true });

  const occupied = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-demo-occupied-'));
  extras.push(occupied);
  fs.mkdirSync(path.join(occupied, 'config'));
  fs.writeFileSync(path.join(occupied, 'config', 'site.json'), '{"title":"אתר קיים"}\n', 'utf8');
  fs.mkdirSync(path.join(occupied, 'db'));
  fs.writeFileSync(path.join(occupied, 'db', 'tapuz.db'), 'not-a-database-but-do-not-touch', 'utf8');
  const siteBefore = hashFile(path.join(occupied, 'config', 'site.json'));
  const dbOccupied = hashFile(path.join(occupied, 'db', 'tapuz.db'));
  const refusedBoot = bootDemo({ TAPUZ_ROOT: occupied, TAPUZ_DEMO_STORE: '1' });
  check('an existing site with the flag is refused and byte-identical',
    refusedBoot.status === 0 && refusedBoot.stdout.includes('NOT applied')
    && hashFile(path.join(occupied, 'config', 'site.json')) === siteBefore
    && hashFile(path.join(occupied, 'db', 'tapuz.db')) === dbOccupied
    && !fs.existsSync(path.join(occupied, 'config', 'seeded.json')));

  const unreadable = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-demo-unreadable-'));
  extras.push(unreadable);
  fs.writeFileSync(path.join(unreadable, 'pages'), 'keep-me', 'utf8');
  const badBoot = bootDemo({ TAPUZ_ROOT: unreadable, TAPUZ_DEMO_STORE: '1' });
  check('an inventory that fails refuses and writes nothing',
    badBoot.status === 0 && badBoot.stdout.includes('NOT applied')
    && fs.readFileSync(path.join(unreadable, 'pages'), 'utf8') === 'keep-me'
    && !fs.existsSync(path.join(unreadable, 'db')));

  console.log(fail ? '\nSMOKE STORE-PAYPAL: FAIL (' + fail + ')' : '\nSMOKE STORE-PAYPAL: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  console.log('\nSMOKE STORE-PAYPAL: FAIL');
  process.exit(1);
});
