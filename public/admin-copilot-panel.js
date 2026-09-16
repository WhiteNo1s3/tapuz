/* Tapuziel builder — the copilot drawer (v1.71, window-aware since v2.32).
 *
 * Ben: "we need copilot to grasp the situation of being the helper in CMS and
 * do what he's told — get access to pages and edit them accordingly, adding
 * text to a selected item, help in the page builder."
 *
 * So the copilot comes INTO the builder: a 🤖 drawer that rides the SAME
 * server chat (/admin/api/ai/chat — key on the server, tools, approve-gate)
 * but sends CONTEXT with every turn: which page is open and which module is
 * selected. "Add text to the selected item" therefore means that exact block.
 *
 * Safety inherits v1.59 wholesale: reads run free, every write stops at an
 * approve/refuse card, everything lands as a DRAFT. On approval the builder
 * reloads to show the new draft (the canvas is autosaved before each ask, so
 * nothing of the owner's is lost).
 *
 * v2.32 — the thread stays coherent and the window is spoken about:
 *  - an empty reply is never pushed into history (that was the "two turns to
 *    get an unrelated answer": a '' assistant turn poisoned the next call);
 *    when the server answers with a `memo` instead of prose, the memo is
 *    what the model said and what history keeps
 *  - the bridge's measured window (`TapuzBridge.window`, 0.5.0+) rides every
 *    turn so the server picks the briefing tier BEFORE sending; the reply's
 *    `window` fills the chip in the drawer head
 *  - `notice` / `truncated` / `error` + `fix` are shown in Hebrew, with the
 *    click path, instead of "no response"
 *  - when the builder is framed inside the copilot screen the parent owns
 *    the conversation — this drawer stays out (boot returns early)
 */
(function () {
  'use strict';

  var history = []; // [{role, content}] — same contract as /admin/chat
  var HISTORY_CAP = 40; // turns — an old thread never outgrows the window
  var drawer = null;
  var busy = false;
  var openCard = null; // the approval card still waiting for an answer
  // The REPLY_CUT sentence (contract §1.6) — the server flags `truncated`,
  // the page says it in the owner's language.
  var CUT_MSG = 'התשובה נחתכה באמצע — המודל הגיע לסוף החלון. הגדילו את Context Length ב-LM Studio, או בקשו דף קצר יותר.';

  function pageFullPath() {
    var m = location.pathname.match(/^\/admin\/edit\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function selectedInfo() {
    try {
      var b = window.TapuzBuilder && TapuzBuilder._getSelected && TapuzBuilder._getSelected();
      if (!b) return null;
      var text = '';
      var d = b.data || {};
      // best-effort human text of the block, for "the selected item says…"
      text = String(d.text || d.title || d.heading || d.content || '').replace(/<[^>]+>/g, '').slice(0, 280);
      return { id: b.id || '', type: b.type || '', text: text };
    } catch (e) { return null; }
  }

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function $(id) { return drawer && drawer.querySelector('#' + id); }

  /** A bubble; `fix` (a second Hebrew line with the click path) rides under it. */
  function bubble(role, text, fix) {
    var log = $('cp-log');
    var b = document.createElement('div');
    b.className = 'cp-bubble cp-' + role;
    b.textContent = text;
    if (fix) {
      var f = document.createElement('div');
      f.className = 'cp-fix';
      f.textContent = fix;
      b.appendChild(f);
    }
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  /** History keeps only what was actually said — never an empty turn. */
  function remember(role, content) {
    if (!content || !String(content).trim()) return;
    history.push({ role: role, content: String(content) });
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  }

  function setBusy(v, note) {
    busy = v;
    var s = $('cp-status');
    if (s) s.textContent = note || '';
    var send = $('cp-send');
    if (send) send.disabled = v;
    var input = $('cp-input');
    if (input) input.disabled = v;
    // a reset mid-turn would wipe the thread the reply is about to join
    var reset = $('cp-reset');
    if (reset) reset.disabled = v;
  }

  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  /* The turn clock (v2.36, admin-turn-clock.js): one muted line in the log
     every 45 s while a turn runs — a local model reads for minutes before its
     first token. Turn-scoped: postChat recurses through the bridge driver, so
     the clock lives here and send/answerApproval start and stop it. */
  var turnClock = null;
  function startClock() {
    stopClock();
    if (!window.TapuzTurnClock) return;
    turnClock = TapuzTurnClock.start(function (text) {
      var b = bubble('system', text);
      b.classList.add('cp-clock');
    });
  }
  function stopClock() {
    if (turnClock) turnClock.stop();
    turnClock = null;
  }

  /** The chip in the head: `חלון 8,192 · מקוצר` — tooltip carries the sentence. */
  function showWindow(w, message) {
    var chip = $('cp-window');
    if (!chip || !w) return;
    var tier = w.tier === 'full' ? 'מלא' : (w.tier === 'compact' ? 'מקוצר' : '');
    // a cloud key has no window to measure (tokens null, tier full) — that is
    // not "unknown", it is unlimited; "unknown" is a small-window courier the
    // CMS could not read (old bridge, a server that is not LM Studio)
    var short = w.tokens ? 'חלון ' + fmt(w.tokens) : (w.tier === 'full' ? 'חלון ללא הגבלה' : 'חלון לא ידוע');
    if (tier) short += ' · ' + tier;
    if (w.promptTokens) short += ' · הפנייה האחרונה ' + fmt(w.promptTokens) + ' טוקנים';
    chip.textContent = short;
    if (message) chip.title = message;
    chip.hidden = false;
  }

  /** The bridge's measured window (0.5.0+) — the server plans against it. */
  function bridgeWindow() {
    return (window.TapuzBridge && TapuzBridge.window) ? TapuzBridge.window : null;
  }

  /* Ask the server what it knows about the model's window and say it once —
     the sentence names the tier and, when the window is small, the exact
     LM Studio click path. A route that is not there yet (older server)
     simply says nothing. */
  function welcomeWindow() {
    var q = '';
    var w = bridgeWindow();
    if (w) {
      q = '?tokens=' + encodeURIComponent(w.tokens) + '&source=bridge' +
        (w.maxTokens ? '&maxTokens=' + encodeURIComponent(w.maxTokens) : '') +
        (w.model ? '&model=' + encodeURIComponent(w.model) : '') +
        (w.bridgeVersion ? '&bridgeVersion=' + encodeURIComponent(w.bridgeVersion) : '');
    }
    fetch('/admin/api/ai/window' + q).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.ok) return;
      showWindow({ tokens: d.window && d.window.tokens, tier: d.tier }, d.message);
      if (d.message) bubble('system', d.message);
    }).catch(function () { /* no window route, no sentence */ });
  }

  function renderApproval(p) {
    var log = $('cp-log');
    var card = el(
      '<div class="cp-approve">' +
      '  <div class="cp-approve-txt"></div>' +
      '  <div class="cp-approve-row">' +
      '    <button type="button" class="cp-ok">✓ אשר — שמור כטיוטה</button>' +
      '    <button type="button" class="cp-no">✗ דחה</button>' +
      '  </div>' +
      '</div>');
    card.querySelector('.cp-approve-txt').textContent = p.summary || p.text || 'הקופיילוט מבקש לבצע שינוי';
    card.querySelector('.cp-ok').addEventListener('click', function () { answerApproval(card, p, true); });
    card.querySelector('.cp-no').addEventListener('click', function () { answerApproval(card, p, false); });
    log.appendChild(card);
    log.scrollTop = log.scrollHeight;
    openCard = card;
  }

  /** The server's `{ok:false, error, code, fix}` → one Error the bubbles can read. */
  function fail(d) {
    var e = new Error((d && d.error) || '?');
    if (d && d.code) e.code = d.code;
    if (d && d.fix) e.fix = d.fix;
    return e;
  }

  /* POST one payload; when the browser-relay provider answers with a
     modelCall continuation, TapuzBridge (loaded on the edit page) relays it
     to the local model and loops until a real reply arrives. The token count
     climbs in the status line while the model writes. */
  function postChat(payload) {
    return fetch('/admin/api/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && d.modelCall && window.TapuzBridge) {
        if (d.window) showWindow(d.window);
        if (d.notice) bubble('system', d.notice);
        return TapuzBridge.drive(d, postChat, undefined, function (p) {
          if (turnClock) turnClock.progress(p);
          setBusy(true, window.TapuzTurnClock ? TapuzTurnClock.status(p) : '✍ המודל שלכם כותב… ' + fmt(p.tokens || 0) + ' טוקנים');
        });
      }
      return d;
    });
  }

  /** What every finished turn shows: the window chip, notices, the words. */
  function absorb(d) {
    if (d.window) showWindow(d.window);
    if (d.notice) bubble('system', d.notice);
    var said = d.reply || d.memo || '';
    remember('assistant', said);
    if (d.reply) bubble('assistant', d.reply);
    else if (d.memo) bubble('system', d.memo);
    if (d.truncated) bubble('system', CUT_MSG);
  }

  function answerApproval(card, p, ok) {
    card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    if (openCard === card) openCard = null;
    setBusy(true, ok ? 'מבצע ושומר טיוטה…' : 'מודיע לקופיילוט…');
    startClock();
    postChat({ approve: { id: p.id, ok: ok }, window: bridgeWindow() || undefined }).then(function (d) {
      stopClock();
      if (!d.ok) throw fail(d);
      absorb(d);
      if (d.pending) { renderApproval(d.pending); setBusy(false, ''); return; }
      // the draft changed on disk — reload the builder to show it. `applied`
      // is the server's word (v2.32); an older server that has no such field
      // is trusted on the approval alone, as before.
      var landed = d.applied ? (d.applied.created ? 'נוצרה טיוטה' : 'הטיוטה עודכנה') : 'נשמר כטיוטה';
      if (d.applied || (ok && !('applied' in d))) {
        setBusy(true, '✓ ' + landed + ' — טוען מחדש…');
        setTimeout(function () { location.reload(); }, 900);
      } else {
        setBusy(false, '');
      }
    }).catch(function (e) {
      stopClock();
      bubble('system', 'שגיאה: ' + e.message, e.fix);
      setBusy(false, '');
    });
  }

  function send() {
    if (busy) return;
    var input = $('cp-input');
    var message = input.value.trim();
    if (!message) return;
    input.value = '';
    // a proposal left hanging is closed, and the model is told so — otherwise
    // its next turn still believes an answer is coming
    if (openCard) {
      openCard.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      openCard = null;
      remember('assistant', '(הצעה קודמת לא נענתה)');
    }
    bubble('user', message);
    // persist the canvas BEFORE the copilot reads/edits, so it sees the truth
    var saved = null;
    try { if (window.TapuzBuilder && TapuzBuilder.savePage) saved = TapuzBuilder.savePage({ silent: true }); } catch (e) { /* view-only */ }
    setBusy(true, 'חושב…');
    var ctx = { page: pageFullPath(), surface: 'builder' };
    var sel = selectedInfo();
    if (sel) ctx.selected = sel;
    var payload = { message: message, history: history, context: ctx };
    var w = bridgeWindow();
    if (w) payload.window = w;
    startClock();
    (saved && saved.then ? saved.catch(function () {}) : Promise.resolve()).then(function () {
      return postChat(payload);
    }).then(function (d) {
      stopClock();
      if (!d.ok) throw fail(d);
      remember('user', message);
      absorb(d);
      if (d.pending) renderApproval(d.pending);
      setBusy(false, '');
    }).catch(function (e) {
      stopClock();
      bubble('system', 'שגיאה: ' + e.message + (e.fix ? '' : ' — יש מפתח/מודל מקומי מוגדר? (⚙ /admin/chat)'), e.fix);
      setBusy(false, '');
    });
  }

  function reset() {
    history = [];
    openCard = null;
    var log = $('cp-log');
    if (log) log.innerHTML = '';
    bubble('system', 'שיחה חדשה. הדף נשאר כמו שהוא.');
  }

  function buildDrawer() {
    if (drawer) return drawer;
    drawer = el(
      '<div id="copilot-drawer" dir="rtl">' +
      '  <div class="cp-head">' +
      '    <strong>🤖 קופיילוט</strong>' +
      '    <span class="cp-sub">רואה את הדף והבחירה · כל שינוי = טיוטה באישורכם</span>' +
      '    <span id="cp-window" class="cp-window" hidden></span>' +
      '    <button type="button" id="cp-reset" title="שיחה חדשה — ההיסטוריה נמחקת, הדף לא">🆕</button>' +
      '    <button type="button" id="cp-close" aria-label="סגור">✕</button>' +
      '  </div>' +
      '  <div id="cp-log"></div>' +
      '  <div id="cp-status"></div>' +
      '  <div class="cp-compose">' +
      '    <textarea id="cp-input" rows="2" placeholder="למשל: הוסף לפריט המסומן טקסט על שעות הפתיחה"></textarea>' +
      '    <button type="button" id="cp-send">שלח</button>' +
      '  </div>' +
      '</div>');
    document.body.appendChild(drawer);
    $('cp-close').addEventListener('click', function () { drawer.classList.remove('open'); });
    $('cp-reset').addEventListener('click', reset);
    $('cp-send').addEventListener('click', send);
    $('cp-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    });
    var sel = selectedInfo();
    bubble('system', sel
      ? 'מחובר. רואה את הדף — והפריט המסומן (' + sel.type + '). בקשו שינוי; הוא יישמר כטיוטה רק באישורכם.'
      : 'מחובר. רואה את הדף. סמנו מודול כדי לומר "הוסף לזה טקסט…", או בקשו כל שינוי בדף.');
    // the bridge measures the window a beat after it says hello — ask once it
    // has settled (admin-bridge.js fires 'tapuz-bridge-window' on DOCUMENT,
    // not bubbling, after the probe resolves — with a window or with null),
    // or right away when it already has, or when there is no bridge at all
    // (server-side courier). 3 s is the cap, not the plan.
    var B = window.TapuzBridge;
    if (B && B.present && B.probeWindow && !B.windowSettled) {
      var asked = false;
      var once = function () {
        if (asked) return;
        asked = true;
        document.removeEventListener('tapuz-bridge-window', once);
        welcomeWindow();
      };
      document.addEventListener('tapuz-bridge-window', once);
      setTimeout(once, 3000);
    } else {
      welcomeWindow();
    }
    return drawer;
  }

  function toggle() {
    buildDrawer();
    drawer.classList.toggle('open');
    if (drawer.classList.contains('open')) $('cp-input').focus();
  }

  function boot() {
    // framed inside the copilot screen the parent owns the conversation
    if (window.__TAPUZ_EMBED__) return;
    var btn = document.getElementById('btn-copilot');
    if (btn) btn.addEventListener('click', toggle);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.TapuzCopilotPanel = { toggle: toggle, reset: reset };
})();
