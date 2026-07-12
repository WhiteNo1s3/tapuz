'use strict';

const fs = require('fs');
const path = require('path');
const { BentError } = require('../language/errors');
const { moduleNames } = require('../modules/registry');

/**
 * Site manifest — the contract that makes .pzn a real site, not a pipedream.
 *
 * File: site.json (in site root)
 * Required for `pzn build`. Declares pages dir, home slug, menu, theme, module registry.
 */

const MANIFEST_NAME = 'site.json';
const MANIFEST_VERSION = '0.1';

/**
 * @typedef {object} SiteManifest
 * @property {string} pzn           language/manifest version
 * @property {string} name
 * @property {string} [lang]
 * @property {string} [dir]
 * @property {string} [home]        slug that becomes index.html
 * @property {string} [pagesDir]    relative to site root
 * @property {{ css?: string }} [theme]
 * @property {Array<{ label: string, slug?: string, href?: string }>} [menu]
 * @property {{ registry?: string }} [modules]
 * @property {{ out?: string }} [build]
 */

/**
 * Default manifest skeleton (written by `pzn init` / used as fill-ins).
 * @param {Partial<SiteManifest>} [partial]
 * @returns {SiteManifest}
 */
function defaultManifest(partial = {}) {
  return {
    pzn: MANIFEST_VERSION,
    name: partial.name || 'אתר חדש',
    lang: partial.lang || 'he',
    dir: partial.dir || 'rtl',
    home: partial.home || 'home',
    pagesDir: partial.pagesDir || 'pages',
    theme: {
      css: partial.theme?.css || 'theme/main.css'
    },
    menu: Array.isArray(partial.menu) ? partial.menu : [],
    modules: {
      // builtin = src/modules/registry — the new language type system
      registry: partial.modules?.registry || 'builtin'
    },
    build: {
      out: partial.build?.out || 'public'
    }
  };
}

/**
 * Validate manifest object. Throws BentError on hard failures.
 * @param {object} raw
 * @returns {SiteManifest}
 */
function validateManifest(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new BentError('E_MANIFEST', 'site.json must be a JSON object');
  }
  const m = defaultManifest(raw);

  if (!m.name || typeof m.name !== 'string') {
    throw new BentError('E_MANIFEST', 'site.json: name is required');
  }
  if (m.dir !== 'rtl' && m.dir !== 'ltr') {
    throw new BentError('E_MANIFEST', 'site.json: dir must be rtl|ltr');
  }
  if (m.modules.registry !== 'builtin') {
    throw new BentError(
      'E_MANIFEST',
      `site.json: modules.registry "${m.modules.registry}" not supported (only "builtin" in v0.1)`
    );
  }

  // Soft: menu items need slug or href
  for (const item of m.menu) {
    if (!item.label) {
      throw new BentError('E_MANIFEST', 'site.json: menu item missing label');
    }
    if (!item.slug && !item.href) {
      throw new BentError('E_MANIFEST', `site.json: menu "${item.label}" needs slug or href`);
    }
  }

  return m;
}

/**
 * Resolve site root that contains site.json.
 * @param {string} siteRoot
 * @returns {{ root: string, path: string, manifest: SiteManifest }}
 */
function loadManifest(siteRoot) {
  const root = path.resolve(siteRoot);
  const manifestPath = path.join(root, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new BentError(
      'E_MANIFEST',
      `No ${MANIFEST_NAME} in ${root}. This is not a pzn site root. Run: pzn init <dir>`
    );
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new BentError('E_MANIFEST', `Invalid JSON in ${manifestPath}: ${err.message}`);
  }
  const manifest = validateManifest(raw);
  return { root, path: manifestPath, manifest };
}

/**
 * Write a new site.json (does not overwrite unless force).
 * @param {string} siteRoot
 * @param {Partial<SiteManifest>} [partial]
 * @param {{ force?: boolean }} [opts]
 */
function writeManifest(siteRoot, partial = {}, opts = {}) {
  const root = path.resolve(siteRoot);
  fs.mkdirSync(root, { recursive: true });
  const manifestPath = path.join(root, MANIFEST_NAME);
  if (fs.existsSync(manifestPath) && !opts.force) {
    throw new BentError('E_MANIFEST', `${manifestPath} already exists (use force to overwrite)`);
  }
  const manifest = defaultManifest(partial);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { root, path: manifestPath, manifest };
}

/**
 * What the manifest claims the language stack is (for loader/UI honesty).
 * @param {SiteManifest} manifest
 */
function manifestRuntimeInfo(manifest) {
  return {
    manifestVersion: manifest.pzn,
    language: 'bentml',
    fileExtension: '.pzn',
    moduleRegistry: manifest.modules.registry,
    moduleNames: moduleNames(),
    pagesDir: manifest.pagesDir,
    home: manifest.home,
    themeCss: manifest.theme.css,
    buildOut: manifest.build.out
  };
}

module.exports = {
  MANIFEST_NAME,
  MANIFEST_VERSION,
  defaultManifest,
  validateManifest,
  loadManifest,
  writeManifest,
  manifestRuntimeInfo
};
