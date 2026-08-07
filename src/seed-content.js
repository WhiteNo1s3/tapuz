'use strict';

/**
 * Content seed (v2.13) — a deploy archive may carry a `seed/` directory with a
 * content package: .pzn pages plus (optionally) a main menu, theme overrides
 * and site-config patches. On boot the server applies the package ONCE per
 * package id, through the same product APIs the admin and the agent bridge
 * use — createPage / savePageSource / publish / exportAll — so every rule
 * holds: one publish concept, a revision for every save, ghost pages pruned.
 *
 * Safety contract (the root pin's little sibling):
 *  - No `seed/manifest.json` in the app tree → complete no-op.
 *  - A marker in TAPUZ_ROOT/config/seeded.json records applied package ids —
 *    redeploys of the same archive never re-run it.
 *  - An existing page is only overwritten when the manifest says
 *    `"replace": true` for it (a revision of the old content is kept).
 *  - menus.json / theme-overrides.json / site.json are backed up beside
 *    themselves (<name>.pre-<id>.json) before the seed touches them.
 *  - Every failure is logged and skipped; a seed must never take the server
 *    down or block boot.
 */

const fs = require('fs');
const path = require('path');
const { PACKAGE_ROOT, CONFIG_DIR, pinnedRoot } = require('./paths');

// TAPUZ_SEED_DIR override exists for the smoke test (a hermetic package in a
// temp dir); real deploys always ship the package at <app>/seed.
const SEED_DIR = process.env.TAPUZ_SEED_DIR
  ? path.resolve(process.env.TAPUZ_SEED_DIR)
  : path.join(PACKAGE_ROOT, 'seed');
const MARKER_PATH = path.join(CONFIG_DIR, 'seeded.json');

/**
 * When may a seed apply IMPLICITLY? Only in a root-pin deploy — a `.tapuz-root`
 * file exists solely because a deploy recipe injected it into the archive
 * (it is gitignored and never committed), so its presence marks a deliberate
 * deployment, not somebody's dev checkout or a smoke test's temp root.
 * Everything else needs explicit arming with TAPUZ_SEED=1;
 * TAPUZ_SEED=0 is the kill switch that wins over both.
 */
function seedArmed() {
  if (process.env.TAPUZ_SEED === '0') return false;
  if (process.env.TAPUZ_SEED === '1') return true;
  return !!pinnedRoot();
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function backupConfigFile(name, seedId) {
  const src = path.join(CONFIG_DIR, name + '.json');
  if (!fs.existsSync(src)) return;
  const dst = path.join(CONFIG_DIR, `${name}.pre-${seedId}.json`);
  if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
}

function seedPages(manifest) {
  const pages = require('./pages');
  const pzn = require('./pzn/index');
  const { deriveSlug } = require('./pzn/intent');
  const results = { created: 0, replaced: 0, skipped: 0, failed: 0 };

  for (const entry of manifest.pages || []) {
    try {
      const file = path.join(SEED_DIR, entry.file);
      const source = fs.readFileSync(file, 'utf8');
      const doc = pzn.parse(source);
      const errors = pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
      if (errors.length) {
        console.error(`[seed] ${entry.file}: ${errors[0].code}: ${errors[0].message} — skipped`);
        results.failed++;
        continue;
      }
      const slug = deriveSlug((doc.slug || '').trim() || doc.title || '');
      const existing = pages.getPageByFullPath(slug);
      if (existing && !entry.replace) {
        console.log(`[seed] page "${slug}" already exists — left untouched`);
        results.skipped++;
        continue;
      }
      if (!existing) pages.createPage({ title: doc.title || slug, slug, blocks: [] });
      pages.savePageSource(slug, source, { publish: true });
      console.log(`[seed] ${existing ? 'replaced' : 'created'} + published "${slug}"`);
      results[existing ? 'replaced' : 'created']++;
    } catch (e) {
      console.error(`[seed] ${entry.file}: ${e.message} — skipped`);
      results.failed++;
    }
  }
  return results;
}

function seedMenus(manifest, seedId) {
  if (!manifest.menus || typeof manifest.menus !== 'object') return;
  backupConfigFile('menus', seedId);
  const menus = require('./menus');
  for (const [name, items] of Object.entries(manifest.menus)) {
    if (!Array.isArray(items)) continue;
    menus.saveMenu(name, items);
    console.log(`[seed] menu "${name}" set (${items.length} items)`);
  }
}

function seedTheme(manifest, seedId) {
  if (!manifest.theme || typeof manifest.theme !== 'object') return;
  backupConfigFile('theme-overrides', seedId);
  require('./theme').saveOverrides(manifest.theme);
  console.log('[seed] theme overrides applied');
}

function seedSite(manifest, seedId) {
  if (!manifest.site || typeof manifest.site !== 'object') return;
  backupConfigFile('site', seedId);
  const { loadConfig, saveConfig } = require('./config');
  const config = loadConfig();
  const patch = manifest.site;
  // shallow, explicit merge — a seed may retitle the site and crown a
  // homepage, never rewrite integrations/CRM/security settings.
  if (patch.title) config.title = String(patch.title);
  if (patch.description) config.description = String(patch.description);
  if (patch.homepage) config.homepage = String(patch.homepage);
  if (patch.footerText) config.footer = { ...(config.footer || {}), text: String(patch.footerText) };
  saveConfig(config);
  console.log('[seed] site config patched (title/description/homepage/footer)');
}

/**
 * Apply the packaged seed once. Never throws — logs and returns a summary.
 * @returns {{ ran: boolean, reason?: string, results?: object }}
 */
function maybeSeed() {
  try {
    if (!seedArmed()) return { ran: false, reason: 'not armed (no root pin, no TAPUZ_SEED=1)' };
    const manifestPath = path.join(SEED_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { ran: false, reason: 'no seed package' };
    const manifest = readJson(manifestPath, null);
    if (!manifest || !manifest.id) {
      console.error('[seed] seed/manifest.json unreadable or missing "id" — ignored');
      return { ran: false, reason: 'bad manifest' };
    }
    const marker = readJson(MARKER_PATH, {});
    if (marker[manifest.id]) return { ran: false, reason: `package "${manifest.id}" already applied` };

    console.log(`[seed] applying content package "${manifest.id}" …`);
    const results = seedPages(manifest);
    seedMenus(manifest, manifest.id);
    seedTheme(manifest, manifest.id);
    seedSite(manifest, manifest.id);
    try { require('./export').exportAll(); } catch (e) {
      console.error('[seed] static export failed: ' + e.message);
    }

    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    marker[manifest.id] = new Date().toISOString();
    fs.writeFileSync(MARKER_PATH, JSON.stringify(marker, null, 2), 'utf8');
    console.log(`[seed] done — created ${results.created}, replaced ${results.replaced}, skipped ${results.skipped}, failed ${results.failed}`);
    return { ran: true, results };
  } catch (e) {
    console.error('[seed] failed: ' + e.message);
    return { ran: false, reason: e.message };
  }
}

module.exports = { maybeSeed, seedArmed, SEED_DIR, MARKER_PATH };
