'use strict';

const { escapeHtml, escapeAttr } = require('../language/escape');
const { publicFileName } = require('./publish');

/**
 * Site chrome from manifest — header, nav, footer.
 * Wired into compile so built pages are real site pages, not naked module dumps.
 */

/**
 * @param {{ label: string, slug?: string, href?: string }} item
 * @param {string} [currentSlug]
 */
function menuHref(item, currentSlug) {
  if (item.href) return item.href;
  const file = publicFileName(item.slug);
  // relative links work when serving static public/
  return file === 'index.html' ? 'index.html' : file;
}

/**
 * @param {import('./manifest').SiteManifest} manifest
 * @param {{ slug?: string, title?: string }} [page]
 */
function renderHeader(manifest, page = {}) {
  const items = (manifest.menu || [])
    .map((item) => {
      const href = menuHref(item, page.slug);
      const active =
        item.slug &&
        (item.slug === page.slug ||
          (publicFileName(item.slug) === 'index.html' &&
            (!page.slug || page.slug === 'home' || page.slug === manifest.home)));
      const cls = active ? ' class="active"' : '';
      return `<li${cls}><a href="${escapeAttr(href)}">${escapeHtml(item.label)}</a></li>`;
    })
    .join('');

  const nav = items
    ? `<nav class="site-nav" aria-label="ראשי"><ul>${items}</ul></nav>`
    : '';

  return `<header class="site-header">
  <div class="header-inner">
    <a class="site-logo" href="index.html">${escapeHtml(manifest.name)}</a>
    ${nav}
  </div>
</header>`;
}

/**
 * @param {import('./manifest').SiteManifest} manifest
 */
function renderFooter(manifest) {
  return `<footer class="site-footer">
  <div class="footer-inner">
    <p>${escapeHtml(manifest.name)} · powered by .pzn</p>
  </div>
</footer>`;
}

/**
 * Wrap module body HTML in full site document using manifest chrome.
 * @param {object} doc  page AST document
 * @param {string} bodyHtml  compiled modules only
 * @param {import('./manifest').SiteManifest} manifest
 * @param {{ themeCssHref?: string, pretty?: boolean }} [opts]
 */
function wrapPage(doc, bodyHtml, manifest, opts = {}) {
  const lang = doc.lang || manifest.lang || 'he';
  const dir = doc.dir || manifest.dir || 'rtl';
  const title = doc.title
    ? `${doc.title} · ${manifest.name}`
    : manifest.name;
  const cssHref = opts.themeCssHref || '/css/site.css';
  const pretty = opts.pretty !== false;
  const nl = pretty ? '\n' : '';
  const header = renderHeader(manifest, { slug: doc.slug, title: doc.title });
  const footer = renderFooter(manifest);

  const parts = [
    '<!DOCTYPE html>',
    `<html lang="${escapeAttr(lang)}" dir="${escapeAttr(dir)}">`,
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(title)}</title>`,
    `  <link rel="stylesheet" href="${escapeAttr(cssHref)}">`,
    '</head>',
    '<body class="pzn-site">',
    '  <a class="skip-link" href="#main">דלג לתוכן</a>',
    indent(header, 2),
    '  <main id="main" class="site-main">',
    indent(bodyHtml, 4),
    '  </main>',
    indent(footer, 2),
    '</body>',
    '</html>',
    ''
  ];
  return parts.join(nl);
}

function indent(text, spaces) {
  if (!text) return '';
  const pad = ' '.repeat(spaces);
  return String(text)
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

module.exports = {
  menuHref,
  renderHeader,
  renderFooter,
  wrapPage
};
