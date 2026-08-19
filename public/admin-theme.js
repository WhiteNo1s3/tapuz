// Theme builder — looks, live preview + save helpers (loaded by /admin/theme)
(function () {
  var colorKeys = ['primary', 'secondary', 'text', 'muted', 'border', 'bg', 'lightBg', 'surface'];
  var styleIds = ['th-radius', 'th-shadow', 'th-accent', 'th-font-heading'];

  // mirror src/theme.js scales for the live preview (server stays the truth)
  var RADIUS = { sharp: { md: '4px', lg: '6px' }, soft: { md: '8px', lg: '12px' }, round: { md: '14px', lg: '20px' } };
  var SHADOW = {
    flat: 'none',
    soft: '0 10px 30px rgba(2, 8, 23, 0.12)',
    deep: '0 18px 50px rgba(0, 0, 0, 0.45)'
  };

  function val(id, fallback) {
    var el = document.getElementById(id);
    return el && el.value !== undefined ? el.value : (fallback || '');
  }

  function bindColor(k) {
    var c = document.getElementById('th-color-' + k);
    var h = document.getElementById('th-color-' + k + '-hex');
    if (!c || !h) return;
    c.addEventListener('input', function () { h.value = c.value; preview(); });
    h.addEventListener('change', function () {
      if (/^#[0-9a-fA-F]{6}$/.test(h.value)) c.value = h.value;
      preview();
    });
  }
  colorKeys.forEach(bindColor);

  ['th-title', 'th-font', 'th-font-size', 'th-maxw', 'th-menu-place', 'th-logo-type', 'th-logo-text', 'th-logo-image', 'th-desc']
    .concat(styleIds)
    .forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', preview);
        el.addEventListener('change', preview);
      }
    });

  function colors() {
    var o = {};
    colorKeys.forEach(function (k) {
      var c = document.getElementById('th-color-' + k);
      o[k] = c ? c.value : '#000000';
    });
    return o;
  }

  function payload() {
    return {
      siteTitle: val('th-title'),
      description: val('th-desc'),
      logo: {
        type: val('th-logo-type', 'text') || 'text',
        text: val('th-logo-text'),
        image: val('th-logo-image'),
        width: 180,
        height: 50
      },
      overrides: {
        colors: colors(),
        fonts: {
          family: val('th-font'),
          headingFamily: val('th-font-heading'),
          baseSize: val('th-font-size', '17px') || '17px'
        },
        style: {
          radius: val('th-radius', 'soft') || 'soft',
          shadow: val('th-shadow', 'soft') || 'soft',
          accent: val('th-accent', 'solid') || 'solid'
        },
        layout: {
          maxWidth: val('th-maxw', '900px') || '900px',
          menuPlacement: val('th-menu-place', 'top') || 'top'
        }
      }
    };
  }

  function preview() {
    var p = payload();
    var box = document.getElementById('th-preview');
    if (!box) return;
    var c = p.overrides.colors;
    var st = p.overrides.style;
    var r = RADIUS[st.radius] || RADIUS.soft;
    var accentBg = st.accent === 'gradient'
      ? 'linear-gradient(135deg, ' + c.primary + ', ' + c.secondary + ')'
      : c.primary;
    // font stacks carry double quotes ("Times New Roman") — single-quote them
    // so they can live inside the double-quoted style="" attributes below
    var q = function (f) { return String(f || '').replace(/"/g, "'"); };
    var headingFont = q(p.overrides.fonts.headingFamily || p.overrides.fonts.family);
    box.style.background = c.bg;
    box.style.color = c.text;
    box.style.fontFamily = p.overrides.fonts.family;
    box.innerHTML =
      '<div style="font-weight:800;font-size:1.25rem;margin-bottom:8px;color:' + c.primary + ';font-family:' + headingFont + '">' +
      (p.siteTitle || 'Site').replace(/</g, '&lt;') + '</div>' +
      '<p style="color:' + c.muted + ';margin:0 0 12px">טקסט משני לדוגמה</p>' +
      '<div style="background:' + c.surface + ';border:1px solid ' + c.border + ';border-radius:' + r.lg + ';box-shadow:' + (SHADOW[st.shadow] || SHADOW.soft) + ';padding:14px;margin-bottom:14px">' +
      '<div style="font-weight:700;margin-bottom:4px;font-family:' + headingFont + '">כרטיס לדוגמה</div>' +
      '<p style="margin:0;color:' + c.muted + ';font-size:.9rem">כך ייראו כרטיסים, טפסים ומבזקים.</p>' +
      '</div>' +
      '<a href="#" style="display:inline-block;background:' + accentBg + ';color:#fff;padding:9px 18px;border-radius:' + r.md + ';text-decoration:none;font-weight:600">כפתור ראשי</a>' +
      '<hr style="border:none;border-top:1px solid ' + c.border + ';margin:16px 0">' +
      '<p style="margin:0">פסקת תוכן רגילה לבדיקת ניגודיות וקריאות.</p>';
  }

  // ── Looks: one-click whole personalities (data injected by the page) ──
  function setColor(k, v) {
    var c = document.getElementById('th-color-' + k);
    var h = document.getElementById('th-color-' + k + '-hex');
    if (c && v) c.value = v;
    if (h && v) h.value = v;
  }
  function setSelect(id, v) {
    var el = document.getElementById(id);
    if (el && v !== undefined) el.value = v;
  }

  function applyLook(look) {
    var o = look.overrides || {};
    Object.keys(o.colors || {}).forEach(function (k) { setColor(k, o.colors[k]); });
    if (o.style) {
      setSelect('th-radius', o.style.radius);
      setSelect('th-shadow', o.style.shadow);
      setSelect('th-accent', o.style.accent);
    }
    if (o.fonts && o.fonts.headingFamily !== undefined) setSelect('th-font-heading', o.fonts.headingFamily);
    preview();
  }

  function renderLooks() {
    var host = document.getElementById('th-looks');
    var looks = window.TAPUZ_LOOKS;
    if (!host || !looks) return;
    Object.keys(looks).forEach(function (key) {
      var look = looks[key];
      var c = (look.overrides || {}).colors || {};
      var card = document.createElement('button');
      card.type = 'button';
      card.setAttribute('dir', 'rtl');
      card.style.cssText = 'cursor:pointer;text-align:center;padding:12px 8px;border:1.5px solid #e2e8f0;border-radius:12px;background:' + (c.bg || '#fff') + ';transition:border-color .15s, transform .15s';
      var dots = ['primary', 'secondary', 'surface', 'text'].map(function (k) {
        return '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;margin:0 2px;border:1px solid rgba(0,0,0,.12);background:' + (c[k] || '#ccc') + '"></span>';
      }).join('');
      card.innerHTML =
        '<div style="font-size:1.5rem;line-height:1">' + (look.emoji || '🎨') + '</div>' +
        '<div style="font-weight:700;margin:6px 0 8px;color:' + (c.text || '#111') + '">' + look.label + '</div>' +
        '<div>' + dots + '</div>';
      card.addEventListener('mouseenter', function () { card.style.borderColor = '#94a3b8'; card.style.transform = 'translateY(-2px)'; });
      card.addEventListener('mouseleave', function () { card.style.borderColor = '#e2e8f0'; card.style.transform = 'none'; });
      card.addEventListener('click', function () { applyLook(look); });
      host.appendChild(card);
    });
  }

  function save(thenBuild) {
    fetch('/admin/api/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload())
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return alert(d.error || 'שגיאה');
      if (thenBuild) {
        return fetch('/admin/build', { method: 'POST' }).then(function (r) { return r.json(); }).then(function () {
          alert('נשמר ונבנה ✓');
          window.open('/', '_blank');
        });
      }
      alert('נשמר ✓');
    }).catch(function () { alert('שגיאה בשמירה'); });
  }

  var saveBtn = document.getElementById('th-save');
  if (saveBtn) saveBtn.onclick = function () { save(false); };

  var saveBuildBtn = document.getElementById('th-save-build');
  if (saveBuildBtn) saveBuildBtn.onclick = function () { save(true); };

  var resetBtn = document.getElementById('th-reset');
  if (resetBtn) resetBtn.onclick = function () {
    if (!confirm('לאפס overrides לברירת מחדל?')) return;
    // the 'naki' look IS the default bundle — one source of truth
    var naki = (window.TAPUZ_LOOKS || {}).naki;
    var overrides = naki ? JSON.parse(JSON.stringify(naki.overrides)) : {};
    overrides.fonts = overrides.fonts || {};
    overrides.fonts.family = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Hebrew", sans-serif';
    overrides.fonts.baseSize = '17px';
    overrides.layout = { maxWidth: '900px', menuPlacement: 'top' };
    fetch('/admin/api/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: overrides })
    }).then(function () { location.reload(); });
  };

  // ── Theme package import (v0.99) — paste an exported file's JSON, apply ──
  var importBtn = document.getElementById('th-import-apply');
  if (importBtn) importBtn.onclick = function () {
    var status = document.getElementById('th-import-status');
    var raw = (document.getElementById('th-import-text') || {}).value || '';
    var pkg;
    try {
      pkg = JSON.parse(raw);
    } catch (e) {
      if (status) { status.textContent = 'לא JSON תקין'; status.style.color = '#b91c1c'; }
      return;
    }
    fetch('/admin/api/theme/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: pkg })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!status) return;
      if (d.ok) {
        status.textContent = 'הוחל ✓ — טוען מחדש…';
        status.style.color = '#166534';
        setTimeout(function () { location.reload(); }, 600);
      } else {
        status.textContent = d.error || 'שגיאה';
        status.style.color = '#b91c1c';
      }
    }).catch(function () {
      if (status) { status.textContent = 'שגיאת רשת'; status.style.color = '#b91c1c'; }
    });
  };

  // ── Theme LIBRARY (v2.21) — themes as artifacts, the WordPress attitude ──
  function libStatus(msg, ok) {
    var el = document.getElementById('th-lib-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = ok ? '#166534' : '#b91c1c';
  }

  function libApi(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderLibrary() {
    var list = document.getElementById('th-lib-list');
    if (!list) return;
    fetch('/admin/api/theme/library').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { list.textContent = d.error || 'שגיאה'; return; }
      if (!d.themes.length) {
        list.innerHTML = '<div style="grid-column:1/-1;color:#64748b">אין עדיין ערכות שמורות — שמרו את הערכה הנוכחית בשם, או הדביקו ערכה מה-AI בייבוא למטה.</div>';
        return;
      }
      list.innerHTML = d.themes.map(function (t) {
        var dots = (t.palette || []).map(function (c) {
          return '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;border:1px solid #e2e8f0;background:' + esc(c) + '"></span>';
        }).join('');
        var srcLabel = t.source === 'ai' ? '🤖 נבנה עם AI' : t.source === 'import' ? '📦 יובא' : t.source === 'auto' ? '⏪ גיבוי אוטומטי' : '✋ נשמר ידנית';
        return '<div style="border:1.5px solid #e2e8f0;border-radius:10px;padding:12px" data-thm="' + esc(t.id) + '">' +
          '<div style="font-weight:700;margin-bottom:4px">' + esc(t.name) + '</div>' +
          '<div style="display:flex;gap:5px;margin-bottom:6px">' + dots + '</div>' +
          '<div style="font-size:0.75rem;color:#64748b;margin-bottom:10px">' + srcLabel + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          '<button type="button" class="btn" data-lib-apply="' + esc(t.id) + '" style="font-size:0.82rem;padding:6px 10px">החל</button>' +
          '<a class="btn secondary" href="/admin/api/theme/library/export?id=' + encodeURIComponent(t.id) + '" download style="font-size:0.82rem;padding:6px 10px">ייצוא</a>' +
          '<button type="button" class="btn secondary" data-lib-remove="' + esc(t.id) + '" style="font-size:0.82rem;padding:6px 10px">מחיקה</button>' +
          '</div></div>';
      }).join('');

      list.querySelectorAll('[data-lib-apply]').forEach(function (btn) {
        btn.onclick = function () {
          libApi('/admin/api/theme/library/apply', { id: btn.dataset.libApply }).then(function (d2) {
            if (d2.ok) {
              libStatus('הוחלה "' + d2.name + '"' + (d2.backedUp ? ' · העבודה הקודמת גובתה אוטומטית' : '') + ' — טוען מחדש…', true);
              setTimeout(function () { location.reload(); }, 700);
            } else libStatus(d2.error || 'שגיאה', false);
          });
        };
      });
      list.querySelectorAll('[data-lib-remove]').forEach(function (btn) {
        btn.onclick = function () {
          if (!confirm('למחוק את הערכה מהספרייה? (האתר החי לא מושפע)')) return;
          libApi('/admin/api/theme/library/remove', { id: btn.dataset.libRemove }).then(function (d2) {
            if (d2.ok) renderLibrary();
            else libStatus(d2.error || 'שגיאה', false);
          });
        };
      });
    }).catch(function () { libStatus('שגיאת רשת', false); });
  }

  var libSave = document.getElementById('th-lib-save');
  if (libSave) libSave.onclick = function () {
    var name = (document.getElementById('th-lib-name') || {}).value || '';
    libApi('/admin/api/theme/library', { name: name }).then(function (d) {
      if (d.ok) {
        libStatus('נשמרה "' + d.name + '" ✓', true);
        var nameEl = document.getElementById('th-lib-name');
        if (nameEl) nameEl.value = '';
        renderLibrary();
      } else libStatus(d.error || 'שגיאה', false);
    }).catch(function () { libStatus('שגיאת רשת', false); });
  };

  // import-to-LIBRARY: the AI-built package becomes one of the available
  // themes instead of replacing the live one
  var importLib = document.getElementById('th-import-library');
  if (importLib) importLib.onclick = function () {
    var status = document.getElementById('th-import-status');
    var raw = (document.getElementById('th-import-text') || {}).value || '';
    var pkg;
    try { pkg = JSON.parse(raw); } catch (e) {
      if (status) { status.textContent = 'לא JSON תקין'; status.style.color = '#b91c1c'; }
      return;
    }
    libApi('/admin/api/theme/library/import', { package: pkg }).then(function (d) {
      if (!status) return;
      if (d.ok) {
        status.textContent = 'נשמרה לספרייה כ-"' + d.name + '" ✓ (האתר החי לא השתנה)';
        status.style.color = '#166534';
        renderLibrary();
      } else {
        status.textContent = d.error || 'שגיאה';
        status.style.color = '#b91c1c';
      }
    }).catch(function () {
      if (status) { status.textContent = 'שגיאת רשת'; status.style.color = '#b91c1c'; }
    });
  };

  renderLibrary();

  renderLooks();
  // Initial preview
  setTimeout(preview, 50);
})();
