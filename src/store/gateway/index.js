'use strict';

/**
 * The card gateway — Grow and Cardcom behind ONE driver interface.
 *
 * The store's `link` method sends a shopper to the owner's own payment page
 * and trusts the owner to mark the order paid. This module is the other
 * thing: a shopper pays on the provider's HOSTED page, and the order is
 * marked paid by us — but only after OUR server confirmed the payment
 * against something only the provider and we hold, and the confirmation
 * matched the order in our database to the agora. Nothing a browser sends
 * is ever a verdict, and a webhook is believed only as far as its own
 * trust anchor goes (below).
 *
 * THE FLOW
 *   1. placeOrder() runs exactly as for any other method — stock and the
 *      coupon use are taken in the same immediate transaction. A `card`
 *      method is only offered (pricing.quote, the checkout page) and only
 *      accepted while the gateway is READY: a provider chosen, its keys
 *      present, the store's currency one it can charge, the driver's own
 *      rules (Cardcom: test mode = the public test terminal 1000 and
 *      nothing else, live mode = anything but 1000), and an https
 *      `config.baseUrl` in BOTH modes — both providers refuse localhost,
 *      and a callback sent to http:// meets a 301 that turns the POST into
 *      an empty GET, so there is no request-origin fallback at all.
 *   2. The order page POSTs /api/store/pay/:token → startSession(): a fresh
 *      pending session (8 minutes — Grow's hosted URL lives 10) is reused,
 *      else a new store_payments row is written with THE AMOUNT FROM THE
 *      DATABASE and our random `reference`, and the driver opens the hosted
 *      page. At most MAX_SESSIONS_PER_ORDER sessions and MAX_ROWS_PER_ORDER
 *      rows per order. The shopper is sent to the https URL the provider
 *      returned — a full page, never an iframe.
 *   3. Two independent triggers, one settle:
 *      - the provider's callback (handleHook). The row is found by the
 *        PROVIDER'S SESSION ID only (Cardcom LowProfileId, Grow processId).
 *        A driver with `hookVerdict` (Grow) authenticates the callback
 *        itself — its trust anchor is the sha256 of the processToken we
 *        stored and never showed anyone; a driver without one (Cardcom)
 *        treats the callback as "ask now" and runs the server-to-server
 *        inquiry (`verify`).
 *      - the order page (verifyForOrder): the inquiry over EVERY unpaid
 *        session of the order, newest first, each behind its own throttle
 *        (the first poll only starts a clock, so a callback a few seconds
 *        away gets its chance), at most two provider calls per page load —
 *        so a missed callback still settles the order when the buyer lands
 *        back, even on an older tab's session. The admin has a per-row
 *        "בדיקה מול חברת הסליקה" for the rest.
 *   4. settle() is ONE immediate transaction with a guarded UPDATE on the
 *      payment row (… AND status IN ('pending','failed')): a duplicate
 *      callback or a concurrent verify is a no-op, and a confirmed payment
 *      always wins over an earlier decline. The amount and the currency the
 *      provider reports must equal the order's, else the row is `mismatch`,
 *      the owner hears, and the order is NOT marked paid. One provider
 *      transaction (per provider and mode) settles one row; a replay is an
 *      owner-visible event. A confirmation for an order that is already
 *      paid or cancelled is still recorded on its row — money moved — with
 *      an owner alert and the refund action.
 *   5. TEST MODE NEVER LOOKS LIKE MONEY: a test confirmation records the
 *      row (mode `test`) and the event "תשלום בדיקה אושר — לא התקבל כסף", but
 *      never sets paid_at, never shows "שולם", never counts as revenue.
 *   6. Refunds are explicit admin actions (never automatic) on a specific
 *      row: the sum is RESERVED on the row before the provider is asked
 *      (two clicks cannot both go through), released on a definite
 *      refusal, kept — and said — when the outcome is unknown. When no
 *      live row holds money any more, the order's paid_at is cleared.
 *      Cancelling an order restocks and says the money must be refunded
 *      separately.
 *
 * THE RULES THAT DO NOT BEND
 *   - Hosts are CONSTANTS inside each driver. No setting, env var or request
 *     field decides where a credential is sent; the transport a driver gets
 *     refuses any other host on top.
 *   - Credentials live in gitignored config/payments.json (config.js) —
 *     never the database, the .pzn, the site package, a log line, an event,
 *     an error message or an API response. Admin screens see readiness and
 *     a last-4 tail. The provider's session ids and tokens (LowProfileId,
 *     processId, processToken, transactionToken) live on the payment row
 *     and never reach a browser, an event, the CSV or a log line; Grow's
 *     processToken is kept only as a hash plus a sealed copy (config.js).
 *   - Every outbound call: POST, AbortSignal.timeout(TIMEOUT_MS), never
 *     throws — a dead provider is `{ ok:false, error, transient }`.
 *   - Provider error text reaches the ADMIN (an order event, the gateway
 *     screen) after redaction; the shopper gets a Hebrew sentence.
 *
 * THE DRIVER CONTRACT (src/store/gateway/cardcom.js, grow.js)
 *   id, label, hosts: ['https://…'], currencies: ['ILS', …],
 *   credentialFields: [{ key, label, required, hint }],
 *   needsWebhookUrl, partialRefund, hookRetryOnTransient, inquiryGraceMs,
 *   readiness?({ credentials, mode, currency }) → Hebrew reasons[]
 *   customerIssues?({ name, phone, email }) → [{ field, message }]
 *   async createSession({ amount, currency, reference, order, method, urls,
 *     customer, items, storeName, credentials, mode, transport })
 *     → { ok, sessionId, sessionToken?, accountTail?, url, error? }
 *   async verify({ payment, credentials, mode, transport })   the inquiry
 *     (payment.session_token is the OPENED token; session_token_sealed says
 *     a sealed one could not be opened on this install)
 *     → { ok, state: 'paid'|'pending'|'failed', amount (minor), currency,
 *         transactionId, transactionToken?, approval, last4, brand,
 *         installments, message?, note?, alert?, transient?, error? }
 *   hookVerdict?({ payment, req }) → the same shape (+ `ack`) when the
 *     callback itself authenticates (against payment.session_token_hash);
 *     { ok:false } otherwise
 *   async acknowledge?({ payment, verify, credentials, mode, transport })
 *   async refund?({ payment, amount, credentials, mode, transport })
 *     → { ok, refundId?, error?, transient? };  refundUnavailable?(credentials) → text
 *   parseHook(req) → { sessionId }          identifiers ONLY, never a verdict
 *   hookReply → { status, type, body }
 *   `transport(call)` → { status, text, json } | { status: 0, error },
 *   call = { url, method, headers, body }. Tests inject one; they never
 *   override a host.
 */

const crypto = require('crypto');
const { db } = require('../../db');
const money = require('../money');
const settingsMod = require('../settings');
const gwConfig = require('./config');

const TIMEOUT_MS = 15000;
const SESSION_FRESH_MS = 8 * 60 * 1000;
const MAX_SESSIONS_PER_ORDER = 10;
// rows that never got a session (the provider refused to open a page) are
// capped too, so an outage cannot grow the table
const MAX_ROWS_PER_ORDER = 30;
// the order page asks at most every VERIFY_GAP_MS (or the driver's own
// grace — Grow's callback deserves ~20 s before we ask), VERIFY_MAX times,
// not past VERIFY_WINDOW_MS, and at most PAGE_CALLS per page load. A
// callback and the admin's own check are bounded by HOOK_MAX per row.
const VERIFY_GAP_MS = 5000;
const VERIFY_MAX = 60;
const HOOK_MAX = 200;
const VERIFY_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_CALLS = 2;

const UNPAID = new Set(['pending', 'failed']);

// ── the registry ──────────────────────────────────────────────────────

const DRIVERS = {};
function registerDriver(driver) {
  if (!driver || !driver.id) throw new Error('a driver needs an id');
  DRIVERS[driver.id] = driver;
}
registerDriver(require('./cardcom'));
registerDriver(require('./grow'));

function driverOf(name) {
  return DRIVERS[gwConfig.providerName(name)] || null;
}

function listDrivers() {
  return Object.values(DRIVERS).map((d) => ({
    id: d.id, label: d.label, currencies: d.currencies.slice(), needsWebhookUrl: !!d.needsWebhookUrl,
    partialRefund: !!d.partialRefund, refunds: typeof d.refund === 'function'
  }));
}

function requiredKeys(driver) {
  return (driver.credentialFields || []).filter((f) => f.required !== false).map((f) => f.key);
}

// ── small helpers ─────────────────────────────────────────────────────

function orders() { return require('../orders'); }

function clip(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function nowIso() { return new Date().toISOString(); }

function ageMs(sqlDate) {
  if (!sqlDate) return Infinity;
  const s = String(sqlDate);
  const d = new Date(s.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  return isNaN(d) ? Infinity : Date.now() - d.getTime();
}

/** Our pass-through value: hex only — Grow's cFields and Cardcom's ReturnValue both want plain characters. */
function newReference() {
  return crypto.randomBytes(10).toString('hex');
}

/** A provider's error text, with every stored credential and token (sealed and opened) blanked before it can reach an event or a screen. */
function redact(text, credentials, row, extra) {
  let s = clip(text, 300);
  const secrets = Object.values(credentials || {})
    .concat(row ? [row.session_token, row.session_token_hash, row.transaction_token, row.session_id] : [])
    .concat(Array.isArray(extra) ? extra : []);
  for (const v of secrets) {
    if (typeof v === 'string' && v.length >= 4) s = s.split(v).join('[redacted]');
  }
  return s;
}

function refuse(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function siteBaseUrl() {
  try { return String(require('../../config').loadConfig().baseUrl || '').trim().replace(/\/+$/, ''); } catch (e) { return ''; }
}

function orderPageUrl(base, settings, query) {
  const pages = require('../../pages');
  return base + pages.publicUrlFor(settings.pages.order) + '?' + query;
}

function hookUrl(base, provider) {
  return base ? base + '/api/store/gateway/' + encodeURIComponent(provider) + '/hook' : '';
}

/** The three return addresses (all the order page, `paid=back`) and the webhook, from ONE https base. */
function returnUrls(base, settings, token, provider) {
  const back = orderPageUrl(base, settings, token ? 'o=' + encodeURIComponent(token) + '&paid=back' : 'paid=test');
  return { success: back, failure: back, cancel: back, hook: hookUrl(base, provider) };
}

/** Only an https URL the provider returned is a place we send a shopper. */
function safeHttpsUrl(u) {
  const s = String(u || '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 2000 ? s : '';
}

function last4Of(v) {
  return String(v == null ? '' : v).replace(/\D/g, '').slice(-4);
}

function installmentsOf(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), settingsMod.MAX_INSTALLMENTS) : 1;
}

// ── the transport ─────────────────────────────────────────────────────

/** POST with a hard timeout. Resolves to a small result; never throws. TLS is never relaxed. */
async function defaultTransport(call) {
  try {
    const res = await fetch(call.url, {
      method: call.method || 'POST',
      headers: call.headers || {},
      body: call.body,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    return { status: res.status, text, json };
  } catch (e) {
    return { status: 0, error: e && e.name === 'TimeoutError' ? 'timeout' : String((e && e.message) || e) };
  }
}

let transportOverride = null;
/** Test seam: every driver call in this process goes through `fn` (null = the real fetch). */
function _setTransport(fn) { transportOverride = typeof fn === 'function' ? fn : null; }

/**
 * The transport a driver gets: the injected one or fetch, wrapped so that a
 * URL outside the driver's own constant hosts is refused before any bytes
 * leave — the second lock on "no setting can redirect a credential".
 */
function guardedTransport(driver, explicit) {
  const inner = explicit || transportOverride || defaultTransport;
  return async (call) => {
    const url = String((call && call.url) || '');
    const hosts = Array.isArray(driver.hosts) ? driver.hosts : [];
    if (!hosts.some((h) => url === h || url.startsWith(h + '/') || url.startsWith(h + '?'))) {
      return { status: 0, error: 'host_not_allowed' };
    }
    try {
      const r = await inner(call);
      return r && typeof r === 'object' ? r : { status: 0, error: 'no_response' };
    } catch (e) {
      return { status: 0, error: String((e && e.message) || e) };
    }
  };
}

/** Call one driver method; a driver that throws is a failed call, not a crash. */
async function callDriver(driver, fn, args) {
  try {
    const r = await driver[fn]({ ...args, transport: guardedTransport(driver, args.transport) });
    return r && typeof r === 'object' ? r : { ok: false, error: 'driver returned nothing' };
  } catch (e) {
    return { ok: false, error: 'driver error: ' + String((e && e.message) || e) };
  }
}

// ── readiness ─────────────────────────────────────────────────────────

const BASE_URL_HINT = 'הגדרות האתר → "כתובת בסיס (baseUrl)"';

/**
 * Where the gateway stands, for the dashboard, the checkout and the pay
 * door. `connected` = provider + keys + currency + the driver's own rules;
 * `ready` adds the https baseUrl. Reasons are Hebrew sentences for the owner.
 */
function status(settings) {
  const s = settings || settingsMod.loadSettings();
  const sel = gwConfig.selection();
  const driver = driverOf(sel.provider);
  const reasons = [];
  if (!driver) reasons.push(sel.provider ? 'חברת הסליקה שנבחרה אינה מוכרת' : 'לא נבחרה חברת סליקה');
  const configured = !!driver && gwConfig.hasAll(sel.provider, requiredKeys(driver));
  if (driver && !configured) reasons.push('חסרים פרטי חיבור ל-' + driver.label);
  const currencyOk = !!driver && driver.currencies.includes(s.currency);
  if (driver && !currencyOk) reasons.push(driver.label + ' לא סולקת במטבע ' + s.currency);
  let driverOk = true;
  if (driver && configured && typeof driver.readiness === 'function') {
    let extra = [];
    try { extra = driver.readiness({ credentials: gwConfig.credentialsFor(sel.provider), mode: sel.mode, currency: s.currency }) || []; } catch (e) { extra = []; }
    for (const r of extra) { reasons.push(String(r)); driverOk = false; }
  }
  const base = siteBaseUrl();
  const https = /^https:\/\//i.test(base);
  if (!https) {
    reasons.push(base
      ? 'כתובת האתר חייבת להתחיל ב-https (עכשיו: ' + base + ') — ' + BASE_URL_HINT
      : 'חסרה כתובת האתר (https) — חברת הסליקה חוזרת אליה ושולחת אליה הודעות. ' + BASE_URL_HINT);
  }
  const live = sel.mode === 'live';
  const connected = !!driver && configured && currencyOk && driverOk;
  const ready = connected && https;
  return {
    provider: sel.provider,
    providerLabel: driver ? driver.label : '',
    mode: sel.mode,
    live,
    configured,
    currency: s.currency,
    currencyOk,
    baseUrl: base,
    https,
    connected,
    ready,
    reasons,
    hasCardMethod: s.payments.some((p) => p.kind === 'card'),
    needsWebhookUrl: !!(driver && driver.needsWebhookUrl),
    webhookUrl: driver && https ? hookUrl(base, sel.provider) : ''
  };
}

function isReady(settings) {
  return status(settings).ready;
}

/** The payment methods a shopper may pick: a `card` method only while the gateway is ready. */
function offeredPayments(settings) {
  const s = settings || settingsMod.loadSettings();
  if (!s.payments.some((p) => p.kind === 'card')) return s.payments;
  const ready = isReady(s);
  return s.payments.filter((p) => p.kind !== 'card' || ready);
}

/** The provider's own rules for the buyer's details (Grow: two names, an Israeli mobile) — checked at checkout, as field errors. */
function customerIssues(customer) {
  const driver = driverOf(gwConfig.selection().provider);
  if (!driver || typeof driver.customerIssues !== 'function') return [];
  try { return driver.customerIssues(customer || {}) || []; } catch (e) { return []; }
}

// ── rows ──────────────────────────────────────────────────────────────

function getPayment(id) {
  return db.prepare('SELECT * FROM store_payments WHERE id = ?').get(Number(id)) || null;
}

function paymentsOf(orderId) {
  return db.prepare('SELECT * FROM store_payments WHERE order_id = ? ORDER BY id DESC').all(Number(orderId));
}

/** The row that holds this order's money (paid, or paid and since refunded), if any; `live` = real money only. */
function paidPayment(orderId, { live = false } = {}) {
  return db.prepare(
    "SELECT * FROM store_payments WHERE order_id = ? AND status IN ('paid', 'refunded')" + (live ? " AND mode = 'live'" : '') + ' ORDER BY id DESC LIMIT 1'
  ).get(Number(orderId)) || null;
}

/** The newest row that still holds money to give back. */
function refundableRow(orderId) {
  return db.prepare("SELECT * FROM store_payments WHERE order_id = ? AND status = 'paid' AND amount - refunded > 0 ORDER BY id DESC LIMIT 1").get(Number(orderId)) || null;
}

/** Was this order paid with REAL money that is still held (so the manual "paid" checkbox must not un-pay it)? */
function isGatewayPaid(orderId) {
  return !!db.prepare("SELECT 1 FROM store_payments WHERE order_id = ? AND mode = 'live' AND status = 'paid' LIMIT 1").get(Number(orderId));
}

function orderView(order) {
  return { id: order.id, number: order.number, token: order.token, total: order.total, currency: order.currency, createdAt: order.created_at };
}

function customerView(order) {
  return { name: clip(order.customer_name, 80), email: clip(order.customer_email, 200), phone: clip(order.customer_phone, 30) };
}

function itemsView(orderId) {
  return orders().listItems(orderId).map((it) => ({
    title: it.title + (it.variant_label ? ' — ' + it.variant_label : ''), qty: it.qty, unit: it.unit_price, total: it.line_total
  }));
}

/** The row as a driver sees it: the sealed processToken opened for the inquiry; never the raw seal. */
function openedRow(row) {
  const sealed = !!row.session_token;
  const opened = sealed ? gwConfig.openToken(row.session_token) : '';
  return { ...row, session_token: opened, session_token_sealed: sealed && !opened };
}

// ── 2. the session ────────────────────────────────────────────────────

/**
 * Open (or reuse) the hosted page for an order.
 * @returns {{ ok:true, url:string, paymentId:number, reused:boolean } | { ok:false, code, message, admin? }}
 */
async function startSession({ order } = {}) {
  if (!order) return refuse('NOT_FOUND', 'ההזמנה לא נמצאה');
  if (order.status === 'cancelled') return refuse('CANCELLED', 'ההזמנה בוטלה — אין מה לשלם');
  if (order.paid_at) return refuse('PAID', 'ההזמנה כבר שולמה');
  if (db.prepare("SELECT 1 FROM store_payments WHERE order_id = ? AND status = 'paid' LIMIT 1").get(order.id)) return refuse('PAID', 'התשלום להזמנה הזו כבר אושר');
  const s = settingsMod.loadSettings();
  const method = s.payments.find((p) => p.id === order.payment_method) || null;
  if (!method || method.kind !== 'card') return refuse('NOT_CARD', 'ההזמנה הזו לא נקבעה לתשלום בכרטיס אשראי');
  const st = status(s);
  if (!st.ready) return refuse('NOT_READY', 'תשלום בכרטיס אינו זמין כרגע — צרו איתנו קשר להשלמת התשלום', { admin: st.reasons.join(' · ') });
  const driver = driverOf(st.provider);
  const ttl = Number(driver.sessionTtlMs) > 0 ? Math.min(Number(driver.sessionTtlMs), SESSION_FRESH_MS) : SESSION_FRESH_MS;

  // a fresh pending session for the SAME amount is the same page — hand it back
  const fresh = db.prepare(`
    SELECT * FROM store_payments WHERE order_id = ? AND status = 'pending' AND provider = ? AND mode = ?
      AND url != '' AND amount = ? AND currency = ? ORDER BY id DESC LIMIT 1
  `).get(order.id, st.provider, st.mode, order.total, order.currency);
  if (fresh && ageMs(fresh.created_at) < ttl) return { ok: true, url: fresh.url, paymentId: fresh.id, reused: true };

  const sessions = db.prepare("SELECT COUNT(*) AS n FROM store_payments WHERE order_id = ? AND session_id != ''").get(order.id).n;
  const rows = db.prepare('SELECT COUNT(*) AS n FROM store_payments WHERE order_id = ?').get(order.id).n;
  if (sessions >= MAX_SESSIONS_PER_ORDER || rows >= MAX_ROWS_PER_ORDER) {
    return refuse('TOO_MANY', 'נפתחו יותר מדי ניסיונות תשלום להזמנה הזו — צרו איתנו קשר להשלמת התשלום');
  }

  const urls = returnUrls(st.baseUrl, s, order.token, st.provider);
  const reference = newReference();
  const credentials = gwConfig.credentialsFor(st.provider);

  // the row first, then the provider: a callback can never arrive for a session we do not hold
  const info = db.prepare(`
    INSERT INTO store_payments (order_id, provider, mode, reference, amount, currency) VALUES (?, ?, ?, ?, ?, ?)
  `).run(order.id, st.provider, st.mode, reference, order.total, order.currency);
  const paymentId = Number(info.lastInsertRowid);

  const r = await callDriver(driver, 'createSession', {
    amount: order.total, currency: order.currency, reference,
    order: orderView(order), method: { id: method.id, label: method.label, maxPayments: method.maxPayments || 1 },
    urls, customer: customerView(order), items: itemsView(order.id), storeName: settingsMod.storeName(s),
    credentials, mode: st.mode
  });
  const url = r && r.ok ? safeHttpsUrl(r.url) : '';
  if (!url) {
    const why = redact((r && r.error) || (r && r.ok ? 'the provider returned no https page' : 'unknown'), credentials, null, [r && r.sessionToken]);
    db.prepare("UPDATE store_payments SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(why, paymentId);
    orders().addEvent(order.id, 'payment', 'פתיחת דף תשלום ב-' + driver.label + ' נכשלה' + (why ? ': ' + why : ''));
    return refuse('PROVIDER', 'חברת הסליקה לא פתחה דף תשלום — נסו שוב בעוד רגע', { admin: why });
  }
  const token = clip(r.sessionToken, 500);
  db.prepare(`
    UPDATE store_payments SET session_id = ?, session_token = ?, session_token_hash = ?, account_tail = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(clip(r.sessionId, 200), gwConfig.sealToken(token), gwConfig.hashToken(token), clip(r.accountTail, 8), url, paymentId);
  orders().addEvent(order.id, 'payment', 'נפתח דף תשלום ב-' + driver.label + (st.live ? '' : ' (מצב בדיקות)'));
  return { ok: true, url, paymentId, reused: false };
}

// ── 4. settle ─────────────────────────────────────────────────────────

function cardText(v) {
  const parts = [];
  if (v.approval) parts.push('אישור ' + clip(v.approval, 40));
  if (last4Of(v.last4)) parts.push('כרטיס ‎····' + last4Of(v.last4));
  const n = installmentsOf(v.installments);
  if (n > 1) parts.push(n + ' תשלומים');
  return parts.join(' · ');
}

function howText(driver, how) {
  const label = driver ? driver.label : 'חברת הסליקה';
  return how === 'hook' ? 'אושר בהודעת ' + label : 'אושר בבירור מול ' + label;
}

const DUPLICATE_TXN_TEXT = 'העסקה כבר נרשמה בתשלום אחר — ההזמנה לא סומנה כשולמה; בדקו בממשק החברה';

/**
 * ONE immediate transaction: the guarded row update, the amount/currency
 * check, the order's paid_at (live mode only), one event that says HOW the
 * payment was confirmed. Returns what changed; a second caller for the
 * same row changes nothing. A transaction id already recorded on another
 * row (the UNIQUE index) is refused and said to the owner; any other
 * database error is logged and rethrown.
 * @param {'hook'|'inquiry'} [opts.how]
 */
function settle(paymentRow, v, opts = {}) {
  const O = orders();
  const driver = driverOf(paymentRow.provider);
  const how = howText(driver, opts.how);
  let out = { ok: true, status: 'pending', changed: false };
  const tx = db.transaction(() => {
    const order = O.getOrderById(paymentRow.order_id);
    if (!order) { out = { ok: false, status: 'pending', changed: false, error: 'order missing' }; return; }
    const amount = Number(v.amount);
    const currency = String(v.currency || '').toUpperCase();
    const amountOk = Number.isInteger(amount) && amount === order.total;
    const currencyOk = !!currency && currency === order.currency;
    const matched = amountOk && currencyOk;
    const mismatch = matched ? '' :
      'חברת הסליקה דיווחה על ' + (Number.isInteger(amount) ? money.formatMoney(amount, currency || order.currency) : '?') +
      (currency && currency !== order.currency ? ' (' + currency + ')' : '') + ' — ההזמנה היא ' + money.formatMoney(order.total, order.currency);
    let r;
    try {
      // the sealed processToken leaves with the pending state: nothing settled needs it
      r = db.prepare(`
        UPDATE store_payments SET status = ?, transaction_id = ?, transaction_token = ?, approval = ?, card_last4 = ?, card_brand = ?,
          installments = ?, error = ?, session_token = '', updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status IN ('pending', 'failed')
      `).run(matched ? 'paid' : 'mismatch', clip(v.transactionId, 80), clip(v.transactionToken, 200), clip(v.approval, 40), last4Of(v.last4),
        clip(v.brand, 40), installmentsOf(v.installments), mismatch, paymentRow.id);
    } catch (e) {
      if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        out = { ok: false, status: paymentRow.status, changed: false, duplicateTransaction: true, error: DUPLICATE_TXN_TEXT };
        return;
      }
      console.error('[store] settle failed:', e.message);
      throw e;
    }
    if (!r.changes) {
      const now = getPayment(paymentRow.id);
      out = { ok: true, status: now ? now.status : 'missing', changed: false, duplicate: true };
      return;
    }
    const note = v.note ? ' · ' + clip(v.note, 200) : '';
    if (!matched) {
      O.addEvent(order.id, 'payment', 'אי-התאמה בתשלום בכרטיס: ' + mismatch + ' — ההזמנה לא סומנה כשולמה · ' + how + note);
      out = { ok: true, status: 'mismatch', changed: true };
      return;
    }
    const details = cardText(v);
    if (paymentRow.mode === 'test') {
      // a test confirmation is recorded and said — and is never money
      O.addEvent(order.id, 'payment', 'תשלום בדיקה אושר — לא התקבל כסף · ' + how + (details ? ' · ' + details : '') + note);
      out = { ok: true, status: 'paid', changed: true, test: true, alert: v.alert ? clip(v.alert, 300) : '' };
      return;
    }
    if (order.status === 'cancelled') {
      O.addEvent(order.id, 'payment', 'תשלום להזמנה מבוטלת — יש להחזיר לקונה · ' + (driver ? driver.label + ' · ' : '') + details + ' · ' + how + note);
      out = { ok: true, status: 'paid', changed: true, stray: 'cancelled' };
      return;
    }
    const u = db.prepare('UPDATE store_orders SET paid_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND paid_at IS NULL').run(nowIso(), order.id);
    if (u.changes) {
      // this row is what marked the order paid — only such a row's refund may un-mark it
      db.prepare('UPDATE store_payments SET set_paid = 1 WHERE id = ?').run(paymentRow.id);
      O.addEvent(order.id, 'payment', 'שולם בכרטיס אשראי' + (driver ? ' (' + driver.label + ')' : '') + (details ? ' · ' + details : '') + ' · ' + how + note);
      out = { ok: true, status: 'paid', changed: true };
    } else {
      O.addEvent(order.id, 'payment', 'תשלום כפול — ההזמנה כבר שולמה, יש להחזיר לקונה · ' + (driver ? driver.label + ' · ' : '') + details + ' · ' + how + note);
      out = { ok: true, status: 'paid', changed: true, stray: 'double' };
    }
  });
  tx.immediate();
  if (out.duplicateTransaction) afterDuplicate(paymentRow, how);
  if (out.changed) afterSettle(paymentRow.id, out);
  return out;
}

/** A transaction id that already settled another row: the owner sees it on the order and in the mail; the row keeps the reason. */
function afterDuplicate(row, how) {
  try {
    const text = DUPLICATE_TXN_TEXT + ' · ' + how;
    db.prepare('UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(text, row.id);
    orders().addEvent(row.order_id, 'payment', text);
    const order = orders().getOrderById(row.order_id);
    if (order) require('../notify').paymentMismatch(order, getPayment(row.id) || { ...row, error: text }).catch(() => {});
  } catch (e) {
    console.error('[store] duplicate-transaction note failed:', e.message);
  }
}

/** After the commit: the owner hears, the shopper hears (live, matched, customerEmails) — best effort, never blocking. */
function afterSettle(paymentId, out) {
  try {
    const row = getPayment(paymentId);
    const O = orders();
    const order = row ? O.getOrderById(row.order_id) : null;
    if (!row || !order) return;
    const notify = require('../notify');
    if (out.status === 'paid') {
      notify.paymentReceived(order, row, O.listItems(order.id), { stray: out.stray || '', test: !!out.test, alert: out.alert || '' }).catch(() => {});
    } else if (out.status === 'mismatch') {
      notify.paymentMismatch(order, row).catch(() => {});
    }
  } catch (e) {
    console.error('[store] payment mail failed:', e.message);
  }
}

// ── 3. verify (the inquiry) ───────────────────────────────────────────

/**
 * Ask the provider about one unpaid row and act on the answer. `source` is
 * 'page' (the first poll only starts the clock; then throttled to the
 * driver's grace, bounded, windowed), 'hook' or 'admin' (bounded by
 * HOOK_MAX only). Never throws. `transient` = our own call failed;
 * `asked` = the provider was really called.
 */
async function verifyPayment(payment, { source = 'page' } = {}) {
  const row = getPayment(payment && payment.id);
  if (!row) return { ok: false, status: 'missing', changed: false };
  if (!UNPAID.has(row.status)) return { ok: true, status: row.status, changed: false };
  const driver = driverOf(row.provider);
  if (!driver) return { ok: false, status: row.status, changed: false, error: 'unknown provider' };
  if (!row.session_id) return { ok: true, status: row.status, changed: false, exhausted: true };

  const page = source === 'page';
  const bound = page ? VERIFY_MAX : HOOK_MAX;
  if (row.verify_count >= bound) return { ok: true, status: row.status, changed: false, exhausted: true };
  if (page && ageMs(row.created_at) > VERIFY_WINDOW_MS) return { ok: true, status: row.status, changed: false, exhausted: true };

  let gate = '';
  const params = [nowIso(), row.id];
  if (page) {
    // the buyer just landed back: the first poll only starts the clock —
    // the provider's callback may be seconds away and deserves its chance
    if (!row.last_verify_at) {
      db.prepare('UPDATE store_payments SET last_verify_at = ? WHERE id = ? AND last_verify_at IS NULL').run(nowIso(), row.id);
      return { ok: true, status: row.status, changed: false, deferred: true };
    }
    const grace = Math.max(VERIFY_GAP_MS, Number(driver.inquiryGraceMs) || 0);
    // julianday() reads both the ISO stamps we write and SQLite's own datetime() form
    gate = ' AND julianday(last_verify_at) <= julianday(?)';
    params.push(new Date(Date.now() - grace).toISOString());
  }
  // claim the slot with a guarded UPDATE, so two concurrent callers cannot
  // both pass the throttle and ask the provider twice for one answer
  const claimed = db.prepare(
    "UPDATE store_payments SET verify_count = verify_count + 1, last_verify_at = ? WHERE id = ? AND status IN ('pending', 'failed')" + gate
  ).run(...params);
  if (!claimed.changes) return { ok: true, status: row.status, changed: false, throttled: true };

  const credentials = gwConfig.credentialsFor(row.provider);
  const opened = openedRow(row);
  const v = await callDriver(driver, 'verify', { payment: opened, credentials, mode: row.mode });
  const scrub = (t) => redact(t, credentials, row, [opened.session_token]);
  if (!v || !v.ok) {
    const why = scrub((v && v.error) || 'unknown');
    db.prepare("UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'failed')").run(why, row.id);
    return { ok: false, status: row.status, changed: false, error: why, transient: !!(v && v.transient), asked: true };
  }
  if (v.state === 'pending') {
    // inconclusive: the page is not done (or a developer error the admin should read) — nothing moves
    if (v.message) db.prepare("UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('pending', 'failed')").run(scrub(v.message), row.id);
    return { ok: true, status: row.status, changed: false, asked: true, message: v.message ? scrub(v.message) : '' };
  }
  if (v.state === 'failed') {
    const why = scrub(v.message || v.error || '');
    const r = db.prepare("UPDATE store_payments SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(why, row.id);
    if (r.changes) orders().addEvent(row.order_id, 'payment', 'התשלום בכרטיס לא הושלם' + (why ? ' (' + driver.label + ': ' + why + ')' : ''));
    return { ok: true, status: 'failed', changed: !!r.changes, asked: true };
  }
  if (v.state !== 'paid') return { ok: false, status: row.status, changed: false, error: 'unknown state', asked: true };
  return { ...settle(row, v, { how: 'inquiry' }), asked: true };
}

/**
 * The order page's trigger: EVERY unpaid session of the order, newest
 * first, each behind its own throttle; stops on a settle; at most
 * PAGE_CALLS real provider calls per page load (a throttled, deferred or
 * exhausted row costs nothing).
 */
async function verifyForOrder(order, opts = {}) {
  if (!order || order.paid_at || order.status === 'cancelled') return null;
  const rows = db.prepare("SELECT * FROM store_payments WHERE order_id = ? AND status IN ('pending', 'failed') AND session_id != '' ORDER BY id DESC").all(order.id)
    .filter((r) => ageMs(r.created_at) <= VERIFY_WINDOW_MS);
  let asked = 0;
  let last = null;
  for (const row of rows) {
    if (asked >= PAGE_CALLS) break;
    const r = await verifyPayment(row, { source: opts.source || 'page' });
    last = r || last;
    if (r && r.asked) asked++;
    if (r && r.changed && r.status === 'paid') break;
  }
  return last;
}

// ── 3a. the provider's callback ───────────────────────────────────────

function reply(driver, status) {
  const base = (driver && driver.hookReply) || { status: 200, type: 'text/plain', body: 'OK' };
  return { status: status || base.status || 200, type: base.type || 'text/plain', body: String(base.body == null ? 'OK' : base.body) };
}

const NO_KEYS_ACK_TEXT = 'ההודעה אומתה ונרשמה, אבל פרטי החיבור אינם מוגדרים — האישור (approveTransaction) לא נשלח; הזינו את הפרטים מחדש';

/**
 * A provider's callback. The row is found by the provider's SESSION ID only
 * (never by anything a body could substitute); then either the driver
 * authenticates the callback itself (Grow: the stored processToken hash),
 * or the callback is a hint to run the inquiry (Cardcom). The reply is
 * what the provider expects — the same for a refusal, an unknown id and a
 * settled outcome, so the door is no oracle; a 5xx only when OUR inquiry
 * failed (or cannot run: the keys are gone) for a known unpaid row, so the
 * provider retries. Keys that are gone never lose a real callback: Grow's
 * settles by hash, Cardcom's is said on the order and retried.
 * @returns {{ status:number, type:string, body:string }}
 */
async function handleHook(providerName, req) {
  const provider = gwConfig.providerName(providerName);
  const driver = driverOf(provider);
  if (!driver) return { status: 404, type: 'text/plain', body: 'not found' };
  const hasKeys = gwConfig.hasAll(provider, requiredKeys(driver));
  let ids = null;
  try { ids = driver.parseHook(req) || null; } catch (e) { ids = null; }
  const sid = clip(ids && ids.sessionId, 200);
  const row = sid ? db.prepare('SELECT * FROM store_payments WHERE provider = ? AND session_id = ? ORDER BY id DESC LIMIT 1').get(provider, sid) : null;
  // an unknown id: the provider's usual reply while we hold its keys (no oracle); nobody's callback without them
  if (!row) return hasKeys ? reply(driver) : { status: 404, type: 'text/plain', body: 'not found' };
  const credentials = hasKeys ? gwConfig.credentialsFor(provider) : {};

  if (typeof driver.hookVerdict === 'function') {
    // token-anchored: the callback IS the verdict, when it authenticates — keys or no keys
    let v = null;
    try { v = driver.hookVerdict({ payment: row, req }); } catch (e) { v = null; }
    if (!v || !v.ok || v.state !== 'paid') return reply(driver);
    if (UNPAID.has(row.status)) {
      try { settle(row, v, { how: 'hook' }); } catch (e) { console.error('[store] settle failed:', e.message); }
    }
    // the acknowledgement, after every passing callback (the provider resends until it hears it); its failure never un-settles
    if (typeof driver.acknowledge === 'function' && v.ack) {
      if (!hasKeys) {
        db.prepare('UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(NO_KEYS_ACK_TEXT, row.id);
      } else {
        const a = await callDriver(driver, 'acknowledge', { payment: getPayment(row.id) || row, verify: v, credentials, mode: row.mode });
        if (!a || !a.ok) {
          db.prepare('UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('אישור קבלת ההודעה (approveTransaction) נכשל: ' + redact((a && a.error) || 'unknown', credentials, row), row.id);
        }
      }
    }
    return reply(driver);
  }

  // inquiry-anchored: the callback only says "ask now"
  if (!UNPAID.has(row.status)) return reply(driver);
  if (!hasKeys) {
    // said ONCE per row, and the provider is asked to retry — it will, for about a day
    const text = 'התקבלה הודעת תשלום מ-' + driver.label + ' אבל פרטי החיבור אינם מוגדרים — הזינו אותם מחדש או בדקו בממשק ' + driver.label;
    if (row.error !== text) {
      db.prepare('UPDATE store_payments SET error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(text, row.id);
      orders().addEvent(row.order_id, 'payment', text);
    }
    return reply(driver, driver.hookRetryOnTransient ? 503 : 200);
  }
  let r = null;
  try { r = await verifyPayment(row, { source: 'hook' }); } catch (e) { r = null; }
  if (r && r.transient && driver.hookRetryOnTransient) return reply(driver, 503);
  return reply(driver);
}

// ── 5. refund (explicit, admin) ───────────────────────────────────────

/**
 * When the gateway itself marked the order paid (a row with set_paid) and
 * no live row holds money any more, the order is no longer paid — in the
 * same transaction as the books. An order the owner marked paid by hand
 * (the buyer paid another way) keeps its mark whatever happens to a stray
 * card payment.
 */
function clearPaidIfNothingLeft(orderId) {
  const order = orders().getOrderById(orderId);
  if (!order || !order.paid_at) return false;
  const ours = db.prepare('SELECT 1 FROM store_payments WHERE order_id = ? AND set_paid = 1 LIMIT 1').get(orderId);
  if (!ours) return false;
  const held = db.prepare("SELECT COUNT(*) AS n FROM store_payments WHERE order_id = ? AND mode = 'live' AND status IN ('paid', 'refunded') AND amount - refunded > 0").get(orderId).n;
  if (held) return false;
  db.prepare('UPDATE store_orders SET paid_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND paid_at IS NOT NULL').run(orderId);
  orders().addEvent(orderId, 'payment', 'סימון התשלום הוסר — הכסף הוחזר במלואו');
  return true;
}

// one refund per row at a time: the lock is claimed inside the reservation
// and released whatever the outcome; a lock older than this is a crash's
// leftover and no longer counts
const REFUND_LOCK_MS = 2 * 60 * 1000;
const UNRESOLVED_TEXT = 'יש לברר קודם את ההחזר הקודם — תוצאתו לא ידועה';
const BUSY_TEXT = 'החזר אחר לתשלום הזה כבר בדרך, או שלא נשאר מה להחזיר — רעננו את המסך';

/** A refund of this row is at the provider right now: its lock is younger than REFUND_LOCK_MS. */
function refundInFlight(row) {
  return !!(row && row.refund_lock && ageMs(row.refund_lock) < REFUND_LOCK_MS);
}

/**
 * Refund through the provider — a specific row (`paymentId`, validated
 * against the order) or the newest row that still holds money. `amount`
 * in minor units; absent = everything still refundable. The sum is
 * RESERVED on the row — and the row locked — before the provider is
 * asked: a second click, or a concurrent one, is refused; a definite
 * refusal releases the reservation; an unknown outcome keeps it as
 * `refund_unknown` for the owner to resolve (resolveUnknownRefund), and
 * until then no further refund touches that row.
 */
async function refund({ order, amount, paymentId, by } = {}) {
  if (!order) return refuse('NOT_FOUND', 'ההזמנה לא נמצאה');
  let row = null;
  if (paymentId !== undefined && paymentId !== null && paymentId !== '') {
    row = getPayment(paymentId);
    if (!row || row.order_id !== order.id) return refuse('NOT_FOUND', 'התשלום לא נמצא בהזמנה הזו');
    if (!(row.status === 'paid' || row.status === 'refunded')) return refuse('NO_PAYMENT', 'השורה הזו אינה תשלום שאושר');
  } else {
    row = refundableRow(order.id);
    if (!row) return refuse('NO_PAYMENT', 'להזמנה הזו אין תשלום בכרטיס שאפשר להחזיר');
  }
  // an unknown sum on the row is either a refund at the provider right now (its lock is fresh) or one whose answer never came
  if (row.refund_unknown > 0) return refundInFlight(row) ? refuse('BUSY', BUSY_TEXT) : refuse('UNRESOLVED', UNRESOLVED_TEXT);
  const driver = driverOf(row.provider);
  if (!driver) return refuse('NO_DRIVER', 'חברת הסליקה של התשלום אינה מוכרת');
  if (typeof driver.refund !== 'function') return refuse('UNSUPPORTED', driver.label + ' לא תומכת בהחזר דרך המערכת — יש להחזיר מהממשק של חברת הסליקה');
  const credentials = gwConfig.credentialsFor(row.provider);
  const unavailable = typeof driver.refundUnavailable === 'function' ? driver.refundUnavailable(credentials) : '';
  if (unavailable) return refuse('UNAVAILABLE', unavailable);
  const left = row.amount - row.refunded;
  if (left <= 0) return refuse('DONE', 'התשלום כבר הוחזר במלואו');
  const want = amount === undefined || amount === null || amount === '' ? left : Number(amount);
  if (!Number.isInteger(want) || want <= 0 || want > left) return refuse('AMOUNT', 'סכום ההחזר חייב להיות בין אגורה אחת ל-' + money.formatMoney(left, row.currency));
  if (want < left && !driver.partialRefund) return refuse('PARTIAL_UNSUPPORTED', driver.label + ' לא תומכת בהחזר חלקי — אפשר להחזיר רק את הסכום המלא');
  const sum = money.formatMoney(want, row.currency);
  const who = by ? ' · בידי ' + clip(by, 40) : '';

  // reserve first, and take the row's lock in the same guarded UPDATE: the
  // books say "refunded" before a single byte leaves, and a second refund
  // of this row — concurrent or not — is refused until this one completes.
  // The sum is reserved AS UNKNOWN until the provider answers: a process
  // that dies mid-call leaves the owner's decision on the order screen
  // (once the lock has aged out), never a silent "refunded".
  const reserved = db.prepare(`
    UPDATE store_payments SET refunded = refunded + ?, status = CASE WHEN refunded + ? >= amount THEN 'refunded' ELSE status END,
      refund_unknown = refund_unknown + ?, refund_lock = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('paid', 'refunded') AND refunded + ? <= amount AND refund_unknown = 0
      AND (refund_lock IS NULL OR julianday(refund_lock) < julianday(?))
  `).run(want, want, want, nowIso(), row.id, want, new Date(Date.now() - REFUND_LOCK_MS).toISOString());
  if (!reserved.changes) return refuse('BUSY', BUSY_TEXT);

  const r = await callDriver(driver, 'refund', { payment: row, amount: want, credentials, mode: row.mode });
  if (!r || !r.ok) {
    const why = redact((r && r.error) || 'unknown', credentials, row);
    if (r && r.transient) {
      // the outcome is unknown: the reservation stays as the UNKNOWN sum it was reserved as, for the owner to resolve; the order keeps its mark meanwhile
      db.transaction(() => {
        db.prepare('UPDATE store_payments SET refund_lock = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
        orders().addEvent(order.id, 'payment', 'תוצאת ההחזר לא ידועה (' + sum + ') — הסכום נרשם כהוחזר; בדקו בממשק החברה ואשרו במסך ההזמנה אם בוצע או לא' + (why ? ' · ' + why : '') + who);
      }).immediate();
      return refuse('UNKNOWN', 'תוצאת ההחזר לא ידועה — הסכום נרשם כהוחזר; בדקו בממשק חברת הסליקה ואשרו במסך ההזמנה אם ההחזר בוצע או לא');
    }
    // a definite refusal: the reservation (and its unknown mark) and the lock are released
    db.prepare(`
      UPDATE store_payments SET refunded = refunded - ?, status = CASE WHEN refunded - ? < amount THEN 'paid' ELSE 'refunded' END,
        refund_unknown = MAX(refund_unknown - ?, 0), refund_lock = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(want, want, want, row.id);
    orders().addEvent(order.id, 'payment', 'החזר של ' + sum + ' נכשל' + (why ? ' (' + driver.label + ': ' + why + ')' : '') + who);
    return refuse('PROVIDER', 'חברת הסליקה לא אישרה את ההחזר' + (why ? ': ' + why : ''));
  }
  const full = want >= left;
  let unpaid = false;
  db.transaction(() => {
    // the provider said yes: the sum is no longer unknown
    db.prepare('UPDATE store_payments SET refund_unknown = MAX(refund_unknown - ?, 0), refund_lock = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(want, row.id);
    orders().addEvent(order.id, 'payment', 'הוחזרו ' + sum + ' בכרטיס אשראי (' + (full ? 'החזר מלא' : 'החזר חלקי') + ')' +
      (row.mode === 'test' ? ' · בדיקה' : '') + (r.refundId ? ' · ' + clip(r.refundId, 60) : '') + who);
    unpaid = clearPaidIfNothingLeft(order.id);
  }).immediate();
  return { ok: true, refunded: want, full, refundId: clip(r.refundId, 60), left: left - want, paymentId: row.id, unpaid };
}

/**
 * The owner looked in the provider's panel and says what happened to a
 * refund whose outcome we never learned. 'done' keeps the books (and may
 * un-mark the order); 'undone' gives the sum back to the row.
 */
function resolveUnknownRefund({ order, paymentId, outcome, by } = {}) {
  if (!order) return refuse('NOT_FOUND', 'ההזמנה לא נמצאה');
  const row = getPayment(paymentId);
  if (!row || row.order_id !== order.id) return refuse('NOT_FOUND', 'התשלום לא נמצא בהזמנה הזו');
  if (!(row.refund_unknown > 0)) return refuse('NOTHING', 'אין החזר בתוצאה לא ידועה בשורה הזו');
  // a refund still at the provider is not the owner's to decide yet — its own answer settles it
  if (refundInFlight(row)) return refuse('BUSY', 'ההחזר עדיין בדרך אל חברת הסליקה — רעננו את המסך בעוד רגע');
  const sum = money.formatMoney(row.refund_unknown, row.currency);
  const who = by ? ' · בידי ' + clip(by, 40) : '';
  const lockCut = new Date(Date.now() - REFUND_LOCK_MS).toISOString();
  let unpaid = false;
  if (outcome === 'done') {
    db.transaction(() => {
      const r = db.prepare(`
        UPDATE store_payments SET refund_unknown = 0, refund_lock = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND refund_unknown > 0 AND (refund_lock IS NULL OR julianday(refund_lock) < julianday(?))
      `).run(row.id, lockCut);
      if (!r.changes) return;
      orders().addEvent(order.id, 'payment', 'ההחזר של ' + sum + ' אושר כבוצע (נבדק בממשק החברה)' + who);
      unpaid = clearPaidIfNothingLeft(order.id);
    }).immediate();
    return { ok: true, outcome: 'done', unpaid, paymentId: row.id };
  }
  if (outcome === 'undone') {
    db.transaction(() => {
      const r = db.prepare(`
        UPDATE store_payments SET refunded = refunded - refund_unknown,
          status = CASE WHEN refunded - refund_unknown < amount THEN 'paid' ELSE status END,
          refund_unknown = 0, refund_lock = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND refund_unknown > 0 AND (refund_lock IS NULL OR julianday(refund_lock) < julianday(?))
      `).run(row.id, lockCut);
      if (!r.changes) return;
      orders().addEvent(order.id, 'payment', 'ההחזר של ' + sum + ' לא בוצע — הסכום שוחרר וניתן להחזיר שוב' + who);
    }).immediate();
    return { ok: true, outcome: 'undone', paymentId: row.id };
  }
  return refuse('OUTCOME', 'יש לומר אם ההחזר בוצע או לא');
}

// ── the admin ─────────────────────────────────────────────────────────

/**
 * A ₪1 session in the current mode: proves the keys, the host and the
 * mode; charges nothing. The page's address is handed back in TEST mode
 * only — a live ₪1 page is a payable link, and the owner is told it was
 * opened and deliberately not shown.
 */
async function testConnection() {
  const s = settingsMod.loadSettings();
  const st = status(s);
  if (!st.ready) return { ok: false, message: st.reasons.join(' · ') };
  const driver = driverOf(st.provider);
  const credentials = gwConfig.credentialsFor(st.provider);
  const r = await callDriver(driver, 'createSession', {
    amount: 100, currency: s.currency, reference: 'test' + newReference(),
    order: { id: 0, number: 'TEST', token: '', total: 100, currency: s.currency },
    method: { id: 'test', label: 'בדיקת חיבור', maxPayments: 1 },
    urls: returnUrls(st.baseUrl, s, '', st.provider),
    // a placeholder buyer that satisfies every driver's rules (two names, an Israeli mobile) — nobody pays this page
    customer: { name: 'בדיקת חיבור', email: '', phone: '0500000000' },
    items: [{ title: 'בדיקת חיבור', qty: 1, unit: 100, total: 100 }],
    storeName: settingsMod.storeName(s),
    credentials, mode: st.mode
  });
  const url = r && r.ok ? safeHttpsUrl(r.url) : '';
  if (!url) return { ok: false, message: 'חברת הסליקה השיבה: ' + redact((r && r.error) || 'לא התקבל דף תשלום', credentials, null, [r && r.sessionToken]) };
  if (st.live) return { ok: true, message: 'החיבור ל-' + driver.label + ' תקין (מצב אמיתי) — דף של ₪1 נפתח אצל החברה ובכוונה אינו מוצג כאן, כי אפשר לשלם בו באמת' };
  return { ok: true, message: 'החיבור ל-' + driver.label + ' תקין (מצב בדיקות)', url };
}

/** The redacted settings for the gateway screen: readiness, mode, provider, tails — never a value, never the token key. */
function adminSettings(settings) {
  const st = status(settings);
  const sel = gwConfig.selection();
  return {
    provider: sel.provider,
    mode: sel.mode,
    connected: st.connected,
    ready: st.ready,
    reasons: st.reasons,
    currency: st.currency,
    baseUrl: st.baseUrl,
    https: st.https,
    baseUrlHint: BASE_URL_HINT,
    hasCardMethod: st.hasCardMethod,
    webhookUrl: st.webhookUrl,
    needsWebhookUrl: st.needsWebhookUrl,
    providers: Object.values(DRIVERS).map((d) => {
      const known = gwConfig.describeFields(d.id, (d.credentialFields || []).map((f) => f.key));
      return {
        id: d.id, label: d.label, currencies: d.currencies.slice(), needsWebhookUrl: !!d.needsWebhookUrl,
        refunds: typeof d.refund === 'function', partialRefund: !!d.partialRefund, notes: (d.notes || []).slice(),
        fields: (d.credentialFields || []).map((f) => ({ key: f.key, label: f.label, hint: f.hint || '', required: f.required !== false, ...known[f.key] }))
      };
    })
  };
}

/**
 * Save from the gateway screen. Only keys a driver declares can land;
 * `undefined` keeps, `''` clears. Switching test → live needs
 * `confirmLive: true` on the wire — the screen sends it only after its
 * own confirm() — so a stray save cannot start charging real money.
 * Returns the redacted view.
 */
function saveAdminSettings(patch = {}) {
  const errors = [];
  const out = {};
  if (patch.provider !== undefined) {
    const p = gwConfig.providerName(patch.provider);
    if (p && !DRIVERS[p]) errors.push('חברת סליקה לא מוכרת');
    else out.provider = p;
  }
  if (patch.mode !== undefined) {
    if (!gwConfig.MODES.includes(String(patch.mode))) errors.push('מצב לא מוכר');
    else if (String(patch.mode) === 'live' && gwConfig.selection().mode !== 'live' && patch.confirmLive !== true) {
      errors.push('המעבר למצב אמיתי דורש אישור מפורש (confirmLive) — המצב נשאר בדיקות');
    } else out.mode = String(patch.mode);
  }
  const fields = {};
  const src = patch.fields && typeof patch.fields === 'object' ? patch.fields : {};
  for (const [name, block] of Object.entries(src)) {
    const d = driverOf(name);
    if (!d || !block || typeof block !== 'object') continue;
    const allowed = new Set((d.credentialFields || []).map((f) => f.key));
    fields[d.id] = {};
    for (const [k, v] of Object.entries(block)) {
      if (!allowed.has(k) || v === undefined || v === null) continue;
      fields[d.id][k] = String(v);
    }
  }
  gwConfig.writeSettings({ ...out, fields });
  // a driver may refuse the combination it now sees (Cardcom: the public test terminal in live mode, a real one in test mode)
  const st = status();
  for (const r of st.reasons) if (!errors.includes(r)) errors.push(r);
  return { settings: adminSettings(), errors };
}

const STATUS_LABELS = { pending: 'ממתין לתשלום', paid: 'שולם', failed: 'לא הושלם', mismatch: 'אי-התאמה', refunded: 'הוחזר' };

/** Admin: the rows of an order, with what the screen shows — never a session id or a token. */
function describePayments(order) {
  return paymentsOf(order.id).map((r) => {
    const d = driverOf(r.provider);
    const creds = d ? gwConfig.credentialsFor(r.provider) : {};
    const unavailable = d && typeof d.refundUnavailable === 'function' ? d.refundUnavailable(creds) : '';
    const expired = r.status === 'pending' && ageMs(r.created_at) > SESSION_FRESH_MS;
    const left = r.amount - r.refunded;
    return {
      id: r.id, provider: r.provider, providerLabel: d ? d.label : r.provider, mode: r.mode, status: r.status,
      statusLabel: r.mode === 'test' && r.status === 'paid' ? 'אושר (בדיקה — לא התקבל כסף)' : expired ? 'פג תוקף' : (STATUS_LABELS[r.status] || r.status),
      amount: r.amount, amountText: money.formatMoney(r.amount, r.currency), currency: r.currency,
      transactionId: r.transaction_id, approval: r.approval, last4: r.card_last4, brand: r.card_brand,
      installments: r.installments, refunded: r.refunded, refundedText: r.refunded ? money.formatMoney(r.refunded, r.currency) : '',
      left, leftText: money.formatMoney(Math.max(left, 0), r.currency),
      refundUnknown: r.refund_unknown, refundUnknownText: r.refund_unknown ? money.formatMoney(r.refund_unknown, r.currency) : '',
      // an unknown sum with a fresh lock is a refund at the provider right now — not yet the owner's to resolve
      refundInFlight: r.refund_unknown > 0 && refundInFlight(r),
      refundable: r.status === 'paid' && left > 0 && r.refund_unknown === 0 && !!(d && typeof d.refund === 'function') && !unavailable,
      refundNote: r.status === 'paid' && left > 0 && r.refund_unknown === 0 ? unavailable : '', partialRefund: !!(d && d.partialRefund),
      canVerify: UNPAID.has(r.status) && !!r.session_id && r.verify_count < HOOK_MAX,
      error: r.error, verifyCount: r.verify_count, createdAt: r.created_at, updatedAt: r.updated_at
    };
  });
}

/** The admin's own check of one row — no page throttle, bounded by HOOK_MAX — and a sentence about what happened. */
async function adminVerify(order, paymentId) {
  const row = getPayment(paymentId);
  if (!row || !order || row.order_id !== order.id) return { ok: false, message: 'התשלום לא נמצא בהזמנה הזו' };
  const r = await verifyPayment(row, { source: 'admin' });
  const after = getPayment(row.id) || row;
  let message;
  if (r.changed && r.status === 'paid') message = after.mode === 'test' ? 'תשלום בדיקה אושר ונרשם — לא התקבל כסף' : 'התשלום אושר ונרשם';
  else if (r.changed && r.status === 'mismatch') message = 'חברת הסליקה מדווחת על סכום אחר — ראו את ההיסטוריה';
  else if (r.duplicateTransaction) message = r.error;
  else if (r.exhausted) message = 'הגענו למגבלת הבדיקות לשורה הזו (או שאין לה מזהה אצל החברה)';
  else if (r.error) message = 'הבירור נכשל: ' + r.error;
  else if (after.status === 'paid' || after.status === 'refunded') message = 'התשלום הזה כבר אושר';
  else if (after.status === 'failed') message = 'התשלום לא הושלם אצל חברת הסליקה';
  else if (after.status === 'mismatch') message = 'אי-התאמה בסכום — ראו את ההיסטוריה';
  else message = 'עדיין לא אושר אצל חברת הסליקה' + (r.message ? ' (' + r.message + ')' : '');
  return { ok: !!r.ok, status: after.status, changed: !!r.changed, message };
}

// ── the shopper's view ────────────────────────────────────────────────

const PUBLIC_MESSAGES = {
  none: '',
  pending: 'התשלום עדיין לא אושר. אם שילמתם עכשיו — ההזמנה תתעדכן בעוד רגע.',
  failed: 'התשלום לא הושלם. אפשר לנסות שוב.',
  mismatch: 'התשלום התקבל, אך הסכום אינו תואם להזמנה — ניצור איתכם קשר.',
  paid: 'התשלום התקבל.',
  refunded: 'התשלום הוחזר.'
};

/**
 * What the order page needs for a card order: the state, whether it is
 * still worth asking, where to POST — never a provider id, a key or a URL.
 */
function publicPayment(order, settings) {
  const s = settings || settingsMod.loadSettings();
  const rows = paymentsOf(order.id);
  const paid = rows.find((r) => r.status === 'paid' || r.status === 'refunded') || null;
  const latest = rows[0] || null;
  const state = paid ? paid.status : latest ? latest.status : 'none';
  const st = status(s);
  const open = !order.paid_at && order.status !== 'cancelled';
  const testPaid = !!paid && paid.mode === 'test';
  const sessions = rows.filter((r) => r.session_id).length;
  return {
    status: state,
    verifying: !paid && rows.some((r) => UNPAID.has(r.status) && !!r.session_id && r.verify_count < VERIFY_MAX && ageMs(r.created_at) < VERIFY_WINDOW_MS),
    canPay: open && !paid && st.ready && sessions < MAX_SESSIONS_PER_ORDER && rows.length < MAX_ROWS_PER_ORDER && state !== 'mismatch',
    test: paid ? testPaid : (st.ready && !st.live),
    payUrl: '/api/store/pay/' + encodeURIComponent(order.token),
    message: testPaid && state === 'paid' ? 'תשלום בדיקה אושר — לא חויב כסף' : (PUBLIC_MESSAGES[state] || '')
  };
}

// ── privacy ───────────────────────────────────────────────────────────

/** The payment lines of a subject export: the sale's record, no card beyond its last 4 (and none after an erasure), no token. */
function paymentsForSubject(orderId) {
  return paymentsOf(orderId).map((r) => ({
    provider: r.provider, mode: r.mode, status: r.status, amount: r.amount, currency: r.currency,
    transactionId: r.transaction_id, approval: r.approval, cardLast4: r.card_last4, cardBrand: r.card_brand,
    installments: r.installments, refunded: r.refunded, createdAt: r.created_at
  }));
}

/** An erasure: the card's last-4 and brand leave with the customer's fields; amounts and transaction ids stay (sales records). */
function eraseForOrder(orderId) {
  return db.prepare("UPDATE store_payments SET card_last4 = '', card_brand = '', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?").run(Number(orderId)).changes;
}

module.exports = {
  TIMEOUT_MS,
  SESSION_FRESH_MS,
  MAX_SESSIONS_PER_ORDER,
  MAX_ROWS_PER_ORDER,
  VERIFY_GAP_MS,
  VERIFY_MAX,
  HOOK_MAX,
  VERIFY_WINDOW_MS,
  PAGE_CALLS,
  BASE_URL_HINT,
  listDrivers,
  driverOf,
  status,
  isReady,
  offeredPayments,
  customerIssues,
  startSession,
  verifyPayment,
  verifyForOrder,
  settle,
  handleHook,
  refund,
  resolveUnknownRefund,
  refundableRow,
  testConnection,
  adminSettings,
  saveAdminSettings,
  adminVerify,
  describePayments,
  paymentsOf,
  getPayment,
  paidPayment,
  isGatewayPaid,
  publicPayment,
  paymentsForSubject,
  eraseForOrder,
  returnUrls,
  redact,
  defaultTransport,
  guardedTransport,
  _setTransport,
  _registerDriver: registerDriver
};
