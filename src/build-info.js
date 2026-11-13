'use strict';

/**
 * Build fingerprint — WHICH code is this install running, and where does it
 * keep the site? Ben (2026-09-10): "I republished, the theme changes still
 * don't show" — with an archive deploy (docs/DEPLOY.md §3ב) a push to main
 * deploys nothing, and an archive built from an un-pulled clone ships the old
 * code with a straight face. The only cure is a fingerprint you can read off
 * the live site: every rendered page carries it as <meta name="generator">,
 * and /admin/theme prints it beside the site root, the last build time and
 * the stylesheet version — so "did my change reach the site" is one
 * view-source away instead of a guess.
 *
 * `.build-id` is written by the deploy build (scripts/deploy-decoy.js):
 * <version>+<utc stamp>[.<git sha>]. No build (plain `npm start` on a
 * clone, or a host that deploys straight from git) → <version>+dev.<hash>,
 * where the hash follows the files a deploy changes (v2.69, below).
 */

const fs = require('fs');
const path = require('path');
const { PACKAGE_ROOT, SITE_ROOT, PUBLIC_DIR } = require('./paths');

function version() {
  try { return require('../package.json').version; } catch (e) { return '0'; }
}

// Without a `.build-id` the id used to be the constant <version>+dev. A host
// that deploys from git writes no stamp, so every deploy of the same version
// looked like the build already running: boot never rebuilt the export, and
// no asset address changed — a fix to the theme's stylesheet or the
// storefront script reached nobody (seen on the live demo shop). The id now
// carries a short hash of what a deploy actually changes: package.json's
// contents, and the size and modification time of the code that draws the
// site — everything under src/ and themes/, the package's own scripts in
// public/ (the storefront script among them) and the admin stylesheet. Not
// the rest of public/: on a plain clone that directory is also where the
// site is exported, and an id that moved with every export would never
// settle. Same files → same id, so a plain restart rebuilds nothing; a
// deploy rewrites some of them → a new id → the export is rebuilt and every
// stamped asset gets a new address.
function deployFingerprint(root) {
  const base = root || PACKAGE_ROOT;
  const h = require('crypto').createHash('sha1');
  try { h.update(fs.readFileSync(path.join(base, 'package.json'))); } catch (e) { h.update('no-package'); }
  const mark = (rel) => {
    try {
      const st = fs.statSync(path.join(base, rel));
      h.update(rel + ':' + st.size + ':' + Math.round(st.mtimeMs) + '\n');
    } catch (e) {
      h.update(rel + ':missing\n');
    }
  };
  const walk = (relDir, wanted, deep) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(base, relDir), { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of entries) {
      const rel = relDir + '/' + d.name;
      if (d.isDirectory()) { if (deep) walk(rel, wanted, deep); }
      else if (d.isFile() && wanted.test(d.name)) mark(rel);
    }
  };
  walk('src', /\.(?:js|json)$/, true);
  walk('themes', /\.(?:css|html|js|json)$/, true);
  walk('public', /\.js$/, false);
  mark('public/css/admin.css');
  return h.digest('hex').slice(0, 8);
}

// Walked once per process: the files do not change under a running server,
// and buildId() is asked for on every rendered page.
let devId = '';

function buildId() {
  try {
    const s = fs.readFileSync(path.join(PACKAGE_ROOT, '.build-id'), 'utf8').trim();
    if (s) return s.slice(0, 80);
  } catch (e) { /* no build stamp — a plain clone */ }
  if (!devId) devId = version() + '+dev.' + deployFingerprint();
  return devId;
}

/**
 * The cache-busting stamp for the admin's own assets (v2.33.2). A short
 * digest of the build id: it changes on every deploy and stays put between
 * deploys, so `/admin-builder.js?v=<stamp>` is a NEW URL the moment new
 * code lands — the one thing every browser and every hosting edge respects.
 * (Headers are not enough: on Hostinger the edge serves public/ directly
 * and drops whatever Cache-Control Node sets.) Computed once per process.
 */
let assetStamp = '';
function assetVersion() {
  if (!assetStamp) {
    assetStamp = require('crypto').createHash('sha1').update(buildId()).digest('hex').slice(0, 10);
  }
  return assetStamp;
}

/** ISO time of the last static build (the exported home page), or ''. */
function lastExportAt() {
  try {
    return fs.statSync(path.join(PUBLIC_DIR, 'index.html')).mtime.toISOString();
  } catch (e) {
    return '';
  }
}

function buildInfo() {
  let cssVersion = '';
  try { cssVersion = require('./export').currentThemeCssVersion(); } catch (e) { /* no export yet */ }
  return {
    version: version(),
    buildId: buildId(),
    siteRoot: SITE_ROOT,
    publicDir: PUBLIC_DIR,
    lastExportAt: lastExportAt(),
    cssVersion
  };
}

/** One line for the theme page (paths are LTR by nature). */
function summaryLine() {
  const i = buildInfo();
  return `build ${i.buildId} · site root ${i.siteRoot} · last site build ${i.lastExportAt || 'never'} · css v${i.cssVersion || '-'}`;
}

module.exports = { buildId, buildInfo, lastExportAt, summaryLine, assetVersion, deployFingerprint };
