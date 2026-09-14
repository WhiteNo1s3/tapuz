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
check('the error vocabulary is exported (append-only: v2.28 six + v2.32 window four)',
  JSON.stringify(ai.ERROR_CODES) === JSON.stringify([
    'NO_PROVIDER', 'BROWSER_RELAY', 'NETWORK', 'TIMEOUT', 'PROVIDER_ERROR', 'EMPTY_REPLY',
    'WINDOW_TOO_SMALL', 'BRIDGE_TOO_OLD', 'BRIDGE_DROPPED_TOOLS', 'REPLY_CUT'
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

  done();
})().catch((e) => { console.error(e); fail = true; done(); });

function done() {
  try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) {}
  console.log('');
  if (fail) { console.log('SMOKE BYOK: FAIL'); process.exit(1); }
  console.log('SMOKE BYOK: PASS');
}
