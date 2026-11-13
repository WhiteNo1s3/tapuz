'use strict';

/**
 * Small, pure request helpers shared across server.js and the route modules
 * being extracted from it (v0.97 — continuing the docs/ARCHITECTURE.md plan).
 * No Express app state, no session/DB I/O — safe for anything to require.
 */

// TAPUZ_TRUST_PROXY: only trust X-Forwarded-For when explicitly told to (the
// deploy sits behind a real reverse proxy) — otherwise a client could forge
// the header and evade rate limits / IP-keyed locks. When trusted, take the
// hop the proxy actually appended (rightmost), never the leftmost, which the
// client can still forge even through a real proxy.
//
// v2.69 — the flag counts hops. `1` / `true` keep their meaning (one proxy:
// the rightmost entry). `2` is an edge CDN in front of an origin proxy — the
// shape of the usual shared host — where the rightmost entry is the CDN's own
// node, shared by every visitor, and the visitor is the entry before it.
// Read on every call (a tiny string) so a test can change it in-process.
function trustedHops() {
  const raw = String(process.env.TAPUZ_TRUST_PROXY || '').trim().toLowerCase();
  if (raw === 'true') return 1;
  if (!/^\d{1,2}$/.test(raw)) return 0;
  return parseInt(raw, 10);
}

const TRUST_PROXY = trustedHops() > 0;

// One line, once: a request that carries X-Forwarded-For while the flag is
// off means a proxy IS in front and nobody told us. Then the login lockout
// and every public limiter are keyed on the proxy's address — six bad logins
// by anyone lock the owner out, and eight checkouts a minute is the whole
// site's ceiling. Silence here is how that stays unnoticed for months.
let warnedUntrusted = false;
function noteForwarded(req) {
  if (warnedUntrusted || trustedHops() > 0) return;
  if (!req || !req.headers || !req.headers['x-forwarded-for']) return;
  warnedUntrusted = true;
  console.warn('[proxy] a request arrived with X-Forwarded-For, but TAPUZ_TRUST_PROXY is not set: the login lockout and ' +
    'every rate limit are keyed on the proxy\'s address, so all visitors share one bucket. Set TAPUZ_TRUST_PROXY to the ' +
    'number of proxies in front of this server (1; 2 for a CDN plus an origin proxy).');
}

function clientIp(req) {
  const n = trustedHops();
  if (n > 0) {
    const hops = (req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
    // fewer entries than trusted proxies: every entry was written by a proxy
    // we trust, so the oldest one is the best answer there is
    if (hops.length) return hops[Math.max(0, hops.length - n)];
  } else {
    noteForwarded(req);
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Every visitor of this request's kind arrives with ONE address: a proxy is
 * in front (the request carries X-Forwarded-For) and nobody told us to
 * believe it, so clientIp() answers the proxy's own address for all of them.
 * A lock or a cap keyed on that address is a lock on the whole site — six
 * wrong passwords by a stranger shut the owner out of his own admin, and one
 * visitor's shut every customer out of the portal (v2.69 review). The
 * sign-in doors ask this before they key anything on the address; with the
 * flag set, or with no forwarding header, the address is a visitor's own and
 * nothing changes.
 */
function sharedAddress(req) {
  return trustedHops() === 0 && !!(req && req.headers && req.headers['x-forwarded-for']);
}

/**
 * The scheme the proxy in front of us says the request came in on: 'https',
 * 'http', or '' when it says nothing usable. ONE reading for everyone — the
 * LAST entry of X-Forwarded-Proto, trimmed and lower-cased, compared whole.
 * A proxy that appends writes last, so the last entry is the one the nearest
 * proxy wrote and the entries before it are whatever the client sent. The
 * session cookie's Secure flag (auth.isHttps) used to compare the raw header
 * to 'https', and the sitemap's origin used to take the FIRST entry: a
 * header of "https, http" gave one answer to each. Whether to believe the
 * header at all stays the caller's decision.
 */
function forwardedProto(req) {
  const raw = String((req && req.headers && req.headers['x-forwarded-proto']) || '');
  const last = raw.split(',').pop().trim().toLowerCase();
  return last === 'https' || last === 'http' ? last : '';
}

/**
 * The origin a visitor is on — 'https://host', never a path. The configured
 * base URL wins; else, when the proxy is trusted, the scheme the proxy saw
 * (forwardedProto above) with the Host it passed through; else
 * the connection's own. Before v2.69 every caller spelled
 * `req.protocol + '://' + host`, which is always http behind a TLS proxy —
 * the live sitemap printed http:// addresses for an https site.
 */
function requestOrigin(req) {
  try {
    const base = String(require('./config').loadConfig().baseUrl || '').trim();
    if (base) {
      const u = new URL(base);
      if (/^https?:$/.test(u.protocol)) return u.origin;
    }
  } catch (e) { /* no usable base URL — fall through to the request */ }
  const host = String((req.headers && req.headers.host) || '').trim();
  let proto = '';
  if (trustedHops() > 0) proto = forwardedProto(req);
  if (!proto) proto = req.protocol || ((req.socket && req.socket.encrypted) ? 'https' : 'http');
  return proto + '://' + host;
}

/**
 * A browser on the server's own machine — the one caller who may create the
 * first account without the setup code. Four things must all hold, because
 * a reverse proxy on the same box makes EVERY visitor's socket loopback: the
 * socket is loopback, nothing in the request says it was forwarded, the
 * request is HTTP/1.1 or newer (no browser speaks 1.0, and a stock nginx
 * `proxy_pass http://127.0.0.1:3000` does — while also rewriting Host to that
 * very address and adding no forwarding header), and the address typed was
 * localhost itself.
 */
const FORWARD_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'via', 'cf-connecting-ip', 'true-client-ip'];
// a literal loopback address, whole — "127.shop.example" is a host NAME
function isLoopbackAddress(addr) {
  const a = String(addr || '').toLowerCase().replace(/^::ffff:/, '');
  return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}
function isLoopbackRequest(req) {
  if (!req || !req.socket || !isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (req.httpVersionMajor !== undefined && (req.httpVersionMajor < 1 || (req.httpVersionMajor === 1 && req.httpVersionMinor < 1))) return false;
  const h = req.headers || {};
  for (const name of FORWARD_HEADERS) if (h[name]) return false;
  const host = String(h.host || '').trim().toLowerCase();
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  return name === 'localhost' || name.endsWith('.localhost') || isLoopbackAddress(name);
}

function wantsJson(req) {
  return req.path.startsWith('/admin/api') ||
    (req.headers.accept || '').indexOf('application/json') >= 0 ||
    (req.headers['content-type'] || '').indexOf('application/json') >= 0;
}

function isStateChanging(method) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/**
 * A request-level failure, in the server log with the address that hit it.
 * Most route catches answer `e.message` to the client and log nothing, so a
 * broken screen left no trace anywhere; a 500 branch calls this first.
 */
function logError(req, err) {
  const where = req ? (req.method + ' ' + (req.originalUrl || req.url || '').split('?')[0]) : '?';
  console.error('[http] ' + where + ': ' + ((err && (err.stack || err.message)) || String(err)));
}

module.exports = {
  TRUST_PROXY, trustedHops, noteForwarded, clientIp, sharedAddress, forwardedProto, requestOrigin, isLoopbackRequest,
  wantsJson, isStateChanging, logError
};
