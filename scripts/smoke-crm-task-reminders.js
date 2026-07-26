'use strict';

/**
 * v2.01 — task email reminders over the existing SMTP path.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-task-rem-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const config = require('../src/config');
const contacts = require('../src/crm/contacts');
const tasks = require('../src/crm/tasks');
const reminders = require('../src/crm/task-reminders');
const notify = require('../src/notify');

config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: {
      enabled: true,
      tasks: { reminders: { enabled: true, to: '' } }
    }
  })
);

// mock SMTP
let sent = [];
notify._setTransportFactory(() => ({
  sendMail: async (msg) => {
    sent.push(msg);
    return { messageId: 'test' };
  },
  verify: async () => true
}));
notify.saveSettings({
  enabled: true,
  host: 'smtp.test',
  user: 'u',
  pass: 'p',
  from: 'from@test.com',
  to: 'owner@test.com',
  port: 587
});

const person = contacts.upsertContact({
  email: 'lead@test.com',
  name: 'ליד',
  status: 'lead'
}).contact;

const today = tasks.todayUTC();
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

tasks.createTask({ contactId: person.id, title: 'משימה ישנה', kind: 'call', dueAt: yesterday });
tasks.createTask({ contactId: person.id, title: 'משימה היום', kind: 'email', dueAt: today });
tasks.createTask({
  contactId: person.id,
  title: 'משימה עתידית',
  kind: 'followup',
  dueAt: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
});

const buckets = reminders.collectDueBuckets();
check('overdue bucket has 1', buckets.overdue.length === 1);
check('today bucket has 1', buckets.dueToday.length === 1);

const digest = reminders.buildDigest({
  overdue: buckets.overdue,
  dueToday: buckets.dueToday,
  baseUrl: 'https://crm.example.com'
});
check('digest built', !!digest && digest.count === 2);
check('digest subject Hebrew', /משימ/.test(digest.subject));
check('digest lists overdue title', /משימה ישנה/.test(digest.text));
check('digest lists today title', /משימה היום/.test(digest.text));
check('digest has board link', /\/admin\/crm\/tasks/.test(digest.text));
check('digest has html rtl', /dir="rtl"/.test(digest.html));

// empty digest
check('empty digest is null',
  reminders.buildDigest({ overdue: [], dueToday: [] }) == null);

(async () => {
  sent = [];
  const r1 = await reminders.sendTaskReminders({ force: true });
  check('send ok', r1.ok === true && r1.count === 2);
  check('one mail sent', sent.length === 1);
  check('mail to owner', sent[0].to === 'owner@test.com');
  check('mail subject set', !!sent[0].subject);

  // same-day dedupe
  sent = [];
  const r2 = await reminders.sendTaskReminders({ force: false });
  check('second auto send skipped', r2.skipped === true || r2.reason === 'already-sent-today');
  check('no second mail without force', sent.length === 0);

  // force resend
  sent = [];
  const r3 = await reminders.sendTaskReminders({ force: true });
  check('force resend works', r3.ok && sent.length === 1);

  // disabled
  config.saveConfig(
    Object.assign(config.loadConfig(), {
      crm: { enabled: true, tasks: { reminders: { enabled: false } } }
    })
  );
  sent = [];
  const r4 = await reminders.sendTaskReminders({ force: true });
  check('disabled skips', r4.skipped === true && sent.length === 0);

  // ignoreEnabled for admin
  sent = [];
  const r5 = await reminders.sendTaskReminders({ force: true, ignoreEnabled: true });
  check('admin ignoreEnabled still sends', r5.ok && sent.length === 1);

  const st = reminders.getReminderStatus();
  check('status reports pending counts', st.pendingOverdue >= 1 && st.pendingToday >= 1);

  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'crm.js'), 'utf8');
  check('reminders form on tasks page', /tasks\/reminders/.test(routes));
  check('runRetention schedules maybeSendDaily',
    /maybeSendDaily/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'index.js'), 'utf8')));

  console.log(fail ? '\nSMOKE CRM-TASK-REMINDERS: FAIL' : '\nSMOKE CRM-TASK-REMINDERS: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
