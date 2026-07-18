'use strict';

/**
 * Admin home — the twenty-sixth route-group extraction: GET /admin, the
 * pages-list landing (also the post-build "your site is live" screen and
 * the v0.78 homepage-status banner — who owns '/', or the warning that
 * nobody does). Redirects to the setup wizard on a pristine install via
 * the shared needsSetup(). Self-contained — page store + config + seo
 * home-resolution + the admin-ui shell, all module imports.
 */

const express = require('express');
const { needsSetup } = require('../setup');
const { listPages } = require('../pages');
const { loadConfig } = require('../config');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');

const router = express.Router();

router.get('/admin', (req, res) => {
  if (needsSetup()) return res.redirect('/admin/setup');
  const pages = listPages();

  // Who owns '/' right now — the user's explicit choice, or the ranked
  // fallback, or nobody (v0.78 homepage flow: nobody = a 404 at the root,
  // and the screen says so instead of leaving QA to discover it).
  const config = loadConfig();
  const published = pages.filter((p) => p.status === 'published');
  const homePath = require('../seo').resolveHomePath(published, config.homepage);
  const homeIsExplicit = !!(config.homepage && homePath === config.homepage);

  const msg = req.query.built
    ? `<div style="background:#ecfdf5;border:1px solid #10b981;padding:16px 18px;border-radius:12px;margin-bottom:16px;">
         <div style="color:#166534;font-weight:700;margin-bottom:10px">🎉 האתר שלכם חי! מה עכשיו?</div>
         <div style="display:flex;gap:10px;flex-wrap:wrap">
           <a href="/" target="_blank" class="btn" style="background:#166534;border-color:#166534">👀 צפו באתר</a>
           ${homePath ? `<a href="/admin/edit/${encodeURIComponent(homePath)}" class="btn secondary">✏️ ערכו את דף הבית</a>` : ''}
           <a href="/admin/theme" class="btn secondary">🎨 שחקו עם המראה</a>
         </div>
       </div>`
    : '';

  const homeSetMsg = req.query.homeset
    ? `<div style="background:#eff6ff;border:1px solid #3b82f6;color:#1d4ed8;padding:12px 18px;border-radius:12px;margin-bottom:16px;font-weight:600">
         🏠 דף הבית עודכן — האתר נבנה מחדש והשורש (/) מגיש אותו עכשיו.
       </div>`
    : '';

  const noHomeWarning = !homePath && published.length
    ? `<div style="background:#fef2f2;border:1px solid #ef4444;padding:14px 18px;border-radius:12px;margin-bottom:16px">
         <div style="color:#b91c1c;font-weight:700;margin-bottom:4px">⚠️ לאתר אין דף בית</div>
         <div style="color:#7f1d1d;font-size:0.9rem">מי שגולש לכתובת האתר (/) מקבל 404. בחרו דף ולחצו <strong>🏠 קבע כדף הבית</strong> — זה הכל.</div>
       </div>`
    : '';

  let listHtml = pages.length === 0
    ? `<div style="padding:40px;text-align:center;color:#64748b">אין דפים עדיין</div>`
    : pages.map(p => {
      const badge = p.status === 'published'
        ? '<span style="background:#dcfce7;color:#166534;font-size:0.75rem;padding:2px 8px;border-radius:999px">פורסם</span>'
        : '<span style="background:#fef3c7;color:#92400e;font-size:0.75rem;padding:2px 8px;border-radius:999px">טיוטה</span>';
      const isHome = p.full_path === homePath;
      const homeBadge = isHome
        ? `<span title="${homeIsExplicit ? 'דף הבית — נקבע ידנית' : 'דף הבית — זיהוי אוטומטי; קיבוע בהגדרות'}" style="background:#dbeafe;color:#1d4ed8;font-size:0.75rem;padding:2px 8px;border-radius:999px">🏠 דף הבית${homeIsExplicit ? '' : ' (אוטו)'}</span>`
        : '';
      const dirty = p.has_unpublished
        ? '<span style="color:#b45309;font-size:0.75rem;margin-inline-start:6px">• שינויים לא פורסמו</span>'
        : '';
      const updated = p.updated_at
        ? `<span style="font-size:0.78rem;color:#94a3b8;margin-inline-start:10px">עודכן: ${String(p.updated_at).replace('T', ' ').slice(0, 16)}</span>`
        : '';
      const setHomeBtn = p.status === 'published' && !isHome
        ? `<form method="POST" action="/admin/homepage">
             <input type="hidden" name="full_path" value="${escapeAdmin(p.full_path)}">
             <button type="submit" class="btn secondary" style="padding:8px 14px" title="הדף הזה יוגש בשורש האתר (/)">🏠 קבע כדף הבית</button>
           </form>`
        : '';
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border:1px solid ${isHome ? '#93c5fd' : '#e2e8f0'};border-radius:10px;margin-bottom:8px;background:white">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <strong>${p.title}</strong>${badge}${homeBadge}${dirty}
          </div>
          <span style="font-family:monospace;font-size:0.85rem;color:#64748b">/${p.full_path}</span>${updated}
        </div>
        <div style="display:flex;gap:8px">
          ${setHomeBtn}
          <a href="/admin/edit/${encodeURIComponent(p.full_path)}" class="btn" style="padding:8px 16px">ערוך</a>
          <form method="POST" action="/admin/delete" onsubmit="return confirm('למחוק?')">
            <input type="hidden" name="full_path" value="${p.full_path}">
            <button type="submit" class="btn secondary" style="padding:8px 14px">מחק</button>
          </form>
        </div>
      </div>`;
    }).join('');

  const html = `
    ${adminNav('pages', 'דפים', '<a href="/admin/new" class="btn">+ דף חדש</a>')}
    <div class="container" style="padding-top:30px">
      ${msg}
      ${homeSetMsg}
      ${noHomeWarning}
      ${listHtml}
    </div>
  `;
  res.send(layout(html, 'דפים', accentFor('pages')));
});

module.exports = router;
