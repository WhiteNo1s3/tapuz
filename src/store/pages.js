'use strict';

/**
 * The store's pages — written in BenTML, like every other page.
 *
 * Opening the store ("the flip") makes sure the site has what a shop needs:
 *   shop      — the catalog            <bent-shop>
 *   cart      — the cart               <bent-cart>
 *   checkout  — the checkout form      <bent-checkout>
 *   order     — the order's own page   <bent-order>
 *   shop-<sku>— one page per product   <bent-buy sku="…">
 *   shelf-<id>— one page per category  <bent-shop shelf="…">   (v2.69)
 * plus a "חנות" link in the main menu. Each is an ordinary `.pzn` page the
 * owner can open in the builder and redesign; the store only CREATES what is
 * missing and never overwrites a page it finds. A page the store made
 * carries `meta.store` (and `meta.storeSku` for a product page,
 * `meta.storeShelf` for a category page), which is how it knows which pages
 * are its own to publish or take down.
 *
 * v2.69 — a product page and a category page FOLLOW the catalog: the title,
 * the search-result line and the share picture are kept in step on every
 * sync, and so is the page's source — but only while the page is still
 * exactly what this code wrote (`meta.storeSourceHash`). A page the owner
 * redesigned no longer matches and is never rewritten.
 */

const crypto = require('crypto');
const pages = require('../pages');
const settingsMod = require('./settings');
const catalog = require('./catalog');

const KINDS = ['shop', 'cart', 'checkout', 'order'];

function escAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escText(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The page sources — BenTML, so the owner (or their AI) can rewrite any of them. */
function templateFor(kind, settings) {
  const name = settingsMod.storeName(settings);
  switch (kind) {
    case 'shop':
      return [
        `<bent-heading level="1" align="center">${escText(name)}</bent-heading>`,
        '<bent-text align="center">בוחרים, מוסיפים לעגלה ומזמינים — בכמה לחיצות.</bent-text>',
        '<bent-shop filter="true" sorter="true" search="true" page-size="24"></bent-shop>'
      ].join('\n');
    case 'cart':
      return [
        '<bent-heading level="1">עגלת הקניות</bent-heading>',
        '<bent-cart></bent-cart>'
      ].join('\n');
    case 'checkout':
      return [
        '<bent-heading level="1">קופה</bent-heading>',
        '<bent-checkout></bent-checkout>'
      ].join('\n');
    case 'order':
      return '<bent-order></bent-order>';
    default:
      throw new Error('unknown store page: ' + kind);
  }
}

const TITLES = { shop: 'חנות', cart: 'עגלת קניות', checkout: 'קופה', order: 'ההזמנה שלי' };
// the cart, the checkout and an order page are nobody's search result
const ROBOTS = { cart: 'noindex, follow', checkout: 'noindex, follow', order: 'noindex, nofollow' };

function productPath(slug) {
  return pages.generateFullPath('shop', slug);
}

/**
 * A category page's address. NOT under `shop-`: that prefix is the product
 * pages' (publishedProductPaths matches it), and a category named like a
 * product would be taken for one.
 */
function shelfPath(slug) {
  return pages.generateFullPath('shelf', slug);
}

/** The live category pages, as a Map of shelf slug → public address (one query per render pass). */
function liveShelfUrls() {
  const { db } = require('../db');
  const out = new Map();
  for (const r of db.prepare("SELECT full_path, meta FROM pages WHERE status = 'published' AND full_path LIKE 'shelf-%'").all()) {
    let m = {};
    try { m = JSON.parse(r.meta || '{}') || {}; } catch (e) { m = {}; }
    if (m.store === 'shelf' && m.storeShelf && r.full_path === shelfPath(m.storeShelf)) {
      out.set(String(m.storeShelf), pages.publicUrlFor(r.full_path));
    }
  }
  return out;
}

/** Where a category lives on the site, or '' when its page is not live. */
function shelfUrl(slug, live) {
  return (live || liveShelfUrls()).get(String(slug || '')) || '';
}

/** The shop page, filtered: where a category or a tag leads when it has no page of its own. */
function shopLink(settings, key, value) {
  return pages.publicUrlFor(settings.pages.shop) + '?' + key + '=' + encodeURIComponent(String(value || ''));
}

function crumb(label, url) {
  return `  <bent-crumb label="${escAttr(label)}"${url ? ` url="${escAttr(url)}"` : ''}></bent-crumb>`;
}

/**
 * Home › the shop › [parent ›] category — where every product and category
 * trail starts. A category the shopper is not shown (hidden) is not a step;
 * a category without a live page leads to the shop, filtered. On a site
 * whose home page IS the shop the trail starts at the shop: two steps to
 * one page read as a mistake.
 * @param {{slug:string,label:string}[]} steps  the category path to link (catalog.shelfPath)
 */
function trail(steps, settings, live) {
  let home = '';
  try { home = String(require('../config').loadConfig().homepage || ''); } catch (e) { home = ''; }
  const shopIsHome = home === settings.pages.shop;
  const out = shopIsHome
    ? [crumb(settingsMod.storeName(settings), '/')]
    : [crumb('דף הבית', '/'), crumb(settingsMod.storeName(settings), pages.publicUrlFor(settings.pages.shop))];
  const shown = new Set(catalog.listShelves({ visible: true }).map((s) => s.slug));
  for (const step of steps) {
    if (!shown.has(step.slug)) continue;
    out.push(crumb(step.label, shelfUrl(step.slug, live) || shopLink(settings, 'shelf', step.slug)));
  }
  return out;
}

/**
 * A product page: the trail (with its category), the buy box, and four more
 * from the same category — in FOUR columns, so the strip is one full row and
 * never three cards and an orphan.
 */
/**
 * The column count that shows `n` cards in WHOLE rows (v2.69). Up to four
 * cards are one row; more take four columns when that leaves no orphan, else
 * three when THAT leaves none, else four with the last row centred. One or
 * two cards keep a normal card's size (three columns, centred) instead of
 * becoming two giant ones. A generated page used to print a fixed grid, so a
 * category of four showed 3 + 1 and a strip of three sat in four columns.
 * @returns {{ columns: number, centre: boolean }}
 */
function wholeRows(n) {
  if (n <= 2) return { columns: 3, centre: true };
  if (n <= 4) return { columns: n, centre: false };
  if (n % 4 === 0) return { columns: 4, centre: false };
  if (n % 3 === 0) return { columns: 3, centre: false };
  return { columns: 4, centre: true };
}
function gridAttrs(n) {
  const w = wholeRows(n);
  return ` columns="${w.columns}"` + (w.centre ? ' justify="center"' : '');
}

function productSource(p, settings, live) {
  const sku = escAttr(p.slug);
  // "more from this category" while the category has others; a product alone
  // in its category (or in none) shows the shop's newest. Either way the
  // strip is ONE row sized to what it holds (see wholeRows).
  const siblings = p.shelf ? catalog.listProducts({ shelf: p.shelf, exclude: p.slug, limit: 4 }).length : 0;
  const others = siblings ? siblings : catalog.listProducts({ exclude: p.slug, limit: 4 }).length;
  const strip = siblings
    ? `<bent-shop title="עוד מאותה קטגוריה" shelf="${escAttr(p.shelf)}" limit="${siblings}"${gridAttrs(siblings)} exclude="${sku}"></bent-shop>`
    : (others ? `<bent-shop title="עוד מהחנות" limit="${others}"${gridAttrs(others)} exclude="${sku}" sort="new"></bent-shop>` : '');
  return [
    '<bent-crumbs>',
    ...trail(p.shelf ? catalog.shelfPath(p.shelf) : [], settings, live),
    crumb(p.title, ''),
    '</bent-crumbs>',
    `<bent-buy sku="${sku}"></bent-buy>`,
    strip
  ].filter(Boolean).join('\n');
}

/**
 * The page's own facts that follow the product: the search-result title
 * and line (the owner's SEO words win over the name and the summary) and
 * the share picture. An empty value CLEARS the key — a summary the owner
 * deleted must not live on in a search result.
 */
function pageMetaForProduct(p) {
  return {
    store: 'product',
    storeSku: p.slug,
    seoTitle: p.seoTitle || '',
    description: p.seoDescription || p.summary || '',
    ogImage: (p.images && p.images[0]) || ''
  };
}

/** A category page: the trail, its name, its line of text, its sub-categories as tiles, its products. */
function shelfSource(shelf, settings, live) {
  const up = shelf.parent ? catalog.shelfPath(shelf.parent) : [];
  const kids = catalog.listShelves({ visible: true }).filter((s) => s.parent === shelf.slug && s.total > 0).length;
  // whole rows (see wholeRows): the tiles of its sub-categories, and its products
  const total = Number(shelf.total) || 0;
  return [
    '<bent-crumbs>',
    ...trail(up, settings, live),
    crumb(shelf.label, ''),
    '</bent-crumbs>',
    `<bent-heading level="1">${escText(shelf.label)}</bent-heading>`,
    shelf.summary ? `<bent-text>${escText(shelf.summary)}</bent-text>` : '',
    kids ? `<bent-shelves parent="${escAttr(shelf.slug)}"${gridAttrs(kids)}></bent-shelves>` : '',
    `<bent-shop shelf="${escAttr(shelf.slug)}" sorter="true"${total ? gridAttrs(total) : ''}></bent-shop>`
  ].filter(Boolean).join('\n');
}

function pageMetaForShelf(shelf) {
  return {
    store: 'shelf',
    storeShelf: shelf.slug,
    seoTitle: shelf.seoTitle || '',
    description: shelf.seoDescription || shelf.summary || '',
    ogImage: shelf.image || ''
  };
}

function isOurs(page, kind, key) {
  const m = (page && page.meta) || {};
  if (m.store !== kind) return false;
  if (kind === 'product') return m.storeSku === key;
  if (kind === 'shelf') return m.storeShelf === key;
  return true;
}

// ── a page that follows the catalog ────────────────────────────────────
//
// "Is this page still what I wrote?" cannot be asked of the TEXT: the page
// index re-serializes a source on every save of a title or a description
// (attributes are re-ordered, the head is added), so the same page has many
// spellings. It is asked of what the source SAYS — the blocks it parses to,
// keys sorted, the builder's own block ids left out.

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] !== undefined) out[k] = canon(v[k]);
    }
    return out;
  }
  return v;
}

function fingerprint(blocks) {
  const { isGeneratedBlockId } = require('../blocks');
  const list = (Array.isArray(blocks) ? blocks : []).map((b) => {
    const o = { type: b && b.type, data: canon((b && b.data) || {}) };
    // an anchor the owner typed is an edit; the builder's own ids are not
    if (b && b.id && !isGeneratedBlockId(b.id)) o.id = String(b.id);
    return o;
  });
  return crypto.createHash('sha1').update(JSON.stringify(list)).digest('hex');
}

/** The blocks a source parses to — through the same door a save goes through. */
function sourceBlocks(source) {
  const pzn = require('../pzn/index');
  const src = require('../pzn-source').toPznSource(source).source;
  return pzn.toTapuzPage(pzn.parse(src)).blocks;
}

function sourceHash(source) {
  return fingerprint(sourceBlocks(source));
}

/**
 * What 2.68 wrote for a product page, whatever the product or the store was
 * called that day: the three-step trail, the buy box, "עוד מהחנות". Those
 * pages carry no hash, so this shape is the only proof one is untouched.
 */
function isLegacyProductShape(blocks, slug) {
  if (!Array.isArray(blocks) || blocks.length !== 3) return false;
  const [c, b, s] = blocks;
  if (!c || c.type !== 'crumbs' || !b || b.type !== 'buy' || !s || s.type !== 'shop') return false;
  const only = (o, keys) => !!o && Object.keys(o).filter((k) => o[k] !== undefined).sort().join() === keys.slice().sort().join();
  const items = (c.data && c.data.items) || [];
  if (!only(c.data, ['items']) || items.length !== 3) return false;
  if (!only(items[0], ['label', 'url']) || items[0].label !== 'דף הבית' || items[0].url !== '/') return false;
  if (!only(items[1], ['label', 'url']) || !only(items[2], ['label'])) return false;
  if (!only(b.data, ['sku']) || b.data.sku !== slug) return false;
  const d = s.data || {};
  return only(d, ['title', 'limit', 'exclude', 'sort']) && d.title === 'עוד מהחנות' && Number(d.limit) === 4 &&
    d.exclude === slug && d.sort === 'new';
}

/** Is the page still exactly what this code wrote (its draft AND what is live)? */
function isUntouched(page, legacy) {
  const hash = (page.meta || {}).storeSourceHash;
  const live = page.status === 'published';
  if (hash) return fingerprint(page.draft_blocks) === hash && (!live || fingerprint(page.blocks) === hash);
  return !!legacy && legacy(page.draft_blocks) && (!live || legacy(page.blocks));
}

/**
 * Create a page from BenTML (draft first, then the source, then publish —
 * the same order the site-package import uses, so the .pzn file is the
 * author's text, not a re-serialization).
 */
function createFromSource(fullPath, title, source, meta, publish) {
  pages.createPage({ title, slug: fullPath, blocks: [], meta, status: 'draft' });
  pages.savePageSource(fullPath, source, { publish: !!publish });
  return pages.getPageByFullPath(fullPath);
}

/** A page the store generates remembers what it generated (see isUntouched). */
function createGenerated(fullPath, title, source, meta, publish) {
  const clean = {};
  for (const [k, v] of Object.entries(meta)) if (v !== '') clean[k] = v;
  clean.storeSourceHash = sourceHash(source);
  return createFromSource(fullPath, title, source, clean, publish);
}

/**
 * Keep a generated page in step with the catalog: its source (only while it
 * is untouched), its title and the three head facts the store owns.
 * @returns {{ page: object, changed: boolean, rewritten: boolean }}
 */
function keepInStep(page, want) {
  const path = page.full_path;
  const meta = { ...(page.meta || {}) };
  let rewritten = false;
  if (isUntouched(page, want.legacy)) {
    const hash = sourceHash(want.source);
    if (meta.storeSourceHash !== hash) {
      if (fingerprint(page.draft_blocks) !== hash) {
        pages.savePageSource(path, want.source, { publish: page.status === 'published' });
        rewritten = true;
      }
      meta.storeSourceHash = hash;
    }
  }
  let changed = rewritten || meta.storeSourceHash !== (page.meta || {}).storeSourceHash;
  for (const k of ['seoTitle', 'description', 'ogImage']) {
    const v = want.meta[k] || '';
    if (v && meta[k] !== v) { meta[k] = v; changed = true; }
    if (!v && meta[k] !== undefined) { delete meta[k]; changed = true; }
  }
  const title = want.title && want.title !== page.title ? want.title : undefined;
  if (title) changed = true;
  if (!changed) return { page, changed: false, rewritten: false };
  // a rewritten source is already live; the head facts ride a draft revision.
  // The page's tags ride it too: the generated source has no head, and a
  // source without one saves as "no tags" — the owner's tags on a product
  // page were wiped by the next category rename.
  return { page: pages.updatePage(path, { title, meta, tags: page.tags, revisionKind: 'draft' }), changed: true, rewritten };
}

/**
 * Make sure the four store pages exist and are live. A page at the address
 * that is NOT a store page is left alone; the store takes `store-<kind>`
 * instead and remembers it.
 * @returns {{ created:string[], published:string[], kept:string[], moved:object }}
 */
function ensureStorePages() {
  const settings = settingsMod.loadSettings();
  const out = { created: [], published: [], kept: [], moved: {} };
  const nextPages = { ...settings.pages };
  for (const kind of KINDS) {
    let path = settings.pages[kind];
    let page = pages.getPageByFullPath(path);
    if (page && !isOurs(page, kind)) {
      // the owner's own page lives here — never take it over
      const alt = 'store-' + kind;
      const altPage = pages.getPageByFullPath(alt);
      if (altPage && !isOurs(altPage, kind)) { out.kept.push(path); continue; }
      out.moved[kind] = { from: path, to: alt };
      path = alt;
      page = altPage;
      nextPages[kind] = alt;
    }
    const meta = { store: kind };
    if (ROBOTS[kind]) meta.robots = ROBOTS[kind];
    if (!page) {
      createFromSource(path, TITLES[kind], templateFor(kind, settings), meta, true);
      out.created.push(path);
    } else if (page.status !== 'published') {
      pages.updatePage(path, { publish: true });
      out.published.push(path);
    } else {
      out.kept.push(path);
    }
  }
  if (Object.keys(out.moved).length) settingsMod.saveSettings({ pages: nextPages });
  return out;
}

/**
 * One product's page follows the product: active → live (created if it is
 * missing), hidden/draft/deleted → taken down (kept as a draft, never deleted —
 * the owner may have written on it).
 */
function syncProductPage(product, settings, live) {
  const s = settings || settingsMod.loadSettings();
  const path = productPath(product.slug);
  const page = pages.getPageByFullPath(path);
  if (page && !isOurs(page, 'product', product.slug)) return { path, action: 'foreign' };
  const wanted = product.status === 'active';
  if (!page) {
    if (!wanted) return { path, action: 'none' };
    createGenerated(path, product.title, productSource(product, s, live), pageMetaForProduct(product), true);
    return { path, action: 'created' };
  }
  // a renamed product used to keep its old <title>, trail and description
  // for ever: the page was written once and only ever published or taken down
  const kept = keepInStep(page, {
    title: product.title,
    meta: pageMetaForProduct(product),
    source: productSource(product, s, live),
    legacy: (blocks) => isLegacyProductShape(blocks, product.slug)
  });
  if (wanted && kept.page.status !== 'published') {
    pages.updatePage(path, { publish: true });
    return { path, action: 'published' };
  }
  if (!wanted && kept.page.status === 'published') {
    pages.updatePage(path, { status: 'draft' });
    return { path, action: 'unpublished' };
  }
  return { path, action: kept.rewritten ? 'updated' : (kept.changed ? 'meta' : 'kept') };
}

/** A deleted product's page is taken down (kept as a draft). */
function retireProductPage(slug) {
  const path = productPath(slug);
  const page = pages.getPageByFullPath(path);
  if (!page || !isOurs(page, 'product', slug)) return { path, action: 'none' };
  if (page.status === 'published') pages.updatePage(path, { status: 'draft' });
  return { path, action: 'unpublished' };
}

/**
 * One category's page follows the category. It is live while the category
 * is shown to shoppers and it (with its sub-categories) holds at least one
 * active product; otherwise it is taken down — kept as a draft, never
 * deleted. A page is only ever CREATED or put live while the store is open;
 * closing the store takes no page down ("every page, product and order
 * stays"), but a category the owner hid leaves the site even then.
 * @param {object|string} shelf  a listShelves() row, or a slug
 */
function syncShelfPage(shelf, settings, live) {
  const s = settings || settingsMod.loadSettings();
  const row = typeof shelf === 'string'
    ? catalog.listShelves().find((x) => x.slug === shelf)
    : shelf;
  if (!row) return retireShelfPage(String(shelf || ''));
  const path = shelfPath(row.slug);
  const page = pages.getPageByFullPath(path);
  if (page && !isOurs(page, 'shelf', row.slug)) return { path, action: 'foreign' };
  const shown = catalog.listShelves({ visible: true }).some((x) => x.slug === row.slug);
  const wanted = shown && row.total > 0;
  if (!page) {
    if (!wanted || !s.open) return { path, action: 'none' };
    createGenerated(path, row.label, shelfSource(row, s, live), pageMetaForShelf(row), true);
    return { path, action: 'created' };
  }
  const kept = keepInStep(page, { title: row.label, meta: pageMetaForShelf(row), source: shelfSource(row, s, live) });
  if (wanted && s.open && kept.page.status !== 'published') {
    pages.updatePage(path, { publish: true });
    return { path, action: 'published' };
  }
  if (!wanted && kept.page.status === 'published') {
    pages.updatePage(path, { status: 'draft' });
    return { path, action: 'unpublished' };
  }
  return { path, action: kept.rewritten ? 'updated' : (kept.changed ? 'meta' : 'kept') };
}

/** A deleted category's page is taken down (kept as a draft). */
function retireShelfPage(slug) {
  const path = shelfPath(slug);
  const page = pages.getPageByFullPath(path);
  if (!page || !isOurs(page, 'shelf', slug)) return { path, action: 'none' };
  if (page.status === 'published') pages.updatePage(path, { status: 'draft' });
  return { path, action: 'unpublished' };
}

/**
 * Every category page, in step. Parents come first (listShelves order), so a
 * sub-category's trail can link a parent page that was created a moment ago;
 * a page whose category no longer exists is taken down.
 */
function syncShelfPages() {
  const s = settingsMod.loadSettings();
  const shelves = catalog.listShelves();
  const out = shelves.map((sh) => syncShelfPage(sh, s));
  const known = new Set(shelves.map((sh) => sh.slug));
  const { db } = require('../db');
  for (const r of db.prepare("SELECT full_path, meta FROM pages WHERE status = 'published' AND full_path LIKE 'shelf-%'").all()) {
    let m = {};
    try { m = JSON.parse(r.meta || '{}') || {}; } catch (e) { m = {}; }
    if (m.store === 'shelf' && m.storeShelf && !known.has(m.storeShelf)) out.push(retireShelfPage(m.storeShelf));
  }
  return out;
}

/**
 * Every page the catalog owns, in step: the category pages first, because a
 * product's trail links its category's page. The ceiling is the catalog's
 * own — product 501 used to get no page at all.
 * @returns {{ shelves: object[], products: object[] }}
 */
function syncCatalogPages() {
  const s = settingsMod.loadSettings();
  let shelves = [];
  try { shelves = syncShelfPages(); } catch (e) { console.error('[store] category page sync failed:', e.message); }
  const live = liveShelfUrls();
  const products = catalog.listProducts({ status: 'all', limit: 100000 }).map((p) => syncProductPage(p, s, live));
  return { shelves, products };
}

/**
 * The name every older caller knows (the document door after an apply, a
 * live restore). It syncs the category pages too and answers the product
 * pages' results, as it always did.
 */
function syncAllProductPages() {
  return syncCatalogPages().products;
}

/** Add "חנות" to the menu in the main slot — once, with a backup first. */
function ensureMenuLink() {
  const menus = require('../menus');
  const settings = settingsMod.loadSettings();
  const shopPath = settings.pages.shop;
  const locs = menus.getMenuLocations();
  const name = locs.main || 'main';
  const items = menus.getMenu(name) || [];
  const hits = (list) => list.some((it) => (it.type === 'page' && String(it.target || '').replace(/^\/+/, '').replace(/\.html$/, '') === shopPath) ||
    String(it.url || '') === pages.publicUrlFor(shopPath) || hits(it.children || []));
  if (hits(items)) return { added: false };
  try { menus.backupMenus('store:flip'); } catch (e) { /* a missing backup must not block the link */ }
  menus.saveMenu(name, items.concat([{ label: 'חנות', type: 'page', target: shopPath }]));
  return { added: true, menu: name };
}

/** Does this page hold the buy box of the product whose page lives at `fullPath`? (blocks: parsed, or the stored JSON) */
function holdsBuyBox(blocks, fullPath) {
  let list = blocks;
  if (typeof list === 'string') {
    if (list.indexOf('"buy"') === -1) return false;
    try { list = JSON.parse(list); } catch (e) { return false; }
  }
  const todo = [list];
  while (todo.length) {
    const v = todo.pop();
    if (!v || typeof v !== 'object') continue;
    if (!Array.isArray(v) && v.type === 'buy' && v.data && v.data.sku) {
      let at = '';
      try { at = productPath(String(v.data.sku).trim().toLowerCase()); } catch (e) { at = ''; }
      if (at === fullPath) return true;
    }
    for (const k of Object.keys(v)) todo.push(v[k]);
  }
  return false;
}

/**
 * Is the page at a product's address really that product's page? Any
 * published `shop-…` page used to count, so a product called "info" beside
 * the owner's own /shop-info ("opening hours") had its card, its picture and
 * "לבחירת אפשרות" all lead there — and could not be bought. A page the store
 * made says whose it is (meta); a page that arrived without that note — a
 * site package carries a page's source, not its meta — is still the
 * product's when it holds the product's buy box.
 */
function isProductPage(fullPath, meta, blocks) {
  const m = meta || {};
  if (m.store === 'product' && m.storeSku && productPath(m.storeSku) === fullPath) return true;
  return holdsBuyBox(blocks, fullPath);
}

/** Where a product lives on the site, or '' when its page is not live. */
function productUrl(slug, publishedSet) {
  const path = productPath(slug);
  if (publishedSet) return publishedSet.has(path) ? pages.publicUrlFor(path) : '';
  const page = pages.getPageByFullPath(path);
  return page && page.status === 'published' && isProductPage(path, page.meta, page.blocks) ? pages.publicUrlFor(path) : '';
}

/**
 * The published store-product pages, as a Set of full_paths (one query per
 * render pass; a page's blocks are read only when its meta does not already
 * say it is a product's page).
 */
function publishedProductPaths() {
  const { db } = require('../db');
  const out = new Set();
  let blocksOf = null;
  for (const r of db.prepare("SELECT full_path, meta FROM pages WHERE status = 'published' AND full_path LIKE 'shop-%'").all()) {
    let m = {};
    try { m = JSON.parse(r.meta || '{}') || {}; } catch (e) { m = {}; }
    if (isProductPage(r.full_path, m, null)) { out.add(r.full_path); continue; }
    blocksOf = blocksOf || db.prepare('SELECT blocks FROM pages WHERE full_path = ?');
    const row = blocksOf.get(r.full_path);
    if (row && holdsBuyBox(row.blocks, r.full_path)) out.add(r.full_path);
  }
  return out;
}

/** The store pages' public addresses. */
function urls(settings) {
  const s = settings || settingsMod.loadSettings();
  const out = {};
  for (const k of KINDS) out[k] = pages.publicUrlFor(s.pages[k]);
  return out;
}

module.exports = {
  KINDS,
  TITLES,
  templateFor,
  productPath,
  productSource,
  shelfPath,
  shelfSource,
  shelfUrl,
  liveShelfUrls,
  shopLink,
  sourceHash,
  ensureStorePages,
  syncProductPage,
  syncAllProductPages,
  syncCatalogPages,
  wholeRows,
  retireProductPage,
  syncShelfPage,
  syncShelfPages,
  retireShelfPage,
  ensureMenuLink,
  productUrl,
  publishedProductPaths,
  urls
};
