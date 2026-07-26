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
  { table: 'crm_cs_conversations', column: 'contact_id', label: 'support chats' },
  // WhatsApp (v1.86, phase W1). Same trap as the support chats: the FK is
  // SET NULL and the body column holds the person's own words, so erasure
  // deletes explicitly. NOTE: crm_wa_optins and crm_wa_windows are keyed by
  // PHONE, not contact_id — the drift guard cannot see them, so they are
  // handled by phone in eraseContact below and pinned by their own test.
  { table: 'crm_wa_messages', column: 'contact_id', label: 'whatsapp messages' },
  // v1.99 identity claims — contact_id set only after admin approval; pending
  // rows keyed by email/phone are wiped in eraseContact via eraseForSubject.
  { table: 'crm_identity_claims', column: 'contact_id', label: 'identity claims' },
  // v2.00 sales tasks — CASCADE on contact delete; listed so the drift guard
  // never lets a personal table go untracked.
  { table: 'crm_tasks', column: 'contact_id', label: 'sales tasks' },
  { table: 'crm_sequence_enrollments', column: 'contact_id', label: 'sequence enrollments' },
  { table: 'crm_sequence_sends', column: 'contact_id', label: 'sequence sends' }
];

/** Phone-keyed WhatsApp tables — reached through the contact's phone. */
const WA_PHONE_TABLES = ['crm_wa_optins', 'crm_wa_windows', 'crm_wa_messages'];

/** The contact's phone in wa-id form, for phone-keyed lookups. */
function waIdFor(contact) {
  try {
    return require('./wa-ledger').normalizeToWaId(contact && contact.phone);
  } catch (e) { return ''; }
}

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

  // WhatsApp rows keyed by phone (the drift guard cannot see these, so they
  // are included explicitly — an export that misses a channel is not "all of it")
  const whatsapp = {};
  const waId = waIdFor(contact);
  if (waId) {
    for (const table of WA_PHONE_TABLES) {
      try {
        const rows = db.prepare(`SELECT * FROM ${table} WHERE phone = ?`).all(waId);
        if (rows.length) whatsapp[table] = rows;
      } catch (e) { /* table may not exist on an older database */ }
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    subject: contact,
    submissions,
    whatsapp,
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

    // WhatsApp: messages by contact_id AND everything by phone — opt-ins and
    // windows have no contact_id, and a message sent before the person became
    // a contact carries the phone only.
    const waId = waIdFor(contact);
    if (waId) {
      for (const table of WA_PHONE_TABLES) {
        try { db.prepare(`DELETE FROM ${table} WHERE phone = ?`).run(waId); }
        catch (e) { /* older database */ }
      }
    }
    try { db.prepare('DELETE FROM crm_wa_messages WHERE contact_id = ?').run(id); }
    catch (e) { /* older database */ }

    // Identity claims (v1.99): FK is SET NULL, and pending claims may only have
    // email/phone with no contact_id yet — wipe both shapes so a forgotten
    // person cannot reappear as an unapproved claim.
    try {
      require('./identity-claims').eraseForSubject({
        contactId: id,
        email: contact.email,
        phone: contact.phone
      });
    } catch (e) { /* older database */ }

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
