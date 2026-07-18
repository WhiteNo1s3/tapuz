'use strict';

/**
 * v0.95 QA gate — user roles: more than one account, the WP/Drupal parity gap.
 * Store contract on a THROWAWAY site via TAPUZ_ROOT: role defaults, the
 * addTeamMember/setUserRole/removeUser lifecycle, and — the invariant that
 * matters most — a site can never lock itself out of its own admin surface.
 * Exit 1 on any failure.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// BEFORE any src require — src/paths.js resolves TAPUZ_ROOT at require time
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-team-'));
process.env.TAPUZ_ROOT = tmpRoot;

const auth = require('../src/auth');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── legacy accounts (no `role` field on disk) default to admin ──
check(auth.roleOf({ username: 'x' }) === 'admin', 'roleOf() on a role-less record defaults to admin (upgrade safety)');
check(auth.roleOf({ username: 'x', role: 'editor' }) === 'editor', 'roleOf() honors an explicit editor role');
check(auth.roleOf({ username: 'x', role: 'bogus' }) === 'admin', 'an unrecognized role value falls back to admin, not silently editor');

// ── first-run admin ──
const owner = auth.createAdmin('owner', 'ownerpass1');
check(owner.role === 'admin', 'the first-run account is always admin');
check(auth.verifyLogin('owner', 'ownerpass1').role === 'admin', 'verifyLogin surfaces the role');

// ── inviting teammates ──
const editor = auth.addTeamMember('dana', 'danapass1', 'editor');
check(editor.role === 'editor', 'invited teammate gets the requested role');
const admin2 = auth.addTeamMember('ronit', 'ronitpass1', 'admin');
check(admin2.role === 'admin', 'a second admin can be invited');
const defaulted = auth.addTeamMember('noam', 'noampass1', 'not-a-real-role');
check(defaulted.role === 'editor', 'an unrecognized requested role defaults to editor (least privilege)');

check(auth.listUsers().length === 4, 'listUsers sees every account');
check(!auth.listUsers().some((u) => 'passwordHash' in u), 'listUsers never leaks password hashes');

try {
  auth.addTeamMember('owner', 'whatever1', 'editor');
  check(false, 'duplicate username should have thrown');
} catch (e) {
  check(/קיים/.test(e.message), 'duplicate username rejected');
}

// ── role changes ──
const promoted = auth.setUserRole(editor.id, 'admin');
check(promoted.role === 'admin', 'an editor can be promoted to admin');
const demoted = auth.setUserRole(editor.id, 'editor');
check(demoted.role === 'editor', 'and demoted back');

// ── the invariant: never lock the site out of its own admin surface ──
// Drop to exactly one admin (owner) by demoting/removing every other admin.
auth.setUserRole(admin2.id, 'editor');
check(auth.listUsers().filter((u) => u.role === 'admin').length === 1, 'down to exactly one admin (owner) for the guard test');

try {
  auth.setUserRole(owner.id, 'editor');
  check(false, 'demoting the last admin should have thrown');
} catch (e) {
  check(/מנהל האחרון/.test(e.message), 'demoting the last admin is blocked');
}
try {
  auth.removeUser(owner.id);
  check(false, 'removing the last admin should have thrown');
} catch (e) {
  check(/מנהל האחרון/.test(e.message), 'removing the last admin is blocked');
}
check(auth.findUserById(owner.id) !== null, 'the last admin is still there after both blocked attempts');

// A second admin makes both operations legal again.
auth.setUserRole(admin2.id, 'admin');
check(auth.setUserRole(owner.id, 'editor').role === 'editor', 'demoting IS allowed once another admin exists');
auth.setUserRole(owner.id, 'admin'); // restore for the removal test below
check(auth.removeUser(admin2.id) === true, 'removing an admin IS allowed while another admin remains');
check(auth.findUserById(admin2.id) === null, 'removed user is gone');

// ── misc guards ──
check(auth.findUserById('does-not-exist') === null, 'looking up a missing id returns null, never throws');
try {
  auth.setUserRole('does-not-exist', 'admin');
  check(false, 'setUserRole on a missing id should have thrown');
} catch (e) {
  check(/לא נמצא/.test(e.message), 'setUserRole on a missing id is rejected cleanly');
}

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

console.log('');
if (failures) {
  console.log('SMOKE TEAM: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE TEAM: PASS');
