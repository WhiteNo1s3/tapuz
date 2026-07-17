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
 * Excel-proofed: UTF-8 BOM (Hebrew), CRLF, all values quoted, and cells that
 * start with =/+/-/@ get a leading ' so a hostile submission can never become
 * a formula on the site owner's machine (CSV injection).
 */
const BOM = String.fromCharCode(0xfeff); // Excel needs it to read Hebrew as UTF-8

function toCsv(items) {
  const fieldCols = [];
  for (const s of items) {
    for (const k of Object.keys(s.fields)) {
      if (!fieldCols.includes(k)) fieldCols.push(k);
    }
  }
  const cell = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ['id', 'created_at', 'page', 'read', ...fieldCols];
  const lines = [head.map(cell).join(',')];
  for (const s of items) {
    lines.push([
      s.id,
      s.created_at || '',
      s.page || '',
      s.is_read ? 1 : 0,
      ...fieldCols.map((k) => (k in s.fields ? s.fields[k] : ''))
    ].map(cell).join(','));
  }
  return BOM + lines.join('\r\n') + '\r\n';
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
  toCsv
};
