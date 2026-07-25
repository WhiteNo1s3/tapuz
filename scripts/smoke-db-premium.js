'use strict';

/**
 * v1.90 QA — the premium-db pass: SQLite 3, run like it's production.
 *
 * The headline check is the one that was silently false for thirteen
 * versions: the schema has declared FOREIGN KEYs since v1.77, but SQLite
 * enforces them per-connection and defaults OFF — so they were
 * documentation. This suite proves they now FIRE (an orphan insert throws,
 * a cascade actually cascades), and that the backup shelf produces real,
 * openable, consistent snapshots with honest pruning.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-db-premium-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const Database = require('better-sqlite3');
const dbm = require('../src/db');
const { db } = dbm;
const contacts = require('../src/crm/contacts');
const events = require('../src/crm/events');

// ── the pragmas that are actually in effect ──────────────────────────
const h = dbm.dbHealth();
check('journal mode is WAL', h.journalMode === 'wal');
check('FOREIGN KEYS ARE ENFORCED (they were declared-but-off since v1.77)', h.foreignKeys === true);
check('busy_timeout waits 5s instead of throwing SQLITE_BUSY', h.busyTimeoutMs >= 5000);
check('synchronous is NORMAL — the WAL-safe fsync setting', h.synchronous === 1);

// ── enforcement, proven on real tables ───────────────────────────────
check('an orphan child row is REFUSED (crm_events pointing at contact 999999)', (() => {
  try {
    db.prepare("INSERT INTO crm_events (contact_id, type) VALUES (999999, 'chat')").run();
    return false; // it went in — FKs are still decoration
  } catch (e) { return /FOREIGN KEY/i.test(e.message); }
})());

check('ON DELETE CASCADE actually cascades now', (() => {
  const p = contacts.upsertContact({ email: 'cascade@example.com', name: 'נמחק' }).contact;
  events.record({ contactId: p.id, type: 'note', title: 'לפני מחיקה' });
  const before = db.prepare('SELECT COUNT(*) n FROM crm_events WHERE contact_id = ?').get(p.id).n;
  db.prepare('DELETE FROM crm_contacts WHERE id = ?').run(p.id);
  const after = db.prepare('SELECT COUNT(*) n FROM crm_events WHERE contact_id = ?').get(p.id).n;
  return before > 0 && after === 0;
})());

// ── the backup shelf ─────────────────────────────────────────────────
const first = dbm.backupNow();
check('a backup is created and is not empty', fs.existsSync(first.file) && first.size > 0);

check('the snapshot is a REAL database: opens, has the schema, passes quick_check', (() => {
  const copy = new Database(first.file, { readonly: true });
  try {
    const pages = copy.prepare('SELECT COUNT(*) n FROM pages').get().n;
    const ok = copy.pragma('quick_check');
    return pages >= 0 && ok.length === 1 && String(ok[0].quick_check) === 'ok';
  } finally { copy.close(); }
})());

check('nine rapid backups leave a shelf of exactly 7 — pruned, no collision errors', (() => {
  for (let i = 0; i < 8; i++) dbm.backupNow();
  const shelf = dbm.listBackups();
  return shelf.length === 7 && new Set(shelf.map((b) => b.name)).size === 7;
})());

check('backupIfStale SKIPS while the newest snapshot is fresh', dbm.backupIfStale().skipped === true);

check('…and backs up again once everything on the shelf is stale', (() => {
  const dir = path.join(ROOT, 'db', 'backups');
  const old = (Date.now() - 2 * 24 * 3600 * 1000) / 1000;
  for (const b of dbm.listBackups()) fs.utimesSync(path.join(dir, b.name), old, old);
  const r = dbm.backupIfStale();
  return !r.skipped && fs.existsSync(r.file);
})());

// ── integrity, on demand ─────────────────────────────────────────────
const integ = dbm.integrityCheck();
check('quick_check reports a healthy database', integ.ok === true && integ.detail === 'ok');

check('dbHealth carries what the admin card needs', (() => {
  const hh = dbm.dbHealth();
  return hh.size > 0 && hh.backupKeep === 7 && Array.isArray(hh.backups) &&
    hh.backups.length > 0 && hh.backups[0].mtime >= hh.backups[hh.backups.length - 1].mtime;
})());

console.log('');
console.log(fail ? 'SMOKE DB-PREMIUM: FAIL' : 'SMOKE DB-PREMIUM: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
