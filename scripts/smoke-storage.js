'use strict';

/**
 * v0.63 QA — the Storage section (the "your files on disk" view). Runs against
 * an isolated TAPUZ_ROOT so assertions are deterministic. Proves the disk
 * reader finds pages (merged by slug across published/drafts), lists the safe
 * site JSON, and — the security invariant — NEVER surfaces the secret config
 * files (auth / agent-tokens / missions).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// isolate BEFORE requiring anything that reads paths.js
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-storage-'));
process.env.TAPUZ_ROOT = root;
fs.mkdirSync(path.join(root, 'pages', 'published'), { recursive: true });
fs.mkdirSync(path.join(root, 'pages', 'drafts'), { recursive: true });
fs.mkdirSync(path.join(root, 'config'), { recursive: true });
fs.mkdirSync(path.join(root, 'content'), { recursive: true });
fs.writeFileSync(path.join(root, 'pages', 'published', 'home.pzn'), 'META{}\n');
fs.writeFileSync(path.join(root, 'pages', 'drafts', 'home.pzn'), 'META{}\n');   // same slug → merged
fs.writeFileSync(path.join(root, 'pages', 'drafts', 'about.pzn'), 'META{}\n');  // draft-only
fs.writeFileSync(path.join(root, 'config', 'menus.json'), '[]');
fs.writeFileSync(path.join(root, 'config', 'site.json'), '{}');
fs.writeFileSync(path.join(root, 'config', 'auth.json'), '{"secret":"x"}');
fs.writeFileSync(path.join(root, 'config', 'agent-tokens.json'), '[]');
fs.writeFileSync(path.join(root, 'config', 'missions.json'), '[]');
fs.writeFileSync(path.join(root, 'content', 'categories.json'), '[]');

const { listStorage, HIDDEN_CONFIG } = require('../src/storage-view');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const s = listStorage();
const bySlug = Object.fromEntries(s.pages.map((p) => [p.slug, p]));

check('finds both page slugs (home + about)', s.pages.length === 2 && bySlug.home && bySlug.about);
check('home merged: published AND draft', bySlug.home && bySlug.home.published === true && bySlug.home.draft === true);
check('about is draft-only', bySlug.about && bySlug.about.published === false && bySlug.about.draft === true);
check('page carries an on-disk path', /pages\/(published|drafts)\/home\.pzn$/.test(bySlug.home.diskPath));
check('page carries size + mtime', bySlug.home.size > 0 && bySlug.home.mtime > 0);

const dataNames = s.siteData.map((f) => f.name);
check('site data includes menus.json + site.json + categories.json',
  dataNames.includes('menus.json') && dataNames.includes('site.json') && dataNames.includes('categories.json'));

// ── SECURITY: secrets must NEVER appear ──────────────────────────────
check('HIDDEN_CONFIG covers the three secrets',
  HIDDEN_CONFIG.has('auth.json') && HIDDEN_CONFIG.has('agent-tokens.json') && HIDDEN_CONFIG.has('missions.json'));
check('secrets excluded from site data list',
  !dataNames.includes('auth.json') && !dataNames.includes('agent-tokens.json') && !dataNames.includes('missions.json'));
const flat = JSON.stringify(s);
check('no secret filename leaks anywhere in the output',
  !/auth\.json/.test(flat) && !/agent-tokens/.test(flat) && !/missions/.test(flat));
check('no file CONTENTS exposed (metadata only)', !/"secret"/.test(flat));

check('counts match the arrays',
  s.counts.pages === s.pages.length && s.counts.siteData === s.siteData.length && s.counts.media === s.media.length);
check('media degrades gracefully on empty DB', Array.isArray(s.media));

// cleanup
try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }

console.log('');
console.log(fail ? 'SMOKE STORAGE: FAIL' : 'SMOKE STORAGE: PASS');
process.exit(fail ? 1 : 0);
