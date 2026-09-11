'use strict';

/**
 * Theme settings — one cohesive admin page (colors/fonts/layout/logo, the
 * "Looks" gallery, export/import) plus its API, following the same
 * page+API route-group template as site-chrome.js/seo.js. Not gated by
 * requireAdmin: theme editing is already editor-level power, and gating
 * only the export/import form would add no real protection.
 *
 * v2.24 — the theme STUDIO (Ben: "there ain't no theme builder, only basic
 * themes … I want to create a theme by user imagination with roleplay …
 * in the canvas we have no game … the import does not work … the effect
 * said it's good and didn't work … we want to iterate"):
 *   • the theme-designer roleplay: describe → prompt → FRESH chat → paste
 *     the reply → it lands in the library → canvas → apply (design-prompt,
 *     design/paste)
 *   • the CANVAS: /admin/theme frames the REAL site rendered with a
 *     candidate theme (the form, a look, a library entry, an AI reply)
 *     without saving it, and reports whether the effect ran (preview)
 *   • every paste/import door takes only the theme out of whatever the
 *     chat wrote, and COMPILES the effect JS before saying "נקלט"
 */

const express = require('express');
const crypto = require('crypto');
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
 * Returns the failure message (or '') so a door can SAY the site did not
 * rebuild instead of reporting success over a broken export.
 */
function rebuildSite(why) {
  try {
    require('../export').exportAll();
    return '';
  } catch (err) {
    console.error(`[theme] rebuild after ${why} failed:`, err.message);
    return err.message;
  }
}

router.post('/admin/api/theme', (req, res) => {
  try {
    const b = req.body || {};
    const jsErr = require('../theme').checkEffectJs(b.overrides && b.overrides.effects && b.overrides.effects.js);
    if (jsErr) return res.status(400).json({ ok: false, error: 'ה-JS של האפקט לא מתקמפל: ' + jsErr });
    const settings = saveThemeSettings(b);
    const rebuildError = rebuildSite('theme save');
    res.json({ ok: true, rebuildError, ...settings });
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

// v2.26 — the `.bent` theme document is THE format: what is exported, shared
// and asked of a chat. The JSON package above stays readable and downloadable.
router.get('/admin/api/theme/export.bent', (req, res) => {
  try {
    const bent = require('../theme').exportThemeBent((loadConfig().title || '') + ' — ערכת נושא', { withCanvas: String(req.query.canvas || '1') !== '0' });
    const filename = 'tapuz-theme-' + new Date().toISOString().slice(0, 10) + '.bent';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.type('text/html; charset=utf-8').send(bent);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/api/theme/library/export.bent', (req, res) => {
  try {
    const bent = require('../theme-library').exportThemeBent(String(req.query.id || ''));
    const filename = 'tapuz-theme-' + new Date().toISOString().slice(0, 10) + '.bent';
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.type('text/html; charset=utf-8').send(bent);
  } catch (e) {
    res.status(404).json({ ok: false, error: e.message });
  }
});

/** What an import door received: the package object, or the raw pasted
 *  text (v2.24 — the tolerant path: fences, chat prose, a bare theme JSON). */
function packageFromBody(body) {
  const b = body || {};
  if (typeof b.text === 'string' && b.text.trim()) return require('../theme').parseThemePackage(b.text);
  if (typeof b.package === 'string') return require('../theme').parseThemePackage(b.package);
  return b.package;
}

router.post('/admin/api/theme/import', (req, res) => {
  try {
    const pkg = packageFromBody(req.body);
    const overrides = require('../theme').importThemePackage(pkg);
    let benchCount = null;
    if (pkg && pkg.canvas && (req.body || {}).bench !== false) {
      try { benchCount = require('../theme-canvas').apply('replace-source', pkg.canvas).count; } catch (e) { benchCount = null; }
    }
    const rebuildError = rebuildSite('theme import');
    res.json({ ok: true, rebuildError, overrides, benchCount });
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
    const rebuildError = rebuildSite('theme apply');
    res.json({ ...result, rebuildError });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/library/import', (req, res) => {
  try {
    const entry = require('../theme-library').importPackageToLibrary(packageFromBody(req.body));
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
    const themeLib = require('../theme');
    const { css, js } = themeLib.extractEffectParts(reply);
    if (!css && !js) {
      return res.status(400).json({
        ok: false,
        error: 'לא נמצא fence של css או js בתשובה — ודאו שהעתקתם את כל תשובת ה-AI, ושביקשתם אותה בצ׳אט חדש (FRESH)'
      });
    }
    // v2.24: compile before accepting — "the code received and said it's
    // good and in effect it didn't work" must become a real error here
    const jsErr = themeLib.checkEffectJs(js);
    if (jsErr) return res.status(400).json({ ok: false, error: 'ה-JS של האפקט לא מתקמפל: ' + jsErr + ' — בקשו מהצ׳אט לתקן ולהחזיר את ה-fence מחדש' });
    const cssErr = themeLib.checkCss(css);
    if (cssErr) return res.status(400).json({ ok: false, error: cssErr + ' — בקשו מהצ׳אט לתקן' });
    const cur = themeLib.loadOverrides();
    cur.effects = {
      css: css || cur.effects.css,
      js: js || cur.effects.js,
      note: String((req.body || {}).note || cur.effects.note || '').slice(0, 300)
    };
    themeLib.saveOverrides(cur);
    // the static export serves '/' before the dynamic path — an effect that
    // only lives in overrides is invisible until a rebuild (crm.js pattern)
    const rebuildError = rebuildSite('effect paste');
    res.json({ ok: true, rebuildError, cssChars: (css || '').length, jsChars: (js || '').length });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/effects', (req, res) => {
  try {
    const b = req.body || {};
    const themeLib = require('../theme');
    const jsErr = themeLib.checkEffectJs(b.js);
    if (jsErr) return res.status(400).json({ ok: false, error: 'ה-JS של האפקט לא מתקמפל: ' + jsErr });
    const cur = themeLib.loadOverrides();
    cur.effects = {
      css: String(b.css == null ? cur.effects.css : b.css),
      js: String(b.js == null ? cur.effects.js : b.js),
      note: String(b.note == null ? cur.effects.note : b.note).slice(0, 300)
    };
    const saved = themeLib.saveOverrides(cur);
    const rebuildError = rebuildSite('effect save');
    res.json({ ok: true, rebuildError, effects: saved.effects });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

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
    '6. הקוד חייב להתקמפל כמו שהוא — בלי placeholders, בלי `...`, בלי הערות "השלימו כאן".',
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

// ─── Theme DESIGNER roleplay (v2.24) — a theme from the owner's imagination.
// The prompt (theme-roleplay.js) teaches a FRESH chat the theme language and
// the skeleton; the reply comes back here, only the theme is taken out of it,
// and it lands in the LIBRARY (source 'ai') — the canvas shows it, one click
// applies it. `apply: true` does both in one move for the impatient.
router.get('/admin/api/theme/design-prompt', (req, res) => {
  try {
    const cfg = loadConfig();
    const brief = String(req.query.brief || '').trim().slice(0, 1500);
    const current = String(req.query.current || '') === '1' ? require('../theme').loadOverrides() : null;
    const pack = require('../theme-roleplay').buildThemePrompt({
      brief, current, siteTitle: cfg.title || '', description: cfg.description || '',
      canvasModules: require('../theme-canvas').moduleTypes()
    });
    res.type('text/markdown; charset=utf-8').send(pack.text);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/design/paste', (req, res) => {
  try {
    const b = req.body || {};
    const themeLib = require('../theme');
    const found = themeLib.extractThemeReply(String(b.reply || ''), String(b.name || ''));
    const lib = require('../theme-library');
    const entry = lib.saveAiTheme(found.name, found.overrides, found.specimen);
    // the model's bench (v2.26) — onto the studio's bench when the owner
    // ticked "take the canvas too" (the default when the bench is empty)
    let benchCount = null;
    const wantBench = b.bench === true || b.bench === 'true' || b.bench === 1;
    if (found.specimen && wantBench) {
      try { benchCount = require('../theme-canvas').apply('replace-source', found.specimen).count; }
      catch (e) { return res.status(400).json({ ok: false, error: 'הערכה נקראה, אבל הקנבס שבה לא מתקמפל: ' + e.message }); }
    }
    let applied = false;
    let rebuildError = '';
    let backedUp = false;
    if (b.apply === true || b.apply === 'true' || b.apply === 1) {
      const result = lib.applyTheme(entry.id);
      applied = true;
      backedUp = !!result.backedUp;
      rebuildError = rebuildSite('ai theme apply');
    }
    res.json({ ok: true, id: entry.id, name: entry.name, applied, backedUp, rebuildError, parts: found.parts, benchCount,
      hasSpecimen: !!found.specimen, sections: Object.keys(found.overrides) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── The theme CANVAS bench (v2.25) — "a canvas of nothing … paste modules
// to create the theme, manually or with the AI chatbot roleplay … it is not
// a page, so it needs to be theme-wide." The bench is a block list beside the
// theme (theme-canvas.js); every operation returns the whole new state.
router.get('/admin/api/theme/canvas', (req, res) => {
  try {
    const canvas = require('../theme-canvas');
    const { blocks, source } = canvas.loadCanvas();
    res.json({ ok: true, count: canvas.countModules(blocks), modules: canvas.summarize(blocks), palette: canvas.palette(), source, rowEnums: canvas.ROW_ENUMS, maxCols: canvas.MAX_COLS });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/theme/canvas', (req, res) => {
  try {
    const b = req.body || {};
    const canvas = require('../theme-canvas');
    // rows (v2.25): add-module / append-source may aim at a cell of a row
    const target = b.rowId ? { rowId: String(b.rowId), col: Number(b.col) } : null;
    const arg = b.op === 'move' ? { id: b.id, dir: b.dir }
      : b.op === 'remove' ? b.id
        : b.op === 'set-row' ? { id: b.id, ratio: b.ratio, width: b.width, gap: b.gap, valign: b.valign, collapse: b.collapse, cells: b.cells }
        : b.op === 'add-row' ? { count: b.count, ratio: b.ratio, width: b.width, gap: b.gap, valign: b.valign, collapse: b.collapse }
          : b.op === 'add-module' ? (target ? { type: b.type, rowId: target.rowId, col: target.col } : b.type)
            : (target ? { source: b.source, rowId: target.rowId, col: target.col } : b.source);
    const result = canvas.apply(String(b.op || ''), arg);
    res.json({ ok: true, count: result.count, added: result.added, modules: result.modules, warnings: result.warnings, source: result.source });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── The CANVAS (v2.24) — "in the canvas we have no game". The editor used
// to draw a fake card with the chosen colors; now it frames the REAL site
// rendered with a CANDIDATE theme, saved nowhere. A candidate is registered
// (POST) and rendered by id (GET) — per process, ephemeral, capped.
const PREVIEWS = new Map();
const PREVIEW_CAP = 40;

function registerPreview(overrides, blocks) {
  const id = 'pv_' + crypto.randomBytes(6).toString('hex');
  PREVIEWS.set(id, { overrides, blocks: Array.isArray(blocks) ? blocks : null, at: Date.now() });
  while (PREVIEWS.size > PREVIEW_CAP) PREVIEWS.delete(PREVIEWS.keys().next().value);
  return id;
}

router.post('/admin/api/theme/preview', (req, res) => {
  try {
    const b = req.body || {};
    const themeLib = require('../theme');
    let overrides;
    let name = '';
    let blocks = null;
    const canvasMod = require('../theme-canvas');
    if (b.libraryId) {
      const entry = require('../theme-library').getTheme(String(b.libraryId));
      if (!entry) return res.status(404).json({ ok: false, error: 'ערכת נושא לא נמצאה' });
      overrides = themeLib.mergeDeep(themeLib.DEFAULT_OVERRIDES, entry.overrides);
      name = entry.name;
      if (entry.canvas && b.bench !== false) blocks = canvasMod.sourceToBlocks(entry.canvas);
    } else if (typeof b.reply === 'string' && b.reply.trim()) {
      const found = themeLib.extractThemeReply(b.reply, b.name);
      overrides = themeLib.mergeDeep(themeLib.DEFAULT_OVERRIDES, found.overrides);
      name = found.name;
      // the model's own bench shows in the canvas, saved nowhere
      if (found.specimen && b.bench !== false) blocks = canvasMod.sourceToBlocks(found.specimen);
    } else if (b.overrides && typeof b.overrides === 'object') {
      // the editor form: what a save would produce — the form's sections
      // merged ONTO the live theme (effects and anything else the form
      // does not carry stay exactly as they are live)
      const jsErr = themeLib.checkEffectJs(b.overrides.effects && b.overrides.effects.js);
      if (jsErr) return res.status(400).json({ ok: false, error: 'ה-JS של האפקט לא מתקמפל: ' + jsErr });
      overrides = themeLib.mergeDeep(themeLib.loadOverrides(), b.overrides);
    } else {
      overrides = themeLib.loadOverrides();
    }
    const id = registerPreview(overrides, blocks);
    res.json({ ok: true, id, name, fonts: themeLib.googleFontFamilies(overrides), hasEffect: !!(overrides.effects && String(overrides.effects.js || '').trim()), benchModules: blocks ? canvasMod.countModules(blocks) : null });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/admin/theme/preview/:id', (req, res) => {
  try {
    const themeLib = require('../theme');
    const entry = PREVIEWS.get(String(req.params.id));
    const overrides = entry ? entry.overrides : themeLib.loadOverrides();
    const { listPages, getPageByFullPath } = require('../pages');
    const published = listPages().filter((p) => p.status === 'published');
    const wanted = String(req.query.path || '').trim();
    // the theme canvas (v2.25) — the bench, not a page: rendered inside the
    // theme's chrome like any page, but it lives in config, never in the site
    let page = String(req.query.canvas || '') === '1' ? require('../theme-canvas').canvasPage() : null;
    // a candidate that brought its own bench (an AI reply, a library entry)
    if (page && entry && entry.blocks) page = { ...page, blocks: entry.blocks };
    if (!page && wanted) page = getPageByFullPath(wanted);
    if (!page || page.status !== 'published') {
      page = null;
      const homePath = require('../seo').resolveHomePath(
        published.map((p) => getPageByFullPath(p.full_path) || p), loadConfig().homepage
      );
      page = (homePath && getPageByFullPath(homePath)) || (published[0] && getPageByFullPath(published[0].full_path)) || null;
    }
    if (!page) {
      return res.status(200).type('html').send('<!DOCTYPE html><html lang="he" dir="rtl"><body style="font-family:system-ui;padding:2rem;color:#475569">אין עדיין דף מפורסם להציג — פרסמו דף אחד והקנבס יתמלא.</body></html>');
    }
    const html = require('../renderer').renderPage(page, { overrides, preview: String(req.params.id), siteTitle: loadConfig().title });
    // the admin gate stamps DENY on the whole namespace; this one page exists
    // to be framed by /admin/theme (same origin, session required)
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.type('html').send(html);
  } catch (e) {
    res.status(500).type('html').send('<!DOCTYPE html><html lang="he" dir="rtl"><body style="font-family:system-ui;padding:2rem;color:#b91c1c">שגיאה בתצוגה המקדימה: ' + escapeAdmin(e.message) + '</body></html>');
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
  const opt = (value, label, selected) => `<option value="${escAttr(value)}" ${selected ? 'selected' : ''}>${label}</option>`;
  const ch = o.chrome || {};
  const bgk = (o.background && o.background.kind) || 'solid';
  const buttons = (o.style && o.style.buttons) || 'filled';
  const googleFonts = Array.isArray(o.fonts.google) ? o.fonts.google.join(', ') : String(o.fonts.google || '');
  const pages = (() => {
    try {
      return require('../pages').listPages().filter((p) => p.status === 'published')
        .map((p) => `<option value="${escAttr(p.full_path)}">${escAttr(p.title || p.full_path)}</option>`).join('');
    } catch (e) { return ''; }
  })();

  const html = `
    ${adminNav('theme', 'ערכת נושא')}
    <div class="container page-body" style="max-width:1100px">
      <p class="lead">סטודיו ערכות הנושא: תארו את האתר שבדמיונכם ל-AI, או כוונו ביד — הקנבס מראה את <strong>האתר האמיתי</strong> בערכה לפני שהיא נשמרת. נשמר כ-overrides.</p>

      <section class="card" id="th-design-card" style="border:1.5px solid #c7d2fe;background:linear-gradient(180deg,#f5f3ff,#fff)">
        <h3 class="sub-head">🎨 מעצב/ת ערכות הנושא — מהדמיון שלכם (AI, בלי מפתח)</h3>
        <p class="lead">משחק תפקידים לצ׳אט ה-AI שלכם: מתארים את האתר שבדמיונכם — אווירה, מותג, השראה — מעתיקים פרומפט, מדביקים <strong>בצ׳אט חדש (FRESH)</strong>, ומדביקים כאן את התשובה. הערכה נכנסת לספרייה, הקנבס מראה אותה על האתר האמיתי, ולחיצה אחת מחילה. לא אהבתם? שנו את התיאור וחזרו — ככה מאטרים.</p>
        <label class="field-label">מה האתר שבדמיונכם?</label>
        <textarea id="th-design-brief" rows="3" class="input mb" placeholder="למשל: חנות פרחים וינטג׳ פריזאית — פסטל, סריפים, תחושת נייר ישן, כפתורים במסגרת, תפריט עם קו תחתון עדין, ואפקט של עלי כותרת שנופלים אחרי העכבר"></textarea>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <label class="check-line" style="margin:0"><input type="checkbox" id="th-design-current"> התחילו מהערכה הנוכחית (לשפר אותה, לא מאפס)</label>
          <label class="check-line" style="margin:0" title="ה-AI מחזיר גם קנבס (bent-canvas) — מודולים בשורות שמציגים את הערכה. מסומן = הם מחליפים את הבנץ׳"><input type="checkbox" id="th-design-bench" checked> לקבל גם את הקנבס שה-AI מציע</label>
          <span style="flex:1"></span>
          <button type="button" class="btn" id="th-design-prompt">🧠 צור פרומפט והעתק</button>
        </div>
        <label class="field-label">תשובת ה-AI (מהצ׳אט החדש) — הדביקו הכול, כמו שהיא</label>
        <textarea id="th-design-reply" rows="5" dir="ltr" placeholder="<bent-theme> … </bent-theme> — פטפוט מסביב לא מפריע, אנחנו לוקחים רק את הערכה (גם JSON ישן מתקבל)" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font-family:monospace;font-size:0.82rem"></textarea>
        <div class="row end" style="margin-bottom:4px">
          <span id="th-design-status" style="font-size:0.85rem;flex:1"></span>
          <button type="button" class="btn secondary" id="th-design-preview">👁 הצג בקנבס</button>
          <button type="button" class="btn secondary" id="th-design-save">🗂 שמור לספרייה</button>
          <button type="button" class="btn" id="th-design-apply" style="background:#166534">✅ שמור והחל על האתר</button>
        </div>
      </section>

      <section class="card" id="th-canvas-card">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <h3 class="sub-head" style="margin:0">🖼 הקנבס — האתר שלכם, חי</h3>
          <span id="th-canvas-label" style="font-size:0.85rem;color:#64748b">מציג: הערכה החיה</span>
          <span style="flex:1"></span>
          <select id="th-canvas-page" class="input compact" title="מה להציג בקנבס: הבנץ׳ של הערכה או דף אמיתי מהאתר"><option value="__canvas">🧩 קנבס הערכה (לא דף)</option><option value="">🌐 דף הבית</option>${pages}</select>
          <button type="button" class="btn secondary" id="th-canvas-full" title="מסך מלא">⛶</button>
          <button type="button" class="btn secondary" id="th-canvas-desktop" title="מסך רחב">🖥</button>
          <button type="button" class="btn secondary" id="th-canvas-mobile" title="נייד">📱</button>
          <button type="button" class="btn secondary" id="th-canvas-refresh" title="רענון">↻</button>
          <a class="btn secondary" id="th-canvas-open" href="/admin/theme/preview/live?canvas=1" target="_blank" title="פתיחה בחלון נפרד">⧉</a>
        </div>
        <div id="th-canvas-wrap" style="background:#e2e8f0;border:1px solid #cbd5e1;border-radius:12px;padding:10px;display:flex;justify-content:center">
          <iframe id="th-canvas" title="תצוגה מקדימה של הערכה" src="/admin/theme/preview/live?canvas=1" style="width:100%;max-width:100%;height:640px;border:none;border-radius:8px;background:#fff;transition:width .2s"></iframe>
        </div>
        <div id="th-canvas-status" style="font-size:0.85rem;color:#64748b;margin-top:8px;min-height:1.2em">הקנבס מציג את הערכה החיה. כל שינוי בטופס, לחיצה על מראה, או תשובת AI — מתעדכן כאן לפני השמירה.</div>
        <div id="th-bench" style="margin-top:14px;border-top:1px dashed #cbd5e1;padding-top:12px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
            <strong>🧩 המודולים על הקנבס</strong>
            <span id="th-bench-count" style="font-size:0.85rem;color:#64748b">ריק</span>
            <span style="flex:1"></span>
            <select id="th-bench-type" class="input compact" title="מודול מהארגז — עם תוכן לדוגמה"></select>
            <button type="button" class="btn secondary" id="th-bench-add">➕ הוסף מודול</button>
            <select id="th-bench-cols" class="input compact" title="כמה מודולים זה לצד זה בשורה"><option value="2">2 עמודות</option><option value="3" selected>3 עמודות</option><option value="4">4 עמודות</option><option value="5">5 עמודות</option><option value="6">6 עמודות</option></select>
            <button type="button" class="btn secondary" id="th-bench-row" title="שורה של תאים — מודולים זה לצד זה, כמו באלמנטור">▦ הוסף שורה</button>
            <button type="button" class="btn secondary" id="th-bench-showcase" title="כל המודולים של סיור הארגז, בלחיצה אחת">🎉 מלא בכל המודולים</button>
            <button type="button" class="btn secondary" id="th-bench-clear">🧹 רוקן</button>
            <button type="button" class="btn secondary" id="th-bench-src" title="המקור של הקנבס — מסמך BenTML (config/theme-canvas.bent) — לעריכה ישירה">📝 מקור</button>
          </div>
          <div id="th-bench-list" style="display:flex;flex-wrap:wrap;gap:6px;min-height:28px;margin-bottom:10px"></div>
          <p class="lead" style="margin:0 0 8px;font-size:0.85rem">הקנבס הוא <strong>לא דף</strong> — הוא הספסל שעליו בונים את הערכה: מודולים שרוצים לראות בערכה, מכל מקום. הדביקו BenTML / ‎.pzn מהבונה, מהרולפליי של בונה-הדפים בצ׳אט שלכם, או מכל תשובת AI — אנחנו לוקחים רק את המודולים. הקנבס עצמו הוא מסמך BenTML (‎.bent) לצד הערכה — נשאר כשמחליפים ערכה, ונוסע עם הייצוא.</p>
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
            <input id="th-bench-brief" placeholder="מה לבנות עם הרולפליי? למשל: דף מוצר עם גלריה, מחירון וטופס" style="flex:1;min-width:220px;padding:8px 12px;border:1.5px solid #cbd5e1;border-radius:8px">
            <button type="button" class="btn secondary" id="th-bench-prompt" title="הפרומפט של בונה הדפים (משחק המודולים) — להדבקה בצ׳אט שלכם; את התשובה מדביקים למטה">🧠 פרומפט בונה-דפים</button>
          </div>
          <textarea id="th-bench-source" rows="3" dir="ltr" placeholder="<bent-hero>…</bent-hero> — או כל תשובת צ׳אט שמכילה מודולים" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box;font-family:monospace;font-size:0.82rem;margin-bottom:8px"></textarea>
          <div class="row end">
            <span id="th-bench-status" style="font-size:0.85rem;flex:1"></span>
            <button type="button" class="btn secondary" id="th-bench-replace">♻ החלף את הקנבס</button>
            <button type="button" class="btn" id="th-bench-append">➕ הוסף לקנבס</button>
          </div>
        </div>
        <div id="th-deploy-status" dir="ltr" style="margin-top:6px;font-size:0.75rem;color:#94a3b8;text-align:left;font-family:monospace;word-break:break-all" title="מה רץ כאן ואיפה האתר נשמר — להשוואה מול view-source של האתר החי (meta generator + main.css?v=)">${escAttr(require('../build-info').summaryLine())}</div>
      </section>

      <section class="card">
        <h3 class="sub-head">מראות מוכנים</h3>
        <p style="color:#64748b;margin:0 0 14px;font-size:.9rem">לחיצה אחת מחליפה את כל האישיות של האתר — צבעים, גופנים, רקע, כפתורים, שלד ועור — ומראה אותה בקנבס. אחרי הבחירה הכול נשאר ניתן לכיוון עדין למטה.</p>
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
            ${opt('text', 'טקסט', logo.type !== 'image')}
            ${opt('image', 'תמונה', logo.type === 'image')}
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
            ${opt('sharp', 'חדות (עיתונאי)', o.style.radius === 'sharp')}
            ${opt('soft', 'רכות', o.style.radius === 'soft' || !o.style.radius)}
            ${opt('round', 'עגולות', o.style.radius === 'round')}
          </select>
          <label class="field-label">צללים</label>
          <select id="th-shadow" class="input mb">
            ${opt('flat', 'שטוח', o.style.shadow === 'flat')}
            ${opt('soft', 'עדין', o.style.shadow === 'soft' || !o.style.shadow)}
            ${opt('deep', 'עמוק', o.style.shadow === 'deep')}
          </select>
          <label class="field-label">צבע הדגשה</label>
          <select id="th-accent" class="input mb">
            ${opt('solid', 'אחיד', o.style.accent !== 'gradient')}
            ${opt('gradient', 'גרדיאנט (ראשי ← משלים)', o.style.accent === 'gradient')}
          </select>
          <label class="field-label">סגנון כפתורים</label>
          <select id="th-buttons" class="input mb">
            ${opt('filled', 'מלא', buttons === 'filled')}
            ${opt('outline', 'מסגרת (שקוף בפנים)', buttons === 'outline')}
            ${opt('soft', 'רך (רקע מוחלש)', buttons === 'soft')}
            ${opt('glow', 'הילה (צל צבעוני)', buttons === 'glow')}
          </select>
          <label class="field-label">רקע הדף</label>
          <select id="th-bg-kind" class="input mb">
            ${opt('solid', 'אחיד', bgk === 'solid')}
            ${opt('gradient', 'מעבר צבע (רקע ← רקע בהיר)', bgk === 'gradient')}
            ${opt('glow', 'הילות בצבעי המותג', bgk === 'glow')}
            ${opt('dots', 'נקודות', bgk === 'dots')}
            ${opt('grid', 'רשת', bgk === 'grid')}
            ${opt('lines', 'קווים אלכסוניים', bgk === 'lines')}
          </select>
          <label class="field-label">זווית (למעבר צבע / קווים)</label>
          <input id="th-bg-angle" type="number" min="0" max="360" step="5" value="${escAttr((o.background && o.background.angle) || 160)}" class="input">
        </section>
        <section class="card">
          <h3 class="sub-head">טיפוגרפיה ופריסה</h3>
          <label class="field-label">גופני Google לטעינה (עברית) — מופרדים בפסיק</label>
          <input id="th-font-google" value="${escAttr(googleFonts)}" placeholder="Heebo, Suez One" dir="ltr" class="input mb" list="th-font-shelf">
          <datalist id="th-font-shelf">${Object.keys(require('../theme').GOOGLE_FONTS).map((f) => `<option value="${escAttr(f)}">`).join('')}</datalist>
          <label class="field-label">גופן</label>
          <input id="th-font" value="${escAttr(o.fonts.family)}" dir="ltr" class="input mb">
          <label class="field-label">גופן כותרות</label>
          <input id="th-font-heading" value="${escAttr(o.fonts.headingFamily)}" dir="ltr" placeholder="ריק = כמו גופן הטקסט" class="input mb">
          <label class="field-label">גודל בסיס</label>
          <input id="th-font-size" value="${escAttr(o.fonts.baseSize)}" class="input mb">
          <label class="field-label">רוחב מקסימלי</label>
          <input id="th-maxw" value="${escAttr(o.layout.maxWidth)}" class="input mb">
          <label class="field-label">מיקום תפריט</label>
          <select id="th-menu-place" class="input">
            ${opt('top', 'עליון (אופקי)', o.layout.menuPlacement !== 'side')}
            ${opt('side', 'צד (אנכי)', o.layout.menuPlacement === 'side')}
          </select>
        </section>
        <section class="card">
          <h3 class="sub-head">🧱 מאסטר — תפריט, כותרת ותחתית</h3>
          <p class="lead" style="margin-top:0">השלד של האתר: איך התפריט מגיב, איך הכותרת העליונה נראית, ומה צבעי התחתית. הכול חלק מערכת הנושא — נוסע עם הספרייה והייצוא.</p>
          <label class="field-label">אפקט ריחוף בתפריט</label>
          <select id="th-ch-hover" class="input mb">
            ${opt('color', 'צבע בלבד', !ch.menuHover || ch.menuHover === 'color')}
            ${opt('underline', 'קו תחתון', ch.menuHover === 'underline')}
            ${opt('pill', 'גלולה (רקע מעוגל)', ch.menuHover === 'pill')}
            ${opt('glow', 'זוהר', ch.menuHover === 'glow')}
          </select>
          <label class="field-label">צבע הריחוף (ריק = הצבע הראשי)</label>
          <input id="th-ch-hovercolor" value="${escAttr(ch.menuHoverColor || '')}" placeholder="#ea580c" dir="ltr" class="input mb">
          <label class="field-label">משקל טקסט התפריט</label>
          <select id="th-ch-weight" class="input mb">
            ${opt('normal', 'רגיל', ch.menuWeight !== 'bold')}
            ${opt('bold', 'מודגש', ch.menuWeight === 'bold')}
          </select>
          <label class="check-line mb"><input type="checkbox" id="th-ch-glass" ${ch.headerGlass ? 'checked' : ''}> כותרת "זכוכית" — שקופה ומטושטשת מעל הדף</label>
          <label class="field-label">רקע הכותרת העליונה (ריק = צבע המשטח)</label>
          <input id="th-ch-headerbg" value="${escAttr(ch.headerBg || '')}" placeholder="#ffffff" dir="ltr" class="input mb">
          <label class="field-label">צבע טקסט הכותרת העליונה (ריק = צבע הטקסט)</label>
          <input id="th-ch-headertext" value="${escAttr(ch.headerText || '')}" placeholder="#ffffff" dir="ltr" class="input mb">
          <label class="field-label">רקע התחתית (ריק = ברירת מחדל)</label>
          <input id="th-ch-footerbg" value="${escAttr(ch.footerBg || '')}" placeholder="#1c1917" dir="ltr" class="input mb">
          <label class="field-label">צבע טקסט התחתית (ריק = ברירת מחדל)</label>
          <input id="th-ch-footertext" value="${escAttr(ch.footerText || '')}" placeholder="#fffbf7" dir="ltr" class="input">
        </section>
        <section class="card">
          <h3 class="sub-head">🧵 עור — CSS חופשי על השלד</h3>
          <p class="lead" style="margin-top:0">מה שהופך פלטה לערכה. ה-AI כותב את זה מהתיאור שלכם; אפשר גם ביד. הסלקטורים: <code>.site-header</code> <code>.main-nav a</code> <code>.hero</code> <code>.btn-primary</code> <code>.card</code> <code>.bent-card</code> <code>.site-footer</code> ומשתני <code>--color-*</code>. נכנס אחרי כל הכפתורים למעלה, לפני האפקט.</p>
          <label class="field-label">הערה (מה העור עושה)</label>
          <input id="th-skin-note" value="${escAttr((o.skin && o.skin.note) || '')}" class="input mb" placeholder="למשל: קווים כפולים, כותרות ענק">
          <label class="field-label">CSS</label>
          <textarea id="th-skin-css" rows="10" dir="ltr" placeholder=".hero h1 { font-size: 3.4rem; }" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box;font-family:monospace;font-size:0.82rem">${escAttr((o.skin && o.skin.css) || '')}</textarea>
        </section>
      </div>
      <div style="margin:24px 0 60px;display:flex;gap:10px;justify-content:flex-end;align-items:center">
        <span id="th-save-status" style="font-size:0.85rem;flex:1"></span>
        <button type="button" class="btn secondary" id="th-reset">אפס לברירת מחדל</button>
        <button type="button" class="btn" id="th-save">שמור ערכת נושא</button>
        <button type="button" class="btn" id="th-save-build" style="background:#166534">שמור + בנה אתר</button>
      </div>

      <section class="card" style="margin-bottom:24px" id="th-library-card">
        <h3 class="sub-head">🗂 ספריית ערכות הנושא</h3>
        <p class="lead">כמו וורדפרס: הערכה שבניתם — ביד או עם ה-AI — נשמרת <strong>כאחת מהערכות הזמינות</strong>, לא במקום הקודמת. 👁 מציג בקנבס בלי לשנות כלום; "החל" מחליף — ומגבה אוטומטית עבודה שלא נשמרה.</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
          <input id="th-lib-name" placeholder="שם לערכה הנוכחית (למשל: כתום חגיגי)" style="flex:1;min-width:200px;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px">
          <button type="button" class="btn" id="th-lib-save">💾 שמור את הערכה הנוכחית</button>
        </div>
        <div id="th-lib-list" class="lead" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">טוען…</div>
        <div id="th-lib-status" style="font-size:0.85rem;margin-top:10px"></div>
      </section>

      <section class="card" style="margin-bottom:24px" id="th-effects-card">
        <h3 class="sub-head">✨ אפקטים לאתר (חלק מערכת הנושא)</h3>
        <p class="lead">אפקט עכבר, נצנוץ, רקע חי — מתארים, מעתיקים פרומפט, מדביקים <strong>בצ׳אט חדש (FRESH)</strong>, ומדביקים חזרה את התשובה. הקוד מקומפל לפני שהוא נקלט, והקנבס למעלה מריץ אותו ומדווח אם נפל. האפקט נשמר בערכת הנושא — נוסע עם ייצוא ועם הספרייה.</p>
        <div id="th-fx-motion" style="display:none;background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:0.85rem">🐢 מערכת ההפעלה שלכם מבקשת "להפחית תנועה" — אפקט שמכבד את זה (כמו שהפרומפט דורש) <strong>מוסתר אצלכם</strong>, אבל רץ אצל הגולשים. כדי לראות אותו כאן, כבו זמנית את Reduce Motion בהגדרות הנגישות.</div>
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
        <p class="lead">קובץ ניתן להעברה — ייצוא שומר את הערכה הנוכחית לקובץ; ייבוא מקבל קובץ כזה מאתר Tapuz אחר, או תשובת AI, או JSON גולמי — גם עם פטפוט מסביב. אנחנו לוקחים רק את הערכה.</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
          <a class="btn" href="/admin/api/theme/export.bent" download title="הערכה כמסמך BenTML — כולל הקנבס">⬇ ייצוא ‎.bent</a>
          <a class="btn secondary" href="/admin/api/theme/export" download title="הפורמט הישן (JSON) — עדיין נתמך">JSON</a>
          <label class="btn secondary" style="cursor:pointer">📂 בחרו קובץ ‎.bent / .json <input type="file" id="th-import-file" accept=".bent,.pzn,.html,.json,application/json,.txt,.md" style="display:none"></label>
        </div>
        <label class="field-label">או הדביקו כאן (‎.bent / JSON / תשובת AI)</label>
        <textarea id="th-import-text" rows="4" dir="ltr" placeholder='{"format":"tapuz-theme", ...}' style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box;font-family:monospace;font-size:0.82rem"></textarea>
        <div class="row end">
          <span id="th-import-status" style="font-size:0.85rem"></span>
          <button type="button" class="btn secondary" id="th-import-preview">👁 הצג בקנבס</button>
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
