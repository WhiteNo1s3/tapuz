'use strict';

/**
 * v2.69 QA — the page builder's list editor, its rows and its inspector.
 *
 * The bug this file exists for: the generated list editor asked "does any
 * item field hold a picture?" and then read only `item.src`. Products, cards,
 * carousel, timeline and related call their picture `image` — so every real
 * item counted as an empty slot, the editor showed "0 פריטים" with no fields
 * at all, and the button "🧹 נקה N משבצות ריקות" removed every item.
 *
 * public/admin-builder.js is a browser script that cannot be required, and a
 * regex over its text did not catch any of this. So the functions that decide
 * are kept small and pure, and this smoke LIFTS them out of the source (a
 * brace-matching reader), evaluates them, and runs them against the REAL
 * registry and a REAL catalog:
 *
 *   lists      which modules get thumbnails and which the field editor; a
 *              filled picture is never an empty slot; "clean" removes nothing
 *              real; a library pick lands under the module's own field name;
 *              every item field gets a control of its type
 *   rows       the ROW settings come from the registry; one column cap (6);
 *              removing a column moves its modules; a drop side reaches the
 *              column order through the page's direction
 *   pickers    the shelf / product pickers and the shop preview read a real
 *              catalog payload
 *   inspector  the look: .check-line, hints inside their field, no inline
 *              button margins, colours that can be cleared, align only where
 *              the registry declares it, nothing written on an idle blur
 *   image      link + align survive the source round trip
 *
 * Run: node scripts/smoke-builder-lists.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-builder-lists-'));

// The throwaway root has no site; the store's "nothing to export" notice is
// expected here.
const realWarn = console.warn;
console.warn = (...a) => { if (!/^\[export\] no published pages/.test(String(a[0]))) realWarn(...a); };

let failed = 0;
function ok(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + label);
  if (!cond) failed++;
}

const root = path.join(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'public', 'admin-builder.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin.css'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'public', 'admin-nav.js'), 'utf8');
const registry = require('../src/block-registry');

// ── the reader: one top-level function out of the builder's source ─────────

/** `function name(...) { ... }` as text, by matching braces. Strings and
 *  comments are skipped so a brace inside one cannot end the function early.
 *  (The lifted functions hold no regex literal — keep it that way.) */
function fnSource(name) {
  const start = builder.indexOf('function ' + name + '(');
  if (start === -1) return '';
  let i = builder.indexOf('{', start);
  let depth = 0;
  for (; i < builder.length; i++) {
    const ch = builder[i];
    const two = builder.substr(i, 2);
    if (two === '//') { i = builder.indexOf('\n', i); if (i === -1) return ''; continue; }
    if (two === '/*') { i = builder.indexOf('*/', i) + 1; if (i === 0) return ''; continue; }
    if (ch === '\'' || ch === '"') {
      for (i++; i < builder.length && builder[i] !== ch; i++) if (builder[i] === '\\') i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return builder.slice(start, i + 1);
  }
  return '';
}

const PURE = [
  'mediaFieldOf', 'listUsesThumbs', 'itemFieldKind', 'mediaSrcOf', 'filledMedia', 'pickedToItems',
  'splitSideIsBefore', 'rowHasRatio', 'removeColumnAt',
  'catalogOptions', 'shopPreviewList', 'shelvesPreviewList'
];
const sources = PURE.map(fnSource);
ok(sources.every(Boolean), 'the builder defines every pure function this smoke runs: ' +
  (PURE.filter((n, i) => !sources[i]).join(', ') || 'all ' + PURE.length));
let fx = {};
try {
  fx = new Function(sources.join('\n') + '\nreturn { ' + PURE.filter((n, i) => sources[i]).join(', ') + ' };')();
} catch (e) {
  ok(false, 'the lifted functions evaluate on their own (' + e.message + ')');
}
const has = (n) => typeof fx[n] === 'function';

// ── 1. lists ───────────────────────────────────────────────────────────────

/** Every list param of the registry: { type, name, fields }. */
const lists = [];
for (const b of registry.BLOCK_REGISTRY) {
  for (const p of (b.params || [])) {
    if (p.type === 'list') lists.push({ type: b.type, name: p.name, fields: p.itemFields || [] });
  }
}
const listOf = (type) => lists.find((l) => l.type === type);
ok(lists.length >= 25, 'the registry has its list params (' + lists.length + ')');

if (has('listUsesThumbs') && has('mediaFieldOf')) {
  const thumbs = lists.filter((l) => fx.listUsesThumbs(l.fields)).map((l) => l.type + '.' + l.name).sort();
  ok(thumbs.join() === 'gallery.images,logos.items',
    'thumbnail mode is for picture lists only — gallery and logos (got: ' + thumbs.join(', ') + ')');
  for (const type of ['products', 'cards', 'carousel', 'timeline', 'related', 'team', 'pricing']) {
    const l = listOf(type);
    ok(!!l && !fx.listUsesThumbs(l.fields) && l.fields.length > 1,
      type + ' gets the field editor (its ' + (l ? l.fields.length : 0) + ' fields can be typed)');
  }
  ok(fx.mediaFieldOf(listOf('gallery').fields) === 'src' && fx.mediaFieldOf(listOf('logos').fields) === 'src',
    'gallery and logos call their picture `src`');
  for (const type of ['products', 'cards', 'carousel', 'timeline', 'related']) {
    ok(fx.mediaFieldOf(listOf(type).fields) === 'image', type + ' calls its picture `image` — and the editor knows');
  }
  ok(fx.mediaFieldOf(listOf('pricing').fields) === '' && fx.mediaFieldOf([]) === '' && fx.mediaFieldOf(null) === '',
    'a list without a picture field has none (and no input crashes the reader)');
}

if (has('mediaSrcOf') && has('filledMedia') && has('mediaFieldOf')) {
  // three REAL product items — the module's own seed, what a fresh PRODUCTS
  // module holds the moment it is dropped on a page
  const seedItems = (registry.getBlockDef('products').seed || {}).items || [];
  const field = fx.mediaFieldOf(listOf('products').fields);
  ok(seedItems.length === 3 && seedItems.every((it) => it.image),
    'the products seed is three real items with pictures');
  ok(seedItems.every((it) => fx.mediaSrcOf(it, field) === it.image),
    'a filled `image` item is NOT an empty slot');
  ok(fx.filledMedia(seedItems, field).length === 3,
    '"נקה משבצות ריקות" on three real product items removes nothing');
  ok(fx.filledMedia(seedItems, 'src').length === 0,
    '(the old reading — `src` on a list of `image` items — is what emptied the list)');
  for (const type of ['cards', 'carousel', 'timeline', 'related']) {
    const f = fx.mediaFieldOf(listOf(type).fields);
    const items = [1, 2, 3].map((n) => ({ [f]: '/demo/tile-' + n + '.svg', title: 'פריט ' + n }));
    ok(fx.filledMedia(items, f).length === 3, type + ': three filled items survive a clean');
  }
  const gal = [{ src: '/a.jpg', alt: 'a' }, { src: '  ', alt: '' }, '', '/b.jpg', { alt: 'no picture' }];
  ok(fx.filledMedia(gal, 'src').length === 2 && fx.filledMedia(gal).length === 2,
    'a gallery clean still drops the truly empty slots (blank src, empty string, no src) and keeps the two pictures');
  ok(fx.mediaSrcOf(' /x.png ', 'image') === '/x.png' && fx.mediaSrcOf(null, 'image') === '' && fx.mediaSrcOf({ src: '/y.png' }) === '/y.png',
    'mediaSrcOf: a bare string is its own address; nothing is ""; no field name means `src`');
}

if (has('pickedToItems')) {
  const picked = [{ src: '/uploads/a.jpg', alt: 'a.jpg' }, { src: '/uploads/b.jpg', alt: 'b.jpg' }];
  const asProducts = fx.pickedToItems(picked, listOf('products').fields);
  ok(asProducts.length === 2 && asProducts[0].image === '/uploads/a.jpg' && !('src' in asProducts[0]) && !('alt' in asProducts[0]),
    'a library pick into PRODUCTS is written as { image } — the module\'s own field, no stray src/alt');
  for (const type of ['cards', 'carousel', 'timeline', 'related']) {
    const got = fx.pickedToItems(picked, listOf(type).fields);
    ok(got[1].image === '/uploads/b.jpg' && !('src' in got[1]), 'a library pick into ' + type + ' is written as { image }');
  }
  const asGallery = fx.pickedToItems(picked, listOf('gallery').fields);
  ok(asGallery[0].src === '/uploads/a.jpg' && asGallery[0].alt === 'a.jpg',
    'a library pick into GALLERY keeps { src, alt } (it has both fields)');
  ok(fx.pickedToItems(null, listOf('gallery').fields).length === 0, 'no pick → no items');
}

if (has('itemFieldKind')) {
  const kindOf = (type, field) => fx.itemFieldKind(listOf(type).fields.find((f) => f.name === field));
  ok(kindOf('pricing', 'highlighted') === 'checkbox', 'pricing.highlighted (boolean) is a checkbox, not a text box');
  ok(kindOf('form', 'required') === 'checkbox' && kindOf('pager', 'current') === 'checkbox', 'form.required and pager.current are checkboxes');
  ok(kindOf('form', 'type') === 'select', 'form.type (enum) is a select');
  ok(kindOf('progress', 'value') === 'number', 'progress.value (integer) is a number field');
  ok(kindOf('products', 'image') === 'media', 'products.image (media) is an address with a picker');
  ok(kindOf('features', 'description') === 'textarea' && kindOf('features', 'url') === 'url' && kindOf('stats', 'value') === 'text',
    'textarea / url / string keep their controls');
  const known = ['checkbox', 'select', 'number', 'media', 'textarea', 'url', 'text'];
  const every = lists.flatMap((l) => l.fields.map((f) => fx.itemFieldKind(f)));
  ok(every.length > 60 && every.every((k) => known.includes(k)), 'every item field in the registry (' + every.length + ') maps to a known control');
  ok(fx.itemFieldKind({ type: 'enum' }) === 'text' && fx.itemFieldKind(null) === 'text', 'an enum with no values, or no field, falls back to text');
}

// the editor itself, by source: thumbs only behind listUsesThumbs; the clean
// button only there; fields drawn by type; ↑ ↓ and a copy next to remove
const listEditor = fnSource('renderListParam');
const itemField = fnSource('renderItemField');
ok(/if \(listUsesThumbs\(fields\)\) \{/.test(listEditor) && !/hasMedia/.test(listEditor),
  'the list editor decides thumbnail mode through listUsesThumbs (the "any media field" switch is gone)');
ok(listEditor.indexOf('data-lp-clean') !== -1 && listEditor.indexOf('data-lp-clean') < listEditor.indexOf('fields.length === 1'),
  'the "clean empty slots" button exists only inside thumbnail mode');
ok(/mediaSrcOf\(im, mediaField\)/.test(listEditor), 'a slot is empty by the list\'s own picture field');
ok(/data-lp-up/.test(listEditor) && /data-lp-down/.test(listEditor) && /data-lp-dup/.test(listEditor) && /data-lp-del/.test(listEditor),
  'each item carries ↑ ↓, a copy and a remove');
ok(/var kind = itemFieldKind\(f\);/.test(itemField) && /data-lp-pick=/.test(itemField) && /type="number"/.test(itemField) && /<select /.test(itemField),
  'item fields are drawn by their type (checkbox / select / number / picture / textarea / url / text)');
ok(/filledMedia\(block\.data\[key\], listMediaField\(block\.type, key\)\)/.test(builder),
  'the clean handler judges "empty" by the list\'s own picture field');
ok(/block\.data\[key\]\.concat\(pickedToItems\(picked, listDef && listDef\.itemFields\)\)/.test(builder),
  'the multi-pick handler writes through pickedToItems');
ok(/list\.splice\(i - 1, 0, list\.splice\(i, 1\)\[0\]\)/.test(builder) && /list\.splice\(i \+ 1, 0, list\.splice\(i, 1\)\[0\]\)/.test(builder) &&
  /list\.splice\(i \+ 1, 0, copy\)/.test(builder),
  'move up / move down / copy are array splices');

// ── 2. rows ────────────────────────────────────────────────────────────────

const rowDef = registry.getBlockDef('columns');
const rowParams = (builder.match(/var ROW_PARAMS = \[([^\]]*)\];/) || ['', ''])[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
ok(rowParams.join() === 'gap,collapse,valign,width', 'the inspector names the four ROW settings: ' + rowParams.join(', '));
ok(rowParams.every((n) => (rowDef.params || []).some((p) => p.name === n && p.type === 'enum')),
  'each of them is a param the registry declares for ROW');
ok(/if \(ROW_PARAMS\.indexOf\(p\.name\) !== -1\) html \+= renderParamControl\(p, block\);/.test(builder),
  'the ROW panel renders them through renderParamControl (the data-key binder saves them)');
ok(/row\.style\.gap = gapPx \+ 'px';/.test(builder) && /ROW_GAP_PX = \{ none: 0, sm: \d+, md: \d+, lg: \d+ \}/.test(builder) &&
  /' valign-' \+ d\.valign/.test(builder),
  'the canvas row mirrors gap and valign');
ok(/\.columns-preview\.valign-center > \.column-pane > \.column-list/.test(css) && /\.columns-preview\.valign-bottom/.test(css) &&
  /\.columns-preview\.valign-stretch/.test(css), 'admin.css answers valign center / bottom / stretch on the canvas');

ok(/var MAX_ROW_COLUMNS = 6;/.test(builder), 'the column cap is ONE constant, and it is 6');
ok((builder.match(/MAX_ROW_COLUMNS/g) || []).length >= 6, 'the canvas +, the split drop, the inspector button and its handler all read it');
ok(!/\.length (<|>=) 4\b/.test(builder) && !/עד 4\)/.test(builder) && !/\(4 טורים\)/.test(builder),
  'no hard-coded 4 remains for the column cap (code or copy)');
ok(/2–6/.test(rowDef.hintHe || ''), 'the registry promises 2–6 columns');
ok(/cols-n-6/.test(fs.readFileSync(path.join(root, 'themes', 'default', 'css', 'main.css'), 'utf8')),
  'the site stylesheet answers a six-column row');
ok(/'<button type="button" class="btn secondary" data-col="' \+ i \+ '">\+ הוסף לטור ' \+ \(i \+ 1\) \+ '<\/button>'/.test(builder) &&
  !/data-col="0">/.test(builder) && !/data-col="1">/.test(builder),
  'an "add to column N" button is generated for EVERY column (not a hand-written two)');

if (has('removeColumnAt')) {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' };
  const cols = [{ blocks: [a] }, { blocks: [b, c] }, { blocks: [d] }];
  const ids = (r) => r.cols.map((col) => col.blocks.map((x) => x.id).join('+')).join(' | ');
  const mid = fx.removeColumnAt(cols, [1, 2, 1], 1);
  ok(ids(mid) === 'a+b+c | d' && mid.ratios.join(':') === '3:1' && mid.into === 0,
    'removing the middle column moves its modules into the column before it, with its share of the width');
  const first = fx.removeColumnAt(cols, [1, 2, 1], 0);
  ok(ids(first) === 'a+b+c | d' && first.ratios.join(':') === '3:1' && first.into === 0,
    'removing the FIRST column moves its modules to the front of the next one (reading order kept)');
  const last = fx.removeColumnAt(cols, [1, 2, 1], 2);
  ok(ids(last) === 'a | b+c+d' && last.ratios.join(':') === '1:3' && last.into === 1, 'removing the last column moves its modules to the end of the one before');
  ok(cols.length === 3 && cols[1].blocks.length === 2, 'the input is not mutated');
  for (const r of [mid, first, last]) {
    ok(r.cols.reduce((n, col) => n + col.blocks.length, 0) === 4, 'no module is ever dropped (4 in, 4 out)');
  }
  ok(ids(fx.removeColumnAt(cols, [1, 2, 1], 7)) === 'a | b+c | d' && ids(fx.removeColumnAt([{ blocks: [a] }], [1], 0)) === 'a',
    'an index that is not a column, or a one-column row, changes nothing');
}
ok(/panel\.querySelectorAll\('\[data-remove-col\]'\)/.test(builder) && /removeColumnFromRow\(block, parseInt\(btn\.dataset\.removeCol, 10\)\)/.test(builder) &&
  /var next = removeColumnAt\(cols, parseColumnRatios\(block\), index\);\s*block\.data\.columns = next\.cols;/.test(builder),
  '"הסרת טור" is wired: the handler replaces the columns with removeColumnAt\'s result');
ok(/if \(cols\.length <= MIN_ROW_COLUMNS \|\| index < 0/.test(builder) && /var MIN_ROW_COLUMNS = 2;/.test(builder),
  'a row never drops under two columns ("פרק עמודות" is the way to one)');
// seen in the browser at six columns: the name bar wrapped under its 22px cap
// and the remove control was cut off with the column's number
ok(/\(cols\.length >= DENSE_ROW_COLUMNS \? ' is-dense' : ''\)/.test(builder) &&
  /\.columns-preview > \.column-pane > \.column-head \{[^}]*white-space: nowrap[^}]*text-overflow: ellipsis/.test(css.replace(/\n/g, ' ')) &&
  /\.columns-preview\.is-dense > \.column-pane > \.column-head > \.container-badge \{ display: none; \}/.test(css) &&
  /\.column-remove \{[^}]*position: absolute[^}]*inset-inline-end: 0/.test(css.replace(/\n/g, ' ')),
  'a column\'s name bar is ONE line: the words are cut, the badge steps aside in a dense row, the remove control keeps its corner');

if (has('rowHasRatio')) {
  ok(fx.rowHasRatio({ data: { ratio: '65:35' } }) && fx.rowHasRatio({ data: { ratio: [2, 1] } }) &&
    !fx.rowHasRatio({ data: {} }) && !fx.rowHasRatio({ data: { ratio: '' } }) && !fx.rowHasRatio(null),
    'rowHasRatio tells a row with its own ratio from an equal split');
}
ok(/if \(hadRatio\) setColumnRatios\(block, ratios\.concat\(avg\)\);/.test(builder) && /if \(rowHadRatio\) setColumnRatios\(rowBlock, rowRatios\);/.test(builder),
  'adding a column never writes a ratio into a row that had none');

if (has('splitSideIsBefore')) {
  ok(fx.splitSideIsBefore('left', 'ltr') === true && fx.splitSideIsBefore('right', 'ltr') === false,
    'LTR page: a drop on the left lands BEFORE the target, on the right AFTER');
  ok(fx.splitSideIsBefore('left', 'rtl') === false && fx.splitSideIsBefore('right', 'rtl') === true,
    'Hebrew page: a drop on the LEFT lands AFTER the target — the column to its left on the published page');
}
ok(/var landsBefore = splitSideIsBefore\(hint\.side, pageDirection\);/.test(builder) && !/hint\.side === 'left' \? 0 : 1/.test(builder),
  'doSplitMove maps the side through the PAGE\'s direction (no physical left = index 0)');
ok(/if \(pageDirection === 'rtl'\) \{\s*handle\.style\.right = '100%';/.test(builder) &&
  /var towardsNext = pageDirection === 'rtl' \? -1 : 1;/.test(builder) && /row\.dir = pageDirection;/.test(builder),
  'the row, its resize handle and the drag sign are keyed on pageDirection');
ok(!/\.columns-preview \{[^}]*direction:/.test(css.replace(/\n/g, ' ')), 'admin.css no longer pins the canvas row to ltr');

// ── 3. the catalog pickers and the shop preview, on a real catalog ─────────

const store = require('../src/store');
const cat = store.catalog;
cat.saveShelf({ slug: 'candles', label: 'נרות' });
cat.saveShelf({ slug: 'soy', label: 'נרות סויה', parent: 'candles' });
cat.saveShelf({ slug: 'soap', label: 'סבונים' });
cat.saveShelf({ slug: 'backroom', label: 'מוסתרת', hidden: true });
cat.saveShelf({ slug: 'empty', label: 'ריקה' });
cat.createProduct({ title: 'נר לבנדר', slug: 'lavender', price: '89.90', shelf: 'soy', brand: 'נועה', tags: 'ריח,מתנה', stock: 3 });
cat.createProduct({ title: 'נר וניל', slug: 'vanilla', price: '120', shelf: 'candles', featured: true });
cat.createProduct({ title: 'סבון זית', slug: 'olive', price: '25', shelf: 'soap', tags: 'מתנה' });
cat.createProduct({ title: 'טיוטה', slug: 'draft-one', price: '10', shelf: 'soap', status: 'draft' });
cat.createProduct({ title: 'סודי', slug: 'hush', price: '10', shelf: 'backroom' });
// exactly what GET /admin/api/store/catalog answers (src/routes/store-admin.js)
const settings = store.settings.loadSettings();
const payload = {
  ok: true, open: settings.open, currency: settings.currency,
  shelves: cat.listShelves(),
  products: cat.listProducts({ status: 'all', sort: 'manual' }).map((p) => ({ ...cat.publicProduct(p, settings), status: p.status }))
};
ok(payload.products.length === 5 && payload.shelves.length === 5, 'a real catalog payload: 5 products, 5 categories');

if (has('catalogOptions')) {
  const shelf = fx.catalogOptions('shelf', payload, '');
  const labels = shelf.options.map((o) => o.value + '=' + o.label);
  ok(shelf.usable && labels[0] === '=כל המוצרים', 'the shelf picker opens with "all products"');
  ok(labels.join(' / ').indexOf('candles=נרות (2) / soy=— נרות סויה (1)') !== -1,
    'categories come as a tree: the child sits under its parent, indented, each with its count — ' + labels.slice(1, 3).join(' / '));
  ok(labels.some((l) => /^backroom=מוסתרת .* · מוסתרת$/.test(l)), 'a hidden category is offered but named as hidden');
  const parents = fx.catalogOptions('parent', payload, '').options.map((o) => o.value);
  ok(parents.join() === ',candles', 'the SHELVES parent picker offers the top level and the categories that have children');
  const sku = fx.catalogOptions('sku-required', payload, 'lavender');
  ok(sku.options[0].value === '' && sku.options[0].label === 'בחרו מוצר…' && sku.options.length === 6 &&
    sku.options.some((o) => o.value === 'lavender' && o.label === 'נר לבנדר — lavender'),
    'the product picker lists products by title + id');
  ok(sku.options.some((o) => o.value === 'draft-one' && / · לא פעיל$/.test(o.label)), 'a product that is not active is named as such');
  const missing = fx.catalogOptions('sku', payload, 'gone-product');
  ok(missing.options[missing.options.length - 1].value === 'gone-product' && missing.options[missing.options.length - 1].missing === true,
    'a value the catalog does not know stays in the list, named as missing — the control never hides what the page says');
  ok(fx.catalogOptions('shelf', { products: [] }, '').usable === false && fx.catalogOptions('sku', null, 'x').usable === false,
    'an empty store or a failed fetch is "not usable" — the text box stays');
}
ok(/if \(!res\.usable\) return;/.test(builder) && /input\.hidden = true;/.test(builder) &&
  /input\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/.test(builder),
  'the picker falls back to the text box, and otherwise writes THROUGH it (the one control the binder saves from)');
const pickers = (builder.match(/var CATALOG_PICKERS = \{([\s\S]*?)\};/) || ['', ''])[1];
ok(/'shop\.shelf': 'shelf'/.test(pickers) && /'shop\.exclude': 'sku'/.test(pickers) && /'shop\.skus': 'skus'/.test(pickers) &&
  /'buy\.sku': 'sku-required'/.test(pickers) && /'shelves\.parent': 'parent'/.test(pickers),
  'shop.shelf, shop.exclude, shop.skus, buy.sku and shelves.parent are catalog pickers');

if (has('shopPreviewList')) {
  const skus = (d) => fx.shopPreviewList(payload, d).map((p) => p.sku).join();
  ok(skus({}) === 'lavender,vanilla,olive,hush', 'the shop preview shows the active products, in catalog order (the draft is out)');
  ok(skus({ shelf: 'candles' }) === 'lavender,vanilla', 'a parent category shows its children\'s products too');
  ok(skus({ shelf: 'soy' }) === 'lavender', 'a child category shows its own');
  ok(skus({ limit: 2 }) === 'lavender,vanilla' && skus({ exclude: 'vanilla' }) === 'lavender,olive,hush', 'limit and exclude are honoured');
  ok(skus({ skus: 'olive, lavender ,nope' }) === 'olive,lavender', 'a hand-picked skus list is exactly those, in that order');
  ok(skus({ tag: 'מתנה' }) === 'lavender,olive' && skus({ brand: 'נועה' }) === 'lavender' && skus({ featured: true }) === 'vanilla',
    'tag, brand and featured select');
  ok(skus({ sort: 'price-asc' }) === 'hush,olive,lavender,vanilla' && skus({ sort: 'price-desc' }).split(',')[0] === 'vanilla',
    'the price sorts read minor units');
}
if (has('shelvesPreviewList')) {
  const tiles = (d) => fx.shelvesPreviewList(payload, d).map((s) => s.slug).join();
  ok(tiles({}) === 'candles,soap', 'the SHELVES preview: top-level categories that are visible and hold active products');
  ok(tiles({ parent: 'candles' }) === 'soy', 'with a parent: that category\'s children');
}
const shopHtml = fnSource('shopPreviewHtml');
for (const row of ['pv-shop-media', 'pv-badges', 'pv-shop-brand', 'pv-shop-name', 'pv-shop-price', 'pv-shop-note', 'pv-shop-btn']) {
  ok(shopHtml.indexOf(row) !== -1, 'the shop preview draws ' + row);
}
ok(['pv-shop-media', 'pv-shop-brand', 'pv-shop-name', 'pv-shop-price', 'pv-shop-note', 'pv-shop-btn']
  .map((r) => shopHtml.indexOf('"' + r)).every((at, i, all) => at !== -1 && (i === 0 || at > all[i - 1])),
  'in the storefront card\'s own order: picture, brand, title, price, stock note, button');
ok(/d\.media === 'portrait' \|\| d\.media === 'landscape'/.test(shopHtml) && /d\.fit === 'contain'/.test(shopHtml) &&
  /d\.justify === 'center'/.test(shopHtml) && /paramInt\('shop', 'columns'/.test(shopHtml) && /d\.sorter/.test(shopHtml) && /d\.search/.test(shopHtml),
  'and honours columns, media, fit, justify, search and sorter');
ok(/\.pv-shop-price \{[^}]*margin-top: auto/.test(css.replace(/\n/g, ' ')) && /\.pv-shop-name \{[^}]*min-height: 2\.6em/.test(css.replace(/\n/g, ' ')) &&
  /\.pv-shop-note \{[^}]*min-height/.test(css.replace(/\n/g, ' ')),
  'admin.css holds the level line: a two-line title box, a reserved note row, the price pushed to the bottom');
ok(/block\.type === 'shop' \|\| block\.type === 'shelves'/.test(builder) && fnSource('shelvesPreviewHtml').indexOf('pv-shelf-tile') !== -1,
  'the new shelves module has a canvas preview (tiles with name and count)');
ok(/paramInt\('products', 'columns'/.test(builder) && !/repeat\(3,minmax\(0,1fr\)\)/.test(builder),
  'the products preview follows its own columns (the hard-coded 3 is gone)');
ok(/preview-plan-cta/.test(builder) && /\.preview-plan-features \{[^}]*flex: 1 1 auto/.test(css.replace(/\n/g, ' ')) &&
  /\.preview-plan \{[^}]*flex-direction: column/.test(css.replace(/\n/g, ' ')),
  'the pricing preview shows the button, pinned to the bottom of every plan');
ok(/'<div class="preview-card-media"' \+ bgStyle\(it\.image\) \+ '><\/div>'/.test(builder), 'the cards preview shows the card\'s picture');
ok(/preview-member-bio/.test(builder) && /\.preview-member-bio/.test(css), 'the team preview shows the bio line');

// ── 4. the inspector lines up ──────────────────────────────────────────────

const flat = css.replace(/\n/g, ' ');
ok(/\.prop-group \.check-line \{[^}]*display: flex[^}]*align-items: center/.test(flat) &&
  /\.prop-group \.check-line input\[type="checkbox"\] \{[^}]*width: 16px[^}]*height: 16px[^}]*padding: 0/.test(flat),
  '.check-line is styled in admin.css: one row, a 16px box, no field padding');
ok(!/\.check-line\{/.test(builder), 'the builder no longer injects its own .check-line rule');
ok(/function field\(label, inputHtml, hint\)/.test(builder) && /\.prop-group \.prop-hint \{ margin: 6px 0 0; \}/.test(css),
  'a hint is written INSIDE its field\'s group');
ok(!/class="prop-hint" style=/.test(builder), 'no hint carries a hand-patched inline margin');
ok(!/<button[^>]*style="[^"]*margin/.test(builder), 'no button in the builder carries an inline margin');
ok(/\.prop-actions \{[^}]*display: flex[^}]*gap: 8px/.test(flat) && /function actions\(html, mod\)/.test(builder),
  'inspector buttons stand in .prop-actions rows — one rule spaces them');
ok(/\.prop-group input, \.prop-group textarea, \.prop-group select \{[^}]*box-sizing: border-box/.test(flat),
  'text fields and selects share one box model (a text field no longer runs 23px past the select under it)');
ok((builder.match(/colorField\('/g) || []).length >= 4 && /data-color-clear="1"/.test(builder) && /function wireColorFields\(root, onClear\)/.test(builder) &&
  !/data-clear-bg/.test(builder),
  'every colour (text, background, border, page background) has a clear control — not only the background');
ok(/\.prop-color\.is-unset \.prop-color-none \{ display: inline; \}/.test(css), 'an unset colour says so ("לא נקבע")');
ok(/var alignDeclared = !!paramDefFor\(block\.type, 'align'\) \|\| !!ALIGN_KEPT\[block\.type\];/.test(builder) &&
  /if \(alignDeclared \|\| d\.align\) \{/.test(builder),
  'the align select shows only where align is kept: the registry declares it, or the block already carries one');
// the picture keeps its align across the bridge (section 5 below proves it)
// without the block registry listing the param — the one named exception
const bridge = fs.readFileSync(path.join(root, 'src', 'pzn', 'bridge', 'tapuz-json.js'), 'utf8');
ok(/var ALIGN_KEPT = \{ image: 1 \};/.test(builder) &&
  (bridge.match(/\['src', 'alt', 'title', 'caption', 'link', 'align', 'width'\]/g) || []).length === 2,
  'the image is offered align too — the bridge carries it both ways (both pick lists)');
const declaring = registry.BLOCK_REGISTRY.filter((b) => (b.params || []).some((p) => p.name === 'align')).map((b) => b.type);
ok(declaring.includes('heading') && declaring.includes('text') && !declaring.includes('shop') && !declaring.includes('columns'),
  'the registry declares align on ' + declaring.length + ' types (' + declaring.join(', ') + ')');
ok(/var shown = input\.type === 'checkbox' \? input\.checked : input\.value;/.test(builder) && /if \(now === shown\) \{/.test(builder),
  'a data-key control writes only on a real change (an idle blur no longer dirties the page or writes a ROW ratio)');

// ── 5. a clickable image keeps its link (and its align) through the source ─

const { fromTapuzPage, toTapuzPage, serialize, parse, validate, compile, getModule } = require('../src/pzn/index');
const image = { type: 'image', id: 'im1', data: { src: '/uploads/hero.jpg', alt: 'נוף', link: '/shop', align: 'center', width: 'md' } };
const source = serialize(fromTapuzPage({ title: 'ת', slug: 't', direction: 'rtl', lang: 'he', blocks: [image] }));
const reparsed = parse(source);
const back = toTapuzPage(reparsed).blocks[0];
ok(/<bent-image [^>]*link="\/shop"/.test(source) && /<bent-image [^>]*align="center"/.test(source), 'the source carries link and align');
ok(validate(reparsed, { strict: false }).filter((i) => i.severity === 'error').length === 0, 'and validates');
ok(JSON.stringify(back.data) === JSON.stringify(image.data) && back.id === 'im1',
  'JSON → source → JSON returns the image whole: ' + JSON.stringify(back.data));
const html = compile(reparsed).html || String(compile(reparsed));
ok(/<figure[^>]*class="bent-image align-center[^"]*"[^>]*><a href="\/shop"><img [^>]*><\/a><\/figure>/.test(html),
  'the tag dialect wraps the IMG in the link');
const shell = (dir, body) => '<!DOCTYPE html>\n<html lang="he" dir="' + dir + '" bent-version="0.1">\n  <head>\n    <meta charset="utf-8" />\n    <title>t</title>\n  </head>\n  <body>\n    ' + body + '\n  </body>\n</html>\n';
const old = parse(shell('rtl', '<bent-image id="i" src="/a.jpg" align="left" link="javascript:alert(1)" caption="כיתוב" />'));
const oldHtml = compile(old).html || String(compile(old));
ok(validate(old, { strict: false }).filter((i) => i.severity === 'error').length === 0, 'an older document\'s align="left" is still read');
ok(/class="bent-image align-end"/.test(oldHtml) && /<a href="#"><img/.test(oldHtml) && /<\/a><figcaption>כיתוב<\/figcaption>/.test(oldHtml),
  'left on a Hebrew page is the end side; a javascript: link becomes #; the caption stays outside the link');
const imageModule = getModule ? getModule('image') : require('../src/pzn/modules/registry').getModule('image');
ok(imageModule.props.link && imageModule.props.link.type === 'url' && imageModule.props.align.values.slice(0, 3).join() === 'start,center,end',
  'the image module declares link (url) and start | center | end');

// ── 6. the admin shell keeps the fragment (the behaviour is driven in
//       smoke-admin-nav; this is the pin that the file still does it) ───────
ok(/var hash = requestUrl\.hash \|\| '';/.test(nav) && /landedFull \+ keepHash/.test(nav) && /function reveal\(hash\)/.test(nav),
  'admin-nav keeps location.hash through the fetch and the pushState, and lands on it');

try { new Function(builder); ok(true, 'admin-builder.js parses'); }
catch (e) { ok(false, 'admin-builder.js parses (' + e.message + ')'); }

// ── 7. a cached catalog answers on a LATER tick ────────────────────────────
// Found in the browser, not by reading: the canvas asks for the catalog while
// it is still building a block, and every preview first checks "is my element
// still on the page?". A cached answer given on the spot failed that check,
// so for 15 seconds after any fetch a redrawn shop preview stayed on
// "טוען מהקטלוג…". The real fetchStoreCatalog runs here against a fake fetch.
(async () => {
  const src = [fnSource('answerLater'), fnSource('fetchStoreCatalog')];
  ok(src.every(Boolean), 'the builder defines answerLater and fetchStoreCatalog');
  if (src.every(Boolean)) {
    let requests = 0;
    const fakeFetch = () => { requests++; return Promise.resolve({ json: () => Promise.resolve({ ok: true, products: [{ sku: 'a' }] }) }); };
    const fetchStoreCatalog = new Function('fetch',
      'var storeCatalogCache = null; var storeCatalogWaiting = null;\n' + src.join('\n') + '\nreturn fetchStoreCatalog;')(fakeFetch);
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const got = [];
    fetchStoreCatalog((cat) => got.push('a' + cat.products.length));
    fetchStoreCatalog((cat) => got.push('b' + cat.products.length));
    fetchStoreCatalog(() => { throw new Error('one preview fails'); });
    fetchStoreCatalog((cat) => got.push('d' + cat.products.length));
    // the thrown preview error is re-raised on a timer so it reaches the
    // console; here it must not end the smoke
    const swallow = (e) => { if (!/one preview fails/.test(String(e && e.message))) throw e; };
    process.on('uncaughtException', swallow);
    await tick();
    process.removeListener('uncaughtException', swallow);
    ok(requests === 1 && got.join() === 'a1,b1,d1',
      'four previews asking at once share ONE request, and one that throws does not strand the others (' + requests + ' request, ' + got.join() + ')');
    let sync = true;
    let late = false;
    fetchStoreCatalog(() => { late = true; });
    sync = late;
    await tick();
    ok(sync === false && late === true && requests === 1,
      'a warm cache answers on a later tick — never while the caller is still building its element');
  }
  ok(/if \(hit && Date\.now\(\) - hit\.at < 15000\) \{ answerLater\(cb, hit\.articles\); return; \}/.test(builder),
    'the article-list preview\'s cache answers the same way');

  console.log('');
  console.log(failed ? 'SMOKE BUILDER-LISTS: FAIL' : 'SMOKE BUILDER-LISTS: PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log('FAIL the catalog-cache drive threw: ' + (e && e.stack || e));
  console.log('');
  console.log('SMOKE BUILDER-LISTS: FAIL');
  process.exit(1);
});
