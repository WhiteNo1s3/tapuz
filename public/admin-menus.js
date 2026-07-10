// Menus editor (loaded by /admin/menus) — typed links: page/custom/tel/mailto/anchor
(function () {
  var state = window.__TAPUZ_MENUS__ || { main: [], footer: [] };
  var pagesCache = null;

  var TYPES = [
    { v: 'page', label: 'דף קיים' },
    { v: 'custom', label: 'קישור חופשי' },
    { v: 'tel', label: 'טלפון (חיוג)' },
    { v: 'mailto', label: 'אימייל' },
    { v: 'anchor', label: 'עוגן בדף' }
  ];
  var PLACEHOLDERS = {
    custom: 'https://... או /page.html',
    tel: '+972501234567',
    mailto: 'name@example.com',
    anchor: 'section-id'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function previewUrl(it) {
    var t = String(it.target || '').trim();
    if (it.type === 'page') return t ? '/' + t.replace(/^\/+/, '').replace(/\.html$/i, '') + '.html' : '—';
    if (it.type === 'tel') return t ? 'tel:' + t.replace(/[^+\d]/g, '') : '—';
    if (it.type === 'mailto') return t ? 'mailto:' + t : '—';
    if (it.type === 'anchor') return t ? (t.charAt(0) === '#' ? t : '#' + t) : '—';
    return it.url || t || '—';
  }

  function loadPages(cb) {
    if (pagesCache) return cb(pagesCache);
    fetch('/admin/api/pages')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        pagesCache = d.pages || [];
        cb(pagesCache);
      })
      .catch(function () { pagesCache = []; cb(pagesCache); });
  }

  function valueControl(it, i, name) {
    if (it.type === 'page') {
      var opts = (pagesCache || []).map(function (p) {
        var sel = it.target === p.full_path ? ' selected' : '';
        var mark = p.status === 'published' ? '' : ' (טיוטה)';
        return '<option value="' + esc(p.full_path) + '"' + sel + '>' + esc(p.title || p.full_path) + mark + '</option>';
      }).join('');
      var none = it.target ? '' : '<option value="" selected>בחר דף…</option>';
      return '<select data-f="target" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px;max-width:100%">' + none + opts + '</select>';
    }
    var key = it.type === 'custom' ? 'url' : 'target';
    var val = it.type === 'custom' ? (it.url === '#' ? '' : it.url) : it.target;
    return '<input data-f="' + key + '" value="' + esc(val || '') + '" dir="ltr" placeholder="' +
      esc(PLACEHOLDERS[it.type] || '') + '" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">';
  }

  function render(name) {
    var host = document.getElementById('menu-' + name);
    if (!host) return;
    var items = state[name] || [];
    if (!items.length) {
      host.innerHTML = '<div style="color:#64748b;padding:12px 0">אין פריטים</div>';
      return;
    }
    host.innerHTML = items.map(function (it, i) {
      var typeOpts = TYPES.map(function (t) {
        return '<option value="' + t.v + '"' + (it.type === t.v ? ' selected' : '') + '>' + t.label + '</option>';
      }).join('');
      return '<div class="menu-row" data-i="' + i + '" style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:10px">' +
        '<div style="display:grid;grid-template-columns:1fr 130px auto auto auto;gap:6px;align-items:center">' +
        '<input data-f="label" value="' + esc(it.label) + '" placeholder="תווית" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">' +
        '<select data-f="type" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">' + typeOpts + '</select>' +
        '<button type="button" data-up="1" title="למעלה" class="btn secondary" style="padding:6px 9px">↑</button>' +
        '<button type="button" data-down="1" title="למטה" class="btn secondary" style="padding:6px 9px">↓</button>' +
        '<button type="button" data-del="1" title="מחק" class="btn secondary" style="padding:6px 9px">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;margin-top:6px">' +
        valueControl(it, i, name) +
        '<code style="font-size:0.75rem;color:#64748b;direction:ltr;background:#f8fafc;padding:4px 8px;border-radius:5px">' + esc(previewUrl(it)) + '</code>' +
        '</div></div>';
    }).join('');
    bindRows(host, name);
  }

  function bindRows(host, name) {
    host.querySelectorAll('.menu-row').forEach(function (row) {
      var i = +row.dataset.i;
      row.querySelectorAll('[data-f]').forEach(function (inp) {
        var handler = function () {
          var f = inp.dataset.f;
          state[name][i][f] = inp.value;
          if (f === 'type') {
            if (inp.value !== 'custom') state[name][i].url = '';
            render(name);
          } else {
            var code = row.querySelector('code');
            if (code) code.textContent = previewUrl(state[name][i]);
          }
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
      });
      var up = row.querySelector('[data-up]');
      var down = row.querySelector('[data-down]');
      var del = row.querySelector('[data-del]');
      if (up) up.onclick = function () {
        if (i <= 0) return;
        var t = state[name][i - 1]; state[name][i - 1] = state[name][i]; state[name][i] = t; render(name);
      };
      if (down) down.onclick = function () {
        if (i >= state[name].length - 1) return;
        var t = state[name][i + 1]; state[name][i + 1] = state[name][i]; state[name][i] = t; render(name);
      };
      if (del) del.onclick = function () {
        state[name].splice(i, 1); render(name);
      };
    });
  }

  loadPages(function () { render('main'); render('footer'); });

  document.querySelectorAll('[data-add]').forEach(function (btn) {
    btn.onclick = function () {
      var n = btn.getAttribute('data-add');
      if (!state[n]) state[n] = [];
      state[n].push({ label: 'פריט חדש', type: 'page', target: '', url: '' });
      render(n);
    };
  });

  function save(build) {
    fetch('/admin/api/menus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menus: state })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return alert(d.error || 'שגיאה');
      state = d.menus;
      render('main'); render('footer');
      if (build) {
        return fetch('/admin/build', { method: 'POST' }).then(function (r) { return r.json(); }).then(function () {
          alert('נשמר ונבנה ✓');
          window.open('/', '_blank');
        });
      }
      alert('תפריטים נשמרו ✓');
    }).catch(function () { alert('שגיאה'); });
  }

  var saveBtn = document.getElementById('menu-save');
  if (saveBtn) saveBtn.onclick = function () { save(false); };

  var saveBuildBtn = document.getElementById('menu-save-build');
  if (saveBuildBtn) saveBuildBtn.onclick = function () { save(true); };
})();
