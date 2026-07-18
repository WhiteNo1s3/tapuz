'use strict';

/**
 * v0.97 QA — proves src/routes/team.js works end-to-end as a mounted Express
 * Router (not just the auth.js unit contract smoke-team.js already covers).
 * Boots a REAL server on a throwaway TAPUZ_ROOT: role-gated 403s for an
 * editor, the full admin CRUD lifecycle through real HTTP calls, and the
 * self-protection guards (can't change/remove your own row) via the API.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-team-routes-'));
const PORT = 3961;
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

async function login(username, password) {
  const r = await req('POST', '/admin/login', { form: { username, password } });
  return String(r.headers['set-cookie'] || '').split(';')[0];
}

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'team-routes smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin, addTeamMember } = require('../src/auth');
  const owner = createAdmin('owner', 'owner-pass-1');
  const editorAcct = addTeamMember('dana', 'dana-pass-1', 'editor');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();

    const adminCookie = await login('owner', 'owner-pass-1');
    const editorCookie = await login('dana', 'dana-pass-1');
    check('both accounts can log in', adminCookie.length > 0 && editorCookie.length > 0);

    // ── role gate: an editor is blocked, an admin gets through ──
    const editorPage = await req('GET', '/admin/team', { cookie: editorCookie });
    check('editor GET /admin/team → 403 (not a silent partial page)', editorPage.status === 403);
    const editorApi = await req('POST', '/admin/api/team', { cookie: editorCookie, body: { username: 'x', password: 'y'.repeat(8), role: 'editor' } });
    check('editor POST /admin/api/team → 403 json', editorApi.status === 403 && editorApi.json && editorApi.json.ok === false);

    const adminPage = await req('GET', '/admin/team', { cookie: adminCookie });
    check('admin GET /admin/team → 200 and lists the invited editor', adminPage.status === 200 && adminPage.text.includes('dana'));

    // ── full CRUD lifecycle through real HTTP ──
    const invited = await req('POST', '/admin/api/team', {
      cookie: adminCookie, body: { username: 'ronit', password: 'ronit-pass-1', role: 'editor' }
    });
    check('admin invites a teammate via the mounted router', invited.status === 200 && invited.json.ok && invited.json.user.role === 'editor');

    const promoted = await req('POST', '/admin/api/team/' + invited.json.user.id + '/role', {
      cookie: adminCookie, body: { role: 'admin' }
    });
    check('admin promotes the invited teammate', promoted.status === 200 && promoted.json.user.role === 'admin');

    const removed = await req('DELETE', '/admin/api/team/' + invited.json.user.id, { cookie: adminCookie });
    check('admin removes the (now-admin, but not the last) teammate', removed.status === 200 && removed.json.ok);

    // ── self-protection, enforced server-side even if the UI is bypassed ──
    const ownerRow = (await req('GET', '/admin/api/agent-tokens', { cookie: adminCookie })); // warm session, unrelated
    const selfDemote = await req('POST', '/admin/api/team/' + owner.id + '/role', { cookie: adminCookie, body: { role: 'editor' } });
    check('admin cannot change their own role via the API', selfDemote.status === 400 && !selfDemote.json.ok);
    const selfRemove = await req('DELETE', '/admin/api/team/' + owner.id, { cookie: adminCookie });
    check('admin cannot remove themselves via the API', selfRemove.status === 400 && !selfRemove.json.ok);

    // ── editor keeps full access to a non-gated surface (e.g. the pages API) ──
    const pagesAsEditor = await req('GET', '/admin/api/pages', { cookie: editorCookie });
    check('editor keeps access to ungated content routes (pages API)', pagesAsEditor.status === 200);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE TEAM-ROUTES: FAIL' : 'SMOKE TEAM-ROUTES: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
