'use strict';

/**
 * The store's products (v2.53) — the list, the editor, and their API.
 * A saved product that is active gets (or keeps) its page while the store
 * is open; a hidden, draft or deleted one has its page taken down (kept as
 * a draft — never deleted). Money fields are what a person types ("89.90").
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

/** A product as the form sends it: money stays a typed string (major units), always. */
function fromForm(b) {
  const out = { ...(b || {}) };
  for (const k of ['price', 'compareAt']) if (out[k] !== undefined && out[k] !== null) out[k] = String(out[k]);
  if (Array.isArray(out.variants)) {
    out.variants = out.variants.map((v) => ({ ...v, price: v.price === '' || v.price == null ? null : String(v.price) }));
  }
  if (out.trackStock === false || out.trackStock === 'false') out.stock = null;
  delete out.trackStock;
  return out;
}

router.get('/admin/store/products', requireAdmin, (req, res) => {
  const st = store();
  const s = st.settings.loadSettings();
  const q = String(req.query.q || '').slice(0, 80);
  const status = ['active', 'hidden', 'draft'].includes(req.query.status) ? req.query.status : 'all';
  const shelf = String(req.query.shelf || '');
  const shelves = st.catalog.listShelves();
  const list = st.catalog.listProducts({ status, shelf, q, sort: 'manual' });
  const published = st.pages.publishedProductPaths();
  const rows = list.length ? list.map((p) => {
    const url = st.pages.productUrl(p.slug, published);
    const stockCell = p.variants.length
      ? `<span class="faint">לפי אפשרות (${p.variants.length})</span>`
      : `<input class="input st-stock" data-stock="${p.id}" inputmode="numeric" dir="ltr" value="${p.stock === null ? '' : p.stock}" placeholder="∞" title="ריק = בלי ספירת מלאי">`;
    return `<tr>
      <td>${p.images[0] ? `<img class="st-thumb" src="${esc(p.images[0])}" alt="">` : '<span class="st-thumb st-thumb-empty">🛍️</span>'}</td>
      <td><a href="/admin/store/products/${p.id}"><b>${esc(p.title)}</b></a><div class="faint" dir="ltr">${esc(p.slug)}</div></td>
      <td>${kit.fmt(p.price, s.currency)}${p.compareAt ? ` <s class="faint">${kit.fmt(p.compareAt, s.currency)}</s>` : ''}</td>
      <td>${stockCell}</td>
      <td>${esc((shelves.find((x) => x.slug === p.shelf) || {}).label || p.shelf || '—')}</td>
      <td>${kit.productPill(p.status)}</td>
      <td class="row"><a class="btn xs secondary" href="/admin/store/products/${p.id}">עריכה</a>${url ? ` <a class="btn xs secondary" href="${esc(url)}" target="_blank" rel="noopener">באתר ↗</a>` : ''}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" class="tbl-empty">${q || shelf || status !== 'all' ? 'אין מוצרים שמתאימים לסינון.' : 'עוד אין מוצרים. <a href="/admin/store/products/new">הוסיפו את הראשון</a>, או הדביקו קטלוג שלם ב-<a href="/admin/store/bentml">BenTML</a>.'}</td></tr>`;
  const body = `
    <form class="row st-filters" method="GET" action="/admin/store/products">
      <input class="input compact" name="q" value="${esc(q)}" placeholder="חיפוש מוצר…">
      <select class="input compact" name="status">
        <option value="all">כל הסטטוסים</option>
        ${['active', 'hidden', 'draft'].map((x) => `<option value="${x}"${x === status ? ' selected' : ''}>${st.catalog.STATUS_LABELS[x]}</option>`).join('')}
      </select>
      <select class="input compact" name="shelf"><option value="">כל המדפים</option>
        ${shelves.map((x) => `<option value="${esc(x.slug)}"${x.slug === shelf ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
      <button class="btn sm secondary" type="submit">סינון</button>
    </form>
    <section class="card">
      <table class="tbl st-products"><thead><tr><th></th><th>מוצר</th><th>מחיר</th><th>מלאי</th><th>מדף</th><th>סטטוס</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="faint" id="st-stock-out" aria-live="polite"></p>
    </section>
    <script>
    (function () {
      var out = document.getElementById('st-stock-out');
      document.querySelectorAll('[data-stock]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          fetch('/admin/api/store/products/' + inp.getAttribute('data-stock') + '/stock', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stock: inp.value })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (out) out.textContent = d.ok ? 'המלאי עודכן ✓' : (d.error || 'שגיאה');
          });
        });
      });
    })();
    </script>`;
  res.send(kit.screen({
    key: 'store-products', title: 'מוצרים', body,
    actions: '<a class="btn" href="/admin/store/products/new">+ מוצר חדש</a>'
  }));
});

function editor(req, res, product) {
  const st = store();
  const s = st.settings.loadSettings();
  const money = st.money;
  const isNew = !product;
  const p = product || {
    id: 0, slug: '', title: '', summary: '', description: '', price: null, compareAt: null, stock: null,
    images: [], shelf: '', badge: '', status: 'active', delivery: true, maxPerOrder: null, variants: []
  };
  const major = (n) => (n === null || n === undefined ? '' : money.fromMinor(n));
  const shelves = st.catalog.listShelves();
  const url = !isNew ? st.pages.productUrl(p.slug) : '';
  const imgRow = (src) => `<div class="st-rowed" data-img>
      <img class="st-thumb" src="${esc(src)}" alt="" ${src ? '' : 'hidden'}>
      <input class="input" data-k="src" dir="ltr" value="${esc(src)}" placeholder="/assets/…">
      <button type="button" class="btn xs secondary" data-pick>🖼 בחירה</button>
      <button type="button" class="btn xs secondary" data-remove title="הסרה">✕</button></div>`;
  const varRow = (v) => `<div class="st-rowed" data-var>
      <input class="input" data-k="label" placeholder="שם (למשל: M / אדום)" value="${esc(v.label)}">
      <input class="input" data-k="code" dir="ltr" placeholder="מזהה" value="${esc(v.code)}">
      <label class="st-inline">מחיר ₪ <input class="input" data-k="price" inputmode="decimal" dir="ltr" placeholder="כמו המוצר" value="${esc(major(v.price))}"></label>
      <label class="st-inline">מלאי <input class="input" data-k="stock" inputmode="numeric" dir="ltr" placeholder="∞" value="${v.stock === null || v.stock === undefined ? '' : v.stock}"></label>
      <button type="button" class="btn xs secondary" data-remove title="הסרה">✕</button></div>`;
  const body = `
    ${req.query.saved ? '<p class="pill ok">נשמר ✓</p>' : ''}
    <form id="pe-form" class="stack" onsubmit="return false">
      <section class="card">
        <div class="st-grid2">
          <label>שם המוצר * <input class="input" name="title" value="${esc(p.title)}" maxlength="120" required></label>
          <label>מזהה (SKU / כתובת) ${isNew ? '<input class="input" name="slug" dir="ltr" placeholder="ייווצר מהשם" value="">' : `<input class="input" value="${esc(p.slug)}" dir="ltr" readonly title="המזהה הוא הזהות של המוצר — הוא לא משתנה">`}</label>
          <label>מחיר (₪) * <input class="input" name="price" inputmode="decimal" dir="ltr" value="${esc(major(p.price))}" placeholder="89.90"></label>
          <label>מחיר לפני (מחיר מחוק) <input class="input" name="compareAt" inputmode="decimal" dir="ltr" value="${esc(major(p.compareAt))}" placeholder="—"></label>
          <label>סטטוס <select class="input" name="status">${['active', 'hidden', 'draft'].map((x) => `<option value="${x}"${x === p.status ? ' selected' : ''}>${st.catalog.STATUS_LABELS[x]}</option>`).join('')}</select></label>
          <label>מדף <select class="input" name="shelf"><option value="">—</option>${shelves.map((x) => `<option value="${esc(x.slug)}"${x.slug === p.shelf ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}<option value="__new">+ מדף חדש…</option></select></label>
          <label>תווית (מבצע / חדש) <input class="input" name="badge" maxlength="24" value="${esc(p.badge)}"></label>
          <label>עד כמה יחידות בהזמנה <input class="input" name="maxPerOrder" inputmode="numeric" dir="ltr" value="${p.maxPerOrder || ''}" placeholder="ללא הגבלה"></label>
        </div>
        <label class="st-inline"><input type="checkbox" name="trackStock"${p.stock !== null && p.stock !== undefined ? ' checked' : ''}> ספירת מלאי</label>
        <input class="input compact" name="stock" inputmode="numeric" dir="ltr" value="${p.stock === null || p.stock === undefined ? '' : p.stock}" placeholder="כמה במלאי" style="width:140px">
        <label class="st-inline"><input type="checkbox" name="delivery"${p.delivery ? ' checked' : ''}> צריך משלוח (מוצר פיזי)</label>
        <label style="display:block;margin-top:12px">שורת תקציר <input class="input" name="summary" maxlength="200" value="${esc(p.summary)}"></label>
        <label style="display:block;margin-top:12px">תיאור <textarea class="input" name="description" rows="6">${esc(p.description)}</textarea></label>
      </section>
      <section class="card">
        <h3 class="sub-head">🖼 תמונות</h3>
        <div id="pe-imgs">${(p.images.length ? p.images : ['']).map(imgRow).join('')}</div>
        <button type="button" class="btn sm secondary" id="pe-add-img">+ תמונה</button>
      </section>
      <section class="card">
        <h3 class="sub-head">🎛 אפשרויות (מידה, צבע…)</h3>
        <p class="faint">מוצר עם אפשרויות סופר מלאי לכל אפשרות בנפרד, ולכל אחת יכול להיות מחיר משלה.</p>
        <div id="pe-vars">${p.variants.map(varRow).join('')}</div>
        <button type="button" class="btn sm secondary" id="pe-add-var">+ אפשרות</button>
      </section>
      <div class="row between st-savebar">
        <span class="row">${!isNew ? `<button type="button" class="btn sm secondary" id="pe-dup">שכפול</button>
          <button type="button" class="btn sm danger" id="pe-del">מחיקה</button>` : ''}
          ${url ? `<a class="btn sm secondary" href="${esc(url)}" target="_blank" rel="noopener">צפייה בדף המוצר ↗</a>` : ''}</span>
        <span class="row"><span id="pe-out" aria-live="polite"></span><button type="button" class="btn" id="pe-save">שמירה</button></span>
      </div>
    </form>
    <template id="pe-img-tpl">${imgRow('')}</template>
    <template id="pe-var-tpl">${varRow({ label: '', code: '', price: null, stock: null })}</template>
    <script>
    (function () {
      var form = document.getElementById('pe-form');
      if (!form) return;
      var id = ${Number(p.id) || 0};
      var out = document.getElementById('pe-out');
      function f(n) { return form.querySelector('[name="' + n + '"]'); }
      var seq = 0;
      function wirePick(row) {
        var inp = row.querySelector('[data-k="src"]');
        var btn = row.querySelector('[data-pick]');
        var img = row.querySelector('img');
        if (!inp || !btn) return;
        if (!inp.id) inp.id = 'pe-img-' + (++seq) + '-' + Date.now();
        btn.setAttribute('data-media-pick', inp.id);
        inp.addEventListener('input', function () { img.src = inp.value; img.hidden = !inp.value; });
      }
      Array.prototype.forEach.call(form.querySelectorAll('[data-img]'), wirePick);
      function add(listId, tplId) {
        var node = document.getElementById(tplId).content.cloneNode(true);
        var row = node.querySelector('.st-rowed');
        document.getElementById(listId).appendChild(node);
        if (row && row.hasAttribute('data-img')) wirePick(row);
      }
      document.getElementById('pe-add-img').addEventListener('click', function () { add('pe-imgs', 'pe-img-tpl'); });
      document.getElementById('pe-add-var').addEventListener('click', function () { add('pe-vars', 'pe-var-tpl'); });
      form.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('[data-remove]');
        if (b) { var row = b.closest('.st-rowed'); if (row) row.remove(); }
      });
      var track = f('trackStock');
      var trackLabel = track.closest('label');
      // with options, stock is counted per option (each row's own field)
      function syncStock() {
        var hasVars = form.querySelectorAll('[data-var]').length > 0;
        if (trackLabel) trackLabel.hidden = hasVars;
        f('stock').hidden = hasVars || !track.checked;
      }
      track.addEventListener('change', syncStock); syncStock();
      new MutationObserver(syncStock).observe(document.getElementById('pe-vars'), { childList: true });
      f('shelf').addEventListener('change', function () {
        if (f('shelf').value !== '__new') return;
        var label = prompt('שם המדף החדש');
        if (!label) { f('shelf').value = ''; return; }
        fetch('/admin/api/store/shelves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: label }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) { alert(d.error || 'שגיאה'); f('shelf').value = ''; return; }
            var o = document.createElement('option'); o.value = d.shelf.slug; o.textContent = d.shelf.label;
            f('shelf').insertBefore(o, f('shelf').lastElementChild); f('shelf').value = d.shelf.slug;
          });
      });
      function collect() {
        var body = {
          title: f('title').value, price: f('price').value, compareAt: f('compareAt').value,
          status: f('status').value, shelf: f('shelf').value === '__new' ? '' : f('shelf').value, badge: f('badge').value,
          maxPerOrder: f('maxPerOrder').value, trackStock: track.checked, stock: track.checked && !form.querySelector('[data-var]') ? f('stock').value : '',
          delivery: f('delivery').checked, summary: f('summary').value, description: f('description').value,
          images: Array.prototype.map.call(form.querySelectorAll('[data-img] [data-k="src"]'), function (i) { return i.value.trim(); }).filter(Boolean),
          variants: Array.prototype.map.call(form.querySelectorAll('[data-var]'), function (row) {
            var v = {}; Array.prototype.forEach.call(row.querySelectorAll('[data-k]'), function (i) { v[i.getAttribute('data-k')] = i.value; });
            return v;
          }).filter(function (v) { return v.label.trim(); })
        };
        if (!id && f('slug')) body.slug = f('slug').value;
        return body;
      }
      document.getElementById('pe-save').addEventListener('click', function () {
        out.textContent = 'שומרים…'; out.className = '';
        fetch('/admin/api/store/products' + (id ? '/' + id : ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collect()) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok) { out.textContent = d.error || 'שגיאה'; out.className = 'st-bad'; return; }
            if (!id) { location.href = '/admin/store/products/' + d.product.id + '?saved=1'; return; }
            out.textContent = 'נשמר ✓' + (d.warnings && d.warnings.length ? ' · ' + d.warnings.join(' · ') : '');
            out.className = d.warnings && d.warnings.length ? 'st-warn' : 'st-ok';
          })
          .catch(function () { out.textContent = 'שגיאת רשת'; out.className = 'st-bad'; });
      });
      var del = document.getElementById('pe-del');
      if (del) del.addEventListener('click', function () {
        if (!confirm('למחוק את המוצר לצמיתות? הזמנות קודמות שומרות את הפרטים שלהן. (אפשר גם רק להסתיר — סטטוס "מוסתר".)')) return;
        fetch('/admin/api/store/products/' + id + '/delete', { method: 'POST' }).then(function (r) { return r.json(); })
          .then(function (d) { if (d.ok) location.href = '/admin/store/products'; else out.textContent = d.error || 'שגיאה'; });
      });
      var dup = document.getElementById('pe-dup');
      if (dup) dup.addEventListener('click', function () {
        fetch('/admin/api/store/products/' + id + '/duplicate', { method: 'POST' }).then(function (r) { return r.json(); })
          .then(function (d) { if (d.ok) location.href = '/admin/store/products/' + d.product.id + '?saved=1'; else out.textContent = d.error || 'שגיאה'; });
      });
    })();
    </script>
    <script src="/admin-media-picker.js"></script>`;
  res.send(kit.screen({ key: 'store-products', title: isNew ? 'מוצר חדש' : p.title, body, width: 900 }));
}

router.get('/admin/store/products/new', requireAdmin, (req, res) => editor(req, res, null));

router.get('/admin/store/products/:id', requireAdmin, (req, res) => {
  const p = store().catalog.getProduct(Number(req.params.id));
  if (!p) return res.status(404).send(kit.screen({ key: 'store-products', title: 'מוצר', body: '<p class="card">המוצר לא נמצא. <a href="/admin/store/products">לרשימת המוצרים</a></p>' }));
  return editor(req, res, p);
});

// ── API ────────────────────────────────────────────────────────────────

router.get('/admin/api/store/products', requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, products: store().catalog.listProducts({ status: 'all', q: req.query.q || '', shelf: req.query.shelf || '' }) });
  } catch (e) { sendError(res, e, 500); }
});

router.post('/admin/api/store/products', requireAdmin, (req, res) => {
  try {
    const st = store();
    const r = st.catalog.createProduct(fromForm(req.body));
    const after = st.afterProductChange(r.product);
    res.json({ ok: true, product: r.product, warnings: r.warnings, page: after.page });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/products/:id', requireAdmin, (req, res) => {
  try {
    const st = store();
    const r = st.catalog.updateProduct(Number(req.params.id), fromForm(req.body));
    const after = st.afterProductChange(r.product);
    res.json({ ok: true, product: r.product, warnings: r.warnings, page: after.page });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/products/:id/delete', requireAdmin, (req, res) => {
  try {
    const st = store();
    const gone = st.catalog.deleteProduct(Number(req.params.id));
    if (!gone) return res.status(404).json({ ok: false, error: 'המוצר לא נמצא' });
    const after = st.afterProductChange(null, { deletedSlug: gone.slug });
    res.json({ ok: true, page: after.page });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/products/:id/duplicate', requireAdmin, (req, res) => {
  try {
    const r = store().catalog.duplicateProduct(Number(req.params.id));
    res.json({ ok: true, product: r.product, warnings: r.warnings });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/products/:id/stock', requireAdmin, (req, res) => {
  try {
    const st = store();
    const b = req.body || {};
    const p = st.catalog.setStock(Number(req.params.id), b.variant || '', b.stock);
    st.refreshNow();
    res.json({ ok: true, product: p });
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/shelves', requireAdmin, (req, res) => {
  try { res.json({ ok: true, shelf: store().catalog.saveShelf(req.body || {}) }); } catch (e) { sendError(res, e); }
});

module.exports = router;
