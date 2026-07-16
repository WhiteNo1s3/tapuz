const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const {
  createPage, updatePage, publishPage, listPages, listArticles, getPageByFullPath, deletePage,
  restoreRevision, listRevisions, generateFullPath
} = require('./pages');
const { exportAll } = require('./export');
const { runSetup } = require('./setup');
const { loadMenus, saveMenus, saveMenu } = require('./menus');
const { getThemeSettings, saveThemeSettings, loadOverrides, overridesToCss, LOOKS } = require('./theme');
const { loadConfig, saveConfig } = require('./config');
const blockRegistry = require('./block-registry');

const app = express();
const PORT = process.env.PORT || 3000;

const { PUBLIC_DIR, ASSETS_DIR } = require('./paths');
const auth = require('./auth');
const { FixedWindowLimiter, LoginGuard } = require('./ratelimit');
const analytics = require('./analytics');
const gaData = require('./ga-data');

// Abuse mitigation (S4). App-level (L7) only — see docs/security.md.
const adminLimiter = new FixedWindowLimiter({ windowMs: 60 * 1000, max: 300 }); // general admin flood cap
const loginGuard = new LoginGuard(); // escalating brute-force lockout on login
const agentLimiter = new FixedWindowLimiter({ windowMs: 60 * 1000, max: 120 }); // agent bridge (per token/IP)
const agentTokens = require('./agent-tokens');
// S6 collector flood cap: coarse per-IP bucket. Beacon endpoint is public and
// unauthenticated, so it gets its own tight limit. TAPUZ_COLLECT_MAX overrides
// the per-minute cap (used by the smoke test to force a 429 deterministically).
const collectLimiter = new FixedWindowLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.TAPUZ_COLLECT_MAX, 10) || 120
});

// Client IP for rate-limiting / lockout keys. X-Forwarded-For is client-controllable,
// so trusting it lets an attacker rotate the header to defeat every per-IP limit
// (red-team finding, 2026). We therefore use the real socket peer by default and only
// honor XFF when the operator declares they run behind a trusted proxy
// (TAPUZ_TRUST_PROXY=1). Even then we take the RIGHTMOST hop — the address the trusted
// proxy actually appended — not the leftmost, which the client can forge.
const TRUST_PROXY = process.env.TAPUZ_TRUST_PROXY === '1' || process.env.TAPUZ_TRUST_PROXY === 'true';
function clientIp(req) {
  if (TRUST_PROXY) {
    const hops = (req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}
function wantsJson(req) {
  return req.path.startsWith('/admin/api') ||
    (req.headers.accept || '').indexOf('application/json') >= 0 ||
    (req.headers['content-type'] || '').indexOf('application/json') >= 0;
}
function isStateChanging(method) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

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

// ─── SEO essentials (v0.71): sitemap.xml + robots.txt, derived live from the
// published pages. Registered before the static mount so they always answer,
// and absolute URLs come from config.baseUrl (falling back to the request host).
function siteBaseUrl(req) {
  let base = '';
  try { base = String((loadConfig().baseUrl || '')).trim().replace(/\/+$/, ''); } catch (e) {}
  return base || `${req.protocol}://${req.headers.host}`;
}
app.get('/sitemap.xml', (req, res) => {
  try {
    const seo = require('./seo');
    // Crown the home over ALL published pages FIRST, then filter eligibility
    // (redirects + robots-noindex stay out). Crowning after filtering would
    // let a lookalike page inherit '/' when the real home is excluded.
    const all = require('./pages').listPages({ status: 'published' });
    const homePath = seo.pickHomePath(all);
    const pages = all.filter((p) => seo.sitemapEligible(p.meta));
    res.type('application/xml').send(seo.buildSitemapXml(pages, siteBaseUrl(req), homePath));
  } catch (e) {
    res.status(500).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>\n');
  }
});
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(require('./seo').buildRobotsTxt(siteBaseUrl(req), auth.getAdminBase()));
});

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
app.use((req, res, next) => {
  // Gate exactly the admin namespace ('/admin' and '/admin/*'), NOT root-served
  // admin client assets like '/admin-builder.js'. Public site: untouched.
  if (req.path !== '/admin' && !req.path.startsWith('/admin/')) return next();

  // Hardening headers on every admin response.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');

  const base = auth.getAdminBase();
  const ip = clientIp(req);

  // S4: general per-IP flood cap on the whole admin surface.
  if (!adminLimiter.allow('admin:' + ip)) {
    res.setHeader('Retry-After', String(adminLimiter.retryAfter('admin:' + ip)));
    return res.status(429).send('יותר מדי בקשות. נסה שוב בעוד רגע.');
  }

  // CSRF (chosen mechanism: SameSite=Lax cookie + strict Origin/Referer check,
  // see docs/security.md). Reject any state-changing request that is not
  // provably same-origin.
  if (isStateChanging(req.method) && !auth.sameOrigin(req)) {
    if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'CSRF: origin mismatch' });
    return res.status(403).send('בקשה נדחתה (בדיקת מקור).');
  }

  const p = req.path;
  // The auth screens themselves are reachable without a session.
  if (p === '/admin/login' || p === '/admin/create-account') return next();

  // Everything else under the admin base requires a valid session.
  const session = auth.verifySession(req);
  if (!session) {
    if (wantsJson(req) || isStateChanging(req.method)) {
      return res.status(401).json({ ok: false, error: 'לא מחובר' });
    }
    return res.redirect(base + '/login');
  }
  // Slide the idle window while preserving the absolute-cap iat.
  auth.issueSession(res, session.uid, req, session.iat);
  req.adminUser = session;
  next();
});

// =========================================================================
// AGENT BRIDGE (v0.45) — /agent/v1/* — bearer-token API for external agents
// (the Grokin browser extension). Deliberately OUTSIDE /admin: token auth,
// NOT session cookies. A browser never auto-sends a bearer token, so there is
// no CSRF risk — which is exactly why CORS can use Allow-Origin:* WITHOUT
// credentials: a hostile page may call the endpoint but cannot supply a valid
// token, and no cookie rides along. See docs/security.md.
// =========================================================================
function agentCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Vary', 'Origin');
  // NOTE: intentionally NO Access-Control-Allow-Credentials — bearer only.
}

app.use('/agent', (req, res, next) => {
  agentCors(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end(); // CORS preflight
  next();
});

/** Bearer-token guard for /agent/v1/*. `scope` = 'read' | 'write' | null. */
function requireAgent(scope) {
  return (req, res, next) => {
    const ip = clientIp(req);
    const raw = /^Bearer\s+(.+)$/i.exec(String(req.headers['authorization'] || '').trim());
    const rawToken = raw ? raw[1].trim() : '';
    // Flood cap keyed by SOURCE IP, never by the attacker-supplied token
    // prefix — a bad-token flood must not exhaust a victim token's quota.
    const key = 'agent:' + ip;
    if (!agentLimiter.allow(key)) {
      res.setHeader('Retry-After', String(agentLimiter.retryAfter(key)));
      return res.status(429).json({ ok: false, error: 'rate limited' });
    }
    if (!rawToken) return res.status(401).json({ ok: false, error: 'missing bearer token' });
    const id = agentTokens.verifyAgentToken(rawToken);
    if (!id) return res.status(401).json({ ok: false, error: 'invalid token' });
    if (scope && !id.scopes.includes(scope)) {
      return res.status(403).json({ ok: false, error: `token lacks '${scope}' scope` });
    }
    req.agent = id;
    next();
  };
}

app.get('/agent/v1/ping', requireAgent('read'), (req, res) => {
  res.json({ ok: true, agent: req.agent.name, scopes: req.agent.scopes, version: require('../package.json').version });
});

// The .pzn standard is PUBLIC (unauthenticated) — anyone may implement it.
// Served live from the registry so it can never drift. CORS-open, read-only.
app.get('/pzn-schema.json', (req, res) => {
  const { buildCatalog } = require('./pzn/spec');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(buildCatalog(require('../package.json').version));
});

app.get('/agent/v1/primer', requireAgent('read'), (req, res) => {
  const { buildPznPrimer } = require('./pzn/agent-primer');
  res.type('text/markdown; charset=utf-8').send(buildPznPrimer());
});

app.get('/agent/v1/toolbox', requireAgent('read'), (req, res) => {
  const pznApi = require('./pzn/index');
  res.json({ ok: true, toolbox: pznApi.getToolbox(), schemas: pznApi.getAllSchemas() });
});

// Live syntax dictionary (the tool inventory) — md or json.
app.get('/agent/v1/dictionary', requireAgent('read'), (req, res) => {
  const { buildDictionary, toMarkdown, toAgentTools } = require('./pzn/syntax-dictionary');
  const format = String(req.query.format || 'json');
  if (format === 'md' || format === 'markdown') {
    return res.type('text/markdown; charset=utf-8').send(toMarkdown(buildDictionary()));
  }
  res.json({ ok: true, dictionary: buildDictionary(), tools: toAgentTools() });
});

// The BYOT "injection" (v0.55): ONE pack that primes any chat to roleplay
// BenTML — role + tool inventory + completion contract + full dictionary.
// v0.56: the pack now also carries the REAL media manifest, so the agent
// references images that exist instead of inventing paths (no key needed).
// The extension injects this into the user's own logged-in LLM composer.
app.get('/agent/v1/roleplay', requireAgent('read'), (req, res) => {
  const { buildRoleplayPack, buildInjectBundle } = require('./pzn/agent-roleplay');
  const media = require('./media').listAllMedia(40);
  const brief = req.query.brief ? String(req.query.brief) : '';
  const locale = req.query.locale === 'en' ? 'en' : 'he';
  const opts = { playerBrief: brief, locale, media };
  if (String(req.query.format || '') === 'json') {
    return res.json({ ok: true, ...buildInjectBundle(opts) });
  }
  res.type('text/markdown; charset=utf-8').send(buildRoleplayPack(opts).text);
});

// The media library an agent may reference (read-only — reaching EXISTING media
// without a key; creating/uploading media is the BYOK tier).
app.get('/agent/v1/media', requireAgent('read'), (req, res) => {
  res.json({ ok: true, media: require('./media').listAllMedia() });
});

// Copilot missions — the extension pulls the latest pending one (bearer token),
// then reports progress back as it injects/publishes.
app.get('/agent/v1/mission', requireAgent('read'), (req, res) => {
  const missionStore = require('./mission-store');
  res.json({ ok: true, mission: missionStore.getLatestPending() });
});

app.post('/agent/v1/mission/:id/step', requireAgent('write'), (req, res) => {
  const missionStore = require('./mission-store');
  const m = missionStore.updateMission(req.params.id, {
    step: req.body && req.body.step,
    status: (req.body && req.body.status) || undefined,
    fullPath: (req.body && req.body.fullPath) || undefined
  });
  if (!m) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, mission: m });
});

app.get('/agent/v1/pages', requireAgent('read'), (req, res) => {
  const { listPages } = require('./pages');
  res.json({ ok: true, pages: listPages() });
});

app.get('/agent/v1/source', requireAgent('read'), (req, res) => {
  try {
    const fullPath = String(req.query.fullPath || '');
    const kind = req.query.kind === 'published' ? 'published' : 'draft';
    if (!fullPath) return res.status(400).json({ ok: false, error: 'fullPath required' });
    const { getPageSource } = require('./pages');
    const source = getPageSource(fullPath, kind);
    if (source == null) return res.status(404).json({ ok: false, error: 'Page not found' });
    res.json({ ok: true, fullPath, kind, source });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/agent/v1/source', requireAgent('write'), (req, res) => {
  try {
    const { fullPath, publish, loose } = req.body || {};
    let { source } = req.body || {};
    if (!fullPath || typeof source !== 'string') {
      return res.status(400).json({ ok: false, error: 'fullPath and source required' });
    }
    if (loose) {
      const { extractPzn } = require('./pzn-extract');
      source = extractPzn(source);
    }
    const { savePageSource } = require('./pages');
    let result;
    let repaired = false;
    try {
      result = savePageSource(fullPath, source, { publish: !!publish });
      if (publish) exportAll();
    } catch (strictErr) {
      // forgiving retry (v0.49): auto-repair and save as a DRAFT — never
      // publish an auto-corrected page; the admin reviews it in the builder.
      result = savePageSource(fullPath, source, { publish: false, repair: true });
      repaired = true;
    }
    res.json({
      ok: true,
      fullPath,
      blocks: result.blocks,
      warnings: result.warnings,
      repaired,
      changes: result.changes || [],
      published: !!publish && !repaired
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_PZN', line: e.line, issues: e.issues });
  }
});

app.post('/agent/v1/ops', requireAgent('write'), (req, res) => {
  try {
    const { fullPath, ops, publish } = req.body || {};
    if (!fullPath || !Array.isArray(ops)) {
      return res.status(400).json({ ok: false, error: 'fullPath and ops[] required' });
    }
    const { applyPageOps } = require('./pages');
    const result = applyPageOps(fullPath, ops, { publish: !!publish });
    if (publish) exportAll();
    res.json({ ok: true, fullPath, blocks: result.blocks, source: result.source, warnings: result.warnings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_OPS' });
  }
});

/** Create a new page from a bot's raw .pzn reply (the extension's main path). */
app.post('/agent/v1/create-from-source', requireAgent('write'), (req, res) => {
  try {
    const { publish } = req.body || {};
    let { source } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    const { extractPzn } = require('./pzn-extract');
    source = extractPzn(source);
    const pznApi = require('./pzn/index');
    let doc;
    let repaired = false;
    let changes = [];
    try {
      doc = pznApi.parse(source);
      const errors = pznApi.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
      if (errors.length) { const err = new Error('invalid'); err.issues = errors; throw err; }
    } catch (parseErr) {
      // repair-first (v0.49): an imperfect reply becomes a clean DRAFT the admin
      // reviews, rather than a hard failure. Needed here because slug derivation
      // itself requires a parseable document.
      const { repair } = require('./pzn/repair');
      const r = repair(source);
      if (!r.ok || r.remaining.length) {
        return res.status(400).json({ ok: false, error: r.error || 'could not build a valid page from the reply', issues: r.remaining || parseErr.issues });
      }
      source = r.source;
      doc = pznApi.parse(source);
      repaired = true;
      changes = r.changes;
    }
    // same empty-template guard as the admin paste route (v0.72): an agent
    // reply with zero modules must not create a placeholder-titled page.
    if (!pznApi.toTapuzPage(doc).blocks.length) {
      return res.status(400).json({ ok: false, error: 'empty page — the reply carries no bent-* modules (looks like the bare template)' });
    }
    const title = doc.title || 'דף חדש';
    const { deriveSlug } = require('./pzn/intent');
    const slug = deriveSlug((doc.slug || '').trim() || title);
    const { createPage, getPageByFullPath, savePageSource } = require('./pages');
    if (getPageByFullPath(slug) && !(req.body && req.body.update)) {
      return res.status(409).json({ ok: false, error: `page "${slug}" already exists — pass update:true`, fullPath: slug });
    }
    const existed = !!getPageByFullPath(slug);
    if (!existed) createPage({ title, slug, blocks: [] });
    const doPublish = !!publish && !repaired; // never auto-publish a repaired page
    const result = savePageSource(slug, source, { publish: doPublish });
    if (doPublish) exportAll();
    res.json({ ok: true, fullPath: slug, created: !existed, blocks: result.blocks, warnings: result.warnings, repaired, changes, published: doPublish });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_PZN', line: e.line, issues: e.issues });
  }
});

/** The Grokin trick: model emits INTENT, server owns the .pzn. */
app.post('/agent/v1/build', requireAgent('write'), (req, res) => {
  try {
    const { intent, publish } = req.body || {};
    const { intentToPzn, deriveSlug } = require('./pzn/intent');
    const source = intentToPzn(intent); // throws on invalid intent
    const pznApi = require('./pzn/index');
    const doc = pznApi.parse(source);
    const title = doc.title || 'דף חדש';
    // deriveSlug hardens against path traversal; run BOTH the bot-supplied
    // bent-slug and the title through it so lookup/create/save agree.
    const slug = deriveSlug((doc.slug || '').trim() || title);
    const { createPage, getPageByFullPath, savePageSource } = require('./pages');
    const existed = !!getPageByFullPath(slug);
    // Don't silently clobber a DIFFERENT existing page — require explicit intent.
    if (existed && !(req.body && req.body.update)) {
      return res.status(409).json({
        ok: false,
        error: `page "${slug}" already exists — pass update:true to overwrite it`,
        fullPath: slug
      });
    }
    if (!existed) createPage({ title, slug, blocks: [] });
    const result = savePageSource(slug, source, { publish: !!publish });
    if (publish) exportAll();
    res.json({ ok: true, fullPath: slug, created: !existed, blocks: result.blocks, source, warnings: result.warnings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_BUILD', issues: e.issues });
  }
});

// ---- Auth screens (Hebrew / RTL). Exempt from the session requirement. ----
function authCard(inner) {
  return `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
      <div style="width:100%;max-width:400px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:30px;box-shadow:0 12px 40px rgba(15,23,42,0.08)">
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-size:1.8rem;font-weight:800;color:#0f172a">Tapuz</div>
        </div>
        ${inner}
      </div>
    </div>`;
}
function authErr(msg) {
  return msg
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:0.88rem">${escapeAdmin(msg)}</div>`
    : '';
}
const authInput = 'width:100%;padding:11px;border:1.5px solid #cbd5e1;border-radius:9px;margin-bottom:14px;box-sizing:border-box;font-size:1rem';

app.get('/admin/login', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.verifySession(req)) return res.redirect(base);
  if (!auth.hasAdmin()) return res.redirect(base + '/create-account');
  const err = req.query.err === '1' ? 'שם משתמש או סיסמה שגויים' : '';
  const inner = `
    <h1 style="font-size:1.15rem;text-align:center;margin:0 0 18px;color:#334155">כניסת מנהל</h1>
    ${authErr(err)}
    <form method="POST" action="${base}/login">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">שם משתמש</label>
      <input name="username" autocomplete="username" required autofocus style="${authInput}">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">סיסמה</label>
      <input name="password" type="password" autocomplete="current-password" required style="${authInput}">
      <button type="submit" class="btn" style="width:100%;padding:12px;font-size:1rem">התחבר</button>
    </form>`;
  res.send(layout(authCard(inner), 'כניסה', '#0a66c2'));
});

app.post('/admin/login', (req, res) => {
  const base = auth.getAdminBase();
  const ip = clientIp(req);
  const username = String((req.body && req.body.username) || '');
  const ipKey = 'ip:' + ip;
  const userKey = 'usr:' + ip + '|' + username.toLowerCase();

  const s1 = loginGuard.status(ipKey);
  const s2 = loginGuard.status(userKey);
  if (s1.locked || s2.locked) {
    const ra = Math.max(s1.retryAfter || 0, s2.retryAfter || 0);
    res.setHeader('Retry-After', String(ra));
    const inner = authErr(`נחסמת זמנית עקב ניסיונות כושלים. נסה שוב בעוד ${ra} שניות.`) +
      `<div style="text-align:center"><a href="${base}/login">חזרה לכניסה</a></div>`;
    return res.status(429).send(layout(authCard(inner), 'נחסם', '#0a66c2'));
  }

  const user = auth.verifyLogin(username, (req.body && req.body.password) || '');
  if (!user) {
    loginGuard.fail(ipKey);
    loginGuard.fail(userKey);
    return res.redirect(base + '/login?err=1');
  }
  loginGuard.succeed(ipKey);
  loginGuard.succeed(userKey);
  auth.issueSession(res, user.id, req); // fresh session
  res.redirect(base);
});

app.post('/admin/logout', (req, res) => {
  auth.clearSession(res);
  res.redirect(auth.getAdminBase() + '/login');
});

app.get('/admin/create-account', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.hasAdmin()) return res.redirect(base + '/login');
  const err = req.query.err ? decodeURIComponent(req.query.err) : '';
  const inner = `
    <h1 style="font-size:1.15rem;text-align:center;margin:0 0 6px;color:#334155">יצירת חשבון מנהל</h1>
    <p style="text-align:center;color:#64748b;font-size:0.86rem;margin:0 0 18px">זהו החשבון הראשון באתר. בחר שם משתמש וסיסמה חזקה.</p>
    ${authErr(err)}
    <form method="POST" action="${base}/create-account">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">שם משתמש</label>
      <input name="username" autocomplete="username" required autofocus style="${authInput}">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">סיסמה (8+ תווים)</label>
      <input name="password" type="password" autocomplete="new-password" required minlength="8" style="${authInput}">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">אימות סיסמה</label>
      <input name="confirm" type="password" autocomplete="new-password" required minlength="8" style="${authInput}">
      <button type="submit" class="btn" style="width:100%;padding:12px;font-size:1rem">צור חשבון והתחבר</button>
    </form>`;
  res.send(layout(authCard(inner), 'יצירת חשבון', '#166534'));
});

app.post('/admin/create-account', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.hasAdmin()) return res.redirect(base + '/login');
  const b = req.body || {};
  if (String(b.password || '') !== String(b.confirm || '')) {
    return res.redirect(base + '/create-account?err=' + encodeURIComponent('הסיסמאות אינן תואמות'));
  }
  try {
    const u = auth.createAdmin(b.username, b.password);
    auth.issueSession(res, u.id, req);
    res.redirect(base);
  } catch (e) {
    res.redirect(base + '/create-account?err=' + encodeURIComponent(e.message || 'שגיאה'));
  }
});

// Media library: DB-wired, folder-aware (v0.31)
const mediaLib = require('./media');
mediaLib.syncDisk(); // adopt files already on disk

app.get('/admin/media', (req, res) => {
  try {
    res.json(mediaLib.listMedia(req.query.folder || ''));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/media/folder', (req, res) => {
  try {
    const folder = mediaLib.createFolder(
      (req.body.parent ? req.body.parent + '/' : '') + (req.body.name || '')
    );
    res.json({ ok: true, folder });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/admin/media/delete-folder', (req, res) => {
  try {
    mediaLib.deleteFolder(req.body.path);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/admin/media/delete', (req, res) => {
  try {
    mediaLib.deleteFile(req.body.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/admin/media/move', (req, res) => {
  try {
    const url = mediaLib.moveFile(req.body.id, req.body.folder || '');
    res.json({ ok: true, url });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Legacy flat list (kept for compatibility)
app.get('/admin/assets', (req, res) => {
  try {
    res.json(mediaLib.listMedia('').files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/upload', (req, res) => {
  try {
    const { filename, data, folder } = req.body || {};
    if (!filename || !data || typeof data !== 'string') {
      return res.status(400).json({ ok: false, error: 'missing filename/data' });
    }
    const saved = mediaLib.saveBase64({ filename, data, folder: folder || '' });
    return res.json({ ok: true, url: saved.url, name: saved.name, id: saved.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/* legacy upload path (unused after v0.31)
app.post('/admin/upload-legacy', (req, res) => {
  try {
    const { filename, data } = req.body || {};
    if (!filename || !data || typeof data !== 'string') {
      return res.status(400).json({ ok: false, error: 'missing filename/data' });
    }

    const safe = String(filename)
      .replace(/[^a-zA-Z0-9._\-\u0590-\u05FF]/g, '_')
      .slice(0, 80);
    const match = data.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ ok: false, error: 'invalid data url' });
    }

    const mime = match[1];
    const extFromMime = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg'
    }[mime] || path.extname(safe) || '.png';

    const base = path.basename(safe, path.extname(safe)) || 'image';
    const finalName = base + '-' + Date.now() + extFromMime;
    const buf = Buffer.from(match[2], 'base64');
    fs.writeFileSync(path.join(uploadDir, finalName), buf);

    res.json({ ok: true, url: '/assets/' + finalName, name: finalName });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
*/

function layout(content, title = 'Tapuz', accent = '#0a66c2') {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} • Tapuz</title>
  <link rel="stylesheet" href="/css/main.css">
  <style>
    /* section identity: each admin area carries its own accent */
    :root { --admin-accent: ${accent}; }
    .topbar { border-top: 4px solid var(--admin-accent); }
    .topbar-inner span[style*="font-weight:600"] { color: var(--admin-accent); }
    .btn:not(.secondary) { background: var(--admin-accent); border-color: var(--admin-accent); }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Hebrew", sans-serif;
      background: #f8fafc;
      margin: 0;
      color: #0f172a;
    }
    .container { max-width: 1280px; margin: 0 auto; padding: 0 20px; }

    .topbar {
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      padding: 12px 0;
      position: sticky;
      top: 0;
      z-index: 200;
    }
    .topbar-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .topbar-left { display: flex; align-items: center; gap: 16px; }
    .topbar input.page-title {
      font-size: 1.25rem;
      font-weight: 600;
      border: none;
      background: transparent;
      padding: 4px 8px;
      min-width: 280px;
      border-radius: 6px;
    }
    .topbar input.page-title:focus {
      background: #f8fafc;
      outline: 1.5px solid #0a66c2;
    }

    .builder {
      display: grid;
      grid-template-columns: 220px 1fr 300px;
      gap: 16px;
      padding-top: 12px;
      padding-bottom: 80px;
      align-items: start;
    }
    /* Direction-aware settings drawer: the admin chrome is always RTL, but the
       settings panel follows the direction of the PAGE being edited.
       Grid tracks flow right-to-left in this RTL document, so track 1 is the
       physical RIGHT. */
    /* LTR page: settings panel on the physical LEFT (toolbox right) */
    .builder.page-ltr {
      grid-template-columns: 220px 1fr 300px;
    }
    .builder.page-ltr .toolbox { order: 1; }
    .builder.page-ltr .builder-canvas-wrap { order: 2; }
    .builder.page-ltr .properties { order: 3; }
    /* RTL page: settings panel on the physical RIGHT (toolbox left) */
    .builder.page-rtl {
      grid-template-columns: 300px 1fr 220px;
    }
    .builder.page-rtl .properties { order: 1; }
    .builder.page-rtl .builder-canvas-wrap { order: 2; }
    .builder.page-rtl .toolbox { order: 3; }
    .builder.mode-source {
      grid-template-columns: 1fr;
    }
    .builder.mode-source .toolbox,
    .builder.mode-source .properties { display: none; }
    .builder.mode-source .builder-pane { order: 1; }
    .builder.mode-source .builder-canvas-wrap { display: none; }

    .bentml-output-dock {
      margin-top: 12px;
      border: 1px solid #1e293b;
      border-radius: 12px;
      background: #0b1220;
      overflow: hidden;
    }
    .bentml-output-dock-head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      background: #111827;
      color: #e2e8f0;
      font-size: 0.85rem;
    }
    .bentml-output-dock-head .dock-sub {
      color: #94a3b8;
      font-size: 0.75rem;
      flex: 1;
      min-width: 140px;
    }
    .bentml-output-dock-head .btn {
      padding: 4px 10px;
      font-size: 0.8rem;
    }
    #bentml-live-output {
      width: 100%;
      min-height: 140px;
      max-height: 220px;
      border: 0;
      resize: vertical;
      background: #0b1220;
      color: #86efac;
      font-family: ui-monospace, Consolas, monospace;
      font-size: 0.78rem;
      line-height: 1.45;
      padding: 10px 12px;
      direction: ltr;
      text-align: left;
    }
    .output-explain {
      margin: 0 0 10px;
      color: #475569;
      font-size: 0.9rem;
      line-height: 1.5;
    }

    /* Shared CMS navigation (all admin screens) */
    .admin-nav {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      padding: 8px 20px 0;
    }
    .admin-nav a {
      padding: 6px 12px;
      border-radius: 8px;
      color: #475569;
      text-decoration: none;
      font-size: 0.88rem;
      font-weight: 600;
    }
    .admin-nav a:hover { background: #f1f5f9; color: #0f172a; }
    .admin-nav a.active { background: var(--admin-accent); color: #fff; }

    /* Toolbox category labels (generated from the block registry) */
    .tool-group-label {
      font-size: 0.7rem;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 10px 0 6px;
    }

    /* Dirty-state publish button:
       neutral/disabled when the page is clean, prominent when modified */
    .btn.js-publish-btn.is-clean {
      background: #94a3b8 !important;
      border-color: #94a3b8 !important;
      opacity: 0.75;
      cursor: default;
    }
    .btn.js-publish-btn.is-dirty {
      background: #166534 !important;
      box-shadow: 0 0 0 3px rgba(22, 101, 52, 0.22);
    }

    /* Map block canvas preview — iframe must not swallow builder clicks */
    .preview-map iframe {
      width: 100%;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      pointer-events: none;
    }

    .builder-mode-tabs {
      display: flex;
      gap: 6px;
      margin: 12px 0 0;
      flex-wrap: wrap;
    }
    .builder-mode-tabs button {
      border: 1px solid #e2e8f0;
      background: #fff;
      border-radius: 999px;
      padding: 8px 14px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      color: #475569;
    }
    .builder-mode-tabs button.active {
      background: #0f172a;
      color: #fff;
      border-color: #0f172a;
    }
    .builder-mode-tabs button .tab-sub {
      display: block;
      font-size: 0.68rem;
      font-weight: 500;
      opacity: 0.75;
      margin-top: 2px;
    }
    /* BenTML code view is ADVANCED — hidden until the customer opts in, so the
       default is a clean visual builder (the raw code "looks odd" up front). */
    #builder-root.adv-off .adv-only { display: none !important; }
    .mode-advanced-toggle {
      margin-inline-start: auto;
      align-self: center;
      background: transparent;
      border: 1px dashed #cbd5e1;
      color: #64748b;
      border-radius: 999px;
      padding: 7px 14px;
      font: inherit;
      font-weight: 600;
      font-size: 0.82rem;
      cursor: pointer;
    }
    .mode-advanced-toggle[aria-pressed="true"] {
      background: #eef2ff;
      border-style: solid;
      border-color: #c7d2fe;
      color: #4338ca;
    }

    /* Live page feel — less "list of cards" */
    .builder.live-page .canvas {
      background: #f1f5f9;
      padding: 28px 18px 48px;
    }
    .builder.live-page .canvas.block-stack {
      max-width: 920px;
      margin: 0 auto;
      background: #fff;
      border-radius: 4px;
      box-shadow: 0 10px 40px rgba(15,23,42,0.08);
      padding: 28px 32px 48px;
      min-height: 70vh;
    }
    .builder.live-page .block-label {
      opacity: 0;
      position: absolute;
      top: 4px;
      left: 8px;
      z-index: 2;
      font-size: 0.7rem;
      background: #0f172a;
      color: #fff;
      padding: 2px 8px;
      border-radius: 4px;
      pointer-events: none;
      transition: opacity .12s;
    }
    .builder.live-page .canvas-block:hover .block-label,
    .builder.live-page .canvas-block.selected .block-label { opacity: 1; }
    .builder.live-page .canvas-block {
      border: 1px solid transparent;
      margin-bottom: 8px;
      padding: 2px 24px 2px 4px;
    }
    .builder.live-page .canvas-block:hover {
      border-color: #e2e8f0;
      background: transparent;
    }
    .builder.live-page .canvas-block.selected {
      border-color: #0a66c2;
      background: rgba(10,102,194,0.04);
      box-shadow: none;
    }
    .builder.live-page .block-content { padding: 0; }

    /* Interactive builder chrome */
    /* Foolproof inline editing: a persistent faint underline signals "this text
       is editable — just click", so no one has to discover double-click. */
    .inline-editable {
      cursor: text;
      outline: 1px dashed transparent;
      border-radius: 4px;
      transition: outline-color .12s, background .12s, box-shadow .12s;
      box-shadow: inset 0 -1px 0 rgba(148,163,184,0.4);
    }
    .inline-editable:hover {
      outline-color: #93c5fd;
      background: rgba(59,130,246,0.07);
      box-shadow: inset 0 -1.5px 0 rgba(59,130,246,0.55);
    }
    .inline-editing {
      outline: 2px solid #0a66c2 !important;
      background: #fffbeb !important;
      box-shadow: none !important;
      min-width: 2em;
      cursor: text;
    }
    /* Provisional raw-HTML block + its "graduate to modules" action (v0.51). */
    .bent-html-card { border: 1px dashed #f59e0b; border-radius: 10px; background: #fffbeb; padding: 12px; }
    .bent-html-badge { font-size: 0.78rem; font-weight: 700; color: #92400e; margin-bottom: 6px; }
    .bent-html-note { font-size: 0.78rem; color: #a16207; margin-bottom: 6px; }
    .bent-html-raw {
      max-height: 160px; overflow: auto; background: #1e293b; color: #e2e8f0;
      border-radius: 8px; padding: 10px; margin: 0 0 10px;
      font: 12px/1.5 ui-monospace, Consolas, monospace; white-space: pre-wrap; word-break: break-word;
    }
    .bent-html-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .bent-html-actions .btn { background: #b45309; }
    .bent-html-hint { font-size: 0.75rem; color: #a16207; }
    /* Builder previews for interactive containers (v0.54) */
    .preview-tabs { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .preview-tabs-labels { display: flex; gap: 2px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap; }
    .preview-tab-chip { padding: 8px 14px; font-size: 0.85rem; font-weight: 600; color: #64748b; cursor: default; }
    .preview-tab-chip.active { color: #0a66c2; background: #fff; box-shadow: inset 0 -2px 0 #0a66c2; }
    .preview-tab-body { padding: 12px 14px; color: #334155; font-size: 0.9rem; }
    .preview-accordion { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    .preview-fold { border-bottom: 1px solid #e2e8f0; }
    .preview-fold:last-child { border-bottom: none; }
    .preview-fold-head { padding: 9px 14px; font-weight: 600; color: #334155; font-size: 0.9rem; background: #f8fafc; }
    .preview-fold-body { padding: 10px 14px; color: #475569; font-size: 0.88rem; }
    .preview-form { display: flex; flex-direction: column; gap: 10px; max-width: 420px; }
    .preview-field { display: flex; flex-direction: column; gap: 4px; }
    .preview-field-label { font-size: 0.82rem; font-weight: 600; color: #475569; }
    .preview-field-box { border: 1px solid #cbd5e1; border-radius: 7px; padding: 8px 10px; background: #f8fafc; color: #94a3b8; font-size: 0.85rem; min-height: 16px; }
    .preview-field-check { width: 16px; height: 16px; border: 1px solid #cbd5e1; border-radius: 4px; display: inline-block; background: #f8fafc; }
    .preview-form-submit { align-self: flex-start; background: #0a66c2; color: #fff; padding: 8px 18px; border-radius: 7px; font-size: 0.85rem; font-weight: 600; }
    .preview-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
    .preview-card { border: 1px solid #e2e8f0; border-radius: 9px; overflow: hidden; background: #fff; }
    .preview-card-media { aspect-ratio: 16/9; background: #eef2f7; }
    .preview-card-tag { display: inline-block; margin: 6px 8px 0; font-size: 0.62rem; font-weight: 700; text-transform: uppercase; color: #0a66c2; }
    .preview-card-title { padding: 2px 8px; font-size: 0.8rem; font-weight: 600; color: #1e293b; }
    .preview-card-excerpt { padding: 0 8px 8px; font-size: 0.72rem; color: #64748b; }
    .preview-nav { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; padding: 10px 12px; border-radius: 8px; background: #f1f5f9; }
    .preview-nav-center { justify-content: center; }
    .preview-nav-end { justify-content: flex-end; }
    .preview-nav-link { font-weight: 600; font-size: 0.85rem; color: #334155; }
    .preview-ticker { display: flex; align-items: stretch; gap: 0; border-radius: 8px; overflow: hidden; background: #0f172a; }
    .preview-ticker-label { flex-shrink: 0; background: #c0392b; color: #fff; font-weight: 700; font-size: 0.8rem; padding: 8px 12px; display: flex; align-items: center; }
    .preview-ticker-strip { display: flex; gap: 22px; align-items: center; padding: 8px 12px; overflow: hidden; white-space: nowrap; }
    .preview-ticker-link { font-weight: 600; font-size: 0.85rem; color: #e2e8f0; flex-shrink: 0; }
    .preview-category-head { font-weight: 700; color: #1e293b; padding: 6px 10px; border-right: 4px solid #0a66c2; background: #f8fafc; border-radius: 6px; margin-bottom: 10px; }
    .prop-section-label {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #64748b;
      margin: 14px 0 8px;
    }
    details.style-advanced {
      margin-top: 14px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 10px 10px;
      background: #f8fafc;
    }
    details.style-advanced summary {
      cursor: pointer;
      font-weight: 700;
      color: #334155;
      list-style: none;
    }
    details.style-advanced summary::-webkit-details-marker { display: none; }
    .adv-badge {
      font-size: 0.65rem;
      background: #fef3c7;
      color: #92400e;
      padding: 2px 6px;
      border-radius: 999px;
      margin-inline-start: 6px;
      font-weight: 700;
    }
    details.agent-snip-details {
      margin-top: 10px;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 6px 10px;
      color: #64748b;
      font-size: 0.85rem;
    }
    details.agent-snip-details summary { cursor: pointer; }
    .container-badge {
      font-size: 0.65rem;
      background: #dbeafe;
      color: #1e40af;
      padding: 1px 6px;
      border-radius: 4px;
      font-weight: 700;
      margin-inline-end: 4px;
    }
    .columns-preview.is-container {
      border: 2px dashed #bfdbfe;
      border-radius: 12px;
      padding: 8px;
      background: #f8fbff;
      gap: 10px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }
    .column-pane.is-container {
      border: 1px dashed #93c5fd;
      border-radius: 10px;
      background: #fff;
      min-height: 80px;
      padding: 6px;
    }
    body.is-dragging .drop-slot {
      min-height: 28px;
      opacity: 1;
    }
    body.is-dragging .drop-slot-line {
      background: #0a66c2;
      height: 3px;
    }

    .col-resize-handle {
      width: 10px;
      cursor: col-resize;
      z-index: 5;
      background: transparent;
    }
    .col-resize-handle::after {
      content: '';
      position: absolute;
      top: 12%;
      bottom: 12%;
      left: 3px;
      width: 3px;
      border-radius: 2px;
      background: #93c5fd;
      opacity: 0;
      transition: opacity .12s;
    }
    .column-pane:hover .col-resize-handle::after,
    body.is-col-resizing .col-resize-handle::after {
      opacity: 1;
    }
    body.is-col-resizing {
      cursor: col-resize !important;
      user-select: none;
    }
    .col-ratio-label {
      font-size: 0.68rem;
      color: #64748b;
      font-weight: 600;
      margin-inline-start: 4px;
    }

    .block-kw, .tool-kw {
      font-family: ui-monospace, Consolas, monospace;
      font-size: 0.72rem;
      background: #0f172a;
      color: #fbbf24;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .bentml-lang-box pre.bentml-mini-snip,
    pre.agent-snip, pre.agent-shape, pre.agent-sheet {
      font-family: ui-monospace, Consolas, monospace;
      font-size: 0.75rem;
      background: #0b1220;
      color: #e2e8f0;
      padding: 10px 12px;
      border-radius: 8px;
      overflow: auto;
      direction: ltr;
      text-align: left;
      white-space: pre-wrap;
      margin: 6px 0;
      max-height: 220px;
    }
    pre.agent-sheet { max-height: 420px; }
    pre.agent-shape { max-height: none; border: 1px solid #334155; }

    #bentml-source {
      width: 100%;
      min-height: 62vh;
      font-family: ui-monospace, Consolas, monospace;
      font-size: 0.9rem;
      line-height: 1.5;
      direction: ltr;
      text-align: left;
      background: #0b1220;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 16px;
      resize: vertical;
    }
    .bentml-source-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
    }
    .bentml-status { font-size: 0.85rem; color: #64748b; }
    .bentml-status.ok { color: #166534; }
    .bentml-status.err { color: #b91c1c; }
    .bentml-status.warn { color: #b45309; }

    .agent-hero h3 { margin: 0 0 6px; }
    .agent-hero p { color: #64748b; margin: 0 0 12px; }
    .agent-mod {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 12px;
      margin-bottom: 8px;
      background: #fff;
    }
    .agent-mod summary { cursor: pointer; font-weight: 600; }
    .agent-mod .kw { color: #b45309; }
    .agent-hint { color: #64748b; font-size: 0.9rem; }
    .btn-insert-snip { margin-top: 6px; font-size: 0.85rem; }

    .chat-mission-banner {
      background: linear-gradient(135deg, #eff6ff, #f8fafc 50%, #fff7ed);
      border: 1px solid #bfdbfe;
      border-radius: 14px;
      padding: 1.1rem 1.25rem 1.2rem;
      margin-bottom: 1rem;
    }
    .chat-mission-title {
      font-size: 1.15rem;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 0.65rem;
    }
    .chat-mission-steps {
      margin: 0 0 0.75rem;
      padding-inline-start: 1.25rem;
      line-height: 1.65;
      color: #334155;
    }
    .chat-mission-note {
      margin: 0;
      font-size: 0.9rem;
      color: #64748b;
      line-height: 1.5;
    }
    .chat-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 1rem;
    }
    .chat-snippet-preview {
      width: 100%;
      min-height: 280px;
      font-family: ui-monospace, Consolas, monospace;
      font-size: 0.78rem;
      direction: ltr;
      text-align: left;
      background: #0b1220;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      resize: vertical;
    }
    .chat-media-list {
      color: #475569;
      line-height: 1.7;
    }
    .chat-media-list code {
      font-size: 0.8rem;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .chat-float-notice {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      border-radius: 10px;
      padding: 10px 14px;
      margin: 12px 0 0;
      font-size: 0.9rem;
      color: #78350f;
      line-height: 1.5;
    }
    .text-format-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
    .text-format-bar .fmt-btn { padding: 4px 10px; font-weight: 700; min-width: 36px; }
    .text-body-field { min-height: 140px; font-family: ui-monospace, Consolas, monospace; font-size: 0.88rem; }
    .preview-map {
      border: 1px dashed #94a3b8; border-radius: 12px; padding: 1.25rem; text-align: center;
      background: linear-gradient(180deg, #f0f9ff, #fff);
    }
    .preview-map-pin { font-size: 1.6rem; }
    .preview-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; background: #f8fafc; }
    .preview-quote { margin: 0; padding: 0.75rem 1rem; border-inline-start: 4px solid #0a66c2; background: #f8fafc; }

    .builder-pane {
      grid-column: 1 / -1;
    }
    .builder:not(.mode-source):not(.mode-agent) .builder-pane-source,
    .builder:not(.mode-source):not(.mode-agent) .builder-pane-agent { display: none; }

    .toolbox {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      height: fit-content;
      position: sticky;
      top: 70px;
    }
    .toolbox h4 {
      margin: 0 0 12px;
      font-size: 0.85rem;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .toolbox-mode {
      font-size: 0.75rem;
      color: #64748b;
      line-height: 1.45;
      margin: -4px 0 12px;
      padding: 8px 10px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px dashed #e2e8f0;
    }
    .toolbox.has-selection .toolbox-mode {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #1e40af;
    }
    .tool-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      text-align: right;
      padding: 10px 12px;
      margin-bottom: 6px;
      border: 1px solid #e2e8f0;
      background: #fff;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: all .1s;
    }
    .tool-btn .tool-ico {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #475569;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .tool-btn .tool-meta { flex: 1; min-width: 0; }
    .tool-btn .tool-name { display: block; line-height: 1.2; }
    .tool-btn .tool-hint {
      display: block;
      font-size: 0.7rem;
      color: #94a3b8;
      font-weight: 500;
      margin-top: 2px;
    }
    .tool-btn:hover {
      border-color: #0a66c2;
      background: #f0f7ff;
      color: #0a66c2;
    }
    .tool-btn:hover .tool-ico { background: #dbeafe; color: #0a66c2; }
    .tool-btn.is-current {
      border-color: #0a66c2;
      background: #eff6ff;
      box-shadow: inset 3px 0 0 #0a66c2;
    }
    .toolbox.has-selection .tool-btn.is-replace-mode:not(.is-current):hover {
      border-color: #7c3aed;
      background: #f5f3ff;
      color: #5b21b6;
    }
    .toolbox.has-selection .tool-btn.is-replace-mode:not(.is-current):hover .tool-ico {
      background: #ede9fe;
      color: #6d28d9;
    }

    .canvas {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      min-height: 620px;
      padding: 24px;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
    }
    .canvas-header {
      font-size: 0.8rem;
      color: #64748b;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      justify-content: space-between;
    }

    .canvas-block {
      position: relative;
      margin-bottom: 14px;
      border: 2px solid transparent;
      border-radius: 10px;
      padding: 4px 28px 8px 8px;
      transition: all 0.1s;
      cursor: default;
      background: #fff;
    }
    .canvas-block:hover { border-color: #cbd5e1; }
    .canvas-block.selected {
      border-color: #0a66c2;
      background: #f8fafc;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.12);
    }
    .canvas-block.nested {
      margin-bottom: 8px;
      padding: 4px 24px 6px 6px;
      background: #fff;
      border-style: dashed;
    }
    .canvas-block.dragging { opacity: 0.45; }
    .canvas-block.drag-ghost { outline: 2px dashed #0a66c2; }

    .block-handle {
      position: absolute;
      top: 50%;
      right: 6px;
      transform: translateY(-50%);
      color: #94a3b8;
      font-size: 14px;
      cursor: grab;
      user-select: none;
      line-height: 1;
      padding: 4px 2px;
    }
    .block-handle:active { cursor: grabbing; }
    .canvas-block:hover .block-handle { color: #0a66c2; }

    .block-toolbar {
      position: absolute;
      top: -11px;
      left: 10px;
      background: #0f172a;
      color: white;
      font-size: 11px;
      padding: 1px 8px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0;
      transition: opacity .1s;
      z-index: 10;
    }
    .canvas-block:hover .block-toolbar,
    .canvas-block.selected .block-toolbar { opacity: 1; }
    .block-toolbar button {
      background: none;
      border: none;
      color: #cbd5e1;
      font-size: 13px;
      padding: 2px 5px;
      cursor: pointer;
      line-height: 1;
    }
    .block-toolbar button:hover { color: white; }

    .block-label {
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
      margin-bottom: 4px;
      letter-spacing: .2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .block-type-icon {
      display: inline-flex;
      width: 18px;
      height: 18px;
      align-items: center;
      justify-content: center;
      background: #f1f5f9;
      border-radius: 4px;
      font-size: 10px;
      color: #475569;
    }
    .nest-tag {
      font-size: 10px;
      color: #94a3b8;
      font-weight: 500;
    }
    .canvas-header .canvas-hint {
      opacity: 0;
      transition: opacity .2s;
      color: #0a66c2;
      font-weight: 600;
      font-size: 0.78rem;
      margin-inline-start: auto;
      padding-inline-start: 12px;
    }
    .canvas-header .canvas-hint.visible { opacity: 1; }
    .canvas-header { gap: 8px; flex-wrap: wrap; }

    .prop-type-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }
    .prop-type-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: #eff6ff;
      color: #0a66c2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      font-weight: 700;
    }
    .prop-type-name { font-weight: 700; font-size: 1rem; }
    .prop-type-sub { font-size: 0.75rem; color: #64748b; }
    .prop-hint {
      font-size: 0.72rem;
      color: #94a3b8;
      margin-top: 6px;
      line-height: 1.4;
    }
    .replace-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .replace-chip {
      border: 1px solid #e2e8f0;
      background: #fff;
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 0.78rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: inherit;
    }
    .replace-chip:hover {
      border-color: #7c3aed;
      background: #f5f3ff;
      color: #5b21b6;
    }
    .replace-chip.active {
      border-color: #0a66c2;
      background: #eff6ff;
      color: #0a66c2;
      cursor: default;
    }
    .replace-chip .chip-icon { font-size: 0.7rem; opacity: .85; }
    .props-empty {
      color: #64748b;
      font-size: 0.88rem;
      padding: 18px 6px;
      text-align: center;
      line-height: 1.55;
    }
    .props-empty-title {
      font-weight: 700;
      color: #334155;
      margin-bottom: 12px;
      font-size: 0.95rem;
    }
    .props-empty-line {
      margin: 6px 0;
      text-align: right;
      padding: 6px 8px;
      background: #f8fafc;
      border-radius: 8px;
      font-size: 0.8rem;
    }
    .nest-hint {
      font-size: 0.75rem;
      color: #0a66c2;
      background: #eff6ff;
      border-radius: 6px;
      padding: 4px 8px;
      margin-bottom: 10px;
      display: inline-block;
    }

    .properties {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px;
      height: fit-content;
      position: sticky;
      top: 70px;
    }
    .properties h4 { margin: 0 0 14px; font-size: 0.95rem; }
    .prop-group { margin-bottom: 14px; }
    .prop-group label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      margin-bottom: 4px;
      color: #475569;
    }
    .prop-group input, .prop-group textarea, .prop-group select {
      width: 100%;
      padding: 8px 10px;
      border: 1.5px solid #cbd5e1;
      border-radius: 7px;
      font-size: 0.95rem;
      font-family: inherit;
    }
    .prop-group textarea { min-height: 80px; }

    .empty-canvas {
      padding: 80px 20px;
      text-align: center;
      color: #64748b;
      border: 2px dashed #e2e8f0;
      border-radius: 12px;
    }

    .save-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: white;
      border-top: 1px solid #e2e8f0;
      padding: 14px 0;
      z-index: 300;
    }

    /* Stacked block list */
    .block-stack, .block-list { min-height: 40px; }
    .list-drop-active {
      outline: 2px dashed #93c5fd;
      outline-offset: 2px;
      border-radius: 10px;
    }

    /* Insert-between slots (vertical stack) */
    .drop-slot {
      height: 10px;
      margin: 0;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: height .1s;
    }
    body.is-dragging .drop-slot { height: 18px; }
    .drop-slot-line {
      display: block;
      width: 100%;
      height: 2px;
      background: transparent;
      border-radius: 2px;
      transition: background .1s, height .1s;
    }
    .drop-slot-label {
      display: none;
      position: absolute;
      font-size: 10px;
      font-weight: 700;
      color: #0a66c2;
      background: #eff6ff;
      padding: 1px 8px;
      border-radius: 999px;
      pointer-events: none;
    }
    .drop-slot.drop-slot-active {
      height: 28px;
    }
    .drop-slot.drop-slot-active .drop-slot-line {
      height: 3px;
      background: #0a66c2;
      box-shadow: 0 0 0 3px rgba(10,102,194,.12);
    }
    .drop-slot.drop-slot-active .drop-slot-label { display: inline-block; }

    /* Side split zones — drop beside a block to create columns */
    .split-zone {
      position: absolute;
      top: 8px;
      bottom: 8px;
      width: 22px;
      opacity: 0;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 5;
      transition: opacity .12s, background .12s, width .12s;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 700;
      color: #0a66c2;
      writing-mode: horizontal-tb;
    }
    .split-zone span {
      transform: none;
      white-space: nowrap;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 4px 2px;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      letter-spacing: .5px;
    }
    .split-left { left: 2px; }
    .split-right { right: 24px; }
    body.is-dragging .split-zone {
      opacity: 0.55;
      pointer-events: auto;
      background: rgba(239,246,255,.55);
    }
    body.is-dragging .canvas-block:hover .split-zone,
    .split-zone.split-active {
      opacity: 1;
      width: 28px;
      background: #dbeafe;
      box-shadow: inset 0 0 0 1px #0a66c2;
    }
    .canvas-block.split-target {
      border-color: #0a66c2 !important;
      box-shadow: 0 0 0 3px rgba(10,102,194,.15);
    }

    .columns-preview {
      display: flex;
      gap: 12px;
      align-items: stretch;
      direction: ltr; /* physical left/right for split side */
    }
    .column-pane, .column-drop {
      flex: 1;
      min-width: 0;
      background: #f8fafc;
      border: 1.5px dashed #cbd5e1;
      border-radius: 10px;
      min-height: 110px;
      padding: 8px;
      transition: border-color .12s, background .12s, box-shadow .12s;
      direction: rtl;
    }
    .column-drop.drop-hover, .column-pane.list-drop-active {
      border-color: #0a66c2;
      background: #eff6ff;
      box-shadow: inset 0 0 0 1px #0a66c2;
    }
    .column-head {
      font-size: 11px;
      font-weight: 700;
      color: #64748b;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: .4px;
    }
    .column-empty {
      padding: 18px 8px;
      text-align: center;
      color: #94a3b8;
      font-size: 0.85rem;
      border: 1px dashed #e2e8f0;
      border-radius: 8px;
      margin: 4px 0;
    }
    .column-add {
      width: 100%;
      margin-top: 4px;
      padding: 6px;
      border: 1px solid #e2e8f0;
      background: #fff;
      border-radius: 6px;
      font-size: 0.8rem;
      color: #475569;
      cursor: pointer;
    }
    .column-add:hover {
      border-color: #0a66c2;
      color: #0a66c2;
    }
    .canvas.drop-hover-root, .canvas.list-drop-active {
      outline: 2px dashed #0a66c2;
      outline-offset: -4px;
    }
    .preview-features { display: grid; gap: 8px; }
    .preview-feature {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 0.9rem;
    }
    .preview-feature strong { display: block; margin-bottom: 2px; }
    .preview-cubes {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .preview-cube {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
    }
    .preview-cube .cube-img {
      height: 64px;
      background: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 1.2rem;
    }
    .preview-cube .cube-img img { width: 100%; height: 100%; object-fit: cover; }
    .preview-cube .cube-txt {
      padding: 6px 8px;
      font-size: 0.78rem;
      color: #334155;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .preview-cubes-note {
      grid-column: 1 / -1;
      font-size: 0.78rem;
      color: #64748b;
      background: #f8fafc;
      border-radius: 6px;
      padding: 6px 10px;
    }
    .preview-hero {
      background: #0a66c2;
      color: white;
      padding: 28px 24px;
      border-radius: 8px;
      text-align: center;
    }
    .preview-hero h1 { margin: 0 0 8px; font-size: 1.8rem; color: white; }
    .preview-hero p { margin: 0; opacity: 0.9; }
    .preview-btn {
      display: inline-block;
      background: #0a66c2;
      color: white;
      padding: 8px 20px;
      border-radius: 6px;
      font-weight: 600;
    }
    .preview-image-empty {
      background: #f1f5f9;
      padding: 40px 20px;
      text-align: center;
      border-radius: 8px;
      color: #64748b;
    }
    .preview-spacer {
      background: repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 4px,#fff 4px,#fff 8px);
      border-radius: 4px;
    }
    .preview-testimonial {
      background: #f8fafc;
      padding: 16px;
      border-radius: 8px;
      border-right: 4px solid #0a66c2;
    }
    .nest-hint {
      background: #eff6ff;
      color: #0a66c2;
      font-size: 0.78rem;
      font-weight: 600;
      padding: 6px 10px;
      border-radius: 6px;
      margin-bottom: 10px;
    }
    .media-item {
      cursor: pointer;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
    }
    .media-item:hover { border-color: #0a66c2; }
    .media-item img {
      width: 100%;
      height: 90px;
      object-fit: cover;
      display: block;
    }
    .media-name {
      padding: 4px;
      font-size: 0.75rem;
      text-align: center;
      color: #475569;
    }
    .tool-btn.dragging-tool { opacity: 0.55; }
    .tool-btn[draggable="true"] { cursor: grab; }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 16px;
      background: #0a66c2;
      color: white;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      cursor: pointer;
    }
    .btn:hover { background: #084d96; }
    .btn.secondary { background: #64748b; }
    .btn.secondary:hover { background: #475569; }

    .modal {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.65);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 999;
    }
    .modal.show { display: flex; }
    .modal-content {
      background: white;
      padding: 28px;
      border-radius: 16px;
      width: 100%;
      max-width: 720px;
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
}

// ======================== ROUTES ========================

/**
 * Shared CMS shell navigation — rendered on every admin screen so the whole
 * site is managed from one persistent menu (dashboard / pages / media / menus
 * / theme / settings / SEO / integrations). The page builder is reached by
 * editing a page from the pages list.
 */
const ADMIN_NAV_ITEMS = [
  { key: 'dashboard', href: '/admin/dashboard', label: 'דשבורד' },
  { key: 'pages', href: '/admin', label: 'דפים' },
  { key: 'import', href: '/admin/import', label: 'ייבוא' },
  { key: 'media', href: '/admin/media-library', label: 'מדיה' },
  { key: 'storage', href: '/admin/storage', label: 'אחסון' },
  { key: 'categories', href: '/admin/categories', label: 'קטגוריות' },
  { key: 'menus', href: '/admin/menus', label: 'תפריטים' },
  { key: 'sitemap', href: '/admin/sitemap', label: 'מפת אתר' },
  { key: 'theme', href: '/admin/theme', label: 'ערכת נושא' },
  { key: 'settings', href: '/admin/settings', label: 'הגדרות אתר' },
  { key: 'site-chrome', href: '/admin/site-chrome', label: 'כותרת ותחתית' },
  { key: 'seo', href: '/admin/seo', label: 'SEO' },
  { key: 'analytics', href: '/admin/analytics', label: 'אנליטיקס' },
  { key: 'integrations', href: '/admin/integrations', label: 'אינטגרציות' },
  // One AI front door (the copilot hub) + the extension/token setup. The paste
  // flow (/admin/ai) and the dictionary/game (/admin/inject) are sub-tools
  // reached from the hub — kept off the top nav to keep it coherent (v0.56).
  { key: 'chat', href: '/admin/chat', label: 'AI ✨' },
  { key: 'agent', href: '/admin/agent', label: 'גשר סוכן' }
];

function adminNav(active, sectionTitle, actionsHtml = '') {
  const links = ADMIN_NAV_ITEMS.map(item =>
    `<a href="${item.href}"${item.key === active ? ' class="active"' : ''}>${item.label}</a>`
  ).join('');
  return `
    <div class="topbar">
      <div class="container topbar-inner">
        <div style="display:flex;align-items:center;gap:12px">
          <a href="/admin" style="font-size:1.6rem;font-weight:700;text-decoration:none;color:#0f172a">Tapuz</a>
          <span style="color:#94a3b8">•</span>
          <span style="font-weight:600">${sectionTitle}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <a href="/" target="_blank" class="btn secondary" style="padding:7px 12px">צפה באתר</a>
          ${actionsHtml}
          <form method="POST" action="${auth.getAdminBase()}/logout" style="margin:0">
            <button type="submit" class="btn secondary" style="padding:7px 12px" title="התנתק">התנתק</button>
          </form>
        </div>
      </div>
      <div class="container admin-nav">${links}</div>
    </div>`;
}

function needsSetup() {
  try {
    return !loadConfig().setupDone && listPages().length === 0;
  } catch (e) {
    return false;
  }
}

app.get('/admin/setup', (req, res) => {
  if (!needsSetup()) return res.redirect('/admin');
  const html = `
    <style>
      .wiz-steps { display:flex;justify-content:center;gap:6px;margin-bottom:22px;flex-wrap:wrap }
      .wiz-step-dot { display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:0.82rem;font-weight:600 }
      .wiz-step-dot.active { background:#0a66c2;color:#fff }
      .wiz-step-dot.done { background:#dcfce7;color:#166534 }
      .wiz-panel { display:none }
      .wiz-panel.active { display:block }
      .wiz-card { background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:26px }
      .wiz-input { width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box }
      .wiz-nav { display:flex;justify-content:space-between;gap:10px;margin-top:20px }
      .wiz-teach { background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;border-radius:10px;padding:10px 14px;font-size:0.85rem;margin-bottom:16px;line-height:1.5 }
      .wiz-palettes { display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:16px }
      .wiz-palette { border:2px solid #e2e8f0;border-radius:10px;padding:8px;cursor:pointer;text-align:center;background:#fff }
      .wiz-palette.selected { border-color:#0a66c2 }
      .wiz-palette .sw { display:flex;height:22px;border-radius:6px;overflow:hidden;margin-bottom:6px }
      .wiz-palette .sw span { flex:1 }
      .wiz-palette small { font-size:0.75rem;color:#475569;font-weight:600 }
      .wiz-colors { display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px }
      .wiz-color-row { display:flex;align-items:center;gap:8px;font-size:0.85rem }
      .wiz-color-row input[type=color] { width:40px;height:32px;border:1px solid #cbd5e1;border-radius:8px;padding:2px;flex-shrink:0 }
      .wiz-preview { border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-top:8px }
      .wiz-check { display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;cursor:pointer }
      .wiz-check input { margin-top:3px }
      .wiz-check strong { display:block }
      .wiz-check small { color:#64748b }
      .wiz-ext-row { display:flex;gap:8px;margin-bottom:8px }
    </style>
    <div class="container" style="padding-top:36px;max-width:640px;padding-bottom:60px">
      <div style="text-align:center;margin-bottom:18px">
        <div style="font-size:3rem">🍊</div>
        <h1 style="margin:8px 0 4px">ברוכים הבאים ל־Tapuziel</h1>
        <p style="color:#64748b;margin:0">מהרעיון שבראש — לאתר חי. ארבעה צעדים, הכל ניתן לשינוי אחר כך.</p>
      </div>
      <div class="wiz-steps">
        <span class="wiz-step-dot" data-dot="0">1 · שם</span>
        <span class="wiz-step-dot" data-dot="1">2 · צבעים</span>
        <span class="wiz-step-dot" data-dot="2">3 · דפים</span>
        <span class="wiz-step-dot" data-dot="3">4 · תפריט</span>
      </div>

      <div class="wiz-card">
        <!-- Step 1: name -->
        <div class="wiz-panel" data-panel="0">
          <label style="font-weight:600;display:block;margin-bottom:6px">איך קוראים לאתר?</label>
          <input id="wiz-title" class="wiz-input" required maxlength="60" placeholder="השם שיופיע בכותרת">
          <input id="wiz-desc" class="wiz-input" maxlength="160" placeholder="משפט קצר על האתר (לא חובה)" style="margin-top:8px">
        </div>

        <!-- Step 2: coloring = the theme creator, taught live. The MOODS here
             are the same LOOKS constant the theme screen uses (one source of
             truth in the CMS) — a card click sets the whole personality. -->
        <div class="wiz-panel" data-panel="1">
          <div class="wiz-teach">🎨 <strong>זהו יוצר ערכת הנושא.</strong> בחרו מראה מוכן — צבעים, פינות וצללים בלחיצה אחת. הכל מחכה לכם אחר כך במסך "ערכת נושא", לשינוי מתי שרוצים.</div>
          <label style="font-weight:600;display:block;margin-bottom:8px">איזה מראה מתאים לאתר שלכם?</label>
          <div class="wiz-palettes" id="wiz-looks"></div>
          <details style="margin-bottom:16px">
            <summary style="cursor:pointer;font-weight:600;color:#475569;font-size:.9rem">כיוונון עדין (לא חובה)</summary>
            <div class="wiz-colors" style="margin-top:10px">
              <label class="wiz-color-row"><input type="color" id="wc-primary" value="#ea580c"> ראשי (כפתורים וקישורים)</label>
              <label class="wiz-color-row"><input type="color" id="wc-text" value="#1c1917"> טקסט</label>
              <label class="wiz-color-row"><input type="color" id="wc-bg" value="#fffbf7"> רקע</label>
              <label class="wiz-color-row"><input type="color" id="wc-lightBg" value="#fdf1e6"> רקע משני</label>
            </div>
          </details>
          <label style="font-weight:600;display:block;margin-bottom:6px">איפה התפריט?</label>
          <select id="wiz-menu-placement" class="wiz-input" style="max-width:220px">
            <option value="top">למעלה (קלאסי)</option>
            <option value="side">בצד</option>
          </select>
          <div class="wiz-preview" id="wiz-preview"></div>
        </div>

        <!-- Step 3: default pages -->
        <div class="wiz-panel" data-panel="2">
          <div class="wiz-teach">📄 ניצור לכם את שלד האתר. כל דף נפתח אחר כך בבונה הדפים — מודולים, גרירה, הכל.</div>
          <label class="wiz-check"><input type="checkbox" checked disabled data-page="home"><span><strong>דף הבית</strong><small>Hero + פתיח — נבנה אוטומטית מהשם שבחרתם</small></span></label>
          <label class="wiz-check"><input type="checkbox" checked data-page="about"><span><strong>אודות</strong><small>מי אתם ולמה אתם כאן</small></span></label>
          <label class="wiz-check"><input type="checkbox" checked data-page="contact"><span><strong>צור קשר</strong><small>דף פנייה — טופס יגיע בשלב ה־CRM</small></span></label>
          <label class="wiz-check"><input type="checkbox" checked data-page="articles"><span><strong>מאמרים</strong><small>קוביות מאמרים חכמות (מודול article-list) + מאמר ראשון לדוגמה</small></span></label>
        </div>

        <!-- Step 4: menu -->
        <div class="wiz-panel" data-panel="3">
          <div class="wiz-teach">🧭 <strong>התפריט של התפריטים.</strong> בחרו מה ייכנס לתפריט הראשי — מהדפים שיצרנו, או קישור לאתר חיצוני.</div>
          <div id="wiz-menu-pages"></div>
          <label style="font-weight:600;display:block;margin:14px 0 6px">קישורים חיצוניים (לא חובה)</label>
          <div class="wiz-ext-row"><input class="wiz-input" id="ext-label-1" placeholder="שם הקישור"><input class="wiz-input" id="ext-url-1" dir="ltr" placeholder="https://..."></div>
          <div class="wiz-ext-row"><input class="wiz-input" id="ext-label-2" placeholder="שם הקישור"><input class="wiz-input" id="ext-url-2" dir="ltr" placeholder="https://..."></div>
        </div>

        <div class="wiz-nav">
          <button type="button" class="btn secondary" id="wiz-back" style="visibility:hidden">→ הקודם</button>
          <button type="button" class="btn" id="wiz-next">הבא ←</button>
        </div>
        <p id="wiz-err" style="color:#b91c1c;font-size:0.85rem;margin:10px 0 0;display:none"></p>
      </div>
    </div>
    <script>window.WIZ_LOOKS = ${JSON.stringify(LOOKS)};</script>
    <script>
      (function () {
        var PAGE_LABELS = { home: 'דף הבית', about: 'אודות', contact: 'צור קשר', articles: 'מאמרים' };
        var selectedLook = 'tapuz'; // the brand default — a site is never colorless
        var step = 0;
        var TOTAL = 4;

        function q(id) { return document.getElementById(id); }
        function colors() {
          return { primary: q('wc-primary').value, text: q('wc-text').value, bg: q('wc-bg').value, lightBg: q('wc-lightBg').value };
        }
        function selectedPages() {
          var out = ['home'];
          document.querySelectorAll('[data-page]').forEach(function (cb) {
            if (cb.dataset.page !== 'home' && cb.checked) out.push(cb.dataset.page);
          });
          return out;
        }

        function lookStyle() {
          var lk = window.WIZ_LOOKS[selectedLook];
          return (lk && lk.overrides && lk.overrides.style) || { radius: 'soft', shadow: 'soft', accent: 'gradient' };
        }
        function renderLooks() {
          var box = q('wiz-looks');
          var keys = Object.keys(window.WIZ_LOOKS);
          box.innerHTML = keys.map(function (key) {
            var lk = window.WIZ_LOOKS[key];
            var c = lk.overrides.colors;
            return '<div class="wiz-palette' + (key === selectedLook ? ' selected' : '') + '" data-look="' + key + '">' +
              '<div style="font-size:1.3rem;line-height:1;margin-bottom:4px">' + (lk.emoji || '🎨') + '</div>' +
              '<div class="sw"><span style="background:' + c.primary + '"></span><span style="background:' + c.secondary + '"></span><span style="background:' + c.bg + ';border:1px solid #e2e8f0"></span><span style="background:' + c.text + '"></span></div>' +
              '<small>' + lk.label + '</small></div>';
          }).join('');
          box.querySelectorAll('[data-look]').forEach(function (el) {
            el.addEventListener('click', function () {
              selectedLook = el.dataset.look;
              var c = window.WIZ_LOOKS[selectedLook].overrides.colors;
              q('wc-primary').value = c.primary; q('wc-text').value = c.text;
              q('wc-bg').value = c.bg; q('wc-lightBg').value = c.lightBg;
              box.querySelectorAll('.wiz-palette').forEach(function (x) { x.classList.remove('selected'); });
              el.classList.add('selected');
              renderPreview();
            });
          });
        }

        function renderPreview() {
          var c = colors();
          var st = lookStyle();
          var lookColors = (window.WIZ_LOOKS[selectedLook] || { overrides: { colors: {} } }).overrides.colors || {};
          var radius = st.radius === 'sharp' ? '4px' : st.radius === 'round' ? '14px' : '8px';
          var btnBg = st.accent === 'gradient'
            ? 'linear-gradient(135deg,' + c.primary + ',' + (lookColors.secondary || c.primary) + ')'
            : c.primary;
          var side = q('wiz-menu-placement').value === 'side';
          var title = (q('wiz-title').value || 'האתר שלי');
          q('wiz-preview').innerHTML =
            '<div style="background:' + c.bg + ';color:' + c.text + ';font-size:12px">' +
            '<div style="display:flex;' + (side ? 'flex-direction:column;align-items:flex-start;gap:4px;' : 'justify-content:space-between;align-items:center;') + 'padding:8px 12px;border-bottom:1px solid ' + c.lightBg + '">' +
            '<strong>' + title.replace(/</g, '&lt;') + '</strong>' +
            '<span style="display:flex;' + (side ? 'flex-direction:column;gap:2px;' : 'gap:10px;') + '">' +
            selectedPages().map(function (p) { return '<span style="color:' + c.primary + '">' + PAGE_LABELS[p] + '</span>'; }).join('') +
            '</span></div>' +
            '<div style="text-align:center;padding:18px 12px;background:' + c.lightBg + '"><div style="font-size:16px;font-weight:800">' + title.replace(/</g, '&lt;') + '</div>' +
            '<span style="display:inline-block;margin-top:8px;background:' + btnBg + ';color:#fff;border-radius:' + radius + ';padding:4px 14px">כפתור ראשי</span></div>' +
            '<div style="display:flex;gap:8px;padding:10px 12px">' +
            '<div style="flex:1;border:1px solid ' + c.lightBg + ';border-radius:8px;overflow:hidden"><div style="height:26px;background:' + c.lightBg + '"></div><div style="padding:6px;font-weight:700">קוביית מאמר</div></div>' +
            '<div style="flex:1;border:1px solid ' + c.lightBg + ';border-radius:8px;overflow:hidden"><div style="height:26px;background:' + c.lightBg + '"></div><div style="padding:6px;font-weight:700">קוביית מאמר</div></div>' +
            '</div></div>';
        }

        function renderMenuStep() {
          q('wiz-menu-pages').innerHTML = selectedPages().map(function (p) {
            return '<label class="wiz-check"><input type="checkbox" checked data-menu-page="' + p + '"><span><strong>' + PAGE_LABELS[p] + '</strong></span></label>';
          }).join('');
        }

        function show(n) {
          step = n;
          document.querySelectorAll('.wiz-panel').forEach(function (el) {
            el.classList.toggle('active', parseInt(el.dataset.panel, 10) === n);
          });
          document.querySelectorAll('.wiz-step-dot').forEach(function (el) {
            var i = parseInt(el.dataset.dot, 10);
            el.classList.toggle('active', i === n);
            el.classList.toggle('done', i < n);
          });
          q('wiz-back').style.visibility = n === 0 ? 'hidden' : 'visible';
          q('wiz-next').textContent = n === TOTAL - 1 ? 'צור את האתר שלי ✨' : 'הבא ←';
          if (n === 1) renderPreview();
          if (n === 3) renderMenuStep();
        }

        function fail(msg) { var e = q('wiz-err'); e.textContent = msg; e.style.display = 'block'; }

        function submit() {
          var menuPages = [];
          document.querySelectorAll('[data-menu-page]').forEach(function (cb) {
            if (cb.checked) menuPages.push(cb.dataset.menuPage);
          });
          var external = [];
          [1, 2].forEach(function (i) {
            var label = q('ext-label-' + i).value.trim();
            var url = q('ext-url-' + i).value.trim();
            if (label && url) external.push({ label: label, url: url });
          });
          q('wiz-next').disabled = true;
          fetch('/admin/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: q('wiz-title').value.trim(),
              description: q('wiz-desc').value.trim(),
              look: selectedLook,
              colors: colors(),
              menuPlacement: q('wiz-menu-placement').value,
              pages: selectedPages(),
              menuPages: menuPages,
              external: external
            })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) { window.location.href = '/admin?built=1'; }
            else { q('wiz-next').disabled = false; fail('שגיאה: ' + (d.error || '')); }
          }).catch(function () { q('wiz-next').disabled = false; fail('שגיאה בתקשורת עם השרת'); });
        }

        q('wiz-next').addEventListener('click', function () {
          q('wiz-err').style.display = 'none';
          if (step === 0 && !q('wiz-title').value.trim()) return fail('צריך שם לאתר כדי להמשיך');
          if (step === TOTAL - 1) return submit();
          show(step + 1);
        });
        q('wiz-back').addEventListener('click', function () { if (step > 0) show(step - 1); });
        ['wc-primary', 'wc-text', 'wc-bg', 'wc-lightBg'].forEach(function (id) {
          q(id).addEventListener('input', renderPreview);
        });
        q('wiz-menu-placement').addEventListener('change', renderPreview);
        document.querySelectorAll('[data-page]').forEach(function (cb) {
          cb.addEventListener('change', renderPreview);
        });

        renderLooks();
        show(0);
      })();
    </script>
  `;
  res.send(layout(html, 'התקנה ראשונית', '#f59e0b'));
});

app.post('/admin/setup', (req, res) => {
  try {
    if (!needsSetup()) return res.status(409).json({ ok: false, error: 'ההתקנה כבר בוצעה' });
    const result = runSetup(req.body || {});
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/admin', (req, res) => {
  if (needsSetup()) return res.redirect('/admin/setup');
  const pages = listPages();
  const msg = req.query.built
    ? `<div style="background:#ecfdf5;border:1px solid #10b981;padding:16px 18px;border-radius:12px;margin-bottom:16px;">
         <div style="color:#166534;font-weight:700;margin-bottom:10px">🎉 האתר שלכם חי! מה עכשיו?</div>
         <div style="display:flex;gap:10px;flex-wrap:wrap">
           <a href="/" target="_blank" class="btn" style="background:#166534;border-color:#166534">👀 צפו באתר</a>
           <a href="/admin/edit/home" class="btn secondary">✏️ ערכו את דף הבית</a>
           <a href="/admin/theme" class="btn secondary">🎨 שחקו עם המראה</a>
         </div>
       </div>`
    : '';

  let listHtml = pages.length === 0
    ? `<div style="padding:40px;text-align:center;color:#64748b">אין דפים עדיין</div>`
    : pages.map(p => {
      const badge = p.status === 'published'
        ? '<span style="background:#dcfce7;color:#166534;font-size:0.75rem;padding:2px 8px;border-radius:999px">פורסם</span>'
        : '<span style="background:#fef3c7;color:#92400e;font-size:0.75rem;padding:2px 8px;border-radius:999px">טיוטה</span>';
      const dirty = p.has_unpublished
        ? '<span style="color:#b45309;font-size:0.75rem;margin-inline-start:6px">• שינויים לא פורסמו</span>'
        : '';
      const updated = p.updated_at
        ? `<span style="font-size:0.78rem;color:#94a3b8;margin-inline-start:10px">עודכן: ${String(p.updated_at).replace('T', ' ').slice(0, 16)}</span>`
        : '';
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;background:white">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <strong>${p.title}</strong>${badge}${dirty}
          </div>
          <span style="font-family:monospace;font-size:0.85rem;color:#64748b">/${p.full_path}</span>${updated}
        </div>
        <div style="display:flex;gap:8px">
          <a href="/admin/edit/${encodeURIComponent(p.full_path)}" class="btn" style="padding:8px 16px">ערוך</a>
          <form method="POST" action="/admin/delete" onsubmit="return confirm('למחוק?')">
            <input type="hidden" name="full_path" value="${p.full_path}">
            <button type="submit" class="btn secondary" style="padding:8px 14px">מחק</button>
          </form>
        </div>
      </div>`;
    }).join('');

  const html = `
    ${adminNav('pages', 'דפים', '<a href="/admin/new" class="btn">+ דף חדש</a>')}
    <div class="container" style="padding-top:30px">
      ${msg}
      ${listHtml}
    </div>
  `;
  res.send(layout(html));
});

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

// ======================== DASHBOARD ========================
app.get('/admin/dashboard', (req, res) => {
  if (needsSetup()) return res.redirect('/admin/setup');
  const pages = listPages();
  const published = pages.filter(p => p.status === 'published').length;
  const drafts = pages.length - published;
  const pending = pages.filter(p => p.has_unpublished).length;
  let mediaCount = 0;
  try {
    mediaCount = require('./db').db.prepare('SELECT COUNT(*) AS c FROM media').get().c;
  } catch (e) { /* media table may not exist yet */ }

  const statCard = (num, label, color) => `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;text-align:center">
      <div style="font-size:2rem;font-weight:800;color:${color}">${num}</div>
      <div style="color:#64748b;font-size:0.9rem;margin-top:4px">${label}</div>
    </div>`;

  const recent = pages.slice(0, 5).map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;background:#fff">
      <div>
        <strong>${escapeAdmin(p.title)}</strong>
        <span style="font-size:0.75rem;color:#94a3b8;margin-inline-start:8px">${String(p.updated_at || '').replace('T', ' ').slice(0, 16)}</span>
      </div>
      <a href="/admin/edit/${encodeURIComponent(p.full_path)}" class="btn" style="padding:6px 14px">ערוך</a>
    </div>`).join('') || '<p style="color:#64748b">אין דפים עדיין</p>';

  const html = `
    ${adminNav('dashboard', 'דשבורד', '<a href="/admin/new" class="btn">+ דף חדש</a>')}
    <div class="container" style="padding-top:28px;max-width:960px;padding-bottom:60px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:26px">
        ${statCard(pages.length, 'דפים', '#0a66c2')}
        ${statCard(published, 'פורסמו', '#166534')}
        ${statCard(drafts, 'טיוטות', '#b45309')}
        ${statCard(pending, 'שינויים ממתינים לפרסום', '#7c3aed')}
        ${statCard(mediaCount, 'קבצי מדיה', '#0f766e')}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
        <section>
          <h3 style="margin-top:0">דפים אחרונים</h3>
          ${recent}
        </section>
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;height:fit-content">
          <h3 style="margin-top:0">קיצורי דרך</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="/admin/new" class="btn">+ דף חדש</a>
            <a href="/admin/media-library" class="btn secondary">ספריית מדיה</a>
            <a href="/admin/theme" class="btn secondary">ערכת נושא</a>
            <a href="/admin/integrations" class="btn secondary">אינטגרציות (WhatsApp, מפות)</a>
            <a href="/admin/seo" class="btn secondary">הגדרות SEO</a>
            <form method="POST" action="/admin/build-redirect" style="margin:0">
              <button type="submit" class="btn" style="background:#166534;width:100%">בנה את האתר</button>
            </form>
          </div>
        </section>
      </div>
    </div>
  `;
  res.send(layout(html, 'דשבורד', '#0a66c2'));
});

app.post('/admin/build-redirect', (req, res) => {
  try {
    exportAll();
    res.redirect('/admin/dashboard');
  } catch (e) {
    res.status(500).send('שגיאה בבנייה: ' + escapeAdmin(e.message));
  }
});

/** Minimal HTML-escape for admin templates (real entities, unlike legacy no-op helpers). */
function escapeAdmin(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ======================== MEDIA LIBRARY (standalone screen) ========================
app.get('/admin/media-library', (req, res) => {
  const html = `
    ${adminNav('media', 'ספריית מדיה')}
    <div class="container" style="padding-top:28px;max-width:960px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">כל התמונות והקבצים של האתר — תיקיות, העלאה ומחיקה. אותה ספרייה שמופיעה בבונה הדפים.</p>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <div id="ml-crumbs" style="font-size:0.95rem;color:#334155"></div>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn secondary" id="ml-new-folder">📁+ תיקייה</button>
            <label class="btn" style="cursor:pointer">העלה קובץ
              <input type="file" accept="image/*" id="ml-upload" style="display:none">
            </label>
          </div>
        </div>
        <div id="ml-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px"></div>
      </div>
    </div>
    <script>
      (function () {
        var folder = '';
        function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
        function load(f) {
          folder = f || '';
          fetch('/admin/media?folder=' + encodeURIComponent(folder))
            .then(function (r) { return r.json(); })
            .then(render)
            .catch(function () {
              document.getElementById('ml-grid').innerHTML = '<div style="color:#b91c1c">שגיאה בטעינה</div>';
            });
        }
        function render(data) {
          var crumbs = '<span class="ml-crumb" data-goto="" style="cursor:pointer;color:#0a66c2">🏠 מדיה</span>';
          var acc = '';
          (folder ? folder.split('/') : []).forEach(function (seg) {
            acc = acc ? acc + '/' + seg : seg;
            crumbs += ' › <span class="ml-crumb" data-goto="' + esc(acc) + '" style="cursor:pointer;color:#0a66c2">' + esc(seg) + '</span>';
          });
          document.getElementById('ml-crumbs').innerHTML = crumbs;

          var tiles = '';
          (data.folders || []).forEach(function (f) {
            tiles += '<div class="media-tile" data-folder="' + esc(f.path) + '" style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;cursor:pointer;text-align:center;background:#fff">' +
              '<div style="font-size:2.4rem;line-height:70px;height:70px">📁</div>' +
              '<div style="font-size:0.8rem;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(f.name) + '</div></div>';
          });
          (data.files || []).forEach(function (f) {
            tiles += '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:8px;text-align:center;background:#fff">' +
              '<img src="' + esc(f.url) + '" alt="" loading="lazy" style="width:100%;height:88px;object-fit:cover;border-radius:6px">' +
              '<div style="font-size:0.75rem;color:#475569;margin:5px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
              '<div style="display:flex;gap:4px;justify-content:center">' +
              '<button type="button" data-copy="' + esc(f.url) + '" style="border:1px solid #e2e8f0;background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:0.75rem">🔗 העתק</button>' +
              '<button type="button" data-del="' + esc(String(f.id)) + '" data-name="' + esc(f.name) + '" style="border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:0.75rem">🗑</button>' +
              '</div></div>';
          });
          var grid = document.getElementById('ml-grid');
          grid.innerHTML = tiles || '<div style="grid-column:1/-1;color:#64748b;padding:26px;text-align:center">תיקייה ריקה — העלה קובץ או צור תיקייה</div>';

          document.querySelectorAll('.ml-crumb').forEach(function (c) {
            c.addEventListener('click', function () { load(c.dataset.goto); });
          });
          grid.querySelectorAll('[data-folder]').forEach(function (t) {
            t.addEventListener('click', function () { load(t.dataset.folder); });
          });
          grid.querySelectorAll('[data-copy]').forEach(function (b) {
            b.addEventListener('click', function () {
              if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy);
              b.textContent = 'הועתק ✓';
              setTimeout(function () { b.textContent = '🔗 העתק'; }, 1400);
            });
          });
          grid.querySelectorAll('[data-del]').forEach(function (b) {
            b.addEventListener('click', function () {
              if (!confirm('למחוק את "' + b.dataset.name + '" לצמיתות?')) return;
              fetch('/admin/media/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: parseInt(b.dataset.del, 10) })
              }).then(function (r) { return r.json(); }).then(function (d) {
                if (d.ok) load(folder); else alert(d.error || 'שגיאה');
              });
            });
          });
        }
        document.getElementById('ml-new-folder').addEventListener('click', function () {
          var name = prompt('שם התיקייה החדשה:');
          if (!name) return;
          fetch('/admin/media/folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent: folder, name: name })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) load(folder); else alert(d.error || 'שגיאה');
          });
        });
        document.getElementById('ml-upload').addEventListener('change', function () {
          var input = this;
          if (!input.files || !input.files.length) return;
          var file = input.files[0];
          var reader = new FileReader();
          reader.onload = function () {
            fetch('/admin/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: file.name, data: reader.result, folder: folder })
            }).then(function (r) { return r.json(); }).then(function (d) {
              input.value = '';
              if (d.ok) load(folder); else alert(d.error || 'שגיאה בהעלאה');
            });
          };
          reader.readAsDataURL(file);
        });
        load('');
      })();
    </script>
  `;
  res.send(layout(html, 'ספריית מדיה', '#0f766e'));
});

// ======================== STORAGE (your files on disk) ========================
// The file-first selling point made visible: the user's real files on disk.
app.get('/admin/api/storage', (req, res) => {
  try {
    res.json({ ok: true, ...require('./storage-view').listStorage() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/admin/storage', (req, res) => {
  const store = require('./storage-view').listStorage();
  const kb = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  const when = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  };
  const diskBadge = (p) =>
    `<code style="font-size:0.72rem;background:#f1f5f9;color:#475569;padding:1px 6px;border-radius:5px;direction:ltr;display:inline-block">${escapeAdmin(p)}</code>`;

  const pageCards = store.pages.length
    ? store.pages.map((p) => {
        const badges =
          (p.published ? '<span style="background:#dcfce7;color:#166534;font-size:0.68rem;padding:1px 7px;border-radius:999px">מפורסם</span>' : '') +
          (p.draft ? ' <span style="background:#fef3c7;color:#92400e;font-size:0.68rem;padding:1px 7px;border-radius:999px">טיוטה</span>' : '');
        return `<a href="/admin/edit/${encodeURIComponent(p.slug)}" class="stg-card">` +
          `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong style="font-size:0.95rem">${escapeAdmin(p.slug)}</strong><span>${badges}</span></div>` +
          `<div style="margin:6px 0">${diskBadge(p.diskPath)}</div>` +
          `<div style="font-size:0.75rem;color:#94a3b8">${kb(p.size)} · ${escapeAdmin(when(p.mtime))}</div></a>`;
      }).join('')
    : '<div class="stg-empty">אין דפים עדיין — <a href="/admin/new">צור דף</a>.</div>';

  const mediaCards = store.media.length
    ? store.media.map((m) =>
        `<div class="stg-card" style="text-align:center">` +
        `<img src="${escapeAdmin(m.url)}" alt="" loading="lazy" style="width:100%;height:82px;object-fit:cover;border-radius:6px">` +
        `<div style="font-size:0.73rem;color:#475569;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAdmin(m.name)}">${escapeAdmin(m.name)}</div></div>`
      ).join('')
    : '<div class="stg-empty">אין קבצי מדיה. העלה ב<a href="/admin/media-library">ספריית המדיה</a>.</div>';

  const dataCards = store.siteData.length
    ? store.siteData.map((f) =>
        `<div class="stg-card"><strong style="font-size:0.9rem">🗂 ${escapeAdmin(f.name)}</strong>` +
        `<div style="margin:6px 0">${diskBadge(f.diskPath)}</div>` +
        `<div style="font-size:0.75rem;color:#94a3b8">${kb(f.size)} · ${escapeAdmin(when(f.mtime))}</div></div>`
      ).join('')
    : '<div class="stg-empty">—</div>';

  const html = `
    <style>
      .stg-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin:10px 0 26px }
      .stg-card { display:block;border:1px solid #e2e8f0;border-radius:11px;padding:13px 14px;background:#fff;text-decoration:none;color:#0f172a }
      a.stg-card:hover { border-color:#0a66c2;box-shadow:0 2px 10px rgba(10,102,194,.08) }
      .stg-sec { display:flex;align-items:center;gap:9px;margin:8px 0 2px;font-weight:700;font-size:1.05rem }
      .stg-sec .n { background:#eef2f7;color:#475569;font-size:0.78rem;font-weight:600;padding:1px 9px;border-radius:999px }
      .stg-empty { color:#94a3b8;padding:16px;border:1px dashed #e2e8f0;border-radius:10px;background:#fff }
    </style>
    ${adminNav('storage', 'אחסון')}
    <div class="container" style="padding-top:28px;max-width:1000px;padding-bottom:60px">
      <div style="background:linear-gradient(135deg,#0f766e,#0a66c2);color:#fff;border-radius:14px;padding:18px 22px;margin-bottom:20px">
        <div style="font-size:1.25rem;font-weight:700;margin-bottom:4px">🗄️ התוכן שלך — קבצים אמיתיים על הדיסק</div>
        <div style="opacity:.92;font-size:0.9rem;line-height:1.5">אין מסד נתונים סגור ואין נעילה. כל דף הוא קובץ <code style="direction:ltr">.pzn</code> אמיתי בתיקייה שלך — אתה הבעלים. זו העוצמה של Tapuziel: התוכן נייד, קריא, ושלך.</div>
        <div style="margin-top:8px;font-size:0.8rem;opacity:.85;direction:ltr">📁 ${escapeAdmin(store.root)}</div>
      </div>

      <div class="stg-sec">📄 דפים <span class="n">${store.counts.pages}</span></div>
      <div class="stg-grid">${pageCards}</div>

      <div class="stg-sec">🖼️ מדיה <span class="n">${store.counts.media}</span></div>
      <div class="stg-grid">${mediaCards}</div>

      <div class="stg-sec">🗂️ נתוני אתר <span class="n">${store.counts.siteData}</span></div>
      <div class="stg-grid">${dataCards}</div>
    </div>
  `;
  res.send(layout(html, 'אחסון', '#0f766e'));
});

// ======================== CATEGORIES (v0.64 — the taxonomy, on file storage) ==
// A category = a first-class tag with metadata. The list lives on disk in
// content/categories.json (visible in the Storage section); membership rides
// on each page's portable tags. The screen edits the list as one document
// (like the menus editor) and POSTs the whole array.
app.get('/admin/api/categories', (req, res) => {
  try {
    res.json({ ok: true, categories: require('./categories').listCategories() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/categories', (req, res) => {
  try {
    const saved = require('./categories').saveCategories((req.body && req.body.categories) || []);
    res.json({ ok: true, categories: saved });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/admin/categories', (req, res) => {
  const html = `
    <style>
      .cat-row { display:grid;grid-template-columns:110px 1fr 52px 1fr 34px;gap:8px;align-items:center;margin-bottom:8px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px }
      .cat-row input[type=text] { width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:7px;box-sizing:border-box }
      .cat-row input[type=color] { width:44px;height:34px;border:1px solid #cbd5e1;border-radius:7px;padding:2px }
      .cat-row .cat-del { border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:7px;padding:6px 0;cursor:pointer }
      .cat-desc { grid-column: 1 / -1; }
      .cat-head { display:grid;grid-template-columns:110px 1fr 52px 1fr 34px;gap:8px;font-size:0.75rem;font-weight:700;color:#64748b;padding:0 10px;margin-bottom:4px }
    </style>
    ${adminNav('categories', 'קטגוריות')}
    <div class="container" style="padding-top:28px;max-width:820px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">קטגוריה = תגית מנוהלת עם מיתוג (שם, צבע, תמונה, תיאור). משייכים דפים לקטגוריה במאפייני הדף בבונה, ומציגים אותה בכל דף עם בלוק "קטגוריה". הרשימה נשמרת כקובץ <code style="direction:ltr">content/categories.json</code> — <a href="/admin/storage">רואים אותו באחסון</a>.</p>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px">
        <div class="cat-head"><span>slug</span><span>שם תצוגה</span><span>צבע</span><span>תמונת רקע (URL)</span><span></span></div>
        <div id="cat-list"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
          <button type="button" class="btn secondary" id="cat-add">+ קטגוריה</button>
          <div style="display:flex;gap:10px;align-items:center">
            <span id="cat-status" style="color:#166534;font-size:0.85rem"></span>
            <button type="button" class="btn" id="cat-save">שמור</button>
          </div>
        </div>
      </div>
    </div>
    <script>
      (function () {
        var cats = [];
        function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
        function isHex(v) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')); }
        function render() {
          document.getElementById('cat-list').innerHTML = cats.map(function (c, i) {
            return '<div class="cat-row" data-i="' + i + '">' +
              '<input type="text" data-k="slug" dir="ltr" value="' + esc(c.slug) + '" placeholder="news">' +
              '<input type="text" data-k="name" value="' + esc(c.name) + '" placeholder="חדשות">' +
              '<input type="color" data-k="color" value="' + (isHex(c.color) ? esc(c.color) : '#0a66c2') + '">' +
              '<input type="text" data-k="image" dir="ltr" value="' + esc(c.image) + '" placeholder="/assets/... (לא חובה)">' +
              '<button type="button" class="cat-del" title="הסר">×</button>' +
              '<input type="text" data-k="description" class="cat-desc" value="' + esc(c.description) + '" placeholder="תיאור קצר (לא חובה)">' +
              '</div>';
          }).join('') || '<div style="color:#94a3b8;padding:14px;text-align:center">אין קטגוריות עדיין — הוסיפו את הראשונה</div>';
        }
        function collect() {
          cats = [].map.call(document.querySelectorAll('.cat-row'), function (row) {
            var c = {};
            row.querySelectorAll('[data-k]').forEach(function (inp) { c[inp.dataset.k] = inp.value; });
            return c;
          });
        }
        document.getElementById('cat-list').addEventListener('click', function (e) {
          if (!e.target.classList.contains('cat-del')) return;
          collect();
          cats.splice(parseInt(e.target.closest('.cat-row').dataset.i, 10), 1);
          render();
        });
        document.getElementById('cat-add').addEventListener('click', function () {
          collect(); cats.push({ slug: '', name: '', color: '#0a66c2', image: '', description: '' }); render();
        });
        document.getElementById('cat-save').addEventListener('click', function () {
          collect();
          fetch('/admin/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: cats })
          }).then(function (r) { return r.json(); }).then(function (d) {
            var st = document.getElementById('cat-status');
            if (d.ok) { cats = d.categories; render(); st.textContent = 'נשמר ✓'; setTimeout(function () { st.textContent = ''; }, 2500); }
            else { st.style.color = '#b91c1c'; st.textContent = d.error || 'שגיאה'; }
          });
        });
        fetch('/admin/api/categories').then(function (r) { return r.json(); }).then(function (d) {
          cats = (d && d.categories) || []; render();
        }).catch(function () { render(); });
      })();
    </script>
  `;
  res.send(layout(html, 'קטגוריות', '#0f766e'));
});

// ======================== SITE SETTINGS ========================
app.get('/admin/settings', (req, res) => {
  const config = loadConfig();
  const html = `
    ${adminNav('settings', 'הגדרות אתר')}
    <div class="container" style="padding-top:28px;max-width:620px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">הגדרות כלליות של האתר. לוגו וצבעים נמצאים ב<a href="/admin/theme">ערכת הנושא</a>.</p>
      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px">
        <label style="display:block;font-weight:600;margin-bottom:4px">שם האתר</label>
        <input id="st-title" value="${escapeAdmin(config.title)}" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px;box-sizing:border-box">
        <label style="display:block;font-weight:600;margin-bottom:4px">תיאור האתר</label>
        <textarea id="st-desc" rows="2" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px;box-sizing:border-box">${escapeAdmin(config.description)}</textarea>
        <label style="display:block;font-weight:600;margin-bottom:4px">כתובת בסיס (baseUrl)</label>
        <input id="st-baseurl" dir="ltr" value="${escapeAdmin(config.baseUrl || '')}" placeholder="https://example.co.il" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px;box-sizing:border-box">
        <label style="display:block;font-weight:600;margin-bottom:4px">שפה ראשית</label>
        <select id="st-lang" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px">
          <option value="he" ${config.language !== 'en' ? 'selected' : ''}>עברית</option>
          <option value="en" ${config.language === 'en' ? 'selected' : ''}>English</option>
        </select>
        <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
          <span id="st-status" style="color:#166534;font-size:0.85rem"></span>
          <button type="button" class="btn" id="st-save">שמור הגדרות</button>
        </div>
      </section>
    </div>
    <script>
      document.getElementById('st-save').addEventListener('click', function () {
        fetch('/admin/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: document.getElementById('st-title').value,
            description: document.getElementById('st-desc').value,
            baseUrl: document.getElementById('st-baseurl').value,
            language: document.getElementById('st-lang').value
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          document.getElementById('st-status').textContent = d.ok ? 'נשמר ✓' : (d.error || 'שגיאה');
        });
      });
    </script>
  `;
  res.send(layout(html, 'הגדרות אתר', '#475569'));
});

app.post('/admin/api/settings', (req, res) => {
  try {
    const config = loadConfig();
    const b = req.body || {};
    if (b.title !== undefined) config.title = String(b.title || '').trim() || config.title;
    if (b.description !== undefined) config.description = String(b.description || '');
    if (b.baseUrl !== undefined) config.baseUrl = String(b.baseUrl || '').trim();
    if (b.language !== undefined) config.language = b.language === 'en' ? 'en' : 'he';
    saveConfig(config);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ======================== SEO SETTINGS ========================
app.get('/admin/seo', (req, res) => {
  const config = loadConfig();
  const seo = config.seo || {};
  const html = `
    ${adminNav('seo', 'SEO')}
    <div class="container" style="padding-top:28px;max-width:620px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">ברירות מחדל לכל האתר. לכל דף יש הגדרות SEO משלו — בבונה הדפים, לחיצה על רקע הקנבס פותחת את מאפייני הדף (כותרת, תיאור, og:image, אינדוקס).</p>
      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px">
        <label style="display:block;font-weight:600;margin-bottom:4px">תבנית כותרת (title pattern)</label>
        <input id="seo-pattern" dir="ltr" value="${escapeAdmin(seo.titlePattern || '')}" placeholder="{page} · {site}" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px;box-sizing:border-box">
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:14px">‎{page}‎ = כותרת הדף · ‎{site}‎ = שם האתר · ריק = כותרת הדף בלבד</div>
        <label style="display:block;font-weight:600;margin-bottom:4px">תיאור ברירת מחדל (meta description)</label>
        <textarea id="seo-desc" rows="2" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px;box-sizing:border-box">${escapeAdmin(config.description)}</textarea>
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:14px">משמש כשלדף אין תיאור משלו</div>
        <label style="display:block;font-weight:600;margin-bottom:4px">תמונת שיתוף ברירת מחדל (og:image)</label>
        <div style="display:flex;gap:8px;margin-bottom:6px">
          <input id="seo-og" dir="ltr" value="${escapeAdmin(seo.defaultOgImage || '')}" placeholder="בחרו מהספרייה ←" style="flex:1;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box">
          <button type="button" class="btn secondary" data-media-pick="seo-og" style="white-space:nowrap">🖼 בחר / העלה</button>
        </div>
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:14px">התמונה שתופיע בשיתוף ברשתות כשלדף אין תמונה משלו.</div>
        <label style="display:block;font-weight:600;margin-bottom:4px">כתובת האתר (base URL)</label>
        <input id="seo-base" dir="ltr" value="${escapeAdmin(config.baseUrl || '')}" placeholder="https://www.example.co.il" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px;box-sizing:border-box">
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:14px">מפעיל canonical / og:url / נתונים מובנים (JSON-LD) עם כתובות מלאות, וקובע את הכתובות ב-sitemap.xml. ריק = מדלגים על תגיות שדורשות כתובת מלאה.</div>
        <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
          <span id="seo-status" style="color:#166534;font-size:0.85rem"></span>
          <button type="button" class="btn" id="seo-save">שמור SEO</button>
        </div>
      </section>
    </div>
    <script src="/admin-media-picker.js"></script>
    <script>
      document.getElementById('seo-save').addEventListener('click', function () {
        fetch('/admin/api/seo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titlePattern: document.getElementById('seo-pattern').value,
            description: document.getElementById('seo-desc').value,
            defaultOgImage: document.getElementById('seo-og').value,
            baseUrl: document.getElementById('seo-base').value
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          document.getElementById('seo-status').textContent = d.ok ? 'נשמר ✓' : (d.error || 'שגיאה');
        });
      });
    </script>
  `;
  res.send(layout(html, 'SEO', '#b45309'));
});

app.get('/admin/api/seo', (req, res) => {
  try {
    const config = loadConfig();
    res.json({ ok: true, seo: config.seo || {}, description: config.description || '', baseUrl: config.baseUrl || '' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/seo', (req, res) => {
  try {
    const config = loadConfig();
    const b = req.body || {};
    config.seo = config.seo || {};
    if (b.titlePattern !== undefined) config.seo.titlePattern = String(b.titlePattern || '');
    if (b.defaultOgImage !== undefined) config.seo.defaultOgImage = String(b.defaultOgImage || '');
    if (b.description !== undefined) config.description = String(b.description || '');
    // site base URL (v0.71): powers canonical/og:url/JSON-LD absolute URLs +
    // sitemap <loc>. Stored at config level (robots/sitemap already read it).
    // Forgiving: a schemeless domain gets https:// ; anything unparseable is
    // rejected — a broken base would corrupt canonicals sitewide.
    if (b.baseUrl !== undefined) {
      const raw = String(b.baseUrl || '').trim();
      if (!raw) {
        config.baseUrl = '';
      } else {
        let u;
        try { u = new URL(raw.includes('://') ? raw : 'https://' + raw); } catch (e) { u = null; }
        if (!u || !/^https?:$/.test(u.protocol)) {
          return res.status(400).json({ ok: false, error: 'כתובת האתר אינה תקינה — צורה תקינה: https://www.example.co.il' });
        }
        config.baseUrl = (u.origin + u.pathname).replace(/\/+$/, '');
      }
    }
    saveConfig(config);
    res.json({ ok: true, seo: config.seo });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ======================== INTEGRATIONS ========================
app.get('/admin/integrations', (req, res) => {
  const config = loadConfig();
  const wa = (config.integrations && config.integrations.whatsapp) || {};
  const an = config.analytics || {};
  const ga4 = an.ga4 || {};
  const fp = an.firstParty || {};
  const gda = an.gaDataApi || {};
  const html = `
    ${adminNav('integrations', 'אינטגרציות')}
    <div class="container" style="padding-top:28px;max-width:620px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">חיבורים מוכנים — בלי לכתוב HTML. מודול המפה (Google Maps) נמצא בארגז הכלים של בונה הדפים.</p>

      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px;margin-bottom:18px">
        <h3 style="margin-top:0;display:flex;align-items:center;gap:8px">💬 WhatsApp — כפתור צ׳אט צף</h3>
        <p style="color:#64748b;font-size:0.9rem;margin-top:0">כפתור ירוק צף שמופיע בכל דפי האתר הציבורי ופותח שיחת WhatsApp. לא מופיע בממשק הניהול.</p>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:14px">
          <input type="checkbox" id="wa-enabled" ${wa.enabled ? 'checked' : ''}> הפעל את הכפתור באתר
        </label>
        <label style="display:block;font-weight:600;margin-bottom:4px">מספר טלפון (בפורמט בינלאומי)</label>
        <input id="wa-phone" dir="ltr" value="${escapeAdmin(wa.phone || '')}" placeholder="972501234567" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px;box-sizing:border-box">
        <label style="display:block;font-weight:600;margin-bottom:4px">הודעה פותחת (לא חובה)</label>
        <input id="wa-message" value="${escapeAdmin(wa.message || '')}" placeholder="היי! הגעתי מהאתר" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px;box-sizing:border-box">
        <label style="display:block;font-weight:600;margin-bottom:4px">מיקום הכפתור</label>
        <select id="wa-position" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px">
          <option value="start" ${wa.position !== 'end' ? 'selected' : ''}>התחלה (ימין בדף עברי)</option>
          <option value="end" ${wa.position === 'end' ? 'selected' : ''}>סוף (שמאל בדף עברי)</option>
        </select>
        <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
          <span id="int-status" style="color:#166534;font-size:0.85rem"></span>
          <button type="button" class="btn" id="int-save">שמור אינטגרציות</button>
        </div>
        <div style="font-size:0.8rem;color:#94a3b8;margin-top:10px">השינוי נכנס לתוקף באתר אחרי "בנה אתר" (או פרסום + בנייה מהבונה).</div>
      </section>

      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px;margin-bottom:18px">
        <h3 style="margin-top:0;display:flex;align-items:center;gap:8px">📍 Google Maps — מודול מפה</h3>
        <p style="color:#64748b;font-size:0.9rem;margin:0">זמין בארגז הכלים של בונה הדפים (קטגוריית "שילובים"): כתובת + זום + גובה — בלי מפתח API ובלי קוד. <a href="/admin">פתח דף לעריכה</a> וגרור את מודול "מפה".</p>
      </section>

      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px;margin-bottom:18px">
        <h3 style="margin-top:0;display:flex;align-items:center;gap:8px">📊 Google Analytics 4</h3>
        <p style="color:#64748b;font-size:0.9rem;margin-top:0">מזהה מדידה (Measurement ID) בפורמט <code dir="ltr">G-XXXXXXXXXX</code>. הוא ציבורי (לא סוד), ומוזרק לכל דפי האתר הציבורי — כך Google אוסף נתונים. השינוי נכנס לתוקף אחרי "בנה אתר".</p>
        <label style="display:block;font-weight:600;margin-bottom:4px">Measurement ID</label>
        <input id="ga4-id" dir="ltr" value="${escapeAdmin(ga4.measurementId || '')}" placeholder="G-XXXXXXXXXX" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px;box-sizing:border-box">
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:4px">להשארה ריק — לא מוזרק שום קוד מעקב.</div>
      </section>

      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px;margin-bottom:18px">
        <h3 style="margin-top:0;display:flex;align-items:center;gap:8px">🔒 אנליטיקס פנימי (Tapuz)</h3>
        <p style="color:#64748b;font-size:0.9rem;margin-top:0">איסוף סטטיסטיקות פרטי, ללא צד שלישי, ללא שמירת כתובות IP. הצפייה בנתונים: <a href="/admin/analytics">לוח האנליטיקס</a>.</p>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:14px">
          <input type="checkbox" id="fp-enabled" ${fp.enabled ? 'checked' : ''}> הפעל איסוף פנימי
        </label>
        <label style="display:block;font-weight:600;margin-bottom:4px">כתובת האספן (Collector URL)</label>
        <input id="fp-url" dir="ltr" value="${escapeAdmin(fp.collectorUrl || '/_tapuz/collect')}" placeholder="/_tapuz/collect" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px;box-sizing:border-box">
        <div class="chat-float-notice" style="margin-top:6px">שים לב: איסוף פנימי עובד רק כשהאתר מוגש על-ידי שרת Tapuz פעיל. אם ייצאת אתר סטטי ומארח אותו במקום אחר (Netlify / S3 / nginx), חובה להזין כאן כתובת <b>מלאה</b> לשרת Tapuz פעיל — אחרת האיסוף הפנימי לא ירשום דבר (Google Analytics ימשיך לעבוד). פרטים: <code dir="ltr">docs/analytics.md</code>.</div>
      </section>

      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px;margin-bottom:18px;opacity:0.8">
        <h3 style="margin-top:0;display:flex;align-items:center;gap:8px">📥 קריאת נתוני GA בחזרה (GA Data API) <span style="font-size:0.7rem;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:999px">לא פעיל</span></h3>
        <p style="color:#64748b;font-size:0.9rem;margin:0 0 10px">שאיבת הסטטיסטיקות מ-Google אל תוך Tapuz דורשת סוד: קובץ JSON של Service Account, מזהה Property מספרי, והתקנת התלות <code dir="ltr">@google-analytics/data</code>. Tapuz לא מטפל בסוד הזה עבורך — יש להזין נתיב לקובץ ששמור <b>מחוץ</b> לתיקיית האתר/הייצוא. מדריך מלא: <code dir="ltr">docs/analytics.md</code>.</p>
        <label style="display:block;font-weight:600;margin-bottom:4px">Property ID (מספרי)</label>
        <input id="gda-prop" dir="ltr" value="${escapeAdmin(gda.propertyId || '')}" placeholder="123456789" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box">
        <label style="display:block;font-weight:600;margin-bottom:4px">נתיב לקובץ Service Account JSON</label>
        <input id="gda-path" dir="ltr" value="${escapeAdmin(gda.serviceAccountPath || '')}" placeholder="/secure/ga-service-account.json" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:10px;box-sizing:border-box">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600">
          <input type="checkbox" id="gda-enabled" ${gda.enabled ? 'checked' : ''}> אפשר קריאה בחזרה (ידרוש התקנת התלות)
        </label>
        <div style="font-size:0.8rem;color:#94a3b8;margin-top:8px">גם כשמסומן — אין קוד פעיל שמעביר את הסוד. זהו שלד מתועד בלבד (ראה <code dir="ltr">src/ga-data.js</code>).</div>
      </section>
    </div>
    <script>
      document.getElementById('int-save').addEventListener('click', function () {
        fetch('/admin/api/integrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            whatsapp: {
              enabled: document.getElementById('wa-enabled').checked,
              phone: document.getElementById('wa-phone').value,
              message: document.getElementById('wa-message').value,
              position: document.getElementById('wa-position').value
            },
            analytics: {
              ga4: { measurementId: document.getElementById('ga4-id').value },
              firstParty: {
                enabled: document.getElementById('fp-enabled').checked,
                collectorUrl: document.getElementById('fp-url').value
              },
              gaDataApi: {
                enabled: document.getElementById('gda-enabled').checked,
                propertyId: document.getElementById('gda-prop').value,
                serviceAccountPath: document.getElementById('gda-path').value
              }
            }
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          document.getElementById('int-status').textContent = d.ok ? 'נשמר ✓' : (d.error || 'שגיאה');
        });
      });
    </script>
  `;
  res.send(layout(html, 'אינטגרציות', '#25D366'));
});

app.get('/admin/api/integrations', (req, res) => {
  try {
    res.json({ ok: true, integrations: loadConfig().integrations || {} });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/integrations', (req, res) => {
  try {
    const config = loadConfig();
    const b = req.body || {};
    config.integrations = config.integrations || {};
    if (b.whatsapp && typeof b.whatsapp === 'object') {
      const prev = config.integrations.whatsapp || {};
      config.integrations.whatsapp = {
        enabled: !!b.whatsapp.enabled,
        phone: b.whatsapp.phone !== undefined ? String(b.whatsapp.phone || '').trim() : (prev.phone || ''),
        message: b.whatsapp.message !== undefined ? String(b.whatsapp.message || '') : (prev.message || ''),
        position: b.whatsapp.position === 'end' ? 'end' : 'start'
      };
    }
    // Analytics (S5/S6). No secrets are handled here — only public-safe config.
    // The GA Measurement ID is validated to the strict G-XXXX shape (empty is
    // allowed = no tracking). The service-account key itself is NEVER accepted
    // over this endpoint — only a filesystem PATH the user manages out-of-band.
    if (b.analytics && typeof b.analytics === 'object') {
      config.analytics = config.analytics || {};
      const a = b.analytics;
      if (a.ga4 && typeof a.ga4 === 'object' && a.ga4.measurementId !== undefined) {
        const raw = String(a.ga4.measurementId || '').trim();
        // Accept a valid id or clear it; reject malformed input silently (keep prev).
        config.analytics.ga4 = config.analytics.ga4 || {};
        if (raw === '' || /^G-[A-Z0-9]+$/.test(raw)) {
          config.analytics.ga4.measurementId = raw;
        }
      }
      if (a.firstParty && typeof a.firstParty === 'object') {
        const prev = config.analytics.firstParty || {};
        config.analytics.firstParty = {
          enabled: a.firstParty.enabled !== undefined ? !!a.firstParty.enabled : !!prev.enabled,
          collectorUrl: a.firstParty.collectorUrl !== undefined
            ? (String(a.firstParty.collectorUrl || '').trim() || '/_tapuz/collect')
            : (prev.collectorUrl || '/_tapuz/collect')
        };
      }
      if (a.gaDataApi && typeof a.gaDataApi === 'object') {
        const prev = config.analytics.gaDataApi || {};
        config.analytics.gaDataApi = {
          enabled: a.gaDataApi.enabled !== undefined ? !!a.gaDataApi.enabled : !!prev.enabled,
          propertyId: a.gaDataApi.propertyId !== undefined
            ? String(a.gaDataApi.propertyId || '').trim()
            : (prev.propertyId || ''),
          serviceAccountPath: a.gaDataApi.serviceAccountPath !== undefined
            ? String(a.gaDataApi.serviceAccountPath || '').trim()
            : (prev.serviceAccountPath || ''),
          note: prev.note || 'Disabled. Requires @google-analytics/data + a service-account JSON key. See docs/analytics.md.'
        };
      }
    }
    saveConfig(config);
    res.json({ ok: true, integrations: config.integrations, analytics: config.analytics });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// =========================================================================
// S6: first-party analytics DASHBOARD (Hebrew / RTL, behind the admin auth
// guard). Pure server-rendered charts — inline SVG bars + CSS meters, no chart
// library. A ?days=7|30|90 range selector drives every aggregation. Also shows
// the GA4 injection state and the (disabled) GA Data API read-back status.
// =========================================================================
app.get('/admin/analytics', (req, res) => {
  try {
    const RANGES = [7, 30, 90];
    let days = parseInt(req.query.days, 10);
    if (!RANGES.includes(days)) days = 30;
    const data = analytics.dashboardData(days);
    const cfg = loadConfig();
    const ga4Id = (cfg.analytics && cfg.analytics.ga4 && cfg.analytics.ga4.measurementId) || '';
    const fpEnabled = !!(cfg.analytics && cfg.analytics.firstParty && cfg.analytics.firstParty.enabled);
    const gdaStatus = gaData.status();

    const nf = (n) => Number(n || 0).toLocaleString('he-IL');
    const maxViews = Math.max(1, ...data.byDay.map(d => d.views));

    // --- Per-day bar chart (inline SVG, RTL: newest on the right) ---
    const W = 720, H = 180, padB = 22, padT = 8;
    const n = data.byDay.length;
    const gap = n > 60 ? 1 : 2;
    const bw = Math.max(2, (W - (n - 1) * gap) / n);
    const bars = data.byDay.map((d, i) => {
      const h = Math.round(((H - padB - padT) * d.views) / maxViews);
      const x = Math.round(i * (bw + gap));
      const y = H - padB - h;
      const title = `${d.day}: ${d.views} צפיות, ${d.visitors} מבקרים`;
      return `<rect x="${x}" y="${y}" width="${bw.toFixed(2)}" height="${Math.max(h, d.views ? 1 : 0)}" rx="1.5" fill="var(--admin-accent)"><title>${escapeAdmin(title)}</title></rect>`;
    }).join('');
    const firstDay = data.byDay[0] ? data.byDay[0].day : '';
    const lastDay = data.byDay[n - 1] ? data.byDay[n - 1].day : '';
    const chartSvg =
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:200px;direction:ltr">` +
      `<line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="#e2e8f0" stroke-width="1"/>` +
      bars +
      `</svg>` +
      `<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:#94a3b8;direction:ltr">` +
      `<span>${escapeAdmin(firstDay)}</span><span>${escapeAdmin(lastDay)}</span></div>`;

    // --- Top pages table ---
    const topPagesRows = data.topPages.length
      ? data.topPages.map(p =>
          `<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9"><a href="${escapeAdmin(p.path)}" dir="ltr" target="_blank" style="color:#0f172a">${escapeAdmin(p.path)}</a></td>` +
          `<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:start;font-weight:600">${nf(p.views)}</td></tr>`
        ).join('')
      : `<tr><td colspan="2" style="padding:14px;color:#94a3b8;text-align:center">אין נתונים בטווח הזה</td></tr>`;

    // --- Top referrers table ---
    const refRows = data.topReferrers.length
      ? data.topReferrers.map(r =>
          `<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9" dir="ltr">${escapeAdmin(r.host)}</td>` +
          `<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-weight:600">${nf(r.views)}</td></tr>`
        ).join('')
      : `<tr><td colspan="2" style="padding:14px;color:#94a3b8;text-align:center">אין הפניות חיצוניות מזוהות (רוב התנועה ישירה)</td></tr>`;

    // --- Device breakdown meters ---
    const deviceTotal = data.devices.reduce((s, d) => s + d.views, 0) || 1;
    const deviceLabels = { mobile: 'נייד', tablet: 'טאבלט', desktop: 'מחשב', unknown: 'לא ידוע' };
    const deviceRows = data.devices.length
      ? data.devices.map(d => {
          const pct = Math.round((d.views * 100) / deviceTotal);
          return `<div style="margin-bottom:10px">` +
            `<div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:3px">` +
            `<span>${escapeAdmin(deviceLabels[d.device] || d.device)}</span><span style="color:#64748b">${pct}% · ${nf(d.views)}</span></div>` +
            `<div style="height:8px;background:#f1f5f9;border-radius:999px;overflow:hidden">` +
            `<div style="height:100%;width:${pct}%;background:var(--admin-accent)"></div></div></div>`;
        }).join('')
      : `<p style="color:#94a3b8;text-align:center;margin:14px 0">אין נתונים</p>`;

    const rangeTabs = RANGES.map(r =>
      `<a href="/admin/analytics?days=${r}" class="btn ${r === days ? '' : 'secondary'}" style="padding:6px 14px">${r} ימים</a>`
    ).join('');

    const card = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px';

    // GA status strips
    const ga4Strip = ga4Id
      ? `<div style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:8px 12px;border-radius:8px;font-size:0.85rem">Google Analytics פעיל: <code dir="ltr">${escapeAdmin(ga4Id)}</code> — מוזרק לכל דף ציבורי.</div>`
      : `<div style="background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;padding:8px 12px;border-radius:8px;font-size:0.85rem">Google Analytics לא מחובר. הוסף Measurement ID ב<a href="/admin/integrations">אינטגרציות</a>.</div>`;
    const fpStrip = fpEnabled
      ? ''
      : `<div style="background:#fffbeb;border:1px solid #fcd34d;color:#78350f;padding:8px 12px;border-radius:8px;font-size:0.85rem;margin-top:8px">האיסוף הפנימי כבוי — הנתונים למטה לא יתעדכנו. הפעל אותו ב<a href="/admin/integrations">אינטגרציות</a>.</div>`;

    const html = `
      ${adminNav('analytics', 'אנליטיקס')}
      <div class="container" style="padding-top:24px;padding-bottom:60px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:8px">
          <p style="color:#64748b;margin:0">סטטיסטיקות פרטיות שנאספות על-ידי Tapuz — ללא צד שלישי, ללא שמירת כתובות IP.</p>
          <div style="display:flex;gap:6px">${rangeTabs}</div>
        </div>
        ${ga4Strip}${fpStrip}

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin:18px 0">
          <div style="${card}">
            <div style="font-size:0.8rem;color:#64748b">צפיות בדפים</div>
            <div style="font-size:2rem;font-weight:800;color:#0f172a">${nf(data.totals.views)}</div>
          </div>
          <div style="${card}">
            <div style="font-size:0.8rem;color:#64748b">מבקרים ייחודיים (מוערך)</div>
            <div style="font-size:2rem;font-weight:800;color:#0f172a">${nf(data.totals.visitors)}</div>
          </div>
          <div style="${card}">
            <div style="font-size:0.8rem;color:#64748b">טווח</div>
            <div style="font-size:2rem;font-weight:800;color:#0f172a">${days} <span style="font-size:1rem;font-weight:600;color:#64748b">ימים</span></div>
          </div>
        </div>

        <div style="${card};margin-bottom:18px">
          <h3 style="margin:0 0 12px;font-size:1rem">צפיות לפי יום</h3>
          ${chartSvg}
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px">
          <div style="${card}">
            <h3 style="margin:0 0 12px;font-size:1rem">הדפים המובילים</h3>
            <table style="width:100%;border-collapse:collapse;font-size:0.88rem"><tbody>${topPagesRows}</tbody></table>
          </div>
          <div style="${card}">
            <h3 style="margin:0 0 12px;font-size:1rem">מקורות הפניה מובילים</h3>
            <table style="width:100%;border-collapse:collapse;font-size:0.88rem"><tbody>${refRows}</tbody></table>
          </div>
          <div style="${card}">
            <h3 style="margin:0 0 12px;font-size:1rem">סוגי מכשירים</h3>
            ${deviceRows}
          </div>
        </div>

        <div style="${card};margin-top:18px;opacity:0.9">
          <h3 style="margin:0 0 8px;font-size:1rem">📥 קריאת נתוני Google Analytics בחזרה</h3>
          <p style="color:#64748b;font-size:0.88rem;margin:0 0 8px">שאיבת הנתונים מ-Google (GA Data API) אינה פעילה. סטטוס: <b>${escapeAdmin(gdaStatus.reason)}</b></p>
          <p style="color:#94a3b8;font-size:0.82rem;margin:0">להפעלה יש לספק קובץ Service Account ומזהה Property, ולהתקין את התלות. מדריך: <code dir="ltr">docs/analytics.md</code>.</p>
        </div>

        <p style="color:#94a3b8;font-size:0.8rem;margin-top:18px;line-height:1.6">
          פרטיות: לכל צפייה נשמרים רק הנתיב, מארח ההפניה (ללא כתובת מלאה), סוג המכשיר, וחתימת מבקר מגובבת (HMAC עם מלח יומי מתחלף). כתובת ה-IP המלאה לעולם לא נשמרת. אתרים סטטיים שיוצאו ומתארחים מחוץ ל-Tapuz רושמים נתונים רק כאשר שרת Tapuz זמין בכתובת האספן.
        </p>
      </div>
    `;
    res.send(layout(html, 'אנליטיקס', '#0d9488'));
  } catch (e) {
    res.status(500).send('שגיאה בטעינת אנליטיקס: ' + escapeAdmin(e.message));
  }
});

// =========================================================================
// S3: CMS-managed static header + footer chrome — settings screen.
// Edits config.header / config.footer, which renderPage wraps around EVERY
// public page (serve + static export). Follows the integrations screen pattern
// (GET page + GET/POST /admin/api/site-chrome), Hebrew/RTL, behind the auth
// guard like every other /admin route.
// =========================================================================
app.get('/admin/site-chrome', (req, res) => {
  const config = loadConfig();
  const header = config.header || {};
  const footer = config.footer || {};
  // Initial state handed to the client builder as a safe JSON island.
  const data = {
    header: {
      tagline: header.tagline || '',
      showLogo: header.showLogo !== false,
      sticky: header.sticky !== false,
      ctaLabel: header.ctaLabel || '',
      ctaUrl: header.ctaUrl || ''
    },
    footer: {
      text: footer.text || '',
      showCredit: footer.showCredit !== false,
      columns: Array.isArray(footer.columns) ? footer.columns : [],
      social: Array.isArray(footer.social) ? footer.social : []
    }
  };
  const inputCss = 'width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box';
  const cardCss = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px;margin-bottom:18px';
  const html = `
    ${adminNav('site-chrome', 'כותרת ותחתית')}
    <div class="container" style="padding-top:28px;max-width:720px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">הכותרת והתחתית שייכות לכל האתר — כל דף שנבנה בבונה מופיע בתוכן. השינויים חלים באתר הציבורי אחרי "בנה אתר".</p>

      <section style="${cardCss}">
        <h3 style="margin-top:0">🔝 כותרת עליונה (Header)</h3>
        <label style="display:block;font-weight:600;margin-bottom:4px">תת-כותרת ליד הלוגו</label>
        <input id="h-tagline" value="${escapeAdmin(data.header.tagline)}" placeholder="הבית של המוזיקה" style="${inputCss};margin-bottom:14px">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:12px">
          <input type="checkbox" id="h-showlogo" ${data.header.showLogo ? 'checked' : ''}> הצג לוגו בכותרת
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:16px">
          <input type="checkbox" id="h-sticky" ${data.header.sticky ? 'checked' : ''}> כותרת "דביקה" (נשארת למעלה בגלילה)
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">כפתור פעולה — טקסט</label>
            <input id="h-ctalabel" value="${escapeAdmin(data.header.ctaLabel)}" placeholder="צור קשר" style="${inputCss}">
          </div>
          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px">כפתור פעולה — קישור</label>
            <input id="h-ctaurl" dir="ltr" value="${escapeAdmin(data.header.ctaUrl)}" placeholder="/contact" style="${inputCss}">
          </div>
        </div>
        <div style="font-size:0.8rem;color:#94a3b8;margin-top:8px">כפתור הפעולה מופיע רק אם מולאו גם טקסט וגם קישור.</div>
      </section>

      <section style="${cardCss}">
        <h3 style="margin-top:0">🔻 תחתית (Footer)</h3>
        <label style="display:block;font-weight:600;margin-bottom:4px">טקסט תחתית חופשי</label>
        <textarea id="f-text" rows="2" placeholder="רחוב הרצל 1, תל אביב · טל׳ 03-0000000" style="${inputCss};margin-bottom:14px">${escapeAdmin(data.footer.text)}</textarea>
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:6px">
          <input type="checkbox" id="f-credit" ${data.footer.showCredit ? 'checked' : ''}> הצג קרדיט "נבנה עם Tapuz"
        </label>
      </section>

      <section style="${cardCss}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="margin:0">🗂️ עמודות קישורים בתחתית</h3>
          <button type="button" class="btn secondary" id="add-col" style="padding:6px 12px">+ עמודה</button>
        </div>
        <p style="color:#64748b;font-size:0.9rem;margin-top:0">כל עמודה = כותרת + רשימת קישורים.</p>
        <div id="cols-wrap"></div>
      </section>

      <section style="${cardCss}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="margin:0">🔗 רשתות חברתיות</h3>
          <button type="button" class="btn secondary" id="add-social" style="padding:6px 12px">+ רשת</button>
        </div>
        <div id="social-wrap"></div>
      </section>

      <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
        <span id="chrome-status" style="color:#166534;font-size:0.9rem"></span>
        <button type="button" class="btn" id="chrome-save">שמור כותרת ותחתית</button>
      </div>
      <div style="font-size:0.8rem;color:#94a3b8;margin-top:10px;text-align:end">אחרי השמירה לחצו "בנה אתר" (דשבורד) כדי לפרסם לאתר החי.</div>
    </div>

    <script type="application/json" id="chrome-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
    <script>
      (function () {
        var DATA = JSON.parse(document.getElementById('chrome-data').textContent);
        var inputCss = ${JSON.stringify(inputCss)};
        var colsWrap = document.getElementById('cols-wrap');
        var socialWrap = document.getElementById('social-wrap');

        function el(tag, attrs, html) {
          var e = document.createElement(tag);
          if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
          if (html != null) e.innerHTML = html;
          return e;
        }
        function xrow() {
          return '<button type="button" class="btn secondary rm" style="padding:6px 10px">✕</button>';
        }

        // ---- Columns ----
        function addColumn(col) {
          col = col || { title: '', links: [] };
          var box = el('div', { 'class': 'chrome-col', style: 'border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:12px;background:#f8fafc' });
          var head = el('div', { style: 'display:flex;gap:8px;margin-bottom:10px' });
          var titleInput = el('input', { placeholder: 'כותרת עמודה', style: inputCss + ';flex:1' });
          titleInput.className = 'col-title';
          titleInput.value = col.title || '';
          var rmCol = el('button', { type: 'button', 'class': 'btn secondary', style: 'padding:6px 10px' }, '✕ עמודה');
          rmCol.addEventListener('click', function () { box.remove(); });
          head.appendChild(titleInput); head.appendChild(rmCol);
          box.appendChild(head);
          var linksWrap = el('div', { 'class': 'links-wrap' });
          box.appendChild(linksWrap);
          var addLink = el('button', { type: 'button', 'class': 'btn secondary', style: 'padding:5px 10px;font-size:0.82rem' }, '+ קישור');
          addLink.addEventListener('click', function () { addLinkRow(linksWrap, {}); });
          box.appendChild(addLink);
          (col.links || []).forEach(function (l) { addLinkRow(linksWrap, l); });
          if (!(col.links || []).length) addLinkRow(linksWrap, {});
          colsWrap.appendChild(box);
        }
        function addLinkRow(wrap, link) {
          var row = el('div', { 'class': 'link-row', style: 'display:flex;gap:8px;margin-bottom:8px' });
          var label = el('input', { placeholder: 'טקסט', style: inputCss + ';flex:1' });
          label.className = 'link-label'; label.value = link.label || '';
          var url = el('input', { placeholder: '/page', dir: 'ltr', style: inputCss + ';flex:1' });
          url.className = 'link-url'; url.value = link.url || '';
          var rm = el('button', { type: 'button', 'class': 'btn secondary', style: 'padding:6px 10px' }, '✕');
          rm.addEventListener('click', function () { row.remove(); });
          row.appendChild(label); row.appendChild(url); row.appendChild(rm);
          wrap.appendChild(row);
        }

        // ---- Social ----
        function addSocial(s) {
          s = s || { network: '', url: '' };
          var row = el('div', { 'class': 'social-row', style: 'display:flex;gap:8px;margin-bottom:8px' });
          var net = el('input', { placeholder: 'Facebook', style: inputCss + ';flex:1' });
          net.className = 'social-net'; net.value = s.network || '';
          var url = el('input', { placeholder: 'https://…', dir: 'ltr', style: inputCss + ';flex:2' });
          url.className = 'social-url'; url.value = s.url || '';
          var rm = el('button', { type: 'button', 'class': 'btn secondary', style: 'padding:6px 10px' }, '✕');
          rm.addEventListener('click', function () { row.remove(); });
          row.appendChild(net); row.appendChild(url); row.appendChild(rm);
          socialWrap.appendChild(row);
        }

        document.getElementById('add-col').addEventListener('click', function () { addColumn(); });
        document.getElementById('add-social').addEventListener('click', function () { addSocial(); });
        (DATA.footer.columns || []).forEach(addColumn);
        (DATA.footer.social || []).forEach(addSocial);

        // ---- Save ----
        function collect() {
          var columns = [].map.call(colsWrap.querySelectorAll('.chrome-col'), function (box) {
            var links = [].map.call(box.querySelectorAll('.link-row'), function (r) {
              return { label: r.querySelector('.link-label').value, url: r.querySelector('.link-url').value };
            }).filter(function (l) { return l.label || l.url; });
            return { title: box.querySelector('.col-title').value, links: links };
          }).filter(function (c) { return c.title || c.links.length; });
          var social = [].map.call(socialWrap.querySelectorAll('.social-row'), function (r) {
            return { network: r.querySelector('.social-net').value, url: r.querySelector('.social-url').value };
          }).filter(function (s) { return s.url; });
          return {
            header: {
              tagline: document.getElementById('h-tagline').value,
              showLogo: document.getElementById('h-showlogo').checked,
              sticky: document.getElementById('h-sticky').checked,
              ctaLabel: document.getElementById('h-ctalabel').value,
              ctaUrl: document.getElementById('h-ctaurl').value
            },
            footer: {
              text: document.getElementById('f-text').value,
              showCredit: document.getElementById('f-credit').checked,
              columns: columns,
              social: social
            }
          };
        }
        document.getElementById('chrome-save').addEventListener('click', function () {
          var status = document.getElementById('chrome-status');
          status.style.color = '#166534'; status.textContent = 'שומר…';
          fetch('/admin/api/site-chrome', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collect())
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) { status.style.color = '#166534'; status.textContent = 'נשמר ✓'; }
            else { status.style.color = '#b91c1c'; status.textContent = d.error || 'שגיאה'; }
          }).catch(function () { status.style.color = '#b91c1c'; status.textContent = 'שגיאת רשת'; });
        });
      })();
    </script>
  `;
  res.send(layout(html, 'כותרת ותחתית', '#7c3aed'));
});

app.get('/admin/api/site-chrome', (req, res) => {
  try {
    const config = loadConfig();
    res.json({ ok: true, header: config.header || {}, footer: config.footer || {} });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/site-chrome', (req, res) => {
  try {
    const config = loadConfig();
    const b = req.body || {};
    const str = (v) => String(v == null ? '' : v);

    if (b.header && typeof b.header === 'object') {
      const prev = config.header || {};
      config.header = {
        tagline: b.header.tagline !== undefined ? str(b.header.tagline).trim() : (prev.tagline || ''),
        showLogo: b.header.showLogo !== undefined ? !!b.header.showLogo : (prev.showLogo !== false),
        sticky: b.header.sticky !== undefined ? !!b.header.sticky : (prev.sticky !== false),
        ctaLabel: b.header.ctaLabel !== undefined ? str(b.header.ctaLabel).trim() : (prev.ctaLabel || ''),
        ctaUrl: b.header.ctaUrl !== undefined ? str(b.header.ctaUrl).trim() : (prev.ctaUrl || '')
      };
    }

    if (b.footer && typeof b.footer === 'object') {
      const prev = config.footer || {};
      let columns = prev.columns || [];
      if (Array.isArray(b.footer.columns)) {
        columns = b.footer.columns
          .map(c => ({
            title: str(c && c.title).trim(),
            links: (Array.isArray(c && c.links) ? c.links : [])
              .map(l => ({ label: str(l && l.label).trim(), url: str(l && l.url).trim() }))
              .filter(l => l.label || l.url)
          }))
          .filter(c => c.title || c.links.length);
      }
      let social = prev.social || [];
      if (Array.isArray(b.footer.social)) {
        social = b.footer.social
          .map(s => ({ network: str(s && s.network).trim(), url: str(s && s.url).trim() }))
          .filter(s => s.url);
      }
      config.footer = {
        text: b.footer.text !== undefined ? str(b.footer.text) : (prev.text || ''),
        showCredit: b.footer.showCredit !== undefined ? !!b.footer.showCredit : (prev.showCredit !== false),
        columns,
        social
      };
    }

    saveConfig(config);
    res.json({ ok: true, header: config.header, footer: config.footer });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---- API: pages list (navigator) ----
// ─── BenTML: source language ↔ JSON blocks (page builder bridge) ───
const bentml = require('./bentml');

app.get('/admin/api/bentml/modules', (req, res) => {
  res.json({ modules: bentml.listModules(), version: '0.1' });
});

/** Syntax dictionary — single source for agents + humans (from block-registry). */
app.get('/admin/api/syntax-dictionary', (req, res) => {
  try {
    const { buildDictionary } = require('./syntax-dictionary');
    res.json({ ok: true, dictionary: buildDictionary() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/admin/api/syntax-dictionary.md', (req, res) => {
  try {
    const { toMarkdown } = require('./syntax-dictionary');
    res.type('text/markdown; charset=utf-8').send(toMarkdown());
  } catch (e) {
    res.status(500).send(e.message);
  }
});

/** Full agent primer = cheatsheet (the language, not a block list). */
app.get('/admin/api/bentml/primer', (req, res) => {
  try {
    const sheetPath = path.join(__dirname, '..', 'docs', 'bentml-cheatsheet.md');
    const packPath = path.join(__dirname, '..', 'docs', 'agent-free-tier-pack.md');
    const cheatsheet = fs.existsSync(sheetPath)
      ? fs.readFileSync(sheetPath, 'utf8')
      : 'See docs/bentml-v0.md';
    const freeTierPack = fs.existsSync(packPath)
      ? fs.readFileSync(packPath, 'utf8')
      : cheatsheet;
    res.json({
      ok: true,
      version: '0.1',
      language: 'bentml',
      forAgents: ['grok', 'chatgpt', 'gemini', 'claude', 'free-tier'],
      shape: {
        file: 'BENTML 0.1 → META {…} → body keywords',
        module: 'KEYWORD(params) { body } | KEYWORD(params)',
        metadata: 'META { key: value } — page level',
        text: '{ body } on TEXT-BODY keywords',
        style: 'page-builder Style panel + optional class: — NOT a STYLE{ } block',
        pipeline: 'agent writes BenTML → compile → page builder modules → publish'
      },
      primer: freeTierPack,
      freeTierPack,
      cheatsheet
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Paste-into-blank-chat mission (preferred product path). */
app.get('/admin/api/bentml/chat-snippet', (req, res) => {
  try {
    const jsonPath = path.join(__dirname, '..', 'public', 'chat-snippet.json');
    if (fs.existsSync(jsonPath)) {
      return res.json(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    }
    const txtPath = path.join(__dirname, '..', 'public', 'chat-snippet.txt');
    const pasteBody = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : '';
    res.json({ version: '0.1', pasteBody, notApi: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Legacy alias */
app.get('/admin/api/bentml/agent-pack', (req, res) => {
  res.redirect(302, '/chat-snippet.txt');
});

app.post('/admin/api/bentml/compile', (req, res) => {
  try {
    const source = req.body && req.body.source;
    if (typeof source !== 'string') {
      return res.status(400).json({ error: 'source (BenTML string) required' });
    }
    // the advanced tab accepts BOTH dialects (v0.69): an AI primed with the
    // dictionary answers in <bent-*> .pzn — pasting that here used to be
    // rejected by the keyword compiler ("does not accept the code")
    if (looksLikePzn(source)) {
      const { view, repaired, changes } = pznSourceToBlocks(source);
      return res.json({
        ok: true,
        page: { title: view.title },
        blocks: view.blocks,
        warnings: repaired ? changes.map((c) => String(c && c.message || c)) : [],
        dialect: 'pzn',
        repaired
      });
    }
    const result = bentml.compile(source);
    res.json({
      ok: true,
      page: result.page,
      blocks: result.blocks,
      warnings: result.warnings
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e.message,
      code: e.code || 'E_BENTML',
      line: e.line,
      column: e.column,
      fix: e.fix
    });
  }
});

app.post('/admin/api/bentml/preview', (req, res) => {
  try {
    const source = req.body && req.body.source;
    if (typeof source !== 'string') {
      return res.status(400).json({ error: 'source (BenTML string) required' });
    }
    const result = bentml.preview(source);
    res.json({
      ok: true,
      page: result.page,
      blocks: result.blocks,
      warnings: result.warnings,
      html: result.html
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e.message,
      code: e.code || 'E_BENTML',
      line: e.line,
      fix: e.fix
    });
  }
});

app.post('/admin/api/bentml/decompile', (req, res) => {
  try {
    const page = (req.body && req.body.page) || {};
    const blocks = (req.body && req.body.blocks) || [];
    const source = bentml.decompile(page, blocks);
    res.json({ ok: true, source });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** Apply BenTML source onto a page draft (wires language → page builder storage). */
app.post('/admin/api/bentml/apply', (req, res) => {
  try {
    const { fullPath, source, publish } = req.body || {};
    if (!fullPath || typeof source !== 'string') {
      return res.status(400).json({ error: 'fullPath and source required' });
    }
    const { updatePage, getPageByFullPath, publishPage } = require('./pages');
    const existing = getPageByFullPath(fullPath);
    if (!existing) return res.status(404).json({ error: 'Page not found' });

    const result = bentml.compile(source);
    const patch = {
      title: result.page.title,
      direction: result.page.direction,
      theme: result.page.theme,
      tags: result.page.tags,
      meta: { ...(existing.meta || {}), ...result.page.meta },
      draft_blocks: result.blocks
    };
    updatePage(fullPath, patch);
    if (publish) {
      // publishPage copies draft → published when available
      if (typeof publishPage === 'function') publishPage(fullPath);
      else updatePage(fullPath, { blocks: result.blocks, status: 'published' });
    }
    res.json({
      ok: true,
      fullPath,
      blocks: result.blocks,
      page: result.page,
      warnings: result.warnings
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e.message,
      code: e.code || 'E_BENTML',
      line: e.line,
      fix: e.fix
    });
  }
});

// ─── .pzn canonical editing API (v0.42) ─────────────────────────────
// The page's .pzn source and builder-standard AST ops are the canonical
// editing path — for agents, tools, and the page-builder standard.

/** Read a page's canonical .pzn source. ?kind=draft|published (default draft). */
app.get('/admin/api/pzn/source', (req, res) => {
  try {
    const fullPath = String(req.query.fullPath || '');
    const kind = req.query.kind === 'published' ? 'published' : 'draft';
    if (!fullPath) return res.status(400).json({ ok: false, error: 'fullPath required' });
    const { getPageSource } = require('./pages');
    const source = getPageSource(fullPath, kind);
    if (source == null) return res.status(404).json({ ok: false, error: 'Page not found' });
    res.json({ ok: true, fullPath, kind, source });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * Save raw .pzn source as the page draft (publish: true also publishes).
 * loose: true — the source is a raw pasted AI reply; extract the .pzn
 * document out of prose/code fences first (the paste flow).
 */
app.post('/admin/api/pzn/source', (req, res) => {
  try {
    const { fullPath, publish, loose } = req.body || {};
    let { source } = req.body || {};
    if (!fullPath || typeof source !== 'string') {
      return res.status(400).json({ ok: false, error: 'fullPath and source required' });
    }
    if (loose) {
      const { extractPzn } = require('./pzn-extract');
      source = extractPzn(source);
    }
    const { savePageSource } = require('./pages');
    const result = savePageSource(fullPath, source, { publish: !!publish });
    if (publish) exportAll(); // publish from the paste flow means LIVE now
    res.json({ ok: true, fullPath, blocks: result.blocks, warnings: result.warnings });
  } catch (e) {
    // Strict save failed — compute an auto-correction the user can apply with
    // one click (v0.49 "auto-correct, then you apply"). No save happens here.
    let repairInfo = {};
    try {
      let src = (req.body || {}).source;
      if ((req.body || {}).loose) { const { extractPzn } = require('./pzn-extract'); src = extractPzn(src); }
      const { repair } = require('./pzn/repair');
      const r = repair(src);
      if (r.ok && !r.remaining.length && r.changes.length) {
        repairInfo = { repairable: true, repairedSource: r.source, changes: r.changes };
      }
    } catch (_) { /* repair is best-effort */ }
    res.status(400).json({
      ok: false,
      error: e.message,
      code: e.code || 'E_PZN',
      line: e.line,
      column: e.column,
      issues: e.issues,
      ...repairInfo
    });
  }
});

/**
 * Dry-run repair — return a corrected .pzn + the change list WITHOUT saving.
 * The admin UI calls this to preview "apply the fix" (v0.49).
 */
app.post('/admin/api/pzn/repair', (req, res) => {
  try {
    let { source, loose } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    if (loose) { const { extractPzn } = require('./pzn-extract'); source = extractPzn(source); }
    const { repair } = require('./pzn/repair');
    const r = repair(source);
    res.json({
      ok: r.ok,
      repairedSource: r.source || '',
      changes: r.changes,
      remaining: r.remaining,
      error: r.error
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * Decompile (v0.57): any HTML page or live URL → a draft Tapuz page + a
 * toolGap report (the vocabulary engine — see src/pzn/decompile.js). The
 * toolGap counts are aggregated into config/tool-gap.json: the running
 * backlog of modules real pages keep asking for.
 */
function recordToolGap(toolGap) {
  try {
    if (!Array.isArray(toolGap) || !toolGap.length) return;
    const fs = require('fs');
    const path = require('path');
    const { CONFIG_DIR } = require('./paths');
    const file = path.join(CONFIG_DIR, 'tool-gap.json');
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* fresh */ }
    for (const t of toolGap) data[t] = (data[t] || 0) + 1;
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { /* the report must never fail the decompile */ }
}

app.post('/admin/api/pzn/decompile', async (req, res) => {
  try {
    const { url, html, title, slug, create, assets } = req.body || {};
    const { decompileHtml, decompileUrl } = require('./pzn/decompile');
    let r;
    if (url && String(url).trim()) {
      r = await decompileUrl(String(url).trim(), { title, slug });
    } else if (typeof html === 'string' && html.trim()) {
      if (looksLikePzn(html)) {
        // the paste is already BenTML (an AI reply) — the HTML decompiler
        // would shred bent-* tags into provisional blobs (v0.69). Route it
        // through the forgiving import instead; same draft-creating flow.
        const pznApi = require('./pzn/index');
        const { deriveSlug } = require('./pzn/intent');
        const { view, repaired } = pznSourceToBlocks(html);
        const pageTitle = (title || '').trim() || view.title || 'דף מיובא';
        const pageSlug = deriveSlug((slug || '').trim() || pageTitle);
        const doc2 = pznApi.fromTapuzPage({
          title: pageTitle, slug: pageSlug, lang: view.lang || 'he',
          direction: view.direction || 'rtl', tags: view.tags || [], meta: view.meta || {}, blocks: view.blocks
        });
        r = {
          source: pznApi.serialize(doc2),
          blocks: view.blocks,
          mapped: view.blocks.length,
          leftover: 0,
          toolGap: [],
          issues: [],
          meta: { title: pageTitle, slug: pageSlug, lang: view.lang || 'he', dir: view.direction || 'rtl' },
          strategy: repaired ? 'bentml-repaired' : 'bentml',
          strategies: []
        };
      } else {
        r = decompileHtml(html, { title, slug });
      }
    } else {
      return res.status(400).json({ ok: false, error: 'url or html required' });
    }
    recordToolGap(r.toolGap);

    // v0.67: make the pictures OURS — download every remote image the blocks
    // reference, convert to webp, host under /assets/imported/<slug>/, and
    // rewrite the blocks to local paths. On by default; assets:false skips.
    let assetsReport = null;
    if (assets !== false) {
      try {
        const { ingestBlockImages } = require('./media-ingest');
        assetsReport = await ingestBlockImages(r.blocks, { folder: 'imported/' + r.meta.slug });
        if (assetsReport.saved) {
          const pznApi = require('./pzn');
          const doc = pznApi.fromTapuzPage({
            title: r.meta.title, slug: r.meta.slug, lang: r.meta.lang,
            direction: r.meta.dir, tags: [], meta: {}, blocks: r.blocks
          });
          r.source = pznApi.serialize(doc);
        }
      } catch (e) {
        assetsReport = { found: 0, saved: 0, failed: [{ url: '*', reason: e.message }], skipped: 0 };
      }
    }

    let fullPath = null;
    if (create) {
      const { createPage, getPageByFullPath, savePageSource } = require('./pages');
      // never clobber — suffix until free (same rule as /admin/create)
      let candidate = r.meta.slug;
      for (let n = 2; getPageByFullPath(candidate); n++) candidate = r.meta.slug + '-' + n;
      createPage({ title: r.meta.title, slug: candidate, blocks: [] });
      try {
        savePageSource(candidate, r.source, { publish: false });
      } catch (strictErr) {
        savePageSource(candidate, r.source, { publish: false, repair: true });
      }
      fullPath = candidate;
    }
    res.json({
      ok: true,
      fullPath,
      source: r.source,
      blocks: r.blocks.length,
      mapped: r.mapped,
      leftover: r.leftover,
      toolGap: r.toolGap,
      fromUrl: r.fromUrl || null,
      meta: r.meta,
      // v0.66 safety guard: which read won, and every strategy's score
      strategy: r.strategy,
      strategies: r.strategies,
      // v0.67: the image-ingestion report (null when assets:false)
      assets: assetsReport
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * Graduate (v0.51): convert a provisional bent-html block's raw HTML into real,
 * visually-editable Tapuz modules. Best-effort — unmappable bits stay in a
 * smaller html block so nothing is lost. The builder splices the result in
 * place of the html block; the admin approves it.
 */
app.post('/admin/api/pzn/graduate', (req, res) => {
  try {
    const content = (req.body || {}).content;
    if (typeof content !== 'string') {
      return res.status(400).json({ ok: false, error: 'content required' });
    }
    const { htmlToBlocks } = require('./pzn/graduate');
    const r = htmlToBlocks(content);
    res.json({ ok: true, blocks: r.blocks, mapped: r.mapped, leftover: r.leftover });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * Import BenTML → blocks (v0.53): the in-builder bridge. Takes an LLM's reply
 * (BenTML, possibly wrapped in prose/fences), extracts + FORGIVINGLY compiles
 * it to Tapuz blocks WITHOUT saving — the builder applies them (replace/append)
 * and the admin publishes when ready. Reuses the repair pipeline so imperfect
 * agent output still lands.
 */
/** An LLM reply that speaks .pzn — <bent-*> tags / a bent-version head. */
function looksLikePzn(source) {
  return /<bent-[a-z]/i.test(source) || /bent-version/i.test(source);
}

/**
 * The ONE forgiving pipeline for pasted BenTML (v0.69 — shared by every paste
 * door: the in-builder AI import, the advanced code tab, and /admin/new).
 * extract → parse | repair → toTapuzPage. Throws with .issues on a dead paste.
 */
function pznSourceToBlocks(rawSource) {
  const { extractPzn } = require('./pzn-extract');
  const source = extractPzn(rawSource);
  const pznApi = require('./pzn/index');
  let doc;
  let repaired = false;
  let changes = [];
  try {
    doc = pznApi.parse(source);
    const errs = pznApi.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
    if (errs.length) { const e = new Error('invalid'); e.issues = errs; throw e; }
  } catch (parseErr) {
    const { repair } = require('./pzn/repair');
    const r = repair(source);
    if (!r.ok || r.remaining.length) {
      const err = new Error(r.error || 'לא הצלחתי לקרוא את ה‑BenTML');
      err.issues = r.remaining || parseErr.issues;
      throw err;
    }
    doc = pznApi.parse(r.source);
    repaired = true;
    changes = r.changes;
  }
  // even a VALID doc can carry prop drift (url= for href=) — adopt twins so
  // the model's obvious intent lands instead of silently dropping
  const twinChanges = require('./pzn/repair').adoptPropTwins(doc);
  if (twinChanges.length) changes = changes.concat(twinChanges);
  const view = pznApi.toTapuzPage(doc);
  return { view, doc, repaired, changes };
}

app.post('/admin/api/pzn/to-blocks', (req, res) => {
  try {
    const { source } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    const { view, repaired, changes } = pznSourceToBlocks(source);
    res.json({ ok: true, blocks: view.blocks, title: view.title, repaired, changes });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, issues: e.issues });
  }
});

/** Apply builder-standard AST ops to the page draft. */
app.post('/admin/api/pzn/ops', (req, res) => {
  try {
    const { fullPath, ops, publish } = req.body || {};
    if (!fullPath || !Array.isArray(ops)) {
      return res.status(400).json({ ok: false, error: 'fullPath and ops[] required' });
    }
    const { applyPageOps } = require('./pages');
    const result = applyPageOps(fullPath, ops, { publish: !!publish });
    res.json({ ok: true, fullPath, blocks: result.blocks, source: result.source, warnings: result.warnings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_OPS' });
  }
});

// ─── Agent token management (session-authed; secrets shown once) ────
app.get('/admin/api/agent-tokens', (req, res) => {
  res.json({ ok: true, tokens: agentTokens.listTokens() });
});

app.post('/admin/api/agent-tokens', (req, res) => {
  try {
    const { name, scopes } = req.body || {};
    const { token, record } = agentTokens.mintToken({ name, scopes });
    res.json({ ok: true, token, record }); // `token` is returned exactly once
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.delete('/admin/api/agent-tokens/:id', (req, res) => {
  const removed = agentTokens.revokeToken(req.params.id);
  res.json({ ok: removed });
});

/** Module toolbox + schemas — what agents need to write valid .pzn. */
app.get('/admin/api/pzn/toolbox', (req, res) => {
  try {
    const pznApi = require('./pzn/index');
    res.json({ ok: true, toolbox: pznApi.getToolbox(), schemas: pznApi.getAllSchemas() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** The paste-into-any-AI primer, generated live from the registry. */
app.get('/admin/api/pzn/primer', (req, res) => {
  try {
    const { buildPznPrimer } = require('./pzn/agent-primer');
    res.type('text/markdown; charset=utf-8').send(buildPznPrimer());
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * Create a brand-new page from pasted .pzn (the "bot invented a page" flow):
 * extract → validate → slug from bent-slug (or title) → create → save source.
 */
app.post('/admin/api/pzn/create-from-source', (req, res) => {
  try {
    const { publish } = req.body || {};
    let { source } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    const { extractPzn } = require('./pzn-extract');
    source = extractPzn(source);
    const pznApi = require('./pzn/index');
    const doc = pznApi.parse(source);
    const errors = pznApi.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
    if (errors.length) {
      return res.status(400).json({
        ok: false,
        error: errors.map((e) => `${e.code}: ${e.message}`).join('; '),
        issues: errors
      });
    }
    // an EMPTY document must never become a page a reader meets — this is how
    // a pristine paste-template (title "כותרת הדף", zero modules) once got
    // PUBLISHED with its placeholder as the visible title (v0.72 fix).
    if (!pznApi.toTapuzPage(doc).blocks.length) {
      return res.status(400).json({ ok: false, error: 'הדף ריק — נראה שהודבקה התבנית לדוגמה במקום תשובת הבוט. הדביקו את התשובה המלאה (עם מודולי bent-*).' });
    }
    const title = doc.title || 'דף חדש';
    // deriveSlug hardens against path traversal (backslash / '..').
    const { deriveSlug } = require('./pzn/intent');
    const slug = deriveSlug((doc.slug || '').trim() || title);
    const { createPage, getPageByFullPath, savePageSource } = require('./pages');
    if (getPageByFullPath(slug)) {
      return res.status(409).json({ ok: false, error: `דף בשם "${slug}" כבר קיים — בחר אותו ברשימה או שנה את ה-slug במקור` });
    }
    createPage({ title, slug, blocks: [] });
    const result = savePageSource(slug, source, { publish: !!publish });
    if (publish) exportAll(); // publish from the paste flow means LIVE now
    res.json({ ok: true, fullPath: slug, created: true, blocks: result.blocks, warnings: result.warnings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_PZN', line: e.line, column: e.column });
  }
});

/** Compile pasted source to preview HTML without saving. loose extracts first. */
app.post('/admin/api/pzn/preview', (req, res) => {
  try {
    const { loose } = req.body || {};
    let { source } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    if (loose !== false) {
      const { extractPzn } = require('./pzn-extract');
      source = extractPzn(source);
    }
    const pznApi = require('./pzn/index');
    const doc = pznApi.parse(source);
    const issues = pznApi.validate(doc, { strict: false });
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      return res.status(400).json({
        ok: false,
        error: errors.map((e) => `${e.code}: ${e.message}`).join('; '),
        issues: errors
      });
    }
    const { listArticles } = require('./pages');
    let articles = [];
    try { articles = listArticles({ limit: 12 }); } catch (e) { /* fresh DB */ }
    const html = pznApi.buildPreviewHtml(doc, { articles });
    res.json({
      ok: true,
      html,
      source,
      title: doc.title,
      warnings: issues.filter((i) => i.severity === 'warning')
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_PZN', line: e.line, column: e.column });
  }
});

app.get('/admin/api/pages', (req, res) => {
  try {
    res.json({ ok: true, pages: listPages({ q: req.query.q, status: req.query.status }) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/admin/api/articles', (req, res) => {
  try {
    const { tag, limit } = req.query;
    res.json({ ok: true, articles: listArticles({ tag: tag || 'article', limit: limit || 12 }) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/admin/api/revisions/:fullPath', (req, res) => {
  try {
    const fullPath = decodeURIComponent(req.params.fullPath);
    res.json({ ok: true, revisions: listRevisions(fullPath) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/revisions/restore', (req, res) => {
  try {
    const { full_path, revision_id } = req.body || {};
    const page = restoreRevision(full_path, revision_id);
    res.json({ ok: true, page: { full_path: page.full_path, title: page.title, status: page.status, blocks: page.draft_blocks } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---- Theme builder API ----
app.get('/admin/api/theme', (req, res) => {
  try {
    res.json({ ok: true, ...getThemeSettings() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/theme', (req, res) => {
  try {
    const settings = saveThemeSettings(req.body || {});
    res.json({ ok: true, ...settings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---- Menus API ----
app.get('/admin/api/menus', (req, res) => {
  try {
    res.json({ ok: true, menus: loadMenus() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/menus', (req, res) => {
  try {
    const menus = saveMenus(req.body?.menus || req.body || {});
    res.json({ ok: true, menus });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/menus/:name', (req, res) => {
  try {
    const menus = saveMenu(req.params.name, req.body?.items || []);
    res.json({ ok: true, menus });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/admin/new', (req, res) => {
  const html = `
    ${adminNav('pages', 'דף חדש')}
    <div class="container" style="max-width:520px;padding-top:40px">
      <h2 style="margin-bottom:20px">דף חדש</h2>
      <form method="POST" action="/admin/create">
        <div style="margin-bottom:14px">
          <label style="display:block;margin-bottom:4px;font-weight:600">כותרת</label>
          <input id="np-title" name="title" required autofocus style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">
        </div>
        <div style="margin-bottom:20px">
          <label style="display:block;margin-bottom:4px;font-weight:600">כתובת הדף (slug)</label>
          <input id="np-slug" name="slug" placeholder="נוצר אוטומטית מהכותרת" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px">
          <div style="font-size:0.8rem;color:#64748b;margin-top:4px">נוצר אוטומטית מהכותרת — אפשר לשנות, לא חובה להבין ב-slug</div>
        </div>
        <button type="submit" class="btn">צור דף והתחל לערוך</button>
      </form>

      <details style="margin-top:26px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:6px 16px 16px">
        <summary style="cursor:pointer;font-weight:600;padding:10px 0">🔁 יש לכם כבר דף? ייבאו אותו (מכתובת או מ‑HTML)</summary>
        <p style="color:#64748b;font-size:.88rem;margin:6px 0 12px">
          תפוזיאל יפרק את הדף למודולים שאפשר לערוך בבונה. מה שלא ממופה נשמר כ‑HTML זמני — שום דבר לא הולך לאיבוד.
        </p>
        <label style="display:block;margin-bottom:4px;font-weight:600;font-size:.9rem">כתובת דף (URL)</label>
        <input id="imp-url" dir="ltr" placeholder="https://example.com/page" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box">
        <div style="text-align:center;color:#94a3b8;font-size:.8rem;margin:8px 0">— או —</div>
        <label style="display:block;margin-bottom:4px;font-weight:600;font-size:.9rem">הדביקו HTML</label>
        <textarea id="imp-html" dir="ltr" rows="5" placeholder="<html>…</html>" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:.82rem"></textarea>
        <button type="button" id="imp-go" class="btn" style="margin-top:12px">🔁 ייבא ופתח בבונה</button>
        <div id="imp-status" style="margin-top:10px;font-size:.88rem;display:none"></div>
      </details>
    </div>
    <script>
      (function () {
        // Auto-slug for people unfamiliar with sites: derive from the title as
        // you type, but stop the moment the user edits the slug themselves.
        var t = document.getElementById('np-title');
        var s = document.getElementById('np-slug');
        if (!t || !s) return;
        var touched = false;
        s.addEventListener('input', function () { touched = s.value.trim().length > 0; });
        function slugify(v) {
          return String(v || '').trim().replace(/\\s+/g, '-')
            .replace(/[\\\\/:*?"<>|#]/g, '').replace(/\\.\\.+/g, '.').replace(/^\\.+/, '').slice(0, 80);
        }
        t.addEventListener('input', function () { if (!touched) s.value = slugify(t.value); });
      })();

      (function () {
        // Decompile-import (v0.57): URL or pasted HTML → draft page → builder.
        var go = document.getElementById('imp-go');
        var st = document.getElementById('imp-status');
        if (!go) return;
        function say(msg, ok) {
          st.style.display = 'block';
          st.style.color = ok ? '#166534' : '#b91c1c';
          st.textContent = msg;
        }
        go.addEventListener('click', function () {
          var url = document.getElementById('imp-url').value.trim();
          var htmlIn = document.getElementById('imp-html').value.trim();
          if (!url && !htmlIn) { say('הזינו כתובת או הדביקו HTML', false); return; }
          go.disabled = true;
          say(url ? 'מביא ומפרק את הדף…' : 'מפרק את ה‑HTML…', true);
          fetch('/admin/api/pzn/decompile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url, html: htmlIn, create: true })
          }).then(function (r) { return r.json(); }).then(function (r) {
            go.disabled = false;
            if (!r.ok) { say('שגיאה: ' + (r.error || '?'), false); return; }
            var gap = (r.toolGap && r.toolGap.length) ? ' · חסרים לנו כלים ל: ' + r.toolGap.join(', ') : '';
            say('נוצר "' + r.meta.title + '" — ' + r.mapped + ' מודולים מופו, ' + r.leftover + ' נשמרו כ‑HTML זמני' + gap, true);
            setTimeout(function () { location.href = '/admin/edit/' + encodeURIComponent(r.fullPath); }, 1400);
          }).catch(function (e) { go.disabled = false; say('שגיאה: ' + e.message, false); });
        });
      })();
    </script>
  `;
  res.send(layout(html));
});

app.post('/admin/create', (req, res) => {
  const title = (req.body.title || '').trim() || 'דף חדש';
  let slug = (req.body.slug || '').trim();
  // Auto-slug when the user left it blank (they may not know what a slug is).
  if (!slug) {
    const { deriveSlug } = require('./pzn/intent');
    slug = deriveSlug(title);
  }
  // Never clobber an existing page — suffix until the full_path is free.
  let candidate = slug;
  for (let n = 2; getPageByFullPath(generateFullPath('', candidate)); n++) {
    candidate = slug + '-' + n;
  }
  const result = createPage({
    title,
    slug: candidate,
    direction: 'rtl',
    blocks: [
      { type: 'hero', id: 'h_' + Date.now(), data: { title, subtitle: '' } }
    ]
  });
  res.redirect('/admin/edit/' + encodeURIComponent(result.full_path));
});

app.post('/admin/delete', (req, res) => {
  deletePage(req.body.full_path);
  res.redirect('/admin');
});

// ======================== VISUAL CANVAS BUILDER ========================
app.get('/admin/edit/:fullPath', (req, res) => {
  const fullPath = decodeURIComponent(req.params.fullPath);
  const page = getPageByFullPath(fullPath);
  if (!page) return res.status(404).send('דף לא נמצא');

  // Builder always edits draft_blocks
  const draft = page.draft_blocks != null ? page.draft_blocks : (page.blocks || []);
  const initialBlocks = JSON.stringify(draft);
  const safeTitle = escapeAdmin(page.title || '');
  // The settings drawer follows the direction of the PAGE being edited
  const pageDirection = page.direction === 'ltr' ? 'ltr' : 'rtl';
  const hasUnpublished = JSON.stringify(draft || []) !== JSON.stringify(page.blocks || []);
  const statusLabel = page.status === 'published' ? 'פורסם' : 'טיוטה';
  const badgeBg = page.status === 'published' ? '#dcfce7' : '#fef3c7';
  const badgeFg = page.status === 'published' ? '#166534' : '#92400e';
  const badgeExtra = hasUnpublished ? ' • טיוטה שונה' : '';

  // Toolbox is GENERATED from the block registry (src/block-registry.js),
  // grouped by category — a new block type appears here automatically.
  const toolboxHtml = blockRegistry.BLOCK_CATEGORIES.map(cat => {
    const entries = blockRegistry.BLOCK_REGISTRY.filter(e => e.category === cat && !e.childrenOf);
    if (!entries.length) return '';
    return `<div class="tool-group-label">${escapeAdmin(cat)}</div>` + entries.map(e => `
          <button type="button" class="tool-btn" data-type="${escapeAdmin(e.type)}" title="${escapeAdmin(e.hintHe || e.labelHe)}">
            <span class="tool-ico">${escapeAdmin(e.icon || '•')}</span><span class="tool-meta"><span class="tool-name">${escapeAdmin(e.labelHe)}</span><span class="tool-hint">${escapeAdmin(e.hintHe || '')}</span></span>
          </button>`).join('');
  }).join('');

  const html = `
    <div class="topbar">
      <div class="container topbar-inner">
        <div class="topbar-left">
          <a href="/admin" style="font-weight:700;font-size:1.35rem;text-decoration:none;color:#0f172a">Tapuz</a>
          <button type="button" id="btn-pages-nav" class="btn secondary" style="padding:6px 12px" title="ניווט דפים">☰ דפים</button>
          <input id="page-title" class="page-title" value="${safeTitle}" placeholder="כותרת הדף">
          <span id="publish-badge" style="font-size:0.8rem;padding:3px 10px;border-radius:999px;background:${badgeBg};color:${badgeFg}">${statusLabel}${badgeExtra}</span>
          <select id="page-status" style="display:none">
            <option value="draft" ${page.status === 'draft' ? 'selected' : ''}>טיוטה</option>
            <option value="published" ${page.status === 'published' ? 'selected' : ''}>פורסם</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" onclick="TapuzBuilder.openImportAi()" class="btn secondary" style="padding:8px 12px;border-color:#c7d2fe;color:#4338ca">🤖 ייבא מ‑AI</button>
          <button type="button" onclick="TapuzBuilder.openRevisions()" class="btn secondary" style="padding:8px 12px">היסטוריה</button>
          <a href="/admin/theme" class="btn secondary" style="padding:8px 12px">ערכת נושא</a>
          <a href="/" target="_blank" class="btn secondary" style="padding:8px 12px">צפה באתר</a>
          <button type="button" onclick="TapuzBuilder.savePage()" class="btn" style="padding:8px 14px">שמור טיוטה</button>
          <button type="button" onclick="TapuzBuilder.publishPage()" class="btn js-publish-btn" data-publish-main="1" style="background:#166534;padding:8px 14px">פרסם</button>
          <button type="button" onclick="TapuzBuilder.publishAndBuild()" class="btn js-publish-btn" style="background:#14532d;padding:8px 14px">פרסם + בנה</button>
        </div>
      </div>
    </div>

    <div class="container adv-off" id="builder-root">
      <div class="builder-mode-tabs" role="tablist">
        <button type="button" data-builder-mode="page" class="active" role="tab">
          בונה הדף
          <span class="tab-sub">ויזואלי · גרירה · פשוט ליהנות</span>
        </button>
        <button type="button" data-builder-mode="output" role="tab" class="adv-only">
          קוד BenTML
          <span class="tab-sub">מתקדם · הראו ל‑AI איך הדף בנוי</span>
        </button>
        <button type="button" id="btn-toggle-advanced" class="mode-advanced-toggle" title="כלים מתקדמים — קוד BenTML" aria-pressed="false">⚙ מתקדם</button>
      </div>

      <div class="builder live-page mode-page page-${pageDirection}">
        <aside class="toolbox" aria-label="ארגז מודולים">
          <h4>מודולים</h4>
          <div id="toolbox-mode" class="toolbox-mode">גרור לדף · בחר לעריכה בצד</div>
          ${toolboxHtml}
          <hr style="margin:12px 0;border-color:#e2e8f0">
          <button type="button" class="tool-btn" onclick="TapuzBuilder.openMediaLibrary()" style="border:1px solid #0a66c2;color:#0a66c2">
            <span class="tool-ico">🖼</span><span class="tool-meta"><span class="tool-name">מדיה</span><span class="tool-hint">ספרייה / העלאה</span></span>
          </button>
          <a class="tool-btn" href="/admin/api/syntax-dictionary.md" target="_blank" rel="noopener" style="text-decoration:none;border-style:dashed">
            <span class="tool-ico">📖</span><span class="tool-meta"><span class="tool-name">מילון תחביר</span><span class="tool-hint">לשימוש חיצוני</span></span>
          </a>
          <a class="tool-btn" href="/chat-snippet.txt" download="tapuz-syntax-snippet.txt" style="text-decoration:none;border-style:dashed">
            <span class="tool-ico">📋</span><span class="tool-meta"><span class="tool-name">Snippet חיצוני</span><span class="tool-hint">הורדה לצ׳אט שלהם — לא אצלנו</span></span>
          </a>
        </aside>

        <div id="builder-pane-page" class="builder-canvas-wrap">
          <div class="canvas-header">
            <span>דף חי · טיוטה</span>
            <span id="block-count">${(draft || []).length} מודולים</span>
            <span id="canvas-hint" class="canvas-hint"></span>
          </div>
          <div id="canvas" class="canvas"></div>
          <div id="bentml-output-dock" class="bentml-output-dock adv-only">
            <div class="bentml-output-dock-head">
              <strong>פלט BenTML חי</strong>
              <span class="dock-sub">הקוד נבנה מכללי השפה בזמן שאתם גוררים/עורכים</span>
              <button type="button" class="btn secondary" id="btn-bentml-copy-live">העתק</button>
              <button type="button" class="btn secondary" id="btn-open-output">מסך מלא</button>
              <span id="bentml-live-status" class="bentml-status"></span>
            </div>
            <textarea id="bentml-live-output" readonly dir="ltr" spellcheck="false" aria-label="Live BenTML output"></textarea>
          </div>
        </div>

        <aside class="properties" aria-label="הגדרות מודול">
          <h4>הגדרות</h4>
          <div id="properties-panel">
            <div style="color:#64748b;font-size:0.9rem;padding:30px 10px;text-align:center">
              בחרו מודול בדף · ההגדרות יופיעו כאן<br>
              <span style="font-size:0.8rem">לחצו על טקסט בדף כדי לכתוב · תיהנו מהזרימה ✨</span>
            </div>
          </div>
        </aside>

        <div id="builder-pane-source" class="builder-pane" hidden>
          <div class="bentml-source-bar">
            <strong>פלט BenTML (מסך מלא)</strong>
            <span style="color:#64748b;font-size:0.85rem">decompile ← בונה · compile → בונה</span>
            <button type="button" class="btn secondary" id="btn-bentml-sync">רענן מהדף</button>
            <button type="button" class="btn secondary" id="btn-bentml-copy">העתק</button>
            <button type="button" class="btn" id="btn-bentml-apply">החל פלט → דף</button>
            <span id="bentml-source-status" class="bentml-status"></span>
          </div>
          <p class="output-explain">
            זה לא ״ייבוא בלבד״. <strong>כל גרירה ועריכה בבונה מייצרת מחדש את הקוד</strong> לפי כללי BenTML.
            אפשר גם להדביק כאן מסמך שלם ולהחיל לדף.
          </p>
          <textarea id="bentml-source" spellcheck="false" dir="ltr" aria-label="BenTML output" placeholder="BENTML 0.1&#10;&#10;META {&#10;  title: &quot;...&quot;&#10;}&#10;&#10;TEXT { ... }"></textarea>
        </div>
      </div>
    </div>

    <div class="save-bar">
      <div class="container" style="display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap">
        <button type="button" onclick="TapuzBuilder.savePage()" class="btn">שמור טיוטה</button>
        <button type="button" onclick="TapuzBuilder.publishPage()" class="btn js-publish-btn" data-publish-main="1" style="background:#166534">פרסם</button>
        <button type="button" onclick="TapuzBuilder.publishAndBuild()" class="btn js-publish-btn" style="background:#14532d">פרסם + בנה אתר</button>
      </div>
    </div>

    <div id="media-modal" class="modal" onclick="if (event.target.id === 'media-modal') TapuzBuilder.closeMediaLibrary()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <h3 style="margin-top:0">מספריית מדיה</h3>
        <div id="media-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;max-height:400px;overflow:auto"></div>
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn secondary" onclick="TapuzBuilder.closeMediaLibrary()">סגור</button>
          <label class="btn" style="cursor:pointer">העלה תמונה
            <input type="file" accept="image/*" style="display:none" onchange="TapuzBuilder.uploadMedia(this)">
          </label>
        </div>
      </div>
    </div>

    <div id="pages-nav-modal" class="modal" onclick="if (event.target.id === 'pages-nav-modal') TapuzBuilder.closePagesNav()">
      <div class="modal-content" style="max-width:560px" onclick="event.stopPropagation()">
        <h3 style="margin-top:0">ניווט דפים</h3>
        <input id="pages-nav-search" type="search" placeholder="חיפוש לפי כותרת או נתיב..." style="width:100%;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:12px">
        <div id="pages-nav-list" style="max-height:420px;overflow:auto"></div>
        <div style="margin-top:14px;display:flex;justify-content:space-between;gap:10px">
          <a href="/admin/new" class="btn">+ דף חדש</a>
          <button type="button" class="btn secondary" onclick="TapuzBuilder.closePagesNav()">סגור</button>
        </div>
      </div>
    </div>

    <div id="revisions-modal" class="modal" onclick="if (event.target.id === 'revisions-modal') TapuzBuilder.closeRevisions()">
      <div class="modal-content" style="max-width:560px" onclick="event.stopPropagation()">
        <h3 style="margin-top:0">היסטוריית גרסאות</h3>
        <p style="color:#64748b;font-size:0.9rem;margin-top:0">שמירה אוטומטית בכל שמירה/פרסום. שחזור מעתיק לטיוטה בלבד.</p>
        <div id="revisions-list" style="max-height:420px;overflow:auto"></div>
        <div style="margin-top:14px;text-align:left">
          <button type="button" class="btn secondary" onclick="TapuzBuilder.closeRevisions()">סגור</button>
        </div>
      </div>
    </div>

    <script>
      // Block registry — the client generates the settings forms from this
      window.__TAPUZ_REGISTRY__ = ${JSON.stringify({
        blocks: blockRegistry.BLOCK_REGISTRY,
        categories: blockRegistry.BLOCK_CATEGORIES,
        universalParams: blockRegistry.UNIVERSAL_PARAMS
      })};
    </script>
    <script src="/admin-builder.js"></script>
    <script src="/admin-bentml-ui.js"></script>
    <script>
      TapuzBuilder.init({
        fullPath: ${JSON.stringify(page.full_path)},
        slug: ${JSON.stringify(page.slug || page.full_path)},
        blocks: ${initialBlocks},
        status: ${JSON.stringify(page.status || 'draft')},
        hasUnpublished: ${hasUnpublished ? 'true' : 'false'},
        direction: ${JSON.stringify(pageDirection)},
        tags: ${JSON.stringify(page.tags || [])},
        meta: ${JSON.stringify(page.meta || {})}
      });
    </script>
    <script>
      (function () {
        // Advanced toggle: reveal the BenTML code view (tab + live dock). Off by
        // default and remembered, so customers get the clean visual builder.
        var root = document.getElementById('builder-root');
        var btn = document.getElementById('btn-toggle-advanced');
        if (!root || !btn) return;
        var on = false;
        try { on = localStorage.getItem('tapuz-advanced') === 'on'; } catch (e) {}
        function apply() {
          root.classList.toggle('adv-off', !on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          btn.textContent = on ? '⚙ מתקדם ✓' : '⚙ מתקדם';
        }
        apply();
        btn.addEventListener('click', function () {
          on = !on;
          try { localStorage.setItem('tapuz-advanced', on ? 'on' : 'off'); } catch (e) {}
          // leaving advanced while viewing the code → back to the visual page
          if (!on && window.BentmlUI && window.BentmlUI.setMode) window.BentmlUI.setMode('page');
          apply();
        });
      })();
    </script>
  `;
  res.send(layout(html, 'עריכה • ' + page.title));
});

app.post('/admin/save', (req, res) => {
  try {
    const { full_path, title, blocks, tags, meta, publish, slug } = req.body || {};
    const updates = { title, blocks, publish: !!publish };
    if (Array.isArray(tags)) updates.tags = tags;
    if (meta && typeof meta === 'object') updates.meta = meta;
    // Slug rename (v0.51): auto-follows the page title. A taken address must
    // NEVER block the content save — skip only the rename and flag it, so the
    // page's edits always persist. updatePage handles the .pzn/file rename.
    let slugRejected = false;
    if (typeof slug === 'string' && slug.trim()) {
      const existing = getPageByFullPath(full_path);
      const desired = existing ? generateFullPath(existing.path_prefix || '', slug.trim()) : null;
      if (desired && desired !== full_path) {
        if (getPageByFullPath(desired)) slugRejected = true;
        else updates.slug = slug.trim();
      }
    }
    const page = updatePage(full_path, updates);
    const hasUnpublished = JSON.stringify(page.draft_blocks || []) !== JSON.stringify(page.blocks || []);
    res.json({
      ok: true,
      status: page.status,
      hasUnpublished,
      full_path: page.full_path,
      slugRejected
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/admin/publish', (req, res) => {
  try {
    const { full_path, title, blocks, tags, meta } = req.body || {};
    const updates = {};
    if (title) updates.title = title;
    if (blocks) updates.blocks = blocks;
    if (Array.isArray(tags)) updates.tags = tags;
    if (meta && typeof meta === 'object') updates.meta = meta;
    if (Object.keys(updates).length) {
      updatePage(full_path, updates);
    }
    const page = publishPage(full_path);
    // publish MEANS live (v0.69): the static site is rebuilt right here — the
    // admin never needed to know a separate "build" step existed to see the page
    exportAll();
    res.json({
      ok: true,
      status: page.status,
      hasUnpublished: false,
      full_path: page.full_path,
      liveUrl: '/' + page.full_path
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/admin/build', (req, res) => {
  try {
    const results = exportAll();
    res.json({ ok: true, count: results.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================== THEME BUILDER PAGE ========================
app.get('/admin/theme', (req, res) => {
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
    </div>
    <script>window.TAPUZ_LOOKS = ${JSON.stringify(LOOKS)};</script>
    <script src="/admin-media-picker.js"></script>
    <script src="/admin-theme.js"></script>
  `;
  res.send(layout(html, 'ערכת נושא', '#059669'));
});

// ======================== MENUS EDITOR ========================
app.get('/admin/api/sitemap', (req, res) => {
  try {
    res.json({ ok: true, ...require('./sitemap').buildSitemap() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/admin/sitemap', (req, res) => {
  const { buildSitemap } = require('./sitemap');
  const data = buildSitemap();
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ICONS = { page: '📄', custom: '🔗', tel: '📞', mailto: '✉️', anchor: '⚓' };

  function renderItems(items) {
    if (!items || !items.length) return '';
    return '<ul class="sm-list">' + items.map(it => {
      let badge = '';
      let edit = '';
      if (it.page) {
        badge = it.page.status === 'published'
          ? '<span class="sm-badge sm-pub">פורסם</span>'
          : '<span class="sm-badge sm-draft">טיוטה</span>';
        if (it.page.has_unpublished) badge += '<span class="sm-badge sm-dirty">• שינויים</span>';
        edit = `<a class="sm-edit" href="/admin/edit/${encodeURIComponent(it.page.full_path)}">ערוך</a>`;
      } else if (it.missing) {
        badge = '<span class="sm-badge sm-missing">דף חסר!</span>';
      }
      return `<li><div class="sm-item">${ICONS[it.type] || '🔗'} <strong>${esc(it.label)}</strong>` +
        ` <code>${esc(it.url)}</code>${badge}${edit}</div>${renderItems(it.children)}</li>`;
    }).join('') + '</ul>';
  }

  const menuSections = Object.keys(data.menus).map(name => {
    const title = name === 'main' ? 'תפריט ראשי' : name === 'footer' ? 'תפריט תחתון' : name;
    return `<section class="sm-card"><h3>${esc(title)}</h3>` +
      (data.menus[name].length ? renderItems(data.menus[name]) : '<p class="sm-none">אין פריטים</p>') +
      '</section>';
  }).join('');

  const orphanRows = data.orphans.length
    ? data.orphans.map(p =>
        `<li><div class="sm-item">📄 <strong>${esc(p.title)}</strong> <code>/${esc(p.full_path)}.html</code>` +
        (p.status === 'published'
          ? '<span class="sm-badge sm-pub">פורסם</span>'
          : '<span class="sm-badge sm-draft">טיוטה</span>') +
        (p.has_unpublished ? '<span class="sm-badge sm-dirty">• שינויים</span>' : '') +
        ` <a class="sm-edit" href="/admin/edit/${encodeURIComponent(p.full_path)}">ערוך</a></div></li>`
      ).join('')
    : '<li><div class="sm-item sm-none">כל הדפים מקושרים מתפריט 🎉</div></li>';

  const html = `
    <style>
      .sm-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:18px}
      .sm-card h3{margin-top:0}
      .sm-list{list-style:none;padding-inline-start:22px;margin:6px 0;border-inline-start:2px solid #e2e8f0}
      .sm-card > .sm-list{border-inline-start:none;padding-inline-start:0}
      .sm-item{display:flex;align-items:center;gap:8px;padding:6px 4px;flex-wrap:wrap}
      .sm-item code{background:#f1f5f9;border-radius:5px;padding:2px 7px;font-size:0.8rem;direction:ltr}
      .sm-badge{font-size:0.72rem;border-radius:99px;padding:2px 9px;font-weight:600}
      .sm-pub{background:#dcfce7;color:#166534}
      .sm-draft{background:#fef9c3;color:#854d0e}
      .sm-dirty{background:#fff7ed;color:#b45309}
      .sm-missing{background:#fee2e2;color:#b91c1c}
      .sm-edit{font-size:0.8rem;color:#0a66c2;text-decoration:none}
      .sm-none{color:#64748b}
    </style>
    ${adminNav('sitemap', 'מפת אתר')}
    <div class="container" style="padding-top:28px;max-width:860px">
      <p style="color:#64748b;margin-top:0">המבנה נגזר מהתפריטים. דפים שלא מקושרים מופיעים למטה כיתומים.</p>
      ${menuSections}
      <section class="sm-card"><h3>דפים שלא בתפריט</h3><ul class="sm-list" style="border:none;padding-inline-start:0">${orphanRows}</ul></section>
    </div>
  `;
  res.send(layout(html, 'מפת אתר', '#ea580c'));
});

// ─── /admin/agent — pair the browser bridge (agent tokens) ──────────
app.get('/admin/agent', (req, res) => {
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
  res.send(layout(html, 'גשר סוכן', '#7c3aed'));
});

// ─── Export-file importer (v0.69) — build straight from a vendor export ────
// A dedicated section per vendor (the user declares the format; we never
// guess from the file). WordPress is live; the rest arrive as adapters land.
app.post('/admin/api/import', (req, res) => {
  try {
    const { format, content, publish } = req.body || {};
    if (!format || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ ok: false, error: 'format and content required' });
    }
    let result;
    try {
      result = require('./importers').importFile(content, { format: String(format) });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e.message });
    }
    const { createPage, getPageByFullPath, savePageSource } = require('./pages');
    const created = [];
    for (const page of result.pages) {
      // never clobber — suffix until the slug is free (same rule as decompile)
      let candidate = page.slug;
      for (let n = 2; getPageByFullPath(candidate); n++) candidate = page.slug + '-' + n;
      createPage({ title: page.title, slug: candidate, blocks: [] });
      try {
        savePageSource(candidate, page.source, { publish: !!publish });
      } catch (strictErr) {
        savePageSource(candidate, page.source, { publish: !!publish, repair: true });
      }
      created.push({ title: page.title, fullPath: candidate });
    }
    res.json({ ok: true, format: result.format, count: created.length, created });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'import failed' });
  }
});

app.get('/admin/import', (req, res) => {
  const soon = [
    ['Builder.io', 'קובץ ה‑JSON של Builder.io'],
    ['HubSpot', 'ייצוא HubSpot CMS'],
    ['Camilyo', 'ייצוא Camilyo'],
    ['Mobeart', 'ייצוא Mobeart']
  ].map((v) => `
      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;margin-bottom:14px;opacity:.65">
        <h3 style="margin:0 0 4px">${v[0]} <span style="font-size:.72rem;background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:999px;vertical-align:middle">בקרוב</span></h3>
        <p style="color:#94a3b8;margin:0;font-size:.9rem">${v[1]} — נוסף בקרוב.</p>
      </section>`).join('');
  const html = `
    ${adminNav('import', 'ייבוא — מערכות חיצוניות')}
    <div class="container" style="padding-top:24px;max-width:920px">
      <p style="color:#64748b;margin-top:0">
        בוחרים מערכת, מעלים את קובץ הייצוא — ותפוזיאל בונה את הדפים בשפת ה‑<code>.pzn</code> שלנו.
        לכל מערכת קטע נפרד; אין צורך לנחש איזה קובץ העליתם.
      </p>
      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;margin-bottom:14px">
        <h3 style="margin:0 0 4px">וורדפרס / Elementor <span style="font-size:.72rem;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;vertical-align:middle">פעיל</span></h3>
        <p style="color:#64748b;margin:0 0 12px;font-size:.9rem">קובץ ייצוא <b>WXR</b> (ב‑WordPress: כלים ← ייצוא ← כל התוכן).</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <input type="file" id="wp-file" accept=".xml,.wxr" style="flex:1;min-width:220px">
          <label style="font-size:.9rem;color:#475569"><input type="checkbox" id="wp-publish"> פרסם מיד</label>
          <button type="button" class="btn" data-format="wordpress" data-file="wp-file" data-publish="wp-publish" data-result="wp-result">ייבא</button>
        </div>
        <div id="wp-result" style="margin-top:12px;font-size:.9rem"></div>
      </section>
      ${soon}
    </div>
    <script>
    (function(){
      function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
      document.querySelectorAll('button[data-format]').forEach(function(btn){
        btn.addEventListener('click', function(){
          var fileEl = document.getElementById(btn.dataset.file);
          var pubEl = btn.dataset.publish ? document.getElementById(btn.dataset.publish) : null;
          var out = document.getElementById(btn.dataset.result);
          var f = fileEl && fileEl.files && fileEl.files[0];
          if(!f){ out.innerHTML = '<span style="color:#b91c1c">בחרו קובץ קודם.</span>'; return; }
          var label = btn.textContent; btn.disabled = true; btn.textContent = 'מייבא…';
          var reader = new FileReader();
          reader.onload = function(){
            fetch('/admin/api/import', { method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ format: btn.dataset.format, content: reader.result, publish: pubEl ? pubEl.checked : false }) })
            .then(function(r){return r.json();})
            .then(function(d){
              btn.disabled = false; btn.textContent = label;
              if(!d.ok){ out.innerHTML = '<span style="color:#b91c1c">שגיאה: '+esc(d.error||'')+'</span>'; return; }
              if(!d.count){ out.innerHTML = '<span style="color:#64748b">לא נמצאו דפים לייבוא בקובץ.</span>'; return; }
              var li = d.created.map(function(p){ return '<li><a href="/admin/edit/'+encodeURIComponent(p.fullPath)+'">'+esc(p.title)+'</a> <span style="color:#94a3b8">('+esc(p.fullPath)+')</span></li>'; }).join('');
              out.innerHTML = '<div style="color:#166534;margin-bottom:6px">יובאו '+d.count+' דפים:</div><ul style="margin:0;padding-inline-start:18px">'+li+'</ul>';
            })
            .catch(function(){ btn.disabled=false; btn.textContent=label; out.innerHTML = '<span style="color:#b91c1c">שגיאת רשת.</span>'; });
          };
          reader.readAsText(f);
        });
      });
    })();
    </script>
  `;
  res.send(layout(html, 'ייבוא', '#0891b2'));
});

// ─── /admin/ai — the paste flow (BYO AI subscription, zero keys) ────
app.get('/admin/ai', (req, res) => {
  const html = `
    ${adminNav('chat', 'AI — הדבקה ידנית')}
    <div class="container" style="padding-top:20px;max-width:1180px">
      <a href="/admin/chat" style="font-size:.9rem;color:#7c3aed">← חזרה לבונה החכם (צ׳אט)</a>
      <p style="color:#64748b;margin:8px 0 0">
        משוחחים עם ה‑AI שכבר יש לכם (ChatGPT / Claude / Grok) — בלי מפתחות API ובלי עלות נוספת.
        מעתיקים את המדריך, מבקשים דף, מדביקים את התשובה — והדף קם.
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">1 · למדו את הבוט שלכם</h3>
          <p style="color:#64748b;font-size:.92rem">העתיקו את המדריך והדביקו בצ'אט של ה‑AI שלכם. הוא ילמד לכתוב דפי תפוזיאל.</p>
          <button type="button" id="copy-primer" class="btn">📋 העתק את המדריך</button>
          <span id="primer-status" style="margin-inline-start:10px;color:#16a34a;font-size:.9rem"></span>

          <h3 style="margin-top:26px">2 · הדביקו את התשובה</h3>
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
            <label style="font-size:.92rem;color:#475569">לאיזה דף?</label>
            <select id="page-pick" style="flex:1;padding:8px;border:1px solid #e2e8f0;border-radius:8px">
              <option value="__new__">✨ דף חדש (לפי הכותרת וה-slug שהבוט כתב)</option>
            </select>
          </div>
          <textarea id="paste-box" placeholder="הדביקו כאן את כל תשובת הבוט — אפשר עם הטקסט מסביב, אנחנו נחלץ את הקוד"
            style="width:100%;min-height:260px;box-sizing:border-box;padding:12px;border:1px solid #e2e8f0;border-radius:8px;font-family:ui-monospace,monospace;font-size:.85rem;direction:ltr;text-align:left"></textarea>
          <div id="issue-panel" style="display:none;margin-top:10px;padding:12px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:.9rem;white-space:pre-wrap"></div>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button type="button" id="apply-draft" class="btn" disabled>שמור כטיוטה</button>
            <button type="button" id="apply-publish" class="btn" disabled>שמור ופרסם</button>
          </div>
          <div id="apply-result" style="display:none;margin-top:12px;padding:12px;border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;font-size:.95rem"></div>
        </section>
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">3 · תצוגה מקדימה חיה</h3>
          <iframe id="preview-frame" title="תצוגה מקדימה"
            style="width:100%;height:520px;border:1px solid #e2e8f0;border-radius:8px;background:#fff"></iframe>
        </section>
      </div>
    </div>
    <script src="/admin-ai.js"></script>
  `;
  res.send(layout(html, 'AI', '#0891b2'));
});

app.get('/admin/menus', (req, res) => {
  const menus = loadMenus();
  const html = `
    ${adminNav('menus', 'תפריטים')}
    <div class="container" style="padding-top:28px;max-width:860px">
      <p style="color:#64748b;margin-top:0">תפריט ראשי (header) ותחתון (footer). ישות DB — לא מודול בדף.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">תפריט ראשי</h3>
          <div id="menu-main" class="menu-editor"></div>
          <button type="button" class="btn secondary" style="margin-top:10px" data-add="main">+ פריט</button>
        </section>
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
          <h3 style="margin-top:0">תפריט תחתון</h3>
          <div id="menu-footer" class="menu-editor"></div>
          <button type="button" class="btn secondary" style="margin-top:10px" data-add="footer">+ פריט</button>
        </section>
      </div>
      <div style="margin:24px 0 60px;display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn" id="menu-save">שמור תפריטים</button>
        <button type="button" class="btn" id="menu-save-build" style="background:#166534">שמור + בנה</button>
      </div>
    </div>
    <script>
      window.__TAPUZ_MENUS__ = ${JSON.stringify(menus)};
    </script>
    <script src="/admin-menus.js"></script>
  `;
  res.send(layout(html, 'תפריטים', '#7c3aed'));
});

// =========================================================================
// LANGUAGE INJECTION (v0.55) — /admin/inject + /admin/chat
// The "banger": one button hands any AI the BenTML dictionary as a roleplay
// game pack, so the user's own chat becomes a Site Builder agent (BYOT).
// /admin/inject = copy the pack; /admin/chat = copilot that mints a mission
// the extension injects into the user's logged-in LLM tab and auto-publishes.
// All handlers below inherit the global /admin session + Origin-CSRF gate.
// =========================================================================
app.get('/admin/inject', (req, res) => {
  const html = `
    ${adminNav('chat', 'מילון השפה · משחק בונה האתרים')}
    <style>
      .inj-grid { display:grid; grid-template-columns:1.1fr .9fr; gap:18px; max-width:1100px; margin:0 auto; padding:18px; }
      @media(max-width:860px){ .inj-grid{ grid-template-columns:1fr; } }
      .inj-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:18px; }
      .inj-card h3 { margin-top:0; }
      .inj-card textarea { width:100%; box-sizing:border-box; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:.92rem; margin-top:6px; }
      .tool-list { list-style:none; padding:0; margin:0; max-height:340px; overflow:auto; }
      .tool-list li { padding:6px 0; border-bottom:1px solid #f1f5f9; font-size:.9rem; }
      .tool-list code { background:#f1f5f9; padding:1px 6px; border-radius:4px; }
      .tag { font-size:.7rem; background:#fef3c7; color:#92400e; padding:1px 7px; border-radius:99px; margin-inline-start:4px; }
      .muted { color:#64748b; font-size:.88rem; }
      #preview { background:#0f172a; color:#e2e8f0; border-radius:10px; padding:12px; font:12px/1.45 ui-monospace,monospace;
        max-height:280px; overflow:auto; white-space:pre-wrap; direction:ltr; text-align:left; }
      .ok-msg { color:#166534; } .err-msg { color:#b91c1c; }
      .inj-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    </style>
    <div class="inj-grid">
      <div>
        <div class="inj-card">
          <h3>🎮 הזרקת שפה לסוכן (BYOT)</h3>
          <p class="muted">
            מדביקים חבילת <strong>תפקיד + מילון + כלים</strong> בצ׳אט של ה‑AI שלכם.
            הסוכן משחק <em>בונה אתרים</em> — רק עם כלי ה‑BenTML מהמילון — ומוציא ‎.pzn מלא.
            <br/>אפשר גם בלחיצה אחת מתוך התוסף (הכפתור «① הזרק משחק + מילון»).
          </p>
          <label class="muted">תיאור דף (אופציונלי — נכנס למשחק כמשימה)</label>
          <textarea id="brief" rows="3" placeholder="למשל: דף נחיתה לסטודיו צילום עם הירו, שתי עמודות ו‑CTA"></textarea>
          <div class="inj-actions">
            <button type="button" class="btn" id="btn-roleplay">📋 העתק משחק מלא (תפקיד+כלים+מילון)</button>
            <button type="button" class="btn secondary" id="btn-card">🃏 כרטיס תפקיד קצר</button>
            <button type="button" class="btn secondary" id="btn-dict">📖 מילון בלבד</button>
            <button type="button" class="btn secondary" id="btn-preview">👁 תצוגה</button>
          </div>
          <p id="status" style="margin:10px 0 0;min-height:1.2em"></p>
        </div>
        <div class="inj-card" style="margin-top:14px">
          <h3>תצוגת החבילה</h3>
          <pre id="preview">לחצו «תצוגה»…</pre>
        </div>
      </div>
      <div>
        <div class="inj-card">
          <h3>🧰 מלאי הכלים · <span id="mod-count">—</span></h3>
          <p class="muted">כל מודול = כלי במשחק. נבנה חי מה‑registry.</p>
          <ul class="tool-list" id="tool-list"><li class="muted">טוען…</li></ul>
        </div>
        <div class="inj-card" style="margin-top:14px">
          <h3>הזרימה</h3>
          <ol class="muted" style="line-height:1.65;padding-inline-start:18px">
            <li>העתק משחק מלא → הדבק ב‑AI (או ① בתוסף)</li>
            <li>הסוכן מאשר תפקיד + כלים</li>
            <li>תארו את האתר / הדף (חוקי המשחק)</li>
            <li>קבלו ‎.pzn מלא → תוסף מפרסם / הדביקו ב‑AI</li>
          </ol>
          <p class="muted" style="margin-bottom:0">
            <a href="/admin/chat">צ׳אט סוכן (משימות + תוסף) →</a>
          </p>
        </div>
      </div>
    </div>
    <script src="/admin-inject.js"></script>
  `;
  res.send(layout(html, 'מילון · משחק', '#ea580c'));
});

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
  const opts = { playerBrief: brief, locale, media };
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
            <button type="button" class="btn" id="btn-send">שלח תיאור · בנה משימה</button>
            <button type="button" class="btn secondary" id="btn-teach">📚 העתק לימוד BenTML</button>
          </div>
        </div>
      </div>
      <aside class="chat-side">
        <div class="card">
          <h3 style="margin-top:0">סוכן</h3>
          <div class="field"><label>בחרו מודל (בדפדפן שלכם)</label>
            <select id="provider"></select>
          </div>
          <p class="muted" style="font-size:.85rem;margin:0">השרת לא מחזיק cookies של LLM. התוסף מזריק לצ׳אט שאתם כבר מחוברים אליו.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0">יעד דף</h3>
          <div class="field"><label>כותרת (אופציונלי)</label><input id="page-title" /></div>
          <div class="field"><label>סלאג</label><input id="page-slug" dir="ltr" /></div>
          <div class="field"><label>יעד</label>
            <select id="page-target"><option value="__new__">דף חדש</option></select>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top:0">עוד דרכים לבנות עם AI</h3>
          <p class="muted" style="font-size:.88rem;margin:0 0 6px">כל המסלולים מובילים לאותם דפי BenTML — בחרו מה שנוח:</p>
          <ul class="muted" style="font-size:.88rem;line-height:1.7;padding-inline-start:18px;margin:0">
            <li><a href="/admin/inject">מילון · משחק</a> — העתקת החבילה להדבקה ידנית ב‑AI</li>
            <li><a href="/admin/ai">הדבקה ידנית</a> — הדביקו תשובת AI ובנו דף בתוך ה‑CMS</li>
            <li><a href="/admin/agent">גשר סוכן</a> — חיבור התוסף (פרסום אוטומטי מהצ׳אט)</li>
          </ul>
        </div>
      </aside>
    </div>
    <script src="/admin-chat.js"></script>
  `;
  res.send(layout(html, 'צ׳אט סוכן', '#7c3aed'));
});

app.get('/admin/api/mission/providers', (req, res) => {
  const agentMission = require('./pzn/agent-mission');
  res.json({ ok: true, providers: agentMission.listProviders() });
});

app.post('/admin/api/mission/teach', (req, res) => {
  const { buildRoleplayPack } = require('./pzn/agent-roleplay');
  const agentMission = require('./pzn/agent-mission');
  const media = require('./media').listAllMedia(40);
  const provider = (req.body && req.body.provider) || 'generic';
  // The full roleplay game pack = exactly what the extension ① injects.
  const pack = buildRoleplayPack({ locale: 'he', includeFullDictionary: true, media });
  const meta = agentMission.PROVIDERS[provider] || agentMission.PROVIDERS.generic;
  res.json({
    ok: true,
    message: pack.text,
    kind: 'site-builder-roleplay',
    provider,
    providerLabel: meta.label,
    moduleCount: pack.moduleCount
  });
});

app.post('/admin/api/mission/create', (req, res) => {
  try {
    const { buildRoleplayPack } = require('./pzn/agent-roleplay');
    const agentMission = require('./pzn/agent-mission');
    const missionStore = require('./mission-store');
    const { description, provider, title, slug, targetPage } = req.body || {};
    if (!description || !String(description).trim()) {
      return res.status(400).json({ ok: false, error: 'description required' });
    }
    const p = provider || 'generic';
    const media = require('./media').listAllMedia(40);
    // ① TEACH = full roleplay game + dictionary (the tool inventory) + real media.
    const teachPack = buildRoleplayPack({ locale: 'he', includeFullDictionary: true, media });
    // ② BUILD = the quest with the completion contract (agent already in character).
    const buildMessage = agentMission.buildBuildMessage({ description, title, slug, provider: p });
    // one-shot = the roleplay that already bakes the player brief in as the quest.
    const oneShot = buildRoleplayPack({
      locale: 'he',
      includeFullDictionary: true,
      media,
      playerBrief: [description, title && `title: ${title}`, slug && `slug: ${slug}`]
        .filter(Boolean)
        .join('\n')
    }).text;
    const mission = missionStore.createMission({
      description,
      title,
      slug,
      provider: p,
      teachMessage: teachPack.text,
      buildMessage,
      oneShot,
      targetPage: targetPage || '__new__'
    });
    const meta = agentMission.PROVIDERS[p] || agentMission.PROVIDERS.generic;
    mission.providerUrl = meta.url;
    mission.kind = 'site-builder-roleplay';
    res.json({ ok: true, mission, providerLabel: meta.label, moduleCount: teachPack.moduleCount });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/admin/api/mission/activate/:id', (req, res) => {
  const missionStore = require('./mission-store');
  const m = missionStore.updateMission(req.params.id, { status: 'pending', step: 'teach' });
  if (!m) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, mission: m });
});

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
