'use strict';

/**
 * Shared price-list HTML — restaurant menus and service price lists (the
 * gap-audit shape Elementor ships as "price list", which the decompiler was
 * misreading as a pricing TABLE or flattening to text). Name … dotted
 * leader … price, with an optional description line. Zero JS.
 */

const { escapeHtml } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/** One list row → <div class="bent-priceitem">. props: {name, price, desc} */
function renderPriceItem(props = {}) {
  const name = escapeHtml(props.name || '');
  const price = escapeHtml(props.price || '');
  const desc = escapeHtml(props.desc || '');
  return `<div class="bent-priceitem">` +
    `<div class="bent-priceitem-head"><span class="bent-priceitem-name">${name}</span>` +
    `<span class="bent-priceitem-dots" aria-hidden="true"></span>` +
    `<span class="bent-priceitem-price">${price}</span></div>` +
    (desc ? `<p class="bent-priceitem-desc">${desc}</p>` : '') +
    '</div>';
}

/** The list wrapper around already-rendered rows. */
function renderPricelist(props = {}, itemsHtml = '', opts = {}) {
  return `<div${opts.idAttr || ''} class="bent-pricelist${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${itemsHtml}</div>`;
}

/** Convenience for the renderer: whole price list from block.data (items array). */
function renderPricelistFromData(data = {}, dir = '', attrs = {}) {
  const items = (data.items || []).map((it) => renderPriceItem(it || {})).join('');
  return renderPricelist(data, items, blockOpts(dir, attrs));
}

module.exports = { renderPriceItem, renderPricelist, renderPricelistFromData };
