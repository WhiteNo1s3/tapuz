'use strict';

/**
 * v1.21 QA — proves src/routes/content-api.js works end-to-end as a
 * mounted Express Router: the page-navigator list (+ ?q/?status filters),
 * the article-cube list, the per-page revision history, and revision
 * restore — all through real HTTP against a real server, seeded with real
 * pages + real saved revisions (not fixture rows).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-content-api-route-'));
const PORT = 3981;
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
    title: 'אתר בדיקה', description: 'content-api-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');

  // seed real pages + a real published article + real revisions
  const { createPage, savePageSource, updatePage } = require('../src/pages');
  createPage({ title: 'דף רגיל', slug: 'plain', blocks: [] });
  createPage({ title: 'כתבה', slug: 'story', blocks: [] });
  // publish 'story' and tag it as an article (tags is a top-level page
  // field on updatePage, not meta.tags — what listArticles reads)
  savePageSource('story', '<bent-heading level="1">כותרת הכתבה</bent-heading>', { publish: true });
  updatePage('story', { tags: ['article'] });
  // two saves on 'plain' → real revisions exist
  savePageSource('plain', '<bent-text>גרסה ראשונה</bent-text>');
  savePageSource('plain', '<bent-text>גרסה שנייה</bent-text>');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── pages list ──
    const pages = await req('GET', '/admin/api/pages', { cookie });
    check('GET /admin/api/pages → 200 with the real pages', pages.status === 200 && pages.json.ok && Array.isArray(pages.json.pages) && pages.json.pages.some((p) => p.full_path === 'plain') && pages.json.pages.some((p) => p.full_path === 'story'));

    // ── ?q= search filter ──
    const search = await req('GET', '/admin/api/pages?q=story', { cookie });
    check('?q= filters the page list (server-side search)', search.status === 200 && search.json.pages.some((p) => p.full_path === 'story') && !search.json.pages.some((p) => p.full_path === 'plain'));

    // ── ?status= filter ──
    const published = await req('GET', '/admin/api/pages?status=published', { cookie });
    check('?status=published filters to published pages only', published.status === 200 && published.json.pages.every((p) => p.status === 'published') && published.json.pages.some((p) => p.full_path === 'story'));

    // ── article cubes ──
    const articles = await req('GET', '/admin/api/articles', { cookie });
    check('GET /admin/api/articles → the tagged, published article', articles.status === 200 && articles.json.ok && Array.isArray(articles.json.articles) && articles.json.articles.some((a) => a.full_path === 'story'));

    // ── revision history ──
    const revs = await req('GET', '/admin/api/revisions/plain', { cookie });
    check('GET /admin/api/revisions/:fullPath → the real saved revisions', revs.status === 200 && revs.json.ok && Array.isArray(revs.json.revisions) && revs.json.revisions.length >= 1);

    // ── revision restore ──
    const targetRev = revs.json.revisions[revs.json.revisions.length - 1]; // the oldest saved rev
    const restore = await req('POST', '/admin/api/revisions/restore', { cookie, body: { full_path: 'plain', revision_id: targetRev.id } });
    check('POST /admin/api/revisions/restore restores a real revision', restore.status === 200 && restore.json.ok && restore.json.page && restore.json.page.full_path === 'plain');

    // ── restore validation: a foreign/missing revision id → 400 ──
    const restoreBad = await req('POST', '/admin/api/revisions/restore', { cookie, body: { full_path: 'plain', revision_id: 999999 } });
    check('restoring an unknown revision id → 400, not a crash', restoreBad.status === 400 && restoreBad.json.ok === false);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE CONTENT-API-ROUTE: FAIL' : 'SMOKE CONTENT-API-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
