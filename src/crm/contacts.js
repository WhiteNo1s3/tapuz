'use strict';

/**
 * CRM — contacts (v1.77).
 *
 * A contact is a PERSON, resolved across every submission and visit they make.
 * The inbox keeps its rows (one per submission); this layer answers "who is
 * this?" and holds what we know about them.
 *
 * Identity rule, in order: a matching email wins, then a matching phone,
 * otherwise it is someone new. Merging never destroys knowledge — a blank
 * incoming field leaves the stored value alone, so a later form that omits the
 * name cannot erase the name we already had.
 */

const { db } = require('../db');

const STATUSES = ['lead', 'active', 'customer', 'archived'];

/** Email identity: case and spacing are not identity, so they are normalized away. */
function normalizeEmail(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  // a bare "@" or a value with spaces is not an address — treat as absent
  if (!s || s.indexOf('@') < 1 || /\s/.test(s)) return '';
  return s.slice(0, 200);
}

/**
 * Phone identity, Hebrew-first: `+972-50-123-4567`, `972501234567` and
 * `050-1234567` are one person, so the country code folds to the local 0.
 */
function normalizePhone(raw) {
  let d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('972')) d = '0' + d.slice(3);
  if (d.length < 6) return ''; // too short to identify anyone
  return d.slice(0, 20);
}

/** Tags travel as a comma string in the row and an array everywhere else. */
function parseTags(raw) {
  return String(raw == null ? '' : raw)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function serializeTags(list) {
  const seen = [];
  for (const t of Array.isArray(list) ? list : parseTags(list)) {
    const v = String(t).trim();
    if (v && seen.indexOf(v) === -1) seen.push(v);
  }
  return seen.join(',');
}

/** Everything searchable about a person, flattened once on write. */
function buildSearchBlob(row) {
  return [row.name, row.email, row.phone, row.company, row.tags, row.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .slice(0, 2000);
}

function findByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  return db.prepare('SELECT * FROM crm_contacts WHERE email = ?').get(e) || null;
}

function findByPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  return db.prepare('SELECT * FROM crm_contacts WHERE phone = ?').get(p) || null;
}

function getContact(id) {
  return db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(Number(id)) || null;
}

/** Identity resolution: email first, phone second, nobody third. */
function resolve({ email, phone } = {}) {
  return findByEmail(email) || findByPhone(phone) || null;
}

/**
 * Create or update a person from whatever a touchpoint knew about them.
 *
 * @returns {{ contact: object, created: boolean }}
 */
function upsertContact(input = {}) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const existing = resolve({ email, phone });

  if (!existing) {
    // Nothing to identify them by and nothing to say about them — refuse
    // rather than create an anonymous empty row on every stray call.
    if (!email && !phone && !String(input.name || '').trim()) {
      return { contact: null, created: false };
    }
    const row = {
      email: email || null,
      phone: phone || null,
      name: String(input.name || '').trim().slice(0, 200),
      company: String(input.company || '').trim().slice(0, 200),
      status: STATUSES.includes(input.status) ? input.status : 'lead',
      source: String(input.source || '').trim().slice(0, 100),
      tags: serializeTags(input.tags || ''),
      notes: String(input.notes || '').trim(),
      country: String(input.country || '').trim().slice(0, 2).toUpperCase(),
      consent: input.consent ? 1 : 0
    };
    row.search_blob = buildSearchBlob(row);
    const info = db
      .prepare(
        `INSERT INTO crm_contacts (email, phone, name, company, status, source, tags, notes, country, consent, search_blob)
         VALUES (@email, @phone, @name, @company, @status, @source, @tags, @notes, @country, @consent, @search_blob)`
      )
      .run(row);
    return { contact: getContact(info.lastInsertRowid), created: true };
  }

  // ── merge into the person we already know ──
  const patch = {};

  // An identifier we did not have yet fills in — but only if it is not already
  // someone else's, which the partial unique indexes would reject anyway.
  if (email && !existing.email) {
    const owner = findByEmail(email);
    if (!owner || owner.id === existing.id) patch.email = email;
  }
  if (phone && !existing.phone) {
    const owner = findByPhone(phone);
    if (!owner || owner.id === existing.id) patch.phone = phone;
  }

  // Text fields: a value only ever replaces emptiness. Editing a name is the
  // admin screen's job, not a form's.
  for (const key of ['name', 'company', 'source']) {
    const val = String(input[key] || '').trim();
    if (val && !existing[key]) patch[key] = val.slice(0, 200);
  }
  if (input.country && !existing.country) {
    patch.country = String(input.country).trim().slice(0, 2).toUpperCase();
  }
  // Consent is a latch: given once, it stays until explicitly withdrawn.
  if (input.consent && !existing.consent) patch.consent = 1;

  // Tags accumulate.
  const incomingTags = serializeTags(input.tags || '');
  if (incomingTags) {
    const merged = serializeTags(parseTags(existing.tags).concat(parseTags(incomingTags)));
    if (merged !== existing.tags) patch.tags = merged;
  }

  if (STATUSES.includes(input.status) && input.status !== existing.status) {
    patch.status = input.status;
  }

  if (!Object.keys(patch).length) {
    // Nothing new — still bump updated_at so "last seen" means something.
    db.prepare('UPDATE crm_contacts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(existing.id);
    return { contact: getContact(existing.id), created: false };
  }

  const next = Object.assign({}, existing, patch);
  patch.search_blob = buildSearchBlob(next);
  const sets = Object.keys(patch).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE crm_contacts SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    .run(Object.assign({ id: existing.id }, patch));
  return { contact: getContact(existing.id), created: false };
}

/** Admin edit — here a field CAN be cleared, because a human meant it. */
function updateContact(id, patch = {}) {
  const existing = getContact(id);
  if (!existing) return null;
  const allowed = ['name', 'company', 'status', 'source', 'notes', 'country'];
  const set = {};
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (key === 'status' && !STATUSES.includes(patch[key])) continue;
    set[key] = String(patch[key] == null ? '' : patch[key]).trim();
  }
  if (patch.tags !== undefined) set.tags = serializeTags(patch.tags);
  if (patch.consent !== undefined) set.consent = patch.consent ? 1 : 0;
  if (patch.email !== undefined) {
    const e = normalizeEmail(patch.email);
    const owner = e ? findByEmail(e) : null;
    if (!owner || owner.id === existing.id) set.email = e || null;
  }
  if (patch.phone !== undefined) {
    const p = normalizePhone(patch.phone);
    const owner = p ? findByPhone(p) : null;
    if (!owner || owner.id === existing.id) set.phone = p || null;
  }
  if (!Object.keys(set).length) return existing;

  set.search_blob = buildSearchBlob(Object.assign({}, existing, set));
  const sets = Object.keys(set).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE crm_contacts SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    .run(Object.assign({ id: Number(id) }, set));
  return getContact(id);
}

/** Deleting a person takes their timeline, edges and memberships (ON DELETE CASCADE). */
function deleteContact(id) {
  const info = db.prepare('DELETE FROM crm_contacts WHERE id = ?').run(Number(id));
  return info.changes > 0;
}

/**
 * List / search. `q` matches the denormalized blob; status narrows.
 * (LIKE is honest at this scale; FTS5 is phase 5 in docs/CRM-INTEGRATION.md.)
 */
function listContacts({ q = '', status = '', limit = 50, offset = 0 } = {}) {
  const where = [];
  const args = {};
  if (String(q).trim()) {
    where.push('search_blob LIKE @q');
    args.q = '%' + String(q).trim().toLowerCase() + '%';
  }
  if (STATUSES.includes(status)) {
    where.push('status = @status');
    args.status = status;
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  args.limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  args.offset = Math.max(parseInt(offset, 10) || 0, 0);
  return db
    .prepare(`SELECT * FROM crm_contacts ${clause} ORDER BY updated_at DESC LIMIT @limit OFFSET @offset`)
    .all(args);
}

function countContacts({ q = '', status = '' } = {}) {
  const where = [];
  const args = {};
  if (String(q).trim()) {
    where.push('search_blob LIKE @q');
    args.q = '%' + String(q).trim().toLowerCase() + '%';
  }
  if (STATUSES.includes(status)) {
    where.push('status = @status');
    args.status = status;
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.prepare(`SELECT COUNT(*) AS n FROM crm_contacts ${clause}`).get(args).n;
}

/** Contacts per status — the shape the admin header needs. */
function statusCounts() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM crm_contacts GROUP BY status').all();
  const out = {};
  for (const s of STATUSES) out[s] = 0;
  for (const r of rows) out[r.status] = r.n;
  out.total = rows.reduce((a, r) => a + r.n, 0);
  return out;
}

module.exports = {
  STATUSES,
  normalizeEmail,
  normalizePhone,
  parseTags,
  serializeTags,
  resolve,
  findByEmail,
  findByPhone,
  getContact,
  upsertContact,
  updateContact,
  deleteContact,
  listContacts,
  countContacts,
  statusCounts
};
