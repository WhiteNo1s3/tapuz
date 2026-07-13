/* Tapuziel Bridge — per-LLM-site selectors (scrape + inject into the user's session).
   The admin's OWN logged-in session is the brain; we only read/write the chat DOM
   they already control. Selectors are provider-specific and fragile by nature —
   when a site redesigns, update the entry here. UMD for smoke tests.

   assistant — latest reply blocks (last match = newest)
   streaming — present while the model is still generating (hold off publishing)
   composer  — editable input for injection (contenteditable or textarea)
   send      — optional send button (else we synthesize Enter) */
(function (root, factory) {
  const api = factory();
  root.TapuzProviders = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const PROVIDERS = [
    {
      id: 'claude',
      label: 'Claude',
      match: (h) => /(^|\.)claude\.ai$/.test(h),
      assistant: '[data-testid="assistant-message"], .font-claude-message',
      streaming: '[data-is-streaming="true"], [data-is-streaming]',
      composer:
        'div[contenteditable="true"].ProseMirror, div[contenteditable="true"][data-testid], fieldset div[contenteditable="true"]',
      send: 'button[aria-label="Send Message"], button[aria-label="Send message"]'
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      match: (h) => /(^|\.)chatgpt\.com$/.test(h) || /(^|\.)chat\.openai\.com$/.test(h),
      assistant: '[data-message-author-role="assistant"]',
      streaming: 'button[aria-label="Stop streaming"], button[data-testid="stop-button"]',
      composer: '#prompt-textarea, div[contenteditable="true"]#prompt-textarea, textarea[data-id]',
      send: 'button[data-testid="send-button"], button[aria-label="Send prompt"]'
    },
    {
      id: 'grok',
      label: 'Grok',
      match: (h) => /(^|\.)grok\.com$/.test(h) || /(^|\.)grok\.x\.ai$/.test(h) || /(^|\.)x\.com$/.test(h),
      assistant: '.response-content-markdown, [data-testid="grok-response"]',
      streaming: '[data-testid="stop-generating"], button[aria-label*="Stop"]',
      composer: 'textarea, div[contenteditable="true"]',
      send: 'button[type="submit"], button[aria-label*="Send"]'
    },
    {
      id: 'gemini',
      label: 'Gemini',
      match: (h) => /(^|\.)gemini\.google\.com$/.test(h),
      assistant: 'message-content .model-response-text, .model-response-text',
      streaming: 'button[aria-label*="Stop"], .stop-button',
      composer: 'div[contenteditable="true"], rich-textarea div[contenteditable="true"], textarea',
      send: 'button[aria-label*="Send"], button.send-button'
    }
  ];

  function forHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return PROVIDERS.find((p) => p.match(h)) || null;
  }

  return { PROVIDERS, forHost };
});
