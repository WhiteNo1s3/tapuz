'use strict';

/**
 * v2.15 QA — the חיבור AI screen (Ben's spec): Local AI setting, per-provider
 * create-a-key links, extension downloads, the picture tutorial, and the
 * copilot that stays HIDDEN until AI is actually configured.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let fail = false;
const check = (n, c) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (!c) fail = true; };

const root = path.join(__dirname, '..');
const copilotRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'copilot.js'), 'utf8');
// the per-browser build moved out of the route in v2.41, shared with scripts/update-bridge.js
const extensionBuildSrc = fs.readFileSync(path.join(root, 'src', 'extension-build.js'), 'utf8');
const builderRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'pages-builder.js'), 'utf8');
const adminUi = fs.readFileSync(path.join(root, 'src', 'admin-ui.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public', 'admin-ai-setup.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin.css'), 'utf8');

// ---- 1. the zip module actually produces a ZIP -----------------------------

const { zipDirectory, crc32 } = require('../src/zip-store');
check('crc32 matches a known vector ("123456789" -> cbf43926)',
  crc32(Buffer.from('123456789')).toString(16) === 'cbf43926');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-zip-'));
fs.writeFileSync(path.join(tmp, 'a.txt'), 'shalom');
fs.mkdirSync(path.join(tmp, 'sub'));
fs.writeFileSync(path.join(tmp, 'sub', 'b.txt'), 'olam');
const zip = zipDirectory(tmp, 'pack');
check('zip starts with the local-header signature PK\\x03\\x04',
  zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 0x03 && zip[3] === 0x04);
check('zip carries the prefixed entry names',
  zip.includes(Buffer.from('pack/a.txt')) && zip.includes(Buffer.from('pack/sub/b.txt')));
check('zip ends with an EOCD record', zip.readUInt32LE(zip.length - 22) === 0x06054b50);
fs.rmSync(tmp, { recursive: true, force: true });

// ---- 2. the routes ---------------------------------------------------------

check('GET /admin/ai-setup exists and is admin-gated',
  /router\.get\('\/admin\/ai-setup', requireAdmin/.test(copilotRoute));
check('the extension zip route is whitelist-keyed (no path from the param)',
  /EXTENSION_DIRS = \{/.test(extensionBuildSrc) &&
  /hasOwnProperty\.call\(EXTENSION_DIRS, which\)/.test(extensionBuildSrc) &&
  /extensionBuild\(req\.params\.which, req\.params\.browser, req\.hostname\)/.test(copilotRoute));
check('both extensions are offered (bridge + byot)',
  /extension-v2a/.test(extensionBuildSrc) && /'extension'/.test(extensionBuildSrc.match(/EXTENSION_DIRS = \{[\s\S]{0,400}\}/)[0]));

// ── per-browser builds (v2.18.1 — Ben's Firefox zips refused to install) ──
check('the download route serves one build per browser',
  /extension-:which-:browser\.zip/.test(copilotRoute) &&
  /const BROWSERS = \['chrome', 'firefox'\]/.test(extensionBuildSrc) && /BROWSERS\.includes\(browser\)/.test(extensionBuildSrc));
check('the zip is packed at ROOT (no wrapping folder — browsers reject those)',
  /zipDirectory\(build\.dir, '', \{/.test(copilotRoute));
check('chrome build strips the firefox-only manifest keys',
  /delete manifest\.browser_specific_settings/.test(extensionBuildSrc));
check('firefox build gets background.scripts when only a worker exists',
  /manifest\.background\.scripts = \[manifest\.background\.service_worker\]/.test(extensionBuildSrc));
check('the screen offers a plain button per browser, per extension',
  /extension-byot-chrome\.zip/.test(copilotRoute) && /extension-byot-firefox\.zip/.test(copilotRoute) &&
  /extension-bridge-chrome\.zip/.test(copilotRoute) && /extension-bridge-firefox\.zip/.test(copilotRoute));
check('the client marks the visitor\'s own browser on the matching buttons',
  /markBrowserButtons/.test(client) && /firefox\/i\.test\(navigator\.userAgent\)/.test(client) &&
  /data-ext-browser/.test(copilotRoute));
check('the Firefox honesty note is on the page (temporary load until signing)',
  /about:debugging/.test(copilotRoute) && /חתימת Mozilla/.test(copilotRoute));

// functional: a root-level zip with a manifest override really is root-level
{
  const os = require('os');
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-extzip-'));
  fs.writeFileSync(path.join(t2, 'manifest.json'), '{"name":"orig"}');
  fs.writeFileSync(path.join(t2, 'popup.html'), '<html>');
  const z = zipDirectory(t2, '', { 'manifest.json': '{"name":"override"}' });
  check('zip entries sit at the root (manifest.json, not folder/manifest.json)',
    z.includes(Buffer.from('manifest.json')) && !z.includes(Buffer.from('/manifest.json')));
  check('the manifest override replaces the on-disk content',
    z.includes(Buffer.from('{"name":"override"}')) && !z.includes(Buffer.from('{"name":"orig"}')));
  fs.rmSync(t2, { recursive: true, force: true });
}
// ── v2.34: the bridge ZIP arrives connected to the site it came from. A
//    tester's hand-patched manifest (their live host in content_scripts) sat
//    in a git checkout and every pull wiped it; the public repo can carry no
//    real hostname. The copy made FOR a site now carries that site. ──
{
  const { siteMatchPattern, wireBridgeToSite } = require('../src/bridge-manifest');
  const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension-v2a', 'manifest.json'), 'utf8'));
  check('the route wires the BRIDGE build (only) to req.hostname',
    /extensionBuild\(req\.params\.which, req\.params\.browser, req\.hostname\)/.test(copilotRoute) &&
    /if \(which === 'bridge'\) require\('\.\/bridge-manifest'\)\.wireBridgeToSite\(manifest, hostname\)/.test(extensionBuildSrc));
  const m = JSON.parse(JSON.stringify(src));
  const wired = wireBridgeToSite(m, 'My-Site.example.com');
  check('a hosted site: one *:// pattern (both schemes, no port) in host_permissions + a content script on it',
    wired === '*://my-site.example.com/*' &&
    m.host_permissions.includes('*://my-site.example.com/*') &&
    m.host_permissions.includes('http://127.0.0.1/*') &&
    Array.isArray(m.content_scripts) && m.content_scripts.length === 1 &&
    m.content_scripts[0].matches.join() === '*://my-site.example.com/*' &&
    m.content_scripts[0].js.join() === 'content-bridge.js');
  check('wiring twice does not duplicate the host permission',
    (wireBridgeToSite(m, 'my-site.example.com'), m.host_permissions.filter((h) => h === '*://my-site.example.com/*').length === 1));
  const bad = ['localhost', '127.0.0.1', '[::1]', '', 'evil.com/*', '*.example.com', 'a b.com', 'host:8443', '-x.com', 'x'.repeat(300)];
  check('loopback, empty and pattern-bending hosts wire nothing (the popup stays the way in)',
    bad.every((h) => siteMatchPattern(h) === null) &&
    bad.every((h) => { const c = JSON.parse(JSON.stringify(src)); return wireBridgeToSite(c, h) === null && !c.content_scripts && c.host_permissions.join() === src.host_permissions.join(); }));
  check('a LAN IPv4 site wires like a DNS name', siteMatchPattern('192.168.1.20') === '*://192.168.1.20/*');
  check('the SOURCE manifest stays loopback-only (no host lives in the repo)',
    !src.content_scripts && src.host_permissions.every((h) => /localhost|127\.0\.0\.1/.test(h)));
  const popupJs = fs.readFileSync(path.join(__dirname, '..', 'extension-v2a', 'popup.js'), 'utf8');
  check('the popup lists a site wired by the download (it has no registration to disconnect)',
    /function builtInSites\(\)/.test(popupJs) && /getManifest\(\)\.content_scripts/.test(popupJs) && /'מההורדה'/.test(popupJs));
}
check('the local test endpoint refuses non-loopback addresses',
  /router\.post\('\/admin\/api\/ai\/test', requireAdmin/.test(copilotRoute) &&
  /resolveLocalEndpoint\(raw\)/.test(copilotRoute) &&
  /127\.0\.0\.1 \/ localhost/.test(copilotRoute));
check('the test hits the runtime\'s /models list',
  /replace\(\/\\\/\(chat\\\/\)\?completions\\\/\?\$\/, '\/models'\)/.test(copilotRoute));
check('the screen shows the tutorial images',
  /ai-tut-lmstudio\.jpg/.test(copilotRoute) && /ai-tut-connect\.jpg/.test(copilotRoute) &&
  /ai-tut-key\.jpg/.test(copilotRoute));

// ── v2.32: the window on the setup screen. Ben's copilot died on `request
//    (17246 tokens) exceeds the available context size (8192 tokens)` — the
//    GUI default. The ✅ line now says what window is loaded, and the bridge
//    card says what the extension probed (and nudges an old extension). ──
check('the connection test probes the LOADED context length (probeLocalWindow) and returns window + windowMessage',
  /probeLocalWindow\(raw, model\)/.test(copilotRoute) &&
  /res\.json\(\{ ok: true, endpoint, models, window, windowMessage \}\)/.test(copilotRoute));
check('the window probe can never fail the connection test (bonus line, try/catch)',
  /the window is a bonus on this line, never a failure/.test(copilotRoute));
check('GET /admin/api/ai/window serves the sentence to every screen (admin-gated, ?provider=browser for the bridge card)',
  /router\.get\('\/admin\/api\/ai\/window', requireAdmin/.test(copilotRoute) &&
  /q\.provider === 'browser' \|\| q\.provider === 'local'/.test(copilotRoute));
check('the ✅ line prints the window sentence from the server (never re-typed here)',
  /d\.windowMessage/.test(client) && /'\\n🪟 ' \+ d\.windowMessage/.test(client) && !/Context Length/.test(client));
check('the test sends the model name so the probe matches the configured model',
  /model: \$\('ai-local-model'\)\.value\.trim\(\)/.test(client));
check('the bridge card prints TapuzBridge.window after tapuz-bridge-window, planned as the browser courier',
  /tapuz-bridge-window/.test(client) && /TapuzBridge\.window/.test(client) &&
  /\/admin\/api\/ai\/window\?/.test(client) && /provider: 'browser'/.test(client));
check('an old extension gets the update nudge with the exact wording',
  /'גרסת התוסף: ' \+ esc\(v\) \+ ' — מומלץ לעדכן ל-' \+ BRIDGE_MIN/.test(client) && /BRIDGE_MIN = '0\.5\.0'/.test(client) &&
  /TapuzBridge\.version/.test(client));

// ---- 3. the tutorial images ship ------------------------------------------

for (const img of ['ai-tut-lmstudio.jpg', 'ai-tut-connect.jpg', 'ai-tut-key.jpg']) {
  check('public/demo/' + img + ' exists', fs.existsSync(path.join(root, 'public', 'demo', img)));
}

// ---- 4. per-provider CREATE-A-KEY links (not the paste page) ---------------

const providers = require('../src/providers');
check('claude ships its create-key URL (console.anthropic.com)',
  /console\.anthropic\.com/.test(providers.getProvider('claude').keyUrl));
check('openai ships its create-key URL (platform.openai.com)',
  /platform\.openai\.com/.test(providers.getProvider('openai').keyUrl));
check('the client renders keyUrl as the "create one yourself" link',
  /keyUrl/.test(client) && /יצירת מפתח אצל/.test(client));
check('the client never echoes a stored key (tail only)',
  /keyTail/.test(client) && !/settings\.apiKey/.test(client));

// ---- 5. the copilot hides until configured ---------------------------------

check('pages-builder computes aiConfigured from key/local/browser',
  /aiConfigured = aiSettings\.hasKey \|\|/.test(builderRoute) &&
  /provider === 'local' \|\| aiSettings\.provider === 'browser'/.test(builderRoute));
check('the copilot button renders ONLY when configured',
  /\$\{aiConfigured\s*\n?\s*\? '<button type="button" id="btn-copilot"/.test(builderRoute.replace(/\r/g, '')));
check('the drawer script tolerates a missing button (null-safe bind)',
  /var btn = document\.getElementById\('btn-copilot'\);\s*\n\s*if \(btn\)/.test(
    fs.readFileSync(path.join(root, 'public', 'admin-copilot-panel.js'), 'utf8').replace(/\r/g, '')));

// ---- 6. nav + citrus orange ------------------------------------------------

check('the AI nav family carries חיבור AI', /ai-setup/.test(adminUi) && /חיבור AI/.test(adminUi));
check('citrus tokens are ORANGE, not sand (bg orange-200, border orange-400)',
  /--bc-bg: #fed7aa/.test(css) && /--bc-border: #fb923c/.test(css) &&
  /--bc-muted: #c2410c/.test(css));

console.log('');
console.log(fail ? 'SMOKE AI-SETUP: FAIL' : 'SMOKE AI-SETUP: PASS');
process.exit(fail ? 1 : 0);
