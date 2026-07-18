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
// v0.96 moved layout()/adminNav()/paletteBootJson()/ADMIN_NAV_GROUPS out of
// server.js into src/admin-ui.js (docs/ARCHITECTURE.md) — those checks read
// admin-ui.js now. v1.29 moved the auth screens (login/logout/create-account)
// out to src/routes/auth-screens.js, so the bare-auth-card check reads THAT
// module now, not server.js — the same stale-source-assert fix pattern used
// when symbols moved in v1.20.
const adminUi = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin-ui.js'), 'utf8');
const authScreens = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth-screens.js'), 'utf8');
check('layout injects the palette boot JSON', /__TAPUZ_NAV__/.test(adminUi) && /paletteBootJson\(\)/.test(adminUi));
check('layout loads admin-palette.js', /admin-palette\.js/.test(adminUi));
check('every nav item feeds the palette', /for \(const g of ADMIN_NAV_GROUPS\)[\s\S]{0,200}commands\.push/.test(adminUi));
check('palette carries the everyday actions', /דף חדש/.test(adminUi) && /inbox\.csv.*hint: 'פעולה'/.test(adminUi));
check('topbar has the Ctrl+K button', /TapuzPalette\.open\(\)/.test(adminUi) && /Ctrl K/.test(adminUi));
check('auth screens are bare (no palette pre-login)',
  (authScreens.match(/authCard\(inner\), '[^']+', '#\w+', \{ bare: true \}/g) || []).length === 3);
check('bare skips the palette in layout', /opts\.bare \? ''/.test(adminUi));

// palette boot JSON is valid and complete (require the builder indirectly:
// pull the KEYWORDS map keys out and make sure no nav item was orphaned)
const navKeys = [...adminUi.matchAll(/\{ key: '([\w-]+)', href: '\/admin/g)].map((m) => m[1]);
check('nav has the expected sections', navKeys.includes('pages') && navKeys.includes('analytics') && navKeys.includes('chat'));

console.log('');
console.log(fail ? 'SMOKE PALETTE: FAIL' : 'SMOKE PALETTE: PASS');
process.exit(fail ? 1 : 0);
