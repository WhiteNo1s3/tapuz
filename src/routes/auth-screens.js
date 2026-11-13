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
const { clientIp, sharedAddress, isLoopbackRequest } = require('../http-util');
const { layout, escapeAdmin } = require('../admin-ui');

const router = express.Router();

// escalating brute-force lockout on login (per-IP and per-user keys).
const loginGuard = new LoginGuard();

// The setup-code door when every visitor shares one address (an undeclared
// proxy, http-util.sharedAddress). The first account has no name to key a
// lock on, so this lock is one lock for everybody — and on the ladder above
// a stranger's single wrong code an hour kept the owner out of first-account
// creation for good. So here the lock does not grow: five free tries, the
// sixth wrong code closes the door for 30 seconds (the ladder's first rung),
// and when it opens there are five fresh tries. Guessing is still capped, at
// six codes per half minute: nothing against the boot code's ten random
// characters, and one more reason a TAPUZ_SETUP_TOKEN should be long. The
// owner is never more than half a minute from an open door — though a script
// that keeps guessing can still keep closing it; on a shared address nothing
// here can tell the two apart, and TAPUZ_TRUST_PROXY is the cure. The streak
// is forgotten one millisecond before the lock length, so that the first
// wrong code after a lock starts a new count instead of locking again at once.
const SETUP_LOCK_MS = 30 * 1000;
const sharedSetupGuard = new LoginGuard({ baseLockMs: SETUP_LOCK_MS, maxLockMs: SETUP_LOCK_MS, forgetMs: SETUP_LOCK_MS - 1 });

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

// The accounts file exists and cannot be read (src/auth.js fails closed on
// it): say so on the login screen, with what to do, instead of answering
// "wrong password" to an owner whose password is right.
function authDamagedNotice() {
  if (auth.authState() !== 'corrupt') return '';
  // nowrap: a file name that breaks at its hyphen inside a right-to-left line
  // comes out in two pieces in the wrong order
  const file = (name) => `<span dir="ltr" style="white-space:nowrap">${name}</span>`;
  return `<div class="notice slim danger auth-err">
      <strong>קובץ החשבונות פגום</strong>
      <p>הקובץ ${file('config/auth.json')} קיים אבל לא ניתן לקרוא אותו, ולכן אי אפשר להתחבר כרגע. שום חשבון לא נמחק ושום דבר לא נכתב על הקובץ: עותק שלו נשמר לידו בשם ${file('auth.json.corrupt-…')}</p>
      <p>כדי לחזור לעבוד: החזירו את ${file('config/auth.json')} מגיבוי (או תקנו את ה-JSON שבו) ורעננו את הדף. אין צורך להפעיל את השרת מחדש.</p>
    </div>`;
}

router.get('/admin/login', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.verifySession(req)) return res.redirect(base);
  if (!auth.hasAdmin()) return res.redirect(base + '/create-account');
  const damaged = authDamagedNotice();
  const err = damaged ? '' : (req.query.err === '1' ? 'שם משתמש או סיסמה שגויים' : '');
  const inner = `
    <h1 class="auth-title">כניסת מנהל</h1>
    ${damaged}
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

// The lockout answer — one screen for the two doors that guard a secret
// (the password, and since v2.69 the first-run setup code).
function lockedOut(res, retryAfter, backHref, backLabel) {
  res.setHeader('Retry-After', String(retryAfter));
  const inner = authErr(`נחסמת זמנית עקב ניסיונות כושלים. נסה שוב בעוד ${retryAfter} שניות.`) +
    `<div class="auth-foot"><a href="${backHref}">${backLabel}</a></div>`;
  return res.status(429).send(layout(authCard(inner), 'נחסם', '#f97316', { bare: true }));
}

router.post('/admin/login', (req, res) => {
  const base = auth.getAdminBase();
  const ip = clientIp(req);
  const username = String((req.body && req.body.username) || '');
  // Behind a proxy nobody declared, `ip` is the proxy's — the same for every
  // visitor (http-util.sharedAddress). Keyed on it, six wrong passwords by a
  // stranger, for any usernames at all, shut the owner out of his own admin.
  // There the lock counts wrong passwords per ACCOUNT alone: the name as
  // auth.findUser reads it (trimmed, lower-cased), so "Owner " is not a fresh
  // set of tries, under its own prefix so it can never be mistaken for an
  // address key, and cut to a length because nothing else bounds what a
  // stranger may send as a name. The ladder, the sentence and Retry-After are
  // the same; only the address-only lock is not consulted, because there it
  // cannot tell one visitor from another.
  const shared = sharedAddress(req);
  const ipKey = 'ip:' + ip;
  const userKey = shared
    ? 'name:' + username.trim().toLowerCase().slice(0, 200)
    : 'usr:' + ip + '|' + username.toLowerCase();

  const s1 = shared ? { locked: false } : loginGuard.status(ipKey);
  const s2 = loginGuard.status(userKey);
  if (s1.locked || s2.locked) {
    return lockedOut(res, Math.max(s1.retryAfter || 0, s2.retryAfter || 0), base + '/login', 'חזרה לכניסה');
  }

  const user = auth.verifyLogin(username, (req.body && req.body.password) || '');
  if (!user) {
    if (!shared) loginGuard.fail(ipKey);
    loginGuard.fail(userKey);
    return res.redirect(base + '/login?err=1');
  }
  if (!shared) loginGuard.succeed(ipKey);
  loginGuard.succeed(userKey);
  auth.issueSession(res, user.id, req); // fresh session
  res.redirect(base);
});

router.post('/admin/logout', (req, res) => {
  auth.clearSession(res);
  res.redirect(auth.getAdminBase() + '/login');
});

// The first account on a site belongs to whoever started the server, not to
// whoever finds /admin/create-account first (v2.69). The setup code is
// TAPUZ_SETUP_TOKEN, or the code the server printed in its log at boot
// (src/auth.js setupCode). With the boot code, a browser on the server's own
// machine is let through without it — that is local development. A host that
// SET the token gets it asked of everyone: "local" is a guess from the
// request (http-util.isLoopbackRequest), a reverse proxy on the same machine
// that hides itself defeats the guess, and whoever set the token can type it.
// And the guess is only taken at all in a run somebody started in a terminal
// (auth.interactiveRun): a same-machine forwarder that adds no forwarding
// header and speaks HTTP/1.1 looks exactly like that browser, and behind one
// a stranger created the first account without the code. A hosted process
// has no terminal, so there the code is asked of everyone — the developer at
// `npm start` still is not, and the code is in the terminal he is looking at.
function needsSetupCode(req) {
  return auth.setupCodeSource() === 'env' || !auth.interactiveRun() || !isLoopbackRequest(req);
}

router.get('/admin/create-account', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.hasAdmin()) return res.redirect(base + '/login');
  // Express already decoded the query once; decoding again threw on a stray
  // '%' (?err=%25 answered 500)
  const err = req.query.err ? String(req.query.err).slice(0, 200) : '';
  const codeField = needsSetupCode(req)
    ? `<label class="field-label">קוד הקמה</label>
      <input name="setupCode" dir="ltr" autocomplete="off" autocapitalize="${auth.setupCodeSource() === 'env' ? 'off' : 'characters'}" spellcheck="false" required class="input auth-input">
      <p class="faint" style="margin:6px 0 14px">${auth.setupCodeSource() === 'env'
        ? 'הקוד הוא הערך של משתנה הסביבה <span dir="ltr">TAPUZ_SETUP_TOKEN</span> שהוגדר לשרת.'
        : 'הקוד מודפס ביומן השרת (log) בכל הפעלה, בשורה "קוד הקמה". אפשר גם לקבוע אותו מראש במשתנה הסביבה <span dir="ltr">TAPUZ_SETUP_TOKEN</span>.'} כך רק מי שהפעיל את השרת יכול ליצור את החשבון הראשון.</p>`
    : '';
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
      ${codeField}
      <button type="submit" class="btn block auth-submit">צור חשבון והתחבר</button>
    </form>`;
  res.send(layout(authCard(inner), 'יצירת חשבון', '#166534', { bare: true }));
});

router.post('/admin/create-account', (req, res) => {
  const base = auth.getAdminBase();
  if (auth.hasAdmin()) return res.redirect(base + '/login');
  const b = req.body || {};
  if (needsSetupCode(req)) {
    // guesses at the code meet the login's own escalating lockout: a token
    // the host chose may be short, and this door is open to the internet
    const shared = sharedAddress(req);
    const guard = shared ? sharedSetupGuard : loginGuard;
    const key = shared ? 'setup' : 'setup:' + clientIp(req);
    const lock = guard.status(key);
    if (lock.locked) return lockedOut(res, lock.retryAfter || 1, base + '/create-account', 'חזרה');
    if (!auth.checkSetupCode(b.setupCode)) {
      guard.fail(key);
      return res.redirect(base + '/create-account?err=' + encodeURIComponent(auth.setupCodeSource() === 'env'
        ? 'קוד ההקמה חסר או שגוי — זהו הערך של TAPUZ_SETUP_TOKEN שהוגדר לשרת'
        : 'קוד ההקמה חסר או שגוי — הוא מודפס ביומן השרת בהפעלה'));
    }
    guard.succeed(key);
  }
  if (String(b.password || '') !== String(b.confirm || '')) {
    return res.redirect(base + '/create-account?err=' + encodeURIComponent('הסיסמאות אינן תואמות'));
  }
  try {
    const u = auth.createAdmin(b.username, b.password);
    auth.issueSession(res, u.id, req);
    // First account on a pristine site → straight into the setup wizard.
    // (/admin would bounce there anyway via admin-home, but landing the new
    // owner on the wizard directly is the advice, not a detour.)
    const { needsSetup } = require('../setup');
    res.redirect(needsSetup() ? base + '/setup' : base);
  } catch (e) {
    res.redirect(base + '/create-account?err=' + encodeURIComponent(e.message || 'שגיאה'));
  }
});

module.exports = router;
