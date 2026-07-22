'use strict';

/**
 * The site-map admin page — extracted to its own route module in v1.03
 * (docs/ARCHITECTURE.md's plan, fourth standalone-admin-page extraction).
 * Structure entirely derived from src/sitemap.js's buildSitemap().
 * v1.26: the JSON twin (`GET /admin/api/sitemap`), which had stayed inline
 * in server.js, joined its own page here — same data, same module.
 */

const express = require('express');
const { buildSitemap } = require('../sitemap');
const { layout, adminNav, accentFor } = require('../admin-ui');

const router = express.Router();

/** JSON twin of the sitemap page — same buildSitemap() structure. */
router.get('/admin/api/sitemap', (req, res) => {
  try {
    res.json({ ok: true, ...buildSitemap() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/sitemap', (req, res) => {
  const data = buildSitemap();
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ICONS = { page: '📄', custom: '🔗', tel: '📞', mailto: '✉️', anchor: '⚓' };

  function renderItems(items) {
    if (!items || !items.length) return '';
    return '<ul class="sm-list">' + items.map(it => {
      let badge = '';
      let edit = '';
      if (it.page) {
        badge = it.page.status === 'published'
          ? '<span class="sm-badge sm-pub">פורסם</span>'
          : '<span class="sm-badge sm-draft">טיוטה</span>';
        if (it.page.has_unpublished) badge += '<span class="sm-badge sm-dirty">• שינויים</span>';
        edit = `<a class="sm-edit" href="/admin/edit/${encodeURIComponent(it.page.full_path)}">ערוך</a>`;
      } else if (it.missing) {
        badge = '<span class="sm-badge sm-missing">דף חסר!</span>';
      }
      return `<li><div class="sm-item">${ICONS[it.type] || '🔗'} <strong>${esc(it.label)}</strong>` +
        ` <code>${esc(it.url)}</code>${badge}${edit}</div>${renderItems(it.children)}</li>`;
    }).join('') + '</ul>';
  }

  const menuSections = Object.keys(data.menus).map(name => {
    const title = name === 'main' ? 'תפריט ראשי' : name === 'footer' ? 'תפריט תחתון' : name;
    return `<section class="sm-card"><h3>${esc(title)}</h3>` +
      (data.menus[name].length ? renderItems(data.menus[name]) : '<p class="sm-none">אין פריטים</p>') +
      '</section>';
  }).join('');

  const orphanRows = data.orphans.length
    ? data.orphans.map(p =>
        `<li><div class="sm-item">📄 <strong>${esc(p.title)}</strong> <code>/${esc(p.full_path)}.html</code>` +
        (p.status === 'published'
          ? '<span class="sm-badge sm-pub">פורסם</span>'
          : '<span class="sm-badge sm-draft">טיוטה</span>') +
        (p.has_unpublished ? '<span class="sm-badge sm-dirty">• שינויים</span>' : '') +
        ` <a class="sm-edit" href="/admin/edit/${encodeURIComponent(p.full_path)}">ערוך</a></div></li>`
      ).join('')
    : '<li><div class="sm-item sm-none">כל הדפים מקושרים מתפריט 🎉</div></li>';

  const html = `
    <style>
      .sm-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:18px}
      .sm-card h3{margin-top:0}
      .sm-list{list-style:none;padding-inline-start:22px;margin:6px 0;border-inline-start:2px solid #e2e8f0}
      .sm-card > .sm-list{border-inline-start:none;padding-inline-start:0}
      .sm-item{display:flex;align-items:center;gap:8px;padding:6px 4px;flex-wrap:wrap}
      .sm-item code{background:#f1f5f9;border-radius:5px;padding:2px 7px;font-size:0.8rem;direction:ltr}
      .sm-badge{font-size:0.72rem;border-radius:99px;padding:2px 9px;font-weight:600}
      .sm-pub{background:#dcfce7;color:#166534}
      .sm-draft{background:#fef9c3;color:#854d0e}
      .sm-dirty{background:#fff7ed;color:#b45309}
      .sm-missing{background:#fee2e2;color:#b91c1c}
      .sm-edit{font-size:0.8rem;color:#0a66c2;text-decoration:none}
      .sm-none{color:#64748b}
    </style>
    ${adminNav('sitemap', 'מפת אתר')}
    <div class="container" style="padding-top:28px;max-width:860px">
      <p class="lead">המבנה נגזר מהתפריטים. דפים שלא מקושרים מופיעים למטה כיתומים.</p>
      ${menuSections}
      <section class="sm-card"><h3>דפים שלא בתפריט</h3><ul class="sm-list" style="border:none;padding-inline-start:0">${orphanRows}</ul></section>
    </div>
  `;
  res.send(layout(html, 'מפת אתר', accentFor('sitemap')));
});

module.exports = router;
