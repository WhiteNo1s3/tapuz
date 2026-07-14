'use strict';

/**
 * Shared media-card / card-grid HTML (v0.59) — one renderer for both paths so
 * compile and published output can't diverge (like form-html.js):
 *   - src/pzn/modules/registry.js  (cards/mediacard compile, from AST)
 *   - src/renderer.js              (case 'cards', from block.data)
 *
 * The atomic unit of a content site (walla's rendered DOM = ~111 of these):
 * image + tag/kicker + title + excerpt + link, laid out in a responsive grid.
 * All escaped; image/href through safeHref (no javascript:/data:text-html).
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

/** One media card → HTML. item: {image, tag, title, excerpt, href} */
function renderCard(item = {}) {
  const it = item;
  const img = safeHref(it.image || '');
  const fig = img && img !== '#'
    ? `<figure class="bent-card-media"><img src="${escapeAttr(img)}" alt="${escapeAttr(it.title || '')}" loading="lazy"></figure>`
    : '';
  const tag = it.tag ? `<span class="bent-card-tag">${escapeHtml(it.tag)}</span>` : '';
  const title = it.title ? `<h3 class="bent-card-title">${escapeHtml(it.title)}</h3>` : '';
  const excerpt = it.excerpt ? `<p class="bent-card-excerpt">${escapeHtml(it.excerpt)}</p>` : '';
  const inner = fig + `<div class="bent-card-body">${tag}${title}${excerpt}</div>`;
  const href = safeHref(it.href || '');
  return href && href !== '#'
    ? `<a class="bent-card" href="${escapeAttr(href)}">${inner}</a>`
    : `<article class="bent-card">${inner}</article>`;
}

/** The responsive grid wrapping already-rendered cards. */
function renderCardsGrid(cardsHtml, opts = {}) {
  return `<div${opts.idAttr || ''} class="bent-cards${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${cardsHtml}</div>`;
}

/** Convenience for the renderer: whole grid from block.data (items array). */
function renderCardsFromData(data = {}, dir = '', extra = '') {
  const cards = (data.items || []).map((it) => renderCard(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderCardsGrid(cards, { dir: dirAttr, extra });
}

module.exports = { renderCard, renderCardsGrid, renderCardsFromData };
