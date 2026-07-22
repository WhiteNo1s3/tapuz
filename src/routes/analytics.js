'use strict';

/**
 * Analytics dashboard — the eleventh route-group extraction. One cohesive
 * admin page (CSV export + the dashboard itself: per-day chart, top pages/
 * referrers, device breakdown, conversion-by-page). Not gated by
 * requireAdmin, matching every other reporting/settings page. The pageview
 * COLLECTION endpoint (`/_tapuz/collect`, public-facing) stays in
 * server.js — it's a different concern (write path vs. this read/report
 * path) and `analytics.recordPageview`/`isBot` are used nowhere near here.
 */

const express = require('express');
const analytics = require('../analytics');
const gaData = require('../ga-data');
const { loadConfig } = require('../config');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');

const router = express.Router();

router.get('/admin/analytics.csv', (req, res) => {
  const { csvTable } = require('../csv');
  const t = analytics.exportTable(String(req.query.what || 'daily'), req.query.days);
  if (!t) {
    return res.status(400).json({
      ok: false, error: 'unknown table',
      tables: ['daily', 'pages', 'referrers', 'devices', 'conversions']
    });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tapuz-analytics-${t.name}-${stamp}.csv"`);
  res.send(csvTable(t.head, t.rows));
});

router.get('/admin/analytics', (req, res) => {
  try {
    const RANGES = [7, 30, 90];
    let days = parseInt(req.query.days, 10);
    if (!RANGES.includes(days)) days = 30;
    const data = analytics.dashboardData(days);
    const cfg = loadConfig();
    const ga4Id = (cfg.analytics && cfg.analytics.ga4 && cfg.analytics.ga4.measurementId) || '';
    const fpEnabled = !!(cfg.analytics && cfg.analytics.firstParty && cfg.analytics.firstParty.enabled);
    const gdaStatus = gaData.status();

    const nf = (n) => Number(n || 0).toLocaleString('he-IL');
    const maxViews = Math.max(1, ...data.byDay.map(d => d.views));

    // --- Per-day bar chart (inline SVG, RTL: newest on the right) ---
    const W = 720, H = 180, padB = 22, padT = 8;
    const n = data.byDay.length;
    const gap = n > 60 ? 1 : 2;
    const bw = Math.max(2, (W - (n - 1) * gap) / n);
    const bars = data.byDay.map((d, i) => {
      const h = Math.round(((H - padB - padT) * d.views) / maxViews);
      const x = Math.round(i * (bw + gap));
      const y = H - padB - h;
      const title = `${d.day}: ${d.views} צפיות, ${d.visitors} מבקרים`;
      return `<rect x="${x}" y="${y}" width="${bw.toFixed(2)}" height="${Math.max(h, d.views ? 1 : 0)}" rx="1.5" fill="var(--admin-accent)"><title>${escapeAdmin(title)}</title></rect>`;
    }).join('');
    const firstDay = data.byDay[0] ? data.byDay[0].day : '';
    const lastDay = data.byDay[n - 1] ? data.byDay[n - 1].day : '';
    const chartSvg =
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:200px;direction:ltr">` +
      `<line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="#e2e8f0" stroke-width="1"/>` +
      bars +
      `</svg>` +
      `<div class="chart-axis"><span>${escapeAdmin(firstDay)}</span><span>${escapeAdmin(lastDay)}</span></div>`;

    // --- Top pages table (Hebrew paths shown decoded; the href stays raw) ---
    const showPath = (p) => { try { return decodeURIComponent(p); } catch (e) { return p; } };
    const topPagesRows = data.topPages.length
      ? data.topPages.map(p =>
          `<tr><td><a href="${escapeAdmin(p.path)}" dir="ltr" target="_blank">${escapeAdmin(showPath(p.path))}</a></td>` +
          `<td style="font-weight:600">${nf(p.views)}</td></tr>`
        ).join('')
      : `<tr><td colspan="2" class="tbl-empty">אין נתונים בטווח הזה</td></tr>`;

    // --- Top referrers table ---
    const refRows = data.topReferrers.length
      ? data.topReferrers.map(r =>
          `<tr><td dir="ltr">${escapeAdmin(r.host)}</td>` +
          `<td style="font-weight:600">${nf(r.views)}</td></tr>`
        ).join('')
      : `<tr><td colspan="2" class="tbl-empty">אין הפניות חיצוניות מזוהות (רוב התנועה ישירה)</td></tr>`;

    // --- Device breakdown meters ---
    const deviceTotal = data.devices.reduce((s, d) => s + d.views, 0) || 1;
    const deviceLabels = { mobile: 'נייד', tablet: 'טאבלט', desktop: 'מחשב', unknown: 'לא ידוע' };
    const deviceRows = data.devices.length
      ? data.devices.map(d => {
          const pct = Math.round((d.views * 100) / deviceTotal);
          return `<div class="meter">` +
            `<div class="meter-top"><span>${escapeAdmin(deviceLabels[d.device] || d.device)}</span>` +
            `<span class="muted">${pct}% · ${nf(d.views)}</span></div>` +
            `<div class="meter-track"><div class="meter-fill" style="width:${pct}%"></div></div></div>`;
        }).join('')
      : `<p class="faint" style="text-align:center;margin:14px 0">אין נתונים</p>`;

    const rangeTabs = RANGES.map(r =>
      `<a href="/admin/analytics?days=${r}" class="btn sm ${r === days ? '' : 'secondary'}">${r} ימים</a>`
    ).join('');

    // ⬇ export row — every dashboard card as an Excel-ready CSV (v0.87)
    const csvLink = (what, label) =>
      `<a href="/admin/analytics.csv?what=${what}&days=${days}">${label}</a>`;
    const exportRow =
      `<div class="faint export-row">⬇ ייצוא CSV: ` +
      [csvLink('daily', 'לפי יום'), csvLink('pages', 'דפים'), csvLink('referrers', 'מקורות'),
       csvLink('devices', 'מכשירים'), csvLink('conversions', 'המרות')].join(' · ') +
      `</div>`;

    // GA status strips
    const ga4Strip = ga4Id
      ? `<div class="notice slim ok">Google Analytics פעיל: <code dir="ltr">${escapeAdmin(ga4Id)}</code> — מוזרק לכל דף ציבורי.</div>`
      : `<div class="notice slim neutral">Google Analytics לא מחובר. הוסף Measurement ID ב<a href="/admin/integrations">אינטגרציות</a>.</div>`;
    const fpStrip = fpEnabled
      ? ''
      : `<div class="notice slim warn">האיסוף הפנימי כבוי — הנתונים למטה לא יתעדכנו. הפעל אותו ב<a href="/admin/integrations">אינטגרציות</a>.</div>`;

    const html = `
      ${adminNav('analytics', 'אנליטיקס')}
      <div class="container page-body">
        <div class="row between" style="margin-bottom:8px">
          <p class="lead" style="margin:0">סטטיסטיקות פרטיות שנאספות על-ידי Tapuz — ללא צד שלישי, ללא שמירת כתובות IP.</p>
          <div class="seg">${rangeTabs}</div>
        </div>
        ${exportRow}
        ${ga4Strip}${fpStrip}

        <div class="stat-grid" style="margin:18px 0">
          <div class="stat">
            <div class="stat-label">צפיות בדפים</div>
            <div class="stat-num">${nf(data.totals.views)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">מבקרים ייחודיים (מוערך)</div>
            <div class="stat-num">${nf(data.totals.visitors)}</div>
          </div>
          <div class="stat">
            <div class="stat-label">פניות מטפסים</div>
            <div class="stat-num">${nf(data.conversions.total)}${
              data.conversions.rate != null && data.conversions.total
                ? ` <span class="stat-delta">${(data.conversions.rate * 100).toFixed(1)}% המרה</span>`
                : ''
            }</div>
          </div>
          <div class="stat">
            <div class="stat-label">טווח</div>
            <div class="stat-num">${days} <small>ימים</small></div>
          </div>
        </div>

        ${data.conversions.pages.length ? `
        <div class="card">
          <div class="sub-head">המרות — טפסים מול צפיות</div>
          <p class="faint" style="margin:-6px 0 12px">אילו דפים מייצרים פניות — <a href="/admin/inbox">כל הפניות בתיבה</a>.</p>
          <table class="tbl">
            <thead><tr><th>דף</th><th>צפיות</th><th>פניות</th><th>המרה</th></tr></thead>
            <tbody>${data.conversions.pages.map(c =>
              `<tr>
                <td>${escapeAdmin(c.page)}</td>
                <td>${nf(c.views)}</td>
                <td style="font-weight:700">${nf(c.submissions)}</td>
                <td class="${c.rate != null ? 'rate-good' : 'faint'}" style="font-weight:600">${
                  c.rate != null ? (c.rate * 100).toFixed(1) + '%' : '—'
                }</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>` : ''}

        <div class="card">
          <div class="sub-head">צפיות לפי יום</div>
          ${chartSvg}
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="sub-head">הדפים המובילים</div>
            <table class="tbl"><tbody>${topPagesRows}</tbody></table>
          </div>
          <div class="card">
            <div class="sub-head">מקורות הפניה מובילים</div>
            <table class="tbl"><tbody>${refRows}</tbody></table>
          </div>
          <div class="card">
            <div class="sub-head">סוגי מכשירים</div>
            ${deviceRows}
          </div>
        </div>

        <div class="card" style="margin-top:18px;opacity:0.9">
          <div class="sub-head">📥 קריאת נתוני Google Analytics בחזרה</div>
          <p class="muted" style="font-size:0.88rem;margin:0 0 8px">שאיבת הנתונים מ-Google (GA Data API) אינה פעילה. סטטוס: <b>${escapeAdmin(gdaStatus.reason)}</b></p>
          <p class="faint" style="margin:0">להפעלה יש לספק קובץ Service Account ומזהה Property, ולהתקין את התלות. מדריך: <code dir="ltr">docs/analytics.md</code>.</p>
        </div>

        <p class="faint" style="margin-top:18px;line-height:1.6">
          פרטיות: לכל צפייה נשמרים רק הנתיב, מארח ההפניה (ללא כתובת מלאה), סוג המכשיר, וחתימת מבקר מגובבת (HMAC עם מלח יומי מתחלף). כתובת ה-IP המלאה לעולם לא נשמרת. אתרים סטטיים שיוצאו ומתארחים מחוץ ל-Tapuz רושמים נתונים רק כאשר שרת Tapuz זמין בכתובת האספן.
        </p>
      </div>
    `;
    res.send(layout(html, 'אנליטיקס', accentFor('analytics')));
  } catch (e) {
    res.status(500).send('שגיאה בטעינת אנליטיקס: ' + escapeAdmin(e.message));
  }
});

module.exports = router;
