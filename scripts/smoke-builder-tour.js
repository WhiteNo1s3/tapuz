'use strict';

/**
 * v1.66 QA — the builder's guided walkthrough.
 *
 * The goal's core promise is a builder that "walks you through things that
 * are not 'just read the label'" — so this suite pins the walkthrough to the
 * REAL builder: every step's selector must exist in the template it spotlights,
 * the wiring must load the tour AFTER the builder, and skip/finish must
 * remember so it never nags a returning editor.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const tour = fs.readFileSync(path.join(root, 'public', 'admin-builder-tour.js'), 'utf8');
const builderRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'pages-builder.js'), 'utf8');

// ── parses + is an IIFE like its siblings ────────────────────────────
try { new Function(tour); check('admin-builder-tour.js parses', true); }
catch (e) { check('admin-builder-tour.js parses (' + e.message + ')', false); }
check('tour is a strict IIFE', /^\/\*[\s\S]*?\*\/\s*\(function \(\) \{\s*'use strict'/.test(tour));

// ── wired into the builder screen, after the builder itself ──────────
const tagAt = builderRoute.indexOf('<script src="/admin-builder-tour.js">');
check('builder screen loads the tour', tagAt > -1);
check('tour loads AFTER admin-builder.js', tagAt > builderRoute.indexOf('<script src="/admin-builder.js">'));

// ── every step spotlights something the template actually renders ────
// (a renamed id/class in the builder must fail HERE, not silently skip a step)
const stepSels = [...tour.matchAll(/sel:\s*'([^']+)'/g)].map((m) => m[1]);
check('tour declares 5 steps', stepSels.length === 5);
for (const sel of stepSels) {
  const needle = sel.replace(/^[.#]/, '');
  check(`step target exists in builder template: ${sel}`,
    new RegExp(`(class|id)="[^"]*\\b${needle}\\b`).test(builderRoute));
}
// the five moves the walkthrough must teach, in walk order
check('teaches toolbox → canvas → properties → responsive → save/publish',
  stepSels.join(' ') === '.toolbox #canvas .properties #btn-responsive .topbar-actions');

// ── copy teaches the ACTION, not the label ───────────────────────────
check('teaches drag (not click) on the toolbox', /גוררים|גררו/.test(tour));
check('teaches drop-by-intent on the canvas', /לפני\/אחרי/.test(tour) && /פיצול לטורים/.test(tour));
check('teaches click-to-edit text', /לוחצים עליו וכותבים/.test(tour));
check('teaches draft ≠ publish + revisions safety', /טיוטה/.test(tour) && /היסטוריית גרסאות/.test(tour));

// ── shown once, remembered, relaunchable ─────────────────────────────
check('first-visit guard reads localStorage', /localStorage\.getItem\(DONE_KEY\)/.test(tour));
check('finish/skip persist the done flag', /localStorage\.setItem\(DONE_KEY, '1'\)/.test(tour));
check('localStorage wrapped for private mode', /try \{ localStorage/.test(tour));
check('launcher button relaunches any time', /tz-tour-launch/.test(tour) && /🧭/.test(tour));
check('a missing target skips the step, not the tour', /while \(idx < STEPS\.length && !targetFor/.test(tour));
check('QA hook exposed (TapuzBuilderTour.start)', /window\.TapuzBuilderTour = \{ start: start/.test(tour));

// ── RTL + self-contained ─────────────────────────────────────────────
check('card is RTL', /setAttribute\('dir', 'rtl'\)/.test(tour));
check('no network calls (pure DOM walkthrough)', !/\bfetch\s*\(|XMLHttpRequest/.test(tour));
check('off-viewport targets are not spotlightable', /r\.right > 0 && r\.bottom > 0/.test(tour));

// ── the two layout bugs the walkthrough exposed live (v1.66) ─────────
// (1) bare 1fr let one wide block inflate the canvas track past the container,
//     shoving the toolbox off the viewport in RTL. Every builder grid must
//     clamp the canvas column with minmax(0, 1fr).
const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin.css'), 'utf8');
const builderGrids = [...css.matchAll(/\.builder[^{}]*\{[^}]*grid-template-columns:([^;]+);/g)]
  .map((m) => m[1].trim())
  .filter((v) => v.split(/\s+/).length > 1); // multi-column layouts only
check('found the builder multi-column grid rules', builderGrids.length >= 4);
for (const v of builderGrids) {
  check(`builder grid clamps its flexible track: ${v}`, !/(^| )1fr( |$)/.test(v));
}
// (2) the responsive device preview must be reachable on DESKTOP — it was
//     display:none'd with the mobile drawer buttons via their shared class.
check('#btn-responsive has its own desktop display rule', /#btn-responsive \{ display: inline-flex; \}/.test(css));

console.log('');
console.log(fail ? 'SMOKE BUILDER TOUR: FAIL' : 'SMOKE BUILDER TOUR: PASS');
process.exit(fail ? 1 : 0);
