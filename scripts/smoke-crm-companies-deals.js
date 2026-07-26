'use strict';

/**
 * v2.09 — companies + deals hanging off Customer; not parallel people stores.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-co-deal-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const config = require('../src/config');
const contacts = require('../src/crm/contacts');
const companies = require('../src/crm/companies');
const deals = require('../src/crm/deals');
const Customer = require('../src/crm/Customer');
const subject = require('../src/crm/subject');
const inbox = require('../src/crm/unified-inbox');
const cs = require('../src/crm/cs');

config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true } }));

const person = contacts.upsertContact({
  email: 'ceo@acme.test',
  name: 'CEO',
  status: 'lead',
  consent: true
}).contact;

const co = companies.createCompany({ name: 'Acme IL', domain: 'acme.test' });
check('company created', co && co.id);
companies.linkContact(co.id, person.id, 'decision-maker');
check('member linked', companies.membersOf(co.id).some((m) => m.id === person.id));
check('companiesForContact', companies.companiesForContact(person.id).length === 1);

const deal = deals.createDeal({
  title: 'אתר + CRM',
  contactId: person.id,
  companyId: co.id,
  amount: 15000,
  stage: 'proposal',
  expectedClose: '2026-12-01'
});
check('deal created', deal && deal.id && deal.amount === 15000);
check('deal stage label HE', deals.stageLabel('proposal') === 'הצעה');

const cust = Customer.load(person.id);
check('Customer.companies()', cust.companies().length === 1);
check('Customer.deals()', cust.deals().some((d) => d.id === deal.id));
const sheet = cust.datasheet();
check('datasheet carries companies+deals', sheet.companies.length === 1 && sheet.deals.length === 1);

const sum = deals.pipelineSummary();
check('pipeline open counts proposal', sum.byStage.proposal.n >= 1);
check('pipeline open value includes deal', sum.open.value >= 15000);

// no contact no company fails
let threw = false;
try {
  deals.createDeal({ title: 'x' });
} catch (e) {
  threw = true;
}
check('deal requires contact or company', threw);

// subject tables
check(
  'PERSONAL_TABLES has company_members',
  subject.PERSONAL_TABLES.some((s) => s.table === 'crm_company_members')
);
check('PERSONAL_TABLES has deals', subject.PERSONAL_TABLES.some((s) => s.table === 'crm_deals'));

// chat reply stub (no AI)
const conv = cs.startConversation();
cs.addMessage(conv.id, 'user', 'hello');
const key = inbox.itemKey('chat', conv.id);
(async () => {
  const r = await inbox.replyFromItem(key, 'שלום, נחזור אליכם');
  check('chat replyFromItem ok', r.ok && r.channel === 'chat');
  const msgs = cs.messagesFor(conv.id);
  check(
    'assistant message in CS store',
    msgs.some((m) => m.role === 'assistant' && /נחזור/.test(m.text || ''))
  );

  // WA without config fails closed
  const { db } = require('../src/db');
  const ins = db
    .prepare(
      `INSERT INTO crm_wa_messages (phone, direction, msg_type, body, status)
       VALUES ('972501111111', 'in', 'text', 'hi', 'received')`
    )
    .run();
  const waKey = inbox.itemKey('whatsapp', ins.lastInsertRowid);
  const wr = await inbox.replyFromItem(waKey, 'תשובה');
  check('WA reply fails when channel disabled', !wr.ok);

  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'crm.js'), 'utf8');
  check('companies routes', /\/admin\/crm\/companies'/.test(routes));
  check('deals routes', /\/admin\/crm\/deals'/.test(routes));
  check('inbox reply route', /inbox\/reply/.test(routes));
  const nav = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin-ui.js'), 'utf8');
  check('nav companies+deals', /crm-companies/.test(nav) && /crm-deals/.test(nav));

  console.log(fail ? '\nSMOKE CRM-COMPANIES-DEALS: FAIL' : '\nSMOKE CRM-COMPANIES-DEALS: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
