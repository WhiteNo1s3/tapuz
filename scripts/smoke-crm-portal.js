'use strict';

/**
 * v2.10 — named-customer retention (1y quiet) + customer portal accounts.
 *
 * Portal is off by default; self-register is a second explicit flag.
 * Owner can mint a login on a contact without opening public signup.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-portal-'));
process.env.TAPUZ_ROOT = ROOT;
process.env.TAPUZ_ADMIN_SECRET = 'smoke-portal-secret-32chars-ok!!';

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const config = require('../src/config');
const contacts = require('../src/crm/contacts');
const cards = require('../src/crm/cards');
const portal = require('../src/crm/portal');
const subject = require('../src/crm/subject');
const { db } = require('../src/db');

config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: {
      enabled: true,
      cards: { progressive: true, quietDays: 5, garbageDays: 3, namedQuietDays: 365 },
      portal: { enabled: false, allowSelfRegister: false },
      retention: { eventDays: 0 }
    }
  })
);

// ── named retention ──────────────────────────────────────────────────
check('default namedQuietDays is 365', cards.cardsConfig().namedQuietDays === 365);

const ghost = contacts.upsertContact({ status: 'provisional', source: 'visit' }).contact;
const named = contacts.upsertContact({
  email: 'real@example.com',
  name: 'דנה כהן',
  status: 'customer',
  source: 'form'
}).contact;
const leadOnly = contacts.upsertContact({
  phone: '0501112233',
  status: 'lead'
}).contact;

check('statusCounts.real counts named/reachable', contacts.statusCounts().real >= 2);

const reals = contacts.listContacts({ kind: 'real', limit: 50 });
check(
  'kind=real excludes provisional ghosts',
  reals.every((r) => r.status !== 'provisional' && r.status !== 'garbage') &&
    reals.some((r) => r.id === named.id) &&
    !reals.some((r) => r.id === ghost.id)
);
check('kind=real includes phone-only lead', reals.some((r) => r.id === leadOnly.id));

// 30 days quiet — named must survive (default 365)
db.prepare(`UPDATE crm_contacts SET updated_at = datetime('now', '-30 days') WHERE id = ?`).run(
  named.id
);
let life = cards.runCardLifecycle();
check('named survives 30d quiet under 365 policy', !!contacts.getContact(named.id));
check('lifecycle reports namedQuietDays', life.namedQuietDays === 365);

// Past year → erase
db.prepare(`UPDATE crm_contacts SET updated_at = datetime('now', '-400 days') WHERE id = ?`).run(
  named.id
);
life = cards.runCardLifecycle();
check('named quiet >1y is erased', contacts.getContact(named.id) == null);
check('lifecycle reports erasedNamed', life.erasedNamed >= 1);

// namedQuietDays = 0 → never auto-erase
config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: Object.assign({}, config.loadConfig().crm, {
      cards: { progressive: true, quietDays: 5, garbageDays: 3, namedQuietDays: 0 }
    })
  })
);
const forever = contacts.upsertContact({
  email: 'keep@example.com',
  name: 'Keep Me',
  status: 'customer'
}).contact;
db.prepare(`UPDATE crm_contacts SET updated_at = datetime('now', '-2000 days') WHERE id = ?`).run(
  forever.id
);
life = cards.runCardLifecycle();
check('namedQuietDays=0 never auto-erases named', !!contacts.getContact(forever.id));

// short policy for remaining tests
config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: Object.assign({}, config.loadConfig().crm, {
      cards: { progressive: true, quietDays: 5, garbageDays: 3, namedQuietDays: 365 },
      portal: { enabled: false, allowSelfRegister: false }
    })
  })
);

// ── portal defaults ──────────────────────────────────────────────────
check('portal off by default', portal.portalConfig().enabled === false);
check('self-register off by default', portal.portalConfig().allowSelfRegister === false);

const person = contacts.upsertContact({
  email: 'portal-user@example.com',
  name: 'Portal User',
  status: 'customer'
}).contact;

// Mint while portal flag is OFF (owner mint always allowed)
const mint = portal.createForContact(person.id, 'portaluser', 'password1');
check('owner can mint portal account while portal disabled', mint.ok === true);
check('username normalized lower', mint.account && mint.account.username === 'portaluser');
check('getByContact finds account', !!portal.getByContact(person.id));

const dup = portal.createForContact(person.id, 'other', 'password1');
check('second account on same contact refused', dup.ok === false && dup.error === 'exists');

const shortPw = portal.createForContact(
  contacts.upsertContact({ email: 'x2@example.com', name: 'X' }).contact.id,
  'userx',
  'short'
);
check('short password refused', shortPw.ok === false && shortPw.error === 'password');

// Login fails when portal disabled
check('verifyLogin null when portal off', portal.verifyLogin('portaluser', 'password1') == null);

// Enable portal (not self-reg)
config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: Object.assign({}, config.loadConfig().crm, {
      portal: { enabled: true, allowSelfRegister: false }
    })
  })
);
check('portal enabled', portal.portalConfig().enabled === true);
check('self-reg still false', portal.portalConfig().allowSelfRegister === false);

const badLogin = portal.verifyLogin('portaluser', 'wrong-password');
check('bad password fails', badLogin == null);
const goodLogin = portal.verifyLogin('portaluser', 'password1');
check('good password works when enabled', !!(goodLogin && goodLogin.contact_id === person.id));

const selfOff = portal.selfRegister({
  username: 'newbie',
  password: 'password1',
  name: 'Newbie',
  email: 'new@example.com'
});
check('self-register refused when flag off', selfOff.ok === false && selfOff.error === 'disabled');

// Self-register on
config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: Object.assign({}, config.loadConfig().crm, {
      portal: { enabled: true, allowSelfRegister: true }
    })
  })
);
const selfOn = portal.selfRegister({
  username: 'newbie',
  password: 'password1',
  name: 'Newbie',
  email: 'new@example.com'
});
check('self-register works when both flags on', selfOn.ok === true && selfOn.contact);
check('self-reg contact is customer/lead not provisional', selfOn.contact.status !== 'provisional');

const profile = portal.publicProfile(person.id);
check(
  'publicProfile shows username + name',
  profile && profile.username === 'portaluser' && profile.name === 'Portal User'
);

// session cookie round-trip shape
const token = portal.createSession(goodLogin);
check('session token is signed body.sig', typeof token === 'string' && token.includes('.'));

// subject erase wipes portal account
check(
  'PERSONAL_TABLES includes portal accounts',
  subject.PERSONAL_TABLES.some((t) => t.table === 'crm_portal_accounts')
);
const erase = subject.eraseContact(person.id);
check('erase contact succeeds', erase && erase.ok);
check('portal account gone after erase', portal.getByContact(person.id) == null);

// ── HTTP surface (portal routes) ─────────────────────────────────────
const express = require('express');
const portalRoutes = require('../src/routes/portal');
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(portalRoutes);

function req(method, url, body, cookie) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const data = body
        ? typeof body === 'string'
          ? body
          : new URLSearchParams(body).toString()
        : null;
      const headers = {
        Host: '127.0.0.1:' + port,
        Accept: 'text/html'
      };
      if (cookie) headers.Cookie = cookie;
      if (data) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = Buffer.byteLength(data);
      }
      const r = http.request(
        { hostname: '127.0.0.1', port, path: url, method, headers },
        (res) => {
          let chunks = '';
          res.on('data', (c) => (chunks += c));
          res.on('end', () => {
            server.close();
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: chunks,
              setCookie: res.headers['set-cookie'] || []
            });
          });
        }
      );
      r.on('error', (e) => {
        server.close();
        reject(e);
      });
      if (data) r.write(data);
      r.end();
    });
  });
}

(async () => {
  // portal enabled + self-reg from last config
  const loginPage = await req('GET', '/account/login');
  check('GET /account/login 200 when enabled', loginPage.status === 200);
  check('login page has form', /name="username"/.test(loginPage.body));

  const regPage = await req('GET', '/account/register');
  check('GET /account/register 200 when self-reg on', regPage.status === 200);

  // disable self-reg → register 404
  config.saveConfig(
    Object.assign(config.loadConfig(), {
      crm: Object.assign({}, config.loadConfig().crm, {
        portal: { enabled: true, allowSelfRegister: false }
      })
    })
  );
  const regClosed = await req('GET', '/account/register');
  check('register 404 when self-reg off', regClosed.status === 404);

  // mint + login flow
  const cust = contacts.upsertContact({
    email: 'http@example.com',
    name: 'Http User',
    status: 'customer'
  }).contact;
  portal.createForContact(cust.id, 'httpuser', 'password99');

  const loginBad = await req('POST', '/account/login', {
    username: 'httpuser',
    password: 'nope'
  });
  check(
    'bad login redirects to login err',
    loginBad.status === 302 && /err=1/.test(loginBad.headers.location || '')
  );

  const loginOk = await req('POST', '/account/login', {
    username: 'httpuser',
    password: 'password99'
  });
  check('good login redirects to /account', loginOk.status === 302 && (loginOk.headers.location || '') === '/account');
  const cookieHdr = (loginOk.setCookie[0] || '').split(';')[0];
  check('sets tapuz_portal cookie', /tapuz_portal=/.test(cookieHdr));

  const me = await req('GET', '/account', null, cookieHdr);
  check('GET /account 200 with session', me.status === 200);
  check('account page shows name', /Http User/.test(me.body));
  check('account page shows history section', /היסטוריה/.test(me.body));

  // portal fully off → 404
  config.saveConfig(
    Object.assign(config.loadConfig(), {
      crm: Object.assign({}, config.loadConfig().crm, {
        portal: { enabled: false, allowSelfRegister: false }
      })
    })
  );
  const off = await req('GET', '/account/login');
  check('login 404 when portal disabled', off.status === 404);

  console.log(fail ? '\nSMOKE CRM-PORTAL: FAIL' : '\nSMOKE CRM-PORTAL: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
