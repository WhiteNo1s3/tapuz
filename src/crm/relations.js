'use strict';

/**
 * CRM — the contact graph (v1.77).
 *
 * Directed edges between people: who referred whom, who works with whom. The
 * direction is kept because "referred_by" is not symmetric, but reads are
 * bidirectional (see Customer#relations) — you always want to see an edge from
 * whichever end you are standing on.
 */

const { db } = require('../db');

const KINDS = ['knows', 'colleague', 'referred_by', 'same_company', 'family', 'other'];

function normalizeKind(k) {
  const v = String(k == null ? '' : k).trim().toLowerCase();
  return KINDS.includes(v) ? v : 'knows';
}

/**
 * Link two people. Idempotent per (from, to, kind); a person cannot relate to
 * themselves.
 * @returns {boolean} true when an edge now exists
 */
function link(fromId, toId, kind = 'knows', note = '') {
  const a = Number(fromId);
  const b = Number(toId);
  if (!a || !b || a === b) return false;
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO crm_relations (from_id, to_id, kind, note)
       VALUES (?, ?, ?, ?)`
    )
    .run(a, b, normalizeKind(kind), String(note || '').slice(0, 300));
  return info.changes > 0;
}

function unlink(id) {
  return db.prepare('DELETE FROM crm_relations WHERE id = ?').run(Number(id)).changes > 0;
}

/** Every edge touching this person, either direction. */
function listFor(contactId) {
  const id = Number(contactId);
  return db
    .prepare('SELECT * FROM crm_relations WHERE from_id = ? OR to_id = ? ORDER BY id DESC')
    .all(id, id);
}

/** Ids of everyone one hop away — the neighbourhood, direction-agnostic. */
function neighbours(contactId) {
  const id = Number(contactId);
  return db
    .prepare(
      `SELECT DISTINCT CASE WHEN from_id = @id THEN to_id ELSE from_id END AS other_id
       FROM crm_relations WHERE from_id = @id OR to_id = @id`
    )
    .all({ id })
    .map((r) => r.other_id);
}

function countAll() {
  return db.prepare('SELECT COUNT(*) AS n FROM crm_relations').get().n;
}

module.exports = { KINDS, link, unlink, listFor, neighbours, countAll };
