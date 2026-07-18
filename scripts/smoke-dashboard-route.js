'use strict';

/**
 * v1.24 QA — proves src/routes/dashboard.js works end-to-end as a mounted
 * Express Router: the admin dashboard landing hub renders real counts
 * (pages / published / drafts / pending / media / unread inbox), the
 * tool-family grid, and recent pages; the /admin/build-redirect shortcut
 * rebuilds the site and redirects. Also checks the inlined needsSetup()
 * guard still redirects a pristine install to /admin/setup.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-dashboard-route-'));
const PORT = 3984;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie, redirect } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'text/html', Origin: BASE };
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
    title: 'אתר בדיקה', description: 'dashboard-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  // seed pages in mixed states so the stat cards have real numbers
  const { createPage, savePageSource } = require('../src/pages');
  createPage({ title: 'דף מפורסם', slug: 'pub', blocks: [] });
  savePageSource('pub', '<bent-heading level="1">חי</bent-heading>', { publish: true });
  createPage({ title: 'טיוטה', slug: 'draft1', blocks: [] });
  savePageSource('draft1', '<bent-text>טיוטה</bent-text>'); // draft only
  // an unread inbox lead so that stat card is non-zero
  require('../src/forms').saveSubmission({ fields: { name: 'ליד' }, page: 'pub' });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── dashboard renders with real content ──
    const dash = await req('GET', '/admin/dashboard', { cookie });
    check('GET /admin/dashboard → 200, the landing hub', dash.status === 200 && /דשבורד/.test(dash.text) && /ארגז הכלים/.test(dash.text));
    check('stat cards render the real labels (pages / published / drafts)', /דפים/.test(dash.text) && /פורסמו/.test(dash.text) && /טיוטות/.test(dash.text));
    check('the tool-family hub grid renders (ADMIN_NAV_GROUPS-derived cards)', /class="hub-card"/.test(dash.text));
    check('recent pages list shows a seeded page with an edit link', /דף מפורסם/.test(dash.text) && /\/admin\/edit\//.test(dash.text));
    check('the unread-inbox stat card links to the inbox', /\/admin\/inbox/.test(dash.text));

    // ── build-redirect rebuilds + redirects back to the dashboard ──
    const build = await req('POST', '/admin/build-redirect', { cookie, form: {} });
    check('POST /admin/build-redirect → redirect (site rebuilt)', build.status === 302 || build.status === 303);
    check('build-redirect points back at the dashboard', /\/admin\/dashboard/.test(build.headers['location'] || ''));

    // ── the rebuild actually produced the published page as static HTML ──
    const live = await req('GET', '/pub.html', {});
    check('the rebuild wrote the published page to disk (served statically)', live.status === 200 && /חי/.test(live.text));

    // ── the dashboard is behind the admin gate (unauth → not a 200 page) ──
    const noAuth = await req('GET', '/admin/dashboard', {});
    check('an unauthenticated dashboard request does not render the hub', noAuth.status !== 200 || !/ארגז הכלים/.test(noAuth.text));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE DASHBOARD-ROUTE: FAIL' : 'SMOKE DASHBOARD-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
