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
 * So the Bridge lives OUTSIDE any checkout, and this script fills it:
 *
 *   <home>/extension/             chrome://extensions → Load unpacked, once
 *   <home>/Update Bridge.command  double-click (or run) for every update, then ↻ Reload
 *   <home>/.extension-previous/   the copy it replaced, for a rollback
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
 *   --home     default ~/Tapuziel Bridge; refused inside a git checkout
 *   --site     the site to wire; remembered in the folder's manifest
 *   --git      build from that clone's origin/main (default: this tree)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BRIDGE_NAME = /^Tapuziel Bridge V2\b/;
// what a build of this revision needs from the tree (read from git in --git mode)
const BUILD_PATHS = ['src/extension-build.js', 'src/bridge-manifest.js', 'extension-v2a'];
const LAUNCHER = 'Update Bridge.command';
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
    '# then chrome://extensions → ↻ Reload on "Tapuziel Bridge V2 (alpha)".',
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
  const home = path.resolve(expandHome(opts.home || path.join(os.homedir(), 'Tapuziel Bridge')));
  const checkout = gitCheckoutAbove(home);
  if (checkout) {
    throw new Refusal(home + ' is inside the git checkout ' + checkout + '.\n' +
      '  That is what kept the Bridge from updating: pulls fight the files, downloads never land there.\n' +
      '  Pick a folder outside it (the default is ~/Tapuziel Bridge).');
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
    const upToDate = !!before && sameFiles(extDir, files);

    if (!upToDate) {
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
    if (upToDate) {
      console.log('✓ Tapuziel Bridge ' + version + ' is up to date (' + src.label + ') — nothing to reload.');
      console.log('  folder: ' + extDir);
      console.log(siteLine);
    } else if (before) {
      console.log('✓ Tapuziel Bridge ' + before.version + ' → ' + version + ' (' + src.label + ')');
      console.log('  folder: ' + extDir);
      console.log(siteLine);
      console.log('  the copy it replaced: ' + path.join(home, '.extension-previous'));
      console.log('Next: ' + where + ' → ↻ Reload on "' + build.manifest.name + '", then refresh the admin.');
    } else {
      console.log('✓ Tapuziel Bridge ' + version + ' installed (' + src.label + ')');
      console.log('  folder: ' + extDir);
      console.log(siteLine);
      console.log('Next, once: ' + where + ' → Developer mode → Load unpacked → ' + extDir);
      console.log('  An older "Tapuziel Bridge V2" loaded from a git checkout? Remove it first — two bridges on one site both answer.');
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
