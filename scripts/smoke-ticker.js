'use strict';

/**
 * v0.61 QA — the moving-news ticker (batch item 3: walla's מבזקים strip —
 * scrolling clickable headlines with a pinned label, COLOR options + speed).
 * Round-trip, compile/render parity via the shared ticker-html.js, the CSS
 * color-breakout guard (safeCssColor, reused from nav), safeHref on links, the
 * speed fallback, and the single-merged-style regression (v0.60 lesson).
 *
 * No decompile loop: unlike <nav>, a news ticker has no semantic HTML tag to
 * recognize (real sites ship a styled <div> of links), so the vocabulary
 * engine gains a first-class TICKER without a graduate.js mapping. That's by
 * design — asserted below so a future "add a mapping" is a deliberate choice.
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const { htmlToBlocks } = require('../src/pzn/graduate');
const { safeCssColor } = require('../src/pzn/nav-html');
const { SPEEDS } = require('../src/pzn/ticker-html');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'ticker', id: 'k1',
    data: {
      label: 'מבזק', speed: 'fast', background: '#c0392b', color: '#ffffff',
      items: [
        { text: 'כותרת ראשונה', href: '/n1' },
        { text: 'כותרת שנייה', href: '/n2' },
        { text: 'כותרת ללא קישור' }
      ]
    }
  }]
};

const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const k = back.blocks.find((b) => b.type === 'ticker');
check('ticker round-trips (3 items + label + speed + colors)',
  k && k.data.items.length === 3 && k.data.label === 'מבזק' && k.data.speed === 'fast' &&
  k.data.background === '#c0392b' && k.data.color === '#ffffff' && k.data.items[1].href === '/n2');
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const compiled = pzn.compile(doc);
const rendered = renderBlock(page.blocks[0], 'rtl');
const shapes = [
  ['ticker element + speed class', /<div[^>]*class="bent-ticker bent-ticker-fast/],
  ['background color', /background:#c0392b/],
  ['text color css var', /--bent-ticker-color:#ffffff/],
  ['pinned label', /<span class="bent-ticker-label">מבזק<\/span>/],
  ['viewport wraps the tracks', /<div class="bent-ticker-viewport"><div class="bent-ticker-track">/],
  ['headline link', /<a class="bent-ticker-link" href="\/n2">כותרת שנייה/],
  ['headline without href → span', /<span class="bent-ticker-link">כותרת ללא קישור<\/span>/]
];
for (const [nm, re] of shapes) {
  check('compile: ' + nm, re.test(compiled));
  check('render: ' + nm, re.test(rendered));
}
// two tracks for the seamless loop (one aria-hidden)
check('two tracks (second aria-hidden)', (rendered.match(/bent-ticker-track/g) || []).length === 2 && /aria-hidden="true"/.test(rendered));

// ── security: CSS color breakout stripped ────────────────────────────
check('safeCssColor strips CSS breakout chars', !/[;{}:"]/.test(safeCssColor('red;}body{color:blue}')));
const evil = renderBlock({ type: 'ticker', id: 'e', data: { background: '#fff;position:fixed;top:0', color: 'red}', items: [{ text: 'x', href: 'javascript:alert(1)' }] } }, 'rtl');
check('no CSS breakout survives into the rendered style',
  !/;position:fixed/.test(evil) && !/[{}]/.test((evil.match(/style="[^"]*"/) || [''])[0]));
check('javascript: href stripped on a ticker link', !/javascript:/i.test(evil));

// ── speed fallback + seed ────────────────────────────────────────────
check('SPEEDS are slow/md/fast', SPEEDS.join(',') === 'slow,md,fast');
check('unknown speed falls back to md',
  /bent-ticker bent-ticker-md/.test(renderBlock({ type: 'ticker', id: 's', data: { speed: 'warp', items: [{ text: 'x' }] } }, 'rtl')));
// regression: colors + generic style decls must merge into ONE style attr
const merged = renderBlock({ type: 'ticker', id: 'm', data: { align: 'center', background: '#123456', color: '#fff', items: [{ text: 'x' }] } }, 'rtl');
check('single merged style attr (no duplicate style="")',
  (merged.match(/style="/g) || []).length === 1 && /text-align:center;background:#123456/.test(merged));
check('ticker registry entry + seeded items', !!getBlockDef('ticker') && (defaultDataFor('ticker').items || []).length >= 1);
check('label with no items still renders the strip', /bent-ticker-viewport/.test(renderBlock({ type: 'ticker', id: 'n', data: { label: 'מבזק', items: [] } }, 'rtl')));

// ── decompile: TICKER is intentionally NOT a graduate mapping ─────────
const g = htmlToBlocks('<div class="ticker"><a href="/a">A</a><a href="/b">B</a></div>');
check('no <ticker> gap regression (ticker never was a toolGap)', !g.suggestedTools.includes('ticker'));

console.log('');
console.log(fail ? 'SMOKE TICKER: FAIL' : 'SMOKE TICKER: PASS');
process.exit(fail ? 1 : 0);
