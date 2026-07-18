// Admin authentication for Tapuz (S1) + configurable admin base path (S2).
//
// ZERO external deps — Node's built-in `crypto` only:
//   * scrypt         -> password hashing with a random per-user salt
//   * HMAC-SHA256    -> stateless signed session cookies
//   * timingSafeEqual-> constant-time comparison (passwords + signatures)
//
// Secrets live OUTSIDE the web-served config, in config/auth.json, which is
// gitignored. The server signing secret can also be supplied via the
// TAPUZ_ADMIN_SECRET env var (which then takes precedence and is never
// written to disk). NEVER put a plaintext password anywhere — only scrypt
// hashes are stored.
//
// auth.json shape:
//   {
//     "secret": "<hex>",                // session signing key (omit if using env)
//     "users": [
//       { "id": "...", "username": "...", "passwordHash": "salt:hash", "createdAt": "ISO" }
//     ]
//   }

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');
const { loadConfig } = require('./config');

const AUTH_PATH = path.join(CONFIG_DIR, 'auth.json');

const COOKIE_NAME = 'tapuz_sess';
const IDLE_MS = 60 * 60 * 1000;         // 1h idle timeout (sliding)
const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // 12h absolute cap

// ---------------------------------------------------------------------------
// auth.json persistence
// ---------------------------------------------------------------------------
function loadAuth() {
  try {
    if (fs.existsSync(AUTH_PATH)) {
      const data = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
      if (!Array.isArray(data.users)) data.users = [];
      return data;
    }
  } catch (e) { /* fall through to fresh */ }
  return { users: [] };
}

function saveAuth(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2), 'utf8');
  // Best-effort tighten permissions (POSIX only; a no-op on Windows).
  try { fs.chmodSync(AUTH_PATH, 0o600); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Server signing secret
// ---------------------------------------------------------------------------
function getSecret() {
  if (process.env.TAPUZ_ADMIN_SECRET) return process.env.TAPUZ_ADMIN_SECRET;
  const data = loadAuth();
  if (!data.secret) {
    data.secret = crypto.randomBytes(32).toString('hex');
    saveAuth(data);
  }
  return data.secret;
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt + random salt) and constant-time verify
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  try {
    const [saltHex, hashHex] = String(stored).split(':');
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Admin accounts + roles (v0.95 — user roles, the WP/Drupal parity gap)
//
// Two roles: 'admin' (everything, incl. security-sensitive settings — SMTP
// credentials, AI keys, agent bridge tokens, team management) and 'editor'
// (content/media/pages — the day-to-day site work). Accounts created before
// roles existed have no `role` field on disk; roleOf() treats that as
// 'admin' so nobody's access silently narrows on upgrade.
// ---------------------------------------------------------------------------
const ROLES = ['admin', 'editor'];

function roleOf(user) {
  return user && ROLES.includes(user.role) ? user.role : 'admin';
}

function hasAdmin() {
  return loadAuth().users.length > 0;
}

function findUser(username) {
  const u = String(username || '').trim().toLowerCase();
  return loadAuth().users.find(x => x.username.toLowerCase() === u) || null;
}

function findUserById(id) {
  const user = loadAuth().users.find(x => x.id === id) || null;
  return user ? { id: user.id, username: user.username, role: roleOf(user), createdAt: user.createdAt } : null;
}

/** Every account, newest-created last. Never includes password hashes. */
function listUsers() {
  return loadAuth().users.map(u => ({ id: u.id, username: u.username, role: roleOf(u), createdAt: u.createdAt }));
}

function countAdmins(users) {
  return users.filter(u => roleOf(u) === 'admin').length;
}

/**
 * Create an admin account. The USER supplies username + password via the
 * first-run flow — a password is NEVER hardcoded here. Always role 'admin'
 * (it's the site's first, sole account at the moment this runs).
 */
function createAdmin(username, password) {
  const name = String(username || '').trim();
  const pw = String(password || '');
  if (name.length < 2) throw new Error('שם משתמש קצר מדי');
  if (pw.length < 8) throw new Error('הסיסמה חייבת להכיל לפחות 8 תווים');
  const data = loadAuth();
  if (data.users.some(x => x.username.toLowerCase() === name.toLowerCase())) {
    throw new Error('שם המשתמש כבר קיים');
  }
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    username: name,
    passwordHash: hashPassword(pw),
    role: 'admin',
    createdAt: new Date().toISOString()
  };
  data.users.push(user);
  saveAuth(data);
  return { id: user.id, username: user.username, role: user.role };
}

/**
 * Invite a teammate (admin-only action, enforced by the caller/route layer).
 * @param {string} role 'admin' | 'editor' — unrecognized falls back to 'editor'
 *   (the least-privilege default for anyone this function doesn't recognize).
 */
function addTeamMember(username, password, role) {
  const name = String(username || '').trim();
  const pw = String(password || '');
  const r = ROLES.includes(role) ? role : 'editor';
  if (name.length < 2) throw new Error('שם משתמש קצר מדי');
  if (pw.length < 8) throw new Error('הסיסמה חייבת להכיל לפחות 8 תווים');
  const data = loadAuth();
  if (data.users.some(x => x.username.toLowerCase() === name.toLowerCase())) {
    throw new Error('שם המשתמש כבר קיים');
  }
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    username: name,
    passwordHash: hashPassword(pw),
    role: r,
    createdAt: new Date().toISOString()
  };
  data.users.push(user);
  saveAuth(data);
  return { id: user.id, username: user.username, role: r };
}

/** Guards the last admin standing — a site can never lock itself out. */
function setUserRole(id, role) {
  if (!ROLES.includes(role)) throw new Error('תפקיד לא מוכר');
  const data = loadAuth();
  const user = data.users.find(u => u.id === id);
  if (!user) throw new Error('משתמש לא נמצא');
  if (roleOf(user) === 'admin' && role !== 'admin' && countAdmins(data.users) <= 1) {
    throw new Error('לא ניתן להוריד את המנהל האחרון מתפקידו');
  }
  user.role = role;
  saveAuth(data);
  return { id: user.id, username: user.username, role };
}

/** Guards the last admin standing — same invariant as setUserRole. */
function removeUser(id) {
  const data = loadAuth();
  const user = data.users.find(u => u.id === id);
  if (!user) throw new Error('משתמש לא נמצא');
  if (roleOf(user) === 'admin' && countAdmins(data.users) <= 1) {
    throw new Error('לא ניתן למחוק את המנהל האחרון');
  }
  data.users = data.users.filter(u => u.id !== id);
  saveAuth(data);
  return true;
}

/** Returns the user record on success, or null. Constant-time on the password. */
function verifyLogin(username, password) {
  const user = findUser(username);
  if (!user) {
    // Still run a hash to reduce username-enumeration timing signal.
    hashPassword(String(password || ''));
    return null;
  }
  return verifyPassword(password, user.passwordHash)
    ? { id: user.id, username: user.username, role: roleOf(user) }
    : null;
}

// ---------------------------------------------------------------------------
// Stateless signed session cookies (HMAC-SHA256)
// ---------------------------------------------------------------------------
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadStr) {
  return b64url(crypto.createHmac('sha256', getSecret()).update(payloadStr).digest());
}

function makeToken(uid, iat) {
  const now = Date.now();
  const payload = { uid, iat: iat || now, exp: now + IDLE_MS };
  const body = b64url(JSON.stringify(payload));
  return body + '.' + sign(body);
}

/** Verify a raw cookie token. Returns { uid, iat } or null. */
function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')); } catch (e) { return null; }
  const now = Date.now();
  if (!payload || !payload.uid) return null;
  if (typeof payload.exp !== 'number' || now > payload.exp) return null;       // idle timeout
  if (typeof payload.iat !== 'number' || now > payload.iat + MAX_SESSION_MS) return null; // absolute cap
  return { uid: payload.uid, iat: payload.iat };
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------
function parseCookies(req) {
  const out = {};
  const raw = req.headers && req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isHttps(req) {
  return req.secure || (req.headers && req.headers['x-forwarded-proto'] === 'https');
}

/** Read + verify the session from the request. Returns { uid, iat } or null. */
function verifySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  return verifyToken(token);
}

/**
 * Issue (or slide) the session cookie. Pass the original `iat` when renewing
 * so the absolute cap still applies; omit it on fresh login.
 */
function issueSession(res, uid, req, iat) {
  const token = makeToken(uid, iat);
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(IDLE_MS / 1000)}`
  ];
  if (req && isHttps(req)) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSession(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ---------------------------------------------------------------------------
// CSRF defense: SameSite=Lax cookie + strict Origin/Referer check.
// (This is the chosen mechanism — see docs/security.md. We do NOT use a
//  double-submit token because the ~50 existing admin XHRs are same-origin
//  and Origin/Referer verification protects them all without client changes.)
// ---------------------------------------------------------------------------
function hostFromUrl(u) {
  try { return new URL(u).host; } catch (e) { return null; }
}

/** True if the request's Origin/Referer matches its Host (same-origin). */
function sameOrigin(req) {
  const host = req.headers.host;
  if (!host) return false;
  const origin = req.headers.origin;
  if (origin) return hostFromUrl(origin) === host;
  const referer = req.headers.referer || req.headers.referrer;
  if (referer) return hostFromUrl(referer) === host;
  // No Origin and no Referer on a state-changing request: reject. Modern
  // browsers always send at least one for form/fetch POSTs.
  return false;
}

// ---------------------------------------------------------------------------
// Configurable admin base path (S2)
// ---------------------------------------------------------------------------
//
// HOW TO CHANGE THE ADMIN URL:
//   * Env (highest priority, keeps it out of git):  TAPUZ_ADMIN_PATH=/manage-x7q
//   * Or in config/site.json:  { "admin": { "path": "/manage-x7q" } }
// Default is '/admin'. A malformed value falls back to '/admin' so a typo can
// never brick the server. This is a security-by-OBSCURITY layer that sits on
// TOP of real authentication — never a replacement for it.
//
function sanitizeAdminPath(raw) {
  let p = String(raw || '').trim();
  if (!p) return '/admin';
  if (p[0] !== '/') p = '/' + p;
  p = p.replace(/\/+$/, '');                 // no trailing slash
  // Single clean segment (or nested) of safe chars only.
  if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(p)) return '/admin';
  if (p.length < 2 || p.length > 64) return '/admin';
  return p;
}

function getAdminBase() {
  if (process.env.TAPUZ_ADMIN_PATH) return sanitizeAdminPath(process.env.TAPUZ_ADMIN_PATH);
  let cfgPath = '/admin';
  try {
    const cfg = loadConfig();
    if (cfg.admin && cfg.admin.path) cfgPath = cfg.admin.path;
  } catch (e) { /* default */ }
  return sanitizeAdminPath(cfgPath);
}

module.exports = {
  AUTH_PATH,
  COOKIE_NAME,
  IDLE_MS,
  MAX_SESSION_MS,
  // accounts
  hasAdmin,
  createAdmin,
  verifyLogin,
  findUser,
  // roles / team (v0.95)
  ROLES,
  roleOf,
  findUserById,
  listUsers,
  addTeamMember,
  setUserRole,
  removeUser,
  // password primitives (exported for tests)
  hashPassword,
  verifyPassword,
  // sessions
  verifySession,
  issueSession,
  clearSession,
  verifyToken,
  makeToken,
  // csrf
  sameOrigin,
  // admin path
  getAdminBase,
  sanitizeAdminPath
};
