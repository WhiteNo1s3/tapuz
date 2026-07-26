'use strict';

/**
 * CRM companies (v2.09) — B2B org hanging off contacts, not a second person model.
 */

const { db } = require('../db');
const contacts = require('./contacts');

function getCompany(id) {
  return db.prepare('SELECT * FROM crm_companies WHERE id = ?').get(Number(id)) || null;
}

function listCompanies({ q = '', limit = 100 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const text = String(q || '').trim().toLowerCase();
  if (text) {
    return db
      .prepare(
        `SELECT * FROM crm_companies
         WHERE lower(name) LIKE ? OR lower(domain) LIKE ?
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all('%' + text + '%', '%' + text + '%', n);
  }
  return db.prepare('SELECT * FROM crm_companies ORDER BY updated_at DESC LIMIT ?').all(n);
}

function createCompany({ name, domain, phone, notes, country } = {}) {
  const n = String(name || '').trim().slice(0, 200);
  if (!n) throw new Error('שם חברה נדרש');
  const info = db
    .prepare(
      `INSERT INTO crm_companies (name, domain, phone, notes, country)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      n,
      String(domain || '').trim().slice(0, 200),
      String(phone || '').trim().slice(0, 40),
      String(notes || '').trim().slice(0, 4000),
      String(country || '').trim().slice(0, 2).toUpperCase()
    );
  return getCompany(info.lastInsertRowid);
}

function updateCompany(id, patch = {}) {
  const existing = getCompany(id);
  if (!existing) return null;
  const name = patch.name !== undefined ? String(patch.name || '').trim().slice(0, 200) : existing.name;
  if (!name) return null;
  db.prepare(
    `UPDATE crm_companies SET
       name = ?, domain = ?, phone = ?, notes = ?, country = ?,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(
    name,
    patch.domain !== undefined ? String(patch.domain || '').trim().slice(0, 200) : existing.domain,
    patch.phone !== undefined ? String(patch.phone || '').trim().slice(0, 40) : existing.phone,
    patch.notes !== undefined ? String(patch.notes || '').trim().slice(0, 4000) : existing.notes,
    patch.country !== undefined
      ? String(patch.country || '').trim().slice(0, 2).toUpperCase()
      : existing.country,
    Number(id)
  );
  return getCompany(id);
}

function deleteCompany(id) {
  return db.prepare('DELETE FROM crm_companies WHERE id = ?').run(Number(id)).changes > 0;
}

function membersOf(companyId) {
  return db
    .prepare(
      `SELECT c.*, m.role AS company_role FROM crm_company_members m
       JOIN crm_contacts c ON c.id = m.contact_id
       WHERE m.company_id = ? ORDER BY c.name, c.email`
    )
    .all(Number(companyId));
}

function companiesForContact(contactId) {
  return db
    .prepare(
      `SELECT co.*, m.role AS company_role FROM crm_company_members m
       JOIN crm_companies co ON co.id = m.company_id
       WHERE m.contact_id = ? ORDER BY co.name`
    )
    .all(Number(contactId));
}

function linkContact(companyId, contactId, role = 'member') {
  if (!getCompany(companyId) || !contacts.getContact(contactId)) {
    return { ok: false, error: 'missing' };
  }
  db.prepare(
    `INSERT INTO crm_company_members (company_id, contact_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT(company_id, contact_id) DO UPDATE SET role = excluded.role`
  ).run(Number(companyId), Number(contactId), String(role || 'member').slice(0, 40));
  return { ok: true };
}

function unlinkContact(companyId, contactId) {
  return db
    .prepare('DELETE FROM crm_company_members WHERE company_id = ? AND contact_id = ?')
    .run(Number(companyId), Number(contactId)).changes > 0;
}

function memberCount(companyId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM crm_company_members WHERE company_id = ?')
    .get(Number(companyId)).n;
}

module.exports = {
  getCompany,
  listCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
  membersOf,
  companiesForContact,
  linkContact,
  unlinkContact,
  memberCount
};
