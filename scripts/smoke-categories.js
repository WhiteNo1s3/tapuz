'use strict';

/**
 * v0.64 QA — categories, the batch finale (make + present, combined).
 * Runs in an isolated TAPUZ_ROOT (nothing touches the real content/ or DB):
 *   MAKE:    the file store content/categories.json (sanitize, dedupe, get)
 *   ASSIGN:  membership = the page's portable tags (a category IS a tag)
 *   PRESENT: the category block — branded header + the category's article
 *            grid (reuses the media-card renderer), compile/render parity,
 *            safeCssColor on the accent, ONE merged style attr (v0.60 lesson).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// isolate BEFORE requiring anything that reads paths.js
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-categories-'));
process.env.TAPUZ_ROOT = root;

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const { createPage, publishPage } = require('../src/pages');
const { saveCategories, listCategories, getCategory, safeSlug, CATEGORIES_PATH } = require('../src/categories');
const { listStorage } = require('../src/storage-view');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── MAKE: the file store ─────────────────────────────────────────────
const saved = saveCategories([
  { slug: 'News!', name: 'חדשות', color: '#c0392b', description: 'כל המבזקים' },
  { slug: 'news', name: 'כפילות — הראשון גובר' },
  { name: 'ספורט', color: '#0a66c2' },        // slug derived from the name
  { slug: '', name: '' }                       // dropped
]);
check('save sanitizes + dedupes (news + ספורט)', saved.length === 2 && saved[0].slug === 'news' && saved[1].slug === 'ספורט');
check('the file exists on disk at content/categories.json', fs.existsSync(CATEGORIES_PATH));
check('listCategories reads back', listCategories().length === 2);
check('getCategory finds by slug', getCategory('news').name === 'חדשות' && getCategory('אין-כזה') === null);
check('safeSlug keeps Hebrew, strips junk', safeSlug('חדשות בערב!') === 'חדשות-בערב' && !/[^\w֐-׿-]/.test(safeSlug('a b!@#')));

// ── ASSIGN: pages carry the category slug as a portable tag ──────────
createPage({
  title: 'כתבה בחדשות', slug: 'smoke-cat-a', tags: ['article', 'news'],
  blocks: [
    { type: 'image', id: 'i1', data: { src: '/assets/a.jpg' } },
    { type: 'text', id: 't1', data: { content: 'תקציר הכתבה הראשונה בקטגוריה.' } }
  ],
  status: 'draft'
});
publishPage('smoke-cat-a');
createPage({
  title: 'טיוטה בחדשות', slug: 'smoke-cat-d', tags: ['news'],
  blocks: [{ type: 'text', id: 't2', data: { content: 'טיוטה' } }],
  status: 'draft'
}); // NOT published — must not appear

// ── PRESENT: the block, render path ──────────────────────────────────
const block = { type: 'category', id: 'c1', data: { slug: 'news', limit: 6 } };
const rendered = renderBlock(block, 'rtl');
check('render: branded header (name from the store)', /bent-category-name">חדשות</.test(rendered));
check('render: description', /bent-category-desc">כל המבזקים</.test(rendered));
check('render: accent color var (safeCssColor)', /--bent-cat-color:#c0392b/.test(rendered));
check('render: the published page as a media card', /bent-card-title">כתבה בחדשות</.test(rendered) && /href="\/smoke-cat-a\.html"/.test(rendered));
check('render: card tag = category name', /bent-card-tag">חדשות</.test(rendered));
check('render: draft page excluded', !/טיוטה בחדשות/.test(rendered));
check('render: grid reuses .bent-cards', /class="bent-cards"/.test(rendered));
check('render: ONE style attr', (rendered.match(/style="/g) || []).length === 1);

check('showheader:false hides the header',
  !/bent-category-head/.test(renderBlock({ type: 'category', id: 'c2', data: { slug: 'news', showheader: false } }, 'rtl')));
check('unknown slug degrades: slug as name + empty-grid comment', (() => {
  const r = renderBlock({ type: 'category', id: 'c3', data: { slug: 'ghost' } }, 'rtl');
  return /bent-category-name">ghost</.test(r) && /no published pages tagged "ghost"/.test(r);
})());

// security: CSS breakout via the category color is stripped
saveCategories([...listCategories(), { slug: 'evil', name: 'x', color: 'red;}body{color:blue' }]);
const evil = renderBlock({ type: 'category', id: 'e', data: { slug: 'evil' } }, 'rtl');
check('CSS color breakout stripped', !/[{}]/.test((evil.match(/style="[^"]*"/) || [''])[0]) && !/;body/.test(evil));

// ── round-trip + compile parity ──────────────────────────────────────
const page = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [block] };
const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const rt = back.blocks.find((b) => b.type === 'category');
check('round-trips (slug + limit)', rt && rt.data.slug === 'news' && rt.data.limit === 6);
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);
const compiled = pzn.compile(doc, {
  articles: [{ title: 'כתבה בחדשות', url: '/smoke-cat-a', image: '/assets/a.jpg', teaser: 'תקציר', tags: ['news'] }],
  categories: listCategories()
});
for (const [nm, re] of [
  ['header name', /bent-category-name">חדשות</],
  ['accent var', /--bent-cat-color:#c0392b/],
  ['article card', /bent-card-title">כתבה בחדשות</]
]) check('compile parity: ' + nm, re.test(compiled));

// ── ties into the Storage section + registry ─────────────────────────
check('Storage section lists categories.json', listStorage().siteData.some((f) => f.name === 'categories.json'));
check('registry def + seed', !!getBlockDef('category') && defaultDataFor('category').slug === '');

// cleanup
try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }

console.log('');
console.log(fail ? 'SMOKE CATEGORIES: FAIL' : 'SMOKE CATEGORIES: PASS');
process.exit(fail ? 1 : 0);
