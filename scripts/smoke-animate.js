'use strict';

/**
 * v1.97 QA — animation as the grok wanted: `animate=` is UNIVERSAL.
 *
 * The bug Ben pasted (the game demo): grok's document writes animate="fade"
 * / "slide-up" / "zoom" on ANY module. Our side had the prop on heading and
 * text only, with values fade|rise — so on every other module the attribute
 * was SILENTLY DROPPED (validate skips undeclared props, compile ignores
 * them: no repair note, no telemetry, nothing), and slide-up/zoom were
 * snapped to "none", killing the animation quietly.
 *
 * The properties under test:
 *   - every registered module accepts animate (incl. zoom), and its compiled
 *     HTML actually carries the anim-* class,
 *   - vocabulary drift is a DICTIONARY fix, not an error: slide-up → rise,
 *     zoom-in → zoom (PROP_ALIAS — the telemetry bucket that means "fix the
 *     dictionary"), while truly foreign values still snap to the default,
 *   - the attribute crosses the bridge both ways for every block type,
 *   - the JSON render path emits the class universally,
 *   - the CSS (theme SOURCE + loader) animates all three and respects
 *     prefers-reduced-motion,
 *   - Ben's exact pasted snippet flows the real paste pipeline clean.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-animate-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const reg = require('../src/pzn/modules/registry');
const pzn = require('../src/pzn/index');
const { repair } = require('../src/pzn/repair');
const { pznSourceToBlocks } = require('../src/pzn-source');
const { renderBlock } = require('../src/renderer');
const blockRegistry = require('../src/block-registry');

const shell = (body) => `<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
  <head><meta charset="utf-8" /><title>אנימציות</title></head>
  <body>${body}</body>
</html>`;

// ── the language: universal, zoom included ───────────────────────────
check('EVERY registered module accepts animate — with zoom', reg.moduleNames().every((n) => {
  const p = reg.getModule(n).props.animate;
  return p && p.type === 'enum' && p.values.includes('zoom') && p.values.includes('rise');
}));

check('animate compiles to the anim-* class on modules that never had it', (() => {
  const doc = pzn.parse(shell(`
    <bent-marquee id="m1" speed="md" animate="fade">חדשות ✦</bent-marquee>
    <bent-image id="i1" src="/assets/a.jpg" alt="תמונה" animate="zoom" />
    <bent-section id="s1" animate="rise"><bent-text id="t1">תוכן</bent-text></bent-section>`));
  const html = pzn.compile(doc);
  return html.includes('anim-fade') && html.includes('anim-zoom') && html.includes('anim-rise');
})());

check('heading still animates after the universal refactor (no regression)', (() => {
  const html = pzn.compile(pzn.parse(shell('<bent-heading id="h1" level="2" animate="zoom">שלום</bent-heading>')));
  return html.includes('anim-zoom') && html.includes('bent-heading');
})());

check('animate="none" (the default) emits NO class', (() => {
  const html = pzn.compile(pzn.parse(shell('<bent-text id="t1" animate="none">שקט</bent-text>')));
  return !html.includes('anim-');
})());

// ── repair: drift is a dictionary fix, not a killed animation ────────
check('slide-up → rise via PROP_ALIAS (the grok vocabulary lands)', (() => {
  const r = repair(shell('<bent-heading id="h1" level="2" animate="slide-up">כותרת</bent-heading>'));
  return r.ok && r.source.includes('animate="rise"') &&
    r.changes.some((c) => c.code === 'PROP_ALIAS' && /slide-up/.test(c.message));
})());
check('zoom-in → zoom, on a module that never declared animate', (() => {
  const r = repair(shell('<bent-marquee id="m1" speed="md" animate="zoom-in">✦</bent-marquee>'));
  return r.ok && r.source.includes('animate="zoom"') &&
    r.changes.some((c) => c.code === 'PROP_ALIAS');
})());
check('a truly foreign value still snaps to the default (PROP_ENUM)', (() => {
  const r = repair(shell('<bent-text id="t1" animate="spin">מסתובב?</bent-text>'));
  return r.ok && r.changes.some((c) => c.code === 'PROP_ENUM' && /spin/.test(c.message));
})());
check('marquee speed drift is aliased too (lg → fast)', (() => {
  const r = repair(shell('<bent-marquee id="m1" speed="lg">✦</bent-marquee>'));
  return r.ok && r.source.includes('speed="fast"') &&
    r.changes.some((c) => c.code === 'PROP_ALIAS' && /speed/.test(c.message));
})());

// ── Ben's exact paste, through the REAL paste pipeline ───────────────
check('the pasted game snippet flows the paste pipeline and keeps its animation demo', (() => {
  const { view } = pznSourceToBlocks(shell(
    '<bent-marquee id="marquee-anim" speed="md">      ✦ הדגמת אנימציות ✦ animate=&quot;fade&quot; ✦ animate=&quot;slide-up&quot; ✦ animate=&quot;zoom&quot; ✦ BenTML ✦</bent-marquee>'
  ));
  const m = view.blocks.find((b) => b.type === 'marquee' || (b.data && /הדגמת אנימציות/.test(JSON.stringify(b.data))));
  return !!m;
})());

// ── the bridge: animate crosses both ways for every type ─────────────
check('pzn → blocks carries animate for a type the bridge never listed', (() => {
  const { view } = pznSourceToBlocks(shell('<bent-image id="i1" src="/assets/a.jpg" alt="א" animate="zoom" />'));
  const img = view.blocks.find((b) => b.type === 'image');
  return img && img.data.animate === 'zoom';
})());
check('blocks → pzn source carries it back (roundtrip)', (() => {
  const { blocksToPznSource } = require('../src/pzn/bridge/tapuz-json');
  const src = blocksToPznSource
    ? blocksToPznSource([{ type: 'image', id: 'i1', data: { src: '/a.jpg', alt: 'א', animate: 'zoom' } }])
    : null;
  if (src === null) { // bridge exposes a different name — go through the module AST
    const { blockToModule } = require('../src/pzn/bridge/tapuz-json');
    const node = blockToModule({ type: 'image', id: 'i1', data: { src: '/a.jpg', alt: 'א', animate: 'zoom' } });
    return node && node.props.animate === 'zoom';
  }
  return /animate="zoom"/.test(src);
})());

// ── the JSON render path (the public page) ───────────────────────────
check('renderBlock emits anim-* universally (image, gallery-less types too)', (() => {
  const html = renderBlock({ type: 'image', data: { src: '/assets/a.jpg', alt: 'א', animate: 'zoom' } });
  return /anim-zoom/.test(html);
})());
check('renderBlock heading zoom works (was fade|rise only)', (() => {
  const html = renderBlock({ type: 'heading', data: { level: 2, text: 'שלום', animate: 'zoom' } });
  return /anim-zoom/.test(html);
})());
check('an invalid animate value renders NO class (fail quiet, never garbage)', (() => {
  const html = renderBlock({ type: 'image', data: { src: '/a.jpg', alt: 'א', animate: 'evil"' } });
  return !/anim-/.test(html);
})());

// ── the CSS, at its SOURCE ───────────────────────────────────────────
const themeCss = fs.readFileSync(path.join(__dirname, '..', 'themes', 'default', 'css', 'main.css'), 'utf8');
check('the theme SOURCE animates all three (scroll-driven + fallback)',
  /tapuz-zoom/.test(themeCss) && /\.anim-zoom/.test(themeCss) &&
  themeCss.includes('animation-timeline: view()'));
check('prefers-reduced-motion turns zoom off too',
  /prefers-reduced-motion: reduce[\s\S]*?\.anim-zoom[\s\S]*?animation: none/.test(themeCss) ||
  /\.anim-fade, \.anim-rise, \.anim-zoom \{ animation: none/.test(themeCss));
const loaderSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'pzn', 'loader', 'pzn-loader.js'), 'utf8');
check('the standalone .pzn loader animates zoom as well', /pzn-zoom/.test(loaderSrc) && /\.anim-zoom/.test(loaderSrc));

// ── the builder offers what the language accepts ─────────────────────
check('every builder block def offers the animate select (zoom included)',
  blockRegistry.BLOCK_REGISTRY.every((d) =>
    Array.isArray(d.params) && d.params.some((p) => p.name === 'animate' && p.enum && p.enum.includes('zoom'))));
check('the AI dictionary advertises animate as universal',
  blockRegistry.UNIVERSAL_PARAMS.some((p) => p.name === 'animate'));

console.log('');
console.log(fail ? 'SMOKE ANIMATE: FAIL' : 'SMOKE ANIMATE: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
