'use strict';

/**
 * The admin auth gate — the single place that gates the entire /admin
 * namespace (rate limit → CSRF → session → role resolution). Extracted
 * from server.js in v1.11 (docs/ARCHITECTURE.md's last piece of "genuine
 * design risk, not mechanical work"): the LOGIC moved out, but server.js
 * still registers this exact middleware at the EXACT same point in its
 * chain — after the static mounts (so root-served admin client JS/public
 * files are untouched), before every '/admin/*' route. Registration order
 * here is load-bearing; only the code moved, never the wiring.
 */

const auth = require('./auth');
const { clientIp, wantsJson, isStateChanging } = require('./http-util');
const { FixedWindowLimiter } = require('./ratelimit');

const adminLimiter = new FixedWindowLimiter({ windowMs: 60 * 1000, max: 300 }); // general admin flood cap

function adminGate(req, res, next) {
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
  // v0.95: resolve the account's role once here so every route downstream
  // can trust req.adminUser.role without its own auth.json lookup. A user
  // deleted mid-session (findUserById → null) degrades to role 'editor',
  // the least-privilege default, rather than silently keeping admin power.
  const account = auth.findUserById(session.uid);
  req.adminUser = {
    uid: session.uid,
    iat: session.iat,
    username: account ? account.username : '',
    role: account ? account.role : 'editor'
  };
  next();
}

module.exports = { adminGate, adminLimiter };
