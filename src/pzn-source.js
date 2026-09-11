'use strict';

/**
 * Shared BenTML-source helpers (v1.13 — the pzn/builder API surface starts
 * splitting by sub-concern, per docs/ARCHITECTURE.md: the largest,
 * most-interconnected block, split rather than moved wholesale). Used by
 * every paste door — the in-builder AI import, the advanced code tab, and
 * /admin/new's decompile flow — so it lives in its own module rather than
 * inside whichever route file happens to need it first.
 *
 * v2.20 — "take only the BenTML, any time, anywhere": every function here
 * starts with src/bentml/extract.js, so fences, chat sentences, <html>
 * brackets and the echoed empty template never reach a parser — and BOTH
 * dialects land: a keyword document ("BENTML 0.2") is compiled to the tag
 * document the .pzn store speaks.
 */

const { extractBentml, sniffDialect, looksLikePzn } = require('./bentml/extract');

/** Keep only the meta keys the compiler actually filled. */
function compactMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/**
 * Compile a keyword document to the shape every door needs: a page view
 * (blocks + head fields) AND a canonical .pzn source. Throws BentmlError
 * (code/line/fix) on a broken document — there is no repair engine for the
 * line dialect; its compiler already names the line and the fix.
 */
function lineToPzn(lineSource) {
  const { compile } = require('./bentml/compile'); // not ./bentml — that pulls the renderer
  const r = compile(lineSource);
  const pznApi = require('./pzn/index');
  const page = r.page || {};
  const doc = pznApi.fromTapuzPage({
    title: page.title || '',
    slug: page.slug || '',
    lang: page.lang || 'he',
    direction: page.direction || 'rtl',
    tags: page.tags || [],
    meta: page.meta || {},
    blocks: r.blocks
  });
  // the blocks the STORE will produce (bridge round-trip), not the raw
  // compiler output — so the builder shows exactly what a save keeps
  const view = pznApi.toTapuzPage(doc);
  view.meta = { ...(view.meta || {}), ...compactMeta(page.meta) };
  return { view, doc, source: pznApi.serialize(doc), warnings: r.warnings || [], page };
}

/**
 * Anything a model wrote → a bare .pzn source.
 * @param {string} raw
 * @returns {{ source: string, dialect: 'pzn'|'line'|'unknown', extracted: object[], page?: object, warnings?: object[] }}
 *   `extracted` lists what was stripped (fence, chat, wrappers…); `page` is
 *   the compiled head (title/meta) when the input was a keyword document.
 */
function toPznSource(raw) {
  const ex = extractBentml(raw);
  if (ex.dialect === 'line') {
    const c = lineToPzn(ex.source);
    return { source: c.source, dialect: 'line', extracted: ex.changes, page: c.page, warnings: c.warnings };
  }
  return { source: ex.source, dialect: ex.dialect, extracted: ex.changes };
}

/**
 * The ONE forgiving pipeline for pasted BenTML (v0.69 — shared by every paste
 * door: the in-builder AI import, the advanced code tab, and /admin/new).
 * extract → parse | repair → toTapuzPage. Throws with .issues on a dead paste.
 */
function pznSourceToBlocks(rawSource) {
  const ex = extractBentml(rawSource);
  if (ex.dialect === 'line') {
    const c = lineToPzn(ex.source);
    return { view: c.view, doc: c.doc, repaired: false, changes: [], warnings: c.warnings, dialect: 'line', extracted: ex.changes };
  }
  const source = ex.source;
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
  return { view, doc, repaired, changes, dialect: ex.dialect, extracted: ex.changes };
}

module.exports = { looksLikePzn, pznSourceToBlocks, toPznSource, lineToPzn, extractBentml, sniffDialect };
