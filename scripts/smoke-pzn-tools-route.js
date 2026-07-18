'use strict';

/**
 * v1.13 QA — proves src/routes/pzn-tools.js works end-to-end as a mounted
 * Express Router: all six stateless pzn/BenTML endpoints (repair, graduate,
 * to-blocks, toolbox, primer, preview) through real HTTP against a real
 * server — the first sub-concern split of the page-builder/pzn API
 * surface. No existing smoke test exercised these routes over HTTP before
 * (only the underlying logic, indirectly) — this is genuinely new coverage,
 * not just a re-verification.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-pzn-tools-route-'));
const PORT = 3973;
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

const GOOD_PZN = `<bent-heading level="1">שלום</bent-heading>\n<bent-text>תוכן לדוגמה כאן.</bent-text>`;
const BROKEN_BUT_REPAIRABLE = `<bent-paragraph>זה אמור להפוך לטקסט</bent-paragraph>`; // alias, not a real tag

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'pzn-tools-route smoke',
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

    // ── toolbox (GET, pure schema dump) ──
    const toolbox = await req('GET', '/admin/api/pzn/toolbox', { cookie });
    const toolboxItemCount = (toolbox.json && toolbox.json.toolbox && toolbox.json.toolbox.categories || [])
      .reduce((n, c) => n + (c.items || []).length, 0);
    check('GET /admin/api/pzn/toolbox → 200 with real module schemas across categories', toolbox.status === 200 && toolbox.json.ok && toolboxItemCount > 10);
    check('toolbox schemas dump is also present', Array.isArray(toolbox.json.schemas) || (toolbox.json.schemas && typeof toolbox.json.schemas === 'object'));

    // ── primer (GET, markdown text) ──
    const primer = await req('GET', '/admin/api/pzn/primer', { cookie });
    check('GET /admin/api/pzn/primer → 200 markdown, mentions bent- tags', primer.status === 200 && /bent-/.test(primer.text));

    // ── to-blocks (forgiving import bridge) ──
    const toBlocks = await req('POST', '/admin/api/pzn/to-blocks', { cookie, body: { source: GOOD_PZN } });
    check('POST /admin/api/pzn/to-blocks parses clean BenTML into real blocks', toBlocks.status === 200 && toBlocks.json.ok && toBlocks.json.blocks.some((b) => b.type === 'heading'));

    const toBlocksRepaired = await req('POST', '/admin/api/pzn/to-blocks', { cookie, body: { source: BROKEN_BUT_REPAIRABLE } });
    check('to-blocks auto-repairs a known alias (bent-paragraph → text) instead of failing', toBlocksRepaired.status === 200 && toBlocksRepaired.json.ok && toBlocksRepaired.json.repaired === true);

    // ── repair (dry-run, no save) ──
    const repair = await req('POST', '/admin/api/pzn/repair', { cookie, body: { source: BROKEN_BUT_REPAIRABLE } });
    check('POST /admin/api/pzn/repair returns a corrected source with a change list', repair.status === 200 && repair.json.ok && repair.json.changes.length > 0 && /bent-text/.test(repair.json.repairedSource));

    // ── graduate (raw HTML → real modules) ──
    const graduate = await req('POST', '/admin/api/pzn/graduate', { cookie, body: { content: '<h1>כותרת</h1><p>פסקה</p>' } });
    check('POST /admin/api/pzn/graduate maps h1/p into real heading/text blocks', graduate.status === 200 && graduate.json.ok && graduate.json.blocks.some((b) => b.type === 'heading') && graduate.json.blocks.some((b) => b.type === 'text'));

    // ── preview (compile without saving — proves nothing was created) ──
    const pagesBefore = await req('GET', '/admin/api/pages', { cookie });
    const preview = await req('POST', '/admin/api/pzn/preview', { cookie, body: { source: GOOD_PZN } });
    check('POST /admin/api/pzn/preview compiles real HTML', preview.status === 200 && preview.json.ok && /שלום/.test(preview.json.html));
    const pagesAfter = await req('GET', '/admin/api/pages', { cookie });
    check('preview never creates a page — page count unchanged', pagesBefore.json.pages.length === pagesAfter.json.pages.length);

    // ── error paths still behave correctly through the mounted router ──
    const badRepair = await req('POST', '/admin/api/pzn/repair', { cookie, body: {} });
    check('repair with no source → 400, not a crash', badRepair.status === 400 && badRepair.json.ok === false);
    const badPreview = await req('POST', '/admin/api/pzn/preview', { cookie, body: { source: '<bent-heading level="99">x</bent-heading>' } });
    check('preview of invalid BenTML (bad level) → 400 with real validation issues', badPreview.status === 400 && badPreview.json.ok === false && Array.isArray(badPreview.json.issues));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE PZN-TOOLS-ROUTE: FAIL' : 'SMOKE PZN-TOOLS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
