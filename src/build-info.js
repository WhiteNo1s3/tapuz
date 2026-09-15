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
 * clone) → <version>+dev.
 */

const fs = require('fs');
const path = require('path');
const { PACKAGE_ROOT, SITE_ROOT, PUBLIC_DIR } = require('./paths');

function version() {
  try { return require('../package.json').version; } catch (e) { return '0'; }
}

function buildId() {
  try {
    const s = fs.readFileSync(path.join(PACKAGE_ROOT, '.build-id'), 'utf8').trim();
    if (s) return s.slice(0, 80);
  } catch (e) { /* no build stamp — a plain clone */ }
  return version() + '+dev';
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

module.exports = { buildId, buildInfo, lastExportAt, summaryLine, assetVersion };
