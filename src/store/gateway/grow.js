'use strict';

/**
 * Grow (formerly Meshulam) — Light API 1.0 driver (hosted payment page).
 *
 * Facts from developers.grow.business (the reference pages mirrored by the
 * lead's research) as verified by the two reviews in the gateway brief;
 * nothing here is from memory. Every request is multipart/form-data (JSON
 * is silently not read), every answer is HTTP 200 with
 * `{ status: 1|0 (number or string), err: '' | { id, message }, data }`,
 * sometimes served as text/html — so the body is parsed as text → JSON.
 *
 *   createPaymentProcess   → { processId, processToken, url }  (the url lives 10 minutes)
 *   the buyer pays on `url`; Grow POSTs a form-encoded "server update" to
 *   our notifyUrl with bracket keys (data[statusCode], data[processToken],
 *   data[customFields][cField1] …), unsigned
 *   approveTransaction     → our acknowledgement of that update (required by Grow's
 *                            production review; it changes no status)
 *   getPaymentProcessInfo  → the inquiry, for the fallback path only
 *   refundTransaction      → refund (full; partial, with Grow's limits)
 *
 * TRUST MODEL (decided by the lead, see docs/security.md). The callback is
 * TOKEN-ANCHORED: the sha256 of `data[processToken]` must equal the
 * sha256 of the processToken Grow gave us when the process was created —
 * compared with crypto.timingSafeEqual on the equal-length hex digests —
 * and `data[processId]` must be the row's, `statusCode` must be "2"
 * (paid), and `data[customFields][cField1]` must be our reference (a
 * correlation check only: Grow appends the cFields to the success
 * redirect, so the buyer can see it). A callback that passes settles
 * WITHOUT an inquiry, because Grow asks that inquiries not run per
 * transaction; the sum it carries is compared to the order by settle() (a
 * wrong sum is recorded as a mismatch, never as paid). Grow's hosted url
 * is `…/far?l=<32 hex>` and does NOT carry the processToken; the driver
 * still refuses a url that does. The residual risk: if the processToken
 * ever reached a buyer, a forged callback could mark that one order paid —
 * so the row keeps only the token's hash and a copy sealed under a
 * per-install key (gateway/config.js) that the inquiry fallback opens,
 * and neither processId, processToken nor transactionToken ever leaves
 * the server (no browser JSON, HTML, event, CSV or log). A backup
 * restored elsewhere still verifies callbacks by hash and only loses the
 * inquiry for its old rows. The owner can cross-check the approval number
 * (asmachta) in the Grow back office.
 *
 * approveTransaction is sent only after a statusCode-2 callback, echoing
 * pageCode plus the documented server-update fields as received — never
 * after an inquiry-only confirmation (undocumented; a resent callback gets
 * approved then). getPaymentProcessInfo on an unpaid process answers
 * status 1 with a placeholder transaction (statusCode "0", transactionId
 * "0"): only a transaction with statusCode "2" counts.
 *
 * Grow is ILS-only. It requires a full name of at least two words and a
 * valid Israeli mobile (err 717) — checked at checkout, as field errors
 * (customerIssues), not at pay time. "No special characters in any
 * parameter": the description and the name are reduced to letters, digits
 * and spaces; our reference is hex. The pageCode a process was created with
 * must be reused for approve / inquiry / refund (err 731): the row keeps a
 * 4-character fingerprint of it (the code itself is half of Grow's auth
 * and belongs in config/payments.json, never in the database) and refuses
 * with a clear message when the configured code changed.
 *
 * Bit / Apple Pay / Google Pay / PayBox have NO sandbox: a test-mode
 * confirmation with a non-card transactionTypeId is flagged loudly (event
 * + owner mail) because the money may be real — and still never sets
 * paid_at in test mode.
 */

const crypto = require('crypto');
const money = require('../money');

const HOSTS = { live: 'https://secure.meshulam.co.il', test: 'https://sandbox.meshulam.co.il' };
const PATH = '/api/light/server/1.0/';

const ERRORS = {
  54: 'חסרים שדות חובה בבקשה',
  617: 'סכום הפריטים אינו שווה לסכום העסקה',
  716: 'מזהה התהליך או הטוקן אינם תקינים',
  717: 'שם מלא (שני שמות) ומספר נייד ישראלי הם חובה',
  722: 'אי אפשר לאשר עסקה שלא הושלמה',
  730: 'מזהה או טוקן אינם תקינים',
  731: 'קוד דף התשלום (pageCode) אינו זה שאיתו נוצר התהליך',
  735: 'מספר התשלומים גבוה מהמותר בדף התשלום',
  736: 'אין לשלוח גם paymentNum וגם maxPaymentNum',
  740: 'החשבון אינו מאפשר תשלומים',
  105: 'סכום ההחזר גדול מהסכום שנגבה',
  190: 'סכום ההחזר גדול מהסכום שנגבה',
  218: 'סכום ההחזר גדול מהסכום שנגבה',
  130: 'באותו יום אפשר רק לבטל את העסקה במלואה — החזר חלקי אפשרי ממחר',
  207: 'אין החזר חלקי לפני שידור העסקה',
  210: 'העסקה כבר הוחזרה',
  110: 'אין יתרה בחשבון Grow להחזר',
  115: 'אין יתרה בחשבון Grow להחזר'
};

/** transactionTypeId → what the buyer used. Only 1 is a card; the rest have no sandbox. */
const TYPES = { 1: 'כרטיס אשראי', 5: 'PayBox', 6: 'Bit', 13: 'Apple Pay', 14: 'Google Pay', 15: 'העברה בנקאית' };

/** The server-update fields approveTransaction echoes, exactly as Grow documents them. */
const ACK_FIELDS = [
  'transactionId', 'transactionToken', 'transactionTypeId', 'paymentType', 'sum', 'firstPaymentSum', 'periodicalPaymentSum',
  'paymentsNum', 'allPaymentsNum', 'paymentDate', 'asmachta', 'description', 'fullName', 'payerPhone', 'payerEmail',
  'cardSuffix', 'cardType', 'cardTypeCode', 'cardBrand', 'cardBrandCode', 'cardExp', 'processId', 'processToken'
];

function clip(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/** Letters, digits and spaces only — Grow refuses "special characters" in any parameter. */
function plain(v, max) {
  return String(v == null ? '' : v).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** An Israeli mobile in the form Grow wants (05XXXXXXXX), or ''. */
function mobile(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (/^05\d{8}$/.test(d)) return d;
  if (/^9725\d{8}$/.test(d)) return '0' + d.slice(3);
  return '';
}

function host(mode) {
  return mode === 'live' ? HOSTS.live : HOSTS.test;
}

function creds(credentials) {
  const c = credentials || {};
  return { userId: clip(c.userId, 100), pageCode: clip(c.pageCode, 100) };
}

function tailOf(pageCode) {
  return pageCode.slice(-4);
}

function tailCheck(payment, c, what) {
  if (payment.account_tail && payment.account_tail !== tailOf(c.pageCode)) {
    return 'התשלום נוצר עם קוד דף תשלום אחר (…' + payment.account_tail + ') — החזירו את הקוד הקודם במסך סליקת אשראי כדי ' + what;
  }
  return '';
}

function errText(err) {
  if (err && typeof err === 'object') {
    const id = Number(err.id);
    const known = ERRORS[id];
    const msg = clip(err.message, 160);
    if (known) return known + (msg ? ' (' + msg + ')' : '') + (id ? ' · קוד ' + id : '');
    return (msg || 'שגיאה') + (id ? ' · קוד ' + id : '');
  }
  const s = clip(err, 200);
  return s || 'שגיאה לא ידועה מ-Grow';
}

/** A multipart body. `keepEmpty` = an empty value is still a field (the acknowledgement echoes the update as received). */
function form(fields, keepEmpty) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (v === '' && !keepEmpty) continue;
    fd.append(k, String(v));
  }
  return fd;
}

/** A transaction id as Grow sends it — kept verbatim when it is a plain token; '' (and "0", Grow's placeholder) is no id at all. */
function transactionIdOf(v) {
  const s = str(v);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(s) || /^0+$/.test(s)) return '';
  return s;
}

/** One Light API call: multipart out, text → JSON in, `status` compared as a string. Never throws. */
async function call(transport, mode, method, fields, { keepEmpty = false } = {}) {
  const r = await transport({ url: host(mode) + PATH + method, method: 'POST', headers: {}, body: form(fields, keepEmpty) });
  if (!r || !r.status || r.status >= 500) return { ok: false, transient: true, error: (r && r.error) || ('Grow: HTTP ' + (r ? r.status : 0)) };
  let j = null;
  if (r.text) { try { j = JSON.parse(r.text); } catch (e) { j = null; } }
  if (!j && r.json && typeof r.json === 'object') j = r.json;
  if (!j || typeof j !== 'object') return { ok: false, error: 'תשובה לא צפויה מ-Grow (HTTP ' + r.status + ')' };
  if (String(j.status) !== '1') return { ok: false, error: errText(j.err), errId: j.err && typeof j.err === 'object' ? Number(j.err.id) || 0 : 0 };
  return { ok: true, data: j.data };
}

function timingEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/** Grow's rules for the buyer, said at checkout as field errors. */
function customerIssues({ name, phone } = {}) {
  const out = [];
  if (plain(name, 80).split(' ').filter(Boolean).length < 2) out.push({ field: 'name', message: 'נא למלא שם פרטי ושם משפחה' });
  if (!mobile(phone)) out.push({ field: 'phone', message: 'נא למלא מספר נייד ישראלי' });
  return out;
}

async function createSession({ amount, currency, reference, order, method, urls, customer, storeName, credentials, mode, transport }) {
  const c = creds(credentials);
  if (!c.userId || !c.pageCode) return { ok: false, error: 'חסרים מזהה משתמש וקוד דף תשלום' };
  if (currency !== 'ILS') return { ok: false, error: 'Grow סולקת בשקלים בלבד' };
  if (!/^[a-z0-9]+$/i.test(String(reference || ''))) return { ok: false, error: 'ערך ההחזרה חייב להיות אלפאנומרי' };
  const fullName = plain(customer && customer.name, 80);
  if (fullName.split(' ').filter(Boolean).length < 2) return { ok: false, error: 'Grow דורשת שם מלא של שני שמות' };
  const phone = mobile(customer && customer.phone);
  if (!phone) return { ok: false, error: 'Grow דורשת מספר נייד ישראלי' };
  for (const u of [urls.success, urls.cancel, urls.hook]) {
    if (!/^https:\/\//i.test(String(u || ''))) return { ok: false, error: 'כתובות החזרה חייבות להיות https' };
  }
  const fields = {
    pageCode: c.pageCode,
    userId: c.userId,
    chargeType: 1,
    sum: money.fromMinor(amount),
    description: plain('הזמנה ' + (order && order.number) + ' ' + (storeName || ''), 80),
    successUrl: urls.success,
    cancelUrl: urls.cancel,
    notifyUrl: urls.hook,
    'pageField[fullName]': fullName,
    'pageField[phone]': phone,
    cField1: reference
  };
  const email = clip(customer && customer.email, 200);
  if (/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email)) fields['pageField[email]'] = email;
  const max = parseInt(method && method.maxPayments, 10) || 1;
  if (max >= 2) fields.maxPaymentNum = Math.min(max, 12);
  const r = await call(transport, mode, 'createPaymentProcess', fields);
  if (!r.ok) return r;
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  const processId = clip(d.processId, 40);
  const token = clip(d.processToken, 200);
  const url = clip(d.url, 2000);
  if (!processId || !token || !url) return { ok: false, error: 'Grow לא החזירה מזהה תהליך, טוקן וכתובת דף' };
  if (url.includes(token)) return { ok: false, error: 'כתובת דף התשלום נושאת את טוקן התהליך — סירבנו להשתמש בה' };
  return { ok: true, sessionId: processId, sessionToken: token, url, accountTail: tailOf(c.pageCode) };
}

/** The callback's `data` block, whatever encoding it arrived in (urlencoded / multipart bracket keys, or JSON). */
function dataOf(req) {
  const b = (req && req.hookBody) || {};
  const nested = b.nested && typeof b.nested === 'object' ? b.nested : {};
  const data = nested.data && typeof nested.data === 'object' ? nested.data : null;
  return data;
}

function str(v) {
  return String(v == null ? '' : (Array.isArray(v) ? v[0] : v)).trim();
}

function paidVerdict(t, payment, { ack } = {}) {
  const typeId = str(t.transactionTypeId);
  const kind = TYPES[Number(typeId)] || (typeId ? 'סוג ' + typeId : '');
  const nonCard = !!typeId && Number(typeId) !== 1;
  const alert = nonCard && payment.mode === 'test' ? 'תשלום באמצעי ללא סביבת בדיקות (' + kind + ') — ייתכן שזה חיוב אמיתי; בדקו בחשבון Grow' : '';
  return {
    ok: true,
    state: 'paid',
    amount: money.toMinor(str(t.sum)),
    currency: 'ILS',
    transactionId: transactionIdOf(t.transactionId),
    transactionToken: clip(t.transactionToken, 200),
    approval: clip(t.asmachta, 40),
    last4: clip(t.cardSuffix, 8),
    brand: clip(t.cardBrand, 40) || clip(t.cardType, 40),
    installments: str(t.allPaymentsNum) || str(t.paymentsNum) || 1,
    note: alert ? 'שימו לב: ' + alert : (nonCard ? 'אמצעי תשלום: ' + kind : ''),
    alert,
    ...(ack ? { ack } : {})
  };
}

/**
 * The token-anchored verdict on a callback. Only a body that carries the
 * processToken whose sha256 we hold (constant-time compare of the two
 * digests), our processId, statusCode "2", a transaction id and our
 * reference in cField1 is a verdict at all; the sum is handed to settle(),
 * which refuses anything but the order's total.
 */
function hookVerdict({ payment, req }) {
  const data = dataOf(req);
  if (!data) return { ok: false, error: 'no data' };
  const token = str(data.processToken);
  const digest = String(payment.session_token_hash || '');
  if (!token || !/^[0-9a-f]{64}$/.test(digest) || !timingEqual(sha256(token), digest)) return { ok: false, error: 'token' };
  if (str(data.processId) !== String(payment.session_id || '')) return { ok: false, error: 'processId' };
  const cf = data.customFields && typeof data.customFields === 'object' ? str(data.customFields.cField1) : '';
  if (!cf || cf !== String(payment.reference)) return { ok: false, error: 'cField1' };
  if (str(data.statusCode) !== '2') return { ok: false, error: 'statusCode ' + str(data.statusCode) };
  if (!transactionIdOf(data.transactionId)) return { ok: false, error: 'transactionId' };
  const ack = {};
  for (const k of ACK_FIELDS) ack[k] = str(data[k]);
  return paidVerdict(data, payment, { ack });
}

/** approveTransaction: pageCode + EVERY server-update field as received, empty ones included. An acknowledgement — its failure never un-settles. */
async function acknowledge({ payment, verify, credentials, mode, transport }) {
  if (!verify || !verify.ack) return { ok: true, skipped: true };
  const c = creds(credentials);
  const stale = tailCheck(payment, c, 'לאשר');
  if (stale) return { ok: false, error: stale };
  const r = await call(transport, mode, 'approveTransaction', { pageCode: c.pageCode, ...verify.ack }, { keepEmpty: true });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

const SEALED_ELSEWHERE = 'הטוקן של התהליך אינו ניתן לפתיחה במתקן הזה (המפתח שונה — שחזור ממקום אחר?) — הבירור מול Grow לא זמין לתהליך הזה; ההודעה של Grow עדיין תאמת אותו';

/** The fallback inquiry (the buyer is back, no callback came): getPaymentProcessInfo with the STORED ids (the token opened by the gateway). */
async function verify({ payment, credentials, mode, transport }) {
  const c = creds(credentials);
  const stale = tailCheck(payment, c, 'לברר');
  if (stale) return { ok: false, error: stale };
  if (!payment.session_id) return { ok: false, error: 'חסר מזהה תהליך' };
  if (!payment.session_token) return { ok: false, error: payment.session_token_sealed ? SEALED_ELSEWHERE : 'חסר הטוקן של התהליך' };
  const r = await call(transport, mode, 'getPaymentProcessInfo', { pageCode: c.pageCode, processId: payment.session_id, processToken: payment.session_token });
  if (!r.ok) return r.transient ? r : { ok: false, error: r.error };
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  const txs = Array.isArray(d.transactions) ? d.transactions.filter((t) => t && typeof t === 'object') : [];
  // Grow's placeholder for an unpaid process (statusCode "0", transactionId "0") and anything without an id are not verdicts
  const paid = txs.filter((t) => str(t.statusCode) === '2' && transactionIdOf(t.transactionId));
  if (!paid.length) return { ok: true, state: 'pending' };
  // the matching sum first; a paid transaction with another sum still reaches settle(), which records the mismatch
  const match = paid.find((t) => money.toMinor(str(t.sum)) === payment.amount) || paid[0];
  return paidVerdict(match, payment);
}

async function refund({ payment, amount, credentials, mode, transport }) {
  const c = creds(credentials);
  const stale = tailCheck(payment, c, 'להחזיר');
  if (stale) return { ok: false, error: stale };
  if (!payment.transaction_id || !payment.transaction_token) return { ok: false, error: 'חסרים מזהה העסקה והטוקן שלה — אי אפשר להחזיר דרך המערכת' };
  const r = await call(transport, mode, 'refundTransaction', {
    userId: c.userId,
    pageCode: c.pageCode,
    transactionId: payment.transaction_id,
    transactionToken: payment.transaction_token,
    refundSum: money.fromMinor(amount)
  });
  // a network failure or a 5xx is an UNKNOWN outcome, and the gateway keeps the reservation for it
  if (!r.ok) return { ok: false, error: r.error, transient: !!r.transient };
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  return { ok: true, refundId: transactionIdOf(d.transactionId) };
}

/** The callback: the processId, nothing else. A body without one (Grow's account-level webhooks) finds no row. */
function parseHook(req) {
  const data = dataOf(req);
  return { sessionId: data ? clip(str(data.processId), 40) : '' };
}

module.exports = {
  id: 'grow',
  label: 'Grow',
  hosts: [HOSTS.live, HOSTS.test],
  currencies: ['ILS'],
  credentialFields: [
    { key: 'userId', label: 'מזהה עסק (userId)', required: true, hint: 'מזהי sandbox ומזהי ייצור הם שונים — מתקבלים מתמיכת Grow' },
    { key: 'pageCode', label: 'קוד דף התשלום (pageCode)', required: true, hint: 'דף התשלום לכרטיס אשראי (או הדף הכללי כרטיס/ביט)' }
  ],
  notes: [
    'ההודעה על התשלום (notifyUrl) נשלחת לכתובת שאנחנו מעבירים בכל דף תשלום — אין מה להגדיר בפאנל.',
    'Grow דורשת מהקונה שם מלא (שני שמות) ומספר נייד ישראלי — הקופה בודקת זאת.',
    'Bit / Apple Pay / Google Pay / PayBox אין להם סביבת בדיקות: תשלום כזה במצב בדיקות עלול להיות חיוב אמיתי.',
    'לפני מעבר לייצור Grow בודקת את היומנים ואת האתר (תקנון, טלפון, כתובת) — הגדירו דף תנאי שימוש בהגדרות החנות.',
    'עד 2 החזרים לעסקה דרך ה-API; החזר באותו יום הוא ביטול מלא בלבד.'
  ],
  needsWebhookUrl: false,
  partialRefund: true,
  hookRetryOnTransient: false,
  // the buyer is back before Grow's server update: the order page waits this long before asking
  inquiryGraceMs: 20000,
  hookReply: { status: 200, type: 'text/plain', body: 'OK' },
  customerIssues,
  createSession,
  hookVerdict,
  acknowledge,
  verify,
  refund,
  parseHook,
  ERRORS,
  TYPES,
  ACK_FIELDS,
  mobile,
  plain,
  transactionIdOf
};
