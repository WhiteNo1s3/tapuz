'use strict';

/**
 * v0.80 QA gate — the AUDIO module (the last media graduation):
 *   renderer HTML · bridge round-trip · BenTML compile/decompile round-trip ·
 *   YouTube forgiveness · safety contracts. Exit 1 on any failure.
 */

const { renderAudio } = require('../src/pzn/audio-html');
const { renderBlock } = require('../src/renderer');
const { fromTapuzPage, toTapuzPage, serialize, parse } = require('../src/pzn/index');
const { compile } = require('../src/bentml/compile');
const { decompile } = require('../src/bentml/decompile');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

const DATA = { src: '/uploads/episode.mp3', caption: 'פרק 1 — פתיחה', loop: true };
const BLOCK = { type: 'audio', id: 'audio_1_zz', data: DATA };

// ── renderer HTML ──
const html = renderAudio(DATA, { dir: ' dir="rtl"' });
check(html.includes('<audio '), 'renders a native <audio>');
check(html.includes(' controls'), 'controls are ALWAYS on');
check(html.includes('preload="metadata"'), 'preload metadata (duration, not bandwidth)');
check(html.includes(' loop'), 'loop rides through');
check(html.includes('פרק 1 — פתיחה'), 'caption rendered');
check(!html.includes('autoplay'), 'no autoplay — the language does not offer it');
check(renderBlock(BLOCK, 'rtl').includes('bent-audio'), "renderer case 'audio' wired");

// hostile src neutralized
const hostile = renderAudio({ src: 'javascript:alert(1)' });
check(!hostile.includes('javascript:'), 'hostile src neutralized (safeHref)');

// empty src → visible placeholder, never a broken player (invariant I1)
check(renderAudio({}).includes('bent-audio-empty'), 'empty src → visible placeholder');

// YouTube forgiveness — podcasts live on YouTube
const yt = renderAudio({ src: 'https://youtu.be/dQw4w9WgXcQ' });
check(yt.includes('youtube.com/embed/dQw4w9WgXcQ'), 'YouTube src degrades to the embed');

// ── pzn bridge + serialize round-trip ──
const page = { title: 'שמע', slug: 'audio-test', blocks: [BLOCK] };
const pzn = serialize(fromTapuzPage(page), { pretty: true });
check(pzn.includes('<bent-audio'), '.pzn carries the audio tag');
const back = toTapuzPage(parse(pzn)).blocks[0];
check(back && back.type === 'audio' && back.data.src === DATA.src && String(back.data.loop) === 'true',
  'pzn round-trip keeps src/loop');

// ── BenTML round-trip ──
const src = decompile({ title: 'x' }, [BLOCK]);
check(src.includes('AUDIO(src: "/uploads/episode.mp3", caption: "פרק 1 — פתיחה", loop: true)'),
  'decompiles to AUDIO with params');
const out = compile(src);
const b3 = out.blocks[0];
check(b3 && b3.type === 'audio' && b3.data.src === DATA.src && b3.data.loop === true && b3.data.caption === DATA.caption,
  'BenTML compiles back losslessly');

// missing required src → E306
let e306 = false;
try {
  compile('BENTML 0.2\n\nMETA {\n  title: "x"\n}\n\nAUDIO(caption: "בלי קובץ")\n');
} catch (e) {
  e306 = e.code === 'E306';
}
check(e306, 'AUDIO without src → E306');

console.log('');
if (failures) {
  console.log('SMOKE AUDIO: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE AUDIO: PASS');
