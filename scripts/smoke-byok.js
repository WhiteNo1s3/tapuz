'use strict';

/**
 * v0.85 QA — the tier-1 AI lives in the CMS (Ben's tier realignment).
 * The v0.73 extension key path is retired (smoke-extension asserts that side);
 * here we prove the SERVER side: request shaping per provider, the host
 * allowlist boundary, and that the key store never leaks the key.
 * Runs on a throwaway site via TAPUZ_ROOT.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-ai-'));

const ai = require('../src/ai');
const { getProvider, listProviders } = require('../src/providers');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

// ── provider constants (unchanged authority) ──
const table = listProviders();
check('provider table is non-empty', table.length >= 1);
// browser-relay providers (Bridge V2) are the deliberate exception: the
// server NEVER fetches for them, so an empty endpoint is their safety
// property, and defaultModel '' means "the bridge substitutes what's loaded".
check('every fetching provider has endpoint + method + defaultModel + authHeader',
  table.filter((p) => !p.browserRelay)
    .every((p) => p.endpoint && p.method && p.defaultModel && p.authHeader && Array.isArray(p.models)));
check('a browser-relay provider has NO endpoint — the server must never fetch for it',
  table.filter((p) => p.browserRelay).every((p) => p.endpoint === '' && p.keyOptional === true));
check('table carries NO secret field', table.every((p) => p.apiKey === undefined && p.key === undefined && p.secret === undefined));
check('claude endpoint is the anthropic messages API', getProvider('claude').endpoint === 'https://api.anthropic.com/v1/messages');

// ── request shaping (ported from extension/llm.js, now server-owned) ──
const claude = getProvider('claude');
const a = ai.buildRequest(claude, 'sk-ant-TEST', 'SYSTEM', 'בנה דף', 'claude-sonnet-5');
check('anthropic: key rides the x-api-key header', a.headers['x-api-key'] === 'sk-ant-TEST');
check('anthropic: system is a TOP-LEVEL field', a.body.system === 'SYSTEM' && !JSON.stringify(a.body.messages).includes('SYSTEM'));
check('anthropic: version header present', !!a.headers['anthropic-version']);

const openai = getProvider('openai');
const o = ai.buildRequest(openai, 'sk-TEST', 'SYSTEM', 'בנה דף', 'gpt-4o');
check('openai: key rides as Bearer', o.headers.Authorization === 'Bearer sk-TEST');
check('openai: system is the first chat message', o.body.messages[0].role === 'system' && o.body.messages[0].content === 'SYSTEM');

// history threads through, capped
const hist = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'turn' + i }));
const withHist = ai.buildRequest(claude, 'k', 'S', 'now', 'claude-sonnet-5', hist);
check('history capped (≤12 turns) + the new message last',
  withHist.body.messages.length <= 13 && withHist.body.messages[withHist.body.messages.length - 1].content === 'now');

// ── the host allowlist boundary (the v0.73 security fix, kept server-side) ──
check('allowlist admits only the known provider hosts',
  ai.endpointAllowed('https://api.anthropic.com/v1/messages') &&
  ai.endpointAllowed('https://api.openai.com/v1/chat/completions') &&
  ai.endpointAllowed('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions') &&
  !ai.endpointAllowed('https://generativelanguage.googleapis.com.evil.example/v1beta/openai/chat/completions') &&
  !ai.endpointAllowed('https://evil.example.com/v1/messages') &&
  !ai.endpointAllowed('http://api.anthropic.com/v1/messages'));

// ── the key store: gitignored file, never echoed ──
const s1 = ai.saveSettings({ provider: 'claude', model: 'claude-sonnet-5', apiKey: 'sk-ant-SECRET-1234' });
check('settings echo hasKey + tail, NEVER the key',
  s1.hasKey === true && s1.keyTail === '1234' && JSON.stringify(s1).indexOf('SECRET') === -1);
check('key persisted under TAPUZ_ROOT config/ai.json',
  ai.STORE_PATH.startsWith(process.env.TAPUZ_ROOT) && fs.existsSync(ai.STORE_PATH));
const s2 = ai.saveSettings({ model: 'claude-opus-4-8' }); // apiKey undefined = keep
check('omitting apiKey keeps the stored key', s2.hasKey === true && s2.keyTail === '1234');
const s3 = ai.saveSettings({ apiKey: '' });
check('empty apiKey clears the key', s3.hasKey === false && s3.keyTail === '');
let badProvider = false;
try { ai.saveSettings({ provider: 'evilcorp' }); } catch (e) { badProvider = true; }
check('unknown provider rejected', badProvider);

// ── v2.28: generateDetailed — the accounted call the injection runner uses ──
check('estimateTokens = ceil(chars / 2.3) (Hebrew tokenizes ~2.3 chars/token)',
  ai.estimateTokens(3651) === Math.ceil(3651 / 2.3) && ai.estimateTokens(3651) === 1588 && ai.estimateTokens(0) === 0);
check('contextBudget: local = 20000 (24K window minus headroom), public = unbounded',
  ai.contextBudget('local') === 20000 && ai.contextBudget('claude') === Infinity && ai.contextBudget('openai') === Infinity);
check('the local provider declares its advisory context window',
  getProvider('local').contextTokens === 24000);
// v2.32 appended the window's four codes; the list is append-only so a
// runner that switches on the first six keeps working
check('the error vocabulary is exported (append-only: v2.28 six + v2.32 window four + v2.35 NO_BRIEFING + v2.44 WINDOW_SHARED + v2.50 THOUGHT_OUT)',
  JSON.stringify(ai.ERROR_CODES) === JSON.stringify([
    'NO_PROVIDER', 'BROWSER_RELAY', 'NETWORK', 'TIMEOUT', 'PROVIDER_ERROR', 'EMPTY_REPLY',
    'WINDOW_TOO_SMALL', 'BRIDGE_TOO_OLD', 'BRIDGE_DROPPED_TOOLS', 'REPLY_CUT', 'NO_BRIEFING', 'WINDOW_SHARED',
    'THOUGHT_OUT'
  ]));

// a scripted provider through the global.fetch seam (the copilot-tools pattern)
const providers = require('../src/providers');

// the budget is DERIVED from the local provider's advisory window, never a
// second literal: contextTokens − 4K headroom (24000 → 20000); a runtime
// loaded with a wider window widens the PACK_TOO_BIG gate with it
{
  const local = providers.PROVIDERS.local;
  const savedWindow = local.contextTokens;
  local.contextTokens = 32000;
  check('contextBudget(local) derives from contextTokens minus the 4K headroom (a stubbed 32000 window → 28000)',
    ai.contextBudget('local') === 28000);
  local.contextTokens = savedWindow;
  check('…and reads 20000 again once the window is back to 24000', ai.contextBudget('local') === 20000);
}
providers.PROVIDERS.__fake = {
  id: '__fake', label: 'test', endpoint: 'http://127.0.0.1:1/v1/chat/completions',
  method: 'POST', authScheme: 'bearer', authHeader: 'Authorization', extraHeaders: {},
  defaultModel: 'fake-model', models: [], openModel: true, keyOptional: true, maxTokens: 100,
  responsePath: ['choices', 0, 'message', 'content'],
  body: { style: 'openai-chat' }, baseUrlDefault: 'http://127.0.0.1:1/v1'
};
providers.PROVIDERS.__fakeAnthropic = {
  ...getProvider('claude'), id: '__fakeAnthropic', endpoint: 'http://127.0.0.1:1/v1/messages', keyOptional: true
};
let next = null;
let seen = null;
global.fetch = async (url, init) => {
  seen = JSON.parse(init.body);
  if (typeof next === 'function') return next();
  return { ok: true, status: 200, json: async () => next };
};

(async () => {
  // generate without a key fails fast in Hebrew (no network call happens)
  ai.saveSettings({ provider: 'claude', apiKey: '' });
  try { await ai.generate({ system: 's', user: 'u' }); check('generate without key rejects', false); }
  catch (e) { check('generate without key rejects with guidance + code NO_PROVIDER', /מפתח/.test(e.message) && e.code === 'NO_PROVIDER'); }

  ai.saveSettings({ provider: '__fake', baseUrl: 'http://127.0.0.1:1/v1', model: 'fake-model' });
  next = { choices: [{ message: { content: 'שלום' } }], usage: { prompt_tokens: 12, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 1 } } };
  const d = await ai.generateDetailed({ system: 'S', user: 'U', maxTokens: 2048, timeoutMs: 5000 });
  check('generateDetailed → {text, usage, ms, provider}', d.text === 'שלום' && typeof d.ms === 'number' && d.provider.id === '__fake' && d.provider.model === 'fake-model');
  check('openai-chat usage is read (prompt/completion + reasoning_tokens)',
    d.usage.prompt_tokens === 12 && d.usage.completion_tokens === 3 && d.usage.reasoning_tokens === 1);
  check('maxTokens rides the body; the request shape is the same generate() always sent',
    seen.max_tokens === 2048 && seen.messages[0].role === 'system' && seen.messages[0].content === 'S' && seen.messages[1].content === 'U' && !('tools' in seen));
  check('generate() is now a wrapper returning the same text', (await ai.generate({ system: 'S', user: 'U' })) === 'שלום');

  next = { choices: [{ message: { content: '' } }] };
  try { await ai.generateDetailed({ user: 'U' }); check('empty content rejects', false); }
  catch (e) { check('an empty content field → code EMPTY_REPLY', e.code === 'EMPTY_REPLY'); }

  next = () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'slow down' } }) });
  try { await ai.generateDetailed({ user: 'U' }); check('non-2xx rejects', false); }
  catch (e) { check('a non-2xx → code PROVIDER_ERROR with .status + .providerMessage', e.code === 'PROVIDER_ERROR' && e.status === 429 && e.providerMessage === 'slow down'); }

  next = () => { const t = new Error('המודל לא ענה'); t.code = 'TIMEOUT'; throw t; };
  try { await ai.generateDetailed({ user: 'U' }); check('timeout rejects', false); }
  catch (e) { check('the ceiling passing → code TIMEOUT', e.code === 'TIMEOUT'); }

  next = () => { throw new Error('ECONNREFUSED'); };
  try { await ai.generateDetailed({ user: 'U' }); check('wire failure rejects', false); }
  catch (e) { check('a wire failure → code NETWORK', e.code === 'NETWORK' && /רשת/.test(e.message)); }

  ai.saveSettings({ provider: 'browser' });
  try { await ai.generateDetailed({ user: 'U' }); check('browser relay rejects', false); }
  catch (e) { check('the browser-relay provider → code BROWSER_RELAY (the honest message kept)', e.code === 'BROWSER_RELAY' && /דרך הדפדפן/.test(e.message)); }

  // anthropic usage keys map to the same shape
  ai.saveSettings({ provider: '__fakeAnthropic', apiKey: '' });
  next = { content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 40, output_tokens: 5 } };
  const a2 = await ai.generateDetailed({ user: 'U' });
  check('anthropic usage (input/output_tokens) maps to prompt/completion_tokens',
    a2.text === 'hi' && a2.usage.prompt_tokens === 40 && a2.usage.completion_tokens === 5 && a2.usage.reasoning_tokens === undefined);
  check('anthropic request shape unchanged (system top-level, no tools)', seen.system === '' && Array.isArray(seen.messages) && !('tools' in seen));

  // the repair round's history cap: the chat's 12K per turn stays the
  // default; a runner may raise it so a whole pack rides along
  const long = 'x'.repeat(20000);
  const capped = ai.buildRequest(getProvider('openai'), 'k', 'S', 'now', 'gpt-4o', [{ role: 'user', content: long }]);
  const raised = ai.buildRequest(getProvider('openai'), 'k', 'S', 'now', 'gpt-4o', [{ role: 'user', content: long }], 40000);
  check('history turns stay capped at 12000 chars by default; turnCap raises it',
    capped.body.messages[1].content.length === 12000 && raised.body.messages[1].content.length === 20000);


  // ── v2.52 — what the premium tier still lacked after v2.51's meter: a key that stays with its supplier, Gemini
  //    with the owner's own AI Studio key, OpenAI's current models and field names, a cache cut that survives the
  //    owner clicking another block, and a wire whose optional fields a supplier may refuse without taking the
  //    copilot down. ──
  {
    const g = getProvider('gemini');
    check('gemini is a provider: Google\'s OpenAI-compatible chat endpoint, Bearer key, the openai-chat shape the tool loop already speaks',
      g && g.endpoint === 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' && g.authScheme === 'bearer' &&
      g.body.style === 'openai-chat' && g.keyUrl === 'https://aistudio.google.com/apikey' && g.models.includes(g.defaultModel));
    check('gemini says what its FREE tier means for the owner\'s pages, where the key is pasted', /חינמית/.test(g.note || '') && /לשיפור/.test(g.note || ''));
    const gr = ai.buildRequest(g, 'G-KEY', 'SYSTEM', 'hi', g.defaultModel);
    check('gemini: the key rides as Bearer, the system is the first message', gr.headers.Authorization === 'Bearer G-KEY' && gr.body.messages[0].role === 'system');
    check('openai\'s list is current: the default accepts reasoning_effort, and the 2024 ids are gone',
      getProvider('openai').defaultModel === 'gpt-5.6-terra' && !getProvider('openai').models.includes('gpt-4o'));
    const cost = require('../src/ai-cost');
    check('every model openai and gemini LIST has a dated quote (a cap can be enforced without --price-in), and Gemini\'s launch price knows its end date',
      ['openai', 'gemini'].every((id) => getProvider(id).models.every((m) => { const q = cost.priceFor(id, m); return q && q.in > 0 && /^\d{4}-\d{2}-\d{2}$/.test(q.asOf) && /^https:/.test(q.source); })) &&
      cost.priceFor('gemini', 'gemini-3.8-flash', '2026-12-31').in === 0.75 && cost.priceFor('gemini', 'gemini-3.8-flash', '2027-01-01').in === 1.5);
  }

  // a key belongs to the supplier it was issued by
  {
    ai.saveSettings({ provider: 'claude', model: 'claude-sonnet-5', apiKey: 'sk-ant-CLAUDE-KEY-aaaa' });
    const sw = ai.saveSettings({ provider: 'openai', model: 'gpt-5.6-terra' }); // the card's rule: an empty key field keeps the stored key
    check('switching supplier WITHOUT a new key does not carry the old one along: openai has no key',
      sw.provider === 'openai' && sw.hasKey === false && sw.keyTail === '' && sw.keyTails.claude === 'aaaa' && !sw.keyTails.openai);
    let called = false;
    const before = global.fetch;
    global.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    let code = '';
    try { await ai.generate({ system: 's', user: 'u' }); } catch (e) { code = e.code; }
    global.fetch = before;
    check('…so a call to openai is refused for want of ITS key — Anthropic\'s key never reaches api.openai.com (no request left)', code === 'NO_PROVIDER' && called === false);
    const both = ai.saveSettings({ apiKey: 'sk-OPENAI-KEY-bbbb' });
    check('each supplier keeps its own key; the echo is still tails only', both.keyTails.claude === 'aaaa' && both.keyTails.openai === 'bbbb' && both.keyTail === 'bbbb' &&
      !/CLAUDE-KEY|OPENAI-KEY/.test(JSON.stringify(both)));
    const onDisk = JSON.parse(fs.readFileSync(ai.STORE_PATH, 'utf8'));
    check('the store files keys per supplier and no longer has the single `apiKey` field', onDisk.keys && onDisk.keys.claude && onDisk.keys.openai && onDisk.apiKey === undefined);
    check('keyFor takes the key of the supplier it is asked about and nothing else', ai.keyFor(onDisk, 'claude') === 'sk-ant-CLAUDE-KEY-aaaa' && ai.keyFor(onDisk, 'gemini') === '');
    const cleared = ai.saveSettings({ apiKey: '' });
    check('clearing clears THIS supplier\'s key only', cleared.hasKey === false && cleared.keyTails.claude === 'aaaa' && !cleared.keyTails.openai);
    fs.writeFileSync(ai.STORE_PATH, JSON.stringify({ provider: 'claude', model: 'claude-sonnet-5', apiKey: 'sk-ant-LEGACY-cccc', baseUrl: '' }));
    const legacy = ai.getSettings();
    check('a store from before v2.52 reads as it was meant: its one key belongs to the supplier it was saved with', legacy.hasKey && legacy.keyTail === 'cccc' && legacy.keyTails.claude === 'cccc');
    ai.saveSettings({ provider: 'gemini' });
    check('…and it does not follow the owner to another supplier either', ai.getSettings().hasKey === false && ai.getSettings().keyTails.claude === 'cccc');
  }

  // where the cache cuts, and what each supplier gets on the wire
  {
    const dict = 'מילון המודולים '.repeat(400); // ≈ 6,000 chars — over the floor under which nothing is marked
    const sitA = ai.SITUATION_MARK + ' — בעל/ת האתר בתוך בונה הדפים\n**הפריט המסומן כרגע:** מודול `text` — "שלום"';
    const sitB = ai.SITUATION_MARK + ' — בעל/ת האתר בתוך בונה הדפים\n**הפריט המסומן כרגע:** מודול `hero` — "ברוכים הבאים"';
    const a = ai.cacheableSystem(getProvider('claude'), dict + sitA);
    const b = ai.cacheableSystem(getProvider('claude'), dict + sitB);
    check('claude: the briefing is its own cached block, cut at the situation\'s head; the situation rides after it UNMARKED',
      Array.isArray(a) && a.length === 2 && a[0].cache_control.type === 'ephemeral' && !a[1].cache_control && a[1].text.startsWith(ai.SITUATION_MARK) && a[0].text + a[1].text === dict + sitA);
    check('…so the owner selecting ANOTHER block changes only the unmarked part — the cached block is byte-identical (before: one block, a new hash, the 1.25× write again every turn)',
      a[0].text === b[0].text && a[1].text !== b[1].text);
    check('a system text with no situation stays ONE cached block, and a short one stays the plain string it always was',
      ai.cacheableSystem(getProvider('claude'), dict).length === 1 && ai.cacheableSystem(getProvider('claude'), 'short') === 'short' && ai.cacheableSystem(getProvider('openai'), dict + sitA) === dict + sitA);
    const c = ai.wireBody(getProvider('claude'), { model: 'claude-sonnet-5', max_tokens: 8192, system: a, messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 't' }] });
    check('claude on the wire: a top-level cache_control lets the API move a breakpoint along the conversation; the rest is untouched',
      c.cache_control && c.cache_control.type === 'ephemeral' && c.max_tokens === 8192 && c.tools.length === 1 && c.reasoning_effort === undefined && c.system === a);
    check('…but only when the system is being cached anyway (a short prompt gets no mark at all)', ai.wireBody(getProvider('claude'), { model: 'm', max_tokens: 10, system: 'short', messages: [] }).cache_control === undefined);
    const o = ai.wireBody(getProvider('openai'), { model: 'gpt-5.6-terra', max_tokens: 8192, messages: [] });
    check('openai: the reply budget goes under the name it asks for now, and a level of thinking is named', o.max_completion_tokens === 8192 && o.max_tokens === undefined && o.reasoning_effort === 'low' && o.cache_control === undefined);
    const gm = ai.wireBody(getProvider('gemini'), { model: 'gemini-3.8-flash', max_tokens: 8192, messages: [] });
    check('gemini: max_tokens stays, thinking is asked down to "low" ("none" is not a level its 3.x models have)', gm.max_tokens === 8192 && gm.reasoning_effort === 'low');
    const x = { model: 'grok-4', max_tokens: 8192, messages: [] };
    check('a supplier whose table names no optional field gets the body as it was (xai, openrouter)', JSON.stringify(ai.wireBody(getProvider('xai'), x)) === JSON.stringify(x));
    const loc = { model: 'x', max_tokens: 4096, reasoning_effort: 'none', messages: [] };
    check('a local model and the Bridge get exactly the object they always got', ai.wireBody(getProvider('local'), loc) === loc && ai.wireBody(getProvider('browser'), loc) === loc);
  }

  // a supplier that refuses one of OUR optional fields costs one round trip, not the copilot
  {
    const bodies = [];
    const before = global.fetch;
    global.fetch = async (url, init) => {
      const bd = JSON.parse(init.body);
      bodies.push(bd);
      if (bd.cache_control) return { ok: false, status: 400, json: async () => ({ type: 'error', error: { type: 'invalid_request_error', message: 'cache_control: Extra inputs are not permitted' } }) };
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 9, output_tokens: 1 } }) };
    };
    ai.saveSettings({ provider: '__fakeAnthropic', model: 'claude-sonnet-5' });
    const long = 'S'.repeat(6000);
    const r = await ai.generateDetailed({ system: long, user: 'U' });
    check('a 400 that NAMES cache_control → the field is dropped, the system goes back to the plain string, and the SAME call is repeated once — the owner gets her answer',
      r.text === 'ok' && bodies.length === 2 && !!bodies[0].cache_control && Array.isArray(bodies[0].system) && bodies[1].cache_control === undefined && bodies[1].system === long);
    check('…it is remembered for this supplier, so the next call does not pay the round trip again',
      ai.refusedFields('__fakeAnthropic').join() === 'cache_control' && (await ai.generateDetailed({ system: long, user: 'U' })).text === 'ok' && bodies.length === 3 && bodies[2].cache_control === undefined);
    let other = '';
    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'messages: at least one message is required' } }) });
    try { await ai.generateDetailed({ system: 'S', user: 'U' }); } catch (e) { other = e.code + ':' + e.status; }
    check('a 400 about anything ELSE is the supplier\'s error, reported as it always was (no retry, nothing dropped)', other === 'PROVIDER_ERROR:400' && ai.refusedFields('__fakeAnthropic').length === 1);
    global.fetch = before;
  }

  done();
})().catch((e) => { console.error(e); fail = true; done(); });

function done() {
  try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) {}
  console.log('');
  if (fail) { console.log('SMOKE BYOK: FAIL'); process.exit(1); }
  console.log('SMOKE BYOK: PASS');
}
