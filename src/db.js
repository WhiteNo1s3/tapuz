const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const { DB_DIR } = require('./paths');
const dbDir = DB_DIR;
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'tapuz.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

function hasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

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
      tags TEXT,
      meta TEXT,
      blocks TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // draft_blocks: working copy; blocks = last published snapshot
  if (!hasColumn('pages', 'draft_blocks')) {
    db.exec('ALTER TABLE pages ADD COLUMN draft_blocks TEXT');
    // Bootstrap drafts from published content so existing pages keep editing
    db.exec(`UPDATE pages SET draft_blocks = blocks WHERE draft_blocks IS NULL`);
  }

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

  // Revisions (db.js owns all DDL — never require sibling modules here,
  // they require db back and their exports may not exist yet mid-load)
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_revisions_path ON page_revisions(full_path, created_at DESC)');

  // Menus entity
  db.exec(`
    CREATE TABLE IF NOT EXISTS menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // First-party analytics (S6). Privacy-safe by design: NO raw IP and NO full
  // User-Agent are ever stored — only a path, the referrer HOST, a coarse
  // device class, and a DAILY-SALTED HMAC visitor hash. Insert/query helpers
  // live in src/analytics.js (which requires ./db); db.js owns only the DDL and
  // must NOT require sibling modules here (circular-init deadlock).
  db.exec(`
    CREATE TABLE IF NOT EXISTS pageviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      referrer_host TEXT,
      device_class TEXT,
      visitor_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_pageviews_created ON pageviews(created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_pageviews_path ON pageviews(path, created_at DESC)');

  // Forms inbox (v0.81) — submissions from the FORM module. Privacy-lean:
  // fields + source page + timestamp, no IP/user-agent (see src/forms.js).
  db.exec(`
    CREATE TABLE IF NOT EXISTS form_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page TEXT DEFAULT '',
      fields TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_form_submissions_read ON form_submissions(is_read, id DESC)');

  // Lead pipeline (v1.00): status + private admin notes on each submission —
  // a form submission graduates into a lead once someone works it.
  if (!hasColumn('form_submissions', 'status')) {
    db.exec(`ALTER TABLE form_submissions ADD COLUMN status TEXT DEFAULT 'new'`);
    db.exec(`UPDATE form_submissions SET status = 'new' WHERE status IS NULL`);
  }
  if (!hasColumn('form_submissions', 'notes')) {
    db.exec(`ALTER TABLE form_submissions ADD COLUMN notes TEXT DEFAULT ''`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON form_submissions(status, id DESC)');

  // Deal value + follow-up date (v1.12) — the rest of "advanced CRM
  // pipeline": a rough deal-size estimate and a date to chase the lead,
  // both nullable (most leads never get either set — a contact-form
  // enquiry isn't automatically a sized deal).
  if (!hasColumn('form_submissions', 'value')) {
    db.exec(`ALTER TABLE form_submissions ADD COLUMN value REAL`);
  }
  if (!hasColumn('form_submissions', 'follow_up_at')) {
    db.exec(`ALTER TABLE form_submissions ADD COLUMN follow_up_at TEXT`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_form_submissions_follow_up ON form_submissions(follow_up_at)');

  // Holds the current UTC-day salt so a server restart does not re-randomize
  // the visitor hash mid-day. Prior days' salts are discarded (see
  // analytics.getDailySalt) so yesterday's hashes cannot be recomputed.
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_salt (
      day TEXT PRIMARY KEY,
      salt TEXT NOT NULL
    )
  `);

  console.log('Database initialized successfully.');
}

// Export BEFORE auto-init: initialize() requires modules that require db back
// (revisions/menus). Exporting first breaks the circular-dependency deadlock.
module.exports = { db, initialize };

// Auto-migrate on require so server/CLI always have schema
try {
  initialize();
} catch (e) {
  console.error('DB init warning:', e.message);
}
