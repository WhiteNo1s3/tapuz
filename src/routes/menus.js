'use strict';

/**
 * Menus — extracted to its own route module in v1.07 (docs/ARCHITECTURE.md's
 * plan, sixth route-group extraction, same template as team/integrations/
 * seo/sitemap/site-chrome). Menu entities (name → items, nestable) + the
 * location map (which menu renders in the header vs footer). The editor's
 * client logic lives in the pre-existing external public/admin-menus.js
 * (same pattern as admin-theme.js) — untouched by this move.
 */

const express = require('express');
const menusLib = require('../menus');
const { loadMenus, saveMenus, saveMenu } = menusLib;
const { layout, adminNav, accentFor, jsonForScript } = require('../admin-ui');

const router = express.Router();

router.get('/admin/api/menus', (req, res) => {
  try {
    res.json({ ok: true, menus: loadMenus(), locations: menusLib.getMenuLocations() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/menus', (req, res) => {
  try {
    const menus = saveMenus(req.body?.menus || req.body || {});
    let locations = menusLib.getMenuLocations();
    if (req.body?.locations) locations = menusLib.setMenuLocations(req.body.locations);
    res.json({ ok: true, menus, locations });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/menus/:name/delete', (req, res) => {
  try {
    const menus = menusLib.deleteMenu(req.params.name);
    res.json({ ok: true, menus, locations: menusLib.getMenuLocations() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/menus/:name', (req, res) => {
  try {
    const menus = saveMenu(req.params.name, req.body?.items || []);
    res.json({ ok: true, menus });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/admin/menus', (req, res) => {
  const menus = loadMenus();
  const locations = menusLib.getMenuLocations();
  const html = `
    ${adminNav('menus', 'תפריטים')}
    <style>
      .menus-wrap { display:grid; grid-template-columns: 250px 1fr; gap:20px; align-items:start; }
      @media(max-width:820px){ .menus-wrap { grid-template-columns: 1fr; } }
      /* the two panels use the shared .card surface — see admin.css */
      .menu-chip { display:flex; align-items:center; gap:8px; width:100%; text-align:start; padding:9px 12px;
        border:1px solid var(--accent-line); background:var(--ws-panel); border-radius:9px; margin-bottom:6px;
        cursor:pointer; font:inherit; font-weight:600; color:var(--ws-text-soft);
        transition:border-color var(--dur), background var(--dur), box-shadow var(--dur); }
      .menu-chip:hover { border-color: var(--accent); background: var(--accent-wash); box-shadow: var(--elev-1); }
      .menu-chip.active { border-color: var(--accent); background: var(--accent-wash-2);
        color: var(--accent-ink); box-shadow: var(--elev-1); }
      .menu-chip .chip-count { margin-inline-start:auto; font-size:.7rem; color:var(--ws-muted);
        background:var(--ws-well); border-radius:99px; padding:1px 7px; }
      .menu-chip .chip-loc { font-size:.65rem; color:#166534; background:#dcfce7; border-radius:99px; padding:1px 7px; }
      .loc-row { display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:.9rem; }
      .loc-row label { flex:1; color:var(--ws-text-soft); font-weight:600; }
      .loc-row select { padding:6px 8px; border:1.5px solid var(--ws-border-strong); border-radius:7px;
        font:inherit; background:var(--ws-panel); color:var(--ws-text); }
      .loc-row select:focus { outline:none; border-color:var(--accent);
        box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
      .menu-row.child-row { margin-inline-start:26px; background:var(--ws-well); }
      .editor-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
      .editor-head h3 { margin:0; flex:1; }
      .mini-btn { padding:5px 10px; font-size:.8rem; }
    </style>
    <div class="container page-body" style="max-width:1020px">
      <p class="lead">תפריטים הם ישויות עם שם — צרו כמה שתרצו, קננו תתי־פריטים, ושייכו תפריט לכל מיקום באתר. כמו בוורדפרס, רק בלי הכאב.</p>
      <div class="menus-wrap">
        <aside class="menus-side card">
          <div class="side-title">התפריטים שלי</div>
          <div id="menu-list"></div>
          <button type="button" class="btn secondary" style="width:100%;margin-top:4px" id="menu-create">+ תפריט חדש</button>
          <div class="side-title">מיקומים באתר</div>
          <div class="loc-row"><label>תפריט ראשי (header)</label><select id="loc-main" data-loc="main"></select></div>
          <div class="loc-row"><label>תחתון (footer)</label><select id="loc-footer" data-loc="footer"></select></div>
        </aside>
        <section class="menus-editor card">
          <div class="editor-head">
            <h3 id="editor-title">תפריט</h3>
            <button type="button" class="btn secondary mini-btn" id="menu-rename">שנה שם</button>
            <button type="button" class="btn secondary mini-btn" id="menu-delete">מחק תפריט</button>
          </div>
          <div id="menu-items" class="menu-editor"></div>
          <button type="button" class="btn secondary" style="margin-top:10px" id="menu-add-item">+ פריט</button>
        </section>
      </div>
      <div style="margin:24px 0 0;display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn" id="menu-save">שמור תפריטים</button>
        <button type="button" class="btn publish" id="menu-save-build">שמור + בנה</button>
      </div>
    </div>
    <script>
      window.__TAPUZ_MENUS__ = ${jsonForScript(menus)};
      window.__TAPUZ_MENU_LOCATIONS__ = ${jsonForScript(locations)};
    </script>
    <script src="/admin-menus.js"></script>
  `;
  res.send(layout(html, 'תפריטים', accentFor('menus')));
});

module.exports = router;
