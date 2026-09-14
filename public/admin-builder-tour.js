/* Tapuziel builder — the guided walkthrough (v1.66; v2.33: once, still, modal).
 *
 * The goal's own words: a builder "that walks you through things that are not
 * 'just read the label'". So each step teaches the ACTION (drag, drop by
 * intent, click-to-edit), not the label. Spotlight + card over the REAL UI —
 * no screenshots, no fake demo page.
 *
 * Self-contained: injects its own launcher (🧭 סיור), styles inline, no deps.
 *
 * v2.33 — Ben: "the tutorial can't hit me every time I enter the editor …
 * it needs to be one time scenario … the delay is when scrolling it follows
 * you, I rather it will round the entire page and not move with me …
 * scrolling shouldn't be allowed, its the tutorial, skip if you want".
 * Three rules follow from that:
 *   ONCE  — the first visit is remembered the moment the tour SHOWS, not only
 *           when it is finished or skipped. Leaving the editor mid-tour used
 *           to mean "not seen", so it came back on every visit.
 *   STILL — the spotlight is placed once per step (the target is scrolled into
 *           view first) and never chases the page: no scroll listener, no
 *           position transition. Only a resize re-measures.
 *   MODAL — while the tour is up, the page does not scroll (wheel, touch and
 *           keyboard scrolling are swallowed; the document's overflow is
 *           locked) and the page behind the dim does not take clicks. Escape
 *           skips, Enter advances. Relaunch any time from 🧭 סיור.
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
  var dim = null;    // the full-viewport blocker: takes the clicks, swallows the scroll
  var spot = null;   // spotlight box (the "hole")
  var card = null;   // the explaining card
  var resizeBound = null;
  var lockBound = null;
  var keyBound = null;
  var savedOverflow = null; // [html, body] overflow before the lock

  function markSeen() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) { /* private mode */ }
  }

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

  /** The target of a step, if the screen renders it. `bring` scrolls it into
   *  view FIRST (the tour then locks the page where it stands) — a target
   *  below the fold is reachable, one that is not rendered at all is skipped. */
  function targetFor(step, bring) {
    var el = document.querySelector(step.sel);
    if (!el) return null;
    if (bring && el.getClientRects().length) {
      // admin.css gives the document `scroll-behavior: smooth`, which turns
      // scrollIntoView into an ANIMATION — the spotlight would be measured
      // before the page arrived and the page would glide under it (Firefox
      // does this on step 2 every time). The tour's own scroll is instant.
      var html = document.documentElement;
      var prev = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      catch (e) { el.scrollIntoView(); }
      finally { html.style.scrollBehavior = prev; }
    }
    return visible(el) ? el : null;
  }

  // ── the page stands still while the tour is up ──
  var SCROLL_KEYS = { ' ': 1, Spacebar: 1, PageUp: 1, PageDown: 1, Home: 1, End: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };

  function lockPage() {
    if (savedOverflow) return;
    var html = document.documentElement;
    savedOverflow = [html.style.overflow, document.body.style.overflow];
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    lockBound = function (e) { e.preventDefault(); };
    // The keyboard is the tour's while it is up: nothing reaches the
    // builder's own shortcuts (Ctrl+S, Delete, Ctrl+Z…) or the page behind
    // the dim. Escape skips; Tab cycles the card's two buttons; a key aimed
    // at one of those buttons activates it natively (Enter on ״דלגו״ skips,
    // not advances); Enter anywhere else advances; scrolling keys do nothing.
    keyBound = function (e) {
      e.stopPropagation();
      var inCard = !!(card && card.contains(e.target));
      if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); teardown(true); return; }
      if (e.key === 'Tab' || e.keyCode === 9) {
        e.preventDefault();
        var n = card && card.querySelector('#tz-tour-next');
        var s = card && card.querySelector('#tz-tour-skip');
        if (n && s) (document.activeElement === n ? s : n).focus();
        return;
      }
      if (inCard && (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32)) return;
      if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); next(); return; }
      if (SCROLL_KEYS[e.key] || (e.ctrlKey || e.metaKey)) e.preventDefault();
    };
    window.addEventListener('wheel', lockBound, { passive: false, capture: true });
    window.addEventListener('touchmove', lockBound, { passive: false, capture: true });
    window.addEventListener('keydown', keyBound, true);
    setInert(true);
  }

  /** Everything under the dim is inert while the tour is up — no focus, no
   *  typing into a field behind the blocker (Chrome 102+ / Firefox 112+;
   *  older engines simply keep the blocker + the key handler). */
  var inertNodes = [];
  function setInert(on) {
    if (!('inert' in document.documentElement)) return;
    if (on) {
      inertNodes = [];
      Array.prototype.forEach.call(document.body.children, function (n) {
        if (n === dim || n === spot || n === card || n.inert) return;
        n.inert = true;
        inertNodes.push(n);
      });
    } else {
      inertNodes.forEach(function (n) { n.inert = false; });
      inertNodes = [];
    }
  }

  function unlockPage() {
    if (!savedOverflow) return;
    setInert(false);
    document.documentElement.style.overflow = savedOverflow[0];
    document.body.style.overflow = savedOverflow[1];
    savedOverflow = null;
    window.removeEventListener('wheel', lockBound, { capture: true });
    window.removeEventListener('touchmove', lockBound, { capture: true });
    window.removeEventListener('keydown', keyBound, true);
    lockBound = null;
    keyBound = null;
  }

  function ensureNodes() {
    if (spot) return;
    // the blocker: invisible, over everything but the spotlight and the card.
    // It exists so a click on the dimmed page goes nowhere and a scroll
    // gesture has nothing to scroll — the tour is modal, skip is the way out.
    dim = document.createElement('div');
    dim.id = 'tz-tour-dim';
    dim.style.cssText = 'position:fixed;inset:0;z-index:' + Z + ';background:transparent;cursor:default';
    spot = document.createElement('div');
    spot.id = 'tz-tour-spot';
    // the spotlight: a transparent box whose GIANT shadow dims everything else.
    // No transition on purpose — it is placed once per step and stays put.
    spot.style.cssText =
      'position:fixed;z-index:' + (Z + 1) + ';pointer-events:none;border-radius:12px;' +
      'box-shadow:0 0 0 100vmax rgba(2,6,23,.72);border:2px solid #f59e0b';
    card = document.createElement('div');
    card.id = 'tz-tour-card';
    card.setAttribute('dir', 'rtl');
    card.style.cssText =
      'position:fixed;z-index:' + (Z + 2) + ';width:320px;max-width:92vw;padding:16px;' +
      'border-radius:14px;background:linear-gradient(160deg,#0f172a,#1e293b);color:#e2e8f0;' +
      'font:500 14px system-ui,sans-serif;border:1px solid #334155;' +
      'box-shadow:0 14px 44px rgba(0,0,0,.5)';
    document.body.appendChild(dim);
    document.body.appendChild(spot);
    document.body.appendChild(card);
    // a resize re-measures (the layout moved); a scroll cannot happen
    resizeBound = function () { if (idx >= 0) place(false); };
    window.addEventListener('resize', resizeBound);
    lockPage();
  }

  function teardown(markDone) {
    if (markDone) markSeen();
    idx = -1;
    if (dim) { dim.remove(); dim = null; }
    if (spot) { spot.remove(); spot = null; }
    if (card) { card.remove(); card = null; }
    if (resizeBound) {
      window.removeEventListener('resize', resizeBound);
      resizeBound = null;
    }
    unlockPage();
  }

  function place(bring) {
    var step = STEPS[idx];
    var el = step && targetFor(step, bring !== false);
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
    card.querySelector('#tz-tour-next').focus();
  }

  function next() {
    idx++;
    // skip forward past any step whose target isn't on this screen
    while (idx < STEPS.length && !targetFor(STEPS[idx], true)) idx++;
    if (idx >= STEPS.length) { teardown(true); return; }
    ensureNodes();
    place(true);
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
    b.title = 'סיור מודרך בבונה — חמישה צעדים (הסיור מופיע לבד רק בפעם הראשונה)';
    b.textContent = '🧭 סיור';
    b.onclick = start;
    tabs.appendChild(b);
  }

  function boot() {
    // Framed inside the copilot screen (v2.32) the builder is a canvas beside
    // a chat, not a first visit — no launcher, no walkthrough popping over
    // the owner's conversation. (The route does not even emit this script
    // there; this is the belt to that suspender.)
    if (window.__TAPUZ_EMBED__) return;
    addLauncher();
    var seen = false;
    try { seen = localStorage.getItem(DONE_KEY) === '1'; } catch (e) { /* private mode */ }
    if (seen) return;
    // the first visit, and only the first: remembered NOW, before the tour
    // even shows — closing the tab or clicking away mid-tour is still "seen".
    // 🧭 סיור brings it back on request.
    markSeen();
    // give the builder a beat to lay out, then walk through
    setTimeout(start, 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // exposed for QA + the "?" habit: TapuzBuilderTour.start() / .stop()
  window.TapuzBuilderTour = { start: start, stop: function () { teardown(true); }, steps: STEPS.length, isOpen: function () { return idx >= 0; } };
})();
