'use strict';

/**
 * v2.28 QA — the site menu at capacity (Ben: "the menu breaks from the
 * amount of content on the menu").
 *
 * The live site has ten Hebrew items. The theme capped the header at the
 * content column, never wrapped the list above 640px, split multi-word labels
 * mid-word before the row overflowed, had NO css for nested items and never
 * marked the current page. This pins the fix as a contract between the
 * renderer and the theme:
 *   • a parent item carries `has-children`, its children render inside
 *     `ul.sub-menu`, and the theme STYLES that list (dropdown on hover and
 *     :focus-within, inline in the side rail and in the drawer)
 *   • the item that is this page carries aria-current="page" (home matches
 *     '/' as well as its own file) and `is-current`; its parent `has-current`
 *   • the layout carries a zero-JS drawer toggle (checkbox + label), shown by
 *     the theme on narrow screens or at every width when the theme says so
 *   • the header may be wider than the content column; labels never break;
 *     the row wraps by content
 *   • a nested footer menu keeps its children (flattened), never drops them
 *   • the knobs (theme.menuKnobs / menuBodyClasses): a fold ("עוד", a native
 *     <details>), the collapse breakpoint, the current-page mark, the strip,
 *     the drawer — each a body class the css keys on; an untouched top site
 *     stamps NO class at all, a side site exactly "menu-side"
 *   • options.menus renders a candidate menu set (the organizer's preview)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-menu-render-'));

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

require('../src/db');
const menus = require('../src/menus');
const theme = require('../src/theme');
const { renderPage, renderMenuItems } = require('../src/renderer');

// twelve top-level items, two of them parents — the shape that broke the bar
const items = [];
for (let i = 1; i <= 12; i++) items.push({ label: 'פריט ' + i, type: 'page', target: 'page-' + i });
items[2].children = [{ label: 'תת־פריט א', type: 'page', target: 'sub-a' }, { label: 'תת־פריט ב', type: 'custom', url: 'https://example.com' }];
items[7].children = [{ label: 'עוד אחד', type: 'anchor', target: 'top' }];
menus.saveMenus({ main: items, footer: [{ label: 'תקנון', type: 'page', target: 'terms', children: [{ label: 'פרטיות', type: 'page', target: 'privacy' }] }] });

const page = (fullPath, extra) => Object.assign({ title: 'דף', slug: fullPath, full_path: fullPath, direction: 'rtl', status: 'published', tags: [], meta: {}, blocks: [] }, extra || {});

// ── the rendered markup ───────────────────────────────────────────────
const html = renderPage(page('page-3'), { siteTitle: 'אתר' });
const navOf = (h) => h.slice(h.indexOf('<nav class="main-nav"'), h.indexOf('</nav>'));
check('a parent item carries has-children (and is-current when it IS this page) and its children render inside ul.sub-menu',
  /<li class="has-children is-current"><a href="\/page-3\.html"[^>]*>פריט 3<\/a><ul class="sub-menu">/.test(html) && /תת־פריט ב/.test(html));
check('the item that IS this page carries aria-current="page" — and no other item does',
  /<a href="\/page-3\.html" aria-current="page">/.test(navOf(html)) && (navOf(html).match(/aria-current="page"/g) || []).length === 1);
const childNav = navOf(renderPage(page('sub-a'), { siteTitle: 'אתר' }));
check('a child page: its li is is-current, its parent li is has-children has-current, nothing else is marked',
  /<li class="has-children has-current"><a href="\/page-3\.html">פריט 3<\/a><ul class="sub-menu"><li class="is-current"><a href="\/sub-a\.html" aria-current="page">תת־פריט א<\/a><\/li>/.test(childNav) &&
  (childNav.match(/is-current/g) || []).length === 1 && (childNav.match(/has-current/g) || []).length === 1);
menus.saveMenus({ main: [{ label: 'הבית', type: 'custom', url: '/' }].concat(items) });
const homeNav = navOf(renderPage(page('home'), { siteTitle: 'אתר', isHome: true }));
check('the crowned home marks a "/" item as current too', /<li class="is-current"><a href="\/" aria-current="page">הבית<\/a>/.test(homeNav) && (homeNav.match(/aria-current="page"/g) || []).length === 1);
check('a page that is not in the menu marks nothing', !/aria-current|is-current|has-current/.test(navOf(renderPage(page('orphan'), { siteTitle: 'אתר' }))));
check('the layout carries the zero-JS drawer toggle: a checkbox and its label, before the list',
  /<input type="checkbox" id="nav-toggle" class="nav-toggle">\s*<label for="nav-toggle" class="nav-burger" aria-label="תפריט">/.test(html) && html.indexOf('class="nav-burger"') < html.indexOf('<ul>'));
check('the twelve items are all there, in order', (html.match(/<li[^>]*><a href="\/page-\d+\.html"/g) || []).length === 12 && html.indexOf('פריט 1<') < html.indexOf('פריט 12<'));
check('a nested footer menu keeps its children (flattened after the parent)',
  /<nav class="footer-nav" aria-label="[^"]*">\s*<a href="\/terms\.html">תקנון<\/a> &nbsp;\|&nbsp; <a href="\/privacy\.html">פרטיות<\/a>/.test(html));
// the theme has css for the bar, a dropdown and a flyout — nothing deeper. The
// store itself keeps one nesting level (the organizer lifts grandchildren), so
// the renderer's cap is pinned on the function, with a raw four-level tree
const deep = renderMenuItems([{ label: 'א', url: '/a.html', children: [{ label: 'ב', url: '/b.html', children: [{ label: 'ג', url: '/c.html', children: [{ label: 'ד', url: '/d.html' }] }] }] }], '/c.html');
check('lists render three levels deep (bar → dropdown → flyout) and stop there; has-current climbs every rendered level',
  deep === '<li class="has-children has-current"><a href="/a.html">א</a><ul class="sub-menu"><li class="has-children has-current"><a href="/b.html">ב</a><ul class="sub-menu"><li class="is-current"><a href="/c.html" aria-current="page">ג</a></li></ul></li></ul></li>');

// ── the fold: "עוד" as a native <details>, zero JS ───────────────────
menus.saveMenus({ main: items });
theme.saveOverrides({ chrome: { menuFold: 5 } });
const folded = navOf(renderPage(page('page-9'), { siteTitle: 'אתר' }));
const foldAt = folded.indexOf('<li class="nav-more');
const before = folded.slice(0, foldAt);
const inside = folded.slice(foldAt);
check('chrome.menuFold: 5 on twelve items → exactly five top-level items, then li.nav-more with a "עוד" summary and the rest in its ul.sub-menu',
  foldAt > 0 && (before.match(/<li[^>]*><a href="\/page-\d+\.html"/g) || []).length === 5 && /פריט 5<\/a><\/li>\n<li class="nav-more/.test(folded) &&
  /^<li class="nav-more[^"]*"><details><summary class="nav-more-sum">עוד<\/summary><ul class="sub-menu">/.test(inside) &&
  (inside.match(/<a href="\/page-\d+\.html"/g) || []).length === 7 && /פריט 12<\/a><\/li><\/ul><\/details><\/li>\s*<\/ul>\s*$/.test(inside));
check('a folded parent keeps its children as a nested list (the flyout) and the fold carries has-current when the page is inside it',
  /<li class="has-children"><a href="\/page-8\.html">פריט 8<\/a><ul class="sub-menu"><li><a href="#top">עוד אחד<\/a><\/li><\/ul><\/li>/.test(inside) &&
  /^<li class="nav-more has-current">/.test(inside) && /<li class="is-current"><a href="\/page-9\.html" aria-current="page">/.test(inside));
check('the fold is plain nav-more when the current page is outside it', /<li class="nav-more"><details>/.test(navOf(renderPage(page('page-2'), { siteTitle: 'אתר' }))));
check('an ltr page folds under "More"', /<summary class="nav-more-sum">More<\/summary>/.test(navOf(renderPage(page('page-9', { direction: 'ltr' }), { siteTitle: 'אתר' }))));
// (the css is inlined in <head> and names .nav-more, so these look at the nav only)
theme.saveOverrides({ chrome: { menuFold: 1 } });
const fold1 = navOf(renderPage(page('page-1'), {}));
check('menuFold: 1 is no fold (a fold that hides one item is pointless)', !/nav-more/.test(fold1) && (fold1.match(/<li[^>]*><a href="\/page-\d+\.html"/g) || []).length === 12);
theme.saveOverrides({ chrome: { menuFold: 12 } });
check('menuFold: 12 on twelve items is no fold (nothing is past it)', !/nav-more/.test(navOf(renderPage(page('page-1'), {}))));
theme.saveOverrides({ chrome: { menuFold: 5, menuOverflow: 'scroll' } });
const strip = renderPage(page('page-1'), {});
check('a scroll strip never folds (a strip clips dropdowns and scrolls to every item anyway)', !/nav-more/.test(navOf(strip)) && /<body class="menu-scroll">/.test(strip) && (navOf(strip).match(/<a href="\/page-\d+\.html"/g) || []).length === 12);
// the side rail: every item is a rail row and the rail itself scrolls, so the renderer skips the fold there — the
// organizer's FOLD_WITH_SIDE warning promises the owner the fold "will be ignored", and the renderer must agree
theme.saveOverrides({ chrome: { menuFold: 4 }, layout: { menuPlacement: 'side' } });
const railFold = renderPage(page('page-1'), {});
check('a side rail never folds either (menuFold 4 on twelve items + menuPlacement side → no li.nav-more, all twelve items flat)',
  /<body class="menu-side">/.test(railFold) && !/nav-more/.test(navOf(railFold)) && (navOf(railFold).match(/<li[^>]*><a href="\/page-\d+\.html"/g) || []).length === 12);
theme.saveOverrides({ chrome: { menuFold: 4 }, layout: { menuPlacement: 'top' } });
const topFold = navOf(renderPage(page('page-1'), {}));
check('the same fold on a top bar folds: four items, then li.nav-more',
  /<li class="nav-more"><details>/.test(topFold) && (topFold.slice(0, topFold.indexOf('<li class="nav-more')).match(/<li[^>]*><a href="\/page-\d+\.html"/g) || []).length === 4);
theme.saveOverrides({});

// ── the theme answers a long menu with a body class ───────────────────
theme.saveOverrides({ chrome: { menuOverflow: 'drawer' } });
check('chrome.menuOverflow: drawer stamps body.menu-drawer (the burger at every width)', /<body[^>]*class="[^"]*menu-drawer/.test(renderPage(page('page-1'), {})));
theme.saveOverrides({ chrome: { menuOverflow: 'scroll' } });
check('chrome.menuOverflow: scroll stamps body.menu-scroll (one strip)', /<body[^>]*class="[^"]*menu-scroll/.test(renderPage(page('page-1'), {})));
theme.saveOverrides({ chrome: { menuOverflow: 'wrap' }, layout: { menuPlacement: 'side' } });
const side = renderPage(page('page-1'), {});
check('the side rail still stamps body.menu-side, and wrap stamps nothing extra', /<body[^>]*class="menu-side"/.test(side));
theme.saveOverrides({ layout: { menuPlacement: 'top' } });

// ── every knob reaches the body as a class (theme.menuBodyClasses) ────
const bodyTag = (overrides, pg) => (renderPage(pg || page('page-1'), { overrides }).match(/<body[^>]*>/) || [''])[0];
check('an untouched top site stamps NO class attribute at all (defaults change nothing)',
  bodyTag(theme.DEFAULT_OVERRIDES) === '<body>' && bodyTag({}) === '<body>' && bodyTag({ chrome: { menuCollapse: 'md', menuCurrent: 'underline', menuFold: 0, menuOverflow: 'wrap' }, layout: { menuPlacement: 'top' } }) === '<body>');
check('a side site stamps exactly class="menu-side"', bodyTag({ layout: { menuPlacement: 'side' } }) === '<body class="menu-side">');
check('chrome.menuCollapse sm / lg / never → nav-collapse-sm / -lg / -never',
  bodyTag({ chrome: { menuCollapse: 'sm' } }) === '<body class="nav-collapse-sm">' && bodyTag({ chrome: { menuCollapse: 'lg' } }) === '<body class="nav-collapse-lg">' && bodyTag({ chrome: { menuCollapse: 'never' } }) === '<body class="nav-collapse-never">');
check('chrome.menuCurrent pill / bold / none → nav-current-pill / -bold / -none',
  bodyTag({ chrome: { menuCurrent: 'pill' } }) === '<body class="nav-current-pill">' && bodyTag({ chrome: { menuCurrent: 'bold' } }) === '<body class="nav-current-bold">' && bodyTag({ chrome: { menuCurrent: 'none' } }) === '<body class="nav-current-none">');
check('chrome.menuOverflow scroll / drawer → menu-scroll / menu-drawer', bodyTag({ chrome: { menuOverflow: 'scroll' } }) === '<body class="menu-scroll">' && bodyTag({ chrome: { menuOverflow: 'drawer' } }) === '<body class="menu-drawer">');
check('the classes come in one fixed order — side, flow, collapse, current — and the page background follows them',
  bodyTag({ layout: { menuPlacement: 'side' }, chrome: { menuOverflow: 'drawer', menuCollapse: 'lg', menuCurrent: 'bold' } }) === '<body class="menu-side menu-drawer nav-collapse-lg nav-current-bold">' &&
  bodyTag({ chrome: { menuCurrent: 'pill' } }, page('page-1', { meta: { background: { color: '#fff8f0' } } })) === '<body class="nav-current-pill tapuz-page-bg">');
check('an unknown knob value falls back to the default (no class, no crash)', bodyTag({ chrome: { menuCollapse: 'huge', menuCurrent: 'neon', menuOverflow: 'wat' } }) === '<body>');

// ── options.menus: a candidate menu set, the site's own menus untouched ──
const candidate = renderPage(page('alt'), { menus: { main: [{ label: 'חלופה', type: 'page', target: 'alt' }], footer: [{ label: 'פוטר', type: 'custom', url: '/f.html' }] } });
check('options.menus.main / .footer replace the rendered menus (the organizer preview), items resolve their urls',
  /<li class="is-current"><a href="\/alt\.html" aria-current="page">חלופה<\/a><\/li>/.test(navOf(candidate)) && !/פריט 1</.test(navOf(candidate)) && /<a href="\/f\.html">פוטר<\/a>/.test(candidate) && !/תקנון/.test(candidate));
const partial = renderPage(page('page-1'), { menus: { main: [] } });
check('an empty array empties that location; a location not given keeps the site menu', !/<li/.test(navOf(partial)) && /<a href="\/terms\.html">תקנון<\/a>/.test(partial));
check('the saved menus are what they were (options.menus never writes)', menus.getMenu('main').length === 12 && menus.getMenu('footer').length === 1);

// ── the theme css contract ────────────────────────────────────────────
const css = fs.readFileSync(path.join(__dirname, '..', 'themes', 'default', 'css', 'main.css'), 'utf8');
const menuBlock = css.slice(css.indexOf('Menu capacity, sub-menus, drawer'), css.indexOf('CMS-managed header chrome (S3)'));
// the text of one `@media (…) {` block: from its header to the first line that is just `}`
const blockOf = (header) => { const i = css.indexOf(header); return i < 0 ? '' : css.slice(i, css.indexOf('\n}', i)); };
check('the header may be wider than the content column (--header-max-width), the row wraps and labels never break',
  /\.header-inner \{\s*max-width: max\(var\(--max-width\), var\(--header-max-width, 1140px\)\);\s*flex-wrap: wrap/.test(css) &&
  /\.main-nav ul \{\s*flex-wrap: wrap;/.test(css) && /\.main-nav a \{ white-space: nowrap;/.test(css));
check('sub-menus are real dropdowns: positioned with logical properties, opened on hover AND :focus-within',
  /\.main-nav \.sub-menu \{[^}]*position: absolute;[^}]*inset-inline-start: 0;[^}]*display: none;/.test(css) &&
  /\.main-nav li:hover > \.sub-menu,\s*\.main-nav li:focus-within > \.sub-menu \{ display: block; \}/.test(css));
check('the last items open toward the inline end so a dropdown never leaves the page', /li:nth-last-child\(-n\+2\) > \.sub-menu \{ inset-inline-start: auto; inset-inline-end: 0; \}/.test(css));
check('the drawer: the burger shows on narrow screens and for body.menu-drawer; the checked toggle reveals the list; sub-menus lie inline',
  /@media \(max-width: 720px\) \{[\s\S]*?\.nav-burger \{ display: flex; \}[\s\S]*?\.nav-toggle:checked ~ ul \{ display: flex; \}/.test(css) &&
  /body\.menu-drawer \.nav-toggle:checked ~ ul \{ display: flex; \}/.test(css) && /body\.menu-drawer \.main-nav \.sub-menu \{ position: static; display: block;/.test(css));
// the tab-stop: the checkbox is visually hidden (keyboard-reachable) wherever the burger shows; it is display:none
// ONLY inside min-width blocks (above each breakpoint, where the burger is gone) — and for `never`, which has no
// burger at any width, so both go together in one rule
const noMinWidth = css.replace(/@media \(min-width: \d+px\) \{[\s\S]*?\n\}/g, '');
check('the drawer toggle is keyboard-reachable: the bare .nav-toggle rule is byte-identical and display:none lives only inside min-width blocks',
  /\n\.nav-toggle \{ position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; \}\r?\n/.test(css) && /\.nav-toggle:focus-visible \+ \.nav-burger \{ outline/.test(css) &&
  !/\.nav-toggle \{[^}]*display: none/.test(noMinWidth) &&
  /@media \(min-width: 721px\) \{\s*body:not\(\.menu-drawer\):not\(\.nav-collapse-lg\) \.nav-toggle \{ display: none; \}\s*\}/.test(css) &&
  /@media \(min-width: 561px\) \{\s*body\.nav-collapse-sm:not\(\.menu-drawer\) \.nav-toggle \{ display: none; \}\s*\}/.test(css) &&
  /@media \(min-width: 1025px\) \{\s*body\.nav-collapse-lg:not\(\.menu-drawer\) \.nav-toggle \{ display: none; \}\s*\}/.test(css));
check('in the side rail a sub-menu is an indented list, always open, and the burger is hidden — ONLY where the rail exists (≥901px), so the phone drawer still wins in side mode',
  /@media \(min-width: 901px\) \{[\s\S]*?body\.menu-side \.main-nav \.sub-menu \{ position: static; display: block;[\s\S]*?body\.menu-side \.nav-burger \{ display: none; \}[\s\S]*?\}/.test(css) &&
  !/\n\s*body\.menu-side \.nav-burger \{ display: none; \}/.test(css.replace(/@media \(min-width: 901px\) \{[\s\S]*?\n\}/g, '')));
check('no physical left/right in the new menu css (RTL first) — nor in the rail block', !/(^|[^-])(left|right)\s*:/.test(menuBlock) && !/(^|[^-])(left|right)\s*:/.test(blockOf('@media (min-width: 901px) {')));
check('the old ≤640px header stacking is gone (the drawer owns narrow screens)', !/\.header-inner \{ flex-direction: column; gap: 0\.6rem; \}/.test(css));

// the collapse knob: three literal drawer blocks, each scoped to its body class
const md = blockOf('@media (max-width: 720px) {'), sm = blockOf('@media (max-width: 560px) {'), lg = blockOf('@media (max-width: 1024px) {');
const MD = 'body:not(.nav-collapse-sm):not(.nav-collapse-lg):not(.nav-collapse-never)';
const lines = (b) => b.split('\n').slice(1).filter((l) => l.trim());
check('the 720px drawer applies only when the body carries none of nav-collapse-sm/lg/never — every selector in the block is scoped',
  lines(md).length >= 7 && lines(md).every((l) => l.startsWith('  ' + MD + ' ')) && md.indexOf(MD + ' .nav-burger { display: flex; }') > 0);
check('560px (body.nav-collapse-sm) and 1024px (body.nav-collapse-lg) are literal copies of the 720px block with their own scope',
  lines(sm).length === lines(md).length && lines(lg).length === lines(md).length &&
  md.split(MD).join('body.nav-collapse-sm:not(.menu-drawer)').replace('720px', '560px') === sm &&
  md.split(MD).join('body.nav-collapse-lg:not(.menu-drawer)').replace('720px', '1024px') === lg);
check('body.nav-collapse-never never shows the burger (toggle and burger hidden together) unless body.menu-drawer',
  /body\.nav-collapse-never:not\(\.menu-drawer\) \.nav-toggle,\s*body\.nav-collapse-never:not\(\.menu-drawer\) \.nav-burger \{ display: none; \}/.test(css) &&
  !/body\.nav-collapse-never[^{,]*\.nav-burger \{ display: flex/.test(css));
check('the body.menu-drawer block is untouched (the burger at every width) and dresses a fold summary like a drawer link',
  /\nbody\.menu-drawer \.main-nav \{ display: flex; flex-wrap: wrap; align-items: center; \}\r?\nbody\.menu-drawer \.nav-burger \{ display: flex; \}\r?\nbody\.menu-drawer \.main-nav ul \{ display: none; flex-basis: 100%; flex-direction: column;/.test(css) &&
  /body\.menu-drawer \.main-nav \.nav-more-sum \{ display: block;/.test(css));

// the fold
check('the fold summary is dressed as a menu link: no marker, --menu-size, nowrap, a ▾ before; details[open] shows its list as the dropdown',
  /\.main-nav \.nav-more-sum \{[^}]*list-style: none;[^}]*font-size: var\(--menu-size, 0\.95rem\);[^}]*white-space: nowrap;/.test(menuBlock) &&
  /\.main-nav \.nav-more-sum::-webkit-details-marker \{ display: none; \}/.test(menuBlock) && /\.main-nav \.nav-more-sum::before \{ content: '▾';[^}]*margin-inline-end/.test(menuBlock) &&
  /\.main-nav li\.nav-more > details\[open\] > \.sub-menu \{ display: block; \}/.test(menuBlock) && /\.main-nav li\.nav-more > details\[open\]/.test(menuBlock));
// the caret side: a parent item draws its ▾ with ::before (the inline start); the fold's summary must sit on the
// SAME side, or in RTL the fold's caret flips to the other end of its label
check('the fold\'s caret is on the parent\'s side (both ::before, inline-start) — no ▾ comes from ::after anywhere',
  /\.main-nav li\.has-children > a::before \{ content: '▾';/.test(menuBlock) &&
  /\.main-nav \.nav-more-sum::before \{ content: '▾'; font-size: 0\.7em; margin-inline-end: 0\.3em; opacity: 0\.7; \}/.test(menuBlock) &&
  !/::after \{ content: '▾'/.test(css));
check('a folded parent flies out sideways (.sub-menu .sub-menu at inset-inline-start: 100%), inside the fold back over the bar',
  /\.main-nav \.sub-menu \.sub-menu \{ inset-inline-start: 100%; inset-inline-end: auto; top: 0; \}/.test(menuBlock) &&
  /\.main-nav li\.nav-more \.sub-menu \.sub-menu \{ inset-inline-start: auto; inset-inline-end: 100%; \}/.test(menuBlock));
check('in the drawer and the rail a fold\'s list is static under details[open] — the static .sub-menu rules are descendant selectors that reach it',
  /body\.menu-drawer \.main-nav \.sub-menu \{ position: static; display: block;/.test(css) && md.indexOf(MD + ' .main-nav .sub-menu { position: static; display: block;') > 0 &&
  /body\.menu-side \.main-nav \.sub-menu \{ position: static; display: block;/.test(blockOf('@media (min-width: 901px) {')) &&
  /body\.menu-side \.main-nav \.nav-more-sum \{ display: block;/.test(blockOf('@media (min-width: 901px) {')));

// the current page
check('nav-current-pill / -bold / -none restyle a[aria-current="page"]: a tinted pill, weight 700 in the primary colour, no underline',
  /body\.nav-current-pill \.main-nav a\[aria-current="page"\] \{[^}]*border-radius: 999px;[^}]*padding-inline: 0\.7em; \}/.test(menuBlock) && /body\.nav-current-pill \.main-nav a\[aria-current="page"\]::after \{ display: none; \}/.test(menuBlock) &&
  /body\.nav-current-bold \.main-nav a\[aria-current="page"\] \{ font-weight: 700; color: var\(--color-primary\); \}/.test(menuBlock) &&
  /body\.nav-current-none \.main-nav a\[aria-current="page"\]::after \{ width: 0; \}/.test(menuBlock));
check('the parent of the current page echoes the mark (underline by default, primary colour for pill/bold)',
  /li\.has-current > a::after \{ width: 100%; \}/.test(menuBlock) && /body\.nav-current-bold \.main-nav li\.has-current > a \{ color: var\(--color-primary\); \}/.test(menuBlock));
check('the rail highlights the current page with a tint (no underline)',
  /body\.menu-side \.main-nav a\[aria-current="page"\] \{ background: var\(--color-light-bg\); color: var\(--color-primary\); \}/.test(blockOf('@media (min-width: 901px) {')));
check('the rail cancels the parent-echo underline too (li.has-current > a::after) and echoes the mark as colour',
  /body\.menu-side \.main-nav li\.has-current > a::after \{ display: none; \}/.test(blockOf('@media (min-width: 901px) {')) &&
  /body\.menu-side \.main-nav li\.has-current > a \{ color: var\(--color-primary\); \}/.test(blockOf('@media (min-width: 901px) {')));

// the scroll strip
check('the strip fades symmetrically at both edges (direction-neutral mask) and its sub-menus stay hidden (a dropdown inside overflow is clipped)',
  /\.menu-scroll \.main-nav ul \{[^}]*mask-image: linear-gradient\(to right, transparent, #000 1\.5rem, #000 calc\(100% - 1\.5rem\), transparent\);/.test(menuBlock) &&
  /\.menu-scroll \.main-nav > ul > li:where\(:hover, :focus-within\) > :where\(\.sub-menu\) \{ display: none; \}/.test(menuBlock) &&
  md.indexOf('mask-image: none;') > 0);
// the strip must not leak into side mode (menu-side + menu-scroll is a legal knob pair): the hide rule stays BELOW
// the rail's always-open list — (0,2,2) via a second :where() vs the rail's (0,3,1); a bare `> .sub-menu` was
// (0,3,2) and hid the rail's children on hover — and both side blocks reset the strip's overflow and edge fade.
// (the first `@media (max-width: 900px) {` in the file is not the side fallback, so it is found from its own body)
const sideFallback = (() => { const i = css.indexOf('body.menu-side { display: block; }'); return i < 0 ? '' : css.slice(css.lastIndexOf('@media (max-width: 900px) {', i), css.indexOf('\n}', i)); })();
check('the strip\'s hide rule wraps its target in :where() too — (0,2,2), below the rail\'s static list — and no bare `> .sub-menu` form of it survives',
  /\.menu-scroll \.main-nav > ul > li:where\(:hover, :focus-within\) > :where\(\.sub-menu\) \{ display: none; \}/.test(menuBlock) &&
  !/li:where\(:hover, :focus-within\) > \.sub-menu/.test(css));
check('both side blocks (the ≥901px rail and the ≤900px fallback) reset the strip: overflow-x visible, wrap, no mask',
  /body\.menu-side \.main-nav ul \{ overflow-x: visible; flex-wrap: wrap; -webkit-mask-image: none; mask-image: none; \}/.test(blockOf('@media (min-width: 901px) {')) &&
  /body\.menu-side \.main-nav ul \{[^}]*flex-wrap: wrap;[^}]*overflow-x: visible;[^}]*-webkit-mask-image: none;[^}]*mask-image: none;/.test(sideFallback));

// hygiene
check('a hover bridge on top-level dropdowns fills exactly the skin\'s --menu-drop-gap (zero by default: it never covers the parent link)',
  /\.main-nav > ul > li > \.sub-menu::before \{ content: ''; position: absolute; inset-inline: 0; top: calc\(-1 \* var\(--menu-drop-gap, 0px\)\); height: var\(--menu-drop-gap, 0px\); \}/.test(menuBlock) &&
  /\.main-nav \.sub-menu \{[^}]*top: calc\(100% \+ var\(--menu-drop-gap, 0px\)\);/.test(menuBlock));
check('.footer-nav li lifts the prose cap; .main-nav li has it once (not duplicated)',
  /\.footer-nav li \{ max-width: none; \}/.test(css) && (css.match(/\.main-nav li \{[^}]*max-width: none/g) || []).length === 1);
check('the footer band shares the header cap', /\.footer-inner \{[^}]*max-width: max\(var\(--max-width\), var\(--header-max-width, 1140px\)\);/.test(css));

// ── the knobs reach the css as custom properties ──────────────────────
const vars = theme.overridesToCss({ layout: { headerWidth: 'full' }, chrome: { menuGap: 'lg', menuSize: 'sm', menuAlign: 'between' } });
check('layout.headerWidth + chrome.menuGap/menuSize/menuAlign emit --header-max-width / --menu-gap / --menu-size / --menu-align',
  /--header-max-width: 100%;/.test(vars) && /--menu-gap: 2\.5rem;/.test(vars) && /--menu-size: 0\.85rem;/.test(vars) && /--menu-align: space-between;/.test(vars));
check('the defaults emit the wide header and the regular menu (an untouched site gets the fix)',
  /--header-max-width: 1140px;/.test(theme.overridesToCss({})) && /--menu-gap: 1\.75rem;/.test(theme.overridesToCss({})));
const dialect = require('../src/bentml/theme-dialect');
const bent = dialect.serializeTheme({ name: 'x', overrides: { layout: { headerWidth: 'full', menuPlacement: 'side' }, chrome: { menuOverflow: 'drawer', menuAlign: 'center', menuGap: 'sm', menuSize: 'lg' } } });
const back = dialect.parseTheme(bent);
check('the .bent dialect carries header-width and menu-overflow/align/gap/size both ways',
  /header-width="full"/.test(bent) && /menu-overflow="drawer"/.test(bent) && back.overrides.layout.headerWidth === 'full' && back.overrides.chrome.menuOverflow === 'drawer' && back.overrides.chrome.menuSize === 'lg');
check('the studio form and the designer prompt know the knobs',
  /id="th-ch-overflow"/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'theme.js'), 'utf8')) &&
  /menuOverflow: val\('th-ch-overflow'/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-theme.js'), 'utf8')) &&
  /menu-overflow="wrap\|scroll\|drawer"/.test(require('../src/theme-roleplay').buildThemePrompt({}).text));

console.log(fail ? '\nSMOKE MENU-RENDER: FAIL' : '\nSMOKE MENU-RENDER: PASS');
process.exit(fail ? 1 : 0);
