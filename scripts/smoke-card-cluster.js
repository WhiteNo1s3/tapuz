'use strict';

/**
 * v0.65 QA — decompiler card-cluster recognition (the walla lesson, deferred
 * from v0.59). Repeated img+heading+link siblings become ONE `cards` block
 * with mediacard items. The negatives matter as much as the positives: menus
 * stay lists, galleries stay images, hero sections stay sections — and when
 * detection declines, the normal walk still maps everything (nothing lost).
 */

const { htmlToBlocks } = require('../src/pzn/graduate');
const pzn = require('../src/pzn/index');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}
const cardsOf = (g) => g.blocks.find((b) => b.type === 'cards');
const types = (g) => g.blocks.map((b) => b.type).join(',');

// ── positives ────────────────────────────────────────────────────────
// walla's actual shape: ul>li>a with a lazy-loaded image + h3 + excerpt
const wall = htmlToBlocks(
  '<ul>' +
  '<li><a href="/a1"><img data-src="/1.jpg"><h3>כותרת אחת</h3><p>תקציר קצר</p></a></li>' +
  '<li><a href="/a2"><img src="/2.jpg"><h3>כותרת שתיים</h3></a></li>' +
  '<li><a href="/a3"><img src="/3.jpg"><h3>כותרת שלוש</h3></a></li>' +
  '</ul>');
const w = cardsOf(wall);
check('ul>li card wall → ONE cards block (3 items)', w && w.data.items.length === 3 && !wall.blocks.some((b) => b.type === 'list'));
check('item carries title+image+excerpt+href', (() => {
  const it = w.data.items[0];
  return it.title === 'כותרת אחת' && it.image === '/1.jpg' && it.excerpt === 'תקציר קצר' && it.href === '/a1';
})());
check('lazy data-src resolved to the image', w.data.items[0].image === '/1.jpg');

// figure+h3+a articles inside a grid wrapper (the census shape); 2 articles is enough
const arts = htmlToBlocks(
  '<div class="grid">' +
  '<article><figure><img src="/1.jpg"></figure><h3>אחת</h3><a href="/x1">עוד</a></article>' +
  '<article><figure><img src="/2.jpg"></figure><h3>שתיים</h3><a href="/x2">עוד</a></article>' +
  '</div>');
check('article cluster in a wrapper → cards', cardsOf(arts) && cardsOf(arts).data.items.length === 2);
check('a recognized cluster does not also suggest columns', !arts.suggestedTools.includes('columns'));

// bare top-level <a class="card"> siblings (no wrapper at all)
const bare = htmlToBlocks('<a class="card" href="/p1"><img src="/1.jpg"><h4>ראשון</h4></a><a class="card" href="/p2"><img src="/2.jpg"><h4>שני</h4></a>');
check('bare top-level a-cards → cards', cardsOf(bare) && cardsOf(bare).data.items[1].href === '/p2');

// a kicker span with a taggy class becomes the card tag
const tagged = htmlToBlocks(
  '<div>' +
  '<div class="c"><img src="/1.jpg"><span class="kicker">ספורט</span><h3>אחת</h3><a href="/1">עוד</a></div>' +
  '<div class="c"><img src="/2.jpg"><h3>שתיים</h3><a href="/2">עוד</a></div>' +
  '<div class="c"><img src="/3.jpg"><h3>שלוש</h3><a href="/3">עוד</a></div>' +
  '</div>');
check('span.kicker → card tag', cardsOf(tagged) && cardsOf(tagged).data.items[0].tag === 'ספורט');

// ── negatives (the guards) ───────────────────────────────────────────
const menu = htmlToBlocks('<ul><li><a href="/">בית</a></li><li><a href="/about">אודות</a></li><li><a href="/contact">קשר</a></li></ul>');
check('text-only menu ul STAYS a list', !cardsOf(menu) && menu.blocks.some((b) => b.type === 'list' && b.data.items.length === 3));

const gallery = htmlToBlocks('<div><figure><img src="/1.jpg"></figure><figure><img src="/2.jpg"></figure><figure><img src="/3.jpg"></figure></div>');
check('gallery (no headings) is NOT cards', !cardsOf(gallery) && gallery.blocks.filter((b) => b.type === 'image').length === 3);

const long = 'טקסט ארוך מאוד '.repeat(40);
const heroes = htmlToBlocks(
  '<section><h2>הירו אחד</h2><img src="/1.jpg"><p>' + long + '</p><a href="/cta1">קנו</a></section>' +
  '<section><h2>הירו שניים</h2><img src="/2.jpg"><p>' + long + '</p><a href="/cta2">קנו</a></section>');
check('hero sections never collapse into a card grid (' + types(heroes) + ')', !cardsOf(heroes) && heroes.blocks.some((b) => b.type === 'heading'));

const twoDivs = htmlToBlocks('<div><div class="c"><img src="/1.jpg"><h3>אחת</h3><a href="/1">ע</a></div><div class="c"><img src="/2.jpg"><h3>שתיים</h3><a href="/2">ע</a></div></div>');
check('2 generic divs are below the threshold → normal walk', !cardsOf(twoDivs) && twoDivs.blocks.some((b) => b.type === 'heading'));

const mixed = htmlToBlocks('<div><article><img src="/1.jpg"><h3>א</h3><a href="/1">ע</a></article><div><img src="/2.jpg"><h3>ב</h3><a href="/2">ע</a></div><li><img src="/3.jpg"><h3>ג</h3><a href="/3">ע</a></li></div>');
check('mixed root tags are a layout, not a cluster', !cardsOf(mixed));
check('declined detection still maps content (nothing lost)', mixed.mapped >= 6);

// ── the decompiled output is valid bridge input (round-trips) ────────
const page = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: wall.blocks };
const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const rt = back.blocks.find((b) => b.type === 'cards');
check('decompiled cards round-trip through .pzn (3 items intact)',
  rt && rt.data.items.length === 3 && rt.data.items[2].title === 'כותרת שלוש' && rt.data.items[0].image === '/1.jpg');
check('round-trip validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

console.log('');
console.log(fail ? 'SMOKE CARD-CLUSTER: FAIL' : 'SMOKE CARD-CLUSTER: PASS');
process.exit(fail ? 1 : 0);
