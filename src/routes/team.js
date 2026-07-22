'use strict';

/**
 * Team & roles (v0.95, extracted to its own route module in v0.97 — the
 * docs/ARCHITECTURE.md plan's first route-group extraction). Admin-only
 * surface: two roles, 'admin' (full access, incl. this page) and 'editor'
 * (content/media/pages, no settings or credentials). auth.js enforces
 * "never remove/demote the last admin" so the site can never lock itself
 * out from here.
 */

const express = require('express');
const auth = require('../auth');
const { layout, adminNav, accentFor, escapeAdmin } = require('../admin-ui');
const { requireAdmin } = require('../admin-guard');

const router = express.Router();

router.get('/admin/team', requireAdmin, (req, res) => {
  const users = auth.listUsers();
  const rows = users.map((u) => `
    <tr data-id="${escapeAdmin(u.id)}">
      <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9">${escapeAdmin(u.username)}${u.id === req.adminUser.uid ? ' <span style="color:#94a3b8;font-size:0.8rem">(אתה)</span>' : ''}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9">
        <select class="team-role" style="padding:6px;border:1.5px solid #cbd5e1;border-radius:6px" ${u.id === req.adminUser.uid ? 'disabled title="אי אפשר לשנות את התפקיד של עצמך"' : ''}>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>מנהל</option>
          <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>עורך</option>
        </select>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:left">
        ${u.id === req.adminUser.uid ? '' : '<button type="button" class="team-remove" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:0.85rem">הסרה</button>'}
      </td>
    </tr>`).join('');
  const html = `
    ${adminNav('team', 'צוות')}
    <div class="container" style="padding-top:28px;max-width:680px;padding-bottom:60px">
      <p class="lead">מנהל — גישה מלאה לכל ההגדרות, המפתחות ואישורי ה-SMTP. עורך — עובד על הדפים, המדיה, התפריטים והפניות, בלי גישה להגדרות רגישות.</p>
      <section class="card">
        <table style="width:100%;border-collapse:collapse;font-size:0.92rem">
          <thead><tr style="text-align:right;color:#64748b;font-size:0.8rem">
            <th style="padding:0 8px 8px">שם משתמש</th><th style="padding:0 8px 8px">תפקיד</th><th></th>
          </tr></thead>
          <tbody id="team-rows">${rows}</tbody>
        </table>
      </section>
      <section class="card">
        <h3 style="margin-top:0">➕ הזמנת חבר צוות</h3>
        <label class="field-label">שם משתמש</label>
        <input id="tm-user" class="input mb">
        <label class="field-label">סיסמה (8+ תווים)</label>
        <input id="tm-pass" type="password" class="input mb">
        <label class="field-label">תפקיד</label>
        <select id="tm-role" style="width:100%;padding:10px;border:1.5px solid #cbd5e1;border-radius:8px;margin-bottom:14px">
          <option value="editor" selected>עורך</option>
          <option value="admin">מנהל</option>
        </select>
        <div style="display:flex;justify-content:flex-end;gap:10px;align-items:center">
          <span id="tm-status" style="color:#166534;font-size:0.85rem"></span>
          <button type="button" class="btn" id="tm-add">הוספה</button>
        </div>
      </section>
    </div>
    <script>
      function refreshRole(tr) {
        var sel = tr.querySelector('.team-role');
        if (sel.disabled) return;
        fetch('/admin/api/team/' + tr.dataset.id + '/role', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: sel.value })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (!d.ok) { alert(d.error || 'שגיאה'); location.reload(); }
        });
      }
      document.querySelectorAll('.team-role').forEach(function (sel) {
        sel.addEventListener('change', function () { refreshRole(sel.closest('tr')); });
      });
      document.querySelectorAll('.team-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tr = btn.closest('tr');
          if (!confirm('להסיר את המשתמש הזה?')) return;
          fetch('/admin/api/team/' + tr.dataset.id, { method: 'DELETE' })
            .then(function (r) { return r.json(); }).then(function (d) {
              if (d.ok) tr.remove(); else alert(d.error || 'שגיאה');
            });
        });
      });
      document.getElementById('tm-add').addEventListener('click', function () {
        fetch('/admin/api/team', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('tm-user').value,
            password: document.getElementById('tm-pass').value,
            role: document.getElementById('tm-role').value
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          document.getElementById('tm-status').textContent = d.ok ? 'נוסף ✓' : (d.error || 'שגיאה');
          if (d.ok) location.reload();
        });
      });
    </script>
  `;
  res.send(layout(html, 'צוות', accentFor('team')));
});

router.post('/admin/api/team', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const user = auth.addTeamMember(b.username, b.password, b.role);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/admin/api/team/:id/role', requireAdmin, (req, res) => {
  try {
    if (req.params.id === req.adminUser.uid) {
      return res.status(400).json({ ok: false, error: 'אי אפשר לשנות את התפקיד של עצמך' });
    }
    const user = auth.setUserRole(req.params.id, (req.body || {}).role);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.delete('/admin/api/team/:id', requireAdmin, (req, res) => {
  try {
    if (req.params.id === req.adminUser.uid) {
      return res.status(400).json({ ok: false, error: 'אי אפשר להסיר את עצמך' });
    }
    auth.removeUser(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
