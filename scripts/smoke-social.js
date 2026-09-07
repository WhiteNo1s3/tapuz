'use strict';

/**
 * QA — social icons (bent-social / SOCIAL). CSS-only row of labeled
 * network links. Decompiler maps Elementor social-icons widgets.
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

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'social', id: 's1',
    data: {
      items: [
        { network: 'facebook', url: 'https://facebook.com/x', label: 'פייסבוק' },
        { network: 'github', url: 'https://github.com/x', label: 'גיטהאב' }
      ]
    }
  }]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const so = back.blocks.find((b) => b.type === 'social');
check('social round-trips (2 handles)', so && so.data.items.length === 2);
check('network + url survive', so && so.data.items[0].network === 'facebook'
  && so.data.items[1].url === 'https://github.com/x');
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
const rendered = renderBlock(page.blocks[0], 'rtl');
check('compile: bent-social nav', /class="bent-social/.test(compiled) && /bent-social-facebook/.test(compiled));
check('render: bent-social nav', /class="bent-social/.test(rendered) && /פייסבוק/.test(rendered));
check('javascript: url neutralized', !/javascript:/i.test(renderBlock({
  type: 'social', id: 'e', data: { items: [{ network: 'x', url: 'javascript:alert(1)', label: 'x' }] }
}, 'rtl')));
check('label is HTML-escaped', /&lt;script&gt;/.test(renderBlock({
  type: 'social', id: 'e2', data: { items: [{ network: 'x', url: '/', label: '<script>x</script>' }] }
}, 'rtl')));
check('no <script> in output', !/<script/i.test(rendered));
check('registry + seed', !!getBlockDef('social') && (defaultDataFor('social').items || []).length >= 2);
check('empty social renders wrapper', /class="bent-social"/.test(renderBlock({ type: 'social', id: 'z', data: { items: [] } }, 'rtl')));

const legacy = bentml.compile(`BENTML 0.2

META {
  title: "רשתות"
}

SOCIAL {
  HANDLE(network: "facebook", url: "https://facebook.com/x") { פייסבוק }
  HANDLE(network: "github", url: "https://github.com/x") { גיטהאב }
}
`);
check('legacy BentML compiles SOCIAL', legacy.blocks[0] && legacy.blocks[0].type === 'social' && legacy.blocks[0].data.items.length === 2);
const src = bentml.decompile({ title: 'x' }, [page.blocks[0]]);
check('legacy decompile emits SOCIAL/HANDLE', /SOCIAL/.test(src) && /HANDLE\(/.test(src));
const round = bentml.compile(src);
check('legacy social decompile → recompile', round.blocks[0].type === 'social' && round.blocks[0].data.items[0].label === 'פייסבוק');

const elIcons = htmlToBlocks(`
  <div class="elementor-widget elementor-widget-social-icons">
    <div class="elementor-social-icons-wrapper">
      <a class="elementor-social-icon elementor-social-icon-facebook" href="https://facebook.com/studio">Facebook</a>
      <a class="elementor-social-icon elementor-social-icon-github" href="https://github.com/studio">GitHub</a>
    </div>
  </div>
`);
const elB = elIcons.blocks.find((b) => b.type === 'social');
check('decompile Elementor social-icons → social module',
  !!elB && elB.data.items.length === 2 && elB.data.items[0].network === 'facebook'
  && elB.data.items[1].url === 'https://github.com/studio');

const hunted = huntBlocks(`
  <div class="social-icons">
    <a href="https://instagram.com/studio">אינסטגרם</a>
    <a href="https://linkedin.com/company/studio">לינקדאין</a>
  </div>
`);
check('hunt maps classed social-icons → social',
  (hunted.blocks || []).some((b) => b.type === 'social' && (b.data.items || []).length >= 2));

const own = htmlToBlocks(rendered);
check('our own bent-social HTML maps back to social',
  own.blocks.some((b) => b.type === 'social' && (b.data.items || []).length === 2
    && b.data.items[0].network === 'facebook'));

console.log('');
console.log(fail ? 'SMOKE SOCIAL: FAIL' : 'SMOKE SOCIAL: PASS');
process.exit(fail ? 1 : 0);
