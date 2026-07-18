const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const {
  createPage, updatePage, publishPage, listPages, getPageByFullPath, deletePage,
  generateFullPath
} = require('./pages');
const { exportAll } = require('./export');
// (needsSetup lives in src/setup.js since v1.30; its server.js callers — the
// setup wizard and the /admin home — both moved to their own route modules,
// so server.js no longer imports it.)
// (runSetup + LOOKS moved with the setup wizard to src/routes/setup-wizard.js in v1.30)
const { loadConfig, saveConfig } = require('./config');
const blockRegistry = require('./block-registry');

const app = express();
const PORT = process.env.PORT || 3000;

const { PUBLIC_DIR, ASSETS_DIR } = require('./paths');
const auth = require('./auth');
// The admin UI shell (v0.96 — extracted out of this file; see docs/ARCHITECTURE.md)
const { layout, adminNav, accentFor, escapeAdmin, ADMIN_NAV_GROUPS } = require('./admin-ui');
const { FixedWindowLimiter } = require('./ratelimit');
const analytics = require('./analytics');

// Abuse mitigation (S4). App-level (L7) only — see docs/security.md.
// adminLimiter now lives in ./admin-gate (v1.11), alongside the gate logic
// it exclusively serves.
// loginGuard moved to src/routes/auth-screens.js in v1.29 (with the auth routes).
// agentLimiter moved to src/routes/agent-bridge.js in v1.33 (with the agent routes).
// (agent-tokens is required by its own route modules — routes/agent-tokens.js
// and routes/agent-bridge.js (v1.33) — not by server.js directly anymore.)
// S6 collector flood cap: coarse per-IP bucket. Beacon endpoint is public and
// unauthenticated, so it gets its own tight limit. TAPUZ_COLLECT_MAX overrides
// the per-minute cap (used by the smoke test to force a 429 deterministically).
const collectLimiter = new FixedWindowLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.TAPUZ_COLLECT_MAX, 10) || 120
});
// v0.81 forms inbox: public capture endpoint — humans submit a contact form
// a few times a minute at most. TAPUZ_FORM_MAX overrides (smoke determinism).
// formLimiter moved to src/routes/form-capture.js in v1.28 (with its routes).
// Client IP for rate-limiting / lockout keys, JSON-vs-HTML content negotiation,
// and the state-changing-method check — moved to ./http-util (v0.97, continuing
// the docs/ARCHITECTURE.md extraction plan) so route modules can require them
// without reaching back into this file. See that module for the X-Forwarded-For
// trust rationale (red-team finding, 2026).
const { clientIp, wantsJson, isStateChanging } = require('./http-util');

// --- S2: configurable admin base path ------------------------------------
// Internally EVERY admin route is '/admin/...'. This top-of-stack rewrite maps
// the user-configured base (config.admin.path / TAPUZ_ADMIN_PATH) onto the
// internal '/admin', so the whole admin app is reachable at the custom path
// without touching the ~50 route strings. When a custom base is set, the
// default '/admin' path is HIDDEN from unauthenticated callers (returns 404),
// so scanners can't find the login screen — obscurity ON TOP of real auth.
app.use((req, res, next) => {
  const base = auth.getAdminBase();
  if (base === '/admin') return next();

  if (req.url === base || req.url.startsWith(base + '/') || req.url.startsWith(base + '?')) {
    req.url = '/admin' + req.url.slice(base.length); // custom -> internal
    req._viaAdminBase = true;
    return next();
  }
  if (req.path === '/admin' || req.path.startsWith('/admin/')) {
    // Literal default path while a custom base is active. Hide it from anyone
    // without a valid session; authenticated same-session XHRs keep working so
    // an already-loaded admin page is not broken.
    if (!auth.verifySession(req)) return res.status(404).send('Not found');
  }
  next();
});

// =========================================================================
// S6: first-party analytics collector — POST /_tapuz/collect
// Registered BEFORE the global 12mb JSON parser so it enforces its OWN tight
// 2kb limit (an unauthenticated public endpoint must never buffer megabytes).
// express.static below is GET-only, so this POST route can't collide with a
// served file. Privacy: the IP + User-Agent are derived HERE, server-side, and
// only a salted hash is ever stored — the client beacon never sends an IP.
// =========================================================================
app.post('/_tapuz/collect', express.json({ limit: '2kb', type: ['application/json', 'text/plain'] }), (req, res) => {
  try {
    // Respect Do-Not-Track / Global Privacy Control — record nothing.
    if (req.headers['dnt'] === '1' || req.headers['sec-gpc'] === '1') return res.status(204).end();

    const ua = req.headers['user-agent'] || '';
    if (analytics.isBot(ua)) return res.status(204).end(); // keep crawlers out of human stats

    const ip = clientIp(req);
    if (!collectLimiter.allow('collect:' + ip)) {
      res.setHeader('Retry-After', String(collectLimiter.retryAfter('collect:' + ip)));
      return res.status(429).end();
    }

    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    let p = typeof b.path === 'string' ? b.path : '';
    if (!p || p[0] !== '/') return res.status(204).end(); // ignore garbage / cross-site paths
    if (p.length > 512) p = p.slice(0, 512);

    // Never track the admin surface (default OR custom base). Defense in depth:
    // admin pages don't emit the beacon, but a forged POST must not slip in.
    const base = auth.getAdminBase();
    if (p === '/admin' || p.startsWith('/admin/') || p === base || p.startsWith(base + '/')) {
      return res.status(204).end();
    }

    const ref = typeof b.ref === 'string' ? b.ref.slice(0, 1024) : '';
    analytics.recordPageview({ path: p, referrer: ref, ip, userAgent: ua });
  } catch (e) {
    // Never surface collector errors to anonymous callers.
  }
  return res.status(204).end();
});

// Swallow body-parser errors (malformed JSON, oversized 2kb body) for the
// collector so a bad/hostile beacon gets a quiet 204 instead of a 400 + stack
// trace. Scoped strictly to the collector path.
app.use((err, req, res, next) => {
  if (req.path === '/_tapuz/collect') return res.status(204).end();
  return next(err);
});

app.use(bodyParser.urlencoded({ extended: true, limit: '256kb' }));

// Public form capture (POST /api/form + GET /form-sent) — extracted to
// src/routes/form-capture.js in v1.28 (twenty-second route-group extraction).
// MOUNTED HERE: after the urlencoded body-parser above (so the POST body is
// parsed) and before the static mounts. Order is load-bearing.
app.use(require('./routes/form-capture'));

// Agent bridge payloads (intent / .pzn source) are small — cap them tight,
// BEFORE the 12mb global parser (which then skips an already-parsed body).
app.use('/agent', bodyParser.json({ limit: '512kb' }));
app.use(bodyParser.json({ limit: '12mb' })); // 12mb: base64 media uploads. Admin-only, behind auth + rate limit.

// CSP + security headers for the PUBLIC site — authored content renders here,
// so this is defense-in-depth over the source-level escaping. Admin/agent keep
// their own headers; assets (extension .css/.js/img) are untouched.
app.use((req, res, next) => {
  const p = req.path;
  // boundary-aware exclusion — '/admin-guide.html' is a PUBLIC page and must
  // still get the CSP; only the real admin/agent namespaces are exempt.
  const exempt = p === '/admin' || p.startsWith('/admin/') ||
    p === '/agent' || p.startsWith('/agent/') || p.startsWith('/_tapuz');
  if (exempt) return next();
  const isPage = req.method === 'GET' && (p === '/' || p.endsWith('.html') || !path.extname(p));
  if (isPage) {
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      // 'unsafe-inline' scripts: the first-party analytics beacon + optional
      // gtag init are inline and must survive static export. Authored content
      // cannot inject <script> (raw HTML in body is forbidden; values escaped),
      // so residual risk is low; hashing these is a tracked follow-up.
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "frame-src 'self' https://www.youtube.com https://www.google.com",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'"
    ].join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
  next();
});

// Security headers applied AT SERVE TIME (setHeaders runs for the file actually
// sent — so it can't be shadowed by mount order, the bug that made the earlier
// /assets middleware dead code). This is the LOAD-BEARING SVG protection: an
// uploaded SVG that slips past sanitization still cannot run script, because it
// is served under `sandbox` CSP AND `Content-Disposition: attachment` (forces
// download on direct navigation; still usable as <img src>, which never scripts).
function staticSecurityHeaders(res, filePath) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (/\.svg$/i.test(filePath)) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', 'attachment');
  }
}

// Public SEO files (sitemap.xml + robots.txt) — extracted to
// src/routes/seo-files.js in v1.27 (twenty-first route-group extraction).
// MOUNTED HERE, before the express.static mounts below, exactly where the
// inline routes were: a static file must never shadow these. Order is
// load-bearing — only the code moved, never the registration point.
app.use(require('./routes/seo-files'));

// extensions:['html'] — the page's natural address is /שם-הדף (no suffix);
// without this every slug URL 404'd and only /שם-הדף.html answered (v0.69)
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], setHeaders: staticSecurityHeaders }));

// Admin client scripts always ship with the package (site public/ may be elsewhere)
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false, extensions: ['html'], setHeaders: staticSecurityHeaders }));

// Assets
const uploadDir = ASSETS_DIR;
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/assets', express.static(uploadDir, { setHeaders: staticSecurityHeaders }));

// =========================================================================
// S1 AUTH GUARD + S4 RATE LIMITING — the SINGLE place that gates the admin.
// Inserted after the static middlewares (so root-served admin client JS and
// public files are untouched) and BEFORE every '/admin/*' route below.
// Everything under the admin base flows through here exactly once.
// =========================================================================
// v1.11: the gate's LOGIC moved to ./admin-gate — registered here at the
// exact same point in the middleware chain (ordering relative to the
// static mounts above and every /admin/* route below is load-bearing;
// only the code moved, never the wiring).
app.use(require('./admin-gate').adminGate);

// requireAdmin (the gate for SMTP/AI/agent-token credentials, team management,
// site settings) now lives in ./admin-guard — imported below with the other
// early requires — so route modules can use it without reaching into server.js.
const { requireAdmin } = require('./admin-guard');

// =========================================================================
// AGENT BRIDGE (v0.45) — /agent/v1/* — bearer-token API for external agents
// (the Grokin browser extension). Deliberately OUTSIDE /admin: token auth,
// NOT session cookies. A browser never auto-sends a bearer token, so there is
// no CSRF risk — which is exactly why CORS can use Allow-Origin:* WITHOUT
// credentials: a hostile page may call the endpoint but cannot supply a valid
// token, and no cookie rides along. See docs/security.md.
// =========================================================================
// The .pzn standard is PUBLIC (unauthenticated) — anyone may implement it.
// Served live from the registry so it can never drift. CORS-open, read-only.
// (Kept here, NOT in the agent bridge: it is not bearer-scoped.)
app.get('/pzn-schema.json', (req, res) => {
  const { buildCatalog } = require('./pzn/spec');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(buildCatalog(require('../package.json').version));
});

// Agent bridge — the public /agent/v1 API (bearer-token read/write), its
// CORS/preflight middleware, the agentLimiter, and the requireAgent guard —
// extracted to src/routes/agent-bridge.js in v1.33 (twenty-seventh
// route-group extraction). The /agent JSON body-parser above still runs first.
app.use(require('./routes/agent-bridge'));

// Auth screens (login / logout / first-admin create-account) + the
// brute-force loginGuard + the authCard/authErr/authInput helpers —
// extracted to src/routes/auth-screens.js in v1.29 (twenty-third
// route-group extraction). Mounted after the admin gate, which path-
// exempts /admin/login and /admin/create-account; logout stays gated.
app.use(require('./routes/auth-screens'));

// Team & roles (v0.95) — extracted to src/routes/team.js in v0.97 (the
// docs/ARCHITECTURE.md plan's first route-group extraction).
app.use(require('./routes/team'));

// Media library \u2014 extracted to src/routes/media.js in v1.10 (ninth
// route-group extraction, the last named same-shaped candidate). The
// commented-out, already-dead /admin/upload-legacy block ("unused after
// v0.31" per its own comment) was dropped rather than relocated.
app.use(require('./routes/media'));

// ======================== ROUTES ========================
// (layout / adminNav / accentFor / escapeAdmin / ADMIN_NAV_GROUPS now live in
// ./admin-ui — imported above. This was the first extraction out of this
// file; see docs/ARCHITECTURE.md for the pattern.)

// First-run setup wizard (GET /admin/setup + POST /admin/setup) —
// extracted to src/routes/setup-wizard.js in v1.30 (twenty-fourth
// route-group extraction).
app.use(require('./routes/setup-wizard'));

// Admin home (GET /admin — the pages-list landing + homepage-status
// banner) — extracted to src/routes/admin-home.js in v1.32
// (twenty-sixth route-group extraction).
app.use(require('./routes/admin-home'));

// homepage crowning (POST /admin/homepage + /admin/api/homepage, with the
// setHomepage helper) — extracted to src/routes/homepage.js in v1.25
// (twentieth route-group extraction).
app.use(require('./routes/homepage'));

// forms inbox + lead pipeline (CRM) — the inbox page, CSV export, and all
// lead mutations (status/notes/value/follow-up) — extracted to
// src/routes/inbox.js in v1.22 (seventeenth route-group extraction).
app.use(require('./routes/inbox'));

// ---- Block registry API (ask C: schema-generated builder UI) ----
app.get('/admin/api/registry', (req, res) => {
  try {
    res.json({
      ok: true,
      blocks: blockRegistry.BLOCK_REGISTRY,
      categories: blockRegistry.BLOCK_CATEGORIES,
      universalParams: blockRegistry.UNIVERSAL_PARAMS
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// admin dashboard (landing hub) + /admin/build-redirect shortcut —
// extracted to src/routes/dashboard.js in v1.24 (nineteenth route-group
// extraction).
app.use(require('./routes/dashboard'));

// ======================== MEDIA LIBRARY (standalone screen) ========================
// ======================== STORAGE (your files on disk) ========================
// The file-first selling point made visible: the user's real files on disk.
// Storage — extracted to src/routes/storage.js in v1.09 (seventh
// route-group extraction, same template as team/integrations/seo/etc.).
app.use(require('./routes/storage'));

// ======================== CATEGORIES (v0.64 — the taxonomy, on file storage) ==
// A category = a first-class tag with metadata. The list lives on disk in
// content/categories.json (visible in the Storage section); membership rides
// on each page's portable tags. The screen edits the list as one document
// (like the menus editor) and POSTs the whole array.
// symbols API (/admin/api/symbols*) — the saved-reusable-block library
// behind the builder's 💠 panel — extracted to src/routes/symbols.js in
// v1.20 (fifteenth route-group extraction).
app.use(require('./routes/symbols'));

// Categories — extracted to src/routes/categories.js in v1.09 (eighth
// route-group extraction).
app.use(require('./routes/categories'));

// site settings page + save API, and whole-site package export/import
// (the ".pzn is our RPM" pillar) — extracted to src/routes/settings.js in
// v1.23 (eighteenth route-group extraction). All requireAdmin.
app.use(require('./routes/settings'));

// ======================== SEO SETTINGS ========================
// SEO defaults — extracted to src/routes/seo.js in v1.02 (third standalone
// admin-page extraction, following the team.js/integrations.js template).
app.use(require('./routes/seo'));

// ======================== INTEGRATIONS ========================
// Integrations (v0.94/v0.98) — extracted to src/routes/integrations.js in
// v1.01 (the docs/ARCHITECTURE.md plan's third route-group extraction).
app.use(require('./routes/integrations'));

// S6: first-party analytics dashboard + CSV export — extracted to
// src/routes/analytics.js in v1.16 (eleventh route-group extraction). The
// pageview COLLECTION endpoint (/_tapuz/collect, above) stays here —
// different concern, different risk.
app.use(require('./routes/analytics'));

// =========================================================================
// S3: CMS-managed static header + footer chrome — settings screen.
// Edits config.header / config.footer, which renderPage wraps around EVERY
// public page (serve + static export). Follows the integrations screen pattern
// (GET page + GET/POST /admin/api/site-chrome), Hebrew/RTL, behind the auth
// guard like every other /admin route.
// =========================================================================
// Header & footer (site chrome) — extracted to src/routes/site-chrome.js in
// v1.04 (fifth standalone-admin-page extraction, same template).
app.use(require('./routes/site-chrome'));

// ---- API: pages list (navigator) ----
// ─── BenTML: source language ↔ JSON blocks (page builder bridge) ───
const bentml = require('./bentml');

/**
 * BenTML engine, served to the browser (src/bentml/browser-bundle.js): the
 * real language runs locally in the admin — instant decompile on every drag,
 * compile-as-you-type — with zero server roundtrips.
 */
const { buildBentmlEngine } = require('./bentml/browser-bundle');

app.get('/admin/bentml-engine.js', (req, res) => {
  try {
    res.type('application/javascript').send(buildBentmlEngine());
  } catch (e) {
    res.status(500).type('application/javascript')
      .send('/* BentmlEngine build failed: ' + String(e.message).replace(/\*\//g, '* /') + ' */');
  }
});

app.get('/admin/api/bentml/modules', (req, res) => {
  res.json({ modules: bentml.listModules(), version: '0.1' });
});

// BenTML language API — doc/primer endpoints + compile/preview/decompile/
// apply (the ".pzn is our RPM" surface) — extracted to
// src/routes/bentml-api.js in v1.34 (twenty-eighth route-group extraction).
app.use(require('./routes/bentml-api'));

// ─── .pzn canonical editing API (v0.42) ─────────────────────────────
// The page's .pzn source and builder-standard AST ops are the canonical
// editing path — for agents, tools, and the page-builder standard.
// v1.14: source/decompile/create-from-source/ops (the page-MUTATING pzn
// routes — everything v1.13's stateless split deliberately left behind)
// now live in src/routes/pzn-pages.js — mounted below, completing the
// pzn/builder API surface split docs/ARCHITECTURE.md called for.
app.use(require('./routes/pzn-pages'));

// repair/graduate/to-blocks — extracted to src/routes/pzn-tools.js in v1.13.

// (looksLikePzn / pznSourceToBlocks live in ./pzn-source since v1.13; their
// last server.js caller — the "advanced code tab" compile route — moved to
// src/routes/bentml-api.js in v1.34, so server.js no longer imports them.)

// ops — extracted to src/routes/pzn-pages.js in v1.14 (the page-mutating
// pzn routes, completing the surface split v1.13 started).

// agent token management (/admin/api/agent-tokens*) — extracted to
// src/routes/agent-tokens.js in v1.19. The token VERIFICATION path
// (agentTokens.verifyAgentToken) moved WITH the requireAgent guard to
// src/routes/agent-bridge.js in v1.33, so server.js no longer imports
// agent-tokens directly — each route module requires it itself.
app.use(require('./routes/agent-tokens'));

/** Module toolbox + schemas — what agents need to write valid .pzn. */
// toolbox + primer — extracted to src/routes/pzn-tools.js in v1.13.
// create-from-source — extracted to src/routes/pzn-pages.js in v1.14.

// preview (compile without saving) — extracted to src/routes/pzn-tools.js
// in v1.13. This closes the first sub-concern split of the pzn/builder API
// surface: every route that never touches a page file on disk (repair,
// graduate, to-blocks, toolbox, primer, preview) now lives in
// src/routes/pzn-tools.js — mounted below. The mutating routes (source,
// decompile, create-from-source, ops) stay here for a later, separate cut.
app.use(require('./routes/pzn-tools'));

// content read/history API (/admin/api/pages, /articles, /revisions*) —
// extracted to src/routes/content-api.js in v1.21 (sixteenth route-group
// extraction). The page-MUTATING routes (create/save/publish/delete) stay
// below for their own heavier cut.
app.use(require('./routes/content-api'));

// ---- Theme builder API ----
// theme settings API (GET/POST /admin/api/theme, export/import) — extracted
// to src/routes/theme.js in v1.15, together with the /admin/theme page.
app.use(require('./routes/theme'));

// ---- Menus API ----
// Menus — extracted to src/routes/menus.js in v1.07 (sixth route-group
// extraction, same template as team/integrations/seo/sitemap/site-chrome).
app.use(require('./routes/menus'));

// Page builder — new/create/delete/preview/edit + save/publish/build (the
// site-builder surface itself) — extracted to src/routes/pages-builder.js
// in v1.31 (twenty-fifth route-group extraction, the largest single cut).
app.use(require('./routes/pages-builder'));

// theme page (/admin/theme) — extracted to src/routes/theme.js in v1.15, together with its API.

// Site map — extracted to src/routes/sitemap.js in v1.03. v1.26: the JSON
// twin (/admin/api/sitemap) that had stayed inline here joined it — same
// data, same module (twenty-first route-group consolidation).
app.use(require('./routes/sitemap'));

// Multilingual pairing (v1.08) — link pages as translations of each other.
app.use(require('./routes/translations'));

// ─── /admin/agent — pair the browser bridge (agent tokens) ──────────
app.get('/admin/agent', requireAdmin, (req, res) => {
  const origin = `${req.protocol}://${req.headers.host}`;
  const html = `
    ${adminNav('agent', 'גשר סוכן — Grokin')}
    <div class="container" style="padding-top:28px;max-width:900px">
      <p style="color:#64748b;margin-top:0">
        טוקנים מאובטחים שמחברים סוכן חיצוני (תוסף הדפדפן) ל‑API של תפוזיאל —
        בלי סיסמה ובלי קובץ Cookie. הטוקן מוצג <b>פעם אחת בלבד</b> ביצירה.
        נקודת הקצה: <code dir="ltr">${escapeAdmin(origin)}/agent/v1</code>
      </p>
      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:18px">
        <h3 style="margin-top:0">צור טוקן חדש</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <input id="tok-name" placeholder="שם (למשל: Chrome של בן)" style="flex:1;min-width:200px;padding:9px;border:1px solid #e2e8f0;border-radius:8px">
          <label style="font-size:.9rem"><input type="checkbox" id="tok-write" checked> הרשאת כתיבה (יצירת דפים)</label>
          <button type="button" id="tok-create" class="btn">צור טוקן</button>
        </div>
        <div id="tok-new" style="display:none;margin-top:14px;padding:12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0">
          <div style="color:#166534;font-size:.9rem;margin-bottom:6px">העתק עכשיו — לא יוצג שוב:</div>
          <code id="tok-secret" dir="ltr" style="display:block;word-break:break-all;background:#fff;padding:8px;border-radius:6px;border:1px solid #bbf7d0"></code>
        </div>
      </section>
      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
        <h3 style="margin-top:0">טוקנים פעילים</h3>
        <div id="tok-list" style="color:#64748b">טוען…</div>
      </section>
    </div>
    <script src="/admin-agent.js"></script>
  `;
  res.send(layout(html, 'גשר סוכן', accentFor('agent')));
});

// import wizard (/admin/import + /admin/api/import) — extracted to
// src/routes/import.js in v1.17 (twelfth route-group extraction).
app.use(require('./routes/import'));

// BYO-AI paste-flow pages (GET /admin/ai + GET /admin/inject) — extracted
// to src/routes/ai-paste.js in v1.35 (twenty-ninth route-group extraction).
app.use(require('./routes/ai-paste'));

// Syntax dictionary — single source for agents + humans. v1.37 resolved the
// v1.19 shadowed-route bug: these were registered TWICE (an older
// block-registry pair above `bentml-api` won by Express's first-match rule,
// leaving these dead). The older pair is gone; the pzn dictionary — the one
// inject-pack, agent-bridge and agent-roleplay already use — now serves the
// endpoint, so /admin/inject's "copy dictionary" matches its own tool list.
// (src/syntax-dictionary.js still backs docs/SYNTAX-DICTIONARY.md via
// `npm run gen:dictionary`; it is no longer an HTTP surface.)
app.get('/admin/api/syntax-dictionary', (req, res) => {
  const { buildDictionary, toAgentTools } = require('./pzn/syntax-dictionary');
  res.json({ ok: true, dictionary: buildDictionary(), tools: toAgentTools() });
});

app.get('/admin/api/syntax-dictionary.md', (req, res) => {
  const { buildDictionary, toMarkdown } = require('./pzn/syntax-dictionary');
  res.type('text/markdown; charset=utf-8').send(toMarkdown(buildDictionary()));
});

app.get('/admin/api/inject-pack', (req, res) => {
  const { buildRoleplayPack, buildRoleCard, buildInjectBundle } = require('./pzn/agent-roleplay');
  const { buildDictionary, toMarkdown } = require('./pzn/syntax-dictionary');
  const media = require('./media').listAllMedia(40);
  const brief = req.query.brief ? String(req.query.brief) : '';
  const locale = req.query.locale === 'en' ? 'en' : 'he';
  const format = String(req.query.format || 'json');
  const size = String(req.query.size || '') === 'lite' ? 'lite' : 'full';
  const opts = { playerBrief: brief, locale, media, size };
  if (format === 'roleplay') {
    return res.type('text/markdown; charset=utf-8').send(buildRoleplayPack(opts).text);
  }
  if (format === 'card') {
    return res.type('text/plain; charset=utf-8').send(buildRoleCard(opts));
  }
  if (format === 'dictionary' || format === 'dict') {
    return res.type('text/markdown; charset=utf-8').send(toMarkdown(buildDictionary()));
  }
  res.json(buildInjectBundle(opts));
});

// ─── Tier-1 AI (v0.85): the key lives in the CMS, the chat runs here ───
// Ben's realignment: key-based chat = CMS feature (server-side calls to the
// provider's official API); the extension stays the KEYLESS tier.
app.get('/admin/api/ai/settings', requireAdmin, (req, res) => {
  try {
    const ai = require('./ai');
    res.json({ ok: true, ...ai.getSettings(), providers: ai.listProviders() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/ai/settings', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const settings = require('./ai').saveSettings({
      provider: b.provider,
      model: b.model,
      apiKey: b.apiKey // undefined = keep, '' = clear, value = replace
    });
    res.json({ ok: true, ...settings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Lead email notifications (v0.94) — extracted into src/routes/integrations.js
// alongside the rest of /admin/integrations (v1.01).

app.post('/admin/api/ai/chat', async (req, res) => {
  try {
    const b = req.body || {};
    const message = String(b.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'הודעה ריקה' });
    // the same persona every AI on-ramp gets: role + dictionary + REAL media
    const { buildRoleplayPack } = require('./pzn/agent-roleplay');
    const media = require('./media').listAllMedia(40);
    const system = buildRoleplayPack({ locale: 'he', media }).text;
    const reply = await require('./ai').generate({
      system,
      user: message,
      history: Array.isArray(b.history) ? b.history : []
    });
    res.json({ ok: true, reply });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/admin/chat', (req, res) => {
  const html = `
    ${adminNav('chat', 'צ׳אט סוכן — תיאור → BenTML → דף')}
    <style>
      .chat-wrap { display:grid; grid-template-columns:1fr 320px; gap:18px; max-width:1120px; margin:0 auto; padding:18px; align-items:start; }
      @media(max-width:900px){ .chat-wrap{ grid-template-columns:1fr; } }
      .chat-main { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:16px; display:flex; flex-direction:column; min-height:520px; }
      #chat-log { flex:1; overflow:auto; display:flex; flex-direction:column; gap:10px; padding-bottom:12px; }
      .bubble { padding:11px 14px; border-radius:12px; max-width:92%; line-height:1.5; font-size:.92rem; }
      .bubble.system { background:#f1f5f9; color:#334155; align-self:center; text-align:center; font-size:.86rem; }
      .bubble.user { background:#0a66c2; color:#fff; align-self:flex-start; }
      .bubble.assistant { background:#fff7ed; border:1px solid #fed7aa; color:#7c2d12; align-self:flex-end; }
      .bubble .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
      .bubble .act { border:none; border-radius:8px; padding:7px 10px; cursor:pointer; font:600 12px system-ui; background:#e2e8f0; color:#0f172a; }
      .bubble .act.primary { background:#7c3aed; color:#fff; }
      .bubble .code { background:#0f172a; color:#e2e8f0; border-radius:8px; padding:8px; font:11px/1.4 ui-monospace,monospace; direction:ltr; text-align:left; white-space:pre-wrap; max-height:220px; overflow:auto; }
      .chat-compose { border-top:1px solid #e2e8f0; padding-top:12px; }
      .chat-compose textarea { width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:8px; min-height:70px; font-size:.92rem; }
      .chat-compose .row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
      .chat-side .card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:16px; margin-bottom:14px; }
      .chat-side .field { margin-bottom:10px; }
      .chat-side label { display:block; font-size:.82rem; color:#475569; margin-bottom:4px; }
      .chat-side input, .chat-side select { width:100%; box-sizing:border-box; padding:8px; border:1px solid #cbd5e1; border-radius:8px; }
      .muted { color:#64748b; }
    </style>
    <div class="chat-wrap">
      <div class="chat-main">
        <div id="chat-log"></div>
        <div class="chat-compose">
          <textarea id="chat-input" placeholder="תארו את הדף שאתם רוצים… (Ctrl+Enter לשליחה)"></textarea>
          <div class="row">
            <button type="button" class="btn" id="btn-send">שלח</button>
            <span id="chat-status" class="muted" style="font-size:.85rem;align-self:center"></span>
          </div>
        </div>
      </div>
      <aside class="chat-side">
        <div class="card">
          <h3 style="margin-top:0">🔑 המפתח שלכם — בתוך ה‑CMS</h3>
          <p class="muted" style="font-size:.85rem;margin:0 0 10px">הצ׳אט קורא ל‑API הרשמי של הספק מהשרת שלכם, עם המפתח שלכם. המפתח נשמר בשרת בלבד (קובץ מוגן, מחוץ ל‑git) ולעולם לא נשלח לדפדפן.</p>
          <div class="field"><label>ספק</label><select id="ai-provider"></select></div>
          <div class="field"><label>מודל</label><select id="ai-model"></select></div>
          <div class="field"><label>מפתח API <span id="ai-key-state" class="muted"></span></label>
            <input id="ai-key" type="password" dir="ltr" autocomplete="off" placeholder="sk-…">
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button type="button" class="btn" id="ai-save" style="padding:7px 14px">שמור</button>
            <span id="ai-settings-status" class="muted" style="font-size:.82rem"></span>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">בלי מפתח? יש מסלול</h3>
          <ul class="muted" style="font-size:.88rem;line-height:1.7;padding-inline-start:18px;margin:0">
            <li><a href="/admin/inject">מילון · משחק</a> — הדביקו את החבילה בצ׳אט שאתם כבר מנויים עליו</li>
            <li><a href="/admin/ai">הדבקה ידנית</a> — הדביקו תשובת AI ובנו דף בתוך ה‑CMS</li>
            <li><a href="/admin/agent">גשר סוכן</a> — התוסף (ללא מפתח) עובד על הצ׳אט הפתוח שלכם</li>
          </ul>
        </div>
      </aside>
    </div>
    <script src="/admin-chat.js"></script>
  `;
  res.send(layout(html, 'קופיילוט', accentFor('chat')));
});

// copilot mission ADMIN api (/admin/api/mission/*) — extracted to
// src/routes/mission.js in v1.18 (thirteenth route-group extraction). The
// copilot PULL side (/agent/v1/mission*, bearer-token) stays above.
app.use(require('./routes/mission'));

// Terminal error handler — NEVER leak a stack trace to a client. Without this,
// a body-parser error (e.g. an oversized/malformed body on the public /agent
// surface) is handled by Express's default finalhandler, which in a non-prod
// env writes err.stack (absolute paths + framework internals) into the body.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const msg = status === 413 ? 'payload too large'
    : status === 400 ? 'bad request'
      : status === 403 ? 'forbidden'
        : status === 404 ? 'not found'
          : 'server error';
  res.status(status);
  if (wantsJson(req)) res.json({ ok: false, error: msg });
  else res.type('text/plain').send(msg);
});

const server = app.listen(PORT, () => {
  const base = auth.getAdminBase();
  console.log(`✅ Tapuz Visual Builder: http://localhost:${PORT}${base}`);
  if (!auth.hasAdmin()) {
    console.log(`   ↳ אין עדיין חשבון מנהל — היכנס ל־${base} כדי ליצור אותו.`);
  }
});

// S4: slow-loris / slow-request mitigation. Cap how long a client may take to
// send headers/body and how long an idle socket stays open. True volumetric
// DDoS still needs a CDN/reverse proxy in front — see docs/security.md.
server.setTimeout(30 * 1000);          // drop sockets idle/slow for 30s
server.headersTimeout = 20 * 1000;     // headers must arrive within 20s
server.requestTimeout = 60 * 1000;     // whole request within 60s
server.keepAliveTimeout = 15 * 1000;   // keep-alive idle window
