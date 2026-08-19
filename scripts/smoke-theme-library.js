'use strict';

/**
 * v2.21 QA — the theme LIBRARY: themes as artifacts, the WordPress attitude.
 *
 * Ben: a theme built with the AI "should be saved as one — not as the new
 * thing, but one of the things available." Proves: save-current-as-theme,
 * list with palette previews, apply (with the auto-backup promise: switching
 * never destroys unsaved work), rename, remove, the package round-trip in
 * and out of the library, and that importing to the library NEVER touches
 * the live site. TAPUZ_ROOT is redirected before any src module loads.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-theme-lib-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const theme = require('../src/theme');
const lib = require('../src/theme-library');

// ── save current as a named theme ────────────────────────────────────
theme.saveOverrides({ colors: { primary: '#166534', bg: '#ffffff' } });
const green = lib.saveCurrentAsTheme('ירוק יער');
check('current overrides save as a named entry', green.id.indexOf('thm_') === 0 && green.name === 'ירוק יער');
check('the entry is listed with a palette preview',
  lib.listThemes().some((t) => t.id === green.id && t.palette.indexOf('#166534') !== -1));
check('listing carries identity, never the full overrides blob',
  lib.listThemes().every((t) => !('overrides' in t)));

// ── a second look, then APPLY the first back ─────────────────────────
theme.saveOverrides({ colors: { primary: '#b91c1c' } });
const red = lib.saveCurrentAsTheme('אדום חגיגי');
// v2.23 seeds the LOOKS shelf into every library — count OWN entries only
const ownThemes = () => lib.listThemes().filter((t) => t.source !== 'preset');
check('two entries coexist (a library, not a slot)', ownThemes().length === 2);

// live is now red AND saved — applying green must not create a backup
const applied = lib.applyTheme(green.id);
check('apply switches the live theme', theme.loadOverrides().colors.primary === '#166534');
check('apply of saved work makes NO redundant backup', applied.backedUp === false && ownThemes().length === 2);

// unsaved live work: edit, then switch — the WordPress promise
theme.saveOverrides({ colors: { primary: '#7c3aed' } });
const applied2 = lib.applyTheme(red.id);
check('apply over UNSAVED work auto-backs it up first', applied2.backedUp === true);
const autoEntry = lib.listThemes().find((t) => t.source === 'auto');
check('the backup is a real library entry', !!autoEntry && lib.getTheme(autoEntry.id).overrides.colors.primary === '#7c3aed');
check('live is now the applied theme', theme.loadOverrides().colors.primary === '#b91c1c');

// a second unsaved switch ROLLS the auto backup instead of silting up
theme.saveOverrides({ colors: { primary: '#0e7490' } });
lib.applyTheme(green.id);
const autos = lib.listThemes().filter((t) => t.source === 'auto');
check('only ONE rolling auto-backup ever exists', autos.length === 1 &&
  lib.getTheme(autos[0].id).overrides.colors.primary === '#0e7490');

// ── package round-trip: out of the library, back into it ─────────────
const pkg = lib.exportTheme(red.id);
check('export is a valid theme package', pkg.format === 'tapuz-theme' && pkg.name === 'אדום חגיגי' && pkg.overrides);
const liveBefore = JSON.stringify(theme.loadOverrides());
const imported = lib.importPackageToLibrary(pkg);
check('an imported package lands in the library as a NEW entry', imported.id !== red.id && imported.source === 'import');
check('importing to the library NEVER touches the live site', JSON.stringify(theme.loadOverrides()) === liveBefore);
check('a foreign JSON is refused', (() => {
  try { lib.importPackageToLibrary({ format: 'wordpress-theme', version: 1, overrides: {} }); return false; }
  catch (e) { return true; }
})());

// ── rename / remove ──────────────────────────────────────────────────
lib.renameTheme(imported.id, 'העתק אדום');
check('rename sticks', lib.getTheme(imported.id).name === 'העתק אדום');
check('remove deletes the entry', lib.removeTheme(imported.id) === true && !lib.getTheme(imported.id));
check('removing a missing id returns false, never throws', lib.removeTheme('thm_nope') === false);

// ── the mounted route surface ────────────────────────────────────────
const express = require('express');
const http = require('http');
const app = express();
app.use(express.json());
app.use(require('../src/routes/theme'));
const server = app.listen(0, () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const req = (method, p, body) => new Promise((resolve, reject) => {
    const r = http.request(base + p, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });

  (async () => {
    const list = await req('GET', '/admin/api/theme/library');
    check('GET /admin/api/theme/library → 200 with the real entries',
      list.status === 200 && JSON.parse(list.body).themes.some((t) => t.name === 'ירוק יער'));
    const saved = await req('POST', '/admin/api/theme/library', { name: 'דרך ה-API' });
    check('POST saves via the mounted router', saved.status === 200 && JSON.parse(saved.body).name === 'דרך ה-API');
    const ap = await req('POST', '/admin/api/theme/library/apply', { id: JSON.parse(saved.body).id });
    check('apply via the mounted router', ap.status === 200 && JSON.parse(ap.body).ok === true);
    const bad = await req('POST', '/admin/api/theme/library/apply', { id: 'thm_nope' });
    check('apply of a missing id → 400, not a crash', bad.status === 400);
    const exp = await req('GET', '/admin/api/theme/library/export?id=' + JSON.parse(saved.body).id);
    check('export via the mounted router is a package', exp.status === 200 && JSON.parse(exp.body).format === 'tapuz-theme');

    server.close();
    console.log(fail ? '\nSMOKE THEME-LIBRARY: FAIL' : '\nSMOKE THEME-LIBRARY: PASS');
    process.exit(fail ? 1 : 0);
  })().catch((e) => {
    console.log('FAIL route surface threw: ' + e.message);
    server.close();
    process.exit(1);
  });
});
