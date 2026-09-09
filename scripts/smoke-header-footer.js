'use strict';

/**
 * QA — page header / footer modules (bent-header / HEADER, bent-footer /
 * FOOTER). CSS-only chrome a marketer edits on the canvas. Site manifest
 * `.site-header` / `.site-footer` stay; these are page blocks.
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const bentml = require('../src/bentml');
const { htmlToBlocks } = require('../src/pzn/graduate');
const { huntBlocks } = require('../src/pzn/hunt');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const headerBlock = {
  type: 'header', id: 'h1',
  data: {
    logo: '/demo/tile-1.svg', title: 'הסטודיו', url: '/',
    items: [{ label: 'בית', href: '/' }, { label: 'אודות', href: '/about' }]
  }
};
const footerBlock = {
  type: 'footer', id: 'f1',
  data: {
    copy: '© הסטודיו 2026',
    items: [{ label: 'פרטיות', href: '/privacy' }, { label: 'תנאי שימוש', href: '/terms' }]
  }
};

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [headerBlock, footerBlock]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const hd = back.blocks.find((b) => b.type === 'header');
const ft = back.blocks.find((b) => b.type === 'footer');
check('header round-trips (logo + 2 links)', hd && hd.data.logo === '/demo/tile-1.svg' && hd.data.items.length === 2);
check('footer round-trips (copy + links)', ft && /הסטודיו/.test(ft.data.copy) && ft.data.items.length === 2);
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
const renderedH = renderBlock(headerBlock, 'rtl');
const renderedF = renderBlock(footerBlock, 'rtl');
check('compile: bent-header', /class="bent-header/.test(compiled) && /bent-header-logo/.test(compiled));
check('compile: bent-footer', /class="bent-footer/.test(compiled) && /bent-footer-copy/.test(compiled));
check('render header links', /אודות/.test(renderedH) && /bent-header-link/.test(renderedH));
check('render footer copy', /© הסטודיו/.test(renderedF));
check('javascript: url neutralized', !/javascript:/i.test(renderBlock({
  type: 'header', id: 'e', data: { items: [{ label: 'x', href: 'javascript:alert(1)' }] }
}, 'rtl')));
check('no <script> in output', !/<script/i.test(renderedH + renderedF));
check('registry + seed', !!getBlockDef('header') && !!getBlockDef('footer')
  && (defaultDataFor('header').items || []).length >= 2);

const kw = bentml.compile(`BENTML 0.2

META {
  title: "כרום"
}

HEADER(logo: "/demo/tile-1.svg", title: "הסטודיו", url: "/") {
  HEADLINK(url: "/") { בית }
  HEADLINK(url: "/about") { אודות }
}

FOOTER(copy: "© הסטודיו") {
  FOOTLINK(url: "/privacy") { פרטיות }
}
`);
check('keyword compiles HEADER/FOOTER', kw.blocks[0] && kw.blocks[0].type === 'header'
  && kw.blocks[1] && kw.blocks[1].type === 'footer');
const src = bentml.decompile({ title: 'x' }, [headerBlock, footerBlock]);
check('decompile emits HEADER/FOOTER', /HEADER\(/.test(src) && /FOOTER\(/.test(src) && /HEADLINK\(/.test(src));
const round = bentml.compile(src);
check('keyword header/footer round-trip', round.blocks[0].type === 'header'
  && round.blocks[0].data.items[1].label === 'אודות'
  && round.blocks[1].data.copy === '© הסטודיו 2026');

const land = htmlToBlocks(
  '<header class="site-header">'
  + '<a href="/"><img src="/logo.png" alt="לוגו"></a>'
  + '<h1>הסטודיו</h1>'
  + '<nav><a href="/">בית</a><a href="/about">אודות</a><a href="/contact">צור קשר</a></nav>'
  + '</header>'
);
check('decompile <header> → header module',
  land.blocks.some((b) => b.type === 'header' && (b.data.items || []).length >= 2
    && b.data.logo === '/logo.png')
  && !land.suggestedTools.includes('header'));

const footLand = htmlToBlocks(
  '<footer class="site-footer">'
  + '<a href="/privacy">פרטיות</a><a href="/terms">תנאי שימוש</a>'
  + '<p class="copyright">© 2026 הסטודיו</p>'
  + '</footer>'
);
check('decompile <footer> → footer module',
  footLand.blocks.some((b) => b.type === 'footer' && /2026/.test(b.data.copy)
    && (b.data.items || []).length >= 2)
  && !footLand.suggestedTools.includes('footer'));

const hunted = huntBlocks(
  '<header class="page-header"><a href="/home">בית</a><a href="/blog">בלוג</a></header>'
  + '<main><p>תוכן</p></main>'
);
check('hunt maps <header> landmark → header',
  (hunted.blocks || []).some((b) => b.type === 'header' && (b.data.items || []).length >= 2));

const own = htmlToBlocks(renderedH);
check('our own bent-header HTML maps back',
  own.blocks.some((b) => b.type === 'header' && (b.data.items || []).length >= 2));

console.log('');
console.log(fail ? 'SMOKE HEADER-FOOTER: FAIL' : 'SMOKE HEADER-FOOTER: PASS');
process.exit(fail ? 1 : 0);
