'use strict';

/**
 * v0.60 QA — the nav module (batch item 2: page-level navigation with COLOR
 * options). Round-trip, compile/render parity via the shared nav-html.js, the
 * CSS color-breakout guard (safeCssColor), safeHref on links, align fallback,
 * and the decompiler loop (<nav> → nav block).
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const { htmlToBlocks } = require('../src/pzn/graduate');
const { safeCssColor } = require('../src/pzn/nav-html');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'nav', id: 'n1',
    data: {
      background: '#0a66c2', color: '#ffffff', align: 'center',
      items: [{ label: 'בית', href: '/' }, { label: 'אודות', href: '/about' }, { label: 'צור קשר', href: '/contact' }]
    }
  }]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const n = back.blocks.find((b) => b.type === 'nav');
check('nav round-trips (3 items + colors + align)',
  n && n.data.items.length === 3 && n.data.background === '#0a66c2' && n.data.color === '#ffffff' && n.data.align === 'center' && n.data.items[1].href === '/about');
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
const rendered = renderBlock(page.blocks[0], 'rtl');
const shapes = [
  ['nav element + align class', /<nav[^>]*class="bent-nav bent-nav-center/],
  ['background color', /background:#0a66c2/],
  ['text color css var', /--bent-nav-color:#ffffff/],
  ['nav link', /<a class="bent-nav-link" href="\/about">אודות/]
];
for (const [nm, re] of shapes) {
  check('compile: ' + nm, re.test(compiled));
  check('render: ' + nm, re.test(rendered));
}

// ── security: CSS color breakout stripped ────────────────────────────
check('safeCssColor strips CSS breakout chars', !/[;{}:"]/.test(safeCssColor('red;}body{color:blue}')));
check('safeCssColor keeps valid colors', safeCssColor('#0a66c2') === '#0a66c2' && safeCssColor('rgb(10,20,30)') === 'rgb(10,20,30)');
const evilNav = renderBlock({ type: 'nav', id: 'e', data: { background: '#fff;position:fixed;top:0', color: 'red}', items: [{ label: 'x', href: 'javascript:alert(1)' }] } }, 'rtl');
check('no CSS breakout survives into the rendered style', !/;position:fixed/.test(evilNav) && !/[{}]/.test((evilNav.match(/style="[^"]*"/) || [''])[0]));
check('javascript: href stripped on a nav link', !/javascript:/i.test(evilNav));

// ── align fallback + seed ────────────────────────────────────────────
check('unknown align falls back to start', /bent-nav-start/.test(renderBlock({ type: 'nav', id: 'a', data: { items: [{ label: 'x', href: '/' }] } }, 'rtl')));
// regression: align + colors must merge into ONE style attr (two would let the
// browser drop the colors)
check('single merged style attr (no duplicate style="")',
  (rendered.match(/style="/g) || []).length === 1 && /text-align:center;background:#0a66c2/.test(rendered));
check('nav registry entry + seeded items', !!getBlockDef('nav') && (defaultDataFor('nav').items || []).length >= 1);

// ── decompile loop closed ────────────────────────────────────────────
const g = htmlToBlocks('<nav><a href="/a">A</a><a href="/b">B</a></nav>');
const gn = g.blocks.find((b) => b.type === 'nav');
check('decompile <nav> → nav block with links', gn && gn.data.items.length === 2 && gn.data.items[0].label === 'A' && gn.data.items[0].href === '/a');
check('nav is no longer a toolGap', !g.suggestedTools.includes('nav'));

console.log('');
console.log(fail ? 'SMOKE NAV: FAIL' : 'SMOKE NAV: PASS');
process.exit(fail ? 1 : 0);
