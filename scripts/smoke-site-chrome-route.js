'use strict';

/**
 * v1.04 QA — proves src/routes/site-chrome.js works end-to-end as a mounted
 * Express Router: the header/footer settings round-trip through real HTTP,
 * including the array-shaped fields (footer columns/links, social rows)
 * that are the actual complexity in this page — a naive extraction could
 * easily drop the filter/mapping logic and still "look right" on a syntax
 * check.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-sitechrome-route-'));
const PORT = 3965;
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
    title: 'אתר בדיקה', description: 'site-chrome-route smoke',
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

    const page = await req('GET', '/admin/site-chrome', { cookie });
    check('GET /admin/site-chrome → 200 via the mounted router', page.status === 200 && page.text.includes('כותרת עליונה'));

    const saved = await req('POST', '/admin/api/site-chrome', {
      cookie,
      body: {
        header: { tagline: 'הבית של המוזיקה', showLogo: true, sticky: false, ctaLabel: 'צור קשר', ctaUrl: '/contact' },
        footer: {
          text: 'רחוב הרצל 1',
          showCredit: false,
          columns: [
            { title: 'שירותים', links: [{ label: 'א', url: '/a' }, { label: '', url: '' }] }, // the blank link should be dropped
            { title: '', links: [] } // a fully-empty column should be dropped entirely
          ],
          social: [{ network: 'Facebook', url: 'https://fb.com/x' }, { network: 'Empty', url: '' }] // no-url social row dropped
        }
      }
    });
    check('POST /admin/api/site-chrome saves via the mounted router', saved.status === 200 && saved.json.ok);

    const fetched = await req('GET', '/admin/api/site-chrome', { cookie });
    check('header fields round-trip', fetched.json.header.tagline === 'הבית של המוזיקה' && fetched.json.header.ctaUrl === '/contact');
    check('header sticky=false round-trips (not silently defaulted true)', fetched.json.header.sticky === false);
    check('footer text + showCredit=false round-trip', fetched.json.footer.text === 'רחוב הרצל 1' && fetched.json.footer.showCredit === false);
    check('exactly one footer column survives (the empty one is dropped)', fetched.json.footer.columns.length === 1);
    check('the blank link inside a real column is dropped, the real link kept', fetched.json.footer.columns[0].links.length === 1 && fetched.json.footer.columns[0].links[0].url === '/a');
    check('the no-url social row is dropped, the real one kept', fetched.json.footer.social.length === 1 && fetched.json.footer.social[0].network === 'Facebook');

    // partial update: sending only `header` must not wipe the footer we just saved
    await req('POST', '/admin/api/site-chrome', { cookie, body: { header: { tagline: 'שם חדש' } } });
    const afterPartial = await req('GET', '/admin/api/site-chrome', { cookie });
    check('a header-only update does not wipe the previously-saved footer', afterPartial.json.footer.columns.length === 1);
    check('the header-only update did apply', afterPartial.json.header.tagline === 'שם חדש');
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE SITE-CHROME-ROUTE: FAIL' : 'SMOKE SITE-CHROME-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
