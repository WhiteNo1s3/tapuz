'use strict';

/**
 * CRM — segments (v1.77).
 *
 * A saved audience is a RULE, evaluated at read time, so a segment is never
 * stale the way an exported list is. "Leads from Israel who gave consent" means
 * whoever satisfies that right now.
 *
 * SECURITY: rules arrive as JSON from an admin form, and they compile to SQL.
 * Nothing from the rule object is ever interpolated into the statement — the
 * field names come from a fixed whitelist below and every value is bound.
 * An unknown rule key is ignored, not passed through.
 */

const { db } = require('../db');
const contacts = require('./contacts');

/**
 * The rule vocabulary. Each entry turns one rule key into a SQL fragment plus
 * its bound parameters; returning null means "this value does not constrain
 * anything", so an empty box in the admin form is simply not a filter.
 */
const RULES = {
  status: (v) => (contacts.STATUSES.includes(v) ? { sql: 'status = @r_status', args: { r_status: v } } : null),

  country: (v) => {
    const c = String(v || '').trim().slice(0, 2).toUpperCase();
    return c ? { sql: 'country = @r_country', args: { r_country: c } } : null;
  },

  source: (v) => {
    const s = String(v || '').trim();
    return s ? { sql: 'source = @r_source', args: { r_source: s } } : null;
  },

  // free text over the denormalized blob
  q: (v) => {
    const q = String(v || '').trim().toLowerCase();
    return q ? { sql: 'search_blob LIKE @r_q', args: { r_q: '%' + q + '%' } } : null;
  },

  hasEmail: (v) => (v ? { sql: "email IS NOT NULL AND email <> ''", args: {} } : null),
  hasPhone: (v) => (v ? { sql: "phone IS NOT NULL AND phone <> ''", args: {} } : null),
  consent: (v) => (v ? { sql: 'consent = 1', args: {} } : null),

  /**
   * Tags: ALL listed tags must be present. Each tag is a separate bound LIKE
   * against the comma string, anchored with commas so "vip" cannot match
   * "vip-lapsed".
   */
  tags: (v) => {
    const list = Array.isArray(v) ? v : contacts.parseTags(v);
    const clean = list.map((t) => String(t).trim()).filter(Boolean).slice(0, 10);
    if (!clean.length) return null;
    const args = {};
    const parts = clean.map((tag, i) => {
      args['r_tag' + i] = '%,' + tag + ',%';
      return "(',' || tags || ',') LIKE @r_tag" + i;
    });
    return { sql: '(' + parts.join(' AND ') + ')', args };
  },

  /** Seen within the last N days. */
  activeWithinDays: (v) => {
    const d = parseInt(v, 10);
    if (!d || d < 1) return null;
    return { sql: "updated_at >= datetime('now', @r_days)", args: { r_days: '-' + Math.min(d, 3650) + ' days' } };
  }
};

/** Compile a rule object into a WHERE clause + bound args. Unknown keys ignored. */
function compile(rules = {}) {
  const where = [];
  const args = {};
  for (const key of Object.keys(RULES)) {
    if (rules[key] === undefined || rules[key] === null || rules[key] === '') continue;
    const built = RULES[key](rules[key]);
    if (!built) continue;
    where.push(built.sql);
    Object.assign(args, built.args);
  }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

function parseRules(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}') || {}; } catch (e) { return {}; }
}

/** Who is in this audience right now. */
function evaluate(rules, { limit = 500 } = {}) {
  const { clause, args } = compile(parseRules(rules));
  args.limit = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000);
  return db
    .prepare(`SELECT * FROM crm_contacts ${clause} ORDER BY updated_at DESC LIMIT @limit`)
    .all(args);
}

/** How many, without paying to fetch them. */
function count(rules) {
  const { clause, args } = compile(parseRules(rules));
  return db.prepare(`SELECT COUNT(*) AS n FROM crm_contacts ${clause}`).get(args).n;
}

function createSegment(name, rules) {
  const n = String(name || '').trim().slice(0, 200);
  if (!n) throw new Error('שם פילוח נדרש');
  const info = db
    .prepare('INSERT INTO crm_segments (name, rules) VALUES (?, ?)')
    .run(n, JSON.stringify(parseRules(rules)));
  return getSegment(info.lastInsertRowid);
}

function getSegment(id) {
  const row = db.prepare('SELECT * FROM crm_segments WHERE id = ?').get(Number(id));
  if (!row) return null;
  return Object.assign({}, row, { rules: parseRules(row.rules) });
}

function updateSegment(id, { name, rules } = {}) {
  const existing = getSegment(id);
  if (!existing) return null;
  const n = name !== undefined ? String(name).trim().slice(0, 200) : existing.name;
  const r = rules !== undefined ? parseRules(rules) : existing.rules;
  db.prepare('UPDATE crm_segments SET name = ?, rules = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(n || existing.name, JSON.stringify(r), Number(id));
  return getSegment(id);
}

function deleteSegment(id) {
  return db.prepare('DELETE FROM crm_segments WHERE id = ?').run(Number(id)).changes > 0;
}

/** All segments, each with its live size. */
function listSegments() {
  return db
    .prepare('SELECT * FROM crm_segments ORDER BY name')
    .all()
    .map((row) => {
      const rules = parseRules(row.rules);
      return Object.assign({}, row, { rules, size: count(rules) });
    });
}

module.exports = {
  RULE_KEYS: Object.keys(RULES),
  compile,
  evaluate,
  count,
  createSegment,
  getSegment,
  updateSegment,
  deleteSegment,
  listSegments
};
