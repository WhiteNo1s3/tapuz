#!/usr/bin/env node
'use strict';

/**
 * Keep an unpacked Bridge V2 in its own folder, up to date with one command
 * (v2.41).
 *
 * Ben: "the bridge won't update in my own folder … why the folder won't
 * update?" Chrome was loading the Bridge from `extension-v2a/` inside a git
 * checkout — 18 commits behind and patched by hand with the site's host —
 * while every new ZIP from /admin/ai-setup landed in Downloads as "(2).zip"
 * and never reached the folder Chrome reads. A `git pull` there would refuse
 * (the hand-patched files) or wipe the wiring (v2.34's story), and the public
 * repo can carry no real hostname.
 *
 * So the Bridge lives OUTSIDE any checkout, in the platform's own place for
 * an app's data. It first defaulted to ~/Tapuziel Bridge — a folder sitting
 * in the open in the home folder; Ben (2026-09-22): "the folder is out in the
 * open in my home folder stupidly". Now:
 *
 *   macOS    ~/Library/Application Support/Tapuziel/Bridge
 *   Windows  %LOCALAPPDATA%\Tapuziel\Bridge
 *   Linux    ${XDG_DATA_HOME:-~/.local/share}/tapuziel/bridge
 *
 * and this script fills it:
 *
 *   <home>/extension/                    Chrome / Edge: Load unpacked, once
 *   <home>/tapuziel-bridge-firefox.xpi   Firefox: install from file (below)
 *   <home>/Update Bridge.command         run for every update, then ↻ Reload
 *   <home>/.extension-previous/          the copy it replaced, for a rollback
 *
 * FIREFOX (2026-09-22 — Ben: "no firefox alternative, only the chrome
 * patch"). He zipped the Chrome folder in Finder and Firefox refused it: no
 * gecko id, a Chrome-only service worker as its background, and the manifest
 * inside a wrapping folder. The .xpi written here is the Firefox build the
 * site's own download serves — the gecko id, background scripts, the
 * manifest at the root — so it installs as it is. Release Firefox keeps only
 * a Mozilla-signed add-on for good (an unsigned one loads from
 * about:debugging until the browser closes); Developer Edition, Nightly and
 * ESR keep it permanently once about:config has
 * xpinstall.signatures.required = false — Firefox's dev-mode install, as
 * "Load unpacked" is Chrome's. A newer .xpi installs over the old one (same
 * id) and keeps its settings.
 *
 * The files are the ZIP's own — src/extension-build.js, the same tailoring
 * and site wiring the download route uses — so the folder never differs from
 * what the site serves. With --git the code comes from `origin/main` of that
 * clone (fetched first; its branch and working tree are never touched), which
 * is what the live site runs. The launcher fetches the newest copy of THIS
 * script from origin/main before running it, so the launcher itself never
 * needs updating.
 *
 * Usage:
 *   node scripts/update-bridge.js [--home <folder>] [--site <host or admin URL>]
 *                                 [--git <clone or .git dir>] [--browser chrome|firefox]
 *   --home     default: the platform's app-data folder above; refused inside a git checkout
 *   --site     the site to wire; remembered in the folder's manifest
 *   --git      build from that clone's origin/main (default: this tree;
 *              `npm run bridge:update` passes --git .)
 *   --browser  what the unpacked folder holds (default chrome); the Firefox
 *              .xpi is written either way
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BRIDGE_NAME = /^Tapuziel Bridge V2\b/;
// what a build of this revision needs from the tree (read from git in --git mode)
const BUILD_PATHS = ['src/extension-build.js', 'src/bridge-manifest.js', 'src/zip-store.js', 'extension-v2a'];
const LAUNCHER = 'Update Bridge.command';
const XPI = 'tapuziel-bridge-firefox.xpi';
const IGNORED = new Set(['.DS_Store']); // Finder drops these into any folder it opens

class Refusal extends Error {}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Refusal('unknown argument: ' + argv[i]);
    if (m[1] === 'help') { opts.help = true; continue; }
    if (!['home', 'site', 'git', 'browser'].includes(m[1])) throw new Refusal('unknown option: --' + m[1]);
    const value = m[2] !== undefined ? m[2] : argv[++i];
    if (value === undefined) throw new Refusal('--' + m[1] + ' needs a value');
    opts[m[1]] = value;
  }
  return opts;
}

const expandHome = (p) => String(p).replace(/^~(?=$|[\\/])/, os.homedir());

/** Where an app keeps its data on this platform — the Bridge's default home. */
function defaultHome() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Tapuziel', 'Bridge');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Tapuziel', 'Bridge');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'tapuziel', 'bridge');
}
/** The first default, in the open in the home folder: read once for its site, then retired. */
const legacyHome = () => path.join(os.homedir(), 'Tapuziel Bridge');

/** The nearest folder at or above `dir` that holds a `.git`, or ''. */
function gitCheckoutAbove(dir) {
  for (let cur = dir; ; cur = path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    if (path.dirname(cur) === cur) return '';
  }
}

const git = (gitDir, args, input) =>
  execFileSync('git', ['--git-dir=' + gitDir, ...args], { input, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });

/** A clone's shared .git directory (a worktree's too), absolute; '' when none. */
function commonGitDir(p) {
  try {
    return execFileSync('git', ['-C', p, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return '';
  }
}

/** The build's source tree from origin/main of a clone, in a temp folder. */
function sourceFromGit(where) {
  const gitDir = commonGitDir(path.resolve(expandHome(where)));
  if (!gitDir) throw new Refusal('not a git clone: ' + where);
  try {
    git(gitDir, ['fetch', '--quiet', 'origin', 'main']);
  } catch (e) {
    throw new Refusal('could not fetch origin main (offline?) — nothing changed\n' + String(e.stderr || e.message).trim());
  }
  const sha = git(gitDir, ['rev-parse', '--short', 'origin/main']).toString().trim();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuziel-bridge-src-'));
  const listing = git(gitDir, ['ls-tree', '-r', '-z', 'origin/main', '--', ...BUILD_PATHS]).toString();
  for (const line of listing.split('\0').filter(Boolean)) {
    const hit = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (!hit || hit[1] === '120000') continue; // no symlinks
    const out = path.join(root, ...hit[3].split('/'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, git(gitDir, ['cat-file', 'blob', hit[2]]));
  }
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  if (!BUILD_PATHS.every((p) => fs.existsSync(path.join(root, ...p.split('/'))))) {
    cleanup();
    throw new Refusal('origin/main ' + sha + ' has no ' + BUILD_PATHS.join(' + ') + ' — it predates this updater (v2.41); nothing changed.');
  }
  return { root, gitDir, label: 'origin/main ' + sha, cleanup };
}

/** The build's source tree = the checkout this script sits in. */
function sourceFromTree() {
  const root = path.join(__dirname, '..');
  const gitDir = commonGitDir(root);
  let label = 'this checkout';
  if (gitDir) {
    try { label += ' ' + execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* unborn */ }
  }
  return { root, gitDir, label, cleanup: () => {} };
}

/** The site a Bridge manifest is wired to (`*://host/*`), or ''. */
function wiredSite(manifest) {
  for (const c of (manifest && Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [])) {
    for (const m of (Array.isArray(c.matches) ? c.matches : [])) {
      const hit = /^\*:\/\/([^/*]+)\/\*$/.exec(m);
      if (hit) return hit[1];
    }
  }
  return '';
}

const hostOf = (v) => {
  const s = String(v).trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s.toLowerCase();
  try { return new URL(s).hostname; } catch (e) { return s; }
};

function listFiles(dir) {
  const out = new Map();
  (function walk(cur, rel) {
    for (const name of fs.readdirSync(cur)) {
      if (IGNORED.has(name)) continue;
      const full = path.join(cur, name);
      if (fs.statSync(full).isDirectory()) walk(full, rel + name + '/');
      else out.set(rel + name, full);
    }
  })(dir, '');
  return out;
}

/** A STORE zip's entries, in order ({ rel, data }) — src/zip-store.js writes nothing else. */
function zipEntries(buf) {
  const out = [];
  let at = 0;
  while (at + 30 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const start = at + 30 + nameLen + buf.readUInt16LE(at + 28);
    out.push({ rel: buf.slice(at + 30, at + 30 + nameLen).toString('utf8'), data: buf.slice(start, start + size) });
    at = start + size;
  }
  return out;
}

/** Does the .xpi on disk already carry exactly these files? (The zip stamps
 *  today's date into every entry, so the bytes of the file itself never match.) */
function sameXpi(file, files) {
  if (!fs.existsSync(file)) return false;
  let have;
  try { have = zipEntries(fs.readFileSync(file)); } catch (e) { return false; }
  return have.length === files.length && files.every((f, i) => have[i].rel === f.rel && have[i].data.equals(f.data));
}

function sameFiles(dir, files) {
  const have = listFiles(dir);
  return have.size === files.length && files.every((f) => have.has(f.rel) && fs.readFileSync(have.get(f.rel)).equals(f.data));
}

const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

function launcherText({ gitDir, site, browser }) {
  return [
    '#!/bin/sh',
    '# Tapuziel Bridge — bring this folder to the newest Bridge on origin/main.',
    '# Written by scripts/update-bridge.js. Double-click it in Finder, or run it;',
    '# then chrome://extensions → ↻ Reload on "Tapuziel Bridge V2 (alpha)" — in Firefox,',
    '# install the new tapuziel-bridge-firefox.xpi over the old one.',
    'GIT_DIR_PATH=' + shq(gitDir),
    '# node from PATH (a brew upgrade moves the versioned path); the one that wrote this as a fallback',
    'NODE="$(command -v node)" || NODE=' + shq(process.execPath),
    'HERE="$(cd "$(dirname "$0")" && pwd)" || exit 1',
    'TMP="$(mktemp -d)" || exit 1',
    'trap \'rm -rf "$TMP"\' EXIT',
    'if ! git --git-dir="$GIT_DIR_PATH" fetch --quiet origin main; then',
    '  echo "✕ could not fetch origin main (offline?) — nothing changed"',
    '  exit 1',
    'fi',
    '# the newest updater, so this launcher never needs changing',
    'git --git-dir="$GIT_DIR_PATH" cat-file blob origin/main:scripts/update-bridge.js > "$TMP/update-bridge.js" || exit 1',
    '"$NODE" "$TMP/update-bridge.js" --home "$HERE" --git "$GIT_DIR_PATH"' +
      (site ? ' --site ' + shq(site) : '') + (browser !== 'chrome' ? ' --browser ' + browser : ''),
    'exit $?',
    ''
  ].join('\n');
}

/** Write through a rename: a launcher running right now keeps reading its old copy. */
function writeLauncher(home, text) {
  const file = path.join(home, LAUNCHER);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  const tmp = file + '.new';
  fs.writeFileSync(tmp, text, { mode: 0o755 });
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, file);
  return true;
}

function run(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').match(/ \* Usage:[\s\S]*?(?= \*\/)/)[0].replace(/^ \* ?/gm, ''));
    return;
  }
  const browser = opts.browser || 'chrome';
  if (!['chrome', 'firefox'].includes(browser)) throw new Refusal('--browser is chrome or firefox');
  const home = path.resolve(expandHome(opts.home || defaultHome()));
  const checkout = gitCheckoutAbove(home);
  if (checkout) {
    throw new Refusal(home + ' is inside the git checkout ' + checkout + '.\n' +
      '  That is what kept the Bridge from updating: pulls fight the files, downloads never land there.\n' +
      '  Pick a folder outside it — or leave --home out for the default, ' + defaultHome() + '.');
  }
  if (fs.existsSync(path.join(home, 'manifest.json'))) {
    throw new Refusal(home + ' holds a manifest.json — that is an extension folder. Pass the folder ABOVE it: the Bridge goes into <home>/extension.');
  }
  const extDir = path.join(home, 'extension');
  let before = null;
  if (fs.existsSync(extDir)) {
    let m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8')); } catch (e) { /* not ours */ }
    if (!m || !BRIDGE_NAME.test(String(m.name || ''))) {
      throw new Refusal(extDir + ' is not a Tapuziel Bridge folder — not overwriting it.');
    }
    before = { version: String(m.version || '?'), site: wiredSite(m) };
  }

  const src = opts.git ? sourceFromGit(opts.git) : sourceFromTree();
  try {
    const { extensionBuild, buildFiles } = require(path.join(src.root, 'src', 'extension-build.js'));
    const { siteMatchPattern } = require(path.join(src.root, 'src', 'bridge-manifest.js'));
    let site = before ? before.site : '';
    // the first install in the new default home carries the site over from
    // the old one in the home folder, so nobody retypes it
    const legacy = !opts.home && path.resolve(legacyHome()) !== home && fs.existsSync(path.join(legacyHome(), 'extension', 'manifest.json'));
    if (!before && opts.site === undefined && legacy) {
      try { site = wiredSite(JSON.parse(fs.readFileSync(path.join(legacyHome(), 'extension', 'manifest.json'), 'utf8'))); } catch (e) { /* none to carry */ }
    }
    if (opts.site !== undefined) {
      site = hostOf(opts.site);
      if (!siteMatchPattern(site)) {
        throw new Refusal('--site ' + opts.site + ' is not a host the Bridge can be wired to.\n' +
          '  A localhost site is never wired (the Bridge would sit on every dev server): leave --site out and connect it from the popup.');
      }
    }
    const build = extensionBuild('bridge', browser, site);
    const files = buildFiles(build);
    const version = String(build.manifest.version);
    const folderFresh = !!before && sameFiles(extDir, files);
    // Firefox: the site's own Firefox download, as one file to install
    const { zipDirectory } = require(path.join(src.root, 'src', 'zip-store.js'));
    const ff = extensionBuild('bridge', 'firefox', site);
    const xpiFile = path.join(home, XPI);
    const xpiFresh = sameXpi(xpiFile, buildFiles(ff));
    const upToDate = folderFresh && xpiFresh;

    if (!xpiFresh) {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(xpiFile + '.new', zipDirectory(ff.dir, '', { 'manifest.json': ff.manifestText }));
      fs.renameSync(xpiFile + '.new', xpiFile);
    }
    if (!folderFresh) {
      fs.mkdirSync(home, { recursive: true });
      const stage = path.join(home, '.extension-staging');
      fs.rmSync(stage, { recursive: true, force: true });
      for (const f of files) {
        const out = path.join(stage, ...f.rel.split('/'));
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, f.data);
      }
      if (before) {
        const prev = path.join(home, '.extension-previous');
        fs.rmSync(prev, { recursive: true, force: true });
        fs.renameSync(extDir, prev);
      }
      fs.renameSync(stage, extDir);
    }
    const launches = !!src.gitDir && process.platform !== 'win32'; // an sh launcher; Windows runs the script itself
    if (launches) writeLauncher(home, launcherText({ gitDir: src.gitDir, site, browser }));

    const where = browser === 'chrome' ? 'chrome://extensions' : 'about:debugging#/runtime/this-firefox';
    const siteLine = site ? '  site:   ' + site : '  site:   none wired — connect one from the popup (״חבר את האתר הפתוח״)';
    const firefoxHow = [
      '  firefox: ' + xpiFile,
      '    Developer Edition / Nightly / ESR: about:config → xpinstall.signatures.required = false, once;',
      '    then about:addons → ⚙ → Install Add-on From File → that .xpi (a newer one installs over it).',
      '    Release Firefox keeps only signed add-ons: about:debugging → Load Temporary Add-on (until it closes).'
    ];
    if (upToDate) {
      console.log('✓ Tapuziel Bridge ' + version + ' is up to date (' + src.label + ') — nothing to reload.');
      console.log('  folder: ' + extDir);
      console.log('  firefox: ' + xpiFile);
      console.log(siteLine);
    } else if (before && folderFresh) {
      console.log('✓ Tapuziel Bridge ' + version + ': the Chrome folder was already current; the Firefox add-on is written (' + src.label + ')');
      console.log('  folder: ' + extDir);
      console.log(siteLine);
      firefoxHow.forEach((l) => console.log(l));
    } else if (before) {
      console.log('✓ Tapuziel Bridge ' + before.version + ' → ' + version + ' (' + src.label + ')');
      console.log('  folder: ' + extDir);
      console.log(siteLine);
      console.log('  the copy it replaced: ' + path.join(home, '.extension-previous'));
      console.log('  firefox: ' + xpiFile + ' (install it over the old one)');
      console.log('Next: ' + where + ' → ↻ Reload on "' + build.manifest.name + '", then refresh the admin.');
    } else {
      console.log('✓ Tapuziel Bridge ' + version + ' installed (' + src.label + ')');
      console.log('  folder: ' + extDir);
      console.log(siteLine);
      console.log('Next, once: ' + where + ' → Developer mode → Load unpacked → ' + extDir);
      if (process.platform === 'darwin' && /\/Library\//.test(extDir)) {
        console.log('  (Library is hidden in the folder picker: press ⌘⇧G and paste the path.)');
      }
      console.log('  An older "Tapuziel Bridge V2" still loaded? Remove it first — two bridges on one site both answer.');
      firefoxHow.forEach((l) => console.log(l));
    }
    if (legacy) {
      console.log('The old folder ' + legacyHome() + ' is retired: once Chrome loads the new one, remove the old Bridge in chrome://extensions and move that folder to the Trash.');
    }
    if (launches) console.log('Updates: run "' + path.join(home, LAUNCHER) + '"' + (process.platform === 'darwin' ? ' (or double-click it)' : '') + ', then ↻ Reload.');
    else if (src.gitDir) console.log('Updates: in the clone, npm run bridge:update -- --home "' + home + '" --git . — then ↻ Reload.');
    else console.log('Updates: run this script again from an up-to-date checkout, then ↻ Reload.');
  } finally {
    src.cleanup();
  }
}

try {
  run(process.argv.slice(2));
} catch (e) {
  console.error('✕ ' + (e instanceof Refusal ? e.message : (e && e.stack) || e));
  process.exitCode = 1;
}
