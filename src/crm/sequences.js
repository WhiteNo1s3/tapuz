'use strict';

/**
 * Email sequences (v2.03) — multi-step follow-up over the same SMTP + consent
 * rules as campaigns. HubSpot's drip, without the meter.
 *
 * Rules that make this safe to ship:
 *   - Only contacts with consent=1 and a real email enroll / receive.
 *   - provisional / garbage never enroll.
 *   - Unsubscribe (campaign token path + sequence tokens) clears consent and
 *     cancels active enrollments for that person.
 *   - One active enrollment per (sequence, contact).
 *   - Daily process is polite: GAP between sends, daily cap via notify.
 */

const crypto = require('crypto');
const { db } = require('../db');
const contacts = require('./contacts');
const campaigns = require('./campaigns');
const events = require('./events');

const ENROLL_STATUSES = ['active', 'completed', 'cancelled', 'paused'];
const GAP_MS = 400;

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

function nowSql() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function addDays(isoDate, days) {
  const d = new Date((isoDate || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.max(0, parseInt(days, 10) || 0));
  return d.toISOString().slice(0, 10) + ' 09:00:00';
}

function getSequence(id) {
  const row = db.prepare('SELECT * FROM crm_sequences WHERE id = ?').get(Number(id));
  if (!row) return null;
  const steps = db
    .prepare(
      `SELECT * FROM crm_sequence_steps WHERE sequence_id = ? ORDER BY position ASC, id ASC`
    )
    .all(row.id);
  return Object.assign({}, row, { steps, active: !!row.active });
}

function listSequences() {
  return db
    .prepare('SELECT * FROM crm_sequences ORDER BY updated_at DESC, id DESC')
    .all()
    .map((row) => {
      const steps = db
        .prepare('SELECT COUNT(*) AS n FROM crm_sequence_steps WHERE sequence_id = ?')
        .get(row.id).n;
      const activeEnroll = db
        .prepare(
          `SELECT COUNT(*) AS n FROM crm_sequence_enrollments
           WHERE sequence_id = ? AND status = 'active'`
        )
        .get(row.id).n;
      return Object.assign({}, row, {
        active: !!row.active,
        stepCount: steps,
        activeEnrollments: activeEnroll
      });
    });
}

function createSequence(name) {
  const n = String(name || '').trim().slice(0, 200);
  if (!n) throw new Error('שם רצף נדרש');
  const info = db
    .prepare('INSERT INTO crm_sequences (name, active) VALUES (?, 1)')
    .run(n);
  return getSequence(info.lastInsertRowid);
}

function updateSequence(id, { name, active } = {}) {
  const existing = getSequence(id);
  if (!existing) return null;
  const n = name !== undefined ? String(name || '').trim().slice(0, 200) : existing.name;
  const a = active !== undefined ? (active ? 1 : 0) : existing.active ? 1 : 0;
  db.prepare(
    `UPDATE crm_sequences SET name = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(n || existing.name, a, Number(id));
  return getSequence(id);
}

function deleteSequence(id) {
  return db.prepare('DELETE FROM crm_sequences WHERE id = ?').run(Number(id)).changes > 0;
}

function addStep(sequenceId, { delayDays = 0, subject = '', body = '' } = {}) {
  const seq = getSequence(sequenceId);
  if (!seq) return null;
  const pos = seq.steps.length;
  const info = db
    .prepare(
      `INSERT INTO crm_sequence_steps (sequence_id, position, delay_days, subject, body)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      Number(sequenceId),
      pos,
      Math.min(Math.max(parseInt(delayDays, 10) || 0, 0), 365),
      String(subject || '').slice(0, 300),
      String(body || '').slice(0, 50000)
    );
  db.prepare('UPDATE crm_sequences SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    Number(sequenceId)
  );
  return db.prepare('SELECT * FROM crm_sequence_steps WHERE id = ?').get(info.lastInsertRowid);
}

function updateStep(stepId, { delayDays, subject, body } = {}) {
  const step = db.prepare('SELECT * FROM crm_sequence_steps WHERE id = ?').get(Number(stepId));
  if (!step) return null;
  const d =
    delayDays !== undefined
      ? Math.min(Math.max(parseInt(delayDays, 10) || 0, 0), 365)
      : step.delay_days;
  const sub = subject !== undefined ? String(subject || '').slice(0, 300) : step.subject;
  const bod = body !== undefined ? String(body || '').slice(0, 50000) : step.body;
  db.prepare(
    `UPDATE crm_sequence_steps SET delay_days = ?, subject = ?, body = ? WHERE id = ?`
  ).run(d, sub, bod, Number(stepId));
  return db.prepare('SELECT * FROM crm_sequence_steps WHERE id = ?').get(Number(stepId));
}

function deleteStep(stepId) {
  const step = db.prepare('SELECT * FROM crm_sequence_steps WHERE id = ?').get(Number(stepId));
  if (!step) return false;
  db.prepare('DELETE FROM crm_sequence_steps WHERE id = ?').run(Number(stepId));
  // re-pack positions
  const rest = db
    .prepare(
      `SELECT id FROM crm_sequence_steps WHERE sequence_id = ? ORDER BY position ASC, id ASC`
    )
    .all(step.sequence_id);
  const upd = db.prepare('UPDATE crm_sequence_steps SET position = ? WHERE id = ?');
  rest.forEach((r, i) => upd.run(i, r.id));
  return true;
}

function canMailContact(c) {
  if (!c) return false;
  if (c.status === 'provisional' || c.status === 'garbage') return false;
  if (!c.email || !String(c.email).trim()) return false;
  if (!c.consent) return false;
  return true;
}

/**
 * Enroll a contact. Starts at step 0; next_run_at = now + step0.delay_days.
 */
function enroll(sequenceId, contactId) {
  const seq = getSequence(sequenceId);
  if (!seq || !seq.active) return { ok: false, error: 'sequence' };
  if (!seq.steps.length) return { ok: false, error: 'no-steps' };
  const contact = contacts.getContact(contactId);
  if (!canMailContact(contact)) return { ok: false, error: 'ineligible' };

  const existing = db
    .prepare(
      `SELECT * FROM crm_sequence_enrollments
       WHERE sequence_id = ? AND contact_id = ? AND status = 'active'`
    )
    .get(Number(sequenceId), Number(contactId));
  if (existing) return { ok: false, error: 'already', enrollment: existing };

  const firstDelay = seq.steps[0].delay_days || 0;
  const nextRun = addDays(new Date().toISOString().slice(0, 10), firstDelay);
  const info = db
    .prepare(
      `INSERT INTO crm_sequence_enrollments
         (sequence_id, contact_id, status, step_index, next_run_at)
       VALUES (?, ?, 'active', 0, ?)`
    )
    .run(Number(sequenceId), Number(contactId), nextRun);

  try {
    events.record({
      contactId: Number(contactId),
      type: 'email',
      title: 'נרשם לרצף: ' + seq.name
    });
  } catch (e) { /* */ }

  return {
    ok: true,
    enrollment: db
      .prepare('SELECT * FROM crm_sequence_enrollments WHERE id = ?')
      .get(info.lastInsertRowid)
  };
}

function cancelEnrollment(id, reason = 'cancelled') {
  const row = db.prepare('SELECT * FROM crm_sequence_enrollments WHERE id = ?').get(Number(id));
  if (!row || row.status !== 'active') return { ok: false };
  db.prepare(
    `UPDATE crm_sequence_enrollments
     SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(reason === 'completed' ? 'completed' : 'cancelled', Number(id));
  return { ok: true };
}

function cancelActiveForContact(contactId) {
  return db
    .prepare(
      `UPDATE crm_sequence_enrollments
       SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
       WHERE contact_id = ? AND status = 'active'`
    )
    .run(Number(contactId)).changes;
}

function listEnrollments(sequenceId, { limit = 100 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  return db
    .prepare(
      `SELECT e.*, c.name AS contact_name, c.email AS contact_email
       FROM crm_sequence_enrollments e
       JOIN crm_contacts c ON c.id = e.contact_id
       WHERE e.sequence_id = ?
       ORDER BY e.enrolled_at DESC LIMIT ?`
    )
    .all(Number(sequenceId), n);
}

function listActiveForContact(contactId) {
  return db
    .prepare(
      `SELECT e.*, s.name AS sequence_name
       FROM crm_sequence_enrollments e
       JOIN crm_sequences s ON s.id = e.sequence_id
       WHERE e.contact_id = ? AND e.status = 'active'
       ORDER BY e.enrolled_at DESC`
    )
    .all(Number(contactId));
}

function findSendByToken(token) {
  const t = String(token || '');
  if (!/^[a-f0-9]{32}$/.test(t)) return null;
  return db.prepare('SELECT * FROM crm_sequence_sends WHERE token = ?').get(t) || null;
}

function recordOpen(token) {
  const send = findSendByToken(token);
  if (!send) return false;
  if (!send.opened_at) {
    db.prepare('UPDATE crm_sequence_sends SET opened_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      send.id
    );
  }
  return true;
}

/**
 * Process due enrollments. Safe to call often; never throws.
 * @returns {Promise<{processed:number, sent:number, failed:number, skipped:number}>}
 */
async function processDue({ limit = 50, sender, baseUrl } = {}) {
  const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  let notify;
  try {
    notify = require('../notify');
    if (!sender && !notify.isSmtpReady()) {
      return Object.assign(stats, { error: 'smtp not ready' });
    }
  } catch (e) {
    return Object.assign(stats, { error: 'notify missing' });
  }

  const due = db
    .prepare(
      `SELECT * FROM crm_sequence_enrollments
       WHERE status = 'active'
         AND next_run_at IS NOT NULL
         AND next_run_at <= datetime('now')
       ORDER BY next_run_at ASC
       LIMIT ?`
    )
    .all(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200));

  const sendFn = sender || ((msg) => notify.sendMail(msg));
  let siteBase = baseUrl;
  if (!siteBase) {
    try {
      siteBase = String(require('../config').loadConfig().baseUrl || '').trim();
    } catch (e) {
      siteBase = '';
    }
  }

  for (const en of due) {
    stats.processed++;
    const seq = getSequence(en.sequence_id);
    if (!seq || !seq.active || !seq.steps.length) {
      cancelEnrollment(en.id);
      stats.skipped++;
      continue;
    }
    const contact = contacts.getContact(en.contact_id);
    if (!canMailContact(contact)) {
      cancelEnrollment(en.id);
      stats.skipped++;
      continue;
    }

    const step = seq.steps[en.step_index];
    if (!step) {
      cancelEnrollment(en.id, 'completed');
      stats.skipped++;
      continue;
    }

    if (!step.subject.trim() || !step.body.trim()) {
      // skip empty step, advance
      advanceEnrollment(en, seq);
      stats.skipped++;
      continue;
    }

    // daily cap
    try {
      if (!sender && notify.remainingToday() < 1) {
        stats.skipped++;
        break; // stop batch; try tomorrow
      }
    } catch (e) { /* */ }

    const token = newToken();
    const links = campaigns.extractLinks(step.body);
    const { html, unsubscribeUrl } = campaigns.renderBody({
      body: step.body,
      links,
      token,
      baseUrl: siteBase,
      contact
    });

    const ins = db
      .prepare(
        `INSERT INTO crm_sequence_sends
           (enrollment_id, step_id, contact_id, token, status)
         VALUES (?, ?, ?, ?, 'queued')`
      )
      .run(en.id, step.id, contact.id, token);

    let result;
    try {
      result = await sendFn({
        to: contact.email,
        subject: step.subject,
        html,
        headers: {
          'List-Unsubscribe': '<' + unsubscribeUrl + '>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      });
    } catch (e) {
      result = { ok: false, error: e.message };
    }

    if (result && result.ok) {
      db.prepare(
        `UPDATE crm_sequence_sends SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(ins.lastInsertRowid);
      try {
        events.record({
          contactId: contact.id,
          type: 'email',
          title: step.subject + ' (רצף: ' + seq.name + ')'
        });
      } catch (e) { /* */ }
      advanceEnrollment(en, seq);
      stats.sent++;
    } else {
      db.prepare(
        `UPDATE crm_sequence_sends SET status = 'failed', error = ? WHERE id = ?`
      ).run(String((result && result.error) || 'unknown').slice(0, 300), ins.lastInsertRowid);
      // leave enrollment active — retry next process cycle
      db.prepare(
        `UPDATE crm_sequence_enrollments SET next_run_at = datetime('now', '+1 day') WHERE id = ?`
      ).run(en.id);
      stats.failed++;
    }

    if (GAP_MS) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  return stats;
}

function advanceEnrollment(en, seq) {
  const nextIndex = en.step_index + 1;
  if (nextIndex >= seq.steps.length) {
    db.prepare(
      `UPDATE crm_sequence_enrollments
       SET status = 'completed', step_index = ?, completed_at = CURRENT_TIMESTAMP,
           next_run_at = NULL
       WHERE id = ?`
    ).run(nextIndex, en.id);
    return;
  }
  const nextStep = seq.steps[nextIndex];
  const delay = nextStep.delay_days || 0;
  const nextRun = addDays(new Date().toISOString().slice(0, 10), delay);
  db.prepare(
    `UPDATE crm_sequence_enrollments
     SET step_index = ?, next_run_at = ? WHERE id = ?`
  ).run(nextIndex, nextRun, en.id);
}

/** Housekeeping — never throws. */
function maybeProcessDaily() {
  try {
    processDue({ limit: 40 }).then((s) => {
      if (s.sent || s.failed) {
        console.log(
          '[crm] sequences: sent=' + s.sent + ' failed=' + s.failed + ' skipped=' + s.skipped
        );
      }
    }).catch((e) => console.error('[crm] sequences process:', e.message));
  } catch (e) {
    console.error('[crm] sequences:', e.message);
  }
}

module.exports = {
  getSequence,
  listSequences,
  createSequence,
  updateSequence,
  deleteSequence,
  addStep,
  updateStep,
  deleteStep,
  enroll,
  cancelEnrollment,
  cancelActiveForContact,
  listEnrollments,
  listActiveForContact,
  processDue,
  maybeProcessDaily,
  findSendByToken,
  recordOpen,
  canMailContact,
  ENROLL_STATUSES
};
