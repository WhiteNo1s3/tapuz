'use strict';

/**
 * Shared star-rating HTML — review scores / social proof (the Elementor
 * star-rating widget the gap audit caught flattening to text). Two star
 * layers: a muted base and a colored fill clipped to the score width, so
 * 4.5 really shows four and a half stars. Zero JS.
 */

const { escapeHtml, escapeAttr } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/** Clamp the score to 0..max, keeping one decimal. */
function clampRating(value, max) {
  const m = Math.max(1, Math.min(10, Math.round(Number(max)) || 5));
  const v = Number(value);
  if (!Number.isFinite(v)) return { value: 0, max: m };
  return { value: Math.round(Math.min(m, Math.max(0, v)) * 10) / 10, max: m };
}

/** Whole rating block. props: {value, max, text} */
function renderRating(props = {}, opts = {}) {
  const { value, max } = clampRating(props.value, props.max);
  const stars = '★'.repeat(max);
  const pct = Math.round((value / max) * 1000) / 10;
  const text = escapeHtml(props.text || '');
  const label = `${value} מתוך ${max}`;
  return `<div${opts.idAttr || ''} class="bent-rating${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `<span class="bent-rating-stars" role="img" aria-label="${escapeAttr(label)}">` +
    `<span class="bent-rating-base" aria-hidden="true">${stars}</span>` +
    `<span class="bent-rating-fill" aria-hidden="true" style="width:${pct}%">${stars}</span>` +
    '</span>' +
    (text ? `<span class="bent-rating-text">${text}</span>` : '') +
    '</div>';
}

/** Convenience for the renderer: whole rating from block.data. */
function renderRatingFromData(data = {}, dir = '', attrs = {}) {
  return renderRating(data, blockOpts(dir, attrs));
}

module.exports = { renderRating, renderRatingFromData, clampRating };
