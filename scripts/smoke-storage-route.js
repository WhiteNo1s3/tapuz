'use strict';

/**
 * v1.09 QA — proves src/routes/storage.js works end-to-end as a mounted
 * Express Router: real pages/media/site-data on disk actually show up in
 * both the JSON API and the rendered page, not a stub.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-storage-route-'));
const PORT = 3968;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { form, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = body; // raw bytes (the upload-restore path)
      headers['Content-Type'] = 'application/octet-stream';
      headers['Content-Length'] = body.length;
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
    title: 'אתר בדיקה', description: 'storage-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  const { createPage, publishPage } = require('../src/pages');
  createAdmin('owner', 'owner-pass-1');
  createPage({ title: 'עמוד לבדיקה', slug: 'storage-test-page', blocks: [], status: 'draft' });
  publishPage('storage-test-page');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    const api = await req('GET', '/admin/api/storage', { cookie });
    check('GET /admin/api/storage → 200 via the mounted router', api.status === 200 && api.json.ok);
    check('the real page we created is in the API response', api.json.pages.some((p) => p.slug === 'storage-test-page'));
    check('published status is reported correctly', api.json.pages.find((p) => p.slug === 'storage-test-page').published === true);

    const page = await req('GET', '/admin/storage', { cookie });
    check('GET /admin/storage → 200 via the mounted router', page.status === 200 && page.text.includes('אחסון'));
    check('the rendered page lists the real page by slug', page.text.includes('storage-test-page'));
    check('the counts badge reflects at least the pages we made', /דפים.*\d/.test(page.text.replace(/\n/g, ' ')));

    // ── v1.92 sqlite-forever: upload-restore streams the file, no cap ──
    const dbm = require('../src/db');
    const snap = dbm.backupNow();
    const up = await req('POST', '/admin/db/upload-restore', { cookie, body: fs.readFileSync(snap.file) });
    check('uploading a real snapshot restores it (streamed, not body-parsed)',
      up.status === 200 && up.json && up.json.ok === true);
    const stillThere = await req('GET', '/admin/api/storage', { cookie });
    check('the site is intact after the upload-restore round-trip',
      stillThere.status === 200 && stillThere.json.pages.some((p) => p.slug === 'storage-test-page'));

    const junk = await req('POST', '/admin/db/upload-restore', { cookie, body: Buffer.from('junk bytes, not a database') });
    check('uploading garbage is refused with a 400, site untouched', junk.status === 400 &&
      (await req('GET', '/admin/api/storage', { cookie })).json.pages.some((p) => p.slug === 'storage-test-page'));

    const noAuth = await req('POST', '/admin/db/upload-restore', { body: fs.readFileSync(snap.file) });
    check('upload-restore without a session is refused', noAuth.status !== 200);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE STORAGE-ROUTE: FAIL' : 'SMOKE STORAGE-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
