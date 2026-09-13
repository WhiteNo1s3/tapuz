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
const { layout, adminNav, accentFor, jsonForScript, escapeAdmin } = require('../admin-ui');
const { requireAdmin } = require('../admin-guard');

const router = express.Router();

/** The status + code a door refusal deserves (a bad reply is not a 500). */
function refuse(res, e) {
  return res.status(400).json({ ok: false, error: e.message, code: e.code || '' });
}

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

// ── the organizer's layer (v2.28) — capacity, export, backups, preview ──
// Registered BEFORE the `:name` writers so `restore`/`preview` are never
// mistaken for a menu called "restore".

router.get('/admin/api/menus/fit', (req, res) => {
  try {
    const theme = require('../theme');
    const { loadConfig } = require('../config');
    const fit = menusLib.estimateMenuFit(menusLib.getMenuForLocation('main'), theme.loadOverrides(), loadConfig());
    res.json({ ok: true, fit });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/api/menus/export.bent', (req, res) => {
  try {
    const theme = require('../theme');
    const { serializeMenus } = require('../bentml/menu-dialect');
    const text = serializeMenus({ knobs: theme.menuKnobs(theme.loadOverrides()), menus: loadMenus(), locations: menusLib.getMenuLocations() });
    res.type('text/plain; charset=utf-8').send(text);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/api/menus/backups', (req, res) => {
  try {
    res.json({ ok: true, backups: menusLib.listMenuBackups() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/menus/restore', requireAdmin, (req, res) => {
  try {
    const id = String((req.body || {}).backupId || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'חסר backupId' });
    const out = menusLib.restoreMenuBackup(id);
    const rebuildError = require('../rebuild').rebuildSite('menu restore');
    res.json({ ok: true, menus: out.menus, locations: out.locations, rebuildError });
  } catch (e) {
    res.status(e.code === 'NO_BACKUP' ? 404 : 400).json({ ok: false, error: e.message, code: e.code || '' });
  }
});

// a candidate document → its preview (tree, diff, fit, an iframe url); never writes
router.post('/admin/api/menus/preview', (req, res) => {
  try {
    const org = require('../menu-organizer');
    const b = req.body || {};
    const reply = typeof b.reply === 'string' ? b.reply : '';
    if (!reply.trim()) return res.status(400).json({ ok: false, error: 'חסר מסמך תפריטים (reply)' });
    let r;
    try { r = org.parseMenuReply(reply, org.siteStateForMenus(), { brief: String(b.brief || '') }); } catch (e) { return refuse(res, e); }
    res.json({ ok: true, preview: r.preview, warnings: r.warnings, warningTexts: r.warningTexts, notes: r.notes, hard: r.hard });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// the real header with a CANDIDATE menu set (registered by the organizer's
// preview), framed by /admin/menus — same headers as /admin/theme/preview/:id.
// An unknown id shows the live menus, so the frame is never blank.
router.get('/admin/menus/preview/:id', (req, res) => {
  try {
    const org = require('../menu-organizer');
    const themeLib = require('../theme');
    const { loadConfig } = require('../config');
    const { listPages, getPageByFullPath } = require('../pages');
    const entry = org.getMenuPreview(req.params.id);
    const overrides = (entry && entry.overrides) || themeLib.loadOverrides();
    const config = loadConfig();
    const published = listPages().filter((p) => p.status === 'published');
    const homePath = require('../seo').resolveHomePath(published.map((p) => getPageByFullPath(p.full_path) || p), config.homepage);
    const page = (homePath && getPageByFullPath(homePath)) || (published[0] && getPageByFullPath(published[0].full_path)) || null;
    if (!page) {
      return res.status(200).type('html').send('<!DOCTYPE html><html lang="he" dir="rtl"><body style="font-family:system-ui;padding:2rem;color:#475569">אין עדיין דף מפורסם להציג — פרסמו דף אחד והתצוגה תתמלא.</body></html>');
    }
    const html = require('../renderer').renderPage(page, { overrides, menus: entry ? entry.menus : undefined, siteTitle: config.title, isHome: true });
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.type('html').send(html);
  } catch (e) {
    res.status(500).type('html').send('<!DOCTYPE html><html lang="he" dir="rtl"><body style="font-family:system-ui;padding:2rem;color:#b91c1c">שגיאה בתצוגה המקדימה: ' + escapeAdmin(e.message) + '</body></html>');
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
      .editor-head #menu-fit { flex-basis:100%; margin:0; font-size:.85rem; color:var(--ws-muted); }
      .mini-btn { padding:5px 10px; font-size:.8rem; }
      #organizer { margin-bottom:20px; }
      #menu-restore { padding:8px 10px; border:1.5px solid var(--ws-border-strong); border-radius:7px; font:inherit;
        background:var(--ws-panel); color:var(--ws-text); max-width:320px; }
    </style>
    <div class="container page-body" style="max-width:1020px">
      <p class="lead">תפריטים הם ישויות עם שם — צרו כמה שתרצו, קננו תתי־פריטים, ושייכו תפריט לכל מיקום באתר. כמו בוורדפרס, רק בלי הכאב.</p>
      <!-- the Menu Organizer injection card (v2.28) — mounted by /admin-inject-card.js -->
      <section class="card" id="organizer" data-inject="menu-organizer"></section>
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
            <p id="menu-fit" class="hint"></p>
          </div>
          <div id="menu-items" class="menu-editor"></div>
          <button type="button" class="btn secondary" style="margin-top:10px" id="menu-add-item">+ פריט</button>
        </section>
      </div>
      <div style="margin:24px 0 0;display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap">
        <select id="menu-restore" title="שחזור תפריטים מגיבוי" aria-label="שחזור מגיבוי"><option value="">↩ שחזור</option></select>
        <button type="button" class="btn" id="menu-save">שמור תפריטים</button>
        <button type="button" class="btn publish" id="menu-save-build">שמור + בנה</button>
      </div>
    </div>
    <script>
      window.__TAPUZ_MENUS__ = ${jsonForScript(menus)};
      window.__TAPUZ_MENU_LOCATIONS__ = ${jsonForScript(locations)};
    </script>
    <script src="/admin-menus.js"></script>
    <script src="/admin-inject-card.js"></script>
    <script>
      // the card is optional at runtime: without its script the editor still works
      (function () {
        var el = document.getElementById('organizer');
        if (!el) return;
        if (window.TapuzInjectCard && typeof window.TapuzInjectCard.mount === 'function') {
          window.TapuzInjectCard.mount(el, 'menu-organizer', {
            onApplied: function (r) { if (window.tapuzMenusReload) window.tapuzMenusReload(r); }
          });
        } else {
          el.hidden = true;
        }
      })();
    </script>
  `;
  res.send(layout(html, 'תפריטים', accentFor('menus')));
});

module.exports = router;
