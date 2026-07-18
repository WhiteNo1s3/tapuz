'use strict';

/**
 * v1.28 QA — proves src/routes/form-capture.js works end-to-end as a
 * mounted Express Router: the PUBLIC form endpoint (POST /api/form → forms
 * inbox) and the RTL thank-you page (GET /form-sent), unauthenticated. New
 * HTTP-level coverage: prior form tests exercise forms.saveSubmission at the
 * module level, never the endpoint's own behavior (honeypot, Referer page
 * attribution, JSON-vs-redirect, and the per-IP formLimiter that moved here
 * with the routes — driven low via TAPUZ_FORM_MAX to trip it deterministically).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-form-capture-route-'));
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, form, accept, referer } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: accept || 'text/html' };
    if (form != null) {
      data = new URLSearchParams(form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (referer) headers['Referer'] = referer;
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
    title: 'אתר בדיקה', description: 'form-capture-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');

  // TAPUZ_FORM_MAX=4 so we can trip the moved formLimiter deterministically.
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT), TAPUZ_FORM_MAX: '4' },
    stdio: 'ignore'
  });
  try {
    await waitUp();

    // ── the thank-you page (public GET) ──
    const thanks = await req('GET', '/form-sent');
    check('GET /form-sent → 200 RTL thank-you page (noindex)', thanks.status === 200 && /ההודעה נשלחה/.test(thanks.text) && /noindex/.test(thanks.text));

    // ── a real submission lands in the inbox. NOTE: the endpoint is mounted
    //    after the urlencoded parser but before the JSON body-parser, so the
    //    request BODY is always urlencoded (a real HTML/AJAX form post);
    //    Accept: application/json only selects the JSON *response* shape. ──
    const ok = await req('POST', '/api/form', { accept: 'application/json', form: { name: 'דנה', email: 'dana@example.com', _page: 'contact' } });
    check('POST /api/form (Accept: json) → {ok,id}, a real submission saved', ok.status === 200 && ok.json && ok.json.ok === true && ok.json.id);

    // verify it actually persisted with the explicit _page attribution
    const forms = require('../src/forms');
    const subs = forms.listSubmissions({ limit: 10 });
    check('the submission persisted with its fields', subs.some((s) => s.fields && s.fields.email === 'dana@example.com'));
    check('explicit _page field drives page attribution (and _-keys are stripped)', subs.some((s) => s.page === 'contact' && !('_page' in (s.fields || {}))));

    // ── honeypot: a filled _hp pretends success but stores NOTHING ──
    const before = forms.listSubmissions({ limit: 100 }).length;
    const hp = await req('POST', '/api/form', { accept: 'application/json', form: { name: 'bot', _hp: 'trap' } });
    check('honeypot submission returns ok:true (bot learns nothing)', hp.status === 200 && hp.json && hp.json.ok === true);
    const after = forms.listSubmissions({ limit: 100 }).length;
    check('honeypot submission stored NOTHING (count unchanged)', after === before);

    // ── Referer-based page attribution when no _page is given ──
    await req('POST', '/api/form', { accept: 'application/json', form: { msg: 'hi' }, referer: BASE + '/about.html' });
    check('missing _page falls back to the Referer path (about.html → about)', forms.listSubmissions({ limit: 100 }).some((s) => s.page === 'about'));

    // ── HTML (non-JSON) submission redirects to the thank-you page ──
    const htmlSubmit = await req('POST', '/api/form', { form: { name: 'רות' } });
    check('a plain form POST redirects to /form-sent', (htmlSubmit.status === 302 || htmlSubmit.status === 303) && /\/form-sent/.test(htmlSubmit.headers['location'] || ''));

    // ── rate limiting: TAPUZ_FORM_MAX=4/min → the burst eventually 429s ──
    // (we've already sent several this window; keep going until one trips)
    let got429 = false;
    for (let i = 0; i < 12 && !got429; i++) {
      const r = await req('POST', '/api/form', { accept: 'application/json', form: { n: String(i) } });
      if (r.status === 429) got429 = true;
    }
    check('the moved formLimiter still trips (429 after the per-minute cap)', got429);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE FORM-CAPTURE-ROUTE: FAIL' : 'SMOKE FORM-CAPTURE-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
