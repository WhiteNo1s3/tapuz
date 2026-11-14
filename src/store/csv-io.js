'use strict';

/**
 * The catalog ⇄ a spreadsheet (v2.69).
 *
 *   exportCsv()           every product as one row — what Excel and Sheets open
 *   csvToDocument(text)   a sheet → a MERGE <bent-store> document
 *
 * ONE write path. An imported sheet is not written to the database from
 * here: it becomes a `<bent-store mode="merge">` document, and that goes
 * through the door every paste goes through — preview, backup, apply, undo.
 * So a bad import is undone the way a bad paste is, and a sheet can never
 * hide a product (a merge only adds and updates).
 *
 * What a sheet says, the way a person expects a spreadsheet to behave:
 *   - a COLUMN the file does not have leaves that field alone;
 *   - a cell that is there and empty clears its field — except the price,
 *     the status and the yes/no cells, where "empty" can only mean "as it
 *     is", and the stock, where empty is "not counted";
 *   - a row is matched to a product by its `sku`; with no sku, by the id
 *     its title makes.
 *
 * `cost` is the owner's number and the document cannot carry it (see
 * catalog.writeProductRow), so costs come back beside the document: the
 * caller applies them with catalog.setCosts(costs) once the apply landed.
 *
 * Writing is src/csv.js — the repo's ONE CSV writer (BOM, CRLF, every cell
 * quoted, the formula guard). Reading is the small RFC-4180 reader below.
 */

const { csvTable } = require('../csv');
const dialect = require('../bentml/store-dialect');
const money = require('./money');
const catalog = require('./catalog');

const HEAD = [
  'sku', 'title', 'price', 'compare_at', 'cost', 'stock', 'category', 'brand', 'tags', 'status', 'featured',
  'barcode', 'weight', 'badge', 'summary', 'description', 'image', 'images', 'delivery', 'max_per_order',
  'seo_title', 'seo_description', 'variants'
];
const MAX_ROWS = dialect.MAX_PRODUCTS;
const MAX_BYTES = 2 * 1024 * 1024;
const EVERYTHING = 100000;

// What a column may be called. Our own header, the Hebrew a shop owner
// types, and the names Shopify and WooCommerce export — so a sheet that
// came from another shop opens without renaming a thing. `sale` is Woo's
// "Sale price" (see rowPrices); `skip` is a column we know and do not read.
//
// The ORDER inside a list is a preference: when a sheet has two columns for
// one field, the earlier name wins wherever it sits in the file. A Woo
// export opens with "ID" and "Type" (a row number, and "simple") long before
// its "SKU" and "Categories" — those must not become the SKU and the shelf.
const COLUMNS = {
  sku: ['sku', 'מזהה', 'מק"ט', 'מק״ט', 'מקט', 'handle', 'slug', 'id'],
  title: ['title', 'שם', 'שם המוצר', 'כותרת', 'name', 'product name'],
  price: ['price', 'מחיר', 'regular price', 'variant price'],
  sale: ['sale price', 'מחיר מבצע'],
  compare_at: ['compare at', 'מחיר לפני', 'was', 'compare at price', 'variant compare at price'],
  cost: ['cost', 'עלות', 'מחיר עלות', 'cost price', 'cost per item'],
  stock: ['stock', 'מלאי', 'qty', 'quantity', 'inventory', 'variant inventory qty'],
  category: ['category', 'קטגוריה', 'מדף', 'shelf', 'categories', 'product category', 'product type', 'type'],
  brand: ['brand', 'מותג', 'יצרן', 'vendor', 'manufacturer'],
  tags: ['tags', 'תגיות'],
  status: ['status', 'סטטוס', 'published'],
  featured: ['featured', 'מומלץ', 'is featured?'],
  barcode: ['barcode', 'ברקוד', 'gtin', 'ean', 'upc', 'variant barcode'],
  weight: ['weight', 'משקל', 'grams', 'variant grams', 'weight (g)'],
  weight_kg: ['weight (kg)'],
  badge: ['badge', 'תווית'],
  summary: ['summary', 'תקציר', 'short description'],
  description: ['description', 'תיאור', 'body'],
  description_html: ['body (html)'],
  image: ['image', 'תמונה', 'image src'],
  images: ['images', 'תמונות'],
  delivery: ['delivery', 'משלוח', 'requires shipping', 'variant requires shipping'],
  max_per_order: ['max per order', 'max', 'מקסימום להזמנה'],
  seo_title: ['seo title', 'meta title'],
  seo_description: ['seo description', 'meta description'],
  variants: ['variants', 'אפשרויות'],
  skip: ['variant sku']
};
// (prototype-less: a header or a cell that says "constructor" must find nothing)
const COLUMN_OF = Object.create(null);
for (const [key, names] of Object.entries(COLUMNS)) names.forEach((n, rank) => { COLUMN_OF[n] = { key, rank }; });

// (what a status cell may say lives in catalog.statusOf — the document door reads the same words)
const YES = new Set(['true', '1', 'yes', 'on', 'y', 'כן']);
const NO = new Set(['false', '0', 'no', 'off', 'n', 'לא']);

const fold = (s) => String(s == null ? '' : s).trim().toLowerCase();

// ── export ─────────────────────────────────────────────────────────────

/**
 * A shelf as the `category` cell names it: its label (what the owner reads
 * and types), "parent > child" for a child. A label two shelves share, or
 * one that could be mistaken for another shelf's id, is written as the id
 * instead — the cell must lead back to exactly one shelf.
 */
function categoryNamer(shelves) {
  const bySlug = new Map(shelves.map((s) => [s.slug, s]));
  const uses = Object.create(null);
  for (const s of shelves) uses[fold(s.label)] = (uses[fold(s.label)] || 0) + 1;
  const name = (s) => {
    const key = fold(s.label);
    const clear = uses[key] === 1 && !/[>,]/.test(s.label) && (!bySlug.has(key) || key === s.slug);
    return clear ? s.label : s.slug;
  };
  return (slug) => {
    const s = bySlug.get(slug);
    if (!s) return slug || '';
    const up = s.parent ? bySlug.get(s.parent) : null;
    return up ? name(up) + ' > ' + name(s) : name(s);
  };
}

// an option's code or label may hold the cell's own separators
const packPart = (s) => String(s == null ? '' : s).replace(/[%|;]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const unpackPart = (s) => String(s == null ? '' : s).replace(/%(25|7C|3B)/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));

/** The whole catalog as CSV: one row a product, money in major units ("89.90"). */
function exportCsv() {
  const categoryOf = categoryNamer(catalog.listShelves());
  const m = (minor) => (minor === null || minor === undefined ? '' : money.fromMinor(minor));
  const rows = catalog.listProducts({ status: 'all', sort: 'manual', limit: EVERYTHING }).map((p) => [
    p.slug,
    p.title,
    m(p.price),
    p.compareAt ? m(p.compareAt) : '',
    m(p.cost),
    p.variants.length || p.stock === null || p.stock === undefined ? '' : String(p.stock),
    categoryOf(p.shelf),
    p.brand,
    p.tags.join(', '),
    p.status,
    p.featured ? 'true' : 'false',
    p.barcode,
    p.weight === null || p.weight === undefined ? '' : String(p.weight),
    p.badge,
    p.summary,
    p.description,
    p.images[0] || '',
    p.images.slice(1).join(' '),
    p.delivery ? 'true' : 'false',
    p.maxPerOrder ? String(p.maxPerOrder) : '',
    p.seoTitle,
    p.seoDescription,
    p.variants.map((v) => [
      packPart(v.code), packPart(v.label), m(v.price), v.stock === null || v.stock === undefined ? '' : String(v.stock)
    ].join('|')).join(';')
  ]);
  return csvTable(HEAD, rows);
}

// ── read ───────────────────────────────────────────────────────────────

/** Comma, semicolon or tab — whichever the header line uses most (outside quotes). */
function sniffDelimiter(src) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && counts[ch] !== undefined) counts[ch]++;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/**
 * RFC 4180: quoted cells, a doubled quote inside one, line breaks inside
 * quotes. Each record remembers the file line it STARTS on, so a problem
 * is reported where the owner will look for it. Blank lines are skipped.
 * @returns {Array<{ line: number, cells: string[] }>}
 */
function readCsv(src, delimiter) {
  const out = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let startLine = 1;
  const endCell = () => { cells.push(cell); cell = ''; wasQuoted = false; };
  const endRecord = () => {
    endCell();
    if (cells.length > 1 || cells[0].trim() !== '') out.push({ line: startLine, cells });
    cells = [];
    startLine = line;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        if (ch === '\n' || (ch === '\r' && src[i + 1] !== '\n')) line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '' && !wasQuoted) { quoted = true; wasQuoted = true; continue; }
    if (ch === delimiter) { endCell(); continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      line++;
      endRecord();
      continue;
    }
    cell += ch;
  }
  if (cell !== '' || cells.length) endRecord();
  return out;
}

/**
 * A cell as it was typed. src/csv.js puts ONE apostrophe in front of a cell
 * that starts with = + - @ (a tab, a line break) so a spreadsheet never runs
 * it as a formula; exactly that one character comes back off here, so an
 * export → import is lossless.
 */
function cellText(v) {
  const s = String(v == null ? '' : v);
  return (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s).trim();
}

/** A header cell → which field it is and how much we prefer that name ({ key, rank }), or null. */
function headerOf(h) {
  const name = cellText(h).toLowerCase().replace(/[_\s]+/g, ' ').trim();
  return COLUMN_OF[name] || null;
}

/** Shopify's "Body (HTML)" as the plain text a description is here: paragraphs and breaks become lines, tags go. */
function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// ── import ─────────────────────────────────────────────────────────────

/**
 * Regular / sale price, the way WooCommerce writes a discount: when both
 * are there and the sale is lower, the sale IS the price and the regular
 * one is what it was. Otherwise the price is the price.
 */
function rowPrices(price, sale) {
  const p = money.toMinor(price);
  const s = money.toMinor(sale);
  if (Number.isFinite(p) && Number.isFinite(s) && s < p) return { price: sale, was: price };
  return { price, was: null };
}

/**
 * A CSV → a merge document.
 * @returns {{ ok: boolean, source: string, count: number, costs: Object<string, number>,
 *             errors: Array<{line:number, message:string}>, warnings: Array<{line:number, message:string}> }}
 *   `source` is a <bent-store mode="merge"> document for planDocument /
 *   applyDocument — pass them `{ trusted: true }`: it was written by the
 *   store's own serializer and this function already held the sheet to its
 *   own limits. `costs` holds a row's cost (minor units) by SKU, only where
 *   the cost cell was filled.
 */
function csvToDocument(text) {
  const errors = [];
  const warnings = [];
  const fail = (message) => ({ ok: false, source: '', count: 0, costs: {}, errors: [{ line: 0, message }].concat(errors), warnings });

  let src = Buffer.isBuffer(text) ? text.toString('utf8') : String(text == null ? '' : text);
  if (Buffer.byteLength(src, 'utf8') > MAX_BYTES) return fail('הקובץ גדול מ-2MB — פצלו אותו לכמה קבצים');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  // Excel's own first line, "sep=;", names the delimiter outright
  let delimiter = null;
  let lineOffset = 0;
  const sep = /^sep=(.)\r?\n/i.exec(src);
  if (sep) { delimiter = sep[1]; src = src.slice(sep[0].length); lineOffset = 1; }
  if (!delimiter) delimiter = sniffDelimiter(src);

  const records = readCsv(src, delimiter);
  if (!records.length) return fail('הקובץ ריק');
  const at = {};
  const rankOf = {};
  const strangers = [];
  records[0].cells.forEach((raw, i) => {
    const col = headerOf(raw);
    if (!col) { const name = cellText(raw); if (name) strangers.push(name); return; }
    if (col.key === 'skip') return;
    if (at[col.key] === undefined || col.rank < rankOf[col.key]) { at[col.key] = i; rankOf[col.key] = col.rank; }
  });
  if (at.sku === undefined && at.title === undefined) {
    return fail('בשורת הכותרת חסרה עמודת מזהה (sku) או שם (title) — אי אפשר לדעת איזה מוצר כל שורה מתארת');
  }
  if (strangers.length) warnings.push({ line: 1 + lineOffset, message: 'עמודות שלא נקראו: ' + strangers.slice(0, 12).join(', ') });
  // a sheet saved in an older encoding arrives with its Hebrew already lost
  if (src.includes(String.fromCharCode(0xfffd))) {
    warnings.push({ line: 0, message: 'נראה שהקובץ אינו בקידוד UTF-8 — אותיות עלולות להשתבש. שמרו אותו כ-"CSV UTF-8" ונסו שוב' });
  }
  const rows = records.slice(1);
  if (rows.length > MAX_ROWS) return fail(`בקובץ ${rows.length} שורות — עד ${MAX_ROWS} בקובץ אחד. פצלו אותו`);

  // shelves: a cell names one by its label or its id; one nobody has yet is declared in the document.
  // "Men > Shirts" and "Women > Shirts" are two shelves: when the cell names a
  // parent, only a shelf UNDER that parent answers to the child's name — the
  // first "Shirts" found used to take every product, whichever parent it sat
  // under. A bare name still finds its shelf wherever it sits.
  const shelves = catalog.listShelves();
  const bySlug = new Map(shelves.map((s) => [s.slug, s]));
  const declared = [];
  const resolveShelf = (name, parent) => {
    const key = fold(name);
    const fits = (s) => !parent || (s.parent || '') === parent;
    if (bySlug.has(key) && fits(bySlug.get(key))) return bySlug.get(key);
    const sameLabel = [...bySlug.values()].filter((s) => fold(s.label) === key);
    const hit = sameLabel.find((s) => (s.parent || '') === (parent || '')) || (parent ? null : sameLabel[0]);
    if (hit) return hit;
    let slug = catalog.slugify(name);
    if (!slug) return null;
    if (bySlug.has(slug) && fits(bySlug.get(slug))) return bySlug.get(slug);
    // the plain id belongs to the other parent's shelf: this one's says whose it is
    if (bySlug.has(slug)) {
      const own = catalog.slugify(parent + '-' + name);
      slug = own;
      for (let n = 2; bySlug.has(slug) && !fits(bySlug.get(slug)); n++) slug = catalog.slugify(own.slice(0, 74) + '-' + n);
      if (bySlug.has(slug)) return bySlug.get(slug);
    }
    const made = { slug, label: name.slice(0, 60), parent: parent || '' };
    bySlug.set(slug, made);
    declared.push(dialect.markPresent({ id: made.slug, label: made.label, parent: made.parent }, ['id', 'label', 'parent']));
    return made;
  };

  const has = (key) => at[key] !== undefined;
  const products = [];
  const costs = {};
  const firstLine = new Map();
  for (const rec of rows) {
    const line = rec.line + lineOffset;
    const warn = (message) => warnings.push({ line, message });
    const cell = (key) => (has(key) ? cellText(rec.cells[at[key]]) : '');
    const title = cell('title');
    const skuTyped = cell('sku');
    if (has('title') && !title) { errors.push({ line, message: 'שורה בלי שם מוצר — דולגה' }); continue; }
    const lower = skuTyped.toLowerCase();
    const id = catalog.isSlug(lower) ? lower : (catalog.slugify(skuTyped || title) || (title ? 'product' : ''));
    if (!id) { errors.push({ line, message: 'שורה בלי מזהה ובלי שם — דולגה' }); continue; }
    // one product, one row: a SKU that comes back is skipped whole, BEFORE
    // anything of it is recorded — the document kept the first row's fields
    // while the cost beside it was the last row's
    if (firstLine.has(id)) { warn(`המזהה "${id}" כבר הופיע בשורה ${firstLine.get(id)} — השורה דולגה`); continue; }
    firstLine.set(id, line);

    const said = ['id'];
    const p = { id, variants: [] };
    if (has('title')) { p.title = title; said.push('title'); }

    // an empty price can only mean "as it is" — nothing sells for nothing by omission
    if (has('price') && cell('price')) {
      const prices = has('sale') ? rowPrices(cell('price'), cell('sale')) : { price: cell('price'), was: null };
      p.price = prices.price;
      said.push('price');
      if (prices.was !== null) { p.was = prices.was; said.push('was'); }
    }
    if (has('compare_at') && !said.includes('was')) { p.was = cell('compare_at'); said.push('was'); }
    // empty stock is "not counted"; a product with options counts per option
    if (has('stock')) { p.stock = cell('stock') || 'unlimited'; said.push('stock'); }

    if (has('category')) {
      // WooCommerce lists several ("A, A > B"); a product here sits on one — the first
      const first = (cell('category').split(',')[0] || '').trim();
      const parts = first.split('>').map((x) => x.trim()).filter(Boolean);
      if (parts.length > 2) warn(`הקטגוריה "${first}" עמוקה מרמה אחת — נקלטו שתי הרמות האחרונות`);
      const path = parts.slice(-2);
      let shelf = '';
      if (path.length === 2) {
        const up = resolveShelf(path[0], '');
        const own = resolveShelf(path[1], up ? up.slug : '');
        shelf = own ? own.slug : (up ? up.slug : '');
      } else if (path.length === 1) {
        const own = resolveShelf(path[0], '');
        shelf = own ? own.slug : '';
      }
      p.shelf = shelf;
      said.push('shelf');
    }

    for (const [key, attr, prop] of [
      ['brand', 'brand', 'brand'], ['tags', 'tags', 'tags'], ['barcode', 'barcode', 'barcode'], ['weight', 'weight', 'weight'],
      ['badge', 'badge', 'badge'], ['summary', 'summary', 'summary'], ['max_per_order', 'max', 'max'],
      ['seo_title', 'seo-title', 'seoTitle'], ['seo_description', 'seo-description', 'seoDescription'],
      ['description', 'description', 'description']
    ]) {
      if (has(key)) { p[prop] = cell(key); said.push(attr); }
    }
    // other shops' spellings of two of those: kilograms, and a description in HTML
    if (!has('weight') && has('weight_kg')) { p.weight = cell('weight_kg') ? cell('weight_kg') + 'kg' : ''; said.push('weight'); }
    if (!has('description') && has('description_html')) { p.description = htmlToText(cell('description_html')); said.push('description'); }

    if (has('status') && cell('status')) {
      const status = catalog.statusOf(cell('status'));
      if (status) { p.status = status; said.push('status'); } else warn(`סטטוס לא מוכר ("${cell('status')}") — נשאר כפי שהוא`);
    }
    for (const [key, attr] of [['featured', 'featured'], ['delivery', 'delivery']]) {
      if (!has(key) || !cell(key)) continue;
      const v = fold(cell(key));
      if (YES.has(v) || NO.has(v)) { p[attr] = YES.has(v) ? 'true' : 'false'; said.push(attr); } else warn(`ערך לא מוכר בעמודה ${key} ("${cell(key)}") — נשאר כפי שהוא`);
    }

    // pictures: `image` is the first, `images` the rest (spaces between; a
    // comma before the next address is read too — WooCommerce writes that)
    if (has('image') || has('images')) {
      const rest = cell('images').split(/\s+|,\s*(?=https?:\/\/|\/)/).filter(Boolean);
      if (has('image')) {
        p.image = cell('image');
        said.push('image');
        if (has('images')) { p.images = rest.join(' '); said.push('images'); }
      } else {
        p.image = rest[0] || '';
        p.images = rest.slice(1).join(' ');
        said.push('image', 'images');
      }
    }

    // options: code|label|price|stock;…  An empty cell leaves the product's options alone.
    if (has('variants') && cell('variants')) {
      for (const one of cell('variants').split(';')) {
        if (!one.trim()) continue;
        const [code, label, price, stock] = one.split('|').map((x) => (x || '').trim());
        if (!unpackPart(label || code)) { warn('אפשרות בלי שם דולגה'); continue; }
        p.variants.push(dialect.markPresent({
          id: unpackPart(code), label: unpackPart(label || code), price: price || '', stock: stock || 'unlimited'
        }, ['id', 'label', 'price', 'stock']));
      }
    }

    if (has('cost') && cell('cost')) {
      const cost = money.toMinor(cell('cost'));
      if (Number.isFinite(cost)) costs[id] = cost; else warn(`מחיר עלות לא תקין ("${cell('cost')}") — דולג`);
    }

    products.push(dialect.markPresent(p, said));
  }

  if (!products.length) {
    if (!errors.length) errors.push({ line: 0, message: 'אין בקובץ אף שורת מוצר' });
    return { ok: false, source: '', count: 0, costs: {}, errors, warnings };
  }
  const source = dialect.serializeStore({ mode: 'merge', shelves: declared, products });
  return { ok: true, source, count: products.length, costs, errors, warnings };
}

module.exports = { HEAD, MAX_ROWS, MAX_BYTES, exportCsv, csvToDocument, readCsv };
