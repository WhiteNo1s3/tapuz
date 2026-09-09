'use strict';

/**
 * Page-level header / footer modules — CSS-only chrome a marketer can
 * edit on the canvas (logo, title, links, copyright). Distinct from the
 * site manifest's `.site-header` / `.site-footer` in src/pzn/site/layout.js:
 * those wrap every published page; these live in the page body as blocks.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

function renderHeadLink(props = {}) {
  const label = escapeHtml(props.label || '');
  const href = escapeAttr(safeHref(props.href || props.url || ''));
  return `<a class="bent-header-link" href="${href}">${label}</a>`;
}

function renderHeader(props = {}, itemsHtml = '', opts = {}) {
  const logoSrc = safeHref(props.logo || '');
  const logoAlt = escapeAttr(props.logoAlt || props.title || '');
  const home = escapeAttr(safeHref(props.url || '/'));
  const title = escapeHtml(props.title || '');
  let brand = '';
  if (logoSrc && logoSrc !== '#') {
    brand += `<img class="bent-header-logo" src="${escapeAttr(logoSrc)}" alt="${logoAlt}" />`;
  }
  if (title) brand += `<span class="bent-header-title">${title}</span>`;
  const brandInner = brand
    ? `<a class="bent-header-brand" href="${home}">${brand}</a>`
    : '';
  const nav = itemsHtml
    ? `<nav class="bent-header-nav" aria-label="${escapeAttr(props.navLabel || 'ניווט')}">${itemsHtml}</nav>`
    : '';
  return `<header${opts.idAttr || ''} class="bent-header${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `${brandInner}${nav}</header>`;
}

function renderHeaderFromData(data = {}, dir = '', extra = '') {
  const items = data.items || [];
  const inner = items.map((it) => renderHeadLink(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderHeader(data, inner, { dir: dirAttr, extra });
}

function renderFootLink(props = {}) {
  const label = escapeHtml(props.label || '');
  const href = escapeAttr(safeHref(props.href || props.url || ''));
  return `<a class="bent-footer-link" href="${href}">${label}</a>`;
}

function renderFooter(props = {}, itemsHtml = '', opts = {}) {
  const nav = itemsHtml
    ? `<nav class="bent-footer-nav" aria-label="${escapeAttr(props.navLabel || 'קישורי כותרת תחתונה')}">${itemsHtml}</nav>`
    : '';
  const copy = props.copy
    ? `<p class="bent-footer-copy">${escapeHtml(props.copy)}</p>`
    : '';
  return `<footer${opts.idAttr || ''} class="bent-footer${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `${nav}${copy}</footer>`;
}

function renderFooterFromData(data = {}, dir = '', extra = '') {
  const items = data.items || [];
  const inner = items.map((it) => renderFootLink(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderFooter(data, inner, { dir: dirAttr, extra });
}

module.exports = {
  renderHeadLink,
  renderHeader,
  renderHeaderFromData,
  renderFootLink,
  renderFooter,
  renderFooterFromData
};
