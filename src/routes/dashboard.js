'use strict';

/**
 * Admin dashboard — the nineteenth route-group extraction. The landing
 * hub (stat cards, the tool-family grid derived from ADMIN_NAV_GROUPS,
 * recent pages, quick actions) plus the /admin/build-redirect shortcut
 * the dashboard's "build the site" button posts to. needsSetup() was
 * inlined here in v1.24; v1.30 promoted it to the shared src/setup.js
 * (single source of truth, next to runSetup) and this now imports it.
 */

const express = require('express');
const { listPages } = require('../pages');
const { needsSetup } = require('../setup');
const { exportAll } = require('../export');
const { layout, adminNav, accentFor, escapeAdmin, ADMIN_NAV_GROUPS } = require('../admin-ui');

const router = express.Router();

router.get('/admin/dashboard', (req, res) => {
  if (needsSetup()) return res.redirect('/admin/setup');
  const pages = listPages();
  const published = pages.filter(p => p.status === 'published').length;
  const drafts = pages.length - published;
  const pending = pages.filter(p => p.has_unpublished).length;
  let mediaCount = 0;
  try {
    mediaCount = require('../db').db.prepare('SELECT COUNT(*) AS c FROM media').get().c;
  } catch (e) { /* media table may not exist yet */ }
  let unreadInbox = 0;
  try {
    unreadInbox = require('../forms').unreadCount();
  } catch (e) { /* inbox table may not exist yet */ }

  const statCard = (num, label, color) => `
    <div class="stat" style="--c:${color}">
      <div class="stat-num">${num}</div>
      <div class="stat-label">${label}</div>
    </div>`;

  const recent = pages.slice(0, 5).map(p => `
    <div class="row-item">
      <div class="row-main">
        <strong>${escapeAdmin(p.title)}</strong>
        <span class="faint" style="margin-inline-start:8px">${String(p.updated_at || '').replace('T', ' ').slice(0, 16)}</span>
      </div>
      <a href="/admin/edit/${encodeURIComponent(p.full_path)}" class="btn sm">ערוך</a>
    </div>`).join('') || '<p class="muted">אין דפים עדיין</p>';

  // The tool families as a colorful hub — same data that drives the nav, so
  // the dashboard can never advertise a tool that doesn't exist.
  const hubCards = ADMIN_NAV_GROUPS.filter(g => g.key !== 'home').map(g => `
    <div class="hub-card" style="--g:${g.color}">
      <div class="hub-card-title">${g.label}</div>
      <div class="hub-card-desc">${g.desc || ''}</div>
      <div class="hub-card-links">
        ${g.items.map(it => `<a href="${it.href}">${it.icon} ${it.label}</a>`).join('')}
      </div>
    </div>`).join('');

  const html = `
    ${adminNav('dashboard', 'דשבורד', '<a href="/admin/new" class="btn">+ דף חדש</a>')}
    <div class="container page-body" style="max-width:1080px">
      <div class="stat-grid" style="margin-bottom:26px">
        ${statCard(pages.length, 'דפים', '#2563eb')}
        ${statCard(published, 'פורסמו', '#059669')}
        ${statCard(drafts, 'טיוטות', '#f97316')}
        ${statCard(pending, 'שינויים ממתינים לפרסום', '#7c3aed')}
        ${statCard(mediaCount, 'קבצי מדיה', '#0d9488')}
        <a href="/admin/inbox" style="text-decoration:none">${statCard(unreadInbox, unreadInbox ? 'פניות חדשות 📬' : 'פניות חדשות', unreadInbox ? '#dc2626' : '#64748b')}</a>
      </div>
      <h3 class="hub-heading">ארגז הכלים</h3>
      <div class="hub-grid" style="margin-bottom:30px">${hubCards}</div>
      <div class="dash-split">
        <section>
          <h3 class="hub-heading">דפים אחרונים</h3>
          ${recent}
        </section>
        <section class="card" style="height:fit-content">
          <div class="card-head"><span class="ico">⚡</span>קיצורי דרך</div>
          <div class="stack" style="gap:8px">
            <a href="/admin/new" class="btn">+ דף חדש</a>
            <a href="/admin/import" class="btn secondary">📥 ייבוא דף קיים</a>
            <a href="/admin/chat" class="btn secondary">✨ לבנות עם AI</a>
            <form method="POST" action="/admin/build-redirect" style="margin:0">
              <button type="submit" class="btn publish" style="width:100%;justify-content:center">🚀 בנה את האתר</button>
            </form>
          </div>
        </section>
      </div>
    </div>
  `;
  res.send(layout(html, 'דשבורד', accentFor('dashboard')));
});

router.post('/admin/build-redirect', (req, res) => {
  try {
    exportAll();
    res.redirect('/admin/dashboard');
  } catch (e) {
    res.status(500).send('שגיאה בבנייה: ' + escapeAdmin(e.message));
  }
});

module.exports = router;
