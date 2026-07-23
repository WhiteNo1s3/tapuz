/* /admin/chat — the tier-1 copilot (v0.85, the tier realignment):
   the user's LLM key lives in the CMS; the chat calls the provider's OFFICIAL
   API from the server, speaks BenTML (the same roleplay pack every on-ramp
   gets), and a reply that carries a page becomes a draft in one click.
   No key? The sidebar routes to the keyless tier (inject / paste / extension). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const log = $('chat-log');
  const input = $('chat-input');
  const history = []; // [{role, content}] — sent with each turn, capped server-side

  let providers = [];
  let settings = { provider: 'claude', model: '', hasKey: false, keyTail: '' };

  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function bubble(role, html) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function setStatus(msg) {
    const el = $('chat-status');
    if (el) el.textContent = msg || '';
  }

  /* ── settings card ── */

  function currentProvider() {
    const checked = document.querySelector('input[name="ai-provider"]:checked');
    return providers.find((x) => x.id === (checked && checked.value)) || providers[0] || {};
  }

  function fillModels() {
    const p = currentProvider();
    const sel = $('ai-model');
    // A local runtime serves whatever model it has loaded, so its name is a
    // free-text field, not a list we could possibly know ahead of time.
    if (p.openModel) {
      sel.innerHTML = '';
      sel.hidden = true;
      $('ai-model-free').hidden = false;
      $('ai-model-free').value = settings.model || '';
      $('ai-model-free').placeholder = p.defaultModel || 'שם המודל שטעון';
      return;
    }
    sel.hidden = false;
    $('ai-model-free').hidden = true;
    sel.innerHTML = (p.models || []).map((m) =>
      '<option value="' + esc(m) + '"' + (m === settings.model ? ' selected' : '') + '>' + esc(m) + '</option>'
    ).join('');
  }

  /** Everything that depends on WHICH provider is selected right now. Split
   *  out of renderSettings because picking a provider must update the whole
   *  card immediately — rebuilding the <select> here would snap the choice
   *  back to the saved one before the user has saved it. */
  function syncProviderUI() {
    fillModels();
    const p = currentProvider();
    // The base-URL row belongs to the local provider alone; the public ones
    // have a fixed endpoint the server will not let anyone repoint.
    $('ai-local-row').hidden = !p.baseUrlDefault;
    $('ai-base').value = settings.baseUrl || '';
    $('ai-base').placeholder = p.baseUrlDefault || '';
    $('ai-key-state').textContent = p.keyOptional
      ? '· לרוב לא נדרש למודל מקומי'
      : (settings.hasKey ? '· מוגדר (…' + settings.keyTail + ')' : '· לא מוגדר');
    $('ai-key').placeholder = settings.hasKey
      ? 'להחלפה — הדביקו מפתח חדש'
      : (p.keyHint || 'sk-…');
  }

  function renderSettings() {
    // Radios, not a <select> (v1.70): each provider row carries its readiness.
    // "Ready" = local runtime (no key needed) or the saved provider with its
    // key. Not-ready rows are toned down (.is-off) but stay clickable —
    // choosing one is exactly how you get to configure it.
    const box = $('ai-provider-radios');
    box.innerHTML = providers.map((p) => {
      const ready = p.keyOptional || (p.id === settings.provider && settings.hasKey);
      const chip = p.keyOptional
        ? 'מקומי · ללא מפתח'
        : (ready ? 'מוגדר ✓' : 'דורש מפתח');
      return '<label class="provider-radio' + (ready ? '' : ' is-off') + '">' +
        '<input type="radio" name="ai-provider" value="' + esc(p.id) + '"' +
        (p.id === settings.provider ? ' checked' : '') + '>' +
        '<span class="pr-label">' + esc(p.label) + '</span>' +
        '<span class="pr-chip">' + chip + '</span></label>';
    }).join('');
    syncProviderUI();
  }

  async function saveSettings() {
    const p = currentProvider();
    const body = {
      provider: p.id,
      model: p.openModel ? $('ai-model-free').value.trim() : $('ai-model').value
    };
    if (p.baseUrlDefault) body.baseUrl = $('ai-base').value.trim();
    const key = $('ai-key').value.trim();
    if (key) body.apiKey = key; // empty field = keep the stored key
    $('ai-settings-status').textContent = 'שומר…';
    try {
      const d = await api('/admin/api/ai/settings', { method: 'POST', body: JSON.stringify(body) });
      settings = d;
      $('ai-key').value = '';
      renderSettings();
      $('ai-settings-status').textContent = 'נשמר ✓';
      // a local runtime needs no key, so the chat is ready the moment it is picked
      if (d.hasKey || currentProvider().keyOptional) welcome(true);
    } catch (e) {
      $('ai-settings-status').textContent = 'שגיאה: ' + e.message;
    }
  }

  /* ── the conversation ── */

  function welcome(fresh) {
    if (fresh) log.innerHTML = '';
    if (settings.hasKey) {
      bubble('system', 'הקופיילוט מחובר ✓ תארו דף — והוא ייבנה כטיוטה בלחיצה. המפתח שלכם נשאר בשרת.');
    } else {
      bubble('system', 'עוד אין מפתח API. הגדירו אותו בצד (נשמר בשרת בלבד) — או השתמשו במסלולים ללא מפתח.');
    }
  }

  /* One assistant turn: what it said, what it looked at, and — if it wants to
     WRITE — the approval gate. The server has already stopped short of doing
     anything; this is the only thing that lets it through. */
  function renderTurn(d) {
    const looked = (d.used || []).filter((t) => t === 'list_pages' || t === 'read_page');
    if (looked.length) {
      bubble('system', '🔎 הקופיילוט קרא מהאתר: ' + esc(looked.join(', ')));
    }
    if (d.reply) {
      const b = bubble('assistant',
        '<div style="white-space:pre-wrap;word-break:break-word;direction:rtl">' + esc(d.reply) + '</div>' +
        replyActions(d.reply));
      wireActions(b, d.reply);
    }
    if (d.pending) renderApproval(d.pending);
  }

  function renderApproval(p) {
    const b = bubble('system',
      '<div style="font-weight:700;margin-bottom:6px">✋ הקופיילוט מבקש רשות</div>' +
      '<div style="margin-bottom:4px">' + esc(p.summary) + '</div>' +
      '<div class="faint" style="font-size:.78rem;margin-bottom:8px">שום דבר לא נשמר עדיין. אישור יוצר/יעדכן <b>טיוטה</b> בלבד — הדף החי לא משתנה.</div>' +
      '<div class="actions">' +
      '<button type="button" class="act primary" data-ok="1">✓ אשר</button>' +
      '<button type="button" class="act" data-ok="0">✕ לא עכשיו</button>' +
      '</div>');
    b.querySelectorAll('[data-ok]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = btn.dataset.ok === '1';
        b.querySelectorAll('[data-ok]').forEach((x) => { x.disabled = true; });
        btn.textContent = ok ? 'מבצע…' : 'נדחה';
        setStatus(ok ? 'מבצע…' : '');
        try {
          const d = await api('/admin/api/ai/chat', {
            method: 'POST',
            body: JSON.stringify({ approve: { id: p.id, ok } })
          });
          if (ok) {
            const slug = (p.input && p.input.slug) || '';
            bubble('system', 'בוצע ✓ ' + (slug
              ? '<a href="/admin/edit/' + encodeURIComponent(slug) + '">פתחו בבונה</a>'
              : 'הטיוטה נשמרה'));
          }
          if (d.reply) history.push({ role: 'assistant', content: d.reply });
          renderTurn(d);
        } catch (e) {
          bubble('system', 'שגיאה: ' + esc(e.message));
        }
        setStatus('');
      });
    });
  }

  function replyActions(reply) {
    // a reply that carries a page offers one-click creation
    if (!/<bent-|<!DOCTYPE html/i.test(reply)) return '';
    return '<div class="actions">' +
      '<button type="button" class="act primary" data-act="create">🪄 צור דף מהתשובה (טיוטה)</button>' +
      '<button type="button" class="act" data-act="copy">העתק</button>' +
      '</div>';
  }

  async function send() {
    const message = input.value.trim();
    if (!message) return;
    if (!settings.hasKey) {
      bubble('system', 'קודם מגדירים מפתח בצד — או עוברים ל<a href="/admin/ai">הדבקה ידנית</a>.');
      return;
    }
    input.value = '';
    bubble('user', esc(message));
    setStatus('חושב…');
    $('btn-send').disabled = true;
    try {
      const d = await api('/admin/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message, history })
      });
      history.push({ role: 'user', content: message }, { role: 'assistant', content: d.reply || '' });
      renderTurn(d);
      setStatus('');
    } catch (e) {
      bubble('system', 'שגיאה: ' + esc(e.message));
      setStatus('');
    } finally {
      $('btn-send').disabled = false;
      input.focus();
    }
  }

  function wireActions(container, reply) {
    container.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.act === 'copy') {
          try { await navigator.clipboard.writeText(reply); btn.textContent = 'הועתק ✓'; } catch (e) {}
          return;
        }
        // create: the forgiving pipeline — extract → repair → DRAFT page
        btn.disabled = true;
        btn.textContent = 'בונה…';
        try {
          const d = await api('/admin/api/pzn/create-from-source', {
            method: 'POST',
            body: JSON.stringify({ source: reply })
          });
          bubble('system',
            'נוצרה טיוטה ✓ ' +
            '<a href="/admin/edit/' + encodeURIComponent(d.fullPath) + '">פתחו בבונה</a>' +
            (d.warnings && d.warnings.length ? ' · ' + d.warnings.length + ' אזהרות' : ''));
          btn.textContent = 'נוצר ✓';
        } catch (e) {
          bubble('system', 'הבנייה נכשלה: ' + esc(e.message));
          btn.disabled = false;
          btn.textContent = '🪄 צור דף מהתשובה (טיוטה)';
        }
      });
    });
  }

  /* ── boot ── */

  (async function init() {
    try {
      const d = await api('/admin/api/ai/settings');
      providers = d.providers || [];
      settings = d;
      renderSettings();
    } catch (e) {
      bubble('system', 'שגיאה בטעינת ההגדרות: ' + esc(e.message));
    }
    welcome(false);

    $('ai-provider-radios').addEventListener('change', syncProviderUI);
    $('ai-save').addEventListener('click', saveSettings);
    $('btn-send').addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });
  })();
})();
