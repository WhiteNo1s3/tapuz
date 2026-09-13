'use strict';

/**
 * v1.07 QA — proves src/routes/menus.js works end-to-end as a mounted
 * Express Router: the menu CRUD lifecycle (create/rename-via-recreate/
 * delete), nested items, and the location map (which menu renders where)
 * through real HTTP — not just that the code compiles.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-menus-route-'));
const PORT = 3966;
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
    title: 'אתר בדיקה', description: 'menus-route smoke',
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

    const page = await req('GET', '/admin/menus', { cookie });
    check('GET /admin/menus → 200 via the mounted router', page.status === 200 && page.text.includes('תפריטים'));
    check('the wizard-seeded main menu is embedded in the page boot data', page.text.includes('__TAPUZ_MENUS__'));

    // ── create a second menu with a nested item ──
    const saved = await req('POST', '/admin/api/menus/footer-links', {
      cookie,
      body: {
        items: [
          { type: 'custom', label: 'ראשי', url: '/', children: [{ type: 'custom', label: 'תת-פריט', url: '/sub' }] }
        ]
      }
    });
    check('POST /admin/api/menus/:name creates a new menu via the mounted router', saved.status === 200 && saved.json.ok);
    check('the new menu is in the returned menus map', !!saved.json.menus['footer-links']);

    const fetched = await req('GET', '/admin/api/menus', { cookie });
    check('nested items round-trip', fetched.json.menus['footer-links'][0].children[0].label === 'תת-פריט');

    // ── locations: assign the new menu to the footer ──
    const locSaved = await req('POST', '/admin/api/menus', {
      cookie, body: { menus: fetched.json.menus, locations: { main: 'main', footer: 'footer-links' } }
    });
    check('location assignment saves via the mounted router', locSaved.status === 200 && locSaved.json.locations.footer === 'footer-links');

    // ── delete ──
    const deleted = await req('POST', '/admin/api/menus/footer-links/delete', { cookie });
    check('delete via the mounted router removes the menu', deleted.status === 200 && !deleted.json.menus['footer-links']);

    const afterDelete = await req('GET', '/admin/api/menus', { cookie });
    check('the deleted menu is really gone on a fresh fetch', !afterDelete.json.menus['footer-links']);
    check('the untouched main menu survives a sibling delete', Array.isArray(afterDelete.json.menus.main));

    // ── v2.28: the organizer's layer on the menus page ──
    check('the /admin/menus page mounts the organizer card (id organizer, data-inject) and loads /admin-inject-card.js',
      /<section class="card" id="organizer" data-inject="menu-organizer"><\/section>/.test(page.text) && /src="\/admin-inject-card\.js"/.test(page.text) && /TapuzInjectCard\.mount\(el, 'menu-organizer'/.test(page.text));
    check('the editor head carries the capacity hint and the action row a ↩ שחזור select',
      /<p id="menu-fit" class="hint"><\/p>/.test(page.text) && /<select id="menu-restore"[^>]*><option value="">↩ שחזור<\/option>/.test(page.text));
    check('the page still works without the card script: the mount is guarded', /window\.TapuzInjectCard && typeof window\.TapuzInjectCard\.mount === 'function'/.test(page.text) && /el\.hidden = true/.test(page.text));

    const fit = await req('GET', '/admin/api/menus/fit', { cookie });
    check('GET /admin/api/menus/fit → the capacity estimate for the main menu',
      fit.status === 200 && fit.json.ok && typeof fit.json.fit.capacity === 'number' && fit.json.fit.capacity >= 1 && typeof fit.json.fit.rowsNow === 'number' && typeof fit.json.fit.charBudget === 'number' && fit.json.fit.mode === 'top');

    const bent = await req('GET', '/admin/api/menus/export.bent', { cookie });
    check('GET /admin/api/menus/export.bent → text/plain, the live menus as one <bent-menus> document',
      bent.status === 200 && /text\/plain/.test(bent.headers['content-type']) && /^<bent-menus version="1">\n  <bent-menu-layout placement="top"/.test(bent.text) && /<bent-menu name="main" location="main">/.test(bent.text) && /<\/bent-menus>\n$/.test(bent.text));

    // a candidate, previewed (never written): three links, one of them the wizard's home page
    const candidate = '<bent-menus version="1" note="בדיקה">\n  <bent-menu name="main" location="main">\n    <bent-link label="הבית" page="home" />\n    <bent-link label="גוגל" url="https://google.com" />\n    <bent-link label="חייגו" tel="+972501234567" />\n  </bent-menu>\n</bent-menus>';
    const pv = await req('POST', '/admin/api/menus/preview', { cookie, body: { reply: candidate, brief: '' } });
    check('POST /admin/api/menus/preview → the preview object (tree, diff, knobs, fit, fitLine, previewUrl) and never writes',
      pv.status === 200 && pv.json.ok && pv.json.preview && pv.json.preview.menus.main.tree.length === 3 && /^\/admin\/menus\/preview\/mp_/.test(pv.json.preview.previewUrl) && Array.isArray(pv.json.warnings) && pv.json.hard === false &&
      (await req('GET', '/admin/api/menus', { cookie })).json.menus.main.length === afterDelete.json.menus.main.length);
    const refused = await req('POST', '/admin/api/menus/preview', { cookie, body: { reply: '<bent-theme name="x"><bent-colors primary="#000" /></bent-theme>' } });
    check('a theme pasted as a menu is refused 400 THEME_NOT_MENU', refused.status === 400 && refused.json.code === 'THEME_NOT_MENU');

    const frame = await req('GET', pv.json.preview.previewUrl, { cookie });
    const nav = frame.text.slice(frame.text.indexOf('<nav class="main-nav"'), frame.text.indexOf('</nav>'));
    const liCount = (nav.match(/<li[\s>]/g) || []).length;
    const rendererTakesMenus = /options\.menus/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8'));
    check('GET /admin/menus/preview/:id → the real header as HTML, framable by the admin only (SAMEORIGIN + frame-ancestors self)',
      frame.status === 200 && /<!DOCTYPE html>/i.test(frame.text) && frame.headers['x-frame-options'] === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(frame.headers['content-security-policy'] || ''));
    if (rendererTakesMenus) {
      check(`the preview renders the CANDIDATE menu: 3 <li> in the main nav (got ${liCount})`, liCount === 3 && /tel:\+972501234567/.test(nav) && /https:\/\/google\.com/.test(nav));
    } else {
      check(`(renderer has no options.menus yet — group A) the preview falls back to the live menu: ${afterDelete.json.menus.main.length} <li> (got ${liCount})`, liCount === afterDelete.json.menus.main.length);
    }
    const unknown = await req('GET', '/admin/menus/preview/nope', { cookie });
    check('an unknown preview id shows the live menus instead of a blank frame', unknown.status === 200 && /<nav class="main-nav"/.test(unknown.text));

    // the preview store is keyed by LOCATION: a menu named "primary" assigned to the header must be what the frame shows
    const relocated = '<bent-menus version="1" note="primary בכותרת">\n  <bent-menu name="primary" location="main">\n    <bent-link label="ראשי" page="home" />\n    <bent-link label="חיצוני" url="https://example.com/" />\n  </bent-menu>\n</bent-menus>';
    const pv2 = await req('POST', '/admin/api/menus/preview', { cookie, body: { reply: relocated, brief: '' } });
    const frame2 = pv2.json && pv2.json.preview ? await req('GET', pv2.json.preview.previewUrl, { cookie }) : { text: '' };
    const nav2 = frame2.text.slice(frame2.text.indexOf('<nav class="main-nav"'), frame2.text.indexOf('</nav>'));
    const li2 = (nav2.match(/<li[\s>]/g) || []).length;
    check('POST preview with <bent-menu name="primary" location="main"> → the plan carries the new menu and its location, NEW_MENU soft, nothing hard',
      pv2.status === 200 && pv2.json.ok && pv2.json.preview.menus.primary && pv2.json.preview.menus.primary.location === 'main' && pv2.json.warnings.some((w) => w.code === 'NEW_MENU') && pv2.json.hard === false);
    if (rendererTakesMenus) {
      check(`… and its frame's main nav shows the CANDIDATE (2 <li> with the candidate labels, got ${li2}), not the old main menu`,
        li2 === 2 && /ראשי/.test(nav2) && /חיצוני/.test(nav2) && /https:\/\/example\.com\//.test(nav2));
    }
    const tooLong = await req('POST', '/admin/api/menus/preview', { cookie, body: { reply: candidate + ' '.repeat(70000), brief: '' } });
    check('a 70K reply is refused 400 REPLY_TOO_LONG before the parser runs', tooLong.status === 400 && tooLong.json && tooLong.json.code === 'REPLY_TOO_LONG');

    // ── backups + restore round trip ──
    const menusLib = require('../src/menus');
    const snapshotMain = (await req('GET', '/admin/api/menus', { cookie })).json.menus.main;
    const backup = menusLib.backupMenus('smoke snapshot');
    await req('POST', '/admin/api/menus/main', { cookie, body: { items: [{ type: 'custom', label: 'זמני', url: '/tmp' }, { type: 'custom', label: 'שני', url: '/two' }] } });
    check('the main menu was changed after the snapshot', (await req('GET', '/admin/api/menus', { cookie })).json.menus.main.length === 2);
    const list = await req('GET', '/admin/api/menus/backups', { cookie });
    check('GET /admin/api/menus/backups lists the snapshot (id, at, reason, counts), newest first',
      list.status === 200 && list.json.ok && list.json.backups.length >= 1 && list.json.backups[0].id === backup.id && list.json.backups[0].reason === 'smoke snapshot' && list.json.backups[0].counts.main === snapshotMain.length);
    const noAuth = await req('POST', '/admin/api/menus/restore', { body: { backupId: backup.id } });
    check('POST /admin/api/menus/restore needs a signed-in admin', noAuth.status !== 200);
    const restored = await req('POST', '/admin/api/menus/restore', { cookie, body: { backupId: backup.id } });
    check('POST /admin/api/menus/restore {backupId} → {ok, menus, locations, rebuildError} with the snapshot back in place',
      restored.status === 200 && restored.json.ok && restored.json.menus.main.length === snapshotMain.length && restored.json.locations.main === 'main' && restored.json.rebuildError === '');
    const listAfter = await req('GET', '/admin/api/menus/backups', { cookie });
    check('a restore leaves a pre-restore snapshot on top (a restore is itself undoable)', listAfter.json.backups[0].reason === 'pre-restore' && listAfter.json.backups[0].counts.main === 2);
    const missing = await req('POST', '/admin/api/menus/restore', { cookie, body: { backupId: 'nope' } });
    check('restoring an unknown backup is 404 NO_BACKUP', missing.status === 404 && missing.json.code === 'NO_BACKUP');
    check('the :name writer still ignores the reserved words (no menu called "restore" was created)', !(await req('GET', '/admin/api/menus', { cookie })).json.menus.restore);
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE MENUS-ROUTE: FAIL' : 'SMOKE MENUS-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
