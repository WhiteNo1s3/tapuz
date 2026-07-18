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

module.exports = { TRUST_PROXY, clientIp, wantsJson, isStateChanging };
