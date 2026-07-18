'use strict';

/**
 * v1.23 QA — proves src/routes/settings.js works end-to-end as a mounted
 * Express Router: the site-settings page + save API, and the whole-site
 * package export/import (the ".pzn is our RPM" pillar). Security-relevant
 * (requireAdmin + import creates/overwrites pages), so the checks cover the
 * editor-403 gate, a real settings round-trip, the homepage-must-exist
 * guard, and a real export → import cycle including the collision policy.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-settings-route-'));
const PORT = 3983;
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
    title: 'אתר בדיקה', description: 'settings-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const { createAdmin, addTeamMember } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');
  addTeamMember('editor1', 'editor-pass-1', 'editor');
  // a real published page so homepage select + export have content
  const { createPage, savePageSource } = require('../src/pages');
  createPage({ title: 'עמוד בית', slug: 'welcome', blocks: [] });
  savePageSource('welcome', '<bent-heading level="1">ברוכים הבאים</bent-heading>', { publish: true });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const adminLogin = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const adminCookie = String(adminLogin.headers['set-cookie'] || '').split(';')[0];
    const editorLogin = await req('POST', '/admin/login', { form: { username: 'editor1', password: 'editor-pass-1' } });
    const editorCookie = String(editorLogin.headers['set-cookie'] || '').split(';')[0];

    // ── requireAdmin gate ──
    const editorPage = await req('GET', '/admin/settings', { cookie: editorCookie });
    check('an editor cannot open site settings (requireAdmin → 403)', editorPage.status === 403);
    const editorSave = await req('POST', '/admin/api/settings', { cookie: editorCookie, body: { title: 'x' } });
    check('an editor cannot save site settings (requireAdmin → 403)', editorSave.status === 403);

    // ── the settings page renders for admin ──
    const page = await req('GET', '/admin/settings', { cookie: adminCookie });
    check('GET /admin/settings → 200 with the settings form + site-package section', page.status === 200 && /st-title/.test(page.text) && /ייצוא \/ ייבוא אתר שלם/.test(page.text) && /welcome/.test(page.text));

    // ── settings round-trip ──
    const save = await req('POST', '/admin/api/settings', { cookie: adminCookie, body: { title: 'שם חדש', description: 'תיאור', language: 'en', homepage: 'welcome' } });
    check('POST /admin/api/settings saves real config', save.status === 200 && save.json.ok);
    const page2 = await req('GET', '/admin/settings', { cookie: adminCookie });
    check('the saved title round-trips on a fresh render', /שם חדש/.test(page2.text));

    // ── homepage-must-exist guard ──
    const badHome = await req('POST', '/admin/api/settings', { cookie: adminCookie, body: { homepage: 'no-such-page' } });
    check('setting a non-existent homepage → 400 with a clear error', badHome.status === 400 && badHome.json.ok === false && /no-such-page/.test(badHome.json.error || ''));

    // ── whole-site export ──
    const exp = await req('GET', '/admin/api/site-package/export', { cookie: adminCookie });
    check('GET /admin/api/site-package/export → a real tapuz-site package with the page', exp.status === 200 && exp.json.format === 'tapuz-site' && /attachment/.test(exp.headers['content-disposition'] || '') && JSON.stringify(exp.json).includes('welcome'));

    // ── import: default skips existing pages, overwrite updates them ──
    const importSkip = await req('POST', '/admin/api/site-package/import', { cookie: adminCookie, body: { package: exp.json } });
    check('re-importing the same package skips existing pages by default (no clobber)', importSkip.status === 200 && importSkip.json.ok && Array.isArray(importSkip.json.pagesSkipped) && importSkip.json.pagesSkipped.some((p) => p.includes('welcome')) && importSkip.json.pagesCreated.length === 0);
    const importOverwrite = await req('POST', '/admin/api/site-package/import', { cookie: adminCookie, body: { package: exp.json, overwrite: true } });
    check('import with overwrite:true updates the existing page instead', importOverwrite.status === 200 && importOverwrite.json.ok && importOverwrite.json.pagesUpdated.some((p) => p.includes('welcome')));

    // ── import validation: a wrong-format package → 400 ──
    const importBad = await req('POST', '/admin/api/site-package/import', { cookie: adminCookie, body: { package: { format: 'not-tapuz' } } });
    check('importing a wrong-format package → 400', importBad.status === 400 && importBad.json.ok === false);

    // ── the site-package routes are also requireAdmin ──
    const editorExport = await req('GET', '/admin/api/site-package/export', { cookie: editorCookie });
    check('an editor cannot export the whole site (requireAdmin → 403)', editorExport.status === 403);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE SETTINGS-ROUTE: FAIL' : 'SMOKE SETTINGS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
