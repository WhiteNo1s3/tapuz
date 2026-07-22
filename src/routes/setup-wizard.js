'use strict';

/**
 * First-run setup wizard — the twenty-fourth route-group extraction. The
 * four-step onboarding (name → colors/look → pages → menu) that a pristine
 * install lands on, plus its POST that runs the wizard through
 * src/setup.js and builds the site skeleton. Guarded by the now-shared
 * needsSetup() (v1.30): if setup's already done, both routes bounce to
 * /admin. The MOODS in the color step are the same LOOKS constant the
 * theme screen uses (one source of truth), fed to the page as WIZ_LOOKS.
 */

const express = require('express');
const { runSetup, needsSetup } = require('../setup');
const { LOOKS } = require('../theme');
const { layout } = require('../admin-ui');

const router = express.Router();

router.get('/admin/setup', (req, res) => {
  if (!needsSetup()) return res.redirect('/admin');
  const html = `
    <style>
      .wiz-steps { display:flex;justify-content:center;gap:6px;margin-bottom:22px;flex-wrap:wrap }
      .wiz-step-dot { display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:0.82rem;font-weight:600 }
      .wiz-step-dot.active { background:#0a66c2;color:#fff }
      .wiz-step-dot.done { background:#dcfce7;color:#166534 }
      .wiz-panel { display:none }
      .wiz-panel.active { display:block }
      .wiz-card { background:var(--ws-panel);border:1px solid var(--accent-line);border-radius:var(--r-xl);padding:26px;box-shadow:var(--elev-2) }
      .wiz-input { width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box }
      .wiz-nav { display:flex;justify-content:space-between;gap:10px;margin-top:20px }
      .wiz-teach { background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;border-radius:10px;padding:10px 14px;font-size:0.85rem;margin-bottom:16px;line-height:1.5 }
      .wiz-palettes { display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:16px }
      .wiz-palette { border:2px solid #e2e8f0;border-radius:10px;padding:8px;cursor:pointer;text-align:center;background:#fff }
      .wiz-palette.selected { border-color:#0a66c2 }
      .wiz-palette .sw { display:flex;height:22px;border-radius:6px;overflow:hidden;margin-bottom:6px }
      .wiz-palette .sw span { flex:1 }
      .wiz-palette small { font-size:0.75rem;color:#475569;font-weight:600 }
      .wiz-colors { display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px }
      .wiz-color-row { display:flex;align-items:center;gap:8px;font-size:0.85rem }
      .wiz-color-row input[type=color] { width:40px;height:32px;border:1px solid #cbd5e1;border-radius:8px;padding:2px;flex-shrink:0 }
      .wiz-preview { border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-top:8px }
      .wiz-check { display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;cursor:pointer }
      .wiz-check input { margin-top:3px }
      .wiz-check strong { display:block }
      .wiz-check small { color:#64748b }
      .wiz-ext-row { display:flex;gap:8px;margin-bottom:8px }
    </style>
    <div class="container page-body" style="max-width:640px">
      <div style="text-align:center;margin-bottom:18px">
        <div style="font-size:3rem">🍊</div>
        <h1 style="margin:8px 0 4px">ברוכים הבאים ל־Tapuziel</h1>
        <p class="lead">מהרעיון שבראש — לאתר חי. ארבעה צעדים, הכל ניתן לשינוי אחר כך.</p>
      </div>
      <div class="wiz-steps">
        <span class="wiz-step-dot" data-dot="0">1 · שם</span>
        <span class="wiz-step-dot" data-dot="1">2 · צבעים</span>
        <span class="wiz-step-dot" data-dot="2">3 · דפים</span>
        <span class="wiz-step-dot" data-dot="3">4 · תפריט</span>
      </div>

      <div class="wiz-card">
        <!-- Step 1: name -->
        <div class="wiz-panel" data-panel="0">
          <label class="field-label">איך קוראים לאתר?</label>
          <input id="wiz-title" class="wiz-input" required maxlength="60" placeholder="השם שיופיע בכותרת">
          <input id="wiz-desc" class="wiz-input" maxlength="160" placeholder="משפט קצר על האתר (לא חובה)" style="margin-top:8px">
        </div>

        <!-- Step 2: coloring = the theme creator, taught live. The MOODS here
             are the same LOOKS constant the theme screen uses (one source of
             truth in the CMS) — a card click sets the whole personality. -->
        <div class="wiz-panel" data-panel="1">
          <div class="wiz-teach">🎨 <strong>זהו יוצר ערכת הנושא.</strong> בחרו מראה מוכן — צבעים, פינות וצללים בלחיצה אחת. הכל מחכה לכם אחר כך במסך "ערכת נושא", לשינוי מתי שרוצים.</div>
          <label style="font-weight:600;display:block;margin-bottom:8px">איזה מראה מתאים לאתר שלכם?</label>
          <div class="wiz-palettes" id="wiz-looks"></div>
          <details style="margin-bottom:16px">
            <summary style="cursor:pointer;font-weight:600;color:#475569;font-size:.9rem">כיוונון עדין (לא חובה)</summary>
            <div class="wiz-colors" style="margin-top:10px">
              <label class="wiz-color-row"><input type="color" id="wc-primary" value="#ea580c"> ראשי (כפתורים וקישורים)</label>
              <label class="wiz-color-row"><input type="color" id="wc-text" value="#1c1917"> טקסט</label>
              <label class="wiz-color-row"><input type="color" id="wc-bg" value="#fffbf7"> רקע</label>
              <label class="wiz-color-row"><input type="color" id="wc-lightBg" value="#fdf1e6"> רקע משני</label>
            </div>
          </details>
          <label class="field-label">איפה התפריט?</label>
          <select id="wiz-menu-placement" class="wiz-input" style="max-width:220px">
            <option value="top">למעלה (קלאסי)</option>
            <option value="side">בצד</option>
          </select>
          <div class="wiz-preview" id="wiz-preview"></div>
        </div>

        <!-- Step 3: default pages -->
        <div class="wiz-panel" data-panel="2">
          <div class="wiz-teach">📄 ניצור לכם את שלד האתר. כל דף נפתח אחר כך בבונה הדפים — מודולים, גרירה, הכל.</div>
          <label class="wiz-check"><input type="checkbox" checked disabled data-page="home"><span><strong>דף הבית</strong><small>סיור צבעוני בארגז הכלים — גלריה, קרוסלה, מבזקים ועוד. כל קטע ניתן לעריכה או למחיקה</small></span></label>
          <label class="wiz-check"><input type="checkbox" checked data-page="about"><span><strong>אודות</strong><small>מי אתם ולמה אתם כאן</small></span></label>
          <label class="wiz-check"><input type="checkbox" checked data-page="contact"><span><strong>צור קשר</strong><small>דף פנייה — טופס יגיע בשלב ה־CRM</small></span></label>
          <label class="wiz-check"><input type="checkbox" checked data-page="articles"><span><strong>מאמרים</strong><small>קוביות מאמרים חכמות (מודול article-list) + מאמר ראשון לדוגמה</small></span></label>
        </div>

        <!-- Step 4: menu -->
        <div class="wiz-panel" data-panel="3">
          <div class="wiz-teach">🧭 <strong>התפריט של התפריטים.</strong> בחרו מה ייכנס לתפריט הראשי — מהדפים שיצרנו, או קישור לאתר חיצוני.</div>
          <div id="wiz-menu-pages"></div>
          <label style="font-weight:600;display:block;margin:14px 0 6px">קישורים חיצוניים (לא חובה)</label>
          <div class="wiz-ext-row"><input class="wiz-input" id="ext-label-1" placeholder="שם הקישור"><input class="wiz-input" id="ext-url-1" dir="ltr" placeholder="https://..."></div>
          <div class="wiz-ext-row"><input class="wiz-input" id="ext-label-2" placeholder="שם הקישור"><input class="wiz-input" id="ext-url-2" dir="ltr" placeholder="https://..."></div>
        </div>

        <div class="wiz-nav">
          <button type="button" class="btn secondary" id="wiz-back" style="visibility:hidden">→ הקודם</button>
          <button type="button" class="btn" id="wiz-next">הבא ←</button>
        </div>
        <p id="wiz-err" style="color:#b91c1c;font-size:0.85rem;margin:10px 0 0;display:none"></p>
      </div>
    </div>
    <script>window.WIZ_LOOKS = ${JSON.stringify(LOOKS)};</script>
    <script>
      (function () {
        var PAGE_LABELS = { home: 'דף הבית', about: 'אודות', contact: 'צור קשר', articles: 'מאמרים' };
        var selectedLook = 'tapuz'; // the brand default — a site is never colorless
        var step = 0;
        var TOTAL = 4;

        function q(id) { return document.getElementById(id); }
        function colors() {
          return { primary: q('wc-primary').value, text: q('wc-text').value, bg: q('wc-bg').value, lightBg: q('wc-lightBg').value };
        }
        function selectedPages() {
          var out = ['home'];
          document.querySelectorAll('[data-page]').forEach(function (cb) {
            if (cb.dataset.page !== 'home' && cb.checked) out.push(cb.dataset.page);
          });
          return out;
        }

        function lookStyle() {
          var lk = window.WIZ_LOOKS[selectedLook];
          return (lk && lk.overrides && lk.overrides.style) || { radius: 'soft', shadow: 'soft', accent: 'gradient' };
        }
        function renderLooks() {
          var box = q('wiz-looks');
          var keys = Object.keys(window.WIZ_LOOKS);
          box.innerHTML = keys.map(function (key) {
            var lk = window.WIZ_LOOKS[key];
            var c = lk.overrides.colors;
            return '<div class="wiz-palette' + (key === selectedLook ? ' selected' : '') + '" data-look="' + key + '">' +
              '<div style="font-size:1.3rem;line-height:1;margin-bottom:4px">' + (lk.emoji || '🎨') + '</div>' +
              '<div class="sw"><span style="background:' + c.primary + '"></span><span style="background:' + c.secondary + '"></span><span style="background:' + c.bg + ';border:1px solid #e2e8f0"></span><span style="background:' + c.text + '"></span></div>' +
              '<small>' + lk.label + '</small></div>';
          }).join('');
          box.querySelectorAll('[data-look]').forEach(function (el) {
            el.addEventListener('click', function () {
              selectedLook = el.dataset.look;
              var c = window.WIZ_LOOKS[selectedLook].overrides.colors;
              q('wc-primary').value = c.primary; q('wc-text').value = c.text;
              q('wc-bg').value = c.bg; q('wc-lightBg').value = c.lightBg;
              box.querySelectorAll('.wiz-palette').forEach(function (x) { x.classList.remove('selected'); });
              el.classList.add('selected');
              renderPreview();
            });
          });
        }

        function renderPreview() {
          var c = colors();
          var st = lookStyle();
          var lookColors = (window.WIZ_LOOKS[selectedLook] || { overrides: { colors: {} } }).overrides.colors || {};
          var radius = st.radius === 'sharp' ? '4px' : st.radius === 'round' ? '14px' : '8px';
          var btnBg = st.accent === 'gradient'
            ? 'linear-gradient(135deg,' + c.primary + ',' + (lookColors.secondary || c.primary) + ')'
            : c.primary;
          var side = q('wiz-menu-placement').value === 'side';
          var title = (q('wiz-title').value || 'האתר שלי');
          q('wiz-preview').innerHTML =
            '<div style="background:' + c.bg + ';color:' + c.text + ';font-size:12px">' +
            '<div style="display:flex;' + (side ? 'flex-direction:column;align-items:flex-start;gap:4px;' : 'justify-content:space-between;align-items:center;') + 'padding:8px 12px;border-bottom:1px solid ' + c.lightBg + '">' +
            '<strong>' + title.replace(/</g, '&lt;') + '</strong>' +
            '<span style="display:flex;' + (side ? 'flex-direction:column;gap:2px;' : 'gap:10px;') + '">' +
            selectedPages().map(function (p) { return '<span style="color:' + c.primary + '">' + PAGE_LABELS[p] + '</span>'; }).join('') +
            '</span></div>' +
            '<div style="text-align:center;padding:18px 12px;background:' + c.lightBg + '"><div style="font-size:16px;font-weight:800">' + title.replace(/</g, '&lt;') + '</div>' +
            '<span style="display:inline-block;margin-top:8px;background:' + btnBg + ';color:#fff;border-radius:' + radius + ';padding:4px 14px">כפתור ראשי</span></div>' +
            '<div style="display:flex;gap:8px;padding:10px 12px">' +
            '<div style="flex:1;border:1px solid ' + c.lightBg + ';border-radius:8px;overflow:hidden"><div style="height:26px;background:' + c.lightBg + '"></div><div style="padding:6px;font-weight:700">קוביית מאמר</div></div>' +
            '<div style="flex:1;border:1px solid ' + c.lightBg + ';border-radius:8px;overflow:hidden"><div style="height:26px;background:' + c.lightBg + '"></div><div style="padding:6px;font-weight:700">קוביית מאמר</div></div>' +
            '</div></div>';
        }

        function renderMenuStep() {
          q('wiz-menu-pages').innerHTML = selectedPages().map(function (p) {
            return '<label class="wiz-check"><input type="checkbox" checked data-menu-page="' + p + '"><span><strong>' + PAGE_LABELS[p] + '</strong></span></label>';
          }).join('');
        }

        function show(n) {
          step = n;
          document.querySelectorAll('.wiz-panel').forEach(function (el) {
            el.classList.toggle('active', parseInt(el.dataset.panel, 10) === n);
          });
          document.querySelectorAll('.wiz-step-dot').forEach(function (el) {
            var i = parseInt(el.dataset.dot, 10);
            el.classList.toggle('active', i === n);
            el.classList.toggle('done', i < n);
          });
          q('wiz-back').style.visibility = n === 0 ? 'hidden' : 'visible';
          q('wiz-next').textContent = n === TOTAL - 1 ? 'צור את האתר שלי ✨' : 'הבא ←';
          if (n === 1) renderPreview();
          if (n === 3) renderMenuStep();
        }

        function fail(msg) { var e = q('wiz-err'); e.textContent = msg; e.style.display = 'block'; }

        function submit() {
          var menuPages = [];
          document.querySelectorAll('[data-menu-page]').forEach(function (cb) {
            if (cb.checked) menuPages.push(cb.dataset.menuPage);
          });
          var external = [];
          [1, 2].forEach(function (i) {
            var label = q('ext-label-' + i).value.trim();
            var url = q('ext-url-' + i).value.trim();
            if (label && url) external.push({ label: label, url: url });
          });
          q('wiz-next').disabled = true;
          fetch('/admin/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: q('wiz-title').value.trim(),
              description: q('wiz-desc').value.trim(),
              look: selectedLook,
              colors: colors(),
              menuPlacement: q('wiz-menu-placement').value,
              pages: selectedPages(),
              menuPages: menuPages,
              external: external
            })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) { window.location.href = '/admin?built=1'; }
            else { q('wiz-next').disabled = false; fail('שגיאה: ' + (d.error || '')); }
          }).catch(function () { q('wiz-next').disabled = false; fail('שגיאה בתקשורת עם השרת'); });
        }

        q('wiz-next').addEventListener('click', function () {
          q('wiz-err').style.display = 'none';
          if (step === 0 && !q('wiz-title').value.trim()) return fail('צריך שם לאתר כדי להמשיך');
          if (step === TOTAL - 1) return submit();
          show(step + 1);
        });
        q('wiz-back').addEventListener('click', function () { if (step > 0) show(step - 1); });
        ['wc-primary', 'wc-text', 'wc-bg', 'wc-lightBg'].forEach(function (id) {
          q(id).addEventListener('input', renderPreview);
        });
        q('wiz-menu-placement').addEventListener('change', renderPreview);
        document.querySelectorAll('[data-page]').forEach(function (cb) {
          cb.addEventListener('change', renderPreview);
        });

        renderLooks();
        show(0);
      })();
    </script>
  `;
  res.send(layout(html, 'התקנה ראשונית', '#f97316'));
});

router.post('/admin/setup', (req, res) => {
  try {
    if (!needsSetup()) return res.status(409).json({ ok: false, error: 'ההתקנה כבר בוצעה' });
    const result = runSetup(req.body || {});
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
