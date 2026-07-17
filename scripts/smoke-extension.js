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
const { extractPzn, looksLikePzn, isCompletePzn, analyzeReply } = require(path.join(EXT, 'extract.js'));
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

// ── completion detector (v0.55 — the auto-publish safety gate) ────────
check('isCompletePzn true for a full document', isCompletePzn(doc) === true);
check('isCompletePzn false for a truncated stream', isCompletePzn('<!DOCTYPE html><html><body><bent-he') === false);
check('analyzeReply complete on a closed fence + PZN_READY', analyzeReply('```html\n' + doc + '\n```\nPZN_READY').complete === true);
check('analyzeReply reason=pzn_ready with the marker', analyzeReply('```html\n' + doc + '\n```\nPZN_READY').reason === 'pzn_ready');
check('analyzeReply open-fence mid-stream is NOT complete', analyzeReply('בונה…\n```html\n<!DOCTYPE html><html><body><bent-hero id="h">').complete === false);
check('analyzeReply reason=stream_open_fence mid-stream', analyzeReply('```html\n<!DOCTYPE html><html><body><bent-hero id="h">').reason === 'stream_open_fence');
check('analyzeReply flags a missing </html>', analyzeReply('<!DOCTYPE html><html><body><bent-text id="t">hi</bent-text></body>').reason === 'missing_close_html');

// ── providers.js (UMD → Node) ────────────────────────────────────────
const { PROVIDERS, forHost } = require(path.join(EXT, 'providers.js'));
check('providers table has all four', PROVIDERS.length === 4 && PROVIDERS.every((p) => p.id && p.label && typeof p.match === 'function' && p.assistant));
check('every provider has inject selectors (composer/send/streaming)', PROVIDERS.every((p) => p.composer && p.send && p.streaming));
check('claude.ai maps to claude', forHost('claude.ai') && forHost('claude.ai').id === 'claude');
check('chatgpt.com maps to chatgpt', forHost('chatgpt.com') && forHost('chatgpt.com').id === 'chatgpt');
check('gemini maps', forHost('gemini.google.com') && forHost('gemini.google.com').id === 'gemini');
check('unknown host → null', forHost('evil.example.com') === null);

// ── manifest.json (valid MV3) ────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
check('manifest is MV3', manifest.manifest_version === 3);
check('manifest has background worker', !!(manifest.background && manifest.background.service_worker));
check('manifest content script loads providers → extract → bridge', (() => {
  const js = (manifest.content_scripts && manifest.content_scripts[0].js) || [];
  return js[0] === 'providers.js' && js.includes('extract.js') && js.indexOf('extract.js') < js.indexOf('content-bridge.js');
})());
check('manifest targets claude.ai', JSON.stringify(manifest.host_permissions).includes('claude.ai'));
check('manifest requests storage permission', (manifest.permissions || []).includes('storage'));
// localhost must be a granted host so a local `node src/server.js` CMS is
// fetchable with zero permission dance; other origins use optional_host_permissions.
check('manifest grants localhost host permission', JSON.stringify(manifest.host_permissions).includes('localhost'));
check('manifest declares optional_host_permissions for other CMS origins',
  Array.isArray(manifest.optional_host_permissions) && manifest.optional_host_permissions.length > 0);

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

// ── Tier realignment (v0.85): the extension is the KEYLESS tier. The user's
//    LLM key lives in the CMS (config/ai.json, server-side — smoke-byok.js
//    asserts that side); the extension must carry NO key path at all. ─
check('llm.js is GONE (its logic moved server-side to src/ai.js)',
  !fs.existsSync(path.join(EXT, 'llm.js')));
check('background no longer imports llm.js', !/importScripts\([^)]*llm\.js/.test(bg));
check('generate is a deprecation pointing at the CMS chat',
  /case 'generate'/.test(bg) && /\/admin\/chat/.test(bg) && !/TapuzLLM\.generate/.test(bg));
check('background never calls a provider API with a key',
  !/api\.anthropic\.com|api\.openai\.com/.test(bg));
check('content script never sees a byok key', !/byok/i.test(content));
check('popup has NO key input anymore', !/byok-key\b/.test(fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8')));
check('popup links key users to the CMS copilot', /byok-cms-link/.test(popup) && /\/admin\/chat/.test(popup));
check('manifest no longer requests provider API hosts (least privilege)',
  !JSON.stringify(manifest.host_permissions).includes('api.anthropic.com') &&
  !JSON.stringify(manifest.host_permissions).includes('api.openai.com'));

// ── Free-plan lite pack (v0.86): the keyless tier must ALSO serve users on
//    free chat plans — the full pack is rejected at the message-length gate,
//    so a persisted pack-size choice rides every surface. ─
check('background persists pack_size + forwards size=lite to the CMS',
  /pack_size/.test(bg) && /q\.set\('size', 'lite'\)/.test(bg));
check('popup offers the free-plan lite toggle (persisted via packSize)',
  /id="lite"/.test(popupHtml) && /packSize/.test(popup));
check('panel offers the free-plan lite toggle', /tz-lite/.test(content) && /packSize/.test(content));
check('lite skips the prebuilt full-size mission messages',
  /!packLite && mission/.test(content));

// ── BYOT roleplay + mission handlers wired (v0.55) ───────────────────
check('background handles the roleplay game pack', /case 'roleplay'/.test(bg) && /\/agent\/v1\/roleplay/.test(bg));
check('background handles mission pull + step report', /case 'mission'/.test(bg) && /case 'missionStep'/.test(bg) && /\/agent\/v1\/mission/.test(bg));
check('background publish gates on completeness', /requireComplete/.test(bg) && /analyzeReply/.test(bg));
check('content panel injects into the composer + asks worker to publish', /findComposer|setComposerText/.test(content) && /type: 'publish'/.test(content));
// v0.56 injection hardening — React-controlled inputs need the native setter,
// else onChange never fires and the composer stays empty on ChatGPT/Grok.
check('composer inject uses the native value setter (React-safe)', /setNativeValue/.test(content) && /getOwnPropertyDescriptor/.test(content));
check('panel surfaces per-provider selector-health diagnostics', /selectorHealth/.test(content) && /tz-diag/.test(content));

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
