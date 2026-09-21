'use strict';

/**
 * The store's orders (v2.53) — the list, one order, its printable slip,
 * the CSV, and the actions an owner takes on an order (status, paid,
 * tracking number, a private note). Orders hold customers' names, phones
 * and addresses, so every route is requireAdmin; the CSV guards against
 * spreadsheet formula injection (orders.js csvCell).
 */

const express = require('express');
const { requireAdmin } = require('../admin-guard');
const kit = require('../store/admin-kit');

const router = express.Router();
const { esc } = kit;

function store() { return require('../store'); }

function sendError(res, e, status = 400) {
  res.status(status).json({ ok: false, error: e && e.message ? e.message : String(e) });
}

router.get('/admin/store/orders', requireAdmin, (req, res) => {
  const st = store();
  const O = st.orders;
  const status = O.STATUSES.includes(req.query.status) ? req.query.status : '';
  const paid = ['yes', 'no'].includes(req.query.paid) ? req.query.paid : '';
  const q = String(req.query.q || '').slice(0, 80);
  const counts = O.countByStatus();
  const list = O.listOrders({ status, paid, q, limit: 200 });
  const tab = (href, label, n, on) => `<a href="${href}"${on ? ' class="is-on"' : ''}>${label} <span class="st-count">${n}</span></a>`;
  const tabs = '<nav class="st-subtabs">' +
    tab('/admin/store/orders', 'הכול', counts.all, !status && !paid) +
    O.STATUSES.map((s) => tab('/admin/store/orders?status=' + s, O.STATUS_LABELS[s], counts[s], status === s)).join('') +
    tab('/admin/store/orders?paid=no', 'לא שולמו', counts.unpaid, paid === 'no') + '</nav>';
  const rows = list.length ? list.map((o) => {
    const n = O.listItems(o.id).reduce((a, it) => a + it.qty, 0);
    return `<tr>
      <td><a href="/admin/store/orders/${encodeURIComponent(o.number)}"><b>#${esc(o.number)}</b></a></td>
      <td class="faint">${kit.when(o.created_at)}</td>
      <td>${esc(o.customer_name)}<div class="faint" dir="ltr">${esc(o.customer_phone)}</div></td>
      <td>${n}</td>
      <td><b>${kit.fmt(o.total, o.currency)}</b></td>
      <td>${esc(o.shipping_label || '—')}</td>
      <td>${kit.orderPill(o, O.STATUS_LABELS)} ${kit.paidPill(o)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" class="tbl-empty">${q || status || paid ? 'אין הזמנות שמתאימות.' : 'עוד אין הזמנות. כשהחנות פתוחה, כל הזמנה מהאתר תגיע לכאן.'}</td></tr>`;
  const csvQs = new URLSearchParams({ ...(status ? { status } : {}), ...(paid ? { paid } : {}), ...(q ? { q } : {}) }).toString();
  const body = `
    ${tabs}
    <form class="row st-filters" method="GET" action="/admin/store/orders">
      ${status ? `<input type="hidden" name="status" value="${esc(status)}">` : ''}
      <input class="input compact" name="q" value="${esc(q)}" placeholder="מספר, שם, טלפון או מייל…">
      <button class="btn sm secondary" type="submit">חיפוש</button>
    </form>
    <section class="card">
      <table class="tbl"><thead><tr><th>מספר</th><th>מתי</th><th>לקוח/ה</th><th>פריטים</th><th>סה״כ</th><th>משלוח</th><th>סטטוס</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </section>`;
  res.send(kit.screen({
    key: 'store-orders', title: 'הזמנות', body,
    actions: `<a class="btn secondary" href="/admin/store/orders.csv${csvQs ? '?' + csvQs : ''}" data-nav-full>⬇ CSV</a>`
  }));
});

router.get('/admin/store/orders.csv', requireAdmin, (req, res) => {
  try {
    const O = store().orders;
    const csv = O.ordersCsv({
      status: O.STATUSES.includes(req.query.status) ? req.query.status : '',
      paid: ['yes', 'no'].includes(req.query.paid) ? req.query.paid : '',
      q: String(req.query.q || '').slice(0, 80)
    });
    res.setHeader('Content-Disposition', 'attachment; filename="orders-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.type('text/csv; charset=utf-8').send(csv);
  } catch (e) { sendError(res, e, 500); }
});

function slip(order, items, st) {
  const O = st.orders;
  const a = O.parseAddress(order);
  const name = st.settings.storeName();
  const f = (n) => kit.fmt(n, order.currency);
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>הזמנה #${esc(order.number)}</title>
<style>
body{font-family:Arial,sans-serif;color:#111;margin:32px;font-size:14px}
h1{font-size:20px;margin:0 0 4px} .muted{color:#555} table{width:100%;border-collapse:collapse;margin:16px 0}
th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:start} .tot td{border:none;padding:2px 4px} .tot .big{font-weight:bold;font-size:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px} .box{border:1px solid #ddd;border-radius:6px;padding:10px}
@media print{button{display:none} body{margin:12mm}}
</style></head><body>
<button onclick="print()">🖨 הדפסה</button>
<h1>${esc(name)} — הזמנה #${esc(order.number)}</h1>
<div class="muted">${kit.when(order.created_at)} · ${esc(O.STATUS_LABELS[order.status] || order.status)}${order.paid_at ? ' · שולם' : ''}</div>
<div class="grid">
  <div class="box"><b>לקוח/ה</b><br>${esc(order.customer_name)}<br><span dir="ltr">${esc(order.customer_phone)}</span>${order.customer_email ? '<br><span dir="ltr">' + esc(order.customer_email) + '</span>' : ''}</div>
  <div class="box"><b>משלוח:</b> ${esc(order.shipping_label || '—')}<br>${esc([a.street, a.city, a.zip].filter(Boolean).join(', '))}${a.notes ? '<br>' + esc(a.notes) : ''}${order.tracking ? '<br>מעקב: ' + esc(order.tracking) : ''}</div>
</div>
<table><thead><tr><th>פריט</th><th>כמות</th><th>מחיר</th><th>סה״כ</th></tr></thead><tbody>
${items.map((it) => `<tr><td>${esc(it.title)}${it.variant_label ? ' — ' + esc(it.variant_label) : ''}</td><td>${it.qty}</td><td>${f(it.unit_price)}</td><td>${f(it.line_total)}</td></tr>`).join('')}
</tbody></table>
<table class="tot"><tbody>
<tr><td>סכום ביניים</td><td>${f(order.subtotal)}</td></tr>
${order.discount ? `<tr><td>הנחה${order.coupon ? ' (' + esc(order.coupon) + ')' : ''}</td><td>-${f(order.discount)}</td></tr>` : ''}
${order.shipping_method ? `<tr><td>משלוח</td><td>${order.shipping ? f(order.shipping) : 'חינם'}</td></tr>` : ''}
<tr class="big"><td>סה״כ</td><td>${f(order.total)}</td></tr>
${order.vat ? `<tr><td class="muted">${order.vat_included ? 'מתוכם מע״מ' : 'מע״מ'} (${order.vat_rate}%)</td><td class="muted">${f(order.vat)}</td></tr>` : ''}
</tbody></table>
${order.note ? '<p><b>הערת הלקוח/ה:</b> ' + esc(order.note) + '</p>' : ''}
<p class="muted">תשלום: ${esc(order.payment_label || '—')}. זהו סיכום הזמנה ואינו חשבונית מס.</p>
</body></html>`;
}

router.get('/admin/store/orders/:number', requireAdmin, (req, res) => {
  const st = store();
  const O = st.orders;
  const order = O.getOrder(req.params.number);
  if (!order) return res.status(404).send(kit.screen({ key: 'store-orders', title: 'הזמנה', body: '<p class="card">ההזמנה לא נמצאה. <a href="/admin/store/orders">לכל ההזמנות</a></p>' }));
  const items = O.listItems(order.id);
  if (req.query.print === '1') return res.send(slip(order, items, st));
  const events = O.listEvents(order.id);
  const a = O.parseAddress(order);
  const f = (n) => kit.fmt(n, order.currency);
  const s = st.settings.loadSettings();
  const pay = s.payments.find((p) => p.id === order.payment_method);
  const page = require('../pages').publicUrlFor(s.pages.order) + '?o=' + encodeURIComponent(order.token);
  const body = `
    <section class="card">
      <div class="row between">
        <div><h2 class="sub-head" style="margin:0">הזמנה #${esc(order.number)}</h2>
          <div class="faint">${kit.when(order.created_at)}${order.erased ? ' · פרטי הלקוח נמחקו לבקשתו' : ''}</div></div>
        <div class="row">${kit.orderPill(order, O.STATUS_LABELS)} ${kit.paidPill(order)}
          <a class="btn sm secondary" href="/admin/store/orders/${encodeURIComponent(order.number)}?print=1" target="_blank" rel="noopener" data-nav-full>🖨 הדפסה</a>
          <a class="btn sm secondary" href="${esc(page)}" target="_blank" rel="noopener">דף ההזמנה ↗</a></div>
      </div>
    </section>
    <div class="st-grid2">
      <section class="card">
        <h3 class="sub-head">👤 לקוח/ה</h3>
        <p><b>${esc(order.customer_name)}</b><br>
        ${order.customer_phone ? `<a href="tel:${esc(order.customer_phone.replace(/[^\d+]/g, ''))}" dir="ltr">${esc(order.customer_phone)}</a><br>` : ''}
        ${order.customer_email ? `<a href="mailto:${esc(order.customer_email)}" dir="ltr">${esc(order.customer_email)}</a>` : ''}</p>
        ${order.note ? `<p class="st-note">💬 ${esc(order.note)}</p>` : ''}
      </section>
      <section class="card">
        <h3 class="sub-head">🚚 משלוח ותשלום</h3>
        <p><b>${esc(order.shipping_label || 'בלי משלוח')}</b>${a.street || a.city ? '<br>' + esc([a.street, a.city, a.zip].filter(Boolean).join(', ')) : ''}${a.notes ? '<br><span class="faint">' + esc(a.notes) + '</span>' : ''}</p>
        <p>תשלום: <b>${esc(order.payment_label || '—')}</b>${pay && pay.kind === 'link' ? ' <span class="faint">(קישור לתשלום)</span>' : ''}</p>
      </section>
    </div>
    <section class="card">
      <table class="tbl"><thead><tr><th>פריט</th><th>כמות</th><th>מחיר</th><th>סה״כ</th></tr></thead><tbody>
      ${items.map((it) => `<tr><td>${esc(it.title)}${it.variant_label ? ' — ' + esc(it.variant_label) : ''} <span class="faint" dir="ltr">${esc(it.slug)}</span></td><td>${it.qty}</td><td>${f(it.unit_price)}</td><td>${f(it.line_total)}</td></tr>`).join('')}
      </tbody></table>
      <div class="st-totals">
        <div><span>סכום ביניים</span><span>${f(order.subtotal)}</span></div>
        ${order.discount ? `<div><span>הנחה${order.coupon ? ' (' + esc(order.coupon) + ')' : ''}</span><span>-${f(order.discount)}</span></div>` : ''}
        ${order.shipping_method ? `<div><span>משלוח</span><span>${order.shipping ? f(order.shipping) : 'חינם'}</span></div>` : ''}
        <div class="is-total"><span>סה״כ</span><span>${f(order.total)}</span></div>
        ${order.vat ? `<div class="faint"><span>${order.vat_included ? 'מתוכם מע״מ' : 'מע״מ'} (${order.vat_rate}%)</span><span>${f(order.vat)}</span></div>` : ''}
      </div>
    </section>
    <section class="card">
      <h3 class="sub-head">⚙️ טיפול</h3>
      <div class="st-grid2">
        <label>סטטוס <select class="input" id="od-status">${O.STATUSES.map((x) => `<option value="${x}"${x === order.status ? ' selected' : ''}>${O.STATUS_LABELS[x]}</option>`).join('')}</select></label>
        <label>מספר מעקב <input class="input" id="od-tracking" dir="ltr" value="${esc(order.tracking)}" placeholder="—"></label>
      </div>
      <label class="st-inline"><input type="checkbox" id="od-paid"${order.paid_at ? ' checked' : ''}${order.status === 'cancelled' ? ' disabled' : ''}> התשלום התקבל</label>
      <label style="display:block;margin-top:10px">הערה פנימית (רק לכם) <textarea class="input" id="od-note" rows="2">${esc(order.admin_note)}</textarea></label>
      <p class="faint">"נשלחה" ו"בוטלה" שולחות ללקוח/ה מייל (כשהמייל מוגדר). ביטול מחזיר את הפריטים למלאי.</p>
      <div class="row end"><span id="od-out" aria-live="polite"></span><button type="button" class="btn" id="od-save">שמירה</button></div>
    </section>
    <section class="card">
      <h3 class="sub-head">🕘 היסטוריה</h3>
      <ul class="st-events">${events.map((e) => `<li><span class="faint">${kit.when(e.created_at)}</span> ${esc(e.text)}</li>`).join('')}</ul>
    </section>
    <script>
    (function () {
      var save = document.getElementById('od-save');
      if (!save) return;
      var number = ${JSON.stringify(String(order.number))};
      var out = document.getElementById('od-out');
      var initial = { status: ${JSON.stringify(order.status)}, paid: ${order.paid_at ? 'true' : 'false'}, tracking: document.getElementById('od-tracking').value, note: document.getElementById('od-note').value };
      function post(path, body) {
        return fetch('/admin/api/store/orders/' + encodeURIComponent(number) + '/' + path, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        }).then(function (r) { return r.json(); }).then(function (d) { if (!d.ok) throw new Error(d.error || 'שגיאה'); return d; });
      }
      save.addEventListener('click', function () {
        var status = document.getElementById('od-status').value;
        var paid = document.getElementById('od-paid').checked;
        var tracking = document.getElementById('od-tracking').value;
        var note = document.getElementById('od-note').value;
        if (status === 'cancelled' && initial.status !== 'cancelled' && !confirm('לבטל את ההזמנה? הפריטים יחזרו למלאי.')) return;
        out.textContent = 'שומרים…';
        var chain = Promise.resolve();
        if (tracking !== initial.tracking) chain = chain.then(function () { return post('tracking', { tracking: tracking }); });
        if (note !== initial.note) chain = chain.then(function () { return post('note', { note: note }); });
        if (paid !== initial.paid) chain = chain.then(function () { return post('paid', { paid: paid }); });
        if (status !== initial.status) chain = chain.then(function () { return post('status', { status: status }); });
        chain.then(function () { out.textContent = 'נשמר ✓'; setTimeout(function () { location.reload(); }, 500); })
          .catch(function (e) { out.textContent = e.message; out.className = 'st-bad'; });
      });
    })();
    </script>`;
  res.send(kit.screen({ key: 'store-orders', title: 'הזמנה #' + order.number, body, width: 980 }));
});

// ── actions ────────────────────────────────────────────────────────────

router.post('/admin/api/store/orders/:number/status', requireAdmin, (req, res) => {
  try {
    const st = store();
    const order = st.orders.setStatus(req.params.number, String((req.body || {}).status || ''), { note: 'בידי ' + ((req.adminUser && req.adminUser.username) || 'מנהל') });
    // cancelling or restoring moves stock — the storefront's sold-out marks follow
    st.scheduleRefresh();
    res.json({ ok: true, order: { number: order.number, status: order.status } });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/orders/:number/paid', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const order = store().orders.markPaid(req.params.number, b.paid === true || b.paid === 'true');
    res.json({ ok: true, order: { number: order.number, paid: !!order.paid_at } });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/orders/:number/tracking', requireAdmin, (req, res) => {
  try {
    const order = store().orders.setTracking(req.params.number, (req.body || {}).tracking);
    res.json({ ok: true, order: { number: order.number, tracking: order.tracking } });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/orders/:number/note', requireAdmin, (req, res) => {
  try {
    const order = store().orders.setAdminNote(req.params.number, (req.body || {}).note);
    res.json({ ok: true, order: { number: order.number } });
  } catch (e) { sendError(res, e); }
});

module.exports = router;
