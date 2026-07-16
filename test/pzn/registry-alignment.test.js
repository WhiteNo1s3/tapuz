'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const keywords = require('../../src/bentml/keywords.js');
const { BLOCK_REGISTRY } = require('../../src/block-registry.js');
const { moduleNames } = require('../../src/pzn/index.js');

/**
 * Drift guard for the module vocabulary.
 *
 * A block type is described in three places that MUST agree, or "add a module"
 * silently breaks:
 *   1. src/bentml/keywords.js  — the BenTML language (what an agent may write)
 *   2. src/block-registry.js   — the admin visual builder (toolbox + settings UI)
 *   3. src/pzn/index.js        — the bent-* -> HTML compilers (what renders)
 *
 * Nothing else fails when these drift: add a keyword but forget the registry
 * entry and the builder just never offers the block; add a registry block with
 * no keyword and agents can't produce it. This test fails loudly the moment the
 * three sets diverge, and names the offending type.
 */

const KEYWORDS = keywords.KEYWORDS || keywords;

// Every top-level BenTML keyword carries a jsonType (child-only keywords and
// META do not); that set is the language's block vocabulary.
const keywordTypes = new Set(
  Object.values(KEYWORDS)
    .map((def) => def && def.jsonType)
    .filter(Boolean)
);

const registryTypes = new Set(BLOCK_REGISTRY.map((b) => b.type));
const moduleSet = new Set(moduleNames());

const missingFrom = (from, inSet) => [...from].filter((t) => !inSet.has(t));

describe('module vocabulary alignment', () => {
  it('every BenTML keyword maps to a block-registry entry (builder UI exists)', () => {
    const missing = missingFrom(keywordTypes, registryTypes);
    assert.equal(missing.length, 0, `BenTML keywords with no block-registry entry: ${missing.join(', ')}`);
  });

  it('every block-registry type maps to a BenTML keyword (agents can produce it)', () => {
    const missing = missingFrom(registryTypes, keywordTypes);
    assert.equal(missing.length, 0, `registry blocks with no BenTML keyword: ${missing.join(', ')}`);
  });

  it('every BenTML keyword has a compiling pzn module (it renders)', () => {
    const missing = missingFrom(keywordTypes, moduleSet);
    assert.equal(missing.length, 0, `keyword types with no pzn module/renderer: ${missing.join(', ')}`);
  });
});
