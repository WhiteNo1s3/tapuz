'use strict';

/**
 * Fill a NEW empty data root with the demo shop (חנות הדברים שאינם).
 *
 *   TAPUZ_ROOT=/path/to/new/empty/data node scripts/seed-demo-store.js --apply
 *
 * This is not the boot seed. A .tapuz-root pin does not arm it, TAPUZ_SEED=1
 * does not arm it, and it is not in seed/manifest.json. Without TAPUZ_ROOT
 * the script exits before it reads a pin, so it cannot follow one to a
 * living site. Without --apply it exits before it writes. A root that
 * already has site files is refused BEFORE the database is opened.
 */

if (!process.env.TAPUZ_ROOT) {
  console.error('REFUSED: set TAPUZ_ROOT to a new empty data directory. A .tapuz-root pin is not permission.');
  process.exit(2);
}
if (!process.argv.includes('--apply')) {
  console.error('REFUSED: pass --apply. The demo store is never applied on boot.');
  process.exit(2);
}

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, SITE_ROOT } = require('../src/paths');

function occupiedFiles() {
  const signs = [];
  for (const f of ['auth.json', 'site.json', 'menus.json', 'theme-overrides.json', 'seeded.json']) {
    if (fs.existsSync(path.join(CONFIG_DIR, f))) signs.push('config/' + f);
  }
  for (const d of ['pages', 'content']) {
    const p = path.join(SITE_ROOT, d);
    if (fs.existsSync(p) && fs.readdirSync(p).length) signs.push(d + '/');
  }
  return signs;
}

const files = occupiedFiles();
if (files.length) {
  console.error('REFUSED: root already holds a site (' + files.join(', ') + ')');
  process.exit(2);
}

const probe = require('../src/seed-content').inspectRoot();
if (!probe.empty || !probe.confident) {
  console.error('REFUSED: ' + probe.reason);
  process.exit(2);
}

process.env.TAPUZ_DEMO_STORE = '1';
const result = require('../src/store/demo-seed').applyDemo();
if (!result.ok) {
  console.error('REFUSED: ' + (result.message || result.code));
  process.exit(2);
}
console.log('DEMO_APPLIED products=' + result.products + ' homepage=' + result.homepage);
process.exit(0);
