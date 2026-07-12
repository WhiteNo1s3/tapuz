'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parse, serialize, ast } = require('../../src/pzn/index');

const examplesDir = path.join(__dirname, '..', '..', 'examples', 'pzn');

describe('round-trip parse → serialize → parse', () => {
  for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.pzn'))) {
    it(file, () => {
      const src = fs.readFileSync(path.join(examplesDir, file), 'utf8');
      const doc1 = parse(src);
      const out = serialize(doc1);
      const doc2 = parse(out);
      assert.ok(ast.equal(doc1, doc2), `structural mismatch for ${file}`);
    });
  }

  it('preserves multi-paragraph text', () => {
    const src = `
<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
<head><title>t</title><meta name="bent-slug" content="p" /></head>
<body>
  <bent-text id="t">שורה אחת

שורה שתיים</bent-text>
</body>
</html>`;
    const doc1 = parse(src);
    const doc2 = parse(serialize(doc1));
    assert.ok(doc1.body[0].text.includes('שורה אחת'));
    assert.ok(doc1.body[0].text.includes('שורה שתיים'));
    assert.ok(ast.equal(doc1, doc2));
  });

  it('double round-trip is stable', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'home.pzn'), 'utf8');
    const a = parse(src);
    const b = parse(serialize(a));
    const c = parse(serialize(b));
    assert.ok(ast.equal(b, c));
  });
});
