'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { unescapeHtml, escapeHtml } = require('../../src/pzn/language/escape');

// unescapeHtml feeds the decompiler: real pages carry © — ' " … ® ™ and
// numeric entities, and importing them as literal "&copy;" ships garbage.
describe('unescapeHtml', () => {
  it('decodes the core five exactly as before', () => {
    assert.equal(unescapeHtml('&lt;a&gt;'), '<a>');
    assert.equal(unescapeHtml('&quot;hi&quot;'), '"hi"');
    assert.equal(unescapeHtml('it&#39;s'), "it's");
    assert.equal(unescapeHtml('a &amp; b'), 'a & b');
  });

  it('decodes common named entities from real pages', () => {
    assert.equal(unescapeHtml('&copy; 2026'), '© 2026');
    assert.equal(unescapeHtml('x&mdash;y'), 'x—y');
    assert.equal(unescapeHtml('A&trade; B&reg;'), 'A™ B®');
    assert.equal(unescapeHtml('&hellip;'), '…');
  });

  it('normalizes &nbsp; to a regular space (clean, editable text)', () => {
    const out = unescapeHtml('a&nbsp;b');
    assert.equal(out, 'a b');
    assert.equal(out.charCodeAt(1), 32); // 0x20, not 0xA0
  });

  it('decodes decimal and hex numeric references', () => {
    assert.equal(unescapeHtml('&#169;'), '©');
    assert.equal(unescapeHtml('&#xA9;'), '©');
    assert.equal(unescapeHtml('&#x2014;'), '—');
  });

  it('single-pass: an escaped entity stays literal (no double-decode)', () => {
    assert.equal(unescapeHtml('&amp;copy;'), '&copy;');
    assert.equal(unescapeHtml('&#38;copy;'), '&copy;');
  });

  it('passes unknown names and bare ampersands through untouched', () => {
    assert.equal(unescapeHtml('&frobnicate;'), '&frobnicate;');
    assert.equal(unescapeHtml('Tom & Jerry'), 'Tom & Jerry');
    assert.equal(unescapeHtml('&#99999999;'), '&#99999999;'); // out of range
  });

  it('is the inverse of escapeHtml for plain text', () => {
    const t = 'café © "quotes" & <tag> — עברית';
    assert.equal(unescapeHtml(escapeHtml(t)), t);
  });

  it('never throws on odd input', () => {
    for (const s of [null, undefined, '', '&', '&;', '&#;', '&#x;', '&&&']) {
      assert.doesNotThrow(() => unescapeHtml(s));
    }
  });
});
