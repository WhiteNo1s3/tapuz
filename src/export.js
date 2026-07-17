const { getPageByFullPath, listPages } = require('./pages');
const { renderPage } = require('./renderer');
const { loadConfig } = require('./config');
const { loadOverrides, overridesToCss } = require('./theme');
const fs = require('fs');
const path = require('path');

const { PUBLIC_DIR, THEMES_DIR } = require('./paths');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Static export externalizes the theme's inline styles (they already live in
 * /css/main.css) — but PAGE-specific styles (e.g. the page splash background)
 * can't go in the shared stylesheet, so they must survive the strip.
 * @param {string} html
 * @returns {string}
 */
function externalizeStyles(html) {
  const keep = (html.match(/<style id="tapuz-page-bg">[\s\S]*?<\/style>/) || [])[0] || '';
  let out = html.replace(/<style[\s\S]*?<\/style>/g, '');
  if (!out.includes('href="/css/main.css"')) {
    out = out.replace('</head>', '  <link rel="stylesheet" href="/css/main.css">\n</head>');
  }
  if (keep) out = out.replace('</head>', '  ' + keep + '\n</head>');
  return out;
}

function copyThemeAssets(themeSlug = 'default') {
  const themeCss = path.join(THEMES_DIR, themeSlug, 'css', 'main.css');
  const destDir = path.join(PUBLIC_DIR, 'css');
  const destFile = path.join(destDir, 'main.css');

  ensureDir(destDir);
  if (fs.existsSync(themeCss)) {
    const base = fs.readFileSync(themeCss, 'utf8');
    const overrides = overridesToCss(loadOverrides());
    fs.writeFileSync(destFile, base + '\n\n/* Tapuz theme overrides */\n' + overrides, 'utf8');
  }
}

// Home scoring lives in src/seo.js now (renderer needs it too and requiring
// export.js from the renderer would be a cycle); re-exported below unchanged.
const { scoreHomeCandidate } = require('./seo');

function writePageHtml(page, outputDir, isHome) {
  ensureDir(outputDir);
  copyThemeAssets(page.theme || 'default');

  // Harden filename so a crafted full_path can never write outside outputDir
  // (backslash + '..' stripped — matches pages.sanitizeFullPath / pzn-store).
  const filename = (page.full_path || 'page')
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '') + '.html';

  const outputPath = path.join(outputDir, filename);
  const siteConfig = loadConfig();
  // isHome flows into the render so the crowned home (and ONLY it) gets
  // canonical '/', og:url '/' and the WebSite JSON-LD object.
  let html = renderPage(page, { siteTitle: siteConfig.title, isHome: isHome === true });
  html = externalizeStyles(html);
  fs.writeFileSync(outputPath, html, 'utf8');
  // Home also becomes index.html — but keep its named file so menu links
  // (/<full_path>.html) never 404
  if (isHome) {
    const indexPath = path.join(outputDir, 'index.html');
    fs.writeFileSync(indexPath, html, 'utf8');
    return indexPath;
  }
  return outputPath;
}

function exportPage(fullPath, outputDir = PUBLIC_DIR) {
  const page = getPageByFullPath(fullPath);
  if (!page) throw new Error('Page not found: ' + fullPath);

  // Single-page export: home is CROWNED by ranking all published pages (one
  // winner via pickHomePath), never guessed from this page's own title — a
  // substring match ('דף הבית' inside an article headline) must not steal
  // index.html or ship canonical '/'.
  return writePageHtml(page, outputDir, fullPath === crownedHomePath());
}

/** The one published page that owns '/' right now, or null. An explicit
 *  config.homepage wins; otherwise the ranked heuristic (v0.78). */
function crownedHomePath() {
  const candidates = listPages()
    .filter((p) => p.status === 'published')
    .map((p) => getPageByFullPath(p.full_path) || p);
  return require('./seo').resolveHomePath(candidates, loadConfig().homepage);
}

function exportAll(outputDir = PUBLIC_DIR) {
  // Public build renders published snapshot only (blocks), never draft_blocks
  const pages = listPages().filter(p => p.status === 'published');
  const results = [];

  copyThemeAssets('default');

  // One homepage wins index.html — same crowning as exportPage/sitemap:
  // the user's explicit choice first, ranked pick as fallback, or none.
  const homePath = require('./seo').resolveHomePath(
    pages.map((p) => getPageByFullPath(p.full_path) || p),
    loadConfig().homepage
  );

  for (const p of pages) {
    try {
      const full = getPageByFullPath(p.full_path);
      if (!full) continue;
      // Ensure we export published blocks only
      const exportPageData = { ...full, blocks: full.blocks || [] };
      const isHome = homePath !== null && p.full_path === homePath;
      const out = writePageHtml(exportPageData, outputDir, isHome);
      results.push({ full_path: p.full_path, output: out, isHome });
    } catch (err) {
      console.error('Failed to export', p.full_path, err.message);
    }
  }
  return results;
}

module.exports = {
  exportPage,
  exportAll,
  copyThemeAssets,
  externalizeStyles,
  scoreHomeCandidate
};
