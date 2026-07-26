const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const { DB_DIR } = require('./paths');
const dbDir = DB_DIR;
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'tapuz.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
// ── v1.90 "premium db": the pragmas that make declared behavior REAL ──
// The schema has declared FOREIGN KEYs since the CRM landed (v1.77), but
// SQLite enforces them per-connection and DEFAULTS OFF — until now they were
// documentation. On: a child row cannot name a parent that is not there, and
// ON DELETE CASCADE / SET NULL actually fire. (Enforcement is write-time
// only, so pre-existing rows never block an upgrade.)
db.pragma('foreign_keys = ON');
// Cross-process access (route smokes spawn a second server on this file)
// waits up to 5s for a writer instead of throwing SQLITE_BUSY on collision.
db.pragma('busy_timeout = 5000');
// The WAL-safe durability setting: fsync at checkpoint, not every
// transaction. Same corruption safety under WAL, far less disk thrash.
db.pragma('synchronous = NORMAL');
// v1.92 "sqlite forever": brand the file with SQLite's own application_id
// header field ('TPUZ') — a Tapuziel database identifies ITSELF, which is
// what lets the upload-restore guard refuse a foreign sqlite file before
// emptying the live tables for it. Every snapshot inherits the mark.
const TAPUZ_APP_ID = 0x5450555A; // 'TPUZ'
if (db.pragma('application_id', { simple: true }) === 0) {
  db.pragma(`application_id = ${TAPUZ_APP_ID}`);
}

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
  // Live segment audience (v1.94) — evaluated at send time, not a frozen list.
  // Either list_id OR segment_id may be set; consent + email still filter.
  if (!hasColumn('crm_campaigns', 'segment_id')) {
    db.exec('ALTER TABLE crm_campaigns ADD COLUMN segment_id INTEGER');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_campaigns_segment ON crm_campaigns(segment_id)');

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

  // BenTML repair telemetry (v1.85): which repair codes fire, per element —
  // the number that answers "is the syntax a problem for models?". Only codes
  // and element names are stored, never document content.
  db.exec(`
    CREATE TABLE IF NOT EXISTS pzn_repair_stats (
      code TEXT NOT NULL,
      element TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL DEFAULT 0,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (code, element)
    )
  `);

  // Site registry for foreign pixel embeds (v1.99) — slug is public like a
  // measurement id; unknown slugs never write. No personal data here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_sites (
      slug TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      allowed_origins TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      claims_enabled INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Identity claims (v1.99) — a foreign identify() is an *unverified claim*
  // until an admin approves it. Never auto-upserts a contact. contact_id is
  // set only after approval so PERSONAL_TABLES erasure still covers it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_identity_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id TEXT NOT NULL DEFAULT '',
      email TEXT,
      phone TEXT,
      name TEXT DEFAULT '',
      visitor_hash TEXT DEFAULT '',
      path TEXT DEFAULT '',
      claim_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      contact_id INTEGER,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_claims_status ON crm_identity_claims(status, last_seen_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_claims_site ON crm_identity_claims(site_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_claims_contact ON crm_identity_claims(contact_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_claims_email ON crm_identity_claims(email)');

  // Foreign anonymous traffic can tag analytics pageviews with a site_id
  // without polluting crm_events (privacy spine).
  if (!hasColumn('pageviews', 'site_id')) {
    db.exec(`ALTER TABLE pageviews ADD COLUMN site_id TEXT DEFAULT ''`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_pageviews_site ON pageviews(site_id, created_at DESC)');

  initializeCrmCs();
  initializeCrmWa();
  initializeCrmSearch();
}

/**
 * WhatsApp channel ledger (v1.86, phase W1 of docs/WHATSAPP-INTEGRATION.md).
 *
 * Three tables, keyed by the wa-id phone (972…), because that is WhatsApp's
 * identity — `contact_id` rides along on messages so a chat joins the person's
 * timeline, but a phone with no CRM contact yet must still have opt-ins and a
 * window.
 *
 * The tier counter the lab kept in a process Map lives HERE, derived from
 * `crm_wa_messages` by query (distinct outside-window recipients, rolling 24h).
 * Meta's tier limit is account-level: a counter that resets on restart
 * undercounts, and then Meta enforces the limit instead of us — a blocked
 * number instead of a refused send.
 */
function initializeCrmWa() {
  // Consent per category. Marketing is the one that legally matters; a row is
  // live when revoked_at IS NULL. History is kept (grant → revoke → grant is
  // three facts, not one flag).
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_wa_optins (
      phone TEXT NOT NULL,
      category TEXT NOT NULL,
      granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME,
      note TEXT DEFAULT '',
      PRIMARY KEY (phone, category)
    )
  `);

  // The 24h customer-service window, opened by an INBOUND message.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_wa_windows (
      phone TEXT PRIMARY KEY,
      opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      fep_expires_at DATETIME
    )
  `);

  // Every message, both directions. `outside_csw` marks an outbound send that
  // counted against the tier; `body` holds the person's words, which is why
  // this table is in subject.PERSONAL_TABLES and why erasure deletes rows
  // rather than trusting the SET NULL.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_wa_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      contact_id INTEGER,
      direction TEXT NOT NULL,
      msg_type TEXT NOT NULL DEFAULT 'text',
      template_category TEXT,
      pricing_category TEXT,
      pricing_type TEXT,
      billable INTEGER DEFAULT 0,
      status TEXT DEFAULT 'accepted',
      wa_message_id TEXT,
      outside_csw INTEGER DEFAULT 0,
      body TEXT DEFAULT '',
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      delivered_at DATETIME,
      FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE SET NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_wa_msg_phone ON crm_wa_messages(phone, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_crm_wa_msg_contact ON crm_wa_messages(contact_id)');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_crm_wa_msg_tier
           ON crm_wa_messages(outside_csw, created_at) WHERE outside_csw = 1`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_wa_msg_waid ON crm_wa_messages(wa_message_id) WHERE wa_message_id IS NOT NULL');
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

// ── v1.90 premium db: health, the backup shelf, integrity ────────────
// The storage screen's promise — "your content is real files on disk" —
// extended to the database itself: SQLite IS a file you own, in an open
// format, and now it comes with a shelf of consistent snapshots.

const BACKUP_KEEP = 7;

function backupDir() {
  const d = path.join(dbDir, 'backups');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Newest first, with sizes — the shelf as the admin sees it. */
function listBackups() {
  try {
    return fs.readdirSync(backupDir())
      .filter((f) => /^tapuz-[\w.-]+\.sqlite$/.test(f))
      .map((name) => {
        const st = fs.statSync(path.join(backupDir(), name));
        return { name, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) { return []; }
}

/**
 * A consistent point-in-time snapshot via VACUUM INTO — WAL-safe (readers
 * and the writer are unaffected), compacted, and a plain SQLite file anyone
 * can open anywhere. Re-stamps the 'TPUZ' application_id belt-and-braces,
 * so a snapshot always self-identifies regardless of VACUUM semantics.
 */
function snapshotTo(file) {
  db.prepare('VACUUM INTO ?').run(file);
  const s = new Database(file);
  try { s.pragma(`application_id = ${TAPUZ_APP_ID}`); } finally { s.close(); }
  return { file, size: fs.statSync(file).size };
}

/**
 * Snapshot onto the shelf. Keeps the newest BACKUP_KEEP and prunes the
 * rest; a same-second name collision gets a suffix rather than an error.
 */
function backupNow() {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  let file = path.join(backupDir(), `tapuz-${stamp}.sqlite`);
  for (let n = 2; fs.existsSync(file); n++) {
    file = path.join(backupDir(), `tapuz-${stamp}-${n}.sqlite`);
  }
  snapshotTo(file);
  for (const old of listBackups().slice(BACKUP_KEEP)) {
    try { fs.unlinkSync(path.join(backupDir(), old.name)); } catch (e) { /* pruning is best effort */ }
  }
  return { file, name: path.basename(file), size: fs.statSync(file).size };
}

/**
 * The boot/daily hook: snapshot only when the newest one has aged out, so a
 * day of dev restarts is one backup, not a shelf full of the same morning.
 */
function backupIfStale(hours = 20) {
  const newest = listBackups()[0];
  if (newest && Date.now() - newest.mtime < hours * 3600 * 1000) {
    return { skipped: true, newest: newest.name };
  }
  return backupNow();
}

/** PRAGMA quick_check — seconds, not minutes, and catches real corruption. */
function integrityCheck() {
  const rows = db.pragma('quick_check');
  const ok = rows.length === 1 && String(rows[0].quick_check) === 'ok';
  return { ok, detail: rows.map((r) => String(r.quick_check)).join('; ') };
}

/** What the admin card shows: the settings that are ACTUALLY in effect. */
function dbHealth() {
  const sz = (p) => { try { return fs.statSync(p).size; } catch (e) { return 0; } };
  return {
    path: dbPath,
    size: sz(dbPath),
    walSize: sz(dbPath + '-wal'),
    journalMode: String(db.pragma('journal_mode', { simple: true })),
    foreignKeys: !!db.pragma('foreign_keys', { simple: true }),
    busyTimeoutMs: Number(db.pragma('busy_timeout', { simple: true })),
    synchronous: Number(db.pragma('synchronous', { simple: true })), // 1 = NORMAL
    backups: listBackups(),
    backupKeep: BACKUP_KEEP
  };
}

// Export BEFORE auto-init: initialize() requires modules that require db back
// (revisions/menus). Exporting first breaks the circular-dependency deadlock.
module.exports = {
  db, initialize, crmSearchReady, TAPUZ_APP_ID,
  dbHealth, integrityCheck, snapshotTo, backupNow, backupIfStale, listBackups
};

// Auto-migrate on require so server/CLI always have schema
try {
  initialize();
} catch (e) {
  console.error('DB init warning:', e.message);
}
