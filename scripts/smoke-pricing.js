'use strict';

/**
 * v1.05 QA — the pricing-table module (module-hunt gap from
 * docs/COMPETITIVE.md: "pricing-table sugar"). Round-trip through .pzn,
 * compile/render parity via the shared pricing-html.js, security guards
 * (safeHref on ctaUrl, escaping on title/features), the highlighted flag,
 * and the legacy BentML keyword-dialect compiler (src/bentml/compile.js +
 * decompile.js) that block-registry.js/renderer.js coverage alone doesn't
 * exercise.
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const bentml = require('../src/bentml');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const page = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'pricing', id: 'p1',
    data: {
      items: [
        { title: 'בסיסי', price: '49', period: '/חודש', features: 'תכונה אחת\nתכונה שנייה', ctaLabel: 'התחילו', ctaUrl: '/signup', highlighted: false },
        { title: 'מקצועי', price: '99', period: '/חודש', features: 'הכל בבסיסי\nעוד תכונה', ctaLabel: 'שדרגו', ctaUrl: '/upgrade', highlighted: true }
      ]
    }
  }]
};

// ── .pzn round-trip (the canonical system) ──
const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
const back = pzn.toTapuzPage(doc);
const pr = back.blocks.find((b) => b.type === 'pricing');
check('pricing round-trips (2 plans)', pr && pr.data.items.length === 2);
check('plan fields survive the round-trip', pr.data.items[1].title === 'מקצועי' && pr.data.items[1].price === '99' && pr.data.items[1].ctaUrl === '/upgrade');
check('multi-line features survive the round-trip', pr.data.items[0].features === 'תכונה אחת\nתכונה שנייה');
check('highlighted boolean survives (true and false both, not just truthy)', pr.data.items[1].highlighted === true && pr.data.items[0].highlighted === false);
check('validates clean', pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

// ── compile vs. render parity (shared pricing-html.js — can't diverge) ──
const compiled = pzn.compile(doc);
const rendered = renderBlock(page.blocks[0], 'rtl');
const shapes = [
  ['pricing grid wrapper', /class="bent-pricing/],
  ['plan title', /class="bent-plan-title">מקצועי/],
  ['plan price + period', /class="bent-plan-amount">99<\/span><span class="bent-plan-period">\/חודש/],
  ['features list', /<li>תכונה אחת<\/li>/],
  ['cta link', /class="bent-plan-cta" href="\/upgrade">שדרגו/],
  ['highlighted class only on the highlighted plan', /class="bent-plan bent-plan-highlighted"/]
];
for (const [nm, re] of shapes) {
  check('compile: ' + nm, re.test(compiled));
  check('render: ' + nm, re.test(rendered));
}
check('the non-highlighted plan does NOT get the highlighted class', /class="bent-plan">/.test(rendered));

// ── security ──
const evil = renderBlock({
  type: 'pricing', id: 'e', data: {
    items: [{ title: '<script>alert(1)</script>', features: '<img onerror=alert(1)>', ctaLabel: 'go', ctaUrl: 'javascript:alert(1)' }]
  }
}, 'rtl');
check('title is HTML-escaped (no raw <script>)', !/<script>alert/.test(evil) && /&lt;script&gt;/.test(evil));
check('features are HTML-escaped', !/<img onerror/.test(evil));
check('javascript: ctaUrl is neutralized', !/href="javascript:/i.test(evil));

// ── seeded registry entry ──
check('pricing registry entry + seeded plans', !!getBlockDef('pricing') && (defaultDataFor('pricing').items || []).length >= 1);

// ── empty/edge cases never crash ──
check('a plan with no features renders no <ul>, never crashes', !/<ul class="bent-plan-features">/.test(renderBlock({ type: 'pricing', id: 'z', data: { items: [{ title: 'Bare' }] } }, 'rtl')));
check('a plan with no cta renders no link, never crashes', !/bent-plan-cta/.test(renderBlock({ type: 'pricing', id: 'z2', data: { items: [{ title: 'NoCTA' }] } }, 'rtl')));
check('an empty pricing block renders the wrapper with no plans, never throws', /class="bent-pricing"[^>]*><\/div>/.test(renderBlock({ type: 'pricing', id: 'z3', data: { items: [] } }, 'rtl')));

// ── the legacy BentML keyword dialect (src/bentml/compile.js + decompile.js) ──
const source = `BENTML 0.2

META {
  title: "מחירון"
  slug: "pricing-smoke"
  status: draft
}

PRICING {
  PLAN(title: "בסיסי", price: "49", period: "/חודש", cta: "התחילו", url: "/signup") { שורה ראשונה\nשורה שנייה }
  PLAN(title: "פרו", price: "99", highlighted: true) { תכונה יחידה }
}`;
const legacyCompiled = bentml.compile(source);
check('legacy dialect compiles PRICING with zero warnings (no "Skipped unknown block")',
  legacyCompiled.warnings.length === 0);
const legacyBlock = legacyCompiled.blocks.find((b) => b.type === 'pricing');
check('legacy dialect produces a real pricing block, not silently dropped', !!legacyBlock);
check('legacy dialect: 2 plans, multi-line features preserved', legacyBlock && legacyBlock.data.items.length === 2 &&
  legacyBlock.data.items[0].features.trim() === 'שורה ראשונה\nשורה שנייה');
check('legacy dialect: cta/url params map to ctaLabel/ctaUrl (single-lowercase-word convention, not camelCase)',
  legacyBlock && legacyBlock.data.items[0].ctaLabel === 'התחילו' && legacyBlock.data.items[0].ctaUrl === '/signup');
check('legacy dialect: highlighted flag parsed', legacyBlock && legacyBlock.data.items[1].highlighted === true);

const legacyDecompiled = bentml.decompile({ title: 'מחירון', slug: 'pricing-smoke' }, [legacyBlock]);
check('legacy decompile emits PRICING/PLAN source', /PRICING/.test(legacyDecompiled) && /PLAN\(/.test(legacyDecompiled));
const reRoundtrip = bentml.compile(legacyDecompiled);
check('legacy decompile → recompile round-trips cleanly (0 warnings)', reRoundtrip.warnings.length === 0);
check('legacy round-trip preserves plan count', (reRoundtrip.blocks.find((b) => b.type === 'pricing') || { data: { items: [] } }).data.items.length === 2);

console.log('');
console.log(fail ? 'SMOKE PRICING: FAIL' : 'SMOKE PRICING: PASS');
process.exit(fail ? 1 : 0);
