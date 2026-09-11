'use strict';

/**
 * QA — gap-audit wave 4: rating / hours / toc / author / compare / flipbox —
 * the rest of the backlog the audit ranked. Each module end to end:
 * registry + seed, render (+ escaping), pzn round-trip, legacy BentML
 * round-trip, and the decompiler mapping the real-world markup that used
 * to flatten. (whatsapp landed separately via #69 — smoke-gap-chrome owns it.)
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const bentml = require('../src/bentml');
const { htmlToBlocks } = require('../src/pzn/graduate');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const FIXTURES = {
  rating: { value: 4.5, max: 5, text: '4.5 מתוך 5 — 213 ביקורות' },
  hours: { items: [{ day: 'ראשון–חמישי', hours: '9:00–19:00' }, { day: 'שישי', hours: '9:00–14:00' }, { day: 'שבת', hours: 'סגור' }] },
  toc: { title: 'תוכן עניינים', items: [{ label: 'הקדמה', anchor: '#intro' }, { label: 'שאלות', anchor: '#faq' }] },
  author: { name: 'דנה לוי', image: '/uploads/dana.jpg', bio: 'כותבת על טכנולוגיה.', url: '/author/dana', linkLabel: 'לכל הכתבות' },
  compare: { before: '/uploads/before.jpg', after: '/uploads/after.jpg', beforeLabel: 'לפני', afterLabel: 'אחרי' },
  flipbox: { title: 'אחריות מלאה', icon: '🛡️', backText: 'שלוש שנות אחריות.', buttonText: 'לפרטים', buttonUrl: '/warranty' }
};

// ── shared: registry + pzn round-trip ──
for (const [type, data] of Object.entries(FIXTURES)) {
  check(`registry + seed: ${type}`, !!getBlockDef(type) && Object.keys(defaultDataFor(type) || {}).length > 0);
  const page = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [{ type, id: type + '_1', data }] };
  const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
  check(`pzn validates clean: ${type}`, pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);
  const back = pzn.toTapuzPage(doc).blocks.find((b) => b.type === type);
  check(`pzn round-trips: ${type}`, !!back);
  if (back && data.items) check(`pzn keeps all items: ${type}`, (back.data.items || []).length === data.items.length);
}
{
  const page = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [{ type: 'rating', id: 'r', data: FIXTURES.rating }] };
  const back = pzn.toTapuzPage(pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)))).blocks[0];
  check('pzn rating keeps the decimal score', Number(back.data.value) === 4.5 && back.data.text === FIXTURES.rating.text);
}

// ── rating ──
const rHtml = renderBlock({ type: 'rating', id: 'r1', data: FIXTURES.rating }, 'rtl');
check('rating render: fill clipped to 90% + aria label', /bent-rating-fill" aria-hidden="true" style="width:90%"/.test(rHtml)
  && /aria-label="4.5 מתוך 5"/.test(rHtml) && /213 ביקורות/.test(rHtml));
check('rating render: out-of-range clamps', /width:100%/.test(renderBlock({ type: 'rating', id: 'r2', data: { value: 9 } }, 'rtl'))
  && /width:0%/.test(renderBlock({ type: 'rating', id: 'r3', data: { value: -2 } }, 'rtl')));
check('rating render: 10-star max', (renderBlock({ type: 'rating', id: 'r4', data: { value: 7, max: 10 } }, 'rtl').match(/★/g) || []).length === 20);

// ── hours ──
const hHtml = renderBlock({ type: 'hours', id: 'h1', data: FIXTURES.hours }, 'rtl');
check('hours render: three rows, closed day marked', (hHtml.match(/class="bent-day(?: bent-day-closed)?"/g) || []).length === 3
  && /bent-day-closed/.test(hHtml) && /9:00–19:00/.test(hHtml));
check('hours render: no script', !/<script/i.test(hHtml));

// ── toc ──
const tHtml = renderBlock({ type: 'toc', id: 't1', data: FIXTURES.toc }, 'rtl');
check('toc render: nav + title + anchors', /<nav[^>]*class="bent-toc"/.test(tHtml) && /bent-toc-title">תוכן עניינים/.test(tHtml)
  && /href="#intro"/.test(tHtml) && /href="#faq"/.test(tHtml));
check('toc render: hostile anchor neutralized', !/javascript:/i.test(renderBlock({
  type: 'toc', id: 't2', data: { items: [{ label: 'x', anchor: 'javascript:alert(1)' }] }
}, 'rtl')));

// ── author ──
const aHtml = renderBlock({ type: 'author', id: 'a1', data: FIXTURES.author }, 'rtl');
check('author render: photo, name, bio, link', /bent-author-photo" src="\/uploads\/dana.jpg"/.test(aHtml)
  && /bent-author-name">דנה לוי/.test(aHtml) && /כותבת על טכנולוגיה/.test(aHtml) && /href="\/author\/dana">לכל הכתבות/.test(aHtml));
check('author render: no link without url', !/<a /.test(renderBlock({ type: 'author', id: 'a2', data: { name: 'x', bio: 'y' } }, 'rtl')));

// ── compare ──
const cHtml = renderBlock({ type: 'compare', id: 'c1', data: FIXTURES.compare }, 'rtl');
check('compare render: both pictures, range, labels', /bent-compare-before" src="\/uploads\/before.jpg"/.test(cHtml)
  && /bent-compare-after" src="\/uploads\/after.jpg"/.test(cHtml) && /type="range"/.test(cHtml) && /לפני/.test(cHtml) && /אחרי/.test(cHtml));
check('compare render: ships its slider script', /<script>/.test(cHtml));
check('compare render: missing picture → no script', !/<script>/.test(renderBlock({ type: 'compare', id: 'c2', data: { before: '/a.jpg' } }, 'rtl')));

// ── flipbox ──
const fHtml = renderBlock({ type: 'flipbox', id: 'f1', data: FIXTURES.flipbox }, 'rtl');
check('flipbox render: front title + back text + button, focusable', /bent-flipbox-front/.test(fHtml) && /bent-flipbox-title">אחריות מלאה/.test(fHtml)
  && /bent-flipbox-text">שלוש שנות אחריות/.test(fHtml) && /href="\/warranty">לפרטים/.test(fHtml) && /tabindex="0"/.test(fHtml));
check('flipbox render: no script, zero JS', !/<script/i.test(fHtml));

// ── legacy BentML (line dialect) ──
const legacy = bentml.compile(`BENTML 0.2

META {
  title: "גל 4"
}

RATING(value: 4.5) { 4.5 מתוך 5 }

HOURS {
  DAY(name: "ראשון–חמישי") { 9:00–19:00 }
  DAY(name: "שבת") { סגור }
}

TOC(title: "תוכן עניינים") {
  TOCITEM(anchor: "#intro") { הקדמה }
  TOCITEM(anchor: "#faq") { שאלות }
}

AUTHOR(name: "דנה לוי", image: "/uploads/dana.jpg", url: "/author/dana") { כותבת על טכנולוגיה. }

COMPARE(before: "/uploads/before.jpg", after: "/uploads/after.jpg")

FLIPBOX(title: "אחריות מלאה", cta: "לפרטים", url: "/warranty") { שלוש שנות אחריות. }
`);
const lTypes = legacy.blocks.map((b) => b.type);
check('legacy compiles all six keywords', ['rating', 'hours', 'toc', 'author', 'compare', 'flipbox'].every((t) => lTypes.includes(t)));
const lRating = legacy.blocks.find((b) => b.type === 'rating');
check('legacy RATING: decimal value + text', lRating.data.value === 4.5 && lRating.data.text === '4.5 מתוך 5');
const lHours = legacy.blocks.find((b) => b.type === 'hours');
check('legacy HOURS: day rows', lHours.data.items.length === 2 && lHours.data.items[1].hours === 'סגור');
const lFlip = legacy.blocks.find((b) => b.type === 'flipbox');
check('legacy FLIPBOX: cta/url → buttonText/buttonUrl', lFlip.data.buttonText === 'לפרטים' && lFlip.data.buttonUrl === '/warranty');
const src = bentml.decompile({ title: 'x' }, Object.entries(FIXTURES).map(([type, data], n) => ({ type, id: type + '_' + n, data })));
const round = bentml.compile(src);
check('legacy decompile → recompile keeps all six', ['rating', 'hours', 'toc', 'author', 'compare', 'flipbox']
  .every((t) => round.blocks.some((b) => b.type === t)));

// ── the decompiler maps what used to flatten (the audit fixtures) ──
const ratingGrad = htmlToBlocks(`
  <div class="elementor-widget-star-rating">
    <div class="elementor-star-rating" title="4.5/5">★★★★½</div>
    <span class="rating-text">4.5 מתוך 5 — 213 ביקורות</span>
  </div>
`);
const gRating = ratingGrad.blocks.find((b) => b.type === 'rating');
check('decompile Elementor star rating → rating (was: text)', !!gRating && gRating.data.value === 4.5 && /213 ביקורות/.test(gRating.data.text || ''));
const glyphs = htmlToBlocks('<div class="rating">★★★☆☆</div>');
check('decompile star glyphs → rating 3/5', glyphs.blocks.some((b) => b.type === 'rating' && b.data.value === 3));
check('plain rating text without stars stays text', !htmlToBlocks('<div class="rating"><p>מעולה</p></div>').blocks.some((b) => b.type === 'rating'));

const hoursGrad = htmlToBlocks(`
  <div class="opening-hours">
    <h3>שעות פתיחה</h3>
    <div class="hours-row"><span class="day">ראשון–חמישי</span><span class="hours">9:00–19:00</span></div>
    <div class="hours-row"><span class="day">שישי</span><span class="hours">9:00–14:00</span></div>
    <div class="hours-row closed"><span class="day">שבת</span><span class="hours">סגור</span></div>
  </div>
`);
const gHours = hoursGrad.blocks.find((b) => b.type === 'hours');
check('decompile opening hours → heading + hours (was: text rows)', hoursGrad.blocks[0].type === 'heading'
  && !!gHours && gHours.data.items.length === 3 && gHours.data.items[2].hours === 'סגור' && gHours.data.items[0].day === 'ראשון–חמישי');
const dlHours = htmlToBlocks('<div class="business-hours"><dl><dt>א׳–ה׳</dt><dd>9–19</dd><dt>שבת</dt><dd>סגור</dd></dl></div>');
check('decompile dt/dd hours → hours', dlHours.blocks.some((b) => b.type === 'hours' && b.data.items.length === 2));

const tocGrad = htmlToBlocks(`
  <div class="elementor-widget-table-of-contents toc">
    <h4>תוכן עניינים</h4>
    <ul><li><a href="#intro">הקדמה</a></li><li><a href="#how">איך זה עובד</a></li><li><a href="#faq">שאלות נפוצות</a></li></ul>
  </div>
`);
const gToc = tocGrad.blocks.find((b) => b.type === 'toc');
check('decompile TOC widget → toc with title (was: heading + list)', !!gToc && gToc.data.title === 'תוכן עניינים'
  && gToc.data.items.length === 3 && gToc.data.items[1].anchor === '#how' && !tocGrad.blocks.some((b) => b.type === 'list'));
check('a nav of anchors classed toc → toc, not nav', htmlToBlocks('<nav class="toc"><a href="#a">א</a><a href="#b">ב</a></nav>')
  .blocks.some((b) => b.type === 'toc'));

const authorGrad = htmlToBlocks(`
  <div class="author-box post-author">
    <img src="/up/author.jpg" alt="מאת דנה" class="avatar">
    <div class="author-info"><h4 class="author-name">דנה לוי</h4><p class="author-bio">כותבת על טכנולוגיה ועסקים כבר עשור.</p>
    <a href="/author/dana">לכל הכתבות</a></div>
  </div>
`);
const gAuthor = authorGrad.blocks.find((b) => b.type === 'author');
check('decompile author box → author (was: image+heading+text+button)', !!gAuthor && gAuthor.data.name === 'דנה לוי'
  && gAuthor.data.image === '/up/author.jpg' && /עשור/.test(gAuthor.data.bio) && gAuthor.data.url === '/author/dana' && gAuthor.data.linkLabel === 'לכל הכתבות');

const compareGrad = htmlToBlocks(`
  <div class="twentytwenty-container image-compare">
    <img src="/up/before.jpg" alt="לפני" class="before">
    <img src="/up/after.jpg" alt="אחרי" class="after">
  </div>
`);
const gCompare = compareGrad.blocks.find((b) => b.type === 'compare');
check('decompile twentytwenty → compare (was: two images)', !!gCompare && gCompare.data.before === '/up/before.jpg' && gCompare.data.after === '/up/after.jpg'
  && !compareGrad.blocks.some((b) => b.type === 'image'));

const flipGrad = htmlToBlocks(`
  <div class="elementor-widget-flip-box">
    <div class="elementor-flip-box-front"><h3>אחריות מלאה</h3></div>
    <div class="elementor-flip-box-back"><p>שלוש שנות אחריות על כל מוצר.</p><a href="/warranty">פרטים</a></div>
  </div>
`);
const gFlip = flipGrad.blocks.find((b) => b.type === 'flipbox');
check('decompile Elementor flip box → flipbox (was: heading+text+button)', !!gFlip && gFlip.data.title === 'אחריות מלאה'
  && /שלוש שנות/.test(gFlip.data.backText) && gFlip.data.buttonText === 'פרטים' && gFlip.data.buttonUrl === '/warranty');

console.log('');
console.log(fail ? 'SMOKE GAP-WAVE4: FAIL' : 'SMOKE GAP-WAVE4: PASS');
process.exit(fail ? 1 : 0);
