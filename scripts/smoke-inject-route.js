'use strict';

/**
 * v2.28 QA — the injection runner (src/routes/inject.js) end to end, as a
 * mounted Express router behind the real admin gate, with the provider
 * stubbed the way smoke-copilot-tools stubs it (PROVIDERS.__fake +
 * global.fetch), so the model can be as unhelpful as we like.
 *
 * Booted IN-PROCESS (not spawned like the other route smokes): the stub
 * has to live in the same process as the router. The gate, the login
 * screen and the body parsers are wired exactly as server.js wires them.
 *
 * A FAKE pack is registered here so the runner is proven without group C's
 * organizer module: its door refuses on REFUSE, warns UNKNOWN_PAGE (a
 * repairable code) on FIXME, and passes anything else. What is pinned:
 *   • run: max_tokens === 2048, NO tools key, the repair round carries the
 *     assistant turn + "תיקונים נדרשים", rounds/repaired, never applies
 *   • the gates: PACK_TOO_BIG 400, REPLY_TOO_LONG 400 (> 60K chars on
 *     paste/apply/run, before any pack's door), NO_PROVIDER 400,
 *     TIMEOUT 504, EMPTY_REPLY 502, PROVIDER_ERROR 502
 *   • the BROWSER RELAY (v2.29): the 'browser' provider does not refuse any
 *     more — the run becomes a conversation with the PAGE ({modelCall} →
 *     {step} → {modelCall} → {step} → the answer), the server never calls
 *     out, the run's state stays server-side behind an opaque id, and the
 *     final shape is the one a server-side run returns
 *   • theme-designer: apply lands in the library; undo reads the persisted
 *     last-applied id (config/inject-theme-last.json), so a re-required
 *     descriptor still undoes it — and never a hand-pasted 'ai' entry
 *   • requireAdmin on apply/run/undo (401 no session, 403 editor)
 *   • the pack list hides the stubs; the ledger gets a line per action
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-inject-route-'));
process.env.TAPUZ_ROOT = ROOT;
const PORT = 3996;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie, accept } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: accept || 'application/json', Origin: BASE };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      res.setEncoding('utf8');
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

// ── the site ──
require('../src/db');
const { runSetup } = require('../src/setup');
runSetup({
  title: 'אתר בדיקה', description: 'inject-route smoke',
  colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
  menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
});
const { createAdmin, addTeamMember } = require('../src/auth');
createAdmin('owner', 'owner-pass-1');
addTeamMember('dana', 'dana-pass-1', 'editor');

// ── the scripted provider (the smoke-copilot-tools pattern) ──
// ai.js captures the native fetch at load; it must load BEFORE the stub so
// the seam can tell the two apart
const ai = require('../src/ai');
const providers = require('../src/providers');
providers.PROVIDERS.__fake = {
  id: '__fake', label: 'test', endpoint: 'http://127.0.0.1:1/v1/chat/completions',
  method: 'POST', authScheme: 'bearer', authHeader: 'Authorization', extraHeaders: {},
  defaultModel: 'fake-model', models: [], openModel: true, keyOptional: true, maxTokens: 100,
  responsePath: ['choices', 0, 'message', 'content'],
  body: { style: 'openai-chat' }, baseUrlDefault: 'http://127.0.0.1:1/v1'
};
const calls = []; // every request body the "model" saw
let scripted = []; // replies (string) or functions (throw / custom response)
const okReply = (content) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 3 } } })
});
global.fetch = async (url, init) => {
  calls.push(JSON.parse(init.body));
  const next = scripted.shift();
  if (typeof next === 'function') return next();
  return okReply(next == null ? 'DOC CLEAN' : next);
};
ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1', model: 'fake-model' });

// ── the FAKE pack ──
const registry = require('../src/injections');
let applied = 0;
const FAKE = {
  id: 'fake-pack', kind: 'fake', family: 'site', title: '🧪 חבילת בדיקה', blurb: 'לבדיקה בלבד',
  budget: { lite: 9000, full: 14000 },
  buildPrompt({ brief = '', size = 'lite' } = {}) {
    // a pack always teaches its dialect — the NO_BRIEFING gate (v2.42) refuses one that does not
    const text = '# ⚠️ FRESH\nPROMPT ' + size + ' ' + brief + '\n<bent-menus> — הדיאלקט שהחבילה מלמדת';
    return { text, chars: text.length, meta: { size } };
  },
  parse(reply) {
    if (/REFUSE/.test(reply)) { const e = new Error('אין תפריט בתשובה'); e.code = 'NO_MENU'; throw e; }
    const warnings = /FIXME/.test(reply) ? [{ code: 'UNKNOWN_PAGE', message: 'דף לא קיים: nope — הקישור הושמט' }] : [];
    return {
      preview: {
        note: 'הערה מהמודל',
        menus: { main: { location: 'main', tree: [{ label: 'הבית', url: '/', type: 'page', status: 'ok', children: [] }] } },
        diff: { main: { added: [], removed: [], moved: [], relabeled: [] } },
        knobs: { changed: [] },
        fitLine: 'שורה אחת ✓'
      },
      warnings, warningTexts: warnings.map((w) => w.message), notes: [], hard: warnings.length > 0
    };
  },
  apply(reply, ctx, { force } = {}) {
    const p = FAKE.parse(reply);
    if (p.hard && !force) { const e = new Error('יש אזהרות קשות'); e.code = 'HARD_WARNINGS'; e.warnings = p.warnings; throw e; }
    applied++;
    return { landed: { type: 'fake', id: 'main', url: '/admin/menus' }, backupId: 'b-' + applied, changed: { menus: ['main'] }, rebuildError: '', warnings: p.warnings };
  },
  undo() {
    if (!applied) { const e = new Error('אין גיבוי'); e.code = 'NO_BACKUP'; throw e; }
    return { restored: 'b-' + applied-- };
  },
  hardCodes: ['UNKNOWN_PAGE'],
  run: { enabled: true, maxTokens: 2048, timeoutMs: { local: 240000, cloud: 90000 }, repairable: ['UNKNOWN_PAGE'] },
  ui: { briefPlaceholder: 'x', sizes: ['lite', 'full'], applyLabel: 'החל', mount: [], canApply: true, renderPreview: () => '' }
};
registry.register(FAKE);
check('the registry refuses a duplicate id at boot', (() => {
  try { registry.register(FAKE); return false; } catch (e) { return /duplicate/.test(e.message); }
})());
check('the registry refuses a descriptor missing a verb', (() => {
  try { registry.register({ ...FAKE, id: 'broken', parse: undefined }); return false; } catch (e) { return /parse/.test(e.message); }
})());

// ── the app: the gate + login + the router, wired as server.js wires them ──
const express = require('express');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.urlencoded({ extended: true, limit: '256kb' }));
app.use(bodyParser.json({ limit: '12mb' }));
app.use(require('../src/admin-gate').adminGate);
app.use(require('../src/routes/auth-screens'));
app.use(require('../src/routes/inject'));
app.use(require('../src/routes/copilot')); // /admin/inject hosts the packs grid
const server = app.listen(PORT);
// server.js drops sockets idle for 30 s (S4). A local model is silent for
// minutes — the run route must lift that cap for its own socket, or the
// browser sees ECONNRESET instead of the reply. 1.5 s here stands for 30 s.
server.setTimeout(1500);

const LOG_PATH = require('../src/injections/log').LOG_PATH;
const logLines = () => (fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean) : []);

(async () => {
  try {
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' }, accept: 'text/html' });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];
    const editorLogin = await req('POST', '/admin/login', { form: { username: 'dana', password: 'dana-pass-1' }, accept: 'text/html' });
    const editorCookie = String(editorLogin.headers['set-cookie'] || '').split(';')[0];
    check('owner + editor sessions issued', cookie.length > 0 && editorCookie.length > 0);

    // ── GET /admin/api/inject ──
    const list = await req('GET', '/admin/api/inject', { cookie });
    const ids = ((list.json || {}).packs || []).map((p) => p.id);
    check('GET /admin/api/inject → ok with the packs', list.status === 200 && list.json.ok === true && Array.isArray(list.json.packs));
    check('the list carries menu-organizer + theme-designer (+ the test pack)',
      ids.includes('menu-organizer') && ids.includes('theme-designer') && ids.includes('fake-pack'));
    check('the stubs (theme-effects, site-builder) are hidden from the list',
      !ids.includes('theme-effects') && !ids.includes('site-builder'));
    check('each summary carries {title, blurb, family, budget, run.enabled, ui.sizes/mount/briefPlaceholder/applyLabel}',
      list.json.packs.every((p) => p.title && typeof p.blurb === 'string' && p.family && p.budget && typeof p.run.enabled === 'boolean' &&
        Array.isArray(p.ui.sizes) && Array.isArray(p.ui.mount) && 'briefPlaceholder' in p.ui && 'applyLabel' in p.ui));
    const organizer = list.json.packs.find((p) => p.id === 'menu-organizer');
    const organizerReady = (() => { try { require('../src/menu-organizer'); return true; } catch (e) { return false; } })();
    check('menu-organizer run.enabled mirrors whether src/menu-organizer.js is present (' + (organizerReady ? 'present' : 'absent → notReady') + ')',
      organizer.run.enabled === organizerReady && organizer.notReady === !organizerReady);
    const designer = list.json.packs.find((p) => p.id === 'theme-designer');
    check('theme-designer is runnable with maxTokens 6000 in its descriptor',
      designer.run.enabled === true && registry.get('theme-designer').run.maxTokens === 6000);

    // ── GET prompt ──
    const prompt = await req('GET', '/admin/api/inject/fake-pack/prompt?brief=' + encodeURIComponent('קצר') + '&size=full', { cookie, accept: 'text/markdown' });
    check('GET /:id/prompt → markdown with X-Pack-Chars + X-Pack-Tokens-Est',
      prompt.status === 200 && /markdown/.test(String(prompt.headers['content-type'])) && /PROMPT full קצר/.test(prompt.text) &&
      Number(prompt.headers['x-pack-chars']) === prompt.text.length &&
      Number(prompt.headers['x-pack-tokens-est']) === Math.ceil(prompt.text.length / 2.3));
    const unknown = await req('GET', '/admin/api/inject/nope/prompt', { cookie });
    check('an unknown pack → 404', unknown.status === 404 && unknown.json.ok === false);
    const designerPrompt = await req('GET', '/admin/api/inject/theme-designer/prompt?size=lite', { cookie, accept: 'text/markdown' });
    check('theme-designer prompt is the FRESH-chat roleplay pack', designerPrompt.status === 200 && /FRESH/.test(designerPrompt.text.split('\n')[0]) && /bent-theme/.test(designerPrompt.text));
    const stubPrompt = await req('GET', '/admin/api/inject/theme-effects/prompt', { cookie });
    check('a stub pack answers NOT_READY (400), never a crash', stubPrompt.status === 400 && stubPrompt.json.code === 'NOT_READY');

    // ── paste ──
    const paste = await req('POST', '/admin/api/inject/fake-pack/paste', { cookie: editorCookie, body: { reply: 'DOC FIXME' } });
    check('POST /:id/paste (an editor may) → preview + warnings + hard + chars',
      paste.status === 200 && paste.json.ok && paste.json.preview.fitLine === 'שורה אחת ✓' &&
      paste.json.warnings[0].code === 'UNKNOWN_PAGE' && paste.json.warningTexts.length === 1 && paste.json.hard === true && paste.json.chars === 9);
    const pasteRefused = await req('POST', '/admin/api/inject/fake-pack/paste', { cookie, body: { reply: 'REFUSE' } });
    check('a door refusal on paste → 400 with the door code', pasteRefused.status === 400 && pasteRefused.json.code === 'NO_MENU');
    const pasteEmpty = await req('POST', '/admin/api/inject/fake-pack/paste', { cookie, body: { reply: '   ' } });
    check('an empty paste → 400 EMPTY_PASTE', pasteEmpty.status === 400 && pasteEmpty.json.code === 'EMPTY_PASTE');

    // ── the size gate at the generic door: > 60K chars never reaches a pack ──
    const longReply = 'DOC CLEAN ' + 'x'.repeat(60000);
    const atCap = 'DOC CLEAN ' + 'x'.repeat(60000 - 'DOC CLEAN '.length);
    const pasteLong = await req('POST', '/admin/api/inject/fake-pack/paste', { cookie: editorCookie, body: { reply: longReply } });
    check('a paste over 60K chars → 400 REPLY_TOO_LONG with the Hebrew "paste only the document" line',
      pasteLong.status === 400 && pasteLong.json.ok === false && pasteLong.json.code === 'REPLY_TOO_LONG' &&
      pasteLong.json.error === 'התשובה ארוכה מדי (מעל 60K תווים) — הדביקו רק את המסמך');
    const pasteAtCap = await req('POST', '/admin/api/inject/fake-pack/paste', { cookie, body: { reply: atCap } });
    check('exactly 60,000 chars still passes the gate (the pack sees it)', atCap.length === 60000 && pasteAtCap.status === 200 && pasteAtCap.json.ok === true && pasteAtCap.json.chars === 60000);
    const applyLong = await req('POST', '/admin/api/inject/fake-pack/apply', { cookie, body: { reply: longReply, force: true } });
    check('apply over 60K chars → 400 REPLY_TOO_LONG, and the pack\'s apply never ran',
      applyLong.status === 400 && applyLong.json.code === 'REPLY_TOO_LONG' && applied === 0);

    // theme-designer paste: the same door as the studio's design/paste
    const themeDoc = '```html\n<bent-theme name="לילה">\n  <bent-colors primary="#123456" bg="#ffffff" text="#111111" />\n</bent-theme>\n```';
    const themePaste = await req('POST', '/admin/api/inject/theme-designer/paste', { cookie, body: { reply: themeDoc } });
    const studioDoor = require('../src/theme').extractThemeReply(themeDoc, 'ai');
    check('theme-designer paste → sections + previewHtml (the home page rendered with the candidate)',
      themePaste.status === 200 && themePaste.json.preview.sections.includes('colors') && /#123456/.test(themePaste.json.preview.previewHtml) &&
      /<!DOCTYPE html>/i.test(themePaste.json.preview.previewHtml) && themePaste.json.preview.name === 'לילה');
    check('theme-designer warnings are the studio door\'s strings, wrapped {code:THEME}',
      JSON.stringify(themePaste.json.warningTexts) === JSON.stringify(studioDoor.warnings) &&
      themePaste.json.warnings.every((w) => w.code === 'THEME'));
    const libBefore = require('../src/theme-library').listThemes().length;
    check('theme-designer paste saved NOTHING to the library', require('../src/theme-library').listThemes().length === libBefore);

    // ── the gate: apply / run / undo need an ADMIN session ──
    for (const action of ['apply', 'run', 'undo']) {
      const noSession = await req('POST', '/admin/api/inject/fake-pack/' + action, { body: { reply: 'DOC CLEAN', brief: '' } });
      check(action + ' without a session → 401', noSession.status === 401);
      const editor = await req('POST', '/admin/api/inject/fake-pack/' + action, { cookie: editorCookie, body: { reply: 'DOC CLEAN', brief: '' } });
      check(action + ' as an editor → 403', editor.status === 403);
    }

    // ── run: clean first reply → one round ──
    const menusBefore = JSON.stringify(require('../src/menus').loadMenus());
    calls.length = 0; scripted = ['DOC CLEAN'];
    const run1 = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: 'סדר', size: 'lite' } });
    check('run → ok with reply/rounds/repaired/preview/warnings/timing/usage/provider',
      run1.status === 200 && run1.json.ok && run1.json.reply === 'DOC CLEAN' && run1.json.rounds === 1 && run1.json.repaired === false &&
      run1.json.preview.fitLine === 'שורה אחת ✓' && Array.isArray(run1.json.warnings) && typeof run1.json.timing.ms === 'number' &&
      run1.json.usage.prompt_tokens === 100 && run1.json.usage.completion_tokens === 20 && run1.json.usage.reasoning_tokens === 3 &&
      run1.json.provider.id === '__fake' && run1.json.provider.model === 'fake-model');
    check('the model saw max_tokens === 2048 (the pack\'s), not the provider default',
      calls.length === 1 && calls[0].max_tokens === 2048);
    check('the model saw NO tools key (generate never attaches tools)', !('tools' in calls[0]));
    check('the pack text is the user turn, system is empty',
      calls[0].messages[0].role === 'system' && calls[0].messages[0].content === '' &&
      calls[0].messages[calls[0].messages.length - 1].role === 'user' && /PROMPT lite סדר/.test(calls[0].messages[calls[0].messages.length - 1].content));

    // ── run: a model silent past the server's idle cap still gets its reply through ──
    calls.length = 0;
    scripted = [() => new Promise((resolve) => setTimeout(() => resolve(okReply('DOC CLEAN')), 2500))];
    const slow = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } }).catch((e) => ({ status: 0, json: { error: e.code } }));
    check('a reply that arrives after the socket idle cap (1.5 s here, 30 s live) still reaches the client — the run lifts the cap for its socket',
      slow.status === 200 && slow.json.ok && slow.json.reply === 'DOC CLEAN');

    // ── v2.44: the SAME cap, the copilot's chat route. It never lifted it: on a
    //    server-side courier any turn the model took more than 30 s over lost
    //    its connection (the copilot battery, Gemma 4 31B — a page takes 27–35 s
    //    to write, so the same scenario passed and failed on the same day). ──
    calls.length = 0;
    scripted = [() => new Promise((resolve) => setTimeout(() => resolve(okReply('שלום! איך אפשר לעזור?')), 2500))];
    const slowChat = await req('POST', '/admin/api/ai/chat', { cookie, body: { message: 'שלום', history: [] } }).catch((e) => ({ status: 0, json: { error: e.code || e.message } }));
    check('a copilot turn whose model is silent past the idle cap still reaches the owner — /admin/api/ai/chat lifts the cap for its socket',
      slowChat.status === 200 && slowChat.json && slowChat.json.ok === true && slowChat.json.reply === 'שלום! איך אפשר לעזור?');
    check('…and the cap it lifts to covers the whole turn: every call the loop can make at the provider\'s own ceiling',
      ai.turnCeilingMs() >= 6 * ai.PUBLIC_TIMEOUT_MS && ai.turnCeilingMs() < 24 * 60 * 60 * 1000);

    // ── run: repairable warning → ONE repair round, the repaired reply wins ──
    calls.length = 0; scripted = ['DOC FIXME', 'DOC CLEAN'];
    const run2 = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '', size: 'lite' } });
    check('a repairable warning triggers exactly one repair round → rounds:2 repaired:true, the clean reply',
      run2.status === 200 && run2.json.rounds === 2 && run2.json.repaired === true && run2.json.reply === 'DOC CLEAN' && run2.json.warnings.length === 0 && calls.length === 2);
    const second = calls[1] || { messages: [] };
    const roles = second.messages.map((m) => m.role);
    check('the second call carries the first user turn + the assistant turn + the fix request',
      JSON.stringify(roles) === JSON.stringify(['system', 'user', 'assistant', 'user']) &&
      /PROMPT lite/.test(second.messages[1].content) && second.messages[2].content === 'DOC FIXME');
    const fixTurn = second.messages[3] ? second.messages[3].content : '';
    check('the fix request is "תיקונים נדרשים:" + one line per warning + the return-the-document line',
      /^תיקונים נדרשים:\n- דף לא קיים: nope/.test(fixTurn) && /\nהחזירו את המסמך המלא, מתוקן\.$/.test(fixTurn));
    check('usage is summed over both rounds', run2.json.usage.prompt_tokens === 200 && run2.json.usage.completion_tokens === 40);

    // ── run: the repair made it worse → keep the first ──
    calls.length = 0; scripted = ['DOC FIXME', 'REFUSE'];
    const run3 = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    check('a repair that refuses loses to the first reply (rounds:2, repaired:false, the hard warning kept)',
      run3.status === 200 && run3.json.rounds === 2 && run3.json.repaired === false && run3.json.reply === 'DOC FIXME' && run3.json.hard === true);

    // ── run: a refusal is repaired ──
    calls.length = 0; scripted = ['REFUSE', 'DOC CLEAN'];
    const run4 = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    check('a door refusal on the first reply is repaired (rounds:2, repaired:true)',
      run4.status === 200 && run4.json.rounds === 2 && run4.json.repaired === true && run4.json.reply === 'DOC CLEAN');
    check('the refusal\'s message is what the model is asked to fix', /^תיקונים נדרשים:\n- אין תפריט בתשובה/.test(calls[1].messages[3].content));

    // ── run: two refusals → 400 with the door code AND the reply text ──
    calls.length = 0; scripted = ['REFUSE one', 'REFUSE two'];
    const run5 = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    check('a second refusal → 400 with the door code and the reply so the owner can edit it',
      run5.status === 400 && run5.json.ok === false && run5.json.code === 'NO_MENU' && run5.json.reply === 'REFUSE two' && run5.json.rounds === 2);

    // ── run: a runaway model reply (> 60K) is gated like a refusal — one
    //    repair round asks for the document alone, a second runaway → 400 ──
    calls.length = 0; scripted = [longReply, longReply];
    const runLong = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    check('a model reply over 60K chars → 400 REPLY_TOO_LONG after the one repair round (rounds:2), the pack\'s parse never called on it',
      runLong.status === 400 && runLong.json.code === 'REPLY_TOO_LONG' && runLong.json.rounds === 2 && calls.length === 2);
    check('the repair turn names the size problem, and the runaway history turn is capped (never re-fed whole)',
      /^תיקונים נדרשים:\n- התשובה ארוכה מדי/.test(calls[1].messages[3].content) && calls[1].messages[2].content.length <= 40000);

    // ── run never applies ──
    check('run never writes: the pack\'s apply was never called and the menus table is unchanged',
      applied === 0 && JSON.stringify(require('../src/menus').loadMenus()) === menusBefore);

    // ── PACK_TOO_BIG ──
    const realBudget = ai.contextBudget;
    ai.contextBudget = () => 100;
    calls.length = 0; scripted = ['DOC CLEAN'];
    const tooBig = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '', size: 'full' } });
    ai.contextBudget = realBudget;
    check('a pack over the context budget → 400 PACK_TOO_BIG with suggestSize:lite, and the model is never called',
      tooBig.status === 400 && tooBig.json.code === 'PACK_TOO_BIG' && tooBig.json.suggestSize === 'lite' && calls.length === 0);
    check('contextBudget: local = 20000, cloud = unbounded; estimateTokens = ceil(chars/2.3)',
      ai.contextBudget('local') === 20000 && ai.contextBudget('claude') === Infinity &&
      ai.estimateTokens(3651) === Math.ceil(3651 / 2.3) && ai.estimateTokens(3651) === 1588 && ai.estimateTokens(0) === 0);

    // ── THE BROWSER RELAY (v2.29): a hosted site driving the owner's own
    //    model. The server composes, the PAGE carries, the server judges.
    ai.saveSettings({ provider: 'browser', model: 'tapuz-gemma' });
    calls.length = 0;
    // the raw provider JSON the bridge hands back, exactly as LM Studio
    // shapes it (openai-chat) — the page never rewrites it
    const relayed = (text) => ({
      choices: [{ index: 0, message: { role: 'assistant', content: text } }],
      usage: { prompt_tokens: 1200, completion_tokens: 300 }
    });
    const runStep = (step) => req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { step } });

    const relay = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    const mc = relay.json.modelCall || {};
    check('the browser provider answers with a modelCall instead of calling out',
      relay.status === 200 && relay.json.ok === true && relay.json.relay === true &&
      relay.json.stage === 'first' && typeof mc.id === 'string' && /^run_/.test(mc.id) && calls.length === 0);
    check('the relayed body is the request the server would have sent (model, max_tokens, no tools, reasoning off)',
      mc.body && mc.body.model === 'tapuz-gemma' && mc.body.max_tokens === 2048 && !('tools' in mc.body) &&
      mc.body.reasoning_effort === 'none' && Array.isArray(mc.body.messages) && mc.body.messages.length === 2 &&
      mc.body.messages[0].role === 'system' && mc.body.messages[1].role === 'user' &&
      /FRESH/.test(mc.body.messages[1].content) && /^PROMPT lite/m.test(mc.body.messages[1].content));
    check('the page is told which provider and how long one turn may take',
      relay.json.provider && relay.json.provider.id === 'browser' && relay.json.timeoutMs > 0 && relay.json.packId === 'fake-pack');

    const relayDone = await runStep({ id: mc.id, result: relayed('DOC CLEAN') });
    check('the step finishes the run with the same shape a server-side run returns',
      relayDone.status === 200 && relayDone.json.ok === true && relayDone.json.reply === 'DOC CLEAN' &&
      relayDone.json.rounds === 1 && relayDone.json.repaired === false && !!relayDone.json.preview &&
      relayDone.json.provider.id === 'browser' && relayDone.json.usage.prompt_tokens === 1200 && calls.length === 0);
    check('a step id is single-use — replaying it is refused (400 RELAY_EXPIRED)',
      await runStep({ id: mc.id, result: relayed('DOC CLEAN') }).then((r) => r.status === 400 && r.json.code === 'RELAY_EXPIRED'));
    check('an unknown / forged step id is refused the same way',
      await runStep({ id: 'run_deadbeef', result: relayed('DOC CLEAN') }).then((r) => r.status === 400 && r.json.code === 'RELAY_EXPIRED'));

    // the repair round rides the SAME protocol: a second modelCall, carrying
    // the first exchange as history plus the door's fixes
    const relay2 = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    const repair = await runStep({ id: relay2.json.modelCall.id, result: relayed('DOC FIXME') });
    const rc = repair.json.modelCall || {};
    const msgs = (rc.body && rc.body.messages) || [];
    check('a repairable warning asks the page for a SECOND turn (stage repair)',
      repair.status === 200 && repair.json.ok === true && repair.json.relay === true &&
      repair.json.stage === 'repair' && repair.json.rounds === 2 && typeof rc.id === 'string' && rc.id !== relay2.json.modelCall.id);
    check('the repair turn carries the first exchange as history + "תיקונים נדרשים" with the door\'s message',
      msgs.length === 4 && msgs[1].role === 'user' && msgs[2].role === 'assistant' && msgs[2].content === 'DOC FIXME' &&
      msgs[3].role === 'user' && /תיקונים נדרשים/.test(msgs[3].content) && /nope/.test(msgs[3].content));
    const repaired = await runStep({ id: rc.id, result: relayed('DOC CLEAN') });
    check('the repaired reply wins: rounds 2, repaired true, no warning left',
      repaired.status === 200 && repaired.json.ok === true && repaired.json.reply === 'DOC CLEAN' &&
      repaired.json.rounds === 2 && repaired.json.repaired === true && (repaired.json.warnings || []).length === 0);
    check('usage is summed across BOTH relayed turns',
      repaired.json.usage.prompt_tokens === 2400 && repaired.json.usage.completion_tokens === 600);

    // the model's own failures arrive in the body the page carries
    const relay3 = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    const errStep = await runStep({ id: relay3.json.modelCall.id, result: { error: { message: 'model not loaded' } } });
    check('an error body from the local runtime → 502 PROVIDER_ERROR (not a pretend reply)',
      errStep.status === 502 && errStep.json.code === 'PROVIDER_ERROR' && /model not loaded/.test(errStep.json.error));
    const relay4 = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    const emptyStep = await runStep({ id: relay4.json.modelCall.id, result: relayed('') });
    check('an empty relayed reply → 502 EMPTY_REPLY', emptyStep.status === 502 && emptyStep.json.code === 'EMPTY_REPLY');
    const relay5 = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    const noSessionStep = await req('POST', '/admin/api/inject/fake-pack/run', { body: { step: { id: relay5.json.modelCall.id, result: relayed('DOC CLEAN') } } });
    check('a relay step is admin-gated like every other run (401 without a session)', noSessionStep.status === 401);
    check('the relay never called the server-side provider even once', calls.length === 0);

    // ── NO_PROVIDER ──
    ai.saveSettings({ provider: 'claude', apiKey: '' });
    const noKey = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    check('a public provider without a key → 400 NO_PROVIDER', noKey.status === 400 && noKey.json.code === 'NO_PROVIDER' && /מפתח/.test(noKey.json.error));
    ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1', model: 'fake-model' });

    // ── TIMEOUT ──
    scripted = [() => { const e = new Error('המודל לא ענה תוך 4 דקות'); e.code = 'TIMEOUT'; throw e; }];
    const timeout = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    check('a provider ceiling → 504 TIMEOUT', timeout.status === 504 && timeout.json.code === 'TIMEOUT');

    // ── EMPTY_REPLY ──
    scripted = [''];
    const empty = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    check('an empty content field → 502 EMPTY_REPLY', empty.status === 502 && empty.json.code === 'EMPTY_REPLY');

    // ── PROVIDER_ERROR ──
    scripted = [() => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) })];
    const perr = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    check('a non-2xx from the provider → 502 PROVIDER_ERROR carrying the provider\'s message',
      perr.status === 502 && perr.json.code === 'PROVIDER_ERROR' && /rate limited/.test(perr.json.error));

    // ── NETWORK ──
    scripted = [() => { throw new Error('ECONNREFUSED'); }];
    const net = await req('POST', '/admin/api/inject/fake-pack/run', { cookie, body: { brief: '' } });
    check('a wire failure → 502 NETWORK', net.status === 502 && net.json.code === 'NETWORK');

    // ── a stub cannot run ──
    const stubRun = await req('POST', '/admin/api/inject/site-builder/run', { cookie, body: { brief: '' } });
    check('a run-disabled pack → 400 RUN_DISABLED', stubRun.status === 400 && stubRun.json.code === 'RUN_DISABLED');

    // ── apply: hard warnings → 409; force → applied; undo ──
    const hard = await req('POST', '/admin/api/inject/fake-pack/apply', { cookie, body: { reply: 'DOC FIXME' } });
    check('apply with hard warnings → 409 HARD_WARNINGS + warnings + warningTexts',
      hard.status === 409 && hard.json.code === 'HARD_WARNINGS' && hard.json.warnings[0].code === 'UNKNOWN_PAGE' && hard.json.warningTexts.length === 1 && applied === 0);
    const forced = await req('POST', '/admin/api/inject/fake-pack/apply', { cookie, body: { reply: 'DOC FIXME', force: true } });
    check('apply with force:true → applied + landed + backupId + changed',
      forced.status === 200 && forced.json.applied === true && forced.json.landed.url === '/admin/menus' && forced.json.backupId === 'b-1' && forced.json.changed.menus[0] === 'main' && applied === 1);
    const clean = await req('POST', '/admin/api/inject/fake-pack/apply', { cookie, body: { reply: 'DOC CLEAN' } });
    check('a clean apply → 200 with rebuildError "" and warnings []', clean.status === 200 && clean.json.rebuildError === '' && clean.json.warnings.length === 0 && applied === 2);
    const applyRefused = await req('POST', '/admin/api/inject/fake-pack/apply', { cookie, body: { reply: 'REFUSE' } });
    check('apply re-parses: a refused reply → 400 with the door code', applyRefused.status === 400 && applyRefused.json.code === 'NO_MENU');
    const undo1 = await req('POST', '/admin/api/inject/fake-pack/undo', { cookie });
    check('undo → {ok, restored}', undo1.status === 200 && undo1.json.ok && undo1.json.restored === 'b-2');
    await req('POST', '/admin/api/inject/fake-pack/undo', { cookie });
    const undoNone = await req('POST', '/admin/api/inject/fake-pack/undo', { cookie });
    check('undo with nothing left → 400 NO_BACKUP', undoNone.status === 400 && undoNone.json.code === 'NO_BACKUP');

    // ── theme-designer: apply lands in the library, and undo survives a restart ──
    // the "last applied" id is kept in config/inject-theme-last.json (next to
    // the ledger), not in module memory: a re-required descriptor — the
    // stand-in for a restarted server — still takes exactly that entry off
    const libModule = require('../src/theme-library');
    const LAST_PATH = path.join(ROOT, 'config', 'inject-theme-last.json');
    const libBefore2 = libModule.listThemes().length;
    const designerApply = await req('POST', '/admin/api/inject/theme-designer/apply', { cookie, body: { reply: themeDoc } });
    const landedId = designerApply.json && designerApply.json.landed ? designerApply.json.landed.id : null;
    check('theme-designer apply → landed {type:theme-library, id} and the shelf grew by one',
      designerApply.status === 200 && designerApply.json.applied === true && designerApply.json.landed.type === 'theme-library' && !!landedId &&
      libModule.listThemes().length === libBefore2 + 1 && libModule.listThemes().some((t) => t.id === landedId));
    let lastFile = null;
    try { lastFile = JSON.parse(fs.readFileSync(LAST_PATH, 'utf8')); } catch (e) { lastFile = null; }
    check('the last-applied id is persisted to config/inject-theme-last.json as {id, at}',
      !!lastFile && lastFile.id === landedId && typeof lastFile.at === 'string' && !Number.isNaN(Date.parse(lastFile.at)));
    const designerKey = require.resolve('../src/injections/theme-designer');
    delete require.cache[designerKey];
    const freshDesigner = require(designerKey);
    check('a re-required descriptor is a fresh instance (no module memory to lean on)', freshDesigner !== registry.get('theme-designer'));
    let freshUndo = null;
    try { freshUndo = freshDesigner.undo(); } catch (e) { freshUndo = { error: e.code }; }
    check('undo from the fresh instance still finds the id (read from the file) and removes exactly that entry',
      !!freshUndo && freshUndo.restored === landedId && libModule.listThemes().length === libBefore2 && !libModule.listThemes().some((t) => t.id === landedId));
    check('the file is deleted after the undo', !fs.existsSync(LAST_PATH));
    // the studio's paste door saves with source 'ai' too — a hand-pasted
    // theme on the shelf must never be what undo takes off
    const handPasted = libModule.saveAiTheme('הודבק ביד', { colors: { primary: '#abcdef' } });
    const designerUndoNone = await req('POST', '/admin/api/inject/theme-designer/undo', { cookie });
    check('a second undo (through the route) → 400 NO_BACKUP — no fallback to "the newest source:ai entry"',
      designerUndoNone.status === 400 && designerUndoNone.json.code === 'NO_BACKUP' && libModule.listThemes().some((t) => t.id === handPasted.id));

    // ── the ledger ──
    const lines = logLines();
    const entries = lines.map((l) => JSON.parse(l));
    const runs = entries.filter((e) => e.action === 'run');
    const pastes = entries.filter((e) => e.action === 'paste');
    const applies = entries.filter((e) => e.action === 'apply');
    const undos = entries.filter((e) => e.action === 'undo');
    // 15 runs (5 outcomes + the slow one + REPLY_TOO_LONG + PACK_TOO_BIG,
    // BROWSER_RELAY, NO_PROVIDER, TIMEOUT, EMPTY_REPLY, PROVIDER_ERROR,
    // NETWORK, RUN_DISABLED), 6 pastes (4 + the two size-gate probes),
    // 6 applies (4 + the size-gate refusal + the theme-designer apply),
    // 4 undos (3 + the theme-designer NO_BACKUP; the fresh instance's direct
    // undo() bypasses the route, so no line) — the 401/403 attempts never
    // reach a handler, so no line
    check('the ledger has one line per action (' + runs.length + ' run, ' + pastes.length + ' paste, ' + applies.length + ' apply, ' + undos.length + ' undo)',
      runs.length === 24 && pastes.length === 6 && applies.length === 6 && undos.length === 4);
    check('every line carries ts/id/action/ok, runs carry provider/model/rounds/usage/promptChars',
      entries.every((e) => e.ts && e.id && e.action && typeof e.ok === 'boolean') &&
      runs.filter((e) => e.ok && e.provider !== 'browser').every((e) => e.provider === '__fake' && e.model === 'fake-model' && e.rounds >= 1 && e.usage && e.promptChars > 0) &&
      runs.filter((e) => e.provider === 'browser').every((e) => e.model === 'tapuz-gemma' && e.rounds >= 1 && e.usage && e.promptChars > 0));
    check('the ledger records the outcome codes (PACK_TOO_BIG, RELAY_CALL, TIMEOUT, HARD_WARNINGS…)',
      ['PACK_TOO_BIG', 'REPLY_TOO_LONG', 'RELAY_CALL', 'RELAY_REPAIR', 'NO_PROVIDER', 'TIMEOUT', 'EMPTY_REPLY', 'PROVIDER_ERROR', 'NETWORK', 'HARD_WARNINGS', 'NO_MENU'].every((c) => entries.some((e) => e.code === c)));
    check('the ledger NEVER holds the reply text or the prompt', !lines.some((l) => /DOC CLEAN|DOC FIXME|REFUSE|PROMPT lite/.test(l)));
    check('the ledger lives under TAPUZ_ROOT/config', LOG_PATH.startsWith(ROOT) && /config[\\/]inject-log\.jsonl$/.test(LOG_PATH));
    const repairedLine = runs.find((e) => e.ok && e.rounds === 2 && e.repaired === true);
    check('a repaired run is logged as rounds:2 repaired:true with the surviving warning codes', !!repairedLine && Array.isArray(repairedLine.warningCodes));

    // ── /admin/inject: the packs grid mounts a card per visible pack ──
    const page = await req('GET', '/admin/inject', { cookie, accept: 'text/html' });
    check('GET /admin/inject still renders the site-builder pack UI (untouched)', page.status === 200 && /id="btn-roleplay"/.test(page.text) && /\/admin-inject\.js/.test(page.text));
    check('…and now the packs grid with a card slot per visible pack + the card script',
      /class="inj-packs-grid"/.test(page.text) && /data-inject="menu-organizer"/.test(page.text) && /data-inject="theme-designer"/.test(page.text) &&
      /<script src="\/admin-inject-card\.js[?"]/.test(page.text) && /TapuzInjectCard\.mount\(/.test(page.text));
    check('the stubs get no card slot', !/data-inject="theme-effects"/.test(page.text) && !/data-inject="site-builder"/.test(page.text));
    const cardSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-inject-card.js'), 'utf8');
    try { new Function('window', 'document', cardSrc); check('admin-inject-card.js parses', true); }
    catch (e) { check('admin-inject-card.js parses (' + e.message + ')', false); }
    check('the card never builds HTML from model text (no innerHTML/insertAdjacentHTML), and uses logical CSS only',
      !/\.innerHTML\s*=|insertAdjacentHTML/.test(cardSrc) && !/\b(left|right)\s*:/.test(cardSrc));
    check('the card talks only to the inject + ai-settings endpoints, gates run on the AI settings, and keeps apply behind a same-text preview',
      /\/admin\/api\/inject/.test(cardSrc) && /\/admin\/api\/ai\/settings/.test(cardSrc) && !/https?:\/\//.test(cardSrc) &&
      /reply\.value === state\.lastPreviewed/.test(cardSrc) && /provider === 'local'/.test(cardSrc) && /confirm\('יש אזהרות קשות/.test(cardSrc) &&
      /lite\.checked = true/.test(cardSrc) && /\/admin\/ai-setup/.test(cardSrc));

    // ── the generic server-side preview renderer ──
    const html = registry.genericPreviewHtml(FAKE.parse('DOC CLEAN').preview);
    check('genericPreviewHtml draws the nested list with ✓ and the fit line, escaped',
      /✓/.test(html) && /שורה אחת ✓/.test(html) && /הבית/.test(html) && !/<script/.test(html));
    check('genericPreviewHtml escapes model text', /&lt;b&gt;/.test(registry.genericPreviewHtml({ note: '<b>x</b>' })));
  } catch (e) {
    console.error(e);
    fail = true;
  } finally {
    server.close();
  }

  console.log('');
  console.log(fail ? 'SMOKE INJECT-ROUTE: FAIL' : 'SMOKE INJECT-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})();
