'use strict';

/**
 * v1.08 QA — proves src/routes/translations.js works end-to-end as a
 * mounted Express Router: link/unlink through real HTTP against a real
 * server, and the admin page actually lists what got linked.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-i18n-route-'));
const PORT = 3967;
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
    title: 'אתר בדיקה', description: 'i18n-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  const { createPage } = require('../src/pages');
  createAdmin('owner', 'owner-pass-1');
  createPage({ title: 'אודות', slug: 'about', blocks: [], status: 'draft' });
  createPage({ title: 'About', slug: 'about-en', blocks: [], status: 'draft' });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    const emptyPage = await req('GET', '/admin/translations', { cookie });
    check('GET /admin/translations → 200 via the mounted router', emptyPage.status === 200 && emptyPage.text.includes('תרגומים'));
    check('with nothing linked yet, the page says so', emptyPage.text.includes('אין עדיין תרגומים'));

    const linked = await req('POST', '/admin/api/translations/link', {
      cookie, body: { pathA: 'about', langA: 'he', pathB: 'about-en', langB: 'en' }
    });
    check('POST /admin/api/translations/link succeeds via the mounted router', linked.status === 200 && linked.json.ok);

    const afterLink = await req('GET', '/admin/translations', { cookie });
    check('the admin page now lists the linked pair', afterLink.text.includes('אודות') && afterLink.text.includes('About') && afterLink.text.includes('HE') && afterLink.text.includes('EN'));

    const unlinked = await req('POST', '/admin/api/translations/unlink', { cookie, body: { path: 'about-en' } });
    check('POST /admin/api/translations/unlink succeeds', unlinked.status === 200 && unlinked.json.ok);

    const afterUnlink = await req('GET', '/admin/translations', { cookie });
    check('after unlinking, the group is gone from the listing', afterUnlink.text.includes('אין עדיין תרגומים'));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE TRANSLATIONS-ROUTE: FAIL' : 'SMOKE TRANSLATIONS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
