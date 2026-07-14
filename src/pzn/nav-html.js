'use strict';

/**
 * Shared nav HTML (v0.60) — one renderer for both the compile path and
 * renderer.js (like form-html.js / card-html.js), so they can't diverge.
 *
 * A page-level navigation bar: a row of links with COLOR OPTIONS (Ben's ask —
 * "coloring option also for the nav and background"). Colors are interpolated
 * into a style="" attribute, so they go through safeCssColor — the v0.44/v0.52
 * KEY LESSON: HTML-escaping is WRONG for a CSS context; strip breakout chars
 * (;{}:"') and keep only valid color syntax. Zero JS.
 */

const { escapeHtml, escapeAttr, safeHref } = require('./language/escape');

/** Keep a CSS color value safe to interpolate (no breakout chars). */
function safeCssColor(v) {
  return String(v == null ? '' : v).replace(/[^#\w(),.%\s-]/g, '').slice(0, 40);
}

/** One nav item → <a>. item: {label, href} */
function renderNavItem(item = {}) {
  const href = safeHref(item.href || '');
  const label = escapeHtml(item.label || '');
  return `<a class="bent-nav-link" href="${escapeAttr(href && href !== '#' ? href : '#')}">${label}</a>`;
}

/** The nav bar around already-rendered links. props: {background, color, align}.
 *  opts.decls = generic block-level style declarations (align/data.style) that
 *  the renderer would otherwise emit as a SEPARATE style attr — merged here into
 *  ONE style attribute so a page never gets duplicate style="" (which the
 *  browser silently drops, killing the nav colors). */
function renderNav(props = {}, itemsHtml = '', opts = {}) {
  const styles = [];
  if (opts.decls) styles.push(opts.decls);
  const bg = safeCssColor(props.background || '');
  const col = safeCssColor(props.color || '');
  if (bg) styles.push('background:' + bg);
  if (col) styles.push('--bent-nav-color:' + col);
  const align = ['start', 'center', 'end'].includes(props.align) ? props.align : 'start';
  const styleAttr = styles.length ? ` style="${escapeAttr(styles.join(';'))}"` : '';
  return `<nav${opts.idAttr || ''} class="bent-nav bent-nav-${align}${opts.cls || ''}"${opts.extra || ''}${styleAttr}${opts.dir || ''}>${itemsHtml}</nav>`;
}

/** Convenience for the renderer: whole nav from block.data (items array). */
function renderNavFromData(data = {}, dir = '', extra = '', decls = '') {
  const items = (data.items || []).map((it) => renderNavItem(it || {})).join('');
  const dirAttr = dir ? ` dir="${escapeAttr(dir)}"` : '';
  return renderNav(data, items, { dir: dirAttr, extra, decls });
}

module.exports = { renderNavItem, renderNav, renderNavFromData, safeCssColor };
