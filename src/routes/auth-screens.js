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
    <div class="auth-stage">
      <div class="auth-card">
        <div class="auth-brand">🍊 Tapuziel</div>
        ${inner}
      </div>
    </div>`;
}
function authErr(msg) {
  return msg ? `<div class="notice slim danger auth-err">${escapeAdmin(msg)}</div>` : '';
}

router.get('/admin/login', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.verifySession(req)) return res.redirect(base);
  if (!auth.hasAdmin()) return res.redirect(base + '/create-account');
  const err = req.query.err === '1' ? 'שם משתמש או סיסמה שגויים' : '';
  const inner = `
    <h1 class="auth-title">כניסת מנהל</h1>
    ${authErr(err)}
    <form method="POST" action="${base}/login">
      <label class="field-label">שם משתמש</label>
      <input name="username" autocomplete="username" required autofocus class="input mb auth-input">
      <label class="field-label">סיסמה</label>
      <input name="password" type="password" autocomplete="current-password" required class="input mb auth-input">
      <button type="submit" class="btn block auth-submit">התחבר</button>
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
      `<div class="auth-foot"><a href="${base}/login">חזרה לכניסה</a></div>`;
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
    <h1 class="auth-title tight">יצירת חשבון מנהל</h1>
    <p class="auth-sub">זהו החשבון הראשון באתר. בחר שם משתמש וסיסמה חזקה.</p>
    ${authErr(err)}
    <form method="POST" action="${base}/create-account">
      <label class="field-label">שם משתמש</label>
      <input name="username" autocomplete="username" required autofocus class="input mb auth-input">
      <label class="field-label">סיסמה (8+ תווים)</label>
      <input name="password" type="password" autocomplete="new-password" required minlength="8" class="input mb auth-input">
      <label class="field-label">אימות סיסמה</label>
      <input name="confirm" type="password" autocomplete="new-password" required minlength="8" class="input mb auth-input">
      <button type="submit" class="btn block auth-submit">צור חשבון והתחבר</button>
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
