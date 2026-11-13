'use strict';

/**
 * Fill a NEW empty data root with the demo shop (חנות הדברים שאינם).
 *
 *   TAPUZ_ROOT=/path/to/new/empty/data node scripts/seed-demo-store.js --apply
 *
 * The same catalog also runs on boot when TAPUZ_DEMO_STORE=1 and the root
 * is confidently empty (src/store/demo-seed.js maybeDemoStore). This script
 * is the shell path. A .tapuz-root pin does not arm either path by itself,
 * TAPUZ_SEED=1 does not arm the demo, and the catalog is not in
 * seed/manifest.json. Without TAPUZ_ROOT the script exits before it reads
 * a pin. Without --apply it exits before it writes. A root that already
 * has site files is refused BEFORE the database is opened.
 *
 * The script seeds and nothing else: a demo that is already there is
 * upgraded by a boot with the flag, never from here. Since v2.69 the root
 * it leaves carries the demo's markers in config/seeded.json, exactly like
 * a boot-seeded one (before, only the boot wrote a marker — a script-seeded
 * demo was a site nothing called a demo, so it was never offered the demo
 * payment).
 */

if (!process.env.TAPUZ_ROOT) {
  console.error('REFUSED: set TAPUZ_ROOT to a new empty data directory. A .tapuz-root pin is not permission.');
  process.exit(2);
}
if (!process.argv.includes('--apply')) {
  console.error('REFUSED: pass --apply. This script does not write unless asked.');
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
console.log('DEMO_APPLIED version=' + result.version + ' products=' + result.products + ' homepage=' + result.homepage);
process.exit(0);
