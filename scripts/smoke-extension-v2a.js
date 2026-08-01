'use strict';

/**
 * Bridge V2 (extension-v2a) QA — static, no browser: the invariants that make
 * the extension safe and CROSS-BROWSER are all visible in the source.
 *
 * The Firefox class of bug this pins down: `browser.*` is promise-only, so a
 * single callback-style call (storage.local.get(keys, cb)) works in Chrome
 * and silently breaks in Firefox. And Firefox MV3 host permissions are
 * user-approvable — the code must request them, not assume them.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'extension-v2a');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const bg = fs.readFileSync(path.join(DIR, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(DIR, 'content-bridge.js'), 'utf8');
const popup = fs.readFileSync(path.join(DIR, 'popup.js'), 'utf8');
const all = bg + content + popup;

// every script parses
for (const f of ['background.js', 'content-bridge.js', 'popup.js']) {
  try { new Function(fs.readFileSync(path.join(DIR, f), 'utf8')); check(f + ' parses', true); }
  catch (e) { check(f + ' parses (' + e.message + ')', false); }
}

// ── manifest: cross-browser MV3 ──
check('manifest v3', manifest.manifest_version === 3);
check('background carries BOTH keys (service_worker for Chrome, scripts for Firefox)',
  !!(manifest.background && manifest.background.service_worker && Array.isArray(manifest.background.scripts)));
check('gecko id + strict_min_version 128 (optional_host_permissions era)',
  !!(manifest.browser_specific_settings && manifest.browser_specific_settings.gecko &&
     manifest.browser_specific_settings.gecko.id &&
     parseInt(manifest.browser_specific_settings.gecko.strict_min_version, 10) >= 128));
check('host permissions are loopback-only; sites are OPTIONAL (opt-in per origin)',
  (manifest.host_permissions || []).every((p) => /localhost|127\.0\.0\.1/.test(p)) &&
  (manifest.optional_host_permissions || []).length > 0);

// ── the founding rule: no keys, ever ──
// Prose may TELL the story ("V1 grew a BYOK popup and amputated it"); code
// may not HANDLE a key: no apiKey fields, no Authorization headers, no sk-.
check('no API-key handling (apiKey/Authorization/sk- absent from code)',
  !/apiKey|api_key|['"]Authorization['"]|Bearer |sk-ant/.test(all));

// ── Firefox compatibility: promise-style only ──
// A callback as the LAST arg of storage/sendMessage/tabs calls is the Chrome
// idiom that breaks Firefox. Promise-style has ').then' or 'await' instead.
check('no callback-style storage calls', !/storage\.local\.(get|set)\([^)]*function|storage\.local\.(get|set)\([^)]*=>\s*\{/.test(all));
check('no runtime.lastError reliance (promise rejections instead)', !/runtime\.lastError/.test(all));
check('namespace shim picks browser first', /typeof browser !== 'undefined' \? browser : chrome/.test(bg) &&
  /typeof browser !== 'undefined' \? browser : chrome/.test(content));

// ── Firefox host-permission reality ──
check('popup requests the loopback grant inside the click gesture', /ensureLocalPermission/.test(popup) &&
  /permissions\.request\(\{ origins: LOCAL_ORIGINS \}\)/.test(popup));
check('worker distinguishes "no permission" from "LM Studio down"', /hasLocalPermission/.test(bg) &&
  /פתחו את הפופאפ/.test(bg));

// ── the relay invariants ──
check('closed path list (chat/completions + models only)',
  /ALLOWED_PATHS = \['\/v1\/chat\/completions', '\/v1\/models'\]/.test(bg));
check('loopback allowlist is exact (localhost / 127.0.0.1 / [::1])',
  /LOOPBACK_HOSTS = \['localhost', '127\.0\.0\.1', '\[::1\]'\]/.test(bg));
check('content bridge answers same-window, same-origin only',
  /ev\.source !== window/.test(content) && /ev\.origin !== window\.location\.origin/.test(content));
check('onMessage keeps sendResponse+true (the shape BOTH browsers accept)',
  /sendResponse/.test(bg) && /return true/.test(bg));

// ── the CMS side speaks the same protocol ──
const cmsBridge = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-bridge.js'), 'utf8');
check('page glue and extension agree on message names',
  ['tz-bridge-hello', 'tz-bridge-ping', 'tz-local-llm', 'tz-local-llm-result']
    .every((t) => cmsBridge.includes(t) && content.includes(t)));

console.log('');
console.log(fail ? 'SMOKE EXTENSION-V2A: FAIL' : 'SMOKE EXTENSION-V2A: PASS');
process.exit(fail ? 1 : 0);
