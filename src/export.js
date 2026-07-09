const { getPageByFullPath, listPages } = require('./pages');
const { renderPage } = require('./renderer');
const { loadConfig } = require('./config');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyThemeAssets(themeSlug = 'default') {
  const themeCss = path.join(__dirname, '..', 'themes', themeSlug, 'css', 'main.css');
  const destDir = path.join(PUBLIC_DIR, 'css');
  const destFile = path.join(destDir, 'main.css');

  ensureDir(destDir);
  if (fs.existsSync(themeCss)) {
    fs.copyFileSync(themeCss, destFile);
  }
}

function scoreHomeCandidate(page) {
  if (!page) return -1;
  const title = (page.title || '').toLowerCase();
  const fullPath = page.full_path || '';
  let score = 0;
  if (fullPath === 'amvd-hbyt') score += 100;
  if (fullPath === 'home') score += 40;
  if (title.includes('whiteno1se') && title.includes('עמוד הבית')) score += 80;
  if (title === 'עמוד הבית' || title.includes('דף הבית')) score += 50;
  if (title === 'home') score += 20;
  try {
    const blocks = typeof page.blocks === 'string' ? JSON.parse(page.blocks) : page.blocks || [];
    score += Math.min((blocks || []).length, 40);
  } catch (e) {}
  return score;
}

function writePageHtml(page, outputDir, isHome) {
  ensureDir(outputDir);
  copyThemeAssets(page.theme || 'default');

  const filename = isHome
    ? 'index.html'
    : (page.full_path || 'page').replace(/\s+/g, '-').replace(/[\/:*?"<>|]/g, '') + '.html';

  const outputPath = path.join(outputDir, filename);
  const siteConfig = loadConfig();
  let html = renderPage(page, { siteTitle: siteConfig.title });
  html = html.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/css/main.css">');
  fs.writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}

function exportPage(fullPath, outputDir = PUBLIC_DIR) {
  const page = getPageByFullPath(fullPath);
  if (!page) throw new Error('Page not found: ' + fullPath);

  // Single-page export: treat classic home paths as index
  const isHome =
    fullPath === 'amvd-hbyt' ||
    fullPath === 'home' ||
    /עמוד הבית|דף הבית|^home$/i.test(page.title || '');

  return writePageHtml(page, outputDir, isHome);
}

function exportAll(outputDir = PUBLIC_DIR) {
  const pages = listPages();
  const results = [];

  copyThemeAssets('default');

  // One homepage wins index.html (richest WhiteNo1se home preferred)
  let homePath = null;
  let best = -1;
  for (const p of pages) {
    const full = getPageByFullPath(p.full_path);
    const s = scoreHomeCandidate(full || p);
    if (s > best) {
      best = s;
      homePath = p.full_path;
    }
  }

  for (const p of pages) {
    try {
      const full = getPageByFullPath(p.full_path);
      if (!full) continue;
      const isHome = best >= 20 && p.full_path === homePath;
      const out = writePageHtml(full, outputDir, isHome);
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
  copyThemeAssets
};
