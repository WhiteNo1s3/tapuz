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
    ? `<div class="notice ok">
         <span class="notice-ico">🎉</span>
         <div class="notice-body">
           <strong>האתר שלכם חי! מה עכשיו?</strong>
           <div class="row">
             <a href="/" target="_blank" class="btn publish">👀 צפו באתר</a>
             ${homePath ? `<a href="/admin/edit/${encodeURIComponent(homePath)}" class="btn secondary">✏️ ערכו את דף הבית</a>` : ''}
             <a href="/admin/theme" class="btn secondary">🎨 שחקו עם המראה</a>
           </div>
         </div>
       </div>`
    : '';

  const homeSetMsg = req.query.homeset
    ? `<div class="notice info">
         <span class="notice-ico">🏠</span>
         <div class="notice-body"><strong>דף הבית עודכן</strong>
           <p>האתר נבנה מחדש והשורש (/) מגיש אותו עכשיו.</p></div>
       </div>`
    : '';

  const noHomeWarning = !homePath && published.length
    ? `<div class="notice danger">
         <span class="notice-ico">⚠️</span>
         <div class="notice-body">
           <strong>לאתר אין דף בית</strong>
           <p>מי שגולש לכתובת האתר (/) מקבל 404. בחרו דף ולחצו <strong>🏠 קבע כדף הבית</strong> — זה הכל.</p>
         </div>
       </div>`
    : '';

  let listHtml = pages.length === 0
    ? `<div class="empty-state">
         <div style="font-size:1.05rem;font-weight:700;margin-bottom:6px">אין דפים עדיין</div>
         <div>לחצו <strong>+ דף חדש</strong> למעלה כדי להתחיל</div>
       </div>`
    : pages.map(p => {
      const badge = p.status === 'published'
        ? '<span class="pill ok">פורסם</span>'
        : '<span class="pill warn">טיוטה</span>';
      const isHome = p.full_path === homePath;
      const homeBadge = isHome
        ? `<span class="pill info" title="${homeIsExplicit ? 'דף הבית — נקבע ידנית' : 'דף הבית — זיהוי אוטומטי; קיבוע בהגדרות'}">🏠 דף הבית${homeIsExplicit ? '' : ' (אוטו)'}</span>`
        : '';
      const dirty = p.has_unpublished
        ? '<span class="faint" style="color:var(--warn)">• שינויים לא פורסמו</span>'
        : '';
      const updated = p.updated_at
        ? `<span class="faint" style="margin-inline-start:10px">עודכן: ${String(p.updated_at).replace('T', ' ').slice(0, 16)}</span>`
        : '';
      const setHomeBtn = p.status === 'published' && !isHome
        ? `<form method="POST" action="/admin/homepage">
             <input type="hidden" name="full_path" value="${escapeAdmin(p.full_path)}">
             <button type="submit" class="btn secondary" style="padding:8px 14px" title="הדף הזה יוגש בשורש האתר (/)">🏠 קבע כדף הבית</button>
           </form>`
        : '';
      return `
      <div class="row-item${isHome ? ' is-home' : ''}">
        <div class="row-main">
          <div class="row-title">
            <strong>${p.title}</strong>${badge}${homeBadge}${dirty}
          </div>
          <span class="mono muted">/${p.full_path}</span>${updated}
        </div>
        <div class="row-actions">
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
    <div class="container page-body">
      ${msg}
      ${homeSetMsg}
      ${noHomeWarning}
      ${listHtml}
    </div>
  `;
  res.send(layout(html, 'דפים', accentFor('pages')));
});

module.exports = router;
