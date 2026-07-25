'use strict';

/**
 * v1.81 QA — the PUBLIC email-tracking endpoints through real HTTP.
 *
 * These three URLs sit on the open internet with no authentication, because a
 * recipient's mail client is what fetches them. So the tests are about what
 * they refuse to do:
 *
 *   - the open pixel answers IDENTICALLY for a real and a fake token, so it
 *     cannot be used to discover which tokens exist,
 *   - a tracked link redirects only to the campaign's own frozen link, and a
 *     hand-crafted request cannot name a destination (no open redirect),
 *   - unsubscribe works from a plain GET and from the RFC 8058 One-Click POST,
 *   - and with the CRM off, all three are inert.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-track-route-'));
const PORT = 3967;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Origin: BASE };
    if (cookie) headers.Cookie = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        buf: Buffer.concat(chunks),
        text: Buffer.concat(chunks).toString('utf8')
      }));
    });
    r.on('error', reject);
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

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'track route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });

  const config = require('../src/config');
  const contacts = require('../src/crm/contacts');
  const lists = require('../src/crm/lists');
  const campaigns = require('../src/crm/campaigns');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });

  try {
    await waitUp();

    // ── with the CRM off, the endpoints are inert but still well-behaved ──
    const offPixel = await req('GET', '/crm/o/' + 'a'.repeat(32) + '.gif');
    check('the open pixel serves a real gif even with the CRM off',
      offPixel.status === 200 && offPixel.headers['content-type'] === 'image/gif' && offPixel.buf.length > 20);
    const offClick = await req('GET', '/crm/c/' + 'a'.repeat(32) + '/0');
    check('a tracked link with the CRM off just goes home',
      offClick.status === 302 && offClick.headers.location === '/');

    // ── turn the CRM on and send a real campaign through a fake transport ──
    config.saveConfig(Object.assign(config.loadConfig(), { crm: { enabled: true } }));
    const person = contacts.upsertContact({ email: 'reader@example.com', name: 'קורא', consent: true }).contact;
    const list = lists.createList('רשימה');
    lists.addMember(list.id, person.id);
    const camp = campaigns.createCampaign({
      name: 'קמפיין', subject: 'נושא',
      body: '<a href="https://example.com/target">קישור</a>', listId: list.id
    });
    campaigns.startSend(camp.id, { baseUrl: BASE, sender: () => Promise.resolve({ ok: true }) });
    await new Promise((r) => setTimeout(r, 500));
    const send = campaigns.sendsFor(camp.id)[0];
    check('the campaign produced a send row with a token', !!(send && /^[a-f0-9]{32}$/.test(send.token)));

    // ── the open pixel ──
    const realPixel = await req('GET', '/crm/o/' + send.token + '.gif');
    const fakePixel = await req('GET', '/crm/o/' + 'b'.repeat(32) + '.gif');
    check('a real and a fake token get BYTE-IDENTICAL responses (no oracle)',
      realPixel.status === fakePixel.status &&
      realPixel.buf.equals(fakePixel.buf) &&
      realPixel.headers['content-type'] === fakePixel.headers['content-type']);
    check('the pixel is uncacheable, so every open is seen',
      /no-store/.test(realPixel.headers['cache-control'] || ''));
    check('the open was actually recorded', campaigns.sendsFor(camp.id)[0].opened_at != null);

    // ── the tracked link ──
    const click = await req('GET', '/crm/c/' + send.token + '/0');
    check('a tracked link redirects to the campaign\'s own URL',
      click.status === 302 && click.headers.location === 'https://example.com/target');
    check('the click was recorded', campaigns.sendsFor(camp.id)[0].clicked_at != null);

    // ── THE open-redirect attempts ──
    const evilQuery = await req('GET', '/crm/c/' + send.token + '/0?u=https://evil.example');
    check('a ?u= parameter is ignored — the destination still comes from the campaign',
      evilQuery.status === 302 && evilQuery.headers.location === 'https://example.com/target');
    const badIndex = await req('GET', '/crm/c/' + send.token + '/99');
    check('an out-of-range index goes home, never to a caller-supplied place',
      badIndex.status === 302 && badIndex.headers.location === '/');
    const badToken = await req('GET', '/crm/c/' + 'c'.repeat(32) + '/0');
    check('an unknown token goes home', badToken.status === 302 && badToken.headers.location === '/');
    const nonNumeric = await req('GET', '/crm/c/' + send.token + '/0x0');
    check('a malformed index goes home', nonNumeric.status === 302 && nonNumeric.headers.location === '/');

    // ── unsubscribe: GET page + One-Click POST ──
    const unsubPage = await req('GET', '/crm/u/' + send.token);
    check('unsubscribe renders a confirmation page',
      unsubPage.status === 200 && /הוסרתם מרשימת הדיוור/.test(unsubPage.text));
    check('unsubscribe actually cleared consent', contacts.getContact(person.id).consent === 0);
    check('the unsubscribe page is noindex', /noindex/.test(unsubPage.text));

    const person2 = contacts.upsertContact({ email: 'reader2@example.com', consent: true }).contact;
    lists.addMember(list.id, person2.id);
    const camp2 = campaigns.createCampaign({ name: 'שני', subject: 'נושא', body: 'x', listId: list.id });
    campaigns.startSend(camp2.id, { baseUrl: BASE, sender: () => Promise.resolve({ ok: true }) });
    await new Promise((r) => setTimeout(r, 500));
    const send2 = campaigns.sendsFor(camp2.id)[0];
    const oneClick = await req('POST', '/crm/u/' + send2.token);
    check('an RFC 8058 One-Click POST returns a bare 200 (no page)',
      oneClick.status === 200 && oneClick.text.length === 0);
    check('the One-Click POST cleared consent too',
      contacts.getContact(send2.contact_id).consent === 0);

    const unknownUnsub = await req('GET', '/crm/u/' + 'd'.repeat(32));
    check('an unknown unsubscribe token says so without confirming anything',
      unknownUnsub.status === 200 && /אינו בתוקף/.test(unknownUnsub.text));

    // ── the tracking endpoints must not shadow a real page ──
    const home = await req('GET', '/');
    check('the site itself still serves normally', home.status === 200);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE CRM-TRACK-ROUTE: FAIL' : 'SMOKE CRM-TRACK-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
