/* Tapuziel — the page side of Bridge V2 (extension-v2a), shared by every
 * admin surface that talks to the copilot (/admin/chat, the builder drawer,
 * the injection cards).
 *
 * The extension's content script announces itself with tz-bridge-hello and
 * answers tz-bridge-ping; requests are correlated by id. The page names a
 * PATH from the extension's closed list — never a host: the loopback
 * endpoint belongs to the extension alone.
 *
 * DOM events for the UIs: 'tapuz-bridge-hello' fires once when the bridge
 * first announces, 'tapuz-bridge-models' when the loaded-model list arrives,
 * 'tapuz-bridge-window' (0.5.0) when the window probe has settled — with
 * `TapuzBridge.window` filled, or still null when the bridge is older than
 * 0.5.0 or the server is not LM Studio.
 *
 * WHY THE PAGE PROBES THE WINDOW (v2.32): LM Studio loads a model with the
 * GUI default of 8,192 tokens unless told otherwise, and a prompt between
 * 1× and 2× that window is answered HTTP 200 with the MIDDLE of the prompt
 * silently dropped — the copilot's dictionary, its example, the older turns.
 * The 400 with the numbers in it only comes at ≥ 2×. So the server must know
 * the window BEFORE it composes the briefing, and the only place that can
 * ask the owner's machine is this page, through the bridge: LM Studio's
 * native /api/v0/models reports `loaded_context_length` per model. The hint
 * rides the chat POST as `window`; the server picks the briefing tier from
 * it and never trusts an advisory number for the full dictionary.
 *
 * WHY AN ERROR BODY IS A RESULT (0.5.0): the same 400 carries n_prompt_tokens
 * and n_ctx. Rejecting it here would turn machine-readable numbers into the
 * string "no response"; resolving it hands the body to the server as the
 * step's result, and the server — the one place that knows the briefing
 * tiers — shrinks and retries. The page never judges a model reply.
 */
(function () {
  'use strict';

  var waiting = new Map();
  var seq = 0;

  /** The page's own ceiling for one relayed call when the route sent none.
   *  It measures SILENCE — every progress message from the bridge re-arms it
   *  — and the 0.4.0+ bridge heartbeats every 10 s from the moment the
   *  request leaves, so this only fires when the extension has gone quiet
   *  for good. Mirrors src/ai.js LOCAL_TIMEOUT_MS: the server allows its own
   *  local call twenty minutes, and the page must never be the shorter leash
   *  (v2.35 — 180 s here cut long Gemma turns off while the model was still
   *  reading the prompt). The probes pass their own short ceilings. */
  var LOCAL_CALL_MS = 20 * 60 * 1000;

  /** A loaded model whose window matters: anything that CHATS. LM Studio's
   *  `type` is 'llm', 'vlm' (a vision-capable chat model — gemma-4-31b and
   *  every qwen3.x on the measured box report 'vlm') or 'embeddings'. Only
   *  the embeddings model is skipped: an allowlist of 'llm' alone would
   *  drop the very model the copilot runs on and leave the window unknown. */
  function isLoadedChatModel(e) {
    return !!e && e.state === 'loaded' && e.type !== 'embeddings';
  }

  /** `wanted` is the model id the CMS is configured with ('' = whatever is
   *  loaded). Loosely matched, the way the server does it: case-insensitive,
   *  and a setting that is a prefix or suffix of the runtime's id counts —
   *  owners type "gemma-4-31b" for "google/gemma-4-31b". */
  function pickLoaded(entries, wanted) {
    var loaded = entries.filter(isLoadedChatModel);
    if (!loaded.length) return null;
    var w = String(wanted || '').toLowerCase();
    if (w) {
      for (var i = 0; i < loaded.length; i++) {
        var id = String(loaded[i].id || '').toLowerCase();
        if (id === w || id.indexOf(w) === 0 || (id.length > w.length && id.slice(-w.length) === w)) return loaded[i];
      }
    }
    return loaded[0];
  }

  /** DOM events for the UIs, dispatched on `document` and bubbling to
   *  `window` — a listener on either hears them. */
  function emit(type, detail) {
    try { document.dispatchEvent(new CustomEvent(type, { detail: detail, bubbles: true })); } catch (e) { /* no DOM */ }
  }

  var B = {
    present: false,
    models: [],
    /** The extension's version from its hello ('' until it says). The chat
     *  page compares it against 0.5.0: an older bridge drops streamed tool
     *  calls, so "read / create / edit a page" needs the newer one. */
    version: '',
    /** { tokens, maxTokens, model, source:'bridge', bridgeVersion } once the
     *  probe has read LM Studio's loaded context length; null before the
     *  probe, and null for good when the bridge cannot ask (< 0.5.0). */
    window: null,
    /** true once the first probe has settled — so a page can tell "not yet"
     *  from "this bridge cannot say". */
    windowSettled: false,
    /** Every loaded model the probe saw: [{ id, tokens, maxTokens }]. */
    loaded: [],

    /** One relayed call. Rejects when the bridge is absent, errors, or falls
     *  silent. `onProgress({chars, tokens})` fires while the model writes —
     *  the bridge streams (0.4.0+), so a live generation reports every few
     *  hundred milliseconds.
     *
     *  RESOLVES with the server's body even on a non-2xx WHEN the body is an
     *  error object (bridge 0.5.0 forwards it): the numbers in LM Studio's
     *  exceed_context_size_error are what the CMS needs to shrink and retry,
     *  and only the server knows how. Rejects — with `status`, `data:null`
     *  and `bridgeVersion` on the Error — when the failure came with no body
     *  to judge: an older bridge that dropped it, or a body that was not JSON.
     *  Rejections for "no bridge" / "no answer" carry no `status` at all.
     *
     *  The ceiling measures SILENCE, not duration: every progress message
     *  restarts it. A model that is visibly writing is never cut off, and a
     *  model that stopped talking is still caught. */
    call: function (path, body, timeoutMs, onProgress) {
      return new Promise(function (resolve, reject) {
        if (!B.present) return reject(new Error('תוסף Bridge V2 לא מחובר לאתר הזה'));
        var id = 'llm-' + (++seq) + '-' + Date.now();
        var ms = timeoutMs || LOCAL_CALL_MS;
        var w = { resolve: resolve, reject: reject, onProgress: onProgress, timer: null };
        w.arm = function () {
          clearTimeout(w.timer);
          w.timer = setTimeout(function () {
            waiting.delete(id);
            reject(new Error('המודל המקומי לא ענה בזמן'));
          }, ms);
        };
        w.arm();
        waiting.set(id, w);
        window.postMessage({ source: 'tapuziel-cms', type: 'tz-local-llm', id: id, path: path, body: body }, window.location.origin);
      });
    },

    /** Ask LM Studio what it actually loaded (bridge 0.5.0+: /api/v0/models
     *  is on the extension's allowlist). Never rejects: resolves the window
     *  hint, or null when the bridge is too old ("path not allowed"), the
     *  server is not LM Studio, or nothing is loaded — `B.window` mirrors the
     *  answer, and 'tapuz-bridge-window' fires either way. `wanted` is the
     *  configured model id, optional. */
    probeWindow: function (wanted) {
      var settle = function (win) {
        B.window = win;
        B.windowSettled = true;
        emit('tapuz-bridge-window', win);
        return win;
      };
      // No bridge yet: nothing to ask, and "settled" would be a lie — the
      // hello handler probes the moment the extension shows up.
      if (!B.present) return Promise.resolve(null);
      return B.call('/api/v0/models', null, 8000).then(function (d) {
        var entries = (d && Array.isArray(d.data)) ? d.data : [];
        B.loaded = entries.filter(isLoadedChatModel).map(function (e) {
          return { id: e.id, tokens: Number(e.loaded_context_length) || 0, maxTokens: Number(e.max_context_length) || 0 };
        });
        var hit = pickLoaded(entries, wanted);
        var tokens = hit ? Number(hit.loaded_context_length) : 0;
        if (!hit || !tokens) return settle(null);
        return settle({
          tokens: tokens,
          maxTokens: Number(hit.max_context_length) || tokens,
          model: hit.id,
          source: 'bridge',
          bridgeVersion: B.version
        });
      }).catch(function () {
        // 'path not allowed' = a bridge older than 0.5.0; anything else =
        // no LM Studio behind it. Both mean "unknown", never an error.
        return settle(null);
      });
    },

    /** Drive a server turn to completion: while the server answers with a
     *  modelCall continuation, relay it and hand the output back through
     *  `post` (a fn that POSTs a payload to the route that issued the call
     *  and resolves the parsed JSON). Providers with a server-side endpoint
     *  never emit modelCall, so this is a pass-through for them.
     *
     *  Every route that speaks this protocol uses the SAME two shapes —
     *  server → page { modelCall: { id, body } }, page → server
     *  { step: { id, result } } — so the copilot (/admin/api/ai/chat) and
     *  the injection runner (/admin/api/inject/:id/run) share this driver.
     *  `timeoutMs` is the route's own ceiling for one model turn; a pack on
     *  a 31B model can legitimately think for minutes.
     *
     *  A failed HTTP call WITHOUT a body (the 0.4.0 bridge's 'no response'
     *  on a 400) is still reported to the server as a step — as
     *  { error: { type:'relay_http_error', status, message, bridgeVersion } }
     *  — so the server can try one smaller briefing blind and, failing that,
     *  tell the owner to update the extension. A network/timeout failure has
     *  no status and rejects as before: there is nothing for the server to
     *  judge. */
    drive: function (d, post, timeoutMs, onProgress) {
      if (!d || !d.modelCall) return Promise.resolve(d);
      var body = d.modelCall.body || {};
      // '' = the server left the choice to us: the chat model the probe saw
      // LOADED, before the first id in /v1/models — that list names every
      // downloaded model, and naming an unloaded one makes LM Studio JIT-load
      // it at its default window (8,192 on the measured box).
      if (!body.model) body.model = (B.window && B.window.model) || B.models[0] || 'local-model';
      return B.call('/v1/chat/completions', body, timeoutMs || d.timeoutMs, onProgress).then(function (result) {
        return post({ step: { id: d.modelCall.id, result: result } });
      }, function (e) {
        if (!e || typeof e.status !== 'number' || e.data) throw e;
        return post({ step: { id: d.modelCall.id, result: {
          error: { type: 'relay_http_error', status: e.status, message: e.message, bridgeVersion: e.bridgeVersion || B.version }
        } } });
      }).then(function (next) {
        return B.drive(next, post, timeoutMs, onProgress);
      });
    }
  };

  window.addEventListener('message', function (ev) {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    var m = ev.data;
    if (!m || m.source !== 'tapuziel-bridge') return;
    if (m.type === 'tz-bridge-hello') {
      // a re-announce (the popup re-injects) may carry a newer version
      if (typeof m.version === 'string' && m.version) B.version = m.version;
      if (B.present) return;
      B.present = true;
      emit('tapuz-bridge-hello');
      // what does the local runtime actually serve? (best effort) — and then,
      // with what window? The probe runs AFTER the list so a page that only
      // knows 'tapuz-bridge-models' sees nothing new in the order of events.
      B.call('/v1/models', null, 8000).then(function (d) {
        B.models = ((d && d.data) || []).map(function (x) { return x.id; });
        emit('tapuz-bridge-models');
      }).catch(function () { /* bridge yes, LM Studio no — send() reports it */ })
        .then(function () { return B.probeWindow(); });
      return;
    }
    // streaming progress (bridge 0.4.0+): keeps the UI honest AND restarts
    // the silence ceiling. An older bridge simply never sends it.
    if (m.type === 'tz-local-llm-progress' && waiting.has(m.id)) {
      var p = waiting.get(m.id);
      p.arm();
      if (typeof p.onProgress === 'function') {
        // started/tool (0.5.3): a bridge that sends them says whether the model
        // is still reading or already writing into a tool call; an older one
        // leaves `started` undefined, and the page must not guess
        try {
          p.onProgress({
            chars: Number(m.chars) || 0,
            tokens: Number(m.tokens) || 0,
            started: typeof m.started === 'boolean' ? m.started : undefined,
            tool: typeof m.tool === 'string' ? m.tool.slice(0, 40) : ''
          });
        }
        catch (e) { /* a UI that throws must not kill the generation */ }
      }
      return;
    }
    if (m.type === 'tz-local-llm-result' && waiting.has(m.id)) {
      var w = waiting.get(m.id);
      waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.ok) return w.resolve(m.data);
      // A provider error body is a RESULT the server judges (bridge 0.5.0+
      // forwards it). Everything else is a failure with whatever we know.
      if (m.data && m.data.error) return w.resolve(m.data);
      var raw = m.data && typeof m.data.raw === 'string' ? m.data.raw.slice(0, 200) : '';
      var err = new Error(m.error || raw || ('HTTP ' + m.status));
      if (typeof m.status === 'number') err.status = m.status;
      err.data = null;
      err.bridgeVersion = B.version;
      w.reject(err);
    }
  });

  window.TapuzBridge = B;
  window.postMessage({ source: 'tapuziel-cms', type: 'tz-bridge-ping' }, window.location.origin);
})();
