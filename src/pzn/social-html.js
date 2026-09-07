'use strict';

/**
 * Shared social-icons HTML — CSS-only, no JS. A row of labeled links a
 * marketer can edit (network + URL + label), the Camilyo/Builder widget.
 * Site-chrome footer social stays separate; this is the page module.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

function safeNetwork(name) {
  return String(name || 'link').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'link';
}

function renderHandle(props = {}) {
  const network = safeNetwork(props.network);
  const label = escapeHtml(props.label || props.network || network);
  const href = escapeAttr(safeHref(props.url || ''));
  return `<li class="bent-social-item">` +
    `<a class="bent-social-link bent-social-${network}" href="${href}" rel="noopener noreferrer">` +
    `<span class="bent-social-label">${label}</span></a></li>`;
}

function renderSocial(props = {}, itemsHtml = '', opts = {}) {
  return `<nav${opts.idAttr || ''} class="bent-social${opts.cls || ''}" aria-label="${escapeAttr(props.label || 'רשתות חברתיות')}"${opts.extra || ''}${opts.dir || ''}>` +
    `<ul class="bent-social-list">${itemsHtml}</ul></nav>`;
}

function renderSocialFromData(data = {}, dir = '', extra = '') {
  const items = data.items || [];
  const inner = items.map((it) => renderHandle(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderSocial(data, inner, { dir: dirAttr, extra });
}

module.exports = { safeNetwork, renderHandle, renderSocial, renderSocialFromData };
