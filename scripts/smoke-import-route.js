'use strict';

/**
 * v1.17 QA — proves src/routes/import.js works end-to-end as a mounted
 * Express Router: the import-wizard page renders and POST /admin/api/import
 * actually runs a real WordPress WXR export through src/importers.js,
 * landing real .pzn pages (skipping drafts/non-content items), with
 * slug-collision suffixing and format/content validation.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-import-route-'));
const PORT = 3977;
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

const WXR = `<?xml version="1.0"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <item>
    <title>עמוד הבית</title>
    <wp:post_name>welcome-wp</wp:post_name>
    <wp:post_type>page</wp:post_type>
    <wp:status>publish</wp:status>
    <content:encoded><![CDATA[
      <!-- wp:heading {"level":1} --><h1>ברוכים הבאים</h1><!-- /wp:heading -->
      <!-- wp:paragraph --><p>פסקה עם &copy; ותו &nbsp; מיוחד.</p><!-- /wp:paragraph -->
    ]]></content:encoded>
  </item>
  <item>
    <title>כתבה קלאסית</title>
    <wp:post_name>classic</wp:post_name>
    <wp:post_type>post</wp:post_type>
    <wp:status>publish</wp:status>
    <content:encoded><![CDATA[<h2>כותרת</h2><p>גוף הכתבה הקלאסית ללא גוטנברג.</p>]]></content:encoded>
  </item>
  <item>
    <title>טיוטה</title><wp:post_type>page</wp:post_type><wp:status>draft</wp:status>
    <content:encoded><![CDATA[<p>לא אמור להיכנס</p>]]></content:encoded>
  </item>
</channel></rss>`;

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'import-route smoke',
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

    // ── the wizard page renders ──
    const page = await req('GET', '/admin/import', { cookie });
    check('GET /admin/import → 200, real page with the WordPress uploader', page.status === 200 && /wp-file/.test(page.text) && /WXR/.test(page.text));

    // ── missing format/content → 400, not a crash ──
    const badReq = await req('POST', '/admin/api/import', { cookie, body: { content: '' } });
    check('POST /admin/api/import with no format/empty content → 400', badReq.status === 400 && badReq.json.ok === false);

    // ── a real WXR import lands real pages, skipping the draft ──
    const imp = await req('POST', '/admin/api/import', { cookie, body: { format: 'wordpress', content: WXR } });
    check('POST /admin/api/import runs a real WXR through src/importers.js', imp.status === 200 && imp.json.ok && imp.json.format === 'wordpress');
    check('draft + non-content items are skipped — exactly 2 pages created', imp.json.count === 2 && imp.json.created.length === 2);

    const homeSrc = await req('GET', `/admin/api/pzn/source?fullPath=welcome-wp&kind=draft`, { cookie });
    check('the WXR gutenberg heading landed as real .pzn content', homeSrc.status === 200 && /ברוכים הבאים/.test(homeSrc.json.source));

    // ── importing again (same slugs) suffixes instead of clobbering ──
    const impAgain = await req('POST', '/admin/api/import', { cookie, body: { format: 'wordpress', content: WXR } });
    check('re-importing the same file suffixes new slugs rather than colliding', impAgain.status === 200 && impAgain.json.ok && impAgain.json.created.every((p) => p.fullPath !== 'welcome-wp' && p.fullPath !== 'classic'));
    check('the original page from the first import is untouched (no overwrite)', (await req('GET', '/admin/api/pzn/source?fullPath=welcome-wp&kind=draft', { cookie })).json.source.includes('ברוכים הבאים'));

    // ── an unrecognized format → 400 ──
    const badFormat = await req('POST', '/admin/api/import', { cookie, body: { format: 'not-a-real-cms', content: '<xml/>' } });
    check('an unsupported format → 400 with a real error message', badFormat.status === 400 && badFormat.json.ok === false && !!badFormat.json.error);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE IMPORT-ROUTE: FAIL' : 'SMOKE IMPORT-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
