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
      req.destroy(new Error('המודל לא ענה תוך ' + Math.round(ceiling / 60000) + ' דקות — ' +
        'בדקו שהמודל טעון ושאין משהו אחר שתופס את ה-GPU (משחק, דפדפן), או קצרו את הבקשה'));
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
function buildRequest(provider, key, system, userText, model, history = []) {
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
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && t.content)
    .slice(-12)
    .map((t) => ({ role: t.role, content: String(t.content).slice(0, 12000) }));

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
 * One turn against the configured provider, with the stored key.
 * @returns {Promise<string>} the assistant's raw text
 */
async function generate({ system = '', user = '', history = [], maxTokens = 0, timeoutMs = 0 } = {}) {
  const opts = { maxTokens, timeoutMs };
  const s = load();
  const key = String(s.apiKey || '');
  const provider = getProvider(s.provider || 'claude');
  // The browser-relay provider exists only where a browser does: the owner's
  // copilot (converse via /admin/api/ai/chat). Server-initiated generation —
  // the visitor CS chat, agents — has no bridge to relay through.
  if (provider && provider.browserRelay) {
    throw new Error('הספק "דרך הדפדפן" משרת רק את קופיילוט הבעלים — לצ׳אט האתר נדרש ספק עם מפתח (או מודל מקומי של השרת עצמו)');
  }
  if (!provider || !provider.endpoint) throw new Error('ספק לא מוגדר');
  // A local runtime serves without credentials; a public one never does.
  if (!key && !provider.keyOptional) {
    throw new Error('לא הוגדר מפתח API — הגדירו אותו בצ׳אט (ההגדרות בצד)');
  }

  // For the local provider the address is the user's own — resolved (and
  // re-checked for loopback) per call, never frozen in the table.
  let endpoint = provider.endpoint;
  if (provider.id === 'local') {
    endpoint = resolveLocalEndpoint(s.baseUrl);
    if (!endpoint) {
      throw new Error('כתובת המודל המקומי חייבת להיות מקומית (127.0.0.1 / localhost) — נדחתה');
    }
  }
  if (!endpointAllowed(endpoint)) {
    throw new Error('כתובת הספק אינה ברשימת ההיתר של השרת — מסרב לשלוח את המפתח');
  }

  // A local runtime serves whatever model it has loaded, so any name is valid;
  // a public provider is held to the list we ship.
  const model = provider.openModel
    ? (String(s.model || '').trim() || provider.defaultModel)
    : ((provider.models || []).includes(s.model) ? s.model : provider.defaultModel);
  const { headers, body } = buildRequest(provider, key, system, user, model, history);
  // an injection runner may ask for a longer answer than the table's default
  if (Number(opts.maxTokens) > 0) body.max_tokens = Math.min(32768, Math.round(Number(opts.maxTokens)));

  let res;
  try {
    res = await postJson(endpoint, headers, body, opts.timeoutMs || (provider.id === 'local' ? LOCAL_TIMEOUT_MS : PUBLIC_TIMEOUT_MS));
  } catch (e) {
    if (provider.id === 'local') {
      throw new Error('לא הצלחתי להתחבר למודל המקומי ב-' + endpoint +
        ' — ודאו ש-LM Studio (או Ollama) רץ ושהשרת המקומי דולק. פרטים: ' + e.message);
    }
    throw new Error('קריאה לספק נכשלה (רשת): ' + e.message);
  }
  const data = res.data;
  if (res.status < 200 || res.status >= 300) {
    const msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + res.status);
    throw new Error('שגיאת ספק: ' + msg);
  }
  const text = dig(data, provider.responsePath || ['content', 0, 'text']);
  if (!text) throw new Error('הספק החזיר תשובה ריקה');
  return text;
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

const MAX_TOOL_HOPS = 6;          // a model that needs more is looping
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
// opaque id and the model's own output.
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

/** The request the page will relay verbatim (openai-chat shape; no auth —
 *  there is no key anywhere on this path). model '' = the page substitutes
 *  whatever the bridge reports as loaded. */
function buildRelayBody(provider, s, system, turns, toolDefs) {
  const body = {
    model: String(s.model || '').trim(),
    max_tokens: provider.maxTokens || 4096,
    messages: [{ role: 'system', content: system }, ...turns],
    reasoning_effort: 'none' // hybrid-thinking models must ANSWER (see buildRequest)
  };
  if (toolDefs && toolDefs.length) body.tools = toolDefs;
  return body;
}

/** Pull tool calls + text out of either provider's reply shape. */
function readReply(style, data) {
  if (style === 'openai-chat') {
    const m = (((data || {}).choices || [])[0] || {}).message || {};
    const calls = (m.tool_calls || []).map((c) => {
      let input = {};
      try { input = JSON.parse((c.function && c.function.arguments) || '{}'); } catch (e) { /* malformed */ }
      return { id: c.id, name: (c.function || {}).name, input };
    });
    return { text: m.content || '', calls, raw: m };
  }
  const content = ((data || {}).content) || [];
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const calls = content.filter((c) => c.type === 'tool_use')
    .map((c) => ({ id: c.id, name: c.name, input: c.input || {} }));
  return { text, calls, raw: content };
}

/** Append the assistant turn + our tool answers, in the provider's shape. */
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

/**
 * A turn that may use tools.
 * @param {{ system?, user?, history?, approve?, step? }} args
 *  step: { id, result } — a browser-relay continuation: `result` is the raw
 *  provider JSON the bridge got from the local model for modelCall `id`.
 * @returns {Promise<{reply?: string, pending?: {id, tool, summary, input},
 *   modelCall?: {id, body}, used: string[]}>}
 */
async function converse({ system = '', user = '', history = [], approve = null, step = null } = {}) {
  const tools = require('./ai-tools');
  const s = load();
  const provider = getProvider(s.provider || 'claude');
  if (!provider) throw new Error('ספק לא מוגדר');
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  let used = [];
  let hop = 0;
  let incoming = null; // model output handed back by the page (browser relay)

  // Resuming a relay step, an approved write, or starting fresh.
  let turns;
  if (step && step.id) {
    const st = takeStep(step.id);
    if (!st) throw new Error('הצעד פג — שלחו את ההודעה שוב');
    ({ system, turns, used, hop } = st);
    incoming = step.result && typeof step.result === 'object' ? step.result : null;
    if (!incoming) throw new Error('צעד ללא תוצאת מודל');
  } else if (approve && approve.id) {
    const pend = takePending(approve.id);
    if (!pend) throw new Error('הבקשה פגה — בקשו מהקופיילוט לנסות שוב');
    if (!approve.ok) {
      // Refusal is information: tell the model so it can offer something else
      // instead of silently repeating the same proposal.
      turns = appendToolTurn(style, pend.turns, pend.reply,
        [{ id: pend.call.id, output: { refused: true, reason: 'בעל/ת האתר דחה/תה את הפעולה' }, isError: true }]);
    } else {
      let output;
      let isError = false;
      try { output = tools.getTool(pend.call.name).run(pend.call.input); }
      catch (e) { output = { error: e.message }; isError = true; }
      used.push(pend.call.name);
      turns = appendToolTurn(style, pend.turns, pend.reply, [{ id: pend.call.id, output, isError }]);
    }
    system = pend.system;
  } else {
    turns = (Array.isArray(history) ? history : [])
      .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
      .slice(-12)
      .map((t) => ({ role: t.role, content: String(t.content).slice(0, 12000) }));
    turns.push({ role: 'user', content: String(user) });
  }

  for (; hop < MAX_TOOL_HOPS; hop++) {
    let data;
    if (incoming) {
      data = incoming;
      incoming = null;
    } else if (provider.browserRelay) {
      // Pause here: the page executes this call through the bridge and
      // returns with { step: { id, result } } — the loop resumes above.
      const id = putStep({ system, turns, used, hop });
      return { modelCall: { id, body: buildRelayBody(provider, s, system, turns, tools.toolsForProvider(style)) }, used };
    } else {
      data = await callProvider(provider, system, turns, tools.toolsForProvider(style));
    }
    const reply = readReply(style, data);
    if (!reply.calls.length) return { reply: reply.text || '', used };

    // A write stops the loop. Read calls in the same batch still run — they
    // are free — but the write is proposed, never performed.
    const write = reply.calls.find((c) => (tools.getTool(c.name) || {}).mutates);
    if (write) {
      const id = putPending({ turns, reply, call: write, system });
      return {
        pending: { id, tool: write.name, summary: tools.describeCall(write.name, write.input), input: write.input },
        reply: reply.text || '',
        used
      };
    }

    const results = reply.calls.map((c) => {
      const t = tools.getTool(c.name);
      if (!t) return { id: c.id, output: { error: 'כלי לא מוכר: ' + c.name }, isError: true };
      used.push(c.name);
      try { return { id: c.id, output: t.run(c.input) }; }
      catch (e) { return { id: c.id, output: { error: e.message }, isError: true }; }
    });
    turns = appendToolTurn(style, turns, reply, results);
  }
  return { reply: 'עצרתי אחרי יותר מדי צעדים — נסחו את הבקשה מחדש בבקשה.', used };
}

/** One raw provider round-trip (shared by generate + converse). */
async function callProvider(provider, system, turns, toolDefs) {
  const s = load();
  const key = String(s.apiKey || '');
  if (!key && !provider.keyOptional) throw new Error('לא הוגדר מפתח API — הגדירו אותו בצ׳אט (ההגדרות בצד)');
  let endpoint = provider.endpoint;
  if (provider.id === 'local') {
    endpoint = resolveLocalEndpoint(s.baseUrl);
    if (!endpoint) throw new Error('כתובת המודל המקומי חייבת להיות מקומית (127.0.0.1 / localhost) — נדחתה');
  }
  if (!endpointAllowed(endpoint)) {
    throw new Error('כתובת הספק אינה ברשימת ההיתר של השרת — מסרב לשלוח את המפתח');
  }
  const model = provider.openModel
    ? (String(s.model || '').trim() || provider.defaultModel)
    : ((provider.models || []).includes(s.model) ? s.model : provider.defaultModel);

  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  const headers = { 'Content-Type': 'application/json' };
  if (key || !provider.keyOptional) {
    if (provider.authScheme === 'bearer') headers[provider.authHeader || 'Authorization'] = 'Bearer ' + key;
    else headers[provider.authHeader || 'x-api-key'] = key;
  }
  Object.assign(headers, provider.extraHeaders || {});

  const body = style === 'openai-chat'
    ? { model, max_tokens: provider.maxTokens || 4096, messages: [{ role: 'system', content: system }, ...turns] }
    : { model, max_tokens: provider.maxTokens || 4096, system, messages: turns };
  if (style === 'openai-chat' && (provider.id === 'local' || provider.browserRelay)) {
    body.reasoning_effort = 'none'; // hybrid-thinking models must ANSWER (see buildRequest)
  }
  if (toolDefs && toolDefs.length) body.tools = toolDefs;

  let res;
  try {
    res = await postJson(endpoint, headers, body, provider.id === 'local' ? LOCAL_TIMEOUT_MS : PUBLIC_TIMEOUT_MS);
  } catch (e) {
    if (provider.id === 'local') {
      throw new Error('לא הצלחתי להתחבר למודל המקומי ב-' + endpoint + ' — ודאו שהשרת המקומי דולק. פרטים: ' + e.message);
    }
    throw new Error('קריאה לספק נכשלה (רשת): ' + e.message);
  }
  const data = res.data;
  if (res.status < 200 || res.status >= 300) {
    const msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + res.status);
    throw new Error('שגיאת ספק: ' + msg);
  }
  return data;
}

module.exports = {
  getSettings,
  saveSettings,
  generate,
  converse,
  buildRequest,
  endpointAllowed,
  ALLOWED_API_HOSTS,
  listProviders,
  STORE_PATH
};
