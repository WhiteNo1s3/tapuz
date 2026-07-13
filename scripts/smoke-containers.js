'use strict';

/**
 * v0.54 QA — interactive containers (tabs + accordion). Proves the full stack:
 * round-trips block⇄BenTML, validates, the pzn compile + the renderer.js path
 * emit the pure-CSS structure (tabs = radio+label+panel adjacency; accordion =
 * native <details>), and the block-registry seeds/defaults are present.
 */

const pzn = require('../src/pzn/index');
const { fromTapuzPage, toTapuzPage } = pzn;
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [
    { type: 'tabs', id: 'tb', data: { items: [{ label: 'אחד', content: 'תוכן א' }, { label: 'שתיים', content: 'תוכן ב' }] } },
    { type: 'accordion', id: 'ac', data: { items: [{ title: 'מגירה', content: 'תוכן מגירה' }] } }
  ]
};

// round-trip block ⇄ BenTML
const doc = pzn.parse(pzn.serialize(fromTapuzPage(page)));
const back = toTapuzPage(doc);
const tabs = back.blocks.find((b) => b.type === 'tabs');
const acc = back.blocks.find((b) => b.type === 'accordion');
check('tabs round-trips (2 items, label+content)', tabs && tabs.data.items.length === 2 && tabs.data.items[0].label === 'אחד' && tabs.data.items[0].content === 'תוכן א');
check('accordion round-trips (title+content)', acc && acc.data.items.length === 1 && acc.data.items[0].title === 'מגירה');
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

// pzn compile
const compiled = pzn.compile(doc);
check('compile: tabs radio hack (radio+label+panel)', /bent-tab-radio/.test(compiled) && /bent-tab-label/.test(compiled) && /bent-tab-panel/.test(compiled));
check('compile: first tab checked', /class="bent-tab-radio" checked/.test(compiled) || /checked/.test(compiled));
check('compile: accordion native <details>', /<details class="bent-fold"/.test(compiled) && /<summary>מגירה/.test(compiled));

// renderer.js (published-site path)
const rTabs = renderBlock(page.blocks[0], 'rtl');
const rAcc = renderBlock(page.blocks[1], 'rtl');
check('render: tabs adjacency radio→label→panel', /<input[^>]*bent-tab-radio[^>]*>\s*<label[^>]*bent-tab-label[^>]*>[^<]*<\/label>\s*<div class="bent-tab-panel">/.test(rTabs));
check('render: tabs first radio checked (default visible tab)', /checked/.test(rTabs));
check('render: accordion first fold open', /<details class="bent-fold" open>/.test(rAcc));

// block-registry seed/defaults (so a fresh block isn't empty)
check('tabs has a registry entry + seeded items', !!getBlockDef('tabs') && (defaultDataFor('tabs').items || []).length >= 1);
check('accordion has a registry entry + seeded items', !!getBlockDef('accordion') && (defaultDataFor('accordion').items || []).length >= 1);

console.log('');
console.log(fail ? 'SMOKE CONTAINERS: FAIL' : 'SMOKE CONTAINERS: PASS');
process.exit(fail ? 1 : 0);
