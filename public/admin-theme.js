// Theme builder live preview + save helpers (loaded by /admin/theme)
(function () {
  var colorKeys = ['primary', 'text', 'muted', 'border', 'bg', 'lightBg'];

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

  ['th-title', 'th-font', 'th-font-size', 'th-maxw', 'th-menu-place', 'th-logo-type', 'th-logo-text', 'th-logo-image', 'th-desc'].forEach(function (id) {
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
      siteTitle: (document.getElementById('th-title') || {}).value || '',
      description: (document.getElementById('th-desc') || {}).value || '',
      logo: {
        type: (document.getElementById('th-logo-type') || {}).value || 'text',
        text: (document.getElementById('th-logo-text') || {}).value || '',
        image: (document.getElementById('th-logo-image') || {}).value || '',
        width: 180,
        height: 50
      },
      overrides: {
        colors: colors(),
        fonts: {
          family: (document.getElementById('th-font') || {}).value || '',
          baseSize: (document.getElementById('th-font-size') || {}).value || '17px'
        },
        layout: {
          maxWidth: (document.getElementById('th-maxw') || {}).value || '900px',
          menuPlacement: (document.getElementById('th-menu-place') || {}).value || 'top'
        }
      }
    };
  }

  function preview() {
    var p = payload();
    var box = document.getElementById('th-preview');
    if (!box) return;
    box.style.background = p.overrides.colors.bg;
    box.style.color = p.overrides.colors.text;
    box.style.fontFamily = p.overrides.fonts.family;
    box.innerHTML =
      '<div style="font-weight:700;font-size:1.2rem;margin-bottom:8px;color:' + p.overrides.colors.primary + '">' +
      (p.siteTitle || 'Site').replace(/</g, '<') + '</div>' +
      '<p style="color:' + p.overrides.colors.muted + ';margin:0 0 12px">טקסט משני לדוגמה</p>' +
      '<a href="#" style="display:inline-block;background:' + p.overrides.colors.primary + ';color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:600">כפתור</a>' +
      '<hr style="border:none;border-top:1px solid ' + p.overrides.colors.border + ';margin:16px 0">' +
      '<p style="margin:0">פסקת תוכן רגילה לבדיקת ניגודיות וקריאות.</p>';
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
    fetch('/admin/api/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        overrides: {
          colors: { primary: '#0a66c2', text: '#111827', muted: '#6b7280', border: '#e5e7eb', bg: '#ffffff', lightBg: '#f8fafc' },
          fonts: { family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Hebrew", sans-serif', baseSize: '17px' },
          layout: { maxWidth: '900px', menuPlacement: 'top' }
        }
      })
    }).then(function () { location.reload(); });
  };

  // Initial preview
  setTimeout(preview, 50);
})();
