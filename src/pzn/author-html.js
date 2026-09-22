'use strict';

/**
 * Shared author-box HTML — the "about the writer" card under blog posts
 * (the gap audit caught it flattening to image + heading + text + button).
 * Photo beside name, bio and an optional link. Zero JS.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/** Whole author box. props: {name, image, bio, url, linkLabel, role, time}
 * A post byline is the same module without a bio: name (linked when there
 * is a url), then a role · date meta line. */
function renderAuthor(props = {}, opts = {}) {
  const name = escapeHtml(props.name || '');
  const bio = escapeHtml(props.bio || '');
  const meta = [props.role, props.time].filter(Boolean).map((s) => `<span>${escapeHtml(s)}</span>`).join('');
  const image = String(props.image || '').trim();
  const href = safeHref(props.url || '');
  const linkLabel = escapeHtml(props.linkLabel || 'לכל הכתבות');
  const photo = image
    ? `<img class="bent-author-photo" src="${escapeAttr(image)}" alt="${escapeAttr(props.name || '')}" loading="lazy">`
    : '<span class="bent-author-photo bent-author-photo-empty" aria-hidden="true">✍️</span>';
  return `<aside${opts.idAttr || ''} class="bent-author${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    photo +
    '<div class="bent-author-body">' +
    (name
      ? (href && href !== '#' && !bio
        ? `<p class="bent-author-name"><a href="${escapeAttr(href)}">${name}</a></p>`
        : `<p class="bent-author-name">${name}</p>`)
      : '') +
    (meta ? `<p class="bent-author-meta">${meta}</p>` : '') +
    (bio ? `<p class="bent-author-bio">${bio}</p>` : '') +
    (href && href !== '#' && bio ? `<a class="bent-author-link" href="${escapeAttr(href)}">${linkLabel}</a>` : '') +
    '</div></aside>';
}

/** Convenience for the renderer: whole author box from block.data. */
function renderAuthorFromData(data = {}, dir = '', attrs = {}) {
  return renderAuthor(data, blockOpts(dir, attrs));
}

module.exports = { renderAuthor, renderAuthorFromData };
