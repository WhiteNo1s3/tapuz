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
 *
 * The streaming class of bug (v0.4.0): an MV3 worker dies in silence, so the
 * relay streams internally — but the page must not be able to tell. The pins
 * below hold that line: the flags are the worker's, the SSE parse survives a
 * frame cut in half, and what comes back is byte-for-byte the shape the CMS
 * already parsed before streaming existed.
 *
 * The lost-tool-call class of bug (v0.5.0, Ben: "I needed 2 turns to get a
 * respond that not related to the conversation"): a streamed tool call rides
 * `delta.tool_calls`, not `delta.content`, and 0.4.0 dropped it — every
 * list_pages / read_page / edit_page came back as an empty reply. And a 400
 * from LM Studio (the prompt outgrew the loaded window) was collapsed into
 * the string 'no response', hiding the numbers the CMS needs to shrink and
 * retry. The worker is RUN here, in a vm with a scripted SSE server, against
 * the frames measured from LM Studio — not just grepped.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
const cmsBridge = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-bridge.js'), 'utf8');
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
check('version >= 0.4.0 (hosted-site flow + streaming relay)', cmpSemver(manifest.version, '0.4.0') >= 0);
check('version >= 0.5.0 (streamed tool calls, error bodies, the window probe)', cmpSemver(manifest.version, '0.5.0') >= 0);

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
check('closed path list (chat/completions + the two model lists only)',
  /ALLOWED_PATHS = \['\/v1\/chat\/completions', '\/v1\/models', '\/api\/v0\/models'\]/.test(bg));
// LM Studio's native list is the only place `loaded_context_length` lives;
// it answers at once, so it rides sendMessage like /v1/models — never the port.
check('/api/v0/models has the probe timeout and stays off the port',
  /TIMEOUT_MS = \{ '\/v1\/models': 15000, '\/api\/v0\/models': 15000 \}/.test(bg) &&
  /if \(msg\.path === CHAT_PATH\) return relayViaPort/.test(content) &&
  /return relayViaMessage\(msg\.id, msg\.path, msg\.body\)/.test(content));
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
check('the list renders on popup open — after the worker reconciled the record',
  /^restoreSitesNow\(\)\.then\(\(r\) => \{\s*renderSites\(\);/m.test(popup) &&
  /id="sites"/.test(popupHtml) && /\$\('sites'\)/.test(popup));

// ── connected sites survive a Reload (0.5.2) ──
// The tracked manifest names no site (the repo is public; a *.hostingersite
// hostname is refused by .gitleaks.toml), so the live site rides a DYNAMIC
// registration — and that went dark after `git pull` + Reload. The worker
// keeps its own record and puts the sites back on every boot.
check('version >= 0.5.2 (the connected-sites record + the two silence ceilings)', cmpSemver(manifest.version, '0.5.2') >= 0);
check('the tracked manifest still names NO site and no content_scripts (hostnames are the owner\'s, not the repo\'s)',
  !manifest.content_scripts && !JSON.stringify(manifest).includes('hostingersite'));
check('worker and popup agree on the record key and the id prefix',
  /SITES_KEY = 'sites'/.test(bg) && /SITES_KEY = 'sites'/.test(popup) &&
  /SCRIPT_PREFIX = 'tz-bridge-'/.test(bg) && /SCRIPT_PREFIX = 'tz-bridge-'/.test(popup));
check('the worker reconciles the record on EVERY boot (top-level call, not only onInstalled)',
  /^const restoring = restoreSites\(\)/m.test(bg) && /async function restoreSites/.test(bg));
check('the worker never asks for a permission itself (that is the owner\'s click in the popup)',
  !/permissions\.request/.test(bg) && /hasSitePermission/.test(bg));
check('the worker registers EXACTLY what the popup registers (one shape, two writers)',
  /js: \['content-bridge\.js'\], matches: \[pattern\], runAt: 'document_idle', persistAcrossSessions: true/.test(bg) &&
  /js: \['content-bridge\.js'\],\s*matches: \[pattern\],\s*runAt: 'document_idle',\s*persistAcrossSessions: true/.test(popup));
check('popup writes the record on connect and forgets it BEFORE unregistering on disconnect',
  /await rememberSite\(scriptIdFor\(site\.pattern\), site\.pattern\)/.test(popup) &&
  /async function disconnectSite[\s\S]*?await forgetSite\(id\);[\s\S]*?unregisterContentScripts/.test(popup));
check('popup shows a recorded site that is not live with a "reconnect" (gesture-first permissions.request)',
  /live: false/.test(popup) && /חבר מחדש/.test(popup) &&
  /async function reconnectSite\(pattern\) \{\s*status\([^)]*\);\s*let granted;\s*try \{\s*granted = await B\.permissions\.request/.test(popup) &&
  /\.stale/.test(popupHtml));
check('README tells the 0.5.2 story (record, Reload, reconnect)',
  /0\.5\.2/.test(readme) && /storage\.local/.test(readme) && /חבר מחדש/.test(readme) && /Reload/.test(readme));

// ── the open tab comes back after a Reload (0.5.5) ──
// Measured on Chrome 148 (HARD-BATTERY-v2, "reconnect is flaky after sync"):
// a Reload orphans the content script in every open admin tab — its
// chrome.runtime.id is undefined, connect/sendMessage throw "Extension
// context invalidated" — yet it kept answering pings and swallowed requests.
check('version >= 0.5.5 (the open tab is revived on boot; an orphaned bridge retires)', cmpSemver(manifest.version, '0.5.5') >= 0);
check('the worker re-injects the bridge into the connected sites\' open tabs after reconciling the record',
  /async function reviveOpenTabs\(patterns\)/.test(bg) && /B\.tabs\.query\(\{ url: patterns \}\)/.test(bg) &&
  /executeScript\(\{ target: \{ tabId: t\.id \}, files: \['content-bridge\.js'\] \}\)/.test(bg) &&
  /out\.revived = await reviveOpenTabs\(await connectedPatterns\(\)\)/.test(bg));
check('the patterns it revives are the live registrations AND the sites the download wired into the manifest',
  /async function connectedPatterns/.test(bg) && /getManifest\(\)\.content_scripts/.test(bg) && /liveBridgeScripts\(\)/.test(bg));
check('no `tabs` permission is asked for (the host grant is what lets tabs.query see the tab)',
  !(manifest.permissions || []).includes('tabs'));
check('the content bridge asks alive() before answering anything, and a dead copy retires (removes its listener, says bye once)',
  /function alive\(\)/.test(content) && /B\.runtime && B\.runtime\.id/.test(content) &&
  /if \(!alive\(\)\) return retire\(\);/.test(content) && /function retire\(\)/.test(content) &&
  /removeEventListener\('message', onMessage\)/.test(content) && /type: 'tz-bridge-bye'/.test(content));
check('every copy carries an instance id; a repeat injection in the same world re-announces under the FIRST copy\'s id',
  /const INSTANCE = /.test(content) && /window\.__tzBridgeV2Instance = INSTANCE/.test(content) &&
  /type: 'tz-bridge-hello', version: VERSION, instance: window\.__tzBridgeV2Instance \|\| ''/.test(content));
check('a fresh copy posts a takeover AFTER its hello, and an orphan hearing a takeover retires at once',
  /send\(\{ type: 'tz-bridge-takeover', instance: INSTANCE \}\)/.test(content) &&
  content.indexOf("announce();\n  // hello FIRST") < content.indexOf("send({ type: 'tz-bridge-takeover'") &&
  /msg\.type === 'tz-bridge-takeover' && msg\.instance !== INSTANCE && !alive\(\)\) retire\(\)/.test(content));
check('relayViaMessage cannot leak a synchronous throw out of the listener any more (the swallowed model-list probe)',
  /new Promise\(\(resolve\) => resolve\(B\.runtime\.sendMessage/.test(content));
check('the page glue tracks the instance, re-posts unheard requests to a new copy, and fails waiting requests after a bye with no successor',
  /instance: ''/.test(cmsBridge) && /function repost\(\)/.test(cmsBridge) && /if \(w\.heard\) return;/.test(cmsBridge) &&
  /m\.type === 'tz-bridge-bye'/.test(cmsBridge) && /BYE_GRACE_MS/.test(cmsBridge) && /failWaiting\(BYE_MESSAGE\)/.test(cmsBridge) &&
  /p\.heard = true;/.test(cmsBridge));
check('the popup tells the owner how many open tabs the worker revived', /revived/.test(popup) && /הגשר פעיל ב-/.test(popup));
check('README tells the 0.5.5 story (the orphaned tab, the bye, the revival on boot)',
  /0\.5\.5/.test(readme) && /tz-bridge-bye/.test(readme) && /Extension context invalidated/.test(readme));

// ── two silences (0.5.2): reading the prompt vs. stuck mid-stream ──
// Before the first frame the model is READING; the CMS gives its own local
// call 20 minutes (src/ai.js LOCAL_TIMEOUT_MS) and the bridge must not be the
// shorter leash. Mid-stream, two minutes of silence is a stuck model.
const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'ai.js'), 'utf8');
check('FIRST_FRAME_MS mirrors the server\'s LOCAL_TIMEOUT_MS (20 min); STREAM_IDLE_MS stays 2 min',
  /FIRST_FRAME_MS = 20 \* 60 \* 1000/.test(bg) && /STREAM_IDLE_MS = 120000/.test(bg) &&
  /LOCAL_TIMEOUT_MS = 20 \* 60 \* 1000/.test(aiSrc));
check('the watchdog picks the ceiling by what has FLOWED (0.5.4) — a tool call LM Studio delivers whole is not a stall',
  /const flowing = \(\) => \(content\.length \+ argChars\) > 0;/.test(bg) && /live \? STREAM_IDLE_MS : FIRST_FRAME_MS/.test(bg));
check('heartbeat and watchdog are armed BEFORE the request leaves (the page\'s ceiling is reset while the model reads)',
  (() => {
    const fn = (bg.match(/async function streamChat[\s\S]*?\n\}\n/) || [''])[0];
    const beatAt = fn.indexOf('const beat = setInterval');
    const bumpAt = fn.indexOf('bump();');
    const shootAt = fn.indexOf('res = await shoot(outgoing)');
    return beatAt > 0 && bumpAt > 0 && shootAt > 0 && beatAt < shootAt && bumpAt < shootAt;
  })());
check('a watchdog abort names WHICH silence it caught (still an AbortError)',
  /err\.name = 'AbortError'/.test(bg) && /tzReason/.test(bg) &&
  /FIRST_FRAME_REASON/.test(bg) && /STREAM_IDLE_REASON/.test(bg) &&
  /if \(timedOut && e && e\.name === 'AbortError'\) throw timedOut;/.test(bg));
check('the page glue\'s default ceiling is the server\'s 20 minutes, not a 180 s guess',
  /LOCAL_CALL_MS = 20 \* 60 \* 1000/.test(cmsBridge) && /timeoutMs \|\| LOCAL_CALL_MS/.test(cmsBridge) && !/180000/.test(cmsBridge));
check('the server sends timeoutMs with every modelCall and the route forwards it',
  /env\.timeoutMs = LOCAL_TIMEOUT_MS;/.test(aiSrc) &&
  /timeoutMs: out\.timeoutMs/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'copilot.js'), 'utf8')) &&
  /timeoutMs \|\| d\.timeoutMs/.test(cmsBridge));

// ── the popup still reads as a popup: narrow, RTL, three steps ──
check('popup stays 300px RTL Hebrew', /dir="rtl"/.test(popupHtml) && /width: 300px/.test(popupHtml));
check('the three-step hosted flow is spelled out in the popup',
  /LM Studio/.test(popupHtml) && /חבר את האתר הפתוח/.test(popupHtml) && /חיבור AI/.test(popupHtml));

// ── the README tells the hosted story, not a localhost one ──
check('README names the site-side option, the disconnect, and WHY the relay exists',
  /דרך הדפדפן \(Bridge V2\)/.test(readme) && /נתק/.test(readme) && /CORS/.test(readme));

// ── streaming (0.4.0) — the worker streams, nothing above it notices ──
// Measured: non-streaming, the worker sees ONE silent gap the length of the
// whole generation (9-13s for the organizer pack, 130s+ for a 44K-char one).
// Streaming, the longest mid-stream silence is 45-47ms.
check('the WORKER sets the streaming flags — never the page',
  /Object\.assign\(\{\}, body, \{\s*stream: true,\s*stream_options: \{ include_usage: true \}\s*\}\)/.test(bg) &&
  !/stream_options/.test(content) && !/stream_options/.test(popup) &&
  !/stream: true/.test(content) && !/stream: true/.test(popup));
// A frame WILL arrive cut in half, and Hebrew arrives 2-3 bytes at a time.
check('SSE frames are buffered across chunk boundaries (and UTF-8 is rejoined)',
  /buf \+= decoder\.decode\(step\.value, \{ stream: true \}\)/.test(bg) &&
  /buf\.indexOf\('\\n'\)/.test(bg) && /buf = buf\.slice\(nl \+ 1\)/.test(bg));
check('[DONE] terminates the stream', /'\[DONE\]'/.test(bg) && /DONE_FRAME/.test(bg));
check('the assembled reply is EXACTLY the non-streaming shape (tool_calls only when made)',
  /const message = \{ role, content, \.\.\.\(toolCalls\.length \? \{ tool_calls: toolCalls\.filter\(Boolean\) \} : \{\}\) \};/.test(bg) &&
  /choices: \[\{ index: 0, message, finish_reason: finishReason \}\]/.test(bg));
check('tool-call fragments are assembled by index (id/name once, arguments +=)',
  /Array\.isArray\(d\.tool_calls\)/.test(bg) && /toolCalls\[i\]/.test(bg) &&
  /slot\.function\.arguments \+= fn\.arguments/.test(bg));
check('progress counts streamed argument text (a document written INTO a tool call)',
  /argChars \+= fn\.arguments\.length/.test(bg) && /chars: content\.length \+ argChars/.test(bg));
check('a non-2xx body is returned as data, and the content bridge FORWARDS it',
  /return \{ ok: false, status: res\.status, data \};/.test(bg) &&
  /function failure\(m\)/.test(content) && /data: body/.test(content) &&
  /finish\(m\.ok \? \{ ok: true, status: m\.status, data: m\.data \} : failure\(m\)\)/.test(content));
check('the header explains the accumulation and the error-body forwarding (so nobody simplifies them away)',
  /delta\.tool_calls\[\]/.test(bg) && /ERROR BODIES ARE RESULTS/.test(bg) && /1× and 2×/.test(bg));
check('usage survives streaming (include_usage puts it in the last frame)',
  /frame\.usage/.test(bg) && /data\.usage = usage/.test(bg));
check('a server that ignores `stream` falls back to one JSON body, never a failure',
  /text\/event-stream/.test(bg) && /return await readWholeBody\(res\)/.test(bg));
// Not every OpenAI-compatible server knows stream_options; some 400 on an
// unknown param rather than ignoring it. Losing usage beats losing the call.
check('a 400 on stream_options is retried once without it',
  /text\.indexOf\('stream_options'\) !== -1/.test(bg) &&
  /shoot\(Object\.assign\(\{\}, body, \{ stream: true \}\)\)/.test(bg));
check('0.5.3: progress carries started + tool on every hop (worker → content script → page)',
  /say\(\{ type: 'progress', chars: p\.chars, tokens: p\.tokens, started: p\.started, tool: p\.tool \}\)/.test(bg) &&
  /type: 'tz-local-llm-progress', id, chars: m\.chars, tokens: m\.tokens, started: m\.started, tool: m\.tool/.test(content) &&
  /started: typeof m\.started === 'boolean' \? m\.started : undefined/.test(cmsBridge));
check('0.5.3: the first applied frame is posted at once (not on the next heartbeat)', /const announce = !announced && applied > 0;[\s\S]{0,80}post\(announce\);/.test(bg));
check('progress is throttled (~4/sec) and heartbeats through silence',
  /PROGRESS_MS = 250/.test(bg) && /HEARTBEAT_MS = 10000/.test(bg) &&
  /now - lastPost < PROGRESS_MS/.test(bg) &&
  /setInterval\(\(\) => post\(true\), HEARTBEAT_MS\)/.test(bg));
check('a stream caps SILENCE, not duration', /STREAM_IDLE_MS/.test(bg) && /bump\(\)/.test(bg));
check('the port aborts the in-flight fetch when the page goes away',
  /onDisconnect\.addListener\(\(\) => \{[\s\S]{0,160}ac\.abort\(\);/.test(bg));
check('posting to a closed port cannot throw', /try \{ port\.postMessage\(m\); \} catch/.test(bg));
check('port name agrees on both ends',
  /PORT_NAME = 'tz-llm'/.test(bg) && /PORT_NAME = 'tz-llm'/.test(content));
check('chat takes the port; /v1/models stays on sendMessage',
  /function relayViaPort/.test(content) && /runtime\.connect\(\{ name: PORT_NAME \}\)/.test(content) &&
  /function relayViaMessage/.test(content) && /runtime\.sendMessage\(\{ type: 'tz-local-llm'/.test(content));
check('the page-facing result message shape is unchanged',
  /Object\.assign\(\{ type: 'tz-local-llm-result', id \}, res\)/.test(content));
check('a dead worker answers the page instead of hanging it',
  /port\.onDisconnect\.addListener\(\(\) => finish\(/.test(content));

// ── the CMS side speaks the same protocol ──
check('page glue and extension agree on message names',
  ['tz-bridge-hello', 'tz-bridge-ping', 'tz-local-llm', 'tz-local-llm-result', 'tz-local-llm-progress']
    .every((t) => cmsBridge.includes(t) && content.includes(t)));

// ── the page glue, 0.5.0: version, window, error bodies as results ──
check('admin-bridge exposes the extension version from the hello',
  /version: ''/.test(cmsBridge) && /B\.version = m\.version/.test(cmsBridge));
check('admin-bridge probes the loaded window through /api/v0/models',
  /probeWindow: function/.test(cmsBridge) && /'\/api\/v0\/models'/.test(cmsBridge) &&
  /loaded_context_length/.test(cmsBridge) && /source: 'bridge'/.test(cmsBridge) &&
  /bridgeVersion: B\.version/.test(cmsBridge));
// LM Studio types chat models 'llm' OR 'vlm' (gemma-4-31b is 'vlm'); the
// probe must EXCLUDE embeddings, never ALLOW 'llm' alone.
check('the probe skips only the embeddings model (no `type === \'llm\'` allowlist)',
  /e\.type !== 'embeddings'/.test(cmsBridge) && !/type === 'llm'/.test(cmsBridge));
check('the probe settles into an event (null window when the bridge is older than 0.5.0)',
  /tapuz-bridge-window/.test(cmsBridge) && /return settle\(null\)/.test(cmsBridge) &&
  /\.then\(function \(\) \{ return B\.probeWindow\(\); \}\)/.test(cmsBridge));
check('a provider error body RESOLVES (the server judges it), a bodiless failure rejects with status',
  /if \(m\.data && m\.data\.error\) return w\.resolve\(m\.data\)/.test(cmsBridge) &&
  /err\.status = m\.status/.test(cmsBridge) && /err\.data = null/.test(cmsBridge) &&
  /err\.bridgeVersion = B\.version/.test(cmsBridge));
check('drive reports a bodiless HTTP failure as a relay_http_error step (network/timeout still reject)',
  /type: 'relay_http_error'/.test(cmsBridge) &&
  /typeof e\.status !== 'number' \|\| e\.data\) throw e/.test(cmsBridge));

/* ── RUN the worker: a scripted LM Studio behind a fake chrome ──
 * Everything above greps. This executes background.js in a vm, opens the
 * same port the content script opens, and feeds the SSE frames measured from
 * LM Studio (map.md, 2026-09-14) through a fake fetch — chunked at odd byte
 * offsets so frames AND Hebrew characters are cut in half on the way. */
function bootWorker(fetchImpl, opts = {}) {
  const listeners = { message: null, connect: null };
  const chrome = {
    runtime: {
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
      onConnect: { addListener: (fn) => { listeners.connect = fn; } }
    },
    storage: { local: opts.storage || { get: () => Promise.resolve({}) } },
    permissions: opts.permissions || { contains: () => Promise.resolve(true) }
  };
  if (opts.scripting) chrome.scripting = opts.scripting;
  if (opts.tabs) chrome.tabs = opts.tabs;
  if (opts.manifest) chrome.runtime.getManifest = () => opts.manifest;
  const ctx = {
    chrome, fetch: fetchImpl, TextDecoder, TextEncoder, AbortController, URL, JSON, Math, Date, Number, Array,
    Object, String, Promise, Set, Error, setTimeout: opts.setTimeout || setTimeout, clearTimeout, setInterval, clearInterval, console
  };
  vm.runInNewContext(bg, ctx, { filename: 'background.js' });
  return listeners;
}

/** A storage.local double with a real backing object. */
function fakeStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    data,
    get: (keys) => Promise.resolve(Object.fromEntries((keys || []).filter((k) => k in data).map((k) => [k, data[k]]))),
    set: (obj) => { Object.assign(data, obj); return Promise.resolve(); }
  };
}

/** A scripting API double: `registered` is the browser's live list;
 *  `injected` records every executeScript, `refuse` names tab ids that
 *  throw (a discarded tab, a privileged page). */
function fakeScripting(registered, opts = {}) {
  const live = (registered || []).slice();
  const calls = [];
  const injected = [];
  return {
    live, calls, injected,
    getRegisteredContentScripts: (filter) => Promise.resolve(
      filter && filter.ids ? live.filter((s) => filter.ids.includes(s.id)) : live.slice()),
    registerContentScripts: (scripts) => {
      calls.push(scripts);
      for (const s of scripts) {
        if (live.some((x) => x.id === s.id)) return Promise.reject(new Error('Duplicate script ID \'' + s.id + '\''));
        live.push(s);
      }
      return Promise.resolve();
    },
    executeScript: (args) => {
      if ((opts.refuse || []).includes(args.target.tabId)) return Promise.reject(new Error('Cannot access contents of the page'));
      injected.push(args);
      return Promise.resolve([{ frameId: 0, result: null }]);
    }
  };
}

/** A tabs API double: answers `query({ url })` with the tabs whose url
 *  matches one of the patterns (host + scheme, the way match patterns do). */
function fakeTabs(open) {
  const queries = [];
  const matches = (pattern, url) => {
    const m = /^(\*|https?):\/\/([^/]+)\/\*$/.exec(pattern);
    if (!m) return false;
    const u = new URL(url);
    return (m[1] === '*' || m[1] + ':' === u.protocol) && m[2] === u.hostname;
  };
  return {
    queries,
    query: (q) => {
      queries.push(q);
      const pats = Array.isArray(q.url) ? q.url : [q.url];
      return Promise.resolve(open.filter((t) => pats.some((p) => matches(p, t.url))));
    }
  };
}

/** Body → a Response-like object. `sse` streams the text in ragged chunks;
 *  `json` answers whole (the error-body and models-list cases). */
function fakeResponse(opts) {
  const enc = new TextEncoder();
  if (opts.sse !== undefined) {
    const bytes = enc.encode(opts.sse);
    let pos = 0;
    return {
      ok: true, status: 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
      body: {
        getReader: () => ({
          read: () => {
            if (pos >= bytes.length) return Promise.resolve({ done: true });
            const n = Math.min(37 + (pos % 11), bytes.length - pos); // ragged, never on a frame edge
            const value = bytes.slice(pos, pos + n);
            pos += n;
            return Promise.resolve({ done: false, value });
          },
          cancel: () => {}
        })
      },
      text: () => Promise.resolve(opts.sse)
    };
  }
  const text = JSON.stringify(opts.json);
  return {
    ok: opts.status >= 200 && opts.status < 300, status: opts.status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    body: null,
    text: () => Promise.resolve(text)
  };
}

/** Open the streaming port, send `start`, resolve on `done`. */
function driveViaPort(listeners, body) {
  return new Promise((resolve) => {
    let onMsg = null;
    const progress = [];
    const port = {
      name: 'tz-llm',
      onMessage: { addListener: (fn) => { onMsg = fn; } },
      onDisconnect: { addListener: () => {} },
      postMessage: (m) => {
        if (m.type === 'progress') progress.push(m);
        if (m.type === 'done') resolve({ done: m, progress });
      }
    };
    listeners.connect(port);
    onMsg({ type: 'start', path: '/v1/chat/completions', body });
  });
}

const chunk = (delta, finish) => 'data: ' + JSON.stringify({
  id: 'chatcmpl-x', object: 'chat.completion.chunk', created: 1757800000, model: 'google/gemma-4-31b',
  choices: [{ index: 0, delta, finish_reason: finish || null }]
}) + '\n\n';
const USAGE = { prompt_tokens: 15179, completion_tokens: 21, total_tokens: 15200 };
const usageFrame = 'data: ' + JSON.stringify({
  id: 'chatcmpl-x', object: 'chat.completion.chunk', created: 1757800000, model: 'google/gemma-4-31b',
  choices: [], usage: USAGE
}) + '\n\n';
const ARGS = '{"slug": "בית", "source": "# דף\\n"}';
// frame 1: id/type/name with empty arguments; then the arguments in three
// string pieces (one cut inside a Hebrew word); then the finish; then usage.
const TOOL_STREAM =
  chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'read_page', arguments: '' } }] }) +
  chunk({ tool_calls: [{ index: 0, type: 'function', function: { arguments: ARGS.slice(0, 11) } }] }) +
  ': keepalive\n\n' +
  chunk({ tool_calls: [{ index: 0, type: 'function', function: { arguments: ARGS.slice(11, 24) } }] }) +
  chunk({ tool_calls: [{ index: 0, type: 'function', function: { arguments: ARGS.slice(24) } }] }) +
  chunk({}, 'tool_calls') +
  usageFrame +
  'data: [DONE]\n\n';
const TEXT_STREAM =
  chunk({ role: 'assistant', content: 'שלום' }) + chunk({ content: ' עולם' }) + chunk({}, 'stop') + usageFrame + 'data: [DONE]\n\n';
const EXCEED = { error: {
  code: 400, type: 'exceed_context_size_error',
  message: 'request (17246 tokens) exceeds the available context size (8192 tokens), try increasing it',
  n_prompt_tokens: 17246, n_ctx: 8192
} };

(async () => {
  // (1) a streamed tool call comes back whole, in the non-streaming shape
  {
    const sent = [];
    const L = bootWorker((url, init) => { sent.push({ url, init }); return Promise.resolve(fakeResponse({ sse: TOOL_STREAM })); });
    const { done, progress } = await driveViaPort(L, { model: 'google/gemma-4-31b', messages: [{ role: 'user', content: 'שלום' }] });
    const msg = done.data && done.data.choices && done.data.choices[0] && done.data.choices[0].message;
    const tc = msg && msg.tool_calls && msg.tool_calls[0];
    check('vm: the worker set stream + include_usage on the outgoing call',
      sent.length === 1 && (() => { const b = JSON.parse(sent[0].init.body); return b.stream === true && b.stream_options && b.stream_options.include_usage === true; })());
    check('vm: streamed tool call → message.tool_calls[0] with id/type/name', !!tc && tc.id === 'call_9' && tc.type === 'function' && tc.function.name === 'read_page');
    let parsed = null;
    try { parsed = JSON.parse(tc.function.arguments); } catch (e) { /* stays null */ }
    check('vm: arguments split across three frames (and a Hebrew word cut mid-byte) rejoin to the exact text',
      !!tc && tc.function.arguments === ARGS && parsed && parsed.slug === 'בית');
    check('vm: content is \'\' and finish_reason is tool_calls', msg && msg.content === '' && done.data.choices[0].finish_reason === 'tool_calls');
    check('vm: usage rides through the stream intact', done.ok === true && done.status === 200 &&
      JSON.stringify(done.data.usage) === JSON.stringify(USAGE));
    check('vm: exactly one call assembled (three fragments, one slot)', msg.tool_calls.length === 1);
    const last = progress[progress.length - 1];
    check('vm: progress counted the argument characters (the page sees the document being written)',
      !!last && last.chars === ARGS.length && last.tokens === 3);
    // 0.5.3: LM Studio sends a tool call's name first and its text in one
    // frame at the end — `started` + `tool` let the page say "writing the
    // page" instead of "still reading" through that silence
    const firstStarted = progress.find((m) => m.started === true);
    check('vm (0.5.3): progress says started + which tool once a frame arrived',
      !!firstStarted && firstStarted.tool === 'read_page' &&
      progress.filter((m) => m.started === true).every((m) => m.tool === 'read_page') && last.started === true);
  }
  // (2) a plain text stream keeps the 0.4.0 shape — no tool_calls key at all
  {
    const L = bootWorker(() => Promise.resolve(fakeResponse({ sse: TEXT_STREAM })));
    const { done } = await driveViaPort(L, { messages: [] });
    const msg = done.data.choices[0].message;
    check('vm: a text stream yields { role, content } with NO tool_calls key',
      msg.content === 'שלום עולם' && msg.role === 'assistant' && !('tool_calls' in msg) &&
      done.data.choices[0].finish_reason === 'stop' && done.data.object === 'chat.completion');
  }
  // (3) the 400 with the numbers in it is returned as data, not swallowed
  {
    const L = bootWorker(() => Promise.resolve(fakeResponse({ status: 400, json: EXCEED })));
    const { done } = await driveViaPort(L, { messages: [] });
    check('vm: a 400 JSON body → { ok:false, status:400, data.error.type === exceed_context_size_error }',
      done.ok === false && done.status === 400 && done.data && done.data.error &&
      done.data.error.type === 'exceed_context_size_error' && done.data.error.n_ctx === 8192 && done.data.error.n_prompt_tokens === 17246);
  }
  // (4) /api/v0/models: allowed, a GET, over sendMessage
  {
    const sent = [];
    // `type:'vlm'` is what LM Studio 0.4.23 reports for gemma-4-31b (measured 2026-09-14)
    const models = { object: 'list', data: [{ id: 'google/gemma-4-31b', type: 'vlm', state: 'loaded', max_context_length: 262144, loaded_context_length: 8192 }] };
    const L = bootWorker((url, init) => { sent.push({ url, init }); return Promise.resolve(fakeResponse({ status: 200, json: models })); });
    const res = await new Promise((resolve) => {
      const keep = L.message({ type: 'tz-local-llm', path: '/api/v0/models' }, {}, resolve);
      check('vm: onMessage returns true (async sendResponse)', keep === true);
    });
    check('vm: /api/v0/models is served over sendMessage as a GET to loopback',
      sent.length === 1 && sent[0].url === 'http://127.0.0.1:1234/api/v0/models' && sent[0].init.method === 'GET' &&
      res.ok === true && res.data.data[0].loaded_context_length === 8192);
    const refused = await new Promise((resolve) => L.message({ type: 'tz-local-llm', path: '/api/v1/anything' }, {}, resolve));
    check('vm: an unlisted path is still refused before any fetch', refused.ok === false && /path not allowed/.test(refused.error) && sent.length === 1);
  }
  // (5) two tool calls in one reply, their fragments interleaved by index
  {
    const A1 = '{"slug": "בית"}';
    const A2 = '{"slug": "אודות", "source": "# אודות\\n"}';
    const TWO =
      chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_page', arguments: '' } }] }) +
      chunk({ tool_calls: [{ index: 0, function: { arguments: A1.slice(0, 6) } }] }) +
      chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'read_page', arguments: '' } }] }) +
      chunk({ tool_calls: [{ index: 1, function: { arguments: A2.slice(0, 9) } }, { index: 0, function: { arguments: A1.slice(6) } }] }) +
      chunk({ tool_calls: [{ index: 1, function: { arguments: A2.slice(9) } }] }) +
      chunk({}, 'tool_calls') + usageFrame + 'data: [DONE]\n\n';
    const L = bootWorker(() => Promise.resolve(fakeResponse({ sse: TWO })));
    const { done } = await driveViaPort(L, { messages: [] });
    const tcs = done.data.choices[0].message.tool_calls || [];
    check('vm: two interleaved tool calls land in their own slots, in index order, arguments whole',
      tcs.length === 2 && tcs[0].id === 'call_a' && tcs[0].function.arguments === A1 &&
      tcs[1].id === 'call_b' && tcs[1].function.name === 'read_page' && tcs[1].function.arguments === A2);
  }
  // (6) the server fails AFTER the 200: an error frame with no choices
  {
    const ERR_STREAM = 'data: ' + JSON.stringify({ error: { message: 'Model unloaded', type: 'model_unloaded' } }) + '\n\ndata: [DONE]\n\n';
    const L = bootWorker(() => Promise.resolve(fakeResponse({ sse: ERR_STREAM })));
    const { done } = await driveViaPort(L, { messages: [] });
    check('vm: an error frame inside the stream → { ok:false, data.error } (never an empty 200 reply)',
      done.ok === false && done.data && done.data.error && done.data.error.type === 'model_unloaded');
    const L2 = bootWorker(() => Promise.resolve(fakeResponse({ sse: 'data: {"error":"engine died"}\n\ndata: [DONE]\n\n' })));
    const r2 = (await driveViaPort(L2, { messages: [] })).done;
    check('vm: a string error frame is wrapped as { error: { message } }',
      r2.ok === false && r2.data.error.message === 'engine died');
    const L3 = bootWorker(() => Promise.resolve(fakeResponse({ sse: chunk({ role: 'assistant', content: 'חצי' }) + 'data: {"error":"cut"}\n\ndata: [DONE]\n\n' })));
    const r3 = (await driveViaPort(L3, { messages: [] })).done;
    check('vm: text already streamed wins over a trailing error frame (the partial reply is kept)',
      r3.ok === true && r3.data.choices[0].message.content === 'חצי');
  }

  /* ── RUN the record: a Reload that lost the registration, a 0.5.0 install
   * that predates the record, a site whose grant is gone ── */
  {
    const SITE = 'https://live.example/*';
    const OLD = 'https://old.example/*';
    const GONE = 'https://gone.example/*';
    const storage = fakeStorage({ sites: [
      { id: 'tz-bridge-live-1', pattern: SITE },          // recorded, not live any more → restore
      { id: 'tz-bridge-gone-1', pattern: GONE },          // recorded, grant revoked → leave, report
      { id: 'evil', pattern: SITE },                      // not ours (no prefix) → ignored
      { id: 'tz-bridge-bad', pattern: 'https://x/y/*' }   // not a host pattern → ignored
    ] });
    // the browser still holds ONE registration the record never saw (0.5.0)
    const scripting = fakeScripting([{ id: 'tz-bridge-old-1', matches: [OLD], js: ['content-bridge.js'] }]);
    const permissions = { contains: ({ origins }) => Promise.resolve(origins[0] !== GONE) };
    const L = bootWorker(() => Promise.reject(new Error('no fetch here')), { storage, scripting, permissions });
    // the boot-time restore is async — the popup's message waits for it, then reconciles once more
    const out = await new Promise((resolve) => L.message({ type: 'tz-restore-sites' }, {}, resolve));
    check('vm: a recorded site that is not registered any more is registered again AT BOOT — the popup\'s exact shape',
      scripting.calls.length === 1 && scripting.live.some((s) => s.id === 'tz-bridge-live-1' && s.matches[0] === SITE &&
        s.js[0] === 'content-bridge.js' && s.runAt === 'document_idle' && s.persistAcrossSessions === true));
    check('vm: a recorded site whose grant is gone is NOT registered (no permission request from the worker) and is reported',
      out.unpermitted.includes(GONE) && !scripting.live.some((s) => s.id === 'tz-bridge-gone-1'));
    check('vm: a live registration the record never saw (still held at boot) is adopted into the record',
      storage.data.sites.some((s) => s.id === 'tz-bridge-old-1' && s.pattern === OLD) &&
      !out.restored.includes(OLD) && scripting.live.filter((s) => s.id === 'tz-bridge-old-1').length === 1);
    check('vm: entries that are not ours (foreign id, non-host pattern) are ignored, never registered',
      !scripting.live.some((s) => s.id === 'evil' || s.id === 'tz-bridge-bad'));
    // a second reconcile is a no-op: nothing to restore, nothing duplicated
    const again = await new Promise((resolve) => L.message({ type: 'tz-restore-sites' }, {}, resolve));
    check('vm: reconciling twice registers nothing twice', again.restored.length === 0 && again.unpermitted.includes(GONE) &&
      scripting.live.filter((s) => s.id === 'tz-bridge-live-1').length === 1);
    // a worker without the scripting API (an older fake, or a broken build) must not throw at boot
    const L2 = bootWorker(() => Promise.reject(new Error('x')), { storage: fakeStorage({ sites: [{ id: 'tz-bridge-a', pattern: SITE }] }) });
    const out2 = await new Promise((resolve) => L2.message({ type: 'tz-restore-sites' }, {}, resolve));
    check('vm: a missing scripting API degrades to "nothing restored", not a crash', out2 && out2.restored.length === 0 && out2.revived === 0);
  }

  /* ── RUN the revival (0.5.5): the tabs that lived through the Reload ──
   * Two connected sites — one recorded (dynamic), one wired into the
   * manifest by the download — with three tabs open between them, one of
   * which refuses injection; an unrelated tab; a tab of a recorded site
   * whose grant is gone. The worker must inject into exactly the tabs of
   * the sites it serves, count them, and never throw. */
  {
    const LIVE = 'https://live.example/*';
    const WIRED = '*://wired.example/*';
    const GONE = 'https://gone.example/*';
    const storage = fakeStorage({ sites: [
      { id: 'tz-bridge-live-1', pattern: LIVE },
      { id: 'tz-bridge-gone-1', pattern: GONE }
    ] });
    const scripting = fakeScripting([], { refuse: [3] });
    const tabs = fakeTabs([
      { id: 1, url: 'https://live.example/admin/chat' },
      { id: 2, url: 'https://wired.example/admin/edit/home' },
      { id: 3, url: 'https://wired.example/admin' },          // refuses (discarded)
      { id: 4, url: 'https://unrelated.example/' },
      { id: 5, url: 'https://gone.example/admin/chat' }       // grant gone → not registered → not revived
    ]);
    const permissions = { contains: ({ origins }) => Promise.resolve(origins[0] !== GONE) };
    const manifest = { content_scripts: [{ matches: [WIRED], js: ['content-bridge.js'] }] };
    const L = bootWorker(() => Promise.reject(new Error('no fetch here')), { storage, scripting, tabs, permissions, manifest });
    const out = await new Promise((resolve) => L.message({ type: 'tz-restore-sites' }, {}, resolve));
    const askedFor = tabs.queries.length ? tabs.queries[0].url : [];
    check('vm (0.5.5): after the record is reconciled the worker asks for the open tabs of the live registrations AND the manifest-wired site',
      Array.isArray(askedFor) && askedFor.includes(LIVE) && askedFor.includes(WIRED) && !askedFor.includes(GONE));
    // the boot-time restore revived once already; the popup's message reconciles (and revives) again —
    // the SET of tabs is what matters, and a live tab takes a repeat as a re-announce
    const tabIds = [...new Set(scripting.injected.map((a) => a.target.tabId))].sort();
    check('vm (0.5.5): the content bridge is injected into every open tab of those sites (files: content-bridge.js), never into an unrelated tab or an unpermitted site\'s tab',
      JSON.stringify(tabIds) === JSON.stringify([1, 2]) && scripting.injected.every((a) => a.files[0] === 'content-bridge.js'));
    check('vm (0.5.5): a tab that refuses the injection is skipped, not fatal — and the count the popup shows is the tabs that took it',
      out.revived === 2 && scripting.live.some((s) => s.id === 'tz-bridge-live-1') && out.unpermitted.includes(GONE));
    // no tabs API at all (an older browser, a stripped build): nothing revived, nothing thrown
    const scripting2 = fakeScripting([]);
    const L2 = bootWorker(() => Promise.reject(new Error('x')), { storage: fakeStorage({ sites: [{ id: 'tz-bridge-live-1', pattern: LIVE }] }), scripting: scripting2 });
    const out2 = await new Promise((resolve) => L2.message({ type: 'tz-restore-sites' }, {}, resolve));
    check('vm (0.5.5): without a tabs API the restore still answers — the site registered, revived: 0',
      scripting2.live.some((s) => s.id === 'tz-bridge-live-1') && out2.revived === 0 && scripting2.injected.length === 0);
  }

  /* ── RUN the orphan (0.5.5): the content bridge whose extension was reloaded under it ──
   * Chrome's exact symptoms, as measured: runtime.id undefined, connect and
   * sendMessage throw "Extension context invalidated". */
  function bootBridge(win, chromeObj) {
    vm.runInNewContext(content, { window: win, chrome: chromeObj, Object, Promise, String, Math, Date, console }, { filename: 'content-bridge.js' });
  }
  function fakeWindow() {
    const posted = [];
    const listeners = [];
    const win = {
      location: { origin: 'https://site.example' },
      postMessage: (m) => posted.push(m),
      addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
      removeEventListener: (type, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }
    };
    // deliver like the browser would: every listener still registered, in order
    const deliver = (data) => listeners.slice().forEach((fn) => fn({ source: win, origin: win.location.origin, data }));
    return { win, posted, listeners, deliver };
  }
  const invalidated = () => { throw new Error('Extension context invalidated.'); };
  const deadChrome = { runtime: { id: undefined, connect: invalidated, sendMessage: invalidated } };
  const liveChrome = () => ({ runtime: {
    id: 'abcdefghijklmnopabcdefghijklmnop',
    connect: () => ({ onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, postMessage: () => {}, disconnect: () => {} }),
    sendMessage: () => Promise.resolve({ ok: true, status: 200, data: { data: [] } })
  } });
  {
    // (a) a live copy: hello carries an instance, then the takeover
    const f = fakeWindow();
    bootBridge(f.win, liveChrome());
    const hello = f.posted.find((m) => m.type === 'tz-bridge-hello');
    const takeover = f.posted.find((m) => m.type === 'tz-bridge-takeover');
    check('vm (0.5.5): a fresh copy announces hello (version + instance) and THEN a takeover with the same instance',
      !!hello && hello.version === manifest.version && typeof hello.instance === 'string' && hello.instance.length >= 8 &&
      !!takeover && takeover.instance === hello.instance && f.posted.indexOf(hello) < f.posted.indexOf(takeover));
    check('vm (0.5.5): the world remembers the instance for repeat injections', f.win.__tzBridgeV2 === manifest.version && f.win.__tzBridgeV2Instance === hello.instance);
    // a repeat injection in the same world (the worker's wake, the popup's connect): same instance, no second listener
    bootBridge(f.win, liveChrome());
    const hellos = f.posted.filter((m) => m.type === 'tz-bridge-hello');
    check('vm (0.5.5): a repeat injection re-announces under the FIRST instance id and installs no second listener',
      hellos.length === 2 && hellos[1].instance === hello.instance && f.listeners.length === 1 &&
      f.posted.filter((m) => m.type === 'tz-bridge-takeover').length === 1);
    // a takeover from ANOTHER instance while this copy is alive: ignored
    f.deliver({ source: 'tapuziel-bridge', type: 'tz-bridge-takeover', instance: 'someone-else' });
    check('vm (0.5.5): a live copy ignores another copy\'s takeover (only a dead one retires)',
      f.listeners.length === 1 && !f.posted.some((m) => m.type === 'tz-bridge-bye'));
  }
  /** Boot a copy against a living extension, then pull the rug the way a
   *  Reload does: the copy keeps the `chrome` object it read at load, and
   *  its bindings die under it. */
  function bootThenOrphan() {
    const c = liveChrome();
    const g = fakeWindow();
    bootBridge(g.win, c);
    g.instance = g.win.__tzBridgeV2Instance;
    Object.assign(c.runtime, deadChrome.runtime);
    g.posted.length = 0;
    return g;
  }
  {
    // (b) the orphan: its extension was reloaded → the next ping retires it
    const g = bootThenOrphan();
    const gInst = g.instance;
    g.deliver({ source: 'tapuziel-cms', type: 'tz-bridge-ping' });
    const bye = g.posted.find((m) => m.type === 'tz-bridge-bye');
    check('vm (0.5.5): an orphaned copy answers a ping with BYE (its own instance), never with a hello that lies',
      !!bye && bye.instance === gInst && !g.posted.some((m) => m.type === 'tz-bridge-hello'));
    check('vm (0.5.5): the orphan removed its listener and freed the world\'s guard', g.listeners.length === 0 && g.win.__tzBridgeV2 === null && g.win.__tzBridgeV2Instance === null);
    g.posted.length = 0;
    g.deliver({ source: 'tapuziel-cms', type: 'tz-local-llm', id: 'after', path: '/v1/models' });
    g.deliver({ source: 'tapuziel-cms', type: 'tz-bridge-ping' });
    check('vm (0.5.5): a retired copy never speaks again (no result, no bye twice)', g.posted.length === 0);
    // (c) the orphan meets a request first: bye, and NO result (the fresh copy or the glue's grace answers)
    const h = bootThenOrphan();
    h.deliver({ source: 'tapuziel-cms', type: 'tz-local-llm', id: 'swallowed', path: '/v1/chat/completions', body: {} });
    await new Promise((r) => setTimeout(r, 0));
    check('vm (0.5.5): an orphan handed a request says bye and posts NO result for it (nothing it says could be true)',
      h.posted.length === 1 && h.posted[0].type === 'tz-bridge-bye' && !h.posted.some((m) => m.type === 'tz-local-llm-result'));
    // (d) the takeover: a fresh copy lands in another world; the orphan hears it and retires without waiting for a request
    const k = bootThenOrphan();
    k.deliver({ source: 'tapuziel-bridge', type: 'tz-bridge-takeover', instance: 'fresh-copy' });
    check('vm (0.5.5): an orphan that hears a fresh copy\'s takeover retires at once (bye, listener gone)',
      k.posted.length === 1 && k.posted[0].type === 'tz-bridge-bye' && k.listeners.length === 0);
  }

  /* ── RUN the two silences: which ceiling is armed when ──
   * setTimeout is replaced with a recorder: the delay the worker asks for
   * before the first bytes must be the server's 20 minutes, and after the
   * first bytes the 2-minute idle ceiling. */
  {
    const delays = [];
    const recTimeout = (fn, ms) => { delays.push(ms); return setTimeout(fn, ms); };
    const L = bootWorker(() => Promise.resolve(fakeResponse({ sse: TEXT_STREAM })), { setTimeout: recTimeout });
    await driveViaPort(L, { messages: [] });
    check('vm: the FIRST watchdog armed (before any byte) is the 20-minute first-frame ceiling',
      delays.length > 1 && delays[0] === 20 * 60 * 1000);
    const firstIdle = delays.indexOf(120000);
    check('vm: once text flows the watchdog re-arms at the 2-minute idle ceiling (and never goes back to 20 minutes)',
      firstIdle > 0 && delays.slice(firstIdle).every((d) => d === 120000));
    // the abort path: a fetch that never answers, fired by the watchdog → the first-frame sentence
    {
      let fire = null;
      const instant = (fn, ms) => { if (ms === 20 * 60 * 1000) { fire = fn; return 0; } return setTimeout(fn, ms); };
      const L3 = bootWorker((url, init) => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      }), { setTimeout: instant });
      const p = driveViaPort(L3, { messages: [] });
      await new Promise((r) => setTimeout(r, 0));
      check('vm: the first-frame watchdog was armed before the fetch settled', typeof fire === 'function');
      fire();
      const { done } = await p;
      check('vm: a model that never starts answering fails with the first-frame sentence (20 minutes, no first token)',
        done.ok === false && /לא ענה בזמן/.test(done.error) && /20 דקות/.test(done.error) && /שום טקסט/.test(done.error));
    }
  }

  /* ── RUN the live failure (0.5.4): a tool call's opener, then silence ──
   * LM Studio sends the call's name with empty arguments when the model
   * stops reading, then nothing until the whole argument text lands. Live, an
   * 11-section page was cut at "הזרם שתק 2 דקות באמצע כתיבה". While only the
   * opener has arrived, every re-arm must stay the 20-minute ceiling. */
  {
    const delays = [];
    const recTimeout = (fn, ms) => { delays.push(ms); return setTimeout(fn, ms); };
    const OPENER_ONLY = chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_long', type: 'function', function: { name: 'create_page', arguments: '' } }] });
    const L = bootWorker(() => Promise.resolve(fakeResponse({ sse: OPENER_ONLY })), { setTimeout: recTimeout });
    await driveViaPort(L, { messages: [] });
    check('vm (0.5.4): after a tool call\'s opener frame with no arguments yet, the watchdog stays at 20 minutes (the page is being written)',
      delays.length > 1 && delays.every((d) => d === 20 * 60 * 1000));
    const delays2 = [];
    const rec2 = (fn, ms) => { delays2.push(ms); return setTimeout(fn, ms); };
    const L2 = bootWorker(() => Promise.resolve(fakeResponse({ sse: TOOL_STREAM })), { setTimeout: rec2 });
    await driveViaPort(L2, { messages: [] });
    check('vm (0.5.4): once the arguments arrive, a stall is caught at 2 minutes again',
      delays2.includes(120000) && delays2[delays2.length - 1] === 120000);
  }

  /* ── RUN the content bridge: the failure result carries `data` ──
   * A fake window + a fake port; the worker's `done` message is what the vm
   * run above produced for the 400. What reaches the page must carry the body. */
  {
    const posted = [];
    let portListener = null;
    let onWindowMessage = null;
    let connects = 0;
    const win = {
      location: { origin: 'https://site.example' },
      postMessage: (m) => posted.push(m),
      addEventListener: (type, fn) => { if (type === 'message') onWindowMessage = fn; }
    };
    const chrome = { runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop', // a LIVE extension has one (0.5.5: no id = orphaned = retire)
      connect: () => {
        connects++;
        return {
          onMessage: { addListener: (fn) => { portListener = fn; } },
          onDisconnect: { addListener: () => {} },
          postMessage: () => {}, disconnect: () => {}
        };
      },
      sendMessage: () => Promise.resolve({ ok: false, status: 400, data: EXCEED })
    } };
    vm.runInNewContext(content, { window: win, chrome, Object, Promise, String, Math, Date, console }, { filename: 'content-bridge.js' });
    const hello = posted.find((m) => m.type === 'tz-bridge-hello');
    check('vm: the content bridge announces its version', !!hello && hello.version === manifest.version);
    check('vm: the content bridge listens on window messages', typeof onWindowMessage === 'function');
    const ev = (data) => ({ source: win, origin: 'https://site.example', data });
    // chat → the port; the worker answers `done` with the 400 body
    onWindowMessage(ev({ source: 'tapuziel-cms', type: 'tz-local-llm', id: 'req-1', path: '/v1/chat/completions', body: {} }));
    check('vm: a chat request opened the port', connects === 1 && typeof portListener === 'function');
    portListener({ type: 'done', ok: false, status: 400, data: EXCEED });
    const res = posted.find((m) => m.type === 'tz-local-llm-result' && m.id === 'req-1');
    check('vm: content-bridge failure result carries data + the body\'s message as error',
      !!res && res.ok === false && res.status === 400 && res.data && res.data.error.type === 'exceed_context_size_error' &&
      /exceeds the available context size/.test(res.error));
    // the model list → sendMessage, never the port
    onWindowMessage(ev({ source: 'tapuziel-cms', type: 'tz-local-llm', id: 'req-2', path: '/api/v0/models' }));
    await new Promise((r) => setTimeout(r, 0));
    const res2 = posted.find((m) => m.type === 'tz-local-llm-result' && m.id === 'req-2');
    check('vm: /api/v0/models rode sendMessage and a failed body is forwarded the same way',
      connects === 1 && !!res2 && res2.ok === false && res2.status === 400 && res2.data && res2.data.error.n_ctx === 8192);
    // a foreign origin never reaches the relay
    onWindowMessage({ source: win, origin: 'https://evil.example', data: { source: 'tapuziel-cms', type: 'tz-local-llm', id: 'req-3', path: '/v1/chat/completions' } });
    check('vm: a cross-origin message is ignored', connects === 1 && !posted.some((m) => m.id === 'req-3'));
    // a string-shaped error body ({ error: "text" }, the other OpenAI-compatible shape)
    onWindowMessage(ev({ source: 'tapuziel-cms', type: 'tz-local-llm', id: 'req-4', path: '/v1/chat/completions', body: {} }));
    portListener({ type: 'done', ok: false, status: 500, data: { error: 'engine died' } });
    const res4 = posted.find((m) => m.type === 'tz-local-llm-result' && m.id === 'req-4');
    check('vm: a string error in the body becomes the error text (and the body still rides as data)',
      !!res4 && res4.ok === false && res4.status === 500 && res4.error === 'engine died' && res4.data.error === 'engine died');
    // no body at all (the worker's own preflight refusal): no status, no data, the text as is
    onWindowMessage(ev({ source: 'tapuziel-cms', type: 'tz-local-llm', id: 'req-5', path: '/v1/chat/completions', body: {} }));
    portListener({ type: 'done', ok: false, error: 'path not allowed: /x' });
    const res5 = posted.find((m) => m.type === 'tz-local-llm-result' && m.id === 'req-5');
    check('vm: a bodiless failure keeps its text and carries no status', !!res5 && res5.ok === false && res5.error === 'path not allowed: /x' && res5.status === undefined);
  }

  /* ── RUN the page glue: what /admin/chat and the drawer actually get ──
   * A fake window plays the extension: the page's own postMessage is what
   * the content bridge would see, and we answer as a 0.5.0 bridge first and
   * a 0.4.0 bridge second. */
  function bootGlue() {
    const outbox = [];
    const events = [];
    let onMsg = null;
    const win = {
      location: { origin: 'https://site.example' },
      postMessage: (m) => outbox.push(m),
      addEventListener: (type, fn) => { if (type === 'message') onMsg = fn; }
    };
    const bubbling = [];
    const document = { dispatchEvent: (e) => { events.push(e.type); if (e.bubbles) bubbling.push(e.type); return true; } };
    function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; this.bubbles = !!(init && init.bubbles); }
    const ctx = { window: win, document, CustomEvent, Map, Date, Error, Number, String, Array, Object, Promise, setTimeout, clearTimeout, console };
    vm.runInNewContext(cmsBridge, ctx, { filename: 'admin-bridge.js' });
    const B = win.TapuzBridge;
    // the extension talks back through the same window
    const answer = (m) => onMsg({ source: win, origin: win.location.origin, data: Object.assign({ source: 'tapuziel-bridge' }, m) });
    // find the page's request for a path (the newest one) and answer it
    const reply = (path, res) => {
      const req = outbox.filter((m) => m.type === 'tz-local-llm' && m.path === path).pop();
      if (!req) return false;
      answer(Object.assign({ type: 'tz-local-llm-result', id: req.id }, res));
      return true;
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return { B, outbox, events, bubbling, answer, reply, tick };
  }
  // The list as LM Studio 0.4.23 really answers it (curl, 2026-09-14): every
  // chat model on the box — gemma-4-31b included — is `type:'vlm'`, not 'llm';
  // only the nomic model is 'embeddings'. A filter that keeps 'llm' alone
  // drops the copilot's own model and the window stays unknown for good.
  const V0 = { object: 'list', data: [
    { id: 'text-embedding-nomic', type: 'embeddings', state: 'loaded', max_context_length: 2048, loaded_context_length: 2048 },
    { id: 'google/gemma-4-31b', type: 'vlm', state: 'loaded', max_context_length: 262144, loaded_context_length: 8192 },
    { id: 'qwen/qwen3.6-35b-a3b', type: 'vlm', state: 'not-loaded', max_context_length: 262144 }
  ] };
  {
    const g = bootGlue();
    check('glue: pings the bridge on load', g.outbox.some((m) => m.type === 'tz-bridge-ping'));
    g.answer({ type: 'tz-bridge-hello', version: '0.5.0' });
    check('glue: hello → present + version', g.B.present === true && g.B.version === '0.5.0' && g.events.includes('tapuz-bridge-hello'));
    // /v1/models lists every DOWNLOADED model; an unloaded one comes first here on purpose
    check('glue: hello asks /v1/models first', g.reply('/v1/models', { ok: true, status: 200, data: { data: [{ id: 'qwen/qwen3.6-35b-a3b' }, { id: 'google/gemma-4-31b' }] } }));
    await g.tick(); await g.tick();
    check('glue: models arrive, then the window probe goes out',
      g.B.models[0] === 'qwen/qwen3.6-35b-a3b' && g.events.includes('tapuz-bridge-models') &&
      g.outbox.some((m) => m.type === 'tz-local-llm' && m.path === '/api/v0/models'));
    g.reply('/api/v0/models', { ok: true, status: 200, data: V0 });
    await g.tick(); await g.tick();
    const w = g.B.window;
    check('glue: B.window = the loaded chat model (type vlm counts; embeddings skipped), source bridge, with the version',
      !!w && w.tokens === 8192 && w.maxTokens === 262144 && w.model === 'google/gemma-4-31b' && w.source === 'bridge' && w.bridgeVersion === '0.5.0' &&
      g.B.windowSettled === true && g.events.includes('tapuz-bridge-window') && g.B.loaded.length === 1);
    check('glue: the bridge events bubble (a listener on window hears them, not only document)',
      ['tapuz-bridge-hello', 'tapuz-bridge-models', 'tapuz-bridge-window'].every((t) => g.bubbling.includes(t)));
    // probeWindow with a loosely-typed model id
    const p = g.B.probeWindow('GEMMA-4-31B');
    g.reply('/api/v0/models', { ok: true, status: 200, data: V0 });
    check('glue: probeWindow matches the configured id loosely (suffix, any case)', (await p).model === 'google/gemma-4-31b');
    // two loaded chat models: a wanted id that matches nothing falls back to the FIRST loaded —
    // never to a later one by a length coincidence (a wanted id one char longer than an entry)
    const V0B = { object: 'list', data: [
      { id: 'google/gemma-4-31b', type: 'vlm', state: 'loaded', max_context_length: 262144, loaded_context_length: 32768 },
      { id: 'qwen/qwen3.8-27b', type: 'vlm', state: 'loaded', max_context_length: 262144, loaded_context_length: 8192 }
    ] };
    const p2 = g.B.probeWindow('qwen3.8-27b');
    g.reply('/api/v0/models', { ok: true, status: 200, data: V0B });
    check('glue: a suffix picks the second loaded model', (await p2).model === 'qwen/qwen3.8-27b' && g.B.window.tokens === 8192);
    const p3 = g.B.probeWindow('zzzzzzzzzzzzzzzzz');
    g.reply('/api/v0/models', { ok: true, status: 200, data: V0B });
    check('glue: an unmatched id (17 chars, one longer than the second entry) falls back to the first loaded, not the second',
      (await p3).model === 'google/gemma-4-31b' && g.B.window.tokens === 32768 && g.B.loaded.length === 2);
    // back to the one-model picture for the rest
    const p4 = g.B.probeWindow();
    g.reply('/api/v0/models', { ok: true, status: 200, data: V0 });
    await p4;
    // an error body RESOLVES
    const c1 = g.B.call('/v1/chat/completions', { messages: [] }, 5000);
    g.reply('/v1/chat/completions', { ok: false, status: 400, error: EXCEED.error.message, data: EXCEED });
    const r1 = await c1;
    check('glue: call() resolves a provider error body as a result', r1 && r1.error && r1.error.type === 'exceed_context_size_error');
    // a bodiless failure REJECTS with status
    const c2 = g.B.call('/v1/chat/completions', { messages: [] }, 5000);
    g.reply('/v1/chat/completions', { ok: false, status: 400, error: 'no response' });
    const e2 = await c2.then(() => null, (e) => e);
    check('glue: call() rejects a bodiless HTTP failure with status/data:null/bridgeVersion',
      !!e2 && e2.status === 400 && e2.data === null && e2.bridgeVersion === '0.5.0' && e2.message === 'no response');
    // a no-status failure rejects without status
    const c3 = g.B.call('/v1/chat/completions', { messages: [] }, 5000);
    g.reply('/v1/chat/completions', { ok: false, error: 'local model unreachable: fetch failed' });
    const e3 = await c3.then(() => null, (e) => e);
    check('glue: a network failure rejects with no status', !!e3 && !('status' in e3) && /unreachable/.test(e3.message));
    // drive: bodiless 400 → relay_http_error step; then the server ends the turn
    const posts = [];
    const post = (payload) => { posts.push(payload); return Promise.resolve({ ok: true, reply: 'סיימתי' }); };
    const dr = g.B.drive({ modelCall: { id: 'mc-1', body: { messages: [] } } }, post, 5000);
    await g.tick();
    g.reply('/v1/chat/completions', { ok: false, status: 400, error: 'no response' });
    const out = await dr;
    const step = posts[0] && posts[0].step;
    const sentChat = g.outbox.filter((m) => m.type === 'tz-local-llm' && m.path === '/v1/chat/completions').pop();
    check('glue: drive() fills an empty body.model with the LOADED chat model, not the first downloaded one (no JIT load at 8K)',
      !!sentChat && sentChat.body.model === 'google/gemma-4-31b');
    check('glue: drive() turns a bodiless 400 into a relay_http_error step and continues',
      out && out.reply === 'סיימתי' && step && step.id === 'mc-1' && step.result.error.type === 'relay_http_error' &&
      step.result.error.status === 400 && step.result.error.bridgeVersion === '0.5.0');
    // drive: an error body is posted as-is (the server judges it)
    posts.length = 0;
    const dr2 = g.B.drive({ modelCall: { id: 'mc-2', body: { messages: [] } } }, post, 5000);
    await g.tick();
    g.reply('/v1/chat/completions', { ok: false, status: 400, error: EXCEED.error.message, data: EXCEED });
    await dr2;
    check('glue: drive() posts an error body verbatim as the step result', posts[0].step.result === EXCEED || posts[0].step.result.error.n_ctx === 8192);
    // drive: a network failure still rejects
    const dr3 = g.B.drive({ modelCall: { id: 'mc-3', body: { messages: [] } } }, post, 5000);
    await g.tick();
    g.reply('/v1/chat/completions', { ok: false, error: 'extension unavailable' });
    check('glue: drive() still rejects a network/timeout failure', (await dr3.then(() => null, (e) => e)) !== null);
  }
  {
    // an OLD bridge (0.4.0): the probe is refused and the window stays unknown
    const g = bootGlue();
    g.answer({ type: 'tz-bridge-hello', version: '0.4.0' });
    g.reply('/v1/models', { ok: true, status: 200, data: { data: [{ id: 'm' }] } });
    await g.tick(); await g.tick();
    g.reply('/api/v0/models', { ok: false, error: 'path not allowed: /api/v0/models' });
    await g.tick(); await g.tick();
    check('glue: a 0.4.0 bridge → B.window null, still settled, event fired, version known',
      g.B.window === null && g.B.windowSettled === true && g.events.includes('tapuz-bridge-window') && g.B.version === '0.4.0');
  }
  /* ── the page glue and the Reload (0.5.5): instances, the bye, the re-post ── */
  {
    const g = bootGlue();
    g.answer({ type: 'tz-bridge-hello', version: manifest.version, instance: 'copy-A' });
    check('glue (0.5.5): the hello\'s instance is remembered', g.B.present === true && g.B.instance === 'copy-A');
    // settle the boot probes so the outbox only holds what this block sends
    g.reply('/v1/models', { ok: true, status: 200, data: { data: [] } });
    await g.tick(); await g.tick();
    g.reply('/api/v0/models', { ok: false, error: 'x' });
    await g.tick(); await g.tick();
    // a stale copy leaving is nobody's loss
    g.answer({ type: 'tz-bridge-bye', instance: 'copy-that-never-was' });
    check('glue (0.5.5): a bye from a copy that is not the current one is ignored', g.B.present === true && !g.events.includes('tapuz-bridge-bye'));
    // a repeat hello under the same instance (the worker's wake re-injects): no re-post
    const chat = g.B.call('/v1/chat/completions', { messages: [] }, 60000);
    const sent = () => g.outbox.filter((m) => m.type === 'tz-local-llm' && m.path === '/v1/chat/completions').length;
    const before = sent();
    g.answer({ type: 'tz-bridge-hello', version: manifest.version, instance: 'copy-A' });
    check('glue (0.5.5): a repeat hello under the SAME instance re-posts nothing', sent() === before);
    // the Reload: the orphan says bye (current instance) — present drops, a ping goes out, and the grace starts
    const pingsBefore = g.outbox.filter((m) => m.type === 'tz-bridge-ping').length;
    g.answer({ type: 'tz-bridge-bye', instance: 'copy-A' });
    check('glue (0.5.5): a bye from the CURRENT copy → present false, event fired, one re-ping',
      g.B.present === false && g.events.includes('tapuz-bridge-bye') &&
      g.outbox.filter((m) => m.type === 'tz-bridge-ping').length === pingsBefore + 1);
    const during = await Promise.race([chat.then(() => 'settled', () => 'rejected'), g.tick().then(() => 'pending')]);
    check('glue (0.5.5): the waiting chat request is NOT failed yet — the fresh copy gets its grace', during === 'pending');
    // the fresh copy (the worker injected it) announces under a new instance → the swallowed request is re-posted to it
    g.answer({ type: 'tz-bridge-hello', version: manifest.version, instance: 'copy-B' });
    check('glue (0.5.5): a hello from a NEW instance → present again, instance updated, and the unheard request is posted once more',
      g.B.present === true && g.B.instance === 'copy-B' && sent() === before + 1 &&
      g.outbox.filter((m) => m.type === 'tz-local-llm' && m.path === '/v1/chat/completions').slice(-1)[0].id ===
      g.outbox.filter((m) => m.type === 'tz-local-llm' && m.path === '/v1/chat/completions').slice(-2)[0].id);
    g.reply('/v1/chat/completions', { ok: true, status: 200, data: { choices: [{ message: { content: 'שלום' } }] } });
    check('glue (0.5.5): the re-posted request resolves normally', (await chat).choices[0].message.content === 'שלום');
    // a request the old copy DID take (progress arrived) is never re-posted: a second copy would run the GPU twice
    const heard = g.B.call('/v1/chat/completions', { messages: [] }, 60000, () => {});
    const req = g.outbox.filter((m) => m.type === 'tz-local-llm' && m.path === '/v1/chat/completions').pop();
    g.answer({ type: 'tz-local-llm-progress', id: req.id, chars: 0, tokens: 0 });
    const heardBefore = sent();
    g.answer({ type: 'tz-bridge-hello', version: manifest.version, instance: 'copy-C' });
    check('glue (0.5.5): a request that already reported progress is NOT re-posted to a new copy', sent() === heardBefore && g.B.instance === 'copy-C');
    g.reply('/v1/chat/completions', { ok: true, status: 200, data: { choices: [{ message: { content: 'x' } }] } });
    await heard;
    // no successor at all (the extension was removed, not reloaded): after the grace the waiting requests fail with "refresh"
    const alone = g.B.call('/v1/chat/completions', { messages: [] }, 60000);
    g.answer({ type: 'tz-bridge-bye', instance: 'copy-C' });
    const t0 = Date.now();
    const err = await alone.then(() => null, (e) => e);
    check('glue (0.5.5): a bye with no fresh copy behind it fails the waiting request after the grace (~2.5 s, not twenty minutes) with "refresh the page"',
      !!err && /נטען מחדש/.test(err.message) && /רעננו/.test(err.message) && Date.now() - t0 >= 2000 && Date.now() - t0 < 10000 && g.B.present === false);
  }

  console.log('');
  console.log(fail ? 'SMOKE EXTENSION-V2A: FAIL' : 'SMOKE EXTENSION-V2A: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL vm run threw: ' + (e && e.stack || e));
  console.log('');
  console.log('SMOKE EXTENSION-V2A: FAIL');
  process.exit(1);
});
