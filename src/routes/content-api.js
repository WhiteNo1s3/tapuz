'use strict';

/**
 * Content read/history API — the sixteenth route-group extraction. The
 * read-only page/article listings the builder's navigator + article cubes
 * pull, plus the revision history list and restore. All four are page-DATA
 * reads (and one restore) that share `src/pages.js` as their only
 * dependency — grouped by data concern, not by URL prefix. The page-
 * MUTATING routes (create/save/publish/delete) stay in server.js; those
 * are a heavier, higher-risk cut for their own pass.
 */

const express = require('express');
const { listPages, listArticles, listRevisions, restoreRevision } = require('../pages');

const router = express.Router();

/** Page navigator: all pages, optional ?q= search + ?status= filter. */
router.get('/admin/api/pages', (req, res) => {
  try {
    res.json({ ok: true, pages: listPages({ q: req.query.q, status: req.query.status }) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Article cubes: published pages carrying a tag (default "article"). */
router.get('/admin/api/articles', (req, res) => {
  try {
    const { tag, limit } = req.query;
    res.json({ ok: true, articles: listArticles({ tag: tag || 'article', limit: limit || 12 }) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Revision history for one page (the backups list). */
router.get('/admin/api/revisions/:fullPath', (req, res) => {
  try {
    const fullPath = decodeURIComponent(req.params.fullPath);
    res.json({ ok: true, revisions: listRevisions(fullPath) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Restore a page's draft from a saved revision. */
router.post('/admin/api/revisions/restore', (req, res) => {
  try {
    const { full_path, revision_id } = req.body || {};
    const page = restoreRevision(full_path, revision_id);
    res.json({ ok: true, page: { full_path: page.full_path, title: page.title, status: page.status, blocks: page.draft_blocks } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
