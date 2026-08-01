/* Tapuziel builder — the guided walkthrough (v1.66).
 *
 * The goal's own words: a builder "that walks you through things that are not
 * 'just read the label'". So each step teaches the ACTION (drag, drop by
 * intent, click-to-edit), not the label. Spotlight + card over the REAL UI —
 * no screenshots, no fake demo page.
 *
 * Self-contained: injects its own launcher (🧭 סיור), styles inline, no deps.
 * First visit → starts alone; skipped/finished → localStorage remembers and it
 * never nags again. Relaunch any time from the tabs row.
 */
(function () {
  'use strict';

  var DONE_KEY = 'tapuzBuilderTourDone';
  var Z = 2147480000; // above the builder, below nothing that matters

  // Each step: sel (spotlight target), title, body. Copy teaches the move.
  var STEPS = [
    {
      sel: '.toolbox',
      title: '🧰 ארגז המודולים',
      body: 'כל מה שדף יכול להכיל נמצא כאן — טקסט, גלריה, וידאו, טופס, מיכלים. לא לוחצים על כרטיס: גוררים אותו אל הדף. יש גם חיפוש למעלה.'
    },
    {
      sel: '#canvas',
      title: '📄 זה הדף עצמו — לא תצוגה',
      body: 'שחרור לפי כוונה: חלק עליון/תחתון של מודול = לפני/אחרי · מרכז של מיכל = פנימה · קצה = פיצול לטורים. סימון חי מראה איפה תנחת עוד לפני שתשחררו. וטקסט? פשוט לוחצים עליו וכותבים.'
    },
    {
      sel: '.properties',
      title: '⚙ ההגדרות באות אליכם',
      body: 'לחיצה על מודול בדף פותחת כאן את ההגדרות שלו — צבעים, ריווח, קישור. אין צורך לחפש תפריטים: הבחירה בדף היא הניווט.'
    },
    {
      sel: '#btn-responsive',
      title: '📱 איך זה נראה בנייד',
      body: 'הכפתור הזה מציג את הדף בנייד, בטאבלט ובמחשב — הרינדור האמיתי, לא הדמיה. שווה הצצה לפני פרסום.'
    },
    {
      sel: '.topbar-actions',
      title: '🚀 טיוטה ≠ פרסום',
      body: '״שמור טיוטה״ שומר אצלכם בלבד — תתנסו בחופשיות. ״פרסם״ מוציא לעולם ומעדכן את כל האתר (תפריטים, קוביות מאמרים). וכל שמירה נכנסת להיסטוריית גרסאות, אז אין מהלך שאי אפשר לחזור ממנו.'
    }
  ];

  var idx = -1;
  var spot = null;   // spotlight box (the "hole")
  var card = null;   // the explaining card
  var reflowBound = null;

  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    var s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    // off-viewport (folded drawer, overflowed grid) = NOT spotlightable —
    // pointing the tour at empty space is worse than skipping the step
    return r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
  }

  function targetFor(step) {
    var el = document.querySelector(step.sel);
    return el && visible(el) ? el : null;
  }

  function ensureNodes() {
    if (spot) return;
    spot = document.createElement('div');
    spot.id = 'tz-tour-spot';
    // the spotlight: a transparent box whose GIANT shadow dims everything else
    spot.style.cssText =
      'position:fixed;z-index:' + Z + ';pointer-events:none;border-radius:12px;' +
      'box-shadow:0 0 0 100vmax rgba(2,6,23,.72);border:2px solid #f59e0b;' +
      'transition:all .28s ease';
    card = document.createElement('div');
    card.id = 'tz-tour-card';
    card.setAttribute('dir', 'rtl');
    card.style.cssText =
      'position:fixed;z-index:' + (Z + 1) + ';width:320px;max-width:92vw;padding:16px;' +
      'border-radius:14px;background:linear-gradient(160deg,#0f172a,#1e293b);color:#e2e8f0;' +
      'font:500 14px system-ui,sans-serif;border:1px solid #334155;' +
      'box-shadow:0 14px 44px rgba(0,0,0,.5)';
    document.body.appendChild(spot);
    document.body.appendChild(card);
    reflowBound = function () { if (idx >= 0) place(); };
    window.addEventListener('resize', reflowBound);
    window.addEventListener('scroll', reflowBound, true);
  }

  function teardown(markDone) {
    if (markDone) { try { localStorage.setItem(DONE_KEY, '1'); } catch (e) { /* private mode */ } }
    idx = -1;
    if (spot) { spot.remove(); spot = null; }
    if (card) { card.remove(); card = null; }
    if (reflowBound) {
      window.removeEventListener('resize', reflowBound);
      window.removeEventListener('scroll', reflowBound, true);
      reflowBound = null;
    }
  }

  function place() {
    var step = STEPS[idx];
    var el = step && targetFor(step);
    if (!el) { next(); return; } // target gone mid-tour → move on
    var r = el.getBoundingClientRect();
    var pad = 6;
    spot.style.top = (r.top - pad) + 'px';
    spot.style.left = (r.left - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';

    // card beside the spotlight — whichever side has room (RTL-friendly)
    var cw = 330, ch = 210, gap = 14, vw = window.innerWidth, vh = window.innerHeight;
    var left = r.left - cw - gap;                    // prefer inline-start (visual left)
    if (left < 8) left = r.right + gap;              // else the other side
    if (left + cw > vw - 8) left = Math.max(8, (vw - cw) / 2); // else center
    var top = Math.min(Math.max(8, r.top), vh - ch - 8);
    card.style.left = left + 'px';
    card.style.top = top + 'px';

    var last = idx === STEPS.length - 1;
    card.innerHTML =
      '<div style="font-weight:800;font-size:15px;margin-bottom:6px">' + step.title + '</div>' +
      '<div style="line-height:1.55;color:#cbd5e1">' + step.body + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-top:14px">' +
        '<button type="button" id="tz-tour-next" style="border:none;border-radius:9px;padding:8px 16px;cursor:pointer;font:700 13px system-ui;color:#0f172a;background:#f59e0b">' +
          (last ? 'סיימנו — לבנות! ✨' : 'הבא ←') + '</button>' +
        '<button type="button" id="tz-tour-skip" style="border:none;background:none;color:#94a3b8;cursor:pointer;font:500 12px system-ui">דלגו על הסיור</button>' +
        '<span style="margin-inline-start:auto;color:#64748b;font-size:12px">' + (idx + 1) + '/' + STEPS.length + '</span>' +
      '</div>';
    card.querySelector('#tz-tour-next').onclick = next;
    card.querySelector('#tz-tour-skip').onclick = function () { teardown(true); };
  }

  function next() {
    idx++;
    // skip forward past any step whose target isn't on this screen
    while (idx < STEPS.length && !targetFor(STEPS[idx])) idx++;
    if (idx >= STEPS.length) { teardown(true); return; }
    ensureNodes();
    place();
  }

  function start() {
    teardown(false);
    idx = -1;
    next();
  }

  // Launcher — lives in the mode-tabs row so the tour is always one click away.
  function addLauncher() {
    var tabs = document.querySelector('.builder-mode-tabs');
    if (!tabs || document.getElementById('tz-tour-launch')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'tz-tour-launch';
    b.className = 'mode-advanced-toggle';
    b.title = 'סיור מודרך בבונה — חמישה צעדים';
    b.textContent = '🧭 סיור';
    b.onclick = start;
    tabs.appendChild(b);
  }

  function boot() {
    addLauncher();
    var seen = false;
    try { seen = localStorage.getItem(DONE_KEY) === '1'; } catch (e) { /* private mode */ }
    // first visit: give the builder a beat to lay out, then walk through
    if (!seen) setTimeout(start, 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // exposed for QA + the "?" habit: TapuzBuilderTour.start()
  window.TapuzBuilderTour = { start: start, steps: STEPS.length };
})();
