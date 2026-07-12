'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parse, BentError } = require('../../src/pzn/index');

const examplesDir = path.join(__dirname, '..', '..', 'examples', 'pzn');

describe('parse', () => {
  it('parses home.pzn document shell', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'home.pzn'), 'utf8');
    const doc = parse(src);
    assert.equal(doc.type, 'document');
    assert.equal(doc.lang, 'he');
    assert.equal(doc.dir, 'rtl');
    assert.equal(doc.version, '0.1');
    assert.equal(doc.slug, 'home');
    assert.ok(doc.title.includes('benTML') || doc.title.includes('בית'));
    assert.ok(doc.body.length >= 3);
    assert.equal(doc.body[0].name, 'hero');
  });

  it('parses article meta tags', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'article.pzn'), 'utf8');
    const doc = parse(src);
    assert.equal(doc.slug, 'hello-bentml');
    assert.deepEqual(doc.tags, ['article']);
    assert.ok(doc.meta.teaser.length > 0);
    assert.ok(doc.meta.cardImage.includes('article-card'));
  });

  it('parses nested columns', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'home.pzn'), 'utf8');
    const doc = parse(src);
    const cols = doc.body.find((b) => b.name === 'columns');
    assert.ok(cols);
    assert.equal(cols.children.length, 2);
    assert.equal(cols.children[0].name, 'col');
    assert.equal(cols.children[0].props.width, '1/2');
    assert.ok(cols.children[0].children.some((c) => c.name === 'list'));
  });

  it('parses text content and button href', () => {
    const src = `
<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
<head><meta charset="utf-8" /><title>t</title></head>
<body>
  <bent-button id="b" href="/x" variant="secondary">Go</bent-button>
</body>
</html>`;
    const doc = parse(src);
    assert.equal(doc.body[0].name, 'button');
    assert.equal(doc.body[0].props.href, '/x');
    assert.equal(doc.body[0].props.variant, 'secondary');
    assert.equal(doc.body[0].text, 'Go');
  });

  it('rejects raw HTML in body', () => {
    const src = `
<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
<head><title>t</title></head>
<body><div>nope</div></body>
</html>`;
    assert.throws(() => parse(src), (err) => err instanceof BentError && err.code === 'E_RAW_HTML');
  });

  it('rejects raw text in body', () => {
    const src = `
<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
<head><title>t</title></head>
<body>loose text</body>
</html>`;
    assert.throws(() => parse(src), (err) => err instanceof BentError && err.code === 'E_RAW_TEXT');
  });

  it('unescapes entities in text', () => {
    const src = `
<!DOCTYPE html>
<html lang="en" dir="ltr" bent-version="0.1">
<head><title>t</title></head>
<body><bent-text id="t">A &amp; B &lt; C</bent-text></body>
</html>`;
    const doc = parse(src);
    assert.equal(doc.body[0].text, 'A & B < C');
  });
});
