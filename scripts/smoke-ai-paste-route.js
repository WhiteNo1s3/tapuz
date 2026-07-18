'use strict';

/**
 * v1.35 QA — proves src/routes/ai-paste.js works end-to-end as a mounted
 * Express Router: the two BYO-AI paste-flow pages (GET /admin/ai and
 * GET /admin/inject). No prior route-level coverage existed for these
 * screens; this confirms they render behind the admin gate with their
 * client scripts + mount points intact, and are not reachable unauthenticated.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-ai-paste-route-'));
const PORT = 3994;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'text/html', Origin: BASE };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      res.setEncoding('utf8'); // Hebrew bodies: don't let a chunk boundary split a multi-byte char
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
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
    title: 'אתר בדיקה', description: 'ai-paste-route smoke',
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

    // ── /admin/ai (the keyless paste flow) ──
    const ai = await req('GET', '/admin/ai', { cookie });
    check('GET /admin/ai → 200 with the paste-flow UI + client script', ai.status === 200 && /id="paste-box"/.test(ai.text) && /\/admin-ai\.js/.test(ai.text));

    // ── /admin/inject (the copy-the-pack screen) ──
    const inject = await req('GET', '/admin/inject', { cookie });
    check('GET /admin/inject → 200 with the pack-copy UI + client script', inject.status === 200 && /id="btn-roleplay"/.test(inject.text) && /\/admin-inject\.js/.test(inject.text));

    // ── the dictionary /admin/inject's "copy dictionary" button fetches ──
    // v1.37: this endpoint was registered TWICE in server.js, and Express's
    // first-match rule silently served the OLDER block-registry dictionary
    // while every other agent surface (inject-pack, agent-bridge, roleplay)
    // used the pzn one. Pin WHICH dictionary answers, so a re-added shadowing
    // registration can't quietly downgrade the pack again.
    const { buildDictionary, toMarkdown, toAgentTools } = require('../src/pzn/syntax-dictionary');
    const dictMd = await req('GET', '/admin/api/syntax-dictionary.md', { cookie });
    // the header carries a generation timestamp — normalize it away before comparing
    const stamp = (s) => s.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>');
    check('GET /admin/api/syntax-dictionary.md → the pzn dictionary (not the block-registry one)',
      dictMd.status === 200 && stamp(dictMd.text) === stamp(toMarkdown(buildDictionary())));
    const dictJson = await req('GET', '/admin/api/syntax-dictionary', { cookie });
    let dict = null;
    try { dict = JSON.parse(dictJson.text); } catch (e) { /* leave null → check fails */ }
    check('GET /admin/api/syntax-dictionary → pzn JSON carrying the agent tools[]',
      dictJson.status === 200 && dict && dict.ok === true && Array.isArray(dict.tools) && dict.tools.length === toAgentTools().length);

    // ── both are behind the admin gate ──
    const aiNoAuth = await req('GET', '/admin/ai', {});
    check('/admin/ai is not reachable unauthenticated', aiNoAuth.status !== 200 || !/id="paste-box"/.test(aiNoAuth.text));
    const injectNoAuth = await req('GET', '/admin/inject', {});
    check('/admin/inject is not reachable unauthenticated', injectNoAuth.status !== 200 || !/id="btn-roleplay"/.test(injectNoAuth.text));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE AI-PASTE-ROUTE: FAIL' : 'SMOKE AI-PASTE-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
