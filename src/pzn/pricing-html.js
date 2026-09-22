'use strict';

/**
 * Shared pricing-table HTML (v1.05) — one renderer for both the compile
 * path and renderer.js (like nav-html.js/card-html.js), so they can't
 * diverge. `pricing` container of repeatable `plan` items — the module-hunt
 * gap named in docs/COMPETITIVE.md ("pricing-table sugar"). Zero-JS,
 * pure CSS grid; a `highlighted` plan gets a visual accent so the
 * recommended tier stands out — the one thing a flat card grid can't do.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

/** features: newline-separated string → one <li> per non-empty line. */
function renderFeatures(features) {
  const lines = String(features || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  return '<ul class="bent-plan-features">' + lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>';
}

/** One plan → <article class="bent-plan">. props: {title, price, period, features, ctaLabel, ctaUrl, highlighted} */
function renderPlan(props = {}) {
  const title = escapeHtml(props.title || '');
  const price = escapeHtml(props.price || '');
  const period = escapeHtml(props.period || '');
  const highlighted = props.highlighted === true || props.highlighted === 'true';
  const href = safeHref(props.ctaUrl || '');
  const ctaLabel = escapeHtml(props.ctaLabel || '');
  const cta = ctaLabel
    ? `<a class="bent-plan-cta" href="${escapeAttr(href && href !== '#' ? href : '#')}">${ctaLabel}</a>`
    : '';
  const priceRow = price
    ? `<div class="bent-plan-price"><span class="bent-plan-amount">${price}</span>${period ? `<span class="bent-plan-period">${period}</span>` : ''}</div>`
    : '';
  return `<article class="bent-plan${highlighted ? ' bent-plan-highlighted' : ''}">` +
    (title ? `<h3 class="bent-plan-title">${title}</h3>` : '') +
    priceRow +
    renderFeatures(props.features) +
    cta +
    '</article>';
}

/** The pricing grid around already-rendered plan cards. */
function renderPricing(props = {}, itemsHtml = '', opts = {}) {
  return `<div${opts.idAttr || ''} class="bent-pricing${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>${itemsHtml}</div>`;
}

/** Convenience for the renderer: whole pricing table from block.data (items array). */
function renderPricingFromData(data = {}, dir = '', attrs = {}) {
  const items = (data.items || []).map((it) => renderPlan(it || {})).join('');
  return renderPricing(data, items, blockOpts(dir, attrs));
}

module.exports = { renderPlan, renderPricing, renderPricingFromData, renderFeatures };
