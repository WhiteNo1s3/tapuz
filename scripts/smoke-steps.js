'use strict';

/**
 * QA — steps + timeline modules (module-hunt gaps from docs/COMPETITIVE.md:
 * "timeline, steps remain"). Round-trip through .pzn, compile/render parity
 * via the shared *-html.js files, security (escaping), CSS-counter / rail
 * markup, decompiler mapping (classed ol, rich ol, <dl>), and the legacy
 * BentML keyword dialect.
 */

const pzn = require('../src/pzn/index');
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

const stepsPage = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'steps', id: 's1',
    data: {
      items: [
        { title: 'מתארים', text: 'מספרים מה צריך.', icon: '1' },
        { title: 'בונים', text: 'מודולים על הקנבס.' },
        { title: 'מפרסמים', text: 'HTML נקי.' }
      ]
    }
  }]
};

const tlPage = {
  title: 't', slug: 't', direction: 'rtl', tags: [], meta: {},
  blocks: [{
    type: 'timeline', id: 't1',
    data: {
      items: [
        { time: '2024', title: 'ההתחלה', text: 'פתחנו את הסטודיו.' },
        { time: '2026', title: 'היום', text: 'ממשיכים לבנות.', image: '/uploads/now.jpg' }
      ]
    }
  }]
};

const stepsDoc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(stepsPage)));
const stepsBack = pzn.toTapuzPage(stepsDoc);
const st = stepsBack.blocks.find((b) => b.type === 'steps');
check('steps round-trips (3 steps)', st && st.data.items.length === 3);
check('step title + text survive', st.data.items[0].title === 'מתארים' && st.data.items[0].text === 'מספרים מה צריך.');
check('step icon survives', st.data.items[0].icon === '1');
check('steps validates clean', pzn.validate(stepsDoc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const tlDoc = pzn.parse(pzn.serialize(pzn.fromTapuzPage(tlPage)));
const tlBack = pzn.toTapuzPage(tlDoc);
const tl = tlBack.blocks.find((b) => b.type === 'timeline');
check('timeline round-trips (2 events)', tl && tl.data.items.length === 2);
check('event time + title + image survive', tl.data.items[1].time === '2026' && tl.data.items[1].image === '/uploads/now.jpg');
check('timeline validates clean', pzn.validate(tlDoc, { strict: false }).filter((i) => i.severity === 'error').length === 0);

const stepsCompiled = pzn.compile(stepsDoc);
const stepsRendered = renderBlock(stepsPage.blocks[0], 'rtl');
check('compile: steps wrapper', /class="bent-steps/.test(stepsCompiled));
check('render: steps wrapper', /class="bent-steps/.test(stepsRendered));
check('compile and render agree on first title', /bent-step-title">מתארים/.test(stepsCompiled) && /bent-step-title">מתארים/.test(stepsRendered));
check('CSS counter slot is present (zero JS numbering)', /bent-step-n/.test(stepsRendered));
check('no <script> in steps output', !/<script/i.test(stepsRendered));

const tlCompiled = pzn.compile(tlDoc);
const tlRendered = renderBlock(tlPage.blocks[0], 'rtl');
check('compile: timeline wrapper', /class="bent-timeline/.test(tlCompiled));
check('render: timeline wrapper', /class="bent-timeline/.test(tlRendered));
check('event time is a <time>', /<time class="bent-event-time">2024<\/time>/.test(tlRendered));
check('event image is escaped into <img>', /class="bent-event-image" src="\/uploads\/now.jpg"/.test(tlRendered));

const evilSteps = renderBlock({
  type: 'steps', id: 'e', data: {
    items: [{ title: '<script>alert(1)</script>', text: '<img onerror=alert(1)>', icon: '<svg>' }]
  }
}, 'rtl');
check('step title is HTML-escaped', !/<script>alert/.test(evilSteps) && /&lt;script&gt;/.test(evilSteps));
check('step body is HTML-escaped', !/<img onerror/.test(evilSteps));

const evilTl = renderBlock({
  type: 'timeline', id: 'e2', data: {
    items: [{ time: '<b>x</time>', title: '<script>x</script>', image: 'javascript:alert(1)' }]
  }
}, 'rtl');
check('event title is HTML-escaped', !/<script>x/.test(evilTl) && /&lt;script&gt;/.test(evilTl));
check('javascript: image is neutralized', !/src="javascript:/i.test(evilTl));

check('steps registry entry + seeded items', !!getBlockDef('steps') && (defaultDataFor('steps').items || []).length >= 2);
check('timeline registry entry + seeded items', !!getBlockDef('timeline') && (defaultDataFor('timeline').items || []).length >= 2);

check('empty steps renders wrapper, never throws', /class="bent-steps"[^>]*><\/div>/.test(renderBlock({ type: 'steps', id: 'z', data: { items: [] } }, 'rtl')));
check('empty timeline renders wrapper, never throws', /class="bent-timeline"[^>]*><\/div>/.test(renderBlock({ type: 'timeline', id: 'z2', data: { items: [] } }, 'rtl')));

const legacySteps = bentml.compile(`BENTML 0.2

META {
  title: "שלבים"
}

STEPS {
  STEP(title: "אחד") { תיאור אחד }
  STEP(title: "שניים") { תיאור שניים }
}
`);
check('legacy BentML compiles STEPS', legacySteps.blocks[0] && legacySteps.blocks[0].type === 'steps' && legacySteps.blocks[0].data.items.length === 2);
const stepsSrc = bentml.decompile({ title: 'x' }, [stepsPage.blocks[0]]);
check('legacy decompile emits STEPS/STEP source', /STEPS/.test(stepsSrc) && /STEP\(/.test(stepsSrc));
const stepsRound = bentml.compile(stepsSrc);
check('legacy steps decompile → recompile (0 errors)', stepsRound.blocks[0].type === 'steps' && stepsRound.blocks[0].data.items[0].title === 'מתארים');

const legacyTl = bentml.compile(`BENTML 0.2

META {
  title: "היסטוריה"
}

TIMELINE {
  EVENT(time: "2020", title: "יסוד") { התחלנו. }
  EVENT(time: "2026", title: "עכשיו") { ממשיכים. }
}
`);
check('legacy BentML compiles TIMELINE', legacyTl.blocks[0] && legacyTl.blocks[0].type === 'timeline' && legacyTl.blocks[0].data.items[1].time === '2026');

const classedOl = htmlToBlocks(`
  <ol class="steps">
    <li><h3>Sign up</h3><p>Create an account.</p></li>
    <li><h3>Build</h3><p>Drop modules on the canvas.</p></li>
    <li><h3>Publish</h3><p>Go live.</p></li>
  </ol>
`);
check('decompile classed <ol class="steps"> → steps', stepsBlock(stepsFrom(classedOl), 3) && stepsFrom(classedOl).data.items[0].title === 'Sign up');

const richOl = htmlToBlocks(`
  <ol>
    <li><h3>First</h3><p>Do this.</p></li>
    <li><h3>Second</h3><p>Then that.</p></li>
  </ol>
`);
check('decompile rich <ol> (heading+p) → steps, not a list', stepsFrom(richOl) && stepsFrom(richOl).data.items.length === 2);

const plainOl = htmlToBlocks('<ol><li>one</li><li>two</li></ol>');
check('plain <ol> stays a list', plainOl.blocks.some((b) => b.type === 'list') && !stepsFrom(plainOl));

const dl = htmlToBlocks(`
  <dl>
    <dt>2020</dt><dd>Founded the studio.</dd>
    <dt>2024</dt><dd><h3>Moved</h3><p>To a bigger shop.</p></dd>
  </dl>
`);
check('decompile <dl> → timeline', tlFrom(dl) && tlFrom(dl).data.items.length === 2 && tlFrom(dl).data.items[0].time === '2020');

const classedDiv = htmlToBlocks(`
  <div class="timeline">
    <div><time>2019</time><h3>Launch</h3><p>Opened doors.</p></div>
    <div><time>2022</time><h3>Scale</h3><p>Grew the team.</p></div>
  </div>
`);
check('decompile classed timeline div → timeline', tlFrom(classedDiv) && tlFrom(classedDiv).data.items[0].time === '2019');

// a timeline-classed rich <ol> is a timeline, not steps (steps runs first
// in tryStructuralModules but refuses timeline-hinted containers)
const tlOl = htmlToBlocks(`
  <ol class="timeline">
    <li><time>2019</time><h3>Launch</h3><p>Opened doors.</p></li>
    <li><time>2022</time><h3>Scale</h3><p>Grew the team.</p></li>
  </ol>
`);
check('timeline-classed rich <ol> → timeline, not steps', !stepsFrom(tlOl) && tlFrom(tlOl) && tlFrom(tlOl).data.items[0].time === '2019');

// in a steps-classed container, the numbered list wins over an intro
// bullet list (first-list-wins bug)
const introThenOl = htmlToBlocks(`
  <div class="steps">
    <ul>
      <li>What you need: an account</li>
      <li>What you need: five minutes</li>
    </ul>
    <ol>
      <li><h3>Sign up</h3><p>Create an account.</p></li>
      <li><h3>Build</h3><p>Drop modules.</p></li>
      <li><h3>Publish</h3><p>Go live.</p></li>
    </ol>
  </div>
`);
check('steps container: <ol> beats intro <ul>', stepsBlock(stepsFrom(introThenOl), 3) && stepsFrom(introThenOl).data.items[0].title === 'Sign up');

const hunted = huntBlocks(`
  <section class="how-it-works">
    <div><h3>A</h3><p>one</p></div>
    <div><h3>B</h3><p>two</p></div>
  </section>
`);
check('hunt maps how-it-works section → steps', (hunted.blocks || []).some((b) => b.type === 'steps' && (b.data.items || []).length === 2));

function stepsFrom(r) { return (r.blocks || []).find((b) => b.type === 'steps'); }
function tlFrom(r) { return (r.blocks || []).find((b) => b.type === 'timeline'); }
function stepsBlock(b, n) { return b && (b.data.items || []).length === n; }

console.log('');
console.log(fail ? 'SMOKE STEPS: FAIL' : 'SMOKE STEPS: PASS');
process.exit(fail ? 1 : 0);
