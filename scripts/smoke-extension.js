'use strict';

/**
 * v0.46 QA — the Chrome extension's pure logic + invariants.
 * (The DOM-scrape + real-LLM path needs a loaded extension in Chrome and can't
 *  run headless; here we verify everything that IS testable in Node.)
 */

const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', 'extension');
let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── extract.js (UMD → Node) ──────────────────────────────────────────
const { extractPzn, looksLikePzn } = require(path.join(EXT, 'extract.js'));
const doc = `<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
  <head><meta charset="utf-8" /><title>מהבוט</title><meta name="bent-slug" content="p" /></head>
  <body><bent-hero id="h"><bent-heading id="hh" level="1">שלום</bent-heading></bent-hero></body>
</html>`;
check('extract from fenced reply', extractPzn('בשמחה!\n\n```html\n' + doc + '\n```\nבהצלחה').trim() === doc.trim());
check('extract from bare doc', extractPzn('הנה:\n' + doc).trim() === doc.trim());
check('extract identity on clean source', extractPzn(doc).trim() === doc.trim());
check('looksLikePzn true for doc', looksLikePzn(doc) === true);
check('looksLikePzn false for prose', looksLikePzn('just a normal answer') === false);

// ── providers.js (UMD → Node) ────────────────────────────────────────
const { PROVIDERS, forHost } = require(path.join(EXT, 'providers.js'));
check('providers table has all four', PROVIDERS.length === 4 && PROVIDERS.every((p) => p.id && p.label && typeof p.match === 'function' && p.assistant));
check('claude.ai maps to claude', forHost('claude.ai') && forHost('claude.ai').id === 'claude');
check('chatgpt.com maps to chatgpt', forHost('chatgpt.com') && forHost('chatgpt.com').id === 'chatgpt');
check('gemini maps', forHost('gemini.google.com') && forHost('gemini.google.com').id === 'gemini');
check('unknown host → null', forHost('evil.example.com') === null);

// ── manifest.json (valid MV3) ────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
check('manifest is MV3', manifest.manifest_version === 3);
check('manifest has background worker', !!(manifest.background && manifest.background.service_worker));
check('manifest content script lists providers before bridge',
  manifest.content_scripts && manifest.content_scripts[0].js[0] === 'providers.js' && manifest.content_scripts[0].js.includes('content-bridge.js'));
check('manifest targets claude.ai', JSON.stringify(manifest.host_permissions).includes('claude.ai'));
check('manifest requests storage permission', (manifest.permissions || []).includes('storage'));

// EVERY file the manifest references must exist on disk — a missing icon or
// script silently breaks "Load unpacked" in Chrome (this is why v0.46 wouldn't
// load). Collect all referenced paths and assert each is present.
const referenced = new Set();
if (manifest.background && manifest.background.service_worker) referenced.add(manifest.background.service_worker);
if (manifest.action) {
  if (manifest.action.default_popup) referenced.add(manifest.action.default_popup);
  for (const p of Object.values(manifest.action.default_icon || {})) referenced.add(p);
}
for (const p of Object.values(manifest.icons || {})) referenced.add(p);
for (const cs of manifest.content_scripts || []) for (const j of cs.js || []) referenced.add(j);
let allPresent = true;
for (const rel of referenced) {
  if (!fs.existsSync(path.join(EXT, rel))) { allPresent = false; console.log('     MISSING: ' + rel); }
}
check(`every manifest-referenced file exists (${referenced.size} files)`, allPresent);
// referenced HTML (popup) must in turn reference only present scripts
const popupHtml = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8');
for (const m of popupHtml.matchAll(/<script src="([^"]+)"/g)) {
  check(`popup.html script exists: ${m[1]}`, fs.existsSync(path.join(EXT, m[1])));
}

// ── SECURITY INVARIANT: token only in background, never in content/popup ─
const bg = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(EXT, 'content-bridge.js'), 'utf8');
const popup = fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8');
check('background reads the token', /cms_token|KEYS\.token/.test(bg));
// content script must not TOUCH the credential: no storage read, no auth header,
// no direct CMS fetch. (The word "token" may appear only in the doc comment.)
check('content script does not read extension storage', !/chrome\.storage/.test(content));
check('content script sends no Authorization/Bearer', !/Authorization|Bearer|cms_token/i.test(content));
check('content script does NOT fetch the CMS directly', !/\bfetch\s*\(/.test(content));
// popup writes the token (setConfig) but never reads it back from any response.
check('popup never reads a token from a response', !/\b(?:c|r|res|resp|data)\.token\b/.test(popup));
check('background getConfig response omits the raw token', /hasToken:\s*!!/.test(bg) && !/sendResponse\([^)]*token:\s*c\.token/.test(bg));

// ── all JS files parse ───────────────────────────────────────────────
for (const f of ['extract.js', 'providers.js', 'background.js', 'content-bridge.js', 'popup.js']) {
  try {
    new Function(fs.readFileSync(path.join(EXT, f), 'utf8'));
    check(`${f} parses`, true);
  } catch (e) {
    check(`${f} parses (${e.message})`, false);
  }
}

console.log('');
console.log(fail ? 'SMOKE EXTENSION: FAIL' : 'SMOKE EXTENSION: PASS');
process.exit(fail ? 1 : 0);
