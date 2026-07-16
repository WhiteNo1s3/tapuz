/* Tapuziel Bridge — popup. Talks to the background worker only; the token
   is written to the worker's storage and never read back into the popup. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  function send(msg) {
    return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
  }
  function status(text, ok) {
    const el = $('status');
    el.textContent = text;
    el.className = ok ? 'ok' : 'err';
    el.style.display = 'block';
  }

  async function loadTargets(selected) {
    try {
      const r = await send({ type: 'pages' });
      if (!r || !r.ok) return;
      for (const p of r.pages || []) {
        const o = document.createElement('option');
        o.value = p.full_path;
        o.textContent = `${p.title} (${p.full_path})`;
        if (p.full_path === selected) o.selected = true;
        $('target').appendChild(o);
      }
    } catch (e) { /* not configured yet */ }
  }

  (async function init() {
    const c = await send({ type: 'getConfig' });
    const configured = !!(c && c.ok && c.url && c.hasToken);
    if (c && c.ok) {
      $('url').value = c.url || '';
      if (c.hasToken) $('token').placeholder = '•••••• (שמור כדי להחליף)';
      if (configured) loadTargets(c.target);
    }
    // First run: the extension GIVES tools (the primer is the hero button), so
    // the token setup is tucked into a fold — open it only until it's set.
    const setup = document.getElementById('setup');
    if (setup && !configured) setup.open = true;
  })();

  // localhost is already in host_permissions; any other CMS origin needs a
  // runtime grant (covered by optional_host_permissions). Requested here, on
  // the user's click, so the background worker can fetch that origin.
  async function ensureHostPermission(url) {
    try {
      const u = new URL(url);
      if (/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return true;
      const origins = [u.origin + '/*'];
      if (await chrome.permissions.contains({ origins })) return true;
      return await chrome.permissions.request({ origins });
    } catch (e) {
      return false;
    }
  }

  $('save').addEventListener('click', async () => {
    const url = $('url').value.trim();
    if (url && !(await ensureHostPermission(url))) {
      status('צריך אישור גישה לכתובת ה-CMS כדי להתחבר', false);
      return;
    }
    const patch = { type: 'setConfig', url, target: $('target').value };
    if ($('token').value) patch.token = $('token').value;
    const r = await send(patch);
    if (r && r.ok) {
      status('נשמר', true);
      $('token').value = '';
      const setup = document.getElementById('setup');
      if (setup && url) setup.open = false; // connected — fold setup away
      loadTargets($('target').value);
    } else status('שגיאה בשמירה', false);
  });

  $('target').addEventListener('change', () => send({ type: 'setConfig', target: $('target').value }));

  $('ping').addEventListener('click', async () => {
    const r = await send({ type: 'ping' });
    if (r && r.ok) { status(`מחובר — ${r.agent} [${(r.scopes || []).join(', ')}] · v${r.version}`, true); return; }
    const err = (r && r.error) || '?';
    // a network failure usually means the CMS server isn't running / wrong URL
    const hint = /failed to fetch|networkerror|load failed/i.test(err)
      ? ' — האם שרת ה-CMS רץ בכתובת הזו? (node src/server.js)'
      : '';
    status('אין חיבור: ' + err + hint, false);
  });

  $('primer').addEventListener('click', async () => {
    const r = await send({ type: 'roleplay', locale: 'he' });
    if (r && r.ok && r.roleplay) {
      try {
        await navigator.clipboard.writeText(r.roleplay);
        status('משחק בונה-האתרים הועתק — הדביקו בצ׳אט חדש של ה‑AI', true);
      } catch (e) { status('העתקה נכשלה', false); }
    } else status('שגיאה: ' + ((r && r.error) || '?'), false);
  });

  // ── BYOK: provider constants come from the CMS; key stays in the worker ──
  let PROVIDERS = [];
  function fillModels(providerId, selectedModel) {
    const p = PROVIDERS.find((x) => x.id === providerId);
    const sel = $('byok-model');
    sel.innerHTML = '';
    if (!p) return;
    (p.models || [p.defaultModel]).forEach((m) => {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      if (m === (selectedModel || p.defaultModel)) o.selected = true;
      sel.appendChild(o);
    });
    // keyUrl comes from the CMS table — only trust an https link (a
    // javascript:/data: href from a compromised CMS must not run in the popup)
    $('byok-keyurl').href = /^https:\/\//i.test(p.keyUrl || '') ? p.keyUrl : '#';
    if (p.keyHint) $('byok-key').placeholder = p.keyHint;
  }

  async function loadProviders(cfg) {
    const r = await send({ type: 'providers' });
    if (!r || !r.ok) return; // CMS not connected yet
    PROVIDERS = r.providers || [];
    const provSel = $('byok-provider');
    provSel.innerHTML = '';
    PROVIDERS.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.label;
      if (p.id === (cfg.byokProvider || r.selected)) o.selected = true;
      provSel.appendChild(o);
    });
    fillModels(provSel.value, cfg.byokModel || r.model);
    if (cfg.hasKey) $('byok-key').placeholder = '•••••• (שמור כדי להחליף)';
  }

  $('byok-provider').addEventListener('change', () => {
    fillModels($('byok-provider').value, '');
    // persist BOTH the provider AND the now-selected (default) model, so a
    // stale cross-provider model can't linger in storage and 400 the call
    send({ type: 'setConfig', byokProvider: $('byok-provider').value, byokModel: $('byok-model').value });
  });
  $('byok-model').addEventListener('change', () => send({ type: 'setConfig', byokModel: $('byok-model').value }));

  $('byok-save').addEventListener('click', async () => {
    const patch = { type: 'setConfig', byokProvider: $('byok-provider').value, byokModel: $('byok-model').value };
    if ($('byok-key').value) patch.byokKey = $('byok-key').value;
    const r = await send(patch);
    if (r && r.ok) { status('נשמר — המפתח נשאר בדפדפן שלכם בלבד', true); $('byok-key').value = ''; $('byok-key').placeholder = '•••••• (שמור כדי להחליף)'; }
    else status('שגיאה בשמירה', false);
  });

  $('byok-generate').addEventListener('click', async () => {
    const brief = $('byok-brief').value.trim();
    if (!brief) return status('כתבו מה לבנות', false);
    const btn = $('byok-generate'); const label = btn.textContent;
    btn.disabled = true; btn.textContent = '⏳ בונה…';
    const r = await send({ type: 'generate', brief });
    btn.disabled = false; btn.textContent = label;
    if (r && r.ok) {
      status((r.created ? 'נוצר ופורסם: ' : 'עודכן: ') + r.fullPath + ' ✓', true);
      loadTargets($('target').value);
    } else status('שגיאה: ' + ((r && r.error) || '?'), false);
  });

  // hydrate BYOK once config is known (append to init)
  send({ type: 'getConfig' }).then((c) => { if (c && c.ok) loadProviders(c); });
})();
