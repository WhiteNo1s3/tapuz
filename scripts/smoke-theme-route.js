'use strict';

/**
 * v1.15 QA — proves src/routes/theme.js works end-to-end as a mounted
 * Express Router: the theme settings API (GET/POST overrides, export,
 * import) and the /admin/theme page itself, through real HTTP. The
 * tenth route-group extraction, same page+API template as site-chrome.js
 * and seo.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-theme-route-'));
const PORT = 3975;
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
    title: 'אתר בדיקה', description: 'theme-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
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

    // ── the admin page itself renders, mounted correctly ──
    const page = await req('GET', '/admin/theme', { cookie });
    check('GET /admin/theme → 200, real page shell with the looks gallery + save buttons', page.status === 200 && /th-looks/.test(page.text) && /th-save/.test(page.text) && /TAPUZ_LOOKS/.test(page.text));

    // ── GET settings API ──
    const before = await req('GET', '/admin/api/theme', { cookie });
    check('GET /admin/api/theme → 200 with real overrides + logo shape', before.status === 200 && before.json.ok && before.json.overrides.colors.primary && before.json.siteTitle);

    // ── POST settings — a real color override round-trips ──
    const save = await req('POST', '/admin/api/theme', {
      cookie,
      body: { siteTitle: 'שם חדש', overrides: { colors: { primary: '#123456' }, style: { radius: 'sharp' } } }
    });
    check('POST /admin/api/theme saves a real override', save.status === 200 && save.json.ok && save.json.overrides.colors.primary === '#123456' && save.json.overrides.style.radius === 'sharp');
    check('POST /admin/api/theme also updates the site title', save.json.siteTitle === 'שם חדש');
    const after = await req('GET', '/admin/api/theme', { cookie });
    check('the saved override actually persists (round-trips on a fresh GET)', after.json.overrides.colors.primary === '#123456');
    check('an unset override field falls back to default, not wiped to blank', !!after.json.overrides.colors.text);

    // ── export — downloads a real portable package ──
    const exp = await req('GET', '/admin/api/theme/export', { cookie });
    check('GET /admin/api/theme/export → a real tapuz-theme package', exp.status === 200 && exp.json.format === 'tapuz-theme' && exp.json.overrides.colors.primary === '#123456');
    check('export sets a download filename', /attachment/.test(exp.headers['content-disposition'] || ''));

    // ── import — a foreign/malformed package is rejected, a real one applies ──
    const badImport = await req('POST', '/admin/api/theme/import', { cookie, body: { package: { format: 'not-tapuz' } } });
    check('POST /admin/api/theme/import rejects a wrong-format package → 400', badImport.status === 400 && badImport.json.ok === false);

    const goodPkg = { format: 'tapuz-theme', version: exp.json.version, name: 'ליבוא', exportedAt: new Date(0).toISOString(), overrides: { colors: { primary: '#654321' } } };
    const goodImport = await req('POST', '/admin/api/theme/import', { cookie, body: { package: goodPkg } });
    check('POST /admin/api/theme/import applies a real package', goodImport.status === 200 && goodImport.json.ok && goodImport.json.overrides.colors.primary === '#654321');
    const afterImport = await req('GET', '/admin/api/theme', { cookie });
    check('imported overrides are actually live afterward', afterImport.json.overrides.colors.primary === '#654321');
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE THEME-ROUTE: FAIL' : 'SMOKE THEME-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
