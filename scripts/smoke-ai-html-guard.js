'use strict';

/**
 * Model-written raw HTML loses its script on every AI door (v2.39).
 *
 * Found in the hard live tests: a copilot proposal holding a <bent-html> with
 * <script>, onerror= and a javascript: link passed every check, was approved
 * (its preview is sandboxed, so nothing showed), was saved — and the builder's
 * 👁 live preview then ran it on the admin origin, inside the owner's session;
 * the paste flow's "save and publish" would have served it to every visitor.
 *
 * (1) the scrubber; (2) every door on a real server — the copilot proposal,
 * the admin create route, the paste flow's source save, the agent API;
 * (3) the owner's own source editor keeps raw HTML; (4) the previews run in
 * an opaque origin.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-ai-html-'));
process.env.TAPUZ_ROOT = ROOT;
const PORT = 3958;
const BASE = `http://127.0.0.1:${PORT}`;

const { scrubAiSource } = require('../src/ai-html-guard');
const { escapeAttr } = require('../src/pzn/language/escape');
const pzn = require('../src/pzn/index');

const EVIL = '<div class="w">ווידג׳ט <b>מודגש</b></div>' +
  '<script>fetch("/admin/api/ai/settings")</script>' +
  '<img src=x onerror="alert(1)">' +
  '<a href="javascript:alert(2)">א</a>' +
  '<a href="jav&#x61;script:alert(3)">ב</a>' +
  '<iframe src="https://evil.example"></iframe>' +
  '<a href="/contact">צור קשר</a>';
const doc = (slug, html, extra = '') =>
  '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>בדיקה</title><meta name="bent-slug" content="' + slug + '"/></head>\n<body>\n' +
  '<bent-heading id="h" level="1">שלום</bent-heading>\n<bent-html id="raw" content="' + escapeAttr(html) + '" />\n' + extra + '</body></html>';
const dirty = (s) => /<script|onerror|javascript:|jav&#x61;script|<iframe/i.test(s);
const htmlOf = (source) => {
  const out = [];
  const walk = (nodes) => (nodes || []).forEach((n) => { if (n.name === 'html') out.push(n.props.content || ''); walk(n.children); });
  walk(pzn.parse(source).body);
  return out;
};

// ── 1. the scrubber ──
{
  const nested = doc('n', '<p>ok</p>', '<bent-section id="s"><bent-html id="inner" content="' + escapeAttr('<script>x()</script><p>פנים</p>') + '" /></bent-section>\n');
  const r = scrubAiSource(nested);
  const contents = htmlOf(r.source);
  check('script, onerror, javascript: (entity-obfuscated too) and iframe are removed — from a nested block as well',
    r.scrubbed === 1 && contents.every((c) => !dirty(c)) && contents.some((c) => c.includes('פנים')));
  const r2 = scrubAiSource(doc('e', EVIL));
  const c2 = htmlOf(r2.source)[0];
  check('…the widget, its bold text and the safe link stay', r2.scrubbed === 1 && !dirty(c2) && /ווידג׳ט <b>מודגש<\/b>/.test(c2) && /href="\/contact"/.test(c2));
  const clean = doc('c', '<div>נקי</div>');
  check('a clean document comes back byte for byte (0 scrubbed)', scrubAiSource(clean).source === clean && scrubAiSource(clean).scrubbed === 0);
}

// ── 4 (static). the previews run in an opaque origin ──
{
  const builder = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-builder.js'), 'utf8');
  const copilotRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'copilot.js'), 'utf8');
  check('the builder\'s 👁 live preview iframe is sandboxed WITHOUT allow-same-origin',
    /<iframe title="תצוגת טיוטה" sandbox="allow-scripts allow-popups"><\/iframe>/.test(builder));
  check('the paste flow\'s preview iframe (srcdoc of a pasted reply) is sandboxed WITHOUT allow-same-origin',
    /<iframe id="preview-frame" title="תצוגה מקדימה" sandbox="allow-scripts"/.test(copilotRoute));
}

function req(method, urlPath, { form, json, cookie, token } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE };
    if (form != null) { data = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (json != null) { data = JSON.stringify(json); headers['Content-Type'] = 'application/json'; }
    if (cookie) headers.Cookie = cookie;
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => { let body = null; try { body = JSON.parse(buf); } catch (e) { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text: buf, json: body }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try { await req('GET', '/admin/login'); return; } catch (e) { await new Promise((r) => setTimeout(r, 150)); }
  }
  throw new Error('server did not start');
}
const draftOf = async (cookie, slug) => (await req('GET', '/admin/api/pzn/source?fullPath=' + encodeURIComponent(slug), { cookie })).json;

(async () => {
  require('../src/db');
  require('../src/setup').runSetup({
    title: 'אתר', description: 'ai html guard', colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  require('../src/auth').createAdmin('owner', 'owner-pass-1');
  const writeTok = require('../src/agent-tokens').mintToken({ name: 'companion', scopes: ['read', 'write'] }).token;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) }, stdio: 'ignore' });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── 2a. the copilot: the proposal the owner approves is already clean ──
    await req('POST', '/admin/api/ai/settings', { cookie, json: { provider: 'browser' } });
    const t1 = (await req('POST', '/admin/api/ai/chat', { cookie, json: { message: 'דף עם וידג׳ט', history: [], context: { canvas: 'blank', surface: 'copilot' }, window: { tokens: 262144, source: 'bridge' } } })).json;
    const call = { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'w1', type: 'function', function: { name: 'create_page', arguments: JSON.stringify({ source: doc('copilot-widget', EVIL) }) } }] } }] };
    const t2 = (await req('POST', '/admin/api/ai/chat', { cookie, json: { step: { id: t1 && t1.modelCall ? t1.modelCall.id : 'x', result: call } } })).json;
    check('copilot: the approval card carries the SCRUBBED document (what the owner previews is what will be saved)',
      !!(t2 && t2.pending && t2.pending.input && !dirty(htmlOf(t2.pending.input.source)[0]) && /ווידג׳ט/.test(t2.pending.input.source)));
    check('…and the owner is told, in Hebrew, that code was removed from the model\'s HTML', !!(t2 && /הוסרו קטעי קוד/.test(t2.notice || '')));
    const ok = (await req('POST', '/admin/api/ai/chat', { cookie, json: { approve: { id: t2 && t2.pending ? t2.pending.id : 'x', ok: true } } })).json;
    const saved = await draftOf(cookie, 'copilot-widget');
    check('…approved and saved: the draft holds no script', !!(ok && ok.applied && saved && saved.ok && !dirty(saved.source)));

    // ── 2b. the admin create route (the chat's "צור דף", the paste flow's new page) ──
    const c = await req('POST', '/admin/api/pzn/create-from-source', { cookie, json: { source: '```html\n' + doc('paste-new', EVIL) + '\n```', publish: true } });
    const cDraft = await draftOf(cookie, 'paste-new');
    check('admin create-from-source (even with publish:true): scrubbed=1, a notice, and neither draft nor live file carries script',
      c.status === 200 && c.json.scrubbed === 1 && /הוסרו קטעי קוד/.test(c.json.notice || '') && cDraft.ok && !dirty(cDraft.source) &&
      // the live file has the site's own scripts — look for the PAYLOAD's fingerprints
      !/admin\/api\/ai\/settings|onerror=|javascript:alert|evil\.example/.test(fs.existsSync(path.join(ROOT, 'public', 'paste-new.html')) ? fs.readFileSync(path.join(ROOT, 'public', 'paste-new.html'), 'utf8') : 'MISSING admin/api/ai/settings'));

    // ── 2c. the paste flow's update of an existing page (from:'ai') ──
    const u = await req('POST', '/admin/api/pzn/source', { cookie, json: { fullPath: 'paste-new', source: doc('paste-new', EVIL), from: 'ai' } });
    check('paste flow update (from:"ai"): scrubbed and saved clean', u.status === 200 && u.json.scrubbed === 1 && !dirty((await draftOf(cookie, 'paste-new')).source));

    // ── 3. the owner's own source editor keeps raw HTML exactly as written ──
    const own = await req('POST', '/admin/api/pzn/source', { cookie, json: { fullPath: 'paste-new', source: doc('paste-new', '<script>window.ownerWidget = 1</script>') } });
    check('the owner\'s source save (no from:"ai") keeps their script — the escape hatch is theirs',
      own.status === 200 && own.json.scrubbed === 0 && /<script>window\.ownerWidget = 1<\/script>/.test(htmlOf((await draftOf(cookie, 'paste-new')).source)[0]));

    // ── 2d. the agent API (the copy companion, the extension) ──
    const a = await req('POST', '/agent/v1/create-from-source', { token: writeTok, json: { source: doc('agent-widget', EVIL) } });
    check('agent create-from-source: scrubbed=1 and the draft holds no script',
      a.status === 200 && a.json.scrubbed === 1 && !dirty((await draftOf(cookie, 'agent-widget')).source));

    // ── 4. the draft preview runs in an opaque origin even opened on its own ──
    const pv = await req('GET', '/admin/preview/paste-new', { cookie });
    const csp = [].concat(pv.headers['content-security-policy'] || []).join(' | ');
    check('/admin/preview sends CSP "sandbox allow-scripts allow-popups" (no allow-same-origin)',
      pv.status === 200 && /sandbox allow-scripts allow-popups/.test(csp) && !/allow-same-origin/.test(csp));
  } catch (e) {
    check('harness: ' + e.message, false);
  } finally {
    child.kill();
    try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
  console.log('');
  console.log(fail ? 'SMOKE AI-HTML-GUARD: FAIL' : 'SMOKE AI-HTML-GUARD: PASS');
  process.exit(fail ? 1 : 0);
})();
