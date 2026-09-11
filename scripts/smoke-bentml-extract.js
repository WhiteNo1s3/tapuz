'use strict';

/**
 * v2.20 QA — "take only the BenTML, any time, anywhere."
 *
 * Ben's rule: whatever a model wrapped around its page — a code fence, a
 * "here you go", the <html> brackets around a keyword document, the empty
 * template echoed before the real one — the system keeps ONLY the BenTML.
 * This gate proves the property where it matters most:
 *
 *   1. IDENTITY — every shipped .pzn / .btml (seed pages, examples) passes
 *      through the extractor byte-for-byte. The extractor now sits in front
 *      of the page store, so this is the "we never damage a clean file" law.
 *   2. THE MATRIX — both dialects × every wrapping shape land as the SAME
 *      blocks as the clean document, through the shared pipeline
 *      (pznSourceToBlocks) and the store-bound one (toPznSource).
 *   3. THE STORE — savePageSource keeps the bare document; a keyword
 *      document is stored as .pzn and its META reaches the page index.
 *   4. THE BROWSER — the engine bundle carries the extractor (the builder
 *      panel extracts before choosing an engine) and agrees with the server.
 *
 * Runs on a throwaway TAPUZ_ROOT.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

if (!process.env.TAPUZ_ROOT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-extract-'));
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TAPUZ_ROOT: tmp },
    stdio: 'inherit'
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(r.status == null ? 1 : r.status);
}

require('../src/db');
const { extractBentml } = require('../src/bentml/extract');
const { toPznSource, pznSourceToBlocks } = require('../src/pzn-source');
const pzn = require('../src/pzn/index');
const { createPage, getPageByFullPath, savePageSource, getPageSource } = require('../src/pages');
const { pznPathFor } = require('../src/pzn-store');

let fail = false;
function check(name, cond, detail) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (!cond && detail ? ' — ' + detail : ''));
  if (!cond) fail = true;
}

const ROOT = path.join(__dirname, '..');

// ── 1. identity on every shipped document ─────────────────────────────
function listDocs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) listDocs(p, out);
    else if (/\.(pzn|btml)$/i.test(name)) out.push(p);
  }
  return out;
}
const shipped = [
  ...listDocs(path.join(ROOT, 'seed', 'pages')),
  ...listDocs(path.join(ROOT, 'examples'))
];
check('found shipped documents to test against', shipped.length >= 10, String(shipped.length));
const notIdentity = [];
for (const file of shipped) {
  const src = fs.readFileSync(file, 'utf8');
  const ex = extractBentml(src);
  const expectDialect = /\.btml$/i.test(file) ? 'line' : 'pzn';
  if (ex.source !== src || ex.dialect !== expectDialect || ex.changes.length) {
    notIdentity.push(path.relative(ROOT, file) + ' (' + ex.dialect + ', ' + ex.changes.map((c) => c.code).join('+') + ')');
  }
}
check('extractor is the identity on every shipped .pzn/.btml (' + shipped.length + ' files)', notIdentity.length === 0, notIdentity.join('; '));

// ── 2. the matrix ─────────────────────────────────────────────────────
const PZN_DOC = [
  '<!DOCTYPE html>',
  '<html lang="he" dir="rtl" bent-version="0.1">',
  '<head><meta charset="utf-8"/><title>דף מטריצה</title><meta name="bent-slug" content="matrix"/></head>',
  '<body>',
  '  <bent-hero id="hero1">',
  '    <bent-heading id="hero1_h" level="1">כותרת המטריצה</bent-heading>',
  '    <bent-text id="hero1_t">משנה</bent-text>',
  '  </bent-hero>',
  '  <bent-text id="t2">פסקה</bent-text>',
  '</body>',
  '</html>'
].join('\n');
const LINE_DOC = [
  'BENTML 0.2',
  '',
  'META {',
  '  title: "דף מטריצה"',
  '  slug: "matrix"',
  '  description: "תיאור למנועי חיפוש"',
  '}',
  '',
  'HERO {',
  '  HEADING(level: 1) { כותרת המטריצה }',
  '  TEXT { משנה }',
  '}',
  '',
  'TEXT { פסקה }'
].join('\n');
const EMPTY_TEMPLATE = '<!DOCTYPE html>\n<html lang="he" dir="rtl" bent-version="0.1">\n<head><meta charset="utf-8" /><title>כותרת הדף</title><meta name="bent-slug" content="my-page" /></head>\n<body>\n  <!-- bent-* modules here -->\n</body>\n</html>';

const WRAPS = {
  'bare': (d) => d,
  'trailing newline': (d) => d + '\n',
  'prose around': (d) => 'בשמחה! הנה הדף:\n\n' + d + '\n\nאם תרצה שינויים — רק תגיד!',
  '``` fence': (d) => '```\n' + d + '\n```',
  '```html fence + chat': (d) => 'Sure, here you go:\n```html\n' + d + '\n```\nLet me know!',
  '```bentml fence + PZN_READY': (d) => '```bentml\n' + d + '\n```\nPZN_READY',
  '~~~ fence': (d) => '~~~\n' + d + '\n~~~',
  'unclosed fence': (d) => 'הנה:\n```\n' + d,
  '4-backtick outer fence': (d) => '````markdown\n```html\n' + d + '\n```\n````',
  'code glued to the opener': (d) => '```html' + d + '\n```',
  'template echoed first': (d) => 'לפי התבנית:\n```html\n' + EMPTY_TEMPLATE + '\n```\nוהדף:\n```html\n' + d + '\n```',
  'CRLF': (d) => d.replace(/\n/g, '\r\n'),
  'BOM + zero-width': (d) => '﻿' + d.replace('BENTML 0.2', 'BENTML​ 0.2').replace('<!DOCTYPE', '<!DOC​TYPE'),
  '<html> brackets (Ben\'s bug)': (d) => '<html>\n' + d + '\n</html>',
  '<pre><code> wrapper': (d) => '<pre><code class="language-bentml">' + d + '</code></pre>',
  '<!DOCTYPE><html><body> shell': (d) => '<!DOCTYPE html>\n<html>\n<body>\n' + d + '\n</body>\n</html>',
  'entity-escaped copy': (d) => d.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
};
// wrappers that only make sense for one dialect
const LINE_ONLY = new Set(['<html> brackets (Ben\'s bug)', '<pre><code> wrapper', '<!DOCTYPE><html><body> shell']);

const shape = (blocks) => JSON.stringify(blocks.map((b) => [b.type, b.data && (b.data.text || b.data.content || b.data.title || '')]));
const refPzn = pznSourceToBlocks(PZN_DOC);
const refLine = pznSourceToBlocks(LINE_DOC);
check('reference documents compile (pzn 2 blocks, line 2 blocks)', refPzn.view.blocks.length === 2 && refLine.view.blocks.length === 2);
check('both dialects describe the same page (hero + text)', shape(refPzn.view.blocks) === shape(refLine.view.blocks), shape(refPzn.view.blocks) + ' vs ' + shape(refLine.view.blocks));

for (const [name, wrap] of Object.entries(WRAPS)) {
  for (const [dialect, doc, ref] of [['pzn', PZN_DOC, refPzn], ['line', LINE_DOC, refLine]]) {
    if (dialect === 'pzn' && LINE_ONLY.has(name)) continue;
    const input = wrap(doc);
    let ok = false; let detail = '';
    try {
      const r = pznSourceToBlocks(input);
      const t = toPznSource(input);
      const stored = pzn.toTapuzPage(pzn.parse(t.source));
      ok = r.dialect === dialect && shape(r.view.blocks) === shape(ref.view.blocks) && r.view.title === 'דף מטריצה' &&
        t.dialect === dialect && shape(stored.blocks) === shape(ref.view.blocks) && !/```|PZN_READY|Let me know|בשמחה|<pre>|<code/.test(t.source);
      if (!ok) detail = JSON.stringify({ dialect: r.dialect, title: r.view.title, blocks: shape(r.view.blocks), stored: t.source.slice(0, 80) });
    } catch (e) { detail = e.message; }
    check(`[${dialect}] ${name}`, ok, detail);
  }
}

// idempotency across the matrix
let notIdempotent = 0;
for (const wrap of Object.values(WRAPS)) {
  for (const doc of [PZN_DOC, LINE_DOC]) {
    const once = extractBentml(wrap(doc));
    if (!once.found) continue;
    const twice = extractBentml(once.source);
    if (twice.source !== once.source || twice.dialect !== once.dialect) notIdempotent++;
  }
}
check('extract(extract(x)) ≡ extract(x) across the matrix', notIdempotent === 0, String(notIdempotent));

// nothing is not something
check('plain chat is left alone (dialect unknown, nothing invented)', extractBentml('שלום, איך אפשר לעזור?').dialect === 'unknown');
check('a real HTML page is not mistaken for BenTML', extractBentml('<!DOCTYPE html><html><body><h1>site</h1><p>text</p></body></html>').dialect === 'unknown');
check('the empty template is recognized as .pzn (so the doors can say "empty page")', extractBentml('```html\n' + EMPTY_TEMPLATE + '\n```').dialect === 'pzn');

// a broken keyword document names line + fix (no repair engine, no crash)
try {
  toPznSource('Sure:\n```\nBENTML 0.2\n\nMETA {\n  title: "x"\n}\n\nTEXTX { y }\n```');
  check('broken keyword document throws', false);
} catch (e) {
  check('broken keyword document throws its BentmlError (E201, line 7, with a fix)', e.code === 'E201' && e.line === 7 && !!e.fix, JSON.stringify({ code: e.code, line: e.line }));
}

// ── 3. the store ──────────────────────────────────────────────────────
createPage({ title: 'יעד', slug: 'store-target', blocks: [] });
savePageSource('store-target', WRAPS['```html fence + chat'](PZN_DOC));
check('store keeps the bare .pzn — no fence, no chat', fs.readFileSync(pznPathFor('store-target', 'draft'), 'utf8') === PZN_DOC);
savePageSource('store-target', WRAPS['<html> brackets (Ben\'s bug)'](LINE_DOC));
const storedLine = fs.readFileSync(pznPathFor('store-target', 'draft'), 'utf8');
check('a keyword document is stored as a .pzn tag document', /^<!DOCTYPE html>/.test(storedLine) && /<bent-hero/.test(storedLine) && !/BENTML 0\.2/.test(storedLine));
const page = getPageByFullPath('store-target');
check('its META description landed in the page index', page && page.meta && page.meta.description === 'תיאור למנועי חיפוש');
check('its title synced from META', page && page.title === 'דף מטריצה');
check('getPageSource returns the clean document', getPageSource('store-target', 'draft') === storedLine);
// identity through the store: saving a clean document changes nothing
savePageSource('store-target', PZN_DOC + '\n');
check('a clean document is stored byte-for-byte (trailing newline kept)', fs.readFileSync(pznPathFor('store-target', 'draft'), 'utf8') === PZN_DOC + '\n');

// ── 4. the browser ────────────────────────────────────────────────────
const vm = require('vm');
const { buildBentmlEngine } = require('../src/bentml/browser-bundle');
const window = {};
vm.runInNewContext(buildBentmlEngine(), { window });
const E = window.BentmlEngine;
check('engine bundle exposes extract + sniffDialect', E && typeof E.extract === 'function' && typeof E.sniffDialect === 'function');
if (E && E.extract) {
  let agree = 0; let total = 0;
  for (const wrap of Object.values(WRAPS)) {
    for (const doc of [PZN_DOC, LINE_DOC]) {
      total++;
      const a = E.extract(wrap(doc));
      const b = extractBentml(wrap(doc));
      if (a.source === b.source && a.dialect === b.dialect && a.lineOffset === b.lineOffset) agree++;
    }
  }
  check('browser extract ≡ server extract across the matrix (' + agree + '/' + total + ')', agree === total);
  const fenced = E.extract('Sure!\n\n```bentml\n' + LINE_DOC + '\n```');
  check('browser extract reports lineOffset for error mapping (3 lines before the document)', fenced.lineOffset === 3);
  const compiled = E.compile(fenced.source);
  check('browser engine compiles the extracted keyword document', compiled.blocks.length === 2 && compiled.page.title === 'דף מטריצה');
}

console.log('');
console.log(fail ? 'SMOKE BENTML-EXTRACT: FAIL' : 'SMOKE BENTML-EXTRACT: PASS');
process.exit(fail ? 1 : 0);
