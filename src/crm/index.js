'use strict';

/**
 * CRM — the seam (v1.77).
 *
 * The ONLY module the CMS is allowed to call. Everything the CMS knows about
 * the CRM is the handful of hooks below; the CRM never reaches back into CMS
 * internals. That boundary is what makes the CRM a separable product rather
 * than a tangle of features (docs/CRM-INTEGRATION.md §2).
 *
 * Two invariants hold for every hook here:
 *
 *   1. FLAG — with `config.crm.enabled` false, every hook returns immediately
 *      and touches nothing. The CMS behaves exactly as it did before the CRM.
 *   2. NEVER THROW — a hook is called from live paths (a form submission, a
 *      pageview). A CRM bug must never cost a lead or 500 a page, so every
 *      hook is wrapped: it logs and returns null instead of propagating.
 *
 * Anything that needs to fail loudly (the admin screens) imports the concrete
 * modules directly — the guard is for the CMS's hot paths, not for the CRM's
 * own surfaces.
 */

const contacts = require('./contacts');
const events = require('./events');
const relations = require('./relations');
const segments = require('./segments');
const lists = require('./lists');
const visitors = require('./visitors');
const conversions = require('./conversions');
const campaigns = require('./campaigns');
const subject = require('./subject');
const cs = require('./cs');
const cards = require('./cards');
const sites = require('./sites');
const identityClaims = require('./identity-claims');
const tasks = require('./tasks');
const taskReminders = require('./task-reminders');
const sequences = require('./sequences');
const unifiedInbox = require('./unified-inbox');
const companies = require('./companies');
const deals = require('./deals');
const portal = require('./portal');
const hooks = require('./hooks');
const attrs = require('./attrs');
const Customer = require('./Customer');

/** Is the CRM turned on for this site? */
function isEnabled() {
  try {
    const cfg = require('../config').loadConfig();
    return !!(cfg && cfg.crm && cfg.crm.enabled);
  } catch (e) {
    return false; // unreadable config = off, never a crash
  }
}

/**
 * Wrap a hook so the CMS can call it without a try/catch at every call site.
 * Returns null when the CRM is off or when anything inside went wrong.
 */
function safe(label, fn) {
  return function guarded(...args) {
    if (!isEnabled()) return null;
    try {
      return fn.apply(null, args);
    } catch (e) {
      console.error('[crm] ' + label + ' failed:', e.message);
      return null;
    }
  };
}

/** Pull identity out of arbitrary form fields — people name their inputs anything. */
function identityFromFields(fields = {}) {
  const pick = (names) => {
    for (const key of Object.keys(fields)) {
      const k = key.toLowerCase();
      if (names.some((n) => k === n || k.includes(n))) {
        const v = String(fields[key] == null ? '' : fields[key]).trim();
        if (v) return v;
      }
    }
    return '';
  };
  return {
    email: pick(['email', 'mail', 'אימייל', 'מייל', 'דוא"ל']),
    phone: pick(['phone', 'tel', 'mobile', 'טלפון', 'נייד']),
    name: pick(['name', 'fullname', 'שם']),
    company: pick(['company', 'org', 'חברה', 'עסק'])
  };
}

/**
 * HOOK — a form was submitted (call site: routes/form-capture.js).
 *
 * Resolves or creates the person, records the submission on their timeline,
 * and — because they just chose to identify themselves — links this browser to
 * them so their later visits have somewhere to land. Passing `req`/`res` is
 * optional: without them the person is still recorded, just not linked.
 *
 * @param {{fields:object, page?:string, submissionId?:number, country?:string, req?:object, res?:object}} input
 * @returns {{contact:object, created:boolean}|null}
 */
const captureForm = safe('captureForm', (input = {}) => {
  const identity = identityFromFields(input.fields || {});
  // Progressive card already open on this browser? Prefer enriching THAT card
  // so we never mint a second person for one visitor.
  const priorId = input.req ? visitors.contactIdFor(input.req) : null;
  const prior = priorId ? contacts.getContact(priorId) : null;
  let contact = null;
  let created = false;

  const resolved = contacts.resolve({ email: identity.email, phone: identity.phone });

  if (prior && (prior.status === 'provisional' || prior.status === 'garbage')) {
    if (resolved && resolved.id !== prior.id) {
      // Form identity already belongs to someone else → merge ghost into them.
      cards.mergeCards(prior.id, resolved.id);
      contact = contacts.getContact(resolved.id);
      created = false;
      // apply any new name etc.
      contacts.upsertContact(
        Object.assign({}, identity, { source: input.page || 'form', country: input.country || '' })
      );
      contact = contacts.getContact(resolved.id) || contact;
    } else {
      // Enrich the same provisional card in place.
      const patch = {
        status: identity.email || identity.phone ? 'lead' : prior.status
      };
      if (identity.email) patch.email = identity.email;
      if (identity.phone) patch.phone = identity.phone;
      if (identity.name) patch.name = identity.name;
      if (identity.company) patch.company = identity.company;
      if (input.country) patch.country = input.country;
      contacts.updateContact(prior.id, patch);
      contact = contacts.getContact(prior.id);
      created = false;
    }
  } else {
    const up = contacts.upsertContact(
      Object.assign({}, identity, {
        source: input.page || 'form',
        country: input.country || '',
        status: identity.email || identity.phone ? 'lead' : undefined
      })
    );
    contact = up.contact;
    created = up.created;
  }

  if (!contact) return null;

  events.record({
    contactId: contact.id,
    type: 'form',
    path: input.page || '',
    title: identity.name || identity.email || identity.phone || '',
    refId: input.submissionId != null ? input.submissionId : null
  });
  if (input.req && input.res) visitors.link(input.req, input.res, contact.id);
  contacts.touchActivity(contact.id);

  // Server-side conversion (v1.80). Fire-and-forget on purpose: the visitor's
  // redirect must not wait on Meta or Google. The eventId travels back to the
  // caller so the thank-you page can fire the BROWSER pixel with the same id —
  // that shared id is what makes the vendor treat two reports as one event.
  const eventId = conversions.newEventId();
  try {
    const cfg = require('../config').loadConfig();
    conversions.sendConversion({
      config: cfg, contact, eventId, req: input.req,
      page: input.page, eventName: 'Lead'
    }).catch(() => { /* reported inside; never surfaces here */ });
  } catch (e) {
    console.error('[crm] conversion dispatch failed:', e.message);
  }

  return { contact, created, eventId };
});

/**
 * HOOK — a page was viewed (call site: the /_tapuz/collect beacon).
 *
 * With progressive cards (default when CRM is on): open or touch a customer
 * card stitched by first-party cookie, record the path as interest, append
 * timeline. Without progressive cards (or before cookie): only browsers already
 * linked by a form get timeline rows — classic phase-2 behaviour.
 *
 * Anonymous analytics still live only in `pageviews` (daily hash, no cross-day
 * follow). We never write raw IP onto the card.
 *
 * @param {{req:object, res?:object, path?:string, title?:string, contactId?:number}} input
 */
const capturePageview = safe('capturePageview', (input = {}) => {
  let contactId = input.contactId != null ? input.contactId : null;
  if (contactId == null && input.req) {
    contactId = visitors.contactIdFor(input.req);
  }
  // Progressive: first legitimate visit can open a provisional card.
  if (contactId == null && input.req && input.res) {
    contactId = cards.openOrTouch(input.req, input.res);
  } else if (contactId != null && input.req) {
    visitors.touchFor(input.req);
    contacts.touchActivity(contactId);
  }
  if (contactId == null) return null;

  cards.noteInterest(contactId, input.path || '');
  return events.record({
    contactId,
    type: 'pageview',
    path: input.path || '',
    title: input.title || ''
  });
});

/** Which person is this browser, if any? Null is the normal answer. */
const contactIdForRequest = safe('contactIdForRequest', (req) => visitors.contactIdFor(req));

/** HOOK — free-text note against a person (admin/copilot). */
const note = safe('note', (contactId, text) =>
  events.record({ contactId, type: 'note', title: String(text || '').slice(0, 300) })
);

/**
 * HOOK — enforce the retention policy (call site: server.js, on boot and daily).
 *
 * Prunes behaviour events older than `crm.retention.eventDays`. Events that
 * anchor a record elsewhere (a form submission) are kept regardless, because
 * deleting the link to someone's own message is not hygiene, it is data loss.
 * 0 days means keep everything — the default, since quietly deleting an owner's
 * history would be worse than letting it grow.
 *
 * @returns {{pruned:number, days:number}|null}
 */
const runRetention = safe('runRetention', () => {
  const cfg = require('../config').loadConfig();
  const days = parseInt((cfg.crm && cfg.crm.retention && cfg.crm.retention.eventDays) || 0, 10);
  let pruned = 0;
  if (days && days >= 1) {
    pruned = events.pruneOlderThan(days);
    if (pruned) console.log('[crm] retention pruned ' + pruned + ' events older than ' + days + ' days');
  }
  // Progressive cards: quiet provisional → garbage → hard erase (not forever).
  const cardsLife = cards.runCardLifecycle();
  // Task digest email (v2.01) — best-effort, same daily cadence.
  try { taskReminders.maybeSendDaily(); } catch (e) { /* never block retention */ }
  // Sequence drip (v2.03) — process due steps politely.
  try { sequences.maybeProcessDaily(); } catch (e) { /* never block retention */ }
  return { pruned, days: days || 0, cards: cardsLife };
});

/** Headline numbers for the admin dashboard. Null when the CRM is off. */
const summary = safe('summary', () => {
  const counts = contacts.statusCounts();
  return {
    contacts: counts.total,
    byStatus: counts,
    segments: segments.listSegments().length,
    lists: lists.listAll().length,
    relations: relations.countAll()
  };
});

module.exports = {
  isEnabled,
  // hooks the CMS may call
  captureForm,
  capturePageview,
  contactIdForRequest,
  note,
  runRetention,
  summary,
  identityFromFields,
  // the subsystem, for the CRM's own admin surfaces
  contacts,
  events,
  relations,
  segments,
  lists,
  visitors,
  conversions,
  campaigns,
  subject,
  cs,
  cards,
  sites,
  identityClaims,
  tasks,
  taskReminders,
  sequences,
  unifiedInbox,
  companies,
  deals,
  portal,
  hooks,
  attrs,
  Customer
};
