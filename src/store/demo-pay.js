'use strict';

/**
 * The demo payment (v2.69) — how a demo shop's order reaches its end.
 *
 * A visitor of a demo shop cannot finish a PayPal sandbox payment (that
 * takes a sandbox buyer account) and must never be asked for a card. So a
 * demo shop offers one more payment kind, `demo`: the order page shows a
 * button, the button POSTs /api/store/demo-pay with the order's token, and
 * this module records the payment the way every test payment is recorded —
 * a store_payments row (provider `demo`, mode `test`, status `paid`) and an
 * order event that says no real money moved. paid_at stays empty: a demo
 * payment is not revenue, the same rule a PayPal sandbox capture and a card
 * gateway test confirmation follow.
 *
 * A REAL SHOP NEVER OFFERS IT BY ACCIDENT. allowed() is the one gate, asked
 * by the checkout (paypal.offeredPayments), by the order page
 * (publicPayment) and once more by the pay door itself: the site is a demo
 * site (the demo seed's marker), or the owner turned `demoPayments` on. A
 * `demo` method listed in any other shop is simply not offered, and
 * paypal.readinessNote() tells the owner why.
 *
 * orders.js is required inside the functions, not up here: it loads
 * paypal.js, which loads this module, while it is still loading.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const settingsMod = require('./settings');
const { CONFIG_DIR } = require('../paths');

const MARKER = 'demo-store';
const PAID_TEXT = 'תשלום לדוגמה התקבל — כסף אמיתי לא עבר';

function orders() { return require('./orders'); }

/**
 * Is this site a demo shop? The ONE place that answers it. The demo seed
 * owns the answer when it exports isDemoSite(); until then the marker it
 * writes is read here the same way: config/seeded.json holding an entry
 * that starts with "demo-store".
 */
function isDemoSite() {
  try {
    const seed = require('./demo-seed');
    if (typeof seed.isDemoSite === 'function') return !!seed.isDemoSite();
  } catch (e) { /* no seed module: the marker below is the answer */ }
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'seeded.json'), 'utf8'));
    if (!marker || typeof marker !== 'object') return false;
    const hit = (v) => typeof v === 'string' && v.indexOf(MARKER) === 0;
    if (Array.isArray(marker)) return marker.some(hit);
    return Object.entries(marker).some(([k, v]) => (hit(k) && !!v) || hit(v));
  } catch (e) {
    return false;
  }
}

/** May a `demo` method be offered and paid here, now? */
function allowed(settings) {
  const s = settings || settingsMod.loadSettings();
  return !!s.demoPayments || isDemoSite();
}

function paidRow(orderId) {
  return db.prepare("SELECT * FROM store_payments WHERE order_id = ? AND provider = 'demo' AND status = 'paid' ORDER BY id DESC LIMIT 1").get(Number(orderId)) || null;
}

/** What the order page may know about a demo order: can the button be pressed, was it pressed, and one sentence. */
function publicPayment(order, settings) {
  const paid = !!(order && paidRow(order.id));
  const open = !!order && order.status !== 'cancelled' && !order.paid_at;
  const canPay = open && !paid && allowed(settings);
  let message;
  if (paid) message = PAID_TEXT + '.';
  else if (canPay) message = 'זו חנות הדגמה. לחיצה על "לשלם בכסף דמיוני" משלימה את ההזמנה — כסף אמיתי לא עובר.';
  else if (order && order.status === 'cancelled') message = 'ההזמנה בוטלה — אין מה לשלם.';
  else if (order && order.paid_at) message = 'ההזמנה סומנה כשולמה.';
  else message = 'תשלום לדוגמה אינו זמין כרגע — צרו איתנו קשר.';
  return { canPay, paid, message };
}

function refuse(http, code, message) {
  return { ok: false, http, code, message };
}

/**
 * The pay door's whole job. The token is the capability; nothing else is
 * read from the request. A second press answers ok with the same order —
 * the row is written once, inside one immediate transaction.
 * @returns {{ ok:true, http:200, already:boolean, order:object } | { ok:false, http:number, code:string, message:string }}
 */
function payForOrder(token) {
  const O = orders();
  const order = O.getOrderByToken(token);
  if (!order) return refuse(404, 'NOT_FOUND', 'ההזמנה לא נמצאה');
  const s = settingsMod.loadSettings();
  const method = O.methodOf(order, s);
  if (!method || method.kind !== 'demo') return refuse(403, 'NOT_DEMO', 'ההזמנה הזו אינה לתשלום לדוגמה');
  if (order.status === 'cancelled') return refuse(409, 'CANCELLED', 'ההזמנה בוטלה — אין מה לשלם');
  if (paidRow(order.id)) return { ok: true, http: 200, already: true, order: O.publicOrder(order) };
  if (order.paid_at) return refuse(409, 'PAID', 'ההזמנה כבר סומנה כשולמה');
  if (!allowed(s)) return refuse(403, 'NOT_ALLOWED', 'תשלום לדוגמה אינו זמין באתר הזה');

  let already = false;
  db.transaction(() => {
    if (paidRow(order.id)) { already = true; return; }
    db.prepare(`
      INSERT INTO store_payments (order_id, provider, mode, reference, session_id, amount, currency, status, set_paid)
      VALUES (?, 'demo', 'test', ?, '', ?, ?, 'paid', 0)
    `).run(order.id, 'demo-' + crypto.randomBytes(10).toString('hex'), order.total, order.currency);
    O.addEvent(order.id, 'payment', PAID_TEXT);
  }).immediate();
  return { ok: true, http: 200, already, order: O.publicOrder(O.getOrderById(order.id)) };
}

module.exports = { isDemoSite, allowed, publicPayment, payForOrder, paidRow, PAID_TEXT };
