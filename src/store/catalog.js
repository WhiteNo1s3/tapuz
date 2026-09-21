'use strict';

/**
 * The catalog — products, their variants, and the shelves (categories) they
 * sit on. Rows are the truth; the <bent-store> document (dialect.js) is the
 * way a catalog is written, read back, pasted from an AI, and packed.
 *
 * Identity is the product's `slug` (its SKU): the cart, the checkout, the
 * <bent-buy sku="…"> module and the document all name a product by it, so it
 * never changes after creation (a new slug is a new product).
 */

const { db } = require('../db');
const money = require('./money');

const STATUSES = ['active', 'hidden', 'draft'];
const STATUS_LABELS = { active: 'פעיל', hidden: 'מוסתר', draft: 'טיוטה' };
const MAX_IMAGES = 12;
const MAX_VARIANTS = 50;
const MAX_QTY = 99;

const SLUG_RE = /^[a-z0-9א-ת][a-z0-9א-ת-]{0,79}$/;

function clip(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

/** Title → slug. Hebrew letters stay Hebrew (a Hebrew shop has Hebrew addresses). */
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // niqqud and cantillation marks
    .replace(/[^a-z0-9א-ת]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

function isSlug(s) {
  return SLUG_RE.test(String(s || ''));
}

/** A product picture: a site path or an http(s) URL — never a script scheme. */
function cleanImage(v) {
  const s = clip(v, 500).replace(/[\u0000-\u001f\u007f]/g, '');
  if (!s) return '';
  if (/^(?:javascript|data|vbscript):/i.test(s)) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s.replace(/["'<>\s]/g, (c) => encodeURIComponent(c));
  return '';
}

function intOrNull(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), min), max);
}

function priceOf(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= money.MAX_MINOR) return v;
  return money.toMinor(v);
}

// ── shelves ────────────────────────────────────────────────────────────

function listShelves() {
  const counts = {};
  for (const r of db.prepare("SELECT shelf, COUNT(*) AS n FROM store_products WHERE status = 'active' GROUP BY shelf").all()) {
    counts[r.shelf] = r.n;
  }
  return db.prepare('SELECT slug, label, sort FROM store_shelves ORDER BY sort, label').all()
    .map((s) => ({ ...s, count: counts[s.slug] || 0 }));
}

function getShelf(slug) {
  return db.prepare('SELECT slug, label, sort FROM store_shelves WHERE slug = ?').get(String(slug || '')) || null;
}

function saveShelf(input) {
  const label = clip(input && input.label, 60);
  const slug = isSlug(input && input.slug) ? input.slug : slugify((input && input.slug) || label);
  if (!label) throw new Error('למדף חסר שם');
  if (!isSlug(slug)) throw new Error('מזהה המדף אינו תקין');
  const sort = intOrNull(input && input.sort, -100000, 100000) || 0;
  db.prepare(`
    INSERT INTO store_shelves (slug, label, sort) VALUES (?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET label = excluded.label, sort = excluded.sort
  `).run(slug, label, sort);
  return getShelf(slug);
}

function deleteShelf(slug) {
  const s = String(slug || '');
  db.transaction(() => {
    db.prepare("UPDATE store_products SET shelf = '', updated_at = CURRENT_TIMESTAMP WHERE shelf = ?").run(s);
    db.prepare('DELETE FROM store_shelves WHERE slug = ?').run(s);
  })();
}

// ── products ───────────────────────────────────────────────────────────

function hydrate(row) {
  if (!row) return null;
  let images = [];
  try { images = JSON.parse(row.images || '[]'); } catch (e) { images = []; }
  const variants = db.prepare('SELECT id, code, label, price, stock, sort FROM store_variants WHERE product_id = ? ORDER BY sort, id').all(row.id);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary || '',
    description: row.description || '',
    price: row.price,
    compareAt: row.compare_at,
    stock: row.stock,
    images: Array.isArray(images) ? images.filter(Boolean) : [],
    shelf: row.shelf || '',
    badge: row.badge || '',
    status: row.status,
    delivery: !!row.delivery,
    maxPerOrder: row.max_per_order,
    sort: row.sort || 0,
    variants,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getProduct(idOrSlug) {
  const row = typeof idOrSlug === 'number' || /^\d+$/.test(String(idOrSlug || ''))
    ? db.prepare('SELECT * FROM store_products WHERE id = ?').get(Number(idOrSlug))
    : db.prepare('SELECT * FROM store_products WHERE slug = ?').get(String(idOrSlug || ''));
  return hydrate(row);
}

const SORTS = {
  manual: 'sort, id',
  new: 'id DESC',
  'price-asc': 'price, id',
  'price-desc': 'price DESC, id',
  name: 'title COLLATE NOCASE, id'
};

/**
 * @param {{status?:string|'all', shelf?:string, q?:string, sort?:string, limit?:number, exclude?:string}} opts
 */
function listProducts(opts = {}) {
  const where = [];
  const args = [];
  const status = opts.status || 'active';
  if (status !== 'all') { where.push('status = ?'); args.push(status); }
  if (opts.shelf) { where.push('shelf = ?'); args.push(String(opts.shelf)); }
  if (opts.exclude) { where.push('slug != ?'); args.push(String(opts.exclude)); }
  if (opts.q) {
    where.push('(title LIKE ? OR slug LIKE ? OR summary LIKE ?)');
    const like = '%' + String(opts.q).slice(0, 80) + '%';
    args.push(like, like, like);
  }
  const order = SORTS[opts.sort] || SORTS.manual;
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 500, 1), 2000);
  const rows = db.prepare(
    'SELECT * FROM store_products' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY ' + order + ' LIMIT ' + limit
  ).all(...args);
  return rows.map(hydrate);
}

function countProducts() {
  const r = db.prepare("SELECT COUNT(*) AS n, SUM(status = 'active') AS active FROM store_products").get();
  return { total: r.n || 0, active: r.active || 0 };
}

function uniqueSlug(base, ignoreId) {
  let slug = base;
  let n = 2;
  for (;;) {
    const hit = db.prepare('SELECT id FROM store_products WHERE slug = ?').get(slug);
    if (!hit || hit.id === ignoreId) return slug;
    slug = (base.slice(0, 74) + '-' + n++).replace(/-{2,}/g, '-');
  }
}

/**
 * Validate a product as a person (or an AI) typed it.
 * @returns {{ product: object|null, variants: object[], errors: string[], warnings: string[] }}
 */
function normalizeProduct(input, opts = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = [];
  const warnings = [];
  const title = clip(src.title, 120);
  if (!title) errors.push('למוצר חסר שם');

  let slug = clip(src.slug || src.sku || src.id, 80).toLowerCase();
  if (slug && !isSlug(slug)) {
    const fixed = slugify(slug);
    if (fixed) warnings.push(`המזהה "${slug}" תוקן ל-"${fixed}"`);
    slug = fixed;
  }
  if (!slug) slug = slugify(title);
  if (!slug) slug = 'product';

  const price = priceOf(src.price);
  if (!Number.isFinite(price)) errors.push(`מחיר לא תקין למוצר "${title || slug}"`);

  let compareAt = null;
  if (src.compareAt !== undefined && src.compareAt !== null && src.compareAt !== '') {
    const c = priceOf(src.compareAt);
    if (!Number.isFinite(c)) warnings.push(`"מחיר לפני" לא תקין למוצר "${title || slug}" — הושמט`);
    else if (Number.isFinite(price) && c <= price) warnings.push(`"מחיר לפני" של "${title || slug}" אינו גבוה מהמחיר — הושמט`);
    else compareAt = c;
  }

  const images = [];
  const rawImages = Array.isArray(src.images) ? src.images
    : String(src.images || '').split(/[\s,]+/);
  if (src.image) rawImages.unshift(src.image);
  for (const im of rawImages) {
    const clean = cleanImage(im);
    if (clean && !images.includes(clean)) images.push(clean);
    else if (im && String(im).trim() && !clean) warnings.push(`תמונה עם כתובת לא תקינה הושמטה (${clip(im, 60)})`);
    if (images.length >= MAX_IMAGES) break;
  }

  const status = STATUSES.includes(src.status) ? src.status : 'active';
  const shelfRaw = clip(src.shelf || src.category, 80);
  const shelf = shelfRaw ? (isSlug(shelfRaw) ? shelfRaw : slugify(shelfRaw)) : '';

  const variants = [];
  const seen = new Set();
  const rawVariants = Array.isArray(src.variants) ? src.variants.slice(0, MAX_VARIANTS) : [];
  if (Array.isArray(src.variants) && src.variants.length > MAX_VARIANTS) {
    warnings.push(`למוצר "${title || slug}" יותר מ-${MAX_VARIANTS} אפשרויות — נשמרו הראשונות`);
  }
  rawVariants.forEach((v, i) => {
    if (!v || typeof v !== 'object') return;
    const label = clip(v.label || v.name || v.code, 60);
    if (!label) return;
    let code = clip(v.code || v.id, 40).toLowerCase();
    if (!isSlug(code)) code = slugify(code || label) || ('v' + (i + 1));
    while (seen.has(code)) code = code + '-' + (i + 1);
    seen.add(code);
    let vPrice = null;
    if (v.price !== undefined && v.price !== null && v.price !== '') {
      const p = priceOf(v.price);
      if (Number.isFinite(p)) vPrice = p;
      else warnings.push(`מחיר לא תקין לאפשרות "${label}" — יחול מחיר המוצר`);
    }
    variants.push({ code, label, price: vPrice, stock: intOrNull(v.stock, 0, 1000000), sort: i });
  });

  if (errors.length) return { product: null, variants: [], errors, warnings };
  return {
    product: {
      slug,
      title,
      summary: clip(src.summary, 200),
      description: clip(src.description, 8000),
      price,
      compareAt,
      // with options, stock is counted per option — a product-level number
      // would be a second truth nobody sells from
      stock: variants.length ? null : intOrNull(src.stock, 0, 1000000),
      images,
      shelf,
      badge: clip(src.badge, 24),
      status,
      delivery: src.delivery === undefined ? true : !(src.delivery === false || src.delivery === 'false' || src.delivery === 0 || src.delivery === '0'),
      maxPerOrder: intOrNull(src.maxPerOrder, 1, 999),
      sort: intOrNull(src.sort, -100000, 100000) || 0
    },
    variants,
    errors,
    warnings
  };
}

function writeVariants(productId, variants) {
  db.prepare('DELETE FROM store_variants WHERE product_id = ?').run(productId);
  const ins = db.prepare('INSERT INTO store_variants (product_id, code, label, price, stock, sort) VALUES (?, ?, ?, ?, ?, ?)');
  variants.forEach((v, i) => ins.run(productId, v.code, v.label, v.price, v.stock, i));
}

function ensureShelf(slug) {
  if (!slug) return;
  const hit = getShelf(slug);
  if (!hit) db.prepare('INSERT INTO store_shelves (slug, label, sort) VALUES (?, ?, 0)').run(slug, slug.replace(/-/g, ' '));
}

/**
 * Create a product. A taken slug gets a -2/-3 suffix (never an overwrite).
 * @returns {{ product: object, warnings: string[] }}
 */
function createProduct(input) {
  const n = normalizeProduct(input);
  if (n.errors.length) { const e = new Error(n.errors.join(' · ')); e.errors = n.errors; throw e; }
  const p = n.product;
  let id;
  db.transaction(() => {
    p.slug = uniqueSlug(p.slug, null);
    ensureShelf(p.shelf);
    const r = db.prepare(`
      INSERT INTO store_products (slug, title, summary, description, price, compare_at, stock, images, shelf, badge, status, delivery, max_per_order, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.slug, p.title, p.summary, p.description, p.price, p.compareAt, p.stock, JSON.stringify(p.images),
      p.shelf, p.badge, p.status, p.delivery ? 1 : 0, p.maxPerOrder, p.sort);
    id = Number(r.lastInsertRowid);
    writeVariants(id, n.variants);
  })();
  return { product: getProduct(id), warnings: n.warnings };
}

/**
 * Update a product in place. The slug is its identity and is kept.
 * @returns {{ product: object, warnings: string[] }}
 */
function updateProduct(idOrSlug, input) {
  const existing = getProduct(idOrSlug);
  if (!existing) throw new Error('המוצר לא נמצא');
  const merged = {
    title: existing.title, summary: existing.summary, description: existing.description,
    price: existing.price, compareAt: existing.compareAt, stock: existing.stock,
    images: existing.images, shelf: existing.shelf, badge: existing.badge, status: existing.status,
    delivery: existing.delivery, maxPerOrder: existing.maxPerOrder, sort: existing.sort,
    variants: existing.variants,
    ...(input || {}),
    slug: existing.slug
  };
  const n = normalizeProduct(merged);
  if (n.errors.length) { const e = new Error(n.errors.join(' · ')); e.errors = n.errors; throw e; }
  const p = n.product;
  db.transaction(() => {
    ensureShelf(p.shelf);
    db.prepare(`
      UPDATE store_products SET title = ?, summary = ?, description = ?, price = ?, compare_at = ?, stock = ?,
        images = ?, shelf = ?, badge = ?, status = ?, delivery = ?, max_per_order = ?, sort = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(p.title, p.summary, p.description, p.price, p.compareAt, p.stock, JSON.stringify(p.images),
      p.shelf, p.badge, p.status, p.delivery ? 1 : 0, p.maxPerOrder, p.sort, existing.id);
    writeVariants(existing.id, n.variants);
  })();
  return { product: getProduct(existing.id), warnings: n.warnings };
}

function deleteProduct(idOrSlug) {
  const existing = getProduct(idOrSlug);
  if (!existing) return false;
  db.prepare('DELETE FROM store_products WHERE id = ?').run(existing.id);
  return existing;
}

function duplicateProduct(idOrSlug) {
  const p = getProduct(idOrSlug);
  if (!p) throw new Error('המוצר לא נמצא');
  return createProduct({
    ...p,
    slug: p.slug + '-copy',
    title: p.title + ' (עותק)',
    status: 'draft',
    variants: p.variants
  });
}

/** Set one stock number (a product, or one of its variants) — the admin's quick edit. */
function setStock(idOrSlug, variantCode, stock) {
  const p = getProduct(idOrSlug);
  if (!p) throw new Error('המוצר לא נמצא');
  const val = intOrNull(stock, 0, 1000000);
  if (variantCode) {
    const r = db.prepare('UPDATE store_variants SET stock = ? WHERE product_id = ? AND code = ?').run(val, p.id, String(variantCode));
    if (!r.changes) throw new Error('האפשרות לא נמצאה');
  } else {
    db.prepare('UPDATE store_products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(val, p.id);
  }
  return getProduct(p.id);
}

// ── the shopper's view ─────────────────────────────────────────────────

function stockState(stock, lowStock) {
  if (stock === null || stock === undefined) return 'in';
  if (stock <= 0) return 'out';
  if (lowStock && stock <= lowStock) return 'low';
  return 'in';
}

/**
 * What a shopper may know about a product: no internal ids, no sort keys,
 * no exact stock unless it is low (a "3 left" line is a selling point;
 * "stock: 412" is the owner's business).
 */
function publicProduct(p, settings) {
  const s = settings || require('./settings').loadSettings();
  const cur = s.currency;
  const low = s.lowStock;
  const cap = (stock) => Math.max(0, Math.min(p.maxPerOrder || MAX_QTY, stock === null || stock === undefined ? MAX_QTY : stock));
  const variants = (p.variants || []).map((v) => {
    const price = v.price === null || v.price === undefined ? p.price : v.price;
    const state = stockState(v.stock, low);
    return {
      code: v.code,
      label: v.label,
      price,
      priceText: money.formatMoney(price, cur),
      available: state !== 'out',
      stockState: state,
      stockLeft: state === 'low' ? v.stock : null,
      maxQty: cap(v.stock)
    };
  });
  const own = stockState(p.stock, low);
  const hasVariants = variants.length > 0;
  const available = p.status === 'active' && (hasVariants ? variants.some((v) => v.available) : own !== 'out');
  const shelf = p.shelf ? getShelf(p.shelf) : null;
  const prices = hasVariants ? variants.map((v) => v.price) : [p.price];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  return {
    sku: p.slug,
    title: p.title,
    summary: p.summary,
    description: p.description,
    price: p.price,
    priceText: minPrice === maxPrice
      ? money.formatMoney(minPrice, cur)
      : 'החל מ-' + money.formatMoney(minPrice, cur),
    compareAt: p.compareAt && p.compareAt > p.price ? p.compareAt : null,
    compareText: p.compareAt && p.compareAt > p.price && !hasVariants ? money.formatMoney(p.compareAt, cur) : '',
    currency: cur,
    images: p.images,
    image: p.images[0] || '',
    shelf: p.shelf,
    shelfLabel: shelf ? shelf.label : '',
    badge: p.badge,
    delivery: p.delivery,
    available,
    stockState: hasVariants ? (available ? 'in' : 'out') : own,
    stockLeft: !hasVariants && own === 'low' ? p.stock : null,
    maxQty: hasVariants ? 0 : cap(p.stock),
    hasVariants,
    variants
  };
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  MAX_QTY,
  slugify,
  isSlug,
  cleanImage,
  listShelves,
  getShelf,
  saveShelf,
  deleteShelf,
  listProducts,
  countProducts,
  getProduct,
  normalizeProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  duplicateProduct,
  setStock,
  stockState,
  publicProduct,
  writeVariants,
  ensureShelf,
  uniqueSlug
};
