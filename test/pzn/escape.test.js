'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { unescapeHtml, escapeHtml, safeHref, escapeCssUrl } = require('../../src/pzn/language/escape');

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

// safeHref is the .pzn standard's rule-9 URL guard (docs/pzn-spec.md): clickable
// link props (href/url) MUST reject javascript:/data:/vbscript:. A naive
// ^scheme: check is bypassed by control chars a browser strips before resolving
// the URL — this locks the hardened normalization in so the guarantee can't
// silently regress.
describe('safeHref (executable-scheme rejection, spec rule 9)', () => {
  it('rejects the three executable schemes outright', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)', 'JavaScript:alert(1)']) {
      assert.equal(safeHref(u), '#', u);
    }
  });

  it('rejects schemes hidden behind LEADING whitespace or control chars', () => {
    for (const u of ['  javascript:alert(1)', '\tjavascript:alert(1)', '\njavascript:alert(1)', '\x01javascript:alert(1)', '\x1Fjavascript:alert(1)']) {
      assert.equal(safeHref(u), '#', JSON.stringify(u));
    }
  });

  it('rejects schemes with control chars smuggled INSIDE the scheme', () => {
    // browsers strip tab/newline/CR from within a scheme, so these execute
    for (const u of ['java\tscript:alert(1)', 'java\nscript:alert(1)', 'java\rscript:alert(1)', 'Ja\tvaScript:alert(1)']) {
      assert.equal(safeHref(u), '#', JSON.stringify(u));
    }
  });

  it('leaves legitimate URLs intact (incl. mailto/tel and %09-encoded chars)', () => {
    assert.equal(safeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
    assert.equal(safeHref('/about'), '/about');
    assert.equal(safeHref('mailto:a@b.co'), 'mailto:a@b.co');
    assert.equal(safeHref('tel:+123'), 'tel:+123');
    assert.equal(safeHref('https://x.com/a%09b'), 'https://x.com/a%09b'); // %09 is encoded, not a raw control char
  });

  it('empty / nullish input becomes a harmless "#"', () => {
    for (const u of [null, undefined, '', '   ', '\t\n']) {
      assert.equal(safeHref(u), '#', JSON.stringify(u));
    }
  });
});

// escapeCssUrl is the other half of spec rule 9: background-image URLs are
// escaped for the CSS url() context (rendered as background-image:url('…')
// inside a style attribute or <style> block), not just HTML. A raw `)`, quote,
// or `<` would break out of the url()/rule; this locks the CSS-hex escaping in
// so a background-image can never inject a CSS declaration or a </style>.
describe('escapeCssUrl (CSS url() breakout resistance, spec rule 9)', () => {
  const hasRawBreakout = (s) => /[)("'\\<>\r\n\f]/.test(s.replace(/\\[0-9a-f]+ /g, ''));

  it('escapes every url()/CSS/HTML-dangerous character', () => {
    const vectors = [
      'a.jpg); background:url(evil',                 // close-paren breakout
      'a.jpg"); } body{display:none} .x{url("',      // quote + brace breakout
      "'); color:red; url('",                        // single-quote breakout
      'a</style><script>alert(1)</script>',          // <style> breakout
      'a\\29 raw-backslash-escape',                  // backslash-escape smuggling
    ];
    for (const v of vectors) {
      const out = escapeCssUrl(v);
      assert.equal(hasRawBreakout(out), false, 'raw breakout char survived: ' + JSON.stringify(out));
    }
  });

  it('strips line terminators (they break CSS declarations)', () => {
    const out = escapeCssUrl('a.jpg\r\n\f); display:none');
    assert.equal(/[\r\n\f]/.test(out), false);
  });

  it('leaves a plain URL usable (no dangerous chars → unchanged)', () => {
    assert.equal(escapeCssUrl('https://example.com/a/b.jpg?x=1'), 'https://example.com/a/b.jpg?x=1');
    assert.equal(escapeCssUrl('/uploads/hero.webp'), '/uploads/hero.webp');
  });

  it('never throws on nullish input', () => {
    for (const v of [null, undefined, '']) assert.doesNotThrow(() => escapeCssUrl(v));
    assert.equal(escapeCssUrl(null), '');
  });
});
