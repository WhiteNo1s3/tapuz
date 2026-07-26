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

const { db, crmSearchReady } = require('../db');

// provisional = progressive card before they gave an address (cookie-stitched)
// garbage    = quiet provisional, pending hard erase (see cards.runCardLifecycle)
const STATUSES = ['provisional', 'lead', 'active', 'customer', 'archived', 'garbage'];

/** Hebrew labels for admin UI — the product voice, not the enum key. */
const STATUS_LABELS = {
  provisional: 'כרטיס זמני',
  lead: 'ליד',
  active: 'פעיל',
  customer: 'לקוח',
  archived: 'בארכיון',
  garbage: 'ממתין למחיקה'
};

function statusLabel(s) {
  return STATUS_LABELS[s] || String(s || '');
}

/**
 * Turn what someone typed into a safe FTS5 query (v1.82).
 *
 * FTS5 has its own query language — `"`, `*`, `-`, `:`, `(`, `AND`/`OR`/`NOT`
 * are all operators — so raw input either throws a syntax error or silently
 * means something the user did not ask for. Every token is therefore reduced to
 * word characters, quoted as a literal, and given a `*` so partial names match:
 * `דנה כה` becomes `"דנה"* "כה"*`, which is an implicit AND of two prefixes.
 *
 * @returns {string} an FTS5 MATCH expression, or '' when nothing usable remains
 */
function toFtsQuery(raw) {
  const tokens = String(raw == null ? '' : raw)
    .split(/\s+/)
    .map((t) => t.replace(/["*\-:^(){}[\]]/g, '').trim())
    .filter(Boolean)
    .slice(0, 10);
  if (!tokens.length) return '';
  return tokens.map((t) => '"' + t + '"*').join(' ');
}

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
    // Progressive cards (status=provisional) may open with no address yet —
    // stitched only by first-party cookie. Every other caller still needs a
    // name or identifier so we never mint empty rows from noise.
    const wantProvisional = input.status === 'provisional';
    if (!email && !phone && !String(input.name || '').trim() && !wantProvisional) {
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
/**
 * Build the FROM/WHERE for a search, preferring the FTS5 index.
 *
 * Falls back to LIKE when full-text search is unavailable OR when the query
 * reduced to nothing usable — so a search for `***` still behaves, and a SQLite
 * without FTS5 still finds people, just more slowly.
 */
/**
 * kind:
 *   ''     — everyone
 *   real   — named/reachable people (name|email|phone), not provisional/garbage
 *            ("real customers" kept ~1y quiet; ghosts use the short path)
 */
function searchClause({ q = '', status = '', kind = '' } = {}) {
  const args = {};
  const where = [];
  let from = 'crm_contacts c';

  const text = String(q == null ? '' : q).trim();
  if (text) {
    const fts = crmSearchReady() ? toFtsQuery(text) : '';
    if (fts) {
      from = 'crm_contacts c JOIN crm_contacts_fts f ON f.rowid = c.id';
      where.push('crm_contacts_fts MATCH @fts');
      args.fts = fts;
    } else {
      where.push('c.search_blob LIKE @like');
      args.like = '%' + text.toLowerCase() + '%';
    }
  }
  if (STATUSES.includes(status)) {
    where.push('c.status = @status');
    args.status = status;
  }
  if (String(kind || '') === 'real') {
    where.push(`c.status NOT IN ('provisional', 'garbage')`);
    where.push(`(
      (c.name IS NOT NULL AND c.name <> '')
      OR (c.email IS NOT NULL AND c.email <> '')
      OR (c.phone IS NOT NULL AND c.phone <> '')
    )`);
  }
  return { from, clause: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

function listContacts({ q = '', status = '', kind = '', limit = 50, offset = 0 } = {}) {
  const { from, clause, args } = searchClause({ q, status, kind });
  args.limit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  args.offset = Math.max(parseInt(offset, 10) || 0, 0);
  try {
    return db
      .prepare(`SELECT c.* FROM ${from} ${clause} ORDER BY c.updated_at DESC LIMIT @limit OFFSET @offset`)
      .all(args);
  } catch (e) {
    // A malformed MATCH must degrade to a working search, never to a 500.
    console.warn('[crm] search fell back to LIKE:', e.message);
    const like = { like: '%' + String(q).trim().toLowerCase() + '%', limit: args.limit, offset: args.offset };
    const st = STATUSES.includes(status) ? 'AND status = @status' : '';
    if (st) like.status = status;
    const real =
      String(kind || '') === 'real'
        ? `AND status NOT IN ('provisional','garbage')
           AND ((name IS NOT NULL AND name <> '') OR (email IS NOT NULL AND email <> '') OR (phone IS NOT NULL AND phone <> ''))`
        : '';
    return db
      .prepare(`SELECT * FROM crm_contacts WHERE search_blob LIKE @like ${st} ${real}
                ORDER BY updated_at DESC LIMIT @limit OFFSET @offset`)
      .all(like);
  }
}

function countContacts({ q = '', status = '', kind = '' } = {}) {
  const { from, clause, args } = searchClause({ q, status, kind });
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${from} ${clause}`).get(args).n;
  } catch (e) {
    return 0;
  }
}

/** Contacts per status — the shape the admin header needs. */
function statusCounts() {
  const rows = db.prepare('SELECT status, COUNT(*) AS n FROM crm_contacts GROUP BY status').all();
  const out = {};
  for (const s of STATUSES) out[s] = 0;
  for (const r of rows) out[r.status] = r.n;
  out.total = rows.reduce((a, r) => a + r.n, 0);
  try {
    out.real = countContacts({ kind: 'real' });
  } catch (e) {
    out.real = 0;
  }
  return out;
}

/**
 * Contacts for one pipeline column (kanban, v2.01).
 * Caps per column so a fat "provisional" pile cannot drown the board.
 */
function listByStatus(status, { limit = 80 } = {}) {
  const st = STATUSES.includes(status) ? status : '';
  if (!st) return [];
  const n = Math.min(Math.max(parseInt(limit, 10) || 80, 1), 200);
  return db
    .prepare(
      `SELECT * FROM crm_contacts WHERE status = ?
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(st, n);
}

/** Bump updated_at — "last interaction" for progressive cards lifecycle. */
function touchActivity(id) {
  const n = Number(id);
  if (!n) return false;
  return db.prepare('UPDATE crm_contacts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(n).changes > 0;
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  statusLabel,
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
  statusCounts,
  listByStatus,
  touchActivity
};
