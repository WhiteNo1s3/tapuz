'use strict';

/**
 * v0.49 QA — the repair engine ("auto-correct, then you apply").
 *
 * Each case is a way GPT's output breaks the strict save today. After repair,
 * the invariant is ALWAYS: the result parses AND validates with zero errors
 * (remaining === 0) — i.e. Ben never loses a page to one bad tag again.
 */

const { repair } = require('../src/pzn/repair');
const pzn = require('../src/pzn/index');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function doc(body) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
  <head><meta charset="utf-8" /><title>בדיקה</title><meta name="bent-slug" content="t" /></head>
  <body>
${body}
  </body>
</html>`;
}

/** repair, then assert the result is clean (parses + validates, 0 errors). */
function repairClean(name, source, expectCode) {
  const r = repair(source);
  if (!r.ok) { check(name + ' (ok)', false); return r; }
  let validErrs = -1;
  try {
    const d = pzn.parse(r.source);
    validErrs = pzn.validate(d, { strict: false }).filter((i) => i.severity === 'error').length;
  } catch (e) { validErrs = -1; }
  const codes = r.changes.map((c) => c.code);
  check(name, r.ok && validErrs === 0 && r.remaining.length === 0 && (!expectCode || codes.includes(expectCode)));
  return r;
}

// 1. alias near-misses
repairClean('alias <bent-paragraph> → text', doc('    <bent-paragraph id="a">שלום עולם</bent-paragraph>'), 'ALIAS');
repairClean('alias <bent-img> → image', doc('    <bent-img id="b" src="/x.jpg" alt="x" />'), 'ALIAS');
{
  const r = repairClean('alias <bent-h1> → heading level 1', doc('    <bent-h1 id="c">כותרת</bent-h1>'), 'ALIAS');
  check('  <bent-h1> became heading level=1', /<bent-heading[^>]*level="1"/.test(r.source || ''));
}

// 2. truly-unknown → quarantine
{
  const r = repairClean('quarantine <bent-pricing-table>', doc('    <bent-pricing-table id="p" plan="pro">tiers</bent-pricing-table>'), 'QUARANTINE');
  check('  quarantined into bent-html', /<bent-html/.test(r.source || ''));
}

// 3. missing required prop (article-list.tag has a default, so craft a real gap: heading with no text still ok;
//    use an unknown enum + a prop gap that DOES error — feature.title is optional/defaulted, so target enum/range below)
// 4. bad enum snaps
repairClean('enum heading align="middle" → snap', doc('    <bent-heading id="h" level="2" align="middle">כ</bent-heading>'), 'PROP_ENUM');

// 5. integer out of range clamps
{
  const r = repairClean('clamp heading level="9" → 6', doc('    <bent-heading id="h9" level="9">כ</bent-heading>'), 'PROP_CLAMP');
  check('  level clamped to 6', /level="6"/.test(r.source || ''));
}

// 6. duplicate ids
repairClean('dedupe duplicate ids', doc('    <bent-text id="dup">a</bent-text>\n    <bent-text id="dup">b</bent-text>'), 'DEDUP_ID');

// 7. illegal nesting hoists
repairClean('hoist <bent-text> out of <bent-columns>', doc('    <bent-columns id="cols"><bent-text id="loose">x</bent-text></bent-columns>'), 'HOIST');

// 8. raw HTML in body → wrapped into provisional bent-html
{
  const raw = doc('    <div class="promo"><h2>מבצע</h2><p>עד 50%</p></div>\n    <bent-heading id="ok" level="2">כותרת תקינה</bent-heading>');
  const r = repairClean('wrap raw <div> in body', raw, 'WRAP_HTML');
  check('  raw div wrapped to bent-html', /<bent-html/.test(r.source || ''));
  check('  valid bent-heading preserved as a module', /<bent-heading[^>]*>כותרת תקינה/.test(r.source || ''));
}

// 9. mixed disaster: raw HTML + unknown module + bad enum + dup id, all at once
{
  const mess = doc([
    '    <section class="hero"><h1>גיבור</h1></section>',
    '    <bent-video id="v" src="/m.mp4">clip</bent-video>',
    '    <bent-heading id="d" level="99" align="justify">כותרת</bent-heading>',
    '    <bent-heading id="d">שוב</bent-heading>'
  ].join('\n'));
  const r = repairClean('mixed disaster fully repaired', mess);
  check('  made several changes', r.changes.length >= 3);
}

// 10. already-valid doc → no changes, still clean
{
  const good = doc('    <bent-heading id="g" level="1">שלום</bent-heading>\n    <bent-text id="gt">פסקה</bent-text>');
  const r = repairClean('valid doc untouched', good);
  check('  zero changes on a valid doc', r.changes.length === 0);
}

console.log('');
console.log(fail ? 'SMOKE PZN-REPAIR: FAIL' : 'SMOKE PZN-REPAIR: PASS');
process.exit(fail ? 1 : 0);
