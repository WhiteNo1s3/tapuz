'use strict';

/**
 * CRM — data-subject rights (v1.82, phase 5).
 *
 * A CRM is a pile of other people's personal data, and those people are allowed
 * to ask two things: *what do you have on me?* and *delete it*. Both need to be
 * one click for the owner, because a right that takes an afternoon of SQL is a
 * right nobody honours.
 *
 * EXPORT is deliberately exhaustive. It walks every table that can hold a row
 * about this person, so the answer is "all of it" rather than "the bits we
 * remembered to include". If a future phase adds a table keyed on `contact_id`,
 * the test in `smoke-crm-subject.js` fails until it is listed here — the schema
 * itself is what keeps this honest.
 *
 * ERASE is a real delete, not a flag. `ON DELETE CASCADE` already removes the
 * timeline, relations, list memberships, browser links and campaign sends; this
 * module verifies afterwards that nothing survived, and reports what it removed.
 */

const { db } = require('../db');

/**
 * Every table that stores rows ABOUT a contact, and how to reach them.
 * `column` is the foreign key; `via` means the link is indirect.
 */
const PERSONAL_TABLES = [
  { table: 'crm_events', column: 'contact_id', label: 'timeline' },
  { table: 'crm_relations', column: 'from_id', label: 'relations (outgoing)' },
  { table: 'crm_relations', column: 'to_id', label: 'relations (incoming)' },
  { table: 'crm_list_members', column: 'contact_id', label: 'list memberships' },
  { table: 'crm_visitors', column: 'contact_id', label: 'browser links' },
  { table: 'crm_campaign_sends', column: 'contact_id', label: 'campaign sends' },
  // Added in v1.83 — and found by this module's OWN drift guard rather than by
  // remembering. Note the FK is ON DELETE SET NULL, which is right for keeping a
  // support history when a contact record is merged away, but WRONG for an
  // erasure request: nulling the link would leave a transcript full of the
  // person's own words, quite possibly including the address they typed. So the
  // erase path below deletes these rows explicitly instead of relying on the FK.
  { table: 'crm_cs_conversations', column: 'contact_id', label: 'support chats' }
];

function rowsFor(table, column, contactId) {
  try {
    return db.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).all(Number(contactId));
  } catch (e) {
    return [];
  }
}

/**
 * Everything held about one person.
 *
 * @param {number} contactId
 * @returns {object|null} a plain object safe to serialize as the subject's copy
 */
function exportContact(contactId) {
  const contact = db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(Number(contactId));
  if (!contact) return null;

  const related = {};
  for (const spec of PERSONAL_TABLES) {
    const rows = rowsFor(spec.table, spec.column, contact.id);
    if (!rows.length) continue;
    const key = spec.table + ':' + spec.column;
    related[key] = { label: spec.label, count: rows.length, rows };
  }

  // Submissions are the person's OWN words — the most important thing to hand
  // back. Reached through the timeline, which is where the link lives.
  let submissions = [];
  try {
    submissions = db
      .prepare(
        `SELECT s.* FROM form_submissions s
         JOIN crm_events e ON e.ref_id = s.id AND e.type = 'form'
         WHERE e.contact_id = ? ORDER BY s.id`
      )
      .all(contact.id);
  } catch (e) { submissions = []; }

  return {
    exportedAt: new Date().toISOString(),
    subject: contact,
    submissions,
    related,
    note:
      'This file contains everything stored about this person in the CRM. ' +
      'Form submissions are kept in the site inbox and are listed here too.'
  };
}

/**
 * Erase a person and everything about them.
 *
 * The foreign keys cascade; this counts what existed, performs the delete, then
 * VERIFIES nothing remains — a deletion you did not check is a deletion you
 * cannot promise.
 *
 * @param {number} contactId
 * @param {{deleteSubmissions?:boolean}} opts submissions live in the site inbox
 *   and are business records; removing them is a separate, explicit choice.
 * @returns {{ok:boolean, removed:object, leftovers:string[], submissionsDeleted:number}}
 */
function eraseContact(contactId, { deleteSubmissions = false } = {}) {
  const id = Number(contactId);
  const contact = db.prepare('SELECT * FROM crm_contacts WHERE id = ?').get(id);
  if (!contact) return { ok: false, removed: {}, leftovers: [], submissionsDeleted: 0 };

  const removed = {};
  for (const spec of PERSONAL_TABLES) {
    const n = rowsFor(spec.table, spec.column, id).length;
    if (n) removed[spec.table + ':' + spec.column] = n;
  }

  let submissionsDeleted = 0;
  const run = db.transaction(() => {
    // Support chats first, and EXPLICITLY: their FK is ON DELETE SET NULL, so
    // the cascade would leave the transcript behind with the person's own
    // messages in it. An erasure request means the words go too.
    try {
      db.prepare('DELETE FROM crm_cs_conversations WHERE contact_id = ?').run(id);
    } catch (e) { /* table may not exist on an older database */ }

    if (deleteSubmissions) {
      const ids = db
        .prepare("SELECT ref_id AS id FROM crm_events WHERE contact_id = ? AND type = 'form' AND ref_id IS NOT NULL")
        .all(id)
        .map((r) => r.id);
      for (const sid of ids) {
        submissionsDeleted += db.prepare('DELETE FROM form_submissions WHERE id = ?').run(sid).changes;
      }
    }
    // FKs cascade from here
    db.prepare('DELETE FROM crm_contacts WHERE id = ?').run(id);
  });

  // Cascades only fire when foreign keys are enforced — SQLite defaults to OFF
  // per connection, so state this rather than hope for it.
  db.pragma('foreign_keys = ON');
  run();

  // Verify. Anything still pointing at this id is a bug worth surfacing loudly,
  // not a silent orphan sitting in a database that claims to have forgotten.
  const leftovers = [];
  if (db.prepare('SELECT COUNT(*) AS n FROM crm_contacts WHERE id = ?').get(id).n) {
    leftovers.push('crm_contacts');
  }
  for (const spec of PERSONAL_TABLES) {
    if (rowsFor(spec.table, spec.column, id).length) {
      leftovers.push(spec.table + ':' + spec.column);
    }
  }

  return { ok: leftovers.length === 0, removed, leftovers, submissionsDeleted };
}

/**
 * The tables an audit should know about — exported so the test can compare this
 * list against the live schema and fail when a new personal table appears.
 */
function personalTables() {
  return PERSONAL_TABLES.map((s) => s.table);
}

module.exports = { PERSONAL_TABLES, personalTables, exportContact, eraseContact };
