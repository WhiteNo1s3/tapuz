'use strict';

/**
 * CRM — the browser↔person link (v1.77, phase 2).
 *
 * WHY THIS EXISTS SEPARATELY FROM ANALYTICS
 *
 * `pageviews` is anonymous on purpose: its visitor hash is re-salted every day
 * and yesterday's salt is destroyed, so nobody — including us — can follow a
 * visitor across days from that table. That is a promise the CMS makes, and a
 * CRM feature is not a good enough reason to break it.
 *
 * Attribution therefore gets its own, narrower mechanism:
 *
 *   - a random token in a first-party cookie,
 *   - minted ONLY when someone voluntarily identifies themselves (they sent a
 *     form with their details),
 *   - ONLY while the CRM is enabled,
 *   - and readable only by this server (HttpOnly, SameSite=Lax).
 *
 * So an anonymous visitor stays anonymous forever. A person who wrote to you
 * gets a timeline — which is the thing they were already expecting when they
 * typed their phone number into your contact form.
 *
 * FOREIGN SITES (v2.21). A browser on a customer's WordPress cannot carry our
 * HttpOnly cookie: the pixel posts with `credentials: 'omit'` (the only safe
 * pairing with ACAO:*), and a no-cors form POST discards Set-Cookie. So the
 * loader mints its OWN pseudonymous id on the embedding origin and sends it
 * in the beacon body as `vid`. Server-side that id is stored ONLY as a
 * site-scoped token (`f:<site>:<vid>`) and ONLY at the moment an
 * authenticated channel binds it to a person — a form submission or an admin
 * approving an identity claim. An anonymous `vid` is never written anywhere.
 * The `f:` namespace keeps a client-chosen id from ever colliding with (or
 * replaying as) a server-minted first-party token.
 */

const crypto = require('crypto');
const { db } = require('../db');

const COOKIE = 'tz_v';
const MAX_AGE_DAYS = 365;
const FOREIGN_PREFIX = 'f:';
const VID_RE = /^[a-f0-9]{32}$/;

/** Local cookie read — the CRM does not reach into the auth module's internals. */
function readToken(req) {
  const raw = req && req.headers && req.headers.cookie;
  if (!raw) return '';
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== COOKIE) continue;
    const v = part.slice(i + 1).trim();
    // tokens are hex; anything else is someone else's cookie or a forgery
    return /^[a-f0-9]{32,64}$/.test(v) ? v : '';
  }
  return '';
}

/**
 * Bind this browser to a person and set the cookie.
 * Reuses an existing valid token rather than minting one per submission.
 */
function link(req, res, contactId) {
  const id = Number(contactId);
  if (!id) return '';

  let token = readToken(req);
  if (token) {
    const row = db.prepare('SELECT contact_id FROM crm_visitors WHERE token = ?').get(token);
    // A token already bound to this person: nothing to do but refresh it.
    if (row && row.contact_id === id) {
      touch(token);
      setCookie(req, res, token);
      return token;
    }
    // Bound to someone ELSE (shared computer) — do not reassign their history;
    // this browser earns a fresh token for the new person.
    token = '';
  }

  token = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT OR REPLACE INTO crm_visitors (token, contact_id) VALUES (?, ?)').run(token, id);
  setCookie(req, res, token);
  return token;
}

function setCookie(req, res, token) {
  if (!res || typeof res.append !== 'function') return;
  const parts = [
    COOKIE + '=' + token,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + MAX_AGE_DAYS * 24 * 60 * 60
  ];
  const https = req && (req.secure || (req.headers && req.headers['x-forwarded-proto'] === 'https'));
  if (https) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/** Which person is this browser? null when unlinked — the normal case. */
function contactIdFor(req) {
  const token = readToken(req);
  if (!token) return null;
  const row = db.prepare('SELECT contact_id FROM crm_visitors WHERE token = ?').get(token);
  return row ? row.contact_id : null;
}

function touch(token) {
  db.prepare('UPDATE crm_visitors SET last_seen_at = CURRENT_TIMESTAMP WHERE token = ?').run(token);
}

/** Touch by request cookie, if present. */
function touchFor(req) {
  const token = readToken(req);
  if (token) touch(token);
  return token;
}

/** Forget this browser (used when a person is deleted, or on request). */
function unlink(token) {
  return db.prepare('DELETE FROM crm_visitors WHERE token = ?').run(String(token || '')).changes > 0;
}

function countForContact(contactId) {
  return db.prepare('SELECT COUNT(*) AS n FROM crm_visitors WHERE contact_id = ?').get(Number(contactId)).n;
}

// ─── foreign-site visitor tokens (v2.21) ─────────────────────────────

/**
 * The storage form of a pixel visitor id, scoped to the registered site that
 * reported it. '' when the id is not a 32-hex string — anything else is not
 * ours and never reaches the database.
 */
function foreignToken(siteSlug, vid) {
  const site = String(siteSlug || '').trim().toLowerCase();
  const v = String(vid || '').trim().toLowerCase();
  if (!site || !VID_RE.test(v)) return '';
  return FOREIGN_PREFIX + site + ':' + v;
}

function isForeignToken(token) {
  return typeof token === 'string' && token.startsWith(FOREIGN_PREFIX);
}

/**
 * Bind a foreign token to a person. Only the two authenticated channels may
 * call this: a form submission (the person typed their details) and an admin
 * approving an identity claim. A token already bound elsewhere is rebound —
 * past events keep their contact, only FUTURE attribution follows the newest
 * voluntary identification, which is what the native fresh-token rule
 * achieves for cookies.
 */
function linkToken(token, contactId) {
  const id = Number(contactId);
  if (!id || !isForeignToken(token)) return '';
  db.prepare('INSERT OR REPLACE INTO crm_visitors (token, contact_id) VALUES (?, ?)').run(token, id);
  return token;
}

/** Which person is this token, if any? Null for anonymous — the normal case. */
function contactIdForToken(token) {
  if (!isForeignToken(token)) return null;
  const row = db.prepare('SELECT contact_id FROM crm_visitors WHERE token = ?').get(token);
  return row ? row.contact_id : null;
}

module.exports = {
  COOKIE,
  readToken,
  link,
  contactIdFor,
  touch,
  touchFor,
  unlink,
  countForContact,
  foreignToken,
  isForeignToken,
  linkToken,
  contactIdForToken
};
