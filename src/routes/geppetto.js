'use strict';

/**
 * Geppetto's door (v2.56) — a Canva website or a Figma site, pasted as one
 * address, previewed as a Tapuziel site, landed with one click, undone with
 * another. The engine is src/geppetto/ (docs/bent-geppetto.md).
 *
 *   GET  /admin/geppetto                         the screen
 *   POST /admin/api/geppetto/read                read + breathe → a plan (nothing lands)
 *   GET  /admin/geppetto/preview/:plan/:page     a planned page, framed, in its own theme
 *   GET  /admin/api/geppetto/plan/:plan/source/:page   the page as BenTML (.pzn)
 *   GET  /admin/api/geppetto/plan/:plan/theme.bent     the look as <bent-theme>
 *   POST /admin/api/geppetto/land                the plan made real
 *   GET  /admin/api/geppetto/imports             what landed before
 *   POST /admin/api/geppetto/undo                take one back
 *
 * Every route is requireAdmin: reading makes this server fetch a stranger's
 * site (behind the decompiler's SSRF guard), and landing rewrites the theme,
 * the menu, the home page and the site's name.
 */

const express = require('express');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');
const { requireAdmin } = require('../admin-guard');
const { FixedWindowLimiter } = require('../ratelimit');
const { clientIp } = require('../http-util');

const router = express.Router();
const readLimiter = new FixedWindowLimiter({ windowMs: 10 * 60 * 1000, max: 30 });

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fail(res, e, status) {
  const code = (e && e.code) || 'E_GEPPETTO';
  const known = /^E_(NEED_|NOT_DESIGN|FIGMA_MAKE|EMPTY|JSON|UNKNOWN|AUTH|NOT_FOUND|HTTP|TOO_BIG|REDIRECTS|PUPPET|EMPTY_DESIGN)|^NO_PLAN$|^NOT_FOUND$|^ALREADY$/.test(code);
  res.status(status || (known ? 400 : 500)).json({ ok: false, code, error: (e && e.message) || 'שגיאה' });
}

router.post('/admin/api/geppetto/read', requireAdmin, async (req, res) => {
  const ip = clientIp(req);
  if (!readLimiter.allow('gp:' + ip)) return res.status(429).json({ ok: false, error: 'יותר מדי קריאות — נסו שוב בעוד כמה דקות' });
  try {
    const b = req.body || {};
    const input = {};
    if (typeof b.url === 'string' && b.url.trim()) input.url = b.url.trim().slice(0, 2000);
    if (typeof b.html === 'string' && b.html.trim()) input.html = b.html;
    if (b.json && (typeof b.json === 'string' || typeof b.json === 'object')) input.json = b.json;
    if (typeof b.token === 'string' && b.token.trim()) input.token = b.token.trim().slice(0, 200); // used for this request only
    const gp = require('../geppetto');
    const plan = await gp.swallow(input, { crawl: b.crawl !== false, maxPages: Number(b.maxPages) || undefined });
    res.json({ ok: true, plan: gp.summarize(plan) });
  } catch (e) {
    fail(res, e);
  }
});

router.get('/admin/geppetto/preview/:plan/:page', requireAdmin, (req, res) => {
  try {
    const gp = require('../geppetto');
    const plan = gp.loadPlan(req.params.plan);
    if (!plan) {
      return res.status(404).type('html').send('<!DOCTYPE html><html lang="he" dir="rtl"><body style="font-family:system-ui;padding:2rem;color:#475569">התוכנית פגה — קראו את העיצוב שוב.</body></html>');
    }
    const html = gp.previewHtml(plan, req.params.page);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.type('html').send(html);
  } catch (e) {
    res.status(500).type('html').send('<!DOCTYPE html><html lang="he" dir="rtl"><body style="font-family:system-ui;padding:2rem;color:#b91c1c">שגיאה בתצוגה המקדימה: ' + escapeAdmin(e.message) + '</body></html>');
  }
});

router.get('/admin/api/geppetto/plan/:plan/source/:page', requireAdmin, (req, res) => {
  const plan = require('../geppetto').loadPlan(req.params.plan);
  if (!plan) return res.status(404).json({ ok: false, error: 'התוכנית פגה' });
  const page = plan.pages.find((p) => p.key === req.params.page) || plan.pages[0];
  res.type('text/plain; charset=utf-8').send(page.source);
});

router.get('/admin/api/geppetto/plan/:plan/theme.bent', requireAdmin, (req, res) => {
  const plan = require('../geppetto').loadPlan(req.params.plan);
  if (!plan) return res.status(404).json({ ok: false, error: 'התוכנית פגה' });
  res.setHeader('Content-Disposition', 'attachment; filename="geppetto-theme.bent"');
  res.type('text/plain; charset=utf-8').send(plan.theme.bent);
});

// Landing a big design (hundreds of pictures to copy) can outlast a hosting
// proxy's request timeout: the import would finish while the owner's browser
// showed "network error". So `wait: false` lands in the background and the
// screen polls the job; a smoke (or curl) may still wait for the answer.
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function choicesOf(b) {
  return {
    mode: b.mode === 'drafts' ? 'drafts' : 'live',
    media: b.media !== false,
    theme: b.theme !== false,
    menu: b.menu !== false,
    homepage: b.homepage !== false,
    siteTitle: b.siteTitle !== false
  };
}

router.post('/admin/api/geppetto/land', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const planId = String(b.planId || '');
  const gp = require('../geppetto');
  if (b.wait === false) {
    if (!gp.loadPlan(planId)) return fail(res, Object.assign(new Error('התוכנית פגה או לא נמצאה — קראו את העיצוב שוב'), { code: 'NO_PLAN' }));
    for (const [id, j] of jobs) if (Date.now() - j.at > JOB_TTL_MS) jobs.delete(id);
    if ([...jobs.values()].some((j) => !j.done)) return res.status(409).json({ ok: false, code: 'BUSY', error: 'ייבוא אחר עדיין רץ — חכו שיסתיים' });
    const id = 'job_' + require('crypto').randomBytes(6).toString('hex');
    const job = { at: Date.now(), done: false, result: null, error: null };
    jobs.set(id, job);
    gp.landPlan(planId, choicesOf(b))
      .then((r) => { job.result = r; })
      .catch((e) => { job.error = { code: e.code || 'E_GEPPETTO', error: e.message }; })
      .finally(() => { job.done = true; });
    return res.json({ ok: true, job: id });
  }
  try {
    res.json(await gp.landPlan(planId, choicesOf(b)));
  } catch (e) {
    fail(res, e);
  }
});

router.get('/admin/api/geppetto/job/:id', requireAdmin, (req, res) => {
  const job = jobs.get(String(req.params.id || ''));
  if (!job) return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'המשימה לא נמצאה' });
  if (!job.done) return res.json({ ok: true, done: false, seconds: Math.round((Date.now() - job.at) / 1000) });
  if (job.error) return res.status(400).json(Object.assign({ ok: false, done: true }, job.error));
  res.json(Object.assign({ done: true }, job.result));
});

router.get('/admin/api/geppetto/imports', requireAdmin, (req, res) => {
  const list = require('../geppetto').listImports().map((r) => ({
    id: r.id, at: r.at, source: r.source, format: r.format, origin: r.origin, title: r.title, mode: r.mode,
    pages: r.pagesCreated || [], themeApplied: !!r.themeApplied, menu: !!r.menuBackupId, homepage: !!r.homepageSet,
    undone: !!r.undone, undoneAt: r.undoneAt || ''
  }));
  res.json({ ok: true, imports: list });
});

router.post('/admin/api/geppetto/undo', requireAdmin, (req, res) => {
  try {
    const r = require('../geppetto').undo(String((req.body || {}).importId || ''));
    res.json(Object.assign({ ok: true }, r));
  } catch (e) {
    fail(res, e);
  }
});

router.get('/admin/geppetto', requireAdmin, (req, res) => {
  const html = `
    ${adminNav('import', 'ג׳פטו — אתר מקנבה או מפיגמה, עם חיים')}
    <div class="container page-body" style="max-width:1080px">
      <style>
        .gp-steps { display:grid; gap:18px; }
        .gp-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
        .gp-tabs button[aria-selected="true"] { background: var(--admin-accent); color:#fff; border-color: transparent; }
        .gp-pane[hidden] { display:none; }
        .gp-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
        .gp-row .input { flex:1; min-width:240px; }
        .gp-swatches { display:flex; gap:6px; flex-wrap:wrap; }
        .gp-sw { display:inline-flex; align-items:center; gap:6px; font:600 .78rem ui-monospace,monospace; padding:3px 8px 3px 4px; border:1px solid #e7e5e4; border-radius:999px; background:#fff; }
        .gp-sw i { width:18px; height:18px; border-radius:50%; border:1px solid rgba(0,0,0,.12); display:inline-block; }
        .gp-chips { display:flex; gap:6px; flex-wrap:wrap; }
        .gp-frame { width:100%; height:640px; border:1px solid #e7e5e4; border-radius:12px; background:#fff; }
        .gp-pages { display:grid; gap:8px; }
        .gp-page { display:flex; gap:10px; align-items:center; justify-content:space-between; padding:9px 12px; border:1px solid #e7e5e4; border-radius:10px; background:#fff; }
        .gp-page.is-on { border-color: var(--admin-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--admin-accent) 22%, transparent); }
        .gp-src { max-height:360px; overflow:auto; direction:ltr; text-align:left; font:12px/1.5 ui-monospace,monospace; background:#1c1917; color:#fafaf9; padding:12px; border-radius:10px; white-space:pre-wrap; }
        .gp-note { font-size:.86rem; color:#57534e; margin:2px 0; }
        .gp-busy { display:inline-block; width:14px; height:14px; border:2px solid currentColor; border-inline-end-color:transparent; border-radius:50%; animation: gp-spin .8s linear infinite; vertical-align:-2px; }
        @keyframes gp-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .gp-busy { animation: none; } }
      </style>

      <p class="lead">
        מדביקים כתובת של אתר שפורסם ב<b>קנבה</b> (<code dir="ltr">…my.canva.site</code> או דומיין משלכם) או ב<b>Figma Sites</b>
        (<code dir="ltr">…figma.site</code>) — וג׳פטו קורא את כל האתר, כל הדפים, ובונה ממנו אתר תפוזיאל חי:
        דפים ב‑BenTML עם מודולים אמיתיים, תפריט, ערכת נושא, התמונות אצלכם, אנימציות וקישורים שעובדים.
        שום דבר באתר לא משתנה עד שלוחצים <b>"הכנס חיים"</b>, והכול ניתן לביטול בלחיצה.
      </p>

      <div class="gp-steps">
        <section class="card lead-card" id="gp-step-read">
          <div class="card-head"><span class="ico">🪵</span>1 · מה מייבאים?</div>
          <div class="gp-tabs" role="tablist">
            <button type="button" class="btn secondary" role="tab" aria-selected="true" data-pane="gp-pane-url">קישור לאתר</button>
            <button type="button" class="btn secondary" role="tab" aria-selected="false" data-pane="gp-pane-file">קובץ שמור</button>
            <button type="button" class="btn secondary" role="tab" aria-selected="false" data-pane="gp-pane-figma">קובץ עיצוב של Figma</button>
          </div>
          <div class="gp-pane" id="gp-pane-url">
            <div class="gp-row">
              <input type="url" id="gp-url" class="input" dir="ltr" placeholder="https://your-name.my.canva.site/  ·  https://your-site.figma.site/">
              <button type="button" class="btn" id="gp-read-url">קרא את העיצוב</button>
            </div>
            <p class="faint" style="margin:8px 0 0">ג׳פטו עוקב אחרי הקישורים של העיצוב לדפים האחרים באתר ומביא את כולם (עד 12 דפים).</p>
          </div>
          <div class="gp-pane" id="gp-pane-file" hidden>
            <div class="gp-row">
              <input type="file" id="gp-file" class="input" accept=".html,.htm,.json">
              <input type="url" id="gp-file-url" class="input" dir="ltr" placeholder="הכתובת המקורית (כדי שהתמונות והדפים המקושרים יגיעו)">
              <button type="button" class="btn" id="gp-read-file">קרא את הקובץ</button>
            </div>
            <p class="faint" style="margin:8px 0 0">דף שנשמר מהדפדפן (Ctrl+S) של אתר קנבה או Figma Sites, או קובץ ה‑JSON שהתוסף של תפוזיאל ל‑Figma מייצר.</p>
          </div>
          <div class="gp-pane" id="gp-pane-figma" hidden>
            <div class="gp-row">
              <input type="url" id="gp-figma-url" class="input" dir="ltr" placeholder="https://www.figma.com/design/…">
              <input type="password" id="gp-figma-token" class="input" dir="ltr" autocomplete="off" placeholder="Personal access token">
              <button type="button" class="btn" id="gp-read-figma">קרא את הקובץ</button>
            </div>
            <p class="faint" style="margin:8px 0 0">
              הטוקן משמש לבקשה הזו בלבד ולא נשמר בשום מקום (Figma → Settings → Security → Personal access tokens, הרשאת קריאה לקבצים).
              בלי טוקן: התוסף <b>Tapuziel — send to Geppetto</b> (בתיקיית <code>integrations/figma-plugin</code>) מייצא את העמוד לקובץ שמעלים בלשונית "קובץ שמור".
            </p>
          </div>
          <div id="gp-read-status" class="gp-note" style="margin-top:10px" aria-live="polite"></div>
        </section>

        <section class="card" id="gp-step-see" hidden>
          <div class="card-head"><span class="ico">👀</span>2 · מה ג׳פטו ראה <span class="pill" id="gp-badge" style="margin-inline-start:auto"></span></div>
          <div class="stat-grid" id="gp-stats"></div>
          <div class="grid-2" style="margin-top:14px">
            <div>
              <div class="side-title">התפריט</div>
              <div class="gp-chips" id="gp-menu"></div>
              <div class="side-title" style="margin-top:12px">הצבעים</div>
              <div class="gp-swatches" id="gp-palette"></div>
              <div class="side-title" style="margin-top:12px">הגופנים</div>
              <div id="gp-fonts"></div>
            </div>
            <div>
              <div class="side-title">הדפים</div>
              <div class="gp-pages" id="gp-pages"></div>
              <div class="side-title" style="margin-top:12px">הערות</div>
              <div id="gp-notes"></div>
            </div>
          </div>
          <div style="margin-top:14px">
            <div class="gp-row" style="justify-content:space-between">
              <div class="side-title" style="margin:0">תצוגה מקדימה — כך זה ייראה באתר</div>
              <div class="gp-row" style="gap:6px">
                <button type="button" class="btn secondary" id="gp-show-source">הצג BenTML</button>
                <a class="btn secondary" id="gp-theme-link" href="#" download>ערכת הנושא (.bent)</a>
              </div>
            </div>
            <pre class="gp-src" id="gp-source" hidden></pre>
            <iframe class="gp-frame" id="gp-frame" title="תצוגה מקדימה של האתר המיובא"></iframe>
          </div>
        </section>

        <section class="card" id="gp-step-land" hidden>
          <div class="card-head"><span class="ico">✨</span>3 · הכנסת חיים</div>
          <div class="gp-row" style="gap:16px;margin-bottom:12px">
            <label class="check-row" style="margin:0"><input type="checkbox" id="gp-c-media" checked> התמונות והסרטונים — אצלנו</label>
            <label class="check-row" style="margin:0"><input type="checkbox" id="gp-c-theme" checked> ערכת הנושא של העיצוב</label>
            <label class="check-row" style="margin:0"><input type="checkbox" id="gp-c-menu" checked> התפריט</label>
            <label class="check-row" style="margin:0"><input type="checkbox" id="gp-c-home" checked> דף הבית של האתר</label>
            <label class="check-row" style="margin:0"><input type="checkbox" id="gp-c-title" checked> שם האתר</label>
          </div>
          <div class="gp-row">
            <button type="button" class="btn" id="gp-land-live">✨ הכנס חיים — פרסם את האתר</button>
            <button type="button" class="btn secondary" id="gp-land-drafts">רק כטיוטות (בלי לגעת באתר החי)</button>
          </div>
          <p class="faint" style="margin:8px 0 0">לפני שמשהו מוחלף נשמר גיבוי: ערכת הנושא הנוכחית נשמרת בספרייה, התפריט בגיבויי התפריטים. דף קיים לעולם לא נדרס.</p>
          <div id="gp-land-result" style="margin-top:12px" aria-live="polite"></div>
        </section>

        <section class="card tight">
          <div class="card-head"><span class="ico">🧾</span>ייבואים קודמים</div>
          <div id="gp-imports" class="gp-note">טוען…</div>
        </section>
      </div>
    </div>
    <script src="/admin-geppetto.js" defer></script>
  `;
  res.send(layout(html, 'ג׳פטו', accentFor('import')));
});

module.exports = router;
