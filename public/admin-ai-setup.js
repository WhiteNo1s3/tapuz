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
          ? 'דרך הדפדפן (Bridge V2)'
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
          '<div class="muted" style="margin-top:4px">נכנסים לקישור, יוצרים מפתח, מעתיקים — וחוזרים להדביק אותו כאן למטה.</div>'
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
      state.textContent = settings.hasKey && settings.provider === p.id
        ? 'יש מפתח שמור (מסתיים ב-' + settings.keyTail + ') — השדה ריק בכוונה; הדבקה תחליף אותו.'
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
        body: JSON.stringify({ baseUrl: $('ai-base-url').value.trim() })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok) {
            out.className = 'notice ok';
            out.textContent = '✅ מחובר! ' + (d.models.length
              ? 'מודלים טעונים: ' + d.models.join(', ')
              : 'השרת עונה (אין רשימת מודלים — טענו מודל ב-LM Studio)');
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
