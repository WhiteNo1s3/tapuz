'use strict';

/**
 * rebuildSite(why) — the static export after a site-shaping change (v2.28).
 *
 * The live pages ARE the export (express.static on PUBLIC_DIR is mounted
 * before the renderer), so a menu save that does not rebuild changes nothing
 * a visitor can see. This is the same eight lines as routes/theme.js's
 * rebuildSite — duplicated on purpose this release so the menu organizer
 * (src/menu-organizer.js) never has to import a route module; a follow-up
 * swaps the theme route onto this file. Returns the failure message (or '')
 * so a door can SAY the site did not rebuild instead of reporting success
 * over a broken export.
 */
function rebuildSite(why) {
  try {
    require('./export').exportAll();
    return '';
  } catch (err) {
    console.error(`[menus] rebuild after ${why} failed:`, err.message);
    return err.message;
  }
}

module.exports = { rebuildSite };
