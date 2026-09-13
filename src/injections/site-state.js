'use strict';

/**
 * siteState() — the one read of the site every injection pack works from
 * (v2.28). Built ONCE per request by the runner and handed to buildPrompt,
 * parse and apply alike, so a pack never sees a menu list that changed
 * between the prompt and the apply. Read-only: nothing here writes.
 *
 * Shape (the contract): { pages, config, overrides, menus, locations, media, orphans }
 *   pages     — listPages() rows (full_path, title, status, meta, …)
 *   config    — loadConfig() (title, description, logo, header, homepage, …)
 *   overrides — the live theme overrides (theme.loadOverrides())
 *   menus     — { [name]: Item[] }        locations — { main, footer }
 *   media     — the newest 40 media files (url, alt, name) — advisory
 *   orphans   — published pages no menu links to (buildSitemap().orphans)
 *
 * The menu organizer needs two more fields (fit, homePath); its descriptor
 * upgrades this ctx through C's siteStateForMenus() — see menu-organizer.js.
 */

const MEDIA_CAP = 40;

function safe(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

function siteState() {
  const { listPages } = require('../pages');
  const { loadConfig } = require('../config');
  const theme = require('../theme');
  const menus = require('../menus');
  return {
    pages: listPages(),
    config: loadConfig(),
    overrides: theme.loadOverrides(),
    menus: menus.loadMenus(),
    locations: menus.getMenuLocations(),
    // the media manifest and the orphan list are advisory context: a site
    // whose media table is mid-migration must not block the organizer
    media: safe(() => require('../media').listAllMedia(MEDIA_CAP), []),
    orphans: safe(() => require('../sitemap').buildSitemap().orphans, [])
  };
}

module.exports = { siteState, MEDIA_CAP };
