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
    <div class="stat-card" style="--c:${color}">
      <div class="stat-num">${num}</div>
      <div class="stat-label">${label}</div>
    </div>`;

  const recent = pages.slice(0, 5).map(p => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:6px;background:#fff">
      <div>
        <strong>${escapeAdmin(p.title)}</strong>
        <span style="font-size:0.75rem;color:#94a3b8;margin-inline-start:8px">${String(p.updated_at || '').replace('T', ' ').slice(0, 16)}</span>
      </div>
      <a href="/admin/edit/${encodeURIComponent(p.full_path)}" class="btn" style="padding:6px 14px">ערוך</a>
    </div>`).join('') || '<p style="color:#64748b">אין דפים עדיין</p>';

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
    <style>
      .stat-card {
        background: linear-gradient(160deg, color-mix(in srgb, var(--c) 10%, #fff), #fff 60%);
        border: 1px solid color-mix(in srgb, var(--c) 22%, #fff);
        border-radius: 14px;
        padding: 18px 20px;
        text-align: center;
      }
      .stat-num { font-size: 2rem; font-weight: 800; color: var(--c); }
      .stat-label { color: #64748b; font-size: 0.88rem; margin-top: 4px; }
      .hub-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 14px;
        margin-bottom: 30px;
      }
      .hub-card {
        background: #fff;
        border: 1px solid #e2e8f0;
        border-top: 4px solid var(--g);
        border-radius: 14px;
        padding: 16px 18px;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
        transition: box-shadow .15s, transform .15s;
      }
      .hub-card:hover { box-shadow: 0 8px 24px rgba(15, 23, 42, 0.09); transform: translateY(-2px); }
      .hub-card-title { font-weight: 800; color: var(--g); font-size: 1.02rem; }
      .hub-card-desc { color: #64748b; font-size: 0.82rem; margin: 4px 0 12px; }
      .hub-card-links { display: flex; flex-wrap: wrap; gap: 6px; }
      .hub-card-links a {
        text-decoration: none;
        font-size: 0.84rem;
        font-weight: 600;
        color: #334155;
        background: color-mix(in srgb, var(--g) 8%, #fff);
        border: 1px solid color-mix(in srgb, var(--g) 18%, #fff);
        border-radius: 999px;
        padding: 5px 12px;
        transition: background .12s, color .12s;
      }
      .hub-card-links a:hover { background: var(--g); color: #fff; }
    </style>
    <div class="container" style="padding-top:28px;max-width:1080px;padding-bottom:60px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:26px">
        ${statCard(pages.length, 'דפים', '#2563eb')}
        ${statCard(published, 'פורסמו', '#059669')}
        ${statCard(drafts, 'טיוטות', '#f97316')}
        ${statCard(pending, 'שינויים ממתינים לפרסום', '#7c3aed')}
        ${statCard(mediaCount, 'קבצי מדיה', '#0d9488')}
        <a href="/admin/inbox" style="text-decoration:none">${statCard(unreadInbox, unreadInbox ? 'פניות חדשות 📬' : 'פניות חדשות', unreadInbox ? '#dc2626' : '#64748b')}</a>
      </div>
      <h3 style="margin:0 0 12px">ארגז הכלים</h3>
      <div class="hub-grid">${hubCards}</div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
        <section>
          <h3 style="margin-top:0">דפים אחרונים</h3>
          ${recent}
        </section>
        <section style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;height:fit-content">
          <h3 style="margin-top:0">קיצורי דרך</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="/admin/new" class="btn">+ דף חדש</a>
            <a href="/admin/import" class="btn secondary">📥 ייבוא דף קיים</a>
            <a href="/admin/chat" class="btn secondary">✨ לבנות עם AI</a>
            <form method="POST" action="/admin/build-redirect" style="margin:0">
              <button type="submit" class="btn" style="background:#059669;width:100%">🚀 בנה את האתר</button>
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
