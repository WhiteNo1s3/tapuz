'use strict';

/**
 * The .pzn standard, built live from the module registry so it can never drift
 * from what the validator accepts. Consumed by:
 *   - scripts/gen-pzn-spec.js  (writes docs/pzn-schema.json + docs/pzn-spec.md)
 *   - GET /pzn-schema.json      (public endpoint — the standard is fetchable)
 */

const registry = require('./modules/registry');

const SPEC_VERSION = '0.1';

function propSchema(p) {
  const out = { type: p.type };
  if (p.values) out.enum = p.values;
  if (p.min != null) out.min = p.min;
  if (p.max != null) out.max = p.max;
  if (p.default !== undefined) out.default = p.default;
  if (p.content) out.content = true;
  if (p.optional) out.optional = true;
  return out;
}

/**
 * @param {string} productVersion e.g. package.json version, for provenance
 * @returns {object} machine-readable catalog
 */
function buildCatalog(productVersion) {
  const catalog = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Tapuziel .pzn page language',
    description: 'Constrained-HTML page format (benTML dialect). Body may contain only registered bent-* module tags.',
    specVersion: SPEC_VERSION,
    generatedFrom: productVersion ? `tapuziel@${productVersion}` : 'tapuziel',
    modules: {}
  };
  for (const m of registry.listModules()) {
    const props = {};
    for (const [k, v] of Object.entries(m.props || {})) {
      if (k === 'id' || k === 'class') continue;
      props[k] = propSchema(v);
    }
    catalog.modules[m.name] = {
      tag: m.tag,
      label: m.label,
      category: m.category,
      container: !!m.container,
      accept: m.accept || [],
      props
    };
  }
  return catalog;
}

module.exports = { buildCatalog, SPEC_VERSION };
