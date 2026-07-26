'use strict';

/**
 * v2.00 — CRM sales tasks (HubSpot "next action" loop).
 * Open work on a person, due board, complete/cancel, subject erase.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-tasks-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const config = require('../src/config');
const contacts = require('../src/crm/contacts');
const tasks = require('../src/crm/tasks');
const subject = require('../src/crm/subject');
const events = require('../src/crm/events');
const { db } = require('../src/db');

config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true } }));

const person = contacts.upsertContact({
  email: 'dana@example.com',
  name: 'דנה',
  status: 'lead'
}).contact;
check('contact exists', !!person && person.id);

const bad = tasks.createTask({ contactId: person.id, title: '' });
check('empty title refused', !bad.ok);

const noContact = tasks.createTask({ contactId: 999999, title: 'x' });
check('missing contact refused', !noContact.ok);

const today = tasks.todayUTC();
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

const t1 = tasks.createTask({
  contactId: person.id,
  title: 'להתקשר בעניין החבילה',
  kind: 'call',
  dueAt: yesterday
});
check('overdue task created', t1.ok && t1.task.status === 'open');
check('kind normalized', t1.task.kind === 'call');
check('timeline noted the task',
  events.listForContact(person.id).some((e) => /משימה:/.test(e.title || '')));

const t2 = tasks.createTask({
  contactId: person.id,
  title: 'לשלוח הצעה',
  kind: 'email',
  dueAt: today
});
const t3 = tasks.createTask({
  contactId: person.id,
  title: 'פגישת היכרות',
  kind: 'meeting',
  dueAt: nextWeek
});
const t4 = tasks.createTask({
  contactId: person.id,
  title: 'מתישהו',
  kind: 'other',
  dueAt: ''
});
check('undated task allowed', t4.ok && t4.task.due_at == null);

const due = tasks.listDue();
check('due board includes overdue', due.some((t) => t.id === t1.task.id));
check('due board includes today', due.some((t) => t.id === t2.task.id));
check('due board excludes next week', !due.some((t) => t.id === t3.task.id));
check('due board excludes undated', !due.some((t) => t.id === t4.task.id));

const up = tasks.listUpcoming({ days: 10 });
check('upcoming includes next week', up.some((t) => t.id === t3.task.id));
check('upcoming excludes today', !up.some((t) => t.id === t2.task.id));

const openOn = tasks.listForContact(person.id);
check('contact open tasks = 4', openOn.length === 4);

const done = tasks.completeTask(t1.task.id);
check('complete works', done.ok && done.task.status === 'done');
check('completed leaves open list', tasks.listForContact(person.id).length === 3);
check('complete timeline note',
  events.listForContact(person.id).some((e) => /בוצעה/.test(e.title || '')));

const cancelled = tasks.cancelTask(t4.task.id);
check('cancel works', cancelled.ok && cancelled.task.status === 'cancelled');

const counts = tasks.counts();
check('counts.open tracks remaining open', counts.open === 2);
check('counts.dueToday includes today task', counts.dueToday >= 1);

// invalid due rejected
const badDate = tasks.createTask({
  contactId: person.id,
  title: 'x',
  dueAt: '13/25/2026'
});
check('bad due date stored as null or refused create still ok',
  badDate.ok && (badDate.task.due_at == null || badDate.task.due_at === ''));

// Hebrew labels
check('kindLabel call is Hebrew', tasks.kindLabel('call') === 'שיחה');
check('statusLabel open is Hebrew', tasks.statusLabel('open') === 'פתוח');

// subject erase cascades tasks
const doomed = contacts.upsertContact({ email: 'gone@example.com', name: 'Gone' }).contact;
const td = tasks.createTask({ contactId: doomed.id, title: 'will vanish', dueAt: today });
check('task on doomed contact', td.ok);
const erased = subject.eraseContact(doomed.id);
check('erase ok', erased.ok);
check('tasks gone with contact',
  db.prepare('SELECT COUNT(*) AS n FROM crm_tasks WHERE contact_id = ?').get(doomed.id).n === 0);
check('PERSONAL_TABLES lists crm_tasks',
  subject.PERSONAL_TABLES.some((s) => s.table === 'crm_tasks'));

// admin surfaces exist
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'crm.js'), 'utf8');
check('GET /admin/crm/tasks registered', /\/admin\/crm\/tasks'/.test(routes));
const nav = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin-ui.js'), 'utf8');
check('nav has crm-tasks', /crm-tasks/.test(nav) && /\/admin\/crm\/tasks/.test(nav));

console.log(fail ? '\nSMOKE CRM-TASKS: FAIL' : '\nSMOKE CRM-TASKS: PASS');
process.exit(fail ? 1 : 0);
