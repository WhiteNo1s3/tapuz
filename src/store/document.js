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
 *   - a fragment (no wrapper, or mode="merge") only adds and updates — and
 *     on a product (or a shelf) that exists, an attribute the tag does not
 *     carry keeps its value: `<bent-sku id="x" price="59"/>` changes one
 *     price. An attribute that IS there and empty clears the field; the
 *     options it names are added or changed, the others stay;
 *   - a section that is absent (no <bent-ship>, no <bent-pay>, no rules)
 *     leaves that part of the store as it is;
 *   - `stock` absent on a product that exists keeps today's stock (a
 *     rewritten catalog must not reset stock that orders have moved);
 *     stock="unlimited" turns counting off;
 *   - shelves and products keep the document's order (a merge appends what
 *     is new and leaves the order of what exists alone);
 *   - a root that says keep="description,summary" was written from a view
 *     that did not show those: on what already exists they stay as they
 *     are unless the tag carries them, in either mode;
 *   - an apply that would leave more than two existing products without
 *     the description, summary or pictures they have asks first (BLANKED).
 *
 * The store's own export always comes back whole: it is read with
 * `{ trusted: true }` (no size ceilings on words the store wrote itself),
 * and a backup is checked — parsed, product for product — before the apply
 * it protects is allowed to start.
 *
 * `cost` (what a product costs the OWNER) is not part of the document: it is
 * never written to one and never read from one, so an apply and a
 * site-package import leave every product's cost exactly as it was.
 *
 * A BACKUP is the one place that must remember it anyway — an undo that
 * brings a deleted product back without its cost, or leaves an imported
 * cost standing, has not undone. So a backup keeps `{ sku: cost }` in its
 * own column, beside the document and never inside it, and undoLast() /
 * restoreBackup() hand that back to the catalog after the document landed.
 * The download of a backup (.bent) is the document alone.
 *
 * And a backup must say what the document leaves UNSAID. The export keeps
 * a rule at its default out of the page, and writes no section for a list
 * with nothing in it — and to an apply, absent means "leave it". So an undo
 * that only applied the document left a minimum order, a VAT exemption, a
 * terms page or a first coupon exactly as the undone document had set them.
 * A backup therefore also keeps, in its `state` column and in the settings'
 * own shape, every rule with its value (defaults included), the store's
 * name and currency, the shipping and payment lists as they stood (an empty
 * one is an empty one), and every coupon's code with whether it was on.
 * undoLast() / restoreBackup() put exactly that back, inside the apply's own
 * transaction: a rule returns to its default, `terms` clears, a list empties,
 * a coupon that did not exist is switched off. The exported document is not
 * touched by any of this — it is the file people download and share.
 *
 * NOT in a backup, and never moved by one: whether the store is open, the
 * gateway's and PayPal's keys (config/payments.json), `demoPayments`,
 * `holdHours`, the owner's mail settings and which pages are the store.
 * None of them is the document's to say, so no apply could have changed
 * them and no undo has anything to put back.
 */

const { db } = require('../db');
const dialect = require('../bentml/store-dialect');
const money = require('./money');
const settingsMod = require('./settings');
const catalog = require('./catalog');
const coupons = require('./coupons');

const BACKUPS_KEEP = 10;
// how many existing products one apply may leave without their description,
// summary or pictures before it asks (see BLANKED in planDocument)
const BLANKED_MAX = 2;
const UNLIMITED = /^(unlimited|none|∞|-|ללא|אין הגבלה)$/i;
// "everything": the export, the plan and the backup read the whole catalog,
// never the list screens' first 500
const EVERYTHING = 100000;

function major(minor) {
  return minor === null || minor === undefined ? '' : money.fromMinor(minor);
}

/** The live store in the document's own (major-unit, string) shape. */
function currentState() {
  const s = settingsMod.loadSettings();
  const shelves = catalog.listShelves().map((sh) => ({
    id: sh.slug, label: sh.label, parent: sh.parent, image: sh.image, summary: sh.summary,
    hidden: sh.hidden ? 'true' : '', seoTitle: sh.seoTitle, seoDescription: sh.seoDescription
  }));
  const products = catalog.listProducts({ status: 'all', sort: 'manual', limit: EVERYTHING }).map((p) => ({
    id: p.slug,
    title: p.title,
    price: major(p.price),
    was: p.compareAt ? major(p.compareAt) : '',
    // "not counted" is written out: absent means "keep", so a backup that
    // left it out could never put "not counted" back over a number
    stock: p.variants.length ? '' : (p.stock === null || p.stock === undefined ? 'unlimited' : String(p.stock)),
    shelf: p.shelf,
    status: p.status,
    brand: p.brand,
    tags: p.tags.join(', '),
    featured: p.featured ? 'true' : '',
    barcode: p.barcode,
    weight: p.weight === null || p.weight === undefined ? '' : String(p.weight),
    image: p.images[0] || '',
    images: p.images.slice(1).join(' '),
    badge: p.badge,
    summary: p.summary,
    delivery: p.delivery ? '' : 'false',
    max: p.maxPerOrder ? String(p.maxPerOrder) : '',
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    description: p.description,
    variants: p.variants.map((v) => ({
      id: v.code, label: v.label,
      price: v.price === null || v.price === undefined ? '' : major(v.price),
      stock: v.stock === null || v.stock === undefined ? 'unlimited' : String(v.stock)
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

/** Grams as a document writes them: "320", "320g", "1.2kg" → a whole number of grams (anything else goes on as typed, to be refused by name). */
function grams(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  const kg = /^(\d+(?:\.\d+)?)\s*(?:kg|ק"ג|ק״ג|קג)$/.exec(s);
  if (kg) return Math.round(parseFloat(kg[1]) * 1000);
  const g = /^(\d+)\s*(?:g|gr|גרם|ג'|ג׳)$/.exec(s);
  return g ? g[1] : s;
}

/** The code the catalog gives an option tag: its id, else what its label makes (normalizeProduct derives it the same way). */
function optionCode(v) {
  const code = String(v.id || '').trim().slice(0, 40).toLowerCase();
  return catalog.isSlug(code) ? code : catalog.slugify(code || v.label);
}

/**
 * A document product → catalog.normalizeProduct input, resolving "absent =
 * keep" against what exists.
 *
 * `stock` absent keeps in BOTH modes. In a MERGE document every other
 * attribute the tag does not carry keeps too (the parser recorded which it
 * carried — see store-dialect.js). In a whole-catalog document an absent
 * attribute still means "clear it": the document is the whole truth there —
 * except the attributes its root lists in keep="…" (`keep`, a Set of
 * attribute names): a document written from a view that did not show them
 * cannot be the truth about them. `description` is the body: an empty body
 * with no description="" beside it is "not carried".
 *
 * Options follow the same promise. A merge only adds and updates: the
 * options a tag names are added or changed, and the ones it does NOT name
 * stay exactly as they are, after the named ones (naming one size out of
 * three used to delete the other two and their stock). In a whole-catalog
 * document the tag's list is the whole list.
 *
 * Two things a typo must never do, said through `say(code, message)`:
 *   - a stock nobody can read as a whole number ("1O", "3 units") on a
 *     product or an option that EXISTS is treated as absent — the store's
 *     number stays. Read as "not counted" it switched counting off, and the
 *     product could be sold without end;
 *   - a status nobody knows keeps the status the product has (a draft stays
 *     a draft); on a new product it is a draft, never "active".
 */
function productInput(p, existing, mode, keep, say) {
  const note = typeof say === 'function' ? say : () => {};
  // a tag built by hand, with no record of what it carried, says everything it has
  const said = (k) => !(p.__has instanceof Set) || p.__has.has(k);
  const kept = (k) => !!existing && !said(k) && (mode === 'merge' || (keep instanceof Set && keep.has(k)));
  const name = existing ? existing.title : (p.title || p.id || '?');
  const unreadable = (v) => v !== '' && !UNLIMITED.test(v) && !catalog.isWhole(v);
  const first = kept('image') ? existing.images[0] : p.image;
  const rest = kept('images') ? existing.images.slice(1) : String(p.images || '').split(/\s+/);

  const exVariants = existing ? existing.variants : [];
  const merging = mode === 'merge' && !!existing;
  const hadOption = (v) => exVariants.find((x) => x.code === optionCode(v));
  let tags = p.variants;
  if (merging && tags.length) {
    // the catalog holds MAX_VARIANTS options: when a product is full, what is NEW gives way — never an option it has
    let room = catalog.MAX_VARIANTS - exVariants.length;
    tags = tags.filter((v) => hadOption(v) || room-- > 0);
    if (tags.length < p.variants.length) {
      note('OPTIONS_FULL', `למוצר "${name}" יש מקום ל-${catalog.MAX_VARIANTS} אפשרויות — ${p.variants.length - tags.length} אפשרויות חדשות לא נקלטו`);
    }
  }
  let variants = tags.map((v) => {
    const had = hadOption(v);
    const vSaid = (k) => !(v.__has instanceof Set) || v.__has.has(k);
    const vKept = (k) => mode === 'merge' && !!had && !vSaid(k);
    const vTypo = !!had && unreadable(v.stock);
    if (vTypo) note('STOCK_UNREADABLE', `המלאי של האפשרות "${had.label}" של "${name}" אינו מספר שלם (${String(v.stock).slice(0, 20)}) — נשאר כפי שהוא`);
    const vStock = v.stock === '' || vTypo ? (had ? had.stock : null) : (UNLIMITED.test(v.stock) ? null : v.stock);
    return {
      code: v.id,
      label: vKept('label') ? had.label : v.label,
      price: vKept('price') ? had.price : (v.price === '' ? null : v.price),
      stock: vStock
    };
  });
  if (merging) {
    const named = new Set(tags.map(optionCode));
    variants = variants.concat(exVariants.filter((x) => !named.has(x.code)));
  }

  // with options the count is per option — the product's own number is not read
  const typo = !!existing && !variants.length && unreadable(p.stock);
  if (typo) note('STOCK_UNREADABLE', `המלאי של "${name}" אינו מספר שלם (${String(p.stock).slice(0, 20)}) — נשאר כפי שהוא`);
  const stock = p.stock === '' || typo ? (existing ? existing.stock : null) : (UNLIMITED.test(p.stock) ? null : p.stock);

  let status = 'active';
  if (kept('status')) status = existing.status;
  else if (p.status) {
    status = catalog.statusOf(p.status);
    if (!status) {
      status = existing ? existing.status : 'draft';
      note('STATUS_UNKNOWN', `סטטוס לא מוכר ("${String(p.status).slice(0, 20)}") למוצר "${name}" — ${existing ? 'נשאר כפי שהוא' : 'נקלט כטיוטה'}`);
    }
  }
  return {
    slug: p.id || p.title,
    title: kept('title') ? existing.title : p.title,
    price: kept('price') ? existing.price : p.price,
    compareAt: kept('was') ? existing.compareAt : (p.was || null),
    stock: variants.length ? null : stock,
    shelf: kept('shelf') ? existing.shelf : p.shelf,
    images: [first].concat(rest).filter(Boolean),
    badge: kept('badge') ? existing.badge : p.badge,
    status,
    summary: kept('summary') ? existing.summary : p.summary,
    delivery: kept('delivery') ? existing.delivery : yes(p.delivery, true),
    maxPerOrder: kept('max') ? existing.maxPerOrder : (p.max || null),
    description: kept('description') ? existing.description : p.description,
    brand: kept('brand') ? existing.brand : p.brand,
    tags: kept('tags') ? existing.tags : p.tags,
    featured: kept('featured') ? existing.featured : yes(p.featured, false),
    barcode: kept('barcode') ? existing.barcode : p.barcode,
    weight: kept('weight') ? existing.weight : grams(p.weight),
    seoTitle: kept('seo-title') ? existing.seoTitle : p.seoTitle,
    seoDescription: kept('seo-description') ? existing.seoDescription : p.seoDescription,
    variants
  };
}

const variantKey = (p) => (p.variants || []).map((v) => [v.code, v.label, v.price, v.stock]);

// `cost` is not compared: the document cannot say it, so it can never be
// what changed. `sort` is not either — order is the document's position.
function sameProduct(a, b) {
  const pick = (p) => JSON.stringify([p.title, p.summary, p.description, p.price, p.compareAt, p.stock, p.images, p.shelf,
    p.badge, p.status, p.delivery, p.maxPerOrder, p.brand || '', p.tags || [], !!p.featured, p.barcode || '',
    p.weight === undefined ? null : p.weight, p.seoTitle || '', p.seoDescription || '', variantKey(p)]);
  return pick(a) === pick(b);
}

function changedFields(before, after, cur) {
  const f = [];
  const fmt = (n) => (n === null || n === undefined ? '—' : money.formatMoney(n, cur));
  const none = (v) => v === null || v === undefined;
  if (before.title !== after.title) f.push(`שם: ${before.title} → ${after.title}`);
  if (before.price !== after.price) f.push(`מחיר: ${fmt(before.price)} → ${fmt(after.price)}`);
  if ((before.compareAt || null) !== (after.compareAt || null)) f.push(`מחיר לפני: ${fmt(before.compareAt)} → ${fmt(after.compareAt)}`);
  if (before.stock !== after.stock) f.push(`מלאי: ${before.stock === null ? 'ללא מעקב' : before.stock} → ${after.stock === null ? 'ללא מעקב' : after.stock}`);
  if (before.status !== after.status) f.push(`סטטוס: ${catalog.STATUS_LABELS[before.status]} → ${catalog.STATUS_LABELS[after.status]}`);
  if (before.shelf !== after.shelf) f.push(`קטגוריה: ${before.shelf || '—'} → ${after.shelf || '—'}`);
  if (JSON.stringify(before.images) !== JSON.stringify(after.images)) f.push('תמונות');
  if (before.description !== after.description || before.summary !== after.summary) f.push('תיאור');
  if (JSON.stringify(variantKey(before)) !== JSON.stringify(variantKey(after))) f.push('אפשרויות');
  if (before.badge !== after.badge) f.push('תווית');
  if ((before.brand || '') !== (after.brand || '')) f.push(`מותג: ${before.brand || '—'} → ${after.brand || '—'}`);
  if (JSON.stringify(before.tags || []) !== JSON.stringify(after.tags || [])) f.push('תגיות');
  if (!!before.featured !== !!after.featured) f.push(after.featured ? 'מומלץ: כן' : 'מומלץ: לא');
  if ((before.barcode || '') !== (after.barcode || '')) f.push('ברקוד');
  if ((none(before.weight) ? null : before.weight) !== (none(after.weight) ? null : after.weight)) {
    f.push(`משקל: ${none(before.weight) ? '—' : before.weight + ' ג׳'} → ${none(after.weight) ? '—' : after.weight + ' ג׳'}`);
  }
  // a side that carries no `cost` (every product read from a document) has nothing to compare
  if (before.cost !== undefined && after.cost !== undefined && before.cost !== after.cost) f.push(`מחיר עלות: ${fmt(before.cost)} → ${fmt(after.cost)}`);
  if ((before.seoTitle || '') !== (after.seoTitle || '') || (before.seoDescription || '') !== (after.seoDescription || '')) f.push('SEO');
  if (!!before.delivery !== !!after.delivery) f.push('משלוח');
  if ((before.maxPerOrder || null) !== (after.maxPerOrder || null)) f.push('מקסימום להזמנה');
  return f;
}

/**
 * What applying `text` would do. Writes nothing.
 * `{ trusted: true }` — the text is the store's own (a backup, its export,
 * a document the CSV import built): read without the paste ceilings.
 * @returns {{ ok:boolean, errors:object[], warnings:object[], hard:boolean, notes:object[], preview:object, plan:object|null }}
 */
function planDocument(text, opts = {}) {
  const parsed = dialect.parseStoreDoc(text, { trusted: !!(opts && opts.trusted) });
  if (!parsed.doc) return { ok: false, errors: parsed.errors, warnings: [], hard: true, notes: parsed.notes, preview: null, plan: null };
  const doc = parsed.doc;
  const current = settingsMod.loadSettings();
  const cur = doc.currency ? money.currencyCode(doc.currency) : current.currency;
  const warnings = [];
  const errors = [];
  const hardWarn = (code, message) => warnings.push({ code, message, hard: true });
  const softWarn = (code, message) => warnings.push({ code, message, hard: false });
  for (const n of parsed.notes) {
    // one of the store's tags that could not be read, in a document that is
    // the WHOLE catalog, is a product about to be hidden unread — that
    // takes a person's yes
    if (n.code === 'TAG_SKIPPED' && doc.mode === 'replace') hardWarn(n.code, n.message);
    else softWarn(n.code, n.message);
  }
  if (doc.currency && money.currencyCode(doc.currency) !== doc.currency) softWarn('CURRENCY', `מטבע "${doc.currency}" אינו מוכר — נשאר ${cur}`);

  // products
  const keep = new Set(doc.keep || []);
  const seen = new Set();
  const blanked = [];
  const products = [];
  const preview = {
    added: [], changed: [], hidden: [], unchanged: 0, invalid: [], shelvesAdded: [], shelvesChanged: [],
    coupons: { added: [], changed: [], off: [] }, settings: []
  };
  for (const p of doc.products) {
    const idGuess = catalog.isSlug(String(p.id || '').toLowerCase()) ? String(p.id).toLowerCase() : catalog.slugify(p.id || p.title);
    // by SKU and nothing else: an id of digits ("1001") must never be read
    // as the database row #1001 and overwrite whatever product sits there
    const existing = idGuess ? catalog.getProductBySlug(idGuess) : null;
    const held = [];
    const n = catalog.normalizeProduct(productInput(p, existing, doc.mode, keep, (code, message) => held.push([code, message])));
    if (n.errors.length) {
      preview.invalid.push({ id: p.id || '', title: p.title || '', errors: n.errors });
      hardWarn('PRODUCT_INVALID', `המוצר "${p.title || p.id || '?'}" לא ייקלט: ${n.errors.join(' · ')}`);
      continue;
    }
    // what the reading held back (a stock or a status nobody could read stays as it is) is said, softly
    for (const [code, message] of held) softWarn(code, message);
    for (const w of n.warnings) softWarn('PRODUCT_FIXED', w);
    if (seen.has(n.product.slug)) { softWarn('DUPLICATE_SKU', `המזהה "${n.product.slug}" מופיע פעמיים — נקלט הראשון`); continue; }
    seen.add(n.product.slug);
    const next = { ...n.product, variants: n.variants };
    // the owner's cost is not the document's to say — the plan carries none
    delete next.cost;
    if (next.price === 0) softWarn('PRICE_ZERO', `המחיר של "${next.title}" הוא 0 — בכוונה?`);
    const ex = catalog.getProductBySlug(next.slug);
    if (!ex) preview.added.push({ id: next.slug, title: next.title, priceText: money.formatMoney(next.price, cur) });
    else if (!sameProduct(ex, next)) preview.changed.push({ id: next.slug, title: next.title, fields: changedFields(ex, next, cur) });
    else preview.unchanged++;
    if (ex && ((ex.description && !next.description) || (ex.summary && !next.summary) || (ex.images.length && !next.images.length))) blanked.push(next.title);
    products.push(next);
  }
  if (!products.length && doc.products.length) errors.push({ code: 'NO_VALID_PRODUCTS', message: 'אף מוצר במסמך אינו תקין — שום דבר לא נשמר' });
  // One product that loses its description is an edit. Several at once is a
  // catalog that came back thinner than it went out — an AI that was shown
  // the store without its descriptions and echoed what it saw — and words
  // nobody can retype are about to go. That takes a person's yes, in either mode.
  if (blanked.length > BLANKED_MAX) {
    hardWarn('BLANKED', `${blanked.length} מוצרים יישארו בלי התיאור, התקציר או התמונות שיש להם היום (${blanked.slice(0, 3).join(', ')}${blanked.length > 3 ? '…' : ''}) — המסמך לא כולל אותם. אם זו לא הכוונה, אל תחילו`);
  }

  // what a whole-catalog document takes off the shelf
  const activeNow = catalog.listProducts({ status: 'active', limit: EVERYTHING });
  if (doc.mode === 'replace') {
    for (const ex of activeNow) {
      if (!seen.has(ex.slug)) preview.hidden.push({ id: ex.slug, title: ex.title });
    }
    if (!products.length && activeNow.length) hardWarn('EMPTY_STORE', 'במסמך אין אף מוצר — כל המוצרים באתר יוסתרו');
    else if (activeNow.length >= 4 && preview.hidden.length > activeNow.length / 2) {
      hardWarn('MANY_HIDDEN', `${preview.hidden.length} מתוך ${activeNow.length} המוצרים הפעילים יוסתרו — המסמך לא הזכיר אותם`);
    } else if (keep.size && preview.hidden.length) {
      // a root that says keep="…" was written from a view that did not show
      // everything — it cannot be the word on which products exist, so even
      // one product it would hide takes a yes
      hardWarn('MANY_HIDDEN', `${preview.hidden.length} מוצרים פעילים יוסתרו — המסמך נכתב מתצוגה חלקית של החנות (keep) ולא הזכיר אותם`);
    }
  }

  // shelves (the store's categories) — every field, and the document's order
  const storeShelves = catalog.listShelves();
  const inStore = new Map(storeShelves.map((s) => [s.slug, s]));
  const shelves = [];
  const planned = new Map();
  const slugOf = (v) => {
    const s = String(v || '').trim().toLowerCase();
    return catalog.isSlug(s) ? s : catalog.slugify(s);
  };
  for (const sh of doc.shelves) {
    const slug = catalog.isSlug(String(sh.id || '').toLowerCase()) ? String(sh.id).toLowerCase() : catalog.slugify(sh.id || sh.label);
    const ex = slug ? inStore.get(slug) : null;
    // a merge keeps what the tag does not carry, on a shelf that exists —
    // and so does any document, for the attributes its root lists in keep="…"
    const said = (k) => !(sh.__has instanceof Set) || sh.__has.has(k);
    const kept = (k) => !!ex && !said(k) && (doc.mode === 'merge' || keep.has(k));
    const fields = catalog.shelfFields({
      label: kept('label') ? ex.label : sh.label,
      summary: kept('summary') ? ex.summary : sh.summary,
      image: kept('image') ? ex.image : sh.image,
      hidden: kept('hidden') ? ex.hidden : yes(sh.hidden, false),
      seoTitle: kept('seo-title') ? ex.seoTitle : sh.seoTitle,
      seoDescription: kept('seo-description') ? ex.seoDescription : sh.seoDescription
    });
    if (!slug || !fields.label) { softWarn('SHELF_INVALID', 'קטגוריה בלי מזהה או שם דולגה'); continue; }
    if (planned.has(slug)) { softWarn('SHELF_DUPLICATE', `הקטגוריה "${slug}" מופיעה פעמיים — נקלטה הראשונה`); continue; }
    if (!kept('image') && sh.image && !fields.image) softWarn('SHELF_FIXED', `תמונה עם כתובת לא תקינה הושמטה מהקטגוריה "${fields.label}"`);
    const next = { slug, ...fields, parent: kept('parent') ? ex.parent : slugOf(sh.parent), sort: 0 };
    planned.set(slug, next);
    shelves.push(next);
  }
  // one level of nesting: a parent must be there, and must itself be top-level
  const parentOf = (slug) => (planned.has(slug) ? planned.get(slug).parent : (inStore.has(slug) ? inStore.get(slug).parent : null));
  for (const sh of shelves) {
    if (!sh.parent) continue;
    const above = sh.parent === sh.slug ? null : parentOf(sh.parent);
    if (above === null) {
      softWarn('SHELF_PARENT_MISSING', `קטגוריית האב "${sh.parent}" של "${sh.label}" לא נמצאה — "${sh.label}" תהיה קטגוריה ראשית`);
      sh.parent = '';
    } else if (above) {
      softWarn('SHELF_TOO_DEEP', `אפשר רק רמה אחת של תת-קטגוריות — "${sh.label}" תהיה קטגוריה ראשית`);
      sh.parent = '';
    }
  }
  // …and a shelf that keeps children the document did not move cannot become a child
  for (const sh of shelves) {
    if (sh.parent && storeShelves.some((o) => o.parent === sh.slug && !planned.has(o.slug))) {
      softWarn('SHELF_TOO_DEEP', `לקטגוריה "${sh.label}" יש תת-קטגוריות — היא נשארת קטגוריה ראשית`);
      sh.parent = '';
    }
  }
  // order: a whole document's position is the order; a merge leaves the
  // order of what exists alone and puts what is new after it
  let lastSort = storeShelves.reduce((m, s) => Math.max(m, s.sort), -1);
  shelves.forEach((sh, i) => {
    const ex = inStore.get(sh.slug);
    if (doc.mode !== 'merge') sh.sort = i;
    else sh.sort = ex ? ex.sort : ++lastSort;
    if (!ex) { preview.shelvesAdded.push(sh.label); return; }
    const differs = ['label', 'parent', 'summary', 'image', 'hidden', 'seoTitle', 'seoDescription'].some((k) => sh[k] !== ex[k]);
    if (differs) preview.shelvesChanged.push(sh.label);
  });
  const known = new Set(shelves.map((s) => s.slug).concat(storeShelves.map((s) => s.slug)));
  for (const p of products) {
    if (p.shelf && !known.has(p.shelf)) {
      softWarn('SHELF_CREATED', `הקטגוריה "${p.shelf}" לא הוגדרה — תיווצר אוטומטית`);
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
    const wantsPaypal = doc.payments.some((m) => (m.kind || m.id) === 'paypal');
    let paypalReady = false;
    try { paypalReady = require('./paypal').isReady(current); } catch (e) { paypalReady = false; }
    if (wantsPaypal && !paypalReady) softWarn('PAYPAL_NOT_CONNECTED', 'אמצעי התשלום PayPal יופיע בקופה אחרי שמפתחות ארגז החול יישמרו ב-config/payments.json או במשתני הסביבה');
    // a `demo` method is taken as written and offered nowhere but a demo
    // shop — the owner of a real one is told at the door, not at the
    // checkout. The demo seed applies its catalog a moment BEFORE it marks
    // the site a demo, so a host armed for the seed counts as one here.
    const wantsDemo = doc.payments.some((m) => (m.kind || m.id) === 'demo');
    let demoOffered = false;
    try { demoOffered = process.env.TAPUZ_DEMO_STORE === '1' || require('./demo-pay').allowed(current); } catch (e) { demoOffered = false; }
    if (wantsDemo && !demoOffered) softWarn('DEMO_NOT_OFFERED', 'אמצעי התשלום "תשלום לדוגמה" מוצע בקופה רק באתר הדגמה, או כשהתיבה "להציע תשלום לדוגמה בקופה" מסומנת בהגדרות החנות');
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

/**
 * Keep the store as it stands, as a <bent-store> document (newest ten).
 * Also the admin's own safety net before a delete — it stands on its own,
 * outside an apply.
 *
 * A backup is only worth its name if it comes back whole, so it is read
 * back here the way an undo will read it and held to the catalog, product
 * for product. One that does not match THROWS (a Hebrew sentence) before
 * anything is stored — and before the apply it protects has written a thing.
 * @returns {number} the backup's id
 */
function backup(reason) {
  const source = exportDocument();
  const back = dialect.parseStoreDoc(source, { trusted: true });
  const inDb = db.prepare('SELECT slug FROM store_products').all().map((r) => r.slug).sort();
  const inDoc = back.doc ? back.doc.products.map((p) => p.id).sort() : null;
  if (!inDoc || inDoc.length !== inDb.length || inDb.some((slug, i) => slug !== inDoc[i])) {
    throw new Error('גיבוי הקטלוג לא נקרא חזרה במלואו, ולכן שום דבר לא שונה. שמרו עותק ‎.pzn (אחסון ← ייצוא) לפני שמנסים שוב.');
  }
  // …and the one thing the document cannot say travels beside it: what each
  // product cost the owner. Without it an undo brought a deleted product
  // back with no cost, and left an imported cost where the import put it.
  const costs = {};
  for (const r of db.prepare('SELECT slug, cost FROM store_products WHERE cost IS NOT NULL').all()) costs[r.slug] = r.cost;
  // …and so does what the document leaves unsaid — the rules at their
  // defaults, the empty lists, the coupons that were on (see the header)
  const info = db.prepare('INSERT INTO store_backups (reason, source, costs, state) VALUES (?, ?, ?, ?)')
    .run(String(reason || '').slice(0, 80), source, JSON.stringify(costs), JSON.stringify(stateSnapshot()));
  const keep = db.prepare('SELECT id FROM store_backups ORDER BY id DESC LIMIT ?').all(BACKUPS_KEEP).map((r) => r.id);
  if (keep.length) db.prepare(`DELETE FROM store_backups WHERE id NOT IN (${keep.map(() => '?').join(',')})`).run(...keep);
  return Number(info.lastInsertRowid);
}

// the settings a document can speak of — and so the ones a backup answers for
const STATE_KEYS = ['name', 'currency', 'vatRate', 'pricesIncludeVat', 'vatExempt', 'minOrder', 'lowStock', 'orderStart',
  'requireEmail', 'terms', 'thanks', 'shipping', 'payments'];

/** The part of the store a backup keeps beside its document: see "UNSAID" in the header. */
function stateSnapshot() {
  const s = settingsMod.loadSettings();
  const settings = {};
  for (const k of STATE_KEYS) settings[k] = s[k];
  return { settings, coupons: coupons.listCoupons().map((c) => ({ code: c.code, active: !!c.active })) };
}

/** A backup row's snapshot, or null — a backup from before the column, or a note that cannot be read, knows nothing more than its document. */
function stateOf(row) {
  if (!row || row.state === null || row.state === undefined) return null;
  let state;
  try { state = JSON.parse(row.state); } catch (e) { return null; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  return state;
}

/**
 * Put a snapshot back, after the backup's document has been applied and
 * inside the same transaction. The settings go through saveSettings (so
 * they are normalized like any others); a coupon the backup knew gets the
 * on/off it had, and one it never knew — added since — is switched off,
 * never deleted, the way a whole-catalog document treats a coupon it does
 * not mention.
 */
function putBackState(state) {
  const had = state.settings && typeof state.settings === 'object' ? state.settings : {};
  const patch = {};
  for (const k of STATE_KEYS) if (had[k] !== undefined) patch[k] = had[k];
  if (Object.keys(patch).length) settingsMod.saveSettings(patch);
  if (Array.isArray(state.coupons)) {
    const was = new Map(state.coupons.filter((c) => c && c.code).map((c) => [String(c.code), !!c.active]));
    for (const c of coupons.listCoupons()) {
      const on = was.get(c.code) === true;
      if (!!c.active !== on) db.prepare('UPDATE store_coupons SET active = ? WHERE code = ?').run(on ? 1 : 0, c.code);
    }
  }
}

function listBackups() {
  return db.prepare('SELECT id, reason, created_at, length(source) AS size FROM store_backups ORDER BY id DESC').all();
}

function getBackup(id) {
  return db.prepare('SELECT * FROM store_backups WHERE id = ?').get(Number(id)) || null;
}

/**
 * Put back what the products of a backup cost, once its document has been
 * applied. Every product the backup NAMES goes back to the cost it had that
 * moment — a number, or none. A product that came later is not the backup's
 * to touch. A backup that kept no costs (taken before v2.69, or one whose
 * note cannot be read) moves none: unknown is not zero.
 * @returns {number} how many costs changed
 */
function restoreCosts(row) {
  if (!row || row.costs === null || row.costs === undefined) return 0;
  let had;
  try { had = JSON.parse(row.costs); } catch (e) { return 0; }
  if (!had || typeof had !== 'object' || Array.isArray(had)) return 0;
  const back = dialect.parseStoreDoc(row.source, { trusted: true });
  if (!back.doc) return 0;
  const costs = {};
  for (const p of back.doc.products) {
    // the same reading of an id the apply itself made
    const id = String(p.id || '').toLowerCase();
    const slug = catalog.isSlug(id) ? id : catalog.slugify(p.id || p.title);
    if (slug) costs[slug] = Number.isInteger(had[slug]) ? had[slug] : null;
  }
  return catalog.setCosts(costs).changed;
}

// ── apply ──────────────────────────────────────────────────────────────

/**
 * Apply a document. Refusals write nothing; hard warnings need force.
 * @returns {{ ok:boolean, code?:string, message?:string, backupId?:number, preview?:object, warnings?:object[], changed?:object }}
 */
function applyDocument(text, opts = {}) {
  return applyWith(text, opts, null);
}

/**
 * The apply itself. `state` is a backup's snapshot and is passed by
 * undoLast() / restoreBackup() only — never by a caller holding a pasted
 * document: it is put back last, inside the transaction, so the store ends
 * exactly as the backup found it and the one rebuild below shows it.
 */
function applyWith(text, opts, state) {
  const planned = planDocument(text, { trusted: !!opts.trusted });
  // the plan first, the verdict after it: `ok` must be THIS answer's, never the plan's
  if (!planned.ok) return { ...planned, ok: false, code: planned.errors[0] ? planned.errors[0].code : 'INVALID', message: planned.errors.map((e) => e.message).join(' · ') };
  if (planned.hard && !opts.force) {
    return { ...planned, ok: false, code: 'NEEDS_CONFIRM', message: 'יש אזהרות שדורשות אישור' };
  }
  const { plan } = planned;
  // no backup, no apply: a store that cannot be put back is not changed
  let backupId;
  try {
    backupId = backup(opts.reason || 'apply');
  } catch (e) {
    return { ...planned, ok: false, code: 'BACKUP_FAILED', message: e.message };
  }
  const touched = [];
  db.transaction(() => {
    // the plan checked every parent, so a child may name a shelf written after it
    for (const sh of plan.shelves) catalog.writeShelfRow(sh);
    let last = db.prepare('SELECT COALESCE(MAX(sort), -10) AS n FROM store_products').get().n;
    plan.products.forEach((p, i) => {
      catalog.ensureShelf(p.shelf);
      const ex = catalog.getProductBySlug(p.slug);
      // order: a whole document's position IS the order. A merge names a
      // few products — numbering them from 0 threw one fragment's product
      // to the top of the shop — so it keeps the place of what exists and
      // puts what is new at the end.
      let sort = i;
      if (plan.mode === 'merge') {
        if (ex) sort = ex.sort;
        else { last += 10; sort = last; }
      }
      // through the catalog's own writer, and without `cost`: see the header
      const id = catalog.writeProductRow({ ...p, sort }, ex ? ex.id : null);
      catalog.writeVariants(id, p.variants);
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
    if (state) putBackState(state);
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
  // `slugs`: the SKUs this apply wrote — what travels beside the document (a
  // sheet's cost prices) is written for these and for no other row
  return { ok: true, backupId, preview: planned.preview, warnings: planned.warnings, changed: { products: touched.length, slugs: touched }, rebuilt };
}

/** Put the newest backup back (itself backed up first, so an undo can be undone). */
function undoLast() {
  const last = db.prepare('SELECT * FROM store_backups ORDER BY id DESC LIMIT 1').get();
  if (!last) return { ok: false, code: 'NO_BACKUP', message: 'אין גיבוי לשחזור' };
  // a backup is the store's own words: read it whole, whatever its size —
  // and with it what the words leave unsaid (the rules at their defaults,
  // the empty lists, the coupons), so the store is as the backup found it
  const r = applyWith(last.source, { force: true, trusted: true, reason: 'undo:' + last.id }, stateOf(last));
  if (!r.ok) return { ...r, restored: last.id };
  // the apply above took its own backup first — of the store as it stood,
  // costs included — so this undo can itself be undone, costs and all
  const costs = restoreCosts(last);
  db.prepare('DELETE FROM store_backups WHERE id = ?').run(last.id);
  return { ...r, costs, restored: last.id };
}

function restoreBackup(id) {
  const b = getBackup(id);
  if (!b) return { ok: false, code: 'NO_BACKUP', message: 'הגיבוי לא נמצא' };
  const r = applyWith(b.source, { force: true, trusted: true, reason: 'restore:' + b.id }, stateOf(b));
  return r.ok ? { ...r, costs: restoreCosts(b), restored: b.id } : { ...r, restored: b.id };
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
