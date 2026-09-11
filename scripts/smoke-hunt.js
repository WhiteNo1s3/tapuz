'use strict';

/**
 * v0.66 QA — decompiler V2: the structure hunt + the safety guard.
 * Proves: rows become columns blocks with a PERCENTAGE cut; heroes collapse
 * to ONE hero block (never hero-in-hero); responsive twins dedupe; empty
 * markup residue is dropped; the lenient tokenizer survives live-site
 * attribute soup; and the strategy race always ships the better read.
 */

const { huntBlocks, colWeight, toPercentages } = require('../src/pzn/hunt');
const { decompileHtml } = require('../src/pzn/decompile');
const pzn = require('../src/pzn/index');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}
const firstOf = (r, type) => r.blocks.find((b) => b.type === type);

// ── the percentage cut ───────────────────────────────────────────────
const boot = huntBlocks(`
  <div class="row">
    <div class="col-md-8"><h2>ראשי</h2><p>תוכן</p></div>
    <div class="col-md-4"><p>צד</p></div>
  </div>`);
const bootCols = firstOf(boot, 'columns');
check('bootstrap col-8/col-4 → columns with 67:33 cut',
  !!bootCols && bootCols.data.ratio === '67:33' && bootCols.data.columns.length === 2);
check('column children mapped inside their half',
  !!bootCols && bootCols.data.columns[0].blocks.some((b) => b.type === 'heading'));

const equal = huntBlocks('<div class="grid"><div><p>א</p></div><div><p>ב</p></div><div><p>ג</p></div></div>');
const equalCols = firstOf(equal, 'columns');
check('row-classed wrapper without width hints → equal split summing to 100',
  !!equalCols && equalCols.data.ratio.split(':').reduce((a, b) => a + Number(b), 0) === 100);

const styled = huntBlocks('<div><div style="width:70%"><p>עיקר</p></div><div style="width:30%"><p>שולי</p></div></div>');
const styledCols = firstOf(styled, 'columns');
check('inline width % → 70:30 even without a row class',
  !!styledCols && styledCols.data.ratio === '70:30');

check('weights → integer percentages (2:1 → 67:33)', toPercentages([2, 1]).join(':') === '67:33');
check('colWeight reads col-lg-6 as a half', colWeight({ attrs: { class: 'col-lg-6' } }) === 0.5);

const notRow = huntBlocks('<div class="row"><div><p>א</p></div>סתם טקסט<div><p>ב</p></div></div>');
check('loose text between children breaks pure-row detection', !firstOf(notRow, 'columns'));

const lonely = huntBlocks('<div class="row"><div><p>יחיד</p></div><div></div></div>');
check('a split with one real column unwraps instead of a fake half',
  !firstOf(lonely, 'columns') && lonely.blocks.some((b) => b.type === 'text'));

// ── heroes collapse (the stripe lesson) ──────────────────────────────
const hero = huntBlocks(`
  <section class="hero-banner">
    <div class="hero-inner">
      <div class="hero">
        <h1>כותרת</h1><p>משנה</p><a href="/go">קדימה</a><img src="/bg.jpg">
      </div>
    </div>
  </section>`);
const heroes = hero.blocks.filter((b) => b.type === 'hero');
check('nested hero-in-hero markup → exactly ONE hero block', heroes.length === 1);
check('hero slots extracted (title/subtitle/button/image)',
  heroes.length === 1 && heroes[0].data.title === 'כותרת' && heroes[0].data.buttonUrl === '/go' && heroes[0].data.image === '/bg.jpg');

const bigHero = huntBlocks('<div class="hero">' +
  [1, 2, 3, 4, 5, 6].map((n) => '<h2>סעיף ' + n + '</h2><p>תוכן ' + n + '</p>').join('') + '</div>');
check('a page-sized hero-classed wrapper descends (shape test declines)',
  !firstOf(bigHero, 'hero') && bigHero.blocks.filter((b) => b.type === 'heading').length >= 2);
check('the declined hero still reports hero on toolGap (not a silent flatten)',
  bigHero.suggestedTools.includes('hero'));

// ── responsive twins dedupe ──────────────────────────────────────────
const twins = huntBlocks(`
  <header class="desktop"><h1>לוגו</h1><nav><a href="/">בית</a><a href="/x">עוד</a></nav></header>
  <div class="mobile-menu"><h1>לוגו</h1><nav><a href="/">בית</a><a href="/x">עוד</a></nav></div>`);
// wave 4: the <header> itself maps to the header module, so its logo + nav
// live INSIDE the band — and the mobile twin's copies are still deduped
// against them (nothing rendered twice at the top level either)
const flat = (blocks) => blocks.flatMap((b) => [b, ...flat((b.data && b.data.blocks) || [])]);
check('desktop+mobile twins → one heading, one nav (inside the mapped header)',
  flat(twins.blocks).filter((b) => b.type === 'heading').length === 1 &&
  flat(twins.blocks).filter((b) => b.type === 'nav').length === 1 &&
  twins.blocks.length === 1 && twins.blocks[0].type === 'header');

// ── residue dropped, nothing real lost ───────────────────────────────
const residue = huntBlocks('<h2>  </h2><img src=""><p>תוכן אמיתי</p><ul><li> </li></ul>');
check('empty heading/image/list dropped, real text kept',
  residue.blocks.length === 1 && residue.blocks[0].type === 'text');

const pic = huntBlocks('<picture><source srcset="/img-large.webp 2x, /img.webp"><img src="/img.jpg" alt="תמונה"></picture>');
check('<picture> → image block', (firstOf(pic, 'image') || { data: {} }).data.src === '/img.jpg');

const cluster = huntBlocks(`<div class="wall">
  <article><img src="/1.jpg"><h3>א</h3><a href="/1">עוד</a></article>
  <article><img src="/2.jpg"><h3>ב</h3><a href="/2">עוד</a></article>
  <article><img src="/3.jpg"><h3>ג</h3><a href="/3">עוד</a></article>
</div>`);
check('card clusters still become ONE cards block inside the hunt (v0.65 kept)',
  cluster.blocks.length === 1 && cluster.blocks[0].type === 'cards' && cluster.blocks[0].data.items.length === 3);

// ── lenient tokenizer (yahoo-class attribute soup) ───────────────────
const soup = huntBlocks('<div data-x="a"b\' ==><h2>שרד</h2></div><p>עוד</p>');
check('attribute soup degrades instead of throwing; content survives',
  soup.blocks.some((b) => b.type === 'heading' && b.data.text === 'שרד'));

// ── the safety guard: strategy race ──────────────────────────────────
const page = `<!DOCTYPE html><html lang="he" dir="rtl"><head><title>מבחן</title></head><body>
  <div class="row"><div class="col-md-6"><h2>ימין</h2><p>תוכן ימני</p></div><div class="col-md-6"><h2>שמאל</h2><p>תוכן שמאלי</p></div></div>
  <div class="a"><h1>כפול</h1></div><div class="b"><h1>כפול</h1></div>
</body></html>`;
const auto = decompileHtml(page);
check('auto picks the hunt on a page with real shape', auto.strategy === 'hunt');
check('both strategies scored and reported',
  Array.isArray(auto.strategies) && auto.strategies.length === 2 && auto.strategies.every((s) => typeof s.score === 'number'));
check('the winning read has the columns block', auto.blocks.some((b) => b.type === 'columns'));
check('winner source serializes + validates clean', (() => {
  try { return pzn.validate(pzn.parse(auto.source), { strict: false }).filter((i) => i.severity === 'error').length === 0; }
  catch (e) { return false; }
})());

const forced = decompileHtml(page, { strategy: 'flat' });
check('strategy can be forced to flat (no columns, still a valid page)',
  forced.strategy === 'flat' && !forced.blocks.some((b) => b.type === 'columns') && forced.blocks.length >= 1);

const scriptOnly = decompileHtml('<html><body><script>app()</script></body></html>');
check('script-only page: guard never crashes, placeholder ships', scriptOnly.blocks.length >= 1);

// ── the cut round-trips through .pzn ─────────────────────────────────
const rt = pzn.toTapuzPage(pzn.parse(auto.source));
const rtCols = (rt.blocks || []).find((b) => b.type === 'columns');
check('percentage cut survives the .pzn round-trip', !!rtCols && String(rtCols.data.ratio) === '50:50');

// ── percent in BenTML source ─────────────────────────────────────────
const bentml = require('../src/bentml');
const compiled = bentml.compile('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nROW(ratio: "70%:30%") {\n  COL {\n    TEXT { a }\n  }\n  COL {\n    TEXT { b }\n  }\n}\n');
const rowBlock = compiled.blocks.find((b) => b.type === 'columns');
check('BenTML accepts ratio "70%:30%" and normalizes to 70:30', !!rowBlock && rowBlock.data.ratio === '70:30');

const huntSwiper = huntBlocks(
  '<div class="swiper"><div class="swiper-wrapper">'
  + '<div class="swiper-slide"><img src="/s1.jpg"><h3>A</h3></div>'
  + '<div class="swiper-slide"><img src="/s2.jpg"><h3>B</h3></div>'
  + '</div></div>'
);
check('hunt: Swiper → carousel',
  !!firstOf(huntSwiper, 'carousel') && firstOf(huntSwiper, 'carousel').data.items.length === 2);

const huntFaq = huntBlocks(
  '<section class="faq"><h3>Q1</h3><p>A1</p><h3>Q2</h3><p>A2</p></section>'
);
check('hunt: classed FAQ heading+p → faq',
  !!firstOf(huntFaq, 'faq') && firstOf(huntFaq, 'faq').data.items[0].question === 'Q1');

const huntPrice = huntBlocks(
  '<div class="pricing">'
  + '<div><h3>Basic</h3><span class="price">$10</span></div>'
  + '<div><h3>Pro</h3><span class="price">$20</span></div>'
  + '</div>'
);
check('hunt: classed pricing → pricing',
  !!firstOf(huntPrice, 'pricing') && firstOf(huntPrice, 'pricing').data.items[1].title === 'Pro');

const huntBgHero = huntBlocks(
  '<section class="hero" style="background-image:url(/bg-hero.jpg)"><h1>Hi</h1><p>There</p></section>'
);
check('hunt: CSS background-image hero keeps the picture',
  !!firstOf(huntBgHero, 'hero') && firstOf(huntBgHero, 'hero').data.image === '/bg-hero.jpg');

const huntStats = huntBlocks(
  '<section class="metrics">'
  + '<div><span class="stat-value">50</span><span class="stat-label">Projects</span></div>'
  + '<div><span class="stat-value">12</span><span class="stat-label">Cities</span></div>'
  + '</section>'
);
check('hunt: classed metrics → stats',
  !!firstOf(huntStats, 'stats') && firstOf(huntStats, 'stats').data.items[1].label === 'Cities');

const huntLogos = huntBlocks(
  '<div class="brands"><img src="/p.svg" alt="P"><img src="/q.svg" alt="Q"></div>'
);
check('hunt: classed brands → logos',
  !!firstOf(huntLogos, 'logos') && firstOf(huntLogos, 'logos').data.items.length === 2);

const huntEmptyStats = huntBlocks('<div class="counters"><em>soon</em></div>');
check('hunt: empty counters still reports stats toolGap',
  !firstOf(huntEmptyStats, 'stats') && huntEmptyStats.suggestedTools.includes('stats'));

const huntPageForm = huntBlocks(
  '<form id="aspnetForm">'
  + '<input type="hidden" name="__VIEWSTATE" value="x"/>'
  + '<h2>A</h2><p>one</p><h2>B</h2><p>two</p><h2>C</h2>'
  + '</form>'
);
check('hunt: page-wrapper form descends to headlines, not leftover html',
  huntPageForm.blocks.filter((b) => b.type === 'heading').length >= 3
  && !huntPageForm.blocks.some((b) => b.type === 'html'));

const huntTime = huntBlocks('<time datetime="2026-01-02T00:00:00Z"></time>');
check('hunt: empty <time datetime> → text',
  !!firstOf(huntTime, 'text') && firstOf(huntTime, 'text').data.content === '2.1.2026');

console.log('');
console.log(fail ? 'SMOKE HUNT: FAIL' : 'SMOKE HUNT: PASS');
process.exit(fail ? 1 : 0);
