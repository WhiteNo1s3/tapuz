'use strict';

/**
 * v1.69 QA — the prompt builder + the retirement of injection.
 *
 * Ben's flow: one button in the page builder produces a complete, copyable
 * prompt (roleplay pack + optional current page source + brief); the USER
 * pastes it into their chat; the extension only reads the reply. This suite
 * pins the button, the wiring, the no-injection invariant, and the ecosystem
 * links that tie the extension back to the CMS tools.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const pb = fs.readFileSync(path.join(root, 'public', 'admin-prompt-builder.js'), 'utf8');
const builderRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'pages-builder.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin.css'), 'utf8');

// ── module parses + wiring ───────────────────────────────────────────
try { new Function(pb); check('admin-prompt-builder.js parses', true); }
catch (e) { check('admin-prompt-builder.js parses (' + e.message + ')', false); }
check('builder template has the 🧠 button', /id="btn-prompt-builder"/.test(builderRoute));
check('builder screen loads the module', /<script src="\/admin-prompt-builder\.js">/.test(builderRoute));
check('button is visible at every width', /#btn-prompt-builder \{ display: inline-flex; \}/.test(css));

// ── the prompt: pack + page source + brief, via our own admin APIs ───
check('fetches the roleplay pack from inject-pack', /\/admin\/api\/inject-pack\?/.test(pb) && /format.*roleplay/.test(pb));
check('optionally appends the CURRENT page source (edit, not rebuild)', /\/admin\/api\/pzn\/source\?fullPath=/.test(pb) && /אל תבנו מאפס/.test(pb));
check('lite pack option rides the free-plan gate', /size.*lite|'size', 'lite'/.test(pb));
check('delivers via clipboard — the user pastes', /navigator\.clipboard\.writeText/.test(pb));
check('module carries no token / no external host', !/Bearer|Authorization|tzk_/.test(pb) && !/https?:\/\//.test(pb));

// ── injection is retired EVERYWHERE (extension side) ─────────────────
const providers = require(path.join(root, 'extension', 'providers.js'));
check('all extension providers are copyFirst', providers.PROVIDERS.every((p) => p.copyFirst === true));
const popupHtml = fs.readFileSync(path.join(root, 'extension', 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'extension', 'popup.js'), 'utf8');
check('popup copy no longer promises injection', !/הזרק/.test(popupHtml));
check('popup links to the prompt builder (the ecosystem)', /prompt-builder-link/.test(popupHtml) && /prompt-builder-link/.test(popupJs));

console.log('');
console.log(fail ? 'SMOKE PROMPT BUILDER: FAIL' : 'SMOKE PROMPT BUILDER: PASS');
process.exit(fail ? 1 : 0);
