'use strict';

/**
 * Smoke: BenTML compile → JSON blocks → renderer HTML → decompile.
 * Spec source of truth: docs/bentml-v0.md / docs/bentml-cheatsheet.md
 */

const { compile, decompile, preview, BentmlError } = require('../src/bentml');

const sample = `BENTML 0.2

META {
  title: "המתכונים של סבתא"
  slug: "מתכונים"
  description: "כל המתכונים המשפחתיים"
  tags: ["בישול", "משפחה"]
  status: draft
}

HEADING(level: 1) { המתכונים של סבתא }

TEXT {
  כל המתכונים כאן עוברים מדור לדור.

  פסקה חדשה אחרי שורה ריקה.
}

IMAGE(src: "/uploads/soup.jpg", alt: "מרק", caption: "יום שישי")

ROW {
  COL {
    HEADING(level: 2) { מנות חמות }
    TEXT { מרקים. }
  }
  COL {
    HEADING(level: 2) { מאפים }
    TEXT { חלה. }
  }
}

BUTTON(url: "/contact", style: primary) { שלחו מתכון }

HERO {
  HEADING(level: 1) { ברוכים הבאים }
  TEXT { תת כותרת }
  BUTTON(url: "/go") { CTA }
}

LIST {
  ITEM { - אחד }
  ITEM { - שניים }
}

QUOTE(author: "סבתא") { מרק טוב לא ממהרים. }

EMBED(url: "https://youtu.be/abc123def45")

MAP(address: "דיזנגוף 99, תל אביב", zoom: 14, height: lg)

ARTICLES(tag: "article", limit: 3, columns: 2)

SPACE(size: lg)
DIVIDER
`;

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (detail && !cond ? ' — ' + detail : ''));
  if (!cond) fail++;
}

// 1. compile
let result;
try {
  result = compile(sample);
  check('compile ok', true);
} catch (e) {
  check('compile ok', false, e.toString());
  process.exit(1);
}

check('page title', result.page.title === 'המתכונים של סבתא');
check('page slug', result.page.slug === 'מתכונים');
check('direction rtl', result.page.direction === 'rtl');
check('has heading block', result.blocks.some((b) => b.type === 'heading'));
check('has text block', result.blocks.some((b) => b.type === 'text'));
check('has image block', result.blocks.some((b) => b.type === 'image' && b.data.src.includes('soup')));
check('has columns', result.blocks.some((b) => b.type === 'columns' && b.data.columns?.length === 2));
check('has button', result.blocks.some((b) => b.type === 'button' && b.data.url === '/contact'));
check('has hero', result.blocks.some((b) => b.type === 'hero' && b.data.title));
check('has list', result.blocks.some((b) => b.type === 'list' && b.data.items?.length === 2));
check('has quote', result.blocks.some((b) => b.type === 'quote'));
check('has embed', result.blocks.some((b) => b.type === 'embed'));
check('has article-list', result.blocks.some((b) => b.type === 'article-list'));
check(
  'has map (BENTML 0.2)',
  result.blocks.some(
    (b) => b.type === 'map' && b.data.address.includes('דיזנגוף') && b.data.zoom === 14 && b.data.height === 'lg'
  )
);

// 2. preview HTML via renderer
try {
  const prev = preview(sample);
  check('preview html', typeof prev.html === 'string' && prev.html.includes('<h1'));
  check('preview no bent keyword leak', !prev.html.includes('HEADING('));
  check('preview has figure or img', prev.html.includes('<img') || prev.html.includes('<figure'));
  check('preview has btn', prev.html.includes('btn'));
  check('preview has map figure', prev.html.includes('class="map-embed map-lg"'));
  check(
    'preview map iframe escaped',
    prev.html.includes('https://www.google.com/maps?q=' + encodeURIComponent('דיזנגוף 99, תל אביב')) &&
      prev.html.includes('&amp;z=14&amp;output=embed&amp;hl=he')
  );
  check('preview map title', prev.html.includes('title="מפה: דיזנגוף 99, תל אביב"'));
} catch (e) {
  check('preview html', false, e.message);
}

// 3. decompile round-trip structure
const src2 = decompile(result.page, result.blocks);
check('decompile has BENTML 0.2', src2.startsWith('BENTML 0.2'));
check('decompile has META', src2.includes('META {'));
check('decompile has HEADING', /HEADING/i.test(src2));
check('decompile has MAP', src2.includes('MAP(address: "דיזנגוף 99, תל אביב"'));

let result2;
try {
  result2 = compile(src2);
  check('recompile decompiled', true);
  check(
    'block count stable-ish',
    result2.blocks.length === result.blocks.length,
    `${result2.blocks.length} vs ${result.blocks.length}`
  );
  check(
    'types match',
    result2.blocks.map((b) => b.type).join() === result.blocks.map((b) => b.type).join()
  );
} catch (e) {
  check('recompile decompiled', false, e.toString());
}

// 4. errors
try {
  compile('not bentml');
  check('E001 on bad version', false);
} catch (e) {
  check('E001 on bad version', e instanceof BentmlError && e.code === 'E001');
}

try {
  compile('BENTML 0.1\n\nTEXT { hi }\n');
  check('E111 missing META', false);
} catch (e) {
  check('E111 missing META', e instanceof BentmlError && e.code === 'E111');
}

try {
  compile('BENTML 0.1\n\nMETA {\n  title: "t"\n}\n\nIMAGE\n');
  check('E306 IMAGE src required', false);
} catch (e) {
  check('E306 IMAGE src required', e instanceof BentmlError && e.code === 'E306');
}

try {
  compile('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nMAP\n');
  check('E306 MAP address required', false);
} catch (e) {
  check('E306 MAP address required', e instanceof BentmlError && e.code === 'E306');
}

// 4ב. inline-mark braces must not close a text body (v2.13 — found live:
// `TEXT { @B{הטמעת YouTube} — מדביקים }` was cut at the mark's brace)
try {
  const doc = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\n' +
    'TEXT { @B{הטמעת YouTube} — מדביקים קישור ציבורי: }\n';
  const r = compile(doc);
  const content = r.blocks[0].data.content;
  check('mark brace does not close a one-line TEXT body',
    content === '@B{הטמעת YouTube} — מדביקים קישור ציבורי:');
} catch (e) {
  check('mark brace does not close a one-line TEXT body', false, e.toString());
}

try {
  const doc = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\n' +
    'TEXT {\n  @I{שלוש הסצנות צוירו על ידי הבינה.}\n}\n\nHEADING { אחרי }\n';
  const r = compile(doc);
  check('TEXT whose body is only a mark parses (no E102 on the next line)',
    r.blocks.length === 2 && r.blocks[0].data.content === '@I{שלוש הסצנות צוירו על ידי הבינה.}' &&
    r.blocks[1].type === 'heading');
} catch (e) {
  check('TEXT whose body is only a mark parses (no E102 on the next line)', false, e.toString());
}

try {
  const doc = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\n' +
    'TEXT { לפני @LINK(url: "/הבינה.html"){הקישור} אחרי }\n';
  const r = compile(doc);
  check('@LINK(url){label} survives inside a one-line body',
    r.blocks[0].data.content === 'לפני @LINK(url: "/הבינה.html"){הקישור} אחרי');
} catch (e) {
  check('@LINK(url){label} survives inside a one-line body', false, e.toString());
}

// 4ג. SPACE carries an exact height (v2.13 — drag-resize wrote 106px and the
// code tab flattened it back to the size enum)
try {
  const doc = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nSPACE(height: 106px)\n';
  const r = compile(doc);
  check('SPACE(height: 106px) compiles to an exact spacer height',
    r.blocks[0].type === 'spacer' && r.blocks[0].data.height === '106px');
} catch (e) {
  check('SPACE(height: 106px) compiles to an exact spacer height', false, e.toString());
}

try {
  compile('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nSPACE(height: banana)\n');
  check('E305 on a nonsense SPACE height', false);
} catch (e) {
  check('E305 on a nonsense SPACE height', e instanceof BentmlError && e.code === 'E305');
}

try {
  const src = compile('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nSPACE(height: 106px)\n');
  const round = decompile({ title: 't' }, src.blocks);
  check('decompile emits SPACE(height: 106px) — lossless round-trip',
    /SPACE\(height: 106px\)/.test(round));
  const again = compile(round);
  check('height survives decompile → compile',
    again.blocks[0].data.height === '106px');
} catch (e) {
  check('SPACE height round-trip', false, e.toString());
}

// enum-height spacers keep decompiling to the size name, not a raw height
try {
  const src = compile('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nSPACE(size: lg)\n');
  const round = decompile({ title: 't' }, src.blocks);
  check('SPACE(size: lg) still decompiles to the size name',
    /SPACE\(size: lg\)/.test(round) && !/height:/.test(round));
} catch (e) {
  check('SPACE(size: lg) still decompiles to the size name', false, e.toString());
}

// 5. back-compat: 0.1 documents still compile after the 0.2 bump
try {
  const legacy = compile('BENTML 0.1\n\nMETA {\n  title: "ישן"\n}\n\nTEXT { עדיין עובד }\n');
  check('BENTML 0.1 doc still compiles', legacy.blocks.length === 1 && legacy.blocks[0].type === 'text');
} catch (e) {
  check('BENTML 0.1 doc still compiles', false, e.toString());
}

// 6. the builder's source panel routes the OTHER dialect to the server.
// The 🧠 prompt teaches AIs to answer in <bent-*> .pzn; pasting that reply
// into the panel used to die in the line engine ("Expected version line
// BENTML 0.2") without ever reaching the dual-dialect server compile —
// Grok/GPT/Gemini all "failed" identically. Pin the client-side gate.
{
  const fs = require('fs');
  const path = require('path');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-bentml-ui.js'), 'utf8');
  check('panel keeps the pzn sniffer as the no-engine fallback (looksLikePznSource)', ui.includes('function looksLikePznSource'));
  // v2.20: the bundled extractor runs FIRST (fence / chat / <html> brackets
  // gone), THEN the dialect chooses the engine — pzn to the server, line local
  check('panel extracts before choosing an engine (E.extract)', /E\.extract\s*\?\s*E\.extract\(source\)/.test(ui));
  check('panel routes the pzn dialect to the server compile', /dialect\s*!==\s*'pzn'/.test(ui));
  check('panel maps error lines back through lineOffset', /lineOffset/.test(ui));
  check('panel file is plain text (no NUL bytes — git diffs it)', ui.indexOf('\u0000') === -1);
  const { buildBentmlEngine } = require('../src/bentml/browser-bundle');
  check('engine bundle exposes extract + sniffDialect', /extract: __mods\.extract\.extractBentml/.test(buildBentmlEngine()));
  // the sniffer must match what AIs actually return: a <bent-*> tag document
  const sniff = /<bent-[a-z]/i;
  check('sniffer regex matches a bent-tag reply', sniff.test('<!DOCTYPE html>\n<html bent-version="0.1"><body><bent-hero id="h"></bent-hero></body></html>'));
  check('sniffer regex leaves line-dialect sources alone', !sniff.test('BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nTEXT { hi }\n'));
}

console.log(fail ? `\n${fail} failure(s)` : '\nAll bentml smoke checks passed');
process.exit(fail ? 1 : 0);
