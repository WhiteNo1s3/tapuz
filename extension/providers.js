/* Tapuziel Bridge — per-LLM-site scrape selectors.
   The admin's OWN logged-in session is the brain; we only read the latest
   assistant message from the page DOM. Selectors are provider-specific and
   fragile by nature — when a site redesigns, update the entry here.
   UMD so scripts/smoke-extension.js can assert the table shape in Node. */
(function (root, factory) {
  const api = factory();
  root.TapuzProviders = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /**
   * Each provider declares:
   *   id, label
   *   match:      hostname test
   *   assistant:  CSS selector for assistant message blocks (last = newest)
   * (Verified starting points from Grokin-V2; re-tune on site redesigns.)
   */
  const PROVIDERS = [
    {
      id: 'claude',
      label: 'Claude',
      match: (h) => /(^|\.)claude\.ai$/.test(h),
      assistant: '[data-testid="assistant-message"], .font-claude-message, [data-is-streaming]'
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      match: (h) => /(^|\.)chatgpt\.com$/.test(h) || /(^|\.)chat\.openai\.com$/.test(h),
      assistant: '[data-message-author-role="assistant"]'
    },
    {
      id: 'grok',
      label: 'Grok',
      match: (h) => /(^|\.)grok\.com$/.test(h) || /(^|\.)grok\.x\.ai$/.test(h) || /(^|\.)x\.com$/.test(h),
      assistant: '.response-content-markdown, [data-testid="grok-response"]'
    },
    {
      id: 'gemini',
      label: 'Gemini',
      match: (h) => /(^|\.)gemini\.google\.com$/.test(h),
      assistant: 'message-content .model-response-text, .model-response-text'
    }
  ];

  function forHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return PROVIDERS.find((p) => p.match(h)) || null;
  }

  return { PROVIDERS, forHost };
});
