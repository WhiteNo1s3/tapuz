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
check('chrome.headerText colors the header, logo and menu links',
  /\.site-header, \.site-header \.site-logo, \.site-header \.main-nav a, \.site-header \.site-tagline \{ color: #ffffff; \}/.test(theme.overridesToCss({ chrome: { headerText: '#ffffff' } })));
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

// ── 2. the designer prompt ───────────────────────────────────────────
const { buildThemePrompt, moduleRoots } = require('../src/theme-roleplay');
const pack = buildThemePrompt({ brief: 'חנות פרחים וינטג׳ פריזאית', siteTitle: 'נועה', description: 'פרחים' });
check('the prompt\'s FIRST LINE demands a FRESH chat', pack.text.split('\n')[0].indexOf('FRESH') !== -1);
check('the prompt casts the model as the theme designer in a roleplay', /מעצב\/ת ערכות הנושא/.test(pack.text) && /Roleplay/.test(pack.text));
check('the prompt teaches the JSON knobs, the font shelf, the skeleton and the css variables',
  /"background": \{ "kind": "solid\|gradient\|glow\|dots\|grid\|lines"/.test(pack.text) && pack.text.indexOf('Frank Ruhl Libre') !== -1 &&
  pack.text.indexOf('`.site-header`') !== -1 && pack.text.indexOf('--accent-bg') !== -1 && pack.text.indexOf('.bent-card') !== -1);
check('the module roots come from the real theme css', moduleRoots().length >= 30 && moduleRoots().includes('.bent-card'));
check('the prompt contracts exactly three fences (json, css, js) and no prose', /```json/.test(pack.text) && /```css/.test(pack.text) && /```js/.test(pack.text) && /שלושה fences/.test(pack.text));
check('the prompt embeds the site, RTL, contrast and no-external rules', pack.text.indexOf('**נועה**') !== -1 && /RTL/.test(pack.text) && /4\.5/.test(pack.text) && /CDN/.test(pack.text));
check('the prompt embeds the brief and ends on "design it now"', pack.text.indexOf('חנות פרחים וינטג׳ פריזאית') !== -1 && /עצב\/י את זה עכשיו/.test(pack.text));
const packCur = buildThemePrompt({ current: { colors: { primary: '#123456' }, skin: { css: '.x{top:0}' } } });
check('with current=1 the prompt carries the live knobs and skin as the starting point',
  packCur.text.indexOf('"primary": "#123456"') !== -1 && packCur.text.indexOf('.x{top:0}') !== -1 && /נקודת המוצא/.test(packCur.text));
check('without a brief the prompt asks for a one-line "ready"', /המשחק מתחיל עכשיו/.test(packCur.text));
check('the pack fits a chat message (< 16K chars)', pack.chars < 16000);

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

    const page = await req('GET', '/admin/theme', { cookie });
    check('GET /admin/theme → the studio: designer card, canvas iframe, looks, skin, file import',
      page.status === 200 && /th-design-card/.test(page.text) && /<iframe id="th-canvas"/.test(page.text) && /th-looks/.test(page.text) &&
      /th-skin-css/.test(page.text) && /th-import-file/.test(page.text) && /th-font-google/.test(page.text) && /th-bg-kind/.test(page.text));

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
