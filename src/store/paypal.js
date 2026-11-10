'use strict';

/**
 * PayPal checkout — sandbox by default (v2.68).
 *
 * Not a card-gateway driver. Grow and Cardcom send the shopper to a hosted
 * page; PayPal is a button on OUR order page:
 *
 *   1. placeOrder() has already stored the order at the server's own totals
 *      and taken the stock. The browser never sends a price.
 *   2. The button asks POST /api/store/paypal/create. We rebuild the PayPal
 *      order from store_orders / store_order_items. A client amount is not
 *      even a parameter.
 *   3. The buyer approves it in PayPal. POST /api/store/paypal/capture
 *      captures on the server, and the amount PayPal reports must equal the
 *      order or the row is `mismatch` and the order is not marked paid.
 *
 * HOSTS ARE CONSTANTS. Nothing in config, the environment or the request
 * chooses where a credential is sent, apart from sandbox versus live — and
 * live is refused unless PAYPAL_MODE=live AND TAPUZ_PAYPAL_LIVE=1. There is
 * no silent fallback onto the live host.
 *
 * CREDENTIALS live in the environment (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET)
 * or in gitignored config/payments.json under `paypal`. The secret is never
 * returned, logged, or left inside a stored error. The client id is public
 * (PayPal's own script URL carries it).
 *
 * TEST MODE NEVER LOOKS LIKE MONEY, same rule as the card gateway: the row
 * is recorded (mode `test`, status `paid`) and the shopper is told no real
 * money moved. paid_at stays empty.
 *
 * orders.js is required inside the functions, not up here: pricing.js and
 * orders.js load this module while they are still loading.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const money = require('./money');
const settingsMod = require('./settings');
const { CONFIG_DIR } = require('../paths');

const API_HOST = {
  test: 'api-m.sandbox.paypal.com',
  live: 'api-m.paypal.com'
};
const SDK_ORIGIN = {
  test: 'https://www.sandbox.paypal.com',
  live: 'https://www.paypal.com'
};
const ALLOWED_HOSTS = new Set(Object.values(API_HOST));
const CLIENT_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,80}$/;
const ORDER_ID_RE = /^[A-Z0-9]{8,30}$/;
const CURRENCIES = new Set(['ILS', 'USD', 'EUR', 'GBP']);
const SESSION_FRESH_MS = 3 * 60 * 60 * 1000;
const MAX_ROWS = 10;
const TIMEOUT_MS = 15000;

let injected = null;
let tokenCache = null;

function orders() { return require('./orders'); }

function clip(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function readFile() {
  const empty = { clientId: '', clientSecret: '', mode: 'test' };
  try {
    const p = path.join(CONFIG_DIR, 'payments.json');
    if (!fs.existsSync(p)) return empty;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const block = raw && raw.paypal && typeof raw.paypal === 'object' ? raw.paypal : {};
    return {
      clientId: typeof block.clientId === 'string' ? block.clientId.trim() : '',
      clientSecret: typeof block.clientSecret === 'string' ? block.clientSecret.trim() : '',
      mode: block.mode === 'live' ? 'live' : 'test'
    };
  } catch (e) {
    return empty;
  }
}

function credentials() {
  const file = readFile();
  const envId = process.env.PAYPAL_CLIENT_ID;
  const envSecret = process.env.PAYPAL_CLIENT_SECRET;
  return {
    clientId: String(envId ? String(envId).trim() : file.clientId || '').slice(0, 128),
    clientSecret: String(envSecret ? String(envSecret).trim() : file.clientSecret || '').slice(0, 300)
  };
}

/** Sandbox unless the owner asked for live AND armed it. A live request without the arm is a refusal, not a downgrade. */
function resolveMode() {
  const env = String(process.env.PAYPAL_MODE || '').trim().toLowerCase();
  let want = env === 'live' || env === 'sandbox' || env === 'test'
    ? (env === 'live' ? 'live' : 'test')
    : readFile().mode;
  if (want === 'live' && process.env.TAPUZ_PAYPAL_LIVE !== '1') {
    return { mode: 'live', refused: true };
  }
  return { mode: want === 'live' ? 'live' : 'test', refused: false };
}

function apiBase(mode) {
  return 'https://' + (mode === 'live' ? API_HOST.live : API_HOST.test);
}

function redact(text, creds) {
  let s = clip(text, 300);
  const secret = creds && creds.clientSecret;
  if (secret && secret.length >= 4) s = s.split(secret).join('[redacted]');
  return s;
}

function minorToPayPal(minor) {
  const n = Math.round(Number(minor));
  if (!Number.isInteger(n) || n < 0) return null;
  return Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
}

function status(settings) {
  const mode = resolveMode();
  const creds = credentials();
  const s = settings || settingsMod.loadSettings();
  const idOk = CLIENT_RE.test(creds.clientId);
  const secretOk = creds.clientSecret.length >= 8;
  const currencyOk = CURRENCIES.has(s.currency);
  const ready = !mode.refused && idOk && secretOk && currencyOk;
  const reasons = [];
  if (mode.refused) reasons.push('מצב אמיתי של PayPal חסום עד ש-PAYPAL_MODE=live וגם TAPUZ_PAYPAL_LIVE=1');
  if (!idOk || !secretOk) reasons.push('חסרים מפתחות PayPal');
  if (!currencyOk) reasons.push('המטבע אינו נתמך ב-PayPal');
  return {
    mode: mode.mode,
    sandbox: !mode.refused && mode.mode !== 'live',
    live: !mode.refused && mode.mode === 'live',
    liveRefused: !!mode.refused,
    configured: idOk && secretOk,
    ready,
    reasons,
    currency: s.currency
  };
}

function isReady(settings) {
  return status(settings).ready;
}

/** Card filtering stays in the gateway. A paypal method is added to the checkout only while this module is ready. */
function offeredPayments(settings) {
  const s = settings || settingsMod.loadSettings();
  const list = require('./gateway').offeredPayments(s);
  if (status(s).ready) return list;
  return list.filter((p) => p.kind !== 'paypal');
}

function httpError(http, code, message, extra) {
  return { ok: false, http, code, message, ...extra };
}

function ageMs(sqlDate) {
  if (!sqlDate) return Infinity;
  const s = String(sqlDate);
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s.replace(' ', 'T') : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? Infinity : Date.now() - d.getTime();
}

function paymentsOf(orderId) {
  return db.prepare("SELECT * FROM store_payments WHERE order_id = ? AND provider = 'paypal' ORDER BY id DESC").all(orderId);
}

function messageFor(row, st) {
  if (!row) return st && st.sandbox ? 'אפשר לשלם בארגז החול של PayPal.' : 'אפשר לשלם ב-PayPal.';
  if (row.status === 'paid' && row.mode === 'test') return 'תשלום בדיקה בארגז החול של PayPal אושר — לא התקבל כסף אמיתי';
  if (row.status === 'paid') return 'התשלום ב-PayPal אושר';
  if (row.status === 'mismatch') return 'הסכום ש-PayPal דיווח אינו סכום ההזמנה. לא סימנו את ההזמנה כשולמה.';
  if (row.status === 'failed') return 'התשלום לא הושלם. לא חויב כלום — אפשר לנסות שוב.';
  if (row.mode === 'test' || (st && st.sandbox)) return 'אפשר לשלם בארגז החול של PayPal.';
  return 'אפשר לשלם ב-PayPal.';
}

function sdkUrl(st, currency) {
  if (!st.ready) return '';
  const id = credentials().clientId;
  const origin = st.live ? SDK_ORIGIN.live : SDK_ORIGIN.test;
  return origin + '/sdk/js?client-id=' + encodeURIComponent(id)
    + '&currency=' + encodeURIComponent(currency)
    + '&intent=capture&components=buttons';
}

/** What the order page may know. Never a secret, never a session token. */
function publicPayment(order) {
  const st = status();
  const rows = order ? paymentsOf(order.id) : [];
  const paid = rows.find((r) => r.status === 'paid' || r.status === 'refunded') || null;
  const mismatch = rows.find((r) => r.status === 'mismatch') || null;
  const latest = rows[0] || null;
  const state = paid ? paid.status : mismatch ? 'mismatch' : latest ? latest.status : 'none';
  const open = !!order && order.status !== 'cancelled' && !order.paid_at;
  const canPay = open && st.ready && !paid && !mismatch;
  const sandbox = paid ? paid.mode === 'test' : !!st.sandbox;
  return {
    sandbox,
    live: !sandbox && !!st.live,
    status: state,
    canPay,
    message: messageFor(paid || mismatch || latest, st),
    sdk: canPay ? sdkUrl(st, order.currency) : ''
  };
}

/**
 * PayPal amount object from the ORDER, never from the client.
 * Returns null when the stored lines do not add up to the order total —
 * the caller then sends the order total alone, still from the database.
 */
function buildAmount(order, items) {
  const value = minorToPayPal(order.total);
  if (!value) return null;
  const itemMinor = items.reduce((a, it) => a + Number(it.line_total), 0);
  const linesOk = items.length > 0 && items.every((it) => Number(it.unit_price) * Number(it.qty) === Number(it.line_total));
  const taxMinor = order.vat_included ? 0 : Number(order.vat) || 0;
  const expected = itemMinor - Number(order.discount) + Number(order.shipping) + taxMinor;
  if (!linesOk || itemMinor !== Number(order.subtotal) || expected !== Number(order.total)) {
    return { currency_code: order.currency, value, items: null };
  }
  const breakdown = { item_total: { currency_code: order.currency, value: minorToPayPal(itemMinor) } };
  if (order.discount) breakdown.discount = { currency_code: order.currency, value: minorToPayPal(order.discount) };
  if (order.shipping) breakdown.shipping = { currency_code: order.currency, value: minorToPayPal(order.shipping) };
  if (taxMinor) breakdown.tax_total = { currency_code: order.currency, value: minorToPayPal(taxMinor) };
  const paypalItems = items.map((it) => ({
    name: clip(it.title + (it.variant_label ? ' — ' + it.variant_label : ''), 127),
    sku: clip(it.slug || '', 127),
    quantity: String(it.qty),
    unit_amount: { currency_code: order.currency, value: minorToPayPal(it.unit_price) },
    category: 'PHYSICAL_GOODS'
  }));
  return { currency_code: order.currency, value, breakdown, items: paypalItems };
}

function loadOrder(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  return orders().getOrderByToken(String(token));
}

function paypalMethod(order) {
  const s = settingsMod.loadSettings();
  const method = s.payments.find((p) => p.id === order.payment_method);
  return method && method.kind === 'paypal' ? method : null;
}

async function defaultTransport(call) {
  let u;
  try { u = new URL(call.url); } catch (e) { return { status: 0, error: 'bad url', transient: true }; }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.host)) return { status: 0, error: 'host refused', transient: false };
  try {
    const res = await fetch(call.url, {
      method: 'POST',
      headers: call.headers,
      body: call.body,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    return { status: res.status, text, json, transient: res.status >= 500 };
  } catch (e) {
    return { status: 0, error: e.message, transient: true };
  }
}

function transportOf(opts) {
  if (opts && typeof opts.transport === 'function') return opts.transport;
  if (process.env.TAPUZ_PAYPAL_FAKE === '1' && injected) return injected;
  return defaultTransport;
}

function setTestTransport(fn) {
  if (process.env.TAPUZ_PAYPAL_FAKE !== '1') throw new Error('refusing test transport');
  injected = typeof fn === 'function' ? fn : null;
  tokenCache = null;
}

async function accessToken(mode, creds, transport) {
  const now = Date.now();
  if (tokenCache && tokenCache.mode === mode && tokenCache.clientId === creds.clientId && tokenCache.until > now + 5000) {
    return { ok: true, token: tokenCache.token };
  }
  const basic = Buffer.from(creds.clientId + ':' + creds.clientSecret).toString('base64');
  const res = await transport({
    url: apiBase(mode) + '/v1/oauth2/token',
    method: 'POST',
    headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials'
  });
  const token = res.json && res.json.access_token;
  if (!res.status || res.status >= 300 || !token) {
    return { ok: false, transient: !!res.transient || res.status >= 500 || res.status === 0, error: redact((res.json && (res.json.error_description || res.json.error)) || res.error || 'oauth failed', creds) };
  }
  const sec = Number(res.json.expires_in) || 300;
  tokenCache = { mode, clientId: creds.clientId, token, until: now + sec * 1000 };
  return { ok: true, token };
}

async function postJson(mode, creds, urlPath, body, requestId, transport) {
  const auth = await accessToken(mode, creds, transport);
  if (!auth.ok) return auth;
  const res = await transport({
    url: apiBase(mode) + urlPath,
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + auth.token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'PayPal-Request-Id': requestId
    },
    body: JSON.stringify(body)
  });
  if (!res.status || res.status >= 300 || !res.json) {
    const detail = res.json && (res.json.message || (res.json.details && res.json.details[0] && res.json.details[0].description));
    return { ok: false, transient: !!res.transient || res.status >= 500 || res.status === 0, error: redact(detail || res.error || 'paypal error', creds), json: res.json || null };
  }
  return { ok: true, json: res.json };
}

async function createForOrder(token, opts) {
  const order = loadOrder(token);
  if (!order) return httpError(404, 'NOT_FOUND', 'ההזמנה לא נמצאה');
  if (!paypalMethod(order)) return httpError(403, 'NOT_PAYPAL', 'ההזמנה אינה לתשלום ב-PayPal');
  if (order.status === 'cancelled') return httpError(409, 'CANCELLED', 'ההזמנה בוטלה');
  const st = status();
  if (st.liveRefused) return httpError(403, 'LIVE_REFUSED', 'מצב אמיתי של PayPal חסום עד שמגדירים אותו במפורש. לא נפתח תשלום.');
  if (!st.ready) return httpError(403, 'NOT_READY', 'PayPal אינו מחובר. לא נפתח תשלום.');
  if (order.currency !== st.currency) return httpError(409, 'CURRENCY', 'מטבע ההזמנה אינו מטבע החנות');

  const rows = paymentsOf(order.id);
  const paid = rows.find((r) => r.status === 'paid');
  if (paid) {
    return { ok: true, http: 200, already: true, orderId: paid.session_id, status: 'paid', test: paid.mode === 'test', sandbox: paid.mode === 'test', message: messageFor(paid, st) };
  }
  if (rows.some((r) => r.status === 'mismatch')) {
    return httpError(409, 'MISMATCH', messageFor({ status: 'mismatch' }, st));
  }
  const fresh = rows.find((r) => r.status === 'pending' && ORDER_ID_RE.test(r.session_id) && r.mode === st.mode && Number(r.amount) === Number(order.total) && ageMs(r.created_at) < SESSION_FRESH_MS);
  if (fresh) {
    return { ok: true, http: 200, reused: true, orderId: fresh.session_id, sandbox: st.sandbox, status: 'pending' };
  }
  if (rows.length >= MAX_ROWS) return httpError(429, 'TOO_MANY', 'יותר מדי ניסיונות תשלום להזמנה הזו');

  const reference = crypto.randomBytes(10).toString('hex');
  const mode = st.live ? 'live' : 'test';
  const info = db.prepare(`
    INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status)
    VALUES (?, 'paypal', ?, ?, '', ?, ?, 'pending')
  `).run(order.id, mode, reference, order.total, order.currency);
  const rowId = Number(info.lastInsertRowid);
  const items = orders().listItems(order.id);
  const amount = buildAmount(order, items);
  const purchase = {
    reference_id: reference,
    custom_id: clip(order.number, 127),
    invoice_id: reference,
    description: clip(settingsMod.storeName(), 127),
    amount: { currency_code: amount.currency_code, value: amount.value }
  };
  if (amount.breakdown) purchase.amount.breakdown = amount.breakdown;
  if (amount.items) purchase.items = amount.items;
  const creds = credentials();
  const created = await postJson(mode, creds, '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [purchase]
  }, reference, transportOf(opts));
  if (!created.ok || !created.json || !ORDER_ID_RE.test(created.json.id || '')) {
    const why = redact((created && created.error) || 'לא התקבל מספר הזמנה', creds);
    db.prepare("UPDATE store_payments SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(why, rowId);
    orders().addEvent(order.id, 'payment', 'פתיחת תשלום PayPal נכשלה — לא חויב כלום');
    console.error('[store] paypal create failed');
    return httpError(502, 'PROVIDER', 'לא הצלחנו לפתוח תשלום ב-PayPal. לא חויב כלום.');
  }
  db.prepare('UPDATE store_payments SET session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(created.json.id, rowId);
  orders().addEvent(order.id, 'payment', st.sandbox ? 'נפתח תשלום בארגז החול של PayPal' : 'נפתח תשלום ב-PayPal');
  return { ok: true, http: 200, orderId: created.json.id, sandbox: st.sandbox, status: 'pending' };
}

function parseCapture(json) {
  const unit = json && Array.isArray(json.purchase_units) ? json.purchase_units[0] : null;
  const cap = unit && unit.payments && Array.isArray(unit.payments.captures) ? unit.payments.captures[0] : null;
  return {
    orderStatus: json && json.status ? String(json.status) : '',
    captureStatus: cap && cap.status ? String(cap.status) : '',
    amount: cap && cap.amount ? cap.amount.value : '',
    currency: cap && cap.amount ? cap.amount.currency_code : '',
    transactionId: cap && cap.id ? String(cap.id) : ''
  };
}

function settle(row, captured) {
  const O = orders();
  let out;
  const tx = db.transaction(() => {
    const order = O.getOrderById(row.order_id);
    if (!order) { out = httpError(404, 'NOT_FOUND', 'ההזמנה לא נמצאה'); return; }
    const amount = money.toMinor(String(captured.amount == null ? '' : captured.amount));
    const currency = String(captured.currency || '').toUpperCase();
    const matched = Number.isInteger(amount) && amount === Number(order.total) && currency === order.currency;
    let r;
    try {
      r = db.prepare(`
        UPDATE store_payments SET status = ?, transaction_id = ?, approval = ?, error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('pending', 'failed')
      `).run(matched ? 'paid' : 'mismatch', clip(captured.transactionId, 80), clip(captured.captureStatus, 40),
        matched ? '' : 'אי-התאמה', row.id);
    } catch (e) {
      if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        out = httpError(409, 'DUPLICATE', 'העסקה כבר רשומה על תשלום אחר. ההזמנה לא סומנה פעם שנייה.');
        return;
      }
      throw e;
    }
    if (!r.changes) {
      const now = db.prepare('SELECT * FROM store_payments WHERE id = ?').get(row.id);
      out = { ok: true, http: 200, already: true, status: now ? now.status : 'paid', test: now && now.mode === 'test', message: messageFor(now) };
      return;
    }
    if (!matched) {
      O.addEvent(order.id, 'payment', 'אי-התאמה בתשלום PayPal — ההזמנה לא סומנה כשולמה');
      out = httpError(409, 'MISMATCH', 'הסכום ש-PayPal דיווח אינו סכום ההזמנה. לא סימנו את ההזמנה כשולמה.');
      out.status = 'mismatch';
      return;
    }
    if (row.mode === 'test') {
      O.addEvent(order.id, 'payment', 'תשלום בדיקה בארגז החול של PayPal אושר — לא התקבל כסף');
      out = { ok: true, http: 200, status: 'paid', test: true, sandbox: true, message: messageFor({ status: 'paid', mode: 'test' }) };
      return;
    }
    if (order.status === 'cancelled') {
      O.addEvent(order.id, 'payment', 'תשלום PayPal להזמנה מבוטלת — יש להחזיר לקונה');
      out = { ok: true, http: 200, status: 'paid', test: false, message: 'התשלום אושר אחרי ביטול ההזמנה. יש להחזיר אותו ידנית.' };
      return;
    }
    const u = db.prepare('UPDATE store_orders SET paid_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND paid_at IS NULL')
      .run(new Date().toISOString(), order.id);
    if (u.changes) db.prepare('UPDATE store_payments SET set_paid = 1 WHERE id = ?').run(row.id);
    O.addEvent(order.id, 'payment', u.changes ? 'שולם ב-PayPal' : 'תשלום PayPal כפול — ההזמנה כבר שולמה');
    out = { ok: true, http: 200, status: 'paid', test: false, sandbox: false, message: 'התשלום ב-PayPal אושר' };
  });
  tx.immediate();
  return out;
}

async function captureForOrder(token, paypalOrderId, opts) {
  const order = loadOrder(token);
  if (!order) return httpError(404, 'NOT_FOUND', 'ההזמנה לא נמצאה');
  if (!paypalMethod(order)) return httpError(403, 'NOT_PAYPAL', 'ההזמנה אינה לתשלום ב-PayPal');
  if (!ORDER_ID_RE.test(String(paypalOrderId || ''))) return httpError(400, 'BAD_ID', 'מספר העסקה אינו תקין');
  const st = status();
  if (st.liveRefused) return httpError(403, 'LIVE_REFUSED', 'מצב אמיתי של PayPal חסום. לא בוצע חיוב.');
  const row = db.prepare("SELECT * FROM store_payments WHERE provider = 'paypal' AND session_id = ? AND order_id = ?").get(String(paypalOrderId), order.id);
  if (!row) return httpError(404, 'NO_SESSION', 'לא נמצא תשלום פתוח להזמנה הזו');
  if (row.status === 'paid') {
    return { ok: true, http: 200, already: true, status: 'paid', test: row.mode === 'test', message: messageFor(row) };
  }
  if (row.status === 'mismatch') return httpError(409, 'MISMATCH', messageFor(row));
  if (row.mode === 'live' && process.env.TAPUZ_PAYPAL_LIVE !== '1') {
    return httpError(403, 'LIVE_REFUSED', 'מצב אמיתי של PayPal חסום. לא בוצע חיוב.');
  }
  const creds = credentials();
  const result = await postJson(row.mode, creds, '/v2/checkout/orders/' + row.session_id + '/capture', {}, row.reference, transportOf(opts));
  if (!result.ok) {
    const why = result.error || 'capture failed';
    if (result.transient) {
      db.prepare("UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(why, row.id);
      return httpError(502, 'TRANSIENT', 'לא הצלחנו לדבר עם PayPal. לא ידוע אם חויב כסף — נסו שוב בעוד רגע.');
    }
    db.prepare("UPDATE store_payments SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(why, row.id);
    orders().addEvent(order.id, 'payment', 'התשלום ב-PayPal לא הושלם — לא סומן כשולם');
    return httpError(402, 'FAILED', 'התשלום לא הושלם. לא חויב כלום — אפשר לנסות שוב.');
  }
  const captured = parseCapture(result.json);
  const done = captured.orderStatus === 'COMPLETED' && captured.captureStatus === 'COMPLETED';
  if (!done) {
    const hard = captured.captureStatus === 'DECLINED' || captured.captureStatus === 'FAILED' || captured.orderStatus === 'VOIDED';
    if (hard) {
      db.prepare("UPDATE store_payments SET status = 'failed', approval = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
        .run(clip(captured.captureStatus || captured.orderStatus, 40), 'נדחה', row.id);
      orders().addEvent(order.id, 'payment', 'PayPal דחה את התשלום — לא סומן כשולם');
      return httpError(402, 'FAILED', 'התשלום לא הושלם. לא חויב כלום — אפשר לנסות שוב.');
    }
    return httpError(409, 'PENDING', 'PayPal עדיין לא אישר את התשלום. לא סימנו את ההזמנה כשולמה.');
  }
  return settle(row, captured);
}

function cancelForOrder(token) {
  const order = loadOrder(token);
  if (!order) return httpError(404, 'NOT_FOUND', 'ההזמנה לא נמצאה');
  if (!paypalMethod(order)) return httpError(403, 'NOT_PAYPAL', 'ההזמנה אינה לתשלום ב-PayPal');
  const paid = paymentsOf(order.id).find((r) => r.status === 'paid');
  if (paid) return { ok: true, http: 200, already: true, status: 'paid', message: messageFor(paid) };
  orders().addEvent(order.id, 'payment', 'הקונה ביטל את תשלום ה-PayPal — לא חויב כלום');
  return { ok: true, http: 200, cancelled: true, status: 'pending', message: 'התשלום בוטל. לא חויב כלום — ההזמנה שמורה ואפשר לנסות שוב.' };
}

module.exports = {
  API_HOST,
  SDK_ORIGIN,
  status,
  isReady,
  offeredPayments,
  publicPayment,
  buildAmount,
  minorToPayPal,
  createForOrder,
  captureForOrder,
  cancelForOrder,
  setTestTransport,
  paymentsOf
};
