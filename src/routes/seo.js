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
const { loadConfig, saveConfig, normalizeBaseUrl } = require('../config');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');
const { requestOrigin, logError } = require('../http-util');

const router = express.Router();

router.get('/admin/seo', (req, res) => {
  const config = loadConfig();
  const seo = config.seo || {};
  const html = `
    ${adminNav('seo', 'SEO')}
    <div class="container page-body" style="max-width:620px">
      <p class="lead">ברירות מחדל לכל האתר. לכל דף יש הגדרות SEO משלו — בבונה הדפים, לחיצה על רקע הקנבס פותחת את מאפייני הדף (כותרת, תיאור, og:image, אינדוקס).</p>
      <section class="card lead-card">
        <div class="card-head"><span class="ico">🔤</span>איך הדף נקרא בגוגל</div>
        <label class="field-label">תבנית כותרת (title pattern)</label>
        <input id="seo-pattern" dir="ltr" value="${escapeAdmin(seo.titlePattern || '')}" placeholder="{page} · {site}" class="input">
        <div class="faint" style="margin-bottom:14px">‎{page}‎ = כותרת הדף · ‎{site}‎ = שם האתר · ריק = כותרת הדף בלבד</div>
        <label class="field-label">תיאור ברירת מחדל (meta description)</label>
        <textarea id="seo-desc" rows="2" class="input">${escapeAdmin(config.description)}</textarea>
        <div class="faint">משמש כשלדף אין תיאור משלו</div>
      </section>

      <section class="card">
        <div class="card-head"><span class="ico">🔗</span>איך הדף נראה בשיתוף</div>
        <label class="field-label">תמונת שיתוף ברירת מחדל (og:image)</label>
        <div class="row" style="margin-bottom:6px;flex-wrap:nowrap">
          <input id="seo-og" dir="ltr" value="${escapeAdmin(seo.defaultOgImage || '')}" placeholder="בחרו מהספרייה ←" class="input">
          <button type="button" class="btn secondary" data-media-pick="seo-og" style="white-space:nowrap">🖼 בחר / העלה</button>
        </div>
        <div class="faint">התמונה שתופיע בוואטסאפ, פייסבוק וטוויטר כשלדף אין תמונה משלו.</div>
      </section>

      <section class="card">
        <div class="card-head"><span class="ico">🌐</span>כתובת האתר<span class="card-head-sub">הבסיס לכל השאר</span></div>
        <label class="field-label">כתובת האתר (base URL)</label>
        <input id="seo-base" dir="ltr" value="${escapeAdmin(config.baseUrl || '')}" placeholder="https://www.example.co.il" class="input">
        <div class="faint">מפעיל canonical / og:url / נתונים מובנים (JSON-LD) עם כתובות מלאות, וקובע את הכתובות ב-sitemap.xml. ריק = מדלגים על תגיות שדורשות כתובת מלאה.</div>
      </section>

      <div class="row end">
        <span id="seo-status" class="ok-text"></span>
        <button type="button" class="btn" id="seo-save">שמור SEO</button>
      </div>
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
          var st = document.getElementById('seo-status');
          if (!d.ok) { st.textContent = d.error || 'שגיאה'; return; }
          if (typeof d.baseUrl === 'string') document.getElementById('seo-base').value = d.baseUrl;
          st.textContent = d.rebuildError ? ('נשמר, אבל האתר לא נבנה מחדש: ' + d.rebuildError) : 'נשמר ✓ האתר עודכן';
        }).catch(function () { document.getElementById('seo-status').textContent = 'שגיאת רשת'; });
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
    // (v2.69: the rule itself lives in config.normalizeBaseUrl — the site
    // settings screen saves the same field and now goes through the same door.)
    if (b.baseUrl !== undefined) {
      const base = normalizeBaseUrl(b.baseUrl);
      if (!base.ok) return res.status(400).json({ ok: false, error: base.error });
      config.baseUrl = base.value;
    }
    saveConfig(config);
    // The title pattern, the default share image and the base URL are printed
    // into every exported page's <head>; without a rebuild "נשמר ✓" was true
    // of site.json and of nothing a visitor or a search engine could see.
    const rebuildError = require('../rebuild').rebuildSite('an SEO save');
    res.json({ ok: true, seo: config.seo, baseUrl: config.baseUrl || '', rebuildError });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// The dashboard's one-click answer to "the site address was never set"
// (routes/dashboard.js prints the line): save the origin the owner is
// browsing from — https only, through the same validated door — and rebuild.
// A form POST, so it works from a plain button and returns to the dashboard.
router.post('/admin/seo/base-url-here', (req, res) => {
  const back = (flag) => res.redirect('/admin/dashboard?base=' + flag);
  try {
    const config = loadConfig();
    if (config.baseUrl) return back('kept');
    const origin = browsingOrigin(req);
    if (!origin) return back('http');
    const base = normalizeBaseUrl(origin);
    if (!base.ok || !base.value) return back('http');
    config.baseUrl = base.value;
    saveConfig(config);
    const rebuildError = require('../rebuild').rebuildSite('the base URL');
    return back(rebuildError ? 'norebuild' : 'saved');
  } catch (e) {
    logError(req, e);
    return back('failed');
  }
});

/**
 * The https origin the owner's browser is on, or '' when it is not https.
 * The browser's own Origin header says it exactly (the admin gate already
 * proved it matches this host); requestOrigin is the fallback for a browser
 * that sent only a Referer.
 */
function browsingOrigin(req) {
  const candidates = [String(req.headers.origin || ''), requestOrigin(req)];
  for (const c of candidates) {
    try {
      const u = new URL(c);
      if (u.protocol === 'https:' && u.host === req.headers.host) return u.origin;
    } catch (e) { /* not an address */ }
  }
  return '';
}

module.exports = router;
