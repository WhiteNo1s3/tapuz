'use strict';

/**
 * CRM — the timeline (v1.77, open vocabulary v2.12).
 *
 * One row per typed thing a person did. `ref_id` points into whichever table
 * owns the detail (a `form_submissions.id` today), so the timeline stays thin
 * and never duplicates the record it refers to.
 *
 * Core types stay documented for filters. Verticals may register more, or use
 * a namespaced slug (`restaurant.order`) without forking this file — expand,
 * not a closed script.
 */

const { db } = require('../db');
const hooks = require('./hooks');

// Core vocabulary — always present for admin filters / labels.
const CORE_TYPES = ['form', 'pageview', 'note', 'status', 'email', 'chat', 'other', 'deal', 'portal', 'attr'];
const extraTypes = new Set(); // registered by verticals
// Live list for admin / exports (CORE + extras)
const TYPES = CORE_TYPES.slice();

const TYPE_RE = /^[a-z][a-z0-9_.-]{0,39}$/;

function registerType(type, { label } = {}) {
  const v = String(type || '')
    .trim()
    .toLowerCase();
  if (!TYPE_RE.test(v)) return false;
  if (!TYPES.includes(v)) {
    TYPES.push(v);
    extraTypes.add(v);
  }
  if (label) typeLabels[v] = String(label).slice(0, 80);
  return true;
}

const typeLabels = {
  form: 'טופס',
  pageview: 'צפייה',
  note: 'הערה',
  status: 'סטטוס',
  email: 'מייל',
  chat: 'צ׳אט',
  other: 'אחר',
  deal: 'עסקה',
  portal: 'אזור אישי',
  attr: 'מאפיין'
};

function typeLabel(t) {
  const v = normalizeType(t);
  return typeLabels[v] || v;
}

function normalizeType(t) {
  const v = String(t == null ? '' : t)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .slice(0, 40);
  if (!v) return 'other';
  if (TYPES.includes(v)) return v;
  // Open path: well-formed namespaced slug is accepted and remembered.
  if (TYPE_RE.test(v) && (v.includes('.') || extraTypes.has(v))) {
    if (!TYPES.includes(v)) {
      TYPES.push(v);
      extraTypes.add(v);
    }
    return v;
  }
  if (TYPE_RE.test(v) && !CORE_TYPES.includes(v) && v !== 'other') {
    // bare custom token — accept as open expansion
    if (!TYPES.includes(v)) {
      TYPES.push(v);
      extraTypes.add(v);
    }
    return v;
  }
  return 'other';
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
  const id = info.lastInsertRowid;
  hooks.emit('event.recorded', {
    id,
    contactId: row.contact_id,
    type: row.type,
    title: row.title,
    path: row.path,
    refId: row.ref_id
  });
  return id;
}

function parseMeta(row) {
  if (!row) return row;
  let meta = null;
  if (row.meta) {
    try {
      meta = JSON.parse(row.meta);
    } catch (e) {
      meta = null;
    }
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
  const t = type ? normalizeType(type) : '';
  if (t && t !== 'other') {
    return db
      .prepare('SELECT * FROM crm_events WHERE type = ? ORDER BY id DESC LIMIT ?')
      .all(t, n)
      .map(parseMeta);
  }
  return db.prepare('SELECT * FROM crm_events ORDER BY id DESC LIMIT ?').all(n).map(parseMeta);
}

function countForContact(contactId) {
  return db.prepare('SELECT COUNT(*) AS n FROM crm_events WHERE contact_id = ?').get(Number(contactId))
    .n;
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

module.exports = {
  TYPES,
  CORE_TYPES,
  registerType,
  normalizeType,
  typeLabel,
  record,
  listForContact,
  listRecent,
  countForContact,
  pruneOlderThan
};
