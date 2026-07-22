'use strict';

/**
 * Forms inbox + lead pipeline (CRM) — the seventeenth route-group
 * extraction. The inbox page (submissions as leads, with the pipeline
 * summary tiles), its CSV export, and every lead mutation:
 * read/delete + the CRM fields status/notes/value/follow-up (v1.00 +
 * v1.12). One cohesive admin surface; every handler already used
 * require('./forms') locally, so only admin-ui/http-util helpers are
 * imported here. Squarely the "advanced CRM pipeline" concern.
 */

const express = require('express');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');
const { wantsJson } = require('../http-util');

const router = express.Router();

router.get('/admin/inbox', (req, res) => {
  const forms = require('../forms');
  const statusFilter = forms.STATUSES.includes(req.query.status) ? req.query.status : '';
  let items = forms.listSubmissions({ limit: 200 });
  if (statusFilter) items = items.filter((s) => (s.status || 'new') === statusFilter);
  const unread = forms.unreadCount();
  const today = new Date().toISOString().slice(0, 10);
  const dueCount = forms.listDueFollowUps().length;
  const summary = forms.pipelineSummary();
  const openValue = ['new', 'contacted', 'qualified'].reduce((sum, s) => sum + (summary[s] ? summary[s].value : 0), 0);
  const wonValue = summary.won ? summary.won.value : 0;
  const fmtMoney = (n) => n ? new Intl.NumberFormat('he-IL').format(Math.round(n)) : '0';
  const statusOptions = forms.STATUSES.map((s) =>
    `<option value="${s}">${escapeAdmin(forms.STATUS_LABELS[s])}</option>`).join('');
  const filterOptions = ['<option value="">כל הסטטוסים</option>']
    .concat(forms.STATUSES.map((s) =>
      `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${escapeAdmin(forms.STATUS_LABELS[s])}</option>`))
    .join('');

  const rows = items.length === 0
    ? `<div class="empty-state">
         <div style="font-size:2rem;margin-bottom:8px">📬</div>
         אין פניות עדיין. כשמישהו ישלח טופס באתר — זה ינחת כאן.<br>
         <span class="faint">כל מודול טופס שולח לכאן אוטומטית (אלא אם קבעתם action משלכם).</span>
       </div>`
    : items.map((s) => {
      const fields = Object.entries(s.fields).map(([k, v]) =>
        `<div class="kv">
           <span class="kv-k">${escapeAdmin(k)}</span>
           <span class="kv-v">${escapeAdmin(v)}</span>
         </div>`).join('');
      const when = String(s.created_at || '').replace('T', ' ').slice(0, 16);
      const pageLink = s.page
        ? `<a href="/${encodeURIComponent(s.page)}" target="_blank" rel="noopener" class="mono">/${escapeAdmin(s.page)}</a>`
        : '<span class="faint">מקור לא ידוע</span>';
      const status = forms.STATUSES.includes(s.status) ? s.status : 'new';
      const statusColors = { new: '#2563eb', contacted: '#c026d3', qualified: '#d97706', won: '#166534', lost: '#94a3b8' };
      const statusPill = `<span class="pill tone" style="--c:${statusColors[status]}">${escapeAdmin(forms.STATUS_LABELS[status])}</span>`;
      const isDue = s.follow_up_at && s.follow_up_at <= today && status !== 'won' && status !== 'lost';
      const dueBadge = isDue ? `<span class="pill danger">⏰ ${s.follow_up_at === today ? 'היום' : 'באיחור'}</span>` : '';
      const valuePill = s.value != null ? `<span class="ok-text" style="font-weight:700;white-space:nowrap">₪${fmtMoney(s.value)}</span>` : '';
      return `
      <details class="rec${s.is_read ? '' : ' unread'}" ${s.is_read ? '' : 'data-unread="1"'} data-sid="${s.id}">
        <summary>
          <span class="rec-left">
            ${s.is_read ? '' : '<span class="unread-dot"></span>'}
            ${statusPill}
            ${dueBadge}
            <strong class="rec-title">${escapeAdmin(Object.values(s.fields)[0] || 'פנייה')}</strong>
          </span>
          <span class="rec-right">
            ${valuePill}
            ${pageLink}
            <span class="faint">${when}</span>
          </span>
        </summary>
        <div class="rec-body">
          ${fields}
          <div class="row" style="margin-top:12px">
            <label class="inline-field">
              סטטוס
              <select class="lead-status" data-id="${s.id}">
                ${forms.STATUSES.map((st) => `<option value="${st}" ${st === status ? 'selected' : ''}>${escapeAdmin(forms.STATUS_LABELS[st])}</option>`).join('')}
              </select>
            </label>
            <label class="inline-field">
              שווי (₪)
              <input type="number" min="0" step="1" class="lead-value" data-id="${s.id}" value="${s.value != null ? s.value : ''}" placeholder="—">
            </label>
            <label class="inline-field">
              מעקב הבא
              <input type="date" class="lead-followup" data-id="${s.id}" value="${escapeAdmin(s.follow_up_at || '')}">
            </label>
            <span class="lead-crm-status ok-text" data-id="${s.id}"></span>
          </div>
          <label class="field-label" style="margin-top:12px">הערות פנימיות (לא נראות ללקוח)</label>
          <textarea class="lead-notes input" data-id="${s.id}" rows="2" placeholder="הערה על הליד…">${escapeAdmin(s.notes || '')}</textarea>
          <div class="row end" style="margin-top:8px">
            <span class="lead-notes-status ok-text" data-id="${s.id}"></span>
            <button type="button" class="btn secondary sm lead-notes-save" data-id="${s.id}">שמור הערה</button>
          </div>
          <div class="row" style="margin-top:12px">
            <form method="POST" action="/admin/inbox/read">
              <input type="hidden" name="id" value="${s.id}">
              <input type="hidden" name="read" value="${s.is_read ? '0' : '1'}">
              <button type="submit" class="btn secondary sm">${s.is_read ? 'סמן כלא נקרא' : 'סמן כנקרא'}</button>
            </form>
            <form method="POST" action="/admin/inbox/delete" onsubmit="return confirm('למחוק את הפנייה?')">
              <input type="hidden" name="id" value="${s.id}">
              <button type="submit" class="btn secondary sm">מחק</button>
            </form>
          </div>
        </div>
      </details>`;
    }).join('');

  const html = `
    ${adminNav('inbox', 'תיבת פניות')}
    <div class="container page-body mid">
      <div class="stat-grid" style="margin-bottom:16px">
        <div class="stat">
          <div class="stat-label">שווי פתוח בצנרת</div>
          <div class="stat-num" style="font-size:1.5rem">₪${fmtMoney(openValue)}</div>
        </div>
        <div class="stat" style="--c:#166534">
          <div class="stat-label">נסגר בהצלחה</div>
          <div class="stat-num" style="font-size:1.5rem">₪${fmtMoney(wonValue)}</div>
        </div>
        <div class="stat" style="--c:${dueCount ? '#b91c1c' : '#64748b'}">
          <div class="stat-label">מטופל היום / באיחור</div>
          <div class="stat-num" style="font-size:1.5rem">${dueCount}</div>
        </div>
      </div>
      <div class="row between" style="margin-bottom:16px">
        <p class="lead" style="margin:0">כל שליחת טופס מהאתר נוחתת כאן כליד. ${unread ? `<strong style="color:var(--accent-ink)">${unread} חדשות</strong>` : 'אין חדשות'}.</p>
        <div class="row">
          <select id="inbox-status-filter" class="input compact" onchange="location.href='/admin/inbox' + (this.value ? '?status=' + this.value : '')">
            ${filterOptions}
          </select>
          ${items.length ? '<a class="btn secondary sm" href="/admin/inbox.csv" style="white-space:nowrap">⬇ ייצוא CSV</a>' : ''}
        </div>
      </div>
      ${rows}
    </div>
    <script>
      // opening an unread submission marks it read — no extra click
      document.querySelectorAll('details[data-unread]').forEach(function (d) {
        d.addEventListener('toggle', function () {
          if (!d.open || d.dataset.marked) return;
          d.dataset.marked = '1';
          fetch('/admin/inbox/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: d.dataset.sid, read: '1', silent: true })
          });
        }, { once: false });
      });
      // lead pipeline (v1.00): status select auto-saves, notes save on click
      document.querySelectorAll('.lead-status').forEach(function (sel) {
        sel.addEventListener('click', function (e) { e.stopPropagation(); });
        sel.addEventListener('change', function () {
          fetch('/admin/inbox/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: sel.dataset.id, status: sel.value, silent: true })
          });
        });
      });
      // deal value + follow-up (v1.12): both auto-save on change, like status
      function crmStatusEl(id) { return document.querySelector('.lead-crm-status[data-id="' + id + '"]'); }
      document.querySelectorAll('.lead-value, .lead-followup').forEach(function (el) {
        el.addEventListener('click', function (e) { e.stopPropagation(); });
      });
      document.querySelectorAll('.lead-value').forEach(function (inp) {
        inp.addEventListener('change', function () {
          fetch('/admin/inbox/value', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: inp.dataset.id, value: inp.value, silent: true })
          }).then(function (r) { return r.json(); }).then(function (d) {
            var st = crmStatusEl(inp.dataset.id);
            if (st) { st.textContent = d.ok ? 'נשמר ✓' : 'ערך לא תקין'; st.style.color = d.ok ? '#166534' : '#b91c1c'; }
          });
        });
      });
      document.querySelectorAll('.lead-followup').forEach(function (inp) {
        inp.addEventListener('change', function () {
          fetch('/admin/inbox/follow-up', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: inp.dataset.id, date: inp.value, silent: true })
          }).then(function (r) { return r.json(); }).then(function (d) {
            var st = crmStatusEl(inp.dataset.id);
            if (st) { st.textContent = d.ok ? 'נשמר ✓' : 'שגיאה'; st.style.color = d.ok ? '#166534' : '#b91c1c'; }
          });
        });
      });
      document.querySelectorAll('.lead-notes-save').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var id = btn.dataset.id;
          var ta = document.querySelector('.lead-notes[data-id="' + id + '"]');
          var status = document.querySelector('.lead-notes-status[data-id="' + id + '"]');
          fetch('/admin/inbox/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, notes: ta.value, silent: true })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (status) status.textContent = d.ok ? 'נשמר ✓' : 'שגיאה';
          });
        });
      });
    </script>
  `;
  res.send(layout(html, 'תיבת פניות', accentFor('inbox')));
});

// The inbox as a spreadsheet (v0.87) — Excel-ready UTF-8 (BOM, Hebrew-safe).
router.get('/admin/inbox.csv', (req, res) => {
  const forms = require('../forms');
  const stamp = new Date().toISOString().slice(0, 10);
  res.type('text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="tapuz-inbox-${stamp}.csv"`);
  res.send(forms.toCsv(forms.allSubmissions()));
});

router.post('/admin/inbox/read', (req, res) => {
  const b = req.body || {};
  require('../forms').markRead(parseInt(b.id, 10), String(b.read) !== '0');
  if (b.silent || wantsJson(req)) return res.json({ ok: true });
  res.redirect('/admin/inbox');
});

router.post('/admin/inbox/delete', (req, res) => {
  require('../forms').deleteSubmission(parseInt((req.body || {}).id, 10));
  res.redirect('/admin/inbox');
});

// Lead pipeline (v1.00) — status + private notes on a submission.
router.post('/admin/inbox/status', (req, res) => {
  const b = req.body || {};
  const ok = require('../forms').setStatus(parseInt(b.id, 10), String(b.status || ''));
  if (b.silent || wantsJson(req)) return res.json({ ok });
  res.redirect('/admin/inbox');
});

router.post('/admin/inbox/notes', (req, res) => {
  const b = req.body || {};
  const ok = require('../forms').setNotes(parseInt(b.id, 10), b.notes);
  if (b.silent || wantsJson(req)) return res.json({ ok });
  res.redirect('/admin/inbox');
});

// Deal value + follow-up date (v1.12) — the rest of "advanced CRM pipeline".
router.post('/admin/inbox/value', (req, res) => {
  const b = req.body || {};
  const ok = require('../forms').setValue(parseInt(b.id, 10), b.value);
  if (b.silent || wantsJson(req)) return res.json({ ok });
  res.redirect('/admin/inbox');
});

router.post('/admin/inbox/follow-up', (req, res) => {
  const b = req.body || {};
  const ok = require('../forms').setFollowUp(parseInt(b.id, 10), b.date);
  if (b.silent || wantsJson(req)) return res.json({ ok });
  res.redirect('/admin/inbox');
});

module.exports = router;
