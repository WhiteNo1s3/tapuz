'use strict';

/**
 * v2.22 QA — theme EFFECTS + the FRESH-chat snippet flow.
 *
 * Ben's spec: "in the theme builder we can make a custom mouse snippet for
 * LLMs… and then we get the answer from FRESH (and it needs to be noted)."
 * Proves: effects live INSIDE overrides (so they ride packages + the theme
 * library with zero extra plumbing), the effect CSS ships through
 * overridesToCss on BOTH the serve and export paths, the effect JS survives
 * the export's style-strip, the generated prompt demands a FRESH chat in its
 * first line, and the paste-back extracts fences robustly.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-theme-fx-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const theme = require('../src/theme');

// ── effects are part of the overrides shape ──────────────────────────
check('DEFAULT_OVERRIDES carries the effects slot',
  theme.DEFAULT_OVERRIDES.effects && 'css' in theme.DEFAULT_OVERRIDES.effects && 'js' in theme.DEFAULT_OVERRIDES.effects);

const FX_CSS = '.tapuz-fx-dot{position:fixed;pointer-events:none;background:#ea580c}';
const FX_JS = "(function(){document.addEventListener('DOMContentLoaded',function(){/* עקבת עכבר */});})();";
theme.saveOverrides({ colors: { primary: '#ea580c' }, effects: { css: FX_CSS, js: FX_JS, note: 'עקבת עכבר' } });
check('effects round-trip through saveOverrides/loadOverrides',
  theme.loadOverrides().effects.css === FX_CSS && theme.loadOverrides().effects.js === FX_JS);

// ── CSS ships through overridesToCss (serve AND export both funnel here) ──
const css = theme.overridesToCss(theme.loadOverrides());
check('overridesToCss appends the effect css LAST', css.indexOf(FX_CSS) > css.indexOf(':root'));
check('no effect → no effects marker',
  theme.overridesToCss({ effects: { css: '', js: '' } }).indexOf('theme effects') === -1);

// ── JS script tag ────────────────────────────────────────────────────
const tag = theme.renderThemeEffectsJs(theme.loadOverrides());
check('effect js renders as an identified script tag',
  tag.indexOf('<script id="tapuz-theme-effects">') === 0 && tag.indexOf(FX_JS) !== -1);
check('no effect js → empty string', theme.renderThemeEffectsJs({ effects: { js: '' } }) === '');
check('</script> inside the payload cannot end the tag early',
  theme.renderThemeEffectsJs({ effects: { js: "var a='</script>';" } }).indexOf("<\\/script>") !== -1);

// ── the served page carries both; the export keeps the JS ────────────
const { renderPage } = require('../src/renderer');
const html = renderPage({
  title: 'דף אפקט', slug: 'fx', full_path: 'fx', direction: 'rtl', status: 'published',
  tags: [], meta: {}, blocks: [{ id: 't1', type: 'text', data: { content: 'שלום' } }]
}, { siteTitle: 'אתר' });
check('served page carries the effect css', html.indexOf(FX_CSS) !== -1);
check('served page carries the effect js', html.indexOf('tapuz-theme-effects') !== -1 && html.indexOf(FX_JS) !== -1);

const { externalizeStyles, copyThemeAssets } = require('../src/export');
const exported = externalizeStyles(html);
check('export strips inline styles but the effect JS survives',
  exported.indexOf('tapuz-theme-overrides') === -1 && exported.indexOf(FX_JS) !== -1);
copyThemeAssets('default');
const mainCss = fs.readFileSync(path.join(ROOT, 'public', 'css', 'main.css'), 'utf8');
check('exported css/main.css carries the effect css', mainCss.indexOf(FX_CSS) !== -1);

// ── effects ride packages and the library ────────────────────────────
const pkg = theme.exportThemePackage('עם אפקט');
check('theme package carries the effect', pkg.overrides.effects.css === FX_CSS);
const lib = require('../src/theme-library');
const entry = lib.saveCurrentAsTheme('ערכה עם אפקט');
theme.saveOverrides({ effects: { css: '', js: '', note: '' } });
lib.applyTheme(entry.id);
check('a library apply restores the effect with the theme',
  theme.loadOverrides().effects.js === FX_JS);

// ── the mounted route surface: prompt + paste ────────────────────────
const express = require('express');
const http = require('http');
const app = express();
app.use(express.json());
app.use(require('../src/routes/theme'));
const server = app.listen(0, () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const req = (method, p, body) => new Promise((resolve, reject) => {
    const r = http.request(base + p, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let s = '';
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });

  (async () => {
    const p = await req('GET', '/admin/api/theme/effects-prompt?brief=' + encodeURIComponent('עקבת עכבר כתומה'));
    check('effects prompt → 200', p.status === 200);
    check('the FRESH requirement is the prompt\'s FIRST LINE (Ben: "it needs to be noted")',
      p.body.split('\n')[0].indexOf('FRESH') !== -1 && p.body.indexOf('צ׳אט חדש') !== -1);
    check('prompt forbids libraries/CDN and demands a self-contained IIFE',
      /Vanilla/.test(p.body) && /IIFE/.test(p.body) && /DOMContentLoaded/.test(p.body));
    check('prompt respects reduced-motion and RTL', /prefers-reduced-motion/.test(p.body) && /RTL/.test(p.body));
    check('prompt embeds the owner\'s brief', p.body.indexOf('עקבת עכבר כתומה') !== -1);
    check('prompt contracts the exact reply format (css+js fences, nothing around)',
      p.body.indexOf('```css') !== -1 && p.body.indexOf('```js') !== -1);

    const reply = 'Sure! Here you go:\n```css\n.fx{cursor:none}\n```\nand the script:\n```javascript\n(function(){})();\n```\nEnjoy!';
    const paste = await req('POST', '/admin/api/theme/effects/paste', { reply, note: 'בדיקה' });
    check('paste extracts css + js fences (javascript alias too)',
      paste.status === 200 && JSON.parse(paste.body).cssChars > 0 && JSON.parse(paste.body).jsChars > 0);
    const cur = require('../src/theme').loadOverrides().effects;
    check('pasted effect is now the live effect', cur.css === '.fx{cursor:none}' && cur.js === '(function(){})();' && cur.note === 'בדיקה');

    const bad = await req('POST', '/admin/api/theme/effects/paste', { reply: 'no fences here at all' });
    check('a fence-less paste → 400 with FRESH guidance',
      bad.status === 400 && JSON.parse(bad.body).error.indexOf('FRESH') !== -1);

    const clear = await req('POST', '/admin/api/theme/effects', { css: '', js: '', note: '' });
    check('manual clear empties the effect',
      clear.status === 200 && require('../src/theme').loadOverrides().effects.css === '');

    server.close();
    console.log(fail ? '\nSMOKE THEME-EFFECTS: FAIL' : '\nSMOKE THEME-EFFECTS: PASS');
    process.exit(fail ? 1 : 0);
  })().catch((e) => {
    console.log('FAIL route surface threw: ' + e.message);
    server.close();
    process.exit(1);
  });
});
