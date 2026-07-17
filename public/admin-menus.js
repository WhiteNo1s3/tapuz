// Menus manager v2 (loaded by /admin/menus) — named menus, nesting, locations.
// Menus are entities: create/rename/delete any number; each site location
// (main header / footer) gets one assigned. Items are typed links
// (page/custom/tel/mailto/anchor) and nest one level deep (dropdowns).
(function () {
  var state = {
    menus: window.__TAPUZ_MENUS__ || { main: [], footer: [] },
    locations: window.__TAPUZ_MENU_LOCATIONS__ || { main: 'main', footer: 'footer' },
    active: 'main'
  };
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
      .then(function (d) { pagesCache = d.pages || []; cb(pagesCache); })
      .catch(function () { pagesCache = []; cb(pagesCache); });
  }

  // ---- path helpers: "2" = top item, "2.1" = its second child ----
  function itemAt(path) {
    var items = state.menus[state.active] || [];
    var parts = String(path).split('.');
    var it = items[+parts[0]];
    return parts.length === 1 ? it : (it && it.children ? it.children[+parts[1]] : null);
  }
  function listFor(path) {
    var items = state.menus[state.active] || [];
    var parts = String(path).split('.');
    if (parts.length === 1) return { list: items, index: +parts[0] };
    var parent = items[+parts[0]];
    if (!parent.children) parent.children = [];
    return { list: parent.children, index: +parts[1], parent: parent, parentIndex: +parts[0] };
  }

  function valueControl(it) {
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

  function rowHtml(it, path, isChild) {
    var typeOpts = TYPES.map(function (t) {
      return '<option value="' + t.v + '"' + (it.type === t.v ? ' selected' : '') + '>' + t.label + '</option>';
    }).join('');
    var nestBtns = isChild
      ? '<button type="button" data-outdent="1" title="הוצא החוצה" class="btn secondary" style="padding:6px 9px">↰</button>'
      : '<button type="button" data-indent="1" title="הפוך לתת־פריט של הקודם" class="btn secondary" style="padding:6px 9px">↳</button>' +
        '<button type="button" data-addchild="1" title="הוסף תת־פריט" class="btn secondary" style="padding:6px 9px">＋</button>';
    return '<div class="menu-row' + (isChild ? ' child-row' : '') + '" data-path="' + path + '" style="border:1px solid #e2e8f0;border-radius:10px;padding:10px;margin-bottom:10px">' +
      '<div style="display:grid;grid-template-columns:1fr 130px auto auto auto auto;gap:6px;align-items:center">' +
      '<input data-f="label" value="' + esc(it.label) + '" placeholder="תווית" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">' +
      '<select data-f="type" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">' + typeOpts + '</select>' +
      '<button type="button" data-up="1" title="למעלה" class="btn secondary" style="padding:6px 9px">↑</button>' +
      '<button type="button" data-down="1" title="למטה" class="btn secondary" style="padding:6px 9px">↓</button>' +
      nestBtns +
      '<button type="button" data-del="1" title="מחק" class="btn secondary" style="padding:6px 9px">✕</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;margin-top:6px">' +
      valueControl(it) +
      '<code style="font-size:0.75rem;color:#64748b;direction:ltr;background:#f8fafc;padding:4px 8px;border-radius:5px">' + esc(previewUrl(it)) + '</code>' +
      '</div></div>';
  }

  function renderMenuList() {
    var host = document.getElementById('menu-list');
    if (!host) return;
    var names = Object.keys(state.menus).sort();
    host.innerHTML = names.map(function (n) {
      var locBadges = [];
      if (state.locations.main === n) locBadges.push('<span class="chip-loc">ראשי</span>');
      if (state.locations.footer === n) locBadges.push('<span class="chip-loc">תחתון</span>');
      var count = (state.menus[n] || []).length;
      return '<button type="button" class="menu-chip' + (n === state.active ? ' active' : '') + '" data-menu="' + esc(n) + '">' +
        esc(n) + ' ' + locBadges.join(' ') +
        '<span class="chip-count">' + count + '</span></button>';
    }).join('');
    host.querySelectorAll('.menu-chip').forEach(function (chip) {
      chip.onclick = function () {
        state.active = chip.dataset.menu;
        renderAll();
      };
    });
  }

  function renderLocations() {
    var names = Object.keys(state.menus).sort();
    ['main', 'footer'].forEach(function (loc) {
      var sel = document.getElementById('loc-' + loc);
      if (!sel) return;
      sel.innerHTML = names.map(function (n) {
        return '<option value="' + esc(n) + '"' + (state.locations[loc] === n ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('');
      sel.onchange = function () {
        state.locations[loc] = sel.value;
        renderMenuList();
      };
    });
  }

  function renderEditor() {
    var title = document.getElementById('editor-title');
    if (title) title.textContent = 'תפריט: ' + state.active;
    var delBtn = document.getElementById('menu-delete');
    var renameBtn = document.getElementById('menu-rename');
    var isDefault = state.active === 'main' || state.active === 'footer';
    if (delBtn) {
      delBtn.disabled = isDefault;
      delBtn.title = isDefault ? 'תפריטי ברירת המחדל קבועים' : '';
      delBtn.style.opacity = isDefault ? '.5' : '';
    }
    if (renameBtn) {
      renameBtn.disabled = isDefault;
      renameBtn.title = isDefault ? 'תפריטי ברירת המחדל קבועים' : '';
      renameBtn.style.opacity = isDefault ? '.5' : '';
    }

    var host = document.getElementById('menu-items');
    if (!host) return;
    var items = state.menus[state.active] || [];
    if (!items.length) {
      host.innerHTML = '<div style="color:#64748b;padding:12px 0">אין פריטים — הוסיפו את הראשון</div>';
      return;
    }
    host.innerHTML = items.map(function (it, i) {
      var kids = (it.children || []).map(function (c, j) { return rowHtml(c, i + '.' + j, true); }).join('');
      return rowHtml(it, String(i), false) + kids;
    }).join('');
    bindRows(host);
  }

  function bindRows(host) {
    host.querySelectorAll('.menu-row').forEach(function (row) {
      var path = row.dataset.path;
      row.querySelectorAll('[data-f]').forEach(function (inp) {
        var handler = function () {
          var it = itemAt(path);
          if (!it) return;
          it[inp.dataset.f] = inp.value;
          if (inp.dataset.f === 'type') {
            if (inp.value !== 'custom') it.url = '';
            renderEditor();
          } else {
            var code = row.querySelector('code');
            if (code) code.textContent = previewUrl(it);
          }
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
      });
      var wire = function (attr, fn) {
        var b = row.querySelector('[data-' + attr + ']');
        if (b) b.onclick = function () { fn(); renderAll(); };
      };
      wire('up', function () {
        var ctx = listFor(path);
        if (ctx.index <= 0) return;
        var t = ctx.list[ctx.index - 1]; ctx.list[ctx.index - 1] = ctx.list[ctx.index]; ctx.list[ctx.index] = t;
      });
      wire('down', function () {
        var ctx = listFor(path);
        if (ctx.index >= ctx.list.length - 1) return;
        var t = ctx.list[ctx.index + 1]; ctx.list[ctx.index + 1] = ctx.list[ctx.index]; ctx.list[ctx.index] = t;
      });
      wire('del', function () {
        var ctx = listFor(path);
        ctx.list.splice(ctx.index, 1);
      });
      wire('addchild', function () {
        var it = itemAt(path);
        if (!it.children) it.children = [];
        it.children.push({ label: 'תת־פריט', type: 'page', target: '', url: '', children: [] });
      });
      wire('indent', function () {
        // become a child of the previous top-level sibling (WordPress drag-right)
        var ctx = listFor(path);
        if (ctx.index <= 0) return;
        var prev = ctx.list[ctx.index - 1];
        if (!prev.children) prev.children = [];
        var moved = ctx.list.splice(ctx.index, 1)[0];
        // one nesting level: absorb the moved item's own children as siblings
        (moved.children || []).forEach(function (c) { prev.children.push(c); });
        moved.children = [];
        prev.children.unshift(moved);
      });
      wire('outdent', function () {
        var ctx = listFor(path);
        var moved = ctx.list.splice(ctx.index, 1)[0];
        var items = state.menus[state.active];
        items.splice(ctx.parentIndex + 1, 0, moved);
      });
    });
  }

  function renderAll() {
    renderMenuList();
    renderLocations();
    renderEditor();
  }

  // ---- menu entity actions ----
  var createBtn = document.getElementById('menu-create');
  if (createBtn) createBtn.onclick = function () {
    var name = prompt('שם התפריט החדש (באנגלית, למשל side-nav):');
    if (!name) return;
    name = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!name) return alert('שם לא תקין');
    if (state.menus[name]) return alert('כבר קיים תפריט בשם הזה');
    state.menus[name] = [];
    state.active = name;
    renderAll();
  };

  var renameBtn = document.getElementById('menu-rename');
  if (renameBtn) renameBtn.onclick = function () {
    var oldName = state.active;
    if (oldName === 'main' || oldName === 'footer') return;
    var name = prompt('שם חדש לתפריט "' + oldName + '":', oldName);
    if (!name || name === oldName) return;
    name = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!name) return alert('שם לא תקין');
    if (state.menus[name]) return alert('כבר קיים תפריט בשם הזה');
    state.menus[name] = state.menus[oldName];
    delete state.menus[oldName];
    ['main', 'footer'].forEach(function (loc) {
      if (state.locations[loc] === oldName) state.locations[loc] = name;
    });
    state.active = name;
    // the old row dies server-side on save
    pendingDeletes.push(oldName);
    renderAll();
  };

  var pendingDeletes = [];
  var deleteBtn = document.getElementById('menu-delete');
  if (deleteBtn) deleteBtn.onclick = function () {
    var name = state.active;
    if (name === 'main' || name === 'footer') return;
    if (!confirm('למחוק את התפריט "' + name + '"? הפריטים שבו יאבדו.')) return;
    delete state.menus[name];
    ['main', 'footer'].forEach(function (loc) {
      if (state.locations[loc] === name) state.locations[loc] = loc;
    });
    pendingDeletes.push(name);
    state.active = 'main';
    renderAll();
  };

  var addItemBtn = document.getElementById('menu-add-item');
  if (addItemBtn) addItemBtn.onclick = function () {
    if (!state.menus[state.active]) state.menus[state.active] = [];
    state.menus[state.active].push({ label: 'פריט חדש', type: 'page', target: '', url: '', children: [] });
    renderEditor();
    renderMenuList();
  };

  // ---- save ----
  function save(build) {
    var deletes = pendingDeletes.slice();
    var chain = Promise.resolve();
    deletes.forEach(function (name) {
      chain = chain.then(function () {
        return fetch('/admin/api/menus/' + encodeURIComponent(name) + '/delete', { method: 'POST' });
      });
    });
    chain.then(function () {
      return fetch('/admin/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menus: state.menus, locations: state.locations })
      });
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return alert(d.error || 'שגיאה');
      state.menus = d.menus;
      if (d.locations) state.locations = d.locations;
      pendingDeletes = [];
      if (!state.menus[state.active]) state.active = 'main';
      renderAll();
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

  loadPages(renderAll);
})();
