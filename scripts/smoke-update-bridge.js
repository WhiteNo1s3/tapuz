'use strict';

/**
 * v2.41 QA — a developer's Bridge folder updates with one command.
 *
 * Ben: "the bridge won't update in my own folder … why the folder won't
 * update?" Chrome loaded the Bridge from `extension-v2a/` inside a git
 * checkout 18 commits behind, patched by hand; new ZIPs landed in Downloads
 * as "(2).zip" and never reached it. Now the Bridge lives outside any
 * checkout and scripts/update-bridge.js fills it.
 *
 * Pinned:
 *   1. the ZIP route and the updater share ONE build (src/extension-build.js):
 *      the folder's files are the ZIP's entries, byte for byte, per browser
 *   2. the updater: install, up to date (a Finder .DS_Store changes nothing),
 *      a stale folder replaced with the old copy kept, the site remembered
 *   3. refusals: a folder inside a git checkout (the original trap), an
 *      extension folder passed as home, a folder that is not a Bridge, a
 *      loopback or pattern-bending --site
 *   4. --git and the launcher, against a local origin: the build comes from
 *      origin/main — not the clone's branch or its hand-patched working tree,
 *      which stay untouched — and the launcher runs the NEWEST updater
 *   5. (2026-09-22) the Firefox .xpi beside the folder is the site's own
 *      Firefox download (Ben zipped the Chrome folder and Firefox refused
 *      it), kept current without being rewritten; and the default home is
 *      the platform's app-data folder, not ~/Tapuziel Bridge in the open —
 *      the old folder's site carried over on the first run
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const root = path.join(__dirname, '..');
const SCRIPT = path.join(__dirname, 'update-bridge.js');
const SITE = 'owner-site.example.com';
const { extensionBuild, buildFiles } = require('../src/extension-build');
const { zipDirectory } = require('../src/zip-store');

/** A STORE zip's entries, in order: [{ rel, data }] */
function zipEntries(buf) {
  const out = [];
  let at = 0;
  while (at + 30 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const rel = buf.slice(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + extraLen;
    out.push({ rel, data: buf.slice(start, start + size) });
    at = start + size;
  }
  return out;
}
const sameEntries = (a, b) => a.length === b.length && a.every((e, i) => e.rel === b[i].rel && e.data.equals(b[i].data));
/** What the download route serves for this build (the route is pinned to exactly this call below). */
const routeZip = (build) => zipEntries(zipDirectory(build.dir, '', { 'manifest.json': build.manifestText }));
function folderEntries(dir) {
  const out = [];
  (function walk(cur, rel) {
    for (const name of fs.readdirSync(cur).sort()) {
      const full = path.join(cur, name);
      if (fs.statSync(full).isDirectory()) walk(full, rel + name + '/');
      else out.push({ rel: rel + name, data: fs.readFileSync(full) });
    }
  })(dir, '');
  return out;
}
const byName = (list) => list.slice().sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
const manifestIn = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-update-bridge-'));
const emptyConfig = path.join(tmp, 'gitconfig');
fs.writeFileSync(emptyConfig, '');
// the owner's own git config (signing, hooks, a default branch) stays out of the fixture
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'smoke', GIT_AUTHOR_EMAIL: 'smoke@example.invalid',
  GIT_COMMITTER_NAME: 'smoke', GIT_COMMITTER_EMAIL: 'smoke@example.invalid'
};
const update = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env });
const hasGit = spawnSync('git', ['--version'], { env }).status === 0;

try {
  // ── 1. one build for the ZIP and the folder ──
  {
    const copilotRoute = fs.readFileSync(path.join(root, 'src', 'routes', 'copilot.js'), 'utf8');
    check('the download route zips extensionBuild(which, browser, req.hostname) — the build the updater writes',
      /extensionBuild\(req\.params\.which, req\.params\.browser, req\.hostname\)/.test(copilotRoute) &&
      /zipDirectory\(build\.dir, '', \{ 'manifest\.json': build\.manifestText \}\)/.test(copilotRoute) &&
      !/wireBridgeToSite|browser_specific_settings/.test(copilotRoute));
    check('the build is whitelist keyed: no prototype key, no unknown browser',
      ['__proto__', 'constructor', 'toString', '../extension'].every((w) => extensionBuild(w, 'chrome', SITE) === null) &&
      extensionBuild('bridge', 'safari', SITE) === null);
    const cases = [['bridge', 'chrome', SITE], ['bridge', 'firefox', SITE], ['bridge', 'chrome', 'localhost'], ['byot', 'chrome', SITE]];
    check('buildFiles() is the ZIP\'s entries — names, order, bytes — for the Bridge on both browsers, a loopback build and the companion',
      cases.every(([w, b, h]) => { const build = extensionBuild(w, b, h); return sameEntries(buildFiles(build), routeZip(build)); }));
    const chrome = extensionBuild('bridge', 'chrome', SITE).manifest;
    const firefox = extensionBuild('bridge', 'firefox', SITE).manifest;
    check('…and it still tailors per browser and wires the Bridge (Chrome: no gecko keys, worker only; Firefox: both; the site on both)',
      !chrome.browser_specific_settings && !chrome.background.scripts && !!firefox.browser_specific_settings &&
      Array.isArray(firefox.background.scripts) &&
      [chrome, firefox].every((m) => m.content_scripts[0].matches.join() === '*://' + SITE + '/*') &&
      !extensionBuild('byot', 'chrome', SITE).manifestText.includes(SITE));
  }

  // ── 2. the updater, from this tree ──
  const home = path.join(tmp, 'Tapuziel Bridge');
  const ext = path.join(home, 'extension');
  const want = byName(routeZip(extensionBuild('bridge', 'chrome', SITE)));
  const version = want.length && JSON.parse(want.find((e) => e.rel === 'manifest.json').data).version;
  {
    const r = update(['--home', home, '--site', 'https://Owner-Site.example.com/admin/builder']);
    check('install (an admin URL as --site): exit 0, "installed", the Load unpacked step and the folder named',
      r.status === 0 && /Tapuziel Bridge [\d.]+ installed/.test(r.stdout) && r.stdout.includes('Load unpacked → ' + ext));
    check('the folder holds exactly the ZIP the site serves for that host', sameEntries(folderEntries(ext), want));
    const xpi = path.join(home, 'tapuziel-bridge-firefox.xpi');
    const ffWant = routeZip(extensionBuild('bridge', 'firefox', SITE));
    const xpiHas = () => (fs.existsSync(xpi) ? zipEntries(fs.readFileSync(xpi)) : []);
    const xpiManifest = () => { const e = xpiHas().find((x) => x.rel === 'manifest.json'); return e ? JSON.parse(e.data) : null; };
    check('beside it, the Firefox .xpi IS the site\'s Firefox download — same entries, same order, same bytes',
      sameEntries(xpiHas(), ffWant));
    check('…installable as it is: manifest at the root (no wrapping folder, no __MACOSX), the gecko id, background scripts, the site wired',
      xpiHas().every((e) => !e.rel.includes('/')) && !!xpiManifest() &&
      !!(xpiManifest().browser_specific_settings && xpiManifest().browser_specific_settings.gecko.id) &&
      Array.isArray(xpiManifest().background.scripts) &&
      xpiManifest().content_scripts[0].matches.join() === '*://' + SITE + '/*');
    check('the install output says how Firefox takes it (Developer Edition / Nightly / ESR, the about:config switch, Install Add-on From File)',
      /xpinstall\.signatures\.required = false/.test(r.stdout) && /Install Add-on From File/.test(r.stdout) && /Load Temporary Add-on/.test(r.stdout));
    const launcher = path.join(home, 'Update Bridge.command');
    const inGit = !!spawnSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { env }).stdout.toString().trim();
    if (inGit) {
      const text = fs.existsSync(launcher) ? fs.readFileSync(launcher, 'utf8') : '';
      check('a launcher sits next to it: executable, fetches origin/main, runs the NEWEST updater with the site',
        (fs.statSync(launcher).mode & 0o111) !== 0 && /^#!\/bin\/sh/.test(text) &&
        /fetch --quiet origin main/.test(text) && /cat-file blob origin\/main:scripts\/update-bridge\.js/.test(text) &&
        text.includes("--site '" + SITE + "'") && text.includes('--home "$HERE"'));
    }

    const mtime = fs.statSync(path.join(ext, 'manifest.json')).mtimeMs;
    const xpiMtime = fs.statSync(xpi).mtimeMs;
    fs.writeFileSync(path.join(ext, '.DS_Store'), 'finder');
    const again = update(['--home', home]);
    check('run again with no --site: "up to date", nothing rewritten, the site read back from the folder (and a Finder .DS_Store is not a change)',
      again.status === 0 && /is up to date/.test(again.stdout) && again.stdout.includes('site:   ' + SITE) &&
      fs.statSync(path.join(ext, 'manifest.json')).mtimeMs === mtime && !fs.existsSync(path.join(home, '.extension-previous')));
    check('…the .xpi is judged by its CONTENT (the zip stamps today\'s date) and left untouched', fs.statSync(xpi).mtimeMs === xpiMtime);
    fs.rmSync(xpi);
    const noXpi = update(['--home', home]);
    check('a home from before the .xpi existed: the Chrome folder stays as it is, the .xpi is written, and the output says so',
      noXpi.status === 0 && /Chrome folder was already current; the Firefox add-on is written/.test(noXpi.stdout) &&
      sameEntries(xpiHas(), ffWant) && fs.statSync(path.join(ext, 'manifest.json')).mtimeMs === mtime);

    fs.writeFileSync(path.join(ext, 'background.js'), '// the old bridge\n');
    fs.writeFileSync(path.join(ext, 'stray.js'), '// a file an old version had\n');
    const m = manifestIn(ext); m.version = '0.0.1'; fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
    const stale = update(['--home', home]);
    check('a stale folder: "0.0.1 → ' + version + '", the Reload step, the ZIP\'s files exactly (a file the new version lacks is gone)',
      stale.status === 0 && stale.stdout.includes('0.0.1 → ' + version) && /↻ Reload/.test(stale.stdout) &&
      sameEntries(folderEntries(ext), want));
    check('…and the copy it replaced is kept for a rollback',
      fs.readFileSync(path.join(home, '.extension-previous', 'background.js'), 'utf8') === '// the old bridge\n');
    const ff = update(['--home', path.join(tmp, 'ff'), '--site', SITE, '--browser', 'firefox']);
    check('--browser firefox writes the Firefox build', ff.status === 0 &&
      sameEntries(folderEntries(path.join(tmp, 'ff', 'extension')), byName(routeZip(extensionBuild('bridge', 'firefox', SITE)))));

    // ── the default home is the platform's app-data folder; the old one's site carries over ──
    if (process.platform !== 'win32') {
      const fakeHome = path.join(tmp, 'a user');
      fs.mkdirSync(path.join(fakeHome, 'Tapuziel Bridge', 'extension'), { recursive: true });
      fs.writeFileSync(path.join(fakeHome, 'Tapuziel Bridge', 'extension', 'manifest.json'), extensionBuild('bridge', 'chrome', SITE).manifestText);
      const envHome = { ...env, HOME: fakeHome };
      delete envHome.XDG_DATA_HOME;
      const dflt = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: envHome });
      const expected = process.platform === 'darwin'
        ? path.join(fakeHome, 'Library', 'Application Support', 'Tapuziel', 'Bridge')
        : path.join(fakeHome, '.local', 'share', 'tapuziel', 'bridge');
      check('no --home: the Bridge goes to the platform\'s app-data folder (' + path.relative(fakeHome, expected) + '), not a folder in the open in the home folder',
        dflt.status === 0 && fs.existsSync(path.join(expected, 'extension', 'manifest.json')) && fs.existsSync(path.join(expected, 'tapuziel-bridge-firefox.xpi')));
      check('…the site comes over from the old ~/Tapuziel Bridge without retyping it, and the old folder is named as retired',
        manifestIn(path.join(expected, 'extension')).content_scripts[0].matches.join() === '*://' + SITE + '/*' &&
        /Tapuziel Bridge is retired/.test(dflt.stdout));
      check('…and nothing is written into the old folder', fs.readdirSync(path.join(fakeHome, 'Tapuziel Bridge')).join() === 'extension' &&
        fs.readdirSync(path.join(fakeHome, 'Tapuziel Bridge', 'extension')).join() === 'manifest.json');
    }
  }

  // ── 3. refusals ──
  {
    const fake = path.join(tmp, 'a-checkout');
    fs.mkdirSync(path.join(fake, '.git'), { recursive: true });
    const inCheckout = update(['--home', path.join(fake, 'bridge'), '--site', SITE]);
    check('a home inside a git checkout is refused, and nothing is written there (the trap that started this)',
      inCheckout.status === 1 && /inside the git checkout/.test(inCheckout.stderr) && !fs.existsSync(path.join(fake, 'bridge')));
    const asExt = update(['--home', ext]);
    check('the extension folder itself passed as --home is refused (no extension/extension)',
      asExt.status === 1 && /Pass the folder ABOVE it/.test(asExt.stderr) && !fs.existsSync(path.join(ext, 'extension')));
    const other = path.join(tmp, 'other');
    fs.mkdirSync(path.join(other, 'extension'), { recursive: true });
    fs.writeFileSync(path.join(other, 'extension', 'manifest.json'), '{"name":"Some Other Extension","version":"1.0"}');
    const foreign = update(['--home', other, '--site', SITE]);
    check('a folder holding some other extension is never overwritten',
      foreign.status === 1 && /not a Tapuziel Bridge folder/.test(foreign.stderr) &&
      fs.readdirSync(path.join(other, 'extension')).join() === 'manifest.json');
    const bad = ['localhost', '127.0.0.1', 'evil.com/*', '*.example.com', 'host:8443'].map((s) => update(['--home', path.join(tmp, 'bad'), '--site', s]));
    check('a loopback or pattern-bending --site is refused before anything is written',
      bad.every((r) => r.status === 1 && /not a host the Bridge can be wired to/.test(r.stderr)) && !fs.existsSync(path.join(tmp, 'bad')));
    const unknown = update(['--home', path.join(tmp, 'bad'), '--force']);
    check('an unknown option is refused', unknown.status === 1 && /unknown option: --force/.test(unknown.stderr));
  }

  // ── 4. --git and the launcher, against a local origin ──
  if (!hasGit) {
    console.log('SKIP --git / launcher: no git on this machine');
  } else {
    const sh = (cwd, args) => execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    const origin = path.join(tmp, 'origin.git');
    const seed = path.join(tmp, 'seed');
    const clone = path.join(tmp, 'clone');
    sh(tmp, ['init', '-q', '--bare', '-b', 'main', origin]);
    sh(tmp, ['init', '-q', '-b', 'main', seed]);
    for (const p of ['src/extension-build.js', 'src/bridge-manifest.js', 'src/zip-store.js', 'extension-v2a', 'scripts/update-bridge.js']) {
      fs.cpSync(path.join(root, ...p.split('/')), path.join(seed, ...p.split('/')), { recursive: true });
    }
    sh(seed, ['add', '-A']);
    sh(seed, ['commit', '-q', '-m', 'bridge ' + version]);
    sh(seed, ['remote', 'add', 'origin', origin]);
    sh(seed, ['push', '-q', 'origin', 'main']);
    sh(tmp, ['clone', '-q', origin, clone]);
    // the clone is what Ben's was: its working tree patched by hand
    const cloneManifest = path.join(clone, 'extension-v2a', 'manifest.json');
    const patched = fs.readFileSync(cloneManifest, 'utf8').replace('"version": "' + version + '"', '"version": "0.0.0-handpatched"');
    fs.writeFileSync(cloneManifest, patched);
    const head = sh(clone, ['rev-parse', 'HEAD']);

    const gitHome = path.join(tmp, 'git home');
    const first = update(['--home', gitHome, '--git', clone, '--site', SITE]);
    check('--git: installs origin/main\'s Bridge (' + version + '), not the clone\'s hand-patched working tree',
      first.status === 0 && /installed \(origin\/main [0-9a-f]+\)/.test(first.stdout) &&
      manifestIn(path.join(gitHome, 'extension')).version === version);

    // a new Bridge — and a new updater — land on origin/main; the clone is not pulled
    const seedManifest = path.join(seed, 'extension-v2a', 'manifest.json');
    fs.writeFileSync(seedManifest, fs.readFileSync(seedManifest, 'utf8').replace('"version": "' + version + '"', '"version": "9.9.9"'));
    fs.appendFileSync(path.join(seed, 'extension-v2a', 'background.js'), '\n// 9.9.9\n');
    fs.appendFileSync(path.join(seed, 'scripts', 'update-bridge.js'), "\nconsole.log('updater from origin/main: next');\n");
    sh(seed, ['commit', '-q', '-am', 'bridge 9.9.9']);
    sh(seed, ['push', '-q', 'origin', 'main']);

    const launcher = path.join(gitHome, 'Update Bridge.command');
    const run = spawnSync('sh', [launcher], { encoding: 'utf8', env });
    const got = path.join(gitHome, 'extension');
    check('the launcher: fetches, brings the folder to 9.9.9 and says ' + version + ' → 9.9.9',
      run.status === 0 && run.stdout.includes(version + ' → 9.9.9') && manifestIn(got).version === '9.9.9' &&
      fs.readFileSync(path.join(got, 'background.js'), 'utf8').endsWith('// 9.9.9\n'));
    check('…wired to the site it remembered, not stripped by the update',
      manifestIn(got).content_scripts[0].matches.join() === '*://' + SITE + '/*' && !manifestIn(got).browser_specific_settings);
    check('…with the NEWEST updater (the one on origin/main, not the one that wrote the launcher)',
      run.stdout.includes('updater from origin/main: next'));
    check('…and the clone is untouched: same HEAD, its hand-patched manifest still there, nothing else changed',
      sh(clone, ['rev-parse', 'HEAD']) === head && fs.readFileSync(cloneManifest, 'utf8') === patched &&
      sh(clone, ['status', '--porcelain']) === 'M extension-v2a/manifest.json');
    const twice = spawnSync('sh', [launcher], { encoding: 'utf8', env });
    check('the launcher again: up to date, nothing to reload', twice.status === 0 && /9\.9\.9 is up to date/.test(twice.stdout));

    const offline = path.join(tmp, 'offline');
    sh(tmp, ['clone', '-q', origin, offline]);
    sh(offline, ['remote', 'set-url', 'origin', path.join(tmp, 'no-such-origin.git')]);
    const noNet = update(['--home', path.join(tmp, 'offline home'), '--git', offline, '--site', SITE]);
    check('origin unreachable: refused with "nothing changed", no folder written',
      noNet.status === 1 && /could not fetch origin main/.test(noNet.stderr) && !fs.existsSync(path.join(tmp, 'offline home')));
  }
} catch (e) {
  check('harness: ' + (e.stack || e.message), false);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(fail ? 'SMOKE UPDATE-BRIDGE: FAIL' : 'SMOKE UPDATE-BRIDGE: PASS');
process.exit(fail ? 1 : 0);
