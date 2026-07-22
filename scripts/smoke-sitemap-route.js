'use strict';

/**
 * v1.03 QA — proves src/routes/sitemap.js works end-to-end as a mounted
 * Express Router. The simplest route extraction yet (single read-only GET,
 * no API), so the test earns its keep by checking the actual STRUCTURE the
 * page renders: menu items with their real hrefs, an orphan page (created
 * but never added to any menu) showing up in the orphans section, and a
 * published-vs-draft badge distinction — not just "the page returns 200".
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-sitemap-route-'));
const PORT = 3964;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'text/html' };
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
    });
    r.on('error', reject);
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
    title: 'אתר בדיקה', description: 'sitemap-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  const { createPage, publishPage } = require('../src/pages');

  createAdmin('owner', 'owner-pass-1');
  // an orphan: created + published, but never added to any menu
  createPage({ title: 'דף יתום', slug: 'orphan-page', blocks: [], status: 'draft' });
  publishPage('orphan-page');
  // a draft page (unpublished) also never added to a menu
  createPage({ title: 'טיוטה', slug: 'draft-page', blocks: [], status: 'draft' });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const http2 = require('http');
    const loginBody = new URLSearchParams({ username: 'owner', password: 'owner-pass-1' }).toString();
    const login = await new Promise((resolve, reject) => {
      const r = http2.request(BASE + '/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE }
      }, (res) => { res.resume(); res.on('end', () => resolve(res)); });
      r.on('error', reject);
      r.end(loginBody);
    });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    check('admin login succeeded (session cookie set)', cookie.length > 0);

    const page = await req('GET', '/admin/sitemap', { cookie });
    check('GET /admin/sitemap → 200 via the mounted router', page.status === 200);
    check('the main menu section renders with the home page linked', page.text.includes('תפריט ראשי') && page.text.includes('/home'));
    check('the published orphan page appears in the orphans section', page.text.includes('דף יתום') && page.text.includes('/orphan-page'));
    // Matched on the LABEL the reader sees, not the class that renders it —
    // the status badges joined the shared .pill family in v1.60 and the check
    // is about which status shows, not which stylesheet paints it.
    check('the published orphan carries the "פורסם" badge',
      /דף יתום[\s\S]{0,220}>פורסם</.test(page.text));
    check('the draft orphan carries the "טיוטה" badge, not "פורסם"',
      /טיוטה<\/strong>[\s\S]{0,160}>טיוטה</.test(page.text));
    check('an unauthenticated request is redirected, never leaks the sitemap', (await req('GET', '/admin/sitemap')).status !== 200);

    // v1.26: the JSON twin relocated into this same route module — same
    // buildSitemap() data, now served alongside its own page.
    const apiRes = await req('GET', '/admin/api/sitemap', { cookie });
    let apiJson = null;
    try { apiJson = JSON.parse(apiRes.text); } catch (e) { /* leave null */ }
    check('GET /admin/api/sitemap → 200 JSON via the same mounted router', apiRes.status === 200 && apiJson && apiJson.ok === true);
    check('the JSON twin carries the real buildSitemap() structure (menus + orphans)', apiJson && apiJson.menus && Array.isArray(apiJson.orphans) && apiJson.orphans.some((p) => p.full_path === 'orphan-page'));
    check('the JSON sitemap is behind auth too (unauth never gets 200 JSON)', (await req('GET', '/admin/api/sitemap')).status !== 200);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE SITEMAP-ROUTE: FAIL' : 'SMOKE SITEMAP-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
