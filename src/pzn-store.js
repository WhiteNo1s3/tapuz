'use strict';

/**
 * pzn-store — the canonical page-file layer (v0.41 storage flip).
 *
 * The page's CONTENT truth lives in a .pzn file, not in the database:
 *   pages/drafts/<full_path>.pzn      — working copy (save writes here)
 *   pages/published/<full_path>.pzn   — published snapshot (publish writes here)
 *
 * The DB keeps every column it had — as an index/cache. Readers overlay
 * blocks from the file when it exists and fall back to DB JSON when it
 * doesn't (legacy sites keep working; run scripts/migrate-pzn-store.js
 * to backfill files).
 *
 * v0.41 scope: blocks + core meta (title/slug/tags/teaser/cardImage/dir)
 * are written to the file; status/theme/extended meta (e.g. redirect)
 * remain DB-owned until the .pzn head covers them.
 */

const fs = require('fs');
const path = require('path');
const { PAGES_DIR } = require('./paths');
const { fromTapuzPage, toTapuzPage, serialize, parse } = require('./pzn/index');

const DRAFTS_DIR = path.join(PAGES_DIR, 'drafts');
const PUBLISHED_DIR = path.join(PAGES_DIR, 'published');

/**
 * Sanitize a full_path into a single safe filename component. Strips path
 * separators (incl. BACKSLASH — critical on Windows), collapses '..', and
 * drops leading dots so a crafted slug can never escape the pages directory.
 * (v0.45 hardening — the agent bridge accepts bot-authored slugs.)
 */
function safeName(full_path) {
  return String(full_path || 'page')
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    || 'page';
}

/**
 * @param {string} full_path
 * @param {'draft'|'published'} kind
 */
function pznPathFor(full_path, kind = 'draft') {
  const dir = kind === 'published' ? PUBLISHED_DIR : DRAFTS_DIR;
  const file = path.resolve(dir, safeName(full_path) + '.pzn');
  // defense in depth: the resolved path MUST stay inside its pages dir
  const root = path.resolve(dir) + path.sep;
  if (file !== path.resolve(dir) && !file.startsWith(root)) {
    throw new Error('pzn-store: refusing path outside pages dir: ' + full_path);
  }
  return file;
}

/**
 * Serialize a page's blocks (plus core meta) to canonical .pzn text.
 * @param {object} page   { title, full_path, direction, tags, meta }
 * @param {object[]} blocks
 */
function pageToPzn(page, blocks) {
  const doc = fromTapuzPage({
    title: page.title || '',
    slug: page.full_path || page.slug || '',
    direction: page.direction || 'rtl',
    lang: page.lang || 'he',
    tags: Array.isArray(page.tags) ? page.tags : [],
    meta: page.meta || {},
    blocks: blocks || []
  });
  return serialize(doc);
}

/**
 * Write the canonical file. Returns the file path.
 * @param {object} page
 * @param {object[]} blocks
 * @param {'draft'|'published'} kind
 */
function writePagePzn(page, blocks, kind = 'draft') {
  const file = pznPathFor(page.full_path, kind);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pageToPzn(page, blocks), 'utf8');
  return file;
}

/**
 * Read blocks from the canonical file.
 * @param {string} full_path
 * @param {'draft'|'published'} kind
 * @returns {object[]|null} blocks, or null when the file is missing/corrupt
 *          (caller falls back to the DB index)
 */
function readPageBlocks(full_path, kind = 'draft') {
  const file = pznPathFor(full_path, kind);
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return null; // no file — legacy page, DB is the source
  }
  try {
    const doc = parse(src);
    return toTapuzPage(doc).blocks;
  } catch (e) {
    console.warn(`pzn-store: cannot parse ${file} (${e.message}) — falling back to DB`);
    return null;
  }
}

/** Read the raw .pzn source (null when missing). */
function readPageSource(full_path, kind = 'draft') {
  try {
    return fs.readFileSync(pznPathFor(full_path, kind), 'utf8');
  } catch {
    return null;
  }
}

/** Remove a page's files (both kinds). */
function removePagePzn(full_path) {
  for (const kind of ['draft', 'published']) {
    try {
      fs.rmSync(pznPathFor(full_path, kind), { force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Rename a page's files when full_path changes. */
function renamePagePzn(oldPath, newPath) {
  if (safeName(oldPath) === safeName(newPath)) return;
  for (const kind of ['draft', 'published']) {
    const from = pznPathFor(oldPath, kind);
    const to = pznPathFor(newPath, kind);
    try {
      if (fs.existsSync(from)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
      }
    } catch {
      /* best effort; next save rewrites */
    }
  }
}

module.exports = {
  PAGES_DIR,
  DRAFTS_DIR,
  PUBLISHED_DIR,
  safeName,
  pznPathFor,
  pageToPzn,
  writePagePzn,
  readPageBlocks,
  readPageSource,
  removePagePzn,
  renamePagePzn
};
