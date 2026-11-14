'use strict';

/**
 * Customer portal routes (v2.10) — public when crm.portal.enabled.
 * Self-register only when allowSelfRegister is also true.
 * Separate from admin auth; sessions do not open /admin.
 */

const express = require('express');
const portal = require('../crm/portal');
const { isEnabled } = require('../crm');
const auth = require('../auth');
const { clientIp, sharedAddress } = require('../http-util');
const { FixedWindowLimiter, LoginGuard } = require('../ratelimit');

const router = express.Router();

// v2.69 — the customers' door gets what the admin's door has had since S4.
// It had no limit at all: a script could try passwords, or open accounts, as
// fast as the server answered. The guard is the admin's own escalating
// lockout (five free tries, then 30 seconds doubling up to an hour), keyed
// per address and per address+username; the limiters cap each address per
// minute. TAPUZ_PORTAL_LOGIN_MAX / TAPUZ_PORTAL_REGISTER_MAX override the
// caps (a smoke forces a 429 with them).
const loginGuard = new LoginGuard();
const loginLimiter = new FixedWindowLimiter({ windowMs: 60 * 1000, max: parseInt(process.env.TAPUZ_PORTAL_LOGIN_MAX, 10) || 20 });
const registerLimiter = new FixedWindowLimiter({ windowMs: 60 * 1000, max: parseInt(process.env.TAPUZ_PORTAL_REGISTER_MAX, 10) || 6 });

// What ?err= may say. The screens used to print whatever the address held
// (escaped, but still any sentence a link's author wanted under the site's
// name); now a code not in this table prints the plain "something went wrong".
const LOGIN_ERRORS = {
  1: 'שם משתמש או סיסמה שגויים',
  locked: 'יותר מדי ניסיונות כושלים. נסו שוב בעוד כמה דקות.',
  busy: 'יותר מדי בקשות. נסו שוב בעוד רגע.'
};
const REGISTER_ERRORS = {
  username: 'שם משתמש קצר מדי (לפחות 3)',
  password: 'סיסמה לפחות 8 תווים',
  'username-taken': 'שם המשתמש תפוס',
  identity: 'מלאו שם, מייל או טלפון',
  exists: 'כבר יש חשבון לפרטים האלה',
  contact: 'לא הצלחנו לפתוח כרטיס לקוח. נסו שוב.',
  disabled: 'הרשמה כבויה',
  busy: 'יותר מדי בקשות. נסו שוב בעוד רגע.'
};
const GENERIC_ERROR = 'משהו השתבש. נסו שוב.';
function errorText(table, code) {
  const key = String(code || '');
  if (!key) return '';
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : GENERIC_ERROR;
}

/** A real 429 with Retry-After, in the portal's own page (never a bare line). */
function tooMany(res, retryAfter, text, backHref) {
  res.setHeader('Retry-After', String(Math.max(1, retryAfter || 1)));
  res.status(429).type('html').send(shell('רגע אחד',
    `<div class="box"><h1>רגע אחד</h1><div class="err">${esc(text)}</div><a href="${esc(backHref)}">חזרה</a></div>`));
}

// CSRF: the same Origin/Referer test the admin gate applies to its POSTs
// (auth.sameOrigin). A form on someone else's site must not be able to sign a
// customer in, open an account in their name, or sign them out.
function requireSameOrigin(req, res, next) {
  if (auth.sameOrigin(req)) return next();
  res.status(403).type('html').send(shell('הבקשה נדחתה',
    '<div class="box"><h1>הבקשה נדחתה</h1><p class="muted">הטופס לא נשלח מהאתר הזה (בדיקת מקור). חזרו לדף ההתחברות ונסו שוב.</p><a href="/account/login">להתחברות</a></div>'));
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function siteTitle() {
  try {
    return require('../config').loadConfig().title || 'Tapuziel';
  } catch (e) {
    return 'Tapuziel';
  }
}

function shell(title, body) {
  const t = siteTitle();
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · ${esc(t)}</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#fffbf7;color:#1c1917;margin:0;padding:24px;line-height:1.6}
    .box{max-width:420px;margin:40px auto;background:#fff;border:1px solid #ece5df;border-radius:16px;padding:28px 24px;box-shadow:0 8px 30px rgba(28,25,23,.06)}
    .wide{max-width:640px}
    h1{font-size:1.25rem;margin:0 0 8px}
    .muted{color:#78716c;font-size:.9rem}
    label{display:block;margin:12px 0 4px;font-weight:600;font-size:.9rem}
    input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #e7e5e4;border-radius:10px;font-size:1rem}
    button,.btn{display:inline-block;margin-top:16px;padding:10px 18px;background:#ea580c;color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;text-decoration:none}
    .btn.secondary{background:#fff;color:#ea580c;border:1px solid #fed7aa}
    .err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:10px 12px;border-radius:10px;margin-bottom:12px;font-size:.9rem}
    .ok{background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;padding:10px 12px;border-radius:10px;margin-bottom:12px;font-size:.9rem}
    .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .pill{display:inline-block;padding:2px 10px;border-radius:999px;background:#fff7ed;border:1px solid #fed7aa;font-size:.8rem}
    .kv{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f5f5f4}
    .kv b{min-width:90px}
    .foot{text-align:center;margin-top:18px}
    a{color:#c2410c}
  </style>
</head>
<body>${body}</body></html>`;
}

function requirePortal(req, res, next) {
  if (!isEnabled() || !portal.portalConfig().enabled) {
    return res.status(404).send(shell('לא זמין', '<div class="box"><h1>אזור אישי לא פעיל</h1><p class="muted">בעל האתר טרם הפעיל את אזור הלקוחות.</p><a href="/">חזרה לאתר</a></div>'));
  }
  next();
}

function requireLoggedIn(req, res, next) {
  const sess = portal.readSession(req);
  if (!sess) return res.redirect('/account/login');
  req.portal = sess;
  next();
}

router.get('/account/login', requirePortal, (req, res) => {
  if (portal.readSession(req)) return res.redirect('/account');
  const err = errorText(LOGIN_ERRORS, (req.query || {}).err);
  const conf = portal.portalConfig();
  res.type('html').send(
    shell(
      'התחברות',
      `<div class="box">
        <h1>התחברות</h1>
        <p class="muted">אזור אישי — המידע שלך אצל ${esc(siteTitle())}</p>
        ${err ? `<div class="err">${esc(err)}</div>` : ''}
        <form method="POST" action="/account/login">
          <label>שם משתמש<input name="username" required autocomplete="username" dir="ltr"></label>
          <label>סיסמה<input name="password" type="password" required autocomplete="current-password" dir="ltr"></label>
          <button type="submit">התחבר</button>
        </form>
        ${conf.allowSelfRegister ? '<p class="foot muted">אין חשבון? <a href="/account/register">הרשמה</a></p>' : ''}
        <p class="foot"><a href="/">← לאתר</a></p>
      </div>`
    )
  );
});

router.post('/account/login', express.urlencoded({ extended: true }), requirePortal, requireSameOrigin, (req, res) => {
  const b = req.body || {};
  const ip = clientIp(req);
  // Behind a proxy nobody declared, `ip` is the proxy's and every visitor
  // has it (http-util.sharedAddress): the per-address cap and the
  // address-only lock would be one visitor shutting every customer out.
  // There the lock is the ACCOUNT's alone — the name exactly as the portal
  // looks it up (portal.normalizeUsername), so "Dana " or "da na" is not a
  // fresh set of tries — and the two address-keyed limits are not applied,
  // because there they cannot tell one visitor from another.
  const shared = sharedAddress(req);
  if (!shared && !loginLimiter.allow('portal-login:' + ip)) {
    return tooMany(res, loginLimiter.retryAfter('portal-login:' + ip), LOGIN_ERRORS.busy, '/account/login');
  }
  const ipKey = 'ip:' + ip;
  const userKey = shared
    ? 'name:' + portal.normalizeUsername(b.username)
    : 'usr:' + ip + '|' + String(b.username || '').trim().toLowerCase();
  const s1 = shared ? { locked: false } : loginGuard.status(ipKey);
  const s2 = loginGuard.status(userKey);
  if (s1.locked || s2.locked) {
    return tooMany(res, Math.max(s1.retryAfter || 0, s2.retryAfter || 0), LOGIN_ERRORS.locked, '/account/login');
  }
  const row = portal.verifyLogin(b.username, b.password);
  if (!row) {
    if (!shared) loginGuard.fail(ipKey);
    loginGuard.fail(userKey);
    return res.redirect('/account/login?err=1');
  }
  if (!shared) loginGuard.succeed(ipKey);
  loginGuard.succeed(userKey);
  portal.setSessionCookie(res, portal.createSession(row), auth.isHttps(req));
  res.redirect('/account');
});

router.get('/account/register', requirePortal, (req, res) => {
  const conf = portal.portalConfig();
  if (!conf.allowSelfRegister) {
    return res.status(404).send(
      shell(
        'הרשמה סגורה',
        `<div class="box"><h1>הרשמה לא פתוחה</h1><p class="muted">רק בעל האתר יכול לפתוח חשבון עבורכם.</p><a href="/account/login">התחברות</a></div>`
      )
    );
  }
  const err = errorText(REGISTER_ERRORS, (req.query || {}).err);
  res.type('html').send(
    shell(
      'הרשמה',
      `<div class="box">
        <h1>יצירת חשבון</h1>
        <p class="muted">תיפתח כרטיס לקוח אצלנו — אתם שולטים במה שאתם מזינים.</p>
        ${err ? `<div class="err">${esc(err)}</div>` : ''}
        <form method="POST" action="/account/register">
          <label>שם משתמש<input name="username" required dir="ltr" autocomplete="username"></label>
          <label>סיסמה<input name="password" type="password" required minlength="8" dir="ltr" autocomplete="new-password"></label>
          <label>שם מלא<input name="name" autocomplete="name"></label>
          <label>מייל<input name="email" type="email" dir="ltr" autocomplete="email"></label>
          <label>טלפון<input name="phone" dir="ltr" autocomplete="tel"></label>
          <button type="submit">הרשמה</button>
        </form>
        <p class="foot muted"><a href="/account/login">יש לי חשבון</a></p>
      </div>`
    )
  );
});

router.post('/account/register', express.urlencoded({ extended: true }), requirePortal, requireSameOrigin, (req, res) => {
  const b = req.body || {};
  const ip = clientIp(req);
  // the same rule as the login above: a cap keyed on an address every
  // visitor shares would let one of them close registration for all
  if (!sharedAddress(req) && !registerLimiter.allow('portal-register:' + ip)) {
    return tooMany(res, registerLimiter.retryAfter('portal-register:' + ip), REGISTER_ERRORS.busy, '/account/register');
  }
  const r = portal.selfRegister({
    username: b.username,
    password: b.password,
    name: b.name,
    email: b.email,
    phone: b.phone
  });
  if (!r.ok) return res.redirect('/account/register?err=' + encodeURIComponent(r.error || '1'));
  portal.setSessionCookie(res, portal.createSession(r.account), auth.isHttps(req));
  res.redirect('/account');
});

router.get('/account', requirePortal, requireLoggedIn, (req, res) => {
  const profile = portal.publicProfile(req.portal.contactId);
  if (!profile) {
    portal.clearSessionCookie(res);
    return res.redirect('/account/login');
  }
  const tl = (profile.timeline || [])
    .map(
      (e) =>
        `<div class="kv"><b>${esc(e.type)}</b><span>${esc(e.title || e.path || '')} <span class="muted">${esc(String(e.at || '').slice(0, 16))}</span></span></div>`
    )
    .join('');
  const deals = (profile.deals || [])
    .map(
      (d) =>
        `<div class="kv"><b>${esc(d.title)}</b><span class="pill">${esc(d.stage)}</span>${d.amount != null ? ' ₪' + esc(String(d.amount)) : ''}</div>`
    )
    .join('');

  res.type('html').send(
    shell(
      'האזור שלי',
      `<div class="box wide">
        <div class="row" style="justify-content:space-between">
          <div>
            <h1>שלום${profile.name ? ', ' + esc(profile.name) : ''}</h1>
            <p class="muted">מחובר/ת כ־<span dir="ltr">${esc(profile.username)}</span>
              · <span class="pill">${esc(profile.statusLabel)}</span></p>
          </div>
          <form method="POST" action="/account/logout"><button class="btn secondary" type="button" onclick="this.form.submit()">יציאה</button></form>
        </div>
        <h2 style="font-size:1rem;margin:20px 0 8px">הפרטים שלך</h2>
        <div class="kv"><b>שם</b><span>${esc(profile.name || '—')}</span></div>
        <div class="kv"><b>מייל</b><span dir="ltr">${esc(profile.email || '—')}</span></div>
        <div class="kv"><b>טלפון</b><span dir="ltr">${esc(profile.phone || '—')}</span></div>
        <div class="kv"><b>חברה</b><span>${esc(profile.company || '—')}</span></div>
        ${
          profile.interests && profile.interests.length
            ? `<p class="muted" style="margin-top:12px">תחומי עניין: ${profile.interests.map((t) => esc(t)).join(' · ')}</p>`
            : ''
        }
        ${
          profile.attrs && Object.keys(profile.attrs).length
            ? `<h2 style="font-size:1rem;margin:20px 0 8px">פרטים נוספים</h2>` +
              Object.keys(profile.attrs)
                .map((k) => {
                  const v = profile.attrs[k];
                  const shown = typeof v === 'string' ? v : JSON.stringify(v);
                  return `<div class="kv"><b dir="ltr">${esc(k)}</b><span>${esc(shown)}</span></div>`;
                })
                .join('')
            : ''
        }
        ${deals ? `<h2 style="font-size:1rem;margin:20px 0 8px">עסקאות</h2>${deals}` : ''}
        <h2 style="font-size:1rem;margin:20px 0 8px">היסטוריה אצלנו</h2>
        ${tl || '<p class="muted">עדיין אין פעילות מתועדת.</p>'}
        <p class="foot muted"><a href="/">← לאתר</a></p>
      </div>`
    )
  );
});

router.post('/account/logout', requireSameOrigin, (req, res) => {
  portal.clearSessionCookie(res);
  res.redirect('/account/login');
});

module.exports = router;
