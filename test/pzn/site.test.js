'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { publicFileName, compilePage, publishSite } = require('../../src/pzn/index');

describe('site publish (index.html entry)', () => {
  it('maps home slug to index.html', () => {
    assert.equal(publicFileName('home'), 'index.html');
    assert.equal(publicFileName(''), 'index.html');
    assert.equal(publicFileName('index'), 'index.html');
    assert.equal(publicFileName('about'), 'about.html');
    assert.equal(publicFileName('Hello World'), 'hello-world.html');
  });

  it('compilePage on home.pzn targets index.html', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'examples', 'pzn', 'home.pzn'), 'utf8');
    const { file, html, slug } = compilePage(src);
    assert.equal(file, 'index.html');
    assert.equal(slug, 'home');
    assert.match(html, /<!DOCTYPE html>/i);
    assert.ok(!html.includes('<bent-'));
  });

  it('publishSite writes index.html from examples', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pzn-pub-'));
    const result = publishSite(path.join(__dirname, '..', '..', 'examples', 'pzn'), tmp);
    assert.ok(result.files.includes('index.html'));
    assert.ok(fs.existsSync(path.join(tmp, 'index.html')));
    assert.ok(result.files.includes('hello-bentml.html') || result.files.includes('articles.html'));
    const index = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
    assert.match(index, /dir="rtl"/);
  });
});
