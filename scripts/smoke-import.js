'use strict';

/**
 * v0.53 QA — the in-builder "Import from AI" pipeline (BenTML → blocks).
 * Mirrors POST /admin/api/pzn/to-blocks: extract → (parse | repair) →
 * toTapuzPage → blocks. Proves a clean doc imports, an imperfect one is
 * repaired into blocks, and prose-wrapped replies are extracted.
 */

const pzn = require('../src/pzn/index');
const { extractPzn } = require('../src/pzn-extract');
const { repair } = require('../src/pzn/repair');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

/** Mirror the endpoint: source (maybe prose-wrapped, maybe broken) → blocks. */
function toBlocks(raw) {
  let source = extractPzn(raw);
  let doc, repaired = false;
  try {
    doc = pzn.parse(source);
    const errs = pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error');
    if (errs.length) throw new Error('invalid');
  } catch (e) {
    const r = repair(source);
    if (!r.ok || r.remaining.length) return { ok: false };
    doc = pzn.parse(r.source);
    repaired = true;
  }
  const view = pzn.toTapuzPage(doc);
  return { ok: true, blocks: view.blocks, title: view.title, repaired };
}

const clean = `<!DOCTYPE html><html lang="he" dir="rtl" bent-version="0.1">
<head><meta charset="utf-8"/><title>עמוד מ‑AI</title><meta name="bent-slug" content="x"/></head>
<body>
  <bent-heading id="h" level="1">כותרת</bent-heading>
  <bent-text id="t">פסקה</bent-text>
</body></html>`;

let r = toBlocks(clean);
check('clean BenTML → blocks', r.ok && r.blocks.length === 2 && r.blocks[0].type === 'heading');
check('clean import is not flagged repaired', r.ok && r.repaired === false);
check('title carried through', r.ok && r.title === 'עמוד מ‑AI');

// prose-wrapped reply (fenced) — extract then import
r = toBlocks('בשמחה! הנה הדף:\n\n```html\n' + clean + '\n```\nבהצלחה');
check('prose-wrapped reply is extracted + imported', r.ok && r.blocks.length === 2);

// imperfect reply (raw div + alias + bad level) → repaired into blocks
const broken = `<!DOCTYPE html><html lang="he" dir="rtl" bent-version="0.1">
<head><meta charset="utf-8"/><title>מבצע</title><meta name="bent-slug" content="y"/></head>
<body>
  <div class="promo"><h2>מבצע</h2></div>
  <bent-paragraph id="p">טקסט</bent-paragraph>
  <bent-heading id="hh" level="99">כותרת</bent-heading>
</body></html>`;
r = toBlocks(broken);
check('imperfect reply is repaired into blocks', r.ok && r.repaired === true && r.blocks.length >= 3);
check('  raw div became an html block', r.ok && r.blocks.some((b) => b.type === 'html'));
check('  <bent-paragraph> became text', r.ok && r.blocks.some((b) => b.type === 'text'));

// junk → clean failure (no throw)
r = toBlocks('this is just a normal chat message, no page here');
check('junk input fails gracefully (ok:false, no throw)', r.ok === false);

console.log('');
console.log(fail ? 'SMOKE IMPORT: FAIL' : 'SMOKE IMPORT: PASS');
process.exit(fail ? 1 : 0);
