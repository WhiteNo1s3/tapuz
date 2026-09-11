'use strict';

/**
 * The extractor's contract (v2.20): take ONLY the BenTML out of anything a
 * model wrote — both dialects, every wrapping shape chats actually produce —
 * and be the identity on a clean document. No DB, no server: pure function.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractBentml, sniffDialect, looksLikePzn, looksLikeLine, scanFences } = require('../../src/bentml/extract');

const PZN = [
  '<!DOCTYPE html>',
  '<html lang="he" dir="rtl" bent-version="0.1">',
  '<head><meta charset="utf-8"/><title>סטודיו</title><meta name="bent-slug" content="studio"/></head>',
  '<body>',
  '  <bent-hero id="hero1">',
  '    <bent-heading id="hero1_h" level="1">סטודיו אור</bent-heading>',
  '    <bent-text id="hero1_t">צילום אירועים</bent-text>',
  '  </bent-hero>',
  '  <bent-text id="t2">פסקה שנייה</bent-text>',
  '</body>',
  '</html>'
].join('\n');

const LINE = [
  'BENTML 0.2',
  '',
  'META {',
  '  title: "המתכונים של סבתא"',
  '  slug: "recipes"',
  '}',
  '',
  'HEADING(level: 1) { המתכונים של סבתא }',
  '',
  'TEXT {',
  '  פסקה ראשונה עם @B{הדגשה}.',
  '',
  '  פסקה שנייה.',
  '}',
  '',
  'ROW {',
  '  COL { TEXT { ימין } }',
  '  COL { IMAGE(src: "/uploads/a.jpg", alt: "א") }',
  '}',
  '',
  'DIVIDER'
].join('\n');

const EMPTY_TEMPLATE = [
  '<!DOCTYPE html>',
  '<html lang="he" dir="rtl" bent-version="0.1">',
  '<head><meta charset="utf-8" /><title>כותרת הדף</title><meta name="bent-slug" content="my-page" /></head>',
  '<body>',
  '  <!-- bent-* modules here -->',
  '</body>',
  '</html>'
].join('\n');

describe('extract — the tag dialect (.pzn)', () => {
  it('is the identity on a clean document', () => {
    const r = extractBentml(PZN);
    assert.equal(r.dialect, 'pzn');
    assert.equal(r.source, PZN);
    assert.equal(r.found, true);
    assert.equal(r.lineOffset, 0);
    assert.deepEqual(r.changes, []);
  });

  it('is idempotent', () => {
    const once = extractBentml('בשמחה!\n```html\n' + PZN + '\n```\nבהצלחה!');
    const twice = extractBentml(once.source);
    assert.equal(twice.source, once.source);
    assert.equal(twice.dialect, 'pzn');
  });

  it('pulls the document out of a fenced, chatty reply', () => {
    const r = extractBentml('בשמחה! הנה הדף:\n\n```html\n' + PZN + '\n```\n\nאם תרצה שינויים — רק תגיד!');
    assert.equal(r.source, PZN);
    assert.equal(r.fenced, true);
    assert.equal(r.lineOffset, 3);
    assert.ok(r.changes.some((c) => c.code === 'FENCE'));
  });

  it('handles ~~~ fences, no info string, and an unclosed fence', () => {
    assert.equal(extractBentml('~~~\n' + PZN + '\n~~~').source, PZN);
    assert.equal(extractBentml('```\n' + PZN + '\n```').source, PZN);
    assert.equal(extractBentml('הנה:\n```html\n' + PZN).source, PZN);
  });

  it('handles a 4-backtick outer fence and code glued onto the opener', () => {
    assert.equal(extractBentml('````markdown\n```html\n' + PZN + '\n```\n````').source, PZN);
    assert.equal(extractBentml('```html' + PZN + '\n```').source, PZN);
  });

  it('slices a bare document out of prose (no fence at all)', () => {
    const r = extractBentml('הנה הדף שלך:\n' + PZN + '\nשיהיה בהצלחה!');
    assert.equal(r.source, PZN);
    assert.equal(r.lineOffset, 1);
    assert.ok(r.changes.some((c) => c.code === 'PROSE'));
  });

  it('prefers the REAL page over the empty template echoed first', () => {
    const reply = 'לפי התבנית:\n```html\n' + EMPTY_TEMPLATE + '\n```\nוהדף עצמו:\n```html\n' + PZN + '\n```';
    const r = extractBentml(reply);
    assert.equal(r.source, PZN);
    assert.ok(r.modules >= 4);
  });

  it('prefers the document fence over a css fence that comes first', () => {
    const r = extractBentml('קודם CSS:\n```css\n.x{color:red}\n```\nוהדף:\n```html\n' + PZN + '\n```');
    assert.equal(r.source, PZN);
  });

  it('keeps a body-only <bent-*> fragment and drops the chat around it', () => {
    const r = extractBentml('הוסף את זה:\n<bent-heading level="2">כותרת</bent-heading>\n<bent-text>פסקה</bent-text>\nזהו.');
    assert.equal(r.dialect, 'pzn');
    assert.equal(r.source, '<bent-heading level="2">כותרת</bent-heading>\n<bent-text>פסקה</bent-text>');
    assert.ok(r.changes.some((c) => c.code === 'FRAGMENT'));
  });

  it('cuts a truncated document (no </html>) at its last module', () => {
    const cut = PZN.slice(0, PZN.indexOf('  <bent-text id="t2">'));
    const r = extractBentml('```html\n' + cut + '\n```\n(המשך יגיע)');
    assert.equal(r.dialect, 'pzn');
    assert.ok(r.source.trimEnd().endsWith('</bent-hero>'));
    assert.ok(!/המשך/.test(r.source));
    assert.ok(r.changes.some((c) => c.code === 'TRUNCATED'));
  });

  it('decodes entity-escaped markup copied from a rendered bubble', () => {
    const escaped = PZN.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const r = extractBentml(escaped);
    assert.equal(r.source, PZN);
    assert.ok(r.changes.some((c) => c.code === 'UNESCAPE'));
  });

  it('leaves a real &lt; inside a document alone', () => {
    const doc = PZN.replace('<bent-text id="t2">פסקה שנייה</bent-text>',
      '<bent-html id="raw" content="&lt;div&gt;x&lt;/div&gt;" provisional="true" />');
    assert.equal(extractBentml(doc).source, doc);
  });

  it('strips zero-width characters and a BOM that break <!DOCTYPE', () => {
    const r = extractBentml('﻿<!DOC​TYPE html>' + PZN.slice('<!DOCTYPE html>'.length));
    assert.equal(r.source, PZN);
  });

  it('keeps CRLF when the whole document uses it (a Windows checkout is stored byte-for-byte)', () => {
    const crlf = PZN.replace(/\n/g, '\r\n');
    assert.equal(extractBentml(crlf).source, crlf);
    assert.equal(extractBentml(LINE.replace(/\n/g, '\r\n')).source, LINE.replace(/\n/g, '\r\n'));
    // …and still extracts through fences and chat in CRLF
    const r = extractBentml('Sure:\r\n```html\r\n' + crlf + '\r\n```\r\nDone.');
    assert.equal(r.source, crlf);
    assert.equal(r.lineOffset, 2);
  });

  it('normalizes MIXED line endings to LF (a paste artifact, not formatting)', () => {
    assert.equal(extractBentml('Here:\r\n' + PZN + '\nbye').source, PZN);
  });

  it('adds <body> when the model forgot it', () => {
    const noBody = '<html lang="he" dir="rtl" bent-version="0.1">\n<head><title>x</title></head>\n<bent-text>שלום</bent-text>\n</html>';
    const r = extractBentml(noBody);
    assert.match(r.source, /<\/head>\n<body>\n<bent-text>שלום<\/bent-text>\n<\/body>\n<\/html>/);
    assert.ok(r.changes.some((c) => c.code === 'BODY'));
  });

  it('keeps a ``` line that lives inside a bent-html attribute of a clean document', () => {
    const doc = PZN.replace('<bent-text id="t2">פסקה שנייה</bent-text>',
      '<bent-html id="raw" content="&lt;pre&gt;\n```\ncode\n```\n&lt;/pre&gt;" provisional="true" />');
    assert.equal(extractBentml(doc).source, doc);
  });
});

describe('extract — the keyword dialect ("BENTML 0.2")', () => {
  it('is the identity on a clean document', () => {
    const r = extractBentml(LINE);
    assert.equal(r.dialect, 'line');
    assert.equal(r.source, LINE);
    assert.equal(r.lineOffset, 0);
    assert.deepEqual(r.changes, []);
  });

  it('is idempotent', () => {
    const once = extractBentml('Sure!\n```bentml\n' + LINE + '\n```\nEnjoy!');
    assert.equal(extractBentml(once.source).source, once.source);
  });

  it('pulls the document out of a fenced reply with prose on both sides', () => {
    const r = extractBentml('Sure! Here is the page:\n\n```bentml\n' + LINE + '\n```\n\nLet me know if you want changes.');
    assert.equal(r.source, LINE);
    assert.equal(r.fenced, true);
    assert.equal(r.lineOffset, 3);
  });

  it('removes the <html> brackets a chat wrapped around it (Ben\'s bug)', () => {
    const r = extractBentml('<html>\n' + LINE + '\n</html>');
    assert.equal(r.source, LINE);
    assert.ok(r.changes.some((c) => c.code === 'WRAPPER' || c.code === 'PROSE'));
  });

  it('removes <!DOCTYPE>/<html>/<body>/<pre>/<code> wrappers, even glued to the code', () => {
    const wrapped = '<!DOCTYPE html>\n<html>\n<body>\n<pre><code class="language-bentml">' + LINE + '</code></pre>\n</body>\n</html>';
    const r = extractBentml(wrapped);
    assert.equal(r.source, LINE);
  });

  it('drops trailing chat, including the PZN_READY marker, but never a body line', () => {
    const r = extractBentml(LINE + '\nPZN_READY\nזהו — מקווה שזה עוזר!\nLet me know.');
    assert.equal(r.source, LINE);
    // body prose that merely LOOKS like chat stays because structure follows
    // it — and the author's own trailing newline survives (byte identity)
    const inner = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nTEXT {\n  Let me know.\n  Done\n}\n';
    assert.equal(extractBentml(inner).source, inner);
  });

  it('keeps trailing whitespace of a clean document in both dialects (store-safe identity)', () => {
    assert.equal(extractBentml(LINE + '\n').source, LINE + '\n');
    assert.equal(extractBentml(PZN + '\n').source, PZN + '\n');
    assert.equal(extractBentml(LINE + '\n\n').source, LINE + '\n\n');
  });

  it('adds the version line when the model dropped it', () => {
    const noVersion = LINE.split('\n').slice(2).join('\n');
    const r = extractBentml('הנה:\n' + noVersion + '\nבהצלחה');
    assert.equal(r.dialect, 'line');
    assert.equal(r.source, 'BENTML 0.2\n' + noVersion);
    assert.ok(r.changes.some((c) => c.code === 'VERSION_LINE'));
    assert.equal(r.lineOffset, 0); // line 1 of the source is synthetic; line 2 ↔ original line 2
  });

  it('normalizes "BenTML v0.2" to the exact version line', () => {
    const r = extractBentml('BenTML v0.2\n' + LINE.split('\n').slice(1).join('\n'));
    assert.equal(r.source, LINE);
  });

  it('keeps a ``` line inside an HTML {{{ }}} raw block of a clean document', () => {
    const raw = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nHTML {{{\n<pre>\n```\nx\n```\n</pre>\n}}}\n\nTEXT { אחרי }';
    assert.equal(extractBentml(raw).source, raw);
  });

  it('keeps <div> markup inside an HTML {{{ }}} raw block when the doc is fenced', () => {
    const raw = 'BENTML 0.2\n\nMETA {\n  title: "t"\n}\n\nHTML {{{\n<div class="x"><code>y</code></div>\n}}}';
    assert.equal(extractBentml('```\n' + raw + '\n```').source, raw);
  });

  it('decodes an entity-escaped keyword document', () => {
    const escaped = LINE.replace(/"/g, '&quot;');
    assert.equal(extractBentml(escaped).source, LINE);
  });

  it('survives a stray "Done" chat line after a no-body block', () => {
    const r = extractBentml(LINE + '\n\nDone. Tell me what to change.');
    assert.equal(r.source, LINE);
  });
});

describe('extract — choosing between dialects and nothing', () => {
  it('returns unknown (and the trimmed text) when no BenTML is present', () => {
    const r = extractBentml('  שלום, איך אפשר לעזור?  ');
    assert.equal(r.dialect, 'unknown');
    assert.equal(r.found, false);
    assert.equal(r.source, 'שלום, איך אפשר לעזור?');
  });

  it('handles empty / non-string input', () => {
    assert.equal(extractBentml('').found, false);
    assert.equal(extractBentml(null).found, false);
    assert.equal(extractBentml(undefined).source, '');
  });

  it('picks the richer dialect when a reply mentions the other one', () => {
    // a keyword page whose TEXT mentions a tag name → still the keyword page
    const line = LINE.replace('פסקה שנייה.', 'בעבר כתבנו <bent-hero> ידנית.');
    assert.equal(extractBentml(line).dialect, 'line');
    // a tag page whose text mentions the version line → still the tag page
    const pzn = PZN.replace('פסקה שנייה', 'השורה הראשונה היא BENTML 0.2 תמיד');
    assert.equal(extractBentml(pzn).dialect, 'pzn');
  });

  it('exposes the sniffers', () => {
    assert.equal(sniffDialect('```\n' + LINE + '\n```'), 'line');
    assert.equal(sniffDialect('x ' + PZN), 'pzn');
    assert.equal(sniffDialect('nothing here'), 'unknown');
    assert.equal(looksLikePzn(PZN), true);
    assert.equal(looksLikePzn(LINE), false);
    assert.equal(looksLikeLine(LINE), true);
    assert.equal(looksLikeLine(PZN), false);
  });

  it('scanFences follows CommonMark: closer must match char and be at least as long', () => {
    // a ~~~ line does not close a ``` fence; a longer ```` line does
    const f = scanFences(['```js', 'a', '~~~', 'b', '````']);
    assert.equal(f.length, 1);
    assert.deepEqual(f[0].body, ['a', '~~~', 'b']);
    assert.equal(f[0].unclosed, false);
    // a 4-backtick fence swallows an inner 3-backtick one whole
    const g = scanFences(['````', '```html', 'x', '```', '````']);
    assert.equal(g.length, 1);
    assert.deepEqual(g[0].body, ['```html', 'x', '```']);
    // a fence the model never closed runs to the end
    const h = scanFences(['text', '```', 'y']);
    assert.equal(h.length, 1);
    assert.equal(h[0].unclosed, true);
    assert.deepEqual(h[0].body, ['y']);
  });
});
