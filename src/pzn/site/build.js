'use strict';

const fs = require('fs');
const path = require('path');
const { BentError } = require('../language/errors');
const { parse } = require('../language/parse');
const { compileFragment } = require('../language/compile');
const { validate } = require('../language/validate');
const { loadManifest, writeManifest, defaultManifest, manifestRuntimeInfo } = require('./manifest');
const { wrapPage } = require('./layout');
const { publicFileName } = require('./publish');

/**
 * Real site build — manifest + .pzn pages + theme → static public/
 * This is the non-pipedream path: language modules are what compile runs.
 */

const DEFAULT_THEME_CSS = `/* pzn default theme — generated; override via theme/main.css in site root */
:root {
  --font-family: system-ui, "Segoe UI", "Noto Sans Hebrew", Arial, sans-serif;
  --max-width: 960px;
  --color-text: #111827;
  --color-muted: #6b7280;
  --color-primary: #0a66c2;
  --color-accent: #f59e0b;
  --color-border: #e5e7eb;
  --color-bg: #ffffff;
  --color-surface: #f8fafc;
  --radius: 12px;
}
* { box-sizing: border-box; }
html { font-size: 17px; line-height: 1.7; }
body {
  margin: 0;
  font-family: var(--font-family);
  color: var(--color-text);
  background: var(--color-bg);
}
[dir="rtl"] { direction: rtl; text-align: right; }
[dir="ltr"] { direction: ltr; text-align: left; }
.skip-link {
  position: absolute; left: -999px; top: 0;
  background: #000; color: #fff; padding: 0.5rem 1rem; z-index: 999;
}
.skip-link:focus { left: 0.5rem; top: 0.5rem; }
.site-header {
  border-bottom: 1px solid var(--color-border);
  background: #fff;
  position: sticky; top: 0; z-index: 50;
}
.header-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0.85rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.site-logo {
  font-weight: 800;
  font-size: 1.25rem;
  color: var(--color-text);
  text-decoration: none;
}
.site-nav ul {
  display: flex;
  gap: 1.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
  flex-wrap: wrap;
}
.site-nav a {
  color: var(--color-text);
  text-decoration: none;
  font-weight: 500;
}
.site-nav li.active a,
.site-nav a:hover { color: var(--color-primary); }
.site-main {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
}
.site-footer {
  border-top: 1px solid var(--color-border);
  color: var(--color-muted);
  font-size: 0.9rem;
}
.footer-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 1.25rem;
}
.bent-heading { margin: 0 0 0.55em; line-height: 1.25; }
.bent-text { margin: 0 0 1em; color: var(--color-muted); }
.btn {
  display: inline-block;
  padding: 0.6em 1.15em;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 600;
  border: 2px solid transparent;
}
.btn-primary { background: var(--color-primary); color: #fff; }
.btn-secondary { background: var(--color-accent); color: #111; }
.btn-outline { border-color: var(--color-primary); color: var(--color-primary); }
.hero, .bent-hero {
  padding: 2.25rem 1.5rem;
  border-radius: var(--radius);
  background: linear-gradient(135deg, #eff6ff, #f8fafc 55%, #fff7ed);
  border: 1px solid var(--color-border);
  margin-bottom: 1.5rem;
}
.columns, .bent-columns {
  display: grid;
  gap: 1.15rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin: 1.25rem 0;
}
.col {
  padding: 1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
.bent-section { margin: 1.5rem 0; }
.bent-image { margin: 1rem 0; text-align: center; }
.bent-image img { max-width: 100%; border-radius: 8px; }
.bent-image figcaption { color: var(--color-muted); font-size: 0.9em; }
.bent-list { margin: 0.5rem 0 1rem; padding-inline-start: 1.25rem; }
.bent-quote {
  margin: 1.5rem 0;
  padding: 1rem 1.25rem;
  border-inline-start: 4px solid var(--color-primary);
  background: var(--color-surface);
  border-radius: 0 var(--radius) var(--radius) 0;
}
.bent-divider { border: 0; border-top: 1px solid var(--color-border); margin: 2rem 0; }
.video-embed iframe { width: 100%; aspect-ratio: 16/9; border: 0; border-radius: 8px; }
.article-cubes {
  display: grid;
  gap: 1rem;
  margin: 1.25rem 0;
}
.article-cubes.cols-2 { grid-template-columns: repeat(2, 1fr); }
.article-cubes.cols-3 { grid-template-columns: repeat(3, 1fr); }
.article-cubes.cols-4 { grid-template-columns: repeat(4, 1fr); }
.article-cube {
  display: block;
  text-decoration: none;
  color: inherit;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.article-cube .cube-media img { width: 100%; display: block; aspect-ratio: 16/10; object-fit: cover; background: #e5e7eb; min-height: 100px; }
.article-cube .cube-body { padding: 0.85rem 1rem; }
.article-cube h3 { margin: 0 0 0.35rem; }
.article-cube p { margin: 0; color: var(--color-muted); font-size: 0.92em; }
@media (max-width: 640px) {
  .article-cubes.cols-2,
  .article-cubes.cols-3,
  .article-cubes.cols-4 { grid-template-columns: 1fr; }
}
`;

/**
 * Collect article cards from parsed pages for article-list modules.
 * @param {Array<{ doc: object, file: string, slug: string }>} pages
 */
function collectArticles(pages) {
  return pages
    .filter((p) => (p.doc.tags || []).includes('article'))
    .map((p) => ({
      title: p.doc.title,
      url: p.file,
      teaser: p.doc.meta?.teaser || '',
      image: p.doc.meta?.cardImage || '',
      tags: p.doc.tags || []
    }));
}

/**
 * Read all .pzn pages under pagesDir.
 * @param {string} pagesDir
 */
function readPages(pagesDir) {
  if (!fs.existsSync(pagesDir)) {
    throw new BentError('E_BUILD', `Pages directory missing: ${pagesDir}`);
  }
  const names = fs
    .readdirSync(pagesDir)
    .filter((f) => f.endsWith('.pzn'))
    .sort();
  if (!names.length) {
    throw new BentError('E_BUILD', `No .pzn files in ${pagesDir}`);
  }

  return names.map((name) => {
    const source = fs.readFileSync(path.join(pagesDir, name), 'utf8');
    const doc = parse(source);
    // slug from meta or filename
    let slug = doc.slug || path.basename(name, '.pzn');
    if (!doc.slug) doc.slug = slug;
    const file = publicFileName(slug);
    return { name, source, doc, slug, file };
  });
}

/**
 * Build a complete static site from a site root that has site.json.
 *
 * @param {string} siteRoot
 * @param {{ outDir?: string }} [opts]
 * @returns {object} build report
 */
function buildSite(siteRoot, opts = {}) {
  const { root, path: manifestPath, manifest } = loadManifest(siteRoot);
  const pagesDir = path.join(root, manifest.pagesDir);
  const outDir = path.resolve(opts.outDir || path.join(root, manifest.build.out));

  const pages = readPages(pagesDir);

  // validate every page against module registry (the new language)
  const issues = [];
  for (const p of pages) {
    for (const issue of validate(p.doc)) {
      issues.push({ page: p.name, ...issue });
    }
  }
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    const first = errors[0];
    throw new BentError(
      'E_BUILD',
      `Build blocked: ${first.page}: ${first.message}`,
      { path: first.path }
    );
  }

  const articles = collectArticles(pages);
  fs.mkdirSync(outDir, { recursive: true });

  // theme CSS → public/css/site.css (manifest theme path or default)
  const cssOutDir = path.join(outDir, 'css');
  fs.mkdirSync(cssOutDir, { recursive: true });
  const themeRel = manifest.theme?.css || 'theme/main.css';
  const themeSrc = path.join(root, themeRel);
  const cssText = fs.existsSync(themeSrc)
    ? fs.readFileSync(themeSrc, 'utf8')
    : DEFAULT_THEME_CSS;
  fs.writeFileSync(path.join(cssOutDir, 'site.css'), cssText, 'utf8');

  // optional media copy
  const mediaSrc = path.join(root, 'media');
  if (fs.existsSync(mediaSrc)) {
    copyDir(mediaSrc, path.join(outDir, 'media'));
  }

  const written = [];
  let indexFile = null;

  for (const p of pages) {
    const bodyHtml = compileFragment(p.doc.body || [], {
      dir: p.doc.dir || manifest.dir,
      lang: p.doc.lang || manifest.lang,
      articles,
      pretty: true
    });
    // relative css works for static serve from public/
    const html = wrapPage(p.doc, bodyHtml, manifest, {
      themeCssHref: 'css/site.css',
      pretty: true
    });
    const dest = path.join(outDir, p.file);
    fs.writeFileSync(dest, html, 'utf8');
    written.push(p.file);
    if (p.file === 'index.html') indexFile = dest;

    // also ensure home slug matches manifest.home
    if (p.slug === manifest.home && p.file !== 'index.html') {
      const indexPath = path.join(outDir, 'index.html');
      fs.writeFileSync(indexPath, html, 'utf8');
      if (!written.includes('index.html')) written.push('index.html');
      indexFile = indexPath;
    }
  }

  if (!indexFile) {
    throw new BentError(
      'E_BUILD',
      `No home page. Need a .pzn with slug "${manifest.home}" (or filename home.pzn)`
    );
  }

  // write build stamp (manifest implemented in output)
  const stamp = {
    builtAt: new Date().toISOString(),
    site: manifest.name,
    pzn: manifest.pzn,
    runtime: manifestRuntimeInfo(manifest),
    files: written.sort(),
    articles: articles.length
  };
  fs.writeFileSync(path.join(outDir, 'build.json'), JSON.stringify(stamp, null, 2) + '\n', 'utf8');

  return {
    ok: true,
    root,
    manifestPath,
    manifest,
    outDir,
    files: written.sort(),
    index: indexFile,
    css: path.join(cssOutDir, 'site.css'),
    articles: articles.length,
    runtime: manifestRuntimeInfo(manifest),
    issues
  };
}

/**
 * Scaffold a real site root: site.json + pages + theme.
 * @param {string} siteRoot
 * @param {{ name?: string, force?: boolean }} [opts]
 */
function initSite(siteRoot, opts = {}) {
  const root = path.resolve(siteRoot);
  fs.mkdirSync(root, { recursive: true });

  const { manifest, path: manifestPath } = writeManifest(
    root,
    {
      name: opts.name || path.basename(root) || 'אתר חדש',
      menu: [
        { label: 'בית', slug: 'home' },
        { label: 'אודות', slug: 'about' }
      ]
    },
    { force: !!opts.force }
  );

  const pagesDir = path.join(root, manifest.pagesDir);
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'theme'), { recursive: true });
  fs.mkdirSync(path.join(root, 'media'), { recursive: true });

  const themeCss = path.join(root, 'theme', 'main.css');
  if (!fs.existsSync(themeCss) || opts.force) {
    fs.writeFileSync(themeCss, DEFAULT_THEME_CSS, 'utf8');
  }

  const homePzn = path.join(pagesDir, 'home.pzn');
  if (!fs.existsSync(homePzn) || opts.force) {
    fs.writeFileSync(
      homePzn,
      `<!DOCTYPE html>
<html lang="${manifest.lang}" dir="${manifest.dir}" bent-version="0.1">
<head>
  <meta charset="utf-8" />
  <title>בית</title>
  <meta name="bent-slug" content="home" />
</head>
<body>
  <bent-hero id="hero">
    <bent-heading id="h1" level="1">ברוכים הבאים ל־${escapeXml(manifest.name)}</bent-heading>
    <bent-text id="t1">אתר שנבנה מ־.pzn — המניפסט מחובר לבילד האמיתי.</bent-text>
    <bent-button id="btn" href="about.html" variant="primary">אודות</bent-button>
  </bent-hero>
</body>
</html>
`,
      'utf8'
    );
  }

  const aboutPzn = path.join(pagesDir, 'about.pzn');
  if (!fs.existsSync(aboutPzn) || opts.force) {
    fs.writeFileSync(
      aboutPzn,
      `<!DOCTYPE html>
<html lang="${manifest.lang}" dir="${manifest.dir}" bent-version="0.1">
<head>
  <meta charset="utf-8" />
  <title>אודות</title>
  <meta name="bent-slug" content="about" />
</head>
<body>
  <bent-heading id="h" level="1">אודות</bent-heading>
  <bent-text id="t">עמוד שנכתב ב־benTML, נבנה דרך site.json.</bent-text>
</body>
</html>
`,
      'utf8'
    );
  }

  return { root, manifestPath, manifest, pagesDir };
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

module.exports = {
  DEFAULT_THEME_CSS,
  buildSite,
  initSite,
  readPages,
  collectArticles
};
