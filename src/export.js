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
// The exported stylesheet's content hash, refreshed by copyThemeAssets.
// Every theme change (colors, chrome, effects) lands in /css/main.css under
// the SAME url — and hosts cache it (Hostinger's LiteSpeed/CDN for hours,
// browsers per their heuristics), so the site kept showing the OLD theme
// after a rebuild. The version query makes each theme state a new url.
let themeCssVersion = '';

function themeCssHref() {
  return '/css/main.css' + (themeCssVersion ? '?v=' + themeCssVersion : '');
}

/** The version of the stylesheet currently ON DISK (what visitors get), or ''. */
function currentThemeCssVersion() {
  try {
    const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'main.css'), 'utf8');
    return require('crypto').createHash('sha1').update(css).digest('hex').slice(0, 10);
  } catch (e) {
    return '';
  }
}

function externalizeStyles(html) {
  const keep = (html.match(/<style id="tapuz-page-bg">[\s\S]*?<\/style>/) || [])[0] || '';
  let out = html.replace(/<style[\s\S]*?<\/style>/g, '');
  const href = themeCssHref();
  out = out.replace(/href="\/css\/main\.css(?:\?v=[^"]*)?"/g, `href="${href}"`);
  if (!out.includes('href="/css/main.css')) {
    out = out.replace('</head>', `  <link rel="stylesheet" href="${href}">\n</head>`);
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
    const live = loadOverrides();
    const overrides = overridesToCss(live);
    const out = base + '\n\n/* Tapuz theme overrides */\n' + overrides;
    themeCssVersion = require('crypto').createHash('sha1').update(out).digest('hex').slice(0, 10);
    fs.writeFileSync(destFile, out, 'utf8');
    // v2.27 wrote an admin copy here (the base + the palette and fonts). The
    // admin links nothing of the theme any more (v2.29, admin-ui.js layout),
    // so a copy left by an earlier build is removed rather than kept around.
    try { fs.rmSync(path.join(destDir, 'admin-theme.css'), { force: true }); } catch (e) { /* not there */ }
  }
}

// Home scoring lives in src/seo.js now (renderer needs it too and requiring
// export.js from the renderer would be a cycle); re-exported below unchanged.
const { scoreHomeCandidate } = require('./seo');

// Harden filename so a crafted full_path can never write outside outputDir
// (backslash + '..' stripped — matches pages.sanitizeFullPath / pzn-store).
// Shared by write AND remove so the two can never disagree on a page's file.
function publicHtmlName(fullPath) {
  return (fullPath || 'page')
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '') + '.html';
}

function writePageHtml(page, outputDir, isHome) {
  ensureDir(outputDir);
  copyThemeAssets(page.theme || 'default');

  const filename = publicHtmlName(page.full_path);

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

/**
 * Remove a page's exported HTML when it leaves the published site (delete /
 * unpublish / rename). The DB, revisions and .pzn store all follow those
 * transitions; without this the static export is the one layer that never
 * forgets, and a dead address keeps serving forever. If the page owned '/'
 * (its file IS index.html), '/' is handed to the next crowned home — or goes
 * down with the page when no published page remains.
 */
function removePageHtml(fullPath, outputDir = PUBLIC_DIR) {
  const target = path.join(outputDir, publicHtmlName(fullPath));
  if (!fs.existsSync(target)) return false;
  const indexPath = path.join(outputDir, 'index.html');
  let ownedRoot = false;
  try {
    ownedRoot = fs.existsSync(indexPath) &&
      fs.readFileSync(indexPath, 'utf8') === fs.readFileSync(target, 'utf8');
  } catch (e) { /* root comparison is best-effort */ }
  fs.unlinkSync(target);
  if (ownedRoot) {
    try {
      const nextHome = crownedHomePath();
      if (nextHome && nextHome !== fullPath) exportPage(nextHome, outputDir);
      else fs.unlinkSync(indexPath);
    } catch (e) {
      try { fs.unlinkSync(indexPath); } catch (e2) { /* already gone */ }
    }
  }
  return true;
}

// The build id that produced the export on disk, kept beside it.
const BUILT_BY = '.built-by';

/** The build id stamped on the export in outputDir, or ''. */
function exportBuiltBy(outputDir = PUBLIC_DIR) {
  try { return fs.readFileSync(path.join(outputDir, BUILT_BY), 'utf8').trim(); } catch (e) { return ''; }
}

/**
 * Rebuild the static site after a deploy (v2.26). The live pages ARE the
 * export, and the export is regenerated only when someone saves — so a new
 * deploy kept serving the PREVIOUS code's pages (no build fingerprint, no
 * versioned stylesheet, none of the new theme css) until the owner touched
 * something. Ben: "I published and nothing changed." Called once at boot:
 * when the export was produced by a different build than the one running
 * (or carries no stamp at all), it is rebuilt. A site with no published
 * pages is left alone (exportAll fails closed on zero pages anyway).
 * @returns {{ rebuilt: boolean, from: string, to: string }}
 */
function refreshAfterDeploy(outputDir = PUBLIC_DIR) {
  const to = require('./build-info').buildId();
  const from = exportBuiltBy(outputDir);
  if (from === to) return { rebuilt: false, from, to };
  let published = 0;
  try { published = listPages().filter((p) => p.status === 'published').length; } catch (e) { published = 0; }
  if (!published) return { rebuilt: false, from, to };
  exportAll(outputDir);
  return { rebuilt: true, from, to };
}

function exportAll(outputDir = PUBLIC_DIR) {
  // Public build renders published snapshot only (blocks), never draft_blocks
  const pages = listPages().filter(p => p.status === 'published');
  const results = [];

  copyThemeAssets('default');
  // which code produced this export — refreshAfterDeploy compares it to the
  // running build so a deploy never keeps serving the previous code's pages
  try { ensureDir(outputDir); fs.writeFileSync(path.join(outputDir, BUILT_BY), require('./build-info').buildId() + '\n', 'utf8'); } catch (e) { /* the stamp is advisory */ }

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
  writeSearchIndex(outputDir);

  // The exported tree mirrors the DB's published set exactly — a page that
  // left it (deleted / unpublished / renamed) must not keep serving from a
  // stale file, so every full build reconciles. Top-level *.html is CMS-owned
  // build output; css/, uploads and search-index.json are untouched. Keyed to
  // the DB list (not this pass's writes) so a page whose render failed above
  // keeps its previous good file instead of being taken down.
  //
  // The one state that is NOT drift: an EMPTY published set. db/*.db is
  // gitignored, so a server that clones the repo and runs `npm run export:static`
  // arrives here with pages = [] — indistinguishable from a database that
  // failed to open or migrate. Unguarded, the reconciler reads that as "every
  // exported page is stale" and deletes the entire site, index.html included,
  // and nothing regenerates it: the DB that would is the thing that was empty.
  // So the reconciler fails CLOSED on zero pages. The one path where taking
  // the last page down IS what the owner asked for stays covered — unpublish,
  // delete and rename each call removePageHtml directly (pages.js).
  if (pages.length === 0) {
    console.warn(
      '[export] no published pages in the database — leaving ' + outputDir +
      ' untouched rather than pruning it. Fresh install? Run the setup wizard ' +
      'at /admin, or point TAPUZ_ROOT at the site whose db/tapuz.db holds your pages.'
    );
    return results;
  }

  const keep = new Set(pages.map((p) => publicHtmlName(p.full_path)));
  if (homePath !== null) keep.add('index.html');
  try {
    for (const f of fs.readdirSync(outputDir)) {
      if (!f.endsWith('.html') || keep.has(f)) continue;
      const stale = path.join(outputDir, f);
      try {
        if (fs.statSync(stale).isFile()) fs.unlinkSync(stale);
      } catch (e) { /* best-effort — a locked file just stays until next build */ }
    }
  } catch (e) { /* outputDir unreadable — nothing to prune */ }

  return results;
}

/**
 * search-index.json (v0.98) — published-site search, the static-export gap
 * vs. WordPress. Only written when the site owner turned it on
 * (config.integrations.search.enabled, /admin/integrations); express.static
 * already serves anything under outputDir, so no dedicated route is needed —
 * a fresh site with no search-index.json just 404s and the client widget
 * degrades to an empty result set (see renderer.js renderSearchWidget).
 */
function writeSearchIndex(outputDir) {
  try {
    const cfg = loadConfig();
    const enabled = !!(cfg.integrations && cfg.integrations.search && cfg.integrations.search.enabled);
    const indexPath = path.join(outputDir, 'search-index.json');
    if (!enabled) {
      // Toggled off after being on once — don't leave a stale index lying
      // around answering searches nobody can reach from the (now-hidden) UI.
      if (fs.existsSync(indexPath)) fs.unlinkSync(indexPath);
      return;
    }
    const index = require('./pages').listSearchable();
    fs.writeFileSync(indexPath, JSON.stringify(index), 'utf8');
  } catch (e) {
    console.error('Failed to write search-index.json', e.message);
  }
}

module.exports = {
  exportPage,
  exportAll,
  refreshAfterDeploy,
  exportBuiltBy,
  BUILT_BY,
  removePageHtml,
  publicHtmlName,
  copyThemeAssets,
  currentThemeCssVersion,
  externalizeStyles,
  scoreHomeCandidate
};
