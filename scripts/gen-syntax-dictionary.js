'use strict';

/** Write docs/SYNTAX-DICTIONARY.md from block-registry. */
const fs = require('fs');
const path = require('path');
const { toMarkdown, buildDictionary } = require('../src/syntax-dictionary');

const out = path.join(__dirname, '..', 'docs', 'SYNTAX-DICTIONARY.md');
const md = toMarkdown(buildDictionary());
fs.writeFileSync(out, md, 'utf8');
console.log('Wrote', out, '(' + buildDictionary().count + ' modules)');
