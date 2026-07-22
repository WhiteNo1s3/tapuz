'use strict';

/**
 * Categories — extracted to its own route module in v1.09
 * (docs/ARCHITECTURE.md's plan, eighth route-group extraction). A category
 * is a first-class tag with branding (name/color/image/description); the
 * list lives on disk in content/categories.json (visible in the Storage
 * screen), membership rides on each page's portable tags. Client-side
 * fetches its own data (GET /admin/api/categories) rather than being
 * server-rendered inline, so no escapeAdmin dependency here.
 */

const express = require('express');
const { layout, adminNav, accentFor } = require('../admin-ui');

const router = express.Router();

router.get('/admin/api/categories', (req, res) => {
  try {
    res.json({ ok: true, categories: require('../categories').listCategories() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/categories', (req, res) => {
  try {
    const saved = require('../categories').saveCategories((req.body && req.body.categories) || []);
    res.json({ ok: true, categories: saved });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/categories', (req, res) => {
  const html = `
    <style>
      .cat-row { display:grid;grid-template-columns:110px 1fr 52px 1fr 34px;gap:8px;align-items:center;margin-bottom:8px;background:var(--ws-panel);border:1px solid var(--accent-line);border-radius:var(--r-md);padding:10px;box-shadow:var(--elev-1) }
      .cat-row input[type=text] { width:100%;padding:8px;border:1.5px solid var(--ws-border-strong);border-radius:7px;box-sizing:border-box;font:inherit;background:var(--ws-panel);color:var(--ws-text) }
      .cat-row input[type=text]:focus { outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent) }
      .cat-row input[type=color] { width:44px;height:34px;border:1.5px solid var(--ws-border-strong);border-radius:7px;padding:2px;cursor:pointer }
      .cat-row .cat-del { border:1px solid #fecaca;background:var(--ws-panel);color:#b91c1c;border-radius:7px;padding:6px 0;cursor:pointer;transition:background var(--dur),border-color var(--dur) }
      .cat-row .cat-del:hover { background:#fef2f2;border-color:#fca5a5 }
      .cat-desc { grid-column: 1 / -1; }
      .cat-head { display:grid;grid-template-columns:110px 1fr 52px 1fr 34px;gap:8px;font-size:0.72rem;font-weight:800;letter-spacing:.3px;text-transform:uppercase;color:var(--accent-ink);padding:0 10px 6px;margin-bottom:8px;border-bottom:1px solid var(--accent-line) }
    </style>
    ${adminNav('categories', 'קטגוריות')}
    <div class="container page-body" style="max-width:820px">
      <p class="lead">קטגוריה = תגית מנוהלת עם מיתוג (שם, צבע, תמונה, תיאור). משייכים דפים לקטגוריה במאפייני הדף בבונה, ומציגים אותה בכל דף עם בלוק "קטגוריה". הרשימה נשמרת כקובץ <code style="direction:ltr">content/categories.json</code> — <a href="/admin/storage">רואים אותו באחסון</a>.</p>
      <div class="card">
        <div class="card-head"><span class="ico">🗂️</span>הקטגוריות שלך<span class="card-head-sub" id="cat-count"></span></div>
        <div class="cat-head"><span>slug</span><span>שם תצוגה</span><span>צבע</span><span>תמונת רקע (URL)</span><span></span></div>
        <div id="cat-list"></div>
        <div class="row between" style="margin-top:12px">
          <button type="button" class="btn secondary" id="cat-add">+ קטגוריה</button>
          <div class="row">
            <span id="cat-status" class="ok-text"></span>
            <button type="button" class="btn" id="cat-save">שמור</button>
          </div>
        </div>
      </div>
    </div>
    <script>
      (function () {
        var cats = [];
        function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
        function isHex(v) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')); }
        function render() {
          var cc = document.getElementById('cat-count');
          if (cc) cc.textContent = cats.length ? cats.length + ' קטגוריות' : '';
          document.getElementById('cat-list').innerHTML = cats.map(function (c, i) {
            return '<div class="cat-row" data-i="' + i + '">' +
              '<input type="text" data-k="slug" dir="ltr" value="' + esc(c.slug) + '" placeholder="news">' +
              '<input type="text" data-k="name" value="' + esc(c.name) + '" placeholder="חדשות">' +
              '<input type="color" data-k="color" value="' + (isHex(c.color) ? esc(c.color) : '#0a66c2') + '">' +
              '<input type="text" data-k="image" dir="ltr" value="' + esc(c.image) + '" placeholder="/assets/... (לא חובה)">' +
              '<button type="button" class="cat-del" title="הסר">×</button>' +
              '<input type="text" data-k="description" class="cat-desc" value="' + esc(c.description) + '" placeholder="תיאור קצר (לא חובה)">' +
              '</div>';
          }).join('') || '<div style="color:#94a3b8;padding:14px;text-align:center">אין קטגוריות עדיין — הוסיפו את הראשונה</div>';
        }
        function collect() {
          cats = [].map.call(document.querySelectorAll('.cat-row'), function (row) {
            var c = {};
            row.querySelectorAll('[data-k]').forEach(function (inp) { c[inp.dataset.k] = inp.value; });
            return c;
          });
        }
        document.getElementById('cat-list').addEventListener('click', function (e) {
          if (!e.target.classList.contains('cat-del')) return;
          collect();
          cats.splice(parseInt(e.target.closest('.cat-row').dataset.i, 10), 1);
          render();
        });
        document.getElementById('cat-add').addEventListener('click', function () {
          collect(); cats.push({ slug: '', name: '', color: '#0a66c2', image: '', description: '' }); render();
        });
        document.getElementById('cat-save').addEventListener('click', function () {
          collect();
          fetch('/admin/api/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categories: cats })
          }).then(function (r) { return r.json(); }).then(function (d) {
            var st = document.getElementById('cat-status');
            if (d.ok) { cats = d.categories; render(); st.textContent = 'נשמר ✓'; setTimeout(function () { st.textContent = ''; }, 2500); }
            else { st.style.color = '#b91c1c'; st.textContent = d.error || 'שגיאה'; }
          });
        });
        fetch('/admin/api/categories').then(function (r) { return r.json(); }).then(function (d) {
          cats = (d && d.categories) || []; render();
        }).catch(function () { render(); });
      })();
    </script>
  `;
  res.send(layout(html, 'קטגוריות', accentFor('categories')));
});

module.exports = router;
