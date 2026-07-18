'use strict';

/**
 * v0.69 QA — "no page to observe", never again. Boots a REAL server on a
 * throwaway TAPUZ_ROOT and proves the loop Ben reported broken:
 *   paste an AI's <bent-*> reply → draft → /admin/publish → GET /שם-הדף.
 * Locks in: extensionless slug URLs (Hebrew included), publish-exports-site,
 * liveUrl in the publish response, the advanced tab accepting the .pzn
 * dialect, and url= → href= prop-twin adoption.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-publish-'));
const PORT = 3953;
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
    const r = http.request(BASE + encodeURI(urlPath), { method, headers }, (res) => {
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

// the reply a dictionary-primed ChatGPT actually sends: prose + fence +
// bent-* tags + the url=/href= drift models love
const BOT_REPLY = [
  'בשמחה! הנה הדף:',
  '```html',
  '<!DOCTYPE html>',
  '<html lang="he" dir="rtl" bent-version="0.1">',
  '<head><meta charset="utf-8"/><title>מסעדת הבדיקה</title></head>',
  '<body>',
  '<bent-hero height="md"><bent-heading level="1">מסעדת הבדיקה</bent-heading><bent-text>אוכל מכל הלב</bent-text></bent-hero>',
  '<bent-button url="/contact">הזמינו שולחן</bent-button>',
  '</body>',
  '</html>',
  '```'
].join('\n');

async function main() {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'publish-live smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('smoke', 'smoke-pass-1');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();

    // ── extensionless slug URLs (the "couldn't GET" fix) ─────────────
    check('GET /home (no .html) → 200', (await req('GET', '/home')).status === 200);
    check('GET /home.html still → 200', (await req('GET', '/home.html')).status === 200);

    // ── login ────────────────────────────────────────────────────────
    const login = await req('POST', '/admin/login', { form: { username: 'smoke', password: 'smoke-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    check('admin login → session', login.status === 302 && cookie.length > 0);

    // ── paste door: a bent-* reply creates a draft (not html-shredded) ─
    const created = await req('POST', '/admin/api/pzn/decompile', {
      cookie, body: { html: BOT_REPLY, create: true, assets: false }
    });
    check('pasted bent-* reply → draft created via the forgiving import',
      created.status === 200 && created.json.ok && created.json.strategy.startsWith('bentml'));
    const fullPath = created.json.fullPath;
    check('draft got a Hebrew slug', /[֐-׿]/.test(fullPath));
    check('no provisional shredding (leftover 0)', created.json.leftover === 0);

    // ── publish MEANS live: exports + liveUrl + the page answers ─────
    const pub = await req('POST', '/admin/publish', { cookie, body: { full_path: fullPath } });
    check('publish ok + liveUrl returned', pub.status === 200 && pub.json.ok && pub.json.liveUrl === '/' + fullPath);
    const live = await req('GET', '/' + fullPath);
    check('GET the Hebrew slug URL → 200 with the content',
      live.status === 200 && live.text.includes('מסעדת הבדיקה'));

    // ── the advanced tab accepts the .pzn dialect + twin adoption ────
    const compiled = await req('POST', '/admin/api/bentml/compile', { cookie, body: { source: BOT_REPLY } });
    check('advanced-tab compile accepts bent-* dialect',
      compiled.status === 200 && compiled.json.ok && compiled.json.dialect === 'pzn');
    const btn = (compiled.json.blocks || []).find((b) => b.type === 'button');
    check('url= drift adopted as the button link (prop twins)',
      !!btn && btn.data.url === '/contact');

    // ── the export follows the page's life (v1.52): rename + delete ──
    // Renaming a LIVE page moves its exported file: the old address stops
    // serving, the new one answers immediately — no second publish needed.
    const renamed = await req('POST', '/admin/save', {
      cookie, body: { full_path: fullPath, slug: 'restaurant-renamed' }
    });
    check('slug rename accepted', renamed.status === 200 && renamed.json.ok &&
      renamed.json.full_path === 'restaurant-renamed');
    check('old address stops serving after rename',
      (await req('GET', '/' + fullPath)).status === 404);
    const moved = await req('GET', '/restaurant-renamed');
    check('published content serves at the new address without re-publishing',
      moved.status === 200 && moved.text.includes('מסעדת הבדיקה'));

    // Deleting a page removes its export — the live URL must go dark, not
    // keep serving a stale file forever (the bug this section pins).
    const del = await req('POST', '/admin/delete', {
      cookie, form: { full_path: 'restaurant-renamed' }
    });
    check('delete accepted', del.status === 302 || del.status === 200);
    check('deleted page stops serving (no orphaned export)',
      (await req('GET', '/restaurant-renamed')).status === 404);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE PUBLISH-LIVE: FAIL' : 'SMOKE PUBLISH-LIVE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('SMOKE PUBLISH-LIVE: CRASH', e);
  process.exit(1);
});
