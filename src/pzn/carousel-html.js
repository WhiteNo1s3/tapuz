'use strict';

/**
 * Shared carousel HTML (v0.79) — one renderer for both paths so compile and
 * published output can't diverge (the card-html/form-html contract):
 *   - src/pzn/modules/registry.js  (carousel/slide compile, from AST)
 *   - src/renderer.js              (case 'carousel', from block.data)
 *
 * A horizontal scroll-snap strip of media cards — the same atomic unit as
 * the cards grid (image + tag + title + excerpt + link), sliding instead of
 * wrapping. ZERO JS: CSS scroll-snap does the work, touch-native, RTL-aware
 * (logical properties — the strip starts on the right on RTL pages).
 * `peek` leaves the next slide's edge visible so scrollability is obvious.
 */

const { escapeAttr } = require('./language/escape');
const { renderCard } = require('./card-html');

const HEIGHTS = ['sm', 'md', 'lg'];

/** One slide → HTML (a media card in a snap cell). */
function renderSlide(item = {}) {
  return `<div class="bent-slide">${renderCard(item)}</div>`;
}

/** The snap track wrapping already-rendered slides. */
function renderCarouselTrack(slidesHtml, opts = {}) {
  const height = HEIGHTS.includes(opts.height) ? opts.height : 'md';
  const peek = opts.peek === false || opts.peek === 'false' ? ' bent-carousel-full' : '';
  return `<section${opts.idAttr || ''} class="bent-carousel bent-carousel-${height}${peek}${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `<div class="bent-carousel-track">${slidesHtml}</div>` +
    `</section>`;
}

/** Convenience for the renderer: whole carousel from block.data. */
function renderCarouselFromData(data = {}, dir = '', extra = '') {
  const slides = (data.items || []).map((it) => renderSlide(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderCarouselTrack(slides, {
    height: data.height,
    peek: data.peek,
    dir: dirAttr,
    extra
  });
}

module.exports = { renderSlide, renderCarouselTrack, renderCarouselFromData };
