'use strict';

/**
 * v1.20 QA — proves src/routes/symbols.js works end-to-end as a mounted
 * Express Router: the saved-reusable-block library API (list / save /
 * delete) through real HTTP. The builder's 💠 panel calls exactly these
 * three endpoints; no prior smoke test exercised them over the wire.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-symbols-route-'));
const PORT = 3980;
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
    title: 'אתר בדיקה', description: 'symbols-route smoke',
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

    // ── empty to start ──
    const list0 = await req('GET', '/admin/api/symbols', { cookie });
    check('GET /admin/api/symbols → 200, empty list initially', list0.status === 200 && list0.json.ok && Array.isArray(list0.json.symbols) && list0.json.symbols.length === 0);

    // ── save a real reusable block ──
    const save = await req('POST', '/admin/api/symbols', { cookie, body: { name: 'כרטיס גיבור', block: { type: 'heading', level: 1, html: 'שלום' } } });
    check('POST /admin/api/symbols saves a real block', save.status === 200 && save.json.ok && save.json.symbol && save.json.symbol.id && save.json.symbol.type === 'heading');
    const symId = save.json.symbol.id;

    const list1 = await req('GET', '/admin/api/symbols', { cookie });
    check('the saved symbol appears in the list', list1.json.symbols.length === 1 && list1.json.symbols[0].id === symId && list1.json.symbols[0].name === 'כרטיס גיבור');

    // ── validation: a nameless save and an invalid block are both rejected 400 ──
    const noName = await req('POST', '/admin/api/symbols', { cookie, body: { name: '  ', block: { type: 'text' } } });
    check('a nameless symbol → 400', noName.status === 400 && noName.json.ok === false);
    const badBlock = await req('POST', '/admin/api/symbols', { cookie, body: { name: 'x', block: { notype: true } } });
    check('a block with no type → 400', badBlock.status === 400 && badBlock.json.ok === false);

    // ── the stored block is a detached snapshot (structure round-trips) ──
    check('the stored block round-trips its real content', list1.json.symbols[0].block && list1.json.symbols[0].block.html === 'שלום');

    // ── delete ──
    const del = await req('POST', '/admin/api/symbols/delete', { cookie, body: { id: symId } });
    check('POST /admin/api/symbols/delete removes it', del.status === 200 && del.json.ok === true);
    const list2 = await req('GET', '/admin/api/symbols', { cookie });
    check('the deleted symbol is gone from the list', list2.json.symbols.length === 0);

    const delMissing = await req('POST', '/admin/api/symbols/delete', { cookie, body: { id: 'sym_nope' } });
    check('deleting an unknown id → {ok:false} with a message, not a crash', delMissing.status === 200 && delMissing.json.ok === false && !!delMissing.json.error);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE SYMBOLS-ROUTE: FAIL' : 'SMOKE SYMBOLS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
