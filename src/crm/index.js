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
 * HOOK — a form was submitted (phase 2 call site: routes/form-capture.js).
 * Resolves or creates the person and records the submission on their timeline.
 *
 * @param {{fields:object, page?:string, submissionId?:number, country?:string}} input
 * @returns {{contact:object, created:boolean}|null}
 */
const captureForm = safe('captureForm', (input = {}) => {
  const identity = identityFromFields(input.fields || {});
  const { contact, created } = contacts.upsertContact(
    Object.assign({}, identity, { source: input.page || 'form', country: input.country || '' })
  );
  if (!contact) return null;
  events.record({
    contactId: contact.id,
    type: 'form',
    path: input.page || '',
    title: identity.name || identity.email || identity.phone || '',
    refId: input.submissionId != null ? input.submissionId : null
  });
  return { contact, created };
});

/**
 * HOOK — a page was viewed (phase 2 call site: server.js beacon).
 * Only recorded against a KNOWN person: an anonymous pageview already lives in
 * `pageviews`, and duplicating it here would grow the timeline without adding
 * knowledge.
 */
const capturePageview = safe('capturePageview', (input = {}) => {
  if (input.contactId == null) return null;
  return events.record({
    contactId: input.contactId,
    type: 'pageview',
    path: input.path || '',
    title: input.title || ''
  });
});

/** HOOK — free-text note against a person (admin/copilot). */
const note = safe('note', (contactId, text) =>
  events.record({ contactId, type: 'note', title: String(text || '').slice(0, 300) })
);

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
  note,
  summary,
  identityFromFields,
  // the subsystem, for the CRM's own admin surfaces
  contacts,
  events,
  relations,
  segments,
  lists,
  Customer
};
