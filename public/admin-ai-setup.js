'use strict';

/**
 * חיבור AI (v2.15) — the setup screen's client.
 * Reads/writes /admin/api/ai/settings, tests the local runtime via
 * /admin/api/ai/test, and keeps the provider's CREATE-A-KEY link in the
 * user's face (it is a different page from this paste-the-key page).
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var providers = [];
  var settings = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── the bridge (v2.29) ────────────────────────────────────────────────
   * The third way to connect, and the only one a HOSTED site has for a local
   * model: admin-bridge.js announces the extension's content script, and the
   * list of loaded models arrives right behind it. Both are events, so this
   * card renders three times in a good case (unknown → present → models).   */
  function bridgeModels() {
    return (window.TapuzBridge && window.TapuzBridge.models) || [];
  }
  function bridgePresent() {
    return !!(window.TapuzBridge && window.TapuzBridge.present);
  }

  /* ── the window (v2.32) ────────────────────────────────────────────────
   * Ben's copilot hit `request (17246 tokens) exceeds the available context
   * size (8192 tokens)`: LM Studio's GUI loads a model at 8K by default and
   * nothing on this screen ever said so. Now the ✅ line carries the loaded
   * window (the server probes /api/v0/models), and the bridge card carries
   * what the extension probed (bridge 0.5.0 — an older one cannot ask, and
   * also drops the model's tool calls, so it gets a nudge to update).
   * The sentences come from the server (src/ai-window.js) — one wording. */
  var BRIDGE_MIN = '0.5.0';

  function versionLt(a, b) {
    var pa = String(a || '0').split('.').map(function (x) { return parseInt(x, 10) || 0; });
    var pb = String(b || '0').split('.').map(function (x) { return parseInt(x, 10) || 0; });
    for (var i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
    return false;
  }

  function bridgeWindow() {
    return (window.TapuzBridge && window.TapuzBridge.window) || null;
  }
  function bridgeVersion() {
    return (window.TapuzBridge && window.TapuzBridge.version) || '';
  }

  /** The bridge's window, as a sentence: the server plans it AS the browser
   *  courier (?provider=browser) whatever provider is saved right now. */
  function renderBridgeWindow() {
    var box = $('ai-bridge-window');
    if (!box) return;
    var w = bridgeWindow();
    var lines = [];
    var v = bridgeVersion();
    if (v && versionLt(v, BRIDGE_MIN)) {
      lines.push('גרסת התוסף: ' + esc(v) + ' — מומלץ לעדכן ל-' + BRIDGE_MIN + ' (קוראת את חלון המודל ומעבירה את כלי הקופיילוט; ההורדה למטה).');
    }
    if (!w || !w.tokens) {
      box.innerHTML = lines.join('<br>');
      return;
    }
    var q = new URLSearchParams({
      provider: 'browser', source: 'bridge', tokens: w.tokens, maxTokens: w.maxTokens || '',
      model: w.model || '', bridgeVersion: w.bridgeVersion || v
    });
    fetch('/admin/api/ai/window?' + q.toString())
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.message) {
          lines.unshift('🪟 ' + esc(d.message) + ' (מומלץ: ' + Number(d.recommended || 32768).toLocaleString('en-US') + ')');
        } else {
          lines.unshift('🪟 חלון המודל דרך התוסף: ' + Number(w.tokens).toLocaleString('en-US') + ' טוקנים.');
        }
        box.innerHTML = lines.join('<br>');
      })
      .catch(function () {
        lines.unshift('🪟 חלון המודל דרך התוסף: ' + Number(w.tokens).toLocaleString('en-US') + ' טוקנים.');
        box.innerHTML = lines.join('<br>');
      });
  }

  function renderBridge() {
    var st = $('ai-bridge-state');
    var sel = $('ai-bridge-model');
    if (!st || !sel) return;
    var models = bridgeModels();
    var chosen = sel.value || (settings && settings.provider === 'browser' ? settings.model || '' : '');
    var opts = [{ v: '', t: 'מה שטעון אצלכם באותו רגע' }];
    models.forEach(function (m) { opts.push({ v: m, t: m }); });
    if (chosen && models.indexOf(chosen) === -1) opts.push({ v: chosen, t: chosen + ' (לא טעון כרגע)' });
    sel.innerHTML = opts.map(function (o) {
      return '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>';
    }).join('');
    sel.value = chosen;

    // the window line lives in its own box under the state, so the state
    // (present / models) and the window (probed later) render independently
    var wbox = $('ai-bridge-window');
    if (!wbox) {
      wbox = document.createElement('div');
      wbox.id = 'ai-bridge-window';
      wbox.className = 'muted';
      wbox.style.marginTop = '8px';
      st.parentNode.insertBefore(wbox, st.nextSibling);
    }

    var active = settings && settings.provider === 'browser';
    if (!bridgePresent()) {
      st.className = 'notice';
      st.innerHTML = '💤 הגשר לא מחובר לאתר הזה. התקינו את <strong>Bridge V2</strong> (למטה), פתחו את התוסף, ' +
        'לחצו <strong>״חבר את האתר הפתוח״</strong> — ורעננו את הדף.' +
        (active ? '<br>הספק כבר מוגדר ״דרך הדפדפן״, אז ברגע שהגשר יתחבר הכול יעבוד.' : '');
      wbox.innerHTML = '';
      return;
    }
    if (!models.length) {
      st.className = 'notice warn';
      st.innerHTML = '🌉 הגשר מחובר — אבל לא נמצא מודל טעון. ב-LM Studio: טענו מודל, ו-Developer → <strong>Start Server</strong>.';
      renderBridgeWindow();
      return;
    }
    st.className = 'notice ok';
    st.innerHTML = '🌉 הגשר מחובר ✓ ' + models.length + ' מודלים טעונים אצלכם: <code dir="ltr">' +
      esc(models.join(', ')) + '</code>' +
      (active ? '' : '<br>בחרו מודל ולחצו ״חבר דרך הדפדפן״.');
    renderBridgeWindow();
  }

  function keyedProviders() {
    // the key section lists only providers a key can be created FOR
    return providers.filter(function (p) { return p.keyUrl; });
  }

  function renderStatus() {
    var b = $('ai-status-banner');
    if (!b || !settings) return;
    var configured = settings.hasKey || settings.provider === 'local' || settings.provider === 'browser';
    if (configured) {
      var how = settings.provider === 'local'
        ? 'מודל מקומי (' + (settings.baseUrl || 'http://127.0.0.1:1234/v1') + ')'
        : settings.provider === 'browser'
          ? 'דרך הדפדפן (Bridge V2) — ' + (settings.model || 'המודל הטעון אצלכם')
          : 'מפתח ' + settings.provider + ' (מסתיים ב-' + settings.keyTail + ')';
      b.className = 'notice ok';
      b.innerHTML = '✅ מחובר: ' + esc(how) + ' — הקופיילוט מופיע בבונה.';
    } else {
      b.className = 'notice';
      b.innerHTML = '💤 עדיין לא חובר AI — הקופיילוט מוסתר בבונה עד שתחברו כאן (מודל מקומי או מפתח).';
    }
  }

  function renderProviders() {
    var sel = $('ai-provider');
    if (!sel) return;
    sel.innerHTML = keyedProviders().map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>';
    }).join('');
    var current = keyedProviders().some(function (p) { return p.id === settings.provider; })
      ? settings.provider : (keyedProviders()[0] || {}).id;
    if (current) sel.value = current;
    renderKeyBits();
  }

  function renderKeyBits() {
    var sel = $('ai-provider');
    var p = providers.find(function (x) { return x.id === sel.value; }) || {};
    var create = $('ai-key-create');
    if (create) {
      create.innerHTML = p.keyUrl
        ? '🔗 <strong>יצירת מפתח אצל ' + esc(p.label) + ':</strong> ' +
          '<a href="' + esc(p.keyUrl) + '" target="_blank" rel="noopener" dir="ltr">' + esc(p.keyUrl) + '</a>' +
          '<div class="muted" style="margin-top:4px">נכנסים לקישור, יוצרים מפתח, מעתיקים — וחוזרים להדביק אותו כאן למטה.</div>' +
          (p.note ? '<div class="muted" style="margin-top:6px">ℹ️ ' + esc(p.note) + '</div>' : '')
        : '';
    }
    var keyInput = $('ai-api-key');
    if (keyInput) keyInput.placeholder = p.keyHint || '';
    var modelSel = $('ai-model');
    if (modelSel) {
      modelSel.innerHTML = (p.models || []).map(function (m) {
        return '<option value="' + esc(m) + '">' + esc(m) + '</option>';
      }).join('') || '<option value="">' + esc(p.defaultModel || '') + '</option>';
      if (settings.provider === p.id && settings.model) modelSel.value = settings.model;
    }
    var state = $('ai-key-state');
    if (state) {
      // v2.52 — keys are kept PER supplier: what is on file for the one picked here, never another's
      var tail = (settings.keyTails || {})[p.id] || '';
      state.textContent = tail
        ? 'יש מפתח שמור לספק הזה (מסתיים ב-' + tail + ') — השדה ריק בכוונה; הדבקה תחליף אותו.'
        : 'אין מפתח שמור לספק הזה עדיין.';
    }
  }

  function load() {
    fetch('/admin/api/ai/settings')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'שגיאה');
        settings = d;
        providers = d.providers || [];
        $('ai-base-url').value = d.baseUrl || '';
        if (d.provider === 'local' && d.model) $('ai-local-model').value = d.model;
        renderStatus();
        renderProviders();
        renderBridge();
      })
      .catch(function (e) {
        var b = $('ai-status-banner');
        if (b) { b.className = 'notice danger'; b.textContent = 'שגיאה בטעינת ההגדרות: ' + e.message; }
      });
  }

  function saveSettings(patch, onDone) {
    fetch('/admin/api/ai/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'שגיאה');
        settings = Object.assign({}, settings, d);
        renderStatus();
        renderKeyBits();
        renderBridge();
        if (onDone) onDone(null, d);
      })
      .catch(function (e) { if (onDone) onDone(e); else alert(e.message); });
  }

  function boot() {
    load();

    $('ai-save-local').addEventListener('click', function () {
      saveSettings({
        provider: 'local',
        baseUrl: $('ai-base-url').value.trim(),
        model: $('ai-local-model').value.trim()
      }, function (err) {
        if (err) return alert(err.message);
        var out = $('ai-test-result');
        out.style.display = 'block';
        out.className = 'notice ok';
        out.textContent = 'נשמר ✓ — עכשיו כדאי ללחוץ ״בדיקת חיבור״';
      });
    });

    $('ai-test-local').addEventListener('click', function () {
      var out = $('ai-test-result');
      out.style.display = 'block';
      out.className = 'notice';
      out.textContent = 'בודק…';
      fetch('/admin/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: $('ai-base-url').value.trim(), model: $('ai-local-model').value.trim() })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok) {
            out.className = 'notice ok';
            out.textContent = '✅ מחובר! ' + (d.models.length
              ? 'מודלים טעונים: ' + d.models.join(', ')
              : 'השרת עונה (אין רשימת מודלים — טענו מודל ב-LM Studio)');
            // the window sentence (the server probed LM Studio's loaded
            // context length; a JIT-loaded model gets the "loaded on request
            // at the default" prefix from the server) — the line that would
            // have explained the 8K error before it happened
            if (d.windowMessage) {
              out.textContent += '\n🪟 ' + d.windowMessage;
              if (d.window && d.window.tokens && d.window.tokens < 32768) out.className = 'notice warn';
            }
          } else {
            out.className = 'notice danger';
            out.textContent = '❌ ' + (d.error || 'החיבור נכשל');
          }
        })
        .catch(function (e) {
          out.className = 'notice danger';
          out.textContent = '❌ ' + e.message;
        });
    });

    $('ai-provider').addEventListener('change', renderKeyBits);

    $('ai-save-key').addEventListener('click', function () {
      var key = $('ai-api-key').value.trim();
      var patch = {
        provider: $('ai-provider').value,
        model: $('ai-model').value
      };
      if (key) patch.apiKey = key; // empty field = keep the stored key
      saveSettings(patch, function (err) {
        if (err) return alert(err.message);
        $('ai-api-key').value = '';
        alert('נשמר ✓');
      });
    });

    $('ai-clear-key').addEventListener('click', function () {
      if (!confirm('למחוק את המפתח השמור?')) return;
      saveSettings({ apiKey: '' });
    });

    // the bridge card: the provider carries no key and no address — the
    // extension owns the loopback endpoint, so the only choice here is which
    // of the owner's loaded models answers.
    $('ai-save-bridge').addEventListener('click', function () {
      saveSettings({ provider: 'browser', model: $('ai-bridge-model').value }, function (err) {
        if (err) return alert(err.message);
        var st = $('ai-bridge-state');
        if (st && !bridgePresent()) return;
        if (st) {
          st.className = 'notice ok';
          st.innerHTML = '🌉 מחובר ✓ החבילות ב-<a href="/admin/inject">הזרקות</a> וב-<a href="/admin/menus">תפריטים</a> ירוצו עכשיו על המודל שלכם.';
        }
      });
    });
    document.addEventListener('tapuz-bridge-hello', renderBridge);
    document.addEventListener('tapuz-bridge-models', renderBridge);
    // bridge 0.5.0 probes the window after the model list — the card's
    // window line follows it (an older bridge never fires this)
    document.addEventListener('tapuz-bridge-window', renderBridgeWindow);
  }

  // browser detection (v2.18.1): the matching download button wears a chip —
  // and both stay visible, plain and simple, exactly as Ben asked
  function markBrowserButtons() {
    var isFirefox = /firefox/i.test(navigator.userAgent);
    var mine = isFirefox ? 'firefox' : 'chrome';
    document.querySelectorAll('[data-ext-browser="' + mine + '"]').forEach(function (a) {
      a.classList.add('is-your-browser');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(); markBrowserButtons(); });
  else { boot(); markBrowserButtons(); }
})();
