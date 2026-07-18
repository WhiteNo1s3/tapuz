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
      .cat-row { display:grid;grid-template-columns:110px 1fr 52px 1fr 34px;gap:8px;align-items:center;margin-bottom:8px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px }
      .cat-row input[type=text] { width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:7px;box-sizing:border-box }
      .cat-row input[type=color] { width:44px;height:34px;border:1px solid #cbd5e1;border-radius:7px;padding:2px }
      .cat-row .cat-del { border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:7px;padding:6px 0;cursor:pointer }
      .cat-desc { grid-column: 1 / -1; }
      .cat-head { display:grid;grid-template-columns:110px 1fr 52px 1fr 34px;gap:8px;font-size:0.75rem;font-weight:700;color:#64748b;padding:0 10px;margin-bottom:4px }
    </style>
    ${adminNav('categories', 'קטגוריות')}
    <div class="container" style="padding-top:28px;max-width:820px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">קטגוריה = תגית מנוהלת עם מיתוג (שם, צבע, תמונה, תיאור). משייכים דפים לקטגוריה במאפייני הדף בבונה, ומציגים אותה בכל דף עם בלוק "קטגוריה". הרשימה נשמרת כקובץ <code style="direction:ltr">content/categories.json</code> — <a href="/admin/storage">רואים אותו באחסון</a>.</p>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px">
        <div class="cat-head"><span>slug</span><span>שם תצוגה</span><span>צבע</span><span>תמונת רקע (URL)</span><span></span></div>
        <div id="cat-list"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
          <button type="button" class="btn secondary" id="cat-add">+ קטגוריה</button>
          <div style="display:flex;gap:10px;align-items:center">
            <span id="cat-status" style="color:#166534;font-size:0.85rem"></span>
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
