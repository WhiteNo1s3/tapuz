/* Tapuziel Bridge — BYOK direct-call module (v0.73).
 *
 * Runs ONLY inside the background service worker. Given a provider descriptor
 * (fetched from the CMS — the constants authority), the USER'S OWN api key,
 * and a prompt, it calls the provider's API directly from the browser and
 * returns the assistant text.
 *
 * SECURITY: the key is passed in here and used ONLY as the provider's auth
 * header. It is never logged, never returned, never sent to the CMS or a
 * content script. The CMS is contacted with the separate tzk_ token elsewhere.
 */
(function (root) {
  'use strict';

  // SECURITY BOUNDARY (v0.73 review): the CMS supplies provider CONSTANTS
  // (model ids, header shape, versions) — but it must NOT decide WHERE the
  // key is sent. A compromised CMS could otherwise return an endpoint pointing
  // at itself and harvest the key. So the set of hosts allowed to receive the
  // user's key is HARDCODED HERE, in the extension, never from the CMS. Adding
  // a provider host is a deliberate extension update, by design.
  const ALLOWED_API_HOSTS = new Set(['api.anthropic.com', 'api.openai.com']);

  function endpointAllowed(url) {
    try {
      const u = new URL(String(url));
      return u.protocol === 'https:' && ALLOWED_API_HOSTS.has(u.host);
    } catch (e) { return false; }
  }

  function dig(obj, path) {
    let cur = obj;
    for (const k of path) {
      if (cur == null) return '';
      cur = cur[k];
    }
    return typeof cur === 'string' ? cur : '';
  }

  function buildRequest(provider, key, system, userText, model) {
    const headers = { 'Content-Type': 'application/json' };
    // auth: raw key in a named header (Anthropic) or a Bearer (OpenAI)
    if (provider.authScheme === 'bearer') {
      headers[provider.authHeader || 'Authorization'] = 'Bearer ' + key;
    } else {
      headers[provider.authHeader || 'x-api-key'] = key;
    }
    Object.assign(headers, provider.extraHeaders || {});

    const mdl = model || provider.defaultModel;
    const maxTokens = provider.maxTokens || 4096;
    let body;
    const style = (provider.body && provider.body.style) || 'anthropic-messages';
    if (style === 'openai-chat') {
      body = {
        model: mdl,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText }
        ]
      };
    } else {
      // anthropic-messages: system is a top-level field, not a message
      body = {
        model: mdl,
        max_tokens: maxTokens,
        system: system,
        messages: [{ role: 'user', content: userText }]
      };
    }
    return { headers, body };
  }

  /**
   * @returns {Promise<string>} the assistant's raw text (expected to carry .pzn)
   */
  async function generate(provider, key, system, userText, model) {
    if (!provider || !provider.endpoint) throw new Error('provider descriptor missing');
    if (!key) throw new Error('לא הוגדר מפתח — הזינו את מפתח ה‑API שלכם');
    // refuse to attach the key to any host the extension does not trust —
    // even if the (possibly compromised) CMS told us to use it
    if (!endpointAllowed(provider.endpoint)) {
      throw new Error('כתובת הספק אינה ברשימת ההיתר של התוסף — מסרב לשלוח את המפתח שלכם');
    }
    const { headers, body } = buildRequest(provider, key, system || '', userText || '', model);
    let res;
    try {
      res = await fetch(provider.endpoint, { method: provider.method || 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('קריאה לספק נכשלה (רשת/CORS): ' + e.message);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-json */ }
    if (!res.ok) {
      const msg = (data && (data.error && (data.error.message || data.error)) ) || ('HTTP ' + res.status);
      throw new Error('שגיאת ספק: ' + msg);
    }
    const text = dig(data, provider.responsePath || ['content', 0, 'text']);
    if (!text) throw new Error('הספק החזיר תשובה ריקה');
    return text;
  }

  root.TapuzLLM = { generate, buildRequest, endpointAllowed, ALLOWED_API_HOSTS };
})(self);
