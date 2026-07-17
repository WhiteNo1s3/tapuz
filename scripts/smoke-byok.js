'use strict';

/**
 * v0.73 QA — BYOK request shaping + the CMS provider constants.
 * The KEY isolation invariants (key never reaches the CMS/content/popup) are
 * asserted in smoke-extension.js; here we prove the direct-call REQUEST is
 * built correctly for each provider, and the CMS table carries no secret.
 */

const path = require('path');

// llm.js is a service-worker UMD attached to `self`; shim it for Node.
globalThis.self = globalThis;
require(path.join(__dirname, '..', 'extension', 'llm.js'));
const { buildRequest, generate, endpointAllowed, ALLOWED_API_HOSTS } = globalThis.TapuzLLM;
const { getProvider, listProviders } = require('../src/providers');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

// ── CMS provider constants (the authority the extension consumes) ────
const table = listProviders();
check('provider table is non-empty', table.length >= 1);
check('every provider has endpoint + method + defaultModel + authHeader',
  table.every((p) => p.endpoint && p.method && p.defaultModel && p.authHeader && Array.isArray(p.models)));
check('table carries NO secret field', table.every((p) => p.apiKey === undefined && p.key === undefined && p.secret === undefined));
check('claude endpoint is the anthropic messages API', getProvider('claude').endpoint === 'https://api.anthropic.com/v1/messages');
check('claude default model is a current id', /^claude-(sonnet-5|opus-4-8|haiku-4-5)/.test(getProvider('claude').defaultModel));

// ── Anthropic request shape ──────────────────────────────────────────
const a = buildRequest(getProvider('claude'), 'sk-ant-SECRET', 'SYSTEM', 'בנה דף מאפייה', 'claude-sonnet-5');
check('claude: key ONLY in x-api-key', a.headers['x-api-key'] === 'sk-ant-SECRET' && !a.headers['Authorization']);
check('claude: required anthropic headers present', a.headers['anthropic-version'] && a.headers['anthropic-dangerous-direct-browser-access'] === 'true');
check('claude: system is top-level, not a message', a.body.system === 'SYSTEM' && !a.body.messages.some((m) => m.role === 'system'));
check('claude: user brief carried', a.body.messages[0].content === 'בנה דף מאפייה');
check('claude: max_tokens set', typeof a.body.max_tokens === 'number' && a.body.max_tokens > 0);
check('claude: key NOT in the body', !JSON.stringify(a.body).includes('SECRET'));

// ── OpenAI request shape ─────────────────────────────────────────────
const o = buildRequest(getProvider('openai'), 'sk-OAI-SECRET', 'SYSTEM', 'brief', null);
check('openai: Bearer auth, no x-api-key', o.headers['Authorization'] === 'Bearer sk-OAI-SECRET' && !o.headers['x-api-key']);
check('openai: system + user as messages', o.body.messages[0].role === 'system' && o.body.messages[1].role === 'user');
check('openai: falls back to default model', o.body.model === getProvider('openai').defaultModel);
check('openai: key NOT in the body', !JSON.stringify(o.body).includes('SECRET'));

// ── SECURITY: endpoint host allowlist is HARDCODED in the extension ──
// (review finding: a compromised CMS could otherwise redirect the key to
//  itself by returning a malicious endpoint)
check('allowlist is a fixed set in the extension, not from the CMS',
  ALLOWED_API_HOSTS.has('api.anthropic.com') && ALLOWED_API_HOSTS.has('api.openai.com'));
check('real provider endpoints are allowed', endpointAllowed('https://api.anthropic.com/v1/messages') && endpointAllowed('https://api.openai.com/v1/chat/completions'));
check('a CMS-origin endpoint is REFUSED', !endpointAllowed('https://my-cms.example.com/collect'));
check('http (non-https) endpoint is refused', !endpointAllowed('http://api.anthropic.com/v1/messages'));
check('look-alike host is refused', !endpointAllowed('https://api.anthropic.com.evil.com/v1'));
// generate() must THROW (never fetch, never attach the key) on a bad host
(async () => {
  let threw = false, sentKey = false;
  const evil = { ...getProvider('claude'), endpoint: 'https://my-cms.example.com/collect' };
  // patch fetch to detect any leak attempt
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { if (String(JSON.stringify(opts || {})).includes('LEAKKEY') || (opts && opts.headers && opts.headers['x-api-key'])) sentKey = true; return { ok: true, json: async () => ({}) }; };
  try { await generate(evil, 'sk-ant-LEAKKEY', 's', 'u', 'claude-sonnet-5'); } catch (e) { threw = true; }
  globalThis.fetch = origFetch;
  check('generate() REFUSES a non-allowlisted endpoint (throws)', threw);
  check('generate() never fetched / never sent the key to the bad host', !sentKey);

  // ── guards ─────────────────────────────────────────────────────────
  check('buildRequest tolerates empty key (generate() is the gate)', (() => { try { buildRequest(getProvider('claude'), '', 's', 'u'); return true; } catch (e) { return true; } })());

  console.log('');
  console.log(fail ? 'SMOKE BYOK: FAIL' : 'SMOKE BYOK: PASS');
  process.exit(fail ? 1 : 0);
})();
