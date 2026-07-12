#!/usr/bin/env node
'use strict';

/**
 * seed-dev-admin.js — DEV CONVENIENCE ONLY.
 *
 * Creates (or resets) a local admin login so you can stand the CMS up and test
 * in seconds without walking the first-run wizard. Defaults to `admin` / `admin`.
 *
 * WHY THIS IS SAFE TO SHIP IN THE REPO (and is NOT a backdoor):
 *   - It writes ONLY to config/auth.json, which is gitignored. Your credential
 *     never enters version control and never reaches another machine.
 *   - The app itself hardcodes NO default account — remove auth.json and there
 *     is no admin at all. This script is the only thing that seeds one, and you
 *     have to run it deliberately.
 *   - It REFUSES to run when NODE_ENV=production (a weak password must never be
 *     minted on a real deployment). Override only with --force if you truly
 *     know what you are doing.
 *
 * Usage:
 *   npm run seed:admin                       # admin / admin
 *   node scripts/seed-dev-admin.js alice s3cret
 *   SEED_ADMIN_USER=ben SEED_ADMIN_PASS=... node scripts/seed-dev-admin.js
 */

const fs = require('fs');
const path = require('path');
const { AUTH_PATH, hashPassword, verifyPassword } = require('../src/auth');

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const positional = argv.filter((a) => !a.startsWith('--'));

const username = positional[0] || process.env.SEED_ADMIN_USER || 'admin';
const password = positional[1] || process.env.SEED_ADMIN_PASS || 'admin';

// ── production guard ──────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !force) {
  console.error('✗ Refusing to seed a dev admin in NODE_ENV=production.');
  console.error('  This mints a weak, known credential and must never run on a');
  console.error('  live site. If you REALLY mean it, re-run with --force.');
  process.exit(1);
}

// ── upsert into config/auth.json (preserving secret + any other users) ─
let data = { users: [] };
try {
  if (fs.existsSync(AUTH_PATH)) {
    data = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    if (!Array.isArray(data.users)) data.users = [];
  }
} catch (e) {
  console.error('✗ Could not read existing auth.json (' + e.message + '). Aborting so nothing is lost.');
  process.exit(1);
}

const crypto = require('crypto');
const passwordHash = hashPassword(password);
const existing = data.users.find((u) => String(u.username).toLowerCase() === username.toLowerCase());
let action;
if (existing) {
  existing.passwordHash = passwordHash;
  action = 'reset password for existing user';
} else {
  data.users.push({
    id: crypto.randomBytes(8).toString('hex'),
    username,
    passwordHash,
    createdAt: new Date().toISOString()
  });
  action = 'created new admin';
}

const dir = path.dirname(AUTH_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(AUTH_PATH, JSON.stringify(data, null, 2), 'utf8');
try { fs.chmodSync(AUTH_PATH, 0o600); } catch (e) { /* no-op on Windows */ }

// ── self-verify (QA in the way) ───────────────────────────────────────
const ok = verifyPassword(password, passwordHash);
if (!ok) {
  console.error('✗ Self-check FAILED: the seeded hash does not verify. Nothing you can trust here — investigate auth.js.');
  process.exit(1);
}

const weak = password.length < 8;
console.log('✓ ' + action + ': "' + username + '"  →  ' + AUTH_PATH);
console.log('  login at /admin with   user: ' + username + '   pass: ' + password);
if (weak) {
  console.log('');
  console.log('  ⚠  This is a DEV-ONLY weak credential. Do not expose this server');
  console.log('     to the internet with it. Change it before any real deployment.');
}
