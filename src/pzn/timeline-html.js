'use strict';

/**
 * Shared company-history / timeline HTML — the other module-hunt gap named
 * in docs/COMPETITIVE.md ("timeline, steps remain"). One renderer for compile
 * and renderer.js. Zero JS: a vertical line + dots via CSS; content is always
 * in the DOM (invariant I1). Optional image is an <img>, never a background
 * that would hide the caption.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

/** One event → <article class="bent-event">. props: {time, title, text, image} */
function renderEvent(props = {}) {
  const time = escapeHtml(props.time || '');
  const title = escapeHtml(props.title || '');
  const text = escapeHtml(props.text || '');
  const imgSrc = safeHref(props.image || '');
  const img = imgSrc && imgSrc !== '#'
    ? `<img class="bent-event-image" src="${escapeAttr(imgSrc)}" alt="${escapeAttr(title)}" loading="lazy">`
    : '';
  return `<article class="bent-event">` +
    (time ? `<time class="bent-event-time">${time}</time>` : '') +
    (title ? `<h3 class="bent-event-title">${title}</h3>` : '') +
    (text ? `<p class="bent-event-body">${text}</p>` : '') +
    img +
    '</article>';
}

/** The timeline around already-rendered events. */
function renderTimeline(props = {}, itemsHtml = '', opts = {}) {
  return `<div${opts.idAttr || ''} class="bent-timeline${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${itemsHtml}</div>`;
}

/** Convenience for the renderer: whole timeline from block.data (items array). */
function renderTimelineFromData(data = {}, dir = '', extra = '') {
  const items = (data.items || []).map((it) => renderEvent(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderTimeline(data, items, { dir: dirAttr, extra });
}

module.exports = { renderEvent, renderTimeline, renderTimelineFromData };
