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

// ── v2.33 — once, still, modal (Ben: "the tutorial can't hit me every time
//    I enter the editor … the delay is when scrolling it follows you …
//    scrolling shouldn't be allowed, its the tutorial") ──────────────────
// ONCE: the first visit is remembered the moment the tour shows — leaving
// the editor mid-tour used to mean "not seen", so it came back every visit.
const bootFn = (tour.match(/function boot\(\) \{[\s\S]*?\n  \}/) || [''])[0];
check('the first visit is marked seen BEFORE the tour starts (boot: markSeen() then start)',
  /markSeen\(\);[\s\S]{0,200}setTimeout\(start, 700\)/.test(bootFn));
check('a returning editor is left alone (boot returns when seen)', /if \(seen\) return;/.test(bootFn));
// STILL: placed once per step, never chasing the page
check('NO scroll listener — the spotlight does not follow the page', !/addEventListener\(\s*['"]scroll['"]|\.onscroll\b/.test(tour));
check('NO position transition on the spotlight (nothing lags behind)', !/transition\s*[:=]/.test(tour));
check('the target is scrolled into view BEFORE the page is locked', /scrollIntoView\(/.test(tour) && /targetFor\(STEPS\[idx\], true\)/.test(tour));
// admin.css gives html `scroll-behavior: smooth` — an ANIMATED scrollIntoView
// would let the page glide under a spotlight measured too early (the very
// delay Ben reported). The tour's own scroll must be instant.
check('the tour scrolls INSTANTLY (scroll-behavior forced to auto around scrollIntoView, then restored)',
  /html\.style\.scrollBehavior = 'auto';[\s\S]{0,200}scrollIntoView\([\s\S]{0,200}finally \{ html\.style\.scrollBehavior = prev; \}/.test(tour));
check('the spotlight and the card stack ABOVE the blocker',
  /position:fixed;inset:0;z-index:' \+ Z \+/.test(tour) && /z-index:' \+ \(Z \+ 1\)/.test(tour) && /z-index:' \+ \(Z \+ 2\)/.test(tour));
// the keyboard is the tour's: nothing leaks to the builder's shortcuts, Tab
// stays inside the card, the card's own buttons activate natively
check('keys never reach the builder shortcuts while the tour is up (stopPropagation first)',
  /keyBound = function \(e\) \{\s*e\.stopPropagation\(\);/.test(tour));
check('Tab cycles between הבא and דלגו (never out of the card)',
  /e\.key === 'Tab'/.test(tour) && /\(document\.activeElement === n \? s : n\)\.focus\(\)/.test(tour));
check('Enter/Space on a card button activates THAT button (Enter on דלגו skips, not advances)',
  /if \(inCard && \(e\.key === 'Enter' \|\| e\.key === ' '/.test(tour));
check('the page behind the dim is inert while the tour is up, and released after',
  /n\.inert = true;/.test(tour) && /n\.inert = false;/.test(tour) && /setInert\(false\);/.test(tour) && /'inert' in document\.documentElement/.test(tour));
// MODAL: the page stands still and takes no clicks while the tour is up
check('document overflow is locked while the tour is up (and restored after)',
  /html\.style\.overflow = 'hidden'/.test(tour) && /document\.body\.style\.overflow = 'hidden'/.test(tour) &&
  /document\.documentElement\.style\.overflow = savedOverflow\[0\]/.test(tour));
check('wheel + touchmove are swallowed (passive:false, capture)',
  /addEventListener\('wheel', lockBound, \{ passive: false, capture: true \}\)/.test(tour) &&
  /addEventListener\('touchmove', lockBound, \{ passive: false, capture: true \}\)/.test(tour));
check('keyboard scrolling is swallowed; Escape skips, Enter advances',
  /PageDown/.test(tour) && /ArrowDown/.test(tour) && /e\.key === 'Escape'/.test(tour) && /e\.key === 'Enter'/.test(tour));
check('a full-viewport blocker sits under the spotlight (clicks on the dimmed page go nowhere)',
  /tz-tour-dim/.test(tour) && /position:fixed;inset:0;z-index:' \+ Z/.test(tour));
check('teardown unlocks the page and removes the blocker', /unlockPage\(\);/.test(tour) && /dim\.remove\(\)/.test(tour));
check('every lock has its unlock (listeners removed)',
  /removeEventListener\('wheel', lockBound/.test(tour) && /removeEventListener\('touchmove', lockBound/.test(tour) && /removeEventListener\('keydown', keyBound/.test(tour));
// the badge that wrapped into "the oval": a never-published draft is just
// "טיוטה", and the badge never wraps
check('the "טיוטה שונה" suffix belongs to PUBLISHED pages only',
  /page\.status === 'published' && hasUnpublished \? ' • טיוטה שונה' : ''/.test(builderRoute));
check('the publish badge never wraps', /id="publish-badge" style="[^"]*white-space:nowrap/.test(builderRoute));

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
