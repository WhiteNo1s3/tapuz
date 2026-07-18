'use strict';

/**
 * v1.10 QA — proves src/routes/media.js works end-to-end as a mounted
 * Express Router: real folder create/delete, a real (magic-byte-valid)
 * image upload, move, delete, and the library browser page — through
 * real HTTP against a real server, not a syntax check.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-media-route-'));
const PORT = 3970;
const BASE = `http://127.0.0.1:${PORT}`;

// a real, valid 1x1 transparent PNG — passes magic-byte validation, unlike
// an arbitrary string, so this actually exercises src/media.js's saveBase64
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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
    title: 'אתר בדיקה', description: 'media-route smoke',
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

    const page = await req('GET', '/admin/media-library', { cookie });
    check('GET /admin/media-library → 200 via the mounted router', page.status === 200 && page.text.includes('ספריית מדיה'));

    const folder = await req('POST', '/admin/media/folder', { cookie, body: { parent: '', name: 'gallery' } });
    check('POST /admin/media/folder creates a real folder via the mounted router', folder.status === 200 && folder.json.ok);

    const uploaded = await req('POST', '/admin/upload', {
      cookie, body: { filename: 'dot.png', data: PNG_DATA_URL, folder: 'gallery' }
    });
    check('POST /admin/upload saves a real (magic-byte-valid) PNG via the mounted router', uploaded.status === 200 && uploaded.json.ok && !!uploaded.json.url);
    const fileId = uploaded.json.id;

    const listed = await req('GET', '/admin/media?folder=gallery', { cookie });
    check('GET /admin/media lists the uploaded file inside its folder', listed.status === 200 && listed.json.files.some((f) => f.id === fileId));

    // /admin/assets is a ROOT-scope listing (listMedia('').files), not a
    // recursive all-folders one — a file inside 'gallery' correctly does NOT
    // appear here yet.
    const assetsBeforeMove = await req('GET', '/admin/assets', { cookie });
    check('/admin/assets (root-scope) does not see a file still inside a subfolder',
      assetsBeforeMove.status === 200 && !assetsBeforeMove.json.some((f) => f.id === fileId));

    const moved = await req('POST', '/admin/media/move', { cookie, body: { id: fileId, folder: '' } });
    check('POST /admin/media/move relocates the file via the mounted router', moved.status === 200 && moved.json.ok);
    const rootListing = await req('GET', '/admin/media?folder=', { cookie });
    check('the moved file now shows up at the root, not in gallery anymore', rootListing.json.files.some((f) => f.id === fileId));

    const assetsAfterMove = await req('GET', '/admin/assets', { cookie });
    check('the legacy flat /admin/assets list sees the file once it is actually at the root',
      assetsAfterMove.status === 200 && assetsAfterMove.json.some((f) => f.id === fileId));

    const deleted = await req('POST', '/admin/media/delete', { cookie, body: { id: fileId } });
    check('POST /admin/media/delete removes the file via the mounted router', deleted.status === 200 && deleted.json.ok);
    const afterDelete = await req('GET', '/admin/media?folder=', { cookie });
    check('the deleted file is really gone on a fresh fetch', !afterDelete.json.files.some((f) => f.id === fileId));

    const deletedFolder = await req('POST', '/admin/media/delete-folder', { cookie, body: { path: 'gallery' } });
    check('POST /admin/media/delete-folder removes the now-empty folder', deletedFolder.status === 200 && deletedFolder.json.ok);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE MEDIA-ROUTE: FAIL' : 'SMOKE MEDIA-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
