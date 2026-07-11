const fs = require('fs');
const path = require('path');
const { db } = require('./db');

// Media lives in public/assets/<folder>/, tracked in the DB.
const { ASSETS_DIR } = require('./paths');

const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

function ensureSchema() {
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
  try {
    db.prepare('SELECT folder FROM media LIMIT 1').get();
  } catch (e) {
    db.exec("ALTER TABLE media ADD COLUMN folder TEXT DEFAULT ''");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/** Sanitize a folder path: he/en letters, digits, -_ and / separators. */
function cleanFolder(p) {
  const parts = String(p || '')
    .split('/')
    .map(s => s.trim().replace(/[^a-zA-Z0-9_\-֐-׿ ]/g, '').slice(0, 40))
    .filter(Boolean);
  return parts.join('/');
}

function folderDiskPath(folder) {
  return folder ? path.join(ASSETS_DIR, ...folder.split('/')) : ASSETS_DIR;
}

/** One-time adoption: register untracked files on disk, drop rows whose files vanished. */
function syncDisk() {
  ensureSchema();
  const known = new Set(db.prepare('SELECT path FROM media').all().map(r => r.path));

  function walk(dir, rel) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(ent => {
      if (ent.isDirectory()) {
        const childRel = rel ? rel + '/' + ent.name : ent.name;
        db.prepare('INSERT OR IGNORE INTO media_folders (path) VALUES (?)').run(childRel);
        walk(path.join(dir, ent.name), childRel);
      } else if (IMG_RE.test(ent.name)) {
        const urlPath = '/assets/' + (rel ? rel + '/' : '') + ent.name;
        if (!known.has(urlPath)) {
          const size = fs.statSync(path.join(dir, ent.name)).size;
          db.prepare('INSERT INTO media (filename, path, folder, size) VALUES (?, ?, ?, ?)')
            .run(ent.name, urlPath, rel || '', size);
        }
        known.delete(urlPath);
      }
    });
  }
  walk(ASSETS_DIR, '');

  // rows whose file disappeared from disk
  db.prepare('SELECT id, path FROM media').all().forEach(row => {
    const diskPath = path.join(ASSETS_DIR, ...row.path.replace(/^\/assets\//, '').split('/'));
    if (!fs.existsSync(diskPath)) {
      db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
    }
  });
}

function listMedia(folder) {
  ensureSchema();
  folder = cleanFolder(folder);
  const prefix = folder ? folder + '/' : '';
  const folders = db.prepare('SELECT path FROM media_folders ORDER BY path').all()
    .map(r => r.path)
    .filter(p => p.startsWith(prefix) && p !== folder && !p.slice(prefix.length).includes('/'))
    .map(p => ({ path: p, name: p.slice(prefix.length) }));
  const files = db.prepare('SELECT id, filename, path, alt, size FROM media WHERE folder = ? ORDER BY created_at DESC')
    .all(folder)
    .map(r => ({ id: r.id, name: r.filename, url: r.path, alt: r.alt || '' }));
  return { folder: folder, folders: folders, files: files };
}

function createFolder(p) {
  ensureSchema();
  const folder = cleanFolder(p);
  if (!folder) throw new Error('שם תיקייה לא תקין');
  fs.mkdirSync(folderDiskPath(folder), { recursive: true });
  db.prepare('INSERT OR IGNORE INTO media_folders (path) VALUES (?)').run(folder);
  return folder;
}

function deleteFolder(p) {
  ensureSchema();
  const folder = cleanFolder(p);
  if (!folder) throw new Error('תיקייה לא תקינה');
  const fileCount = db.prepare('SELECT COUNT(*) c FROM media WHERE folder = ? OR folder LIKE ?')
    .get(folder, folder + '/%').c;
  const subCount = db.prepare('SELECT COUNT(*) c FROM media_folders WHERE path LIKE ?')
    .get(folder + '/%').c;
  if (fileCount > 0 || subCount > 0) throw new Error('התיקייה לא ריקה — מחק או העבר את התוכן קודם');
  db.prepare('DELETE FROM media_folders WHERE path = ?').run(folder);
  const disk = folderDiskPath(folder);
  if (fs.existsSync(disk)) fs.rmdirSync(disk);
  return true;
}

function deleteFile(id) {
  ensureSchema();
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!row) throw new Error('קובץ לא נמצא');
  const disk = path.join(ASSETS_DIR, ...row.path.replace(/^\/assets\//, '').split('/'));
  if (fs.existsSync(disk)) fs.unlinkSync(disk);
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  return row.path;
}

function moveFile(id, targetFolder) {
  ensureSchema();
  const folder = cleanFolder(targetFolder);
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!row) throw new Error('קובץ לא נמצא');
  if (folder) createFolder(folder);
  const oldDisk = path.join(ASSETS_DIR, ...row.path.replace(/^\/assets\//, '').split('/'));
  const newUrl = '/assets/' + (folder ? folder + '/' : '') + row.filename;
  const newDisk = path.join(ASSETS_DIR, ...(folder ? folder.split('/') : []), row.filename);
  if (fs.existsSync(oldDisk)) fs.renameSync(oldDisk, newDisk);
  db.prepare('UPDATE media SET folder = ?, path = ? WHERE id = ?').run(folder, newUrl, id);
  return newUrl;
}

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif'
};

/** Save a base64 data-URL upload into <assets>/<folder>/ and register it. */
function saveBase64({ filename, data, folder }) {
  ensureSchema();
  folder = cleanFolder(folder);
  if (folder) createFolder(folder);

  const safe = String(filename || 'image')
    .replace(/[^a-zA-Z0-9._\-֐-׿]/g, '_')
    .slice(0, 80);
  const match = String(data || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('invalid data url');

  const mime = match[1];
  const ext = MIME_EXT[mime] || path.extname(safe) || '.png';
  const base = path.basename(safe, path.extname(safe)) || 'image';
  const finalName = base + '-' + Date.now() + ext;
  const buf = Buffer.from(match[2], 'base64');

  fs.writeFileSync(path.join(folderDiskPath(folder), finalName), buf);
  const url = '/assets/' + (folder ? folder + '/' : '') + finalName;
  const result = db.prepare('INSERT INTO media (filename, path, folder, mime, size) VALUES (?, ?, ?, ?, ?)')
    .run(finalName, url, folder, mime, buf.length);

  return { id: result.lastInsertRowid, name: finalName, url: url };
}

module.exports = {
  ensureSchema,
  syncDisk,
  listMedia,
  createFolder,
  deleteFolder,
  deleteFile,
  moveFile,
  saveBase64,
  ASSETS_DIR
};
