'use strict';

/**
 * Product / teaser grid — title, price, image, url. CSS-only, no cart.
 * A marketer edits the catalog on the canvas; published HTML stays zero-JS.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

function renderProduct(props = {}) {
  const href = safeHref(props.url || props.href || '');
  const title = escapeHtml(props.title || '');
  const price = escapeHtml(props.price || '');
  const img = props.image
    ? `<img class="bent-product-image" src="${escapeAttr(safeHref(props.image))}" alt="${escapeAttr(props.alt || props.title || '')}" />`
    : '';
  const inner =
    (img ? `<div class="bent-product-media">${img}</div>` : '') +
    `<div class="bent-product-body">` +
      (title ? `<h3 class="bent-product-title">${title}</h3>` : '') +
      (price ? `<p class="bent-product-price">${price}</p>` : '') +
    `</div>`;
  if (href && href !== '#') {
    return `<a class="bent-product" href="${escapeAttr(href)}">${inner}</a>`;
  }
  return `<article class="bent-product">${inner}</article>`;
}

function renderProducts(props = {}, itemsHtml = '', opts = {}) {
  const cols = Number(props.columns) === 2 || Number(props.columns) === 4
    ? Number(props.columns)
    : 3;
  return `<div${opts.idAttr || ''} class="bent-products bent-products-cols-${cols}${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${itemsHtml}</div>`;
}

function renderProductsFromData(data = {}, dir = '', extra = '') {
  const items = data.items || [];
  const inner = items.map((it) => renderProduct(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderProducts(data, inner, { dir: dirAttr, extra });
}

module.exports = {
  renderProduct,
  renderProducts,
  renderProductsFromData
};
