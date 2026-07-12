// Automatic page revision backups on every save/publish.
const { db } = require('./db');

const MAX_REVISIONS_PER_PAGE = 30;

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER,
      full_path TEXT NOT NULL,
      title TEXT,
      status TEXT,
      kind TEXT DEFAULT 'draft' CHECK(kind IN ('draft', 'publish', 'restore')),
      blocks TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_revisions_path ON page_revisions(full_path, created_at DESC)`);
}

/**
 * v0.41 storage flip: when `pzn` source text is provided, the revision is
 * stored as canonical .pzn (detectable by its leading '<'). Legacy JSON
 * revisions remain readable — getRevision() handles both formats.
 */
function addRevision({ pageId, fullPath, title, status, kind, blocks, pzn }) {
  ensureSchema();
  const stmt = db.prepare(`
    INSERT INTO page_revisions (page_id, full_path, title, status, kind, blocks)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const content = typeof pzn === 'string' && pzn.trim().startsWith('<')
    ? pzn
    : (typeof blocks === 'string' ? blocks : JSON.stringify(blocks || []));
  const result = stmt.run(
    pageId || null,
    fullPath,
    title || '',
    status || 'draft',
    kind === 'publish' || kind === 'restore' ? kind : 'draft',
    content
  );

  pruneOld(fullPath);
  return result.lastInsertRowid;
}

function pruneOld(fullPath) {
  const rows = db.prepare(`
    SELECT id FROM page_revisions
    WHERE full_path = ?
    ORDER BY created_at DESC, id DESC
  `).all(fullPath);

  if (rows.length <= MAX_REVISIONS_PER_PAGE) return;
  const drop = rows.slice(MAX_REVISIONS_PER_PAGE).map(r => r.id);
  const del = db.prepare('DELETE FROM page_revisions WHERE id = ?');
  const tx = db.transaction((ids) => {
    ids.forEach(id => del.run(id));
  });
  tx(drop);
}

function listRevisions(fullPath, limit = 30) {
  ensureSchema();
  return db.prepare(`
    SELECT id, page_id, full_path, title, status, kind, created_at,
           length(blocks) AS blocks_size
    FROM page_revisions
    WHERE full_path = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(fullPath, Math.min(Math.max(limit, 1), 100));
}

function getRevision(id) {
  ensureSchema();
  const row = db.prepare('SELECT * FROM page_revisions WHERE id = ?').get(id);
  if (!row) return null;

  const raw = row.blocks || '[]';
  let blocks;
  let pzn = null;
  if (raw.trim().startsWith('<')) {
    // canonical .pzn revision (v0.41+)
    pzn = raw;
    try {
      const { parse, toTapuzPage } = require('./pzn/index');
      blocks = toTapuzPage(parse(raw)).blocks;
    } catch (e) {
      console.warn(`revisions: cannot parse .pzn revision ${id} (${e.message})`);
      blocks = [];
    }
  } else {
    // legacy JSON revision
    try {
      blocks = JSON.parse(raw);
    } catch (e) {
      blocks = [];
    }
  }
  return {
    ...row,
    blocks,
    pzn
  };
}

module.exports = {
  ensureSchema,
  addRevision,
  listRevisions,
  getRevision,
  MAX_REVISIONS_PER_PAGE
};
