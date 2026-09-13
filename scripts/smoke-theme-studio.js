'use strict';

/**
 * v2.24 QA — the theme STUDIO.
 *
 * Ben: "there ain't no theme builder, only basic themes. I want to create a
 * theme by user imagination with roleplay … in the canvas we have no game …
 * the theme import does not work … the effect said it's good and in effect
 * it didn't work … we offer only 1 theme with few boring colors? we want to
 * iterate." Pins, in order:
 *   1. the model is richer than colors — web fonts, page background, button
 *      style, header text, a free-form skin — and every look is a whole
 *      theme, not a palette
 *   2. the theme-designer roleplay: the prompt teaches the language and the
 *      skeleton, demands a FRESH chat, embeds the brief / the current theme
 *   3. "take only the theme": the paste-back reads json+css+js fences out of
 *      chat prose, a full package inside a fence, a bare theme JSON, or
 *      bare <style>/<script> — and the import doors accept the same
 *   4. the effect is COMPILED before it is accepted (a syntax error is an
 *      error, not "נקלט ✓"), and it runs guarded on the page
 *   5. the canvas: a candidate theme renders the real pages without touching
 *      the live site, carries the preview shim, and browses by ?path=
 *   6. an AI theme lands in the library (source 'ai'); apply is a second,
 *      explicit move that rebuilds the site
 *   7. the BENCH (v2.25): the canvas is not a page — it starts empty, fills
 *      with modules pasted as BenTML (from anywhere), picked from the
 *      palette, or the whole showcase; it renders inside the candidate
 *      theme's chrome, lives beside the theme, and the designer prompt
 *      lists what is on it
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-theme-studio-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const theme = require('../src/theme');

// ── 1. the model ─────────────────────────────────────────────────────
const D = theme.DEFAULT_OVERRIDES;
check('the model carries web fonts, a page background, a button style, header text and a skin',
  Array.isArray(D.fonts.google) && D.background && D.background.kind === 'solid' && D.style.buttons === 'filled' &&
  'headerText' in D.chrome && D.skin && 'css' in D.skin);
const plain = theme.overridesToCss({});
check('the defaults emit NO background/button/skin rules (an untouched site is byte-for-byte unchanged)',
  !/body \{ background: (linear|radial|repeating)/.test(plain) && !/theme skin/.test(plain) && !/\.btn-primary, \.bent-form-submit/.test(plain));
check('background: gradient paints the page from bg → lightBg at the angle',
  /body \{ background: linear-gradient\(135deg, #fffbf7, #fdf1e6\)/.test(theme.overridesToCss({ background: { kind: 'gradient', angle: 135 } })));
check('background: dots/grid/lines/glow each emit a pattern drawn from the palette',
  ['dots', 'grid', 'lines', 'glow'].every((k) => /body \{ background: (radial|linear|repeating)/.test(theme.overridesToCss({ background: { kind: k } }))));
check('background: an unknown kind emits nothing', !/body \{ background: (linear|radial|repeating)/.test(theme.overridesToCss({ background: { kind: 'weird' } })));
check('buttons: outline/soft/glow restyle every button surface together',
  /\.btn-primary, \.bent-form-submit, \.bent-plan-cta, \.bent-flipbox-button \{ background: transparent; color: #ea580c; border: 2px solid #ea580c/.test(theme.overridesToCss({ style: { buttons: 'outline' } })) &&
  /color-mix\(in srgb, #ea580c 14%, transparent\); color: #ea580c/.test(theme.overridesToCss({ style: { buttons: 'soft' } })) &&
  /box-shadow: 0 8px 24px color-mix/.test(theme.overridesToCss({ style: { buttons: 'glow' } })));
check('chrome.headerText colors the header, logo, menu links and the fold summary (v2.28b)',
  /\.site-header, \.site-header \.site-logo, \.site-header \.main-nav a, \.site-header \.main-nav \.nav-more-sum, \.site-header \.site-tagline \{ color: #ffffff; \}/.test(theme.overridesToCss({ chrome: { headerText: '#ffffff' } })));
const skinned = theme.overridesToCss({ skin: { css: '.hero h1 { font-size: 3rem; }' }, effects: { css: '.fx { top: 0 }' } });
check('skin css is emitted after the knobs and BEFORE the effect css',
  skinned.indexOf('theme skin') !== -1 && skinned.indexOf('.hero h1 { font-size: 3rem; }') < skinned.indexOf('.fx { top: 0 }'));
check('a </style> inside skin/effect css cannot end the inline tag',
  theme.overridesToCss({ skin: { css: 'a{}</style><script>x</script>' } }).indexOf('</style>') === -1);

// web fonts
check('google font families are cleaned, deduped and capped at four',
  JSON.stringify(theme.googleFontFamilies({ fonts: { google: ['"Heebo"', 'heebo', 'Suez One', 'Rubik', 'Alef', 'Arimo', '<bad>'] } })) === JSON.stringify(['Heebo', 'Suez One', 'Rubik', 'Alef']));
check('the css2 href carries only the weights a family really has (Varela Round = regular only)',
  theme.googleFontsHref({ fonts: { google: ['Heebo', 'Varela Round'] } }) === 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;800&family=Varela+Round&display=swap');
check('no families → no href, no links', theme.googleFontsHref({}) === '' && theme.renderThemeFontLinks({}) === '');
check('font links preconnect + link the stylesheet',
  /rel="preconnect" href="https:\/\/fonts\.googleapis\.com"/.test(theme.renderThemeFontLinks({ fonts: { google: ['Heebo'] } })) &&
  /id="tapuz-theme-fonts" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Heebo/.test(theme.renderThemeFontLinks({ fonts: { google: ['Heebo'] } })));

// looks — whole themes, not palettes
const looks = theme.LOOKS;
check('the shelf holds 15+ looks', Object.keys(looks).length >= 15);
const rich = Object.values(looks).filter((l) => (l.overrides.fonts || {}).google && l.overrides.fonts.google.length);
check('5+ looks load a web font', rich.length >= 5);
check('5+ looks paint a page background', Object.values(looks).filter((l) => (l.overrides.background || {}).kind && l.overrides.background.kind !== 'solid').length >= 5);
check('3+ looks carry a skin', Object.values(looks).filter((l) => (l.overrides.skin || {}).css).length >= 3);
check('every web-font look names the font in its family stack (otherwise the load is pointless)',
  rich.every((l) => l.overrides.fonts.google.every((f) => ((l.overrides.fonts.family || '') + (l.overrides.fonts.headingFamily || '')).indexOf(f) !== -1)));
check('every web-font look uses only shelf families', rich.every((l) => l.overrides.fonts.google.every((f) => f in theme.GOOGLE_FONTS)));
check('a dark header look sets a light header text (studio)', looks.studio.overrides.chrome.headerBg === '#111111' && looks.studio.overrides.chrome.headerText === '#ffffff');

// rows render their settings as classes the theme answers (v2.26)
const { renderPage: renderRow } = require('../src/renderer');
const rowHtml = renderRow({ title: 't', slug: 't', full_path: 't', direction: 'rtl', status: 'published', tags: [], meta: {}, blocks: [{ id: 'r', type: 'columns', data: { columns: [{ blocks: [] }, { blocks: [] }, { blocks: [] }, { blocks: [] }, { blocks: [] }], ratio: '2:1:1:1:1', gap: 'lg', valign: 'stretch', collapse: 'never', width: 'wide' } }] }, { overrides: theme.DEFAULT_OVERRIDES });
check('a row renders cols-n-5 + cols-ratio + gap/valign/collapse/width classes and the --cols fractions',
  /class="columns cols-n-5 cols-ratio gap-lg collapse-never valign-stretch cols-wide"/.test(rowHtml) && /--cols:2fr 1fr 1fr 1fr 1fr/.test(rowHtml));
check('a default row emits only columns + cols-n-N (an untouched site is unchanged)', /class="columns cols-n-2"/.test(renderRow({ title: 't', slug: 't', full_path: 't', direction: 'rtl', status: 'published', tags: [], meta: {}, blocks: [{ id: 'r', type: 'columns', data: { columns: [{ blocks: [] }, { blocks: [] }] } }] }, { overrides: theme.DEFAULT_OVERRIDES })));
const mainCssSrc = fs.readFileSync(path.join(__dirname, '..', 'themes', 'default', 'css', 'main.css'), 'utf8');
check('the theme stylesheet answers every row class: gap, valign, wide/full breakout, tablet wrap for 5–6 cells, collapse points',
  /\.columns\.gap-lg/.test(mainCssSrc) && /\.columns\.valign-stretch/.test(mainCssSrc) && /\.columns\.cols-wide/.test(mainCssSrc) && /\.columns\.cols-full/.test(mainCssSrc) &&
  /\.columns\.cols-n-5:not\(\.cols-ratio\) > \.col/.test(mainCssSrc) && /\.columns\.collapse-lg \{ flex-direction: column/.test(mainCssSrc) && /\.columns\.collapse-sm \{ flex-direction: column/.test(mainCssSrc));
const pznApi = require('../src/pzn/index');
const bentRow = pznApi.serialize(pznApi.fromTapuzPage({ title: 'x', slug: 'x', blocks: [{ id: 'r', type: 'columns', data: { columns: [{ blocks: [] }, { blocks: [] }], width: 'full', ratio: '2:1' } }] }));
check('the row width rides BenTML both ways (registry param → bridge → tag → block)', /width="full"/.test(bentRow) && pznApi.toTapuzPage(pznApi.parse(bentRow)).blocks[0].data.width === 'full');

// ── 2. the designer prompt ───────────────────────────────────────────
const { buildThemePrompt, moduleRoots } = require('../src/theme-roleplay');
const pack = buildThemePrompt({ brief: 'חנות פרחים וינטג׳ פריזאית', siteTitle: 'נועה', description: 'פרחים' });
check('the prompt\'s FIRST LINE demands a FRESH chat', pack.text.split('\n')[0].indexOf('FRESH') !== -1);
check('the prompt casts the model as the theme designer in a roleplay', /מעצב\/ת ערכות הנושא/.test(pack.text) && /Roleplay/.test(pack.text));
check('the prompt teaches the <bent-theme> document, the font shelf, the skeleton and the css variables',
  /<bent-background kind="solid\|gradient\|glow\|dots\|grid\|lines"/.test(pack.text) && pack.text.indexOf('Frank Ruhl Libre') !== -1 &&
  pack.text.indexOf('`.site-header`') !== -1 && pack.text.indexOf('--accent-bg') !== -1 && pack.text.indexOf('.bent-card') !== -1);
check('the prompt carries the compact module grammar (the bench vocabulary) and the row grammar',
  /bent-columns` ⊃ bent-col/.test(pack.text) && /ratio="2:1:1" width="content\|wide\|full"/.test(pack.text));
check('the module roots come from the real theme css', moduleRoots().length >= 30 && moduleRoots().includes('.bent-card'));
check('the prompt contracts ONE html fence with a whole <bent-theme> document and no prose', /fence אחד, מסמך אחד/.test(pack.text) && /<bent-theme name="לילה כחול"/.test(pack.text) && !/```json/.test(pack.text));
check('with an empty bench the prompt demands a bent-canvas; with a full bench it forbids one',
  /bent-canvas` חובה/.test(pack.text) && /הקנבס כבר מלא/.test(buildThemePrompt({ canvasModules: ['hero'] }).text));
check('the prompt embeds the site, RTL, contrast and no-external rules', pack.text.indexOf('**נועה**') !== -1 && /RTL/.test(pack.text) && /4\.5/.test(pack.text) && /CDN/.test(pack.text));
check('the prompt embeds the brief and ends on "design it now"', pack.text.indexOf('חנות פרחים וינטג׳ פריזאית') !== -1 && /עצב\/י את זה עכשיו/.test(pack.text));
const packCur = buildThemePrompt({ current: { colors: { primary: '#123456' }, skin: { css: '.x{top:0}' } } });
check('with current=1 the prompt carries the live knobs and skin as the starting point',
  packCur.text.indexOf('"primary": "#123456"') !== -1 && packCur.text.indexOf('.x{top:0}') !== -1 && /נקודת המוצא/.test(packCur.text));
check('without a brief the prompt asks for a one-line "ready"', /המשחק מתחיל עכשיו/.test(packCur.text));
check('the pack fits a chat message (< 20K chars)', pack.chars < 20000);

// ── 2b. v2.27 — the prompt teaches a curated bench KIT and the guard's contract ──
check('the prompt hands the bench a curated kit (not the whole page vocabulary), with worked examples of the containers models break',
  /ערכת המודולים של הבנץ׳/.test(pack.text) && /`bent-pricing` ⊃ bent-plan/.test(pack.text) && /<bent-pricing id="p1"><bent-plan/.test(pack.text) &&
  /<bent-features id="f1" columns="3"><bent-feature/.test(pack.text) && !/`bent-whatsapp`/.test(pack.text) && !/`bent-consent`/.test(pack.text) && !/`bent-pager`/.test(pack.text));
check('the prompt names what a theme is NOT (a page) and forbids <div>/free <style>/curly quotes',
  /## מה זה \*\*לא\*\*/.test(pack.text) && /<!DOCTYPE html>/.test(pack.text) && /מסולסלות/.test(pack.text) && /קוסמטיקה על השלד/.test(pack.text));
check('the effect rules are the guard\'s own: a pool, one rAF loop, transform/opacity, coalesced mousemove, no interval under 16ms, pointer-events none',
  /מאגר קבוע/.test(pack.text) && /requestAnimationFrame/.test(pack.text) && /`transform`/.test(pack.text) && /16ms/.test(pack.text) && /pointer-events:none/.test(pack.text));
check('the example move shows the safe effect shape (a pool, one loop, reduced-motion respected)',
  /var N = 12, dots = \[\]/.test(pack.text) && /prefers-reduced-motion: reduce/.test(pack.text) && /requestAnimationFrame\(loop\)/.test(pack.text));

// ── 2c. v2.27 — the misfire matrix: what chats actually send, read the way it was meant ──
const KNOBS = '<bent-colors primary="#7c2d12" secondary="#b45309" text="#292524" muted="#6b5d52" border="#dccbb0" bg="#f6efe3" light-bg="#efe4d0" surface="#fbf7ef" />';
const mf = (body) => theme.extractThemeReply('```html\n<bent-theme name="פריז" version="2">\n' + KNOBS + '\n' + body + '\n</bent-theme>\n```');
check('misfire C: a bare <style> straight under <bent-theme> is the skin (and the door says so)',
  (() => { const t = mf('<style>.hero h1 { font-size: 3rem; }</style>'); return /font-size: 3rem/.test(t.overrides.skin.css) && t.warnings.some((w) => /bent-skin/.test(w)); })());
check('misfire D: a css fence BESIDE the document is the skin',
  /font-size: 3rem/.test(theme.extractThemeReply('```html\n<bent-theme name="פריז">\n' + KNOBS + '\n</bent-theme>\n```\n\n```css\n.hero h1 { font-size: 3rem; }\n```').overrides.skin.css));
check('misfire E: an @import of Google Fonts inside the skin is removed and its family moves to fonts.google',
  (() => { const t = mf('<bent-skin><style>@import url("https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&display=swap");\n.hero h1 { font-family: "Heebo"; }</style></bent-skin>'); return !/@import/.test(t.overrides.skin.css) && t.overrides.fonts.google.includes('Heebo') && t.warnings.some((w) => /@import/.test(w)); })());
check('misfire F: an external url( in the skin is removed — the site fetches nothing from strangers',
  (() => { const t = mf('<bent-skin><style>.hero { background: url("https://images.example.com/a.jpg") center/cover; }</style></bent-skin>'); return !/images\.example/.test(t.overrides.skin.css) && /background: none/.test(t.overrides.skin.css) && t.warnings.some((w) => /חיצונית/.test(w)); })());
check('misfire G: family=""Heebo", sans-serif" (a quote inside the quotes) parses as the family, and both fonts load',
  (() => { const t = theme.extractThemeReply('<bent-theme name="פריז"><bent-fonts family=""Heebo", system-ui, sans-serif" heading=""Suez One", serif" google="Heebo, Suez One" /></bent-theme>'); return /"Heebo", system-ui/.test(t.overrides.fonts.family) && /Suez One/.test(t.overrides.fonts.headingFamily) && t.overrides.fonts.google.includes('Suez One'); })());
check('misfire H: curly quotes around attribute values are read as straight ones — colours stay colours',
  (() => { const t = theme.extractThemeReply('<bent-theme name=“פריז”><bent-colors primary=“#7c2d12” bg=“#f6efe3” /></bent-theme>'); return t.name === 'פריז' && t.overrides.colors.primary === '#7c2d12'; })());
check('misfire I: a PAGE pasted as a theme is named as one (code PAGE_NOT_THEME) — never saved as an empty theme',
  (() => { try { theme.extractThemeReply('```html\n<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1"><head><title>x</title></head><body><bent-hero id="h1"><bent-heading level="1">x</bent-heading></bent-hero></body></html>\n```\nPZN_READY'); return false; } catch (e) { return e.code === 'PAGE_NOT_THEME' && /FRESH/.test(e.message); } })());
check('misfire O: two documents (the template echoed back, then the theme) → the richest wins',
  theme.extractThemeReply('```html\n<bent-theme name="…" version="2">\n  <bent-colors … />\n</bent-theme>\n```\nועכשיו:\n```html\n<bent-theme name="פריז">\n' + KNOBS + '\n</bent-theme>\n```').name === 'פריז');
check('misfire P: rgb() folds to hex, an invalid colour is dropped with a word',
  (() => { const t = theme.extractThemeReply('<bent-theme name="x"><bent-colors primary="rgb(245, 158, 11)" bg="#f6efe3" text="not-a-color!" /></bent-theme>'); return t.overrides.colors.primary === '#f59e0b' && !('text' in t.overrides.colors) && t.warnings.some((w) => /"text"/.test(w)); })());
check('a font named in family but missing from google is loaded (the request that never reached the page)',
  theme.extractThemeReply('<bent-theme name="x"><bent-fonts family=\'"Rubik", sans-serif\' /></bent-theme>').overrides.fonts.google.includes('Rubik'));
check('misfire K: a bench fragment with raw HTML around modules is repaired, not refused',
  (() => { const c = require('../src/theme-canvas'); const r = c.blocksFromSource('<bent-hero id="h1"><bent-heading level="1">x</bent-heading><bent-text>a <b>b</b><br>c</bent-text></bent-hero>\n<div class="row"><bent-card id="c1"><bent-text>y</bent-text></bent-card></div>'); return r.blocks.length >= 2 && r.warnings.length >= 1; })());
check('lintSkin names a skin that hides the menu or freezes body scroll',
  theme.lintSkin('.main-nav { display: none }').some((w) => /display:none/.test(w)) && theme.lintSkin('body { overflow: hidden }').some((w) => /overflow/.test(w)) && theme.lintSkin('.hero h1 { font-size: 3rem }').length === 0);

// ── 2d. v2.28b — the menu knobs: fold ("עוד"), collapse point, current-page mark ──
const knobDialect = require('../src/bentml/theme-dialect');
const knobDoc = knobDialect.serializeTheme({ name: 'ידיות', overrides: { chrome: { menuFold: 3, menuCollapse: 'lg', menuCurrent: 'pill' } } });
const knobBack = knobDialect.parseTheme(knobDoc);
check('the .bent dialect round-trips menu-fold (as a Number) / menu-collapse / menu-current on bent-chrome',
  /<bent-chrome menu-fold="3" menu-collapse="lg" menu-current="pill" \/>/.test(knobDoc) && knobBack.overrides.chrome.menuFold === 3 && typeof knobBack.overrides.chrome.menuFold === 'number' &&
  knobBack.overrides.chrome.menuCollapse === 'lg' && knobBack.overrides.chrome.menuCurrent === 'pill' && knobDialect.serializeTheme({ name: knobBack.name, overrides: knobBack.overrides }) === knobDoc);
check('a kebab/camel/quoted mix parses the knobs too, and a section named like a sibling (<bent-menu-layout>) never opens the chrome/layout sections',
  knobDialect.parseTheme("<bent-theme><bent-chrome menuFold='5' menu-current=\"bold\" /><bent-menu-layout placement=\"side\" fold=\"2\" /></bent-theme>").overrides.chrome.menuFold === 5 &&
  knobDialect.parseTheme("<bent-theme><bent-chrome menuFold='5' /><bent-menu-layout placement=\"side\" fold=\"2\" /></bent-theme>").overrides.layout === undefined);
check('the fold knob emits no :root variable (a fold is markup, not css) and no body class of its own',
  theme.overridesToCss({ chrome: { menuFold: 3 } }) === theme.overridesToCss({}) && !/fold/i.test(theme.overridesToCss({ chrome: { menuFold: 3 } })) &&
  JSON.stringify(theme.menuBodyClasses({ chrome: { menuFold: 3 } })) === '[]' && theme.menuKnobs({ chrome: { menuFold: '5' } }).fold === 5);
check('the contract helpers: an untouched site has no body classes, spread is an alias of between, unknown values reset with Hebrew warnings',
  JSON.stringify(theme.menuBodyClasses(theme.DEFAULT_OVERRIDES)) === '[]' && theme.knobsToOverrides({ align: 'spread' }).overrides.chrome.menuAlign === 'between' &&
  (() => { const r = theme.knobsToOverrides({ fold: 'all', flow: 'wat' }); return r.overrides.chrome.menuFold === 0 && r.overrides.chrome.menuOverflow === 'wrap' && r.warnings.length === 2 && r.warnings.every((w) => /[֐-׿]/.test(w)); })());
const knobReply = theme.extractThemeReply('```html\n<bent-theme name="ידיות">\n' + KNOBS + '\n<bent-chrome menu-current="rainbow" menu-fold="all" menu-collapse="lg" />\n</bent-theme>\n```');
check('a pasted theme with an unknown menu-current / menu-fold → reset to the defaults, the good knob kept, one Hebrew warning each naming the value',
  knobReply.overrides.chrome.menuCurrent === 'underline' && knobReply.overrides.chrome.menuFold === 0 && knobReply.overrides.chrome.menuCollapse === 'lg' &&
  knobReply.warnings.some((w) => /current/.test(w) && /rainbow/.test(w)) && knobReply.warnings.some((w) => /fold/.test(w) && /"all"/.test(w)));
check('the designer prompt teaches the three knobs on bent-chrome, the new skeleton selectors and the menu css variables',
  /menu-fold="0" menu-collapse="sm\|md\|lg\|never" menu-current="underline\|pill\|bold\|none"/.test(pack.text) && /`menu-fold` = /.test(pack.text) &&
  pack.text.indexOf('`.main-nav .sub-menu`') !== -1 && pack.text.indexOf('`.nav-more-sum`') !== -1 && pack.text.indexOf('`.nav-burger`') !== -1 && pack.text.indexOf('`body.menu-side`') !== -1 &&
  /--menu-gap/.test(pack.text) && /--menu-size/.test(pack.text) && /--menu-align/.test(pack.text) && /--header-max-width/.test(pack.text));

// ── 3. take only the theme ───────────────────────────────────────────
const chatty = 'בשמחה! הנה הערכה שביקשת:\n\n```json\n{ "name": "פריז", "colors": { "primary": "#7c2d12", "secondary": "#b45309", "text": "#292524", "muted": "#6b5d52", "border": "#dccbb0", "bg": "#f6efe3", "lightBg": "#efe4d0", "surface": "#fbf7ef" }, "fonts": { "family": "\\"David Libre\\", serif", "headingFamily": "\\"Frank Ruhl Libre\\", serif", "baseSize": "17px", "google": ["Frank Ruhl Libre", "David Libre"] }, "style": { "radius": "sharp", "shadow": "flat", "accent": "solid", "buttons": "outline" }, "background": { "kind": "lines", "angle": 135 }, "chrome": { "menuHover": "underline" } }\n```\n\nוהעור:\n```css\n.site-header { border-bottom: 3px double var(--color-border); }\n.hero h1 { font-size: 3rem; }\n```\n\n```js\n(function(){ document.addEventListener("DOMContentLoaded", function(){}); })();\n```\n\nתהנו! אם תרצו שינוי, רק תגידו.';
const t1 = theme.extractThemeReply(chatty);
check('json + css + js fences with chat prose → name, knobs, skin, effect',
  t1.name === 'פריז' && t1.overrides.colors.primary === '#7c2d12' && t1.overrides.fonts.google[1] === 'David Libre' &&
  t1.overrides.background.kind === 'lines' && /double/.test(t1.overrides.skin.css) && /DOMContentLoaded/.test(t1.overrides.effects.js) &&
  t1.parts.json && t1.parts.cssChars > 0 && t1.parts.jsChars > 0);
const pkgInFence = 'Here is your package:\n```json\n' + JSON.stringify({ format: 'tapuz-theme', version: 2, name: 'מהקובץ', overrides: { colors: { primary: '#0000ff' }, unknown: { x: 1 } } }) + '\n```\nDone.';
const t2 = theme.extractThemeReply(pkgInFence);
check('a full tapuz-theme package inside a fence → its overrides (known sections only)', t2.name === 'מהקובץ' && t2.overrides.colors.primary === '#0000ff' && !('unknown' in t2.overrides));
const bare = 'Sure thing. {"name":"חשוף","colors":{"primary":"#00ff00","bg":"#ffffff"},"style":{"radius":"round"}} — that\'s it.';
const t3 = theme.extractThemeReply(bare);
check('a bare theme JSON inside prose (no fence) → a theme', t3.name === 'חשוף' && t3.overrides.colors.primary === '#00ff00' && t3.overrides.style.radius === 'round');
const tagged = theme.extractThemeReply('<style>.a{top:0}</style>\n<script>(function(){})();</script>');
check('bare <style>/<script> with no json → skin + effect', tagged.overrides.skin.css === '.a{top:0}' && tagged.overrides.effects.js === '(function(){})();');
check('the css fence alone is a theme (a skin-only reply)', theme.extractThemeReply('```css\n.hero{padding:0}\n```').overrides.skin.css === '.hero{padding:0}');
check('the CSS braces in the skin never confuse the JSON hunt', theme.extractThemeJson('```css\n.a { color: red }\n```\n{"colors":{"primary":"#123"}}').colors.primary === '#123');
check('a reply with nothing usable throws a plain error', (() => { try { theme.extractThemeReply('no theme here, sorry'); return false; } catch (e) { return /לא נמצאה ערכת נושא/.test(e.message); } })());
check('a fallback name is used when the reply has none', theme.extractThemeReply('```css\n.a{}\n```', 'מהתיאור').name === 'מהתיאור');
check('zero-width characters (chat copy artifacts) are stripped before parsing',
  theme.extractThemeJson('﻿```json\n{"colors":{"primary":"#abc"}}\n```').colors.primary === '#abc');

// the bent dialect (v2.26) — one document, exact round trip
const dialect = require('../src/bentml/theme-dialect');
const bentDoc = dialect.serializeTheme({ name: 'פריז', overrides: t1.overrides, canvas: '<bent-hero id="h"><bent-heading level="1">פריז</bent-heading></bent-hero>\n<bent-columns id="r" ratio="2:1" width="wide"><bent-col><bent-card id="c" /></bent-col><bent-col><bent-form id="f" /></bent-col></bent-columns>' });
check('serializeTheme writes every section as a tag, css/js inside style/script, the bench inside bent-canvas',
  /<bent-colors primary="#7c2d12"/.test(bentDoc) && /<bent-fonts [^>]*google="Frank Ruhl Libre, David Libre"/.test(bentDoc) && /<bent-skin>\s*<style>/.test(bentDoc) && /<bent-effect>[\s\S]*<script>/.test(bentDoc) && /<bent-canvas>[\s\S]*<bent-columns id="r" ratio="2:1" width="wide">/.test(bentDoc));
const tb = theme.extractThemeReply('בבקשה:\n```html\n' + bentDoc + '\n```\nתהנו');
check('a <bent-theme> reply (fenced, with prose) → the same theme back, marked bent, with its specimen',
  tb.parts.bent === true && tb.name === 'פריז' && JSON.stringify(tb.overrides.colors) === JSON.stringify(t1.overrides.colors) && JSON.stringify(tb.overrides.fonts) === JSON.stringify(t1.overrides.fonts) &&
  JSON.stringify(tb.overrides.style) === JSON.stringify(t1.overrides.style) && tb.overrides.background.kind === 'lines' && tb.overrides.background.angle === 135 && tb.overrides.chrome.menuHover === 'underline' &&
  tb.overrides.skin.css === t1.overrides.skin.css && tb.overrides.effects.js === t1.overrides.effects.js && /<bent-columns id="r"/.test(tb.specimen));
check('serialize(parse(doc)) is byte-identical (a stable file format)', dialect.serializeTheme({ name: tb.name, overrides: tb.overrides, canvas: tb.specimen }) === bentDoc);
check('single-quoted and camelCase attributes parse too', dialect.parseTheme("<bent-theme name='x'><bent-fonts family='\"Heebo\", sans-serif' headingFamily='Suez One' /><bent-chrome headerGlass='true' /></bent-theme>").overrides.fonts.headingFamily === 'Suez One' && dialect.parseTheme("<bent-theme><bent-chrome header-glass='yes' /></bent-theme>").overrides.chrome.headerGlass === true);
check('a bent reply whose effect does not compile is refused', (() => { try { theme.extractThemeReply('<bent-theme><bent-effect><script>oops(</script></bent-effect></bent-theme>'); return false; } catch (e) { return /לא מתקמפל/.test(e.message); } })());
check('an empty <bent-theme> is refused with a plain error', (() => { try { theme.extractThemeReply('<bent-theme name="x"></bent-theme>'); return false; } catch (e) { return /ריק/.test(e.message); } })());
check('a bent document is a package for the import doors, canvas included', theme.parseThemePackage(bentDoc).format === 'tapuz-theme' && /<bent-form/.test(theme.parseThemePackage(bentDoc).canvas));

// the import doors
check('parseThemePackage: a package object passes through', theme.parseThemePackage({ format: 'tapuz-theme', version: 1, overrides: {} }).format === 'tapuz-theme');
check('parseThemePackage: package JSON text, fenced with prose → the package', theme.parseThemePackage(pkgInFence).name === 'מהקובץ');
check('parseThemePackage: a bare theme JSON is wrapped into a v2 package', theme.parseThemePackage(bare).format === 'tapuz-theme' && theme.parseThemePackage(bare).overrides.colors.primary === '#00ff00');
check('parseThemePackage: a chat reply with fences → a package with skin + effect', theme.parseThemePackage(chatty).overrides.skin.css.indexOf('double') !== -1);
check('parseThemePackage: garbage → the classic "not JSON" error', (() => { try { theme.parseThemePackage('hello'); return false; } catch (e) { return /לא JSON/.test(e.message); } })());
check('validateThemePackage: a string version ("2") is accepted, a newer one refused',
  theme.validateThemePackage({ format: 'tapuz-theme', version: '2', overrides: {} }).format === 'tapuz-theme' &&
  (() => { try { theme.validateThemePackage({ format: 'tapuz-theme', version: 99, overrides: {} }); return false; } catch (e) { return true; } })());
check('importThemePackage takes raw text too', theme.importThemePackage(bare).colors.primary === '#00ff00' && theme.loadOverrides().colors.primary === '#00ff00');

// ── 4. the effect is compiled before it is accepted ──────────────────
check('checkEffectJs: a clean IIFE compiles', theme.checkEffectJs('(function(){ var a = 1; })();') === '');
check('checkEffectJs: a syntax error is reported', /Unexpected|missing|Invalid|Unterminated|token/i.test(theme.checkEffectJs('(function(){ var a = ; })();')));
check('checkEffectJs: a top-level import (module code) is refused', theme.checkEffectJs('import x from "y"; x();') !== '');
check('checkEffectJs: empty is fine', theme.checkEffectJs('') === '');
check('checkCss: unbalanced braces are reported, balanced pass', theme.checkCss('.a { color: red;') !== '' && theme.checkCss('.a { color: red; }') === '');
check('a theme reply whose effect does not compile is refused with the reason',
  (() => { try { theme.extractThemeReply('```js\n(function(){ oops( })();\n```'); return false; } catch (e) { return /לא מתקמפל/.test(e.message); } })());
const guarded = theme.renderThemeEffectsJs({ effects: { js: 'throw new Error("boom")' } });
check('the effect script runs guarded: a throw is caught, tagged and parked for the canvas',
  /^<script id="tapuz-theme-effects">/.test(guarded) && /try \{/.test(guarded) && /__tapuzThemeEffectError/.test(guarded) && /\[tapuz-theme-effects\]/.test(guarded));

// ── 5 + 6. the server: prompt, paste, library, canvas, import ────────
const { spawn } = require('child_process');
const PORT = 3977;
const BASE = 'http://127.0.0.1:' + PORT;
function req(method, urlPath, { body, form, cookie } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE };
    if (form != null) { data = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (body != null) { data = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    if (cookie) headers['Cookie'] = cookie;
    const r = http.request(BASE + urlPath, { method, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* non-json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function waitUp(tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/', () => resolve()).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries);
  });
}

(async () => {
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'סטודיו', description: 'theme-studio smoke',
    colors: { primary: '#0a66c2', bg: '#ffffff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home', 'about'], menuPages: ['home', 'about'], external: []
  });
  const { createAdmin } = require('../src/auth');
  createAdmin('owner', 'owner-pass-1');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();
    const login = await req('POST', '/admin/login', { form: { username: 'owner', password: 'owner-pass-1' } });
    const cookie = String(login.headers['set-cookie'] || '').split(';')[0];

    // a deploy reaches the visitors (v2.26): the server rebuilt the export at
    // boot because the export on disk carried no build stamp / another build's
    const builtBy = path.join(ROOT, 'public', '.built-by');
    check('at boot the server rebuilt the export and stamped it with the running build id',
      fs.existsSync(builtBy) && fs.readFileSync(builtBy, 'utf8').trim() === require('../src/build-info').buildId() && /<meta name="generator" content="Tapuziel /.test(fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')));
    const exp = require('../src/export');
    fs.writeFileSync(builtBy, 'some-older-build\n');
    const refreshed = exp.refreshAfterDeploy();
    check('refreshAfterDeploy rebuilds when the stamp differs and reports from → to', refreshed.rebuilt === true && refreshed.from === 'some-older-build' && refreshed.to === require('../src/build-info').buildId());
    check('refreshAfterDeploy is a no-op when the export already matches the running build', exp.refreshAfterDeploy().rebuilt === false);

    const page = await req('GET', '/admin/theme', { cookie });
    check('GET /admin/theme → the studio: designer card, canvas iframe, looks, skin, file import',
      page.status === 200 && /th-design-card/.test(page.text) && /<iframe id="th-canvas"/.test(page.text) && /th-looks/.test(page.text) &&
      /th-skin-css/.test(page.text) && /th-import-file/.test(page.text) && /th-font-google/.test(page.text) && /th-bg-kind/.test(page.text));
    // v2.28b — the menu knobs in the studio form, the capacity hint, the way to the organizer
    check('the studio carries the fold / collapse / current controls, the capacity hint and a link to the menu organizer',
      /<input type="number" id="th-ch-fold" min="0" max="12"/.test(page.text) && /id="th-ch-collapse"/.test(page.text) && /id="th-ch-current"/.test(page.text) &&
      /<p id="th-nav-fit" class="hint">/.test(page.text) && /href="\/admin\/menus#organizer">🧭 סדרו את התפריט עם ה-AI</.test(page.text));
    const knobSave = await req('POST', '/admin/api/theme', { cookie, body: { overrides: { chrome: { menuCollapse: 'huge', menuFold: '3', menuCurrent: 'pill' } } } });
    check('POST /admin/api/theme resets an unknown menu knob, keeps the good ones, reports in warnings, and answers with menuFit (GET too)',
      knobSave.status === 200 && knobSave.json.ok && knobSave.json.warnings.some((w) => /collapse/.test(w) && /huge/.test(w)) && knobSave.json.overrides.chrome.menuCollapse === 'md' &&
      knobSave.json.overrides.chrome.menuFold === 3 && knobSave.json.overrides.chrome.menuCurrent === 'pill' && 'menuFit' in knobSave.json && 'menuFit' in (await req('GET', '/admin/api/theme', { cookie })).json);

    // the designer prompt
    const prompt = await req('GET', '/admin/api/theme/design-prompt?brief=' + encodeURIComponent('חנות פרחים') + '&current=1', { cookie });
    check('GET design-prompt → the FRESH-first theme pack with the brief and the current theme',
      prompt.status === 200 && prompt.text.split('\n')[0].indexOf('FRESH') !== -1 && prompt.text.indexOf('חנות פרחים') !== -1 && /נקודת המוצא/.test(prompt.text) && prompt.text.indexOf('**סטודיו**') !== -1);

    // the paste-back lands in the library, never on the live site
    const liveBefore = (await req('GET', '/admin/api/theme', { cookie })).json.overrides.colors.primary;
    const paste = await req('POST', '/admin/api/theme/design/paste', { cookie, body: { reply: chatty } });
    check('POST design/paste → a library entry (source ai) with the sections it found',
      paste.status === 200 && paste.json.ok && /^thm_/.test(paste.json.id) && paste.json.name === 'פריז' && paste.json.applied === false &&
      paste.json.sections.includes('skin') && paste.json.sections.includes('effects'));
    const lib = (await req('GET', '/admin/api/theme/library', { cookie })).json.themes;
    check('the AI theme is listed in the library as 🤖', lib.some((t) => t.id === paste.json.id && t.source === 'ai'));
    check('the live site is untouched by a paste without apply', (await req('GET', '/admin/api/theme', { cookie })).json.overrides.colors.primary === liveBefore);
    const badPaste = await req('POST', '/admin/api/theme/design/paste', { cookie, body: { reply: '```js\n(function(){ oops( })();\n```' } });
    check('a reply whose effect does not compile → 400 with the reason', badPaste.status === 400 && /לא מתקמפל/.test(badPaste.json.error));
    const nothing = await req('POST', '/admin/api/theme/design/paste', { cookie, body: { reply: 'sorry, no' } });
    check('a reply with no theme → 400 with FRESH guidance', nothing.status === 400 && /FRESH/.test(nothing.json.error));
    // v2.27 — the doors talk back
    const pageReply = '```html\n<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1"><head><title>x</title></head><body><bent-hero id="h1"><bent-heading level="1">x</bent-heading></bent-hero></body></html>\n```';
    const pageAsTheme = await req('POST', '/admin/api/theme/design/paste', { cookie, body: { reply: pageReply } });
    check('a PAGE pasted as a theme → 400 with code PAGE_NOT_THEME (the studio offers the bench instead)',
      pageAsTheme.status === 400 && pageAsTheme.json.code === 'PAGE_NOT_THEME' && /FRESH/.test(pageAsTheme.json.error));
    const libCountBefore = (await req('GET', '/admin/api/theme/library', { cookie })).json.themes.length;
    const messyBench = await req('POST', '/admin/api/theme/design/paste', { cookie, body: { reply: '```html\n<bent-theme name="בנץ׳ מבולגן">\n<bent-colors primary="#123456" />\n<bent-canvas>\n<bent-nonsense-module id="q1"><bent-nonsense-child /></bent-nonsense-module>\n<div class="x"><bent-hero id="h1"><bent-heading level="1">x</bent-heading></bent-hero></div>\n</bent-canvas>\n</bent-theme>\n```', bench: true } });
    check('a theme whose bench needs repair is SAVED and the bench lands repaired — the theme is never lost to its bench',
      messyBench.status === 200 && messyBench.json.ok && messyBench.json.benchCount >= 1 && messyBench.json.benchError === '' &&
      (await req('GET', '/admin/api/theme/library', { cookie })).json.themes.length === libCountBefore + 1);
    await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'clear' } }); // the bench checks below start from nothing
    const warned = await req('POST', '/admin/api/theme/design/paste', { cookie, body: { reply: '```html\n<bent-theme name="עם הערות">\n<bent-colors primary="#123456" />\n<bent-skin><style>@import url("https://fonts.googleapis.com/css2?family=Rubik");\n.hero{color:red}</style></bent-skin>\n<bent-effect><script>document.addEventListener("mousemove", function(){ document.body.appendChild(document.createElement("div")); });</script></bent-effect>\n</bent-theme>\n```' } });
    check('design/paste answers with the door\'s warnings (an @import moved to fonts, a node-per-mousemove effect named)',
      warned.status === 200 && warned.json.warnings.some((w) => /@import/.test(w)) && warned.json.warnings.some((w) => /תזוזת עכבר/.test(w)) && warned.json.sections.includes('fonts'));
    const fxWarned = await req('POST', '/admin/api/theme/effects/paste', { cookie, body: { reply: '```css\n.d{top:0; background:url(https://x.example/a.png)}\n```\n```js\nsetInterval(function(){}, 1);\n```', note: 'w' } });
    check('effects/paste answers with warnings too (external url removed, 1ms interval named) and keeps the effect',
      fxWarned.status === 200 && fxWarned.json.warnings.some((w) => /חיצונית/.test(w)) && fxWarned.json.warnings.some((w) => /16ms/.test(w)));

    // the canvas — a candidate renders the real pages without saving
    const pv = await req('POST', '/admin/api/theme/preview', { cookie, body: { reply: chatty } });
    check('POST preview (an AI reply) → a preview id + the fonts it will load + effect flag',
      pv.status === 200 && pv.json.ok && /^pv_/.test(pv.json.id) && pv.json.fonts.includes('Frank Ruhl Libre') && pv.json.hasEffect === true);
    const frame = await req('GET', '/admin/theme/preview/' + pv.json.id, { cookie });
    check('GET preview/:id → the real home page rendered in the CANDIDATE theme',
      frame.status === 200 && /--color-primary: #7c2d12/.test(frame.text) && /border-bottom: 3px double/.test(frame.text) &&
      /fonts\.googleapis\.com\/css2\?family=Frank\+Ruhl\+Libre/.test(frame.text) && /tapuz-theme-effects/.test(frame.text));
    check('the preview carries the canvas shim and may be framed by the studio (SAMEORIGIN, not DENY)',
      /tapuz-theme-preview-shim/.test(frame.text) && frame.headers['x-frame-options'] === 'SAMEORIGIN');
    const frameAbout = await req('GET', '/admin/theme/preview/' + pv.json.id + '?path=about', { cookie });
    check('?path= browses another page in the same candidate theme', frameAbout.status === 200 && /<title>אודות/.test(frameAbout.text) && /--color-primary: #7c2d12/.test(frame.text));
    check('the live site still renders the LIVE theme (the candidate leaked nowhere)',
      /--color-primary: #7c2d12/.test((await req('GET', '/', { cookie })).text) === false);
    const pvForm = await req('POST', '/admin/api/theme/preview', { cookie, body: { overrides: { colors: { primary: '#00aa00' } } } });
    const frameForm = await req('GET', '/admin/theme/preview/' + pvForm.json.id, { cookie });
    check('POST preview (the form) → the form merged onto the live theme', frameForm.status === 200 && /--color-primary: #00aa00/.test(frameForm.text));
    const pvLib = await req('POST', '/admin/api/theme/preview', { cookie, body: { libraryId: paste.json.id } });
    check('POST preview (a library entry) → that entry', pvLib.status === 200 && pvLib.json.name === 'פריז');
    check('preview of an unknown id falls back to the live theme, never 500', (await req('GET', '/admin/theme/preview/pv_nope', { cookie })).status === 200);
    check('the live site is STILL untouched after every preview', (await req('GET', '/admin/api/theme', { cookie })).json.overrides.colors.primary === liveBefore);

    // apply is the explicit second move — and it rebuilds the site
    const applied = await req('POST', '/admin/api/theme/design/paste', { cookie, body: { reply: chatty, apply: true } });
    check('POST design/paste apply:true → saved AND applied, the previous work backed up',
      applied.status === 200 && applied.json.applied === true && applied.json.backedUp === true && applied.json.rebuildError === '');
    const liveAfter = (await req('GET', '/admin/api/theme', { cookie })).json.overrides;
    check('the AI theme is now live, skin + fonts + background included',
      liveAfter.colors.primary === '#7c2d12' && liveAfter.fonts.google[0] === 'Frank Ruhl Libre' && liveAfter.background.kind === 'lines' && /double/.test(liveAfter.skin.css));
    const mainCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'main.css'), 'utf8');
    check('the exported css/main.css carries the skin and the pattern background', /border-bottom: 3px double/.test(mainCss) && /repeating-linear-gradient\(135deg/.test(mainCss));
    const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    check('the exported page loads the web fonts and keeps the guarded effect', /fonts\.googleapis\.com\/css2/.test(index) && /tapuz-theme-effects/.test(index) && /try \{/.test(index));
    const live = await req('GET', '/', { cookie });
    check('the served site widens its CSP by exactly Google Fonts while a web font is in use',
      /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/.test(live.headers['content-security-policy']) && /font-src 'self' data: https:\/\/fonts\.gstatic\.com/.test(live.headers['content-security-policy']));
    // v2.30 — nothing leaks: the admin shell links admin.css and nothing of the theme
    // (the full sweep over every admin screen is scripts/smoke-admin-isolation.js)
    const adminPage = await req('GET', '/admin/theme', { cookie });
    check('the studio page links the admin stylesheet only — no main.css, no admin-theme.css, no web fonts (no leak into the admin screens)',
      /<link rel="stylesheet" href="\/css\/admin\.css">/.test(adminPage.text) && !/main\.css">|admin-theme\.css|fonts\.googleapis\.com\/css2/.test(adminPage.text) &&
      !fs.existsSync(path.join(ROOT, 'public', 'css', 'admin-theme.css')));
    check('the exported page carries the effect GUARD (shadowed globals), not a bare try/catch', /\(function \(window, document, self, globalThis, addEventListener/.test(index));
    check('the studio page is one styled flow — no inline-style forest, the flow strip, the warnings lists, the bench button',
      /class="studio-flow"/.test(adminPage.text) && /id="th-design-warn"/.test(adminPage.text) && /id="th-design-to-bench"/.test(adminPage.text) && /class="studio-savebar"/.test(adminPage.text) &&
      (adminPage.text.match(/style="/g) || []).length < 40);

    // the effect door compiles too
    const fxBad = await req('POST', '/admin/api/theme/effects/paste', { cookie, body: { reply: '```js\nfunction ( { broken\n```' } });
    check('effects/paste refuses a snippet that does not compile (no more "נקלט ✓" over broken code)', fxBad.status === 400 && /לא מתקמפל/.test(fxBad.json.error));
    const fxGood = await req('POST', '/admin/api/theme/effects/paste', { cookie, body: { reply: '```css\n.d{top:0}\n```\n```js\n(function(){})();\n```', note: 'ok' } });
    check('effects/paste still accepts a clean snippet and reports the rebuild', fxGood.status === 200 && fxGood.json.ok && fxGood.json.rebuildError === '');

    // the import doors are tolerant now
    const impText = await req('POST', '/admin/api/theme/import', { cookie, body: { text: 'Here you go:\n```json\n' + JSON.stringify({ format: 'tapuz-theme', version: 2, name: 'x', overrides: { colors: { primary: '#101010' } } }) + '\n```' } });
    check('POST import with fenced text → applied', impText.status === 200 && impText.json.ok && impText.json.overrides.colors.primary === '#101010');
    const impLib = await req('POST', '/admin/api/theme/library/import', { cookie, body: { text: bare } });
    check('POST library/import with a bare theme JSON in prose → a library entry', impLib.status === 200 && impLib.json.ok && impLib.json.name === 'חשוף');
    const impBad = await req('POST', '/admin/api/theme/import', { cookie, body: { text: 'nothing here' } });
    check('POST import with garbage → 400, live untouched', impBad.status === 400 && (await req('GET', '/admin/api/theme', { cookie })).json.overrides.colors.primary === '#101010');
    const impObj = await req('POST', '/admin/api/theme/import', { cookie, body: { package: { format: 'tapuz-theme', version: 1, name: 'v1', overrides: { colors: { primary: '#202020' } } } } });
    check('POST import with a v1 package object still works (backward compatible)', impObj.status === 200 && impObj.json.overrides.colors.primary === '#202020');

    // ── 7. the bench — a canvas of nothing, filled with modules ──────
    const bench0 = await req('GET', '/admin/api/theme/canvas', { cookie });
    check('GET canvas → empty bench + the module palette (55+ authoring modules, grouped)',
      bench0.status === 200 && bench0.json.ok && bench0.json.count === 0 && bench0.json.palette.length >= 50 && bench0.json.palette.every((p) => p.type && p.label && p.category));
    check('the studio page carries the bench panel and opens the canvas in bench mode',
      /th-bench-append/.test(page.text) && /th-bench-type/.test(page.text) && /value="__canvas"/.test(page.text) && /preview\/live\?canvas=1/.test(page.text) && /th-canvas-full/.test(page.text));
    const pvLive = await req('POST', '/admin/api/theme/preview', { cookie, body: {} });
    const empty = await req('GET', '/admin/theme/preview/' + pvLive.json.id + '?canvas=1', { cookie });
    check('an empty bench renders the theme chrome around NOTHING (header + footer, no page content, noindex)',
      empty.status === 200 && /class="site-header/.test(empty.text) && /class="site-footer/.test(empty.text) && /<title>קנבס הערכה/.test(empty.text) &&
      /noindex/.test(empty.text) && !/class="bent-cards/.test(empty.text) && /<main id="main" class="main-content">\s*<div class="container">\s*<\/div>/.test(empty.text) && /הקנבס ריק/.test(empty.text));
    const pasted = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'append-source', source: 'בשמחה! הנה:\n```html\n<!DOCTYPE html><html lang="he" dir="rtl"><head><title>x</title></head><body><bent-hero id="h1"><bent-heading level="1">פתיח</bent-heading></bent-hero><bent-cards id="c1" columns="3"></bent-cards></body></html>\n```\nתהנו!' } });
    check('POST canvas append-source takes only the BenTML out of a chat reply → modules on the bench',
      pasted.status === 200 && pasted.json.ok && pasted.json.count === 2 && pasted.json.added === 2 && pasted.json.modules.map((m) => m.type).join(',') === 'hero,cards');
    const addForm = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'add-module', type: 'form' } });
    check('add-module appends a sample module with its label', addForm.json.count === 3 && addForm.json.modules[2].type === 'form' && !!addForm.json.modules[2].label);
    const moved = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'move', id: addForm.json.modules[2].id, dir: 'up' } });
    check('move reorders the bench', moved.json.modules.map((m) => m.type).join(',') === 'hero,form,cards');
    const benchFrame = await req('GET', '/admin/theme/preview/' + pv.json.id + '?canvas=1', { cookie });
    check('the bench renders INSIDE the candidate theme (the AI theme\'s primary + its skin) with the pasted modules',
      benchFrame.status === 200 && /--color-primary: #7c2d12/.test(benchFrame.text) && /class="hero/.test(benchFrame.text) && /class="bent-form/.test(benchFrame.text) && /class="bent-cards/.test(benchFrame.text));
    const promptBench = await req('GET', '/admin/api/theme/design-prompt', { cookie });
    check('the designer prompt lists the modules on the bench for the skin to dress', /המודולים שעל הקנבס/.test(promptBench.text) && /`hero` · `form` · `cards`/.test(promptBench.text));
    const removed = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'remove', id: addForm.json.modules[2].id } });
    check('remove takes a module off the bench', removed.json.count === 2);
    const showcase = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'showcase' } });
    check('showcase fills the bench with the whole toolbox tour (20+ modules)', showcase.json.count >= 20);
    const replaced = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'replace-source', source: '<bent-form id="only"></bent-form>' } });
    check('replace-source swaps the whole bench (a bare fragment is fine)', replaced.json.count === 1 && replaced.json.modules[0].type === 'form');
    const badPaste2 = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'append-source', source: 'no modules here' } });
    check('a paste with no modules → 400 with a plain error, bench untouched', badPaste2.status === 400 && /לא/.test(badPaste2.json.error) && (await req('GET', '/admin/api/theme/canvas', { cookie })).json.count === 1);
    // rows — five modules side by side (Ben: "compete with Elementor")
    const row = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'add-row', count: 5 } });
    const rowMod = row.json.modules[row.json.modules.length - 1];
    check('add-row appends a row of 5 cells', row.status === 200 && rowMod.row === true && rowMod.columns.length === 5 && /5 עמודות/.test(rowMod.label));
    for (let i = 0; i < 5; i++) await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'add-module', type: 'card', rowId: rowMod.id, col: i } });
    const filled = (await req('GET', '/admin/api/theme/canvas', { cookie })).json.modules.find((m) => m.id === rowMod.id);
    check('add-module into each cell → five cards in one row', filled.columns.every((c) => c.length === 1 && c[0].type === 'card'));
    const cellPaste = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'append-source', source: '<bent-form id="pf"></bent-form>', rowId: rowMod.id, col: 4 } });
    check('append-source into a cell lands the pasted module in that cell', cellPaste.json.modules.find((m) => m.id === rowMod.id).columns[4].map((x) => x.type).join('+') === 'card+form');
    const rowFrame = await req('GET', '/admin/theme/preview/' + pv.json.id + '?canvas=1', { cookie });
    check('the row renders as a columns block with five .col cells, each holding its module',
      rowFrame.status === 200 && (rowFrame.text.match(/<div class="col">/g) || []).length >= 5 && /class="columns cols-n-5[^"]*"[^>]*>(?:\s*<div class="col"><div class="card bent-card)/.test(rowFrame.text));
    const rmInCell = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'remove', id: filled.columns[0][0].id } });
    check('remove reaches inside a cell', rmInCell.json.modules.find((m) => m.id === rowMod.id).columns[0].length === 0);
    const rowCap = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'add-row', count: 40 } });
    check('a row is capped at 6 cells', rowCap.json.modules[rowCap.json.modules.length - 1].columns.length === 6);
    const badCell = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'add-module', type: 'card', rowId: rowMod.id, col: 9 } });
    check('a cell that does not exist → 400', badCell.status === 400);
    check('the studio page offers the row control (2–6 columns)', /th-bench-row/.test(page.text) && /th-bench-cols/.test(page.text) && /value="6"/.test(page.text));
    // row settings (v2.26): ratio per cell, width, gap, valign, collapse, cells
    const rowSet = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'set-row', id: rowMod.id, ratio: '2:1:1:1:1', width: 'wide', gap: 'lg', valign: 'stretch', collapse: 'never' } });
    const rowNow = rowSet.json.modules.find((m) => m.id === rowMod.id);
    check('set-row stores ratio/width/gap/valign/collapse on the row', rowSet.status === 200 && rowNow.ratio === '2:1:1:1:1' && rowNow.width === 'wide' && rowNow.gap === 'lg' && rowNow.valign === 'stretch' && rowNow.collapse === 'never');
    const badRatio = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'set-row', id: rowMod.id, ratio: '2:1' } });
    check('a ratio with the wrong number of parts → 400 naming the count', badRatio.status === 400 && /5 חלקים/.test(badRatio.json.error));
    const rowFrame2 = await req('GET', '/admin/theme/preview/' + pv.json.id + '?canvas=1', { cookie });
    check('the bench renders the row with its classes and fractions', /class="columns cols-n-5 cols-ratio gap-lg collapse-never valign-stretch cols-wide"/.test(rowFrame2.text) && /--cols:2fr 1fr 1fr 1fr 1fr/.test(rowFrame2.text));
    check('the bench is a BenTML document on disk (config/theme-canvas.bent), the row as <bent-columns …>',
      fs.existsSync(path.join(ROOT, 'config', 'theme-canvas.bent')) && /<bent-columns id="[^"]+" [^>]*ratio="2:1:1:1:1"[^>]*width="wide"/.test(fs.readFileSync(path.join(ROOT, 'config', 'theme-canvas.bent'), 'utf8')) && !fs.existsSync(path.join(ROOT, 'config', 'theme-canvas.json')));
    check('GET canvas returns the source, the row enums and the cell cap', typeof rowSet.json.source === 'string' && /<bent-columns/.test(rowSet.json.source) && (await req('GET', '/admin/api/theme/canvas', { cookie })).json.maxCols === 6);
    const shrink = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'set-row', id: rowMod.id, cells: 3 } });
    check('shrinking past a full cell is refused', shrink.status === 400 && /לצמצם/.test(shrink.json.error));
    const cleared = await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'clear' } });
    check('clear → a canvas of nothing again', cleared.json.count === 0);
    check('the bench never became a site page', !(await req('GET', '/admin/api/theme', { cookie })).text.includes('__theme-canvas') && !fs.existsSync(path.join(ROOT, 'public', '__theme-canvas.html')));
    check('the bench lives beside the theme, not inside it (config/theme-canvas.bent, not in overrides)',
      fs.existsSync(path.join(ROOT, 'config', 'theme-canvas.bent')) && !('canvas' in (await req('GET', '/admin/api/theme', { cookie })).json.overrides));

    // ── 8. the .bent format end to end: a bent reply with a canvas → preview, library, bench, export ──
    const pvBent = await req('POST', '/admin/api/theme/preview', { cookie, body: { reply: '```html\n' + bentDoc + '\n```', bench: true } });
    check('POST preview with a bent reply carrying a canvas → the candidate brings its own bench',
      pvBent.status === 200 && pvBent.json.ok && pvBent.json.name === 'פריז' && pvBent.json.benchModules === 3);
    const frameBent = await req('GET', '/admin/theme/preview/' + pvBent.json.id + '?canvas=1', { cookie });
    check('the candidate\'s own bench renders in its theme, saved nowhere', /class="columns cols-n-2 cols-ratio cols-wide"/.test(frameBent.text) && /class="bent-form/.test(frameBent.text) && (await req('GET', '/admin/api/theme/canvas', { cookie })).json.count === 0);
    const pasteBent = await req('POST', '/admin/api/theme/design/paste', { cookie, body: { reply: bentDoc, bench: true } });
    check('design/paste with bench:true → library entry (bent) AND the bench replaced by the AI\'s canvas',
      pasteBent.status === 200 && pasteBent.json.parts.bent === true && pasteBent.json.hasSpecimen === true && pasteBent.json.benchCount === 3 && (await req('GET', '/admin/api/theme/canvas', { cookie })).json.count === 3);
    const libBent = await req('GET', '/admin/api/theme/library/export.bent?id=' + pasteBent.json.id, { cookie });
    check('GET library/export.bent → the entry as a .bent document with its canvas', libBent.status === 200 && /attachment; filename="tapuz-theme-[0-9-]+\.bent"/.test(libBent.headers['content-disposition'] || '') && /<bent-theme name="פריז"/.test(libBent.text) && /<bent-canvas>/.test(libBent.text));
    const liveBent = await req('GET', '/admin/api/theme/export.bent', { cookie });
    check('GET export.bent → the live theme as .bent, the studio bench inside bent-canvas', liveBent.status === 200 && /<bent-theme /.test(liveBent.text) && /<bent-canvas>[\s\S]*<bent-form/.test(liveBent.text));
    check('export.bent?canvas=0 leaves the bench out', !/<bent-canvas>/.test((await req('GET', '/admin/api/theme/export.bent?canvas=0', { cookie })).text));
    const impBent = await req('POST', '/admin/api/theme/import', { cookie, body: { text: 'From a friend:\n' + liveBent.text.replace('name="', 'name="מיובא ') } });
    check('POST import with a .bent (prose around it) → applied, bench filled from its canvas', impBent.status === 200 && impBent.json.ok && impBent.json.benchCount === 3);
    const libImpBent = await req('POST', '/admin/api/theme/library/import', { cookie, body: { text: liveBent.text } });
    check('POST library/import with a .bent → an entry that keeps its canvas', libImpBent.status === 200 && /<bent-canvas>/.test((await req('GET', '/admin/api/theme/library/export.bent?id=' + libImpBent.json.id, { cookie })).text));
    await req('POST', '/admin/api/theme/canvas', { cookie, body: { op: 'clear' } });
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE THEME-STUDIO: FAIL' : 'SMOKE THEME-STUDIO: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
