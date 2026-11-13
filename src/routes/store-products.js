'use strict';

/**
 * The store's products — the list, the editor, and their API (v2.53; grown
 * up in v2.69).
 *
 * A saved product that is active gets (or keeps) its page while the store
 * is open; a hidden, draft or deleted one has its page taken down (kept as
 * a draft — never deleted). Money fields are what a person types ("89.90").
 *
 * v2.69 — the owner: "I urge you to refine the product creation … which are
 * very lean on tapuziel … to compete shopify". The list filters, sorts,
 * pages, is put in order by hand and acts on many products at once; the
 * editor is two columns of cards with a picture gallery, options that can be
 * generated, a search-result preview and the product as the site draws it.
 * What both screens share in the browser is public/admin-store.js; what is
 * inline here is each screen's own wiring.
 */

const express = require('express');
const { requireAdmin } = require('../admin-guard');
const kit = require('../store/admin-kit');
const { jsonForScript } = require('../admin-ui');

const router = express.Router();
const { esc } = kit;

function store() { return require('../store'); }

function sendError(res, e, status = 400) {
  res.status(status).json({ ok: false, error: e && e.message ? e.message : String(e), errors: (e && e.errors) || undefined });
}

/**
 * A product as the form sends it: money stays a typed string (major units),
 * always. A JSON integer is read by the catalog as MINOR units, so a cost of
 * 55 that arrived as a number would be saved as 55 agorot — `cost` is money
 * exactly like the price.
 */
function fromForm(b) {
  const out = { ...(b || {}) };
  for (const k of ['price', 'compareAt', 'cost']) if (out[k] !== undefined && out[k] !== null) out[k] = String(out[k]);
  if (Array.isArray(out.variants)) {
    out.variants = out.variants.map((v) => ({ ...v, price: v.price === '' || v.price == null ? null : String(v.price) }));
  }
  if (out.trackStock === false || out.trackStock === 'false') out.stock = null;
  delete out.trackStock;
  return out;
}

// One page of the list. More than this is paged — never a silent cap.
const PAGE_SIZE = 100;
const EVERYTHING = 100000;
// "No category" in the address and in the bulk bar: a dash can never be a category's own id.
const NO_SHELF = '-';
const STATUS_KEYS = ['active', 'hidden', 'draft'];
const SORTS = [
  ['manual', 'סדר ידני'], ['new', 'חדשים קודם'], ['updated', 'עודכנו לאחרונה'],
  ['price-asc', 'מחיר עולה'], ['price-desc', 'מחיר יורד'], ['name', 'שם']
];
const STOCKS = [['', 'הכול'], ['out', 'אזל מהמלאי'], ['low', 'מלאי נמוך']];
// The catalog-health questions the hub links here with; they have no select of their own.
const CHECKS = { noimage: 'בלי תמונה', price0: 'מחיר 0' };

/** The categories as <option>s — a tree: a child sits under its parent, marked "— ". */
function shelfOptions(shelves, selected) {
  return shelves.map((x) => `<option value="${esc(x.slug)}" data-depth="${x.depth ? 1 : 0}"${x.slug === selected ? ' selected' : ''}>` +
    `${x.depth ? '— ' : ''}${esc(x.label)}${x.hidden ? ' (מוסתרת)' : ''}</option>`).join('');
}

/** What the list was asked for, cleaned. Anything it does not know is "no filter", never an error. */
function listQuery(query, shelves) {
  const one = (v) => String(Array.isArray(v) ? v[0] : v === undefined || v === null ? '' : v);
  let shelf = one(query.shelf).slice(0, 80);
  if (shelf && shelf !== NO_SHELF && !shelves.some((x) => x.slug === shelf)) shelf = shelf === 'none' ? NO_SHELF : '';
  // check=noimage | check=price0 is the address this screen writes; the looser
  // spellings are read too, so a link from the hub never lands on an unfiltered list
  const check = Object.prototype.hasOwnProperty.call(CHECKS, one(query.check)) ? one(query.check)
    : one(query.image) === 'none' || one(query.images) === 'none' || one(query.noimage) === '1' ? 'noimage'
      : one(query.price) === '0' || one(query.price0) === '1' ? 'price0' : '';
  return {
    q: one(query.q).trim().slice(0, 80),
    status: STATUS_KEYS.includes(one(query.status)) ? one(query.status) : 'all',
    shelf,
    brand: one(query.brand).trim().slice(0, 60),
    stock: ['out', 'low'].includes(one(query.stock)) ? one(query.stock) : '',
    sort: SORTS.some(([k]) => k === one(query.sort)) ? one(query.sort) : 'manual',
    check,
    page: Math.max(parseInt(one(query.page), 10) || 1, 1)
  };
}

/** The list's address for a set of filters — defaults are left out, so a clean list has a clean address. */
function listUrl(f, over = {}) {
  const v = { ...f, page: 1, ...over };
  const qs = new URLSearchParams();
  if (v.status && v.status !== 'all') qs.set('status', v.status);
  if (v.q) qs.set('q', v.q);
  if (v.shelf) qs.set('shelf', v.shelf);
  if (v.brand) qs.set('brand', v.brand);
  if (v.stock) qs.set('stock', v.stock);
  if (v.check) qs.set('check', v.check);
  if (v.sort && v.sort !== 'manual') qs.set('sort', v.sort);
  if (v.page > 1) qs.set('page', String(v.page));
  const text = qs.toString();
  return '/admin/store/products' + (text ? '?' + text : '');
}

function countText(n) {
  return n === 1 ? 'מוצר אחד' : n + ' מוצרים';
}

/**
 * in | low | out for the owner's list. With options the product is "out"
 * only when every option is, and "low" when any counted option is running
 * low — the same reading the stock filter makes in SQL (catalog.listProducts).
 */
function stockOf(catalog, p, low) {
  if (!p.variants.length) return catalog.stockState(p.stock, low);
  if (!p.variants.some((v) => v.stock === null || v.stock > 0)) return 'out';
  return low && p.variants.some((v) => v.stock !== null && v.stock > 0 && v.stock <= low) ? 'low' : 'in';
}

function stockPill(state) {
  const tone = state === 'out' ? 'danger' : 'warn';
  return `<span class="pill ${tone} st-stockpill" data-stock-pill${state === 'in' ? ' hidden' : ''}>${state === 'out' ? 'אזל' : state === 'low' ? 'נמוך' : ''}</span>`;
}

router.get('/admin/store/products', requireAdmin, (req, res) => {
  const st = store();
  const s = st.settings.loadSettings();
  const catalog = st.catalog;
  const shelves = catalog.listShelves();
  const byShelf = new Map(shelves.map((x) => [x.slug, x]));
  const brands = catalog.listBrands();
  const f = listQuery(req.query, shelves);

  // One read serves the rows AND the tabs' numbers, so a tab's count is
  // exactly what a click on it shows. The catalog has no offset, so the page
  // is cut here — fine at the sizes one owner's screen holds.
  let found = catalog.listProducts({
    status: 'all', q: f.q, brand: f.brand, stock: f.stock, sort: f.sort, limit: EVERYTHING,
    shelf: f.shelf && f.shelf !== NO_SHELF ? f.shelf : ''
  });
  if (f.shelf === NO_SHELF) found = found.filter((p) => !p.shelf);
  if (f.check === 'noimage') found = found.filter((p) => !p.images.length);
  if (f.check === 'price0') found = found.filter((p) => p.price === 0);
  const counts = { all: found.length, active: 0, hidden: 0, draft: 0 };
  for (const p of found) counts[p.status] = (counts[p.status] || 0) + 1;
  const list = f.status === 'all' ? found : found.filter((p) => p.status === f.status);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const rows = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const narrowed = !!(f.q || f.shelf || f.brand || f.stock || f.check);
  const filtered = narrowed || f.status !== 'all';
  // dragging decides where a product stands in the WHOLE shop, so it is only
  // offered when the whole shop is on screen in its own order
  const canOrder = f.sort === 'manual' && !filtered && pages === 1 && rows.length > 1;
  const published = st.pages.publishedProductPaths();

  const tab = (key, label) => `<a href="${esc(listUrl(f, { status: key }))}"${f.status === key ? ' class="is-on" aria-current="page"' : ''}>` +
    `${label} <span class="st-count">${counts[key]}</span></a>`;
  const tabs = '<nav class="st-subtabs" aria-label="סטטוס">' + tab('all', 'הכול') +
    STATUS_KEYS.map((k) => tab(k, catalog.STATUS_LABELS[k])).join('') + '</nav>';

  const priceCell = (p) => {
    if (p.variants.length) {
      const prices = p.variants.map((v) => (v.price === null || v.price === undefined ? p.price : v.price));
      const lo = Math.min(...prices);
      const hi = Math.max(...prices);
      return lo === hi ? kit.fmt(lo, s.currency) : `${kit.fmt(lo, s.currency)}–${kit.fmt(hi, s.currency)}`;
    }
    // the struck price sits under the price, not beside it: the column stays
    // as narrow as a price, and the name gets the room
    return kit.fmt(p.price, s.currency) +
      (p.compareAt && p.compareAt > p.price ? `<s class="st-pwas">${kit.fmt(p.compareAt, s.currency)}</s>` : '');
  };
  const shelfCell = (p) => {
    if (!p.shelf) return '<span class="faint">—</span>';
    const sh = byShelf.get(p.shelf);
    if (!sh) return `<span class="st-pshelf faint" dir="ltr">${esc(p.shelf)}</span>`;
    const up = sh.parent ? byShelf.get(sh.parent) : null;
    // parent above child, each on a line of its own: a long name is cut with
    // an ellipsis, never wrapped mid-phrase (which made one row taller than the next)
    return (up ? `<span class="st-pshelf-up">${esc(up.label)} ›</span>` : '') +
      `<span class="st-pshelf" title="${esc(sh.label)}">${esc(sh.label)}</span>`;
  };
  const row = (p) => {
    const url = st.pages.productUrl(p.slug, published);
    const name = esc(p.title);
    const edit = `/admin/store/products/${p.id}`;
    const state = stockOf(catalog, p, s.lowStock);
    const stockCell = p.variants.length
      ? `<span class="faint">לפי אפשרות (${p.variants.length})</span>`
      : `<input class="input st-stock" data-stock="${p.id}" inputmode="numeric" dir="ltr" value="${p.stock === null ? '' : p.stock}" placeholder="∞" title="ריק = בלי ספירת מלאי" aria-label="מלאי: ${name}">`;
    return `<tr data-id="${p.id}">
      <td class="st-c-check"><input type="checkbox" data-pick value="${p.id}" aria-label="בחירה: ${name}"></td>
      ${canOrder ? `<td class="st-c-order"><div class="st-order"><span class="st-grip" data-drag title="גררו כדי לסדר" aria-hidden="true">⠿</span>` +
        `<button type="button" class="st-mv" data-move="up" aria-label="מקום אחד למעלה: ${name}">↑</button>` +
        `<button type="button" class="st-mv" data-move="down" aria-label="מקום אחד למטה: ${name}">↓</button></div></td>` : ''}
      <td class="st-c-img"><a href="${edit}" tabindex="-1" aria-hidden="true">${p.images[0]
        ? `<img class="st-thumb" src="${esc(p.images[0])}" alt="" loading="lazy">`
        : '<span class="st-thumb st-thumb-empty">🛍️</span>'}</a></td>
      <td class="st-c-name"><a class="st-pname" href="${edit}">${name}</a>
        <div class="st-psub"><span dir="ltr">${esc(p.slug)}</span>${p.brand ? `<span class="st-pbrand">${esc(p.brand)}</span>` : ''}</div></td>
      <td class="st-c-price">${priceCell(p)}</td>
      <td class="st-c-stock"><div class="st-stockcell">${stockCell}${stockPill(state)}</div></td>
      <td class="st-c-shelf">${shelfCell(p)}</td>
      <td class="st-c-status">${kit.productPill(p.status)}</td>
      <td class="st-c-star"><button type="button" class="st-star" data-star="${p.id}" aria-pressed="${p.featured ? 'true' : 'false'}" aria-label="מוצר מומלץ: ${name}" title="מוצר מומלץ">★</button></td>
      <td class="st-c-acts"><div class="row st-acts"><a class="btn xs secondary" href="${edit}">עריכה</a>` +
        `<a class="btn xs secondary" href="/admin/store/products/new?from=${p.id}">שכפול</a>` +
        `${url ? `<a class="btn xs secondary" href="${esc(url)}" target="_blank" rel="noopener">באתר ↗</a>` : ''}</div></td>
    </tr>`;
  };

  const from = (page - 1) * PAGE_SIZE + 1;
  const result = !list.length ? '' : pages > 1
    ? `מציג ${from}–${from + rows.length - 1} מתוך ${list.length}`
    : countText(list.length);
  const pager = pages > 1 ? '<nav class="st-pager" aria-label="עמודים">' +
    (page > 1 ? `<a class="btn xs secondary" href="${esc(listUrl(f, { page: page - 1 }))}" rel="prev">‹ הקודם</a>` : '') +
    `<span class="st-pager-at">עמוד ${page} מתוך ${pages}</span>` +
    (page < pages ? `<a class="btn xs secondary" href="${esc(listUrl(f, { page: page + 1 }))}" rel="next">הבא ›</a>` : '') + '</nav>' : '';
  let orderNote = '';
  if (canOrder) orderNote = 'זה הסדר שבו המוצרים מופיעים בחנות. גררו את ⠿ או השתמשו בחיצים כדי לשנות אותו.';
  else if (list.length > 1 && f.sort !== 'manual') orderNote = `כדי לסדר ידנית: בחרו במיון "סדר ידני"${filtered ? ' ובטלו סינון וחיפוש' : ''}.`;
  else if (list.length > 1 && filtered) orderNote = 'כדי לסדר ידנית: בטלו סינון וחיפוש.';
  else if (pages > 1) orderNote = `סידור ידני בגרירה זמין כשכל המוצרים בעמוד אחד (עד ${PAGE_SIZE}).`;

  const clear = '<a href="/admin/store/products">ניקוי סינון</a>';
  let table;
  if (list.length) {
    table = `<div class="st-scroll"><table class="tbl st-ptable">
        <thead><tr>
          <th class="st-c-check"><input type="checkbox" id="st-pick-all" aria-label="בחירת כל המוצרים בעמוד"></th>
          ${canOrder ? '<th class="st-c-order"><span class="st-sr">סדר</span></th>' : ''}
          <th class="st-c-img"><span class="st-sr">תמונה</span></th><th class="st-c-name">מוצר</th><th>מחיר</th><th>מלאי</th>
          <th class="st-c-shelf">קטגוריה</th><th>סטטוס</th>
          <th class="st-c-star" title="מוצר מומלץ"><span aria-hidden="true">★</span><span class="st-sr">מומלץ</span></th>
          <th class="st-c-acts"><span class="st-sr">פעולות</span></th>
        </tr></thead>
        <tbody${canOrder ? ' data-sortable' : ''}>${rows.map(row).join('')}</tbody>
      </table></div>
      <div class="st-pfoot"><p class="st-result">${result}${filtered ? ` · ${clear}` : ''}</p>${pager}</div>
      ${orderNote ? `<p class="st-pnote">${orderNote}</p>` : ''}`;
  } else if (filtered) {
    table = `<div class="empty-state"><p class="st-empty-title">אין מוצרים שמתאימים לסינון</p><p class="st-empty-text">${clear}</p></div>`;
  } else {
    table = `<div class="empty-state"><p class="st-empty-title">עוד אין מוצרים בחנות</p>
      <p class="st-empty-text">הוסיפו את המוצר הראשון, ייבאו קובץ CSV, או הדביקו קטלוג שלם ב-BenTML.</p>
      <div class="row st-empty-acts"><a class="btn" href="/admin/store/products/new">+ מוצר ראשון</a>
        <a class="btn secondary" href="/admin/store/bentml#csv">⬆ ייבוא CSV</a>
        <a class="btn secondary" href="/admin/store/bentml">BenTML</a></div></div>`;
  }

  const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
  const body = `
    <div id="st-plist">
    ${tabs}
    <form class="st-pf" id="st-pf" method="GET" action="/admin/store/products" role="search">
      ${f.status !== 'all' ? `<input type="hidden" name="status" value="${f.status}">` : ''}
      ${f.check ? `<input type="hidden" name="check" value="${f.check}">` : ''}
      <label class="st-f st-f-q"><span>חיפוש</span>
        <input class="input" type="search" name="q" value="${esc(f.q)}" maxlength="80" placeholder="שם, מזהה, מותג, תגית או ברקוד"></label>
      <label class="st-f"><span>קטגוריה</span>
        <select class="input" name="shelf">${option('', 'כל הקטגוריות', !f.shelf)}${option(NO_SHELF, 'ללא קטגוריה', f.shelf === NO_SHELF)}${shelfOptions(shelves, f.shelf)}</select></label>
      ${brands.length || f.brand ? `<label class="st-f"><span>מותג</span>
        <select class="input" name="brand">${option('', 'כל המותגים', !f.brand)}${brands.map((b) => option(b.brand, `${b.brand} (${b.count})`, b.brand.toLowerCase() === f.brand.toLowerCase())).join('')}</select></label>` : ''}
      <label class="st-f"><span>מלאי</span>
        <select class="input" name="stock">${STOCKS.map(([k, label]) => option(k, label, k === f.stock)).join('')}</select></label>
      <label class="st-f"><span>מיון</span>
        <select class="input" name="sort">${SORTS.map(([k, label]) => option(k, label, k === f.sort)).join('')}</select></label>
      <button class="btn sm secondary st-pf-go" type="submit">חיפוש</button>
    </form>
    ${f.check ? `<p class="st-pcheck">מוצגים רק מוצרים: <b>${CHECKS[f.check]}</b> · <a href="${esc(listUrl(f, { check: '' }))}">הסרה ✕</a></p>` : ''}
    <div class="st-bulk" id="st-bulk" role="region" aria-label="פעולות על המוצרים שנבחרו" hidden>
      <b class="st-bulk-n" id="st-bulk-n" aria-live="polite"></b>
      <select class="input" data-bulk="status" aria-label="שינוי סטטוס">
        <option value="">שינוי סטטוס…</option>${STATUS_KEYS.map((k) => option(k, catalog.STATUS_LABELS[k], false)).join('')}</select>
      <select class="input" data-bulk="shelf" aria-label="העברה לקטגוריה">
        <option value="">העברה לקטגוריה…</option>${option(NO_SHELF, 'ללא קטגוריה', false)}${shelfOptions(shelves, null)}</select>
      <button type="button" class="btn xs secondary" data-bulk-featured="1">מומלץ ✓</button>
      <button type="button" class="btn xs secondary" data-bulk-featured="0">הסרת מומלץ</button>
      <span class="st-bulk-tag"><input class="input" id="st-bulk-tag" maxlength="30" placeholder="תגית" aria-label="תגית להוספה" list="st-bulk-tags">
        <button type="button" class="btn xs secondary" data-bulk-tag>הוספת תגית</button></span>
      <button type="button" class="btn xs danger" data-bulk-delete>מחיקה</button>
      <button type="button" class="st-link st-bulk-clear" data-bulk-clear>ביטול הבחירה</button>
    </div>
    <datalist id="st-bulk-tags">${catalog.listTags().map((t) => `<option value="${esc(t.tag)}"></option>`).join('')}</datalist>
    <section class="card st-pcard">${table}</section>
    </div>
    <script src="/admin-store.js"></script>
    <script>
    (function () {
      var LOW = ${Number(s.lowStock) || 0};
      var BULK = '/admin/api/store/products/bulk';
      function start(TS) {
        var root = document.getElementById('st-plist');
        if (!root || root.getAttribute('data-wired')) return;
        root.setAttribute('data-wired', '1');
        var say = TS.toast;
        var landed = TS.unstash('list');
        if (landed && landed.text) say(landed.text, landed.tone);
        function site(d, fine) {
          if (d.rebuilt === false) { say('השינוי נשמר, אבל בניית האתר נכשלה — האתר החי עוד לא התעדכן.', 'warn'); return; }
          say(fine, 'ok');
        }

        // filters: a select filters at once; the search field on Enter
        var filters = document.getElementById('st-pf');
        function filter() {
          var parts = [];
          Array.prototype.forEach.call(filters.elements, function (c) {
            if (!c.name || !c.value) return;
            if ((c.name === 'sort' && c.value === 'manual') || (c.name === 'status' && c.value === 'all')) return;
            parts.push(encodeURIComponent(c.name) + '=' + encodeURIComponent(c.value));
          });
          TS.go('/admin/store/products' + (parts.length ? '?' + parts.join('&') : ''));
        }
        filters.addEventListener('submit', function (e) { e.preventDefault(); filter(); });
        Array.prototype.forEach.call(filters.querySelectorAll('select'), function (sel) { sel.addEventListener('change', filter); });

        // stock, edited in the row
        function paintStock(cell, stock) {
          var pill = cell ? cell.querySelector('[data-stock-pill]') : null;
          if (!pill) return;
          var state = stock === null ? 'in' : stock <= 0 ? 'out' : LOW && stock <= LOW ? 'low' : 'in';
          pill.hidden = state === 'in';
          pill.className = 'pill st-stockpill ' + (state === 'out' ? 'danger' : 'warn');
          pill.textContent = state === 'out' ? 'אזל' : state === 'low' ? 'נמוך' : '';
        }
        root.addEventListener('change', function (e) {
          var inp = e.target;
          if (!inp || !inp.hasAttribute || !inp.hasAttribute('data-stock')) return;
          TS.post('/admin/api/store/products/' + inp.getAttribute('data-stock') + '/stock', { stock: inp.value }).then(function (d) {
            if (!d.ok) { inp.setAttribute('aria-invalid', 'true'); say(d.error || 'שגיאה', 'bad'); return; }
            inp.removeAttribute('aria-invalid');
            var stock = d.product.stock === undefined ? null : d.product.stock;
            inp.value = stock === null ? '' : String(stock);
            paintStock(inp.closest('td'), stock);
            site(d, 'המלאי עודכן ✓');
          });
        });

        // the star: one click
        root.addEventListener('click', function (e) {
          var star = e.target.closest ? e.target.closest('[data-star]') : null;
          if (!star || star.disabled) return;
          var want = star.getAttribute('aria-pressed') !== 'true';
          star.disabled = true;
          TS.post(BULK, { ids: [Number(star.getAttribute('data-star'))], action: { featured: want } }).then(function (d) {
            star.disabled = false;
            star.focus();
            if (!d.ok) { say(d.error || 'שגיאה', 'bad'); return; }
            star.setAttribute('aria-pressed', want ? 'true' : 'false');
            site(d, want ? 'סומן כמוצר מומלץ ✓' : 'הסימון כמומלץ הוסר ✓');
          });
        });

        // ticked rows and what can be done to them
        var bulk = document.getElementById('st-bulk');
        var allBox = document.getElementById('st-pick-all');
        function boxes() { return Array.prototype.slice.call(root.querySelectorAll('[data-pick]')); }
        function picked() { return boxes().filter(function (c) { return c.checked; }).map(function (c) { return Number(c.value); }); }
        function syncBulk() {
          var all = boxes();
          var n = picked().length;
          all.forEach(function (c) { var tr = c.closest('tr'); if (tr) tr.classList.toggle('is-picked', c.checked); });
          if (allBox) { allBox.checked = n > 0 && n === all.length; allBox.indeterminate = n > 0 && n < all.length; }
          // the bar sticks just under the admin's own top bar, whatever height that has
          var top = document.querySelector('.topbar');
          bulk.style.top = ((top ? top.offsetHeight : 0) + 8) + 'px';
          document.getElementById('st-bulk-n').textContent = n === 1 ? 'נבחר מוצר אחד' : 'נבחרו ' + n;
          bulk.hidden = n === 0;
        }
        root.addEventListener('change', function (e) {
          if (e.target === allBox) boxes().forEach(function (c) { c.checked = allBox.checked; });
          if (e.target === allBox || (e.target.hasAttribute && e.target.hasAttribute('data-pick'))) syncBulk();
        });
        function count(n) { return n === 1 ? 'מוצר אחד' : n + ' מוצרים'; }
        function run(action) {
          var ids = picked();
          if (!ids.length) return;
          Array.prototype.forEach.call(bulk.querySelectorAll('button, select, input'), function (c) { c.disabled = true; });
          TS.post(BULK, { ids: ids, action: action }).then(function (d) {
            if (!d.ok) {
              Array.prototype.forEach.call(bulk.querySelectorAll('button, select, input'), function (c) { c.disabled = false; });
              Array.prototype.forEach.call(bulk.querySelectorAll('select'), function (c) { c.value = ''; });
              say(d.error || 'שגיאה', 'bad');
              return;
            }
            var text = !d.changed ? 'לא היה מה לשנות — המוצרים שנבחרו כבר במצב הזה.'
              : action.delete ? 'נמחקו ' + count(d.changed) + '. גיבוי של הקטלוג נשמר במסך BenTML.'
              : 'עודכנו ' + count(d.changed) + ' ✓';
            if (d.rebuilt === false) text += ' בניית האתר נכשלה — האתר החי עוד לא התעדכן.';
            // the rows, the tabs' numbers and the filters all change: read the list again
            TS.stash('list', { text: text, tone: d.rebuilt === false ? 'warn' : 'ok' });
            window.location.reload();
          });
        }
        bulk.addEventListener('change', function (e) {
          var kind = e.target.getAttribute ? e.target.getAttribute('data-bulk') : '';
          if (!kind || !e.target.value) return;
          if (kind === 'status') run({ status: e.target.value });
          if (kind === 'shelf') run({ shelf: e.target.value === '${NO_SHELF}' ? '' : e.target.value });
        });
        var tagBox = document.getElementById('st-bulk-tag');
        function addTag() {
          var tag = tagBox.value.trim();
          if (!tag) { tagBox.focus(); return; }
          run({ addTag: tag });
        }
        tagBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
        bulk.addEventListener('click', function (e) {
          var b = e.target.closest ? e.target.closest('button') : null;
          if (!b) return;
          if (b.hasAttribute('data-bulk-featured')) run({ featured: b.getAttribute('data-bulk-featured') === '1' });
          else if (b.hasAttribute('data-bulk-tag')) addTag();
          else if (b.hasAttribute('data-bulk-clear')) { boxes().forEach(function (c) { c.checked = false; }); syncBulk(); }
          else if (b.hasAttribute('data-bulk-delete')) {
            var n = picked().length;
            TS.ask({
              title: 'למחוק ' + count(n) + '?',
              lines: [
                'מחיקה היא לצמיתות. הזמנות קודמות שומרות את הפרטים שלהן.',
                'לפני המחיקה נשמר גיבוי של הקטלוג (במסך BenTML, תחת "גיבויים"). שחזור ממנו מחזיר את המוצרים, עם מחיר העלות שלהם.',
                'שימו לב: שחזור מחזיר את כל הקטלוג לרגע הגיבוי — מוצרים שנוספו מאז יוסתרו, והמלאי יחזור למה שהיה.',
                'הסתרה היא הבחירה ההפיכה: המוצרים יורדים מהחנות, והכול נשמר.'
              ],
              actions: [
                { label: 'הסתרה במקום', value: 'hide' },
                { label: 'מחיקה לצמיתות', value: 'delete', kind: 'danger' },
                { label: 'ביטול', value: '', kind: 'secondary' }
              ]
            }).then(function (choice) {
              if (choice === 'hide') run({ status: 'hidden' });
              else if (choice === 'delete') run({ delete: true });
            });
          }
        });
        if (allBox) syncBulk();

        // the order of the shop, set by hand
        var tbody = root.querySelector('tbody[data-sortable]');
        if (tbody) {
          var timer = null;
          TS.sortable(tbody, function (ids) {
            say('שומרים את הסדר…');
            if (timer) clearTimeout(timer);
            // several steps in a row are one save (each save rebuilds the site)
            timer = setTimeout(function () {
              TS.post('/admin/api/store/products/reorder', { ids: ids.map(Number) }).then(function (d) {
                if (!d.ok) { say(d.error || 'הסדר לא נשמר', 'bad'); return; }
                site(d, 'הסדר נשמר ✓');
              });
            }, 600);
          });
        }
      }
      if (window.TapuzStore) start(window.TapuzStore);
      else (window.TapuzStoreReady = window.TapuzStoreReady || []).push(start);
    })();
    </script>`;
  res.send(kit.screen({
    // ten columns need more room than a form does
    key: 'store-products', title: 'מוצרים', body, width: 1240,
    actions: '<a class="btn" href="/admin/store/products/new">+ מוצר חדש</a>' +
      '<a class="btn secondary" href="/admin/store/products.csv" data-nav-full download>⬇ CSV</a>' +
      '<a class="btn secondary" href="/admin/store/bentml#csv">⬆ ייבוא CSV</a>'
  }));
});

// The whole catalog as a spreadsheet (src/store/csv-io.js writes it; the
// BenTML screen reads one back). `cost` is in it: this is the owner's file.
router.get('/admin/store/products.csv', requireAdmin, (req, res) => {
  try {
    const csv = require('../store/csv-io').exportCsv();
    res.setHeader('Content-Disposition', 'attachment; filename="products-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.type('text/csv; charset=utf-8').send(csv);
  } catch (e) {
    res.status(500).type('text/plain; charset=utf-8').send(e && e.message ? e.message : String(e));
  }
});

// ── the editor ─────────────────────────────────────────────────────────

const STATUS_HELP = {
  active: 'מוצג בחנות ואפשר להזמין.',
  hidden: 'לא מוצג בחנות. הדף והנתונים נשמרים.',
  draft: 'עוד בעבודה — לא מוצג בחנות.'
};
// The catalog keeps these two limits to itself (catalog.js MAX_IMAGES,
// MAX_VARIANTS); the screen has to say them out loud before the server does.
const MAX_IMAGES = 12;
const MAX_VARIANTS = 50;

const BLANK = {
  id: 0, slug: '', title: '', summary: '', description: '', price: null, compareAt: null, cost: null, stock: null,
  images: [], shelf: '', badge: '', status: 'active', delivery: true, maxPerOrder: null, variants: [],
  brand: '', tags: [], featured: false, barcode: '', weight: null, seoTitle: '', seoDescription: ''
};

/**
 * The product's page on the site: its address while it is live, and the
 * builder's address when the page is the store's own (a page the owner made
 * at the same address is theirs — the store never points at it as "the
 * product page").
 */
function pageLinks(st, slug) {
  const sitePages = require('../pages');
  const path = st.pages.productPath(slug);
  const page = sitePages.getPageByFullPath(path);
  const ours = !!(page && page.meta && page.meta.store === 'product' && page.meta.storeSku === slug);
  return {
    url: st.pages.productUrl(slug),
    builder: ours ? '/admin/edit/' + encodeURIComponent(path) : ''
  };
}

/**
 * One editor for a new product, an existing one, and a copy.
 * @param {object|null} product  the product being edited (null = a new one)
 * @param {object|null} source   for a new one: the product it is copied from
 */
function editor(req, res, product, source) {
  const st = store();
  const s = st.settings.loadSettings();
  const money = st.money;
  const catalog = st.catalog;
  const isNew = !product;
  // "שכפול" opens the form filled from another product, with no SKU and no
  // star of its own. Nothing is written until "שמירה".
  const p = product || (source
    ? { ...source, id: 0, slug: '', title: source.title.slice(0, 113) + ' (עותק)', featured: false }
    : BLANK);
  const major = (n) => (n === null || n === undefined ? '' : money.fromMinor(n));
  // the store's own currency — a shop that sells in dollars is not asked for a price in ₪
  const sym = (money.CURRENCIES[money.currencyCode(s.currency)] || {}).symbol || '';
  const shelves = catalog.listShelves();
  const links = isNew ? { url: '', builder: '' } : pageLinks(st, p.slug);
  const counted = p.stock !== null && p.stock !== undefined;
  const hasVars = p.variants.length > 0;
  const config = require('../config').loadConfig();
  // how the site writes a product page's address, around the SKU
  const mark = 'qq7sku7qq';
  const [pathBefore, pathAfter = ''] = require('../pages').publicUrlFor(st.pages.productPath(mark)).split(mark);

  // One field = its label (and counter) on a line, the control, then the help
  // and the error line. Every field on the screen is built here, so every
  // label is the same label and every control sits on the same line.
  const head = (id, label, o = {}) => `<div class="st-label"><label for="${id}">${label}${o.required ? ' <span class="st-req" aria-hidden="true">*</span>' : ''}</label>` +
    `${o.counter ? '<span class="st-counter" data-counter></span>' : ''}</div>`;
  const foot = (id, help) => `${help ? `<p class="st-hint" id="${id}-help">${help}</p>` : ''}<p class="st-err st-bad" id="${id}-err" data-err hidden></p>`;
  const described = (id, help) => `aria-describedby="${help ? id + '-help ' : ''}${id}-err"`;
  const text = (name, label, value, o = {}) => {
    const id = 'pe-' + name;
    return `<div class="st-field"${o.wrap || ''}>${head(id, label, o)}
      <input class="input" id="${id}" name="${name}" value="${esc(value)}" ${o.attrs || ''} ${described(id, o.help)}>${foot(id, o.help)}</div>`;
  };
  const moneyField = (name, label, value, o = {}) => {
    const id = 'pe-' + name;
    return `<div class="st-field">${head(id, label, o)}
      <div class="st-money" dir="ltr"><span class="st-money-sym" aria-hidden="true">${esc(sym)}</span>` +
      `<input class="input" id="${id}" name="${name}" value="${esc(major(value))}" inputmode="decimal" ${o.attrs || ''} ${described(id, o.help)}></div>${foot(id, o.help)}</div>`;
  };
  const varRow = (v) => `<div class="st-var" data-var>
      <span class="st-order"><button type="button" class="st-mv" data-move="up" aria-label="האפשרות: מקום אחד למעלה">↑</button>` +
      `<button type="button" class="st-mv" data-move="down" aria-label="האפשרות: מקום אחד למטה">↓</button></span>
      <input class="input" data-k="label" maxlength="60" placeholder="למשל: M / אדום" aria-label="שם האפשרות" value="${esc(v.label)}">
      <input class="input" data-k="code" dir="ltr" maxlength="40" spellcheck="false" placeholder="ייווצר מהשם" aria-label="מזהה האפשרות" value="${esc(v.code)}">
      <span class="st-money" dir="ltr"><span class="st-money-sym" aria-hidden="true">${esc(sym)}</span>` +
      `<input class="input" data-k="price" inputmode="decimal" placeholder="כמו המוצר" aria-label="מחיר האפשרות" value="${esc(major(v.price))}"></span>
      <input class="input" data-k="stock" dir="ltr" inputmode="numeric" placeholder="∞" aria-label="מלאי האפשרות" value="${v.stock === null || v.stock === undefined ? '' : v.stock}">
      <button type="button" class="st-x" data-remove aria-label="הסרת האפשרות" title="הסרה">✕</button></div>`;
  // a product that names a category nobody listed still shows where it is
  const ghost = p.shelf && !shelves.some((x) => x.slug === p.shelf)
    ? `<option value="${esc(p.shelf)}" selected>${esc(p.shelf)}</option>` : '';

  const boot = {
    id: p.id || 0,
    sku: isNew ? '' : p.slug,
    sym,
    images: p.images,
    tags: p.tags,
    maxImages: MAX_IMAGES,
    maxTags: catalog.MAX_TAGS || 12,
    maxVariants: MAX_VARIANTS,
    statusHelp: STATUS_HELP,
    seo: {
      before: pathBefore,
      after: pathAfter,
      pattern: (config.seo && config.seo.titlePattern) || '',
      site: config.title || '',
      description: config.description || ''
    }
  };

  const body = `
    <form id="pe-form" class="st-ed" novalidate autocomplete="off">
      ${source ? `<p class="notice slim info st-ed-note">עותק של "${esc(source.title)}" — עוד לא נשמר. תנו לו שם ומזהה משלו ולחצו "שמירה".</p>` : ''}
      <div class="st-ed-main">
        <section class="card" aria-labelledby="pe-h-details">
          <h3 class="sub-head" id="pe-h-details">פרטים</h3>
          <div class="st-rows">
            ${text('title', 'שם המוצר', p.title, { required: true, attrs: 'maxlength="120" required' })}
            ${text('summary', 'שורת תקציר', p.summary, { attrs: 'maxlength="200"', counter: true })}
            <div class="st-field">${head('pe-description', 'תיאור', { counter: true })}
              <textarea class="input" id="pe-description" name="description" rows="8" maxlength="8000" ${described('pe-description', true)}>${esc(p.description)}</textarea>
              ${foot('pe-description', 'שורה ריקה פותחת פסקה חדשה.')}</div>
          </div>
        </section>

        <section class="card st-gal" id="pe-gallery" aria-labelledby="pe-h-images">
          <div class="st-card-head"><h3 class="sub-head" id="pe-h-images">תמונות</h3><span class="st-counter" data-g-count></span></div>
          <div class="st-gal-list" data-g-list></div>
          <p class="st-gal-empty">עוד אין תמונות. התמונה הראשונה היא זו שמופיעה ברשת המוצרים.</p>
          <div class="st-gal-add">
            <button type="button" class="btn sm secondary" data-g-pick>מהספרייה</button>
            <button type="button" class="btn sm secondary" data-g-upload>העלאה</button>
            <input type="file" accept="image/*" multiple hidden tabindex="-1" data-g-file data-no-dirty>
            <span class="st-gal-url"><input class="input" dir="ltr" inputmode="url" spellcheck="false" placeholder="https://…" aria-label="כתובת של תמונה" data-g-url data-no-dirty>
              <button type="button" class="btn sm secondary" data-g-url-add>הוספה בכתובת</button></span>
          </div>
          <p class="st-hint">תמונה ריבועית (1:1) נראית הכי טוב ברשת המוצרים. הראשונה היא הראשית — גררו תמונה כדי לשנות את הסדר.</p>
          <p class="st-hint st-warn" data-g-full hidden>הגעתם ל-${MAX_IMAGES} תמונות — כדי להוסיף עוד, הסירו אחת.</p>
          <div class="st-gal-status" data-g-status aria-live="polite"></div>
        </section>

        <section class="card" aria-labelledby="pe-h-price">
          <h3 class="sub-head" id="pe-h-price">מחיר</h3>
          <div class="st-row3">
            ${moneyField('price', 'מחיר', p.price, { required: true, attrs: 'placeholder="89.90"' })}
            ${moneyField('compareAt', 'מחיר לפני', p.compareAt, { help: 'מוצג כמחיר מחוק. במוצר עם אפשרויות אינו מוצג.' })}
            ${moneyField('cost', 'מחיר עלות', p.cost, { help: 'לעיניכם בלבד — לא מופיע באתר, לא במסמך BenTML ולא בחבילת האתר.' })}
          </div>
          <p class="st-profit" id="pe-profit" aria-live="polite" hidden></p>
        </section>

        <section class="card" aria-labelledby="pe-h-stock">
          <h3 class="sub-head" id="pe-h-stock">מלאי</h3>
          <div class="st-rows">
            <div class="st-row2">
              ${isNew
                ? text('slug', 'מזהה (SKU)', '', { attrs: 'dir="ltr" maxlength="80" spellcheck="false" autocapitalize="off" placeholder="ייווצר מהשם"', help: 'גם כתובת דף המוצר. אחרי השמירה הוא לא משתנה.' })
                : `<div class="st-field"><div class="st-label"><label for="pe-slug">מזהה (SKU)</label></div>
                  <input class="input" id="pe-slug" value="${esc(p.slug)}" dir="ltr" readonly aria-describedby="pe-slug-help">
                  <p class="st-hint" id="pe-slug-help">המזהה הוא הזהות של המוצר וכתובת הדף שלו — הוא לא משתנה.</p></div>`}
              ${text('barcode', 'ברקוד', p.barcode, { attrs: 'dir="ltr" maxlength="40" spellcheck="false"' })}
            </div>
            <p class="st-hint st-stock-vars" id="pe-stock-vars"${hasVars ? '' : ' hidden'}>למוצר עם אפשרויות המלאי נספר לכל אפשרות בנפרד.</p>
            <label class="st-check" id="pe-track-row"${hasVars ? ' hidden' : ''}><input type="checkbox" name="trackStock"${counted ? ' checked' : ''}> ספירת מלאי</label>
            <div class="st-row2">
              ${text('stock', 'כמות במלאי', counted ? p.stock : '', { attrs: 'dir="ltr" inputmode="numeric"', wrap: ` id="pe-stock-field"${hasVars || !counted ? ' hidden' : ''}` })}
              ${text('maxPerOrder', 'עד כמה יחידות בהזמנה', p.maxPerOrder || '', { attrs: 'dir="ltr" inputmode="numeric"', help: 'ריק = בלי הגבלה.' })}
            </div>
          </div>
        </section>

        <section class="card" aria-labelledby="pe-h-vars">
          <h3 class="sub-head" id="pe-h-vars">אפשרויות (מידה, צבע…)</h3>
          <p class="st-hint">מוצר עם אפשרויות סופר מלאי לכל אפשרות בנפרד, ולכל אחת יכול להיות מחיר משלה. עד ${MAX_VARIANTS} אפשרויות.</p>
          <div class="st-vars">
            <div class="st-var st-var-head" id="pe-vars-head" aria-hidden="true"${hasVars ? '' : ' hidden'}><span></span><span>שם</span><span>מזהה</span><span>מחיר</span><span>מלאי</span><span></span></div>
            <div id="pe-vars">${p.variants.map(varRow).join('')}</div>
          </div>
          <div class="st-vars-add"><button type="button" class="btn sm secondary" id="pe-add-var">+ אפשרות</button><span class="st-hint" id="pe-vars-out" aria-live="polite"></span></div>
          <div class="st-gen">
            <h4 class="st-gen-title">יצירת שילובים</h4>
            <p class="st-hint">כתבו ערכים מופרדים בפסיקים — כל שילוב יהפוך לאפשרות. אפשרויות שכבר קיימות נשארות כמו שהן, עם המחיר והמלאי שלהן.</p>
            <div class="st-gen-row"><input class="input" maxlength="30" placeholder="שם האפשרות — מידה" aria-label="שם האפשרות הראשונה" data-gen-name data-no-dirty>
              <input class="input" placeholder="S, M, L" aria-label="ערכי האפשרות הראשונה, מופרדים בפסיקים" data-gen-values data-no-dirty></div>
            <div class="st-gen-row"><input class="input" maxlength="30" placeholder="שם האפשרות — צבע" aria-label="שם האפשרות השנייה" data-gen-name data-no-dirty>
              <input class="input" placeholder="אדום, כחול" aria-label="ערכי האפשרות השנייה, מופרדים בפסיקים" data-gen-values data-no-dirty></div>
            <div class="st-vars-add"><button type="button" class="btn sm secondary" id="pe-gen">יצירת שילובים</button><span class="st-hint" id="pe-gen-out" aria-live="polite"></span></div>
          </div>
        </section>

        <section class="card" aria-labelledby="pe-h-ship">
          <h3 class="sub-head" id="pe-h-ship">משלוח</h3>
          <div class="st-row2">
            <label class="st-check st-check-inrow"><input type="checkbox" name="delivery"${p.delivery ? ' checked' : ''}> צריך משלוח (מוצר פיזי)</label>
            ${text('weight', 'משקל (גרם)', p.weight === null || p.weight === undefined ? '' : p.weight, { attrs: 'dir="ltr" inputmode="numeric"' })}
          </div>
        </section>

        <section class="card" aria-labelledby="pe-h-seo">
          <h3 class="sub-head" id="pe-h-seo">תצוגה בגוגל (SEO)</h3>
          <div class="st-rows">
            ${text('seoTitle', 'כותרת', p.seoTitle, { attrs: 'maxlength="70"', counter: true, help: 'ריק = שם המוצר.' })}
            <div class="st-field">${head('pe-seoDescription', 'תיאור', { counter: true })}
              <textarea class="input" id="pe-seoDescription" name="seoDescription" rows="2" maxlength="160" ${described('pe-seoDescription', true)}>${esc(p.seoDescription)}</textarea>
              ${foot('pe-seoDescription', 'ריק = שורת התקציר.')}</div>
            <div class="st-serp" role="group" aria-label="כך המוצר ייראה בתוצאות החיפוש">
              <div class="st-serp-path" id="pe-serp-path" dir="ltr"></div>
              <div class="st-serp-title" id="pe-serp-title"></div>
              <div class="st-serp-desc" id="pe-serp-desc"></div>
            </div>
          </div>
        </section>
      </div>

      <div class="st-ed-side">
        <section class="card" aria-labelledby="pe-h-status">
          <h3 class="sub-head" id="pe-h-status">סטטוס</h3>
          <div class="st-rows">
            <div class="st-field">
              <select class="input" id="pe-status" name="status" aria-labelledby="pe-h-status" aria-describedby="pe-status-help">${STATUS_KEYS.map((x) => `<option value="${x}"${x === p.status ? ' selected' : ''}>${catalog.STATUS_LABELS[x]}</option>`).join('')}</select>
              <p class="st-hint" id="pe-status-help" aria-live="polite">${STATUS_HELP[p.status] || ''}</p>
            </div>
            <div class="st-field">
              <label class="st-check"><input type="checkbox" name="featured" aria-describedby="pe-featured-help"${p.featured ? ' checked' : ''}> מוצר מומלץ</label>
              <p class="st-hint st-check-hint" id="pe-featured-help">אפשר להציג מוצרים מומלצים ברשת משלהם.</p>
            </div>
            ${isNew ? '' : `<div class="st-links">
              <a id="pe-view" href="${esc(links.url || '#')}" target="_blank" rel="noopener"${links.url ? '' : ' hidden'}>צפייה בדף המוצר ↗</a>
              <a id="pe-design" href="${esc(links.builder || '#')}"${links.builder ? '' : ' hidden'}>עיצוב דף המוצר בבונה</a>
            </div>`}
          </div>
        </section>

        <section class="card" aria-labelledby="pe-h-org">
          <h3 class="sub-head" id="pe-h-org">ארגון</h3>
          <div class="st-rows">
            <div class="st-field">${head('pe-shelf', 'קטגוריה')}
              <select class="input" id="pe-shelf" name="shelf"><option value="">ללא קטגוריה</option>${shelfOptions(shelves, p.shelf)}${ghost}</select>
              <button type="button" class="st-link" id="pe-newcat-open" aria-expanded="false" aria-controls="pe-newcat">+ קטגוריה חדשה</button>
              <div class="st-newcat" id="pe-newcat" hidden>
                <div class="st-field"><div class="st-label"><label for="pe-newcat-name">שם הקטגוריה</label></div>
                  <input class="input" id="pe-newcat-name" maxlength="60" data-no-dirty></div>
                <div class="st-field"><div class="st-label"><label for="pe-newcat-parent">בתוך קטגוריה (לא חובה)</label></div>
                  <select class="input" id="pe-newcat-parent" data-no-dirty><option value="">קטגוריה ראשית</option>${shelves.filter((x) => !x.depth).map((x) => `<option value="${esc(x.slug)}">${esc(x.label)}</option>`).join('')}</select></div>
                <div class="st-newcat-acts"><button type="button" class="btn sm" id="pe-newcat-save">הוספה</button><button type="button" class="btn sm secondary" id="pe-newcat-cancel">ביטול</button></div>
                <p class="st-err st-bad" id="pe-newcat-err" aria-live="polite" hidden></p>
              </div>
            </div>
            <div class="st-field">${head('pe-brand', 'מותג')}
              <input class="input" id="pe-brand" name="brand" value="${esc(p.brand)}" maxlength="60" list="pe-brands">
              <datalist id="pe-brands">${catalog.listBrands().map((b) => `<option value="${esc(b.brand)}"></option>`).join('')}</datalist></div>
            <div class="st-field"><div class="st-label"><label for="pe-tags-input">תגיות</label><span class="st-counter" id="pe-tags-count"></span></div>
              <div class="st-chips" id="pe-tags"><span class="st-chips-list" data-chips-list></span>
                <input class="st-chips-input" id="pe-tags-input" list="pe-tags-all" placeholder="הקלידו ולחצו Enter" aria-describedby="pe-tags-help pe-tags-out" data-chips-input data-no-dirty></div>
              <datalist id="pe-tags-all">${catalog.listTags().map((t) => `<option value="${esc(t.tag)}"></option>`).join('')}</datalist>
              <p class="st-hint" id="pe-tags-help">Enter או פסיק מוסיפים תגית. עד ${boot.maxTags} תגיות, עד 30 תווים בכל אחת.</p>
              <p class="st-hint st-warn" id="pe-tags-out" aria-live="polite"></p></div>
            ${text('badge', 'תווית על הכרטיס', p.badge, { attrs: 'maxlength="24" placeholder="מבצע / חדש"', counter: true })}
          </div>
        </section>

        <section class="card st-pv" aria-labelledby="pe-h-pv">
          <h3 class="sub-head" id="pe-h-pv">תצוגה מקדימה</h3>
          ${isNew
            ? '<p class="st-hint">התצוגה המקדימה תופיע אחרי השמירה הראשונה.</p>'
            : `<iframe class="st-pv-frame" id="pe-preview" src="/admin/store/products/${p.id}/preview" title="המוצר כפי שהוא נראה באתר" loading="lazy"></iframe>
          <p class="st-hint">הכרטיס ברשת המוצרים ודף המוצר, בעיצוב של האתר. מתעדכן אחרי כל שמירה.</p>`}
        </section>
      </div>

      <div class="st-savebar st-ed-bar">
        <div class="st-msgs" id="pe-msgs"></div>
        <div class="st-bar-row">
          <span class="st-bar-side">${isNew
            ? '<a class="btn sm secondary" href="/admin/store/products">ביטול</a>'
            : `<a class="btn sm secondary" id="pe-dup" href="/admin/store/products/new?from=${p.id}">שכפול</a>
            <button type="button" class="btn sm danger" id="pe-del">מחיקה</button>`}</span>
          <span class="st-bar-side"><span class="st-out" id="pe-out" role="status" aria-live="polite"></span><button type="button" class="btn" id="pe-save">שמירה</button></span>
        </div>
      </div>
    </form>
    <template id="pe-var-tpl">${varRow({ label: '', code: '', price: null, stock: null })}</template>
    <script src="/admin-media-picker.js"></script>
    <script src="/admin-store.js"></script>
    <script>
    (function () {
      var BOOT = ${jsonForScript(boot)};
      function start(TS) {
        var form = document.getElementById('pe-form');
        if (!form || form.getAttribute('data-wired')) return;
        form.setAttribute('data-wired', '1');
        function byId(id) { return document.getElementById(id); }
        function f(name) { return form.querySelector('[name="' + name + '"]'); }
        var out = byId('pe-out');
        var msgs = byId('pe-msgs');
        var saveBtn = byId('pe-save');
        var guard = TS.dirty(form);
        function say(text, tone) {
          out.textContent = text || '';
          out.className = 'st-out' + (tone ? ' st-' + tone : '');
        }

        var counters = ['summary', 'description', 'seoTitle', 'seoDescription', 'badge'].map(function (n) { return TS.counter(f(n)); });

        // pictures and tags
        var gallery = TS.gallery(byId('pe-gallery'), { images: BOOT.images, max: BOOT.maxImages, onChange: guard.touch });
        var tagsOut = byId('pe-tags-out');
        function countTags(list) { byId('pe-tags-count').textContent = list.length + '/' + BOOT.maxTags; }
        var tags = TS.chips(byId('pe-tags'), {
          values: BOOT.tags, max: BOOT.maxTags, maxLen: 30,
          say: function (t) { tagsOut.textContent = t || ''; },
          onChange: function (list) { countTags(list); guard.touch(); }
        });
        countTags(tags.get());

        // a field that is wrong says so under itself, and stops saying so when it is touched
        function errOf(input) {
          var field = input.closest('.st-field');
          return field ? field.querySelector('[data-err]') : null;
        }
        function mark(input, text) {
          input.setAttribute('aria-invalid', 'true');
          var err = errOf(input);
          if (err) { err.textContent = text; err.hidden = false; }
        }
        function unmark(input) {
          input.removeAttribute('aria-invalid');
          var err = errOf(input);
          if (err) { err.textContent = ''; err.hidden = true; }
        }
        form.addEventListener('input', function (e) {
          if (e.target.getAttribute && e.target.getAttribute('aria-invalid')) unmark(e.target);
        });

        // stock: counted on the product, or — with options — on each option
        var track = f('trackStock');
        var varsEl = byId('pe-vars');
        var varsOut = byId('pe-vars-out');
        function rows() { return Array.prototype.slice.call(varsEl.querySelectorAll('[data-var]')); }
        function varsSay(text, tone) {
          varsOut.textContent = text || '';
          varsOut.className = 'st-hint' + (tone ? ' st-' + tone : '');
        }
        function syncStock() {
          var hasVars = rows().length > 0;
          byId('pe-track-row').hidden = hasVars;
          byId('pe-stock-field').hidden = hasVars || !track.checked;
          byId('pe-stock-vars').hidden = !hasVars;
          byId('pe-vars-head').hidden = !hasVars;
        }
        track.addEventListener('change', function () {
          syncStock();
          if (track.checked) f('stock').focus();
        });

        // options
        function readRow(row) {
          var v = {};
          Array.prototype.forEach.call(row.querySelectorAll('[data-k]'), function (i) { v[i.getAttribute('data-k')] = i.value; });
          return v;
        }
        function addRow(v) {
          var node = byId('pe-var-tpl').content.cloneNode(true);
          var row = node.querySelector('[data-var]');
          if (v) {
            Array.prototype.forEach.call(row.querySelectorAll('[data-k]'), function (i) {
              var val = v[i.getAttribute('data-k')];
              i.value = val === undefined || val === null ? '' : String(val);
            });
          }
          varsEl.appendChild(node);
          return row;
        }
        byId('pe-add-var').addEventListener('click', function () {
          if (rows().length >= BOOT.maxVariants) { varsSay('אפשר עד ' + BOOT.maxVariants + ' אפשרויות למוצר.', 'warn'); return; }
          var row = addRow(null);
          syncStock();
          guard.touch();
          varsSay('');
          row.querySelector('[data-k="label"]').focus();
        });
        varsEl.addEventListener('click', function (e) {
          var x = e.target.closest ? e.target.closest('[data-remove]') : null;
          var row = x ? x.closest('[data-var]') : null;
          if (!row) return;
          row.parentNode.removeChild(row);
          syncStock();
          guard.touch();
          varsSay('');
        });
        TS.sortable(varsEl, guard.touch, { item: '[data-var]' });

        // every combination of two lists of values, as rows
        var genOut = byId('pe-gen-out');
        function genSay(text, tone) {
          genOut.textContent = text || '';
          genOut.className = 'st-hint' + (tone ? ' st-' + tone : '');
        }
        function valuesOf(input) {
          var seen = {};
          return input.value.split(',').map(function (v) { return v.trim(); }).filter(function (v) {
            var key = v.toLowerCase();
            if (!v || seen[key]) return false;
            seen[key] = true;
            return true;
          });
        }
        byId('pe-gen').addEventListener('click', function () {
          var groups = Array.prototype.map.call(form.querySelectorAll('[data-gen-values]'), valuesOf).filter(function (g) { return g.length; });
          if (!groups.length) { genSay('כתבו ערכים מופרדים בפסיקים, למשל: S, M, L', 'warn'); return; }
          var combos = groups.reduce(function (so, group) {
            var next = [];
            so.forEach(function (a) { group.forEach(function (b) { next.push(a ? a + ' / ' + b : b); }); });
            return next;
          }, ['']);
          var have = {};
          rows().forEach(function (row) {
            var v = readRow(row);
            var code = (v.code.trim() || TS.slug(v.label)).toLowerCase();
            if (code) have[code] = true;
          });
          var added = 0;
          var kept = 0;
          var full = false;
          combos.forEach(function (label) {
            var name = label.slice(0, 60);
            var code = TS.slug(name).slice(0, 40);
            if (!code) return;
            if (have[code]) { kept++; return; }
            if (rows().length >= BOOT.maxVariants) { full = true; return; }
            addRow({ label: name, code: code });
            have[code] = true;
            added++;
          });
          syncStock();
          if (added) guard.touch();
          var text = added ? 'נוספו ' + added + ' אפשרויות' : 'לא נוספו אפשרויות';
          if (kept) text += ' · ' + kept + ' כבר היו ונשארו כמו שהן';
          if (full) text += ' · עצרנו ב-' + BOOT.maxVariants + ', זה המקסימום למוצר';
          genSay(text + '.', full ? 'warn' : added ? 'ok' : '');
        });

        // the lines that follow what is typed
        function paintStatus() { byId('pe-status-help').textContent = BOOT.statusHelp[f('status').value] || ''; }
        f('status').addEventListener('change', paintStatus);
        function paintProfit() {
          var line = byId('pe-profit');
          var price = TS.money(f('price').value);
          var cost = TS.money(f('cost').value);
          if (isNaN(price) || isNaN(cost)) { line.hidden = true; return; }
          var gain = price - cost;
          line.hidden = false;
          line.className = 'st-profit' + (gain < 0 ? ' st-bad' : '');
          line.textContent = (gain < 0 ? 'הפסד: ' : 'רווח: ') + TS.formatMoney(Math.abs(gain), BOOT.sym) +
            (price > 0 ? ' · ' + Math.round(Math.abs(gain) / price * 100) + '%' : '');
        }
        var slugBox = f('slug');
        function paintSerp() {
          var name = f('title').value.trim();
          var title = f('seoTitle').value.trim() || name || 'שם המוצר';
          if (BOOT.seo.pattern && BOOT.seo.pattern.indexOf('{page}') !== -1) {
            title = BOOT.seo.pattern.split('{page}').join(title).split('{site}').join(BOOT.seo.site);
          }
          var auto = TS.slug(name);
          var sku = BOOT.sku || (slugBox && slugBox.value.trim() ? TS.slug(slugBox.value) : auto) || 'product';
          if (slugBox) slugBox.placeholder = auto || 'ייווצר מהשם';
          byId('pe-serp-title').textContent = title;
          byId('pe-serp-desc').textContent = f('seoDescription').value.trim() || f('summary').value.trim() ||
            BOOT.seo.description || 'התיאור שיופיע מתחת לכותרת בתוצאות החיפוש.';
          byId('pe-serp-path').textContent = BOOT.seo.before + sku + BOOT.seo.after;
        }
        form.addEventListener('input', function (e) {
          var n = e.target.name;
          if (n === 'price' || n === 'cost') paintProfit();
          if (n === 'title' || n === 'summary' || n === 'seoTitle' || n === 'seoDescription' || n === 'slug') paintSerp();
        });

        // a new category, without leaving the product
        var shelfBox = f('shelf');
        var catBox = byId('pe-newcat');
        var catOpen = byId('pe-newcat-open');
        var catName = byId('pe-newcat-name');
        var catParent = byId('pe-newcat-parent');
        var catErr = byId('pe-newcat-err');
        function catShow(on) {
          catBox.hidden = !on;
          catOpen.hidden = on;
          catOpen.setAttribute('aria-expanded', on ? 'true' : 'false');
          catErr.hidden = true;
          if (on) { catName.value = ''; catParent.value = ''; catName.focus(); } else catOpen.focus();
        }
        function pickShelf(slug, label, parent) {
          var has = Array.prototype.some.call(shelfBox.options, function (o) { return o.value === slug; });
          if (slug && !has) {
            var opt = document.createElement('option');
            opt.value = slug;
            opt.textContent = (parent ? '— ' : '') + (label || slug);
            opt.setAttribute('data-depth', parent ? '1' : '0');
            var after = null;
            if (parent) {
              // a child goes under its parent, after the children already there
              var list = Array.prototype.slice.call(shelfBox.options);
              var at = list.map(function (o) { return o.value; }).indexOf(parent);
              if (at !== -1) {
                var j = at + 1;
                while (j < list.length && list[j].getAttribute('data-depth') === '1') j++;
                after = list[j] || null;
              }
            }
            shelfBox.insertBefore(opt, after);
          }
          shelfBox.value = slug || '';
        }
        function catSave() {
          var label = catName.value.trim();
          if (!label) { catErr.textContent = 'כתבו שם לקטגוריה'; catErr.hidden = false; catName.focus(); return; }
          byId('pe-newcat-save').disabled = true;
          TS.post('/admin/api/store/shelves', { label: label, parent: catParent.value }).then(function (d) {
            byId('pe-newcat-save').disabled = false;
            if (!d.ok) { catErr.textContent = d.error || 'שגיאה'; catErr.hidden = false; return; }
            pickShelf(d.shelf.slug, d.shelf.label, d.shelf.parent);
            // a name that was taken: nothing was created or changed — the one that is there was picked
            if (d.existed) TS.toast('הקטגוריה כבר קיימת — היא נבחרה', 'ok');
            var listed = Array.prototype.some.call(catParent.options, function (o) { return o.value === d.shelf.slug; });
            if (!d.shelf.parent && !listed) {
              var top = document.createElement('option');
              top.value = d.shelf.slug;
              top.textContent = d.shelf.label;
              catParent.appendChild(top);
            }
            guard.touch();
            catShow(false);
            shelfBox.focus();
          });
        }
        catOpen.addEventListener('click', function () { catShow(true); });
        byId('pe-newcat-cancel').addEventListener('click', function () { catShow(false); });
        byId('pe-newcat-save').addEventListener('click', catSave);
        catName.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); catSave(); }
          if (e.key === 'Escape') catShow(false);
        });

        // what is checked here before the server is asked
        function validate() {
          var bad = [];
          function need(input, ok, text) {
            if (ok) { unmark(input); return; }
            mark(input, text);
            bad.push(input);
          }
          function wholeOrEmpty(input, text) {
            var n = TS.whole(input.value);
            need(input, n === null || !isNaN(n), text);
          }
          function moneyOrEmpty(input, text) {
            need(input, input.value.trim() === '' || !isNaN(TS.money(input.value)), text);
          }
          need(f('title'), f('title').value.trim() !== '', 'חסר שם למוצר.');
          need(f('price'), !isNaN(TS.money(f('price').value)), f('price').value.trim() === '' ? 'חסר מחיר (אפשר גם 0).' : 'המחיר צריך להיות מספר, למשל 89.90.');
          moneyOrEmpty(f('compareAt'), 'מחיר לפני צריך להיות מספר, למשל 119.');
          moneyOrEmpty(f('cost'), 'מחיר העלות צריך להיות מספר, למשל 55.');
          var list = rows();
          if (!list.length && track.checked) {
            var stock = TS.whole(f('stock').value);
            need(f('stock'), stock !== null && !isNaN(stock), stock === null
              ? 'סימנתם ספירת מלאי — כתבו כמה יש במלאי, או בטלו את הסימון.'
              : 'כמות המלאי צריכה להיות מספר שלם.');
          }
          wholeOrEmpty(f('maxPerOrder'), 'כמות להזמנה צריכה להיות מספר שלם.');
          wholeOrEmpty(f('weight'), 'המשקל צריך להיות מספר שלם של גרמים.');
          var rowsBad = '';
          list.forEach(function (row) {
            var label = row.querySelector('[data-k="label"]');
            var price = row.querySelector('[data-k="price"]');
            var stockBox = row.querySelector('[data-k="stock"]');
            var v = readRow(row);
            [label, price, stockBox].forEach(function (i) { i.removeAttribute('aria-invalid'); });
            function wrong(input, text) {
              input.setAttribute('aria-invalid', 'true');
              bad.push(input);
              if (!rowsBad) rowsBad = text;
            }
            if (!v.label.trim() && (v.code.trim() || v.price.trim() || v.stock.trim())) wrong(label, 'לאפשרות חסר שם.');
            if (v.price.trim() && isNaN(TS.money(v.price))) wrong(price, 'מחיר של אפשרות צריך להיות מספר (או ריק = כמו המוצר).');
            if (isNaN(TS.whole(v.stock))) wrong(stockBox, 'מלאי של אפשרות צריך להיות מספר שלם (או ריק = בלי ספירה).');
          });
          varsSay(rowsBad, rowsBad ? 'bad' : '');
          if (bad.length) {
            if (bad[0].scrollIntoView) bad[0].scrollIntoView({ block: 'center' });
            bad[0].focus({ preventScroll: true });
          }
          return !bad.length;
        }

        function collect() {
          var list = rows();
          var counting = !list.length && track.checked;
          var body = {
            title: f('title').value, summary: f('summary').value, description: f('description').value,
            price: f('price').value, compareAt: f('compareAt').value, cost: f('cost').value,
            status: f('status').value, featured: f('featured').checked,
            shelf: shelfBox.value, brand: f('brand').value, tags: tags.get(), badge: f('badge').value,
            barcode: f('barcode').value, maxPerOrder: f('maxPerOrder').value,
            trackStock: counting, stock: counting ? f('stock').value : '',
            delivery: f('delivery').checked, weight: f('weight').value,
            seoTitle: f('seoTitle').value, seoDescription: f('seoDescription').value,
            images: gallery.get(),
            variants: list.map(readRow).filter(function (v) { return v.label.trim(); })
          };
          if (!BOOT.id && slugBox) body.slug = slugBox.value;
          return body;
        }

        // after a save the form shows what was SAVED (a cleaned barcode, an
        // option's final id, a picture that was refused) — not what was typed
        function put(name, value) {
          var input = f(name);
          if (input) input.value = value === undefined || value === null ? '' : String(value);
        }
        function minor(value) { return value === undefined || value === null ? '' : TS.fromMinor(value); }
        function fill(p) {
          put('title', p.title); put('summary', p.summary); put('description', p.description);
          put('price', minor(p.price)); put('compareAt', minor(p.compareAt)); put('cost', minor(p.cost));
          put('barcode', p.barcode); put('maxPerOrder', p.maxPerOrder || ''); put('weight', p.weight);
          put('brand', p.brand); put('badge', p.badge); put('seoTitle', p.seoTitle); put('seoDescription', p.seoDescription);
          f('status').value = p.status;
          f('featured').checked = !!p.featured;
          f('delivery').checked = !!p.delivery;
          pickShelf(p.shelf);
          track.checked = p.stock !== null && p.stock !== undefined;
          put('stock', p.stock);
          gallery.set(p.images);
          tags.set(p.tags);
          countTags(p.tags);
          TS.clear(varsEl);
          (p.variants || []).forEach(function (v) {
            addRow({ label: v.label, code: v.code, price: minor(v.price), stock: v.stock });
          });
          counters.forEach(function (c) { c.paint(); });
          syncStock(); paintStatus(); paintProfit(); paintSerp();
        }

        function notes(d) {
          var list = (d.warnings || []).slice();
          if (d.page && d.page.action === 'foreign') list.push('הדף בכתובת הזו שייך לדף אחר באתר — למוצר הזה אין דף משלו.');
          if (d.rebuilt === false) list.push('השינוי נשמר, אבל בניית האתר נכשלה — האתר החי עוד לא התעדכן.');
          return list;
        }
        function saved(list) {
          TS.clear(msgs);
          TS.lines(msgs, list, 'st-warn');
          say('נשמר ✓', list && list.length ? 'warn' : 'ok');
        }
        function links(d) {
          var view = byId('pe-view');
          var design = byId('pe-design');
          if (view) { view.hidden = !d.url; if (d.url) view.href = d.url; }
          if (design) { design.hidden = !d.builder; if (d.builder) design.href = d.builder; }
        }
        function refreshPreview() {
          var frame = byId('pe-preview');
          if (!frame) return;
          try { frame.contentWindow.location.reload(); } catch (e) { frame.src = frame.getAttribute('src'); }
        }

        var busy = false;
        function save() {
          if (busy) return;
          TS.clear(msgs);
          if (gallery.busy()) { say('התמונות עוד עולות — חכו רגע ושמרו שוב.', 'warn'); return; }
          if (!validate()) { say('יש שדות לתקן', 'bad'); return; }
          busy = true;
          saveBtn.disabled = true;
          say('שומרים…');
          TS.post('/admin/api/store/products' + (BOOT.id ? '/' + BOOT.id : ''), collect()).then(function (d) {
            busy = false;
            saveBtn.disabled = false;
            if (!d.ok) {
              TS.lines(msgs, d.errors && d.errors.length ? d.errors : [d.error || 'שגיאה'], 'st-bad');
              say('לא נשמר', 'bad');
              return;
            }
            guard.clean();
            if (!BOOT.id) {
              // the new product's own screen says what the server said about it
              TS.stash('saved', notes(d));
              TS.go('/admin/store/products/' + d.product.id);
              return;
            }
            fill(d.product);
            links(d);
            saved(notes(d));
            refreshPreview();
          });
        }
        saveBtn.addEventListener('click', save);
        TS.onSave(form, save);

        var del = byId('pe-del');
        if (del) {
          del.addEventListener('click', function () {
            TS.ask({
              title: 'למחוק את המוצר?',
              lines: [
                'מחיקה היא לצמיתות. הזמנות קודמות שומרות את הפרטים שלהן.',
                'לפני המחיקה נשמר גיבוי של הקטלוג (במסך BenTML, תחת "גיבויים"). שחזור ממנו מחזיר את המוצר, עם מחיר העלות שלו.',
                'שימו לב: שחזור מחזיר את כל הקטלוג לרגע הגיבוי — מוצרים שנוספו מאז יוסתרו, והמלאי יחזור למה שהיה.',
                'הסתרה היא הבחירה ההפיכה: המוצר יורד מהחנות, והכול נשמר.'
              ],
              actions: [
                { label: 'הסתרה במקום', value: 'hide' },
                { label: 'מחיקה לצמיתות', value: 'delete', kind: 'danger' },
                { label: 'ביטול', value: '', kind: 'secondary' }
              ]
            }).then(function (choice) {
              if (choice === 'hide') {
                f('status').value = 'hidden';
                paintStatus();
                save();
                return;
              }
              if (choice !== 'delete') return;
              say('מוחקים…');
              TS.post('/admin/api/store/products/' + BOOT.id + '/delete', {}).then(function (d) {
                if (!d.ok) {
                  TS.clear(msgs);
                  TS.lines(msgs, [d.error || 'שגיאה'], 'st-bad');
                  say('לא נמחק', 'bad');
                  return;
                }
                guard.clean();
                TS.stash('list', {
                  text: 'המוצר נמחק. גיבוי של הקטלוג נשמר במסך BenTML.' + (d.rebuilt === false ? ' בניית האתר נכשלה — האתר החי עוד לא התעדכן.' : ''),
                  tone: d.rebuilt === false ? 'warn' : 'ok'
                });
                TS.go('/admin/store/products');
              });
            });
          });
        }

        syncStock(); paintProfit(); paintSerp();
        var arrived = TS.unstash('saved');
        if (arrived) saved(arrived);
      }
      if (window.TapuzStore) start(window.TapuzStore);
      else (window.TapuzStoreReady = window.TapuzStoreReady || []).push(start);
    })();
    </script>`;
  res.send(kit.screen({ key: 'store-products', title: isNew ? 'מוצר חדש' : p.title, body, width: 1120 }));
}

router.get('/admin/store/products/new', requireAdmin, (req, res) => {
  const from = Number(req.query.from);
  const source = Number.isInteger(from) && from > 0 ? store().catalog.getProduct(from) : null;
  return editor(req, res, null, source);
});

// ── the preview ────────────────────────────────────────────────────────

// The preview is the SITE, not an admin screen: it links the site's
// stylesheet and nothing of the admin's. It runs no script at all.
const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "frame-ancestors 'self'"
].join('; ');

function previewDoc(inner, title) {
  const siteLanguage = require('../site-language');
  const lang = siteLanguage.siteLanguage();
  let fonts = '';
  let css = '/css/main.css';
  try {
    const theme = require('../theme');
    fonts = theme.renderThemeFontLinks(theme.loadOverrides());
  } catch (e) { fonts = ''; }
  try {
    const v = require('../export').currentThemeCssVersion();
    if (v) css += '?v=' + v;
  } catch (e) { /* the plain address serves the same file */ }
  return `<!DOCTYPE html>
<html lang="${lang}" dir="${siteLanguage.directionFor(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<base target="_blank">
${fonts}
<link rel="stylesheet" href="${css}">
<style>
  body { margin: 0; padding: 14px 14px 22px; }
  .pv-part + .pv-part { margin-top: 26px; }
  .pv-label { margin: 0 0 8px; font: 600 12px/1.4 system-ui, sans-serif; opacity: .62; }
  .pv-note { margin: 0 0 16px; padding: 8px 10px; border: 1px dashed currentColor; border-radius: 8px; font: 500 12px/1.5 system-ui, sans-serif; opacity: .8; }
  .pv-card { max-width: 300px; margin-inline: auto; }
  .pv-card .bent-shop-grid { display: grid; grid-template-columns: minmax(0, 1fr); }
</style>
</head>
<body>
${inner}
</body>
</html>`;
}

/**
 * The storefront's own HTML for ONE product, whatever its status. The site
 * only ever draws active products, and the owner wants to see a draft the
 * way it WILL look — so for the length of this render (it is synchronous:
 * nothing else runs in between) the catalog answers with this one product,
 * marked active. Nothing is written, and the catalog's own functions are
 * back before the function returns.
 */
function asLive(catalog, product, draw) {
  const shown = { ...product, status: 'active' };
  const real = { getProduct: catalog.getProduct, getProductBySlug: catalog.getProductBySlug, listProducts: catalog.listProducts };
  catalog.getProduct = (key) => (key === shown.id || String(key) === shown.slug ? shown : real.getProduct(key));
  catalog.getProductBySlug = (slug) => (String(slug) === shown.slug ? shown : real.getProductBySlug(slug));
  catalog.listProducts = () => [shown];
  try {
    return draw();
  } finally {
    Object.assign(catalog, real);
  }
}

router.get('/admin/store/products/:id/preview', requireAdmin, (req, res) => {
  // the admin gate says DENY to every admin response; this one page exists
  // to be framed by the product editor (same origin, session required)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', PREVIEW_CSP);
  try {
    const st = store();
    const p = st.catalog.getProduct(Number(req.params.id));
    if (!p) return res.status(404).type('html').send(previewDoc('<p class="pv-note">המוצר לא נמצא.</p>', 'תצוגה מקדימה'));
    const render = require('../store/render');
    const drawn = asLive(st.catalog, p, () => ({
      card: render.renderShop({ skus: p.slug, columns: 3, buttons: false }),
      buy: render.renderBuy({ sku: p.slug })
    }));
    const note = p.status === 'active' ? ''
      : `<p class="pv-note">המוצר במצב "${esc(st.catalog.STATUS_LABELS[p.status] || p.status)}" ואינו מוצג בחנות. כך הוא ייראה כשיהיה פעיל.</p>`;
    return res.type('html').send(previewDoc(
      `${note}<div class="pv-part"><p class="pv-label">הכרטיס ברשת המוצרים</p><div class="pv-card">${drawn.card}</div></div>` +
      `<div class="pv-part"><p class="pv-label">דף המוצר</p>${drawn.buy}</div>`,
      'תצוגה מקדימה — ' + p.title
    ));
  } catch (e) {
    return res.status(500).type('html').send(previewDoc(`<p class="pv-note">שגיאה בתצוגה המקדימה: ${esc(e && e.message ? e.message : String(e))}</p>`, 'תצוגה מקדימה'));
  }
});

router.get('/admin/store/products/:id', requireAdmin, (req, res) => {
  const p = store().catalog.getProduct(Number(req.params.id));
  if (!p) return res.status(404).send(kit.screen({ key: 'store-products', title: 'מוצר', body: '<p class="card">המוצר לא נמצא. <a href="/admin/store/products">לרשימת המוצרים</a></p>' }));
  return editor(req, res, p, null);
});

// ── API ────────────────────────────────────────────────────────────────

router.get('/admin/api/store/products', requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, products: store().catalog.listProducts({ status: 'all', q: req.query.q || '', shelf: req.query.shelf || '', limit: EVERYTHING }) });
  } catch (e) { sendError(res, e, 500); }
});

/** What a create or an update answers: the product, the catalog's remarks, and what the site did about it. */
function answer(res, st, r, after) {
  const links = pageLinks(st, r.product.slug);
  res.json({ ok: true, product: r.product, warnings: r.warnings, page: after.page, rebuilt: after.rebuilt, url: links.url, builder: links.builder });
}

/**
 * After a change to MANY products: each one's page follows its product, then
 * the site is rebuilt ONCE. store.afterProductChange rebuilds the whole site
 * on every call — thirty ticked rows must not be thirty exports inside one
 * request.
 * @returns {{ rebuilt: boolean, foreign: number }}
 */
function followMany(st, products, deletedSlugs) {
  let foreign = 0;
  // the category pages first, once — the way one product's save does it
  // (afterProductChange): a bulk "draft" can empty a category, a bulk move
  // can fill a new one, and each product's trail links its category's page
  try {
    st.pages.syncShelfPages();
  } catch (e) {
    console.error('[store] category page sync failed:', e.message);
  }
  if (st.isOpen()) {
    const s = st.settings.loadSettings();
    for (const p of products || []) {
      try {
        if (st.pages.syncProductPage(p, s).action === 'foreign') foreign++;
      } catch (e) {
        console.error('[store] product page sync failed:', e.message);
      }
    }
  }
  // a deleted product's page comes down whether the store is open or not
  for (const slug of deletedSlugs || []) {
    try { st.pages.retireProductPage(slug); } catch (e) { console.error('[store] product page sync failed:', e.message); }
  }
  return { rebuilt: st.refreshNow(), foreign };
}

router.post('/admin/api/store/products', requireAdmin, (req, res) => {
  try {
    const st = store();
    const r = st.catalog.createProduct(fromForm(req.body));
    answer(res, st, r, st.afterProductChange(r.product));
  } catch (e) { sendError(res, e); }
});

// The two fixed addresses below MUST stay above '/:id': registered after it,
// "bulk" and "reorder" would be read as a product's id and answered
// "המוצר לא נמצא".

router.post('/admin/api/store/products/bulk', requireAdmin, (req, res) => {
  try {
    const st = store();
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? b.ids : [];
    const action = b.action && typeof b.action === 'object' ? b.action : {};
    if (!ids.length) return res.status(400).json({ ok: false, error: 'לא נבחרו מוצרים' });
    let backupId = null;
    if (action.delete === true) {
      // A delete is for good, so the catalog goes on the backups shelf first
      // (the BenTML screen can bring it back). No backup, no delete.
      try {
        backupId = st.document.backup('admin:bulk-delete');
      } catch (e) {
        return res.status(409).json({ ok: false, code: 'BACKUP_FAILED', error: e && e.message ? e.message : String(e) });
      }
    }
    const r = st.catalog.bulkUpdate(ids, action);
    // nothing changed → nothing to rebuild; `rebuilt` is false only when a rebuild was needed and failed
    const site = r.changed ? followMany(st, r.products, r.deleted) : { rebuilt: true, foreign: 0 };
    return res.json({ ok: true, changed: r.changed, products: r.products, deleted: r.deleted, backupId, rebuilt: site.rebuilt, foreign: site.foreign });
  } catch (e) { return sendError(res, e); }
});

router.post('/admin/api/store/products/reorder', requireAdmin, (req, res) => {
  try {
    const st = store();
    const sent = req.body && Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!sent.length) return res.status(400).json({ ok: false, error: 'חסר סדר המוצרים' });
    // The rows that were sent take, in their new order, exactly the places
    // those same rows hold now. A list that showed only part of the shop — or
    // a tab left open while a product was added elsewhere — can never push
    // the products it did not show out of their places.
    const now = st.catalog.listProducts({ status: 'all', sort: 'manual', limit: EVERYTHING }).map((p) => p.id);
    const known = new Set(now);
    const asked = [...new Set(sent.map((x) => Number(x)))].filter((id) => known.has(id));
    const moving = new Set(asked);
    let k = 0;
    const next = now.map((id) => (moving.has(id) ? asked[k++] : id));
    const moved = next.filter((id, i) => id !== now[i]).length;
    if (moved) st.catalog.reorderProducts(next);
    return res.json({ ok: true, changed: moved, rebuilt: moved ? st.refreshNow() : true });
  } catch (e) { return sendError(res, e); }
});

router.post('/admin/api/store/products/:id', requireAdmin, (req, res) => {
  try {
    const st = store();
    const r = st.catalog.updateProduct(Number(req.params.id), fromForm(req.body));
    answer(res, st, r, st.afterProductChange(r.product));
  } catch (e) { sendError(res, e); }
});

router.post('/admin/api/store/products/:id/delete', requireAdmin, (req, res) => {
  try {
    const st = store();
    const p = st.catalog.getProduct(Number(req.params.id));
    if (!p) return res.status(404).json({ ok: false, error: 'המוצר לא נמצא' });
    // The catalog goes on the backups shelf before a product leaves it, so
    // the BenTML screen can bring it back (with a new row id and without its
    // cost — the document does not carry one). No backup, no delete.
    let backupId;
    try {
      backupId = st.document.backup('admin:delete:' + p.slug);
    } catch (e) {
      return res.status(409).json({ ok: false, code: 'BACKUP_FAILED', error: e && e.message ? e.message : String(e) });
    }
    st.catalog.deleteProduct(p.id);
    const after = st.afterProductChange(null, { deletedSlug: p.slug });
    return res.json({ ok: true, deleted: p.slug, backupId, page: after.page, rebuilt: after.rebuilt });
  } catch (e) { return sendError(res, e); }
});

// The editor's "שכפול" no longer comes here (it opens the form filled, and
// writes nothing until "שמירה"); this stays for scripts.
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
    res.json({ ok: true, product: p, rebuilt: st.refreshNow() });
  } catch (e) { sendError(res, e); }
});

// The editor's "+ קטגוריה חדשה" saves here (the categories screen has its own
// door, POST …/shelves/<id>). This one only ever CREATES: a name whose id is
// taken used to go on to saveShelf and rewrite that category — its name, and
// its parent to whatever the little form said. Now the category that is there
// is answered as it stands (`existed`), and the editor just selects it.
router.post('/admin/api/store/shelves', requireAdmin, (req, res) => {
  try {
    const st = store();
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    // the id saveShelf itself would arrive at
    const id = st.catalog.isSlug(b.slug) ? String(b.slug) : st.catalog.slugify(b.slug || st.catalog.shelfFields({ label: b.label }).label);
    const had = id ? st.catalog.getShelf(id) : null;
    if (had) return res.json({ ok: true, shelf: had, existed: true, rebuilt: true });
    const shelf = st.catalog.saveShelf(b);
    // the storefront follows a category: its chip, its page, its step in the crumbs
    const after = typeof st.afterShelfChange === 'function' ? st.afterShelfChange() : { rebuilt: st.refreshNow() };
    res.json({ ok: true, shelf, rebuilt: !!(after && after.rebuilt) });
  } catch (e) { sendError(res, e); }
});

module.exports = router;
