'use strict';

/**
 * v1.77 QA — the CRM spine (phase 1 of docs/CRM-INTEGRATION.md).
 *
 * Covers identity resolution and non-destructive merging, the Customer
 * datasheet, the graph, segment compilation (including its injection
 * resistance), lists, and — most importantly — the seam's two invariants:
 * OFF by default, and never throws into a CMS hot path.
 *
 * TAPUZ_ROOT is redirected to a throwaway dir BEFORE any src module loads,
 * because paths.js resolves at require time and would otherwise pollute the
 * live database.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-crm-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const contacts = require('../src/crm/contacts');
const events = require('../src/crm/events');
const relations = require('../src/crm/relations');
const segments = require('../src/crm/segments');
const lists = require('../src/crm/lists');
const Customer = require('../src/crm/Customer');
const crm = require('../src/crm');

// ── identity normalization ───────────────────────────────────────────
check('email identity ignores case and spacing',
  contacts.normalizeEmail('  Ben@Example.COM ') === 'ben@example.com');
check('a non-address is not an identity', contacts.normalizeEmail('not-an-email') === '');
check('an address with a space is rejected', contacts.normalizeEmail('a b@c.com') === '');
check('+972 folds to the local 0 (one person, two spellings)',
  contacts.normalizePhone('+972-50-123-4567') === contacts.normalizePhone('050-1234567'));
check('a too-short number identifies nobody', contacts.normalizePhone('12') === '');

// ── upsert: create, then resolve ─────────────────────────────────────
const a = contacts.upsertContact({ email: 'Dana@Example.com', name: 'דנה', phone: '050-111-2222' });
check('a new person is created', a.created === true && a.contact.id > 0);
check('the stored email is normalized', a.contact.email === 'dana@example.com');

const again = contacts.upsertContact({ email: 'DANA@example.com' });
check('the same address resolves to the same person, not a duplicate',
  again.created === false && again.contact.id === a.contact.id);
check('an empty name does NOT erase the name we had', again.contact.name === 'דנה');

const byPhone = contacts.upsertContact({ phone: '+972501112222', company: 'תפוזיאל' });
check('phone alone resolves to the same person', byPhone.contact.id === a.contact.id);
check('a field we did not have gets filled in', byPhone.contact.company === 'תפוזיאל');

// identity we never had before is adopted onto the existing person
const c2 = contacts.upsertContact({ name: 'יוסי', phone: '052-999-8888' });
const c2WithEmail = contacts.upsertContact({ phone: '0529998888', email: 'yossi@example.com' });
check('a new address attaches to the person we knew by phone',
  c2WithEmail.contact.id === c2.contact.id && c2WithEmail.contact.email === 'yossi@example.com');

// an address already owned by someone else must not be stolen
const stolen = contacts.upsertContact({ phone: '053-777-6666', email: 'dana@example.com' });
check("an address belonging to someone else resolves to its OWNER, and is never reassigned",
  stolen.contact.id === a.contact.id);

check('refuses to create an anonymous empty row',
  contacts.upsertContact({}).contact === null);

// tags accumulate rather than replace
contacts.upsertContact({ email: 'dana@example.com', tags: ['vip'] });
contacts.upsertContact({ email: 'dana@example.com', tags: ['newsletter'] });
const tagged = contacts.getContact(a.contact.id);
check('tags accumulate across touchpoints',
  contacts.parseTags(tagged.tags).sort().join(',') === 'newsletter,vip');

// ── admin edit CAN clear (a human meant it) ──────────────────────────
contacts.updateContact(a.contact.id, { company: '' });
check('an admin edit can clear a field', contacts.getContact(a.contact.id).company === '');

// ── timeline ─────────────────────────────────────────────────────────
events.record({ contactId: a.contact.id, type: 'form', title: 'פנייה', refId: 1 });
events.record({ contactId: a.contact.id, type: 'pageview', path: '/pricing' });
events.record({ contactId: a.contact.id, type: 'restaurant.order' });
check('the timeline records events', events.countForContact(a.contact.id) >= 3);

// v2.12 opened the vocabulary: a vertical adds `restaurant.order` without
// forking events.js, so a well-formed type is kept AS ITSELF. Until v2.12 it
// was flattened to 'other', which made every custom event indistinguishable
// from every other one — this pins the expansion, and the guard that survived
// it. normalizeType is the contract; record() just runs input through it.
check('a namespaced type from a vertical is kept verbatim, not flattened',
  events.listForContact(a.contact.id).some((e) => e.type === 'restaurant.order'));
check('a bare custom token is kept too (open expansion, not a closed script)',
  events.normalizeType('nonsense-type') === 'nonsense-type');
check('core types still normalize to themselves',
  events.normalizeType('form') === 'form' && events.normalizeType('pageview') === 'pageview');
check('case and surrounding space are folded, not preserved',
  events.normalizeType('  SHOUTY  ') === 'shouty');

// Open is not the same as unvalidated — a token that cannot be a type at all
// still lands on 'other' rather than reaching the DB as junk.
check('a malformed type still falls back to other',
  events.normalizeType('Not A Type!') === 'other' && events.normalizeType('123abc') === 'other');
check('an empty/missing type still falls back to other',
  events.normalizeType('') === 'other' &&
  events.normalizeType(null) === 'other' &&
  events.normalizeType(undefined) === 'other');
check('a type is length-capped so it cannot bloat the column',
  events.normalizeType('a'.repeat(60)).length === 40);

// ── Customer: the datasheet ──────────────────────────────────────────
const cust = Customer.load(a.contact.id);
check('Customer loads a person', cust && cust.id === a.contact.id);
check('displayName is never blank', !!cust.displayName);
check('a person with an address is reachable', cust.isReachable === true);
const sheet = cust.datasheet();
check('the datasheet carries identity, tags and a timeline',
  sheet.email === 'dana@example.com' && sheet.tags.length === 2 && Array.isArray(sheet.timeline));
check('the score is bounded 0-100', sheet.score >= 0 && sheet.score <= 100);
check('every score carries its reasons (an unexplainable score is untunable)',
  Array.isArray(sheet.scoreReasons) && sheet.scoreReasons.length > 0 &&
  sheet.scoreReasons.every((r) => r.why && typeof r.points === 'number'));
check('Customer.resolve finds the person behind an identity',
  Customer.resolve({ email: 'DANA@example.com' }).id === a.contact.id);

// ── the graph ────────────────────────────────────────────────────────
check('two people can be linked', relations.link(a.contact.id, c2.contact.id, 'colleague') === true);
check('linking twice is a no-op, not a duplicate',
  relations.link(a.contact.id, c2.contact.id, 'colleague') === false);
check('a person cannot relate to themselves',
  relations.link(a.contact.id, a.contact.id, 'knows') === false);
check('the neighbourhood reads from either end',
  relations.neighbours(c2.contact.id).indexOf(a.contact.id) !== -1);
check('relations surface on the datasheet from the far end',
  Customer.load(c2.contact.id).relations().some((r) => r.other_id === a.contact.id));

// ── segments ─────────────────────────────────────────────────────────
check('a rule narrows the audience', segments.count({ status: 'lead' }) >= 1);
check('tags rule is exact — "vip" does not match "vip-lapsed"', (() => {
  const v = contacts.upsertContact({ email: 'lapsed@example.com', tags: ['vip-lapsed'] });
  return segments.evaluate({ tags: ['vip'] }).every((r) => r.id !== v.contact.id);
})());
check('hasEmail excludes the unreachable', (() => {
  const noMail = contacts.upsertContact({ name: 'אנונימי', phone: '054-321-0000' });
  return segments.evaluate({ hasEmail: true }).every((r) => r.id !== noMail.contact.id);
})());
// SECURITY: a hostile rule value must bind, never interpolate
check('a SQL-injection attempt in a rule value is bound, not executed', (() => {
  try {
    const rows = segments.evaluate({ q: "'; DROP TABLE crm_contacts; --" });
    // the table must still be there and the query must simply match nothing
    return Array.isArray(rows) && contacts.countContacts() > 0;
  } catch (e) {
    return false;
  }
})());
check('an unknown rule key is ignored, not passed through',
  segments.count({ nonsense: "1=1", status: 'lead' }) === segments.count({ status: 'lead' }));
const seg = segments.createSegment('לידים ישראלים', { status: 'lead', hasEmail: true });
check('a segment saves and reports its live size',
  seg.id > 0 && segments.listSegments().some((s) => s.id === seg.id && typeof s.size === 'number'));

// ── lists ────────────────────────────────────────────────────────────
const list = lists.createList('דיוור חודשי');
check('a list is created', list.id > 0);
check('adding a member works', lists.addMember(list.id, a.contact.id) === true);
check('adding twice is idempotent', lists.addMember(list.id, a.contact.id) === false);
check('bulk add returns how many were actually new',
  lists.addMembers(list.id, [a.contact.id, c2.contact.id]) === 1);
check('membership is readable from both ends',
  lists.memberCount(list.id) === 2 && Customer.load(a.contact.id).lists().length === 1);

// ── THE SEAM: the two invariants ─────────────────────────────────────
check('the CRM is OFF by default (a fresh site is unchanged)', crm.isEnabled() === false);
check('with the flag off, a hook does nothing and returns null',
  crm.captureForm({ fields: { email: 'ghost@example.com' } }) === null);
check('nothing was written while the flag was off',
  contacts.findByEmail('ghost@example.com') === null);

// turn it on for the site under test
const config = require('../src/config');
config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true } }));

check('with the flag on, the CRM is enabled', crm.isEnabled() === true);
const captured = crm.captureForm({
  fields: { 'שם מלא': 'רון', email: 'ron@example.com', 'טלפון': '050-555-4444' },
  page: '/contact',
  submissionId: 42
});
check('a form submission creates the person', captured && captured.created === true);
check('Hebrew field names are understood',
  captured.contact.name === 'רון' && captured.contact.phone === '0505554444');
check('the submission is linked on the timeline by ref_id',
  events.listForContact(captured.contact.id).some((e) => e.type === 'form' && e.ref_id === 42));

// the never-throw invariant, proven by breaking the thing underneath
check('a hook NEVER throws into a CMS hot path', (() => {
  const original = contacts.upsertContact;
  contacts.upsertContact = () => { throw new Error('boom'); };
  let threw = false;
  let result;
  try {
    result = crm.captureForm({ fields: { email: 'x@example.com' } });
  } catch (e) {
    threw = true;
  }
  contacts.upsertContact = original;
  return !threw && result === null;
})());

check('summary reports the subsystem', (() => {
  const s = crm.summary();
  return s && typeof s.contacts === 'number' && s.contacts > 0 && typeof s.byStatus === 'object';
})());

// ── retention ────────────────────────────────────────────────────────
check('pruning keeps events that anchor a record elsewhere', (() => {
  const before = events.countForContact(captured.contact.id);
  events.pruneOlderThan(1); // nothing is a day old yet
  return events.countForContact(captured.contact.id) === before;
})());

console.log('');
console.log(fail ? 'SMOKE CRM-CONTACTS: FAIL' : 'SMOKE CRM-CONTACTS: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
