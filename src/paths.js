// Central path resolution — the one place that knows where the site lives.
//
// SITE_ROOT is where user data goes: db/, config/, public/.
// Default: the package directory (current behavior). Override with the
// TAPUZ_ROOT env var to run against any directory — this is the first step
// of the cwd-based refactor for npm installs (site data in the user's
// project dir, not inside node_modules).
//
// Themes ship with the package: a site-local themes/ dir wins if it exists,
// otherwise the packaged themes are used.
const path = require('path');
const fs = require('fs');

const PACKAGE_ROOT = path.join(__dirname, '..');

/** Deploy-time root pin (v2.13). Some hosting panels bury (or simply lack)
 * env configuration for Node apps — so the DEPLOY ARCHIVE itself may carry a
 * one-line `.tapuz-root` file holding the absolute data path. The env var
 * still wins; the file is gitignored and injected by the deploy recipe
 * (docs/DEPLOY.md §3ב), never committed. This is what lets site data survive
 * redeploys — and even a rogue pipeline flattening the app tree. */
function pinnedRoot() {
  try {
    const p = fs.readFileSync(path.join(PACKAGE_ROOT, '.tapuz-root'), 'utf8').trim();
    return p || null;
  } catch (e) {
    return null;
  }
}

const SITE_ROOT = process.env.TAPUZ_ROOT
  ? path.resolve(process.env.TAPUZ_ROOT)
  : (pinnedRoot() ? path.resolve(pinnedRoot()) : PACKAGE_ROOT);

const siteThemes = path.join(SITE_ROOT, 'themes');
const THEMES_DIR = fs.existsSync(siteThemes) ? siteThemes : path.join(PACKAGE_ROOT, 'themes');

module.exports = {
  PACKAGE_ROOT,
  SITE_ROOT,
  DB_DIR: path.join(SITE_ROOT, 'db'),
  CONFIG_DIR: path.join(SITE_ROOT, 'config'),
  PUBLIC_DIR: path.join(SITE_ROOT, 'public'),
  ASSETS_DIR: path.join(SITE_ROOT, 'public', 'assets'),
  PAGES_DIR: path.join(SITE_ROOT, 'pages'),
  THEMES_DIR
};
