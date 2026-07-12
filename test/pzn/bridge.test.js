'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fromTapuzPage, compile, serialize, parse, ast } = require('../../src/pzn/index');

describe('Tapuz JSON bridge', () => {
  it('maps blocks to modules and compiles', () => {
    const doc = fromTapuzPage({
      title: 'Imported',
      slug: 'imported',
      direction: 'rtl',
      lang: 'he',
      tags: ['article'],
      meta: { teaser: 'from tapuz' },
      blocks: [
        { type: 'heading', id: 'h1', data: { level: 1, text: 'שלום' } },
        { type: 'text', id: 't1', data: { content: 'תוכן' } },
        {
          type: 'button',
          id: 'b1',
          data: { text: 'Go', url: '/x', variant: 'primary' }
        },
        {
          type: 'columns',
          id: 'c1',
          data: {
            gap: 'medium',
            columns: [
              {
                width: '1/2',
                blocks: [{ type: 'text', id: 't2', data: { content: 'A' } }]
              },
              {
                width: '1/2',
                blocks: [{ type: 'image', id: 'i1', data: { src: '/a.jpg', alt: 'a' } }]
              }
            ]
          }
        },
        {
          type: 'hero',
          id: 'hero1',
          data: { title: 'Hero', subtitle: 'Sub', buttonText: 'CTA', buttonUrl: '#' }
        }
      ]
    });

    assert.equal(doc.slug, 'imported');
    assert.deepEqual(doc.tags, ['article']);
    assert.equal(doc.body[0].name, 'heading');
    assert.equal(doc.body[0].text, 'שלום');
    assert.equal(doc.body[1].text, 'תוכן');
    assert.equal(doc.body[2].props.href, '/x');
    assert.equal(doc.body[3].name, 'columns');
    assert.equal(doc.body[3].children[0].name, 'col');
    assert.equal(doc.body[4].name, 'hero');

    const html = compile(doc);
    assert.match(html, /שלום/);
    assert.match(html, /class="hero/);
    assert.ok(!html.includes('<bent-'));

    // bridge output is real language source
    const src = serialize(doc);
    const again = parse(src);
    assert.ok(ast.equal(doc, again));
  });
});
