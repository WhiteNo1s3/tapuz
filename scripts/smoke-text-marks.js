'use strict';

/**
 * v2.66 QA gate — the Word bar and the inline marks it writes.
 *
 * Ben: "we don't include tools for advanced editing and even underline we
 * don't have, we need a bar with the basic text function of word with
 * hyperlink option … a coloring scheme for the site, fonts … raising the
 * size, it now requires html". Pinned here, no server, no DB:
 *
 *   1. the renderer expands the six new marks — @U @S @COLOR @HIGHLIGHT
 *      @FONT @SIZE — and NESTED marks, with every text leaf escaped and no
 *      author value reaching a style attribute as written (a palette token
 *      becomes a CSS variable, a hex passes, anything else drops the paint
 *      and keeps the words)
 *   2. the BenTML parser reads nested marks in one-line and multi-line
 *      bodies, and nested marks survive decompile → compile
 *   3. the builder's bar has the tools, the link prompt asks for the words
 *      when nothing is selected, the canvas renders marks wherever the site
 *      does, and the client mirror knows exactly the marks the server knows
 *   4. the canvas action bars belong to the hovered block, not to every
 *      block under a hovered container (Ben: "many menus on the page when
 *      it should be on hover")
 *   5. the docs, the dictionary and the agent primers name the new marks
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.TAPUZ_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-textmarks-'));

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let failures = 0;
function check(cond, label, detail) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (!cond && detail ? ' — ' + detail : ''));
  if (!cond) failures++;
}

// ── 1. the renderer ──
const { renderInlineMarks, INLINE_SIZES } = require('../src/renderer');
const r = renderInlineMarks;

check(r('@U{קו}') === '<u>קו</u>', '@U renders <u>');
check(r('@S{נמחק}') === '<s>נמחק</s>', '@S renders <s>');
check(r('@B{@U{x}} y') === '<strong><u>x</u></strong> y', 'nested marks: @B{@U{x}} is bold-underline', r('@B{@U{x}} y'));
check(r('@SIZE(size: "xl"){@COLOR(name: "primary"){@B{@I{deep}}}}') ===
  '<span style="font-size:1.45em"><span style="color:var(--color-primary)"><strong><em>deep</em></strong></span></span>',
  'four levels nest, innermost first', r('@SIZE(size: "xl"){@COLOR(name: "primary"){@B{@I{deep}}}}'));
check(r('@COLOR(name: "primary"){חשוב}') === '<span style="color:var(--color-primary)">חשוב</span>',
  '@COLOR with a palette token renders the theme variable');
check(r('@COLOR(name: "light-bg"){x}').includes('var(--color-light-bg)'), 'light-bg maps to --color-light-bg');
check(r('@COLOR(name: "#FF0000"){red}') === '<span style="color:#ff0000">red</span>', '@COLOR with a hex passes it (lower-cased)');
const bad = r('@COLOR(name: "red;background:url(x)"){bad}');
check(bad === 'bad', 'an unknown color value keeps the words and drops the paint', bad);
check(!/style=/.test(r('@COLOR(name: "expression(1)"){x} @FONT(name: "x<y"){y} @SIZE(size: "99px"){z}')),
  'no unknown value ever reaches a style attribute');
check(r('@HIGHLIGHT(name: "secondary"){hi}') === '<mark style="background:var(--color-secondary);color:inherit">hi</mark>',
  '@HIGHLIGHT renders <mark> with the palette variable and inherits the text color');
check(r('@FONT(name: "heading"){h}') === '<span style="font-family:var(--font-heading)">h</span>', '@FONT heading → --font-heading');
check(r('@FONT(name: "Suez One"){s}') === '<span style="font-family:&quot;Suez One&quot;, var(--font-family)">s</span>',
  'a shelf family is quoted and falls back to the site font', r('@FONT(name: "Suez One"){s}'));
check(r('@FONT(name: "mono"){m}').includes('monospace'), '@FONT mono is a monospace stack');
Object.keys(INLINE_SIZES).forEach((k) => {
  check(r(`@SIZE(size: "${k}"){t}`) === `<span style="font-size:${INLINE_SIZES[k]}">t</span>`, `@SIZE ${k} → ${INLINE_SIZES[k]}`);
});
check(r('@SIZE(size: "md"){t}') === 't', 'an unknown size step keeps the words');
check(r('@B{a @LINK(url: "/p"){l} b}') === '<strong>a <a href="/p" rel="noopener">l</a> b</strong>', 'a link nests inside bold');
check(r('@LINK(url: "javascript:alert(1)"){x}') === '<a href="#" rel="noopener">x</a>', 'javascript: links are still neutered');
check(r('@U{<i>} & @B{a @BREAK b}') === '<u>&lt;i&gt;</u> &amp; <strong>a <br> b</strong>',
  'text inside nested marks is escaped; @BREAK inside a mark still breaks', r('@U{<i>} & @B{a @BREAK b}'));
check(r('a @B{b} c') === 'a <strong>b</strong> c' && r('@I{x}') === '<em>x</em>' && r('@CODE{y}') === '<code>y</code>',
  'the v0.1 marks render as before');
check(r('@B{unclosed') === '@B{unclosed' && r('plain') === 'plain', 'an unclosed mark stays literal');

// ── 2. the parser and the round trip ──
const { compile } = require('../src/bentml/compile');
const { decompile } = require('../src/bentml/decompile');
const DOC = (body) => 'BENTML 0.1\n\nMETA {\n  title: "t"\n}\n\n' + body + '\n';
let c = compile(DOC('TEXT { לפני @B{@U{פנימי}} אחרי }\n\nHEADING { אחרי }'));
check(c.blocks.length === 2 && c.blocks[0].data.content === 'לפני @B{@U{פנימי}} אחרי',
  'one-line body: a nested mark does not close the body early', JSON.stringify(c.blocks.map((b) => b.data)));
c = compile(DOC('TEXT {\n  @COLOR(name: "primary"){צבע} ו-@SIZE(size: "xl"){גדול}\n\n  @B{שורה\n  שנייה @I{נטוי}} סוף\n}\n\nHEADING { @U{קו} }'));
check(c.blocks.length === 2 && c.blocks[0].data.content === '@COLOR(name: "primary"){צבע} ו-@SIZE(size: "xl"){גדול}\n\n@B{שורה\nשנייה @I{נטוי}} סוף' &&
  c.blocks[1].data.text === '@U{קו}',
  'multi-line body: valued marks and a nested mark split over lines compile', JSON.stringify(c.blocks.map((b) => b.data)));
const back = decompile({ title: 't' }, c.blocks);
const again = compile(back);
check(JSON.stringify(again.blocks.map((b) => b.data)) === JSON.stringify(c.blocks.map((b) => b.data)),
  'nested and valued marks survive decompile → compile', back);
check(!(c.errors || []).length && !(again.errors || []).length, 'no compile errors on the way');

// ── 3. the builder ──
const builder = read('public/admin-builder.js');
["btn('B',", "btn('I',", "btn('U',", "btn('S',", "btn('LINK',", "btn('CODE',", "btn('CLEAR',",
  'data-size-step="-1"', 'data-size-step="1"', 'class="te-size"', 'class="te-font"', 'data-pop="color"', 'data-pop="highlight"',
  "['start', 'center', 'end'].map(function (a) {"].forEach((needle) => {
  check(builder.includes(needle), 'the bar has ' + needle);
});
check(builder.includes('class="te-link-text"') && builder.includes('class="te-link-url"') && /needText = !existing && a === b/.test(builder),
  'the link prompt asks for the words first when nothing is selected, then the address');
check(builder.includes('te-pop-unlink'), 'a link under the caret can be edited or removed');
check(/function teCleanUrl[\s\S]{0,400}'https:\/\/' \+ s/.test(builder), 'a bare domain becomes https://');
check(/INLINE_PALETTE_NAMES = \['primary', 'secondary', 'text', 'muted', 'bg', 'light-bg', 'surface', 'border'\]/.test(builder) &&
  builder.includes("fetch('/admin/api/theme'"), 'the swatches are the site palette, fetched from the theme API');
check(builder.includes('te-swatch-custom'), 'a custom color is still one click away');
['text: /^content$/', 'heading: /^text$/', 'hero: /^(title|subtitle)$/', 'quote: /^text$/', 'testimonial: /^quote$/',
  'list: /^items\\.\\d+(\\.text)?$/', 'tabs: /^items\\.\\d+\\.content$/', 'accordion: /^items\\.\\d+\\.content$/'].forEach((f) => {
  check(builder.includes(f), 'MARK_FIELDS names ' + f.split(':')[0]);
});
check(/var hasBar = !isHtml && fieldTakesMarks\(block\.type, key\)/.test(builder), 'the bar shows only on fields the site renders marks in');
[
  ['hero title', `'<h1 data-inline-key="title">' + renderMarksPreview(d.title`],
  ['heading', `data-inline-key="text" style="margin:4px 0">' +\n        renderMarksPreview(d.text`],
  ['quote', `'<p data-inline-key="text">' + renderMarksPreview(d.text`],
  ['testimonial', `data-inline-key="quote" style="font-style:italic">' + renderMarksPreview(d.quote`],
  ['list item', `renderMarksPreview(typeof it === 'string' ? it : (it.text || ''))`],
  ['tab body', `'<div class="preview-tab-body">' + renderMarksPreview(`],
  ['fold body', `'<div class="preview-fold-body">' + renderMarksPreview(`]
].forEach(([what, needle]) => check(builder.includes(needle), 'the canvas renders marks in the ' + what + ' preview'));
check(/var withMarks = !!blk && fieldTakesMarks\(blk\.type, key\)/.test(builder), 'the live mirror renders marks wherever the site does');
// the client mirror knows the same marks as the server
const renderer = read('src/renderer.js');
const plainRe = /@\(B\|I\|U\|S\|CODE\)\\\{/;
const valuedRe = /@\(COLOR\|HIGHLIGHT\|FONT\|SIZE\)/;
check(plainRe.test(renderer) && plainRe.test(builder), 'server and canvas agree on the plain marks (B I U S CODE)');
check(valuedRe.test(renderer) && valuedRe.test(builder), 'server and canvas agree on the valued marks (COLOR HIGHLIGHT FONT SIZE)');
check(/guard < 16/.test(renderer) && /guard < 16/.test(builder), 'both expand nested marks innermost-first');

// ── 4. the canvas action bars ──
const css = read('public/css/admin.css');
check(css.includes('.canvas-block:hover:not(:has(.canvas-block:hover)) > .block-toolbar'),
  'a block\'s action bar lights for the block the pointer is ON, not for every block under a hovered container');
check(!/\.canvas-block:hover \.block-toolbar/.test(css), 'the old descendant hover rule is gone');
check(css.includes('.canvas-block.selected > .block-toolbar'), 'the selected block keeps its bar');
['.te-pop', '.te-swatch', '.te-group', '.te-size', '.te-font'].some((s) => css.includes(s));
check(css.includes('.text-editor-box .te-pop') && css.includes('.text-editor-box .te-swatch'), 'the popover row and the swatches are styled');

// ── 5. the words for agents ──
const spec = read('docs/bentml-v0.md');
check(spec.includes('`@U{ ... }`') && spec.includes('`@COLOR(name: "..."){ ... }`') && spec.includes('`@SIZE(size: "..."){ ... }`'),
  'the spec table lists the new constructs');
check(/Inline constructs nest/.test(spec) && !/Inline constructs do not nest/.test(spec), 'the spec says marks nest');
check(read('docs/bentml-cheatsheet.md').includes('@U{underline}'), 'the cheatsheet names @U');
check(read('src/syntax-dictionary.js').includes("syntax: '@U{…}'"), 'the syntax dictionary names @U');
check(read('docs/SYNTAX-DICTIONARY.md').includes('@COLOR('), 'docs/SYNTAX-DICTIONARY.md was regenerated');
check(read('src/pzn/agent-primer.js').includes('@U{…}'), 'the agent primer names @U');
check(read('public/chat-snippet.txt').includes('@U{'), 'the chat snippet names @U');

console.log('\nSMOKE TEXT-MARKS: ' + (failures ? 'FAIL (' + failures + ')' : 'PASS'));
process.exit(failures ? 1 : 0);
