'use strict';

/**
 * requireAdmin — the role gate for security-sensitive admin routes (v0.95,
 * extracted from server.js in v0.97 alongside the http-util split so route
 * modules can require it without reaching back into server.js). Expects
 * server.js's session middleware to have already set req.adminUser
 * ({ uid, username, role }) before this runs.
 */

const { wantsJson } = require('./http-util');

function requireAdmin(req, res, next) {
  if (req.adminUser && req.adminUser.role === 'admin') return next();
  if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'הרשאת מנהל נדרשת', message: 'הרשאת מנהל נדרשת' });
  // An editor's menu still lists the manager-only screens, and each one used
  // to answer a single unstyled line on a blank page — a dead end with no way
  // back but the browser's button. Now it is the admin itself saying so
  // (v2.69). Lazy require: admin-ui pulls in auth and the nav table, which
  // this small guard must not load for the JSON callers above.
  try {
    const { layout, adminNav } = require('./admin-ui');
    const html = `
    ${adminNav('', 'אין הרשאה')}
    <div class="container page-body" style="max-width:620px">
      <div class="notice danger">
        <span class="notice-ico">🔒</span>
        <div class="notice-body">
          <strong>המסך הזה פתוח למנהלים בלבד</strong>
          <p>החשבון שלכם הוא חשבון עורך: דפים, מדיה, תפריטים ועיצוב פתוחים בפניכם. כדי להגיע לכאן בקשו ממנהל האתר הרשאת מנהל.</p>
          <div class="row"><a href="/admin/dashboard" class="btn">חזרה לדשבורד</a></div>
        </div>
      </div>
    </div>`;
    return res.status(403).send(layout(html, 'אין הרשאה'));
  } catch (e) {
    return res.status(403).send('הרשאת מנהל נדרשת לפעולה זו.');
  }
}

module.exports = { requireAdmin };
