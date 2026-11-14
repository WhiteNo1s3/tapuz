'use strict';

/**
 * The catalog — products, their variants, and the shelves (categories) they
 * sit on. Rows are the truth; the <bent-store> document (dialect.js) is the
 * way a catalog is written, read back, pasted from an AI, and packed.
 *
 * Identity is the product's `slug` (its SKU): the cart, the checkout, the
 * <bent-buy sku="…"> module and the document all name a product by it, so it
 * never changes after creation (a new slug is a new product).
 *
 * v2.69: a shelf is a full category (a parent — one level —, a line of text,
 * a picture, a hidden switch, its own search-result text, an order the owner
 * sets), and a product carries a brand, tags, a featured star, a barcode, a
 * weight, search-result text and `cost`. `cost` is the OWNER's number: it is
 * on the hydrated product for the admin and nowhere else — not in
 * publicProduct, not in any public API, not in the document.
 */

const { db } = require('../db');
const money = require('./money');

const STATUSES = ['active', 'hidden', 'draft'];
const STATUS_LABELS = { active: 'פעיל', hidden: 'מוסתר', draft: 'טיוטה' };
const MAX_IMAGES = 12;
const MAX_VARIANTS = 50;
const MAX_QTY = 99;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 30;

const SLUG_RE = /^[a-z0-9א-ת][a-z0-9א-ת-]{0,79}$/;

function clip(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

/**
 * A ONE-LINE field (a title, a label, a summary, a badge): a line break or a
 * tab becomes one space. These fields travel as attributes of the
 * <bent-store> document and sit on one line of a card — a title that kept
 * its Enter used to drop the whole product from the store's own export.
 *
 * Split and trim, not one regex: `\s*[\r\n\t]+\s*` tried every start inside a
 * long run of spaces, and a 150 KB cell of them held the server for seconds.
 */
function line(v, max) {
  return clip(String(v == null ? '' : v).split(/[\r\n\t]+/).map((s) => s.trim()).filter(Boolean).join(' '), max);
}

/** What a checkbox, a form and a document all send for "yes". */
function truthy(v) {
  return v === true || v === 1 || v === 'true' || v === '1' || v === 'on';
}

/** SQLite's lower() folds A–Z only; counting in JS folds the same way, so a filter and its count agree. */
function asciiLower(s) {
  return String(s).replace(/[A-Z]/g, (c) => c.toLowerCase());
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
  // a site path starts with exactly ONE slash: "//host/x.png" (and the
  // "/\host" a browser reads the same way) is another site's address
  // wearing a path's clothes
  if (/^https?:\/\//i.test(s) || /^\/(?![/\\])/.test(s)) return s.replace(/["'<>\s]/g, (c) => encodeURIComponent(c));
  return '';
}

/**
 * A whole number a person typed, or null. Strict on purpose: stripping
 * every non-digit turned a stock of "12.5" into 125 units. Spaces, a
 * thousands comma ("1,200") and a decimal part that is all zeros ("5.00" —
 * how a sheet that formats its numbers writes 5) aside, anything that is not
 * whole digits is not a number — `onBad` hears the raw value so the caller
 * can say so.
 */
function intOrNull(v, min, max, onBad) {
  if (v === null || v === undefined || v === '') return null;
  let n;
  if (typeof v === 'number') {
    n = v;
  } else {
    let s = String(v).replace(/\s+/g, '').replace(/^(-?[\d,]+)\.0+$/, '$1');
    if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    if (!/^-?\d+$/.test(s)) {
      if (s && onBad) onBad(v);
      return null;
    }
    n = parseInt(s, 10);
  }
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** Would the reader above take this as a whole number? The document asks BEFORE a typo in a stock can turn counting off. */
function isWhole(v) {
  let bad = false;
  intOrNull(v, 0, 0, () => { bad = true; });
  return !bad;
}

// What a status may be called — by a sheet from another shop, by a person
// typing Hebrew, by an AI. One table for the CSV door and the document door.
// (prototype-less: a cell that says "constructor" must find nothing)
const STATUS_WORDS = Object.assign(Object.create(null), {
  active: 'active', published: 'active', 'פעיל': 'active', 1: 'active', true: 'active',
  hidden: 'hidden', archived: 'hidden', 'מוסתר': 'hidden', 0: 'hidden', false: 'hidden',
  draft: 'draft', 'טיוטה': 'draft', '-1': 'draft'
});

/** The status a word names ('active' | 'hidden' | 'draft'), or null for a word nobody knows. */
function statusOf(word) {
  return STATUS_WORDS[String(word == null ? '' : word).trim().toLowerCase()] || null;
}

function priceOf(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= money.MAX_MINOR) return v;
  return money.toMinor(v);
}

// ── shelves ────────────────────────────────────────────────────────────

// A shelf is a CATEGORY (the owner's screens say קטגוריות; the document and
// every shipped page say "shelf", so the code does too). One level of
// nesting: a child's parent is a top-level shelf.

function shelfRow(slug) {
  return db.prepare('SELECT * FROM store_shelves WHERE slug = ?').get(String(slug || '')) || null;
}

/** Does this row name a parent that is really there (and is not itself)? */
function namesParent(row) {
  return !!(row && row.parent && row.parent !== row.slug && shelfRow(row.parent));
}

/**
 * The parent a shelf REALLY has. A row whose parent is missing, is itself,
 * or is itself somebody's child counts as top-level: a restore or a
 * hand-edited file can leave a broken link, and a shelf must never be lost
 * to one.
 */
function parentRow(row) {
  if (!row || !row.parent || row.parent === row.slug) return null;
  const up = shelfRow(row.parent);
  if (!up || namesParent(up)) return null;
  return up;
}

function shelfOf(row, parent) {
  return {
    slug: row.slug,
    label: row.label,
    sort: row.sort || 0,
    parent: parent ? parent.slug : '',
    summary: row.summary || '',
    image: row.image || '',
    hidden: !!row.hidden,
    seoTitle: row.seo_title || '',
    seoDescription: row.seo_description || ''
  };
}

/**
 * Every shelf, parents first and each parent's children right after it
 * (both by `sort`, then label).
 *   count  ACTIVE products directly on the shelf (the storefront hides an
 *          empty chip with it)
 *   total  count + its children's counts
 *   all    products of ANY status directly on it (what a delete would move)
 * `{ visible: true }` leaves out what a shopper is not shown: a hidden shelf
 * and the children of a hidden shelf.
 */
function listShelves(opts = {}) {
  // (prototype-less: a shelf whose id is "constructor" must count 0, not a function)
  const active = Object.create(null);
  const all = Object.create(null);
  for (const r of db.prepare("SELECT shelf, COUNT(*) AS n, SUM(status = 'active') AS live FROM store_products GROUP BY shelf").all()) {
    all[r.shelf] = r.n;
    active[r.shelf] = r.live || 0;
  }
  const rows = db.prepare('SELECT * FROM store_shelves ORDER BY sort, label').all();
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const names = (r) => !!(r.parent && r.parent !== r.slug && bySlug.has(r.parent));
  const parentOf = (r) => (names(r) && !names(bySlug.get(r.parent)) ? bySlug.get(r.parent) : null);
  const tops = [];
  const kids = new Map();
  for (const r of rows) {
    const up = parentOf(r);
    if (!up) { tops.push(r); continue; }
    if (!kids.has(up.slug)) kids.set(up.slug, []);
    kids.get(up.slug).push(r);
  }
  const out = [];
  for (const t of tops) {
    const children = kids.get(t.slug) || [];
    const count = active[t.slug] || 0;
    out.push({
      ...shelfOf(t, null), depth: 0, count,
      total: count + children.reduce((n, c) => n + (active[c.slug] || 0), 0),
      all: all[t.slug] || 0
    });
    for (const c of children) {
      const n = active[c.slug] || 0;
      out.push({ ...shelfOf(c, t), depth: 1, count: n, total: n, all: all[c.slug] || 0 });
    }
  }
  if (!opts || !opts.visible) return out;
  const gone = new Set(out.filter((s) => s.hidden).map((s) => s.slug));
  return out.filter((s) => !gone.has(s.slug) && !gone.has(s.parent));
}

function getShelf(slug) {
  const row = shelfRow(slug);
  return row ? shelfOf(row, parentRow(row)) : null;
}

/** [slug, ...its children] — what "the products of this shelf" means on the site. */
function shelfFamily(slug) {
  const s = String(slug || '');
  const row = shelfRow(s);
  if (!row || namesParent(row)) return [s];
  return [s].concat(
    db.prepare('SELECT slug FROM store_shelves WHERE parent = ? AND slug != ? ORDER BY sort, label').all(s, s).map((r) => r.slug)
  );
}

/** From the top-level shelf down to this one: one or two steps, [] when there is no such shelf. */
function shelfPath(slug) {
  const row = shelfRow(slug);
  if (!row) return [];
  const up = parentRow(row);
  const step = (r) => ({ slug: r.slug, label: r.label });
  return up ? [step(up), step(row)] : [step(row)];
}

/** A shelf's free-text fields, cleaned — only the keys the caller sent (both doors clip the same way). */
function shelfFields(src) {
  const s = src && typeof src === 'object' ? src : {};
  const out = {};
  if (s.label !== undefined) out.label = line(s.label, 60);
  if (s.summary !== undefined) out.summary = line(s.summary, 300);
  if (s.image !== undefined) out.image = cleanImage(s.image);
  if (s.hidden !== undefined) out.hidden = truthy(s.hidden);
  if (s.seoTitle !== undefined) out.seoTitle = line(s.seoTitle, 70);
  if (s.seoDescription !== undefined) out.seoDescription = line(s.seoDescription, 160);
  return out;
}

/** A new shelf goes LAST (the order is the owner's; nothing jumps the queue). */
function nextShelfSort() {
  return db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM store_shelves').get().n;
}

/** The one statement that writes a shelf row whole — saveShelf and the document's apply both end here. */
function writeShelfRow(sh) {
  db.prepare(`
    INSERT INTO store_shelves (slug, label, sort, parent, summary, image, hidden, seo_title, seo_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET label = excluded.label, sort = excluded.sort, parent = excluded.parent,
      summary = excluded.summary, image = excluded.image, hidden = excluded.hidden,
      seo_title = excluded.seo_title, seo_description = excluded.seo_description
  `).run(sh.slug, sh.label, sh.sort || 0, sh.parent || '', sh.summary || '', sh.image || '', sh.hidden ? 1 : 0,
    sh.seoTitle || '', sh.seoDescription || '');
}

/**
 * Create or update a shelf. On an EXISTING shelf a field that was not sent
 * keeps its value — `saveShelf({ slug, label })` from a screen that only
 * knows names must never wipe a picture, a parent or the order.
 * Throws a Hebrew sentence for anything a person can fix.
 */
function saveShelf(input) {
  const src = input && typeof input === 'object' ? input : {};
  const sent = shelfFields(src);
  const label = sent.label || '';
  // always a string: a number bound to the TEXT key would be stored as "7.0"
  const slug = isSlug(src.slug) ? String(src.slug) : slugify(src.slug || label);
  if (!label) throw new Error('לקטגוריה חסר שם');
  if (!isSlug(slug)) throw new Error('מזהה הקטגוריה אינו תקין');
  if (src.image !== undefined && String(src.image == null ? '' : src.image).trim() && !sent.image) {
    throw new Error('כתובת התמונה של הקטגוריה אינה תקינה');
  }
  const was = shelfRow(slug);

  let parent = was ? was.parent || '' : '';
  if (src.parent !== undefined) {
    const raw = String(src.parent == null ? '' : src.parent).trim();
    parent = raw ? (isSlug(raw) ? raw : slugify(raw)) : '';
    if (raw && !parent) throw new Error('קטגוריית האב לא נמצאה');
    if (parent) {
      if (parent === slug) throw new Error('קטגוריה אינה יכולה להיות תת-קטגוריה של עצמה');
      const up = shelfRow(parent);
      if (!up) throw new Error('קטגוריית האב לא נמצאה');
      if (parentRow(up)) throw new Error('אפשר רק רמה אחת של תת-קטגוריות — קטגוריית האב היא בעצמה תת-קטגוריה');
      if (db.prepare('SELECT 1 FROM store_shelves WHERE parent = ? AND slug != ?').get(slug, slug)) {
        throw new Error('לקטגוריה הזו יש תת-קטגוריות — היא אינה יכולה להפוך לתת-קטגוריה');
      }
    }
  }

  // the order is the owner's: a save that does not send `sort` keeps it
  let sort;
  if (src.sort !== undefined && src.sort !== null && src.sort !== '') sort = intOrNull(src.sort, -100000, 100000) || 0;
  else sort = was ? was.sort || 0 : nextShelfSort();

  const keep = (key, column, fallback) => (sent[key] !== undefined ? sent[key] : (was ? was[column] : fallback));
  writeShelfRow({
    slug,
    label,
    sort,
    parent,
    summary: keep('summary', 'summary', ''),
    image: keep('image', 'image', ''),
    hidden: keep('hidden', 'hidden', false),
    seoTitle: keep('seoTitle', 'seo_title', ''),
    seoDescription: keep('seoDescription', 'seo_description', '')
  });
  return getShelf(slug);
}

/**
 * Delete a shelf. Its products move to `moveTo` (a shelf that exists and is
 * not this one) or to no shelf at all; its children become top-level.
 * @returns {{ deleted: boolean, moved: number, movedTo: string }}
 */
function deleteShelf(slug, opts = {}) {
  const s = String(slug || '');
  if (!s) return { deleted: false, moved: 0, movedTo: '' };
  const want = opts && opts.moveTo ? String(opts.moveTo) : '';
  const to = want && want !== s && shelfRow(want) ? want : '';
  let moved = 0;
  let deleted = false;
  db.transaction(() => {
    moved = db.prepare('UPDATE store_products SET shelf = ?, updated_at = CURRENT_TIMESTAMP WHERE shelf = ?').run(to, s).changes;
    db.prepare("UPDATE store_shelves SET parent = '' WHERE parent = ?").run(s);
    deleted = db.prepare('DELETE FROM store_shelves WHERE slug = ?').run(s).changes > 0;
  })();
  return { deleted, moved, movedTo: to };
}

/** The owner's order: `sort` = the index of each slug given. Shelves left out keep theirs. */
function reorderShelves(slugsInOrder) {
  const list = Array.isArray(slugsInOrder) ? slugsInOrder.map((s) => String(s || '')).filter(Boolean) : [];
  const set = db.prepare('UPDATE store_shelves SET sort = ? WHERE slug = ?');
  db.transaction(() => { list.forEach((slug, i) => set.run(i, slug)); })();
  return listShelves();
}

// ── products ───────────────────────────────────────────────────────────

/** The tags column (a JSON array of strings) as an array — a row nobody can parse has no tags. */
function tagsOf(json) {
  let list = [];
  try { list = JSON.parse(json || '[]'); } catch (e) { list = []; }
  return Array.isArray(list) ? list.filter((t) => typeof t === 'string' && t) : [];
}

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
    brand: row.brand || '',
    tags: tagsOf(row.tags),
    featured: !!row.featured,
    barcode: row.barcode || '',
    weight: row.weight === undefined ? null : row.weight,
    // the owner's number: publicProduct never copies it, the document never carries it
    cost: row.cost === undefined ? null : row.cost,
    seoTitle: row.seo_title || '',
    seoDescription: row.seo_description || '',
    variants,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** A product by its SKU and nothing else — the document's and the CSV's lookup. */
function getProductBySlug(slug) {
  return hydrate(db.prepare('SELECT * FROM store_products WHERE slug = ?').get(String(slug || '')));
}

/**
 * A product by its row id (a number) or its SKU (a string). A string of
 * digits is a SKU FIRST: a shop whose SKUs are numbers ("1001") must not
 * have a cart line or a `<bent-buy sku>` land on whatever row happens to be
 * #1001. Only when no product has that SKU is it read as a row id (the
 * admin's addresses carry ids).
 */
function getProduct(idOrSlug) {
  if (typeof idOrSlug === 'number') return hydrate(db.prepare('SELECT * FROM store_products WHERE id = ?').get(idOrSlug));
  const s = String(idOrSlug || '');
  const bySlug = getProductBySlug(s);
  if (bySlug || !/^\d+$/.test(s)) return bySlug;
  return hydrate(db.prepare('SELECT * FROM store_products WHERE id = ?').get(Number(s)));
}

const SORTS = {
  manual: 'sort, id',
  new: 'id DESC',
  'price-asc': 'price, id',
  'price-desc': 'price DESC, id',
  name: 'title COLLATE NOCASE, id',
  featured: 'featured DESC, sort, id',
  updated: 'updated_at DESC, id DESC'
};

const HAS_VARIANTS = 'EXISTS (SELECT 1 FROM store_variants v WHERE v.product_id = store_products.id)';

/**
 * @param {object} opts
 *   status     'active' (default) | 'hidden' | 'draft' | 'all'
 *   shelf      a shelf AND its children; `shelfExact: true` for that shelf alone
 *   tag        one tag, exact (A–Z case does not matter)
 *   brand      one brand, exact (A–Z case does not matter)
 *   featured   true → only the featured
 *   stock      'out' (nothing left to sell) | 'low' (at or under the store's lowStock) — the admin's filter
 *   q          a word in the title, id, summary, brand, barcode or tags
 *   sort       manual | new | price-asc | price-desc | name | featured | updated
 *   limit      default 500 — the export, the plan and the page sync pass a
 *              ceiling of their own so no product is ever left out of them
 *   exclude    a slug to leave out
 */
function listProducts(opts = {}) {
  const where = [];
  const args = [];
  const status = opts.status || 'active';
  if (status !== 'all') { where.push('status = ?'); args.push(status); }
  if (opts.shelf) {
    const family = opts.shelfExact ? [String(opts.shelf)] : shelfFamily(opts.shelf);
    where.push(`shelf IN (${family.map(() => '?').join(', ')})`);
    args.push(...family);
  }
  if (opts.exclude) { where.push('slug != ?'); args.push(String(opts.exclude)); }
  if (opts.tag) {
    // the CASE keeps json_each away from a row whose tags are not JSON (it
    // would fail the whole query, and WHERE terms have no promised order)
    where.push("EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(store_products.tags) THEN store_products.tags ELSE '[]' END) WHERE lower(json_each.value) = lower(?))");
    args.push(String(opts.tag).trim());
  }
  if (opts.brand) { where.push('lower(brand) = lower(?)'); args.push(String(opts.brand).trim()); }
  if (truthy(opts.featured)) where.push('featured = 1');
  if (opts.stock === 'out') {
    where.push(`((NOT ${HAS_VARIANTS} AND stock IS NOT NULL AND stock <= 0) OR (${HAS_VARIANTS} AND NOT EXISTS (` +
      'SELECT 1 FROM store_variants v WHERE v.product_id = store_products.id AND (v.stock IS NULL OR v.stock > 0))))');
  } else if (opts.stock === 'low') {
    const low = require('./settings').loadSettings().lowStock;
    if (!low) {
      where.push('0');
    } else {
      where.push(`((NOT ${HAS_VARIANTS} AND stock > 0 AND stock <= ?) OR EXISTS (` +
        'SELECT 1 FROM store_variants v WHERE v.product_id = store_products.id AND v.stock > 0 AND v.stock <= ?))');
      args.push(low, low);
    }
  }
  if (opts.q) {
    where.push('(title LIKE ? OR slug LIKE ? OR summary LIKE ? OR brand LIKE ? OR barcode LIKE ? OR tags LIKE ?)');
    const like = '%' + String(opts.q).slice(0, 80) + '%';
    args.push(like, like, like, like, like, like);
  }
  // its OWN keys only: "constructor" is a member of every object, and what
  // it found there went into the query as text
  const order = Object.prototype.hasOwnProperty.call(SORTS, opts.sort) ? SORTS[opts.sort] : SORTS.manual;
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 500, 1), 100000);
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
  const title = line(src.title, 120);
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

  // a number that is not a whole number is said, never guessed — and for a
  // stock the sentence says what "left out" means: nothing is counted
  const notWhole = (what, then) => (raw) => warnings.push(`${what} של "${title || slug}" אינו מספר שלם (${clip(raw, 20)}) — ${then || 'הושמט'}`);

  const tagged = cleanTags(src.tags);
  if (tagged.over) warnings.push(`למוצר "${title || slug}" יותר מ-${MAX_TAGS} תגיות — נשמרו הראשונות`);

  const barcodeTyped = clip(src.barcode, 80).replace(/\s+/g, '');
  const barcode = barcodeTyped.replace(/[^0-9A-Za-z-]/g, '').slice(0, 40);
  if (barcode !== barcodeTyped) warnings.push(`הברקוד של "${title || slug}" נוקה — ספרות, אותיות לטיניות ומקף בלבד (עד 40 תווים)`);

  // the owner's cost: money like the price (a typed major string, or integer minor units)
  let cost = null;
  if (src.cost !== undefined && src.cost !== null && src.cost !== '') {
    const c = priceOf(src.cost);
    if (Number.isFinite(c)) cost = c;
    else warnings.push(`מחיר העלות של "${title || slug}" אינו תקין — הושמט`);
  }

  const variants = [];
  const seen = new Set();
  const rawVariants = Array.isArray(src.variants) ? src.variants.slice(0, MAX_VARIANTS) : [];
  if (Array.isArray(src.variants) && src.variants.length > MAX_VARIANTS) {
    warnings.push(`למוצר "${title || slug}" יותר מ-${MAX_VARIANTS} אפשרויות — נשמרו הראשונות`);
  }
  rawVariants.forEach((v, i) => {
    if (!v || typeof v !== 'object') return;
    const label = line(v.label || v.name || v.code, 60);
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
    variants.push({ code, label, price: vPrice, stock: intOrNull(v.stock, 0, 1000000, notWhole(`המלאי של האפשרות "${label}"`, 'נקלטה בלי ספירת מלאי')), sort: i });
  });

  if (errors.length) return { product: null, variants: [], errors, warnings };
  return {
    product: {
      slug,
      title,
      summary: line(src.summary, 200),
      description: clip(src.description, 8000),
      price,
      compareAt,
      // with options, stock is counted per option — a product-level number
      // would be a second truth nobody sells from
      stock: variants.length ? null : intOrNull(src.stock, 0, 1000000, notWhole('המלאי', 'נקלט בלי ספירת מלאי')),
      images,
      shelf,
      badge: line(src.badge, 24),
      status,
      delivery: src.delivery === undefined ? true : !(src.delivery === false || src.delivery === 'false' || src.delivery === 0 || src.delivery === '0'),
      // empty or 0 is "no limit" (what the field's own hint says), never "one per order"
      maxPerOrder: intOrNull(src.maxPerOrder, 0, 999, notWhole('המקסימום להזמנה')) || null,
      sort: intOrNull(src.sort, -100000, 100000) || 0,
      brand: line(src.brand, 60),
      tags: tagged.tags,
      featured: truthy(src.featured),
      barcode,
      weight: intOrNull(src.weight, 0, 1000000, notWhole('המשקל')),
      cost,
      seoTitle: line(src.seoTitle, 70),
      seoDescription: line(src.seoDescription, 160)
    },
    variants,
    errors,
    warnings
  };
}

/**
 * Tags as a person gives them — an array, or one comma-separated string.
 * Trimmed, one line each, no doubles (case does not matter), order kept.
 * A comma always separates: the document and the CSV both write tags as one
 * comma-separated value, so a tag can never hold one.
 */
function cleanTags(input) {
  const raw = Array.isArray(input) ? input : [input];
  const tags = [];
  const seen = new Set();
  let over = false;
  for (const item of raw) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    for (const part of String(item).split(',')) {
      const tag = line(part, MAX_TAG_LEN);
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) continue;
      if (tags.length >= MAX_TAGS) { over = true; continue; }
      seen.add(key);
      tags.push(tag);
    }
  }
  return { tags, over };
}

/**
 * The one place that knows the product columns: the admin's door
 * (create/update) and the document's apply both write through it, so a new
 * column can never reach one door and miss the other.
 *
 * `cost` is written only when the caller says so. The document cannot carry
 * a cost, so its apply — and every undo and site-package import, which are
 * applies — must leave the column exactly as it was.
 * @returns {number} the product's id
 */
function writeProductRow(p, existingId, opts = {}) {
  const cols = {
    title: p.title, summary: p.summary, description: p.description, price: p.price, compare_at: p.compareAt,
    stock: p.stock, images: JSON.stringify(p.images || []), shelf: p.shelf, badge: p.badge, status: p.status,
    delivery: p.delivery ? 1 : 0, max_per_order: p.maxPerOrder, sort: p.sort || 0,
    brand: p.brand || '', tags: JSON.stringify(p.tags || []), featured: p.featured ? 1 : 0, barcode: p.barcode || '',
    weight: p.weight === undefined ? null : p.weight, seo_title: p.seoTitle || '', seo_description: p.seoDescription || ''
  };
  if (opts.cost) cols.cost = p.cost === undefined ? null : p.cost;
  const keys = Object.keys(cols);
  const values = keys.map((k) => cols[k]);
  if (existingId) {
    db.prepare(`UPDATE store_products SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...values, existingId);
    return existingId;
  }
  const r = db.prepare(`INSERT INTO store_products (slug, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`)
    .run(p.slug, ...values);
  return Number(r.lastInsertRowid);
}

function writeVariants(productId, variants) {
  db.prepare('DELETE FROM store_variants WHERE product_id = ?').run(productId);
  const ins = db.prepare('INSERT INTO store_variants (product_id, code, label, price, stock, sort) VALUES (?, ?, ?, ?, ?, ?)');
  variants.forEach((v, i) => ins.run(productId, v.code, v.label, v.price, v.stock, i));
}

/** A product named a shelf nobody made yet: it is created top-level, last in the order, named after its slug. */
function ensureShelf(slug) {
  if (!slug) return;
  if (!shelfRow(slug)) {
    db.prepare('INSERT INTO store_shelves (slug, label, sort) VALUES (?, ?, ?)').run(slug, slug.replace(/-/g, ' '), nextShelfSort());
  }
}

const PRICE_ZERO = 'המחיר הוא 0 — בכוונה?';

function insertProduct(input, sayTaken) {
  const n = normalizeProduct(input);
  if (n.errors.length) { const e = new Error(n.errors.join(' · ')); e.errors = n.errors; throw e; }
  const p = n.product;
  const warnings = n.warnings.slice();
  const asked = p.slug;
  const sortSent = !!input && input.sort !== undefined && input.sort !== null && input.sort !== '';
  let id;
  db.transaction(() => {
    p.slug = uniqueSlug(p.slug, null);
    // a new product goes LAST in the owner's order — a default of 0 put it
    // second, between products a document had numbered 0 and 1
    if (!sortSent) p.sort = db.prepare('SELECT COALESCE(MAX(sort), -10) + 10 AS n FROM store_products').get().n;
    ensureShelf(p.shelf);
    id = writeProductRow(p, null, { cost: true });
    writeVariants(id, n.variants);
  })();
  if (sayTaken && p.slug !== asked) warnings.push(`המזהה "${asked}" תפוס — נשמר כ-"${p.slug}"`);
  if (p.price === 0) warnings.push(PRICE_ZERO);
  return { product: getProduct(id), warnings };
}

/**
 * Create a product. A taken slug gets a -2/-3 suffix (never an overwrite) —
 * and the owner who asked for that slug is told which one they got.
 * @returns {{ product: object, warnings: string[] }}
 */
function createProduct(input) {
  const src = input && typeof input === 'object' ? input : {};
  return insertProduct(input, !!(src.slug || src.sku || src.id));
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
    brand: existing.brand, tags: existing.tags, featured: existing.featured, barcode: existing.barcode,
    weight: existing.weight, cost: existing.cost, seoTitle: existing.seoTitle, seoDescription: existing.seoDescription,
    variants: existing.variants,
    ...(input || {}),
    slug: existing.slug
  };
  const n = normalizeProduct(merged);
  if (n.errors.length) { const e = new Error(n.errors.join(' · ')); e.errors = n.errors; throw e; }
  const p = n.product;
  db.transaction(() => {
    ensureShelf(p.shelf);
    writeProductRow(p, existing.id, { cost: true });
    writeVariants(existing.id, n.variants);
  })();
  const warnings = n.warnings.slice();
  if (p.price === 0) warnings.push(PRICE_ZERO);
  return { product: getProduct(existing.id), warnings };
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
  // every field travels with the copy (the owner's cost too) — except the
  // star: a draft copy is not one of the shop's featured products. The
  // "-copy" id is ours, so a taken one is not something to tell the owner.
  return insertProduct({
    ...p,
    slug: p.slug + '-copy',
    title: p.title + ' (עותק)',
    status: 'draft',
    featured: false,
    variants: p.variants
  }, false);
}

/** Set one stock number (a product, or one of its variants) — the admin's quick edit. */
function setStock(idOrSlug, variantCode, stock) {
  const p = getProduct(idOrSlug);
  if (!p) throw new Error('המוצר לא נמצא');
  // empty turns counting off; "12.5" or "many" is a typo, and a typo must
  // not quietly turn counting off
  let typo = false;
  const val = intOrNull(stock, 0, 1000000, () => { typo = true; });
  if (typo) throw new Error('כמות המלאי צריכה להיות מספר שלם');
  if (variantCode) {
    const r = db.prepare('UPDATE store_variants SET stock = ? WHERE product_id = ? AND code = ?').run(val, p.id, String(variantCode));
    if (!r.changes) throw new Error('האפשרות לא נמצאה');
  } else {
    db.prepare('UPDATE store_products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(val, p.id);
  }
  return getProduct(p.id);
}

function idList(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))];
}

/**
 * One action on many products, in one transaction — the list screen's
 * checkboxes. `action` is exactly one of
 *   { status } · { shelf } ('' = no shelf) · { featured: boolean } ·
 *   { addTag } · { removeTag } · { delete: true }
 * Unknown ids are skipped; a product the action would not change is not
 * touched (and not reported). The caller runs afterProductChange for each
 * product in `products` and retires the page of each slug in `deleted`.
 * @returns {{ changed: number, products: object[], deleted: string[] }}
 */
function bulkUpdate(ids, action) {
  const a = action && typeof action === 'object' ? action : {};
  const asked = ['delete', 'status', 'shelf', 'featured', 'addTag', 'removeTag'].filter((k) => a[k] !== undefined);
  if (asked.length !== 1 || (asked[0] === 'delete' && a.delete !== true)) throw new Error('הפעולה אינה מוכרת');
  let change;
  if (a.status !== undefined) {
    if (!STATUSES.includes(a.status)) throw new Error('סטטוס לא מוכר');
    change = (p) => (p.status === a.status ? null : { status: a.status });
  } else if (a.shelf !== undefined) {
    const raw = String(a.shelf == null ? '' : a.shelf).trim();
    const shelf = raw ? (isSlug(raw) ? raw : slugify(raw)) : '';
    if (raw && !shelfRow(shelf)) throw new Error('הקטגוריה לא נמצאה');
    change = (p) => (p.shelf === shelf ? null : { shelf });
  } else if (a.featured !== undefined) {
    const want = truthy(a.featured);
    change = (p) => (p.featured === want ? null : { featured: want ? 1 : 0 });
  } else if (a.addTag !== undefined) {
    const add = cleanTags(a.addTag).tags;
    if (!add.length) throw new Error('חסרה תגית');
    change = (p) => {
      const have = new Set(p.tags.map((t) => t.toLowerCase()));
      const next = p.tags.concat(add.filter((t) => !have.has(t.toLowerCase()))).slice(0, MAX_TAGS);
      return next.length === p.tags.length ? null : { tags: JSON.stringify(next) };
    };
  } else if (a.removeTag !== undefined) {
    const drop = new Set(cleanTags(a.removeTag).tags.map((t) => t.toLowerCase()));
    if (!drop.size) throw new Error('חסרה תגית');
    change = (p) => {
      const next = p.tags.filter((t) => !drop.has(t.toLowerCase()));
      return next.length === p.tags.length ? null : { tags: JSON.stringify(next) };
    };
  }
  const touched = [];
  const deleted = [];
  db.transaction(() => {
    for (const id of idList(ids)) {
      const p = getProduct(id);
      if (!p) continue;
      if (a.delete === true) {
        db.prepare('DELETE FROM store_products WHERE id = ?').run(p.id);
        deleted.push(p.slug);
        continue;
      }
      const patch = change(p);
      if (!patch) continue;
      const keys = Object.keys(patch);
      db.prepare(`UPDATE store_products SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...keys.map((k) => patch[k]), p.id);
      touched.push(p.id);
    }
  })();
  return { changed: touched.length + deleted.length, products: touched.map((id) => getProduct(id)), deleted };
}

/** The owner's order for the products given: `sort` = index × 10 (room to slip one in between). */
function reorderProducts(idsInOrder) {
  const set = db.prepare('UPDATE store_products SET sort = ? WHERE id = ?');
  let changed = 0;
  db.transaction(() => { idList(idsInOrder).forEach((id, i) => { changed += set.run(i * 10, id).changes; }); })();
  return { changed };
}

/**
 * Cost prices by SKU — the CSV import's second step. The document cannot
 * carry a cost (see writeProductRow), so the import hands them here once
 * its document has landed.
 * @param {{ [sku: string]: number|null }} costs  integer minor units; null clears
 * @returns {{ changed: number }}
 */
function setCosts(costs) {
  const src = costs && typeof costs === 'object' ? costs : {};
  const set = db.prepare('UPDATE store_products SET cost = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ? AND cost IS NOT ?');
  let changed = 0;
  db.transaction(() => {
    for (const [slug, v] of Object.entries(src)) {
      if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= money.MAX_MINOR)) continue;
      changed += set.run(v, slug, v).changes;
    }
  })();
  return { changed };
}

function tally(values, key) {
  const seen = new Map();
  for (const v of values) {
    const k = asciiLower(v);
    const hit = seen.get(k);
    if (hit) hit.count++;
    else seen.set(k, { [key]: v, count: 1 });
  }
  return [...seen.values()].sort((x, y) => y.count - x.count || (x[key] < y[key] ? -1 : x[key] > y[key] ? 1 : 0));
}

/** Every brand in the catalog (products of any status) with how many carry it — most used first. */
function listBrands() {
  return tally(db.prepare("SELECT brand FROM store_products WHERE brand != '' ORDER BY id").all().map((r) => r.brand), 'brand');
}

/** Every tag in the catalog (products of any status) with how many carry it — most used first. */
function listTags() {
  const all = [];
  for (const r of db.prepare("SELECT tags FROM store_products WHERE tags != '[]' ORDER BY id").all()) all.push(...tagsOf(r.tags));
  return tally(all, 'tag');
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
  const path = p.shelf ? shelfPath(p.shelf) : [];
  const shelf = path.length ? path[path.length - 1] : null;
  const onSale = !hasVariants && !!p.compareAt && p.compareAt > p.price;
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
    variants,
    // v2.69 — everything above is what the cart, the quote and the checkout
    // already read, untouched. `cost` is the owner's and is NOT here.
    brand: p.brand || '',
    tags: p.tags || [],
    featured: !!p.featured,
    barcode: p.barcode || '',
    weight: p.weight === undefined ? null : p.weight,
    salePercent: onSale ? Math.min(99, Math.max(1, Math.round((p.compareAt - p.price) / p.compareAt * 100))) : null,
    shelfPath: path,
    // own shelf + its parent: a parent's chip shows the children's products too
    shelves: p.shelf ? [p.shelf].concat(path.length > 1 ? [path[0].slug] : []) : [],
    seoTitle: p.seoTitle || '',
    seoDescription: p.seoDescription || ''
  };
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  MAX_QTY,
  MAX_TAGS,
  MAX_IMAGES,
  MAX_VARIANTS,
  slugify,
  isSlug,
  isWhole,
  statusOf,
  cleanImage,
  cleanTags,
  listShelves,
  getShelf,
  saveShelf,
  deleteShelf,
  reorderShelves,
  shelfFamily,
  shelfPath,
  shelfFields,
  writeShelfRow,
  listBrands,
  listTags,
  bulkUpdate,
  reorderProducts,
  setCosts,
  writeProductRow,
  listProducts,
  countProducts,
  getProduct,
  getProductBySlug,
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
