'use strict';

/**
 * v1.77 QA — proves src/routes/crm.js works end-to-end as a mounted Express
 * Router, through real HTTP.
 *
 * The two things that matter most here are not features:
 *   1. every CRM screen is unreachable without a session, and
 *   2. with config.crm.enabled OFF the CRM renders an offer rather than data,
 *      so a site that never turns it on is exactly the site it was before.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-crm-route-'));
const PORT = 3971;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'text/html', Origin: BASE };
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
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

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'crm-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });

  try {
    await waitUp();

    // ── unauthenticated: nothing is reachable ──
    const anon = await req('GET', '/admin/crm');
    check('GET /admin/crm is not reachable unauthenticated',
      anon.status !== 200 || !/אנשי קשר/.test(anon.text));
    const anonPost = await req('POST', '/admin/crm/settings', { form: { enabled: '1' } });
    check('POST /admin/crm/settings is not reachable unauthenticated', anonPost.status !== 302 || !/\/admin\/crm/.test(String(anonPost.headers.location || '')));

    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── OFF by default: an offer, not data, and not a 404 ──
    const off = await req('GET', '/admin/crm', { cookie });
    check('with the CRM off, the screen offers to enable it (200, no 404)',
      off.status === 200 && /מערכת הלקוחות כבויה/.test(off.text));
    const offSeg = await req('GET', '/admin/crm/segments', { cookie });
    check('every CRM screen shows the same offer while off', /מערכת הלקוחות כבויה/.test(offSeg.text));

    // ── turn it on ──
    const on = await req('POST', '/admin/crm/settings', { cookie, form: { enabled: '1' } });
    check('POST /admin/crm/settings enables the product', on.status === 302);

    const list = await req('GET', '/admin/crm', { cookie });
    check('GET /admin/crm now renders the contacts screen',
      list.status === 200 && /אנשי קשר/.test(list.text) && !/מערכת הלקוחות כבויה/.test(list.text));
    check('an empty CRM explains where contacts come from', /ייווצרו מהפניות/.test(list.text));

    // ── a real person, created through the seam ──
    const crm = require('../src/crm');
    // the child process owns the DB file; write through a fresh require in-proc
    const created = crm.captureForm({
      fields: { 'שם': 'דנה כהן', email: 'dana@example.com', 'טלפון': '050-111-2222' },
      page: '/contact', submissionId: 7
    });
    check('the seam created a person (flag is on)', created && created.contact.id > 0);

    const withRow = await req('GET', '/admin/crm', { cookie });
    check('the contacts list shows the real person',
      /דנה כהן/.test(withRow.text) && /dana@example\.com/.test(withRow.text));

    const detail = await req('GET', '/admin/crm/' + created.contact.id, { cookie });
    check('the datasheet renders identity, score and timeline',
      detail.status === 200 && /דנה כהן/.test(detail.text) && /ציר הזמן/.test(detail.text) && /למה הציון/.test(detail.text));

    // ── edits round-trip ──
    const upd = await req('POST', '/admin/crm/' + created.contact.id + '/update', {
      cookie, form: { name: 'דנה כהן-לוי', status: 'customer', tags: 'vip,ניוזלטר', notes: 'לקוחה ותיקה', consent: '1' }
    });
    check('POST update redirects back to the person', upd.status === 302);
    const after = await req('GET', '/admin/crm/' + created.contact.id, { cookie });
    check('the edit persisted (name, status, tags, consent)',
      /דנה כהן-לוי/.test(after.text) && /vip/.test(after.text) && /checked/.test(after.text));

    // ── a note lands on the timeline ──
    await req('POST', '/admin/crm/' + created.contact.id + '/note', { cookie, form: { text: 'שיחה טובה' } });
    const noted = await req('GET', '/admin/crm/' + created.contact.id, { cookie });
    check('a note appears on the timeline', /שיחה טובה/.test(noted.text));

    // ── segments: the literal path is not swallowed by /:id ──
    const segPage = await req('GET', '/admin/crm/segments', { cookie });
    check('GET /admin/crm/segments renders segments, NOT a contact named "segments"',
      segPage.status === 200 && /פילוחים/.test(segPage.text) && !/איש הקשר לא נמצא/.test(segPage.text));
    await req('POST', '/admin/crm/segments', { cookie, form: { name: 'לקוחות VIP', tags: 'vip', hasEmail: '1' } });
    const segAfter = await req('GET', '/admin/crm/segments', { cookie });
    check('a segment saves and reports a live size',
      /לקוחות VIP/.test(segAfter.text) && /1 אנשים/.test(segAfter.text));

    // ── lists ──
    const listsPage = await req('GET', '/admin/crm/lists', { cookie });
    check('GET /admin/crm/lists renders mailing lists', listsPage.status === 200 && /רשימות דיוור/.test(listsPage.text));
    await req('POST', '/admin/crm/lists', { cookie, form: { name: 'ניוזלטר' } });
    const listsAfter = await req('GET', '/admin/crm/lists', { cookie });
    check('a list saves with its member count', /ניוזלטר/.test(listsAfter.text) && /0 נמענים/.test(listsAfter.text));

    // ── a missing person is a clean 404, not a stack trace ──
    const missing = await req('GET', '/admin/crm/999999', { cookie });
    check('an unknown contact id is a clean 404',
      missing.status === 404 && /לא נמצא/.test(missing.text) && !/at Object/.test(missing.text));

    // ── turning it back off restores the previous world ──
    await req('POST', '/admin/crm/settings', { cookie, form: {} });
    const backOff = await req('GET', '/admin/crm', { cookie });
    check('turning the CRM off hides the data again',
      /מערכת הלקוחות כבויה/.test(backOff.text) && !/דנה כהן/.test(backOff.text));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE CRM-ROUTE: FAIL' : 'SMOKE CRM-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
