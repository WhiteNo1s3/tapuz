'use strict';

/**
 * v2.28 QA — the Menu Organizer run, end to end, against the owner's LOCAL
 * model (LM Studio / any OpenAI-shaped runtime). Opt-in: it needs a model, so
 * it is never part of test:smoke — set LOCAL_LLM_BASE (and LOCAL_LLM_MODEL)
 * to run it:
 *
 *   LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-qwen node scripts/smoke-local-live.js
 *
 * What it proves, through real HTTP on a spawned server: the runner route
 * composes the pack from the site's state, sends it through src/ai.js to the
 * local provider, the door parses the reply, the response carries the reply
 * + preview + warnings + usage, a paste of the SAME reply gives the SAME
 * warnings — and nothing was applied (the menus table is untouched).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const LLM_BASE = process.env.LOCAL_LLM_BASE || '';
const LLM_MODEL = process.env.LOCAL_LLM_MODEL || process.env.EVAL_MODEL || '';
if (!LLM_BASE) {
  console.log('SMOKE LOCAL-LIVE: SKIPPED (set LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 to run against a local model)');
  process.exit(0);
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-local-live-'));
const PORT = 3993;
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
    if (form != null) { data = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (body != null) { data = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
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
    r.setTimeout(10 * 60 * 1000, () => r.destroy(new Error('request timed out')));
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitUp(tries = 60) {
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
  // the live site's shape: ten Hebrew items, two with emoji, a 920px column
  const fixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'inject', 'menu-organizer', 'live-10.json');
  const fixture = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;
  runSetup({
    title: (fixture && fixture.config && fixture.config.title) || 'EXPLOIT · 80', description: 'local-live smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: [] // the fixture brings the other nine pages
  });
  if (fixture) {
    const pages = require('../src/pages');
    for (const p of fixture.pages || []) {
      try {
        // createPage derives full_path from path_prefix + slug
        const parts = String(p.full_path || '').split('/').filter(Boolean);
        const slug = parts.pop();
        if (slug && typeof pages.createPage === 'function') pages.createPage({ title: p.title, slug, path_prefix: parts.join('/'), status: p.status || 'published', tags: p.tags || [], blocks: [] });
      } catch (e) { /* a slug the setup already made */ }
    }
    const menus = require('../src/menus');
    menus.saveMenus(fixture.menus || {});
    if (fixture.overrides) require('../src/theme').saveOverrides(fixture.overrides);
  }
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  require('../src/ai').saveSettings({ provider: 'local', baseUrl: LLM_BASE, model: LLM_MODEL });
  const menusBefore = JSON.stringify(require('../src/menus').loadMenus());

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    const list = await req('GET', '/admin/api/inject', { cookie });
    const pack = list.json && list.json.packs && list.json.packs.find((p) => p.id === 'menu-organizer');
    check('GET /admin/api/inject lists menu-organizer with run enabled', !!pack && pack.run && pack.run.enabled === true);

    console.log(`… running the organizer against ${LLM_BASE} (${LLM_MODEL || 'the loaded model'}) — up to 4 minutes`);
    const t0 = Date.now();
    const run = await req('POST', '/admin/api/inject/menu-organizer/run', { cookie, body: { brief: '', size: 'lite' } });
    const ms = Date.now() - t0;
    const j = run.json || {};
    check(`POST …/run → 200 ok (${Math.round(ms / 1000)}s, ${j.rounds || '?'} round(s))`, run.status === 200 && j.ok === true);
    if (!j.ok) console.log('    ', run.status, (j.code || ''), String(j.error || run.text).slice(0, 300));
    check('the reply is a <bent-menus> document the door parsed', typeof j.reply === 'string' && /<bent-menu/.test(j.reply) && j.preview && j.preview.menus);
    check('at most one repair round', !j.rounds || j.rounds <= 2);
    check('no hard warning on the result', j.hard === false);
    check('the run finished inside the local timeout (< 240s)', j.timing && j.timing.ms < 240000);
    // the route sums usage over the rounds; a repair round re-sends the first exchange as history
    check(`usage came back and each round's prompt fits the local window (< 6000 prompt tokens × ${j.rounds || 1} round(s))`, j.usage && (j.usage.prompt_tokens || 0) > 0 && j.usage.prompt_tokens < 6000 * (j.rounds || 1));
    check('the provider is reported', j.provider && j.provider.id === 'local');
    if (j.preview && j.preview.fitLine) console.log('     fit:', j.preview.fitLine);
    if (j.warnings && j.warnings.length) console.log('     warnings:', j.warnings.map((w) => w.code).join(', '));

    if (j.ok) {
      const paste = await req('POST', '/admin/api/inject/menu-organizer/paste', { cookie, body: { reply: j.reply, brief: '' } });
      const codes = (x) => ((x && x.warnings) || []).map((w) => w.code).sort().join(',');
      check('pasting the same reply gives the same warnings (the run used the real door)', paste.status === 200 && paste.json.ok && codes(paste.json) === codes(j));
    }
    const menusAfter = JSON.stringify(require('../src/menus').loadMenus());
    check('the run applied NOTHING (menus table untouched)', menusAfter === menusBefore);
  } catch (e) {
    check('smoke ran without an exception: ' + e.message, false);
  } finally {
    child.kill();
  }
  console.log(fail ? '\nSMOKE LOCAL-LIVE: FAIL' : '\nSMOKE LOCAL-LIVE: PASS');
  process.exit(fail ? 1 : 0);
})();
