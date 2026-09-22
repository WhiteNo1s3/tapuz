'use strict';

/**
 * Shared table-of-contents HTML — the in-page anchor list long articles
 * carry (Elementor's table-of-contents widget). A <nav> of #anchor links
 * with an optional title. Zero JS: anchors scroll natively.
 */

const { escapeHtml, escapeAttr } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/**
 * A same-page anchor: keep #ids, allow same-site relative paths, and turn
 * anything else (schemes, hosts, script) into a harmless fragment id.
 */
function safeAnchor(raw) {
  const s = String(raw || '').trim();
  if (!s) return '#';
  if (s.startsWith('#')) return '#' + s.slice(1).replace(/[\s"'<>]/g, '');
  if (s.startsWith('/') && !s.startsWith('//') && !/[\s"'<>]/.test(s)) return s;
  return '#' + s.replace(/[^\w\-֐-׿]/g, '');
}

/** One entry → <li class="bent-tocitem">. props: {label, anchor} */
function renderTocItem(props = {}) {
  const label = escapeHtml(props.label || '');
  const href = escapeAttr(safeAnchor(props.anchor));
  return `<li class="bent-tocitem"><a class="bent-tocitem-link" href="${href}">${label}</a></li>`;
}

/** The nav around already-rendered entries. props: {title} */
function renderToc(props = {}, itemsHtml = '', opts = {}) {
  const title = escapeHtml(props.title || '');
  return `<nav${opts.idAttr || ''} class="bent-toc${opts.cls || ''}" aria-label="${escapeAttr(props.title || 'תוכן עניינים')}"${opts.extra || ''}${opts.dir || ''}>` +
    (title ? `<p class="bent-toc-title">${title}</p>` : '') +
    `<ol class="bent-toc-list">${itemsHtml}</ol></nav>`;
}

/** Convenience for the renderer: whole TOC from block.data (items array). */
function renderTocFromData(data = {}, dir = '', attrs = {}) {
  const items = (data.items || []).map((it) => renderTocItem(it || {})).join('');
  return renderToc(data, items, blockOpts(dir, attrs));
}

module.exports = { renderTocItem, renderToc, renderTocFromData, safeAnchor };
