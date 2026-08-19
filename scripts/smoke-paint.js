'use strict';

/**
 * Paint is REAL (v2.21) — the contract behind "עיצוב מודול".
 *
 * Ben's live complaint: selecting a module let him repaint only the headline —
 * "abstract editing for paint, embarrassing vs Elementor". The audit found the
 * pieces existed but disagreed: the panel wrote data.style, the canvas showed
 * it, the renderer honored it on SOME types, and the pzn bridge round-tripped
 * SOME keys (hideOn was silently stripped by every AI edit).
 *
 * This smoke pins the whole contract, empirically:
 *   1. every registered block type that renders markup carries the paint
 *   2. every style key the renderer honors survives the .pzn round-trip
 * A future module or style knob that misses either seam fails here by name.
 */

const os = require('os');
const path = require('path');
process.env.TAPUZ_ROOT = process.env.TAPUZ_ROOT ||
  require('fs').mkdtempSync(path.join(os.tmpdir(), 'tapuz-paint-'));

const { BLOCK_REGISTRY, defaultDataFor } = require('../src/block-registry');
const { renderBlock } = require('../src/renderer');
const pzn = require('../src/pzn/index');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const MARK = '#0a1b2c';
const FULL_STYLE = {
  color: MARK, background: '#fedcba', fontSize: 'xl', padding: 'md',
  radius: 'lg', fontWeight: 'bold', margin: 'lg', border: 'md',
  borderColor: '#ab34cd', shadow: 'sm', hideOn: 'mobile'
};

// ── 1. every type renders the paint ──────────────────────────────────
// article-list legitimately renders an HTML comment on an empty DB — the
// paint contract applies to the markup it renders when articles exist, and
// its wrapper carries ${extra}; here it has nothing to paint.
const NO_MARKUP_OK = new Set(['article-list']);
const dropped = [];
for (const def of BLOCK_REGISTRY) {
  const data = Object.assign(defaultDataFor(def.type) || {}, { style: { color: MARK, background: '#fedcba' } });
  let html = '';
  try { html = String(renderBlock({ id: def.type + '_x', type: def.type, data }, 'rtl')); } catch (e) { html = ''; }
  if (!html.includes(MARK) && !NO_MARKUP_OK.has(def.type)) dropped.push(def.type);
}
check('every block type paints on the live page' + (dropped.length ? ' — DROPPED: ' + dropped.join(', ') : ''),
  dropped.length === 0);

// ── 2. the new knobs actually emit CSS ───────────────────────────────
const painted = String(renderBlock({ id: 'h_x', type: 'heading', data: { level: 2, text: 'צבע', style: FULL_STYLE } }, 'rtl'));
check('fontWeight bold → font-weight:700', painted.includes('font-weight:700'));
check('margin lg → margin-block', painted.includes('margin-block:2.5rem'));
check('border md + borderColor → real border', painted.includes('border:2px solid #ab34cd'));
check('shadow sm → box-shadow', painted.includes('box-shadow:0 1px 3px'));
check('fontSize xl → 1.4em', painted.includes('font-size:1.4em'));
check('hideOn mobile → hide-on-mobile class', painted.includes('hide-on-mobile'));

// ── 3. every honored key survives the .pzn round-trip ────────────────
// (hideOn was the proven casualty: never bridged, so every AI edit of a page
// stripped per-device visibility.)
const page = {
  title: 'צבע', slug: 'paint', direction: 'rtl', tags: [], meta: {},
  blocks: [{ id: 'h1', type: 'heading', data: { level: 1, text: 'כותרת', style: Object.assign({}, FULL_STYLE) } }]
};
const src = pzn.serialize(pzn.fromTapuzPage(page));
const back = pzn.toTapuzPage(pzn.parse(src));
const rt = (back.blocks[0] && back.blocks[0].data.style) || {};
for (const key of Object.keys(FULL_STYLE)) {
  check(`style.${key} survives the .pzn round-trip`, String(rt[key]) === String(FULL_STYLE[key]));
}
const issues = pzn.validate(pzn.parse(src), { strict: false }).filter((i) => i.severity === 'error');
check('a fully-painted document still validates clean', issues.length === 0);

console.log(fail ? '\nSMOKE PAINT: FAIL' : '\nSMOKE PAINT: PASS');
process.exit(fail ? 1 : 0);
