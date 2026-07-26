'use strict';

/**
 * v2.01 — contact status kanban (sales pipeline board).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-board-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const config = require('../src/config');
const contacts = require('../src/crm/contacts');
const events = require('../src/crm/events');

config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true } }));

const a = contacts.upsertContact({ email: 'a@x.com', name: 'A', status: 'lead' }).contact;
const b = contacts.upsertContact({ email: 'b@x.com', name: 'B', status: 'lead' }).contact;
const c = contacts.upsertContact({ email: 'c@x.com', name: 'C', status: 'customer' }).contact;

check('listByStatus lead has 2', contacts.listByStatus('lead').length === 2);
check('listByStatus customer has 1', contacts.listByStatus('customer').length === 1);
check('listByStatus garbage empty', contacts.listByStatus('garbage').length === 0);
check('listByStatus unknown empty', contacts.listByStatus('nope').length === 0);

contacts.updateContact(a.id, { status: 'active' });
check('moved to active column', contacts.listByStatus('active').some((r) => r.id === a.id));
check('left lead column', !contacts.listByStatus('lead').some((r) => r.id === a.id));

// board route registered
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'crm.js'), 'utf8');
check('GET board registered', /\/admin\/crm\/board'/.test(routes));
check('POST board/move registered', /\/admin\/crm\/board\/move'/.test(routes));
check('kanban drag script present', /data-drop-status/.test(routes) && /dragstart/.test(routes));
const nav = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin-ui.js'), 'utf8');
check('nav has crm-board', /crm-board/.test(nav));

// status event type is allowed
events.record({ contactId: b.id, type: 'status', title: 'הועבר ל־פעיל' });
check('status timeline events work',
  events.listForContact(b.id).some((e) => e.type === 'status'));

console.log(fail ? '\nSMOKE CRM-BOARD: FAIL' : '\nSMOKE CRM-BOARD: PASS');
process.exit(fail ? 1 : 0);
