// The store's categories screen (v2.69) — /admin/store/shelves.
//
// The server prints the tree; this file moves rows (drag ⠿, or ↑ ↓ for the
// keyboard), opens the one editor panel and the delete panel, and talks to
// /admin/api/store/shelves/*. It builds DOM with createElement + textContent
// only — a category's name is text, never markup.
//
// The admin shell (admin-nav.js) re-runs a screen's scripts on every visit,
// so nothing here listens on document or window: every listener sits on an
// element of THIS screen and leaves with it.
(function () {
  'use strict';

  var root = document.getElementById('st-cats');
  var editor = document.getElementById('st-cat-editor');
  var remover = document.getElementById('st-cat-delete');
  if (!root || !editor || !remover) return;

  var API = '/admin/api/store/shelves';
  var FLASH = 'tz-store-shelves-flash';
  var table = document.getElementById('st-cat-table');
  var out = document.getElementById('st-cat-out');
  var form = document.getElementById('st-cat-form');
  var formOut = document.getElementById('st-cat-form-out');
  var saveBtn = document.getElementById('st-cat-save');
  var delOut = document.getElementById('st-cat-delete-out');
  var delBtn = document.getElementById('st-cat-delete-go');

  var shelves = [];
  try { shelves = JSON.parse(root.getAttribute('data-shelves') || '[]') || []; } catch (e) { shelves = []; }

  function arr(list) { return Array.prototype.slice.call(list); }
  function closest(node, sel) { return node && node.closest ? node.closest(sel) : null; }
  function field(name) { return form.querySelector('[name="' + name + '"]'); }
  function find(slug) {
    for (var i = 0; i < shelves.length; i++) if (shelves[i].slug === slug) return shelves[i];
    return null;
  }
  function childrenOf(slug) { return shelves.filter(function (s) { return s.parent === slug; }); }
  function say(el, text, cls) { if (el) { el.textContent = text || ''; el.className = cls || ''; } }
  function status(text, cls) { say(out, text, 'st-cat-out' + (cls ? ' ' + cls : '')); }

  /** A request that always answers an object — a dropped connection or a plain-text 429 is not an exception. */
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, error: r.status === 429 ? 'יותר מדי בקשות — נסו שוב בעוד רגע' : 'השרת לא ענה כצפוי (' + r.status + ')' };
        });
      })
      .catch(function () { return { ok: false, error: 'שגיאת רשת — השינוי לא נשמר' }; });
  }

  function builtNote(d) {
    return d && d.rebuilt === false ? ' · בניית האתר נכשלה — האתר יתעדכן בבנייה הבאה' : '';
  }

  /** Reload with one line to show on arrival (the list is printed by the server). */
  function reloadWith(text, cls) {
    try { sessionStorage.setItem(FLASH, JSON.stringify({ text: text, cls: cls || 'st-ok' })); } catch (e) { /* private mode: no line, still saved */ }
    if (location.search) location.replace(location.pathname); else location.reload();
  }
  try {
    var kept = sessionStorage.getItem(FLASH);
    if (kept) {
      sessionStorage.removeItem(FLASH);
      var line = JSON.parse(kept);
      status(line.text, line.cls);
    }
  } catch (e) { /* nothing to show */ }

  // ── the id, the way the catalog makes it ────────────────────────────
  // (written with fromCharCode: the range is the Hebrew points and accents)
  var MARKS = new RegExp('[' + String.fromCharCode(0x0591) + '-' + String.fromCharCode(0x05c7) + ']', 'g');
  function slugify(text) {
    return String(text || '').toLowerCase()
      .replace(MARKS, '')
      .replace(/[^a-z0-9א-ת]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');
  }

  // ── dialogs ─────────────────────────────────────────────────────────
  var opener = null;
  function focusables(box) {
    return arr(box.querySelectorAll('a[href], button, input, select, textarea')).filter(function (el) {
      return !el.disabled && el.type !== 'hidden' && el.offsetParent !== null;
    });
  }
  /** The media picker draws its own layer over ours; while it is up, Escape is its business. */
  function pickerOpen() {
    var last = document.body.lastElementChild;
    return !!(last && last.style && last.style.zIndex === '99999');
  }
  /**
   * A panel is fixed to the window — but while the screen is still settling
   * in (admin.css moves #admin-main for a beat after every load), "the
   * window" is that moving box and the panel would be laid out against it.
   * So a panel opens once that movement has finished: at once on a click,
   * a moment later for a link that asked for it (?new=1).
   */
  function settled(then) {
    var running = [];
    try {
      running = document.getElementById('admin-main').getAnimations().filter(function (a) {
        return a.playState === 'running' || a.playState === 'paused' || a.pending;
      });
    } catch (e) { running = []; }
    if (!running.length) { then(); return; }
    var done = false;
    var go = function () { if (!done) { done = true; then(); } };
    Promise.all(running.map(function (a) { return a.finished.then(null, function () { /* cancelled is finished too */ }); })).then(go);
    // The movement lasts a fifth of a second — but a tab that draws no frames
    // never finishes it, and a panel must not wait for ever: after a second
    // the movement is ended by hand and the panel opens.
    setTimeout(function () {
      if (done) return;
      running.forEach(function (a) { try { a.finish(); } catch (e) { /* already over */ } });
      go();
    }, 1000);
  }
  function openDialog(box, first) {
    opener = document.activeElement;
    settled(function () {
      box.classList.add('show');
      var target = first || focusables(box)[0];
      if (target) target.focus();
    });
  }
  function closeDialog(box) {
    box.classList.remove('show');
    if (opener && opener.focus && document.contains(opener)) opener.focus();
    opener = null;
  }
  [editor, remover].forEach(function (box) {
    box.addEventListener('click', function (ev) {
      if (closest(ev.target, '[data-close]')) closeDialog(box);
    });
    box.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !pickerOpen()) { ev.preventDefault(); closeDialog(box); return; }
      if (ev.key !== 'Tab') return;
      var list = focusables(box);
      if (!list.length) return;
      var firstEl = list[0];
      var lastEl = list[list.length - 1];
      if (ev.shiftKey && document.activeElement === firstEl) { ev.preventDefault(); lastEl.focus(); }
      else if (!ev.shiftKey && document.activeElement === lastEl) { ev.preventDefault(); firstEl.focus(); }
    });
  });

  // ── the editor panel ────────────────────────────────────────────────
  var editing = null;      // the category being edited, or null for a new one
  var slugTouched = false; // a new id follows the name until the owner types one

  function setError(name, text) {
    var box = form.querySelector('[data-err="' + name + '"]');
    if (box) box.textContent = text || '';
    var input = field(name);
    if (input) { if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function clearErrors() {
    ['label', 'slug', 'parent', 'image'].forEach(function (n) { setError(n, ''); });
    say(formOut, '', '');
  }

  function count(name) {
    var input = field(name);
    var box = form.querySelector('[data-count="' + name + '"]');
    if (input && box) box.textContent = input.value.length + '/' + input.getAttribute('maxlength');
  }
  ['summary', 'seoTitle', 'seoDescription'].forEach(function (name) {
    field(name).addEventListener('input', function () { count(name); });
  });

  var thumb = form.querySelector('[data-thumb]');
  var thumbImg = thumb.querySelector('img');
  thumbImg.addEventListener('error', function () { thumb.classList.remove('has-pic'); });
  thumbImg.addEventListener('load', function () { thumb.classList.add('has-pic'); });
  function showThumb() {
    var src = field('image').value.trim();
    thumb.classList.remove('has-pic');
    if (src) thumbImg.src = src; else thumbImg.removeAttribute('src');
  }
  field('image').addEventListener('input', function () { setError('image', ''); showThumb(); });
  form.querySelector('[data-image-clear]').addEventListener('click', function () {
    field('image').value = '';
    showThumb();
    field('image').focus();
  });

  field('label').addEventListener('input', function () {
    setError('label', '');
    if (!editing && !slugTouched) field('slug').value = slugify(field('label').value);
  });
  field('slug').addEventListener('input', function () {
    setError('slug', '');
    if (!editing) slugTouched = field('slug').value !== '';
  });
  field('slug').addEventListener('blur', function () {
    if (!editing) field('slug').value = slugify(field('slug').value);
  });

  function option(value, text) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  }

  function fillParents(self) {
    var sel = field('parent');
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    sel.appendChild(option('', '— קטגוריה ראשית —'));
    shelves.forEach(function (s) {
      if (s.parent || (self && s.slug === self.slug)) return;
      sel.appendChild(option(s.slug, s.label));
    });
    var hasKids = !!self && childrenOf(self.slug).length > 0;
    sel.disabled = hasKids;
    form.querySelector('[data-parent-help]').hidden = !hasKids;
    sel.value = self && self.parent ? self.parent : '';
  }

  function openEditor(slug) {
    editing = slug ? find(slug) : null;
    slugTouched = false;
    clearErrors();
    var s = editing || { slug: '', label: '', parent: '', summary: '', image: '', hidden: false, seoTitle: '', seoDescription: '' };
    document.getElementById('st-cat-editor-title').textContent = editing ? 'עריכת ' + s.label : 'קטגוריה חדשה';
    field('label').value = s.label;
    var id = field('slug');
    id.value = s.slug;
    id.readOnly = !!editing;
    id.title = editing ? 'המזהה הוא הזהות של הקטגוריה — הוא לא משתנה' : '';
    fillParents(editing);
    field('image').value = s.image || '';
    field('summary').value = s.summary || '';
    field('hide').checked = !!s.hidden;
    field('seoTitle').value = s.seoTitle || '';
    field('seoDescription').value = s.seoDescription || '';
    ['summary', 'seoTitle', 'seoDescription'].forEach(count);
    showThumb();
    saveBtn.disabled = false;
    openDialog(editor, field('label'));
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    clearErrors();
    var label = field('label').value.trim();
    var slug = editing ? editing.slug : slugify(field('slug').value || label);
    if (!label) { setError('label', 'לקטגוריה חסר שם'); field('label').focus(); return; }
    if (!slug) { setError('slug', 'צריך מזהה: אותיות, ספרות ומקפים'); field('slug').focus(); return; }
    if (!editing) field('slug').value = slug;
    var body = {
      label: label,
      summary: field('summary').value,
      image: field('image').value.trim(),
      hidden: field('hide').checked,
      seoTitle: field('seoTitle').value,
      seoDescription: field('seoDescription').value
    };
    // a category with sub-categories cannot be given a parent; its (empty) one is left as it is
    if (!field('parent').disabled) body.parent = field('parent').value;
    if (!editing) body.isNew = true;
    saveBtn.disabled = true;
    say(formOut, 'שומרים…', '');
    post(API + '/' + encodeURIComponent(slug), body).then(function (d) {
      if (!d.ok) {
        saveBtn.disabled = false;
        var where = d.field && form.querySelector('[data-err="' + d.field + '"]') ? d.field : '';
        if (where) {
          setError(where, d.error || 'שגיאה');
          say(formOut, '', '');
          if (field(where) && !field(where).disabled && !field(where).readOnly) field(where).focus();
        } else {
          say(formOut, d.error || 'שגיאה', 'st-bad');
        }
        return;
      }
      var failed = d.rebuilt === false;
      reloadWith((d.created ? 'הקטגוריה נוספה ✓' : 'הקטגוריה נשמרה ✓') + builtNote(d), failed ? 'st-warn' : 'st-ok');
    });
  });

  // ── the delete panel ────────────────────────────────────────────────
  var deleting = null;

  function openDelete(slug) {
    deleting = find(slug);
    if (!deleting) return;
    var s = deleting;
    say(delOut, '', '');
    document.getElementById('st-cat-delete-title').textContent = 'מחיקת ' + s.label;
    var all = s.all || 0;
    var active = s.count || 0;
    var text;
    if (!all) text = 'בקטגוריה אין מוצרים.';
    else {
      text = 'בקטגוריה ' + (active === 1 ? 'מוצר אחד' : active + ' מוצרים');
      if (all !== active) text += ' (' + all + ' כולל מוסתרים וטיוטות)';
      text += '.';
    }
    remover.querySelector('[data-del-count]').textContent = text;
    var moveBox = remover.querySelector('[data-del-move]');
    var sel = moveBox.querySelector('select');
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    sel.appendChild(option('', 'ללא קטגוריה'));
    shelves.forEach(function (o) {
      if (o.slug === s.slug) return;
      sel.appendChild(option(o.slug, (o.depth ? '— ' : '') + o.label));
    });
    moveBox.querySelector('span').textContent = all === 1 ? 'להעביר אותו אל' : 'להעביר אותם אל';
    moveBox.hidden = !all;
    var kids = childrenOf(s.slug).length;
    var kidsLine = remover.querySelector('[data-del-kids]');
    kidsLine.hidden = !kids;
    kidsLine.textContent = kids === 1 ? 'תת־הקטגוריה שלה תעלה לרמה הראשית.' : kids + ' תת־הקטגוריות שלה יעלו לרמה הראשית.';
    delBtn.disabled = false;
    openDialog(remover, all ? sel : delBtn);
  }

  delBtn.addEventListener('click', function () {
    if (!deleting) return;
    var s = deleting;
    var moveTo = s.all ? remover.querySelector('select').value : '';
    delBtn.disabled = true;
    say(delOut, 'מוחקים…', '');
    post(API + '/' + encodeURIComponent(s.slug) + '/delete', { moveTo: moveTo }).then(function (d) {
      if (!d.ok) { delBtn.disabled = false; say(delOut, d.error || 'שגיאה', 'st-bad'); return; }
      var text = 'הקטגוריה "' + s.label + '" נמחקה ✓';
      if (d.moved) {
        var to = d.movedTo ? find(d.movedTo) : null;
        text += ' · ' + (d.moved === 1 ? 'מוצר אחד' : d.moved + ' מוצרים') + (to ? ' עברו אל "' + to.label + '"' : ' נשארו בלי קטגוריה');
      }
      reloadWith(text + builtNote(d), d.rebuilt === false ? 'st-warn' : 'st-ok');
    });
  });

  // ── opening the panels ──────────────────────────────────────────────
  arr(document.querySelectorAll('.topbar-actions [data-shelf-new], #st-cats [data-shelf-new]')).forEach(function (b) {
    b.addEventListener('click', function () { openEditor(null); });
  });
  root.addEventListener('click', function (ev) {
    var row = closest(ev.target, 'tr[data-slug]');
    if (!row) return;
    if (closest(ev.target, '[data-edit]')) openEditor(row.getAttribute('data-slug'));
    else if (closest(ev.target, '[data-delete]')) openDelete(row.getAttribute('data-slug'));
  });

  // ── the order ───────────────────────────────────────────────────────
  // A top-level category moves as its whole <tbody> (its sub-categories go
  // with it); a sub-category moves as its own row, inside its parent's.
  if (table) {
    var unitOf = function (row) { return row.classList.contains('is-child') ? row : row.parentNode; };
    var siblingsOf = function (unit) {
      return unit.tagName === 'TBODY'
        ? arr(table.querySelectorAll('tbody.st-cat-group'))
        : arr(unit.parentNode.querySelectorAll('tr.is-child'));
    };
    var slugOf = function (unit) { return unit.getAttribute(unit.tagName === 'TBODY' ? 'data-group' : 'data-slug'); };
    var levelOf = function (unit) { return unit.tagName === 'TBODY' ? '' : unit.parentNode.getAttribute('data-group'); };
    var orderOf = function (unit) { return siblingsOf(unit).map(slugOf); };

    var syncArrows = function () {
      arr(table.querySelectorAll('tr[data-slug]')).forEach(function (row) {
        var unit = unitOf(row);
        var sibs = siblingsOf(unit);
        var i = sibs.indexOf(unit);
        row.querySelector('[data-move="up"]').disabled = i <= 0;
        row.querySelector('[data-move="down"]').disabled = i === sibs.length - 1;
        // one of its kind has nothing to be ordered against
        row.querySelector('.st-cat-grip').classList.toggle('is-idle', sibs.length < 2);
      });
    };
    syncArrows();

    // several moves in a row are one save (each save rebuilds the site)
    var pending = {};
    var timer = null;
    var saving = false;
    var flush = function () {
      timer = null;
      if (saving) { timer = setTimeout(flush, 300); return; }
      var levels = Object.keys(pending);
      if (!levels.length) return;
      var level = levels[0];
      var slugs = pending[level];
      delete pending[level];
      saving = true;
      status('שומרים את הסדר…', '');
      post(API + '/reorder', { slugs: slugs }).then(function (d) {
        saving = false;
        if (!d.ok) {
          // the screen no longer shows what is saved: say so and show the truth
          reloadWith('הסדר לא נשמר: ' + (d.error || 'שגיאה'), 'st-bad');
          return;
        }
        if (Array.isArray(d.shelves)) shelves = d.shelves;
        if (Object.keys(pending).length) { flush(); return; }
        status('הסדר נשמר ✓' + builtNote(d), d.rebuilt === false ? 'st-warn' : 'st-ok');
      });
    };
    var queue = function (unit) {
      pending[levelOf(unit)] = orderOf(unit);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 600);
    };

    table.addEventListener('click', function (ev) {
      var btn = closest(ev.target, '[data-move]');
      if (!btn || btn.disabled) return;
      var unit = unitOf(closest(btn, 'tr'));
      var sibs = siblingsOf(unit);
      var i = sibs.indexOf(unit);
      var up = btn.getAttribute('data-move') === 'up';
      var other = sibs[up ? i - 1 : i + 1];
      if (!other) return;
      if (up) unit.parentNode.insertBefore(unit, other); else unit.parentNode.insertBefore(other, unit);
      syncArrows();
      // the row moved under the finger: keep the keyboard on it
      var again = btn.disabled ? closest(btn, 'tr').querySelector('[data-move="' + (up ? 'down' : 'up') + '"]') : btn;
      if (again) again.focus();
      queue(unit);
    });

    var drag = null;
    table.addEventListener('dragstart', function (ev) {
      var grip = closest(ev.target, '.st-cat-grip');
      if (!grip) return;
      var row = closest(grip, 'tr');
      var unit = unitOf(row);
      if (siblingsOf(unit).length < 2) { ev.preventDefault(); return; }
      drag = { unit: unit, before: orderOf(unit).join('\n') };
      unit.classList.add('is-dragging');
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = 'move';
        try { ev.dataTransfer.setData('text/plain', row.getAttribute('data-slug')); } catch (e) { /* some browsers refuse; the drag still runs */ }
        if (ev.dataTransfer.setDragImage) {
          var box = row.getBoundingClientRect();
          ev.dataTransfer.setDragImage(row, Math.max(0, Math.round(ev.clientX - box.left)), Math.round(box.height / 2));
        }
      }
    });
    table.addEventListener('dragover', function (ev) {
      if (!drag) return;
      var row = closest(ev.target, 'tr[data-slug]');
      if (!row) return;
      var over = drag.unit.tagName === 'TBODY' ? row.parentNode : row;
      if (drag.unit.tagName !== 'TBODY' && (!over.classList.contains('is-child') || over.parentNode !== drag.unit.parentNode)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      if (over === drag.unit) return;
      var sibs = siblingsOf(drag.unit);
      var from = sibs.indexOf(drag.unit);
      var to = sibs.indexOf(over);
      if (to < 0) return;
      var box = over.getBoundingClientRect();
      var mid = box.top + box.height / 2;
      // move only once the pointer is past the middle, in the direction of travel — no flicker between two rows
      if (to < from && ev.clientY < mid) over.parentNode.insertBefore(drag.unit, over);
      else if (to > from && ev.clientY > mid) over.parentNode.insertBefore(drag.unit, over.nextSibling);
    });
    table.addEventListener('drop', function (ev) { if (drag) ev.preventDefault(); });
    table.addEventListener('dragend', function () {
      if (!drag) return;
      var unit = drag.unit;
      unit.classList.remove('is-dragging');
      var changed = orderOf(unit).join('\n') !== drag.before;
      drag = null;
      syncArrows();
      if (changed) queue(unit);
    });
  }

  // a link may ask for a panel: ?new=1 (the command palette), ?edit=<id>
  var ask = '';
  var askEdit = '';
  try {
    var params = new URLSearchParams(location.search);
    ask = params.get('new') || '';
    askEdit = params.get('edit') || '';
  } catch (e) { /* no query to read */ }
  if (askEdit && find(askEdit)) openEditor(askEdit);
  else if (ask) openEditor(null);
})();
