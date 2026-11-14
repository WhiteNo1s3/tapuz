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
const auth = require('../auth');
const { loadConfig, configState, CONFIG_DAMAGED_MESSAGE } = require('../config');
const { requestOrigin, isLoopbackRequest } = require('../http-util');

const router = express.Router();

/** The https address the owner is browsing from, or '' when it is not https. */
function httpsOriginHere(req) {
  const origin = requestOrigin(req);
  if (origin.startsWith('https://')) return origin;
  // the proxy's own word when it is not a counted, trusted hop — good enough
  // to decide whether to OFFER a button (the save re-checks the real origin)
  if (auth.isHttps(req) && req.headers.host) return 'https://' + req.headers.host;
  return '';
}

/**
 * What the owner should hear before anything else on the admin's landing
 * screens (v2.69): a damaged site.json, and a site address that was never
 * set. Nothing ever asked for the base URL, yet the canonical link, og:url,
 * absolute share images, the sitemap's scheme and the card gateway all hang
 * on it — so the line comes with a button that saves the address the owner
 * is already on (https only) and rebuilds. Used by the dashboard and by the
 * pages list (the screen a login lands on).
 */
function siteNotices(req) {
  const out = [];
  const state = configState();
  if (state.state === 'corrupt') {
    out.push(`<div class="notice danger">
        <span class="notice-ico">⚠️</span>
        <div class="notice-body">
          <strong>קובץ הגדרות האתר פגום</strong>
          <p>${escapeAdmin(CONFIG_DAMAGED_MESSAGE)}</p>
          <p>עותק של הקובץ הפגום נשמר לידו בשם <span dir="ltr" style="white-space:nowrap">site.json.corrupt-…</span></p>
        </div>
      </div>`);
    return out.join('');
  }
  const flash = {
    saved: ['ok', '✓', 'כתובת האתר נשמרה והאתר נבנה מחדש.'],
    kept: ['info', 'ℹ️', 'כתובת האתר כבר מוגדרת — לא שונה דבר.'],
    norebuild: ['warn', '⚠️', 'כתובת האתר נשמרה, אבל האתר לא נבנה מחדש. לחצו "בנה את האתר" למטה.'],
    http: ['warn', '⚠️', 'אתם גולשים כרגע בלי https, ולכן הכתובת לא נשמרה. קבעו אותה ידנית במסך ה-SEO.'],
    failed: ['danger', '⚠️', 'שמירת כתובת האתר נכשלה. נסו שוב ממסך ה-SEO.']
  }[String(req.query.base || '')];
  if (flash) {
    out.push(`<div class="notice slim ${flash[0]}"><span class="notice-ico">${flash[1]}</span><div class="notice-body"><p>${flash[2]}</p></div></div>`);
  }
  // not on the server's own machine: http://localhost has no public address
  // to set, and a warning that can never be answered is noise
  if (!String(loadConfig().baseUrl || '').trim() && !isLoopbackRequest(req)) {
    const here = httpsOriginHere(req);
    const action = here
      ? `<form method="POST" action="/admin/seo/base-url-here" style="margin:0">
             <button type="submit" class="btn sm">קבע את <span dir="ltr">${escapeAdmin(here)}</span> ככתובת האתר</button>
           </form>`
      : '<a href="/admin/seo" class="btn secondary sm">הגדרה במסך ה-SEO</a>';
    // With no address saved the sitemap takes its scheme from the request,
    // and behind a TLS proxy nobody declared (TAPUZ_TRUST_PROXY unset) that
    // scheme is http — on an https site. Said only where it is true: the
    // owner is on https by the proxy's word and the origin still reads http.
    const sitemapHttp = here && !requestOrigin(req).startsWith('https://')
      ? ' עד שהכתובת נשמרת, גם מפת האתר (<span dir="ltr">sitemap.xml</span>) מדפיסה כתובות <span dir="ltr">http://</span>.'
      : '';
    out.push(`<div class="notice warn">
        <span class="notice-ico">🌐</span>
        <div class="notice-body">
          <p>כתובת האתר עוד לא הוגדרה: בלי זה אין קישור קנוני, ותמונות שיתוף לא יוצגו.${sitemapHttp}</p>
          <div class="row">${action}</div>
        </div>
      </div>`);
  }
  return out.join('');
}

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
      ${siteNotices(req)}
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
// the pages list (routes/admin-home.js) prints the same notices
module.exports.siteNotices = siteNotices;
