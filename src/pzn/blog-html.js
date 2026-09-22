'use strict';

/**
 * Blog-article modules a marketer edits on the canvas: code fence and tag
 * chips (the author box lives in author-html.js — a byline is the same
 * module with role/time and no bio). CSS-only published HTML — no highlighter JS.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

function renderCode(props = {}, opts = {}) {
  const lang = String(props.lang || '').replace(/[^\w+#.-]/g, '').slice(0, 24);
  const source = escapeHtml(props.source || '');
  const langAttr = lang ? ` data-lang="${escapeAttr(lang)}"` : '';
  const label = lang
    ? `<span class="bent-code-lang">${escapeHtml(lang)}</span>`
    : '';
  return `<figure${opts.idAttr || ''} class="bent-code${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `${label}<pre${langAttr}><code>${source}</code></pre></figure>`;
}

function renderCodeFromData(data = {}, dir = '', attrs = {}) {
  return renderCode(data, blockOpts(dir, attrs));
}

function renderTag(props = {}) {
  const label = escapeHtml(props.label || '');
  const href = safeHref(props.url || props.href || '');
  if (href && href !== '#') {
    return `<a class="bent-tag" href="${escapeAttr(href)}">${label}</a>`;
  }
  return `<span class="bent-tag">${label}</span>`;
}

function renderTags(props = {}, itemsHtml = '', opts = {}) {
  return `<nav${opts.idAttr || ''} class="bent-tags${opts.cls || ''}" aria-label="${escapeAttr(props.label || 'תגיות')}"${opts.extra || ''}${opts.dir || ''}>${itemsHtml}</nav>`;
}

function renderTagsFromData(data = {}, dir = '', attrs = {}) {
  const items = data.items || [];
  const inner = items.map((it) => renderTag(it || {})).join('');
  return renderTags(data, inner, blockOpts(dir, attrs));
}

module.exports = {
  renderCode,
  renderCodeFromData,
  renderTag,
  renderTags,
  renderTagsFromData
};
