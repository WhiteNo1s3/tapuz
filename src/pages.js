const { db } = require('./db');
const { addRevision, listRevisions, getRevision } = require('./revisions');

function generateFullPath(pathPrefix, slug) {
  const prefix = pathPrefix ? pathPrefix.replace(/-$/, '') + '-' : '';
  return prefix + slug;
}

function parsePageRow(row) {
  if (!row) return null;
  const publishedBlocks = JSON.parse(row.blocks || '[]');
  let draftBlocks;
  try {
    draftBlocks = row.draft_blocks != null
      ? JSON.parse(row.draft_blocks || '[]')
      : publishedBlocks;
  } catch (e) {
    draftBlocks = publishedBlocks;
  }

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

  addRevision({
    pageId: result.lastInsertRowid,
    fullPath: full_path,
    title,
    status: status || 'draft',
    kind: status === 'published' ? 'publish' : 'draft',
    blocks: blocks
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

  const saved = getPageByFullPath(newData.full_path);

  addRevision({
    pageId: saved.id,
    fullPath: saved.full_path,
    title: saved.title,
    status: saved.status,
    kind,
    blocks: draftBlocks
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
    SELECT id, full_path, title, status, direction, theme, updated_at,
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

function deletePage(full_path) {
  const result = db.prepare('DELETE FROM pages WHERE full_path = ?').run(full_path);
  db.prepare('DELETE FROM page_revisions WHERE full_path = ?').run(full_path);
  return result.changes > 0;
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

module.exports = {
  createPage,
  updatePage,
  publishPage,
  getPageByFullPath,
  listPages,
  deletePage,
  restoreRevision,
  listRevisions,
  getRevision,
  generateFullPath
};
