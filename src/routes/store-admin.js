'use strict';

/**
 * The store's admin (v2.53): the flip, shipping & payment, coupons and the
 * BenTML door. Products live in store-products.js, orders in
 * store-orders.js. Every route is requireAdmin — prices, payment details and
 * (next door) customers' orders are the owner's business.
 *
 * Every screen works while the store is CLOSED: an owner builds the catalog,
 * the shipping and the payment methods first, and flips it open when ready.
 */

const express = require('express');
const { requireAdmin } = require('../admin-guard');
const kit = require('../store/admin-kit');

const router = express.Router();
const { esc } = kit;

function store() { return require('../store'); }

function sendError(res, e, status = 400) {
  res.status(status).json({ ok: false, error: e && e.message ? e.message : String(e), errors: (e && e.errors) || undefined });
}

// ── the dashboard + the flip ───────────────────────────────────────────

router.get('/admin/store', requireAdmin, (req, res) => {
  const st = store();
  const s = st.settings.loadSettings();
  const sum = st.summary();
  const pages = require('../pages');
  const urls = st.pages.urls(s);
  let smtpReady = false;
  try { smtpReady = require('../notify').isSmtpReady(); } catch (e) { smtpReady = false; }
  const storePages = st.pages.KINDS.map((k) => {
    const p = pages.getPageByFullPath(s.pages[k]);
    return { kind: k, path: s.pages[k], page: p, live: !!(p && p.status === 'published') };
  });
  const checks = [
    [sum.products.active > 0, `מוצרים פעילים: ${sum.products.active}`, '/admin/store/products', 'להוספת מוצרים'],
    [s.payments.length > 0, `אמצעי תשלום: ${s.payments.map((p) => p.label).join(', ') || 'אין'}`, '/admin/store/settings#payments', 'להגדרה'],
    [s.shipping.length > 0, `שיטות משלוח: ${s.shipping.map((m) => m.label).join(', ') || 'אין'}`, '/admin/store/settings#shipping', 'להגדרה'],
    [smtpReady, smtpReady ? 'מייל: התראות על הזמנות ואישורים ללקוחות יישלחו' : 'מייל: לא מוגדר — הזמנות יישמרו, אבל לא תקבלו עליהן מייל', '/admin/integrations', 'להגדרת SMTP'],
    [storePages.every((x) => x.live), 'דפי החנות: ' + storePages.map((x) => `<a href="/admin/edit/${encodeURIComponent(x.path)}">${esc(x.path)}</a>${x.live ? '' : ' (חסר)'}`).join(' · '), '', s.open ? '' : 'ייווצרו בפתיחה']
  ];
  const recent = st.orders.listOrders({ limit: 6 });
  const cur = s.currency;
  const recentRows = recent.length ? recent.map((o) =>
    `<tr><td><a href="/admin/store/orders/${encodeURIComponent(o.number)}">#${esc(o.number)}</a></td>` +
    `<td>${esc(o.customer_name)}</td><td>${kit.fmt(o.total, o.currency)}</td>` +
    `<td>${kit.orderPill(o, st.orders.STATUS_LABELS)} ${kit.paidPill(o)}</td><td class="faint">${kit.when(o.created_at)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="tbl-empty">עוד אין הזמנות.</td></tr>';

  const body = `
    <section class="card st-flip${s.open ? ' is-open' : ''}">
      <div class="row between">
        <div>
          <h2 class="sub-head">${s.open ? '🟢 החנות פתוחה' : '⚪ החנות סגורה'}</h2>
          <p class="lead" style="margin:0">${s.open
            ? 'האתר מתנהג כחנות: עגלה בכותרת, כפתורי קנייה, קופה והזמנות. סגירה מסירה את העגלה והקנייה — הדפים, המוצרים וההזמנות נשארים.'
            : 'פתיחה הופכת את האתר לחנות: נוצרים (רק אם חסרים) דפי חנות, עגלה, קופה והזמנה — כתובים ב-BenTML ופתוחים לעריכה בבונה — דף לכל מוצר, קישור "חנות" בתפריט ועגלה בכותרת.'}</p>
        </div>
        <button type="button" class="btn${s.open ? ' secondary' : ''}" id="st-flip" data-open="${s.open ? '0' : '1'}">${s.open ? 'סגירת החנות' : '🛍️ פתיחת החנות'}</button>
      </div>
      <div id="st-flip-out" class="st-flip-out" aria-live="polite"></div>
    </section>

    <div class="stat-grid" style="margin:18px 0">
      <div class="stat"><div class="stat-num">${esc(sum.today.totalText)}</div><div class="stat-label">היום · ${sum.today.count} הזמנות</div></div>
      <div class="stat"><div class="stat-num">${esc(sum.month.totalText)}</div><div class="stat-label">החודש · ${sum.month.count} הזמנות</div></div>
      <a href="/admin/store/orders?status=new" style="text-decoration:none"><div class="stat" style="--c:#2563eb"><div class="stat-num">${sum.orders.new}</div><div class="stat-label">חדשות, מחכות לטיפול</div></div></a>
      <a href="/admin/store/orders?paid=no" style="text-decoration:none"><div class="stat" style="--c:#d97706"><div class="stat-num">${sum.orders.unpaid}</div><div class="stat-label">לא שולמו</div></div></a>
      <a href="/admin/store/products" style="text-decoration:none"><div class="stat" style="--c:#059669"><div class="stat-num">${sum.products.active}</div><div class="stat-label">מוצרים פעילים</div></div></a>
    </div>

    <section class="card">
      <h3 class="sub-head">✅ מוכנות</h3>
      <ul class="st-checks">${checks.map(([ok, text, href, cta]) =>
        `<li class="${ok ? 'is-ok' : 'is-todo'}"><span class="st-check-mark">${ok ? '✓' : '•'}</span><span>${text}</span>${!ok && href ? ` <a class="btn xs secondary" href="${href}">${cta}</a>` : (!ok && cta ? ` <span class="faint">${cta}</span>` : '')}</li>`).join('')}</ul>
      ${s.open ? `<p class="faint" style="margin:8px 0 0">בחנות: <a href="${esc(urls.shop)}" target="_blank" rel="noopener">${esc(urls.shop)}</a> · העגלה: <a href="${esc(urls.cart)}" target="_blank" rel="noopener">${esc(urls.cart)}</a></p>` : ''}
    </section>

    <section class="card">
      <div class="row between"><h3 class="sub-head">📦 הזמנות אחרונות</h3><a class="btn sm secondary" href="/admin/store/orders">לכל ההזמנות</a></div>
      <table class="tbl"><thead><tr><th>מספר</th><th>לקוח/ה</th><th>סה״כ</th><th>סטטוס</th><th>מתי</th></tr></thead><tbody>${recentRows}</tbody></table>
    </section>

    <section class="card">
      <h3 class="sub-head">🧬 החנות כולה היא מסמך BenTML</h3>
      <p class="lead">הקטלוג, המדפים, המשלוח, התשלום והקופונים — מסמך <code>&lt;bent-store&gt;</code> אחד: לייצא, לערוך, לתת ל-AI לכתוב, ולהחיל עם תצוגה מקדימה וגיבוי. גיבוי האתר (<a href="/admin/storage">אחסון → ייצוא ‎.pzn</a>) נושא את כל החנות, כולל ההזמנות.</p>
      <a class="btn sm secondary" href="/admin/store/bentml">לדלת ה-BenTML</a>
      <a class="btn sm secondary" href="/admin/api/store/export.bent" download>⬇ store.bent</a>
    </section>

    <script>
    (function () {
      var btn = document.getElementById('st-flip');
      var out = document.getElementById('st-flip-out');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('data-open') === '1';
        if (!open && !confirm('לסגור את החנות? העגלה וכפתורי הקנייה יוסרו מהאתר. דפים, מוצרים והזמנות נשארים.')) return;
        btn.disabled = true;
        out.textContent = open ? 'פותחים את החנות ובונים את האתר מחדש…' : 'סוגרים…';
        fetch('/admin/api/store/flip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ open: open }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) { btn.disabled = false; out.textContent = d.error || 'שגיאה'; return; }
            var lines = [];
            if (d.report.pages && d.report.pages.created.length) lines.push('נוצרו דפים: ' + d.report.pages.created.join(', '));
            if (d.report.products) {
              var made = d.report.products.filter(function (p) { return p.action === 'created'; }).length;
              if (made) lines.push('נוצרו ' + made + ' דפי מוצר');
            }
            if (d.report.menu && d.report.menu.added) lines.push('"חנות" נוסף לתפריט הראשי');
            out.textContent = (open ? 'החנות פתוחה ✓ ' : 'החנות נסגרה ✓ ') + lines.join(' · ');
            setTimeout(function () { location.reload(); }, 900);
          })
          .catch(function () { btn.disabled = false; out.textContent = 'שגיאת רשת'; });
      });
    })();
    </script>`;
  res.send(kit.screen({ key: 'store', title: 'החנות', body }));
});

router.post('/admin/api/store/flip', requireAdmin, (req, res) => {
  try {
    const open = !!(req.body && (req.body.open === true || req.body.open === 'true' || req.body.open === 1));
    const report = store().flip(open);
    res.json({ ok: true, report });
  } catch (e) { sendError(res, e, 500); }
});

router.get('/admin/api/store/summary', requireAdmin, (req, res) => {
  try { res.json({ ok: true, summary: store().summary() }); } catch (e) { sendError(res, e, 500); }
});

/** The builder's preview of <bent-shop>/<bent-buy> — real products, from the admin side. */
router.get('/admin/api/store/catalog', requireAdmin, (req, res) => {
  try {
    const st = store();
    const s = st.settings.loadSettings();
    const products = st.catalog.listProducts({ status: 'all', sort: 'manual' }).map((p) => ({
      ...st.catalog.publicProduct(p, s), status: p.status
    }));
    res.json({ ok: true, open: s.open, currency: s.currency, shelves: st.catalog.listShelves(), products });
  } catch (e) { sendError(res, e, 500); }
});

// ── shipping, payment, rules, shelves ──────────────────────────────────

router.get('/admin/store/settings', requireAdmin, (req, res) => {
  const st = store();
  const s = st.settings.loadSettings();
  const money = st.money;
  const major = (n) => (n === null || n === undefined ? '' : money.fromMinor(n));
  const pages = require('../pages').listPages().filter((p) => p.status === 'published');
  const pageOpts = (sel) => '<option value="">—</option>' + pages.map((p) =>
    `<option value="${esc(p.full_path)}"${p.full_path === sel ? ' selected' : ''}>${esc(p.title)} — /${esc(p.full_path)}</option>`).join('');
  const kinds = st.settings.PAYMENT_KINDS;
  const kindOpts = (sel) => Object.entries(kinds).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
  const shipRow = (m) => `<div class="st-rowed" data-ship>
      <input class="input" data-k="label" placeholder="שם (למשל: משלוח עד הבית)" value="${esc(m.label)}">
      <label class="st-inline">מחיר ₪ <input class="input" data-k="price" inputmode="decimal" dir="ltr" value="${esc(major(m.price))}"></label>
      <label class="st-inline">חינם מעל ₪ <input class="input" data-k="freeOver" inputmode="decimal" dir="ltr" placeholder="—" value="${esc(major(m.freeOver))}"></label>
      <label class="st-inline"><input type="checkbox" data-k="address"${m.address ? ' checked' : ''}> צריך כתובת</label>
      <input class="input" data-k="note" placeholder="הערה ללקוח (אופציונלי)" value="${esc(m.note)}">
      <input type="hidden" data-k="id" value="${esc(m.id)}">
      <button type="button" class="btn xs secondary" data-remove title="הסרה">✕</button></div>`;
  const payRow = (m) => `<div class="st-rowed" data-pay>
      <select class="input" data-k="kind">${kindOpts(m.kind)}</select>
      <input class="input" data-k="label" placeholder="שם שהקונה רואה" value="${esc(m.label)}">
      <input class="input" data-k="phone" placeholder="טלפון (ביט / פייבוקס)" dir="ltr" value="${esc(m.phone)}">
      <input class="input" data-k="url" placeholder="https://… דף התשלום שלכם ({total} {order})" dir="ltr" value="${esc(m.url)}">
      <textarea class="input" data-k="details" rows="2" placeholder="הוראות תשלום (פרטי חשבון, מה לכתוב בהעברה…)">${esc(m.details)}</textarea>
      <input type="hidden" data-k="id" value="${esc(m.id)}">
      <button type="button" class="btn xs secondary" data-remove title="הסרה">✕</button></div>`;
  const shelfRow = (sh) => `<div class="st-rowed" data-shelf>
      <input class="input" data-k="label" placeholder="שם המדף" value="${esc(sh.label)}">
      <input class="input" data-k="slug" placeholder="מזהה" dir="ltr" value="${esc(sh.slug)}">
      <span class="faint">${sh.count || 0} מוצרים</span>
      <button type="button" class="btn xs secondary" data-remove title="מחיקת המדף">✕</button></div>`;
  const curOpts = Object.entries(money.CURRENCIES).map(([k, v]) => `<option value="${k}"${k === s.currency ? ' selected' : ''}>${v.symbol} ${esc(v.label)} (${k})</option>`).join('');

  const body = `
    <form id="st-settings" class="stack" onsubmit="return false">
    <section class="card">
      <h3 class="sub-head">⚙️ כללי</h3>
      <div class="st-grid2">
        <label>שם החנות <input class="input" name="name" value="${esc(s.name)}" placeholder="ריק = שם האתר"></label>
        <label>מטבע <select class="input" name="currency">${curOpts}</select></label>
        <label>מע״מ (%) <input class="input" name="vatRate" inputmode="decimal" dir="ltr" value="${esc(String(s.vatRate))}"></label>
        <label>הזמנת מינימום (₪) <input class="input" name="minOrder" inputmode="decimal" dir="ltr" value="${esc(s.minOrder ? money.fromMinor(s.minOrder) : '')}" placeholder="ללא"></label>
        <label>"נותרו במלאי" מתחת ל- <input class="input" name="lowStock" inputmode="numeric" dir="ltr" value="${s.lowStock}"></label>
        <label>מספר ההזמנה הראשון <input class="input" name="orderStart" inputmode="numeric" dir="ltr" value="${s.orderStart}"></label>
      </div>
      <label class="st-inline"><input type="checkbox" name="pricesIncludeVat"${s.pricesIncludeVat ? ' checked' : ''}> המחירים באתר כוללים מע״מ</label>
      <label class="st-inline"><input type="checkbox" name="vatExempt"${s.vatExempt ? ' checked' : ''}> עוסק פטור (בלי שורת מע״מ)</label>
      <label class="st-inline"><input type="checkbox" name="requireEmail"${s.requireEmail ? ' checked' : ''}> מייל חובה בקופה</label>
      <label class="st-inline"><input type="checkbox" name="customerEmails"${s.customerEmails ? ' checked' : ''}> לשלוח ללקוחות אישור הזמנה ועדכון משלוח במייל</label>
      <div class="st-grid2" style="margin-top:10px">
        <label>מייל להתראות על הזמנות <input class="input" name="notifyEmail" dir="ltr" value="${esc(s.notifyEmail)}" placeholder="ריק = כתובת ההתראות של האתר"></label>
        <label>דף תנאי שימוש (אישור בקופה) <select class="input" name="terms">${pageOpts(s.terms)}</select></label>
      </div>
      <label style="display:block;margin-top:10px">הודעת תודה אחרי הזמנה <textarea class="input" name="thanks" rows="2">${esc(s.thanks)}</textarea></label>
    </section>

    <section class="card" id="shipping">
      <h3 class="sub-head">🚚 שיטות משלוח</h3>
      <p class="faint">מוצר דיגיטלי או שירות (בלי "צריך משלוח" בעורך המוצר) לא מבקש משלוח בכלל.</p>
      <div id="st-ships">${s.shipping.map(shipRow).join('')}</div>
      <button type="button" class="btn sm secondary" id="st-add-ship">+ שיטת משלוח</button>
    </section>

    <section class="card" id="payments">
      <h3 class="sub-head">💳 אמצעי תשלום</h3>
      <p class="faint">החנות לא מחזיקה כרטיסי אשראי ולא מפתחות של חברות סליקה: הקונה רואה את ההוראות שכתבתם, ו"קישור לתשלום" שולח אותו לדף התשלום שלכם (בכל ספק) עם <code>{total}</code> ו-<code>{order}</code> בכתובת. אחרי שהכסף נכנס — מסמנים "שולם" בהזמנה.</p>
      <div id="st-pays">${s.payments.map(payRow).join('')}</div>
      <button type="button" class="btn sm secondary" id="st-add-pay">+ אמצעי תשלום</button>
    </section>

    <section class="card" id="shelves">
      <h3 class="sub-head">🗂️ מדפים (קטגוריות)</h3>
      <div id="st-shelves">${st.catalog.listShelves().map(shelfRow).join('')}</div>
      <button type="button" class="btn sm secondary" id="st-add-shelf">+ מדף</button>
    </section>

    <section class="card">
      <h3 class="sub-head">📄 דפי החנות</h3>
      <div class="st-grid2">${st.pages.KINDS.map((k) => `<label>${esc(st.pages.TITLES[k])} <input class="input" name="page_${k}" dir="ltr" value="${esc(s.pages[k])}"></label>`).join('')}</div>
      <p class="faint">הכתובות שהחנות משתמשת בהן. בפתיחת החנות דף חסר נוצר ב-BenTML; דף קיים לא נדרס לעולם.</p>
    </section>

    <div class="row end st-savebar"><span id="st-save-out" aria-live="polite"></span><button type="button" class="btn" id="st-save">שמירה</button></div>
    </form>

    <template id="st-ship-tpl">${shipRow({ id: '', label: '', price: 0, freeOver: null, address: true, note: '' })}</template>
    <template id="st-pay-tpl">${payRow({ id: '', kind: 'bank', label: '', details: '', phone: '', url: '' })}</template>
    <template id="st-shelf-tpl">${shelfRow({ slug: '', label: '', count: 0 })}</template>
    <script>
    (function () {
      var form = document.getElementById('st-settings');
      if (!form) return;
      function add(listId, tplId) {
        var tpl = document.getElementById(tplId);
        document.getElementById(listId).appendChild(tpl.content.cloneNode(true));
      }
      document.getElementById('st-add-ship').addEventListener('click', function () { add('st-ships', 'st-ship-tpl'); });
      document.getElementById('st-add-pay').addEventListener('click', function () { add('st-pays', 'st-pay-tpl'); });
      document.getElementById('st-add-shelf').addEventListener('click', function () { add('st-shelves', 'st-shelf-tpl'); });
      form.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('[data-remove]');
        if (b) { var row = b.closest('.st-rowed'); if (row) row.remove(); }
      });
      function rows(sel) {
        return Array.prototype.map.call(form.querySelectorAll(sel), function (row) {
          var o = {};
          Array.prototype.forEach.call(row.querySelectorAll('[data-k]'), function (f) {
            o[f.getAttribute('data-k')] = f.type === 'checkbox' ? f.checked : f.value;
          });
          return o;
        });
      }
      var val = function (n) { var f = form.querySelector('[name="' + n + '"]'); return f ? (f.type === 'checkbox' ? f.checked : f.value) : undefined; };
      document.getElementById('st-save').addEventListener('click', function () {
        var out = document.getElementById('st-save-out');
        var body = {
          name: val('name'), currency: val('currency'), vatRate: val('vatRate'), minOrder: val('minOrder') || '0',
          lowStock: val('lowStock'), orderStart: val('orderStart'), pricesIncludeVat: val('pricesIncludeVat'),
          vatExempt: val('vatExempt'), requireEmail: val('requireEmail'), customerEmails: val('customerEmails'),
          notifyEmail: val('notifyEmail'), terms: val('terms'), thanks: val('thanks'),
          shipping: rows('[data-ship]').filter(function (r) { return r.label.trim(); }),
          payments: rows('[data-pay]').filter(function (r) { return r.label.trim() || r.kind; }),
          pages: { shop: val('page_shop'), cart: val('page_cart'), checkout: val('page_checkout'), order: val('page_order') },
          shelves: rows('[data-shelf]').filter(function (r) { return r.label.trim(); })
        };
        out.textContent = 'שומרים…'; out.className = '';
        fetch('/admin/api/store/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) { out.textContent = d.error || 'שגיאה'; out.className = 'st-bad'; return; }
            out.textContent = 'נשמר ✓' + (d.errors && d.errors.length ? ' · ' + d.errors.join(' · ') : '');
            out.className = d.errors && d.errors.length ? 'st-warn' : 'st-ok';
          })
          .catch(function () { out.textContent = 'שגיאת רשת'; out.className = 'st-bad'; });
      });
    })();
    </script>`;
  res.send(kit.screen({ key: 'store-settings', title: 'משלוח ותשלום', body }));
});

router.post('/admin/api/store/settings', requireAdmin, (req, res) => {
  try {
    const st = store();
    const b = req.body || {};
    const patch = {};
    for (const k of ['name', 'currency', 'vatRate', 'minOrder', 'lowStock', 'orderStart', 'pricesIncludeVat', 'vatExempt',
      'requireEmail', 'customerEmails', 'notifyEmail', 'terms', 'thanks', 'shipping', 'payments', 'pages']) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    // money fields from the form are what a person typed (major units)
    if (patch.minOrder !== undefined) patch.minOrder = String(patch.minOrder);
    if (Array.isArray(patch.shipping)) {
      patch.shipping = patch.shipping.map((m) => ({ ...m, price: String(m.price || '0'), freeOver: m.freeOver === '' || m.freeOver == null ? null : String(m.freeOver) }));
    }
    const saved = st.settings.saveSettings(patch);
    if (Array.isArray(b.shelves)) {
      const keep = new Set();
      for (const sh of b.shelves) {
        try { keep.add(st.catalog.saveShelf({ slug: sh.slug, label: sh.label }).slug); } catch (e) { saved.errors.push(e.message); }
      }
      for (const sh of st.catalog.listShelves()) if (!keep.has(sh.slug)) st.catalog.deleteShelf(sh.slug);
    }
    const rebuilt = st.refreshNow();
    res.json({ ok: true, settings: saved.settings, errors: saved.errors, rebuilt });
  } catch (e) { sendError(res, e); }
});

// ── coupons ────────────────────────────────────────────────────────────

router.get('/admin/store/coupons', requireAdmin, (req, res) => {
  const st = store();
  const s = st.settings.loadSettings();
  const list = st.coupons.listCoupons();
  const what = (c) => c.kind === 'percent' ? c.value + '%'
    : c.kind === 'amount' ? esc(st.money.formatMoney(c.value, s.currency)) : 'משלוח חינם';
  const rows = list.length ? list.map((c) => `<tr>
      <td><code dir="ltr">${esc(c.code)}</code></td><td>${what(c)}</td>
      <td>${c.minSubtotal ? kit.fmt(c.minSubtotal, s.currency) : '—'}</td>
      <td class="faint">${esc(c.startsOn || '—')} → ${esc(c.endsOn || '—')}</td>
      <td>${c.used}${c.maxUses ? ' / ' + c.maxUses : ''}</td>
      <td>${c.active ? '<span class="pill ok">פעיל</span>' : '<span class="pill">כבוי</span>'}</td>
      <td class="row"><button type="button" class="btn xs secondary" data-edit="${esc(JSON.stringify({ ...c, value: c.kind === 'amount' ? st.money.fromMinor(c.value) : String(c.value), minSubtotal: c.minSubtotal ? st.money.fromMinor(c.minSubtotal) : '' }))}">עריכה</button>
        <button type="button" class="btn xs secondary" data-del="${esc(c.code)}">מחיקה</button></td></tr>`).join('')
    : '<tr><td colspan="7" class="tbl-empty">עוד אין קופונים.</td></tr>';
  const body = `
    <section class="card">
      <table class="tbl"><thead><tr><th>קוד</th><th>הטבה</th><th>מינימום</th><th>תוקף</th><th>שימושים</th><th>מצב</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </section>
    <section class="card">
      <h3 class="sub-head" id="cp-title">➕ קופון חדש</h3>
      <form id="cp-form" class="st-grid2" onsubmit="return false">
        <label>קוד <input class="input" name="code" dir="ltr" maxlength="32" placeholder="WELCOME10"></label>
        <label>סוג <select class="input" name="kind">
          <option value="percent">אחוז הנחה</option><option value="amount">סכום הנחה (₪)</option><option value="shipping">משלוח חינם</option></select></label>
        <label>ערך <input class="input" name="value" inputmode="decimal" dir="ltr" placeholder="10"></label>
        <label>מינימום קנייה (₪) <input class="input" name="minSubtotal" inputmode="decimal" dir="ltr" placeholder="ללא"></label>
        <label>מתאריך <input class="input" type="date" name="startsOn"></label>
        <label>עד תאריך (כולל) <input class="input" type="date" name="endsOn"></label>
        <label>מספר שימושים כולל <input class="input" name="maxUses" inputmode="numeric" dir="ltr" placeholder="ללא הגבלה"></label>
        <label>הערה פנימית <input class="input" name="note"></label>
        <label class="st-inline"><input type="checkbox" name="active" checked> פעיל</label>
      </form>
      <div class="row end"><span id="cp-out" aria-live="polite"></span><button type="button" class="btn" id="cp-save">שמירת קופון</button></div>
    </section>
    <script>
    (function () {
      var form = document.getElementById('cp-form');
      if (!form) return;
      var out = document.getElementById('cp-out');
      function field(n) { return form.querySelector('[name="' + n + '"]'); }
      document.querySelectorAll('[data-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          var c = JSON.parse(b.getAttribute('data-edit'));
          field('code').value = c.code; field('kind').value = c.kind; field('value').value = c.kind === 'shipping' ? '' : c.value;
          field('minSubtotal').value = c.minSubtotal || ''; field('startsOn').value = c.startsOn || ''; field('endsOn').value = c.endsOn || '';
          field('maxUses').value = c.maxUses || ''; field('note').value = c.note || ''; field('active').checked = !!c.active;
          document.getElementById('cp-title').textContent = '✏️ עריכת ' + c.code;
          form.scrollIntoView({ behavior: 'smooth' });
        });
      });
      document.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('למחוק את הקופון ' + b.getAttribute('data-del') + '?')) return;
          fetch('/admin/api/store/coupons/' + encodeURIComponent(b.getAttribute('data-del')) + '/delete', { method: 'POST' })
            .then(function () { location.reload(); });
        });
      });
      document.getElementById('cp-save').addEventListener('click', function () {
        var body = {};
        ['code', 'kind', 'value', 'minSubtotal', 'startsOn', 'endsOn', 'maxUses', 'note'].forEach(function (n) { body[n] = field(n).value; });
        body.active = field('active').checked;
        out.textContent = 'שומרים…';
        fetch('/admin/api/store/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d.ok) location.reload(); else { out.textContent = d.error || 'שגיאה'; out.className = 'st-bad'; } })
          .catch(function () { out.textContent = 'שגיאת רשת'; });
      });
    })();
    </script>`;
  res.send(kit.screen({ key: 'store-coupons', title: 'קופונים', body }));
});

router.post('/admin/api/store/coupons', requireAdmin, (req, res) => {
  try {
    const b = { ...(req.body || {}) };
    // what a person typed is major units: "20" off means ₪20
    if (b.kind === 'amount' && b.value !== undefined) b.value = String(b.value);
    if (b.minSubtotal !== undefined && b.minSubtotal !== null) b.minSubtotal = String(b.minSubtotal);
    const coupon = store().coupons.saveCoupon(b);
    res.json({ ok: true, coupon });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/coupons/:code/delete', requireAdmin, (req, res) => {
  try { res.json({ ok: store().coupons.deleteCoupon(req.params.code) }); } catch (e) { sendError(res, e); }
});

// ── the BenTML door ────────────────────────────────────────────────────

router.get('/admin/store/bentml', requireAdmin, (req, res) => {
  const st = store();
  const doc = st.document.exportDocument();
  const backups = st.document.listBackups();
  const backupRows = backups.length ? backups.map((b) =>
    `<li><span>#${b.id} · ${esc(b.reason || '')} · <span class="faint">${kit.when(b.created_at)}</span></span>` +
    ` <a class="btn xs secondary" href="/admin/api/store/backups/${b.id}.bent" download>⬇</a>` +
    ` <button type="button" class="btn xs secondary" data-restore="${b.id}">שחזור</button></li>`).join('')
    : '<li class="faint">עוד אין גיבויים — כל החלה של מסמך שומרת את החנות כפי שהייתה.</li>';
  const body = `
    <section class="card">
      <h3 class="sub-head">🧬 החנות כמסמך <code>&lt;bent-store&gt;</code></h3>
      <p class="lead">זה המסמך של החנות כרגע. אפשר לערוך אותו כאן, להדביק מסמך שכתבתם או שה-AI כתב, לראות מה ישתנה — ורק אז להחיל. כל החלה נשמרת קודם כגיבוי (גם הוא BenTML), ו"ביטול החלה אחרונה" מחזיר אותו.</p>
      <ul class="st-help">
        <li><code>&lt;bent-sku id="…" title="…" price="89.90"&gt;תיאור…&lt;/bent-sku&gt;</code> — מוצר. <code>was</code> מחיר לפני, <code>stock</code> מלאי (<code>unlimited</code> = בלי ספירה), <code>shelf</code> מדף, <code>image</code>/<code>images</code>, <code>status="hidden"</code>.</li>
        <li><code>&lt;bent-variant id="m" label="M" price="120" stock="4" /&gt;</code> — אפשרות בתוך מוצר.</li>
        <li><code>&lt;bent-ship&gt;</code> משלוח · <code>&lt;bent-pay&gt;</code> תשלום · <code>&lt;bent-coupon&gt;</code> קופון · <code>&lt;bent-store-rules&gt;</code> מע״מ ומינימום.</li>
        <li>מסמך שלם (עם <code>&lt;bent-store&gt;</code>) הוא כל הקטלוג: מוצר שלא מופיע בו <b>מוסתר</b> (לא נמחק). בלי העטיפה, או עם <code>mode="merge"</code> — רק מוסיף ומעדכן.</li>
      </ul>
      <textarea id="sb-doc" class="input st-code" rows="22" dir="ltr" spellcheck="false">${esc(doc)}</textarea>
      <div class="row between" style="margin-top:10px">
        <span class="row"><a class="btn sm secondary" href="/admin/api/store/export.bent" download>⬇ store.bent</a>
        <label class="btn sm secondary" style="cursor:pointer">⬆ קובץ <input type="file" id="sb-file" accept=".bent,.pzn,.txt,.html" hidden></label></span>
        <span class="row"><span id="sb-out" aria-live="polite"></span>
        <button type="button" class="btn secondary" id="sb-preview">👁 תצוגה מקדימה</button>
        <button type="button" class="btn" id="sb-apply" disabled>✅ החלה על החנות</button></span>
      </div>
      <div id="sb-preview-out" class="st-preview" aria-live="polite"></div>
    </section>
    <section class="card" id="store-ai-card"></section>
    <section class="card">
      <div class="row between"><h3 class="sub-head">🗄️ גיבויים</h3><button type="button" class="btn sm secondary" id="sb-undo"${backups.length ? '' : ' disabled'}>↩ ביטול החלה אחרונה</button></div>
      <ul class="st-backups">${backupRows}</ul>
    </section>
    <script>
    (function () {
      var ta = document.getElementById('sb-doc');
      if (!ta) return;
      var out = document.getElementById('sb-out');
      var box = document.getElementById('sb-preview-out');
      var applyBtn = document.getElementById('sb-apply');
      var previewed = null;
      function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
      function list(title, items, fmt) {
        if (!items || !items.length) return '';
        return '<div class="st-pv-sec"><b>' + esc(title) + ' (' + items.length + ')</b><ul>' + items.map(function (x) { return '<li>' + fmt(x) + '</li>'; }).join('') + '</ul></div>';
      }
      function render(d) {
        var p = d.preview || {};
        var html = '';
        if (d.errors && d.errors.length) html += '<div class="st-pv-bad">' + d.errors.map(function (e) { return esc(e.message); }).join('<br>') + '</div>';
        html += list('יתווספו', p.added, function (x) { return esc(x.title) + ' · ' + esc(x.priceText); });
        html += list('ישתנו', p.changed, function (x) { return esc(x.title) + ' — ' + esc((x.fields || []).join(' · ')); });
        html += list('יוסתרו (לא מופיעים במסמך)', p.hidden, function (x) { return esc(x.title); });
        if (p.unchanged) html += '<p class="faint">' + p.unchanged + ' מוצרים בלי שינוי.</p>';
        html += list('הגדרות', p.settings, esc);
        if (p.coupons) {
          html += list('קופונים חדשים', p.coupons.added, esc) + list('קופונים שמשתנים', p.coupons.changed, esc) + list('קופונים שיכובו', p.coupons.off, esc);
        }
        var warns = (d.warnings || []);
        if (warns.length) html += '<div class="st-pv-sec"><b>הערות</b><ul>' + warns.map(function (w) {
          return '<li class="' + (w.hard ? 'st-bad' : 'faint') + '">' + (w.hard ? '⚠ ' : '') + esc(w.message) + '</li>'; }).join('') + '</ul></div>';
        box.innerHTML = html || '<p class="faint">אין שינויים.</p>';
      }
      var file = document.getElementById('sb-file');
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function () { ta.value = String(r.result || ''); previewed = null; applyBtn.disabled = true; };
        r.readAsText(f);
      });
      ta.addEventListener('input', function () { previewed = null; applyBtn.disabled = true; });
      document.getElementById('sb-preview').addEventListener('click', function () {
        out.textContent = 'בודקים…';
        fetch('/admin/api/store/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ta.value }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            render(d);
            out.textContent = d.ok ? (d.hard ? 'יש אזהרות — ההחלה תבקש אישור' : 'מוכן להחלה') : 'לא ניתן להחיל';
            previewed = d.ok ? { text: ta.value, hard: d.hard } : null;
            applyBtn.disabled = !d.ok;
          })
          .catch(function () { out.textContent = 'שגיאת רשת'; });
      });
      applyBtn.addEventListener('click', function () {
        if (!previewed || previewed.text !== ta.value) { out.textContent = 'המסמך השתנה — הציגו תצוגה מקדימה שוב'; applyBtn.disabled = true; return; }
        if (previewed.hard && !confirm('יש אזהרות (מסומנות ⚠). להחיל בכל זאת? גיבוי של החנות נשמר קודם.')) return;
        applyBtn.disabled = true;
        out.textContent = 'מחילים…';
        fetch('/admin/api/store/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ta.value, force: previewed.hard }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) { out.textContent = d.message || d.error || 'שגיאה'; render(d); return; }
            out.textContent = 'הוחל ✓ (גיבוי #' + d.backupId + ')';
            setTimeout(function () { location.reload(); }, 700);
          })
          .catch(function () { out.textContent = 'שגיאת רשת'; });
      });
      document.getElementById('sb-undo').addEventListener('click', function () {
        if (!confirm('להחזיר את החנות למצב שלפני ההחלה האחרונה?')) return;
        fetch('/admin/api/store/undo', { method: 'POST' }).then(function (r) { return r.json(); })
          .then(function (d) { if (d.ok) location.reload(); else out.textContent = d.message || 'שגיאה'; });
      });
      document.querySelectorAll('[data-restore]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!confirm('לשחזר את החנות מגיבוי #' + b.getAttribute('data-restore') + '? המצב הנוכחי נשמר כגיבוי קודם.')) return;
          fetch('/admin/api/store/backups/' + b.getAttribute('data-restore') + '/restore', { method: 'POST' })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.ok) location.reload(); else out.textContent = d.message || 'שגיאה'; });
        });
      });
    })();
    </script>
    <!-- the owner's own model, reached through their browser (Bridge V2) -->
    <script src="/admin-bridge.js"></script>
    <script src="/admin-inject-card.js"></script>
    <script>
      // the AI catalog writer: the same preview → apply → undo door as the box above
      (function () {
        var el = document.getElementById('store-ai-card');
        if (!el) return;
        if (window.TapuzInjectCard && typeof window.TapuzInjectCard.mount === 'function') {
          window.TapuzInjectCard.mount(el, 'store-catalog', { onApplied: function () { setTimeout(function () { location.reload(); }, 600); } });
        } else {
          el.hidden = true;
        }
      })();
    </script>`;
  res.send(kit.screen({ key: 'store-bentml', title: 'החנות ב-BenTML', body }));
});

router.get('/admin/api/store/export.bent', requireAdmin, (req, res) => {
  try {
    const name = 'store-' + new Date().toISOString().slice(0, 10) + '.bent';
    res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
    res.type('text/plain; charset=utf-8').send(store().document.exportDocument());
  } catch (e) { sendError(res, e, 500); }
});

router.post('/admin/api/store/preview', requireAdmin, (req, res) => {
  try {
    const r = store().document.planDocument(String((req.body || {}).text || ''));
    const { plan, ...pub } = r;
    res.status(r.ok ? 200 : 400).json(pub);
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/apply', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const r = store().document.applyDocument(String(b.text || ''), { force: b.force === true, reason: 'admin' });
    const { plan, ...pub } = r;
    res.status(r.ok ? 200 : 400).json(pub);
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/undo', requireAdmin, (req, res) => {
  try {
    const r = store().document.undoLast();
    const { plan, ...pub } = r;
    res.status(r.ok ? 200 : 400).json(pub);
  } catch (e) { sendError(res, e); }
});

router.get('/admin/api/store/backups', requireAdmin, (req, res) => {
  try { res.json({ ok: true, backups: store().document.listBackups() }); } catch (e) { sendError(res, e, 500); }
});

router.get('/admin/api/store/backups/:id.bent', requireAdmin, (req, res) => {
  const b = store().document.getBackup(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: 'not found' });
  res.setHeader('Content-Disposition', 'attachment; filename="store-backup-' + b.id + '.bent"');
  res.type('text/plain; charset=utf-8').send(b.source);
});

router.post('/admin/api/store/backups/:id/restore', requireAdmin, (req, res) => {
  try {
    const r = store().document.restoreBackup(req.params.id);
    const { plan, ...pub } = r;
    res.status(r.ok ? 200 : 400).json(pub);
  } catch (e) { sendError(res, e); }
});

module.exports = router;
