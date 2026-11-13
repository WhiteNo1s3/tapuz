'use strict';

/**
 * v2.69 — the store's wiring, through the REAL server: an order must always
 * be able to finish, and a shop must say so when it cannot.
 *
 *   no payment     a shop whose only method is not offered (PayPal, no keys)
 *                  says NO_PAYMENT in the quote and at checkout — not "choose
 *                  a method" over an empty list
 *   the demo       a `demo` method is offered ONLY on a demo site (or by the
 *                  owner's explicit setting); its pay door records a test
 *                  payment once, never sets paid_at, refuses a cancelled
 *                  order, a wrong token, a non-JSON body
 *   the order      keeps the KIND of its method, so a renamed method does not
 *                  strand it; a total past the money type's ceiling never
 *                  becomes an order
 *   the policy     the origins PayPal's button needs, merged into the page's
 *                  own Content-Security-Policy the way src/server.js merges
 *                  them — and nothing at all without PayPal
 *   the keys       PayPal's keys are typed in the admin, never read back, and
 *                  an editor is refused on every new route
 *   the owner      the order list pages, the CSV carries every order and the
 *                  payment columns, old unpaid orders give their stock back,
 *                  and the order's history says whether a mail went out
 *   in doubt       a PayPal capture whose outcome nobody knows (no answer, a
 *                  capture PayPal holds) keeps the order from being paid a
 *                  second time, from being cancelled, and from being told
 *                  "nothing was charged" — until PayPal is asked and answers
 *                  clearly; then it resolves itself to paid or to unpaid
 *   the small ones an order restored over a stray live payment can be marked
 *                  paid; "max per order" counts the product, not each
 *                  option; a PayPal order needs an email like a card order
 *
 * No request in this file leaves the machine. The server has no PayPal key
 * in its environment, and the part that runs through the real server makes
 * no create / capture / inquiry / connection check while keys exist. The
 * "in doubt" part runs in THIS process against a fake transport
 * (TAPUZ_PAYPAL_FAKE=1, set only there): every answer "PayPal" gives is
 * written in this file. Where it runs the order page's own script
 * (public/tz-store.js, in a small DOM) PayPal's button is a stub and its
 * SDK is never fetched — the page's <script> tag is only told it loaded.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-wiring-'));
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.TAPUZ_ROOT = ROOT;
for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MODE', 'TAPUZ_PAYPAL_LIVE', 'TAPUZ_PAYPAL_FAKE', 'TAPUZ_DEMO_STORE', 'TAPUZ_ADMIN_PATH', 'TAPUZ_PIN_FILE']) {
  delete process.env[k];
}

let failed = 0;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) failed++;
}

process.on('exit', () => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

function req(method, urlPath, { body, raw, type, cookie, headers: extra } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE, ...(extra || {}) };
    if (raw != null) {
      data = raw;
      headers['Content-Type'] = type || 'application/json';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers.Cookie = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* html or csv */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitUp(tries = 80) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/', (res) => { res.resume(); resolve(); }).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries);
  });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The page's policy with PayPal's origins merged in — the way src/server.js
 * merges a source list into a directive (the pixels' list today): appended
 * to the directive of the same name, nothing else touched.
 */
function mergeCsp(header, extra) {
  const add = { 'script-src': extra.script, 'frame-src': extra.frame, 'connect-src': extra.connect, 'img-src': extra.img };
  return String(header || '').split('; ').map((directive) => {
    const parts = directive.split(' ');
    const more = (add[parts[0]] || []).filter((o) => !parts.includes(o));
    return more.length ? directive + ' ' + more.join(' ') : directive;
  }).join('; ');
}
const directive = (header, name) => String(header || '').split('; ').find((d) => d.split(' ')[0] === name) || '';

// fixture values are joined from plain words: obviously not credentials, and never a key-colon-quoted literal
const words = (...w) => w.join('-');
const PP_ID = 'AWwiringSandboxClientId';
const PP_VALUE = words('typed', 'in', 'the', 'admin', 'for', 'the', 'wiring', 'smoke');

(async () => {
  const { db } = require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'חנות החיווט', description: 'בדיקה',
    colors: { primary: '#7c2d12', bg: '#ffffff', lightBg: '#fef3c7', text: '#1c1917' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const auth = require('../src/auth');
  const owner = auth.createAdmin('owner', 'owner-pass-1');
  const editor = auth.addTeamMember('ed', 'editor-pass-12', 'editor');
  const OWNER = auth.COOKIE_NAME + '=' + auth.makeToken(owner.id);
  const EDITOR = auth.COOKIE_NAME + '=' + auth.makeToken(editor.id);
  const store = require('../src/store');
  const { orders, paypal, gateway, catalog } = store;
  const demoPay = require('../src/store/demo-pay');

  const PAYPAL = { id: 'paypal', kind: 'paypal', label: 'PayPal' };
  const CASH = { id: 'cash', kind: 'cash', label: 'מזומן באיסוף' };
  const DEMO = { id: 'pretend', kind: 'demo', label: 'תשלום לדוגמה' };
  store.settings.saveSettings({
    name: 'חנות החיווט',
    shipping: [{ id: 'pickup', label: 'איסוף עצמי', price: '0', address: false }, { id: 'delivery', label: 'משלוח', price: '30', address: true }],
    payments: [PAYPAL]
  });
  catalog.createProduct({ title: 'מנורה', slug: 'lamp', price: '50', stock: 40 });
  catalog.createProduct({ title: 'סלע ענק', slug: 'rock', price: '6000000', stock: null });
  store.flip(true);

  const childEnv = { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT), TAPUZ_STORE_ORDER_MAX: '400', TAPUZ_STORE_VIEW_MAX: '400', TAPUZ_STORE_DEMO_MAX: '400' };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: childEnv, stdio: 'ignore' });

  const buyer = { name: 'דנה כהן', phone: '050-1234567', email: 'dana@example.com' };
  const quote = (items, extra) => req('POST', '/api/store/quote', { body: { items, shipping: 'pickup', ...(extra || {}) } });
  const buy = (payment, extra) => req('POST', '/api/store/checkout', {
    body: { items: [{ sku: 'lamp', qty: 1 }], shipping: 'pickup', payment, customer: buyer, ...(extra || {}) }
  });
  const view = (token) => req('GET', '/api/store/order/' + token);
  const demoPost = (token) => req('POST', '/api/store/demo-pay', { body: { token } });
  const row = (number) => orders.getOrder(number);
  const demoRows = (orderId) => db.prepare("SELECT * FROM store_payments WHERE order_id = ? AND provider = 'demo'").all(orderId);
  const markerPath = path.join(ROOT, 'config', 'seeded.json');
  const setPayments = (list) => store.settings.saveSettings({ payments: list });

  try {
    await waitUp();

    // ── zero offered methods is a state, not a silence ──────────────────
    const q0 = await quote([{ sku: 'lamp', qty: 1 }]);
    check('a PayPal-only shop without keys: the quote says noPayment and blocks with NO_PAYMENT — not PAYMENT_REQUIRED',
      q0.status === 200 && q0.json.quote.noPayment === true && q0.json.quote.payments.length === 0 &&
      q0.json.quote.blocking.includes('NO_PAYMENT') && !q0.json.quote.blocking.includes('PAYMENT_REQUIRED') && q0.json.quote.ok === false);
    const c0 = await buy('paypal');
    check('…and checkout answers 409 NO_PAYMENT with a sentence that says so',
      c0.status === 409 && c0.json.code === 'NO_PAYMENT' && c0.json.message === 'אין כרגע אמצעי תשלום זמין — אי אפשר להשלים הזמנה.' && orders.countByStatus().all === 0);
    const c0bare = await req('POST', '/api/store/checkout', { body: { items: [{ sku: 'lamp', qty: 1 }], customer: { name: '', phone: '' } } });
    check('…before the form is judged: nobody is sent to fix a phone number for an order that cannot exist', c0bare.status === 409 && c0bare.json.code === 'NO_PAYMENT' && !c0bare.json.fields);
    check('the refusal carries no internal product id', !/productId/.test(c0.text) && !/productId/.test(c0bare.text));
    check('the owner is told: readinessNote names the dead end and why PayPal is not offered',
      /אף אמצעי תשלום אינו מוצע/.test(paypal.readinessNote()) && /PayPal מוגדר כאמצעי תשלום אבל אינו מוצע/.test(paypal.readinessNote()));
    const emptyCart = await quote([]);
    check('an empty cart is EMPTY, not NO_PAYMENT', emptyCart.json.quote.blocking.includes('EMPTY') && emptyCart.json.quote.noPayment === false);

    setPayments([PAYPAL, CASH]);
    const q1 = await quote([{ sku: 'lamp', qty: 1 }]);
    check('adding a cash method: the quote offers it and nothing blocks', q1.json.quote.noPayment === false && q1.json.quote.payments.length === 1 && q1.json.quote.payments[0].kind === 'cash' && q1.json.quote.ok === true);
    const cashOrder = await buy('cash');
    check('…and the shop is orderable', cashOrder.status === 200 && cashOrder.json.ok === true && /^[0-9]+$/.test(cashOrder.json.order.number));
    check('the order keeps the KIND of its method beside the id', row(cashOrder.json.order.number).payment_kind === 'cash' && row(cashOrder.json.order.number).payment_method === 'cash');
    const unchosen = await req('POST', '/api/store/checkout', { body: { items: [{ sku: 'lamp', qty: 1 }], shipping: 'pickup', payment: 'paypal', customer: buyer } });
    check('a method that exists but is not offered, beside one that is: still PAYMENT_REQUIRED', unchosen.status === 409 && unchosen.json.code === 'PAYMENT_REQUIRED');

    // ── the demo payment ────────────────────────────────────────────────
    setPayments([PAYPAL, CASH, DEMO]);
    const q2 = await quote([{ sku: 'lamp', qty: 1 }]);
    check('a demo method on a normal site is NOT offered', !q2.json.quote.payments.some((p) => p.kind === 'demo') && demoPay.isDemoSite() === false);
    check('…and the owner can be told why', /"תשלום לדוגמה" מוגדר כאמצעי תשלום אבל אינו מוצע/.test(paypal.readinessNote()));
    const noDemo = await buy('pretend');
    check('…so an order cannot be placed with it', noDemo.status === 409 && noDemo.json.code === 'PAYMENT_REQUIRED');
    const notDemo = await demoPost(cashOrder.json.order.token);
    check('the demo pay door refuses an order that is not a demo order (403 NOT_DEMO)', notDemo.status === 403 && notDemo.json.code === 'NOT_DEMO' && demoRows(row(cashOrder.json.order.number).id).length === 0);

    fs.writeFileSync(markerPath, JSON.stringify({ 'demo-store': new Date().toISOString() }, null, 2), 'utf8');
    const q3 = await quote([{ sku: 'lamp', qty: 1 }]);
    const offeredDemo = q3.json.quote.payments.find((p) => p.kind === 'demo');
    check('on a demo-marked site the demo method IS offered, with the sentence that says no real money moves',
      demoPay.isDemoSite() === true && !!offeredDemo && offeredDemo.id === 'pretend' && /כסף אמיתי לא עובר/.test(offeredDemo.details));
    const demoOrder = await buy('pretend');
    check('an order is placed with it', demoOrder.status === 200 && demoOrder.json.ok === true && row(demoOrder.json.order.number).payment_kind === 'demo');
    const demoToken = demoOrder.json.order.token;
    const v1 = await view(demoToken);
    check('its order page is told the button may be pressed', v1.json.order.payment.kind === 'demo' && v1.json.order.payment.demo.canPay === true && v1.json.order.payment.demo.paid === false &&
      typeof v1.json.order.payment.demo.message === 'string' && v1.json.order.payment.demo.message.length > 0);
    const pay1 = await demoPost(demoToken);
    check('POST /api/store/demo-pay pays it: 200, the order comes back paid-by-demo and no longer payable',
      pay1.status === 200 && pay1.json.ok === true && pay1.json.order.number === demoOrder.json.order.number &&
      pay1.json.order.payment.demo.paid === true && pay1.json.order.payment.demo.canPay === false && pay1.headers['cache-control'] === 'no-store');
    const pay2 = await demoPost(demoToken);
    const paidOrder = row(demoOrder.json.order.number);
    const rows = demoRows(paidOrder.id);
    check('a second press is the same answer and writes nothing more', pay2.status === 200 && pay2.json.ok === true && pay2.json.order.payment.demo.paid === true && rows.length === 1);
    check('the row is a TEST payment for the order\'s own total — and paid_at stays empty',
      rows[0].mode === 'test' && rows[0].status === 'paid' && rows[0].amount === paidOrder.total && rows[0].currency === paidOrder.currency &&
      rows[0].set_paid === 0 && /^demo-[0-9a-f]{20}$/.test(rows[0].reference) && paidOrder.paid_at === null && pay2.json.order.paid === false);
    check('the history says no real money moved, exactly once', orders.listEvents(paidOrder.id).filter((e) => e.text === 'תשלום לדוגמה התקבל — כסף אמיתי לא עבר').length === 1);
    check('a demo payment never reads as money taken through the gateway', gateway.isGatewayPaid(paidOrder.id) === false);
    const described = gateway.describePayments(paidOrder)[0];
    check('the admin sees the row as הדגמה, with neither a refund nor an inquiry', described.providerLabel === 'הדגמה' && described.refundable === false && described.canVerify === false);

    const wrongToken = await demoPost('A'.repeat(24));
    check('a wrong token is 404', wrongToken.status === 404 && wrongToken.json.code === 'NOT_FOUND');
    const form = await req('POST', '/api/store/demo-pay', { raw: 'token=' + demoToken, type: 'application/x-www-form-urlencoded', headers: { Origin: 'https://evil.example' } });
    check('a non-JSON body is 415 — a cross-site form cannot press the button', form.status === 415 && form.json.code === 'JSON_ONLY');
    const toCancel = await buy('pretend');
    const cancelled = await req('POST', '/admin/api/store/orders/' + toCancel.json.order.number + '/status', { cookie: OWNER, body: { status: 'cancelled' } });
    const payCancelled = await demoPost(toCancel.json.order.token);
    check('a cancelled order is refused (409 CANCELLED) and nothing is written',
      cancelled.status === 200 && payCancelled.status === 409 && payCancelled.json.code === 'CANCELLED' && demoRows(row(toCancel.json.order.number).id).length === 0);

    const openDemo = await buy('pretend');
    fs.rmSync(markerPath, { force: true });
    const vGone = await view(openDemo.json.order.token);
    const payGone = await demoPost(openDemo.json.order.token);
    check('once the site is no longer a demo site an open demo order cannot be "paid": no button, 403 NOT_ALLOWED',
      vGone.json.order.payment.kind === 'demo' && vGone.json.order.payment.demo.canPay === false && payGone.status === 403 && payGone.json.code === 'NOT_ALLOWED');
    store.settings.saveSettings({ demoPayments: true });
    const q4 = await quote([{ sku: 'lamp', qty: 1 }]);
    const payAllowed = await demoPost(openDemo.json.order.token);
    check('the owner\'s explicit setting (demoPayments) allows it on any site', store.settings.loadSettings().demoPayments === true &&
      q4.json.quote.payments.some((p) => p.kind === 'demo') && payAllowed.status === 200 && payAllowed.json.order.payment.demo.paid === true);
    store.settings.saveSettings({ demoPayments: false });

    // ── a total past the ceiling never becomes an order ──────────────────
    const before = orders.countByStatus().all;
    const big = await quote([{ sku: 'rock', qty: 2 }]);
    check('₪12,000,000 in one cart: the quote blocks with TOO_LARGE and says it in the issues',
      big.json.quote.blocking.includes('TOO_LARGE') && big.json.quote.issues.some((i) => i.code === 'TOO_LARGE' && i.message === 'סכום ההזמנה גדול מדי להזמנה אחת'));
    const bigOrder = await req('POST', '/api/store/checkout', { body: { items: [{ sku: 'rock', qty: 2 }], shipping: 'pickup', payment: 'cash', customer: buyer } });
    check('…and checkout answers 409 TOO_LARGE, with nothing ordered', bigOrder.status === 409 && bigOrder.json.code === 'TOO_LARGE' && orders.countByStatus().all === before);
    const justUnder = await quote([{ sku: 'rock', qty: 1 }]);
    check('a single ₪6,000,000 item is still an ordinary cart', !justUnder.json.quote.blocking.includes('TOO_LARGE') && justUnder.json.quote.total === 600000000);

    // ── PayPal's keys in the admin, and the policy a button needs ─────────
    const pageBefore = await req('GET', '/order', { headers: { Accept: 'text/html' } });
    const cspBefore = pageBefore.headers['content-security-policy'] || '';
    check('without PayPal the list for the policy is empty, and merging it changes not one character',
      pageBefore.status === 200 && cspBefore.includes("script-src 'self'") && JSON.stringify(paypal.cspSources()) === '{"script":[],"frame":[],"connect":[],"img":[]}' &&
      mergeCsp(cspBefore, paypal.cspSources()) === cspBefore);

    const editorDoors = [
      await req('GET', '/admin/api/store/paypal', { cookie: EDITOR }),
      await req('POST', '/admin/api/store/paypal', { cookie: EDITOR, body: { clientId: PP_ID, clientSecret: PP_VALUE } }),
      await req('POST', '/admin/api/store/paypal/test', { cookie: EDITOR, body: {} }),
      await req('GET', '/admin/store/gateway', { cookie: EDITOR })
    ];
    check('an editor gets 403 on every PayPal route and on the screen — and nothing was saved',
      editorDoors.every((r) => r.status === 403) && !fs.existsSync(path.join(ROOT, 'config', 'payments.json')));
    const anon = await req('POST', '/admin/api/store/paypal', { body: { clientId: PP_ID, clientSecret: PP_VALUE } });
    check('no session: the save door does not open', [302, 401, 403].includes(anon.status) && !fs.existsSync(path.join(ROOT, 'config', 'payments.json')));
    const noKeysTest = await req('POST', '/admin/api/store/paypal/test', { cookie: OWNER, body: {} });
    check('the connection check without keys says so (and asks nobody)', noKeysTest.status === 200 && noKeysTest.json.ok === false && /חסרים מפתחות PayPal/.test(noKeysTest.json.message));

    const saved = await req('POST', '/admin/api/store/paypal', { cookie: OWNER, body: { clientId: PP_ID, clientSecret: PP_VALUE, mode: 'test' } });
    const onDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'payments.json'), 'utf8'));
    check('the owner saves the keys: they land in config/payments.json and PayPal is ready, in the sandbox',
      saved.status === 200 && saved.json.ok === true && saved.json.errors.length === 0 && saved.json.settings.ready === true && saved.json.settings.sandbox === true &&
      onDisk.paypal.clientSecret === PP_VALUE && paypal.status().ready === true);
    check('the save reply shows a tail and never the value', saved.json.settings.fields.clientSecret.tail === PP_VALUE.slice(-4) && !saved.text.includes(PP_VALUE));
    const api = await req('GET', '/admin/api/store/paypal', { cookie: OWNER });
    const screen = await req('GET', '/admin/store/gateway', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('the gateway screen answers 200 with the PayPal section, the tail, and the sentence about the live arm',
      screen.status === 200 && /id="paypal"/.test(screen.text) && screen.text.includes('••••' + PP_VALUE.slice(-4)) && /TAPUZ_PAYPAL_LIVE=1/.test(screen.text) && /בדיקת חיבור/.test(screen.text));
    check('neither the screen nor the API ever contains the secret', !screen.text.includes(PP_VALUE) && !api.text.includes(PP_VALUE) && api.json.settings.fields.clientSecret.set === true);
    check('the screen links only the admin stylesheet, and the PayPal section brings no style block of its own',
      (screen.text.match(/<link[^>]+rel="stylesheet"[^>]*>/g) || []).every((l) => /href="\/css\/admin\.css/.test(l)) && !/<style/.test(screen.text.split('id="paypal"')[1] || ''));
    // seen in a browser: `hidden` on a .btn did nothing (the class's own display won), so a ✕ stood beside a field with nothing to delete
    const adminCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');
    check('a ✕ is offered for a stored key only, and the stylesheet really hides the others',
      (screen.text.match(/data-pp-clear title="[^"]*">✕/g) || []).length === 2 && !/data-pp-clear title="[^"]*" hidden/.test(screen.text) &&
      adminCss.includes('.st-page .st-gw-input > [hidden] { display: none; }'));
    const live = await req('POST', '/admin/api/store/paypal', { cookie: OWNER, body: { mode: 'live', confirmLive: true } });
    check('"חי" is refused from the screen on a server that is not armed — said in the reply, and the mode stays sandbox',
      live.status === 200 && live.json.errors.some((e) => /TAPUZ_PAYPAL_LIVE=1/.test(e)) && live.json.settings.mode === 'test' && paypal.status().sandbox === true);

    const q5 = await quote([{ sku: 'lamp', qty: 1 }]);
    const offeredPaypal = q5.json.quote.payments.find((p) => p.kind === 'paypal');
    check('with keys PayPal is at the checkout, marked sandbox', !!offeredPaypal && offeredPaypal.sandbox === true);
    const ppOrder = await buy('paypal');
    const ppToken = ppOrder.json.order.token;
    const ppView = await view(ppToken);
    check('a PayPal order: its page gets the sandbox button\'s address and never a secret',
      ppOrder.status === 200 && row(ppOrder.json.order.number).payment_kind === 'paypal' && ppView.json.order.payment.kind === 'paypal' &&
      ppView.json.order.payment.paypal.canPay === true && ppView.json.order.payment.paypal.sdk.startsWith('https://www.sandbox.paypal.com/sdk/js?client-id=' + PP_ID) && !ppView.text.includes(PP_VALUE));

    const pageAfter = await req('GET', '/order', { headers: { Accept: 'text/html' } });
    const cspAfter = pageAfter.headers['content-security-policy'] || '';
    const merged = mergeCsp(cspBefore, paypal.cspSources());
    const HOSTS = ['https://www.sandbox.paypal.com', 'https://www.paypalobjects.com'];
    check('the policy with PayPal merged in allows the SDK script, the button frame and the SDK\'s calls — sandbox host and static host only',
      HOSTS.every((h) => directive(merged, 'script-src').split(' ').includes(h) && directive(merged, 'frame-src').split(' ').includes(h) && directive(merged, 'connect-src').split(' ').includes(h)) &&
      !merged.includes('https://www.paypal.com') && !merged.includes('*.paypal') && directive(merged, 'img-src') === directive(cspBefore, 'img-src') &&
      directive(merged, 'style-src') === directive(cspBefore, 'style-src') && directive(merged, 'default-src') === "default-src 'self'");
    check('the SDK address the order page is given is inside what the merged policy allows',
      directive(merged, 'script-src').split(' ').includes(new URL(ppView.json.order.payment.paypal.sdk).origin));
    // src/server.js is another builder's file: once it merges paypal.cspSources() the page's own header must BE the merged one
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    if (/paypal[^\n]*cspSources|cspSources[^\n]*paypal/.test(serverSrc)) {
      check('the server itself sends the merged policy on the order page', HOSTS.every((h) => directive(cspAfter, 'script-src').split(' ').includes(h) && directive(cspAfter, 'frame-src').split(' ').includes(h) && directive(cspAfter, 'connect-src').split(' ').includes(h)));
    } else {
      console.log('NOTE src/server.js does not merge paypal.cspSources() into the policy yet — the page still blocks PayPal\'s script until it does');
    }

    setPayments([{ id: 'pp-renamed', kind: 'paypal', label: 'PayPal (שם חדש)' }, CASH, DEMO]);
    const ppRenamed = await view(ppToken);
    check('the method is renamed under the open order: the order page still has its PayPal block and button',
      ppRenamed.json.order.payment.kind === 'paypal' && !!ppRenamed.json.order.payment.paypal && ppRenamed.json.order.payment.paypal.canPay === true &&
      ppRenamed.json.order.payment.label === 'PayPal');
    const orderScreen = await req('GET', '/admin/store/orders/' + ppOrder.json.order.number, { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('the admin order screen titles the card "תשלומים" and still knows the order is PayPal', orderScreen.status === 200 && /💳 תשלומים/.test(orderScreen.text) && !/תשלום בכרטיס אשראי<\/h3>/.test(orderScreen.text) && /PayPal · משלמים בדף ההזמנה/.test(orderScreen.text));
    const demoScreen = await req('GET', '/admin/store/orders/' + demoOrder.json.order.number, { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('…and a demo order\'s card names the provider per row: הדגמה, a test, no money', />הדגמה /.test(demoScreen.text) && /בדיקות/.test(demoScreen.text) && /לא התקבל כסף/.test(demoScreen.text) && !/data-refund=/.test(demoScreen.text) && !/data-verify=/.test(demoScreen.text));
    // the inquiry door answers a failure as { ok:false, message }; the screen used to read only `error` and showed a bare "שגיאה"
    const strayVerify = await req('POST', '/admin/api/store/orders/' + demoOrder.json.order.number + '/payments/999999/verify', { cookie: OWNER, body: {} });
    check('an inquiry that fails answers with a sentence, and the order screen is wired to show that sentence',
      strayVerify.status === 404 && strayVerify.json.ok === false && strayVerify.json.message === 'התשלום לא נמצא בהזמנה הזו' &&
      orderScreen.text.includes("d.error || d.message || 'שגיאה'"));
    check('the order list scrolls inside its card on a narrow screen', /<div class="st-orders-scroll"><table class="tbl">/.test((await req('GET', '/admin/store/orders', { cookie: OWNER, headers: { Accept: 'text/html' } })).text));

    const clearedKeys = await req('POST', '/admin/api/store/paypal', { cookie: OWNER, body: { clientId: '', clientSecret: '' } });
    const ppNoKeys = await view(ppToken);
    check('keys cleared: the open PayPal order says PayPal is unavailable — no button, no "you can pay"',
      clearedKeys.json.settings.ready === false && ppNoKeys.json.order.payment.paypal.canPay === false && ppNoKeys.json.order.payment.paypal.sdk === '' &&
      ppNoKeys.json.order.payment.paypal.message === 'תשלום ב-PayPal אינו זמין כרגע — צרו איתנו קשר' && mergeCsp(cspBefore, paypal.cspSources()) === cspBefore);
    setPayments([PAYPAL, CASH, DEMO]);

    // ── mail that says what happened ─────────────────────────────────────
    await pause(60);
    const cashEvents = orders.listEvents(row(cashOrder.json.order.number).id).map((e) => e.text);
    check('with no SMTP the order\'s history says the confirmation did not go out — and never writes the shopper\'s address',
      cashEvents.includes('אישור ההזמנה לא נשלח ללקוח/ה: SMTP לא מוגדר') && !cashEvents.some((t) => t.includes('dana@example.com')));

    // ── orders that hold stock forever ───────────────────────────────────
    const old = await buy('cash', { items: [{ sku: 'lamp', qty: 2 }] });
    const oldRow = row(old.json.order.number);
    const stockHeld = catalog.getProduct('lamp').stock;
    db.prepare("UPDATE store_orders SET created_at = datetime('now', '-3 days') WHERE id IN (?, ?)").run(oldRow.id, paidOrder.id);
    const fresh = await buy('cash');
    check('housekeeping() with holdHours 0 does nothing', store.settings.loadSettings().holdHours === 0 && orders.housekeeping().expired === 0 && row(old.json.order.number).status === 'new');
    const expired = orders.expireUnpaid({ olderThanMs: 24 * 60 * 60 * 1000 });
    check('expireUnpaid cancels the old unpaid order and gives its stock back',
      expired.expired === 1 && expired.numbers[0] === old.json.order.number && row(old.json.order.number).status === 'cancelled' && catalog.getProduct('lamp').stock === stockHeld + 2 - 1);
    check('…with a line in its history that says why, and no mail', orders.listEvents(oldRow.id).some((e) => /בוטלה אוטומטית: לא שולמה/.test(e.text)) && !orders.listEvents(oldRow.id).some((e) => e.kind === 'mail' && /ביטול/.test(e.text)));
    check('…and leaves alone a demo-paid order of the same age, and a fresh unpaid one', row(demoOrder.json.order.number).status === 'new' && row(fresh.json.order.number).status === 'new');
    check('expireUnpaid without an age does nothing', orders.expireUnpaid({}).expired === 0 && orders.expireUnpaid({ olderThanMs: 0 }).expired === 0);
    store.settings.saveSettings({ holdHours: 48 });
    const old2 = await buy('cash');
    db.prepare("UPDATE store_orders SET created_at = datetime('now', '-3 days') WHERE id = ?").run(row(old2.json.order.number).id);
    check('housekeeping() with holdHours 48 expires an order three days old', store.settings.loadSettings().holdHours === 48 && orders.housekeeping().expired === 1 && row(old2.json.order.number).status === 'cancelled');
    store.settings.saveSettings({ holdHours: 0 });

    // ── the owner's list, its pager, the CSV ─────────────────────────────
    orders.markPaid(fresh.json.order.number, true);
    const st = orders.stats();
    check('stats() keeps every key it had and adds what was actually PAID — a demo payment is not in it',
      ['today', 'month', 'counts'].every((k) => st[k] !== undefined) && st.paidToday.n === 1 && st.paidToday.total === row(fresh.json.order.number).total &&
      st.paidMonth.n === 1 && st.today.n > st.paidToday.n);
    const insert = db.prepare(`
      INSERT INTO store_orders (number, token, status, payment_method, payment_label, payment_kind, currency, subtotal, total, customer_name, customer_phone, address, tracking)
      VALUES (?, ?, 'completed', 'cash', 'מזומן', 'cash', 'ILS', 5000, 5000, ?, '0500000000', '{}', ?)
    `);
    db.transaction(() => {
      for (let i = 0; i < 1100; i++) insert.run(String(500000 + i), crypto.randomBytes(18).toString('base64url'), 'לקוח ' + i, i === 0 ? 'TRK-0001' : '');
    })();
    const total = orders.countByStatus().all;
    const csv = await req('GET', '/admin/store/orders.csv', { cookie: OWNER, headers: { Accept: 'text/csv' } });
    const lines = csv.text.split('\r\n').filter((l) => l !== '');
    check('the CSV carries EVERY order — more than a thousand — and each exactly once',
      csv.status === 200 && /text\/csv/.test(csv.headers['content-type']) && total > 1100 && lines.length === total + 1 &&
      new Set(lines.slice(1).map((l) => l.split(',')[0])).size === total);
    check('…with the new columns at the end of the header', lines[0].endsWith('הערת לקוח,מספר מעקב,סוג תשלום,ספק תשלום,מזהה עסקה,שולם בתאריך') && lines[0].charCodeAt(0) === 0xFEFF);
    const lineOf = (number) => lines.find((l) => l.split(',')[0] === String(number)) || '';
    check('…a tracking number and the payment kind on their order', lineOf('500000').endsWith(',TRK-0001,cash,,,'));
    check('…a demo payment named as a test with no paid date', lineOf(demoOrder.json.order.number).endsWith(',,demo,demo (בדיקה),,'));
    check('…and the paid date on an order that was paid', /,cash,,,\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(lineOf(fresh.json.order.number)));
    const csvFiltered = await req('GET', '/admin/store/orders.csv?status=cancelled', { cookie: OWNER, headers: { Accept: 'text/csv' } });
    check('the CSV follows the list\'s filter', csvFiltered.text.split('\r\n').filter((l) => l !== '').length === orders.countByStatus().cancelled + 1);
    check('an editor cannot download it', (await req('GET', '/admin/store/orders.csv', { cookie: EDITOR })).status === 403);

    const rowLinks = (html) => (html.match(/<td><a href="\/admin\/store\/orders\/[^"]+"><b>#/g) || []).length;
    const pages = Math.ceil(total / 50);
    const list1 = await req('GET', '/admin/store/orders', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('the order list shows 50 a page and a pager that says how many there are',
      list1.status === 200 && rowLinks(list1.text) === 50 && list1.text.includes('עמוד 1 מתוך ' + pages + ' · ' + total + ' הזמנות') && /class="st-pager"/.test(list1.text) &&
      /href="\/admin\/store\/orders\?page=2" rel="next"/.test(list1.text) && /aria-disabled="true">הקודם</.test(list1.text));
    const list2 = await req('GET', '/admin/store/orders?page=2', { cookie: OWNER, headers: { Accept: 'text/html' } });
    const firstOf = (html) => (html.match(/<td><a href="\/admin\/store\/orders\/([^"]+)"><b>#/) || [])[1];
    check('page 2 is the next fifty', rowLinks(list2.text) === 50 && firstOf(list2.text) !== firstOf(list1.text) && list2.text.includes('עמוד 2 מתוך ' + pages));
    const listLast = await req('GET', '/admin/store/orders?page=99999', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('a page past the end is the last page, with no "next"', listLast.text.includes('עמוד ' + pages + ' מתוך ' + pages) && rowLinks(listLast.text) === total - (pages - 1) * 50 && /aria-disabled="true">הבא</.test(listLast.text));
    const listFiltered = await req('GET', '/admin/store/orders?status=completed&page=2', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('turning the page keeps the filter', /href="\/admin\/store\/orders\?status=completed&amp;page=3" rel="next"/.test(listFiltered.text) && /href="\/admin\/store\/orders\?status=completed" rel="prev"/.test(listFiltered.text));
    const few = await req('GET', '/admin/store/orders?status=cancelled', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('a short list shows its count and no page turns', few.text.includes(orders.countByStatus().cancelled + ' הזמנות') && !/class="st-pager-nav"/.test(few.text));

    // ── an order restored over a stray live payment can be marked paid ───
    // (the state a capture leaves when it lands on a cancelled order: a live row `paid`, paid_at empty)
    const stray = await buy('cash');
    const strayRow = row(stray.json.order.number);
    db.prepare(`INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status, transaction_id)
      VALUES (?, 'paypal', 'live', ?, 'WIRESTRAYLIVE01', ?, 'ILS', 'paid', 'CAPWIRESTRAYLIVE01')`).run(strayRow.id, 'ref-stray-' + strayRow.id, strayRow.total);
    const strayDoor = (path, body) => req('POST', '/admin/api/store/orders/' + strayRow.number + '/' + path, { cookie: OWNER, body });
    const strayScreen = () => req('GET', '/admin/store/orders/' + strayRow.number, { cookie: OWNER, headers: { Accept: 'text/html' } });
    await strayDoor('status', { status: 'cancelled' });
    await strayDoor('status', { status: 'new' });
    const restored = await strayScreen();
    check('an order restored over a stray live payment: "התשלום התקבל" is not disabled, and the screen does not say it was paid through PayPal',
      row(strayRow.number).status === 'new' && row(strayRow.number).paid_at === null && gateway.isGatewayPaid(strayRow.id) === true &&
      restored.status === 200 && /<input type="checkbox" id="od-paid"> התשלום התקבל/.test(restored.text) && !/הסימון לא ניתן לביטול/.test(restored.text));
    const strayMark = await strayDoor('paid', { paid: true });
    const marked = await strayScreen();
    check('…the server accepts the mark, and from then on the mark is locked over the real money',
      strayMark.status === 200 && strayMark.json.ok === true && strayMark.json.order.paid === true && !!row(strayRow.number).paid_at &&
      /<input type="checkbox" id="od-paid" checked disabled> התשלום התקבל/.test(marked.text) && /שולם ב-PayPal — הסימון לא ניתן לביטול כאן/.test(marked.text));
    const strayUnmark = await strayDoor('paid', { paid: false });
    check('…and cannot be waved away with the checkbox', strayUnmark.status >= 400 && strayUnmark.json.ok === false && !!row(strayRow.number).paid_at);

    // ── junk must not spend a shopper's budget ───────────────────────────
    let junk415 = 0;
    for (let i = 0; i < 130; i++) {
      const j = await req('POST', '/api/store/quote', { raw: 'items=x', type: 'application/x-www-form-urlencoded' });
      if (j.status === 415) junk415++;
    }
    const afterJunk = await quote([{ sku: 'lamp', qty: 1 }]);
    check('130 non-JSON requests are each refused 415 and spend none of the quote door\'s budget (a real quote still answers)', junk415 === 130 && afterJunk.status === 200);
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    child.kill();
  }

  // ── mail: what it says, and where its links point (no server needed) ───
  try {
    const mail = require('../src/notify');
    const storeNotify = require('../src/store/notify');
    const config = require('../src/config');
    const sent = [];
    mail.sendMail = async (m) => { sent.push(m); return { ok: true }; };
    store.settings.saveSettings({ notifyEmail: 'owner@shop.example', payments: [{ id: 'cash', kind: 'cash', label: 'מזומן' }] });
    const place = (shipping, address) => orders.placeOrder({
      items: [{ sku: 'lamp', qty: 1 }], shipping, payment: 'cash',
      customer: { name: 'דנה כהן', phone: '050-1234567', email: 'dana@example.com' }, address
    });

    const pickup = place('pickup');
    await pause(30);
    const ownerMail = sent.find((m) => m.to === 'owner@shop.example');
    const shopperMail = sent.find((m) => m.to === 'dana@example.com');
    check('with no site address the mails still go — without a link, never with a broken one',
      pickup.ok && !!ownerMail && !!shopperMail && !/לניהול ההזמנה/.test(ownerMail.text) && !/\/admin\//.test(ownerMail.text) && !/מעקב אחרי ההזמנה/.test(shopperMail.text));
    const pickupRow = orders.getOrder(pickup.order.number);
    const pickupEvents = () => orders.listEvents(pickupRow.id).filter((e) => e.kind === 'mail').map((e) => e.text);
    check('each send leaves a line: the owner by address, the shopper without one',
      pickupEvents().includes('התראה על ההזמנה נשלחה אל owner@shop.example') && pickupEvents().includes('אישור ההזמנה נשלח ללקוח/ה במייל') && !pickupEvents().some((t) => t.includes('dana@')));

    sent.length = 0;
    orders.setStatus(pickup.order.number, 'shipped');
    await pause(30);
    check('a pickup order marked "נשלחה" tells the shopper it is ready to collect — not that it is on its way',
      sent.length === 1 && /מוכנה לאיסוף/.test(sent[0].subject) && /מוכנה לאיסוף \(איסוף עצמי\)/.test(sent[0].text) && !/יצאה לדרך/.test(sent[0].subject + sent[0].text) &&
      pickupEvents().includes('ההודעה "מוכנה לאיסוף" נשלחה ללקוח/ה במייל'));

    config.saveConfig({ ...config.loadConfig(), baseUrl: 'https://shop.example' });
    sent.length = 0;
    const delivery = place('delivery', { city: 'חיפה', street: 'הנביאים 3' });
    await pause(30);
    const ownerMail2 = sent.find((m) => m.to === 'owner@shop.example');
    const shopperMail2 = sent.find((m) => m.to === 'dana@example.com');
    check('with a site address the owner\'s link is the admin order screen and the shopper\'s is the order page',
      ownerMail2.text.includes('לניהול ההזמנה: https://shop.example/admin/store/orders/' + delivery.order.number) &&
      shopperMail2.text.includes('https://shop.example/order?o=' + delivery.order.token));
    sent.length = 0;
    orders.setTracking(delivery.order.number, 'RR123456789IL');
    orders.setStatus(delivery.order.number, 'shipped');
    await pause(30);
    check('a delivered order marked "נשלחה" still says it is on its way, with the tracking number', sent.length === 1 && /יצאה לדרך/.test(sent[0].subject) && /RR123456789IL/.test(sent[0].text));

    process.env.TAPUZ_ADMIN_PATH = '/office';
    check('the admin link follows a custom admin path', storeNotify.adminLink(orders.getOrder(delivery.order.number)) === 'https://shop.example/office/store/orders/' + delivery.order.number);
    delete process.env.TAPUZ_ADMIN_PATH;

    sent.length = 0;
    const payRow = { amount: 5000, currency: 'ILS', approval: '', card_last4: '', installments: 1, error: 'אי-התאמה: PayPal דיווח על ₪1 — ההזמנה היא ₪50' };
    await storeNotify.paymentReceived(orders.getOrder(delivery.order.number), payRow, [], { via: 'ב-PayPal', panel: 'בחשבון ה-PayPal', stray: 'double' });
    await storeNotify.paymentReceived(orders.getOrder(delivery.order.number), payRow, []);
    await storeNotify.paymentMismatch(orders.getOrder(delivery.order.number), payRow, { panel: 'בחשבון ה-PayPal' });
    const ownerTexts = sent.filter((m) => m.to === 'owner@shop.example').map((m) => m.text);
    check('a payment mail says how the money came: "ב-PayPal" when told so, "בכרטיס אשראי" by default',
      /₪50 ב-PayPal/.test(ownerTexts[0]) && /בחשבון ה-PayPal/.test(ownerTexts[0]) && !/בכרטיס אשראי/.test(ownerTexts[0]) &&
      /₪50 בכרטיס אשראי/.test(ownerTexts[1]) && /בדקו בחשבון ה-PayPal מה נגבה בפועל/.test(ownerTexts[2]));
  } catch (e) {
    console.error(e);
    failed++;
  }

  // ── PayPal: a capture whose outcome nobody knows (no server needed) ─────
  // Live mode through the code's own test arm, against a FAKE transport that
  // lives in this process: every "PayPal" answer below is written here.
  let fakeHttp = null;
  try {
    process.env.TAPUZ_PAYPAL_FAKE = '1';
    process.env.PAYPAL_CLIENT_ID = PP_ID;
    process.env.PAYPAL_CLIENT_SECRET = PP_VALUE;
    process.env.PAYPAL_MODE = 'live';
    process.env.TAPUZ_PAYPAL_LIVE = '1';
    store.settings.saveSettings({ payments: [PAYPAL, CASH, DEMO], holdHours: 0 });
    catalog.createProduct({ title: 'פנס', slug: 'torch', price: '50', stock: 100 });

    // what "PayPal" does with a capture: 'ok' | 'timeout' (no answer) | 'held' (order COMPLETED, capture PENDING) | 'refused' (a clear 422)
    // and what it says when ASKED about an order: 'paid' | 'approved' (open, nothing captured) | 'held' | 'gone' | 'down'
    const pp = { capture: 'ok', ask: 'approved', seq: 0, asks: 0, captures: 0, markAtCall: null };
    const answer = (id, cap) => ({ id, status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP' + id, status: cap, amount: { currency_code: 'ILS', value: '50.00' } }] } }] });
    paypal.setTestTransport(async (call) => {
      if (call.url.endsWith('/v1/oauth2/token')) return { status: 200, json: { access_token: 'tok-wiring', expires_in: 3000 } };
      if (call.method === 'GET') {
        pp.asks++;
        const id = call.url.split('/').pop();
        if (pp.ask === 'down') return { status: 0, error: 'network down', transient: true };
        if (pp.ask === 'gone') return { status: 404, json: { name: 'RESOURCE_NOT_FOUND' }, transient: false };
        if (pp.ask === 'approved') return { status: 200, json: { id, status: 'APPROVED' } };
        return { status: 200, json: answer(id, pp.ask === 'held' ? 'PENDING' : 'COMPLETED') };
      }
      if (call.url.endsWith('/v2/checkout/orders')) { pp.seq++; return { status: 201, json: { id: 'WIREORDER' + (10000000 + pp.seq), status: 'CREATED' } }; }
      if (/\/capture$/.test(call.url)) {
        pp.captures++;
        const id = call.url.split('/').slice(-2)[0];
        // what the row says at the moment the call is in the air
        try {
          const at = db.prepare("SELECT status, capture_tried_at FROM store_payments WHERE provider = 'paypal' AND session_id = ?").get(id);
          pp.markAtCall = at ? at.status + ':' + (at.capture_tried_at ? 'tried' : 'untried') : 'no row';
        } catch (e) { pp.markAtCall = 'no mark'; }
        await pause(5);
        if (pp.capture === 'timeout') return { status: 0, error: 'The operation was aborted due to timeout', transient: true };
        if (pp.capture === 'held') return { status: 201, json: answer(id, 'PENDING') };
        if (pp.capture === 'refused') return { status: 422, json: { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.' }, transient: false };
        return { status: 201, json: answer(id, 'COMPLETED') };
      }
      return { status: 500, json: {}, transient: true };
    });
    check('PayPal is in live mode through the test arm, behind the fake transport', paypal.status().live === true && paypal.status().ready === true);

    const UNKNOWN = 'תוצאת החיוב ב-PayPal לא ידועה — נבדקת';
    const placePP = () => orders.getOrder(orders.placeOrder({ items: [{ sku: 'torch', qty: 1 }], shipping: 'pickup', payment: 'paypal', customer: buyer }).order.number);
    const ppRows = (o) => db.prepare("SELECT * FROM store_payments WHERE order_id = ? AND provider = 'paypal' ORDER BY id").all(o.id);
    const texts = (o) => orders.listEvents(o.id).map((e) => e.text);
    const pageOf = (o) => orders.publicOrder(orders.getOrder(o.number)).payment.paypal;
    const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
    // the attempt happened `m` minutes ago, and the last inquiry is old enough for another
    const ageAttempt = (o, m) => {
      try {
        db.prepare("UPDATE store_payments SET capture_tried_at = ?, last_verify_at = CASE WHEN last_verify_at IS NULL THEN NULL ELSE ? END WHERE order_id = ? AND capture_tried_at != ''").run(minutesAgo(m), minutesAgo(m), o.id);
      } catch (e) { /* a tree without the mark has no attempt to age */ }
    };
    const inDoubt = (r) => (typeof paypal.inDoubt === 'function' ? paypal.inDoubt(r) : null);
    const answersOf = async (round) => (await round.inquiry) || {};
    const ageOrder = (o, days) => {
      db.prepare("UPDATE store_orders SET created_at = datetime('now', ?) WHERE id = ?").run('-' + days + ' days', o.id);
      db.prepare("UPDATE store_payments SET created_at = datetime('now', ?) WHERE order_id = ?").run('-' + days + ' days', o.id);
    };
    const lost = async (how) => {
      const o = placePP();
      const created = await paypal.createForOrder(o.token);
      pp.capture = how;
      const reply = await paypal.captureForOrder(o.token, created.orderId);
      pp.capture = 'ok';
      return { o, created, reply };
    };

    // A. the capture got no answer — and PayPal did take the money
    const a = await lost('timeout');
    const aRow = () => ppRows(a.o)[0];
    check('a capture that gets no answer: the row was marked as tried BEFORE the call left, and it stays pending',
      a.reply.code === 'TRANSIENT' && pp.markAtCall === 'pending:tried' && aRow().status === 'pending' && !!aRow().capture_tried_at && aRow().approval === '');
    check('…the reply says it is not known whether money was taken — and does not invite another payment',
      /לא ידוע אם החיוב עבר/.test(a.reply.message) && !/נסו שוב/.test(a.reply.message) && !/לא חויב כלום/.test(a.reply.message));
    check('…and the order\'s history says why it is held, once', texts(a.o).filter((t) => t === UNKNOWN).length === 1);
    const aPage = pageOf(a.o);
    check('while a row is in doubt the order page offers NO button and never says "nothing was charged"',
      aPage.canPay === false && aPage.sdk === '' && aPage.checking === true && aPage.status === 'pending' && /נבדק מול PayPal/.test(aPage.message) &&
      !/אפשר לשלם/.test(aPage.message) && !/לא חויב כלום/.test(aPage.message));
    const aAdmin = gateway.describePayments(orders.getOrder(a.o.number))[0];
    check('…and the owner\'s screen names the row "תוצאת החיוב לא ידועה" (not an expired session), with the PayPal check beside it',
      aAdmin.statusLabel === 'תוצאת החיוב לא ידועה' && aAdmin.inDoubt === true && aAdmin.canVerify === true && aAdmin.verifyWith === 'PayPal');

    // the next morning the buyer is back and presses a button an old tab still shows
    ageOrder(a.o, 0.6);
    pp.ask = 'down';
    let asksBefore = pp.asks;
    let seqBefore = pp.seq;
    const aCreate1 = await paypal.createForOrder(a.o.token);
    check('the pay button meeting a row in doubt asks PayPal FIRST — and while there is no clear answer opens no second PayPal order (409 CHECKING)',
      aCreate1.ok === false && aCreate1.http === 409 && aCreate1.code === 'CHECKING' && /נבדק מול PayPal/.test(aCreate1.message) && pp.asks === asksBefore + 1 && pp.seq === seqBefore);
    const aCreate2 = await paypal.createForOrder(a.o.token);
    check('…pressed again at once: still refused, and PayPal is not asked twice in a row', aCreate2.code === 'CHECKING' && pp.asks === asksBefore + 1 && pp.seq === seqBefore);
    const expressApp = require('express')();
    expressApp.use(require('../src/routes/store-paypal'));
    fakeHttp = await new Promise((resolve) => { const s = expressApp.listen(0, '127.0.0.1', () => resolve(s)); });
    const viaHttp = await fetch('http://127.0.0.1:' + fakeHttp.address().port + '/api/store/paypal/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: a.o.token }) });
    const viaHttpJson = await viaHttp.json();
    check('…and the public door carries that refusal as it is: 409, CHECKING, the sentence, no PayPal order id',
      viaHttp.status === 409 && viaHttpJson.ok === false && viaHttpJson.code === 'CHECKING' && viaHttpJson.orderId === '' && /נסו שוב בעוד כמה דקות/.test(viaHttpJson.message));
    check('the cancel door does not say "nothing was charged" over a row in doubt', !/לא חויב/.test(paypal.cancelForOrder(a.o.token).message) && !texts(a.o).some((t) => /ביטל את תשלום/.test(t)));

    // the order page loads: no "start the clock" for a row in doubt — PayPal is asked now, and it says the money was taken
    ageAttempt(a.o, 30);
    pp.ask = 'paid';
    asksBefore = pp.asks;
    const aLoad = await gateway.verifyForOrder(orders.getOrder(a.o.number));
    const aPaid = orders.getOrder(a.o.number);
    check('the order page\'s own load asks PayPal about a row in doubt at once, and the payment nobody heard about is found: paid, once',
      !!aLoad && aLoad.asked === true && !aLoad.deferred && aLoad.changed === true && aLoad.status === 'paid' && pp.asks === asksBefore + 1 &&
      !!aPaid.paid_at && aRow().status === 'paid' && aRow().set_paid === 1 && texts(a.o).filter((t) => t === 'שולם ב-PayPal').length === 1);
    seqBefore = pp.seq;
    const aAgain = await paypal.createForOrder(a.o.token);
    check('…and the button is then told "already paid": no second PayPal order was ever opened for this order',
      aAgain.ok === true && aAgain.already === true && aAgain.orderId === a.created.orderId && pp.seq === seqBefore && ppRows(a.o).length === 1);

    // B. the capture never reached PayPal: the order still stands open there
    const b = await lost('timeout');
    pp.ask = 'approved';
    seqBefore = pp.seq;
    const bEarly = await paypal.createForOrder(b.o.token);
    check('PayPal showing the order still open a moment after the attempt is not yet an answer — the call may still be landing (409 CHECKING)',
      bEarly.code === 'CHECKING' && pp.seq === seqBefore && ppRows(b.o)[0].status === 'pending');
    ageAttempt(b.o, 10);
    const bLater = await paypal.createForOrder(b.o.token);
    const bRows = ppRows(b.o);
    check('…minutes later the same answer is PayPal\'s clear word that nothing was captured: the row is closed and a NEW PayPal order may open',
      bLater.ok === true && !bLater.reused && bLater.orderId !== b.created.orderId && pp.seq === seqBefore + 1 &&
      bRows[0].status === 'failed' && bRows[0].error === 'PayPal מדווח שהחיוב לא בוצע' && bRows[1].status === 'pending' && !bRows[1].capture_tried_at &&
      texts(b.o).includes('PayPal מדווח שהחיוב לא בוצע — לא חויב כלום'));
    check('…and the order page offers the button again', pageOf(b.o).canPay === true && !pageOf(b.o).checking);
    const bPay = await paypal.captureForOrder(b.o.token, bLater.orderId);
    check('…and that order is paid once, on the new row', bPay.ok === true && bPay.status === 'paid' && !!orders.getOrder(b.o.number).paid_at && texts(b.o).filter((t) => t === 'שולם ב-PayPal').length === 1);

    // C. PayPal answered "order COMPLETED, capture PENDING" — held for days, with holdHours on
    store.settings.saveSettings({ holdHours: 2 });
    const c = await lost('held');
    check('a capture PayPal holds (COMPLETED / PENDING) leaves the row in doubt, with the history line and without touching `approval`',
      c.reply.http === 409 && c.reply.code === 'PENDING' && /אין צורך לשלם שוב/.test(c.reply.message) && inDoubt(ppRows(c.o)[0]) === true &&
      ppRows(c.o)[0].approval === '' && texts(c.o).filter((t) => t === UNKNOWN).length === 1 && pageOf(c.o).canPay === false);
    ageOrder(c.o, 30);
    ageAttempt(c.o, 30 * 24 * 60);
    const stockHeldC = catalog.getProduct('torch').stock;
    check('expireUnpaid never cancels an order with a row in doubt, however old',
      orders.expireUnpaid({ olderThanMs: 60 * 60 * 1000 }).numbers.includes(c.o.number) === false && orders.getOrder(c.o.number).status === 'new' && catalog.getProduct('torch').stock === stockHeldC);
    pp.ask = 'held';
    asksBefore = pp.asks;
    const hk1 = orders.housekeeping();
    const hk1Inquiry = await answersOf(hk1);
    check('housekeeping never cancels-and-restocks an order whose PayPal money is in flight, however old — and it ASKS PayPal about it',
      hk1.expired === 0 && hk1Inquiry.asked === 1 && pp.asks === asksBefore + 1 && orders.getOrder(c.o.number).status === 'new' &&
      catalog.getProduct('torch').stock === stockHeldC && texts(c.o).filter((t) => t === UNKNOWN).length === 1);
    pp.ask = 'paid';
    const hkSoon = await answersOf(orders.housekeeping());
    check('…a doubt PayPal has held for a month is not asked about again in the next round: a few times a day, so its asks last',
      hkSoon.asked === 0 && pp.asks === asksBefore + 1 && !orders.getOrder(c.o.number).paid_at);
    ageAttempt(c.o, 30 * 24 * 60);
    const hk2 = orders.housekeeping();
    const hk2Inquiry = await answersOf(hk2);
    check('…and when PayPal releases the money the order resolves itself to PAID — nobody had to open a page',
      hk2.expired === 0 && hk2Inquiry.settled === 1 && !!orders.getOrder(c.o.number).paid_at && orders.getOrder(c.o.number).status === 'new' && ppRows(c.o)[0].status === 'paid');

    // D. …or to really unpaid: PayPal says nothing was captured, and the hold rule then applies
    const d = await lost('timeout');
    ageOrder(d.o, 30);
    ageAttempt(d.o, 5 * 60);
    const stockHeldD = catalog.getProduct('torch').stock;
    pp.ask = 'approved';
    const hk3 = orders.housekeeping();
    check('an old order in doubt is not cancelled before PayPal has answered', hk3.expired === 0 && orders.getOrder(d.o.number).status === 'new');
    const hk3Inquiry = await answersOf(hk3);
    check('…once PayPal says nothing was captured the row is closed, and the order is cancelled by the ordinary hold rule with its stock back',
      hk3Inquiry.closed === 1 && ppRows(d.o)[0].status === 'failed' && orders.getOrder(d.o.number).status === 'cancelled' &&
      catalog.getProduct('torch').stock === stockHeldD + 1 && texts(d.o).some((t) => /בוטלה אוטומטית: לא שולמה/.test(t)));
    store.settings.saveSettings({ holdHours: 0 });
    asksBefore = pp.asks;
    const idle = orders.housekeeping();
    check('with nothing in doubt housekeeping asks PayPal nothing, and never throws or rejects', idle.expired === 0 && ((await answersOf(idle)).asked || 0) === 0 && pp.asks === asksBefore);

    // E. the reviewer's story as it stood: a second row was paid while the first was never looked at again
    const e1 = await lost('timeout');
    db.prepare(`INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status, transaction_id, set_paid)
      VALUES (?, 'paypal', 'live', ?, 'WIREPAIDTWICE01', ?, 'ILS', 'paid', 'CAPWIREPAIDTWICE01', 1)`).run(e1.o.id, 'ref-second-' + e1.o.id, e1.o.total);
    db.prepare('UPDATE store_orders SET paid_at = ? WHERE id = ?').run(new Date().toISOString(), e1.o.id);
    pp.ask = 'paid';
    asksBefore = pp.asks;
    const eVerify = await gateway.adminVerify(orders.getOrder(e1.o.number), ppRows(e1.o)[0].id);
    check('the owner\'s "בדיקה מול PayPal" on a row in doubt really ASKS PayPal when another row of the order is already paid',
      pp.asks === asksBefore + 1 && eVerify.changed === true && eVerify.status === 'paid' && eVerify.message === 'התשלום אושר ונרשם');
    check('…and the second payment is recorded as a double to give back — paid_at is not touched again',
      ppRows(e1.o)[0].status === 'paid' && ppRows(e1.o)[0].set_paid === 0 && texts(e1.o).includes('תשלום PayPal כפול — ההזמנה כבר שולמה'));

    // F. a capture PayPal clearly refuses is NOT in doubt: the order is payable again at once
    const f = await lost('refused');
    asksBefore = pp.asks;
    seqBefore = pp.seq;
    const fPage = pageOf(f.o);
    const fCreate = await paypal.createForOrder(f.o.token);
    check('a capture PayPal clearly refuses closes the row — the mark is still on it, and it is not in doubt',
      f.reply.http === 402 && f.reply.code === 'FAILED' && ppRows(f.o)[0].status === 'failed' && !!ppRows(f.o)[0].capture_tried_at && inDoubt(ppRows(f.o)[0]) === false);
    check('…so the page offers the button and a new PayPal order opens, with no inquiry in the way',
      fPage.canPay === true && !fPage.checking && fCreate.ok === true && fCreate.orderId !== f.created.orderId && pp.seq === seqBefore + 1 && pp.asks === asksBefore);

    // G. a refusal that arrives while an EARLIER attempt has no answer closes nothing: PayPal is asked
    const g = await lost('timeout');
    pp.capture = 'refused';
    pp.ask = 'paid';
    asksBefore = pp.asks;
    const gSecond = await paypal.captureForOrder(g.o.token, g.created.orderId);
    pp.capture = 'ok';
    check('a second capture PayPal refuses while the first has no answer ("already captured") is not "nothing was charged": PayPal is asked, and the first is found paid',
      gSecond.ok === true && gSecond.status === 'paid' && pp.asks === asksBefore + 1 && ppRows(g.o)[0].status === 'paid' && !!orders.getOrder(g.o.number).paid_at &&
      !texts(g.o).some((t) => /לא הושלם/.test(t)));

    // H. the race the mark could have opened: two captures of one PayPal order at once
    const h = placePP();
    const hCreated = await paypal.createForOrder(h.token);
    const both = await Promise.all([paypal.captureForOrder(h.token, hCreated.orderId), paypal.captureForOrder(h.token, hCreated.orderId)]);
    check('two captures of the same PayPal order at once still settle ONCE: one "paid", one "already", one history line',
      both.every((r) => r.ok && r.status === 'paid') && both.filter((r) => r.already).length === 1 && ppRows(h).length === 1 && ppRows(h)[0].status === 'paid' &&
      texts(h).filter((t) => t === 'שולם ב-PayPal').length === 1 && !texts(h).includes(UNKNOWN));

    // I. a pending row nobody tried to capture — and every row from before the mark existed — is as it always was
    const i1 = placePP();
    const iCreated = await paypal.createForOrder(i1.token);
    db.prepare("UPDATE store_payments SET created_at = datetime('now', '-5 hours'), error = 'timeout' WHERE order_id = ?").run(i1.id);
    asksBefore = pp.asks;
    const iFirst = await paypal.verifyRow(ppRows(i1)[0], { source: 'page' });
    check('a pending row without the mark is NOT in doubt: from the order page its first ask still only starts the clock',
      !inDoubt(ppRows(i1)[0]) && iFirst.deferred === true && pp.asks === asksBefore && pageOf(i1).canPay === true && !pageOf(i1).checking);
    seqBefore = pp.seq;
    const iAgain = await paypal.createForOrder(i1.token);
    check('…and its button opens a new PayPal order without asking PayPal anything', iAgain.ok === true && iAgain.orderId !== iCreated.orderId && pp.seq === seqBefore + 1 && pp.asks === asksBefore);

    // J. the same story through the public doors, in the order the browser now walks it:
    //    capture → an answer that is "we do not know" → the order is loaded again → and again
    expressApp.use(require('../src/routes/store-public'));
    const door = async (method, urlPath, body) => {
      const res = await fetch('http://127.0.0.1:' + fakeHttp.address().port + urlPath, {
        method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined
      });
      return { status: res.status, json: await res.json().catch(() => ({})) };
    };
    const j = placePP();
    const jCreate = await door('POST', '/api/store/paypal/create', { token: j.token });
    pp.capture = 'timeout';
    pp.ask = 'down';
    const jCapture = await door('POST', '/api/store/paypal/capture', { token: j.token, orderId: jCreate.json.orderId });
    pp.capture = 'ok';
    const jLoad1 = await door('GET', '/api/store/order/' + j.token);
    check('through the doors: a capture with no answer is 502 TRANSIENT "לא ידוע אם החיוב עבר", and the order loaded right after it has no button and says it is being checked',
      jCreate.status === 200 && jCapture.status === 502 && jCapture.json.code === 'TRANSIENT' && jCapture.json.status === 'pending' && /לא ידוע אם החיוב עבר/.test(jCapture.json.message) &&
      jLoad1.status === 200 && jLoad1.json.order.paid === false && jLoad1.json.order.payment.paypal.canPay === false && jLoad1.json.order.payment.paypal.checking === true &&
      jLoad1.json.order.payment.paypal.sdk === '' && /נבדק מול PayPal/.test(jLoad1.json.order.payment.paypal.message));
    ageAttempt(j, 1);
    pp.ask = 'paid';
    const jLoad2 = await door('GET', '/api/store/order/' + j.token);
    check('…and the next load of the order page finds the payment PayPal did take: the order is paid, once, with no second PayPal order',
      jLoad2.json.order.paid === true && jLoad2.json.order.payment.paypal.status === 'paid' && jLoad2.json.order.payment.paypal.canPay === false &&
      !jLoad2.json.order.payment.paypal.checking && ppRows(j).length === 1 && texts(j).filter((t) => t === 'שולם ב-PayPal').length === 1);

    // an install from before the mark: the column arrives once, at the end, and what was pending there is not in doubt
    const Database = require('better-sqlite3');
    const { initializeStore } = require('../src/store/schema');
    const before269 = new Database(':memory:');
    before269.exec(`CREATE TABLE store_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, provider TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'test',
      reference TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL DEFAULT '', session_token TEXT NOT NULL DEFAULT '', session_token_hash TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      transaction_id TEXT NOT NULL DEFAULT '', transaction_token TEXT NOT NULL DEFAULT '', account_tail TEXT NOT NULL DEFAULT '', approval TEXT NOT NULL DEFAULT '',
      card_last4 TEXT NOT NULL DEFAULT '', card_brand TEXT NOT NULL DEFAULT '', installments INTEGER NOT NULL DEFAULT 1, refunded INTEGER NOT NULL DEFAULT 0,
      refund_unknown INTEGER NOT NULL DEFAULT 0, refund_lock TEXT, set_paid INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
      verify_count INTEGER NOT NULL DEFAULT 0, last_verify_at TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    before269.prepare("INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status, error) VALUES (1, 'paypal', 'live', 'ref-old', 'OLDPENDING0001', 5000, 'ILS', 'pending', 'timeout')").run();
    initializeStore(before269);
    initializeStore(before269);
    const colsOf = (h) => h.prepare('PRAGMA table_info(store_payments)').all().map((c) => c.name);
    const oldPending = before269.prepare('SELECT * FROM store_payments').get();
    check('a database from before the mark gains `capture_tried_at` once, last — the same columns in the same order as a fresh one — and its pending row is NOT in doubt',
      colsOf(before269).join(',') === colsOf(db).join(',') && colsOf(before269).pop() === 'capture_tried_at' && oldPending.capture_tried_at === '' &&
      oldPending.status === 'pending' && oldPending.error === 'timeout' && inDoubt(oldPending) === false);
    before269.close();

    // K. the order page's own script, RUN: public/tz-store.js in a small DOM, against the doors above, with
    //    PayPal's button stubbed (its SDK is never fetched — the page's <script> tag is handed straight to onload)
    const storeJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'tz-store.js'), 'utf8');
    class Tag {
      constructor(tag, log) { this.tagName = String(tag).toUpperCase(); this.attrs = {}; this.kids = []; this.own = ''; this.on = {}; this.log = log; this.parentNode = null; }
      setAttribute(n, v) { this.attrs[n] = String(v); }
      getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
      hasAttribute(n) { return n in this.attrs; }
      removeAttribute(n) { delete this.attrs[n]; }
      get className() { return this.attrs.class || ''; }
      set className(v) { this.attrs.class = String(v); }
      get classList() { const el = this; return { add(c) { el.className = (el.className + ' ' + c).trim(); }, remove() {}, contains: (c) => el.className.split(/\s+/).includes(c), toggle() {} }; }
      get textContent() { return this.own + this.kids.map((k) => k.textContent).join(''); }
      set textContent(v) { this.kids = []; this.own = v == null ? '' : String(v); if (this.own) this.log.push(this.own); }
      appendChild(k) { k.parentNode = this; this.kids.push(k); if (this.onAppend) this.onAppend(k); return k; }
      insertBefore(k) { return this.appendChild(k); }
      remove() { if (this.parentNode) this.parentNode.kids = this.parentNode.kids.filter((x) => x !== this); }
      addEventListener(type, fn) { (this.on[type] = this.on[type] || []).push(fn); }
      focus() {}
      closest() { return null; }
      all(out) { for (const k of this.kids) { out.push(k); k.all(out); } return out; }
      // the two selector shapes the order page asks for: [attribute] and .class
      querySelectorAll(sel) {
        const last = String(sel).trim().split(/\s+/).pop();
        const attr = /^\[([\w-]+)\]$/.exec(last);
        const cls = /^\.([\w-]+)$/.exec(last);
        return this.all([]).filter((k) => (attr ? k.hasAttribute(attr[1]) : cls ? k.className.split(/\s+/).includes(cls[1]) : false));
      }
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    }
    /** Open the order page for `token`. `wire(url, real)` may stand between the page and the server for one request. */
    const openOrderPage = async (token) => {
      const page = { said: [], gets: 0, buttons: null, wire: null, sdk: [] };
      const doc = {
        readyState: 'complete', currentScript: { dataset: {} },
        createElement: (tag) => new Tag(tag, page.said),
        addEventListener() {},
        querySelectorAll: (sel) => doc.body.querySelectorAll(sel),
        querySelector: (sel) => doc.body.querySelector(sel)
      };
      doc.body = new Tag('body', page.said);
      doc.head = new Tag('head', page.said);
      // PayPal's SDK tag: never fetched — the stub below IS the SDK, and the tag is told it loaded
      doc.head.onAppend = (k) => { if (k.tagName === 'SCRIPT') { page.sdk.push(String(k.src)); setTimeout(() => k.onload && k.onload(), 0); } };
      const root = doc.body.appendChild(new Tag('div', page.said));
      root.setAttribute('data-tz-order', '');
      page.body = root.appendChild(new Tag('div', page.said));
      page.body.setAttribute('data-tz-order-body', '');
      const origin = 'http://127.0.0.1:' + fakeHttp.address().port;
      const win = {
        localStorage: { getItem: () => null, setItem() {} },
        location: { search: '?o=' + token, pathname: '/order.html', hash: '', href: '' },
        addEventListener() {},
        paypal: { Buttons: (cfg) => { page.buttons = cfg; return { render() {} }; } }
      };
      const pageFetch = (url, init) => {
        if (!init || !init.method || init.method === 'GET') page.gets++;
        const real = () => fetch(origin + url, init);
        const wire = page.wire;
        page.wire = null;
        return wire && /\/paypal\/capture$/.test(url) ? wire(real) : real();
      };
      vm.runInNewContext(storeJs, { window: win, document: doc, fetch: pageFetch, URLSearchParams, setTimeout, clearTimeout, console }, { filename: 'tz-store.js' });
      page.settle = async () => { for (let n = 0; n < 12; n++) await pause(10); };
      page.text = () => page.body.textContent;
      page.hasButton = () => !!page.body.querySelector('.bent-paypal-buttons');
      await page.settle();
      return page;
    };
    const vm = require('vm');
    // what PayPal's SDK does with the page's callbacks: onApprove, and onError when that rejects
    const pressApprove = (page, orderID) => Promise.resolve().then(() => page.buttons.onApprove({ orderID })).catch((err) => page.buttons.onError(err));
    const NOTHING_CHARGED = /לא חויב כלום/;
    const UNSURE = 'לא ידוע אם החיוב עבר — בודקים…';
    try {
      // 1. the capture reached the server and PayPal took the money — but the reply the browser got was not ours (a proxy's 504 page)
      const k1 = placePP();
      const p1 = await openOrderPage(k1.token);
      const k1Ready = p1.hasButton() && !!p1.buttons && p1.sdk.length === 1 && /^https:\/\/www\.paypal\.com\/sdk\/js\?/.test(p1.sdk[0]);
      const k1Id = await p1.buttons.createOrder();
      pp.capture = 'ok';
      p1.said.length = 0;
      const getsBefore1 = p1.gets;
      p1.wire = async (real) => { await real(); return new Response('<html>504 Gateway Time-out</html>', { status: 504, headers: { 'Content-Type': 'text/html' } }); };
      await pressApprove(p1, k1Id);
      await p1.settle();
      check('RUN in the page: a capture whose reply cannot be read says "לא ידוע אם החיוב עבר — בודקים…" — never "nothing was charged" — and loads the order again, which shows it PAID',
        k1Ready && /^WIREORDER/.test(k1Id) && p1.said.includes(UNSURE) && !p1.said.some((t) => NOTHING_CHARGED.test(t)) && p1.gets === getsBefore1 + 1 &&
        !!orders.getOrder(k1.number).paid_at && /שולמה/.test(p1.text()) && !p1.hasButton());

      // 2. the server itself answers "PayPal did not reply": the page takes the button away and says it is being checked
      const k2 = placePP();
      const p2 = await openOrderPage(k2.token);
      const k2Id = await p2.buttons.createOrder();
      pp.capture = 'timeout';
      pp.ask = 'down';
      p2.said.length = 0;
      const getsBefore2 = p2.gets;
      await pressApprove(p2, k2Id);
      await p2.settle();
      pp.capture = 'ok';
      check('RUN in the page: when the server says the outcome is unknown the page loads the order again — the button is gone, "נבדק מול PayPal" stands in its place, and nothing invites a second payment',
        p2.gets === getsBefore2 + 1 && !p2.hasButton() && /נבדק מול PayPal/.test(p2.text()) && !/אפשר לשלם/.test(p2.text()) &&
        !p2.said.some((t) => NOTHING_CHARGED.test(t) || /נסו שוב בעוד רגע/.test(t)));
      // …and PayPal's own error callback after a capture was asked for is the same "we do not know"
      p2.said.length = 0;
      if (p2.buttons) p2.buttons.onError(new Error('window closed'));
      await p2.settle();
      check('RUN in the page: PayPal\'s error callback AFTER a capture was asked for is "we do not know" too, and loads the order again',
        p2.said.includes(UNSURE) && !p2.said.some((t) => NOTHING_CHARGED.test(t)) && p2.gets === getsBefore2 + 2);

      // 3. the request never left the browser
      const k3 = placePP();
      const p3 = await openOrderPage(k3.token);
      const k3Id = await p3.buttons.createOrder();
      p3.said.length = 0;
      const getsBefore3 = p3.gets;
      p3.wire = () => Promise.reject(new TypeError('Failed to fetch'));
      await pressApprove(p3, k3Id);
      await p3.settle();
      check('RUN in the page: a capture request that fails on the way is "לא ידוע אם החיוב עבר — בודקים…" and a fresh load of the order — which, with no capture ever tried, still offers the button',
        p3.said.includes(UNSURE) && !p3.said.some((t) => NOTHING_CHARGED.test(t)) && p3.gets === getsBefore3 + 1 && p3.hasButton() && !ppRows(k3)[0].capture_tried_at);

      // 4. what stays as it was: PayPal's clear refusal in the server's own words, and a failure before any capture
      pp.capture = 'refused';
      p3.said.length = 0;
      const getsBefore4 = p3.gets;
      await pressApprove(p3, k3Id);
      await p3.settle();
      pp.capture = 'ok';
      const k5 = placePP();
      const p5 = await openOrderPage(k5.token);
      p5.said.length = 0;
      p5.buttons.onError(new Error('create failed'));
      check('RUN in the page: a capture PayPal clearly refused keeps the server\'s sentence and the button (no reload), and an error BEFORE any capture may still say nothing was charged',
        p3.said.join('|') === 'התשלום לא הושלם. לא חויב כלום — אפשר לנסות שוב.' && p3.gets === getsBefore4 && p3.hasButton() &&
        p5.said.join('|') === 'התשלום נכשל. לא חויב כלום — אפשר לנסות שוב.');
    } catch (e) {
      check('RUN in the page: the order page\'s script ran in the small DOM — threw: ' + (e && e.message), false);
    }

    // …and the same paths as text (holds even where the small DOM above cannot run the page)
    const approve = storeJs.slice(storeJs.indexOf('onApprove: function'), storeJs.indexOf('onCancel: function'));
    const onError = storeJs.slice(storeJs.indexOf('onError: function'), storeJs.indexOf(".render('#tz-paypal-buttons')"));
    check('the order page never says "nothing was charged" on its own word once a capture was asked for: an unreadable or failed reply is "לא ידוע אם החיוב עבר — בודקים…", then the order is loaded again',
      approve.length > 0 && !/לא חויב/.test(approve) && /captureTried = true;/.test(approve) && /function \(\) \{ captureUnknown\(''\); \}/.test(approve) &&
      /function captureUnknown\(said\) \{\s*note\.textContent = said \|\| 'לא ידוע אם החיוב עבר — בודקים…';\s*load\(\);\s*\}/.test(storeJs) &&
      /if \(captureTried\) \{ captureUnknown\(''\); return; \}/.test(onError));

    // ── "max per order" is the product's, not each option's ──────────────
    catalog.createProduct({ title: 'חולצה', slug: 'shirt', price: '100', maxPerOrder: 2, delivery: false,
      variants: [{ label: 'S', stock: 10 }, { label: 'M', stock: 10 }, { label: 'L', stock: 10 }] });
    const sizes = catalog.getProduct('shirt').variants.map((v) => v.code);
    const greedy = sizes.map((variant) => ({ sku: 'shirt', variant, qty: 2 }));
    const shirts = (q) => q.lines.filter((l) => l.sku === 'shirt').reduce((n, l) => n + l.qty, 0);
    const limited = (q) => q.issues.filter((i) => i.code === 'QTY_LIMIT');
    const q6 = store.pricing.quote({ items: greedy, payment: 'cash' });
    check('"max per order" 2 on a product with three options: two of EACH is cut to two in all',
      sizes.length === 3 && shirts(q6) === 2 && q6.changed === true && limited(q6).length === 2);
    check('…and the shopper is told the truth: the limit is across the options, and which option left the cart',
      limited(q6).length === 2 && limited(q6).every((i) => /אפשר להזמין עד 2 יחידות של "חולצה" בהזמנה, בכל האפשרויות יחד — "חולצה — [ML]" הוסר מהעגלה/.test(i.message)));
    const p6 = orders.placeOrder({ items: greedy, payment: 'cash', customer: buyer });
    check('…placing that cart is refused (CART_CHANGED): the limit holds at the order, not only in the cart',
      p6.ok === false && p6.code === 'CART_CHANGED' && shirts(p6.quote) === 2 && catalog.getProduct('shirt').variants.every((v) => v.stock === 10));
    const split = store.pricing.quote({ items: [{ sku: 'shirt', variant: sizes[0], qty: 1 }, { sku: 'shirt', variant: sizes[1], qty: 1 }], payment: 'cash' });
    check('one each of two options is the whole allowance: nothing to say, and each line\'s stepper stops where the other leaves it',
      shirts(split) === 2 && split.issues.length === 0 && split.changed === false && split.lines.every((l) => l.maxQty === 1));
    const one = store.pricing.quote({ items: [{ sku: 'shirt', variant: sizes[0], qty: 3 }], payment: 'cash' });
    check('one option over the limit is still cut to it, and told so', shirts(one) === 2 && one.lines[0].maxQty === 2 && limited(one).length === 1 && /בכל האפשרויות יחד — הכמות עודכנה$/.test(limited(one)[0].message));

    // ── a PayPal order needs an email: its only pay step is the order page ─
    const noMail = { name: 'דנה כהן', phone: '050-1234567' };
    const orderNoMail = (payment) => orders.placeOrder({ items: [{ sku: 'torch', qty: 1 }], shipping: 'pickup', payment, customer: noMail });
    const ppNoMail = orderNoMail('paypal');
    check('a PayPal order without an email is sent back to the form, the way a card order is',
      ppNoMail.ok === false && ppNoMail.code === 'FIELDS' && ppNoMail.fields.length === 1 && ppNoMail.fields[0].field === 'email');
    store.settings.saveSettings({ demoPayments: true });
    const demoNoMail = orderNoMail('pretend');
    const cashNoMail = orderNoMail('cash');
    store.settings.saveSettings({ demoPayments: false });
    check('…a demo order stays one click — no email asked — and so does a cash order', demoNoMail.ok === true && cashNoMail.ok === true && store.settings.loadSettings().requireEmail === false);
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    if (fakeHttp) fakeHttp.close();
  }

  console.log('\nSMOKE STORE-WIRING: ' + (failed ? 'FAIL (' + failed + ')' : 'PASS'));
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  console.log('\nSMOKE STORE-WIRING: FAIL');
  process.exit(1);
});
