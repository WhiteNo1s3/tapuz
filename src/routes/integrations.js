'use strict';

/**
 * Integrations & lead notifications — extracted to their own route module in
 * v1.01 (docs/ARCHITECTURE.md's plan, third route-group extraction after
 * routes/team.js in v0.97). Everything shown/edited on /admin/integrations:
 * WhatsApp float, site search toggle (v0.98), lead email notifications
 * (v0.94), Google Analytics 4 + first-party analytics + the disabled GA
 * Data API skeleton. Admin-only (requireAdmin) — SMTP credentials, GA
 * config, and the search toggle are all site-level settings.
 */

const express = require('express');
const { loadConfig, saveConfig } = require('../config');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');
const { requireAdmin } = require('../admin-guard');

const router = express.Router();

router.get('/admin/integrations', requireAdmin, (req, res) => {
  const config = loadConfig();
  const wa = (config.integrations && config.integrations.whatsapp) || {};
  const an = config.analytics || {};
  const ga4 = an.ga4 || {};
  const fp = an.firstParty || {};
  const gda = an.gaDataApi || {};
  const nf = require('../notify').getSettings();
  const srch = (config.integrations && config.integrations.search) || {};
  const html = `
    ${adminNav('integrations', 'אינטגרציות')}
    <div class="container page-body" style="max-width:620px">
      <p class="lead">חיבורים מוכנים — בלי לכתוב HTML. מודול המפה (Google Maps) נמצא בארגז הכלים של בונה הדפים.</p>

      <section class="card">
        <h3 class="sub-head">💬 WhatsApp — כפתור צ׳אט צף</h3>
        <p class="lead">כפתור ירוק צף שמופיע בכל דפי האתר הציבורי ופותח שיחת WhatsApp. לא מופיע בממשק הניהול.</p>
        <label class="check-row">
          <input type="checkbox" id="wa-enabled" ${wa.enabled ? 'checked' : ''}> הפעל את הכפתור באתר
        </label>
        <label class="field-label">מספר טלפון (בפורמט בינלאומי)</label>
        <input id="wa-phone" dir="ltr" value="${escapeAdmin(wa.phone || '')}" placeholder="972501234567" class="input mb">
        <label class="field-label">הודעה פותחת (לא חובה)</label>
        <input id="wa-message" value="${escapeAdmin(wa.message || '')}" placeholder="היי! הגעתי מהאתר" class="input mb">
        <label class="field-label">מיקום הכפתור</label>
        <select id="wa-position" class="input mb">
          <option value="start" ${wa.position !== 'end' ? 'selected' : ''}>התחלה (ימין בדף עברי)</option>
          <option value="end" ${wa.position === 'end' ? 'selected' : ''}>סוף (שמאל בדף עברי)</option>
        </select>
        <div class="row end">
          <span id="int-status" class="ok-text"></span>
          <button type="button" class="btn" id="int-save">שמור אינטגרציות</button>
        </div>
        <div class="faint" style="margin-top:10px">השינוי נכנס לתוקף באתר אחרי "בנה אתר" (או פרסום + בנייה מהבונה).</div>
      </section>

      <section class="card">
        <h3 class="sub-head">🔎 חיפוש באתר</h3>
        <p class="lead">כפתור חיפוש צף שמופיע בכל דפי האתר — מחפש בכותרות ובתקצירים של כל הדפים המפורסמים, בצד הלקוח, בלי שרת נוסף. אין ייצוא סטטי? החיפוש לא יעבוד עד ל"בנה אתר" הבא.</p>
        <label class="check-row">
          <input type="checkbox" id="srch-enabled" ${srch.enabled ? 'checked' : ''}> הפעל כפתור חיפוש באתר
        </label>
        <div class="faint" style="margin-top:10px">השינוי נכנס לתוקף באתר אחרי "בנה אתר" (או פרסום + בנייה מהבונה) — זה הרגע שבו אינדקס החיפוש נכתב.</div>
      </section>

      <section class="card">
        <h3 class="sub-head">📧 מייל (SMTP) — קמפיינים + התראות</h3>
        <p class="lead">
          שרת SMTP אחד משרת גם <strong>קמפייני CRM</strong> וגם <strong>התראה על פנייה חדשה</strong>.
          הסיסמה נשמרת מקומית בלבד (לא ב־site.json, לא חוזרת ב־API).
        </p>
        <p class="muted" style="font-size:.88rem">
          סטטוס:
          ${nf.smtpReady
            ? `<span style="color:#047857">SMTP מוכן לקמפיינים</span> · נשלחו היום ${Number(nf.sentToday) || 0}/${Number(nf.maxPerDay) || 500}`
            : '<span style="color:#b45309">SMTP לא מוכן — חסר מארח/משתמש/סיסמה או כבוי</span>'}
          ${nf.leadReady ? ' · התראות פניות: מוכן' : ' · התראות פניות: חסר אימייל יעד'}
        </p>
        <label class="check-row">
          <input type="checkbox" id="nf-enabled" ${nf.enabled ? 'checked' : ''}> הפעל שליחת מייל (SMTP)
        </label>
        <label class="field-label">אימייל לקבלת התראות על פניות (לא חובה לקמפיינים)</label>
        <input id="nf-to" dir="ltr" value="${escapeAdmin(nf.to || '')}" placeholder="owner@example.com" class="input mb">
        <label class="field-label">אימייל שולח (From — אופציונלי)</label>
        <input id="nf-from" dir="ltr" value="${escapeAdmin(nf.from || '')}" placeholder="site@example.com" class="input mb">
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:14px">
          <div>
            <label class="field-label">שרת SMTP</label>
            <input id="nf-host" dir="ltr" value="${escapeAdmin(nf.host || '')}" placeholder="smtp.gmail.com" class="input">
          </div>
          <div>
            <label class="field-label">פורט</label>
            <input id="nf-port" dir="ltr" type="number" value="${Number(nf.port) || 587}" class="input">
          </div>
        </div>
        <label class="field-label">שם משתמש</label>
        <input id="nf-user" dir="ltr" value="${escapeAdmin(nf.user || '')}" placeholder="user@example.com" class="input mb">
        <label class="field-label">סיסמה${nf.hasPass ? ' (מוגדרת — השאירו ריק כדי לשמור)' : ''}</label>
        <input id="nf-pass" dir="ltr" type="password" placeholder="${nf.hasPass ? '••••••••' : ''}" class="input">
        <label class="field-label">מקסימום הודעות ביום (הגנת מוניטין)</label>
        <input id="nf-maxday" dir="ltr" type="number" min="1" max="50000" value="${Number(nf.maxPerDay) || 500}" class="input mb">
        <label class="check-row">
          <input type="checkbox" id="nf-secure" ${nf.secure ? 'checked' : ''}> חיבור מאובטח (SSL — לרוב פורט 465)
        </label>
        <label class="check-row">
          <input type="checkbox" id="nf-insecure-tls" ${nf.tlsAllowInsecure ? 'checked' : ''}>
          אפשר תעודת TLS לא מאומתת (רק מעבדה — לא לפרודקשן)
        </label>
        <div class="row end">
          <span id="nf-status" class="ok-text"></span>
          <button type="button" class="btn" id="nf-verify" style="background:#fff;color:#0f172a;border:1.5px solid #cbd5e1">בדוק חיבור</button>
          <button type="button" class="btn" id="nf-test" style="background:#fff;color:#f97316;border:1.5px solid #f97316">שלח בדיקה</button>
          <button type="button" class="btn" id="nf-save">שמור מייל</button>
        </div>
      </section>

      <section class="card">
        <h3 class="sub-head">📍 Google Maps — מודול מפה</h3>
        <p style="color:#64748b;font-size:0.9rem;margin:0">זמין בארגז הכלים של בונה הדפים (קטגוריית "שילובים"): כתובת + זום + גובה — בלי מפתח API ובלי קוד. <a href="/admin">פתח דף לעריכה</a> וגרור את מודול "מפה".</p>
      </section>

      <section class="card">
        <h3 class="sub-head">📊 Google Analytics 4</h3>
        <p class="lead">מזהה מדידה (Measurement ID) בפורמט <code dir="ltr">G-XXXXXXXXXX</code>. הוא ציבורי (לא סוד), ומוזרק לכל דפי האתר הציבורי — כך Google אוסף נתונים. השינוי נכנס לתוקף אחרי "בנה אתר".</p>
        <label class="field-label">Measurement ID</label>
        <input id="ga4-id" dir="ltr" value="${escapeAdmin(ga4.measurementId || '')}" placeholder="G-XXXXXXXXXX" class="input">
        <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:4px">להשארה ריק — לא מוזרק שום קוד מעקב.</div>
      </section>

      <section class="card">
        <h3 class="sub-head">🔒 אנליטיקס פנימי (Tapuz)</h3>
        <p class="lead">איסוף סטטיסטיקות פרטי, ללא צד שלישי, ללא שמירת כתובות IP. הצפייה בנתונים: <a href="/admin/analytics">לוח האנליטיקס</a>.</p>
        <label class="check-row">
          <input type="checkbox" id="fp-enabled" ${fp.enabled ? 'checked' : ''}> הפעל איסוף פנימי
        </label>
        <label class="field-label">כתובת האספן (Collector URL)</label>
        <input id="fp-url" dir="ltr" value="${escapeAdmin(fp.collectorUrl || '/_tapuz/collect')}" placeholder="/_tapuz/collect" class="input">
        <div class="chat-float-notice" style="margin-top:6px">שים לב: איסוף פנימי עובד רק כשהאתר מוגש על-ידי שרת Tapuz פעיל. אם ייצאת אתר סטטי ומארח אותו במקום אחר (Netlify / S3 / nginx), חובה להזין כאן כתובת <b>מלאה</b> לשרת Tapuz פעיל — אחרת האיסוף הפנימי לא ירשום דבר (Google Analytics ימשיך לעבוד). פרטים: <code dir="ltr">docs/analytics.md</code>.</div>
      </section>

      <section class="card" style="opacity:.8">
        <h3 class="sub-head">📥 קריאת נתוני GA בחזרה (GA Data API) <span style="font-size:0.7rem;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:999px">לא פעיל</span></h3>
        <p style="color:#64748b;font-size:0.9rem;margin:0 0 10px">שאיבת הסטטיסטיקות מ-Google אל תוך Tapuz דורשת סוד: קובץ JSON של Service Account, מזהה Property מספרי, והתקנת התלות <code dir="ltr">@google-analytics/data</code>. Tapuz לא מטפל בסוד הזה עבורך — יש להזין נתיב לקובץ ששמור <b>מחוץ</b> לתיקיית האתר/הייצוא. מדריך מלא: <code dir="ltr">docs/analytics.md</code>.</p>
        <label class="field-label">Property ID (מספרי)</label>
        <input id="gda-prop" dir="ltr" value="${escapeAdmin(gda.propertyId || '')}" placeholder="123456789" class="input">
        <label class="field-label">נתיב לקובץ Service Account JSON</label>
        <input id="gda-path" dir="ltr" value="${escapeAdmin(gda.serviceAccountPath || '')}" placeholder="/secure/ga-service-account.json" class="input">
        <label class="check-row">
          <input type="checkbox" id="gda-enabled" ${gda.enabled ? 'checked' : ''}> אפשר קריאה בחזרה (ידרוש התקנת התלות)
        </label>
        <div class="faint" style="margin-top:8px">גם כשמסומן — אין קוד פעיל שמעביר את הסוד. זהו שלד מתועד בלבד (ראה <code dir="ltr">src/ga-data.js</code>).</div>
      </section>
    </div>
    <script>
      document.getElementById('int-save').addEventListener('click', function () {
        fetch('/admin/api/integrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            whatsapp: {
              enabled: document.getElementById('wa-enabled').checked,
              phone: document.getElementById('wa-phone').value,
              message: document.getElementById('wa-message').value,
              position: document.getElementById('wa-position').value
            },
            search: {
              enabled: document.getElementById('srch-enabled').checked
            },
            analytics: {
              ga4: { measurementId: document.getElementById('ga4-id').value },
              firstParty: {
                enabled: document.getElementById('fp-enabled').checked,
                collectorUrl: document.getElementById('fp-url').value
              },
              gaDataApi: {
                enabled: document.getElementById('gda-enabled').checked,
                propertyId: document.getElementById('gda-prop').value,
                serviceAccountPath: document.getElementById('gda-path').value
              }
            }
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          document.getElementById('int-status').textContent = d.ok ? 'נשמר ✓' : (d.error || 'שגיאה');
        });
      });
      document.getElementById('nf-save').addEventListener('click', function () {
        fetch('/admin/api/notify/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: document.getElementById('nf-enabled').checked,
            to: document.getElementById('nf-to').value,
            from: document.getElementById('nf-from').value,
            host: document.getElementById('nf-host').value,
            port: document.getElementById('nf-port').value,
            secure: document.getElementById('nf-secure').checked,
            user: document.getElementById('nf-user').value,
            pass: document.getElementById('nf-pass').value || undefined,
            maxPerDay: document.getElementById('nf-maxday').value,
            tlsAllowInsecure: document.getElementById('nf-insecure-tls').checked
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          document.getElementById('nf-status').textContent = d.ok ? 'נשמר ✓' : (d.error || 'שגיאה');
          if (d.ok) document.getElementById('nf-pass').value = '';
        });
      });
      document.getElementById('nf-test').addEventListener('click', function () {
        document.getElementById('nf-status').textContent = 'שולח…';
        fetch('/admin/api/notify/test', { method: 'POST' })
          .then(function (r) { return r.json(); }).then(function (d) {
            document.getElementById('nf-status').textContent = d.ok ? 'נשלח ✓' : (d.error || 'שגיאה בשליחה');
          });
      });
      document.getElementById('nf-verify').addEventListener('click', function () {
        document.getElementById('nf-status').textContent = 'בודק חיבור…';
        fetch('/admin/api/notify/verify', { method: 'POST' })
          .then(function (r) { return r.json(); }).then(function (d) {
            document.getElementById('nf-status').textContent = d.ok ? 'חיבור תקין ✓' : (d.error || 'חיבור נכשל');
          });
      });
    </script>
  `;
  res.send(layout(html, 'אינטגרציות', accentFor('integrations')));
});

router.get('/admin/api/integrations', requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, integrations: loadConfig().integrations || {} });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/integrations', requireAdmin, (req, res) => {
  try {
    const config = loadConfig();
    const b = req.body || {};
    config.integrations = config.integrations || {};
    if (b.whatsapp && typeof b.whatsapp === 'object') {
      const prev = config.integrations.whatsapp || {};
      config.integrations.whatsapp = {
        enabled: !!b.whatsapp.enabled,
        phone: b.whatsapp.phone !== undefined ? String(b.whatsapp.phone || '').trim() : (prev.phone || ''),
        message: b.whatsapp.message !== undefined ? String(b.whatsapp.message || '') : (prev.message || ''),
        position: b.whatsapp.position === 'end' ? 'end' : 'start'
      };
    }
    if (b.search && typeof b.search === 'object') {
      const prev = config.integrations.search || {};
      config.integrations.search = { enabled: b.search.enabled !== undefined ? !!b.search.enabled : !!prev.enabled };
    }
    // Analytics (S5/S6). No secrets are handled here — only public-safe config.
    // The GA Measurement ID is validated to the strict G-XXXX shape (empty is
    // allowed = no tracking). The service-account key itself is NEVER accepted
    // over this endpoint — only a filesystem PATH the user manages out-of-band.
    if (b.analytics && typeof b.analytics === 'object') {
      config.analytics = config.analytics || {};
      const a = b.analytics;
      if (a.ga4 && typeof a.ga4 === 'object' && a.ga4.measurementId !== undefined) {
        const raw = String(a.ga4.measurementId || '').trim();
        // Accept a valid id or clear it; reject malformed input silently (keep prev).
        config.analytics.ga4 = config.analytics.ga4 || {};
        if (raw === '' || /^G-[A-Z0-9]+$/.test(raw)) {
          config.analytics.ga4.measurementId = raw;
        }
      }
      if (a.firstParty && typeof a.firstParty === 'object') {
        const prev = config.analytics.firstParty || {};
        config.analytics.firstParty = {
          enabled: a.firstParty.enabled !== undefined ? !!a.firstParty.enabled : !!prev.enabled,
          collectorUrl: a.firstParty.collectorUrl !== undefined
            ? (String(a.firstParty.collectorUrl || '').trim() || '/_tapuz/collect')
            : (prev.collectorUrl || '/_tapuz/collect')
        };
      }
      if (a.gaDataApi && typeof a.gaDataApi === 'object') {
        const prev = config.analytics.gaDataApi || {};
        config.analytics.gaDataApi = {
          enabled: a.gaDataApi.enabled !== undefined ? !!a.gaDataApi.enabled : !!prev.enabled,
          propertyId: a.gaDataApi.propertyId !== undefined
            ? String(a.gaDataApi.propertyId || '').trim()
            : (prev.propertyId || ''),
          serviceAccountPath: a.gaDataApi.serviceAccountPath !== undefined
            ? String(a.gaDataApi.serviceAccountPath || '').trim()
            : (prev.serviceAccountPath || ''),
          note: prev.note || 'Disabled. Requires @google-analytics/data + a service-account JSON key. See docs/analytics.md.'
        };
      }
    }
    saveConfig(config);
    res.json({ ok: true, integrations: config.integrations, analytics: config.analytics });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ─── Lead email notifications (v0.94) — the forms inbox stops being silent ───
router.get('/admin/api/notify/settings', requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, ...require('../notify').getSettings() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/notify/settings', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const settings = require('../notify').saveSettings({
      enabled: b.enabled,
      to: b.to,
      from: b.from,
      host: b.host,
      port: b.port,
      secure: b.secure,
      user: b.user,
      pass: b.pass, // undefined = keep, '' = clear, value = replace
      maxPerDay: b.maxPerDay,
      tlsAllowInsecure: b.tlsAllowInsecure
    });
    res.json({ ok: true, ...settings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/notify/verify', requireAdmin, async (req, res) => {
  try {
    const result = await require('../notify').verifyConnection();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/notify/test', requireAdmin, async (req, res) => {
  try {
    const notify = require('../notify');
    const s = notify.getSettings();
    if (!s.enabled || !s.to || !s.host || !s.user || !s.hasPass) {
      return res.status(400).json({ ok: false, error: 'השלימו את כל השדות ושמרו לפני שליחת בדיקה' });
    }
    const result = await notify.sendLeadNotification({
      page: 'בדיקה',
      fields: { הודעה: 'זו הודעת בדיקה מ-Tapuziel — ההתראות פעילות.' }
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
