// Tapuziel store admin (v2.69) — what the store's screens share in the browser.
//
// The owner: "I urge you to refine the product creation … which are very lean
// on tapuziel". The product list and the product editor are server-rendered
// (src/routes/store-products.js); this file is the handful of behaviours they
// both need, written once:
//
//   post(url, body)        a POST that ALWAYS answers with an object
//   gallery(el, opts)      the picture tiles of a product
//   chips(el, opts)        a tags input
//   counter(input, max)    "36/200" beside a field
//   dirty(form)            the unsaved-changes guard
//   sortable(list, onDrop) an order set by hand — drag, or the arrow buttons
//
// plus the small things around them (a question with real buttons, a toast,
// money as a person types it).
//
// ES5 on purpose: no build step, no dependency. Every node is made with
// createElement + textContent — nothing a server or a person sent is ever
// parsed as markup.
//
// The admin shell (admin-nav.js) swaps screens without a reload and re-runs
// their scripts, so this file can be executed many times in one tab. Every run
// after the first is a no-op, and the listeners that have to live on the
// window (one beforeunload, one click, one popstate, one keydown) are bound
// exactly once and read this module's state instead of closing over a screen.
(function () {
  'use strict';

  // A screen's inline script may run before this file has loaded (the shell
  // re-creates scripts on a swap, and an inline one runs at once): it leaves
  // its start function in window.TapuzStoreReady and we call it here.
  function drain() {
    var waiting = window.TapuzStoreReady;
    window.TapuzStoreReady = null;
    if (!waiting || !waiting.length) return;
    for (var i = 0; i < waiting.length; i++) {
      try { waiting[i](window.TapuzStore); } catch (e) { if (window.console) window.console.error(e); }
    }
  }
  if (window.TapuzStore) { drain(); return; }

  var NET = 'שגיאת רשת';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function arr(list) {
    return Array.prototype.slice.call(list || []);
  }

  function live(node) {
    return !!(node && document.documentElement.contains(node));
  }

  /** Where the store's own pieces (a dialog, a toast) are hung, so the store's styles reach them. */
  function host() {
    return document.querySelector('.st-page') || document.body;
  }

  // ── a POST that always answers ────────────────────────────────────────

  /**
   * POST JSON, get an object — always. A dropped connection, a reply that is
   * not JSON (the limiter answers in plain text) and a lapsed session all
   * come back as { ok: false, error } so no caller needs a catch and no
   * owner is left looking at a button that did nothing.
   */
  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body === undefined || body === null ? {} : body)
    }).then(function (r) {
      if (r.status === 429) return { ok: false, status: 429, error: 'יותר מדי בקשות — נסו שוב בעוד רגע' };
      return r.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, status: r.status, error: NET };
        if (data.ok === undefined) data.ok = r.ok;
        if (!data.ok && !data.error) data.error = NET;
        return data;
      });
    }).catch(function () {
      return { ok: false, error: NET };
    });
  }

  // ── getting around ────────────────────────────────────────────────────

  /** To another admin screen: the shell's smooth swap when it is there, a plain navigation when not. */
  function go(url) {
    if (window.TapuzNav && typeof window.TapuzNav.navigate === 'function') window.TapuzNav.navigate(url);
    else window.location.href = url;
  }

  // One message carried across a navigation (a create that lands on the new
  // product's screen must not lose the server's warnings on the way).
  function stash(key, value) {
    try { window.sessionStorage.setItem('tapuz-store:' + key, JSON.stringify(value)); } catch (e) { /* private mode: the message is lost, the save is not */ }
  }

  function unstash(key) {
    try {
      var k = 'tapuz-store:' + key;
      var raw = window.sessionStorage.getItem(k);
      if (raw === null) return null;
      window.sessionStorage.removeItem(k);
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // ── money and numbers, as a person types them ─────────────────────────

  // The server decides (src/store/money.js toMinor); these mirror it so the
  // browser can say "that is not a price" before the round trip.

  var MAX_MINOR = 1000000000;

  /** "89.90" · "89,90" · "₪ 89.9" · "1,234.50" → 8990 / 123450; anything else → NaN. */
  function money(value) {
    var s = String(value === undefined || value === null ? '' : value)
      .replace(/ILS|USD|EUR|GBP|ש"ח|ש״ח|שח/gi, '')
      .replace(/[\s₪$€£]/g, '');
    if (!s || s.charAt(0) === '-') return NaN;
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    if (lastComma !== -1 && lastDot !== -1) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma !== -1) {
      var tail = s.slice(lastComma + 1);
      s = /^[0-9]{1,2}$/.test(tail) && s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,/g, '');
    }
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(s)) return NaN;
    var parts = s.split('.');
    var n = parseInt(parts[0], 10) * 100 + parseInt(((parts[1] || '') + '00').slice(0, 2), 10);
    return n <= MAX_MINOR ? n : NaN;
  }

  /** 8990 → "89.90", 8900 → "89" — what goes back into a price field. */
  function fromMinor(minor) {
    var n = Math.max(0, Math.round(Number(minor) || 0));
    var cents = n % 100;
    return String(Math.floor(n / 100)) + (cents ? '.' + (cents < 10 ? '0' : '') + cents : '');
  }

  /** 8990 → "₪89.90", 150000 → "₪1,500". */
  function formatMoney(minor, symbol) {
    var n = Math.round(Number(minor) || 0);
    var abs = Math.abs(n);
    var whole = String(Math.floor(abs / 100)).replace(/\B(?=([0-9]{3})+(?![0-9]))/g, ',');
    var cents = abs % 100;
    return (n < 0 ? '-' : '') + (symbol || '') + whole + (cents ? '.' + (cents < 10 ? '0' : '') + cents : '');
  }

  /** A whole number a person typed: null for empty, NaN for "12.5" or "many". */
  function whole(value) {
    var s = String(value === undefined || value === null ? '' : value).replace(/\s+/g, '');
    if (!s) return null;
    if (/^[0-9]{1,3}(,[0-9]{3})+$/.test(s)) s = s.replace(/,/g, '');
    return /^[0-9]+$/.test(s) ? parseInt(s, 10) : NaN;
  }

  var NIQQUD = new RegExp('[' + String.fromCharCode(0x0591) + '-' + String.fromCharCode(0x05c7) + ']', 'g');

  /** Text → an id the way the server would write it: Latin and Hebrew letters, digits, dashes. The server has the last word. */
  function slug(text) {
    return String(text || '')
      .toLowerCase()
      .replace(NIQQUD, '')
      .replace(/[^a-z0-9א-ת]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');
  }

  // ── small pieces of the page ──────────────────────────────────────────

  /** Lines as a list (the server's errors and warnings are several sentences, not one joined string). */
  function lines(box, items, cls) {
    if (!box || !items || !items.length) return null;
    var ul = el('ul', 'st-msg' + (cls ? ' ' + cls : ''));
    for (var i = 0; i < items.length; i++) ul.appendChild(el('li', '', String(items[i])));
    box.appendChild(ul);
    return ul;
  }

  var toastTimer = null;

  /** One short line at the bottom of the screen — seen wherever the list is scrolled to. */
  function toast(text, tone) {
    var box = document.getElementById('st-toast');
    if (!box || !live(box)) {
      box = el('div', 'st-toast');
      box.id = 'st-toast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      host().appendChild(box);
    }
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    box.textContent = text || '';
    box.className = 'st-toast' + (text ? ' is-on' : '') + (tone ? ' is-' + tone : '');
    if (text && tone !== 'bad') {
      toastTimer = setTimeout(function () { box.className = 'st-toast'; }, 4200);
    }
  }

  /**
   * A question with real buttons. confirm() can only say yes or no, and the
   * honest answer to "delete?" is usually a third thing: hide it instead.
   * @param {{ title: string, lines?: string[], actions: { label: string, value: string, kind?: string }[] }} opts
   * @returns {Promise<string>} the chosen value; '' when the question was closed
   */
  function ask(opts) {
    var o = opts || {};
    return new Promise(function (resolve) {
      var box = el('dialog', 'st-dialog');
      if (typeof box.showModal !== 'function') {
        // a browser without <dialog>: the plain question, and only the first answer
        var first = (o.actions || [])[0];
        resolve(window.confirm(o.title + '\n\n' + (o.lines || []).join('\n')) && first ? first.value : '');
        return;
      }
      var answer = '';
      box.appendChild(el('h2', 'st-dialog-title', o.title || ''));
      arr(o.lines).forEach(function (line) { box.appendChild(el('p', 'st-dialog-text', line)); });
      var row = el('div', 'st-dialog-actions');
      arr(o.actions).forEach(function (a) {
        var b = el('button', 'btn sm' + (a.kind ? ' ' + a.kind : ''), a.label);
        b.type = 'button';
        b.addEventListener('click', function () { answer = a.value; box.close(); });
        row.appendChild(b);
      });
      box.appendChild(row);
      box.addEventListener('close', function () {
        if (box.parentNode) box.parentNode.removeChild(box);
        resolve(answer);
      });
      host().appendChild(box);
      box.showModal();
    });
  }

  // ── counter ───────────────────────────────────────────────────────────

  /** "36/200" for a field with a limit. The number sits in the field's [data-counter], made if missing. */
  function counter(input, max) {
    if (!input) return { paint: function () {} };
    var limit = Number(max) || Number(input.getAttribute('maxlength')) || 0;
    var field = input.closest ? input.closest('.st-field') : null;
    var out = field ? field.querySelector('[data-counter]') : null;
    if (!out) {
      out = el('span', 'st-counter');
      out.setAttribute('data-counter', '');
      (field || input.parentNode).appendChild(out);
    }
    function paint() {
      var n = input.value.length;
      out.textContent = n + '/' + limit;
      out.classList.toggle('is-near', limit > 0 && n >= limit * 0.9);
    }
    if (!input.__tsCounter) {
      input.__tsCounter = true;
      input.addEventListener('input', paint);
    }
    paint();
    return { paint: paint };
  }

  // ── chips ─────────────────────────────────────────────────────────────

  /**
   * A tags input: type and press Enter (or a comma) to add, ✕ to remove,
   * Backspace on an empty field removes the last one.
   * `root` holds [data-chips-list] and [data-chips-input].
   * @param {{ values?: string[], max?: number, maxLen?: number, onChange?: Function, say?: Function }} opts
   */
  function chips(root, opts) {
    var o = opts || {};
    var list = root.querySelector('[data-chips-list]');
    var input = root.querySelector('[data-chips-input]');
    var max = o.max || 12;
    var maxLen = o.maxLen || 30;
    var say = typeof o.say === 'function' ? o.say : function () {};
    var values = [];

    function has(tag) {
      var key = tag.toLowerCase();
      return values.some(function (v) { return v.toLowerCase() === key; });
    }

    function paint() {
      clear(list);
      values.forEach(function (tag, i) {
        var chip = el('span', 'st-chip');
        chip.appendChild(el('span', 'st-chip-text', tag));
        var x = el('button', 'st-chip-x', '✕');
        x.type = 'button';
        x.setAttribute('aria-label', 'הסרת התגית ' + tag);
        x.addEventListener('click', function () {
          values.splice(i, 1);
          paint();
          changed();
          input.focus();
        });
        chip.appendChild(x);
        list.appendChild(chip);
      });
      root.classList.toggle('is-full', values.length >= max);
    }

    function changed() {
      if (typeof o.onChange === 'function') o.onChange(values.slice());
    }

    /** Add what was typed (a comma separates). Says why when something is refused. */
    function add(raw) {
      var parts = String(raw === undefined || raw === null ? '' : raw).split(',');
      var added = 0;
      var why = '';
      for (var i = 0; i < parts.length; i++) {
        var tag = parts[i].replace(/\s+/g, ' ').trim();
        if (!tag) continue;
        if (tag.length > maxLen) { why = 'תגית יכולה להכיל עד ' + maxLen + ' תווים'; continue; }
        if (has(tag)) { why = 'התגית "' + tag + '" כבר ברשימה'; continue; }
        if (values.length >= max) { why = 'אפשר עד ' + max + ' תגיות למוצר'; break; }
        values.push(tag);
        added++;
      }
      say(why);
      if (added) { paint(); changed(); }
      return added;
    }

    function take() {
      var typed = input.value;
      input.value = '';
      if (typed.trim()) add(typed);
    }

    function listed(value) {
      var id = input.getAttribute('list');
      var data = id ? document.getElementById(id) : null;
      if (!data) return false;
      return arr(data.options).some(function (opt) { return opt.value === value; });
    }

    if (!root.__tsChips) {
      root.__tsChips = true;
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          // never the form's Enter: here it means "this tag is done"
          e.preventDefault();
          take();
        } else if (e.key === ',') {
          e.preventDefault();
          take();
        } else if (e.key === 'Backspace' && input.value === '' && values.length) {
          values.pop();
          paint();
          changed();
          say('');
        }
      });
      input.addEventListener('input', function (e) {
        // a pasted list, or a suggestion picked from the datalist, is complete as it is
        var picked = e.inputType === 'insertReplacementText' || (e.inputType === undefined && listed(input.value));
        if (input.value.indexOf(',') !== -1 || picked) take();
      });
      input.addEventListener('blur', take);
      root.addEventListener('click', function (e) { if (e.target === root || e.target === list) input.focus(); });
    }

    var handle = {
      get: function () { return values.slice(); },
      set: function (next) {
        values = [];
        arr(next).forEach(function (tag) {
          var t = String(tag === undefined || tag === null ? '' : tag).trim();
          if (t && !has(t) && values.length < max) values.push(t);
        });
        paint();
      },
      add: add
    };
    handle.set(o.values || []);
    return handle;
  }

  // ── gallery ───────────────────────────────────────────────────────────

  /** A site path ("/assets/x.png") or an http(s) address — what the catalog will accept as a picture. */
  function imageAddress(v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
    if (/^\/[^\/\\\s][^\s]*$/.test(s)) return s;
    return '';
  }

  /**
   * A product's pictures as tiles. The first tile is the main picture; a tile
   * is dragged to its place (or moved with its two arrow buttons), and ✕
   * takes it out. Three ways in: the media library, an upload of several
   * files, and an address typed by hand.
   *
   * `root` holds the parts by attribute: [data-g-list] (the tiles),
   * [data-g-count], [data-g-status], [data-g-full], [data-g-pick],
   * [data-g-upload] + [data-g-file], [data-g-url] + [data-g-url-add].
   * @param {{ images?: string[], max?: number, folder?: string, onChange?: Function }} opts
   */
  function gallery(root, opts) {
    var o = opts || {};
    var max = o.max || 12;
    var folder = o.folder || 'products';
    var list = root.querySelector('[data-g-list]');
    var count = root.querySelector('[data-g-count]');
    var status = root.querySelector('[data-g-status]');
    var full = root.querySelector('[data-g-full]');
    var pickBtn = root.querySelector('[data-g-pick]');
    var fileBtn = root.querySelector('[data-g-upload]');
    var fileIn = root.querySelector('[data-g-file]');
    var urlIn = root.querySelector('[data-g-url]');
    var urlBtn = root.querySelector('[data-g-url-add]');
    var images = [];
    var uploading = false;
    var dragging = null;
    var rtl = window.getComputedStyle(root).direction === 'rtl';

    function changed() {
      if (typeof o.onChange === 'function') o.onChange(images.slice());
    }

    function say(text, tone, items) {
      if (!status) return;
      clear(status);
      status.className = 'st-gal-status' + (tone ? ' st-' + tone : '');
      if (text) status.appendChild(el('span', '', text));
      if (items && items.length) lines(status, items, '');
    }

    function move(from, to) {
      if (to < 0 || to >= images.length || from === to) return;
      images.splice(to, 0, images.splice(from, 1)[0]);
      paint();
      changed();
      // the tiles were drawn again: give the focus back to the button that was
      // pressed — or, at either end, where that button is switched off, to its twin
      var tiles = list.children;
      var way = to > from ? '1' : '-1';
      var again = tiles[to] ? tiles[to].querySelector('[data-step="' + way + '"]') : null;
      if (again && again.disabled) again = tiles[to].querySelector('[data-step="' + (way === '1' ? '-1' : '1') + '"]');
      if (again) again.focus();
    }

    function tile(src, i) {
      var t = el('div', 'st-tile');
      t.draggable = true;
      t.setAttribute('data-src', src);
      var img = el('img');
      img.src = src;
      img.alt = '';
      img.loading = 'lazy';
      img.draggable = false;
      img.addEventListener('error', function () { t.classList.add('is-broken'); });
      t.appendChild(img);
      t.appendChild(el('span', 'st-tile-missing', 'התמונה לא נטענת'));
      if (i === 0) t.appendChild(el('span', 'st-tile-main', 'ראשית'));

      var x = el('button', 'st-tile-x', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', 'הסרת תמונה ' + (i + 1));
      x.addEventListener('click', function () {
        images.splice(i, 1);
        paint();
        changed();
        say('');
      });
      t.appendChild(x);

      // the two arrows point the way the tile will go on the screen
      var steps = el('span', 'st-tile-steps');
      [-1, 1].forEach(function (step) {
        var b = el('button', 'st-tile-step', (step === -1) === rtl ? '→' : '←');
        b.type = 'button';
        b.setAttribute('data-step', String(step));
        b.setAttribute('aria-label', step === -1 ? 'תמונה ' + (i + 1) + ': מקום אחד קדימה' : 'תמונה ' + (i + 1) + ': מקום אחד אחורה');
        b.disabled = step === -1 ? i === 0 : i === images.length - 1;
        b.addEventListener('click', function () { move(i, i + step); });
        steps.appendChild(b);
      });
      t.appendChild(steps);

      t.addEventListener('dragstart', function (e) {
        dragging = t;
        t.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', src); } catch (err) { /* some browsers refuse; the drag still works */ }
        }
      });
      t.addEventListener('dragover', function (e) {
        if (!dragging) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (dragging === t) return;
        // the tiles reflow as the dragged one passes: what is seen is what will be saved
        var kids = arr(list.children);
        if (kids.indexOf(dragging) < kids.indexOf(t)) list.insertBefore(dragging, t.nextSibling);
        else list.insertBefore(dragging, t);
      });
      t.addEventListener('drop', function (e) { e.preventDefault(); });
      t.addEventListener('dragend', function () {
        dragging = null;
        var next = arr(list.children).map(function (k) { return k.getAttribute('data-src'); });
        var moved = next.join('\n') !== images.join('\n');
        images = next;
        paint();
        if (moved) changed();
      });
      return t;
    }

    function paint() {
      clear(list);
      images.forEach(function (src, i) { list.appendChild(tile(src, i)); });
      root.classList.toggle('is-empty', images.length === 0);
      if (count) count.textContent = images.length + '/' + max;
      var atMax = images.length >= max;
      if (full) full.hidden = !atMax;
      [pickBtn, fileBtn, urlIn, urlBtn].forEach(function (c) { if (c) c.disabled = atMax || uploading; });
    }

    /** Add addresses; answers how many went in (a double or a full gallery adds nothing). */
    function add(urls) {
      var added = 0;
      arr(Array.isArray(urls) ? urls : [urls]).forEach(function (u) {
        var src = String(u || '').trim();
        if (!src || images.indexOf(src) !== -1 || images.length >= max) return;
        images.push(src);
        added++;
      });
      if (added) { paint(); changed(); }
      return added;
    }

    function readFile(file) {
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { resolve(''); };
        reader.readAsDataURL(file);
      });
    }

    function upload(files) {
      var room = max - images.length;
      var queue = arr(files).slice(0, Math.max(room, 0));
      var skipped = files.length - queue.length;
      if (!queue.length) return;
      uploading = true;
      paint();
      var done = 0;
      var failed = [];
      function next(i) {
        if (i >= queue.length) {
          uploading = false;
          paint();
          var notes = failed.slice();
          if (skipped > 0) notes.push(skipped + ' קבצים לא הועלו — אפשר עד ' + max + ' תמונות למוצר');
          say(done ? (done === 1 ? 'תמונה אחת הועלתה ✓' : done + ' תמונות הועלו ✓') : 'שום תמונה לא הועלתה', notes.length ? (done ? 'warn' : 'bad') : 'ok', notes);
          return;
        }
        var file = queue[i];
        say('מעלה ' + (i + 1) + ' מתוך ' + queue.length + ' — ' + file.name);
        // said here, in Hebrew, before the server says it in its own words
        if (file.type && file.type.indexOf('image/') !== 0) {
          failed.push(file.name + ' — זה לא קובץ תמונה');
          next(i + 1);
          return;
        }
        // the request body is capped at 12 MB and base64 adds a third
        if (file.size > 8 * 1024 * 1024) {
          failed.push(file.name + ' — הקובץ גדול מדי (עד 8MB)');
          next(i + 1);
          return;
        }
        readFile(file).then(function (data) {
          if (!data) { failed.push(file.name + ' — הקובץ לא נקרא'); next(i + 1); return; }
          // the same request the media library's own picker sends
          post('/admin/upload', { filename: file.name, data: data, folder: folder }).then(function (d) {
            if (d.ok && d.url) { add(d.url); done++; } else failed.push(file.name + ' — ' + (d.error === NET ? 'שגיאת רשת, נסו שוב' : 'ההעלאה נכשלה (' + (d.error || 'שגיאה') + ')'));
            next(i + 1);
          });
        });
      }
      next(0);
    }

    function addTyped() {
      var typed = urlIn.value.trim();
      if (!typed) return;
      var src = imageAddress(typed);
      if (!src) { say('כתובת של תמונה מתחילה ב-/ (תמונה מהאתר) או ב-https://', 'bad'); return; }
      if (images.indexOf(src) !== -1) { say('התמונה הזו כבר בגלריה', 'warn'); return; }
      if (add(src)) { urlIn.value = ''; say(''); }
    }

    if (!root.__tsGallery) {
      root.__tsGallery = true;
      if (pickBtn) {
        pickBtn.addEventListener('click', function () {
          if (!window.TapuzMediaPicker || typeof window.TapuzMediaPicker.open !== 'function') { say('ספריית המדיה לא נטענה — רעננו את הדף', 'bad'); return; }
          window.TapuzMediaPicker.open(function (picked) {
            var urls = Array.isArray(picked) ? picked : [picked];
            var added = add(urls);
            if (added < urls.length) say(added ? 'נוספו ' + added + ' מתוך ' + urls.length + ' — השאר כבר בגלריה או שאין מקום' : 'התמונות שנבחרו כבר בגלריה, או שאין מקום', 'warn');
            else say('');
          }, { accept: 'image', multiple: true });
        });
      }
      if (fileBtn && fileIn) {
        fileBtn.addEventListener('click', function () { fileIn.click(); });
        fileIn.addEventListener('change', function () {
          var files = arr(fileIn.files);
          fileIn.value = '';
          if (files.length) upload(files);
        });
      }
      if (urlBtn && urlIn) {
        urlBtn.addEventListener('click', addTyped);
        urlIn.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); addTyped(); }
        });
      }
    }

    var handle = {
      get: function () { return images.slice(); },
      set: function (next) {
        images = [];
        arr(next).forEach(function (u) {
          var src = String(u || '').trim();
          if (src && images.indexOf(src) === -1 && images.length < max) images.push(src);
        });
        paint();
      },
      add: add,
      busy: function () { return uploading; }
    };
    handle.set(o.images || []);
    return handle;
  }

  // ── sortable ──────────────────────────────────────────────────────────

  /**
   * An order set by hand. Rows are dragged by their [data-drag] handle
   * (native drag and drop — no library), and moved one step with their
   * [data-move="up"|"down"] buttons, which is the way for a keyboard and for
   * a touch screen. `onDrop(ids)` hears the new order of the rows' data-id
   * after every change.
   * @param {{ item?: string, handle?: string }} opts  selectors; rows default to `tr`
   */
  function sortable(list, onDrop, opts) {
    var o = opts || {};
    var itemSel = o.item || 'tr';
    var handleSel = o.handle || '[data-drag]';
    if (!list || list.__tsSortable) return;
    list.__tsSortable = true;
    var dragging = null;

    function items() {
      return arr(list.children).filter(function (c) { return c.matches(itemSel); });
    }
    var order = items();

    function settle() {
      var now = items();
      var same = now.length === order.length && now.every(function (n, i) { return n === order[i]; });
      order = now;
      if (!same && typeof onDrop === 'function') onDrop(now.map(function (n) { return n.getAttribute('data-id'); }));
    }

    // a row is draggable only while its handle is held, so text in the row
    // can still be selected and its fields still be clicked into
    list.addEventListener('mousedown', function (e) {
      var grip = e.target.closest ? e.target.closest(handleSel) : null;
      var item = grip ? grip.closest(itemSel) : null;
      if (item && item.parentNode === list) item.draggable = true;
    });
    list.addEventListener('mouseup', function () {
      if (!dragging) items().forEach(function (it) { it.draggable = false; });
    });
    list.addEventListener('dragstart', function (e) {
      var item = e.target.closest ? e.target.closest(itemSel) : null;
      if (!item || item.parentNode !== list || !item.draggable) return;
      dragging = item;
      item.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', item.getAttribute('data-id') || ''); } catch (err) { /* the drag still works */ }
      }
    });
    list.addEventListener('dragover', function (e) {
      if (!dragging) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      var over = e.target.closest ? e.target.closest(itemSel) : null;
      if (!over || over === dragging || over.parentNode !== list) return;
      var box = over.getBoundingClientRect();
      var after = e.clientY > box.top + box.height / 2;
      list.insertBefore(dragging, after ? over.nextSibling : over);
    });
    list.addEventListener('drop', function (e) { if (dragging) e.preventDefault(); });
    list.addEventListener('dragend', function () {
      if (dragging) {
        dragging.classList.remove('is-dragging');
        dragging.draggable = false;
      }
      dragging = null;
      settle();
    });

    list.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-move]') : null;
      var item = b ? b.closest(itemSel) : null;
      if (!item || item.parentNode !== list) return;
      var all = items();
      var i = all.indexOf(item);
      if (b.getAttribute('data-move') === 'up') {
        if (i <= 0) return;
        list.insertBefore(item, all[i - 1]);
      } else {
        if (i < 0 || i >= all.length - 1) return;
        list.insertBefore(item, all[i + 1].nextSibling);
      }
      // a moved node drops its focus; give it back so the next press moves again
      b.focus();
      settle();
    });
  }

  // ── the unsaved-changes guard ─────────────────────────────────────────

  var guard = { form: null, changed: false, url: '', message: 'יש שינויים שלא נשמרו. לצאת בלי לשמור?' };
  var saver = { form: null, fn: null };

  function guarding() {
    return !!(guard.changed && live(guard.form));
  }

  // leaving the tab, a reload, a link that leaves the shell: the browser's own question
  window.addEventListener('beforeunload', function (e) {
    if (!guarding()) return undefined;
    e.preventDefault();
    e.returnValue = guard.message;
    return guard.message;
  });

  // The shell swaps screens on a click without unloading anything, so the
  // browser never asks. Capture phase: this hears the click before the
  // shell's own listener does, and a "no" stops it there. A link the shell
  // will NOT swap (the builder, a download, another site) is left to
  // beforeunload — one question, never two.
  document.addEventListener('click', function (e) {
    if (!guarding() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.closest('[data-nav-full]')) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    var url;
    try { url = new URL(a.href, window.location.href); } catch (err) { return; }
    if (!window.TapuzNav || typeof window.TapuzNav.swappable !== 'function' || !window.TapuzNav.swappable(url)) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    if (window.confirm(guard.message)) { guard.changed = false; return; }
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // Back and forward inside the shell: the address has already changed when
  // this fires, so a "no" puts the editor's address back and keeps the
  // shell's own popstate listener from swapping the screen away.
  window.addEventListener('popstate', function (e) {
    if (!guarding()) return;
    if (window.confirm(guard.message)) { guard.changed = false; return; }
    e.stopImmediatePropagation();
    window.history.pushState({ tapuz: true }, '', guard.url);
  }, true);

  // Ctrl/Cmd+S saves the form on screen. By the physical key: on a Hebrew
  // layout the same key types "ד", and it must still save.
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== 'KeyS') return;
    if (!saver.fn || !live(saver.form)) return;
    e.preventDefault();
    saver.fn();
  });

  /**
   * Watch a form for unsaved changes. Typing in it marks it changed; a part
   * that changes without typing (the gallery, the tags, a removed row) calls
   * `touch()`; a successful save calls `clean()`. A field marked
   * data-no-dirty is a tool, not data (the options generator, the
   * add-by-address box) and does not count.
   */
  function dirty(form) {
    guard.form = form;
    guard.changed = false;
    guard.url = window.location.pathname + window.location.search;
    if (form && !form.__tsDirty) {
      form.__tsDirty = true;
      var typed = function (e) {
        var t = e.target;
        if (t && t.hasAttribute && t.hasAttribute('data-no-dirty')) return;
        if (guard.form === form) guard.changed = true;
      };
      form.addEventListener('input', typed);
      form.addEventListener('change', typed);
    }
    return {
      touch: function () { if (guard.form === form) guard.changed = true; },
      clean: function () { if (guard.form === form) guard.changed = false; },
      isDirty: function () { return guard.form === form && guard.changed; }
    };
  }

  /** The function Ctrl/Cmd+S runs while this form is on screen. */
  function onSave(form, fn) {
    saver.form = form;
    saver.fn = fn;
  }

  window.TapuzStore = {
    post: post,
    gallery: gallery,
    chips: chips,
    counter: counter,
    dirty: dirty,
    sortable: sortable,
    onSave: onSave,
    ask: ask,
    toast: toast,
    lines: lines,
    clear: clear,
    go: go,
    stash: stash,
    unstash: unstash,
    money: money,
    fromMinor: fromMinor,
    formatMoney: formatMoney,
    whole: whole,
    slug: slug
  };
  drain();
})();
