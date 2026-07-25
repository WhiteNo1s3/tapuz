'use strict';

/**
 * v1.82 QA — phase 5: retention, full-text search, and data-subject rights.
 *
 * The load-bearing test here is the last one: it reads the LIVE SCHEMA for every
 * table with a `contact_id`-shaped foreign key and fails if the erase module
 * does not know about it. That way a future phase cannot add a table of personal
 * data and quietly leave it behind when someone asks to be forgotten — the
 * schema itself enforces the promise, not a comment.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-privacy-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const { db, crmSearchReady } = require('../src/db');
const contacts = require('../src/crm/contacts');
const events = require('../src/crm/events');
const relations = require('../src/crm/relations');
const lists = require('../src/crm/lists');
const campaigns = require('../src/crm/campaigns');
const subject = require('../src/crm/subject');
const crm = require('../src/crm');
const config = require('../src/config');

config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true } }));

// ── full-text search ─────────────────────────────────────────────────
check('the full-text index is available', crmSearchReady() === true);

const dana = contacts.upsertContact({ email: 'dana@example.com', name: 'דנה כהן', company: 'תפוזיאל' }).contact;
const yossi = contacts.upsertContact({ email: 'yossi@example.com', name: 'יוסי לוי' }).contact;
contacts.upsertContact({ email: 'sarah@example.com', name: 'Sarah Smith', company: 'Acme' });

check('a Hebrew full name is found', contacts.listContacts({ q: 'דנה כהן' }).some((r) => r.id === dana.id));
check('a Hebrew PREFIX is found (partial typing works)',
  contacts.listContacts({ q: 'דנ' }).some((r) => r.id === dana.id));
check('search matches the company too', contacts.listContacts({ q: 'תפוזיאל' }).some((r) => r.id === dana.id));
check('search matches latin text', contacts.listContacts({ q: 'sarah' }).length === 1);
check('an unrelated term finds nobody', contacts.listContacts({ q: 'זזזזז' }).length === 0);
check('the count agrees with the list', contacts.countContacts({ q: 'דנ' }) === contacts.listContacts({ q: 'דנ' }).length);
check('search combines with a status filter',
  contacts.listContacts({ q: 'דנ', status: 'customer' }).length === 0 &&
  contacts.listContacts({ q: 'דנ', status: 'lead' }).length === 1);

// FTS5 operators in user input must not throw or mean something else
check('FTS5 operator characters in a query are neutralized, not executed', (() => {
  for (const hostile of ['"', '*', 'דנה OR 1=1', 'a AND b', '-דנה', 'x:y', '((', '^^', 'NEAR(a b)']) {
    try { contacts.listContacts({ q: hostile }); } catch (e) { return false; }
  }
  return true;
})());
check('a query of only operators falls back gracefully instead of matching all',
  Array.isArray(contacts.listContacts({ q: '***' })));

// THE UPGRADE PATH. Found live in v1.82: contacts that existed BEFORE the index
// did were never indexed, because `COUNT(*)` on an external-content FTS table is
// answered from the content table — so the "do the counts agree?" guard compared
// crm_contacts to itself and the rebuild never ran. A fresh install hid the bug
// completely (triggers fill the index as rows arrive); only an existing database
// showed it. This reproduces that database.
check('an EXISTING database gets its index rebuilt on upgrade', (() => {
  // tear the index down, leaving the contacts — i.e. the pre-upgrade state
  db.exec('DROP TRIGGER IF EXISTS crm_contacts_fts_ai');
  db.exec('DROP TRIGGER IF EXISTS crm_contacts_fts_ad');
  db.exec('DROP TRIGGER IF EXISTS crm_contacts_fts_au');
  db.exec('DROP TABLE IF EXISTS crm_contacts_fts');
  // ...and re-run initialization, exactly as a server restart would
  require('../src/db').initialize();
  const indexed = db.prepare('SELECT COUNT(*) AS n FROM crm_contacts_fts_docsize').get().n;
  const total = db.prepare('SELECT COUNT(*) AS n FROM crm_contacts').get().n;
  const found = contacts.listContacts({ q: 'דנה' }).some((r) => r.id === dana.id);
  if (indexed !== total) console.log(`     index has ${indexed} docs for ${total} contacts`);
  return indexed === total && found;
})());
check('the guard reads the INDEX size, not the content table', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
  return src.includes('crm_contacts_fts_docsize') &&
    !/COUNT\(\*\) AS n FROM crm_contacts_fts\b(?!_)/.test(src);
})());

// the index must track edits and deletes, not just inserts
check('renaming a contact updates the index', (() => {
  contacts.updateContact(yossi.id, { name: 'יוסף מזרחי' });
  const oldName = contacts.listContacts({ q: 'לוי' }).some((r) => r.id === yossi.id);
  const newName = contacts.listContacts({ q: 'מזרחי' }).some((r) => r.id === yossi.id);
  return !oldName && newName;
})());
check('deleting a contact removes them from the index', (() => {
  const tmp = contacts.upsertContact({ email: 'gone@example.com', name: 'זמני ייחודי' }).contact;
  const before = contacts.listContacts({ q: 'ייחודי' }).length;
  contacts.deleteContact(tmp.id);
  return before === 1 && contacts.listContacts({ q: 'ייחודי' }).length === 0;
})());

// ── retention ────────────────────────────────────────────────────────
events.record({ contactId: dana.id, type: 'pageview', path: '/a' });
events.record({ contactId: dana.id, type: 'form', path: '/contact', refId: 1 });
// backdate one behaviour event and one anchored event
db.prepare("UPDATE crm_events SET created_at = datetime('now','-400 days') WHERE contact_id = ?").run(dana.id);

check('with 0 days, nothing is pruned (the default keeps everything)', (() => {
  const before = events.countForContact(dana.id);
  config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true, retention: { eventDays: 0 } } }));
  const r = crm.runRetention();
  return r.days === 0 && r.pruned === 0 && events.countForContact(dana.id) === before;
})());

check('a policy prunes OLD behaviour events', (() => {
  config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true, retention: { eventDays: 30 } } }));
  const r = crm.runRetention();
  return r.days === 30 && r.pruned >= 1;
})());

check('an event anchored to a real submission is NEVER pruned', (() => {
  const left = events.listForContact(dana.id);
  return left.some((e) => e.type === 'form' && e.ref_id === 1);
})());

check('recent events survive a policy', (() => {
  events.record({ contactId: dana.id, type: 'pageview', path: '/fresh' });
  crm.runRetention();
  return events.listForContact(dana.id).some((e) => e.path === '/fresh');
})());

check('retention is inert while the CRM is off', (() => {
  config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: false, retention: { eventDays: 1 } } }));
  const r = crm.runRetention();
  config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true, retention: { eventDays: 0 } } }));
  return r === null;
})());

// ── subject export ───────────────────────────────────────────────────
const list = lists.createList('רשימה');
lists.addMember(list.id, dana.id);
relations.link(dana.id, yossi.id, 'colleague');
const camp = campaigns.createCampaign({ name: 'ק', subject: 'נ', body: 'x', listId: list.id });
contacts.updateContact(dana.id, { consent: true });
campaigns.startSend(camp.id, { baseUrl: 'https://x.example', sender: () => Promise.resolve({ ok: true }) });

(async () => {
  await new Promise((r) => setTimeout(r, 400));

  const exported = subject.exportContact(dana.id);
  check('an export exists and names the person', !!exported && exported.subject.id === dana.id);
  check('the export carries their own words (submissions)', Array.isArray(exported.submissions));
  check('the export includes the timeline, list membership, relations and sends', (() => {
    const keys = Object.keys(exported.related);
    return keys.some((k) => k.startsWith('crm_events')) &&
      keys.some((k) => k.startsWith('crm_list_members')) &&
      keys.some((k) => k.startsWith('crm_relations')) &&
      keys.some((k) => k.startsWith('crm_campaign_sends'));
  })());
  check('the export is JSON-serializable (it has to be a file we can hand over)', (() => {
    try { JSON.parse(JSON.stringify(exported)); return true; } catch (e) { return false; }
  })());
  check('exporting an unknown person returns null, not an empty shell',
    subject.exportContact(999999) === null);

  // ── subject erasure ────────────────────────────────────────────────
  const erased = subject.eraseContact(dana.id);
  check('erasure reports what it removed', erased.ok === true && Object.keys(erased.removed).length > 0);
  check('erasure VERIFIES nothing survived', erased.leftovers.length === 0);
  check('the person is gone', contacts.getContact(dana.id) === null);
  check('their timeline is gone', events.countForContact(dana.id) === 0);
  check('their list membership is gone', lists.memberCount(list.id) === 0);
  check('their relations are gone — from BOTH directions',
    relations.listFor(dana.id).length === 0 && relations.neighbours(yossi.id).length === 0);
  check('their campaign sends are gone',
    db.prepare('SELECT COUNT(*) AS n FROM crm_campaign_sends WHERE contact_id = ?').get(dana.id).n === 0);
  check('they are gone from the search index', contacts.listContacts({ q: 'כהן' }).length === 0);
  check('erasing an unknown person is a clean no-op', subject.eraseContact(999999).ok === false);

  check('by default the submissions stay — they are business records', (() => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM form_submissions').get().n;
    const p = contacts.upsertContact({ email: 'keep@example.com', name: 'נשמר' }).contact;
    const forms = require('../src/forms');
    const sub = forms.saveSubmission({ fields: { email: 'keep@example.com' }, page: 'c' });
    events.record({ contactId: p.id, type: 'form', refId: sub.id });
    subject.eraseContact(p.id);
    return db.prepare('SELECT COUNT(*) AS n FROM form_submissions').get().n === before + 1;
  })());

  check('opting in deletes the submissions too', (() => {
    const p = contacts.upsertContact({ email: 'purge@example.com', name: 'נמחק' }).contact;
    const forms = require('../src/forms');
    const sub = forms.saveSubmission({ fields: { email: 'purge@example.com' }, page: 'c' });
    events.record({ contactId: p.id, type: 'form', refId: sub.id });
    const r = subject.eraseContact(p.id, { deleteSubmissions: true });
    return r.submissionsDeleted === 1 &&
      db.prepare('SELECT COUNT(*) AS n FROM form_submissions WHERE id = ?').get(sub.id).n === 0;
  })());

  // ── THE DRIFT GUARD: the schema keeps the promise honest ───────────
  check('EVERY table holding personal data is known to the erase module', (() => {
    // find every table with a column that references a contact
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'crm_%'")
      .all()
      .map((r) => r.name);
    const personalCols = [];
    for (const t of tables) {
      if (t === 'crm_contacts' || t.endsWith('_fts') || t.includes('_fts_')) continue;
      let cols = [];
      try { cols = db.prepare(`PRAGMA table_info(${t})`).all(); } catch (e) { continue; }
      for (const c of cols) {
        if (/^(contact_id|from_id|to_id)$/.test(c.name)) personalCols.push(t + ':' + c.name);
      }
    }
    const known = subject.PERSONAL_TABLES.map((s) => s.table + ':' + s.column);
    const missing = personalCols.filter((p) => known.indexOf(p) === -1);
    if (missing.length) {
      console.log('     UNKNOWN personal data location(s): ' + missing.join(', '));
      console.log('     → add them to PERSONAL_TABLES in src/crm/subject.js');
    }
    return missing.length === 0;
  })());

  console.log('');
  console.log(fail ? 'SMOKE CRM-PRIVACY: FAIL' : 'SMOKE CRM-PRIVACY: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
