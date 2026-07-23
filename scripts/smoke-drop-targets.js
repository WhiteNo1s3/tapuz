'use strict';

/**
 * v1.53 QA — the canvas accepts a drop where you aim it.
 *
 * The regression this guards: only the hairline slots between blocks, the 22px
 * split strips and an empty container's placeholder ever called preventDefault
 * on dragover. A block's BODY and a non-empty container's padding did not — and
 * a dragover without preventDefault means the browser refuses the drop outright.
 * So releasing a container over an existing module did nothing at all, and a
 * container stopped accepting children the moment it held one.
 *
 * Two independent causes, both asserted here:
 *   1. no drop handling on the block body at all                 → bindBlockBody
 *   2. bindListSurface bailed on `closest('.canvas-block')`, which for a NESTED
 *      list always matched the container's own block element      → claimedWithin
 */

const fs = require('fs');
const path = require('path');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

const root = path.join(__dirname, '..');
const builderSrc = fs.readFileSync(path.join(root, 'public', 'admin-builder.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin.css'), 'utf8');

/**
 * Comments are stripped before every assertion below: a wiring call that has
 * been commented OUT is exactly the regression being guarded against, and it
 * still matches the source text otherwise.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}
const builder = stripComments(builderSrc);

/** Slice a top-level `function name(...) { ... }` out of the builder source. */
function fnBody(name) {
  const start = builder.indexOf('function ' + name + '(');
  if (start === -1) return '';
  let i = builder.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < builder.length; j++) {
    if (builder[j] === '{') depth++;
    else if (builder[j] === '}' && --depth === 0) return builder.slice(start, j + 1);
  }
  return '';
}

// ---- 1. the block body is a live drop target -------------------------------

const bindBlockBody = fnBody('bindBlockBody');
check('bindBlockBody exists', bindBlockBody.length > 0);
check('createBlockEl wires every block body as a drop target',
  /bindBlockBody\(el, block, opts\)/.test(fnBody('createBlockEl')));
check('the body handles BOTH dragover and drop',
  /addEventListener\('dragover'/.test(bindBlockBody) && /addEventListener\('drop'/.test(bindBlockBody));
check('dragover calls preventDefault — without it the browser refuses the drop',
  /e\.preventDefault\(\)/.test(bindBlockBody));
check('the body yields to a more specific target (defaultPrevented = already claimed)',
  /if \(!dragState \|\| e\.defaultPrevented\) return/.test(bindBlockBody));
check('position decides: top band / bottom band / middle of a container',
  /ownListHint\(0\)/.test(bindBlockBody) && /ownListHint\(1\)/.test(bindBlockBody) &&
  /parentId: block\.id/.test(bindBlockBody));
check('the middle of a COLUMNS container targets the pane under the cursor',
  /closest\('\.column-pane'\)/.test(bindBlockBody));
check('a block can never be dropped into itself or its own subtree',
  /wouldNestIntoSelf\(getBlock\(dragState\.blockId\), hint\.parentId\)/.test(bindBlockBody));

// ---- 2. nested list surfaces are reachable ---------------------------------

const bindListSurface = fnBody('bindListSurface');
const claimedWithin = fnBody('claimedWithin');
check('claimedWithin exists', claimedWithin.length > 0);
check('claimedWithin requires CONTAINMENT — an ancestor .canvas-block must not count',
  /el\.contains\(specific\)/.test(claimedWithin) && /specific !== el/.test(claimedWithin));
check('BOTH the dragover and the drop handler use the scoped guard',
  (bindListSurface.match(/claimedWithin\(el, e\.target\)/g) || []).length >= 2);
check('the OLD unscoped guard is gone (it killed every nested list surface)',
  !/e\.target\.closest\('\.canvas-block, \.drop-slot, \.split-zone'\)\) return/.test(builder));

// ---- 3. a drop lands where it was aimed, not at the end --------------------

check('nearestIndexIn exists', fnBody('nearestIndexIn').length > 0);
check('the list surface inserts at the nearest gap, not always append',
  /nearestIndexIn\(el, e\.clientY\)/.test(bindListSurface) && !/index: live\.length/.test(bindListSurface));
check('the body handler picks the nearest gap when dropping INTO a container',
  /nearestIndexIn\(/.test(bindBlockBody));

// ---- 4. no stuck highlights ------------------------------------------------

const clearDropClasses = fnBody('clearDropClasses');
for (const cls of ['drop-before', 'drop-after', 'drop-into']) {
  check('clearDropClasses clears .' + cls,
    clearDropClasses.includes("'" + cls + "'") && clearDropClasses.includes(cls));
  check('admin.css styles .' + cls, new RegExp('\\.canvas-block\\.' + cls).test(css));
}

// ---- 5. columns: movable cut + grow-by-button (v1.70) ----------------------
// Ben asked for a resize that ALREADY existed — meaning nobody could see it.
// The grip is now always faintly visible, and a row can grow to 4 columns.

check('column resize handle is bound (mousedown drag)', /bindColumnResize/.test(builderSrc) && /col-resize-handle/.test(builderSrc));
check('resize grip is visible without hover (opacity > 0 at rest)',
  /col-resize-handle::after[^}]*opacity:\s*\.3/.test(css.replace(/\n/g, ' ')));
check('grip dot affordance exists (::before)', /col-resize-handle::before/.test(css));
check('"+ טור" button grows the row', /row-add-column/.test(builderSrc) && /הוסף טור/.test(builderSrc));
check('add-column caps at 4', /cols\.length < 4/.test(builderSrc));
check('new column joins with an equal share + history push',
  /ensureColumns\(block\)\.push\(\{ blocks: \[\] \}\)/.test(builderSrc) &&
  /setColumnRatios\(block, ratios\.concat\(avg\)\)/.test(builderSrc) &&
  /pushHistory\(\);\s*var ratios/.test(builderSrc.replace(/\n/g, ' ')));
check('admin.css styles .row-add-column', /\.row-add-column\s*\{/.test(css));

try { new Function(builderSrc); check('admin-builder.js parses', true); }
catch (e) { check('admin-builder.js parses (' + e.message + ')', false); }

console.log('');
console.log(fail ? 'SMOKE DROP-TARGETS: FAIL' : 'SMOKE DROP-TARGETS: PASS');
process.exit(fail ? 1 : 0);
