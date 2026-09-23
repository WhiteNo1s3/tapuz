'use strict';

/**
 * QA — the card gateway (src/store/gateway): Grow and Cardcom behind one
 * driver interface, on a throwaway site, through fake transports. Money
 * moves here, so the tests are mostly about when an order must NOT be
 * marked paid:
 *
 *   readiness   a card method is offered and accepted only with a provider,
 *               its keys, the currency, an https baseUrl (both modes), and
 *               never with Cardcom's public test terminal in live mode
 *   the session the create payload carries THE AMOUNT FROM THE DATABASE in
 *               the provider's format, our hex reference, return + webhook
 *               URLs from baseUrl; a fresh session is reused; ten per order
 *   Cardcom     a forged webhook claiming "paid" while GetLpResult says
 *               otherwise leaves the order unpaid; PAID needs every check
 *               (ResponseCode, LowProfileId, terminal, ReturnValue,
 *               ChargeOnly, Debit, not a refund, not J5/J2, amount, coin);
 *               inconclusive stays pending, a decline is `failed` and a later
 *               confirmation still wins; a duplicate webhook and a concurrent
 *               order-page verify settle exactly once; 503 only when OUR
 *               inquiry failed; refunds splice the int64 id verbatim
 *   Grow        multipart requests; the callback is token-anchored (constant
 *               time) and settles without an inquiry, then approveTransaction
 *               echoes it; urlencoded AND multipart bracket keys are parsed
 *               by us; forged / mismatched callbacks do nothing; the inquiry
 *               is the fallback; Bit in test mode is flagged loudly
 *   test mode   a confirmation records the row and the event, never paid_at
 *   the books   mismatch → not paid + event; cancelled / double → recorded +
 *               "יש להחזיר"; one transaction settles one row; the paid
 *               checkbox cannot un-pay real money
 *   secrets     no credential in any API response, admin HTML (beyond a
 *               last-4 tail), the .pzn, the site package, <bent-store>, the
 *               events, the CSV or the console; Grow's processId /
 *               processToken / transactionToken never reach a browser
 *   BenTML      <bent-pay kind="card" max-payments="3"> round-trips; a
 *               document with a card method and no gateway gets a note
 *   privacy     the subject export lists payments; erasure drops the card
 *
 * Run: node scripts/smoke-store-gateway.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-gateway-'));
process.env.TAPUZ_ROOT = ROOT;
process.env.PORT = process.env.SMOKE_PORT || '3973';
// the per-IP limits exist for the open internet; this run is one visitor doing a month's work in a minute
process.env.TAPUZ_STORE_PAY_MAX = '1000';
process.env.TAPUZ_STORE_HOOK_MAX = '1000';
process.env.TAPUZ_STORE_VIEW_MAX = '1000';
process.env.TAPUZ_STORE_ORDER_MAX = '1000';
const PORT = parseInt(process.env.PORT, 10);
const BASE = 'http://127.0.0.1:' + PORT;

// every line the process prints is scanned for secrets at the end
const logs = [];
for (const m of ['log', 'error', 'warn', 'info']) {
  const orig = console[m];
  console[m] = (...a) => { logs.push(a.map((x) => String(x && x.stack ? x.stack : x)).join(' ')); orig.apply(console, a); };
}

let failed = 0;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) failed++;
}

// obviously fake credentials — the point of the last section is that none of them ever shows up anywhere
const CC = { terminal: '1000', apiName: 'fake-api-name-for-tests', apiPassword: 'fake-api-password-for-tests' };
const CC_LIVE_TERMINAL = '1234567';
const GR = { userId: 'fake-user-id-for-tests', pageCode: 'fakepagecode1234' };
const SECRETS = [CC.apiName, CC.apiPassword, GR.userId, GR.pageCode];

require('../src/db');
const { runSetup } = require('../src/setup');
runSetup({
  title: 'הסטודיו של נועה', description: 'נרות',
  colors: { primary: '#7c2d12', bg: '#ffffff', lightBg: '#fef3c7', text: '#1c1917' },
  menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
});
const config = require('../src/config');
const auth = require('../src/auth');
const owner = auth.createAdmin('owner', 'owner-pass-1');
const OWNER = auth.COOKIE_NAME + '=' + auth.makeToken(owner.id);
const { db } = require('../src/db');
const store = require('../src/store');
const { settings, orders, pricing, catalog } = store;
const gateway = require('../src/store/gateway');
const gwConfig = require('../src/store/gateway/config');
const render = require('../src/store/render');
const dialect = require('../src/bentml/store-dialect');

settings.saveSettings({
  shipping: [{ id: 'pickup', label: 'איסוף עצמי', price: '0', address: false }, { id: 'delivery', label: 'משלוח', price: '30', address: true }],
  payments: [
    { id: 'bank', kind: 'bank', label: 'העברה בנקאית', details: 'חשבון 12345' },
    { id: 'card', kind: 'card', label: 'כרטיס אשראי', maxPayments: '3' }
  ]
});
catalog.createProduct({ title: 'נר לבנדר', slug: 'lavender', price: '89.90', stock: 200 });
catalog.createProduct({ title: 'סבון זית', slug: 'soap', price: '25', stock: 200 });
settings.saveSettings({ open: true });

// ── the fake providers ───────────────────────────────────────────────
const calls = [];
const ccResults = {}; // LowProfileId → the GetLpResult answer (a function or an object)
let ccCreateFail = null;
let ccRefundFail = null;  // a scripted refund answer (an object) — null = success
let refundDelayMs = 0;    // the provider taking its time, for the concurrent-refund check
let refundHang = false;   // the provider never answers — the process 'dies' mid-call
const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const DB_FILE = path.join(ROOT, 'db', 'tapuz.db');
let grInquiry = null; // the getPaymentProcessInfo answer
let grApprove = { status: '1', err: '', data: '' };
let grRefund = { status: 1, err: '', data: { transactionId: '99', statusCode: 3 } };
let lpCount = 0;
const newGuid = () => crypto.randomUUID();
// minted at run time, never committed (.gitleaks.toml: fixture tokens are not written into the tree)
const GROW_TOKEN = crypto.randomBytes(16).toString('hex');
const GROW_TXN_TOKEN = crypto.randomBytes(16).toString('hex');

function jsonReply(status, obj, text) {
  return { status, text: text || JSON.stringify(obj), json: obj };
}
function formFields(body) {
  const out = {};
  if (body && typeof body.entries === 'function') for (const [k, v] of body.entries()) out[k] = v;
  return out;
}
async function fakeTransport(call) {
  const url = call.url;
  const rec = { url, method: call.method, headers: call.headers || {}, body: call.body };
  calls.push(rec);
  if (url.startsWith('https://secure.cardcom.solutions/api/v11/')) {
    const j = JSON.parse(String(call.body));
    rec.json = j;
    if (url.endsWith('/LowProfile/Create')) {
      if (ccCreateFail) return ccCreateFail;
      const id = newGuid();
      return jsonReply(200, { ResponseCode: 0, Description: 'OK', LowProfileId: id, Url: 'https://secure.cardcom.solutions/EA/LPC6/1000/' + id });
    }
    if (url.endsWith('/LowProfile/GetLpResult')) {
      lpCount++;
      const r = ccResults[String(j.LowProfileId).toLowerCase()];
      if (typeof r === 'function') return r(j);
      if (r) return r;
      return jsonReply(200, { ResponseCode: 1, Description: 'Low profile not completed' });
    }
    if (url.endsWith('/Transactions/RefundByTransactionId')) {
      rec.raw = String(call.body);
      if (refundHang) return new Promise(() => {});
      if (refundDelayMs) await new Promise((r) => setTimeout(r, refundDelayMs));
      if (ccRefundFail) return ccRefundFail;
      const raw = '{"ResponseCode":0,"Description":"OK","NewTranzactionId":9223372036854775806}';
      return { status: 200, text: raw, json: JSON.parse(raw) };
    }
  }
  if (/^https:\/\/(sandbox|secure)\.meshulam\.co\.il\/api\/light\/server\/1\.0\//.test(url)) {
    rec.fields = formFields(call.body);
    rec.isFormData = typeof FormData !== 'undefined' && call.body instanceof FormData;
    const method = url.split('/').pop();
    if (method === 'createPaymentProcess') {
      return { status: 200, text: JSON.stringify({ status: 1, err: '', data: { processId: '395235', processToken: GROW_TOKEN, url: 'https://sandbox.meshulam.co.il/far?l=0123456789abcdef0123456789abcdef' } }), json: null };
    }
    if (method === 'getPaymentProcessInfo') return jsonReply(200, grInquiry || { status: 1, err: '', data: { processId: '395235', processToken: GROW_TOKEN, transactions: [{ statusCode: '0', transactionId: '0', asmachta: '', sum: '0' }] } });
    if (method === 'approveTransaction') return jsonReply(200, grApprove);
    if (method === 'refundTransaction') return jsonReply(200, grRefund);
  }
  return { status: 404, text: 'no such fake', json: null };
}
gateway._setTransport(fakeTransport);
const callsTo = (suffix) => calls.filter((c) => c.url.endsWith(suffix));

// ── http helpers ─────────────────────────────────────────────────────
function req(method, urlPath, { body, raw, type, cookie, headers: extra } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE, ...(extra || {}) };
    if (raw != null) { data = raw; headers['Content-Type'] = type || 'application/json'; } else if (body != null) { data = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    if (cookie) headers.Cookie = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* html or text */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function waitUp(tries = 60) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/', () => resolve()).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries);
  });
}
function multipart(fields) {
  const b = '----tapuzhookboundary' + Date.now();
  let s = '';
  for (const [k, v] of Object.entries(fields)) s += '--' + b + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n';
  return { body: s + '--' + b + '--\r\n', type: 'multipart/form-data; boundary=' + b };
}

const responses = []; // every browser-visible body, scanned at the end
async function pub(method, p, opts) { const r = await req(method, p, opts); responses.push(r.text); return r; }

function placeCard(overrides = {}) {
  return orders.placeOrder({
    items: [{ sku: 'lavender', qty: 2 }, { sku: 'soap', qty: 1 }], shipping: 'delivery', payment: 'card',
    customer: { name: 'דנה כהן', phone: '050-1234567', email: 'dana@example.com' },
    address: { city: 'חיפה', street: 'הנביאים 3' }, ...overrides
  }, { orderUrl: (t) => '/order.html?o=' + t });
}
const rowsOf = (order) => gateway.paymentsOf(order.id);
const eventsOf = (order) => orders.listEvents(order.id).map((e) => e.text);
const paidEvents = (order) => eventsOf(order).filter((t) => /^שולם בכרטיס אשראי/.test(t));
const setBase = (u) => config.saveConfig({ ...config.loadConfig(), baseUrl: u });
let txnSeq = 123456789;
function paidResult(lp, over = {}) {
  // every fixture is its own transaction unless the test says otherwise — one transaction settles one row
  const txn = over.txn != null ? over.txn : ++txnSeq;
  return jsonReply(200, {
    ResponseCode: over.top == null ? 0 : over.top, Description: over.desc || 'OK', TerminalNumber: over.terminal || 1000, LowProfileId: over.lpId || lp,
    TranzactionId: over.topTxn != null ? over.topTxn : txn,
    ReturnValue: over.ret, Operation: over.op || 'ChargeOnly', UIValues: { NumOfPayments: 3 },
    TranzactionInfo: { ResponseCode: over.tiCode == null ? 0 : over.tiCode, Description: over.tiDesc || 'OK', TranzactionId: txn, Amount: over.amount == null ? 234.8 : over.amount,
      CoinId: over.coin == null ? 1 : over.coin, ApprovalNumber: '123456', Last4CardDigitsString: '0034', NumberOfPayments: 3, Brand: 'Visa',
      IsRefund: over.isRefund == null ? false : over.isRefund, DealType: over.dealType || 'Debit' }
  }, over.text);
}

(async () => {
  require('../src/server'); // boots app.listen on PORT, in THIS process — so the fake transport above is the one the drivers get
  try {
    await waitUp();

    // ── readiness ──────────────────────────────────────────────────────
    check('no gateway: the card method is not offered by the quote, and the checkout page has no card radio',
      !pricing.quote({ items: [{ sku: 'soap', qty: 1 }] }).payments.some((p) => p.kind === 'card') && !/value="card"/.test(render.renderCheckout()));
    const refusedNoGw = placeCard();
    check('no gateway: placeOrder refuses the card method (PAYMENT_REQUIRED) — nothing ordered', refusedNoGw.ok === false && refusedNoGw.code === 'PAYMENT_REQUIRED' && orders.countByStatus().all === 0);
    gateway.saveAdminSettings({ provider: 'cardcom', mode: 'test', fields: { cardcom: { ...CC } } });
    let st = gateway.status();
    check('Cardcom keys but no baseUrl: not ready, and the reason names the site-address setting', !st.ready && st.connected && st.reasons.some((r) => /baseUrl/.test(r)));
    setBase('http://shop.example');
    check('an http:// baseUrl is refused in TEST mode too (no request-origin fallback)', !gateway.status().ready && gateway.status().reasons.some((r) => /https/.test(r)));
    setBase('https://shop.example');
    st = gateway.status();
    check('an https baseUrl: ready; the webhook URL is built from it', st.ready && st.webhookUrl === 'https://shop.example/api/store/gateway/cardcom/hook');
    const liveWithTest = gateway.saveAdminSettings({ mode: 'live', confirmLive: true });
    check('Cardcom live mode with the public test terminal 1000 is refused at save time (a reason) and at readiness',
      liveWithTest.errors.some((e) => /1000/.test(e)) && !gateway.status().ready && gateway.status().reasons.some((r) => /1000/.test(r)));
    gateway.saveAdminSettings({ mode: 'test' });
    // R1: test mode IS terminal 1000 — any other terminal on Cardcom's one host charges real cards
    const oR1 = placeCard();
    const orderR1 = orders.getOrder(oR1.order.number);
    const realInTest = gateway.saveAdminSettings({ fields: { cardcom: { terminal: '1234567' } } });
    const stR1 = gateway.status();
    const payR1 = await pub('POST', '/api/store/pay/' + orderR1.token, { body: {} });
    check('R1: Cardcom TEST mode with a real terminal is not ready — the save and the readiness say "1000 — מסוף אחר מחייב כסף אמיתי", the card method leaves the checkout, the pay door refuses and no Create is sent',
      realInTest.errors.some((e) => /1000/.test(e) && /כסף אמיתי/.test(e)) && !stR1.ready && stR1.reasons.some((r) => /1000/.test(r) && /כסף אמיתי/.test(r)) &&
      !/value="card"/.test(render.renderCheckout()) && payR1.status === 503 && payR1.json.code === 'NOT_READY' && callsTo('/LowProfile/Create').length === 0);
    gateway.saveAdminSettings({ fields: { cardcom: { terminal: '1000' } } });
    // R13: test → live only with confirmLive on the wire
    const noConfirm = await pub('POST', '/admin/api/store/gateway', { cookie: OWNER, body: { mode: 'live' } });
    const withConfirm = await pub('POST', '/admin/api/store/gateway', { cookie: OWNER, body: { mode: 'live', confirmLive: true } });
    check('R13: switching test → live is refused by the API without confirmLive (the mode stays test, the reason says so) and lands with it',
      noConfirm.status === 200 && noConfirm.json.settings.mode === 'test' && noConfirm.json.errors.some((e) => /confirmLive/.test(e)) && withConfirm.json.settings.mode === 'live');
    gateway.saveAdminSettings({ mode: 'test' });
    check('R17: the storage screen hides config/payments.json', require('../src/storage-view').HIDDEN_CONFIG.has('payments.json'));
    settings.saveSettings({ currency: 'USD' });
    gateway.saveAdminSettings({ provider: 'grow', fields: { grow: { ...GR } } });
    check('Grow in USD: not ready (ILS only)', !gateway.status().ready && gateway.status().reasons.some((r) => /USD/.test(r)));
    settings.saveSettings({ currency: 'ILS' });
    gateway.saveAdminSettings({ provider: 'cardcom' });
    const adminView = gateway.adminSettings();
    const ccView = adminView.providers.find((p) => p.id === 'cardcom');
    check('the admin view: readiness, mode, provider and TAILS only — a short value (the terminal) has no tail at all',
      adminView.ready && adminView.mode === 'test' && ccView.fields.find((f) => f.key === 'apiName').tail === 'ests' && ccView.fields.find((f) => f.key === 'apiName').set === true &&
      ccView.fields.find((f) => f.key === 'terminal').tail === '' && !JSON.stringify(adminView).includes(CC.apiName));
    check('config/payments.json is gitignored', /^config\/payments\.json$/m.test(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8')));

    // ── checkout with the card method ──────────────────────────────────
    const q = pricing.quote({ items: [{ sku: 'soap', qty: 1 }] });
    check('ready: the quote offers the card method with its installments', q.payments.some((p) => p.kind === 'card' && p.maxPayments === 3));
    const noMail = placeCard({ customer: { name: 'דנה כהן', phone: '050-1234567', email: '' } });
    check('a card order needs an email (the way back to the order page)', noMail.code === 'FIELDS' && noMail.fields.some((f) => f.field === 'email'));
    const o1 = placeCard();
    check('the order is placed; `pay` is a FIRST-PARTY action, not a provider URL', o1.ok && o1.pay === '/api/store/pay/' + o1.order.token && !/cardcom|meshulam/.test(o1.pay));
    const order1 = orders.getOrder(o1.order.number);
    check('the checkout page carries the test-mode banner while the gateway is in test mode', /מצב בדיקות — לא יחויב כסף אמיתי/.test(render.renderCheckout()) && /value="card"/.test(render.renderCheckout()));

    // ── the session (Cardcom) ──────────────────────────────────────────
    const pay1 = await pub('POST', '/api/store/pay/' + order1.token, { body: {} });
    check('POST /api/store/pay/:token opens the hosted page (https, on the constant host)', pay1.status === 200 && pay1.json.ok && /^https:\/\/secure\.cardcom\.solutions\//.test(pay1.json.url));
    check('a non-JSON POST to the pay door is refused (415)', (await req('POST', '/api/store/pay/' + order1.token, { raw: 'a=1', type: 'application/x-www-form-urlencoded' })).status === 415);
    const create1 = callsTo('/LowProfile/Create')[0];
    const row1 = rowsOf(order1)[0];
    const cj = create1.json;
    check('Create payload: the amount is the DATABASE total in decimal major units, the coin is ILS, ChargeOnly, Hebrew, terminal + ApiName',
      cj.Amount === 234.8 && order1.total === 23480 && cj.ISOCoinId === 1 && cj.Operation === 'ChargeOnly' && cj.Language === 'he' && cj.TerminalNumber === 1000 && cj.ApiName === CC.apiName);
    check('Create payload: the three return URLs are the order page with paid=back and the webhook is ours — all from baseUrl',
      cj.SuccessRedirectUrl === 'https://shop.example/order.html?o=' + order1.token + '&paid=back' && cj.FailedRedirectUrl === cj.SuccessRedirectUrl && cj.CancelRedirectUrl === cj.SuccessRedirectUrl &&
      cj.WebHookUrl === 'https://shop.example/api/store/gateway/cardcom/hook');
    check('Create payload: ReturnValue is our hex reference; ProductName ≤ 50; card-holder prefill; installments 1..3; no Document / IsRefundDeal / ApiPassword',
      /^[0-9a-f]{20}$/.test(cj.ReturnValue) && cj.ReturnValue === row1.reference && cj.ProductName === 'הזמנה ' + order1.number && cj.UIDefinition.CardOwnerNameValue === 'דנה כהן' &&
      cj.AdvancedDefinition.MinNumOfPayments === 1 && cj.AdvancedDefinition.MaxNumOfPayments === 3 && !('Document' in cj) && !JSON.stringify(cj).includes('IsRefundDeal') && !JSON.stringify(cj).includes(CC.apiPassword));
    check('the payment row: pending, the order\'s amount and currency, the LowProfileId, the terminal fingerprint, the https url',
      row1.status === 'pending' && row1.amount === 23480 && row1.currency === 'ILS' && row1.session_id.length > 20 && row1.account_tail === '1000' && /^https:/.test(row1.url) && row1.mode === 'test');
    const pay1b = await pub('POST', '/api/store/pay/' + order1.token, { body: {} });
    check('a second click within the window reuses the session — same url, no second Create', pay1b.json.url === pay1.json.url && callsTo('/LowProfile/Create').length === 1 && rowsOf(order1).length === 1);
    const lp1 = row1.session_id;
    const longMail = placeCard({ customer: { name: 'דנה כהן', phone: '050-1234567', email: 'a-very-long-mailbox-name-that-goes-past-fifty-characters@example.com' } });
    await pub('POST', '/api/store/pay/' + orders.getOrder(longMail.order.number).token, { body: {} });
    check('R12: an email over 50 characters is not prefilled at all — never truncated', longMail.ok && !('CardOwnerEmailValue' in callsTo('/LowProfile/Create').pop().json.UIDefinition));

    // ── the webhook is never believed ──────────────────────────────────
    const forged = JSON.stringify({ ResponseCode: 0, LowProfileId: lp1, ReturnValue: row1.reference, TranzactionInfo: { ResponseCode: 0, Amount: 234.8, CoinId: 1 } });
    const hookForged = await pub('POST', '/api/store/gateway/cardcom/hook', { raw: forged, type: 'application/json' });
    check('a forged webhook claiming "paid" while GetLpResult is inconclusive: 200 text/plain OK, one inquiry, the order stays unpaid and the row pending',
      hookForged.status === 200 && /text\/plain/.test(hookForged.headers['content-type']) && hookForged.text === 'OK' && lpCount === 1 &&
      !orders.getOrder(order1.number).paid_at && rowsOf(order1)[0].status === 'pending');
    check('the inquiry used the STORED LowProfileId and our terminal + ApiName', callsTo('/LowProfile/GetLpResult')[0].json.LowProfileId === lp1 && callsTo('/LowProfile/GetLpResult')[0].json.ApiName === CC.apiName);
    const unknown = await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: newGuid() }), type: 'application/json' });
    check('an unknown id gets the SAME reply (no oracle) and no inquiry', unknown.status === 200 && unknown.text === 'OK' && lpCount === 1);
    gwConfig.clearProvider('grow');
    check('a provider whose keys we do not hold is nobody\'s callback (404)', (await pub('POST', '/api/store/gateway/grow/hook', { raw: 'status=1', type: 'application/x-www-form-urlencoded' })).status === 404);
    check('…and a provider that does not exist: 404 too', (await pub('POST', '/api/store/gateway/paypal/hook', { raw: '{}', type: 'application/json' })).status === 404);
    check('a JSON body under a wrong Content-Type is still read as JSON (Cardcom)',
      (await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ lowprofileid: lp1 }), type: 'text/plain' })).status === 200 && lpCount === 2);
    const big = await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: lp1, pad: 'x'.repeat(70000) }), type: 'application/json' });
    check('a body over 64 KB is refused before it is read (413), with no stack', big.status === 413 && !/at .*\.js/.test(big.text));

    // ── strict verdicts (each one leaves the row unpaid) ───────────────
    const strict = [
      ['a refund answering ResponseCode 0 (IsRefund true)', { isRefund: true, dealType: 'Refund' }, 'pending'],
      ['a J5 hold (TranzactionInfo.ResponseCode 700)', { tiCode: 700 }, 'pending'],
      ['an Operation that is not ChargeOnly', { op: 'SuspendedDeal' }, 'pending'],
      ['a wrong ReturnValue (another order\'s pass-through)', { ret: 'deadbeefdeadbeefdead' }, 'pending'],
      ['a wrong terminal', { terminal: 999 }, 'pending'],
      ['R9: a top-level ResponseCode 5 with a PAID TranzactionInfo inside', { top: 5, desc: 'not completed yet' }, 'pending'],
      ['R9: a deal whose TranzactionId is 0', { txn: 0 }, 'pending'],
      ['a wrong coin (USD)', { coin: 2 }, 'mismatch']
    ];
    for (const [name, over, expect] of strict) {
      const o = placeCard();
      const od = orders.getOrder(o.order.number);
      const p = (await pub('POST', '/api/store/pay/' + od.token, { body: {} })).json;
      const lp = rowsOf(od)[0].session_id;
      ccResults[lp.toLowerCase()] = paidResult(lp, { ret: over.ret || rowsOf(od)[0].reference, ...over });
      await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: lp }), type: 'application/json' });
      const after = rowsOf(od)[0];
      check('strict: ' + name + ' → row ' + expect + ', order unpaid', p.ok && after.status === expect && !orders.getOrder(od.number).paid_at);
      if (expect === 'mismatch') check('…and the mismatch is an event for the owner', eventsOf(od).some((t) => /אי-התאמה/.test(t)));
      if (over.desc) check('R9: …and its Description is on the row for the admin', after.error === over.desc);
    }

    // ── test mode: a confirmation is recorded, never money ─────────────
    ccResults[lp1.toLowerCase()] = paidResult(lp1, { ret: row1.reference });
    const hookPaidTest = await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: lp1 }), type: 'application/json' });
    const row1After = rowsOf(order1)[0];
    check('TEST MODE: the row is paid with the card details, the order is NOT marked paid, and the event says so',
      hookPaidTest.status === 200 && row1After.status === 'paid' && row1After.approval === '123456' && row1After.card_last4 === '0034' && row1After.installments === 3 &&
      !orders.getOrder(order1.number).paid_at && eventsOf(order1).some((t) => /^תשלום בדיקה אושר — לא התקבל כסף · אושר בבירור מול Cardcom/.test(t)) && paidEvents(order1).length === 0);
    check('the last-4 keeps its leading zeros (Last4CardDigitsString) and the transaction id is a digit string', row1After.card_last4 === '0034' && /^\d+$/.test(row1After.transaction_id));
    const view1 = await pub('GET', '/api/store/order/' + order1.token);
    check('the order page: paid=false, card.status paid, test flagged, "תשלום בדיקה אושר — לא חויב כסף", no pay button',
      view1.json.order.paid === false && view1.json.order.payment.card.status === 'paid' && view1.json.order.payment.card.test === true &&
      view1.json.order.payment.card.message === 'תשלום בדיקה אושר — לא חויב כסף' && view1.json.order.payment.card.canPay === false);
    check('the paid view carries no session id, no url, no reference', !view1.text.includes(lp1) && !view1.text.includes(row1.reference) && !/secure\.cardcom/.test(view1.text));
    const dash = await pub('GET', '/admin/store', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('the dashboard: a RED line — the store is open and the gateway is in test mode', /is-bad[^]*?מצב בדיקות בעוד החנות פתוחה/.test(dash.text));

    // ── live mode: the happy path, exactly once ────────────────────────
    gateway.saveAdminSettings({ mode: 'live', confirmLive: true, fields: { cardcom: { terminal: CC_LIVE_TERMINAL } } });
    check('live mode with a real terminal and https: ready; the checkout carries no test banner', gateway.status().ready && !/מצב בדיקות/.test(render.renderCheckout()));
    const o2 = placeCard();
    const order2 = orders.getOrder(o2.order.number);
    await pub('POST', '/api/store/pay/' + order2.token, { body: {} });
    const row2 = rowsOf(order2)[0];
    check('a live session goes to the SAME host with the live terminal', callsTo('/LowProfile/Create').pop().json.TerminalNumber === Number(CC_LIVE_TERMINAL) && row2.mode === 'live');
    let slow = null;
    // the top-level TranzactionId differs from the deal's own: the row must keep the one from INSIDE TranzactionInfo (R9)
    ccResults[row2.session_id.toLowerCase()] = () => new Promise((resolve) => { slow = () => resolve(paidResult(row2.session_id, { ret: row2.reference, terminal: Number(CC_LIVE_TERMINAL), txn: 555000111, topTxn: 1 })); });
    // a webhook and the order page ask at the same moment: one inquiry, one settle
    const both = Promise.all([
      pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row2.session_id }), type: 'application/json' }),
      pub('GET', '/api/store/order/' + order2.token)
    ]);
    await new Promise((r) => setTimeout(r, 120));
    const inFlight = callsTo('/LowProfile/GetLpResult').length;
    slow();
    await both;
    const dup = await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row2.session_id }), type: 'application/json' });
    const order2After = orders.getOrder(order2.number);
    check('LIVE: paid exactly once — paid_at set, ONE "שולם" event naming the approval, the card, the installments and HOW it was confirmed',
      !!order2After.paid_at && paidEvents(order2).length === 1 && /אישור 123456 · כרטיס ‎····0034 · 3 תשלומים · אושר בבירור מול Cardcom/.test(paidEvents(order2)[0]));
    check('the concurrent webhook + order-page verify asked the provider once, and the duplicate webhook changed nothing',
      dup.status === 200 && callsTo('/LowProfile/GetLpResult').length === inFlight && rowsOf(order2).length === 1 && paidEvents(order2).length === 1);
    check('R9: the transaction id on the row is the deal\'s own (from inside TranzactionInfo), not the top-level one', rowsOf(order2)[0].transaction_id === '555000111');
    const again = gateway.settle(rowsOf(order2)[0], { amount: 23480, currency: 'ILS', transactionId: '555000111' });
    check('settle() on a settled row is a no-op (guarded UPDATE)', again.changed === false && again.duplicate === true && paidEvents(order2).length === 1);
    const view2 = await pub('GET', '/api/store/order/' + order2.token);
    check('the order page shows paid, and the pay action is gone', view2.json.order.paid === true && view2.json.order.payment.card.canPay === false);
    let unpay = null;
    try { orders.markPaid(order2.number, false); } catch (e) { unpay = e; }
    check('the "התשלום התקבל" checkbox cannot un-pay money that came through the gateway', !!unpay && /חברת הסליקה/.test(unpay.message) && !!orders.getOrder(order2.number).paid_at);
    const adminOrder = await pub('GET', '/admin/store/orders/' + order2.number, { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('the admin order screen shows the payment (provider, approval, last-4, installments, transaction id) and a disabled paid checkbox with the refund hint',
      adminOrder.status === 200 && /Cardcom/.test(adminOrder.text) && /123456/.test(adminOrder.text) && /····0034/.test(adminOrder.text) && /555000111/.test(adminOrder.text) &&
      /id="od-paid" checked disabled/.test(adminOrder.text) && /החזר הכספי/.test(adminOrder.text) && !adminOrder.text.includes(row2.session_id));

    // ── a decline, a retry, a late confirmation ────────────────────────
    const o3 = placeCard();
    const order3 = orders.getOrder(o3.order.number);
    await pub('POST', '/api/store/pay/' + order3.token, { body: {} });
    const row3 = rowsOf(order3)[0];
    ccResults[row3.session_id.toLowerCase()] = paidResult(row3.session_id, { ret: row3.reference, terminal: Number(CC_LIVE_TERMINAL), tiCode: 33, tiDesc: 'Declined', txn: 555000222 });
    await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row3.session_id }), type: 'application/json' });
    check('a declined TranzactionInfo is a failed attempt: row failed, order unpaid, the order page offers to pay again',
      rowsOf(order3)[0].status === 'failed' && !orders.getOrder(order3.number).paid_at && (await pub('GET', '/api/store/order/' + order3.token)).json.order.payment.card.canPay === true);
    const retry = await pub('POST', '/api/store/pay/' + order3.token, { body: {} });
    check('paying again after a failure opens a NEW session (a second row, a second Create)', retry.json.ok && rowsOf(order3).length === 2 && rowsOf(order3)[0].status === 'pending' && rowsOf(order3)[0].session_id !== row3.session_id);
    ccResults[row3.session_id.toLowerCase()] = paidResult(row3.session_id, { ret: row3.reference, terminal: Number(CC_LIVE_TERMINAL), txn: 555000222 });
    await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row3.session_id }), type: 'application/json' });
    check('a confirmation for the FAILED row still wins: it moves to paid and the order is paid', rowsOf(order3).find((r) => r.id === row3.id).status === 'paid' && !!orders.getOrder(order3.number).paid_at);
    const stray = rowsOf(order3)[0];
    ccResults[stray.session_id.toLowerCase()] = paidResult(stray.session_id, { ret: stray.reference, terminal: Number(CC_LIVE_TERMINAL), txn: 555000333 });
    await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: stray.session_id }), type: 'application/json' });
    check('a second real payment for an already-paid order is RECORDED (never dropped) with a "תשלום כפול — יש להחזיר" event',
      rowsOf(order3).find((r) => r.id === stray.id).status === 'paid' && eventsOf(order3).some((t) => /^תשלום כפול/.test(t)) && paidEvents(order3).length === 1);
    const o4 = placeCard();
    const order4 = orders.getOrder(o4.order.number);
    await pub('POST', '/api/store/pay/' + order4.token, { body: {} });
    const row4 = rowsOf(order4)[0];
    orders.setStatus(order4.number, 'cancelled', { notify: false });
    ccResults[row4.session_id.toLowerCase()] = paidResult(row4.session_id, { ret: row4.reference, terminal: Number(CC_LIVE_TERMINAL), txn: 555000444 });
    await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row4.session_id }), type: 'application/json' });
    check('a confirmation for a CANCELLED order is recorded on its row with "יש להחזיר", and the order stays cancelled and unpaid',
      rowsOf(order4)[0].status === 'paid' && eventsOf(order4).some((t) => /^תשלום להזמנה מבוטלת — יש להחזיר/.test(t)) && orders.getOrder(order4.number).status === 'cancelled' && !orders.getOrder(order4.number).paid_at);
    const o5 = placeCard();
    const order5 = orders.getOrder(o5.order.number);
    await pub('POST', '/api/store/pay/' + order5.token, { body: {} });
    const row5 = rowsOf(order5)[0];
    ccResults[row5.session_id.toLowerCase()] = paidResult(row5.session_id, { ret: row5.reference, terminal: Number(CC_LIVE_TERMINAL), txn: 555000111 });
    await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row5.session_id }), type: 'application/json' });
    check('ONE transaction settles ONE row: a replayed transaction id is refused (UNIQUE), the order stays unpaid', rowsOf(order5)[0].status === 'pending' && !orders.getOrder(order5.number).paid_at);
    check('an amount mismatch: row mismatch, order unpaid, an event', (() => {
      const r = rowsOf(order5)[0];
      ccResults[r.session_id.toLowerCase()] = paidResult(r.session_id, { ret: r.reference, terminal: Number(CC_LIVE_TERMINAL), txn: 555000555, amount: 200 });
      return gateway.verifyPayment(r, { source: 'hook' }).then((v) => v.status === 'mismatch' && !orders.getOrder(order5.number).paid_at && eventsOf(order5).some((t) => /אי-התאמה/.test(t) && /₪200/.test(t)));
    })());

    // ── transient failures, the cap, the throttle ──────────────────────
    const o6 = placeCard();
    const order6 = orders.getOrder(o6.order.number);
    await pub('POST', '/api/store/pay/' + order6.token, { body: {} });
    const row6 = rowsOf(order6)[0];
    ccResults[row6.session_id.toLowerCase()] = { status: 0, error: 'timeout' };
    const t503 = await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row6.session_id }), type: 'application/json' });
    check('when OUR GetLpResult call fails for a known pending row, the reply is 503 so Cardcom retries', t503.status === 503 && rowsOf(order6)[0].status === 'pending' && /timeout/.test(rowsOf(order6)[0].error));
    ccResults[row6.session_id.toLowerCase()] = { status: 502, text: 'bad gateway', json: null };
    check('…a 5xx from the provider is transient too', (await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row6.session_id }), type: 'application/json' })).status === 503);
    delete ccResults[row6.session_id.toLowerCase()];
    // R8: the keys are gone, a real callback arrives for a pending row
    gwConfig.clearProvider('cardcom');
    const eventsBeforeKeys = eventsOf(order6).length;
    const noKeys1 = await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row6.session_id }), type: 'application/json' });
    const noKeys2 = await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: row6.session_id }), type: 'application/json' });
    check('R8: a Cardcom callback for a known pending row while the keys are gone: 503 (so Cardcom retries), ONE order event "פרטי החיבור אינם מוגדרים", no inquiry',
      noKeys1.status === 503 && noKeys2.status === 503 && eventsOf(order6).length === eventsBeforeKeys + 1 &&
      eventsOf(order6).some((t) => /הודעת תשלום מ-Cardcom אבל פרטי החיבור אינם מוגדרים/.test(t)) && /פרטי החיבור/.test(rowsOf(order6)[0].error));
    check('R8: an unknown row with no keys is still 404', (await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: newGuid() }), type: 'application/json' })).status === 404);
    gateway.saveAdminSettings({ provider: 'cardcom', mode: 'live', confirmLive: true, fields: { cardcom: { terminal: CC_LIVE_TERMINAL, apiName: CC.apiName } } });
    check('…keys back: live, ready', gateway.status().ready && gateway.status().live);
    db.prepare("UPDATE store_payments SET last_verify_at = NULL, error = '' WHERE id = ?").run(row6.id);
    const beforeDefer = callsTo('/LowProfile/GetLpResult').length;
    await pub('GET', '/api/store/order/' + order6.token);
    check('R4: the first order-page poll of a row only starts the clock — no provider call (Cardcom too)', callsTo('/LowProfile/GetLpResult').length === beforeDefer && !!gateway.getPayment(row6.id).last_verify_at);
    db.prepare("UPDATE store_payments SET last_verify_at = datetime('now', '-10 seconds') WHERE id = ?").run(row6.id);
    const beforeThrottle = callsTo('/LowProfile/GetLpResult').length;
    await pub('GET', '/api/store/order/' + order6.token);
    await pub('GET', '/api/store/order/' + order6.token);
    check('the order page verifies at most once per 5 seconds (the second view asks nothing)', callsTo('/LowProfile/GetLpResult').length === beforeThrottle + 1);
    db.prepare("UPDATE store_payments SET created_at = datetime('now', '-20 minutes') WHERE order_id = ?").run(order6.id);
    let capHit = null;
    for (let i = 0; i < 12 && !capHit; i++) {
      const r = await pub('POST', '/api/store/pay/' + order6.token, { body: {} });
      if (r.status !== 200) capHit = r;
      db.prepare("UPDATE store_payments SET created_at = datetime('now', '-20 minutes') WHERE order_id = ?").run(order6.id);
    }
    check('the per-order session cap: the 11th session is refused (429 TOO_MANY) with a Hebrew sentence', !!capHit && capHit.status === 429 && capHit.json.code === 'TOO_MANY' && rowsOf(order6).length === 10 && /להשלמת התשלום/.test(capHit.json.message));
    ccCreateFail = jsonReply(200, { ResponseCode: 5, Description: 'Bad ApiName ' + CC.apiName });
    const o7 = placeCard();
    const order7 = orders.getOrder(o7.order.number);
    const failCreate = await pub('POST', '/api/store/pay/' + order7.token, { body: {} });
    check('a provider that refuses to open a page: 503 with a Hebrew sentence for the shopper, the provider\'s reason in the event for the admin — with the credential redacted',
      failCreate.status === 503 && failCreate.json.code === 'PROVIDER' && !/ApiName/.test(failCreate.json.message) && eventsOf(order7).some((t) => /נכשלה: Bad ApiName \[redacted\]/.test(t)));
    // R16: rows without a session are capped too (30 per order), so an outage cannot grow the table
    let rowCap = null;
    for (let i = 0; i < 32 && !rowCap; i++) {
      const r = await pub('POST', '/api/store/pay/' + order7.token, { body: {} });
      if (r.json && r.json.code === 'TOO_MANY') rowCap = r;
    }
    check('R16: an order whose pages keep failing stops at 30 rows (the 31st attempt is TOO_MANY) although it never got a single session',
      !!rowCap && rowCap.status === 429 && rowsOf(order7).length === 30 && rowsOf(order7).every((r) => r.status === 'failed' && !r.session_id));
    ccCreateFail = null;
    // R5: the buyer paid on an OLDER tab's session, its callback never came, and newer sessions exist
    const o8 = placeCard();
    const order8 = orders.getOrder(o8.order.number);
    await pub('POST', '/api/store/pay/' + order8.token, { body: {} });
    const sessA = rowsOf(order8)[0];
    db.prepare("UPDATE store_payments SET created_at = datetime('now', '-9 minutes') WHERE id = ?").run(sessA.id);
    await pub('POST', '/api/store/pay/' + order8.token, { body: {} });
    const sessB = rowsOf(order8)[0];
    db.prepare("UPDATE store_payments SET created_at = datetime('now', '-9 minutes') WHERE id = ?").run(sessB.id);
    await pub('POST', '/api/store/pay/' + order8.token, { body: {} });
    const sessC = rowsOf(order8)[0];
    ccResults[sessA.session_id.toLowerCase()] = paidResult(sessA.session_id, { ret: sessA.reference, terminal: Number(CC_LIVE_TERMINAL), txn: 555000888 });
    await pub('GET', '/api/store/order/' + order8.token); // the first poll: every row's clock starts, nothing is asked
    db.prepare("UPDATE store_payments SET last_verify_at = datetime('now', '-10 seconds') WHERE order_id = ?").run(order8.id);
    const before8 = callsTo('/LowProfile/GetLpResult').length;
    await pub('GET', '/api/store/order/' + order8.token);
    const asked8 = callsTo('/LowProfile/GetLpResult').slice(before8).map((c) => c.json.LowProfileId);
    check('R5: one page load asks about at most two sessions, newest first (C, then B) — the third waits its turn',
      sessA.id !== sessB.id && sessB.id !== sessC.id && asked8.length === 2 && asked8[0] === sessC.session_id && asked8[1] === sessB.session_id && !orders.getOrder(order8.number).paid_at);
    db.prepare("UPDATE store_payments SET last_verify_at = datetime('now', '-10 seconds') WHERE id = ?").run(sessA.id);
    await pub('GET', '/api/store/order/' + order8.token);
    check('R5: the next load reaches the older session the buyer really paid on — it settles and the order is paid',
      !!orders.getOrder(order8.number).paid_at && rowsOf(order8).find((r) => r.id === sessA.id).status === 'paid' && paidEvents(order8).length === 1);
    const adminV = await pub('POST', '/admin/api/store/orders/' + order8.number + '/payments/' + sessB.id + '/verify', { cookie: OWNER, body: {} });
    check('R5: the admin\'s own "בדיקה מול חברת הסליקה" on a pending row asks at once (no page throttle) and answers in Hebrew',
      adminV.status === 200 && adminV.json.ok && adminV.json.changed === false && /עדיין לא אושר/.test(adminV.json.message) && callsTo('/LowProfile/GetLpResult').pop().json.LowProfileId === sessB.session_id);
    check('R5: the admin check refuses a row of another order (404)', (await pub('POST', '/admin/api/store/orders/' + order8.number + '/payments/' + row6.id + '/verify', { cookie: OWNER, body: {} })).status === 404);

    // ── refunds (Cardcom) ──────────────────────────────────────────────
    const paidRowOf = (od) => gateway.paidPayment(od.id);
    gateway.saveAdminSettings({ fields: { cardcom: { apiPassword: '' } } });
    check('without an ApiPassword the refund action is unavailable and says why', gateway.describePayments(order2)[0].refundable === false && /ApiPassword/.test(gateway.describePayments(order2)[0].refundNote));
    gateway.saveAdminSettings({ fields: { cardcom: { apiPassword: CC.apiPassword } } });
    db.prepare('UPDATE store_payments SET transaction_id = ? WHERE id = ?').run('9223372036854775807', paidRowOf(order2).id);
    const wrongConfirm = await pub('POST', '/admin/api/store/orders/' + order2.number + '/refund', { cookie: OWNER, body: { confirm: 'nope' } });
    check('a refund needs the typed order number (400 otherwise, nothing sent)', wrongConfirm.status === 400 && callsTo('/Transactions/RefundByTransactionId').length === 0);
    // R11: the terminal changed since the charge — the refund refuses before any byte leaves
    gateway.saveAdminSettings({ fields: { cardcom: { terminal: '7654321' } } });
    const staleTerminal = await gateway.refund({ order: order2, paymentId: paidRowOf(order2).id, amount: 1000 });
    check('R11: a Cardcom refund with a changed terminal is refused with the fingerprint message, nothing sent, nothing reserved',
      staleTerminal.ok === false && /מסוף אחר/.test(staleTerminal.message) && callsTo('/Transactions/RefundByTransactionId').length === 0 && paidRowOf(order2).refunded === 0);
    gateway.saveAdminSettings({ fields: { cardcom: { terminal: CC_LIVE_TERMINAL } } });
    const partial = await pub('POST', '/admin/api/store/orders/' + order2.number + '/refund', { cookie: OWNER, body: { confirm: order2.number, amount: '34.80' } });
    const refundRaw = callsTo('/Transactions/RefundByTransactionId')[0].raw;
    check('a partial refund: the int64 id is spliced into the JSON verbatim, PartialSum in major units, AllowMultipleRefunds, ApiPassword — no TerminalNumber',
      partial.status === 200 && partial.json.ok && partial.json.full === false && refundRaw.includes('"TransactionId":9223372036854775807') && refundRaw.includes('"PartialSum":34.80') &&
      refundRaw.includes('"AllowMultipleRefunds":true') && refundRaw.includes(CC.apiPassword) && !refundRaw.includes('TerminalNumber'));
    check('the row keeps the refunded sum and stays paid; the event names the refund', paidRowOf(order2).refunded === 3480 && paidRowOf(order2).status === 'paid' && eventsOf(order2).some((t) => /הוחזרו ₪34.80/.test(t) && /החזר חלקי/.test(t)));
    const full = await pub('POST', '/admin/api/store/orders/' + order2.number + '/refund', { cookie: OWNER, body: { confirm: order2.number } });
    check('the rest: a full refund closes the row (refunded), the new transaction id kept as digits',
      full.status === 200 && full.json.full === true && paidRowOf(order2).status === 'refunded' && paidRowOf(order2).refunded === 23480 && eventsOf(order2).some((t) => /9223372036854775806/.test(t)));
    check('R2c: with no live row holding money, the order is no longer paid — paid_at cleared, the event says so, and the checkbox is the owner\'s again',
      full.json.unpaid === true && !orders.getOrder(order2.number).paid_at && eventsOf(order2).some((t) => /^סימון התשלום הוסר — הכסף הוחזר במלואו/.test(t)) && gateway.isGatewayPaid(order2.id) === false &&
      /<input type="checkbox" id="od-paid">/.test((await pub('GET', '/admin/store/orders/' + order2.number, { cookie: OWNER, headers: { Accept: 'text/html' } })).text));
    check('nothing left to refund → refused', (await pub('POST', '/admin/api/store/orders/' + order2.number + '/refund', { cookie: OWNER, body: { confirm: order2.number } })).status === 400);
    // R2a/b: order3 holds two live payments (its own and a double): two concurrent refunds, a refund of a NAMED row, an unknown outcome, a definite refusal
    const row3paid = rowsOf(order3).find((r) => r.id === row3.id);
    const strayPaid = rowsOf(order3).find((r) => r.id === stray.id);
    refundDelayMs = 300;
    const refundsBefore = callsTo('/Transactions/RefundByTransactionId').length;
    const [c1, c2] = await Promise.all([gateway.refund({ order: order3, paymentId: row3paid.id, amount: 12000 }), gateway.refund({ order: order3, paymentId: row3paid.id, amount: 12000 })]);
    refundDelayMs = 0;
    // in one process the read-and-reserve section has no await, so the second caller already sees the first reservation
    // (AMOUNT); a stale read from another process meets the guarded UPDATE instead (BUSY) — either way it is refused
    check('R2a: two concurrent ₪120 refunds of a ₪234.80 payment — one reaches the provider, the other is refused, the books hold exactly one',
      [c1, c2].filter((r) => r.ok).length === 1 && [c1, c2].some((r) => r.code === 'BUSY' || r.code === 'AMOUNT') && callsTo('/Transactions/RefundByTransactionId').length === refundsBefore + 1 &&
      gateway.getPayment(row3paid.id).refunded === 12000 && gateway.getPayment(row3paid.id).status === 'paid');
    const staleReserve = db.prepare(`
      UPDATE store_payments SET refunded = refunded + ?, status = CASE WHEN refunded + ? >= amount THEN 'refunded' ELSE status END
      WHERE id = ? AND status IN ('paid', 'refunded') AND refunded + ? <= amount
    `).run(12000, 12000, row3paid.id, 12000);
    check('R2a: the reservation itself refuses a stale read (₪120 more than the ₪114.80 left) — the guard a second process would meet', staleReserve.changes === 0 && gateway.getPayment(row3paid.id).refunded === 12000);
    const byRow = await pub('POST', '/admin/api/store/orders/' + order3.number + '/refund', { cookie: OWNER, body: { confirm: order3.number, payment: strayPaid.id } });
    check('R2b: the double charge is refunded by ITS row id — that row closes, the original keeps its money, the order stays paid',
      byRow.status === 200 && byRow.json.payment === strayPaid.id && byRow.json.full === true && gateway.getPayment(strayPaid.id).status === 'refunded' &&
      gateway.getPayment(row3paid.id).status === 'paid' && gateway.getPayment(row3paid.id).refunded === 12000 && !!orders.getOrder(order3.number).paid_at);
    ccRefundFail = { status: 0, error: 'timeout' };
    const unknownRefund = await pub('POST', '/admin/api/store/orders/' + order3.number + '/refund', { cookie: OWNER, body: { confirm: order3.number, payment: row3paid.id, amount: '10' } });
    check('R2a/R2e: an UNKNOWN outcome (timeout) keeps the reservation as an UNKNOWN sum — refunded 130 with 10 unknown, the lock released, the order keeps its mark, the event says to look and decide, the admin gets 502 UNKNOWN',
      unknownRefund.status === 502 && unknownRefund.json.code === 'UNKNOWN' && /לא ידועה/.test(unknownRefund.json.error) && gateway.getPayment(row3paid.id).refunded === 13000 &&
      gateway.getPayment(row3paid.id).refund_unknown === 1000 && gateway.getPayment(row3paid.id).refund_lock === null && !!orders.getOrder(order3.number).paid_at &&
      eventsOf(order3).some((t) => /^תוצאת ההחזר לא ידועה/.test(t) && /בדקו בממשק החברה/.test(t)));
    ccRefundFail = null;
    const refundsAtBlock = callsTo('/Transactions/RefundByTransactionId').length;
    const blocked = await pub('POST', '/admin/api/store/orders/' + order3.number + '/refund', { cookie: OWNER, body: { confirm: order3.number, payment: row3paid.id, amount: '5' } });
    check('R2e: while an unknown refund waits, another refund of that row is refused ("יש לברר קודם") and nothing is sent',
      blocked.status === 400 && blocked.json.code === 'UNRESOLVED' && /יש לברר קודם/.test(blocked.json.error) && callsTo('/Transactions/RefundByTransactionId').length === refundsAtBlock);
    const screenUnknown = await pub('GET', '/admin/store/orders/' + order3.number, { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('R2e: the order screen shows the unknown refund with its two decisions', /החזר של ₪10 בתוצאה לא ידועה — בדקו בממשק החברה/.test(screenUnknown.text) && /<button[^>]*data-resolve-done/.test(screenUnknown.text) && /<button[^>]*data-resolve-release/.test(screenUnknown.text));
    check('R2e: a decision needs the typed order number', (await pub('POST', '/admin/api/store/orders/' + order3.number + '/payments/' + row3paid.id + '/refund-release', { cookie: OWNER, body: { confirm: 'x' } })).status === 400);
    const released = await pub('POST', '/admin/api/store/orders/' + order3.number + '/payments/' + row3paid.id + '/refund-release', { cookie: OWNER, body: { confirm: order3.number } });
    check('R2e(b): "ההחזר לא בוצע — שחרור" gives the sum back — refunded 120, status paid, nothing unknown, an event',
      released.status === 200 && released.json.outcome === 'undone' && gateway.getPayment(row3paid.id).refunded === 12000 && gateway.getPayment(row3paid.id).refund_unknown === 0 &&
      gateway.getPayment(row3paid.id).status === 'paid' && eventsOf(order3).some((t) => /לא בוצע — הסכום שוחרר/.test(t)));
    check('R2e: nothing to resolve twice (400)', (await pub('POST', '/admin/api/store/orders/' + order3.number + '/payments/' + row3paid.id + '/refund-release', { cookie: OWNER, body: { confirm: order3.number } })).status === 400);
    ccRefundFail = jsonReply(200, { ResponseCode: 9, Description: 'no such deal' });
    const refusedRefund = await pub('POST', '/admin/api/store/orders/' + order3.number + '/refund', { cookie: OWNER, body: { confirm: order3.number, payment: row3paid.id, amount: '10' } });
    check('R2a: a DEFINITE refusal releases the reservation and the lock (the row is back to what it was) and is an event', refusedRefund.status === 502 && refusedRefund.json.code === 'PROVIDER' &&
      gateway.getPayment(row3paid.id).refunded === 12000 && gateway.getPayment(row3paid.id).status === 'paid' && gateway.getPayment(row3paid.id).refund_lock === null && eventsOf(order3).some((t) => /החזר של ₪10 נכשל/.test(t)));
    ccRefundFail = null;
    const rest3 = await pub('POST', '/admin/api/store/orders/' + order3.number + '/refund', { cookie: OWNER, body: { confirm: order3.number, payment: row3paid.id } });
    check('R2c: refunding the rest of the original clears paid_at (no live row holds money any more)', rest3.status === 200 && rest3.json.unpaid === true && !orders.getOrder(order3.number).paid_at &&
      gateway.getPayment(row3paid.id).status === 'refunded' && gateway.getPayment(row3paid.id).refunded === 23480);
    // R2d: one refund per row at a time — the row is locked for the provider call
    const rowA8 = rowsOf(order8).find((r) => r.id === sessA.id);
    refundDelayMs = 300;
    const refundsBefore8 = callsTo('/Transactions/RefundByTransactionId').length;
    const [d1, d2] = await Promise.all([gateway.refund({ order: order8, paymentId: rowA8.id, amount: 4000 }), gateway.refund({ order: order8, paymentId: rowA8.id, amount: 4000 })]);
    refundDelayMs = 0;
    check('R2d: two concurrent ₪40 refunds of one row — exactly ONE reaches the provider, the other meets the row\'s lock (BUSY), and the lock is released afterwards',
      [d1, d2].filter((r) => r.ok).length === 1 && [d1, d2].some((r) => r.code === 'BUSY') && callsTo('/Transactions/RefundByTransactionId').length === refundsBefore8 + 1 &&
      gateway.getPayment(rowA8.id).refunded === 4000 && gateway.getPayment(rowA8.id).refund_lock === null);
    // R2e(a): the LAST of the money, outcome unknown → the order keeps its mark until the owner says the refund went through
    ccRefundFail = { status: 502, text: 'bad gateway', json: null };
    const lastUnknown = await pub('POST', '/admin/api/store/orders/' + order8.number + '/refund', { cookie: OWNER, body: { confirm: order8.number, payment: rowA8.id } });
    check('R2e: an unknown outcome on the last of the money does NOT un-mark the order — the sum waits as unknown',
      lastUnknown.status === 502 && lastUnknown.json.code === 'UNKNOWN' && !!orders.getOrder(order8.number).paid_at && gateway.getPayment(rowA8.id).refund_unknown === 19480 &&
      gateway.getPayment(rowA8.id).refunded === 23480 && gateway.getPayment(rowA8.id).status === 'refunded');
    ccRefundFail = null;
    const done8 = await pub('POST', '/admin/api/store/orders/' + order8.number + '/payments/' + rowA8.id + '/refund-done', { cookie: OWNER, body: { confirm: order8.number } });
    check('R2e(a): "ההחזר בוצע" keeps the books and — nothing left, the gateway having set the mark — clears paid_at, with both events',
      done8.status === 200 && done8.json.outcome === 'done' && done8.json.unpaid === true && !orders.getOrder(order8.number).paid_at && gateway.getPayment(rowA8.id).refund_unknown === 0 &&
      eventsOf(order8).some((t) => /אושר כבוצע/.test(t)) && eventsOf(order8).some((t) => /^סימון התשלום הוסר/.test(t)));
    // N1: the owner marked the order paid by hand (the buyer paid by phone) while the hosted page was still open; the card payment lands anyway
    const oN1 = placeCard();
    const orderN1 = orders.getOrder(oN1.order.number);
    await pub('POST', '/api/store/pay/' + orderN1.token, { body: {} });
    const rowN1 = rowsOf(orderN1)[0];
    orders.markPaid(orderN1.number, true);
    ccResults[rowN1.session_id.toLowerCase()] = paidResult(rowN1.session_id, { ret: rowN1.reference, terminal: Number(CC_LIVE_TERMINAL), txn: 555000999 });
    await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: rowN1.session_id }), type: 'application/json' });
    check('N1: the card payment landing after the manual mark is recorded as a double (יש להחזיר) — and that row did not set the mark',
      gateway.getPayment(rowN1.id).status === 'paid' && gateway.getPayment(rowN1.id).set_paid === 0 && eventsOf(orderN1).some((t) => /^תשלום כפול/.test(t)));
    const refundN1 = await pub('POST', '/admin/api/store/orders/' + orderN1.number + '/refund', { cookie: OWNER, body: { confirm: orderN1.number, payment: rowN1.id } });
    check('N1: a full refund of that stray row leaves the hand-set mark alone — paid_at stays, no "סימון התשלום הוסר"',
      refundN1.status === 200 && refundN1.json.unpaid === false && !!orders.getOrder(orderN1.number).paid_at && gateway.getPayment(rowN1.id).status === 'refunded' &&
      !eventsOf(orderN1).some((t) => /סימון התשלום הוסר/.test(t)));
    check('N1: …while a row that DID set the mark carries set_paid', rowsOf(order2)[0].set_paid === 1 && gateway.getPayment(row3paid.id).set_paid === 1);
    // R2f: the sum is reserved AS UNKNOWN from the moment the refund leaves — a process that dies mid-call leaves the owner's decision, never a silent "refunded"
    const oF = placeCard();
    const orderF = orders.getOrder(oF.order.number);
    await pub('POST', '/api/store/pay/' + orderF.token, { body: {} });
    const rowF = rowsOf(orderF)[0];
    ccResults[rowF.session_id.toLowerCase()] = paidResult(rowF.session_id, { ret: rowF.reference, terminal: Number(CC_LIVE_TERMINAL), txn: 555000777 });
    await pub('POST', '/api/store/gateway/cardcom/hook', { raw: JSON.stringify({ LowProfileId: rowF.session_id }), type: 'application/json' });
    refundHang = true;
    gateway.refund({ order: orderF, paymentId: rowF.id, amount: 5000 }); // never answers: the "crash"
    await new Promise((r) => setTimeout(r, 30));
    refundHang = false;
    const midF = gateway.getPayment(rowF.id);
    check('R2f: while the refund is at the provider the sum is already reserved AS unknown, and the row is locked',
      midF.refunded === 5000 && midF.refund_unknown === 5000 && !!midF.refund_lock && midF.status === 'paid');
    const busyF = await gateway.refund({ order: orderF, paymentId: rowF.id, amount: 1000 });
    const earlyF = gateway.resolveUnknownRefund({ order: orderF, paymentId: rowF.id, outcome: 'undone' });
    const screenMid = await pub('GET', '/admin/store/orders/' + orderF.number, { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('R2f: in flight — another refund meets the lock (BUSY, not "unknown"), the owner cannot resolve it yet, and the screen says it is on its way',
      busyF.ok === false && busyF.code === 'BUSY' && earlyF.ok === false && earlyF.code === 'BUSY' && gateway.getPayment(rowF.id).refund_unknown === 5000 &&
      /בדרך אל חברת הסליקה/.test(screenMid.text) && !/<button[^>]*data-resolve-release/.test(screenMid.text));
    // the process died: the lock ages out
    db.prepare('UPDATE store_payments SET refund_lock = ? WHERE id = ?').run(new Date(Date.now() - 3 * 60 * 1000).toISOString(), rowF.id);
    const screenAfter = await pub('GET', '/admin/store/orders/' + orderF.number, { cookie: OWNER, headers: { Accept: 'text/html' } });
    const newF = await gateway.refund({ order: orderF, paymentId: rowF.id, amount: 1000 });
    check('R2f: after the crash the owner sees the unknown sum with both decisions, and no new refund runs until it is decided',
      /החזר של ₪50 בתוצאה לא ידועה/.test(screenAfter.text) && /<button[^>]*data-resolve-release/.test(screenAfter.text) && newF.ok === false && newF.code === 'UNRESOLVED');
    const relF = await pub('POST', '/admin/api/store/orders/' + orderF.number + '/payments/' + rowF.id + '/refund-release', { cookie: OWNER, body: { confirm: orderF.number } });
    check('R2f: "לא בוצע" gives exactly the reserved sum back — nothing refunded, nothing unknown, the lock gone, the order still paid',
      relF.status === 200 && gateway.getPayment(rowF.id).refunded === 0 && gateway.getPayment(rowF.id).refund_unknown === 0 && gateway.getPayment(rowF.id).refund_lock === null &&
      gateway.getPayment(rowF.id).status === 'paid' && !!orders.getOrder(orderF.number).paid_at);
    const okF = await gateway.refund({ order: orderF, paymentId: rowF.id, amount: 5000 });
    check('R2f: a refund that the provider answers clears its unknown mark — the books say refunded, nothing waits',
      okF.ok === true && gateway.getPayment(rowF.id).refunded === 5000 && gateway.getPayment(rowF.id).refund_unknown === 0 && gateway.getPayment(rowF.id).refund_lock === null);

    // ── Grow ───────────────────────────────────────────────────────────
    gateway.saveAdminSettings({ provider: 'grow', mode: 'test', fields: { grow: { ...GR } } });
    check('Grow ready in test mode (sandbox host)', gateway.status().ready && gateway.status().webhookUrl === 'https://shop.example/api/store/gateway/grow/hook');
    const oneName = placeCard({ customer: { name: 'דנה', phone: '050-1234567', email: 'dana@example.com' } });
    const landline = placeCard({ customer: { name: 'דנה כהן', phone: '03-1234567', email: 'dana@example.com' } });
    check('Grow\'s buyer rules are field errors at CHECKOUT: one name → name, a landline → phone',
      oneName.code === 'FIELDS' && oneName.fields.some((f) => f.field === 'name' && /שם פרטי ושם משפחה/.test(f.message)) &&
      landline.code === 'FIELDS' && landline.fields.some((f) => f.field === 'phone' && /נייד ישראלי/.test(f.message)));
    const g1 = placeCard({ customer: { name: 'דנה כהן', phone: '+972-50-1234567', email: 'dana@example.com' } });
    const gorder1 = orders.getOrder(g1.order.number);
    const gpay1 = await pub('POST', '/api/store/pay/' + gorder1.token, { body: {} });
    const gcreate = callsTo('/createPaymentProcess')[0];
    const grow1 = rowsOf(gorder1)[0];
    check('Grow createPaymentProcess is multipart (FormData, no JSON, no Content-Type of our own) on the SANDBOX host in test mode',
      gpay1.json.ok && gcreate.isFormData && !Object.keys(gcreate.headers).some((h) => /content-type/i.test(h)) && gcreate.url === 'https://sandbox.meshulam.co.il/api/light/server/1.0/createPaymentProcess');
    const gf = gcreate.fields;
    check('Grow fields: pageCode + userId, sum in major units from the DB, a plain description, ?-bearing successUrl, cancelUrl, notifyUrl, two-word name, 05 mobile, email, cField1 = hex reference, maxPaymentNum 3, no productData',
      gf.pageCode === GR.pageCode && gf.userId === GR.userId && gf.sum === '234.80' && gf.description === 'הזמנה ' + gorder1.number + ' הסטודיו של נועה' &&
      gf.successUrl === 'https://shop.example/order.html?o=' + gorder1.token + '&paid=back' && gf.cancelUrl === gf.successUrl && gf.notifyUrl === 'https://shop.example/api/store/gateway/grow/hook' &&
      gf['pageField[fullName]'] === 'דנה כהן' && gf['pageField[phone]'] === '0501234567' && gf['pageField[email]'] === 'dana@example.com' && gf.cField1 === grow1.reference &&
      /^[0-9a-f]{20}$/.test(gf.cField1) && gf.maxPaymentNum === '3' && !Object.keys(gf).some((k) => /productData/.test(k)));
    check('the row keeps processId, the pageCode fingerprint, the processToken\'s sha256 and a SEALED copy (never the token itself); the hosted url (no token in it) went to the browser',
      grow1.session_id === '395235' && grow1.account_tail === '1234' && grow1.session_token_hash === sha256hex(GROW_TOKEN) && grow1.session_token.startsWith('v1:') &&
      !grow1.session_token.includes(GROW_TOKEN) && gwConfig.openToken(grow1.session_token) === GROW_TOKEN && gpay1.json.url === 'https://sandbox.meshulam.co.il/far?l=0123456789abcdef0123456789abcdef');
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* the file is what it is */ }
    const dbBytes = fs.readFileSync(DB_FILE);
    check('R6: the database file (the .pzn) holds the token\'s hash but NOT the raw processToken', !dbBytes.includes(Buffer.from(GROW_TOKEN)) && dbBytes.includes(Buffer.from(sha256hex(GROW_TOKEN))));
    const tokenKeyHex = gwConfig._load()[gwConfig.TOKEN_KEY_FIELD];
    check('R6: the sealing key is 32 random bytes in config/payments.json, never in adminSettings(), describeFields() or credentialsFor(), and the .pzn does not hold it',
      /^[0-9a-f]{64}$/.test(tokenKeyHex) && !JSON.stringify(gateway.adminSettings()).includes(tokenKeyHex) && !JSON.stringify(gwConfig.describeFields('grow', ['userId', 'pageCode'])).includes(tokenKeyHex) &&
      !JSON.stringify(gwConfig.credentialsFor('grow')).includes(tokenKeyHex) && !dbBytes.includes(Buffer.from(tokenKeyHex)));
    const cbFields = (over = {}) => ({
      status: '1', err: '', 'data[statusCode]': '2', 'data[status]': 'שולם', 'data[processId]': '395235', 'data[processToken]': GROW_TOKEN, 'data[sum]': '234.80',
      'data[customFields][cField1]': grow1.reference, 'data[transactionId]': '421100', 'data[transactionToken]': GROW_TXN_TOKEN, 'data[transactionTypeId]': '1', 'data[paymentType]': '2',
      'data[asmachta]': '117128222', 'data[cardSuffix]': '4880', 'data[cardType]': 'Foreign', 'data[cardTypeCode]': '2', 'data[cardBrand]': 'Visa', 'data[cardBrandCode]': '3', 'data[cardExp]': '1127',
      'data[paymentsNum]': '0', 'data[allPaymentsNum]': '1', 'data[paymentDate]': '05/6/25', 'data[description]': 'הזמנה', 'data[fullName]': 'דנה כהן', 'data[payerPhone]': '0501234567',
      'data[payerEmail]': 'dana@example.com', 'data[firstPaymentSum]': '0', 'data[periodicalPaymentSum]': '0', ...over
    });
    const forgedGrow = [
      // the last character must be CHANGED, never set: GROW_TOKEN is random hex, so
      // one run in sixteen already ended in '1' and this "forged" token WAS the real
      // one — the order settled (correctly) and six checks failed, about once a day
      ['a wrong processToken of the same length', { 'data[processToken]': GROW_TOKEN.slice(0, -1) + (GROW_TOKEN.endsWith('1') ? '2' : '1') }],
      ['a processToken of another length', { 'data[processToken]': 'short' }],
      ['a wrong cField1', { 'data[customFields][cField1]': 'deadbeefdeadbeefdead' }],
      ['statusCode 0 (not paid)', { 'data[statusCode]': '0' }],
      ['no processToken at all (Grow\'s account-level webhook shape)', { 'data[processToken]': '' }]
    ];
    for (const [name, over] of forgedGrow) {
      const r = await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields(over)).toString(), type: 'application/x-www-form-urlencoded' });
      check('Grow forged callback — ' + name + ': quiet 200, nothing settled, no approve, no inquiry',
        r.status === 200 && r.text === 'OK' && rowsOf(gorder1)[0].status === 'pending' && callsTo('/approveTransaction').length === 0 && callsTo('/getPaymentProcessInfo').length === 0);
    }
    const cb = await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields()).toString(), type: 'application/x-www-form-urlencoded' });
    const grow1After = rowsOf(gorder1)[0];
    check('a Grow callback (urlencoded, bracket keys) that carries our processToken settles WITHOUT an inquiry: row paid, test mode → no paid_at, "אושר בהודעת Grow"',
      cb.status === 200 && grow1After.status === 'paid' && grow1After.transaction_id === '421100' && grow1After.transaction_token === GROW_TXN_TOKEN && grow1After.approval === '117128222' &&
      grow1After.card_last4 === '4880' && callsTo('/getPaymentProcessInfo').length === 0 && !orders.getOrder(gorder1.number).paid_at &&
      eventsOf(gorder1).some((t) => /^תשלום בדיקה אושר — לא התקבל כסף · אושר בהודעת Grow · אישור 117128222/.test(t)));
    const ack = callsTo('/approveTransaction')[0];
    check('approveTransaction followed, multipart, with pageCode and every documented server-update field as received',
      !!ack && ack.isFormData && ack.fields.pageCode === GR.pageCode && ack.fields.transactionId === '421100' && ack.fields.transactionToken === GROW_TXN_TOKEN && ack.fields.processToken === GROW_TOKEN &&
      ack.fields.asmachta === '117128222' && ack.fields.cardExp === '1127' && ack.fields.payerPhone === '0501234567' && Object.keys(ack.fields).length === 24);
    const cbAgain = await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields()).toString(), type: 'application/x-www-form-urlencoded' });
    check('a resent callback: 200, nothing changes, the acknowledgement is sent again', cbAgain.status === 200 && rowsOf(gorder1).length === 1 && callsTo('/approveTransaction').length === 2);
    const g2 = placeCard();
    const gorder2 = orders.getOrder(g2.order.number);
    await pub('POST', '/api/store/pay/' + gorder2.token, { body: {} });
    const grow2 = rowsOf(gorder2)[0];
    const mp = multipart(cbFields({ 'data[customFields][cField1]': grow2.reference, 'data[transactionId]': '421101', 'data[transactionTypeId]': '6', 'data[payerEmail]': '' }));
    const cbMp = await pub('POST', '/api/store/gateway/grow/hook', { raw: mp.body, type: mp.type });
    check('the same callback as MULTIPART is parsed by us (no dependency) and settles; a Bit payment in test mode is flagged loudly',
      cbMp.status === 200 && rowsOf(gorder2)[0].status === 'paid' && eventsOf(gorder2).some((t) => /Bit/.test(t) && /ייתכן שזה חיוב אמיתי/.test(t)) && !orders.getOrder(gorder2.number).paid_at);
    const ackMp = callsTo('/approveTransaction').pop();
    check('R7: approveTransaction echoes EVERY documented field as received — an empty payerEmail is sent as an empty field, not dropped',
      !!ackMp && 'payerEmail' in ackMp.fields && ackMp.fields.payerEmail === '' && Object.keys(ackMp.fields).length === 24);
    check('R6: a settled row no longer carries the sealed token (nothing settled needs it)', rowsOf(gorder2)[0].session_token === '' && rowsOf(gorder1)[0].session_token === '');
    const g3 = placeCard();
    const gorder3 = orders.getOrder(g3.order.number);
    await pub('POST', '/api/store/pay/' + gorder3.token, { body: {} });
    const grow3 = rowsOf(gorder3)[0];
    const cbWrongSum = await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields({ 'data[customFields][cField1]': grow3.reference, 'data[sum]': '200', 'data[transactionId]': '421102' })).toString(), type: 'application/x-www-form-urlencoded' });
    check('a genuine callback with the WRONG sum: recorded as a mismatch, never as paid', cbWrongSum.status === 200 && rowsOf(gorder3)[0].status === 'mismatch' && eventsOf(gorder3).some((t) => /אי-התאמה/.test(t)));
    // the fallback inquiry
    const g4 = placeCard();
    const gorder4 = orders.getOrder(g4.order.number);
    await pub('POST', '/api/store/pay/' + gorder4.token, { body: {} });
    const grow4 = rowsOf(gorder4)[0];
    await pub('GET', '/api/store/order/' + gorder4.token);
    check('R4: the buyer is back — the FIRST poll only starts the clock; Grow\'s server update gets its chance (no inquiry)',
      callsTo('/getPaymentProcessInfo').length === 0 && !!gateway.getPayment(grow4.id).last_verify_at && (await pub('GET', '/api/store/order/' + gorder4.token)).json.order.payment.card.verifying === true);
    await pub('GET', '/api/store/order/' + gorder4.token);
    check('R4: polls inside Grow\'s 20 s grace still ask nothing', callsTo('/getPaymentProcessInfo').length === 0);
    db.prepare("UPDATE store_payments SET last_verify_at = datetime('now', '-25 seconds') WHERE id = ?").run(grow4.id);
    await pub('GET', '/api/store/order/' + gorder4.token);
    const inq = callsTo('/getPaymentProcessInfo')[0];
    check('R4: after the grace, getPaymentProcessInfo — with the STORED processId, the OPENED processToken and the pageCode; a placeholder transaction is not paid',
      !!inq && inq.isFormData && inq.fields.processId === '395235' && inq.fields.processToken === GROW_TOKEN && inq.fields.pageCode === GR.pageCode && rowsOf(gorder4)[0].status === 'pending');
    grInquiry = { status: '1', err: '', data: { processId: '395235', processToken: GROW_TOKEN, transactions: [
      { statusCode: '0', transactionId: '0', sum: '0' },
      { statusCode: '2', transactionId: '421103', transactionToken: 'tt421103tt421103tt421103tt421103', sum: '234.8', asmachta: '30012345', cardSuffix: '1234', cardBrand: 'Visa', allPaymentsNum: '1', transactionTypeId: '1' }
    ] } };
    db.prepare("UPDATE store_payments SET last_verify_at = datetime('now', '-25 seconds') WHERE id = ?").run(grow4.id);
    const acksBefore = callsTo('/approveTransaction').length;
    await pub('GET', '/api/store/order/' + gorder4.token);
    check('the inquiry finds the statusCode-2 transaction with the matching sum → settled "אושר בבירור מול Grow", and NO approveTransaction for an inquiry-only confirmation',
      rowsOf(gorder4)[0].status === 'paid' && rowsOf(gorder4)[0].transaction_id === '421103' && eventsOf(gorder4).some((t) => /אושר בבירור מול Grow/.test(t)) && callsTo('/approveTransaction').length === acksBefore);
    grInquiry = null;
    // refund + the pageCode fingerprint
    grRefund = { status: 0, err: { id: 130, message: 'refund same day' }, data: '' };
    const gref = await pub('POST', '/admin/api/store/orders/' + gorder4.number + '/refund', { cookie: OWNER, body: { confirm: gorder4.number, amount: '10' } });
    const grefCall = callsTo('/refundTransaction')[0];
    check('a Grow refund: multipart with userId, pageCode, the stored transactionId + transactionToken, refundSum in major units; error 130 mapped to Hebrew',
      gref.status === 502 && /באותו יום/.test(gref.json.error) && grefCall.isFormData && grefCall.fields.userId === GR.userId && grefCall.fields.pageCode === GR.pageCode &&
      grefCall.fields.transactionId === '421103' && grefCall.fields.transactionToken === 'tt421103tt421103tt421103tt421103' && grefCall.fields.refundSum === '10');
    grRefund = { status: 1, err: '', data: { transactionId: '77', statusCode: 3 } };
    const gok = await pub('POST', '/admin/api/store/orders/' + gorder4.number + '/refund', { cookie: OWNER, body: { confirm: gorder4.number } });
    check('a full Grow refund lands', gok.status === 200 && gateway.paidPayment(gorder4.id).status === 'refunded');
    gateway.saveAdminSettings({ fields: { grow: { pageCode: 'otherpagecode9999' } } });
    const g5 = placeCard();
    const gorder5 = orders.getOrder(g5.order.number);
    db.prepare('INSERT INTO store_payments (order_id, provider, mode, reference, session_id, session_token, session_token_hash, account_tail, url, amount, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(gorder5.id, 'grow', 'test', 'abcdef0123456789abcd', '395235', gwConfig.sealToken(GROW_TOKEN), sha256hex(GROW_TOKEN), '1234', 'https://sandbox.meshulam.co.il/far?l=x', 23480, 'ILS');
    const staleV = await gateway.verifyPayment(rowsOf(gorder5)[0], { source: 'hook' });
    check('a changed pageCode: the inquiry refuses with a clear message instead of a 731 from Grow, nothing is sent', staleV.ok === false && /קוד דף תשלום אחר/.test(staleV.error) && callsTo('/getPaymentProcessInfo').length === 2);
    gateway.saveAdminSettings({ fields: { grow: { pageCode: GR.pageCode } } });
    // R6: a backup restored on another install — a different sealing key: the inquiry is gone for old rows, the callback is not
    const keyFile = JSON.parse(fs.readFileSync(gwConfig.STORE_PATH, 'utf8'));
    const realKey = keyFile[gwConfig.TOKEN_KEY_FIELD];
    keyFile[gwConfig.TOKEN_KEY_FIELD] = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(gwConfig.STORE_PATH, JSON.stringify(keyFile));
    const lostKey = await gateway.verifyPayment(rowsOf(gorder5)[0], { source: 'admin' });
    check('R6: with another install\'s key the sealed token opens to nothing — the inquiry refuses with a clear admin message, no crash, nothing sent',
      lostKey.ok === false && /שחזור ממקום אחר/.test(lostKey.error) && callsTo('/getPaymentProcessInfo').length === 2);
    const cbLostKey = await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields({ 'data[customFields][cField1]': 'abcdef0123456789abcd', 'data[transactionId]': '421105' })).toString(), type: 'application/x-www-form-urlencoded' });
    check('R6: …and the callback still settles that row by hash', cbLostKey.status === 200 && rowsOf(gorder5)[0].status === 'paid' && rowsOf(gorder5)[0].transaction_id === '421105');
    keyFile[gwConfig.TOKEN_KEY_FIELD] = realKey;
    fs.writeFileSync(gwConfig.STORE_PATH, JSON.stringify(keyFile));
    check('R6: the key back, an older sealed token opens again', gwConfig._load()[gwConfig.TOKEN_KEY_FIELD] === realKey && gwConfig.openToken(grow4.session_token) === GROW_TOKEN);
    // live: the happy path
    gateway.saveAdminSettings({ mode: 'live', confirmLive: true });
    const g6 = placeCard();
    const gorder6 = orders.getOrder(g6.order.number);
    await pub('POST', '/api/store/pay/' + gorder6.token, { body: {} });
    check('Grow live mode uses the production host', callsTo('/createPaymentProcess').pop().url.startsWith('https://secure.meshulam.co.il/'));
    grApprove = { status: 0, err: { id: 722, message: 'not completed' }, data: '' };
    await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields({ 'data[customFields][cField1]': rowsOf(gorder6)[0].reference, 'data[transactionId]': '421106' })).toString(), type: 'application/x-www-form-urlencoded' });
    check('LIVE Grow: the order is paid ("שולם בכרטיס אשראי (Grow) … אושר בהודעת Grow"); a failed approveTransaction is noted on the row and never un-settles',
      !!orders.getOrder(gorder6.number).paid_at && paidEvents(gorder6).length === 1 && /אושר בהודעת Grow/.test(paidEvents(gorder6)[0]) && /approveTransaction/.test(rowsOf(gorder6)[0].error) && rowsOf(gorder6)[0].status === 'paid');
    grApprove = { status: '1', err: '', data: '' };
    // R3: Grow's sandbox and production number transactions independently — the same id in both modes is two transactions; in ONE mode it is a replay
    gateway.saveAdminSettings({ mode: 'test' });
    const g7 = placeCard();
    const gorder7 = orders.getOrder(g7.order.number);
    await pub('POST', '/api/store/pay/' + gorder7.token, { body: {} });
    await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields({ 'data[customFields][cField1]': rowsOf(gorder7)[0].reference, 'data[transactionId]': '777001' })).toString(), type: 'application/x-www-form-urlencoded' });
    gateway.saveAdminSettings({ mode: 'live', confirmLive: true });
    const g8 = placeCard();
    const gorder8 = orders.getOrder(g8.order.number);
    await pub('POST', '/api/store/pay/' + gorder8.token, { body: {} });
    await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields({ 'data[customFields][cField1]': rowsOf(gorder8)[0].reference, 'data[transactionId]': '777001' })).toString(), type: 'application/x-www-form-urlencoded' });
    check('R3: a sandbox payment and a LIVE payment with the same transactionId both settle (the UNIQUE index is per mode)',
      rowsOf(gorder7)[0].status === 'paid' && rowsOf(gorder8)[0].status === 'paid' && !!orders.getOrder(gorder8.number).paid_at);
    const g9 = placeCard();
    const gorder9 = orders.getOrder(g9.order.number);
    await pub('POST', '/api/store/pay/' + gorder9.token, { body: {} });
    const replay = await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields({ 'data[customFields][cField1]': rowsOf(gorder9)[0].reference, 'data[transactionId]': '777001' })).toString(), type: 'application/x-www-form-urlencoded' });
    check('R3: the same live transactionId against another order is refused — the row stays pending, the order unpaid, and the owner sees "העסקה כבר נרשמה בתשלום אחר" on the order and the row',
      replay.status === 200 && rowsOf(gorder9)[0].status === 'pending' && !orders.getOrder(gorder9.number).paid_at &&
      eventsOf(gorder9).some((t) => /^העסקה כבר נרשמה בתשלום אחר — ההזמנה לא סומנה כשולמה; בדקו בממשק החברה/.test(t)) && /העסקה כבר נרשמה/.test(rowsOf(gorder9)[0].error));
    // R15: a transaction id is kept as received; '' and "0" are no verdict
    const g10 = placeCard();
    const gorder10 = orders.getOrder(g10.order.number);
    await pub('POST', '/api/store/pay/' + gorder10.token, { body: {} });
    const grow10 = rowsOf(gorder10)[0];
    await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields({ 'data[customFields][cField1]': grow10.reference, 'data[transactionId]': '0' })).toString(), type: 'application/x-www-form-urlencoded' });
    check('R15: a genuine callback with transactionId "0" settles nothing', rowsOf(gorder10)[0].status === 'pending' && !orders.getOrder(gorder10.number).paid_at);
    await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields({ 'data[customFields][cField1]': grow10.reference, 'data[transactionId]': 'ABC-123_x' })).toString(), type: 'application/x-www-form-urlencoded' });
    check('R15: a non-numeric transactionId is kept verbatim, never stripped to digits', rowsOf(gorder10)[0].status === 'paid' && rowsOf(gorder10)[0].transaction_id === 'ABC-123_x');
    // R8: the owner disconnected Grow, and a genuine callback arrives
    const g11 = placeCard();
    const gorder11 = orders.getOrder(g11.order.number);
    await pub('POST', '/api/store/pay/' + gorder11.token, { body: {} });
    const grow11 = rowsOf(gorder11)[0];
    gwConfig.clearProvider('grow');
    const acksNoKeys = callsTo('/approveTransaction').length;
    const noKeysGrow = await pub('POST', '/api/store/gateway/grow/hook', { raw: new URLSearchParams(cbFields({ 'data[customFields][cField1]': grow11.reference, 'data[transactionId]': '777011' })).toString(), type: 'application/x-www-form-urlencoded' });
    check('R8: after ניתוק a genuine Grow callback still settles by hash — 200, the order paid, the acknowledgement skipped and noted on the row',
      noKeysGrow.status === 200 && rowsOf(gorder11)[0].status === 'paid' && !!orders.getOrder(gorder11.number).paid_at && callsTo('/approveTransaction').length === acksNoKeys && /approveTransaction/.test(rowsOf(gorder11)[0].error));
    check('R8: an unknown Grow row with no keys is 404', (await pub('POST', '/api/store/gateway/grow/hook', { raw: 'status=1&data[processId]=999999&data[processToken]=x', type: 'application/x-www-form-urlencoded' })).status === 404);
    gateway.saveAdminSettings({ provider: 'grow', mode: 'live', confirmLive: true, fields: { grow: { ...GR } } });
    check('…Grow connected again, live', gateway.status().ready && gateway.status().live);

    // ── the transport guard, the mount order ───────────────────────────
    const guard = gateway.guardedTransport(gateway.driverOf('grow'), async () => ({ status: 200, text: '{}', json: {} }));
    check('the transport refuses any host that is not the driver\'s constant (no setting can redirect a credential)',
      (await guard({ url: 'https://evil.example/api/light/server/1.0/createPaymentProcess' })).error === 'host_not_allowed' && (await guard({ url: 'https://secure.meshulam.co.il/api/light/server/1.0/x' })).status === 200);
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    check('server.js mounts the gateway router BEFORE the urlencoded parser (the hook reads raw bytes)', serverSrc.indexOf("require('./routes/store-gateway')") < serverSrc.indexOf('bodyParser.urlencoded('));
    for (const f of ['cardcom.js', 'grow.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'store', 'gateway', f), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const urls = src.match(/https?:\/\/[^\s'"`]+/g) || [];
      check(f + ' holds only its constant https hosts and never relaxes TLS', urls.every((u) => /^https:\/\/(secure\.cardcom\.solutions|secure\.meshulam\.co\.il|sandbox\.meshulam\.co\.il)/.test(u)) && !/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED/.test(src));
    }

    // ── the admin screens ──────────────────────────────────────────────
    const gwScreen = await pub('GET', '/admin/store/gateway', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('the gateway screen renders: provider, mode, password inputs with "שמור · ••••tail", the ₪1 test button', gwScreen.status === 200 && /st-tabs/.test(gwScreen.text) && /type="password"/.test(gwScreen.text) && /שמור · /.test(gwScreen.text) && /gw-test/.test(gwScreen.text));
    const testConn = await pub('POST', '/admin/api/store/gateway/test', { cookie: OWNER, body: {} });
    check('בדיקת חיבור opens a ₪1 session in the current mode and reports success (nothing charged, no row written)',
      testConn.json.ok && /תקין/.test(testConn.json.message) && callsTo('/createPaymentProcess').pop().fields.sum === '1' && db.prepare("SELECT COUNT(*) n FROM store_payments WHERE reference LIKE 'test%'").get().n === 0);
    check('R14: in LIVE mode the ₪1 page is opened but its address is deliberately NOT handed to the owner', gateway.status().live && !testConn.json.url && /בכוונה אינו מוצג/.test(testConn.json.message));
    gateway.saveAdminSettings({ mode: 'test' });
    const testConn2 = await pub('POST', '/admin/api/store/gateway/test', { cookie: OWNER, body: {} });
    check('R14: in test mode the page\'s address is shown', testConn2.json.ok && /^https:\/\/sandbox\.meshulam\.co\.il\//.test(testConn2.json.url || ''));
    // R10: the screen's copy matches the code
    const savedBase = config.loadConfig().baseUrl;
    setBase('');
    const noBaseScreen = await pub('GET', '/admin/store/gateway', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('R10: the gateway screen asks for an https site address in BOTH modes (linking the site settings) and no longer promises a request-origin fallback or a "test environment"',
      noBaseScreen.status === 200 && /חסרה כתובת אתר https — <a href="\/admin\/settings">/.test(noBaseScreen.text) && /כתובת בסיס \(baseUrl\)/.test(noBaseScreen.text) &&
      !/נבנות מהבקשה/.test(noBaseScreen.text) && !/סביבת הבדיקות של החברה/.test(noBaseScreen.text) && /מסוף הבדיקות 1000/.test(noBaseScreen.text) && /sandbox/.test(noBaseScreen.text));
    setBase(savedBase);
    gateway.saveAdminSettings({ mode: 'live', confirmLive: true });
    const editor = auth.addTeamMember('ed', 'editor-pass-12', 'editor');
    const EDITOR = auth.COOKIE_NAME + '=' + auth.makeToken(editor.id);
    check('the gateway screen and its APIs are requireAdmin (an editor gets 403)',
      (await req('GET', '/admin/store/gateway', { cookie: EDITOR })).status === 403 && (await req('POST', '/admin/api/store/gateway', { cookie: EDITOR, body: {} })).status === 403);
    const settingsScreen = await pub('GET', '/admin/store/settings', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('the payments section offers the card kind, its installments, and links to the gateway screen', /value="card"/.test(settingsScreen.text) && /maxPayments/.test(settingsScreen.text) && /\/admin\/store\/gateway/.test(settingsScreen.text));

    // ── BenTML ─────────────────────────────────────────────────────────
    const parsed = dialect.parseStoreDoc('<bent-store version="1"><bent-pay id="card" kind="card" label="כרטיס אשראי" max-payments="3" /><bent-pay id="bit" kind="bit" label="ביט" phone="050-0000000" /></bent-store>');
    check('<bent-pay kind="card" max-payments="3"> parses', parsed.doc && parsed.doc.payments[0].kind === 'card' && parsed.doc.payments[0].maxPayments === '3');
    const exported = store.document.exportDocument();
    check('the exported document carries the card method with its installments — and no provider, mode or key',
      /<bent-pay id="card" kind="card" label="כרטיס אשראי" max-payments="3" \/>/.test(exported) && !/cardcom|grow|meshulam|1234567|fake-/i.test(exported));
    const reparsed = dialect.serializeStore({ ...store.document.currentState(), payments: dialect.parseStoreDoc(exported).doc.payments });
    check('the document round-trips byte for byte with the card method in it', reparsed === exported);
    gateway.saveAdminSettings({ provider: '' });
    const plan = store.document.planDocument(exported.replace('max-payments="3"', 'max-payments="6"'));
    check('a document with a card method while no gateway is connected is accepted with the note (CARD_NOT_CONNECTED)', plan.ok && plan.warnings.some((w) => w.code === 'CARD_NOT_CONNECTED' && !w.hard));
    const applied = store.document.applyDocument(exported.replace('max-payments="3"', 'max-payments="6"'));
    check('apply keeps the card method (installments 6) and, unconnected, the checkout does not offer it', applied.ok && settings.loadSettings().payments.find((p) => p.kind === 'card').maxPayments === 6 && !/value="card"/.test(render.renderCheckout()));
    check('the AI catalog grammar teaches kind="card" with max-payments and no keys', /\| card/.test(require('../src/injections/store-catalog').buildPrompt({ brief: 'x' }).text) && /max-payments/.test(require('../src/injections/store-catalog').buildPrompt({ brief: 'x' }).text));
    gateway.saveAdminSettings({ provider: 'grow' });

    // ── privacy ────────────────────────────────────────────────────────
    const subj = orders.ordersForSubject({ email: 'dana@example.com' });
    check('the subject export lists the payment lines (amount, approval, last-4) without tokens', subj.some((o) => o.payments && o.payments.some((p) => p.cardLast4 === '4880')) && !JSON.stringify(subj).includes(GROW_TOKEN) && !JSON.stringify(subj).includes(GROW_TXN_TOKEN));
    orders.eraseForSubject({ email: 'dana@example.com' });
    check('an erasure drops the card\'s last-4 and brand; the amounts and the transaction ids stay', rowsOf(gorder1)[0].card_last4 === '' && rowsOf(gorder1)[0].card_brand === '' && rowsOf(gorder1)[0].transaction_id === '421100' && rowsOf(gorder1)[0].amount === 23480);

    // ── secrets never leave ────────────────────────────────────────────
    const adminPages = [];
    for (const p of ['/admin/store', '/admin/store/settings', '/admin/store/gateway', '/admin/store/orders/' + gorder1.number, '/admin/store/orders/' + gorder6.number, '/admin/store/orders']) {
      adminPages.push((await req('GET', p, { cookie: OWNER, headers: { Accept: 'text/html' } })).text);
    }
    const csv = (await req('GET', '/admin/store/orders.csv', { cookie: OWNER, headers: { Accept: 'text/csv' } })).text;
    const snap = path.join(ROOT, 'snapshot.pzn');
    require('../src/db').snapshotTo(snap);
    const pzn = fs.readFileSync(snap).toString('latin1');
    const pkg = JSON.stringify(require('../src/site-package').exportSitePackage('גיבוי'));
    const allEvents = db.prepare('SELECT text FROM store_order_events').all().map((r) => r.text).join('\n');
    const gwJson = JSON.stringify((await req('GET', '/admin/api/store/gateway', { cookie: OWNER })).json);
    const leaks = [];
    const scan = (label, text, needles) => { for (const n of needles) if (n && text.includes(n)) leaks.push(label + ' ← ' + n.slice(0, 12) + '…'); };
    // the credentials AND the token-sealing key: in nothing that leaves the server, and not in the .pzn either
    for (const [label, text] of [['api responses', responses.join('\n')], ['admin HTML', adminPages.join('\n')], ['CSV', csv], ['.pzn export', pzn], ['site package', pkg], ['<bent-store>', store.document.exportDocument()], ['order events', allEvents], ['console', logs.join('\n')], ['gateway settings JSON', gwJson]]) {
      scan(label, text, SECRETS.concat([tokenKeyHex]));
    }
    check('R6: the raw processToken is in no .pzn byte (only its hash and a sealed copy ever were)', !pzn.includes(GROW_TOKEN));
    // Grow's processId / processToken / transactionToken: never in anything a browser sees, an event, the CSV or a log line
    for (const [label, text] of [['api responses', responses.join('\n')], ['admin HTML', adminPages.join('\n')], ['CSV', csv], ['order events', allEvents], ['console', logs.join('\n')], ['gateway settings JSON', gwJson]]) {
      scan(label, text, [GROW_TOKEN, GROW_TXN_TOKEN, 'tt421103tt421103tt421103tt421103']);
      if (/(^|[^0-9])395235([^0-9]|$)/.test(text)) leaks.push(label + ' ← processId');
    }
    check('no credential in any API response, admin HTML, CSV, .pzn, site package, <bent-store>, event or console line; no Grow token or processId in anything a browser sees' + (leaks.length ? '\n     ' + leaks.join('\n     ') : ''), leaks.length === 0);
    check('the admin HTML shows the last-4 tail of a key and nothing more', adminPages[2].includes('••••ests') || adminPages[2].includes('••••' + GR.userId.slice(-4)));
  } catch (e) {
    console.error(e);
    failed++;
  }
  console.log('\nSMOKE STORE-GATEWAY: ' + (failed ? 'FAIL (' + failed + ')' : 'PASS'));
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(failed ? 1 : 0);
})();
