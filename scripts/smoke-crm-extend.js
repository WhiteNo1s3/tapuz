'use strict';

/**
 * v2.12 — CRM extension spine: hooks bus + open attrs + open event types.
 * Expand for verticals; do not script a closed product.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-extend-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const config = require('../src/config');
const contacts = require('../src/crm/contacts');
const events = require('../src/crm/events');
const hooks = require('../src/crm/hooks');
const attrs = require('../src/crm/attrs');
const subject = require('../src/crm/subject');
const Customer = require('../src/crm/Customer');
const portal = require('../src/crm/portal');

config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true } }));
hooks._resetForTests();

// ── hooks bus ──
let saw = null;
const unsub = hooks.on('contact.created', (p) => {
  saw = p;
});
const person = contacts.upsertContact({
  email: 'expand@example.com',
  name: 'Expand Me',
  status: 'customer'
}).contact;
check('contact.created fires on upsert create', !!(saw && saw.contactId === person.id));
unsub();

let updated = false;
hooks.on('contact.updated', () => {
  updated = true;
});
contacts.updateContact(person.id, { company: 'Shaltiel' });
check('contact.updated fires on admin edit', updated === true);

// listener throw must not break emit
hooks.on('event.recorded', () => {
  throw new Error('boom-listener');
});
let recOk = false;
const evId = events.record({
  contactId: person.id,
  type: 'note',
  title: 'hello'
});
recOk = !!evId;
check('event.record survives bad listener', recOk);
check('emit reports error without throw', (() => {
  const r = hooks.emit('event.recorded', { id: 1 });
  // throwing listeners do not increment n; errors[] is the signal
  return r.ok === false && r.errors.length >= 1 && r.errors[0].includes('boom');
})());

// ── open event types ──
check('core type still form', events.normalizeType('form') === 'form');
check(
  'namespaced type accepted without prior register',
  events.normalizeType('restaurant.order') === 'restaurant.order'
);
check('registerType works', events.registerType('loyalty.redeem', { label: 'מימוש' }) === true);
const loyId = events.record({
  contactId: person.id,
  type: 'loyalty.redeem',
  title: 'נקודות'
});
check('registered type stored', !!loyId);
const tl = events.listForContact(person.id, { limit: 20 });
check(
  'timeline holds vertical type',
  tl.some((e) => e.type === 'loyalty.redeem' || e.type === 'restaurant.order')
);

// ── attrs bag ──
check('bad key rejected', attrs.set(person.id, '!!', 'x').ok === false);
check('empty key rejected', attrs.set(person.id, '', 'x').ok === false);

attrs.define('restaurant.dietary', {
  label: 'העדפה תזונתית',
  vertical: 'restaurant',
  publicDefault: true
});
check('define registers', !!attrs.getDefinition('restaurant.dietary'));

const setR = attrs.set(person.id, 'restaurant.dietary', 'צמחוני', { public: true });
check('set attr ok', setR.ok === true);
check('get attr', attrs.get(person.id, 'restaurant.dietary').value === 'צמחוני');
check('asMap public', attrs.asMap(person.id, { publicOnly: true })['restaurant.dietary'] === 'צמחוני');

attrs.set(person.id, 'loyalty.tier', 'gold', { public: false });
check(
  'private attr hidden from public map',
  attrs.asMap(person.id, { publicOnly: true })['loyalty.tier'] === undefined &&
    attrs.asMap(person.id)['loyalty.tier'] === 'gold'
);

const cust = Customer.load(person.id);
check('Customer.attrs()', cust.attrs().some((a) => a.key === 'restaurant.dietary'));
check('Customer.attrMap()', cust.attrMap()['loyalty.tier'] === 'gold');
const sheet = cust.datasheet();
check('datasheet includes attrs', sheet.attrs && sheet.attrs.length >= 2);

// JSON value
attrs.set(person.id, 'restaurant.seats', { indoor: 2, outdoor: 1 }, { public: false });
check(
  'object value round-trips',
  attrs.get(person.id, 'restaurant.seats').value.indoor === 2
);

// ── portal profile surfaces public attrs ──
config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: { enabled: true, portal: { enabled: true, allowSelfRegister: false } }
  })
);
portal.createForContact(person.id, 'expanduser', 'password12');
const prof = portal.publicProfile(person.id);
check(
  'publicProfile.attrs only public keys',
  prof.attrs['restaurant.dietary'] === 'צמחוני' && prof.attrs['loyalty.tier'] === undefined
);

// ── erase + PERSONAL_TABLES ──
check(
  'attrs in PERSONAL_TABLES',
  subject.PERSONAL_TABLES.some((t) => t.table === 'crm_contact_attrs')
);
let erasedHook = false;
hooks.on('contact.erased', () => {
  erasedHook = true;
});
const er = subject.eraseContact(person.id);
check('erase ok', er.ok === true);
check('attrs gone after erase', attrs.listForContact(person.id).length === 0);
check('contact.erased fires', erasedHook === true);

// ── hooks listEvents documents core ──
check(
  'listEvents includes portal.login',
  hooks.listEvents().includes('portal.login') && hooks.listEvents().includes('attrs.set')
);

// CRM index exports
const crm = require('../src/crm');
check('crm.hooks exported', !!crm.hooks && typeof crm.hooks.on === 'function');
check('crm.attrs exported', !!crm.attrs && typeof crm.attrs.set === 'function');

console.log(fail ? '\nSMOKE CRM-EXTEND: FAIL' : '\nSMOKE CRM-EXTEND: PASS');
process.exit(fail ? 1 : 0);
