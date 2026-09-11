'use strict';

/**
 * pzn/BenTML stateless tools — the first sub-concern split out of the
 * page-builder/pzn API surface (v1.13, docs/ARCHITECTURE.md: "the largest,
 * most interconnected block... probably split by sub-concern rather than
 * moved wholesale"). Every route here compiles/validates/transforms
 * BenTML source WITHOUT touching a page file on disk — repair previews,
 * graduating provisional HTML, the in-builder AI-import bridge, the
 * toolbox schema dump, the paste-into-any-AI primer, and compile-only
 * preview HTML. The routes that actually create/mutate pages (`source`,
 * `decompile`, `create-from-source`, `ops`) stay in server.js for now —
 * a deliberately separate, later cut.
 */

const express = require('express');
const { pznSourceToBlocks, toPznSource } = require('../pzn-source');

const router = express.Router();

/**
 * Dry-run repair — return a corrected .pzn + the change list WITHOUT saving.
 * The admin UI calls this to preview "apply the fix" (v0.49).
 */
router.post('/admin/api/pzn/repair', (req, res) => {
  try {
    let { source } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    // v2.20: always extract (`loose` accepted, no longer needed); a keyword
    // document is compiled to .pzn first — a broken one answers line + fix
    source = toPznSource(source).source;
    const { repair } = require('../pzn/repair');
    const r = repair(source);
    res.json({
      ok: r.ok,
      repairedSource: r.source || '',
      changes: r.changes,
      remaining: r.remaining,
      error: r.error
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code, line: e.line, fix: e.fix });
  }
});

/**
 * Graduate (v0.51): convert a provisional bent-html block's raw HTML into real,
 * visually-editable Tapuz modules. Best-effort — unmappable bits stay in a
 * smaller html block so nothing is lost. The builder splices the result in
 * place of the html block; the admin approves it.
 */
router.post('/admin/api/pzn/graduate', (req, res) => {
  try {
    const content = (req.body || {}).content;
    if (typeof content !== 'string') {
      return res.status(400).json({ ok: false, error: 'content required' });
    }
    const { htmlToBlocks } = require('../pzn/graduate');
    const r = htmlToBlocks(content);
    res.json({ ok: true, blocks: r.blocks, mapped: r.mapped, leftover: r.leftover });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/**
 * Import BenTML → blocks (v0.53): the in-builder bridge. Takes an LLM's reply
 * (BenTML, possibly wrapped in prose/fences), extracts + FORGIVINGLY compiles
 * it to Tapuz blocks WITHOUT saving — the builder applies them (replace/append)
 * and the admin publishes when ready. Reuses the repair pipeline so imperfect
 * agent output still lands.
 */
router.post('/admin/api/pzn/to-blocks', (req, res) => {
  try {
    const { source } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    const { view, repaired, changes, dialect, extracted } = pznSourceToBlocks(source);
    res.json({ ok: true, blocks: view.blocks, title: view.title, repaired, changes, dialect, extracted });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, issues: e.issues, code: e.code, line: e.line, fix: e.fix });
  }
});

router.get('/admin/api/pzn/toolbox', (req, res) => {
  try {
    const pznApi = require('../pzn/index');
    res.json({ ok: true, toolbox: pznApi.getToolbox(), schemas: pznApi.getAllSchemas() });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** The paste-into-any-AI primer, generated live from the registry. */
router.get('/admin/api/pzn/primer', (req, res) => {
  try {
    const { buildPznPrimer } = require('../pzn/agent-primer');
    res.type('text/markdown; charset=utf-8').send(buildPznPrimer());
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** Compile pasted source to preview HTML without saving. Always extracts first (v2.20). */
router.post('/admin/api/pzn/preview', (req, res) => {
  try {
    let { source } = req.body || {};
    if (typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({ ok: false, error: 'source required' });
    }
    // the extractor is the identity on a clean document, so the old
    // loose:false strict preview is unchanged; a keyword document is compiled
    source = toPznSource(source).source;
    const pznApi = require('../pzn/index');
    const doc = pznApi.parse(source);
    const issues = pznApi.validate(doc, { strict: false });
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      return res.status(400).json({
        ok: false,
        error: errors.map((e) => `${e.code}: ${e.message}`).join('; '),
        issues: errors
      });
    }
    const { listArticles } = require('../pages');
    let articles = [];
    try { articles = listArticles({ limit: 12 }); } catch (e) { /* fresh DB */ }
    const html = pznApi.buildPreviewHtml(doc, { articles });
    res.json({
      ok: true,
      html,
      source,
      title: doc.title,
      warnings: issues.filter((i) => i.severity === 'warning')
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message, code: e.code || 'E_PZN', line: e.line, column: e.column, fix: e.fix });
  }
});

module.exports = router;
