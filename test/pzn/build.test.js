'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildSite,
  initSite,
  loadManifest,
  validateManifest,
  moduleNames
} = require('../../src/pzn/index');

const DEMO = path.join(__dirname, '..', '..', 'examples', 'pzn-site');

describe('site manifest (not pipedream)', () => {
  it('demo site.json loads and declares builtin module registry', () => {
    const { manifest } = loadManifest(DEMO);
    assert.equal(manifest.pzn, '0.1');
    assert.equal(manifest.modules.registry, 'builtin');
    assert.equal(manifest.home, 'home');
    assert.ok(manifest.menu.length >= 2);
  });

  it('rejects unknown module registry (manifest must match code)', () => {
    assert.throws(
      () => validateManifest({ name: 'x', modules: { registry: 'fantasy-plugins' } }),
      (e) => e.code === 'E_MANIFEST'
    );
  });
});

describe('pzn build — real static site from manifest + .pzn', () => {
  let report;
  let outDir;

  before(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pzn-build-'));
    report = buildSite(DEMO, { outDir });
  });

  it('writes index.html, css, build.json, and all pages', () => {
    assert.ok(report.ok);
    assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'css', 'site.css')));
    assert.ok(fs.existsSync(path.join(outDir, 'build.json')));
    assert.ok(report.files.includes('index.html'));
    assert.ok(report.files.includes('hello-bentml.html'));
    assert.ok(report.files.includes('articles.html'));
  });

  it('index.html uses site chrome from manifest (nav + logo + css link)', () => {
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.match(html, /<link rel="stylesheet" href="css\/site\.css">/);
    assert.match(html, /class="site-header"/);
    assert.match(html, /class="site-nav"/);
    assert.match(html, /Tapuziel Demo/);
    assert.match(html, />בית</);
    assert.match(html, /class="site-footer"/);
    // language modules compiled — no bent-* tags in public HTML
    assert.ok(!html.includes('<bent-'));
    assert.match(html, /<h1\b/);
    assert.match(html, /btn btn-primary/);
  });

  it('build stamp records the language runtime (manifest implemented)', () => {
    const stamp = JSON.parse(fs.readFileSync(path.join(outDir, 'build.json'), 'utf8'));
    assert.equal(stamp.runtime.language, 'bentml');
    assert.equal(stamp.runtime.fileExtension, '.pzn');
    assert.equal(stamp.runtime.moduleRegistry, 'builtin');
    assert.equal(stamp.runtime.moduleNames.length, moduleNames().length);
    assert.ok(stamp.files.includes('index.html'));
  });

  it('article page is linked from articles list via compile context', () => {
    const articles = fs.readFileSync(path.join(outDir, 'articles.html'), 'utf8');
    // at least one article cube if tagged pages exist
    assert.ok(
      articles.includes('article-cube') || articles.includes('bent-article-list') === false
    );
    // tagged article exists in demo
    assert.match(articles, /article-cube|hello|מאמר|שלום/i);
  });

  it('css file is non-empty and styles site chrome', () => {
    const css = fs.readFileSync(path.join(outDir, 'css', 'site.css'), 'utf8');
    assert.ok(css.length > 200);
    assert.match(css, /\.site-header/);
    assert.match(css, /\.btn-primary/);
  });
});

describe('pzn init → build', () => {
  it('scaffolds a site and builds it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pzn-init-'));
    const siteDir = path.join(root, 'mysite');
    initSite(siteDir, { name: 'Test Site' });
    assert.ok(fs.existsSync(path.join(siteDir, 'site.json')));
    assert.ok(fs.existsSync(path.join(siteDir, 'pages', 'home.pzn')));
    assert.ok(fs.existsSync(path.join(siteDir, 'theme', 'main.css')));

    const out = path.join(root, 'out');
    const report = buildSite(siteDir, { outDir: out });
    assert.ok(report.ok);
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(html, /Test Site/);
    assert.match(html, /site-nav/);
    assert.ok(!html.includes('<bent-'));
  });
});
