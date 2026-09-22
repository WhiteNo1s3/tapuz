'use strict';

/**
 * Site packages (v1.06) — ".pzn is our RPM" applied to a whole site, not
 * just a theme (v0.99). Every page's canonical .pzn source (draft +
 * published), theme overrides, menus, and a safe non-secret config subset,
 * bundled into one portable, versioned, self-describing file — the same
 * shape as theme packages, one level up. Export/import a whole site
 * between Tapuz installs.
 *
 * Security: import NEVER overwrites an existing page by default (collision
 * = skipped, reported) and NEVER touches secrets (config.admin.path stays
 * local, no SMTP/AI keys are ever part of a site or theme package — those
 * live in gitignored config/*.json files this module never reads).
 */

const { listPages, getPageSource, createPage, savePageSource } = require('./pages');
const { loadOverrides, saveOverrides } = require('./theme');
const { loadMenus, saveMenus } = require('./menus');
const { loadConfig, saveConfig } = require('./config');

const SITE_PACKAGE_FORMAT = 'tapuz-site';
const SITE_PACKAGE_VERSION = 1;

// Only these top-level config fields travel with a site package — never
// admin.path, agent tokens, or anything secret-adjacent.
const CONFIG_FIELDS = ['title', 'description', 'language', 'logo', 'seo', 'homepage'];

/** The whole site as a portable, versioned, self-describing package. */
function exportSitePackage(name) {
  const config = loadConfig();
  const configSubset = {};
  for (const f of CONFIG_FIELDS) {
    if (config[f] !== undefined) configSubset[f] = config[f];
  }

  const pages = listPages().map((p) => {
    const entry = { fullPath: p.full_path, title: p.title, status: p.status };
    const draftSource = getPageSource(p.full_path, 'draft');
    if (draftSource) entry.draftSource = draftSource;
    if (p.status === 'published') {
      const publishedSource = getPageSource(p.full_path, 'published');
      if (publishedSource) entry.publishedSource = publishedSource;
    }
    return entry;
  });

  // The store (v2.53) travels as what it IS — one <bent-store> BenTML
  // document (catalog, shelves, shipping, payment, coupons). Orders are
  // records about people, not site content: they travel in the database
  // .pzn (storage → ייצוא ‎.pzn), never in a package meant to be shared.
  let store = null;
  try {
    const st = require('./store');
    const counts = st.catalog.countProducts();
    if (counts.total || st.isOpen()) store = { format: 'bent-store', source: st.document.exportDocument() };
  } catch (e) { store = null; }

  return {
    format: SITE_PACKAGE_FORMAT,
    version: SITE_PACKAGE_VERSION,
    name: String(name || '').trim().slice(0, 120) || 'האתר שלי',
    exportedAt: new Date().toISOString(),
    config: configSubset,
    theme: loadOverrides(),
    menus: loadMenus(),
    pages,
    ...(store ? { store } : {})
  };
}

/**
 * Validate + apply an uploaded/pasted site package. Never trusts the input
 * shape (same format/version guards as theme packages). Existing pages are
 * NEVER overwritten unless opts.overwrite is explicitly true — a collision
 * is skipped and reported, not silently clobbered.
 * @returns {{ config: object, theme: object, menus: object, pagesCreated: string[], pagesUpdated: string[], pagesSkipped: string[] }}
 */
function importSitePackage(pkg, opts = {}) {
  if (!pkg || typeof pkg !== 'object') throw new Error('קובץ האתר אינו תקין (לא JSON)');
  if (pkg.format !== SITE_PACKAGE_FORMAT) {
    throw new Error('זה לא קובץ אתר של Tapuziel (format שגוי)');
  }
  if (typeof pkg.version !== 'number' || pkg.version > SITE_PACKAGE_VERSION) {
    throw new Error('גרסת קובץ האתר חדשה מדי לגרסת Tapuziel הזו');
  }
  const overwrite = opts.overwrite === true;

  if (pkg.theme && typeof pkg.theme === 'object') saveOverrides(pkg.theme);
  if (pkg.menus && typeof pkg.menus === 'object') saveMenus(pkg.menus);

  if (pkg.config && typeof pkg.config === 'object') {
    const config = loadConfig();
    for (const f of CONFIG_FIELDS) {
      if (pkg.config[f] !== undefined) config[f] = pkg.config[f];
    }
    saveConfig(config);
  }

  const existingPaths = new Set(listPages().map((p) => p.full_path));
  const pagesCreated = [];
  const pagesUpdated = [];
  const pagesSkipped = [];

  for (const entry of (Array.isArray(pkg.pages) ? pkg.pages : [])) {
    if (!entry || !entry.fullPath || !entry.draftSource) continue;
    const exists = existingPaths.has(entry.fullPath);
    if (exists && !overwrite) {
      pagesSkipped.push(entry.fullPath);
      continue;
    }
    try {
      if (!exists) {
        createPage({ title: entry.title || entry.fullPath, slug: entry.fullPath, blocks: [] });
      }
      // publish FIRST (savePageSource's publish:true writes the same source to
      // BOTH draft and published) so a subsequent draft-only write can safely
      // diverge the draft again — the correct order to end up with
      // published=publishedSource AND draft=draftSource (they can differ: a
      // page can have unpublished changes sitting on top of what's live).
      if (entry.status === 'published' && entry.publishedSource) {
        savePageSource(entry.fullPath, entry.publishedSource, { publish: true });
      }
      savePageSource(entry.fullPath, entry.draftSource, { publish: false });
      (exists ? pagesUpdated : pagesCreated).push(entry.fullPath);
    } catch (e) {
      pagesSkipped.push(entry.fullPath + ' (' + e.message + ')');
    }
  }

  // the store's document (v2.53): applied through the store's own door —
  // validated, backed up first — and only ever ADDED to an existing shop
  // (merge) unless the import overwrites, so a package never hides products
  let storeResult = null;
  if (pkg.store && typeof pkg.store === 'object' && typeof pkg.store.source === 'string' && pkg.store.source.trim()) {
    try {
      let source = pkg.store.source;
      if (!overwrite) source = source.replace(/<bent-store\b([^>]*)>/i, (m, attrs) => '<bent-store' + attrs.replace(/\smode="[^"]*"/i, '') + ' mode="merge">');
      const r = require('./store').document.applyDocument(source, { force: true, reason: 'site-package' });
      storeResult = r.ok ? { ok: true, products: (r.changed && r.changed.products) || 0, backupId: r.backupId } : { ok: false, error: r.message || r.code };
    } catch (e) {
      storeResult = { ok: false, error: e.message };
    }
  }

  return {
    config: loadConfig(), theme: loadOverrides(), menus: loadMenus(),
    pagesCreated, pagesUpdated, pagesSkipped,
    ...(storeResult ? { store: storeResult } : {})
  };
}

module.exports = {
  SITE_PACKAGE_FORMAT,
  SITE_PACKAGE_VERSION,
  CONFIG_FIELDS,
  exportSitePackage,
  importSitePackage
};
