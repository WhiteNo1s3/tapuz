'use strict';

/**
 * Agent tokens — scoped bearer credentials for the Grokin bridge (v0.45).
 *
 * The browser extension (or any external agent) authenticates to /agent/v1/*
 * with `Authorization: Bearer tzk_...`. Tokens are NOT session cookies:
 *  - they are never auto-sent by a browser, so the agent API needs no CSRF
 *    check and can safely use CORS `Access-Control-Allow-Origin: *` WITHOUT
 *    credentials;
 *  - only a scrypt hash is stored (config/agent-tokens.json, gitignored);
 *  - the plaintext token is shown to the admin exactly once, at mint time.
 *
 * Lookup model (GitHub-PAT style): the non-secret 12-char prefix indexes the
 * record; the full token is then verified with scrypt + constant-time compare.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');
const { hashPassword, verifyPassword } = require('./auth');

const STORE_PATH = path.join(CONFIG_DIR, 'agent-tokens.json');
const PREFIX = 'tzk_';
const PREFIX_LEN = 12; // 'tzk_' + 8 chars, non-secret, used only for lookup
const SCOPES = ['read', 'write'];

// last-used timestamps live in memory only — no disk write per request
const lastUsed = new Map();

function load() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (Array.isArray(data.tokens)) return data;
    }
  } catch (e) { /* fall through */ }
  return { tokens: [] };
}

function save(data) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  try { fs.chmodSync(STORE_PATH, 0o600); } catch (e) { /* POSIX only */ }
}

function normalizeScopes(scopes) {
  const set = new Set();
  for (const s of Array.isArray(scopes) ? scopes : []) {
    if (SCOPES.includes(s)) set.add(s);
  }
  if (!set.size) set.add('read');
  // write implies read
  if (set.has('write')) set.add('read');
  return [...set];
}

/**
 * Mint a new token. Returns { token, record } — `token` (plaintext) is the
 * ONLY time the secret is available; the caller must surface it once.
 * @param {{ name?: string, scopes?: string[] }} opts
 */
function mintToken({ name = '', scopes = ['read'] } = {}) {
  const secret = PREFIX + crypto.randomBytes(24).toString('base64url');
  const record = {
    id: crypto.randomBytes(8).toString('hex'),
    name: String(name || '').slice(0, 80) || 'agent',
    prefix: secret.slice(0, PREFIX_LEN),
    hash: hashPassword(secret),
    scopes: normalizeScopes(scopes),
    createdAt: new Date().toISOString()
  };
  const data = load();
  data.tokens.push(record);
  save(data);
  return { token: secret, record: publicView(record) };
}

/**
 * Verify a presented bearer token. Returns { id, name, scopes } or null.
 * @param {string} raw
 */
function verifyAgentToken(raw) {
  const token = String(raw || '');
  if (!token.startsWith(PREFIX) || token.length < PREFIX_LEN + 8) return null;
  const prefix = token.slice(0, PREFIX_LEN);
  const data = load();
  const rec = data.tokens.find((t) => t.prefix === prefix);
  if (!rec) return null;
  if (!verifyPassword(token, rec.hash)) return null;
  lastUsed.set(rec.id, Date.now());
  return { id: rec.id, name: rec.name, scopes: rec.scopes.slice() };
}

function publicView(rec) {
  return {
    id: rec.id,
    name: rec.name,
    prefix: rec.prefix,
    scopes: rec.scopes.slice(),
    createdAt: rec.createdAt,
    lastUsedAt: lastUsed.has(rec.id) ? new Date(lastUsed.get(rec.id)).toISOString() : null
  };
}

/** List tokens WITHOUT secrets (id, name, prefix, scopes, timestamps). */
function listTokens() {
  return load().tokens.map(publicView);
}

/** Revoke by id. Returns true if a token was removed. */
function revokeToken(id) {
  const data = load();
  const before = data.tokens.length;
  data.tokens = data.tokens.filter((t) => t.id !== String(id));
  if (data.tokens.length === before) return false;
  save(data);
  lastUsed.delete(String(id));
  return true;
}

module.exports = {
  STORE_PATH,
  SCOPES,
  mintToken,
  verifyAgentToken,
  listTokens,
  revokeToken,
  normalizeScopes
};
