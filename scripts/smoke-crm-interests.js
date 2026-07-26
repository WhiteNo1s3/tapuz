'use strict';

/**
 * Interest map — progressive cards learn topics; owners see the site-wide map,
 * add/remove on a person, and open a live segment for relevant mail (v1.96).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-interests-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const config = require('../src/config');
const contacts = require('../src/crm/contacts');
const cards = require('../src/crm/cards');
const segments = require('../src/crm/segments');
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

function makeJar() {
  let cookie = '';
  return {
    req(extra) {
      return Object.assign({ headers: { cookie }, secure: false }, extra || {});
    },
    res() {
      return {
        append(_name, value) {
          const m = String(value).match(/^tz_v=([a-f0-9]+)/i);
          if (m) cookie = 'tz_v=' + m[1];
        }
      };
    }
  };
}

// ── normalize ──
check('normalize strips interest: prefix', cards.normalizeInterestLabel('interest:Foo-Bar') === 'foo-bar');
check('normalize keeps Hebrew', cards.normalizeInterestLabel('חתונות') === 'חתונות');
check('fullInterestTag shapes tag', cards.fullInterestTag('  Wedding  ') === 'interest:wedding');

// ── learn from paths ──
const jarA = makeJar();
const idA = cards.openOrTouch(jarA.req(), jarA.res());
crm.capturePageview({ req: jarA.req(), res: jarA.res(), path: '/services/wedding-packages' });
crm.capturePageview({ req: jarA.req(), res: jarA.res(), path: '/blog/ai-tools' });
contacts.updateContact(idA, { email: 'a@example.com', status: 'lead' });

const jarB = makeJar();
const idB = cards.openOrTouch(jarB.req(), jarB.res());
crm.capturePageview({ req: jarB.req(), res: jarB.res(), path: '/services/wedding-packages' });
// provisional only — no email

const stats = cards.listInterestStats();
const wedding = stats.find((s) => s.label === 'wedding-packages');
check('interest map lists wedding-packages', !!wedding);
check('wedding total is 2 cards', wedding && wedding.total === 2);
check('wedding withEmail is 1', wedding && wedding.withEmail === 1);
check('wedding provisional counts the ghost', wedding && wedding.provisional === 1);
check('ai-tools appears once', stats.some((s) => s.label === 'ai-tools' && s.total === 1));

// ── manual add / remove ──
const add = cards.addInterest(idA, 'vip-suite');
check('manual addInterest ok', add.ok && add.tag === 'vip-suite');
check('interestsOf includes manual', cards.interestsOf(idA).includes('vip-suite'));
const again = cards.addInterest(idA, 'vip-suite');
check('duplicate add is idempotent', again.ok && again.already === true);
const rm = cards.removeInterest(idA, 'vip-suite');
check('removeInterest ok', rm.ok);
check('removed interest gone', !cards.interestsOf(idA).includes('vip-suite'));
check('path interests survive remove of another', cards.interestsOf(idA).includes('wedding-packages'));

// ── tag form must not wipe interests (simulate update route merge) ──
const row = contacts.getContact(idA);
const kept = contacts.parseTags(row.tags).filter((t) => t.startsWith('interest:'));
contacts.updateContact(idA, { tags: ['vip'].concat(kept) });
const after = contacts.getContact(idA);
check(
  'manual tags coexist with interests',
  contacts.parseTags(after.tags).includes('vip') &&
    contacts.parseTags(after.tags).some((t) => t === 'interest:wedding-packages')
);

// ── one-click segment from interest ──
const seg = segments.createSegment('מתעניינים ב־wedding-packages · עם מייל', {
  interest: 'wedding-packages',
  hasEmail: true
});
const hit = segments.evaluate(seg.rules);
check('segment from map finds only email people', hit.length === 1 && hit[0].id === idA);
check('provisional without email stays out of mail segment', !hit.some((r) => r.id === idB));

// ── route surfaces (live server not required — helpers only above) ──
// Light HTTP smoke if we can boot a throwaway app — skip if too heavy; the
// cards smoke already covers the seam. Assert admin nav knows the key.
const adminUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin-ui.js'), 'utf8');
check('admin nav has crm-interests', /crm-interests/.test(adminUi) && /\/admin\/crm\/interests/.test(adminUi));
const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'crm.js'), 'utf8');
check('GET /admin/crm/interests registered', /\/admin\/crm\/interests'/.test(routes));
check('POST interest on contact registered', /\/admin\/crm\/:id\/interest'/.test(routes));
check('POST interests/segment registered', /\/admin\/crm\/interests\/segment'/.test(routes));

console.log(fail ? '\nSMOKE CRM-INTERESTS: FAIL' : '\nSMOKE CRM-INTERESTS: PASS');
process.exit(fail ? 1 : 0);
