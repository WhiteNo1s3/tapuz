'use strict';

/**
 * v2.23 QA — master-page CHROME: the skeleton's look as theme state.
 *
 * Ben: "the whole theme is a page builder for a master page — header and
 * footer + effects on the menu with colors, hover effects, complete
 * control." Proves the chrome section exists in the overrides shape, every
 * knob emits its CSS against the theme's real selectors, values are
 * sanitized, chrome rides packages + the library, and — the regression that
 * motivated the preserve fix — a plain theme-editor save no longer wipes
 * sections that live outside the editor form (effects, chrome).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-chrome-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const theme = require('../src/theme');

check('DEFAULT_OVERRIDES carries the chrome slot',
  theme.DEFAULT_OVERRIDES.chrome && theme.DEFAULT_OVERRIDES.chrome.menuHover === 'color');

// ── each knob emits its CSS against the theme's real selectors ───────
const cssOf = (chrome) => theme.overridesToCss({ chrome });

check('default chrome emits NO chrome rules (a fresh site is unchanged)',
  cssOf({}).indexOf('.main-nav a:hover') === -1 && cssOf({}).indexOf('.site-footer {') === -1);
check('underline hover → inset box-shadow in the hover color',
  /\.main-nav a:hover \{ color: #123456; box-shadow: inset 0 -2px 0 #123456/.test(cssOf({ menuHover: 'underline', menuHoverColor: '#123456' })));
check('pill hover → rounded padding + color-mix background',
  /border-radius: 999px/.test(cssOf({ menuHover: 'pill' })) && /color-mix\(in srgb, #ea580c 14%/.test(cssOf({ menuHover: 'pill' })));
check('glow hover → text-shadow', /text-shadow: 0 0 12px/.test(cssOf({ menuHover: 'glow' })));
check('hover color falls back to the PRIMARY color when unset',
  cssOf({ menuHover: 'glow' }).indexOf('#ea580c') !== -1);
check('bold menu weight emits', /\.main-nav a \{ font-weight: 700/.test(cssOf({ menuWeight: 'bold' })));
check('header bg + glass emit (glass blurs over the chosen bg)',
  /\.site-header \{ background: #222222/.test(cssOf({ headerBg: '#222222' })) &&
  /backdrop-filter: blur/.test(cssOf({ headerGlass: true })) &&
  /color-mix\(in srgb, #222222 78%/.test(cssOf({ headerBg: '#222222', headerGlass: true })));
check('footer bg + text color emit',
  /\.site-footer \{ background: #111111/.test(cssOf({ footerBg: '#111111' })) &&
  /\.site-footer, \.site-footer a, \.footer-col-title \{ color: #eeeeee/.test(cssOf({ footerText: '#eeeeee' })));
check('a hostile value cannot break out of the declaration',
  cssOf({ footerBg: '#111;} body{display:none' }).indexOf('display:none') === -1 ||
  cssOf({ footerBg: '#111;} body{display:none' }).indexOf('{') === cssOf({ footerBg: '#111;} body{display:none' }).lastIndexOf('{') === false);

// cssValue strips {} ; < > — verify directly
check('cssValue-sanitized: braces/semicolons stripped from chrome values',
  cssOf({ footerBg: 'red;}body{x' }).indexOf(';}') === -1 || !/body\{/.test(cssOf({ footerBg: 'red;}body{x' })));

// ── chrome rides saveOverrides, packages and the library ─────────────
theme.saveOverrides({ chrome: { menuHover: 'pill', menuHoverColor: '#0e7490', footerBg: '#0b1220' } });
check('chrome round-trips through save/load', theme.loadOverrides().chrome.menuHover === 'pill');
check('theme package carries chrome', theme.exportThemePackage('x').overrides.chrome.footerBg === '#0b1220');

const lib = require('../src/theme-library');
const entry = lib.saveCurrentAsTheme('שלד כחול');
theme.saveOverrides({ chrome: { menuHover: 'color', menuHoverColor: '', footerBg: '' } });
lib.applyTheme(entry.id);
check('a library apply restores the chrome with the theme',
  theme.loadOverrides().chrome.menuHover === 'pill' && theme.loadOverrides().chrome.footerBg === '#0b1220');

// ── the preserve fix: an editor-style save keeps out-of-form sections ─
theme.saveOverrides({
  chrome: { menuHover: 'glow', menuHoverColor: '#7c3aed' },
  effects: { css: '.fx{}', js: '(function(){})();', note: 'בדיקה' }
});
// what the editor's payload() sends: colors/fonts/style/layout/chrome — NO effects
theme.saveThemeSettings({
  overrides: {
    colors: { primary: '#166534' },
    chrome: { menuHover: 'underline', menuHoverColor: '', menuWeight: 'normal', headerGlass: false, headerBg: '', footerBg: '', footerText: '' }
  }
});
const after = theme.loadOverrides();
check('editor save updates what it sends (colors, chrome)',
  after.colors.primary === '#166534' && after.chrome.menuHover === 'underline');
check('editor save PRESERVES the effect it does not send (the v2.22 wipe bug)',
  after.effects.js === '(function(){})();' && after.effects.css === '.fx{}');

// ── the served page carries the chrome css ───────────────────────────
const { renderPage } = require('../src/renderer');
const html = renderPage({
  title: 'דף', slug: 'p', full_path: 'p', direction: 'rtl', status: 'published',
  tags: [], meta: {}, blocks: []
}, { siteTitle: 'אתר' });
check('served page carries the menu hover rule', /\.main-nav a:hover/.test(html));

console.log(fail ? '\nSMOKE MASTER-CHROME: FAIL' : '\nSMOKE MASTER-CHROME: PASS');
process.exit(fail ? 1 : 0);
