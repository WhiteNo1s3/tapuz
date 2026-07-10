// Menus editor (loaded by /admin/menus)
(function () {
  var state = window.__TAPUZ_MENUS__ || { main: [], footer: [] };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/"/g, '"');
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
      return '<div class="menu-row" data-i="' + i + '" style="display:grid;grid-template-columns:1fr 1fr auto auto auto;gap:6px;margin-bottom:8px;align-items:center">' +
        '<input data-f="label" value="' + esc(it.label) + '" placeholder="תווית" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">' +
        '<input data-f="url" value="' + esc(it.url) + '" placeholder="/path" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">' +
        '<button type="button" data-up="1" title="למעלה" class="btn secondary" style="padding:6px 8px">↑</button>' +
        '<button type="button" data-down="1" title="למטה" class="btn secondary" style="padding:6px 8px">↓</button>' +
        '<button type="button" data-del="1" title="מחק" class="btn secondary" style="padding:6px 8px">✕</button>' +
      '</div>';
    }).join('');

    host.querySelectorAll('.menu-row').forEach(function (row) {
      var i = +row.dataset.i;
      row.querySelectorAll('input[data-f]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          state[name][i][inp.dataset.f] = inp.value;
        });
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

  render('main'); render('footer');

  document.querySelectorAll('[data-add]').forEach(function (btn) {
    btn.onclick = function () {
      var n = btn.getAttribute('data-add');
      if (!state[n]) state[n] = [];
      state[n].push({ label: 'פריט חדש', url: '/' });
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
