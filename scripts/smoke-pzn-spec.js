'use strict';

/**
 * v1.36 QA — the .pzn STANDARD guardrail ("pzn file, our RPM file, we set
 * standard"). The public standard is generated from the live module
 * registry (src/pzn/spec.js → docs/pzn-schema.json + docs/pzn-spec.md, and
 * the GET /pzn-schema.json endpoint). Nothing previously stopped it from
 * silently drifting: this session it was found STALE — the committed schema
 * was stamped tapuziel@0.66 and missing 7 modules the registry had gained.
 * This test fails the build if the published standard ever falls out of sync
 * with the registry again, so "our RPM" can't quietly lie to implementers.
 *
 * No throwaway TAPUZ_ROOT needed — this is pure code/data, no DB.
 */

const fs = require('fs');
const path = require('path');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const registry = require('../src/pzn/modules/registry');
const { buildCatalog, SPEC_VERSION } = require('../src/pzn/spec');

// Compare CONTENT, not line endings. The generators emit LF, but git checks the
// committed files out with CRLF on a Windows clone (core.autocrlf), so a byte
// comparison reported "drift" for a file that was character-for-character
// correct — green on Linux CI, red for anyone developing on Windows. Normalize
// before comparing so these guards report real drift only.
const eol = (s) => s.replace(/\r\n/g, '\n');

const fresh = buildCatalog('smoke');
const registryModules = registry.listModules();

// ── the catalog is structurally a valid, self-describing standard ──
check('catalog carries the JSON-Schema envelope + spec version', /json-schema\.org/.test(fresh.$schema) && fresh.specVersion === SPEC_VERSION && !!fresh.title && !!fresh.description);
check('catalog stamps its provenance (generatedFrom)', /^tapuziel/.test(fresh.generatedFrom));

// ── COMPLETENESS: every registered module is in the standard, fully typed ──
check('every registered module appears in the catalog (no vocabulary gap)',
  registryModules.every((m) => !!fresh.modules[m.name]) &&
  Object.keys(fresh.modules).length === registryModules.length);
check('every catalog module carries tag + label + category + props',
  Object.values(fresh.modules).every((m) => m.tag && m.label && m.category && m.props && typeof m.props === 'object'));
check('container modules declare their accepted children (accept[])',
  Object.values(fresh.modules).filter((m) => m.container).every((m) => Array.isArray(m.accept)));
check('no module leaks the universal id/class props into the standard',
  Object.values(fresh.modules).every((m) => !('id' in m.props) && !('class' in m.props)));

// ── the DRIFT GUARD: the committed public docs match the live registry ──
const schemaPath = path.join(__dirname, '..', 'docs', 'pzn-schema.json');
check('docs/pzn-schema.json exists (the published machine-readable standard)', fs.existsSync(schemaPath));
let committed = null;
try { committed = JSON.parse(fs.readFileSync(schemaPath, 'utf8')); } catch (e) { /* leave null */ }
check('the committed pzn-schema.json is valid JSON', committed && typeof committed === 'object');
// Compare the SUBSTANTIVE standard (the modules), ignoring the version-stamped
// `generatedFrom` provenance line (which legitimately changes every release).
check('the published pzn-schema.json is IN SYNC with the registry (regenerate with `npm run gen:spec` if this fails)',
  committed && JSON.stringify(committed.modules) === JSON.stringify(fresh.modules));

// ── the human standard doc lists the same module count ──
const specMdPath = path.join(__dirname, '..', 'docs', 'pzn-spec.md');
check('docs/pzn-spec.md exists (the human standard)', fs.existsSync(specMdPath));
const specMd = fs.existsSync(specMdPath) ? fs.readFileSync(specMdPath, 'utf8') : '';
check('pzn-spec.md advertises the correct module count',
  new RegExp('## Modules \\(' + registryModules.length + '\\)').test(specMd));

// ── the OTHER generated standard artifact: docs/SYNTAX-DICTIONARY.md, the
//    human syntax reference built from block-registry via `npm run
//    gen:dictionary`. Same drift class — it was ALSO found ~9% stale this
//    session (13,983 chars committed vs 15,382 fresh) and regenerated. Guard
//    it the same way so the block-registry vocabulary can't silently
//    out-run its published dictionary either.
const dictMdPath = path.join(__dirname, '..', 'docs', 'SYNTAX-DICTIONARY.md');
check('docs/SYNTAX-DICTIONARY.md exists (the published syntax dictionary)', fs.existsSync(dictMdPath));
let freshDict = null;
try {
  const { toMarkdown, buildDictionary } = require('../src/syntax-dictionary');
  freshDict = toMarkdown(buildDictionary());
} catch (e) { /* leave null → the check below fails loudly */ }
const committedDict = fs.existsSync(dictMdPath) ? fs.readFileSync(dictMdPath, 'utf8') : '';
check('docs/SYNTAX-DICTIONARY.md is IN SYNC with block-registry (regenerate with `npm run gen:dictionary` if this fails)',
  freshDict != null && eol(committedDict) === eol(freshDict));

console.log('');
console.log(fail ? 'SMOKE PZN-SPEC: FAIL' : 'SMOKE PZN-SPEC: PASS');
process.exit(fail ? 1 : 0);
