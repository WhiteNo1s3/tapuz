'use strict';

/**
 * CRM — mailing lists (v1.77).
 *
 * Explicit membership: a person is on a list because someone put them there.
 * That is the difference from a segment, which is a rule evaluated live.
 * Sending to a list is phase 3 — this module only owns who is on it.
 */

const { db } = require('../db');

function createList(name, description = '') {
  const n = String(name || '').trim().slice(0, 200);
  if (!n) throw new Error('שם רשימה נדרש');
  const info = db
    .prepare('INSERT INTO crm_lists (name, description) VALUES (?, ?)')
    .run(n, String(description || '').slice(0, 500));
  return getList(info.lastInsertRowid);
}

function getList(id) {
  return db.prepare('SELECT * FROM crm_lists WHERE id = ?').get(Number(id)) || null;
}

function deleteList(id) {
  return db.prepare('DELETE FROM crm_lists WHERE id = ?').run(Number(id)).changes > 0;
}

/** Every list with its live member count. */
function listAll() {
  return db
    .prepare(
      `SELECT l.*, (SELECT COUNT(*) FROM crm_list_members m WHERE m.list_id = l.id) AS members
       FROM crm_lists l ORDER BY l.name`
    )
    .all();
}

/** Idempotent — adding twice is not an error, it is a no-op. */
function addMember(listId, contactId) {
  const info = db
    .prepare('INSERT OR IGNORE INTO crm_list_members (list_id, contact_id) VALUES (?, ?)')
    .run(Number(listId), Number(contactId));
  return info.changes > 0;
}

function removeMember(listId, contactId) {
  return db
    .prepare('DELETE FROM crm_list_members WHERE list_id = ? AND contact_id = ?')
    .run(Number(listId), Number(contactId)).changes > 0;
}

/** Add many at once (a segment's result, typically) in ONE transaction. */
function addMembers(listId, contactIds) {
  const stmt = db.prepare('INSERT OR IGNORE INTO crm_list_members (list_id, contact_id) VALUES (?, ?)');
  const run = db.transaction((ids) => {
    let added = 0;
    for (const cid of ids) added += stmt.run(Number(listId), Number(cid)).changes;
    return added;
  });
  return run(Array.isArray(contactIds) ? contactIds : []);
}

function members(listId, { limit = 200 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 2000);
  return db
    .prepare(
      `SELECT c.* FROM crm_contacts c
       JOIN crm_list_members m ON m.contact_id = c.id
       WHERE m.list_id = ? ORDER BY c.updated_at DESC LIMIT ?`
    )
    .all(Number(listId), n);
}

function memberCount(listId) {
  return db.prepare('SELECT COUNT(*) AS n FROM crm_list_members WHERE list_id = ?').get(Number(listId)).n;
}

module.exports = {
  createList, getList, deleteList, listAll,
  addMember, addMembers, removeMember, members, memberCount
};
