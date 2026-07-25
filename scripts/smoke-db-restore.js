'use strict';

/**
 * v1.91 QA — restore + the `tapuz-db` .pzn package.
 *
 * A restore is the most dangerous button in the admin, so the properties
 * under test are the refusals and the atomicity:
 *
 *   - a corrupt snapshot is refused BEFORE the live data is touched,
 *   - an import is ALL-OR-NOTHING: one poisoned row rolls back everything,
 *   - a round-trip (export → wreck → import) restores byte-honest content,
 *   - an older package restores into a newer schema (column intersection),
 *   - FTS is rebuilt (the v1.82 lesson) and foreign keys go back ON.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-db-restore-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const dbm = require('../src/db');
const { db } = dbm;
const restore = require('../src/db-restore');
const contacts = require('../src/crm/contacts');
const events = require('../src/crm/events');
const { createPage } = require('../src/pages');

// ── seed a small but cross-table world, then snapshot it ─────────────
createPage({ title: 'דף לשחזור', slug: 'restore-page' });
const adam = contacts.upsertContact({ email: 'adam@example.com', name: 'אדם ראשון', phone: '050-111-2222' }).contact;
events.record({ contactId: adam.id, type: 'note', title: 'לפני הגיבוי' });
const pagesBefore = db.prepare('SELECT COUNT(*) n FROM pages').get().n;
const snap = dbm.backupNow();

// ── wreck the world ──────────────────────────────────────────────────
require('../src/crm/subject').eraseContact(adam.id);
contacts.upsertContact({ email: 'junk@example.com', name: 'זבל' });
db.prepare('DELETE FROM pages').run();

// ── restore from the shelf snapshot ──────────────────────────────────
const r1 = restore.restoreFromSnapshot(snap.file);
const adamBack = contacts.findByEmail ? contacts.findByEmail('adam@example.com')
  : db.prepare("SELECT * FROM crm_contacts WHERE email = 'adam@example.com'").get();
check('restore succeeds and reports tables copied', r1.ok === true && r1.tables > 0);
check('the erased person is back, with their timeline', !!adamBack &&
  db.prepare('SELECT COUNT(*) n FROM crm_events WHERE contact_id = ?').get(adamBack.id).n > 0);
check('the junk added after the snapshot is gone',
  !db.prepare("SELECT 1 FROM crm_contacts WHERE email = 'junk@example.com'").get());
check('the deleted pages are back', db.prepare('SELECT COUNT(*) n FROM pages').get().n === pagesBefore);
check('FTS was rebuilt to match (the v1.82 lesson)', (() => {
  try {
    return db.prepare('SELECT COUNT(*) n FROM crm_contacts_fts_docsize').get().n ===
      db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n;
  } catch (e) { return false; }
})());
check('foreign keys are back ON and the books are consistent',
  !!db.pragma('foreign_keys', { simple: true }) && db.pragma('foreign_key_check').length === 0);

// ── a corrupt snapshot is refused before anything is touched ─────────
const evil = path.join(ROOT, 'not-a-db.sqlite');
fs.writeFileSync(evil, 'this is not a database at all, just bytes');
const before = db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n;
const r2 = restore.restoreFromSnapshot(evil);
check('a corrupt snapshot is refused and the live data is untouched',
  r2.ok === false && db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n === before);
check('a missing snapshot is a clean refusal',
  restore.restoreFromSnapshot(path.join(ROOT, 'nope.sqlite')).error === 'snapshot_missing');

// ── the .pzn package: export → wreck → import round-trip ─────────────
const pkg = restore.exportDbPackage();
check('the package is a tapuz-db .pzn: format, app version, tables',
  pkg.format === 'tapuz-db' && pkg.version === 1 && pkg.appVersion === require('../package.json').version &&
  Array.isArray(pkg.tables.crm_contacts) &&
  pkg.tables.crm_contacts.some((c) => c.email === 'adam@example.com'));
check('the package skips FTS shadow tables (rebuilt, never carried)',
  Object.keys(pkg.tables).every((t) => !t.includes('_fts')));

db.prepare('DELETE FROM pages').run();
require('../src/crm/subject').eraseContact(
  db.prepare("SELECT id FROM crm_contacts WHERE email = 'adam@example.com'").get().id);
const r3 = restore.importDbPackage(pkg);
check('importing the package restores the world', r3.ok === true &&
  !!db.prepare("SELECT 1 FROM crm_contacts WHERE email = 'adam@example.com'").get() &&
  db.prepare('SELECT COUNT(*) n FROM pages').get().n === pagesBefore);

// ── refusals and atomicity ───────────────────────────────────────────
check('a non-package is refused', restore.importDbPackage({ hello: 'world' }).error === 'not_a_db_package');
check('ALL-OR-NOTHING: one poisoned row rolls back the entire import', (() => {
  const poisoned = JSON.parse(JSON.stringify(pkg));
  poisoned.tables.crm_events = [{ contact_id: 1, type: null }]; // type is NOT NULL
  const r = restore.importDbPackage(poisoned);
  // the failed import must leave the PREVIOUS content fully intact
  return r.ok === false &&
    !!db.prepare("SELECT 1 FROM crm_contacts WHERE email = 'adam@example.com'").get() &&
    db.prepare('SELECT COUNT(*) n FROM pages').get().n === pagesBefore;
})());
check('an unknown table in the package is ignored, not fatal', (() => {
  const alien = JSON.parse(JSON.stringify(pkg));
  alien.tables.some_future_table = [{ a: 1 }];
  return restore.importDbPackage(alien).ok === true;
})());
check('an OLDER package (missing a column) restores into the newer schema', (() => {
  const older = JSON.parse(JSON.stringify(pkg));
  for (const row of older.tables.crm_contacts) delete row.country; // pre-country era
  const r = restore.importDbPackage(older);
  const adam2 = db.prepare("SELECT * FROM crm_contacts WHERE email = 'adam@example.com'").get();
  return r.ok === true && !!adam2 && adam2.country !== undefined;
})());

// ── the shelf-edge: restoring the OLDEST backup while pruning runs ───
check('restoring the oldest snapshot survives the safety-backup prune', (() => {
  // fill the shelf so the next backupNow() prunes the oldest
  for (let i = 0; i < 7; i++) dbm.backupNow();
  const oldest = dbm.listBackups().slice(-1)[0];
  const file = path.join(ROOT, 'db', 'backups', oldest.name);
  // the route's exact sequence: copy aside → safety backup (prunes) → restore the copy
  const tmp = file + '.restoring';
  fs.copyFileSync(file, tmp);
  dbm.backupNow();
  const r = restore.restoreFromSnapshot(tmp);
  try { fs.unlinkSync(tmp); } catch (e) { /* */ }
  return r.ok === true;
})());

console.log('');
console.log(fail ? 'SMOKE DB-RESTORE: FAIL' : 'SMOKE DB-RESTORE: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
