'use strict';

/**
 * v0.45 QA — the agent bridge: scoped bearer tokens, CORS, /agent/v1 API,
 * and the intent→.pzn build endpoint. Boots a real server on a throwaway
 * TAPUZ_ROOT and drives it over HTTP as an external agent would.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-agent-'));
const PORT = 3949;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { token, body, origin } = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (data) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (origin) headers['Origin'] = origin;
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
      const r = http.get(BASE + '/', () => resolve()).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
      r.end();
    };
    tick(tries);
  });
}

async function main() {
  // seed a site + admin so the DB/config exist
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר גשר', description: 'agent bridge test',
    colors: { primary: '#7c3aed', bg: '#fff', lightBg: '#faf5ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  // mint tokens directly (the admin UI path is exercised by unit calls below)
  const agentTokens = require('../src/agent-tokens');
  const writeTok = agentTokens.mintToken({ name: 'writer', scopes: ['read', 'write'] }).token;
  const readTok = agentTokens.mintToken({ name: 'reader', scopes: ['read'] }).token;
  check('mint returns tzk_ token', writeTok.startsWith('tzk_'));
  check('write token implies read scope', agentTokens.verifyAgentToken(writeTok).scopes.includes('read'));
  check('revoked token stops verifying', (() => {
    const t = agentTokens.mintToken({ name: 'temp' });
    const id = agentTokens.verifyAgentToken(t.token).id;
    agentTokens.revokeToken(id);
    return agentTokens.verifyAgentToken(t.token) === null;
  })());
  check('list never leaks secrets', agentTokens.listTokens().every((t) => !('hash' in t) && !('token' in t)));

  // boot the server as a child on the same root
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();

    // --- auth gates ---
    check('no token → 401', (await req('GET', '/agent/v1/ping')).status === 401);
    check('garbage token → 401', (await req('GET', '/agent/v1/ping', { token: 'tzk_notreal' })).status === 401);
    const ping = await req('GET', '/agent/v1/ping', { token: readTok });
    check('valid token → ping ok', ping.status === 200 && ping.json.ok && ping.json.agent === 'reader');

    // --- CORS ---
    const pre = await req('OPTIONS', '/agent/v1/build', { origin: 'https://chatgpt.com' });
    check('OPTIONS preflight → 204', pre.status === 204);
    check('CORS Allow-Origin *', pre.headers['access-control-allow-origin'] === '*');
    check('CORS has NO credentials header (bearer-safe)', pre.headers['access-control-allow-credentials'] === undefined);
    check('CORS allows Authorization header', /authorization/i.test(pre.headers['access-control-allow-headers'] || ''));

    // --- scope enforcement ---
    const readWrite = await req('POST', '/agent/v1/build', {
      token: readTok, body: { intent: { title: 'x', sections: [{ type: 'heading', text: 'hi' }] } }
    });
    check('read token cannot write → 403', readWrite.status === 403);

    // --- read endpoints ---
    const primer = await req('GET', '/agent/v1/primer', { token: readTok });
    check('primer served', primer.status === 200 && /bent-hero/.test(primer.text));
    const toolbox = await req('GET', '/agent/v1/toolbox', { token: readTok });
    check('toolbox served', toolbox.status === 200 && toolbox.json.ok && Array.isArray(toolbox.json.toolbox.categories));

    // --- intent build (the Grokin trick) ---
    const build = await req('POST', '/agent/v1/build', {
      token: writeTok, origin: 'https://chatgpt.com',
      body: {
        publish: true,
        intent: {
          title: 'סטודיו גשר', slug: 'bridge-studio', tags: ['article'],
          sections: [
            { type: 'hero', heading: 'סטודיו', text: 'צילום', buttonText: 'צרו קשר', buttonHref: '/contact', image: '/uploads/b.jpg', overlay: 40, parallax: true, height: 'lg' },
            { type: 'marquee', text: 'ברוכים הבאים', speed: 'fast' },
            { type: 'features', columns: 2, items: [{ title: 'א', icon: '⭐', text: 'תיאור' }] }
          ]
        }
      }
    });
    check('build created + published page', build.status === 200 && build.json.ok && build.json.created && build.json.fullPath === 'bridge-studio');
    check('build stored hero overlay/parallax', (() => {
      const hero = (build.json.blocks || [])[0];
      return hero && hero.data.overlay === 40 && hero.data.parallax === true;
    })());
    // live page exists (publish ran exportAll)
    const live = await req('GET', '/bridge-studio.html');
    check('published page is live', live.status === 200 && /marquee/.test(live.text) && /סטודיו/.test(live.text));

    // --- source round-trip via token ---
    const getSrc = await req('GET', '/agent/v1/source?fullPath=bridge-studio', { token: readTok });
    check('get source via token', getSrc.status === 200 && /bent-hero/.test(getSrc.json.source));
    const badBuild = await req('POST', '/agent/v1/build', { token: writeTok, body: { intent: { title: 'x', sections: [] } } });
    check('empty intent rejected with code', badBuild.status === 400 && badBuild.json.code === 'E_INTENT_EMPTY');

    // --- ops via token ---
    const ops = await req('POST', '/agent/v1/ops', {
      token: writeTok, body: { fullPath: 'bridge-studio', ops: [{ op: 'insert', type: 'text', overrides: { id: 'added', text: 'נוסף דרך ops' } }] }
    });
    check('ops applied via token', ops.status === 200 && ops.json.ok && /נוסף דרך ops/.test(ops.json.source));

    // ===== security regressions (v0.45 adversarial review) =====
    // build collision → 409 unless update:true
    const collide = await req('POST', '/agent/v1/build', {
      token: writeTok, body: { intent: { title: 'x', slug: 'bridge-studio', sections: [{ type: 'text', text: 'clobber' }] } }
    });
    check('build collision → 409', collide.status === 409);
    const overwrite = await req('POST', '/agent/v1/build', {
      token: writeTok, body: { update: true, intent: { title: 'x', slug: 'bridge-studio', sections: [{ type: 'text', text: 'ok-overwrite' }] } }
    });
    check('build update:true overwrites', overwrite.status === 200 && overwrite.json.ok);

    // path traversal via crafted slug — no file escapes the pages dir
    const BS = String.fromCharCode(92);
    const trav = await req('POST', '/agent/v1/build', {
      token: writeTok, body: { intent: { title: 'pwn', slug: '..' + BS + '..' + BS + 'pwned', sections: [{ type: 'text', text: 'x' }] } }
    });
    const travEscaped = !fs.existsSync(path.join(ROOT, 'pwned.pzn')) && !fs.existsSync(path.join(ROOT, 'pages', 'pwned.pzn'));
    check('path traversal neutralized (slug sanitized)', trav.status === 200 && trav.json.fullPath === 'pwned' && travEscaped);

    // javascript: URL scheme neutralized in built page
    const jsUrl = await req('POST', '/agent/v1/build', {
      token: writeTok, body: { intent: { title: 'j', slug: 'js-test', sections: [{ type: 'button', text: 'x', href: 'javascript:alert(1)' }] } }
    });
    const jsSrc = await req('GET', '/agent/v1/source?fullPath=js-test', { token: readTok });
    check('javascript: scheme neutralized', jsUrl.status === 200 && !/javascript:/.test(jsSrc.json.source || ''));

    // deep-nesting DoS guard
    let deep = { type: 'parallax', image: '/x.jpg', sections: [] }; let cur = deep;
    for (let i = 0; i < 12; i++) { const n = { type: 'parallax', image: '/x.jpg', sections: [] }; cur.sections = [n]; cur = n; }
    const deepR = await req('POST', '/agent/v1/build', { token: writeTok, body: { intent: { title: 'd', slug: 'deep', sections: [deep] } } });
    check('deep-nesting rejected', deepR.status === 400 && deepR.json.code === 'E_INTENT_TOO_DEEP');

    // create-from-source (the extension's main path): bot .pzn reply → new page
    const botReply = 'בשמחה!\n\n```html\n<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>מהתוסף</title><meta name="bent-slug" content="from-ext"/></head>\n<body><bent-hero id="h"><bent-heading id="hh" level="1">נבנה מהתוסף</bent-heading></bent-hero></body>\n</html>\n```';
    const cfs = await req('POST', '/agent/v1/create-from-source', { token: writeTok, body: { source: botReply, publish: true } });
    check('create-from-source builds page from bot reply', cfs.status === 200 && cfs.json.ok && cfs.json.fullPath === 'from-ext' && cfs.json.created);
    const cfsLive = await req('GET', '/from-ext.html');
    check('create-from-source page is live', cfsLive.status === 200 && /נבנה מהתוסף/.test(cfsLive.text));
    const cfsDup = await req('POST', '/agent/v1/create-from-source', { token: writeTok, body: { source: botReply } });
    check('create-from-source collision → 409', cfsDup.status === 409);
    check('create-from-source needs write scope', (await req('POST', '/agent/v1/create-from-source', { token: readTok, body: { source: botReply } })).status === 403);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE AGENT BRIDGE: FAIL' : 'SMOKE AGENT BRIDGE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('smoke crashed:', e.message);
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (er) {}
  process.exit(1);
});
