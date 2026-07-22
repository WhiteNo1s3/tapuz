'use strict';

/**
 * Tier-1 AI: the key lives in the CMS (v0.85 — Ben's tier realignment).
 *
 * The v0.73 experiment put the user's LLM key in the browser extension; Ben's
 * corrected model: key-based chat is a CMS feature (the customer's own key,
 * used server-side against the provider's OFFICIAL API — third-party use the
 * providers sanction). The extension is the KEYLESS tier (BYOT inject/paste).
 *
 * Security model (ports the v0.73 llm.js boundary, now server-owned):
 *  - the key is stored in gitignored config/ai.json (the auth.json pattern),
 *    never in site.json, never echoed by any API (hasKey + tail only)
 *  - the set of hosts allowed to receive the key is HARDCODED here; provider
 *    descriptors (src/providers.js) supply shapes, never new destinations
 *  - the key is used only as the provider auth header; never logged
 */

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');
// Endpoint policy lives in providers.js — ONE implementation, so the server
// and the /agent/v1/providers table can never disagree about what is allowed.
const {
  getProvider, listProviders, endpointAllowed, resolveLocalEndpoint, ALLOWED_API_HOSTS
} = require('./providers');

const STORE_PATH = path.join(CONFIG_DIR, 'ai.json');

// ── settings store ──────────────────────────────────────────────────────

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (data && typeof data === 'object') return data;
    }
  } catch (e) { /* fall through */ }
  return { provider: 'claude', model: '', apiKey: '', baseUrl: '' };
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

/** Public settings — NEVER includes the key itself. */
function getSettings() {
  const s = load();
  const key = String(s.apiKey || '');
  return {
    provider: s.provider || 'claude',
    model: s.model || '',
    baseUrl: s.baseUrl || '',
    hasKey: !!key,
    keyTail: key ? key.slice(-4) : ''
  };
}

/**
 * @param {{ provider?, model?, apiKey?, baseUrl? }} patch
 *  apiKey: undefined = keep current; '' = clear; value = replace.
 *  baseUrl: the local runtime's address — REJECTED here if it is not loopback,
 *  so a non-local address can never be stored, let alone called.
 */
function saveSettings(patch = {}) {
  const s = load();
  if (patch.provider !== undefined) {
    if (!getProvider(patch.provider)) throw new Error('ספק לא מוכר: ' + patch.provider);
    s.provider = patch.provider;
  }
  if (patch.model !== undefined) s.model = String(patch.model || '');
  if (patch.apiKey !== undefined) s.apiKey = String(patch.apiKey || '').trim();
  if (patch.baseUrl !== undefined) {
    const raw = String(patch.baseUrl || '').trim();
    if (raw && !resolveLocalEndpoint(raw)) {
      throw new Error('כתובת המודל המקומי חייבת להצביע על המחשב הזה (127.0.0.1 / localhost)');
    }
    s.baseUrl = raw;
  }
  save(s);
  return getSettings();
}

// ── the provider call (server-side; ports extension/llm.js v0.73) ───────

function dig(obj, pathArr) {
  let cur = obj;
  for (const k of pathArr) {
    if (cur == null) return '';
    cur = cur[k];
  }
  return typeof cur === 'string' ? cur : '';
}

/**
 * Build headers+body for a provider descriptor. `history` is an optional
 * array of prior turns [{role: 'user'|'assistant', content}] so the chat
 * remembers itself; the system prompt always rides separately.
 */
function buildRequest(provider, key, system, userText, model, history = []) {
  const headers = { 'Content-Type': 'application/json' };
  // A local runtime usually wants no credential at all — sending an empty
  // "Bearer " trips some of them, so omit the header entirely when there is
  // nothing to send and the provider says a key is optional.
  if (key || !provider.keyOptional) {
    if (provider.authScheme === 'bearer') {
      headers[provider.authHeader || 'Authorization'] = 'Bearer ' + key;
    } else {
      headers[provider.authHeader || 'x-api-key'] = key;
    }
  }
  Object.assign(headers, provider.extraHeaders || {});

  const mdl = model || provider.defaultModel;
  const maxTokens = provider.maxTokens || 4096;
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && t.content)
    .slice(-12)
    .map((t) => ({ role: t.role, content: String(t.content).slice(0, 12000) }));

  let body;
  const style = (provider.body && provider.body.style) || 'anthropic-messages';
  if (style === 'openai-chat') {
    body = {
      model: mdl,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...turns, { role: 'user', content: userText }]
    };
  } else {
    body = {
      model: mdl,
      max_tokens: maxTokens,
      system,
      messages: [...turns, { role: 'user', content: userText }]
    };
  }
  return { headers, body };
}

/**
 * One turn against the configured provider, with the stored key.
 * @returns {Promise<string>} the assistant's raw text
 */
async function generate({ system = '', user = '', history = [] } = {}) {
  const s = load();
  const key = String(s.apiKey || '');
  const provider = getProvider(s.provider || 'claude');
  if (!provider || !provider.endpoint) throw new Error('ספק לא מוגדר');
  // A local runtime serves without credentials; a public one never does.
  if (!key && !provider.keyOptional) {
    throw new Error('לא הוגדר מפתח API — הגדירו אותו בצ׳אט (ההגדרות בצד)');
  }

  // For the local provider the address is the user's own — resolved (and
  // re-checked for loopback) per call, never frozen in the table.
  let endpoint = provider.endpoint;
  if (provider.id === 'local') {
    endpoint = resolveLocalEndpoint(s.baseUrl);
    if (!endpoint) {
      throw new Error('כתובת המודל המקומי חייבת להיות מקומית (127.0.0.1 / localhost) — נדחתה');
    }
  }
  if (!endpointAllowed(endpoint)) {
    throw new Error('כתובת הספק אינה ברשימת ההיתר של השרת — מסרב לשלוח את המפתח');
  }

  // A local runtime serves whatever model it has loaded, so any name is valid;
  // a public provider is held to the list we ship.
  const model = provider.openModel
    ? (String(s.model || '').trim() || provider.defaultModel)
    : ((provider.models || []).includes(s.model) ? s.model : provider.defaultModel);
  const { headers, body } = buildRequest(provider, key, system, user, model, history);

  let res;
  try {
    res = await fetch(endpoint, {
      method: provider.method || 'POST',
      headers,
      body: JSON.stringify(body)
    });
  } catch (e) {
    if (provider.id === 'local') {
      throw new Error('לא הצלחתי להתחבר למודל המקומי ב-' + endpoint +
        ' — ודאו ש-LM Studio (או Ollama) רץ ושהשרת המקומי דולק. פרטים: ' + e.message);
    }
    throw new Error('קריאה לספק נכשלה (רשת): ' + e.message);
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + res.status);
    throw new Error('שגיאת ספק: ' + msg);
  }
  const text = dig(data, provider.responsePath || ['content', 0, 'text']);
  if (!text) throw new Error('הספק החזיר תשובה ריקה');
  return text;
}

module.exports = {
  getSettings,
  saveSettings,
  generate,
  buildRequest,
  endpointAllowed,
  ALLOWED_API_HOSTS,
  listProviders,
  STORE_PATH
};
