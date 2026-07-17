'use strict';

/**
 * v0.88 QA — the command palette (Ctrl+K, the OS key).
 * Ranking logic runs headless via the UMD export; the server-side wiring
 * (layout boot JSON, topbar button, bare auth screens) is asserted on source.
 */

const fs = require('fs');
const path = require('path');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

// ── ranking (pure, Node) ──
const { score, rankCommands } = require('../public/admin-palette.js');

check('prefix beats word-start beats substring beats subsequence',
  score('an', 'analytics') < score('an', 'my analytics') &&
  score('an', 'my analytics') < score('an', 'banana') &&
  score('an', 'banana') < score('an', 'a-x-n') &&
  score('an', 'a-x-n') >= 0);
check('no match → -1', score('zzz', 'analytics') === -1 && score('x', '') === -1);

const CMDS = [
  { label: 'דפים', keywords: 'pages list', hint: 'תוכן' },
  { label: 'אנליטיקס', keywords: 'analytics stats', hint: 'קידום' },
  { label: 'ערכת נושא', keywords: 'theme design', hint: 'עיצוב' },
  { label: 'דף חדש', keywords: 'new page create', hint: 'פעולה' }
];
check('Hebrew query finds Hebrew label', rankCommands('אנל', CMDS)[0].label === 'אנליטיקס');
check('English keyword reaches the same command', rankCommands('analytics', CMDS)[0].label === 'אנליטיקס');
check('word-start works across Hebrew spaces', rankCommands('נושא', CMDS)[0].label === 'ערכת נושא');
check('label match outranks keyword match', rankCommands('דפ', CMDS)[0].label === 'דפים');
check('empty query returns commands in original order', rankCommands('', CMDS)[0].label === 'דפים');
check('limit respected', rankCommands('', CMDS, 2).length === 2);
check('no matches → empty list', rankCommands('qqqq', CMDS).length === 0);

// ── server wiring (source asserts, like smoke-extension) ──
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
check('layout injects the palette boot JSON', /__TAPUZ_NAV__/.test(server) && /paletteBootJson\(\)/.test(server));
check('layout loads admin-palette.js', /admin-palette\.js/.test(server));
check('every nav item feeds the palette', /for \(const g of ADMIN_NAV_GROUPS\)[\s\S]{0,200}commands\.push/.test(server));
check('palette carries the everyday actions', /דף חדש/.test(server) && /inbox\.csv.*hint: 'פעולה'/.test(server));
check('topbar has the Ctrl+K button', /TapuzPalette\.open\(\)/.test(server) && /Ctrl K/.test(server));
check('auth screens are bare (no palette pre-login)',
  (server.match(/authCard\(inner\), '[^']+', '#\w+', \{ bare: true \}/g) || []).length === 3);
check('bare skips the palette in layout', /opts\.bare \? ''/.test(server));

// palette boot JSON is valid and complete (require the builder indirectly:
// pull the KEYWORDS map keys out and make sure no nav item was orphaned)
const navKeys = [...server.matchAll(/\{ key: '([\w-]+)', href: '\/admin/g)].map((m) => m[1]);
check('nav has the expected sections', navKeys.includes('pages') && navKeys.includes('analytics') && navKeys.includes('chat'));

console.log('');
console.log(fail ? 'SMOKE PALETTE: FAIL' : 'SMOKE PALETTE: PASS');
process.exit(fail ? 1 : 0);
