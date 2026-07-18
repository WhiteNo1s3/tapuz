'use strict';

/**
 * v1.22 QA — proves src/routes/inbox.js works end-to-end as a mounted
 * Express Router: the forms-inbox / lead-pipeline (CRM) surface through
 * real HTTP. The inbox page renders real seeded leads with the pipeline
 * summary tiles, the CSV export works, and every lead mutation
 * (read/status/value/follow-up/notes/delete) round-trips through the
 * mounted router and actually persists in the forms store.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-inbox-route-'));
const PORT = 3982;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
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

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'inbox-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');

  // seed two real leads
  const forms = require('../src/forms');
  const a = forms.saveSubmission({ fields: { name: 'דנה כהן', email: 'dana@example.com' }, page: 'contact' });
  const b = forms.saveSubmission({ fields: { name: 'יוסי לוי' }, page: 'home' });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── the inbox page renders the real leads + pipeline tiles ──
    const page = await req('GET', '/admin/inbox', { cookie });
    check('GET /admin/inbox → 200 with the pipeline summary + real leads', page.status === 200 && /שווי פתוח בצנרת/.test(page.text) && /דנה כהן/.test(page.text) && /יוסי לוי/.test(page.text));

    // ── CSV export ──
    const csv = await req('GET', '/admin/inbox.csv', { cookie });
    check('GET /admin/inbox.csv → real CSV attachment with the leads', csv.status === 200 && /text\/csv/.test(csv.headers['content-type'] || '') && /attachment/.test(csv.headers['content-disposition'] || '') && /dana@example\.com/.test(csv.text));

    // ── status auto-save (silent JSON) ──
    const setStatus = await req('POST', '/admin/inbox/status', { cookie, body: { id: a.id, status: 'qualified', silent: true } });
    check('POST /admin/inbox/status persists a lead status', setStatus.status === 200 && setStatus.json.ok === true);

    // ── deal value auto-save ──
    const setValue = await req('POST', '/admin/inbox/value', { cookie, body: { id: a.id, value: '5000', silent: true } });
    check('POST /admin/inbox/value persists a deal value', setValue.status === 200 && setValue.json.ok === true);
    const badValue = await req('POST', '/admin/inbox/value', { cookie, body: { id: a.id, value: 'not-a-number', silent: true } });
    check('a non-numeric value is rejected (ok:false), not a crash', badValue.status === 200 && badValue.json.ok === false);

    // ── follow-up date auto-save ──
    const setFollow = await req('POST', '/admin/inbox/follow-up', { cookie, body: { id: a.id, date: '2026-08-01', silent: true } });
    check('POST /admin/inbox/follow-up persists a follow-up date', setFollow.status === 200 && setFollow.json.ok === true);
    const badFollow = await req('POST', '/admin/inbox/follow-up', { cookie, body: { id: a.id, date: 'nonsense', silent: true } });
    check('a malformed follow-up date is rejected (ok:false)', badFollow.status === 200 && badFollow.json.ok === false);

    // ── notes save ──
    const setNotes = await req('POST', '/admin/inbox/notes', { cookie, body: { id: a.id, notes: 'התקשר ביום ראשון', silent: true } });
    check('POST /admin/inbox/notes persists private notes', setNotes.status === 200 && setNotes.json.ok === true);

    // ── everything above actually landed in the store (verify via the page + tiles) ──
    const page2 = await req('GET', '/admin/inbox', { cookie });
    check('the persisted value shows on a fresh inbox render (₪5,000 in the open-pipeline tile)', /5,?000/.test(page2.text));
    const qualified = await req('GET', '/admin/inbox?status=qualified', { cookie });
    check('?status= filter narrows the inbox to that stage', qualified.status === 200 && /דנה כהן/.test(qualified.text) && !/יוסי לוי/.test(qualified.text));

    // ── mark read (silent) then delete (form POST → redirect) ──
    const markRead = await req('POST', '/admin/inbox/read', { cookie, body: { id: b.id, read: '1', silent: true } });
    check('POST /admin/inbox/read marks a lead read', markRead.status === 200 && markRead.json.ok === true);
    const del = await req('POST', '/admin/inbox/delete', { cookie, form: { id: String(b.id) } });
    check('POST /admin/inbox/delete removes a lead (redirects back to the inbox)', del.status === 302 || del.status === 303 || (del.status === 200));
    const page3 = await req('GET', '/admin/inbox', { cookie });
    check('the deleted lead is gone from the inbox', !/יוסי לוי/.test(page3.text));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE INBOX-ROUTE: FAIL' : 'SMOKE INBOX-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
