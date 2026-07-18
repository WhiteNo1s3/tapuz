'use strict';

/**
 * v1.18 QA — proves src/routes/mission.js works end-to-end as a mounted
 * Express Router: the four `/admin/api/mission/*` admin endpoints
 * (providers, teach, create, activate) through real HTTP against a real
 * server. The copilot's own PULL side (/agent/v1/mission*) is a different
 * surface and is covered by smoke-agent-bridge; this is genuinely new
 * coverage for the admin-facing mission API, exercised over the wire for
 * the first time.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-mission-route-'));
const PORT = 3978;
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
    title: 'אתר בדיקה', description: 'mission-route smoke',
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

    // ── providers list ──
    const prov = await req('GET', '/admin/api/mission/providers', { cookie });
    check('GET /admin/api/mission/providers → 200 with a real provider list', prov.status === 200 && prov.json.ok && Array.isArray(prov.json.providers) && prov.json.providers.length >= 1);
    // every entry carries a label + a url field; the named providers point
    // at a real site, while the catch-all 'generic' ("Any AI") intentionally
    // has an empty url (no single destination to send the user to).
    check('provider entries carry a label + url field', prov.json.providers.every((p) => p.label && typeof p.url === 'string'));
    check('the named providers carry a real destination url', prov.json.providers.filter((p) => p.id !== 'generic').every((p) => /^https?:\/\//.test(p.url)));

    // ── teach pack ──
    const teach = await req('POST', '/admin/api/mission/teach', { cookie, body: { provider: 'generic' } });
    check('POST /admin/api/mission/teach → the full roleplay teach pack', teach.status === 200 && teach.json.ok && typeof teach.json.message === 'string' && teach.json.message.length > 200);
    check('teach pack reports a real module count (the tool inventory)', teach.json.moduleCount > 0 && teach.json.kind === 'site-builder-roleplay');

    // ── create a mission ──
    const create = await req('POST', '/admin/api/mission/create', {
      cookie,
      body: { description: 'בנה לי דף נחיתה למאפייה', title: 'מאפיית הבוקר', slug: 'bakery', provider: 'generic' }
    });
    check('POST /admin/api/mission/create → a real mission with id + teach/build/oneShot', create.status === 200 && create.json.ok && create.json.mission.id && create.json.mission.teachMessage && create.json.mission.buildMessage && create.json.mission.oneShot);
    check('created mission starts pending at the teach step', create.json.mission.status === 'pending' && create.json.mission.step === 'teach');
    check('the description drives the build message (the quest brief)', /מאפייה/.test(create.json.mission.buildMessage) || /מאפיית הבוקר/.test(create.json.mission.oneShot));

    // ── create validation: empty description → 400 ──
    const createBad = await req('POST', '/admin/api/mission/create', { cookie, body: { description: '   ' } });
    check('create with a blank description → 400, not a crash', createBad.status === 400 && createBad.json.ok === false);

    // ── the created mission is the one the copilot PULL side now sees ──
    // (proves create actually persisted through the store, not just echoed)
    const activate = await req('POST', `/admin/api/mission/activate/${create.json.mission.id}`, { cookie, body: {} });
    check('POST /admin/api/mission/activate/:id re-arms an existing mission', activate.status === 200 && activate.json.ok && activate.json.mission.id === create.json.mission.id && activate.json.mission.status === 'pending');

    const activateMissing = await req('POST', '/admin/api/mission/activate/deadbeef00000000', { cookie, body: {} });
    check('activate of an unknown id → 404, not a crash', activateMissing.status === 404 && activateMissing.json.ok === false);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE MISSION-ROUTE: FAIL' : 'SMOKE MISSION-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
