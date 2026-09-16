/* Tapuziel Bridge V2 — background worker. THE relay, and nothing else.
 *
 * V1 grew a BYOK popup (v0.73) and then amputated it (v0.85) because keys
 * belong in the CMS, where the owner sets them once and every worker uses
 * them "without seam". V2 starts from that lesson: this extension holds NO
 * credentials of any kind. Its single job is carrying requests from the
 * site's admin pages to the LLM server running on THIS machine (LM Studio,
 * Ollama — anything OpenAI-compatible on loopback), so the local model never
 * has to be exposed to the internet.
 *
 * WHY THE RELAY HAS TO BE HERE, not in the page: the site is served over
 * https from a real host, and LM Studio answers loopback with NO CORS headers
 * at all (its preflight comes back 400 with no Access-Control-*). A page
 * fetch is therefore dead on arrival, and Chrome's Private Network Access
 * would block it anyway. A background fetch backed by a host permission is
 * subject to neither. The PAGE never fetches the model. The worker always does.
 *
 * WHY IT STREAMS (0.4.0): an MV3 service worker is killed when it looks idle,
 * and a non-streaming generation is one long silence — measured here with
 * gemma-4-31b: 9-13s of nothing for the organizer pack (6,918 chars), 130s+
 * for a 44K-char site-builder pack. Streaming the same call, the first token
 * lands after 0.4s warm / 4.2s cold and the longest MID-STREAM silence is
 * 45-47ms. Chunks every ~50ms, plus the port traffic they produce, keep the
 * worker comfortably inside the 30s idle rule.
 *
 * Streaming is an INTERNAL detail of this worker. The page composes an
 * ordinary non-streaming request and reads an ordinary non-streaming reply —
 * the assembled `choices[0].message.content` shape everything already parses.
 * Nothing above this file had to learn a new format.
 *
 * WHAT 0.4.0 LOST, AND 0.5.0 GIVES BACK: a streamed TOOL CALL does not travel
 * in `delta.content` — it arrives as `delta.tool_calls[]` fragments keyed by
 * `index` (measured against LM Studio: frame 1 carries id/type/name with
 * `arguments:''`, the following frames carry only `function.arguments` string
 * pieces to concatenate, then `finish_reason:'tool_calls'`, then the usage
 * frame with `choices:[]`, then [DONE]). 0.4.0 accumulated `content` alone,
 * so every list_pages / read_page / create_page / edit_page the model asked
 * for was reassembled as an EMPTY reply — the copilot's "two turns to get an
 * unrelated answer". The accumulator below keeps one slot per `index` and
 * emits `message.tool_calls` exactly as a non-streaming reply would.
 *
 * ERROR BODIES ARE RESULTS, not failures. LM Studio's 400 for a prompt that
 * outgrows the loaded window is a JSON body with machine-readable numbers
 * (`exceed_context_size_error`, n_prompt_tokens, n_ctx); the CMS reads them
 * to shrink its briefing and retry. The worker has always returned that body
 * as `data` on a non-2xx — since 0.5.0 the content bridge forwards it to the
 * page instead of collapsing it into the string 'no response'.
 *
 * WHY /api/v0/models is on the menu: LM Studio's native REST reports, per
 * model, `state` and `loaded_context_length` — the ONLY way to learn the
 * window BEFORE sending. That matters more than it sounds: with a prompt
 * between 1× and 2× the window LM Studio answers HTTP 200 and silently drops
 * the middle of the prompt (the 400 only comes at ≥ 2×), so the page must
 * know the window up front rather than wait for an error that may never come.
 *
 * CONNECTED SITES SURVIVE A RELOAD (0.5.2). The popup's "connect this site"
 * registers the content bridge dynamically (scripting.registerContentScripts,
 * persistAcrossSessions) — the tracked manifest names no site, on purpose:
 * the repo is public and the owner's hostnames are theirs. But a dynamic
 * registration is only as durable as the browser's own bookkeeping, and the
 * live site went dark after a `git pull` + Reload of the unpacked tree. So
 * the worker keeps its OWN record of connected sites in storage.local
 * (`sites`: [{ id, pattern }]) and, every time it boots — install, update,
 * Reload, browser start, wake — re-registers any site in the record that
 * still holds its host permission and is not registered any more. Storage
 * and granted optional permissions outlive a Reload; the record makes the
 * registration outlive it too. Registrations that predate the record are
 * adopted when the browser still holds them at boot — but Chrome drops a
 * dynamic registration on update and Reload BEFORE the new worker boots
 * (measured), so an owner who connected from a 0.5.0/0.5.1 popup connects
 * once more after updating. A site wired by the downloaded ZIP (0.5.1,
 * static content_scripts) never depended on any of this.
 *
 * TWO SILENCES (0.5.2). Before the first frame the model is READING the
 * prompt: a 45K-char briefing plus history on a 31B model is minutes of
 * legitimate silence, and after an approval the whole conversation is
 * re-read. 0.5.0 capped that at the same two minutes as mid-stream silence,
 * so long turns under the bridge died with «המודל המקומי לא ענה בזמן» while
 * the CMS itself allows a local model twenty (src/ai.js LOCAL_TIMEOUT_MS).
 * The first-frame ceiling now mirrors the server's; a model that has started
 * writing and then falls silent is still caught in two minutes.
 *
 * Cross-browser: Chrome runs this as a service worker, Firefox as an event
 * page (both keys sit in the manifest). Everything is PROMISE-style — in
 * Firefox the `browser` namespace is promise-only, callbacks break — except
 * onMessage, which keeps sendResponse+true because Chrome does not accept a
 * returned Promise there.
 *
 * SECURITY INVARIANT (mirrors src/providers.js isLoopbackHost on the CMS):
 * the target hostname must be exactly localhost / 127.0.0.1 / [::1]. Not a
 * LAN address, not 0.0.0.0, not localhost.evil.com. The page supplies a path,
 * never a host. */
'use strict';

const B = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULT_BASE = 'http://127.0.0.1:1234'; // LM Studio's default port

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// The page picks from this menu — it can never name an arbitrary URL.
// /api/v0/models (0.5.0) is LM Studio's native list: the one that says what
// context length each model was actually LOADED with.
const ALLOWED_PATHS = ['/v1/chat/completions', '/v1/models', '/api/v0/models'];

const CHAT_PATH = '/v1/chat/completions';

// The streaming channel. One connection per chat request.
const PORT_NAME = 'tz-llm';

// A server that accepted the socket and then stopped talking must not leave
// the popup spinning forever. The probes are impatient; a generation is not.
const TIMEOUT_MS = { '/v1/models': 15000, '/api/v0/models': 15000 };
const DEFAULT_TIMEOUT_MS = 300000;

// For a STREAM the meaningful limit is silence, not duration: a model that is
// visibly writing is never cut off, however long it takes, and one that has
// stopped talking is caught quickly.
const STREAM_IDLE_MS = 120000;

// …except BEFORE the first frame, when silence is the model reading the
// prompt. Mirrors src/ai.js LOCAL_TIMEOUT_MS — the ceiling the CMS gives its
// own server-side local call — so the bridge is never the shorter leash.
const FIRST_FRAME_MS = 20 * 60 * 1000;

// The connected-sites record (storage.local) and the id prefix the popup
// gives every bridge registration — the two must agree.
const SITES_KEY = 'sites';
const SCRIPT_PREFIX = 'tz-bridge-';

// ~4 progress messages a second. Never one per token — that would post
// thousands of messages and cost more than the generation.
const PROGRESS_MS = 250;

// Say something at least this often even when the model has gone quiet: port
// traffic is what resets the worker's idle timer.
const HEARTBEAT_MS = 10000;

async function getBase() {
  const r = await B.storage.local.get(['llm_base']);
  return (r.llm_base || DEFAULT_BASE).replace(/\/+$/, '');
}

function isLoopbackBase(base) {
  try {
    const u = new URL(base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname === '::1' ? '[::1]' : u.hostname; // URL strips the brackets
    return LOOPBACK_HOSTS.includes(host.toLowerCase());
  } catch (e) {
    return false;
  }
}

/** Firefox MV3 treats manifest host_permissions as user-approvable, not
 *  auto-granted — so a fetch to loopback can fail on PERMISSION, and that
 *  must say "approve in the popup", not "is LM Studio running?". */
async function hasLocalPermission(base) {
  try {
    const u = new URL(base);
    // match patterns ignore ports; [::1] has no valid pattern form — skip it
    if (u.hostname === '::1' || u.hostname === '[::1]') return true;
    return await B.permissions.contains({ origins: [u.protocol + '//' + u.hostname + '/*'] });
  } catch (e) {
    return true; // never turn the permission probe itself into a hard failure
  }
}

/** Every gate an incoming request passes before a socket is opened. */
async function preflight(path) {
  if (!ALLOWED_PATHS.includes(path)) return { error: 'path not allowed: ' + path };
  const base = await getBase();
  if (!isLoopbackBase(base)) return { error: 'endpoint is not loopback: ' + base };
  if (!(await hasLocalPermission(base))) {
    return { error: 'אין הרשאת גישה ל-localhost — פתחו את הפופאפ של התוסף ואשרו אותה' };
  }
  return { base };
}

function describeError(e) {
  // a watchdog names WHICH silence it caught (see timedOut in streamChat)
  if (e && e.name === 'AbortError') return e.tzReason || 'המודל המקומי לא ענה בזמן — בדקו את LM Studio';
  // The classic here is "LM Studio isn't running" / server not started.
  return 'local model unreachable: ' + (e && e.message);
}

/** An AbortError that says which watchdog fired. `name` stays 'AbortError'
 *  so every existing check on it still holds. */
function timeoutError(reason) {
  const err = new Error(reason);
  err.name = 'AbortError';
  err.tzReason = reason;
  return err;
}
const FIRST_FRAME_REASON = 'המודל המקומי לא ענה בזמן — ' + Math.round(FIRST_FRAME_MS / 60000) + ' דקות בלי טוקן ראשון; בדקו ש-LM Studio עדיין מעבד את הבקשה';
const STREAM_IDLE_REASON = 'המודל המקומי לא ענה בזמן — הזרם שתק ' + Math.round(STREAM_IDLE_MS / 60000) + ' דקות באמצע כתיבה; בדקו את LM Studio';

async function readWholeBody(res) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

/** Non-streaming call — the two model lists (/v1/models, /api/v0/models),
 *  and the fallback for a server that ignores `stream`. A GET when there is
 *  no body: the lists are GETs, and LM Studio 404s a POST to them. */
async function plainFetch(base, path, body, ac) {
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS[path] || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal
    });
    return await readWholeBody(res);
  } finally {
    clearTimeout(timer);
  }
}

const DONE_FRAME = {}; // sentinel: the [DONE] terminator, not a data frame

/** One SSE line → a frame, the [DONE] sentinel, or null for anything that
 *  carries no payload (blank separators, `:` keepalive comments, and the
 *  `event:` / `id:` / `retry:` fields we have no use for). */
function parseFrame(rawLine) {
  const line = rawLine.trim();
  if (!line || line.charAt(0) === ':') return null;
  if (line.indexOf('data:') !== 0) return null;
  const payload = line.slice(5).trim();
  if (payload === '[DONE]') return DONE_FRAME;
  try { return JSON.parse(payload); } catch (e) { return null; }
}

/** Stream a chat completion and hand back the NON-streaming shape.
 *  `ac` aborts it (a watchdog, or the port closing under us). */
async function streamChat(base, body, ac, onProgress) {
  // The page's body arrives WITHOUT these. Streaming is the worker's
  // business: it sets the flags itself and overrides whatever it was sent.
  // include_usage makes LM Studio put a real usage object (reasoning_tokens
  // and all) in the last frame before [DONE], so nothing is lost by streaming.
  const outgoing = Object.assign({}, body, {
    stream: true,
    stream_options: { include_usage: true }
  });

  const shoot = (payload) => fetch(base + CHAT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: ac.signal
  });

  let content = '';
  let role = 'assistant';
  let finishReason = null;
  let usage = null;
  let meta = null;
  let deltas = 0;
  // Tool calls, one slot per `index`. A sparse array on purpose: the model
  // may open call 1 before call 0's arguments are complete, and the index in
  // the delta is the only thing that says which call a fragment belongs to.
  const toolCalls = [];
  let argChars = 0;        // streamed argument text — progress counts it too
  // A server can fail AFTER the 200 and the event-stream header — the model
  // was unloaded mid-generation, the engine died — and then the last frame
  // is `data: {"error": …}` with no `choices`. Dropping it would hand the
  // page an empty reply with no reason; keep it and report it as a body.
  let streamError = null;

  let lastPost = 0;
  const post = (force) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastPost < PROGRESS_MS) return;
    lastPost = now;
    // A model writing a document INTO a tool call (create_page/edit_page)
    // produces no `content` at all; without argChars the page would show a
    // dead counter through the whole generation.
    onProgress({ chars: content.length + argChars, tokens: deltas });
  };

  const applyToolCall = (tc) => {
    if (!tc || typeof tc !== 'object') return;
    const i = Number.isInteger(tc.index) ? tc.index : 0;
    if (!toolCalls[i]) toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } };
    const slot = toolCalls[i];
    if (tc.id) slot.id = tc.id;
    if (tc.type) slot.type = tc.type;
    const fn = tc.function || {};
    if (fn.name) slot.function.name = fn.name;
    if (typeof fn.arguments === 'string' && fn.arguments) {
      slot.function.arguments += fn.arguments;
      argChars += fn.arguments.length;
      deltas++;
    }
  };

  const apply = (frame) => {
    if (!meta && frame.id) meta = { id: frame.id, model: frame.model, created: frame.created };
    if (frame.usage) usage = frame.usage; // include_usage: the final frame
    const ch = frame.choices && frame.choices[0];
    if (!ch) {
      if (frame.error) streamError = frame.error;
      return;
    }
    const d = ch.delta || {};
    if (d.role) role = d.role;
    if (typeof d.content === 'string' && d.content) { content += d.content; deltas++; }
    if (Array.isArray(d.tool_calls)) d.tool_calls.forEach(applyToolCall);
    if (ch.finish_reason) finishReason = ch.finish_reason;
  };

  // The watchdogs are armed BEFORE the request goes out. Until the first
  // bytes of the stream arrive the model is reading the prompt, and that
  // silence gets the server's own ceiling (FIRST_FRAME_MS); from then on
  // silence means a stuck model and is caught quickly (STREAM_IDLE_MS). The
  // heartbeat beats through both — it is what resets the PAGE's ceiling and
  // the MV3 worker's idle timer while the model is still reading.
  let started = false;
  let timedOut = null;     // the watchdog that fired, if one did
  let idle = null;
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      timedOut = timeoutError(started ? STREAM_IDLE_REASON : FIRST_FRAME_REASON);
      ac.abort();
    }, started ? STREAM_IDLE_MS : FIRST_FRAME_MS);
  };
  const beat = setInterval(() => post(true), HEARTBEAT_MS);

  let reader = null;
  let res;
  try {
    bump();
    res = await shoot(outgoing);
    if (!res.ok) {
      const text = await res.text();
      // Some OpenAI-compatible servers VALIDATE unknown params instead of
      // ignoring them, and stream_options is newer than some of them. Retry
      // once without it: the only thing lost is the usage object.
      if (res.status === 400 && text.indexOf('stream_options') !== -1) {
        res = await shoot(Object.assign({}, body, { stream: true }));
      } else {
        let data;
        try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
        return { ok: false, status: res.status, data };
      }
    }

    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    // A server that ignored `stream`, or an error body (LM Studio answers those
    // as application/json): read it whole instead of failing.
    if (!res.body || !res.body.getReader || ctype.indexOf('text/event-stream') === -1) {
      return await readWholeBody(res);
    }

    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';            // the tail of a chunk that cut a frame in half
    let ended = false;
    for (;;) {
      const step = await reader.read();
      started = true;
      bump(); // silence is what we cap, not how long the answer takes
      if (step.done) break;
      // {stream:true} also rejoins a multi-byte character split across chunks
      // — Hebrew arrives two or three bytes at a time and WILL be cut.
      buf += decoder.decode(step.value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1); // whatever is left is a partial frame: keep it
        const frame = parseFrame(line);
        if (frame === DONE_FRAME) { ended = true; break; }
        if (frame) apply(frame);
      }
      post(false);
      if (ended) break;
    }
    // A last line with no trailing newline still counts.
    if (!ended && buf) {
      const frame = parseFrame(buf);
      if (frame && frame !== DONE_FRAME) apply(frame);
    }
  } catch (e) {
    // the generic AbortError becomes the watchdog's own sentence
    if (timedOut && e && e.name === 'AbortError') throw timedOut;
    throw e;
  } finally {
    clearInterval(beat);
    clearTimeout(idle);
    if (reader) { try { reader.cancel(); } catch (e) { /* already closed */ } }
  }

  post(true);

  // An error frame and nothing else: the same shape a non-2xx body takes, so
  // the page resolves it as a result and the CMS says why in Hebrew (a string
  // error is wrapped as { message } — the shape readRelayReply reads).
  if (streamError && !content && !toolCalls.length) {
    const error = streamError && typeof streamError === 'object' ? streamError : { message: String(streamError) };
    return { ok: false, status: res.status, data: { error } };
  }

  // EXACTLY what a non-streaming call returns. Nothing downstream — the CMS,
  // the popup, src/ai.js — can tell that a stream happened. `tool_calls` is
  // present only when the model made one: a plain text reply keeps the
  // 0.4.0 shape byte for byte (the CMS treats an absent key and `[]` alike).
  const message = { role, content, ...(toolCalls.length ? { tool_calls: toolCalls.filter(Boolean) } : {}) };
  const data = {
    id: meta && meta.id,
    object: 'chat.completion',
    created: (meta && meta.created) || Math.floor(Date.now() / 1000),
    model: meta && meta.model,
    choices: [{ index: 0, message, finish_reason: finishReason }]
  };
  if (usage) data.usage = usage;
  return { ok: res.ok, status: res.status, data };
}

/** The one-shot path: /v1/models, and chat from an OLD content script that
 *  has not been reloaded since the upgrade — it gets the same assembled
 *  answer, just without progress. */
async function relay(msg) {
  const path = String(msg.path || '');
  const pre = await preflight(path);
  if (pre.error) return { ok: false, error: pre.error };
  const ac = new AbortController();
  try {
    if (path === CHAT_PATH) return await streamChat(pre.base, msg.body || {}, ac, null);
    return await plainFetch(pre.base, path, msg.body, ac);
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

/* ── connected sites: the record that outlives a Reload ──────────────────
 * The popup writes { id, pattern } for every site it connects and removes it
 * on disconnect. The worker reconciles the record with the browser's live
 * registrations every time it boots. Nothing here asks for a permission —
 * that needs the owner's click in the popup; a site whose grant is gone is
 * left in the record so the popup can offer to reconnect it. */

async function readSites() {
  try {
    const r = await B.storage.local.get([SITES_KEY]);
    const list = Array.isArray(r[SITES_KEY]) ? r[SITES_KEY] : [];
    return list.filter((s) => s && typeof s.id === 'string' && s.id.indexOf(SCRIPT_PREFIX) === 0 &&
      typeof s.pattern === 'string' && /^https?:\/\/[^/]+\/\*$/.test(s.pattern));
  } catch (e) {
    return [];
  }
}

/** getRegisteredContentScripts REJECTS in some builds instead of answering
 *  [] — the same defensive catch the popup keeps. */
async function liveBridgeScripts() {
  try {
    const all = await B.scripting.getRegisteredContentScripts();
    return (all || []).filter((s) => s && typeof s.id === 'string' && s.id.indexOf(SCRIPT_PREFIX) === 0);
  } catch (e) {
    return [];
  }
}

async function hasSitePermission(pattern) {
  try {
    return await B.permissions.contains({ origins: [pattern] });
  } catch (e) {
    return false;
  }
}

/** The registration the popup makes, byte for byte — one shape, two writers. */
function bridgeRegistration(id, pattern) {
  return { id, js: ['content-bridge.js'], matches: [pattern], runAt: 'document_idle', persistAcrossSessions: true };
}

/** Reconcile the record with the browser: adopt live registrations the
 *  record does not know (a 0.5.0 install), then register every recorded
 *  site that is not live any more and still holds its host permission.
 *  Returns what happened, for the popup and the smoke. */
async function restoreSites() {
  const [recorded, live] = await Promise.all([readSites(), liveBridgeScripts()]);
  const record = recorded.slice();
  const known = new Set(record.map((s) => s.id));
  for (const s of live) {
    const pattern = Array.isArray(s.matches) ? s.matches[0] : '';
    if (!known.has(s.id) && pattern) { record.push({ id: s.id, pattern }); known.add(s.id); }
  }
  const liveIds = new Set(live.map((s) => s.id));
  const out = { restored: [], unpermitted: [], live: live.length };
  for (const site of record) {
    if (liveIds.has(site.id)) continue;
    if (!(await hasSitePermission(site.pattern))) { out.unpermitted.push(site.pattern); continue; }
    try {
      await B.scripting.registerContentScripts([bridgeRegistration(site.id, site.pattern)]);
      out.restored.push(site.pattern);
    } catch (e) {
      // a duplicate id means it IS registered — the outcome we wanted
      const again = await B.scripting.getRegisteredContentScripts({ ids: [site.id] }).catch(() => []);
      if (again && again.length) out.restored.push(site.pattern);
    }
  }
  if (record.length !== recorded.length) {
    try { await B.storage.local.set({ [SITES_KEY]: record }); } catch (e) { /* the next boot adopts again */ }
  }
  return out;
}

// Every boot of the worker — install, update, the Reload after a git pull,
// browser start, a wake after idle — puts the connected sites back.
const restoring = restoreSites().catch(() => ({ restored: [], unpermitted: [], live: 0 }));

B.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  // the popup asks the worker to reconcile now (after a connect/disconnect,
  // or to show which recorded sites lost their grant)
  if (msg.type === 'tz-restore-sites') {
    restoring.then(() => restoreSites()).then(sendResponse, () => sendResponse({ restored: [], unpermitted: [], live: 0 }));
    return true;
  }
  if (msg.type !== 'tz-local-llm') return;
  relay(msg).then(sendResponse);
  return true; // async response
});

/* The streaming channel. sendMessage is one question and one answer — it has
 * nowhere to put progress — so a chat request opens a port instead. */
B.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== PORT_NAME) return;

  const ac = new AbortController();
  let alive = true;
  const say = (m) => {
    if (!alive) return;
    try { port.postMessage(m); } catch (e) { alive = false; }
  };

  // The page went away — tab closed, navigated, reloaded. Abort the fetch:
  // a closed tab must not leave the GPU generating for nobody.
  port.onDisconnect.addListener(() => {
    alive = false;
    ac.abort();
  });

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'start') return;
    const path = String(msg.path || '');
    const pre = await preflight(path);
    if (pre.error) return say({ type: 'done', ok: false, error: pre.error });
    try {
      const out = path === CHAT_PATH
        ? await streamChat(pre.base, msg.body || {}, ac, (p) => say({ type: 'progress', chars: p.chars, tokens: p.tokens }))
        : await plainFetch(pre.base, path, msg.body, ac);
      say({ type: 'done', ok: out.ok, status: out.status, data: out.data });
    } catch (e) {
      if (!alive) return; // aborted because the page left; nobody to tell
      say({ type: 'done', ok: false, error: describeError(e) });
    }
  });
});
