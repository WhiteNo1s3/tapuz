'use strict';

/**
 * v0.52 QA — the page "splash" background (parallax on scroll).
 * Proves the injected CSS is correct, the image URL is CSS-escaped (no
 * breakout), parallax uses a fixed layer with a touch fallback, and a
 * non-parallax bg scrolls with the page.
 */

const { pageBackgroundStyle } = require('../src/renderer');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// parallax photo + overlay
let r = pageBackgroundStyle({ image: '/uploads/hero.jpg', overlay: 40, parallax: true });
check('emits a <style> + body class', /<style id="tapuz-page-bg">/.test(r.css) && r.bodyClass === 'tapuz-page-bg');
check('parallax → fixed layer', /position:fixed/.test(r.css));
check('image present via url()', /url\('\/uploads\/hero\.jpg'\)/.test(r.css));
check('overlay rgba(0,0,0,0.40)', /rgba\(0,0,0,0\.40\)/.test(r.css));
check('touch fallback pins the layer', /pointer:coarse/.test(r.css) && /position:absolute/.test(r.css));

// non-parallax → scrolls with the page (absolute, no fixed)
r = pageBackgroundStyle({ image: '/x.jpg', parallax: false });
check('non-parallax uses absolute (not fixed)', /position:absolute/.test(r.css) && !/position:fixed/.test(r.css));

// colour-only
r = pageBackgroundStyle({ color: '#0a1a2f' });
check('colour-only sets background-color', /background-color:#0a1a2f/.test(r.css) && !/url\(/.test(r.css));

// empty → nothing
check('no image/colour → empty', pageBackgroundStyle({}).css === '' && pageBackgroundStyle(null).css === '' && pageBackgroundStyle(undefined).css === '');

// SECURITY: an attacker image URL cannot break out of url('...')
r = pageBackgroundStyle({ image: "a.jpg');}body{background:red}//" });
const urlPart = (r.css.match(/url\((.*?)\)/) || [])[0] || '';
// the closing quote is only the FINAL one — inner quote/paren are hex-escaped
check("image url cannot terminate early (quote/paren escaped)", /\\27/.test(urlPart) && /\\29/.test(urlPart));
check('no active background:red rule leaked outside url()', !/;background:red}/.test(r.css.replace(urlPart, '')));

// SECURITY: colour value strips CSS breakout chars
r = pageBackgroundStyle({ color: 'red;}body{display:none' });
check('colour breakout stripped', !/display:none/.test(r.css) && !/}/.test(r.css.replace('<style id="tapuz-page-bg">', '').replace(/<\/style>$/, '').replace(/\{[^}]*\}/g, '')));

// overlay clamped
r = pageBackgroundStyle({ image: '/x.jpg', overlay: 999 });
check('overlay clamped to ≤ 0.85', /rgba\(0,0,0,0\.85\)/.test(r.css));

// REGRESSION: static export strips theme <style> but MUST keep the page-bg one
// (it can't live in the shared /css/main.css). This bug shipped a body class
// with no style until caught by checking the actual exported file.
const { externalizeStyles } = require('../src/export');
const rendered =
  '<html><head><style>body{color:red}</style>' +
  '<style id="tapuz-theme-overrides">a{}</style>' +
  '<style id="tapuz-page-bg">body.tapuz-page-bg::before{background-image:url(\'/s.jpg\')}</style>' +
  '</head><body class="tapuz-page-bg"></body></html>';
const exported = externalizeStyles(rendered);
check('export drops the theme <style>', !/color:red/.test(exported));
check('export keeps the page-bg <style>', /<style id="tapuz-page-bg">/.test(exported) && /\/s\.jpg/.test(exported));
check('export links /css/main.css', /href="\/css\/main\.css"/.test(exported));

console.log('');
console.log(fail ? 'SMOKE PAGE-BG: FAIL' : 'SMOKE PAGE-BG: PASS');
process.exit(fail ? 1 : 0);
