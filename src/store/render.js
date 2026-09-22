'use strict';

/**
 * The storefront's HTML — what <bent-shop>, <bent-buy>, <bent-cart>,
 * <bent-checkout> and <bent-order> compile to, plus the header's cart
 * button and the storefront script tag.
 *
 * Server-rendered and static-export safe: the catalog is read from the
 * database at render time, so a published page carries real products,
 * real prices and real "sold out" marks in plain HTML (search engines and
 * link previews see a shop, not a spinner). The storefront script
 * (public/tz-store.js) adds what only a browser can do — the cart lives in
 * the shopper's browser until they order — and every sum it shows comes
 * back from the server's quote, never from its own arithmetic.
 *
 * Every string is escaped; every link goes through safeHref.
 */

const { escapeHtml, escapeAttr, safeHref } = require('../pzn/language/escape');
const money = require('./money');

function store() {
  return {
    settings: require('./settings'),
    catalog: require('./catalog'),
    pages: require('./pages')
  };
}

function attrs(opts = {}) {
  return {
    id: opts.idAttr || '',
    cls: opts.cls || '',
    style: opts.style || '',
    dir: opts.dir ? ` dir="${escapeAttr(String(opts.dir).replace(/^\s*dir="|"\s*$/g, ''))}"` : ''
  };
}

function bool(v, fallback) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return fallback;
}

function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function imgTag(src, alt, cls, lazy) {
  const url = safeHref(src);
  if (!src || url === '#') return '';
  return `<img class="${cls}" src="${escapeAttr(url)}" alt="${escapeAttr(alt || '')}"${lazy ? ' loading="lazy"' : ''} decoding="async">`;
}

function priceHtml(pp) {
  return `<span class="bent-price-now">${escapeHtml(pp.priceText)}</span>` +
    (pp.compareText ? ` <s class="bent-price-was">${escapeHtml(pp.compareText)}</s>` : '');
}

function stockHtml(pp) {
  if (pp.stockState === 'out') return '<p class="bent-stock bent-stock-out">אזל מהמלאי</p>';
  if (pp.stockState === 'low' && pp.stockLeft) return `<p class="bent-stock bent-stock-low">נותרו ${Number(pp.stockLeft)} במלאי</p>`;
  return '';
}

const CLOSED_NOTE = '<p class="bent-store-closed">החנות סגורה כרגע להזמנות — אפשר להתרשם מהמוצרים, ונחזור בקרוב.</p>';

// ── <bent-shop> ────────────────────────────────────────────────────────

/**
 * The catalog grid.
 * props: shelf, columns (2–4), limit (0 = all), sort, filter, title, exclude, buttons, empty
 */
function renderShop(props = {}, opts = {}) {
  const { settings: S, catalog, pages } = store();
  const s = opts.settings || S.loadSettings();
  const a = attrs(opts);
  const cols = [2, 3, 4].includes(Number(props.columns)) ? Number(props.columns) : 3;
  const limit = Math.min(Math.max(parseInt(props.limit, 10) || 0, 0), 48);
  const list = catalog.listProducts({
    status: 'active',
    shelf: props.shelf || '',
    exclude: props.exclude || '',
    sort: props.sort || 'manual',
    limit: limit || 500
  });
  const title = String(props.title || '').trim();
  // a titled strip with nothing in it ("עוד מהחנות" on the only product) disappears whole
  if (!list.length && title) return '';
  const published = pages.publishedProductPaths();
  const buttons = bool(props.buttons, true) && s.open;
  const cards = list.map((p) => {
    const pp = catalog.publicProduct(p, s);
    const url = pages.productUrl(p.slug, published);
    const link = (inner, cls) => url ? `<a class="${cls}" href="${escapeAttr(url)}">${inner}</a>` : `<span class="${cls}">${inner}</span>`;
    let action = '';
    if (buttons) {
      if (!pp.available) action = '<span class="bent-shop-add is-out" aria-disabled="true">אזל מהמלאי</span>';
      else if (pp.hasVariants) action = url ? `<a class="bent-shop-add" href="${escapeAttr(url)}">לבחירת אפשרות</a>` : '';
      else action = `<button type="button" class="bent-shop-add" data-tz-add data-sku="${escapeAttr(pp.sku)}" data-title="${escapeAttr(pp.title)}">הוספה לעגלה</button>`;
    }
    return `<article class="bent-shop-card${pp.available ? '' : ' is-out'}" data-shelf="${escapeAttr(pp.shelf)}">` +
      link(pp.image ? imgTag(pp.image, pp.title, 'bent-shop-img', true) : '<span class="bent-shop-noimg" aria-hidden="true">🛍️</span>', 'bent-shop-media') +
      (pp.badge ? `<span class="bent-shop-badge">${escapeHtml(pp.badge)}</span>` : '') +
      '<div class="bent-shop-body">' +
      `<h3 class="bent-shop-name">${link(escapeHtml(pp.title), 'bent-shop-link')}</h3>` +
      (pp.summary ? `<p class="bent-shop-summary">${escapeHtml(pp.summary)}</p>` : '') +
      `<p class="bent-shop-price">${priceHtml(pp)}</p>` +
      stockHtml(pp) +
      action +
      '</div></article>';
  }).join('');

  let filter = '';
  if (bool(props.filter, false) && !props.shelf) {
    const shelves = catalog.listShelves().filter((sh) => sh.count > 0);
    if (shelves.length > 1) {
      filter = '<nav class="bent-shop-filter" aria-label="מדפים">' +
        '<button type="button" class="bent-shop-chip is-on" data-tz-shelf="" aria-pressed="true">הכול</button>' +
        shelves.map((sh) => `<button type="button" class="bent-shop-chip" data-tz-shelf="${escapeAttr(sh.slug)}" aria-pressed="false">${escapeHtml(sh.label)}</button>`).join('') +
        '</nav>';
    }
  }
  const empty = list.length ? '' : `<p class="bent-shop-empty">${escapeHtml(props.empty || 'עוד אין מוצרים בחנות.')}</p>`;
  return `<section${a.id} class="bent-shop bent-shop-cols-${cols}${a.cls}"${a.style}${a.dir} data-tz-shop>` +
    (title ? `<h2 class="bent-shop-title">${escapeHtml(title)}</h2>` : '') +
    (!s.open && list.length && bool(props.buttons, true) ? CLOSED_NOTE : '') +
    filter +
    (cards ? `<div class="bent-shop-grid">${cards}</div>` : '') +
    empty +
    '</section>';
}

// ── <bent-buy> ─────────────────────────────────────────────────────────

function absolutize(url) {
  if (/^https?:\/\//i.test(url)) return url;
  let base = '';
  try { base = String(require('../config').loadConfig().baseUrl || '').trim().replace(/\/+$/, ''); } catch (e) { base = ''; }
  return base && url.startsWith('/') ? base + url : '';
}

function productJsonLd(pp, url) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: pp.title,
    sku: pp.sku
  };
  if (pp.summary || pp.description) ld.description = String(pp.summary || pp.description).slice(0, 500);
  const images = pp.images.map(absolutize).filter(Boolean);
  if (images.length) ld.image = images;
  const prices = pp.hasVariants ? pp.variants.map((v) => v.price) : [pp.price];
  const offer = {
    '@type': pp.hasVariants && Math.min(...prices) !== Math.max(...prices) ? 'AggregateOffer' : 'Offer',
    priceCurrency: pp.currency,
    availability: pp.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
  };
  if (offer['@type'] === 'AggregateOffer') {
    offer.lowPrice = money.fromMinor(Math.min(...prices));
    offer.highPrice = money.fromMinor(Math.max(...prices));
  } else {
    offer.price = money.fromMinor(prices[0]);
  }
  const abs = url ? absolutize(url) : '';
  if (abs) offer.url = abs;
  ld.offers = offer;
  // `<` escaped: a product name must never close the script element
  return '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
}

/**
 * One product's buy box.
 * props: sku (required), gallery, description
 */
function renderBuy(props = {}, opts = {}) {
  const { settings: S, catalog, pages } = store();
  const s = opts.settings || S.loadSettings();
  const a = attrs(opts);
  const sku = String(props.sku || '').trim().toLowerCase();
  const p = sku ? catalog.getProduct(sku) : null;
  if (!p || p.status !== 'active') {
    return `<section${a.id} class="bent-buy bent-buy-missing${a.cls}"${a.style}${a.dir}>` +
      `<p class="bent-store-closed">${sku ? 'המוצר הזה אינו זמין כרגע.' : 'בחרו מוצר (sku) להצגה.'}</p></section>`;
  }
  const pp = catalog.publicProduct(p, s);
  const uid = 'b' + require('crypto').createHash('sha1').update(pp.sku).digest('hex').slice(0, 8);
  const gallery = bool(props.gallery, true);
  const main = pp.image ? imgTag(pp.image, pp.title, 'bent-buy-main', false) : '<span class="bent-buy-noimg" aria-hidden="true">🛍️</span>';
  const thumbs = gallery && pp.images.length > 1
    ? '<div class="bent-buy-thumbs">' + pp.images.map((src, i) =>
      `<button type="button" class="bent-buy-thumb${i === 0 ? ' is-on' : ''}" data-tz-thumb="${escapeAttr(safeHref(src))}" aria-label="תמונה ${i + 1}">${imgTag(src, '', 'bent-buy-thumb-img', true)}</button>`).join('') + '</div>'
    : '';

  let buy = '';
  if (!s.open) {
    buy = CLOSED_NOTE;
  } else if (!pp.available) {
    buy = '<p class="bent-stock bent-stock-out">אזל מהמלאי</p>';
  } else {
    const variantSel = pp.hasVariants
      ? `<label class="bent-buy-label" for="${uid}-v">אפשרות</label>` +
        `<select id="${uid}-v" class="bent-buy-variant" data-tz-variant required>` +
        '<option value="">בחרו אפשרות…</option>' +
        pp.variants.map((v) => `<option value="${escapeAttr(v.code)}" data-price="${escapeAttr(v.priceText)}" data-max="${v.maxQty}"${v.available ? '' : ' disabled'}>` +
          escapeHtml(v.label + ' — ' + (v.available ? v.priceText : 'אזל')) + '</option>').join('') +
        '</select>'
      : '';
    const max = pp.hasVariants ? 99 : Math.max(1, pp.maxQty);
    buy = variantSel +
      '<div class="bent-buy-row">' +
      `<label class="bent-buy-label" for="${uid}-q">כמות</label>` +
      `<input id="${uid}-q" class="bent-buy-qty" type="number" min="1" max="${max}" value="1" inputmode="numeric" data-tz-qty>` +
      `<button type="button" class="bent-buy-add" data-tz-add data-sku="${escapeAttr(pp.sku)}" data-title="${escapeAttr(pp.title)}">הוספה לעגלה</button>` +
      '</div>' +
      stockHtml(pp);
  }
  const vatLine = s.vatExempt ? '' : (s.pricesIncludeVat ? 'המחירים כוללים מע״מ' : 'המחירים אינם כוללים מע״מ');
  const url = pages.productUrl(pp.sku);
  return `<section${a.id} class="bent-buy${a.cls}"${a.style}${a.dir} data-tz-buy data-sku="${escapeAttr(pp.sku)}">` +
    `<div class="bent-buy-gallery">${main}${thumbs}</div>` +
    '<div class="bent-buy-info">' +
    (pp.badge ? `<span class="bent-shop-badge">${escapeHtml(pp.badge)}</span>` : '') +
    `<h1 class="bent-buy-title">${escapeHtml(pp.title)}</h1>` +
    (pp.shelfLabel ? `<p class="bent-buy-shelf">${escapeHtml(pp.shelfLabel)}</p>` : '') +
    (pp.summary ? `<p class="bent-buy-summary">${escapeHtml(pp.summary)}</p>` : '') +
    `<p class="bent-buy-price" data-tz-price-box>${priceHtml(pp)}</p>` +
    buy +
    (vatLine ? `<p class="bent-buy-vat">${vatLine}</p>` : '') +
    (bool(props.description, true) && pp.description ? `<div class="bent-buy-desc">${paragraphs(pp.description)}</div>` : '') +
    '</div>' +
    productJsonLd(pp, url) +
    '</section>';
}

// ── <bent-cart> / <bent-checkout> / <bent-order> ───────────────────────

const NOSCRIPT = '<noscript><p class="bent-store-closed">כדי להזמין באתר יש להפעיל JavaScript בדפדפן.</p></noscript>';

function renderCart(props = {}, opts = {}) {
  const { settings: S, pages } = store();
  const s = opts.settings || S.loadSettings();
  const a = attrs(opts);
  const u = pages.urls(s);
  return `<section${a.id} class="bent-cart${a.cls}"${a.style}${a.dir} data-tz-cart` +
    ` data-checkout="${escapeAttr(safeHref(props.checkout || u.checkout))}" data-shop="${escapeAttr(safeHref(props.shop || u.shop))}"` +
    ` data-empty="${escapeAttr(props.empty || 'העגלה ריקה — זה הזמן למלא אותה.')}">` +
    (s.open ? '<div class="bent-cart-body" data-tz-cart-body><p class="bent-store-wait">טוען את העגלה…</p></div>' : CLOSED_NOTE) +
    NOSCRIPT + '</section>';
}

function field(name, label, type, auto, required, extra = '') {
  const id = 'tzc-' + name;
  return `<p class="bent-field" data-field="${name}">` +
    `<label for="${id}">${escapeHtml(label)}${required ? ' <span aria-hidden="true">*</span>' : ''}</label>` +
    `<input id="${id}" name="${name}" type="${type}"${auto ? ` autocomplete="${auto}"` : ''}${required ? ' required' : ''}${extra}>` +
    '<span class="bent-field-error" aria-live="polite"></span></p>';
}

function renderCheckout(props = {}, opts = {}) {
  const { settings: S, pages } = store();
  const s = opts.settings || S.loadSettings();
  const a = attrs(opts);
  const u = pages.urls(s);
  if (!s.open) return `<section${a.id} class="bent-checkout${a.cls}"${a.style}${a.dir}>${CLOSED_NOTE}</section>`;
  const fmt = (n) => money.formatMoney(n, s.currency);
  const ships = s.shipping.map((m, i) =>
    `<label class="bent-choice"><input type="radio" name="shipping" value="${escapeAttr(m.id)}" data-address="${m.address ? '1' : '0'}"${i === 0 ? ' checked' : ''}>` +
    `<span class="bent-choice-label">${escapeHtml(m.label)}</span>` +
    `<span class="bent-choice-price" data-tz-ship-price="${escapeAttr(m.id)}">${m.price ? escapeHtml(fmt(m.price)) : 'חינם'}</span>` +
    (m.freeOver ? `<span class="bent-choice-note">חינם בקנייה מעל ${escapeHtml(fmt(m.freeOver))}</span>` : '') +
    (m.note ? `<span class="bent-choice-note">${escapeHtml(m.note)}</span>` : '') +
    '</label>').join('');
  // the gateway decides whether a `card` method is offered at all (and the
  // page is rebuilt whenever its settings change, so the static export agrees)
  const gateway = require('./gateway');
  const offered = gateway.offeredPayments(s);
  const pays = offered.map((m, i) => {
    const details = S.paymentDetails(m);
    return `<label class="bent-choice"><input type="radio" name="payment" value="${escapeAttr(m.id)}" data-kind="${escapeAttr(m.kind)}"${i === 0 ? ' checked' : ''}>` +
      `<span class="bent-choice-label">${escapeHtml(m.label)}</span>` +
      (details ? `<span class="bent-choice-note">${escapeHtml(details)}</span>` : '') +
      (m.kind === 'card' && m.maxPayments > 1 ? `<span class="bent-choice-note">עד ${Number(m.maxPayments)} תשלומים</span>` : '') +
      '</label>';
  }).join('');
  // test mode is said out loud: a shopper must never wonder whether the money was real
  const testBanner = offered.some((m) => m.kind === 'card') && gateway.status(s).mode === 'test'
    ? '<p class="bent-test-banner" role="status">מצב בדיקות — לא יחויב כסף אמיתי</p>' : '';
  const terms = s.terms
    ? `<p class="bent-field bent-field-check" data-field="terms"><label><input type="checkbox" name="acceptTerms" value="on" required> ` +
      `קראתי ואני מסכים/ה ל<a href="${escapeAttr(require('../pages').publicUrlFor(s.terms))}" target="_blank" rel="noopener">תנאי השימוש</a></label>` +
      '<span class="bent-field-error" aria-live="polite"></span></p>'
    : '';
  return `<section${a.id} class="bent-checkout${a.cls}"${a.style}${a.dir} data-tz-checkout` +
    ` data-order="${escapeAttr(safeHref(props.thanks || u.order))}" data-cart="${escapeAttr(u.cart)}" data-shop="${escapeAttr(u.shop)}">` +
    testBanner +
    '<form class="bent-checkout-form" novalidate data-tz-checkout-form>' +
    '<div class="bent-checkout-main">' +
    '<fieldset class="bent-checkout-box"><legend>פרטים ליצירת קשר</legend>' +
    field('name', 'שם מלא', 'text', 'name', true, ' maxlength="80"') +
    field('phone', 'טלפון', 'tel', 'tel', true, ' maxlength="30" inputmode="tel" dir="ltr"') +
    field('email', 'אימייל' + (s.requireEmail ? '' : ' (לאישור ההזמנה)'), 'email', 'email', s.requireEmail, ' maxlength="200" dir="ltr"') +
    '</fieldset>' +
    `<fieldset class="bent-checkout-box" data-tz-ship-box><legend>משלוח</legend><div class="bent-choices">${ships}</div>` +
    '<div class="bent-checkout-address" data-tz-address>' +
    field('city', 'עיר', 'text', 'address-level2', true, ' maxlength="60"') +
    field('street', 'רחוב ומספר בית', 'text', 'street-address', true, ' maxlength="120"') +
    field('zip', 'מיקוד', 'text', 'postal-code', false, ' maxlength="10" inputmode="numeric" dir="ltr"') +
    field('notes', 'הערות לשליח (קומה, דירה, קוד כניסה)', 'text', '', false, ' maxlength="200"') +
    '</div></fieldset>' +
    `<fieldset class="bent-checkout-box"><legend>תשלום</legend><div class="bent-choices">${pays}</div></fieldset>` +
    '<p class="bent-field" data-field="note"><label for="tzc-note">הערה להזמנה</label>' +
    '<textarea id="tzc-note" name="note" rows="3" maxlength="1000"></textarea></p>' +
    terms +
    // the honeypot: humans never see it, a bot fills it, and the server pretends to take the order
    '<p class="bent-hp" aria-hidden="true"><label>אל תמלאו שדה זה <input type="text" name="_hp" tabindex="-1" autocomplete="off"></label></p>' +
    '</div>' +
    '<aside class="bent-checkout-summary" aria-label="סיכום ההזמנה">' +
    '<h2 class="bent-checkout-h">ההזמנה שלך</h2>' +
    '<div data-tz-summary><p class="bent-store-wait">טוען את העגלה…</p></div>' +
    '<p class="bent-coupon"><label for="tzc-coupon">קוד קופון</label><span class="bent-coupon-row">' +
    '<input id="tzc-coupon" name="coupon" type="text" maxlength="32" autocomplete="off" dir="ltr">' +
    '<button type="button" class="bent-coupon-apply" data-tz-coupon>הפעלה</button></span>' +
    '<span class="bent-coupon-msg" data-tz-coupon-msg aria-live="polite"></span></p>' +
    '<p class="bent-checkout-error" data-tz-error role="alert"></p>' +
    '<button type="submit" class="bent-checkout-submit" data-tz-submit>לביצוע ההזמנה</button>' +
    '</aside></form>' + NOSCRIPT + '</section>';
}

function renderOrder(props = {}, opts = {}) {
  const { settings: S, pages } = store();
  const s = opts.settings || S.loadSettings();
  const a = attrs(opts);
  const u = pages.urls(s);
  return `<section${a.id} class="bent-order${a.cls}"${a.style}${a.dir} data-tz-order data-shop="${escapeAttr(safeHref(props.shop || u.shop))}">` +
    '<div data-tz-order-body><p class="bent-store-wait">טוען את ההזמנה…</p></div>' + NOSCRIPT + '</section>';
}

// ── site chrome ────────────────────────────────────────────────────────

const CART_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7.2 14.8h9.9c.75 0 1.4-.41 1.75-1.03l3.12-5.66A1 1 0 0 0 21.1 6.6H5.2L4.27 4.6A1 1 0 0 0 3.36 4H1v2h1.73l3.6 7.59-1.35 2.44A1.99 1.99 0 0 0 6.73 19H19v-2H7.43a.25.25 0 0 1-.22-.37l.8-1.43z"/></svg>';

/** The header's cart button (only while the store is open). */
function renderHeaderCart(settings) {
  const s = settings || require('./settings').loadSettings();
  if (!s.open) return '';
  const u = require('./pages').urls(s);
  return `<a class="tz-cart-link" href="${escapeAttr(u.cart)}" aria-label="עגלת קניות" title="עגלת קניות">${CART_ICON}` +
    '<span class="tz-cart-count" data-tz-count hidden>0</span></a>';
}

/** The storefront script tag (only while the store is open). */
function renderStoreTag(settings) {
  const s = settings || require('./settings').loadSettings();
  if (!s.open) return '';
  const u = require('./pages').urls(s);
  let v = '';
  try { v = require('../build-info').assetVersion(); } catch (e) { v = ''; }
  return `<script src="/tz-store.js${v ? '?v=' + encodeURIComponent(v) : ''}" defer` +
    ` data-cart="${escapeAttr(u.cart)}" data-checkout="${escapeAttr(u.checkout)}" data-order="${escapeAttr(u.order)}" data-shop="${escapeAttr(u.shop)}"></script>`;
}

module.exports = {
  renderShop,
  renderBuy,
  renderCart,
  renderCheckout,
  renderOrder,
  renderHeaderCart,
  renderStoreTag,
  productJsonLd,
  CART_ICON
};
