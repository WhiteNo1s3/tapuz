'use strict';

/**
 * BenTML — The Tapuz page language
 * Spec: docs/bentml-v0.md · Cheat sheet: docs/bentml-cheatsheet.md
 *
 * compile(source)   → { page, blocks, warnings }  // → JSON model page builder uses
 * decompile(page, blocks) → source                // → canonical BenTML
 * preview(source)   → { page, blocks, html, warnings }
 */

const { parse, deriveSlug } = require('./parse');
const { compile, compileAndRender } = require('./compile');
const { decompile } = require('./decompile');
const { extractBentml, sniffDialect } = require('./extract');
const { BentmlError } = require('./errors');
const { KEYWORDS, getKeyword } = require('./keywords');
const { renderPage } = require('../renderer');

/**
 * Full preview path: BenTML → JSON blocks → existing renderer HTML.
 * This is what the page builder source panel should call.
 * @param {string} source
 */
function preview(source) {
  return compileAndRender(source, (page) =>
    renderPage({
      ...page,
      full_path: page.slug || 'preview',
      blocks: page.blocks
    })
  );
}

// fix compileAndRender — renderPage expects blocks on page object
function previewFixed(source) {
  const { page, blocks, warnings } = compile(source);
  const html = renderPage({
    title: page.title,
    direction: page.direction,
    theme: page.theme || 'default',
    blocks,
    status: page.status,
    tags: page.tags,
    meta: page.meta,
    full_path: page.slug || 'preview'
  });
  return { page, blocks, warnings, html };
}

/**
 * Module catalog for agents/builder — keyword → JSON type.
 */
function listModules() {
  return Object.entries(KEYWORDS)
    .filter(([k, def]) => k !== 'META' && k !== 'HTML' && !def.decompileOnly)
    .map(([name, def]) => ({
      keyword: name,
      body: def.body,
      jsonType: def.jsonType || null,
      childOnly: !!def.childOnly,
      parent: def.parent || null,
      params: def.params || {}
    }));
}

module.exports = {
  parse,
  compile,
  decompile,
  // v2.20: take only the BenTML out of a model's reply (both dialects)
  extract: extractBentml,
  sniffDialect,
  preview: previewFixed,
  deriveSlug,
  BentmlError,
  listModules,
  getKeyword,
  KEYWORDS
};
