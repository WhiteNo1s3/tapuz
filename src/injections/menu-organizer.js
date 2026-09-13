'use strict';

/**
 * The Menu Organizer as an injection descriptor (v2.28) — the wiring between
 * the generic runner (src/routes/inject.js) and the organizer module
 * (src/menu-organizer.js: prompt, dialect, validator, preview, apply, undo).
 *
 * The module is required LAZILY, inside each verb, on purpose: the
 * organizer and this registry land in the same release from different
 * hands, and the server must boot — /admin/inject must list the pack, the
 * theme designer must keep working — while the module is still on its way.
 * `ready()` tells the registry the truth, and list() marks the pack
 * run.enabled=false / notReady until the module is there.
 *
 * `ctx`: the runner hands the generic siteState() ({pages, config,
 * overrides, menus, locations, media, orphans}); the organizer wants two more
 * fields (fit, homePath), so a ctx without them is upgraded through the
 * module's own siteStateForMenus() — and a ctx that already carries `fit`
 * (an eval fixture through ctxFromFixture) passes straight through.
 */

function mod() {
  return require('../menu-organizer');
}

function ready() {
  try { mod(); return true; } catch (e) { return false; }
}

function ctxFor(ctx) {
  if (ctx && typeof ctx === 'object' && ctx.fit) return ctx;
  return mod().siteStateForMenus();
}

function notReady() {
  const e = new Error('מסדר/ת התפריטים עדיין לא זמין/ה בשרת הזה — המודול חסר');
  e.code = 'NOT_READY';
  return e;
}

const descriptor = {
  id: 'menu-organizer',
  kind: 'menu-organizer',
  family: 'site',
  title: '🧭 מסדר/ת התפריטים',
  blurb: 'ה-AI מקבל את רשימת הדפים והתפריטים של האתר ומחזיר תפריטים קצרים, מסודרים, שנכנסים בשורה אחת — עם תצוגה מקדימה לפני שמחילים.',
  budget: { lite: 9000, full: 14000 },
  ready,

  buildPrompt({ brief = '', size = 'lite', locale = 'he', variant = 'A', ctx } = {}) {
    if (!ready()) throw notReady();
    return mod().buildMenuPrompt({ brief, size, locale, variant, ctx: ctxFor(ctx) });
  },

  parse(reply, ctx, { brief = '' } = {}) {
    if (!ready()) throw notReady();
    return mod().parseMenuReply(String(reply || ''), ctxFor(ctx), { brief });
  },

  // re-parses the reply: the apply POST carries the same text the owner
  // previewed, and the plan is rebuilt from it rather than trusted from the
  // browser (0.9 — run never applies; apply is its own door)
  apply(reply, ctx, { force = false, brief = '' } = {}) {
    if (!ready()) throw notReady();
    const m = mod();
    const c = ctxFor(ctx);
    const parsed = m.parseMenuReply(String(reply || ''), c, { brief });
    const r = m.applyMenuPlan(parsed.plan, { force: !!force, reason: 'inject:menu-organizer', ctx: c });
    return {
      landed: { type: 'menus', id: 'main', url: '/admin/menus' },
      backupId: r.backupId,
      changed: r.changed,
      rebuildError: r.rebuildError || '',
      warnings: Array.isArray(r.warnings) && r.warnings.length ? r.warnings : parsed.warnings
    };
  },

  undo() {
    if (!ready()) throw notReady();
    return mod().undoLast();
  },

  run: {
    enabled: true,
    maxTokens: 2048,
    timeoutMs: { local: 240000, cloud: 90000 },
    // C's list, read at call time so the registry validates without the module
    get repairable() {
      try { return mod().REPAIRABLE.slice(); } catch (e) { return []; }
    }
  },

  // the organizer's HARD warning codes (block apply unless force) — the
  // runner counts them when choosing between the first and the repaired reply
  hardCodes: ['UNKNOWN_PAGE', 'UNSAFE_URL', 'BAD_TEL'],

  ui: {
    briefPlaceholder: 'למשל: קבצו את השירותים תחת הורה אחד, חייגו בסוף, פרטיות ותנאים בתחתית. ריק = סדרו את התפריט הנוכחי כך שייכנס בשורה.',
    sizes: ['lite', 'full'],
    applyLabel: '✅ החל על התפריטים',
    mount: ['/admin/menus'],
    canApply: true,
    renderPreview(preview) {
      return require('./index').genericPreviewHtml(preview);
    }
  }
};

module.exports = descriptor;
