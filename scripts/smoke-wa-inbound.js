'use strict';

/**
 * v1.89 QA — WhatsApp phase W4: inbound as CRM material.
 *
 * The phase that makes the channel worth having: an inbound message from an
 * unknown number becomes a PERSON — created from the WhatsApp profile,
 * through the CRM's own upsert — so a WhatsApp conversation and a web
 * enquiry sit on one contact's history. The rules being pinned:
 *
 *   - creation happens through upsertContact, so a later form submission
 *     with the same phone MERGES instead of making a twin,
 *   - an existing contact is never renamed by a WhatsApp display name
 *     (anyone can set theirs to anything),
 *   - consent is NOT implied — messaging a business is service contact,
 *     so the marketing gate still refuses,
 *   - "ledger first, contact later": orphaned rows are adopted,
 *   - erasure still removes the whole WhatsApp life of a WA-born contact.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-wa-inbound-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const { db } = require('../src/db');
const webhook = require('../src/crm/wa-webhook');
const ledger = require('../src/crm/wa-ledger');
const contacts = require('../src/crm/contacts');
const events = require('../src/crm/events');
const subject = require('../src/crm/subject');

const body = (waId, name, text, wamid) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: {
    contacts: name ? [{ wa_id: waId, profile: { name } }] : [],
    messages: [{ from: waId, id: wamid, type: 'text', text: { body: text } }]
  } }] }]
});

// ── an unknown number becomes a person ───────────────────────────────
webhook.processWebhookBody(body('972521112222', 'דנה כהן', 'שלום, יש לכם מלאי?', 'wamid.N1'));
const dana = contacts.findByPhone('052-111-2222');
check('an inbound from an UNKNOWN phone creates a contact from the profile',
  !!dana && dana.name === 'דנה כהן' && dana.source === 'whatsapp');
check('the ledger row is linked to the new person',
  db.prepare('SELECT contact_id FROM crm_wa_messages WHERE wa_message_id = ?').get('wamid.N1').contact_id === dana.id);
check('the message joined the new person\'s timeline',
  events.listForContact(dana.id).some((e) => e.type === 'chat' && e.path === 'whatsapp'));
check('CONSENT IS NOT IMPLIED — the marketing gate still refuses this person',
  dana.consent === 0 &&
  ledger.decideSend({ phone: '052-111-2222', msgType: 'template', templateCategory: 'MARKETING' }).error === 'marketing_opt_in_required');

// ── one person, not one per message ──────────────────────────────────
const contactsBefore = db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n;
webhook.processWebhookBody(body('972521112222', 'דנה כהן', 'עוד שאלה', 'wamid.N2'));
check('a second message from the same phone reuses the person',
  db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n === contactsBefore);

// ── an existing contact is never renamed by a display name ───────────
const original = contacts.upsertContact({ phone: '053-444-5555', name: 'שם מקורי מהאתר' }).contact;
webhook.processWebhookBody(body('972534445555', 'DisplayName123', 'הודעה', 'wamid.N3'));
check('a KNOWN contact keeps their curated name — the WA display name does not overwrite',
  contacts.getContact(original.id).name === 'שם מקורי מהאתר');
check('…and their message still lands on their own timeline',
  db.prepare('SELECT contact_id FROM crm_wa_messages WHERE wa_message_id = ?').get('wamid.N3').contact_id === original.id);

// ── ledger first, contact later: orphans are adopted ─────────────────
db.prepare(`INSERT INTO crm_wa_messages (phone, direction, msg_type, body) VALUES ('972544440000', 'in', 'text', 'הודעה ישנה')`).run();
check('the pre-W4 orphan starts unlinked',
  db.prepare("SELECT contact_id FROM crm_wa_messages WHERE phone = '972544440000'").get().contact_id === null);
webhook.processWebhookBody(body('972544440000', 'אורח חדש', 'חזרתי', 'wamid.N4'));
const guest = contacts.findByPhone('054-444-0000');
check('a new inbound adopts EVERY earlier orphaned row for that phone',
  !!guest && db.prepare("SELECT COUNT(*) n FROM crm_wa_messages WHERE phone = '972544440000' AND contact_id IS NULL").get().n === 0);

// ── a nameless profile still yields a person (phone is identity enough) ──
webhook.processWebhookBody(body('972556667777', '', 'בלי פרופיל', 'wamid.N5'));
check('an inbound with NO profile name still creates a phone-only contact',
  !!contacts.findByPhone('055-666-7777'));

// ── a statuses-only event creates nobody ─────────────────────────────
const preN = db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n;
webhook.processWebhookBody({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: {
    statuses: [{ id: 'wamid.NOPE', status: 'delivered', recipient_id: '972599990000' }]
  } }] }]
});
check('a status callback never creates a contact',
  db.prepare('SELECT COUNT(*) n FROM crm_contacts').get().n === preN);

// ── erasure removes the whole WhatsApp life of a WA-born person ──────
const erased = subject.eraseContact(dana.id);
check('erasing the WA-born person removes contact, messages and timeline',
  erased.ok === true &&
  !contacts.getContact(dana.id) &&
  db.prepare("SELECT COUNT(*) n FROM crm_wa_messages WHERE phone = '972521112222'").get().n === 0);

console.log('');
console.log(fail ? 'SMOKE WA-INBOUND: FAIL' : 'SMOKE WA-INBOUND: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
