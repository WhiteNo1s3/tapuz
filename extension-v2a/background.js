/* Tapuziel Bridge V2 — background worker. THE relay, and nothing else.
 *
 * V1 grew a BYOK popup (v0.73) and then amputated it (v0.85) because keys
 * belong in the CMS, where the owner sets them once and every worker uses
 * them "without seam". V2 starts from that lesson: this extension holds NO
 * credentials of any kind. Its single job is carrying requests from the
 * site's admin pages to the LLM server running on THIS machine (LM Studio,
 * Ollama — anything OpenAI-compatible on loopback), so the local model never
 * has to be exposed to the internet.
 *
 * SECURITY INVARIANT (mirrors src/providers.js isLoopbackHost on the CMS):
 * the target hostname must be exactly localhost / 127.0.0.1 / [::1]. Not a
 * LAN address, not 0.0.0.0, not localhost.evil.com. The page supplies a path,
 * never a host. */
'use strict';

const B = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULT_BASE = 'http://127.0.0.1:1234'; // LM Studio's default port

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// The page picks from this menu — it can never name an arbitrary URL.
const ALLOWED_PATHS = ['/v1/chat/completions', '/v1/models'];

function getBase() {
  return new Promise((resolve) => {
    B.storage.local.get(['llm_base'], (r) => {
      resolve((r.llm_base || DEFAULT_BASE).replace(/\/+$/, ''));
    });
  });
}

function isLoopbackBase(base) {
  try {
    const u = new URL(base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname === '::1' ? '[::1]' : u.hostname; // URL strips the brackets
    return LOOPBACK_HOSTS.includes(host.toLowerCase());
  } catch (e) {
    return false;
  }
}

async function relay(msg) {
  const path = String(msg.path || '');
  if (!ALLOWED_PATHS.includes(path)) {
    return { ok: false, error: 'path not allowed: ' + path };
  }
  const base = await getBase();
  if (!isLoopbackBase(base)) {
    return { ok: false, error: 'endpoint is not loopback: ' + base };
  }
  try {
    const res = await fetch(base + path, {
      method: msg.body ? 'POST' : 'GET',
      headers: msg.body ? { 'Content-Type': 'application/json' } : undefined,
      body: msg.body ? JSON.stringify(msg.body) : undefined
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    // The classic here is "LM Studio isn't running" / server not started.
    return { ok: false, error: 'local model unreachable: ' + (e && e.message) };
  }
}

B.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tz-local-llm') return;
  relay(msg).then(sendResponse);
  return true; // async response
});
