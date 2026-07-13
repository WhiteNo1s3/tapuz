/* Tapuziel Bridge — background service worker.
 *
 * SECURITY INVARIANT: the CMS bearer token lives ONLY here (chrome.storage,
 * read only in this worker) and is used ONLY to fetch the CMS. It is NEVER
 * sent to a content script or a web page. Content scripts scrape text and ask
 * this worker to publish; the worker holds the credential and does the fetch.
 */
'use strict';

importScripts('extract.js');

const KEYS = { url: 'cms_url', token: 'cms_token', target: 'target_page' };

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get([KEYS.url, KEYS.token, KEYS.target], (r) => {
      resolve({
        url: (r[KEYS.url] || '').replace(/\/+$/, ''),
        token: r[KEYS.token] || '',
        target: r[KEYS.target] || '__new__'
      });
    });
  });
}

async function cms(path, { method = 'GET', body, cfg } = {}) {
  const c = cfg || (await getConfig());
  if (!c.url) throw new Error('CMS URL not set');
  if (!c.token) throw new Error('token not set');
  const res = await fetch(c.url + path, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + c.token }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  if (!res.ok || (data && data.ok === false)) {
    throw new Error((data && data.error) || ('HTTP ' + res.status));
  }
  return data;
}

// Publish a scraped bot reply. `text` is the raw assistant message; we extract
// the .pzn and either create a new page or update the chosen target.
async function publishReply(text, opts = {}) {
  const cfg = await getConfig();
  const source = self.TapuzExtract.extractPzn(text);
  if (!self.TapuzExtract.looksLikePzn(source)) {
    throw new Error('no .pzn found in the reply — did the bot get the primer?');
  }
  const publish = opts.publish !== false;
  if (cfg.target && cfg.target !== '__new__') {
    const r = await cms('/agent/v1/source', {
      method: 'POST', cfg,
      body: { fullPath: cfg.target, source, loose: true, publish }
    });
    return {
      ok: true, fullPath: cfg.target, created: false, url: pagePath(cfg.url, cfg.target),
      repaired: !!r.repaired, changes: (r.changes || []).length, published: !!r.published
    };
  }
  const r = await cms('/agent/v1/create-from-source', {
    method: 'POST', cfg,
    body: { source, publish, update: !!opts.update }
  });
  return {
    ok: true, fullPath: r.fullPath, created: r.created, url: pagePath(cfg.url, r.fullPath),
    repaired: !!r.repaired, changes: (r.changes || []).length, published: !!r.published
  };
}

function pagePath(base, fullPath) {
  return base + '/' + String(fullPath).replace(/\s+/g, '-') + '.html';
}

// message router — from popup (config/ping/primer/pages) and content bridge (publish)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'getConfig': {
          const c = await getConfig();
          // NEVER return the token to callers; only whether one is set.
          sendResponse({ ok: true, url: c.url, hasToken: !!c.token, target: c.target });
          return;
        }
        case 'setConfig': {
          const patch = {};
          if (typeof msg.url === 'string') patch[KEYS.url] = msg.url.trim().replace(/\/+$/, '');
          if (typeof msg.token === 'string' && msg.token) patch[KEYS.token] = msg.token.trim();
          if (typeof msg.target === 'string') patch[KEYS.target] = msg.target;
          await new Promise((r) => chrome.storage.local.set(patch, r));
          sendResponse({ ok: true });
          return;
        }
        case 'ping': {
          const r = await cms('/agent/v1/ping');
          sendResponse({ ok: true, agent: r.agent, scopes: r.scopes, version: r.version });
          return;
        }
        case 'primer': {
          const c = await getConfig();
          const res = await fetch(c.url + '/agent/v1/primer', { headers: { Authorization: 'Bearer ' + c.token } });
          const text = await res.text();
          if (!res.ok) throw new Error('primer HTTP ' + res.status);
          sendResponse({ ok: true, primer: text });
          return;
        }
        case 'pages': {
          const r = await cms('/agent/v1/pages');
          sendResponse({ ok: true, pages: r.pages });
          return;
        }
        case 'publish': {
          const r = await publishReply(msg.text || '', { publish: msg.publish, update: msg.update });
          sendResponse(r);
          return;
        }
        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async response
});
