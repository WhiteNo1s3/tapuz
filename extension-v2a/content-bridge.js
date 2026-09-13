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
 *   progress      : { source:'tapuziel-bridge', type:'tz-local-llm-progress', id, chars, tokens }
 *                   — 0.4.0+, purely ADDITIVE: an older page ignores it, and
 *                   the result shape above did not change at all.
 *   presence      : bridge announces 'tz-bridge-hello' on load and answers
 *                   'tz-bridge-ping' — the CMS admin JS shows its "מקומי
 *                   (דרך הדפדפן)" option only when a bridge is present.
 *
 * Chat goes over a PORT, not sendMessage: one question and one answer has
 * nowhere to put progress, and the port's traffic is also what keeps the MV3
 * worker alive through a long generation. /v1/models stays on sendMessage —
 * it answers in milliseconds and has nothing to report on the way.
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
  const VERSION = '0.4.0'; // must equal manifest.json "version" (smoke pins it)
  const PORT_NAME = 'tz-llm';
  const CHAT_PATH = '/v1/chat/completions';

  function send(payload) {
    window.postMessage(Object.assign({ source: 'tapuziel-bridge' }, payload), window.location.origin);
  }

  function announce() {
    send({ type: 'tz-bridge-hello', version: VERSION });
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

  /** A streaming chat request. Progress goes to the page as it arrives; the
   *  final answer arrives in the unchanged non-streaming shape. */
  function relayViaPort(id, path, body) {
    let port;
    try {
      port = B.runtime.connect({ name: PORT_NAME });
    } catch (e) {
      return send({ type: 'tz-local-llm-result', id, ok: false, error: 'extension unavailable' });
    }
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      send(Object.assign({ type: 'tz-local-llm-result', id }, res));
      try { port.disconnect(); } catch (e) { /* already gone */ }
    };
    port.onMessage.addListener((m) => {
      if (!m) return;
      if (m.type === 'progress') {
        return send({ type: 'tz-local-llm-progress', id, chars: m.chars, tokens: m.tokens });
      }
      if (m.type === 'done') {
        finish(m.ok
          ? { ok: true, status: m.status, data: m.data }
          : { ok: false, status: m.status, error: m.error || 'no response' });
      }
    });
    // The worker was restarted or crashed mid-generation: answer, don't hang.
    port.onDisconnect.addListener(() => finish({ ok: false, error: 'extension unavailable' }));
    port.postMessage({ type: 'start', path, body });
  }

  /** Everything that answers at once — /v1/models. */
  function relayViaMessage(id, path, body) {
    Promise.resolve(B.runtime.sendMessage({ type: 'tz-local-llm', path, body }))
      .then((res) => res || { ok: false, error: 'no response' })
      .catch((err) => ({ ok: false, error: (err && err.message) || 'extension unavailable' }))
      .then((res) => send(Object.assign({ type: 'tz-local-llm-result', id }, res)));
  }

  window.addEventListener('message', (ev) => {
    // Same window, same origin — a frame or another window never reaches us.
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const msg = ev.data;
    if (!msg || msg.source !== 'tapuziel-cms') return;

    if (msg.type === 'tz-bridge-ping') return announce();

    if (msg.type === 'tz-local-llm') {
      if (msg.path === CHAT_PATH) return relayViaPort(msg.id, msg.path, msg.body);
      return relayViaMessage(msg.id, msg.path, msg.body);
    }
  });

  announce();
})();
