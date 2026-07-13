'use strict';

/**
 * v0.51 QA — graduation: a provisional bent-html block's raw HTML → real Tapuz
 * modules. Proves the common tags map, nothing is lost (unknown → leftover
 * html), and the produced blocks form VALID BenTML (so the page still saves).
 */

const { htmlToBlocks } = require('../src/pzn/graduate');
const pzn = require('../src/pzn/index');
const { fromTapuzPage } = pzn;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const html = [
  '<div class="promo">',
  '  <h2>מבצע ענק</h2>',
  '  <p>עד <strong>50%</strong> הנחה</p>',
  '  <img src="/s.jpg" alt="מבצע">',
  '  <ul><li>אחד</li><li>שתיים</li></ul>',
  '  <a href="/shop">לחנות</a>',
  '  <blockquote>ממליצים</blockquote>',
  '  <hr>',
  '  <custom-thing x="1">לא ידוע</custom-thing>',
  '</div>'
].join('\n');

const r = htmlToBlocks(html);
const types = r.blocks.map((b) => b.type);
console.log('types:', types.join(', '));

check('heading mapped (h2 → level 2)', r.blocks.some((b) => b.type === 'heading' && b.data.level === 2 && /מבצע/.test(b.data.text)));
check('paragraph → text (inline flattened)', r.blocks.some((b) => b.type === 'text' && /50%/.test(b.data.content)));
check('img → image', r.blocks.some((b) => b.type === 'image' && b.data.src === '/s.jpg'));
check('ul → list with 2 items', r.blocks.some((b) => b.type === 'list' && (b.data.items || []).length === 2));
check('a → button', r.blocks.some((b) => b.type === 'button' && b.data.url === '/shop'));
check('blockquote → quote', r.blocks.some((b) => b.type === 'quote' && /ממליצים/.test(b.data.text)));
check('hr → divider', types.includes('divider'));
check('unknown element kept as leftover html (nothing lost)', r.blocks.some((b) => b.type === 'html' && /custom-thing/.test(b.data.content)));
check('reported mapped count ≥ 6', r.mapped >= 6);

// the graduated blocks must form a VALID BenTML document
const doc = pzn.parse(pzn.serialize(fromTapuzPage({ title: 'g', slug: 'g', blocks: r.blocks })));
const errs = pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
check('graduated blocks produce valid BenTML (0 errors)', errs.length === 0);

// empty / plain input is safe
check('empty content → no blocks', htmlToBlocks('').blocks.length === 0);
check('plain text → a single text block', (function () {
  const b = htmlToBlocks('סתם טקסט חופשי').blocks;
  return b.length === 1 && b[0].type === 'text';
})());

console.log('');
console.log(fail ? 'SMOKE GRADUATE: FAIL' : 'SMOKE GRADUATE: PASS');
process.exit(fail ? 1 : 0);
