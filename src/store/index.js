'use strict';

/**
 * The store (v2.53) — the flip that makes the site a shop.
 *
 *   flip(true)   opens it: the store pages are created in BenTML (only what is
 *                missing), every active product gets its page, the main menu
 *                gains "חנות", the header gains the cart, and the site is
 *                rebuilt so the live (static) site IS a shop.
 *   flip(false)  closes it: the cart and the buy buttons leave the site and
 *                checkout refuses; every page, product and order stays.
 *
 * Everything the store knows lives in the site's SQLite file (schema.js),
 * so the `.pzn` export, the backup shelf and a live restore ("hot swap")
 * carry the whole shop; afterRestore() puts the storefront back in step
 * with whatever was restored.
 */

const money = require('./money');
const settings = require('./settings');
const catalog = require('./catalog');
const coupons = require('./coupons');
const pricing = require('./pricing');
const orders = require('./orders');
const storePages = require('./pages');
const document = require('./document');
const gateway = require('./gateway');

function isOpen() {
  try { return !!settings.loadSettings().open; } catch (e) { return false; }
}

/** Rebuild the static site now (admin paths — the owner waits for "done"). */
function refreshNow() {
  try {
    require('../export').exportAll();
    return true;
  } catch (e) {
    console.error('[store] export failed:', e.message);
    return false;
  }
}

let refreshTimer = null;
/**
 * Rebuild soon (public paths — an order must never wait on a site build).
 * Several orders in a burst become one rebuild.
 */
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; refreshNow(); }, 400);
  if (refreshTimer.unref) refreshTimer.unref();
}

/**
 * Open or close the store.
 * @returns {{ open:boolean, was:boolean, pages?:object, products?:object[], menu?:object, rebuilt:boolean }}
 */
function flip(open) {
  const was = isOpen();
  settings.saveSettings({ open: !!open });
  const report = { open: !!open, was };
  if (open) {
    report.pages = storePages.ensureStorePages();
    report.products = storePages.syncAllProductPages();
    report.menu = storePages.ensureMenuLink();
  }
  report.rebuilt = refreshNow();
  return report;
}

/** After a product was created/updated/deleted in the admin. */
function afterProductChange(product, { deletedSlug } = {}) {
  let page = null;
  try {
    if (deletedSlug) page = storePages.retireProductPage(deletedSlug);
    else if (product && isOpen()) page = storePages.syncProductPage(product);
  } catch (e) {
    console.error('[store] product page sync failed:', e.message);
  }
  const rebuilt = refreshNow();
  return { page, rebuilt };
}

/**
 * After a live restore (storage → שחזור): the database may now hold another
 * shop entirely. Put the storefront back in step with it.
 */
function afterRestore() {
  try {
    if (isOpen()) {
      storePages.ensureStorePages();
      storePages.syncAllProductPages();
    }
  } catch (e) {
    console.error('[store] restore sync failed:', e.message);
  }
  return refreshNow();
}

/** Headline numbers for the dashboard. */
function summary() {
  const s = settings.loadSettings();
  const st = orders.stats();
  const products = catalog.countProducts();
  return {
    open: s.open,
    name: settings.storeName(s),
    currency: s.currency,
    products,
    orders: st.counts,
    today: { count: st.today.n, total: st.today.total, totalText: money.formatMoney(st.today.total, s.currency) },
    month: { count: st.month.n, total: st.month.total, totalText: money.formatMoney(st.month.total, s.currency) }
  };
}

module.exports = {
  money,
  settings,
  catalog,
  coupons,
  pricing,
  orders,
  pages: storePages,
  document,
  gateway,
  isOpen,
  flip,
  refreshNow,
  scheduleRefresh,
  afterProductChange,
  afterRestore,
  summary
};
