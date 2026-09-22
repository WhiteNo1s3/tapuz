'use strict';

/**
 * v2.54 QA — a block's chrome lands INSIDE its attributes, on every type.
 *
 * The bug (renderer.js, since v0.38): renderBlock glued the block's class
 * TOKENS — className, the universal animate (v1.97), per-device hideOn
 * (v2.12) — its anchor ` id="…"` and its ` style="…"` into ONE `extra`
 * string, and most cases pasted that string AFTER their own class="…":
 *
 *   <form class="bent-search" role="search" … promo anim-fade id="x">
 *
 * The tokens became bogus bare attributes. A custom class, an entrance
 * animation or "hide on mobile" silently did nothing on 55 of the 73 block
 * types — on the live export, since renderPage renders every page through
 * renderBlock. smoke-animate never saw it: it tested image + heading (two of
 * the few right cases) and matched /anim-zoom/ anywhere in the string —
 * which a bare attribute satisfies.
 *
 * What this pins, for EVERY type in the block registry (smoke-registry pins
 * registry ⇄ renderBlock cases, so a type added tomorrow is covered here the
 * day it lands):
 *   - the root element's class="" holds x-mark, anim-fade, hide-on-mobile
 *   - no element wears a chrome token as a bare attribute
 *   - the anchor id="" appears exactly once
 *   - the paint lands inside a style="", and no element carries the same
 *     attribute twice (a second style="" is dropped by the browser — the
 *     spacer lost its height that way)
 *   - without chrome, no debris (empty class="", "undefined")
 *   - the branches: YouTube vs plain embed/video, marquee vs motion, hero
 *     with authored children, ratio'd columns, nested containers
 *   - blockOpts() — the one seam renderer.js → the shared *-html helpers
 *   - the pzn registry path (which always passed { idAttr, cls } apart)
 *     still emits the chrome on every shared module
 *
 * Run: node scripts/smoke-extra-attrs.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-extra-attrs-'));
process.env.TAPUZ_ROOT = ROOT;

let failed = 0;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) failed++;
}

const { renderBlock } = require('../src/renderer');
const { BLOCK_REGISTRY, defaultDataFor } = require('../src/block-registry');
const { blockOpts } = require('../src/pzn/block-attrs');
const reg = require('../src/pzn/modules/registry');
const pzn = require('../src/pzn/index');
const { createPage, publishPage } = require('../src/pages');

// article-list renders only when a published article exists
createPage({
  title: 'מאמר לבדיקה',
  slug: 'extra-attrs-article',
  tags: ['article'],
  blocks: [{ type: 'text', id: 't1', data: { content: 'טקסט המאמר.' } }],
  status: 'draft'
});
publishPage('extra-attrs-article');

// ── a strict start-tag reader: every attribute, by name ─────────────
function startTags(html) {
  const clean = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1>/gi, '<$1$2></$1>');
  const tags = [];
  const tagRe = /<([a-zA-Z][\w-]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(clean))) {
    const attrs = [];
    const attrRe = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a;
    while ((a = attrRe.exec(m[2]))) {
      attrs.push({ name: a[1].toLowerCase(), value: a[2] ?? a[3] ?? a[4] ?? null });
    }
    tags.push({ tag: m[1].toLowerCase(), attrs });
  }
  return tags;
}
const attrOf = (t, name) => (t.attrs.find((a) => a.name === name) || {}).value;
const classTokens = (t) => String(attrOf(t, 'class') || '').split(/\s+/).filter(Boolean);

const TOKENS = ['x-mark', 'anim-fade', 'hide-on-mobile'];
const ANCHOR = 'anchor1';
const PAINT = 'color:#123456';
const CHROME = { className: 'x-mark', animate: 'fade', style: { hideOn: 'mobile', color: '#123456' } };

/** Everything wrong with one rendered block's chrome ([] = right). */
function chromeProblems(html, tokens = TOKENS, paint = PAINT) {
  const tags = startTags(html);
  if (!tags.length) return ['no element rendered: ' + String(html).slice(0, 80)];
  const out = [];
  const root = tags[0];
  const missing = tokens.filter((k) => !classTokens(root).includes(k));
  if (missing.length) out.push(`root <${root.tag}> class="${attrOf(root, 'class') || ''}" lacks ${missing.join(', ')}`);
  for (const t of tags) {
    const bare = t.attrs.filter((a) => TOKENS.includes(a.name));
    if (bare.length) out.push(`bare attribute ${bare.map((a) => a.name).join(' ')} on <${t.tag}>`);
    const names = t.attrs.map((a) => a.name);
    const twice = names.filter((n, i) => names.indexOf(n) !== i);
    if (twice.length) out.push(`<${t.tag}> carries ${[...new Set(twice)].join(', ')} twice`);
  }
  const ids = tags.filter((t) => attrOf(t, 'id') === ANCHOR).length;
  if (ids !== 1) out.push(`id="${ANCHOR}" ×${ids}`);
  if (paint && !tags.some((t) => String(attrOf(t, 'style') || '').includes(paint))) out.push(`${paint} not inside a style=""`);
  return out;
}

const withChrome = (type, data, extra) => ({
  type,
  id: ANCHOR,
  data: Object.assign({}, defaultDataFor(type), data || {}, CHROME, extra || {})
});
const report = (label, problems) => check(label + (problems.length ? ' — ' + problems.join('; ') : ''), problems.length === 0);

// ── every block type, chrome on ──────────────────────────────────────
for (const def of BLOCK_REGISTRY) {
  const html = renderBlock(withChrome(def.type), 'rtl');
  report(`${def.type}: class tokens inside class="", id once, paint in style`, chromeProblems(html));
}

// ── the branches a default block does not take ───────────────────────
const branches = [
  ['embed (YouTube → figure)', withChrome('embed', { url: 'https://youtu.be/dQw4w9WgXcQ' })],
  ['embed (plain link → a)', withChrome('embed', { url: 'https://example.com/page' })],
  ['video (YouTube fallback)', withChrome('video', { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })],
  ['video (self-hosted)', withChrome('video', { src: '/assets/clip.mp4' })],
  ['marquee (scrolling track)', withChrome('marquee', { text: 'חדשות', effect: 'marquee' })],
  ['marquee (motion text)', withChrome('marquee', { text: 'חדשות', effect: 'typewriter' })],
  ['hero (authored children)', withChrome('hero', { blocks: [
    { type: 'heading', id: 'heading_1', data: { text: 'כותרת' } },
    { type: 'text', id: 'text_1', data: { content: 'משנה' } }
  ] })],
  ['columns (ratio → one merged style)', withChrome('columns', { ratio: '2:1', columns: [{ blocks: [] }, { blocks: [] }] })],
  ['list (ordered)', withChrome('list', { ordered: true, items: ['א', 'ב'] })],
  ['section (with a child)', withChrome('section', { blocks: [{ type: 'text', id: 'text_2', data: { content: 'בפנים' } }] })],
  ['card (with a child)', withChrome('card', { blocks: [{ type: 'text', id: 'text_3', data: { content: 'בפנים' } }] })]
];
for (const [label, block] of branches) report(`${label}: chrome lands`, chromeProblems(renderBlock(block, 'rtl')));

check('columns ratio + paint share ONE style="" (the grid fractions survive)', (() => {
  const root = startTags(renderBlock(withChrome('columns', { ratio: '2:1', columns: [{ blocks: [] }, { blocks: [] }] }), 'rtl'))[0];
  const s = String(attrOf(root, 'style') || '');
  return s.includes('--cols:2fr 1fr') && s.includes(PAINT);
})());
check('spacer keeps its height when painted (was a second, dropped style="")', (() => {
  const root = startTags(renderBlock(withChrome('spacer', { height: '3rem' }), 'rtl'))[0];
  const s = String(attrOf(root, 'style') || '');
  return s.includes('height:3rem') && s.includes(PAINT);
})());
check('nested children keep THEIR own chrome (a child is a block like any other)', (() => {
  const html = renderBlock(withChrome('section', { blocks: [
    { type: 'faq', id: 'kid1', data: { className: 'kid-mark', animate: 'rise', items: [] } }
  ] }), 'rtl');
  const kid = startTags(html).find((t) => attrOf(t, 'id') === 'kid1');
  return !!kid && classTokens(kid).includes('kid-mark') && classTokens(kid).includes('anim-rise') &&
    !startTags(html).some((t) => t.attrs.some((a) => a.name === 'kid-mark' || a.name === 'anim-rise'));
})());
check('className alone (no animate, no hideOn) lands too', (() => {
  const html = renderBlock({ type: 'search', id: ANCHOR, data: { className: 'solo' } }, 'rtl');
  const root = startTags(html)[0];
  return classTokens(root).includes('solo') && !root.attrs.some((a) => a.name === 'solo');
})());
check('hideOn alone lands on a helper-rendered module (whatsapp)', (() => {
  const html = renderBlock({ type: 'whatsapp', data: { phone: '0501234567', style: { hideOn: 'desktop' } } }, 'rtl');
  return classTokens(startTags(html)[0]).includes('hide-on-desktop');
})());
check('an escaped className stays one attribute value (no breakout)', (() => {
  const html = renderBlock({ type: 'search', id: ANCHOR, data: { className: 'a" onclick="x' } }, 'rtl');
  const root = startTags(html)[0];
  return !root.attrs.some((a) => a.name === 'onclick') && String(attrOf(root, 'class')).includes('a&quot;');
})());

// ── no chrome → no debris ────────────────────────────────────────────
for (const def of BLOCK_REGISTRY) {
  const html = renderBlock({ type: def.type, data: defaultDataFor(def.type) }, 'rtl');
  const problems = [];
  if (/\sclass=""/.test(html)) problems.push('empty class=""');
  if (/undefined|\[object Object\]/.test(html)) problems.push('undefined / [object Object] in the markup');
  for (const t of startTags(html)) {
    const names = t.attrs.map((a) => a.name);
    if (names.some((n, i) => names.indexOf(n) !== i)) problems.push(`<${t.tag}> repeats an attribute`);
  }
  report(`${def.type}: plain block renders clean`, problems);
}

// ── the seam itself ──────────────────────────────────────────────────
check('blockOpts maps renderBlock\'s pieces onto the helpers\' opts', (() => {
  const o = blockOpts('rtl', { cls: ' promo anim-fade', idAttr: ' id="x"', style: ' style="color:red"' });
  return o.dir === ' dir="rtl"' && o.cls === ' promo anim-fade' && o.idAttr === ' id="x"' && o.extra === ' style="color:red"';
})());
check('blockOpts with nothing → empty strings (never "undefined")', (() => {
  const o = blockOpts('', undefined);
  return o.dir === '' && o.cls === '' && o.idAttr === '' && o.extra === '';
})());
check('blockOpts escapes the direction', blockOpts('rtl"x', {}).dir === ' dir="rtl&quot;x"');
check('renderer.js no longer glues the chrome into one `extra` string', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const body = src.slice(src.indexOf('function renderBlock('), src.indexOf('function escapeHtml('));
  return !/\$\{extra\}/.test(body) && !/const extra\s*=/.test(body) && !/,\s*extra\)/.test(body);
})());

// ── the pzn registry path: every shared module still wears the chrome ─
// (it always passed { idAttr, cls } apart; hideOn and the paint are not
// registry chrome, so only className + animate are asked of it)
const blockTypes = new Set(BLOCK_REGISTRY.map((b) => b.type));
function requiredProps(mod) {
  return Object.entries(mod.props || {})
    .filter(([k, p]) => !p.content && k !== 'id' && k !== 'class' && !p.optional && p.default === undefined)
    .map(([k, p]) => ` ${k}="${Array.isArray(p.values) ? p.values[0] : p.type === 'integer' ? (p.min || 1) : 'x'}"`)
    .join('');
}
// modules that rightly render nothing when empty get the least content
const PZN_BODY = { banner: 'הודעה' };
const PZN_CTX = { dir: 'rtl', pretty: false, articles: [{ title: 'מאמר', url: '/a', tags: ['article'] }] };
for (const mod of reg.listModules().filter((m) => blockTypes.has(m.name))) {
  const src = '<!DOCTYPE html><html lang="he" dir="rtl" bent-version="0.1"><head><meta charset="utf-8" /><title>t</title></head><body>' +
    `<${mod.tag} id="${ANCHOR}" class="x-mark" animate="fade"${requiredProps(mod)}>${PZN_BODY[mod.name] || ''}</${mod.tag}></body></html>`;
  let problems;
  try {
    const html = pzn.compileFragment(pzn.parse(src).body, PZN_CTX);
    problems = chromeProblems(html, ['x-mark', 'anim-fade'], null);
  } catch (e) {
    problems = ['compile threw: ' + e.message];
  }
  report(`pzn <${mod.tag}>: class tokens inside class="", id once`, problems);
}

try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* tmp */ }
console.log(`\nSMOKE extra-attrs: ${failed ? 'FAIL (' + failed + ')' : 'PASS'}`);
process.exit(failed ? 1 : 0);
