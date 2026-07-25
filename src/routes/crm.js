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
  // Same reason as the chat toggle: pixels are injected at render time, so the
  // live site would keep serving the previous markup until a rebuild.
  try { require('../export').exportAll(); } catch (e) { console.error('[crm] rebuild after pixel change failed:', e.message); }
  res.redirect('/admin/crm/pixels');
});

// ─── customer-service chat (declared BEFORE /:id) ────────────────────
router.get('/admin/crm/chat', requireAdmin, requireCrm('crm-cs', 'צ׳אט שירות'), (req, res) => {
  const cfg = require('../config').loadConfig();
  const cs = require('../crm/cs');
  const s = cs.getSettings(cfg);
  const used = cs.usageToday();
  const cost = cs.costEstimate(cfg);
  const history = cs.usageHistory(7);
  const convos = cs.listConversations({ limit: 50 });
  const ai = require('../ai').getSettings();

  const bar = s.dailyMessageCap
    ? Math.min(100, Math.round((used.messages / s.dailyMessageCap) * 100))
    : 0;

  const rows = convos.length
    ? convos.map((c) => `
        <a class="rec" href="/admin/crm/chat/${c.id}" style="display:flex;gap:12px;align-items:center;text-decoration:none">
          <div style="flex:1">
            <strong>${esc(c.contact_name || c.contact_email || 'מבקר אנונימי')}</strong>
            <div class="muted" style="font-size:.82rem">${esc((c.first_question || '').slice(0, 80))}</div>
          </div>
          <span class="pill">${c.message_count} שאלות</span>
          <span class="muted" style="font-size:.76rem">${esc(c.last_message_at || '')}</span>
        </a>`).join('')
    : '<div class="empty-state">אין עדיין שיחות.</div>';

  page(res, 'crm-cs', 'צ׳אט שירות', `
    ${ai.hasKey || ai.provider === 'local' ? '' : `
    <div class="card" style="border-color:#fde68a;background:#fffbeb">
      <strong>אין מודל מחובר</strong>
      <p class="muted" style="margin:6px 0 0;font-size:.88rem">
        הצ׳אט צריך מודל — הגדירו מפתח או מודל מקומי ב־<a href="/admin/chat">קופיילוט</a>.
        עד אז הוא לא יענה למבקרים.
      </p>
    </div>`}

    <div class="card">
      <div class="card-head">💰 התקציב היומי — הדבר החשוב כאן</div>
      <p class="lead">
        זה המשטח היחיד שבו <strong>מבקר אנונימי מוציא לכם כסף</strong>.
        לכן יש תקרה קשה: כשהיא נגמרת, המודל לא נקרא בכלל — המבקר מקבל תשובה
        אנושית ובקשה להשאיר פרטים.
      </p>
      <div style="background:#f1f5f9;border-radius:10px;height:12px;overflow:hidden;margin:10px 0">
        <div style="height:100%;width:${bar}%;background:${bar >= 90 ? '#dc2626' : bar >= 60 ? '#f59e0b' : '#059669'}"></div>
      </div>
      <p class="muted" style="font-size:.9rem">
        היום: <strong>${used.messages}</strong> מתוך ${s.dailyMessageCap} תשובות
        ${used.refusals ? ` · ${used.refusals} בקשות נדחו אחרי שהתקרה נגמרה` : ''}
        · הערכת טוקנים: ${used.est_tokens.toLocaleString('he-IL')}
      </p>
      <p class="muted" style="font-size:.85rem">
        <strong>במקרה הגרוע</strong> התקרה הזו שווה בערך ${cost.worstCaseTokens.toLocaleString('he-IL')}
        טוקנים ביום — כ-$${cost.worstCaseUsd} לפי מחיר טיפוסי. ${esc(cost.note)}.
      </p>
    </div>

    <div class="card">
      <div class="card-head">⚙ הגדרות</div>
      <form method="POST" action="/admin/crm/chat" class="stack">
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="enabled" value="1" ${s.enabled ? 'checked' : ''}>
          הפעל צ׳אט שירות באתר
        </label>
        <label>תקרת תשובות ליום (עד ${cs.MAX_DAILY_CAP})
          <input type="number" name="dailyMessageCap" class="input" min="1" max="${cs.MAX_DAILY_CAP}"
                 value="${s.dailyMessageCap}"></label>
        <label>תקרה לשיחה בודדת (עד ${cs.MAX_SESSION_CAP})
          <input type="number" name="perSessionCap" class="input" min="1" max="${cs.MAX_SESSION_CAP}"
                 value="${s.perSessionCap}"></label>
        <label>הודעת פתיחה<input name="greeting" class="input" value="${esc(s.greeting)}"></label>
        <label>מה מותר לו לומר — המידע על העסק
          <textarea name="businessInfo" class="input" rows="8"
            placeholder="שעות פתיחה, מה אנחנו מציעים, אזורי שירות, מה לא לענות עליו…">${esc(s.businessInfo)}</textarea></label>
        <div class="prop-hint">
          מה שלא כתוב כאן — הוא יגיד שאינו יודע ויבקש פרטים. הוא לא ממציא מחירים או התחייבויות.
        </div>
        <button class="btn" type="submit">שמור</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head">🛡 מה הוא לא יכול לעשות</div>
      <ul class="muted" style="font-size:.88rem;line-height:1.9;padding-inline-start:18px;margin:0">
        <li>אין לו כלים — הוא מחזיר טקסט בלבד. לא קורא דפים, לא כותב, לא משנה הגדרות, לא שולח כלום.</li>
        <li>טקסט מהמבקר הוא שאלה, לא הוראה — ניסיון "התעלם מההנחיות" נדחה.</li>
        <li>הוא לא מבקש סיסמאות או אשראי, ומבקש לא לשלוח כאלה.</li>
        <li>התשובה מוצגת כטקסט בדפדפן, לא כקוד.</li>
      </ul>
    </div>

    <div class="card">
      <div class="card-head">💬 שיחות</div>
      ${rows}
    </div>

    ${history.length > 1 ? `
    <div class="card">
      <div class="card-head">📅 שבעה ימים אחרונים</div>
      ${history.map((h) => `<div class="rec" style="display:flex;gap:10px">
        <span style="flex:1">${esc(h.day)}</span>
        <span class="muted">${h.messages} תשובות${h.refusals ? ` · ${h.refusals} נדחו` : ''}</span>
      </div>`).join('')}
    </div>` : ''}`);
});

router.post('/admin/crm/chat', requireAdmin, (req, res) => {
  const config = require('../config');
  const cs = require('../crm/cs');
  const cfg = config.loadConfig();
  const b = req.body || {};
  const num = (v, def, max) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
  };
  cfg.crm = Object.assign({}, cfg.crm, {
    cs: {
      enabled: !!b.enabled,
      dailyMessageCap: num(b.dailyMessageCap, 100, cs.MAX_DAILY_CAP),
      perSessionCap: num(b.perSessionCap, 20, cs.MAX_SESSION_CAP),
      greeting: String(b.greeting || '').slice(0, 300),
      businessInfo: String(b.businessInfo || '').slice(0, 4000)
    }
  });
  config.saveConfig(cfg);
  // The widget tag is injected at RENDER time, so the published site keeps
  // serving the old markup until it is rebuilt. An owner who flips a site-wide
  // switch and sees no change on their site concludes it is broken — so rebuild
  // here rather than making them find "בנה אתר" first.
  try { require('../export').exportAll(); } catch (e) { console.error('[crm] rebuild after chat toggle failed:', e.message); }
  res.redirect('/admin/crm/chat');
});

router.get('/admin/crm/chat/:id', requireAdmin, requireCrm('crm-cs', 'שיחה'), (req, res) => {
  const cs = require('../crm/cs');
  const conv = cs.getConversation(req.params.id);
  if (!conv) return res.status(404).send(layout('<div class="container">שיחה לא נמצאה</div>', 'לא נמצא', ACCENT));
  const msgs = cs.messagesFor(conv.id);
  const contact = conv.contact_id ? require('../crm').contacts.getContact(conv.contact_id) : null;

  page(res, 'crm-cs', 'שיחה', `
    <div class="card">
      <div class="section-bar">
        <div class="card-head">💬 שיחה #${conv.id}</div>
        <a class="btn secondary sm" href="/admin/crm/chat">← לשיחות</a>
      </div>
      ${contact
        ? `<p class="muted">מקושר ל־<a href="/admin/crm/${contact.id}">${esc(contact.name || contact.email)}</a></p>`
        : '<p class="muted">מבקר אנונימי — לא השאיר פרטים.</p>'}
      ${msgs.map((m) => `
        <div class="rec" style="display:flex;gap:10px">
          <span class="pill">${m.role === 'user' ? 'מבקר' : 'עוזר'}</span>
          <span style="flex:1;white-space:pre-wrap">${esc(m.text)}</span>
        </div>`).join('') || '<div class="empty-state">אין הודעות.</div>'}
    </div>`);
});

// ─── WhatsApp channel (declared BEFORE /:id) ─────────────────────────
router.get('/admin/crm/whatsapp', requireAdmin, requireCrm('crm-wa', 'WhatsApp'), (req, res) => {
  const wa = require('../crm/whatsapp');
  const ledger = require('../crm/wa-ledger');
  const s = wa.getSettings();
  const sum = ledger.summary();
  const cfg = require('../config').loadConfig();
  const waOn = !!(cfg.crm && cfg.crm.whatsapp && cfg.crm.whatsapp.enabled);
  const hookUrl = req.protocol + '://' + req.get('host') + '/crm/wa/webhook';
  const recent = ledger.recentMessages({ limit: 30 });
  const tierPct = sum.tier.limit === Infinity ? 0
    : Math.min(100, Math.round((sum.tier.used / sum.tier.limit) * 100));

  const rows = recent.length
    ? recent.map((m) => `
        <div class="rec" style="display:flex;gap:10px;align-items:baseline">
          <span class="pill">${m.direction === 'in' ? '⬅ נכנס' : '➡ יוצא'}</span>
          <span dir="ltr" class="muted">${esc(m.phone)}</span>
          <span style="flex:1">${esc((m.body || m.template_category || m.msg_type || '').slice(0, 60))}</span>
          ${m.billable ? '<span class="pill" style="background:#fffbeb;color:#92400e;border-color:#fde68a">בתשלום</span>' : ''}
          <span class="muted" style="font-size:.74rem">${esc(m.status || '')}</span>
        </div>`).join('')
    : '<div class="empty-state">אין עדיין הודעות — שליחה וקבלה מגיעות בשלבים הבאים.</div>';

  page(res, 'crm-wa', 'WhatsApp', `
    ${s.configured ? '' : `
    <div class="card" style="border-color:#fde68a;background:#fffbeb">
      <strong>הערוץ עוד לא מחובר</strong>
      <p class="muted" style="margin:6px 0 0;font-size:.88rem">
        צריך Phone Number ID, Access Token ו-App Secret מ-Meta — מלאו אותם
        בכרטיס החיבור למטה. עד אז המסך מנהל רק הסכמות ותיעוד.
      </p>
    </div>`}

    <div class="card">
      <div class="card-head">📗 WhatsApp — מצב הערוץ</div>
      <p class="muted" style="font-size:.9rem">
        ${sum.messages} הודעות בתיעוד · ${sum.billable} בתשלום ·
        ${sum.activeOptIns} הסכמות פעילות · ${sum.openWindows} חלונות שירות פתוחים
      </p>
      <div class="side-title">תקרת נמענים מחוץ לחלון (24 שעות)</div>
      <div style="background:#f1f5f9;border-radius:10px;height:12px;overflow:hidden;margin:8px 0">
        <div style="height:100%;width:${tierPct}%;background:${tierPct >= 90 ? '#dc2626' : tierPct >= 60 ? '#f59e0b' : '#059669'}"></div>
      </div>
      <p class="muted" style="font-size:.85rem">
        ${sum.tier.used} מתוך ${sum.tier.limit === Infinity ? '∞' : sum.tier.limit}
        (${esc(s.messagingLimitTier)}) — נספר מתוך התיעוד עצמו, כך שהוא שורד הפעלה מחדש.
      </p>
    </div>

    <div class="card">
      <div class="card-head">🔌 חיבור ל-Meta</div>
      <form method="POST" action="/admin/crm/whatsapp/settings" class="stack" style="max-width:520px">
        <label style="display:flex;gap:8px;align-items:center;font-weight:600">
          <input type="checkbox" name="channelEnabled" value="1" ${waOn ? 'checked' : ''}>
          הערוץ פעיל (ה-webhook עונה רק כשמסומן)
        </label>
        <label>Phone Number ID<input name="phoneNumberId" class="input" dir="ltr" value="${esc(s.phoneNumberId)}"></label>
        <label>WABA ID<input name="wabaId" class="input" dir="ltr" value="${esc(s.wabaId)}"></label>
        <label>גרסת Graph API
          <select name="apiVersion" class="input">
            ${wa.API_VERSIONS.map((v) => `<option value="${v}" ${v === s.apiVersion ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>דרגת שליחה (messaging limit tier)
          <select name="messagingLimitTier" class="input">
            ${wa.TIERS.map((t) => `<option value="${t}" ${t === s.messagingLimitTier ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <label>Access Token ${s.hasToken ? `<span class="muted">· מוגדר (…${esc(s.tokenTail)})</span>` : '<span class="muted">· לא מוגדר</span>'}
          <input name="accessToken" class="input" dir="ltr" type="password" autocomplete="off"
                 placeholder="${s.hasToken ? 'להחלפה — הדביקו טוקן חדש' : 'EAAG…'}"></label>
        <label>App Secret ${s.hasAppSecret ? `<span class="muted">· מוגדר (…${esc(s.appSecretTail)})</span>` : '<span class="muted">· לא מוגדר</span>'}
          <input name="appSecret" class="input" dir="ltr" type="password" autocomplete="off"
                 placeholder="${s.hasAppSecret ? 'להחלפה — הדביקו ערך חדש' : 'מהגדרות האפליקציה ב-Meta'}"></label>
        <label>Verify Token ${s.hasVerifyToken ? '<span class="muted">· מוגדר</span>' : '<span class="muted">· לא מוגדר</span>'}
          <input name="verifyToken" class="input" dir="ltr" type="password" autocomplete="off"
                 placeholder="${s.hasVerifyToken ? 'להחלפה' : 'מחרוזת שאתם ממציאים — אותו ערך מוזן אצל Meta'}"></label>
        <button class="btn" type="submit">שמור חיבור</button>
      </form>
      <p class="muted" style="font-size:.82rem;margin-top:10px">
        הסודות נשמרים ב-<code dir="ltr">config/whatsapp.json</code> (מחוץ ל-git)
        ולעולם לא מוצגים חזרה; שדה ריק משאיר את הערך הקיים. הכתובת שאליה
        נשלחות בקשות היא קבועה בקוד — <code dir="ltr">${esc(s.graphHost)}</code> —
        ואינה ניתנת להגדרה, בכוונה.
      </p>
    </div>

    <div class="card">
      <div class="card-head">📡 Webhook — קבלת אירועים מ-Meta</div>
      <p class="lead">
        הדביקו את הכתובת ואת ה-Verify Token במסך WhatsApp ← Configuration של
        האפליקציה ב-Meta. אירוע מתקבל <strong>רק</strong> עם חתימת
        <code dir="ltr">X-Hub-Signature-256</code> תקפה (על בסיס ה-App Secret) —
        כל השאר נדחה.
      </p>
      <div class="rec" dir="ltr" style="font-family:monospace;user-select:all">${esc(hookUrl)}</div>
      <p class="muted" style="font-size:.85rem">
        ${waOn ? '🟢 הערוץ פעיל' : '⚪ הערוץ כבוי — ה-webhook עונה 404'} ·
        Verify Token: ${s.hasVerifyToken ? 'מוגדר ✓' : 'חסר'} ·
        App Secret: ${s.hasAppSecret ? 'מוגדר ✓' : 'חסר'}
      </p>
      <p class="muted" style="font-size:.85rem">
        סטטוס מסירה מעדכן את התיעוד (החיוב נקבע במסירה, לפי מודל PMP);
        הודעה נכנסת נרשמת ופותחת חלון שירות של 24 שעות. שליחה — בשלב הבא.
      </p>
    </div>

    <div class="card">
      <div class="card-head">✅ הסכמות שיווק (opt-in)</div>
      <p class="lead">
        תבנית שיווקית נשלחת <strong>רק</strong> למי שנתן הסכמה מפורשת — נאכף אצלנו,
        לפני מטא. ההסכמה הזו נפרדת מהסכמת המייל: ביטול דיוור במייל לא מבטל אותה.
      </p>
      <form method="POST" action="/admin/crm/whatsapp/optin" class="stack" style="max-width:460px">
        <label>טלפון<input name="phone" class="input" dir="ltr" placeholder="050-123-4567" required></label>
        <label>הערה (איך התקבלה ההסכמה)<input name="note" class="input" placeholder="טופס באתר / בעל־פה בחנות…"></label>
        <div style="display:flex;gap:8px">
          <button class="btn" type="submit" name="action" value="grant">רשום הסכמה</button>
          <button class="btn secondary" type="submit" name="action" value="revoke">בטל הסכמה</button>
        </div>
      </form>
    </div>

    <div class="card">
      <div class="card-head">💬 הודעות אחרונות</div>
      ${rows}
    </div>`);
});

router.post('/admin/crm/whatsapp/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  // The channel flag lives in site config, nested under the CRM flag it
  // depends on; the credentials live in config/whatsapp.json (W0 store).
  const config = require('../config');
  const cfg = config.loadConfig();
  cfg.crm = Object.assign({}, cfg.crm, {
    whatsapp: Object.assign({}, (cfg.crm || {}).whatsapp, { enabled: !!b.channelEnabled })
  });
  config.saveConfig(cfg);
  // An empty secret field means "keep what is stored" — saveSettings clears
  // only on an explicit '', so pass undefined instead (conversions pattern).
  const secret = (v) => { const t = String(v || '').trim(); return t || undefined; };
  require('../crm/whatsapp').saveSettings({
    phoneNumberId: b.phoneNumberId,
    wabaId: b.wabaId,
    apiVersion: b.apiVersion,
    messagingLimitTier: b.messagingLimitTier,
    accessToken: secret(b.accessToken),
    appSecret: secret(b.appSecret),
    verifyToken: secret(b.verifyToken)
  });
  res.redirect('/admin/crm/whatsapp');
});

router.post('/admin/crm/whatsapp/optin', requireAdmin, (req, res) => {
  const ledger = require('../crm/wa-ledger');
  const b = req.body || {};
  if (b.action === 'revoke') ledger.revokeOptIn(b.phone, 'marketing');
  else ledger.grantOptIn(b.phone, 'marketing', b.note);
  res.redirect('/admin/crm/whatsapp');
});

// ─── privacy: retention + subject rights (declared BEFORE /:id) ──────
router.get('/admin/crm/privacy', requireAdmin, requireCrm('crm-privacy', 'פרטיות ושמירה'), (req, res) => {
  const cfg = require('../config').loadConfig();
  const days = (cfg.crm && cfg.crm.retention && cfg.crm.retention.eventDays) || 0;
  const { db } = require('../db');
  const eventCount = db.prepare('SELECT COUNT(*) AS n FROM crm_events').get().n;
  const anchored = db.prepare('SELECT COUNT(*) AS n FROM crm_events WHERE ref_id IS NOT NULL').get().n;
  const searchOn = require('../db').crmSearchReady();

  page(res, 'crm-privacy', 'פרטיות ושמירה', `
    <div class="card">
      <div class="card-head">🗓 שמירת נתוני התנהגות</div>
      <p class="lead">
        צפיות בדפים נערמות בלי סוף. נתון שלא צריך יותר הוא סיכון, לא נכס —
        אפשר לקבוע כמה זמן לשמור.
      </p>
      <p class="muted" style="font-size:.88rem">
        כרגע ${eventCount} אירועים, מהם ${anchored} מקושרים לפנייה אמיתית —
        <strong>אלה לא נמחקים לעולם</strong>, בלי קשר להגדרה כאן.
      </p>
      <form method="POST" action="/admin/crm/privacy" class="stack">
        <label>שמור אירועי התנהגות (בימים) — 0 = לשמור הכול
          <input type="number" name="eventDays" class="input" min="0" max="3650" value="${Number(days) || 0}"></label>
        <button class="btn" type="submit">שמור מדיניות</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head">🔎 חיפוש</div>
      <p class="muted" style="font-size:.9rem">
        ${searchOn
          ? 'חיפוש אנשי קשר עובד על אינדקס טקסט מלא (FTS5) — מהיר גם עם הרבה אנשי קשר, ותומך בעברית.'
          : 'האינדקס אינו זמין בסביבה הזו — החיפוש עובד, אבל סורק את כל הרשומות (איטי יותר).'}
      </p>
    </div>

    <div class="card">
      <div class="card-head">👤 זכויות של אנשים</div>
      <p class="lead">
        אדם רשאי לבקש לראות מה יש עליכם עליו, ולבקש שתמחקו. שתי הפעולות
        נמצאות בדף של כל איש קשר — ייצוא מלא בלחיצה, ומחיקה שנבדקת אחרי עצמה.
      </p>
      <a class="btn secondary" href="/admin/crm">לרשימת אנשי הקשר</a>
    </div>`);
});

router.post('/admin/crm/privacy', requireAdmin, (req, res) => {
  const config = require('../config');
  const cfg = config.loadConfig();
  const n = parseInt((req.body || {}).eventDays, 10);
  cfg.crm = Object.assign({}, cfg.crm, {
    retention: { eventDays: Number.isFinite(n) && n > 0 ? Math.min(n, 3650) : 0 }
  });
  config.saveConfig(cfg);
  // apply immediately, so the number the owner just typed means something now
  try { require('../crm').runRetention(); } catch (e) { /* reported inside */ }
  res.redirect('/admin/crm/privacy');
});

// ─── campaigns (declared BEFORE /:id) ────────────────────────────────
router.get('/admin/crm/campaigns', requireAdmin, requireCrm('crm-campaigns', 'קמפיינים'), (req, res) => {
  const { campaigns, lists } = require('../crm');
  const rows = campaigns.listCampaigns();
  const allLists = lists.listAll();
  const smtp = require('../notify').getSettings();

  const statusPill = (s) => s === 'sent'
    ? '<span class="pill">נשלח</span>'
    : s === 'sending' ? '<span class="pill" style="background:#fffbeb;color:#92400e;border-color:#fde68a">שולח…</span>'
      : '<span class="pill" style="background:#f1f5f9;color:#475569;border-color:#e2e8f0">טיוטה</span>';

  const list = rows.length
    ? rows.map((c) => `
        <a class="rec" href="/admin/crm/campaigns/${c.id}" style="display:flex;align-items:center;gap:12px;text-decoration:none">
          <div style="flex:1">
            <strong>${esc(c.name)}</strong>
            <div class="muted" style="font-size:.82rem">${esc(c.subject || 'ללא נושא')}</div>
          </div>
          ${c.status === 'sent' || c.status === 'sending'
            ? `<span class="muted" style="font-size:.8rem">${c.sent_count} נשלחו · ${c.opened_count} נפתחו · ${c.clicked_count} הקליקו${c.failed_count ? ' · ' + c.failed_count + ' נכשלו' : ''}</span>`
            : ''}
          ${statusPill(c.status)}
        </a>`).join('')
    : '<div class="empty-state">אין עדיין קמפיינים.</div>';

  page(res, 'crm-campaigns', 'קמפיינים', `
    ${smtp.enabled && smtp.host ? '' : `
    <div class="card" style="border-color:#fde68a;background:#fffbeb">
      <strong>שרת המייל לא מוגדר</strong>
      <p class="muted" style="margin:6px 0 0;font-size:.88rem">
        אפשר להכין קמפיין, אבל שליחה תיכשל עד שתגדירו SMTP ב־<a href="/admin/settings">הגדרות</a>.
      </p>
    </div>`}
    <div class="card">
      <div class="card-head">✉️ קמפיינים</div>
      <p class="lead">
        דיוור לרשימה — ואז רואים מי פתח ומי הקליק. נשלח <strong>רק</strong> למי שנתן
        הסכמה לדיוור, וכל הודעה כוללת קישור הסרה בלחיצה אחת.
      </p>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">קמפיין חדש</div>
      <form method="POST" action="/admin/crm/campaigns" class="stack">
        <label>שם פנימי<input name="name" class="input" required placeholder="ניוזלטר יולי"></label>
        <label>נושא המייל<input name="subject" class="input" placeholder="מה חדש אצלנו"></label>
        <label>רשימת נמענים
          <select name="listId" class="input">
            <option value="">— בחרו רשימה —</option>
            ${allLists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.members})</option>`).join('')}
          </select>
        </label>
        <label>תוכן (HTML)
          <textarea name="body" class="input" rows="8" dir="auto"
            placeholder="שלום {{name}}, ...">‏</textarea></label>
        <div class="prop-hint">אפשר להשתמש ב־<code>{{name}}</code> ו־<code>{{email}}</code>. קישורים יעברו מעקב הקלקות אוטומטית.</div>
        <button class="btn" type="submit">צור טיוטה</button>
      </form>
    </div>`);
});

router.post('/admin/crm/campaigns', requireAdmin, (req, res) => {
  const { campaigns } = require('../crm');
  const b = req.body || {};
  try {
    const c = campaigns.createCampaign({
      name: b.name, subject: b.subject, body: b.body, listId: b.listId
    });
    return res.redirect('/admin/crm/campaigns/' + c.id);
  } catch (e) {
    return res.redirect('/admin/crm/campaigns');
  }
});

router.get('/admin/crm/campaigns/:id', requireAdmin, requireCrm('crm-campaigns', 'קמפיין'), (req, res) => {
  const { campaigns, lists } = require('../crm');
  const c = campaigns.getCampaign(req.params.id);
  if (!c) return res.status(404).send(layout('<div class="container">קמפיין לא נמצא</div>', 'לא נמצא', ACCENT));
  const audience = campaigns.audienceFor(c);
  const sends = campaigns.sendsFor(c.id);
  const allLists = lists.listAll();
  const isDraft = c.status === 'draft';

  const results = sends.length
    ? sends.map((s) => `
        <div class="rec" style="display:flex;gap:10px;align-items:center">
          <span style="flex:1">${esc(s.name || s.email)}</span>
          ${s.status === 'failed'
            ? `<span class="pill" style="background:#fef2f2;color:#b91c1c;border-color:#fecaca">נכשל</span>`
            : ''}
          ${s.opened_at ? '<span class="pill">נפתח</span>' : ''}
          ${s.clicked_at ? `<span class="pill">הקליק ×${s.click_count}</span>` : ''}
        </div>`).join('')
    : '';

  page(res, 'crm-campaigns', c.name, `
    <div class="card">
      <div class="section-bar">
        <div class="card-head">✉️ ${esc(c.name)}</div>
        <a class="btn secondary sm" href="/admin/crm/campaigns">← לרשימה</a>
      </div>
      ${isDraft ? `
      <form method="POST" action="/admin/crm/campaigns/${c.id}/update" class="stack">
        <label>שם פנימי<input name="name" class="input" value="${esc(c.name)}"></label>
        <label>נושא המייל<input name="subject" class="input" value="${esc(c.subject)}"></label>
        <label>רשימת נמענים
          <select name="listId" class="input">
            <option value="">— בחרו רשימה —</option>
            ${allLists.map((l) =>
              `<option value="${l.id}" ${l.id === c.list_id ? 'selected' : ''}>${esc(l.name)} (${l.members})</option>`).join('')}
          </select>
        </label>
        <label>תוכן (HTML)<textarea name="body" class="input" rows="10" dir="auto">${esc(c.body)}</textarea></label>
        <button class="btn secondary" type="submit">שמור טיוטה</button>
      </form>` : `
        <p class="muted">נושא: <strong>${esc(c.subject)}</strong> · נשלח ב־${esc(c.sent_at || '')}</p>
        <p class="muted" style="font-size:.85rem">קמפיין שנשלח נעול — הוא הרשומה של מה שיצא בפועל.</p>`}
    </div>

    ${isDraft ? `
    <div class="card">
      <div class="card-head">📤 שליחה</div>
      <p class="lead">
        ${audience.recipients.length} נמענים יקבלו את הדיוור.
        ${audience.skippedNoConsent ? `<br><strong>${audience.skippedNoConsent}</strong> ברשימה לא נתנו הסכמה לדיוור — הם לא יקבלו.` : ''}
        ${audience.skippedNoEmail ? `<br>${audience.skippedNoEmail} ברשימה בלי כתובת מייל.` : ''}
      </p>
      ${audience.recipients.length ? `
      <form method="POST" action="/admin/crm/campaigns/${c.id}/send"
            onsubmit="return confirm('לשלוח ל-${audience.recipients.length} נמענים? אין דרך לבטל.')">
        <button class="btn" type="submit">שלח עכשיו ל-${audience.recipients.length} נמענים</button>
      </form>` : '<p class="muted">אין נמענים עם הסכמה — אין מה לשלוח.</p>'}
    </div>` : ''}

    ${results ? `
    <div class="card">
      <div class="card-head">📊 תוצאות</div>
      ${results}
    </div>` : ''}

    ${isDraft ? `
    <div class="card">
      <div class="card-head">🗑 מחיקה</div>
      <form method="POST" action="/admin/crm/campaigns/${c.id}/delete"
            onsubmit="return confirm('למחוק את הקמפיין?')">
        <button class="btn secondary" type="submit">מחק קמפיין</button>
      </form>
    </div>` : ''}`);
});

router.post('/admin/crm/campaigns/:id/update', requireAdmin, (req, res) => {
  const b = req.body || {};
  require('../crm').campaigns.updateCampaign(req.params.id, {
    name: b.name, subject: b.subject, body: b.body, listId: b.listId
  });
  res.redirect('/admin/crm/campaigns/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/campaigns/:id/send', requireAdmin, (req, res) => {
  const { campaigns } = require('../crm');
  // The public base URL has to be absolute — it ends up in someone's inbox,
  // where a relative path means nothing.
  const cfg = require('../config').loadConfig();
  const baseUrl = String(cfg.baseUrl || '').replace(/\/+$/, '') ||
    (req.protocol + '://' + req.get('host'));
  campaigns.startSend(req.params.id, { baseUrl });
  res.redirect('/admin/crm/campaigns/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/campaigns/:id/delete', requireAdmin, (req, res) => {
  require('../crm').campaigns.deleteCampaign(req.params.id);
  res.redirect('/admin/crm/campaigns');
});

// ─── server-side conversions (declared BEFORE /:id) ──────────────────
router.get('/admin/crm/conversions', requireAdmin, requireCrm('crm-conversions', 'המרות בשרת'), (req, res) => {
  const cfg = require('../config').loadConfig();
  const s = require('../crm/conversions').describeSettings(cfg);
  const pixelsOn = !!(cfg.crm && cfg.crm.pixels && cfg.crm.pixels.enabled);

  page(res, 'crm-conversions', 'המרות בשרת', `
    <div class="card">
      <div class="card-head">🛰 המרות בשרת (Conversions API)</div>
      <p class="lead">
        חוסמי פרסומות עוצרים את הפיקסל בדפדפן — דיווח מהשרת עובר.
        שתי הדיווחים נושאים <strong>אותו מזהה אירוע</strong>, כך שהספק סופר אירוע אחד.
      </p>
      ${pixelsOn ? '' : `<div class="pill" style="background:#fffbeb;color:#92400e;border-color:#fde68a">
        הפיקסלים כבויים — בלי הצד הדפדפני לא יהיה כפל לניכוי, אבל הדיווח מהשרת יעבוד</div>`}
      <form method="POST" action="/admin/crm/conversions" class="stack">
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="enabled" value="1" ${s.enabled ? 'checked' : ''}> הפעל דיווח מהשרת
        </label>

        <div class="side-title">Meta — Conversions API</div>
        <label>Pixel ID<input name="metaPixelId" class="input" dir="ltr" value="${esc(s.meta.pixelId)}"></label>
        <label>Access Token ${s.meta.hasToken ? `<span class="muted">· מוגדר (…${esc(s.meta.tokenTail)})</span>` : '<span class="muted">· לא מוגדר</span>'}
          <input name="metaAccessToken" class="input" dir="ltr" type="password" autocomplete="off"
                 placeholder="${s.meta.hasToken ? 'להחלפה — הדביקו טוקן חדש' : 'EAAG…'}"></label>
        <label>Test Event Code (לבדיקה בלבד)<input name="metaTestEventCode" class="input" dir="ltr" value="${esc(s.meta.testEventCode)}"></label>

        <div class="side-title">Google Analytics 4 — Measurement Protocol</div>
        <label>Measurement ID<input name="ga4MeasurementId" class="input" dir="ltr" value="${esc(s.ga4.measurementId)}" placeholder="G-XXXXXXX"></label>
        <label>API Secret ${s.ga4.hasSecret ? `<span class="muted">· מוגדר (…${esc(s.ga4.secretTail)})</span>` : '<span class="muted">· לא מוגדר</span>'}
          <input name="ga4ApiSecret" class="input" dir="ltr" type="password" autocomplete="off"
                 placeholder="${s.ga4.hasSecret ? 'להחלפה — הדביקו סוד חדש' : ''}"></label>

        <button class="btn" type="submit">שמור</button>
      </form>
    </div>
    <div class="card">
      <div class="card-head">מה נשלח, ומתי לא</div>
      <ul class="muted" style="font-size:.88rem;line-height:1.9;padding-inline-start:18px;margin:0">
        <li>מייל וטלפון נשלחים <strong>מגובבים</strong> (SHA-256) — לעולם לא גלויים.</li>
        <li>מבקר שדחה את בקשת האישור — <strong>לא נשלח עליו כלום</strong>, גם לא מהשרת.</li>
        <li>Do-Not-Track עוצר הכול, לפני כל בדיקה אחרת.</li>
        <li>הכתובות של הספקים קבועות בקוד — שום הגדרה לא יכולה להסיט את הטוקן ליעד אחר.</li>
        <li>שליחה איטית לא מעכבת את המבקר: יש תקרת זמן, והשליחה רצה ברקע.</li>
        <li>הסודות נשמרים בשרת בלבד ולעולם לא מוחזרים לדפדפן.</li>
      </ul>
    </div>`);
});

router.post('/admin/crm/conversions', requireAdmin, (req, res) => {
  const config = require('../config');
  const cfg = config.loadConfig();
  const b = req.body || {};
  const prev = (cfg.crm && cfg.crm.conversions) || {};
  const prevMeta = prev.meta || {};
  const prevGa4 = prev.ga4 || {};
  // An empty secret field means "keep what is stored" — never "clear it".
  const keep = (incoming, stored) => {
    const v = String(incoming || '').trim();
    return v || String(stored || '');
  };
  cfg.crm = Object.assign({}, cfg.crm, {
    conversions: {
      enabled: !!b.enabled,
      meta: {
        pixelId: String(b.metaPixelId || '').trim(),
        accessToken: keep(b.metaAccessToken, prevMeta.accessToken),
        testEventCode: String(b.metaTestEventCode || '').trim()
      },
      ga4: {
        measurementId: String(b.ga4MeasurementId || '').trim(),
        apiSecret: keep(b.ga4ApiSecret, prevGa4.apiSecret)
      }
    }
  });
  config.saveConfig(cfg);
  res.redirect('/admin/crm/conversions');
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
      <div class="card-head">👤 זכויות של האדם הזה</div>
      <p class="muted" style="font-size:.88rem">
        אם ביקש/ה לראות מה שמור עליו/ה — הורידו את הקובץ ושלחו. אם ביקש/ה מחיקה —
        השתמשו במחיקה למטה; היא מוחקת גם את ציר הזמן, הקשרים, החברות ברשימות
        והמעקב, ואז <strong>בודקת שלא נשאר כלום</strong>.
      </p>
      <a class="btn secondary" href="/admin/crm/${d.id}/export.json">⬇ ייצוא כל הנתונים (JSON)</a>
    </div>

    <div class="card">
      <div class="card-head">🗑 מחיקה</div>
      <p class="muted" style="font-size:.88rem">
        ברירת המחדל משאירה את הפניות עצמן בתיבה — הן מסמך עסקי.
        סמנו את התיבה כדי למחוק גם אותן (מחיקה מלאה, בלי דרך חזרה).
      </p>
      <form method="POST" action="/admin/crm/${d.id}/delete"
            onsubmit="return confirm('למחוק את ${esc(d.displayName)}? אין דרך לבטל.')">
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <input type="checkbox" name="deleteSubmissions" value="1">
          למחוק גם את הפניות שלו/ה מתיבת הפניות
        </label>
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

// The subject's own copy of their data. A file, not a screen — the owner has to
// be able to send it to the person who asked.
router.get('/admin/crm/:id/export.json', requireAdmin, (req, res) => {
  const data = require('../crm').subject.exportContact(req.params.id);
  if (!data) return res.status(404).json({ ok: false, error: 'not found' });
  const name = 'contact-' + String(req.params.id).replace(/\D/g, '') + '.json';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
  res.send(JSON.stringify(data, null, 2));
});

router.post('/admin/crm/:id/delete', requireAdmin, (req, res) => {
  // Erasure goes through the subject module, which verifies afterwards that
  // nothing survived rather than trusting the cascade.
  const result = require('../crm').subject.eraseContact(req.params.id, {
    deleteSubmissions: !!(req.body || {}).deleteSubmissions
  });
  if (result && result.leftovers && result.leftovers.length) {
    console.error('[crm] erase left rows behind:', result.leftovers.join(', '));
  }
  res.redirect('/admin/crm');
});

module.exports = router;
