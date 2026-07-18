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
  const diskBadge = (p) =>
    `<code style="font-size:0.72rem;background:#f1f5f9;color:#475569;padding:1px 6px;border-radius:5px;direction:ltr;display:inline-block">${escapeAdmin(p)}</code>`;

  const pageCards = store.pages.length
    ? store.pages.map((p) => {
        const badges =
          (p.published ? '<span style="background:#dcfce7;color:#166534;font-size:0.68rem;padding:1px 7px;border-radius:999px">מפורסם</span>' : '') +
          (p.draft ? ' <span style="background:#fef3c7;color:#92400e;font-size:0.68rem;padding:1px 7px;border-radius:999px">טיוטה</span>' : '');
        return `<a href="/admin/edit/${encodeURIComponent(p.slug)}" class="stg-card">` +
          `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong style="font-size:0.95rem">${escapeAdmin(p.slug)}</strong><span>${badges}</span></div>` +
          `<div style="margin:6px 0">${diskBadge(p.diskPath)}</div>` +
          `<div style="font-size:0.75rem;color:#94a3b8">${kb(p.size)} · ${escapeAdmin(when(p.mtime))}</div></a>`;
      }).join('')
    : '<div class="stg-empty">אין דפים עדיין — <a href="/admin/new">צור דף</a>.</div>';

  const mediaCards = store.media.length
    ? store.media.map((m) =>
        `<div class="stg-card" style="text-align:center">` +
        `<img src="${escapeAdmin(m.url)}" alt="" loading="lazy" style="width:100%;height:82px;object-fit:cover;border-radius:6px">` +
        `<div style="font-size:0.73rem;color:#475569;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAdmin(m.name)}">${escapeAdmin(m.name)}</div></div>`
      ).join('')
    : '<div class="stg-empty">אין קבצי מדיה. העלה ב<a href="/admin/media-library">ספריית המדיה</a>.</div>';

  const dataCards = store.siteData.length
    ? store.siteData.map((f) =>
        `<div class="stg-card"><strong style="font-size:0.9rem">🗂 ${escapeAdmin(f.name)}</strong>` +
        `<div style="margin:6px 0">${diskBadge(f.diskPath)}</div>` +
        `<div style="font-size:0.75rem;color:#94a3b8">${kb(f.size)} · ${escapeAdmin(when(f.mtime))}</div></div>`
      ).join('')
    : '<div class="stg-empty">—</div>';

  const html = `
    <style>
      .stg-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin:10px 0 26px }
      .stg-card { display:block;border:1px solid #e2e8f0;border-radius:11px;padding:13px 14px;background:#fff;text-decoration:none;color:#0f172a }
      a.stg-card:hover { border-color:#0a66c2;box-shadow:0 2px 10px rgba(10,102,194,.08) }
      .stg-sec { display:flex;align-items:center;gap:9px;margin:8px 0 2px;font-weight:700;font-size:1.05rem }
      .stg-sec .n { background:#eef2f7;color:#475569;font-size:0.78rem;font-weight:600;padding:1px 9px;border-radius:999px }
      .stg-empty { color:#94a3b8;padding:16px;border:1px dashed #e2e8f0;border-radius:10px;background:#fff }
    </style>
    ${adminNav('storage', 'אחסון')}
    <div class="container" style="padding-top:28px;max-width:1000px;padding-bottom:60px">
      <div style="background:linear-gradient(135deg,#0f766e,#0a66c2);color:#fff;border-radius:14px;padding:18px 22px;margin-bottom:20px">
        <div style="font-size:1.25rem;font-weight:700;margin-bottom:4px">🗄️ התוכן שלך — קבצים אמיתיים על הדיסק</div>
        <div style="opacity:.92;font-size:0.9rem;line-height:1.5">אין מסד נתונים סגור ואין נעילה. כל דף הוא קובץ <code style="direction:ltr">.pzn</code> אמיתי בתיקייה שלך — אתה הבעלים. זו העוצמה של Tapuziel: התוכן נייד, קריא, ושלך.</div>
        <div style="margin-top:8px;font-size:0.8rem;opacity:.85;direction:ltr">📁 ${escapeAdmin(store.root)}</div>
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
