'use strict';

/**
 * Shared author-box HTML — the "about the writer" card under blog posts
 * (the gap audit caught it flattening to image + heading + text + button).
 * Photo beside name, bio and an optional link. Zero JS.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

/** Whole author box. props: {name, image, bio, url, linkLabel} */
function renderAuthor(props = {}, opts = {}) {
  const name = escapeHtml(props.name || '');
  const bio = escapeHtml(props.bio || '');
  const image = String(props.image || '').trim();
  const href = safeHref(props.url || '');
  const linkLabel = escapeHtml(props.linkLabel || 'לכל הכתבות');
  const photo = image
    ? `<img class="bent-author-photo" src="${escapeAttr(image)}" alt="${escapeAttr(props.name || '')}" loading="lazy">`
    : '<span class="bent-author-photo bent-author-photo-empty" aria-hidden="true">✍️</span>';
  return `<aside${opts.idAttr || ''} class="bent-author${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    photo +
    '<div class="bent-author-body">' +
    (name ? `<p class="bent-author-name">${name}</p>` : '') +
    (bio ? `<p class="bent-author-bio">${bio}</p>` : '') +
    (href && href !== '#' ? `<a class="bent-author-link" href="${escapeAttr(href)}">${linkLabel}</a>` : '') +
    '</div></aside>';
}

/** Convenience for the renderer: whole author box from block.data. */
function renderAuthorFromData(data = {}, dir = '', extra = '') {
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderAuthor(data, { dir: dirAttr, extra });
}

module.exports = { renderAuthor, renderAuthorFromData };
