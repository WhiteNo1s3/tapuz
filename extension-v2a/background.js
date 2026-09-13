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
const ALLOWED_PATHS = ['/v1/chat/completions', '/v1/models'];

const CHAT_PATH = '/v1/chat/completions';

// The streaming channel. One connection per chat request.
const PORT_NAME = 'tz-llm';

// A server that accepted the socket and then stopped talking must not leave
// the popup spinning forever. The probe is impatient; a generation is not.
const TIMEOUT_MS = { '/v1/models': 15000 };
const DEFAULT_TIMEOUT_MS = 300000;

// For a STREAM the meaningful limit is silence, not duration: a model that is
// visibly writing is never cut off, however long it takes, and one that has
// stopped talking is caught quickly.
const STREAM_IDLE_MS = 120000;

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
  if (e && e.name === 'AbortError') return 'המודל המקומי לא ענה בזמן — בדקו את LM Studio';
  // The classic here is "LM Studio isn't running" / server not started.
  return 'local model unreachable: ' + (e && e.message);
}

async function readWholeBody(res) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

/** Non-streaming call — /v1/models, and the fallback for a server that
 *  ignores `stream`. */
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
 *  `ac` aborts it (idle watchdog, or the port closing under us). */
async function streamChat(base, body, ac, onProgress) {
  // The page's body arrives WITHOUT these. Streaming is the worker's
  // business: it sets the flags itself and overrides whatever it was sent.
  // include_usage makes LM Studio put a real usage object (reasoning_tokens
  // and all) in the last frame before [DONE], so nothing is lost by streaming.
  const outgoing = Object.assign({}, body, {
    stream: true,
    stream_options: { include_usage: true }
  });

  const res = await fetch(base + CHAT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(outgoing),
    signal: ac.signal
  });

  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  // A server that ignored `stream`, or an error body (LM Studio answers those
  // as application/json): read it whole instead of failing.
  if (!res.body || !res.body.getReader || ctype.indexOf('text/event-stream') === -1) {
    return await readWholeBody(res);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';            // the tail of a chunk that cut a frame in half
  let content = '';
  let role = 'assistant';
  let finishReason = null;
  let usage = null;
  let meta = null;
  let deltas = 0;
  let ended = false;

  let lastPost = 0;
  const post = (force) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastPost < PROGRESS_MS) return;
    lastPost = now;
    onProgress({ chars: content.length, tokens: deltas });
  };

  const apply = (frame) => {
    if (!meta && frame.id) meta = { id: frame.id, model: frame.model, created: frame.created };
    if (frame.usage) usage = frame.usage; // include_usage: the final frame
    const ch = frame.choices && frame.choices[0];
    if (!ch) return;
    const d = ch.delta || {};
    if (d.role) role = d.role;
    if (typeof d.content === 'string' && d.content) { content += d.content; deltas++; }
    if (ch.finish_reason) finishReason = ch.finish_reason;
  };

  const beat = setInterval(() => post(true), HEARTBEAT_MS);
  let idle = null;
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ac.abort(), STREAM_IDLE_MS);
  };

  try {
    bump();
    for (;;) {
      const step = await reader.read();
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
  } finally {
    clearInterval(beat);
    clearTimeout(idle);
    try { reader.cancel(); } catch (e) { /* already closed */ }
  }

  post(true);

  // EXACTLY what a non-streaming call returns. Nothing downstream — the CMS,
  // the popup, src/ai.js — can tell that a stream happened.
  const data = {
    id: meta && meta.id,
    object: 'chat.completion',
    created: (meta && meta.created) || Math.floor(Date.now() / 1000),
    model: meta && meta.model,
    choices: [{ index: 0, message: { role, content }, finish_reason: finishReason }]
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

B.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tz-local-llm') return;
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
