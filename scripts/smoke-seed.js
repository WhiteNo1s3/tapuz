'use strict';

/**
 * Smoke: content seed (src/seed-content.js) — the deploy-archive content
 * package. Proves the whole safety contract:
 *   1. unarmed (no root pin, no TAPUZ_SEED=1) → complete no-op
 *   2. armed → pages created THROUGH pages.js and published, menu written
 *   3. marker → the same package never applies twice
 *   4. a second package without replace:true leaves an existing page alone
 * Hermetic: temp TAPUZ_ROOT + temp TAPUZ_SEED_DIR, nothing touches the repo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-seed-root-'));
const SEED = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-seed-pkg-'));
process.env.TAPUZ_ROOT = ROOT;
process.env.TAPUZ_SEED_DIR = SEED;
delete process.env.TAPUZ_SEED;
// hermetic means gone afterwards too — the temp root and package die with the process
process.on('exit', () => { for (const d of [ROOT, SEED]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } } });

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const PAGE = [
  '<!DOCTYPE html>',
  '<html lang="he" dir="rtl" bent-version="0.1">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <title>דף זריעה</title>',
  '    <meta name="bent-slug" content="seed-check" />',
  '  </head>',
  '  <body>',
  '    <bent-heading level="1">נזרע</bent-heading>',
  '    <bent-text>תוכן שהגיע מחבילת seed.</bent-text>',
  '  </body>',
  '</html>',
  ''
].join('\n');

fs.mkdirSync(path.join(SEED, 'pages'));
fs.writeFileSync(path.join(SEED, 'pages', 'p.pzn'), PAGE, 'utf8');
function writeManifest(m) {
  fs.writeFileSync(path.join(SEED, 'manifest.json'), JSON.stringify(m), 'utf8');
}
writeManifest({
  id: 'smoke-seed-1',
  pages: [{ file: 'pages/p.pzn', replace: true }],
  menus: { main: [{ label: 'נזרע', type: 'page', target: 'seed-check' }] },
  site: { title: 'אתר זרוע' }
});

const seed = require('../src/seed-content');
const pages = require('../src/pages');

// 1. unarmed → no-op (TAPUZ_ROOT is a temp dir, no .tapuz-root pin anywhere)
const r0 = seed.maybeSeed();
check('unarmed run is a no-op', r0.ran === false);
check('unarmed run created nothing', !pages.getPageByFullPath('seed-check'));

// 2. armed → applies through the product APIs
process.env.TAPUZ_SEED = '1';
const r1 = seed.maybeSeed();
check('armed run applies', r1.ran === true);
check('one page created', r1.results && r1.results.created === 1 && r1.results.failed === 0);
const pg = pages.getPageByFullPath('seed-check');
check('page exists and is published', !!pg && pg.status === 'published');
check('page kept a revision', pages.listRevisions('seed-check').length >= 1);
check('menu written', require('../src/menus').getMenu('main').some((i) => i.target === 'seed-check'));
check('site title patched', require('../src/config').loadConfig().title === 'אתר זרוע');
check('marker recorded', fs.existsSync(seed.MARKER_PATH));

// 3. marker → same package never re-applies
const r2 = seed.maybeSeed();
check('same package is not applied twice', r2.ran === false && /already applied/.test(r2.reason || ''));

// 4. a second package WITHOUT replace leaves the existing page alone
fs.writeFileSync(path.join(SEED, 'pages', 'p.pzn'), PAGE.replace('נזרע', 'דורס'), 'utf8');
writeManifest({ id: 'smoke-seed-2', pages: [{ file: 'pages/p.pzn' }] });
const r3 = seed.maybeSeed();
check('second package runs', r3.ran === true);
check('existing page skipped without replace flag', r3.results.skipped === 1 && r3.results.replaced === 0);
const pg2 = pages.getPageByFullPath('seed-check');
check('content untouched', JSON.stringify(pg2.blocks).includes('נזרע'));

// 5. syncPackagedTheme refreshes a stale site-local theme shadow (with backup)
const siteThemes = path.join(ROOT, 'themes');
fs.mkdirSync(path.join(siteThemes, 'default', 'css'), { recursive: true });
fs.writeFileSync(path.join(siteThemes, 'default', 'css', 'main.css'), '/* stale shadow */', 'utf8');
writeManifest({ id: 'smoke-seed-3', pages: [], syncPackagedTheme: 'default' });
const r4 = seed.maybeSeed();
check('theme-sync package runs', r4.ran === true);
const syncedCss = fs.readFileSync(path.join(siteThemes, 'default', 'css', 'main.css'), 'utf8');
const pkgCss = fs.readFileSync(path.join(__dirname, '..', 'themes', 'default', 'css', 'main.css'), 'utf8');
check('site theme copy refreshed from package', syncedCss === pkgCss);
check('stale copy backed up beside it',
  fs.existsSync(path.join(siteThemes, 'default.pre-smoke-seed-3', 'css', 'main.css')));

// 6. cleanup: backup chains pruned to newest, revision history trimmed
fs.writeFileSync(path.join(ROOT, 'config', 'menus.pre-old1.json'), '{}', 'utf8');
fs.writeFileSync(path.join(ROOT, 'config', 'menus.pre-old2.json'), '{}', 'utf8');
fs.writeFileSync(path.join(ROOT, 'config', 'menus.pre-current.json'), '{}', 'utf8');
// stagger mtimes so keep-latest deterministically keeps pre-current
const day = 86400000;
fs.utimesSync(path.join(ROOT, 'config', 'menus.pre-old1.json'), new Date(Date.now() - 2 * day), new Date(Date.now() - 2 * day));
fs.utimesSync(path.join(ROOT, 'config', 'menus.pre-old2.json'), new Date(Date.now() - day), new Date(Date.now() - day));
// pile revisions on the seeded page, then let cleanup trim to 2
for (let i = 0; i < 4; i++) {
  require('../src/pages').savePageSource('seed-check', PAGE, { publish: false });
}
writeManifest({
  id: 'smoke-seed-4',
  pages: [{ file: 'pages/p.pzn', replace: true }],
  cleanup: { backups: 'keep-latest', revisionsKeep: 2 }
});
const r5 = seed.maybeSeed();
check('cleanup package runs', r5.ran === true);
const leftBackups = fs.readdirSync(path.join(ROOT, 'config')).filter((f) => /^menus\.pre-/.test(f));
check('backup chain pruned to the newest one', leftBackups.length === 1 && /pre-current/.test(leftBackups[0]));
check('revision history trimmed to keep', pages.listRevisions('seed-check').length === 2);

// 7. v2.67 — a PIN-armed seed never rewrites a living site. The root now
//    holds pages (and we add an admin): a new package with replace:true,
//    armed only by the root pin (the upgrade-by-archive shape), must refuse —
//    no marker, page and menu untouched — and apply only when TAPUZ_SEED=1
//    says so. The pin itself is a file in the package root, which this smoke
//    must not write, so the arming mode is injected.
delete process.env.TAPUZ_SEED;
require('../src/auth').createAdmin('owner', 'seed-' + require('crypto').randomBytes(6).toString('hex'));
fs.writeFileSync(path.join(SEED, 'pages', 'p.pzn'), PAGE.replace('נזרע', 'דריסה-מפין'), 'utf8');
writeManifest({
  id: 'smoke-seed-pin-over-site',
  pages: [{ file: 'pages/p.pzn', replace: true }],
  menus: { main: [{ label: 'דורס', type: 'page', target: 'seed-check' }] },
  site: { title: 'אתר נדרס' }
});
check('seedArmedBy: TAPUZ_SEED=1 → explicit, 0 → false, unset without a pin → false', (() => {
  process.env.TAPUZ_SEED = '1'; const a = seed.seedArmedBy();
  process.env.TAPUZ_SEED = '0'; const b = seed.seedArmedBy();
  delete process.env.TAPUZ_SEED; const c = seed.seedArmedBy();
  return a === 'explicit' && b === false && c === false;
})());
check('rootHasSite is true for this root (it has an admin and pages)', seed.rootHasSite() === true);
const blocksBefore = JSON.stringify(pages.getPageByFullPath('seed-check').blocks);
const r7 = seed.maybeSeed({ armedBy: 'pin' });
check('pin-armed package over a living site is REFUSED, with the reason', r7.ran === false && /already holds a site/.test(r7.reason || ''));
check('…the page is byte-identical to before', JSON.stringify(pages.getPageByFullPath('seed-check').blocks) === blocksBefore);
check('…the menu was not touched', !require('../src/menus').getMenu('main').some((i) => i.label === 'דורס'));
check('…the site title was not patched', require('../src/config').loadConfig().title !== 'אתר נדרס');
check('…and no marker was written for it (a later explicit run can still apply it)',
  !(JSON.parse(fs.readFileSync(seed.MARKER_PATH, 'utf8'))['smoke-seed-pin-over-site']));
const r8 = seed.maybeSeed({ armedBy: 'explicit' });
check('the same package applies when armed EXPLICITLY (TAPUZ_SEED=1)', r8.ran === true && r8.results.replaced === 1);
check('…and the page now carries the package words (a revision of the old ones kept)',
  JSON.stringify(pages.getPageByFullPath('seed-check').blocks).includes('דריסה-מפין') && pages.listRevisions('seed-check').length >= 1);

// 8. The REAL pin, end to end, in child processes (fresh module state, no
//    TAPUZ_ROOT env, the pin read from a temp file via TAPUZ_PIN_FILE — the
//    test-only override, because a pin is a file in the package root):
//    8a. an actually EMPTY root → the seed applies (the fresh-site deploy);
//    8b. a root whose database is garbage → the inventory fails → REFUSED,
//        and the package's menu/site files were NOT written, no marker;
//    8c. a root holding only a malformed config/auth.json (loadAuth reads it
//        as "no users") → REFUSED on the file's presence alone.
function pinnedRun(root) {
  const pinFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-seed-pin-')), 'tapuz-root');
  fs.writeFileSync(pinFile, root, 'utf8');
  const env = { ...process.env, TAPUZ_PIN_FILE: pinFile, TAPUZ_SEED_DIR: SEED };
  delete env.TAPUZ_ROOT; delete env.TAPUZ_SEED;
  const r = require('child_process').spawnSync(process.execPath, ['-e', `
    const s = require(process.argv[1]);
    const paths = require(process.argv[2]);
    const r = s.maybeSeed();
    console.log('RESULT ' + JSON.stringify({ siteRoot: paths.SITE_ROOT, armedBy: s.seedArmedBy(), ran: r.ran, reason: r.reason || null, results: r.results || null }));
  `, path.join(__dirname, '..', 'src', 'seed-content'), path.join(__dirname, '..', 'src', 'paths')], { env, encoding: 'utf8' });
  try { fs.rmSync(path.dirname(pinFile), { recursive: true, force: true }); } catch (e) { /* best effort */ }
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT ')) || 'RESULT {}';
  return { ...JSON.parse(line.slice(7)), log: (r.stdout || '') + (r.stderr || '') };
}
writeManifest({
  id: 'smoke-seed-real-pin',
  pages: [{ file: 'pages/p.pzn', replace: true }],
  menus: { main: [{ label: 'מפין', type: 'page', target: 'seed-check' }] },
  site: { title: 'אתר מפין' }
});
const writtenBySeed = (root) => ['menus.json', 'site.json', 'seeded.json'].filter((f) => fs.existsSync(path.join(root, 'config', f)));

const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-seed-empty-'));
const e1 = pinnedRun(EMPTY);
check('8a. real pin + actually empty root: the pin is honoured (SITE_ROOT is the pinned dir, armed by pin)', e1.siteRoot === EMPTY && e1.armedBy === 'pin');
check('…and the seed APPLIES: one page created, menu + site + marker written', e1.ran === true && e1.results && e1.results.created === 1 && writtenBySeed(EMPTY).length === 3);
try { fs.rmSync(EMPTY, { recursive: true, force: true }); } catch (e) { /* best effort */ }

const BROKEN = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-seed-broken-'));
fs.mkdirSync(path.join(BROKEN, 'db'));
fs.writeFileSync(path.join(BROKEN, 'db', 'tapuz.db'), 'this is not a database — a site whose file could not be read');
const e2 = pinnedRun(BROKEN);
check('8b. real pin + a root whose database cannot be read: REFUSED, not confident, with the diagnostic',
  e2.ran === false && /could not be established/.test(e2.reason || '') && /pages:/.test(e2.reason || ''));
check('…nothing of the package landed: no menus.json, no site.json, no marker', writtenBySeed(BROKEN).length === 0);
check('…and the boot log says why', /NOT applied: could not establish that the root is empty/.test(e2.log));
try { fs.rmSync(BROKEN, { recursive: true, force: true }); } catch (e) { /* best effort */ }

const HALF = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-seed-half-'));
fs.mkdirSync(path.join(HALF, 'config'));
fs.writeFileSync(path.join(HALF, 'config', 'auth.json'), '{ "users": [ {"username": "owner", truncated');
const e3 = pinnedRun(HALF);
check('8c. real pin + a root with only a malformed auth.json: REFUSED on the sign of a site (the file), nothing written',
  e3.ran === false && /already holds a site/.test(e3.reason || '') && /config\/auth\.json/.test(e3.reason || '') && writtenBySeed(HALF).length === 0);
try { fs.rmSync(HALF, { recursive: true, force: true }); } catch (e) { /* best effort */ }

console.log('\nSMOKE SEED: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
