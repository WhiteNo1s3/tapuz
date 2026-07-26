'use strict';

/**
 * CRM — the Customer model (v1.77).
 *
 * The one object the rest of the CRM reads. A contact ROW is storage; a
 * Customer is that row plus everything hanging off it — timeline, submissions,
 * relations, lists, an explainable score — behind an interface that does not
 * change when the storage does.
 *
 * Loading is lazy and cached per instance: constructing a Customer costs one
 * row, and each facet costs its query only if something asks for it. That is
 * what makes it safe to build a Customer inside a list rendering loop.
 */

const { db } = require('../db');
const contacts = require('./contacts');
const events = require('./events');

class Customer {
  /** @param {object} row a crm_contacts row */
  constructor(row) {
    if (!row || row.id == null) throw new Error('Customer needs a contact row');
    this.row = row;
    this._cache = {};
  }

  /** @returns {Customer|null} */
  static load(id) {
    const row = contacts.getContact(id);
    return row ? new Customer(row) : null;
  }

  /** Find the person behind an email/phone pair. @returns {Customer|null} */
  static resolve(identity) {
    const row = contacts.resolve(identity || {});
    return row ? new Customer(row) : null;
  }

  /** Wrap rows that were already fetched — no extra query. @returns {Customer[]} */
  static wrap(rows) {
    return (rows || []).map((r) => new Customer(r));
  }

  // ── identity ──
  get id() { return this.row.id; }
  get email() { return this.row.email || ''; }
  get phone() { return this.row.phone || ''; }
  get name() { return this.row.name || ''; }
  get company() { return this.row.company || ''; }
  get status() { return this.row.status || 'lead'; }
  get country() { return this.row.country || ''; }
  get hasConsent() { return !!this.row.consent; }
  get tags() { return contacts.parseTags(this.row.tags); }

  /** Page-derived interests (progressive cards) — without the interest: prefix. */
  get interests() {
    return this.tags
      .filter((t) => String(t).startsWith('interest:'))
      .map((t) => t.slice('interest:'.length));
  }

  /** Never blank: falls back to whatever identifies them, then to the id. */
  get displayName() {
    if (this.name) return this.name;
    if (this.email) return this.email;
    if (this.phone) return this.phone;
    if (this.status === 'provisional') return 'מבקר · #' + this.id;
    if (this.status === 'garbage') return 'למחיקה · #' + this.id;
    return '#' + this.id;
  }

  /** True once we can actually reach them. */
  get isReachable() {
    return !!(this.email || this.phone);
  }

  // ── facets (each cached after first read) ──

  /** The person's timeline, newest first. */
  timeline(limit = 50) {
    const key = 'timeline:' + limit;
    if (!this._cache[key]) this._cache[key] = events.listForContact(this.id, { limit });
    return this._cache[key];
  }

  /**
   * Open attributes bag (v2.12) — vertical/enterprise fields without core schema forks.
   * @param {{ publicOnly?: boolean }} opts
   */
  attrs(opts = {}) {
    const key = 'attrs:' + (opts.publicOnly ? 'pub' : 'all');
    if (this._cache[key]) return this._cache[key];
    try {
      this._cache[key] = require('./attrs').listForContact(this.id, opts);
    } catch (e) {
      this._cache[key] = [];
    }
    return this._cache[key];
  }

  /** Attribute map { key: value }. */
  attrMap(opts = {}) {
    try {
      return require('./attrs').asMap(this.id, opts);
    } catch (e) {
      return {};
    }
  }

  /**
   * Open unified-inbox items for this person (forms, chat, WA, claims).
   * Projector only — does not invent a second store (v2.05).
   */
  inboxItems(limit = 30) {
    const key = 'inbox:' + limit;
    if (this._cache[key]) return this._cache[key];
    try {
      const inbox = require('./unified-inbox');
      this._cache[key] = inbox.listItems({
        contactId: this.id,
        state: 'open',
        limit
      });
    } catch (e) {
      this._cache[key] = [];
    }
    return this._cache[key];
  }

  /**
   * The submissions this person sent. Read through the timeline's `ref_id`
   * rather than re-matching identity against every inbox row — the event is
   * the link, recorded once when the form arrived.
   */
  submissions(limit = 20) {
    const key = 'subs:' + limit;
    if (this._cache[key]) return this._cache[key];
    const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    this._cache[key] = db
      .prepare(
        `SELECT s.* FROM form_submissions s
         JOIN crm_events e ON e.ref_id = s.id AND e.type = 'form'
         WHERE e.contact_id = ?
         ORDER BY s.id DESC LIMIT ?`
      )
      .all(this.id, n);
    return this._cache[key];
  }

  /** Edges in both directions, each with the other person's name resolved. */
  relations() {
    if (this._cache.relations) return this._cache.relations;
    this._cache.relations = db
      .prepare(
        `SELECT r.id, r.kind, r.note,
                CASE WHEN r.from_id = @id THEN r.to_id ELSE r.from_id END AS other_id,
                CASE WHEN r.from_id = @id THEN 'out' ELSE 'in' END AS direction,
                c.name AS other_name, c.email AS other_email
         FROM crm_relations r
         JOIN crm_contacts c ON c.id = CASE WHEN r.from_id = @id THEN r.to_id ELSE r.from_id END
         WHERE r.from_id = @id OR r.to_id = @id
         ORDER BY r.id DESC`
      )
      .all({ id: this.id });
    return this._cache.relations;
  }

  /** Lists this person belongs to. */
  lists() {
    if (this._cache.lists) return this._cache.lists;
    this._cache.lists = db
      .prepare(
        `SELECT l.id, l.name FROM crm_lists l
         JOIN crm_list_members m ON m.list_id = l.id
         WHERE m.contact_id = ? ORDER BY l.name`
      )
      .all(this.id);
    return this._cache.lists;
  }

  /** Companies this person is a member of (v2.09). */
  companies() {
    if (this._cache.companies) return this._cache.companies;
    try {
      this._cache.companies = require('./companies').companiesForContact(this.id);
    } catch (e) {
      this._cache.companies = [];
    }
    return this._cache.companies;
  }

  /** Deals linked to this person (v2.09). */
  deals() {
    if (this._cache.deals) return this._cache.deals;
    try {
      this._cache.deals = require('./deals').dealsForContact(this.id);
    } catch (e) {
      this._cache.deals = [];
    }
    return this._cache.deals;
  }

  /** How many things they have ever done. */
  get eventCount() {
    if (this._cache.eventCount == null) this._cache.eventCount = events.countForContact(this.id);
    return this._cache.eventCount;
  }

  /**
   * Engagement score, 0–100.
   *
   * Deliberately a plain weighted sum with the reasons attached: an
   * unexplainable score is one nobody trusts or tunes. Submissions dominate
   * because asking to be contacted outranks any amount of browsing.
   */
  score() {
    if (this._cache.score) return this._cache.score;
    const reasons = [];
    let total = 0;
    const add = (points, why) => { total += points; reasons.push({ points, why }); };

    const subs = this.submissions(50).length;
    if (subs) add(Math.min(subs * 20, 50), subs + ' פניות בטופס');

    const views = this.timeline(200).filter((e) => e.type === 'pageview').length;
    if (views) add(Math.min(views * 2, 20), views + ' צפיות בדפים');

    if (this.email) add(10, 'יש כתובת מייל');
    if (this.phone) add(10, 'יש טלפון');
    if (this.hasConsent) add(10, 'נתן/ה הסכמה לדיוור');

    this._cache.score = { total: Math.max(0, Math.min(100, total)), reasons };
    return this._cache.score;
  }

  /** The whole person as a plain object — what admin screens and APIs render. */
  datasheet() {
    const s = this.score();
    return {
      id: this.id,
      name: this.name,
      displayName: this.displayName,
      email: this.email,
      phone: this.phone,
      company: this.company,
      status: this.status,
      country: this.country,
      tags: this.tags,
      interests: this.interests,
      statusLabel: contacts.statusLabel(this.status),
      notes: this.row.notes || '',
      consent: this.hasConsent,
      reachable: this.isReachable,
      source: this.row.source || '',
      createdAt: this.row.created_at,
      updatedAt: this.row.updated_at,
      score: s.total,
      scoreReasons: s.reasons,
      eventCount: this.eventCount,
      submissionCount: this.submissions(50).length,
      lists: this.lists(),
      relations: this.relations(),
      companies: this.companies(),
      deals: this.deals(),
      attrs: this.attrs(),
      attrMap: this.attrMap(),
      timeline: this.timeline(20)
    };
  }

  /** Re-read from storage and drop every cached facet. */
  reload() {
    const row = contacts.getContact(this.id);
    if (row) this.row = row;
    this._cache = {};
    return this;
  }
}

module.exports = Customer;
