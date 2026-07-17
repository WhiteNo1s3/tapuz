'use strict';

/**
 * v0.79 QA gate — the carousel module, across every layer:
 *   renderer HTML · pzn module compile parity · bridge round-trip ·
 *   BenTML compile/decompile round-trip · zero-JS + safety contracts.
 * Exit 1 on any failure.
 */

const { renderCarouselFromData } = require('../src/pzn/carousel-html');
const { renderBlock } = require('../src/renderer');
const { fromTapuzPage, toTapuzPage, serialize, parse } = require('../src/pzn/index');
const { compile } = require('../src/bentml/compile');
const { decompile } = require('../src/bentml/decompile');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

const DATA = {
  height: 'lg',
  peek: false,
  items: [
    { image: '/uploads/a.jpg', tag: 'חדש', title: 'שקופית ראשונה', excerpt: 'תקציר ראשון', href: '/a' },
    { title: 'בלי תמונה' },
    { image: '/uploads/b.jpg', href: 'javascript:alert(1)', title: 'קישור עוין' }
  ]
};
const BLOCK = { type: 'carousel', id: 'carousel_1_zz', data: DATA };

// ── renderer HTML ──
const html = renderCarouselFromData(DATA, 'rtl');
check(html.includes('bent-carousel-track'), 'renders a snap track');
check(html.includes('bent-carousel-lg'), 'height variant class');
check(html.includes('bent-carousel-full'), 'peek:false → full-width slides');
check((html.match(/bent-slide/g) || []).length === 3, 'one cell per slide');
check(html.includes('שקופית ראשונה') && html.includes('loading="lazy"'), 'card content + lazy images');
check(!html.includes('javascript:alert'), 'hostile href neutralized (safeHref)');
check(!/<script/i.test(html), 'zero JS in output');
check(renderBlock(BLOCK, 'rtl').includes('bent-carousel'), "renderer case 'carousel' wired");

// defaults: no params → md + peek
const dflt = renderCarouselFromData({ items: [{ title: 'א' }] }, 'rtl');
check(dflt.includes('bent-carousel-md') && !dflt.includes('bent-carousel-full'),
  'zero-param default: md height, peek on');

// ── pzn bridge + serialize round-trip ──
const page = { title: 'קרוסלה', slug: 'carousel-test', blocks: [BLOCK] };
const doc = fromTapuzPage(page);
const pzn = serialize(doc, { pretty: true });
check(pzn.includes('<bent-carousel') && pzn.includes('<bent-slide'), '.pzn carries carousel/slide tags');
const back = toTapuzPage(parse(pzn));
const b2 = back.blocks[0];
check(b2 && b2.type === 'carousel', 'pzn round-trip keeps the type');
check((b2.data.items || []).length === 3, 'pzn round-trip keeps all slides');
check(String(b2.data.height) === 'lg' && String(b2.data.peek) === 'false', 'pzn round-trip keeps height/peek');
check(b2.data.items[0].title === 'שקופית ראשונה' && b2.data.items[0].image === '/uploads/a.jpg',
  'pzn round-trip keeps slide fields');

// ── BenTML round-trip ──
const src = decompile({ title: 'x' }, [BLOCK]);
check(src.includes('CAROUSEL(height: lg, peek: false)'), 'decompiles to CAROUSEL with params');
check(src.includes('SLIDE(title: "שקופית ראשונה"'), 'slides decompile with fields');
const out = compile(src);
const b3 = out.blocks[0];
check(b3 && b3.type === 'carousel', 'BenTML compiles back to carousel');
check((b3.data.items || []).length === 3, 'BenTML round-trip keeps all slides');
check(b3.data.items[0].excerpt === 'תקציר ראשון', 'excerpt rides as the SLIDE body');
check(b3.data.height === 'lg' && b3.data.peek === false, 'height/peek round-trip');

// SLIDE outside CAROUSEL is a child-only error
let childGuard = false;
try {
  compile('BENTML 0.2\n\nMETA {\n  title: "x"\n}\n\nSLIDE(title: "בורח") { לא כאן }\n');
} catch (e) {
  childGuard = e.code === 'E104';
}
check(childGuard, 'SLIDE outside CAROUSEL → E104');

console.log('');
if (failures) {
  console.log('SMOKE CAROUSEL: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE CAROUSEL: PASS');
