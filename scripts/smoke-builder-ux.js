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
  /addUrls = function[\s\S]{0,400}pushHistory\(\)[\s\S]{0,260}renderCanvas\(\)/.test(builder));
check('it concats onto the SAME param list, keyed (not a hardcoded field)',
  /block\.data\[key\] = block\.data\[key\]\.concat\(urls\)/.test(builder));
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

// parse guard
try { new Function(builder); check('admin-builder.js parses', true); }
catch (e) { check('admin-builder.js parses (' + e.message + ')', false); }

console.log('');
console.log(fail ? 'SMOKE BUILDER-UX: FAIL' : 'SMOKE BUILDER-UX: PASS');
process.exit(fail ? 1 : 0);
