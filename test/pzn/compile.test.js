'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parse, compile, build } = require('../../src/pzn/index');

const examplesDir = path.join(__dirname, '..', '..', 'examples', 'pzn');

describe('compile', () => {
  it('home.pzn → pure HTML5 without bent-* tags', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'home.pzn'), 'utf8');
    const html = build(src);
    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /lang="he"/);
    assert.match(html, /dir="rtl"/);
    assert.match(html, /<main id="main">/);
    assert.match(html, /class="hero/);
    assert.match(html, /<h1\b/);
    assert.match(html, /btn btn-primary/);
    assert.match(html, /class="columns/);
    assert.ok(!html.includes('<bent-'));
    assert.ok(!html.includes('bent-version'));
  });

  it('youtube embed becomes iframe', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'article.pzn'), 'utf8');
    const html = build(src);
    assert.match(html, /youtube\.com\/embed\/dQw4w9WgXcQ/);
    assert.match(html, /<iframe\b/);
  });

  it('article-list uses context articles', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'articles-index.pzn'), 'utf8');
    const doc = parse(src);
    const html = compile(doc, {
      articles: [
        {
          title: 'One',
          url: '/one.html',
          teaser: 'Teaser',
          image: '/a.jpg',
          tags: ['article']
        },
        {
          title: 'Two',
          url: '/two.html',
          tags: ['article']
        }
      ]
    });
    assert.match(html, /article-cube/);
    assert.match(html, /One/);
    assert.match(html, /Two/);
    assert.match(html, /cols-3/);
  });

  it('article-list empty context emits comment', () => {
    const src = fs.readFileSync(path.join(examplesDir, 'articles-index.pzn'), 'utf8');
    const html = build(src);
    assert.match(html, /<!-- bent-article-list/);
  });

  it('escapes HTML in text (XSS safety)', () => {
    const src = `
<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
<head><title>x</title></head>
<body><bent-text id="t">&lt;script&gt;alert(1)&lt;/script&gt;</bent-text></body>
</html>`;
    const html = build(src);
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });

  it('class escape hatch passes through', () => {
    const src = `
<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
<head><title>x</title></head>
<body><bent-heading id="h" level="2" class="my-special">T</bent-heading></body>
</html>`;
    const html = build(src);
    assert.match(html, /my-special/);
  });
});
