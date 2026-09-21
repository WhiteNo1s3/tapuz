'use strict';

/**
 * The store's PUBLIC endpoints (v2.53) — what a shopper's browser calls.
 *
 *   GET  /api/store/catalog        the live catalog (prices, availability)
 *   POST /api/store/quote          a cart → the server's own totals
 *   POST /api/store/checkout       place the order
 *   GET  /api/store/order/:token   the order page's data
 *
 * Unauthenticated by nature, so every door is narrow: its own 32 KB JSON
 * parser (mounted before the admin's 12 MB one), a per-IP rate limit per
 * endpoint, a honeypot on checkout, and replies that never carry a stack or
 * an internal id. JSON only — a cross-site form cannot post
 * application/json without a preflight, so a foreign page cannot forge an
 * order into this store from a visitor's browser.
 *
 * MOUNTED in server.js after the urlencoded parser and before the static
 * mounts, beside form capture.
 */

const express = require('express');
const { FixedWindowLimiter } = require('../ratelimit');
const { clientIp } = require('../http-util');

const router = express.Router();
const smallJson = express.json({ limit: '32kb' });

const limit = (env, max) => new FixedWindowLimiter({ windowMs: 60 * 1000, max: parseInt(process.env[env], 10) || max });
const catalogLimiter = limit('TAPUZ_STORE_CATALOG_MAX', 120);
const quoteLimiter = limit('TAPUZ_STORE_QUOTE_MAX', 120);
const orderLimiter = limit('TAPUZ_STORE_ORDER_MAX', 8);
const viewLimiter = limit('TAPUZ_STORE_VIEW_MAX', 60);

function gate(limiter, name) {
  return (req, res, next) => {
    const key = name + ':' + clientIp(req);
    if (limiter.allow(key)) return next();
    res.setHeader('Retry-After', String(limiter.retryAfter(key)));
    return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: 'יותר מדי בקשות — נסו שוב בעוד רגע' });
  };
}

function store() {
  return require('../store');
}

/**
 * JSON or nothing. The site's urlencoded parser runs before these routes
 * (form capture needs it), and its extended mode would happily turn a
 * cross-site HTML form — a "simple" request, no preflight — into a nested
 * order object. A page on another site must not be able to place an order
 * from a visitor's browser, so anything but application/json is refused
 * before it is read.
 */
function jsonOnly(req, res, next) {
  if (req.is('application/json')) return next();
  return res.status(415).json({ ok: false, code: 'JSON_ONLY', message: 'בקשה לא נתמכת' });
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

router.get('/api/store/catalog', gate(catalogLimiter, 'catalog'), (req, res) => {
  try {
    const st = store();
    const s = st.settings.loadSettings();
    const published = st.pages.publishedProductPaths();
    const products = st.catalog.listProducts({ status: 'active', sort: 'manual' }).map((p) => {
      const pp = st.catalog.publicProduct(p, s);
      return { ...pp, url: st.pages.productUrl(p.slug, published) };
    });
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({ ok: true, open: !!s.open, currency: s.currency, shelves: st.catalog.listShelves().map(({ slug, label }) => ({ slug, label })), products });
  } catch (e) {
    res.status(500).json({ ok: false, message: 'שגיאה בטעינת הקטלוג' });
  }
});

router.post('/api/store/quote', gate(quoteLimiter, 'quote'), jsonOnly, smallJson, (req, res) => {
  noStore(res);
  try {
    const st = store();
    const b = req.body || {};
    const q = st.pricing.quote({ items: b.items, shipping: b.shipping, coupon: b.coupon, payment: b.payment }, {
      urlFor: (slug) => st.pages.productUrl(slug)
    });
    res.json({ ok: true, quote: st.pricing.publicQuote(q) });
  } catch (e) {
    console.error('[store] quote failed:', e.message);
    res.status(500).json({ ok: false, message: 'לא הצלחנו לחשב את העגלה' });
  }
});

router.post('/api/store/checkout', gate(orderLimiter, 'order'), jsonOnly, smallJson, (req, res) => {
  noStore(res);
  const b = req.body || {};
  // the honeypot: a field no human sees. A bot learns nothing; a person
  // whose browser somehow filled it is told plainly to try again.
  if (String(b._hp || '').trim()) {
    return res.status(400).json({ ok: false, code: 'REJECTED', message: 'לא הצלחנו לקבל את ההזמנה — נסו שוב, או צרו איתנו קשר.' });
  }
  try {
    const st = store();
    const order = st.settings.loadSettings().pages.order;
    const orderPage = require('../pages').publicUrlFor(order);
    const r = st.orders.placeOrder({
      items: b.items, shipping: b.shipping, payment: b.payment, coupon: b.coupon,
      customer: b.customer, address: b.address, note: b.note, acceptTerms: b.acceptTerms
    }, {
      req, res,
      urlFor: (slug) => st.pages.productUrl(slug),
      orderUrl: (token) => orderPage + '?o=' + encodeURIComponent(token)
    });
    if (!r.ok) {
      const status = r.code === 'CLOSED' ? 403 : r.code === 'FIELDS' ? 422 : 409;
      return res.status(status).json(r);
    }
    // a unit sold out (or came back): the static storefront says so on its next build
    if (r.stockChanged) st.scheduleRefresh();
    return res.json({ ok: true, order: r.order, next: r.next, pay: r.pay || '' });
  } catch (e) {
    console.error('[store] checkout failed:', e.message);
    return res.status(500).json({ ok: false, code: 'ERROR', message: 'משהו השתבש — ההזמנה לא נשמרה. נסו שוב.' });
  }
});

router.get('/api/store/order/:token', gate(viewLimiter, 'view'), (req, res) => {
  noStore(res);
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const st = store();
    const order = st.orders.getOrderByToken(req.params.token);
    if (!order) return res.status(404).json({ ok: false, message: 'ההזמנה לא נמצאה' });
    return res.json({ ok: true, order: st.orders.publicOrder(order) });
  } catch (e) {
    return res.status(500).json({ ok: false, message: 'שגיאה בטעינת ההזמנה' });
  }
});

module.exports = router;
