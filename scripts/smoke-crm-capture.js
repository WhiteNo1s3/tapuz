'use strict';

/**
 * v1.77 QA — phase 2: passive capture on the CMS's live paths.
 *
 * These are the two hot paths in the product (a form submission and the
 * analytics beacon), so the tests care less about the CRM feature than about
 * the CMS surviving it:
 *
 *   - with the CRM off, both paths behave EXACTLY as before (no contact, no
 *     cookie, no event),
 *   - a linked browser lands on a person's timeline, an unlinked one never does,
 *   - and when the CRM is catastrophically broken — its core table dropped out
 *     from under the running server — a form submission still succeeds and is
 *     still saved. That is the promise: a CRM fault must never cost a lead.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-crm-capture-'));
const PORT = 3969;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie, headers: extra } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = Object.assign({ Accept: 'application/json', Origin: BASE }, extra || {});
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* non-json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitUp(tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/', () => resolve()).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries);
  });
}

/** Pull the CRM visitor cookie out of a Set-Cookie header list. */
function visitorCookie(res) {
  const set = res.headers['set-cookie'] || [];
  for (const c of [].concat(set)) {
    if (String(c).startsWith('tz_v=')) return String(c).split(';')[0];
  }
  return '';
}

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  const { db } = require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'crm capture smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });

  const config = require('../src/config');
  const crm = require('../src/crm');
  const forms = require('../src/forms');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });

  try {
    await waitUp();

    // ── CRM OFF: the CMS behaves exactly as it always did ──
    check('the CRM starts off', crm.isEnabled() === false);
    const offSubmit = await req('POST', '/api/form', {
      form: { name: 'אנונימי', email: 'off@example.com', _page: 'contact' }
    });
    check('a form submits normally with the CRM off', offSubmit.status === 200 && offSubmit.json.ok === true);
    check('the submission is saved to the inbox as always', forms.allSubmissions().length === 1);
    check('NO contact was created while the CRM was off',
      crm.contacts.countContacts() === 0);
    check('NO visitor cookie was set while the CRM was off', visitorCookie(offSubmit) === '');

    const offBeacon = await req('POST', '/_tapuz/collect', { body: { path: '/pricing' } });
    check('the beacon answers 204 with the CRM off', offBeacon.status === 204);
    check('no CRM events were recorded while off', crm.events.listRecent().length === 0);

    // ── turn it on ──
    const cfg = config.loadConfig();
    cfg.crm = { enabled: true };
    config.saveConfig(cfg);
    check('the CRM is now on (config is read per request, no restart)', crm.isEnabled() === true);

    // ── a form now resolves a PERSON and links the browser ──
    const submit = await req('POST', '/api/form', {
      form: { 'שם מלא': 'דנה כהן', email: 'Dana@Example.com', 'טלפון': '+972-50-111-2222', _page: 'contact' }
    });
    check('the form still returns success', submit.status === 200 && submit.json.ok === true);
    check('the submission is still saved to the inbox', forms.allSubmissions().length === 2);

    const person = crm.contacts.findByEmail('dana@example.com');
    check('the person behind the submission now exists', !!person && person.name === 'דנה כהן');
    check('their phone was normalized to the local form', person.phone === '0501112222');

    const cookie = visitorCookie(submit);
    check('the browser was linked with a first-party cookie', /^tz_v=[a-f0-9]{32}$/.test(cookie));
    const rawSet = [].concat(submit.headers['set-cookie'] || []).find((c) => c.startsWith('tz_v='));
    check('the visitor cookie is HttpOnly + SameSite=Lax (not readable by scripts)',
      /HttpOnly/i.test(rawSet) && /SameSite=Lax/i.test(rawSet));

    check('the submission is on their timeline, linked by ref_id', (() => {
      const evs = crm.events.listForContact(person.id);
      const sub = forms.allSubmissions()[0];
      return evs.some((e) => e.type === 'form' && e.ref_id === sub.id);
    })());

    // ── the beacon: linked browser lands on the timeline ──
    await req('POST', '/_tapuz/collect', { body: { path: '/pricing' }, cookie });
    check('a linked visit joins the person\'s timeline',
      crm.events.listForContact(person.id).some((e) => e.type === 'pageview' && e.path === '/pricing'));

    // ── and an unlinked visitor stays anonymous ──
    const before = crm.events.listRecent({ limit: 500 }).length;
    await req('POST', '/_tapuz/collect', { body: { path: '/anonymous-visit' } });
    check('an UNLINKED visit records nothing in the CRM (they stay anonymous)',
      crm.events.listRecent({ limit: 500 }).length === before);
    check('the anonymous visit is still counted in analytics as always', (() => {
      const rows = require('../src/db').db
        .prepare("SELECT COUNT(*) AS n FROM pageviews WHERE path = '/anonymous-visit'").get();
      return rows.n === 1;
    })());

    // ── a forged cookie resolves to nobody, and does not crash the beacon ──
    const forged = await req('POST', '/_tapuz/collect', {
      body: { path: '/forged' }, cookie: 'tz_v=' + 'f'.repeat(32)
    });
    check('a forged visitor token is simply unknown (204, nothing recorded)',
      forged.status === 204 && !crm.events.listRecent({ limit: 500 }).some((e) => e.path === '/forged'));

    // ── DNT still wins over everything ──
    const dnt = await req('POST', '/_tapuz/collect', {
      body: { path: '/dnt-page' }, cookie, headers: { DNT: '1' }
    });
    check('Do-Not-Track is respected even for a KNOWN person',
      dnt.status === 204 && !crm.events.listForContact(person.id).some((e) => e.path === '/dnt-page'));

    // ── THE PROMISE: a catastrophically broken CRM must not cost a lead ──
    // Drop the CRM's core table out from under the running server — every
    // captureForm call inside it will now throw at the SQL layer.
    db.exec('DROP TABLE crm_contacts');
    const underFailure = await req('POST', '/api/form', {
      form: { name: 'יוסי', email: 'yossi@example.com', _page: 'contact' }
    });
    check('a form STILL succeeds when the CRM is catastrophically broken',
      underFailure.status === 200 && underFailure.json.ok === true);
    check('and the lead is STILL saved to the inbox', forms.allSubmissions().length === 3);
    const beaconUnderFailure = await req('POST', '/_tapuz/collect', { body: { path: '/still-works' }, cookie });
    check('the beacon also survives a broken CRM', beaconUnderFailure.status === 204);
    check('analytics kept recording through the CRM failure', (() => {
      const rows = db.prepare("SELECT COUNT(*) AS n FROM pageviews WHERE path = '/still-works'").get();
      return rows.n === 1;
    })());
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE CRM-CAPTURE: FAIL' : 'SMOKE CRM-CAPTURE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
