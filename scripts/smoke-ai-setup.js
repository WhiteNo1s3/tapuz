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
  /EXTENSION_DIRS = \{/.test(copilotRoute) &&
  /EXTENSION_DIRS\[req\.params\.which\]/.test(copilotRoute));
check('both extensions are offered (bridge + byot)',
  /extension-v2a/.test(copilotRoute) && /'extension'/.test(copilotRoute.match(/EXTENSION_DIRS = \{[\s\S]{0,400}\}/)[0]));
check('the local test endpoint refuses non-loopback addresses',
  /router\.post\('\/admin\/api\/ai\/test', requireAdmin/.test(copilotRoute) &&
  /resolveLocalEndpoint\(raw\)/.test(copilotRoute) &&
  /127\.0\.0\.1 \/ localhost/.test(copilotRoute));
check('the test hits the runtime\'s /models list',
  /replace\(\/\\\/\(chat\\\/\)\?completions\\\/\?\$\/, '\/models'\)/.test(copilotRoute));
check('the screen shows the tutorial images',
  /ai-tut-lmstudio\.jpg/.test(copilotRoute) && /ai-tut-connect\.jpg/.test(copilotRoute) &&
  /ai-tut-key\.jpg/.test(copilotRoute));

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
