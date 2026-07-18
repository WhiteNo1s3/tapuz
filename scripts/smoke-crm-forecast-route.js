'use strict';

/**
 * v1.12 QA — proves the new /admin/inbox/value and /admin/inbox/follow-up
 * routes work end-to-end through real HTTP, and that the pipeline-summary
 * numbers rendered at the top of /admin/inbox reflect real saved data.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-crm-forecast-route-'));
const PORT = 3972;
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
    title: 'אתר בדיקה', description: 'crm-forecast-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  const { saveSubmission, setStatus } = require('../src/forms');
  createAdmin('owner', 'owner-pass-1');
  const lead = saveSubmission({ page: 'צור-קשר', fields: { שם: 'לקוח' } });
  setStatus(lead.id, 'qualified');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    const valSaved = await req('POST', '/admin/inbox/value', { cookie, body: { id: lead.id, value: 7500, silent: true } });
    check('POST /admin/inbox/value saves via the mounted route', valSaved.status === 200 && valSaved.json.ok);

    const badVal = await req('POST', '/admin/inbox/value', { cookie, body: { id: lead.id, value: -50, silent: true } });
    check('a negative value is rejected with ok:false', badVal.status === 200 && badVal.json.ok === false);

    const today = new Date().toISOString().slice(0, 10);
    const fuSaved = await req('POST', '/admin/inbox/follow-up', { cookie, body: { id: lead.id, date: today, silent: true } });
    check('POST /admin/inbox/follow-up saves via the mounted route', fuSaved.status === 200 && fuSaved.json.ok);

    const page = await req('GET', '/admin/inbox', { cookie });
    check('GET /admin/inbox → 200', page.status === 200);
    check('the pipeline summary shows the real saved value (₪7,500)', page.text.includes('7,500') || page.text.includes('7500'));
    check('a lead due today is flagged in the "due today/overdue" summary tile', /מטופל היום.*?>1</s.test(page.text) || page.text.includes('⏰'));
    check('the per-lead value pill renders the saved amount', page.text.includes('₪7,500') || page.text.includes('₪7500'));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE CRM-FORECAST-ROUTE: FAIL' : 'SMOKE CRM-FORECAST-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
