'use strict';

/**
 * pzn/BenTML page-mutating routes — the second and last sub-concern split
 * of the page-builder/pzn API surface (v1.14, docs/ARCHITECTURE.md:
 * completing the cut v1.13 started). Every route here actually creates or
 * writes a page file on disk: reading/saving canonical .pzn source,
 * decompiling a URL/HTML into a new draft (with async image ingestion),
 * creating a page from a bot-authored reply, and applying builder-standard
 * AST ops. Higher-risk than the stateless cluster (real disk writes, slug-
 * collision handling, async work) — extracted with the same "prove nothing
 * broke" discipline as every prior cut.
 */

const express = require('express');
const { exportAll } = require('../export');
const { sniffDialect, pznSourceToBlocks, toPznSource } = require('../pzn-source');

const router = express.Router();

/** Read a page's canonical .pzn source. ?kind=draft|published (default draft). */
router.get('/admin/api/pzn/source', (req, res) => {
  try {
    const fullPath = String(req.query.fullPath || '');
    const kind = req.query.kind === 'published' ? 'published' : 'draft';
    if (!fullPath) return res.status(400).json({ ok: false, error: 'fullPath required' });
    const { getPageSource } = require('../pages');
    const source = getPageSource(fullPath, kind);
    if (source == null) return res.status(404).json({ ok: false, error: 'Page not found' });
    res.json({ ok: true, fullPath, kind, source });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * Save raw .pzn source as the page draft (publish: true also publishes).
 * v2.20: `loose` is accepted for compatibility but no longer needed — every
 * paste is extracted (fences, chat, <html> brackets) and a keyword-dialect
 * reply ("BENTML 0.2") is compiled to .pzn before the strict save runs.
 */
router.post('/admin/api/pzn/source', (req, res) => {
  let ex = null;
  try {
    const { fullPath, publish } = req.body || {};
    let { source } = req.body || {};
    if (!fullPath || typeof source !== 'string') {
      return res.status(400).json({ ok: false, error: 'fullPath and source required' });
    }
    ex = toPznSource(source); // a broken keyword document throws line + fix
    source = ex.source;
    // v2.39: the paste flow marks a model's reply (from:'ai'); the owner's own
    // source editor does not, and its raw HTML stays exactly as written
    let scrubbed = 0;
    if ((req.body || {}).from === 'ai') {
      const g = require('../ai-html-guard').scrubAiSource(source);
      source = g.source;
      scrubbed = g.scrubbed;
    }
    const { savePageSource } = require('../pages');
    const result = savePageSource(fullPath, source, { publish: !!publish, meta: ex.page && ex.page.meta });
    if (publish) exportAll(); // publish from the paste flow means LIVE now
    res.json({ ok: true, fullPath, blocks: result.blocks, warnings: result.warnings, dialect: ex.dialect, extracted: ex.extracted, scrubbed,
      notice: scrubbed ? require('../ai-html-guard').scrubNotice(scrubbed) : '' });
  } catch (e) {
    // Strict save failed — compute an auto-correction the user can apply with
    // one click (v0.49 "auto-correct, then you apply"). No save happens here.
    let repairInfo = {};
    try {
      const src = ex ? ex.source : (req.body || {}).source;
      const { repair } = require('../pzn/repair');
      const r = repair(src);
      if (r.ok && !r.remaining.length && r.changes.length) {
        repairInfo = { repairable: true, repairedSource: r.source, changes: r.changes };
      }
    } catch (_) { /* repair is best-effort */ }
    res.status(400).json({
      ok: false,
      error: e.message,
      code: e.code || 'E_PZN',
      line: e.line,
      column: e.column,
      fix: e.fix,
      issues: e.issues,
      ...repairInfo
    });
  }
});

/**
 * Decompile (v0.57): any HTML page or live URL → a draft Tapuz page + a
 * toolGap report (the vocabulary engine — see src/pzn/decompile.js). The
 * toolGap counts are aggregated into config/tool-gap.json: the running
 * backlog of modules real pages keep asking for.
 */
function recordToolGap(toolGap) {
  try {
    if (!Array.isArray(toolGap) || !toolGap.length) return;
    const fs = require('fs');
    const path = require('path');
    const { CONFIG_DIR } = require('../paths');
    const file = path.join(CONFIG_DIR, 'tool-gap.json');
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* fresh */ }
    for (const t of toolGap) data[t] = (data[t] || 0) + 1;
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { /* the report must never fail the decompile */ }
}

router.post('/admin/api/pzn/decompile', async (req, res) => {
  try {
    const { url, html, title, slug, create, assets } = req.body || {};
    const { decompileHtml, decompileUrl, keywordBentml } = require('../pzn/decompile');
    let r;
    if (url && String(url).trim()) {
      r = await decompileUrl(String(url).trim(), { title, slug });
    } else if (typeof html === 'string' && html.trim()) {
      if (sniffDialect(html) !== 'unknown') {
        // the paste is already BenTML (an AI reply — either dialect, with or
        // without a fence and chat around it) — the HTML decompiler would
        // shred bent-* tags into provisional blobs (v0.69). Route it through
        // the forgiving import instead; same draft-creating flow.
        const pznApi = require('../pzn/index');
        const { deriveSlug } = require('../pzn/intent');
        const { view, repaired } = pznSourceToBlocks(html);
        const pageTitle = (title || '').trim() || view.title || 'דף מיובא';
        const pageSlug = deriveSlug((slug || '').trim() || pageTitle);
        const doc2 = pznApi.fromTapuzPage({
          title: pageTitle, slug: pageSlug, lang: view.lang || 'he',
          direction: view.direction || 'rtl', tags: view.tags || [], meta: view.meta || {}, blocks: view.blocks
        });
        r = {
          source: pznApi.serialize(doc2),
          blocks: view.blocks,
          mapped: view.blocks.length,
          leftover: 0,
          toolGap: [],
          issues: [],
          meta: { title: pageTitle, slug: pageSlug, lang: view.lang || 'he', dir: view.direction || 'rtl' },
          strategy: repaired ? 'bentml-repaired' : 'bentml',
          strategies: []
        };
        r.bentml = keywordBentml(r.meta, r.blocks);
      } else {
        r = decompileHtml(html, { title, slug });
      }
    } else {
      return res.status(400).json({ ok: false, error: 'url or html required' });
    }
    recordToolGap(r.toolGap);

    // v0.67: make the pictures OURS — download every remote image the blocks
    // reference, convert to webp, host under /assets/imported/<slug>/, and
    // rewrite the blocks to local paths. On by default; assets:false skips.
    let assetsReport = null;
    if (assets !== false) {
      try {
        const { ingestBlockImages } = require('../media-ingest');
        assetsReport = await ingestBlockImages(r.blocks, { folder: 'imported/' + r.meta.slug });
        if (assetsReport.saved) {
          const pznApi = require('../pzn');
          const doc = pznApi.fromTapuzPage({
            title: r.meta.title, slug: r.meta.slug, lang: r.meta.lang,
            direction: r.meta.dir, tags: [], meta: {}, blocks: r.blocks
          });
          r.source = pznApi.serialize(doc);
          r.bentml = keywordBentml(r.meta, r.blocks);
        }
      } catch (e) {
        assetsReport = { found: 0, saved: 0, failed: [{ url: '*', reason: e.message }], skipped: 0 };
      }
    }
    if (!r.bentml) r.bentml = keywordBentml(r.meta, r.blocks);

    let fullPath = null;
    if (create) {
      const { createPage, getPageByFullPath, savePageSource } = require('../pages');
      // never clobber — suffix until free (same rule as /admin/create)
      let candidate = r.meta.slug;
      for (let n = 2; getPageByFullPath(candidate); n++) candidate = r.meta.slug + '-' + n;
      createPage({ title: r.meta.title, slug: candidate, blocks: [] });
      try {
        savePageSource(candidate, r.source, { publish: false });
      } catch (strictErr) {
        savePageSource(candidate, r.source, { publish: false, repair: true });
      }
      fullPath = candidate;
    }
    res.json({
      ok: true,
      fullPath,
      source: r.source,
      bentml: r.bentml || '',
      blocks: r.blocks.length,
      mapped: r.mapped,
      leftover: r.leftover,
      toolGap: r.toolGap,
      fromUrl: r.fromUrl || null,
      meta: r.meta,
      // v0.66 safety guard: which read won, and every strategy's score
      strategy: r.strategy,
      strategies: r.strategies,
      // v0.67: the image-ingestion report (null when assets:false)
      assets: assetsReport
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** Apply builder-standard AST ops to the page draft. */
router.post('/admin/api/pzn/ops', (req, res) => {
  try {
    const { fullPath, ops, publish } = req.body || {};
    if (!fullPath || !Array.isArray(ops)) {
      return res.status(400).json({ ok: false, error: 'fullPath and ops[] required' });
    }
    const { applyPageOps } = require('../pages');
    const result = applyPageOps(fullPath, ops, { publish: !!publish });
    res.json({ ok: true, fullPath, blocks: result.blocks, source: result.source, warnings: result.warnings });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_OPS' });
  }
});

/**
 * Create a brand-new page from pasted .pzn (the "bot invented a page" flow):
 * extract → validate → slug from bent-slug (or title) → create → save source.
 */
router.post('/admin/api/pzn/create-from-source', (req, res) => {
  try {
    const { publish } = req.body || {};
    let { source } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    // v2.20: take only the BenTML — fence, chat, <html> brackets gone — and
    // accept BOTH dialects (a "BENTML 0.2" reply is compiled to .pzn here)
    const ex = toPznSource(source);
    // v2.39: this door takes a MODEL's reply (the chat's button, the paste
    // flow) — raw HTML loses its script before anything is saved or published
    const guard = require('../ai-html-guard').scrubAiSource(ex.source);
    source = guard.source;
    const pznApi = require('../pzn/index');
    // repair-first (v2.19.1): this is the route the copilot chat's "צור דף"
    // calls, and it was the ONE create path with no forgiveness — a model
    // writing <b> instead of @B{} got a hard 'Raw HTML' failure here while
    // the agent bridge repaired the same document happily. Same contract as
    // the bridge now: imperfect input becomes a clean DRAFT + a change list.
    let doc;
    let repaired = false;
    let changes = [];
    try {
      doc = pznApi.parse(source);
      const errors = pznApi.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
      if (errors.length) { const err = new Error('invalid'); err.issues = errors; throw err; }
    } catch (parseErr) {
      const { repair } = require('../pzn/repair');
      const r = repair(source);
      if (!r.ok || r.remaining.length) {
        return res.status(400).json({
          ok: false,
          error: r.error || (r.remaining || []).map((e) => `${e.code}: ${e.message}`).join('; ') || parseErr.message,
          issues: r.remaining || parseErr.issues || []
        });
      }
      source = r.source;
      doc = pznApi.parse(source);
      repaired = true;
      changes = r.changes;
    }
    require('../pzn-repair-stats').record({ changes, repaired });
    // an EMPTY document must never become a page a reader meets — this is how
    // a pristine paste-template (title "כותרת הדף", zero modules) once got
    // PUBLISHED with its placeholder as the visible title (v0.72 fix).
    if (!pznApi.toTapuzPage(doc).blocks.length) {
      return res.status(400).json({ ok: false, error: 'הדף ריק — נראה שהודבקה התבנית לדוגמה במקום תשובת הבוט. הדביקו את התשובה המלאה (עם מודולי bent-*).' });
    }
    const title = doc.title || 'דף חדש';
    // deriveSlug hardens against path traversal (backslash / '..').
    const { deriveSlug } = require('../pzn/intent');
    const slug = deriveSlug((doc.slug || '').trim() || title);
    const { createPage, getPageByFullPath, savePageSource } = require('../pages');
    if (getPageByFullPath(slug)) {
      return res.status(409).json({ ok: false, error: `דף בשם "${slug}" כבר קיים — בחר אותו ברשימה או שנה את ה-slug במקור` });
    }
    createPage({ title, slug, blocks: [] });
    // a repaired document never auto-publishes — the owner reviews the fixes
    const doPublish = !!publish && !repaired;
    const result = savePageSource(slug, source, { publish: doPublish, meta: ex.page && ex.page.meta });
    if (doPublish) exportAll(); // publish from the paste flow means LIVE now
    res.json({
      ok: true, fullPath: slug, created: true, blocks: result.blocks,
      warnings: result.warnings, repaired, changes, published: doPublish,
      dialect: ex.dialect, extracted: ex.extracted, scrubbed: guard.scrubbed,
      notice: guard.scrubbed ? require('../ai-html-guard').scrubNotice(guard.scrubbed) : ''
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_PZN', line: e.line, column: e.column, fix: e.fix });
  }
});

module.exports = router;
