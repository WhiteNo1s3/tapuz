'use strict';

/**
 * v2.13 QA — the builder UX gaps the module audit (MODULE_AUDIT.md) flagged.
 * Same source-assertion style as smoke-drop-targets: a fix that gets reverted
 * or commented out fails a check here.
 *
 * Four fixes:
 *   1. logos seed uses real demo art, never /uploads/PLACEHOLDER-*.svg
 *   2. gallery panel offers add-by-URL, not only the library multi-pick
 *   3. publish warns about modules that would ship blank/broken
 *   4. empty containers invite a drop; the "into" hover names the landing
 */

const fs = require('fs');
const path = require('path');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

const root = path.join(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'public', 'admin-builder.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin.css'), 'utf8');
const registry = require('../src/block-registry');

// ---- 1. logos: no broken placeholder defaults ------------------------------

const logos = registry.BLOCK_REGISTRY.find((b) => b.type === 'logos');
check('logos module exists in the registry', !!logos);
const logoSrcs = ((logos && logos.seed && logos.seed.items) || []).map((i) => i.src);
check('logos seed has items', logoSrcs.length > 0);
check('logos seed no longer points at /uploads/PLACEHOLDER-*.svg',
  logoSrcs.every((s) => !/PLACEHOLDER/i.test(s)));
check('logos seed art actually exists on disk (renders, not broken)',
  logoSrcs.every((s) => fs.existsSync(path.join(root, 'public', s.replace(/^\//, '')))));
check('the PLACEHOLDER hint wording is gone from the logos module',
  !(logos && /PLACEHOLDER/.test(logos.hintHe || '')));

// ---- 2. gallery: add-by-URL alongside the library picker -------------------

// add-by-URL lives in the generic media-list editor (renderListParam), which
// is what actually renders for BOTH gallery (images) and logos (items) — so
// the one fix covers both. It sits beside the library picker, keyed by param.
check('the media-list editor renders an add-by-URL input beside the picker',
  /data-lp-url="/.test(builder) && /data-lp-url-add="/.test(builder));
check('the URL add handler splits comma / newline lists',
  /addUrls = function[\s\S]{0,120}split\(\/\[\\n,\]\+\//.test(builder));
check('add-by-URL pushes history, marks dirty, and re-renders (a real edit)',
  /addUrls = function[\s\S]{0,400}pushHistory\(\)[\s\S]{0,500}renderCanvas\(\)/.test(builder));
check('it concats onto the SAME param list, keyed (not a hardcoded field)',
  /block\.data\[key\] = block\.data\[key\]\.concat\(urls\.map\(/.test(builder));
check('URLs become ITEM OBJECTS keyed by the media field, never bare strings',
  /item\[mediaField\] = u/.test(builder) &&
  /f\.type === 'media'[\s\S]{0,60}mediaField = f\.name/.test(builder));
check('the library multi-pick path still exists (URL is ADDED, not a swap)',
  /data-lp-media-add\b/.test(builder) && /openMediaGallery/.test(builder));

// ---- 3. empty-module publish warning ---------------------------------------

check('findEmptyModules walks the tree', /function findEmptyModules\(/.test(builder));
check('it flags image / gallery / logos / video / audio / embed / map / banner',
  /b\.type === 'image'/.test(builder) && /b\.type === 'gallery'/.test(builder) &&
  /b\.type === 'video' \|\| b\.type === 'audio'/.test(builder) &&
  /b\.type === 'embed' \|\| b\.type === 'map'/.test(builder));
check('it does NOT flag dynamic article-list / category (empty = legit state)',
  !/b\.type === 'article-list'/.test(builder) && !/case 'category'/.test(builder));
check('it recurses into both column and blocks containers',
  /findEmptyModules\(col\.blocks/.test(builder) && /findEmptyModules\(ensureBlocks\(b\)/.test(builder));
check('publishPage runs the scan and can be bypassed programmatically',
  /publishPage\._skipEmptyCheck/.test(builder) && /findEmptyModules\(\)/.test(builder));
check('the warning is a confirm the owner can override, cancel aborts publish',
  /לפרסם בכל זאת/.test(builder) && /cancelled: true/.test(builder));

// ---- 4. drop-into-container affordance -------------------------------------

check('empty containers show an inviting drop cue, not a flat label',
  /is-container-drop/.test(builder) && /שחררו כאן/.test(builder));
check('the old bare "גרור לכאן" placeholder text is gone', !/textContent = 'גרור לכאן'/.test(builder));
check('the "into" hover names the landing (↳ נכנס לתוך המיכל)',
  /\.canvas-block\.drop-into::after/.test(css) && /נכנס לתוך המיכל/.test(css));
check('the drop cue icon is styled (with a reduced-motion opt-out)',
  /\.drop-cue-icon/.test(css) && /prefers-reduced-motion: reduce[^}]*\}[\s\S]{0,80}drop-cue-icon|drop-cue-icon[\s\S]{0,200}prefers-reduced-motion/.test(css));

// ---- 5. spacer is drag-resizable on the canvas (Mobeeart/Camilyo feel) -----
// So a user reaches for a real spacer instead of hammering Enter in a text
// block. Height is the source of truth and survives the .pzn round-trip.

check('the canvas spacer renders a live height label + a drag handle',
  /spacer-label/.test(builder) && /spacer-resize-handle/.test(builder) && /spacer-px/.test(builder));
check('bindSpacerResize drags the bottom edge and writes exact px height',
  /function bindSpacerResize\(/.test(builder) &&
  /block\.data\.height = liveH \+ 'px'/.test(builder));
check('the drag clamps to a sane range (4–800px)',
  /Math\.max\(4, Math\.min\(800/.test(builder));
check('the drag pushes history and re-syncs the panel (px field stays truthful)',
  /function bindSpacerResize[\s\S]*?pushHistory\(\)[\s\S]*?renderProperties\(\)[\s\S]*?bindColumnResize/.test(builder));
check('spacerPx normalizes size-name / rem / px to a pixel number',
  /function spacerPx\(/.test(builder) && /\* 16/.test(builder));
check('admin.css styles the label, the handle, and the resize cursor',
  /\.spacer-label/.test(css) && /\.spacer-resize-handle/.test(css) && /is-spacer-resizing/.test(css));

// ---- 6. the cut sits ON the cut (v2.13, "huge bug") ------------------------
// The preview row is direction:ltr BY DESIGN; the old code branched on the
// DOCUMENT direction (Hebrew admin → rtl), pinning the handle to the pane's
// LEFT edge and inverting the drag. Physical placement, no isRtl() branches.

check('handle is placed at the pane\'s physical right edge (the boundary)',
  /handle\.style\.left = '100%'/.test(builder) && /handle\.style\.marginLeft = '-5px'/.test(builder));
check('no isRtl() branch remains in handle placement',
  !/handle\.style\.left = isRtl\(\)/.test(builder) && !/handle\.style\.right = isRtl\(\)/.test(builder));
check('the drag math no longer inverts on document RTL',
  !/if \(rtl\) dx = -dx/.test(builder));

// ---- 7. splitting inside a column EXTENDS the row (Camilyo), never nests ---

check('doSplitMove extends the parent row when target lives in a column',
  /targetNode\.parent && isColumnsContainer\(targetNode\.parent\.type\)/.test(builder) &&
  /rowCols\.splice\(insertAt, 0, \{ blocks: \[incoming\] \}\)/.test(builder));
check('ratios are read BEFORE the new column is inserted (no extra share)',
  /var rowRatios = parseColumnRatios\(rowBlock\);\s*\n\s*var insertAt/.test(builder));
check('the row caps at 4 — at the cap the module lands beside, never nests',
  /rowCols\.length < 4/.test(builder) && /השורה מלאה/.test(builder));
check('a deterministic drop hook exists for tests (_testDrop)',
  /_testDrop: function \(state, hint\)/.test(builder));

// ---- 8. a happy builder ----------------------------------------------------

check('selection/drop chrome is the brand citrus, not cold blue',
  /--select: #ea580c/.test(css) && !/--select: #2563eb/.test(css));
check('the block toolbar sits INSIDE the block (no more top:-11px pill over the neighbor)',
  /\.block-toolbar \{[^}]*top: 3px/.test(css.replace(/\n/g, ' ')) &&
  !/\.block-toolbar \{[^}]*top: -11px/.test(css.replace(/\n/g, ' ')));
check('the toolbar is warm and light, delete stays a warning',
  /\.block-toolbar \{[^}]*background: #fff/.test(css.replace(/\n/g, ' ')) &&
  /data-act="del"\]:hover \{ color: var\(--danger\)/.test(css));

// parse guard
try { new Function(builder); check('admin-builder.js parses', true); }
catch (e) { check('admin-builder.js parses (' + e.message + ')', false); }

console.log('');
console.log(fail ? 'SMOKE BUILDER-UX: FAIL' : 'SMOKE BUILDER-UX: PASS');
process.exit(fail ? 1 : 0);
