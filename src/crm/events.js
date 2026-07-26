'use strict';

/**
 * CRM — the timeline (v1.77).
 *
 * One row per typed thing a person did. `ref_id` points into whichever table
 * owns the detail (a `form_submissions.id` today), so the timeline stays thin
 * and never duplicates the record it refers to.
 */

const { db } = require('../db');

// The vocabulary. A closed set keeps the timeline groupable and the admin
// filters honest; anything unknown is stored as 'other' rather than silently
// inventing a new type nobody can filter on.
const TYPES = ['form', 'pageview', 'note', 'status', 'email', 'chat', 'other', 'deal'];

function normalizeType(t) {
  const v = String(t == null ? '' : t).trim().toLowerCase();
  return TYPES.includes(v) ? v : 'other';
}

/**
 * Record one event.
 * @param {{contactId?:number, type:string, path?:string, title?:string, refId?:number, meta?:object}} e
 */
function record(e = {}) {
  const row = {
    contact_id: e.contactId != null ? Number(e.contactId) : null,
    type: normalizeType(e.type),
    path: String(e.path || '').slice(0, 300),
    title: String(e.title || '').slice(0, 300),
    ref_id: e.refId != null ? Number(e.refId) : null,
    meta: e.meta ? JSON.stringify(e.meta).slice(0, 4000) : null
  };
  const info = db
    .prepare(
      `INSERT INTO crm_events (contact_id, type, path, title, ref_id, meta)
       VALUES (@contact_id, @type, @path, @title, @ref_id, @meta)`
    )
    .run(row);
  return info.lastInsertRowid;
}

function parseMeta(row) {
  if (!row) return row;
  let meta = null;
  if (row.meta) {
    try { meta = JSON.parse(row.meta); } catch (e) { meta = null; }
  }
  return Object.assign({}, row, { meta });
}

/** A person's timeline, newest first. */
function listForContact(contactId, { limit = 50 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  return db
    .prepare('SELECT * FROM crm_events WHERE contact_id = ? ORDER BY id DESC LIMIT ?')
    .all(Number(contactId), n)
    .map(parseMeta);
}

/** Site-wide recent activity, optionally narrowed to one type. */
function listRecent({ type = '', limit = 50 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  if (type && TYPES.includes(type)) {
    return db
      .prepare('SELECT * FROM crm_events WHERE type = ? ORDER BY id DESC LIMIT ?')
      .all(type, n)
      .map(parseMeta);
  }
  return db.prepare('SELECT * FROM crm_events ORDER BY id DESC LIMIT ?').all(n).map(parseMeta);
}

function countForContact(contactId) {
  return db.prepare('SELECT COUNT(*) AS n FROM crm_events WHERE contact_id = ?').get(Number(contactId)).n;
}

/**
 * Retention (phase 5, available from day one so the table can never be the
 * reason someone's disk fills). Deletes events older than `days`, keeping
 * every event that anchors a record elsewhere (`ref_id`).
 */
function pruneOlderThan(days) {
  const d = Math.max(parseInt(days, 10) || 0, 1);
  const info = db
    .prepare(`DELETE FROM crm_events WHERE ref_id IS NULL AND created_at < datetime('now', ?)`)
    .run('-' + d + ' days');
  return info.changes;
}

module.exports = { TYPES, record, listForContact, listRecent, countForContact, pruneOlderThan };
