'use strict';

/**
 * v2.42 QA — NO_BRIEFING is airtight on every path a request takes to a
 * LOCAL model. No model, no server: a recording fetch stands in for LM
 * Studio, and the one thing every check asks is whether a request without a
 * BenTML briefing ever reaches it.
 *
 * HARD-BATTERY-v2, C1 (2026-09-17, Gemma 4 31B): a chat/completions call
 * with NO system briefing answered in an invented ```bentml dialect — a fake
 * <document>, zero bent-* tags. No model knows BenTML on its own; the
 * briefing IS the product. v2.35 refused such a request in the tool loop
 * alone. This smoke pins the same rule on every seam a local request
 * crosses (src/ai.js assertBriefed):
 *
 *   • generateDetailed — the injection runner's server-side call
 *   • relayRequest     — the body handed to the page for the Bridge
 *   • converse         — the copilot's tool loop, both couriers, and STRICTER:
 *                        the SYSTEM text must brief (an owner typing <bent-hero>
 *                        into the chat is not a briefing)
 *   • callProvider     — the wire-level gate under the tool loop
 *   • the worker queue — inject-jobs.createJob refuses at the queue, and the
 *                        real scripts/tapuz-worker.js refuses a job it is
 *                        handed without a briefing, before touching the model
 *
 * …and the exception, declared once: the visitor's customer-service chat
 * (src/crm/cs.js) answers in words for a visitor, never a BenTML document —
 * it passes `prose: true`, and this file pins that the flag appears nowhere
 * else in src/. The real packs and the real copilot briefing are run through
 * the gate too, so a product prompt can never be the one it refuses.
 *
 * What this does NOT claim: a naked call to LM Studio's OpenAI-compatible
 * API from outside the CMS. C1's raw-API case stays FAIL_INVENT by nature —
 * only the CMS/Bridge paths are the product, and those always brief or
 * refuse (docs/LOCAL-LLM.md, "NO_BRIEFING — the scope").
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-no-briefing-'));

const ai = require('../src/ai');
const providers = require('../src/providers');
const jobs = require('../src/inject-jobs');
const { buildCopilotBriefing } = require('../src/pzn/agent-roleplay');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };
const rejects = async (fn) => {
  try { await fn(); return null; } catch (e) { return e; }
};
const REPO = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

// ── the recording model: every body that reaches "LM Studio" is kept ──
const reached = [];
global.fetch = async (url, init) => {
  reached.push({ url: String(url), body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'תשובה' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }) };
};
const reachedSince = (n) => reached.length - n;

const PACK = '# חבילה\nכתבו את התפריט בדיאלקט <bent-menus> … <bent-menu-layout>';
const PLAIN = 'שלום, כתוב לי דף בית יפה';

(async () => {
  // ── the vocabulary, and the two copies of the rule ──
  check('NO_BRIEFING is in the error vocabulary (append-only list)', ai.ERROR_CODES.includes('NO_BRIEFING'));
  check('hasBriefing recognises the dialect in any tier: a <bent- tag, or the bent-* family name — and nothing else',
    ai.hasBriefing('<bent-hero>') && ai.hasBriefing('use bent-* tags') && !ai.hasBriefing(PLAIN) && !ai.hasBriefing('') && !ai.hasBriefing('bentml <document>'));
  const workerSrc = read('scripts/tapuz-worker.js');
  const workerMark = (workerSrc.match(/const BRIEFING_MARK = (\/[^\n]+\/);/) || [])[1];
  check('the worker script repeats the mark byte for byte (it requires nothing from the repo)', workerMark === ai.BRIEFING_MARK.toString());

  // ── generateDetailed: the injection runner's server-side call ──
  ai.saveSettings({ provider: 'local', baseUrl: 'http://127.0.0.1:1/v1', model: 'tapuz-gemma', apiKey: '' });
  let n = reached.length;
  let e = await rejects(() => ai.generateDetailed({ system: '', user: PLAIN }));
  check('generateDetailed(local): system "" + a plain user text → NO_BRIEFING, and the model never saw it',
    !!e && e.code === 'NO_BRIEFING' && /BenTML/.test(e.message) && reachedSince(n) === 0);
  e = await rejects(() => ai.generateDetailed({ system: 'אתה עוזר', user: PLAIN, history: [{ role: 'user', content: 'היי' }, { role: 'assistant', content: 'שלום' }] }));
  check('generateDetailed(local): a system prompt without the dialect, plus history without it → NO_BRIEFING', !!e && e.code === 'NO_BRIEFING' && reachedSince(n) === 0);
  n = reached.length;
  const ok1 = await ai.generateDetailed({ system: '', user: PACK, timeoutMs: 5000 });
  check('generateDetailed(local): the pack in the USER turn is a briefing (how the runner sends it) → the call goes out', ok1.text === 'תשובה' && reachedSince(n) === 1);
  n = reached.length;
  const ok2 = await ai.generateDetailed({ system: '', user: 'תקנו: הקישור שגוי', history: [{ role: 'user', content: PACK }, { role: 'assistant', content: 'DOC' }], timeoutMs: 5000 });
  check('generateDetailed(local): the repair round — the pack rides in history — passes', ok2.text === 'תשובה' && reachedSince(n) === 1);
  n = reached.length;
  const ok3 = await ai.generateDetailed({ system: 'אתה נציג שירות', user: 'מה שעות הפתיחה?', prose: true, timeoutMs: 5000 });
  check('generateDetailed(local, prose: true): the visitor chat\'s declared exception passes without the dialect', ok3.text === 'תשובה' && reachedSince(n) === 1);
  check('…and the body that went out is exactly what buildRequest always composed (the gate reads, never rewrites)',
    reached[reached.length - 1].body.messages[0].role === 'system' && reached[reached.length - 1].body.messages[0].content === 'אתה נציג שירות' &&
    reached[reached.length - 1].body.reasoning_effort === 'none');
  check('generate() (the string wrapper) rejects the same way', (await rejects(() => ai.generate({ system: '', user: PLAIN }))).code === 'NO_BRIEFING');

  // a CLOUD key is not bound by this gate (a different failure, not the one that burns the owner's GPU)
  providers.PROVIDERS.__cloud = {
    id: '__cloud', label: 'cloud', endpoint: 'http://127.0.0.1:1/v1/chat/completions', method: 'POST',
    authScheme: 'bearer', authHeader: 'Authorization', extraHeaders: {}, defaultModel: 'c', models: [], openModel: true,
    keyOptional: true, maxTokens: 100, responsePath: ['choices', 0, 'message', 'content'], body: { style: 'openai-chat' }
  };
  ai.saveSettings({ provider: '__cloud' });
  n = reached.length;
  check('a cloud provider is not bound by the gate (local + bridge only)', (await ai.generateDetailed({ system: '', user: PLAIN, timeoutMs: 5000 })).text === 'תשובה' && reachedSince(n) === 1);

  // ── relayRequest: the body the page relays through the Bridge ──
  ai.saveSettings({ provider: 'browser', model: 'tapuz-gemma' });
  e = await rejects(() => Promise.resolve(ai.relayRequest({ system: '', user: PLAIN })));
  check('relayRequest(browser): no briefing → NO_BRIEFING, no body is handed to the page', !!e && e.code === 'NO_BRIEFING');
  const call = ai.relayRequest({ system: '', user: PACK });
  check('relayRequest(browser): the pack → the body goes to the page, dialect inside', !!call.body && /<bent-menus>/.test(JSON.stringify(call.body.messages)));
  check('relayRequest(browser, prose: true): the declared exception is honoured here too', !!ai.relayRequest({ system: 's', user: PLAIN, prose: true }).body);

  // ── converse: the tool loop, both couriers — and STRICTER ──
  e = await rejects(() => ai.converse({ system: 'no briefing here', user: PLAIN }));
  check('converse(browser): a system text without the dialect → NO_BRIEFING, no modelCall', !!e && e.code === 'NO_BRIEFING' && !e.modelCall);
  e = await rejects(() => ai.converse({ system: 'no briefing here', user: 'תן לי <bent-hero> יפה' }));
  check('converse(browser): the dialect in the USER text alone is not a briefing (the system must brief)', !!e && e.code === 'NO_BRIEFING');
  ai.saveSettings({ provider: 'local', baseUrl: 'http://127.0.0.1:1/v1' });
  n = reached.length;
  e = await rejects(() => ai.converse({ systemFor: () => 'עוזר כללי', user: PLAIN }));
  check('converse(local): a systemFor builder that brings no dialect → NO_BRIEFING before any fetch', !!e && e.code === 'NO_BRIEFING' && reachedSince(n) === 0);
  n = reached.length;
  const turn = await ai.converse({ system: 'תדריך: השתמש/י ב-<bent-heading> ו-bent-* בלבד', user: PLAIN });
  check('converse(local): a briefed system text → the request goes out and the reply comes back', turn.reply === 'תשובה' && reachedSince(n) === 1);

  // ── assertBriefed: the wire-level gate, both body shapes ──
  const local = providers.getProvider('local');
  const browser = providers.getProvider('browser');
  const claude = providers.getProvider('claude');
  const throwsFor = (p, body, opts) => { try { ai.assertBriefed(p, body, opts); return null; } catch (err) { return err.code; } };
  check('assertBriefed reads an openai-chat body (system rides as a message)',
    throwsFor(local, { messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'y' }] }) === 'NO_BRIEFING' &&
    throwsFor(local, { messages: [{ role: 'system', content: '<bent-hero>' }, { role: 'user', content: 'y' }] }) === null);
  check('assertBriefed reads an anthropic-messages body (system beside messages; content parts)',
    throwsFor(browser, { system: 'x', messages: [{ role: 'user', content: [{ type: 'text', text: 'y' }] }] }) === 'NO_BRIEFING' &&
    throwsFor(browser, { system: 'x', messages: [{ role: 'user', content: [{ type: 'text', text: 'see bent-*' }] }] }) === null);
  check('assertBriefed binds local and browser, never a cloud provider; prose is the only key',
    throwsFor(claude, { system: 'x', messages: [] }) === null && throwsFor(local, { messages: [] }, { prose: true }) === null &&
    throwsFor(local, { messages: [] }, { prose: 'yes' }) === 'NO_BRIEFING' && throwsFor(local, null) === 'NO_BRIEFING');

  // ── the real product prompts pass the gate (a briefing that fails its own gate would be the bug) ──
  for (const tier of ['full', 'compact']) {
    const b = buildCopilotBriefing({ locale: 'he', media: [], tier });
    check('the copilot briefing (' + tier + ', ' + b.chars + ' chars) carries the dialect', ai.hasBriefing(b.text));
  }
  {
    const registry = require('../src/injections');
    const { siteState } = require('../src/injections/site-state');
    const ctx = siteState();
    let ready = 0;
    for (const s of registry.list()) {
      const p = registry.get(s.id);
      if (!p.buildPrompt || !registry.isReady(p)) continue;
      for (const size of ['lite', 'full']) {
        const built = p.buildPrompt({ brief: 'בדיקה', size, locale: 'he', ctx });
        check('pack ' + p.id + ' (' + size + ', ' + built.chars + ' chars) carries its dialect', ai.hasBriefing(built.text));
        ready++;
      }
    }
    check('at least the organizer and the theme designer were judged', ready >= 4);
  }

  // ── the worker queue: refused at the queue, before a worker sees it ──
  const before = jobs.listJobs({ limit: 50 }).length;
  e = await rejects(() => Promise.resolve(jobs.createJob({ packId: 'x', prompt: PLAIN, maxTokens: 512 })));
  check('inject-jobs.createJob: a prompt without the dialect → NO_BRIEFING and nothing is queued',
    !!e && e.code === 'NO_BRIEFING' && jobs.listJobs({ limit: 50 }).length === before);
  const job = jobs.createJob({ packId: 'x', prompt: PACK, maxTokens: 512 });
  check('inject-jobs.createJob: a pack with its dialect is queued', !!job && job.status === 'pending');
  jobs.cancelJob(job.id);

  // ── the real worker script, handed a job without a briefing by an OLDER site ──
  // a fake site: ping → next (one bare job) → the worker's report is what we read
  {
    const posts = [];
    let served = false;
    const site = http.createServer((req, res) => {
      let buf = '';
      req.on('data', (c) => (buf += c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/agent/v1/inject/ping') return res.end(JSON.stringify({ ok: true, version: 'old', pending: 1 }));
        if (req.url === '/agent/v1/inject/next') {
          if (served) return res.end(JSON.stringify({ ok: true, job: null }));
          served = true;
          return res.end(JSON.stringify({ ok: true, job: { id: 'job_bare', packId: 'menu-organizer', round: 1, system: '', prompt: PLAIN, history: [], maxTokens: 512, model: '' } }));
        }
        if (/^\/agent\/v1\/inject\/job_bare$/.test(req.url) && req.method === 'POST') {
          posts.push(JSON.parse(buf));
          return res.end(JSON.stringify({ ok: true, done: true, status: 'failed' }));
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false }));
      });
    });
    const modelHits = [];
    const model = http.createServer((req, res) => { modelHits.push(req.url); res.statusCode = 500; res.end('{}'); });
    await new Promise((r) => site.listen(0, '127.0.0.1', r));
    await new Promise((r) => model.listen(0, '127.0.0.1', r));
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(REPO, 'scripts/tapuz-worker.js'), '--once'], {
        env: {
          ...process.env,
          TAPUZ_SITE: 'http://127.0.0.1:' + site.address().port,
          TAPUZ_TOKEN: 'tz_smoke_token_not_real',
          LOCAL_LLM_BASE: 'http://127.0.0.1:' + model.address().port + '/v1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let text = '';
      child.stdout.on('data', (d) => (text += d));
      child.stderr.on('data', (d) => (text += d));
      const killer = setTimeout(() => child.kill(), 20000);
      child.on('exit', (code) => { clearTimeout(killer); resolve({ code, text }); });
    });
    site.close();
    model.close();
    const report = posts[0];
    check('tapuz-worker --once: a job without a briefing is reported failed with NO_BRIEFING',
      !!report && report.error && report.error.code === 'NO_BRIEFING' && /BenTML/.test(report.error.message));
    check('tapuz-worker --once: the model was never called, and the exit code says the job failed', modelHits.length === 0 && out.code === 1);
  }

  // ── static pins: the exception is declared once, the gate sits on every seam ──
  const aiSrc = read('src/ai.js');
  check('assertBriefed guards generateDetailed, relayRequest, callProvider and the modelCall hand-off (4 call sites)',
    (aiSrc.match(/(?<!function )assertBriefed\(provider, /g) || []).length === 4);
  const proseUsers = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      // forward slashes on every OS: path.relative() answers `src\crm\cs.js`
      // on Windows, and the pin below is written the way the repo spells paths
      else if (/\.js$/.test(name) && /prose: true/.test(fs.readFileSync(full, 'utf8'))) proseUsers.push(path.relative(REPO, full).split(path.sep).join('/'));
    }
  })(path.join(REPO, 'src'));
  check('`prose: true` appears in exactly one place in src/ — the visitor chat (src/crm/cs.js)', JSON.stringify(proseUsers) === JSON.stringify(['src/crm/cs.js']));
  const doc = read('docs/LOCAL-LLM.md');
  check('LOCAL-LLM.md says what NO_BRIEFING covers and what it cannot (C1 raw API vs the product path)',
    /NO_BRIEFING/.test(doc) && /FAIL_INVENT/.test(doc) && /C1/.test(doc) && /prose/.test(doc));

  console.log('');
  console.log(fail ? 'SMOKE NO-BRIEFING: FAIL' : 'SMOKE NO-BRIEFING: PASS');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.log('FAIL threw: ' + (err && err.stack || err));
  console.log('');
  console.log('SMOKE NO-BRIEFING: FAIL');
  process.exit(1);
});
