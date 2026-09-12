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
 *     '/' as well as its own file)
 *   • the layout carries a zero-JS drawer toggle (checkbox + label), shown by
 *     the theme on narrow screens or at every width when the theme says so
 *   • the header may be wider than the content column; labels never break;
 *     the row wraps by content
 *   • a nested footer menu keeps its children (flattened), never drops them
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
const { renderPage } = require('../src/renderer');

// twelve top-level items, two of them parents — the shape that broke the bar
const items = [];
for (let i = 1; i <= 12; i++) items.push({ label: 'פריט ' + i, type: 'page', target: 'page-' + i });
items[2].children = [{ label: 'תת־פריט א', type: 'page', target: 'sub-a' }, { label: 'תת־פריט ב', type: 'custom', url: 'https://example.com' }];
items[7].children = [{ label: 'עוד אחד', type: 'anchor', target: 'top' }];
menus.saveMenus({ main: items, footer: [{ label: 'תקנון', type: 'page', target: 'terms', children: [{ label: 'פרטיות', type: 'page', target: 'privacy' }] }] });

const page = (fullPath) => ({ title: 'דף', slug: fullPath, full_path: fullPath, direction: 'rtl', status: 'published', tags: [], meta: {}, blocks: [] });

// ── the rendered markup ───────────────────────────────────────────────
const html = renderPage(page('page-3'), { siteTitle: 'אתר' });
const navOf = (h) => h.slice(h.indexOf('<nav class="main-nav"'), h.indexOf('</nav>'));
check('a parent item carries has-children and its children render inside ul.sub-menu',
  /<li class="has-children"><a href="\/page-3\.html"[^>]*>פריט 3<\/a><ul class="sub-menu">/.test(html) && /תת־פריט ב/.test(html));
check('the item that IS this page carries aria-current="page" — and no other item does',
  /<a href="\/page-3\.html" aria-current="page">/.test(navOf(html)) && (navOf(html).match(/aria-current="page"/g) || []).length === 1);
menus.saveMenus({ main: [{ label: 'הבית', type: 'custom', url: '/' }].concat(items) });
const homeNav = navOf(renderPage(page('home'), { siteTitle: 'אתר', isHome: true }));
check('the crowned home marks a "/" item as current too', /<a href="\/" aria-current="page">הבית<\/a>/.test(homeNav) && (homeNav.match(/aria-current="page"/g) || []).length === 1);
check('a page that is not in the menu marks nothing', !/aria-current/.test(navOf(renderPage(page('orphan'), { siteTitle: 'אתר' }))));
check('the layout carries the zero-JS drawer toggle: a checkbox and its label, before the list',
  /<input type="checkbox" id="nav-toggle" class="nav-toggle">\s*<label for="nav-toggle" class="nav-burger" aria-label="תפריט">/.test(html) && html.indexOf('class="nav-burger"') < html.indexOf('<ul>'));
check('the twelve items are all there, in order', (html.match(/<li[^>]*><a href="\/page-\d+\.html"/g) || []).length === 12 && html.indexOf('פריט 1<') < html.indexOf('פריט 12<'));
check('a nested footer menu keeps its children (flattened after the parent)',
  /<nav class="footer-nav" aria-label="[^"]*">\s*<a href="\/terms\.html">תקנון<\/a> &nbsp;\|&nbsp; <a href="\/privacy\.html">פרטיות<\/a>/.test(html));

// ── the theme answers a long menu with a body class ───────────────────
theme.saveOverrides({ chrome: { menuOverflow: 'drawer' } });
check('chrome.menuOverflow: drawer stamps body.menu-drawer (the burger at every width)', /<body[^>]*class="[^"]*menu-drawer/.test(renderPage(page('page-1'), {})));
theme.saveOverrides({ chrome: { menuOverflow: 'scroll' } });
check('chrome.menuOverflow: scroll stamps body.menu-scroll (one strip)', /<body[^>]*class="[^"]*menu-scroll/.test(renderPage(page('page-1'), {})));
theme.saveOverrides({ chrome: { menuOverflow: 'wrap' }, layout: { menuPlacement: 'side' } });
const side = renderPage(page('page-1'), {});
check('the side rail still stamps body.menu-side, and wrap stamps nothing extra', /<body[^>]*class="menu-side"/.test(side));
theme.saveOverrides({ layout: { menuPlacement: 'top' } });

// ── the theme css contract ────────────────────────────────────────────
const css = fs.readFileSync(path.join(__dirname, '..', 'themes', 'default', 'css', 'main.css'), 'utf8');
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
check('the drawer toggle is keyboard-reachable (visually hidden checkbox, focus ring on the label), never display:none',
  /\.nav-toggle \{ position: absolute; width: 1px; height: 1px; opacity: 0;/.test(css) && /\.nav-toggle:focus-visible \+ \.nav-burger \{ outline/.test(css) && !/\.nav-toggle \{[^}]*display: none/.test(css));
check('in the side rail a sub-menu is an indented list, always open, and the burger is hidden — ONLY where the rail exists (≥901px), so the phone drawer still wins in side mode',
  /@media \(min-width: 901px\) \{[\s\S]*?body\.menu-side \.main-nav \.sub-menu \{ position: static; display: block;[\s\S]*?body\.menu-side \.nav-burger \{ display: none; \}[\s\S]*?\}/.test(css) &&
  !/\n\s*body\.menu-side \.nav-burger \{ display: none; \}/.test(css.replace(/@media \(min-width: 901px\) \{[\s\S]*?\n\}/g, '')));
check('no physical left/right in the new menu css (RTL first)', !/(^|[^-])(left|right)\s*:/.test(css.slice(css.indexOf('Menu capacity, sub-menus, drawer'), css.indexOf('CMS-managed header chrome (S3)'))));
check('the old ≤640px header stacking is gone (the drawer owns narrow screens)', !/\.header-inner \{ flex-direction: column; gap: 0\.6rem; \}/.test(css));

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
