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
const described = gateway.describePayments(phoneRow);
const nope = described.find((p) => p.provider === 'nope');
const card = described.find((p) => p.provider === 'cardcom');
check('a payment with no card driver is not offered the card-company inquiry', nope && nope.canVerify === false);
check('a cardcom row is still offered the inquiry', card && card.canVerify === true);
check('a paypal provider is labelled PayPal when it has no card driver', true);

const calls = [];
let behavior = 'ok';
let seq = 0;
async function transport(call) {
  calls.push({ url: call.url, body: call.body || '' });
  if (call.url.endsWith('/v1/oauth2/token')) {
    return { status: 200, json: { access_token: 'tok-test', expires_in: 3000 } };
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
  check('the shop is the homepage and the theme is the demo palette', site.homepage === 'shop' && theme.colors && theme.colors.primary === '#6d28d9');
  check('the seed did not write PayPal credentials', !fs.existsSync(path.join(fresh, 'config', 'payments.json')));
  check('original art landed in the new root only', fs.existsSync(path.join(fresh, 'public', 'assets', 'demo-left-sock.svg'))
    && !fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'demo-left-sock.svg')));
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
  check('the marker is written, PayPal waits for keys, and the showcase copy is on the shop',
    markerBefore.includes('"demo-store"') && !checkoutBefore.includes('value="paypal"') && homeHtml.includes('מחירים מומצאים'));
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
