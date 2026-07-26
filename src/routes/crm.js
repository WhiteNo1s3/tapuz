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
    <div class="card" style="max-width:640px;margin:40px auto;text-align:center">
      <div style="font-size:2.6rem;margin-bottom:10px">👥</div>
      <h2 class="sub-head" style="justify-content:center">מערכת הלקוחות כבויה</h2>
      <p class="lead">
        כשתפעילו אותה, האתר הופך לקלט ל־CRM: ביקור לגיטימי פותח
        <strong>כרטיס לקוח</strong>, מייל ושם מעשירים אותו, ודפים שביקרו בהם
        הופכים לתחומי עניין — כדי שתוכלו לדוור רלוונטי, לא ספאם.
      </p>
      <p class="muted" style="font-size:.88rem;line-height:1.55">
        בלי להרגיש «מעקב»: עוגייה בצד הראשון בלבד, בלי IP גולמי, וכרטיסים
        זמניים שנשכחים לבד אם אין אינטראקציה. כיבוי מחזיר את האתר כמו שהיה.
      </p>
      <form method="POST" action="/admin/crm/settings" style="margin-top:16px">
        <input type="hidden" name="enabled" value="1">
        <button type="submit" class="btn">הפעילו את מערכת הלקוחות</button>
      </form>
    </div>`);
}

function statusPill(status) {
  const { contacts } = require('../crm');
  const label = contacts.statusLabel(status);
  const tones = {
    provisional: 'background:#fff7ed;color:#c2410c;border-color:#fed7aa',
    lead: '',
    active: 'background:#ecfdf5;color:#047857;border-color:#a7f3d0',
    customer: 'background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe',
    archived: 'background:#f1f5f9;color:#475569;border-color:#e2e8f0',
    garbage: 'background:#fef2f2;color:#b91c1c;border-color:#fecaca'
  };
  const style = tones[status] ? ` style="${tones[status]}"` : '';
  return `<span class="pill"${style}>${esc(label)}</span>`;
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

// ─── unified inbox (v2.05, BEFORE /:id) ───────────────────────────────
// Projector over form / chat / WhatsApp / claims — never a second store.
router.get('/admin/crm/inbox', requireAdmin, requireCrm('crm-inbox', 'תיבה מאוחדת'), (req, res) => {
  const { unifiedInbox, contacts } = require('../crm');
  const channel = String((req.query || {}).channel || '');
  const q = String((req.query || {}).q || '');
  const counts = unifiedInbox.counts();
  let items = unifiedInbox.listItems({
    channel: unifiedInbox.CHANNELS.includes(channel) ? channel : '',
    state: 'open',
    q,
    limit: 120
  });
  items = unifiedInbox.attachContactNames(items);

  const flash = String((req.query || {}).ok || '');
  const flashErr = String((req.query || {}).err || '');
  const flashMsg = flash === 'handled'
    ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5">✓ סומן כטופל — המקור נשאר בערוץ שלו.</div>'
    : flash === 'linked'
      ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5">✓ קושר לכרטיס לקוח — הישות התעשרה, לא נוצר מחסן חדש.</div>'
      : flash === 'task'
        ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5">✓ נפתחה משימה על הכרטיס.</div>'
        : flash === 'note'
          ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5">✓ הערה נרשמה בציר הזמן.</div>'
          : flash === 'replied'
            ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5">✓ תשובה נשלחה בערוץ (התמלול נשאר במקור).</div>'
            : flashErr
              ? `<div class="card" style="border-color:#fecaca;background:#fef2f2">⚠ ${esc(flashErr)}</div>`
              : '';

  const channelTone = {
    form: 'background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe',
    chat: 'background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe',
    whatsapp: 'background:#ecfdf5;color:#047857;border-color:#a7f3d0',
    claim: 'background:#fff7ed;color:#c2410c;border-color:#fed7aa'
  };

  const today = require('../crm').tasks.todayUTC();
  const tiles = unifiedInbox.CHANNELS.map((ch) => `
    <a class="stat-tile" href="/admin/crm/inbox?channel=${ch}">
      <div class="stat-num">${counts[ch] || 0}</div>
      <div class="stat-label">${esc(unifiedInbox.channelLabel(ch))}</div>
    </a>`).join('') + `
    <a class="stat-tile" href="/admin/crm/inbox">
      <div class="stat-num">${counts.total || 0}</div>
      <div class="stat-label">הכול פתוח</div>
    </a>`;

  const body = items.length
    ? items.map((it) => {
        const tone = channelTone[it.channel] || '';
        const who = it.contactName
          ? `<a href="/admin/crm/${it.contactId}">${esc(it.contactName)}</a>`
          : '<span class="muted">ללא כרטיס עדיין</span>';
        const when = String(it.at || '').replace('T', ' ').slice(0, 16);
        const handleBtn =
          it.channel === 'claim'
            ? `<a class="btn sm" href="${esc(it.href)}">לטפל בתביעה</a>`
            : `<form method="POST" action="/admin/crm/inbox/handle" style="display:inline">
                 <input type="hidden" name="key" value="${esc(it.id)}">
                 <button class="btn secondary sm" type="submit">טופל</button>
               </form>`;
        const linkBtn = !it.contactId && it.channel !== 'claim'
          ? `<form method="POST" action="/admin/crm/inbox/link" style="display:inline">
               <input type="hidden" name="key" value="${esc(it.id)}">
               <button class="btn secondary sm" type="submit" title="צור/קשר כרטיס Customer">🔗 כרטיס</button>
             </form>`
          : '';
        return `
        <div class="rec" style="display:block">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
            <div style="flex:1;min-width:200px">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
                <span class="pill" style="${tone}">${esc(unifiedInbox.channelLabel(it.channel))}</span>
                <strong>${esc(it.title)}</strong>
              </div>
              <div class="muted" style="font-size:.88rem;line-height:1.45">${esc(it.preview)}</div>
              <div class="muted" style="font-size:.78rem;margin-top:6px">
                ${who} · ${esc(when)}
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <a class="btn sm" href="${esc(it.href)}">פתח בערוץ</a>
              ${it.contactId ? `<a class="btn secondary sm" href="/admin/crm/${it.contactId}">כרטיס</a>` : ''}
              ${linkBtn}
              ${handleBtn}
            </div>
          </div>
          ${it.channel !== 'claim' ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid #e2e8f0">
            <form method="POST" action="/admin/crm/inbox/task" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1">
              <input type="hidden" name="key" value="${esc(it.id)}">
              <input name="title" class="input" style="flex:1;min-width:140px" placeholder="משימה (מעקב…)"
                     value="${esc('מעקב: ' + String(it.title || '').slice(0, 40))}">
              <input name="dueAt" type="date" class="input" style="width:auto" value="${esc(today)}">
              <button class="btn secondary sm" type="submit">✅ משימה</button>
            </form>
            <form method="POST" action="/admin/crm/inbox/note" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1">
              <input type="hidden" name="key" value="${esc(it.id)}">
              <input name="text" class="input" style="flex:1;min-width:140px" placeholder="הערה לכרטיס…" required>
              <button class="btn secondary sm" type="submit">📝 הערה</button>
            </form>
          </div>` : ''}
          ${it.channel === 'chat' || it.channel === 'whatsapp' ? `
          <form method="POST" action="/admin/crm/inbox/reply"
                style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
            <input type="hidden" name="key" value="${esc(it.id)}">
            <input name="text" class="input" style="flex:1;min-width:180px" required
                   placeholder="${it.channel === 'whatsapp'
                     ? 'תשובת WhatsApp (טקסט — דורש חלון שירות פתוח)'
                     : 'תשובה בצ׳אט (נשמרת כהודעת נציג, בלי AI)'}">
            <button class="btn sm" type="submit">${it.channel === 'whatsapp' ? '📗 שלח WA' : '💬 השב'}</button>
          </form>` : ''}
        </div>`;
      }).join('')
    : `<div class="empty-state">
         <div style="font-size:2rem;margin-bottom:8px">📥</div>
         התיבה נקייה — אין פריטים פתוחים
         ${channel ? ' בערוץ הזה' : ''}.
         <div class="muted" style="margin-top:8px;font-size:.88rem">
           טפסים, צ׳אט, WhatsApp ותביעות זהות נכנסים לכאן בלי לערבב את המחסנים שלהם.
         </div>
       </div>`;

  page(res, 'crm-inbox', 'תיבה מאוחדת', `
    ${flashMsg}
    <p class="lead" style="margin-top:0">
      <strong>תור אחד שמשרת</strong> — קשירה לכרטיס, משימה, הערה, טופל —
      בלי למזג טבלאות. ה־Customer הוא הישות; הערוץ נשאר מקור האמת.
    </p>
    <div class="stat-row">${tiles}</div>
    <div class="card">
      <div class="section-bar">
        <div class="card-head">📥 ממתינים לטיפול · ${items.length}</div>
        <form method="GET" action="/admin/crm/inbox" style="display:flex;gap:8px;flex-wrap:wrap">
          <input name="q" class="input" value="${esc(q)}" placeholder="חיפוש…">
          <select name="channel" class="input" style="width:auto" onchange="this.form.submit()">
            <option value="">כל הערוצים</option>
            ${unifiedInbox.CHANNELS.map((ch) =>
              `<option value="${ch}" ${ch === channel ? 'selected' : ''}>${esc(unifiedInbox.channelLabel(ch))}</option>`
            ).join('')}
          </select>
          <button class="btn secondary sm" type="submit">סנן</button>
        </form>
      </div>
      ${body}
    </div>
    <div class="card">
      <div class="card-head">איך זה לא מתבלגן</div>
      <ul class="muted" style="font-size:.88rem;line-height:1.7;margin:0;padding-inline-start:1.2rem">
        <li><strong>🔗 כרטיס</strong> — יוצר/מקשר Customer מהפריט (מייל/טלפון), בלי שכפול ערוץ.</li>
        <li><strong>✅ משימה / 📝 הערה</strong> — נכתבים על הישות, לא על «הודעה זמנית».</li>
        <li>טפסים נשארים ב־<a href="/admin/inbox">צינור לידים</a> לעומק (ערך/מעקב).</li>
        <li>תביעות זהות רק באישור — לא «טופל» מהתור.</li>
      </ul>
    </div>`);
});

router.post('/admin/crm/inbox/handle', requireAdmin, (req, res) => {
  const key = String((req.body || {}).key || '');
  const r = require('../crm').unifiedInbox.markHandled(key);
  if (r && r.ok) return res.redirect('/admin/crm/inbox?ok=handled');
  if (r && r.error === 'use-approve-or-reject') {
    return res.redirect('/admin/crm/claims');
  }
  res.redirect('/admin/crm/inbox');
});

router.post('/admin/crm/inbox/link', requireAdmin, (req, res) => {
  const key = String((req.body || {}).key || '');
  const r = require('../crm').unifiedInbox.ensureContactForItem(key);
  if (r && r.ok) return res.redirect('/admin/crm/inbox?ok=linked');
  const errMap = {
    'no-identity': 'אין מייל/טלפון בפריט — אי אפשר לפתוח כרטיס',
    missing: 'הפריט לא נמצא',
    'use-approve': 'תביעת זהות — אשרו במסך התביעות'
  };
  res.redirect(
    '/admin/crm/inbox?err=' + encodeURIComponent(errMap[r && r.error] || (r && r.error) || 'שגיאה')
  );
});

router.post('/admin/crm/inbox/task', requireAdmin, (req, res) => {
  const b = req.body || {};
  const r = require('../crm').unifiedInbox.createTaskFromItem(String(b.key || ''), {
    title: b.title,
    dueAt: b.dueAt,
    kind: 'followup'
  });
  if (r && r.ok) return res.redirect('/admin/crm/inbox?ok=task');
  res.redirect(
    '/admin/crm/inbox?err=' +
      encodeURIComponent(
        r && r.error === 'no-identity'
          ? 'קודם קשרו כרטיס (מייל/טלפון) או מלאו זהות בפריט'
          : (r && r.error) || 'לא נוצרה משימה'
      )
  );
});

router.post('/admin/crm/inbox/note', requireAdmin, (req, res) => {
  const b = req.body || {};
  const r = require('../crm').unifiedInbox.addNoteFromItem(String(b.key || ''), b.text);
  if (r && r.ok) return res.redirect('/admin/crm/inbox?ok=note');
  res.redirect(
    '/admin/crm/inbox?err=' +
      encodeURIComponent(
        r && r.error === 'no-identity'
          ? 'קודם קשרו כרטיס — הערה שייכת לישות'
          : (r && r.error) || 'ההערה לא נשמרה'
      )
  );
});

router.post('/admin/crm/inbox/reply', requireAdmin, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await require('../crm').unifiedInbox.replyFromItem(String(b.key || ''), b.text);
    if (r && r.ok) return res.redirect('/admin/crm/inbox?ok=replied');
    const he = {
      empty: 'כתבו תשובה',
      missing: 'השיחה לא נמצאה',
      closed: 'השיחה כבר סגורה',
      channel: 'תשובה זמינה רק לצ׳אט ו־WhatsApp',
      csw_closed_use_template: 'חלון השירות ב־WhatsApp סגור — השתמשו בתבנית במסך WhatsApp',
      marketing_opt_in_required: 'נדרשת הסכמת WhatsApp לשיווק',
      whatsapp_disabled: 'WhatsApp כבוי בהגדרות',
      graph_error: 'שליחת WhatsApp נכשלה (Meta)',
      invalid_message: 'הודעה לא תקינה',
      messaging_limit_reached: 'מגבלת WhatsApp יומית'
    };
    return res.redirect(
      '/admin/crm/inbox?err=' + encodeURIComponent(he[r && r.error] || (r && r.error) || 'שליחה נכשלה')
    );
  } catch (e) {
    return res.redirect('/admin/crm/inbox?err=' + encodeURIComponent(e.message || 'שגיאה'));
  }
});

// ─── companies (v2.09, BEFORE /:id) ──────────────────────────────────
router.get('/admin/crm/companies', requireAdmin, requireCrm('crm-companies', 'חברות'), (req, res) => {
  const { companies } = require('../crm');
  const q = String((req.query || {}).q || '');
  const rows = companies.listCompanies({ q, limit: 100 });
  const list = rows.length
    ? rows.map((c) => `
        <a class="rec" href="/admin/crm/companies/${c.id}" style="display:flex;gap:12px;text-decoration:none;flex-wrap:wrap">
          <div style="flex:1">
            <strong>${esc(c.name)}</strong>
            <div class="muted" style="font-size:.82rem" dir="ltr">${esc(c.domain || '')} ${esc(c.phone || '')}</div>
          </div>
          <span class="pill">${companies.memberCount(c.id)} אנשים</span>
        </a>`).join('')
    : '<div class="empty-state">אין חברות — צרו חברה וקשרו אליה אנשי קשר.</div>';

  page(res, 'crm-companies', 'חברות', `
    <p class="lead" style="margin-top:0">
      ארגונים תלויים ב־Customer — לא אנשים מקבילים. חברה = ישות B2B; אנשים נקשרים אליה.
    </p>
    <div class="card">
      <div class="section-bar">
        <div class="card-head">🏢 חברות · ${rows.length}</div>
        <form method="GET" action="/admin/crm/companies">
          <input name="q" class="input" value="${esc(q)}" placeholder="חיפוש…">
        </form>
      </div>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">חברה חדשה</div>
      <form method="POST" action="/admin/crm/companies" class="stack">
        <label>שם<input name="name" class="input" required placeholder="סטודיו תפוז בע״מ"></label>
        <label>דומיין<input name="domain" class="input" dir="ltr" placeholder="example.com"></label>
        <label>טלפון<input name="phone" class="input" dir="ltr"></label>
        <label>הערות<textarea name="notes" class="input" rows="2"></textarea></label>
        <button class="btn" type="submit">צור חברה</button>
      </form>
    </div>`);
});

router.post('/admin/crm/companies', requireAdmin, (req, res) => {
  try {
    const c = require('../crm').companies.createCompany(req.body || {});
    if (c) return res.redirect('/admin/crm/companies/' + c.id);
  } catch (e) { /* */ }
  res.redirect('/admin/crm/companies');
});

router.get('/admin/crm/companies/:id', requireAdmin, requireCrm('crm-companies', 'חברה'), (req, res) => {
  const { companies, contacts, deals } = require('../crm');
  const c = companies.getCompany(req.params.id);
  if (!c) return res.status(404).send(layout('<div class="container">חברה לא נמצאה</div>', 'לא נמצא', ACCENT));
  const members = companies.membersOf(c.id);
  const companyDeals = deals.listDeals({ companyId: c.id, limit: 40 });
  const people = contacts.listContacts({ limit: 80 }).filter((p) =>
    p.status !== 'garbage' && p.status !== 'provisional'
  );

  page(res, 'crm-companies', c.name, `
    <div class="card">
      <div class="section-bar">
        <div class="card-head">🏢 ${esc(c.name)}</div>
        <a class="btn secondary sm" href="/admin/crm/companies">← לרשימה</a>
      </div>
      <form method="POST" action="/admin/crm/companies/${c.id}" class="stack">
        <label>שם<input name="name" class="input" value="${esc(c.name)}" required></label>
        <label>דומיין<input name="domain" class="input" dir="ltr" value="${esc(c.domain || '')}"></label>
        <label>טלפון<input name="phone" class="input" dir="ltr" value="${esc(c.phone || '')}"></label>
        <label>הערות<textarea name="notes" class="input" rows="3">${esc(c.notes || '')}</textarea></label>
        <button class="btn" type="submit">שמור</button>
      </form>
    </div>
    <div class="card">
      <div class="card-head">אנשים בחברה · ${members.length}</div>
      ${members.length
        ? members.map((m) => `
          <div class="rec" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <a href="/admin/crm/${m.id}" style="flex:1">${esc(m.name || m.email || m.phone || '#' + m.id)}</a>
            <span class="pill">${esc(m.company_role || 'member')}</span>
            <form method="POST" action="/admin/crm/companies/${c.id}/unlink">
              <input type="hidden" name="contactId" value="${m.id}">
              <button class="btn secondary sm" type="submit">הסר</button>
            </form>
          </div>`).join('')
        : '<p class="muted">עדיין אין חברים.</p>'}
      <form method="POST" action="/admin/crm/companies/${c.id}/link" class="stack" style="margin-top:12px">
        <label>הוסף איש קשר
          <select name="contactId" class="input" required>
            <option value="">— בחרו —</option>
            ${people.map((p) => {
              const label = [p.name, p.email, p.phone].filter(Boolean).join(' · ');
              return `<option value="${p.id}">${esc(label)}</option>`;
            }).join('')}
          </select>
        </label>
        <label>תפקיד<input name="role" class="input" value="member" placeholder="member / decision-maker"></label>
        <button class="btn secondary sm" type="submit">קשר</button>
      </form>
    </div>
    <div class="card">
      <div class="card-head">עסקאות · ${companyDeals.length}
        <a class="btn secondary sm" href="/admin/crm/deals?companyId=${c.id}">הכול</a>
      </div>
      ${companyDeals.length
        ? companyDeals.map((d) => `
          <a class="rec" href="/admin/crm/deals/${d.id}" style="display:flex;gap:8px;text-decoration:none">
            <strong style="flex:1">${esc(d.title)}</strong>
            <span class="pill">${esc(deals.stageLabel(d.stage))}</span>
            ${d.amount != null ? `<span>₪${esc(String(d.amount))}</span>` : ''}
          </a>`).join('')
        : '<p class="muted">אין עסקאות — צרו ב־<a href="/admin/crm/deals">עסקאות</a>.</p>'}
    </div>
    <div class="card">
      <form method="POST" action="/admin/crm/companies/${c.id}/delete"
            onsubmit="return confirm('למחוק חברה? העסקאות יישארו בלי חברה.')">
        <button class="btn secondary sm" type="submit">מחק חברה</button>
      </form>
    </div>`);
});

router.post('/admin/crm/companies/:id', requireAdmin, (req, res) => {
  require('../crm').companies.updateCompany(req.params.id, req.body || {});
  res.redirect('/admin/crm/companies/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/companies/:id/link', requireAdmin, (req, res) => {
  const b = req.body || {};
  require('../crm').companies.linkContact(req.params.id, b.contactId, b.role);
  res.redirect('/admin/crm/companies/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/companies/:id/unlink', requireAdmin, (req, res) => {
  require('../crm').companies.unlinkContact(req.params.id, (req.body || {}).contactId);
  res.redirect('/admin/crm/companies/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/companies/:id/delete', requireAdmin, (req, res) => {
  require('../crm').companies.deleteCompany(req.params.id);
  res.redirect('/admin/crm/companies');
});

// ─── deals (v2.09, BEFORE /:id) ──────────────────────────────────────
router.get('/admin/crm/deals', requireAdmin, requireCrm('crm-deals', 'עסקאות'), (req, res) => {
  const { deals, contacts, companies } = require('../crm');
  const stage = String((req.query || {}).stage || '');
  const companyId = (req.query || {}).companyId || '';
  const rows = deals.listDeals({
    stage: deals.STAGES.includes(stage) ? stage : '',
    companyId: companyId ? Number(companyId) : undefined,
    limit: 100
  });
  const summary = deals.pipelineSummary();
  const fmt = (n) => new Intl.NumberFormat('he-IL').format(Math.round(n || 0));

  const tiles = deals.STAGES.map((s) => `
    <a class="stat-tile" href="/admin/crm/deals?stage=${s}">
      <div class="stat-num">${summary.byStage[s].n}</div>
      <div class="stat-label">${esc(deals.stageLabel(s))}</div>
    </a>`).join('');

  const list = rows.length
    ? rows.map((d) => `
        <a class="rec" href="/admin/crm/deals/${d.id}" style="display:flex;gap:10px;flex-wrap:wrap;text-decoration:none;align-items:center">
          <div style="flex:1;min-width:140px">
            <strong>${esc(d.title)}</strong>
            <div class="muted" style="font-size:.8rem">
              ${d.contact_name || d.contact_email ? esc(d.contact_name || d.contact_email) : ''}
              ${d.company_name ? ' · ' + esc(d.company_name) : ''}
            </div>
          </div>
          <span class="pill">${esc(deals.stageLabel(d.stage))}</span>
          ${d.amount != null ? `<strong>₪${fmt(d.amount)}</strong>` : ''}
          ${d.expected_close ? `<span class="muted" style="font-size:.8rem">${esc(d.expected_close)}</span>` : ''}
        </a>`).join('')
    : '<div class="empty-state">אין עסקאות — צרו עסקה על איש קשר או חברה.</div>';

  const people = contacts.listContacts({ limit: 60 }).filter((c) =>
    c.email || c.phone || c.name
  );
  const cos = companies.listCompanies({ limit: 60 });

  page(res, 'crm-deals', 'עסקאות', `
    <p class="lead" style="margin-top:0">
      הזדמנויות תלויות ב־Customer / חברה — צינור מכירות עם ערך, לא רק סטטוס איש קשר.
    </p>
    <div class="stat-row">
      <div class="stat-tile">
        <div class="stat-num">₪${fmt(summary.open.value)}</div>
        <div class="stat-label">פתוח · ${summary.open.n}</div>
      </div>
      ${tiles}
    </div>
    <div class="card">
      <div class="section-bar">
        <div class="card-head">💼 עסקאות</div>
        <a class="btn secondary sm" href="/admin/crm/deals">הכול</a>
      </div>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">עסקה חדשה</div>
      <form method="POST" action="/admin/crm/deals" class="stack">
        <label>כותרת<input name="title" class="input" required placeholder="אתר תדמית + CRM"></label>
        <label>איש קשר
          <select name="contactId" class="input">
            <option value="">— אופציונלי אם יש חברה —</option>
            ${people.map((p) =>
              `<option value="${p.id}">${esc([p.name, p.email].filter(Boolean).join(' · '))}</option>`
            ).join('')}
          </select>
        </label>
        <label>חברה
          <select name="companyId" class="input">
            <option value="">— אופציונלי —</option>
            ${cos.map((co) => `<option value="${co.id}" ${String(co.id) === String(companyId) ? 'selected' : ''}>${esc(co.name)}</option>`).join('')}
          </select>
        </label>
        <label>שלב
          <select name="stage" class="input">
            ${deals.STAGES.map((s) =>
              `<option value="${s}">${esc(deals.stageLabel(s))}</option>`).join('')}
          </select>
        </label>
        <label>סכום (₪)<input name="amount" type="number" min="0" step="1" class="input" dir="ltr"></label>
        <label>סגירה צפויה<input name="expectedClose" type="date" class="input"></label>
        <label>הערות<textarea name="notes" class="input" rows="2"></textarea></label>
        <button class="btn" type="submit">צור עסקה</button>
      </form>
    </div>`);
});

router.post('/admin/crm/deals', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const d = require('../crm').deals.createDeal({
      title: b.title,
      contactId: b.contactId,
      companyId: b.companyId,
      amount: b.amount,
      stage: b.stage,
      expectedClose: b.expectedClose,
      notes: b.notes
    });
    if (d && d.contact_id) {
      try {
        require('../crm').events.record({
          contactId: d.contact_id,
          type: 'deal',
          title: 'עסקה: ' + d.title
        });
      } catch (e) { /* */ }
    }
    if (d) return res.redirect('/admin/crm/deals/' + d.id);
  } catch (e) {
    return res.redirect('/admin/crm/deals?err=' + encodeURIComponent(e.message || 'שגיאה'));
  }
  res.redirect('/admin/crm/deals');
});

router.get('/admin/crm/deals/:id', requireAdmin, requireCrm('crm-deals', 'עסקה'), (req, res) => {
  const { deals, contacts, companies } = require('../crm');
  const d = deals.getDeal(req.params.id);
  if (!d) return res.status(404).send(layout('<div class="container">עסקה לא נמצאה</div>', 'לא נמצא', ACCENT));
  const people = contacts.listContacts({ limit: 80 });
  const cos = companies.listCompanies({ limit: 80 });

  page(res, 'crm-deals', d.title, `
    <div class="card">
      <div class="section-bar">
        <div class="card-head">💼 ${esc(d.title)}</div>
        <a class="btn secondary sm" href="/admin/crm/deals">← לרשימה</a>
      </div>
      <form method="POST" action="/admin/crm/deals/${d.id}" class="stack">
        <label>כותרת<input name="title" class="input" value="${esc(d.title)}" required></label>
        <label>איש קשר
          <select name="contactId" class="input">
            <option value="">—</option>
            ${people.map((p) =>
              `<option value="${p.id}" ${Number(p.id) === Number(d.contact_id) ? 'selected' : ''}>${esc([p.name, p.email].filter(Boolean).join(' · ') || '#' + p.id)}</option>`
            ).join('')}
          </select>
        </label>
        <label>חברה
          <select name="companyId" class="input">
            <option value="">—</option>
            ${cos.map((co) =>
              `<option value="${co.id}" ${Number(co.id) === Number(d.company_id) ? 'selected' : ''}>${esc(co.name)}</option>`
            ).join('')}
          </select>
        </label>
        <label>שלב
          <select name="stage" class="input">
            ${deals.STAGES.map((s) =>
              `<option value="${s}" ${s === d.stage ? 'selected' : ''}>${esc(deals.stageLabel(s))}</option>`).join('')}
          </select>
        </label>
        <label>סכום<input name="amount" type="number" min="0" step="1" class="input" dir="ltr"
          value="${d.amount != null ? esc(String(d.amount)) : ''}"></label>
        <label>סגירה צפויה<input name="expectedClose" type="date" class="input"
          value="${esc(d.expected_close || '')}"></label>
        <label>הערות<textarea name="notes" class="input" rows="3">${esc(d.notes || '')}</textarea></label>
        <button class="btn" type="submit">שמור</button>
      </form>
      ${d.contact_id ? `<p class="muted"><a href="/admin/crm/${d.contact_id}">← לכרטיס איש הקשר</a></p>` : ''}
      ${d.company_id ? `<p class="muted"><a href="/admin/crm/companies/${d.company_id}">← לחברה</a></p>` : ''}
    </div>
    <div class="card">
      <form method="POST" action="/admin/crm/deals/${d.id}/delete" onsubmit="return confirm('למחוק עסקה?')">
        <button class="btn secondary sm" type="submit">מחק עסקה</button>
      </form>
    </div>`);
});

router.post('/admin/crm/deals/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  require('../crm').deals.updateDeal(req.params.id, {
    title: b.title,
    contactId: b.contactId,
    companyId: b.companyId,
    amount: b.amount,
    stage: b.stage,
    expectedClose: b.expectedClose,
    notes: b.notes
  });
  res.redirect('/admin/crm/deals/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/deals/:id/delete', requireAdmin, (req, res) => {
  require('../crm').deals.deleteDeal(req.params.id);
  res.redirect('/admin/crm/deals');
});

// ─── email sequences / drip (v2.03, BEFORE /:id) ─────────────────────
router.get('/admin/crm/sequences', requireAdmin, requireCrm('crm-sequences', 'רצפי מייל'), (req, res) => {
  const { sequences } = require('../crm');
  const rows = sequences.listSequences();
  const smtp = require('../notify').getSettings();
  const list = rows.length
    ? rows.map((s) => `
        <a class="rec" href="/admin/crm/sequences/${s.id}" style="display:flex;gap:12px;align-items:center;text-decoration:none;flex-wrap:wrap">
          <div style="flex:1">
            <strong>${esc(s.name)}</strong>
            <div class="muted" style="font-size:.82rem">${s.stepCount} שלבים · ${s.activeEnrollments} רשומים פעילים</div>
          </div>
          <span class="pill">${s.active ? 'פעיל' : 'כבוי'}</span>
        </a>`).join('')
    : '<div class="empty-state">אין רצפים — צרו את הראשון (ברוכים הבאים, טיפוח ליד, אחרי רכישה…).</div>';

  page(res, 'crm-sequences', 'רצפי מייל', `
    <p class="lead" style="margin-top:0">
      מיילים מרובי־שלבים — כמו HubSpot Sequences, על ה־SMTP שלכם.
      רק למי שנתן <strong>הסכמה לדיוור</strong>; הסרה בלחיצה עוצרת את הרצף.
    </p>
    ${smtp.smtpReady
      ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5"><strong>SMTP מוכן</strong> — הרצף יישלח ברקע יומי.</div>'
      : '<div class="card" style="border-color:#fde68a;background:#fffbeb"><strong>SMTP לא מוכן</strong> — אפשר לבנות רצף, שליחה תחכה ל־<a href="/admin/integrations">אינטגרציות</a>.</div>'}
    <div class="card">
      <div class="card-head">🔁 רצפים</div>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">רצף חדש</div>
      <form method="POST" action="/admin/crm/sequences" class="stack">
        <label>שם<input name="name" class="input" required placeholder="טיפוח לידים — 3 מיילים"></label>
        <button class="btn" type="submit">צור רצף</button>
      </form>
    </div>`);
});

router.post('/admin/crm/sequences', requireAdmin, (req, res) => {
  try {
    const s = require('../crm').sequences.createSequence((req.body || {}).name);
    if (s) return res.redirect('/admin/crm/sequences/' + s.id);
  } catch (e) { /* */ }
  res.redirect('/admin/crm/sequences');
});

// Literal path before /:id — "enrollments" must not become a sequence id.
router.post('/admin/crm/sequences/enrollments/:enrollId/cancel', requireAdmin, (req, res) => {
  const e = require('../db').db
    .prepare('SELECT sequence_id FROM crm_sequence_enrollments WHERE id = ?')
    .get(Number(req.params.enrollId));
  require('../crm').sequences.cancelEnrollment(req.params.enrollId);
  res.redirect(e ? '/admin/crm/sequences/' + e.sequence_id : '/admin/crm/sequences');
});

router.get('/admin/crm/sequences/:id', requireAdmin, requireCrm('crm-sequences', 'רצף'), (req, res) => {
  const { sequences, contacts } = require('../crm');
  const s = sequences.getSequence(req.params.id);
  if (!s) return res.status(404).send(layout('<div class="container">רצף לא נמצא</div>', 'לא נמצא', ACCENT));
  const enrolls = sequences.listEnrollments(s.id, { limit: 50 });
  const recent = contacts.listContacts({ limit: 40 }).filter((c) =>
    c.consent && c.email && c.status !== 'garbage' && c.status !== 'provisional'
  );

  const stepsHtml = s.steps.length
    ? s.steps.map((st, i) => `
        <div class="rec" style="display:block">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
            <span class="pill">שלב ${i + 1}</span>
            <span class="muted" style="font-size:.82rem">המתנה ${st.delay_days} ימים ${i === 0 ? '(לפני השליחה הראשונה)' : '(אחרי השלב הקודם)'}</span>
          </div>
          <form method="POST" action="/admin/crm/sequences/${s.id}/steps/${st.id}" class="stack">
            <label>ימי המתנה<input name="delayDays" type="number" min="0" max="365" class="input" value="${Number(st.delay_days) || 0}"></label>
            <label>נושא<input name="subject" class="input" value="${esc(st.subject)}" required></label>
            <label>תוכן (HTML)
              <textarea name="body" class="input" rows="5" dir="auto">${esc(st.body)}</textarea></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn secondary sm" type="submit">שמור שלב</button>
            </div>
          </form>
          <form method="POST" action="/admin/crm/sequences/${s.id}/steps/${st.id}/delete"
                onsubmit="return confirm('למחוק שלב?')" style="margin-top:6px">
            <button class="btn secondary sm" type="submit">מחק שלב</button>
          </form>
        </div>`).join('')
    : '<div class="empty-state">עדיין אין שלבים — הוסיפו את המייל הראשון.</div>';

  const enrollHtml = enrolls.length
    ? enrolls.map((e) => `
        <div class="rec" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <div style="flex:1">
            <a href="/admin/crm/${e.contact_id}">${esc(e.contact_name || e.contact_email || '#' + e.contact_id)}</a>
            <div class="muted" style="font-size:.8rem">שלב ${e.step_index + 1} · ${esc(e.status)}
              ${e.next_run_at ? ' · הבא: ' + esc(e.next_run_at) : ''}</div>
          </div>
          ${e.status === 'active' ? `
            <form method="POST" action="/admin/crm/sequences/enrollments/${e.id}/cancel">
              <button class="btn secondary sm" type="submit">עצור</button>
            </form>` : `<span class="pill">${esc(e.status)}</span>`}
        </div>`).join('')
    : '<div class="muted" style="font-size:.88rem">עדיין אין נרשמים.</div>';

  page(res, 'crm-sequences', s.name, `
    <div class="card">
      <div class="section-bar">
        <div class="card-head">🔁 ${esc(s.name)}</div>
        <a class="btn secondary sm" href="/admin/crm/sequences">← לרשימה</a>
      </div>
      <form method="POST" action="/admin/crm/sequences/${s.id}" class="stack">
        <label>שם<input name="name" class="input" value="${esc(s.name)}"></label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="active" value="1" ${s.active ? 'checked' : ''}> רצף פעיל (שולח ברקע)
        </label>
        <button class="btn secondary sm" type="submit">שמור</button>
      </form>
    </div>
    <div class="card">
      <div class="card-head">שלבים</div>
      <p class="muted" style="font-size:.85rem">אפשר {{name}} ו־{{email}}. קישור הסרה מתווסף אוטומטית.</p>
      ${stepsHtml}
      <form method="POST" action="/admin/crm/sequences/${s.id}/steps" class="stack" style="margin-top:12px;border-top:1px solid #e2e8f0;padding-top:12px">
        <div class="card-head" style="font-size:1rem">שלב חדש</div>
        <label>ימי המתנה<input name="delayDays" type="number" min="0" max="365" class="input" value="${s.steps.length ? 2 : 0}"></label>
        <label>נושא<input name="subject" class="input" required placeholder="שלום {{name}}, …"></label>
        <label>תוכן<textarea name="body" class="input" rows="4" dir="auto" required
          placeholder="<p>היי {{name}},</p><p>…</p>"></textarea></label>
        <button class="btn" type="submit">הוסף שלב</button>
      </form>
    </div>
    <div class="card">
      <div class="card-head">רישום לאדם</div>
      <form method="POST" action="/admin/crm/sequences/${s.id}/enroll" class="stack">
        <label>איש קשר (רק עם מייל + הסכמה)
          <select name="contactId" class="input" required>
            <option value="">— בחרו —</option>
            ${recent.map((c) => {
              const label = [c.name, c.email].filter(Boolean).join(' · ');
              return `<option value="${c.id}">${esc(label)}</option>`;
            }).join('')}
          </select>
        </label>
        <button class="btn" type="submit">רשום לרצף</button>
      </form>
      <div style="margin-top:14px">${enrollHtml}</div>
    </div>
    <div class="card">
      <form method="POST" action="/admin/crm/sequences/${s.id}/process">
        <button class="btn secondary sm" type="submit">עבד שליחות ממתינות עכשיו</button>
      </form>
      <p class="muted" style="font-size:.8rem;margin-top:8px">בדרך כלל רץ פעם ביום עם תחזוקת ה־CRM.</p>
    </div>
    <div class="card">
      <form method="POST" action="/admin/crm/sequences/${s.id}/delete"
            onsubmit="return confirm('למחוק את הרצף וכל הרישומים?')">
        <button class="btn secondary sm" type="submit">מחק רצף</button>
      </form>
    </div>`);
});

router.post('/admin/crm/sequences/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  require('../crm').sequences.updateSequence(req.params.id, {
    name: b.name,
    active: !!b.active
  });
  res.redirect('/admin/crm/sequences/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/sequences/:id/steps', requireAdmin, (req, res) => {
  const b = req.body || {};
  require('../crm').sequences.addStep(req.params.id, {
    delayDays: b.delayDays,
    subject: b.subject,
    body: b.body
  });
  res.redirect('/admin/crm/sequences/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/sequences/:id/steps/:stepId', requireAdmin, (req, res) => {
  const b = req.body || {};
  require('../crm').sequences.updateStep(req.params.stepId, {
    delayDays: b.delayDays,
    subject: b.subject,
    body: b.body
  });
  res.redirect('/admin/crm/sequences/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/sequences/:id/steps/:stepId/delete', requireAdmin, (req, res) => {
  require('../crm').sequences.deleteStep(req.params.stepId);
  res.redirect('/admin/crm/sequences/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/sequences/:id/enroll', requireAdmin, (req, res) => {
  require('../crm').sequences.enroll(req.params.id, (req.body || {}).contactId);
  res.redirect('/admin/crm/sequences/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/sequences/:id/process', requireAdmin, async (req, res) => {
  try {
    await require('../crm').sequences.processDue({ limit: 30 });
  } catch (e) { /* */ }
  res.redirect('/admin/crm/sequences/' + encodeURIComponent(req.params.id));
});

router.post('/admin/crm/sequences/:id/delete', requireAdmin, (req, res) => {
  require('../crm').sequences.deleteSequence(req.params.id);
  res.redirect('/admin/crm/sequences');
});

// ─── status kanban (v2.01, BEFORE /:id) ──────────────────────────────
router.get('/admin/crm/board', requireAdmin, requireCrm('crm-board', 'לוח סטטוסים'), (req, res) => {
  const { contacts, tasks: taskMod } = require('../crm');
  // Working columns — garbage is a trash queue, not a sales stage; show at end.
  const columns = ['provisional', 'lead', 'active', 'customer', 'archived', 'garbage'];
  const openTaskCounts = {};
  try {
    const { db } = require('../db');
    for (const row of db
      .prepare(
        `SELECT contact_id AS id, COUNT(*) AS n FROM crm_tasks
         WHERE status = 'open' GROUP BY contact_id`
      )
      .all()) {
      openTaskCounts[row.id] = row.n;
    }
  } catch (e) { /* */ }

  const colsHtml = columns
    .map((st) => {
      const rows = contacts.listByStatus(st, { limit: 60 });
      const count = contacts.statusCounts()[st] || 0;
      const cards = rows.length
        ? rows
            .map((row) => {
              const name = row.name || row.email || row.phone || ('#' + row.id);
              const sub = [row.email, row.phone].filter(Boolean).join(' · ');
              const tc = openTaskCounts[row.id] || 0;
              const moves = columns
                .filter((s) => s !== st)
                .map(
                  (s) =>
                    `<option value="${s}">→ ${esc(contacts.statusLabel(s))}</option>`
                )
                .join('');
              return `
              <div class="kanban-card" draggable="true" data-id="${row.id}" data-status="${st}">
                <a href="/admin/crm/${row.id}" style="text-decoration:none;color:inherit">
                  <strong style="display:block;font-size:.92rem">${esc(name)}</strong>
                  ${sub ? `<div class="muted" style="font-size:.75rem;margin-top:2px">${esc(sub)}</div>` : ''}
                </a>
                ${tc ? `<div class="muted" style="font-size:.72rem;margin-top:4px">✅ ${tc} משימות</div>` : ''}
                <form method="POST" action="/admin/crm/board/move" style="margin-top:8px">
                  <input type="hidden" name="contactId" value="${row.id}">
                  <select name="status" class="input" style="font-size:.78rem;padding:4px 6px;width:100%"
                          onchange="this.form.submit()">
                    <option value="">העבר…</option>
                    ${moves}
                  </select>
                </form>
              </div>`;
            })
            .join('')
        : `<div class="muted" style="font-size:.8rem;padding:8px 4px">ריק</div>`;
      const more = count > rows.length
        ? `<div class="muted" style="font-size:.75rem;margin-top:6px">+${count - rows.length} נוספים ברשימה</div>`
        : '';
      return `
        <div class="kanban-col" data-status="${st}">
          <div class="kanban-col-head">
            <span>${esc(contacts.statusLabel(st))}</span>
            <span class="pill" style="font-size:.72rem">${count}</span>
          </div>
          <div class="kanban-col-body" data-drop-status="${st}">
            ${cards}${more}
          </div>
        </div>`;
    })
    .join('');

  page(res, 'crm-board', 'לוח סטטוסים', `
    <style>
      .kanban-wrap { display:flex; gap:10px; overflow-x:auto; padding-bottom:12px; align-items:flex-start; }
      .kanban-col { flex:0 0 220px; background:var(--ws-panel,#f8fafc); border:1px solid var(--ws-border,#e2e8f0);
                    border-radius:12px; min-height:280px; display:flex; flex-direction:column; }
      .kanban-col-head { display:flex; justify-content:space-between; align-items:center; gap:8px;
                         padding:10px 12px; font-weight:700; font-size:.9rem; border-bottom:1px solid var(--ws-border,#e2e8f0); }
      .kanban-col-body { padding:8px; display:flex; flex-direction:column; gap:8px; flex:1; min-height:120px; }
      .kanban-col-body.drag-over { outline:2px dashed #ea580c; outline-offset:-2px; background:#fff7ed; }
      .kanban-card { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:10px;
                     box-shadow:0 1px 2px rgba(15,23,42,.04); cursor:grab; }
      .kanban-card:active { cursor:grabbing; }
      .kanban-card.dragging { opacity:.5; }
    </style>
    <p class="lead" style="margin-top:0">
      צינור מכירות ויזואלי — גררו כרטיס בין עמודות, או בחרו סטטוס מהרשימה.
      אותו אדם, אותו כרטיס; רק השלב משתנה.
    </p>
    <div class="kanban-wrap">${colsHtml}</div>
    <p class="muted" style="font-size:.82rem">
      <a href="/admin/crm">רשימה מלאה</a> · <a href="/admin/crm/tasks">משימות</a>
    </p>
    <script>
    (function () {
      var dragId = null;
      document.querySelectorAll('.kanban-card').forEach(function (card) {
        card.addEventListener('dragstart', function (e) {
          dragId = card.getAttribute('data-id');
          card.classList.add('dragging');
          e.dataTransfer.setData('text/plain', dragId);
          e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', function () {
          card.classList.remove('dragging');
          dragId = null;
          document.querySelectorAll('.kanban-col-body').forEach(function (b) {
            b.classList.remove('drag-over');
          });
        });
      });
      document.querySelectorAll('.kanban-col-body').forEach(function (body) {
        body.addEventListener('dragover', function (e) {
          e.preventDefault();
          body.classList.add('drag-over');
        });
        body.addEventListener('dragleave', function () {
          body.classList.remove('drag-over');
        });
        body.addEventListener('drop', function (e) {
          e.preventDefault();
          body.classList.remove('drag-over');
          var id = e.dataTransfer.getData('text/plain') || dragId;
          var status = body.getAttribute('data-drop-status');
          if (!id || !status) return;
          var f = document.createElement('form');
          f.method = 'POST';
          f.action = '/admin/crm/board/move';
          f.innerHTML = '<input name="contactId" value="' + id + '">' +
            '<input name="status" value="' + status + '">';
          document.body.appendChild(f);
          f.submit();
        });
      });
    })();
    </script>`);
});

router.post('/admin/crm/board/move', requireAdmin, (req, res) => {
  const { contacts } = require('../crm');
  const b = req.body || {};
  const id = Number(b.contactId);
  const status = String(b.status || '');
  if (id && contacts.STATUSES.includes(status)) {
    contacts.updateContact(id, { status });
    try {
      require('../crm').events.record({
        contactId: id,
        type: 'status',
        title: 'הועבר ל־' + contacts.statusLabel(status)
      });
    } catch (e) { /* */ }
  }
  res.redirect('/admin/crm/board');
});

// ─── sales tasks (v2.00, BEFORE /:id) ────────────────────────────────
router.get('/admin/crm/tasks', requireAdmin, requireCrm('crm-tasks', 'משימות'), (req, res) => {
  const { tasks, contacts, taskReminders } = require('../crm');
  const counts = tasks.counts();
  const due = tasks.listDue();
  const upcoming = tasks.listUpcoming({ days: 7 });
  const undated = tasks.listUndated();
  const rem = taskReminders.getReminderStatus();
  const smtp = require('../notify').getSettings();
  const flash = String((req.query || {}).ok || '');
  const flashErr = String((req.query || {}).err || '');
  const flashMsg = flash === 'done'
    ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5">✓ המשימה סומנה כבוצעה.</div>'
    : flash === 'created'
      ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5">✓ משימה חדשה נפתחה.</div>'
      : flash === 'reminded'
        ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5">✓ תזכורת נשלחה (או שאין משימות למועד).</div>'
        : flashErr
          ? `<div class="card" style="border-color:#fecaca;background:#fef2f2">⚠ ${esc(flashErr)}</div>`
          : '';

  function taskRow(t, { showDue } = {}) {
    const name = t.contact_name || t.contact_email || t.contact_phone || ('#' + t.contact_id);
    const overdue = t.due_at && t.due_at < counts.today;
    return `
      <div class="rec" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
        <div style="flex:1;min-width:180px">
          <strong>${esc(t.title)}</strong>
          <div class="muted" style="font-size:.82rem">
            <span class="pill" style="font-size:.75rem">${esc(tasks.kindLabel(t.kind))}</span>
            <a href="/admin/crm/${t.contact_id}">${esc(name)}</a>
            ${showDue && t.due_at
              ? ` · <span style="color:${overdue ? '#b91c1c' : 'inherit'}">${esc(t.due_at)}${overdue ? ' — באיחור' : ''}</span>`
              : ''}
          </div>
        </div>
        <form method="POST" action="/admin/crm/tasks/${t.id}/done">
          <button class="btn sm" type="submit">בוצע ✓</button>
        </form>
        <form method="POST" action="/admin/crm/tasks/${t.id}/cancel">
          <button class="btn secondary sm" type="submit">בטל</button>
        </form>
      </div>`;
  }

  const dueBody = due.length
    ? due.map((t) => taskRow(t, { showDue: true })).join('')
    : '<div class="empty-state">אין משימות למועד הזה — יום טוב לעבודה יזומה.</div>';
  const upBody = upcoming.length
    ? upcoming.map((t) => taskRow(t, { showDue: true })).join('')
    : '<div class="muted" style="font-size:.88rem;padding:8px 0">אין משימות בשבוע הקרוב.</div>';
  const undatedBody = undated.length
    ? undated.map((t) => taskRow(t, { showDue: false })).join('')
    : '';

  // Quick-add: pick from recent contacts
  const recent = contacts.listContacts({ limit: 40 }).filter((c) =>
    c.status !== 'garbage' && c.status !== 'provisional'
  );

  page(res, 'crm-tasks', 'משימות', `
    ${flashMsg}
    <p class="lead" style="margin-top:0">
      מה עושים <strong>היום</strong> עם האנשים שלכם — שיחה, מייל, מעקב.
      לא מעקב צללים: משימה שאתם פותחים על אדם שכבר בכרטיס.
    </p>
    <div class="stat-row">
      <a class="stat-tile" href="#due">
        <div class="stat-num" style="${counts.overdue ? 'color:#b91c1c' : ''}">${counts.overdue + counts.dueToday}</div>
        <div class="stat-label">ליום זה / באיחור</div>
      </a>
      <a class="stat-tile" href="#upcoming">
        <div class="stat-num">${upcoming.length}</div>
        <div class="stat-label">השבוע</div>
      </a>
      <a class="stat-tile" href="#undated">
        <div class="stat-num">${counts.undated}</div>
        <div class="stat-label">בלי תאריך</div>
      </a>
      <a class="stat-tile" href="#new">
        <div class="stat-num">${counts.open}</div>
        <div class="stat-label">פתוחות סה״כ</div>
      </a>
    </div>

    <div class="card" id="due">
      <div class="card-head">🔥 לביצוע עכשיו · ${counts.overdue} באיחור · ${counts.dueToday} להיום</div>
      ${dueBody}
    </div>

    <div class="card" id="upcoming">
      <div class="card-head">📅 השבוע הקרוב</div>
      ${upBody}
    </div>

    ${undatedBody ? `
    <div class="card" id="undated">
      <div class="card-head">📋 בלי תאריך יעד</div>
      ${undatedBody}
    </div>` : ''}

    <div class="card" id="new">
      <div class="card-head">משימה חדשה</div>
      <form method="POST" action="/admin/crm/tasks" class="stack">
        <label>איש קשר
          <select name="contactId" class="input" required>
            <option value="">— בחרו —</option>
            ${recent.map((c) => {
              const label = [c.name, c.email, c.phone].filter(Boolean).join(' · ') || ('#' + c.id);
              return `<option value="${c.id}">${esc(label)}</option>`;
            }).join('')}
          </select>
        </label>
        <label>מה לעשות<input name="title" class="input" required placeholder="להתקשר בעניין החבילה"></label>
        <label>סוג
          <select name="kind" class="input">
            ${tasks.KINDS.map((k) =>
              `<option value="${k}">${esc(tasks.kindLabel(k))}</option>`).join('')}
          </select>
        </label>
        <label>תאריך יעד<input name="dueAt" type="date" class="input" value="${esc(counts.today)}"></label>
        <label>הערות<textarea name="notes" class="input" rows="2" placeholder="אופציונלי"></textarea></label>
        <button class="btn" type="submit">פתח משימה</button>
      </form>
      <p class="muted" style="font-size:.8rem">אפשר גם מתוך כרטיס איש קשר — שם זה מהיר יותר.
        · <a href="/admin/crm/board">לוח סטטוסים</a></p>
    </div>

    <div class="card" id="reminders">
      <div class="card-head">✉️ תזכורות במייל (SMTP)</div>
      <p class="lead" style="font-size:.92rem">
        <strong>אליכם</strong> — סיכום משימות באיחור / להיום.<br>
        <strong>ללקוחות</strong> — תזכורת על פגישה / מעקב / שיחה במועד (למייל שלהם).
      </p>
      <p class="muted" style="font-size:.85rem">
        SMTP: ${smtp.smtpReady ? 'מוכן ✓' : 'לא מוכן — הגדירו ב־<a href="/admin/integrations">אינטגרציות</a>'}
        · לצוות: ${rem.pendingOverdue} באיחור, ${rem.pendingToday} להיום
        ${rem.lastSentDay ? ' · צוות נשלח: ' + esc(rem.lastSentDay) : ''}
        · ללקוחות ממתינים: ${rem.customerPending || 0}
        ${rem.lastCustomerDay ? ' · לקוחות נשלח: ' + esc(rem.lastCustomerDay) : ''}
      </p>
      <form method="POST" action="/admin/crm/tasks/reminders" class="stack">
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="enabled" value="1" ${rem.enabled ? 'checked' : ''}>
          תזכורת יומית <strong>לצוות</strong> (סיכום משימות)
        </label>
        <label>נמען צוות (ריק = כתובת ההתראות מ־notify)
          <input name="to" class="input" dir="ltr" value="${esc(rem.to)}"
                 placeholder="${esc(smtp.to || 'you@example.com')}"></label>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0">
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="customerEnabled" value="1" ${rem.customerEnabled ? 'checked' : ''}>
          תזכורת <strong>ללקוח</strong> על משימות במועד (פגישה / מעקב / שיחה)
        </label>
        <p class="muted" style="font-size:.8rem;margin:0">
          נשלח למייל של איש הקשר, פעם אחת ליום־מועד. לא דורש הסכמת דיוור שיווקי —
          זו תזכורת שירות על משהו שאתם תיזמנתם. לא נשלח לכרטיסים זמניים.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn secondary sm" type="submit" name="action" value="save">שמור הגדרות</button>
          <button class="btn sm" type="submit" name="action" value="send">שלח לצוות עכשיו</button>
          <button class="btn sm" type="submit" name="action" value="send-customers">שלח ללקוחות עכשיו</button>
        </div>
      </form>
    </div>`);
});

router.post('/admin/crm/tasks/reminders', requireAdmin, async (req, res) => {
  const config = require('../config');
  const cfg = config.loadConfig();
  const b = req.body || {};
  const action = String(b.action || 'save');
  const prevTasks = (cfg.crm && cfg.crm.tasks) || {};
  cfg.crm = Object.assign({}, cfg.crm, {
    tasks: Object.assign({}, prevTasks, {
      reminders: {
        enabled: !!b.enabled,
        to: String(b.to || '').trim().slice(0, 300)
      },
      customerReminders: {
        enabled: !!b.customerEnabled,
        kinds: ['meeting', 'followup', 'call']
      }
    })
  });
  config.saveConfig(cfg);
  if (action === 'send') {
    try {
      const r = await require('../crm').taskReminders.sendTaskReminders({
        force: true,
        ignoreEnabled: true
      });
      if (r.ok) return res.redirect('/admin/crm/tasks?ok=reminded');
      return res.redirect('/admin/crm/tasks?err=' + encodeURIComponent(r.error || 'שליחה נכשלה'));
    } catch (e) {
      return res.redirect('/admin/crm/tasks?err=' + encodeURIComponent(e.message || 'שגיאה'));
    }
  }
  if (action === 'send-customers') {
    try {
      const r = await require('../crm').taskReminders.sendCustomerTaskReminders({
        force: true,
        ignoreEnabled: true
      });
      if (r.ok) return res.redirect('/admin/crm/tasks?ok=reminded');
      return res.redirect('/admin/crm/tasks?err=' + encodeURIComponent(r.error || 'שליחה ללקוחות נכשלה'));
    } catch (e) {
      return res.redirect('/admin/crm/tasks?err=' + encodeURIComponent(e.message || 'שגיאה'));
    }
  }
  res.redirect('/admin/crm/tasks#reminders');
});

router.post('/admin/crm/tasks', requireAdmin, (req, res) => {
  const { tasks } = require('../crm');
  const b = req.body || {};
  const r = tasks.createTask({
    contactId: b.contactId,
    title: b.title,
    kind: b.kind,
    dueAt: b.dueAt,
    notes: b.notes
  });
  if (r.ok && b.returnTo) {
    return res.redirect(String(b.returnTo));
  }
  res.redirect(r.ok ? '/admin/crm/tasks?ok=created' : '/admin/crm/tasks');
});

router.post('/admin/crm/tasks/:id/done', requireAdmin, (req, res) => {
  require('../crm').tasks.completeTask(req.params.id);
  const back = (req.body && req.body.returnTo) || '/admin/crm/tasks?ok=done';
  res.redirect(String(back));
});

router.post('/admin/crm/tasks/:id/cancel', requireAdmin, (req, res) => {
  require('../crm').tasks.cancelTask(req.params.id);
  const back = (req.body && req.body.returnTo) || '/admin/crm/tasks';
  res.redirect(String(back));
});

// ─── site registry + identity claims (v1.99, BEFORE /:id) ─────────────
router.get('/admin/crm/sites', requireAdmin, requireCrm('crm-sites', 'אתרים (פיקסל)'), (req, res) => {
  const { sites } = require('../crm');
  const config = require('../config');
  const cfg = config.loadConfig();
  const peOn = !!(cfg.crm && cfg.crm.pixelEmbed && cfg.crm.pixelEmbed.enabled);
  const rows = sites.listSites();
  const baseHint = (cfg.baseUrl || '').trim() || 'https://YOUR-CRM-HOST';
  const list = rows.length
    ? rows.map((s) => {
        const snip = sites.buildSnippet({ base: baseHint, siteId: s.slug });
        const snipSafe = snip
          ? esc(snip)
          : '<span class="muted">הגדירו baseUrl ב־HTTPS (או localhost) כדי לקבל קטע להדבקה</span>';
        return `
        <div class="rec" style="display:block">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
            <div style="flex:1;min-width:160px">
              <strong dir="ltr">${esc(s.slug)}</strong>
              <div class="muted" style="font-size:.85rem">${esc(s.label || '')}</div>
            </div>
            <span class="pill">${s.active ? 'פעיל' : 'כבוי'}</span>
            <span class="pill" style="${s.claimsEnabled ? 'background:#fff7ed;color:#c2410c' : ''}">
              ${s.claimsEnabled ? 'תביעות זהות: פתוח' : 'תביעות: סגור'}
            </span>
          </div>
          <p class="muted" style="font-size:.8rem;margin:8px 0 4px">מקורות מורשים:
            ${s.allowedOrigins.length ? esc(s.allowedOrigins.join(', ')) : 'הכול (רק slug)'}</p>
          <pre class="muted" style="font-size:.75rem;white-space:pre-wrap;direction:ltr;text-align:left;background:#f8fafc;padding:10px;border-radius:8px">${snipSafe}</pre>
          <form method="POST" action="/admin/crm/sites/${encodeURIComponent(s.slug)}/update"
                style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center">
            <label style="display:flex;gap:4px;align-items:center;font-size:.85rem">
              <input type="checkbox" name="active" value="1" ${s.active ? 'checked' : ''}> פעיל</label>
            <label style="display:flex;gap:4px;align-items:center;font-size:.85rem">
              <input type="checkbox" name="claimsEnabled" value="1" ${s.claimsEnabled ? 'checked' : ''}>
              לאפשר תביעות identify (דורש אישור)</label>
            <input name="label" class="input" style="width:auto" value="${esc(s.label)}" placeholder="תווית">
            <input name="allowedOrigins" class="input" style="flex:1;min-width:180px" dir="ltr"
                   value="${esc(s.allowedOrigins.join(', '))}" placeholder="https://shop.example.com">
            <button class="btn secondary sm" type="submit">שמור</button>
          </form>
          <form method="POST" action="/admin/crm/sites/${encodeURIComponent(s.slug)}/delete"
                onsubmit="return confirm('למחוק את האתר מהרשם?')" style="margin-top:6px">
            <button class="btn secondary sm" type="submit">מחק מהרשם</button>
          </form>
        </div>`;
      }).join('')
    : '<div class="empty-state">אין אתרים ברשם — צרו slug לפני שמדביקים פיקסל באתר זר.</div>';

  page(res, 'crm-sites', 'אתרים (פיקסל)', `
    <div class="card">
      <div class="card-head">🌐 רשם אתרים — multi-tenant בלי זיהום</div>
      <p class="lead">
        <code>site_id</code> הוא ציבורי כמו מזהה מדידה. <strong>רק</strong> slug שנוצר כאן
        מתקבל ב־collector; לא מוכר → 204 שקט. תביעת identify לעולם לא יוצרת איש קשר לבד.
      </p>
      <form method="POST" action="/admin/crm/sites/settings" class="stack" style="margin-bottom:16px">
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="enabled" value="1" ${peOn ? 'checked' : ''}>
          הפעל פיקסל זר (pixel embed) — ברירת מחדל כבוי
        </label>
        <button class="btn secondary sm" type="submit">שמור דגל</button>
      </form>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">אתר חדש</div>
      <form method="POST" action="/admin/crm/sites" class="stack">
        <label>מזהה (slug)<input name="slug" class="input" dir="ltr" required placeholder="wp-shop-il"></label>
        <label>תווית<input name="label" class="input" placeholder="חנות WordPress"></label>
        <label>מקורות מורשים (אופציונלי, מופרדים בפסיק)
          <input name="allowedOrigins" class="input" dir="ltr" placeholder="https://shop.example.com"></label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="claimsEnabled" value="1"> לאפשר תביעות identify (סגור כברירת מחדל)
        </label>
        <button class="btn" type="submit">הוסף לרשם</button>
      </form>
      <p class="muted" style="font-size:.8rem">
        הקטע להדבקה דורש <strong>HTTPS</strong> ב־baseUrl של האתר (או localhost לפיתוח) —
        http רגיל מחוץ ל־loopback נדחה.
      </p>
      <p class="muted" style="font-size:.8rem">
        עטיפות מוכנות (v2.01): תוסף <strong>WordPress</strong> בתיקיית
        <code dir="ltr">integrations/wordpress/tapuziel-pixel/</code> ·
        הדבקה ל־<strong>Builder.io</strong> ב־<code dir="ltr">integrations/builder.io/</code>.
        עטיפה רק מזריקה את הטוען — אפס לוגיקת איסוף, נאכף בבדיקה.
      </p>
    </div>`);
});

router.post('/admin/crm/sites/settings', requireAdmin, (req, res) => {
  const config = require('../config');
  const cfg = config.loadConfig();
  cfg.crm = Object.assign({}, cfg.crm, {
    pixelEmbed: { enabled: !!(req.body && req.body.enabled) }
  });
  config.saveConfig(cfg);
  res.redirect('/admin/crm/sites');
});

router.post('/admin/crm/sites', requireAdmin, (req, res) => {
  const { sites } = require('../crm');
  const b = req.body || {};
  try {
    sites.createSite({
      slug: b.slug,
      label: b.label,
      allowedOrigins: b.allowedOrigins,
      claimsEnabled: !!b.claimsEnabled,
      active: true
    });
  } catch (e) { /* duplicate / empty */ }
  res.redirect('/admin/crm/sites');
});

router.post('/admin/crm/sites/:slug/update', requireAdmin, (req, res) => {
  const { sites } = require('../crm');
  const b = req.body || {};
  sites.updateSite(req.params.slug, {
    label: b.label,
    allowedOrigins: b.allowedOrigins,
    active: !!b.active,
    claimsEnabled: !!b.claimsEnabled
  });
  res.redirect('/admin/crm/sites');
});

router.post('/admin/crm/sites/:slug/delete', requireAdmin, (req, res) => {
  require('../crm').sites.deleteSite(req.params.slug);
  res.redirect('/admin/crm/sites');
});

router.get('/admin/crm/claims', requireAdmin, requireCrm('crm-claims', 'תביעות זהות'), (req, res) => {
  const { identityClaims, sites } = require('../crm');
  const status = String((req.query || {}).status || 'pending');
  const rows = identityClaims.listClaims({ status, limit: 100 });
  const pending = identityClaims.countPending();
  const list = rows.length
    ? rows.map((c) => `
        <div class="rec" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <div style="flex:1;min-width:180px">
            <strong dir="ltr">${esc(c.email || c.phone || '—')}</strong>
            <div class="muted" style="font-size:.82rem">
              ${esc(c.name || '')} · site <span dir="ltr">${esc(c.site_id)}</span>
              · ×${c.claim_count} · ${esc(c.last_seen_at || '')}
            </div>
            <div class="muted" style="font-size:.78rem" dir="ltr">${esc(c.path || '')}</div>
          </div>
          <span class="pill">${esc(c.status)}</span>
          ${c.status === 'pending' ? `
            <form method="POST" action="/admin/crm/claims/${c.id}/approve"><button class="btn sm" type="submit">אשר → איש קשר</button></form>
            <form method="POST" action="/admin/crm/claims/${c.id}/reject"><button class="btn secondary sm" type="submit">דחה</button></form>
          ` : c.contact_id
            ? `<a class="btn secondary sm" href="/admin/crm/${c.contact_id}">לכרטיס #${c.contact_id}</a>`
            : ''}
        </div>`).join('')
    : '<div class="empty-state">אין תביעות במצב הזה.</div>';

  page(res, 'crm-claims', 'תביעות זהות', `
    <div class="card">
      <div class="card-head">🪪 תביעות זהות — עצור לאישור</div>
      <p class="lead">
        <code>identify({email})</code> מאתר זר <strong>לא</strong> יוצר איש קשר.
        הוא נוחת כאן כתביעה לא מאומתת — כמו הקופיילוט שלא פועל בלי אישור.
        רק «אשר» מעביר דרך ה־upsert הרגיל.
      </p>
      <p class="muted" style="font-size:.88rem">ממתינות: <strong>${pending}</strong>
        · <a href="/admin/crm/claims?status=pending">ממתינות</a>
        · <a href="/admin/crm/claims?status=approved">מאושרות</a>
        · <a href="/admin/crm/claims?status=rejected">נדחו</a>
        · <a href="/admin/crm/sites">רשם אתרים</a>
      </p>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">למה זה חשוב</div>
      <p class="muted" style="font-size:.9rem;line-height:1.55">
        בלי השער הזה, כל אחד באינטרנט יכול לטעון שהוא «dana@example.com» ולהצמיד
        היסטוריית גלישה לכרטיס אמיתי — או להציף את ה־CRM באנשי קשר מזויפים.
        טופס באתר שלכם (שבו האדם מקליד) נשאר מסלול זהות לגיטימי.
      </p>
      <p class="muted" style="font-size:.85rem">אתרים עם תביעות פתוחות:
        ${sites.listSites().filter((s) => s.claimsEnabled).map((s) => esc(s.slug)).join(', ') || 'אין — הפעילו per-site'}.
      </p>
    </div>`);
});

router.post('/admin/crm/claims/:id/approve', requireAdmin, (req, res) => {
  const r = require('../crm').identityClaims.approveClaim(req.params.id);
  if (r.ok && r.contact) return res.redirect('/admin/crm/' + r.contact.id);
  res.redirect('/admin/crm/claims');
});

router.post('/admin/crm/claims/:id/reject', requireAdmin, (req, res) => {
  require('../crm').identityClaims.rejectClaim(req.params.id);
  res.redirect('/admin/crm/claims');
});

// ─── interest map (declared BEFORE /:id) ─────────────────────────────
// Progressive cards learn topics from page paths. This screen is the owner's
// map of that learning: counts, one-click segments, mail without blasting.
router.get('/admin/crm/interests', requireAdmin, requireCrm('crm-interests', 'תחומי עניין'), (req, res) => {
  const { cards, segments } = require('../crm');
  const stats = cards.listInterestStats({ limit: 200 });
  const flash = String((req.query || {}).ok || '');
  const flashMsg = flash === 'segment'
    ? '<div class="card" style="border-color:#a7f3d0;background:#ecfdf5">✓ נוצר פילוח חי מתחום העניין — אפשר לדוור אליו עכשיו.</div>'
    : '';

  const rows = stats.length
    ? stats.map((s) => `
        <div class="rec" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:140px">
            <strong dir="auto">${esc(s.label)}</strong>
            <div class="muted" style="font-size:.8rem">
              ${s.withEmail} עם מייל · ${s.reachable} עם פרטי קשר · ${s.provisional} כרטיס זמני
            </div>
          </div>
          <span class="pill" style="background:#fff7ed;color:#c2410c;border-color:#fed7aa">${s.total} אנשים</span>
          <a class="btn secondary sm" href="/admin/crm?interest=${encodeURIComponent(s.label)}">👥 רשימה</a>
          <form method="POST" action="/admin/crm/interests/segment" style="display:inline">
            <input type="hidden" name="interest" value="${esc(s.label)}">
            <input type="hidden" name="withEmail" value="1">
            <button class="btn secondary sm" type="submit">🎯 פילוח + מייל</button>
          </form>
          <a class="btn sm" href="/admin/crm/campaigns?interest=${encodeURIComponent(s.label)}">✉️ דיוור</a>
        </div>`).join('')
    : `<div class="empty-state">
         <div style="font-size:2rem;margin-bottom:8px">💡</div>
         עדיין אין תחומי עניין — הם נוצרים אוטומטית כשמישהו גולש בדפים
         (למשל <code dir="ltr">/services/wedding-packages</code>), או שמוסיפים ידנית בכרטיס.
       </div>`;

  // Existing segments that already key on interest — so the map and the rules stay friends.
  const interestSegs = segments.listSegments().filter((s) => s.rules && s.rules.interest);
  const segNote = interestSegs.length
    ? `<p class="muted" style="font-size:.85rem">פילוחי עניין קיימים:
         ${interestSegs.map((s) =>
           `<a href="/admin/crm/campaigns?segmentId=${s.id}">${esc(s.name)}</a> (${s.size})`
         ).join(' · ')}</p>`
    : '';

  page(res, 'crm-interests', 'תחומי עניין', `
    ${flashMsg}
    <div class="card">
      <div class="card-head">💡 מפת תחומי עניין — מה האתר למד על האנשים</div>
      <p class="lead">
        כל ביקור לגיטימי יכול לסמן <strong>תחום</strong> על הכרטיס (מקטע נתיב).
        כאן רואים את המפה שלמה: מה מעניין, לכמה אנשים, ומי כבר ניתן לדיוור —
        בלי להציף את כולם.
      </p>
      ${segNote}
      ${rows}
    </div>
    <div class="card">
      <div class="card-head">פילוח ידני מתחום</div>
      <form method="POST" action="/admin/crm/interests/segment" class="stack">
        <label>תחום עניין
          <input name="interest" class="input" dir="ltr" required placeholder="wedding-packages"></label>
        <label>שם הפילוח (אופציונלי)
          <input name="name" class="input" placeholder="מתעניינים ב… + מייל"></label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="withEmail" value="1" checked> רק מי שיש לו מייל
        </label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="consent" value="1"> רק מי שנתן הסכמה לדיוור
        </label>
        <button class="btn" type="submit">צור פילוח חי</button>
      </form>
    </div>`);
});

router.post('/admin/crm/interests/segment', requireAdmin, (req, res) => {
  const { cards, segments } = require('../crm');
  const b = req.body || {};
  const label = cards.normalizeInterestLabel(b.interest);
  if (!label) return res.redirect('/admin/crm/interests');
  const rules = { interest: label };
  if (b.withEmail) rules.hasEmail = true;
  if (b.consent) rules.consent = true;
  const name = String(b.name || '').trim() ||
    ('מתעניינים ב־' + label + (rules.hasEmail ? ' · עם מייל' : ''));
  try {
    const seg = segments.createSegment(name.slice(0, 200), rules);
    if (seg && seg.id) {
      return res.redirect('/admin/crm/campaigns?segmentId=' + encodeURIComponent(seg.id));
    }
  } catch (e) { /* nameless / bad → stay on map */ }
  res.redirect('/admin/crm/interests?ok=segment');
});

// ─── segments (declared BEFORE /:id) ─────────────────────────────────
router.get('/admin/crm/segments', requireAdmin, requireCrm('crm-segments', 'פילוחים'), (req, res) => {
  const { segments } = require('../crm');
  const rows = segments.listSegments();
  const hint = String((req.query || {}).hint || '').trim();
  const list = rows.length
    ? rows.map((s) => `
        <div class="rec" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:160px">
            <strong>${esc(s.name)}</strong>
            <div class="muted" style="font-size:.8rem">${esc(JSON.stringify(s.rules))}</div>
          </div>
          <span class="pill">${s.size} אנשים</span>
          <a class="btn sm" href="/admin/crm/campaigns?segmentId=${s.id}">✉️ דיוור לפילוח</a>
          <form method="POST" action="/admin/crm/segments/${s.id}/delete"
                onsubmit="return confirm('למחוק את הפילוח?')">
            <button class="btn secondary sm" type="submit">מחק</button>
          </form>
        </div>`).join('')
    : '<div class="empty-state">אין עדיין פילוחים — צרו את הראשון למטה.</div>';

  const { contacts } = require('../crm');
  page(res, 'crm-segments', 'פילוחים', `
    <div class="card">
      <div class="card-head">🎯 פילוחים — קהלים חיים</div>
      <p class="lead">
        פילוח הוא <strong>כלל</strong>, לא רשימה קפואה: מי שעונה עליו נמצא בו — תמיד עכשיו.
        השתמשו ב<strong>תחום עניין</strong> (מדפי האתר) כדי לדוור רק למי שזה רלוונטי לו — לא לכל הרשימה.
        <a href="/admin/crm/interests">מפת תחומי עניין ←</a>
      </p>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">פילוח חדש</div>
      <form method="POST" action="/admin/crm/segments" class="stack">
        <label>שם<input name="name" class="input" required placeholder="מתעניינים בחתונות · עם מייל"
          value="${esc(hint ? 'מתעניינים ב־' + hint + ' · עם מייל' : '')}"></label>
        <label>סטטוס
          <select name="status" class="input">
            <option value="">כל הסטטוסים</option>
            ${contacts.STATUSES.map((s) =>
              `<option value="${s}">${esc(contacts.statusLabel(s))}</option>`).join('')}
          </select>
        </label>
        <label>תחום עניין (מדף באתר)
          <input name="interest" class="input" dir="ltr" placeholder="wedding-packages"
                 value="${esc(hint)}"
                 title="מקטע נתיב אחרי ביקור — למשל /services/wedding-packages">
        </label>
        <p class="muted" style="font-size:.8rem;margin:0">
          נוצר אוטומטית מצפיות (תגית interest:…). השאירו ריק אם לא רלוונטי.
        </p>
        <label>מדינה (קוד דו-אותי)<input name="country" class="input" maxlength="2" placeholder="IL"></label>
        <label>תגיות (מופרדות בפסיק)<input name="tags" class="input" placeholder="vip,newsletter"></label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="hasEmail" value="1" ${hint ? 'checked' : ''}> רק מי שיש לו מייל (מתאים לדיוור)
        </label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="hasInterest" value="1"> רק מי שיש לו לפחות תחום עניין אחד
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
  if (b.interest) rules.interest = String(b.interest);
  if (b.hasEmail) rules.hasEmail = true;
  if (b.hasInterest) rules.hasInterest = true;
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
  const spend = ledger.spendEstimate();
  const usd = (v) => '$' + (Math.round(v * 100) / 100).toFixed(2);

  // send-form outcome, carried through the redirect (never the message itself)
  const SEND_ERR_HE = {
    invalid_phone: 'המספר לא תקין.',
    marketing_opt_in_required: 'תבנית שיווקית נשלחת רק למי שנתן הסכמה — רשמו אותה בכרטיס ההסכמות.',
    csw_closed_use_template: 'חלון השירות סגור — טקסט חופשי אפשרי רק 24 שעות אחרי הודעה נכנסת. השתמשו בתבנית.',
    messaging_limit_reached: 'הגעתם לתקרת הנמענים של דרגת השליחה ל-24 השעות האלה.',
    whatsapp_disabled: 'הערוץ כבוי או שחסרים פרטי חיבור — בדקו את כרטיס החיבור.',
    invalid_message: 'חסר תוכן — טקסט חופשי צריך הודעה, תבנית צריכה שם.',
    graph_error: 'מטא סירבה או לא ענתה — הניסיון נרשם בתיעוד עם הסיבה.'
  };
  const flash = req.query.sent
    ? `<div class="card" style="border-color:#86efac;background:#f0fdf4">✅ ההודעה נשלחה${
      req.query.billable === '1' ? ' — תחויב על ידי מטא בעת המסירה.' : ' — בחינם (שיחת שירות).'}</div>`
    : req.query.err
      ? `<div class="card" style="border-color:#fecaca;background:#fef2f2">⚠️ ${esc(SEND_ERR_HE[req.query.err] || 'השליחה נכשלה.')}</div>`
      : '';
  const recent = ledger.recentMessages({ limit: 30 });
  const tierPct = sum.tier.limit === Infinity ? 0
    : Math.min(100, Math.round((sum.tier.used / sum.tier.limit) * 100));

  const rows = recent.length
    ? recent.map((m) => `
        <div class="rec" style="display:flex;gap:10px;align-items:baseline">
          <span class="pill">${m.direction === 'in' ? '⬅ נכנס' : '➡ יוצא'}</span>
          ${m.contact_id ? `<a class="pill" href="/admin/crm/${m.contact_id}" title="לכרטיס איש הקשר">👤</a>` : ''}
          <span dir="ltr" class="muted">${esc(m.phone)}</span>
          <span style="flex:1">${esc((m.body || m.template_category || m.msg_type || '').slice(0, 60))}</span>
          ${m.billable ? '<span class="pill" style="background:#fffbeb;color:#92400e;border-color:#fde68a">בתשלום</span>' : ''}
          <span class="muted" style="font-size:.74rem">${esc(m.status || '')}</span>
        </div>`).join('')
    : '<div class="empty-state">אין עדיין הודעות — שליחה וקבלה מגיעות בשלבים הבאים.</div>';

  page(res, 'crm-wa', 'WhatsApp', `
    ${flash}
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
      <div class="card-head">💰 הוצאה — בכסף, לא בהודעות</div>
      <p style="font-size:1.05rem;margin:6px 0">
        החודש: <strong>${usd(spend.month.usd)}</strong> (${spend.month.n} מסירות בתשלום)
        · סה"כ: <strong>${usd(spend.total.usd)}</strong> (${spend.total.n})
      </p>
      <p class="muted" style="font-size:.82rem">
        ${esc(spend.note)}. שיווק ${usd(spend.prices.marketing)} ·
        אימות ${usd(spend.prices.authentication)} · תפעולי מחוץ לחלון ${usd(spend.prices.utility)} —
        שיחות שירות וטקסט בתוך החלון: חינם.
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
        הודעה נכנסת נרשמת ופותחת חלון שירות של 24 שעות.
      </p>
    </div>

    <div class="card">
      <div class="card-head">✉️ שליחת הודעה</div>
      <p class="lead">
        כל בקשה עוברת את השער <strong>לפני</strong> שהיא יוצאת: טקסט חופשי רק
        בחלון פתוח, שיווק רק עם הסכמה, ותקרת הדרגה נאכפת אצלנו — סירוב הוא
        מקומי וללא עלות.
      </p>
      <form method="POST" action="/admin/crm/whatsapp/send" class="stack" style="max-width:520px">
        <label>טלפון<input name="phone" class="input" dir="ltr" placeholder="050-123-4567" required></label>
        <label>סוג
          <select name="msgType" class="input">
            <option value="text">טקסט חופשי — רק בחלון שירות פתוח (חינם)</option>
            <option value="template">תבנית מאושרת</option>
          </select></label>
        <label>טקסט ההודעה (לטקסט חופשי)
          <textarea name="body" class="input" rows="3" maxlength="4096"></textarea></label>
        <label>שם תבנית (לתבנית)<input name="templateName" class="input" dir="ltr" placeholder="order_update"></label>
        <label>שפת תבנית<input name="templateLanguage" class="input" dir="ltr" value="he"></label>
        <label>קטגוריית תבנית
          <select name="templateCategory" class="input">
            <option value="UTILITY">UTILITY — תפעולית (חינם בחלון פתוח, אחרת ${usd(spend.prices.utility)})</option>
            <option value="MARKETING">MARKETING — שיווקית (דורשת הסכמה · ${usd(spend.prices.marketing)})</option>
            <option value="AUTHENTICATION">AUTHENTICATION — אימות (${usd(spend.prices.authentication)})</option>
          </select></label>
        <button class="btn" type="submit">שלח</button>
      </form>
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

router.post('/admin/crm/whatsapp/send', requireAdmin, async (req, res) => {
  const b = req.body || {};
  try {
    const r = await require('../crm/wa-send').sendMessage({
      phone: b.phone,
      msgType: b.msgType === 'template' ? 'template' : 'text',
      body: b.body,
      templateName: b.templateName,
      templateLanguage: b.templateLanguage,
      templateCategory: b.templateCategory
    });
    if (r.ok) {
      return res.redirect('/admin/crm/whatsapp?sent=1&billable=' +
        (r.pricing && r.pricing.billable ? '1' : '0'));
    }
    return res.redirect('/admin/crm/whatsapp?err=' + encodeURIComponent(r.error || 'graph_error'));
  } catch (e) {
    // sendMessage never throws by contract; this is the route keeping that
    // promise to the browser anyway.
    return res.redirect('/admin/crm/whatsapp?err=graph_error');
  }
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
  const cardsCfg = (cfg.crm && cfg.crm.cards) || {};
  const quietDays = cardsCfg.quietDays != null ? cardsCfg.quietDays : 5;
  const garbageDays = cardsCfg.garbageDays != null ? cardsCfg.garbageDays : 3;
  const progressive = cardsCfg.progressive !== false;
  const { db } = require('../db');
  const eventCount = db.prepare('SELECT COUNT(*) AS n FROM crm_events').get().n;
  const anchored = db.prepare('SELECT COUNT(*) AS n FROM crm_events WHERE ref_id IS NOT NULL').get().n;
  const counts = require('../crm').contacts.statusCounts();
  const searchOn = require('../db').crmSearchReady();

  page(res, 'crm-privacy', 'פרטיות ושמירה', `
    <div class="card">
      <div class="card-head">🪪 כרטיסי לקוח מתקדמים (לגיטימי, לא צללים)</div>
      <p class="lead">
        ביקור באתר פותח <strong>כרטיס זמני</strong> (עוגייה ראשונה בלבד), מייל/שם מעשירים אותו,
        דפים הופכים לתחומי עניין. בלי אינטראקציה — הכרטיס נשכח. לא שומרים נתונים «בשביל הספורט».
      </p>
      <p class="muted" style="font-size:.88rem">
        עכשיו: ${counts.provisional || 0} כרטיסים זמניים · ${counts.garbage || 0} ממתינים למחיקה ·
        ${counts.lead || 0} לידים · ${counts.customer || 0} לקוחות.
      </p>
      <form method="POST" action="/admin/crm/privacy" class="stack">
        <input type="hidden" name="section" value="cards">
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="progressive" value="1" ${progressive ? 'checked' : ''}>
          לפתוח כרטיס זמני בביקור ראשון (מומלץ)
        </label>
        <label>ימים בלי אינטראקציה עד «ממתין למחיקה» (כרטיס בלי מייל/טלפון)
          <input type="number" name="quietDays" class="input" min="1" max="90" value="${Number(quietDays) || 5}"></label>
        <label>ימים נוספים עד מחיקה מוחלטת
          <input type="number" name="garbageDays" class="input" min="1" max="90" value="${Number(garbageDays) || 3}"></label>
        <button class="btn" type="submit">שמור מדיניות כרטיסים</button>
      </form>
    </div>

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
        <input type="hidden" name="section" value="events">
        <label>שמור אירועי התנהגות (בימים) — 0 = לשמור הכול
          <input type="number" name="eventDays" class="input" min="0" max="3650" value="${Number(days) || 0}"></label>
        <button class="btn" type="submit">שמור מדיניות אירועים</button>
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
  const b = req.body || {};
  const section = String(b.section || 'events');
  if (section === 'cards') {
    const q = parseInt(b.quietDays, 10);
    const g = parseInt(b.garbageDays, 10);
    cfg.crm = Object.assign({}, cfg.crm, {
      cards: {
        progressive: !!b.progressive,
        quietDays: Number.isFinite(q) && q >= 1 ? Math.min(q, 90) : 5,
        garbageDays: Number.isFinite(g) && g >= 1 ? Math.min(g, 90) : 3
      }
    });
  } else {
    const n = parseInt(b.eventDays, 10);
    cfg.crm = Object.assign({}, cfg.crm, {
      retention: { eventDays: Number.isFinite(n) && n > 0 ? Math.min(n, 3650) : 0 }
    });
  }
  config.saveConfig(cfg);
  // apply immediately, so the number the owner just typed means something now
  try { require('../crm').runRetention(); } catch (e) { /* reported inside */ }
  res.redirect('/admin/crm/privacy');
});

// ─── campaigns (declared BEFORE /:id) ────────────────────────────────
router.get('/admin/crm/campaigns', requireAdmin, requireCrm('crm-campaigns', 'קמפיינים'), (req, res) => {
  const { campaigns, lists, segments, cards } = require('../crm');
  const rows = campaigns.listCampaigns();
  const allLists = lists.listAll();
  let allSegs = segments.listSegments();
  const smtp = require('../notify').getSettings();
  let preSeg = String((req.query || {}).segmentId || '');
  // From interest map: ?interest=wedding-packages → ensure a live segment and pre-select it.
  const interestQ = cards.normalizeInterestLabel((req.query || {}).interest || '');
  if (!preSeg && interestQ) {
    const existing = allSegs.find((s) =>
      s.rules && s.rules.interest === interestQ && s.rules.hasEmail
    );
    if (existing) {
      preSeg = String(existing.id);
    } else {
      try {
        const seg = segments.createSegment(
          ('מתעניינים ב־' + interestQ + ' · עם מייל').slice(0, 200),
          { interest: interestQ, hasEmail: true }
        );
        if (seg && seg.id) {
          preSeg = String(seg.id);
          allSegs = segments.listSegments();
        }
      } catch (e) { /* leave preSeg empty */ }
    }
  }

  const statusPill = (s) => s === 'sent'
    ? '<span class="pill">נשלח</span>'
    : s === 'sending' ? '<span class="pill" style="background:#fffbeb;color:#92400e;border-color:#fde68a">שולח…</span>'
      : '<span class="pill" style="background:#f1f5f9;color:#475569;border-color:#e2e8f0">טיוטה</span>';

  const list = rows.length
    ? rows.map((c) => `
        <a class="rec" href="/admin/crm/campaigns/${c.id}" style="display:flex;align-items:center;gap:12px;text-decoration:none">
          <div style="flex:1">
            <strong>${esc(c.name)}</strong>
            <div class="muted" style="font-size:.82rem">${esc(c.subject || 'ללא נושא')}
              ${c.segment_id ? ' · <span title="קהל חי">🎯 פילוח</span>' : c.list_id ? ' · רשימה' : ''}
            </div>
          </div>
          ${c.status === 'sent' || c.status === 'sending'
            ? `<span class="muted" style="font-size:.8rem">${c.sent_count} נשלחו · ${c.opened_count} נפתחו · ${c.clicked_count} הקליקו${c.failed_count ? ' · ' + c.failed_count + ' נכשלו' : ''}</span>`
            : ''}
          ${statusPill(c.status)}
        </a>`).join('')
    : '<div class="empty-state">אין עדיין קמפיינים.</div>';

  page(res, 'crm-campaigns', 'קמפיינים', `
    ${smtp.smtpReady ? `
    <div class="card" style="border-color:#a7f3d0;background:#ecfdf5">
      <strong>SMTP מוכן לקמפיינים</strong>
      <p class="muted" style="margin:6px 0 0;font-size:.88rem">
        נשלחו היום ${smtp.sentToday || 0} / ${smtp.maxPerDay || 500}
        · מארח <span dir="ltr">${esc(smtp.host)}</span>
        · <a href="/admin/integrations">הגדרות מייל</a>
      </p>
    </div>` : `
    <div class="card" style="border-color:#fde68a;background:#fffbeb">
      <strong>שרת המייל (SMTP) לא מוכן</strong>
      <p class="muted" style="margin:6px 0 0;font-size:.88rem">
        אפשר להכין טיוטה, אבל שליחה תיחסם עד שתגדירו מארח + משתמש + סיסמה ב־
        <a href="/admin/integrations">אינטגרציות → מייל</a>
        (אותו SMTP משמש גם להתראות על פניות).
      </p>
    </div>`}
    <div class="card">
      <div class="card-head">✉️ קמפיינים</div>
      <p class="lead">
        דיוור ל<strong>פילוח חי</strong> (תחומי עניין, סטטוס…) או לרשימה קבועה.
        נשלח <strong>רק</strong> למי שנתן הסכמה לדיוור, עם קישור הסרה בלחיצה אחת —
        רלוונטי, לא הצפה.
      </p>
      ${list}
    </div>
    <div class="card">
      <div class="card-head">קמפיין חדש</div>
      <form method="POST" action="/admin/crm/campaigns" class="stack">
        <label>שם פנימי<input name="name" class="input" required placeholder="מבצע חתונות — מתעניינים"></label>
        <label>נושא המייל<input name="subject" class="input" placeholder="משהו שרלוונטי בדיוק להם"></label>
        <label>קהל יעד — פילוח חי (מומלץ)
          <select name="segmentId" class="input">
            <option value="">— בלי פילוח —</option>
            ${allSegs.map((s) =>
              `<option value="${s.id}" ${String(s.id) === preSeg ? 'selected' : ''}>${esc(s.name)} (${s.size})</option>`
            ).join('')}
          </select>
        </label>
        <label>או רשימת נמענים קבועה
          <select name="listId" class="input">
            <option value="">— בלי רשימה —</option>
            ${allLists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.members})</option>`).join('')}
          </select>
        </label>
        <p class="muted" style="font-size:.8rem;margin:0">
          אם בחרתם פילוח, הוא גובר על הרשימה. הפילוח מחושב <strong>ברגע השליחה</strong>.
        </p>
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
      name: b.name,
      subject: b.subject,
      body: b.body,
      listId: b.listId,
      segmentId: b.segmentId
    });
    return res.redirect('/admin/crm/campaigns/' + c.id);
  } catch (e) {
    return res.redirect('/admin/crm/campaigns');
  }
});

router.get('/admin/crm/campaigns/:id', requireAdmin, requireCrm('crm-campaigns', 'קמפיין'), (req, res) => {
  const { campaigns, lists, segments } = require('../crm');
  const c = campaigns.getCampaign(req.params.id);
  if (!c) return res.status(404).send(layout('<div class="container">קמפיין לא נמצא</div>', 'לא נמצא', ACCENT));
  const audience = campaigns.audienceFor(c);
  const sends = campaigns.sendsFor(c.id);
  const allLists = lists.listAll();
  const allSegs = segments.listSegments();
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
        <label>קהל — פילוח חי
          <select name="segmentId" class="input">
            <option value="">— בלי פילוח —</option>
            ${allSegs.map((s) =>
              `<option value="${s.id}" ${Number(s.id) === Number(c.segment_id) ? 'selected' : ''}>${esc(s.name)} (${s.size})</option>`
            ).join('')}
          </select>
        </label>
        <label>או רשימה קבועה
          <select name="listId" class="input">
            <option value="">— בלי רשימה —</option>
            ${allLists.map((l) =>
              `<option value="${l.id}" ${Number(l.id) === Number(c.list_id) ? 'selected' : ''}>${esc(l.name)} (${l.members})</option>`
            ).join('')}
          </select>
        </label>
        <label>תוכן (HTML)<textarea name="body" class="input" rows="10" dir="auto">${esc(c.body)}</textarea></label>
        <button class="btn secondary" type="submit">שמור טיוטה</button>
      </form>` : `
        <p class="muted">נושא: <strong>${esc(c.subject)}</strong> · נשלח ב־${esc(c.sent_at || '')}</p>
        <p class="muted" style="font-size:.85rem">קמפיין שנשלח נעול — הוא הרשומה של מה שיצא בפועל.
          ${audience.sourceLabel ? ' · ' + esc(audience.sourceLabel) : ''}</p>`}
    </div>

    ${isDraft ? `
    <div class="card">
      <div class="card-head">📤 שליחה</div>
      <p class="lead">
        ${audience.sourceLabel ? `<span class="pill">${esc(audience.sourceLabel)}</span><br>` : ''}
        ${audience.poolSize ? `בקהל כרגע <strong>${audience.poolSize}</strong> אנשים · ` : ''}
        <strong>${audience.recipients.length}</strong> יקבלו דיוור (מייל + הסכמה).
        ${audience.skippedNoConsent ? `<br><strong>${audience.skippedNoConsent}</strong> בלי הסכמה לדיוור — לא יישלח.` : ''}
        ${audience.skippedNoEmail ? `<br>${audience.skippedNoEmail} בלי כתובת מייל.` : ''}
        ${audience.skippedIneligible ? `<br>${audience.skippedIneligible} כרטיסים זמניים/למחיקה — לא יישלח.` : ''}
      </p>
      ${audience.recipients.length ? `
      <form method="POST" action="/admin/crm/campaigns/${c.id}/send"
            onsubmit="return confirm('לשלוח ל-${audience.recipients.length} נמענים? אין דרך לבטל.')">
        <button class="btn" type="submit">שלח עכשיו ל-${audience.recipients.length} נמענים</button>
      </form>` : '<p class="muted">אין נמענים עם הסכמה — אין מה לשלוח. בדקו פילוח/רשימה והסכמות.</p>'}
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
    name: b.name,
    subject: b.subject,
    body: b.body,
    listId: b.listId || null,
    segmentId: b.segmentId || null
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
  const { contacts, Customer, segments, cards } = require('../crm');
  const q = String((req.query || {}).q || '');
  const status = String((req.query || {}).status || '');
  const interest = cards.normalizeInterestLabel((req.query || {}).interest || '');
  let rows;
  if (interest) {
    // Live audience by interest (and optional status/q applied after).
    rows = segments.evaluate(
      Object.assign({ interest }, status ? { status } : {}),
      { limit: 100 }
    );
    if (q) {
      const qq = q.toLowerCase();
      rows = rows.filter((r) => String(r.search_blob || '').includes(qq) ||
        String(r.name || '').includes(q) || String(r.email || '').includes(qq));
    }
  } else {
    rows = contacts.listContacts({ q, status, limit: 100 });
  }
  const counts = contacts.statusCounts();
  const topInterests = cards.listInterestStats({ limit: 8 });

  const tileOrder = ['provisional', 'lead', 'active', 'customer', 'archived', 'garbage'];
  const tiles = tileOrder.map((s) => `
    <a class="stat-tile" href="/admin/crm?status=${s}">
      <div class="stat-num">${counts[s] || 0}</div>
      <div class="stat-label">${esc(contacts.statusLabel(s))}</div>
    </a>`).join('') + `
    <a class="stat-tile" href="/admin/crm">
      <div class="stat-num">${counts.total || 0}</div>
      <div class="stat-label">הכול</div>
    </a>`;

  const interestBar = topInterests.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;align-items:center">
         <span class="muted" style="font-size:.82rem">תחומים חמים:</span>
         ${topInterests.map((s) => `
           <a class="pill" style="background:${interest === s.label ? '#ffedd5' : '#fff7ed'};color:#c2410c;border-color:#fed7aa;text-decoration:none"
              href="/admin/crm?interest=${encodeURIComponent(s.label)}">${esc(s.label)} · ${s.total}</a>`).join('')}
         <a class="muted" style="font-size:.82rem" href="/admin/crm/interests">מפה מלאה ←</a>
       </div>`
    : '';

  const body = rows.length
    ? rows.map((row) => {
        const c = new Customer(row);
        const interestPills = c.interests.slice(0, 3).map((t) =>
          `<span class="pill" style="background:#fff7ed;color:#c2410c;border-color:#fed7aa">${esc(t)}</span>`
        ).join('');
        return `
        <a class="rec" href="/admin/crm/${c.id}" style="display:flex;align-items:center;gap:12px;text-decoration:none">
          <div style="flex:1">
            <strong>${esc(c.displayName)}</strong>
            <div class="muted" style="font-size:.82rem">
              ${esc([c.email, c.phone, c.company].filter(Boolean).join(' · ') || 'עדיין בלי פרטי קשר — כרטיס מביקור')}
            </div>
          </div>
          ${interestPills}
          ${statusPill(c.status)}
        </a>`;
      }).join('')
    : `<div class="empty-state">
         <div style="font-size:2rem;margin-bottom:8px">👥</div>
         ${q || status || interest
           ? 'אין תוצאות לחיפוש הזה.'
           : 'עדיין אין אנשי קשר — הם ייווצרו מהפניות שיגיעו, או מביקור באתר (כרטיס זמני).'}
       </div>`;

  page(res, 'crm-contacts', 'אנשי קשר', `
    <p class="lead" style="margin-top:0">
      כרטיס אחד לכל אדם: ביקור → כרטיס זמני, מייל/שם → העשרה, דפים → תחומי עניין.
      כך אפשר לדוור רלוונטי — לא להציף.
    </p>
    <div class="stat-row">${tiles}</div>
    ${interestBar}
    <div class="card">
      <div class="section-bar">
        <div class="card-head">👥 אנשי קשר · ${interest ? rows.length + ' (מסונן)' : counts.total}</div>
        <form method="GET" action="/admin/crm" style="display:flex;gap:8px;flex-wrap:wrap">
          <input name="q" class="input" value="${esc(q)}" placeholder="חיפוש שם, מייל, טלפון…">
          <select name="status" class="input" style="width:auto" onchange="this.form.submit()">
            <option value="">כל הסטטוסים</option>
            ${contacts.STATUSES.map((s) =>
              `<option value="${s}" ${s === status ? 'selected' : ''}>${esc(contacts.statusLabel(s))}</option>`
            ).join('')}
          </select>
          ${interest ? `<input type="hidden" name="interest" value="${esc(interest)}">` : ''}
          <button class="btn secondary sm" type="submit">חפש</button>
          ${q || status || interest ? '<a class="btn secondary sm" href="/admin/crm">נקה</a>' : ''}
        </form>
      </div>
      ${interest ? `<p class="muted" style="font-size:.85rem;margin:0 0 10px">מסונן לתחום: <strong dir="auto">${esc(interest)}</strong></p>` : ''}
      ${body}
    </div>`);
});

// ─── contacts: one person ────────────────────────────────────────────
router.get('/admin/crm/:id', requireAdmin, requireCrm('crm-contacts', 'איש קשר'), (req, res) => {
  const { Customer, contacts, tasks, sequences } = require('../crm');
  const c = Customer.load(req.params.id);
  if (!c) return res.status(404).send(layout('<div class="container">איש הקשר לא נמצא</div>', 'לא נמצא', ACCENT));
  const d = c.datasheet();
  const openTasks = tasks.listForContact(d.id, { includeDone: false });
  const today = tasks.todayUTC();
  const activeSeq = sequences.listActiveForContact(d.id);
  const allSeq = sequences.listSequences().filter((s) => s.active && s.stepCount > 0);
  const personInbox = (() => {
    try {
      return c.inboxItems(10);
    } catch (e) {
      return [];
    }
  })();

  const timeline = d.timeline.length
    ? d.timeline.map((e) => `
        <div class="rec" style="display:flex;gap:10px;align-items:baseline">
          <span class="pill">${esc(e.type)}</span>
          <span style="flex:1">${esc(e.title || e.path || '')}</span>
          <span class="muted" style="font-size:.76rem">${esc(e.created_at)}</span>
        </div>`).join('')
    : '<div class="empty-state">עדיין אין פעילות.</div>';

  const reasons = d.scoreReasons.map((r) => `<li>${esc(r.why)} — ${r.points}</li>`).join('');
  // Manual tags only in the edit field — interests are edited in their own card
  // so a save cannot wipe path-learned topics by accident.
  const manualTags = (d.tags || []).filter((t) => !String(t).startsWith('interest:'));
  const interestBlock = (d.interests && d.interests.length)
    ? d.interests.map((t) => `
        <span style="display:inline-flex;align-items:center;gap:4px">
          <a class="pill" style="background:#fff7ed;color:#c2410c;border-color:#fed7aa;text-decoration:none"
             href="/admin/crm?interest=${encodeURIComponent(t)}">${esc(t)}</a>
          <form method="POST" action="/admin/crm/${d.id}/interest" style="display:inline;margin:0">
            <input type="hidden" name="action" value="remove">
            <input type="hidden" name="interest" value="${esc(t)}">
            <button type="submit" class="btn secondary sm" title="הסר תחום" style="padding:2px 8px">✕</button>
          </form>
        </span>`).join(' ')
    : '<span class="muted" style="font-size:.88rem">עדיין אין — יתווספו מצפיות בדפים (למשל /services/…), או הוסיפו ידנית.</span>';

  page(res, 'crm-contacts', d.displayName, `
    <div class="card">
      <div class="section-bar">
        <div class="card-head">👤 ${esc(d.displayName)}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${statusPill(d.status)}
          <span class="pill">ציון ${d.score}</span>
          <a class="btn secondary sm" href="/admin/crm">← לרשימה</a>
        </div>
      </div>
      ${d.status === 'provisional' ? `
        <p class="muted" style="font-size:.88rem;line-height:1.5">
          כרטיס זמני מביקור באתר — מחובר לעוגייה ראשונה בלבד.
          כשיזינו מייל או שם, הכרטיס יתעשר; בלי אינטראקציה יישכח אוטומטית.
        </p>` : ''}
      ${d.status === 'garbage' ? `
        <p class="muted" style="font-size:.88rem;color:#b91c1c">
          ממתין למחיקה אוטומטית (שקט ארוך, בלי פרטי קשר). אפשר לשחזר ידנית לסטטוס «ליד» אם טעיתם.
        </p>` : ''}
      <form method="POST" action="/admin/crm/${d.id}/update" class="stack">
        <label>שם<input name="name" class="input" value="${esc(d.name)}"></label>
        <label>מייל<input name="email" class="input" dir="ltr" value="${esc(d.email)}"></label>
        <label>טלפון<input name="phone" class="input" dir="ltr" value="${esc(d.phone)}"></label>
        <label>חברה<input name="company" class="input" value="${esc(d.company)}"></label>
        <label>סטטוס
          <select name="status" class="input">
            ${contacts.STATUSES.map((s) =>
              `<option value="${s}" ${s === d.status ? 'selected' : ''}>${esc(contacts.statusLabel(s))}</option>`).join('')}
          </select>
        </label>
        <label>תגיות (ידניות)<input name="tags" class="input" value="${esc(manualTags.join(','))}"
          placeholder="vip,newsletter — תחומי עניין מנוהלים בנפרד למטה"></label>
        <label>הערות<textarea name="notes" class="input" rows="3">${esc(d.notes)}</textarea></label>
        <label style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="consent" value="1" ${d.consent ? 'checked' : ''}> הסכמה לדיוור
        </label>
        <button class="btn" type="submit">שמור</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head">💡 תחומי עניין (מהאתר + ידני)</div>
      <p class="muted" style="font-size:.88rem;margin-top:0">
        נגזרים מדפים שביקרו בהם — בסיס לפילוח דיוור בלי להציף את כולם.
        <a href="/admin/crm/interests">מפת כל התחומים ←</a>
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${interestBlock}</div>
      <form method="POST" action="/admin/crm/${d.id}/interest"
            style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <input type="hidden" name="action" value="add">
        <input name="interest" class="input" style="flex:1;min-width:140px" dir="auto"
               placeholder="הוסיפו תחום (למשל wedding-packages)" required>
        <button class="btn secondary sm" type="submit">הוסף תחום</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head">✅ משימות · ${openTasks.length} פתוחות
        <a class="btn secondary sm" href="/admin/crm/tasks" style="margin-inline-start:auto">לוח משימות</a>
      </div>
      ${openTasks.length
        ? openTasks.map((t) => {
            const overdue = t.due_at && t.due_at < today;
            return `
            <div class="rec" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
              <div style="flex:1">
                <strong>${esc(t.title)}</strong>
                <div class="muted" style="font-size:.8rem">
                  ${esc(tasks.kindLabel(t.kind))}
                  ${t.due_at ? ' · <span style="color:' + (overdue ? '#b91c1c' : 'inherit') + '">' + esc(t.due_at) + (overdue ? ' באיחור' : '') + '</span>' : ''}
                </div>
              </div>
              <form method="POST" action="/admin/crm/tasks/${t.id}/done">
                <input type="hidden" name="returnTo" value="/admin/crm/${d.id}">
                <button class="btn sm" type="submit">בוצע</button>
              </form>
            </div>`;
          }).join('')
        : '<p class="muted" style="font-size:.88rem">אין משימות פתוחות על האדם הזה.</p>'}
      <form method="POST" action="/admin/crm/tasks" class="stack" style="margin-top:12px;border-top:1px solid var(--ws-border,#e2e8f0);padding-top:12px">
        <input type="hidden" name="contactId" value="${d.id}">
        <input type="hidden" name="returnTo" value="/admin/crm/${d.id}">
        <label>משימה חדשה<input name="title" class="input" required placeholder="להתקשר / לשלוח הצעה / …"></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select name="kind" class="input" style="width:auto">
            ${tasks.KINDS.map((k) =>
              `<option value="${k}">${esc(tasks.kindLabel(k))}</option>`).join('')}
          </select>
          <input name="dueAt" type="date" class="input" style="width:auto" value="${esc(today)}">
          <button class="btn secondary sm" type="submit">הוסף משימה</button>
        </div>
      </form>
    </div>

    ${personInbox.length ? `
    <div class="card">
      <div class="card-head">📥 בתיבה המאוחדת · ${personInbox.length}
        <a class="btn secondary sm" href="/admin/crm/inbox" style="margin-inline-start:auto">כל התיבה</a>
      </div>
      ${personInbox.map((it) => `
        <div class="rec" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="pill">${esc(require('../crm').unifiedInbox.channelLabel(it.channel))}</span>
          <span style="flex:1">${esc(it.title)}</span>
          <a class="btn secondary sm" href="${esc(it.href)}">פתח</a>
        </div>`).join('')}
    </div>` : ''}

    <div class="card">
      <div class="card-head">🏢 חברות · ${(d.companies || []).length}
        <a class="btn secondary sm" href="/admin/crm/companies" style="margin-inline-start:auto">ניהול</a>
      </div>
      ${(d.companies && d.companies.length)
        ? d.companies.map((co) => `
          <a class="rec" href="/admin/crm/companies/${co.id}" style="display:flex;gap:8px;text-decoration:none">
            <strong style="flex:1">${esc(co.name)}</strong>
            <span class="pill">${esc(co.company_role || 'member')}</span>
          </a>`).join('')
        : '<p class="muted" style="font-size:.88rem">לא מקושר לחברה — קשרו מ־<a href="/admin/crm/companies">חברות</a>.</p>'}
    </div>

    <div class="card">
      <div class="card-head">💼 עסקאות · ${(d.deals || []).length}
        <a class="btn secondary sm" href="/admin/crm/deals" style="margin-inline-start:auto">הכול</a>
      </div>
      ${(d.deals && d.deals.length)
        ? d.deals.map((deal) => `
          <a class="rec" href="/admin/crm/deals/${deal.id}" style="display:flex;gap:8px;flex-wrap:wrap;text-decoration:none;align-items:center">
            <strong style="flex:1">${esc(deal.title)}</strong>
            <span class="pill">${esc(require('../crm').deals.stageLabel(deal.stage))}</span>
            ${deal.amount != null ? `<span>₪${esc(String(deal.amount))}</span>` : ''}
          </a>`).join('')
        : `<form method="POST" action="/admin/crm/deals" class="stack">
             <input type="hidden" name="contactId" value="${d.id}">
             <label>עסקה חדשה על האדם הזה
               <input name="title" class="input" required placeholder="למשל: חבילת אתר"></label>
             <button class="btn secondary sm" type="submit">צור עסקה</button>
           </form>`}
    </div>

    <div class="card">
      <div class="card-head">🔁 רצפי מייל</div>
      ${activeSeq.length
        ? activeSeq.map((e) => `
          <div class="rec" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <a href="/admin/crm/sequences/${e.sequence_id}">${esc(e.sequence_name)}</a>
            <span class="muted" style="font-size:.8rem">שלב ${e.step_index + 1}
              ${e.next_run_at ? ' · ' + esc(e.next_run_at) : ''}</span>
            <form method="POST" action="/admin/crm/sequences/enrollments/${e.id}/cancel">
              <button class="btn secondary sm" type="submit">עצור</button>
            </form>
          </div>`).join('')
        : '<p class="muted" style="font-size:.88rem">לא רשום לרצף פעיל.</p>'}
      ${d.consent && d.email && allSeq.length ? `
        <form method="POST" action="/admin/crm/sequences/${allSeq[0].id}/enroll"
              style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"
              onsubmit="var s=this.querySelector('[name=seqId]'); this.action='/admin/crm/sequences/'+s.value+'/enroll';">
          <input type="hidden" name="contactId" value="${d.id}">
          <select name="seqId" class="input" style="width:auto">
            ${allSeq.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
          </select>
          <button class="btn secondary sm" type="submit">רשום לרצף</button>
        </form>` : !d.consent || !d.email
          ? '<p class="muted" style="font-size:.8rem">צריך מייל + הסכמה לדיוור כדי לרשום לרצף.</p>'
          : ''}
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
  const { contacts } = require('../crm');
  const id = req.params.id;
  const existing = contacts.getContact(id);
  // Preserve interest:* tags the progressive card (or interest editor) owns —
  // the form only edits manual tags so a save never wipes site-learned topics.
  const keptInterests = existing
    ? contacts.parseTags(existing.tags).filter((t) => String(t).startsWith('interest:'))
    : [];
  const manual = contacts.parseTags(b.tags).filter((t) => !String(t).startsWith('interest:'));
  contacts.updateContact(id, {
    name: b.name, email: b.email, phone: b.phone, company: b.company,
    status: b.status, tags: manual.concat(keptInterests), notes: b.notes, consent: !!b.consent
  });
  res.redirect('/admin/crm/' + encodeURIComponent(id));
});

router.post('/admin/crm/:id/interest', requireAdmin, (req, res) => {
  const { cards } = require('../crm');
  const b = req.body || {};
  const id = req.params.id;
  if (String(b.action || '') === 'remove') cards.removeInterest(id, b.interest);
  else cards.addInterest(id, b.interest);
  res.redirect('/admin/crm/' + encodeURIComponent(id));
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
