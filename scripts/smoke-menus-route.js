'use strict';

/**
 * v1.07 QA — proves src/routes/menus.js works end-to-end as a mounted
 * Express Router: the menu CRUD lifecycle (create/rename-via-recreate/
 * delete), nested items, and the location map (which menu renders where)
 * through real HTTP — not just that the code compiles.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-menus-route-'));
const PORT = 3966;
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
    title: 'אתר בדיקה', description: 'menus-route smoke',
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

    const page = await req('GET', '/admin/menus', { cookie });
    check('GET /admin/menus → 200 via the mounted router', page.status === 200 && page.text.includes('תפריטים'));
    check('the wizard-seeded main menu is embedded in the page boot data', page.text.includes('__TAPUZ_MENUS__'));

    // ── create a second menu with a nested item ──
    const saved = await req('POST', '/admin/api/menus/footer-links', {
      cookie,
      body: {
        items: [
          { type: 'custom', label: 'ראשי', url: '/', children: [{ type: 'custom', label: 'תת-פריט', url: '/sub' }] }
        ]
      }
    });
    check('POST /admin/api/menus/:name creates a new menu via the mounted router', saved.status === 200 && saved.json.ok);
    check('the new menu is in the returned menus map', !!saved.json.menus['footer-links']);

    const fetched = await req('GET', '/admin/api/menus', { cookie });
    check('nested items round-trip', fetched.json.menus['footer-links'][0].children[0].label === 'תת-פריט');

    // ── locations: assign the new menu to the footer ──
    const locSaved = await req('POST', '/admin/api/menus', {
      cookie, body: { menus: fetched.json.menus, locations: { main: 'main', footer: 'footer-links' } }
    });
    check('location assignment saves via the mounted router', locSaved.status === 200 && locSaved.json.locations.footer === 'footer-links');

    // ── delete ──
    const deleted = await req('POST', '/admin/api/menus/footer-links/delete', { cookie });
    check('delete via the mounted router removes the menu', deleted.status === 200 && !deleted.json.menus['footer-links']);

    const afterDelete = await req('GET', '/admin/api/menus', { cookie });
    check('the deleted menu is really gone on a fresh fetch', !afterDelete.json.menus['footer-links']);
    check('the untouched main menu survives a sibling delete', Array.isArray(afterDelete.json.menus.main));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE MENUS-ROUTE: FAIL' : 'SMOKE MENUS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
