/* Tapuziel builder — the copilot drawer (v1.71).
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
 */
(function () {
  'use strict';

  var history = []; // [{role, content}] — same contract as /admin/chat
  var drawer = null;
  var busy = false;

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

  function bubble(role, text) {
    var log = $('cp-log');
    var b = document.createElement('div');
    b.className = 'cp-bubble cp-' + role;
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  function setBusy(v, note) {
    busy = v;
    var s = $('cp-status');
    if (s) s.textContent = note || '';
    var send = $('cp-send');
    if (send) send.disabled = v;
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
  }

  /* POST one payload; when the browser-relay provider answers with a
     modelCall continuation, TapuzBridge (loaded on the edit page) relays it
     to the local model and loops until a real reply arrives. */
  function postChat(payload) {
    return fetch('/admin/api/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && d.modelCall && window.TapuzBridge) return TapuzBridge.drive(d, postChat);
      return d;
    });
  }

  function answerApproval(card, p, ok) {
    card.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    setBusy(true, ok ? 'מבצע ושומר טיוטה…' : 'מודיע לקופיילוט…');
    postChat({ approve: { id: p.id, ok: ok } }).then(function (d) {
      if (!d.ok) throw new Error(d.error || '?');
      if (d.reply) { history.push({ role: 'assistant', content: d.reply }); bubble('assistant', d.reply); }
      if (d.pending) { renderApproval(d.pending); setBusy(false, ''); return; }
      if (ok) {
        // the draft changed on disk — reload the builder to show it.
        setBusy(true, '✓ נשמר כטיוטה — טוען מחדש…');
        setTimeout(function () { location.reload(); }, 900);
      } else {
        setBusy(false, '');
      }
    }).catch(function (e) {
      bubble('system', 'שגיאה: ' + e.message);
      setBusy(false, '');
    });
  }

  function send() {
    if (busy) return;
    var input = $('cp-input');
    var message = input.value.trim();
    if (!message) return;
    input.value = '';
    bubble('user', message);
    // persist the canvas BEFORE the copilot reads/edits, so it sees the truth
    try { if (window.TapuzBuilder && TapuzBuilder.savePage) TapuzBuilder.savePage({ silent: true }); } catch (e) { /* view-only */ }
    setBusy(true, 'חושב…');
    var ctx = { page: pageFullPath() };
    var sel = selectedInfo();
    if (sel) ctx.selected = sel;
    postChat({ message: message, history: history, context: ctx }).then(function (d) {
      if (!d.ok) throw new Error(d.error || '?');
      history.push({ role: 'user', content: message }, { role: 'assistant', content: d.reply || '' });
      if (d.reply) bubble('assistant', d.reply);
      if (d.pending) renderApproval(d.pending);
      setBusy(false, '');
    }).catch(function (e) {
      bubble('system', 'שגיאה: ' + e.message + ' — יש מפתח/מודל מקומי מוגדר? (⚙ /admin/chat)');
      setBusy(false, '');
    });
  }

  function buildDrawer() {
    if (drawer) return drawer;
    drawer = el(
      '<div id="copilot-drawer" dir="rtl">' +
      '  <div class="cp-head">' +
      '    <strong>🤖 קופיילוט</strong>' +
      '    <span class="cp-sub">רואה את הדף והבחירה · כל שינוי = טיוטה באישורכם</span>' +
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
    $('cp-send').addEventListener('click', send);
    $('cp-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
    });
    var sel = selectedInfo();
    bubble('system', sel
      ? 'מחובר. רואה את הדף — והפריט המסומן (' + sel.type + '). בקשו שינוי; הוא יישמר כטיוטה רק באישורכם.'
      : 'מחובר. רואה את הדף. סמנו מודול כדי לומר "הוסף לזה טקסט…", או בקשו כל שינוי בדף.');
    return drawer;
  }

  function toggle() {
    buildDrawer();
    drawer.classList.toggle('open');
    if (drawer.classList.contains('open')) $('cp-input').focus();
  }

  function boot() {
    var btn = document.getElementById('btn-copilot');
    if (btn) btn.addEventListener('click', toggle);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.TapuzCopilotPanel = { toggle: toggle };
})();
