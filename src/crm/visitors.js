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
 */

const crypto = require('crypto');
const { db } = require('../db');

const COOKIE = 'tz_v';
const MAX_AGE_DAYS = 365;

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

/** Forget this browser (used when a person is deleted, or on request). */
function unlink(token) {
  return db.prepare('DELETE FROM crm_visitors WHERE token = ?').run(String(token || '')).changes > 0;
}

function countForContact(contactId) {
  return db.prepare('SELECT COUNT(*) AS n FROM crm_visitors WHERE contact_id = ?').get(Number(contactId)).n;
}

module.exports = { COOKIE, readToken, link, contactIdFor, touch, unlink, countForContact };
