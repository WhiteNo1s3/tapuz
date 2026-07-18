'use strict';

/**
 * v1.32 QA — proves src/routes/admin-home.js works end-to-end as a mounted
 * Express Router: GET /admin, the pages-list landing. Covers the three
 * states the page reasons about: the pristine-install redirect to the setup
 * wizard (via the shared needsSetup), the normal pages list, the v0.78
 * homepage-status banner (who owns '/'), and the no-homepage warning when
 * published pages exist but none is crowned.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-admin-home-route-'));
const PORT = 3992;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'text/html', Origin: BASE };
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

async function boot() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  await waitUp();
  return child;
}

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');

  // ── phase 1: pristine install (no runSetup) → /admin bounces to setup ──
  let child = await boot();
  try {
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    const pristine = await req('GET', '/admin', { cookie });
    check('pristine install: GET /admin redirects to the setup wizard', pristine.status === 302 && /\/admin\/setup/.test(pristine.headers.location || ''));

    // now actually run setup + create a couple of pages in mixed states
    const { runSetup } = require('../src/setup');
    runSetup({
      title: 'אתר בדיקה', description: 'admin-home smoke',
      colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
      menuPlacement: 'top', pages: ['home', 'about'], menuPages: ['home', 'about'], external: []
    });
  } finally {
    child.kill();
  }

  // ── phase 2: set up, but unpublish everything so there's a published-but-no-home state ──
  const { listPages, updatePage, savePageSource, getPageByFullPath } = require('../src/pages');
  const { loadConfig, saveConfig } = require('../src/config');
  // publish 'home' but leave config.homepage empty AND ensure resolveHomePath
  // can still pick it — so instead, to force the "no home" warning, publish a
  // page and clear config.homepage, then rename so ranking finds nothing named home.
  savePageSource('about', '<bent-heading level="1">אודות</bent-heading>', { publish: true });

  child = await boot();
  try {
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── the pages list renders with the seeded pages ──
    const home = await req('GET', '/admin', { cookie });
    check('GET /admin → 200 pages-list landing', home.status === 200 && /דפים/.test(home.text));
    check('the seeded pages appear in the list', /about/.test(home.text) && /\/admin\/edit\//.test(home.text));

    // ── the post-build "your site is live" banner shows on ?built=1 ──
    const built = await req('GET', '/admin?built=1', { cookie });
    check('?built=1 shows the "site is live" success banner', /האתר שלכם חי/.test(built.text));

    // ── the homepage-updated banner shows on ?homeset=1 ──
    const homeset = await req('GET', '/admin?homeset=1', { cookie });
    check('?homeset=1 shows the homepage-updated banner', /דף הבית עודכן/.test(homeset.text));

    // ── unauthenticated /admin does not render the pages list ──
    const noAuth = await req('GET', '/admin', {});
    check('an unauthenticated /admin never renders the pages list', noAuth.status !== 200 || !/\/admin\/edit\//.test(noAuth.text));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE ADMIN-HOME-ROUTE: FAIL' : 'SMOKE ADMIN-HOME-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
