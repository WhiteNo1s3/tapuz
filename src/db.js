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

  initializeCrm();

  console.log('Database initialized successfully.');
}

/**
 * CRM schema (v1.77, phase 1 of docs/CRM-INTEGRATION.md).
 *
 * Purely additive and `crm_`-namespaced: the tables are created whether or not
 * config.crm.enabled is on (an empty table costs nothing and means flipping the
 * flag never needs a migration), but NOTHING writes to them while the flag is
 * off. Dropping the CRM is dropping these tables — no CMS table is touched.
 *
 * Layering: `form_submissions` stays the record of a SUBMISSION (what someone
 * sent, once). `crm_contacts` is the record of a PERSON, identified across many
 * submissions and visits. One person, many submissions — so contacts sit ABOVE
 * the inbox rather than replacing it, and the existing lead pipeline keeps
 * working untouched.
 */
function initializeCrm() {
  // A person. Identity is email-or-phone; both are optional because an
  // anonymous visitor can earn a contact row from behaviour alone.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      phone TEXT,
      name TEXT DEFAULT '',
      company TEXT DEFAULT '',
      status TEXT DEFAULT 'lead',
      source TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      country TEXT DEFAULT '',
      consent INTEGER DEFAULT 0,
      search_blob TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Identity uniqueness is PARTIAL: many contacts may have no email (NULL is
  // distinct in SQLite), but a given address belongs to exactly one person.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contacts_email
           ON crm_contacts(email) WHERE email IS NOT NULL AND email <> ''`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contacts_phone
           ON crm_contacts(phone) WHERE phone IS NOT NULL AND phone <> ''`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_contacts_status ON crm_contacts(status, updated_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_contacts_updated ON crm_contacts(updated_at DESC)');

  // The timeline. Every typed thing a person did; `ref_id` points at the row in
  // whichever table owns the detail (a form_submissions.id, later a send id).
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER,
      type TEXT NOT NULL,
      path TEXT DEFAULT '',
      title TEXT DEFAULT '',
      ref_id INTEGER,
      meta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_events_contact ON crm_events(contact_id, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_events_type ON crm_events(type, created_at DESC)');

  // The graph: who knows whom. Directed edges, deduped per (from, to, kind).
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'knows',
      note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (from_id) REFERENCES crm_contacts(id) ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_relations_edge ON crm_relations(from_id, to_id, kind)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_relations_to ON crm_relations(to_id)');

  // Saved audiences. `rules` is JSON evaluated at read time, so a segment is
  // always live rather than a stale materialized list.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rules TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Named lists — explicit membership, unlike a rule-driven segment.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_list_members (
      list_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (list_id, contact_id),
      FOREIGN KEY (list_id) REFERENCES crm_lists(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_list_members_contact ON crm_list_members(contact_id)');

  // Browser → person (v1.77 phase 2). The analytics `pageviews` table is
  // deliberately anonymous: its visitor hash is re-salted daily and prior
  // salts are discarded, so it CANNOT be used to follow someone over time —
  // a privacy property we will not trade away for a CRM feature.
  //
  // So attribution gets its own opt-in link: a random token in a first-party
  // cookie, minted only when a visitor VOLUNTARILY identifies themselves (a
  // form submission) and only while the CRM is enabled. One person may hold
  // several tokens (many browsers); a token maps to exactly one person.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_visitors (
      token TEXT PRIMARY KEY,
      contact_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_visitors_contact ON crm_visitors(contact_id)');

  // Campaigns (v1.81 phase 3c). `links` is the JSON array of URLs extracted
  // from the body at send time — click tracking redirects by INDEX into that
  // frozen list, never to a URL supplied in the request, so the tracker can
  // never become an open redirect.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      list_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      links TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME,
      FOREIGN KEY (list_id) REFERENCES crm_lists(id) ON DELETE SET NULL
    )
  `);

  // One row per recipient. `token` is the unguessable handle that appears in
  // the open pixel, every tracked link and the unsubscribe URL — so a single
  // random value identifies the send without ever putting an email address or
  // a contact id in a URL.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_campaign_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      sent_at DATETIME,
      opened_at DATETIME,
      clicked_at DATETIME,
      click_count INTEGER DEFAULT 0,
      FOREIGN KEY (campaign_id) REFERENCES crm_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_sends_campaign ON crm_campaign_sends(campaign_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_sends_contact ON crm_campaign_sends(contact_id)');
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
