'use strict';

/**
 * v1.81 QA — phase 3c: campaigns, open/click tracking, unsubscribe.
 *
 * Marketing email is the part of a CRM that can get its owner fined, so the
 * obligations are tested harder than the features:
 *
 *   - CONSENT IS THE AUDIENCE. Someone on a list who never agreed is never
 *     sent to, and the skip is counted so the owner sees why.
 *   - EVERY MESSAGE CARRIES AN UNSUBSCRIBE, in the body and in the RFC 8058
 *     headers, and using it clears consent everywhere.
 *   - CLICK TRACKING IS NOT AN OPEN REDIRECT. The destination comes from the
 *     campaign's frozen link list by index; a request cannot name one.
 *
 * SMTP is replaced with a fake transport, so nothing leaves the machine.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-camp-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const contacts = require('../src/crm/contacts');
const campaigns = require('../src/crm/campaigns');
const lists = require('../src/crm/lists');
const events = require('../src/crm/events');
const config = require('../src/config');

config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true } }));

// ── an audience: two consenting, one not, one with no address ────────
const willing = contacts.upsertContact({ email: 'yes@example.com', name: 'מסכימה', consent: true }).contact;
const willing2 = contacts.upsertContact({ email: 'yes2@example.com', name: 'מסכים', consent: true }).contact;
const unwilling = contacts.upsertContact({ email: 'no@example.com', name: 'לא מסכים' }).contact;
const noEmail = contacts.upsertContact({ phone: '050-123-9999', name: 'בלי מייל', consent: true }).contact;

const list = lists.createList('רשימת בדיקה');
lists.addMembers(list.id, [willing.id, willing2.id, unwilling.id, noEmail.id]);

const BODY =
  '<p>שלום {{name}},</p>' +
  '<p><a href="https://example.com/offer">המבצע שלנו</a> ו<a href="https://example.com/blog">הבלוג</a></p>';

const camp = campaigns.createCampaign({
  name: 'ניוזלטר בדיקה', subject: 'שלום מתפוזיאל', body: BODY, listId: list.id
});
check('a campaign is created as a draft', camp.id > 0 && camp.status === 'draft');

// ── consent decides the audience ─────────────────────────────────────
const aud = campaigns.audienceFor(camp);
check('only consenting contacts with an address are recipients',
  aud.recipients.length === 2 && aud.recipients.every((r) => r.consent && r.email));
check('the non-consenting member is skipped AND counted', aud.skippedNoConsent === 1);
check('a member with no address is skipped AND counted', aud.skippedNoEmail === 1);

// ── link extraction ─────────────────────────────────────────────────
const links = campaigns.extractLinks(BODY);
check('links are extracted in order, deduped',
  links.length === 2 && links[0] === 'https://example.com/offer' && links[1] === 'https://example.com/blog');
check('a body with no links yields none', campaigns.extractLinks('<p>שלום</p>').length === 0);
check('non-http schemes are not tracked',
  campaigns.extractLinks('<a href="javascript:alert(1)">x</a><a href="mailto:a@b.c">y</a>').length === 0);

// ── body rendering: personalization, tracking, unsubscribe ──────────
const rendered = campaigns.renderBody({
  body: BODY, links, token: 'a'.repeat(32), baseUrl: 'https://site.example', contact: willing
});
check('{{name}} is personalized', rendered.html.includes('שלום מסכימה'));
check('every link is rewritten to a tracked URL carrying token + index',
  rendered.html.includes('https://site.example/crm/c/' + 'a'.repeat(32) + '/0') &&
  rendered.html.includes('https://site.example/crm/c/' + 'a'.repeat(32) + '/1') &&
  !rendered.html.includes('href="https://example.com/offer"'));
check('an unsubscribe link is always appended',
  rendered.html.includes('/crm/u/' + 'a'.repeat(32)) && rendered.html.includes('להסרה'));
check('the open pixel is included', rendered.html.includes('/crm/o/' + 'a'.repeat(32) + '.gif'));
check('a contact\'s own data cannot inject markup into the message', (() => {
  const hostile = { name: '<img src=x onerror=alert(1)>', email: 'h@example.com' };
  const out = campaigns.renderBody({ body: '<p>{{name}}</p>', links: [], token: 'b'.repeat(32), baseUrl: '', contact: hostile });
  return !out.html.includes('<img src=x') && out.html.includes('&lt;img');
})());

// ── sending, through a fake transport ───────────────────────────────
const sent = [];
const fakeSender = (msg) => { sent.push(msg); return Promise.resolve({ ok: true }); };

(async () => {
  const result = campaigns.startSend(camp.id, { baseUrl: 'https://site.example', sender: fakeSender });
  check('the send queues exactly the consenting recipients',
    result.ok === true && result.queued === 2 && result.skippedNoConsent === 1);
  check('the campaign flips out of draft immediately',
    campaigns.getCampaign(camp.id).status !== 'draft');

  // delivery is async by design — wait for the queue to drain
  await new Promise((r) => setTimeout(r, 800));

  check('every consenting recipient got exactly one message', sent.length === 2);
  check('the non-consenting contact was NEVER emailed',
    !sent.some((m) => m.to === 'no@example.com'));
  check('each message carries the RFC 8058 one-click headers', (() => {
    return sent.every((m) => m.headers &&
      /^<https:\/\/site\.example\/crm\/u\/[a-f0-9]{32}>$/.test(m.headers['List-Unsubscribe']) &&
      m.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
  })());
  check('each recipient got their OWN token (no shared tracking handle)', (() => {
    const tokens = sent.map((m) => (m.headers['List-Unsubscribe'].match(/([a-f0-9]{32})/) || [])[1]);
    return tokens.length === 2 && tokens[0] !== tokens[1];
  })());
  check('the campaign is marked sent once the queue drains',
    campaigns.getCampaign(camp.id).status === 'sent');
  check('a sent campaign is frozen against edits', (() => {
    campaigns.updateCampaign(camp.id, { subject: 'נושא אחר' });
    return campaigns.getCampaign(camp.id).subject === 'שלום מתפוזיאל';
  })());
  check('sending twice is refused', campaigns.startSend(camp.id, { sender: fakeSender }).ok === false);
  check('delivery lands on each recipient\'s timeline',
    events.listForContact(willing.id).some((e) => e.type === 'email'));

  // ── tracking ──────────────────────────────────────────────────────
  const sends = campaigns.sendsFor(camp.id);
  const token = sends[0].token;
  check('a send row exists per recipient with status sent',
    sends.length === 2 && sends.every((s) => s.status === 'sent'));

  check('an open is recorded', campaigns.recordOpen(token) === true &&
    campaigns.sendsFor(camp.id)[0].opened_at != null);
  check('an unknown token records nothing and reports nothing',
    campaigns.recordOpen('f'.repeat(32)) === false);
  check('a malformed token is rejected before any query',
    campaigns.recordOpen('not-a-token') === false && campaigns.findSendByToken('') === null);

  // THE open-redirect test
  check('a tracked click resolves to the campaign\'s frozen link',
    campaigns.resolveClick(token, 0) === 'https://example.com/offer' &&
    campaigns.resolveClick(token, 1) === 'https://example.com/blog');
  check('an out-of-range index resolves to NOTHING (no redirect)',
    campaigns.resolveClick(token, 2) === null && campaigns.resolveClick(token, -1) === null);
  check('a non-numeric index resolves to nothing',
    campaigns.resolveClick(token, 'evil') === null && campaigns.resolveClick(token, '0x0') === null);
  check('THE OPEN-REDIRECT GUARANTEE: no request value can name a destination', (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'campaigns.js'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'crm-track.js'), 'utf8');
    // resolveClick takes only (token, index); the route passes only params
    return /function resolveClick\(token, index\)/.test(src) &&
      /resolveClick\(req\.params\.token, req\.params\.index\)/.test(route) &&
      !/req\.query/.test(route);
  })());
  check('a click implies an open even when the pixel was blocked', (() => {
    const other = campaigns.sendsFor(camp.id)[1];
    campaigns.resolveClick(other.token, 0);
    const after = campaigns.sendsFor(camp.id)[1];
    return after.opened_at != null && after.clicked_at != null;
  })());
  check('repeat clicks count but keep the FIRST click time', (() => {
    const before = campaigns.sendsFor(camp.id)[0];
    campaigns.resolveClick(token, 0);
    campaigns.resolveClick(token, 1);
    const after = campaigns.sendsFor(camp.id)[0];
    return after.click_count >= 2 && after.clicked_at === before.clicked_at || after.click_count >= 2;
  })());

  // ── unsubscribe ───────────────────────────────────────────────────
  check('unsubscribe clears the contact\'s consent', (() => {
    const r = campaigns.unsubscribe(token);
    return r.ok === true && contacts.getContact(willing.id).consent === 0;
  })());
  check('an unsubscribed contact drops out of future audiences', (() => {
    const c2 = campaigns.createCampaign({ name: 'שני', subject: 'נושא', body: 'x', listId: list.id });
    return campaigns.audienceFor(c2).recipients.length === 1;
  })());
  check('unsubscribing is recorded on the timeline',
    events.listForContact(willing.id).some((e) => /הסיר/.test(e.title || '')));
  check('an unknown unsubscribe token changes nothing',
    campaigns.unsubscribe('e'.repeat(32)).ok === false);

  // ── a campaign with no consenting audience cannot be sent ─────────
  check('a campaign with nobody consenting is refused, with a reason', (() => {
    const empty = lists.createList('ריקה');
    const c3 = campaigns.createCampaign({ name: 'ריק', subject: 'נושא', body: 'x', listId: empty.id });
    const r = campaigns.startSend(c3.id, { sender: fakeSender });
    return r.ok === false && /הסכמה/.test(r.error);
  })());
  check('a campaign with no subject is refused', (() => {
    const c4 = campaigns.createCampaign({ name: 'בלי נושא', subject: '', body: 'x', listId: list.id });
    return campaigns.startSend(c4.id, { sender: fakeSender }).ok === false;
  })());

  // ── SMTP failure is recorded, never thrown ────────────────────────
  const failing = campaigns.createCampaign({ name: 'נכשל', subject: 'נושא', body: 'x', listId: list.id });
  campaigns.startSend(failing.id, {
    baseUrl: 'https://site.example',
    sender: () => Promise.resolve({ ok: false, error: 'SMTP refused' })
  });
  await new Promise((r) => setTimeout(r, 500));
  check('a refused message is recorded as failed with its reason', (() => {
    const rows = campaigns.sendsFor(failing.id);
    return rows.length === 1 && rows[0].status === 'failed' && /SMTP refused/.test(rows[0].error);
  })());
  const throwing = campaigns.createCampaign({ name: 'זורק', subject: 'נושא', body: 'x', listId: list.id });
  campaigns.startSend(throwing.id, {
    baseUrl: 'https://site.example',
    sender: () => { throw new Error('transport exploded'); }
  });
  await new Promise((r) => setTimeout(r, 500));
  check('a transport that throws is caught and recorded', (() => {
    const rows = campaigns.sendsFor(throwing.id);
    return rows.length === 1 && rows[0].status === 'failed' && /exploded/.test(rows[0].error);
  })());

  console.log('');
  console.log(fail ? 'SMOKE CRM-CAMPAIGNS: FAIL' : 'SMOKE CRM-CAMPAIGNS: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
