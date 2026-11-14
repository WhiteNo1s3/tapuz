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
const jsonFile = require('./json-file');

const AUTH_PATH = path.join(CONFIG_DIR, 'auth.json');

const COOKIE_NAME = 'tapuz_sess';
const IDLE_MS = 60 * 60 * 1000;         // 1h idle timeout (sliding)
const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // 12h absolute cap

// ---------------------------------------------------------------------------
// auth.json persistence
// ---------------------------------------------------------------------------
//
// A MISSING auth.json is a first run. An auth.json that EXISTS and cannot be
// read is an accident, and it fails CLOSED (v2.69): before, a cut-off file
// read as "no accounts", the next request wrote a fresh signing secret over
// it, and /admin/create-account reopened to anyone who found the site. Now
// the file is left exactly as it was found, one copy of it is kept beside it
// (auth.json.corrupt-<stamp>), hasAdmin() keeps answering true so the
// first-admin screen stays shut, and nothing is ever written over it — the
// owner restores the file, and every account is back.
const AUTH_DAMAGED_MESSAGE = 'קובץ החשבונות (config/auth.json) פגום ולא ניתן לקריאה. שום חשבון לא נמחק ושום דבר לא נכתב עליו — שחזרו את הקובץ מגיבוי.';
let damageSeen = '';

function readAuthFile() {
  const r = jsonFile.readJson(AUTH_PATH);
  if (r.state === 'ok' && (!r.data || typeof r.data !== 'object' || Array.isArray(r.data))) {
    return { state: 'corrupt', data: null, error: 'auth.json does not hold an object' };
  }
  return r;
}

// Every request reads the accounts file, so the copy and the two log lines
// happen once per damaged file (its size and time), not once per request.
function noteDamaged(error) {
  let seen = 'unreadable';
  try { const st = fs.statSync(AUTH_PATH); seen = st.size + ':' + st.mtimeMs; } catch (e) { /* keep */ }
  if (seen === damageSeen) return;
  damageSeen = seen;
  const copy = jsonFile.keepCorruptCopy(AUTH_PATH);
  console.error('[auth] config/auth.json exists but cannot be read (' + error + ').');
  console.error('[auth] It was NOT overwritten and no account was removed. Sign-in and first-admin creation stay closed until the file is restored' +
    (copy ? '; a copy of the damaged file is at ' + copy + '.' : '.'));
}

/** 'missing' (first run) | 'ok' | 'corrupt' (exists, unreadable — fail closed). */
function authState() {
  return readAuthFile().state;
}

function loadAuth() {
  const r = readAuthFile();
  if (r.state === 'ok') {
    damageSeen = '';
    if (!Array.isArray(r.data.users)) r.data.users = [];
    return r.data;
  }
  if (r.state === 'corrupt') noteDamaged(r.error);
  return { users: [] };
}

function saveAuth(data) {
  // never over a damaged file: what is in it may be every account the site has
  if (readAuthFile().state === 'corrupt') {
    const err = new Error(AUTH_DAMAGED_MESSAGE);
    err.code = 'E_STORE_DAMAGED';
    throw err;
  }
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // whole file or none of it, and private from its first byte (0600)
  jsonFile.writeAtomic(AUTH_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
  // Best-effort tighten permissions (POSIX only; a no-op on Windows).
  try { fs.chmodSync(AUTH_PATH, 0o600); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Server signing secret
// ---------------------------------------------------------------------------
// While auth.json is damaged the real secret is unknown and must not be
// replaced on disk, so sessions are signed with a key that lives only in this
// process: nobody can sign in anyway, and the moment the file is restored the
// real secret (and every session it signed) is back.
let memorySecret = '';

function getSecret() {
  if (process.env.TAPUZ_ADMIN_SECRET) return process.env.TAPUZ_ADMIN_SECRET;
  const r = readAuthFile();
  if (r.state === 'corrupt') {
    noteDamaged(r.error);
    if (!memorySecret) memorySecret = crypto.randomBytes(32).toString('hex');
    return memorySecret;
  }
  const data = r.state === 'ok' ? r.data : { users: [] };
  if (!Array.isArray(data.users)) data.users = [];
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
  // a damaged accounts file is NOT "no accounts": answering false here is
  // what used to reopen the first-admin screen (see loadAuth above)
  const r = readAuthFile();
  if (r.state === 'corrupt') { noteDamaged(r.error); return true; }
  return r.state === 'ok' && Array.isArray(r.data.users) && r.data.users.length > 0;
}

// ---------------------------------------------------------------------------
// First-run setup code (v2.69)
//
// On a root with no account, whoever reaches /admin/create-account first
// becomes the owner — and a demo boot publishes a site on exactly such a
// root. So the first account needs a code only the person who started the
// server can know: TAPUZ_SETUP_TOKEN when the host sets it, otherwise a code
// made at boot and printed once in the server log. With the boot code, a
// browser on the server's own machine (http-util.isLoopbackRequest) needs
// none when the server was started in a terminal (interactiveRun below) —
// local development and `npm run seed:admin` work as they always did; a
// hosted process, and a token the host set, ask it of everyone
// (routes/auth-screens.js says why).
// ---------------------------------------------------------------------------
const SETUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: it is read off a log and typed
let bootSetupCode = '';

function setupCode() {
  const fromEnv = String(process.env.TAPUZ_SETUP_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  if (!bootSetupCode) {
    const bytes = crypto.randomBytes(10);
    let s = '';
    for (let i = 0; i < 10; i++) s += SETUP_ALPHABET[bytes[i] % SETUP_ALPHABET.length];
    bootSetupCode = s.slice(0, 5) + '-' + s.slice(5);
  }
  return bootSetupCode;
}

/** Where the code comes from — the boot log says which. */
function setupCodeSource() {
  return String(process.env.TAPUZ_SETUP_TOKEN || '').trim() ? 'env' : 'boot';
}

/**
 * Somebody started this server in a terminal and is looking at its output —
 * the only kind of run in which "a browser on this machine" may be taken for
 * the owner and let past the setup code. A hosted process has no terminal
 * (its output is a pipe or a log file), and no environment variable can say
 * otherwise: there is nothing here for a host to switch on by accident.
 */
function interactiveRun() {
  return !!(process.stdout && process.stdout.isTTY);
}

/** Constant-time; a code typed in lower case or without the dash still matches a boot code. */
function checkSetupCode(input) {
  const want = setupCode();
  let got = String(input == null ? '' : input).trim();
  if (!got) return false;
  if (setupCodeSource() === 'boot') {
    got = got.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (got.length === 10) got = got.slice(0, 5) + '-' + got.slice(5);
  }
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
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
    // a cookie that is not valid percent-encoding ('%zz' from another app on
    // the same host) is kept as it was sent — decodeURIComponent throws on
    // it, and one stray cookie must not turn every admin request into a 500
    const value = part.slice(i + 1).trim();
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch (e) { /* keep the raw text */ }
    out[part.slice(0, i).trim()] = decoded;
  });
  return out;
}

// The forwarded scheme is read in one place (http-util.forwardedProto: the
// last entry, the one the nearest proxy wrote), so this answer and the origin
// the sitemap prints can never disagree about the same header.
function isHttps(req) {
  return !!(req && (req.secure || require('./http-util').forwardedProto(req) === 'https'));
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
  // the accounts file itself (v2.69): missing / ok / corrupt, and what to tell the owner
  authState,
  AUTH_DAMAGED_MESSAGE,
  // first-run setup code (v2.69)
  setupCode,
  setupCodeSource,
  interactiveRun,
  checkSetupCode,
  isHttps,
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
  // password primitives (exported for tests + customer portal)
  hashPassword,
  verifyPassword,
  getSecret,
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
