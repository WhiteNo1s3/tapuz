'use strict';

/**
 * Storage — extracted to its own route module in v1.09 (docs/ARCHITECTURE.md's
 * plan, seventh route-group extraction, same template as
 * team/integrations/seo/sitemap/site-chrome/menus). "The content is real
 * files on disk" screen: pages/media/site-data inventory via
 * src/storage-view.js. Read-only (no POST here — the underlying files are
 * edited from their own screens: pages in the builder, media in the
 * library, categories on /admin/categories).
 */

const express = require('express');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');

const router = express.Router();

router.get('/admin/api/storage', (req, res) => {
  try {
    res.json({ ok: true, ...require('../storage-view').listStorage() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/admin/storage', (req, res) => {
  const store = require('../storage-view').listStorage();
  const kb = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');
  const when = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  };
  const diskBadge = (p) => `<code class="disk-path">${escapeAdmin(p)}</code>`;

  const pageCards = store.pages.length
    ? store.pages.map((p) => {
        const badges =
          (p.published ? '<span class="pill ok">מפורסם</span>' : '') +
          (p.draft ? ' <span class="pill warn">טיוטה</span>' : '');
        return `<a href="/admin/edit/${encodeURIComponent(p.slug)}" class="stg-card">` +
          `<div class="row between"><strong>${escapeAdmin(p.slug)}</strong><span>${badges}</span></div>` +
          `<div class="stg-path">${diskBadge(p.diskPath)}</div>` +
          `<div class="faint">${kb(p.size)} · ${escapeAdmin(when(p.mtime))}</div></a>`;
      }).join('')
    : '<div class="stg-empty">אין דפים עדיין — <a href="/admin/new">צור דף</a>.</div>';

  const mediaCards = store.media.length
    ? store.media.map((m) =>
        `<div class="stg-card" style="text-align:center">` +
        `<img src="${escapeAdmin(m.url)}" alt="" loading="lazy" class="stg-thumb">` +
        `<div class="file-name" title="${escapeAdmin(m.name)}">${escapeAdmin(m.name)}</div></div>`
      ).join('')
    : '<div class="stg-empty">אין קבצי מדיה. העלה ב<a href="/admin/media-library">ספריית המדיה</a>.</div>';

  const dataCards = store.siteData.length
    ? store.siteData.map((f) =>
        `<div class="stg-card"><strong>🗂 ${escapeAdmin(f.name)}</strong>` +
        `<div class="stg-path">${diskBadge(f.diskPath)}</div>` +
        `<div class="faint">${kb(f.size)} · ${escapeAdmin(when(f.mtime))}</div></div>`
      ).join('')
    : '<div class="stg-empty">—</div>';

  const html = `
    ${adminNav('storage', 'אחסון')}
    <div class="container page-body" style="max-width:1000px">
      <div class="banner">
        <div class="banner-title">🗄️ התוכן שלך — קבצים אמיתיים על הדיסק</div>
        <div class="banner-text">אין מסד נתונים סגור ואין נעילה. כל דף הוא קובץ <code>.pzn</code> אמיתי בתיקייה שלך — אתה הבעלים. זו העוצמה של Tapuziel: התוכן נייד, קריא, ושלך.</div>
        <div class="banner-meta">📁 ${escapeAdmin(store.root)}</div>
      </div>

      <div class="stg-sec">📄 דפים <span class="n">${store.counts.pages}</span></div>
      <div class="stg-grid">${pageCards}</div>

      <div class="stg-sec">🖼️ מדיה <span class="n">${store.counts.media}</span></div>
      <div class="stg-grid">${mediaCards}</div>

      <div class="stg-sec">🗂️ נתוני אתר <span class="n">${store.counts.siteData}</span></div>
      <div class="stg-grid">${dataCards}</div>
    </div>
  `;
  res.send(layout(html, 'אחסון', accentFor('storage')));
});

module.exports = router;
