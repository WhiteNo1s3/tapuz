/* The injection card (v2.28) — one client for every pack in src/injections.
   TapuzInjectCard.mount(el, id, { onApplied, onPreview }) → { destroy() }

   Mounted by /admin/menus (the organizer), /admin/inject (the packs grid)
   and whoever comes next. The card talks ONLY to /admin/api/inject/:id/*
   and /admin/api/ai/settings; it never builds HTML from model text — every
   string the model wrote reaches the page through textContent.

   The flow the card enforces (0.9 in the plan): a reply is PREVIEWED first
   (/paste, never writes), and "החל" is enabled only while the textarea still
   holds exactly the text that was previewed. Run (/run) drops its reply into
   the same textarea and previews it — so apply is always a second, explicit
   click on text the owner has seen. Plain browser JS, no build step. */
(function (global) {
  'use strict';

  var RUNNABLE = { claude: true, openai: true, local: true, browser: true };

  /** The browser relay can only run where the bridge actually answered: the
   *  Bridge V2 extension must be installed AND this site connected in it.
   *  admin-bridge.js flips `present` when the content script says hello. */
  function bridgeReady() {
    return !!(global.TapuzBridge && global.TapuzBridge.present);
  }
  var packsPromise = null;
  var settingsPromise = null;

  function loadPacks() {
    if (!packsPromise) {
      packsPromise = fetch('/admin/api/inject', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) { return (d && d.packs) || []; })
        .catch(function () { packsPromise = null; return []; });
    }
    return packsPromise;
  }

  // the AI setup screen's own endpoint — an editor gets 403 there, which the
  // card reads as "no connected model": the run button simply stays hidden
  function loadSettings() {
    if (!settingsPromise) {
      settingsPromise = fetch('/admin/api/ai/settings', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { ok: false }; })
        .catch(function () { return { ok: false }; });
    }
    return settingsPromise;
  }

  function canRun(settings, pack) {
    if (!(settings && settings.ok && RUNNABLE[settings.provider] && pack && pack.run && pack.run.enabled)) return false;
    // a hosted site + the owner's own model = the bridge, and only when it is there
    if (settings.provider === 'browser') return bridgeReady();
    return !!(settings.hasKey || settings.provider === 'local');
  }

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function fmtK(n) { return (Number(n || 0) / 1000).toFixed(1) + 'K תווים'; }

  function fmtElapsed(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function postJson(path, body, signal) {
    return fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
      signal: signal
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: r.statusText || 'שגיאה' }; })
        .then(function (json) { return { status: r.status, json: json || {} }; });
    });
  }

  // one stylesheet for every card on the page — logical properties only
  function ensureCss() {
    if (document.getElementById('tapuz-inject-card-css')) return;
    var st = h('style');
    st.id = 'tapuz-inject-card-css';
    st.textContent = [
      '.inject-card { display:flex; flex-direction:column; gap:10px; }',
      '.inject-card .inject-head h3 { margin:0 0 4px; }',
      '.inject-card textarea { width:100%; box-sizing:border-box; min-height:72px; }',
      '.inject-card textarea.inject-reply { min-height:160px; }',
      '.inject-card .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }',
      '.inject-card .check-row { margin-bottom:0; }',
      '.inject-card .inject-status { font-size:.85rem; }',
      '.inject-card .inject-timer { font-variant-numeric:tabular-nums; font-weight:700; }',
      '.inject-card .notice { margin:0; }',
      '.inject-card .inject-preview:empty { display:none; }',
      '.inject-card .inject-preview { border:1px solid var(--ws-border, #e2e8f0); border-radius:10px; padding:12px 14px; background:var(--ws-well, #f8fafc); }',
      '.inject-card .inject-note { margin:0 0 8px; font-weight:600; }',
      '.inject-card .inject-fit { margin:0 0 8px; font-size:.88rem; }',
      '.inject-card .inject-menu-name { margin:10px 0 4px; font-size:.92rem; }',
      '.inject-card .inject-menu-name small { color:var(--ws-muted, #64748b); font-weight:400; }',
      '.inject-card ul.inject-tree { list-style:none; margin:0; padding-inline-start:0; }',
      '.inject-card ul.inject-tree ul.inject-tree { padding-inline-start:18px; border-inline-start:1px dashed var(--ws-border, #e2e8f0); margin-inline-start:6px; }',
      '.inject-card .inject-tree li { padding:2px 0; font-size:.9rem; }',
      '.inject-card .inject-tree li[data-status="dropped"] { color:#b91c1c; text-decoration:line-through; }',
      '.inject-card .inject-tree li[data-status="draft"] { color:#92400e; }',
      '.inject-card .inject-tree li[data-status="group"] > .inject-label { font-weight:700; }',
      '.inject-card .inject-mark { display:inline-block; min-width:1.2em; }',
      '.inject-card .inject-tree small { color:var(--ws-faint, #94a3b8); font-size:.75rem; margin-inline-start:6px; }',
      '.inject-card .inject-diff { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0; }',
      '.inject-card .inject-knobs { margin:6px 0; padding-inline-start:18px; font-size:.88rem; }',
      '.inject-card .inject-frame { width:100%; height:260px; border:1px solid var(--line, #ddd); border-radius:8px; background:#fff; margin-top:8px; }',
      '.inject-card .inject-prompt-fallback { margin-top:6px; }',
      '.inject-card .inject-prompt-fallback textarea { min-height:120px; direction:rtl; }',
      '.inject-card .inject-hidden { display:none !important; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ── the generic preview: the JSON contract → DOM, no innerHTML ──────
  var MARK = { ok: '✓', draft: '⚠', dropped: '✗', group: '▸' };

  function renderTree(items) {
    var ul = h('ul', 'inject-tree');
    (items || []).forEach(function (it) {
      it = it || {};
      var li = h('li');
      li.setAttribute('data-status', it.status || '');
      li.appendChild(h('span', 'inject-mark', MARK[it.status] || '·'));
      li.appendChild(document.createTextNode(' '));
      li.appendChild(h('span', 'inject-label', it.label || ''));
      if (it.url) {
        var small = h('small', null, it.url);
        small.dir = 'ltr';
        li.appendChild(small);
      }
      if (it.children && it.children.length) li.appendChild(renderTree(it.children));
      ul.appendChild(li);
    });
    return ul;
  }

  function pill(kind, text) { return h('span', 'pill ' + kind, text); }

  function renderDiff(d) {
    var strip = h('div', 'inject-diff');
    (d.added || []).forEach(function (l) { strip.appendChild(pill('ok', '+ ' + l)); });
    (d.removed || []).forEach(function (l) { strip.appendChild(pill('danger', '− ' + l)); });
    (d.moved || []).forEach(function (l) { strip.appendChild(pill('info', '↕ ' + l)); });
    (d.relabeled || []).forEach(function (pair) {
      pair = pair || [];
      strip.appendChild(pill('warn', String(pair[0] || '') + ' → ' + String(pair[1] || '')));
    });
    return strip.childNodes.length ? strip : null;
  }

  function renderPreview(box, preview) {
    // v2.43: the copilot's menu canvas calls this WITHOUT mounting a card
    // (public/admin-chat.js) — one renderer for the organizer's preview on
    // both screens — so the stylesheet cannot wait for mount(). Idempotent.
    ensureCss();
    clear(box);
    var p = preview && typeof preview === 'object' ? preview : {};
    if (p.name) box.appendChild(h('p', 'inject-note', '🎨 ' + p.name));
    if (p.note) box.appendChild(h('p', 'inject-note', p.note));
    if (p.fitLine) box.appendChild(h('p', 'inject-fit', p.fitLine));
    if (p.menus && typeof p.menus === 'object') {
      Object.keys(p.menus).forEach(function (name) {
        var m = p.menus[name] || {};
        var head = h('h4', 'inject-menu-name', name);
        if (m.location) head.appendChild(h('small', null, ' (' + m.location + ')'));
        box.appendChild(head);
        box.appendChild(renderTree(m.tree));
        var d = p.diff && p.diff[name];
        if (d) { var strip = renderDiff(d); if (strip) box.appendChild(strip); }
      });
    }
    if (p.knobs && p.knobs.changed && p.knobs.changed.length) {
      var ul = h('ul', 'inject-knobs');
      p.knobs.changed.forEach(function (k) {
        k = k || {};
        var li = h('li');
        li.appendChild(h('code', null, k.key || ''));
        li.appendChild(document.createTextNode(': ' + String(k.from == null ? '—' : k.from) + ' → '));
        li.appendChild(h('strong', null, String(k.to == null ? '—' : k.to)));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    if (p.sections && p.sections.length) {
      var sec = h('div', 'inject-diff');
      p.sections.forEach(function (s) { sec.appendChild(pill('accent', s)); });
      box.appendChild(sec);
    }
    if (p.previewUrl || p.previewHtml) {
      var frame = h('iframe', 'inject-frame');
      frame.title = 'תצוגה מקדימה';
      // same-origin so the page's own fonts/css load; no scripts — the
      // candidate's effect JS must never run inside the admin
      frame.setAttribute('sandbox', 'allow-same-origin');
      if (p.previewUrl) frame.src = String(p.previewUrl);
      else frame.srcdoc = String(p.previewHtml);
      box.appendChild(frame);
    }
  }

  function renderWarnings(ul, warnings, texts) {
    clear(ul);
    var list = Array.isArray(warnings) && warnings.length
      ? warnings.map(function (w) { return w && w.message ? String(w.message) : String(w); })
      : (Array.isArray(texts) ? texts.map(String) : []);
    list.forEach(function (t) { ul.appendChild(h('li', null, t)); });
    ul.hidden = !list.length;
  }

  // ── the card ────────────────────────────────────────────────────────
  function mount(el, id, opts) {
    opts = opts || {};
    ensureCss();
    var root = h('div', 'inject-card');
    root.setAttribute('data-inject-card', id);
    el.appendChild(root);

    var state = { pack: null, settings: null, lastPreviewed: null, lastPrompt: '', timer: null, ctrl: null, destroyed: false, applied: false };

    // header
    var head = h('div', 'inject-head');
    var title = h('h3', 'sub-head', '…');
    var blurb = h('p', 'muted', '');
    head.appendChild(title);
    head.appendChild(blurb);
    root.appendChild(head);

    // 1 · the brief + size
    var briefLabel = h('label', 'field-label', 'מה לבקש מה-AI? (לא חובה)');
    var brief = h('textarea', 'input');
    brief.rows = 3;
    root.appendChild(briefLabel);
    root.appendChild(brief);

    var sizeRow = h('label', 'check-row');
    var lite = h('input');
    lite.type = 'checkbox';
    lite.checked = true; // lite by default — the free chats' message cap
    sizeRow.appendChild(lite);
    sizeRow.appendChild(h('span', null, 'לייט לצ׳אט חינמי'));
    var sizeHint = h('span', 'faint', ' — חבילה קצרה שנכנסת בהודעה אחת; בטלו לחבילה המלאה');
    sizeRow.appendChild(sizeHint);
    root.appendChild(sizeRow);

    // 2 · the prompt / the run
    var row1 = h('div', 'row');
    var btnCopy = h('button', 'btn', '🧠 צור פרומפט והעתק');
    btnCopy.type = 'button';
    var btnRun = h('button', 'btn secondary inject-hidden', '▶ הרץ עם ה-AI המחובר');
    btnRun.type = 'button';
    var btnJob = h('button', 'btn secondary inject-hidden', '🛠 שלחו לעובד שלכם');
    btnJob.type = 'button';
    btnJob.title = 'מריץ על המחשב שלכם ברקע — אפשר לסגור את הדף ולחזור אחר כך';
    var btnCancel = h('button', 'btn secondary sm inject-hidden', '✖ בטל');
    btnCancel.type = 'button';
    var status = h('span', 'muted inject-status', '');
    var timer = h('span', 'inject-timer', '');
    row1.appendChild(btnCopy);
    row1.appendChild(btnRun);
    row1.appendChild(btnJob);
    row1.appendChild(btnCancel);
    row1.appendChild(status);
    row1.appendChild(timer);
    root.appendChild(row1);
    var runHint = h('p', 'faint inject-hidden', '');
    root.appendChild(runHint);
    var promptFallback = h('div', 'inject-prompt-fallback inject-hidden');
    root.appendChild(promptFallback);

    // 3 · the reply
    root.appendChild(h('label', 'field-label', 'תשובת ה-AI'));
    var reply = h('textarea', 'input code-area inject-reply');
    reply.placeholder = 'הדביקו כאן את תשובת ה-AI (או הריצו למעלה — התשובה תנחת כאן)';
    root.appendChild(reply);

    var row2 = h('div', 'row');
    var btnPreview = h('button', 'btn secondary', '👁 תצוגה מקדימה');
    btnPreview.type = 'button';
    var btnApply = h('button', 'btn', '✅ החל');
    btnApply.type = 'button';
    btnApply.disabled = true;
    var btnUndo = h('button', 'btn secondary sm', '↩ בטל החלה אחרונה');
    btnUndo.type = 'button';
    row2.appendChild(btnPreview);
    row2.appendChild(btnApply);
    row2.appendChild(btnUndo);
    root.appendChild(row2);

    var notice = h('div', 'notice inject-hidden');
    root.appendChild(notice);
    var warn = h('ul', 'studio-warn');
    warn.hidden = true;
    root.appendChild(warn);
    var previewBox = h('div', 'inject-preview');
    root.appendChild(previewBox);

    // ── helpers bound to this card ──
    function setStatus(text, cls) {
      status.textContent = text || '';
      status.className = 'inject-status ' + (cls || 'muted');
    }
    function say(kind, text, linkHref, linkText) {
      clear(notice);
      notice.className = 'notice ' + kind;
      var body = h('div', 'notice-body');
      body.appendChild(h('span', null, text));
      if (linkHref) {
        body.appendChild(document.createTextNode(' '));
        var a = h('a', null, linkText || linkHref);
        a.href = linkHref;
        body.appendChild(a);
      }
      notice.appendChild(body);
    }
    function hush() { notice.className = 'notice inject-hidden'; clear(notice); }
    function size() { return lite.checked ? 'lite' : 'full'; }
    function busy(on) {
      [btnCopy, btnRun, btnJob, btnPreview, btnUndo, brief, reply, lite].forEach(function (b) { b.disabled = !!on; });
      if (on) btnApply.disabled = true; else syncApply();
    }
    function syncApply() {
      var same = state.lastPreviewed != null && reply.value === state.lastPreviewed;
      btnApply.disabled = !same || !(state.pack && state.pack.ui && state.pack.ui.canApply !== false);
    }
    function showRun(on, hint) {
      btnRun.classList.toggle('inject-hidden', !on);
      runHint.classList.toggle('inject-hidden', !hint);
      runHint.textContent = hint || '';
    }
    function startTimer() {
      var t0 = Date.now();
      timer.textContent = '⏱ 0:00';
      state.timer = setInterval(function () { timer.textContent = '⏱ ' + fmtElapsed(Date.now() - t0); }, 1000);
    }
    function stopTimer() {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
    }
    function showPreviewResult(d) {
      renderPreview(previewBox, d.preview);
      renderWarnings(warn, d.warnings, d.warningTexts);
      if (typeof opts.onPreview === 'function') { try { opts.onPreview(d); } catch (e) { /* the host's problem */ } }
    }
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
      return new Promise(function (resolve, reject) {
        var ta = h('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.insetInlineStart = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy failed'));
      });
    }
    // when the clipboard is out of reach (http, permissions) the prompt is
    // shown in a box the owner can select by hand
    function offerPrompt(text) {
      clear(promptFallback);
      promptFallback.classList.remove('inject-hidden');
      promptFallback.appendChild(h('p', 'faint', 'לא הצלחתי להעתיק אוטומטית — סמנו והעתיקו מכאן:'));
      var ta = h('textarea', 'input');
      ta.value = text;
      ta.readOnly = true;
      ta.addEventListener('focus', function () { ta.select(); });
      promptFallback.appendChild(ta);
    }

    // ── the prompt ──
    function fetchPrompt() {
      var q = '?brief=' + encodeURIComponent(brief.value.trim()) + '&size=' + size();
      return fetch('/admin/api/inject/' + encodeURIComponent(id) + '/prompt' + q, { credentials: 'same-origin' })
        .then(function (r) {
          if (!r.ok) {
            return r.json().catch(function () { return {}; }).then(function (j) {
              var e = new Error(j.error || ('שגיאה ' + r.status));
              e.code = j.code || '';
              throw e;
            });
          }
          return r.text();
        });
    }
    btnCopy.addEventListener('click', function () {
      hush();
      promptFallback.classList.add('inject-hidden');
      setStatus('מכין את הפרומפט…');
      busy(true);
      fetchPrompt().then(function (text) {
        state.lastPrompt = text;
        return copyText(text).then(function () {
          setStatus('✓ הועתק (' + fmtK(text.length) + ') — הדביקו בצ׳אט חדש של ה-AI', 'ok-text');
        }, function () {
          setStatus(fmtK(text.length) + ' — העתיקו ידנית', 'muted');
          offerPrompt(text);
        });
      }).catch(function (e) {
        setStatus('');
        say('danger', e.message || 'הפרומפט לא נבנה');
      }).then(function () { busy(false); });
    });

    // ── the preview (/paste — never writes) ──
    function doPreview() {
      var text = reply.value;
      if (!text.trim()) { say('warn', 'הדביקו את תשובת ה-AI לפני התצוגה המקדימה'); return Promise.resolve(false); }
      hush();
      setStatus('בודק את התשובה…');
      busy(true);
      return postJson('/admin/api/inject/' + encodeURIComponent(id) + '/paste', { reply: text, brief: brief.value.trim() })
        .then(function (r) {
          if (!r.json.ok) {
            state.lastPreviewed = null;
            clear(previewBox);
            renderWarnings(warn, [], []);
            say('danger', r.json.error || 'התשובה נדחתה');
            setStatus('');
            return false;
          }
          state.lastPreviewed = text;
          showPreviewResult(r.json);
          setStatus(r.json.hard ? '⚠ יש אזהרות קשות — ההחלה תבקש אישור' : '✓ התצוגה מוכנה — אפשר להחיל', r.json.hard ? 'muted' : 'ok-text');
          return true;
        })
        .catch(function (e) { setStatus(''); say('danger', 'התצוגה נכשלה: ' + e.message); return false; })
        .then(function (ok) { busy(false); return ok; });
    }
    btnPreview.addEventListener('click', doPreview);
    reply.addEventListener('input', syncApply);

    // ── the run (/run — never applies) ──
    /** The relay conversation: while the server hands back a modelCall, the
     *  bridge runs it on the owner's machine and the result goes back to the
     *  same route. The server holds the run's state; we carry an opaque id
     *  and the model's own words. A pass-through for every other provider. */
    function driveRelay(d) {
      if (!d || !d.modelCall) return Promise.resolve(d);
      if (!bridgeReady()) {
        return Promise.reject(new Error('הגשר לא מחובר לאתר הזה — פתחו את התוסף Bridge V2 ולחצו "חבר את האתר הפתוח"'));
      }
      // v2.50 — 'think': the model reasoned its answer budget away; the same call again, with room to answer
      var phase = d.stage === 'repair' ? 'סבב תיקון' : (d.stage === 'think' ? 'החבילה שוב, עם יותר מקום לתשובה (המודל חשב עד שנגמר לו התקציב),' : 'החבילה');
      setStatus('הדפדפן מריץ את ' + phase + ' על המודל שלכם…');
      return global.TapuzBridge.drive(d, function (payload) {
        return postJson('/admin/api/inject/' + encodeURIComponent(id) + '/run', payload,
          state.ctrl ? state.ctrl.signal : undefined).then(function (r) { return r.json; });
      }, d.timeoutMs, function (p) {
        // the model is visibly writing — say so, instead of a dead spinner
        // nothing streamed yet = the model is reading the pack, not writing 0
        if (!state.destroyed) setStatus(p.chars ? '✍ המודל שלכם כותב… ' + (p.tokens ? p.tokens.toLocaleString() + ' טוקנים' : p.chars.toLocaleString() + ' תווים')
          : (p.started === false ? '⏳ המודל שלכם קורא את החבילה…' : '⏳ המודל שלכם עובד…'));
      });
    }

    function doRun() {
      hush();
      var prov = state.settings ? state.settings.provider : '';
      var onOwnMachine = prov === 'local' || prov === 'browser';
      var model = state.settings ? (state.settings.model || state.settings.provider) : '';
      if (prov === 'browser' && !model) model = 'המודל הטעון אצלכם';
      setStatus((prov === 'browser' ? 'המודל שלכם — דרך הדפדפן' : onOwnMachine ? 'מודל מקומי' : 'ספק ענן') +
        (model ? ' · ' + model : '') + (onOwnMachine ? ' — עד ~4 דקות' : ' — ~20 שניות'));
      busy(true);
      btnCancel.classList.remove('inject-hidden');
      startTimer();
      state.ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      return postJson('/admin/api/inject/' + encodeURIComponent(id) + '/run',
        { brief: brief.value.trim(), size: size() }, state.ctrl ? state.ctrl.signal : undefined)
        .then(function (r) { return driveRelay(r.json).then(function (d) { return { status: r.status, json: d }; }); })
        .then(function (r) {
          var d = r.json;
          if (d.ok) {
            reply.value = d.reply || '';
            state.lastPreviewed = reply.value;
            showPreviewResult(d);
            var secs = d.timing && d.timing.ms ? Math.round(d.timing.ms / 1000) : 0;
            var toks = d.usage ? (d.usage.prompt_tokens + d.usage.completion_tokens) : 0;
            setStatus('✓ הסתיים ב-' + secs + ' שניות' + (d.rounds > 1 ? ' · ' + (d.repaired ? 'תוקן בסבב שני' : 'הסבב הראשון נשמר') : '') +
              (toks ? ' · ' + toks.toLocaleString() + ' טוקנים' : ''), 'ok-text');
            return;
          }
          // a door refusal after the repair round — the text is still there
          // for the owner to edit and preview by hand
          if (d.reply) { reply.value = d.reply; state.lastPreviewed = null; }
          setStatus('');
          switch (d.code) {
            case 'NO_PROVIDER':
              say('warn', d.error || 'לא מוגדר ספק AI.', '/admin/ai-setup', 'לחיבור AI →');
              break;
            case 'BROWSER_RELAY':
              showRun(false, 'הספק "דרך הדפדפן" לא יכול לרוץ מהשרת — העתיקו את הפרומפט והדביקו בצ׳אט.');
              say('info', d.error || '');
              break;
            case 'RELAY_EXPIRED':
              say('warn', d.error || 'ההרצה פגה — לחצו "הרץ" שוב.');
              break;
            case 'PACK_TOO_BIG':
              lite.checked = true;
              say('warn', (d.error || 'החבילה גדולה מדי למודל.') + ' עברנו לחבילה לייט — לחצו "הרץ" שוב.');
              break;
            case 'THOUGHT_OUT':
              // v2.50 — a thinking model the runtime does not silence; the server already tried once more
              say('danger', (d.error || 'המודל חשב ולא ענה.') + (d.fix ? ' ' + d.fix : ''));
              break;
            case 'WINDOW_SHARED':
              // the request was fine — a neighbour took the window (v2.44)
              say('warn', (d.error || 'המודל עסוק בבקשה אחרת.') + (d.fix ? ' ' + d.fix : ''));
              break;
            case 'TIMEOUT':
            case 'PROVIDER_ERROR':
            case 'EMPTY_REPLY':
            case 'NETWORK':
              say('danger', (d.error || 'המודל לא ענה.') + ' אפשר בינתיים "צור פרומפט והעתק" ולהדביק בצ׳אט.');
              break;
            default:
              say('danger', d.error || ('שגיאה ' + r.status));
          }
        })
        .catch(function (e) {
          setStatus('');
          if (e && e.name === 'AbortError') say('info', 'ההרצה בוטלה בדפדפן (השרת עשוי להמשיך עד שהמודל יענה).');
          else say('danger', 'ההרצה נכשלה: ' + e.message);
        })
        .then(function () {
          stopTimer();
          state.ctrl = null;
          btnCancel.classList.add('inject-hidden');
          busy(false);
        });
    }
    // ── the worker (v2.30): a courier that needs no tab ────────────────
    //
    // The browser relay dies with the tab and is bounded by the browser's own
    // service-worker limits. A job is not: the owner's `tapuz-worker` process
    // claims it, runs it on their GPU and posts the reply back, so the pack
    // can take as long as it takes and this page may be closed the whole
    // time. What lands here is the same reply, judged by the same door — and
    // apply is still the owner's second click on text they can read.
    function jobsUrl(tail) { return '/admin/api/inject/jobs' + (tail || ''); }

    function pollJob(jobId) {
      if (state.destroyed) return Promise.resolve();
      return fetch(jobsUrl('/' + encodeURIComponent(jobId)), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (state.destroyed) return;
          var j = d && d.job;
          if (!d.ok || !j) { setStatus(''); say('warn', (d && d.error) || 'העבודה לא נמצאה'); busy(false); return; }
          if (j.status === 'pending' || j.status === 'running') {
            setStatus(j.status === 'pending' ? '⏳ ממתין לעובד שלכם…' : '🛠 העובד שלכם מריץ… (אפשר לסגור את הדף)');
            state.jobTimer = global.setTimeout(function () { pollJob(jobId); }, 3000);
            return;
          }
          stopTimer();
          state.jobId = null;
          // the text must be in the box BEFORE busy(false): that is what
          // re-enables apply, and only when the box holds the previewed text
          if (j.reply) { reply.value = j.reply; state.lastPreviewed = j.status === 'done' ? j.reply : null; }
          busy(false);
          if (j.status === 'done' && j.result) {
            showPreviewResult(j.result);
            var toks = j.usage ? ((j.usage.prompt_tokens || 0) + (j.usage.completion_tokens || 0)) : 0;
            var secs = j.finishedAt && j.claimedAt ? Math.round((j.finishedAt - j.claimedAt) / 1000) : 0;
            setStatus('✓ העובד סיים' + (secs ? ' ב-' + secs + ' שניות' : '') +
              (j.result.rounds > 1 ? ' · ' + (j.result.repaired ? 'תוקן בסבב שני' : 'הסבב הראשון נשמר') : '') +
              (toks ? ' · ' + toks.toLocaleString() + ' טוקנים' : ''), 'ok-text');
          } else if (j.status === 'cancelled') {
            setStatus('');
            say('info', 'העבודה בוטלה.');
          } else {
            setStatus('');
            say('danger', 'העבודה נכשלה: ' + ((j.error && j.error.message) || 'שגיאה לא ידועה') +
              (j.reply ? ' — התשובה נשמרה למטה, אפשר לתקן ולהריץ תצוגה מקדימה.' : ''));
          }
        })
        .catch(function () {
          // a blip on the way to the site is not a failed job — keep watching
          if (!state.destroyed) state.jobTimer = global.setTimeout(function () { pollJob(jobId); }, 5000);
        });
    }

    function doJob() {
      hush();
      setStatus('שולח לעובד…');
      busy(true);
      startTimer();
      postJson('/admin/api/inject/' + encodeURIComponent(id) + '/job', { brief: brief.value.trim(), size: size() })
        .then(function (r) {
          var d = r.json;
          if (!d.ok) {
            busy(false);
            stopTimer();
            setStatus('');
            if (d.code === 'PACK_TOO_BIG') {
              lite.checked = true;
              say('warn', (d.error || 'החבילה גדולה מדי למודל.') + ' עברנו לחבילה לייט — נסו שוב.');
              return;
            }
            say('danger', d.error || ('שגיאה ' + r.status));
            return;
          }
          state.jobId = d.job.id;
          if (d.worker && !d.worker.online) {
            say('info', 'העבודה בתור. העובד לא פעיל כרגע — הפעילו אותו על המחשב עם המודל, והיא תירוץ מיד.');
          }
          pollJob(d.job.id);
        })
        .catch(function (e) { busy(false); stopTimer(); setStatus(''); say('danger', 'השליחה נכשלה: ' + e.message); });
    }
    btnJob.addEventListener('click', doJob);

    btnRun.addEventListener('click', doRun);
    btnCancel.addEventListener('click', function () {
      if (state.ctrl) state.ctrl.abort();
      if (state.jobTimer) { global.clearTimeout(state.jobTimer); state.jobTimer = null; }
      if (state.jobId) {
        var jid = state.jobId;
        state.jobId = null;
        postJson(jobsUrl('/' + encodeURIComponent(jid) + '/cancel'), {}).catch(function () { /* it may have finished */ });
        stopTimer();
        busy(false);
        setStatus('');
      }
    });

    // ── apply (/apply — the only door that writes) ──
    function doApply(force) {
      var text = reply.value;
      if (state.lastPreviewed == null || text !== state.lastPreviewed) { syncApply(); return; }
      hush();
      setStatus('מחיל…');
      busy(true);
      postJson('/admin/api/inject/' + encodeURIComponent(id) + '/apply', { reply: text, brief: brief.value.trim(), force: !!force })
        .then(function (r) {
          var d = r.json;
          if (r.status === 409 && d.code === 'HARD_WARNINGS') {
            renderWarnings(warn, d.warnings, d.warningTexts);
            busy(false);
            setStatus('');
            if (global.confirm('יש אזהרות קשות — להחיל בכל זאת?')) return doApply(true);
            return;
          }
          if (!d.ok) { setStatus(''); say('danger', d.error || 'ההחלה נכשלה'); busy(false); return; }
          state.applied = true;
          renderWarnings(warn, d.warnings, []);
          var where = d.landed && d.landed.url ? d.landed.url : '';
          say(d.rebuildError ? 'warn' : 'ok',
            'הוחל ✓' + (d.backupId ? ' · גיבוי ' + d.backupId : '') + (d.rebuildError ? ' · האתר לא נבנה מחדש: ' + d.rebuildError : ''),
            where, where ? 'לצפייה →' : '');
          setStatus('');
          busy(false);
          if (typeof opts.onApplied === 'function') { try { opts.onApplied(d); } catch (e) { /* the host's problem */ } }
        })
        .catch(function (e) { setStatus(''); say('danger', 'ההחלה נכשלה: ' + e.message); busy(false); });
    }
    btnApply.addEventListener('click', function () { doApply(false); });

    // ── undo (/undo) ──
    btnUndo.addEventListener('click', function () {
      hush();
      setStatus('משחזר…');
      busy(true);
      postJson('/admin/api/inject/' + encodeURIComponent(id) + '/undo', {})
        .then(function (r) {
          var d = r.json;
          if (!d.ok) { say('warn', d.error || 'אין מה לבטל'); setStatus(''); return; }
          say('ok', 'שוחזר ✓' + (d.restored ? ' · ' + d.restored : ''));
          setStatus('');
          if (typeof opts.onApplied === 'function') { try { opts.onApplied({ ok: true, undone: true, restored: d.restored }); } catch (e) { /* */ } }
        })
        .catch(function (e) { setStatus(''); say('danger', 'הביטול נכשל: ' + e.message); })
        .then(function () { busy(false); });
    });

    // ── boot: the pack + the AI settings ──
    Promise.all([loadPacks(), loadSettings()]).then(function (res) {
      if (state.destroyed) return;
      var packs = res[0];
      state.settings = res[1];
      state.pack = null;
      for (var i = 0; i < packs.length; i++) if (packs[i].id === id) state.pack = packs[i];
      if (!state.pack) {
        title.textContent = 'חבילה לא מוכרת: ' + id;
        [btnCopy, btnRun, btnPreview, btnApply, btnUndo].forEach(function (b) { b.disabled = true; });
        return;
      }
      var pack = state.pack;
      title.textContent = pack.title;
      blurb.textContent = pack.blurb || '';
      brief.placeholder = (pack.ui && pack.ui.briefPlaceholder) || '';
      if (pack.ui && pack.ui.applyLabel) btnApply.textContent = pack.ui.applyLabel;
      if (!(pack.ui && pack.ui.sizes && pack.ui.sizes.indexOf('full') !== -1)) sizeRow.classList.add('inject-hidden');
      if (pack.notReady) {
        say('info', 'החבילה עדיין לא זמינה בשרת הזה — המודול שלה חסר. נסו שוב אחרי עדכון.');
        [btnCopy, btnRun, btnPreview, btnApply].forEach(function (b) { b.disabled = true; });
        return;
      }
      // the worker is independent of the AI provider: it brings its own model
      fetch(jobsUrl('?packId=' + encodeURIComponent(id) + '&limit=5'), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (state.destroyed || !d || !d.ok) return;
          var live = (d.jobs || []).filter(function (j) { return j.status === 'pending' || j.status === 'running'; })[0];
          if (d.worker && d.worker.online) {
            btnJob.classList.remove('inject-hidden');
          } else if (live) {
            btnJob.classList.remove('inject-hidden'); // a job is waiting for a worker that will come back
          }
          if (live) { state.jobId = live.id; busy(true); startTimer(); pollJob(live.id); return; }
          // The point of a job is that the tab may be closed while it runs.
          // So a finished one that nobody has seen yet is loaded on arrival —
          // the reply in the box, the preview under it, apply one click away.
          var fresh = (d.jobs || []).filter(function (j) {
            return j.status === 'done' && j.finishedAt && (Date.now() - j.finishedAt) < 24 * 3600 * 1000;
          })[0];
          if (fresh && !reply.value) pollJob(fresh.id);
        })
        .catch(function () { /* no worker, no button — nothing is broken */ });

      if (canRun(state.settings, pack)) {
        showRun(true, '');
      } else if (state.settings && state.settings.ok && state.settings.provider === 'browser') {
        // the provider is right, the bridge simply has not said hello (yet):
        // the extension is missing, or this site was never connected in it
        showRun(false, 'הגשר לא מחובר לאתר הזה — פתחו את התוסף Bridge V2, לחצו "חבר את האתר הפתוח", ורעננו.');
        document.addEventListener('tapuz-bridge-hello', function () {
          if (!state.destroyed && canRun(state.settings, state.pack)) showRun(true, '');
        });
      } else if (pack.run && pack.run.enabled && state.settings && state.settings.ok) {
        showRun(false, 'להרצה ישירה חברו מודל מקומי או מפתח API במסך "חיבור AI".');
      }
    });

    return {
      destroy: function () {
        state.destroyed = true;
        if (state.jobTimer) { global.clearTimeout(state.jobTimer); state.jobTimer = null; }
        stopTimer();
        if (state.ctrl) { try { state.ctrl.abort(); } catch (e) { /* */ } }
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  global.TapuzInjectCard = { mount: mount, renderPreview: renderPreview };
})(window);
