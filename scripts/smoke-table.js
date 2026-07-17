'use strict';

/**
 * v0.83 QA gate — the TABLE module (hours, prices, schedules):
 *   renderer HTML · pzn round-trip · BenTML round-trip · width equalizing ·
 *   invariant I2 (overflow wrapper) · safety. Exit 1 on any failure.
 */

const { renderTable, splitCells } = require('../src/pzn/table-html');
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
  header: true,
  rows: [
    { cells: 'יום | שעות | הערות' },
    { cells: 'ראשון–חמישי | 9:00–17:00' },              // short row — pads to width 3
    { cells: 'שישי | 9:00–13:00 | <script>alert(1)</script>' }
  ]
};
const BLOCK = { type: 'table', id: 'table_1_zz', data: DATA };

// ── renderer contracts ──
const html = renderTable(DATA, { dir: ' dir="rtl"' });
check(html.includes('bent-table-wrap'), 'overflow wrapper present (invariant I2)');
check(html.includes('<thead><tr><th>יום</th>'), 'first row renders as header');
check((html.match(/<tr>/g) || []).length === 3, 'three rows rendered');
check((html.match(/<td>/g) || []).length === 6, 'short row padded to full width (2 body rows × 3 cells)');
check(html.includes('&lt;script&gt;'), 'cell content escaped — never markup');
check(!/<script/i.test(html), 'zero JS in output');
check(renderBlock(BLOCK, 'rtl').includes('bent-table'), "renderer case 'table' wired");
check(renderTable({ header: false, rows: [{ cells: 'א | ב' }] }).includes('<td>א</td>')
  && !renderTable({ header: false, rows: [{ cells: 'א | ב' }] }).includes('<th>'),
  'header: false renders no <th>');
check(renderTable({ rows: [] }).includes('bent-table-empty'), 'empty table → visible placeholder');
check(JSON.stringify(splitCells(' א |ב| ג ')) === JSON.stringify(['א', 'ב', 'ג']), 'cells trimmed');

// ── pzn round-trip ──
const pzn = serialize(fromTapuzPage({ title: 'ט', slug: 't', blocks: [BLOCK] }), { pretty: true });
check(pzn.includes('<bent-table') && pzn.includes('<bent-trow'), '.pzn carries table/trow');
const back = toTapuzPage(parse(pzn)).blocks[0];
check(back && back.type === 'table' && back.data.rows.length === 3 &&
  back.data.rows[0].cells === 'יום | שעות | הערות', 'pzn round-trip keeps rows verbatim');

// ── BenTML round-trip ──
const src = decompile({ title: 'x' }, [BLOCK]);
check(src.includes('TABLE {') && src.includes('TROW { יום | שעות | הערות }'),
  'decompiles to TABLE { TROW { … | … } }');
const out = compile(src);
const b3 = out.blocks[0];
check(b3 && b3.type === 'table' && b3.data.rows.length === 3 &&
  b3.data.rows[1].cells === 'ראשון–חמישי | 9:00–17:00', 'BenTML round-trip keeps rows');
check(b3.data.header !== false, 'header default (true) stays implicit');

const noHead = compile('BENTML 0.2\n\nMETA {\n  title: "x"\n}\n\nTABLE(header: false) {\n  TROW { א | ב }\n}\n');
check(noHead.blocks[0].data.header === false, 'header: false compiles');

// TROW outside TABLE is child-only
let guard = false;
try {
  compile('BENTML 0.2\n\nMETA {\n  title: "x"\n}\n\nTROW { בורח | מהטבלה }\n');
} catch (e) { guard = e.code === 'E104'; }
check(guard, 'TROW outside TABLE → E104');

console.log('');
if (failures) {
  console.log('SMOKE TABLE: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE TABLE: PASS');
