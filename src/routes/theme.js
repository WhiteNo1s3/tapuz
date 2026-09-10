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

/**
 * Rebuild the static site after a theme change. The live pages ARE the export
 * (express.static on PUBLIC_DIR is mounted before the renderer), so a theme
 * save that does not rebuild changes nothing a visitor can see — Ben: "the
 * adjustments are not working in the live site … it just making you feel in
 * control". Every door that changes the live overrides walks through here.
 */
function rebuildSite(why) {
  try {
    require('../export').exportAll();
  } catch (err) {
    console.error(`[theme] rebuild after ${why} failed:`, err.message);
  }
}

router.post('/admin/api/theme', (req, res) => {
  try {
    const settings = saveThemeSettings(req.body || {});
    rebuildSite('theme save');
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
    rebuildSite('theme import');
    res.json({ ok: true, overrides });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── Theme LIBRARY (v2.21) — themes as artifacts, the WordPress attitude.
// Saved override-sets live in config/theme-library.json; applying is the only
// door to the live theme and auto-backs-up unsaved work. An imported/AI-built
// package lands HERE, never directly on the live site.
router.get('/admin/api/theme/library', (req, res) => {
  try {
    res.json({ ok: true, themes: require('../theme-library').listThemes() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/library', (req, res) => {
  try {
    const entry = require('../theme-library').saveCurrentAsTheme((req.body || {}).name);
    res.json({ ok: true, id: entry.id, name: entry.name });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/library/apply', (req, res) => {
  try {
    const result = require('../theme-library').applyTheme((req.body || {}).id);
    // a theme switch must reach the exported site too, not just dynamic serves
    try { require('../export').exportAll(); } catch (err) { console.error('[theme] rebuild after theme apply failed:', err.message); }
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/library/import', (req, res) => {
  try {
    const entry = require('../theme-library').importPackageToLibrary((req.body || {}).package);
    res.json({ ok: true, id: entry.id, name: entry.name });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/library/remove', (req, res) => {
  try {
    const removed = require('../theme-library').removeTheme((req.body || {}).id);
    if (!removed) return res.status(404).json({ ok: false, error: 'ערכת נושא לא נמצאה' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/library/rename', (req, res) => {
  try {
    const b = req.body || {};
    res.json({ ok: true, ...require('../theme-library').renameTheme(b.id, b.name) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── Theme EFFECTS (v2.22) — the FRESH-chat snippet flow. The owner
// describes an effect ("עקבת עכבר כתומה"), copies a generated prompt whose
// FIRST LINE demands a FRESH chat (Ben's requirement: a chat already primed
// with the site-builder game answers in .pzn — the wrong language for an
// effect snippet), pastes the reply back, and the css/js fences become the
// theme's effect — part of overrides, so they ride packages + the library.
router.get('/admin/api/theme/effects-prompt', (req, res) => {
  try {
    const brief = String(req.query.brief || '').trim().slice(0, 500);
    res.type('text/markdown; charset=utf-8').send(buildEffectsPrompt(brief));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/effects/paste', (req, res) => {
  try {
    const reply = String((req.body || {}).reply || '');
    const { css, js } = require('../theme').extractEffectParts(reply);
    if (!css && !js) {
      return res.status(400).json({
        ok: false,
        error: 'לא נמצא fence של css או js בתשובה — ודאו שהעתקתם את כל תשובת ה-AI, ושביקשתם אותה בצ׳אט חדש (FRESH)'
      });
    }
    const themeLib = require('../theme');
    const cur = themeLib.loadOverrides();
    cur.effects = {
      css: css || cur.effects.css,
      js: js || cur.effects.js,
      note: String((req.body || {}).note || cur.effects.note || '').slice(0, 300)
    };
    themeLib.saveOverrides(cur);
    // the static export serves '/' before the dynamic path — an effect that
    // only lives in overrides is invisible until a rebuild (crm.js pattern)
    try { require('../export').exportAll(); } catch (err) { console.error('[theme] rebuild after effect paste failed:', err.message); }
    res.json({ ok: true, cssChars: (css || '').length, jsChars: (js || '').length });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/effects', (req, res) => {
  try {
    const b = req.body || {};
    const themeLib = require('../theme');
    const cur = themeLib.loadOverrides();
    cur.effects = {
      css: String(b.css == null ? cur.effects.css : b.css),
      js: String(b.js == null ? cur.effects.js : b.js),
      note: String(b.note == null ? cur.effects.note : b.note).slice(0, 300)
    };
    const saved = themeLib.saveOverrides(cur);
    try { require('../export').exportAll(); } catch (err) { console.error('[theme] rebuild after effect save failed:', err.message); }
    res.json({ ok: true, effects: saved.effects });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** First fenced block matching one of the language tags, or ''. */
function extractFence(text, langs) {
  for (const lang of langs) {
    const m = String(text).match(new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'i'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}


/** The effect prompt — deliberately NOT the site-builder pack. */
function buildEffectsPrompt(brief) {
  return [
    '# ⚠️ צ׳אט חדש בלבד (FRESH CHAT)',
    '',
    'את הבקשה הזו מדביקים ב**צ׳אט חדש לגמרי** — לא בצ׳אט שבו נבנו דפים עם',
    'תפוזיאל. צ׳אט שכבר למד את שפת ה-`.pzn` יענה במסמך דפים — וזו בקשה אחרת',
    'לגמרי: כאן מבקשים **קטע אפקט** לאתר, לא דף.',
    '',
    '## התפקיד',
    '',
    'את/ה מומחה/ית אפקטים ל-front-end. כתבו אפקט אתר עצמאי לפי התיאור למטה.',
    '',
    '## חוקים קשיחים',
    '',
    '1. **Vanilla בלבד** — בלי ספריות, בלי CDN, בלי `import`, בלי כתובות חיצוניות.',
    '2. ה-JS הוא **IIFE עצמאי** שמחכה בעצמו ל-`DOMContentLoaded`, לא מניח שום דבר על הדף.',
    '3. עדינות: האפקט לא שובר פריסה, לא חוסם קליקים, ומכבד `prefers-reduced-motion`.',
    '4. האתר הוא **RTL עברית** — כיווניות נלקחת בחשבון.',
    '5. בלי `</script>` בתוך מחרוזות.',
    '',
    '## פורמט התשובה — בדיוק כך, בלי מילה מסביב',
    '',
    'fence אחד של `css` (גם אם ריק) ו-fence אחד של `js`. שום טקסט לפני, בין או אחרי:',
    '',
    '```css',
    '/* סגנונות האפקט */',
    '```',
    '',
    '```js',
    '(function () { /* האפקט */ })();',
    '```',
    '',
    '---',
    '',
    '## האפקט המבוקש',
    '',
    brief || 'אפקט עכבר עדין בצבעי האתר (כתום תפוז) — עקבה רכה שנעלמת.'
  ].join('\n');
}

router.get('/admin/api/theme/library/export', (req, res) => {
  try {
    const pkg = require('../theme-library').exportTheme(String(req.query.id || ''));
    const filename = 'tapuz-theme-' + new Date().toISOString().slice(0, 10) + '.json';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.type('application/json').send(JSON.stringify(pkg, null, 2));
  } catch (e) {
    res.status(404).json({ ok: false, error: e.message });
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
    <div class="container page-body" style="max-width:920px">
      <p class="lead">שנה צבעים, פונט, לוגו ופריסת תפריט — בלי לגעת בקוד התמה. נשמר כ-overrides.</p>
      <section class="card">
        <h3 class="sub-head">מראות מוכנים</h3>
        <p style="color:#64748b;margin:0 0 14px;font-size:.9rem">לחיצה אחת מחליפה את כל האישיות של האתר — צבעים, פינות, צללים וגופנים. אחרי הבחירה הכול נשאר ניתן לכיוון עדין למטה.</p>
        <div id="th-looks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px"></div>
      </section>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <section class="card">
          <h3 class="sub-head">אתר</h3>
          <label class="field-label">כותרת האתר</label>
          <input id="th-title" value="${escAttr(settings.siteTitle)}" class="input mb">
          <label class="field-label">תיאור</label>
          <textarea id="th-desc" rows="2" class="input mb">${escAttr(settings.description)}</textarea>
          <label class="field-label">סוג לוגו</label>
          <select id="th-logo-type" class="input mb">
            <option value="text" ${logo.type !== 'image' ? 'selected' : ''}>טקסט</option>
            <option value="image" ${logo.type === 'image' ? 'selected' : ''}>תמונה</option>
          </select>
          <label class="field-label">טקסט לוגו</label>
          <input id="th-logo-text" value="${escAttr(logo.text)}" class="input mb">
          <label class="field-label">תמונת לוגו</label>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <input id="th-logo-image" value="${escAttr(logo.image)}" placeholder="בחרו מהספרייה ←" style="flex:1;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">
            <button type="button" class="btn secondary" data-media-pick="th-logo-image" style="white-space:nowrap">🖼 בחר / העלה</button>
          </div>
        </section>
        <section class="card">
          <h3 class="sub-head">צבעים</h3>
          ${colorRow('primary', 'ראשי', o.colors.primary)}
          ${colorRow('secondary', 'משלים (גרדיאנט)', o.colors.secondary)}
          ${colorRow('text', 'טקסט', o.colors.text)}
          ${colorRow('muted', 'משני', o.colors.muted)}
          ${colorRow('border', 'מסגרת', o.colors.border)}
          ${colorRow('bg', 'רקע', o.colors.bg)}
          ${colorRow('lightBg', 'רקע בהיר', o.colors.lightBg)}
          ${colorRow('surface', 'משטח (כרטיסים)', o.colors.surface)}
        </section>
        <section class="card">
          <h3 class="sub-head">אופי העיצוב</h3>
          <label class="field-label">פינות</label>
          <select id="th-radius" class="input mb">
            <option value="sharp" ${o.style.radius === 'sharp' ? 'selected' : ''}>חדות (עיתונאי)</option>
            <option value="soft" ${o.style.radius === 'soft' || !o.style.radius ? 'selected' : ''}>רכות</option>
            <option value="round" ${o.style.radius === 'round' ? 'selected' : ''}>עגולות</option>
          </select>
          <label class="field-label">צללים</label>
          <select id="th-shadow" class="input mb">
            <option value="flat" ${o.style.shadow === 'flat' ? 'selected' : ''}>שטוח</option>
            <option value="soft" ${o.style.shadow === 'soft' || !o.style.shadow ? 'selected' : ''}>עדין</option>
            <option value="deep" ${o.style.shadow === 'deep' ? 'selected' : ''}>עמוק</option>
          </select>
          <label class="field-label">צבע הדגשה</label>
          <select id="th-accent" class="input mb">
            <option value="solid" ${o.style.accent !== 'gradient' ? 'selected' : ''}>אחיד</option>
            <option value="gradient" ${o.style.accent === 'gradient' ? 'selected' : ''}>גרדיאנט (ראשי ← משלים)</option>
          </select>
          <label class="field-label">גופן כותרות</label>
          <select id="th-font-heading" class="input">
            <option value="" ${!o.fonts.headingFamily ? 'selected' : ''}>כמו גופן הטקסט</option>
            <option value='Georgia, "Times New Roman", "Noto Serif Hebrew", serif' ${(o.fonts.headingFamily || '').includes('Georgia') ? 'selected' : ''}>סריפית קלאסית</option>
            <option value='"Arial Black", "Segoe UI", Arial, "Noto Sans Hebrew", sans-serif' ${(o.fonts.headingFamily || '').includes('Arial Black') ? 'selected' : ''}>שמנה מודגשת</option>
            <option value='Tahoma, Arial, "Noto Sans Hebrew", sans-serif' ${(o.fonts.headingFamily || '').includes('Tahoma') ? 'selected' : ''}>קומפקטית</option>
          </select>
        </section>
        <section class="card">
          <h3 class="sub-head">טיפוגרפיה ופריסה</h3>
          <label class="field-label">גופן</label>
          <input id="th-font" value="${escAttr(o.fonts.family)}" class="input mb">
          <label class="field-label">גודל בסיס</label>
          <input id="th-font-size" value="${escAttr(o.fonts.baseSize)}" class="input mb">
          <label class="field-label">רוחב מקסימלי</label>
          <input id="th-maxw" value="${escAttr(o.layout.maxWidth)}" class="input mb">
          <label class="field-label">מיקום תפריט</label>
          <select id="th-menu-place" class="input">
            <option value="top" ${o.layout.menuPlacement !== 'side' ? 'selected' : ''}>עליון (אופקי)</option>
            <option value="side" ${o.layout.menuPlacement === 'side' ? 'selected' : ''}>צד (אנכי)</option>
          </select>
        </section>
        <section class="card">
          <h3 class="sub-head">🧱 מאסטר — תפריט, כותרת ותחתית</h3>
          <p class="lead" style="margin-top:0">השלד של האתר: איך התפריט מגיב, איך הכותרת העליונה נראית, ומה צבעי התחתית. הכול חלק מערכת הנושא — נוסע עם הספרייה והייצוא.</p>
          <label class="field-label">אפקט ריחוף בתפריט</label>
          <select id="th-ch-hover" class="input mb">
            <option value="color" ${(!o.chrome || o.chrome.menuHover === 'color') ? 'selected' : ''}>צבע בלבד</option>
            <option value="underline" ${o.chrome && o.chrome.menuHover === 'underline' ? 'selected' : ''}>קו תחתון</option>
            <option value="pill" ${o.chrome && o.chrome.menuHover === 'pill' ? 'selected' : ''}>גלולה (רקע מעוגל)</option>
            <option value="glow" ${o.chrome && o.chrome.menuHover === 'glow' ? 'selected' : ''}>זוהר</option>
          </select>
          <label class="field-label">צבע הריחוף (ריק = הצבע הראשי)</label>
          <input id="th-ch-hovercolor" value="${escAttr((o.chrome && o.chrome.menuHoverColor) || '')}" placeholder="#ea580c" dir="ltr" class="input mb">
          <label class="field-label">משקל טקסט התפריט</label>
          <select id="th-ch-weight" class="input mb">
            <option value="normal" ${(!o.chrome || o.chrome.menuWeight !== 'bold') ? 'selected' : ''}>רגיל</option>
            <option value="bold" ${o.chrome && o.chrome.menuWeight === 'bold' ? 'selected' : ''}>מודגש</option>
          </select>
          <label class="check-line mb"><input type="checkbox" id="th-ch-glass" ${o.chrome && o.chrome.headerGlass ? 'checked' : ''}> כותרת "זכוכית" — שקופה ומטושטשת מעל הדף</label>
          <label class="field-label">רקע הכותרת העליונה (ריק = צבע המשטח)</label>
          <input id="th-ch-headerbg" value="${escAttr((o.chrome && o.chrome.headerBg) || '')}" placeholder="#ffffff" dir="ltr" class="input mb">
          <label class="field-label">רקע התחתית (ריק = ברירת מחדל)</label>
          <input id="th-ch-footerbg" value="${escAttr((o.chrome && o.chrome.footerBg) || '')}" placeholder="#1c1917" dir="ltr" class="input mb">
          <label class="field-label">צבע טקסט התחתית (ריק = ברירת מחדל)</label>
          <input id="th-ch-footertext" value="${escAttr((o.chrome && o.chrome.footerText) || '')}" placeholder="#fffbf7" dir="ltr" class="input mb">
        </section>
        <section class="card">
          <h3 class="sub-head">תצוגה מקדימה</h3>
          <div id="th-preview" style="border:1px solid #e2e8f0;border-radius:10px;padding:20px"></div>
        </section>
      </div>
      <div style="margin:24px 0 60px;display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn secondary" id="th-reset">אפס לברירת מחדל</button>
        <button type="button" class="btn" id="th-save">שמור ערכת נושא</button>
        <button type="button" class="btn" id="th-save-build" style="background:#166534">שמור + בנה אתר</button>
      </div>

      <section class="card" style="margin-bottom:24px" id="th-library-card">
        <h3 class="sub-head">🗂 ספריית ערכות הנושא</h3>
        <p class="lead">כמו וורדפרס: הערכה שבניתם — ביד או עם ה-AI — נשמרת <strong>כאחת מהערכות הזמינות</strong>, לא במקום הקודמת. שמרו את המצב הנוכחי בשם, החליפו ערכה בלחיצה — החלפה מגבה אוטומטית עבודה שלא נשמרה.</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
          <input id="th-lib-name" placeholder="שם לערכה הנוכחית (למשל: כתום חגיגי)" style="flex:1;min-width:200px;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px">
          <button type="button" class="btn" id="th-lib-save">💾 שמור את הערכה הנוכחית</button>
        </div>
        <div id="th-lib-list" class="lead" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">טוען…</div>
        <div id="th-lib-status" style="font-size:0.85rem;margin-top:10px"></div>
      </section>

      <section class="card" style="margin-bottom:24px" id="th-effects-card">
        <h3 class="sub-head">✨ אפקטים לאתר (חלק מערכת הנושא)</h3>
        <p class="lead">אפקט עכבר, נצנוץ, רקע חי — מתארים, מעתיקים פרומפט, מדביקים <strong>בצ׳אט חדש (FRESH)</strong>, ומדביקים חזרה את התשובה. האפקט נשמר בערכת הנושא — נוסע עם ייצוא ועם הספרייה.</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
          <input id="th-fx-brief" placeholder="מה האפקט? למשל: עקבת עכבר כתומה שנעלמת" style="flex:1;min-width:220px;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px">
          <button type="button" class="btn" id="th-fx-prompt">🧠 צור פרומפט והעתק</button>
        </div>
        <label class="field-label">תשובת ה-AI (מהצ׳אט החדש) — הדביקו הכול</label>
        <textarea id="th-fx-reply" rows="4" dir="ltr" placeholder="fence של css + fence של js, כמו שהפרומפט ביקש" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font-family:monospace;font-size:0.82rem"></textarea>
        <div class="row end" style="margin-bottom:14px">
          <span id="th-fx-status" style="font-size:0.85rem"></span>
          <button type="button" class="btn secondary" id="th-fx-clear">🗑 נקה אפקט</button>
          <button type="button" class="btn" id="th-fx-apply">קלוט את האפקט</button>
        </div>
        <div id="th-fx-current" style="font-size:0.85rem;color:#64748b"></div>
      </section>

      <section class="card" style="margin-bottom:60px">
        <h3 class="sub-head">📦 ייצוא / ייבוא ערכת נושא</h3>
        <p class="lead">קובץ ניתן להעברה — ייצוא שומר את הצבעים/הפונטים/הפריסה הנוכחיים לקובץ, ייבוא מחיל קובץ כזה מאתר Tapuz אחר. שיתוף ערכות נושא, הצעד הראשון.</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
          <a class="btn secondary" href="/admin/api/theme/export" download>⬇ ייצוא ערכת נושא</a>
        </div>
        <label class="field-label">ייבוא — הדביקו את תוכן הקובץ (JSON)</label>
        <textarea id="th-import-text" rows="4" dir="ltr" placeholder='{"format":"tapuz-theme", ...}' style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font-family:monospace;font-size:0.82rem"></textarea>
        <div class="row end">
          <span id="th-import-status" style="font-size:0.85rem"></span>
          <button type="button" class="btn secondary" id="th-import-library">🗂 שמור לספרייה</button>
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
