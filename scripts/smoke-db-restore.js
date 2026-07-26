'use strict';

/**
 * v1.91/v1.92 QA — restore, sqlite-forever edition.
 *
 * One format for shelf, export and upload: a SQLite snapshot that
 * SELF-IDENTIFIES ('TPUZ' in the application_id header). A restore is the
 * most dangerous button in the admin, so the properties under test are the
 * refusals:
 *
 *   - a corrupt file is refused BEFORE the live data is touched,
 *   - a healthy-but-FOREIGN sqlite file is refused too — emptying our
 *     tables for a file that fills none of them would be a site wipe,
 *   - a pre-stamp shelf snapshot (application_id 0, our schema) still
 *     restores — the guard must not orphan old backups,
 *   - an OLDER snapshot restores into a newer schema (column intersection),
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

const Database = require('better-sqlite3');
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

check('the snapshot SELF-IDENTIFIES: application_id is TPUZ', (() => {
  const probe = new Database(snap.file, { readonly: true });
  try { return probe.pragma('application_id', { simple: true }) === dbm.TAPUZ_APP_ID; }
  finally { probe.close(); }
})());

// ── wreck the world, restore it ──────────────────────────────────────
require('../src/crm/subject').eraseContact(adam.id);
contacts.upsertContact({ email: 'junk@example.com', name: 'זבל' });
db.prepare('DELETE FROM pages').run();

const r1 = restore.restoreFromSnapshot(snap.file);
const adamBack = db.prepare("SELECT * FROM crm_contacts WHERE email = 'adam@example.com'").get();
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

// ── the refusals: corrupt, missing, foreign ──────────────────────────
const evil = path.join(ROOT, 'not-a-db.sqlite');
fs.writeFileSync(evil, 'this is not a database at all, just bytes');
const before = db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n;
const r2 = restore.restoreFromSnapshot(evil);
check('a corrupt file is refused and the live data is untouched',
  r2.ok === false && db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n === before);
check('a missing file is a clean refusal',
  restore.restoreFromSnapshot(path.join(ROOT, 'nope.sqlite')).error === 'snapshot_missing');

check('a HEALTHY BUT FOREIGN sqlite file is refused — restoring it would be a wipe', (() => {
  const alien = path.join(ROOT, 'alien.sqlite');
  const a = new Database(alien);
  a.exec('CREATE TABLE their_stuff (id INTEGER PRIMARY KEY, note TEXT)');
  a.prepare("INSERT INTO their_stuff (note) VALUES ('hello')").run();
  a.close();
  const r = restore.restoreFromSnapshot(alien);
  return r.ok === false && r.error === 'not_a_tapuz_db' &&
    db.prepare('SELECT COUNT(*) n FROM pages').get().n === pagesBefore;
})());

// ── compatibility: pre-stamp and pre-column snapshots still restore ──
check('a PRE-STAMP shelf snapshot (application_id 0, our schema) is still accepted', (() => {
  const old = path.join(ROOT, 'prestamp.sqlite');
  fs.copyFileSync(snap.file, old);
  const s = new Database(old);
  s.pragma('application_id = 0');
  s.close();
  return restore.restoreFromSnapshot(old).ok === true;
})());

check('an OLDER snapshot (missing a column) restores into the newer schema', (() => {
  const old = path.join(ROOT, 'oldschema.sqlite');
  fs.copyFileSync(snap.file, old);
  const s = new Database(old);
  s.exec('ALTER TABLE crm_contacts DROP COLUMN country');
  s.close();
  const r = restore.restoreFromSnapshot(old);
  const adam2 = db.prepare("SELECT * FROM crm_contacts WHERE email = 'adam@example.com'").get();
  return r.ok === true && !!adam2 && adam2.country !== undefined;
})());

// ── the shelf-edge: restoring the OLDEST backup while pruning runs ───
check('restoring the oldest snapshot survives the safety-backup prune', (() => {
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
