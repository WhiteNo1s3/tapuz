'use strict';

/**
 * Bridge V2 (extension-v2a) QA — static, no browser: the invariants that make
 * the extension safe and CROSS-BROWSER are all visible in the source.
 *
 * The Firefox class of bug this pins down: `browser.*` is promise-only, so a
 * single callback-style call (storage.local.get(keys, cb)) works in Chrome
 * and silently breaks in Firefox. And Firefox MV3 host permissions are
 * user-approvable — the code must request them, not assume them; the request
 * is also bound to the tick of the click, so an await before it loses it.
 *
 * The hosted-site class of bug (v0.3.0): the site is remote and only the
 * model is local. A match pattern may not carry a port, btoa dies on a
 * unicode host, and the tab the owner is looking at needs the script NOW,
 * not on its next load.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'extension-v2a');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function cmpSemver(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const bg = fs.readFileSync(path.join(DIR, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(DIR, 'content-bridge.js'), 'utf8');
const popup = fs.readFileSync(path.join(DIR, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(DIR, 'popup.html'), 'utf8');
const readme = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
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
// Without activeTab the popup cannot even READ the active tab's url — the
// tab of a not-yet-connected site matches no host permission, so tabs.query
// answers with url undefined and "connect this site" can never fire.
check('activeTab permission (reads the active tab url, injects into it)',
  (manifest.permissions || []).includes('activeTab'));

// ── one version, two files ──
const contentVersion = (content.match(/const VERSION = '([^']+)'/) || [])[1];
check('manifest version and content-bridge VERSION agree (' + manifest.version + ')',
  !!contentVersion && contentVersion === manifest.version);
check('version >= 0.3.0 (the hosted-site flow)', cmpSemver(manifest.version, '0.3.0') >= 0);

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

// ── attaching a HOSTED site ──
// A match pattern's host may not carry a port, and `new URL(x).origin` keeps
// one: https://site.example:8443 would be rejected outright as a pattern.
check('site pattern is protocol+hostname, never origin (patterns carry no port)',
  /u\.protocol \+ '\/\/' \+ u\.hostname \+ '\/\*'/.test(popup) && !/\.origin \+ '\/\*'/.test(popup));
// btoa throws on anything outside Latin1 — a single unicode host killed connect.
check('script id is hashed, not btoa (no btoa anywhere in the extension)',
  !/btoa\s*\(/.test(all) && /function scriptIdFor/.test(popup) &&
  /charCodeAt/.test(popup) && /Math\.imul/.test(popup));
// Registration only fires on the NEXT load; the tab in front of the owner
// needs the script now.
check('connect injects the bridge into the open tab immediately',
  /executeScript\(\{ target: \{ tabId \}, files: \['content-bridge\.js'\] \}\)/.test(popup));
check('a refused injection degrades to "reload the tab", not to an error',
  /async function injectNow/.test(popup) && /return false/.test(popup) && /רעננו את הטאב/.test(popup));
check('a repeat injection re-announces instead of doubling the relay listener',
  /__tzBridgeV2/.test(content));

const ensureFn = (popup.match(/async function ensureRegistered[\s\S]*?\n\}/) || [''])[0];
check('a second connect on a live site succeeds (duplicate id re-probed, not thrown)',
  /registerContentScripts\(/.test(ensureFn) &&
  (ensureFn.match(/getRegisteredContentScripts/g) || []).length >= 2 &&
  (ensureFn.match(/catch\(\(\) => \[\]\)/g) || []).length >= 2);

// Firefox binds permissions.request to the tick of the click; an await before
// it drops the gesture and the call throws.
const connectFn = (popup.match(/\$\('connect'\)\.addEventListener\('click'[\s\S]*?\n\}\);/) || [''])[0];
check('permissions.request for the site is the FIRST await in the click handler',
  /await B\.permissions\.request/.test(connectFn) &&
  !/await/.test(connectFn.split('await B.permissions.request')[0]));
check('the loopback grant is prefetched at popup open, so its request is gesture-safe too',
  /localGranted/.test(popup) && !/await B\.permissions\.contains/.test(popup));

// ── connected sites: see them, drop them ──
check('popup lists the registered bridge scripts (unfiltered query, defensive catch)',
  /getRegisteredContentScripts\(\)/.test(popup) && /function listBridgeScripts/.test(popup));
check('disconnect unregisters the script AND hands the host permission back',
  /unregisterContentScripts\(\{ ids: \[id\] \}\)/.test(popup) &&
  /permissions\.remove\(\{ origins \}\)/.test(popup));
// A Tapuziel served from localhost yields the pattern the RELAY runs on:
// handing that back on disconnect would cut the model off with the site.
check('disconnect never hands loopback back',
  /matches\.filter\(\(m\) => !LOCAL_ORIGINS\.includes\(m\)\)/.test(popup));
check('the list renders on popup open', /^renderSites\(\);/m.test(popup) &&
  /id="sites"/.test(popupHtml) && /\$\('sites'\)/.test(popup));

// ── the popup still reads as a popup: narrow, RTL, three steps ──
check('popup stays 300px RTL Hebrew', /dir="rtl"/.test(popupHtml) && /width: 300px/.test(popupHtml));
check('the three-step hosted flow is spelled out in the popup',
  /LM Studio/.test(popupHtml) && /חבר את האתר הפתוח/.test(popupHtml) && /חיבור AI/.test(popupHtml));

// ── the README tells the hosted story, not a localhost one ──
check('README names the site-side option, the disconnect, and WHY the relay exists',
  /דרך הדפדפן \(Bridge V2\)/.test(readme) && /נתק/.test(readme) && /CORS/.test(readme));

// ── the CMS side speaks the same protocol ──
const cmsBridge = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-bridge.js'), 'utf8');
check('page glue and extension agree on message names',
  ['tz-bridge-hello', 'tz-bridge-ping', 'tz-local-llm', 'tz-local-llm-result']
    .every((t) => cmsBridge.includes(t) && content.includes(t)));

console.log('');
console.log(fail ? 'SMOKE EXTENSION-V2A: FAIL' : 'SMOKE EXTENSION-V2A: PASS');
process.exit(fail ? 1 : 0);
