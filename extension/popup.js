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
    if (c && c.ok) {
      $('url').value = c.url || '';
      if (c.hasToken) $('token').placeholder = '•••••• (שמור כדי להחליף)';
      if (c.url && c.hasToken) loadTargets(c.target);
    }
  })();

  $('save').addEventListener('click', async () => {
    const patch = { type: 'setConfig', url: $('url').value, target: $('target').value };
    if ($('token').value) patch.token = $('token').value;
    const r = await send(patch);
    if (r && r.ok) { status('נשמר', true); $('token').value = ''; }
    else status('שגיאה בשמירה', false);
  });

  $('target').addEventListener('change', () => send({ type: 'setConfig', target: $('target').value }));

  $('ping').addEventListener('click', async () => {
    const r = await send({ type: 'ping' });
    if (r && r.ok) status(`מחובר — ${r.agent} [${(r.scopes || []).join(', ')}] · v${r.version}`, true);
    else status('אין חיבור: ' + ((r && r.error) || '?'), false);
  });

  $('primer').addEventListener('click', async () => {
    const r = await send({ type: 'primer' });
    if (r && r.ok) {
      try { await navigator.clipboard.writeText(r.primer); status('המדריך הועתק — הדביקו בצ׳אט', true); }
      catch (e) { status('העתקה נכשלה', false); }
    } else status('שגיאה: ' + ((r && r.error) || '?'), false);
  });
})();
