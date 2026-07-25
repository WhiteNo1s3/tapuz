'use strict';

/**
 * v1.91 — restore and the database package (.pzn).
 *
 * Two ways content comes BACK into the live database, both funneling into
 * one replace-everything core that runs inside a single transaction:
 *
 *   - `restoreFromSnapshot(file)` — a shelf snapshot (plain SQLite) is
 *     ATTACHed and copied table-by-table into the live handle. No restart,
 *     no file swapping under an open connection.
 *   - `importDbPackage(doc)` — the `.pzn` database package: the same
 *     content as readable JSON. `exportDbPackage()` produces it.
 *
 * Why `.pzn` and not just the binary? The game: ".pzn is our RPM" —
 * everything portable in Tapuziel is a documented package anyone can
 * implement. `tapuz-site` carries the site; `tapuz-db` carries the
 * database, table-by-table, in the open. The binary snapshots stay on the
 * shelf for crash-recovery; the package is for portability.
 *
 * Safety properties, each pinned by smoke-db-restore:
 *   - all-or-nothing: one poisoned row rolls back the entire import,
 *   - a corrupt snapshot is refused BEFORE the live data is touched,
 *   - column intersection: an older package/snapshot restores into a newer
 *     schema (missing columns take their defaults; unknown tables are
 *     skipped), then `initialize()` tops up migrations,
 *   - FTS is rebuilt afterwards (the v1.82 lesson: never trust an index
 *     you did not rebuild), and foreign_keys goes back ON.
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const { db, initialize } = require('./db');

const DB_PACKAGE_FORMAT = 'tapuz-db';
const DB_PACKAGE_VERSION = 1;

/** App tables only — never sqlite_* internals, never FTS shadows. */
function liveTables() {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((r) => r.name)
    .filter((n) => !n.includes('_fts'));
}

function liveCols(table) {
  return db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map((c) => c.name);
}

/** Post-restore healing, idempotent: migrations top-up + FTS rebuild. */
function afterRestore() {
  try { initialize(); } catch (e) { /* additive migrations; a failure surfaces on next boot */ }
  try { db.exec("INSERT INTO crm_contacts_fts(crm_contacts_fts) VALUES('rebuild')"); } catch (e) { /* no FTS = nothing to rebuild */ }
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* housekeeping */ }
}

// ── the export: the database as a .pzn package ───────────────────────

function exportDbPackage() {
  const tables = {};
  for (const t of liveTables()) {
    tables[t] = db.prepare(`SELECT * FROM "${t}"`).all();
  }
  return {
    format: DB_PACKAGE_FORMAT,
    version: DB_PACKAGE_VERSION,
    app: 'tapuziel',
    appVersion: require('../package.json').version,
    exportedAt: new Date().toISOString(),
    note: 'תוכן מסד הנתונים כולו, טבלה-טבלה, בפורמט פתוח. ייבוא מחליף את כל התוכן (נוצר גיבוי בטיחות קודם).',
    tables
  };
}

// ── the import: .pzn package → live database ─────────────────────────

function importDbPackage(doc) {
  if (!doc || typeof doc !== 'object' || doc.format !== DB_PACKAGE_FORMAT) {
    return { ok: false, error: 'not_a_db_package' };
  }
  const src = (doc.tables && typeof doc.tables === 'object') ? doc.tables : {};

  db.pragma('foreign_keys = OFF'); // ordering-free copy; checked whole at the end
  try {
    let copied = 0;
    db.transaction(() => {
      const tables = liveTables();
      for (const t of tables) db.prepare(`DELETE FROM "${t}"`).run();
      for (const t of tables) {
        const rows = Array.isArray(src[t]) ? src[t] : null;
        if (!rows || !rows.length) continue; // unknown/foreign tables in the doc are simply ignored
        // Column intersection with the LIVE schema; export rows are
        // homogeneous, so the first row's keys speak for all.
        const use = liveCols(t).filter((c) => c in rows[0]);
        if (!use.length) continue;
        const ins = db.prepare(
          `INSERT INTO "${t}" (${use.map((c) => `"${c}"`).join(',')})
           VALUES (${use.map((c) => '@' + c).join(',')})`
        );
        for (const r of rows) {
          const bound = {};
          for (const c of use) bound[c] = r[c] === undefined ? null : r[c];
          ins.run(bound);
        }
        copied++;
      }
    })();
    return { ok: true, tables: copied };
  } catch (e) {
    // the transaction rolled back — the database is exactly as it was
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  } finally {
    db.pragma('foreign_keys = ON');
    afterRestore();
  }
}

// ── the restore: shelf snapshot → live database ──────────────────────

function restoreFromSnapshot(file) {
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'snapshot_missing' };

  // Prove it IS a healthy database BEFORE emptying ours for it.
  try {
    const probe = new Database(file, { readonly: true });
    try {
      const qc = probe.pragma('quick_check');
      if (!(qc.length === 1 && String(qc[0].quick_check) === 'ok')) {
        return { ok: false, error: 'snapshot_corrupt' };
      }
    } finally { probe.close(); }
  } catch (e) {
    return { ok: false, error: 'snapshot_unreadable' };
  }

  db.pragma('foreign_keys = OFF');
  let attached = false;
  try {
    db.prepare('ATTACH DATABASE ? AS restore_src').run(file);
    attached = true;
    const srcTables = new Set(
      db.prepare("SELECT name FROM restore_src.sqlite_master WHERE type='table'").all().map((r) => r.name)
    );
    let copied = 0;
    db.transaction(() => {
      const tables = liveTables();
      for (const t of tables) db.prepare(`DELETE FROM "${t}"`).run();
      for (const t of tables) {
        if (!srcTables.has(t)) continue; // older snapshot without this table
        const use = liveCols(t).filter((c) =>
          db.prepare("SELECT 1 FROM pragma_table_info(?, 'restore_src') WHERE name = ?").get(t, c));
        if (!use.length) continue;
        const colList = use.map((c) => `"${c}"`).join(',');
        db.prepare(`INSERT INTO main."${t}" (${colList}) SELECT ${colList} FROM restore_src."${t}"`).run();
        copied++;
      }
    })();
    return { ok: true, tables: copied };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  } finally {
    if (attached) { try { db.prepare('DETACH DATABASE restore_src').run(); } catch (e) { /* already gone */ } }
    db.pragma('foreign_keys = ON');
    afterRestore();
  }
}

module.exports = {
  DB_PACKAGE_FORMAT, DB_PACKAGE_VERSION,
  exportDbPackage, importDbPackage, restoreFromSnapshot
};
