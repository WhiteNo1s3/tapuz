'use strict';

/**
 * Theme settings — one cohesive admin page (colors/fonts/layout/logo, the
 * "Looks" gallery, export/import) plus its API, following the same
 * page+API route-group template as site-chrome.js/seo.js. Not gated by
 * requireAdmin: theme editing is already editor-level power, and gating
 * only the export/import form would add no real protection.
 */

const express = require('express');
const { getThemeSettings, saveThemeSettings, LOOKS } = require('../theme');
const { loadConfig } = require('../config');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');

const router = express.Router();

router.get('/admin/api/theme', (req, res) => {
  try {
    res.json({ ok: true, ...getThemeSettings() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme', (req, res) => {
  try {
    const settings = saveThemeSettings(req.body || {});
    res.json({ ok: true, ...settings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── Theme packages (v0.99) — export/import a theme as a portable file,
// the first step toward the ".pzn is our RPM" ecosystem pillar.
router.get('/admin/api/theme/export', (req, res) => {
  try {
    const pkg = require('../theme').exportThemePackage((loadConfig().title || '') + ' — ערכת נושא');
    const filename = 'tapuz-theme-' + new Date().toISOString().slice(0, 10) + '.json';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.type('application/json').send(JSON.stringify(pkg, null, 2));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/import', (req, res) => {
  try {
    const overrides = require('../theme').importThemePackage((req.body || {}).package);
    res.json({ ok: true, overrides });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/admin/theme', (req, res) => {
  const settings = getThemeSettings();
  const o = settings.overrides;
  const logo = settings.logo || {};
  const escAttr = (s) => escapeAdmin(s);
  const colorRow = (k, label, val) => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
      <label style="font-weight:600">${label}</label>
      <input type="color" id="th-color-${k}" value="${escAttr(val)}" style="width:52px;height:36px;border:none;background:none;cursor:pointer">
      <input type="text" id="th-color-${k}-hex" value="${escAttr(val)}" style="width:100px;padding:8px;border:1.5px solid #cbd5e1;border-radius:8px;font-family:monospace">
    </div>`;

  const html = `
    ${adminNav('theme', 'ערכת נושא')}
    <div class="container" style="padding-top:28px;max-width:920px">
      <p style="color:#64748b;margin-top:0">שנה צבעים, פונט, לוגו ופריסת תפריט — בלי לגעת בקוד התמה. נשמר כ-overrides.</p>
      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:20px">
        <h3 style="margin-top:0">מראות מוכנים</h3>
        <p style="color:#64748b;margin:0 0 14px;font-size:.9rem">לחיצה אחת מחליפה את כל האישיות של האתר — צבעים, פינות, צללים וגופנים. אחרי הבחירה הכול נשאר ניתן לכיוון עדין למטה.</p>
        <div id="th-looks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px"></div>
      </section>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">אתר</h3>
          <label style="display:block;font-weight:600;margin-bottom:4px">כותרת האתר</label>
          <input id="th-title" value="${escAttr(settings.siteTitle)}" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
          <label style="display:block;font-weight:600;margin-bottom:4px">תיאור</label>
          <textarea id="th-desc" rows="2" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">${escAttr(settings.description)}</textarea>
          <label style="display:block;font-weight:600;margin-bottom:4px">סוג לוגו</label>
          <select id="th-logo-type" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
            <option value="text" ${logo.type !== 'image' ? 'selected' : ''}>טקסט</option>
            <option value="image" ${logo.type === 'image' ? 'selected' : ''}>תמונה</option>
          </select>
          <label style="display:block;font-weight:600;margin-bottom:4px">טקסט לוגו</label>
          <input id="th-logo-text" value="${escAttr(logo.text)}" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
          <label style="display:block;font-weight:600;margin-bottom:4px">תמונת לוגו</label>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <input id="th-logo-image" value="${escAttr(logo.image)}" placeholder="בחרו מהספרייה ←" style="flex:1;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">
            <button type="button" class="btn secondary" data-media-pick="th-logo-image" style="white-space:nowrap">🖼 בחר / העלה</button>
          </div>
        </section>
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">צבעים</h3>
          ${colorRow('primary', 'ראשי', o.colors.primary)}
          ${colorRow('secondary', 'משלים (גרדיאנט)', o.colors.secondary)}
          ${colorRow('text', 'טקסט', o.colors.text)}
          ${colorRow('muted', 'משני', o.colors.muted)}
          ${colorRow('border', 'מסגרת', o.colors.border)}
          ${colorRow('bg', 'רקע', o.colors.bg)}
          ${colorRow('lightBg', 'רקע בהיר', o.colors.lightBg)}
          ${colorRow('surface', 'משטח (כרטיסים)', o.colors.surface)}
        </section>
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">אופי העיצוב</h3>
          <label style="display:block;font-weight:600;margin-bottom:4px">פינות</label>
          <select id="th-radius" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
            <option value="sharp" ${o.style.radius === 'sharp' ? 'selected' : ''}>חדות (עיתונאי)</option>
            <option value="soft" ${o.style.radius === 'soft' || !o.style.radius ? 'selected' : ''}>רכות</option>
            <option value="round" ${o.style.radius === 'round' ? 'selected' : ''}>עגולות</option>
          </select>
          <label style="display:block;font-weight:600;margin-bottom:4px">צללים</label>
          <select id="th-shadow" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
            <option value="flat" ${o.style.shadow === 'flat' ? 'selected' : ''}>שטוח</option>
            <option value="soft" ${o.style.shadow === 'soft' || !o.style.shadow ? 'selected' : ''}>עדין</option>
            <option value="deep" ${o.style.shadow === 'deep' ? 'selected' : ''}>עמוק</option>
          </select>
          <label style="display:block;font-weight:600;margin-bottom:4px">צבע הדגשה</label>
          <select id="th-accent" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
            <option value="solid" ${o.style.accent !== 'gradient' ? 'selected' : ''}>אחיד</option>
            <option value="gradient" ${o.style.accent === 'gradient' ? 'selected' : ''}>גרדיאנט (ראשי ← משלים)</option>
          </select>
          <label style="display:block;font-weight:600;margin-bottom:4px">גופן כותרות</label>
          <select id="th-font-heading" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">
            <option value="" ${!o.fonts.headingFamily ? 'selected' : ''}>כמו גופן הטקסט</option>
            <option value='Georgia, "Times New Roman", "Noto Serif Hebrew", serif' ${(o.fonts.headingFamily || '').includes('Georgia') ? 'selected' : ''}>סריפית קלאסית</option>
            <option value='"Arial Black", "Segoe UI", Arial, "Noto Sans Hebrew", sans-serif' ${(o.fonts.headingFamily || '').includes('Arial Black') ? 'selected' : ''}>שמנה מודגשת</option>
            <option value='Tahoma, Arial, "Noto Sans Hebrew", sans-serif' ${(o.fonts.headingFamily || '').includes('Tahoma') ? 'selected' : ''}>קומפקטית</option>
          </select>
        </section>
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">טיפוגרפיה ופריסה</h3>
          <label style="display:block;font-weight:600;margin-bottom:4px">גופן</label>
          <input id="th-font" value="${escAttr(o.fonts.family)}" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
          <label style="display:block;font-weight:600;margin-bottom:4px">גודל בסיס</label>
          <input id="th-font-size" value="${escAttr(o.fonts.baseSize)}" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
          <label style="display:block;font-weight:600;margin-bottom:4px">רוחב מקסימלי</label>
          <input id="th-maxw" value="${escAttr(o.layout.maxWidth)}" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
          <label style="display:block;font-weight:600;margin-bottom:4px">מיקום תפריט</label>
          <select id="th-menu-place" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">
            <option value="top" ${o.layout.menuPlacement !== 'side' ? 'selected' : ''}>עליון (אופקי)</option>
            <option value="side" ${o.layout.menuPlacement === 'side' ? 'selected' : ''}>צד (אנכי)</option>
          </select>
        </section>
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">תצוגה מקדימה</h3>
          <div id="th-preview" style="border:1px solid #e2e8f0;border-radius:10px;padding:20px"></div>
        </section>
      </div>
      <div style="margin:24px 0 60px;display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn secondary" id="th-reset">אפס לברירת מחדל</button>
        <button type="button" class="btn" id="th-save">שמור ערכת נושא</button>
        <button type="button" class="btn" id="th-save-build" style="background:#166534">שמור + בנה אתר</button>
      </div>

      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:60px">
        <h3 style="margin-top:0">📦 ייצוא / ייבוא ערכת נושא</h3>
        <p style="color:#64748b;font-size:0.9rem;margin-top:0">קובץ ניתן להעברה — ייצוא שומר את הצבעים/הפונטים/הפריסה הנוכחיים לקובץ, ייבוא מחיל קובץ כזה מאתר Tapuz אחר. שיתוף ערכות נושא, הצעד הראשון.</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
          <a class="btn secondary" href="/admin/api/theme/export" download>⬇ ייצוא ערכת נושא</a>
        </div>
        <label style="display:block;font-weight:600;margin-bottom:4px">ייבוא — הדביקו את תוכן הקובץ (JSON)</label>
        <textarea id="th-import-text" rows="4" dir="ltr" placeholder='{"format":"tapuz-theme", ...}' style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font-family:monospace;font-size:0.82rem"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
          <span id="th-import-status" style="font-size:0.85rem"></span>
          <button type="button" class="btn secondary" id="th-import-apply">החל ערכת נושא מיובאת</button>
        </div>
      </section>
    </div>
    <script>window.TAPUZ_LOOKS = ${JSON.stringify(LOOKS)};</script>
    <script src="/admin-media-picker.js"></script>
    <script src="/admin-theme.js"></script>
  `;
  res.send(layout(html, 'ערכת נושא', accentFor('theme')));
});

module.exports = router;
