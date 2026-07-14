'use strict';

/**
 * v0.59 QA — the card grid (the walla lesson: a content site is a wall of media
 * cards). Round-trips block⇄BenTML, validates, proves compile ⇄ renderer parity
 * (shared card-html.js), the no-href→<article> fallback, and the safeHref guard
 * on image + link (no javascript:).
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const { renderCard } = require('../src/pzn/card-html');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'cards', id: 'c1',
    data: {
      items: [
        { image: '/a.jpg', tag: 'חדשות', title: 'כותרת א', excerpt: 'תקציר א', href: '/a' },
        { image: '/b.jpg', tag: 'ספורט', title: 'כותרת ב', excerpt: 'תקציר ב', href: '/b' }
      ]
    }
  }]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const c = back.blocks.find((b) => b.type === 'cards');
check('cards round-trips (2 items, all fields)',
  c && c.data.items.length === 2 && c.data.items[0].title === 'כותרת א' && c.data.items[0].tag === 'חדשות' && c.data.items[1].href === '/b');
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
const rendered = renderBlock(page.blocks[0], 'rtl');
const shapes = [
  ['responsive grid wrapper', /<div[^>]*class="bent-cards"/],
  ['card link', /<a class="bent-card" href="\/a">/],
  ['card image lazy', /<img src="\/a.jpg"[^>]*loading="lazy"/],
  ['card tag', /bent-card-tag">חדשות/],
  ['card title h3', /<h3 class="bent-card-title">כותרת א/],
  ['card excerpt', /bent-card-excerpt">תקציר א/]
];
for (const [name, re] of shapes) {
  check('compile: ' + name, re.test(compiled));
  check('render: ' + name, re.test(rendered));
}

check('card without href renders <article> (not a dead link)',
  /<article class="bent-card">/.test(renderBlock({ type: 'cards', id: 'x', data: { items: [{ title: 't' }] } }, 'rtl')));

// security
const evil = renderBlock({ type: 'cards', id: 'e', data: { items: [{ image: 'javascript:alert(1)', href: 'javascript:alert(2)', title: 'x' }] } }, 'rtl');
check('javascript: image + href stripped', !/javascript:/i.test(evil));
check('title escaped (no raw markup)',
  !/<script>/i.test(renderCard({ title: '<script>bad</script>' })) && /&lt;script&gt;/.test(renderCard({ title: '<script>bad</script>' })));

check('registry seed present', !!getBlockDef('cards') && (defaultDataFor('cards').items || []).length >= 1);

console.log('');
console.log(fail ? 'SMOKE CARDS: FAIL' : 'SMOKE CARDS: PASS');
process.exit(fail ? 1 : 0);
