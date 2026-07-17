/* Tapuziel Bridge — background service worker (BYOT).
 *
 * SECURITY INVARIANT: the CMS bearer token lives ONLY here (chrome.storage,
 * read only in this worker) and is used ONLY to fetch the CMS. It is NEVER
 * sent to a content script or a web page. Content scripts scrape/inject text
 * and ask this worker to publish; the worker holds the credential. */
'use strict';

importScripts('extract.js', 'llm.js');

const KEYS = {
  url: 'cms_url',
  token: 'cms_token',
  target: 'target_page',
  autoPublish: 'auto_publish',
  // BYOK (v0.73): the user's own LLM key + chosen provider/model. The key is
  // read ONLY inside this worker's generate flow and never leaves the browser.
  byokKey: 'byok_key',
  byokProvider: 'byok_provider',
  byokModel: 'byok_model'
};

function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [KEYS.url, KEYS.token, KEYS.target, KEYS.autoPublish, KEYS.byokKey, KEYS.byokProvider, KEYS.byokModel],
      (r) => {
        resolve({
          url: (r[KEYS.url] || '').replace(/\/+$/, ''),
          token: r[KEYS.token] || '',
          target: r[KEYS.target] || '__new__',
          autoPublish: r[KEYS.autoPublish] !== false, // default ON
          byokKey: r[KEYS.byokKey] || '',
          byokProvider: r[KEYS.byokProvider] || 'claude',
          byokModel: r[KEYS.byokModel] || ''
        });
      }
    );
  });
}

// providers table from the CMS (constants authority) — cached in the worker
let _providersCache = null;
async function fetchProviders(cfg) {
  if (_providersCache) return _providersCache;
  const r = await cms('/agent/v1/providers', { cfg });
  _providersCache = (r && r.providers) || [];
  return _providersCache;
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
    throw new Error((data && data.error) || 'HTTP ' + res.status);
  }
  return data;
}

function pagePath(base, fullPath) {
  return base + '/' + String(fullPath).replace(/\s+/g, '-') + '.html';
}

/**
 * Publish only a COMPLETE .pzn unless forced. Refuse half-streamed fences.
 */
async function publishReply(text, opts = {}) {
  const cfg = await getConfig();
  const analysis = self.TapuzExtract.analyzeReply(text);
  const requireComplete = opts.requireComplete !== false;

  if (requireComplete && !analysis.complete) {
    throw new Error('incomplete .pzn (' + (analysis.reason || 'unknown') + ') — wait for </html> and a closed fence');
  }

  const source = analysis.source || self.TapuzExtract.extractPzn(text);
  if (!self.TapuzExtract.looksLikePzn(source)) {
    throw new Error('no .pzn found — did the AI get the BenTML game/primer?');
  }

  const publish = opts.publish !== false;
  if (cfg.target && cfg.target !== '__new__') {
    const r = await cms('/agent/v1/source', {
      method: 'POST', cfg,
      body: { fullPath: cfg.target, source, loose: true, publish }
    });
    return {
      ok: true, fullPath: cfg.target, created: false, url: pagePath(cfg.url, cfg.target),
      complete: analysis.complete, reason: analysis.reason, repaired: !!(r && r.repaired)
    };
  }
  const r = await cms('/agent/v1/create-from-source', {
    method: 'POST', cfg,
    body: { source, publish, update: !!opts.update }
  });
  return {
    ok: true, fullPath: r.fullPath, created: r.created, url: pagePath(cfg.url, r.fullPath),
    complete: analysis.complete, reason: analysis.reason, repaired: !!r.repaired
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'getConfig': {
          const c = await getConfig();
          // NEVER return the token OR the byok key to callers; only whether set.
          sendResponse({
            ok: true, url: c.url, hasToken: !!c.token, target: c.target, autoPublish: c.autoPublish,
            hasKey: !!c.byokKey, byokProvider: c.byokProvider, byokModel: c.byokModel
          });
          return;
        }
        case 'setConfig': {
          const patch = {};
          if (typeof msg.url === 'string') {
            const newUrl = msg.url.trim().replace(/\/+$/, '');
            // re-pointed at a different CMS → its provider table is stale
            const cur = await getConfig();
            if (newUrl !== cur.url) _providersCache = null;
            patch[KEYS.url] = newUrl;
          }
          if (typeof msg.token === 'string' && msg.token) patch[KEYS.token] = msg.token.trim();
          if (typeof msg.target === 'string') patch[KEYS.target] = msg.target;
          if (typeof msg.autoPublish === 'boolean') patch[KEYS.autoPublish] = msg.autoPublish;
          // BYOK: store the user's key/provider/model. Key is write-only from
          // the popup's view (getConfig never reads it back out).
          if (typeof msg.byokKey === 'string' && msg.byokKey) patch[KEYS.byokKey] = msg.byokKey.trim();
          if (typeof msg.byokProvider === 'string') patch[KEYS.byokProvider] = msg.byokProvider;
          if (typeof msg.byokModel === 'string') patch[KEYS.byokModel] = msg.byokModel;
          await new Promise((r) => chrome.storage.local.set(patch, r));
          sendResponse({ ok: true });
          return;
        }
        case 'clearKey': {
          await new Promise((r) => chrome.storage.local.remove(KEYS.byokKey, r));
          sendResponse({ ok: true });
          return;
        }
        case 'providers': {
          const c = await getConfig();
          if (!c.url || !c.token) throw new Error('CMS not configured');
          const providers = await fetchProviders(c);
          // strip nothing sensitive — the table has no secrets — but do not
          // echo the user's key (it isn't in the table anyway)
          sendResponse({ ok: true, providers, selected: c.byokProvider, model: c.byokModel });
          return;
        }
        case 'generate': {
          // BYOK one-shot: user's key -> provider API (direct) -> .pzn -> CMS.
          const c = await getConfig();
          if (!c.url || !c.token) throw new Error('CMS not configured');
          if (!c.byokKey) throw new Error('לא הוגדר מפתח API — פתחו «מפתח משלכם» והזינו אותו');
          const brief = String((msg && msg.brief) || '').trim();
          if (!brief) throw new Error('כתבו מה לבנות (למשל: דף נחיתה למאפייה)');
          const providers = await fetchProviders(c);
          const provider = providers.find((p) => p.id === c.byokProvider) || providers[0];
          if (!provider) throw new Error('לא נמצא ספק — בדקו את חיבור ה‑CMS');
          // a stored model from a DIFFERENT provider (dropdown switched without
          // re-saving) would 400 — only honor byokModel if it belongs here.
          const model = (provider.models || []).includes(c.byokModel) ? c.byokModel : provider.defaultModel;
          // system prompt = the site-builder game from the CMS (teaches .pzn)
          const roleRes = await fetch(c.url + '/agent/v1/roleplay?locale=he', { headers: { Authorization: 'Bearer ' + c.token } });
          if (!roleRes.ok) throw new Error('roleplay HTTP ' + roleRes.status);
          const system = await roleRes.text();
          const userText = 'בנה דף שלם ב‑.pzn לפי הבקשה, החזר רק את מסמך ה‑HTML המלא בתוך גדר קוד:\n\n' + brief;
          const reply = await self.TapuzLLM.generate(provider, c.byokKey, system, userText, model);
          const published = await publishReply(reply, { publish: c.autoPublish, requireComplete: false });
          sendResponse({ ok: true, ...published, provider: provider.id, model });
          return;
        }
        case 'ping': {
          const r = await cms('/agent/v1/ping');
          sendResponse({ ok: true, agent: r.agent, scopes: r.scopes, version: r.version });
          return;
        }
        case 'primer': {
          // Legacy technical primer (still available for the paste flow).
          const c = await getConfig();
          const res = await fetch(c.url + '/agent/v1/primer', { headers: { Authorization: 'Bearer ' + c.token } });
          const text = await res.text();
          if (!res.ok) throw new Error('primer HTTP ' + res.status);
          sendResponse({ ok: true, primer: text });
          return;
        }
        case 'roleplay': {
          // The full site-builder game pack — dictionary + tools + role (① teach).
          const c = await getConfig();
          if (!c.url || !c.token) throw new Error('CMS not configured');
          const q = new URLSearchParams();
          if (msg.brief) q.set('brief', String(msg.brief));
          if (msg.locale) q.set('locale', String(msg.locale));
          const res = await fetch(c.url + '/agent/v1/roleplay?' + q.toString(), {
            headers: { Authorization: 'Bearer ' + c.token }
          });
          const text = await res.text();
          if (!res.ok) throw new Error('roleplay HTTP ' + res.status);
          sendResponse({ ok: true, roleplay: text, primer: text, kind: 'site-builder-roleplay', length: text.length });
          return;
        }
        case 'pages': {
          const r = await cms('/agent/v1/pages');
          sendResponse({ ok: true, pages: r.pages });
          return;
        }
        case 'mission': {
          const r = await cms('/agent/v1/mission');
          sendResponse({ ok: true, mission: r.mission || null });
          return;
        }
        case 'missionStep': {
          if (!msg.id) { sendResponse({ ok: false, error: 'mission id required' }); return; }
          const r = await cms('/agent/v1/mission/' + encodeURIComponent(msg.id) + '/step', {
            method: 'POST',
            body: { step: msg.step, status: msg.status, fullPath: msg.fullPath }
          });
          sendResponse({ ok: true, mission: r.mission });
          return;
        }
        case 'analyze': {
          sendResponse({ ok: true, ...self.TapuzExtract.analyzeReply(msg.text || '') });
          return;
        }
        case 'publish': {
          const r = await publishReply(msg.text || '', { publish: msg.publish, update: msg.update, requireComplete: msg.requireComplete });
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
