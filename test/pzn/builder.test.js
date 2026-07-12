'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ops,
  ast,
  validate,
  compile,
  getDocumentSchema,
  serialize
} = require('../../src/pzn/index');

describe('builder ops', () => {
  it('insert / updateProps / remove', () => {
    let doc = ast.createDocument({ title: 'T', slug: 't' });
    const heading = ops.createFromType('heading', { level: 1, text: 'Hello' });
    doc = ops.insert(doc, null, 0, heading);
    assert.equal(doc.body.length, 1);
    assert.equal(doc.body[0].text, 'Hello');

    doc = ops.updateProps(doc, heading.id, { text: 'שלום', level: 2 });
    assert.equal(doc.body[0].text, 'שלום');
    assert.equal(doc.body[0].props.level, 2);

    doc = ops.remove(doc, heading.id);
    assert.equal(doc.body.length, 0);
  });

  it('columns nest with move', () => {
    let doc = ast.createDocument();
    const cols = ops.createFromType('columns');
    const colA = ops.createFromType('col', { width: '1/2' });
    const colB = ops.createFromType('col', { width: '1/2' });
    const text = ops.createFromType('text', { text: 'in col' });

    doc = ops.insert(doc, null, 0, cols);
    doc = ops.insert(doc, cols.id, 0, colA);
    doc = ops.insert(doc, cols.id, 1, colB);
    doc = ops.insert(doc, null, 1, text);
    doc = ops.move(doc, text.id, colA.id, 0);

    assert.equal(doc.body.length, 1);
    assert.equal(doc.body[0].children[0].children[0].name, 'text');
    assert.equal(validate(doc).filter((i) => i.severity === 'error').length, 0);
  });

  it('duplicate assigns new ids', () => {
    let doc = ast.createDocument();
    const t = ops.createFromType('text', { text: 'x' });
    doc = ops.insert(doc, null, 0, t);
    doc = ops.duplicate(doc, t.id);
    assert.equal(doc.body.length, 2);
    assert.notEqual(doc.body[0].id, doc.body[1].id);
    assert.equal(doc.body[1].text, 'x');
  });

  it('replace migrates text', () => {
    let doc = ast.createDocument();
    const h = ops.createFromType('heading', { text: 'Keep me', level: 2 });
    doc = ops.insert(doc, null, 0, h);
    doc = ops.replace(doc, h.id, 'text');
    assert.equal(doc.body[0].name, 'text');
    assert.equal(doc.body[0].id, h.id);
    assert.equal(doc.body[0].text, 'Keep me');
  });

  it('updateDocument page props', () => {
    let doc = ast.createDocument();
    doc = ops.updateDocument(doc, {
      title: 'בית',
      slug: 'home',
      tags: ['nav'],
      meta: { teaser: 'hi' }
    });
    assert.equal(doc.title, 'בית');
    assert.equal(doc.slug, 'home');
    assert.deepEqual(doc.tags, ['nav']);
    assert.equal(doc.meta.teaser, 'hi');
  });

  it('built page compiles', () => {
    let doc = ast.createDocument({ title: 'Dream', slug: 'dream', lang: 'he', dir: 'rtl' });
    const hero = ops.createFromType('hero');
    doc = ops.insert(doc, null, 0, hero);
    doc = ops.insert(
      doc,
      hero.id,
      0,
      ops.createFromType('heading', { level: 1, text: 'My dream site' })
    );
    doc = ops.insert(
      doc,
      hero.id,
      1,
      ops.createFromType('button', { href: '/go', text: 'Go' })
    );
    const html = compile(doc);
    assert.match(html, /My dream site/);
    assert.match(html, /href="\/go"/);
    // still serializable as language source
    const src = serialize(doc);
    assert.match(src, /<bent-hero/);
    assert.match(src, /bent-version/);
  });

  it('document schema exists for empty selection panel', () => {
    const schema = getDocumentSchema();
    assert.equal(schema.type, 'document');
    assert.ok(schema.props.title);
    assert.ok(schema.props.dir);
  });
});
