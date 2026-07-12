'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  listModules,
  getModule,
  moduleNames,
  getToolbox,
  getSchema,
  getAllSchemas,
  ops,
  compileFragment,
  ast
} = require('../../src/pzn/index');

describe('module registry', () => {
  it('registers a full vocabulary', () => {
    const names = moduleNames();
    for (const required of [
      'heading', 'text', 'image', 'button', 'list', 'item', 'quote',
      'spacer', 'divider', 'embed', 'section', 'columns', 'col', 'hero',
      'gallery', 'article-list'
    ]) {
      assert.ok(names.includes(required), `missing module ${required}`);
    }
  });

  it('every module has tag, compile, props, label', () => {
    for (const def of listModules()) {
      assert.equal(def.tag, `bent-${def.name}`);
      assert.equal(typeof def.compile, 'function');
      assert.ok(def.label?.he && def.label?.en);
      assert.ok(def.props && typeof def.props === 'object');
      assert.ok(def.icon);
    }
  });

  it('defaults from createFromType compile without error', () => {
    for (const def of listModules()) {
      if (def.name === 'col') continue; // needs parent; still compiles alone
      const node = ops.createFromType(def.name);
      if (def.name === 'columns') {
        node.children = [
          ops.createFromType('col', { width: '1/2' }),
          ops.createFromType('col', { width: '1/2' })
        ];
      }
      if (def.name === 'list') {
        node.children = [ops.createFromType('item')];
      }
      if (def.name === 'gallery') {
        node.children = [ops.createFromType('image', { src: '/x.jpg' })];
      }
      const html = compileFragment([node], { dir: 'rtl' });
      assert.equal(typeof html, 'string');
      assert.ok(html.length > 0, def.name);
      assert.ok(!html.includes('<bent-'), `${def.name} leaked custom element`);
    }
  });
});

describe('builder schemas', () => {
  it('toolbox covers every module', () => {
    const box = getToolbox();
    const types = box.categories.flatMap((c) => c.items.map((i) => i.type));
    for (const name of moduleNames()) {
      assert.ok(types.includes(name), `toolbox missing ${name}`);
    }
  });

  it('getSchema matches registry', () => {
    for (const name of moduleNames()) {
      const schema = getSchema(name);
      assert.equal(schema.type, name);
      assert.equal(schema.tag, `bent-${name}`);
      assert.ok(schema.props);
    }
    assert.equal(getSchema('nope'), null);
  });

  it('getAllSchemas size matches registry', () => {
    assert.equal(Object.keys(getAllSchemas()).length, moduleNames().length);
  });
});

describe('heading implements h1-h6', () => {
  it('compiles level to correct heading tag', () => {
    const node = ast.createModule('heading', { props: { level: 3 }, text: 'שלום', id: 'x' });
    const html = compileFragment([node]);
    assert.match(html, /<h3\b/);
    assert.match(html, /שלום/);
    assert.ok(!html.includes('<bent-heading'));
  });
});
