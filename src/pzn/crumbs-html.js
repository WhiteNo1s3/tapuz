'use strict';

/**
 * Shared breadcrumb trail HTML — CSS-only, no JS. A <nav> of links with
 * the current page as the last crumb (no href, aria-current). Separators
 * are CSS ::before so RTL stays logical.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/** One crumb. Last / current items omit the link. props: {label, url, current} */
function renderCrumb(props = {}, current = false) {
  const label = escapeHtml(props.label || '');
  const href = safeHref(props.url || '');
  const isCurrent = current || !href || href === '#';
  if (isCurrent) {
    return `<li class="bent-crumb" aria-current="page"><span class="bent-crumb-current">${label}</span></li>`;
  }
  return `<li class="bent-crumb"><a class="bent-crumb-link" href="${escapeAttr(href)}">${label}</a></li>`;
}

function renderCrumbs(props = {}, itemsHtml = '', opts = {}) {
  return `<nav${opts.idAttr || ''} class="bent-crumbs${opts.cls || ''}" aria-label="breadcrumb"${opts.extra || ''}${opts.dir || ''}>` +
    `<ol class="bent-crumbs-list">${itemsHtml}</ol></nav>`;
}

function renderCrumbsFromData(data = {}, dir = '', attrs = {}) {
  const items = data.items || [];
  const last = items.length - 1;
  const inner = items.map((it, idx) => renderCrumb(it || {}, idx === last)).join('');
  return renderCrumbs(data, inner, blockOpts(dir, attrs));
}

module.exports = { renderCrumb, renderCrumbs, renderCrumbsFromData };
