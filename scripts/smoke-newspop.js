'use strict';

/**
 * v0.70 QA — the newspop timestamped news feed (walla's standing "HH:MM ·
 * headline" column). Renderer output, link/escape safety, and a full
 * block → .pzn → block round-trip through the bridge.
 */

const pzn = require('../src/pzn/index');
const { renderNewspopFromData, renderNewspopItem } = require('../src/pzn/newspop-html');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── renderer output ──────────────────────────────────────────────────
const html = renderNewspopFromData(
  { label: 'מבזקים', items: [{ time: '14:30', text: 'כותרת ראשונה', href: '/n1' }, { time: '14:15', text: 'ללא קישור' }] },
  'rtl'
);
check('renders a bent-newspop section', /class="bent-newspop"/.test(html));
check('renders the label head', /bent-newspop-head">מבזקים/.test(html));
check('renders the time', /<time class="bent-newspop-time">14:30<\/time>/.test(html));
check('a linked item is an <a>', /<a class="bent-newspop-text" href="\/n1">כותרת ראשונה<\/a>/.test(html));
check('an unlinked item is a <span>', /<span class="bent-newspop-text">ללא קישור<\/span>/.test(html));

// ── safety ───────────────────────────────────────────────────────────
check('javascript: href is neutralized', !/javascript:/i.test(renderNewspopItem({ time: '1', text: 'x', href: 'javascript:alert(1)' })));
check('headline text is escaped', renderNewspopItem({ text: '<b>hi</b>' }).includes('&lt;b&gt;'));

// ── bridge round-trip: block → .pzn → block ──────────────────────────
const page = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [
  { type: 'newspop', id: 'np1', data: { label: 'עדכונים', items: [
    { time: '09:00', text: 'ראשון', href: '/a' },
    { time: '08:30', text: 'שני' }
  ] } }
] };
const src = pzn.serialize(pzn.fromTapuzPage(page));
check('.pzn carries <bent-newspop>', /bent-newspop\b/.test(src));
check('.pzn carries <bent-newspopitem>', /bent-newspopitem/.test(src));
const back = pzn.toTapuzPage(pzn.parse(src));
const np = back.blocks.find((b) => b.type === 'newspop');
check('round-trips to a newspop block with 2 items', !!np && (np.data.items || []).length === 2);
check('round-trip preserves time + text + href', np && np.data.items[0].time === '09:00' && np.data.items[0].text === 'ראשון' && np.data.items[0].href === '/a');
check('round-trip preserves the label', np && np.data.label === 'עדכונים');
check('round-trip validates clean', pzn.validate(pzn.parse(src), { strict: false }).filter((i) => i.severity === 'error').length === 0);

console.log('');
console.log(fail ? 'SMOKE NEWSPOP: FAIL' : 'SMOKE NEWSPOP: PASS');
process.exit(fail ? 1 : 0);
