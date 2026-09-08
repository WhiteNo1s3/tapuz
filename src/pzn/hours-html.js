'use strict';

/**
 * Shared opening-hours HTML — the business-hours table every local site
 * ships (the gap audit caught it flattening to text rows). Day ··· hours
 * rows; a "closed" row is styled muted. Zero JS.
 */

const { escapeHtml, escapeAttr } = require('./language/escape');

// no \b after Hebrew — JS word boundaries are ASCII-only, so `סגור\b` never
// matches; a following space/punctuation/end is the boundary instead
const CLOSED_RE = /^(?:סגור|closed)(?:$|[\s,.!:])/iu;

/** One row → <div class="bent-day">. props: {day, hours} */
function renderDay(props = {}) {
  const day = escapeHtml(props.day || '');
  const hours = escapeHtml(props.hours || '');
  const closed = CLOSED_RE.test(String(props.hours || '').trim());
  return `<div class="bent-day${closed ? ' bent-day-closed' : ''}">` +
    `<span class="bent-day-name">${day}</span>` +
    `<span class="bent-day-dots" aria-hidden="true"></span>` +
    `<span class="bent-day-hours">${hours}</span>` +
    '</div>';
}

/** The hours table around already-rendered rows. */
function renderHours(props = {}, itemsHtml = '', opts = {}) {
  return `<div${opts.idAttr || ''} class="bent-hours${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${itemsHtml}</div>`;
}

/** Convenience for the renderer: whole hours block from block.data (items array). */
function renderHoursFromData(data = {}, dir = '', extra = '') {
  const items = (data.items || []).map((it) => renderDay(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderHours(data, items, { dir: dirAttr, extra });
}

module.exports = { renderDay, renderHours, renderHoursFromData };
