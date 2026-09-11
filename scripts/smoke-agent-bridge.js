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
    // v2.20: the bridge takes only the BenTML — a keyword-dialect reply, still
    // wearing the <html> brackets a chat put around it, becomes a real page
    const wordsReply = '<html>\nBENTML 0.2\n\nMETA {\n  title: "מהמילים דרך הגשר"\n  slug: "from-words-agent"\n}\n\nHEADING(level: 1) { שלום מהגשר }\n\nTEXT { פסקה }\n</html>';
    const cfsWords = await req('POST', '/agent/v1/create-from-source', { token: writeTok, body: { source: wordsReply, publish: true } });
    check('create-from-source accepts an <html>-wrapped BENTML 0.2 reply', cfsWords.status === 200 && cfsWords.json.ok && cfsWords.json.fullPath === 'from-words-agent' && cfsWords.json.dialect === 'line');
    const cfsWordsSrc = await req('GET', '/agent/v1/source?fullPath=from-words-agent', { token: readTok });
    check('…and stores it as a clean .pzn document', cfsWordsSrc.status === 200 && /<bent-heading/.test(cfsWordsSrc.json.source) && !/BENTML 0\.2|<html>\n/.test(cfsWordsSrc.json.source));
    const srcFenced = await req('POST', '/agent/v1/source', { token: writeTok, body: { fullPath: 'from-words-agent', source: 'Sure:\n```html\n<bent-text id="t9">עודכן דרך הגשר</bent-text>\n```\nDone.' } });
    check('POST /agent/v1/source extracts a fenced reply without loose:true', srcFenced.status === 200 && srcFenced.json.ok && srcFenced.json.blocks.length === 1 && Array.isArray(srcFenced.json.extracted) && srcFenced.json.extracted.length > 0);
    // v0.73 BYOK: the provider constants endpoint — the CMS is the authority
    // on where each LLM API lives; the extension fetches this, never hardcodes.
    const prov = await req('GET', '/agent/v1/providers', { token: readTok });
    check('providers endpoint returns the table (read scope)', prov.status === 200 && prov.json.ok && Array.isArray(prov.json.providers) && prov.json.providers.length >= 1);
    const claude = (prov.json.providers || []).find((p) => p.id === 'claude');
    check('claude provider carries endpoint + auth shape + model', !!claude && /anthropic\.com/.test(claude.endpoint) && claude.authHeader === 'x-api-key' && !!claude.defaultModel);
    check('provider table carries NO secret (no apiKey/key field)', (prov.json.providers || []).every((p) => p.apiKey === undefined && p.key === undefined));
    check('providers needs a token (401 without)', (await req('GET', '/agent/v1/providers', {})).status === 401);

    // v0.72 regression: a pristine/empty template (zero modules, placeholder
    // title) must NEVER become a page — one once got PUBLISHED with
    // "כותרת הדף" as the reader-visible title.
    const emptyTemplate = '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>כותרת הדף</title><meta name="bent-slug" content="my-page"/></head>\n<body>\n  <!-- bent-* modules here -->\n</body>\n</html>';
    const cfsEmpty = await req('POST', '/agent/v1/create-from-source', { token: writeTok, body: { source: emptyTemplate, publish: true } });
    check('empty template is rejected (400, no page created)', cfsEmpty.status === 400 && (await req('GET', '/my-page.html')).status === 404);
    // ===== v0.47 security-review regressions =====
    // (a) uploaded SVGs are served under a sandbox that ACTUALLY applies (the
    //     earlier /assets middleware was dead code shadowed by static mount).
    fs.mkdirSync(path.join(ROOT, 'public', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'public', 'assets', 'probe.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const svg = await req('GET', '/assets/probe.svg');
    check('served SVG has sandbox CSP', /sandbox/.test(svg.headers['content-security-policy'] || ''));
    check('served SVG forces download (Content-Disposition)', /attachment/.test(svg.headers['content-disposition'] || ''));
    check('served SVG has nosniff', (svg.headers['x-content-type-options'] || '') === 'nosniff');

    // (b) body-parser / error responses never leak a stack trace to clients
    const bigBody = await new Promise((resolve) => {
      const data = JSON.stringify({ x: 'a'.repeat(600 * 1024) });
      const r = http.request(BASE + '/agent/v1/ping', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
        let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      r.on('error', () => resolve({ status: 0, body: '' }));
      r.write(data); r.end();
    });
    check('oversized agent body → 413, no stack leak', bigBody.status === 413 && !/node_modules|\.js:\d|\bat\s/.test(bigBody.body));

    // (c) public CSP applies to a page whose name starts with "admin" (boundary fix)
    // (home page proves CSP present on public pages)
    const homeCsp = await req('GET', '/');
    check('public page carries CSP', /default-src 'self'/.test(homeCsp.headers['content-security-policy'] || ''));
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
