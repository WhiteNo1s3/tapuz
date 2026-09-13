'use strict';

/**
 * The Theme Designer as an injection descriptor (v2.28) — the same roleplay
 * pack the studio hands out (src/theme-roleplay.js buildThemePrompt) and the
 * same door the studio's paste walks through (theme.extractThemeReply), now
 * reachable through the generic runner so a connected model can design a
 * theme end to end.
 *
 * apply() lands the theme IN THE LIBRARY (theme-library.saveAiTheme) and
 * nowhere else — never on the live site. Making it live stays a studio
 * click, exactly as the paste door has behaved since v2.21: an AI reply may
 * add a choice to the shelf, it may not redecorate the site by itself.
 *
 * preview: this descriptor cannot register a candidate with routes/theme.js
 * (its PREVIEWS map is private), so it renders the home page with the
 * candidate overrides itself and hands the HTML over as `previewHtml` — the
 * card frames it through an iframe srcdoc (no scripts run in that sandbox,
 * so the effect never executes on the admin page).
 */

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../paths');

const EMPTY_HTML = '<!DOCTYPE html><html lang="he" dir="rtl"><body style="font-family:system-ui;padding:2rem;color:#475569">אין עדיין דף מפורסם להציג — פרסמו דף אחד והתצוגה תתמלא.</body></html>';

// What apply() saved last — undo removes exactly that entry. Kept ON DISK
// next to the ledger (config/inject-theme-last.json, the same root as
// inject-log.jsonl) so a server restart does not turn '↩ בטל החלה אחרונה'
// into NO_BACKUP while the entry is still on the shelf. NEVER inferred from
// "the newest source:ai entry": the studio's paste door saves as 'ai' too,
// and undo must not take a theme the owner pasted by hand off the shelf.
const LAST_PATH = path.join(CONFIG_DIR, 'inject-theme-last.json');

function rememberLast(id) {
  try {
    fs.mkdirSync(path.dirname(LAST_PATH), { recursive: true });
    fs.writeFileSync(LAST_PATH, JSON.stringify({ id: String(id), at: new Date().toISOString() }), 'utf8');
  } catch (e) { /* a full disk must not turn a successful apply into a 500 */ }
}

function readLast() {
  try {
    const d = JSON.parse(fs.readFileSync(LAST_PATH, 'utf8'));
    return d && d.id ? { id: String(d.id), at: String(d.at || '') } : null;
  } catch (e) {
    return null;
  }
}

function forgetLast() {
  try { fs.unlinkSync(LAST_PATH); } catch (e) { /* already gone */ }
}

function themeLib() { return require('../theme'); }

function extract(reply) {
  return themeLib().extractThemeReply(String(reply || ''), 'ai');
}

/** The home page rendered with a candidate theme — the studio canvas's
 *  GET /admin/theme/preview/:id logic, without the registry. */
function renderHome(overrides) {
  const { listPages, getPageByFullPath } = require('../pages');
  const { loadConfig } = require('../config');
  const cfg = loadConfig();
  const published = listPages().filter((p) => p.status === 'published');
  const homePath = require('../seo').resolveHomePath(
    published.map((p) => getPageByFullPath(p.full_path) || p), cfg.homepage
  );
  const page = (homePath && getPageByFullPath(homePath)) ||
    (published[0] && getPageByFullPath(published[0].full_path)) || null;
  if (!page) return EMPTY_HTML;
  return require('../renderer').renderPage(page, { overrides, siteTitle: cfg.title });
}

const descriptor = {
  id: 'theme-designer',
  kind: 'theme-designer',
  family: 'theme',
  title: '🎨 מעצב/ת ערכות הנושא',
  blurb: 'מתארים את האתר שבדמיונכם — אווירה, מותג, צבעים — וה-AI מחזיר ערכת נושא שלמה שנשמרת בספריית הערכות. ההחלה על האתר נשארת לחיצה בסטודיו.',
  // measured: ~18.5K chars from scratch, ~19.7K with the live theme carried
  // (≈ 8.6K tokens at 2.3 chars/token — inside the 20K local window with the
  // 6K-token answer)
  budget: { lite: 20000, full: 22000 },

  buildPrompt({ brief = '', size = 'lite', ctx } = {}) {
    const cfg = (ctx && ctx.config) || require('../config').loadConfig();
    const overrides = (ctx && ctx.overrides) || themeLib().loadOverrides();
    let canvasModules;
    try { canvasModules = require('../theme-canvas').moduleTypes(); } catch (e) { canvasModules = undefined; }
    const pack = require('../theme-roleplay').buildThemePrompt({
      brief,
      siteTitle: cfg.title || '',
      description: cfg.description || '',
      // 'full' = iterate ON the live theme (the pack carries it); 'lite' = design from scratch
      current: size === 'full' ? overrides : null,
      canvasModules
    });
    return { text: pack.text, chars: pack.chars, meta: { size, withCurrent: size === 'full' } };
  },

  parse(reply) {
    const found = extract(reply);
    const t = themeLib();
    const warnings = (found.warnings || []).map((m) => ({ code: 'THEME', message: String(m) }));
    const merged = t.mergeDeep(t.DEFAULT_OVERRIDES, found.overrides);
    let previewHtml = '';
    const notes = Array.isArray(found.parts && found.parts.notes) ? found.parts.notes.slice() : [];
    try { previewHtml = renderHome(merged); } catch (e) { notes.push('PREVIEW_FAILED'); }
    return {
      preview: {
        name: found.name,
        sections: Object.keys(found.overrides),
        specimen: !!found.specimen,
        parts: found.parts,
        previewHtml
      },
      warnings,
      warningTexts: (found.warnings || []).map(String),
      notes,
      // the studio's door has no hard warnings — hygiene fixes are applied, not blocked on
      hard: false,
      plan: { name: found.name, overrides: found.overrides, specimen: found.specimen }
    };
  },

  apply(reply) {
    const found = extract(reply);
    const entry = require('../theme-library').saveAiTheme(found.name, found.overrides, found.specimen);
    rememberLast(entry.id);
    return {
      landed: { type: 'theme-library', id: entry.id, url: '/admin/theme' },
      backupId: null,
      changed: { library: [entry.name], sections: Object.keys(found.overrides) },
      rebuildError: '',
      warnings: (found.warnings || []).map((m) => ({ code: 'THEME', message: String(m) }))
    };
  },

  // undo = take the entry apply() added back off the shelf (the live site
  // was never touched, so there is nothing else to restore). The id comes
  // from inject-theme-last.json, so it survives a restart.
  undo() {
    const last = readLast();
    if (!last) {
      const e = new Error('אין החלה אחרונה לבטל — הערכה האחרונה כבר הוסרה או שלא נשמרה כאן');
      e.code = 'NO_BACKUP';
      throw e;
    }
    const removed = require('../theme-library').removeTheme(last.id);
    const restored = last.id;
    forgetLast();
    if (!removed) {
      const e = new Error('הערכה כבר לא בספרייה');
      e.code = 'NO_BACKUP';
      throw e;
    }
    return { restored };
  },

  run: {
    enabled: true,
    maxTokens: 6000,
    timeoutMs: { local: 600000, cloud: 120000 },
    repairable: []
  },

  ui: {
    briefPlaceholder: 'תארו את האתר שבדמיונכם — אווירה, מותג, קהל, השראות, צבעים שאתם אוהבים.',
    sizes: ['lite', 'full'],
    applyLabel: '💾 שמור בספריית הערכות',
    mount: ['/admin/theme'],
    canApply: true,
    renderPreview(preview) {
      return require('./index').genericPreviewHtml(preview);
    }
  }
};

module.exports = descriptor;
