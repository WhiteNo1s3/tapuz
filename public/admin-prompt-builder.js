/* Tapuziel builder — the prompt builder (v1.69).
 *
 * Ben's flow: injection is retired everywhere — the ECOSYSTEM is: press one
 * button in the page builder → get a complete, copyable prompt (roleplay pack
 * + optional current page source + your brief) → paste it in YOUR chat →
 * the extension watches the reply and publishes the .pzn. We hand tools;
 * the user does the pasting.
 *
 * Self-contained IIFE like the tour: wires #btn-prompt-builder (in the
 * template), builds its modal lazily, talks only to our own admin APIs.
 */
(function () {
  'use strict';

  var modal = null;

  function pageFullPath() {
    var m = location.pathname.match(/^\/admin\/edit\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function el(tag, css, html) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function buildModal() {
    if (modal) return modal;
    modal = el('div', '', '');
    modal.id = 'prompt-modal';
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal-content" style="max-width:560px">' +
      '  <h3 class="sub-head">🧠 בונה הפרומפטים</h3>' +
      '  <p class="lead" style="margin-top:0">פרומפט מלא לצ׳אט ה-AI שלכם — בלי מפתח, בלי חיבור.' +
      '     הדביקו אותו בצ׳אט; התוסף (🍊) יאסוף את התשובה ויפרסם אותה כטיוטה.</p>' +
      '  <label style="display:block;font-weight:600;margin-bottom:6px">מה לבנות או לשנות?</label>' +
      '  <textarea id="pb-brief" rows="4" style="width:100%;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px;resize:vertical" placeholder="למשל: הוסיפו מדור המלצות עם שלוש קוביות, ושנו את צבע ה-Hero לכתום"></textarea>' +
      '  <label style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer">' +
      '    <input type="checkbox" id="pb-include-page" checked> צרפו את הדף הנוכחי — ה-AI יערוך אותו במקום לבנות מאפס' +
      '  </label>' +
      '  <label style="display:flex;align-items:center;gap:8px;margin-top:6px;cursor:pointer" title="מילון מקוצר שנכנס במגבלת האורך של הודעה בחשבון חינמי">' +
      '    <input type="checkbox" id="pb-lite"> חשבון צ׳אט חינמי — חבילה חסכונית' +
      '  </label>' +
      '  <div id="pb-status" style="margin-top:10px;font-size:0.9rem;color:#64748b"></div>' +
      '  <div style="margin-top:14px;display:flex;justify-content:space-between;gap:10px">' +
      '    <button type="button" class="btn" id="pb-copy">📋 צור והעתק</button>' +
      '    <button type="button" class="btn secondary" id="pb-close">סגור</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (ev) { if (ev.target === modal) close(); });
    modal.querySelector('#pb-close').addEventListener('click', close);
    modal.querySelector('#pb-copy').addEventListener('click', createAndCopy);
    return modal;
  }

  function open() {
    buildModal();
    modal.classList.add('open');
    modal.style.display = 'flex';
    var t = modal.querySelector('#pb-brief');
    if (t) t.focus();
  }
  function close() {
    if (!modal) return;
    modal.classList.remove('open');
    modal.style.display = 'none';
  }

  function status(txt, ok) {
    var s = modal.querySelector('#pb-status');
    s.textContent = txt;
    s.style.color = ok === false ? '#dc2626' : ok ? '#059669' : '#64748b';
  }

  function createAndCopy() {
    var brief = modal.querySelector('#pb-brief').value.trim();
    var lite = modal.querySelector('#pb-lite').checked;
    var withPage = modal.querySelector('#pb-include-page').checked;
    var full = pageFullPath();
    status('בונה את הפרומפט…');

    var q = new URLSearchParams({ format: 'roleplay', locale: 'he' });
    if (brief) q.set('brief', brief);
    if (lite) q.set('size', 'lite');

    var packP = fetch('/admin/api/inject-pack?' + q.toString()).then(function (r) {
      if (!r.ok) throw new Error('pack HTTP ' + r.status);
      return r.text();
    });
    var srcP = withPage && full
      ? fetch('/admin/api/pzn/source?fullPath=' + encodeURIComponent(full) + '&kind=draft')
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
      : Promise.resolve(null);

    Promise.all([packP, srcP]).then(function (res) {
      var prompt = res[0];
      var src = res[1];
      if (src && src.ok && src.source) {
        prompt += '\n\n---\n\n## הדף הנוכחי — ערכו אותו (אל תבנו מאפס)\n' +
          'זה המקור המלא של הדף כפי שהוא עכשיו. החזירו את המסמך המלא עם השינויים המבוקשים בלבד:\n\n' +
          '```html\n' + src.source + '\n```\n';
      }
      return navigator.clipboard.writeText(prompt).then(function () {
        var kb = (prompt.length / 1000).toFixed(1);
        status('✅ הועתק (' + kb + 'K תווים) — הדביקו בצ׳אט שלכם; 🍊 בתוסף יפרסם את התשובה', true);
      });
    }).catch(function (e) {
      status('שגיאה: ' + e.message, false);
    });
  }

  function boot() {
    var btn = document.getElementById('btn-prompt-builder');
    if (btn) btn.addEventListener('click', open);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.TapuzPromptBuilder = { open: open };
})();
