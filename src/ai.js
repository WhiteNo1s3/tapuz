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
// What a turn COSTS when the brain is a cloud key (v2.51): the price table,
// the token accounting and the arithmetic, in one module so the copilot, the
// battery and the eval runner can never disagree about a bill.
const cost = require('./ai-cost');

const STORE_PATH = path.join(CONFIG_DIR, 'ai.json');

// ── settings store ──────────────────────────────────────────────────────

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (data && typeof data === 'object') return migrateKeys(data);
    }
  } catch (e) { /* fall through */ }
  return { provider: 'claude', model: '', keys: {}, baseUrl: '' };
}

/**
 * v2.52 — ONE KEY PER PROVIDER. The store held a single `apiKey`, and the
 * setup card's rule is "an empty key field keeps the stored key": an owner who
 * switched from Claude to OpenAI and pressed Save sent her Anthropic key to
 * OpenAI in a Bearer header. With five suppliers that bill on the list that is
 * no longer a corner. Keys now live under `keys[<provider id>]` and a call only
 * ever takes the key filed under the provider it is calling (keyFor). A file
 * from before v2.52 is read as it was meant: its one key belongs to the
 * provider it was saved with. The old field is dropped on the next save.
 */
function migrateKeys(data) {
  const keys = (data.keys && typeof data.keys === 'object' && !Array.isArray(data.keys)) ? { ...data.keys } : {};
  const legacy = String(data.apiKey || '').trim();
  const owner = String(data.provider || 'claude');
  if (legacy && !keys[owner]) keys[owner] = legacy;
  const out = { ...data, keys };
  delete out.apiKey;
  return out;
}

/** The key filed under THIS provider — never another supplier's. */
function keyFor(s, providerId) {
  return String((s && s.keys && s.keys[providerId]) || '').trim();
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

/** Public settings — NEVER includes the key itself. */
function getSettings() {
  const s = load();
  const id = s.provider || 'claude';
  const key = keyFor(s, id);
  // which suppliers have a key on file (last four characters, as keyTail always was) — the setup card marks each row
  const keyTails = {};
  Object.keys(s.keys || {}).forEach((k) => { const v = keyFor(s, k); if (v && getProvider(k)) keyTails[k] = v.slice(-4); });
  return {
    provider: id,
    model: s.model || '',
    baseUrl: s.baseUrl || '',
    hasKey: !!key,
    keyTail: key ? key.slice(-4) : '',
    keyTails
  };
}

/**
 * @param {{ provider?, model?, apiKey?, baseUrl? }} patch
 *  apiKey: undefined = keep current; '' = clear; value = replace — always the
 *  key of the provider this same patch selects (or the one already selected).
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
  if (patch.apiKey !== undefined) {
    const v = String(patch.apiKey || '').trim();
    const owner = s.provider || 'claude';
    s.keys = s.keys || {};
    if (v) s.keys[owner] = v; else delete s.keys[owner];
  }
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
// v2.44 appends WINDOW_SHARED: the runtime's window is ONE pool for its
// parallel requests, and a neighbour's request filled it (ai-window.js
// parseShared) — every request on the pool died, none of them too big.
const ERROR_CODES = [
  'NO_PROVIDER', 'BROWSER_RELAY', 'NETWORK', 'TIMEOUT', 'PROVIDER_ERROR', 'EMPTY_REPLY',
  'WINDOW_TOO_SMALL', 'BRIDGE_TOO_OLD', 'BRIDGE_DROPPED_TOOLS', 'REPLY_CUT', 'NO_BRIEFING', 'WINDOW_SHARED',
  // v2.50 appends THOUGHT_OUT: a thinking model spent the whole answer budget reasoning — it is what
  // EMPTY_REPLY used to say for it, split off so the owner reads what happened and what to do
  'THOUGHT_OUT'
];

function coded(message, code, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

// ── the briefing gate (v2.42: NO_BRIEFING on EVERY local/bridge path) ────
//
// HARD-BATTERY-v2, C1 (2026-09-17, Gemma 4 31B): a chat/completions call to
// LM Studio with NO system briefing came back as an invented ```bentml
// dialect — a fake <document>, zero bent-* tags. No model knows BenTML on
// its own; the briefing IS the product. v2.35 refused that request in the
// tool loop only. This gate is the same rule on every path a request takes
// to a local model — the tool loop, the injection runner, the browser relay,
// the worker queue — applied to the BYTES about to leave (the composed
// body), so a caller that forgets the briefing, a pack composed without its
// dialect, or a new route that never heard of the rule all stop here, before
// any GPU minute is spent. What the rule cannot reach, on purpose: a naked
// call to the OpenAI-compatible API from outside the CMS. C1's raw-API case
// stays FAIL_INVENT by nature — only the CMS/Bridge paths are the product,
// and those always brief or refuse (docs/LOCAL-LLM.md).
//
// The marker is the dialect itself — a `<bent-` tag or the `bent-*` family
// name — present in every briefing tier, every pack (menus, theme, pages)
// and every repair turn's history. A request whose system text, user text
// and remembered turns hold none of it has no briefing in it.
const BRIEFING_MARK = /<bent-|bent-\*/;
const NO_BRIEFING_HE = 'הבקשה למודל יצאה בלי תדריך BenTML — זו תקלה במערכת, לא במודל; נסו לרענן את הדף';

/** Does this text carry a BenTML briefing (any tier, any pack)? */
function hasBriefing(text) {
  return BRIEFING_MARK.test(String(text || ''));
}

/** Every string the model will read out of a composed body, in both shapes
 *  (openai-chat: system rides as a message; anthropic-messages: `system`
 *  beside `messages`; a message's content may be a string or content parts). */
function bodyText(body) {
  if (!body || typeof body !== 'object') return '';
  const parts = [];
  if (typeof body.system === 'string') parts.push(body.system);
  for (const m of (Array.isArray(body.messages) ? body.messages : [])) {
    if (!m) continue;
    if (typeof m.content === 'string') parts.push(m.content);
    else if (Array.isArray(m.content)) {
      for (const c of m.content) if (c && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('\n');
}

/** Is this provider the owner's LOCAL model — the server's socket or the
 *  browser relay? Those are the only ones this gate binds: a cloud key with
 *  no briefing is still a bug, but not the one that burns the owner's GPU
 *  inventing a dialect. */
function isLocalProvider(provider) {
  return !!provider && (provider.id === 'local' || !!provider.browserRelay);
}

/**
 * The gate. Throws NO_BRIEFING when a request bound for a local model
 * carries no BenTML anywhere in its composed body. `prose` is the ONE
 * declared exception: a caller whose reply is never compiled as BenTML —
 * today only the visitor's customer-service chat (src/crm/cs.js), which
 * answers in words about the business and whose door is a length cap, not
 * the BenTML compiler. smoke-no-briefing pins that the flag appears nowhere
 * else.
 * @param {object} provider the provider descriptor the body is composed for
 * @param {object} body the composed request body (openai-chat or anthropic)
 * @param {{ prose?: boolean }} [opts]
 */
function assertBriefed(provider, body, opts = {}) {
  if (!isLocalProvider(provider)) return;
  if (opts && opts.prose === true) return;
  if (hasBriefing(bodyText(body))) return;
  throw coded(NO_BRIEFING_HE, 'NO_BRIEFING');
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

// ── a THINKING model and the answer's budget (v2.50) ───────────────────────
//
// The survey, 2026-09-20 (Muse-Glimmer 30B on LM Studio): `reasoning_effort:
// "none"` is ignored for it, so every reply is preceded by 2,000–4,000 tokens
// of reasoning. The organizer's ▶ gives the answer 2,048 tokens: all of them
// were spent thinking — `finish_reason: "length"`, `content: ""`,
// `reasoning_tokens: 2041` — and the owner read "הספק החזיר תשובה ריקה", 25 runs
// of 27. The same prompt with 6,000 tokens returns a valid <bent-menus>. The
// pasted-document dream died the same way in the copilot (4,096 of reply).
//
// An empty reply that hit the length limit WITH reasoning behind it is not
// "empty": the answer had no room left. One retry with a larger budget, bounded
// by the window; a model seen thinking starts there the next time; and when
// that is not enough the owner is told what happened, not "empty reply".
const THINK_FACTOR = 3;
const THINK_MAX_TOKENS = 12288;
const thinkers = new Map(); // window key → when it was last seen thinking its budget away

/** Did the model think its whole answer budget away? openai-chat only — the
 *  local runtimes; a cloud provider bills and budgets its own thinking. */
function thoughtOut(style, data) {
  if (style !== 'openai-chat' || !data || typeof data !== 'object') return false;
  const choice = ((data.choices) || [])[0] || {};
  const m = choice.message || {};
  if (String(choice.finish_reason || '') !== 'length') return false;
  if (typeof m.content === 'string' && m.content.trim()) return false;
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) return false;
  const details = (data.usage && data.usage.completion_tokens_details) || {};
  return String(m.reasoning_content || m.reasoning || '').trim().length > 0 || Number(details.reasoning_tokens) > 0;
}

/** The budget for the second try: three times the first, at most 12,288 — and
 *  never more than the window has left after the prompt. 0 = there is no
 *  larger budget worth a second call (under 1.5× the first). */
function biggerBudget(prev, windowTokens, promptTokens) {
  const p = Math.max(1, Math.floor(Number(prev) || 0));
  let next = Math.min(THINK_MAX_TOKENS, p * THINK_FACTOR);
  const w = Number(windowTokens);
  if (Number.isFinite(w) && w > 0) next = Math.min(next, w - (Number(promptTokens) || 0) - 384);
  return next >= p * 1.5 ? Math.floor(next) : 0;
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
    // v2.51 — the cached part of the prompt. The two shapes disagree about
    // where it sits, and the disagreement is resolved HERE, once, so nothing
    // downstream has to know: openai-chat counts cached tokens INSIDE
    // prompt_tokens, so the part billed at the full rate is what is left after
    // taking them out.
    const pd = u.prompt_tokens_details;
    if (pd && pd.cached_tokens != null) {
      out.cache_read_tokens = num(pd.cached_tokens);
      out.billed_input_tokens = Math.max(0, out.prompt_tokens - out.cache_read_tokens);
    }
    return out;
  }
  // anthropic-messages: input_tokens is ALREADY only the uncached part — the
  // cached read and the write that created it are reported beside it. So the
  // whole prompt is the sum of the three, and the billed-at-full-rate part is
  // input_tokens as given.
  const out = { prompt_tokens: num(u.input_tokens), completion_tokens: num(u.output_tokens) };
  const read = num(u.cache_read_input_tokens);
  const write = num(u.cache_creation_input_tokens);
  if (u.cache_read_input_tokens != null || u.cache_creation_input_tokens != null) {
    out.cache_read_tokens = read;
    out.cache_write_tokens = write;
    out.billed_input_tokens = out.prompt_tokens;
    out.prompt_tokens = out.prompt_tokens + read + write;
  }
  return out;
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

// ── the cached prefix (v2.51) ───────────────────────────────────────────
//
// The local tier pays nothing per token; the premium tier pays for every one,
// and the copilot's tool loop re-sends the SAME prefix on every hop — the
// BenTML briefing (thousands of tokens), then the tool schemas. Anthropic
// serves a marked prefix from its cache at a TENTH of the input price, for the
// price of writing it once at a quarter more. So a fourteen-hop turn stops
// paying fourteen times for one briefing, which is most of what a premium
// turn costs.
//
// The mark is `cache_control` on the last system block, and it is applied only
// where it can take: Anthropic ignores a breakpoint under its minimum
// cacheable prefix (1,024 tokens on the models this table ships) in silence,
// so a short system prompt keeps the plain-string shape it has always had —
// which is also the shape every smoke that pins the request asserts.
const CACHE_MIN_CHARS = 4700; // ≈ 2,048 tokens at the Hebrew ratio — twice the minimum, so it always takes

// v2.52 — WHERE the mark goes. The copilot's system text is the briefing (the
// module dictionary — identical call after call) and then the SITUATION: the
// page that is open, and in the builder drawer the selected item WITH ITS TEXT
// (routes/copilot.js). One block marked at its end hashes both, so every turn
// in which the owner selected something else missed the cache and paid the
// 1.25× write again for a dictionary that had not changed. The text is cut at
// the situation's head — one constant, shared with the route that writes it —
// and only the briefing is marked; the situation rides after it, unmarked.
const SITUATION_MARK = '\n\n---\n\n## המצב עכשיו';

/** The `system` field: a plain string, or the cached briefing (+ the unmarked situation) when it is worth caching. */
function cacheableSystem(provider, system) {
  const text = String(system || '');
  const style = (provider && provider.body && provider.body.style) || 'anthropic-messages';
  if (style !== 'anthropic-messages' || text.length < CACHE_MIN_CHARS) return text;
  const cut = text.lastIndexOf(SITUATION_MARK);
  if (cut >= CACHE_MIN_CHARS) {
    return [{ type: 'text', text: text.slice(0, cut), cache_control: { type: 'ephemeral' } }, { type: 'text', text: text.slice(cut) }];
  }
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

// ── the wire, for a supplier that bills (v2.52) ─────────────────────────
//
// The loop builds ONE body shape per style and everything in this module reads
// it (`max_tokens`, the `system` cacheableSystem made). What a particular
// supplier wants on top is added at the last moment, here, so nothing upstream
// has to know:
//   • OpenAI renamed the reply budget (`max_completion_tokens`);
//   • a cloud model that thinks by default is asked for the level the table
//     names — the copilot wants an answer, and thinking is billed as output;
//   • Anthropic, when the system is being cached anyway, also gets a top-level
//     `cache_control`: the API moves a second breakpoint along the growing
//     conversation, so hops 2..n of a turn read the page the model just read
//     (3–10K tokens) at a tenth instead of paying for it again every hop.
//
// None of it can be tried without a paid key, so each is REVOCABLE: a 400 that
// NAMES one of these fields drops it for that supplier (this process) and the
// same call is repeated once. A supplier's refusal must cost one round trip,
// never the copilot.
const OPTIONAL_WIRE_FIELDS = ['cache_control', 'reasoning_effort', 'max_completion_tokens'];
const refused = new Map(); // provider id → Set of the optional fields it refused

function refusedFields(providerId) {
  return Array.from(refused.get(providerId) || []);
}

function wireBody(provider, body) {
  if (!provider || !isCloudProvider(provider) || !body || typeof body !== 'object') return body;
  const no = refused.get(provider.id) || new Set();
  const out = { ...body };
  if (provider.reasoningEffort && !no.has('reasoning_effort') && out.reasoning_effort === undefined) out.reasoning_effort = provider.reasoningEffort;
  const field = provider.maxTokensField;
  if (field && field !== 'max_tokens' && !no.has(field) && out.max_tokens != null) { out[field] = out.max_tokens; delete out.max_tokens; }
  if (Array.isArray(out.system)) {
    if (no.has('cache_control')) out.system = out.system.map((b) => String((b && b.text) || '')).join('');
    else out.cache_control = { type: 'ephemeral' };
  }
  return out;
}

/** Which of OUR optional fields does this 400 complain about? ('' = none, or one already dropped.) */
function refusedField(provider, data) {
  const d = Array.isArray(data) ? data[0] : data;
  const err = d && d.error;
  const text = (err && typeof err === 'object' ? [err.message, err.param, err.code].filter(Boolean).join(' ') : String(err || ''));
  const no = refused.get(provider.id) || new Set();
  return OPTIONAL_WIRE_FIELDS.find((f) => !no.has(f) && text.indexOf(f) >= 0) || '';
}

async function postWire(provider, endpoint, headers, body, timeoutMs) {
  let res = await postJson(endpoint, headers, wireBody(provider, body), timeoutMs);
  if (res.status === 400 && isCloudProvider(provider)) {
    const field = refusedField(provider, res.data);
    if (field) {
      refused.set(provider.id, (refused.get(provider.id) || new Set()).add(field));
      console.warn('[ai] ' + provider.id + ' refused the optional field "' + field + '" — dropped for this process, the call is repeated');
      res = await postJson(endpoint, headers, wireBody(provider, body), timeoutMs);
    }
  }
  return res;
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
      system: cacheableSystem(provider, system),
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
async function generateDetailed({ system = '', user = '', history = [], maxTokens = 0, timeoutMs = 0, turnCap = 0, prose = false } = {}) {
  const opts = { maxTokens, timeoutMs };
  const started = Date.now();
  const s = load();
  const provider = getProvider(s.provider || 'claude');
  const key = provider ? keyFor(s, provider.id) : '';
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
  // the last gate before the wire: a local model is never sent a request
  // without its BenTML briefing (v2.42) — see assertBriefed
  assertBriefed(provider, body, { prose });
  // v2.50 — the lowest reasoning level THIS model allows ('none' whenever it can be switched off / is unknown)
  if (provider.id === 'local' && body.reasoning_effort) body.reasoning_effort = await win.probeReasoningEffort(s.baseUrl, model);

  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  const thinkKey = win.windowKey(provider.id, model);
  // v2.50 — a model already seen thinking its budget away starts with the larger one (no wasted first call)
  if (thinkers.has(thinkKey)) {
    const roomy = biggerBudget(body.max_tokens, contextBudget(provider.id), 0);
    if (roomy) body.max_tokens = roomy;
  }
  let spent = cost.zero();
  // null until a provider reports the field at all — an absent count and a
  // zero one are different answers, and the smokes pin both
  let reasoning = null;
  let thoughtRetry = false;
  for (;;) {
    let res;
    try {
      res = await postWire(provider, endpoint, headers, body, opts.timeoutMs || (provider.id === 'local' ? LOCAL_TIMEOUT_MS : PUBLIC_TIMEOUT_MS));
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
    // v2.44 — the pool (ai-window.js parseShared): a neighbour's request took the window
    if (win.parseShared(data)) throw coded(win.HE.shared, 'WINDOW_SHARED', { fix: win.HE.fixShared, status: res.status });
    if (res.status < 200 || res.status >= 300) {
      const msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + res.status);
      throw coded('שגיאת ספק: ' + msg, 'PROVIDER_ERROR', { status: res.status, providerMessage: String(msg) });
    }
    const usage = readUsage(style, data);
    if (usage.reasoning_tokens != null) reasoning = (reasoning || 0) + usage.reasoning_tokens;
    spent = cost.add(spent, usage);
    if (reasoning != null) spent.reasoning_tokens = reasoning;
    const text = dig(data, provider.responsePath || ['content', 0, 'text']);
    if (text) {
      return { text, usage: spent, ms: Date.now() - started, provider: { id: provider.id, model }, ...(thoughtRetry ? { thoughtRetry: true } : {}) };
    }
    // v2.50 — empty, at the length limit, with reasoning behind it: the answer had no room left
    if (thoughtOut(style, data)) {
      thinkers.set(thinkKey, Date.now());
      const next = thoughtRetry ? 0 : biggerBudget(body.max_tokens, contextBudget(provider.id), usage.prompt_tokens);
      if (next) { body.max_tokens = next; thoughtRetry = true; continue; }
      throw coded(win.HE.thoughtOut, 'THOUGHT_OUT', { fix: win.HE.fixThoughtOut, budget: body.max_tokens });
    }
    throw coded('הספק החזיר תשובה ריקה', 'EMPTY_REPLY');
  }
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
function relayRequest({ system = '', user = '', history = [], maxTokens = 0, turnCap = 0, prose = false } = {}) {
  const s = load();
  const provider = getProvider(s.provider || 'claude');
  if (!provider || !provider.browserRelay) {
    throw coded('הספק הנוכחי אינו "דרך הדפדפן" — אין מה להעביר', 'NO_PROVIDER');
  }
  const model = String(s.model || '').trim();
  const { body } = buildRequest(provider, '', system, user, model, history, turnCap > 0 ? turnCap : undefined);
  if (Number(maxTokens) > 0) body.max_tokens = Math.min(32768, Math.round(Number(maxTokens)));
  // the relayed model is the owner's local model: the same gate as the
  // server-side call, before the body is handed to the page (v2.42)
  assertBriefed(provider, body, { prose });
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
  if (win.parseShared(data)) throw coded(win.HE.shared, 'WINDOW_SHARED', { fix: win.HE.fixShared });
  if (data.error) {
    const msg = (data.error && (data.error.message || data.error)) || 'שגיאה לא ידועה';
    throw coded('שגיאת המודל המקומי: ' + String(msg), 'PROVIDER_ERROR', { providerMessage: String(msg) });
  }
  const text = dig(data, provider.responsePath || ['choices', 0, 'message', 'content']);
  // v2.50 — thought its budget away: the caller may send ONE more modelCall with a larger budget (thinkAgain)
  if (!text && thoughtOut(style, data)) {
    thinkers.set(win.windowKey('browser', String(meta.model || load().model || '')), Date.now());
    throw coded(win.HE.thoughtOut, 'THOUGHT_OUT', { fix: win.HE.fixThoughtOut, usage: readUsage(style, data) });
  }
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
const MAX_PROPOSAL_REFUSALS = 2;  // v2.37: invalid proposals sent back for repair before the turn gives up
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
function composeBody(provider, s, system, turns, toolDefs, maxTokens, effort) {
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  const model = modelFor(provider, s);
  const max = Math.max(1, Math.round(Number(maxTokens) || provider.maxTokens || 4096));
  const body = style === 'openai-chat'
    ? { model, max_tokens: max, messages: [{ role: 'system', content: system }, ...turns] }
    : { model, max_tokens: max, system: cacheableSystem(provider, system), messages: turns };
  if (style === 'openai-chat' && (provider.id === 'local' || provider.browserRelay)) {
    // hybrid-thinking models must ANSWER (see buildRequest); v2.50 — a model that cannot be switched off is asked
    // for the LOWEST level it allows (ai-window.js probeReasoningEffort), because "none" means its default to it
    body.reasoning_effort = effort || 'none';
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
 * v2.45 — a DOCUMENT the model printed instead of handing it to the write
 * tool. The copilot battery, across the Gemma 4 family (2026-09-19): the 12B
 * reads the menus, regroups them well — and PRINTS the `<bent-menus>` document
 * in a fence; it reads a page, is told its first proposal has a typo — and
 * prints the corrected page. qwen3.6 does it for every page. For a page the
 * chat screen has a "create from the reply" button (create only — useless for
 * an edit); for a menu there is nothing to press at all. The work is done and
 * the owner cannot take it.
 *
 * So a printed document is adopted as the call it was meant to be, and walks
 * the SAME road a real call walks — preflight, the door's verdict back to the
 * model, the approval card with its canvas. Nothing is written without ✓;
 * the only thing that changes is that the owner is offered the card.
 *
 *   <bent-menus>…</bent-menus>          → organize_menu, when the model READ
 *                                         the menus this turn (read_menus ran)
 *   <!DOCTYPE html>…</html> + bent-*    → edit_page of a page the model READ
 *                                         this turn (the doc's bent-slug, else
 *                                         the open page) · create_page when
 *                                         the slug names no page
 *
 * Not adopted, on purpose: a page that exists and was NOT read this turn (an
 * edit replaces the whole page — the read-before-edit rule); a menu from a
 * model that never called read_menus — organize_menu replaces whole menus, and
 * a model with no tool support at all is the v2.43 "weaker mode", which stays
 * describe-only (the tester's gate 3: shown closable, never approvable); a reply that hit
 * max_tokens (half a document), a tool the request did not declare, and a
 * turn where the owner asked to SEE the code ("תראה לי את הקוד") — printing is
 * what they wanted. openai-chat shape only: the models that do this are local.
 * @returns {object|null} a readReply-shaped reply holding one write call
 */
const SHOW_CODE_RE = /(?:תראה|תראי|הראה|הראי|הצג|הציגי|להציג|לראות|תדפיס|הדפס)[^.\n]{0,24}(?:קוד|מקור|pzn|bentml)|\b(?:show|print|see|view)\b[^.\n]{0,24}\b(?:code|source|markup)\b/i;
function adoptPrintedDocument(text, o = {}) {
  const s = String(text || '');
  if (!s.trim() || SHOW_CODE_RE.test(String(o.userText || ''))) return null;
  const declared = Array.isArray(o.declared) ? o.declared : [];
  let name = '';
  let input = null;
  let block = '';
  let m = /<bent-menus[\s>][\s\S]*?<\/bent-menus>/i.exec(s);
  if (m && !/<!DOCTYPE html/i.test(s)) {
    if (!declared.includes('organize_menu') || !(Array.isArray(o.used) ? o.used : []).includes('read_menus')) return null;
    name = 'organize_menu';
    block = m[0];
    input = { document: block };
  } else if ((m = /<!DOCTYPE html[\s\S]*?<\/html>/i.exec(s)) && /<bent-/i.test(m[0])) {
    block = m[0];
    const pages = require('./pages');
    const exists = (p) => !!(p && pages.getPageByFullPath(p));
    const slugM = /<meta\s+name=["']bent-slug["']\s+content=["']([^"']+)["']/i.exec(block);
    const slug = slugM ? slugM[1].trim() : '';
    const open = String(o.page || '').trim();
    const target = slug ? (exists(slug) ? slug : '') : (exists(open) ? open : '');
    if (target) {
      if (!(Array.isArray(o.reads) ? o.reads : []).includes(target) || !declared.includes('edit_page')) return null;
      name = 'edit_page';
      input = { slug: target, source: block };
    } else {
      if (!declared.includes('create_page')) return null;
      name = 'create_page';
      input = { source: block };
    }
  }
  if (!name) return null;
  // what is left of the reply once the document (and the fence it sat in) is lifted out
  const prose = s.replace(block, '').replace(/```[a-z]*\s*```/gi, '').trim();
  const id = 'doc_' + (Number(o.hop) || 0);
  return {
    text: prose,
    calls: [{ id, name, input }],
    raw: { role: 'assistant', content: prose || null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(input) } }] },
    finish: 'tool_calls',
    dropped: false,
    adopted: name
  };
}

/**
 * Pull tool calls + text out of either provider's reply shape — and read the
 * finish reason, because it is evidence:
 *   'tool_calls' with no calls  = the 0.4.0 bridge dropped them (dropped:true)
 *   'length'                    = the reply hit max_tokens
 * A non-streaming LM Studio reply carries `tool_calls: []` (empty, not
 * absent) beside `reasoning_content` — that is "no calls", not an error.
 */
/** A chat template's own tokens, leaked into the words meant for the owner
 *  (v2.58 — seen from Gemma 4 through the Bridge: a closing reply that opened
 *  with `<|channel>thought\n<channel|>` and then said, in good English, what
 *  it had built). The words stay; the machinery goes. Only the reply text —
 *  a document, a tool call and the raw message are never touched. */
const TEMPLATE_TOKENS = /<\|[a-z_]+\|?>|<\/?channel\|?>|<\|\/?[a-z_]+\|>/gi;
function stripTemplateTokens(text) {
  const t = String(text || '');
  if (!/<\||\|>|<channel/.test(t)) return t;
  return t.replace(TEMPLATE_TOKENS, '').replace(/^\s*thought\s*\n/i, '').trim();
}

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
    let text = stripTemplateTokens(typeof m.content === 'string' ? m.content : '');
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
  const text = stripTemplateTokens(content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'));
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
      if (r) win.noteWindow(key, r.tokens, 'probe', { maxTokens: r.maxTokens, model: r.model, jit: !!r.jit, loaded: r.loaded, probedTokens: r.probedTokens || null, cap: r.cap || 0 });
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

// ── a tool the window cannot answer is not declared (v2.43) ─────────────
//
// The menu pair (read_menus / organize_menu) costs ~530 chars of schema in
// EVERY request plus ~200 chars of briefing. Found by smoke-ai-window (c), the
// silent band at a probed 8,192: once a reply recalibrates the ratio to the
// 2.0 clamp the whole budget is 5,760 × 2.0 = 11,520 chars, v2.42 sat ~100
// chars under it, and the pair pushed the compact tier OVER — WINDOW_TOO_SMALL
// on the very model this module exists for (Ben's Gemma, loaded at LM
// Studio's 8,192 default). And where it still squeezed in, it was useless:
// read_menus hands a WHOLE menu back (never a slice), which needs more room
// than such a window has left. Paying every turn for a tool that can only
// ever answer "too long" is strictly worse than not declaring it.
//
// So the planner asks one more question. If the full tier fits → all six
// tools. If the compact tier fits with at least MENU_TOOLS_MIN_ROOM_CHARS
// left for history and read-backs → all six. Otherwise → LEAN: the four page
// tools and a briefing that says nothing about menus — v2.42's bytes exactly
// (compared against the committed v2.42 file when this was written, every
// locale × tier × media; smoke-ai-window pins what can be pinned without a
// copy of it: not a word about menus, four tools) — so an 8K owner loses
// nothing they had.
// A menu request there is answered in words (the weaker mode), the page says
// why, and the window sentence already names the fix (Context Length 32768).
const MENU_TOOLS_MIN_ROOM_CHARS = 3000;

/**
 * pickTier, plus whether the menu tools are declared.
 * @param {{ tokens, source, ratio, sizes: {full:number, compact:number, compactLean?:number}, toolsChars:number, leanToolsChars:number, extraChars?:number }} o
 * @returns {{ tier:'full'|'compact'|null, roomChars:number, promptTokens:number, budget:number, menus:boolean }}
 */
function pickCopilotTier(o = {}) {
  const sizes = o.sizes || {};
  const extra = Math.max(0, Number(o.extraChars) || 0);
  const all = win.pickTier({
    tokens: o.tokens, source: o.source, ratio: o.ratio,
    sizes: { full: sizes.full, compact: sizes.compact }, fixedChars: (Number(o.toolsChars) || 0) + extra
  });
  if (all.tier === 'full') return { ...all, menus: true };
  if (all.tier && all.roomChars >= MENU_TOOLS_MIN_ROOM_CHARS) return { ...all, menus: true };
  const lean = win.pickTier({
    tokens: o.tokens, source: o.source, ratio: o.ratio,
    sizes: { full: sizes.full, compact: sizes.compactLean || sizes.compact }, fixedChars: (Number(o.leanToolsChars) || 0) + extra
  });
  // lean.tier null too → the caller reports WINDOW_TOO_SMALL with the numbers
  // of the SMALLEST request we could have sent, not the largest
  return { ...lean, menus: false };
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
async function converse({ system = '', systemFor = null, user = '', history = [], approve = null, step = null, window: hint = null, context = null } = {}) {
  const tools = require('./ai-tools');
  const s = load();
  const provider = getProvider(s.provider || 'claude');
  if (!provider) throw coded('ספק לא מוגדר', 'NO_PROVIDER');
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  const toolDefs = tools.toolsForProvider(style);
  const toolNames = tools.TOOLS.map((t) => t.name);
  const toolsChars = JSON.stringify(toolDefs).length;
  // the LEAN set (v2.43): the four page tools, for a window that cannot
  // answer a menu read — see pickCopilotTier
  const leanToolDefs = tools.toolsForProvider(style, { menus: false });
  const leanToolsChars = JSON.stringify(leanToolDefs).length;
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
      // v2.40 — the live reject test: after a refusal Gemma told the owner
      // "I fixed the typos and added the CTA — the edit was sent for your
      // approval". The answer says, in the one place the model reads right
      // before it speaks, that nothing happened and what to say instead.
      output = {
        refused: true,
        done: false,
        reason: 'בעל/ת האתר דחה/תה את הפעולה — שום דבר לא נשמר ושום דבר לא השתנה',
        instruction: 'אמור/י לבעל/ת האתר שההצעה לא בוצעה ושאל/י מה לשנות. אל תכתוב/י שביצעת אותה או שהיא ממתינה לאישור.'
      };
      isError = true;
      st.memo = win.HE.memoRefused(summary);
    } else {
      try {
        // `brief` = the owner's own message of this turn. Only the menu door
        // reads it (LAYOUT_UNASKED is judged against what the OWNER asked).
        output = tools.getTool(write.name).run(write.input, { brief: st.userText || '' });
        st.used.push(write.name);
        st.applied = {
          tool: write.name,
          slug: output.slug,
          title: output.title,
          ...(output.created ? { created: true } : {}),
          ...(output.edited ? { edited: true } : {}),
          // v2.43 — a menu is not a page: no slug, no draft. What the page
          // needs is that it LANDED, which backup undoes it, and the fit line.
          ...(output.organized ? {
            organized: true,
            menus: Array.isArray(output.menus) ? output.menus : [],
            backupId: String(output.backupId || ''),
            fitLine: String(output.fitLine || ''),
            rebuildError: String(output.rebuildError || '')
          } : {}),
          warnings: Array.isArray(output.warnings) ? output.warnings : [],
          moduleCount: Number(output.moduleCount) || 0
        };
        st.memo = (output.organized ? win.HE.memoOrganized(output.fitLine)
          : output.created ? win.HE.memoCreated(output.slug) : win.HE.memoEdited(output.slug)) +
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
    // v2.50 — how little this model may be asked to think (the server-side local provider only: over the
    // browser courier the server cannot reach the owner's runtime, so 'none' + the larger-budget retry stand)
    const effort = provider.id === 'local' ? await win.probeReasoningEffort(s.baseUrl, model) : '';
    const text = String(user);
    st = {
      effort,
      spend: cost.zero(), // the premium tier's meter — emptied by every envelope
      systemFor: sysFor,
      sizes: null,           // measured lazily (each tier once)
      sysCache: {},
      key,
      model,
      tier: '',
      base: [],              // history + the current message (fitted per plan)
      extra: [],             // this turn's tool units (appended as they happen)
      userChars: text.length,
      userText: text.slice(0, 1500), // the menu door's brief (v2.43) — the organizer's own BRIEF_MAX
      // the page open in the builder / the copilot's canvas (v2.45): where a
      // PRINTED page with no slug of its own belongs (adoptPrintedDocument)
      page: context && typeof context === 'object' && context.page ? String(context.page).slice(0, 200) : '',
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

  // `menus` is the second thing the builder is told (v2.43): a briefing must
  // not promise tools the request does not declare. A legacy one-argument
  // builder ignores it — its lean text is then simply the same text.
  const systemText = (tier, menus = true) => {
    const k = tier + (menus ? '' : ':lean');
    if (st.sysCache[k] === undefined) st.sysCache[k] = String(st.systemFor(tier, { menus }) || '');
    return st.sysCache[k];
  };
  const sizes = () => {
    if (!st.sizes) {
      st.sizes = {
        full: systemText('full').length,
        compact: systemText('compact').length,
        compactLean: systemText('compact', false).length
      };
    }
    return st.sizes;
  };

  const tooSmall = (nPrompt, nCtx) =>
    coded(win.HE.tooSmall(nPrompt, nCtx), 'WINDOW_TOO_SMALL', { fix: win.HE.fixWindow, nPrompt, nCtx });

  /** Plan the next request against the window as known right now. */
  const plan = () => {
    const w = windowFor(provider, st.key);
    const source = st.forceCompact && w.source !== 'cloud' ? 'advisory' : w.source;
    // v2.43: the tier AND whether the menu pair is declared — a tool the
    // window cannot answer is not declared (pickCopilotTier)
    const pt = pickCopilotTier({
      tokens: w.tokens, source, ratio: w.ratio, sizes: sizes(),
      toolsChars, leanToolsChars, extraChars: st.userChars
    });
    if (!pt.tier) {
      if (st.lastFail) throw tooSmall(st.lastFail.nPrompt, st.lastFail.nCtx);
      throw tooSmall(pt.promptTokens + win.replyReserve(w.tokens) + win.TEMPLATE_HEADROOM_TOKENS, w.tokens);
    }
    const sys = systemText(pt.tier, pt.menus);
    const defs = pt.menus ? toolDefs : leanToolDefs;
    const defsChars = pt.menus ? toolsChars : leanToolsChars;
    // The tool loop exists to build BenTML pages; a request that leaves for
    // a LOCAL model without the briefing is a bug upstream, never a call to
    // make — without it the model answers in an invented dialect (C1: zero
    // bent-* tags), and over the bridge it would burn minutes of GPU first.
    // STRICTER than the body gate below on purpose: here the SYSTEM text
    // must carry the dialect — an owner typing `<bent-hero>` into the chat
    // is not a briefing.
    if (local && !hasBriefing(sys)) throw coded(NO_BRIEFING_HE, 'NO_BRIEFING');
    const extraChars = win.turnsChars(st.extra);
    const turns = win.fitTurns(st.base, pt.roomChars === Infinity ? Infinity : pt.roomChars - extraChars).concat(st.extra);
    const reserve = w.tokens === Infinity ? Math.max(4096, provider.maxTokens || 4096) : win.replyReserve(w.tokens);
    // v2.50 — a model that thought its budget away this turn gets the larger one for the retry (st.replyBudget)
    const maxTokens = Math.max(reserve, st.replyBudget || 0);
    st.lastReplyBudget = maxTokens;
    const body = composeBody(provider, s, sys, turns, defs, maxTokens, st.effort);
    const tChars = win.turnsChars(turns);
    return {
      tier: pt.tier,
      menus: pt.menus,
      body,
      sentChars: sys.length + tChars + defsChars,
      estPromptTokens: Math.ceil((sys.length + tChars + defsChars) / w.ratio),
      roomAfter: pt.roomChars === Infinity ? Infinity : Math.max(0, pt.roomChars - (tChars - st.userChars)),
      // v2.44 — what a READ may count on: the room with the OLD chat turns
      // given back. Only this turn's own tool units are untouchable; the
      // history is not, and fitTurns already drops its oldest turns when the
      // units grow — so the next plan() makes this number true.
      roomForRead: pt.roomChars === Infinity ? Infinity : Math.max(0, pt.roomChars - extraChars),
      window: w
    };
  };

  /** The response envelope every exit shares. */
  const envelope = (fields) => {
    const w = windowFor(provider, st.key);
    const notice = st.notice;
    st.notice = ''; // shown once
    // v2.51 — the bill of THIS response, then the counter goes back to zero.
    // A relayed turn answers the page several times from one `st` (modelCall →
    // step → … → reply), so a cumulative number would be counted again on
    // every hop. A delta is summable: add up every `spend` a turn produced and
    // the total is the turn's, exactly once.
    const spend = cost.report(provider.id, st.model || w.model || '', st.spend);
    st.spend = cost.zero();
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
        // v2.43 — false = this window got the four page tools only; the page
        // says so when the owner asks about the menu (undefined before a plan)
        menuTools: st.menus === undefined ? null : !!st.menus,
        promptTokens: st.lastPromptTokens || st.estPromptTokens || 0,
        model: w.model || st.model || '',
        ratio: w.ratio,
        jit: !!w.jit,
        // v2.49 — a capped probe says so (LOCAL_LLM_WINDOW_CAP): what the runtime loaded, what it is budgeted at
        ...(w.cap ? { probedTokens: w.probedTokens, cap: w.cap } : {})
      },
      notice,
      // null on the free tier and whenever nothing was spent — the page shows
      // a cost line only where there is a cost
      spend,
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
      st.menus = p.menus;
      st.sentChars = p.sentChars;
      st.estPromptTokens = p.estPromptTokens;
      st.roomAfter = p.roomAfter;
      st.roomForRead = p.roomForRead;
      if (provider.browserRelay) {
        // Pause here: the page executes this call through the bridge and
        // returns with { step: { id, result } } — the loop resumes above.
        // The envelope is built FIRST: it takes the notice and clears it, so
        // the state the step stores has already been told once — otherwise
        // the stored copy carries the notice into every later step of the turn.
        const env = envelope({});
        assertBriefed(provider, p.body); // the bytes the page will relay, judged once more
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
    // v2.44 — the pool: another request was running on the same window and
    // the runtime dropped them all. Not this prompt's fault, so nothing is
    // learned and nothing shrinks; and NO silent retry — a retry that lands
    // beside a neighbour still generating takes the window from under it and
    // kills that one too (measured). The owner is told, with the setting.
    if (win.parseShared(data)) throw coded(win.HE.shared, 'WINDOW_SHARED', { fix: win.HE.fixShared, status });
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
    // v2.51 — the bill, before any of the paths below decide what to do with
    // the reply. A discarded answer (the shrink retry) was still BILLED, so it
    // is counted here and not at the exits: a turn that cost three calls must
    // say three, whichever way it ended.
    st.spend = cost.add(st.spend, usage);
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

    let reply = readReply(style, data, { hop: st.hop, toolNames });
    // v2.45 — a document the model PRINTED is adopted as the write it was
    // meant to be, and walks the same road: preflight → the approval card
    if (style === 'openai-chat' && !reply.calls.length && !reply.dropped && reply.finish !== 'length') {
      const declared = st.menus === false ? toolNames.filter((n) => n !== 'read_menus' && n !== 'organize_menu') : toolNames;
      const adopted = adoptPrintedDocument(reply.text, { hop: st.hop, declared, reads: st.reads, used: st.used, page: st.page, userText: st.userText });
      if (adopted) {
        reply = adopted;
        st.notice = win.HE.adoptedPrinted;
      }
    }
    if (reply.dropped) {
      throw coded(win.HE.bridgeDroppedTools(st.bridgeVersion), 'BRIDGE_DROPPED_TOOLS', { fix: win.HE.fixBridge, bridgeVersion: st.bridgeVersion });
    }
    if (reply.finish === 'length' && reply.calls.length) {
      // a document cut mid-way must never become a pending: approving it
      // would save half a page over a whole one
      throw coded(win.HE.replyCut, 'REPLY_CUT');
    }
    if (!reply.calls.length) {
      // v2.50 — not silence: the model THOUGHT its reply budget away (finish=length, reasoning behind it).
      // One more call with a larger budget, bounded by what the window has left after this prompt.
      if (!String(reply.text || '').trim() && thoughtOut(style, data)) {
        thinkers.set(st.key, Date.now());
        const next = st.thought ? 0 : biggerBudget(st.replyBudget || st.lastReplyBudget, known.tokens || windowFor(provider, st.key).tokens, usage.prompt_tokens);
        if (next) {
          st.thought = true;
          st.replyBudget = next;
          st.notice = (st.notice ? st.notice + ' ' : '') + win.HE.thinkingRetry;
          continue; // like a shrink: it does not consume a hop
        }
        // nothing larger to be had — after an ACTION the memo still tells the owner what happened
        if (st.memo || st.used.length) return envelope({ memo: (st.memo || win.HE.memoRead([...new Set(st.used)])) + ' ' + win.HE.thoughtOut });
        throw coded(win.HE.thoughtOut, 'THOUGHT_OUT', { fix: win.HE.fixThoughtOut });
      }
      if (!String(reply.text || '').trim()) {
        // silence after an ACTION (a write done or refused, pages read) is
        // answered with the memo — the owner sees what happened; silence
        // with nothing done is the error it always was
        if (st.memo || st.used.length) return envelope({ memo: st.memo || win.HE.memoRead([...new Set(st.used)]) });
        throw coded(win.HE.emptyReply, 'EMPTY_REPLY');
      }
      // v2.45 — the door sent a proposal back this turn, and the model's last
      // word is… words. Battery T3 (Gemma 4 12B): a typo'd edit was refused,
      // and the next reply said "עדכנתי את כותרת ההירו" with no document and no
      // call — nothing was proposed, nothing was saved, and the owner was told
      // it was done. The model's sentence stays; the truth goes beside it.
      if ((st.refusals || 0) > 0 && !st.applied) {
        st.notice = (st.notice ? st.notice + ' ' : '') + win.HE.refusedThenWords;
      }
      return envelope({ reply: reply.text, truncated: reply.finish === 'length' });
    }

    // A write stops the loop. Read calls in the same batch still run — they
    // are free — but the write is proposed, never performed. Every other call
    // id is answered NOW so the stored unit is complete once the write's
    // answer joins it.
    const write = reply.calls.find((c) => (tools.getTool(c.name) || {}).mutates);
    // v2.44 — a read outranks old chat turns. The allowance used to be what
    // was left AFTER the history, so at 8,192 the copilot could not read back
    // the page it had created one turn earlier (battery T3, Gemma 4 31B, both
    // couriers: a 2,198-char page refused because the conversation that made
    // it was in the way). Sized against roomForRead, the page comes back and
    // the oldest turns leave instead — the owner asked about the page.
    const readRoom = st.roomForRead === undefined ? st.roomAfter : st.roomForRead;
    const allowance = win.editAllowance(readRoom === undefined ? Infinity : readRoom);
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
      // v2.39 — a model's raw HTML loses its script BEFORE it is proposed, so
      // the owner approves exactly what will be saved (src/ai-html-guard.js)
      if (write.input && typeof write.input.source === 'string') {
        const g = require('./ai-html-guard').scrubAiSource(write.input.source);
        if (g.scrubbed) {
          write.input = Object.assign({}, write.input, { source: g.source });
          st.notice = require('./ai-html-guard').scrubNotice(g.scrubbed);
        }
        // v2.45 — and a closer that is almost the open tag is read as that tag
        // (pzn/repair.js fixCloserTypos), here too: what the card holds is
        // what the write will save
        const closers = require('./pzn/repair').fixCloserTypos(write.input.source);
        if (closers.fixed) write.input = Object.assign({}, write.input, { source: closers.source });
      }
      // v2.37 — a proposal the write would refuse never reaches the owner.
      // Live (Bridge challenges, Gemma 4 31B): a bent-faq holding bent-fold
      // was approved and only THEN failed E_CHILD; the model fixed it on its
      // next turn, after a wasted click. Now the errors go straight back to
      // the model as the call's answer, and the owner is asked only about a
      // document that will land. Capped: after MAX_PROPOSAL_REFUSALS the turn
      // ends with the reason instead of looping on the owner's GPU.
      let refusal = '';
      // v2.43 — what the check learned rides to the page: for organize_menu
      // the preflight IS the organizer's door, and its preview (tree, diff,
      // fit line, the framed header) is what the canvas shows before ✓
      let pre = null;
      // `lostAsked` (v2.44): a menu that loses pages is sent back ONCE per turn
      // `inventionsAsked` (v2.46): invented pictures and dead links go back ONCE per turn too
      try { pre = tools.preflight(write.name, write.input, { brief: st.userText || '', lostAsked: !!st.lostAsked, inventionsAsked: !!st.inventionsAsked }); } catch (e) {
        refusal = e.message;
        if (e.code === 'PAGES_LOST') st.lostAsked = true;
        if (e.code === 'PAGE_INVENTIONS') st.inventionsAsked = true;
      }
      if (refusal) {
        st.refusals = (st.refusals || 0) + 1;
        if (st.refusals > MAX_PROPOSAL_REFUSALS) {
          st.memo = win.HE.proposalGaveUp(refusal);
          return envelope({ reply: reply.text || '' });
        }
        // the fix line is the TOOL's when it has one: "a child the container
        // does not accept" is advice about pages, and wrong for a menu
        const fix = (tools.getTool(write.name) || {}).fixHint || win.HE.proposalFixForModel;
        results.push({ id: write.id, output: { error: refusal, proposed: false, fix }, isError: true });
        st.notice = win.HE.proposalRefused(refusal);
        st.extra = appendToolTurn(style, st.extra, reply, results);
        st.hop++;
        continue;
      }
      // v2.46 — what the proposal invented and the door let through (a link to
      // a page that does not exist yet; a picture the model insisted on): the
      // owner reads it beside the card, before ✓
      if (pre && Array.isArray(pre.notes) && pre.notes.length) st.notice = (st.notice ? st.notice + ' ' : '') + pre.notes.join(' ');
      const summary = tools.describeCall(write.name, write.input);
      const id = putPending({ st, reply, call: write, others: results });
      st.memo = win.HE.memoProposed(summary);
      return envelope({
        pending: {
          id, tool: write.name, summary, input: write.input,
          ...(pre && pre.preview ? { preview: pre.preview, warnings: Array.isArray(pre.warnings) ? pre.warnings : [] } : {})
        },
        reply: reply.text || ''
      });
    }
    st.extra = appendToolTurn(style, st.extra, reply, results);
    st.hop++;
  }
}

/**
 * The longest a whole copilot turn may hold its socket (v2.44): every model
 * call the loop can make — the hops, the shrink retries, the proposal
 * repairs — at the provider's own per-call ceiling, plus a margin. An upper
 * bound for routes/copilot.js to lift the server's 30 s idle cap to; each
 * call is still cut by its own ceiling (postJson).
 */
function turnCeilingMs() {
  const provider = getProvider(load().provider || 'claude');
  const perCall = provider && (provider.id === 'local' || provider.browserRelay) ? LOCAL_TIMEOUT_MS : PUBLIC_TIMEOUT_MS;
  return (MAX_TOOL_HOPS + MAX_SHRINKS + MAX_PROPOSAL_REFUSALS + 1) * perCall + 30000;
}

/**
 * One raw provider round-trip for the tool loop. Resolves { status, data } —
 * a 4xx is a RESULT the loop judges (the exceed body teaches the window),
 * not a throw. Rejections: NO_PROVIDER (configuration), NETWORK, TIMEOUT.
 */
async function callProvider(provider, body) {
  const s = load();
  const key = keyFor(s, provider.id);
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
  // the tool loop's plan() already refused a briefing-less SYSTEM text; this
  // is the wire-level gate every server-side local call passes (v2.42)
  assertBriefed(provider, body);

  let res;
  try {
    res = await postWire(provider, endpoint, headers, body, provider.id === 'local' ? LOCAL_TIMEOUT_MS : PUBLIC_TIMEOUT_MS);
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
      compact: buildCopilotBriefing({ locale: 'he', media, tier: 'compact' }).chars,
      compactLean: buildCopilotBriefing({ locale: 'he', media, tier: 'compact', menus: false }).chars
    };
  }
  const tools = require('./ai-tools');
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  // the SAME question the turn asks (v2.43) — the chip and the turn must
  // never disagree about the tier, nor about whether the menu tools are in
  const pt = pickCopilotTier({
    tokens: w.tokens, source: w.source, ratio: w.ratio, sizes: sz,
    toolsChars: JSON.stringify(tools.toolsForProvider(style)).length,
    leanToolsChars: JSON.stringify(tools.toolsForProvider(style, { menus: false })).length,
    extraChars: 400
  });
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
      jit: !!w.jit,
      ...(w.cap ? { probedTokens: w.probedTokens, cap: w.cap } : {})
    },
    tier: pt.tier,
    tierHe: win.HE.tierHe(pt.tier),
    message,
    recommended: win.RECOMMENDED_WINDOW,
    editMaxChars,
    promptTokens: pt.promptTokens,
    menuTools: !!(pt.tier && pt.menus)
  };
}

module.exports = {
  stripTemplateTokens,
  keyFor,
  wireBody,
  refusedFields,
  cacheableSystem,
  SITUATION_MARK,
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
  thoughtOut,
  biggerBudget,
  ERROR_CODES,
  // the briefing gate (v2.42): the worker queue and the smokes ask the same question
  hasBriefing,
  assertBriefed,
  BRIEFING_MARK,
  LOCAL_TIMEOUT_MS,
  PUBLIC_TIMEOUT_MS,
  turnCeilingMs,
  adoptPrintedDocument,
  // the window (v2.32): what the routes and the setup screen ask
  planWindow,
  // …and whether that window gets the menu tools (v2.43)
  pickCopilotTier,
  MENU_TOOLS_MIN_ROOM_CHARS,
  composeBody,
  probeLocalWindow: win.probeLocalWindow,
  describeWindow: win.describeWindow,
  windowKey: win.windowKey,
  WINDOW_HE: win.HE
};
