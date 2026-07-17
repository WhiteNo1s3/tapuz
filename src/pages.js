const { db } = require('./db');
const { addRevision, listRevisions, getRevision } = require('./revisions');
const store = require('./pzn-store');

/** Strip path-dangerous chars so a full_path can never traverse directories. */
function sanitizeFullPath(fp) {
  return String(fp || 'page')
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|#]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    || 'page';
}

function generateFullPath(pathPrefix, slug) {
  const prefix = pathPrefix ? pathPrefix.replace(/-$/, '') + '-' : '';
  return sanitizeFullPath(prefix + slug);
}

/**
 * v0.41 storage flip: the .pzn file is the canonical source of a page's
 * CONTENT. When pages/drafts|published/<full_path>.pzn exists it overrides
 * the DB's JSON columns (which remain as index/fallback for legacy sites).
 */
function parsePageRow(row) {
  if (!row) return null;
  let publishedBlocks;
  try {
    publishedBlocks = JSON.parse(row.blocks || '[]');
  } catch (e) {
    publishedBlocks = [];
  }
  let draftBlocks;
  try {
    draftBlocks = row.draft_blocks != null
      ? JSON.parse(row.draft_blocks || '[]')
      : publishedBlocks;
  } catch (e) {
    draftBlocks = publishedBlocks;
  }

  // file-first overlay — the .pzn file wins when present
  const fileDraft = store.readPageBlocks(row.full_path, 'draft');
  if (fileDraft) draftBlocks = fileDraft;
  const filePublished = store.readPageBlocks(row.full_path, 'published');
  if (filePublished) publishedBlocks = filePublished;

  return {
    ...row,
    blocks: publishedBlocks,
    draft_blocks: draftBlocks,
    tags: JSON.parse(row.tags || '[]'),
    meta: JSON.parse(row.meta || '{}')
  };
}

function createPage({
  title,
  slug,
  path_prefix = '',
  direction = 'rtl',
  blocks = [],
  tags = [],
  meta = {},
  status = 'draft'
}) {
  const full_path = generateFullPath(path_prefix, slug);
  const blocksJson = JSON.stringify(blocks);
  // New pages: draft holds content; published blocks only if status is published
  const publishedJson = status === 'published' ? blocksJson : '[]';
  const draftJson = blocksJson;

  const stmt = db.prepare(`
    INSERT INTO pages (path_prefix, slug, full_path, title, direction, blocks, draft_blocks, tags, meta, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    path_prefix,
    slug,
    full_path,
    title,
    direction,
    publishedJson,
    draftJson,
    JSON.stringify(tags),
    JSON.stringify(meta),
    status || 'draft'
  );

  // canonical .pzn files (v0.41 storage flip)
  const pageLike = { title, full_path, direction, tags, meta };
  store.writePagePzn(pageLike, blocks, 'draft');
  if (status === 'published') store.writePagePzn(pageLike, blocks, 'published');

  addRevision({
    pageId: result.lastInsertRowid,
    fullPath: full_path,
    title,
    status: status || 'draft',
    kind: status === 'published' ? 'publish' : 'draft',
    blocks: blocks,
    pzn: store.pageToPzn(pageLike, blocks)
  });

  return {
    id: result.lastInsertRowid,
    full_path,
    title,
    slug
  };
}

/**
 * Save draft only — does not change published blocks.
 * Pass publish:true to copy draft → published and set status published.
 */
function updatePage(full_path, updates = {}) {
  const existing = getPageByFullPath(full_path);
  if (!existing) throw new Error('Page not found');

  const publish = !!updates.publish;
  delete updates.publish;
  const kind = updates.revisionKind || (publish ? 'publish' : 'draft');
  delete updates.revisionKind;

  const newData = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString()
  };

  // Regenerate full_path if prefix or slug changed
  if (updates.path_prefix !== undefined || updates.slug !== undefined) {
    const prefix = updates.path_prefix !== undefined ? updates.path_prefix : existing.path_prefix;
    const slug = updates.slug !== undefined ? updates.slug : existing.slug;
    newData.full_path = generateFullPath(prefix, slug);
  }

  // Blocks in API mean draft content when saving from builder
  let draftBlocks = existing.draft_blocks;
  if (updates.blocks !== undefined) {
    draftBlocks = updates.blocks;
  }
  if (updates.draft_blocks !== undefined) {
    draftBlocks = updates.draft_blocks;
  }

  let publishedBlocks = existing.blocks;
  let status = updates.status !== undefined ? updates.status : existing.status;

  if (publish) {
    publishedBlocks = draftBlocks;
    status = 'published';
  }

  if (updates.tags) newData.tags = updates.tags;
  if (updates.meta) newData.meta = updates.meta;

  const stmt = db.prepare(`
    UPDATE pages SET
      path_prefix = ?,
      slug = ?,
      full_path = ?,
      title = ?,
      direction = ?,
      theme = ?,
      blocks = ?,
      draft_blocks = ?,
      tags = ?,
      meta = ?,
      status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE full_path = ?
  `);

  stmt.run(
    newData.path_prefix || '',
    newData.slug,
    newData.full_path,
    newData.title,
    newData.direction || 'rtl',
    newData.theme || 'default',
    JSON.stringify(publishedBlocks || []),
    JSON.stringify(draftBlocks || []),
    JSON.stringify(newData.tags || []),
    JSON.stringify(newData.meta || {}),
    status || 'draft',
    full_path
  );

  // canonical .pzn files (v0.41 storage flip)
  if (newData.full_path !== full_path) {
    store.renamePagePzn(full_path, newData.full_path);
    // the homepage crown follows a slug rename (v0.78) — config.homepage must
    // never point at an address that no longer exists
    syncHomepageConfig(full_path, newData.full_path);
  }
  const pageLike = {
    title: newData.title,
    full_path: newData.full_path,
    direction: newData.direction || 'rtl',
    tags: newData.tags || [],
    meta: newData.meta || {}
  };
  store.writePagePzn(pageLike, draftBlocks || [], 'draft');
  if (publish) store.writePagePzn(pageLike, publishedBlocks || [], 'published');

  const saved = getPageByFullPath(newData.full_path);

  addRevision({
    pageId: saved.id,
    fullPath: saved.full_path,
    title: saved.title,
    status: saved.status,
    kind,
    blocks: draftBlocks,
    pzn: store.pageToPzn(pageLike, draftBlocks || [])
  });

  return saved;
}

function publishPage(full_path) {
  return updatePage(full_path, { publish: true });
}

function getPageByFullPath(full_path) {
  const row = db.prepare('SELECT * FROM pages WHERE full_path = ?').get(full_path);
  return parsePageRow(row);
}

function listPages({ q, status } = {}) {
  let sql = `
    SELECT id, full_path, title, status, direction, theme, updated_at, meta,
           CASE WHEN draft_blocks IS NOT NULL AND draft_blocks != blocks THEN 1 ELSE 0 END AS has_unpublished
    FROM pages
  `;
  const where = [];
  const params = [];

  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (q && String(q).trim()) {
    where.push('(title LIKE ? OR full_path LIKE ? OR slug LIKE ?)');
    const like = '%' + String(q).trim() + '%';
    params.push(like, like, like);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY updated_at DESC';

  return db.prepare(sql).all(...params);
}

// ---- Articles (pages tagged as articles, served as cubes by the article-list module) ----

function publicUrlFor(full_path) {
  // Must match export.js filename sanitization
  return '/' + sanitizeFullPath(full_path) + '.html';
}

/** First image src anywhere in a block tree (image, gallery, nested columns/card). */
function firstImageSrc(list) {
  for (const b of (list || [])) {
    if (!b || !b.data) continue;
    if (b.type === 'image' && b.data.src) return b.data.src;
    if (b.type === 'gallery' && Array.isArray(b.data.images) && b.data.images.length) {
      const im = b.data.images[0];
      const src = typeof im === 'string' ? im : (im && im.src);
      if (src) return src;
    }
    if (b.type === 'columns' && Array.isArray(b.data.columns)) {
      for (const col of b.data.columns) {
        const found = firstImageSrc((col && col.blocks) || []);
        if (found) return found;
      }
    }
    if (b.type === 'card' && Array.isArray(b.data.blocks)) {
      const found = firstImageSrc(b.data.blocks);
      if (found) return found;
    }
  }
  return '';
}

/** First text content in a block tree, trimmed to teaser length. */
function firstTeaser(list, maxLen = 160) {
  for (const b of (list || [])) {
    if (!b || !b.data) continue;
    if (b.type === 'text' && b.data.content) {
      const t = String(b.data.content).replace(/\s+/g, ' ').trim();
      if (t) return t.length > maxLen ? t.slice(0, maxLen).trim() + '…' : t;
    }
    if (b.type === 'columns' && Array.isArray(b.data.columns)) {
      for (const col of b.data.columns) {
        const found = firstTeaser((col && col.blocks) || [], maxLen);
        if (found) return found;
      }
    }
  }
  return '';
}

/**
 * Published pages carrying the given tag, newest first, as article cards.
 * Card image: meta.cardImage or auto from first image block.
 * Teaser: meta.teaser or auto from first text block.
 */
function listArticles({ tag = 'article', limit = 12 } = {}) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 48);
  const rows = db.prepare(
    `SELECT * FROM pages WHERE status = 'published' ORDER BY updated_at DESC, id DESC`
  ).all();

  const articles = [];
  for (const row of rows) {
    const page = parsePageRow(row);
    if (!page.tags.includes(tag)) continue;
    articles.push({
      title: page.title,
      full_path: page.full_path,
      url: publicUrlFor(page.full_path),
      image: (page.meta && page.meta.cardImage) || firstImageSrc(page.blocks),
      teaser: (page.meta && page.meta.teaser) || firstTeaser(page.blocks),
      updated_at: page.updated_at
    });
    if (articles.length >= max) break;
  }
  return articles;
}

function deletePage(full_path) {
  const result = db.prepare('DELETE FROM pages WHERE full_path = ?').run(full_path);
  db.prepare('DELETE FROM page_revisions WHERE full_path = ?').run(full_path);
  store.removePagePzn(full_path);
  // deleting the crowned homepage clears the crown (back to auto-detect);
  // the pages screen then warns if the site root has no owner
  syncHomepageConfig(full_path, '');
  return result.changes > 0;
}

/** Keep config.homepage true through renames/deletes. Never blocks the write. */
function syncHomepageConfig(oldPath, newPath) {
  try {
    const { loadConfig, saveConfig } = require('./config');
    const config = loadConfig();
    if ((config.homepage || '') !== oldPath) return;
    config.homepage = newPath || '';
    saveConfig(config);
  } catch (e) { /* config trouble must never block a page write */ }
}

function restoreRevision(full_path, revisionId) {
  const rev = getRevision(revisionId);
  if (!rev) throw new Error('Revision not found');
  if (rev.full_path !== full_path) throw new Error('Revision does not belong to this page');

  return updatePage(full_path, {
    title: rev.title || undefined,
    blocks: rev.blocks,
    revisionKind: 'restore'
  });
}

// ─── v0.42: the .pzn source and AST ops ARE the editing path ────────
// The visual canvas's JSON is a lossless projection (v0.40 bridge) of the
// canonical file (v0.41 store); these functions edit the canonical form
// directly — for agents, tools, and the builder standard.

const pzn = require('./pzn/index');
const pznOps = require('./pzn/builder/ops');
const fs = require('fs');

/**
 * The page's canonical .pzn source. Falls back to serializing the current
 * blocks for legacy pages that predate the store.
 * @param {string} full_path
 * @param {'draft'|'published'} kind
 * @returns {string|null} null when the page does not exist
 */
function getPageSource(full_path, kind = 'draft') {
  const page = getPageByFullPath(full_path);
  if (!page) return null;
  const src = store.readPageSource(full_path, kind);
  if (src != null) return src;
  return store.pageToPzn(page, kind === 'published' ? page.blocks : page.draft_blocks);
}

/**
 * Save raw .pzn source as the page's draft (optionally publish).
 * Validates first; the author's exact formatting is preserved in the file.
 * The head's title/tags/teaser/cardImage/direction sync into the DB index.
 * Page identity (full_path) comes from the argument — bent-slug is not a rename.
 * @returns {{ page: object, blocks: object[], warnings: object[] }}
 */
function savePageSource(full_path, source, { publish = false, repair = false } = {}) {
  const existing = getPageByFullPath(full_path);
  if (!existing) throw new Error('Page not found');
  if (typeof source !== 'string' || !source.trim()) throw new Error('Source required');

  // Strict by default. With repair:true (the extension / forgiving path), a
  // parse or validation failure is auto-corrected to a clean document instead
  // of losing the page — the changes are returned for the caller to surface.
  let doc;
  let repairChanges = [];
  try {
    doc = pzn.parse(source); // throws BentError with line/column
    const errors = pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
    if (errors.length) {
      const err = new Error(errors.map((e) => `${e.code}: ${e.message}`).join('; '));
      err.code = errors[0].code;
      err.issues = errors;
      throw err;
    }
  } catch (e) {
    if (!repair) throw e;
    const { repair: repairFn } = require('./pzn/repair');
    const r = repairFn(source);
    if (!r.ok || r.remaining.length) {
      const err = new Error('could not auto-repair: ' + (r.error || (r.remaining[0] && r.remaining[0].message) || 'unknown'));
      err.code = 'E_UNREPAIRABLE';
      err.issues = r.remaining;
      throw err;
    }
    source = r.source;
    doc = pzn.parse(source);
    repairChanges = r.changes;
  }

  const view = pzn.toTapuzPage(doc);
  const saved = updatePage(full_path, {
    title: view.title || existing.title,
    direction: view.direction || existing.direction,
    tags: view.tags,
    meta: { ...(existing.meta || {}), ...(view.meta || {}) },
    draft_blocks: view.blocks,
    publish
  });

  // keep the author's exact source as the canonical file (updatePage wrote a
  // re-serialized form; the raw text wins — formatting is content too)
  fs.writeFileSync(store.pznPathFor(saved.full_path, 'draft'), source, 'utf8');
  if (publish) fs.writeFileSync(store.pznPathFor(saved.full_path, 'published'), source, 'utf8');

  return {
    page: saved,
    blocks: view.blocks,
    warnings: pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'warning'),
    changes: repairChanges
  };
}

/**
 * Apply builder-standard AST ops to the page's draft document.
 * ops = [{ op: 'insert'|'remove'|'move'|'update'|'replace'|'duplicate'|'document', ... }]
 *   insert:    { type, parentId?, index?, overrides? }
 *   remove:    { id }
 *   move:      { id, parentId?, index? }
 *   update:    { id, props }           (props may include text/class/id)
 *   replace:   { id, type }
 *   duplicate: { id }
 *   document:  { patch }               (title/dir/lang/tags/meta)
 * @returns {{ page: object, blocks: object[], warnings: object[], source: string }}
 */
function applyPageOps(full_path, opsList, { publish = false } = {}) {
  const existing = getPageByFullPath(full_path);
  if (!existing) throw new Error('Page not found');
  if (!Array.isArray(opsList) || !opsList.length) throw new Error('ops array required');

  let doc = pzn.parse(getPageSource(full_path, 'draft'));

  for (const op of opsList) {
    const kind = op && op.op;
    switch (kind) {
      case 'insert': {
        const node = pznOps.createFromType(op.type, op.overrides || {});
        doc = pznOps.insert(doc, op.parentId || null, op.index != null ? op.index : Number.MAX_SAFE_INTEGER, node);
        break;
      }
      case 'remove':
        doc = pznOps.remove(doc, op.id);
        break;
      case 'move':
        doc = pznOps.move(doc, op.id, op.parentId || null, op.index != null ? op.index : 0);
        break;
      case 'update':
      case 'updateProps':
        doc = pznOps.updateProps(doc, op.id, op.props || {});
        break;
      case 'replace':
        doc = pznOps.replace(doc, op.id, op.type);
        break;
      case 'duplicate':
        doc = pznOps.duplicate(doc, op.id);
        break;
      case 'document':
      case 'updateDocument':
        doc = pznOps.updateDocument(doc, op.patch || {});
        break;
      default:
        throw new Error(`Unknown op: ${kind}`);
    }
  }

  const source = pzn.serialize(doc);
  const result = savePageSource(full_path, source, { publish });
  return { ...result, source };
}

module.exports = {
  createPage,
  updatePage,
  publishPage,
  getPageByFullPath,
  listPages,
  listArticles,
  publicUrlFor,
  deletePage,
  restoreRevision,
  listRevisions,
  getRevision,
  generateFullPath,
  // v0.42 — canonical editing path (.pzn source + AST ops)
  getPageSource,
  savePageSource,
  applyPageOps
};
