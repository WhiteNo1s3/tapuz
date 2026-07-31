/* Tapuziel Bridge V2 — content script on the OWNER'S OWN SITE (granted via
 * the popup's "connect this site"). The page side of the relay.
 *
 * Protocol (window.postMessage, same-window only):
 *   page → bridge : { source:'tapuziel-cms',    type:'tz-local-llm', id, path, body }
 *   bridge → page : { source:'tapuziel-bridge', type:'tz-local-llm-result', id, ok, status, data|error }
 *   presence      : bridge announces 'tz-bridge-hello' on load and answers
 *                   'tz-bridge-ping' — the CMS admin JS shows its "מקומי
 *                   (דרך הדפדפן)" option only when a bridge is present.
 *
 * The page never names a host — only a path from the background's allowlist.
 * No credentials pass through here in either direction. */
(function () {
  'use strict';

  const B = typeof browser !== 'undefined' ? browser : chrome;
  const VERSION = '0.1.0';

  function announce() {
    window.postMessage({ source: 'tapuziel-bridge', type: 'tz-bridge-hello', version: VERSION }, window.location.origin);
  }

  window.addEventListener('message', (ev) => {
    // Same window, same origin — a frame or another window never reaches us.
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const msg = ev.data;
    if (!msg || msg.source !== 'tapuziel-cms') return;

    if (msg.type === 'tz-bridge-ping') return announce();

    if (msg.type === 'tz-local-llm') {
      const id = msg.id;
      B.runtime.sendMessage({ type: 'tz-local-llm', path: msg.path, body: msg.body }, (res) => {
        const err = B.runtime.lastError; // extension reloaded / worker gone
        window.postMessage({
          source: 'tapuziel-bridge',
          type: 'tz-local-llm-result',
          id,
          ...(err ? { ok: false, error: err.message } : (res || { ok: false, error: 'no response' }))
        }, window.location.origin);
      });
    }
  });

  announce();
})();
