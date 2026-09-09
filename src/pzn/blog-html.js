'use strict';

/**
 * Blog-article modules a marketer edits on the canvas: code fence, author
 * byline, tag chips. CSS-only published HTML — no highlighter JS.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

function dirAttr(dir) {
  return dir ? ` dir="${escapeAttr(dir)}"` : '';
}

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

function renderCodeFromData(data = {}, dir = '', extra = '') {
  return renderCode(data, { dir: dirAttr(dir), extra });
}

function renderAuthor(props = {}, opts = {}) {
  const name = escapeHtml(props.name || '');
  const role = escapeHtml(props.role || '');
  const time = escapeHtml(props.time || '');
  const href = safeHref(props.url || '');
  const img = props.image
    ? `<img class="bent-author-image" src="${escapeAttr(safeHref(props.image))}" alt="${escapeAttr(props.name || '')}" />`
    : '';
  const who = name
    ? (href && href !== '#'
      ? `<a class="bent-author-name" href="${escapeAttr(href)}">${name}</a>`
      : `<span class="bent-author-name">${name}</span>`)
    : '';
  const meta = [role, time].filter(Boolean).map((s) => `<span>${s}</span>`).join('');
  return `<div${opts.idAttr || ''} class="bent-author${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `${img}<div class="bent-author-body">${who}${meta ? `<p class="bent-author-meta">${meta}</p>` : ''}</div></div>`;
}

function renderAuthorFromData(data = {}, dir = '', extra = '') {
  return renderAuthor(data, { dir: dirAttr(dir), extra });
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

function renderTagsFromData(data = {}, dir = '', extra = '') {
  const items = data.items || [];
  const inner = items.map((it) => renderTag(it || {})).join('');
  return renderTags(data, inner, { dir: dirAttr(dir), extra });
}

module.exports = {
  renderCode,
  renderCodeFromData,
  renderAuthor,
  renderAuthorFromData,
  renderTag,
  renderTags,
  renderTagsFromData
};
