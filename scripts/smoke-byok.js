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

// generate without a key fails fast in Hebrew (no network call happens)
ai.generate({ system: 's', user: 'u' }).then(
  () => { check('generate without key rejects', false); done(); },
  (e) => { check('generate without key rejects with guidance', /מפתח/.test(e.message)); done(); }
);

function done() {
  try { fs.rmSync(process.env.TAPUZ_ROOT, { recursive: true, force: true }); } catch (e) {}
  console.log('');
  if (fail) { console.log('SMOKE BYOK: FAIL'); process.exit(1); }
  console.log('SMOKE BYOK: PASS');
}
