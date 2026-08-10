'use strict';

/**
 * v0.4 QA — מלווה ההעתקה (Ben's realignment: "our daemon shouldn't do
 * anything — we direct the user; our only job is copy paste and look good").
 *
 * The invariants ARE the philosophy: no presence on the LLM sites, no
 * background daemon, no permissions beyond storage+clipboard, user-driven
 * copy/paste both ways. A regression here is a strategy regression.
 */

const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', 'extension');
let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── manifest: popup-only, least privilege, both browsers ─────────────────

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
check('manifest is MV3', manifest.manifest_version === 3);
check('NO content scripts — we never enter the LLM sites', !manifest.content_scripts);
check('NO host permissions — CORS on /agent/v1 covers every fetch', !manifest.host_permissions && !manifest.optional_host_permissions);
check('NO background daemon — nothing runs when the popup is closed', !manifest.background);
check('permissions are exactly storage + clipboardWrite',
  JSON.stringify((manifest.permissions || []).slice().sort()) === JSON.stringify(['clipboardWrite', 'storage']));
check('Firefox installability (gecko id + min version)',
  !!(manifest.browser_specific_settings && manifest.browser_specific_settings.gecko &&
     manifest.browser_specific_settings.gecko.id));
// AMO gate (2026): every submission must declare data collection. We collect
// NOTHING — the token/address live in local storage and travel only to the
// user's own CMS — and "none" is the explicit way to say so.
check('AMO data-collection declaration: required ["none"]',
  JSON.stringify(((manifest.browser_specific_settings.gecko || {}).data_collection_permissions || {}).required) === '["none"]');
check('Bridge V2 carries the same declaration',
  (() => {
    const m2 = JSON.parse(fs.readFileSync(path.join(EXT, '..', 'extension-v2a', 'manifest.json'), 'utf8'));
    return JSON.stringify(((m2.browser_specific_settings.gecko || {}).data_collection_permissions || {}).required) === '["none"]';
  })());
check('popup is the whole product', manifest.action && manifest.action.default_popup === 'popup.html');

// every referenced file exists (a missing icon silently breaks Load unpacked)
const referenced = new Set(['popup.html']);
for (const p of Object.values(manifest.action.default_icon || {})) referenced.add(p);
for (const p of Object.values(manifest.icons || {})) referenced.add(p);
let allPresent = true;
for (const rel of referenced) {
  if (!fs.existsSync(path.join(EXT, rel))) { allPresent = false; console.log('     MISSING: ' + rel); }
}
check(`every manifest-referenced file exists (${referenced.size} files)`, allPresent);

const popupHtml = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8');
for (const m of popupHtml.matchAll(/<script src="([^"]+)"/g)) {
  check(`popup.html script exists: ${m[1]}`, fs.existsSync(path.join(EXT, m[1])));
}

// ── the injection era is OVER — its files must stay gone ─────────────────

for (const gone of ['background.js', 'content-bridge.js', 'extract.js', 'providers.js', 'llm.js']) {
  check(`retired file stays gone: ${gone}`, !fs.existsSync(path.join(EXT, gone)));
}

// no LLM-site hostname appears in any CODE file (README prose is allowed)
const codeFiles = fs.readdirSync(EXT).filter((f) => /\.(js|json|html)$/.test(f));
const hostRe = /claude\.ai|chatgpt\.com|chat\.openai\.com|grok\.com|gemini\.google/;
check('no LLM-site hostname in any code file',
  codeFiles.every((f) => !hostRe.test(fs.readFileSync(path.join(EXT, f), 'utf8'))));

// ── popup.js: the two copy-paste flows, and token hygiene ────────────────

const popup = fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8');
check('copy flow: roleplay pack + the user\'s brief, via the clipboard',
  /\/agent\/v1\/roleplay\?size=/.test(popup) && /brief=' \+ encodeURIComponent\(brief\)/.test(popup) &&
  /navigator\.clipboard\.writeText\(pack\)/.test(popup));
check('paste-back flow: create-from-source as a DRAFT, never auto-publish',
  /\/agent\/v1\/create-from-source/.test(popup) && /publish: false/.test(popup) && !/publish: true/.test(popup));
check('409 conflict offers an explicit update, not a silent overwrite',
  /res\.status === 409/.test(popup) && /update\) body\.update = true/.test(popup));
check('the token rides ONLY as a Bearer header to the configured base',
  /Authorization: 'Bearer ' \+ cfg\.token/.test(popup) && /cfg\.baseUrl \+ path/.test(popup));
check('no response token is ever read back', !/\b(?:d|res|r|data)\.token\b/.test(popup));
check('empty token field keeps the stored token (no accidental wipe)',
  /if \(token\) patch\.token = token/.test(popup));
check('cross-browser storage handle (browser || chrome)',
  /typeof browser !== 'undefined' \? browser : chrome/.test(popup));
check('the builder link opens the created draft',
  /\/admin\/edit\/' \+ encodeURIComponent\(d\.fullPath\)/.test(popup));

// ── the look: orange is a requirement, not a vibe ────────────────────────

check('the popup wears the citrus (orange gradient header)',
  /#f97316/.test(popupHtml) && /#ea580c/.test(popupHtml) && /linear-gradient/.test(popupHtml));
check('RTL Hebrew UI', /dir="rtl"/.test(popupHtml) && /מלווה ההעתקה/.test(popupHtml));
check('the user is told THEY act on the chat site',
  /ושולחים בעצמכם/.test(popupHtml) && /לא נוגעים באתר שלהם/.test(popupHtml));

console.log('');
console.log(fail ? 'SMOKE EXTENSION: FAIL' : 'SMOKE EXTENSION: PASS');
process.exit(fail ? 1 : 0);
