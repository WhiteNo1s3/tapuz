'use strict';

/**
 * Shared BenTML-source helpers (v1.13 — the pzn/builder API surface starts
 * splitting by sub-concern, per docs/ARCHITECTURE.md: the largest,
 * most-interconnected block, split rather than moved wholesale). Used by
 * every paste door — the in-builder AI import, the advanced code tab, and
 * /admin/new's decompile flow — so it lives in its own module rather than
 * inside whichever route file happens to need it first.
 */

/** An LLM reply that speaks .pzn — <bent-*> tags / a bent-version head. */
function looksLikePzn(source) {
  return /<bent-[a-z]/i.test(source) || /bent-version/i.test(source);
}

/**
 * The ONE forgiving pipeline for pasted BenTML (v0.69 — shared by every paste
 * door: the in-builder AI import, the advanced code tab, and /admin/new).
 * extract → parse | repair → toTapuzPage. Throws with .issues on a dead paste.
 */
function pznSourceToBlocks(rawSource) {
  const { extractPzn } = require('./pzn-extract');
  const source = extractPzn(rawSource);
  const pznApi = require('./pzn/index');
  let doc;
  let repaired = false;
  let changes = [];
  try {
    doc = pznApi.parse(source);
    const errs = pznApi.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
    if (errs.length) { const e = new Error('invalid'); e.issues = errs; throw e; }
  } catch (parseErr) {
    const { repair } = require('./pzn/repair');
    const r = repair(source);
    if (!r.ok || r.remaining.length) {
      const err = new Error(r.error || 'לא הצלחתי לקרוא את ה‑BenTML');
      err.issues = r.remaining || parseErr.issues;
      throw err;
    }
    doc = pznApi.parse(r.source);
    repaired = true;
    changes = r.changes;
  }
  // even a VALID doc can carry prop drift (url= for href=) — adopt twins so
  // the model's obvious intent lands instead of silently dropping
  const twinChanges = require('./pzn/repair').adoptPropTwins(doc);
  if (twinChanges.length) changes = changes.concat(twinChanges);
  // telemetry (v1.85): every AI-authored document that lands here answers the
  // "is the syntax a problem?" question — including the clean ones, which are
  // the denominator. Guarded inside; can never affect the parse.
  require('./pzn-repair-stats').record({ changes, repaired });
  const view = pznApi.toTapuzPage(doc);
  return { view, doc, repaired, changes };
}

module.exports = { looksLikePzn, pznSourceToBlocks };
