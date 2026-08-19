'use strict';

/**
 * v2.23 QA — the theme SHELF: built-in LOOKS seed the library.
 *
 * Ben: "if we present a slim choice of themes, what are we worth as a
 * company?" A fresh site's theme screen opens to a real shelf — every LOOK
 * as a full library entry — and the seeding respects the owner: a deleted
 * preset stays deleted (per-key ledger), while looks added in future
 * versions still arrive.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-shelf-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const theme = require('../src/theme');
const lib = require('../src/theme-library');
const lookKeys = Object.keys(theme.LOOKS);

check('the gallery is not slim (10+ looks, 4 of them chrome-rich)',
  lookKeys.length >= 10 &&
  lookKeys.filter((k) => theme.LOOKS[k].overrides.chrome).length >= 4);

// ── first listing seeds the whole shelf ──────────────────────────────
const first = lib.listThemes();
check('a fresh library lists every look as a preset entry',
  lookKeys.every((k) => first.some((t) => t.source === 'preset' && t.name.indexOf(theme.LOOKS[k].label) !== -1)));
check('preset entries carry palette previews', first.every((t) => t.palette.length >= 3));

// idempotent: listing again adds nothing
check('seeding is idempotent', lib.listThemes().length === first.length);

// ── a deleted preset stays deleted ───────────────────────────────────
const zahav = first.find((t) => t.name.indexOf('זהב') !== -1);
lib.removeTheme(zahav.id);
check('a deleted preset does NOT resurrect on the next listing',
  !lib.listThemes().some((t) => t.name.indexOf('זהב') !== -1));

// ── future looks still arrive (ledger is per-key) ────────────────────
const LIB_PATH = lib.LIBRARY_PATH;
const raw = JSON.parse(fs.readFileSync(LIB_PATH, 'utf8'));
raw.seededLooks = raw.seededLooks.filter((k) => k !== 'neon');
raw.themes = raw.themes.filter((t) => t.preset !== 'neon');
fs.writeFileSync(LIB_PATH, JSON.stringify(raw));
check('a look missing from the ledger seeds on the next listing (future-version path)',
  lib.listThemes().some((t) => t.name.indexOf('ניאון') !== -1));

// ── applying a chrome-rich preset makes the skeleton real ────────────
const neon = lib.listThemes().find((t) => t.name.indexOf('ניאון') !== -1);
lib.applyTheme(neon.id);
const css = theme.overridesToCss(theme.loadOverrides());
check('applying ניאון switches the palette AND the chrome',
  theme.loadOverrides().colors.primary === '#e11d90' &&
  /text-shadow: 0 0 12px #a3e635/.test(css) && /backdrop-filter: blur/.test(css));

// ── custom entries coexist untouched ─────────────────────────────────
const custom = lib.saveCurrentAsTheme('שלי');
check('a custom save sits beside the presets',
  lib.listThemes().some((t) => t.id === custom.id && t.source === 'manual'));

console.log(fail ? '\nSMOKE THEME-SHELF: FAIL' : '\nSMOKE THEME-SHELF: PASS');
process.exit(fail ? 1 : 0);
