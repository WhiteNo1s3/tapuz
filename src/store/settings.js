'use strict';

/**
 * Store settings — one JSON document in `store_meta` (key 'settings').
 *
 * Holds the flip itself (`open`), money rules (currency, VAT), how an order
 * travels (shipping methods) and how it is paid (payment methods), and which
 * site pages ARE the store (shop / cart / checkout / order). Everything here
 * is also expressible as the <bent-store> document (dialect.js) — the admin
 * form and a pasted document write through the same normalize().
 *
 * Nothing secret belongs here: this row travels inside every `.pzn` export.
 * A payment method carries instructions a shopper is meant to read (bank
 * details, a Bit number, the address of the owner's own payment page) —
 * never a gateway key.
 */

const { db } = require('../db');
const money = require('./money');

const PAYMENT_KINDS = {
  call: { label: 'תשלום בתיאום טלפוני', details: 'נחזור אליכם בטלפון להשלמת התשלום.' },
  bank: { label: 'העברה בנקאית', details: '' },
  bit: { label: 'ביט', details: '' },
  paybox: { label: 'פייבוקס', details: '' },
  cash: { label: 'מזומן במסירה או באיסוף', details: '' },
  link: { label: 'תשלום מאובטח בכרטיס אשראי', details: 'מיד אחרי ההזמנה נעביר אתכם לדף התשלום.' }
};

const DEFAULTS = Object.freeze({
  open: false,
  name: '',
  currency: 'ILS',
  vatRate: 18,
  pricesIncludeVat: true,
  vatExempt: false,
  minOrder: 0,
  lowStock: 3,
  orderStart: 1001,
  requireEmail: false,
  notifyEmail: '',
  customerEmails: true,
  thanks: 'תודה! קיבלנו את ההזמנה ונחזור אליכם בהקדם.',
  terms: '',
  shipping: [
    { id: 'pickup', label: 'איסוף עצמי', price: 0, freeOver: null, address: false, note: '' },
    { id: 'delivery', label: 'משלוח עד הבית', price: 3000, freeOver: null, address: true, note: '' }
  ],
  payments: [
    { id: 'phone', kind: 'call', label: PAYMENT_KINDS.call.label, details: PAYMENT_KINDS.call.details, phone: '', url: '' }
  ],
  pages: { shop: 'shop', cart: 'cart', checkout: 'checkout', order: 'order' }
});

const ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const MAX_METHODS = 10;

function clip(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

function bool(v, fallback) {
  if (v === true || v === 'true' || v === 1 || v === '1' || v === 'on' || v === 'yes') return true;
  if (v === false || v === 'false' || v === 0 || v === '0' || v === 'off' || v === 'no') return false;
  return fallback;
}

/** A price field that may arrive as minor units (number) or as a typed major string. */
function minorOf(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= money.MAX_MINOR) return v;
  const n = money.toMinor(v);
  return Number.isFinite(n) ? n : fallback;
}

function slugId(v, fallback) {
  const s = String(v || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return ID_RE.test(s) ? s : fallback;
}

/** http(s) only — the payment page is somewhere a shopper is SENT, so no other scheme may ride here. */
function safeHttpUrl(v) {
  const s = clip(v, 600).replace(/\s+/g, '');
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}

function normalizeShipping(list, errors) {
  if (!Array.isArray(list)) return DEFAULTS.shipping.map((m) => ({ ...m }));
  const out = [];
  const seen = new Set();
  for (const raw of list.slice(0, MAX_METHODS)) {
    if (!raw || typeof raw !== 'object') continue;
    const label = clip(raw.label, 60);
    if (!label) { errors.push('שיטת משלוח בלי שם — דולגה'); continue; }
    let id = slugId(raw.id, '');
    if (!id) id = 'ship-' + (out.length + 1);
    while (seen.has(id)) id = id + '-' + (out.length + 1);
    seen.add(id);
    const freeOver = minorOf(raw.freeOver, null);
    out.push({
      id,
      label,
      price: minorOf(raw.price, 0),
      freeOver: freeOver === null ? null : freeOver,
      address: bool(raw.address, true),
      note: clip(raw.note, 160)
    });
  }
  return out;
}

function normalizePayments(list, errors) {
  if (!Array.isArray(list)) return DEFAULTS.payments.map((m) => ({ ...m }));
  const out = [];
  const seen = new Set();
  for (const raw of list.slice(0, MAX_METHODS)) {
    if (!raw || typeof raw !== 'object') continue;
    const kind = PAYMENT_KINDS[raw.kind] ? raw.kind : (PAYMENT_KINDS[raw.id] ? raw.id : 'call');
    const url = kind === 'link' ? safeHttpUrl(raw.url) : '';
    if (kind === 'link' && !url) { errors.push('תשלום בקישור בלי כתובת https תקינה — דולג'); continue; }
    let id = slugId(raw.id, kind);
    while (seen.has(id)) id = id + '-' + (out.length + 1);
    seen.add(id);
    out.push({
      id,
      kind,
      label: clip(raw.label, 60) || PAYMENT_KINDS[kind].label,
      details: clip(raw.details, 600),
      phone: clip(raw.phone, 30).replace(/[^\d+\-\s()]/g, ''),
      url
    });
  }
  return out;
}

function normalizePages(p) {
  const base = { ...DEFAULTS.pages };
  if (!p || typeof p !== 'object') return base;
  for (const k of Object.keys(base)) {
    const v = clip(p[k], 120).replace(/^\/+/, '').replace(/\.html$/i, '');
    if (v && !/[\\/:*?"<>|#\s]/.test(v)) base[k] = v;
  }
  return base;
}

/**
 * Clean a whole settings object (or a partial patch merged over `base`).
 * Unknown keys are dropped; every knob is clamped; problems a person can
 * fix are returned as Hebrew sentences, never thrown.
 * @returns {{ settings: object, errors: string[] }}
 */
function normalize(input, base = DEFAULTS) {
  const src = input && typeof input === 'object' ? input : {};
  const b = base || DEFAULTS;
  const errors = [];
  const pick = (k) => (src[k] !== undefined ? src[k] : b[k]);
  const vatRate = Number(pick('vatRate'));
  const lowStock = parseInt(pick('lowStock'), 10);
  const orderStart = parseInt(pick('orderStart'), 10);
  const settings = {
    open: bool(pick('open'), false),
    name: clip(pick('name'), 80),
    currency: money.currencyCode(pick('currency')),
    vatRate: Number.isFinite(vatRate) && vatRate >= 0 && vatRate <= 50 ? Math.round(vatRate * 100) / 100 : 18,
    pricesIncludeVat: bool(pick('pricesIncludeVat'), true),
    vatExempt: bool(pick('vatExempt'), false),
    minOrder: minorOf(pick('minOrder'), 0),
    lowStock: Number.isFinite(lowStock) && lowStock >= 0 && lowStock <= 1000 ? lowStock : 3,
    orderStart: Number.isFinite(orderStart) && orderStart >= 1 && orderStart <= 99999999 ? orderStart : 1001,
    requireEmail: bool(pick('requireEmail'), false),
    notifyEmail: clip(pick('notifyEmail'), 200),
    customerEmails: bool(pick('customerEmails'), true),
    thanks: clip(pick('thanks'), 400) || DEFAULTS.thanks,
    terms: clip(pick('terms'), 120).replace(/^\/+/, '').replace(/\.html$/i, ''),
    shipping: normalizeShipping(pick('shipping'), errors),
    payments: normalizePayments(pick('payments'), errors),
    pages: normalizePages(pick('pages'))
  };
  if (settings.notifyEmail && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(settings.notifyEmail)) {
    errors.push('כתובת המייל להתראות אינה תקינה — נשמרה ריקה');
    settings.notifyEmail = '';
  }
  if (!settings.payments.length) errors.push('אין אף אמצעי תשלום — לקוחות לא יוכלו להשלים הזמנה');
  return { settings, errors };
}

function readRaw() {
  try {
    const row = db.prepare("SELECT value FROM store_meta WHERE key = 'settings'").get();
    return row ? JSON.parse(row.value) : null;
  } catch (e) {
    return null;
  }
}

/** The settings as they are now (defaults for anything never saved). */
function loadSettings() {
  return normalize(readRaw() || {}, DEFAULTS).settings;
}

/**
 * Merge a patch over the current settings and persist.
 * @returns {{ settings: object, errors: string[] }}
 */
function saveSettings(patch) {
  const current = loadSettings();
  const merged = normalize(patch || {}, current);
  db.prepare(`
    INSERT INTO store_meta (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(JSON.stringify(merged.settings));
  return merged;
}

/** Replace the settings wholesale (the <bent-store> apply path). */
function replaceSettings(next) {
  const merged = normalize(next || {}, DEFAULTS);
  db.prepare(`
    INSERT INTO store_meta (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(JSON.stringify(merged.settings));
  return merged;
}

/** The store's display name: its own, else the site's. */
function storeName(settings) {
  const s = settings || loadSettings();
  if (s.name) return s.name;
  try { return require('../config').loadConfig().title || 'החנות'; } catch (e) { return 'החנות'; }
}

module.exports = {
  DEFAULTS,
  PAYMENT_KINDS,
  normalize,
  loadSettings,
  saveSettings,
  replaceSettings,
  storeName,
  safeHttpUrl
};
