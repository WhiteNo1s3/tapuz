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
 * chooses where a credential is sent, apart from sandbox versus live. Live
 * can be ASKED FOR in two places — PAYPAL_MODE=live in the environment, or
 * `mode: "live"` under `paypal` in config/payments.json (what the admin
 * screen writes; the environment wins when both speak) — and is ARMED in
 * only one: TAPUZ_PAYPAL_LIVE=1 in the server's environment. Asked for and
 * not armed is a refusal, never a quiet downgrade and never a silent
 * fallback onto the live host.
 *
 * CREDENTIALS live in the environment (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET)
 * or in gitignored config/payments.json under `paypal` (typed in the admin's
 * "סליקת אשראי" screen; the environment wins). The secret is never returned,
 * logged, or left inside a stored error. The client id is public (PayPal's
 * own script URL carries it).
 *
 * THE BROWSER NEEDS PERMISSION TOO. The site's Content-Security-Policy
 * allows only its own origin, so PayPal's script, its button frame and its
 * calls are blocked until cspSources() is merged into the policy
 * (src/server.js) — and that list is empty unless PayPal is ready and a
 * paypal method exists, so a shop without PayPal keeps its policy as it was.
 *
 * NO WEBHOOK. A capture that got no clear answer is asked about again by
 * verifyRow() — GET the PayPal order — from the order page (throttled on
 * the row) and from the admin's own check.
 *
 * IN DOUBT. A row whose capture was ATTEMPTED and never clearly answered —
 * no reply, a timeout, a process that died mid-call, or "order COMPLETED,
 * capture PENDING" — may be money PayPal took and we do not know about.
 * `capture_tried_at` is stamped just before the capture call leaves, so
 * even a crash leaves the mark; the row is in doubt for as long as it is
 * still `pending` with that stamp, and nothing ever clears the stamp: the
 * row leaves the state by its status leaving `pending` (settled, or closed
 * on PayPal's clear word). While a row of an order is in doubt the order
 * page offers no button and never says "nothing was charged",
 * createForOrder() asks PayPal first and opens no second PayPal order until
 * the answer is clear, orders.expireUnpaid() leaves the order alone, and
 * the server's own round (resolveInDoubt) keeps asking. A pending row
 * WITHOUT the stamp — one nobody tried to capture, and every row from
 * before v2.69 — is not in doubt and is treated as it always was.
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
const demoPay = require('./demo-pay');
const gwConfig = require('./gateway/config');
const { CONFIG_DIR } = require('../paths');

const API_HOST = {
  test: 'api-m.sandbox.paypal.com',
  live: 'api-m.paypal.com'
};
const SDK_ORIGIN = {
  test: 'https://www.sandbox.paypal.com',
  live: 'https://www.paypal.com'
};
// PayPal's static host: the SDK and the button frame load their images,
// fonts and helper scripts from it in both modes
const OBJECTS_ORIGIN = 'https://www.paypalobjects.com';
const ALLOWED_HOSTS = new Set(Object.values(API_HOST));
const CLIENT_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,80}$/;
const ORDER_ID_RE = /^[A-Z0-9]{8,30}$/;
const CURRENCIES = new Set(['ILS', 'USD', 'EUR', 'GBP']);
const SESSION_FRESH_MS = 3 * 60 * 60 * 1000;
// at most MAX_ROWS PayPal orders opened for one of ours; rows that never got
// that far (PayPal refused, or we died mid-call) are capped apart, so an
// outage cannot lock the button for good and cannot grow the table either
const MAX_ROWS = 10;
const MAX_TOTAL_ROWS = 30;
// a row we wrote and never heard back about: after this long it is a
// leftover of a crash, not a call in flight
const STALE_MS = 60 * 1000;
const TIMEOUT_MS = 15000;
// the inquiry: from the order page at most every VERIFY_GAP_MS and
// VERIFY_MAX times per row inside VERIFY_WINDOW_MS; the admin's own check is
// bounded by ADMIN_VERIFY_MAX only
const VERIFY_GAP_MS = 10 * 1000;
const VERIFY_MAX = 30;
const ADMIN_VERIFY_MAX = 200;
const VERIFY_WINDOW_MS = 24 * 60 * 60 * 1000;
// asks nobody's hand made — the pay button meeting a row in doubt, the
// server's own round — keep the page's gap and stop at AUTO_VERIFY_MAX per
// row, so the owner's own button always has asks left
const AUTO_VERIFY_MAX = 100;
// rows in doubt one round of the server asks PayPal about — and how long
// it leaves a row between its own asks: a quarter of the attempt's age, up
// to ROUND_GAP_MAX_MS. An hour-old doubt is asked about every round; one
// PayPal has held for days (a review, an eCheck) a few times a day, so the
// row's asks last for weeks rather than for its first four days.
const ROUND_ASKS = 5;
const ROUND_GAP_MAX_MS = 6 * 60 * 60 * 1000;
// a capture call we gave up on may still be landing at PayPal: for this long
// after an attempt, "the order stands open, nothing captured" is not yet an
// answer (our own call is abandoned after TIMEOUT_MS)
const CAPTURE_GRACE_MS = 2 * 60 * 1000;
// PayPal order states in which nothing has been captured
const OPEN_STATES = new Set(['CREATED', 'SAVED', 'APPROVED', 'PAYER_ACTION_REQUIRED']);
const CHECKING_TEXT = 'התשלום נבדק מול PayPal — עדיין לא ידוע אם החיוב עבר. אין צורך לשלם שוב; רעננו את הדף בעוד כמה דקות.';
const UNKNOWN_EVENT = 'תוצאת החיוב ב-PayPal לא ידועה — נבדקת';
const NOT_AVAILABLE_TEXT = 'תשלום ב-PayPal אינו זמין כרגע — צרו איתנו קשר';
const LIVE_ARM_TEXT = 'מצב חי של PayPal חסום: בסביבת השרת לא מוגדר TAPUZ_PAYPAL_LIVE=1';

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
  if (mode.refused) reasons.push(LIVE_ARM_TEXT);
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
    currency: s.currency,
    // is there a paypal method in the shop at all? Keys without a method
    // widen nothing and offer nothing.
    hasMethod: s.payments.some((p) => p.kind === 'paypal')
  };
}

function isReady(settings) {
  return status(settings).ready;
}

/**
 * THE filter for "which methods may a shopper pick". Card filtering stays in
 * the gateway; a paypal method is offered only while this module is ready,
 * and a demo method only on a demo site (or while the owner allows it).
 * pricing.quote, the checkout page and — through the quote — placeOrder all
 * read this one list.
 */
function offeredPayments(settings) {
  const s = settings || settingsMod.loadSettings();
  let list = require('./gateway').offeredPayments(s);
  if (list.some((p) => p.kind === 'paypal') && !status(s).ready) list = list.filter((p) => p.kind !== 'paypal');
  if (list.some((p) => p.kind === 'demo') && !demoPay.allowed(s)) list = list.filter((p) => p.kind !== 'demo');
  return list;
}

/**
 * The origins PayPal's JS SDK buttons need in the site's Content-Security-
 * Policy, and NOTHING unless PayPal is ready and the shop has a paypal
 * method — a shop without PayPal keeps its policy character for character.
 *
 * PayPal's own guidance (developer.paypal.com → JavaScript SDK → Best
 * practices → Content Security Policy) lists *.paypal.com, *.paypalobjects.com
 * and *.venmo.com for script-src, connect-src, frame-src (and child-src),
 * with img-src and style-src the same. This file's rule is that hosts are
 * constants, so the wildcards are narrowed to the exact hosts of the mode in
 * use: the SDK script, the button frame and the SDK's own calls live on the
 * www host of that mode (sdkUrl() below is where the script comes from), and
 * the static host is shared. Sandbox never widens the policy to the live
 * host and live never to the sandbox. Venmo is a US-only button this shop
 * does not offer. img-src stays empty: the site's policy already allows any
 * https image. style-src needs nothing: the SDK's styles are inline, which
 * the site's policy already allows.
 * @returns {{ script:string[], frame:string[], connect:string[], img:string[] }}
 */
function cspSources(settings) {
  const none = { script: [], frame: [], connect: [], img: [] };
  try {
    const st = status(settings);
    if (!st.ready || !st.hasMethod) return none;
    const hosts = [st.live ? SDK_ORIGIN.live : SDK_ORIGIN.test, OBJECTS_ORIGIN];
    return { script: hosts.slice(), frame: hosts.slice(), connect: hosts.slice(), img: [] };
  } catch (e) {
    // a policy must never fail open on a settings error
    return none;
  }
}

/**
 * Why a configured method is NOT at the checkout, as sentences for the
 * owner. The settings screen lists a method the moment it is saved; whether
 * a shopper can pick it is decided here and in the gateway, and until now
 * nobody said so — "✓ אמצעי תשלום: PayPal" stood over a checkout that
 * offered nothing.
 * @returns {string[]}
 */
function readinessNotes(settings) {
  const s = settings || settingsMod.loadSettings();
  const notes = [];
  if (s.payments.length && !offeredPayments(s).length) notes.push('כרגע אף אמצעי תשלום אינו מוצע בקופה — לקוחות לא יכולים להשלים הזמנה.');
  const kinds = new Set(s.payments.map((p) => p.kind));
  if (kinds.has('paypal')) {
    const st = status(s);
    if (!st.ready) notes.push('PayPal מוגדר כאמצעי תשלום אבל אינו מוצע בקופה: ' + st.reasons.join(' · ') + '. מחברים אותו במסך "סליקת אשראי".');
  }
  if (kinds.has('card')) {
    let gw = null;
    try { gw = require('./gateway').status(s); } catch (e) { gw = null; }
    if (gw && !gw.ready) notes.push('כרטיס אשראי מוגדר כאמצעי תשלום אבל אינו מוצע בקופה: ' + gw.reasons.join(' · ') + '.');
  }
  if (kinds.has('demo') && !demoPay.allowed(s)) {
    notes.push('"תשלום לדוגמה" מוגדר כאמצעי תשלום אבל אינו מוצע בקופה: האתר אינו אתר הדגמה, והתיבה "להציע תשלום לדוגמה בקופה" אינה מסומנת בהגדרות החנות.');
  }
  return notes;
}

/** The same, as one string for a save reply or a status line; '' when every configured method is offered. */
function readinessNote(settings) {
  return readinessNotes(settings).join(' ');
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

/** A capture was attempted for this row and nobody knows how it ended (see IN DOUBT in the header). */
function inDoubt(row) {
  return !!row && row.status === 'pending' && !!row.capture_tried_at;
}

/**
 * The line that tells the owner why an order is being held. Said once: a
 * second attempt, or an inquiry that still cannot tell, adds nothing while
 * it is the last thing the history says about the payment.
 */
function sayUnknown(orderId) {
  const O = orders();
  const last = O.listEvents(orderId).filter((e) => e.kind === 'payment').pop();
  if (!last || last.text !== UNKNOWN_EVENT) O.addEvent(orderId, 'payment', UNKNOWN_EVENT);
}

/**
 * The one sentence under the PayPal block. A payment that already has an
 * outcome says its outcome whatever the keys do today; an open one only
 * promises a button when there is a button — `st` given and not ready (keys
 * gone, live asked for and not armed, the method removed) says so instead
 * of "אפשר לשלם" over nothing.
 */
function messageFor(row, st) {
  if (row && row.status === 'paid' && row.mode === 'test') return 'תשלום בדיקה בארגז החול של PayPal אושר — לא התקבל כסף אמיתי';
  if (row && row.status === 'paid') return 'התשלום ב-PayPal אושר';
  if (row && row.status === 'mismatch') return 'הסכום ש-PayPal דיווח אינו סכום ההזמנה. לא סימנו את ההזמנה כשולמה.';
  if (st && (!st.ready || st.hasMethod === false)) return NOT_AVAILABLE_TEXT;
  if (row && row.status === 'failed') return 'התשלום לא הושלם. לא חויב כלום — אפשר לנסות שוב.';
  if ((row && row.mode === 'test') || (st && st.sandbox)) return 'אפשר לשלם בארגז החול של PayPal.';
  return 'אפשר לשלם ב-PayPal.';
}

/**
 * Rows that count toward the cap: the PayPal orders really opened, plus a
 * call that may still be in flight. A row PayPal never answered for is not
 * a session.
 */
function sessionsOf(rows) {
  return rows.filter((r) => r.session_id || (r.status === 'pending' && ageMs(r.created_at) < STALE_MS)).length;
}

/** A pending row with no PayPal order id, older than a minute: we died between the INSERT and the answer. It is closed, and said. */
function sweepStale(orderId) {
  return db.prepare(`
    UPDATE store_payments SET status = 'failed', error = 'לא התקבלה תשובה מ-PayPal', updated_at = CURRENT_TIMESTAMP
    WHERE order_id = ? AND provider = 'paypal' AND status = 'pending' AND session_id = ''
      AND julianday(created_at) < julianday(?)
  `).run(orderId, new Date(Date.now() - STALE_MS).toISOString()).changes;
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
  const open = !!order && order.status !== 'cancelled' && !order.paid_at;
  // a capture that may have taken the money, on ANY row of the order: no
  // button and no "nothing was charged" until PayPal has said what happened
  const checking = open && !paid && !mismatch && rows.some(inDoubt);
  const state = paid ? paid.status : mismatch ? 'mismatch' : checking ? 'pending' : latest ? latest.status : 'none';
  // the same caps createForOrder enforces: a button that can only answer
  // "too many attempts" is not offered
  const capped = sessionsOf(rows) >= MAX_ROWS || rows.length >= MAX_TOTAL_ROWS;
  const canPay = open && st.ready && st.hasMethod && !paid && !mismatch && !capped && !checking;
  const sandbox = paid ? paid.mode === 'test' : !!st.sandbox;
  return {
    sandbox,
    live: !sandbox && !!st.live,
    status: state,
    canPay,
    checking,
    message: checking ? CHECKING_TEXT : open && capped && !paid && !mismatch
      ? 'נפתחו יותר מדי ניסיונות תשלום להזמנה הזו — צרו איתנו קשר להשלמת התשלום'
      : messageFor(paid || mismatch || latest, st),
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

/** Is this a PayPal order? By the method's id, else by the kind the order kept — renaming the method must not turn its open orders into "not PayPal". */
function paypalMethod(order) {
  const method = orders().methodOf(order, settingsMod.loadSettings());
  return method && method.kind === 'paypal' ? method : null;
}

async function defaultTransport(call) {
  let u;
  try { u = new URL(call.url); } catch (e) { return { status: 0, error: 'bad url', transient: true }; }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.host)) return { status: 0, error: 'host refused', transient: false };
  // POST for everything that changes something; GET only for the inquiry
  const method = call.method === 'GET' ? 'GET' : 'POST';
  try {
    const res = await fetch(call.url, {
      method,
      headers: call.headers,
      body: method === 'GET' ? undefined : call.body,
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

/** The inquiry: GET, no body, no request id. `http` is handed back so "PayPal no longer knows this order" (404) can be told from a bad day. */
async function getJson(mode, creds, urlPath, transport) {
  const auth = await accessToken(mode, creds, transport);
  if (!auth.ok) return auth;
  const res = await transport({
    url: apiBase(mode) + urlPath,
    method: 'GET',
    headers: { Authorization: 'Bearer ' + auth.token, Accept: 'application/json' }
  });
  if (!res.status || res.status >= 300 || !res.json) {
    const detail = res.json && (res.json.message || (res.json.details && res.json.details[0] && res.json.details[0].description));
    return { ok: false, http: res.status || 0, transient: !!res.transient || res.status >= 500 || res.status === 0, error: redact(detail || res.error || 'paypal error', creds) };
  }
  return { ok: true, http: res.status, json: res.json };
}

function siteLanguage() {
  try { return String(require('../config').loadConfig().language || 'he').toLowerCase(); } catch (e) { return 'he'; }
}

async function createForOrder(token, opts) {
  const order = loadOrder(token);
  if (!order) return httpError(404, 'NOT_FOUND', 'ההזמנה לא נמצאה');
  if (!paypalMethod(order)) return httpError(403, 'NOT_PAYPAL', 'ההזמנה אינה לתשלום ב-PayPal');
  const st = status();
  // a payment this order already has is answered first — the button of a
  // paid order asking again is told "already", whatever happened since
  sweepStale(order.id);
  let rows = paymentsOf(order.id);
  const alreadyPaid = (paid) => ({ ok: true, http: 200, already: true, orderId: paid.session_id, status: 'paid', test: paid.mode === 'test', sandbox: paid.mode === 'test', message: messageFor(paid, st) });
  const paid = rows.find((r) => r.status === 'paid');
  if (paid) return alreadyPaid(paid);
  // …and an order that is cancelled, or paid some other way, is refused
  // before a single byte leaves: no PayPal order is opened for it
  if (order.status === 'cancelled') return httpError(409, 'CANCELLED', 'ההזמנה בוטלה — לא נפתח תשלום');
  if (order.paid_at) return httpError(409, 'PAID', 'ההזמנה כבר שולמה — לא נפתח תשלום נוסף');
  if (st.liveRefused) return httpError(403, 'LIVE_REFUSED', 'מצב אמיתי של PayPal חסום עד שמגדירים אותו במפורש. לא נפתח תשלום.');
  if (!st.ready || !st.hasMethod) return httpError(403, 'NOT_READY', 'PayPal אינו מחובר. לא נפתח תשלום.');
  if (order.currency !== st.currency) return httpError(409, 'CURRENCY', 'מטבע ההזמנה אינו מטבע החנות');

  // A capture that was tried and never clearly answered comes before any
  // new PayPal order: PayPal is asked now, and what it says decides. Paid —
  // the button is told "already". Clearly not paid (declined, voided, gone,
  // or the order still stands open there with nothing captured) — the row
  // is closed and a new PayPal order may open below. Still unknown — nothing
  // is opened: a second PayPal order here is how a buyer came to pay twice.
  if (rows.some(inDoubt)) {
    for (const r of rows.filter(inDoubt)) await verifyRow(r, { source: 'auto', transport: opts && opts.transport });
    rows = paymentsOf(order.id);
    const settled = rows.find((r) => r.status === 'paid');
    if (settled) return alreadyPaid(settled);
    if (rows.some(inDoubt)) {
      return httpError(409, 'CHECKING', 'התשלום הקודם עדיין נבדק מול PayPal, ולכן לא נפתח תשלום נוסף. נסו שוב בעוד כמה דקות.', { status: 'pending' });
    }
    // the answer took a moment: the order may have been cancelled, or paid by hand, meanwhile
    const after = orders().getOrderById(order.id);
    if (!after || after.status === 'cancelled') return httpError(409, 'CANCELLED', 'ההזמנה בוטלה — לא נפתח תשלום');
    if (after.paid_at) return httpError(409, 'PAID', 'ההזמנה כבר שולמה — לא נפתח תשלום נוסף');
  }
  if (rows.some((r) => r.status === 'mismatch')) {
    return httpError(409, 'MISMATCH', messageFor({ status: 'mismatch' }, st));
  }
  const fresh = rows.find((r) => r.status === 'pending' && ORDER_ID_RE.test(r.session_id) && r.mode === st.mode && Number(r.amount) === Number(order.total) && ageMs(r.created_at) < SESSION_FRESH_MS);
  if (fresh) {
    return { ok: true, http: 200, reused: true, orderId: fresh.session_id, sandbox: st.sandbox, status: 'pending' };
  }
  if (sessionsOf(rows) >= MAX_ROWS || rows.length >= MAX_TOTAL_ROWS) return httpError(429, 'TOO_MANY', 'יותר מדי ניסיונות תשלום להזמנה הזו');

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
  // How PayPal's own window behaves (Orders v2, payment_source.paypal.
  // experience_context): we already hold the address — or the order is a
  // pickup — so PayPal must not ask for one (NO_SHIPPING); the total is
  // final, so its button says "pay now" and not "continue"; the window
  // carries the shop's name; and a Hebrew site gets a Hebrew window.
  const experience = { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' };
  const brand = clip(settingsMod.storeName(), 127);
  if (brand) experience.brand_name = brand;
  if (siteLanguage() === 'he') experience.locale = 'he-IL';
  const creds = credentials();
  const created = await postJson(mode, creds, '/v2/checkout/orders', {
    intent: 'CAPTURE',
    payment_source: { paypal: { experience_context: experience } },
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

/**
 * PayPal's amount string → minor units. Strict — digits, a dot, exactly two
 * digits, which is how PayPal writes every currency this module accepts —
 * and with NO ceiling: money.toMinor() answers NaN above MAX_MINOR, which
 * turned a large order PayPal reported to the agora into a "mismatch", and a
 * mismatch is terminal for the order.
 */
function paypalToMinor(value) {
  const s = String(value == null ? '' : value);
  if (!/^\d+\.\d{2}$/.test(s)) return NaN;
  const dot = s.indexOf('.');
  const n = Number(s.slice(0, dot)) * 100 + Number(s.slice(dot + 1));
  return Number.isSafeInteger(n) ? n : NaN;
}

function settle(row, captured) {
  const O = orders();
  let out;
  const tx = db.transaction(() => {
    const order = O.getOrderById(row.order_id);
    if (!order) { out = httpError(404, 'NOT_FOUND', 'ההזמנה לא נמצאה'); return; }
    const amount = paypalToMinor(captured.amount);
    const currency = String(captured.currency || '').toUpperCase();
    const matched = Number.isInteger(amount) && amount === Number(order.total) && currency === order.currency;
    const mismatch = matched ? '' :
      'אי-התאמה: PayPal דיווח על ' + (Number.isInteger(amount) ? money.formatMoney(amount, currency || order.currency) : '?') +
      (currency && currency !== order.currency ? ' (' + clip(currency, 8) + ')' : '') + ' — ההזמנה היא ' + money.formatMoney(order.total, order.currency);
    let r;
    try {
      r = db.prepare(`
        UPDATE store_payments SET status = ?, transaction_id = ?, approval = ?, error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('pending', 'failed')
      `).run(matched ? 'paid' : 'mismatch', clip(captured.transactionId, 80), clip(captured.captureStatus, 40),
        mismatch, row.id);
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
      out.changed = true;
      return;
    }
    if (row.mode === 'test') {
      O.addEvent(order.id, 'payment', 'תשלום בדיקה בארגז החול של PayPal אושר — לא התקבל כסף');
      out = { ok: true, http: 200, status: 'paid', test: true, sandbox: true, changed: true, message: messageFor({ status: 'paid', mode: 'test' }) };
      return;
    }
    if (order.status === 'cancelled') {
      O.addEvent(order.id, 'payment', 'תשלום PayPal להזמנה מבוטלת — יש להחזיר לקונה');
      out = { ok: true, http: 200, status: 'paid', test: false, changed: true, stray: 'cancelled', message: 'התשלום אושר אחרי ביטול ההזמנה. יש להחזיר אותו ידנית.' };
      return;
    }
    const u = db.prepare('UPDATE store_orders SET paid_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND paid_at IS NULL')
      .run(new Date().toISOString(), order.id);
    if (u.changes) db.prepare('UPDATE store_payments SET set_paid = 1 WHERE id = ?').run(row.id);
    O.addEvent(order.id, 'payment', u.changes ? 'שולם ב-PayPal' : 'תשלום PayPal כפול — ההזמנה כבר שולמה');
    out = { ok: true, http: 200, status: 'paid', test: false, sandbox: false, changed: true, stray: u.changes ? '' : 'double', message: 'התשלום ב-PayPal אושר' };
  });
  tx.immediate();
  afterSettle(row.id, out);
  return out;
}

/**
 * After the commit: the owner hears, and the shopper hears when real money
 * arrived for an open order — the same mail the card gateway sends, said
 * as PayPal. A second caller for the same row changed nothing and sends
 * nothing. Best effort; it never costs the settle.
 */
function afterSettle(rowId, out) {
  if (!out || !out.changed) return;
  try {
    const row = db.prepare('SELECT * FROM store_payments WHERE id = ?').get(rowId);
    const O = orders();
    const order = row ? O.getOrderById(row.order_id) : null;
    if (!row || !order) return;
    const notify = require('./notify');
    if (out.status === 'paid') {
      notify.paymentReceived(order, row, O.listItems(order.id), { stray: out.stray || '', test: !!out.test, via: 'ב-PayPal', panel: 'בחשבון ה-PayPal' }).catch(() => {});
    } else if (out.status === 'mismatch') {
      notify.paymentMismatch(order, row, { panel: 'בחשבון ה-PayPal' }).catch(() => {});
    }
  } catch (e) {
    console.error('[store] paypal payment mail failed');
  }
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
  // capturing is taking money: never for an order that was cancelled or
  // paid another way since the buyer opened PayPal's window. Refused before
  // the call, so nothing is charged and there is nothing to give back.
  if (order.status === 'cancelled') return httpError(409, 'CANCELLED', 'ההזמנה בוטלה — לא בוצע חיוב');
  if (order.paid_at) return httpError(409, 'PAID', 'ההזמנה כבר שולמה — לא בוצע חיוב נוסף');
  if (row.mode === 'live' && process.env.TAPUZ_PAYPAL_LIVE !== '1') {
    return httpError(403, 'LIVE_REFUSED', 'מצב אמיתי של PayPal חסום. לא בוצע חיוב.');
  }
  const creds = credentials();
  // was an EARLIER attempt on this row left without an answer?
  const earlier = inDoubt(row);
  // The mark goes on before the call leaves, so a process that dies with
  // the call in the air still leaves a row that says "a capture was tried".
  // A row an earlier refusal had closed is open again for as long as this
  // attempt has no answer: from here until PayPal speaks, it is in doubt.
  const marked = db.prepare("UPDATE store_payments SET status = 'pending', capture_tried_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'failed')")
    .run(new Date().toISOString(), row.id);
  if (!marked.changes) {
    // settled under us between the read and the mark: answer from the row as it is
    const now = db.prepare('SELECT * FROM store_payments WHERE id = ?').get(row.id);
    if (!now) return httpError(404, 'NO_SESSION', 'לא נמצא תשלום פתוח להזמנה הזו');
    if (now.status === 'mismatch') return httpError(409, 'MISMATCH', messageFor(now));
    return { ok: true, http: 200, already: true, status: now.status, test: now.mode === 'test', message: messageFor(now) };
  }
  // its own idempotency key: PayPal remembers a request id, and the create
  // call already used the bare reference
  const result = await postJson(row.mode, creds, '/v2/checkout/orders/' + row.session_id + '/capture', {}, row.reference + '-c', transportOf(opts));
  if (!result.ok) {
    const why = result.error || 'capture failed';
    if (result.transient) {
      db.prepare("UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(why, row.id);
      sayUnknown(order.id);
      return httpError(502, 'TRANSIENT', 'לא הצלחנו לדבר עם PayPal. לא ידוע אם החיוב עבר — אנחנו בודקים, ואין צורך לשלם שוב.', { status: 'pending' });
    }
    if (earlier) {
      // PayPal refused THIS call — which is also what it answers when the
      // earlier one went through ("already captured"). The refusal says
      // nothing about that one, so it closes nothing: PayPal is asked what
      // became of the order, and only that answer moves the row.
      db.prepare("UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(why, row.id);
      await verifyRow(row, { source: 'auto', transport: opts && opts.transport });
      const now = db.prepare('SELECT * FROM store_payments WHERE id = ?').get(row.id);
      if (now && now.status === 'paid') return { ok: true, http: 200, already: true, status: 'paid', test: now.mode === 'test', sandbox: now.mode === 'test', message: messageFor(now) };
      if (now && now.status === 'mismatch') return httpError(409, 'MISMATCH', messageFor(now));
      if (now && now.status === 'failed') return httpError(402, 'FAILED', 'התשלום לא הושלם. לא חויב כלום — אפשר לנסות שוב.');
      sayUnknown(order.id);
      return httpError(409, 'CHECKING', 'התשלום עדיין נבדק מול PayPal. לא ידוע אם החיוב עבר — אין צורך לשלם שוב.', { status: 'pending' });
    }
    // the first attempt, clearly refused: nothing was taken, the row is closed and the order can be paid again
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
    // PayPal holds the capture (a review, a currency the account must
    // accept): the money is on its way or it is not, and only PayPal will
    // say. The row stays in doubt, and the history says so.
    const where = clip(captured.captureStatus || captured.orderStatus || '', 40);
    db.prepare("UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(where ? 'PayPal: ' + where : '', row.id);
    sayUnknown(order.id);
    return httpError(409, 'PENDING', 'PayPal עדיין לא אישר את התשלום. לא סימנו את ההזמנה כשולמה — אנחנו בודקים, ואין צורך לשלם שוב.', { status: 'pending' });
  }
  return settle(row, captured);
}

/**
 * Ask PayPal what became of one pending row — the reconciliation a button
 * flow without a webhook otherwise lacks. A capture that timed out leaves
 * the row pending and the shopper with "לא ידוע אם חויב כסף"; this is what
 * finds out. COMPLETED with a completed capture settles exactly as a capture
 * would (same amount check, same guarded UPDATE, so racing a capture is a
 * no-op); a voided order, a declined capture, or an order PayPal no longer
 * knows closes the row; anything else leaves it pending.
 *
 * `source` 'page' is the order page: the first ask only starts the row's
 * clock, then at most one ask per VERIFY_GAP_MS, VERIFY_MAX in all, inside
 * VERIFY_WINDOW_MS. 'admin' is the owner's own button: no throttle, bounded
 * per row. 'auto' is an ask nobody's hand made (the pay button meeting a
 * row in doubt, the server's own round): the page's gap, AUTO_VERIFY_MAX in
 * all. Returns the shape gateway.verifyPayment returns, so the order page
 * and the admin's check treat a PayPal row like any other. Never throws.
 *
 * A row IN DOUBT is asked about harder and read differently. From the page
 * there is no "start the clock" — a capture was tried, so there is
 * something to find out now. And an order PayPal still shows open with
 * nothing captured on it is, once CAPTURE_GRACE_MS have passed since the
 * attempt, PayPal's clear word that the capture never happened: the row is
 * closed, and the order can be paid again.
 */
async function verifyRow(row, opts = {}) {
  const page = (opts.source || 'page') === 'page';
  const auto = opts.source === 'auto';
  const now = row && row.id ? db.prepare("SELECT * FROM store_payments WHERE id = ? AND provider = 'paypal'").get(row.id) : null;
  if (!now) return { ok: false, status: 'missing', changed: false };
  const same = (extra) => ({ ok: true, status: now.status, changed: false, ...extra });
  if (now.status !== 'pending') return same();
  const doubt = inDoubt(now);
  if (!ORDER_ID_RE.test(now.session_id)) return same({ exhausted: true });
  if (now.verify_count >= (page ? VERIFY_MAX : auto ? AUTO_VERIFY_MAX : ADMIN_VERIFY_MAX)) return same({ exhausted: true });
  if (page && ageMs(now.created_at) > VERIFY_WINDOW_MS) return same({ exhausted: true });
  // The order already has its payment on another row. A page load has
  // nothing to find out about a PayPal order nobody tried to capture — but
  // the owner's own button always asks, and a row in doubt is always asked
  // about: that is the second payment nobody knew of, and settle() records
  // it as a stray "double" and tells the owner to give it back.
  if (page && !doubt && paymentsOf(now.order_id).some((r) => r.status === 'paid')) return same();
  if (now.mode === 'live' && process.env.TAPUZ_PAYPAL_LIVE !== '1') return { ok: false, status: now.status, changed: false, error: LIVE_ARM_TEXT };
  const creds = credentials();
  if (!CLIENT_RE.test(creds.clientId) || creds.clientSecret.length < 8) return { ok: false, status: now.status, changed: false, error: 'חסרים מפתחות PayPal' };

  const stamp = new Date().toISOString();
  let gate = '';
  const params = [stamp, now.id];
  if (page || auto) {
    if (page && !doubt && !now.last_verify_at) {
      db.prepare('UPDATE store_payments SET last_verify_at = ? WHERE id = ? AND last_verify_at IS NULL').run(stamp, now.id);
      return same({ deferred: true });
    }
    // a row that was never asked about has no gap to wait out
    gate = ' AND (last_verify_at IS NULL OR julianday(last_verify_at) <= julianday(?))';
    params.push(new Date(Date.now() - VERIFY_GAP_MS).toISOString());
  }
  // claim the slot with a guarded UPDATE: two page loads cannot both ask
  const claimed = db.prepare("UPDATE store_payments SET verify_count = verify_count + 1, last_verify_at = ? WHERE id = ? AND status = 'pending'" + gate).run(...params);
  if (!claimed.changes) return same({ throttled: true });

  const res = await getJson(now.mode, creds, '/v2/checkout/orders/' + now.session_id, transportOf(opts));
  if (!res.ok) {
    if (res.http === 404) {
      // PayPal keeps an unpaid order for a few hours; past that there is nothing left to capture
      const gone = db.prepare("UPDATE store_payments SET status = 'failed', error = 'PayPal כבר לא מכיר את התשלום הזה — פג תוקפו', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(now.id);
      if (gone.changes) orders().addEvent(now.order_id, 'payment', 'תשלום ה-PayPal פג בלי שהושלם — לא חויב כלום');
      return { ok: true, status: 'failed', changed: !!gone.changes, asked: true };
    }
    db.prepare("UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(res.error || 'inquiry failed', now.id);
    if (doubt) sayUnknown(now.order_id);
    return { ok: false, status: now.status, changed: false, error: res.error || 'inquiry failed', transient: !!res.transient, asked: true };
  }
  const got = parseCapture(res.json);
  if (got.orderStatus === 'COMPLETED' && got.captureStatus === 'COMPLETED') {
    const out = settle(now, got);
    if (out && out.code === 'DUPLICATE') return { ok: false, status: now.status, changed: false, duplicateTransaction: true, error: out.message, asked: true };
    return { ok: !!out && (out.ok || out.status === 'mismatch'), status: (out && out.status) || now.status, changed: !!(out && out.changed), test: !!(out && out.test), asked: true };
  }
  if (got.orderStatus === 'VOIDED' || got.captureStatus === 'DECLINED' || got.captureStatus === 'FAILED') {
    const closed = db.prepare("UPDATE store_payments SET status = 'failed', approval = ?, error = 'נדחה', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
      .run(clip(got.captureStatus || got.orderStatus, 40), now.id);
    if (closed.changes) orders().addEvent(now.order_id, 'payment', 'PayPal מדווח שהתשלום לא הושלם — לא סומן כשולם');
    return { ok: true, status: 'failed', changed: !!closed.changes, asked: true };
  }
  // A row in doubt whose PayPal order still stands open with no capture on
  // it: the capture we tried never landed. Not said in the first minutes —
  // the call we gave up on may still be arriving — and not if another
  // attempt began while we were asking (the stamp is then a newer one).
  if (doubt && !got.captureStatus && OPEN_STATES.has(got.orderStatus) && ageMs(now.capture_tried_at) > CAPTURE_GRACE_MS) {
    const closed = db.prepare("UPDATE store_payments SET status = 'failed', error = 'PayPal מדווח שהחיוב לא בוצע', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending' AND capture_tried_at = ?")
      .run(now.id, now.capture_tried_at);
    if (closed.changes) {
      orders().addEvent(now.order_id, 'payment', 'PayPal מדווח שהחיוב לא בוצע — לא חויב כלום');
      return { ok: true, status: 'failed', changed: true, asked: true };
    }
    return same({ asked: true });
  }
  // CREATED / APPROVED / PAYER_ACTION_REQUIRED, or a capture PayPal still holds: nothing moves
  const where = clip(got.captureStatus || got.orderStatus || '', 40);
  if (doubt) sayUnknown(now.order_id);
  return same({ asked: true, message: where ? 'PayPal: ' + where : '' });
}

/**
 * The server's own round (orders.housekeeping): ask PayPal about rows in
 * doubt, the longest-unasked first, at most ROUND_ASKS real calls a round
 * and each row no more often than its age asks for (ROUND_GAP_MAX_MS), so
 * an order that is being held resolves itself — to paid, or to really
 * unpaid — without waiting for its buyer or its owner to come back. Each
 * row stands alone: one that throws costs the others nothing. Never throws.
 * @returns {Promise<{ asked:number, settled:number, closed:number }>}
 */
async function resolveInDoubt(opts = {}) {
  const out = { asked: 0, settled: 0, closed: 0 };
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM store_payments
      WHERE provider = 'paypal' AND status = 'pending' AND capture_tried_at != '' AND session_id != '' AND verify_count < ?
      ORDER BY (last_verify_at IS NOT NULL), julianday(last_verify_at), id LIMIT 50
    `).all(AUTO_VERIFY_MAX);
  } catch (e) {
    return out;
  }
  for (const row of rows) {
    if (out.asked >= ROUND_ASKS) break;
    // asked recently enough for a doubt of its age: its turn comes in a later round
    if (row.last_verify_at && ageMs(row.last_verify_at) < Math.min(ageMs(row.capture_tried_at) / 4, ROUND_GAP_MAX_MS)) continue;
    try {
      const r = await verifyRow(row, { source: 'auto', transport: opts.transport });
      if (r && r.asked) out.asked++;
      if (r && r.changed && (r.status === 'paid' || r.status === 'mismatch')) out.settled++;
      if (r && r.changed && r.status === 'failed') out.closed++;
    } catch (e) {
      console.error('[store] paypal inquiry of a row in doubt failed');
    }
  }
  return out;
}

function cancelForOrder(token) {
  const order = loadOrder(token);
  if (!order) return httpError(404, 'NOT_FOUND', 'ההזמנה לא נמצאה');
  if (!paypalMethod(order)) return httpError(403, 'NOT_PAYPAL', 'ההזמנה אינה לתשלום ב-PayPal');
  const rows = paymentsOf(order.id);
  const paid = rows.find((r) => r.status === 'paid');
  if (paid) return { ok: true, http: 200, already: true, status: 'paid', message: messageFor(paid) };
  // a window closed over a capture nobody has an answer for is not "nothing was charged"
  if (rows.some(inDoubt)) return { ok: true, http: 200, cancelled: true, status: 'pending', message: CHECKING_TEXT };
  // said once in a row: a buyer who opens and closes the window ten times is one fact, not ten lines of history
  const text = 'הקונה ביטל את תשלום ה-PayPal — לא חויב כלום';
  const last = orders().listEvents(order.id).pop();
  if (!last || last.text !== text) orders().addEvent(order.id, 'payment', text);
  return { ok: true, http: 200, cancelled: true, status: 'pending', message: 'התשלום בוטל. לא חויב כלום — ההזמנה שמורה ואפשר לנסות שוב.' };
}

// ── the admin ("סליקת אשראי" → PayPal) ───────────────────────────────────

function envSet(name) {
  return !!String(process.env[name] || '').trim();
}

/**
 * What the admin screen may know: readiness with its reasons, the mode, and
 * per key whether it is set, its last four characters, and whether the
 * server's environment supplies it (then the screen shows it read-only —
 * the environment wins over the file). Never a value.
 */
function adminSettings(settings) {
  const st = status(settings);
  const creds = credentials();
  const tail = (v) => (v.length >= 8 ? v.slice(-4) : '');
  const envMode = ['live', 'sandbox', 'test'].includes(String(process.env.PAYPAL_MODE || '').trim().toLowerCase());
  return {
    mode: st.mode,
    sandbox: st.sandbox,
    live: st.live,
    liveRefused: st.liveRefused,
    liveArmed: process.env.TAPUZ_PAYPAL_LIVE === '1',
    configured: st.configured,
    ready: st.ready,
    reasons: st.reasons,
    currency: st.currency,
    hasMethod: st.hasMethod,
    modeFromEnv: envMode,
    fields: {
      clientId: { set: !!creds.clientId, tail: tail(creds.clientId), env: envSet('PAYPAL_CLIENT_ID') },
      clientSecret: { set: !!creds.clientSecret, tail: tail(creds.clientSecret), env: envSet('PAYPAL_CLIENT_SECRET') }
    }
  };
}

/**
 * Save from the admin screen into gitignored config/payments.json, through
 * the card gateway's own writer (same file, same owner-only mode, same
 * `undefined` = keep / `''` = clear). A key the environment supplies is not
 * written — the file's copy would never be read. "live" is refused while the
 * server is not armed, and needs `confirmLive: true` on the wire besides, so
 * no stray save can start taking real money. Returns the redacted view.
 */
function saveAdminSettings(patch = {}) {
  const errors = [];
  const block = {};
  const field = (key, envName, label, valid, why) => {
    if (patch[key] === undefined || patch[key] === null) return;
    const v = String(patch[key]).trim();
    if (envSet(envName)) { errors.push(label + ' מוגדר במשתני הסביבה של השרת — הערך שבמסך לא נשמר'); return; }
    if (v && !valid(v)) { errors.push(why); return; }
    block[key] = v;
  };
  field('clientId', 'PAYPAL_CLIENT_ID', 'ה-Client ID', (v) => CLIENT_RE.test(v), 'ה-Client ID אינו נראה כמו מזהה של PayPal — לא נשמר');
  field('clientSecret', 'PAYPAL_CLIENT_SECRET', 'ה-Secret', (v) => v.length >= 8 && v.length <= 300, 'ה-Secret אינו באורך תקין — לא נשמר');
  if (patch.mode !== undefined && patch.mode !== null) {
    const want = String(patch.mode);
    if (want !== 'test' && want !== 'live') errors.push('מצב לא מוכר');
    else if (want === 'live' && process.env.TAPUZ_PAYPAL_LIVE !== '1') errors.push(LIVE_ARM_TEXT + ' — המצב נשאר ארגז חול');
    else if (want === 'live' && readFile().mode !== 'live' && patch.confirmLive !== true) errors.push('המעבר למצב חי דורש אישור מפורש — המצב נשאר ארגז חול');
    else block.mode = want;
  }
  if (Object.keys(block).length) gwConfig.writeSettings({ fields: { paypal: block } });
  // a token bought with the old keys answers for nothing now
  tokenCache = null;
  return { settings: adminSettings(), errors };
}

/**
 * "בדיקת חיבור": ask PayPal for an OAuth token with the stored keys, in the
 * current mode, through this module's own transport. It proves what the
 * readiness regex cannot — that PayPal accepts the keys — and it moves no
 * money and opens no order. The answer is a Hebrew sentence; PayPal's own
 * words are redacted before they are shown.
 */
async function testConnection(opts) {
  const mode = resolveMode();
  if (mode.refused) return { ok: false, message: LIVE_ARM_TEXT + '. לא נשלחה בקשה ל-PayPal.' };
  const creds = credentials();
  if (!CLIENT_RE.test(creds.clientId) || creds.clientSecret.length < 8) {
    return { ok: false, message: 'חסרים מפתחות PayPal — הזינו Client ID ו-Secret, שמרו, ונסו שוב.' };
  }
  tokenCache = null;
  const auth = await accessToken(mode.mode, creds, transportOf(opts));
  const where = mode.mode === 'live' ? 'מצב חי' : 'ארגז חול';
  if (auth.ok) return { ok: true, message: 'החיבור ל-PayPal תקין (' + where + ') — PayPal קיבל את המפתחות.' };
  if (auth.transient) return { ok: false, message: 'לא הצלחנו להגיע ל-PayPal — נסו שוב בעוד רגע.' };
  return {
    ok: false,
    message: 'PayPal דחה את המפתחות (' + where + ')' + (auth.error ? ': ' + auth.error : '') +
      (mode.mode === 'live' ? '.' : '. ודאו שאלה מפתחות של ארגז החול (Sandbox) ולא של החשבון החי.')
  };
}

module.exports = {
  API_HOST,
  SDK_ORIGIN,
  OBJECTS_ORIGIN,
  status,
  isReady,
  offeredPayments,
  cspSources,
  readinessNote,
  readinessNotes,
  publicPayment,
  buildAmount,
  minorToPayPal,
  paypalToMinor,
  createForOrder,
  captureForOrder,
  cancelForOrder,
  verifyRow,
  inDoubt,
  resolveInDoubt,
  adminSettings,
  saveAdminSettings,
  testConnection,
  setTestTransport,
  paymentsOf
};
