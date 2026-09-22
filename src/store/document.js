'use strict';

/**
 * The store ⇄ its BenTML document (src/bentml/store-dialect.js).
 *
 *   exportDocument()        the live store as <bent-store> (⬇ BenTML, the
 *                           site package, the AI writer's "the store today")
 *   planDocument(text)      what applying it WOULD do — added / changed /
 *                           hidden products, settings, coupons — plus the
 *                           refusals and warnings; writes nothing
 *   applyDocument(text)     backup first (the store as it stood, AS a
 *                           <bent-store> document), then one transaction
 *   undoLast()              put the newest backup back
 *
 * Semantics a person can predict:
 *   - a product is matched by its id (the SKU); a new id is a new product;
 *   - with <bent-store> around it the document is the WHOLE catalog: a
 *     product it does not mention is HIDDEN (never deleted — its orders and
 *     page stay), a coupon it does not mention is switched off;
 *   - a fragment (no wrapper, or mode="merge") only adds and updates;
 *   - a section that is absent (no <bent-ship>, no <bent-pay>, no rules)
 *     leaves that part of the store as it is;
 *   - `stock` absent on a product that exists keeps today's stock (a
 *     rewritten catalog must not reset stock that orders have moved);
 *     stock="unlimited" turns counting off.
 */

const { db } = require('../db');
const dialect = require('../bentml/store-dialect');
const money = require('./money');
const settingsMod = require('./settings');
const catalog = require('./catalog');
const coupons = require('./coupons');

const BACKUPS_KEEP = 10;
const UNLIMITED = /^(unlimited|none|∞|-|ללא|אין הגבלה)$/i;

function major(minor) {
  return minor === null || minor === undefined ? '' : money.fromMinor(minor);
}

/** The live store in the document's own (major-unit, string) shape. */
function currentState() {
  const s = settingsMod.loadSettings();
  const shelves = catalog.listShelves().map((sh) => ({ id: sh.slug, label: sh.label }));
  const products = catalog.listProducts({ status: 'all', sort: 'manual' }).map((p) => ({
    id: p.slug,
    title: p.title,
    price: major(p.price),
    was: p.compareAt ? major(p.compareAt) : '',
    stock: p.variants.length || p.stock === null ? '' : String(p.stock),
    shelf: p.shelf,
    status: p.status,
    image: p.images[0] || '',
    images: p.images.slice(1).join(' '),
    badge: p.badge,
    summary: p.summary,
    delivery: p.delivery ? '' : 'false',
    max: p.maxPerOrder ? String(p.maxPerOrder) : '',
    description: p.description,
    variants: p.variants.map((v) => ({
      id: v.code, label: v.label,
      price: v.price === null || v.price === undefined ? '' : major(v.price),
      stock: v.stock === null || v.stock === undefined ? '' : String(v.stock)
    }))
  }));
  return {
    name: s.name,
    currency: s.currency,
    // defaults stay out of the document (a clean page to read and to give an
    // AI); an absent rule leaves the store's own value alone on apply
    rules: {
      vat: String(s.vatRate),
      vatIncluded: s.pricesIncludeVat ? 'true' : 'false',
      vatExempt: s.vatExempt ? 'true' : '',
      minOrder: s.minOrder ? major(s.minOrder) : '',
      lowStock: s.lowStock !== settingsMod.DEFAULTS.lowStock ? String(s.lowStock) : '',
      orderStart: s.orderStart !== settingsMod.DEFAULTS.orderStart ? String(s.orderStart) : '',
      requireEmail: s.requireEmail ? 'true' : '',
      terms: s.terms,
      thanks: s.thanks !== settingsMod.DEFAULTS.thanks ? s.thanks : ''
    },
    shelves,
    products,
    shipping: s.shipping.map((m) => ({
      id: m.id, label: m.label, price: major(m.price),
      freeOver: m.freeOver === null || m.freeOver === undefined ? '' : major(m.freeOver),
      address: m.address ? '' : 'false', note: m.note
    })),
    // a card method carries only what the shopper sees and its installments
    // — the gateway's provider, mode and keys are not part of the store's
    // description (config/payments.json, never a document)
    payments: s.payments.map((m) => ({
      id: m.id, kind: m.kind, label: m.label, phone: m.phone, url: m.url, details: m.details,
      maxPayments: m.kind === 'card' && m.maxPayments > 1 ? String(m.maxPayments) : ''
    })),
    coupons: coupons.listCoupons().map((c) => ({
      code: c.code,
      percent: c.kind === 'percent' ? String(c.value) : '',
      amount: c.kind === 'amount' ? major(c.value) : '',
      freeShipping: c.kind === 'shipping' ? 'true' : '',
      min: c.minSubtotal ? major(c.minSubtotal) : '',
      starts: c.startsOn,
      until: c.endsOn,
      uses: c.maxUses ? String(c.maxUses) : '',
      active: c.active ? '' : 'false',
      note: c.note
    }))
  };
}

function exportDocument() {
  return dialect.serializeStore(currentState());
}

function yes(v, fallback) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'כן') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'לא') return false;
  return fallback;
}

/** A document product → catalog.normalizeProduct input, resolving "absent = keep" against what exists. */
function productInput(p, existing) {
  const stock = p.stock === '' ? (existing ? existing.stock : null) : (UNLIMITED.test(p.stock) ? null : p.stock);
  const images = [p.image].concat(String(p.images || '').split(/\s+/)).filter(Boolean);
  const exVariants = existing ? existing.variants : [];
  return {
    slug: p.id || p.title,
    title: p.title,
    price: p.price,
    compareAt: p.was || null,
    stock: p.variants.length ? null : stock,
    shelf: p.shelf,
    images,
    badge: p.badge,
    status: ['active', 'hidden', 'draft'].includes(p.status) ? p.status : 'active',
    summary: p.summary,
    delivery: yes(p.delivery, true),
    maxPerOrder: p.max || null,
    description: p.description,
    variants: p.variants.map((v) => {
      const had = exVariants.find((x) => x.code === String(v.id || '').toLowerCase());
      const vStock = v.stock === '' ? (had ? had.stock : null) : (UNLIMITED.test(v.stock) ? null : v.stock);
      return { code: v.id, label: v.label, price: v.price === '' ? null : v.price, stock: vStock };
    })
  };
}

function sameProduct(a, b) {
  const pick = (p) => JSON.stringify([p.title, p.summary, p.description, p.price, p.compareAt, p.stock, p.images, p.shelf,
    p.badge, p.status, p.delivery, p.maxPerOrder, (p.variants || []).map((v) => [v.code, v.label, v.price, v.stock])]);
  return pick(a) === pick(b);
}

function changedFields(before, after, cur) {
  const f = [];
  const fmt = (n) => (n === null || n === undefined ? '—' : money.formatMoney(n, cur));
  if (before.title !== after.title) f.push(`שם: ${before.title} → ${after.title}`);
  if (before.price !== after.price) f.push(`מחיר: ${fmt(before.price)} → ${fmt(after.price)}`);
  if ((before.compareAt || null) !== (after.compareAt || null)) f.push(`מחיר לפני: ${fmt(before.compareAt)} → ${fmt(after.compareAt)}`);
  if (before.stock !== after.stock) f.push(`מלאי: ${before.stock === null ? 'ללא מעקב' : before.stock} → ${after.stock === null ? 'ללא מעקב' : after.stock}`);
  if (before.status !== after.status) f.push(`סטטוס: ${catalog.STATUS_LABELS[before.status]} → ${catalog.STATUS_LABELS[after.status]}`);
  if (before.shelf !== after.shelf) f.push(`מדף: ${before.shelf || '—'} → ${after.shelf || '—'}`);
  if (JSON.stringify(before.images) !== JSON.stringify(after.images)) f.push('תמונות');
  if (before.description !== after.description || before.summary !== after.summary) f.push('תיאור');
  if (JSON.stringify((before.variants || []).map((v) => [v.code, v.label, v.price, v.stock])) !==
      JSON.stringify((after.variants || []).map((v) => [v.code, v.label, v.price, v.stock]))) f.push('אפשרויות');
  if (before.badge !== after.badge) f.push('תווית');
  return f;
}

/**
 * What applying `text` would do. Writes nothing.
 * @returns {{ ok:boolean, errors:object[], warnings:object[], hard:boolean, notes:object[], preview:object, plan:object|null }}
 */
function planDocument(text) {
  const parsed = dialect.parseStoreDoc(text);
  if (!parsed.doc) return { ok: false, errors: parsed.errors, warnings: [], hard: true, notes: parsed.notes, preview: null, plan: null };
  const doc = parsed.doc;
  const current = settingsMod.loadSettings();
  const cur = doc.currency ? money.currencyCode(doc.currency) : current.currency;
  const warnings = [];
  const errors = [];
  const hardWarn = (code, message) => warnings.push({ code, message, hard: true });
  const softWarn = (code, message) => warnings.push({ code, message, hard: false });
  for (const n of parsed.notes) softWarn(n.code, n.message);
  if (doc.currency && money.currencyCode(doc.currency) !== doc.currency) softWarn('CURRENCY', `מטבע "${doc.currency}" אינו מוכר — נשאר ${cur}`);

  // products
  const seen = new Set();
  const products = [];
  const preview = { added: [], changed: [], hidden: [], unchanged: 0, invalid: [], shelvesAdded: [], coupons: { added: [], changed: [], off: [] }, settings: [] };
  for (const p of doc.products) {
    const idGuess = catalog.isSlug(String(p.id || '').toLowerCase()) ? String(p.id).toLowerCase() : catalog.slugify(p.id || p.title);
    const existing = idGuess ? catalog.getProduct(idGuess) : null;
    const n = catalog.normalizeProduct(productInput(p, existing));
    if (n.errors.length) {
      preview.invalid.push({ id: p.id || '', title: p.title || '', errors: n.errors });
      hardWarn('PRODUCT_INVALID', `המוצר "${p.title || p.id || '?'}" לא ייקלט: ${n.errors.join(' · ')}`);
      continue;
    }
    for (const w of n.warnings) softWarn('PRODUCT_FIXED', w);
    if (seen.has(n.product.slug)) { softWarn('DUPLICATE_SKU', `המזהה "${n.product.slug}" מופיע פעמיים — נקלט הראשון`); continue; }
    seen.add(n.product.slug);
    const next = { ...n.product, variants: n.variants };
    if (next.price === 0) softWarn('PRICE_ZERO', `המחיר של "${next.title}" הוא 0 — בכוונה?`);
    const ex = catalog.getProduct(next.slug);
    if (!ex) preview.added.push({ id: next.slug, title: next.title, priceText: money.formatMoney(next.price, cur) });
    else if (!sameProduct(ex, next)) preview.changed.push({ id: next.slug, title: next.title, fields: changedFields(ex, next, cur) });
    else preview.unchanged++;
    products.push(next);
  }
  if (!products.length && doc.products.length) errors.push({ code: 'NO_VALID_PRODUCTS', message: 'אף מוצר במסמך אינו תקין — שום דבר לא נשמר' });

  // what a whole-catalog document takes off the shelf
  const activeNow = catalog.listProducts({ status: 'active' });
  if (doc.mode === 'replace') {
    for (const ex of activeNow) {
      if (!seen.has(ex.slug)) preview.hidden.push({ id: ex.slug, title: ex.title });
    }
    if (!products.length && activeNow.length) hardWarn('EMPTY_STORE', 'במסמך אין אף מוצר — כל המוצרים באתר יוסתרו');
    else if (activeNow.length >= 4 && preview.hidden.length > activeNow.length / 2) {
      hardWarn('MANY_HIDDEN', `${preview.hidden.length} מתוך ${activeNow.length} המוצרים הפעילים יוסתרו — המסמך לא הזכיר אותם`);
    }
  }

  // shelves
  const shelves = [];
  for (const sh of doc.shelves) {
    const slug = catalog.isSlug(String(sh.id || '').toLowerCase()) ? String(sh.id).toLowerCase() : catalog.slugify(sh.id || sh.label);
    if (!slug || !sh.label) { softWarn('SHELF_INVALID', `מדף בלי מזהה או שם דולג`); continue; }
    if (!catalog.getShelf(slug)) preview.shelvesAdded.push(sh.label);
    shelves.push({ slug, label: sh.label.slice(0, 60) });
  }
  const known = new Set(shelves.map((s) => s.slug).concat(catalog.listShelves().map((s) => s.slug)));
  for (const p of products) {
    if (p.shelf && !known.has(p.shelf)) {
      softWarn('SHELF_CREATED', `המדף "${p.shelf}" לא הוגדר — ייווצר אוטומטית`);
      known.add(p.shelf);
    }
  }

  // settings sections (absent → untouched)
  const patch = {};
  if (doc.name && doc.name !== current.name) { patch.name = doc.name; preview.settings.push('שם החנות: ' + doc.name); }
  if (doc.currency && money.currencyCode(doc.currency) === doc.currency && doc.currency !== current.currency) {
    patch.currency = doc.currency;
    preview.settings.push('מטבע: ' + current.currency + ' → ' + doc.currency);
    if (db.prepare('SELECT COUNT(*) AS n FROM store_orders').get().n) hardWarn('CURRENCY_CHANGE', 'החלפת מטבע בחנות שכבר יש בה הזמנות — ההזמנות הקיימות נשארות במטבע שבו בוצעו');
  }
  if (doc.rules) {
    const r = doc.rules;
    const map = {
      vat: ['vatRate', (v) => Number(v)], 'vat-included': ['pricesIncludeVat', (v) => yes(v, true)],
      'vat-exempt': ['vatExempt', (v) => yes(v, false)], 'min-order': ['minOrder', (v) => money.toMinor(v)],
      'low-stock': ['lowStock', (v) => parseInt(v, 10)], 'order-start': ['orderStart', (v) => parseInt(v, 10)],
      'require-email': ['requireEmail', (v) => yes(v, false)], terms: ['terms', (v) => v], thanks: ['thanks', (v) => v]
    };
    for (const [k, [key, conv]] of Object.entries(map)) {
      if (r[k] === undefined || r[k] === '') continue;
      const v = conv(r[k]);
      if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) { softWarn('RULE_INVALID', `ערך לא תקין: ${k}="${r[k]}"`); continue; }
      if (JSON.stringify(v) !== JSON.stringify(current[key])) { patch[key] = v; preview.settings.push(k + ': ' + r[k]); }
    }
  }
  if (doc.shipping) {
    patch.shipping = doc.shipping.map((m) => ({
      id: m.id, label: m.label, price: m.price, freeOver: m.freeOver || null, address: yes(m.address, true), note: m.note
    }));
  }
  if (doc.payments) {
    patch.payments = doc.payments.map((m) => ({ id: m.id, kind: m.kind || m.id, label: m.label, details: m.details, phone: m.phone, url: m.url, maxPayments: m.maxPayments }));
    // a card method is accepted whether or not a gateway is connected — it
    // just stays off the checkout until one is (chat and paste both learn why)
    const wantsCard = doc.payments.some((m) => (m.kind || m.id) === 'card');
    let gatewayReady = false;
    try { gatewayReady = require('./gateway').isReady(current); } catch (e) { gatewayReady = false; }
    if (wantsCard && !gatewayReady) softWarn('CARD_NOT_CONNECTED', 'אמצעי התשלום "כרטיס אשראי" יופיע בקופה אחרי חיבור חברת סליקה (חנות → סליקת אשראי)');
  }
  const check = settingsMod.normalize(patch, current);
  for (const e of check.errors) hardWarn('SETTINGS', e);
  // a section that says what the store already has is not a change — only
  // a real difference reaches the preview (and the write)
  for (const [key, label] of [['shipping', 'שיטות משלוח'], ['payments', 'אמצעי תשלום']]) {
    if (!patch[key]) continue;
    if (JSON.stringify(check.settings[key]) === JSON.stringify(current[key])) { delete patch[key]; continue; }
    preview.settings.push(label + ': ' + check.settings[key].map((m) => m.label).join(', '));
  }

  // coupons
  const couponList = [];
  if (doc.coupons) {
    for (const c of doc.coupons) {
      const kind = c.percent ? 'percent' : c.amount ? 'amount' : yes(c.freeShipping, false) ? 'shipping' : null;
      const n = coupons.normalizeCoupon({
        code: c.code, kind, value: kind === 'percent' ? c.percent : kind === 'amount' ? c.amount : 0,
        minSubtotal: c.min || 0, startsOn: c.starts, endsOn: c.until, maxUses: c.uses || null,
        active: yes(c.active, true), note: c.note
      });
      if (n.errors.length) { hardWarn('COUPON_INVALID', `הקופון "${c.code || '?'}" לא ייקלט: ${n.errors.join(' · ')}`); continue; }
      const ex = coupons.getCoupon(n.coupon.code);
      if (!ex) preview.coupons.added.push(n.coupon.code);
      else if (ex.kind !== n.coupon.kind || ex.value !== n.coupon.value || ex.active !== n.coupon.active || ex.endsOn !== n.coupon.endsOn) preview.coupons.changed.push(n.coupon.code);
      couponList.push(n.coupon);
    }
    if (doc.mode === 'replace') {
      const named = new Set(couponList.map((c) => c.code));
      for (const ex of coupons.listCoupons()) if (ex.active && !named.has(ex.code)) preview.coupons.off.push(ex.code);
    }
  }

  const hard = errors.length > 0 || warnings.some((w) => w.hard);
  preview.mode = doc.mode;
  preview.name = doc.name || current.name;
  preview.count = products.length;
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    hard,
    notes: parsed.notes,
    preview,
    plan: errors.length ? null : { mode: doc.mode, products, shelves, patch, coupons: doc.coupons ? couponList : null }
  };
}

// ── backups ────────────────────────────────────────────────────────────

function backup(reason) {
  const info = db.prepare('INSERT INTO store_backups (reason, source) VALUES (?, ?)').run(String(reason || '').slice(0, 80), exportDocument());
  const keep = db.prepare('SELECT id FROM store_backups ORDER BY id DESC LIMIT ?').all(BACKUPS_KEEP).map((r) => r.id);
  if (keep.length) db.prepare(`DELETE FROM store_backups WHERE id NOT IN (${keep.map(() => '?').join(',')})`).run(...keep);
  return Number(info.lastInsertRowid);
}

function listBackups() {
  return db.prepare('SELECT id, reason, created_at, length(source) AS size FROM store_backups ORDER BY id DESC').all();
}

function getBackup(id) {
  return db.prepare('SELECT * FROM store_backups WHERE id = ?').get(Number(id)) || null;
}

// ── apply ──────────────────────────────────────────────────────────────

/**
 * Apply a document. Refusals write nothing; hard warnings need force.
 * @returns {{ ok:boolean, code?:string, message?:string, backupId?:number, preview?:object, warnings?:object[], changed?:object }}
 */
function applyDocument(text, opts = {}) {
  const planned = planDocument(text);
  // the plan first, the verdict after it: `ok` must be THIS answer's, never the plan's
  if (!planned.ok) return { ...planned, ok: false, code: planned.errors[0] ? planned.errors[0].code : 'INVALID', message: planned.errors.map((e) => e.message).join(' · ') };
  if (planned.hard && !opts.force) {
    return { ...planned, ok: false, code: 'NEEDS_CONFIRM', message: 'יש אזהרות שדורשות אישור' };
  }
  const { plan } = planned;
  const backupId = backup(opts.reason || 'apply');
  const touched = [];
  db.transaction(() => {
    for (const sh of plan.shelves) {
      db.prepare(`INSERT INTO store_shelves (slug, label, sort) VALUES (?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET label = excluded.label`).run(sh.slug, sh.label, 0);
    }
    plan.products.forEach((p, i) => {
      catalog.ensureShelf(p.shelf);
      const ex = catalog.getProduct(p.slug);
      if (ex) {
        db.prepare(`
          UPDATE store_products SET title = ?, summary = ?, description = ?, price = ?, compare_at = ?, stock = ?,
            images = ?, shelf = ?, badge = ?, status = ?, delivery = ?, max_per_order = ?, sort = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(p.title, p.summary, p.description, p.price, p.compareAt, p.stock, JSON.stringify(p.images), p.shelf, p.badge,
          p.status, p.delivery ? 1 : 0, p.maxPerOrder, i, ex.id);
        catalog.writeVariants(ex.id, p.variants);
      } else {
        const r = db.prepare(`
          INSERT INTO store_products (slug, title, summary, description, price, compare_at, stock, images, shelf, badge, status, delivery, max_per_order, sort)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(p.slug, p.title, p.summary, p.description, p.price, p.compareAt, p.stock, JSON.stringify(p.images), p.shelf,
          p.badge, p.status, p.delivery ? 1 : 0, p.maxPerOrder, i);
        catalog.writeVariants(Number(r.lastInsertRowid), p.variants);
      }
      touched.push(p.slug);
    });
    if (plan.mode === 'replace') {
      for (const h of planned.preview.hidden) {
        db.prepare("UPDATE store_products SET status = 'hidden', updated_at = CURRENT_TIMESTAMP WHERE slug = ? AND status = 'active'").run(h.id);
      }
    }
    if (Object.keys(plan.patch).length) settingsMod.saveSettings(plan.patch);
    if (plan.coupons) {
      for (const c of plan.coupons) coupons.saveCoupon(c);
      if (plan.mode === 'replace') {
        for (const code of planned.preview.coupons.off) db.prepare('UPDATE store_coupons SET active = 0 WHERE code = ?').run(code);
      }
    }
  })();

  // the storefront follows: product pages, then one site rebuild
  let rebuilt = false;
  try {
    const store = require('./index');
    if (store.isOpen()) store.pages.syncAllProductPages();
    rebuilt = store.refreshNow();
  } catch (e) {
    console.error('[store] after-apply sync failed:', e.message);
  }
  return { ok: true, backupId, preview: planned.preview, warnings: planned.warnings, changed: { products: touched.length }, rebuilt };
}

/** Put the newest backup back (itself backed up first, so an undo can be undone). */
function undoLast() {
  const last = db.prepare('SELECT * FROM store_backups ORDER BY id DESC LIMIT 1').get();
  if (!last) return { ok: false, code: 'NO_BACKUP', message: 'אין גיבוי לשחזור' };
  const r = applyDocument(last.source, { force: true, reason: 'undo:' + last.id });
  if (r.ok) db.prepare('DELETE FROM store_backups WHERE id = ?').run(last.id);
  return { ...r, restored: last.id };
}

function restoreBackup(id) {
  const b = getBackup(id);
  if (!b) return { ok: false, code: 'NO_BACKUP', message: 'הגיבוי לא נמצא' };
  return { ...applyDocument(b.source, { force: true, reason: 'restore:' + b.id }), restored: b.id };
}

module.exports = {
  currentState,
  exportDocument,
  planDocument,
  applyDocument,
  undoLast,
  restoreBackup,
  listBackups,
  getBackup,
  backup
};
