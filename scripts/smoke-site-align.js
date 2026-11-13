'use strict';

/**
 * v2.69 QA — what the page maker PRODUCES lines up: one grid, one rhythm,
 * things centred when they say centred. Ben: "refine the look and page maker
 * so it aligns good in the eye for perfectionists."
 *
 * Every defect below was measured in a real browser first (x positions,
 * computed styles); this smoke pins the rule that fixes each one, so the next
 * edit of the stylesheet cannot quietly bring it back. It reads the site
 * stylesheet and the theme's output as TEXT and asserts a rule's key
 * declaration — never a whole block — and it renders the three helpers that
 * changed (the gallery, the card grid, the product teasers).
 *
 * The store block of the stylesheet is not this smoke's: it is cut out
 * before anything is asserted.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-site-align-'));

const theme = require('../src/theme');
const { renderBlock } = require('../src/renderer');
const { renderCardsGrid, renderCard } = require('../src/pzn/card-html');
const { renderProductsFromData } = require('../src/pzn/products-html');
const bentml = require('../src/bentml');
const pzn = require('../src/pzn/index');

let fail = false;
function ok(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + label);
  if (!cond) fail = true;
}
// a check that cannot even be asked (a helper that is not there) is a FAIL
// line like any other, not a crash that hides the checks after it
function asked(fn) {
  try { return fn(); } catch (e) { return false; }
}

// ── the stylesheet as rules ──────────────────────────────────────────────
const whole = fs.readFileSync(path.join(__dirname, '..', 'themes', 'default', 'css', 'main.css'), 'utf8');
const storeFrom = whole.indexOf('/* ===== The store (v2.53)');
const storeTo = whole.indexOf("/* ===== The header's shape (v2.63)");
ok(storeFrom > 0 && storeTo > storeFrom, 'the store block is where it was (its two banners are found)');
const css = (whole.slice(0, storeFrom) + whole.slice(storeTo)).replace(/\/\*[\s\S]*?\*\//g, '');

const squeeze = (s) => String(s).replace(/\s+/g, ' ').trim();
// a selector list split on its top-level commas (":is(a, b)" stays whole)
function splitList(list) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(squeeze(cur)); cur = ''; } else cur += ch;
  }
  if (squeeze(cur)) out.push(squeeze(cur));
  return out;
}
// every innermost { } of a text: the plain rules, inside an @media or not
function rulesOf(text) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) rules.push({ selectors: splitList(m[1]), body: squeeze(m[2]) });
  return rules;
}
const RULES = rulesOf(css);
// what the stylesheet declares for one selector (all its rules, joined)
const decl = (selector) => RULES.filter((r) => r.selectors.includes(selector)).map((r) => r.body).join(' ; ');
const says = (selector, re) => re.test(decl(selector));
// the inside of every at-block that opens with this prelude
function inside(prelude) {
  let out = '';
  let at = 0;
  for (;;) {
    const i = css.indexOf(prelude + ' {', at);
    if (i === -1) break;
    let depth = 0;
    let j = css.indexOf('{', i);
    const start = j + 1;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      if (css[j] === '}' && --depth === 0) break;
    }
    out += css.slice(start, j) + '\n';
    at = j;
  }
  return out;
}
// a physical side: a -left/-right longhand, a left:/right: offset, or a
// four-value margin/padding whose right and left differ (the old .btn margin
// "0.25rem 0.25rem 0.25rem 0" was the START side on a Hebrew page)
function physical(body) {
  if (/(?:^|[;\s])(?:margin|padding|border)-(?:left|right)\b|(?:^|[;\s])(?:left|right)\s*:/.test(body)) return true;
  const four = /(?:^|[;\s])(?:margin|padding): ([^;\s]+) ([^;\s]+) ([^;\s]+) ([^;\s]+)/g;
  let m;
  while ((m = four.exec(body))) if (m[2] !== m[4]) return true;
  return false;
}

// ── 1. the tokens: one rhythm, and the five names nothing ever defined ───
const root = decl(':root');
for (const t of ['--grid-gap', '--block-gap', '--card-pad', '--media-bg', '--page-pad',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6',
  '--accent', '--accent-fg', '--border', '--muted', '--color-bg-soft']) {
  ok(new RegExp('(?:^|[;\\s])' + t + '\\s*:').test(root), ':root defines ' + t);
}
ok(/--grid-gap: 1\.25rem/.test(root) && /--block-gap: 1\.5rem/.test(root), 'the grid gap is 1.25rem and the block gap 1.5rem (what most grids already had)');
ok(/--media-bg: var\(--color-light-bg/.test(root), '--media-bg rests on the palette\'s light background');

const themeCss = theme.overridesToCss({});
const purple = theme.overridesToCss({ colors: { primary: '#6d28d9', border: '#eadfce', muted: '#6b6280', lightBg: '#f4e9ff' } });
ok(/--accent: #6d28d9;/.test(purple), 'theme: --accent is the primary (a purple site no longer has tangerine prices)');
ok(/--border: #eadfce;/.test(purple) && /--muted: #6b6280;/.test(purple), 'theme: --border and --muted follow the palette');
ok(/--color-bg-soft: #f4e9ff;/.test(purple), 'theme: --color-bg-soft is the light background (the team photo box is no longer stone)');
ok(!/--color-bg-alt\s*:/.test(themeCss) && !/--color-bg-alt\s*:/.test(root), '--color-bg-alt stays undefined (a code fence must not turn light)');
ok(says('.bent-code pre', /background: var\(--code-bg, #0f172a\)/), 'the code fence has a name of its own (--code-bg), dark by default');

ok(/--accent-fg: #fff;/.test(purple), 'theme: --accent-fg is white on a dark primary');
ok(/--accent-fg: #fff;/.test(themeCss), 'theme: --accent-fg is white on the default tangerine');
ok(/--accent-fg: #111827;/.test(theme.overridesToCss({ colors: { primary: '#fde047' } })), 'theme: --accent-fg flips to dark words on a light primary');
ok(asked(() => theme.accentForeground('#fff') === '#111827' && theme.accentForeground('#000') === '#fff' && theme.accentForeground('rebeccapurple') === '#fff'),
  'accentForeground: 3-digit hex is read, an unmeasurable colour keeps white');
for (const sel of ['.btn-primary', '.bent-plan-cta', '.cta-strip.tone-brand', '.site-banner.tone-brand', '.bent-search-submit', '.bent-newsletter-form button', '.bent-step-n', '::selection']) {
  ok(says(sel, /color: var\(--accent-fg, #fff\)/), sel + ' writes its words in --accent-fg');
}

// ── 2. the theme's button style reaches every button ─────────────────────
const FIRST = '.btn-primary, .bent-form-submit, .bent-plan-cta, .bent-flipbox-button';
const SECOND_STARTS = '.bent-btn:not(.bent-btn-ghost), .bent-shop-add:not(.is-out), .bent-buy-add, .bent-checkout-submit, .bent-search-submit';
const outline = theme.overridesToCss({ style: { buttons: 'outline' } });
const soft = theme.overridesToCss({ style: { buttons: 'soft' } });
const glow = theme.overridesToCss({ style: { buttons: 'glow' } });
ok(outline.includes(FIRST + ' { background: transparent; color: #ea580c; border: 2px solid #ea580c; box-shadow: none; }'),
  'buttons outline: the first list is emitted exactly as it always was');
ok(outline.includes(SECOND_STARTS) && /\.bent-auth-register \{ background: transparent; color: #ea580c; border: 2px solid #ea580c/.test(outline),
  'buttons outline: the store and page-surface buttons get the same rule');
ok(soft.includes(FIRST + ' { background: color-mix(in srgb, #ea580c 14%, transparent)') && /\.bent-auth-register \{ background: color-mix\(in srgb, #ea580c 14%, transparent\)/.test(soft),
  'buttons soft: both lists');
ok(glow.includes(FIRST + ' { box-shadow: 0 8px 24px color-mix') && /\.bent-auth-register \{ box-shadow: 0 8px 24px color-mix/.test(glow),
  'buttons glow: both lists');
ok(/\.bent-shop-add:not\(\.is-out\):hover, \.bent-buy-add:hover/.test(outline), 'buttons: the second list has its hover rule too');
ok(!themeCss.includes(FIRST + ' {') && !themeCss.includes(SECOND_STARTS), 'buttons filled (the default) emits neither list');
ok(/\.bent-btn:not\(\.bent-btn-ghost\)/.test(outline) && /\.bent-shop-add:not\(\.is-out\)/.test(outline), 'a ghost button stays a ghost and a sold-out pill a pill');
for (const cls of ['.bent-btn', '.bent-btn-ghost', '.bent-shop-add', '.bent-buy-add', '.bent-checkout-submit', '.bent-search-submit', '.bent-newsletter-form', '.bent-consent-accept', '.bent-auth-register']) {
  ok(whole.includes(cls), 'the stylesheet knows ' + cls + ' (the second list names real classes)');
}

// ── 3. the header keeps to a wide content column ─────────────────────────
const hw = (o) => (/--header-max-width: ([^;]+);/.exec(theme.overridesToCss(o)) || [])[1];
ok(hw({}) === '1140px', 'header: beside the default 900px column it is still 1140px');
ok(hw({ layout: { maxWidth: '1100px' } }) === 'var(--max-width)', 'header: beside an 1100px column it follows the column (was 20px out on each side)');
ok(hw({ layout: { maxWidth: '1000px' } }) === 'var(--max-width)' && hw({ layout: { maxWidth: '999px' } }) === '1140px', 'header: the line is 1000px');
ok(hw({ layout: { maxWidth: '1100px', headerWidth: 'full' } }) === '100%', 'header: an owner\'s "full" is never touched');
ok(hw({ layout: { maxWidth: '900px', headerWidth: 'content' } }) === 'var(--max-width)', 'header: an owner\'s "content" is never touched');
ok(asked(() => theme.headerFollowsColumn({ maxWidth: '72rem' }) === false), 'header: a width that is not in px cannot be measured and keeps "wide"');

// ── 4. centred means centred ─────────────────────────────────────────────
ok(says('[dir="rtl"]', /text-align: right/) && says('[dir="ltr"]', /text-align: left/),
  'the root [dir] rule is untouched (changing it would re-centre every live BACKDROP)');
ok(says('.bent-text > p', /text-align: inherit/), 'TEXT: a paragraph follows its wrapper\'s align');
ok(says('.bent-text[style*="text-align:center"] > p', /margin-inline: auto/), 'TEXT align=center: the capped paragraph is centred, not start-anchored');
ok(says('.bent-text[style*="text-align:end"] > p', /margin-inline-start: auto/), 'TEXT align=end: the capped paragraph goes to the end edge');
ok(says('.hero > .bent-text', /text-align: inherit/) && says('.hero > :is(h1, h2, h3, h4, h5, h6)', /text-align: inherit/),
  'HERO with authored children: the heading and the text follow the hero');
ok(says('.hero .bent-text p', /max-width: none/), 'HERO: its paragraphs carry no reading cap of their own');
ok(!RULES.some((r) => r.selectors.includes('p') && /max-width: 70ch/.test(r.body)), 'the 70ch cap no longer sits on every <p>');
const capped = RULES.filter((r) => /max-width: 70ch/.test(r.body)).map((r) => r.selectors.join(', ')).join(' | ');
ok(/\.bent-text/.test(capped) && /:where\(p, li\)/.test(capped), 'the 70ch cap is named where prose lives (.bent-text p, li)');
for (const strip of ['.site-banner', '.cta-strip', '.bent-newsletter-text', '.bent-count-label', '.bent-footer-credit']) {
  ok(!capped.includes(strip), strip + ' is not capped (its paragraph was 108–127px off-centre)');
}
ok(says('.btn[style*="text-align:center"]', /width: fit-content/) && says('.btn[style*="text-align:center"]', /margin-inline: auto/),
  'BUTTON align=center: a block as wide as its words, free space on both sides');
ok(says('.btn[style*="text-align:end"]', /margin-inline: auto 0/), 'BUTTON align=end: free space on the start side');
ok(says('.btn', /line-height: 1\.25/) && says('.btn', /margin: 0\.25rem 0(?:;|$)/), '.btn: its own line height (was 56px tall) and no side margin of its own');
ok(says('.btn + .btn', /margin-inline-start: 0\.5rem/), 'two buttons in a row keep a gap between them, on the logical side');
ok(says('.card.bent-card > .btn + .btn', /margin-inline-start: 0(?:;|$)/), 'two buttons stacked in a card share one edge (the row gap does not indent the second)');
ok(says('.bent-pager-link', /line-height: 1\.25/) && says('.bent-tag', /line-height: 1\.25/) && says('.bent-form-submit', /line-height: 1\.25/),
  'chips, pager links and form buttons read on the same line');
// `font: inherit` is a shorthand: written AFTER the line height it puts the
// page's 1.7 back (measured: a search button still 30.6px a line)
const where = (sel, re) => RULES.map((r, i) => (r.selectors.includes(sel) && re.test(r.body) ? i : -1)).filter((i) => i >= 0);
for (const sel of ['.bent-form-submit', '.bent-search-submit', '.bent-newsletter-form button', '.bent-consent-accept', '.bent-consent-reject']) {
  const line = where(sel, /line-height: 1\.25/);
  ok(line.length > 0 && Math.min(...line) > Math.max(-1, ...where(sel, /(?:^|[; ])font: inherit/)), sel + ': its line height is written after its own `font: inherit`');
}
ok(says('.btn-primary', /background-origin: border-box/), '.btn-primary: a gradient starts at the outer edge (no hairline under the transparent border)');
for (const sel of ['.bent-search-submit', '.bent-newsletter-form button', '.bent-consent-accept', '.bent-auth-register']) {
  ok(says(sel, /background: var\(--accent-bg, var\(--accent, #ea580c\)\)/), sel + ' wears the accent surface (--accent-bg), like .btn-primary');
}
ok(says('.bent-form-submit', /background: var\(--accent-bg, var\(--color-accent, #0a66c2\)\)/), '.bent-form-submit wears the accent surface too');
const onBrand = ':is(.cta-strip, .site-banner, .bent-header, .bent-footer).tone-brand .btn-primary';
ok(says(onBrand, /background: var\(--accent-fg, #fff\)/) && says(onBrand, /color: var\(--color-primary\)/),
  'a primary button on the brand surface turns inside out (the default CTA drew a button with no shape)');
ok(says('.bent-consent-accept', /border: 1px solid transparent/), 'consent: accept and reject carry the same 1px frame (were 2px apart in height)');

// ── 5. pricing: one level ────────────────────────────────────────────────
ok(says('.bent-plan', /display: flex/) && says('.bent-plan', /flex-direction: column/), 'pricing: a plan is a column');
ok(says('.bent-plan-features', /flex: 1 1 auto/), 'pricing: the feature list takes the slack');
ok(says('.bent-plan-cta', /margin-top: auto/), 'pricing: the button is pinned to the floor (margin-top: auto)');
ok(!/transform/.test(decl('.bent-plan-highlighted')) && says('.bent-plan-highlighted', /box-shadow: 0 0 0 2px/),
  'pricing: the recommended plan is a ring, not a different size (no scale)');

// ── 6. the media card and the CARD container are two things ──────────────
const bare = RULES.filter((r) => r.selectors.length === 1 && r.selectors[0] === '.bent-card').map((r) => r.body).join(' ; ');
ok(bare && !/padding/.test(bare) && !/overflow: hidden/.test(bare) && !/display: flex/.test(bare),
  'the bare .bent-card rule is a look only: no padding, no clip, no flex (pictures were inset 20px)');
ok(!RULES.some((r) => r.selectors.includes('.card') && r.selectors.includes('.bent-card')), 'no rule is shared by .card and .bent-card any more');
ok(says('.bent-card:not(.card)', /overflow: hidden/) && says('.bent-card:not(.card)', /flex-direction: column/),
  'a media card\'s shape is said for every card that is not the CARD container (a lone <bent-mediacard> is still a card)');
ok(/<div class="card bent-card"/.test(renderBlock({ type: 'card', id: 'k', data: { blocks: [] } }, 'rtl'))
  && /^<a class="bent-card" /.test(renderCard({ title: 'x', href: '/x' })) && /^<article class="bent-card">/.test(renderCard({ title: 'x' })),
  'the two are told apart by class: the container is "card bent-card", a media card "bent-card" alone');
ok(says('.card.bent-card', /overflow: visible/) && says('.card.bent-card > .btn', /align-self: flex-start/),
  'the CARD container: nothing clipped, and a button keeps its own width (was 916px)');
ok(says('.columns.valign-stretch > .col > .card', /height: calc\(100% - 2 \* var\(--block-gap\)\)/) && says('.columns.valign-stretch > .col > .bent-card:not(.card)', /height: 100%/),
  'a stretched card fills its column minus its own margins (it used to overrun into the next block); a media card, which has none, fills it all');
ok(says('.columns.valign-stretch > .col > .card > .btn:last-child', /margin-top: auto/),
  'a stretched row pins each card\'s closing button to the card\'s floor');
ok(says('.card', /padding: var\(--card-pad\)/) && says('.bent-card-body', /padding: var\(--card-pad\)/) && says('.bent-product-body', /padding: var\(--card-pad\)/),
  'cards share one inner padding (--card-pad)');

// ── 7. one gap, one ladder ───────────────────────────────────────────────
for (const sel of ['.features', '.article-cubes', '.gallery', '.stats-row', '.bent-pricing', '.bent-related-grid', '.bent-steps', '.bent-team', '.bent-cards', '.bent-products', '.bent-carousel-track']) {
  ok(says(sel, /gap: var\(--grid-gap\)/), sel + ' reads the shared --grid-gap');
}
for (const sel of ['.features', '.article-cubes', '.gallery', '.stats-row', '.bent-pricing', '.bent-steps', '.bent-cards', '.bent-products', '.bent-carousel', '.cta-strip', '.columns', '.card']) {
  ok(says(sel, /margin: var\(--block-gap\) 0/), sel + ' reads the shared --block-gap');
}
const gapRedeclared = RULES.filter((r) => /(?:^|[; ])gap:/.test(r.body) && r.selectors.some((s) => /^\.(?:features|gallery|stats-row|article-cubes)\.cols-\d/.test(s)));
ok(gapRedeclared.length === 0, 'no cols-N rule carries a gap of its own (features dropped to 1rem, the gallery to 8px)');
ok(says('.features.cols-4', /repeat\(4, minmax\(0, 1fr\)\)/) && says('.gallery.cols-3', /repeat\(3, minmax\(0, 1fr\)\)/) && says('.bent-products-cols-2', /repeat\(2, minmax\(0, 1fr\)\)/),
  'N-column grids have equal tracks (minmax(0, 1fr))');
const at860 = rulesOf(inside('@media (max-width: 860px)'));
const at480 = rulesOf(inside('@media (max-width: 480px)'));
const stepDown = (rules, sel) => rules.filter((r) => r.selectors.includes(sel)).map((r) => r.body).join(' ; ');
for (const sel of ['.features.cols-4', '.features.cols-3', '.article-cubes', '.gallery.cols-4', '.gallery.cols-3', '.stats-row.cols-4', '.bent-products-cols-3', '.bent-products-cols-4']) {
  ok(/repeat\(2, minmax\(0, 1fr\)\)/.test(stepDown(at860, sel)), 'ladder: ' + sel + ' → 2 columns at 860px');
}
for (const sel of ['.features.cols-2', '.features.cols-4', '.article-cubes', '.article-cubes.cols-2', '.gallery.cols-2', '.gallery.cols-4', '.stats-row.cols-2', '.stats-row.cols-4', '.bent-products-cols-2', '.bent-products-cols-4']) {
  ok(/grid-template-columns: minmax\(0, 1fr\)/.test(stepDown(at480, sel)), 'ladder: ' + sel + ' → 1 column at 480px');
}
const strays = [];
css.replace(/@media \((?:max|min)-width: (\d+)px\) \{/g, (m, px) => {
  if (px === '860' || px === '480') return m;
  const body = inside(m.slice(0, -2));
  if (/\.(?:features|article-cubes|gallery|stats-row)\b|\.bent-products-cols-/.test(body)) strays.push(px);
  return m;
});
ok(strays.length === 0, 'no N-column grid folds at any other breakpoint (found: ' + (strays.join(', ') || 'none') + ')');

// ── 8. orphan last rows are centred ──────────────────────────────────────
for (const sel of ['.bent-steps', '.bent-team']) {
  ok(says(sel, /display: flex/) && says(sel, /flex-wrap: wrap/) && says(sel, /justify-content: center/), sel + ' wraps as a centred flex row (7 members were 5 + 2 at the edge)');
  ok(!/grid-template-columns/.test(decl(sel)), sel + ' is no longer an auto-fit grid');
}
ok(says('.logos-strip', /justify-content: center/) && says('.logos-strip', /flex-wrap: wrap/), '.logos-strip is a centred flex row');
ok(/calc\(\(100% - \(var\(--per-row\) - 1\) \* var\(--grid-gap\)\) \/ var\(--per-row\)\)/.test(css), 'a step or a member is one N-th of the row minus the shared gaps');
ok(says('.bent-steps > :first-child', /counter-reset: bent-step/) && !/counter-reset/.test(decl('.bent-steps')),
  'steps: the numbering starts on the first step (a query container keeps its counters inside)');

// ── 9. the gallery ───────────────────────────────────────────────────────
const galleryImg = RULES.filter((r) => r.selectors.includes('.gallery img'));
ok(galleryImg.length === 1, 'one .gallery img rule (a second, later one used to win)');
ok(!/height: \d+px/.test(decl('.gallery img')) && says('.gallery img', /aspect-ratio: 4 \/ 3/) && says('.gallery img', /object-fit: cover/) && says('.gallery img', /height: auto/),
  '.gallery img: a 4:3 box, no fixed 120px height (pictures were 361×120 strips)');
const gal = renderBlock({ type: 'gallery', id: 'g', data: { columns: 3, images: [{ src: '/a.jpg', alt: 'א', caption: 'כיתוב <b>ראשון</b>' }, { src: '/b.jpg', alt: 'ב' }, '/c.jpg'] } }, 'rtl');
ok((gal.match(/<figure class="gallery-item">/g) || []).length === 3, 'gallery: every picture is a <figure>');
ok((gal.match(/<figcaption>/g) || []).length === 1 && gal.includes('<figcaption>כיתוב &lt;b&gt;ראשון&lt;/b&gt;</figcaption>'), 'gallery: a caption is drawn, escaped, and only where one was written');
ok((gal.match(/loading="lazy" decoding="async"/g) || []).length === 3, 'gallery: lazy and async on every picture');
ok(/class="gallery cols-3"/.test(gal), 'gallery: the wrapper and its column class are unchanged');
const galText = bentml.decompile({ title: 't', slug: 't', direction: 'rtl', status: 'published', tags: [], meta: {} },
  [{ id: 'g', type: 'gallery', data: { columns: 3, images: [{ src: '/a.jpg', alt: 'א', caption: 'כיתוב' }, { src: '/b.jpg', alt: 'ב' }] } }]);
const galBack = bentml.compile(galText).blocks.find((b) => b.type === 'gallery');
ok(galBack && galBack.data.images[0].caption === 'כיתוב', 'BenTML GALLERY keeps a caption on the way back in');
ok(galBack && !('caption' in galBack.data.images[1]), 'BenTML GALLERY: a picture without a caption compiles as before');

// ── 10. titles on one level: the empty media box ─────────────────────────
const cardsMixed = renderBlock({ type: 'cards', id: 'c', data: { items: [{ image: '/a.jpg', title: 'א', href: '/a' }, { title: 'ב', href: '/b' }, { title: 'ג' }] } }, 'rtl');
ok((cardsMixed.match(/bent-card-media-empty/g) || []).length === 2, 'cards: a card without a picture, beside one that has, gets the empty media box');
ok(/<a class="bent-card" href="\/b"><figure class="bent-card-media bent-card-media-empty" aria-hidden="true"><\/figure><div class="bent-card-body">/.test(cardsMixed),
  'cards: the box sits where the picture would, hidden from a screen reader');
const cardsPlain = renderBlock({ type: 'cards', id: 'c', data: { items: [{ title: 'א' }, { title: 'ב' }] } }, 'rtl');
ok(!/bent-card-media/.test(cardsPlain), 'cards: a grid in which no card has a picture is left exactly as it was');
ok(!/bent-card-media-empty/.test(renderCardsGrid(renderCard({ image: '/a.jpg', title: '<figure class="bent-card-media">' }))), 'cards: a title cannot forge the marker (it is escaped)');
const tagCards = pzn.compile(pzn.parse(pzn.serialize(pzn.fromTapuzPage({
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{ type: 'cards', id: 'c', data: { items: [{ image: '/a.jpg', title: 'א', href: '/a' }, { title: 'ב', href: '/b' }] } }]
}))));
ok((tagCards.match(/bent-card-media-empty/g) || []).length === 1, 'cards: the tag dialect gets the same box (both paths meet at the grid)');
const prodMixed = renderProductsFromData({ columns: 3, items: [{ image: '/a.jpg', title: 'א', price: '₪10', url: '/a' }, { title: 'ב', price: '₪20' }] }, ' dir="rtl"');
ok((prodMixed.match(/bent-product-media-empty/g) || []).length === 1, 'products: an image-less product beside a pictured one gets the empty square');
ok(!/bent-product-media/.test(renderProductsFromData({ columns: 3, items: [{ title: 'א' }, { title: 'ב' }] }, ' dir="rtl"')), 'products: a grid without pictures is left as it was');
ok(says('.bent-card-media', /background: var\(--media-bg\)/) && says('.bent-product-media', /background: var\(--media-bg\)/) && says('.article-cube .cube-media', /background: var\(--media-bg\)/),
  'every picture box wears --media-bg');

// ── 11. rows ─────────────────────────────────────────────────────────────
ok(says('.columns', /--col-gap: 1\.75rem/) && says('.columns', /gap: var\(--col-gap\)/), 'ROW: one default gap, read from --col-gap');
ok(!/(?:^|[; ])gap:/.test(decl('.columns.cols-ratio')), 'ROW: a ratio row has no second default gap (was 20.7px beside 31.5px)');
ok(says('.columns.gap-sm', /--col-gap: 0\.75rem/) && says('.columns.gap-lg', /--col-gap: 2\.75rem/) && says('.columns.gap-none', /--col-gap: 0/), 'ROW: gap=none|sm|lg set the one variable');
const clip = RULES.find((r) => /overflow-x: clip/.test(r.body) && r.selectors.some((s) => s.startsWith('body:has(')));
ok(clip && /\.cols-full/.test(clip.selectors.join(',')) && /\.cols-wide/.test(clip.selectors.join(',')) && /\.sec-w-full/.test(clip.selectors.join(',')),
  'ROW: a full or wide row is in the page\'s sideways-clip list (a cols-full row scrolled the page)');
ok(says('.main-content', /padding: var\(--page-pad-block\) var\(--page-pad\)/) && says('.columns.cols-full', /padding-inline: var\(--page-pad\)/) && says('.header-inner', /padding: 0 var\(--page-pad\)/),
  'the page\'s edge is one variable: content, header and full-bleed rows read --page-pad');
ok(!/-2\.25rem/.test(css), 'full-bleed bands pull by the page\'s own padding, not a fixed -2.25rem');
const at1024 = rulesOf(inside('@media (max-width: 1024px)'));
ok(/repeat\(2, minmax\(0, 1fr\)\)/.test(stepDown(at1024, '.columns.cols-n-4.cols-ratio')) && /repeat\(3, minmax\(0, 1fr\)\)/.test(stepDown(at1024, '.columns.cols-n-6.cols-ratio')),
  'ROW: a ratio row wraps on a tablet like a plain one');
for (const pinned of ['.columns.gap-lg', '.columns.valign-stretch', '.columns.cols-wide', '.columns.cols-full']) {
  ok(RULES.some((r) => r.selectors.includes(pinned)), 'pinned selector still exists: ' + pinned);
}

// ── 12. RTL/LTR slips, the feature title, the radii ──────────────────────
ok(says('.testimonial', /border-inline-start: 5px solid/) && says('.testimonial', /border-start-end-radius: var\(--radius-md/) && says('.testimonial', /border-end-end-radius: var\(--radius-md/),
  'testimonial: the accent bar is on the start side, both end corners follow the theme');
ok(says('.bent-whatsapp', /padding-inline: 1rem 1\.25rem/), 'WhatsApp button: logical padding');
ok(says('.bent-code pre', /direction: ltr/) && says('.bent-code pre', /text-align: start/), 'a code fence reads left to right on a Hebrew page too');
for (const sel of ['.btn', '.hero .subtitle', '.testimonial', '.bent-whatsapp', '.columns.cols-full', '.columns.cols-wide', '.card', '.bent-plan-cta', '.gallery img', '.bent-related-image', '.bent-event-image']) {
  ok(decl(sel) !== '' && !physical(decl(sel)), 'no physical left/right declaration in ' + sel);
}
ok(says('.feature h3', /font-size: 1\.1rem/) && !RULES.some((r) => r.selectors.includes('article.feature h3')),
  'a feature card\'s title is one size, linked or not (was 24.3px beside 19.8px)');
ok(says('.cta-strip', /border-radius: var\(--radius-lg/) && says('.tapuz-search-box', /border-radius: var\(--radius-lg/) && says('.bent-newsletter', /border-radius: var\(--radius-lg/)
  && says('.bent-search-submit', /border-radius: var\(--radius-md/) && says('.bent-related-item', /border-radius: var\(--radius-lg/),
  'the page-surface modules take the theme\'s radii');
for (const sel of ['.bent-related-image', '.bent-event-image']) {
  ok(says(sel, /aspect-ratio: 16 \/ 9/) && says(sel, /object-fit: cover/) && says(sel, /background: var\(--media-bg\)/), sel + ': one 16:9 box, covered, on --media-bg');
}

console.log('');
console.log(fail ? 'SMOKE SITE-ALIGN: FAIL' : 'SMOKE SITE-ALIGN: PASS');
process.exit(fail ? 1 : 0);
