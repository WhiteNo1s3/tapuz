'use strict';

/**
 * v0.78 QA gate — the homepage creation flow.
 *
 * The bug this guards: the homepage used to be chosen ONLY by a title-scoring
 * heuristic (HOME_SCORE_MIN threshold). A fresh site whose first page was
 * titled anything normal ("ברוכים הבאים") shipped a 404 at '/', with no way
 * to say "this is my homepage". Now config.homepage is the explicit crown —
 * heuristic is the fallback only.
 *
 * Runs against a THROWAWAY site via TAPUZ_ROOT (never touches the real
 * db/config/public). Exit 1 on any failure.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// BEFORE any src require — src/paths.js resolves TAPUZ_ROOT at require time
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-homepage-'));
process.env.TAPUZ_ROOT = tmpRoot;

const { resolveHomePath } = require('../src/seo');
const { loadConfig, saveConfig } = require('../src/config');
const { createPage, publishPage, listPages, updatePage, deletePage, getPageByFullPath } = require('../src/pages');
const { exportAll } = require('../src/export');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── 1. the resolver: explicit wins, fallback ranks, nobody = null ──
const plain = { full_path: 'welcome', title: 'ברוכים הבאים', blocks: [] };
const thief = { full_path: 'post-1', title: 'איך בניתי את דף הבית שלי', blocks: new Array(40).fill({}) };

check(resolveHomePath([plain, thief], 'welcome') === 'welcome',
  'explicit crown beats a higher-scoring title thief');
check(resolveHomePath([plain, thief], '') === 'post-1',
  'no crown → ranked fallback still works');
check(resolveHomePath([plain, thief], 'gone-page') === 'post-1',
  'crown pointing at a missing page → fallback, never a dead homepage');
check(resolveHomePath([plain], '') === null,
  'fresh site, normal title, no crown → null (the old silent 404, now visible)');
check(resolveHomePath([], 'welcome') === null,
  'nothing published → null even with a crown');

// ── 2. config carries the crown ──
check(Object.prototype.hasOwnProperty.call(loadConfig(), 'homepage'),
  'config exposes homepage (default "")');

// ── 3. end-to-end on a throwaway site: publish → 404 state → crown → index.html ──
createPage({ title: 'ברוכים הבאים', slug: 'welcome', status: 'published', blocks: [
  { type: 'heading', data: { level: 1, text: 'ברוכים הבאים' } },
  { type: 'text', data: { content: 'האתר הראשון שלי' } }
] });

const published = () => listPages().filter((p) => p.status === 'published');
check(resolveHomePath(published(), loadConfig().homepage) === null,
  'REPRO: published page, still no homepage — this was the QA blocker');

const cfg = loadConfig();
cfg.homepage = 'welcome';
saveConfig(cfg);
check(resolveHomePath(published(), loadConfig().homepage) === 'welcome',
  'crowning via config resolves');

exportAll();
const indexPath = path.join(tmpRoot, 'public', 'index.html');
check(fs.existsSync(indexPath), 'exportAll wrote index.html for the crowned page');
if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  check(html.includes('ברוכים הבאים'), 'index.html IS the crowned page');
}
check(fs.existsSync(path.join(tmpRoot, 'public', 'welcome.html')),
  'the crowned page keeps its named file too (menu links never 404)');

// ── 4. the crown follows a rename ──
updatePage('welcome', { slug: 'main' });
check(!getPageByFullPath('welcome') && !!getPageByFullPath('main'), 'rename happened');
check(loadConfig().homepage === 'main', 'config.homepage followed the slug rename');

// ── 5. the wizard respects an existing crown ──
const { runSetup } = require('../src/setup');
runSetup({ title: 'אתר בדיקה', pages: ['home'] });
check(loadConfig().homepage === 'main',
  'wizard never steals an existing crown (sets home only when unset)');

// ── 6. deleting the homepage clears the crown ──
deletePage('main');
check(loadConfig().homepage === '', 'deleting the crowned page clears config.homepage');
check(resolveHomePath(published(), loadConfig().homepage) === 'home',
  'fallback picks the wizard home after the crowned page is gone');

// cleanup (best effort — a locked sqlite file on Windows is fine to leave in tmp)
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

console.log('');
if (failures) {
  console.log('SMOKE HOMEPAGE: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE HOMEPAGE: PASS');
