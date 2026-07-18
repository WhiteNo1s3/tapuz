'use strict';

/**
 * v1.30 QA — proves src/routes/setup-wizard.js works end-to-end as a
 * mounted Express Router: the first-run onboarding wizard (GET /admin/setup)
 * and its POST that runs the wizard through src/setup.js. New HTTP-level
 * coverage: the pre-existing smoke-wizard tests the runSetup ENGINE at the
 * module level, never the routes, the needsSetup guard, or the
 * already-done 409. The gate makes /admin/setup reachable only WITH a
 * session (the real flow is create-admin → login → wizard), so the test
 * creates an admin but deliberately does NOT run setup, keeping the install
 * "pristine" (needsSetup true) until the wizard POST fires.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-setup-wizard-route-'));
const PORT = 3989;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'text/html', Origin: BASE };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Accept'] = 'application/json';
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
  // Deliberately NO runSetup — a pristine install so needsSetup() is true.
  // But an admin + session is required to pass the gate onto /admin/setup.
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── pristine install: the wizard renders ──
    const wiz = await req('GET', '/admin/setup', { cookie });
    check('GET /admin/setup renders the 4-step wizard on a pristine install', wiz.status === 200 && /ברוכים הבאים ל־Tapuziel/.test(wiz.text) && /wiz-steps/.test(wiz.text));
    check('the color step is fed the shared LOOKS as WIZ_LOOKS', /window\.WIZ_LOOKS = /.test(wiz.text));

    // ── admin index redirects to setup while pristine ──
    const adminPre = await req('GET', '/admin', { cookie });
    check('GET /admin redirects to /admin/setup while setup is pending', adminPre.status === 302 && /\/admin\/setup/.test(adminPre.headers.location || ''));

    // ── run the wizard (POST) → builds the site skeleton ──
    const run = await req('POST', '/admin/setup', {
      cookie,
      body: {
        title: 'אתר הבדיקה', description: 'נבנה מהאשף',
        colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
        menuPlacement: 'top', pages: ['home', 'about'], menuPages: ['home', 'about'], external: []
      }
    });
    check('POST /admin/setup runs the wizard and reports the created pages', run.status === 200 && run.json && run.json.ok && Array.isArray(run.json.pages) && run.json.pages.length >= 2);

    // ── the wizard actually built real pages ──
    const pages = await req('GET', '/admin/api/pages', { cookie });
    check('the wizard created real pages (home + about)', pages.status === 200 && pages.json.pages.some((p) => p.full_path === 'home') && pages.json.pages.some((p) => p.full_path === 'about'));

    // ── setup is now done: the guard flips on both routes ──
    const wizAfter = await req('GET', '/admin/setup', { cookie });
    check('after setup, GET /admin/setup redirects to /admin (guard flipped)', wizAfter.status === 302 && /\/admin(\?|$)/.test(wizAfter.headers.location || ''));
    const runAgain = await req('POST', '/admin/setup', { cookie, body: { title: 'שוב' } });
    check('POST /admin/setup again → 409 (setup already done, no double-run)', runAgain.status === 409 && runAgain.json && runAgain.json.ok === false);

    // ── and /admin no longer redirects to setup ──
    const adminPost = await req('GET', '/admin', { cookie });
    check('GET /admin now renders the admin (no longer bounces to setup)', adminPost.status === 200);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE SETUP-WIZARD-ROUTE: FAIL' : 'SMOKE SETUP-WIZARD-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
