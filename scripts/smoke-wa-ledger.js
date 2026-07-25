'use strict';

/**
 * v1.86 QA — WhatsApp phase W1: the ledger and the gate.
 *
 * Ports the lab's send-gate assertions against our rebuild, plus the two things
 * we changed on purpose:
 *   - the tier counter is DERIVED FROM THE DATABASE, so it survives a restart
 *     (the lab's process Map did not — its own UI said "(process)"),
 *   - erasure reaches the phone-keyed tables the drift guard cannot see.
 *
 * No network anywhere: decideSend is a pure gate and this phase cannot send.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-wa-ledger-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const { db } = require('../src/db');
const ledger = require('../src/crm/wa-ledger');
const wa = require('../src/crm/whatsapp');
const contacts = require('../src/crm/contacts');
const subject = require('../src/crm/subject');

// ── identity: one person across web and WhatsApp ─────────────────────
check('IL formats collapse to one wa-id',
  ledger.normalizeToWaId('050-123-4567') === '972501234567' &&
  ledger.normalizeToWaId('+972-50-123-4567') === '972501234567' &&
  ledger.normalizeToWaId('972501234567') === '972501234567');
check('garbage is not an identity',
  ledger.normalizeToWaId('abc') === '' && ledger.normalizeToWaId('12') === '');
check('the wa-id agrees with the CRM contact identity', (() => {
  const person = contacts.upsertContact({ phone: '050-123-4567', name: 'וואצאפ' }).contact;
  return ledger.normalizeToWaId(person.phone) === '972501234567';
})());

// ── opt-ins ──────────────────────────────────────────────────────────
check('marketing needs opt-in (fail closed)', (() => {
  const d = ledger.decideSend({ phone: '050-123-4567', msgType: 'template', templateCategory: 'MARKETING' });
  return d.ok === false && d.error === 'marketing_opt_in_required';
})());
check('marketing allowed after opt-in', (() => {
  ledger.grantOptIn('050-123-4567', 'marketing', 'בדיקה');
  return ledger.decideSend({ phone: '+972501234567', msgType: 'template', templateCategory: 'MARKETING' }).ok === true;
})());
check('opt-in matches across phone spellings (normalized before storage)',
  ledger.hasOptIn('9725 0123 4567'.replace(/\s/g, '')) === true);
check('revoke clears the opt-in', (() => {
  ledger.revokeOptIn('050-123-4567', 'marketing');
  const d = ledger.decideSend({ phone: '050-123-4567', msgType: 'template', templateCategory: 'MARKETING' });
  return d.ok === false && d.error === 'marketing_opt_in_required';
})());
check('re-granting after revoke works (three facts, not one flag)', (() => {
  ledger.grantOptIn('050-123-4567', 'marketing');
  return ledger.hasOptIn('050-123-4567') === true;
})());

// ── the customer-service window ──────────────────────────────────────
check('free-form OUTSIDE the window is refused locally — fail closed', (() => {
  const d = ledger.decideSend({ phone: '052-999-8888', msgType: 'text' });
  return d.ok === false && d.error === 'csw_closed_use_template';
})());
check('an inbound message opens the window', (() => {
  ledger.recordMessage({ phone: '052-999-8888', direction: 'in', body: 'שלום' });
  return ledger.getWindow('052-999-8888').open === true;
})());
check('free-form INSIDE the window is allowed and free', (() => {
  const d = ledger.decideSend({ phone: '052-999-8888', msgType: 'text' });
  return d.ok === true && d.pricing.billable === false &&
    d.pricing.pricing_type === 'free_customer_service';
})());
check('an expired window closes', (() => {
  db.prepare("UPDATE crm_wa_windows SET expires_at = datetime('now', '-1 hour') WHERE phone = ?")
    .run('972529998888');
  return ledger.getWindow('052-999-8888').open === false;
})());

// ── pricing (PMP) ────────────────────────────────────────────────────
check('utility inside the window is free',
  ledger.classifyPricing('template', { templateCategory: 'UTILITY', windowOpen: true }).billable === false);
check('utility outside the window is billable',
  ledger.classifyPricing('template', { templateCategory: 'UTILITY', windowOpen: false }).billable === true);
check('marketing is billable even inside the window',
  ledger.classifyPricing('template', { templateCategory: 'MARKETING', windowOpen: true }).billable === true);
check('authentication is billable',
  ledger.classifyPricing('template', { templateCategory: 'AUTHENTICATION', windowOpen: false }).billable === true);
check('free-form is always a free service conversation',
  ledger.classifyPricing('text', { windowOpen: true }).pricing_type === 'free_customer_service');

// ── THE TIER COUNTER: derived, not remembered ────────────────────────
check('the tier ceiling blocks a NEW outside-window recipient', (() => {
  wa.saveSettings({ messagingLimitTier: 'TIER_250' });
  // fill the 24h ledger with 250 distinct outside recipients
  const ins = db.prepare(`
    INSERT INTO crm_wa_messages (phone, direction, msg_type, outside_csw)
    VALUES (?, 'out', 'template', 1)`);
  const tx = db.transaction(() => {
    for (let i = 0; i < 250; i++) ins.run('97250' + String(1000000 + i));
  });
  tx();
  const d = ledger.decideSend({ phone: '053-777-0001', msgType: 'template', templateCategory: 'UTILITY' });
  return d.ok === false && d.error === 'messaging_limit_reached' && d.tier.used === 250;
})());
check('an ALREADY-counted recipient is not blocked (unique recipients, not messages)', (() => {
  const d = ledger.decideSend({ phone: '+97250' + '1000005', msgType: 'template', templateCategory: 'UTILITY' });
  return d.ok === true;
})());
check('THE COUNTER SURVIVES A RESTART (it is the database, not a Map)', (() => {
  // a restart = fresh module state; the only state HERE is the DB, so clear
  // the require cache and re-derive
  delete require.cache[require.resolve('../src/crm/wa-ledger')];
  const fresh = require('../src/crm/wa-ledger');
  return fresh.outsideCswRecipients24h() === 250;
})());
check('old sends age out of the rolling 24h window', (() => {
  db.prepare("UPDATE crm_wa_messages SET created_at = datetime('now', '-2 days') WHERE outside_csw = 1").run();
  return ledger.outsideCswRecipients24h() === 0 &&
    ledger.decideSend({ phone: '053-777-0001', msgType: 'template', templateCategory: 'UTILITY' }).ok === true;
})());
check('a higher tier raises the ceiling', (() => {
  wa.saveSettings({ messagingLimitTier: 'TIER_1K' });
  return ledger.tierLimit() === 1000;
})());
check('an invalid tier falls back rather than becoming unlimited',
  wa.saveSettings({ messagingLimitTier: 'TIER_BANANAS' }).messagingLimitTier === 'TIER_250');

// ── the ledger joins the CRM ─────────────────────────────────────────
check('an inbound message from a KNOWN phone lands on their timeline', (() => {
  const events = require('../src/crm/events');
  const person = contacts.findByPhone('050-123-4567');
  ledger.recordMessage({ phone: '050-123-4567', direction: 'in', body: 'שאלה בוואצאפ' });
  return events.listForContact(person.id).some((e) => e.type === 'chat' && e.path === 'whatsapp');
})());
check('a message from an UNKNOWN phone is still recorded (ledger first, contact later)', (() => {
  const id = ledger.recordMessage({ phone: '054-000-1111', direction: 'in', body: 'מי אתם' });
  const row = db.prepare('SELECT * FROM crm_wa_messages WHERE id = ?').get(id);
  return row && row.contact_id === null && row.phone === '972540001111';
})());
check('a delivery status refines the ledger row', (() => {
  const id = ledger.recordMessage({
    phone: '050-123-4567', direction: 'out', msgType: 'template',
    templateCategory: 'UTILITY', waMessageId: 'wamid.TEST1',
    pricing: ledger.classifyPricing('template', { templateCategory: 'UTILITY', windowOpen: false })
  });
  ledger.updateStatus('wamid.TEST1', { status: 'delivered', pricingType: 'regular', billable: true });
  const row = db.prepare('SELECT * FROM crm_wa_messages WHERE id = ?').get(id);
  return row.status === 'delivered' && row.delivered_at != null && row.billable === 1;
})());

// ── privacy: erasure reaches the phone-keyed tables too ──────────────
check('erasing a person removes their WhatsApp life — messages, opt-ins, window', (() => {
  const person = contacts.findByPhone('050-123-4567');
  ledger.grantOptIn('050-123-4567', 'marketing');
  ledger.openWindow('050-123-4567');
  const r = subject.eraseContact(person.id);
  const waId = '972501234567';
  const msgs = db.prepare('SELECT COUNT(*) n FROM crm_wa_messages WHERE phone = ?').get(waId).n;
  const opt = db.prepare('SELECT COUNT(*) n FROM crm_wa_optins WHERE phone = ?').get(waId).n;
  const win = db.prepare('SELECT COUNT(*) n FROM crm_wa_windows WHERE phone = ?').get(waId).n;
  return r.ok === true && msgs === 0 && opt === 0 && win === 0;
})());
check('the export includes the WhatsApp section', (() => {
  const p = contacts.upsertContact({ phone: '058-111-2222', name: 'מיוצא' }).contact;
  ledger.recordMessage({ phone: '058-111-2222', direction: 'in', body: 'הודעה לייצוא' });
  ledger.grantOptIn('058-111-2222', 'marketing');
  const exp = subject.exportContact(p.id);
  return exp.whatsapp && exp.whatsapp.crm_wa_messages && exp.whatsapp.crm_wa_optins;
})());

// ── nothing in W1 can send ───────────────────────────────────────────
check('the ledger module has no network path', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'wa-ledger.js'), 'utf8');
  return !/fetch\(/.test(src) && !/https?:\/\//.test(src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''));
})());
check('decideSend performs no writes (a pure gate)', (() => {
  const before = db.prepare('SELECT COUNT(*) n FROM crm_wa_messages').get().n;
  ledger.decideSend({ phone: '050-999-0000', msgType: 'template', templateCategory: 'MARKETING' });
  ledger.decideSend({ phone: '050-999-0000', msgType: 'text' });
  return db.prepare('SELECT COUNT(*) n FROM crm_wa_messages').get().n === before;
})());

console.log('');
console.log(fail ? 'SMOKE WA-LEDGER: FAIL' : 'SMOKE WA-LEDGER: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
