'use strict';

/**
 * The window (v2.32) — the copilot fits the model it was actually given.
 *
 * Ben's copilot died on a Gemma loaded at 8,192 tokens: the briefing alone is
 * ~45K chars (≈15K tokens), so LM Studio answered
 *   `request (17246 tokens) exceeds the available context size (8192 tokens)`
 * — and that was the LUCKY case. Measured live (map.md, addendum 1): llama.cpp
 * only refuses when the prompt is at least TWICE the window. In the band
 *
 *     n_ctx ≤ n_prompt < 2·n_ctx
 *
 * it returns HTTP 200 with the MIDDLE of the prompt silently discarded (the
 * dictionary, the example, the contract, the older turns) and the model
 * answers something hollow or unrelated. Nobody sees an error. That band is
 * why this module exists, and why the probe here is not a nicety:
 *
 *   1. BEFORE sending, ask the runtime what it loaded — LM Studio's native
 *      `GET /api/v0/models` carries `loaded_context_length` per model (the
 *      OpenAI-shaped `/v1/models` carries only ids). Over the browser bridge
 *      the page probes and sends the number as a hint.
 *   2. AFTER every 200, compare `usage.prompt_tokens` with the known window:
 *      prompt_tokens > window PROVES the model answered from a halved prompt.
 *      The reply is discarded, the briefing goes one tier down, one retry.
 *   3. When the runtime does refuse (the 400), its body is machine-readable:
 *      n_prompt_tokens / n_ctx — learn the window from it, shrink, retry.
 *
 * Two briefing tiers only — `full` (the whole dictionary, ~45K chars) and
 * `compact` (one line per tool, ~10K chars). Ben's rule, verbatim: 32K is the
 * floor for page building; anything smaller is a degraded "talk + read +
 * short pages" mode that says so. The full tier is sent only when the window
 * is a PROBED / HINTED / LEARNED number ≥ 32,768 or the provider is a cloud
 * key. An advisory or unknown window never promotes to full — guessing wide
 * is how the silent halving happens.
 *
 * Nothing here is written to config/ai.json: what the runtime has loaded is a
 * fact about THIS minute, so it lives in memory with a TTL.
 */

const { resolveLocalEndpoint } = require('./providers');

const FULL_MIN_WINDOW_TOKENS = 32768;
const RECOMMENDED_WINDOW = 32768;
// what the chat template + the tool declarations' framing cost on top of the
// characters we can count
const TEMPLATE_HEADROOM_TOKENS = 384;
// chars per token for the briefing fit. Measured: Gemma 2.99 on the pure
// briefing, 2.7 with tools + "שלום"; Qwen 2.3 on the organizer pack. 2.6 is
// the conservative start; after any reply with usage the measured ratio for
// that model replaces it (clamped, below).
const DEFAULT_RATIO = 2.6;
const RATIO_MIN = 2.0;
const RATIO_MAX = 3.5;
const PROBE_TTL_MS = 60 * 1000;
const PROBE_TIMEOUT_MS = 4000;
const TURN_CAP_CHARS = 12000;
// the smallest window LM Studio offers in its own steps; the "too small"
// sentence never asks for less than this
const MIN_USEFUL_WINDOW = 8192;

// the native fetch, captured at load: a smoke that swaps global.fetch for a
// scripted provider must never see the probe's GET land in its script
const NATIVE_FETCH = globalThis.fetch;

// key → { tokens, maxTokens, source, ratio, at, model, jit, bridgeVersion, loaded }
const windows = new Map();

function windowKey(providerId, model) {
  return String(providerId || '') + '|' + String(model || '').trim();
}

function clampRatio(r) {
  const n = Number(r);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RATIO;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, n));
}

const fmt = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : String(n));

// ── discovery ───────────────────────────────────────────────────────────

/** Does this runtime id name the model the owner configured? Loosely: the
 *  owner types `gemma-4-31b`, LM Studio reports `google/gemma-4-31b`. */
function idMatches(id, model) {
  const a = String(id || '').toLowerCase();
  const b = String(model || '').trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.endsWith('/' + b) || a.endsWith(b) || a.startsWith(b) || b.endsWith(a) || b.startsWith(a);
}

/**
 * Ask LM Studio what it has loaded — `GET {origin}/api/v0/models`, 4 s.
 * Never throws: null means "not LM Studio, or not reachable" (Ollama, vLLM
 * and llama.cpp's server do not serve this route). `jit:true` means the
 * configured model is NOT loaded: LM Studio's justInTimeModelLoading will
 * load it on the first request with the GUI's default context (8,192 on
 * Ben's box), so the UI can warn before that happens.
 * @param {string} baseUrl the owner's local address (loopback enforced)
 * @param {string} model the configured model id ('' = whatever is loaded)
 * @param {{fetch?: Function}} [opts] a test seam
 * @returns {Promise<{tokens: number|null, maxTokens: number|null, model: string, jit: boolean, loaded: string[]}|null>}
 */
async function probeLocalWindow(baseUrl, model, opts = {}) {
  const endpoint = resolveLocalEndpoint(baseUrl);
  if (!endpoint) return null;
  let origin;
  try { origin = new URL(endpoint).origin; } catch (e) { return null; }
  const doFetch = typeof opts.fetch === 'function' ? opts.fetch : NATIVE_FETCH;
  if (typeof doFetch !== 'function') return null;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS) : null;
  try {
    const r = await doFetch(origin + '/api/v0/models', ctrl ? { signal: ctrl.signal } : {});
    if (!r || !r.ok) return null;
    const data = await r.json();
    const all = Array.isArray(data && data.data) ? data.data : [];
    // embedding models load too; only a chat model's window matters. `type`
    // is 'llm', 'vlm' (a vision-capable chat model — gemma-4-31b and every
    // qwen3.x on the measured box report 'vlm') or 'embeddings' — so this is
    // a DENYLIST of the embeddings kind: an allowlist of 'llm' alone would
    // hide every real model on Ben's box and the probe would swear nothing
    // is loaded.
    const llms = all.filter((m) => m && m.id && !/^embed/i.test(String(m.type || '')));
    const loadedList = llms.filter((m) => m.state === 'loaded');
    const loaded = loadedList.map((m) => String(m.id));
    const want = String(model || '').trim();
    let entry = null;
    if (want) {
      entry = loadedList.find((m) => idMatches(m.id, want)) || null;
      if (!entry) {
        // configured and KNOWN to LM Studio but not loaded → JIT on the first
        // request, at the GUI default. A name LM Studio does not know at all
        // (the 'local-model' placeholder the settings and the bridge fall
        // back to) is not a JIT candidate — the runtime will serve whatever
        // it has loaded, so that loaded entry's window is the one that counts.
        const known = llms.find((m) => idMatches(m.id, want)) || null;
        if (known || !loadedList.length) {
          return {
            tokens: null,
            maxTokens: known && Number(known.max_context_length) > 0 ? Number(known.max_context_length) : null,
            model: known ? String(known.id) : want,
            jit: true,
            loaded
          };
        }
        entry = loadedList[0];
      }
    } else {
      entry = loadedList.length ? loadedList[0] : null;
      if (!entry) return { tokens: null, maxTokens: null, model: '', jit: true, loaded };
    }
    const tokens = Number(entry.loaded_context_length);
    return {
      tokens: Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : null,
      maxTokens: Number(entry.max_context_length) > 0 ? Number(entry.max_context_length) : null,
      model: String(entry.id),
      jit: false,
      loaded
    };
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The runtime's refusal, machine-read. LM Studio's body is exact:
 * `{error:{code:400, message:"request (N tokens) exceeds the available
 * context size (M tokens), try increasing it", type:"exceed_context_size_error",
 * n_prompt_tokens:N, n_ctx:M}}`. Numbers come from the fields, else from the
 * message — a proxy that keeps only the text still teaches us the window.
 * @returns {{nPrompt: number, nCtx: number}|null}
 */
function parseExceed(data) {
  const err = data && typeof data === 'object' ? data.error : null;
  if (!err) return null;
  const isObj = typeof err === 'object';
  const msg = isObj ? String(err.message || '') : String(err);
  const typed = isObj && err.type === 'exceed_context_size_error';
  if (!typed && !/exceeds the available context size/i.test(msg)) return null;
  let nPrompt = isObj ? Number(err.n_prompt_tokens) : NaN;
  let nCtx = isObj ? Number(err.n_ctx) : NaN;
  if (!(nPrompt > 0) || !(nCtx > 0)) {
    const m = /request\s*\((\d+)\s*tokens\)[^()]*\((\d+)\s*tokens\)/i.exec(msg);
    if (m) {
      if (!(nPrompt > 0)) nPrompt = Number(m[1]);
      if (!(nCtx > 0)) nCtx = Number(m[2]);
    }
  }
  if (!(nCtx > 0)) return null;
  return { nPrompt: nPrompt > 0 ? Math.round(nPrompt) : 0, nCtx: Math.round(nCtx) };
}

// ── the cache ───────────────────────────────────────────────────────────

/**
 * Remember a window. `source` is where the number came from, in order of
 * trust: 'probe' (the runtime said so, TTL 60 s) · 'hint' (the page probed
 * through the bridge) · 'error' (the runtime's refusal named it). A probe
 * with tokens null (JIT — not loaded yet) is remembered for its `jit` flag
 * and re-probed on the next turn. 'error' and 'hint' persist until a later
 * probe or hint disagrees, or the model id changes (it is in the key).
 */
function noteWindow(key, tokens, source, extra) {
  const k = String(key || '');
  const prev = windows.get(k) || {};
  const n = Number(tokens);
  const has = Number.isFinite(n) && n > 0;
  const entry = {
    ...prev,
    ...(extra && typeof extra === 'object' ? extra : {}),
    tokens: has ? Math.round(n) : null,
    source: String(source || 'unknown'),
    ratio: clampRatio(prev.ratio),
    at: Date.now()
  };
  if (!extra || extra.jit === undefined) entry.jit = false;
  windows.set(k, entry);
  return entry;
}

/** Drop a remembered window of one source (the page stopped sending its hint). */
function forgetWindow(key, source) {
  const k = String(key || '');
  const e = windows.get(k);
  if (!e) return;
  if (!source || e.source === source) {
    // keep the calibration — the ratio is about the model, not the window
    windows.set(k, { ratio: e.ratio, source: 'unknown', tokens: null, at: Date.now() });
  }
}

/**
 * Calibrate chars-per-token for this model from a real usage object. The
 * clamp keeps one odd reply (a tool-heavy turn, a mostly-English page) from
 * throwing the fit off by more than the measured spread across models.
 */
function noteUsage(key, sentChars, promptTokens) {
  const k = String(key || '');
  const c = Number(sentChars);
  const t = Number(promptTokens);
  if (!(c > 0) || !(t > 0)) return null;
  const prev = windows.get(k) || { tokens: null, source: 'unknown', at: 0 };
  const entry = { ...prev, ratio: clampRatio(c / t) };
  windows.set(k, entry);
  return entry.ratio;
}

/**
 * @returns {{tokens: number|null, source: string, ratio: number, maxTokens: number|null, at: number, fresh: boolean, jit: boolean, model?: string, bridgeVersion?: string}}
 */
function getWindow(key) {
  const e = windows.get(String(key || ''));
  if (!e) return { tokens: null, source: 'unknown', ratio: DEFAULT_RATIO, maxTokens: null, at: 0, fresh: false, jit: false };
  const has = Number.isFinite(e.tokens) && e.tokens > 0;
  return {
    tokens: has ? e.tokens : null,
    source: has ? e.source : 'unknown',
    ratio: clampRatio(e.ratio),
    maxTokens: Number.isFinite(e.maxTokens) && e.maxTokens > 0 ? e.maxTokens : null,
    at: e.at || 0,
    // a probe is trusted for a minute; a hint/error until contradicted
    fresh: has && (e.source !== 'probe' || Date.now() - (e.at || 0) < PROBE_TTL_MS),
    jit: !!e.jit,
    model: e.model || '',
    bridgeVersion: e.bridgeVersion || ''
  };
}

/** The freshest known window for a provider, any model — what contextBudget
 *  (the injection runner's gate) asks for. */
function knownWindowFor(providerId) {
  const prefix = String(providerId || '') + '|';
  let best = null;
  for (const [k, e] of windows) {
    if (!k.startsWith(prefix)) continue;
    if (!(Number.isFinite(e.tokens) && e.tokens > 0)) continue;
    if (!best || (e.at || 0) > (best.at || 0)) best = { key: k, tokens: e.tokens, source: e.source, at: e.at || 0 };
  }
  return best;
}

// ── arithmetic ──────────────────────────────────────────────────────────

/** Tokens kept for the answer: a quarter of the window, never under 1,024
 *  (a short page) and never over 4,096 (what the local provider always
 *  allowed). Infinity (a cloud key) → 4,096. */
function replyReserve(tokens) {
  const n = Number(tokens);
  if (!Number.isFinite(n) || n <= 0) return 4096;
  return Math.min(4096, Math.max(1024, Math.floor(n / 4)));
}

function promptBudgetTokens(tokens) {
  const n = Number(tokens);
  if (n === Infinity) return Infinity;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n - replyReserve(n) - TEMPLATE_HEADROOM_TOKENS;
}

const TRUSTED_SOURCES = ['probe', 'hint', 'error'];

/**
 * Which briefing fits. `sizes` = chars of the two briefings; `fixedChars` =
 * what rides in every request regardless of tier (the tool declarations +
 * the current message). `roomChars` is what is left for history and
 * read-back pages.
 * @returns {{tier: 'full'|'compact'|null, roomChars: number, promptTokens: number, budget: number}}
 */
function pickTier({ tokens, source, ratio, sizes, fixedChars } = {}) {
  const r = clampRatio(ratio);
  const fixed = Math.max(0, Number(fixedChars) || 0);
  const full = Math.max(0, Number((sizes || {}).full) || 0);
  const compact = Math.max(0, Number((sizes || {}).compact) || full);
  const est = (chars) => Math.ceil(chars / r);
  if (tokens === Infinity || source === 'cloud') {
    return { tier: 'full', roomChars: Infinity, promptTokens: est(full + fixed), budget: Infinity };
  }
  const budget = promptBudgetTokens(tokens);
  const n = Number(tokens);
  const trusted = TRUSTED_SOURCES.includes(String(source || ''));
  const fullTokens = est(full + fixed);
  // Ben's floor: the whole dictionary only into a window we KNOW is ≥ 32K.
  if (trusted && n >= FULL_MIN_WINDOW_TOKENS && fullTokens <= budget) {
    return { tier: 'full', roomChars: Math.floor((budget - fullTokens) * r), promptTokens: fullTokens, budget };
  }
  const compactTokens = est(compact + fixed);
  if (budget > 0 && compactTokens <= budget) {
    return { tier: 'compact', roomChars: Math.floor((budget - compactTokens) * r), promptTokens: compactTokens, budget };
  }
  return { tier: null, roomChars: 0, promptTokens: compactTokens, budget };
}

/** The smallest window in which a prompt of `promptTokens` fits with its
 *  reply reserve — what the "too small" sentence asks for, rounded up to a
 *  1,024 step and never under LM Studio's smallest useful setting. */
function minWindowFor(promptTokens) {
  const p = Math.max(0, Number(promptTokens) || 0);
  // reserve is n/4 in the band that matters, so n ≥ (p + headroom) · 4/3
  const n = Math.ceil((p + TEMPLATE_HEADROOM_TOKENS) * 4 / 3);
  return Math.max(MIN_USEFUL_WINDOW, Math.ceil(n / 1024) * 1024);
}

/** How many chars of an existing page may be read back into a turn: 70% of
 *  what is left after the briefing, the tools and the history — the other
 *  30% is JSON escaping and the model's own answer about it. */
function editAllowance(roomAfterHistoryChars) {
  const n = Number(roomAfterHistoryChars);
  if (n === Infinity) return Infinity;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n * 0.7);
}

// ── history ─────────────────────────────────────────────────────────────

function chunkChars(t) {
  if (!t || typeof t !== 'object') return 0;
  let n = typeof t.content === 'string' ? t.content.length : (t.content == null ? 0 : JSON.stringify(t.content).length);
  if (Array.isArray(t.tool_calls)) n += JSON.stringify(t.tool_calls).length;
  return n;
}

function turnsChars(turns) {
  return (Array.isArray(turns) ? turns : []).reduce((sum, t) => sum + chunkChars(t), 0);
}

/**
 * Fit a conversation into `roomChars` (§0.7 of the v2.32 contract):
 *  - non-string / empty / whitespace turns are dropped (an empty assistant
 *    turn — what the 0.4.0 bridge produced — poisoned the next turn)
 *  - consecutive same-role plain turns merge with a blank line
 *  - the history never starts with an assistant turn or an orphan tool answer
 *  - an assistant turn that called tools + its tool answers travel as ONE
 *    unit — a call without its answer (or the reverse) is a protocol error
 *    at every provider
 *  - walk newest → oldest, per plain turn capped at min(12,000, room); a unit
 *    is kept whole or the walk stops (a sliced JSON tool result is garbage)
 *  - the newest unit (the current message) is always kept
 */
function fitTurns(turns, roomChars) {
  const room = roomChars === Infinity ? Infinity : Math.max(0, Number(roomChars) || 0);
  const cap = Math.min(TURN_CAP_CHARS, room);

  const clean = [];
  for (const t of (Array.isArray(turns) ? turns : [])) {
    if (!t || typeof t !== 'object') continue;
    const role = t.role;
    if (role === 'tool') { if (typeof t.content === 'string') clean.push(t); continue; }
    if (role !== 'user' && role !== 'assistant') continue;
    if (role === 'assistant' && Array.isArray(t.tool_calls) && t.tool_calls.length) { clean.push(t); continue; }
    if (Array.isArray(t.content) && t.content.length) { clean.push(t); continue; } // anthropic blocks
    if (typeof t.content !== 'string' || !t.content.trim()) continue;
    clean.push({ role, content: t.content });
  }

  // group into units
  const units = [];
  let i = 0;
  while (i < clean.length) {
    const t = clean[i];
    if (t.role === 'assistant' && Array.isArray(t.tool_calls) && t.tool_calls.length) {
      const u = [t];
      i++;
      while (i < clean.length && clean[i].role === 'tool') u.push(clean[i++]);
      units.push({ turns: u, unit: true });
      continue;
    }
    if (t.role === 'assistant' && Array.isArray(t.content)) {
      const u = [t];
      i++;
      if (i < clean.length && clean[i].role === 'user' && Array.isArray(clean[i].content)) u.push(clean[i++]);
      units.push({ turns: u, unit: true });
      continue;
    }
    if (t.role === 'tool' || Array.isArray(t.content)) { i++; continue; } // orphan answer
    const last = units[units.length - 1];
    if (last && !last.unit && last.turns[0].role === t.role) {
      last.turns[0] = { role: t.role, content: last.turns[0].content + '\n\n' + t.content };
      i++;
      continue;
    }
    units.push({ turns: [{ role: t.role, content: t.content }], unit: false });
    i++;
  }

  // newest → oldest within the room
  const kept = [];
  let left = room;
  for (let k = units.length - 1; k >= 0; k--) {
    const u = units[k];
    const current = k === units.length - 1;
    if (!u.unit) {
      let content = u.turns[0].content;
      const limit = current ? TURN_CAP_CHARS : cap;
      if (content.length > limit) content = content.slice(0, limit);
      if (!current && content.length > left) break;
      kept.unshift({ role: u.turns[0].role, content });
      left -= content.length;
    } else {
      const size = turnsChars(u.turns);
      if (!current && size > left) break;
      kept.unshift(...u.turns);
      left -= size;
    }
  }

  // never open with the model's own voice or a dangling tool answer
  while (kept.length && !(kept[0].role === 'user' && typeof kept[0].content === 'string')) kept.shift();
  return kept;
}

// ── Hebrew (the one place; the routes and pages reuse, never re-type) ───

const FIX_WINDOW = 'LM Studio → My Models → ⚙ ליד המודל → Context Length → 32768 → Reload, ואז שלחו את ההודעה שוב.';
const FIX_BRIDGE = 'הורידו את Bridge V2 0.5.0 מחיבור AI (/admin/ai-setup), טענו מחדש ב-chrome://extensions (או about:debugging ב-Firefox) ורעננו את הדף. אם המודל טעון עם חלון של 8K — הגדילו ל-32768.';

const HE = {
  fixWindow: FIX_WINDOW,
  fixBridge: FIX_BRIDGE,
  tooSmall: (nPrompt, nCtx) =>
    'הבקשה (' + fmt(nPrompt) + ' טוקנים) לא נכנסת בחלון של המודל (' + fmt(nCtx) + ') גם במצב המקוצר.',
  // {bridgeVersion} is what the bridge said in its hello; an unknown version
  // (a bridge older than the hint itself) leaves the sentence without a number
  bridgeTooOld: (v) =>
    'המודל דחה את הבקשה בלי פרטים (HTTP 400) והתוסף Bridge V2 ' + (v ? v + ' ' : '') + 'לא מעביר את הסיבה.',
  bridgeDroppedTools: (v) =>
    'המודל ניסה להפעיל כלי (לקרוא או לערוך דף) אבל התוסף Bridge V2 ' + (v ? v + ' ' : '') + 'מאבד את הקריאה בדרך.',
  shrink: (nCtx, nPrompt) =>
    'המודל טעון עם חלון של ' + fmt(nCtx) + ' טוקנים והבקשה הייתה ' + fmt(nPrompt) + ' — מקצר את התדריך ומנסה שוב…',
  shrinkBlind: 'המודל דחה את הבקשה (HTTP 400) בלי לומר למה — מקצר את התדריך ומנסה שוב…',
  replyCut: 'התשובה נחתכה באמצע — המודל הגיע לסוף החלון. הגדילו את Context Length ב-LM Studio, או בקשו דף קצר יותר.',
  emptyReply: 'המודל החזיר תשובה ריקה — נסו שוב; אם זה חוזר, בדקו ב-LM Studio שהחלון גדול מ-8K ושה-reasoning כבוי.',
  modelNotLoaded: 'המודל שביקשתם לא טעון ב-LM Studio — השאירו את שדה המודל ריק או טענו אותו',
  readTooLong: (chars, limit) =>
    'המסמך (' + fmt(chars) + ' תווים) גדול מחלון ההקשר של המודל (מותר ' + fmt(limit) + ') — ' +
    'אמור/י לבעל/ת האתר להגדיל את Context Length ב-LM Studio, או הצע/י שינוי שלא דורש את כל הדף.',
  memoProposed: (summary) => 'הצעתי: ' + summary + ' — ממתין לאישור',
  memoCreated: (slug) => 'בוצע: נוצר הדף "' + slug + '" כטיוטה',
  memoEdited: (slug) => 'בוצע: הדף "' + slug + '" עודכן כטיוטה',
  memoWarnings: (n) => ' · ' + fmt(n) + ' אזהרות',
  memoRefused: (summary) => 'בעל/ת האתר דחה/תה את ההצעה: ' + summary,
  memoRead: (used) => 'קראתי: ' + used.join(', '),
  tierHe: (tier) => (tier === 'full' ? 'מלא' : tier === 'compact' ? 'מקוצר' : 'קטן מדי')
};

/**
 * One Hebrew sentence about the window, for the welcome bubble, the chip's
 * tooltip and the setup screen. Numbers are en-US formatted (8,192).
 */
function describeWindow({ tokens, source, tier, model, bridgeVersion, jit, editMaxChars, minTokens } = {}) {
  const name = String(model || '').trim();
  const who = 'המודל ' + (name ? name + ' ' : '');
  const n = Number(tokens);
  const known = Number.isFinite(n) && n > 0;
  const loadLine = '(או בטרמינל: lms load ' + (name || '<model>') + ' --context-length 32768)';
  const compactTail = (t) =>
    'הקופיילוט עובד במצב מקוצר: יוצר דפים קצרים, אבל דף קיים ארוך מ-~' +
    fmt(Number.isFinite(Number(editMaxChars)) && Number(editMaxChars) > 0 ? Number(editMaxChars) : editAllowance(pickTier({ tokens: t, source: 'probe', sizes: { full: 45400, compact: 10500 }, fixedChars: 1500 }).roomChars)) +
    ' תווים לא ייכנס לעריכה. להרחבה: LM Studio → My Models → ⚙ ליד המודל → Context Length → 32768 → Reload ' + loadLine + '.';

  if (tier === null && known) {
    return 'החלון של המודל (' + fmt(n) + ' טוקנים) קטן מדי לקופיילוט — צריך לפחות ' +
      fmt(minTokens || FULL_MIN_WINDOW_TOKENS) + '. הגדילו את Context Length ב-LM Studio (My Models → ⚙ ליד המודל → 32768 → Reload) ונסו שוב.';
  }
  if (tokens === Infinity || source === 'cloud') {
    return 'ספק ענן' + (name ? ' (' + name + ')' : '') + ' — הקופיילוט עובד עם המילון המלא.';
  }
  if (jit && !known) {
    return who + 'עדיין לא טעון — LM Studio יטען אותו אוטומטית בבקשה הראשונה עם ברירת המחדל שלו (לרוב 8,192) — ' +
      compactTail(MIN_USEFUL_WINDOW);
  }
  if (!known) {
    return 'לא הצלחתי לקרוא את גודל החלון של המודל (תוסף Bridge V2 ישן מ-0.5.0' +
      (bridgeVersion ? ' — אצלכם ' + bridgeVersion : '') +
      ', או שרת שאינו LM Studio) — עובד במצב מקוצר; אם המודל ידחה בקשה, אקטין אותה אוטומטית.';
  }
  if (tier === 'full' || (tier === undefined && n >= FULL_MIN_WINDOW_TOKENS)) {
    return who + 'טעון עם ' + fmt(n) + ' טוקנים — הקופיילוט עובד עם המילון המלא.';
  }
  const prefix = jit ? 'המודל נטען אוטומטית לפי בקשה עם ברירת המחדל של LM Studio (' + fmt(n) + ') — ' : '';
  return prefix + who + 'טעון עם ' + fmt(n) + ' טוקנים — ' + compactTail(n);
}

module.exports = {
  FULL_MIN_WINDOW_TOKENS,
  TEMPLATE_HEADROOM_TOKENS,
  DEFAULT_RATIO,
  RECOMMENDED_WINDOW,
  PROBE_TTL_MS,
  probeLocalWindow,
  parseExceed,
  noteWindow,
  forgetWindow,
  noteUsage,
  getWindow,
  knownWindowFor,
  replyReserve,
  promptBudgetTokens,
  pickTier,
  minWindowFor,
  editAllowance,
  fitTurns,
  turnsChars,
  describeWindow,
  windowKey,
  HE
};
