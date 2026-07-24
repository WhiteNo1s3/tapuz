'use strict';

/**
 * CRM admin screens (v1.77, phase 1 of docs/CRM-INTEGRATION.md).
 *
 * People, segments and mailing lists. Every route is `requireAdmin`; the
 * global admin gate already enforces same-origin on state-changing requests,
 * so nothing here re-implements CSRF.
 *
 * With `config.crm.enabled` off, every screen shows the same one-click enable
 * card instead of the CRM. That is deliberate: a disabled product should
 * explain itself, not 404.
 *
 * ROUTE ORDER MATTERS — the literal paths (/admin/crm/segments, /lists) are
 * declared before /admin/crm/:id, or `:id` swallows them.
 */

const express = require('express');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');
const { requireAdmin } = require('../admin-guard');

const router = express.Router();
const ACCENT = '#ea580c';

const esc = (v) => escapeAdmin(String(v == null ? '' : v));

function page(res, activeKey, title, body) {
  res.send(layout(
    adminNav(activeKey, title) +
    `<div class="container page-body" style="max-width:1080px">${body}</div>`,
    title,
    accentFor(activeKey) || ACCENT
  ));
}

/** The screen a disabled CRM shows — an offer, not an error. */
function offerToEnable(res, activeKey, title) {
  page(res, activeKey, title, `
    <div class="card" style="max-width:620px;margin:40px auto;text-align:center">
      <div style="font-size:2.6rem;margin-bottom:10px">👥</div>
      <h2 class="sub-head" style="justify-content:center">מערכת הלקוחות כבויה</h2>
      <p class="lead">
        כשתפעילו אותה, כל פנייה מטופס תזוהה מול <strong>אדם</strong> — לא עוד שורה בודדת.
        תראו מי חזר, מה הוא עשה באתר, ותוכלו לפלח ולדוור.
      </p>
      <p class="muted" style="font-size:.88rem">
        כיבוי מחזיר את המערכת בדיוק למצב הקודם — שום דבר באתר לא משתנה.
      </p>
      <form method="POST" action="/admin/crm/settings" style="margin-top:16px">
        <input type="hidden" name="enabled" value="1">
        <button type="submit" class="btn">הפעילו את מערכת הלקוחות</button>
      </form>
    </div>`);
}

/** Guard every CRM screen behind the product flag. */
function requireCrm(activeKey, title) {
  return function (req, res, next) {
    if (!require('../crm').isEnabled()) return offerToEnable(res, activeKey, title);
    next();
  };
}

// ─── the flag ────────────────────────────────────────────────────────
router.post('/admin/crm/settings', requireAdmin, (req, res) => {
  const config = require('../config');
  const cfg = config.loadConfig();
  cfg.crm = Object.assign({}, cfg.crm, { enabled: !!(req.body && req.body.enabled) });
  config.saveConfig(cfg);
  res.redirect('/admin/crm');
});

// ─── segments (declared BEFORE /:id) ─────────────────────────────────
router.get('/admin/crm/segments', requireAdmin, requireCrm('crm-segments', 'פילוחים'), (req, res) => {
  const { segments } = require('../crm');
  const rows = segments.listSegments();
  const list = rows.length
    ? rows.map((s) => `
        <div class="rec" style="display:flex;align-items:center;gap:12px">
          <div style="flex:1">
            <strong>${esc(s.name)}</strong>
            <div class="muted" style="font-size:.8rem">${esc(JSON.stringify(s.rules))}</div>
          </div>
          <span class="pill">${s.size} אנשים</span>
          <form method="POST" action="/admin/crm/segments/${s.id}/delete"
                onsubmit="return confirm('למחוק את הפילוח?')">
            <button class="btn secondary sm" type="submit">מחק</button>
          </form>
        </div>`).join('')
    : '<div class="empty-state">אין עדיין פילוחים — צרו את הראשון למטה.</div>';

  page(res, 'crm-segments', 'פילוחים', `
    <div class="card">
      <div class="card-head">🎯 פילוחים — קהלים חיים</div>
      <p class="lead">פילוח הוא <strong>כלל</strong>, לא רשימה קפואה: מי שעונה עליו נמצא בו — תמיד עכשיו.</p>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">פילוח חדש</div>
      <form method="POST" action="/admin/crm/segments" class="stack">
        <label>שם<input name="name" class="input" required placeholder="לידים ישראלים עם מייל"></label>
        <label>סטטוס
          <select name="status" class="input">
            <option value="">כל הסטטוסים</option>
            ${require('../crm').contacts.STATUSES.map((s) => `<option value="${s}">${esc(s)}</option>`).join('')}
          </select>
        </label>
        <label>מדינה (קוד דו-אותי)<input name="country" class="input" maxlength="2" placeholder="IL"></label>
        <label>תגיות (מופרדות בפסיק)<input name="tags" class="input" placeholder="vip,newsletter"></label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="hasEmail" value="1"> רק מי שיש לו מייל
        </label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="consent" value="1"> רק מי שנתן הסכמה לדיוור
        </label>
        <button class="btn" type="submit">צור פילוח</button>
      </form>
    </div>`);
});

router.post('/admin/crm/segments', requireAdmin, (req, res) => {
  const { segments } = require('../crm');
  const b = req.body || {};
  const rules = {};
  if (b.status) rules.status = String(b.status);
  if (b.country) rules.country = String(b.country);
  if (b.tags) rules.tags = String(b.tags);
  if (b.hasEmail) rules.hasEmail = true;
  if (b.consent) rules.consent = true;
  try {
    segments.createSegment(b.name, rules);
  } catch (e) { /* a nameless segment simply is not created */ }
  res.redirect('/admin/crm/segments');
});

router.post('/admin/crm/segments/:id/delete', requireAdmin, (req, res) => {
  require('../crm').segments.deleteSegment(req.params.id);
  res.redirect('/admin/crm/segments');
});

// ─── lists ───────────────────────────────────────────────────────────
router.get('/admin/crm/lists', requireAdmin, requireCrm('crm-lists', 'רשימות דיוור'), (req, res) => {
  const { lists } = require('../crm');
  const rows = lists.listAll();
  const list = rows.length
    ? rows.map((l) => `
        <div class="rec" style="display:flex;align-items:center;gap:12px">
          <div style="flex:1"><strong>${esc(l.name)}</strong>
            ${l.description ? `<div class="muted" style="font-size:.8rem">${esc(l.description)}</div>` : ''}
          </div>
          <span class="pill">${l.members} נמענים</span>
          <form method="POST" action="/admin/crm/lists/${l.id}/delete"
                onsubmit="return confirm('למחוק את הרשימה? אנשי הקשר עצמם יישארו.')">
            <button class="btn secondary sm" type="submit">מחק</button>
          </form>
        </div>`).join('')
    : '<div class="empty-state">אין עדיין רשימות דיוור.</div>';

  page(res, 'crm-lists', 'רשימות דיוור', `
    <div class="card">
      <div class="card-head">📋 רשימות דיוור</div>
      <p class="lead">ברשימה נמצאים מי שהוספתם — בשונה מפילוח, שמחשב את עצמו לבד.</p>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">רשימה חדשה</div>
      <form method="POST" action="/admin/crm/lists" class="stack">
        <label>שם<input name="name" class="input" required placeholder="ניוזלטר חודשי"></label>
        <label>תיאור<input name="description" class="input"></label>
        <button class="btn" type="submit">צור רשימה</button>
      </form>
    </div>`);
});

router.post('/admin/crm/lists', requireAdmin, (req, res) => {
  const { lists } = require('../crm');
  try {
    lists.createList((req.body || {}).name, (req.body || {}).description);
  } catch (e) { /* nameless list is not created */ }
  res.redirect('/admin/crm/lists');
});

router.post('/admin/crm/lists/:id/delete', requireAdmin, (req, res) => {
  require('../crm').lists.deleteList(req.params.id);
  res.redirect('/admin/crm/lists');
});

// ─── pixels (declared BEFORE /:id) ───────────────────────────────────
router.get('/admin/crm/pixels', requireAdmin, requireCrm('crm-pixels', 'פיקסלים'), (req, res) => {
  const cfg = require('../config').loadConfig();
  const p = (cfg.crm && cfg.crm.pixels) || {};
  const on = (v) => (v ? 'checked' : '');
  const val = (v) => esc(v || '');

  page(res, 'crm-pixels', 'פיקסלים', `
    <div class="card">
      <div class="card-head">📡 פיקסלים — מדידה של מערכות פרסום</div>
      <p class="lead">
        כאן מדביקים את מזהי הפיקסל של מערכות הפרסום. הקוד שלהן ירוץ אצל המבקרים
        <strong>רק</strong> אחרי שיאשרו — וכיבוי מחזיר את האתר בדיוק למה שהוגש קודם.
      </p>
      <form method="POST" action="/admin/crm/pixels" class="stack">
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="enabled" value="1" ${on(p.enabled)}> הפעל פיקסלים
        </label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="requireConsent" value="1" ${on(p.requireConsent !== false)}>
          בקש אישור מהמבקר לפני טעינה <strong>(מומלץ מאוד)</strong>
        </label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="banner" value="1" ${on(p.banner !== false)}>
          הצג את סרגל האישור שלנו (כבו אם יש לכם סרגל משלכם)
        </label>

        <div class="side-title">מזהים</div>
        <label>Meta / Facebook Pixel ID
          <input name="metaPixelId" class="input" dir="ltr" value="${val(p.meta && p.meta.pixelId)}" placeholder="123456789012345"></label>
        <label>Google Ads Conversion ID
          <input name="googleAdsId" class="input" dir="ltr" value="${val(p.googleAds && p.googleAds.conversionId)}" placeholder="AW-123456789"></label>
        <label>Google Ads Conversion Label
          <input name="googleAdsLabel" class="input" dir="ltr" value="${val(p.googleAds && p.googleAds.conversionLabel)}"></label>
        <label>TikTok Pixel ID
          <input name="tiktokPixelId" class="input" dir="ltr" value="${val(p.tiktok && p.tiktok.pixelId)}"></label>
        <label>LinkedIn Partner ID
          <input name="linkedinPartnerId" class="input" dir="ltr" value="${val(p.linkedin && p.linkedin.partnerId)}"></label>

        <button class="btn" type="submit">שמור</button>
      </form>
    </div>
    <div class="card">
      <div class="card-head">איך זה מתנהג</div>
      <ul class="muted" style="font-size:.88rem;line-height:1.9;padding-inline-start:18px;margin:0">
        <li>מבקר ששלח Do-Not-Track — שום פיקסל לא ייטען, גם אם אישר.</li>
        <li>עד שהמבקר מאשר, קוד הספקים <strong>לא נמצא בכלל</strong> בעמוד — רק כטקסט שממתין.</li>
        <li>אפשר לחבר סרגל אישור משלכם: <code>window.tapuzConsent.grant()</code> / <code>.deny()</code>.</li>
        <li>בלי מזהים, או עם הפיקסלים כבויים — הדף מוגש בדיוק כמו קודם.</li>
      </ul>
    </div>`);
});

router.post('/admin/crm/pixels', requireAdmin, (req, res) => {
  const config = require('../config');
  const cfg = config.loadConfig();
  const b = req.body || {};
  cfg.crm = Object.assign({}, cfg.crm, {
    pixels: {
      enabled: !!b.enabled,
      requireConsent: !!b.requireConsent,
      banner: !!b.banner,
      meta: { pixelId: String(b.metaPixelId || '').trim() },
      googleAds: {
        conversionId: String(b.googleAdsId || '').trim(),
        conversionLabel: String(b.googleAdsLabel || '').trim()
      },
      tiktok: { pixelId: String(b.tiktokPixelId || '').trim() },
      linkedin: { partnerId: String(b.linkedinPartnerId || '').trim() }
    }
  });
  config.saveConfig(cfg);
  res.redirect('/admin/crm/pixels');
});

// ─── contacts: the list ──────────────────────────────────────────────
router.get('/admin/crm', requireAdmin, requireCrm('crm-contacts', 'אנשי קשר'), (req, res) => {
  const { contacts, Customer } = require('../crm');
  const q = String((req.query || {}).q || '');
  const status = String((req.query || {}).status || '');
  const rows = contacts.listContacts({ q, status, limit: 100 });
  const counts = contacts.statusCounts();

  const tiles = ['lead', 'active', 'customer', 'archived'].map((s) => `
    <a class="stat-tile" href="/admin/crm?status=${s}">
      <div class="stat-num">${counts[s] || 0}</div>
      <div class="stat-label">${esc(s)}</div>
    </a>`).join('');

  const body = rows.length
    ? rows.map((row) => {
        const c = new Customer(row);
        return `
        <a class="rec" href="/admin/crm/${c.id}" style="display:flex;align-items:center;gap:12px;text-decoration:none">
          <div style="flex:1">
            <strong>${esc(c.displayName)}</strong>
            <div class="muted" style="font-size:.82rem">
              ${esc([c.email, c.phone, c.company].filter(Boolean).join(' · '))}
            </div>
          </div>
          ${c.tags.slice(0, 3).map((t) => `<span class="pill">${esc(t)}</span>`).join('')}
          <span class="pill">${esc(c.status)}</span>
        </a>`;
      }).join('')
    : `<div class="empty-state">
         <div style="font-size:2rem;margin-bottom:8px">👥</div>
         ${q || status ? 'אין תוצאות לחיפוש הזה.' : 'עדיין אין אנשי קשר — הם ייווצרו מהפניות שיגיעו.'}
       </div>`;

  page(res, 'crm-contacts', 'אנשי קשר', `
    <div class="stat-row">${tiles}</div>
    <div class="card">
      <div class="section-bar">
        <div class="card-head">👥 אנשי קשר · ${counts.total}</div>
        <form method="GET" action="/admin/crm" style="display:flex;gap:8px">
          <input name="q" class="input" value="${esc(q)}" placeholder="חיפוש שם, מייל, טלפון…">
          <button class="btn secondary sm" type="submit">חפש</button>
          ${q || status ? '<a class="btn secondary sm" href="/admin/crm">נקה</a>' : ''}
        </form>
      </div>
      ${body}
    </div>`);
});

// ─── contacts: one person ────────────────────────────────────────────
router.get('/admin/crm/:id', requireAdmin, requireCrm('crm-contacts', 'איש קשר'), (req, res) => {
  const { Customer, contacts } = require('../crm');
  const c = Customer.load(req.params.id);
  if (!c) return res.status(404).send(layout('<div class="container">איש הקשר לא נמצא</div>', 'לא נמצא', ACCENT));
  const d = c.datasheet();

  const timeline = d.timeline.length
    ? d.timeline.map((e) => `
        <div class="rec" style="display:flex;gap:10px;align-items:baseline">
          <span class="pill">${esc(e.type)}</span>
          <span style="flex:1">${esc(e.title || e.path || '')}</span>
          <span class="muted" style="font-size:.76rem">${esc(e.created_at)}</span>
        </div>`).join('')
    : '<div class="empty-state">עדיין אין פעילות.</div>';

  const reasons = d.scoreReasons.map((r) => `<li>${esc(r.why)} — ${r.points}</li>`).join('');

  page(res, 'crm-contacts', d.displayName, `
    <div class="card">
      <div class="section-bar">
        <div class="card-head">👤 ${esc(d.displayName)}</div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="pill">ציון ${d.score}</span>
          <a class="btn secondary sm" href="/admin/crm">← לרשימה</a>
        </div>
      </div>
      <form method="POST" action="/admin/crm/${d.id}/update" class="stack">
        <label>שם<input name="name" class="input" value="${esc(d.name)}"></label>
        <label>מייל<input name="email" class="input" dir="ltr" value="${esc(d.email)}"></label>
        <label>טלפון<input name="phone" class="input" dir="ltr" value="${esc(d.phone)}"></label>
        <label>חברה<input name="company" class="input" value="${esc(d.company)}"></label>
        <label>סטטוס
          <select name="status" class="input">
            ${contacts.STATUSES.map((s) =>
              `<option value="${s}" ${s === d.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
        </label>
        <label>תגיות<input name="tags" class="input" value="${esc(d.tags.join(','))}"></label>
        <label>הערות<textarea name="notes" class="input" rows="3">${esc(d.notes)}</textarea></label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="consent" value="1" ${d.consent ? 'checked' : ''}> הסכמה לדיוור
        </label>
        <button class="btn" type="submit">שמור</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head">📊 למה הציון ${d.score}</div>
      <ul class="muted" style="font-size:.88rem;line-height:1.8">${reasons || '<li>אין עדיין נתונים</li>'}</ul>
    </div>

    <div class="card">
      <div class="card-head">🕘 ציר הזמן · ${d.eventCount} אירועים</div>
      ${timeline}
      <form method="POST" action="/admin/crm/${d.id}/note" style="display:flex;gap:8px;margin-top:12px">
        <input name="text" class="input" style="flex:1" placeholder="הוסיפו הערה לציר הזמן…" required>
        <button class="btn secondary sm" type="submit">הוסף</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head">🗑 מחיקה</div>
      <p class="muted" style="font-size:.88rem">
        מחיקת איש קשר מוחקת גם את ציר הזמן והקשרים שלו. הפניות עצמן נשארות בתיבה.
      </p>
      <form method="POST" action="/admin/crm/${d.id}/delete"
            onsubmit="return confirm('למחוק את ${esc(d.displayName)}?')">
        <button class="btn secondary" type="submit">מחק איש קשר</button>
      </form>
    </div>`);
});

router.post('/admin/crm/:id/update', requireAdmin, (req, res) => {
  const b = req.body || {};
  require('../crm').contacts.updateContact(req.params.id, {
    name: b.name, email: b.email, phone: b.phone, company: b.company,
    status: b.status, tags: b.tags, notes: b.notes, consent: !!b.consent
  });
  res.redirect('/admin/crm/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/:id/note', requireAdmin, (req, res) => {
  const { events } = require('../crm');
  const text = String((req.body || {}).text || '').trim();
  // The admin screen writes directly (not through the guarded seam): here a
  // failure SHOULD surface, because a human is watching and expecting a result.
  if (text) events.record({ contactId: Number(req.params.id), type: 'note', title: text });
  res.redirect('/admin/crm/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/:id/delete', requireAdmin, (req, res) => {
  require('../crm').contacts.deleteContact(req.params.id);
  res.redirect('/admin/crm');
});

module.exports = router;
