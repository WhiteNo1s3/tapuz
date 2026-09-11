'use strict';

/**
 * BenTML language API — the twenty-eighth route-group extraction: the
 * doc/primer endpoints (primer, chat-snippet, agent-pack) and the language
 * OPERATIONS the advanced code tab runs — compile / preview / decompile /
 * apply (BenTML source <-> page-builder blocks). Cohesive: this is the
 * ".pzn / BenTML is our RPM" surface. Deliberately NOT included: the two
 * /admin/api/syntax-dictionary routes that sit between modules and primer
 * in server.js — they are entangled in the v1.19 shadowed-route bug that
 * is awaiting a product decision, so they stay put, untouched.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const bentml = require('../bentml');
const { extractBentml, pznSourceToBlocks } = require('../pzn-source');
const { getPageByFullPath, updatePage, publishPage } = require('../pages');

const router = express.Router();

/** Full agent primer = cheatsheet (the language, not a block list). */
router.get('/admin/api/bentml/primer', (req, res) => {
  try {
    const sheetPath = path.join(__dirname, '..', '..', 'docs', 'bentml-cheatsheet.md');
    const packPath = path.join(__dirname, '..', '..', 'docs', 'agent-free-tier-pack.md');
    const cheatsheet = fs.existsSync(sheetPath)
      ? fs.readFileSync(sheetPath, 'utf8')
      : 'See docs/bentml-v0.md';
    const freeTierPack = fs.existsSync(packPath)
      ? fs.readFileSync(packPath, 'utf8')
      : cheatsheet;
    res.json({
      ok: true,
      version: '0.1',
      language: 'bentml',
      forAgents: ['grok', 'chatgpt', 'gemini', 'claude', 'free-tier'],
      shape: {
        file: 'BENTML 0.1 → META {…} → body keywords',
        module: 'KEYWORD(params) { body } | KEYWORD(params)',
        metadata: 'META { key: value } — page level',
        text: '{ body } on TEXT-BODY keywords',
        style: 'page-builder Style panel + optional class: — NOT a STYLE{ } block',
        pipeline: 'agent writes BenTML → compile → page builder modules → publish'
      },
      primer: freeTierPack,
      freeTierPack,
      cheatsheet
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Paste-into-blank-chat mission (preferred product path). */
router.get('/admin/api/bentml/chat-snippet', (req, res) => {
  try {
    const jsonPath = path.join(__dirname, '..', '..', 'public', 'chat-snippet.json');
    if (fs.existsSync(jsonPath)) {
      return res.json(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    }
    const txtPath = path.join(__dirname, '..', '..', 'public', 'chat-snippet.txt');
    const pasteBody = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : '';
    res.json({ version: '0.1', pasteBody, notApi: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Legacy alias */
router.get('/admin/api/bentml/agent-pack', (req, res) => {
  res.redirect(302, '/chat-snippet.txt');
});

router.post('/admin/api/bentml/compile', (req, res) => {
  let ex = null;
  try {
    const source = req.body && req.body.source;
    if (typeof source !== 'string') {
      return res.status(400).json({ error: 'source (BenTML string) required' });
    }
    // the advanced tab accepts BOTH dialects (v0.69): an AI primed with the
    // dictionary answers in <bent-*> .pzn — pasting that here used to be
    // rejected by the keyword compiler ("does not accept the code").
    // v2.20: take only the BenTML first — fence, chat, <html> brackets around
    // the keyword dialect, the echoed empty template — THEN route by dialect.
    ex = extractBentml(source);
    if (ex.dialect === 'pzn') {
      const { view, repaired, changes } = pznSourceToBlocks(ex.source);
      return res.json({
        ok: true,
        page: { title: view.title },
        blocks: view.blocks,
        warnings: repaired ? changes.map((c) => String(c && c.message || c)) : [],
        dialect: 'pzn',
        repaired,
        extracted: ex.changes,
        lineOffset: ex.lineOffset
      });
    }
    const result = bentml.compile(ex.found ? ex.source : source);
    res.json({
      ok: true,
      page: result.page,
      blocks: result.blocks,
      warnings: result.warnings,
      dialect: 'line',
      extracted: ex.changes,
      lineOffset: ex.lineOffset
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e.message,
      code: e.code || 'E_BENTML',
      // error lines are relative to the extracted document — map them back
      // onto the text the caller actually sent
      line: e.line != null && ex && ex.found ? e.line + (ex.lineOffset || 0) : e.line,
      column: e.column,
      fix: e.fix,
      issues: e.issues
    });
  }
});

router.post('/admin/api/bentml/preview', (req, res) => {
  try {
    const source = req.body && req.body.source;
    if (typeof source !== 'string') {
      return res.status(400).json({ error: 'source (BenTML string) required' });
    }
    // v2.20: both dialects, extracted first
    const ex = extractBentml(source);
    if (ex.dialect === 'pzn') {
      const { view, repaired, changes } = pznSourceToBlocks(ex.source);
      const { renderPage } = require('../renderer');
      const html = renderPage({
        title: view.title, direction: view.direction, theme: 'default', blocks: view.blocks,
        status: 'draft', tags: view.tags, meta: view.meta, full_path: view.slug || 'preview'
      });
      return res.json({
        ok: true,
        page: { title: view.title, slug: view.slug, direction: view.direction },
        blocks: view.blocks,
        warnings: repaired ? changes.map((c) => String(c && c.message || c)) : [],
        html,
        dialect: 'pzn',
        extracted: ex.changes
      });
    }
    const result = bentml.preview(ex.found ? ex.source : source);
    res.json({
      ok: true,
      page: result.page,
      blocks: result.blocks,
      warnings: result.warnings,
      html: result.html,
      dialect: 'line',
      extracted: ex.changes
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e.message,
      code: e.code || 'E_BENTML',
      line: e.line,
      fix: e.fix
    });
  }
});

router.post('/admin/api/bentml/decompile', (req, res) => {
  try {
    const page = (req.body && req.body.page) || {};
    const blocks = (req.body && req.body.blocks) || [];
    const source = bentml.decompile(page, blocks);
    res.json({ ok: true, source });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

/** Apply BenTML source onto a page draft (wires language → page builder storage). */
router.post('/admin/api/bentml/apply', (req, res) => {
  try {
    const { fullPath, source, publish } = req.body || {};
    if (!fullPath || typeof source !== 'string') {
      return res.status(400).json({ error: 'fullPath and source required' });
    }
    const { updatePage, getPageByFullPath, publishPage } = require('../pages');
    const existing = getPageByFullPath(fullPath);
    if (!existing) return res.status(404).json({ error: 'Page not found' });

    // v2.20: both dialects, extracted first
    const ex = extractBentml(source);
    let result;
    if (ex.dialect === 'pzn') {
      const { view, repaired, changes } = pznSourceToBlocks(ex.source);
      result = {
        page: { title: view.title, direction: view.direction, tags: view.tags, meta: view.meta || {} },
        blocks: view.blocks,
        warnings: repaired ? changes.map((c) => String(c && c.message || c)) : []
      };
    } else {
      result = bentml.compile(ex.found ? ex.source : source);
    }
    const patch = {
      title: result.page.title,
      direction: result.page.direction,
      tags: result.page.tags,
      meta: { ...(existing.meta || {}), ...(result.page.meta || {}) },
      draft_blocks: result.blocks
    };
    if (result.page.theme) patch.theme = result.page.theme;
    updatePage(fullPath, patch);
    if (publish) {
      // publishPage copies draft → published when available
      if (typeof publishPage === 'function') publishPage(fullPath);
      else updatePage(fullPath, { blocks: result.blocks, status: 'published' });
    }
    res.json({
      ok: true,
      fullPath,
      blocks: result.blocks,
      page: result.page,
      warnings: result.warnings,
      dialect: ex.dialect,
      extracted: ex.changes
    });
  } catch (e) {
    res.status(400).json({
      ok: false,
      error: e.message,
      code: e.code || 'E_BENTML',
      line: e.line,
      fix: e.fix
    });
  }
});

module.exports = router;
