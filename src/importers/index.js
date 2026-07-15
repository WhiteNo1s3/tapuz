'use strict';

/**
 * Export-file importer — the "build straight from the export" system, distinct
 * from the HTML reverse-engineer decompiler. A registry of per-vendor adapters
 * (WordPress today; Builder.io / HubSpot / Camilyo / Mobeart next) each turn a
 * vendor export into normalized pages ({title, slug, blocks}); this layer then
 * serializes each to a .pzn source, so the caller creates pages exactly like
 * the decompile route does (createPage → savePageSource, caller owns collisions).
 */

const pzn = require('../pzn/index');

// ── adapter registry ────────────────────────────────────────────────────────
// Each: { id, label, detect(content, filename) => bool, toPages(content) => [{title,slug,blocks}] }
const ADAPTERS = [
  {
    id: 'wordpress',
    label: 'WordPress / Elementor (WXR)',
    detect: (c, f) =>
      /\.(xml|wxr)$/i.test(f || '') && /<rss[\s>]|<wp:|xmlns:wp=/.test(c) ||
      /<wp:post_type>|<!--\s*wp:/.test(c || ''),
    toPages: (c) => require('./wordpress').wordpressToPages(c)
  }
];

/** Which adapter (if any) claims this file. */
function detectFormat(content, filename) {
  const a = ADAPTERS.find((x) => { try { return x.detect(content || '', filename || ''); } catch (e) { return false; } });
  return a ? a.id : null;
}

function slugify(raw, fallback) {
  const s = String(raw || '').trim().toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^\w֐-׿-]+/g, '-') // keep word chars + Hebrew, else hyphen
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 80);
  return s || fallback;
}

/** blocks → validated .pzn source (RTL Tapuz page). */
function blocksToSource(title, slug, blocks) {
  const page = { title, slug, direction: 'rtl', tags: [], meta: {}, blocks };
  const doc = pzn.fromTapuzPage(page);
  const source = pzn.serialize(doc);
  const errors = pzn.validate(pzn.parse(source), { strict: false }).filter((i) => i.severity === 'error');
  return { source, valid: errors.length === 0 };
}

/**
 * Import an export file's raw content into ready-to-create .pzn pages.
 * @param {string} content  the export file body
 * @param {{filename?:string, format?:string}} opts
 * @returns {{format:string, pages:{title,slug,source,blocks,valid}[]}}
 */
function importFile(content, opts = {}) {
  const format = opts.format || detectFormat(content, opts.filename);
  if (!format) throw new Error('unrecognized export format');
  const adapter = ADAPTERS.find((a) => a.id === format);
  if (!adapter) throw new Error(`no adapter for "${format}"`);

  const pages = [];
  adapter.toPages(content).forEach((p, i) => {
    if (!p.blocks || !p.blocks.length) return; // empty page — nothing to build
    const slug = slugify(p.slug || p.title, 'page-' + (i + 1));
    const { source, valid } = blocksToSource(p.title || 'ללא כותרת', slug, p.blocks);
    pages.push({ title: p.title || 'ללא כותרת', slug, source, blocks: p.blocks.length, valid });
  });
  return { format, pages };
}

module.exports = { importFile, detectFormat, slugify, ADAPTERS };
