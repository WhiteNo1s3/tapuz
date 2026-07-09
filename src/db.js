const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'db', 'tapuz.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

function initialize() {
  // Pages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path_prefix TEXT DEFAULT '',
      slug TEXT NOT NULL,
      full_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      direction TEXT DEFAULT 'rtl' CHECK(direction IN ('rtl', 'ltr')),
      theme TEXT DEFAULT 'default',
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'private')),
      tags TEXT,                    -- JSON array
      meta TEXT,                    -- JSON object
      blocks TEXT NOT NULL,         -- JSON array of blocks
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Media table
  db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      mime TEXT,
      width INTEGER,
      height INTEGER,
      size INTEGER,
      alt TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Simple tags table (for future relational queries)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )
  `);

  console.log('Database initialized successfully.');
}

module.exports = { db, initialize };
