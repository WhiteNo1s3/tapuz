'use strict';

/**
 * Orders — placing one, and everything that happens to it afterwards.
 *
 * placeOrder() is ONE immediate transaction: re-quote from the database,
 * take the stock with a guarded UPDATE (… WHERE stock >= qty), take a coupon
 * use with a guarded UPDATE (… WHERE used < max_uses), then write the order.
 * `BEGIN IMMEDIATE` holds the write lock from the first read, so two
 * shoppers — in this process or another one on the same file — racing for
 * the last unit cannot both get it: the second sees the new stock and is
 * sent back to a cart that says so.
 *
 * An order copies what it sold (title, option, unit price), so editing or
 * deleting a product never rewrites history. Cancelling puts the stock back;
 * restoring a cancelled order takes it again (or refuses, saying why).
 */

const crypto = require('crypto');
const { db } = require('../db');
const money = require('./money');
const pricing = require('./pricing');
const settingsMod = require('./settings');

const STATUSES = ['new', 'processing', 'shipped', 'completed', 'cancelled'];
const STATUS_LABELS = {
  new: 'התקבלה',
  processing: 'בטיפול',
  shipped: 'נשלחה',
  completed: 'הושלמה',
  cancelled: 'בוטלה'
};
const STATUS_TEXT = {
  new: 'ההזמנה התקבלה ומחכה לטיפול.',
  processing: 'אנחנו מכינים את ההזמנה.',
  shipped: 'ההזמנה בדרך אליכם.',
  completed: 'ההזמנה הושלמה. תודה!',
  cancelled: 'ההזמנה בוטלה.'
};

// What a refused checkout says. NO_PAYMENT is not PAYMENT_REQUIRED: "choose a
// method" over an empty list is the dead end the demo shop sat in — when
// nothing is offered the shopper is told exactly that.
const REFUSALS = {
  EMPTY: 'העגלה ריקה',
  TOO_LARGE: 'סכום ההזמנה גדול מדי להזמנה אחת',
  NO_PAYMENT: 'אין כרגע אמצעי תשלום זמין — אי אפשר להשלים הזמנה.',
  SHIPPING_REQUIRED: 'נא לבחור שיטת משלוח',
  PAYMENT_REQUIRED: 'נא לבחור אמצעי תשלום',
  CLOSED: 'החנות סגורה כרגע — אי אפשר להזמין'
};

class OrderRefusal extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

function clip(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

function statusLabel(order) {
  if (order.status === 'shipped') {
    let addr = {};
    try { addr = JSON.parse(order.address || '{}'); } catch (e) { addr = {}; }
    if (!addr.street && order.shipping_method) return 'מוכנה לאיסוף / נשלחה';
  }
  return STATUS_LABELS[order.status] || order.status;
}

/**
 * The shopper's details, as typed. Field errors are returned (never thrown)
 * so the checkout can mark exactly the field to fix.
 */
function cleanCustomer(input, addressInput, settings, needsAddress, payKind) {
  const c = input && typeof input === 'object' ? input : {};
  const a = addressInput && typeof addressInput === 'object' ? addressInput : {};
  const fields = [];
  const name = clip(c.name, 80);
  if (name.length < 2) fields.push({ field: 'name', message: 'נא למלא שם מלא' });
  const phone = clip(c.phone, 30).replace(/[^\d+\-\s()]/g, '');
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) fields.push({ field: 'phone', message: 'נא למלא מספר טלפון תקין' });
  const email = clip(c.email, 200);
  // a payment that happens somewhere else (the owner's page, the gateway's
  // hosted page) needs a way back to the shopper: the order link by mail.
  // So does PayPal — its only pay step is the button on the order page, and
  // a closed tab with no mail leaves an order nobody can pay holding stock.
  // Not the demo kind: a demo shop's checkout stays one click.
  const needEmail = settings.requireEmail || payKind === 'link' || payKind === 'card' || payKind === 'paypal';
  if (email && !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email)) fields.push({ field: 'email', message: 'כתובת המייל אינה תקינה' });
  else if (!email && needEmail) fields.push({ field: 'email', message: 'נא למלא כתובת מייל — אליה יישלח אישור ההזמנה' });
  // the gateway's provider may have its own rules for the buyer (Grow: two
  // names and an Israeli mobile) — said here, field by field, not at pay time
  if (payKind === 'card') {
    try {
      for (const f of require('./gateway').customerIssues({ name, phone, email })) {
        if (f && f.field && !fields.some((x) => x.field === f.field)) fields.push({ field: String(f.field), message: String(f.message || '') });
      }
    } catch (e) { /* no gateway, no extra rule */ }
  }
  const address = {
    city: clip(a.city, 60),
    street: clip(a.street, 120),
    zip: clip(a.zip, 10).replace(/[^\d]/g, ''),
    notes: clip(a.notes, 200)
  };
  if (needsAddress) {
    if (address.city.length < 2) fields.push({ field: 'city', message: 'נא למלא עיר' });
    if (address.street.length < 2) fields.push({ field: 'street', message: 'נא למלא רחוב ומספר בית' });
  }
  return { customer: { name, phone, email }, address: needsAddress ? address : { city: address.city, street: '', zip: '', notes: address.notes }, fields };
}

function newToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function nextNumber(settings) {
  const row = db.prepare('SELECT MAX(CAST(number AS INTEGER)) AS n FROM store_orders').get();
  const max = row && row.n ? Number(row.n) : 0;
  return String(Math.max(settings.orderStart || 1001, max + 1));
}

function addEvent(orderId, kind, text) {
  db.prepare('INSERT INTO store_order_events (order_id, kind, text) VALUES (?, ?, ?)').run(orderId, kind, clip(text, 500));
}

/**
 * The payment method an order was placed with, as the shop knows it today.
 * By id first — what that id means now is the owner's call. When the id is
 * gone (a method renamed or replaced, a new catalog document with other
 * ids) the order's own payment_kind finds a method of the same kind, and
 * when the shop has none of that kind left the order still knows what it
 * is: its kind, under the label it was placed with. An order from before
 * v2.69 has no kind and answers null, as it always did.
 */
function methodOf(order, settings) {
  if (!order) return null;
  const s = settings || settingsMod.loadSettings();
  const byId = s.payments.find((p) => p.id === order.payment_method);
  if (byId) return byId;
  const kind = String(order.payment_kind || '');
  if (!kind || !settingsMod.PAYMENT_KINDS[kind]) return null;
  const sameKind = s.payments.find((p) => p.kind === kind);
  if (sameKind) return sameKind;
  return {
    id: order.payment_method || kind, kind,
    label: order.payment_label || settingsMod.PAYMENT_KINDS[kind].label,
    details: '', phone: '', url: '', maxPayments: 1
  };
}

function takeStock(line) {
  if (line.variant) {
    const r = db.prepare(`
      UPDATE store_variants SET stock = stock - ?
      WHERE product_id = ? AND code = ? AND stock IS NOT NULL AND stock >= ?
    `).run(line.qty, line.productId, line.variant, line.qty);
    if (r.changes) return true;
    const v = db.prepare('SELECT stock FROM store_variants WHERE product_id = ? AND code = ?').get(line.productId, line.variant);
    return !!v && (v.stock === null || v.stock === undefined);
  }
  const r = db.prepare(`
    UPDATE store_products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND stock IS NOT NULL AND stock >= ?
  `).run(line.qty, line.productId, line.qty);
  if (r.changes) return true;
  const p = db.prepare('SELECT stock FROM store_products WHERE id = ?').get(line.productId);
  return !!p && (p.stock === null || p.stock === undefined);
}

function giveStock(item) {
  if (!item.product_id) return;
  if (item.variant) {
    db.prepare('UPDATE store_variants SET stock = stock + ? WHERE product_id = ? AND code = ? AND stock IS NOT NULL')
      .run(item.qty, item.product_id, item.variant);
  } else {
    db.prepare('UPDATE store_products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock IS NOT NULL')
      .run(item.qty, item.product_id);
  }
}

/**
 * What the static storefront SAYS about stock — sold out, and the exact
 * "נותרו N במלאי" once a count is at or under the low-stock line. Compared
 * before/after an order: when it changed, the storefront is rebuilt, so the
 * published pages never claim a number that is no longer true.
 */
function soldOutFingerprint(productIds) {
  if (!productIds.length) return '';
  const low = settingsMod.loadSettings().lowStock;
  const mark = (stock) => (stock === null || stock === undefined ? 'u' : stock <= 0 ? 'n' : stock <= low ? String(stock) : 'y');
  const marks = productIds.map(() => '?').join(',');
  const p = db.prepare(`SELECT id, stock FROM store_products WHERE id IN (${marks}) ORDER BY id`).all(...productIds);
  const v = db.prepare(`SELECT product_id, code, stock FROM store_variants WHERE product_id IN (${marks}) ORDER BY product_id, code`).all(...productIds);
  return p.map((r) => r.id + ':' + mark(r.stock)).join(',') + '|' +
    v.map((r) => r.product_id + '.' + r.code + ':' + mark(r.stock)).join(',');
}

/**
 * Place an order. Never throws for a shopper's mistake — it answers:
 *   { ok:true, order, next, pay }                       placed
 *   { ok:false, code:'FIELDS', fields:[{field,message}] } fix the form
 *   { ok:false, code:'CART_CHANGED', quote }             the cart changed — show it
 *   { ok:false, code:'CLOSED'|'EMPTY'|'MIN_ORDER'|…, message, quote }
 * @param {object} input  { items, shipping, payment, coupon, customer:{name,phone,email}, address:{city,street,zip,notes}, note, acceptTerms }
 * @param {{ urlFor?:Function, orderUrl?:(token:string)=>string, req?:object, res?:object, now?:Date }} ctx
 */
function placeOrder(input = {}, ctx = {}) {
  const settings = settingsMod.loadSettings();
  if (!settings.open) return { ok: false, code: 'CLOSED', message: 'החנות סגורה כרגע — אי אפשר להזמין' };

  // a first, lock-free look to validate the form against the cart as it is
  const peek = pricing.quote(input, { settings, urlFor: ctx.urlFor, now: ctx.now });
  const shipOpt = peek.shippingOptions.find((o) => o.id === peek.shippingMethod) || null;
  const payment = settings.payments.find((p) => p.id === peek.payment) || null;
  const form = cleanCustomer(input.customer || {}, input.address || {}, settings, !!(shipOpt && shipOpt.address), payment ? payment.kind : '');
  if (settings.terms && !(input.acceptTerms === true || input.acceptTerms === 'true' || input.acceptTerms === 'on')) {
    form.fields.push({ field: 'terms', message: 'יש לאשר את תנאי השימוש' });
  }
  const note = clip(input.note, 1000);
  // what no form can fix is said before the form is judged: a shopper must
  // not be sent to correct a phone number for an order that cannot exist
  for (const code of ['NO_PAYMENT', 'TOO_LARGE']) {
    if (peek.blocking.includes(code)) return { ok: false, code, message: REFUSALS[code], quote: pricing.publicQuote(peek) };
  }
  if (form.fields.length) return { ok: false, code: 'FIELDS', message: 'יש להשלים כמה פרטים', fields: form.fields, quote: pricing.publicQuote(peek) };

  let placed = null;
  let before = '';
  const productIds = [];
  const tx = db.transaction(() => {
    const q = pricing.quote(input, { settings, urlFor: ctx.urlFor, now: ctx.now });
    if (q.changed) throw new OrderRefusal('CART_CHANGED', 'העגלה השתנתה — בדקו אותה לפני שממשיכים', { quote: q });
    if (!q.ok) {
      const code = q.blocking[0] || 'EMPTY';
      const msg = code === 'MIN_ORDER' ? 'הזמנת מינימום: ' + q.minOrderText : (REFUSALS[code] || 'אי אפשר להשלים את ההזמנה');
      throw new OrderRefusal(code, msg, { quote: q });
    }
    for (const l of q.lines) if (!productIds.includes(l.productId)) productIds.push(l.productId);
    before = soldOutFingerprint(productIds);

    for (const l of q.lines) {
      if (!takeStock(l)) throw new OrderRefusal('CART_CHANGED', `"${l.title}" אזל בדיוק עכשיו — העגלה עודכנה`, { quote: pricing.quote(input, { settings, urlFor: ctx.urlFor, now: ctx.now }) });
    }
    if (q.coupon && q.coupon.ok) {
      const r = db.prepare(`
        UPDATE store_coupons SET used = used + 1
        WHERE code = ? AND active = 1 AND (max_uses IS NULL OR used < max_uses)
      `).run(q.coupon.code);
      if (!r.changes) throw new OrderRefusal('COUPON_GONE', 'הקופון מומש עד תומו ברגע זה — נסו שוב בלעדיו', { quote: q });
    }

    const ship = q.shippingOptions.find((o) => o.id === q.shippingMethod) || null;
    const pay = settings.payments.find((p) => p.id === q.payment) || null;
    const number = nextNumber(settings);
    const token = newToken();
    // the KIND is kept beside the id and the label: an id is the owner's to
    // rename, and an open order must still know how it is paid afterwards
    const info = db.prepare(`
      INSERT INTO store_orders (number, token, status, payment_method, payment_label, payment_kind, shipping_method, shipping_label,
        currency, subtotal, discount, shipping, vat, vat_rate, vat_included, total, coupon,
        customer_name, customer_email, customer_phone, address, note)
      VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(number, token, pay ? pay.id : '', pay ? pay.label : '', pay ? pay.kind : '', ship ? ship.id : '', ship ? ship.label : '',
      q.currency, q.subtotal, q.discount, q.shipping, q.vat, q.vatRate, q.vatIncluded ? 1 : 0, q.total,
      q.coupon && q.coupon.ok ? q.coupon.code : '',
      form.customer.name, form.customer.email, form.customer.phone, JSON.stringify(form.address), note);
    const orderId = Number(info.lastInsertRowid);
    const ins = db.prepare(`
      INSERT INTO store_order_items (order_id, product_id, slug, title, variant, variant_label, unit_price, qty, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of q.lines) ins.run(orderId, l.productId, l.sku, l.title, l.variant, l.variantLabel, l.unit, l.qty, l.total);
    addEvent(orderId, 'created', 'ההזמנה התקבלה באתר');
    placed = orderId;
  });

  try {
    tx.immediate();
  } catch (e) {
    if (e instanceof OrderRefusal) {
      return { ok: false, code: e.code, message: e.message, quote: e.quote ? pricing.publicQuote(e.quote) : undefined };
    }
    throw e;
  }

  const order = getOrderById(placed);
  const stockChanged = soldOutFingerprint(productIds) !== before;

  // after the point of no return: nothing below may cost the order
  try {
    const crm = require('../crm');
    const captured = crm.captureOrder && crm.captureOrder({ order, items: listItems(order.id), req: ctx.req, res: ctx.res });
    if (captured && captured.contact && captured.contact.id) {
      db.prepare('UPDATE store_orders SET contact_id = ? WHERE id = ?').run(captured.contact.id, order.id);
    }
  } catch (e) { console.error('[store] crm capture failed:', e.message); }
  try {
    require('./notify').orderPlaced(order, listItems(order.id)).catch(() => {});
  } catch (e) { console.error('[store] order notify failed:', e.message); }

  return {
    ok: true,
    order: publicOrder(order),
    stockChanged,
    next: ctx.orderUrl ? ctx.orderUrl(order.token) : '',
    pay: paymentUrl(order, settings) || payAction(order, settings)
  };
}

/** The owner's own payment page, filled with this order's number and total — https only, and no personal data in the address. */
function paymentUrl(order, settings) {
  const s = settings || settingsMod.loadSettings();
  const m = methodOf(order, s);
  if (!m || m.kind !== 'link' || !m.url) return '';
  if (order.paid_at || order.status === 'cancelled') return '';
  return m.url
    .split('{total}').join(encodeURIComponent(money.fromMinor(order.total)))
    .split('{order}').join(encodeURIComponent(order.number))
    .split('{currency}').join(encodeURIComponent(order.currency));
}

/**
 * A card order's "pay" is a FIRST-PARTY action, never a provider URL: the
 * order page POSTs it (src/routes/store-gateway.js) and follows the hosted
 * page it gets back. So the checkout reply's `pay` says "there is a payment
 * step" without a browser ever holding a gateway address.
 */
function payAction(order, settings) {
  const s = settings || settingsMod.loadSettings();
  const m = methodOf(order, s);
  if (!m || m.kind !== 'card') return '';
  if (order.paid_at || order.status === 'cancelled') return '';
  return '/api/store/pay/' + encodeURIComponent(order.token);
}

// ── reading ────────────────────────────────────────────────────────────

function getOrderById(id) {
  return db.prepare('SELECT * FROM store_orders WHERE id = ?').get(Number(id)) || null;
}

function getOrder(number) {
  return db.prepare('SELECT * FROM store_orders WHERE number = ?').get(String(number || '')) || null;
}

function getOrderByToken(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(t)) return null;
  return db.prepare('SELECT * FROM store_orders WHERE token = ?').get(t) || null;
}

function listItems(orderId) {
  return db.prepare('SELECT * FROM store_order_items WHERE order_id = ? ORDER BY id').all(orderId);
}

function listEvents(orderId) {
  return db.prepare('SELECT * FROM store_order_events WHERE order_id = ? ORDER BY id').all(orderId);
}

function parseAddress(order) {
  try { return JSON.parse(order.address || '{}') || {}; } catch (e) { return {}; }
}

/** The WHERE of the order list, shared by the list, its count and the CSV so the three can never disagree. */
function orderFilter(opts = {}) {
  const where = [];
  const args = [];
  if (opts.status && STATUSES.includes(opts.status)) { where.push('status = ?'); args.push(opts.status); }
  if (opts.paid === 'yes') where.push('paid_at IS NOT NULL');
  if (opts.paid === 'no') where.push("paid_at IS NULL AND status != 'cancelled'");
  if (opts.q) {
    const like = '%' + String(opts.q).slice(0, 80) + '%';
    where.push('(number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR customer_email LIKE ?)');
    args.push(like, like, like, like);
  }
  return { where, args };
}

/**
 * @param {{ status?:string, q?:string, limit?:number, offset?:number, paid?:'yes'|'no', beforeId?:number }} opts
 *   `beforeId` pages by row id instead of an offset (the CSV walks every order this way)
 */
function listOrders(opts = {}) {
  const { where, args } = orderFilter(opts);
  const before = parseInt(opts.beforeId, 10);
  if (Number.isFinite(before) && before > 0) { where.push('id < ?'); args.push(before); }
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 100, 1), 1000);
  const offset = Math.max(parseInt(opts.offset, 10) || 0, 0);
  return db.prepare(
    'SELECT * FROM store_orders' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY id DESC LIMIT ' + limit + ' OFFSET ' + offset
  ).all(...args);
}

/** How many orders the same filter matches — what the list's pager counts pages from. */
function countOrders(opts = {}) {
  const { where, args } = orderFilter(opts);
  return db.prepare('SELECT COUNT(*) AS n FROM store_orders' + (where.length ? ' WHERE ' + where.join(' AND ') : '')).get(...args).n;
}

function countByStatus() {
  const out = { all: 0, unpaid: 0 };
  for (const s of STATUSES) out[s] = 0;
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM store_orders GROUP BY status').all()) {
    out[r.status] = r.n;
    out.all += r.n;
  }
  out.unpaid = db.prepare("SELECT COUNT(*) AS n FROM store_orders WHERE paid_at IS NULL AND status != 'cancelled'").get().n;
  return out;
}

/**
 * Revenue that counts: not cancelled. Days are local calendar days.
 * `today` / `month` are what was ORDERED (paid or not — a sandbox shop
 * orders millions); `paidToday` / `paidMonth` are what was actually PAID,
 * by the day the money was marked, so a test payment (which never sets
 * paid_at) is not in them.
 */
function stats(now) {
  const d = now instanceof Date ? now : new Date();
  const day = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  const today = day(d);
  const monthStart = today.slice(0, 8) + '01';
  const sum = (from) => db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM store_orders
    WHERE status != 'cancelled' AND date(created_at, 'localtime') >= ?
  `).get(from);
  const paid = (from) => db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM store_orders
    WHERE status != 'cancelled' AND paid_at IS NOT NULL AND date(paid_at, 'localtime') >= ?
  `).get(from);
  return { today: sum(today), month: sum(monthStart), paidToday: paid(today), paidMonth: paid(monthStart), counts: countByStatus() };
}

// ── changing ───────────────────────────────────────────────────────────

/**
 * Move an order to a status. Cancelling returns its stock (and its coupon
 * use); leaving 'cancelled' takes the stock again — or refuses, naming what
 * is missing, because an order must never promise stock that is not there.
 */
function setStatus(number, status, opts = {}) {
  if (!STATUSES.includes(status)) throw new Error('סטטוס לא מוכר');
  const order = getOrder(number);
  if (!order) throw new Error('ההזמנה לא נמצאה');
  if (order.status === status) return order;
  const items = listItems(order.id);
  db.transaction(() => {
    if (status === 'cancelled') {
      for (const it of items) giveStock(it);
      if (order.coupon) db.prepare('UPDATE store_coupons SET used = MAX(used - 1, 0) WHERE code = ?').run(order.coupon);
    } else if (order.status === 'cancelled') {
      for (const it of items) {
        if (!it.product_id) continue;
        const ok = takeStock({ productId: it.product_id, variant: it.variant, qty: it.qty });
        if (!ok) throw new Error(`אין מספיק מלאי של "${it.title}${it.variant_label ? ' — ' + it.variant_label : ''}" כדי לשחזר את ההזמנה`);
      }
      if (order.coupon) db.prepare('UPDATE store_coupons SET used = used + 1 WHERE code = ?').run(order.coupon);
    }
    db.prepare('UPDATE store_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, order.id);
    addEvent(order.id, 'status', 'סטטוס: ' + STATUS_LABELS[order.status] + ' ← ' + STATUS_LABELS[status] + (opts.note ? ' · ' + opts.note : ''));
  }).immediate();
  const after = getOrder(number);
  if (opts.notify !== false && (status === 'shipped' || status === 'cancelled')) {
    try { require('./notify').statusChanged(after, listItems(after.id)).catch(() => {}); } catch (e) { /* never blocks */ }
  }
  return after;
}

function markPaid(number, paid) {
  const order = getOrder(number);
  if (!order) throw new Error('ההזמנה לא נמצאה');
  if (!!order.paid_at === !!paid) return order;
  // money that came through the gateway cannot be waved away with a
  // checkbox — it goes back through an explicit refund, recorded
  if (!paid && require('./gateway').isGatewayPaid(order.id)) {
    throw new Error('ההזמנה שולמה בכרטיס אשראי דרך חברת הסליקה — אי אפשר לבטל את הסימון. להחזרת הכסף יש להשתמש בפעולת ההחזר');
  }
  db.prepare('UPDATE store_orders SET paid_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(paid ? new Date().toISOString() : null, order.id);
  addEvent(order.id, 'payment', paid ? 'סומנה כשולמה' : 'סימון התשלום בוטל');
  return getOrder(number);
}

// a payment page someone may still be standing on (PayPal keeps an approval
// open about this long), and how long an unclear answer is given to clear up
const PAYING_NOW_MS = 3 * 60 * 60 * 1000;
const UNCLEAR_MS = 24 * 60 * 60 * 1000;

/**
 * Cancel orders nobody paid. Stock is taken when an order is PLACED, so an
 * abandoned checkout holds its units until someone cancels it — and a
 * public shop with three of something sells itself out to people who left.
 * This cancels `new`, unpaid orders older than `olderThanMs` through
 * setStatus (so the stock and the coupon use come back exactly as a manual
 * cancel returns them), without mail.
 *
 * Left alone, whatever their age: an order with a payment that was
 * confirmed in ANY mode (a demo or sandbox payment is the end of that
 * order's story), one with a sum that did not match (money may have moved),
 * one whose payment page was opened in the last few hours (someone may be
 * paying right now), and one whose provider gave an unclear answer in the
 * last day (the inquiry may still settle it).
 *
 * And never, however old: an order with a PayPal row IN DOUBT — a capture
 * that was attempted and has no clear answer (`capture_tried_at` on a row
 * still pending; see src/store/paypal.js). That may be money already taken;
 * cancelling it would hand the stock to someone else and tell nobody. Such
 * an order waits for PayPal's word — housekeeping() asks — and once the row
 * is closed as really unpaid it is an ordinary unpaid order again, left
 * alone only while its buyer may still be at the page (a capture tried in
 * the last few hours).
 * @returns {{ expired:number, numbers:string[] }}
 */
function expireUnpaid({ olderThanMs } = {}) {
  const ms = Number(olderThanMs);
  if (!Number.isFinite(ms) || ms <= 0) return { expired: 0, numbers: [] };
  const iso = (ago) => new Date(Date.now() - ago).toISOString();
  // julianday() reads both SQLite's own CURRENT_TIMESTAMP form and an ISO stamp
  const rows = db.prepare(`
    SELECT o.number FROM store_orders o
    WHERE o.status = 'new' AND o.paid_at IS NULL AND julianday(o.created_at) < julianday(?)
      AND NOT EXISTS (
        SELECT 1 FROM store_payments p WHERE p.order_id = o.id AND (
          p.status IN ('paid', 'refunded', 'mismatch')
          OR (p.status = 'pending' AND p.session_id != '' AND julianday(p.created_at) > julianday(?))
          OR (p.status = 'pending' AND p.session_id != '' AND p.error != '' AND julianday(p.created_at) > julianday(?))
          OR (p.status = 'pending' AND p.capture_tried_at != '')
          OR (p.capture_tried_at != '' AND julianday(p.capture_tried_at) > julianday(?))
        )
      )
    ORDER BY o.id LIMIT 500
  `).all(iso(ms), iso(PAYING_NOW_MS), iso(UNCLEAR_MS), iso(PAYING_NOW_MS));
  const numbers = [];
  for (const r of rows) {
    try {
      setStatus(r.number, 'cancelled', { notify: false, note: 'בוטלה אוטומטית: לא שולמה' });
      numbers.push(r.number);
    } catch (e) {
      console.error('[store] could not expire order ' + r.number + ':', e.message);
    }
  }
  return { expired: numbers.length, numbers };
}

/**
 * The store's part of the server's daily round. Safe to call at any time
 * and never throws: with `holdHours` at 0 (the default) it does nothing;
 * above 0 it cancels unpaid orders older than that, and the storefront's
 * sold-out marks follow the stock that came back.
 *
 * Whatever `holdHours` says, the round first asks PayPal about captures
 * that have no answer (askAboutDoubts). That is a network call, so
 * `inquiry` is a promise that resolves after this function has returned —
 * it never rejects, and the caller is free to ignore it. The cancelling
 * below does not wait for it and does not need to: an order with a row in
 * doubt is not cancelled, here or anywhere.
 * @returns {{ expired:number, inquiry:Promise<{ asked:number, settled:number, closed:number }> }}
 */
function housekeeping() {
  const inquiry = askAboutDoubts();
  try {
    const hours = Number(settingsMod.loadSettings().holdHours) || 0;
    if (hours <= 0) return { expired: 0, inquiry };
    const r = expireUnpaid({ olderThanMs: hours * 60 * 60 * 1000 });
    if (r.expired) {
      try { require('./index').scheduleRefresh(); } catch (e) { /* the next build says it */ }
    }
    return { expired: r.expired, inquiry };
  } catch (e) {
    console.error('[store] housekeeping failed:', e.message);
    return { expired: 0, inquiry };
  }
}

/**
 * Orders held because a PayPal capture has no answer resolve themselves
 * here: PayPal is asked (a handful of rows a round, each on its own — see
 * paypal.resolveInDoubt), and a row it settles marks its order paid the way
 * a capture would. A row it closes as never charged leaves an ordinary
 * unpaid order behind, so the hold rule gets its look at once rather than
 * an hour later. Never throws, never rejects.
 */
function askAboutDoubts() {
  const none = { asked: 0, settled: 0, closed: 0 };
  try {
    return Promise.resolve(require('./paypal').resolveInDoubt()).then((r) => {
      if (r && r.closed) {
        const hours = Number(settingsMod.loadSettings().holdHours) || 0;
        if (hours > 0 && expireUnpaid({ olderThanMs: hours * 60 * 60 * 1000 }).expired) {
          try { require('./index').scheduleRefresh(); } catch (e) { /* the next build says it */ }
        }
      }
      return r || none;
    }).catch((e) => {
      console.error('[store] housekeeping inquiry failed:', e.message);
      return none;
    });
  } catch (e) {
    return Promise.resolve(none);
  }
}

function setTracking(number, tracking) {
  const order = getOrder(number);
  if (!order) throw new Error('ההזמנה לא נמצאה');
  const t = clip(tracking, 120);
  db.prepare('UPDATE store_orders SET tracking = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(t, order.id);
  addEvent(order.id, 'tracking', t ? 'מספר מעקב: ' + t : 'מספר המעקב הוסר');
  return getOrder(number);
}

function setAdminNote(number, note) {
  const order = getOrder(number);
  if (!order) throw new Error('ההזמנה לא נמצאה');
  db.prepare('UPDATE store_orders SET admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(clip(note, 2000), order.id);
  return getOrder(number);
}

// ── the shopper's view of their order ──────────────────────────────────

function imageOf(productId) {
  if (!productId) return '';
  try {
    const row = db.prepare('SELECT images FROM store_products WHERE id = ?').get(productId);
    const list = row ? JSON.parse(row.images || '[]') : [];
    return Array.isArray(list) && list[0] ? String(list[0]) : '';
  } catch (e) { return ''; }
}

/**
 * What the order page shows the person holding the link: the order, its
 * status and how to pay. Deliberately NOT the phone, the email or the
 * street — a shared screenshot of an order page must not hand those out.
 */
function publicOrder(order) {
  if (!order) return null;
  const s = settingsMod.loadSettings();
  const cur = order.currency;
  const fmt = (n) => money.formatMoney(n, cur);
  // by id, else by the kind the order kept — a renamed method must not strand it
  const pay = methodOf(order, s);
  const addr = parseAddress(order);
  return {
    number: order.number,
    token: order.token,
    status: order.status,
    statusLabel: statusLabel(order),
    statusText: STATUS_TEXT[order.status] || '',
    paid: !!order.paid_at,
    createdAt: order.created_at,
    firstName: String(order.customer_name || '').split(/\s+/)[0] || '',
    city: addr.city || '',
    items: listItems(order.id).map((it) => ({
      title: it.title,
      variantLabel: it.variant_label,
      qty: it.qty,
      unitText: fmt(it.unit_price),
      totalText: fmt(it.line_total),
      // the product's picture as it is today (the order kept its own title and price)
      image: imageOf(it.product_id)
    })),
    subtotalText: fmt(order.subtotal),
    discountText: order.discount ? '-' + fmt(order.discount) : '',
    coupon: order.coupon || '',
    shippingLabel: order.shipping_label,
    shippingText: order.shipping_method ? (order.shipping ? fmt(order.shipping) : 'חינם') : '',
    vatText: order.vat ? fmt(order.vat) : '',
    vatRate: order.vat_rate,
    vatIncluded: !!order.vat_included,
    totalText: fmt(order.total),
    tracking: order.tracking || '',
    payment: pay ? {
      kind: pay.kind,
      label: order.payment_label || pay.label,
      details: settingsMod.paymentDetails(pay),
      phone: pay.phone,
      url: paymentUrl(order, s),
      // a card order: the state of its gateway payment and where to POST —
      // never a provider id, a session id or a key
      ...(pay.kind === 'card' ? { card: require('./gateway').publicPayment(order, s) } : {}),
      // lazy: paypal.js loads orders.js (this file) once both modules are up
      ...(pay.kind === 'paypal' ? { paypal: require('./paypal').publicPayment(order) } : {}),
      // a demo order: whether its button may be pressed, whether it was, and one sentence
      ...(pay.kind === 'demo' ? { demo: require('./demo-pay').publicPayment(order, s) } : {})
    } : { kind: '', label: order.payment_label || '', details: '', phone: '', url: '' },
    thanks: s.thanks
  };
}

// ── export ─────────────────────────────────────────────────────────────

function csvCell(v) {
  let s = String(v == null ? '' : v);
  // spreadsheet formula injection: a cell that starts with = + - @ is data, not a formula
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const CSV_HEAD = ['מספר', 'תאריך', 'סטטוס', 'שולם', 'שם', 'טלפון', 'מייל', 'עיר', 'כתובת', 'מיקוד', 'משלוח', 'תשלום',
  'פריטים', 'סכום ביניים', 'הנחה', 'דמי משלוח', 'מע״מ', 'סה״כ', 'קופון', 'הערת לקוח',
  // v2.69 — appended, so a spreadsheet built on the first twenty columns still lines up
  'מספר מעקב', 'סוג תשלום', 'ספק תשלום', 'מזהה עסקה', 'שולם בתאריך'];
const CSV_BATCH = 500;

function csvLine(o, items, payment) {
  const a = parseAddress(o);
  const lines = items.map((it) => it.title + (it.variant_label ? ' (' + it.variant_label + ')' : '') + ' ×' + it.qty).join('; ');
  return [
    o.number, o.created_at, STATUS_LABELS[o.status] || o.status, o.paid_at ? 'כן' : 'לא',
    o.customer_name, o.customer_phone, o.customer_email, a.city || '', a.street || '', a.zip || '',
    o.shipping_label, o.payment_label, lines,
    money.fromMinor(o.subtotal), money.fromMinor(o.discount), money.fromMinor(o.shipping),
    money.fromMinor(o.vat), money.fromMinor(o.total), o.coupon, o.note,
    o.tracking || '', o.payment_kind || '',
    // a test payment is named as one, so a sandbox row is never read as money
    payment ? payment.provider + (payment.mode === 'test' ? ' (בדיקה)' : '') : '',
    payment ? payment.transaction_id : '', o.paid_at || ''
  ].map(csvCell).join(',');
}

/**
 * The orders as CSV, a batch at a time: EVERY order the filter matches,
 * however many there are (it used to stop at 1000 without saying so). The
 * walk is by row id, newest first, so an order placed while the file is
 * being written neither repeats a line nor skips one. The route writes each
 * chunk as it comes; ordersCsv() joins them for a caller that wants a string.
 */
function* ordersCsvChunks(opts = {}) {
  yield csvHead();
  let beforeId = 0;
  for (;;) {
    const rows = listOrders({ ...opts, offset: 0, limit: CSV_BATCH, beforeId });
    if (!rows.length) return;
    const ids = rows.map((o) => o.id);
    const marks = ids.map(() => '?').join(',');
    const itemsBy = new Map();
    for (const it of db.prepare(`SELECT * FROM store_order_items WHERE order_id IN (${marks}) ORDER BY id`).all(...ids)) {
      if (!itemsBy.has(it.order_id)) itemsBy.set(it.order_id, []);
      itemsBy.get(it.order_id).push(it);
    }
    // the payment row that holds (or held) the order's money — the newest one wins
    const payBy = new Map();
    for (const p of db.prepare(`
      SELECT order_id, provider, mode, transaction_id FROM store_payments
      WHERE order_id IN (${marks}) AND status IN ('paid', 'refunded') ORDER BY id
    `).all(...ids)) payBy.set(p.order_id, p);
    yield rows.map((o) => csvLine(o, itemsBy.get(o.id) || [], payBy.get(o.id) || null)).join('\r\n') + '\r\n';
    if (rows.length < CSV_BATCH) return;
    beforeId = rows[rows.length - 1].id;
  }
}

function ordersCsv(opts = {}) {
  return [...ordersCsvChunks(opts)].join('');
}

/** The byte-order mark a spreadsheet needs to read Hebrew as UTF-8, then the header line. */
function csvHead() {
  const out = [CSV_HEAD.map(csvCell).join(',')];
  return '﻿' + out.join('\r\n') + '\r\n';
}

// ── privacy (called from the CRM's subject export / erase) ─────────────

function ordersForSubject({ contactId, email, phone } = {}) {
  const where = [];
  const args = [];
  if (contactId) { where.push('contact_id = ?'); args.push(contactId); }
  if (email) { where.push('lower(customer_email) = lower(?)'); args.push(email); }
  if (phone) {
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length >= 9) { where.push("replace(replace(replace(customer_phone, '-', ''), ' ', ''), '+', '') LIKE ?"); args.push('%' + digits.slice(-9)); }
  }
  if (!where.length) return [];
  const gateway = require('./gateway');
  return db.prepare('SELECT * FROM store_orders WHERE erased = 0 AND (' + where.join(' OR ') + ') ORDER BY id').all(...args)
    .map((o) => ({ ...o, items: listItems(o.id), payments: gateway.paymentsForSubject(o.id) }));
}

/**
 * An erasure request: the person's details leave every order they placed;
 * the order itself (what was sold, for how much, when) stays — a business
 * must keep its sales records, and they are no longer about anyone.
 */
function eraseForSubject(who = {}) {
  const orders = ordersForSubject(who);
  const run = db.prepare(`
    UPDATE store_orders SET customer_name = 'נמחק לבקשת הלקוח', customer_email = '', customer_phone = '',
      address = '{}', note = '', contact_id = NULL, erased = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);
  const gateway = require('./gateway');
  db.transaction(() => {
    for (const o of orders) {
      run.run(o.id);
      // the card's last-4 and brand are about the person too; the sums and
      // the provider's transaction ids are the sale's record and stay
      gateway.eraseForOrder(o.id);
      addEvent(o.id, 'erased', 'פרטי הלקוח נמחקו לבקשתו');
    }
  })();
  return orders.length;
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  STATUS_TEXT,
  OrderRefusal,
  cleanCustomer,
  placeOrder,
  paymentUrl,
  payAction,
  addEvent,
  methodOf,
  getOrder,
  getOrderById,
  getOrderByToken,
  listOrders,
  countOrders,
  listItems,
  listEvents,
  parseAddress,
  countByStatus,
  stats,
  statusLabel,
  setStatus,
  markPaid,
  setTracking,
  setAdminNote,
  expireUnpaid,
  housekeeping,
  publicOrder,
  ordersCsv,
  ordersCsvChunks,
  CSV_HEAD,
  ordersForSubject,
  eraseForSubject
};
