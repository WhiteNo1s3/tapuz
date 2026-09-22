'use strict';

/**
 * Shared progress-bars HTML — skills/measures rows (the Elementor progress
 * widget the gap audit caught flattening to text). Zero JS: the fill width
 * is an inline percentage; the theme CSS animates it on load.
 */

const { escapeHtml, escapeAttr } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/** Clamp to an integer 0–100 (bad input → 0). */
function clampValue(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** One bar → <div class="bent-bar">. props: {label, value, color} */
function renderBar(props = {}) {
  const label = escapeHtml(props.label || '');
  const value = clampValue(props.value);
  const color = String(props.color || '').trim();
  const fillStyle = `width:${value}%${color ? `;background:${escapeHtml(color)}` : ''}`;
  return `<div class="bent-bar">` +
    `<div class="bent-bar-head"><span class="bent-bar-label">${label}</span>` +
    `<span class="bent-bar-value">${value}%</span></div>` +
    `<div class="bent-bar-track" role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttr(props.label || '')}">` +
    `<div class="bent-bar-fill" style="${fillStyle}"></div></div>` +
    '</div>';
}

/** The bars column around already-rendered rows. */
function renderProgress(props = {}, itemsHtml = '', opts = {}) {
  return `<div${opts.idAttr || ''} class="bent-progress${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${itemsHtml}</div>`;
}

/** Convenience for the renderer: whole progress block from block.data (items array). */
function renderProgressFromData(data = {}, dir = '', attrs = {}) {
  const items = (data.items || []).map((it) => renderBar(it || {})).join('');
  return renderProgress(data, items, blockOpts(dir, attrs));
}

module.exports = { renderBar, renderProgress, renderProgressFromData, clampValue };
