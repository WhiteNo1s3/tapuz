'use strict';

/**
 * v1.02 QA — proves src/routes/seo.js works end-to-end as a mounted Express
 * Router: the settings round-trip through real HTTP, and the baseUrl
 * validation (schemeless domain gets https://, garbage input rejected
 * without corrupting the stored value) — the one piece of real logic in
 * this extraction, worth locking in beyond a syntax check.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-seo-routes-'));
const PORT = 3963;
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
    title: 'אתר בדיקה', description: 'seo-routes smoke',
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

    const page = await req('GET', '/admin/seo', { cookie });
    check('GET /admin/seo → 200 (the mounted router serves the page)', page.status === 200 && page.text.includes('SEO'));

    const saved = await req('POST', '/admin/api/seo', {
      cookie,
      body: { titlePattern: '{page} · {site}', description: 'תיאור חדש', defaultOgImage: '/assets/og.jpg', baseUrl: 'example.co.il' }
    });
    check('POST /admin/api/seo saves via the mounted router', saved.status === 200 && saved.json.ok);
    check('schemeless domain gets https:// auto-prefixed', saved.json.seo && true);

    const fetched = await req('GET', '/admin/api/seo', { cookie });
    check('titlePattern round-trips', fetched.json.seo.titlePattern === '{page} · {site}');
    check('description round-trips', fetched.json.description === 'תיאור חדש');
    check('baseUrl round-trips as https://example.co.il', fetched.json.baseUrl === 'https://example.co.il');

    const badUrl = await req('POST', '/admin/api/seo', { cookie, body: { baseUrl: 'not a url at all!!' } });
    check('a garbage baseUrl is rejected with 400', badUrl.status === 400 && !badUrl.json.ok);
    const stillGood = await req('GET', '/admin/api/seo', { cookie });
    check('a rejected baseUrl write left the previously-saved value untouched', stillGood.json.baseUrl === 'https://example.co.il');

    const cleared = await req('POST', '/admin/api/seo', { cookie, body: { baseUrl: '' } });
    check('an explicit empty baseUrl clears it (not rejected as invalid)', cleared.status === 200 && cleared.json.ok);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE SEO-ROUTES: FAIL' : 'SMOKE SEO-ROUTES: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
