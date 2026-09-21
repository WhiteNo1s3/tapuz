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
 * plus a "חנות" link in the main menu. Each is an ordinary `.pzn` page the
 * owner can open in the builder and redesign; the store only CREATES what is
 * missing and never overwrites a page it finds. A page the store made
 * carries `meta.store` (and `meta.storeSku` for a product page), which is
 * how it knows which pages are its own to publish or take down.
 */

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
        '<bent-shop filter="true" columns="3"></bent-shop>'
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

function productSource(p, settings) {
  const shopPath = settings.pages.shop;
  return [
    '<bent-crumbs>',
    '  <bent-crumb label="דף הבית" url="/"></bent-crumb>',
    `  <bent-crumb label="${escAttr(settingsMod.storeName(settings))}" url="${escAttr(pages.publicUrlFor(shopPath))}"></bent-crumb>`,
    `  <bent-crumb label="${escAttr(p.title)}"></bent-crumb>`,
    '</bent-crumbs>',
    `<bent-buy sku="${escAttr(p.slug)}"></bent-buy>`,
    `<bent-shop title="עוד מהחנות" limit="4" exclude="${escAttr(p.slug)}" sort="new"></bent-shop>`
  ].join('\n');
}

function pageMetaForProduct(p) {
  const meta = { store: 'product', storeSku: p.slug };
  if (p.summary) meta.description = p.summary;
  if (p.images && p.images[0]) meta.ogImage = p.images[0];
  return meta;
}

function isOurs(page, kind, sku) {
  const m = (page && page.meta) || {};
  if (m.store !== kind) return false;
  return kind !== 'product' || m.storeSku === sku;
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
function syncProductPage(product, settings) {
  const s = settings || settingsMod.loadSettings();
  const path = productPath(product.slug);
  const page = pages.getPageByFullPath(path);
  if (page && !isOurs(page, 'product', product.slug)) return { path, action: 'foreign' };
  const live = product.status === 'active';
  if (!page) {
    if (!live) return { path, action: 'none' };
    createFromSource(path, product.title, productSource(product, s), pageMetaForProduct(product), true);
    return { path, action: 'created' };
  }
  if (live && page.status !== 'published') {
    pages.updatePage(path, { publish: true });
    return { path, action: 'published' };
  }
  if (!live && page.status === 'published') {
    pages.updatePage(path, { status: 'draft' });
    return { path, action: 'unpublished' };
  }
  // keep the SEO line in step with the product (only the fields the store set)
  const meta = { ...(page.meta || {}) };
  const want = pageMetaForProduct(product);
  let changed = false;
  for (const k of ['description', 'ogImage']) {
    if (want[k] && meta[k] !== want[k]) { meta[k] = want[k]; changed = true; }
  }
  if (changed) pages.updatePage(path, { meta, revisionKind: 'draft' });
  return { path, action: changed ? 'meta' : 'kept' };
}

/** A deleted product's page is taken down (kept as a draft). */
function retireProductPage(slug) {
  const path = productPath(slug);
  const page = pages.getPageByFullPath(path);
  if (!page || !isOurs(page, 'product', slug)) return { path, action: 'none' };
  if (page.status === 'published') pages.updatePage(path, { status: 'draft' });
  return { path, action: 'unpublished' };
}

function syncAllProductPages() {
  const s = settingsMod.loadSettings();
  return catalog.listProducts({ status: 'all' }).map((p) => syncProductPage(p, s));
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

/** Where a product lives on the site, or '' when its page is not live. */
function productUrl(slug, publishedSet) {
  const path = productPath(slug);
  if (publishedSet) return publishedSet.has(path) ? pages.publicUrlFor(path) : '';
  const page = pages.getPageByFullPath(path);
  return page && page.status === 'published' ? pages.publicUrlFor(path) : '';
}

/** The published store-product pages, as a Set of full_paths (one query per render pass). */
function publishedProductPaths() {
  const { db } = require('../db');
  return new Set(db.prepare("SELECT full_path FROM pages WHERE status = 'published' AND full_path LIKE 'shop-%'").all().map((r) => r.full_path));
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
  ensureStorePages,
  syncProductPage,
  syncAllProductPages,
  retireProductPage,
  ensureMenuLink,
  productUrl,
  publishedProductPaths,
  urls
};
