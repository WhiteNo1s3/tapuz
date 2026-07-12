'use strict';

/**
 * Generate the public .pzn standard from the live registry, so the spec can
 * never drift from what the validator accepts:
 *   docs/pzn-schema.json  — machine-readable module catalog (JSON Schema-ish)
 *   docs/pzn-spec.md       — human standard (prose rules + generated module ref)
 *
 * This is the "publish your RPM" move: anyone can implement a .pzn reader/writer
 * from these two files. Run: node scripts/gen-pzn-spec.js
 */

const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const registry = require('../src/pzn/modules/registry');
const { buildCatalog, SPEC_VERSION } = require('../src/pzn/spec');

const DOCS = path.join(__dirname, '..', 'docs');
const modules = registry.listModules();

// ── machine-readable catalog (single source: src/pzn/spec.js) ────────
const catalog = buildCatalog(pkg.version);
fs.writeFileSync(path.join(DOCS, 'pzn-schema.json'), JSON.stringify(catalog, null, 2) + '\n');

// ── human standard ───────────────────────────────────────────────────
function propLine(name, p) {
  const bits = [`\`${name}\``, p.type];
  if (p.values) bits.push(p.values.join(' \\| '));
  if (p.min != null || p.max != null) bits.push(`${p.min ?? ''}–${p.max ?? ''}`);
  if (p.default !== undefined && p.default !== '') bits.push(`default \`${p.default}\``);
  if (p.content) bits.push('**(body text, not an attribute)**');
  return '  - ' + bits.join(' · ');
}

const byCat = {};
for (const m of modules) (byCat[m.category] = byCat[m.category] || []).push(m);

const L = [];
L.push('# The `.pzn` page format — standard');
L.push('');
L.push(`**Spec version ${SPEC_VERSION}** · generated from \`tapuziel@${pkg.version}\` · regenerate with \`node scripts/gen-pzn-spec.js\``);
L.push('');
L.push('`.pzn` is an open, constrained-HTML page format. A `.pzn` file **is** HTML —');
L.push('but the body may contain **only registered `bent-*` module tags**, never raw');
L.push('HTML. That single rule is what makes the format safe for AI agents to write');
L.push('and safe for tools to render: the vocabulary is fixed, typed, and validated.');
L.push('');
L.push('Machine-readable catalog: [`pzn-schema.json`](pzn-schema.json) — the same');
L.push('module/prop data this document is generated from. Implement a reader/writer');
L.push('from it directly.');
L.push('');
L.push('## Document shape');
L.push('');
L.push('```html');
L.push('<!DOCTYPE html>');
L.push('<html lang="he" dir="rtl" bent-version="0.1">');
L.push('  <head>');
L.push('    <meta charset="utf-8" />');
L.push('    <title>Page title</title>');
L.push('    <meta name="bent-slug" content="page-slug" />');
L.push('    <!-- optional: bent-tags, bent-teaser, bent-card-image -->');
L.push('  </head>');
L.push('  <body>');
L.push('    <!-- only bent-* module tags here -->');
L.push('  </body>');
L.push('</html>');
L.push('```');
L.push('');
L.push('## Rules (normative)');
L.push('');
L.push('1. The document is well-formed HTML with `<html>`, `<head>`, `<body>`.');
L.push('2. `<html>` SHOULD carry `lang`, `dir` (`rtl`|`ltr`), and `bent-version`.');
L.push('3. The `<body>` MUST contain only registered `bent-*` tags. Raw HTML in the');
L.push('   body is a validation error (`E_RAW_HTML`); raw text is `E_RAW_TEXT`.');
L.push('4. An unknown `bent-*` tag is `E_UNKNOWN_MODULE`.');
L.push('5. Every module SHOULD have a unique `id`; duplicate ids are `E_DUP_ID`.');
L.push('6. Container modules may contain only their declared `accept` children');
L.push('   (`E_CHILD` otherwise); non-containers may not contain modules.');
L.push('7. Prop values are typed (integer ranges, enums, booleans) and validated.');
L.push('8. Page identity is the `bent-slug`; head meta carry title/tags/teaser/card.');
L.push('9. **Escaping (security):** text and attributes are HTML-escaped on render.');
L.push('   URL props on clickable links (`href`, `url`) MUST reject the');
L.push('   `javascript:`, `data:`, and `vbscript:` schemes. Background-image URLs are');
L.push('   escaped for the CSS `url()` context, not just HTML. `class="…"` is the');
L.push('   only styling escape hatch; there is no raw-style injection.');
L.push('10. Compilation is deterministic: a `.pzn` document maps to one HTML output.');
L.push('');
L.push(`## Modules (${modules.length})`);
L.push('');
for (const [cat, list] of Object.entries(byCat)) {
  L.push(`### Category: ${cat}`);
  L.push('');
  for (const m of list) {
    const kind = m.container ? `container${m.accept && m.accept.length ? ` (children: ${m.accept.map((a) => '`bent-' + a + '`').join(', ')})` : ''}` : 'leaf';
    L.push(`#### \`<${m.tag}>\` — ${m.label.he} / ${m.label.en} · ${kind}`);
    const props = Object.entries(m.props || {}).filter(([k]) => k !== 'id' && k !== 'class');
    if (props.length) {
      L.push('');
      for (const [k, v] of props) L.push(propLine(k, v));
    }
    L.push('');
  }
}
L.push('## Versioning');
L.push('');
L.push('The spec version (`bent-version`) is independent of the Tapuziel product');
L.push('version. New modules and props are MINOR, additive changes; a removed or');
L.push('re-typed prop is a MAJOR change. Readers SHOULD ignore unknown head meta and');
L.push('MUST error on unknown body modules (fail closed).');
L.push('');
fs.writeFileSync(path.join(DOCS, 'pzn-spec.md'), L.join('\n'));

console.log(`wrote docs/pzn-schema.json (${modules.length} modules)`);
console.log(`wrote docs/pzn-spec.md (${L.length} lines)`);
