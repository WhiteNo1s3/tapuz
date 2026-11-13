'use strict';

/**
 * The storefront's HTML — what <bent-shop>, <bent-shelves>, <bent-buy>,
 * <bent-cart>, <bent-checkout> and <bent-order> compile to, plus the
 * header's cart button and the storefront script tag.
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
const paypal = require('./paypal');

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

function oneOf(v, list, fallback) {
  return list.includes(String(v)) ? String(v) : fallback;
}

/** "3 מוצרים" — and the one Hebrew says differently. */
function countText(n) {
  return n === 1 ? 'מוצר אחד' : `${Number(n)} מוצרים`;
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

/** The stock line in words: nothing while there is plenty, the singular for the last one. */
function stockText(pp) {
  if (pp.stockState === 'out') return 'אזל מהמלאי';
  if (pp.stockState === 'low' && pp.stockLeft) {
    return Number(pp.stockLeft) === 1 ? 'נותרה יחידה אחרונה' : `נותרו ${Number(pp.stockLeft)} במלאי`;
  }
  return '';
}

function stockHtml(pp) {
  const text = stockText(pp);
  if (!text) return '';
  return `<p class="bent-stock bent-stock-${pp.stockState === 'out' ? 'out' : 'low'}">${text}</p>`;
}

/** "-35%" beside a price that was cut. dir=ltr: in a Hebrew line the minus would land after the number. */
function saleBadge(pp) {
  return pp.salePercent ? `<span class="bent-shop-badge is-sale" dir="ltr">-${Number(pp.salePercent)}%</span>` : '';
}

const CLOSED_NOTE = '<p class="bent-store-closed">החנות סגורה כרגע להזמנות — אפשר להתרשם מהמוצרים, ונחזור בקרוב.</p>';

// ── <bent-shop> ────────────────────────────────────────────────────────

const SORT_CHOICES = [
  ['', 'מומלץ'],
  ['new', 'חדשים קודם'],
  ['price-asc', 'מחיר: מהנמוך לגבוה'],
  ['price-desc', 'מחיר: מהגבוה לנמוך'],
  ['name', 'שם']
];

/**
 * The products a grid shows. `skus` names them one by one, in the order
 * written — a curated strip; otherwise the catalog picks, by shelf (and its
 * sub-categories), tag, brand or the featured star. Either way ACTIVE
 * products only: a strip that names a draft or a hidden product used to
 * publish its name, summary and price as a "sold out" card. (The admin's
 * look at ONE product before it is live hands this function that product
 * already marked active — asLive, src/routes/store-products.js.)
 */
function shopProducts(catalog, props, limit) {
  const exclude = String(props.exclude || '').trim().toLowerCase();
  const skus = String(props.skus || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (skus.length) {
    const seen = new Set();
    const out = [];
    for (const sku of skus) {
      if (seen.has(sku) || sku === exclude) continue;
      seen.add(sku);
      const p = catalog.getProductBySlug(sku);
      if (p && p.status === 'active') out.push(p);
    }
    return limit ? out.slice(0, limit) : out;
  }
  return catalog.listProducts({
    status: 'active',
    shelf: props.shelf || '',
    exclude: props.exclude || '',
    tag: props.tag || '',
    brand: props.brand || '',
    featured: bool(props.featured, false),
    sort: props.sort || 'manual',
    limit: limit || 500
  });
}

/**
 * The catalog grid.
 * props: shelf, columns (2–4), limit (0 = all), sort, filter, title, exclude, buttons, empty,
 *        media (square|portrait|landscape), fit (cover|contain), justify (start|center),
 *        sorter, search, page-size (0 = all, 4–48), tag, brand, featured, skus
 *
 * Every card is the SAME six rows in the same order — brand, name, summary,
 * price, stock note, action — whether or not the product has a summary, a
 * brand or a stock line: that (with the CSS that pins the price row) is what
 * keeps a row of cards on one level. The owner: "align the product so they
 * all at same level".
 */
function renderShop(props = {}, opts = {}) {
  const { settings: S, catalog, pages } = store();
  const s = opts.settings || S.loadSettings();
  const a = attrs(opts);
  const cols = [2, 3, 4].includes(Number(props.columns)) ? Number(props.columns) : 3;
  const limit = Math.min(Math.max(parseInt(props.limit, 10) || 0, 0), 48);
  const list = shopProducts(catalog, props, limit);
  const title = String(props.title || '').trim();
  // a titled strip with nothing in it ("עוד מהחנות" on the only product) disappears whole
  if (!list.length && title) return '';
  const published = pages.publishedProductPaths();
  const buttons = bool(props.buttons, true) && s.open;
  // the sort, the search and "show more" are the storefront script's work,
  // and the script is on the page only while the store is open
  const live = !!s.open;
  const rawSize = parseInt(props.pageSize !== undefined ? props.pageSize : props['page-size'], 10) || 0;
  const pageSize = live && rawSize > 0 ? Math.min(Math.max(rawSize, 4), 48) : 0;
  const paged = pageSize > 0 && list.length > pageSize;

  const view = list.map((p) => catalog.publicProduct(p, s));
  // "חדשים קודם" needs an order, not the row id (a shopper is never told one)
  const byAge = list.map((p, i) => ({ id: p.id, i })).sort((x, y) => y.id - x.id);
  const fresh = [];
  byAge.forEach((x, n) => { fresh[x.i] = n; });
  const anyBrand = view.some((pp) => pp.brand);
  const anySummary = view.some((pp) => pp.summary);

  const cards = view.map((pp, i) => {
    const url = pages.productUrl(pp.sku, published);
    const href = url ? escapeAttr(url) : '';
    let action = '';
    if (buttons) {
      if (!pp.available) {
        action = '<button type="button" class="bent-shop-add is-out" disabled>אזל מהמלאי</button>';
      } else if (pp.hasVariants) {
        // options are chosen on the product's page; with no page to send the
        // shopper to, the row is kept (empty) so the card stays on the level
        action = href ? `<a class="bent-shop-add" href="${href}">לבחירת אפשרות</a>` : '<span class="bent-shop-add is-none" aria-hidden="true">&nbsp;</span>';
      } else {
        action = `<button type="button" class="bent-shop-add" data-tz-add data-sku="${escapeAttr(pp.sku)}" data-title="${escapeAttr(pp.title)}" data-max="${Number(pp.maxQty) || 1}">הוספה לעגלה</button>`;
      }
    }
    // the stock note never repeats what the action already says
    const note = pp.available ? stockText(pp) : (buttons ? '' : 'אזל מהמלאי');
    const noteCls = !note ? '' : (pp.available ? ' is-low' : ' is-out');
    const picture = pp.image ? imgTag(pp.image, pp.title, 'bent-shop-img', true) : '<span class="bent-shop-noimg" aria-hidden="true">🛍️</span>';
    const prices = pp.hasVariants ? pp.variants.map((v) => v.price) : [pp.price];
    return `<article class="bent-shop-card${pp.available ? '' : ' is-out'}${pp.featured ? ' is-featured' : ''}"` +
      ` data-shelf="${escapeAttr(pp.shelf)}" data-shelves="${escapeAttr(pp.shelves.join(' '))}"` +
      ` data-price="${Math.min(...prices)}" data-title="${escapeAttr(pp.title)}" data-rank="${i}" data-new="${fresh[i]}"` +
      // tags are joined with the one character a tag can never hold (the catalog splits on it)
      ` data-tags="${escapeAttr(pp.tags.join(','))}" data-brand="${escapeAttr(pp.brand)}"${paged && i >= pageSize ? ' hidden' : ''}>` +
      // the picture link is a second door to the same page: the title is the one tab stop
      (href ? `<a class="bent-shop-media" href="${href}" tabindex="-1" aria-hidden="true">${picture}</a>` : `<span class="bent-shop-media">${picture}</span>`) +
      `<div class="bent-shop-badges">${pp.badge ? `<span class="bent-shop-badge">${escapeHtml(pp.badge)}</span>` : ''}${saleBadge(pp)}</div>` +
      '<div class="bent-shop-body">' +
      `<p class="bent-shop-brand">${escapeHtml(pp.brand)}</p>` +
      `<h3 class="bent-shop-name">${href
        ? `<a class="bent-shop-link" href="${href}" title="${escapeAttr(pp.title)}">${escapeHtml(pp.title)}</a>`
        : `<span class="bent-shop-link" title="${escapeAttr(pp.title)}">${escapeHtml(pp.title)}</span>`}</h3>` +
      `<p class="bent-shop-summary">${escapeHtml(pp.summary)}</p>` +
      `<p class="bent-shop-price">${priceHtml(pp)}</p>` +
      `<p class="bent-shop-note${noteCls}">${note}</p>` +
      action +
      '</div></article>';
  }).join('');

  // the chips: the top-level categories a shopper is shown, in the catalog's
  // order. A chip is a LINK to the category's page when that page is live —
  // the script filters in place and the link still works without it.
  let chips = '';
  if (bool(props.filter, false) && !props.shelf && !props.skus) {
    const shelfUrls = pages.liveShelfUrls();
    const tops = catalog.listShelves({ visible: true }).filter((sh) => sh.depth === 0 && sh.total > 0);
    const shown = live ? tops : tops.filter((sh) => shelfUrls.has(sh.slug));
    if (tops.length > 1 && shown.length) {
      const chip = (slug, label, on) => {
        const url = slug ? shelfUrls.get(slug) : (live ? '' : pages.urls(s).shop);
        return url
          ? `<a class="bent-shop-chip${on ? ' is-on' : ''}" href="${escapeAttr(url)}" data-tz-shelf="${escapeAttr(slug)}"${on ? ' aria-current="true"' : ''}>${escapeHtml(label)}</a>`
          : `<button type="button" class="bent-shop-chip${on ? ' is-on' : ''}" data-tz-shelf="${escapeAttr(slug)}" aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
      };
      chips = '<nav class="bent-shop-filter" aria-label="קטגוריות">' + chip('', 'הכול', true) +
        shown.map((sh) => chip(sh.slug, sh.label, false)).join('') + '</nav>';
    }
  }
  const tools = [];
  if (live && list.length > 1 && bool(props.search, false)) {
    tools.push('<label class="bent-shop-search"><span class="bent-store-sr">חיפוש בחנות</span>' +
      '<input type="search" class="bent-shop-input" data-tz-search placeholder="חיפוש…" autocomplete="off" enterkeyhint="search"></label>');
  }
  if (live && list.length > 1 && bool(props.sorter, false)) {
    tools.push('<label class="bent-shop-sort"><span class="bent-shop-sort-label">מיון</span>' +
      '<select class="bent-shop-select" data-tz-sort>' +
      SORT_CHOICES.map(([v, label]) => `<option value="${v}">${label}</option>`).join('') + '</select></label>');
  }
  const toolbar = chips || tools.length
    ? `<div class="bent-shop-toolbar">${chips}${tools.length ? `<div class="bent-shop-tools">${tools.join('')}</div>` : ''}</div>`
    : '';
  // what the script fills and flips: the filter in force (a tag link lands
  // here), the count line, the nothing-found note and "show more"
  const dynamic = live && list.length
    ? { before: '<div class="bent-shop-active" data-tz-shop-active hidden></div>' +
        `<p class="bent-shop-count" data-tz-shop-count${paged ? '' : ' hidden'}>${paged ? `מציג ${pageSize} מתוך ${list.length}` : ''}</p>` +
        '<p class="bent-store-sr" role="status" aria-live="polite" data-tz-shop-live></p>',
      after: '<div class="bent-shop-none" data-tz-shop-none hidden><p>לא נמצאו מוצרים מתאימים</p>' +
        '<button type="button" class="bent-btn bent-btn-ghost" data-tz-clear>ניקוי</button></div>' +
        `<div class="bent-shop-more"${paged ? '' : ' hidden'} data-tz-more-row><button type="button" class="bent-btn bent-btn-ghost" data-tz-more>` +
        `הצגת עוד (${paged ? Math.min(pageSize, list.length - pageSize) : 0})</button></div>` }
    : { before: '', after: '' };

  const media = oneOf(props.media, ['square', 'portrait', 'landscape'], 'square');
  const cls = `bent-shop bent-shop-cols-${cols}` +
    (media !== 'square' ? ` bent-shop-media-${media}` : '') +
    (oneOf(props.fit, ['cover', 'contain'], 'cover') === 'contain' ? ' bent-shop-fit-contain' : '') +
    (oneOf(props.justify, ['start', 'center'], 'start') === 'center' ? ' bent-shop-center' : '') +
    // a row nobody fills is not reserved: no brand line in a shop without brands
    (anyBrand ? '' : ' bent-shop-nobrand') + (anySummary ? '' : ' bent-shop-nosummary');
  const empty = list.length ? '' : `<p class="bent-shop-empty">${escapeHtml(props.empty || 'עוד אין מוצרים בחנות.')}</p>`;
  // a category link from another page (?shelf=…) is named in words by the
  // script; it is handed the names of the categories on this grid
  let names = '';
  if (live && list.length) {
    const onGrid = new Set(view.flatMap((pp) => pp.shelves));
    const map = {};
    for (const sh of catalog.listShelves({ visible: true })) if (onGrid.has(sh.slug)) map[sh.slug] = sh.label;
    if (Object.keys(map).length) names = ` data-shelf-names="${escapeAttr(JSON.stringify(map))}"`;
  }
  return `<section${a.id} class="${cls}${a.cls}"${a.style}${a.dir} data-tz-shop${pageSize ? ` data-page-size="${pageSize}"` : ''}${names}>` +
    (title ? `<h2 class="bent-shop-title">${escapeHtml(title)}</h2>` : '') +
    (!s.open && list.length && bool(props.buttons, true) ? CLOSED_NOTE : '') +
    toolbar +
    dynamic.before +
    (cards ? `<div class="bent-shop-grid">${cards}</div>` : '') +
    dynamic.after +
    empty +
    '</section>';
}

// ── <bent-shelves> ─────────────────────────────────────────────────────

/**
 * Category tiles: a picture, the name, how many products.
 * props: parent ('' = the top level; a slug = that category's sub-categories),
 *        columns (2–6), title, counts, summaries, justify (start|center)
 *
 * A category the shopper is not shown (hidden) or that holds no active
 * product has no tile. A tile leads to the category's own page when it is
 * live, else to the shop page filtered to it.
 */
function renderShelves(props = {}, opts = {}) {
  const { settings: S, catalog, pages } = store();
  const s = opts.settings || S.loadSettings();
  const a = attrs(opts);
  const cols = Math.min(Math.max(parseInt(props.columns, 10) || 3, 2), 6);
  const parent = String(props.parent || '').trim().toLowerCase();
  const shelves = catalog.listShelves({ visible: true })
    .filter((sh) => sh.total > 0 && (parent ? sh.parent === parent : sh.depth === 0));
  const title = String(props.title || '').trim();
  if (!shelves.length) {
    // like the grid: a titled strip with nothing in it disappears whole
    return title ? '' : `<section${a.id} class="bent-shelves${a.cls}"${a.style}${a.dir}><p class="bent-shop-empty">עוד אין קטגוריות להצגה.</p></section>`;
  }
  const urls = pages.liveShelfUrls();
  const counts = bool(props.counts, true);
  const summaries = bool(props.summaries, false);
  const tiles = shelves.map((sh) => {
    // its own picture, else the first product picture on it
    let image = sh.image;
    if (!image) {
      const withPicture = catalog.listProducts({ status: 'active', shelf: sh.slug, limit: 24 }).find((p) => p.images[0]);
      image = withPicture ? withPicture.images[0] : '';
    }
    const url = urls.get(sh.slug) || pages.shopLink(s, 'shelf', sh.slug);
    return `<a class="bent-shelf-tile" href="${escapeAttr(url)}">` +
      `<span class="bent-shelf-media">${(image && imgTag(image, '', 'bent-shelf-img', true)) || '<span class="bent-shelf-noimg" aria-hidden="true">🗂️</span>'}</span>` +
      '<span class="bent-shelf-body">' +
      `<span class="bent-shelf-name">${escapeHtml(sh.label)}</span>` +
      (counts ? `<span class="bent-shelf-count">${countText(sh.total)}</span>` : '') +
      (summaries ? `<span class="bent-shelf-summary">${escapeHtml(sh.summary)}</span>` : '') +
      '</span></a>';
  }).join('');
  const cls = `bent-shelves bent-shelves-cols-${cols}` +
    (oneOf(props.justify, ['start', 'center'], 'start') === 'center' ? ' bent-shelves-center' : '');
  return `<section${a.id} class="${cls}${a.cls}"${a.style}${a.dir}>` +
    (title ? `<h2 class="bent-shelves-title">${escapeHtml(title)}</h2>` : '') +
    `<div class="bent-shelves-grid">${tiles}</div></section>`;
}

// ── <bent-buy> ─────────────────────────────────────────────────────────

function absolutize(url) {
  if (/^https?:\/\//i.test(url)) return url;
  let base = '';
  try { base = String(require('../config').loadConfig().baseUrl || '').trim().replace(/\/+$/, ''); } catch (e) { base = ''; }
  return base && url.startsWith('/') ? base + url : '';
}

/** A JSON-LD script element. `<` escaped: a product name must never close the script element. */
function ldScript(ld) {
  return '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>';
}

/**
 * schema.org Product for one product.
 * @param {object} pp       catalog.publicProduct()
 * @param {string} url      the product page's address ('' when it has none)
 * @param {{storeName?:string}} [ctx]  the store's name is the brand of a product that names none
 */
function productJsonLd(pp, url, ctx = {}) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: pp.title,
    sku: pp.sku
  };
  if (pp.summary || pp.description) ld.description = String(pp.summary || pp.description).slice(0, 500);
  const brand = pp.brand || ctx.storeName || '';
  if (brand) ld.brand = { '@type': 'Brand', name: brand };
  // a barcode is a GTIN only at the four lengths the standard knows
  if (/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(pp.barcode || '')) ld.gtin = pp.barcode;
  const images = pp.images.map(absolutize).filter(Boolean);
  if (images.length) ld.image = images;
  const abs = url ? absolutize(url) : '';
  if (abs) ld.url = abs;
  const prices = pp.hasVariants ? pp.variants.map((v) => v.price) : [pp.price];
  const offer = {
    '@type': pp.hasVariants && Math.min(...prices) !== Math.max(...prices) ? 'AggregateOffer' : 'Offer',
    priceCurrency: pp.currency,
    availability: pp.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition'
  };
  if (offer['@type'] === 'AggregateOffer') {
    offer.lowPrice = money.fromMinor(Math.min(...prices));
    offer.highPrice = money.fromMinor(Math.max(...prices));
    offer.offerCount = pp.variants.length;
  } else {
    offer.price = money.fromMinor(prices[0]);
  }
  if (abs) offer.url = abs;
  ld.offers = offer;
  return ldScript(ld);
}

/** schema.org BreadcrumbList: [{ name, url }] — a step's address is said only when it is absolute. */
function breadcrumbJsonLd(steps) {
  return ldScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: steps.map((st, i) => {
      const item = { '@type': 'ListItem', position: i + 1, name: st.name };
      const abs = st.url ? absolutize(st.url) : '';
      if (abs) item.item = abs;
      return item;
    })
  });
}

/**
 * The Open Graph product tags for a product page's <head> (the renderer adds
 * them and says og:type=product) — '' when the product is not on sale, so a
 * page whose product left stays an ordinary page.
 */
function productHeadTags(sku, settings) {
  const { settings: S, catalog } = store();
  const s = settings || S.loadSettings();
  const p = catalog.getProductBySlug(String(sku || ''));
  if (!p || p.status !== 'active') return '';
  const pp = catalog.publicProduct(p, s);
  const prices = pp.hasVariants ? pp.variants.map((v) => v.price) : [pp.price];
  return [
    `<meta property="product:price:amount" content="${escapeAttr(money.fromMinor(Math.min(...prices)))}">`,
    `<meta property="product:price:currency" content="${escapeAttr(pp.currency)}">`,
    `<meta property="product:availability" content="${pp.available ? 'in stock' : 'out of stock'}">`
  ].join('\n  ');
}

/** The same − / + stepper the cart has, server-rendered for the buy box. */
function qtyStepper(id, max) {
  return '<span class="bent-qty" role="group" aria-label="כמות">' +
    '<button type="button" class="bent-qty-btn" data-tz-step="-1" aria-label="הפחתת הכמות">−</button>' +
    `<input id="${id}" class="bent-qty-input" type="number" min="1" max="${max}" value="1" inputmode="numeric" aria-label="כמות" data-tz-qty>` +
    '<button type="button" class="bent-qty-btn" data-tz-step="1" aria-label="הגדלת הכמות">+</button>' +
    '</span>';
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
    ? '<div class="bent-buy-thumbs" role="group" aria-label="תמונות המוצר">' + pp.images.map((src, i) =>
      `<button type="button" class="bent-buy-thumb${i === 0 ? ' is-on' : ''}" data-tz-thumb="${escapeAttr(safeHref(src))}"` +
      ` aria-label="תמונה ${i + 1} מתוך ${pp.images.length}"${i === 0 ? ' aria-current="true"' : ''}>${imgTag(src, '', 'bent-buy-thumb-img', true)}</button>`).join('') + '</div>'
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
      qtyStepper(`${uid}-q`, max) +
      `<button type="button" class="bent-buy-add" data-tz-add data-sku="${escapeAttr(pp.sku)}" data-title="${escapeAttr(pp.title)}" data-max="${max}">הוספה לעגלה</button>` +
      '</div>' +
      stockHtml(pp);
  }
  const vatLine = s.vatExempt ? '' : (s.pricesIncludeVat ? 'המחירים כוללים מע״מ' : 'המחירים אינם כוללים מע״מ');
  const url = pages.productUrl(pp.sku);
  const u = pages.urls(s);
  // the category as links (parent › child) — a category the shopper is not
  // shown is not named; one without a page of its own leads to the shop, filtered
  const shelfUrls = pages.liveShelfUrls();
  const shown = new Set(catalog.listShelves({ visible: true }).map((sh) => sh.slug));
  const steps = pp.shelfPath.filter((st) => shown.has(st.slug))
    .map((st) => ({ name: st.label, url: shelfUrls.get(st.slug) || pages.shopLink(s, 'shelf', st.slug) }));
  const shelfLine = steps.length
    ? '<p class="bent-buy-shelf">' + steps.map((st) => `<a class="bent-buy-shelf-link" href="${escapeAttr(st.url)}">${escapeHtml(st.name)}</a>`)
      .join('<span class="bent-buy-shelf-sep" aria-hidden="true">›</span>') + '</p>'
    : '';
  const tags = pp.tags.length
    ? '<p class="bent-buy-tags">' + pp.tags.map((t) => `<a class="bent-buy-tag" href="${escapeAttr(pages.shopLink(s, 'tag', t))}">${escapeHtml(t)}</a>`).join('') + '</p>'
    : '';
  const facts = `<p class="bent-buy-fact">מק״ט: <bdi dir="ltr">${escapeHtml(pp.sku)}</bdi></p>` +
    (pp.barcode ? `<p class="bent-buy-fact">ברקוד: <bdi dir="ltr">${escapeHtml(pp.barcode)}</bdi></p>` : '');
  const crumbs = [{ name: S.storeName(s), url: u.shop }].concat(steps, [{ name: pp.title, url }]);
  return `<section${a.id} class="bent-buy${a.cls}"${a.style}${a.dir} data-tz-buy data-sku="${escapeAttr(pp.sku)}" data-title="${escapeAttr(pp.title)}">` +
    `<div class="bent-buy-gallery">${main}${thumbs}</div>` +
    '<div class="bent-buy-info">' +
    (pp.badge ? `<span class="bent-shop-badge">${escapeHtml(pp.badge)}</span>` : '') +
    (pp.brand ? `<p class="bent-buy-brand">${escapeHtml(pp.brand)}</p>` : '') +
    `<h1 class="bent-buy-title">${escapeHtml(pp.title)}</h1>` +
    shelfLine +
    (pp.summary ? `<p class="bent-buy-summary">${escapeHtml(pp.summary)}</p>` : '') +
    `<p class="bent-buy-price" data-tz-price-box>${priceHtml(pp)}${saleBadge(pp)}</p>` +
    buy +
    (vatLine ? `<p class="bent-buy-vat">${vatLine}</p>` : '') +
    `<div class="bent-buy-facts">${facts}</div>` +
    tags +
    (bool(props.description, true) && pp.description ? `<div class="bent-buy-desc">${paragraphs(pp.description)}</div>` : '') +
    '</div>' +
    productJsonLd(pp, url, { storeName: S.storeName(s) }) +
    breadcrumbJsonLd(crumbs) +
    '</section>';
}

// ── <bent-cart> / <bent-checkout> / <bent-order> ───────────────────────

const NOSCRIPT = '<noscript><p class="bent-store-closed">כדי להזמין באתר יש להפעיל JavaScript בדפדפן.</p></noscript>';

function renderCart(props = {}, opts = {}) {
  const { settings: S, pages } = store();
  const s = opts.settings || S.loadSettings();
  const a = attrs(opts);
  // where the cart leads is the store's own knowledge (settings.pages — the
  // flip keeps it true): a per-module address could only ever disagree with it
  const u = pages.urls(s);
  return `<section${a.id} class="bent-cart${a.cls}"${a.style}${a.dir} data-tz-cart` +
    ` data-checkout="${escapeAttr(u.checkout)}" data-shop="${escapeAttr(u.shop)}"` +
    ` data-empty="${escapeAttr(props.empty || 'העגלה ריקה — זה הזמן למלא אותה.')}">` +
    (s.open ? '<div class="bent-cart-body" data-tz-cart-body aria-busy="true"><p class="bent-store-wait">טוען את העגלה…</p></div>' +
      // what a change did (the new count, the new sum) is SAID here — beside
      // the body, never inside it: the script rebuilds the body whole, and a
      // live region that is rebuilt with its message is not read out
      '<p class="bent-store-sr" role="status" aria-live="polite" data-tz-cart-live></p>' : CLOSED_NOTE) +
    NOSCRIPT + '</section>';
}

function field(name, label, type, auto, required, extra = '') {
  const id = 'tzc-' + name;
  // the error line is the field's description from the start (empty until it
  // is marked), so a screen reader hears the reason with the field
  return `<p class="bent-field" data-field="${name}">` +
    `<label for="${id}">${escapeHtml(label)}${required ? ' <span aria-hidden="true">*</span>' : ''}</label>` +
    `<input id="${id}" name="${name}" type="${type}"${auto ? ` autocomplete="${auto}"` : ''}${required ? ' required' : ''} aria-describedby="${id}-err"${extra}>` +
    `<span class="bent-field-error" id="${id}-err" aria-live="polite"></span></p>`;
}

const NO_PAYMENT_NOTE = 'אין כרגע אמצעי תשלום זמין — אי אפשר להשלים הזמנה.';

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
  const offered = paypal.offeredPayments(s);
  const pays = offered.map((m, i) => {
    const details = S.paymentDetails(m);
    return `<label class="bent-choice"><input type="radio" name="payment" value="${escapeAttr(m.id)}" data-kind="${escapeAttr(m.kind)}"${i === 0 ? ' checked' : ''}>` +
      `<span class="bent-choice-label">${escapeHtml(m.label)}</span>` +
      (details ? `<span class="bent-choice-note">${escapeHtml(details)}</span>` : '') +
      (m.kind === 'card' && m.maxPayments > 1 ? `<span class="bent-choice-note">עד ${Number(m.maxPayments)} תשלומים</span>` : '') +
      '</label>';
  }).join('');
  // test mode is said out loud: a shopper must never wonder whether the money was real
  const cardTest = offered.some((m) => m.kind === 'card') && gateway.status(s).mode === 'test';
  const paypalTest = offered.some((m) => m.kind === 'paypal') && paypal.status(s).sandbox;
  const testBanner = (cardTest || paypalTest)
    ? '<p class="bent-test-banner" role="status">' + (cardTest
      ? 'מצב בדיקות — לא יחויב כסף אמיתי'
      : 'ארגז חול של PayPal — לא יחויב כסף אמיתי') + '</p>'
      + (cardTest && paypalTest ? '<p class="bent-test-banner" role="status">ארגז חול של PayPal — לא יחויב כסף אמיתי</p>' : '')
    : '';
  const terms = s.terms
    ? `<p class="bent-field bent-field-check" data-field="terms"><label><input type="checkbox" name="acceptTerms" value="on" required aria-describedby="tzc-terms-err"> ` +
      `קראתי ואני מסכים/ה ל<a href="${escapeAttr(require('../pages').publicUrlFor(s.terms))}" target="_blank" rel="noopener">תנאי השימוש</a></label>` +
      '<span class="bent-field-error" id="tzc-terms-err" aria-live="polite"></span></p>'
    : '';
  return `<section${a.id} class="bent-checkout${a.cls}"${a.style}${a.dir} data-tz-checkout` +
    ` data-order="${escapeAttr(u.order)}" data-cart="${escapeAttr(u.cart)}" data-shop="${escapeAttr(u.shop)}">` +
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
    // nothing to pay with is said in words: an empty box under "תשלום" reads as a broken page
    `<fieldset class="bent-checkout-box"><legend>תשלום</legend><div class="bent-choices" data-tz-pay-choices>${pays || `<p class="bent-pay-none">${NO_PAYMENT_NOTE}</p>`}</div></fieldset>` +
    '<p class="bent-field" data-field="note"><label for="tzc-note">הערה להזמנה</label>' +
    '<textarea id="tzc-note" name="note" rows="3" maxlength="1000"></textarea></p>' +
    terms +
    // the honeypot: humans never see it, a bot fills it, and the server pretends to take the order
    '<p class="bent-hp" aria-hidden="true"><label>אל תמלאו שדה זה <input type="text" name="_hp" tabindex="-1" autocomplete="off"></label></p>' +
    '</div>' +
    '<aside class="bent-checkout-summary" aria-label="סיכום ההזמנה">' +
    '<h2 class="bent-checkout-h">ההזמנה שלך</h2>' +
    '<div data-tz-summary aria-busy="true"><p class="bent-store-wait">טוען את העגלה…</p></div>' +
    '<p class="bent-coupon"><label for="tzc-coupon">קוד קופון</label><span class="bent-coupon-row">' +
    '<input id="tzc-coupon" name="coupon" type="text" maxlength="32" autocomplete="off" dir="ltr">' +
    '<button type="button" class="bent-coupon-apply" data-tz-coupon>הפעלה</button></span>' +
    '<span class="bent-coupon-msg" data-tz-coupon-msg aria-live="polite"></span></p>' +
    '<p class="bent-checkout-error" data-tz-error role="alert"></p>' +
    `<button type="submit" class="bent-checkout-submit" data-tz-submit aria-describedby="tzc-why"${pays ? '' : ' disabled'}>לביצוע ההזמנה</button>` +
    // why the button is off, beside it (no way to pay, a sum too large to charge)
    `<p class="bent-checkout-why" id="tzc-why" data-tz-why>${pays ? '' : NO_PAYMENT_NOTE}</p>` +
    '</aside></form>' + NOSCRIPT + '</section>';
}

function renderOrder(props = {}, opts = {}) {
  const { settings: S, pages } = store();
  const s = opts.settings || S.loadSettings();
  const a = attrs(opts);
  const u = pages.urls(s);
  return `<section${a.id} class="bent-order${a.cls}"${a.style}${a.dir} data-tz-order data-shop="${escapeAttr(u.shop)}">` +
    '<div data-tz-order-body aria-busy="true"><p class="bent-store-wait">טוען את ההזמנה…</p></div>' + NOSCRIPT + '</section>';
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
  renderShelves,
  renderBuy,
  renderCart,
  renderCheckout,
  renderOrder,
  renderHeaderCart,
  renderStoreTag,
  productJsonLd,
  breadcrumbJsonLd,
  productHeadTags,
  NO_PAYMENT_NOTE,
  CART_ICON
};
