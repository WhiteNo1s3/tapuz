'use strict';

/**
 * v0.96 QA gate — src/admin-ui.js, the first extraction out of the
 * src/server.js monolith (docs/ARCHITECTURE.md). Locks in that the shared
 * admin shell (layout/nav/palette/escape) still behaves correctly on its
 * own, independent of server.js wiring it in. Exit 1 on any failure.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-adminui-'));
process.env.TAPUZ_ROOT = tmpRoot;

const {
  escapeAdmin, ADMIN_NAV_GROUPS, ADMIN_ACCENTS, accentFor, adminNav, paletteBootJson, layout
} = require('../src/admin-ui');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── escapeAdmin: real entities, not a no-op ──
check(escapeAdmin('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;',
  'escapeAdmin neutralizes tags');
check(escapeAdmin('"quoted" & <tag>') === '&quot;quoted&quot; &amp; &lt;tag&gt;',
  'escapeAdmin handles quotes and ampersands together');
check(escapeAdmin(null) === '' && escapeAdmin(undefined) === '', 'escapeAdmin degrades null/undefined to empty string, never throws');

// ── nav groups / accents ──
check(Array.isArray(ADMIN_NAV_GROUPS) && ADMIN_NAV_GROUPS.length > 0, 'ADMIN_NAV_GROUPS is a non-empty list');
check(ADMIN_NAV_GROUPS.some(g => g.items.some(it => it.key === 'team')),
  'the v0.95 team nav item made it through the extraction');
check(typeof ADMIN_ACCENTS === 'object' && Object.keys(ADMIN_ACCENTS).length > 0, 'ADMIN_ACCENTS is derived and non-empty');
check(accentFor('team') === accentFor('settings'), 'team shares the system group accent with settings');
check(accentFor('does-not-exist') === '#f97316', 'an unknown key falls back to the brand orange');

// ── adminNav rendering ──
const nav = adminNav('team', 'צוות');
check(nav.includes('class="active"') && nav.includes('צוות'), 'adminNav marks the active section and shows the title');
check(nav.includes('/admin/team'), 'adminNav links to every configured route, incl. the v0.95 team page');
check(nav.includes('/admin/logout'), 'adminNav embeds the logout form target from auth.getAdminBase()');

// ── palette boot data ──
const paletteJson = paletteBootJson();
const commands = JSON.parse(paletteJson);
check(Array.isArray(commands) && commands.length > ADMIN_NAV_GROUPS.reduce((n, g) => n + g.items.length, 0),
  'palette commands include every nav item plus the extra quick actions');
check(paletteBootJson() === paletteJson, 'palette JSON is memoized (same string instance content on repeat calls)');

// ── layout() ──
const bare = layout('<p>hi</p>', 'כניסה', '#166534', { bare: true });
check(!bare.includes('admin-palette.js'), 'bare layout (auth screens) skips the command palette script');
check(bare.includes('<p>hi</p>') && bare.includes('כניסה'), 'bare layout includes content and title');

const full = layout('<p>content</p>', 'צוות', '#475569');
check(full.includes('admin-palette.js'), 'a normal layout includes the command palette script');
check(full.includes('--admin-accent: #475569'), 'layout injects the accent as a CSS variable');
check(full.includes('dir="rtl"') && full.includes('lang="he"'), 'layout is Hebrew/RTL by default');

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

console.log('');
if (failures) {
  console.log('SMOKE ADMIN-UI: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE ADMIN-UI: PASS');
