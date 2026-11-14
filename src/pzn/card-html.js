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
const { blockOpts } = require('./block-attrs');

// the three openings a card is built from — named once, because the grid
// reads them back (levelCards) and the two must never drift apart
const MEDIA_OPEN = '<figure class="bent-card-media">';
const BODY_OPEN = '<div class="bent-card-body">';
const MEDIA_EMPTY = '<figure class="bent-card-media bent-card-media-empty" aria-hidden="true"></figure>';
// a card that opens straight with its body: it has no picture
const CARD_WITHOUT_MEDIA = new RegExp('(<(?:a|article) class="bent-card"[^>]*>)(?=' + BODY_OPEN + ')', 'g');

/** One media card → HTML. item: {image, tag, title, excerpt, href} */
function renderCard(item = {}) {
  const it = item;
  const img = safeHref(it.image || '');
  const fig = img && img !== '#'
    ? `${MEDIA_OPEN}<img src="${escapeAttr(img)}" alt="${escapeAttr(it.title || '')}" loading="lazy"></figure>`
    : '';
  const tag = it.tag ? `<span class="bent-card-tag">${escapeHtml(it.tag)}</span>` : '';
  const title = it.title ? `<h3 class="bent-card-title">${escapeHtml(it.title)}</h3>` : '';
  const excerpt = it.excerpt ? `<p class="bent-card-excerpt">${escapeHtml(it.excerpt)}</p>` : '';
  const inner = fig + `${BODY_OPEN}${tag}${title}${excerpt}</div>`;
  const href = safeHref(it.href || '');
  return href && href !== '#'
    ? `<a class="bent-card" href="${escapeAttr(href)}">${inner}</a>`
    : `<article class="bent-card">${inner}</article>`;
}

/**
 * Titles on one level (v2.69). A card without a picture, in a grid where a
 * sibling HAS one, opened straight with its body — measured in one row:
 * titles at y 4087 and 4264. Such a card gets an empty media box of the same
 * shape (the stylesheet gives it the ratio and --media-bg). A grid in which
 * no card has a picture is left exactly as it was.
 *
 * Done on the rendered cards, at the grid, because that is where both paths
 * meet: the renderer hands whole items, the tag dialect compiles each
 * <bent-mediacard> on its own and joins them. Every value inside a card is
 * escaped, so a card's opening tag can only be one this file wrote.
 */
function levelCards(cardsHtml) {
  const html = String(cardsHtml || '');
  if (html.indexOf(MEDIA_OPEN) === -1) return html;
  return html.replace(CARD_WITHOUT_MEDIA, '$1' + MEDIA_EMPTY);
}

/** The responsive grid wrapping already-rendered cards. */
function renderCardsGrid(cardsHtml, opts = {}) {
  return `<div${opts.idAttr || ''} class="bent-cards${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${levelCards(cardsHtml)}</div>`;
}

/** Convenience for the renderer: whole grid from block.data (items array). */
function renderCardsFromData(data = {}, dir = '', attrs = {}) {
  const cards = (data.items || []).map((it) => renderCard(it || {})).join('');
  return renderCardsGrid(cards, blockOpts(dir, attrs));
}

module.exports = { renderCard, renderCardsGrid, renderCardsFromData, levelCards };
