'use strict';

/**
 * LLM provider constants (v0.73, BYOK) — the CMS is the single authority on
 * WHERE each supplier's API lives and HOW to call it. The Chrome extension
 * stays dumb: it fetches this table and never hardcodes an endpoint or a
 * model id, so a provider change ships as a CMS update, not an extension
 * re-release. (Same "constants live in the CMS" rule the wizard follows with
 * LOOKS.)
 *
 * THE KEY NEVER LIVES HERE. BYOK means the user's own API key sits in the
 * extension's background worker and goes straight from there to the provider;
 * the CMS neither sees, stores, nor proxies it. This module only describes
 * the shape of a request — auth header NAME and format, not the secret.
 */

// LM Studio's default listen address. Ollama uses :11434, vLLM :8000 — the
// user overrides it in settings; this is only what the field starts with.
const DEFAULT_LOCAL_BASE = 'http://127.0.0.1:1234/v1';

// {apiKey} is substituted with the user's key INSIDE the extension worker,
// never here. authScheme documents how: 'x-api-key' (Anthropic) sends the raw
// key in that header; 'bearer' sends 'Authorization: Bearer <key>'.
const PROVIDERS = {
  claude: {
    id: 'claude',
    label: 'Claude (Anthropic)',
    chatHost: 'claude.ai',
    endpoint: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    authScheme: 'x-api-key',
    authHeader: 'x-api-key',
    // Anthropic requires these two on every direct browser call.
    extraHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    defaultModel: 'claude-sonnet-5',
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
    maxTokens: 8192,
    // response body path to the assistant text: content[0].text
    responsePath: ['content', 0, 'text'],
    keyHint: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    // request-shape flags the extension reads to build the body
    body: { style: 'anthropic-messages', systemField: 'system' }
  },
  openai: {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    chatHost: 'chatgpt.com',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    method: 'POST',
    authScheme: 'bearer',
    authHeader: 'Authorization',
    extraHeaders: {},
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    maxTokens: 8192,
    responsePath: ['choices', 0, 'message', 'content'],
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    body: { style: 'openai-chat', systemField: 'system-message' }
  },
  // A model running on the owner's own machine (LM Studio, Ollama, vLLM,
  // llama.cpp — they all expose the OpenAI chat-completions shape). No key
  // required and none charged; nothing leaves the machine. `endpoint` is a
  // DEFAULT: the real one comes from the user's baseUrl setting and must
  // resolve to loopback (see resolveLocalEndpoint).
  local: {
    id: 'local',
    label: 'מודל מקומי (LM Studio / Ollama)',
    chatHost: '',
    endpoint: DEFAULT_LOCAL_BASE + '/chat/completions',
    method: 'POST',
    authScheme: 'bearer',
    authHeader: 'Authorization',
    extraHeaders: {},
    // The served model is whatever the local runtime has loaded, so the list
    // is advisory — any string the user types is accepted.
    defaultModel: 'local-model',
    models: [],
    openModel: true,
    keyOptional: true,
    maxTokens: 4096,
    responsePath: ['choices', 0, 'message', 'content'],
    keyHint: 'לרוב לא נדרש — השאירו ריק',
    keyUrl: '',
    baseUrlDefault: DEFAULT_LOCAL_BASE,
    body: { style: 'openai-chat', systemField: 'system-message' }
  }
};

// ── endpoint policy ─────────────────────────────────────────────────────
//
// THE ONE PLACE that decides whether a key may be sent to an address. It was
// a two-host allowlist (the fix from the BYOK review: a compromised CMS must
// not be able to redirect a user's key to an attacker). That stayed correct
// for public providers — and locked out every local model, because LM Studio
// answers on http://127.0.0.1:1234 and fails BOTH tests: not https, not in
// the set.
//
// So the rule is now two rules:
//   • public host  → https ONLY, and only the hosts we ship
//   • loopback     → any port, http allowed — a key sent to 127.0.0.1 never
//                    leaves the machine, so plaintext costs nothing and there
//                    is no third party to leak to
//
// The loopback test runs on the hostname AFTER URL parsing, which is what
// makes it safe: the parser normalises `127.1`, `2130706433` and
// `[0:0:0:0:0:0:0:1]` to real loopback literals, while `localhost.evil.com`,
// `127.0.0.1.evil.com` and `http://user@evil.com` keep their true host and
// fail the exact match. 0.0.0.0 is deliberately NOT loopback — it means
// "every interface", which is the opposite of private.
const ALLOWED_API_HOSTS = new Set(['api.anthropic.com', 'api.openai.com']);

/** Is this hostname (already URL-normalised) the local machine itself? */
function isLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === 'localhost' || h === '[::1]' || h === '::1') return true;
  // the whole 127.0.0.0/8 range, not just 127.0.0.1
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return false;
  return parts[0] === 127;
}

/** May a key be sent to this URL? */
function endpointAllowed(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return false; }
  if (isLoopbackHost(u.hostname)) return u.protocol === 'http:' || u.protocol === 'https:';
  return u.protocol === 'https:' && ALLOWED_API_HOSTS.has(u.host);
}

/** The provider table the extension consumes (never includes any secret). */
function listProviders() {
  return Object.keys(PROVIDERS).map((id) => ({ ...PROVIDERS[id] }));
}

function getProvider(id) {
  return PROVIDERS[id] ? { ...PROVIDERS[id] } : null;
}

/**
 * The local provider's endpoint is the ONE the user supplies (their LM Studio
 * / Ollama / vLLM port), so it is resolved per call from settings instead of
 * being frozen in the table. Anything not loopback is refused here, before a
 * key is attached — a public URL typed into the "local" box must not turn
 * this into an open proxy for the allowlist.
 */
function resolveLocalEndpoint(baseUrl) {
  const raw = String(baseUrl || '').trim() || DEFAULT_LOCAL_BASE;
  const base = raw.replace(/\/+$/, '');
  const url = /\/(chat\/)?completions$|\/v1\/.+/.test(base) ? base : base + '/chat/completions';
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  return isLoopbackHost(u.hostname) ? u.toString() : null;
}

module.exports = {
  PROVIDERS,
  listProviders,
  getProvider,
  endpointAllowed,
  isLoopbackHost,
  resolveLocalEndpoint,
  ALLOWED_API_HOSTS,
  DEFAULT_LOCAL_BASE
};
