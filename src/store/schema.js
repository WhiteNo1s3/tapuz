'use strict';

/**
 * The store's tables (v2.53).
 *
 * All of the store lives in the site's SQLite file — the catalog, the
 * settings (the open/closed flip included), coupons, orders and the
 * BenTML backups of every catalog apply. That is deliberate: the database
 * IS the `.pzn` the owner downloads, restores and swaps live (storage →
 * ייצוא ‎.pzn / שחזור מקובץ, v1.92 "sqlite forever"), and the daily backup
 * shelf snapshots the same file. Nothing about a store may live beside it
 * in a loose config file, or a backup would bring back a shop with no
 * products, or products with no shop.
 *
 * Money columns are INTEGER minor units (see money.js). Additive and
 * `store_`-namespaced like the CRM's tables: created whether or not the
 * store is open (an empty table costs nothing, and the flip never needs a
 * migration), dropping them is dropping the store.
 *
 * Takes the handle as an argument instead of requiring ../db — db.js calls
 * this from inside its own initialize(), before its require cycle settles.
 */
function initializeStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS store_shelves (
      slug TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS store_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      compare_at INTEGER,
      stock INTEGER,
      images TEXT NOT NULL DEFAULT '[]',
      shelf TEXT NOT NULL DEFAULT '',
      badge TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden', 'draft')),
      delivery INTEGER NOT NULL DEFAULT 1,
      max_per_order INTEGER,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_store_products_shelf ON store_products(shelf, status)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS store_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      price INTEGER,
      stock INTEGER,
      sort INTEGER NOT NULL DEFAULT 0,
      UNIQUE(product_id, code),
      FOREIGN KEY (product_id) REFERENCES store_products(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS store_coupons (
      code TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('percent', 'amount', 'shipping')),
      value INTEGER NOT NULL DEFAULT 0,
      min_subtotal INTEGER NOT NULL DEFAULT 0,
      starts_on TEXT NOT NULL DEFAULT '',
      ends_on TEXT NOT NULL DEFAULT '',
      max_uses INTEGER,
      used INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // An order is a RECORD: it copies the title and the price it was sold at,
  // so renaming or deleting a product never rewrites history.
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'new'
        CHECK(status IN ('new', 'processing', 'shipped', 'completed', 'cancelled')),
      paid_at TEXT,
      payment_method TEXT NOT NULL DEFAULT '',
      payment_label TEXT NOT NULL DEFAULT '',
      shipping_method TEXT NOT NULL DEFAULT '',
      shipping_label TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'ILS',
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      shipping INTEGER NOT NULL DEFAULT 0,
      vat INTEGER NOT NULL DEFAULT 0,
      vat_rate REAL NOT NULL DEFAULT 0,
      vat_included INTEGER NOT NULL DEFAULT 1,
      total INTEGER NOT NULL DEFAULT 0,
      coupon TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '{}',
      note TEXT NOT NULL DEFAULT '',
      admin_note TEXT NOT NULL DEFAULT '',
      tracking TEXT NOT NULL DEFAULT '',
      contact_id INTEGER,
      erased INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_store_orders_status ON store_orders(status, id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS store_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT '',
      variant_label TEXT NOT NULL DEFAULT '',
      unit_price INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      line_total INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES store_orders(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_store_items_order ON store_order_items(order_id)');

  db.exec(`
    CREATE TABLE IF NOT EXISTS store_order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES store_orders(id) ON DELETE CASCADE
    )
  `);

  // Every catalog apply (a pasted or AI-written <bent-store>) is preceded by
  // the catalog as it stood, AS a <bent-store> document — the undo is BenTML.
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // A card payment (the gateway, src/store/gateway): one row per hosted-page
  // session we opened for an order. A provider's callback finds the row by
  // the provider's own SESSION id (session_id: Cardcom's LowProfileId, Grow's
  // processId); `reference` is the random value WE hand the provider and get
  // echoed back — a correlation check, never a lookup key and never a
  // verdict. Grow's processToken (its callback's only proof) is kept as a
  // sha256 (session_token_hash — what a callback is checked against) and,
  // for the inquiry fallback only, SEALED under a per-install key
  // (session_token, see gateway/config.js): this table travels in the .pzn
  // like its orders do, and a backup must not carry a usable proof. The row
  // keeps what a sales record needs (approval, last-4, brand, installments,
  // the provider's transaction id) and nothing a card thief wants: no card
  // number, no expiry, no raw provider payload. No credential lives here
  // either — the keys stay in config/payments.json.
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'test' CHECK(mode IN ('test', 'live')),
      reference TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL DEFAULT '',
      session_token TEXT NOT NULL DEFAULT '',
      session_token_hash TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'paid', 'failed', 'mismatch', 'refunded')),
      transaction_id TEXT NOT NULL DEFAULT '',
      transaction_token TEXT NOT NULL DEFAULT '',
      account_tail TEXT NOT NULL DEFAULT '',
      approval TEXT NOT NULL DEFAULT '',
      card_last4 TEXT NOT NULL DEFAULT '',
      card_brand TEXT NOT NULL DEFAULT '',
      installments INTEGER NOT NULL DEFAULT 1,
      refunded INTEGER NOT NULL DEFAULT 0,
      refund_unknown INTEGER NOT NULL DEFAULT 0,
      refund_lock TEXT,
      set_paid INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      verify_count INTEGER NOT NULL DEFAULT 0,
      last_verify_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES store_orders(id) ON DELETE CASCADE
    )
  `);
  // columns that joined the table while the gateway was being reviewed — a
  // database created by an earlier build of this branch gets them here
  const cols = new Set(db.prepare('PRAGMA table_info(store_payments)').all().map((c) => c.name));
  for (const [name, ddl] of [
    ['url', "TEXT NOT NULL DEFAULT ''"],
    ['transaction_token', "TEXT NOT NULL DEFAULT ''"],
    ['account_tail', "TEXT NOT NULL DEFAULT ''"],
    ['session_token_hash', "TEXT NOT NULL DEFAULT ''"],
    // refunds: the sum whose outcome the provider never confirmed (the owner
    // resolves it), the in-flight lock (one refund per row at a time), and
    // whether the gateway itself marked the order paid (only then may a full
    // refund un-mark it — an order paid by hand another way keeps its mark)
    ['refund_unknown', 'INTEGER NOT NULL DEFAULT 0'],
    ['refund_lock', 'TEXT'],
    ['set_paid', 'INTEGER NOT NULL DEFAULT 0']
  ]) {
    if (!cols.has(name)) db.exec(`ALTER TABLE store_payments ADD COLUMN ${name} ${ddl}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_store_payments_order ON store_payments(order_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_store_payments_session ON store_payments(provider, session_id)');
  // one real transaction settles at most ONE row: a replayed confirmation
  // cannot mark a second order paid with the same provider transaction.
  // Per MODE, because Grow's sandbox and production number their
  // transactions independently (the earlier index without `mode` is dropped)
  db.exec('DROP INDEX IF EXISTS idx_store_payments_txn');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_store_payments_transaction ON store_payments(provider, mode, transaction_id) WHERE transaction_id != ''");
}

const STORE_TABLES = [
  'store_meta', 'store_shelves', 'store_products', 'store_variants', 'store_coupons',
  'store_orders', 'store_order_items', 'store_order_events', 'store_backups', 'store_payments'
];

module.exports = { initializeStore, STORE_TABLES };
