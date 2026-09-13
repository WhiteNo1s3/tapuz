/* Tapuziel — the page side of Bridge V2 (extension-v2a), shared by every
 * admin surface that talks to the copilot (/admin/chat, the builder drawer).
 *
 * The extension's content script announces itself with tz-bridge-hello and
 * answers tz-bridge-ping; requests are correlated by id. The page names a
 * PATH from the extension's closed list — never a host: the loopback
 * endpoint belongs to the extension alone.
 *
 * DOM events for the UIs: 'tapuz-bridge-hello' fires once when the bridge
 * first announces, 'tapuz-bridge-models' when the loaded-model list arrives.
 */
(function () {
  'use strict';

  var waiting = new Map();
  var seq = 0;

  var B = {
    present: false,
    models: [],

    /** One relayed call. Rejects when the bridge is absent, errors, or falls
     *  silent. `onProgress({chars, tokens})` fires while the model writes —
     *  the bridge streams (0.4.0+), so a live generation reports every few
     *  hundred milliseconds.
     *
     *  The ceiling measures SILENCE, not duration: every progress message
     *  restarts it. A model that is visibly writing is never cut off, and a
     *  model that stopped talking is still caught. */
    call: function (path, body, timeoutMs, onProgress) {
      return new Promise(function (resolve, reject) {
        if (!B.present) return reject(new Error('תוסף Bridge V2 לא מחובר לאתר הזה'));
        var id = 'llm-' + (++seq) + '-' + Date.now();
        var ms = timeoutMs || 180000;
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
     *  a 31B model can legitimately think for minutes. */
    drive: function (d, post, timeoutMs, onProgress) {
      if (!d || !d.modelCall) return Promise.resolve(d);
      var body = d.modelCall.body || {};
      // '' = the server left the choice to us: whatever the runtime loaded
      if (!body.model) body.model = B.models[0] || 'local-model';
      return B.call('/v1/chat/completions', body, timeoutMs || d.timeoutMs, onProgress).then(function (result) {
        return post({ step: { id: d.modelCall.id, result: result } });
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
      if (B.present) return;
      B.present = true;
      document.dispatchEvent(new CustomEvent('tapuz-bridge-hello'));
      // what does the local runtime actually serve? (best effort)
      B.call('/v1/models', null, 8000).then(function (d) {
        B.models = ((d && d.data) || []).map(function (x) { return x.id; });
        document.dispatchEvent(new CustomEvent('tapuz-bridge-models'));
      }).catch(function () { /* bridge yes, LM Studio no — send() reports it */ });
      return;
    }
    // streaming progress (bridge 0.4.0+): keeps the UI honest AND restarts
    // the silence ceiling. An older bridge simply never sends it.
    if (m.type === 'tz-local-llm-progress' && waiting.has(m.id)) {
      var p = waiting.get(m.id);
      p.arm();
      if (typeof p.onProgress === 'function') {
        try { p.onProgress({ chars: Number(m.chars) || 0, tokens: Number(m.tokens) || 0 }); }
        catch (e) { /* a UI that throws must not kill the generation */ }
      }
      return;
    }
    if (m.type === 'tz-local-llm-result' && waiting.has(m.id)) {
      var w = waiting.get(m.id);
      waiting.delete(m.id);
      clearTimeout(w.timer);
      if (m.ok) w.resolve(m.data);
      else w.reject(new Error(m.error || ('HTTP ' + m.status)));
    }
  });

  window.TapuzBridge = B;
  window.postMessage({ source: 'tapuziel-cms', type: 'tz-bridge-ping' }, window.location.origin);
})();
