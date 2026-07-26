'use strict';

/**
 * CRM tasks (v2.00) — the sales "next action" loop.
 *
 * HubSpot wins when a lead arrives and the owner never forgets what to do
 * next. We already capture people (cards), interests, segments, mail. Tasks
 * close the human loop: call / email / follow-up with a due date, on the
 * contact — not a silent tracker.
 *
 * Only OPEN tasks on reachable people matter for the due board; provisional
 * ghosts are not a to-do list.
 */

const { db } = require('../db');
const contacts = require('./contacts');
const events = require('./events');

const KINDS = ['call', 'email', 'followup', 'meeting', 'other'];
const KIND_LABELS = {
  call: 'שיחה',
  email: 'מייל',
  followup: 'מעקב',
  meeting: 'פגישה',
  other: 'אחר'
};

const STATUSES = ['open', 'done', 'cancelled'];
const STATUS_LABELS = {
  open: 'פתוח',
  done: 'בוצע',
  cancelled: 'בוטל'
};

function kindLabel(k) {
  return KIND_LABELS[k] || String(k || '');
}
function statusLabel(s) {
  return STATUS_LABELS[s] || String(s || '');
}

function normalizeKind(k) {
  const v = String(k || 'followup').toLowerCase();
  return KINDS.includes(v) ? v : 'followup';
}

function normalizeDue(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // basic calendar sanity
  const d = new Date(s + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function getTask(id) {
  return db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(Number(id)) || null;
}

/**
 * @param {{contactId:number, title:string, kind?:string, dueAt?:string, notes?:string}} input
 */
function createTask(input = {}) {
  const contactId = Number(input.contactId);
  if (!contactId || !contacts.getContact(contactId)) {
    return { ok: false, error: 'contact' };
  }
  const title = String(input.title || '').trim().slice(0, 300);
  if (!title) return { ok: false, error: 'title' };
  const kind = normalizeKind(input.kind);
  const dueAt = normalizeDue(input.dueAt);
  // dueAt required? HubSpot allows undated — we allow null
  const notes = String(input.notes || '').trim().slice(0, 2000);
  const info = db
    .prepare(
      `INSERT INTO crm_tasks (contact_id, title, kind, due_at, status, notes)
       VALUES (?, ?, ?, ?, 'open', ?)`
    )
    .run(contactId, title, kind, dueAt, notes);
  const task = getTask(info.lastInsertRowid);
  try {
    events.record({
      contactId,
      type: 'note',
      title: 'משימה: ' + title + (dueAt ? ' (עד ' + dueAt + ')' : '')
    });
  } catch (e) { /* timeline nicety */ }
  try {
    contacts.touchActivity(contactId);
  } catch (e) { /* */ }
  return { ok: true, task };
}

function listForContact(contactId, { includeDone = false, limit = 50 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const id = Number(contactId);
  if (includeDone) {
    return db
      .prepare(
        `SELECT * FROM crm_tasks WHERE contact_id = ?
         ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
                  due_at IS NULL, due_at ASC, id DESC
         LIMIT ?`
      )
      .all(id, n);
  }
  return db
    .prepare(
      `SELECT * FROM crm_tasks WHERE contact_id = ? AND status = 'open'
       ORDER BY due_at IS NULL, due_at ASC, id DESC LIMIT ?`
    )
    .all(id, n);
}

/**
 * Open tasks due on or before `asOf` (default today), soonest first.
 * Joins contact display fields for the board.
 */
function listDue({ asOf, limit = 100 } = {}) {
  const day = normalizeDue(asOf) || todayUTC();
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  return db
    .prepare(
      `SELECT t.*, c.name AS contact_name, c.email AS contact_email,
              c.phone AS contact_phone, c.status AS contact_status
       FROM crm_tasks t
       JOIN crm_contacts c ON c.id = t.contact_id
       WHERE t.status = 'open'
         AND t.due_at IS NOT NULL
         AND t.due_at <= ?
         AND c.status NOT IN ('garbage')
       ORDER BY t.due_at ASC, t.id ASC
       LIMIT ?`
    )
    .all(day, n);
}

/** Open tasks with no due date — the "someday" pile. */
function listUndated({ limit = 50 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  return db
    .prepare(
      `SELECT t.*, c.name AS contact_name, c.email AS contact_email,
              c.phone AS contact_phone, c.status AS contact_status
       FROM crm_tasks t
       JOIN crm_contacts c ON c.id = t.contact_id
       WHERE t.status = 'open' AND (t.due_at IS NULL OR t.due_at = '')
         AND c.status NOT IN ('garbage')
       ORDER BY t.id DESC
       LIMIT ?`
    )
    .all(n);
}

/** Upcoming open tasks after today (next N days). */
function listUpcoming({ days = 7, limit = 50 } = {}) {
  const d = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const today = todayUTC();
  const end = new Date(today + 'T12:00:00Z');
  end.setUTCDate(end.getUTCDate() + d);
  const until = end.toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT t.*, c.name AS contact_name, c.email AS contact_email,
              c.phone AS contact_phone, c.status AS contact_status
       FROM crm_tasks t
       JOIN crm_contacts c ON c.id = t.contact_id
       WHERE t.status = 'open'
         AND t.due_at IS NOT NULL
         AND t.due_at > ?
         AND t.due_at <= ?
         AND c.status NOT IN ('garbage')
       ORDER BY t.due_at ASC, t.id ASC
       LIMIT ?`
    )
    .all(today, until, n);
}

function completeTask(id) {
  const task = getTask(id);
  if (!task || task.status !== 'open') return { ok: false, error: 'missing' };
  db.prepare(
    `UPDATE crm_tasks SET status = 'done', completed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(Number(id));
  try {
    events.record({
      contactId: task.contact_id,
      type: 'note',
      title: 'משימה בוצעה: ' + task.title
    });
    contacts.touchActivity(task.contact_id);
  } catch (e) { /* */ }
  return { ok: true, task: getTask(id) };
}

function cancelTask(id) {
  const task = getTask(id);
  if (!task || task.status !== 'open') return { ok: false, error: 'missing' };
  db.prepare(
    `UPDATE crm_tasks SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(Number(id));
  return { ok: true, task: getTask(id) };
}

function reopenTask(id) {
  const task = getTask(id);
  if (!task || task.status === 'open') return { ok: false, error: 'missing' };
  db.prepare(
    `UPDATE crm_tasks SET status = 'open', completed_at = NULL WHERE id = ?`
  ).run(Number(id));
  return { ok: true, task: getTask(id) };
}

function counts() {
  const today = todayUTC();
  const open = db.prepare(`SELECT COUNT(*) AS n FROM crm_tasks WHERE status = 'open'`).get().n;
  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS n FROM crm_tasks
       WHERE status = 'open' AND due_at IS NOT NULL AND due_at < ?`
    )
    .get(today).n;
  const dueToday = db
    .prepare(
      `SELECT COUNT(*) AS n FROM crm_tasks
       WHERE status = 'open' AND due_at = ?`
    )
    .get(today).n;
  const undated = db
    .prepare(
      `SELECT COUNT(*) AS n FROM crm_tasks
       WHERE status = 'open' AND (due_at IS NULL OR due_at = '')`
    )
    .get().n;
  return { open, overdue, dueToday, undated, today };
}

module.exports = {
  KINDS,
  KIND_LABELS,
  STATUSES,
  STATUS_LABELS,
  kindLabel,
  statusLabel,
  normalizeKind,
  normalizeDue,
  todayUTC,
  getTask,
  createTask,
  listForContact,
  listDue,
  listUndated,
  listUpcoming,
  completeTask,
  cancelTask,
  reopenTask,
  counts
};
