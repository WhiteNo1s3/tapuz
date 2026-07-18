'use strict';

/**
 * v1.16 QA — proves src/routes/analytics.js works end-to-end as a mounted
 * Express Router: the dashboard page and CSV export, seeded with REAL
 * pageviews through the actual public collector endpoint (/_tapuz/collect),
 * not fixture rows inserted directly into the DB — so this also proves the
 * collector → storage → dashboard pipeline still connects correctly through
 * the extraction, not just that the route file parses.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-analytics-route-'));
const PORT = 3976;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, cookie, headers: extraHeaders } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE, ...(extraHeaders || {}) };
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
    title: 'אתר בדיקה', description: 'analytics-route smoke',
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
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // ── seed real pageviews through the actual public collector ──
    for (let i = 0; i < 3; i++) {
      await req('POST', '/_tapuz/collect', {
        body: { path: '/home', ref: 'https://example.com/' },
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestBrowser/1.0' }
      });
    }
    // an admin path must never be recorded (defense-in-depth check)
    await req('POST', '/_tapuz/collect', {
      body: { path: '/admin/theme' },
      headers: { 'User-Agent': 'Mozilla/5.0 TestBrowser/1.0' }
    });
    // a DNT request must never be recorded
    await req('POST', '/_tapuz/collect', {
      body: { path: '/home' },
      headers: { 'User-Agent': 'Mozilla/5.0 TestBrowser/1.0', DNT: '1' }
    });

    // ── the dashboard page renders with real aggregated data ──
    const dash = await req('GET', '/admin/analytics?days=30', { cookie });
    check('GET /admin/analytics → 200, real page shell', dash.status === 200 && /אנליטיקס/.test(dash.text));
    check('the 3 real collected pageviews show up in the totals', new RegExp('>3<').test(dash.text));
    check('the referrer from the collected beacon shows up in top referrers', /example\.com/.test(dash.text));
    check('the admin-path pageview was never recorded (defense in depth survived the move)', !dash.text.includes('/admin/theme<'));

    // ── the range selector actually changes the query ──
    const dash7 = await req('GET', '/admin/analytics?days=7', { cookie });
    check('?days=7 is honored (range tab reflects the selection)', dash7.status === 200 && /7 <span/.test(dash7.text));
    const dashBad = await req('GET', '/admin/analytics?days=999', { cookie });
    check('an out-of-range days value falls back to the 30-day default, not a crash', dashBad.status === 200 && /30 <span/.test(dashBad.text));

    // ── CSV export — a real table with the seeded data ──
    const csv = await req('GET', '/admin/analytics.csv?what=daily&days=30', { cookie });
    check('GET /admin/analytics.csv → 200 real CSV with a filename', csv.status === 200 && /text\/csv/.test(csv.headers['content-type'] || '') && /attachment/.test(csv.headers['content-disposition'] || ''));
    check('the daily CSV carries the header row + the 3 real views', /"day","views","visitors"/.test(csv.text) && /,"3","1"/.test(csv.text));

    const csvReferrers = await req('GET', '/admin/analytics.csv?what=referrers&days=30', { cookie });
    check('the referrers CSV table carries the real referrer host', csvReferrers.status === 200 && /example\.com/.test(csvReferrers.text));

    const csvBadTable = await req('GET', '/admin/analytics.csv?what=bogus', { cookie });
    check('an unknown CSV table name → 400 with the valid table list, not a crash', csvBadTable.status === 400 && csvBadTable.json.ok === false && Array.isArray(csvBadTable.json.tables));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE ANALYTICS-ROUTE: FAIL' : 'SMOKE ANALYTICS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
