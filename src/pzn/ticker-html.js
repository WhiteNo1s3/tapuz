'use strict';

/**
 * Shared moving-news ticker HTML (v0.61) — one renderer for both the compile
 * path and renderer.js (like nav-html.js / card-html.js), so they can't
 * diverge.
 *
 * Batch item 3, "moving news" — walla's מבזקים strip: a pinned side LABEL
 * ("מבזק") plus a horizontally-scrolling row of clickable headlines. This is
 * a NEWS component (headlines + links), distinct from the decorative single-
 * text `marquee`. Zero JS: two tracks scrolling in lockstep = a seamless loop
 * at any headline count (the marquee trick), and it honors
 * prefers-reduced-motion.
 *
 * Color options (Ben's ask, carried over from nav) go through safeCssColor —
 * the v0.60 KEY LESSON: a CSS context is NOT an HTML context, so we strip
 * breakout chars rather than HTML-escape. We reuse nav's safeCssColor straight
 * (one definition, one behavior).
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');
const { safeCssColor } = require('./nav-html');

const SPEEDS = ['slow', 'md', 'fast'];

/** One ticker headline → link (or a span when there's no href). item: {text, href} */
function renderTickerItem(item = {}) {
  const text = escapeHtml(item.text || '');
  const href = safeHref(item.href || '');
  return href && href !== '#'
    ? `<a class="bent-ticker-link" href="${escapeAttr(href)}">${text}</a>`
    : `<span class="bent-ticker-link">${text}</span>`;
}

/** The ticker strip around already-rendered items. props: {label, speed, background, color}.
 *  opts.decls = generic block-level style declarations (align/data.style) that the
 *  renderer would otherwise emit as a SEPARATE style attr — merged here into ONE
 *  style attribute so a page never gets duplicate style="" (the v0.60 lesson: the
 *  browser silently drops one, killing the ticker colors). */
function renderTicker(props = {}, itemsHtml = '', opts = {}) {
  const styles = [];
  if (opts.decls) styles.push(opts.decls);
  const bg = safeCssColor(props.background || '');
  const col = safeCssColor(props.color || '');
  if (bg) styles.push('background:' + bg);
  if (col) styles.push('--bent-ticker-color:' + col);
  const speed = SPEEDS.includes(props.speed) ? props.speed : 'md';
  const styleAttr = styles.length ? ` style="${escapeAttr(styles.join(';'))}"` : '';
  const label = props.label
    ? `<span class="bent-ticker-label">${escapeHtml(props.label)}</span>`
    : '';
  // two identical tracks side by side → seamless loop for any headline count
  const track = `<div class="bent-ticker-track">${itemsHtml}</div>`;
  const track2 = `<div class="bent-ticker-track" aria-hidden="true">${itemsHtml}</div>`;
  return `<div${opts.idAttr || ''} class="bent-ticker bent-ticker-${speed}${opts.cls || ''}"${opts.extra || ''}${styleAttr}${opts.dir || ''}>` +
    label +
    `<div class="bent-ticker-viewport">${track}${track2}</div>` +
    '</div>';
}

/** Convenience for the renderer: whole ticker from block.data (items array). */
function renderTickerFromData(data = {}, dir = '', attrs = {}, decls = '') {
  const items = (data.items || []).map((it) => renderTickerItem(it || {})).join('');
  return renderTicker(data, items, Object.assign(blockOpts(dir, attrs), { decls }));
}

module.exports = { renderTickerItem, renderTicker, renderTickerFromData, SPEEDS };
