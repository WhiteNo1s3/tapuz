const { db } = require('./db');

function generateFullPath(pathPrefix, slug) {
  const prefix = pathPrefix ? pathPrefix.replace(/-$/, '') + '-' : '';
  return prefix + slug;
}

function createPage({ title, slug, path_prefix = '', direction = 'rtl', blocks = [], tags = [], meta = {}, status = 'draft' }) {
  const full_path = generateFullPath(path_prefix, slug);

  const stmt = db.prepare(`
    INSERT INTO pages (path_prefix, slug, full_path, title, direction, blocks, tags, meta, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    path_prefix,
    slug,
    full_path,
    title,
    direction,
    JSON.stringify(blocks),
    JSON.stringify(tags),
    JSON.stringify(meta),
    status || 'draft'
  );

  return {
    id: result.lastInsertRowid,
    full_path,
    title,
    slug
  };
}

function updatePage(full_path, updates) {
  const existing = getPageByFullPath(full_path);
  if (!existing) throw new Error('Page not found');

  const newData = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString()
  };

  // Regenerate full_path if prefix or slug changed
  if (updates.path_prefix !== undefined || updates.slug !== undefined) {
    const prefix = updates.path_prefix !== undefined ? updates.path_prefix : page.path_prefix;
    const slug = updates.slug !== undefined ? updates.slug : page.slug;
    newData.full_path = generateFullPath(prefix, slug);
  }

  if (updates.blocks) newData.blocks = JSON.stringify(updates.blocks);
  if (updates.tags) newData.tags = JSON.stringify(updates.tags);
  if (updates.meta) newData.meta = JSON.stringify(updates.meta);

  const stmt = db.prepare(`
    UPDATE pages SET
      path_prefix = ?,
      slug = ?,
      full_path = ?,
      title = ?,
      direction = ?,
      blocks = ?,
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
    newData.direction,
    typeof newData.blocks === 'string' ? newData.blocks : JSON.stringify(newData.blocks),
    typeof newData.tags === 'string' ? newData.tags : JSON.stringify(newData.tags),
    typeof newData.meta === 'string' ? newData.meta : JSON.stringify(newData.meta),
    newData.status || 'draft',
    full_path
  );

  return getPageByFullPath(newData.full_path);
}

function getPageByFullPath(full_path) {
  const row = db.prepare('SELECT * FROM pages WHERE full_path = ?').get(full_path);
  if (!row) return null;

  return {
    ...row,
    blocks: JSON.parse(row.blocks || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    meta: JSON.parse(row.meta || '{}')
  };
}

function listPages() {
  return db.prepare(`
    SELECT id, full_path, title, status, direction, updated_at 
    FROM pages 
    ORDER BY updated_at DESC
  `).all();
}

function deletePage(full_path) {
  const result = db.prepare('DELETE FROM pages WHERE full_path = ?').run(full_path);
  return result.changes > 0;
}

module.exports = {
  createPage,
  updatePage,
  getPageByFullPath,
  listPages,
  deletePage,
  generateFullPath
};
