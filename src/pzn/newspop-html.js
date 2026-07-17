'use strict';

/**
 * Shared timestamped-news-feed HTML (v0.70) — one renderer for the compile
 * path and renderer.js (like ticker-html.js / nav-html.js / card-html.js), so
 * they can't diverge.
 *
 * newspop is the STANDING news feed the ticker's scroll can't be: walla's
 * column of "HH:MM · headline" rows — breaking-news / live-blog updates the
 * admin (or an importer) fills with time-stamped items. A NEWS component:
 * links go through safeHref, every value is escaped.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

/** Keep the time a short plain label (it is content, rendered as text). */
function cleanTime(t) {
  return String(t == null ? '' : t).trim().slice(0, 12);
}

/** One feed row → <li> with a time + headline (a link when there's an href). */
function renderNewspopItem(item = {}) {
  const time = cleanTime(item.time);
  const text = escapeHtml(item.text || '');
  const href = safeHref(item.href || '');
  const timeHtml = time ? `<time class="bent-newspop-time">${escapeHtml(time)}</time>` : '';
  const body = href && href !== '#'
    ? `<a class="bent-newspop-text" href="${escapeAttr(href)}">${text}</a>`
    : `<span class="bent-newspop-text">${text}</span>`;
  return `<li class="bent-newspop-item">${timeHtml}${body}</li>`;
}

/** The feed section around already-rendered items. props: {label}.
 *  opts.decls = generic block-level style declarations, merged into ONE style
 *  attribute (the v0.60 lesson — never emit two style="" attributes). */
function renderNewspop(props = {}, itemsHtml = '', opts = {}) {
  const styleAttr = opts.decls ? ` style="${escapeAttr(opts.decls)}"` : '';
  const head = props.label
    ? `<div class="bent-newspop-head">${escapeHtml(props.label)}</div>`
    : '';
  return `<section${opts.idAttr || ''} class="bent-newspop${opts.cls || ''}"${opts.extra || ''}${styleAttr}${opts.dir || ''}>` +
    head +
    `<ul class="bent-newspop-list">${itemsHtml}</ul>` +
    '</section>';
}

/** Convenience for the renderer: whole feed from block.data (items array). */
function renderNewspopFromData(data = {}, dir = '', extra = '', decls = '') {
  const items = (data.items || []).map((it) => renderNewspopItem(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderNewspop(data, items, { dir: dirAttr, extra, decls });
}

module.exports = { renderNewspopItem, renderNewspop, renderNewspopFromData };
