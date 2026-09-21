'use strict';

/**
 * Coupons — a code a shopper types at checkout.
 *
 *   percent  — N% off the subtotal (1–100)
 *   amount   — a fixed sum off (never below zero)
 *   shipping — free delivery
 *
 * Optional: a minimum subtotal, a first/last valid day (inclusive, the
 * site's local calendar day), a total-uses ceiling. The ceiling is enforced
 * INSIDE the order transaction (orders.js) with a guarded UPDATE, so two
 * shoppers racing for the last use cannot both get it.
 */

const { db } = require('../db');
const money = require('./money');

const KINDS = ['percent', 'amount', 'shipping'];
const KIND_LABELS = { percent: 'אחוז הנחה', amount: 'סכום הנחה', shipping: 'משלוח חינם' };
const CODE_RE = /^[A-Z0-9א-ת][A-Z0-9א-ת_-]{1,31}$/;

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 32);
}

function isoDay(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Today as YYYY-MM-DD in local time (coupons end at the end of the owner's day). */
function today(now) {
  const d = now instanceof Date ? now : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function hydrate(row) {
  if (!row) return null;
  return {
    code: row.code,
    kind: row.kind,
    value: row.value,
    minSubtotal: row.min_subtotal || 0,
    startsOn: row.starts_on || '',
    endsOn: row.ends_on || '',
    maxUses: row.max_uses,
    used: row.used || 0,
    active: !!row.active,
    note: row.note || ''
  };
}

function listCoupons() {
  return db.prepare('SELECT * FROM store_coupons ORDER BY active DESC, code').all().map(hydrate);
}

function getCoupon(code) {
  return hydrate(db.prepare('SELECT * FROM store_coupons WHERE code = ?').get(normalizeCode(code)));
}

/**
 * Validate a coupon as typed. `value` is a percent for kind=percent and a
 * price (major units or minor integer) for kind=amount.
 * @returns {{ coupon: object|null, errors: string[] }}
 */
function normalizeCoupon(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = [];
  const code = normalizeCode(src.code);
  if (!CODE_RE.test(code)) errors.push('קוד קופון: 2–32 תווים — אותיות, ספרות, מקף');
  const kind = KINDS.includes(src.kind) ? src.kind : null;
  if (!kind) errors.push('סוג קופון לא מוכר');
  let value = 0;
  if (kind === 'percent') {
    value = parseInt(src.value, 10);
    if (!Number.isFinite(value) || value < 1 || value > 100) errors.push('אחוז הנחה: בין 1 ל-100');
  } else if (kind === 'amount') {
    value = typeof src.value === 'number' && Number.isInteger(src.value) ? src.value : money.toMinor(src.value);
    if (!Number.isFinite(value) || value <= 0) errors.push('סכום ההנחה אינו תקין');
  }
  const min = src.minSubtotal === undefined || src.minSubtotal === '' || src.minSubtotal === null ? 0
    : (typeof src.minSubtotal === 'number' && Number.isInteger(src.minSubtotal) ? src.minSubtotal : money.toMinor(src.minSubtotal));
  if (!Number.isFinite(min) || min < 0) errors.push('סכום מינימום אינו תקין');
  const startsOn = isoDay(src.startsOn);
  const endsOn = isoDay(src.endsOn);
  if (startsOn && endsOn && endsOn < startsOn) errors.push('תאריך הסיום לפני תאריך ההתחלה');
  let maxUses = src.maxUses === undefined || src.maxUses === null || src.maxUses === '' ? null : parseInt(src.maxUses, 10);
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) { errors.push('מספר שימושים: 1 ומעלה, או ריק ללא הגבלה'); maxUses = null; }
  if (errors.length) return { coupon: null, errors };
  return {
    coupon: {
      code, kind, value,
      minSubtotal: min,
      startsOn, endsOn, maxUses,
      active: !(src.active === false || src.active === 'false' || src.active === 0 || src.active === '0'),
      note: String(src.note || '').trim().slice(0, 120)
    },
    errors
  };
}

function saveCoupon(input) {
  const n = normalizeCoupon(input);
  if (n.errors.length) { const e = new Error(n.errors.join(' · ')); e.errors = n.errors; throw e; }
  const c = n.coupon;
  db.prepare(`
    INSERT INTO store_coupons (code, kind, value, min_subtotal, starts_on, ends_on, max_uses, active, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET kind = excluded.kind, value = excluded.value,
      min_subtotal = excluded.min_subtotal, starts_on = excluded.starts_on, ends_on = excluded.ends_on,
      max_uses = excluded.max_uses, active = excluded.active, note = excluded.note
  `).run(c.code, c.kind, c.value, c.minSubtotal, c.startsOn, c.endsOn, c.maxUses, c.active ? 1 : 0, c.note);
  return getCoupon(c.code);
}

function deleteCoupon(code) {
  return db.prepare('DELETE FROM store_coupons WHERE code = ?').run(normalizeCode(code)).changes > 0;
}

/**
 * Would this code apply to this cart right now? Pure over the coupon row —
 * never consumes a use (placing the order does).
 * @param {string} code
 * @param {{ subtotal:number, currency?:string, now?:Date }} ctx
 * @returns {{ ok:boolean, code:string, coupon?:object, discount:number, freeShipping:boolean, message:string }}
 */
function evaluate(code, ctx = {}) {
  const c = normalizeCode(code);
  const none = { ok: false, code: c, discount: 0, freeShipping: false, message: '' };
  if (!c) return none;
  const coupon = getCoupon(c);
  if (!coupon || !coupon.active) return { ...none, message: 'הקוד אינו בתוקף' };
  const day = today(ctx.now);
  if (coupon.startsOn && day < coupon.startsOn) return { ...none, message: 'הקוד עוד לא בתוקף' };
  if (coupon.endsOn && day > coupon.endsOn) return { ...none, message: 'תוקף הקוד פג' };
  if (coupon.maxUses !== null && coupon.used >= coupon.maxUses) return { ...none, message: 'הקוד מומש עד תומו' };
  const subtotal = Math.max(0, Number(ctx.subtotal) || 0);
  if (coupon.minSubtotal && subtotal < coupon.minSubtotal) {
    return { ...none, message: 'הקוד תקף מקנייה של ' + money.formatMoney(coupon.minSubtotal, ctx.currency) + ' ומעלה' };
  }
  let discount = 0;
  let freeShipping = false;
  if (coupon.kind === 'percent') discount = Math.round(subtotal * coupon.value / 100);
  else if (coupon.kind === 'amount') discount = Math.min(subtotal, coupon.value);
  else freeShipping = true;
  const what = coupon.kind === 'percent' ? coupon.value + '% הנחה'
    : coupon.kind === 'amount' ? money.formatMoney(coupon.value, ctx.currency) + ' הנחה'
      : 'משלוח חינם';
  return { ok: true, code: c, coupon, discount, freeShipping, message: 'הקוד הופעל: ' + what };
}

module.exports = {
  KINDS,
  KIND_LABELS,
  normalizeCode,
  normalizeCoupon,
  listCoupons,
  getCoupon,
  saveCoupon,
  deleteCoupon,
  evaluate,
  today
};
