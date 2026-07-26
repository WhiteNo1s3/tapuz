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
// S6 + v1.99 foreign pixel: POST /_tapuz/collect
// Registered BEFORE the global 12mb JSON parser so it enforces its OWN tight
// 2kb limit (an unauthenticated public endpoint must never buffer megabytes).
// Handler lives in src/crm/collect-handler.js so the security rules (no
// auto-upsert, site registry, analytics vs CRM spine) have one home.
// =========================================================================
const collectHandler = require('./crm/collect-handler');
app.options('/_tapuz/collect', collectHandler.handleOptions);
app.post(
  '/_tapuz/collect',
  express.json({ limit: '2kb', type: ['application/json', 'text/plain'] }),
  (req, res) => collectHandler.handleCollect(req, res, { limiter: collectLimiter })
);

// Universal pixel loader — open CORS so foreign CMSs can load it; no secrets.
app.get('/tz-pixel.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  try {
    const fsSync = require('fs');
    const p = require('path').join(__dirname, '..', 'public', 'tz-pixel.js');
    if (fsSync.existsSync(p)) return res.sendFile(p);
  } catch (e) { /* */ }
  res.status(404).end('/* missing */');
});

// Swallow body-parser errors (malformed JSON, oversized 2kb body) for the
// collector so a bad/hostile beacon gets a quiet 204 instead of a 400 + stack
// trace. Scoped strictly to the collector path.
app.use((err, req, res, next) => {
  if (req.path === '/_tapuz/collect') return res.status(204).end();
  return next(err);
});

// WhatsApp Cloud API webhook (v1.87, W2) — the one route that needs the RAW
// request bytes: X-Hub-Signature-256 is an HMAC over the exact bytes Meta
// sent, so this MUST mount before every body parser below (urlencoded AND
// json). Reordering fails silently — signatures just stop matching — which is
// why smoke-wa-webhook.js proves the order behaviorally (a non-canonically
// spaced body must verify) on top of asserting the mount position.
app.use(require('./routes/wa-webhook'));

app.use(bodyParser.urlencoded({ extended: true, limit: '256kb' }));

// Public form capture (POST /api/form + GET /form-sent) — extracted to
// src/routes/form-capture.js in v1.28 (twenty-second route-group extraction).
// MOUNTED HERE: after the urlencoded body-parser above (so the POST body is
// parsed) and before the static mounts. Order is load-bearing.
app.use(require('./routes/form-capture'));

// Public CRM email tracking (open pixel / tracked link / unsubscribe) — v1.81,
// phase 3c. PUBLIC and unauthenticated, because a recipient's mail client is
// what calls them. MOUNTED HERE for the same reason as form capture: before the
// static mounts, so /crm/* resolves to these handlers rather than a 404. Inert
// while the CRM is off, and rate-limited per IP.
app.use(require('./routes/crm-track'));

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
    // Marketing pixels (v1.79) run third-party code, which this policy exists
    // to stop. So the policy is widened by EXACTLY the vendors the owner
    // configured, and only while pixels are enabled — a site with no pixels
    // gets the original policy, character for character. Note we still never
    // grant 'unsafe-eval': the pixel loader injects <script> elements, which
    // 'unsafe-inline' already covers.
    let px = { script: [], img: [], connect: [], frame: [] };
    try { px = require('./crm/pixels').cspSources(require('./config').loadConfig()); }
    catch (e) { /* a CSP must never fail open on a config error */ }
    const src = (base, extra) => (extra.length ? base + ' ' + [...new Set(extra)].join(' ') : base);
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      // 'unsafe-inline' scripts: the first-party analytics beacon + optional
      // gtag init are inline and must survive static export. Authored content
      // cannot inject <script> (raw HTML in body is forbidden; values escaped),
      // so residual risk is low; hashing these is a tracked follow-up.
      src("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com", px.script),
      "style-src 'self' 'unsafe-inline'",
      src("img-src 'self' data: https:", px.img),
      "font-src 'self' data:",
      src("frame-src 'self' https://www.youtube.com https://www.google.com", px.frame),
      src("connect-src 'self'", px.connect),
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
// site settings) lives in ./admin-guard, and every route module imports it
// from there directly. v1.47: server.js's own last requireAdmin caller left
// with the copilot cluster, so it no longer imports the guard at all.

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
// (layout / adminNav / accentFor / escapeAdmin / ADMIN_NAV_GROUPS live in
// ./admin-ui — the first extraction out of this file; see
// docs/ARCHITECTURE.md for the pattern. v1.47: server.js stopped importing
// them entirely — it renders no admin HTML of its own any more.)

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

// import wizard (/admin/import + /admin/api/import) — extracted to
// src/routes/import.js in v1.17 (twelfth route-group extraction).
app.use(require('./routes/import'));

// The AI copilot surface (GET /admin/agent, /admin/ai, /admin/inject,
// /admin/chat + the inject-pack / syntax-dictionary / ai-settings / ai-chat
// APIs their client scripts call) — extracted to src/routes/copilot.js in
// v1.47, the thirtieth and final route-group extraction. It could only move
// as a group once v1.37 resolved the shadowed-dictionary bug two of its
// routes were entangled in.
app.use(require('./routes/copilot'));

// copilot mission ADMIN api (/admin/api/mission/*) — extracted to
// src/routes/mission.js in v1.18 (thirteenth route-group extraction). The
// copilot PULL side (/agent/v1/mission*, bearer-token) stays above.
app.use(require('./routes/mission'));

// CRM admin screens (/admin/crm/*) — v1.77, phase 1 of the lab integration
// (docs/CRM-INTEGRATION.md). A SEPARATE PRODUCT that mounts here: every route
// is requireAdmin, and with config.crm.enabled off each screen offers to turn
// it on instead of rendering. The CMS's own paths call the CRM only through
// the guarded seam in src/crm/index.js, never into these routes.
app.use(require('./routes/crm'));

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
  console.log(`✅ Tapuziel Visual Builder: http://localhost:${PORT}${base}`);
  if (!auth.hasAdmin()) {
    console.log(`   ↳ אין עדיין חשבון מנהל — היכנס ל־${base} כדי ליצור אותו.`);
  }
  // CRM retention (v1.82, phase 5): enforce the policy on boot, then once a
  // day. `unref()` so this timer can never be the reason the process refuses
  // to exit — a housekeeping job must not outrank a shutdown.
  try {
    const crm = require('./crm');
    crm.runRetention();
    // v1.90 premium db: a daily snapshot on a keep-7 shelf. Stale-checked so
    // dev restarts don't churn the shelf; VACUUM INTO is WAL-consistent.
    try { require('./db').backupIfStale(); } catch (e) { /* a backup must never block startup */ }
    const daily = setInterval(() => {
      crm.runRetention();
      try { require('./db').backupIfStale(); } catch (e) { /* keep the timer alive */ }
    }, 24 * 60 * 60 * 1000);
    if (daily.unref) daily.unref();
  } catch (e) { /* housekeeping must never block startup */ }
});

// S4: slow-loris / slow-request mitigation. Cap how long a client may take to
// send headers/body and how long an idle socket stays open. True volumetric
// DDoS still needs a CDN/reverse proxy in front — see docs/security.md.
server.setTimeout(30 * 1000);          // drop sockets idle/slow for 30s
server.headersTimeout = 20 * 1000;     // headers must arrive within 20s
server.requestTimeout = 60 * 1000;     // whole request within 60s
server.keepAliveTimeout = 15 * 1000;   // keep-alive idle window
