'use strict';

/**
 * v0.62 QA — the video module (batch item 4: native self-hosted <video>,
 * graduated from RESERVED). Round-trip, compile/render parity via the shared
 * video-html.js, the YouTube-URL→embed fallback, the autoplay→muted browser-
 * policy enforcement, safeHref on src/poster, the single-merged-style split,
 * and the decompiler loop (<video> → video block, no longer a toolGap).
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const { htmlToBlocks } = require('../src/pzn/graduate');
const { RESERVED } = require('../src/bentml/keywords');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'video', id: 'v1',
    data: { src: '/assets/clip.mp4', poster: '/assets/p.jpg', caption: 'הסרטון שלנו', controls: true, autoplay: true, loop: true }
  }]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const v = back.blocks.find((b) => b.type === 'video');
check('video round-trips (src + poster + caption + flags)',
  v && v.data.src === '/assets/clip.mp4' && v.data.poster === '/assets/p.jpg' && v.data.caption === 'הסרטון שלנו' &&
  !!v.data.controls && !!v.data.autoplay && !!v.data.loop);
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
const rendered = renderBlock(page.blocks[0], 'rtl');
const shapes = [
  ['native <video> with src', /<video src="\/assets\/clip\.mp4"/],
  ['poster attribute', /poster="\/assets\/p\.jpg"/],
  ['controls attribute', /<video[^>]*\scontrols/],
  ['caption', /<figcaption class="bent-video-caption">הסרטון שלנו<\/figcaption>/]
];
for (const [nm, re] of shapes) {
  check('compile: ' + nm, re.test(compiled));
  check('render: ' + nm, re.test(rendered));
}
// browser policy: autoplay is impossible without muted → force muted + playsinline
check('autoplay forces muted + playsinline', /<video[^>]*\sautoplay playsinline[^>]*\smuted/.test(rendered));

// ── YouTube src → the embed iframe (forgiving fallback) ──────────────
const yt = renderBlock({ type: 'video', id: 'y', data: { src: 'https://youtu.be/dQw4w9WgXcQ', caption: 'יוטיוב' } }, 'rtl');
check('YouTube src → iframe embed, not <video>', /youtube\.com\/embed\/dQw4w9WgXcQ/.test(yt) && !/<video/.test(yt));
check('YouTube fallback keeps the caption', /bent-video-caption">יוטיוב/.test(yt));

// ── security: executable URL schemes neutralized ─────────────────────
const evil = renderBlock({ type: 'video', id: 'e', data: { src: 'javascript:alert(1)', poster: 'javascript:alert(2)' } }, 'rtl');
check('javascript: src neutralized', !/javascript:/i.test(evil));

// ── empty + fallbacks + regressions ──────────────────────────────────
check('empty src → placeholder, no <video>', /bent-video-empty/.test(renderBlock({ type: 'video', id: 'n', data: {} }, 'rtl')));
check('muted alone (no autoplay) still mutes', /<video[^>]*\smuted/.test(renderBlock({ type: 'video', id: 'm', data: { src: '/a.mp4', muted: true } }, 'rtl')));
check('no controls when controls:false', !/\scontrols/.test(renderBlock({ type: 'video', id: 'c', data: { src: '/a.mp4', controls: false } }, 'rtl')));
// regression: className + generic align must NOT produce a duplicate style attr,
// and the class must land INSIDE class="" (not as a stray boolean attribute)
const styled = renderBlock({ type: 'video', id: 's', data: { src: '/a.mp4', className: 'featured', align: 'center' } }, 'rtl');
check('single style attr + class inside class=""',
  (styled.match(/style="/g) || []).length === 1 && /class="bent-video featured"/.test(styled));
check('video registry entry + seeds controls', !!getBlockDef('video') && defaultDataFor('video').controls === true);
check('VIDEO graduated from RESERVED', !RESERVED.has('VIDEO'));

// ── decompile loop closed ────────────────────────────────────────────
const g = htmlToBlocks('<video src="/m.mp4" poster="/p.jpg" controls loop></video>');
const gv = g.blocks.find((b) => b.type === 'video');
check('decompile <video src> → video block', gv && gv.data.src === '/m.mp4' && gv.data.poster === '/p.jpg' && gv.data.controls === true && gv.data.loop === true);
check('video is no longer a toolGap', !g.suggestedTools.includes('video'));
// <source> child form
const g2 = htmlToBlocks('<video controls><source src="/x.webm" type="video/webm"></video>');
check('decompile <video><source> → video block', g2.blocks.some((b) => b.type === 'video' && b.data.src === '/x.webm'));
// v2.22: audio graduated — the decompiler maps it to the native module
const g3 = htmlToBlocks('<audio src="/a.mp3" controls></audio>');
check('audio decompiles to the native audio block (v2.22 closed this gap)',
  g3.blocks.some((b) => b.type === 'audio' && b.data.src === '/a.mp3') &&
  !g3.suggestedTools.includes('audio'));

console.log('');
console.log(fail ? 'SMOKE VIDEO: FAIL' : 'SMOKE VIDEO: PASS');
process.exit(fail ? 1 : 0);
