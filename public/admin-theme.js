// Theme studio — looks, the live canvas, the AI designer, save helpers
// (loaded by /admin/theme). v2.24: the fake preview card became a CANVAS —
// the real site rendered with whatever is being tried, before it is saved.
// v2.27: the doors talk back — every paste shows what was tolerated, what
// was taken out and what the effect guard will do; a page pasted as a theme
// is offered to the bench instead; the canvas reports a guard stop.
(function () {
  var colorKeys = ['primary', 'secondary', 'text', 'muted', 'border', 'bg', 'lightBg', 'surface'];
  var formIds = ['th-title', 'th-font', 'th-font-heading', 'th-font-google', 'th-font-size', 'th-maxw', 'th-menu-place',
    'th-logo-type', 'th-logo-text', 'th-logo-image', 'th-desc', 'th-radius', 'th-shadow', 'th-accent', 'th-buttons',
    'th-bg-kind', 'th-bg-angle', 'th-ch-hover', 'th-ch-hovercolor', 'th-ch-weight', 'th-ch-glass', 'th-ch-headerbg',
    'th-ch-headertext', 'th-ch-footerbg', 'th-ch-footertext', 'th-skin-note', 'th-skin-css',
    'th-header-width', 'th-ch-overflow', 'th-ch-align', 'th-ch-gap', 'th-ch-size',
    'th-ch-fold', 'th-ch-collapse', 'th-ch-current'];

  function $(id) { return document.getElementById(id); }
  function val(id, fallback) {
    var el = $(id);
    return el && el.value !== undefined ? el.value : (fallback || '');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function setStatus(id, msg, ok) {
    var el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = ok === false ? '#b91c1c' : ok ? '#166534' : '#64748b';
  }
  /** The door's warnings, as a list under the card — or nothing. */
  function showWarnings(id, list) {
    var el = $(id);
    if (!el) return;
    var items = (list || []).filter(Boolean);
    el.innerHTML = items.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
    el.hidden = !items.length;
  }
  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }
  function rebuildNote(d) {
    return d && d.rebuildError ? ' — ⚠️ אבל בניית האתר נכשלה: ' + d.rebuildError : '';
  }
  function warnNote(d) {
    var n = d && d.warnings ? d.warnings.length : 0;
    return n ? ' · ' + n + ' הערות למטה' : '';
  }

  // ── the form ──────────────────────────────────────────────────────
  function bindColor(k) {
    var c = $('th-color-' + k);
    var h = $('th-color-' + k + '-hex');
    if (!c || !h) return;
    c.addEventListener('input', function () { h.value = c.value; schedulePreview(); });
    h.addEventListener('change', function () {
      if (/^#[0-9a-fA-F]{6}$/.test(h.value)) c.value = h.value;
      schedulePreview();
    });
  }
  colorKeys.forEach(bindColor);
  formIds.forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener('input', schedulePreview);
    el.addEventListener('change', schedulePreview);
  });

  function colors() {
    var o = {};
    colorKeys.forEach(function (k) {
      var c = $('th-color-' + k);
      o[k] = c ? c.value : '#000000';
    });
    return o;
  }

  function googleFonts() {
    return val('th-font-google').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /** The fold knob as the number the model stores: 0–12, 0 when blank. */
  function foldValue() {
    var n = parseInt(val('th-ch-fold', '0'), 10);
    if (isNaN(n)) n = 0;
    return Math.max(0, Math.min(12, n));
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
          baseSize: val('th-font-size', '17px') || '17px',
          google: googleFonts()
        },
        style: {
          radius: val('th-radius', 'soft') || 'soft',
          shadow: val('th-shadow', 'soft') || 'soft',
          accent: val('th-accent', 'solid') || 'solid',
          buttons: val('th-buttons', 'filled') || 'filled'
        },
        layout: {
          maxWidth: val('th-maxw', '900px') || '900px',
          menuPlacement: val('th-menu-place', 'top') || 'top',
          headerWidth: val('th-header-width', 'wide') || 'wide'
        },
        background: {
          kind: val('th-bg-kind', 'solid') || 'solid',
          angle: Number(val('th-bg-angle', '160')) || 160
        },
        // master-page chrome (v2.23) — the skeleton's look, as theme state
        chrome: {
          menuHover: val('th-ch-hover', 'color') || 'color',
          menuHoverColor: val('th-ch-hovercolor'),
          menuWeight: val('th-ch-weight', 'normal') || 'normal',
          headerGlass: !!($('th-ch-glass') || {}).checked,
          headerBg: val('th-ch-headerbg'),
          headerText: val('th-ch-headertext'),
          footerBg: val('th-ch-footerbg'),
          footerText: val('th-ch-footertext'),
          // the menu's geometry (v2.28)
          menuOverflow: val('th-ch-overflow', 'wrap') || 'wrap',
          menuAlign: val('th-ch-align', 'start') || 'start',
          menuGap: val('th-ch-gap', 'md') || 'md',
          menuSize: val('th-ch-size', 'md') || 'md',
          // v2.28b — the fold ("עוד"), the drawer point, the current-page mark
          menuFold: foldValue(),
          menuCollapse: val('th-ch-collapse', 'md') || 'md',
          menuCurrent: val('th-ch-current', 'underline') || 'underline'
        },
        skin: {
          css: val('th-skin-css'),
          note: val('th-skin-note')
        }
      }
    };
  }

  // ── the canvas ────────────────────────────────────────────────────
  var canvas = $('th-canvas');
  var previewTimer = null;
  var previewSeq = 0;
  var lastPreviewId = 'live';

  function canvasPath() {
    var v = val('th-canvas-page');
    return v === '__canvas' ? '' : v;
  }
  function onBench() {
    var sel = $('th-canvas-page');
    return !sel || sel.value === '__canvas';
  }
  function previewSrc(id) {
    var q = onBench() ? '?canvas=1' : (canvasPath() ? '?path=' + encodeURIComponent(canvasPath()) : '');
    return '/admin/theme/preview/' + id + q;
  }

  /** Register a candidate with the server and point the canvas at it. */
  function canvasShow(label, body) {
    if (!canvas) return Promise.resolve();
    var seq = ++previewSeq;
    setStatus('th-canvas-status', 'מרנדר את האתר בערכה…');
    return api('/admin/api/theme/preview', body).then(function (d) {
      if (seq !== previewSeq) return; // a newer candidate won
      if (!d.ok) { setStatus('th-canvas-status', d.error || 'שגיאה בתצוגה', false); return d; }
      lastPreviewId = d.id;
      var src = previewSrc(d.id);
      canvas.src = src;
      var open = $('th-canvas-open');
      if (open) open.href = src;
      var lbl = $('th-canvas-label');
      if (lbl) lbl.textContent = 'מציג: ' + label + (d.fonts && d.fonts.length ? ' · גופנים: ' + d.fonts.join(', ') : '') + (d.benchModules != null ? ' · קנבס מהמועמד (' + d.benchModules + ' מודולים)' : '');
      setStatus('th-canvas-status', (d.hasEffect ? 'טוען… (הערכה כוללת אפקט — נבדוק שהוא רץ)' : 'הערכה הזו בלי אפקט JS.') + (d.benchError ? ' · הקנבס של המועמד לא התקמפל: ' + d.benchError : ''));
      return d;
    }).catch(function () { setStatus('th-canvas-status', 'שגיאת רשת בתצוגה', false); });
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      canvasShow('הטופס (לא נשמר)', { overrides: payload().overrides });
    }, 450);
  }

  // the framed page reports: did the effect run, did anything throw, did
  // the guard have to stop it
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'tapuz-theme-preview') return;
    var d = ev.data;
    if (d.killed) {
      setStatus('th-canvas-status', '⛔ השומר עצר את האפקט: ' + d.killed + ' — הדף נשאר תקין, אבל האפקט הזה כבד מדי לגולשים. בקשו מהצ׳אט גרסה קלה (מאגר קבוע, לולאת rAF אחת).', false);
    } else if (d.errors && d.errors.length) {
      setStatus('th-canvas-status', '❌ שגיאה בדף/באפקט: ' + d.errors.join(' · ') + ' — בקשו מהצ׳אט לתקן', false);
    } else if (d.skipped) {
      setStatus('th-canvas-status', '🐢 האפקט לא הופעל אצלכם כי "הפחתת תנועה" דולקת — אצל הגולשים הוא ירוץ.');
    } else if (d.effect) {
      setStatus('th-canvas-status', '✅ הדף נטען והאפקט רץ בלי שגיאות — הזיזו את העכבר בקנבס כדי לראות אותו.' + motionNote(), true);
    } else {
      setStatus('th-canvas-status', '✅ הדף נטען. ' + (d.path ? '(' + d.path + ')' : '') + ' אין אפקט JS בערכה הזו.');
    }
  });

  var reducedMotion = false;
  try { reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* no matchMedia */ }
  function motionNote() {
    return reducedMotion ? ' 🐢 (אצלכם "הפחתת תנועה" דולקת — אפקט שמכבד אותה יוסתר כאן)' : '';
  }
  if (reducedMotion && $('th-fx-motion')) $('th-fx-motion').style.display = 'block';

  var pageSel = $('th-canvas-page');
  if (pageSel) pageSel.addEventListener('change', function () {
    if (!canvas) return;
    canvas.src = previewSrc(lastPreviewId);
    var bench = $('th-bench');
    if (bench) bench.style.display = onBench() ? '' : 'none';
  });
  var refresh = $('th-canvas-refresh');
  if (refresh) refresh.onclick = function () { if (canvas) canvas.src = canvas.src; };
  var desk = $('th-canvas-desktop');
  var mob = $('th-canvas-mobile');
  if (desk) desk.onclick = function () { if (canvas) { canvas.style.width = '100%'; canvas.style.height = '640px'; } };
  // ⛶ — the bench is theme-WIDE: fill the window with it
  var full = $('th-canvas-full');
  var wrap = $('th-canvas-wrap');
  var isFull = false;
  function setFull(on) {
    if (!wrap || !canvas) return;
    isFull = on;
    wrap.classList.toggle('is-full', on);
    canvas.style.width = '100%';
    canvas.style.height = on ? 'calc(100vh - 16px)' : '640px';
    if (full) full.textContent = on ? '✕' : '⛶';
  }
  if (full) full.onclick = function () { setFull(!isFull); };
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && isFull) setFull(false); });
  if (mob) mob.onclick = function () { if (canvas) { canvas.style.width = '390px'; canvas.style.height = '700px'; } };

  // ── The BENCH (v2.25) — modules on the theme canvas ──
  function benchStatus(msg, ok) { setStatus('th-bench-status', msg, ok); }
  /** Sensible width ratios for a row of n cells — the equal split, one
   *  double cell at each end / the middle, and a triple lead. */
  function ratioPresets(n) {
    var eq = []; for (var i = 0; i < n; i++) eq.push(1);
    var out = [eq.join(':')];
    if (n >= 2) {
      var a = eq.slice(); a[0] = 2; out.push(a.join(':'));
      var z = eq.slice(); z[n - 1] = 2; out.push(z.join(':'));
      var t = eq.slice(); t[0] = 3; out.push(t.join(':'));
    }
    if (n >= 3) { var mid = eq.slice(); mid[Math.floor(n / 2)] = 2; out.push(mid.join(':')); }
    return out;
  }
  var benchSourceCache = '';
  var benchSrcBtn = $('th-bench-src');
  if (benchSrcBtn) benchSrcBtn.onclick = function () {
    // the bench IS a BenTML document — show it in the paste box for direct
    // editing; "החלף את הקנבס" writes it back
    var ta = $('th-bench-source');
    if (!ta) return;
    ta.value = benchSourceCache || '';
    ta.rows = 14;
    ta.focus();
    benchStatus(benchSourceCache ? 'זה המקור של הקנבס (BenTML). ערכו ולחצו ♻ החלף את הקנבס' : 'הקנבס ריק — אין עדיין מקור', true);
  };
  function renderBench(d) {
    var list = $('th-bench-list');
    var count = $('th-bench-count');
    if (typeof d.source === 'string') benchSourceCache = d.source;
    if (!list) return;
    var mods = d.modules || [];
    var total = 0;
    mods.forEach(function (m) { total += m.row ? m.columns.reduce(function (n, c) { return n + c.length; }, 0) : 1; });
    if (count) count.textContent = mods.length ? total + ' מודולים' + (mods.some(function (m) { return m.row; }) ? ' · ' + mods.filter(function (m) { return m.row; }).length + ' שורות' : '') : 'ריק — קנבס של כלום';
    var chip = function (m, i, n, inCell) {
      return '<span class="bench-chip">' +
        esc(m.icon ? m.icon + ' ' : '') + esc(m.label) +
        (i > 0 ? '<button type="button" data-bench-move="' + esc(m.id) + '" data-dir="up" title="' + (inCell ? 'למעלה בתא' : 'למעלה') + '">↑</button>' : '') +
        (i < n - 1 ? '<button type="button" data-bench-move="' + esc(m.id) + '" data-dir="down" title="' + (inCell ? 'למטה בתא' : 'למטה') + '">↓</button>' : '') +
        '<button type="button" class="rm" data-bench-remove="' + esc(m.id) + '" title="הסר מהקנבס">✕</button></span>';
    };
    list.innerHTML = mods.map(function (m, i) {
      if (!m.row) return '<div class="bench-chips">' + chip(m, i, mods.length, false) + '</div>';
      // a ROW: its cells side by side, each a drop target for the palette or a paste
      var cells = m.columns.map(function (cell, ci) {
        return '<div class="bench-cell">' +
          '<div class="bench-cell-head"><span>עמודה ' + (ci + 1) + '</span>' +
          '<span><button type="button" data-cell-add="' + esc(m.id) + '" data-col="' + ci + '" title="הוסף לתא את המודול שנבחר בארגז" style="color:#166534">➕</button>' +
          '<button type="button" data-cell-paste="' + esc(m.id) + '" data-col="' + ci + '" title="הדבק לתא את ה-BenTML מהתיבה למטה" style="color:#1d4ed8">📥</button></span></div>' +
          (cell.length ? cell.map(function (x, xi) { return chip(x, xi, cell.length, true); }).join('') : '<span class="bench-empty">ריק</span>') +
          '</div>';
      }).join('');
      var n = m.columns.length;
      var presets = ratioPresets(n);
      var sel = function (name, options, current, title) {
        return '<select data-row-set="' + esc(m.id) + '" data-key="' + name + '" title="' + esc(title) + '">' +
          options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(current) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      };
      var controls =
        sel('cells', [[1, '1 תא'], [2, '2 תאים'], [3, '3 תאים'], [4, '4 תאים'], [5, '5 תאים'], [6, '6 תאים']], n, 'מספר התאים בשורה') +
        '<select data-row-ratio-preset="' + esc(m.id) + '" title="יחס רוחב מוכן">' +
          '<option value="">יחס…</option>' + presets.map(function (p) { return '<option value="' + p + '"' + (p === m.ratio ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select>' +
        '<input data-row-ratio="' + esc(m.id) + '" value="' + esc(m.ratio || '') + '" placeholder="' + Array(n + 1).join('1').split('').join(':') + '" dir="ltr" title="יחס רוחב לכל תא, למשל 2:1:1 (ריק = שווה)" style="width:' + (n * 14 + 24) + 'px">' +
        sel('width', [['content', 'רוחב תוכן'], ['wide', 'רחב (1400px)'], ['full', 'מסך מלא']], m.width, 'רוחב השורה') +
        sel('gap', [['none', 'בלי רווח'], ['sm', 'רווח קטן'], ['md', 'רווח רגיל'], ['lg', 'רווח גדול']], m.gap, 'מרווח בין התאים') +
        sel('valign', [['top', 'למעלה'], ['center', 'מרכז'], ['bottom', 'למטה'], ['stretch', 'מתיחה (גובה אחיד)']], m.valign, 'יישור אנכי') +
        sel('collapse', [['sm', 'נערם ב-640'], ['md', 'נערם ב-768'], ['lg', 'נערם ב-1024'], ['never', 'לא נערם']], m.collapse, 'מאיזה רוחב מסך התאים נערמים');
      return '<div class="bench-row">' +
        '<div class="bench-row-head"><strong>▦ ' + esc(m.label) + '</strong>' + controls + '<span class="grow"></span>' +
        (i > 0 ? '<button type="button" class="bench-btn" data-bench-move="' + esc(m.id) + '" data-dir="up" title="שורה למעלה">↑</button>' : '') +
        (i < mods.length - 1 ? '<button type="button" class="bench-btn" data-bench-move="' + esc(m.id) + '" data-dir="down" title="שורה למטה">↓</button>' : '') +
        '<button type="button" class="bench-btn rm" data-bench-remove="' + esc(m.id) + '" title="הסר את השורה כולה">✕</button></div>' +
        '<div class="bench-cells">' + cells + '</div></div>';
    }).join('');
    list.querySelectorAll('[data-row-set]').forEach(function (el) {
      el.onchange = function () { var body = { op: 'set-row', id: el.dataset.rowSet }; body[el.dataset.key] = el.value; benchOp(body); };
    });
    list.querySelectorAll('[data-row-ratio-preset]').forEach(function (el) {
      el.onchange = function () { if (el.value) benchOp({ op: 'set-row', id: el.dataset.rowRatioPreset, ratio: el.value }); };
    });
    list.querySelectorAll('[data-row-ratio]').forEach(function (el) {
      el.onchange = function () { benchOp({ op: 'set-row', id: el.dataset.rowRatio, ratio: el.value.trim() }); };
    });
    list.querySelectorAll('[data-cell-add]').forEach(function (b) {
      b.onclick = function () { benchOp({ op: 'add-module', type: val('th-bench-type'), rowId: b.dataset.cellAdd, col: Number(b.dataset.col) }); };
    });
    list.querySelectorAll('[data-cell-paste]').forEach(function (b) {
      b.onclick = function () {
        if (!benchSource()) return benchStatus('הדביקו קודם BenTML / .pzn בתיבה למטה', false);
        benchOp({ op: 'append-source', source: benchSource(), rowId: b.dataset.cellPaste, col: Number(b.dataset.col) });
        var ta = $('th-bench-source'); if (ta) ta.value = '';
      };
    });
    list.querySelectorAll('[data-bench-remove]').forEach(function (b) {
      b.onclick = function () { benchOp({ op: 'remove', id: b.dataset.benchRemove }); };
    });
    list.querySelectorAll('[data-bench-move]').forEach(function (b) {
      b.onclick = function () { benchOp({ op: 'move', id: b.dataset.benchMove, dir: b.dataset.dir }); };
    });
    var sel = $('th-bench-type');
    if (sel && d.palette && !sel.options.length) {
      var groups = {};
      d.palette.forEach(function (p) { (groups[p.category || 'אחר'] = groups[p.category || 'אחר'] || []).push(p); });
      sel.innerHTML = Object.keys(groups).map(function (g) {
        return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (p) {
          return '<option value="' + esc(p.type) + '">' + esc((p.icon ? p.icon + ' ' : '') + p.label) + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
    }
  }
  function reloadBench() {
    // the bench changed: re-render it in the current candidate
    var sel = $('th-canvas-page');
    if (sel) sel.value = '__canvas';
    var bench = $('th-bench');
    if (bench) bench.style.display = '';
    if (canvas) canvas.src = previewSrc(lastPreviewId);
  }
  function benchOp(body) {
    benchStatus('מעדכן את הקנבס…');
    return api('/admin/api/theme/canvas', body).then(function (d) {
      if (!d.ok) { benchStatus(d.error || 'שגיאה', false); return d; }
      renderBench(d);
      var w = d.warnings && d.warnings.length ? ' · תוקן: ' + d.warnings.slice(0, 2).join(' | ') : '';
      benchStatus((d.added ? 'נוספו ' + d.added + ' · ' : '') + 'על הקנבס עכשיו ' + d.count + ' מודולים ✓' + w, true);
      reloadBench();
      return d;
    }).catch(function () { benchStatus('שגיאת רשת', false); });
  }
  function benchSource() { return (($('th-bench-source') || {}).value || '').trim(); }
  var benchAppend = $('th-bench-append');
  if (benchAppend) benchAppend.onclick = function () {
    if (!benchSource()) return benchStatus('הדביקו קודם BenTML / .pzn', false);
    benchOp({ op: 'append-source', source: benchSource() });
    var ta = $('th-bench-source'); if (ta) ta.value = '';
  };
  var benchReplace = $('th-bench-replace');
  if (benchReplace) benchReplace.onclick = function () {
    if (!benchSource()) return benchStatus('הדביקו קודם BenTML / .pzn', false);
    benchOp({ op: 'replace-source', source: benchSource() });
    var ta = $('th-bench-source'); if (ta) ta.value = '';
  };
  var benchAdd = $('th-bench-add');
  if (benchAdd) benchAdd.onclick = function () { benchOp({ op: 'add-module', type: val('th-bench-type') }); };
  var benchRow = $('th-bench-row');
  if (benchRow) benchRow.onclick = function () { benchOp({ op: 'add-row', count: Number(val('th-bench-cols', '3')) || 3 }); };
  var benchShow = $('th-bench-showcase');
  if (benchShow) benchShow.onclick = function () { benchOp({ op: 'showcase' }); };
  var benchClear = $('th-bench-clear');
  if (benchClear) benchClear.onclick = function () {
    if (!confirm('לרוקן את הקנבס? (הערכה עצמה לא משתנה)')) return;
    benchOp({ op: 'clear' });
  };
  var benchPrompt = $('th-bench-prompt');
  if (benchPrompt) benchPrompt.onclick = function () {
    // the SITE-BUILDER roleplay (the modules game) — compose modules in your
    // own chat, paste the reply into the bench
    var q = new URLSearchParams({ format: 'roleplay', locale: 'he' });
    var brief = (($('th-bench-brief') || {}).value || '').trim();
    if (brief) q.set('brief', brief);
    benchStatus('בונה את הפרומפט…');
    fetch('/admin/api/inject-pack?' + q.toString()).then(function (r) { return r.text(); }).then(function (text) {
      return navigator.clipboard.writeText(text).then(function () {
        benchStatus('✅ פרומפט בונה-הדפים הועתק (' + (text.length / 1000).toFixed(1) + 'K) — הדביקו בצ׳אט, ואת התשובה הדביקו כאן למטה', true);
      });
    }).catch(function () { benchStatus('שגיאה בהעתקה', false); });
  };
  fetch('/admin/api/theme/canvas').then(function (r) { return r.json(); }).then(function (d) { if (d.ok) renderBench(d); }).catch(function () {});

  // ── Looks: one-click whole personalities (data injected by the page) ──
  function setColor(k, v) {
    var c = $('th-color-' + k);
    var h = $('th-color-' + k + '-hex');
    if (c && v) c.value = v;
    if (h && v) h.value = v;
  }
  function setValue(id, v) {
    var el = $(id);
    if (el && v !== undefined && v !== null) el.value = v;
  }

  var DEFAULT_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Hebrew", sans-serif';

  function applyLook(look) {
    var o = look.overrides || {};
    Object.keys(o.colors || {}).forEach(function (k) { setColor(k, o.colors[k]); });
    var st = Object.assign({ radius: 'soft', shadow: 'soft', accent: 'solid', buttons: 'filled' }, o.style || {});
    setValue('th-radius', st.radius);
    setValue('th-shadow', st.shadow);
    setValue('th-accent', st.accent);
    setValue('th-buttons', st.buttons);
    // A look is a WHOLE personality: fonts, background, chrome and skin
    // included. A look that says nothing about a section resets it to the
    // default — never layers over the previous look's leftovers.
    var f = o.fonts || {};
    setValue('th-font', f.family !== undefined ? f.family : DEFAULT_FONT);
    setValue('th-font-heading', f.headingFamily !== undefined ? f.headingFamily : '');
    setValue('th-font-google', (f.google || []).join(', '));
    var bg = Object.assign({ kind: 'solid', angle: 160 }, o.background || {});
    setValue('th-bg-kind', bg.kind);
    setValue('th-bg-angle', bg.angle);
    var ch = Object.assign({
      menuHover: 'color', menuHoverColor: '', menuWeight: 'normal',
      headerGlass: false, headerBg: '', headerText: '', footerBg: '', footerText: ''
    }, o.chrome || {});
    setValue('th-ch-hover', ch.menuHover);
    setValue('th-ch-hovercolor', ch.menuHoverColor);
    setValue('th-ch-weight', ch.menuWeight);
    var glass = $('th-ch-glass');
    if (glass) glass.checked = ch.headerGlass === true || ch.headerGlass === 'true';
    setValue('th-ch-headerbg', ch.headerBg);
    setValue('th-ch-headertext', ch.headerText);
    setValue('th-ch-footerbg', ch.footerBg);
    setValue('th-ch-footertext', ch.footerText);
    setValue('th-ch-overflow', ch.menuOverflow || 'wrap');
    setValue('th-ch-align', ch.menuAlign || 'start');
    setValue('th-ch-gap', ch.menuGap || 'md');
    setValue('th-ch-size', ch.menuSize || 'md');
    setValue('th-ch-fold', ch.menuFold != null ? ch.menuFold : 0);
    setValue('th-ch-collapse', ch.menuCollapse || 'md');
    setValue('th-ch-current', ch.menuCurrent || 'underline');
    setValue('th-header-width', (o.layout || {}).headerWidth || 'wide');
    var skin = Object.assign({ css: '', note: '' }, o.skin || {});
    setValue('th-skin-css', skin.css);
    setValue('th-skin-note', skin.note);
    clearTimeout(previewTimer);
    canvasShow('מראה "' + (look.label || '') + '" (לא נשמר)', { overrides: payload().overrides });
  }

  /** A look card is a tiny screen: the header bar, a headline in the look's
   *  heading font, a button on its accent — the look itself, not four dots. */
  function renderLooks() {
    var host = $('th-looks');
    var looks = window.TAPUZ_LOOKS;
    if (!host || !looks) return;
    Object.keys(looks).forEach(function (key) {
      var look = looks[key];
      var o = look.overrides || {};
      var c = o.colors || {};
      var ch = o.chrome || {};
      var st = o.style || {};
      var f = o.fonts || {};
      var accent = st.accent === 'gradient' ? 'linear-gradient(135deg,' + (c.primary || '#f97316') + ',' + (c.secondary || c.primary || '#f97316') + ')' : (c.primary || '#f97316');
      var radius = st.radius === 'sharp' ? '3px' : st.radius === 'round' ? '999px' : '8px';
      var headerBg = ch.headerBg || c.surface || '#fff';
      var headerText = ch.headerText || c.text || '#111';
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'look-card';
      card.setAttribute('dir', 'rtl');
      card.title = look.label;
      var extras = [];
      if (f.google && f.google.length) extras.push('גופן ' + f.google[0]);
      if (o.background && o.background.kind && o.background.kind !== 'solid') extras.push('רקע');
      if (o.skin && o.skin.css) extras.push('עור');
      if (ch.headerGlass) extras.push('זכוכית');
      card.innerHTML =
        '<div class="look-screen" style="background:' + esc(c.bg || '#fff') + ';color:' + esc(c.text || '#111') + '">' +
          '<div class="look-bar" style="background:' + esc(headerBg) + ';border:1px solid ' + esc(c.border || '#e5e7eb') + '"><i style="background:' + esc(headerText) + ';width:22px"></i><i style="background:' + esc(headerText) + '"></i><i style="background:' + esc(headerText) + '"></i></div>' +
          '<div class="look-title" style="font-family:' + esc(f.headingFamily || f.family || 'inherit') + '">' + esc(look.label) + '</div>' +
          '<span class="look-btn" style="background:' + esc(st.buttons === 'outline' ? 'transparent' : accent) + ';border:1.5px solid ' + esc(c.primary || '#f97316') + ';color:' + esc(st.buttons === 'outline' || st.buttons === 'soft' ? (c.primary || '#f97316') : '#fff') + ';border-radius:' + radius + '">כפתור</span>' +
        '</div>' +
        '<div class="look-meta">' +
          '<div class="look-name">' + (look.emoji || '🎨') + ' ' + esc(look.label) + '</div>' +
          '<div class="look-dots">' + ['primary', 'secondary', 'surface', 'text'].map(function (k) { return '<span style="background:' + esc(c[k] || '#ccc') + '"></span>'; }).join('') + '</div>' +
          (extras.length ? '<div class="look-extras">' + esc(extras.join(' · ')) + '</div>' : '') +
        '</div>';
      card.addEventListener('click', function () { applyLook(look); });
      host.appendChild(card);
    });
  }

  // ── save ──────────────────────────────────────────────────────────
  function save(thenBuild) {
    setStatus('th-save-status', 'שומר…');
    api('/admin/api/theme', payload()).then(function (d) {
      if (!d.ok) return setStatus('th-save-status', d.error || 'שגיאה', false);
      // the door may have cleaned the skin (an @import, an external url) —
      // the form shows what was actually saved
      if (d.overrides && d.overrides.skin && $('th-skin-css') && $('th-skin-css').value !== d.overrides.skin.css) $('th-skin-css').value = d.overrides.skin.css;
      if (d.overrides && d.overrides.fonts && $('th-font-google')) $('th-font-google').value = (d.overrides.fonts.google || []).join(', ');
      // the door may have reset a menu knob — the form shows what was saved,
      // and the capacity hint speaks for the knobs that are now live
      if (d.overrides && d.overrides.chrome) {
        setValue('th-ch-fold', d.overrides.chrome.menuFold != null ? d.overrides.chrome.menuFold : 0);
        setValue('th-ch-collapse', d.overrides.chrome.menuCollapse || 'md');
        setValue('th-ch-current', d.overrides.chrome.menuCurrent || 'underline');
      }
      showNavFit(d.menuFit);
      var w = d.warnings && d.warnings.length ? ' · ' + d.warnings.join(' · ') : '';
      // every save rebuilds the site on the server (the live pages are the
      // static export, served before the renderer — a save that did not
      // rebuild changed nothing anyone could see). "שמור + בנה" keeps its
      // explicit rebuild and opens the site so the change is in front of you.
      if (thenBuild) {
        return fetch('/admin/build', { method: 'POST' }).then(function (r) { return r.json(); }).then(function () {
          setStatus('th-save-status', 'נשמר ונבנה ✓' + rebuildNote(d) + w, !d.rebuildError);
          window.open('/', '_blank');
        });
      }
      setStatus('th-save-status', 'נשמר ✓ — האתר עודכן' + rebuildNote(d) + w, !d.rebuildError);
      canvasShow('הערכה החיה', {});
      fxCurrent();
    }).catch(function () { setStatus('th-save-status', 'שגיאה בשמירה', false); });
  }

  var saveBtn = $('th-save');
  if (saveBtn) saveBtn.onclick = function () { save(false); };
  var saveBuildBtn = $('th-save-build');
  if (saveBuildBtn) saveBuildBtn.onclick = function () { save(true); };

  var resetBtn = $('th-reset');
  if (resetBtn) resetBtn.onclick = function () {
    if (!confirm('לאפס overrides לברירת מחדל?')) return;
    // the 'naki' look IS the default bundle — one source of truth
    var naki = (window.TAPUZ_LOOKS || {}).naki;
    var overrides = naki ? JSON.parse(JSON.stringify(naki.overrides)) : {};
    overrides.fonts = overrides.fonts || {};
    overrides.fonts.family = DEFAULT_FONT;
    overrides.fonts.baseSize = '17px';
    overrides.fonts.google = [];
    overrides.layout = { maxWidth: '900px', menuPlacement: 'top', headerWidth: 'wide' };
    overrides.background = { kind: 'solid', angle: 160 };
    overrides.skin = { css: '', note: '' };
    // the menu's geometry (v2.28) back to what the theme css does untouched
    overrides.chrome = Object.assign({}, overrides.chrome || {}, {
      menuOverflow: 'wrap', menuAlign: 'start', menuGap: 'md', menuSize: 'md',
      menuFold: 0, menuCollapse: 'md', menuCurrent: 'underline'
    });
    api('/admin/api/theme', { overrides: overrides }).then(function () { location.reload(); });
  };

  // ── the capacity hint (v2.28b) — how the main menu fits under the knobs ──
  // Same words as the server renders into #th-nav-fit (routes/theme.js
  // navFitLine); refreshed from GET /admin/api/theme at load and from the
  // save response, which carries the estimate for the knobs just saved.
  function navFitLine(fit) {
    if (!fit || !fit.itemsPx) return '';
    var rows = fit.rowsNow === 1 ? 'היום שורה אחת ✓' : 'היום ' + fit.rowsNow + ' שורות';
    return 'בתפריט הראשי ' + fit.itemsPx.length + ' פריטים · בשורה אחת נכנסים ~' + fit.capacity + ' · ' + rows;
  }
  function showNavFit(fit) {
    var el = $('th-nav-fit');
    var line = navFitLine(fit);
    if (el && line) el.textContent = line;
  }
  function refreshNavFit() {
    if (!$('th-nav-fit')) return;
    fetch('/admin/api/theme').then(function (r) { return r.json(); }).then(function (d) { showNavFit(d.menuFit); }).catch(function () {});
  }

  // ── Theme package import (v0.99 → v2.24 tolerant + file picker) ──
  var importFile = $('th-import-file');
  if (importFile) importFile.addEventListener('change', function () {
    var f = importFile.files && importFile.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var ta = $('th-import-text');
      if (ta) ta.value = String(reader.result || '');
      setStatus('th-import-status', 'נקרא "' + f.name + '" — עכשיו 👁 / שמור / החל', true);
    };
    reader.readAsText(f);
  });

  function importText() {
    return (($('th-import-text') || {}).value || '').trim();
  }
  var importPreview = $('th-import-preview');
  if (importPreview) importPreview.onclick = function () {
    if (!importText()) return setStatus('th-import-status', 'אין מה להציג — הדביקו או בחרו קובץ', false);
    canvasShow('ערכה מיובאת (לא נשמרה)', { reply: importText() }).then(function (d) {
      if (d && d.ok) { setStatus('th-import-status', 'מוצג בקנבס למעלה ↑' + warnNote(d), true); showWarnings('th-import-warn', d.warnings); }
      else if (d) setStatus('th-import-status', d.error || 'שגיאה', false);
    });
  };
  var importBtn = $('th-import-apply');
  if (importBtn) importBtn.onclick = function () {
    if (!importText()) return setStatus('th-import-status', 'אין מה לייבא — הדביקו או בחרו קובץ', false);
    api('/admin/api/theme/import', { text: importText() }).then(function (d) {
      if (d.ok) {
        showWarnings('th-import-warn', d.warnings);
        setStatus('th-import-status', 'הוחל ✓' + (d.benchCount != null ? ' · הקנבס התמלא ב-' + d.benchCount + ' מודולים' : '') + (d.benchError ? ' · הקנבס לא התקמפל: ' + d.benchError : '') + rebuildNote(d) + ' — טוען מחדש…', !d.rebuildError);
        setTimeout(function () { location.reload(); }, d.warnings && d.warnings.length ? 2500 : 700);
      } else setStatus('th-import-status', d.error || 'שגיאה', false);
    }).catch(function () { setStatus('th-import-status', 'שגיאת רשת', false); });
  };
  // import-to-LIBRARY: the package becomes one of the available themes
  // instead of replacing the live one
  var importLib = $('th-import-library');
  if (importLib) importLib.onclick = function () {
    if (!importText()) return setStatus('th-import-status', 'אין מה לייבא — הדביקו או בחרו קובץ', false);
    api('/admin/api/theme/library/import', { text: importText() }).then(function (d) {
      if (d.ok) {
        showWarnings('th-import-warn', d.warnings);
        setStatus('th-import-status', 'נשמרה לספרייה כ-"' + d.name + '" ✓ (האתר החי לא השתנה)' + warnNote(d), true);
        renderLibrary();
      } else setStatus('th-import-status', d.error || 'שגיאה', false);
    }).catch(function () { setStatus('th-import-status', 'שגיאת רשת', false); });
  };

  // ── Theme LIBRARY (v2.21) — themes as artifacts, the WordPress attitude ──
  function renderLibrary() {
    var list = $('th-lib-list');
    if (!list) return;
    fetch('/admin/api/theme/library').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { list.textContent = d.error || 'שגיאה'; return; }
      if (!d.themes.length) {
        list.innerHTML = '<div style="grid-column:1/-1;color:#64748b">אין עדיין ערכות שמורות — שמרו את הערכה הנוכחית בשם, או הדביקו ערכה מה-AI למעלה.</div>';
        return;
      }
      list.innerHTML = d.themes.map(function (t) {
        var strip = (t.palette || []).map(function (c) { return '<span style="background:' + esc(c) + '"></span>'; }).join('');
        var srcLabel = t.source === 'ai' ? '🤖 נבנה עם AI' : t.source === 'import' ? '📦 יובא' : t.source === 'auto' ? '⏪ גיבוי אוטומטי' : t.source === 'preset' ? '🎨 ערכה מובנית' : '✋ נשמר ידנית';
        return '<div class="lib-card" data-thm="' + esc(t.id) + '">' +
          '<div class="lib-strip">' + strip + '</div>' +
          '<div class="lib-body">' +
          '<div class="lib-name">' + esc(t.name) + '</div>' +
          '<div class="lib-src">' + srcLabel + '</div>' +
          '<div class="lib-actions">' +
          '<button type="button" class="btn secondary" data-lib-preview="' + esc(t.id) + '" data-lib-name="' + esc(t.name) + '" title="הצג בקנבס בלי לשנות כלום">👁</button>' +
          '<button type="button" class="btn" data-lib-apply="' + esc(t.id) + '">החל</button>' +
          '<a class="btn secondary" href="/admin/api/theme/library/export.bent?id=' + encodeURIComponent(t.id) + '" download title="ייצוא כמסמך .bent">‎.bent</a>' +
          '<a class="btn secondary" href="/admin/api/theme/library/export?id=' + encodeURIComponent(t.id) + '" download title="ייצוא כ-JSON">JSON</a>' +
          '<button type="button" class="btn secondary" data-lib-remove="' + esc(t.id) + '" title="מחיקה מהספרייה">🗑</button>' +
          '</div></div></div>';
      }).join('');

      list.querySelectorAll('[data-lib-preview]').forEach(function (btn) {
        btn.onclick = function () {
          canvasShow('ערכה "' + btn.dataset.libName + '" מהספרייה (לא הוחלה)', { libraryId: btn.dataset.libPreview });
          var c = $('th-canvas-card');
          if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
      });
      list.querySelectorAll('[data-lib-apply]').forEach(function (btn) {
        btn.onclick = function () {
          api('/admin/api/theme/library/apply', { id: btn.dataset.libApply }).then(function (d2) {
            if (d2.ok) {
              setStatus('th-lib-status', 'הוחלה "' + d2.name + '"' + (d2.backedUp ? ' · העבודה הקודמת גובתה אוטומטית' : '') + rebuildNote(d2) + ' — טוען מחדש…', !d2.rebuildError);
              setTimeout(function () { location.reload(); }, 700);
            } else setStatus('th-lib-status', d2.error || 'שגיאה', false);
          });
        };
      });
      list.querySelectorAll('[data-lib-remove]').forEach(function (btn) {
        btn.onclick = function () {
          if (!confirm('למחוק את הערכה מהספרייה? (האתר החי לא מושפע)')) return;
          api('/admin/api/theme/library/remove', { id: btn.dataset.libRemove }).then(function (d2) {
            if (d2.ok) renderLibrary();
            else setStatus('th-lib-status', d2.error || 'שגיאה', false);
          });
        };
      });
    }).catch(function () { setStatus('th-lib-status', 'שגיאת רשת', false); });
  }

  var libSave = $('th-lib-save');
  if (libSave) libSave.onclick = function () {
    var name = ($('th-lib-name') || {}).value || '';
    api('/admin/api/theme/library', { name: name }).then(function (d) {
      if (d.ok) {
        setStatus('th-lib-status', 'נשמרה "' + d.name + '" ✓', true);
        var nameEl = $('th-lib-name');
        if (nameEl) nameEl.value = '';
        renderLibrary();
      } else setStatus('th-lib-status', d.error || 'שגיאה', false);
    }).catch(function () { setStatus('th-lib-status', 'שגיאת רשת', false); });
  };

  renderLibrary();

  // ── The AI DESIGNER (v2.24) — a theme from the owner's imagination ──
  function designReply() {
    return (($('th-design-reply') || {}).value || '').trim();
  }
  function designBrief() {
    return (($('th-design-brief') || {}).value || '').trim();
  }
  var toBench = $('th-design-to-bench');
  /** A refused paste: a PAGE gets the bench button, everything else the message. */
  function designRefused(d) {
    setStatus('th-design-status', d.error || 'שגיאה', false);
    if (toBench) toBench.hidden = d.code !== 'PAGE_NOT_THEME';
    showWarnings('th-design-warn', []);
  }
  if (toBench) toBench.onclick = function () {
    if (!designReply()) return;
    toBench.hidden = true;
    benchOp({ op: 'append-source', source: designReply() }).then(function (d) {
      if (d && d.ok) {
        setStatus('th-design-status', 'המודולים עלו לקנבס (' + d.count + ') ✓ — לערכה עצמה, בקשו בצ׳אט חדש עם פרומפט המעצב/ת', true);
        var c = $('th-canvas-card');
        if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };
  var designPrompt = $('th-design-prompt');
  if (designPrompt) designPrompt.onclick = function () {
    var q = new URLSearchParams({ brief: designBrief() });
    if (($('th-design-current') || {}).checked) q.set('current', '1');
    setStatus('th-design-status', 'בונה את הפרומפט…');
    fetch('/admin/api/theme/design-prompt?' + q.toString())
      .then(function (r) { return r.text(); })
      .then(function (text) {
        return navigator.clipboard.writeText(text).then(function () {
          var kb = (text.length / 1000).toFixed(1);
          setStatus('th-design-status', '✅ הפרומפט הועתק (' + kb + 'K תווים) — הדביקו בצ׳אט חדש (FRESH), ואת התשובה הדביקו כאן למטה', true);
        });
      })
      .catch(function () { setStatus('th-design-status', 'שגיאה בהעתקה', false); });
  };

  var designPreview = $('th-design-preview');
  if (designPreview) designPreview.onclick = function () {
    if (!designReply()) return setStatus('th-design-status', 'הדביקו קודם את תשובת ה-AI', false);
    if (toBench) toBench.hidden = true;
    canvasShow('תשובת ה-AI (לא נשמרה)', { reply: designReply(), name: designBrief().slice(0, 60), bench: !!(($('th-design-bench') || {}).checked) }).then(function (d) {
      if (d && d.ok) {
        showWarnings('th-design-warn', d.warnings);
        setStatus('th-design-status', 'הערכה "' + (d.name || '') + '" מוצגת בקנבס ↑ — אהבתם? שמרו לספרייה או החילו. לא? שנו את התיאור, צרו פרומפט חדש וחזרו.' + warnNote(d), true);
        var c = $('th-canvas-card');
        if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (d) designRefused(d);
    });
  };

  function designSave(apply) {
    if (!designReply()) return setStatus('th-design-status', 'הדביקו קודם את תשובת ה-AI', false);
    setStatus('th-design-status', apply ? 'שומר ומחיל…' : 'שומר לספרייה…');
    if (toBench) toBench.hidden = true;
    var takeBench = !!(($('th-design-bench') || {}).checked);
    api('/admin/api/theme/design/paste', { reply: designReply(), name: designBrief().slice(0, 60), apply: !!apply, bench: takeBench }).then(function (d) {
      if (!d.ok) return designRefused(d);
      showWarnings('th-design-warn', d.warnings);
      var what = 'הערכה "' + d.name + '" נשמרה לספרייה ✓ (' + (d.sections || []).join(', ') +
        (d.parts && d.parts.cssChars ? ' · עור ' + d.parts.cssChars + ' תווים' : '') +
        (d.parts && d.parts.jsChars ? ' · אפקט ' + d.parts.jsChars + ' תווים' : '') +
        (d.parts && d.parts.bent ? ' · ‎.bent' : '') + ')' +
        (d.benchCount != null ? ' · הקנבס התמלא ב-' + d.benchCount + ' מודולים' : (d.benchError ? ' · הקנבס של ה-AI לא התקמפל (' + d.benchError + ') — הערכה נשמרה בלעדיו' : (d.hasSpecimen ? ' · (הקנבס של ה-AI נשמר עם הערכה)' : ''))) + warnNote(d);
      if (d.benchCount != null) fetch('/admin/api/theme/canvas').then(function (r) { return r.json(); }).then(function (c) { if (c.ok) renderBench(c); }).catch(function () {});
      if (d.applied) {
        setStatus('th-design-status', what + ' — והוחלה על האתר' + (d.backedUp ? ' (העבודה הקודמת גובתה)' : '') + rebuildNote(d) + ' — טוען מחדש…', !d.rebuildError);
        setTimeout(function () { location.reload(); }, d.warnings && d.warnings.length ? 3000 : 900);
      } else {
        setStatus('th-design-status', what + ' — "החל" בספרייה כשתרצו', true);
        renderLibrary();
      }
    }).catch(function () { setStatus('th-design-status', 'שגיאת רשת', false); });
  }
  var designSaveBtn = $('th-design-save');
  if (designSaveBtn) designSaveBtn.onclick = function () { designSave(false); };
  var designApplyBtn = $('th-design-apply');
  if (designApplyBtn) designApplyBtn.onclick = function () {
    if (!confirm('לשמור את הערכה לספרייה ולהחיל אותה על האתר החי? (המצב הנוכחי יגובה אוטומטית)')) return;
    designSave(true);
  };

  // ── Theme EFFECTS (v2.22) — the FRESH-chat snippet flow ──
  function fxCurrent() {
    var el = $('th-fx-current');
    if (!el) return;
    fetch('/admin/api/theme').then(function (r) { return r.json(); }).then(function (d) {
      var fx = (d.overrides || {}).effects || {};
      var has = (fx.css || '').trim() || (fx.js || '').trim();
      el.textContent = has
        ? '✨ אפקט פעיל' + (fx.note ? ': ' + fx.note : '') +
          ' (CSS ' + (fx.css || '').length + ' תווים · JS ' + (fx.js || '').length + ' תווים) — רץ בתוך השומר'
        : 'אין אפקט פעיל כרגע.';
    }).catch(function () {});
  }

  var fxPrompt = $('th-fx-prompt');
  if (fxPrompt) fxPrompt.onclick = function () {
    var brief = ($('th-fx-brief') || {}).value || '';
    fetch('/admin/api/theme/effects-prompt?brief=' + encodeURIComponent(brief))
      .then(function (r) { return r.text(); })
      .then(function (text) {
        return navigator.clipboard.writeText(text).then(function () {
          setStatus('th-fx-status', '✅ הפרומפט הועתק — הדביקו בצ׳אט חדש (FRESH), לא בצ׳אט של בניית הדפים', true);
        });
      })
      .catch(function () { setStatus('th-fx-status', 'שגיאה בהעתקה', false); });
  };

  var fxApply = $('th-fx-apply');
  if (fxApply) fxApply.onclick = function () {
    var reply = ($('th-fx-reply') || {}).value || '';
    var note = ($('th-fx-brief') || {}).value || '';
    setStatus('th-fx-status', 'מקמפל וקולט…');
    api('/admin/api/theme/effects/paste', { reply: reply, note: note }).then(function (d) {
      if (d.ok) {
        showWarnings('th-fx-warn', d.warnings);
        setStatus('th-fx-status', 'נקלט ✓ (CSS ' + d.cssChars + ' · JS ' + d.jsChars + ' תווים) — האפקט חי בכל דף; הקנבס למעלה מריץ אותו עכשיו' + rebuildNote(d) + warnNote(d), !d.rebuildError);
        var ta = $('th-fx-reply');
        if (ta) ta.value = '';
        fxCurrent();
        // the live theme now carries the effect; the canvas proves it runs
        canvasShow('הערכה החיה + האפקט החדש', {}).then(function () {
          var c = $('th-canvas-card');
          if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } else setStatus('th-fx-status', d.error || 'שגיאה', false);
    }).catch(function () { setStatus('th-fx-status', 'שגיאת רשת', false); });
  };

  var fxClear = $('th-fx-clear');
  if (fxClear) fxClear.onclick = function () {
    if (!confirm('לנקות את האפקט מהאתר? (ערכות שמורות בספרייה שומרות את שלהן)')) return;
    api('/admin/api/theme/effects', { css: '', js: '', note: '' }).then(function (d) {
      if (d.ok) { showWarnings('th-fx-warn', []); setStatus('th-fx-status', 'נוקה ✓' + rebuildNote(d), !d.rebuildError); fxCurrent(); canvasShow('הערכה החיה', {}); }
      else setStatus('th-fx-status', d.error || 'שגיאה', false);
    }).catch(function () { setStatus('th-fx-status', 'שגיאת רשת', false); });
  };

  fxCurrent();
  refreshNavFit();
  renderLooks();
  // the canvas opens on the live theme (what the form holds right now)
  canvasShow('הערכה החיה', {});
})();
