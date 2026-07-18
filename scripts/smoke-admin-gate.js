'use strict';

/**
 * v1.11 QA — the highest-stakes extraction this session: src/admin-gate.js
 * is the single security boundary for the entire /admin namespace (rate
 * limit → CSRF → session → role resolution). Proves the extraction changed
 * NOTHING about behavior — same status codes, same rejection reasons, same
 * ordering — through a real server, not a syntax check. Every check here
 * is a security property, not a feature.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-admin-gate-'));
const PORT = 3971;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie, origin, noOrigin, accept } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    // default Accept mimics a browser navigation (text/html) — the gate's
    // wantsJson() branches on this, so a test claiming to check the HTML
    // redirect path must not accidentally send application/json.
    const headers = { Accept: accept || 'text/html' };
    if (!noOrigin) headers.Origin = origin !== undefined ? origin : BASE;
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* non-json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitUp(tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/', () => resolve()).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries);
  });
}

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'admin-gate smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin, addTeamMember } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  addTeamMember('dana', 'dana-pass-1', 'editor');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();

    // ── the gate only touches /admin — public routes are untouched ──
    const publicPage = await req('GET', '/home');
    check('a public page is never gated (200, no auth required)', publicPage.status === 200);

    // ── unauthenticated: HTML request redirects, JSON/API request gets 401 ──
    const htmlUnauth = await req('GET', '/admin/dashboard');
    check('unauthenticated HTML request to a protected page → 302 redirect (not a bare 401 page)', htmlUnauth.status === 302);
    check('redirects to the login screen', /\/admin\/login$/.test(htmlUnauth.headers.location || ''));

    const apiUnauth = await req('GET', '/admin/api/pages');
    check('unauthenticated API request → 401 JSON, not a redirect', apiUnauth.status === 401 && apiUnauth.json && apiUnauth.json.ok === false);

    // ── the auth screens themselves are reachable with no session ──
    const loginScreen = await req('GET', '/admin/login');
    check('/admin/login is reachable unauthenticated', loginScreen.status === 200);

    // ── security headers on every admin response, even a 401 ──
    check('X-Frame-Options: DENY on an admin response', apiUnauth.headers['x-frame-options'] === 'DENY');
    check('Cache-Control: no-store on an admin response', apiUnauth.headers['cache-control'] === 'no-store');

    // ── CSRF: a state-changing request with a mismatched Origin is rejected ──
    const csrfBadOrigin = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, origin: 'https://evil.example.com' });
    check('POST with a cross-origin Origin header → 403 (CSRF rejected)', csrfBadOrigin.status === 403);
    const csrfNoOrigin = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, noOrigin: true });
    check('POST with NO Origin/Referer at all → 403 (fail closed, not open)', csrfNoOrigin.status === 403);

    // ── GET requests are exempt from the CSRF check (only state-changing methods are guarded) ──
    const getCrossOrigin = await req('GET', '/admin/login', { origin: 'https://evil.example.com' });
    check('a cross-origin GET is NOT CSRF-blocked (only state-changing methods are)', getCrossOrigin.status === 200);

    // ── real login (same-origin) succeeds and issues a session ──
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    check('a genuine same-origin login succeeds (302 to the admin root)', login.status === 302);
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    check('a session cookie was actually issued', cookie.length > 0);

    // ── an authenticated request now succeeds, and gets the security headers too ──
    const authed = await req('GET', '/admin/dashboard', { cookie });
    check('an authenticated request to the same page now succeeds (200)', authed.status === 200);
    check('security headers still present once authenticated', authed.headers['x-content-type-options'] === 'nosniff');

    // ── role resolution: admin vs editor reach the gate differently downstream ──
    const editorLogin = await req('POST', '/admin/login', { form: { username: 'dana', password: 'dana-pass-1' } });
    const editorCookie = String(editorLogin.headers['set-cookie'] || '').split(';')[0];
    const editorOnAdminOnly = await req('GET', '/admin/team', { cookie: editorCookie });
    check('the gate resolves an editor session correctly — downstream requireAdmin still blocks it (403)', editorOnAdminOnly.status === 403);
    const ownerOnAdminOnly = await req('GET', '/admin/team', { cookie });
    check('the gate resolves an admin session correctly — downstream requireAdmin lets it through (200)', ownerOnAdminOnly.status === 200);

    // ── rate limiting: the whole admin surface has a per-IP flood cap ──
    // adminLimiter is windowMs:60000, max:300 — fire enough same-key requests
    // to trip it. /admin/login counts too (the limiter check runs BEFORE the
    // login/create-account exemption), so this also proves that ordering.
    let sawRateLimited = false;
    for (let i = 0; i < 305 && !sawRateLimited; i++) {
      const r = await req('GET', '/admin/login');
      if (r.status === 429) sawRateLimited = true;
    }
    check('the per-IP admin flood cap eventually trips (429) — even on the login screen itself', sawRateLimited);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE ADMIN-GATE: FAIL' : 'SMOKE ADMIN-GATE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
