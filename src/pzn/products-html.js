'use strict';

/**
 * Product / teaser grid — title, price, image, url. CSS-only, no cart.
 * A marketer edits the catalog on the canvas; published HTML stays zero-JS.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

// the openings a product is built from — named once, because the grid reads
// them back (levelProducts) and the two must never drift apart
const MEDIA_OPEN = '<div class="bent-product-media">';
const BODY_OPEN = '<div class="bent-product-body">';
const MEDIA_EMPTY = '<div class="bent-product-media bent-product-media-empty" aria-hidden="true"></div>';
// a product that opens straight with its body: it has no picture
const PRODUCT_WITHOUT_MEDIA = new RegExp('(<(?:a|article) class="bent-product"[^>]*>)(?=' + BODY_OPEN + ')', 'g');

function renderProduct(props = {}) {
  const href = safeHref(props.url || props.href || '');
  const title = escapeHtml(props.title || '');
  const price = escapeHtml(props.price || '');
  const img = props.image
    ? `<img class="bent-product-image" src="${escapeAttr(safeHref(props.image))}" alt="${escapeAttr(props.alt || props.title || '')}" />`
    : '';
  const inner =
    (img ? `${MEDIA_OPEN}${img}</div>` : '') +
    BODY_OPEN +
      (title ? `<h3 class="bent-product-title">${title}</h3>` : '') +
      (price ? `<p class="bent-product-price">${price}</p>` : '') +
    `</div>`;
  if (href && href !== '#') {
    return `<a class="bent-product" href="${escapeAttr(href)}">${inner}</a>`;
  }
  return `<article class="bent-product">${inner}</article>`;
}

/**
 * Titles on one level (v2.69). A product without a picture, in a grid where
 * a sibling HAS one, opened straight with its body — measured in one row:
 * titles at y 4403 and 4707. Such a product gets an empty media box of the
 * same square shape (the stylesheet gives it the ratio and --media-bg). A
 * grid in which no product has a picture is left exactly as it was. Done at
 * the grid, on the rendered items, because that is where the renderer and
 * the tag dialect meet; every value inside an item is escaped, so an item's
 * opening tag can only be one this file wrote.
 */
function levelProducts(itemsHtml) {
  const html = String(itemsHtml || '');
  if (html.indexOf(MEDIA_OPEN) === -1) return html;
  return html.replace(PRODUCT_WITHOUT_MEDIA, '$1' + MEDIA_EMPTY);
}

function renderProducts(props = {}, itemsHtml = '', opts = {}) {
  const cols = Number(props.columns) === 2 || Number(props.columns) === 4
    ? Number(props.columns)
    : 3;
  return `<div${opts.idAttr || ''} class="bent-products bent-products-cols-${cols}${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${levelProducts(itemsHtml)}</div>`;
}

function renderProductsFromData(data = {}, dir = '', attrs = {}) {
  const items = data.items || [];
  const inner = items.map((it) => renderProduct(it || {})).join('');
  return renderProducts(data, inner, blockOpts(dir, attrs));
}

module.exports = {
  renderProduct,
  renderProducts,
  renderProductsFromData
};
