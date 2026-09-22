'use strict';

/**
 * Cardcom — API v11 driver (LowProfile hosted page).
 *
 * Facts from Cardcom's own OpenAPI spec (secure.cardcom.solutions/swagger/
 * v11) and knowledge base, as verified by the two reviews in the gateway
 * brief; nothing here is from memory. The shape:
 *
 *   POST /api/v11/LowProfile/Create (JSON)      → { ResponseCode 0, LowProfileId, Url }
 *   the buyer pays on Url; Cardcom POSTs a LowProfileResult JSON to our
 *   WebHookUrl (unsigned — there is no signature anywhere in the API)
 *   POST /api/v11/LowProfile/GetLpResult (JSON) → the same LowProfileResult, from the source
 *   POST /api/v11/Transactions/RefundByTransactionId (JSON, ApiPassword)
 *
 * TRUST MODEL. Cardcom's callback authenticates nothing, so it is only a
 * hint: the gateway takes the LowProfileId out of it, finds our row, and
 * the verdict is GetLpResult asked by us with the terminal's ApiName. A
 * result is PAID only when ALL of these hold — the top-level ResponseCode
 * is 0, the LowProfileId (case-insensitive GUID), the TerminalNumber and
 * the ReturnValue are ours, Operation is "ChargeOnly", TranzactionInfo is
 * present with ResponseCode 0 (700/701 are J5/J2 holds — no money),
 * IsRefund is false and DealType is "Debit" (a refund answers 0 too), and
 * the amount (decimal shekels → agorot) and the CoinId equal the order's.
 * A top-level error with no TranzactionInfo is INCONCLUSIVE (the page is
 * not done) and stays pending; a declined TranzactionInfo is a failed
 * attempt, which a later confirmation may still overturn.
 *
 * ONE host for both modes. Test mode IS terminal 1000 — Cardcom's public
 * test terminal, where deals clear without charging — on the same host:
 * any other terminal charges real cards, so test mode refuses every
 * terminal but 1000, live mode refuses 1000, and there is no sandbox host
 * to invent. ApiName is a credential (Create and GetLpResult are
 * authorised by terminal + ApiName alone); ApiPassword is a separate one,
 * needed only for refunds. TranzactionId is an int64: it is read from
 * inside TranzactionInfo in the raw text, kept as a string and spliced
 * into the refund JSON verbatim — JSON.stringify(Number(x)) would lose
 * digits. Invoices (`Document`) need Cardcom's Documents module and stay
 * out of scope (a follow-up in docs/bent-store.md). TLS checks are never
 * relaxed.
 */

const money = require('../money');

const HOST = 'https://secure.cardcom.solutions';
const API = HOST + '/api/v11/';
const TEST_TERMINAL = '1000';
const COINS = { ILS: 1, USD: 2, EUR: 978, GBP: 826 };
const CODES = { 1: 'ILS', 2: 'USD', 840: 'USD', 978: 'EUR', 826: 'GBP' };
const LIVE_TEST_TERMINAL = 'מסוף 1000 הוא מסוף הבדיקות הציבורי של Cardcom — במצב אמיתי יש להזין את מספר המסוף שלכם';
const TEST_REAL_TERMINAL = 'במצב בדיקות Cardcom משתמשים במסוף הבדיקות 1000 — מסוף אחר מחייב כסף אמיתי';

/** The one rule about terminals, in both directions. '' when the pair is fine. */
function terminalRule(terminal, mode) {
  if (mode === 'live' && terminal === TEST_TERMINAL) return LIVE_TEST_TERMINAL;
  if (mode !== 'live' && terminal !== TEST_TERMINAL) return TEST_REAL_TERMINAL;
  return '';
}

function clip(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function creds(credentials) {
  const c = credentials || {};
  return {
    terminal: String(c.terminal || '').replace(/\D/g, '').slice(0, 10),
    apiName: clip(c.apiName, 100),
    apiPassword: String(c.apiPassword || '')
  };
}

function tailOf(terminal) {
  return terminal.slice(-4);
}

/** int64 ids come out of the raw text, never out of a JS number. `after` = a key whose object must contain the id (TranzactionInfo). */
function digitsOf(text, key, fallback, after) {
  let src = String(text || '');
  if (after) {
    const at = src.indexOf('"' + after + '"');
    src = at >= 0 ? src.slice(at) : '';
  }
  const m = new RegExp('"' + key + '"\\s*:\\s*"?(\\d{1,19})"?').exec(src);
  if (m) return m[1];
  const f = String(fallback == null ? '' : fallback).replace(/\D/g, '');
  return f.slice(0, 19);
}

async function post(transport, path, payload, rawJson) {
  const r = await transport({
    url: API + path,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: rawJson || JSON.stringify(payload)
  });
  if (!r || !r.status || r.status >= 500) {
    return { ok: false, transient: true, error: (r && r.error) || ('Cardcom: HTTP ' + (r ? r.status : 0)) };
  }
  let j = r.json;
  if (!j && r.text) { try { j = JSON.parse(r.text); } catch (e) { j = null; } }
  if (!j || typeof j !== 'object') return { ok: false, error: 'תשובה לא צפויה מ-Cardcom (HTTP ' + r.status + ')' };
  return { ok: true, status: r.status, j, text: r.text || '' };
}

function readiness({ credentials, mode }) {
  const c = creds(credentials);
  const rule = terminalRule(c.terminal, mode);
  return rule ? [rule] : [];
}

function tailCheck(payment, c, what) {
  if (payment.account_tail && payment.account_tail !== tailOf(c.terminal)) {
    return 'התשלום נוצר במסוף אחר (…' + payment.account_tail + ') — החזירו את מספר המסוף הקודם במסך סליקת אשראי כדי ' + what;
  }
  return '';
}

async function createSession({ amount, currency, reference, order, method, urls, customer, credentials, mode, transport }) {
  const c = creds(credentials);
  if (!c.terminal || !c.apiName) return { ok: false, error: 'חסרים מספר מסוף ושם משתמש API' };
  const rule = terminalRule(c.terminal, mode);
  if (rule) return { ok: false, error: rule };
  const coin = COINS[currency];
  if (!coin) return { ok: false, error: 'Cardcom: המטבע ' + currency + ' אינו נתמך' };
  for (const u of [urls.success, urls.failure, urls.cancel, urls.hook]) {
    if (!/^https:\/\//i.test(String(u || '')) || String(u).length > 500) return { ok: false, error: 'כתובות החזרה חייבות להיות https ועד 500 תווים' };
  }
  const max = Math.min(Math.max(parseInt(method && method.maxPayments, 10) || 1, 1), 36);
  // an email is never truncated: over Cardcom's 50 characters it is simply not prefilled
  const email = clip(customer && customer.email, 200);
  const payload = {
    TerminalNumber: Number(c.terminal),
    ApiName: c.apiName,
    Amount: Number(money.fromMinor(amount)),
    ISOCoinId: coin,
    Operation: 'ChargeOnly',
    Language: 'he',
    SuccessRedirectUrl: urls.success,
    FailedRedirectUrl: urls.failure,
    CancelRedirectUrl: urls.cancel,
    WebHookUrl: urls.hook,
    ReturnValue: clip(reference, 250),
    ProductName: clip('הזמנה ' + (order && order.number), 50),
    UIDefinition: {
      CardOwnerNameValue: clip(customer && customer.name, 50),
      ...(email && email.length <= 50 ? { CardOwnerEmailValue: email } : {}),
      CardOwnerPhoneValue: clip(customer && customer.phone, 50)
    },
    AdvancedDefinition: { MinNumOfPayments: 1, MaxNumOfPayments: max }
  };
  const r = await post(transport, 'LowProfile/Create', payload);
  if (!r.ok) return r;
  const j = r.j;
  if (Number(j.ResponseCode) !== 0) return { ok: false, error: clip(j.Description || ('קוד ' + j.ResponseCode), 200) };
  const sessionId = clip(j.LowProfileId, 80);
  if (!/^[0-9a-f-]{20,80}$/i.test(sessionId) || !j.Url) return { ok: false, error: 'Cardcom לא החזירה מזהה דף וכתובת' };
  return { ok: true, sessionId, url: String(j.Url), accountTail: tailOf(c.terminal) };
}

async function verify({ payment, credentials, transport }) {
  const c = creds(credentials);
  const stale = tailCheck(payment, c, 'לברר');
  if (stale) return { ok: false, error: stale };
  const r = await post(transport, 'LowProfile/GetLpResult', { TerminalNumber: Number(c.terminal), ApiName: c.apiName, LowProfileId: payment.session_id });
  if (!r.ok) return r;
  const j = r.j;
  const ti = j.TranzactionInfo && typeof j.TranzactionInfo === 'object' ? j.TranzactionInfo : null;
  // a top-level error is inconclusive whatever sits inside — the page is
  // not done, or our request is wrong: say it, move nothing
  if (Number(j.ResponseCode) !== 0) return { ok: true, state: 'pending', message: clip(j.Description || ('קוד ' + j.ResponseCode), 200) };
  // this answer must be about OUR session, our terminal, our order
  if (String(j.LowProfileId || '').toLowerCase() !== String(payment.session_id || '').toLowerCase()) return { ok: false, error: 'Cardcom השיבה על דף תשלום אחר' };
  if (String(j.TerminalNumber || '') !== c.terminal) return { ok: false, error: 'Cardcom השיבה ממסוף אחר' };
  if (String(j.ReturnValue || '') !== String(payment.reference)) return { ok: false, error: 'ערך ההחזרה (ReturnValue) אינו של ההזמנה הזו' };
  if (!ti) return { ok: true, state: 'pending', message: clip(j.Description, 200) };
  const code = Number(ti.ResponseCode);
  if (code === 700 || code === 701) return { ok: true, state: 'pending', message: 'עסקת בדיקה/הקפאה (J5/J2) — לא נגבה כסף' };
  if (code !== 0) return { ok: true, state: 'failed', message: clip(ti.Description || ('קוד ' + code), 200) };
  if (String(j.Operation || '') !== 'ChargeOnly') return { ok: true, state: 'pending', message: 'הפעולה שבוצעה אינה חיוב (' + clip(j.Operation, 40) + ') — בדקו את הגדרות המסוף' };
  if (ti.IsRefund === true || String(ti.DealType || '') !== 'Debit') return { ok: true, state: 'pending', message: 'לא עסקת חיוב (' + clip(ti.DealType, 40) + ')' };
  const amount = money.toMinor(String(ti.Amount == null ? '' : ti.Amount));
  // the deal's own id, from INSIDE TranzactionInfo (the top-level one may differ); no id is no verdict
  const transactionId = digitsOf(r.text, 'TranzactionId', ti.TranzactionId, 'TranzactionInfo');
  if (!transactionId || /^0+$/.test(transactionId)) return { ok: true, state: 'pending', message: 'אין מזהה עסקה בתשובה של Cardcom' };
  return {
    ok: true,
    state: 'paid',
    amount: Number.isFinite(amount) ? amount : NaN,
    currency: CODES[Number(ti.CoinId)] || '',
    transactionId,
    approval: clip(ti.ApprovalNumber, 40),
    last4: clip(ti.Last4CardDigitsString != null ? ti.Last4CardDigitsString : '', 8),
    brand: clip(ti.Brand, 40),
    installments: ti.NumberOfPayments || (j.UIValues && j.UIValues.NumOfPayments) || 1
  };
}

function refundUnavailable(credentials) {
  return creds(credentials).apiPassword ? '' : 'להחזר דרך המערכת דרושה סיסמת API (ApiPassword) של Cardcom — הזינו אותה במסך סליקת אשראי, או החזירו מהממשק של Cardcom';
}

async function refund({ payment, amount, credentials, transport }) {
  const c = creds(credentials);
  const unavailable = refundUnavailable(credentials);
  if (unavailable) return { ok: false, error: unavailable };
  const stale = tailCheck(payment, c, 'להחזיר');
  if (stale) return { ok: false, error: stale };
  const id = String(payment.transaction_id || '');
  if (!/^\d{1,19}$/.test(id)) return { ok: false, error: 'מזהה העסקה חסר או לא תקין' };
  const partial = amount < payment.amount;
  // the id goes in verbatim — an int64 must never pass through a JS number
  const raw = '{"ApiName":' + JSON.stringify(c.apiName) + ',"ApiPassword":' + JSON.stringify(c.apiPassword) +
    ',"TransactionId":' + id + (partial ? ',"PartialSum":' + money.fromMinor(amount) + ',"AllowMultipleRefunds":true' : '') + '}';
  const r = await post(transport, 'Transactions/RefundByTransactionId', null, raw);
  // a network failure or a 5xx is an UNKNOWN outcome, and the gateway keeps the reservation for it
  if (!r.ok) return { ok: false, error: r.error, transient: !!r.transient };
  if (Number(r.j.ResponseCode) !== 0) return { ok: false, error: clip(r.j.Description || ('קוד ' + r.j.ResponseCode), 200) };
  return { ok: true, refundId: digitsOf(r.text, 'NewTranzactionId', r.j.NewTranzactionId) };
}

/** The callback (a LowProfileResult JSON, whatever its Content-Type says) or a query string: the LowProfileId, nothing else. */
function parseHook(req) {
  const b = (req && req.hookBody) || {};
  const find = (obj) => {
    if (!obj || typeof obj !== 'object') return '';
    for (const [k, v] of Object.entries(obj)) {
      if (/^lowprofile(id|code)$/i.test(k)) return String(Array.isArray(v) ? v[0] : (v == null ? '' : v));
    }
    return '';
  };
  const sid = find(b.json) || find(b.fields) || find(req && req.query);
  return { sessionId: clip(sid, 80) };
}

module.exports = {
  id: 'cardcom',
  label: 'Cardcom',
  hosts: [HOST],
  currencies: Object.keys(COINS),
  credentialFields: [
    { key: 'terminal', label: 'מספר מסוף (TerminalNumber)', required: true, hint: 'במצב בדיקות: 1000 בלבד (מסוף הבדיקות הציבורי, לא מחייב — כל מסוף אחר מחייב כסף אמיתי); במצב אמיתי: מספר המסוף שלכם' },
    { key: 'apiName', label: 'שם משתמש API (ApiName)', required: true, hint: 'לבדיקות: שם המשתמש לבדיקות מתמיכת Cardcom' },
    { key: 'apiPassword', label: 'סיסמת API (ApiPassword) — להחזרים בלבד', required: false, hint: 'בלי סיסמה, החזרים נעשים מהממשק של Cardcom' }
  ],
  notes: [
    'הודעת התשלום (WebHook) נשלחת לכתובת שאנחנו מעבירים בכל דף תשלום — אין מה להגדיר בפאנל של Cardcom.',
    'מטבע חוץ (EUR / GBP) דורש אישור של Cardcom ושל הסולק; ברירת המחדל של מסוף היא שקלים ודולרים.',
    'חשבוניות אוטומטיות (מודול Documents) אינן חלק מהחיבור הזה.'
  ],
  needsWebhookUrl: false,
  partialRefund: true,
  hookRetryOnTransient: true,
  inquiryGraceMs: 0,
  hookReply: { status: 200, type: 'text/plain', body: 'OK' },
  readiness,
  createSession,
  verify,
  refund,
  refundUnavailable,
  parseHook,
  COINS,
  TEST_TERMINAL
};
