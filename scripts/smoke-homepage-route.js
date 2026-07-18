'use strict';

/**
 * v1.25 QA — proves src/routes/homepage.js works end-to-end as a mounted
 * Express Router: crowning a published page as the site homepage through
 * BOTH doors — POST /admin/homepage (form → redirect) and
 * POST /admin/api/homepage (JSON) — with the "only a published page can be
 * home" guard, and the on-the-spot rebuild that makes '/' serve the crowned
 * page immediately.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-homepage-route-'));
const PORT = 3985;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE };
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
    title: 'אתר בדיקה', description: 'homepage-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  // one published page (crownable) + one draft-only page (must be refused)
  const { createPage, savePageSource } = require('../src/pages');
  createPage({ title: 'עמוד ראשי', slug: 'front', blocks: [] });
  savePageSource('front', '<bent-heading level="1">הבית שלנו</bent-heading>', { publish: true });
  createPage({ title: 'טיוטה', slug: 'draftpage', blocks: [] });
  savePageSource('draftpage', '<bent-text>טיוטה</bent-text>'); // never published

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── JSON door: crown the published page ──
    const api = await req('POST', '/admin/api/homepage', { cookie, body: { full_path: 'front' } });
    check('POST /admin/api/homepage crowns a published page', api.status === 200 && api.json.ok && api.json.homepage === 'front');

    // ── the rebuild made '/' serve the crowned page immediately ──
    const root = await req('GET', '/', {});
    check("crowning rebuilt the site — '/' now serves the crowned page", root.status === 200 && /הבית שלנו/.test(root.text));

    // ── guard: a draft-only page cannot be crowned (JSON door → 400) ──
    const draftHome = await req('POST', '/admin/api/homepage', { cookie, body: { full_path: 'draftpage' } });
    check('a draft-only page is refused as homepage (400)', draftHome.status === 400 && draftHome.json.ok === false && /מפורסם/.test(draftHome.json.error || ''));

    // ── guard: an unknown page → 400 ──
    const missing = await req('POST', '/admin/api/homepage', { cookie, body: { full_path: 'no-such' } });
    check('an unknown page → 400, not a crash', missing.status === 400 && missing.json.ok === false);

    // ── form door: POST /admin/homepage redirects on success ──
    const formOk = await req('POST', '/admin/homepage', { cookie, form: { full_path: 'front' } });
    check('POST /admin/homepage (form) → redirect on success', formOk.status === 302 || formOk.status === 303);

    // ── form door: an invalid crowning renders the error page (400), not a redirect ──
    const formBad = await req('POST', '/admin/homepage', { cookie, form: { full_path: 'draftpage' } });
    check('POST /admin/homepage (form) with a draft → 400 error page, not a redirect', formBad.status === 400 && /מפורסם/.test(formBad.text));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE HOMEPAGE-ROUTE: FAIL' : 'SMOKE HOMEPAGE-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
