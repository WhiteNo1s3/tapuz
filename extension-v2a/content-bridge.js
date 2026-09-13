/* Tapuziel Bridge V2 — content script on the OWNER'S OWN SITE (granted via
 * the popup's "connect this site"). The page side of the relay.
 *
 * The site may live anywhere — a Hostinger/cPanel host, a VPS, localhost.
 * The model never does: it answers on loopback, on THIS machine, and only the
 * background worker is allowed to reach it.
 *
 * Protocol (window.postMessage, same-window only):
 *   page → bridge : { source:'tapuziel-cms',    type:'tz-local-llm', id, path, body }
 *   bridge → page : { source:'tapuziel-bridge', type:'tz-local-llm-result', id, ok, status, data|error }
 *   presence      : bridge announces 'tz-bridge-hello' on load and answers
 *                   'tz-bridge-ping' — the CMS admin JS shows its "מקומי
 *                   (דרך הדפדפן)" option only when a bridge is present.
 *
 * Promise-style messaging on purpose: Firefox's `browser` namespace has no
 * callbacks, and Chrome MV3 returns promises when the callback is omitted —
 * the one shape both browsers accept.
 *
 * The page never names a host — only a path from the background's allowlist.
 * No credentials pass through here in either direction. */
(function () {
  'use strict';

  const B = typeof browser !== 'undefined' ? browser : chrome;
  const VERSION = '0.3.0'; // must equal manifest.json "version" (smoke pins it)

  function announce() {
    window.postMessage({ source: 'tapuziel-bridge', type: 'tz-bridge-hello', version: VERSION }, window.location.origin);
  }

  /* Re-injection guard. The popup injects this file into the already-open tab
   * the moment a site is connected (so nothing needs a reload), while the
   * registration also fires on the next load — and a second "connect" injects
   * again. Content scripts of one extension share an isolated world, so this
   * flag is visible across injections: a repeat just re-announces instead of
   * installing a second listener that would double every relayed request. */
  if (window.__tzBridgeV2) {
    announce();
    return;
  }
  window.__tzBridgeV2 = VERSION;

  window.addEventListener('message', (ev) => {
    // Same window, same origin — a frame or another window never reaches us.
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const msg = ev.data;
    if (!msg || msg.source !== 'tapuziel-cms') return;

    if (msg.type === 'tz-bridge-ping') return announce();

    if (msg.type === 'tz-local-llm') {
      const id = msg.id;
      Promise.resolve(B.runtime.sendMessage({ type: 'tz-local-llm', path: msg.path, body: msg.body }))
        .then((res) => res || { ok: false, error: 'no response' })
        .catch((err) => ({ ok: false, error: (err && err.message) || 'extension unavailable' }))
        .then((res) => {
          window.postMessage({
            source: 'tapuziel-bridge',
            type: 'tz-local-llm-result',
            id,
            ...res
          }, window.location.origin);
        });
    }
  });

  announce();
})();
