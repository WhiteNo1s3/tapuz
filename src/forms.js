'use strict';

/**
 * Forms inbox (v0.81) — the stomach for the FORM module's mouth.
 *
 * Until now a published form POSTed into the void (empty action = the page's
 * own static URL = nothing). Now: empty action defaults to /api/form, the
 * server stores the submission, and the admin reads it in תיבת פניות.
 *
 * Privacy-lean by design: fields + source page + timestamp. No IP, no
 * user-agent, no cookies — an SMB contact box, not a tracker.
 */

const { db } = require('./db');

// spam/abuse caps — a contact form, not a file upload
const MAX_FIELDS = 40;
const MAX_VALUE_LEN = 4000;
const MAX_TOTAL_LEN = 20000;
const MAX_KEY_LEN = 120;
const MAX_NOTES_LEN = 4000;

// ─── Lead pipeline (v1.00) — a submission graduates into a worked lead ───
// Deliberately small: five stages cover an SMB flow without inventing a full
// deal-stage/kanban system nobody asked for. `new` is the DB default
// (src/db.js), so every existing submission from before this version reads
// as 'new' with zero migration surprises.
const STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
const STATUS_LABELS = {
  new: 'חדש', contacted: 'נוצר קשר', qualified: 'מוסמך', won: 'נסגר בהצלחה', lost: 'לא רלוונטי'
};

/**
 * @param {{ page?: string, fields: Record<string, unknown> }} input
 * @returns {{ ok: true, id: number } | { ok: false, error: string }}
 */
function saveSubmission(input = {}) {
  const raw = input.fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'no fields' };
  }

  const fields = {};
  let total = 0;
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_')) continue; // internal (_hp honeypot, _page)
    if (++count > MAX_FIELDS) return { ok: false, error: 'too many fields' };
    const k = String(key).slice(0, MAX_KEY_LEN);
    // multi-selects arrive as arrays — join, don't drop
    const v = (Array.isArray(value) ? value.join(', ') : String(value == null ? '' : value))
      .slice(0, MAX_VALUE_LEN);
    total += k.length + v.length;
    if (total > MAX_TOTAL_LEN) return { ok: false, error: 'submission too large' };
    fields[k] = v;
  }
  if (!Object.keys(fields).length) return { ok: false, error: 'empty submission' };

  const page = String(input.page || '').slice(0, 300);
  const info = db
    .prepare('INSERT INTO form_submissions (page, fields) VALUES (?, ?)')
    .run(page, JSON.stringify(fields));
  return { ok: true, id: Number(info.lastInsertRowid) };
}

/** Newest first. Each row: {id, page, fields(object), is_read, created_at}. */
function listSubmissions({ limit = 100, offset = 0 } = {}) {
  return db
    .prepare('SELECT * FROM form_submissions ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(Math.min(Math.max(1, limit), 500), Math.max(0, offset))
    .map(hydrate);
}

function getSubmission(id) {
  const row = db.prepare('SELECT * FROM form_submissions WHERE id = ?').get(id);
  return row ? hydrate(row) : null;
}

function markRead(id, read = true) {
  return db
    .prepare('UPDATE form_submissions SET is_read = ? WHERE id = ?')
    .run(read ? 1 : 0, id).changes > 0;
}

/** @returns {boolean} false on an unrecognized status (no partial write) or a missing id. */
function setStatus(id, status) {
  if (!STATUSES.includes(status)) return false;
  return db.prepare('UPDATE form_submissions SET status = ? WHERE id = ?').run(status, id).changes > 0;
}

function setNotes(id, notes) {
  const text = String(notes == null ? '' : notes).slice(0, MAX_NOTES_LEN);
  return db.prepare('UPDATE form_submissions SET notes = ? WHERE id = ?').run(text, id).changes > 0;
}

// ─── Deal value + follow-up date (v1.12) — the rest of "advanced CRM
// pipeline": most leads never get either set (a contact-form enquiry isn't
// automatically a sized deal), so both are nullable and clearing is a
// first-class action, not just "set to 0/empty string".

const MAX_LEAD_VALUE = 1e12; // sanity cap against garbage/overflow, not a real business limit

/** @returns {boolean} false on invalid input (negative/non-finite/too large), true on set OR clear. */
function setValue(id, value) {
  if (value === null || value === '' || value === undefined) {
    return db.prepare('UPDATE form_submissions SET value = NULL WHERE id = ?').run(id).changes > 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_LEAD_VALUE) return false;
  return db.prepare('UPDATE form_submissions SET value = ? WHERE id = ?').run(n, id).changes > 0;
}

/** date: 'YYYY-MM-DD' or null/'' to clear. @returns {boolean} false on a malformed date string. */
function setFollowUp(id, date) {
  if (date === null || date === '' || date === undefined) {
    return db.prepare('UPDATE form_submissions SET follow_up_at = NULL WHERE id = ?').run(id).changes > 0;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return false;
  return db.prepare('UPDATE form_submissions SET follow_up_at = ? WHERE id = ?').run(String(date), id).changes > 0;
}

/** Leads due for a follow-up today or earlier, excluding closed ones (won/lost). */
function listDueFollowUps() {
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare(
    `SELECT * FROM form_submissions WHERE follow_up_at IS NOT NULL AND follow_up_at <= ? AND status NOT IN ('won','lost') ORDER BY follow_up_at ASC`
  ).all(today).map(hydrate);
}

/** Pipeline totals by status: lead count + summed deal value (nulls treated as 0). */
function pipelineSummary() {
  const rows = db.prepare('SELECT status, value FROM form_submissions').all();
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = { count: 0, value: 0 };
  for (const r of rows) {
    const s = STATUSES.includes(r.status) ? r.status : 'new';
    byStatus[s].count++;
    if (r.value != null) byStatus[s].value += r.value;
  }
  return byStatus;
}

function deleteSubmission(id) {
  return db.prepare('DELETE FROM form_submissions WHERE id = ?').run(id).changes > 0;
}

function unreadCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM form_submissions WHERE is_read = 0').get().c;
}

/** Every submission, newest first — the export path (no page cap). */
function allSubmissions() {
  return db.prepare('SELECT * FROM form_submissions ORDER BY id DESC').all().map(hydrate);
}

/**
 * CSV export (v0.87) — the inbox as a spreadsheet, the SMB lead workflow.
 * Columns: fixed head + the union of field names in first-seen order, so
 * different forms on different pages land in one coherent sheet.
 * Escaping/BOM/formula-guard live in src/csv.js (shared with analytics).
 */
function toCsv(items) {
  const { csvTable } = require('./csv');
  const fieldCols = [];
  for (const s of items) {
    for (const k of Object.keys(s.fields)) {
      if (!fieldCols.includes(k)) fieldCols.push(k);
    }
  }
  const head = ['id', 'created_at', 'page', 'read', 'status', 'notes', 'value', 'follow_up_at', ...fieldCols];
  const rows = items.map((s) => [
    s.id,
    s.created_at || '',
    s.page || '',
    s.is_read ? 1 : 0,
    s.status || 'new',
    s.notes || '',
    s.value != null ? s.value : '',
    s.follow_up_at || '',
    ...fieldCols.map((k) => (k in s.fields ? s.fields[k] : ''))
  ]);
  return csvTable(head, rows);
}

function hydrate(row) {
  let fields = {};
  try { fields = JSON.parse(row.fields || '{}'); } catch (e) {}
  return { ...row, fields };
}

module.exports = {
  saveSubmission,
  listSubmissions,
  allSubmissions,
  getSubmission,
  markRead,
  deleteSubmission,
  unreadCount,
  toCsv,
  // lead pipeline (v1.00)
  STATUSES,
  STATUS_LABELS,
  setStatus,
  setNotes,
  // deal value + follow-up (v1.12)
  setValue,
  setFollowUp,
  listDueFollowUps,
  pipelineSummary
};
