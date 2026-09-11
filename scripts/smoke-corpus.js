'use strict';

/**
 * Industrial corpus pins — trimmed blog HTML, HIS decompiler only.
 * Leftover must stay 0; keyword BenTML must compile; expected modules land.
 */

const fs = require('fs');
const path = require('path');
const { decompileHtml } = require('../src/pzn/decompile');
const bentml = require('../src/bentml');

const DIR = path.join(__dirname, '..', 'test', 'fixtures', 'corpus');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function typesOf(r) {
  const t = {};
  for (const b of r.blocks || []) t[b.type] = (t[b.type] || 0) + 1;
  return t;
}

function score(file, expectTypes) {
  const html = fs.readFileSync(path.join(DIR, file), 'utf8');
  const r = decompileHtml(html);
  const types = typesOf(r);
  let compileOk = false;
  let err = '';
  try {
    bentml.compile(r.bentml || '');
    compileOk = true;
  } catch (e) {
    err = (e.code || '') + ' ' + (e.message || '').slice(0, 80);
  }
  check(file + ' leftover 0', r.leftover === 0);
  check(file + ' keyword compiles', compileOk);
  if (!compileOk) console.log('   compile:', err);
  for (const [type, n] of Object.entries(expectTypes)) {
    check(file + ' has ' + type + ' ≥' + n, (types[type] || 0) >= n);
  }
  return { leftover: r.leftover, types, compileOk, toolGap: r.toolGap };
}

const tech = score('tech-pre.html', { code: 2, author: 1, tags: 1, related: 1 });
const post = score('wp-post.html', { author: 1, tags: 1, related: 1, comments: 1 });
const listing = score('listing-pager.html', { search: 1, pager: 1, related: 1, newsletter: 1 });

check('corpus dir has only trimmed fixtures',
  fs.readdirSync(DIR).every((n) => fs.statSync(path.join(DIR, n)).size < 8000));

console.log('');
console.log(JSON.stringify({ tech: tech.types, post: post.types, listing: listing.types }));
console.log(fail ? 'SMOKE CORPUS: FAIL' : 'SMOKE CORPUS: PASS');
process.exit(fail ? 1 : 0);
