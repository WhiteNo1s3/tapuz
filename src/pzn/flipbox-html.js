'use strict';

/**
 * Shared flip-box HTML — the Elementor flip box (front: icon + title,
 * back: text + button) that the gap audit caught flattening to heading +
 * text + button. CSS-only 3D flip on hover and on focus (keyboard / tap
 * via tabindex). Zero JS.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/** Whole flip box. props: {title, icon, backText, buttonText, buttonUrl} */
function renderFlipbox(props = {}, opts = {}) {
  const title = escapeHtml(props.title || '');
  const backText = escapeHtml(props.backText || '');
  const buttonText = escapeHtml(props.buttonText || '');
  const icon = String(props.icon || '').trim();
  const href = safeHref(props.buttonUrl || '');
  const iconHtml = icon
    ? (icon.startsWith('/') || icon.startsWith('http')
      ? `<img class="bent-flipbox-icon" src="${escapeAttr(icon)}" alt="" loading="lazy">`
      : `<span class="bent-flipbox-icon" aria-hidden="true">${escapeHtml(icon)}</span>`)
    : '';
  const button = buttonText
    ? `<a class="bent-flipbox-button" href="${escapeAttr(href && href !== '#' ? href : '#')}">${buttonText}</a>`
    : '';
  return `<div${opts.idAttr || ''} class="bent-flipbox${opts.cls || ''}" tabindex="0"${opts.extra || ''}${opts.dir || ''}>` +
    '<div class="bent-flipbox-inner">' +
    `<div class="bent-flipbox-front">${iconHtml}${title ? `<h3 class="bent-flipbox-title">${title}</h3>` : ''}</div>` +
    `<div class="bent-flipbox-back">${backText ? `<p class="bent-flipbox-text">${backText}</p>` : ''}${button}</div>` +
    '</div></div>';
}

/** Convenience for the renderer: whole flip box from block.data. */
function renderFlipboxFromData(data = {}, dir = '', attrs = {}) {
  return renderFlipbox(data, blockOpts(dir, attrs));
}

module.exports = { renderFlipbox, renderFlipboxFromData };
