// Theme studio — looks, the live canvas, the AI designer, save helpers
// (loaded by /admin/theme). v2.24: the fake preview card became a CANVAS —
// the real site rendered with whatever is being tried, before it is saved.
(function () {
  var colorKeys = ['primary', 'secondary', 'text', 'muted', 'border', 'bg', 'lightBg', 'surface'];
  var formIds = ['th-title', 'th-font', 'th-font-heading', 'th-font-google', 'th-font-size', 'th-maxw', 'th-menu-place',
    'th-logo-type', 'th-logo-text', 'th-logo-image', 'th-desc', 'th-radius', 'th-shadow', 'th-accent', 'th-buttons',
    'th-bg-kind', 'th-bg-angle', 'th-ch-hover', 'th-ch-hovercolor', 'th-ch-weight', 'th-ch-glass', 'th-ch-headerbg',
    'th-ch-headertext', 'th-ch-footerbg', 'th-ch-footertext', 'th-skin-note', 'th-skin-css'];

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
          menuPlacement: val('th-menu-place', 'top') || 'top'
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
          footerText: val('th-ch-footertext')
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
      if (!d.ok) { setStatus('th-canvas-status', d.error || 'שגיאה בתצוגה', false); return; }
      lastPreviewId = d.id;
      var src = previewSrc(d.id);
      canvas.src = src;
      var open = $('th-canvas-open');
      if (open) open.href = src;
      var lbl = $('th-canvas-label');
      if (lbl) lbl.textContent = 'מציג: ' + label + (d.fonts && d.fonts.length ? ' · גופנים: ' + d.fonts.join(', ') : '');
      setStatus('th-canvas-status', d.hasEffect ? 'טוען… (הערכה כוללת אפקט — נבדוק שהוא רץ)' : 'הערכה הזו בלי אפקט JS.');
      return d;
    }).catch(function () { setStatus('th-canvas-status', 'שגיאת רשת בתצוגה', false); });
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      canvasShow('הטופס (לא נשמר)', { overrides: payload().overrides });
    }, 450);
  }

  // the framed page reports: did the effect run, did anything throw
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'tapuz-theme-preview') return;
    var d = ev.data;
    if (d.errors && d.errors.length) {
      setStatus('th-canvas-status', '❌ שגיאה בדף/באפקט: ' + d.errors.join(' · ') + ' — בקשו מהצ׳אט לתקן', false);
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
    if (on) {
      wrap.style.cssText += ';position:fixed;inset:0;z-index:9999;border-radius:0;padding:8px;background:#0f172a';
      canvas.style.width = '100%'; canvas.style.height = 'calc(100vh - 16px)';
      if (full) full.textContent = '✕';
    } else {
      wrap.style.position = ''; wrap.style.inset = ''; wrap.style.zIndex = ''; wrap.style.borderRadius = ''; wrap.style.padding = ''; wrap.style.background = '';
      canvas.style.width = '100%'; canvas.style.height = '640px';
      if (full) full.textContent = '⛶';
    }
  }
  if (full) full.onclick = function () { setFull(!isFull); };
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && isFull) setFull(false); });
  if (mob) mob.onclick = function () { if (canvas) { canvas.style.width = '390px'; canvas.style.height = '700px'; } };

  // ── The BENCH (v2.25) — modules on the theme canvas ──
  function benchStatus(msg, ok) { setStatus('th-bench-status', msg, ok); }
  function renderBench(d) {
    var list = $('th-bench-list');
    var count = $('th-bench-count');
    if (!list) return;
    var mods = d.modules || [];
    var total = 0;
    mods.forEach(function (m) { total += m.row ? m.columns.reduce(function (n, c) { return n + c.length; }, 0) : 1; });
    if (count) count.textContent = mods.length ? total + ' מודולים' + (mods.some(function (m) { return m.row; }) ? ' · ' + mods.filter(function (m) { return m.row; }).length + ' שורות' : '') : 'ריק — קנבס של כלום';
    var chip = function (m, i, n, inCell) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;border:1px solid #cbd5e1;border-radius:999px;padding:3px 6px 3px 10px;font-size:0.8rem;background:#fff">' +
        esc(m.icon ? m.icon + ' ' : '') + esc(m.label) +
        (i > 0 ? '<button type="button" data-bench-move="' + esc(m.id) + '" data-dir="up" title="' + (inCell ? 'למעלה בתא' : 'למעלה') + '" style="border:none;background:none;cursor:pointer;padding:0 2px">↑</button>' : '') +
        (i < n - 1 ? '<button type="button" data-bench-move="' + esc(m.id) + '" data-dir="down" title="' + (inCell ? 'למטה בתא' : 'למטה') + '" style="border:none;background:none;cursor:pointer;padding:0 2px">↓</button>' : '') +
        '<button type="button" data-bench-remove="' + esc(m.id) + '" title="הסר מהקנבס" style="border:none;background:none;cursor:pointer;color:#b91c1c;padding:0 2px">✕</button></span>';
    };
    list.style.flexDirection = 'column';
    list.style.alignItems = 'stretch';
    list.innerHTML = mods.map(function (m, i) {
      if (!m.row) return '<div style="display:flex;gap:6px;flex-wrap:wrap">' + chip(m, i, mods.length, false) + '</div>';
      // a ROW: its cells side by side, each a drop target for the palette or a paste
      var cells = m.columns.map(function (cell, ci) {
        return '<div style="flex:1;min-width:0;border:1px dashed #94a3b8;border-radius:8px;padding:6px;background:#f8fafc;display:flex;flex-direction:column;gap:4px">' +
          '<div style="font-size:0.7rem;color:#64748b;display:flex;justify-content:space-between;align-items:center"><span>עמודה ' + (ci + 1) + '</span>' +
          '<span><button type="button" data-cell-add="' + esc(m.id) + '" data-col="' + ci + '" title="הוסף לתא את המודול שנבחר בארגז" style="border:none;background:none;cursor:pointer;color:#166534;font-weight:700">➕</button>' +
          '<button type="button" data-cell-paste="' + esc(m.id) + '" data-col="' + ci + '" title="הדבק לתא את ה-BenTML מהתיבה למטה" style="border:none;background:none;cursor:pointer;color:#1d4ed8">📥</button></span></div>' +
          (cell.length ? cell.map(function (x, xi) { return chip(x, xi, cell.length, true); }).join('') : '<span style="font-size:0.72rem;color:#94a3b8">ריק</span>') +
          '</div>';
      }).join('');
      return '<div style="border:1.5px solid #cbd5e1;border-radius:10px;padding:8px;background:#fff">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:0.8rem"><strong>▦ ' + esc(m.label) + '</strong><span style="flex:1"></span>' +
        (i > 0 ? '<button type="button" data-bench-move="' + esc(m.id) + '" data-dir="up" title="שורה למעלה" style="border:none;background:none;cursor:pointer">↑</button>' : '') +
        (i < mods.length - 1 ? '<button type="button" data-bench-move="' + esc(m.id) + '" data-dir="down" title="שורה למטה" style="border:none;background:none;cursor:pointer">↓</button>' : '') +
        '<button type="button" data-bench-remove="' + esc(m.id) + '" title="הסר את השורה כולה" style="border:none;background:none;cursor:pointer;color:#b91c1c">✕</button></div>' +
        '<div style="display:flex;gap:6px">' + cells + '</div></div>';
    }).join('');
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
    api('/admin/api/theme/canvas', body).then(function (d) {
      if (!d.ok) return benchStatus(d.error || 'שגיאה', false);
      renderBench(d);
      var w = d.warnings && d.warnings.length ? ' · תוקן: ' + d.warnings.slice(0, 2).join(' | ') : '';
      benchStatus((d.added ? 'נוספו ' + d.added + ' · ' : '') + 'על הקנבס עכשיו ' + d.count + ' מודולים ✓' + w, true);
      reloadBench();
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
    var skin = Object.assign({ css: '', note: '' }, o.skin || {});
    setValue('th-skin-css', skin.css);
    setValue('th-skin-note', skin.note);
    clearTimeout(previewTimer);
    canvasShow('מראה "' + (look.label || '') + '" (לא נשמר)', { overrides: payload().overrides });
  }

  function renderLooks() {
    var host = $('th-looks');
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
      var extras = [];
      if ((look.overrides.fonts || {}).google && look.overrides.fonts.google.length) extras.push('גופן');
      if ((look.overrides.background || {}).kind && look.overrides.background.kind !== 'solid') extras.push('רקע');
      if ((look.overrides.skin || {}).css) extras.push('עור');
      card.innerHTML =
        '<div style="font-size:1.5rem;line-height:1">' + (look.emoji || '🎨') + '</div>' +
        '<div style="font-weight:700;margin:6px 0 8px;color:' + (c.text || '#111') + '">' + look.label + '</div>' +
        '<div>' + dots + '</div>' +
        (extras.length ? '<div style="font-size:.7rem;color:' + (c.muted || '#64748b') + ';margin-top:6px">' + extras.join(' · ') + '</div>' : '');
      card.addEventListener('mouseenter', function () { card.style.borderColor = '#94a3b8'; card.style.transform = 'translateY(-2px)'; });
      card.addEventListener('mouseleave', function () { card.style.borderColor = '#e2e8f0'; card.style.transform = 'none'; });
      card.addEventListener('click', function () { applyLook(look); });
      host.appendChild(card);
    });
  }

  // ── save ──────────────────────────────────────────────────────────
  function save(thenBuild) {
    setStatus('th-save-status', 'שומר…');
    api('/admin/api/theme', payload()).then(function (d) {
      if (!d.ok) return setStatus('th-save-status', d.error || 'שגיאה', false);
      // every save rebuilds the site on the server (the live pages are the
      // static export, served before the renderer — a save that did not
      // rebuild changed nothing anyone could see). "שמור + בנה" keeps its
      // explicit rebuild and opens the site so the change is in front of you.
      if (thenBuild) {
        return fetch('/admin/build', { method: 'POST' }).then(function (r) { return r.json(); }).then(function () {
          setStatus('th-save-status', 'נשמר ונבנה ✓' + rebuildNote(d), !d.rebuildError);
          window.open('/', '_blank');
        });
      }
      setStatus('th-save-status', 'נשמר ✓ — האתר עודכן' + rebuildNote(d), !d.rebuildError);
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
    overrides.layout = { maxWidth: '900px', menuPlacement: 'top' };
    overrides.background = { kind: 'solid', angle: 160 };
    overrides.skin = { css: '', note: '' };
    api('/admin/api/theme', { overrides: overrides }).then(function () { location.reload(); });
  };

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
      if (d && d.ok) setStatus('th-import-status', 'מוצג בקנבס למעלה ↑', true);
      else if (d) setStatus('th-import-status', d.error || 'שגיאה', false);
    });
  };
  var importBtn = $('th-import-apply');
  if (importBtn) importBtn.onclick = function () {
    if (!importText()) return setStatus('th-import-status', 'אין מה לייבא — הדביקו או בחרו קובץ', false);
    api('/admin/api/theme/import', { text: importText() }).then(function (d) {
      if (d.ok) {
        setStatus('th-import-status', 'הוחל ✓' + rebuildNote(d) + ' — טוען מחדש…', !d.rebuildError);
        setTimeout(function () { location.reload(); }, 700);
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
        setStatus('th-import-status', 'נשמרה לספרייה כ-"' + d.name + '" ✓ (האתר החי לא השתנה)', true);
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
        var dots = (t.palette || []).map(function (c) {
          return '<span style="display:inline-block;width:18px;height:18px;border-radius:50%;border:1px solid #e2e8f0;background:' + esc(c) + '"></span>';
        }).join('');
        var srcLabel = t.source === 'ai' ? '🤖 נבנה עם AI' : t.source === 'import' ? '📦 יובא' : t.source === 'auto' ? '⏪ גיבוי אוטומטי' : t.source === 'preset' ? '🎨 ערכה מובנית' : '✋ נשמר ידנית';
        return '<div style="border:1.5px solid #e2e8f0;border-radius:10px;padding:12px" data-thm="' + esc(t.id) + '">' +
          '<div style="font-weight:700;margin-bottom:4px">' + esc(t.name) + '</div>' +
          '<div style="display:flex;gap:5px;margin-bottom:6px">' + dots + '</div>' +
          '<div style="font-size:0.75rem;color:#64748b;margin-bottom:10px">' + srcLabel + '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          '<button type="button" class="btn secondary" data-lib-preview="' + esc(t.id) + '" data-lib-name="' + esc(t.name) + '" style="font-size:0.82rem;padding:6px 10px" title="הצג בקנבס בלי לשנות כלום">👁</button>' +
          '<button type="button" class="btn" data-lib-apply="' + esc(t.id) + '" style="font-size:0.82rem;padding:6px 10px">החל</button>' +
          '<a class="btn secondary" href="/admin/api/theme/library/export?id=' + encodeURIComponent(t.id) + '" download style="font-size:0.82rem;padding:6px 10px">ייצוא</a>' +
          '<button type="button" class="btn secondary" data-lib-remove="' + esc(t.id) + '" style="font-size:0.82rem;padding:6px 10px">מחיקה</button>' +
          '</div></div>';
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
    canvasShow('תשובת ה-AI (לא נשמרה)', { reply: designReply(), name: designBrief().slice(0, 60) }).then(function (d) {
      if (d && d.ok) {
        setStatus('th-design-status', 'הערכה "' + (d.name || '') + '" מוצגת בקנבס ↑ — אהבתם? שמרו לספרייה או החילו. לא? שנו את התיאור, צרו פרומפט חדש וחזרו.', true);
        var c = $('th-canvas-card');
        if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (d) setStatus('th-design-status', d.error || 'שגיאה', false);
    });
  };

  function designSave(apply) {
    if (!designReply()) return setStatus('th-design-status', 'הדביקו קודם את תשובת ה-AI', false);
    setStatus('th-design-status', apply ? 'שומר ומחיל…' : 'שומר לספרייה…');
    api('/admin/api/theme/design/paste', { reply: designReply(), name: designBrief().slice(0, 60), apply: !!apply }).then(function (d) {
      if (!d.ok) return setStatus('th-design-status', d.error || 'שגיאה', false);
      var what = 'הערכה "' + d.name + '" נשמרה לספרייה ✓ (' + (d.sections || []).join(', ') +
        (d.parts && d.parts.cssChars ? ' · עור ' + d.parts.cssChars + ' תווים' : '') +
        (d.parts && d.parts.jsChars ? ' · אפקט ' + d.parts.jsChars + ' תווים' : '') + ')';
      if (d.applied) {
        setStatus('th-design-status', what + ' — והוחלה על האתר' + (d.backedUp ? ' (העבודה הקודמת גובתה)' : '') + rebuildNote(d) + ' — טוען מחדש…', !d.rebuildError);
        setTimeout(function () { location.reload(); }, 900);
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
          ' (CSS ' + (fx.css || '').length + ' תווים · JS ' + (fx.js || '').length + ' תווים)'
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
        setStatus('th-fx-status', 'נקלט ✓ (CSS ' + d.cssChars + ' · JS ' + d.jsChars + ' תווים) — האפקט חי בכל דף; הקנבס למעלה מריץ אותו עכשיו' + rebuildNote(d), !d.rebuildError);
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
      if (d.ok) { setStatus('th-fx-status', 'נוקה ✓' + rebuildNote(d), !d.rebuildError); fxCurrent(); canvasShow('הערכה החיה', {}); }
      else setStatus('th-fx-status', d.error || 'שגיאה', false);
    }).catch(function () { setStatus('th-fx-status', 'שגיאת רשת', false); });
  };

  fxCurrent();
  renderLooks();
  // the canvas opens on the live theme (what the form holds right now)
  canvasShow('הערכה החיה', {});
})();
