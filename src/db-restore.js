'use strict';

/**
 * v1.91/v1.92 — restore: shelf snapshot (or uploaded file) → live database.
 *
 * v1.92, "sqlite forever" (Ben): the database package IS the SQLite file.
 * The JSON table-dump package shipped in v1.91 was retired the same day —
 * a transfer format that moves in parts is brickable, and two mechanisms
 * for the same job is one too many. SQLite 3 is itself an open,
 * archival-grade format (every language reads it), and the file
 * SELF-IDENTIFIES via the 'TPUZ' application_id stamped in its header —
 * that is what the .pzn export/downloadable snapshots carry, and what the
 * community CRM ports are told to speak.
 *
 * Safety properties, each pinned by smoke-db-restore:
 *   - a corrupt file is refused BEFORE the live data is touched
 *     (quick_check on a read-only probe),
 *   - a FOREIGN sqlite file — healthy but not a Tapuziel database — is
 *     refused too (application_id / pages-table guard), because emptying
 *     the live tables for a file that fills none of them is a wipe,
 *   - the copy is ALL-OR-NOTHING: one failed row rolls back everything,
 *   - column intersection: an older snapshot restores into a newer schema
 *     (missing columns take their defaults; unknown tables are skipped),
 *     then `initialize()` tops up migrations,
 *   - FTS is rebuilt afterwards (the v1.82 lesson) and foreign_keys goes
 *     back ON. Live restore, no restart: the snapshot is ATTACHed into
 *     the open handle, never swapped under it.
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const { db, initialize, TAPUZ_APP_ID } = require('./db');

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
  // The store (v2.53) lives in this file: a restored .pzn may hold another
  // shop entirely — its pages and the static storefront follow it (the
  // live site is the export, and a hot swap must reach the visitors)
  try { require('./store').afterRestore(); } catch (e) { /* the restore itself already landed */ }
}

function restoreFromSnapshot(file) {
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'snapshot_missing' };

  // Prove it IS a healthy TAPUZIEL database BEFORE emptying ours for it.
  try {
    const probe = new Database(file, { readonly: true });
    try {
      const qc = probe.pragma('quick_check');
      if (!(qc.length === 1 && String(qc[0].quick_check) === 'ok')) {
        return { ok: false, error: 'snapshot_corrupt' };
      }
      // Identity: the 'TPUZ' stamp, or (pre-v1.92 shelf snapshots) at least
      // our own schema. A healthy-but-foreign sqlite file restores NOTHING
      // into our tables — accepting it would be a site wipe, so refuse.
      const appId = probe.pragma('application_id', { simple: true });
      const hasPages = probe.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='pages'").get();
      if (appId !== TAPUZ_APP_ID && !hasPages) {
        return { ok: false, error: 'not_a_tapuz_db' };
      }
    } finally { probe.close(); }
  } catch (e) {
    return { ok: false, error: 'snapshot_unreadable' };
  }

  db.pragma('foreign_keys = OFF'); // ordering-free copy; checked whole at the end
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

module.exports = { restoreFromSnapshot };
