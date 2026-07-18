'use strict';

/**
 * Site-wide SEO defaults — extracted to its own route module in v1.02
 * (docs/ARCHITECTURE.md's plan, third standalone-admin-page extraction
 * after team.js/v0.97 and integrations.js/v1.01). Per-page SEO lives in the
 * page builder itself (page properties); this is just the site-level
 * fallbacks: title pattern, default description, default og:image, and the
 * base URL that powers canonical/og:url/JSON-LD/sitemap absolute links.
 * Not requireAdmin — SEO settings are content-adjacent, same tier as theme
 * editing, already open to editors elsewhere.
 */

const express = require('express');
const { loadConfig, saveConfig } = require('../config');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');

const router = express.Router();

router.get('/admin/seo', (req, res) => {
  const config = loadConfig();
  const seo = config.seo || {};
  const html = `
    ${adminNav('seo', 'SEO')}
    <div class="container" style="padding-top:28px;max-width:620px;padding-bottom:60px">
      <p style="color:#64748b;margin-top:0">ברירות מחדל לכל האתר. לכל דף יש הגדרות SEO משלו — בבונה הדפים, לחיצה על רקע הקנבס פותחת את מאפייני הדף (כותרת, תיאור, og:image, אינדוקס).</p>
      <section style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px">
        <label style="display:block;font-weight:600;margin-bottom:4px">תבנית כותרת (title pattern)</label>
        <input id="seo-pattern" dir="ltr" value="${escapeAdmin(seo.titlePattern || '')}" placeholder="{page} · {site}" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px;box-sizing:border-box">
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:14px">‎{page}‎ = כותרת הדף · ‎{site}‎ = שם האתר · ריק = כותרת הדף בלבד</div>
        <label style="display:block;font-weight:600;margin-bottom:4px">תיאור ברירת מחדל (meta description)</label>
        <textarea id="seo-desc" rows="2" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px;box-sizing:border-box">${escapeAdmin(config.description)}</textarea>
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:14px">משמש כשלדף אין תיאור משלו</div>
        <label style="display:block;font-weight:600;margin-bottom:4px">תמונת שיתוף ברירת מחדל (og:image)</label>
        <div style="display:flex;gap:8px;margin-bottom:6px">
          <input id="seo-og" dir="ltr" value="${escapeAdmin(seo.defaultOgImage || '')}" placeholder="בחרו מהספרייה ←" style="flex:1;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;box-sizing:border-box">
          <button type="button" class="btn secondary" data-media-pick="seo-og" style="white-space:nowrap">🖼 בחר / העלה</button>
        </div>
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:14px">התמונה שתופיע בשיתוף ברשתות כשלדף אין תמונה משלו.</div>
        <label style="display:block;font-weight:600;margin-bottom:4px">כתובת האתר (base URL)</label>
        <input id="seo-base" dir="ltr" value="${escapeAdmin(config.baseUrl || '')}" placeholder="https://www.example.co.il" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:6px;box-sizing:border-box">
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:14px">מפעיל canonical / og:url / נתונים מובנים (JSON-LD) עם כתובות מלאות, וקובע את הכתובות ב-sitemap.xml. ריק = מדלגים על תגיות שדורשות כתובת מלאה.</div>
        <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
          <span id="seo-status" style="color:#166534;font-size:0.85rem"></span>
          <button type="button" class="btn" id="seo-save">שמור SEO</button>
        </div>
      </section>
    </div>
    <script src="/admin-media-picker.js"></script>
    <script>
      document.getElementById('seo-save').addEventListener('click', function () {
        fetch('/admin/api/seo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titlePattern: document.getElementById('seo-pattern').value,
            description: document.getElementById('seo-desc').value,
            defaultOgImage: document.getElementById('seo-og').value,
            baseUrl: document.getElementById('seo-base').value
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          document.getElementById('seo-status').textContent = d.ok ? 'נשמר ✓' : (d.error || 'שגיאה');
        });
      });
    </script>
  `;
  res.send(layout(html, 'SEO', accentFor('seo')));
});

router.get('/admin/api/seo', (req, res) => {
  try {
    const config = loadConfig();
    res.json({ ok: true, seo: config.seo || {}, description: config.description || '', baseUrl: config.baseUrl || '' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/seo', (req, res) => {
  try {
    const config = loadConfig();
    const b = req.body || {};
    config.seo = config.seo || {};
    if (b.titlePattern !== undefined) config.seo.titlePattern = String(b.titlePattern || '');
    if (b.defaultOgImage !== undefined) config.seo.defaultOgImage = String(b.defaultOgImage || '');
    if (b.description !== undefined) config.description = String(b.description || '');
    // site base URL (v0.71): powers canonical/og:url/JSON-LD absolute URLs +
    // sitemap <loc>. Stored at config level (robots/sitemap already read it).
    // Forgiving: a schemeless domain gets https:// ; anything unparseable is
    // rejected — a broken base would corrupt canonicals sitewide.
    if (b.baseUrl !== undefined) {
      const raw = String(b.baseUrl || '').trim();
      if (!raw) {
        config.baseUrl = '';
      } else {
        let u;
        try { u = new URL(raw.includes('://') ? raw : 'https://' + raw); } catch (e) { u = null; }
        if (!u || !/^https?:$/.test(u.protocol)) {
          return res.status(400).json({ ok: false, error: 'כתובת האתר אינה תקינה — צורה תקינה: https://www.example.co.il' });
        }
        config.baseUrl = (u.origin + u.pathname).replace(/\/+$/, '');
      }
    }
    saveConfig(config);
    res.json({ ok: true, seo: config.seo });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
