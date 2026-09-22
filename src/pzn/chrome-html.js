'use strict';

/**
 * Shared PAGE-chrome HTML — the header / footer modules (gap-audit wave 4).
 *
 * Every real homepage the decompile audit hit (walla, mako, rest.co.il,
 * doctor.co.il) carries a <header> and a <footer>, and until now the walk
 * refused to invent them: the children flattened and the landmark went to
 * toolGap. These are page modules — a band INSIDE the page body holding
 * nested blocks (logo image, nav, button, columns, social, text…).
 *
 * They deliberately use their own class names (bent-header / bent-footer),
 * never the theme's .site-header / .site-footer: the site's master chrome
 * (עיצוב → מאסטר: כותרת ותחתית) wraps every page from the layout and its
 * theme.js CSS targets those selectors. A page header must not go sticky,
 * glass, or footer-palette just because the master is configured that way.
 *
 * One renderer for compile (pzn) and renderer.js so they cannot diverge.
 */

const { escapeHtml } = require('./language/escape');
const { blockOpts } = require('./block-attrs');

const HEADER_TONES = ['light', 'dark', 'brand', 'none'];
const FOOTER_TONES = ['dark', 'light', 'brand', 'none'];
const HEADER_LAYOUTS = ['row', 'stack'];

function pick(value, allowed, fallback) {
  return allowed.includes(String(value)) ? String(value) : fallback;
}

/** The header band around already-rendered child blocks. props: {tone, layout} */
function renderHeader(props = {}, innerHtml = '', opts = {}) {
  const tone = pick(props.tone, HEADER_TONES, 'light');
  const layout = pick(props.layout, HEADER_LAYOUTS, 'row');
  return `<header${opts.idAttr || ''} class="bent-header tone-${tone} layout-${layout}${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `<div class="bent-header-inner">${innerHtml}</div></header>`;
}

/** The footer band around already-rendered child blocks. props: {tone, credit} */
function renderFooter(props = {}, innerHtml = '', opts = {}) {
  const tone = pick(props.tone, FOOTER_TONES, 'dark');
  const credit = String(props.credit || '').trim();
  return `<footer${opts.idAttr || ''} class="bent-footer tone-${tone}${opts.cls || ''}"${opts.extra || ''}${opts.dir || ''}>` +
    `<div class="bent-footer-inner">${innerHtml}</div>` +
    (credit ? `<p class="bent-footer-credit">${escapeHtml(credit)}</p>` : '') +
    '</footer>';
}

/**
 * Convenience for renderer.js: whole header block from block.data. The
 * renderer hands in its own renderBlock so nested blocks render through the
 * same switch (chrome, styling, animation) as top-level ones.
 */
function renderHeaderFromData(data = {}, dir = '', attrs = {}, renderChild) {
  const inner = (data.blocks || []).map((b) => renderChild(b, dir)).join('');
  return renderHeader(data, inner, blockOpts(dir, attrs));
}

function renderFooterFromData(data = {}, dir = '', attrs = {}, renderChild) {
  const inner = (data.blocks || []).map((b) => renderChild(b, dir)).join('');
  return renderFooter(data, inner, blockOpts(dir, attrs));
}

module.exports = {
  HEADER_TONES,
  FOOTER_TONES,
  HEADER_LAYOUTS,
  renderHeader,
  renderFooter,
  renderHeaderFromData,
  renderFooterFromData
};
