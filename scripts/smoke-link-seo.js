'use strict';

/**
 * v0.71 QA — link SEO on the button module: rel / target / title, with
 * automatic rel="noopener noreferrer" when target="_blank" (security). Covers
 * the helper, the renderer output, and a full block -> .pzn -> block round-trip.
 */

const pzn = require('../src/pzn/index');
const { linkSeoAttrs } = require('../src/pzn/link-attrs');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

// ── helper ───────────────────────────────────────────────────────────
check('rel is emitted', linkSeoAttrs({ rel: 'nofollow' }).includes('rel="nofollow"'));
check('_blank auto-adds noopener noreferrer', /rel="noopener noreferrer"/.test(linkSeoAttrs({ target: '_blank' })));
check('_blank merges author rel + noopener', (() => { const s = linkSeoAttrs({ rel: 'sponsored', target: '_blank' }); return s.includes('sponsored') && s.includes('noopener') && s.includes('noreferrer'); })());
check('_self emits no target attr', !/target=/.test(linkSeoAttrs({ target: '_self' })));
check('title is emitted + escaped', linkSeoAttrs({ title: 'a"b' }).includes('title="a&quot;b"'));
check('empty props → empty string', linkSeoAttrs({}) === '');
check('unknown target dropped', !/target=/.test(linkSeoAttrs({ target: 'evil' })));
check('no duplicate noopener when author already set it', (linkSeoAttrs({ rel: 'noopener', target: '_blank' }).match(/noopener/g) || []).length === 1);

// ── compiled output + round-trip (pure .pzn path, no renderer/db) ────
const page = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [
  { type: 'button', id: 'b1', data: { text: 'לחצו', url: '/x', variant: 'primary', rel: 'nofollow', target: '_blank', title: 'כ' } }
] };
const src = pzn.serialize(pzn.fromTapuzPage(page));
const doc = pzn.parse(src);
const html = pzn.compile(doc);
check('compiled <a>: rel="nofollow noopener noreferrer"', /rel="nofollow noopener noreferrer"/.test(html));
check('compiled <a>: target="_blank"', /target="_blank"/.test(html));
check('compiled <a>: title="כ"', /title="כ"/.test(html));
check('.pzn carries rel/target/title', /rel="nofollow"/.test(src) && /target="_blank"/.test(src) && /title="כ"/.test(src));
const btn = pzn.toTapuzPage(doc).blocks.find((b) => b.type === 'button');
check('round-trip preserves rel/target/title', btn && btn.data.rel === 'nofollow' && btn.data.target === '_blank' && btn.data.title === 'כ');
check('round-trip validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

// ── image SEO (v0.71): title attribute, compile + round-trip ─────────
const imgPage = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [
  { type: 'image', id: 'i1', data: { src: '/a.jpg', alt: 'חלופי', title: 'כותרת תמונה' } },
  { type: 'image', id: 'i2', data: { src: '/b.jpg', alt: 'ב' } }
] };
const imgSrc = pzn.serialize(pzn.fromTapuzPage(imgPage));
const imgDoc = pzn.parse(imgSrc);
const imgHtml = pzn.compile(imgDoc);
check('compiled <img> carries title', /<img[^>]*src="\/a\.jpg"[^>]*title="כותרת תמונה"/.test(imgHtml));
check('compiled <img> without title has NO title attr', !/<img[^>]*src="\/b\.jpg"[^>]*title=/.test(imgHtml));
const backImgs = pzn.toTapuzPage(imgDoc).blocks.filter((b) => b.type === 'image');
check('image title round-trips through .pzn', backImgs[0].data.title === 'כותרת תמונה' && backImgs[1].data.title === undefined);
check('image round-trip validates clean', pzn.validate(imgDoc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

// ── BenTML dialect carries the image title too (review finding: the legacy
//    source view must not silently delete a builder-set title on apply).
//    Pure submodules required directly — bentml/index.js drags in the db. ──
const { decompile: bentDecompile } = require('../src/bentml/decompile');
const { compile: bentCompile } = require('../src/bentml/compile');
const bentSrc = bentDecompile({ title: 't', slug: 't' }, [
  { type: 'image', id: 'i1', data: { src: '/a.jpg', alt: 'א', title: 'כותרת SEO' } }
]);
check('BenTML decompile emits the title param', /title:\s*"כותרת SEO"/.test(bentSrc));
const bentBack = bentCompile(bentSrc);
const bentImg = (bentBack.blocks || []).find((b) => b.type === 'image');
check('BenTML compile keeps the title (no data loss on apply)', bentImg && bentImg.data.title === 'כותרת SEO');

console.log('');
console.log(fail ? 'SMOKE LINK-SEO: FAIL' : 'SMOKE LINK-SEO: PASS');
process.exit(fail ? 1 : 0);
