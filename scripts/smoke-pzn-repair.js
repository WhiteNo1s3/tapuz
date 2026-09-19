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

// ── inline HTML → marks (v2.19, Ben's "הבנייה נכשלה: Raw HTML <b>") ─────────
// Model drift writes <b>/<i>/<a>/<br> inside module text. The old behavior
// either threw E_RAW_HTML or tore the words out of the sentence into hoisted
// bent-html blocks. Now the words SURVIVE, wearing the language's own marks.
{
  const doc = '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n' +
    '<head><meta charset="utf-8" /><title>ת</title><meta name="bent-slug" content="t" /></head>\n' +
    '<body>\n<bent-text>שלום <b>מודגש</b> וגם <i>נטוי</i> ו<a href="/דף">קישור</a><br>עוד <u>שורה</u></bent-text>\n' +
    '<bent-heading level="2">כותרת <strong>חזקה</strong></bent-heading>\n</body>\n</html>';
  const r = repair(doc);
  check('inline-HTML doc repairs ok', r.ok === true && r.remaining.length === 0);
  check('  INLINE_MARKS change recorded', r.changes.some((c) => c.code === 'INLINE_MARKS'));
  check('  <b> became @B and the WORD survived', /@B\{מודגש\}/.test(r.source));
  check('  <i> became @I', /@I\{נטוי\}/.test(r.source));
  check('  <a href> became @LINK with url + text', /@LINK\(url: [^)]*דף[^)]*\)\{קישור\}/.test(r.source) || /@LINK\(url:.*\)\{קישור\}/.test(r.source));
  check('  <br> became @BREAK', /@BREAK/.test(r.source));
  check('  <u> shell shed, its word kept', !/[<]u[>]/.test(r.source) && /שורה/.test(r.source));
  check('  <strong> in a heading became @B', /@B\{חזקה\}/.test(r.source));
  check('  no words were torn out into hoisted bent-html', !r.changes.some((c) => c.code === 'WRAP_HTML'));
  check('  nothing raw remains (re-parse strict-clean)', (() => {
    try { pzn.parse(r.source); return true; } catch (e) { return false; }
  })());
}

// ── v2.28: what a LOCAL model (qwen3.6-35b via LM Studio) actually sent ──
{
  // leaves written as openers with no `/>` and no closer: every sibling
  // nests inside the previous one, one level deeper each time
  const r = repairClean('unclosed leaf openers become siblings, in order (UNCLOSED_LEAF)', doc(`
    <bent-features id="f" columns="3">
      <bent-feature id="a" title="מהיר" icon="⚡" text="טקסט א">
      <bent-feature id="b" title="בטוח" icon="🔒" text="טקסט ב">
      <bent-feature id="c" title="קרוב" icon="❤" text="טקסט ג">
    </bent-features>
    <bent-quote id="q" author="דנה" text="ציטוט">
    <bent-text id="t">אחרי הציטוט</bent-text>`), 'UNCLOSED_LEAF');
  const d = pzn.parse(r.source);
  const feats = d.body.find((n) => n.name === 'features');
  check('  the three features are siblings under <bent-features>, order kept',
    feats && feats.children.length === 3 && feats.children.map((c) => c.id).join(',') === 'a,b,c');
  check('  the text after the unclosed quote follows it at the top level, not inside it',
    d.body.map((n) => n.name).join(',') === 'features,quote,text');
  check('  nothing was thrown to the page end — a moved module follows its container', !r.changes.some((c) => /page end/.test(c.message)));
  // a quote glued to the tag name
  const t = repairClean('a stray quote after a tag name is removed (TAG_TYPO)', doc('<bent-text" id="x">שלום</bent-text>\n<bent-text id="y">עולם</bent-text">'), 'TAG_TYPO');
  check('  both texts survive as text modules', pzn.parse(t.source).body.map((n) => n.name).join(',') === 'text,text');
}


// ── v2.45: a closing tag that is ALMOST the open one. The copilot battery
//    (2026-09-19): gemma-4-26B-A4B wrote `</bent/heading>` and `</int-hero>`,
//    gemma-4-12B wrote `</bent_qa>` — and repeated the typo when the door sent
//    the page back. A closer has one sane reading: the element that is open. ──
{
  const { fixCloserTypos } = require('../src/pzn/repair');
  const fx = (s) => fixCloserTypos(s);
  const a = fx('<bent-hero id="h"><bent-heading id="a" level="1">שלום</bent/heading></int-hero>');
  check('</bent/heading> and </int-hero> are read as the elements that were open', a.fixed === 2 && a.source === '<bent-hero id="h"><bent-heading id="a" level="1">שלום</bent-heading></bent-hero>');
  const b = fx('<bent-faq id="f"><bent-qa id="q" question="?">כן</bent_qa></bent-faq>');
  check('</bent_qa> → </bent-qa>', b.fixed === 1 && /<\/bent-qa><\/bent-faq>$/.test(b.source));
  check('two edits away (</bent-txt>) is a typo; a self-closed module before it is not "open"',
    fx('<bent-image id="i" src="/x.webp" /><bent-text id="t">x</bent-txt>').source.endsWith('x</bent-text>'));
  check('a plain HTML closer is never touched', fx('<bent-text id="t">a <b>bold</b> <p>para</p></bent-text>').fixed === 0);
  check('a REAL other module as the closer is a structural error, not a typo — left for the parser to refuse',
    fx('<bent-text id="t">x</bent-heading>').fixed === 0);
  check('nothing open → nothing guessed', fx('x</bent/heading>').fixed === 0);
  const clean = doc('<bent-section id="s">\n  <bent-heading id="h" level="2">א</bent-heading>\n</bent-section>');
  check('a clean document passes through byte-identical', fx(clean).source === clean && fx(clean).fixed === 0);
  const whole = repair(doc('<bent-heading id="h1" level="1">כותרת</bent/heading>\n<bent-text id="t1">טקסט</bent-text>'));
  check('through repair(): the page lands, the change is named CLOSER_TYPO',
    whole.ok && whole.remaining.length === 0 && whole.changes.some((c) => c.code === 'CLOSER_TYPO') &&
    pzn.parse(whole.source).body.map((n) => n.name).join(',') === 'heading,text');
}

// ── v2.45: the validator names the fix, not only the fault (the 26B-A4B
//    proposed bent-pricing ⊃ bent-priceitem twice in a row) ──
{
  const issues = pzn.validate(pzn.parse(doc('<bent-faq id="f">\n  <bent-fold id="x" title="שאלה">תשובה</bent-fold>\n</bent-faq>')), { strict: false }).filter((i) => i.severity === 'error');
  const child = issues.find((i) => i.code === 'E_CHILD');
  check('E_CHILD says what the container ACCEPTS', !!child && /cannot contain <bent-fold> — it accepts: .*bent-qa/.test(child.message));
  const leafIssues = pzn.validate(pzn.parse(doc('<bent-button id="b" href="/x">\n  <bent-text id="t">טקסט</bent-text>\n</bent-button>')), { strict: false }).filter((i) => i.severity === 'error');
  const leaf = leafIssues.find((i) => i.code === 'E_NOT_CONTAINER');
  check('E_NOT_CONTAINER says the module is a leaf and names its attributes', !!leaf && /cannot have child modules — it is a leaf: its content goes in attributes \(.*href/.test(leaf.message));
}

console.log('');
console.log(fail ? 'SMOKE PZN-REPAIR: FAIL' : 'SMOKE PZN-REPAIR: PASS');
process.exit(fail ? 1 : 0);
