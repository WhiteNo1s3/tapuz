'use strict';

/**
 * v1.19 QA — proves src/routes/agent-tokens.js works end-to-end as a
 * mounted Express Router: mint / list / revoke of `/agent`-surface bearer
 * tokens, through real HTTP. Security-focused (a token is site access):
 * the requireAdmin gate actually 403s an editor, the secret is returned
 * exactly ONCE (never in the list), a minted token really authenticates on
 * the public /agent surface, and revoking it actually kills that access.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-agent-tokens-route-'));
const PORT = 3979;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie, bearer } = {}) {
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
    if (bearer) headers['Authorization'] = 'Bearer ' + bearer;
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
    title: 'אתר בדיקה', description: 'agent-tokens-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin, addTeamMember } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  addTeamMember('editor1', 'editor-pass-1', 'editor');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const adminLogin = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const adminCookie = String(adminLogin.headers['set-cookie'] || '').split(';')[0];
    const editorLogin = await req('POST', '/admin/login', { form: { username: 'editor1', password: 'editor-pass-1' } });
    const editorCookie = String(editorLogin.headers['set-cookie'] || '').split(';')[0];

    // ── the requireAdmin gate: an editor is refused ──
    const editorList = await req('GET', '/admin/api/agent-tokens', { cookie: editorCookie });
    check('an editor cannot list agent tokens (requireAdmin → 403)', editorList.status === 403);
    const editorMint = await req('POST', '/admin/api/agent-tokens', { cookie: editorCookie, body: { name: 'x', scopes: ['read'] } });
    check('an editor cannot mint an agent token (requireAdmin → 403)', editorMint.status === 403);

    // ── empty list to start ──
    const list0 = await req('GET', '/admin/api/agent-tokens', { cookie: adminCookie });
    check('admin sees an empty token list initially', list0.status === 200 && list0.json.ok && Array.isArray(list0.json.tokens) && list0.json.tokens.length === 0);

    // ── mint: the secret is returned exactly once ──
    const mint = await req('POST', '/admin/api/agent-tokens', { cookie: adminCookie, body: { name: 'my-agent', scopes: ['read', 'write'] } });
    check('admin can mint a token; the secret is returned once', mint.status === 200 && mint.json.ok && typeof mint.json.token === 'string' && mint.json.token.length > 20);
    check('the mint response record carries no secret (only public fields)', mint.json.record && mint.json.record.id && mint.json.record.hash === undefined && mint.json.record.token === undefined);
    const secret = mint.json.token;
    const tokenId = mint.json.record.id;

    // ── list: shows the token WITHOUT its secret ──
    const list1 = await req('GET', '/admin/api/agent-tokens', { cookie: adminCookie });
    check('the minted token appears in the list', list1.status === 200 && list1.json.tokens.length === 1 && list1.json.tokens[0].id === tokenId);
    check('the list never exposes the secret or its hash', list1.json.tokens.every((t) => t.hash === undefined && t.token === undefined) && !JSON.stringify(list1.json.tokens).includes(secret));

    // ── the minted secret actually authenticates on the public /agent surface ──
    const ping = await req('GET', '/agent/v1/ping', { bearer: secret });
    check('the minted token authenticates a real /agent request', ping.status === 200 && ping.json.ok);
    const badPing = await req('GET', '/agent/v1/ping', { bearer: secret + 'tampered' });
    check('a tampered token is rejected on the /agent surface', badPing.status === 401);

    // ── revoke: the token is gone, and its /agent access dies ──
    const del = await req('DELETE', `/admin/api/agent-tokens/${tokenId}`, { cookie: adminCookie });
    check('admin can revoke the token', del.status === 200 && del.json.ok === true);
    const list2 = await req('GET', '/admin/api/agent-tokens', { cookie: adminCookie });
    check('the revoked token is gone from the list', list2.json.tokens.length === 0);
    const pingAfter = await req('GET', '/agent/v1/ping', { bearer: secret });
    check('the revoked token no longer authenticates on /agent (access truly killed)', pingAfter.status === 401);

    // ── revoking a missing id is a clean {ok:false}, not a crash ──
    const delMissing = await req('DELETE', '/admin/api/agent-tokens/deadbeef00000000', { cookie: adminCookie });
    check('revoking an unknown id → {ok:false}, not a crash', delMissing.status === 200 && delMissing.json.ok === false);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE AGENT-TOKENS-ROUTE: FAIL' : 'SMOKE AGENT-TOKENS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
