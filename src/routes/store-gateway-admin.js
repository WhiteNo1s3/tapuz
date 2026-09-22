'use strict';

/**
 * The card gateway's ADMIN (src/store/gateway) — the "סליקת אשראי" screen
 * and the actions that move money:
 *
 *   GET  /admin/store/gateway                       the screen
 *   GET  /admin/api/store/gateway                   the redacted settings
 *   POST /admin/api/store/gateway                   save provider / mode / keys
 *   POST /admin/api/store/gateway/test              a ₪1 session in the current mode
 *   POST /admin/api/store/orders/:number/refund     refund one payment row (typed confirmation)
 *   POST /admin/api/store/orders/:number/payments/:id/verify   the owner's own check of one row
 *   POST /admin/api/store/orders/:number/payments/:id/refund-done      "ההחזר בוצע" — an unknown outcome, resolved
 *   POST /admin/api/store/orders/:number/payments/:id/refund-release   "ההחזר לא בוצע" — the sum given back
 *
 * Every route is requireAdmin. The screen shows readiness, the mode, the
 * provider and a last-4 tail per key — a value is typed in and never read
 * back (config/payments.json, gitignored). Switching to live mode asks for
 * an explicit confirm in the browser AND is a separate field on the wire
 * (`confirmLive: true`, refused without it by saveAdminSettings), so a
 * stray form save cannot flip it. The ₪1 test page's address is shown in
 * test mode only — a live one is a payable link.
 */

const express = require('express');
const { requireAdmin } = require('../admin-guard');
const kit = require('../store/admin-kit');

const router = express.Router();
const { esc } = kit;

function store() { return require('../store'); }
function gateway() { return require('../store/gateway'); }

function sendError(res, e, status = 400) {
  res.status(status).json({ ok: false, error: e && e.message ? e.message : String(e) });
}

router.get('/admin/store/gateway', requireAdmin, (req, res) => {
  const gw = gateway();
  const a = gw.adminSettings();
  const modeLabel = a.mode === 'live' ? 'אמיתי' : 'בדיקות';
  const stateLine = a.ready
    ? `<span class="pill ok">מחובר</span> ${esc(a.providers.find((p) => p.id === a.provider) ? a.providers.find((p) => p.id === a.provider).label : a.provider)} · מצב ${esc(modeLabel)}`
    : `<span class="pill ${a.connected ? 'warn' : ''}">${a.connected ? 'מחובר, אבל' : 'לא מחובר'}</span> ${esc(a.reasons.join(' · '))}`;
  const checks = [
    [!!a.provider, a.provider ? 'חברת סליקה: ' + esc(a.provider) : 'לא נבחרה חברת סליקה'],
    [a.connected, a.connected ? 'פרטי החיבור מלאים' : 'חסרים פרטי חיבור'],
    [a.hasCardMethod, a.hasCardMethod ? 'יש אמצעי תשלום מסוג "כרטיס אשראי" בקופה' : 'אין עדיין אמצעי תשלום מסוג "כרטיס אשראי" — <a href="/admin/store/settings#payments">להוספה במשלוח ותשלום</a>'],
    // an https site address is needed in BOTH modes: the provider returns the buyer to it and posts its callback to it
    [a.https, a.https
      ? 'כתובת האתר (https) מוגדרת: ' + esc(a.baseUrl)
      : 'חסרה כתובת אתר https — <a href="/admin/settings">הגדרות האתר → "כתובת בסיס (baseUrl)"</a>' + (a.baseUrl ? ' (עכשיו: ' + esc(a.baseUrl) + ' — חייבת להתחיל ב-https)' : '') + '. חברת הסליקה מחזירה אליה את הקונה ושולחת אליה את הודעת התשלום, בשני המצבים'],
    [true, a.mode === 'live' ? 'מצב אמיתי — גבייה בפועל' : 'מצב בדיקות — הקונים יראו "לא יחויב כסף אמיתי", והזמנות בדיקה לא יסומנו כשולמו']
  ];
  const fieldRow = (p, f) => `<label class="st-gw-field">
      <span>${esc(f.label)}${f.required ? ' <span aria-hidden="true">*</span>' : ''}</span>
      <span class="st-gw-input">
        <input class="input" type="password" autocomplete="new-password" spellcheck="false" dir="ltr"
          data-provider="${esc(p.id)}" data-key="${esc(f.key)}" data-set="${f.set ? '1' : '0'}"
          placeholder="${f.set ? esc('שמור · ' + (f.tail ? '‎••••' + f.tail : '••••')) : 'לא הוזן'}">
        <button type="button" class="btn xs secondary" data-clear title="מחיקת הערך השמור"${f.set ? '' : ' hidden'}>✕</button>
      </span>
      ${f.hint ? `<span class="faint">${esc(f.hint)}</span>` : ''}
    </label>`;
  const providerBlocks = a.providers.map((p) => `
    <fieldset class="st-gw-provider" data-provider-block="${esc(p.id)}"${p.id === a.provider ? '' : ' hidden'}>
      <legend>${esc(p.label)}</legend>
      <p class="faint">סולקת ב: ${p.currencies.map(esc).join(', ')}${p.refunds ? ' · החזרים דרך המערכת' + (p.partialRefund ? ' (גם חלקיים)' : ' (מלאים בלבד)') : ' · החזרים רק מהממשק של החברה'}.</p>
      ${p.fields.map((f) => fieldRow(p, f)).join('')}
      ${p.needsWebhookUrl ? `<div class="st-gw-hook"><b>כתובת ההודעות (Webhook) להדבקה בפאנל של ${esc(p.label)}:</b>
        ${a.webhookUrl && a.provider === p.id ? `<code dir="ltr" id="gw-hook-url">${esc(a.webhookUrl)}</code> <button type="button" class="btn xs secondary" id="gw-copy">העתקה</button>` : '<span class="faint">תוצג אחרי בחירת החברה ושמירה' + (a.baseUrl ? '' : ' (דורשת כתובת אתר בהגדרות האתר)') + '</span>'}
      </div>` : ''}
    </fieldset>`).join('');

  const body = `
    <section class="card">
      <h2 class="sub-head">💳 סליקת אשראי</h2>
      <p class="lead">הקונה משלם בדף המאובטח של חברת הסליקה, והשרת שלכם מאמת את התשלום מול החברה לפני שההזמנה מסומנת כשולמה. פרטי כרטיס לא עוברים דרך האתר; המפתחות של החברה נשמרים בשרת בלבד — לא בגיבוי ה-‎.pzn ולא בחבילת האתר, כך שאתר משוחזר במכונה אחרת יראה "לא מחובר" עד שיוזנו שם מחדש.</p>
      <p class="st-gw-state">${stateLine}</p>
      <ul class="st-checks">${checks.map(([ok, text]) => `<li class="${ok ? 'is-ok' : 'is-todo'}"><span class="st-check-mark">${ok ? '✓' : '•'}</span><span>${text}</span></li>`).join('')}</ul>
    </section>

    <form id="gw-form" class="stack" onsubmit="return false">
    <section class="card">
      <h3 class="sub-head">⚙️ חברת הסליקה והמצב</h3>
      <div class="st-grid2">
        <label>חברת סליקה <select class="input" name="provider">
          <option value=""${a.provider ? '' : ' selected'}>— לא מחובר —</option>
          ${a.providers.map((p) => `<option value="${esc(p.id)}"${p.id === a.provider ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select></label>
        <div>
          <span style="font-weight:600;font-size:0.88rem">מצב</span><br>
          <label class="st-inline"><input type="radio" name="mode" value="test"${a.mode === 'live' ? '' : ' checked'}> בדיקות — לא יחויב כסף אמיתי</label>
          <label class="st-inline"><input type="radio" name="mode" value="live"${a.mode === 'live' ? ' checked' : ''}> אמיתי — גבייה בפועל</label>
        </div>
      </div>
      <p class="faint">מה זה "בדיקות" אצל כל חברה: ב-Cardcom — מסוף הבדיקות 1000 על אותו שרת (עסקאות עוברות בלי חיוב; כל מסוף אחר מחייב כסף אמיתי, ולכן נדחה במצב בדיקות); ב-Grow — שרת ה-sandbox עם מזהי sandbox נפרדים. בשני המקרים הקופה מציגה לקונים "מצב בדיקות" והזמנות בדיקה לא מסומנות כשולמו. המעבר למצב אמיתי דורש אישור מפורש, וכתובת אתר https נדרשת בשני המצבים.</p>
    </section>

    <section class="card" id="gw-keys">
      <h3 class="sub-head">🔑 פרטי החיבור</h3>
      <p class="faint">שדה שכבר נשמר מוצג כ"שמור" עם ארבעת התווים האחרונים בלבד. שדה ריק בשמירה = בלי שינוי; ✕ מוחק את הערך השמור.</p>
      ${providerBlocks}
      ${a.providers.length ? '' : '<p class="faint">אין ספקי סליקה זמינים בגרסה זו.</p>'}
    </section>

    <div class="row end st-savebar">
      <span id="gw-out" aria-live="polite"></span>
      <button type="button" class="btn secondary" id="gw-test"${a.connected ? '' : ' disabled'}>🔌 בדיקת חיבור (דף של ₪1, בלי חיוב)</button>
      <button type="button" class="btn" id="gw-save">שמירה</button>
    </div>
    </form>
    <script>
    (function () {
      var form = document.getElementById('gw-form');
      if (!form) return;
      var out = document.getElementById('gw-out');
      var initialMode = ${JSON.stringify(a.mode)};
      var liveConfirmed = false; // set only by the confirm() below — and sent on the wire as confirmLive
      var sel = form.querySelector('[name="provider"]');
      function showProvider() {
        var want = sel.value;
        Array.prototype.forEach.call(form.querySelectorAll('[data-provider-block]'), function (b) {
          b.hidden = b.getAttribute('data-provider-block') !== want;
        });
      }
      sel.addEventListener('change', showProvider);
      showProvider();
      Array.prototype.forEach.call(form.querySelectorAll('[name="mode"]'), function (r) {
        r.addEventListener('change', function () {
          if (r.value === 'live' && r.checked && initialMode !== 'live') {
            liveConfirmed = confirm('לעבור למצב אמיתי? מכאן והלאה קונים יחויבו בכסף אמיתי דרך חברת הסליקה. ודאו שהמפתחות הם מפתחות הייצור ושכתובת האתר (https) מוגדרת.');
            if (!liveConfirmed) form.querySelector('[name="mode"][value="test"]').checked = true;
          }
        });
      });
      form.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('[data-clear]');
        if (!b) return;
        var input = b.parentNode.querySelector('input');
        if (!confirm('למחוק את הערך השמור של השדה?')) return;
        input.value = '';
        input.setAttribute('data-cleared', '1');
        input.placeholder = 'יימחק בשמירה';
        b.hidden = true;
      });
      function payload() {
        var fields = {};
        Array.prototype.forEach.call(form.querySelectorAll('input[data-key]'), function (i) {
          var p = i.getAttribute('data-provider');
          fields[p] = fields[p] || {};
          if (i.value) fields[p][i.getAttribute('data-key')] = i.value;
          else if (i.getAttribute('data-cleared') === '1') fields[p][i.getAttribute('data-key')] = '';
        });
        var mode = form.querySelector('[name="mode"]:checked');
        var want = mode ? mode.value : 'test';
        return { provider: sel.value, mode: want, confirmLive: want === 'live' && (initialMode === 'live' || liveConfirmed), fields: fields };
      }
      document.getElementById('gw-save').addEventListener('click', function () {
        out.textContent = 'שומרים…'; out.className = '';
        fetch('/admin/api/store/gateway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) { out.textContent = d.error || 'שגיאה'; out.className = 'st-bad'; return; }
            out.textContent = 'נשמר ✓' + (d.errors && d.errors.length ? ' · ' + d.errors.join(' · ') : '');
            out.className = d.errors && d.errors.length ? 'st-warn' : 'st-ok';
            setTimeout(function () { location.reload(); }, 700);
          })
          .catch(function () { out.textContent = 'שגיאת רשת'; out.className = 'st-bad'; });
      });
      var testBtn = document.getElementById('gw-test');
      testBtn.addEventListener('click', function () {
        testBtn.disabled = true;
        out.textContent = 'פותחים דף תשלום של ₪1…'; out.className = '';
        fetch('/admin/api/store/gateway/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            testBtn.disabled = false;
            out.textContent = '';
            out.appendChild(document.createTextNode(d.message || (d.ok ? 'תקין' : 'נכשל')));
            // the server hands the page's address back in test mode only — a live ₪1 page is a payable link
            if (d.ok && d.url) {
              out.appendChild(document.createTextNode(' '));
              var a = document.createElement('a');
              a.href = d.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'לדף הבדיקה ↗';
              out.appendChild(a);
            }
            out.className = d.ok ? 'st-ok' : 'st-bad';
          })
          .catch(function () { testBtn.disabled = false; out.textContent = 'שגיאת רשת'; out.className = 'st-bad'; });
      });
      var copy = document.getElementById('gw-copy');
      if (copy) copy.addEventListener('click', function () {
        var t = document.getElementById('gw-hook-url').textContent;
        if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { copy.textContent = 'הועתק ✓'; });
      });
    })();
    </script>`;
  res.send(kit.screen({ key: 'store-gateway', title: 'סליקת אשראי', body }));
});

router.get('/admin/api/store/gateway', requireAdmin, (req, res) => {
  try { res.json({ ok: true, settings: gateway().adminSettings() }); } catch (e) { sendError(res, e, 500); }
});

router.post('/admin/api/store/gateway', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const r = gateway().saveAdminSettings({ provider: b.provider, mode: b.mode, confirmLive: b.confirmLive === true, fields: b.fields });
    // the checkout page says whether a card is offered and whether this is a test — rebuild so the live site agrees
    const rebuilt = store().refreshNow();
    res.json({ ok: true, settings: r.settings, errors: r.errors, rebuilt });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/gateway/test', requireAdmin, async (req, res) => {
  try {
    const r = await gateway().testConnection({ req });
    res.json({ ok: !!r.ok, message: r.message, url: r.url || '' });
  } catch (e) { sendError(res, e, 500); }
});

/**
 * Refund ONE payment row — typed confirmation (the order number), full by
 * default, partial when the provider supports it. `payment` names the row
 * the screen shows (validated against the order); without it, the newest
 * row that still holds money. Nothing is ever refunded automatically.
 */
router.post('/admin/api/store/orders/:number/refund', requireAdmin, async (req, res) => {
  try {
    const st = store();
    const order = st.orders.getOrder(req.params.number);
    if (!order) return res.status(404).json({ ok: false, error: 'ההזמנה לא נמצאה' });
    const b = req.body || {};
    if (String(b.confirm || '').trim() !== String(order.number)) {
      return res.status(400).json({ ok: false, error: 'לאישור ההחזר יש להקליד את מספר ההזמנה' });
    }
    let amount;
    if (b.amount !== undefined && b.amount !== null && String(b.amount).trim() !== '') {
      amount = st.money.toMinor(String(b.amount));
      if (!Number.isFinite(amount)) return res.status(400).json({ ok: false, error: 'סכום ההחזר אינו תקין' });
    }
    let paymentId;
    if (b.payment !== undefined && b.payment !== null && String(b.payment).trim() !== '') {
      paymentId = parseInt(b.payment, 10);
      if (!Number.isFinite(paymentId)) return res.status(400).json({ ok: false, error: 'מזהה התשלום אינו תקין' });
    }
    const r = await gateway().refund({ order, amount, paymentId, by: (req.adminUser && req.adminUser.username) || 'מנהל' });
    if (!r.ok) {
      const status = r.code === 'PROVIDER' || r.code === 'UNKNOWN' ? 502 : r.code === 'BUSY' ? 409 : r.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ ok: false, code: r.code, error: r.message });
    }
    res.json({ ok: true, refunded: r.refunded, full: r.full, left: r.left, payment: r.paymentId, unpaid: !!r.unpaid });
  } catch (e) { sendError(res, e, 500); }
});

/** An unknown refund outcome, resolved by the owner after a look in the provider's panel — the order number typed, like a refund. */
function resolveRoute(outcome) {
  return async (req, res) => {
    try {
      const order = store().orders.getOrder(req.params.number);
      if (!order) return res.status(404).json({ ok: false, error: 'ההזמנה לא נמצאה' });
      const b = req.body || {};
      if (String(b.confirm || '').trim() !== String(order.number)) return res.status(400).json({ ok: false, error: 'לאישור יש להקליד את מספר ההזמנה' });
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'מזהה התשלום אינו תקין' });
      const r = gateway().resolveUnknownRefund({ order, paymentId: id, outcome, by: (req.adminUser && req.adminUser.username) || 'מנהל' });
      if (!r.ok) return res.status(r.code === 'NOT_FOUND' ? 404 : 400).json({ ok: false, code: r.code, error: r.message });
      res.json({ ok: true, outcome: r.outcome, unpaid: !!r.unpaid, payment: r.paymentId });
    } catch (e) { sendError(res, e, 500); }
  };
}
router.post('/admin/api/store/orders/:number/payments/:id/refund-done', requireAdmin, resolveRoute('done'));
router.post('/admin/api/store/orders/:number/payments/:id/refund-release', requireAdmin, resolveRoute('undone'));

/** The owner's own check of one row against the provider — no page throttle, bounded per row. */
router.post('/admin/api/store/orders/:number/payments/:id/verify', requireAdmin, async (req, res) => {
  try {
    const order = store().orders.getOrder(req.params.number);
    if (!order) return res.status(404).json({ ok: false, error: 'ההזמנה לא נמצאה' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'מזהה התשלום אינו תקין' });
    const r = await gateway().adminVerify(order, id);
    res.status(r.message === 'התשלום לא נמצא בהזמנה הזו' ? 404 : 200).json({ ok: !!r.ok, status: r.status || '', changed: !!r.changed, message: r.message });
  } catch (e) { sendError(res, e, 500); }
});

module.exports = router;
