'use strict';

/**
 * Customer portal accounts (v2.10) — username/password for *site customers*,
 * not admin team. Off by default; self-registration is a separate explicit flag.
 *
 * Accounts hang on crm_contacts (one portal login per contact). Password = scrypt
 * via auth.hashPassword. Session cookie is separate from admin (tapuz_portal).
 *
 * Owner controls the conversation: enable portal, optionally allow self-register,
 * or mint logins from the CRM card. Restaurant (and other) verticals will use this
 * same user instance later.
 */

const crypto = require('crypto');
const { db } = require('../db');
const contacts = require('./contacts');
const auth = require('../auth');

const COOKIE = 'tapuz_portal';
const IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7d sliding
const MAX_MS = 30 * 24 * 60 * 60 * 1000; // 30d absolute

function portalConfig() {
  try {
    const cfg = require('../config').loadConfig();
    const p = (cfg.crm && cfg.crm.portal) || {};
    return {
      // Master switch — off by default; owner opts in.
      enabled: p.enabled === true,
      // Self-serve signup — also off by default; requires enabled too.
      allowSelfRegister: p.enabled === true && p.allowSelfRegister === true
    };
  } catch (e) {
    return { enabled: false, allowSelfRegister: false };
  }
}

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_portal_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_portal_user ON crm_portal_accounts(username)');
}

function normalizeUsername(u) {
  return String(u || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._@+-]+/g, '')
    .slice(0, 80);
}

function getByContact(contactId) {
  ensureTable();
  return (
    db.prepare('SELECT * FROM crm_portal_accounts WHERE contact_id = ?').get(Number(contactId)) ||
    null
  );
}

function getByUsername(username) {
  ensureTable();
  const u = normalizeUsername(username);
  if (!u) return null;
  return db.prepare('SELECT * FROM crm_portal_accounts WHERE username = ?').get(u) || null;
}

function getById(id) {
  ensureTable();
  return db.prepare('SELECT * FROM crm_portal_accounts WHERE id = ?').get(Number(id)) || null;
}

/**
 * Owner mints a login for an existing contact (always allowed when CRM on;
 * portal.enabled only required for public login/register surfaces).
 */
function createForContact(contactId, username, password) {
  ensureTable();
  const c = contacts.getContact(contactId);
  if (!c) return { ok: false, error: 'contact' };
  if (getByContact(contactId)) return { ok: false, error: 'exists' };
  const u = normalizeUsername(username);
  const pw = String(password || '');
  if (u.length < 3) return { ok: false, error: 'username' };
  if (pw.length < 8) return { ok: false, error: 'password' };
  if (getByUsername(u)) return { ok: false, error: 'username-taken' };
  // Prefer a named identity for "real customer"
  if (!c.name && !c.email && !c.phone) return { ok: false, error: 'no-identity' };

  const info = db
    .prepare(
      `INSERT INTO crm_portal_accounts (contact_id, username, password_hash)
       VALUES (?, ?, ?)`
    )
    .run(Number(contactId), u, auth.hashPassword(pw));
  return { ok: true, account: getById(info.lastInsertRowid) };
}

/**
 * Self-register: creates/upserts contact + portal account.
 * Requires portal.enabled && allowSelfRegister.
 */
function selfRegister({ username, password, name, email, phone } = {}) {
  const conf = portalConfig();
  if (!conf.allowSelfRegister) return { ok: false, error: 'disabled' };
  const u = normalizeUsername(username);
  const pw = String(password || '');
  if (u.length < 3) return { ok: false, error: 'username' };
  if (pw.length < 8) return { ok: false, error: 'password' };
  if (getByUsername(u)) return { ok: false, error: 'username-taken' };

  const em = contacts.normalizeEmail(email);
  const ph = contacts.normalizePhone(phone);
  const nm = String(name || '').trim().slice(0, 200);
  if (!em && !ph && !nm) return { ok: false, error: 'identity' };

  // If email/phone already a contact, attach portal to them; else create lead.
  let contact = contacts.resolve({ email: em, phone: ph });
  let created = false;
  if (!contact) {
    const up = contacts.upsertContact({
      email: em,
      phone: ph,
      name: nm,
      status: 'customer',
      source: 'portal-register',
      consent: false
    });
    contact = up.contact;
    created = !!up.created;
  } else if (nm && !contact.name) {
    contacts.updateContact(contact.id, { name: nm });
    contact = contacts.getContact(contact.id);
  }
  if (!contact) return { ok: false, error: 'contact' };
  if (getByContact(contact.id)) return { ok: false, error: 'exists' };

  const info = db
    .prepare(
      `INSERT INTO crm_portal_accounts (contact_id, username, password_hash)
       VALUES (?, ?, ?)`
    )
    .run(contact.id, u, auth.hashPassword(pw));
  const account = getById(info.lastInsertRowid);
  try {
    require('./hooks').emit('portal.register', {
      contactId: contact.id,
      accountId: account.id,
      username: u,
      createdContact: created
    });
  } catch (e) { /* */ }
  return {
    ok: true,
    account,
    contact,
    created
  };
}

function verifyLogin(username, password) {
  const conf = portalConfig();
  if (!conf.enabled) return null;
  const row = getByUsername(username);
  // Dummy hash work if missing (timing)
  if (!row) {
    auth.hashPassword(String(password || 'x'));
    return null;
  }
  if (!auth.verifyPassword(password, row.password_hash)) return null;
  db.prepare(
    'UPDATE crm_portal_accounts SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(row.id);
  contacts.touchActivity(row.contact_id);
  try {
    require('./events').record({
      contactId: row.contact_id,
      type: 'portal',
      title: 'התחברות לאזור אישי',
      path: '/account'
    });
  } catch (e) { /* */ }
  try {
    require('./hooks').emit('portal.login', {
      contactId: row.contact_id,
      accountId: row.id,
      username: row.username
    });
  } catch (e) { /* */ }
  return row;
}

function deleteAccountForContact(contactId) {
  ensureTable();
  return db
    .prepare('DELETE FROM crm_portal_accounts WHERE contact_id = ?')
    .run(Number(contactId)).changes > 0;
}

function setPassword(contactId, password) {
  const row = getByContact(contactId);
  if (!row) return { ok: false, error: 'missing' };
  const pw = String(password || '');
  if (pw.length < 8) return { ok: false, error: 'password' };
  db.prepare('UPDATE crm_portal_accounts SET password_hash = ? WHERE id = ?').run(
    auth.hashPassword(pw),
    row.id
  );
  return { ok: true };
}

// ── sessions (HMAC, separate cookie from admin) ─────────────────────

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', auth.getSecret() + ':portal')
    .update(body)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return body + '.' + sig;
}

function unsign(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expect = crypto
      .createHmac('sha256', auth.getSecret() + ':portal')
      .update(body)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const json = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8'
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function createSession(account) {
  const now = Date.now();
  return sign({
    aid: account.id,
    cid: account.contact_id,
    u: account.username,
    iat: now,
    last: now
  });
}

function readSession(req) {
  const conf = portalConfig();
  if (!conf.enabled) return null;
  const raw = (req.headers && req.headers.cookie) || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const data = unsign(decodeURIComponent(m[1]));
  if (!data || !data.aid || !data.cid) return null;
  const now = Date.now();
  if (now - data.iat > MAX_MS) return null;
  if (now - data.last > IDLE_MS) return null;
  const account = getById(data.aid);
  if (!account || account.contact_id !== data.cid) return null;
  return { account, contactId: data.cid, username: data.u, payload: data };
}

function setSessionCookie(res, token) {
  const maxAge = Math.floor(IDLE_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    COOKIE +
      '=' +
      encodeURIComponent(token) +
      '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' +
      maxAge
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
}

/** Public profile the logged-in customer may see about themselves. */
function publicProfile(contactId) {
  const c = contacts.getContact(contactId);
  if (!c) return null;
  const Customer = require('./Customer');
  const cust = new Customer(c);
  const account = getByContact(contactId);
  let attrs = {};
  try {
    attrs = require('./attrs').asMap(contactId, { publicOnly: true });
  } catch (e) {
    attrs = {};
  }
  return {
    username: account ? account.username : '',
    name: cust.name,
    email: cust.email,
    phone: cust.phone,
    company: cust.company,
    interests: cust.interests,
    status: cust.status,
    statusLabel: contacts.statusLabel(cust.status),
    // Vertical / enterprise fields marked public on the contact card
    attrs,
    timeline: cust.timeline(15).map((e) => ({
      type: e.type,
      title: e.title,
      path: e.path,
      at: e.created_at
    })),
    deals: (cust.deals() || []).map((d) => ({
      title: d.title,
      stage: d.stage,
      amount: d.amount
    }))
  };
}

module.exports = {
  portalConfig,
  ensureTable,
  normalizeUsername,
  getByContact,
  getByUsername,
  createForContact,
  selfRegister,
  verifyLogin,
  deleteAccountForContact,
  setPassword,
  createSession,
  readSession,
  setSessionCookie,
  clearSessionCookie,
  publicProfile,
  COOKIE
};
