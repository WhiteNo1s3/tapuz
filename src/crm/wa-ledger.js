'use strict';

/**
 * CRM — WhatsApp ledger + send gate (v1.86, phase W1).
 *
 * No network in this module, by design: it is the bookkeeping and the DECISION.
 * Phase W3 will do the sending; everything here is what makes that sending
 * refusable *before* money or reputation is spent.
 *
 * The one structural change from the lab: the tier counter is DERIVED FROM THE
 * DATABASE (distinct outside-window recipients in a rolling 24h, straight off
 * `crm_wa_messages`), not held in a process Map. Meta's messaging tier is an
 * account-level ceiling — a counter that forgets on restart undercounts, and
 * then Meta enforces the limit instead of us, which ends in a blocked number
 * rather than a refused send. Deriving by query also means many processes agree
 * for free.
 *
 * `decideSend` stays a PURE gate (DB reads only, no writes, no I/O) — it was
 * the best-tested thing in the lab and purity is what made it testable.
 */

const { db } = require('../db');
const contacts = require('./contacts');

// ── constants (spec: docs/WHATSAPP-SPEC.md in the lab, PMP model) ────
const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const CSW_HOURS = 24;

/** Meta's published per-tier unique-recipient ceilings (outside the CSW, 24h). */
const TIER_LIMITS = {
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  TIER_UNLIMITED: Infinity
};

// ── identity ─────────────────────────────────────────────────────────

/**
 * A wa-id: E.164 digits, no plus. Delegates to the CRM's own normalizer FIRST
 * so a WhatsApp contact and a web-form contact resolve to one person, then
 * re-expands the local form to international (our normalizePhone folds +972 to
 * the local 0; WhatsApp wants it back).
 */
function normalizeToWaId(phone) {
  const local = contacts.normalizePhone(phone); // '0501112222' or ''
  if (!local) return '';
  if (/^05\d{8}$/.test(local)) return '972' + local.slice(1);
  // already-international or foreign numbers: digits as-is (validated length)
  const digits = String(phone).replace(/\D/g, '');
  if (/^\d{10,15}$/.test(digits)) return digits;
  return '';
}

// ── opt-ins ──────────────────────────────────────────────────────────

function grantOptIn(phone, category = 'marketing', note = '') {
  const p = normalizeToWaId(phone);
  const cat = String(category || 'marketing').toLowerCase().slice(0, 30);
  if (!p) return false;
  db.prepare(`
    INSERT INTO crm_wa_optins (phone, category, note) VALUES (?, ?, ?)
    ON CONFLICT(phone, category) DO UPDATE SET
      granted_at = CURRENT_TIMESTAMP, revoked_at = NULL, note = excluded.note
  `).run(p, cat, String(note || '').slice(0, 300));
  return true;
}

function revokeOptIn(phone, category = 'marketing') {
  const p = normalizeToWaId(phone);
  if (!p) return false;
  const info = db.prepare(`
    UPDATE crm_wa_optins SET revoked_at = CURRENT_TIMESTAMP
    WHERE phone = ? AND category = ? AND revoked_at IS NULL
  `).run(p, String(category || 'marketing').toLowerCase());
  return info.changes > 0;
}

function hasOptIn(phone, category = 'marketing') {
  const p = normalizeToWaId(phone);
  if (!p) return false;
  return !!db.prepare(`
    SELECT 1 FROM crm_wa_optins
    WHERE phone = ? AND category = ? AND revoked_at IS NULL
  `).get(p, String(category || 'marketing').toLowerCase());
}

function activeOptIns() {
  return db.prepare('SELECT COUNT(*) AS n FROM crm_wa_optins WHERE revoked_at IS NULL').get().n;
}

// ── the customer-service window ──────────────────────────────────────

/** An INBOUND message opens (or extends) the 24h window. */
function openWindow(phone, { fepHours = 0 } = {}) {
  const p = normalizeToWaId(phone);
  if (!p) return false;
  const fep = fepHours > 0 ? `datetime('now', '+${Math.min(fepHours, 72)} hours')` : 'NULL';
  db.prepare(`
    INSERT INTO crm_wa_windows (phone, opened_at, expires_at, fep_expires_at)
    VALUES (?, CURRENT_TIMESTAMP, datetime('now', '+${CSW_HOURS} hours'), ${fep})
    ON CONFLICT(phone) DO UPDATE SET
      opened_at = CURRENT_TIMESTAMP,
      expires_at = datetime('now', '+${CSW_HOURS} hours'),
      fep_expires_at = ${fep}
  `).run(p);
  return true;
}

function getWindow(phone) {
  const p = normalizeToWaId(phone);
  const row = p ? db.prepare('SELECT * FROM crm_wa_windows WHERE phone = ?').get(p) : null;
  if (!row) return { open: false, fepOpen: false, expires_at: null };
  const open = Date.parse(row.expires_at + 'Z') > Date.now() ||
    Date.parse(row.expires_at) > Date.now(); // SQLite stores UTC without the Z
  const fepOpen = !!(row.fep_expires_at &&
    (Date.parse(row.fep_expires_at + 'Z') > Date.now() || Date.parse(row.fep_expires_at) > Date.now()));
  return { open, fepOpen, expires_at: row.expires_at };
}

function openWindows() {
  return db.prepare("SELECT COUNT(*) AS n FROM crm_wa_windows WHERE datetime(expires_at) > datetime('now')").get().n;
}

// ── the tier counter, derived not remembered ─────────────────────────

function tierLimit() {
  // the configured tier lives with the channel settings (W0 store)
  const tier = String(require('./whatsapp')._load().messagingLimitTier || 'TIER_250').toUpperCase();
  return TIER_LIMITS[tier] !== undefined ? TIER_LIMITS[tier] : TIER_LIMITS.TIER_250;
}

/** Distinct outside-window recipients in the rolling 24h — from the ledger. */
function outsideCswRecipients24h() {
  return db.prepare(`
    SELECT COUNT(DISTINCT phone) AS n FROM crm_wa_messages
    WHERE outside_csw = 1 AND datetime(created_at) > datetime('now', '-1 day')
  `).get().n;
}

function isCountedOutside(phone) {
  return !!db.prepare(`
    SELECT 1 FROM crm_wa_messages
    WHERE outside_csw = 1 AND phone = ? AND datetime(created_at) > datetime('now', '-1 day')
  `).get(phone);
}

// ── pricing (PMP): what a send will cost, decided before it happens ──

/**
 * @returns {{category:string, billable:boolean, pricing_type:string}}
 */
function classifyPricing(msgType, { templateCategory, windowOpen, fepOpen } = {}) {
  if (msgType !== 'template') {
    // free-form is a service conversation — free (and only possible in-window)
    return { category: 'service', billable: false, pricing_type: 'free_customer_service' };
  }
  const t = String(templateCategory || 'UTILITY').toUpperCase();
  const category = t === 'MARKETING' ? 'marketing' : t === 'AUTHENTICATION' ? 'authentication' : 'utility';
  if (category === 'utility' && (windowOpen || fepOpen)) {
    return { category, billable: false, pricing_type: 'free_customer_service' };
  }
  // marketing + authentication are billable everywhere; utility outside CSW too
  return { category, billable: true, pricing_type: 'regular' };
}

// ── THE GATE ─────────────────────────────────────────────────────────

/**
 * Pure decision: may this message be sent, and what will it be?
 * DB reads only — no writes, no network, nothing to mock.
 *
 * Refusals, in the order they are checked (cheapest first, all local):
 *   invalid_phone · marketing_opt_in_required · csw_closed_use_template ·
 *   messaging_limit_reached
 *
 * @returns {{ok:boolean, error?:string, phone?:string, pricing?:object,
 *            window?:object, outside_csw?:boolean, tier?:{limit:number,used:number}}}
 */
function decideSend({ phone, msgType = 'text', templateCategory = 'UTILITY' } = {}) {
  const p = normalizeToWaId(phone);
  if (!p) return { ok: false, error: 'invalid_phone' };

  const type = msgType === 'template' ? 'template' : 'text';
  const tcat = String(templateCategory || 'UTILITY').toUpperCase();

  // Marketing hard-requires a live marketing opt-in. Fail closed, our layer.
  if (type === 'template' && tcat === 'MARKETING' && !hasOptIn(p, 'marketing')) {
    return { ok: false, error: 'marketing_opt_in_required', phone: p };
  }

  const win = getWindow(p);

  // Free-form only while the window is open. Outside → templates only.
  if (type !== 'template' && !win.open) {
    return { ok: false, error: 'csw_closed_use_template', phone: p, window: win };
  }

  const outside = type === 'template' && !win.open;

  // The tier ceiling: refuse locally BEFORE Meta refuses for us.
  if (outside) {
    const limit = tierLimit();
    if (limit !== Infinity && !isCountedOutside(p)) {
      const used = outsideCswRecipients24h();
      if (used >= limit) {
        return {
          ok: false, error: 'messaging_limit_reached', phone: p,
          tier: { limit, used }
        };
      }
    }
  }

  return {
    ok: true,
    phone: p,
    outside_csw: outside,
    window: win,
    pricing: classifyPricing(type, { templateCategory: tcat, windowOpen: win.open, fepOpen: win.fepOpen })
  };
}

// ── the ledger ───────────────────────────────────────────────────────

/**
 * W4: an inbound message may introduce a NEW person. Resolve the phone to a
 * contact, creating one from the WhatsApp profile if unknown — through the
 * CRM's own upsert, so a later web-form submission with the same phone merges
 * into this person instead of making a twin. An EXISTING contact is never
 * touched: their curated name must not be overwritten by a WhatsApp display
 * name anyone can set to anything.
 *
 * Consent is NOT implied: messaging a business is service contact, not a
 * marketing opt-in — the contact is created with consent 0 and no wa opt-in,
 * so the marketing gate still refuses until a real opt-in is recorded.
 *
 * Also adopts any earlier orphaned ledger rows for the phone ("ledger first,
 * contact later" — this is the "later").
 */
function ensureContact(phone, name = '') {
  const p = normalizeToWaId(phone);
  if (!p) return null;
  let person = null;
  try { person = contacts.findByPhone(p); } catch (e) { person = null; }
  if (!person) {
    try {
      const up = contacts.upsertContact({
        phone: p,
        name: String(name || '').trim().slice(0, 200),
        source: 'whatsapp'
      });
      person = up && up.contact;
    } catch (e) { person = null; }
  }
  if (person) {
    db.prepare('UPDATE crm_wa_messages SET contact_id = ? WHERE phone = ? AND contact_id IS NULL')
      .run(person.id, p);
  }
  return person ? person.id : null;
}

/**
 * Record a message (either direction). An INBOUND message also opens the
 * window and — through the guarded seam — joins the person's timeline.
 */
function recordMessage({
  phone, direction, msgType = 'text', templateCategory = null,
  pricing = null, outsideCsw = false, body = '', waMessageId = null, status, error = null
} = {}) {
  const p = normalizeToWaId(phone);
  if (!p || (direction !== 'in' && direction !== 'out')) return null;

  // Meta RETRIES a webhook until it sees a 2xx, so the same wamid arriving
  // twice must resolve to the one existing row — silently, before it can
  // trip the UNIQUE index or re-extend the window (v1.87, W2).
  if (waMessageId) {
    const dup = db.prepare('SELECT id FROM crm_wa_messages WHERE wa_message_id = ?')
      .get(String(waMessageId).slice(0, 100));
    if (dup) return dup.id;
  }

  if (direction === 'in') openWindow(p);

  // resolve the person, if we know them — identity shared with the whole CRM
  let contactId = null;
  try {
    const person = contacts.findByPhone(p);
    if (person) contactId = person.id;
  } catch (e) { /* unknown phone is fine */ }

  const info = db.prepare(`
    INSERT INTO crm_wa_messages
      (phone, contact_id, direction, msg_type, template_category,
       pricing_category, pricing_type, billable, status, wa_message_id, outside_csw, body, error)
    VALUES (@phone, @contact_id, @direction, @msg_type, @template_category,
            @pricing_category, @pricing_type, @billable, @status, @wa_message_id, @outside_csw, @body, @error)
  `).run({
    phone: p,
    contact_id: contactId,
    direction,
    msg_type: msgType === 'template' ? 'template' : 'text',
    template_category: templateCategory ? String(templateCategory).toUpperCase().slice(0, 20) : null,
    pricing_category: pricing ? pricing.category : null,
    pricing_type: pricing ? pricing.pricing_type : null,
    billable: pricing && pricing.billable ? 1 : 0,
    status: status || (direction === 'in' ? 'received' : 'accepted'),
    wa_message_id: waMessageId ? String(waMessageId).slice(0, 100) : null,
    outside_csw: outsideCsw ? 1 : 0,
    body: String(body || '').slice(0, 4000),
    error: error != null ? String(error).slice(0, 300) : null
  });

  // inbound joins the timeline through the seam (flag-gated, never throws)
  if (direction === 'in' && contactId != null) {
    try {
      require('./index').note && require('./events').record({
        contactId, type: 'chat', path: 'whatsapp',
        title: String(body || '').slice(0, 120), refId: info.lastInsertRowid
      });
    } catch (e) { /* the ledger row is the record; the timeline is a bonus */ }
  }
  return info.lastInsertRowid;
}

/** Delivery/status update from the W2 webhook — also refines pricing. */
function updateStatus(waMessageId, { status, pricingType, pricingCategory, billable, error } = {}) {
  const sets = ["status = @status"];
  const args = { id: String(waMessageId || ''), status: String(status || '').slice(0, 30) };
  if (status === 'delivered') sets.push('delivered_at = CURRENT_TIMESTAMP');
  if (pricingType !== undefined) { sets.push('pricing_type = @pt'); args.pt = String(pricingType).slice(0, 40); }
  if (pricingCategory !== undefined) { sets.push('pricing_category = @pc'); args.pc = String(pricingCategory).slice(0, 30); }
  if (billable !== undefined) { sets.push('billable = @b'); args.b = billable ? 1 : 0; }
  if (error !== undefined) { sets.push('error = @err'); args.err = String(error).slice(0, 300); }
  const info = db.prepare(
    `UPDATE crm_wa_messages SET ${sets.join(', ')} WHERE wa_message_id = @id`
  ).run(args);
  return info.changes > 0;
}

function messagesFor(phone, { limit = 100 } = {}) {
  const p = normalizeToWaId(phone);
  const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  if (!p) return [];
  return db.prepare('SELECT * FROM crm_wa_messages WHERE phone = ? ORDER BY id DESC LIMIT ?').all(p, n);
}

function recentMessages({ limit = 50 } = {}) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  return db.prepare('SELECT * FROM crm_wa_messages ORDER BY id DESC LIMIT ?').all(n);
}

// ── money (W3): the cap and the count mean nothing until they are money ──

/**
 * Meta's per-message PMP rates for Israel, USD — an ESTIMATE for display
 * (the admin says so): the binding price is what Meta bills. Service
 * conversations and in-window utility are free and never counted here.
 */
const PRICE_USD = { marketing: 0.0353, utility: 0.0053, authentication: 0.0159 };

/**
 * Estimated spend from DELIVERED billable rows — because Meta charges at
 * delivery, which is exactly what the W2 webhook refines. An accepted-but-
 * undelivered message costs nothing yet, and a failed one never will.
 */
function spendEstimate() {
  const count = (where) => db.prepare(`
    SELECT pricing_category cat, COUNT(*) n FROM crm_wa_messages
    WHERE direction = 'out' AND billable = 1 AND delivered_at IS NOT NULL ${where}
    GROUP BY pricing_category`).all();
  const tally = (rows) => {
    let usd = 0; let n = 0;
    for (const r of rows) { usd += (PRICE_USD[r.cat] || 0) * r.n; n += r.n; }
    return { n, usd: Math.round(usd * 10000) / 10000 };
  };
  return {
    month: tally(count("AND strftime('%Y-%m', delivered_at) = strftime('%Y-%m', 'now')")),
    total: tally(count('')),
    prices: PRICE_USD,
    note: 'הערכה לפי תעריפי WhatsApp לישראל — החיוב בפועל נקבע על ידי מטא בעת המסירה'
  };
}

/** Headline numbers for the admin screen. */
function summary() {
  return {
    messages: db.prepare('SELECT COUNT(*) AS n FROM crm_wa_messages').get().n,
    billable: db.prepare('SELECT COUNT(*) AS n FROM crm_wa_messages WHERE billable = 1').get().n,
    activeOptIns: activeOptIns(),
    openWindows: openWindows(),
    tier: { limit: tierLimit(), used: outsideCswRecipients24h() }
  };
}

module.exports = {
  TEMPLATE_CATEGORIES, TIER_LIMITS, CSW_HOURS,
  normalizeToWaId,
  grantOptIn, revokeOptIn, hasOptIn, activeOptIns,
  openWindow, getWindow, openWindows,
  tierLimit, outsideCswRecipients24h,
  classifyPricing, decideSend,
  ensureContact, recordMessage, updateStatus, messagesFor, recentMessages, summary,
  PRICE_USD, spendEstimate
};
