'use strict';

/**
 * Shared category-presentation HTML (v0.64) — one renderer for both the
 * compile path and renderer.js (the form/card/nav/ticker/video pattern), so
 * they can't diverge.
 *
 * "Presentation of a category" (Ben's ask, batch finale): a branded header
 * (name + description, accent color, optional cover image) above the
 * category's article grid. The grid REUSES the media-card renderer + the
 * .bent-cards responsive grid from v0.59 — a category page is walla's wall of
 * cards, scoped to one section.
 *
 * The callers filter: they hand us the already-filtered article list
 * (module compile: ctx.articles by tag; renderer.js: listArticles({tag})).
 * Colors go through safeCssColor (CSS context — the v0.60 lesson), the cover
 * through escapeCssUrl, and everything merges into ONE style attribute.
 */

const { escapeHtml, escapeAttr, escapeCssUrl } = require('./language/escape');
const { safeCssColor } = require('./nav-html');
const { renderCard } = require('./card-html');

/** Article card model → media-card props. */
function articleToCard(a = {}, category) {
  return {
    image: a.image || '',
    tag: (category && category.name) || '',
    title: a.title || '',
    excerpt: a.teaser || '',
    href: a.url || (a.full_path ? '/' + a.full_path : '')
  };
}

/**
 * @param {object} props  {slug, showheader}
 * @param {object} res    {category: object|null, articles: array (pre-filtered)}
 * @param {object} opts   {idAttr, cls, extra, decls, dir}
 */
function renderCategory(props = {}, res = {}, opts = {}) {
  const slug = String(props.slug || '');
  const category = res.category || null;
  const articles = Array.isArray(res.articles) ? res.articles : [];

  // one merged style attr: generic block decls + the category accent color
  const styles = [];
  if (opts.decls) styles.push(opts.decls);
  const accent = safeCssColor((category && category.color) || '');
  if (accent) styles.push('--bent-cat-color:' + accent);
  const styleAttr = styles.length ? ` style="${escapeAttr(styles.join(';'))}"` : '';

  let header = '';
  const showHeader = props.showheader !== false && props.showheader !== 'false';
  if (showHeader) {
    const name = escapeHtml((category && category.name) || slug);
    const desc = category && category.description
      ? `<p class="bent-category-desc">${escapeHtml(category.description)}</p>`
      : '';
    const cover = category && category.image
      ? ` style="background-image:url('${escapeCssUrl(category.image)}')"`
      : '';
    header = `<header class="bent-category-head${category && category.image ? ' has-cover' : ''}"${cover}>` +
      `<h2 class="bent-category-name">${name}</h2>${desc}</header>`;
  }

  const grid = articles.length
    ? `<div class="bent-cards">${articles.map((a) => renderCard(articleToCard(a, category))).join('')}</div>`
    : `<!-- bent-category: no published pages tagged "${escapeHtml(slug)}" -->`;

  return `<section${opts.idAttr || ''} class="bent-category${opts.cls || ''}"${opts.extra || ''}${styleAttr}${opts.dir || ''}>${header}${grid}</section>`;
}

module.exports = { renderCategory, articleToCard };
