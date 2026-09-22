'use strict';

/**
 * The card gateway's credentials — gitignored `config/payments.json`.
 *
 * WHY A FILE AND NOT THE DATABASE. Everything else the store knows lives in
 * the site's SQLite file on purpose: the `.pzn` export, the daily backup
 * shelf and a live restore ("hot swap") carry the whole shop, and the site
 * package carries the catalog as a <bent-store> document. A payment key is
 * the one thing that must NOT travel with any of those — a backup handed to
 * a developer, a .pzn pasted into another install, a site package shared
 * as a template would each carry the owner's terminal keys. So the keys
 * live beside the SMTP password (src/notify.js → config/notify.json) and
 * the WhatsApp token (src/crm/whatsapp.js → config/whatsapp.json): in a
 * file outside the web root, never echoed by any API, readiness and a
 * last-4 tail only. A restored or hot-swapped shop on another machine
 * therefore shows its card method as "not connected" until the keys are
 * typed there — that is the correct behaviour, and docs/bent-store.md
 * says so.
 *
 * Shape:
 *   { provider: '' | 'cardcom' | 'grow', mode: 'test' | 'live',
 *     cardcom: { …the driver's credential fields… }, grow: { … } }
 *
 * This module is deliberately dumb: it stores strings with the keep /
 * clear semantics every credential store in the CMS uses (`undefined` =
 * keep what is stored, `''` = clear), and it redacts. Which fields a
 * provider has, and whether a provider is READY, is the flow's business
 * (index.js) — a store that validated field names would have to know the
 * drivers, and the drivers must never need to know the store.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG_DIR } = require('../../paths');

const STORE_PATH = path.join(CONFIG_DIR, 'payments.json');
const MODES = ['test', 'live'];
const MAX_VALUE = 300;
// The per-install key that seals a Grow processToken on its payment row
// (see sealToken): 32 random bytes, made ONCE on the first seal, kept
// through every provider save and every "ניתוק", and never read back by
// anything but openToken. Its name cannot be a provider name (providerName
// refuses a leading underscore), so no write path can reach it.
const TOKEN_KEY_FIELD = '_tokenKey';

function clean(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_VALUE);
}

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (raw && typeof raw === 'object') return raw;
    }
  } catch (e) { /* an unreadable store is an unconfigured gateway, never a crash */ }
  return {};
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // owner-only on disk: the file is a terminal key, not a setting
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(STORE_PATH, 0o600); } catch (e) { /* not every filesystem has modes */ }
}

function providerName(v) {
  const s = String(v || '').trim().toLowerCase();
  return /^[a-z][a-z0-9-]{1,19}$/.test(s) ? s : '';
}

function modeName(v, fallback) {
  const s = String(v || '').trim().toLowerCase();
  return MODES.includes(s) ? s : fallback;
}

/** The chosen provider and mode (never a credential). */
function selection() {
  const s = load();
  return { provider: providerName(s.provider), mode: modeName(s.mode, 'test') };
}

/** The stored credential strings of one provider — for the DRIVER's hands only, never for a response. */
function credentialsFor(provider) {
  const s = load();
  const p = providerName(provider);
  const block = p && s[p] && typeof s[p] === 'object' ? s[p] : {};
  const out = {};
  for (const [k, v] of Object.entries(block)) if (typeof v === 'string' && v) out[k] = v;
  return out;
}

/**
 * Write. `provider` / `mode` replace when given; a credential field is
 * `undefined` = keep, `''` = clear, anything else = replace. `fields` is
 * { [provider]: { [key]: value } } and the caller (index.js) has already
 * dropped keys the driver does not declare — an unknown key never lands.
 */
function writeSettings({ provider, mode, fields } = {}) {
  const s = load();
  if (provider !== undefined) s.provider = providerName(provider);
  if (mode !== undefined) s.mode = modeName(mode, modeName(s.mode, 'test'));
  for (const [p, block] of Object.entries(fields || {})) {
    const name = providerName(p);
    if (!name || !block || typeof block !== 'object') continue;
    const cur = s[name] && typeof s[name] === 'object' ? s[name] : {};
    for (const [k, v] of Object.entries(block)) {
      if (v === undefined) continue;
      const key = String(k).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
      if (!key) continue;
      const val = clean(v);
      if (val) cur[key] = val; else delete cur[key];
    }
    s[name] = cur;
  }
  save(s);
}

/**
 * Redacted view of one provider's fields, for the admin screen and its API:
 * whether a field is set and its last 4 characters. A field shorter than 8
 * characters shows no tail at all (a 6-digit terminal number is 4/6 of the
 * secret, not a hint).
 */
function describeFields(provider, fieldKeys) {
  const creds = credentialsFor(provider);
  const out = {};
  for (const key of fieldKeys || []) {
    const v = creds[key] || '';
    out[key] = { set: !!v, tail: v.length >= 8 ? v.slice(-4) : '' };
  }
  return out;
}

/** True when every required field of the provider has a value. */
function hasAll(provider, requiredKeys) {
  const creds = credentialsFor(provider);
  return (requiredKeys || []).every((k) => !!creds[k]);
}

/** Forget one provider's keys entirely (the admin's "ניתוק"). The token key stays. */
function clearProvider(provider) {
  const s = load();
  const name = providerName(provider);
  if (name) delete s[name];
  if (s.provider === name) s.provider = '';
  save(s);
}

// ── the sealed token ─────────────────────────────────────────────────
//
// A Grow processToken is the callback's only proof, and the database is
// the .pzn that gets handed around. So the row keeps only its sha256
// (what the callback is checked against) and a SEALED copy — AES-256-GCM
// under the per-install key above, a fresh 12-byte IV per seal, the auth
// tag stored beside the ciphertext and verified on open — which only the
// inquiry fallback needs. A backup restored on another install therefore
// still verifies callbacks (by hash) and merely loses the inquiry for the
// old rows: open() answers '' there, never throws.

function tokenKey({ create = true } = {}) {
  const s = load();
  const hex = typeof s[TOKEN_KEY_FIELD] === 'string' ? s[TOKEN_KEY_FIELD] : '';
  if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  if (!create) return null;
  const fresh = crypto.randomBytes(32);
  s[TOKEN_KEY_FIELD] = fresh.toString('hex');
  save(s);
  return fresh;
}

/** sha256 hex of a token — what a callback's token is compared against, in constant time. */
function hashToken(plain) {
  return plain ? crypto.createHash('sha256').update(String(plain)).digest('hex') : '';
}

/** 'v1:' + base64(iv | tag | ciphertext). '' for an empty token. */
function sealToken(plain) {
  if (!plain) return '';
  const key = tokenKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

/** The token back, or '' when the seal, the tag or the key do not fit (another install's backup). Never throws. */
function openToken(sealed) {
  try {
    const s = String(sealed || '');
    if (!s.startsWith('v1:')) return '';
    const key = tokenKey({ create: false });
    if (!key) return '';
    const buf = Buffer.from(s.slice(3), 'base64');
    if (buf.length < 12 + 16 + 1) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  } catch (e) {
    return '';
  }
}

module.exports = {
  STORE_PATH,
  MODES,
  TOKEN_KEY_FIELD,
  selection,
  credentialsFor,
  writeSettings,
  describeFields,
  hasAll,
  clearProvider,
  providerName,
  hashToken,
  sealToken,
  openToken,
  _load: load
};
