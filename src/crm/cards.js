'use strict';

/**
 * CRM — progressive customer cards (legitimate first-party only).
 *
 * Philosophy (product, not surveillance):
 *   Everything the visitor *chooses* to show us — a page path, a name field,
 *   an email — can enrich ONE card so we can help them better (right list,
 *   fewer spammy mails). We do NOT store raw IPs, do NOT use third-party
 *   trackers for this, and we do NOT keep provisional ghosts forever.
 *
 * Identity stitch:
 *   First-party HttpOnly cookie `tz_v` (see visitors.js). Same browser → same
 *   card. When they later type email/name, we MERGE into that card instead of
 *   opening a second one.
 *
 * Lifecycle (defaults — configurable under config.crm.cards):
 *   provisional, quiet for `quietDays` (5)  → status `garbage`
 *   garbage for `garbageDays` (3)           → hard erase (subject.erase)
 *   Reachable people (email/phone) are NOT auto-erased by this path; list
 *   law and unsubscribe handle that. Ephemeral cards are the ones we refuse
 *   to keep "for sport".
 */

const contacts = require('./contacts');
const events = require('./events');
const visitors = require('./visitors');
const subject = require('./subject');
const { db } = require('../db');

const DEFAULT_QUIET_DAYS = 5;
const DEFAULT_GARBAGE_DAYS = 3;
/** Named / reachable people: keep until remove or this many quiet days (default 1 year). */
const DEFAULT_NAMED_QUIET_DAYS = 365;
const MAX_INTEREST_TAGS = 24;

function cardsConfig() {
  try {
    const cfg = require('../config').loadConfig();
    const c = (cfg.crm && cfg.crm.cards) || {};
    const named = parseInt(c.namedQuietDays, 10);
    return {
      // Progressive cards ON whenever CRM is on, unless explicitly disabled.
      progressive: c.progressive !== false,
      quietDays: Math.max(1, parseInt(c.quietDays, 10) || DEFAULT_QUIET_DAYS),
      garbageDays: Math.max(1, parseInt(c.garbageDays, 10) || DEFAULT_GARBAGE_DAYS),
      // 0 = never auto-erase named customers (owner must delete manually)
      namedQuietDays: Number.isFinite(named) && named >= 0 ? Math.min(named, 3650) : DEFAULT_NAMED_QUIET_DAYS
    };
  } catch (e) {
    return {
      progressive: true,
      quietDays: DEFAULT_QUIET_DAYS,
      garbageDays: DEFAULT_GARBAGE_DAYS,
      namedQuietDays: DEFAULT_NAMED_QUIET_DAYS
    };
  }
}

/**
 * Turn a URL path into a small interest tag, e.g. `/blog/ai-tools` → `ai-tools`.
 * Skips empty, numeric-only, and boring segments.
 */
function interestFromPath(path) {
  const parts = String(path || '')
    .split(/[/?#]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((s) => !/^\d+$/.test(s))
    .filter((s) => !['index', 'home', 'page', 'p', 'he', 'en', 'he-il', 'admin', 'api'].includes(s));
  if (!parts.length) return '';
  // Prefer last meaningful segment (page topic), fall back to first
  const raw = parts[parts.length - 1] || parts[0];
  const tag = raw
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9\u0590-\u05ff._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return tag ? 'interest:' + tag : '';
}

/**
 * Open a provisional card for this browser, or return the one already bound.
 * Sets/refreshes the first-party cookie. Never stores raw IP.
 *
 * @returns {number|null} contact id
 */
function openOrTouch(req, res) {
  const cfg = cardsConfig();
  if (!cfg.progressive) return visitors.contactIdFor(req);

  const existing = visitors.contactIdFor(req);
  if (existing) {
    visitors.touchFor(req);
    contacts.touchActivity(existing);
    return existing;
  }

  // Brand-new browser on a CRM-enabled site with progressive cards: one ghost
  // card, stitched only by first-party cookie. Empty name/email until they give us some.
  const { contact } = contacts.upsertContact({
    status: 'provisional',
    source: 'visit',
    name: '',
    notes: ''
  });
  if (!contact || !contact.id) return null;
  // Force status if upsert treated empty identity specially
  if (contact.status !== 'provisional') {
    contacts.updateContact(contact.id, { status: 'provisional' });
  }
  visitors.link(req, res, contact.id);
  contacts.touchActivity(contact.id);
  return contact.id;
}

/** Record path interest on the card (tag accumulate, capped). */
function noteInterest(contactId, path) {
  const id = Number(contactId);
  if (!id) return;
  const tag = interestFromPath(path);
  if (!tag) return;
  const row = contacts.getContact(id);
  if (!row) return;
  const tags = contacts.parseTags(row.tags);
  if (tags.includes(tag)) return;
  const interests = tags.filter((t) => t.startsWith('interest:'));
  if (interests.length >= MAX_INTEREST_TAGS) return;
  contacts.updateContact(id, { tags: tags.concat([tag]) });
}

/**
 * Merge `fromId` into `toId` (keep toId). Moves timeline + visitors, then deletes from.
 * Used when a provisional card later gains a real email that already exists — or
 * when form identity resolves to someone else while the cookie held a ghost.
 */
function mergeCards(fromId, toId) {
  const from = Number(fromId);
  const to = Number(toId);
  if (!from || !to || from === to) return { ok: false, error: 'same' };
  const a = contacts.getContact(from);
  const b = contacts.getContact(to);
  if (!a || !b) return { ok: false, error: 'missing' };

  // Prefer filling empty fields on the survivor from the ghost.
  const patch = {};
  for (const key of ['name', 'company', 'source', 'country']) {
    if (!b[key] && a[key]) patch[key] = a[key];
  }
  if (!b.email && a.email) patch.email = a.email;
  if (!b.phone && a.phone) patch.phone = a.phone;
  if (a.consent && !b.consent) patch.consent = 1;
  const mergedTags = contacts.serializeTags(
    contacts.parseTags(b.tags).concat(contacts.parseTags(a.tags))
  );
  if (mergedTags !== (b.tags || '')) patch.tags = mergedTags;
  // Identified person should leave provisional
  if (b.status === 'provisional' || a.status === 'provisional') {
    if (b.email || b.phone || a.email || a.phone) patch.status = 'lead';
  }
  if (Object.keys(patch).length) contacts.updateContact(to, patch);

  db.prepare('UPDATE crm_events SET contact_id = ? WHERE contact_id = ?').run(to, from);
  db.prepare('UPDATE crm_visitors SET contact_id = ? WHERE contact_id = ?').run(to, from);
  // list memberships: ignore conflicts
  try {
    db.prepare(
      `INSERT OR IGNORE INTO crm_list_members (list_id, contact_id)
       SELECT list_id, ? FROM crm_list_members WHERE contact_id = ?`
    ).run(to, from);
  } catch (e) { /* */ }

  contacts.deleteContact(from);
  return { ok: true, kept: to, removed: from };
}

/**
 * Lifecycle sweep:
 *   1) empty provisional quiet → garbage
 *   2) garbage old → erase
 *   3) named/reachable quiet for namedQuietDays (default 365) → erase
 *      (real customers kept long; not the 5-day ghost path)
 *
 * @returns {{ markedGarbage: number, erased: number, erasedNamed: number, quietDays: number, garbageDays: number, namedQuietDays: number }}
 */
function runCardLifecycle() {
  const cfg = cardsConfig();
  const quiet = cfg.quietDays;
  const gar = cfg.garbageDays;
  const namedQuiet = cfg.namedQuietDays;

  // Quiet provisional (no email/phone) → garbage
  const marked = db
    .prepare(
      `UPDATE crm_contacts SET status = 'garbage', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'provisional'
         AND (email IS NULL OR email = '')
         AND (phone IS NULL OR phone = '')
         AND updated_at < datetime('now', ?)`
    )
    .run('-' + quiet + ' days').changes;

  // Old garbage → hard erase (full subject wipe)
  const doomed = db
    .prepare(
      `SELECT id FROM crm_contacts
       WHERE status = 'garbage'
         AND updated_at < datetime('now', ?)
       LIMIT 200`
    )
    .all('-' + gar + ' days');

  let erased = 0;
  for (const row of doomed) {
    try {
      const r = subject.eraseContact(row.id);
      if (r && r.ok) erased++;
      else if (contacts.deleteContact(row.id)) erased++;
    } catch (e) {
      try {
        if (contacts.deleteContact(row.id)) erased++;
      } catch (e2) { /* */ }
    }
  }

  // Named / reachable: indefinitely until owner deletes OR quiet past namedQuietDays.
  // "Saw the user" = updated_at (touchActivity / form / task / portal login).
  let erasedNamed = 0;
  if (namedQuiet >= 1) {
    const namedDoomed = db
      .prepare(
        `SELECT id FROM crm_contacts
         WHERE status NOT IN ('garbage', 'provisional')
           AND (
             (name IS NOT NULL AND name <> '')
             OR (email IS NOT NULL AND email <> '')
             OR (phone IS NOT NULL AND phone <> '')
           )
           AND updated_at < datetime('now', ?)
         LIMIT 100`
      )
      .all('-' + namedQuiet + ' days');
    for (const row of namedDoomed) {
      try {
        // Portal accounts cascade via subject / explicit portal wipe
        try {
          require('./portal').deleteAccountForContact(row.id);
        } catch (e) { /* portal module optional on old trees */ }
        const r = subject.eraseContact(row.id);
        if (r && r.ok) erasedNamed++;
        else if (contacts.deleteContact(row.id)) erasedNamed++;
      } catch (e) {
        try {
          if (contacts.deleteContact(row.id)) erasedNamed++;
        } catch (e2) { /* */ }
      }
    }
  }

  if (marked || erased || erasedNamed) {
    console.log(
      '[crm] cards lifecycle: ' + marked + ' → garbage, ' + erased + ' garbage-erased, ' +
        erasedNamed + ' named-quiet-erased (quiet=' + quiet + 'd, garbage=' + gar +
        'd, named=' + namedQuiet + 'd)'
    );
  }
  return {
    markedGarbage: marked,
    erased,
    erasedNamed,
    quietDays: quiet,
    garbageDays: gar,
    namedQuietDays: namedQuiet
  };
}

/** Interests as clean labels for admin / segments. */
function interestsOf(contactId) {
  const row = contacts.getContact(contactId);
  if (!row) return [];
  return contacts
    .parseTags(row.tags)
    .filter((t) => t.startsWith('interest:'))
    .map((t) => t.slice('interest:'.length));
}

/**
 * Normalize a free-text interest label (Hebrew/Latin) to the same shape
 * path-derived interests use — so manual + automatic tags can match.
 */
function normalizeInterestLabel(raw) {
  const t = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^interest:/, '')
    .replace(/\.html?$/i, '')
    .replace(/[^a-z0-9\u0590-\u05ff._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return t;
}

function fullInterestTag(label) {
  const t = normalizeInterestLabel(label);
  return t ? 'interest:' + t : '';
}

/** Owner (or UI) adds an interest without touching other tags. */
function addInterest(contactId, label) {
  const id = Number(contactId);
  const tag = fullInterestTag(label);
  if (!id || !tag) return { ok: false, error: 'empty' };
  const row = contacts.getContact(id);
  if (!row) return { ok: false, error: 'missing' };
  const tags = contacts.parseTags(row.tags);
  if (tags.includes(tag)) return { ok: true, tag: tag.slice('interest:'.length), already: true };
  const interests = tags.filter((t) => t.startsWith('interest:'));
  if (interests.length >= MAX_INTEREST_TAGS) return { ok: false, error: 'cap' };
  contacts.updateContact(id, { tags: tags.concat([tag]) });
  return { ok: true, tag: tag.slice('interest:'.length) };
}

/** Remove one interest tag; other tags stay. */
function removeInterest(contactId, label) {
  const id = Number(contactId);
  const tag = fullInterestTag(label);
  if (!id || !tag) return { ok: false, error: 'empty' };
  const row = contacts.getContact(id);
  if (!row) return { ok: false, error: 'missing' };
  const next = contacts.parseTags(row.tags).filter((t) => t !== tag);
  contacts.updateContact(id, { tags: next });
  return { ok: true, tag: tag.slice('interest:'.length) };
}

/**
 * Site-wide interest map — what the progressive cards learned.
 * @returns {Array<{label:string, total:number, withEmail:number, provisional:number, reachable:number}>}
 */
function listInterestStats({ limit = 100 } = {}) {
  const cap = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const rows = db
    .prepare(
      `SELECT status, email, phone, tags FROM crm_contacts
       WHERE tags LIKE '%interest:%'`
    )
    .all();
  const map = new Map();
  for (const row of rows) {
    const tags = contacts.parseTags(row.tags);
    const hasEmail = !!(row.email && String(row.email).trim());
    const hasPhone = !!(row.phone && String(row.phone).trim());
    const reachable = hasEmail || hasPhone;
    for (const t of tags) {
      if (!String(t).startsWith('interest:')) continue;
      const label = String(t).slice('interest:'.length);
      if (!label) continue;
      let bucket = map.get(label);
      if (!bucket) {
        bucket = { label, total: 0, withEmail: 0, provisional: 0, reachable: 0 };
        map.set(label, bucket);
      }
      bucket.total++;
      if (hasEmail) bucket.withEmail++;
      if (row.status === 'provisional') bucket.provisional++;
      if (reachable) bucket.reachable++;
    }
  }
  return [...map.values()]
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'he'))
    .slice(0, cap);
}

module.exports = {
  cardsConfig,
  interestFromPath,
  openOrTouch,
  noteInterest,
  mergeCards,
  runCardLifecycle,
  interestsOf,
  normalizeInterestLabel,
  fullInterestTag,
  addInterest,
  removeInterest,
  listInterestStats,
  DEFAULT_QUIET_DAYS,
  DEFAULT_GARBAGE_DAYS,
  DEFAULT_NAMED_QUIET_DAYS,
  MAX_INTEREST_TAGS
};
