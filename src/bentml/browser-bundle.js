'use strict';

const fs = require('fs');
const path = require('path');

/**
 * BenTML engine for the browser.
 *
 * The compiler chain is dependency-free plain JS (blocks/errors/keywords/
 * parse/compile/decompile), so the admin can run the real language locally —
 * instant decompile on every drag, compile-as-you-type — with zero server
 * roundtrips. Bundled on demand with a two-line CommonJS shim; rebuilt when
 * any source file changes (dev-friendly, no build step).
 */

const MODULES = [
  ['blocks', path.join(__dirname, '..', 'blocks.js')],
  ['errors', path.join(__dirname, 'errors.js')],
  ['keywords', path.join(__dirname, 'keywords.js')],
  ['parse', path.join(__dirname, 'parse.js')],
  ['compile', path.join(__dirname, 'compile.js')],
  ['decompile', path.join(__dirname, 'decompile.js')],
  // v2.20: the extractor rides along so the builder's panel takes only the
  // BenTML out of a pasted reply BEFORE choosing an engine (no roundtrip)
  ['extract', path.join(__dirname, 'extract.js')]
];

let cache = null; // { js, stamp }

function buildBentmlEngine() {
  const stamp = MODULES.map(([, file]) => String(fs.statSync(file).mtimeMs)).join('|');
  if (cache && cache.stamp === stamp) return cache.js;

  const parts = [];
  parts.push('/* BenTML engine — generated from src/bentml + src/blocks.js (do not edit) */');
  parts.push('(function () {');
  parts.push("'use strict';");
  parts.push('var __mods = {};');
  parts.push('function __require(name) {');
  parts.push("  var key = name.replace(/^\\.\\.?\\//, '').replace(/\\.js$/, '');");
  parts.push("  if (!(key in __mods)) throw new Error('BentmlEngine: unknown module ' + name);");
  parts.push('  return __mods[key];');
  parts.push('}');
  for (const [name, file] of MODULES) {
    parts.push(`__mods[${JSON.stringify(name)}] = (function () {`);
    parts.push('var module = { exports: {} }; var exports = module.exports;');
    parts.push('var require = __require;');
    parts.push(fs.readFileSync(file, 'utf8'));
    parts.push('return module.exports;');
    parts.push('})();');
  }
  parts.push('window.BentmlEngine = {');
  parts.push('  parse: __mods.parse.parse,');
  parts.push('  deriveSlug: __mods.parse.deriveSlug,');
  parts.push('  compile: __mods.compile.compile,');
  parts.push('  decompile: __mods.decompile.decompile,');
  parts.push('  BentmlError: __mods.errors.BentmlError,');
  parts.push('  KEYWORDS: __mods.keywords.KEYWORDS,');
  parts.push('  getKeyword: __mods.keywords.getKeyword,');
  parts.push('  extract: __mods.extract.extractBentml,');
  parts.push('  sniffDialect: __mods.extract.sniffDialect');
  parts.push('};');
  parts.push('})();');

  cache = { js: parts.join('\n'), stamp };
  return cache.js;
}

module.exports = { buildBentmlEngine, MODULES };
