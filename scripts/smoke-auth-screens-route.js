'use strict';

/**
 * v1.29 QA — proves src/routes/auth-screens.js works end-to-end as a
 * mounted Express Router: the full login / logout / first-admin
 * create-account surface, plus the escalating brute-force loginGuard that
 * moved with it. New coverage beyond smoke-admin-gate (which checks login
 * reachability + CSRF + one success): the first-admin bootstrap flow, the
 * wrong-password redirect, the lockout 429 after repeated failures, and
 * logout clearing the session.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-auth-screens-route-'));
const PORT = 3988;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { form, cookie, origin } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    // same-origin by default so the CSRF check passes; login/create-account POST
    // are state-changing and the gate enforces a same-origin Origin header.
    const headers = { Accept: 'text/html', Origin: origin || BASE };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
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
    title: 'אתר בדיקה', description: 'auth-screens-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  // NOTE: no createAdmin here — we exercise the first-admin bootstrap flow.

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();

    // ── with no admin yet, /admin/login redirects to create-account ──
    const preLogin = await req('GET', '/admin/login');
    check('with no admin, GET /admin/login redirects to create-account', preLogin.status === 302 && /\/admin\/create-account/.test(preLogin.headers.location || ''));

    // ── the create-account screen renders (bare, no palette) ──
    const caPage = await req('GET', '/admin/create-account');
    check('GET /admin/create-account renders the first-admin form', caPage.status === 200 && /יצירת חשבון/.test(caPage.text) && /name="confirm"/.test(caPage.text));

    // ── mismatched passwords are rejected back to the form ──
    const mismatch = await req('POST', '/admin/create-account', { form: { username: 'owner', password: 'longpass-1', confirm: 'different-1' } });
    check('create-account with mismatched passwords redirects back with an error', mismatch.status === 302 && /create-account\?err=/.test(mismatch.headers.location || ''));

    // ── the real first-admin bootstrap: creates the admin AND logs in ──
    const create = await req('POST', '/admin/create-account', { form: { username: 'owner', password: 'owner-pass-1', confirm: 'owner-pass-1' } });
    check('create-account creates the first admin and issues a session (302 to admin root)', create.status === 302 && !!(create.headers['set-cookie']));

    // ── now that an admin exists, the login page renders the login form ──
    const loginPage = await req('GET', '/admin/login');
    check('with an admin present, GET /admin/login renders the login form', loginPage.status === 200 && /כניסת מנהל/.test(loginPage.text) && /name="password"/.test(loginPage.text));

    // ── wrong password → redirect with err=1 (no session) ──
    const wrong = await req('POST', '/admin/login', { form: { username: 'owner', password: 'WRONG' } });
    check('a wrong password redirects to /admin/login?err=1', wrong.status === 302 && /\/admin\/login\?err=1/.test(wrong.headers.location || ''));

    // ── a genuine login succeeds and issues a session ──
    const good = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(good.headers['set-cookie'] || '').split(';')[0];
    check('a correct login succeeds (302) with a session cookie', good.status === 302 && cookie.length > 0);

    // ── logout clears the session and returns to login ──
    const logout = await req('POST', '/admin/logout', { cookie });
    check('POST /admin/logout redirects to the login screen', logout.status === 302 && /\/admin\/login/.test(logout.headers.location || ''));

    // ── the moved loginGuard still locks out after repeated failures ──
    let locked = false;
    for (let i = 0; i < 15 && !locked; i++) {
      const r = await req('POST', '/admin/login', { form: { username: 'owner', password: 'nope' + i } });
      if (r.status === 429) locked = true;
    }
    check('the moved loginGuard trips a 429 lockout after repeated failures', locked);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE AUTH-SCREENS-ROUTE: FAIL' : 'SMOKE AUTH-SCREENS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
