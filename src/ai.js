'use strict';

/**
 * Tier-1 AI: the key lives in the CMS (v0.85 — Ben's tier realignment).
 *
 * The v0.73 experiment put the user's LLM key in the browser extension; Ben's
 * corrected model: key-based chat is a CMS feature (the customer's own key,
 * used server-side against the provider's OFFICIAL API — third-party use the
 * providers sanction). The extension is the KEYLESS tier (BYOT inject/paste).
 *
 * Security model (ports the v0.73 llm.js boundary, now server-owned):
 *  - the key is stored in gitignored config/ai.json (the auth.json pattern),
 *    never in site.json, never echoed by any API (hasKey + tail only)
 *  - the set of hosts allowed to receive the key is HARDCODED here; provider
 *    descriptors (src/providers.js) supply shapes, never new destinations
 *  - the key is used only as the provider auth header; never logged
 */

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');
// Endpoint policy lives in providers.js — ONE implementation, so the server
// and the /agent/v1/providers table can never disagree about what is allowed.
const {
  getProvider, listProviders, endpointAllowed, resolveLocalEndpoint, ALLOWED_API_HOSTS
} = require('./providers');
// The window (v2.32): what the runtime actually loaded, the tier that fits
// it, the Hebrew that explains it — one module, so the copilot route, the
// setup screen and the tool loop can never disagree about the numbers.
const win = require('./ai-window');

const STORE_PATH = path.join(CONFIG_DIR, 'ai.json');

// ── settings store ──────────────────────────────────────────────────────

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (data && typeof data === 'object') return data;
    }
  } catch (e) { /* fall through */ }
  return { provider: 'claude', model: '', apiKey: '', baseUrl: '' };
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

/** Public settings — NEVER includes the key itself. */
function getSettings() {
  const s = load();
  const key = String(s.apiKey || '');
  return {
    provider: s.provider || 'claude',
    model: s.model || '',
    baseUrl: s.baseUrl || '',
    hasKey: !!key,
    keyTail: key ? key.slice(-4) : ''
  };
}

/**
 * @param {{ provider?, model?, apiKey?, baseUrl? }} patch
 *  apiKey: undefined = keep current; '' = clear; value = replace.
 *  baseUrl: the local runtime's address — REJECTED here if it is not loopback,
 *  so a non-local address can never be stored, let alone called.
 */
function saveSettings(patch = {}) {
  const s = load();
  if (patch.provider !== undefined) {
    if (!getProvider(patch.provider)) throw new Error('ספק לא מוכר: ' + patch.provider);
    s.provider = patch.provider;
  }
  if (patch.model !== undefined) s.model = String(patch.model || '');
  if (patch.apiKey !== undefined) s.apiKey = String(patch.apiKey || '').trim();
  if (patch.baseUrl !== undefined) {
    const raw = String(patch.baseUrl || '').trim();
    if (raw && !resolveLocalEndpoint(raw)) {
      throw new Error('כתובת המודל המקומי חייבת להצביע על המחשב הזה (127.0.0.1 / localhost)');
    }
    s.baseUrl = raw;
  }
  save(s);
  return getSettings();
}

// ── the provider call (server-side; ports extension/llm.js v0.73) ───────

function dig(obj, pathArr) {
  let cur = obj;
  for (const k of pathArr) {
    if (cur == null) return '';
    cur = cur[k];
  }
  return typeof cur === 'string' ? cur : '';
}

// A local model on a shared GPU can take minutes over a 44K-char pack; the
// public providers answer in seconds. Node's fetch() kills any request whose
// headers have not arrived in 300s (undici's default, not configurable
// without the package) — an owner's first injection through LM Studio died
// exactly there with "fetch failed" (v2.28, seen live). So the provider call
// is a plain http(s) request with ONE explicit ceiling per provider kind.
const LOCAL_TIMEOUT_MS = 20 * 60 * 1000;
const PUBLIC_TIMEOUT_MS = 4 * 60 * 1000;
// the test seam: a smoke that swaps global.fetch for a scripted provider
// (smoke-copilot-tools) keeps driving the pipeline through it
const NATIVE_FETCH = globalThis.fetch;

// ── error codes + budget helpers (v2.28, the injection runner) ──────────
// A runner has to tell a missing key from a slow model from a provider
// outage — each opens a different door in the card (link to the setup
// screen / hide the run button / fall back to copy-the-prompt) — so every
// failure out of generateDetailed carries a machine code beside its Hebrew
// message. The message stays what the copilot always said; only the code is
// new.
// v2.32 appends the window's own failures (append-only — smoke-byok pins the
// list): WINDOW_TOO_SMALL (compact does not fit either), BRIDGE_TOO_OLD (a
// 0.4.0 bridge relayed a bodiless 400), BRIDGE_DROPPED_TOOLS (the stream
// accumulator lost the tool call), REPLY_CUT (a document hit max_tokens).
// v2.35 appends NO_BRIEFING: the tool loop refused to send a local model a
// request with no BenTML briefing in it (a 31B model with no briefing
// invents a ```bentml dialect with zero bent-* tags — measured, C1).
const ERROR_CODES = [
  'NO_PROVIDER', 'BROWSER_RELAY', 'NETWORK', 'TIMEOUT', 'PROVIDER_ERROR', 'EMPTY_REPLY',
  'WINDOW_TOO_SMALL', 'BRIDGE_TOO_OLD', 'BRIDGE_DROPPED_TOOLS', 'REPLY_CUT', 'NO_BRIEFING'
];

function coded(message, code, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

/** Chars → tokens for a Hebrew-heavy pack. Measured on the live probe:
 *  3,651 chars of organizer prompt → 1,580 prompt tokens, i.e. ~2.3 chars
 *  per token — Hebrew tokenizes far denser than the 4-chars-per-token
 *  English rule of thumb, which would under-count by half. */
function estimateTokens(chars) {
  return Math.ceil(Math.max(0, Number(chars) || 0) / 2.3);
}

// what the chat template + the runtime's own framing take out of the local
// window before the pack and the answer get their share
const CONTEXT_HEADROOM_TOKENS = 4000;

/** How many tokens one whole call (pack + answer) may occupy. Derived from
 *  the local provider's advisory `contextTokens` (providers.js — 24K, LM
 *  Studio's default) minus the headroom, so the two can never disagree:
 *  24000 − 4000 = 20000. The public providers are effectively unbounded
 *  next to a 14K-char pack. */
function contextBudget(providerId) {
  // 'browser' is the SAME local runtime, reached through the owner's browser
  // instead of the server's socket — so it gets the same window, not Infinity.
  if (providerId !== 'local' && providerId !== 'browser') return Infinity;
  // v2.32: once the runtime has told us its window (probe / the page's hint /
  // the 400's n_ctx) that number replaces the advisory — a Gemma loaded at
  // 8,192 must not be sent a 20K-token pack on the strength of a table entry
  const known = win.knownWindowFor(providerId);
  if (known && Number.isFinite(known.tokens) && known.tokens > 0) return known.tokens - CONTEXT_HEADROOM_TOKENS;
  const p = getProvider('local');
  return ((p && Number(p.contextTokens)) || 24000) - CONTEXT_HEADROOM_TOKENS;
}

/** The provider's own token accounting, mapped to one shape. openai-chat
 *  already speaks it (LM Studio adds completion_tokens_details.reasoning_tokens
 *  for hybrid-thinking models); anthropic says input/output. */
function readUsage(style, data) {
  const u = (data && typeof data === 'object' && data.usage && typeof data.usage === 'object') ? data.usage : null;
  if (!u) return { prompt_tokens: 0, completion_tokens: 0 };
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  if (style === 'openai-chat') {
    const out = { prompt_tokens: num(u.prompt_tokens), completion_tokens: num(u.completion_tokens) };
    const details = u.completion_tokens_details;
    if (details && details.reasoning_tokens != null) out.reasoning_tokens = num(details.reasoning_tokens);
    return out;
  }
  return { prompt_tokens: num(u.input_tokens), completion_tokens: num(u.output_tokens) };
}

/**
 * POST a JSON body and read a JSON reply — no header timeout, one overall
 * ceiling. Resolves { status, data } (data null when the body is not JSON);
 * rejects on network failure or when the ceiling passes.
 */
async function postJson(endpoint, headers, body, timeoutMs) {
  if (typeof globalThis.fetch === 'function' && globalThis.fetch !== NATIVE_FETCH) {
    const res = await globalThis.fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-json */ }
    return { status: res.ok ? 200 : (res.status || 500), data, text: '' };
  }
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(endpoint); } catch (e) { return reject(new Error('כתובת ספק לא תקינה')); }
    const mod = url.protocol === 'https:' ? require('https') : require('http');
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = mod.request(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': payload.length, Accept: 'application/json' }
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch (e) { /* non-json */ }
        resolve({ status: res.statusCode || 0, data, text });
      });
      res.on('error', reject);
    });
    const ceiling = Math.max(10000, Number(timeoutMs) || PUBLIC_TIMEOUT_MS);
    req.setTimeout(ceiling, () => {
      // the code rides the rejection so the runner can answer 504, not 502
      req.destroy(coded('המודל לא ענה תוך ' + Math.round(ceiling / 60000) + ' דקות — ' +
        'בדקו שהמודל טעון ושאין משהו אחר שתופס את ה-GPU (משחק, דפדפן), או קצרו את הבקשה', 'TIMEOUT'));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * Build headers+body for a provider descriptor. `history` is an optional
 * array of prior turns [{role: 'user'|'assistant', content}] so the chat
 * remembers itself; the system prompt always rides separately.
 */
function buildRequest(provider, key, system, userText, model, history = [], turnCap = 12000) {
  const headers = { 'Content-Type': 'application/json' };
  // A local runtime usually wants no credential at all — sending an empty
  // "Bearer " trips some of them, so omit the header entirely when there is
  // nothing to send and the provider says a key is optional.
  if (key || !provider.keyOptional) {
    if (provider.authScheme === 'bearer') {
      headers[provider.authHeader || 'Authorization'] = 'Bearer ' + key;
    } else {
      headers[provider.authHeader || 'x-api-key'] = key;
    }
  }
  Object.assign(headers, provider.extraHeaders || {});

  const mdl = model || provider.defaultModel;
  const maxTokens = provider.maxTokens || 4096;
  // 12000 chars per remembered turn is the chat's cap; the injection runner's
  // repair round raises it (turnCap) so the whole pack and the whole first
  // reply ride along — a truncated pack would repair against half the rules
  const cap = Math.max(1, Number(turnCap) || 12000);
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && t.content)
    .slice(-12)
    .map((t) => ({ role: t.role, content: String(t.content).slice(0, cap) }));

  let body;
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  if (style === 'openai-chat') {
    body = {
      model: mdl,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...turns, { role: 'user', content: userText }]
    };
    // Local runtimes default many models (Qwen3.*) to hybrid THINKING — the
    // copilot then burns its whole budget on reasoning and returns an empty
    // content field. LM Studio honors this switch; servers that don't know
    // it ignore the extra key. (Found live against qwen3.6-35b-a3b, v2.17.)
    if (provider.id === 'local' || provider.browserRelay) body.reasoning_effort = 'none';
  } else {
    body = {
      model: mdl,
      max_tokens: maxTokens,
      system,
      messages: [...turns, { role: 'user', content: userText }]
    };
  }
  return { headers, body };
}

/**
 * One turn against the configured provider, with the stored key — the full
 * account of it (v2.28): the text, the provider's own token usage, the wall
 * time and which model answered. The injection runner logs these per call;
 * everything else in the CMS still wants just the string (generate, below).
 *
 * Every rejection carries `.code` from ERROR_CODES (NO_PROVIDER, BROWSER_RELAY,
 * NETWORK, TIMEOUT, PROVIDER_ERROR with .status/.providerMessage, EMPTY_REPLY).
 * The request body is byte-identical to what generate() always sent — the
 * shape is pinned by smoke-byok / smoke-local-llm / smoke-copilot-tools.
 * @returns {Promise<{text: string, usage: {prompt_tokens: number, completion_tokens: number, reasoning_tokens?: number}, ms: number, provider: {id: string, model: string}}>}
 */
async function generateDetailed({ system = '', user = '', history = [], maxTokens = 0, timeoutMs = 0, turnCap = 0 } = {}) {
  const opts = { maxTokens, timeoutMs };
  const started = Date.now();
  const s = load();
  const key = String(s.apiKey || '');
  const provider = getProvider(s.provider || 'claude');
  // The browser-relay provider exists only where a browser does: the owner's
  // copilot (converse via /admin/api/ai/chat). Server-initiated generation —
  // the visitor CS chat, agents, the injection runner — has no bridge to
  // relay through.
  if (provider && provider.browserRelay) {
    throw coded('הספק "דרך הדפדפן" משרת רק את קופיילוט הבעלים — לצ׳אט האתר נדרש ספק עם מפתח (או מודל מקומי של השרת עצמו)', 'BROWSER_RELAY');
  }
  if (!provider || !provider.endpoint) throw coded('ספק לא מוגדר', 'NO_PROVIDER');
  // A local runtime serves without credentials; a public one never does.
  if (!key && !provider.keyOptional) {
    throw coded('לא הוגדר מפתח API — הגדירו אותו בצ׳אט (ההגדרות בצד)', 'NO_PROVIDER');
  }

  // For the local provider the address is the user's own — resolved (and
  // re-checked for loopback) per call, never frozen in the table. A refused
  // address is a configuration gap, so it opens the same door as a missing
  // key: the setup screen.
  let endpoint = provider.endpoint;
  if (provider.id === 'local') {
    endpoint = resolveLocalEndpoint(s.baseUrl);
    if (!endpoint) {
      throw coded('כתובת המודל המקומי חייבת להיות מקומית (127.0.0.1 / localhost) — נדחתה', 'NO_PROVIDER');
    }
  }
  if (!endpointAllowed(endpoint)) {
    throw coded('כתובת הספק אינה ברשימת ההיתר של השרת — מסרב לשלוח את המפתח', 'NO_PROVIDER');
  }

  // A local runtime serves whatever model it has loaded, so any name is valid;
  // a public provider is held to the list we ship.
  const model = provider.openModel
    ? (String(s.model || '').trim() || provider.defaultModel)
    : ((provider.models || []).includes(s.model) ? s.model : provider.defaultModel);
  const { headers, body } = buildRequest(provider, key, system, user, model, history, turnCap > 0 ? turnCap : undefined);
  // an injection runner may ask for a longer answer than the table's default
  if (Number(opts.maxTokens) > 0) body.max_tokens = Math.min(32768, Math.round(Number(opts.maxTokens)));

  let res;
  try {
    res = await postJson(endpoint, headers, body, opts.timeoutMs || (provider.id === 'local' ? LOCAL_TIMEOUT_MS : PUBLIC_TIMEOUT_MS));
  } catch (e) {
    // the ceiling passing is its own failure (504 in the runner); anything
    // else is the wire
    if (e && e.code === 'TIMEOUT') throw e;
    if (provider.id === 'local') {
      throw coded('לא הצלחתי להתחבר למודל המקומי ב-' + endpoint +
        ' — ודאו ש-LM Studio (או Ollama) רץ ושהשרת המקומי דולק. פרטים: ' + e.message, 'NETWORK');
    }
    throw coded('קריאה לספק נכשלה (רשת): ' + e.message, 'NETWORK');
  }
  const data = res.data;
  if (res.status < 200 || res.status >= 300) {
    const msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + res.status);
    throw coded('שגיאת ספק: ' + msg, 'PROVIDER_ERROR', { status: res.status, providerMessage: String(msg) });
  }
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  const text = dig(data, provider.responsePath || ['content', 0, 'text']);
  if (!text) throw coded('הספק החזיר תשובה ריקה', 'EMPTY_REPLY');
  return {
    text,
    usage: readUsage(style, data),
    ms: Date.now() - started,
    provider: { id: provider.id, model }
  };
}

/**
 * One turn against the configured provider, with the stored key.
 * @returns {Promise<string>} the assistant's raw text
 */
async function generate(opts = {}) {
  return (await generateDetailed(opts)).text;
}

// ── one-shot generation over the browser relay (v2.29) ──────────────────
//
// generateDetailed() FETCHES. On a hosted CMS with the 'browser' provider
// there is nothing to fetch: the model runs on the owner's own machine and
// only their browser can reach it (LM Studio serves no CORS headers at all,
// so the page cannot call it either — the extension's background worker is
// the one context that may). The same turn therefore splits in two halves,
// and the caller drives the page between them:
//
//   relayRequest(...)      → the body the page hands to the bridge, verbatim
//   readRelayReply(result) → exactly what generateDetailed would have resolved
//
// The bytes are the ones buildRequest() always produced, so a pack that runs
// through a server-side local model and the same pack relayed through the
// browser are the same request — only the courier differs.

/** Is the configured provider the browser relay? */
function isRelayProvider() {
  const p = getProvider(load().provider || 'claude');
  return !!(p && p.browserRelay);
}

/**
 * The request the page relays verbatim. No key is attached — none exists on
 * this path. An empty model name means "whatever the bridge reports loaded".
 * @returns {{ body: object, provider: {id: string, model: string} }}
 */
function relayRequest({ system = '', user = '', history = [], maxTokens = 0, turnCap = 0 } = {}) {
  const s = load();
  const provider = getProvider(s.provider || 'claude');
  if (!provider || !provider.browserRelay) {
    throw coded('הספק הנוכחי אינו "דרך הדפדפן" — אין מה להעביר', 'NO_PROVIDER');
  }
  const model = String(s.model || '').trim();
  const { body } = buildRequest(provider, '', system, user, model, history, turnCap > 0 ? turnCap : undefined);
  if (Number(maxTokens) > 0) body.max_tokens = Math.min(32768, Math.round(Number(maxTokens)));
  return { body, provider: { id: provider.id, model } };
}

/**
 * The raw provider JSON the page brought back → the generateDetailed shape.
 * Trusting it is a DECISION, not an oversight: the sender is the authenticated
 * owner (admin session + Origin gate), the fabricated-reply risk is identical
 * to pasting a reply by hand at /admin/ai, and every write still stops at the
 * door's approval gate regardless of what the "model" said.
 * @param {object} result raw body from the local runtime
 * @param {{ms?: number, model?: string}} meta
 */
function readRelayReply(result, meta = {}) {
  const provider = getProvider('browser');
  const style = (provider.body && provider.body.style) || 'openai-chat';
  const data = result && typeof result === 'object' ? result : null;
  if (!data) throw coded('הדפדפן לא החזיר תשובה מהמודל', 'EMPTY_REPLY');
  // a local runtime reports its own failures in the body it hands back
  if (data.error) {
    const msg = (data.error && (data.error.message || data.error)) || 'שגיאה לא ידועה';
    throw coded('שגיאת המודל המקומי: ' + String(msg), 'PROVIDER_ERROR', { providerMessage: String(msg) });
  }
  const text = dig(data, provider.responsePath || ['choices', 0, 'message', 'content']);
  if (!text) throw coded('המודל המקומי החזיר תשובה ריקה', 'EMPTY_REPLY');
  return {
    text,
    usage: readUsage(style, data),
    ms: Number(meta.ms) || 0,
    provider: { id: 'browser', model: String(meta.model || load().model || '') }
  };
}

// ── the tool loop ───────────────────────────────────────────────────────
//
// One turn can take several round-trips: the model asks to look at something,
// we answer, it asks again, and eventually it either replies in words or asks
// to WRITE. A write is where the loop stops dead and hands control back to the
// owner — see ai-tools.js for why that line is drawn there.
//
// The conversation state stays on the SERVER between the proposal and the
// approval (pendings, below). The browser only ever holds an opaque id, so a
// page that gets tampered with cannot rewrite what the model was asked to do.
//
// v2.32 — the window. The loop now plans every request against the window
// the runtime ACTUALLY loaded (src/ai-window.js: probe → hint → the 400's
// numbers → advisory), picks the briefing tier that fits, and judges every
// reply before trusting it: an exceed body teaches the window and shrinks;
// a 200 whose usage.prompt_tokens is above the window PROVES LM Studio
// answered from a halved prompt (the silent band n_ctx ≤ n_prompt < 2·n_ctx)
// and is discarded; a 'tool_calls' finish with no calls is the 0.4.0 bridge
// losing them. The shrink-and-retry lives HERE so both couriers share it:
// the server-side call and the browser step feed the same judgement.

const MAX_TOOL_HOPS = 6;          // a model that needs more is looping
const MAX_SHRINKS = 3;            // full → compact → recalibrated compact, then stop
const PENDING_TTL_MS = 10 * 60 * 1000;
const pendings = new Map();

function putPending(state) {
  const id = 'pend_' + require('crypto').randomBytes(12).toString('hex');
  pendings.set(id, { ...state, at: Date.now() });
  // opportunistic sweep — this map must never become a memory leak
  for (const [k, v] of pendings) if (Date.now() - v.at > PENDING_TTL_MS) pendings.delete(k);
  return id;
}
function takePending(id) {
  const s = pendings.get(String(id || ''));
  if (!s) return null;
  pendings.delete(id);
  if (Date.now() - s.at > PENDING_TTL_MS) return null;
  return s;
}

// ── browser-relay continuations (the 'browser' provider, extension-v2a) ──
//
// On a HOSTED CMS the server cannot reach the owner's LM Studio — but the
// owner's BROWSER can, through the Bridge V2 extension. So for this provider
// the tool loop pauses at every model call: the composed request body goes to
// the page as { modelCall: { id, body } }, the page relays it via the bridge,
// and posts the raw provider JSON back as { step: { id, result } }. Same
// server-held-state pattern as pendings: the browser only ever carries an
// opaque id and the model's own output. Every retry stores a NEW step (fresh
// `at`), so a slow 31B never runs into the TTL mid-sequence.
//
// Trusting the returned output is a DECISION, not an oversight: the sender is
// the authenticated owner (admin session + Origin gate), the fabricated-reply
// risk is identical to the paste tier (/admin/ai), and every write still stops
// at the approval gate regardless of what the "model" said.
const steps = new Map();

function putStep(state) {
  const id = 'step_' + require('crypto').randomBytes(12).toString('hex');
  steps.set(id, { ...state, at: Date.now() });
  for (const [k, v] of steps) if (Date.now() - v.at > PENDING_TTL_MS) steps.delete(k);
  return id;
}
function takeStep(id) {
  const s = steps.get(String(id || ''));
  if (!s) return null;
  steps.delete(id);
  if (Date.now() - s.at > PENDING_TTL_MS) return null;
  return s;
}

/** The model name a request carries: a local runtime serves whatever it has
 *  loaded, so any name is valid ('' over the bridge = the page substitutes
 *  what the bridge reports); a public provider is held to the list we ship. */
function modelFor(provider, s) {
  if (provider.browserRelay) return String(s.model || '').trim();
  return provider.openModel
    ? (String(s.model || '').trim() || provider.defaultModel)
    : ((provider.models || []).includes(s.model) ? s.model : provider.defaultModel);
}

/**
 * ONE body for both couriers (v2.32; replaces buildRelayBody and the inline
 * body of the server call). openai-chat shape for local/browser/openai,
 * anthropic-messages for claude. `maxTokens` is the reply reserve the window
 * arithmetic chose — a quarter of the window, 1,024..4,096.
 */
function composeBody(provider, s, system, turns, toolDefs, maxTokens) {
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  const model = modelFor(provider, s);
  const max = Math.max(1, Math.round(Number(maxTokens) || provider.maxTokens || 4096));
  const body = style === 'openai-chat'
    ? { model, max_tokens: max, messages: [{ role: 'system', content: system }, ...turns] }
    : { model, max_tokens: max, system, messages: turns };
  if (style === 'openai-chat' && (provider.id === 'local' || provider.browserRelay)) {
    body.reasoning_effort = 'none'; // hybrid-thinking models must ANSWER (see buildRequest)
  }
  if (toolDefs && toolDefs.length) body.tools = toolDefs;
  return body;
}

/**
 * A tool call the model wrote INTO its text instead of the tool_calls field
 * (small local models do this; some chat templates strip the field). Only
 * when the WHOLE trimmed content is one call — a `<tool_call>{…}</tool_call>`
 * block, one fenced JSON object, or one bare JSON object naming one of our
 * tools. Prose around a fence is prose; an unknown name is prose.
 */
function embeddedCall(text, hop, toolNames) {
  const s = String(text || '').trim();
  if (!s) return null;
  let inner = null;
  let m = /^<tool_call>\s*([\s\S]*?)\s*<\/tool_call>$/.exec(s);
  if (m) inner = m[1];
  else if ((m = /^```[a-z_]*\s*\n?([\s\S]*?)\n?\s*```$/i.exec(s))) inner = m[1];
  else if (s[0] === '{' && s[s.length - 1] === '}') inner = s;
  if (!inner) return null;
  let obj;
  try { obj = JSON.parse(inner.trim()); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const name = String(obj.name || '');
  if (!toolNames.includes(name)) return null;
  let args = obj.arguments !== undefined ? obj.arguments : obj.parameters;
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
  return { id: 'emb_' + hop, name, input: args };
}

/**
 * Pull tool calls + text out of either provider's reply shape — and read the
 * finish reason, because it is evidence:
 *   'tool_calls' with no calls  = the 0.4.0 bridge dropped them (dropped:true)
 *   'length'                    = the reply hit max_tokens
 * A non-streaming LM Studio reply carries `tool_calls: []` (empty, not
 * absent) beside `reasoning_content` — that is "no calls", not an error.
 */
function readReply(style, data, opts = {}) {
  const toolNames = Array.isArray(opts.toolNames) ? opts.toolNames : [];
  if (style === 'openai-chat') {
    const choice = (((data || {}).choices) || [])[0] || {};
    const m = choice.message || {};
    const finish = String(choice.finish_reason || '');
    let calls = (Array.isArray(m.tool_calls) ? m.tool_calls : []).map((c) => {
      let input = {};
      try { input = JSON.parse((c.function && c.function.arguments) || '{}'); } catch (e) { /* malformed */ }
      return { id: c.id, name: (c.function || {}).name, input };
    });
    let text = typeof m.content === 'string' ? m.content : '';
    let raw = m;
    let dropped = false;
    if (!calls.length) {
      const emb = embeddedCall(text, opts.hop || 0, toolNames);
      if (emb) {
        calls = [emb];
        text = '';
        raw = {
          role: 'assistant', content: null,
          tool_calls: [{ id: emb.id, type: 'function', function: { name: emb.name, arguments: JSON.stringify(emb.input) } }]
        };
      } else if (finish === 'tool_calls') {
        dropped = true;
      }
    }
    return { text, calls, raw, finish, dropped };
  }
  const content = ((data || {}).content) || [];
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const calls = content.filter((c) => c.type === 'tool_use')
    .map((c) => ({ id: c.id, name: c.name, input: c.input || {} }));
  const stop = String((data || {}).stop_reason || '');
  const finish = stop === 'max_tokens' ? 'length' : (stop === 'tool_use' ? 'tool_calls' : stop);
  return { text, calls, raw: content, finish, dropped: stop === 'tool_use' && !calls.length };
}

/** Append the assistant turn + our tool answers, in the provider's shape.
 *  EVERY call id in the assistant turn gets an answer — a call left
 *  unanswered is rejected by both APIs on the next request. */
function appendToolTurn(style, turns, reply, results) {
  if (style === 'openai-chat') {
    turns.push({ role: 'assistant', content: reply.raw.content || null, tool_calls: reply.raw.tool_calls });
    results.forEach((r) => turns.push({
      role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.output)
    }));
    return turns;
  }
  turns.push({ role: 'assistant', content: reply.raw });
  turns.push({
    role: 'user',
    content: results.map((r) => ({
      type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.output), is_error: !!r.isError
    }))
  });
  return turns;
}

/** A cloud key has no window we could overflow next to a 45K briefing. */
function isCloudProvider(provider) {
  return provider.id !== 'local' && !provider.browserRelay;
}

/** The page's window hint (browser courier): integers 1024..1048576 or nothing. */
function validHint(h) {
  if (!h || typeof h !== 'object') return null;
  const t = Number(h.tokens);
  if (!Number.isInteger(t) || t < 1024 || t > 1048576) return null;
  const m = Number(h.maxTokens);
  return {
    tokens: t,
    maxTokens: Number.isInteger(m) && m >= t ? m : null,
    model: String(h.model || '').slice(0, 200),
    bridgeVersion: String(h.bridgeVersion || '').slice(0, 20)
  };
}

/**
 * Window discovery for one provider+model, in order of trust (ai-window.js):
 * a page hint is noted (browser courier); a server-side local provider is
 * probed (cached a minute); a cloud key is unbounded. Returns the cache key.
 */
async function discoverWindow(provider, s, model, hint) {
  const key = win.windowKey(provider.id, model);
  const h = validHint(hint);
  if (h) {
    win.noteWindow(key, h.tokens, 'hint', { maxTokens: h.maxTokens, model: h.model, bridgeVersion: h.bridgeVersion });
  } else if (provider.browserRelay) {
    // the page is the authority for its own hint — when it sends none the
    // bridge is old or the probe failed, so a stale number must not linger
    win.forgetWindow(key, 'hint');
  }
  if (provider.id === 'local') {
    const g = win.getWindow(key);
    if (!(g.source === 'probe' && g.fresh)) {
      const r = await win.probeLocalWindow(s.baseUrl, model);
      if (r) win.noteWindow(key, r.tokens, 'probe', { maxTokens: r.maxTokens, model: r.model, jit: !!r.jit, loaded: r.loaded });
    }
  }
  return key;
}

/** What the planner works with: the known window, else the cloud's
 *  infinity, else the ADVISORY number (used only to size the compact tier's
 *  history — it can never promote to full). */
function windowFor(provider, key) {
  const g = win.getWindow(key);
  if (g.tokens) return { ...g, known: true };
  if (isCloudProvider(provider)) return { ...g, tokens: Infinity, source: 'cloud', known: false };
  const p = getProvider('local');
  return { ...g, tokens: ((p && Number(p.contextTokens)) || 24000), source: 'advisory', known: false };
}

/**
 * A turn that may use tools.
 * @param {{ system?, systemFor?, user?, history?, approve?, step?, window?, context? }} args
 *  system: the briefing as one string (legacy — one tier), OR
 *  systemFor: (tier: 'full'|'compact') => string — the route passes this so
 *    the loop can shrink the briefing when the window says so.
 *  step: { id, result } — a browser-relay continuation: `result` is the raw
 *    provider JSON the bridge got from the local model for modelCall `id`.
 *  window: the page's hint { tokens, maxTokens, model, source:'bridge', bridgeVersion }.
 * @returns {Promise<{reply: string, memo: string, pending: object|null,
 *   modelCall: {id, body}|null, applied: object|null, used: string[],
 *   reads: string[], window: object, notice: string, truncated: boolean}>}
 *  Rejections carry `.code` ∈ ERROR_CODES and, when there is a click path,
 *  `.fix` (a second Hebrew line).
 */
async function converse({ system = '', systemFor = null, user = '', history = [], approve = null, step = null, window: hint = null } = {}) {
  const tools = require('./ai-tools');
  const s = load();
  const provider = getProvider(s.provider || 'claude');
  if (!provider) throw coded('ספק לא מוגדר', 'NO_PROVIDER');
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  const toolDefs = tools.toolsForProvider(style);
  const toolNames = tools.TOOLS.map((t) => t.name);
  const toolsChars = JSON.stringify(toolDefs).length;
  const local = provider.id === 'local' || !!provider.browserRelay;
  const errPrefix = local ? 'שגיאת המודל המקומי: ' : 'שגיאת ספק: ';

  // ── the turn's state (carried across relay steps and approvals) ──
  let st;
  let incoming = null; // model output handed back by the page (browser relay)
  if (step && step.id) {
    st = takeStep(step.id);
    if (!st) throw new Error('הצעד פג — שלחו את ההודעה שוב');
    incoming = step.result && typeof step.result === 'object' ? step.result : null;
    if (!incoming) throw new Error('צעד ללא תוצאת מודל');
  } else if (approve && approve.id) {
    const pend = takePending(approve.id);
    if (!pend) throw new Error('הבקשה פגה — בקשו מהקופיילוט לנסות שוב');
    st = pend.st;
    const write = pend.call;
    const summary = tools.describeCall(write.name, write.input);
    let output;
    let isError = false;
    if (!approve.ok) {
      // Refusal is information: tell the model so it can offer something else
      // instead of silently repeating the same proposal.
      output = { refused: true, reason: 'בעל/ת האתר דחה/תה את הפעולה' };
      isError = true;
      st.memo = win.HE.memoRefused(summary);
    } else {
      try {
        output = tools.getTool(write.name).run(write.input);
        st.used.push(write.name);
        st.applied = {
          tool: write.name,
          slug: output.slug,
          title: output.title,
          ...(output.created ? { created: true } : {}),
          ...(output.edited ? { edited: true } : {}),
          warnings: Array.isArray(output.warnings) ? output.warnings : [],
          moduleCount: Number(output.moduleCount) || 0
        };
        st.memo = (output.created ? win.HE.memoCreated(output.slug) : win.HE.memoEdited(output.slug)) +
          (st.applied.warnings.length ? win.HE.memoWarnings(st.applied.warnings.length) : '');
      } catch (e) {
        output = { error: e.message };
        isError = true;
        st.memo = 'הפעולה נכשלה: ' + e.message;
      }
    }
    // the other calls of that batch were answered when the proposal was
    // stored; the write's answer completes the unit
    st.extra = appendToolTurn(style, st.extra, pend.reply, [...pend.others, { id: write.id, output, isError }]);
    st.hop++;
  } else {
    const sysFor = typeof systemFor === 'function' ? systemFor : (() => String(system || ''));
    const model = modelFor(provider, s);
    const key = await discoverWindow(provider, s, model, hint);
    const text = String(user);
    st = {
      systemFor: sysFor,
      sizes: null,           // measured lazily (each tier once)
      sysCache: {},
      key,
      model,
      tier: '',
      base: [],              // history + the current message (fitted per plan)
      extra: [],             // this turn's tool units (appended as they happen)
      userChars: text.length,
      used: [],
      reads: [],
      hop: 0,
      shrinks: 0,
      blind: 0,
      truncRetries: 0,
      forceCompact: false,
      notice: '',
      memo: '',
      applied: null,
      sentChars: 0,
      estPromptTokens: 0,
      lastPromptTokens: 0,
      lastFail: null,
      bridgeVersion: (validHint(hint) || {}).bridgeVersion || ''
    };
    st.base = (Array.isArray(history) ? history : []).slice(-40)
      .filter((t) => t && (t.role === 'user' || t.role === 'assistant'));
    st.base.push({ role: 'user', content: text });
  }

  const systemText = (tier) => {
    if (st.sysCache[tier] === undefined) st.sysCache[tier] = String(st.systemFor(tier) || '');
    return st.sysCache[tier];
  };
  const sizes = () => {
    if (!st.sizes) st.sizes = { full: systemText('full').length, compact: systemText('compact').length };
    return st.sizes;
  };

  const tooSmall = (nPrompt, nCtx) =>
    coded(win.HE.tooSmall(nPrompt, nCtx), 'WINDOW_TOO_SMALL', { fix: win.HE.fixWindow, nPrompt, nCtx });

  /** Plan the next request against the window as known right now. */
  const plan = () => {
    const w = windowFor(provider, st.key);
    const source = st.forceCompact && w.source !== 'cloud' ? 'advisory' : w.source;
    const fixedChars = toolsChars + st.userChars;
    const pt = win.pickTier({ tokens: w.tokens, source, ratio: w.ratio, sizes: sizes(), fixedChars });
    if (!pt.tier) {
      if (st.lastFail) throw tooSmall(st.lastFail.nPrompt, st.lastFail.nCtx);
      throw tooSmall(pt.promptTokens + win.replyReserve(w.tokens) + win.TEMPLATE_HEADROOM_TOKENS, w.tokens);
    }
    const sys = systemText(pt.tier);
    // The tool loop exists to build BenTML pages; a request that leaves for
    // a LOCAL model without the briefing is a bug upstream, never a call to
    // make — without it the model answers in an invented dialect (C1: zero
    // bent-* tags), and over the bridge it would burn minutes of GPU first.
    if (local && !/<bent-|bent-\*/.test(sys)) {
      throw coded('הבקשה למודל יצאה בלי תדריך BenTML — זו תקלה במערכת, לא במודל; נסו לרענן את הדף', 'NO_BRIEFING');
    }
    const extraChars = win.turnsChars(st.extra);
    const turns = win.fitTurns(st.base, pt.roomChars === Infinity ? Infinity : pt.roomChars - extraChars).concat(st.extra);
    const maxTokens = w.tokens === Infinity ? Math.max(4096, provider.maxTokens || 4096) : win.replyReserve(w.tokens);
    const body = composeBody(provider, s, sys, turns, toolDefs, maxTokens);
    const tChars = win.turnsChars(turns);
    return {
      tier: pt.tier,
      body,
      sentChars: sys.length + tChars + toolsChars,
      estPromptTokens: Math.ceil((sys.length + tChars + toolsChars) / w.ratio),
      roomAfter: pt.roomChars === Infinity ? Infinity : Math.max(0, pt.roomChars - (tChars - st.userChars)),
      window: w
    };
  };

  /** The response envelope every exit shares. */
  const envelope = (fields) => {
    const w = windowFor(provider, st.key);
    const notice = st.notice;
    st.notice = ''; // shown once
    return {
      reply: '',
      memo: st.memo || '',
      pending: null,
      modelCall: null,
      applied: st.applied || null,
      used: st.used,
      reads: st.reads,
      window: {
        tokens: w.known ? w.tokens : null,
        source: w.known ? w.source : 'unknown',
        tier: st.tier || null,
        promptTokens: st.lastPromptTokens || st.estPromptTokens || 0,
        model: w.model || st.model || '',
        ratio: w.ratio,
        jit: !!w.jit
      },
      notice,
      truncated: false,
      ...fields
    };
  };

  for (;;) {
    if (st.hop >= MAX_TOOL_HOPS) {
      return envelope({ reply: 'עצרתי אחרי יותר מדי צעדים — נסחו את הבקשה מחדש בבקשה.' });
    }
    let data;
    let status = 200;
    if (incoming) {
      data = incoming;
      incoming = null;
    } else {
      const p = plan();
      st.tier = p.tier;
      st.sentChars = p.sentChars;
      st.estPromptTokens = p.estPromptTokens;
      st.roomAfter = p.roomAfter;
      if (provider.browserRelay) {
        // Pause here: the page executes this call through the bridge and
        // returns with { step: { id, result } } — the loop resumes above.
        // The envelope is built FIRST: it takes the notice and clears it, so
        // the state the step stores has already been told once — otherwise
        // the stored copy carries the notice into every later step of the turn.
        const env = envelope({});
        env.modelCall = { id: putStep(st), body: p.body };
        // the page's ceiling for THIS call = the one a server-side local call
        // gets; the relayed model is the same local model, reading the same
        // briefing, and after an approval it re-reads the whole conversation
        env.timeoutMs = LOCAL_TIMEOUT_MS;
        return env;
      }
      ({ status, data } = await callProvider(provider, p.body));
    }

    // ── judgement: is this reply one we may trust? ──
    const exceed = win.parseExceed(data);
    if (exceed) {
      // the runtime named its window — learn it, calibrate, shrink, retry
      win.noteWindow(st.key, exceed.nCtx, 'error', { model: st.model });
      if (st.sentChars && exceed.nPrompt) win.noteUsage(st.key, st.sentChars, exceed.nPrompt);
      st.lastFail = { nPrompt: exceed.nPrompt || st.estPromptTokens, nCtx: exceed.nCtx };
      st.notice = win.HE.shrink(exceed.nCtx, st.lastFail.nPrompt);
      if (st.shrinks >= MAX_SHRINKS) throw tooSmall(st.lastFail.nPrompt, st.lastFail.nCtx);
      st.shrinks++;
      // one tier DOWN, by rule — not by hoping the recalibrated ratio makes
      // the full briefing look too big (the clamp at 2.0 chars/token can
      // keep a JSON-heavy prompt's estimate under the budget)
      if (st.tier === 'full') st.forceCompact = true;
      const next = plan(); // throws WINDOW_TOO_SMALL with the real numbers when compact cannot fit
      if (next.sentChars >= st.sentChars) throw tooSmall(st.lastFail.nPrompt, st.lastFail.nCtx);
      continue; // a shrink does not consume a hop
    }
    const err = data && typeof data === 'object' ? data.error : null;
    if (err && typeof err === 'object' && err.type === 'relay_http_error') {
      // a 0.4.0 bridge drops the error body; a 400 there is almost always the
      // exceed — one blind tier-down, then the honest diagnosis
      const bv = String(err.bridgeVersion || st.bridgeVersion || '');
      if (Number(err.status) === 400) {
        if (st.tier === 'full' && st.blind < 1) {
          st.blind++;
          st.forceCompact = true;
          st.notice = win.HE.shrinkBlind;
          continue;
        }
        throw coded(win.HE.bridgeTooOld(bv), 'BRIDGE_TOO_OLD', { fix: win.HE.fixBridge, bridgeVersion: bv });
      }
      throw coded(errPrefix + 'HTTP ' + (err.status || '?'), 'PROVIDER_ERROR', { status: Number(err.status) || 0 });
    }
    if (err) {
      let msg = typeof err === 'string' ? err : String(err.message || JSON.stringify(err));
      if (/model.*not found|no models? (are )?loaded|is not loaded/i.test(msg)) msg = win.HE.modelNotLoaded;
      throw coded(errPrefix + msg, 'PROVIDER_ERROR', { status, providerMessage: msg });
    }
    if (status < 200 || status >= 300) {
      throw coded(errPrefix + 'HTTP ' + status, 'PROVIDER_ERROR', { status });
    }
    if (!data || typeof data !== 'object') throw coded(win.HE.emptyReply, 'EMPTY_REPLY');

    // the silent band: a 200 whose prompt count is above the window means
    // the runtime discarded the middle of the prompt and answered anyway
    const usage = readUsage(style, data);
    const known = win.getWindow(st.key);
    // (≥, not >: a prompt exactly the size of the window leaves no room to
    // generate — llama.cpp shifts the context to answer, which is the same
    // discarded middle)
    if (usage.prompt_tokens > 0 && known.tokens && usage.prompt_tokens >= known.tokens) {
      if (st.sentChars) win.noteUsage(st.key, st.sentChars, usage.prompt_tokens);
      st.lastFail = { nPrompt: usage.prompt_tokens, nCtx: known.tokens };
      if (st.truncRetries >= 1) throw tooSmall(usage.prompt_tokens, known.tokens);
      st.truncRetries++;
      if (st.tier === 'full') st.forceCompact = true; // one tier down, by rule (see the exceed path)
      st.notice = win.HE.shrink(known.tokens, usage.prompt_tokens);
      continue; // the reply is discarded, never stored
    }
    if (usage.prompt_tokens > 0) {
      if (st.sentChars) win.noteUsage(st.key, st.sentChars, usage.prompt_tokens);
      st.lastPromptTokens = usage.prompt_tokens;
    }

    const reply = readReply(style, data, { hop: st.hop, toolNames });
    if (reply.dropped) {
      throw coded(win.HE.bridgeDroppedTools(st.bridgeVersion), 'BRIDGE_DROPPED_TOOLS', { fix: win.HE.fixBridge, bridgeVersion: st.bridgeVersion });
    }
    if (reply.finish === 'length' && reply.calls.length) {
      // a document cut mid-way must never become a pending: approving it
      // would save half a page over a whole one
      throw coded(win.HE.replyCut, 'REPLY_CUT');
    }
    if (!reply.calls.length) {
      if (!String(reply.text || '').trim()) {
        // silence after an ACTION (a write done or refused, pages read) is
        // answered with the memo — the owner sees what happened; silence
        // with nothing done is the error it always was
        if (st.memo || st.used.length) return envelope({ memo: st.memo || win.HE.memoRead([...new Set(st.used)]) });
        throw coded(win.HE.emptyReply, 'EMPTY_REPLY');
      }
      return envelope({ reply: reply.text, truncated: reply.finish === 'length' });
    }

    // A write stops the loop. Read calls in the same batch still run — they
    // are free — but the write is proposed, never performed. Every other call
    // id is answered NOW so the stored unit is complete once the write's
    // answer joins it.
    const write = reply.calls.find((c) => (tools.getTool(c.name) || {}).mutates);
    const allowance = win.editAllowance(st.roomAfter === undefined ? Infinity : st.roomAfter);
    const results = [];
    for (const c of reply.calls) {
      if (write && c === write) continue;
      const t = tools.getTool(c.name);
      if (!t) { results.push({ id: c.id, output: { error: 'כלי לא מוכר: ' + c.name }, isError: true }); continue; }
      if (t.mutates) {
        results.push({ id: c.id, output: { skipped: true, reason: 'הצעה אחת בכל פעם — הציעו אותה שוב אחרי האישור' }, isError: true });
        continue;
      }
      st.used.push(c.name);
      try {
        const out = t.run(c.input, { maxSourceChars: allowance });
        // reads[] = pages the model actually READ; a refused read (tooLong,
        // source '') is not one — the canvas follows what the robot saw
        if (c.name === 'read_page' && out && out.slug && !out.tooLong) st.reads.push(out.slug);
        results.push({ id: c.id, output: out });
      } catch (e) {
        results.push({ id: c.id, output: { error: e.message }, isError: true });
      }
    }
    if (write) {
      const summary = tools.describeCall(write.name, write.input);
      const id = putPending({ st, reply, call: write, others: results });
      st.memo = win.HE.memoProposed(summary);
      return envelope({
        pending: { id, tool: write.name, summary, input: write.input },
        reply: reply.text || ''
      });
    }
    st.extra = appendToolTurn(style, st.extra, reply, results);
    st.hop++;
  }
}

/**
 * One raw provider round-trip for the tool loop. Resolves { status, data } —
 * a 4xx is a RESULT the loop judges (the exceed body teaches the window),
 * not a throw. Rejections: NO_PROVIDER (configuration), NETWORK, TIMEOUT.
 */
async function callProvider(provider, body) {
  const s = load();
  const key = String(s.apiKey || '');
  if (!key && !provider.keyOptional) throw coded('לא הוגדר מפתח API — הגדירו אותו בצ׳אט (ההגדרות בצד)', 'NO_PROVIDER');
  let endpoint = provider.endpoint;
  if (provider.id === 'local') {
    endpoint = resolveLocalEndpoint(s.baseUrl);
    if (!endpoint) throw coded('כתובת המודל המקומי חייבת להיות מקומית (127.0.0.1 / localhost) — נדחתה', 'NO_PROVIDER');
  }
  if (!endpointAllowed(endpoint)) {
    throw coded('כתובת הספק אינה ברשימת ההיתר של השרת — מסרב לשלוח את המפתח', 'NO_PROVIDER');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (key || !provider.keyOptional) {
    if (provider.authScheme === 'bearer') headers[provider.authHeader || 'Authorization'] = 'Bearer ' + key;
    else headers[provider.authHeader || 'x-api-key'] = key;
  }
  Object.assign(headers, provider.extraHeaders || {});

  let res;
  try {
    res = await postJson(endpoint, headers, body, provider.id === 'local' ? LOCAL_TIMEOUT_MS : PUBLIC_TIMEOUT_MS);
  } catch (e) {
    if (e && e.code === 'TIMEOUT') throw e;
    if (provider.id === 'local') {
      throw coded('לא הצלחתי להתחבר למודל המקומי ב-' + endpoint + ' — ודאו שהשרת המקומי דולק. פרטים: ' + e.message, 'NETWORK');
    }
    throw coded('קריאה לספק נכשלה (רשת): ' + e.message, 'NETWORK');
  }
  return { status: res.status, data: res.data };
}

/**
 * The window as the copilot page and the setup screen ask about it
 * (`GET /admin/api/ai/window`): discover, plan against the real briefing
 * sizes, describe in Hebrew. `hint` is the page's bridge probe (browser
 * courier). Never throws for a missing model — it reports.
 * @returns {Promise<{ok: boolean, provider: string, model: string, window: {tokens, maxTokens, source, jit}, tier: string|null, tierHe: string, message: string, recommended: number, editMaxChars: number|null, promptTokens: number}>}
 */
async function planWindow({ hint = null, sizes = null } = {}) {
  const s = load();
  const provider = getProvider(s.provider || 'claude');
  if (!provider) throw coded('ספק לא מוגדר', 'NO_PROVIDER');
  const model = modelFor(provider, s);
  const key = await discoverWindow(provider, s, model, hint);
  const w = windowFor(provider, key);
  let sz = sizes;
  if (!sz) {
    const { buildCopilotBriefing } = require('./pzn/agent-roleplay');
    let media = [];
    try { media = require('./media').listAllMedia(40); } catch (e) { /* no library yet */ }
    sz = {
      full: buildCopilotBriefing({ locale: 'he', media, tier: 'full' }).chars,
      compact: buildCopilotBriefing({ locale: 'he', media, tier: 'compact' }).chars
    };
  }
  const tools = require('./ai-tools');
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  const fixedChars = JSON.stringify(tools.toolsForProvider(style)).length + 400;
  const pt = win.pickTier({ tokens: w.tokens, source: w.source, ratio: w.ratio, sizes: sz, fixedChars });
  const editMaxChars = pt.tier ? (pt.roomChars === Infinity ? null : win.editAllowance(pt.roomChars)) : 0;
  const message = win.describeWindow({
    tokens: w.known ? w.tokens : (w.source === 'cloud' ? Infinity : null),
    source: w.known ? w.source : (w.source === 'cloud' ? 'cloud' : 'unknown'),
    tier: pt.tier,
    model: w.model || model,
    bridgeVersion: w.bridgeVersion,
    jit: !!w.jit,
    editMaxChars,
    minTokens: win.minWindowFor(pt.promptTokens)
  });
  return {
    ok: true,
    provider: provider.id,
    model: w.model || model,
    window: {
      tokens: w.known ? w.tokens : null,
      maxTokens: w.maxTokens || null,
      source: w.known ? w.source : (w.source === 'cloud' ? 'cloud' : 'unknown'),
      jit: !!w.jit
    },
    tier: pt.tier,
    tierHe: win.HE.tierHe(pt.tier),
    message,
    recommended: win.RECOMMENDED_WINDOW,
    editMaxChars,
    promptTokens: pt.promptTokens
  };
}

module.exports = {
  getSettings,
  saveSettings,
  generate,
  generateDetailed,
  converse,
  // the browser-relay seam for one-shot generation (v2.29)
  isRelayProvider,
  relayRequest,
  readRelayReply,
  buildRequest,
  endpointAllowed,
  ALLOWED_API_HOSTS,
  listProviders,
  STORE_PATH,
  // the injection runner's arithmetic + vocabulary (v2.28)
  estimateTokens,
  contextBudget,
  ERROR_CODES,
  LOCAL_TIMEOUT_MS,
  PUBLIC_TIMEOUT_MS,
  // the window (v2.32): what the routes and the setup screen ask
  planWindow,
  composeBody,
  probeLocalWindow: win.probeLocalWindow,
  describeWindow: win.describeWindow,
  windowKey: win.windowKey,
  WINDOW_HE: win.HE
};
