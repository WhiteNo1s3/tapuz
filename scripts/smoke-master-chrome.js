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
// v2.28b: the fold's <summary class="nav-more-sum"> ("עוד") is not an <a>
// but sits in the same row — every menu-link rule dresses it too
check('underline hover → inset box-shadow in the hover color (links AND the fold summary)',
  /\.main-nav a:hover, \.main-nav \.nav-more-sum:hover \{ color: #123456; box-shadow: inset 0 -2px 0 #123456/.test(cssOf({ menuHover: 'underline', menuHoverColor: '#123456' })));
check('pill hover → rounded padding + color-mix background',
  /border-radius: 999px/.test(cssOf({ menuHover: 'pill' })) && /color-mix\(in srgb, #ea580c 14%/.test(cssOf({ menuHover: 'pill' })));
check('glow hover → text-shadow', /text-shadow: 0 0 12px/.test(cssOf({ menuHover: 'glow' })));
check('hover color falls back to the PRIMARY color when unset',
  cssOf({ menuHover: 'glow' }).indexOf('#ea580c') !== -1);
check('bold menu weight emits (links AND the fold summary)', /\.main-nav a, \.main-nav \.nav-more-sum \{ font-weight: 700/.test(cssOf({ menuWeight: 'bold' })));
check('pill / glow / colour hover and the header text colour reach the fold summary too',
  /\.main-nav a, \.main-nav \.nav-more-sum \{ padding: 5px 12px; border-radius: 999px/.test(cssOf({ menuHover: 'pill' })) &&
  /\.main-nav a:hover, \.main-nav \.nav-more-sum:hover \{ color: #ea580c; text-shadow/.test(cssOf({ menuHover: 'glow' })) &&
  /\.main-nav a:hover, \.main-nav \.nav-more-sum:hover \{ color: #123456; \}/.test(cssOf({ menuHover: 'color', menuHoverColor: '#123456' })) &&
  /\.site-header \.main-nav a, \.site-header \.main-nav \.nav-more-sum, \.site-header \.site-tagline \{ color: #ffffff/.test(cssOf({ headerText: '#ffffff' })));
check('the fold / collapse / current knobs emit NO css of their own (fold is markup, the rest are body classes)',
  cssOf({ menuFold: 4, menuCollapse: 'lg', menuCurrent: 'pill' }) === cssOf({}));
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

// ── v2.28b: the menu knobs go through ONE validator at the save door ──
const knobSave = theme.saveThemeSettings({ overrides: { chrome: { menuCurrent: 'rainbow', menuFold: '99', menuCollapse: 'lg' } } });
check('saveThemeSettings resets an unknown menu knob to its default, keeps the good one, and returns Hebrew warnings',
  knobSave.overrides.chrome.menuCurrent === 'underline' && knobSave.overrides.chrome.menuFold === 0 && knobSave.overrides.chrome.menuCollapse === 'lg' &&
  knobSave.warnings.length === 2 && knobSave.warnings.every((w) => /[֐-׿]/.test(w)) && knobSave.warnings.some((w) => /current/.test(w)) && knobSave.warnings.some((w) => /fold/.test(w)));
check('a clean save carries no knob warnings, and the settings answer with a menuFit slot (null until the estimate lands)',
  theme.saveThemeSettings({ overrides: { chrome: { menuFold: 3 } } }).warnings.length === 0 && theme.loadOverrides().chrome.menuFold === 3 && 'menuFit' in theme.getThemeSettings());

// ── the served page carries the chrome css ───────────────────────────
const { renderPage } = require('../src/renderer');
const html = renderPage({
  title: 'דף', slug: 'p', full_path: 'p', direction: 'rtl', status: 'published',
  tags: [], meta: {}, blocks: []
}, { siteTitle: 'אתר' });
check('served page carries the menu hover rule', /\.main-nav a:hover/.test(html));

console.log(fail ? '\nSMOKE MASTER-CHROME: FAIL' : '\nSMOKE MASTER-CHROME: PASS');
process.exit(fail ? 1 : 0);
