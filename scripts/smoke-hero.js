'use strict';

/**
 * The hero keeps what was written in it (v2.38) — Ben: "yes fix the hero".
 *
 * A hero written in BenTML used to be flattened into title / subtitle /
 * button on every builder save: a level-2 centred heading, a large text, an
 * outline button, a spacer and a second text came back as a bare h1/p/a —
 * ids, levels, aligns, sizes and variants gone, two children deleted — and the
 * live renderer drew only that trio, so the approved proposal (compiled from
 * .pzn) was not what the live site showed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// a scratch site BEFORE anything opens the database (the renderer does)
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-hero-'));
process.env.TAPUZ_ROOT = ROOT;

const pzn = require('../src/pzn/index');
const { toTapuzPage, fromTapuzPage } = require('../src/pzn/bridge/tapuz-json');
const { heroChildren } = require('../src/pzn/hero-children');

const shell = (body, slug) =>
  '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8"/><title>פרק</title>' +
  (slug ? '<meta name="bent-slug" content="' + slug + '"/>' : '') + '</head>\n<body>\n' + body + '\n</body></html>';
const HERO = [
  '<bent-hero id="hero_1" height="lg" overlay="50">',
  '  <bent-heading id="hero_h" level="2" align="center" animate="rise">צילה ברזל</bent-heading>',
  '  <bent-text id="hero_t" align="center" size="lg">היא מחפשת נקמה.</bent-text>',
  '  <bent-button id="hero_b" href="/ch2" variant="outline" align="center">לפרק הבא</bent-button>',
  '  <bent-spacer id="hero_sp" size="sm" />',
  '  <bent-text id="hero_t2">שורה שנייה</bent-text>',
  '</bent-hero>'
].join('\n');
const heroOf = (s) => { const i = s.indexOf('<bent-hero'); return i < 0 ? '' : s.slice(i, s.indexOf('</bent-hero>', i) + 12); };
const toBlocks = (src) => JSON.parse(JSON.stringify(toTapuzPage(pzn.parse(src))));
const toSource = (page) => pzn.serialize(fromTapuzPage(page));
const kidsOf = (heroSrc) => pzn.parse(shell(heroSrc)).body[0].children;

// ── 1. the round trip keeps everything ──
{
  const page = toBlocks(shell(HERO));
  const back = heroOf(toSource(page));
  const kids = kidsOf(back);
  check('pzn → blocks → pzn keeps every child, in order (heading, text, button, spacer, text)',
    kids.map((k) => k.name).join(',') === 'heading,text,button,spacer,text');
  check('…with every child id', kids.map((k) => k.id).join(',') === 'hero_h,hero_t,hero_b,hero_sp,hero_t2');
  check('…and every prop: level 2 + align + animate, size lg, variant outline + href, spacer size',
    kids[0].props.level === 2 && kids[0].props.align === 'center' && kids[0].props.animate === 'rise' &&
    kids[1].props.size === 'lg' && kids[2].props.variant === 'outline' && kids[2].props.href === '/ch2' && kids[3].props.size === 'sm');
  check('the builder\'s four fields are still filled from the first heading/text/button',
    page.blocks[0].data.title === 'צילה ברזל' && page.blocks[0].data.subtitle === 'היא מחפשת נקמה.' &&
    page.blocks[0].data.buttonText === 'לפרק הבא' && page.blocks[0].data.buttonUrl === '/ch2');
}

// ── 2. the builder form's edits land on the children ──
{
  const edit = (patch) => { const p = toBlocks(shell(HERO)); Object.assign(p.blocks[0].data, patch); return kidsOf(heroOf(toSource(p))); };
  const t = edit({ title: 'צילה ברזל חוזרת' });
  check('a new title changes the first heading\'s text — its id, level and align stay', t[0].text === 'צילה ברזל חוזרת' && t[0].id === 'hero_h' && t[0].props.level === 2);
  const s = edit({ subtitle: '' });
  check('clearing the subtitle removes the FIRST text only (hero_t2 stays)', s.map((k) => k.id).join(',') === 'hero_h,hero_b,hero_sp,hero_t2');
  const b = edit({ buttonText: 'המשך', buttonUrl: '/ch3' });
  check('button text + url edit the first button, variant kept', b[2].text === 'המשך' && b[2].props.href === '/ch3' && b[2].props.variant === 'outline');
  const nb = edit({ buttonText: '' });
  check('clearing the button text removes the button', !nb.some((k) => k.name === 'button'));
  const bare = toBlocks(shell('<bent-hero id="h"><bent-spacer id="sp" size="sm" /></bent-hero>'));
  Object.assign(bare.blocks[0].data, { title: 'כותרת', subtitle: 'משנה', buttonText: 'כפתור', buttonUrl: '/x' });
  const ins = kidsOf(heroOf(toSource(bare)));
  check('fields set on a hero without such children insert them where the trio goes (heading, text, button) — the spacer stays',
    ins.map((k) => k.name).join(',') === 'heading,text,button,spacer' && ins[2].props.href === '/x');
  check('heroChildren never mutates the stored blocks', (() => {
    const p = toBlocks(shell(HERO)); const before = JSON.stringify(p.blocks[0].data.blocks);
    p.blocks[0].data.title = 'שונה'; heroChildren(p.blocks[0].data);
    return JSON.stringify(p.blocks[0].data.blocks) === before;
  })());
}

// ── 3. a hero made in the builder (no children) is exactly what it was ──
{
  const legacy = { type: 'hero', id: 'hero_x', data: { title: 'כותרת ראשית', subtitle: 'משנה', buttonText: 'לחצו', buttonUrl: '/go', height: 'md' } };
  check('a builder hero (no data.blocks) → the old heading/text/button trio',
    kidsOf(heroOf(toSource({ title: 't', slug: 't', direction: 'rtl', blocks: [legacy] }))).map((k) => k.name + ':' + k.text).join('|') === 'heading:כותרת ראשית|text:משנה|button:לחצו');
  const plain = toBlocks(toSource({ title: 't', slug: 't', direction: 'rtl', blocks: [JSON.parse(JSON.stringify(legacy))] }));
  check('…and its round trip stores no data.blocks (the flat fields already ARE that hero)', !('blocks' in plain.blocks[0].data));
  const withId = toBlocks(shell('<bent-hero id="h"><bent-heading id="t" level="1">כותרת</bent-heading></bent-hero>'));
  check('a trio child carrying an id is more than the flat fields → data.blocks is kept', Array.isArray(withId.blocks[0].data.blocks));
  const { renderBlock } = require('../src/renderer');
  const html = renderBlock(legacy, 'rtl');
  check('…and the live renderer draws it exactly as before (<h1>, <p class="subtitle">, .btn-primary)',
    /<h1>כותרת ראשית<\/h1><p class="subtitle">משנה<\/p><a href="\/go" class="btn btn-primary">לחצו<\/a><\/section>$/.test(html));
}

// ── 4. the live page shows what the proposal showed ──
{
  const { renderBlock } = require('../src/renderer');
  const page = toBlocks(shell(HERO));
  const live = renderBlock(page.blocks[0], 'rtl');
  const preview = pzn.buildPreviewHtml ? pzn.buildPreviewHtml(pzn.parse(shell(HERO)), {}) : pzn.compile(pzn.parse(shell(HERO)));
  const texts = ['צילה ברזל', 'היא מחפשת נקמה.', 'לפרק הבא', 'שורה שנייה'];
  check('the live renderer draws every child the preview draws (both texts, the heading, the button)',
    texts.every((t) => live.includes(t) && String(preview).includes(t)));
  check('…at the authored heading level (<h2>), the spacer included',
    /<h2 id="hero_h"[^>]*>צילה ברזל<\/h2>/.test(live) && /id="hero_sp" class="spacer"/.test(live));
  check('…and the first text wears .subtitle so the theme\'s hero rules still apply (the second does not)',
    /id="hero_t" class="[^"]*\bsubtitle\b/.test(live) && !/id="hero_t2" class="[^"]*\bsubtitle\b/.test(live));
}

// ── 5. the builder's own save path, on a real page ──
{
  require('../src/db');
  require('../src/setup').runSetup({
    title: 'אתר', description: 'hero', colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const pages = require('../src/pages');
  pages.createPage({ title: 'פרק', slug: 'hero-page', blocks: [] });
  pages.savePageSource('hero-page', shell(HERO, 'hero-page'), { publish: false });
  const page = pages.getPageByFullPath('hero-page');
  pages.updatePage('hero-page', { title: page.title, blocks: JSON.parse(JSON.stringify(page.draft_blocks)), publish: false });
  const after = heroOf(pages.getPageSource('hero-page', 'draft'));
  const ids = (after.match(/\bid="[^"]+"/g) || []).map((x) => x.slice(4, -1));
  check('a builder save keeps the hero\'s five children and their ids', ['hero_h', 'hero_t', 'hero_b', 'hero_sp', 'hero_t2'].every((i) => ids.includes(i)));
  check('…and the page still validates', pzn.validate(pzn.parse(pages.getPageSource('hero-page', 'draft')), { strict: false }).filter((i) => i.severity === 'error').length === 0);
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

// ── 6. the canvas says what else the hero holds; a copy repeats no id ──
{
  const builder = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-builder.js'), 'utf8');
  const fresh = (builder.match(/function freshIds\(b\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('duplicating a block renews its items\' ids and a hero\'s children ids (no two of one id on a page)',
    /\['items', 'images', 'fields', 'rows'\]/.test(fresh) && /it\.id = uid\('item'\) \+ '_' \+ i/.test(fresh) &&
    /b\.type === 'hero' && Array\.isArray\(d\.blocks\)\) d\.blocks\.forEach\(freshIds\)/.test(fresh));
  check('the builder canvas names the hero\'s extra children ("+ N רכיבים נוספים בפתיח")',
    /preview-hero-more/.test(builder) && /רכיבים נוספים בפתיח/.test(builder));
}

console.log('');
console.log(fail ? 'SMOKE HERO: FAIL' : 'SMOKE HERO: PASS');
process.exit(fail ? 1 : 0);
