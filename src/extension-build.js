'use strict';

/**
 * One build of a browser extension, per browser, from its source folder
 * (v2.41 — moved out of the ZIP route so two consumers make the same bytes).
 *
 * The admin's download (`/admin/ai-setup/extension-:which-:browser.zip`,
 * src/routes/copilot.js) zips it. `scripts/update-bridge.js` writes it into a
 * folder OUTSIDE any git checkout, where a developer's unpacked Bridge lives.
 * Ben: "the bridge won't update in my own folder" — Chrome was loading the
 * Bridge from `extension-v2a/` inside a checkout 18 commits behind, patched by
 * hand, while every new ZIP landed in Downloads as "(2).zip" and never reached
 * that folder. An updater that tailored the manifest on its own would drift
 * from the ZIP the site serves; so the tailoring lives here, once.
 *
 * Rules learned the hard way (v2.18.1 — Ben installed the generic zip on
 * Firefox and it refused):
 *   • manifest.json sits at the ROOT (no wrapping folder) — both Chrome's
 *     drag-install and Firefox's about:debugging reject otherwise
 *   • Firefox needs browser_specific_settings.gecko; Chrome warns on it —
 *     so each browser gets a manifest tailored from the same source folder
 *   • the Bridge build is wired to the site it is made for (v2.34,
 *     src/bridge-manifest.js); the copy companion never is
 */

const fs = require('fs');
const path = require('path');

// Whitelist keyed — no param ever touches the filesystem.
const EXTENSION_DIRS = {
  byot: { dir: 'extension', base: 'tapuziel-companion' },
  bridge: { dir: 'extension-v2a', base: 'tapuziel-bridge-v2' }
};
const BROWSERS = ['chrome', 'firefox'];

/**
 * @param {string} which 'bridge' | 'byot'
 * @param {string} browser 'chrome' | 'firefox'
 * @param {string} [hostname] the site this copy is for (the Bridge only)
 * @returns {null | { dir: string, base: string, manifest: object, manifestText: string }}
 *   null for an unknown extension or browser
 */
function extensionBuild(which, browser, hostname) {
  const entry = Object.prototype.hasOwnProperty.call(EXTENSION_DIRS, which) ? EXTENSION_DIRS[which] : null;
  if (!entry || !BROWSERS.includes(browser)) return null;
  const dir = path.join(__dirname, '..', entry.dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (browser === 'chrome') {
    delete manifest.browser_specific_settings; // Chrome-only build: no FF keys, no warnings
    // Firefox MV3 uses background.scripts alongside service_worker; Chrome
    // wants only the worker (the bridge ships both for cross-browser)
    if (manifest.background && manifest.background.scripts && manifest.background.service_worker) {
      delete manifest.background.scripts;
    }
  } else if (manifest.background && manifest.background.service_worker && !manifest.background.scripts) {
    // Firefox build: event page via scripts (FF ignores/limits workers)
    manifest.background.scripts = [manifest.background.service_worker];
  }
  // the bridge arrives connected to the site it was made for, so no
  // hand-patched manifest in a git checkout is needed (src/bridge-manifest.js)
  if (which === 'bridge') require('./bridge-manifest').wireBridgeToSite(manifest, hostname);
  return { dir, base: entry.base, manifest, manifestText: JSON.stringify(manifest, null, 2) + '\n' };
}

/**
 * The build's files, in the order and with the bytes the ZIP carries
 * (the same walk as src/zip-store.js `zipDirectory`, manifest overridden).
 * @param {{ dir: string, manifestText: string }} build
 * @returns {{ rel: string, data: Buffer }[]}
 */
function buildFiles(build) {
  const files = [];
  (function walk(cur, rel) {
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      if (fs.statSync(full).isDirectory()) walk(full, rel + name + '/');
      else files.push({ rel: rel + name, data: rel + name === 'manifest.json' ? Buffer.from(build.manifestText) : fs.readFileSync(full) });
    }
  })(build.dir, '');
  return files;
}

module.exports = { EXTENSION_DIRS, BROWSERS, extensionBuild, buildFiles };
