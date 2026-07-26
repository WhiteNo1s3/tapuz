'use strict';

/**
 * CRM deals (v2.09) — opportunity hanging off a contact and/or company.
 * Stages are a closed set so the board stays honest.
 */

const { db } = require('../db');
const contacts = require('./contacts');

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const STAGE_LABELS = {
  lead: 'ליד',
  qualified: 'מוכשר',
  proposal: 'הצעה',
  negotiation: 'משא ומתן',
  won: 'נסגר — זכייה',
  lost: 'נסגר — הפסד'
};

function stageLabel(s) {
  return STAGE_LABELS[s] || String(s || '');
}

function normalizeStage(s) {
  const v = String(s || 'lead').toLowerCase();
  return STAGES.includes(v) ? v : 'lead';
}

function normalizeAmount(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normalizeDate(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function getDeal(id) {
  return db.prepare('SELECT * FROM crm_deals WHERE id = ?').get(Number(id)) || null;
}

function listDeals({ stage = '', contactId, companyId, limit = 100 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const where = [];
  const args = {};
  if (STAGES.includes(stage)) {
    where.push('stage = @stage');
    args.stage = stage;
  }
  if (contactId != null) {
    where.push('contact_id = @contactId');
    args.contactId = Number(contactId);
  }
  if (companyId != null) {
    where.push('company_id = @companyId');
    args.companyId = Number(companyId);
  }
  args.limit = n;
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db
    .prepare(
      `SELECT d.*,
              c.name AS contact_name, c.email AS contact_email,
              co.name AS company_name
       FROM crm_deals d
       LEFT JOIN crm_contacts c ON c.id = d.contact_id
       LEFT JOIN crm_companies co ON co.id = d.company_id
       ${clause}
       ORDER BY
         CASE d.stage
           WHEN 'won' THEN 2 WHEN 'lost' THEN 3 ELSE 0 END,
         d.expected_close IS NULL, d.expected_close ASC, d.updated_at DESC
       LIMIT @limit`
    )
    .all(args);
}

function createDeal({
  title, contactId, companyId, amount, currency, stage, expectedClose, notes
} = {}) {
  const t = String(title || '').trim().slice(0, 300);
  if (!t) throw new Error('שם עסקה נדרש');
  const cid = contactId ? Number(contactId) : null;
  const coId = companyId ? Number(companyId) : null;
  if (cid && !contacts.getContact(cid)) throw new Error('איש קשר לא נמצא');
  if (coId) {
    const co = db.prepare('SELECT id FROM crm_companies WHERE id = ?').get(coId);
    if (!co) throw new Error('חברה לא נמצאה');
  }
  if (!cid && !coId) throw new Error('עסקה צריכה איש קשר או חברה');

  const info = db
    .prepare(
      `INSERT INTO crm_deals
         (title, contact_id, company_id, amount, currency, stage, expected_close, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      t,
      cid,
      coId,
      normalizeAmount(amount),
      String(currency || 'ILS').slice(0, 8) || 'ILS',
      normalizeStage(stage),
      normalizeDate(expectedClose),
      String(notes || '').trim().slice(0, 4000)
    );
  return getDeal(info.lastInsertRowid);
}

function updateDeal(id, patch = {}) {
  const existing = getDeal(id);
  if (!existing) return null;
  const title =
    patch.title !== undefined ? String(patch.title || '').trim().slice(0, 300) : existing.title;
  if (!title) return null;
  db.prepare(
    `UPDATE crm_deals SET
       title = ?, contact_id = ?, company_id = ?, amount = ?, currency = ?,
       stage = ?, expected_close = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    title,
    patch.contactId !== undefined
      ? (patch.contactId ? Number(patch.contactId) : null)
      : existing.contact_id,
    patch.companyId !== undefined
      ? (patch.companyId ? Number(patch.companyId) : null)
      : existing.company_id,
    patch.amount !== undefined ? normalizeAmount(patch.amount) : existing.amount,
    patch.currency !== undefined
      ? String(patch.currency || 'ILS').slice(0, 8)
      : existing.currency,
    patch.stage !== undefined ? normalizeStage(patch.stage) : existing.stage,
    patch.expectedClose !== undefined
      ? normalizeDate(patch.expectedClose)
      : existing.expected_close,
    patch.notes !== undefined
      ? String(patch.notes || '').trim().slice(0, 4000)
      : existing.notes,
    Number(id)
  );
  return getDeal(id);
}

function deleteDeal(id) {
  return db.prepare('DELETE FROM crm_deals WHERE id = ?').run(Number(id)).changes > 0;
}

function dealsForContact(contactId) {
  return listDeals({ contactId, limit: 50 });
}

function pipelineSummary() {
  const rows = db
    .prepare(
      `SELECT stage, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS value
       FROM crm_deals GROUP BY stage`
    )
    .all();
  const out = {};
  for (const s of STAGES) out[s] = { n: 0, value: 0 };
  for (const r of rows) {
    if (out[r.stage]) out[r.stage] = { n: r.n, value: r.value };
  }
  const open = ['lead', 'qualified', 'proposal', 'negotiation'].reduce(
    (a, s) => ({ n: a.n + out[s].n, value: a.value + out[s].value }),
    { n: 0, value: 0 }
  );
  return { byStage: out, open };
}

module.exports = {
  STAGES,
  STAGE_LABELS,
  stageLabel,
  getDeal,
  listDeals,
  createDeal,
  updateDeal,
  deleteDeal,
  dealsForContact,
  pipelineSummary
};
