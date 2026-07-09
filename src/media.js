const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function saveMedia(file) {
  ensureUploadDir();
  const filename = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '');
  const dest = path.join(UPLOAD_DIR, filename);

  fs.writeFileSync(dest, file.buffer);

  const stmt = db.prepare(`
    INSERT INTO media (filename, path, mime, size)
    VALUES (?, ?, ?, ?)
  `);

  const result = stmt.run(
    filename,
    '/uploads/' + filename,
    file.mimetype,
    file.size
  );

  return {
    id: result.lastInsertRowid,
    filename,
    path: '/uploads/' + filename
  };
}

function listMedia() {
  return db.prepare('SELECT * FROM media ORDER BY created_at DESC').all();
}

module.exports = {
  saveMedia,
  listMedia,
  UPLOAD_DIR
};
