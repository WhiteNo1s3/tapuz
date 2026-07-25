'use strict';

/**
 * BenTML repair telemetry (v1.85).
 *
 * The question this answers: **is the syntax a problem for models, and where?**
 * Ben asked whether BenTML needs a redesign; the honest answer is a number, not
 * an opinion. Every time an AI-authored document passes through the repair
 * pipeline we record what — if anything — had to be fixed:
 *
 *   - a CLEAN row when the document needed no repair at all (the denominator —
 *     without it, "PROP_ALIAS fired 40 times" cannot be told apart from
 *     "everything is on fire" vs "40 out of 4,000"),
 *   - one row per (repair code, element) otherwise, aggregated by count.
 *
 * What the numbers will mean:
 *   - PROP_ALIAS / ALIAS dominate → models fight our VOCABULARY: fix dictionary
 *     wording or promote the alias to the spec. Not a syntax problem.
 *   - QUARANTINE dominates      → models want elements we do not have: gaps in
 *     the module set, name them and build them.
 *   - E_/structural codes       → an actual syntax problem. Only then is a
 *     redesign conversation worth having.
 *
 * PRIVACY: only the code and the element name are stored — never the document,
 * never a prop value, never who pasted it. This measures the language, not the
 * user.
 *
 * Recording NEVER throws: telemetry about a repair must not be able to break
 * the repair.
 */

const { db } = require('./db');

/** Pull the element name out of a repair message ("<bent-hero> …"). */
function elementOf(change) {
  const m = /<bent-([a-z][a-z0-9-]*)>/i.exec(String((change && change.message) || ''));
  return m ? m[1].toLowerCase().slice(0, 40) : '';
}

/**
 * Record one document's pass through the pipeline.
 * @param {{changes?: Array<{code:string,message?:string}>, repaired?: boolean}} result
 */
function record(result = {}) {
  try {
    const changes = Array.isArray(result.changes) ? result.changes : [];
    const upsert = db.prepare(`
      INSERT INTO pzn_repair_stats (code, element, count, last_seen)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(code, element) DO UPDATE SET
        count = count + 1, last_seen = CURRENT_TIMESTAMP
    `);
    if (!changes.length) {
      upsert.run('CLEAN', '');
      return;
    }
    const tx = db.transaction((list) => {
      // one CLEAN-or-not marker per DOCUMENT, plus one row per fix
      upsert.run('REPAIRED_DOC', '');
      for (const c of list) {
        const code = String((c && c.code) || 'UNKNOWN').slice(0, 40);
        upsert.run(code, elementOf(c));
      }
    });
    tx(changes);
  } catch (e) {
    // deliberately swallowed — see the header
  }
}

/** The numbers, shaped for the admin card and the JSON endpoint. */
function summary() {
  try {
    const rows = db
      .prepare('SELECT code, element, count, last_seen FROM pzn_repair_stats ORDER BY count DESC')
      .all();
    const clean = rows.find((r) => r.code === 'CLEAN' && !r.element);
    const repairedDocs = rows.find((r) => r.code === 'REPAIRED_DOC' && !r.element);
    const cleanCount = clean ? clean.count : 0;
    const repairedCount = repairedDocs ? repairedDocs.count : 0;
    const total = cleanCount + repairedCount;
    const fixes = rows.filter((r) => r.code !== 'CLEAN' && r.code !== 'REPAIRED_DOC');
    return {
      documents: total,
      clean: cleanCount,
      repaired: repairedCount,
      cleanRate: total ? Math.round((cleanCount / total) * 100) : null,
      topFixes: fixes.slice(0, 15),
      byCode: fixes.reduce((acc, r) => {
        acc[r.code] = (acc[r.code] || 0) + r.count;
        return acc;
      }, {})
    };
  } catch (e) {
    return { documents: 0, clean: 0, repaired: 0, cleanRate: null, topFixes: [], byCode: {} };
  }
}

function reset() {
  try { db.prepare('DELETE FROM pzn_repair_stats').run(); return true; }
  catch (e) { return false; }
}

module.exports = { record, summary, reset, elementOf };
