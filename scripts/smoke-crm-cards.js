'use strict';

/**
 * Progressive customer cards — legitimate first-party stitch + quiet purge.
 *
 * One browser, one card. Email/name/paths enrich it. Quiet provisional cards
 * go garbage then erase. Never raw IP.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-cards-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const config = require('../src/config');
const contacts = require('../src/crm/contacts');
const cards = require('../src/crm/cards');
const visitors = require('../src/crm/visitors');
const events = require('../src/crm/events');
const crm = require('../src/crm');

config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: {
      enabled: true,
      cards: { progressive: true, quietDays: 5, garbageDays: 3 },
      retention: { eventDays: 0 }
    }
  })
);

// Fake express req/res with cookie jar
function makeJar() {
  let cookie = '';
  return {
    req(extra) {
      return Object.assign(
        {
          headers: { cookie },
          secure: false
        },
        extra || {}
      );
    },
    res() {
      return {
        append(_name, value) {
          // Set-Cookie: tz_v=hex; Path=/; ...
          const m = String(value).match(/^tz_v=([a-f0-9]+)/i);
          if (m) cookie = 'tz_v=' + m[1];
        }
      };
    },
    get cookie() {
      return cookie;
    }
  };
}

// ── interest from path ──
check('interest tag from path', cards.interestFromPath('/blog/ai-tools') === 'interest:ai-tools');
check('boring paths yield no interest', cards.interestFromPath('/home') === '' || cards.interestFromPath('/') === '');

// ── open card on first visit ──
const jar = makeJar();
const id1 = cards.openOrTouch(jar.req(), jar.res());
check('first visit opens a contact id', !!id1);
const row1 = contacts.getContact(id1);
check('card is provisional', row1 && row1.status === 'provisional');
check('first-party cookie was set', /^tz_v=[a-f0-9]+/.test(jar.cookie));

// same browser → same card
const id2 = cards.openOrTouch(jar.req(), jar.res());
check('second visit reuses the same card (no hundreds of ghosts)', id2 === id1);
check('only one contact row exists', contacts.countContacts({}) === 1);

// pageview + interests via seam
const evId = crm.capturePageview({
  req: jar.req(),
  res: jar.res(),
  path: '/services/wedding-packages'
});
check('pageview recorded on the card', !!evId);
const afterView = contacts.getContact(id1);
check(
  'path became an interest tag',
  contacts.parseTags(afterView.tags).some((t) => t.includes('wedding') || t.includes('interest:'))
);
check('timeline has pageview', events.listForContact(id1).some((e) => e.type === 'pageview'));

// form with email enriches same card
const form = crm.captureForm({
  req: jar.req(),
  res: jar.res(),
  page: '/contact',
  fields: { email: 'dana@example.com', name: 'דנה' },
  submissionId: 42
});
check('form capture returns contact', !!(form && form.contact));
check('same card received the email', form.contact.id === id1);
check('email stored', form.contact.email === 'dana@example.com');
check('name stored', form.contact.name === 'דנה' || form.contact.name.indexOf('דנה') === 0);
check('left provisional once reachable', form.contact.status === 'lead' || form.contact.status !== 'provisional');
check('still one contact (stitched, not duplicated)', contacts.countContacts({}) === 1);

// second browser gets a different provisional card
const jarB = makeJar();
const other = cards.openOrTouch(jarB.req(), jarB.res());
check('different browser gets a different card', other && other !== id1);

// ── lifecycle: quiet provisional → garbage → erase ──
const ghost = contacts.upsertContact({ status: 'provisional', source: 'visit' }).contact;
check('ghost provisional created', ghost && ghost.status === 'provisional');
// force quiet past quietDays
const { db } = require('../src/db');
db.prepare(`UPDATE crm_contacts SET updated_at = datetime('now', '-6 days') WHERE id = ?`).run(ghost.id);
let life = cards.runCardLifecycle();
check('quiet provisional marked garbage', contacts.getContact(ghost.id).status === 'garbage');
check('lifecycle reported mark', life.markedGarbage >= 1);

db.prepare(`UPDATE crm_contacts SET updated_at = datetime('now', '-4 days') WHERE id = ?`).run(ghost.id);
life = cards.runCardLifecycle();
check('old garbage hard-erased', contacts.getContact(ghost.id) == null);
check('lifecycle reported erase', life.erased >= 1);

// reachable leads are NOT auto-garbaged by quietDays alone
db.prepare(`UPDATE crm_contacts SET updated_at = datetime('now', '-30 days') WHERE id = ?`).run(id1);
life = cards.runCardLifecycle();
check('reachable lead survives quiet lifecycle', !!contacts.getContact(id1));

// DNT path is above CRM — capture with progressive still needs CRM on
// merge: form identity that already exists while cookie held a ghost
const jarC = makeJar();
const ghost2 = cards.openOrTouch(jarC.req(), jarC.res());
const known = contacts.upsertContact({ email: 'known@example.com', name: 'Known' }).contact;
const merged = crm.captureForm({
  req: jarC.req(),
  res: jarC.res(),
  fields: { email: 'known@example.com' },
  page: '/x'
});
check('form identity merges into known contact', merged.contact.id === known.id);
check('ghost provisional gone after merge', contacts.getContact(ghost2) == null || ghost2 === known.id);

// cards disabled
config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: { enabled: true, cards: { progressive: false } }
  })
);
const jarD = makeJar();
const none = crm.capturePageview({ req: jarD.req(), res: jarD.res(), path: '/alone' });
check('progressive off → unlinked pageview records nothing on CRM', none == null);
check('progressive off → no cookie card', !jarD.cookie);

// interest segment (mail without spam-all)
config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: { enabled: true, cards: { progressive: true, quietDays: 5, garbageDays: 3 } }
  })
);
const segments = require('../src/crm/segments');
const jarE = makeJar();
const intId = cards.openOrTouch(jarE.req(), jarE.res());
crm.capturePageview({ req: jarE.req(), res: jarE.res(), path: '/services/wedding-packages' });
contacts.updateContact(intId, { email: 'bride@example.com', status: 'lead' });
const hit = segments.evaluate({ interest: 'wedding-packages', hasEmail: true });
check('interest segment finds the interested person', hit.some((r) => r.id === intId));
const miss = segments.evaluate({ interest: 'industrial-pipes', hasEmail: true });
check('interest segment does not include unrelated people', !miss.some((r) => r.id === intId));
check('Hebrew status label for provisional', contacts.statusLabel('provisional') === 'כרטיס זמני');

console.log(fail ? '\nSMOKE CRM-CARDS: FAIL' : '\nSMOKE CRM-CARDS: PASS');
process.exit(fail ? 1 : 0);
