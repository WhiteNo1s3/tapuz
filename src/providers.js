'use strict';

/**
 * LLM provider constants (v0.73, BYOK) — the CMS is the single authority on
 * WHERE each supplier's API lives and HOW to call it. The Chrome extension
 * stays dumb: it fetches this table and never hardcodes an endpoint or a
 * model id, so a provider change ships as a CMS update, not an extension
 * re-release. (Same "constants live in the CMS" rule the wizard follows with
 * LOOKS.)
 *
 * THE KEY NEVER LIVES HERE. BYOK means the user's own API key sits in the
 * extension's background worker and goes straight from there to the provider;
 * the CMS neither sees, stores, nor proxies it. This module only describes
 * the shape of a request — auth header NAME and format, not the secret.
 */

// {apiKey} is substituted with the user's key INSIDE the extension worker,
// never here. authScheme documents how: 'x-api-key' (Anthropic) sends the raw
// key in that header; 'bearer' sends 'Authorization: Bearer <key>'.
const PROVIDERS = {
  claude: {
    id: 'claude',
    label: 'Claude (Anthropic)',
    chatHost: 'claude.ai',
    endpoint: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    authScheme: 'x-api-key',
    authHeader: 'x-api-key',
    // Anthropic requires these two on every direct browser call.
    extraHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    defaultModel: 'claude-sonnet-5',
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'],
    maxTokens: 8192,
    // response body path to the assistant text: content[0].text
    responsePath: ['content', 0, 'text'],
    keyHint: 'sk-ant-…',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    // request-shape flags the extension reads to build the body
    body: { style: 'anthropic-messages', systemField: 'system' }
  },
  openai: {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    chatHost: 'chatgpt.com',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    method: 'POST',
    authScheme: 'bearer',
    authHeader: 'Authorization',
    extraHeaders: {},
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    maxTokens: 8192,
    responsePath: ['choices', 0, 'message', 'content'],
    keyHint: 'sk-…',
    keyUrl: 'https://platform.openai.com/api-keys',
    body: { style: 'openai-chat', systemField: 'system-message' }
  }
};

/** The provider table the extension consumes (never includes any secret). */
function listProviders() {
  return Object.keys(PROVIDERS).map((id) => ({ ...PROVIDERS[id] }));
}

function getProvider(id) {
  return PROVIDERS[id] ? { ...PROVIDERS[id] } : null;
}

module.exports = { PROVIDERS, listProviders, getProvider };
