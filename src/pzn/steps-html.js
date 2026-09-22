'use strict';

/**
 * Shared how-it-works / process-steps HTML — the module-hunt gap named in
 * docs/COMPETITIVE.md ("timeline, steps remain"). One renderer for compile
 * and renderer.js so they cannot diverge. Zero JS: CSS counters number the
 * steps; the row stacks on a narrow viewport.
 */

const { escapeHtml, escapeAttr } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/** One step → <article class="bent-step">. props: {title, text, icon} */
function renderStep(props = {}) {
  const title = escapeHtml(props.title || '');
  const text = escapeHtml(props.text || '');
  const icon = String(props.icon || '').trim();
  const iconHtml = icon
    ? (icon.startsWith('/') || icon.startsWith('http')
      ? `<img class="bent-step-icon" src="${escapeAttr(icon)}" alt="" loading="lazy">`
      : `<span class="bent-step-icon" aria-hidden="true">${escapeHtml(icon)}</span>`)
    : '<span class="bent-step-n" aria-hidden="true"></span>';
  return `<article class="bent-step">` +
    iconHtml +
    (title ? `<h3 class="bent-step-title">${title}</h3>` : '') +
    (text ? `<p class="bent-step-body">${text}</p>` : '') +
    '</article>';
}

/** The steps row around already-rendered step cards. */
function renderSteps(props = {}, itemsHtml = '', opts = {}) {
  return `<div${opts.idAttr || ''} class="bent-steps${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${itemsHtml}</div>`;
}

/** Convenience for the renderer: whole steps block from block.data (items array). */
function renderStepsFromData(data = {}, dir = '', attrs = {}) {
  const items = (data.items || []).map((it) => renderStep(it || {})).join('');
  return renderSteps(data, items, blockOpts(dir, attrs));
}

module.exports = { renderStep, renderSteps, renderStepsFromData };
