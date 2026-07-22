'use strict';

/**
 * v1.57 QA — the local-model endpoint policy.
 *
 * The allowlist exists because a provider descriptor must never be able to
 * redirect a user's API key to an attacker (the v0.73 BYOK review). Opening a
 * loopback exception for LM Studio / Ollama widens exactly that surface, so
 * this file is the gate: every classic way of dressing a public host up as a
 * local one has to be refused, and the refusal has to happen BEFORE a key is
 * attached.
 *
 * The parser does most of the work — `127.1`, `2130706433` and
 * `[0:0:0:0:0:0:0:1]` normalise to real loopback literals, while
 * `localhost.evil.com` keeps its true host — but that is exactly why it must
 * be pinned: the safety is a property of checking the PARSED hostname, and a
 * future refactor that string-matches the raw URL would pass review and be
 * wrong.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-llm-'));

const {
  endpointAllowed, isLoopbackHost, resolveLocalEndpoint, getProvider, listProviders
} = require('../src/providers');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

// ── the public allowlist still holds ──────────────────────────────────────
check('the two shipped public hosts are allowed over https',
  endpointAllowed('https://api.anthropic.com/v1/messages') &&
  endpointAllowed('https://api.openai.com/v1/chat/completions'));
check('a public host over PLAIN http is refused',
  !endpointAllowed('http://api.anthropic.com/v1/messages'));
check('an unlisted public host is refused even over https',
  !endpointAllowed('https://evil.example.com/v1/messages') &&
  !endpointAllowed('https://api.anthropic.com.evil.com/v1/messages'));

// ── loopback is allowed, in every form a user might type ──────────────────
for (const url of [
  'http://127.0.0.1:1234/v1/chat/completions',
  'http://localhost:1234/v1/chat/completions',
  'http://LOCALHOST:1234/v1/chat/completions',
  'http://[::1]:1234/v1/chat/completions',
  'http://127.1:1234/v1/chat/completions',              // legacy shorthand
  'http://2130706433:1234/v1/chat/completions',         // decimal form
  'http://[0:0:0:0:0:0:0:1]:1234/v1/chat/completions',  // expanded v6
  'http://127.0.0.5:11434/v1/chat/completions',         // rest of 127.0.0.0/8
  'https://localhost:1234/v1/chat/completions'          // https loopback too
]) {
  check('loopback allowed: ' + url, endpointAllowed(url));
}

// ── the spoofs must all fail ──────────────────────────────────────────────
for (const url of [
  'http://localhost.evil.com/v1',        // suffix trick
  'http://127.0.0.1.evil.com/v1',        // same, numeric
  'https://evil.com#localhost',          // fragment
  'https://evil.com?x=127.0.0.1',        // query
  'http://user@evil.com/v1',             // userinfo
  'http://evil.com:1234/v1',             // just a local-looking port
  'http://0.0.0.0:1234/v1',              // all-interfaces is NOT loopback
  'http://192.168.1.10:1234/v1',         // LAN is not this machine
  'http://10.0.0.5:1234/v1',
  'http://[::ffff:127.0.0.1]:1234/v1',   // v4-mapped-v6 is not an exact match
  'file:///etc/passwd',
  'javascript:alert(1)',
  'not a url at all',
  ''
]) {
  check('refused: ' + (url || '(empty)'), !endpointAllowed(url));
}

// ── isLoopbackHost itself ─────────────────────────────────────────────────
check('isLoopbackHost accepts the literals and the whole 127/8 range',
  isLoopbackHost('localhost') && isLoopbackHost('[::1]') &&
  isLoopbackHost('127.0.0.1') && isLoopbackHost('127.255.255.254'));
check('isLoopbackHost rejects near-misses',
  !isLoopbackHost('128.0.0.1') && !isLoopbackHost('0.0.0.0') &&
  !isLoopbackHost('localhost.evil.com') && !isLoopbackHost('') &&
  !isLoopbackHost('999.0.0.1'));

// ── resolveLocalEndpoint: the user's own address, re-checked ──────────────
check('a bare base URL grows the chat-completions path',
  /\/chat\/completions$/.test(resolveLocalEndpoint('http://127.0.0.1:1234/v1') || ''));
check('a trailing slash does not double up',
  !/\/\/chat/.test(resolveLocalEndpoint('http://127.0.0.1:1234/v1/') || ''));
check('an empty base falls back to the LM Studio default',
  /127\.0\.0\.1:1234/.test(resolveLocalEndpoint('') || ''));
check('a PUBLIC address in the local box resolves to null (never callable)',
  resolveLocalEndpoint('https://api.openai.com/v1') === null &&
  resolveLocalEndpoint('http://evil.com:1234/v1') === null);

// ── the provider entry ────────────────────────────────────────────────────
const local = getProvider('local');
check('a `local` provider is registered', !!local);
check('local speaks the OpenAI chat shape (what LM Studio/Ollama serve)',
  local.body.style === 'openai-chat' &&
  JSON.stringify(local.responsePath) === JSON.stringify(['choices', 0, 'message', 'content']));
check('local declares key-optional + open model (it serves whatever is loaded)',
  local.keyOptional === true && local.openModel === true);
check('local ships a loopback default endpoint',
  endpointAllowed(local.endpoint) && /127\.0\.0\.1/.test(local.endpoint));
check('the provider table the extension fetches carries no secret',
  listProviders().every((p) => !('apiKey' in p) && !('key' in p)));

// ── the settings store refuses a non-local address ────────────────────────
const ai = require('../src/ai');
let rejected = false;
try { ai.saveSettings({ baseUrl: 'https://api.openai.com/v1' }); }
catch (e) { rejected = true; }
check('saveSettings REFUSES a non-loopback baseUrl (never stored, never called)', rejected);
ai.saveSettings({ baseUrl: 'http://127.0.0.1:1234/v1' });
check('saveSettings accepts a loopback baseUrl and reads it back',
  ai.getSettings().baseUrl === 'http://127.0.0.1:1234/v1');
check('getSettings still never echoes the key itself',
  !('apiKey' in ai.getSettings()));

// ── a local call needs no key ─────────────────────────────────────────────
const built = ai.buildRequest(local, '', 'sys', 'hi', 'any-model', []);
check('with no key, no empty Authorization header is sent to the local runtime',
  !('Authorization' in built.headers));
const withKey = ai.buildRequest(local, 'k123', 'sys', 'hi', 'any-model', []);
check('with a key, the header IS sent (some local runtimes require one)',
  withKey.headers.Authorization === 'Bearer k123');
check('a public provider still always gets its auth header, even when empty',
  'x-api-key' in ai.buildRequest(getProvider('claude'), '', 's', 'u', 'm', []).headers);

console.log('');
console.log(fail ? 'SMOKE LOCAL-LLM: FAIL' : 'SMOKE LOCAL-LLM: PASS');
process.exit(fail ? 1 : 0);
