'use strict';

/**
 * v0.99 QA gate — theme packages: the first step of ".pzn is our RPM" for
 * themes. Round-trip export→import on a throwaway TAPUZ_ROOT, and the
 * validation that keeps a malformed/foreign JSON from corrupting
 * theme-overrides.json. Exit 1 on any failure.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-themepkg-'));

const theme = require('../src/theme');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── export: a self-describing, versioned package ──
const pkg = theme.exportThemePackage('הערכה שלי');
check(pkg.format === 'tapuz-theme', 'package carries the format tag');
check(pkg.version === theme.THEME_PACKAGE_VERSION, 'package carries the current version number');
check(pkg.name === 'הערכה שלי', 'custom name carried through');
check(typeof pkg.exportedAt === 'string' && !Number.isNaN(Date.parse(pkg.exportedAt)), 'exportedAt is a real timestamp');
check(pkg.overrides && pkg.overrides.colors && pkg.overrides.colors.primary, 'overrides embed the real theme data (colors present)');

// unnamed export still produces a usable name, never throws
check(typeof theme.exportThemePackage().name === 'string' && theme.exportThemePackage().name.length > 0, 'export without a name still produces a fallback name');

// ── round-trip: customize, export, reset, import, verify it came back ──
theme.saveOverrides({ colors: { primary: '#123456' }, style: { radius: 'sharp' } });
const customized = theme.exportThemePackage('custom');
check(customized.overrides.colors.primary === '#123456', 'exported package reflects the customization');

theme.saveOverrides(theme.DEFAULT_OVERRIDES); // reset away from the customization
check(theme.loadOverrides().colors.primary !== '#123456', 'sanity: overrides really did reset');

const restored = theme.importThemePackage(customized);
check(restored.colors.primary === '#123456', 'importThemePackage returns the restored overrides');
check(theme.loadOverrides().colors.primary === '#123456', 'import persists — a fresh loadOverrides() sees the restored value');
check(theme.loadOverrides().style.radius === 'sharp', 'every overridden field round-trips, not just colors');

// ── validation: a malformed/foreign package throws a clear error, never applies ──
const before = theme.loadOverrides().colors.primary;
function rejects(label, badPkg) {
  let threw = false;
  try { theme.importThemePackage(badPkg); } catch (e) { threw = true; }
  check(threw, label);
}
rejects('rejects null', null);
rejects('rejects a plain string', 'not an object');
rejects('rejects an object with no format field', { overrides: { colors: { primary: '#000' } } });
rejects('rejects the wrong format tag (a foreign JSON file)', { format: 'some-other-app-theme', version: 1, overrides: {} });
rejects('rejects a version newer than this Tapuz understands', { format: 'tapuz-theme', version: 999, overrides: {} });
rejects('rejects a package with no overrides at all', { format: 'tapuz-theme', version: 1 });
check(theme.loadOverrides().colors.primary === before, 'every rejected import left the live theme untouched');

console.log('');
if (failures) {
  console.log('SMOKE THEME-PACKAGE: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE THEME-PACKAGE: PASS');
