'use strict';

/**
 * v2.29 QA — THE HOSTED FLOW, end to end: a Tapuziel that cannot reach the
 * owner's model at all, driving that model anyway through the browser.
 *
 *   LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 LOCAL_LLM_MODEL=tapuz-gemma \
 *     node scripts/smoke-bridge-run.js
 *
 * The server is started with NO way to call a model (provider 'browser' has
 * no endpoint, and nothing here configures a local one), exactly like the
 * copy on the Hostinger host. This script then plays the part the Bridge V2
 * extension plays in real life:
 *
 *   POST /run                        → { modelCall: { id, body } }
 *   fetch LM Studio with that body   ← the background worker's one job
 *   POST /run { step: { id, result } } → the answer, or a second modelCall
 *
 * What it proves: the pack is composed from the real site state, the body is
 * the one a server-side run would have sent, the door judges the reply the
 * same way, one repair round at most, the final shape matches the paste
 * flow's — and nothing is applied. Opt-in: skips with exit 0 when
 * LOCAL_LLM_BASE is unset, so test:smoke never needs a model.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const LLM_BASE = (process.env.LOCAL_LLM_BASE || '').replace(/\/+$/, '');
const LLM_MODEL = process.env.LOCAL_LLM_MODEL || process.env.EVAL_MODEL || '';
if (!LLM_BASE) {
  console.log('SMOKE BRIDGE-RUN: SKIPPED (set LOCAL_LLM_BASE=http://127.0.0.1:1234/v1 to run against a local model)');
  process.exit(0);
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-bridge-run-'));
const PORT = 3992;
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

/** The extension's background worker, in twelve lines: POST the body the
 *  server composed to loopback, hand the raw JSON back. No credentials, no
 *  rewriting — the page never even sees the endpoint. */
function relayToModel(body) {
  return new Promise((resolve, reject) => {
    const u = new URL(LLM_BASE + '/chat/completions');
    const payload = JSON.stringify(body);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { resolve({ error: { message: 'bad json from the model: ' + buf.slice(0, 200) } }); }
      });
    });
    r.setTimeout(10 * 60 * 1000, () => r.destroy(new Error('the local model did not answer in time')));
    r.on('error', reject);
    r.write(payload);
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
  const fixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'inject', 'menu-organizer', 'live-10.json');
  const fixture = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, 'utf8')) : null;
  runSetup({
    title: (fixture && fixture.config && fixture.config.title) || 'EXPLOIT · 80', description: 'bridge-run smoke',
    colors: { primary: '#f97316', bg: '#fff', lightBg: '#fff7ed', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  if (fixture) {
    const pages = require('../src/pages');
    for (const p of fixture.pages || []) {
      try {
        const parts = String(p.full_path || '').split('/').filter(Boolean);
        const slug = parts.pop();
        if (slug) pages.createPage({ title: p.title, slug, path_prefix: parts.join('/'), status: p.status || 'published', tags: p.tags || [], blocks: [] });
      } catch (e) { /* a slug the setup already made */ }
    }
    require('../src/menus').saveMenus(fixture.menus || {});
    if (fixture.overrides) require('../src/theme').saveOverrides(fixture.overrides);
  }
  require('../src/auth').createAdmin('owner', 'owner-pass-1');
  // THE POINT: the provider that has no endpoint. A server-side call is not
  // merely slow here — it is impossible, exactly as on the hosted copy.
  require('../src/ai').saveSettings({ provider: 'browser', model: LLM_MODEL, baseUrl: '' });
  const menusBefore = JSON.stringify(require('../src/menus').loadMenus());

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    const t0 = Date.now();
    let d = (await req('POST', '/admin/api/inject/menu-organizer/run', { cookie, body: { brief: '', size: 'lite' } })).json || {};
    check('POST …/run answers with a modelCall instead of refusing BROWSER_RELAY',
      d.ok === true && d.relay === true && d.modelCall && d.modelCall.id && d.modelCall.body);
    if (!d.ok) console.log('    ', d.code || '', String(d.error || '').slice(0, 300));
    const first = d.modelCall && d.modelCall.body;
    check('the composed body carries the pack, the owner\'s model and reasoning off',
      !!first && first.model === LLM_MODEL && first.reasoning_effort === 'none' &&
      Array.isArray(first.messages) && first.messages.length === 2 &&
      /bent-menus|bent-menu/.test(first.messages[1].content || ''));
    check('the server holds the state; the page carries only an opaque id',
      typeof d.modelCall.id === 'string' && /^run_[0-9a-f]{24}$/.test(d.modelCall.id));

    let turns = 0;
    while (d && d.ok && d.modelCall) {
      turns++;
      console.log(`… turn ${turns}: relaying ${JSON.stringify(d.modelCall.body).length} chars to ${LLM_BASE} (${LLM_MODEL})`);
      const result = await relayToModel(d.modelCall.body);
      const step = { id: d.modelCall.id, result };
      d = (await req('POST', '/admin/api/inject/menu-organizer/run', { cookie, body: { step } })).json || {};
    }
    const secs = Math.round((Date.now() - t0) / 1000);

    check(`the relayed run finished (${secs}s, ${turns} model turn(s), ${d.rounds || '?'} round(s))`, d.ok === true);
    if (!d.ok) console.log('    ', d.code || '', String(d.error || '').slice(0, 400));
    check('at most one repair round — the same rule a server-side run follows', turns <= 2 && (!d.rounds || d.rounds <= 2));
    check('the reply is a <bent-menus> document the door parsed',
      typeof d.reply === 'string' && /<bent-menu/.test(d.reply) && d.preview && d.preview.menus);
    check('no hard warning on the result', d.hard === false);
    check('the answer names the browser as the provider', d.provider && d.provider.id === 'browser');
    check('usage came back from the owner\'s own model', d.usage && (d.usage.prompt_tokens || 0) > 0);
    if (d.preview && d.preview.fitLine) console.log('     fit:', d.preview.fitLine);
    if (d.warnings && d.warnings.length) console.log('     warnings:', d.warnings.map((w) => w.code).join(', '));

    if (d.ok) {
      const paste = await req('POST', '/admin/api/inject/menu-organizer/paste', { cookie, body: { reply: d.reply, brief: '' } });
      const codes = (x) => ((x && x.warnings) || []).map((w) => w.code).sort().join(',');
      check('pasting the same reply gives the same warnings (the relay used the real door)',
        paste.status === 200 && paste.json.ok && codes(paste.json) === codes(d));
    }
    const stale = await req('POST', '/admin/api/inject/menu-organizer/run', { cookie, body: { step: { id: 'run_' + '0'.repeat(24), result: {} } } });
    check('a forged step id is refused (400 RELAY_EXPIRED)', stale.status === 400 && stale.json.code === 'RELAY_EXPIRED');

    const menusAfter = JSON.stringify(require('../src/menus').loadMenus());
    check('the run applied NOTHING (menus table untouched)', menusAfter === menusBefore);
  } catch (e) {
    check('smoke ran without an exception: ' + e.message, false);
  } finally {
    child.kill();
  }
  console.log(fail ? '\nSMOKE BRIDGE-RUN: FAIL' : '\nSMOKE BRIDGE-RUN: PASS');
  process.exit(fail ? 1 : 0);
})();
