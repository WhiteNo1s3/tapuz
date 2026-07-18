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
      `<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:#94a3b8;direction:ltr">` +
      `<span>${escapeAdmin(firstDay)}</span><span>${escapeAdmin(lastDay)}</span></div>`;

    // --- Top pages table (Hebrew paths shown decoded; the href stays raw) ---
    const showPath = (p) => { try { return decodeURIComponent(p); } catch (e) { return p; } };
    const topPagesRows = data.topPages.length
      ? data.topPages.map(p =>
          `<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9"><a href="${escapeAdmin(p.path)}" dir="ltr" target="_blank" style="color:#0f172a">${escapeAdmin(showPath(p.path))}</a></td>` +
          `<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;text-align:start;font-weight:600">${nf(p.views)}</td></tr>`
        ).join('')
      : `<tr><td colspan="2" style="padding:14px;color:#94a3b8;text-align:center">אין נתונים בטווח הזה</td></tr>`;

    // --- Top referrers table ---
    const refRows = data.topReferrers.length
      ? data.topReferrers.map(r =>
          `<tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9" dir="ltr">${escapeAdmin(r.host)}</td>` +
          `<td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-weight:600">${nf(r.views)}</td></tr>`
        ).join('')
      : `<tr><td colspan="2" style="padding:14px;color:#94a3b8;text-align:center">אין הפניות חיצוניות מזוהות (רוב התנועה ישירה)</td></tr>`;

    // --- Device breakdown meters ---
    const deviceTotal = data.devices.reduce((s, d) => s + d.views, 0) || 1;
    const deviceLabels = { mobile: 'נייד', tablet: 'טאבלט', desktop: 'מחשב', unknown: 'לא ידוע' };
    const deviceRows = data.devices.length
      ? data.devices.map(d => {
          const pct = Math.round((d.views * 100) / deviceTotal);
          return `<div style="margin-bottom:10px">` +
            `<div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:3px">` +
            `<span>${escapeAdmin(deviceLabels[d.device] || d.device)}</span><span style="color:#64748b">${pct}% · ${nf(d.views)}</span></div>` +
            `<div style="height:8px;background:#f1f5f9;border-radius:999px;overflow:hidden">` +
            `<div style="height:100%;width:${pct}%;background:var(--admin-accent)"></div></div></div>`;
        }).join('')
      : `<p style="color:#94a3b8;text-align:center;margin:14px 0">אין נתונים</p>`;

    const rangeTabs = RANGES.map(r =>
      `<a href="/admin/analytics?days=${r}" class="btn ${r === days ? '' : 'secondary'}" style="padding:6px 14px">${r} ימים</a>`
    ).join('');

    // ⬇ export row — every dashboard card as an Excel-ready CSV (v0.87)
    const csvLink = (what, label) =>
      `<a href="/admin/analytics.csv?what=${what}&days=${days}" style="color:#0891b2;text-decoration:none">${label}</a>`;
    const exportRow =
      `<div style="font-size:0.82rem;color:#64748b;margin-top:6px">⬇ ייצוא CSV: ` +
      [csvLink('daily', 'לפי יום'), csvLink('pages', 'דפים'), csvLink('referrers', 'מקורות'),
       csvLink('devices', 'מכשירים'), csvLink('conversions', 'המרות')].join(' · ') +
      `</div>`;

    const card = 'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px';

    // GA status strips
    const ga4Strip = ga4Id
      ? `<div style="background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;padding:8px 12px;border-radius:8px;font-size:0.85rem">Google Analytics פעיל: <code dir="ltr">${escapeAdmin(ga4Id)}</code> — מוזרק לכל דף ציבורי.</div>`
      : `<div style="background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;padding:8px 12px;border-radius:8px;font-size:0.85rem">Google Analytics לא מחובר. הוסף Measurement ID ב<a href="/admin/integrations">אינטגרציות</a>.</div>`;
    const fpStrip = fpEnabled
      ? ''
      : `<div style="background:#fffbeb;border:1px solid #fcd34d;color:#78350f;padding:8px 12px;border-radius:8px;font-size:0.85rem;margin-top:8px">האיסוף הפנימי כבוי — הנתונים למטה לא יתעדכנו. הפעל אותו ב<a href="/admin/integrations">אינטגרציות</a>.</div>`;

    const html = `
      ${adminNav('analytics', 'אנליטיקס')}
      <div class="container" style="padding-top:24px;padding-bottom:60px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:8px">
          <p style="color:#64748b;margin:0">סטטיסטיקות פרטיות שנאספות על-ידי Tapuz — ללא צד שלישי, ללא שמירת כתובות IP.</p>
          <div style="display:flex;gap:6px">${rangeTabs}</div>
        </div>
        ${exportRow}
        ${ga4Strip}${fpStrip}

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin:18px 0">
          <div style="${card}">
            <div style="font-size:0.8rem;color:#64748b">צפיות בדפים</div>
            <div style="font-size:2rem;font-weight:800;color:#0f172a">${nf(data.totals.views)}</div>
          </div>
          <div style="${card}">
            <div style="font-size:0.8rem;color:#64748b">מבקרים ייחודיים (מוערך)</div>
            <div style="font-size:2rem;font-weight:800;color:#0f172a">${nf(data.totals.visitors)}</div>
          </div>
          <div style="${card}">
            <div style="font-size:0.8rem;color:#64748b">פניות מטפסים</div>
            <div style="font-size:2rem;font-weight:800;color:#0f172a">${nf(data.conversions.total)}${
              data.conversions.rate != null && data.conversions.total
                ? ` <span style="font-size:0.95rem;font-weight:700;color:#059669">${(data.conversions.rate * 100).toFixed(1)}% המרה</span>`
                : ''
            }</div>
          </div>
          <div style="${card}">
            <div style="font-size:0.8rem;color:#64748b">טווח</div>
            <div style="font-size:2rem;font-weight:800;color:#0f172a">${days} <span style="font-size:1rem;font-weight:600;color:#64748b">ימים</span></div>
          </div>
        </div>

        ${data.conversions.pages.length ? `
        <div style="${card};margin-bottom:18px">
          <h3 style="margin:0 0 4px;font-size:1rem">המרות — טפסים מול צפיות</h3>
          <p style="margin:0 0 12px;color:#94a3b8;font-size:0.8rem">אילו דפים מייצרים פניות — <a href="/admin/inbox">כל הפניות בתיבה</a>.</p>
          <table style="width:100%;border-collapse:collapse;font-size:0.88rem">
            <thead><tr>
              <th style="text-align:start;padding:6px 8px;border-bottom:2px solid #e2e8f0;color:#64748b;font-size:0.8rem">דף</th>
              <th style="text-align:start;padding:6px 8px;border-bottom:2px solid #e2e8f0;color:#64748b;font-size:0.8rem">צפיות</th>
              <th style="text-align:start;padding:6px 8px;border-bottom:2px solid #e2e8f0;color:#64748b;font-size:0.8rem">פניות</th>
              <th style="text-align:start;padding:6px 8px;border-bottom:2px solid #e2e8f0;color:#64748b;font-size:0.8rem">המרה</th>
            </tr></thead>
            <tbody>${data.conversions.pages.map(c =>
              `<tr>
                <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${escapeAdmin(c.page)}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${nf(c.views)}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-weight:700">${nf(c.submissions)}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;color:${c.rate != null ? '#059669' : '#94a3b8'};font-weight:600">${
                  c.rate != null ? (c.rate * 100).toFixed(1) + '%' : '—'
                }</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>` : ''}

        <div style="${card};margin-bottom:18px">
          <h3 style="margin:0 0 12px;font-size:1rem">צפיות לפי יום</h3>
          ${chartSvg}
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px">
          <div style="${card}">
            <h3 style="margin:0 0 12px;font-size:1rem">הדפים המובילים</h3>
            <table style="width:100%;border-collapse:collapse;font-size:0.88rem"><tbody>${topPagesRows}</tbody></table>
          </div>
          <div style="${card}">
            <h3 style="margin:0 0 12px;font-size:1rem">מקורות הפניה מובילים</h3>
            <table style="width:100%;border-collapse:collapse;font-size:0.88rem"><tbody>${refRows}</tbody></table>
          </div>
          <div style="${card}">
            <h3 style="margin:0 0 12px;font-size:1rem">סוגי מכשירים</h3>
            ${deviceRows}
          </div>
        </div>

        <div style="${card};margin-top:18px;opacity:0.9">
          <h3 style="margin:0 0 8px;font-size:1rem">📥 קריאת נתוני Google Analytics בחזרה</h3>
          <p style="color:#64748b;font-size:0.88rem;margin:0 0 8px">שאיבת הנתונים מ-Google (GA Data API) אינה פעילה. סטטוס: <b>${escapeAdmin(gdaStatus.reason)}</b></p>
          <p style="color:#94a3b8;font-size:0.82rem;margin:0">להפעלה יש לספק קובץ Service Account ומזהה Property, ולהתקין את התלות. מדריך: <code dir="ltr">docs/analytics.md</code>.</p>
        </div>

        <p style="color:#94a3b8;font-size:0.8rem;margin-top:18px;line-height:1.6">
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
