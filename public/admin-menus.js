// Menus manager v2 (loaded by /admin/menus) — named menus, nesting, locations.
// Menus are entities: create/rename/delete any number; each site location
// (main header / footer) gets one assigned. Items are typed links
// (page/custom/tel/mailto/anchor) and nest one level deep (dropdowns).
(function () {
  var state = {
    menus: window.__TAPUZ_MENUS__ || { main: [], footer: [] },
    locations: window.__TAPUZ_MENU_LOCATIONS__ || { main: 'main', footer: 'footer' },
    active: 'main',
    lang: window.__TAPUZ_MENU_LANG__ || window.__TAPUZ_MENU_SITE_LANG__ || '',
    siteLang: window.__TAPUZ_MENU_SITE_LANG__ || '',
    languages: window.__TAPUZ_MENU_LANGUAGES__ || [],
    inherited: window.__TAPUZ_MENU_INHERITED__ || {},
    langSwitch: window.__TAPUZ_LANG_SWITCH__ || 'header'
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

  function isSiteLang() {
    return !state.lang || state.lang === state.siteLang;
  }
  function langQuery() {
    return isSiteLang() ? '' : ('?lang=' + encodeURIComponent(state.lang));
  }
  function storageName(name) {
    if (isSiteLang() || String(name).indexOf('@') >= 0) return name;
    return name + '@' + state.lang;
  }
  function markEdited() {
    if (!state.inherited) state.inherited = {};
    state.inherited[state.active] = false;
    updateLangHint();
  }
  function updateLangHint() {
    var hint = document.getElementById('menu-lang-hint');
    if (!hint) return;
    var show = !isSiteLang() && state.inherited && (state.inherited.main || state.inherited.footer);
    hint.hidden = !show;
  }

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
    var lockedDefault = isDefault && isSiteLang();
    var nothingSaved = !isSiteLang() && state.inherited && state.inherited[state.active];
    if (delBtn) {
      delBtn.disabled = lockedDefault || !!nothingSaved;
      delBtn.title = lockedDefault ? 'תפריטי ברירת המחדל קבועים'
        : (nothingSaved ? 'אין תפריט שמור לשפה הזו'
          : (!isSiteLang() && isDefault ? 'מוחק את התפריט של השפה — הגולשים יראו את תפריט שפת האתר' : ''));
      delBtn.style.opacity = (lockedDefault || nothingSaved) ? '.5' : '';
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
          markEdited();
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
        if (b) b.onclick = function () { markEdited(); fn(); renderAll(); };
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

  function renderLangControls() {
    var sel = document.getElementById('menu-lang');
    if (sel && document.activeElement !== sel) {
      sel.innerHTML = (state.languages || []).map(function (l) {
        var code = l.code || l;
        var label = l.label || code;
        return '<option value="' + esc(code) + '"' + (code === state.lang ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
    }
    var sw = document.getElementById('menu-langswitch');
    if (sw && document.activeElement !== sw) sw.value = state.langSwitch === 'float' ? 'float' : 'header';
    var exp = document.getElementById('menu-export');
    if (exp) exp.href = '/admin/api/menus/export.bent' + langQuery();
    var prev = document.getElementById('menu-live-preview');
    if (prev) prev.href = '/admin/menus/preview/live' + langQuery();
    window.__TAPUZ_MENU_LANG__ = state.lang || '';
    ['main', 'footer'].forEach(function (loc) {
      var s = document.getElementById('loc-' + loc);
      if (!s) return;
      s.disabled = !isSiteLang();
      s.title = isSiteLang() ? '' : 'המיקומים משותפים לאתר ונשמרים רק בשפת האתר';
    });
    updateLangHint();
  }

  function renderAll() {
    renderMenuList();
    renderLocations();
    renderEditor();
    renderLangControls();
  }

  // ── the organizer's layer (v2.28): the capacity hint, backups, a reload hook ──
  // "In one row fit ~N items / ~C chars · today R rows" — the same estimate
  // the organizer prompt states, so the owner sees the number before asking.
  function loadFit() {
    var el = document.getElementById('menu-fit');
    if (!el) return;
    fetch('/admin/api/menus/fit' + langQuery())
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.fit) return;
        var f = d.fit;
        var prefix = f.mode === 'side' ? 'מסילת צד · ' : f.mode === 'scroll' ? 'רצועת גלילה · ' : f.mode === 'drawer' ? 'מגירה · ' : '';
        el.textContent = prefix + 'בשורה אחת נכנסים ~' + f.capacity + ' פריטים / ~' + f.charBudget + ' תווים · היום ' + f.rowsNow + ' שורות';
      })
      .catch(function () {});
  }

  function loadBackups() {
    var sel = document.getElementById('menu-restore');
    if (!sel) return;
    fetch('/admin/api/menus/backups')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.backups) || [];
        sel.innerHTML = '<option value="">↩ שחזור' + (list.length ? ' (' + list.length + ')' : '') + '</option>' +
          list.map(function (b) {
            var when = b.at ? new Date(b.at).toLocaleString('he-IL') : b.id;
            var counts = Object.keys(b.counts || {}).map(function (k) { return k + ' ' + b.counts[k]; }).join(', ');
            return '<option value="' + esc(b.id) + '">' + esc(when + ' · ' + (b.reason || '') + (counts ? ' · ' + counts : '')) + '</option>';
          }).join('');
        sel.disabled = !list.length;
      })
      .catch(function () {});
  }

  var restoreSel = document.getElementById('menu-restore');
  if (restoreSel) restoreSel.onchange = function () {
    var id = restoreSel.value;
    if (!id) return;
    if (!confirm('לשחזר את התפריטים מהגיבוי הזה? המצב הנוכחי יישמר כגיבוי.')) { restoreSel.value = ''; return; }
    fetch('/admin/api/menus/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backupId: id })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return alert(d.error || 'שגיאה');
      state.menus = d.menus;
      if (d.locations) state.locations = d.locations;
      state.inherited = d.inherited || {};
      pendingDeletes = [];
      if (!state.menus[state.active]) state.active = 'main';
      renderAll();
      loadFit();
      loadBackups();
      alert(d.rebuildError ? 'התפריטים שוחזרו, אבל האתר לא נבנה מחדש: ' + d.rebuildError : 'התפריטים שוחזרו ✓');
    }).catch(function () { alert('שגיאה'); });
  };

  // the organizer card calls this after an apply — refetch and redraw
  function reloadFromServer() {
    return fetch('/admin/api/menus' + langQuery())
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) return;
        state.menus = d.menus;
        if (d.locations) state.locations = d.locations;
        state.inherited = d.inherited || {};
        if (d.languages) state.languages = d.languages;
        if (d.lang) state.lang = d.lang;
        if (d.siteLang) state.siteLang = d.siteLang;
        if (d.langSwitch) state.langSwitch = d.langSwitch;
        pendingDeletes = [];
        if (!state.menus[state.active]) state.active = 'main';
        renderAll();
        loadFit();
        loadBackups();
      })
      .catch(function () {});
  }
  window.tapuzMenusReload = reloadFromServer;

  // ---- menu entity actions ----
  var createBtn = document.getElementById('menu-create');
  if (createBtn) createBtn.onclick = function () {
    var name = prompt('שם התפריט החדש (באנגלית, למשל side-nav):');
    if (!name) return;
    name = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!name) return alert('שם לא תקין');
    if (state.menus[name]) return alert('כבר קיים תפריט בשם הזה');
    state.menus[name] = [];
    state.inherited[name] = false;
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
    state.inherited[name] = false;
    delete state.inherited[oldName];
    if (isSiteLang()) {
      ['main', 'footer'].forEach(function (loc) {
        if (state.locations[loc] === oldName) state.locations[loc] = name;
      });
    }
    state.active = name;
    // the old row dies server-side on save
    pendingDeletes.push(storageName(oldName));
    renderAll();
  };

  var pendingDeletes = [];
  var deleteBtn = document.getElementById('menu-delete');
  if (deleteBtn) deleteBtn.onclick = function () {
    var name = state.active;
    if (name === 'main' || name === 'footer') {
      if (isSiteLang() || (state.inherited && state.inherited[name])) return;
      if (!confirm('למחוק את תפריט השפה הזו? הגולשים יראו שוב את תפריט שפת האתר.')) return;
      fetch('/admin/api/menus/' + encodeURIComponent(storageName(name)) + '/delete', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) return alert(d.error || 'שגיאה');
          return reloadFromServer();
        })
        .catch(function () { alert('שגיאה'); });
      return;
    }
    if (!confirm('למחוק את התפריט "' + name + '"? הפריטים שבו יאבדו.')) return;
    delete state.menus[name];
    ['main', 'footer'].forEach(function (loc) {
      if (state.locations[loc] === name) state.locations[loc] = loc;
    });
    pendingDeletes.push(storageName(name));
    state.active = 'main';
    renderAll();
  };

  var addItemBtn = document.getElementById('menu-add-item');
  if (addItemBtn) addItemBtn.onclick = function () {
    if (!state.menus[state.active]) state.menus[state.active] = [];
    markEdited();
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
      var payload = {};
      Object.keys(state.menus).forEach(function (name) {
        if (state.inherited && state.inherited[name]) return;
        payload[name] = state.menus[name];
      });
      return fetch('/admin/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menus: payload, locations: state.locations, lang: state.lang })
      });
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return alert(d.error || 'שגיאה');
      state.menus = d.menus;
      if (d.locations) state.locations = d.locations;
      state.inherited = d.inherited || {};
      if (d.langSwitch) state.langSwitch = d.langSwitch;
      pendingDeletes = [];
      if (!state.menus[state.active]) state.active = 'main';
      renderAll();
      loadFit();
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

  var langSel = document.getElementById('menu-lang');
  if (langSel) langSel.onchange = function () {
    state.lang = langSel.value;
    window.__TAPUZ_MENU_LANG__ = state.lang;
    reloadFromServer();
  };
  var langSwitchSel = document.getElementById('menu-langswitch');
  if (langSwitchSel) langSwitchSel.onchange = function () {
    var value = langSwitchSel.value === 'float' ? 'float' : 'header';
    fetch('/admin/api/menus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ langSwitch: value })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return alert(d.error || 'שגיאה');
      state.langSwitch = d.langSwitch || value;
    }).catch(function () { alert('שגיאה'); });
  };
  var importInput = document.getElementById('menu-import');
  if (importInput) importInput.onchange = function () {
    var file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      fetch('/admin/api/menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bent: String(reader.result || ''), lang: state.lang })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) return alert(d.error || 'שגיאה');
        state.menus = d.menus;
        if (d.locations) state.locations = d.locations;
        state.inherited = d.inherited || {};
        if (d.lang) state.lang = d.lang;
        pendingDeletes = [];
        if (!state.menus[state.active]) state.active = 'main';
        renderAll();
        loadFit();
        alert('התפריט יובא ✓');
      }).catch(function () { alert('שגיאה'); });
    };
    reader.readAsText(file);
  };

  loadPages(renderAll);
  loadFit();
  loadBackups();
})();
