'use strict';

/**
 * QA — gap-audit wave 3: team / countdown / pricelist / progress.
 * The four shapes every real business site ships that the decompiler was
 * silently flattening (the audit's worst finding). Each module is checked
 * end to end: registry + seed, render, pzn round-trip, legacy BentML
 * round-trip, and the decompiler mapping the real-world markup that used
 * to flatten.
 */

const pzn = require('../src/pzn/index');
const { renderBlock } = require('../src/renderer');
const { getBlockDef, defaultDataFor } = require('../src/block-registry');
const bentml = require('../src/bentml');
const { htmlToBlocks } = require('../src/pzn/graduate');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── shared: registry + pzn round-trip for all four ──
const FIXTURES = {
  team: { items: [{ name: 'דנה לוי', role: 'מנכ"לית', image: '/uploads/dana.jpg', bio: 'מובילה מהיום הראשון.', url: '/dana' }, { name: 'יוסי כהן', role: 'סמנכ"ל' }] },
  countdown: { target: '2027-01-01T00:00', label: 'עד סוף המבצע', done: 'המבצע הסתיים' },
  pricelist: { items: [{ name: 'חומוס מלא', price: '32 ₪', desc: 'עם פטריות' }, { name: 'שקשוקה', price: '44 ₪' }] },
  progress: { items: [{ label: 'עיצוב', value: 90 }, { label: 'פיתוח', value: 75, color: '#38bdf8' }] }
};

for (const [type, data] of Object.entries(FIXTURES)) {
  check(`registry + seed: ${type}`, !!getBlockDef(type) && Object.keys(defaultDataFor(type) || {}).length > 0);
  const page = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [{ type, id: type + '_1', data }] };
  const doc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(page)));
  check(`pzn validates clean: ${type}`, pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0);
  const back = pzn.toTapuzPage(doc).blocks.find((b) => b.type === type);
  check(`pzn round-trips: ${type}`, !!back);
  if (back && data.items) {
    check(`pzn keeps all items: ${type}`, (back.data.items || []).length === data.items.length);
  }
}

// ── team ──
const teamHtml = renderBlock({ type: 'team', id: 't1', data: FIXTURES.team }, 'rtl');
check('team render: bent-team + members', /class="bent-team/.test(teamHtml) && (teamHtml.match(/bent-member"/g) || []).length === 2);
check('team render: photo, role, bio, link', /bent-member-photo/.test(teamHtml) && /מנכ&quot;לית/.test(teamHtml)
  && /מובילה מהיום הראשון/.test(teamHtml) && /href="\/dana"/.test(teamHtml));
check('team render: XSS-escaped', /&lt;b&gt;/.test(renderBlock({
  type: 'team', id: 'tx', data: { items: [{ name: '<b>x</b>' }] }
}, 'rtl')));

// ── countdown ──
const cdHtml = renderBlock({ type: 'countdown', id: 'c1', data: FIXTURES.countdown }, 'rtl');
check('countdown render: cells + label + target attr', /bent-count-cells/.test(cdHtml)
  && /עד סוף המבצע/.test(cdHtml) && /data-target="2027-01-01T00:00"/.test(cdHtml));
check('countdown render: ships its tick script', /<script>/.test(cdHtml) && /data-done/.test(cdHtml));
const cdPast = renderBlock({ type: 'countdown', id: 'c2', data: { target: '2020-01-01T00:00', done: 'נגמר' } }, 'rtl');
check('countdown past target: done message, no script', /bent-count-done/.test(cdPast) && /נגמר/.test(cdPast) && !/<script>/.test(cdPast));
check('countdown render: target attr is escaped', !/onerror/i.test(renderBlock({
  type: 'countdown', id: 'c3', data: { target: '2027-01-01" onerror="x' }
}, 'rtl').split('data-target')[1].split('>')[0].replace(/^="[^"]*"/, '')));

// ── pricelist ──
const plHtml = renderBlock({ type: 'pricelist', id: 'p1', data: FIXTURES.pricelist }, 'rtl');
check('pricelist render: rows with dotted leader', /bent-pricelist/.test(plHtml)
  && (plHtml.match(/bent-priceitem"/g) || []).length === 2 && /bent-priceitem-dots/.test(plHtml));
check('pricelist render: name, price, desc', /חומוס מלא/.test(plHtml) && /32 ₪/.test(plHtml) && /עם פטריות/.test(plHtml));
check('pricelist render: no script, zero JS', !/<script/i.test(plHtml));

// ── progress ──
const pgHtml = renderBlock({ type: 'progress', id: 'g1', data: FIXTURES.progress }, 'rtl');
check('progress render: bars with widths + aria', /bent-bar-fill" style="width:90%/.test(pgHtml)
  && /aria-valuenow="75"/.test(pgHtml) && /background:#38bdf8/.test(pgHtml));
check('progress render: values clamp to 0–100', /width:100%/.test(renderBlock({
  type: 'progress', id: 'g2', data: { items: [{ label: 'x', value: 250 }] }
}, 'rtl')) && /width:0%/.test(renderBlock({
  type: 'progress', id: 'g3', data: { items: [{ label: 'y', value: -4 }] }
}, 'rtl')));
check('progress render: no script, zero JS', !/<script/i.test(pgHtml));

// ── legacy BentML (line dialect) round-trips ──
const legacy = bentml.compile(`BENTML 0.2

META {
  title: "מודולים"
}

TEAM {
  MEMBER(name: "דנה לוי", role: "מנכ\\"לית", image: "/uploads/dana.jpg") { מובילה מהיום הראשון. }
  MEMBER(name: "יוסי כהן") { }
}

COUNTDOWN(target: "2027-01-01T00:00", done: "נגמר") { עד סוף המבצע }

PRICELIST {
  PRICEITEM(name: "חומוס מלא", price: "32 ₪") { עם פטריות }
  PRICEITEM(name: "שקשוקה", price: "44 ₪") { }
}

PROGRESS {
  BAR(value: 90) { עיצוב }
  BAR(value: 75, color: "#38bdf8") { פיתוח }
}
`);
const lTypes = legacy.blocks.map((b) => b.type);
check('legacy compiles all four keywords', ['team', 'countdown', 'pricelist', 'progress'].every((t) => lTypes.includes(t)));
const lTeam = legacy.blocks.find((b) => b.type === 'team');
check('legacy TEAM: members with bio', lTeam.data.items.length === 2 && lTeam.data.items[0].bio === 'מובילה מהיום הראשון.');
const lCd = legacy.blocks.find((b) => b.type === 'countdown');
check('legacy COUNTDOWN: target + label + done', lCd.data.target === '2027-01-01T00:00' && lCd.data.label === 'עד סוף המבצע' && lCd.data.done === 'נגמר');
const lPg = legacy.blocks.find((b) => b.type === 'progress');
check('legacy PROGRESS: values + colors', lPg.data.items[0].value === 90 && lPg.data.items[1].color === '#38bdf8');

const src = bentml.decompile({ title: 'x' }, Object.entries(FIXTURES).map(([type, data], n) => ({ type, id: type + '_' + n, data })));
const round = bentml.compile(src);
check('legacy decompile → recompile keeps all four', ['team', 'countdown', 'pricelist', 'progress']
  .every((t) => round.blocks.some((b) => b.type === t)));

// ── the decompiler maps what used to flatten (the audit fixtures) ──
const teamGrad = htmlToBlocks(`
  <div class="team-members">
    <div class="team-member">
      <img src="/img/dana.jpg" alt="דנה לוי">
      <h3>דנה לוי</h3>
      <p class="role">מנכ"לית</p>
      <p>מובילה את החברה מ-2018.</p>
    </div>
    <div class="team-member">
      <img src="/img/yossi.jpg" alt="יוסי כהן">
      <h3>יוסי כהן</h3>
      <p class="role">סמנכ"ל טכנולוגיות</p>
    </div>
  </div>
`);
const gTeam = teamGrad.blocks.find((b) => b.type === 'team');
check('decompile team grid → team (was: cards)', !!gTeam && gTeam.data.items.length === 2
  && gTeam.data.items[0].name === 'דנה לוי' && gTeam.data.items[0].role === 'מנכ"לית'
  && gTeam.data.items[0].image === '/img/dana.jpg' && /2018/.test(gTeam.data.items[0].bio || ''));

const teamTitled = htmlToBlocks(`
  <section class="team-section">
    <h2>הצוות שלנו</h2>
    <div class="team-members">
      <div class="team-member"><img src="/img/a.jpg" alt="א"><h3>אחת</h3><p class="role">תפקיד</p></div>
      <div class="team-member"><img src="/img/b.jpg" alt="ב"><h3>שתיים</h3><p class="role">תפקיד</p></div>
    </div>
  </section>
`);
check('section heading survives the module mapping (pre block)',
  teamTitled.blocks[0] && teamTitled.blocks[0].type === 'heading'
  && teamTitled.blocks[0].data.text === 'הצוות שלנו'
  && teamTitled.blocks.some((b) => b.type === 'team'));

const cdGrad = htmlToBlocks(`
  <div class="elementor-widget-countdown">
    <div class="elementor-countdown-wrapper" data-date="2026-12-31T23:59:59">
      <div class="elementor-countdown-item"><span class="elementor-countdown-digits">12</span><span class="elementor-countdown-label">ימים</span></div>
    </div>
  </div>
`);
check('decompile Elementor countdown → countdown (was: text)', cdGrad.blocks.some(
  (b) => b.type === 'countdown' && b.data.target === '2026-12-31T23:59:59'
));

const noTarget = htmlToBlocks('<div class="countdown-timer"><span>24</span> ימים</div>');
check('countdown without a date reports the toolGap, never invents one',
  !noTarget.blocks.some((b) => b.type === 'countdown') && noTarget.suggestedTools.includes('countdown'));

const plGrad = htmlToBlocks(`
  <ul class="elementor-price-list">
    <li class="elementor-price-list-item">
      <div class="elementor-price-list-text"><div class="elementor-price-list-header"><span class="elementor-price-list-title">קפה הפוך</span><span class="elementor-price-list-price">14 ₪</span></div>
      <p class="elementor-price-list-description">על חלב מוקצף</p></div>
    </li>
    <li class="elementor-price-list-item">
      <div class="elementor-price-list-text"><div class="elementor-price-list-header"><span class="elementor-price-list-title">קרואסון</span><span class="elementor-price-list-price">18 ₪</span></div></div>
    </li>
  </ul>
`);
const gPl = plGrad.blocks.find((b) => b.type === 'pricelist');
check('decompile Elementor price list → pricelist (was: misread as pricing)', !!gPl
  && gPl.data.items.length === 2 && gPl.data.items[0].name === 'קפה הפוך'
  && gPl.data.items[0].price === '14 ₪' && gPl.data.items[0].desc === 'על חלב מוקצף');
check('price LIST no longer misdiagnosed as pricing table', !plGrad.suggestedTools.includes('pricing'));

const pgGrad = htmlToBlocks(`
  <div class="skills">
    <div class="elementor-widget-progress">
      <span class="elementor-progress-text">עיצוב</span>
      <div class="elementor-progress-bar" data-max="90" style="width:90%"><span>90%</span></div>
    </div>
    <div class="elementor-widget-progress">
      <span class="elementor-progress-text">פיתוח</span>
      <div class="elementor-progress-bar" data-max="75" style="width:75%"><span>75%</span></div>
    </div>
  </div>
`);
const gPg = pgGrad.blocks.find((b) => b.type === 'progress');
check('decompile Elementor progress → progress (was: text)', !!gPg && gPg.data.items.length === 2
  && gPg.data.items[0].label === 'עיצוב' && gPg.data.items[0].value === 90 && gPg.data.items[1].value === 75);

// pricing TABLES must still map as pricing — the regex fix must not regress them
const pricingGrad = htmlToBlocks(`
  <div class="pricing-table">
    <div class="price-card"><h3>בסיסי</h3><span class="price">49 ₪</span><a href="/go">התחילו</a></div>
    <div class="price-card"><h3>מקצועי</h3><span class="price">99 ₪</span><a href="/go">התחילו</a></div>
  </div>
`);
check('pricing table still maps as pricing', pricingGrad.blocks.some((b) => b.type === 'pricing'));

console.log('');
console.log(fail ? 'SMOKE GAP-MODULES: FAIL' : 'SMOKE GAP-MODULES: PASS');
process.exit(fail ? 1 : 0);
