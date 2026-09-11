'use strict';

/**
 * QA — blog article modules: CODE, AUTHOR, TAGS.
 * Tech leftover <pre> and WP byline/tag chips become canvas widgets.
 */

const pzn = require('../src/pzn/index');
const { decompileHtml } = require('../src/pzn/decompile');
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

const codeBlock = { type: 'code', id: 'c1', data: { lang: 'css', source: '.hero { color: red; }' } };
const authorBlock = {
  type: 'author', id: 'a1',
  data: { name: 'דנה כהן', role: 'עורכת', image: '/demo/tile-1.svg', url: '/author/dana', time: '9.9.2026' }
};
const tagsBlock = {
  type: 'tags', id: 't1',
  data: { items: [{ label: 'עיצוב', url: '/tag/design' }, { label: 'קוד', url: '/tag/code' }] }
};

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [codeBlock, authorBlock, tagsBlock]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
check('code round-trips source', (back.blocks.find((b) => b.type === 'code') || {}).data.source === '.hero { color: red; }');
check('author round-trips name', (back.blocks.find((b) => b.type === 'author') || {}).data.name === 'דנה כהן');
check('tags round-trips 2 chips', ((back.blocks.find((b) => b.type === 'tags') || { data: {} }).data.items || []).length === 2);
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
check('compile bent-code', /class="bent-code/.test(compiled) && /color: red/.test(compiled));
check('compile bent-author', /class="bent-author/.test(compiled) && /דנה כהן/.test(compiled));
check('compile bent-tags', /class="bent-tags/.test(compiled) && /עיצוב/.test(compiled));
check('no <script>', !/<script/i.test(compiled));
check('registry + seed', !!getBlockDef('code') && !!getBlockDef('author') && !!getBlockDef('tags')
  && (defaultDataFor('tags').items || []).length >= 2);

const kw = bentml.compile(`BENTML 0.2

META {
  title: "בלוג"
}

AUTHOR(name: "דנה כהן", role: "עורכת") { }

TAGS {
  TAG(url: "/tag/css") { CSS }
  TAG(url: "/tag/html") { HTML }
}

CODE(lang: "css", source: ".hero { color: red; }")
`);
check('keyword compiles AUTHOR/TAGS/CODE', kw.blocks.map((b) => b.type).join(',') === 'author,tags,code');
const src = bentml.decompile({ title: 'x' }, [codeBlock, authorBlock, tagsBlock]);
check('decompile emits CODE/AUTHOR/TAGS', /CODE\(/.test(src) && /AUTHOR\(/.test(src) && /TAGS/.test(src));
const round = bentml.compile(src);
check('keyword blog round-trip', round.blocks[0].type === 'code'
  && round.blocks[1].data.name === 'דנה כהן'
  && round.blocks[2].data.items[1].label === 'קוד');

const pre = htmlToBlocks('<pre class="language-css"><code>.hero { color: red; }</code></pre>');
check('decompile <pre> → code (not leftover html)',
  pre.blocks.some((b) => b.type === 'code' && /color: red/.test(b.data.source) && b.data.lang === 'css')
  && !pre.blocks.some((b) => b.type === 'html')
  && !pre.suggestedTools.includes('code'));

const by = htmlToBlocks(
  '<div class="author-bio"><img src="/dana.jpg" alt=""><h3 class="author-name">דנה כהן</h3>'
  + '<span class="role">עורכת</span><time datetime="2026-09-01">1.9.2026</time></div>'
);
check('decompile author-bio → author',
  by.blocks.some((b) => b.type === 'author' && b.data.name === 'דנה כהן'));

const tg = htmlToBlocks(
  '<nav class="post-tags"><a rel="tag" href="/tag/a">עיצוב</a><a rel="tag" href="/tag/b">קוד</a></nav>'
);
check('decompile post-tags → tags',
  tg.blocks.some((b) => b.type === 'tags' && (b.data.items || []).length === 2));

const hunted = huntBlocks('<pre class="language-js"><code>const x = 1;</code></pre>');
check('hunt maps <pre> → code',
  (hunted.blocks || []).some((b) => b.type === 'code' && /const x/.test(b.data.source)));

const own = htmlToBlocks(renderBlock(codeBlock, 'ltr'));
check('own bent-code maps back',
  own.blocks.some((b) => b.type === 'code' && /color: red/.test(b.data.source || '')));

const imported = decompileHtml(
  '<html><head><title>t</title></head><body>'
  + '<pre class="language-css"><code>.a{}</code></pre></body></html>'
);
check('import emits CODE keyword + bent-code',
  /CODE\(/.test(imported.bentml || '') && /bent-code/.test(imported.source || ''));

console.log('');
console.log(fail ? 'SMOKE BLOG: FAIL' : 'SMOKE BLOG: PASS');
process.exit(fail ? 1 : 0);
