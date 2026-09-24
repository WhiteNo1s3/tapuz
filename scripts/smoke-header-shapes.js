'use strict';

/**
 * The header's shape (v2.63) — Ben: "let the user move the menu … more
 * modern, less typecast". Three new knobs on the theme document, all of them
 * CSS only (published pages still ship no JavaScript):
 *   bent-layout  menu="top|side|side-end|bottom"
 *   bent-chrome  header-layout="bar|centered|floating"  drawer="inline|overlay"
 * Pure checks: the knobs and their validator, the body classes the renderer
 * stamps, the dialect round trip, the CSS the theme ships, the studio form,
 * the AI designer's vocabulary, the organizer's grammar, the presets.
 */

const fs = require('fs');
const path = require('path');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const root = path.join(__dirname, '..');
const theme = require('../src/theme');
const dialect = require('../src/bentml/theme-dialect');

// ── the knobs ────────────────────────────────────────────────────────────
check('menuKnobs: side-end and bottom are placements; header/drawer default to bar/inline',
  theme.menuKnobs({ layout: { menuPlacement: 'side-end' } }).placement === 'side-end' &&
  theme.menuKnobs({ layout: { menuPlacement: 'bottom' } }).placement === 'bottom' &&
  theme.menuKnobs({}).header === 'bar' && theme.menuKnobs({}).drawer === 'inline' &&
  theme.menuKnobs({ chrome: { headerLayout: 'floating', menuDrawer: 'overlay' } }).header === 'floating' &&
  theme.menuKnobs({ chrome: { headerLayout: 'floating', menuDrawer: 'overlay' } }).drawer === 'overlay');
{
  const r = theme.knobsToOverrides({ placement: 'left', header: 'pill', drawer: 'modal' });
  check('an unknown placement / header shape / drawer kind resets to the default with a Hebrew warning each',
    r.overrides.layout.menuPlacement === 'top' && r.overrides.chrome.headerLayout === 'bar' && r.overrides.chrome.menuDrawer === 'inline' &&
    r.warnings.length === 3 && /placement/.test(r.warnings[0]) && /header/.test(r.warnings[1]) && /drawer/.test(r.warnings[2]));
  const ok = theme.knobsToOverrides({ placement: 'bottom', header: 'floating', drawer: 'overlay' });
  check('…and the real values pass without a word',
    ok.overrides.layout.menuPlacement === 'bottom' && ok.overrides.chrome.headerLayout === 'floating' && ok.overrides.chrome.menuDrawer === 'overlay' && ok.warnings.length === 0);
}
{
  const o = { layout: { menuPlacement: 'bottom' }, chrome: { headerLayout: 'x', menuDrawer: 'overlay' } };
  const w = theme.sanitizeMenuKnobs(o);
  check('sanitizeMenuKnobs (a pasted theme, the studio form) keeps bottom/overlay and resets a bad header shape in place',
    o.layout.menuPlacement === 'bottom' && o.chrome.menuDrawer === 'overlay' && o.chrome.headerLayout === 'bar' && w.length === 1);
}

// ── the body classes ─────────────────────────────────────────────────────
const cls = (o) => theme.menuBodyClasses(o).join(' ');
check('an untouched site still stamps nothing', cls(theme.DEFAULT_OVERRIDES) === '' && cls({}) === '');
check('a side site still stamps exactly menu-side', cls({ layout: { menuPlacement: 'side' } }) === 'menu-side');
check('side-end stamps menu-side menu-side-end (the rail css, then the mirror)', cls({ layout: { menuPlacement: 'side-end' } }) === 'menu-side menu-side-end');
check('bottom stamps menu-bottom nav-collapse-never and drops flow / drawer / collapse (no breakpoint may fold the bar into a ☰)',
  cls({ layout: { menuPlacement: 'bottom' }, chrome: { menuOverflow: 'drawer', menuDrawer: 'overlay', menuCollapse: 'lg', menuCurrent: 'pill' } }) === 'menu-bottom nav-collapse-never nav-current-pill');
check('floating / centered stamp header-* on a top site only (a rail has no bar to shape)',
  cls({ chrome: { headerLayout: 'floating' } }) === 'header-floating' &&
  cls({ chrome: { headerLayout: 'centered' } }) === 'header-centered' &&
  cls({ layout: { menuPlacement: 'side' }, chrome: { headerLayout: 'floating' } }) === 'menu-side');
check('overlay stamps nav-overlay after the flow class and before the collapse point',
  cls({ chrome: { menuOverflow: 'drawer', menuDrawer: 'overlay', menuCollapse: 'lg' } }) === 'menu-drawer nav-overlay nav-collapse-lg');

// ── the dialect round trip ───────────────────────────────────────────────
{
  const src = '<bent-theme name="t"><bent-layout menu="bottom" /><bent-chrome header-layout="floating" drawer="overlay" /></bent-theme>';
  const p = dialect.parseTheme(src);
  check('the dialect reads menu="bottom", header-layout and drawer',
    p.overrides.layout.menuPlacement === 'bottom' && p.overrides.chrome.headerLayout === 'floating' && p.overrides.chrome.menuDrawer === 'overlay');
  const out = dialect.serializeTheme({ name: 't', overrides: p.overrides });
  check('…and writes them back', /menu="bottom"/.test(out) && /header-layout="floating"/.test(out) && /drawer="overlay"/.test(out));
}

// ── the css ──────────────────────────────────────────────────────────────
check('a floating header gets its glass surface from header-bg (84 % of it), a bar header emits nothing of the kind',
  /body\.header-floating \.site-header \{ background: color-mix\(in srgb, #101010 84%, transparent\); \}/.test(theme.overridesToCss({ chrome: { headerLayout: 'floating', headerBg: '#101010' } })) &&
  /color-mix\(in srgb, var\(--color-surface, #fff\) 84%, transparent\)/.test(theme.overridesToCss({ chrome: { headerLayout: 'floating' } })) &&
  !/header-floating/.test(theme.overridesToCss({})));
const main = fs.readFileSync(path.join(root, 'themes', 'default', 'css', 'main.css'), 'utf8');
check('the theme css ships the centered masthead',
  /body\.header-centered \.site-header \.header-inner \{ flex-direction: column;/.test(main) && /body\.header-centered \.main-nav ul \{ justify-content: center; \}/.test(main));
check('…the floating pill: sticky with air around it, a 999px radius, blur, and corners once its ☰ list is open',
  /body\.header-floating \.site-header \{[^}]*position: sticky;[^}]*top: 0\.75rem;[^}]*border-radius: 999px;[^}]*backdrop-filter: blur\(14px\);/.test(main) &&
  /body\.header-floating \.site-header:has\(\.nav-toggle:checked\) \{ border-radius: var\(--radius-lg, 18px\); \}/.test(main));
check('…the rail\'s content fills its track and the reading width lives on the container (measured: a 943px item overflowed a 745px track under the mirrored rail)',
  /body\.menu-side \.main-content \{[^}]*max-width: none;[^}]*min-width: 0;[^}]*margin: 0;/.test(main) &&
  /body\.menu-side \.main-content > \.container \{ max-width: var\(--max-width\); margin: 0 auto; \}/.test(main));
check('…the mirrored rail, only where the rail exists (≥ 901px)',
  /@media \(min-width: 901px\) \{\s*body\.menu-side-end \{ grid-template-columns: minmax\(0, 1fr\) 264px; \}/.test(main) &&
  /body\.menu-side-end \.site-header \{ grid-column: 2;[^}]*border-inline-start: 1px solid var\(--color-border\); \}/.test(main));
check('…the bottom bar: fixed along the bottom edge, no burger, sub-menus upward, the header blur lifted (a fixed bar inside a blurred header would be trapped)',
  /body\.menu-bottom \.main-nav \{[^}]*position: fixed;[^}]*bottom: 0;[^}]*inset-inline: 0;/.test(main) &&
  /body\.menu-bottom \.nav-toggle, body\.menu-bottom \.nav-burger \{ display: none; \}/.test(main) &&
  /body\.menu-bottom \.main-nav \.sub-menu \{ top: auto; bottom: calc\(100% \+ 0\.4rem\); \}/.test(main) &&
  /body\.menu-bottom \.site-header \{ backdrop-filter: none;/.test(main));
check('…the overlay drawer: off-canvas at the inline end, scrolls and never wraps (v2.64), a backdrop over the page, the burger above it and pinned to the panel corner while open (v2.65), the header blur lifted while open',
  /html body\.nav-overlay \.nav-toggle:checked ~ ul \{[^}]*position: fixed;[^}]*inset-inline-end: 0;[^}]*width: min\(320px, 86vw\);\s*box-sizing: border-box;/.test(main) &&
  // v2.64 — measured on the Hebrew site: a 17-row list in the fixed-height panel wrapped into a second column over the page
  /html body\.nav-overlay \.nav-toggle:checked ~ ul \{[^}]*flex-wrap: nowrap;\s*overflow-y: auto;[^}]*justify-content: flex-start;/.test(main) &&
  /html body\.nav-overlay \.main-nav:has\(\.nav-toggle:checked\)::after \{ content: '';[^}]*position: fixed; inset: 0;/.test(main) &&
  /html body\.nav-overlay \.nav-burger \{ position: relative; z-index: 160; \}/.test(main) &&
  // v2.65 — measured under the centered masthead: the burger sat over the panel's first item; open, it is pinned to the panel's corner
  /html body\.nav-overlay \.main-nav:has\(\.nav-toggle:checked\) \.nav-burger \{ position: fixed; top: 1rem; inset-inline-end: 1\.25rem;/.test(main) &&
  /html body\.nav-overlay \.site-header:has\(\.nav-toggle:checked\) \{ backdrop-filter: none;/.test(main));
check('the shapes never touch a site that did not ask: every new rule is keyed on a body class the knobs stamp',
  (main.match(/\n(?:html )?body\.(?:header-centered|header-floating|menu-side-end|menu-bottom|nav-overlay)/g) || []).length >= 20 &&
  !/\n\.site-header \{[^}]*border-radius: 999px/.test(main));

// ── the studio, the AI designer, the organizer, the presets ──────────────
const route = fs.readFileSync(path.join(root, 'src', 'routes', 'theme.js'), 'utf8');
check('the studio offers side-end / bottom placements, the header shape and the drawer kind',
  /opt\('side-end'/.test(route) && /opt\('bottom'/.test(route) && /id="th-ch-header"/.test(route) && /opt\('floating'/.test(route) && /id="th-ch-drawer"/.test(route) && /opt\('overlay'/.test(route));
const studio = fs.readFileSync(path.join(root, 'public', 'admin-theme.js'), 'utf8');
check('the studio script reads, fills and resets the two new selects',
  /headerLayout: val\('th-ch-header', 'bar'\)/.test(studio) && /menuDrawer: val\('th-ch-drawer', 'inline'\)/.test(studio) &&
  /setValue\('th-ch-header', ch\.headerLayout \|\| 'bar'\)/.test(studio) && /setValue\('th-ch-drawer', ch\.menuDrawer \|\| 'inline'\)/.test(studio) &&
  /'th-ch-header', 'th-ch-drawer'\]/.test(studio) && /headerLayout: 'bar', menuDrawer: 'inline'/.test(studio));
const roleplay = fs.readFileSync(path.join(root, 'src', 'theme-roleplay.js'), 'utf8');
check('the AI designer is told the new values, and what a floating pill is',
  /menu="top\|side\|side-end\|bottom"/.test(roleplay) && /header-layout="bar\|centered\|floating" drawer="inline\|overlay"/.test(roleplay) &&
  /גלולה צפה/.test(roleplay) && /\['body\.header-floating'/.test(roleplay) && /\['body\.menu-bottom'/.test(roleplay));
const org = fs.readFileSync(path.join(root, 'src', 'menu-organizer.js'), 'utf8');
check('the organizer grammar names the four placements', /placement="top\|side\|side-end\|bottom"/.test(org));
const looks = theme.LOOKS || {};
check('two looks stop being "logo left, menu right": neon floats, magazin is a masthead',
  !!(looks.neon && looks.neon.overrides.chrome.headerLayout === 'floating') && !!(looks.magazin && looks.magazin.overrides.chrome.headerLayout === 'centered'));
const docs = fs.readFileSync(path.join(root, 'docs', 'bent-theme.md'), 'utf8');
check('docs/bent-theme.md documents the three knobs', /header-layout=bar\\\|centered\\\|floating/.test(docs) && /drawer=inline\\\|overlay/.test(docs) && /menu=top\\\|side\\\|side-end\\\|bottom/.test(docs));

console.log('');
console.log(fail ? 'SMOKE HEADER-SHAPES: FAIL' : 'SMOKE HEADER-SHAPES: PASS');
process.exit(fail ? 1 : 0);
