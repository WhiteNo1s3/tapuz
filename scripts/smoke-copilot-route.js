'use strict';

/**
 * v1.35/v1.47 QA — proves src/routes/copilot.js works end-to-end as a mounted
 * Express Router: the whole AI copilot surface, both tiers. Started as
 * ai-paste coverage (the two BYOT paste-flow pages); grew with the module
 * when v1.47 absorbed the rest of the cluster.
 *
 * Covered: the four admin screens (/admin/agent, /admin/ai, /admin/inject,
 * /admin/chat) render behind the gate with their client scripts and mount
 * points intact and are unreachable unauthenticated; the packs they hand out
 * (inject-pack, syntax-dictionary[.md]) answer with the RIGHT dictionary; and
 * the BYOK key surface (/admin/api/ai/settings) never leaks the stored key.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-copilot-route-'));
const PORT = 3994;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── static: provider choice is RADIOS with honest readiness (v1.70, Ben:
//    "options that are not working should be greyed out… make a radio") ──
{
  const copilotSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'copilot.js'), 'utf8');
  const chatJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-chat.js'), 'utf8');
  check('provider picker is a radio group, not a <select>',
    /id="ai-provider-radios"/.test(copilotSrc) && !/<select id="ai-provider">/.test(copilotSrc));
  check('not-ready providers are toned down (.is-off styled)',
    /\.provider-radio\.is-off \{ opacity:\.55; \}/.test(copilotSrc.replace(/\s+/g, ' ')) ||
    /provider-radio\.is-off/.test(copilotSrc));
  check('the checked row is never faded', /:has\(input:checked\)/.test(copilotSrc));
  check('client renders readiness chips (מוגדר/דורש מפתח/מקומי)',
    /דורש מפתח/.test(chatJs) && /מקומי · ללא מפתח/.test(chatJs) && /מוגדר ✓/.test(chatJs));
  check('local runtime counts as ready without a key', /p\.keyOptional \|\| \(p\.id === settings\.provider && settings\.hasKey\)/.test(chatJs));
  check('off rows stay clickable (no disabled attr)', !/disabled/.test(chatJs.match(/renderSettings[\s\S]*?syncProviderUI\(\);\s*\}/)[0]));
  check('screen title dropped the Grokin label', !/Grokin/.test(copilotSrc.match(/adminNav\([^)]*\)/g).join(' ')));
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
    title: 'אתר בדיקה', description: 'copilot-route smoke',
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

    // ── /admin/agent (the extension pairing screen) ──
    const agent = await req('GET', '/admin/agent', { cookie });
    check('GET /admin/agent → 200 with the token UI + client script',
      agent.status === 200 && /id="tok-create"/.test(agent.text) && /\/admin-agent\.js/.test(agent.text));

    // ── /admin/chat (the BYOK copilot) ──
    const chat = await req('GET', '/admin/chat', { cookie });
    check('GET /admin/chat → 200 with the composer + key panel + client script',
      chat.status === 200 && /id="btn-send"/.test(chat.text) && /id="ai-key"/.test(chat.text) && /\/admin-chat\.js/.test(chat.text));

    // ── the pack /admin/inject's buttons fetch ──
    const pack = await req('GET', '/admin/api/inject-pack', { cookie });
    let bundle = null;
    try { bundle = JSON.parse(pack.text); } catch (e) { /* leave null → check fails */ }
    check('GET /admin/api/inject-pack → the JSON bundle the inject page renders',
      pack.status === 200 && bundle && typeof bundle === 'object');
    const packRoleplay = await req('GET', '/admin/api/inject-pack?format=roleplay', { cookie });
    check('inject-pack?format=roleplay → markdown, not JSON',
      packRoleplay.status === 200 && /markdown/.test(String(packRoleplay.headers['content-type'])) && packRoleplay.text.length > 500);

    // ── the BYOK key surface must never hand the key back ──
    const aiSettings = await req('GET', '/admin/api/ai/settings', { cookie });
    let s = null;
    try { s = JSON.parse(aiSettings.text); } catch (e) { /* leave null → check fails */ }
    check('GET /admin/api/ai/settings → ok, with providers and NO apiKey echoed back',
      aiSettings.status === 200 && s && s.ok === true && Array.isArray(s.providers) && !('apiKey' in s));

    // ── all four screens are behind the admin gate ──
    const aiNoAuth = await req('GET', '/admin/ai', {});
    check('/admin/ai is not reachable unauthenticated', aiNoAuth.status !== 200 || !/id="paste-box"/.test(aiNoAuth.text));
    const injectNoAuth = await req('GET', '/admin/inject', {});
    check('/admin/inject is not reachable unauthenticated', injectNoAuth.status !== 200 || !/id="btn-roleplay"/.test(injectNoAuth.text));
    const agentNoAuth = await req('GET', '/admin/agent', {});
    check('/admin/agent is not reachable unauthenticated', agentNoAuth.status !== 200 || !/id="tok-create"/.test(agentNoAuth.text));
    const chatNoAuth = await req('GET', '/admin/chat', {});
    check('/admin/chat is not reachable unauthenticated', chatNoAuth.status !== 200 || !/id="ai-key"/.test(chatNoAuth.text));
    const settingsNoAuth = await req('GET', '/admin/api/ai/settings', {});
    check('/admin/api/ai/settings is not reachable unauthenticated', settingsNoAuth.status !== 200);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE COPILOT-ROUTE: FAIL' : 'SMOKE COPILOT-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
