'use strict';

/**
 * LLM provider constants (v0.73, BYOK) — the CMS is the single authority on
 * WHERE each supplier's API lives and HOW to call it. The Chrome extension
 * stays dumb: it fetches this table and never hardcodes an endpoint or a
 * model id, so a provider change ships as a CMS update, not an extension
 * re-release. (Same "constants live in the CMS" rule the wizard follows with
 * LOOKS.)
 *
 * THE KEY NEVER LIVES HERE. This table only describes the shape of a request —
 * auth header NAME and format, not the secret. (Since v0.85 the owner's key is
 * stored by the CMS in config/ai.json and the server makes the call; since
 * v2.52 it is stored PER PROVIDER, so a key is only ever sent to the company
 * that issued it — ai.js keyFor.)
 *
 * v2.52 — two optional fields the wire obeys (ai.js wireBody), both read from
 * the supplier's own docs on 2026-09-20 and both REVOCABLE (a 400 that names
 * the field drops it for that supplier and the call is repeated once):
 *   maxTokensField   the name this supplier wants for the reply budget
 *                    (OpenAI deprecated `max_tokens` for `max_completion_tokens`)
 *   reasoningEffort  sent as `reasoning_effort` — the copilot wants an ANSWER,
 *                    and a cloud model's thinking is billed as output
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
    // The default is the middle of the list on purpose: the cheapest model
    // that has driven the copilot's tool loop end to end. Opus is the one an
    // owner CHOOSES; Haiku is the one a long run is priced against.
    defaultModel: 'claude-sonnet-5',
    models: ['claude-sonnet-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-haiku-4-5'],
    modelsUrl: 'https://api.anthropic.com/v1/models',
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
    // v2.52 — the list had rotted (gpt-4o / gpt-4o-mini / gpt-4.1). Read from OpenAI's models page on 2026-09-20.
    // The old ids are still sold but superseded, and they refuse `reasoning_effort`; a store that still says
    // 'gpt-4o' falls back to the default (modelFor holds a listed provider to its list).
    defaultModel: 'gpt-5.6-terra',
    models: ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-6-astra'],
    maxTokens: 8192,
    maxTokensField: 'max_completion_tokens',
    reasoningEffort: 'low',
    responsePath: ['choices', 0, 'message', 'content'],
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    modelsUrl: 'https://api.openai.com/v1/models',
    body: { style: 'openai-chat', systemField: 'system-message' }
  },
  // v2.52 — Gemini, with the owner's own Google AI Studio key, through Google's OpenAI-compatible endpoint: the
  // same openai-chat shape the local model, the Bridge and OpenAI speak, so the tool loop needs nothing new.
  // (OpenRouter below also reaches Gemini — with OpenRouter's key and margin. This is the direct road, and the
  // one with a free tier.) A 3.x model cannot switch thinking off ("none" is a 2.5-only value), so the floor is
  // "low"; v2.50's net — a reply that thought its budget away is asked once more with a larger one — is
  // openai-chat wide and covers it. Model ids read from Google's models page on 2026-09-20.
  gemini: {
    id: 'gemini',
    label: 'Gemini (Google)',
    chatHost: 'gemini.google.com',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    method: 'POST',
    authScheme: 'bearer',
    authHeader: 'Authorization',
    extraHeaders: {},
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    maxTokens: 8192,
    reasoningEffort: 'low',
    // AI Studio hands out a FREE tier — and Google says content sent on it is used to improve its products; the
    // paid tier's is not. The owner's pages go through the model, so the setup screen says so where the key is pasted.
    note: 'ל-Gemini יש שכבה חינמית — Google מציינת שתוכן שנשלח בה משמש לשיפור המוצרים שלה; בשכבה בתשלום לא. הדפים שלכם עוברים דרך המודל, אז בחרו בידיעה.',
    responsePath: ['choices', 0, 'message', 'content'],
    keyHint: 'מפתח מ-Google AI Studio',
    keyUrl: 'https://aistudio.google.com/apikey',
    body: { style: 'openai-chat', systemField: 'system-message' }
  },
  // Grok (xAI). OpenAI-shaped, so nothing in the request builder changes —
  // only the host, and the host is the whole security question (below).
  //
  // `openModel` here is honesty, not laziness: xAI renames and retires model
  // ids faster than this table can be re-read, so the CMS accepts the id the
  // owner gives it and asks the provider itself (`modelsUrl`) rather than
  // holding a list that silently goes stale. `defaultModel` is a starting
  // point for the setup screen, never something a measured run relies on —
  // the battery refuses to run an open-model provider without an explicit
  // --model, so a row always names the weights that answered.
  xai: {
    id: 'xai',
    label: 'Grok (xAI)',
    chatHost: 'grok.com',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    method: 'POST',
    authScheme: 'bearer',
    authHeader: 'Authorization',
    extraHeaders: {},
    defaultModel: 'grok-4',
    models: [],
    openModel: true,
    maxTokens: 8192,
    responsePath: ['choices', 0, 'message', 'content'],
    keyHint: 'xai-…',
    keyUrl: 'https://console.x.ai',
    modelsUrl: 'https://api.x.ai/v1/models',
    body: { style: 'openai-chat', systemField: 'system-message' }
  },
  // One key, most of the field. OpenRouter fronts Grok, Gemini, DeepSeek,
  // Qwen, Kimi and the rest behind the same OpenAI shape — which is what
  // makes a SURVEY of the premium tier affordable: one account, one key, one
  // request shape, and a model id that names the vendor (`x-ai/grok-4`).
  // Model ids are the provider's, so `openModel` applies for the same reason.
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (Grok / Gemini / DeepSeek…)',
    chatHost: 'openrouter.ai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    method: 'POST',
    authScheme: 'bearer',
    authHeader: 'Authorization',
    extraHeaders: {},
    defaultModel: 'x-ai/grok-4',
    models: [],
    openModel: true,
    maxTokens: 8192,
    responsePath: ['choices', 0, 'message', 'content'],
    keyHint: 'sk-or-…',
    keyUrl: 'https://openrouter.ai/keys',
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    body: { style: 'openai-chat', systemField: 'system-message' }
  },
  // A model running on the owner's own machine (LM Studio, Ollama, vLLM,
  // llama.cpp — they all expose the OpenAI chat-completions shape). No key
  // required and none charged; nothing leaves the machine. `endpoint` is a
  // DEFAULT: the real one comes from the user's baseUrl setting and must
  // resolve to loopback (see resolveLocalEndpoint).
  // The owner's local model reached THROUGH THEIR BROWSER (extension-v2a).
  // For a HOSTED CMS: the server compiles each model request and hands it to
  // the page as a continuation; the Bridge V2 extension relays it to LM
  // Studio on the owner's machine and posts the reply back. The server never
  // fetches anything for this provider (endpoint empty on purpose) and no
  // key exists anywhere in the path.
  browser: {
    id: 'browser',
    label: 'מקומי — דרך הדפדפן (Bridge V2)',
    chatHost: '',
    endpoint: '',
    method: 'POST',
    authScheme: 'bearer',
    authHeader: 'Authorization',
    extraHeaders: {},
    // '' = the page substitutes whatever model the bridge reports as loaded.
    defaultModel: '',
    models: [],
    openModel: true,
    keyOptional: true,
    browserRelay: true,
    maxTokens: 4096,
    responsePath: ['choices', 0, 'message', 'content'],
    keyHint: 'לא נדרש — המודל רץ אצלכם',
    keyUrl: '',
    body: { style: 'openai-chat', systemField: 'system-message' }
  },
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
    // ADVISORY (v2.28): the context window the owner's runtime is assumed to
    // be loaded with (LM Studio's default for qwen3.6-35b-a3b). Nothing is
    // sent with it — ai.contextBudget() derives the runner's PACK_TOO_BIG
    // gate from it (this number minus ai.js's 4K headroom for the chat
    // template = 20K), because a pack that overflows the window comes back
    // truncated, not refused.
    contextTokens: 24000,
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
// One entry per provider in the table above, and NOTHING else. The set is
// written out by hand rather than derived from PROVIDERS on purpose: a
// provider descriptor is data, and data is the thing an attacker who reached
// the CMS would edit. A key may only go to a host that is on this literal
// line, which means widening the blast radius is a code change and a review.
const ALLOWED_API_HOSTS = new Set([
  'api.anthropic.com',
  'api.openai.com',
  'api.x.ai',
  'openrouter.ai',
  'generativelanguage.googleapis.com'
]);

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
