'use strict';

/**
 * Site settings + whole-site package — the eighteenth route-group
 * extraction. The general site-settings page (name, description,
 * homepage, baseUrl, language) and its save API, plus the portable
 * whole-site export/import (the ".pzn is our RPM" pillar, one level up
 * from theme packages) — every route requireAdmin, since import
 * creates/overwrites pages and site config.
 */

const express = require('express');
const { requireAdmin } = require('../admin-guard');
const { loadConfig, saveConfig } = require('../config');
const { listPages, getPageByFullPath } = require('../pages');
const { exportAll } = require('../export');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');

const router = express.Router();

router.get('/admin/settings', requireAdmin, (req, res) => {
  const config = loadConfig();
  const publishedPages = listPages().filter((p) => p.status === 'published');
  const autoHome = require('../seo').pickHomePath(publishedPages);
  const homeOptions = [
    `<option value="" ${!config.homepage ? 'selected' : ''}>אוטומטי — זיהוי חכם${autoHome ? ` (כרגע: /${escapeAdmin(autoHome)})` : ' (כרגע: אין — 404 בשורש!)'}</option>`
  ].concat(publishedPages.map((p) =>
    `<option value="${escapeAdmin(p.full_path)}" ${config.homepage === p.full_path ? 'selected' : ''}>${escapeAdmin(p.title)} — /${escapeAdmin(p.full_path)}</option>`
  )).join('');
  const html = `
    ${adminNav('settings', 'הגדרות אתר')}
    <div class="container page-body" style="max-width:620px">
      <p class="lead">הגדרות כלליות של האתר. לוגו וצבעים נמצאים ב<a href="/admin/theme">ערכת הנושא</a>.</p>
      <section class="card">
        <label class="field-label">שם האתר</label>
        <input id="st-title" value="${escapeAdmin(config.title)}" class="input mb">
        <label class="field-label">תיאור האתר</label>
        <textarea id="st-desc" rows="2" class="input mb">${escapeAdmin(config.description)}</textarea>
        <label class="field-label">🏠 דף הבית</label>
        <select id="st-homepage" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px">
          ${homeOptions}
        </select>
        <div class="faint" style="margin-bottom:14px">הדף שמוגש בשורש האתר (/). אפשר גם מרשימת הדפים — כפתור 🏠 קבע כדף הבית.</div>
        <label class="field-label">כתובת בסיס (baseUrl)</label>
        <input id="st-baseurl" dir="ltr" value="${escapeAdmin(config.baseUrl || '')}" placeholder="https://example.co.il" class="input mb">
        <label class="field-label">שפה ראשית</label>
        <select id="st-lang" class="input mb">
          <option value="he" ${config.language !== 'en' ? 'selected' : ''}>עברית</option>
          <option value="en" ${config.language === 'en' ? 'selected' : ''}>English</option>
        </select>
        <div class="row end">
          <span id="st-status" class="ok-text"></span>
          <button type="button" class="btn" id="st-save">שמור הגדרות</button>
        </div>
      </section>

      <section class="card" style="margin-top:18px">
        <h3 class="sub-head">🔁 אשף ההקמה — סיבוב נוסף</h3>
        <p class="lead">רוצים לרענן את המראה או להשלים דפי בסיס שחסרים? האשף רץ שוב בבטחה:
        דפים קיימים <b>לא נדרסים</b> — מתעדכנים רק שם האתר, התיאור, ערכת הנושא והתפריט הראשי.</p>
        <a class="btn secondary" href="/admin/setup?again=1">🪄 הרץ את האשף שוב</a>
      </section>

      <section class="card" style="margin-top:18px">
        <h3 class="sub-head">📦 ייצוא / ייבוא אתר שלם</h3>
        <p class="lead">קובץ אחד עם כל הדפים (טיוטה + מפורסם), ערכת הנושא והתפריטים — לגיבוי או להעברה בין התקנות Tapuz. ייבוא לעולם לא דורס דף קיים אלא אם מסמנים "דרוס דפים קיימים".</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px">
          <a class="btn secondary" href="/admin/api/site-package/export" download>⬇ ייצוא האתר</a>
        </div>
        <label class="field-label">ייבוא — הדביקו את תוכן הקובץ (JSON)</label>
        <textarea id="sp-import-text" rows="4" dir="ltr" placeholder='{"format":"tapuz-site", ...}' style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font-family:monospace;font-size:0.82rem"></textarea>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:10px">
          <input type="checkbox" id="sp-overwrite"> דרוס דפים קיימים (ברירת מחדל: דילוג על התנגשויות)
        </label>
        <div class="row end">
          <span id="sp-import-status" style="font-size:0.85rem"></span>
          <button type="button" class="btn secondary" id="sp-import-apply">ייבוא</button>
        </div>
      </section>
    </div>
    <script>
      document.getElementById('sp-import-apply').addEventListener('click', function () {
        var status = document.getElementById('sp-import-status');
        var raw = (document.getElementById('sp-import-text') || {}).value || '';
        var pkg;
        try { pkg = JSON.parse(raw); } catch (e) {
          status.textContent = 'לא JSON תקין'; status.style.color = '#b91c1c'; return;
        }
        status.textContent = 'מייבא…'; status.style.color = '#166534';
        fetch('/admin/api/site-package/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ package: pkg, overwrite: document.getElementById('sp-overwrite').checked })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) {
            status.style.color = '#166534';
            status.textContent = 'הושלם ✓ נוצרו ' + d.pagesCreated.length + ', עודכנו ' + d.pagesUpdated.length + ', דולגו ' + d.pagesSkipped.length;
          } else {
            status.style.color = '#b91c1c'; status.textContent = d.error || 'שגיאה';
          }
        }).catch(function () { status.style.color = '#b91c1c'; status.textContent = 'שגיאת רשת'; });
      });
      document.getElementById('st-save').addEventListener('click', function () {
        fetch('/admin/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: document.getElementById('st-title').value,
            description: document.getElementById('st-desc').value,
            homepage: document.getElementById('st-homepage').value,
            baseUrl: document.getElementById('st-baseurl').value,
            language: document.getElementById('st-lang').value
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          document.getElementById('st-status').textContent = d.ok ? 'נשמר ✓' : (d.error || 'שגיאה');
        });
      });
    </script>
  `;
  res.send(layout(html, 'הגדרות אתר', accentFor('settings')));
});

router.post('/admin/api/settings', requireAdmin, (req, res) => {
  try {
    const config = loadConfig();
    const b = req.body || {};
    if (b.title !== undefined) config.title = String(b.title || '').trim() || config.title;
    if (b.description !== undefined) config.description = String(b.description || '');
    if (b.baseUrl !== undefined) config.baseUrl = String(b.baseUrl || '').trim();
    if (b.language !== undefined) config.language = b.language === 'en' ? 'en' : 'he';
    let homeChanged = false;
    if (b.homepage !== undefined) {
      const want = String(b.homepage || '').trim();
      if (want && !getPageByFullPath(want)) throw new Error('דף הבית שנבחר לא נמצא: ' + want);
      homeChanged = want !== (config.homepage || '');
      config.homepage = want;
    }
    saveConfig(config);
    // a homepage change moves index.html — rebuild so '/' is right immediately
    if (homeChanged) exportAll();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── Site packages (v1.06) — export/import a whole site as a portable
// file, the ".pzn is our RPM" pillar one level up from theme packages
// (v0.99). Admin-only: import creates/overwrites pages and site config. ───
router.get('/admin/api/site-package/export', requireAdmin, (req, res) => {
  try {
    const pkg = require('../site-package').exportSitePackage((loadConfig().title || '') + ' — גיבוי אתר');
    const filename = 'tapuz-site-' + new Date().toISOString().slice(0, 10) + '.json';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.type('application/json').send(JSON.stringify(pkg, null, 2));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/site-package/import', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const result = require('../site-package').importSitePackage(b.package, { overwrite: !!b.overwrite });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
