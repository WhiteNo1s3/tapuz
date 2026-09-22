/* Geppetto's screen (v2.56) — read a Canva / Figma site, look at it, give it
   a life, take it back. The engine is src/geppetto/; this file only talks to
   /admin/api/geppetto/* and draws what comes back. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var plan = null;
  var currentPage = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // what undo did — and what it kept on purpose
  var PIECES = { theme: 'המראה', menu: 'התפריט', homepage: 'דף הבית', title: 'שם האתר' };
  function undoSummary(d) {
    var t = 'בוטל — ' + (d.pagesRemoved || []).length + ' דפים ו‑' + (d.media || 0) + ' קבצים הוסרו' +
      (d.theme ? ', ערכת הנושא חזרה' : '') + (d.menu ? ', התפריט חזר' : '') + (d.homepage ? ', דף הבית חזר' : '') + '.';
    if ((d.pagesKept || []).length) t += ' נשארו ' + d.pagesKept.length + ' דפים שנערכו אחרי הייבוא (' + d.pagesKept.map(esc).join(', ') + ')' + (d.mediaKept ? ' — וגם התמונות שלהם' : '') + '.';
    if (d.themeSaved) t += ' המראה שהיה באתר לפני הביטול נשמר בספריית ערכות הנושא בשם „' + esc(d.themeSaved) + '”.';
    if (d.themeNotRestored) t += ' המראה לא הוחזר — לא היה איפה לשמור קודם את המראה הנוכחי (' + esc(d.themeNotRestored) + '); פנו מקום בספרייה והחילו משם את המראה הקודם.';
    if (d.mediaKept && !(d.pagesKept || []).length) t += ' התמונות נשארו — ' + (d.mediaKeptFor === 'config' ? 'הלוגו של האתר' : 'הדף ' + esc(d.mediaKeptFor)) + ' עדיין מציג אותן.';
    if ((d.left || []).length) t += ' ייבוא מאוחר יותר עדיין קובע את ' + d.left.map(function (k) { return PIECES[k] || k; }).join(', ') + ' — הם יחזרו כשיבוטל גם הוא.';
    if ((d.errors || []).length) t += ' שגיאות: ' + d.errors.map(esc).join('; ');
    return t;
  }

  function api(url, body) {
    var opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
    });
  }

  function busy(el, on, label) {
    if (on) { el.dataset.label = el.textContent; el.disabled = true; el.innerHTML = '<span class="gp-busy"></span> ' + esc(label || 'רגע…'); }
    else { el.disabled = false; el.textContent = el.dataset.label || el.textContent; }
  }

  // ── tabs ──
  document.querySelectorAll('.gp-tabs [role="tab"]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.gp-tabs [role="tab"]').forEach(function (t) {
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        var pane = $(t.dataset.pane);
        if (pane) pane.hidden = t !== tab;
      });
    });
  });

  // ── 1. read ──
  var SOURCE_LABEL = {
    'canva-app': 'Canva · אתר (גרסת אפליקציה)',
    'canva-static': 'Canva · אתר',
    'figma-sites': 'Figma Sites',
    'figma-file': 'Figma · קובץ עיצוב'
  };

  function read(body, btn) {
    var status = $('gp-read-status');
    status.innerHTML = '<span class="gp-busy"></span> ג׳פטו קורא את העיצוב — הדפים, התמונות, הגופנים… זה יכול לקחת כמה שניות.';
    busy(btn, true, 'קורא…');
    api('/admin/api/geppetto/read', body).then(function (d) {
      busy(btn, false);
      if (!d.ok) { status.innerHTML = '<span class="err-text">' + esc(d.error || 'הקריאה נכשלה') + '</span>'; return; }
      status.innerHTML = '<span class="ok-text">נקרא. גללו לראות מה ג׳פטו בנה.</span>';
      plan = d.plan;
      drawPlan();
      $('gp-step-see').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function () { busy(btn, false); status.innerHTML = '<span class="err-text">שגיאת רשת</span>'; });
  }

  $('gp-read-url').addEventListener('click', function () {
    var url = $('gp-url').value.trim();
    if (!url) { $('gp-read-status').innerHTML = '<span class="err-text">הדביקו כתובת של אתר קנבה או Figma.</span>'; return; }
    read({ url: url }, this);
  });
  $('gp-url').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('gp-read-url').click(); } });

  $('gp-read-file').addEventListener('click', function () {
    var btn = this;
    var f = $('gp-file').files && $('gp-file').files[0];
    if (!f) { $('gp-read-status').innerHTML = '<span class="err-text">בחרו קובץ קודם.</span>'; return; }
    if (f.size > 11 * 1024 * 1024) { $('gp-read-status').innerHTML = '<span class="err-text">הקובץ גדול מ‑11MB.</span>'; return; }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      var url = $('gp-file-url').value.trim();
      var body = /\.json$/i.test(f.name) || /^\s*[{[]/.test(text) ? { json: text, url: url } : { html: text, url: url };
      read(body, btn);
    };
    reader.readAsText(f);
  });

  $('gp-read-figma').addEventListener('click', function () {
    var url = $('gp-figma-url').value.trim();
    var token = $('gp-figma-token').value.trim();
    if (!url) { $('gp-read-status').innerHTML = '<span class="err-text">הדביקו את כתובת הקובץ ב‑Figma.</span>'; return; }
    read({ url: url, token: token }, this);
  });

  // ── 2. what Geppetto saw ──
  function stat(num, label, color) {
    return '<div class="stat" style="--c:' + (color || 'var(--accent)') + '"><div class="stat-num">' + esc(num) + '</div><div class="stat-label">' + esc(label) + '</div></div>';
  }

  var PATTERN_HE = { hero: 'פתיח', cards: 'כרטיסים', team: 'צוות', stats: 'מספרים', gallery: 'גלריה', social: 'רשתות', logos: 'לוגואים' };
  var DROPPED_HE = { decoration: 'קישוט', 'small icon': 'אייקון קטן', 'rotated sticker': 'מדבקה מסובבת', line: 'קו', shape: 'צורה' };

  function drawPlan() {
    var r = plan.report || {};
    $('gp-step-see').hidden = false;
    $('gp-step-land').hidden = false;
    $('gp-badge').textContent = (SOURCE_LABEL[plan.format] || plan.source) + (plan.title ? ' · ' + plan.title : '');
    var patterns = Object.keys(r.patterns || {}).map(function (k) { return (PATTERN_HE[k] || k) + (r.patterns[k] > 1 ? ' ×' + r.patterns[k] : ''); });
    var dropped = Object.keys(r.dropped || {}).reduce(function (s, k) { return s + r.dropped[k]; }, 0);
    $('gp-stats').innerHTML = [
      stat(plan.pages.length, 'דפים', '#0ea5e9'),
      stat(r.sections || 0, 'אזורים', '#8b5cf6'),
      stat(r.headings || 0, 'כותרות', '#f97316'),
      stat(r.images || 0, 'תמונות', '#10b981'),
      stat(r.buttons || 0, 'כפתורים', '#e11d48'),
      stat(r.rows || 0, 'שורות עם עמודות', '#6366f1'),
      stat(r.links || 0, 'קישורים שחיו', '#14b8a6'),
      stat(dropped, 'קישוטים שהושמטו', '#a8a29e')
    ].join('');
    if (patterns.length) $('gp-stats').insertAdjacentHTML('beforeend', '<div class="stat" style="--c:#f59e0b"><div class="stat-num" style="font-size:1.05rem;letter-spacing:0">' + esc(patterns.join(' · ')) + '</div><div class="stat-label">מודולים שזוהו</div></div>');

    $('gp-menu').innerHTML = (plan.menu || []).length
      ? plan.menu.map(function (m) { return '<span class="pill info" title="' + esc(m.url) + '">' + esc(m.label) + '</span>'; }).join('')
      : '<span class="faint">לא נמצא תפריט</span>';
    var pal = plan.palette || {};
    var NAMES = { primary: 'ראשי', secondary: 'משני', text: 'טקסט', bg: 'רקע', lightBg: 'רקע בהיר', surface: 'משטח' };
    $('gp-palette').innerHTML = Object.keys(NAMES).filter(function (k) { return pal[k]; }).map(function (k) {
      return '<span class="gp-sw" title="' + esc(NAMES[k]) + '"><i style="background:' + esc(pal[k]) + '"></i>' + esc(pal[k]) + '</span>';
    }).join('');
    $('gp-fonts').innerHTML = (plan.fontMap || []).map(function (f) {
      return '<div class="gp-note">' + (f.exact ? '✓ ' : '↳ ') + '<b dir="ltr">' + esc(f.from) + '</b>' + (f.exact ? '' : ' → <b dir="ltr">' + esc(f.family) + '</b> <span class="faint">(הקרוב ביותר ב‑Google Fonts)</span>') + '</div>';
    }).join('') || '<span class="faint">גופני המערכת</span>';
    var notes = (plan.notes || []).slice(0, 12);
    if (dropped) notes.unshift('הושמטו ' + dropped + ' קישוטים שאין להם חיים באתר (' + Object.keys(r.dropped).map(function (k) { return (DROPPED_HE[k] || k) + ' ×' + r.dropped[k]; }).join(', ') + ')');
    $('gp-notes').innerHTML = notes.length ? notes.map(function (n) { return '<div class="gp-note">• ' + esc(n) + '</div>'; }).join('') : '<span class="faint">אין הערות</span>';

    $('gp-pages').innerHTML = plan.pages.map(function (p) {
      var errs = (p.errors || []).length ? ' <span class="pill warn" title="' + esc(p.errors.join('; ')) + '">תיקון</span>' : '';
      return '<div class="gp-page" data-key="' + esc(p.key) + '">' +
        '<div><b>' + esc(p.title || p.slug) + '</b>' + (p.home ? ' <span class="pill ok">דף הבית</span>' : '') + errs +
        '<div class="faint" dir="ltr" style="font-size:.8rem">/' + esc(p.slug) + ' · ' + esc(p.sections) + ' אזורים</div></div>' +
        '<button type="button" class="btn secondary" data-preview="' + esc(p.key) + '">תצוגה</button></div>';
    }).join('');
    document.querySelectorAll('[data-preview]').forEach(function (b) {
      b.addEventListener('click', function () { showPage(b.getAttribute('data-preview')); });
    });
    $('gp-theme-link').href = '/admin/api/geppetto/plan/' + encodeURIComponent(plan.id) + '/theme.bent';
    $('gp-source').hidden = true;
    $('gp-land-result').innerHTML = '';
    showPage(plan.pages[0].key);
  }

  function showPage(key) {
    currentPage = key;
    document.querySelectorAll('.gp-page').forEach(function (el) { el.classList.toggle('is-on', el.getAttribute('data-key') === key); });
    $('gp-frame').src = '/admin/geppetto/preview/' + encodeURIComponent(plan.id) + '/' + encodeURIComponent(key);
    if (!$('gp-source').hidden) loadSource();
  }

  function loadSource() {
    fetch('/admin/api/geppetto/plan/' + encodeURIComponent(plan.id) + '/source/' + encodeURIComponent(currentPage))
      .then(function (r) { return r.text(); })
      .then(function (t) { $('gp-source').textContent = t; });
  }

  $('gp-show-source').addEventListener('click', function () {
    var pre = $('gp-source');
    pre.hidden = !pre.hidden;
    this.textContent = pre.hidden ? 'הצג BenTML' : 'הסתר BenTML';
    if (!pre.hidden) loadSource();
  });

  // ── 3. give it a life ──
  function land(mode, btn) {
    if (!plan) return;
    var out = $('gp-land-result');
    busy(btn, true, mode === 'live' ? 'מכניס חיים…' : 'כותב טיוטות…');
    out.innerHTML = '<span class="gp-busy"></span> מעתיק תמונות, כותב דפים ב‑BenTML, מלביש את ערכת הנושא…';
    // the landing runs as a background job on the server (a big design can
    // outlast a proxy's timeout); the screen polls until it is done
    function poll(job, since) {
      return api('/admin/api/geppetto/job/' + encodeURIComponent(job)).then(function (d) {
        if (d && d.ok && d.done === false) {
          out.innerHTML = '<span class="gp-busy"></span> מעתיק תמונות, כותב דפים ב‑BenTML, מלביש את ערכת הנושא… (' + esc(d.seconds || 0) + ' שניות)';
          return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return poll(job, since); });
        }
        // the server forgot the job: it restarted in the middle of the landing
        if (d && d.code === 'NOT_FOUND') {
          loadImports();
          return { ok: false, error: 'הנחיתה נקטעה באמצע (השרת הופעל מחדש) — מה שנכתב עד אז מופיע ברשימת הייבואים למטה, ואפשר לבטל אותו משם.' };
        }
        return d;
      });
    }
    api('/admin/api/geppetto/land', {
      planId: plan.id,
      mode: mode,
      wait: false,
      media: $('gp-c-media').checked,
      theme: $('gp-c-theme').checked,
      menu: $('gp-c-menu').checked,
      homepage: $('gp-c-home').checked,
      siteTitle: $('gp-c-title').checked
    }).then(function (d) {
      return d && d.ok && d.job ? poll(d.job, Date.now()) : d;
    }).then(function (d) {
      busy(btn, false);
      if (!d.ok) { out.innerHTML = '<span class="err-text">' + esc(d.error || 'הנחיתה נכשלה') + '</span>'; return; }
      var items = d.pages.map(function (p) {
        var liveUrl = d.homepage === p.fullPath ? '/' : '/' + encodeURIComponent(p.fullPath) + '.html';
        return '<li><b>' + esc(p.title || p.fullPath) + '</b> — <a href="/admin/edit/' + encodeURIComponent(p.fullPath) + '">בבונה</a>' +
          (d.mode === 'live' ? ' · <a href="' + liveUrl + '" target="_blank" rel="noopener">באתר</a>' : ' <span class="pill">טיוטה</span>') + '</li>';
      }).join('');
      var m = d.media || {};
      var lines = [];
      if (d.theme && d.theme.error) lines.push('⚠️ ערכת הנושא לא נשמרה: ' + d.theme.error);
      else if (d.theme) lines.push(d.theme.applied ? 'ערכת הנושא הולבשה על האתר (הקודמת נשמרה בספרייה)' : 'ערכת הנושא נשמרה בספריית הערכות');
      if (d.menu && d.menu.length) lines.push('התפריט: ' + d.menu.map(function (x) { return x.label; }).join(' · '));
      if (m.found) lines.push('תמונות: ' + m.saved + ' מתוך ' + m.found + ' הועתקו לספריית המדיה' + (m.videos ? ', וגם ' + m.videos + ' סרטונים' : '') + (m.failed && m.failed.length ? ' (' + m.failed.length + ' לא ירדו ונשארו מקושרות)' : ''));
      if (d.homepage) lines.push('דף הבית של האתר: /' + d.homepage);
      if (d.rebuildError) lines.push('⚠️ האתר החי לא נבנה מחדש: ' + d.rebuildError);
      out.innerHTML = '<div class="ok-text" style="margin-bottom:6px">' + (d.mode === 'live' ? '✨ האתר חי.' : 'הדפים נכתבו כטיוטות.') + '</div>' +
        '<ul style="margin:0 0 8px;padding-inline-start:18px">' + items + '</ul>' +
        lines.map(function (l) { return '<div class="gp-note">• ' + esc(l) + '</div>'; }).join('') +
        '<button type="button" class="btn secondary" style="margin-top:10px" data-undo="' + esc(d.importId) + '">↩ ביטול הייבוא הזה</button>';
      wireUndo(out);
      lastUndo = ''; // a new landing: the last undo's summary is history now
      loadImports();
    }).catch(function () { busy(btn, false); out.innerHTML = '<span class="err-text">שגיאת רשת</span>'; });
  }
  $('gp-land-live').addEventListener('click', function () { land('live', this); });
  $('gp-land-drafts').addEventListener('click', function () { land('drafts', this); });

  // ── undo + history ──
  function wireUndo(root) {
    root.querySelectorAll('[data-undo]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!window.confirm('לבטל את הייבוא? הדפים והתמונות שנוצרו יימחקו (דף שערכתם אחרי הייבוא נשאר), וערכת הנושא, התפריט ודף הבית יחזרו למה שהיו — מה ששיניתם בינתיים נשמר בגיבוי.')) return;
        busy(b, true, 'מבטל…');
        api('/admin/api/geppetto/undo', { importId: b.getAttribute('data-undo') }).then(function (d) {
          busy(b, false);
          if (!d.ok) { window.alert(d.error || 'הביטול נכשל'); return; }
          // the history redraws itself: its summary lives above the list, not in the button's place
          if (b.closest('#gp-imports')) lastUndo = undoSummary(d);
          else b.outerHTML = '<span class="ok-text">' + undoSummary(d) + '</span>';
          loadImports();
        });
      });
    });
  }

  var lastUndo = '';
  function loadImports() {
    api('/admin/api/geppetto/imports').then(function (d) {
      var box = $('gp-imports');
      if (!d.ok || !d.imports.length) { box.innerHTML = '<span class="faint">עוד לא יובא כלום.</span>'; return; }
      box.innerHTML = (lastUndo ? '<div class="ok-text" style="display:block;margin-bottom:10px">' + lastUndo + '</div>' : '') + d.imports.slice(0, 10).map(function (r) {
        var when = new Date(r.at).toLocaleString('he-IL');
        return '<div class="gp-page"><div><b>' + esc(r.title || r.origin || r.source) + '</b> <span class="faint">(' + esc(SOURCE_LABEL[r.format] || r.source) + ')</span>' +
          '<div class="faint" style="font-size:.8rem">' + esc(when) + ' · ' + r.pages.length + ' דפים · ' + (r.mode === 'live' ? 'חי' : 'טיוטות') + '</div></div>' +
          (r.undone ? '<span class="pill">בוטל</span>'
            : r.landing === 'running' ? '<span class="pill info">נוחת עכשיו…</span>'
            : (r.landing === 'interrupted' ? '<span class="pill">נקטע</span> ' : '') + '<button type="button" class="btn secondary" data-undo="' + esc(r.id) + '">↩ ביטול</button>') + '</div>';
      }).join('');
      wireUndo(box);
    });
  }
  loadImports();
})();
