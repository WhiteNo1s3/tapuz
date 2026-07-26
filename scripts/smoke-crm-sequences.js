'use strict';

/**
 * v2.03 — email sequences (drip): multi-step, consent-gated, SMTP.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-seq-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const config = require('../src/config');
const contacts = require('../src/crm/contacts');
const sequences = require('../src/crm/sequences');
const notify = require('../src/notify');
const { db } = require('../src/db');
const subject = require('../src/crm/subject');

config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true }, baseUrl: 'https://crm.test' }));

let sent = [];
notify._setTransportFactory(() => ({
  sendMail: async (msg) => {
    sent.push(msg);
    return { messageId: 't' };
  },
  verify: async () => true
}));
notify.saveSettings({
  enabled: true,
  host: 'smtp.test',
  user: 'u',
  pass: 'p',
  from: 'from@test.com',
  to: 'owner@test.com'
});

const okPerson = contacts.upsertContact({
  email: 'ok@example.com',
  name: 'אוקי',
  status: 'lead',
  consent: true
}).contact;
const noConsent = contacts.upsertContact({
  email: 'no@example.com',
  name: 'לא',
  status: 'lead',
  consent: false
}).contact;
const ghost = contacts.upsertContact({ status: 'provisional', source: 'visit' }).contact;

const seq = sequences.createSequence('ברוכים הבאים');
check('sequence created', seq && seq.id);
sequences.addStep(seq.id, {
  delayDays: 0,
  subject: 'שלום {{name}}',
  body: '<p>היי {{name}}, ברוך הבא.</p><p><a href="https://example.com/x">לינק</a></p>'
});
sequences.addStep(seq.id, {
  delayDays: 0,
  subject: 'טיפ 2',
  body: '<p>עוד משהו</p>'
});
const full = sequences.getSequence(seq.id);
check('two steps', full.steps.length === 2);

const bad1 = sequences.enroll(seq.id, noConsent.id);
check('no consent cannot enroll', !bad1.ok && bad1.error === 'ineligible');
const bad2 = sequences.enroll(seq.id, ghost.id);
check('provisional cannot enroll', !bad2.ok);

const en = sequences.enroll(seq.id, okPerson.id);
check('eligible enroll ok', en.ok && en.enrollment.status === 'active');
const dup = sequences.enroll(seq.id, okPerson.id);
check('double enroll refused', !dup.ok && dup.error === 'already');

// force due
db.prepare(
  `UPDATE crm_sequence_enrollments SET next_run_at = datetime('now', '-1 hour') WHERE id = ?`
).run(en.enrollment.id);

(async () => {
  sent = [];
  const r1 = await sequences.processDue({ limit: 10 });
  check('first process sent 1', r1.sent === 1);
  check('mail went to contact', sent.length === 1 && sent[0].to === 'ok@example.com');
  check('subject personalized', /אוקי|שלום/.test(sent[0].subject) || sent[0].subject.includes('שלום'));
  check('body has unsubscribe', /crm\/u\//.test(sent[0].html));
  check('List-Unsubscribe header', !!(sent[0].headers && sent[0].headers['List-Unsubscribe']));

  const mid = db
    .prepare('SELECT * FROM crm_sequence_enrollments WHERE id = ?')
    .get(en.enrollment.id);
  check('advanced to step 1', mid.step_index === 1);

  // force second step due
  db.prepare(
    `UPDATE crm_sequence_enrollments SET next_run_at = datetime('now', '-1 hour') WHERE id = ?`
  ).run(en.enrollment.id);
  sent = [];
  const r2 = await sequences.processDue({ limit: 10 });
  check('second process sent 1', r2.sent === 1);
  const done = db
    .prepare('SELECT * FROM crm_sequence_enrollments WHERE id = ?')
    .get(en.enrollment.id);
  check('enrollment completed', done.status === 'completed');

  // open tracking
  const tok = db.prepare('SELECT token FROM crm_sequence_sends LIMIT 1').get().token;
  check('recordOpen sequence token', sequences.recordOpen(tok) === true);

  // unsubscribe cancels active — re-enroll then unsub path
  const seq2 = sequences.createSequence('עצירה');
  sequences.addStep(seq2.id, { delayDays: 0, subject: 'x', body: '<p>y</p>' });
  const en2 = sequences.enroll(seq2.id, okPerson.id);
  check('re-enroll other sequence', en2.ok);
  const n = sequences.cancelActiveForContact(okPerson.id);
  check('cancel active for contact', n >= 1);
  check(
    'no active left',
    sequences.listActiveForContact(okPerson.id).length === 0
  );

  // subject erase tables listed
  check(
    'PERSONAL_TABLES has enrollments',
    subject.PERSONAL_TABLES.some((s) => s.table === 'crm_sequence_enrollments')
  );

  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'crm.js'), 'utf8');
  check('admin sequences route', /\/admin\/crm\/sequences'/.test(routes));
  const nav = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin-ui.js'), 'utf8');
  check('nav sequences', /crm-sequences/.test(nav));
  check(
    'maybeProcessDaily wired',
    /maybeProcessDaily/.test(
      fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'index.js'), 'utf8')
    )
  );

  console.log(fail ? '\nSMOKE CRM-SEQUENCES: FAIL' : '\nSMOKE CRM-SEQUENCES: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
