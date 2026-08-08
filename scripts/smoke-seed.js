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

console.log('\nSMOKE SEED: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
