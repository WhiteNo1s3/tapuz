'use strict';

/**
 * Identity claims inbox (v1.99).
 *
 * A foreign `identify({email})` must NEVER call upsertContact. Anyone on the
 * internet can POST any email to a public collector; auto-upsert would mint
 * fake contacts and — worse — attach arbitrary browsing history to a real
 * person's record. Same philosophy as the copilot's stop-for-approval:
 * the claim lands here; a human (or explicit admin action) promotes it.
 */

const { db } = require('../db');
const contacts = require('./contacts');
const visitors = require('./visitors');

const STATUSES = ['pending', 'approved', 'rejected'];

function normalizeEmail(e) {
  return contacts.normalizeEmail(e);
}
function normalizePhone(p) {
  return contacts.normalizePhone(p);
}

function getClaim(id) {
  return db.prepare('SELECT * FROM crm_identity_claims WHERE id = ?').get(Number(id)) || null;
}

/**
 * Record or refresh a pending claim. Never creates a contact, never links a
 * browser — `visitorToken` is only REMEMBERED here so approval has something
 * to bind (see approveClaim).
 * @returns {{ok:boolean, claim?:object, reason?:string}}
 */
function recordClaim({
  siteId = '',
  email = '',
  phone = '',
  name = '',
  path = '',
  visitorHash = '',
  visitorToken = ''
} = {}) {
  const em = normalizeEmail(email);
  const ph = normalizePhone(phone);
  if (!em && !ph) return { ok: false, reason: 'empty' };

  const site = String(siteId || '').slice(0, 80);
  const nm = String(name || '').trim().slice(0, 200);
  const pth = String(path || '').slice(0, 300);
  const vh = String(visitorHash || '').slice(0, 32);
  const vt = visitors.isForeignToken(visitorToken) ? String(visitorToken).slice(0, 160) : '';

  // Match an open pending claim for this site + identity
  let existing = null;
  if (em) {
    existing = db
      .prepare(
        `SELECT * FROM crm_identity_claims
         WHERE status = 'pending' AND site_id = ? AND email = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(site, em);
  }
  if (!existing && ph) {
    existing = db
      .prepare(
        `SELECT * FROM crm_identity_claims
         WHERE status = 'pending' AND site_id = ? AND phone = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(site, ph);
  }

  if (existing) {
    db.prepare(
      `UPDATE crm_identity_claims
       SET claim_count = claim_count + 1,
           last_seen_at = CURRENT_TIMESTAMP,
           name = CASE WHEN ? <> '' THEN ? ELSE name END,
           path = CASE WHEN ? <> '' THEN ? ELSE path END,
           visitor_hash = CASE WHEN ? <> '' THEN ? ELSE visitor_hash END,
           visitor_token = CASE WHEN ? <> '' THEN ? ELSE visitor_token END,
           email = CASE WHEN email IS NULL OR email = '' THEN ? ELSE email END,
           phone = CASE WHEN phone IS NULL OR phone = '' THEN ? ELSE phone END
       WHERE id = ?`
    ).run(nm, nm, pth, pth, vh, vh, vt, vt, em || null, ph || null, existing.id);
    return { ok: true, claim: getClaim(existing.id), refreshed: true };
  }

  const info = db
    .prepare(
      `INSERT INTO crm_identity_claims
         (site_id, email, phone, name, visitor_hash, visitor_token, path, claim_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'pending')`
    )
    .run(site, em || null, ph || null, nm, vh, vt, pth);
  return { ok: true, claim: getClaim(info.lastInsertRowid), created: true };
}

function listClaims({ status = 'pending', siteId = '', limit = 100 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const st = STATUSES.includes(status) ? status : '';
  const site = String(siteId || '').slice(0, 80);
  if (st && site) {
    return db
      .prepare(
        `SELECT * FROM crm_identity_claims WHERE status = ? AND site_id = ?
         ORDER BY last_seen_at DESC LIMIT ?`
      )
      .all(st, site, n);
  }
  if (st) {
    return db
      .prepare(
        `SELECT * FROM crm_identity_claims WHERE status = ?
         ORDER BY last_seen_at DESC LIMIT ?`
      )
      .all(st, n);
  }
  return db
    .prepare('SELECT * FROM crm_identity_claims ORDER BY last_seen_at DESC LIMIT ?')
    .all(n);
}

function countPending() {
  return db.prepare(`SELECT COUNT(*) AS n FROM crm_identity_claims WHERE status = 'pending'`).get().n;
}

/**
 * Admin approval → real contact through the normal upsert path (not public),
 * AND the claiming browser is bound to that contact (v2.21) so its later
 * beacons from the same site land on the timeline. Before this, approval
 * created the person but attached nothing — the claim's only browser field
 * was the daily-salted analytics hash, which cannot stitch by design.
 * @returns {{ok:boolean, contact?:object, reason?:string, linked?:boolean}}
 */
function approveClaim(id) {
  const claim = getClaim(id);
  if (!claim) return { ok: false, reason: 'missing' };
  if (claim.status === 'approved' && claim.contact_id) {
    return { ok: true, contact: contacts.getContact(claim.contact_id), already: true };
  }
  if (claim.status === 'rejected') return { ok: false, reason: 'rejected' };

  const up = contacts.upsertContact({
    email: claim.email || '',
    phone: claim.phone || '',
    name: claim.name || '',
    source: claim.site_id ? 'claim:' + claim.site_id : 'claim',
    status: 'lead'
  });
  if (!up.contact) return { ok: false, reason: 'upsert' };

  db.prepare(
    `UPDATE crm_identity_claims
     SET status = 'approved', contact_id = ?, last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(up.contact.id, claim.id);

  const linked = !!visitors.linkToken(claim.visitor_token || '', up.contact.id);

  return { ok: true, contact: up.contact, created: up.created, linked };
}

function rejectClaim(id) {
  const claim = getClaim(id);
  if (!claim) return { ok: false, reason: 'missing' };
  db.prepare(
    `UPDATE crm_identity_claims SET status = 'rejected', last_seen_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(claim.id);
  return { ok: true };
}

/** Wipe claims for a subject (email/phone/contact) — used by erase. */
function eraseForSubject({ contactId, email, phone } = {}) {
  let n = 0;
  if (contactId) {
    n += db.prepare('DELETE FROM crm_identity_claims WHERE contact_id = ?').run(Number(contactId)).changes;
  }
  const em = normalizeEmail(email);
  const ph = normalizePhone(phone);
  if (em) n += db.prepare('DELETE FROM crm_identity_claims WHERE email = ?').run(em).changes;
  if (ph) n += db.prepare('DELETE FROM crm_identity_claims WHERE phone = ?').run(ph).changes;
  return n;
}

module.exports = {
  recordClaim,
  listClaims,
  countPending,
  getClaim,
  approveClaim,
  rejectClaim,
  eraseForSubject,
  STATUSES
};
