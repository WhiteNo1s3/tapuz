const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

// Was there a site here before this process opened it? Asked FIRST, because
// requiring ./pages below opens (and so creates) db/tapuz.db. A mistyped
// TAPUZ_ROOT silently starts an empty site, and the boot log is the one place
// that can say so (v2.69 — printed beside the "no admin yet" line).
const ROOT_WAS_NEW = !fs.existsSync(path.join(require('./paths').DB_DIR, 'tapuz.db'));

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
// which framework answers is nobody's business, and it was on every response
app.disable('x-powered-by');
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
const { clientIp, wantsJson, isStateChanging, requestOrigin, noteForwarded, logError } = require('./http-util');

// --- v2.69: the headers EVERY response carries ----------------------------
// The CSP middleware further down sits below the public doors (form capture,
// the store's API, PayPal, the customer portal, email tracking), so their
// answers carried none of its headers — the portal's login form could be
// framed by any site. First in the chain, nothing can answer before it. The
// admin gate still sets its own stricter pair (DENY, same-origin) on top,
// and a preview route that must be framed keeps overriding as it did.
// HSTS only when the visitor is on https — a plain-http install must not be
// told to refuse itself.
app.use((req, res, next) => {
  noteForwarded(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  if (requestOrigin(req).startsWith('https://')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

// --- v2.69: liveness ------------------------------------------------------
// "Is the process serving, and can it read its database?" — for the host's
// probe and the Dockerfile's HEALTHCHECK, which used to poll /admin: that
// spent the admin's rate limit and read the accounts file every 30 seconds.
// Above the admin-base rewrite and every limiter; nothing here is secret
// (the version and build id are already in each page's generator meta).
app.get('/_tapuz/health', (req, res) => {
  let dbOk = false;
  try { dbOk = require('./db').db.prepare('SELECT 1 AS up').get().up === 1; } catch (e) { dbOk = false; }
  let build = '';
  try { build = require('./build-info').buildId(); } catch (e) { build = ''; }
  res.setHeader('Cache-Control', 'no-store');
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    version: require('../package.json').version,
    build,
    db: dbOk ? 'ok' : 'error'
  });
});

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
    // dotfiles:'allow' — sendFile defaults to dotfiles:'ignore', which answers
    // 404 whenever ANY segment of the absolute path starts with a dot. A
    // checkout under .claude/worktrees/<name>/ hits that; a normal checkout
    // does not. The path is fixed and repo-owned (no user input), so allowing
    // dot segments here is safe. Headers set above are kept (send only fills
    // Content-Type / Cache-Control when they are not already set).
    if (fsSync.existsSync(p)) return res.sendFile(p, { dotfiles: 'allow' });
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

// The card gateway's public doors (the store — src/store/gateway): the
// provider's webhook reads its own RAW bytes with a 64 KB express.raw and
// parses them itself (JSON / urlencoded / multipart, whatever the provider
// sends), so like the WhatsApp webhook it mounts BEFORE the body parsers —
// the site's 256 KB extended urlencoded parser must never be the one that
// reads an unauthenticated callback. The pay door is JSON only with its own
// 32 KB parser. smoke-store-gateway.js pins the position.
app.use(require('./routes/store-gateway'));

app.use(bodyParser.urlencoded({ extended: true, limit: '256kb' }));

// Public form capture (POST /api/form + GET /form-sent) — extracted to
// src/routes/form-capture.js in v1.28 (twenty-second route-group extraction).
// MOUNTED HERE: after the urlencoded body-parser above (so the POST body is
// parsed) and before the static mounts. Order is load-bearing.
app.use(require('./routes/form-capture'));

// The store's public endpoints (v2.53) — catalog, quote, checkout, order
// status. Same slot as form capture: before the static mounts; each route
// brings its own 32 KB JSON parser, ahead of the admin's 12 MB one below.
app.use(require('./routes/store-public'));

// PayPal sandbox (v2.68) — create / capture / cancel. JSON only, its own
// 32 KB parser, same slot as the other shopper doors. No webhook: capture
// is the shopper's button calling us, and the amount is recomputed here.
app.use(require('./routes/store-paypal'));

// Customer portal (v2.10) — /account/* when crm.portal.enabled (off by default).
// Mounted before admin so it is never gated by requireAdmin.
app.use(require('./routes/portal'));

// Public CRM email tracking (open pixel / tracked link / unsubscribe) — v1.81,
// phase 3c. PUBLIC and unauthenticated, because a recipient's mail client is
// what calls them. MOUNTED HERE for the same reason as form capture: before the
// static mounts, so /crm/* resolves to these handlers rather than a 404. Inert
// while the CRM is off, and rate-limited per IP.
app.use(require('./routes/crm-track'));

// Agent bridge payloads (intent / .pzn source) are small — cap them tight,
// BEFORE the 12mb global parser (which then skips an already-parsed body).
app.use('/agent', bodyParser.json({ limit: '512kb' }));
// 12mb is for base64 media uploads, and only a signed-in admin sends those.
// Until v2.69 this one parser ran for EVERY path, ahead of the admin gate —
// so any anonymous POST to any address had up to 12 MB buffered and parsed
// before it was refused. Now the size is chosen per request: the admin's
// allowance only under /admin with a valid session cookie, 256 KB for
// everyone else (the public doors above bring their own, smaller parsers).
// verifySession only reads the cookie and checks its signature — it never
// extends or rewrites a session; the gate below still does the real check.
const adminJsonParser = bodyParser.json({ limit: '12mb' });
const smallJsonParser = bodyParser.json({ limit: '256kb' });
app.use((req, res, next) => {
  const p = req.path;
  let signedIn = false;
  const adminArea = p === '/admin' || p.startsWith('/admin/');
  if (adminArea) {
    try { signedIn = !!auth.verifySession(req); } catch (e) { signedIn = false; }
  }
  if (signedIn) return adminJsonParser(req, res, next);
  // An admin whose session ran out while the builder sat open, saving a big
  // page or a photo: the small parser refused the body before the gate could
  // speak, and the builder toasted "payload too large" — so the owner shrank
  // the picture when the real answer was "sign in again". Under /admin, a
  // body the small parser turns away for its SIZE gets the gate's own answer
  // to a signed-out JSON caller instead. It is still refused unread, exactly
  // as before; only the sentence is the true one.
  return smallJsonParser(req, res, (err) => {
    if (err && adminArea && (err.type === 'entity.too.large' || err.status === 413) && !res.headersSent) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(401).json({ ok: false, error: 'לא מחובר' });
    }
    next(err);
  });
});

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
    // Theme web fonts (v2.24) widen style-src/font-src by exactly Google
    // Fonts, and only while the theme asks for a family — a theme on system
    // fonts keeps the original policy, character for character.
    let fontStyle = [];
    let fontFile = [];
    try {
      if (require('./theme').googleFontFamilies(require('./theme').loadOverrides()).length) {
        fontStyle = ['https://fonts.googleapis.com'];
        fontFile = ['https://fonts.gstatic.com'];
      }
    } catch (e) { /* no fonts → no widening */ }
    // PayPal's button (v2.68) loads PayPal's own script, opens its frame and
    // calls its API — and this policy blocked all three, so the button could
    // not appear in any real browser. The store says exactly which origins it
    // needs (store/paypal.cspSources) and says NOTHING unless PayPal is ready
    // and a paypal method exists: a site without PayPal keeps the original
    // policy, character for character, like pixels and fonts above.
    let pp = { script: [], img: [], connect: [], frame: [] };
    try {
      const paypal = require('./store/paypal');
      if (typeof paypal.cspSources === 'function') {
        const s = paypal.cspSources() || {};
        // an origin and nothing else (https://host or https://*.host): a
        // value with a space or a ';' in it would write its own directive
        const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && /^https:\/\/(?:\*\.)?[A-Za-z0-9.-]+(?::\d+)?$/.test(x)) : []);
        pp = { script: list(s.script), img: list(s.img), connect: list(s.connect), frame: list(s.frame) };
      }
    } catch (e) { /* a CSP must never fail open on a store error */ }
    const src = (base, extra) => (extra.length ? base + ' ' + [...new Set(extra)].join(' ') : base);
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      // 'unsafe-inline' scripts: the first-party analytics beacon + optional
      // gtag init are inline and must survive static export. Authored content
      // cannot inject <script> (raw HTML in body is forbidden; values escaped),
      // so residual risk is low; hashing these is a tracked follow-up.
      src("script-src 'self' 'unsafe-inline' https://www.googletagmanager.com", px.script.concat(pp.script)),
      src("style-src 'self' 'unsafe-inline'", fontStyle),
      src("img-src 'self' data: https:", px.img.concat(pp.img)),
      src("font-src 'self' data:", fontFile),
      src("frame-src 'self' https://www.youtube.com https://www.google.com", px.frame.concat(pp.frame)),
      src("connect-src 'self'", px.connect.concat(pp.connect)),
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
  // The admin's own scripts and stylesheet revalidate on EVERY load (v2.33.1,
  // Ben: "cyan isn't updated to latest version make it reload itself" —
  // minutes after a deploy that HAD landed). With only Last-Modified on
  // these files a browser keeps its copy on a heuristic that can last days,
  // so a fresh server served an old builder. no-cache = ask each time; a
  // 304 when nothing changed costs nothing, and a deploy shows up on the
  // next click. The site's public assets keep their caching.
  if (/[\\/]admin-[^\\/]*\.js$|[\\/]admin\.css$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
  }
  // An upload is saved under a name that carries the millisecond it arrived
  // (media.js: <name>-<timestamp>.<ext>), so that address never changes its
  // bytes — yet it was served max-age=0 and every image on every page was
  // re-asked on each visit. A week, for exactly those files (v2.69); a file
  // with a fixed name under assets/ (seeded art, a hand-placed logo) keeps
  // revalidating, because the next release may rewrite it. Set here and not
  // on the /assets mount below: assets/ sits inside PUBLIC_DIR, so the first
  // static mount is the one that actually sends these files.
  if (filePath.startsWith(ASSETS_DIR + path.sep) && /-\d{13}(?:-\d+)?\.[A-Za-z0-9]+$/.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }
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
    // built per request from the live module registry — never cached (v2.33.1)
    res.setHeader('Cache-Control', 'no-cache');
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
// Injection runner (v2.28) — the generic prompt/paste/apply/run/undo routes
// for every pack in src/injections (menu organizer, theme designer, …).
app.use(require('./routes/inject'));

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
// Geppetto (v2.56) — a Canva / Figma site swallowed whole and given a life
// (src/geppetto/, docs/bent-geppetto.md). Admin-only; reads behind the SSRF guard.
app.use(require('./routes/geppetto'));

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

// The store's admin (v2.53) — the flip, products, orders, coupons, shipping &
// payment, and the <bent-store> BenTML door. Behind the admin gate like every
// /admin route, and requireAdmin inside: prices and customers' orders.
app.use(require('./routes/store-admin'));
app.use(require('./routes/store-products'));
app.use(require('./routes/store-shelves'));
app.use(require('./routes/store-orders'));
// the card gateway's admin (סליקת אשראי): provider, mode, keys (readiness +
// last-4 only), the ₪1 connection test, and the explicit refund action
app.use(require('./routes/store-gateway-admin'));

// =========================================================================
// 404 (v2.69) — nothing above answered. Until now that was Express's own
// English "Cannot GET /x" on a white page, and visitors do reach it: a hidden
// product's old address, a renamed page, a menu item whose page was
// unpublished. Each kind of caller gets an answer it can use:
//   a program (/api, /agent, /admin/api, or anything asking for JSON) → JSON
//   an admin screen → the admin itself, with a way back
//   a missing file (an image, a script) → one short line, not a web page
//   a visitor → the site: its header, its footer, its language, a sentence,
//               and links home and (while the store is open) to the shop
// =========================================================================
const ASSET_EXT = new Set(['.js', '.mjs', '.css', '.map', '.json', '.xml', '.txt', '.png', '.jpg', '.jpeg', '.gif',
  '.webp', '.avif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.mp3', '.pdf', '.zip']);

// The visitor's 404 is a page of this site, rendered by the site's own
// renderer from a page object that exists nowhere on disk ('404' is a
// reserved slug — pages.js). It is the same page for every dead address, so
// it is rendered once per site build: the export's stamp file is rewritten on
// every rebuild (a menu, theme, settings or store change), which is exactly
// when this page would read differently. A minute is the backstop.
let notFoundCache = { key: '', at: 0, html: '' };

function renderNotFoundPage() {
  const siteLanguage = require('./site-language');
  const direction = siteLanguage.siteDirection();
  const en = siteLanguage.languageFor(direction) === 'en';
  const { escapeHtml, escapeAttr, safeHref } = require('./pzn/language/escape');
  const title = en ? 'Page not found' : 'הדף לא נמצא';
  let shopLink = '';
  try {
    const store = require('./store');
    if (store.isOpen()) {
      const s = store.settings.loadSettings();
      const shopPath = s.pages && s.pages.shop;
      const shopPage = shopPath ? getPageByFullPath(shopPath) : null;
      // a shop that IS the home page (chosen, or crowned automatically) is
      // already the first button
      if (shopPage && shopPage.status === 'published' && shopPath !== require('./export').crownedHomePath()) {
        shopLink = `<a class="btn btn-outline" style="margin:0" href="${escapeAttr(safeHref(store.pages.urls(s).shop))}">${en ? 'To the shop' : 'לחנות'}</a>`;
      }
    }
  } catch (e) { /* no store, no second button */ }
  // The theme's own hero, written out: a small "404", the sentence, and the
  // way out — centred by the hero's rule. (Built from heading/text blocks it
  // came out lopsided: the theme pins every element that carries a dir
  // attribute to its start edge, and a text block's paragraph carries one.)
  const body =
    `<section class="hero" dir="${direction}">` +
    '<p class="subtitle" style="margin-bottom:0.35rem;font-weight:700;letter-spacing:0.12em">404</p>' +
    `<h1>${escapeHtml(title)}</h1>` +
    `<p class="subtitle">${en
      ? 'There is no page at this address. It may have moved, been renamed, or left the site.'
      : 'אין דף בכתובת הזאת. ייתכן שהוא הועבר, ששמו השתנה או שהוא כבר לא באתר.'}</p>` +
    // the buttons sit in a row of their own with an even gap: the theme's
    // .btn carries a one-sided margin, which leaves a lone button two pixels
    // off the centre line everything above it stands on
    '<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0.6rem;margin-top:0.25rem">' +
    `<a class="btn btn-primary" style="margin:0" href="/">${en ? 'Back to the home page' : 'חזרה לדף הבית'}</a>` +
    shopLink +
    '</div>' +
    '</section>';
  const page = {
    title,
    full_path: '404',
    path_prefix: '',
    slug: '404',
    direction,
    theme: 'default',
    tags: [],
    meta: { robots: 'noindex, follow' },
    blocks: [{ type: 'html', data: { content: body } }]
  };
  let html = require('./renderer').renderPage(page, {});
  // a dead address has no canonical, no og:url and no structured data
  html = html
    .replace(/\n? *<link rel="canonical"[^>]*>/g, '')
    .replace(/\n? *<meta property="og:url"[^>]*>/g, '')
    .replace(/\n? *<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  // the stylesheet the exported pages already link (when one was exported):
  // the visitor has it cached, and the answer is 6 KB instead of 120
  const cssVersion = require('./export').currentThemeCssVersion();
  if (cssVersion) {
    html = html
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace('</head>', `  <link rel="stylesheet" href="/css/main.css?v=${cssVersion}">\n</head>`);
  }
  return html;
}

function notFoundHtml() {
  let key = 'none';
  try { key = String(fs.statSync(path.join(PUBLIC_DIR, require('./export').BUILT_BY)).mtimeMs); } catch (e) { /* never built */ }
  const now = Date.now();
  if (notFoundCache.html && notFoundCache.key === key && now - notFoundCache.at < 60 * 1000) return notFoundCache.html;
  const html = renderNotFoundPage();
  notFoundCache = { key, at: now, html };
  return html;
}

app.use((req, res, next) => {
  const p = req.path;
  if (p.startsWith('/api/') || p.startsWith('/agent/') || p.startsWith('/admin/api/') || wantsJson(req)) {
    return res.status(404).json({ ok: false, error: 'not found' });
  }
  if (p === '/admin' || p.startsWith('/admin/')) {
    // only a signed-in admin gets this far (the gate turned everyone else away)
    try {
      const { layout, adminNav } = require('./admin-ui');
      return res.status(404).send(layout(`
    ${adminNav('', 'לא נמצא')}
    <div class="container page-body" style="max-width:620px">
      <div class="notice info">
        <span class="notice-ico">🧭</span>
        <div class="notice-body">
          <strong>אין מסך כזה בממשק הניהול</strong>
          <p>הכתובת שהגעתם אליה לא מובילה לשום מסך. ייתכן שהקישור ישן, או שהדף שערכתם שינה את שמו.</p>
          <div class="row"><a href="/admin/dashboard" class="btn">חזרה לדשבורד</a><a href="/admin" class="btn secondary">רשימת הדפים</a></div>
        </div>
      </div>
    </div>`, 'לא נמצא'));
    } catch (e) {
      return res.status(404).type('text/plain').send('Not found');
    }
  }
  if (p.startsWith('/_tapuz') || ASSET_EXT.has(path.extname(p).toLowerCase())) {
    return res.status(404).type('text/plain').send('Not found');
  }
  let html = '';
  try {
    html = notFoundHtml();
  } catch (e) {
    logError(req, e);
    return res.status(404).type('text/plain').send('Not found');
  }
  res.status(404);
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html);
});

// Terminal error handler — NEVER leak a stack trace to a client. Without this,
// a body-parser error (e.g. an oversized/malformed body on the public /agent
// surface) is handled by Express's default finalhandler, which in a non-prod
// env writes err.stack (absolute paths + framework internals) into the body.
// The stack goes to the server log instead (v2.69): before, a 500 left no
// trace anywhere — the client got "server error" and so did the owner.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('[http] ' + req.method + ' ' + String(req.originalUrl || req.url || '').split('?')[0] +
      ' -> ' + status + ': ' + ((err && (err.stack || err.message)) || String(err)));
  }
  const msg = status === 413 ? 'payload too large'
    : status === 400 ? 'bad request'
      : status === 403 ? 'forbidden'
        : status === 404 ? 'not found'
          : 'server error';
  res.status(status);
  // Two kinds of error are a sentence meant for the owner, not a failure to
  // hide: a new page asked for an address the system keeps (pages.js,
  // E_RESERVED_PATH), and a save was refused because the file it would have
  // written over is damaged (config.js / auth.js, E_STORE_DAMAGED). Routes
  // that post a plain form have no catch of their own — the "new page" form
  // is one — so without this the owner who titled a page "API" got a white
  // page reading "bad request". Matched by code, never by status: a
  // body-parser 400 carries a message too, and that one stays hidden.
  const reserved = !!err && err.code === 'E_RESERVED_PATH';
  const damaged = !!err && err.code === 'E_STORE_DAMAGED';
  const sentence = (reserved || damaged) ? String(err.message || '') : '';
  if (wantsJson(req)) return res.json({ ok: false, error: sentence || msg });
  if (sentence && (req.path === '/admin' || req.path.startsWith('/admin/'))) {
    try {
      const { layout, adminNav, escapeAdmin } = require('./admin-ui');
      const fromNewPage = req.path === '/admin/create';
      const notice = reserved
        ? `<div class="notice warn">
        <span class="notice-ico">🚧</span>
        <div class="notice-body">
          <strong>הכתובת הזאת שמורה</strong>
          <p>הכתובת <span dir="ltr">/${escapeAdmin(err.reservedPath || '')}</span> שמורה למערכת, ואי אפשר לתת אותה לדף.</p>
          <p>הדף לא נוצר. כתובת הדף נגזרת מהכותרת — אפשר להשאיר את הכותרת ולהקליד כתובת אחרת בשדה "כתובת הדף".</p>
          <div class="row"><a href="${fromNewPage ? '/admin/new' : '/admin'}" class="btn">${fromNewPage ? 'חזרה לדף חדש' : 'חזרה לרשימת הדפים'}</a></div>
        </div>
      </div>`
        : `<div class="notice danger">
        <span class="notice-ico">⚠️</span>
        <div class="notice-body">
          <strong>השינוי לא נשמר</strong>
          <p>${escapeAdmin(sentence)}</p>
          <div class="row"><a href="/admin/dashboard" class="btn">חזרה לדשבורד</a></div>
        </div>
      </div>`;
      return res.send(layout(`
    ${adminNav(reserved ? 'pages' : '', reserved ? 'דפים' : 'לא נשמר')}
    <div class="container page-body" style="max-width:620px">
      ${notice}
    </div>`, reserved ? 'כתובת שמורה' : 'לא נשמר'));
    } catch (e) { /* the plain line below */ }
  }
  res.type('text/plain').send(sentence || msg);
});

// The store's own housekeeping (v2.69): long-unpaid orders are cancelled when
// the store's setting says so, and the demo shop tidies after itself. Both
// modules belong to the store; each call is guarded and alone in its
// try/catch, so one of them failing (or not existing yet) costs nothing.
function storeHousekeeping() {
  try {
    const orders = require('./store/orders');
    if (typeof orders.housekeeping === 'function') orders.housekeeping();
  } catch (e) { console.error('[store] order housekeeping failed: ' + e.message); }
  try {
    const d = require('./store/demo-seed');
    if (typeof d.housekeeping === 'function') d.housekeeping();
  } catch (e) { console.error('[demo-store] housekeeping failed: ' + e.message); }
}

const server = app.listen(PORT, () => {
  const base = auth.getAdminBase();
  console.log(`✅ Tapuziel Visual Builder: http://localhost:${PORT}${base}`);
  if (!auth.hasAdmin()) {
    console.log(`   ↳ אין עדיין חשבון מנהל — היכנס ל־${base} כדי ליצור אותו.`);
    // v2.69 — the first account belongs to whoever can read this log. Where
    // the data lives is printed with it: a root that was just created is
    // either a first run or a mistyped TAPUZ_ROOT, and only the owner knows.
    const { SITE_ROOT } = require('./paths');
    console.log(`   ↳ תיקיית הנתונים: ${SITE_ROOT}${ROOT_WAS_NEW ? ' (נוצרה עכשיו — אתר חדש וריק)' : ' (אתר קיים)'}`);
    if (auth.setupCodeSource() === 'env') {
      console.log('   ↳ קוד הקמה: הערך של משתנה הסביבה TAPUZ_SETUP_TOKEN. מי שיוצר את החשבון הראשון יתבקש להקליד אותו.');
    } else {
      // on a terminal run a browser on this machine is let in without it; a hosted process always asks
      console.log(`   ↳ קוד הקמה: ${auth.setupCode()}  (${typeof auth.interactiveRun === 'function' && auth.interactiveRun() ? 'נדרש ליצירת החשבון הראשון מדפדפן שאינו על המכונה הזאת' : 'נדרש ליצירת החשבון הראשון'}; מתחלף בכל הפעלה)`);
    }
  }
  // Did a new build arrive? Asked HERE, before anything in this boot writes
  // the export again: the demo step below re-exports the whole site when it
  // changes one word of it, and the export it leaves carries this build's
  // stamp. Asked after it, the answer was "no" — and the store's generated
  // pages never followed the build (seen on the live demo shop, whose only
  // upgraded part was the footer line).
  let newBuild = false;
  try {
    const exp = require('./export');
    newBuild = typeof exp.exportIsStale === 'function' && exp.exportIsStale();
  } catch (e) { newBuild = false; }
  // Demo shop (v2.68): opt-in with TAPUZ_DEMO_STORE=1. A .tapuz-root pin
  // only names the data root; it does not arm this. Empty root, once.
  // BEFORE the content seed (v2.69): a pin arms that one, and a root it had
  // filled first is a root the demo then refuses for ever.
  try { require('./store/demo-seed').maybeDemoStore(); } catch (e) { console.error('[demo-store] failed: ' + e.message); }
  // Content seed (v2.13): a deploy archive may carry a one-time content
  // package (seed/). Applied through the product's own page APIs, once per
  // package id, and never allowed to block or break boot.
  try { require('./seed-content').maybeSeed(); } catch (e) { console.error('[seed] failed: ' + e.message); }
  // A deploy must reach the store's own pages too (v2.69). Product pages and
  // category pages are GENERATED by the code, so a new build writes them
  // again — only the ones it wrote and nobody edited — before the export
  // below. A 2.68 shop upgraded in place used to keep its old product pages
  // and have no category pages until the owner happened to save something.
  try {
    if (newBuild) {
      const st = require('./store');
      if (st.isOpen()) {
        const synced = st.pages.syncCatalogPages();
        const n = (list) => (list || []).filter((x) => x && x.action && x.action !== 'kept' && x.action !== 'none' && x.action !== 'foreign').length;
        const moved = n(synced.products) + n(synced.shelves);
        if (moved) {
          console.log('[store] ' + moved + ' generated page(s) follow the new build');
          // the rebuild below runs only while the export is still the old
          // build's; when a step above has already rebuilt it, these pages
          // would wait for the owner's next save to reach a visitor
          const exp = require('./export');
          if (!exp.exportIsStale()) exp.exportAll();
        }
      }
    }
  } catch (e) { console.error('[store] page sync after deploy failed: ' + e.message); }
  // a deploy must reach the visitors: the export on disk is rebuilt when it
  // was produced by a different build than the one now running (v2.26)
  try {
    const r = require('./export').refreshAfterDeploy();
    if (r.rebuilt) console.log('[export] rebuilt the site for build ' + r.to + (r.from ? ' (was ' + r.from + ')' : ' (export carried no build stamp)'));
  } catch (e) { console.error('[export] refresh after deploy failed: ' + e.message); }
  // CRM retention (v1.82, phase 5): enforce the policy on boot, then once a
  // day. `unref()` so this timer can never be the reason the process refuses
  // to exit — a housekeeping job must not outrank a shutdown.
  try {
    const crm = require('./crm');
    crm.runRetention();
    // v1.90 premium db: a daily snapshot on a keep-7 shelf. Stale-checked so
    // dev restarts don't churn the shelf; VACUUM INTO is WAL-consistent.
    try { require('./db').backupIfStale(); } catch (e) { console.error('[db] boot backup failed: ' + e.message); /* a backup must never block startup */ }
    const daily = setInterval(() => {
      crm.runRetention();
      try { require('./db').backupIfStale(); } catch (e) { console.error('[db] daily backup failed: ' + e.message); /* keep the timer alive */ }
      storeHousekeeping();
    }, 24 * 60 * 60 * 1000);
    if (daily.unref) daily.unref();
  } catch (e) { /* housekeeping must never block startup */ }
  // The store's housekeeping (above) runs shortly after boot — not IN the
  // boot, so a slow first pass never delays the first request — and then
  // every hour: an unpaid order should not wait a day to release its stock.
  // unref'd like the daily timer, for the same reason.
  const firstPass = setTimeout(storeHousekeeping, 5000);
  if (firstPass.unref) firstPass.unref();
  const hourly = setInterval(storeHousekeeping, 60 * 60 * 1000);
  if (hourly.unref) hourly.unref();
});

// =========================================================================
// Shutdown (v2.69). A host stops a process with SIGTERM and kills it a few
// seconds later; without a handler Node (as PID 1 in a container) ignored the
// signal, sat out the grace period and was killed with the WAL unmerged. Now:
// stop accepting, let the requests in flight finish, fold the WAL back into
// the database file, close it, exit 0. Eight seconds is the hard limit — a
// stuck keep-alive socket must not outlast the host's patience.
// =========================================================================
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[shutdown] ' + signal + ' — closing');
  const closeDatabase = () => {
    try {
      const { db } = require('./db');
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (e) { console.error('[shutdown] database close failed: ' + e.message); }
  };
  // the database is closed cleanly on the hard path too: the driver is
  // synchronous, so no write is ever half-way through between two ticks
  const hard = setTimeout(() => {
    console.error('[shutdown] still open after 8s — exiting anyway');
    closeDatabase();
    process.exit(1);
  }, 8000);
  if (hard.unref) hard.unref();
  const finish = () => {
    closeDatabase();
    process.exit(0);
  };
  server.close(() => {
    // A site rebuild the store queued — an order just changed a stock line —
    // must not be lost with its timer: nothing rebuilds on the next boot of
    // the same build, so the page would keep saying "3 left" until the next
    // sale. The store is asked for its pending rebuild (store.flushRefresh);
    // should that ever be missing, its queue is a 400 ms timer
    // (store/index.js scheduleRefresh), and waiting that long lets it fire.
    let asked = false;
    try {
      const store = require('./store');
      if (typeof store.flushRefresh === 'function') { store.flushRefresh(); asked = true; }
    } catch (e) { console.error('[shutdown] store refresh failed: ' + e.message); }
    if (asked) return finish();
    setTimeout(finish, 450);
  });
  // close() waits for every open connection; idle keep-alive sockets would
  // hold it for their whole 15s window
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A promise nobody caught, or an exception nobody caught, used to end the
// process with Node's default trace — or, for a rejection inside a timer,
// pass without a word. Either way the state is unknown: say what happened,
// and exit non-zero so the host restarts a clean process.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled promise rejection: ' + ((reason && (reason.stack || reason.message)) || String(reason)));
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaught exception: ' + ((err && (err.stack || err.message)) || String(err)));
  process.exit(1);
});

// S4: slow-loris / slow-request mitigation. Cap how long a client may take to
// send headers/body and how long an idle socket stays open. True volumetric
// DDoS still needs a CDN/reverse proxy in front — see docs/security.md.
server.setTimeout(30 * 1000);          // drop sockets idle/slow for 30s
server.headersTimeout = 20 * 1000;     // headers must arrive within 20s
server.requestTimeout = 60 * 1000;     // whole request within 60s
server.keepAliveTimeout = 15 * 1000;   // keep-alive idle window
