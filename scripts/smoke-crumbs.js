'use strict';

/**
 * QA — breadcrumbs (bent-crumbs / CRUMBS). CSS-only trail, decompiler
 * maps <nav aria-label="breadcrumb"> and classed ol.breadcrumb.
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const bentml = require('../src/bentml');
const { htmlToBlocks } = require('../src/pzn/graduate');
const { huntBlocks } = require('../src/pzn/hunt');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'crumbs', id: 'c1',
    data: {
      items: [
        { label: 'בית', url: '/' },
        { label: 'מאמרים', url: '/articles' },
        { label: 'הדף הזה' }
      ]
    }
  }]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const cr = back.blocks.find((b) => b.type === 'crumbs');
check('crumbs round-trips (3 crumbs)', cr && cr.data.items.length === 3);
check('last crumb has no invented url', cr.data.items[2].label === 'הדף הזה' && !cr.data.items[2].url);
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
const rendered = renderBlock(page.blocks[0], 'rtl');
check('compile: bent-crumbs nav', /class="bent-crumbs/.test(compiled) && /aria-label="breadcrumb"/.test(compiled));
check('render: bent-crumbs nav', /class="bent-crumbs/.test(rendered));
check('last crumb is aria-current, not a link', /aria-current="page"/.test(rendered) && !/href="[^"]*">הדף הזה/.test(rendered));
check('javascript: url neutralized', !/javascript:/i.test(renderBlock({
  type: 'crumbs', id: 'e', data: { items: [{ label: 'x', url: 'javascript:alert(1)' }, { label: 'now' }] }
}, 'rtl')));
check('label is HTML-escaped', /&lt;script&gt;/.test(renderBlock({
  type: 'crumbs', id: 'e2', data: { items: [{ label: '<script>x</script>', url: '/' }, { label: 'b' }] }
}, 'rtl')));
check('no <script> in output', !/<script/i.test(rendered));
check('registry + seed', !!getBlockDef('crumbs') && (defaultDataFor('crumbs').items || []).length >= 2);
check('empty crumbs renders wrapper', /class="bent-crumbs"[^>]*>/.test(renderBlock({ type: 'crumbs', id: 'z', data: { items: [] } }, 'rtl')));

const legacy = bentml.compile(`BENTML 0.2

META {
  title: "פירורים"
}

CRUMBS {
  CRUMB(url: "/") { בית }
  CRUMB(url: "/a") { מדור }
  CRUMB { כאן }
}
`);
check('legacy BentML compiles CRUMBS', legacy.blocks[0] && legacy.blocks[0].type === 'crumbs' && legacy.blocks[0].data.items.length === 3);
const src = bentml.decompile({ title: 'x' }, [page.blocks[0]]);
check('legacy decompile emits CRUMBS/CRUMB', /CRUMBS/.test(src) && /CRUMB\(/.test(src));
const round = bentml.compile(src);
check('legacy crumbs decompile → recompile', round.blocks[0].type === 'crumbs' && round.blocks[0].data.items[0].label === 'בית');

const ariaNav = htmlToBlocks(`
  <nav aria-label="breadcrumb">
    <ol>
      <li><a href="/">Home</a></li>
      <li><a href="/shop">Shop</a></li>
      <li><span>Item</span></li>
    </ol>
  </nav>
`);
const ariaB = ariaNav.blocks.find((b) => b.type === 'crumbs');
check('decompile <nav aria-label="breadcrumb"> → crumbs, not nav',
  !!ariaB && ariaB.data.items.length === 3 && ariaB.data.items[0].url === '/'
  && ariaB.data.items[2].label === 'Item' && !ariaNav.blocks.some((b) => b.type === 'nav'));

const classedOl = htmlToBlocks(
  '<ol class="breadcrumb"><li><a href="/">בית</a></li><li><a href="/x">עוד</a></li><li>כאן</li></ol>'
);
check('decompile <ol class="breadcrumb"> → crumbs',
  classedOl.blocks.some((b) => b.type === 'crumbs' && b.data.items.length === 3));

const plainNav = htmlToBlocks('<nav><a href="/a">A</a><a href="/b">B</a></nav>');
check('plain <nav> stays a nav, not crumbs',
  plainNav.blocks.some((b) => b.type === 'nav') && !plainNav.blocks.some((b) => b.type === 'crumbs'));

const hunted = huntBlocks(`
  <nav class="breadcrumbs">
    <a href="/">Home</a>
    <a href="/docs">Docs</a>
    <span>This page</span>
  </nav>
`);
check('hunt maps classed breadcrumbs nav → crumbs',
  (hunted.blocks || []).some((b) => b.type === 'crumbs' && (b.data.items || []).length >= 2));

console.log('');
console.log(fail ? 'SMOKE CRUMBS: FAIL' : 'SMOKE CRUMBS: PASS');
process.exit(fail ? 1 : 0);
