'use strict';

/**
 * v0.89 QA — the layers/outline panel (the Builder.io tree view).
 * admin-builder.js is a DOM-bound IIFE, so the walker + wiring are asserted
 * on source (the v0.76 builder-QA pattern); behavior is verified live.
 */

const fs = require('fs');
const path = require('path');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

const builder = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-builder.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'admin.css'), 'utf8');

// ── the walker is registry-driven, both container shapes, virtual columns ──
check('flattenLayers exists and follows childrenKeyFor (registry-driven)',
  /function flattenLayers/.test(builder) && /childrenKeyFor\(b\.type\)/.test(builder));
check('flat containers recurse data.blocks at depth+1',
  /ck === 'blocks'[\s\S]{0,120}flattenLayers\(b\.data\.blocks, depth \+ 1/.test(builder));
check('columns emit a virtual row per column and recurse depth+2',
  /virtual: true, colIndex: ci/.test(builder) && /flattenLayers\(\(col && col\.blocks\) \|\| \[\], depth \+ 2/.test(builder));

// ── render + selection stay honest ──
check('renderCanvas repaints the outline on BOTH exits',
  (builder.match(/renderLayers\(\);/g) || []).length >= 3);
check('selectBlock keeps the outline highlight when the canvas is skipped',
  /else renderLayers\(\); \/\/ canvas skipped/.test(builder));
check('row click selects the block and scrolls the canvas to it',
  /selectBlock\(r\.id\)/.test(builder) && /scrollIntoView\(\{ behavior: 'smooth'/.test(builder));
check('row labels come from the module catalog, text via textContent (no markup injection)',
  /MODULE_META\[r\.type\]/.test(builder) && /label\.textContent/.test(builder) && /hint\.textContent/.test(builder));
check('empty page shows guidance', /הדף ריק — גררו מודול מהארגז/.test(builder));
check('fold state persists per browser (closed by default)',
  /tapuz-layers-open/.test(builder) && /layersFold\.open = localStorage/.test(builder));
check('flatten exposed for QA/debug', /_layersFlatten: flattenLayers/.test(builder));

// ── the panel exists in the builder screen, styled by the design system ──
check('toolbox carries the layers fold (tree + count)',
  /id="layers-fold"/.test(server) && /id="layers-tree"/.test(server) && /id="layers-count"/.test(server));
check('layers styles ride the dark-desk system',
  /\.layers-fold \{/.test(css) && /\.layer-row\.active/.test(css) && /--bc-border/.test(css));

// ── file still parses ──
try { new Function(builder); check('admin-builder.js parses', true); }
catch (e) { check('admin-builder.js parses (' + e.message + ')', false); }

console.log('');
console.log(fail ? 'SMOKE LAYERS: FAIL' : 'SMOKE LAYERS: PASS');
process.exit(fail ? 1 : 0);
