'use strict';

/**
 * Contact attributes (v2.12) — open bag for enterprise / vertical data.
 *
 * Core columns stay identity (name/email/phone). Everything else — dietary,
 * table preference, loyalty tier, booking notes — lives here as namespaced
 * keys so restaurants (and any vertical) expand without schema forks.
 *
 * Key rules:
 *   - namespaced: `restaurant.dietary`, `loyalty.tier`, `custom.note`
 *   - slug chars only: a-z 0-9 . _ -
 *   - value: JSON-serializable, stored as text (max ~8KB)
 *   - public: may surface on the customer portal profile
 *
 * Definitions (optional): verticals register label/help for admin UI.
 */

const { db } = require('../db');
const hooks = require('./hooks');

const KEY_RE = /^[a-z][a-z0-9_.-]{1,63}$/;
const MAX_VALUE_JSON = 8000;

/** In-memory definitions: key → { label, help, publicDefault, vertical } */
const definitions = new Map();

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_contact_attrs (
      contact_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      public INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (contact_id, key),
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_crm_attrs_key ON crm_contact_attrs(key, contact_id)'
  );
}

function normalizeKey(key) {
  const k = String(key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9_.-]+/g, '')
    .slice(0, 64);
  if (!KEY_RE.test(k)) return '';
  return k;
}

function encodeValue(value) {
  if (value === undefined) return null;
  try {
    const s = JSON.stringify(value);
    if (s == null) return null;
    if (s.length > MAX_VALUE_JSON) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function decodeValue(raw) {
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
}

/**
 * Register how an attribute presents in admin (and optional public default).
 * Verticals call this at load time — expand, don't patch core forms.
 */
function define(key, opts = {}) {
  const k = normalizeKey(key);
  if (!k) return false;
  definitions.set(k, {
    key: k,
    label: String(opts.label || k).slice(0, 120),
    help: String(opts.help || '').slice(0, 400),
    publicDefault: opts.publicDefault === true,
    vertical: String(opts.vertical || k.split('.')[0] || 'custom').slice(0, 40)
  });
  return true;
}

function listDefinitions() {
  return Array.from(definitions.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function getDefinition(key) {
  return definitions.get(normalizeKey(key)) || null;
}

function get(contactId, key) {
  ensureTable();
  const k = normalizeKey(key);
  if (!k) return null;
  const row = db
    .prepare('SELECT * FROM crm_contact_attrs WHERE contact_id = ? AND key = ?')
    .get(Number(contactId), k);
  if (!row) return null;
  return {
    key: row.key,
    value: decodeValue(row.value),
    public: !!row.public,
    updated_at: row.updated_at
  };
}

function listForContact(contactId, { publicOnly = false } = {}) {
  ensureTable();
  const id = Number(contactId);
  if (!id) return [];
  const rows = publicOnly
    ? db
        .prepare(
          'SELECT * FROM crm_contact_attrs WHERE contact_id = ? AND public = 1 ORDER BY key'
        )
        .all(id)
    : db
        .prepare('SELECT * FROM crm_contact_attrs WHERE contact_id = ? ORDER BY key')
        .all(id);
  return rows.map((r) => ({
    key: r.key,
    value: decodeValue(r.value),
    public: !!r.public,
    updated_at: r.updated_at,
    def: getDefinition(r.key)
  }));
}

/**
 * Set one attribute. value must be JSON-serializable.
 * @returns {{ ok:boolean, error?:string, attr?:object }}
 */
function set(contactId, key, value, { public: isPublic } = {}) {
  ensureTable();
  const id = Number(contactId);
  if (!id) return { ok: false, error: 'contact' };
  const k = normalizeKey(key);
  if (!k) return { ok: false, error: 'key' };
  const encoded = encodeValue(value);
  if (encoded == null) return { ok: false, error: 'value' };

  let pub = isPublic;
  if (pub == null) {
    const def = getDefinition(k);
    pub = def ? !!def.publicDefault : false;
  }

  db.prepare(
    `INSERT INTO crm_contact_attrs (contact_id, key, value, public, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(contact_id, key) DO UPDATE SET
       value = excluded.value,
       public = excluded.public,
       updated_at = CURRENT_TIMESTAMP`
  ).run(id, k, encoded, pub ? 1 : 0);

  // touch contact activity so named retention / "last seen" stays honest
  try {
    require('./contacts').touchActivity(id);
  } catch (e) { /* */ }

  const attr = get(id, k);
  hooks.emit('attrs.set', { contactId: id, key: k, value: attr && attr.value, public: !!(attr && attr.public) });
  return { ok: true, attr };
}

function remove(contactId, key) {
  ensureTable();
  const id = Number(contactId);
  const k = normalizeKey(key);
  if (!id || !k) return false;
  const n = db
    .prepare('DELETE FROM crm_contact_attrs WHERE contact_id = ? AND key = ?')
    .run(id, k).changes;
  if (n) hooks.emit('attrs.removed', { contactId: id, key: k });
  return n > 0;
}

function removeAllForContact(contactId) {
  ensureTable();
  return (
    db.prepare('DELETE FROM crm_contact_attrs WHERE contact_id = ?').run(Number(contactId))
      .changes > 0
  );
}

/** As plain object map { key: value } — for APIs / portal. */
function asMap(contactId, { publicOnly = false } = {}) {
  const out = {};
  for (const a of listForContact(contactId, { publicOnly })) {
    out[a.key] = a.value;
  }
  return out;
}

module.exports = {
  ensureTable,
  normalizeKey,
  define,
  listDefinitions,
  getDefinition,
  get,
  listForContact,
  set,
  remove,
  removeAllForContact,
  asMap,
  KEY_RE,
  MAX_VALUE_JSON
};
