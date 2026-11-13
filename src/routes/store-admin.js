'use strict';

/**
 * The store's admin (v2.53): the flip, shipping & payment, coupons and the
 * BenTML door. Products live in store-products.js, categories in
 * store-shelves.js, orders in store-orders.js. Every route is requireAdmin —
 * prices, payment details and (next door) customers' orders are the owner's
 * business.
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

const EVERYTHING = 100000;

/**
 * What the checkout really offers, and what it holds back. A method the
 * owner configured is not a method a shopper can pick: a card waits for a
 * clearing company and PayPal for its keys. The hub used to say "✓" for a
 * PayPal-only shop without keys — a shop where nobody can order.
 */
function paymentState(st, s) {
  const offered = st.paypal.offeredPayments(s);
  const ids = new Set(offered.map((p) => p.id));
  const paypal = st.paypal.status(s);
  const why = (m) => {
    if (m.kind === 'card') return 'מחכה לחיבור חברת סליקה';
    if (m.kind === 'paypal') return paypal.reasons.length ? paypal.reasons.join(' · ') : 'PayPal לא מחובר';
    if (m.kind === 'demo') return 'מוצע רק בחנות הדגמה';
    return 'לא זמין כרגע';
  };
  const held = s.payments.filter((p) => !ids.has(p.id)).map((p) => ({ label: p.label, kind: p.kind, why: why(p) }));
  return { offered, held, paypal, hasPaypal: s.payments.some((p) => p.kind === 'paypal') };
}

/** After a settings save: one line for each configured method the checkout will not show. */
function paymentNotes(st, s) {
  // the wiring module knows each method's state first-hand (PayPal's keys,
  // the clearing company, the demo method) and has one sentence for each
  try {
    if (typeof st.paypal.readinessNotes === 'function') return st.paypal.readinessNotes(s).map(String);
  } catch (e) { /* fall back to the hub's own reading below */ }
  return paymentState(st, s).held.map((h) => `"${h.label}" לא יופיע בקופה: ${h.why}`);
}

/**
 * The catalog's loose ends, each with the products behind it. The first
 * three look at ACTIVE products — what a shopper meets; drafts are their own
 * line. Out/low use the catalog's own stock filters, so a number here and
 * the filtered product list never disagree.
 */
function catalogHealth(st) {
  const cat = st.catalog;
  const all = cat.listProducts({ status: 'all', sort: 'manual', limit: EVERYTHING });
  const active = all.filter((p) => p.status === 'active');
  const shelves = new Set(cat.listShelves().map((x) => x.slug));
  const free = (p) => (p.variants.length
    ? p.variants.some((v) => (v.price === null || v.price === undefined ? p.price : v.price) === 0)
    : p.price === 0);
  return [
    { key: 'no-image', label: 'בלי תמונה', items: active.filter((p) => !p.images.length), href: '/admin/store/products?status=active&check=noimage' },
    { key: 'free', label: 'מחיר 0', items: active.filter(free), href: '/admin/store/products?status=active&check=price0' },
    { key: 'no-shelf', label: 'בלי קטגוריה', items: active.filter((p) => !p.shelf || !shelves.has(p.shelf)), href: '/admin/store/products?status=active&shelf=none' },
    { key: 'draft', label: 'טיוטות', items: all.filter((p) => p.status === 'draft'), href: '/admin/store/products?status=draft' },
    { key: 'out', label: 'אזלו מהמלאי', items: cat.listProducts({ status: 'active', stock: 'out', limit: EVERYTHING }), href: '/admin/store/products?status=active&stock=out' },
    { key: 'low', label: 'מלאי נמוך', items: cat.listProducts({ status: 'active', stock: 'low', limit: EVERYTHING }), href: '/admin/store/products?status=active&stock=low' }
  ];
}

const PAID_PAGE = 1000;
const PAID_MOST = 50000;

/**
 * Of the orders the two money tiles sum — created today / this month, not
 * cancelled — the part that was paid: the line under a tile says "מתוכן",
 * so it is a part of THAT tile's orders. (What was received in a period,
 * whenever its order was placed, is another number — an order from last
 * month that is paid today is not "of today's orders".) Counted from the paid
 * orders, newest first, until the month runs out; days are the local
 * calendar days stats() uses. A shop too busy to count this way gets no
 * figure rather than a wrong one.
 */
function paidTotals(st, now) {
  const day = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  const today = day(now instanceof Date ? now : new Date());
  const monthStart = today.slice(0, 8) + '01';
  // the database writes UTC ("2026-11-13 09:30:00"); a calendar day is the shop's own
  const dayOf = (stamp) => {
    const text = String(stamp || '');
    const d = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? '' : day(d);
  };
  let sumToday = 0;
  let sumMonth = 0;
  // a page is as long as the orders module makes it: the walk moves by what came back and ends on an empty one
  for (let seen = 0; seen < PAID_MOST;) {
    const rows = st.orders.listOrders({ paid: 'yes', limit: PAID_PAGE, offset: seen });
    if (!rows.length) return { today: sumToday, month: sumMonth };
    for (const o of rows) {
      const made = dayOf(o.created_at);
      if (made && made < monthStart) return { today: sumToday, month: sumMonth };
      if (!made || o.status === 'cancelled') continue;
      sumMonth += o.total;
      if (made >= today) sumToday += o.total;
    }
    seen += rows.length;
  }
  return { today: null, month: null };
}

// every product behind a number is named (the list scrolls inside its line); past this many, the rest are counted
const HEALTH_SHOWN = 200;

function healthCard(st, productCount) {
  const lines = catalogHealth(st);
  let inner;
  if (!productCount) inner = '<p class="faint st-health-calm">עוד אין מוצרים — אין מה לבדוק.</p>';
  else if (lines.every((h) => !h.items.length)) inner = '<p class="st-ok st-health-calm">הקטלוג נקי ✓</p>';
  else {
    inner = '<ul class="st-health">' + lines.map((h) => {
      const n = h.items.length;
      if (!n) return `<li class="st-health-item is-ok" data-health="${h.key}"><span class="st-health-line"><span>${h.label}</span><span class="st-health-n">✓</span></span></li>`;
      const shown = h.items.slice(0, HEALTH_SHOWN).map((p) => `<li><a href="/admin/store/products/${p.id}">${esc(p.title)}</a></li>`).join('');
      const more = n > HEALTH_SHOWN ? `<li class="faint">ועוד ${n - HEALTH_SHOWN}</li>` : '';
      const allLink = h.href ? `<li><a class="st-health-all" href="${h.href}">לרשימה המסוננת ←</a></li>` : '';
      return `<li class="st-health-item" data-health="${h.key}"><details><summary class="st-health-line"><span>${h.label}</span><span class="st-health-n">${n}</span></summary><ul class="st-health-list">${shown}${more}${allLink}</ul></details></li>`;
    }).join('') + '</ul>';
  }
  return `
    <section class="card" id="st-health">
      <div class="row between st-hub-head"><h3 class="sub-head">🩺 בריאות הקטלוג</h3>
        <span class="row"><a class="btn sm secondary" href="/admin/store/products">🏷️ מוצרים</a><a class="btn sm secondary" href="/admin/store/shelves">🗂️ קטגוריות</a></span></div>
      ${productCount ? '<p class="faint st-health-lead">מה שקונים פוגשים: המוצרים הפעילים. לחיצה על שורה מראה את המוצרים שמאחוריה.</p>' : ''}
      ${inner}
    </section>`;
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
  // a page that is not there yet has no editor to open: its name is text, not a link to a 404
  const pageBit = (x) => (x.page
    ? `<a href="/admin/edit/${encodeURIComponent(x.path)}">${esc(x.path)}</a>${x.live ? '' : ' (טיוטה)'}`
    : `${esc(x.path)} (חסר)`);
  const pay = paymentState(st, s);
  const offeredText = pay.offered.map((p) => esc(p.label)).join(', ');
  const heldText = pay.held.map((h) => `${esc(h.label)} (${esc(h.why)})`).join(' · ');
  let payCheck;
  if (pay.offered.length && !pay.held.length) {
    payCheck = [true, `אמצעי תשלום בקופה: ${offeredText}`, '', '', false, 'payments'];
  } else if (pay.offered.length) {
    payCheck = [false, `אמצעי תשלום בקופה: ${offeredText}. לא מוצעים כרגע: ${heldText}`, '/admin/store/settings#payments', 'להגדרה', false, 'payments'];
  } else {
    const none = s.open
      ? 'אין כרגע אף אמצעי תשלום זמין בקופה — אי אפשר להזמין'
      : 'אין כרגע אף אמצעי תשלום זמין בקופה — כשהחנות תיפתח אי אפשר יהיה להזמין';
    payCheck = [false, none + (heldText ? `. הוגדרו: ${heldText}` : ''), '/admin/store/settings#payments', 'להגדרה', s.open, 'payments'];
  }
  const checks = [
    [sum.products.active > 0, `מוצרים פעילים: ${sum.products.active}`, '/admin/store/products', 'להוספת מוצרים'],
    payCheck,
    [s.shipping.length > 0, `שיטות משלוח: ${s.shipping.map((m) => esc(m.label)).join(', ') || 'אין'}`, '/admin/store/settings#shipping', 'להגדרה'],
    [smtpReady, smtpReady ? 'מייל: התראות על הזמנות ואישורים ללקוחות יישלחו' : 'מייל: לא מוגדר — הזמנות יישמרו, אבל לא תקבלו עליהן מייל', '/admin/integrations', 'להגדרת SMTP'],
    [storePages.every((x) => x.live), 'דפי החנות: ' + storePages.map(pageBit).join(' · '), '', s.open ? '' : 'ייווצרו בפתיחה']
  ];
  // PayPal: a line whenever a PayPal method exists. Sandbox is said out loud
  // (a payment there moves no real money); not connected is RED on an open store
  if (pay.hasPaypal) {
    const pp = pay.paypal;
    if (pp.ready && pp.live) checks.push([true, 'PayPal: מחובר (חי)', '', '', false, 'paypal']);
    else if (pp.ready) checks.push([false, 'PayPal: מחובר (ארגז חול) — תשלום בו הוא בדיקה, כסף אמיתי לא עובר', '/admin/store/gateway', 'להגדרות PayPal', false, 'paypal']);
    else checks.push([false, `PayPal: לא מחובר — ${esc(pp.reasons.join(' · ') || 'חסרים מפתחות PayPal')}`, '/admin/store/gateway', 'לחיבור', s.open, 'paypal']);
  }
  // the card gateway (src/store/gateway): a line whenever a card method exists
  // or a provider was chosen; RED when the open store cannot take a card, and
  // RED when the open store runs on test money
  const gw = require('../store/gateway').status(s);
  if (gw.hasCardMethod || gw.provider) {
    const label = gw.providerLabel || 'חברת סליקה';
    checks.push([gw.ready,
      gw.ready ? `סליקת אשראי: מחובר ל-${esc(label)} · מצב ${gw.live ? 'אמיתי' : 'בדיקות'}` : `סליקת אשראי: ${esc(gw.reasons.join(' · '))}`,
      '/admin/store/gateway', 'לחיבור', !gw.ready && gw.hasCardMethod && s.open]);
    if (s.open && gw.ready && !gw.live) {
      checks.push([false, 'סליקת אשראי במצב בדיקות בעוד החנות פתוחה — קונים בכרטיס לא יחויבו בכסף אמיתי, והזמנות כאלה לא יסומנו כשולמו', '/admin/store/gateway', 'למצב אמיתי', true]);
    }
  }
  const recent = st.orders.listOrders({ limit: 6 });
  // The money tiles count every order that was not cancelled, paid or not —
  // so they are named "orders", and the paid part is printed under each.
  // (A day with no orders has nothing to split: the line would only be noise.)
  const paid = paidTotals(st);
  const paidLine = (v, count) => (v === null || !count ? '' : `<div class="st-stat-sub">מתוכן שולמו: ${kit.fmt(v, s.currency)}</div>`);
  // a total of millions is a long word: the tile is told how many characters it holds and sizes them to fit (admin.css)
  const numLen = (text) => ` style="--n:${Math.max(1, Array.from(String(text)).length)}"`;
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

    <div class="stat-grid st-hub-tiles" style="margin:18px 0">
      <div class="stat"><div class="stat-num"${numLen(sum.today.totalText)}>${esc(sum.today.totalText)}</div><div class="stat-label">הזמנות היום · ${sum.today.count}</div>${paidLine(paid.today, sum.today.count)}</div>
      <div class="stat"><div class="stat-num"${numLen(sum.month.totalText)}>${esc(sum.month.totalText)}</div><div class="stat-label">הזמנות החודש · ${sum.month.count}</div>${paidLine(paid.month, sum.month.count)}</div>
      <a href="/admin/store/orders?status=new" style="text-decoration:none"><div class="stat" style="--c:#2563eb"><div class="stat-num">${sum.orders.new}</div><div class="stat-label">חדשות, מחכות לטיפול</div></div></a>
      <a href="/admin/store/orders?paid=no" style="text-decoration:none"><div class="stat" style="--c:#d97706"><div class="stat-num">${sum.orders.unpaid}</div><div class="stat-label">לא שולמו</div></div></a>
      <a href="/admin/store/products" style="text-decoration:none"><div class="stat" style="--c:#059669"><div class="stat-num">${sum.products.active}</div><div class="stat-label">מוצרים פעילים</div></div></a>
    </div>

    <section class="card">
      <h3 class="sub-head">✅ מוכנות</h3>
      <ul class="st-checks st-hub-checks">${checks.map(([ok, text, href, cta, bad, key]) =>
        // a button that leads to a place INSIDE a screen (#payments) leaves the shell, so the browser lands on that place
        `<li class="${ok ? 'is-ok' : bad ? 'is-bad' : 'is-todo'}"${key ? ` data-check="${key}"` : ''}><span class="st-check-mark">${ok ? '✓' : bad ? '!' : '•'}</span><span>${text}</span>${!ok && href ? ` <a class="btn xs secondary" href="${href}"${href.includes('#') ? ' data-nav-full' : ''}>${cta}</a>` : (!ok && cta ? ` <span class="faint">${cta}</span>` : '')}</li>`).join('')}</ul>
      ${s.open ? `<p class="faint" style="margin:8px 0 0">בחנות: <a href="${esc(urls.shop)}" target="_blank" rel="noopener">${esc(urls.shop)}</a> · העגלה: <a href="${esc(urls.cart)}" target="_blank" rel="noopener">${esc(urls.cart)}</a></p>` : ''}
    </section>
${healthCard(st, sum.products.total)}

    <section class="card">
      <div class="row between"><h3 class="sub-head">📦 הזמנות אחרונות</h3><a class="btn sm secondary" href="/admin/store/orders">לכל ההזמנות</a></div>
      <div class="st-hub-scroll"><table class="tbl"><thead><tr><th>מספר</th><th>לקוח/ה</th><th>סה״כ</th><th>סטטוס</th><th>מתי</th></tr></thead><tbody>${recentRows}</tbody></table></div>
    </section>

    <section class="card">
      <h3 class="sub-head">🧬 החנות כולה היא מסמך BenTML</h3>
      <p class="lead">הקטלוג, הקטגוריות, המשלוח, התשלום והקופונים — מסמך <code>&lt;bent-store&gt;</code> אחד: לייצא, לערוך, לתת ל-AI לכתוב, ולהחיל עם תצוגה מקדימה וגיבוי. גיבוי האתר (<a href="/admin/storage">אחסון → ייצוא ‎.pzn</a>) נושא את כל החנות, כולל ההזמנות.</p>
      <div class="row st-hub-links">
        <a class="btn sm secondary" href="/admin/store/bentml">לדלת ה-BenTML</a>
        <a class="btn sm secondary" href="/admin/api/store/export.bent" download>⬇ store.bent</a>
        <a class="btn sm secondary" href="/admin/store/bentml#csv" data-nav-full>📄 ייבוא וייצוא CSV</a>
      </div>
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

// ── shipping, payment, rules ───────────────────────────────────────────
// (Categories lived here until v2.69, saved with this form: a row missing
// from the post was a deleted category. They have their own screen now —
// store-shelves.js — and this form neither shows nor sends them.)

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
      <label class="st-inline" data-card-only${m.kind === 'card' ? '' : ' hidden'}>עד תשלומים <input class="input" data-k="maxPayments" inputmode="numeric" dir="ltr" value="${Number(m.maxPayments) || 1}"></label>
      <textarea class="input" data-k="details" rows="2" placeholder="הוראות תשלום (פרטי חשבון, מה לכתוב בהעברה…)">${esc(m.details)}</textarea>
      <input type="hidden" data-k="id" value="${esc(m.id)}">
      <button type="button" class="btn xs secondary" data-remove title="הסרה">✕</button></div>`;
  // two settings the store's wiring may add; each field shows only on a store that has the setting
  const holdField = s.holdHours === undefined ? '' :
    `<label>ביטול אוטומטי של הזמנות שלא שולמו אחרי (שעות) <input class="input" name="holdHours" inputmode="numeric" dir="ltr" value="${esc(String(s.holdHours))}" placeholder="0 = אף פעם"></label>`;
  const demoField = s.demoPayments === undefined ? '' :
    `<label class="st-inline"><input type="checkbox" name="demoPayments"${s.demoPayments ? ' checked' : ''}> להציע "תשלום לדוגמה" בקופה — לחנות הדגמה בלבד, כסף אמיתי לא עובר</label>`;
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
        ${holdField}
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
      <p class="faint">החנות לא מחזיקה כרטיסי אשראי: הקונה רואה את ההוראות שכתבתם, ו"קישור לתשלום" שולח אותו לדף התשלום שלכם (בכל ספק) עם <code>{total}</code> ו-<code>{order}</code> בכתובת. אחרי שהכסף נכנס — מסמנים "שולם" בהזמנה. אמצעי מסוג <b>כרטיס אשראי</b> הוא סליקה של ממש: הוא מופיע בקופה רק כשחברת סליקה (Grow / Cardcom) מחוברת ב<a href="/admin/store/gateway">סליקת אשראי</a>, וההזמנה מסומנת כשולמה אוטומטית אחרי שהשרת אימת את התשלום. המפתחות של החברה לא נשמרים כאן. PayPal מופיע בקופה רק אחרי שמפתחות ה-API שלו הוגדרו (ראו "<a href="/admin/store/gateway">סליקת אשראי</a>").</p>
      <div id="st-pays">${s.payments.map(payRow).join('')}</div>
      <button type="button" class="btn sm secondary" id="st-add-pay">+ אמצעי תשלום</button>
      ${demoField}
    </section>

    <p class="notice slim neutral st-moved" id="shelves"><a href="/admin/store/shelves">🗂️ קטגוריות המוצרים עברו למסך משלהן ←</a></p>

    <section class="card">
      <h3 class="sub-head">📄 דפי החנות</h3>
      <div class="st-grid2">${st.pages.KINDS.map((k) => `<label>${esc(st.pages.TITLES[k])} <input class="input" name="page_${k}" dir="ltr" value="${esc(s.pages[k])}"></label>`).join('')}</div>
      <p class="faint">הכתובות שהחנות משתמשת בהן. בפתיחת החנות דף חסר נוצר ב-BenTML; דף קיים לא נדרס לעולם.</p>
    </section>

    <div class="row end st-savebar"><span id="st-save-out" aria-live="polite"></span><button type="button" class="btn" id="st-save">שמירה</button></div>
    </form>

    <template id="st-ship-tpl">${shipRow({ id: '', label: '', price: 0, freeOver: null, address: true, note: '' })}</template>
    <template id="st-pay-tpl">${payRow({ id: '', kind: 'bank', label: '', details: '', phone: '', url: '' })}</template>
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
      form.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('[data-remove]');
        if (b) { var row = b.closest('.st-rowed'); if (row) row.remove(); }
      });
      // installments belong to a card method only
      form.addEventListener('change', function (ev) {
        var sel = ev.target;
        if (!sel || sel.getAttribute('data-k') !== 'kind') return;
        var row = sel.closest('.st-rowed');
        var box = row && row.querySelector('[data-card-only]');
        if (box) box.hidden = sel.value !== 'card';
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
          pages: { shop: val('page_shop'), cart: val('page_cart'), checkout: val('page_checkout'), order: val('page_order') }
        };
        // only a store that has these two settings prints their fields
        if (val('holdHours') !== undefined) body.holdHours = val('holdHours');
        if (val('demoPayments') !== undefined) body.demoPayments = val('demoPayments');
        out.textContent = 'שומרים…'; out.className = '';
        fetch('/admin/api/store/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) { out.textContent = d.error || 'שגיאה'; out.className = 'st-bad'; return; }
            // what could not be saved as typed, then what was saved and will not reach the checkout
            var said = (d.errors || []).concat(d.notes || []);
            out.textContent = 'נשמר ✓' + (said.length ? ' · ' + said.join(' · ') : '');
            out.className = said.length ? 'st-warn' : 'st-ok';
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
      'requireEmail', 'customerEmails', 'notifyEmail', 'terms', 'thanks', 'shipping', 'payments', 'pages', 'holdHours', 'demoPayments']) {
      if (b[k] !== undefined) patch[k] = b[k];
    }
    // money fields from the form are what a person typed (major units)
    if (patch.minOrder !== undefined) patch.minOrder = String(patch.minOrder);
    if (Array.isArray(patch.shipping)) {
      patch.shipping = patch.shipping.map((m) => ({ ...m, price: String(m.price || '0'), freeOver: m.freeOver === '' || m.freeOver == null ? null : String(m.freeOver) }));
    }
    // A `shelves` key is NOT read. This route used to take the posted list
    // as the whole truth and delete every category missing from it — a
    // settings tab left open since before the upgrade must not be able to
    // wipe the categories with one click on "שמירה".
    const saved = st.settings.saveSettings(patch);
    // The store's name and the shop page's address are written INTO every
    // product and category page (the trail), so those pages are brought in
    // step before the rebuild — a rebuild alone printed the old name for
    // ever. A sync that fails is logged and never fails the save.
    try {
      if (st.isOpen()) st.pages.syncCatalogPages();
    } catch (e) {
      console.error('[store] page sync after a settings save failed:', e.message);
    }
    const rebuilt = st.refreshNow();
    res.json({ ok: true, settings: saved.settings, errors: saved.errors, notes: paymentNotes(st, saved.settings), rebuilt });
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
  const csvIo = require('../store/csv-io');
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
    <section class="card" id="csv">
      <h3 class="sub-head">📄 ייבוא וייצוא CSV</h3>
      <p class="lead">הקטלוג כגיליון: מייצאים, עורכים ב-Excel או ב-Google Sheets, ומייבאים חזרה. ייבוא עובר באותה דלת כמו המסמך שלמעלה — תצוגה מקדימה, גיבוי, החלה, ואפשר לבטל.</p>
      <p class="st-csv-help">העמודות שנקראות: <code dir="ltr">${esc(csvIo.HEAD.join(', '))}</code>. גם שמות העמודות של Shopify ושל WooCommerce מובנים. כל שורה מותאמת למוצר לפי <code dir="ltr">sku</code>; מוצר שהקובץ לא מזכיר נשאר כמו שהוא, ועמודה שחסרה בקובץ לא נוגעת בשדה שלה.</p>
      <div class="st-csv-bar">
        <span class="row"><a class="btn sm secondary" href="/admin/store/products.csv" data-nav-full>⬇ ייצוא CSV</a>
        <button type="button" class="btn sm secondary" id="csv-pick">⬆ בחירת קובץ CSV</button>
        <input type="file" id="csv-file" accept=".csv,text/csv" hidden>
        <span class="faint" id="csv-name"></span></span>
        <span class="row"><span id="csv-out" aria-live="polite"></span>
        <button type="button" class="btn sm secondary" id="csv-preview" disabled>👁 תצוגה מקדימה</button>
        <button type="button" class="btn sm" id="csv-apply" disabled>✅ החלה על החנות</button></span>
      </div>
      <div id="csv-preview-out" class="st-preview" aria-live="polite"></div>
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
      // one renderer for both doors on this screen: the pasted document and the CSV file
      function render(d, target) {
        var p = d.preview || {};
        var html = '';
        if (d.errors && d.errors.length) html += '<div class="st-pv-bad">' + d.errors.map(function (e) { return esc(e.message); }).join('<br>') + '</div>';
        html += list('יתווספו', p.added, function (x) { return esc(x.title) + ' · ' + esc(x.priceText); });
        html += list('ישתנו', p.changed, function (x) { return esc(x.title) + ' — ' + esc((x.fields || []).join(' · ')); });
        html += list('יוסתרו (לא מופיעים במסמך)', p.hidden, function (x) { return esc(x.title); });
        if (p.unchanged) html += '<p class="faint">' + (p.unchanged === 1 ? 'מוצר אחד' : p.unchanged + ' מוצרים') + ' בלי שינוי.</p>';
        html += list('קטגוריות חדשות', p.shelvesAdded, esc) + list('קטגוריות שמשתנות', p.shelvesChanged, esc);
        // a sheet's costs are written beside the document (the CSV door only) — so a backup does not hold them, and the owner is told
        if (d.costs) html += '<div class="st-pv-sec"><b>מחירי עלות שיתעדכנו (' + Number(d.costs) + ')</b><div class="faint">מחיר העלות נשמר ליד המסמך, לא בתוכו — ו"ביטול החלה אחרונה" מחזיר גם אותו.</div></div>';
        html += list('הגדרות', p.settings, esc);
        if (p.coupons) {
          html += list('קופונים חדשים', p.coupons.added, esc) + list('קופונים שמשתנים', p.coupons.changed, esc) + list('קופונים שיכובו', p.coupons.off, esc);
        }
        var warns = (d.warnings || []);
        if (warns.length) html += '<div class="st-pv-sec"><b>הערות</b><ul>' + warns.map(function (w) {
          return '<li class="' + (w.hard ? 'st-bad' : 'faint') + '">' + (w.hard ? '⚠ ' : '') + esc(w.message) + '</li>'; }).join('') + '</ul></div>';
        (target || box).innerHTML = html || '<p class="faint">אין שינויים.</p>';
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

      // the CSV door: the file is read here as text and sent as JSON; the server turns it into a merge document
      var csvPick = document.getElementById('csv-pick');
      var csvFile = document.getElementById('csv-file');
      var csvName = document.getElementById('csv-name');
      var csvOut = document.getElementById('csv-out');
      var csvBox = document.getElementById('csv-preview-out');
      var csvPreview = document.getElementById('csv-preview');
      var csvApply = document.getElementById('csv-apply');
      var CSV_MAX = ${Number(csvIo.MAX_BYTES) || 0};
      var csvText = null;
      var csvHard = false;
      function csvSay(text, cls) { csvOut.textContent = text || ''; csvOut.className = cls || ''; }
      function csvSend(body) {
        return fetch('/admin/api/store/import-csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function (r) { return r.json(); })
          .catch(function () { return { ok: false, network: true, errors: [{ message: 'שגיאת רשת — לא נשמר דבר' }] }; });
      }
      function csvLook() {
        if (csvText === null) return;
        csvApply.disabled = true;
        csvSay('בודקים…', '');
        csvSend({ csv: csvText }).then(function (d) {
          render(d, csvBox);
          csvHard = !!d.hard;
          csvApply.disabled = !d.ok;
          if (!d.ok) csvSay('לא ניתן לייבא', 'st-bad');
          else csvSay((d.count === 1 ? 'שורת מוצר אחת' : d.count + ' שורות מוצר') + (d.hard ? ' · יש אזהרות — ההחלה תבקש אישור' : ' · מוכן להחלה'), d.hard ? 'st-warn' : 'st-ok');
        });
      }
      csvPick.addEventListener('click', function () { csvFile.click(); });
      csvFile.addEventListener('change', function () {
        var f = csvFile.files && csvFile.files[0];
        csvText = null; csvPreview.disabled = true; csvApply.disabled = true; csvBox.textContent = ''; csvSay('', '');
        csvName.textContent = f ? f.name : '';
        if (!f) return;
        if (CSV_MAX && f.size > CSV_MAX) { csvSay('הקובץ גדול מ-2MB — פצלו אותו לכמה קבצים', 'st-bad'); return; }
        var r = new FileReader();
        r.onload = function () { csvText = String(r.result || ''); csvPreview.disabled = false; csvLook(); };
        r.onerror = function () { csvSay('לא הצלחנו לקרוא את הקובץ', 'st-bad'); };
        r.readAsText(f);
      });
      csvPreview.addEventListener('click', csvLook);
      csvApply.addEventListener('click', function () {
        if (csvText === null) return;
        if (csvHard && !confirm('יש אזהרות (מסומנות ⚠). לייבא בכל זאת? גיבוי של החנות נשמר קודם.')) return;
        csvApply.disabled = true;
        csvSay('מייבאים…', '');
        csvSend({ csv: csvText, apply: true, force: csvHard }).then(function (d) {
          if (!d.ok) { render(d, csvBox); csvSay(d.message || 'לא יובא', 'st-bad'); return; }
          csvSay('יובא ✓ (גיבוי #' + d.backupId + ')' + (d.costs ? ' · עודכנו ' + d.costs + ' מחירי עלות' : ''), 'st-ok');
          setTimeout(function () { location.reload(); }, 900);
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

/**
 * The CSV door. A sheet is not written from here: csv-io turns it into a
 * MERGE <bent-store> document and that goes through the door every paste
 * goes through — plan, backup, apply, undo. `{ csv }` previews;
 * `{ csv, apply: true, force }` applies. A product's cost cannot ride in the
 * document (it is the owner's number), so it is written beside it once the
 * apply has landed — for the products that apply WROTE, and no other: a row
 * the document refused (a price nobody can read) used to leave its product's
 * fields alone and still overwrite its cost.
 */
router.post('/admin/api/store/import-csv', requireAdmin, (req, res) => {
  try {
    const st = store();
    const csvIo = require('../store/csv-io');
    const b = req.body || {};
    const sheet = csvIo.csvToDocument(typeof b.csv === 'string' ? b.csv : '');
    // a sheet's problems are said where the owner will look: by its line
    const byLine = (x) => ({ line: x.line, message: (x.line ? 'שורה ' + x.line + ': ' : '') + x.message });
    const sheetErrors = sheet.errors.map(byLine);
    const sheetNotes = sheet.warnings.map((x) => ({ ...byLine(x), hard: false }));
    if (!sheet.ok) {
      return res.status(400).json({ ok: false, count: 0, errors: sheetErrors, warnings: sheetNotes, preview: null, hard: true,
        message: sheetErrors.map((e) => e.message).join(' · ') });
    }
    if (b.apply !== true) {
      const { plan, ...planned } = st.document.planDocument(sheet.source, { trusted: true });
      // costs travel beside the document, so its preview cannot show them:
      // a sheet that only changes costs would otherwise preview as "no changes"
      // (only the rows the plan will write — a refused row's cost goes nowhere)
      const writes = new Set(plan ? plan.products.map((p) => p.slug) : []);
      let costs = 0;
      for (const [slug, v] of Object.entries(sheet.costs)) {
        if (!writes.has(slug)) continue;
        const had = st.catalog.getProductBySlug(slug);
        if (had ? had.cost !== v : v !== null) costs++;
      }
      return res.status(planned.ok ? 200 : 400).json({
        ...planned,
        count: sheet.count,
        costs,
        errors: sheetErrors.concat(planned.errors),
        warnings: sheetNotes.concat(planned.warnings),
        // a skipped row is worth a yes before the rest is written
        hard: planned.hard || sheetErrors.length > 0,
        source: sheet.source
      });
    }
    const { plan, ...applied } = st.document.applyDocument(sheet.source, { trusted: true, reason: 'csv', force: b.force === true });
    if (!applied.ok) {
      return res.status(400).json({ ...applied, count: sheet.count, errors: sheetErrors.concat(applied.errors || []), warnings: sheetNotes.concat(applied.warnings || []) });
    }
    const wrote = new Set((applied.changed && applied.changed.slugs) || []);
    const costs = st.catalog.setCosts(Object.fromEntries(Object.entries(sheet.costs).filter(([slug]) => wrote.has(slug))));
    res.json({ ...applied, count: sheet.count, costs: costs.changed, errors: sheetErrors, warnings: sheetNotes.concat(applied.warnings || []) });
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
