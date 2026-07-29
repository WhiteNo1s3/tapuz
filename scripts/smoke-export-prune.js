// The build must never empty a site it cannot rebuild.
//
// exportAll() reconciles public/*.html against the DB's published set, so a
// deleted/unpublished/renamed page stops serving. On a FRESH SERVER that
// reconciliation was catastrophic: db/*.db is gitignored, so `git clone &&
// npm install && npm run build` runs against an empty database, the published
// set is [], and every committed HTML file — index.html included — read as
// stale and was deleted. The host then reported no site at all.
//
// Runs on a throwaway TAPUZ_ROOT so no real site data is touched.
const fs = require('fs');
const path = require('path');
const os = require('os');

if (!process.env.TAPUZ_ROOT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-export-prune-'));
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TAPUZ_ROOT: tmp },
    stdio: 'inherit'
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  process.exit(r.status == null ? 1 : r.status);
}

const ROOT = process.env.TAPUZ_ROOT;
const PUBLIC = path.join(ROOT, 'public');
const { exportAll } = require('../src/export');
const { createPage, updatePage } = require('../src/pages');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function seedShipped() {
  fs.mkdirSync(PUBLIC, { recursive: true });
  for (const f of ['index.html', 'home.html', 'about.html']) {
    fs.writeFileSync(path.join(PUBLIC, f), '<!doctype html><title>' + f + '</title>', 'utf8');
  }
}

// ── the deployment bug: empty DB must not prune ──────────────────────────
seedShipped();
exportAll(PUBLIC);

check('empty DB keeps index.html', fs.existsSync(path.join(PUBLIC, 'index.html')));
check('empty DB keeps every other committed page',
  ['home.html', 'about.html'].every((f) => fs.existsSync(path.join(PUBLIC, f))));

// ── the prune still works once the DB IS the source of truth ─────────────
createPage({ slug: 'live', title: 'דף חי', blocks: [{ type: 'text', data: { html: '<p>חי</p>' } }] });
updatePage('live', { publish: true, status: 'published' });

// about.html has no page behind it now — that IS drift, and must be reconciled
exportAll(PUBLIC);

check('non-empty DB exports the published page', fs.existsSync(path.join(PUBLIC, 'live.html')));
check('non-empty DB still prunes a page the DB no longer has',
  !fs.existsSync(path.join(PUBLIC, 'about.html')));

console.log(fail ? '\nFAILED' : '\nAll export-prune checks passed');
process.exit(fail ? 1 : 0);
