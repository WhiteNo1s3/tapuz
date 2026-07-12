'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parse, validate, isValid, ast, compile, BentError } = require('../../src/pzn/index');

describe('validate', () => {
  it('examples are valid (no errors)', () => {
    const dir = path.join(__dirname, '..', '..', 'examples', 'pzn');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.pzn'))) {
      const doc = parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const issues = validate(doc);
      const errors = issues.filter((i) => i.severity === 'error');
      assert.equal(errors.length, 0, `${file}: ${JSON.stringify(errors)}`);
      assert.equal(isValid(doc), true);
    }
  });

  it('unknown module is an error', () => {
    const doc = ast.createDocument({
      body: [ast.createModule('nope', { id: 'x' })]
    });
    const issues = validate(doc);
    assert.ok(issues.some((i) => i.code === 'E_UNKNOWN_MODULE'));
  });

  it('heading level out of range', () => {
    const doc = ast.createDocument({
      body: [ast.createModule('heading', { id: 'h', props: { level: 9 }, text: 'x' })]
    });
    const issues = validate(doc);
    assert.ok(issues.some((i) => i.code === 'E_PROP_RANGE'));
  });

  it('columns only accept col children', () => {
    const doc = ast.createDocument({
      body: [
        ast.createModule('columns', {
          id: 'c',
          children: [ast.createModule('heading', { id: 'h', props: { level: 2 }, text: 'no' })]
        })
      ]
    });
    const issues = validate(doc);
    assert.ok(issues.some((i) => i.code === 'E_CHILD'));
  });

  it('duplicate ids error', () => {
    const doc = ast.createDocument({
      body: [
        ast.createModule('text', { id: 'same', text: 'a' }),
        ast.createModule('text', { id: 'same', text: 'b' })
      ]
    });
    const issues = validate(doc);
    assert.ok(issues.some((i) => i.code === 'E_DUP_ID'));
  });

  it('compile throws on invalid tree', () => {
    const doc = ast.createDocument({
      body: [ast.createModule('nope', { id: 'x' })]
    });
    assert.throws(() => compile(doc), (e) => e instanceof BentError);
  });
});
