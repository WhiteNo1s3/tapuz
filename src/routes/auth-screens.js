'use strict';

/**
 * Auth screens — the twenty-third route-group extraction, and a
 * security-relevant one: the entire login / logout / first-admin
 * account-creation surface, its page-shell helpers (authCard / authErr /
 * authInput), AND the escalating brute-force loginGuard they depend on
 * (a LoginGuard from ../ratelimit, used nowhere else). A non-contiguous
 * cut — the guard lived near the top of server.js, the routes far below.
 * MOUNTED after the admin gate (which path-exempts /admin/login and
 * /admin/create-account so they stay reachable without a session; logout
 * is NOT exempt and stays gated), at the same position the inline routes
 * held. Only the code moved, never the registration order.
 */

const express = require('express');
const auth = require('../auth');
const { LoginGuard } = require('../ratelimit');
const { clientIp } = require('../http-util');
const { layout, escapeAdmin } = require('../admin-ui');

const router = express.Router();

// escalating brute-force lockout on login (per-IP and per-user keys).
const loginGuard = new LoginGuard();

// ---- Auth screens (Hebrew / RTL). Exempt from the session requirement. ----
function authCard(inner) {
  return `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
      <div style="width:100%;max-width:400px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:30px;box-shadow:0 12px 40px rgba(15,23,42,0.08)">
        <div style="text-align:center;margin-bottom:18px">
          <div style="font-size:1.8rem;font-weight:800;color:#0f172a">Tapuz</div>
        </div>
        ${inner}
      </div>
    </div>`;
}
function authErr(msg) {
  return msg
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:0.88rem">${escapeAdmin(msg)}</div>`
    : '';
}
const authInput = 'width:100%;padding:11px;border:1.5px solid #cbd5e1;border-radius:9px;margin-bottom:14px;box-sizing:border-box;font-size:1rem';

router.get('/admin/login', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.verifySession(req)) return res.redirect(base);
  if (!auth.hasAdmin()) return res.redirect(base + '/create-account');
  const err = req.query.err === '1' ? 'שם משתמש או סיסמה שגויים' : '';
  const inner = `
    <h1 style="font-size:1.15rem;text-align:center;margin:0 0 18px;color:#334155">כניסת מנהל</h1>
    ${authErr(err)}
    <form method="POST" action="${base}/login">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">שם משתמש</label>
      <input name="username" autocomplete="username" required autofocus style="${authInput}">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">סיסמה</label>
      <input name="password" type="password" autocomplete="current-password" required style="${authInput}">
      <button type="submit" class="btn" style="width:100%;padding:12px;font-size:1rem">התחבר</button>
    </form>`;
  res.send(layout(authCard(inner), 'כניסה', '#f97316', { bare: true }));
});

router.post('/admin/login', (req, res) => {
  const base = auth.getAdminBase();
  const ip = clientIp(req);
  const username = String((req.body && req.body.username) || '');
  const ipKey = 'ip:' + ip;
  const userKey = 'usr:' + ip + '|' + username.toLowerCase();

  const s1 = loginGuard.status(ipKey);
  const s2 = loginGuard.status(userKey);
  if (s1.locked || s2.locked) {
    const ra = Math.max(s1.retryAfter || 0, s2.retryAfter || 0);
    res.setHeader('Retry-After', String(ra));
    const inner = authErr(`נחסמת זמנית עקב ניסיונות כושלים. נסה שוב בעוד ${ra} שניות.`) +
      `<div style="text-align:center"><a href="${base}/login">חזרה לכניסה</a></div>`;
    return res.status(429).send(layout(authCard(inner), 'נחסם', '#f97316', { bare: true }));
  }

  const user = auth.verifyLogin(username, (req.body && req.body.password) || '');
  if (!user) {
    loginGuard.fail(ipKey);
    loginGuard.fail(userKey);
    return res.redirect(base + '/login?err=1');
  }
  loginGuard.succeed(ipKey);
  loginGuard.succeed(userKey);
  auth.issueSession(res, user.id, req); // fresh session
  res.redirect(base);
});

router.post('/admin/logout', (req, res) => {
  auth.clearSession(res);
  res.redirect(auth.getAdminBase() + '/login');
});

router.get('/admin/create-account', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.hasAdmin()) return res.redirect(base + '/login');
  const err = req.query.err ? decodeURIComponent(req.query.err) : '';
  const inner = `
    <h1 style="font-size:1.15rem;text-align:center;margin:0 0 6px;color:#334155">יצירת חשבון מנהל</h1>
    <p style="text-align:center;color:#64748b;font-size:0.86rem;margin:0 0 18px">זהו החשבון הראשון באתר. בחר שם משתמש וסיסמה חזקה.</p>
    ${authErr(err)}
    <form method="POST" action="${base}/create-account">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">שם משתמש</label>
      <input name="username" autocomplete="username" required autofocus style="${authInput}">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">סיסמה (8+ תווים)</label>
      <input name="password" type="password" autocomplete="new-password" required minlength="8" style="${authInput}">
      <label style="display:block;font-weight:600;margin-bottom:4px;font-size:0.9rem">אימות סיסמה</label>
      <input name="confirm" type="password" autocomplete="new-password" required minlength="8" style="${authInput}">
      <button type="submit" class="btn" style="width:100%;padding:12px;font-size:1rem">צור חשבון והתחבר</button>
    </form>`;
  res.send(layout(authCard(inner), 'יצירת חשבון', '#166534', { bare: true }));
});

router.post('/admin/create-account', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.hasAdmin()) return res.redirect(base + '/login');
  const b = req.body || {};
  if (String(b.password || '') !== String(b.confirm || '')) {
    return res.redirect(base + '/create-account?err=' + encodeURIComponent('הסיסמאות אינן תואמות'));
  }
  try {
    const u = auth.createAdmin(b.username, b.password);
    auth.issueSession(res, u.id, req);
    res.redirect(base);
  } catch (e) {
    res.redirect(base + '/create-account?err=' + encodeURIComponent(e.message || 'שגיאה'));
  }
});

module.exports = router;
