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

  initializeCrmCs();
  initializeCrmSearch();
}

/**
 * Customer-service chat (v1.83, the lab's held-back module).
 *
 * This is the only CRM surface where an ANONYMOUS visitor can cause the owner
 * to spend money, so the ledger is part of the schema rather than an
 * afterthought: `crm_cs_budget` holds one row per UTC day, and the send path
 * refuses before calling the model once the day's row hits the cap.
 */
function initializeCrmCs() {
  // One row per UTC day. `messages` is the number that is actually enforced —
  // it is exact and countable. `est_tokens` is an estimate shown to the owner
  // for context and never used as a gate (see src/crm/cs.js).
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_cs_budget (
      day TEXT PRIMARY KEY,
      messages INTEGER NOT NULL DEFAULT 0,
      est_tokens INTEGER NOT NULL DEFAULT 0,
      refusals INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_cs_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      contact_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      message_count INTEGER NOT NULL DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_cs_conv_status ON crm_cs_conversations(status, last_message_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_cs_conv_contact ON crm_cs_conversations(contact_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_cs_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES crm_cs_conversations(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_cs_msg_conv ON crm_cs_messages(conversation_id, id)');
}

/**
 * Full-text contact search (v1.82, phase 5).
 *
 * `LIKE '%term%'` cannot use an index and scans every row — fine for a lab,
 * wrong for a CRM that is supposed to hold a real customer base. FTS5 gives an
 * actual inverted index, and its `unicode61` tokenizer handles Hebrew, so
 * "דנה" finds דנה כהן.
 *
 * This is an EXTERNAL CONTENT table: the index stores no copy of the data, it
 * points at `crm_contacts` rows. Triggers keep it in step with every write.
 *
 * FTS5 is a compile-time SQLite option. It is present in the better-sqlite3
 * builds we ship, but if a future environment lacks it, everything here fails
 * softly and `contacts.listContacts` falls back to LIKE — a slower search is a
 * far better outcome than a CMS that will not start.
 */
let CRM_FTS_READY = false;

function crmSearchReady() {
  return CRM_FTS_READY;
}

function initializeCrmSearch() {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS crm_contacts_fts USING fts5(
        search_blob,
        content='crm_contacts',
        content_rowid='id',
        tokenize='unicode61'
      )
    `);

    // Keep the index in step. With an external content table the delete side
    // must be written as the 'delete' command carrying the OLD value.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS crm_contacts_fts_ai AFTER INSERT ON crm_contacts BEGIN
        INSERT INTO crm_contacts_fts(rowid, search_blob) VALUES (new.id, new.search_blob);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS crm_contacts_fts_ad AFTER DELETE ON crm_contacts BEGIN
        INSERT INTO crm_contacts_fts(crm_contacts_fts, rowid, search_blob)
          VALUES ('delete', old.id, old.search_blob);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS crm_contacts_fts_au AFTER UPDATE ON crm_contacts BEGIN
        INSERT INTO crm_contacts_fts(crm_contacts_fts, rowid, search_blob)
          VALUES ('delete', old.id, old.search_blob);
        INSERT INTO crm_contacts_fts(rowid, search_blob) VALUES (new.id, new.search_blob);
      END
    `);

    // An existing install has contacts the index has never seen, so the index
    // needs one rebuild on upgrade.
    //
    // TRAP (found live in v1.82): `SELECT COUNT(*) FROM crm_contacts_fts` does
    // NOT count the index. On an external-content table that query is answered
    // from the CONTENT table — so comparing it against crm_contacts compares
    // crm_contacts to itself, always agrees, and the rebuild never runs. The
    // index then stays empty on precisely the databases that needed it, while a
    // fresh install looks fine because the triggers fill it as rows arrive.
    //
    // `_docsize` is the index's own per-document shadow table, so it reports
    // what is really indexed.
    const contacts = db.prepare('SELECT COUNT(*) AS n FROM crm_contacts').get().n;
    let indexed = null;
    try {
      indexed = db.prepare('SELECT COUNT(*) AS n FROM crm_contacts_fts_docsize').get().n;
    } catch (e) {
      indexed = null; // shadow table missing → rebuild rather than guess
    }
    if (indexed === null || indexed !== contacts) {
      db.exec("INSERT INTO crm_contacts_fts(crm_contacts_fts) VALUES('rebuild')");
    }
    CRM_FTS_READY = true;
  } catch (e) {
    CRM_FTS_READY = false;
    console.warn('[crm] full-text search unavailable, falling back to LIKE:', e.message);
  }
}

// Export BEFORE auto-init: initialize() requires modules that require db back
// (revisions/menus). Exporting first breaks the circular-dependency deadlock.
module.exports = { db, initialize, crmSearchReady };

// Auto-migrate on require so server/CLI always have schema
try {
  initialize();
} catch (e) {
  console.error('DB init warning:', e.message);
}
