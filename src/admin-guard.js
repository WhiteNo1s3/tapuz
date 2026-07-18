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
  if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'הרשאת מנהל נדרשת' });
  return res.status(403).send('הרשאת מנהל נדרשת לפעולה זו.');
}

module.exports = { requireAdmin };
