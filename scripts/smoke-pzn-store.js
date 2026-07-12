'use strict';

/**
 * v0.41 QA — the .pzn file IS the canonical page content.
 * Runs on a throwaway TAPUZ_ROOT (same pattern as smoke-wizard.js).
 *
 * Proves:
 *  1. createPage writes pages/drafts/<path>.pzn
 *  2. publish writes pages/published/<path>.pzn
 *  3. EDITING THE FILE ON DISK changes what the CMS serves  ← the flip
 *  4. revisions are stored as .pzn text and restore correctly
 *  5. rename moves the files; delete removes them
 *  6. legacy fallback: no file → DB JSON still serves
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

if (!process.env.TAPUZ_ROOT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-pzn-store-'));
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TAPUZ_ROOT: tmp },
    stdio: 'inherit'
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  process.exit(r.status == null ? 1 : r.status);
}

require('../src/db'); // auto-initializes schema on the throwaway root
const {
  createPage, updatePage, publishPage, getPageByFullPath,
  deletePage, restoreRevision, listRevisions, getRevision
} = require('../src/pages');
const store = require('../src/pzn-store');
const { db } = require('../src/db');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// 1. create → draft file exists and parses
createPage({
  title: 'דף קנוני',
  slug: 'canon',
  blocks: [
    { type: 'heading', data: { level: 2, text: 'שלום מהקובץ' } },
    { type: 'text', data: { content: 'התוכן חי בקובץ.' } }
  ],
  tags: ['בדיקה'],
  meta: { teaser: 'תקציר' }
});
const draftFile = store.pznPathFor('canon', 'draft');
check('create writes draft .pzn', fs.existsSync(draftFile));
check('draft .pzn contains bent-heading', fs.readFileSync(draftFile, 'utf8').includes('<bent-heading'));

// 2. publish → published file
publishPage('canon');
const pubFile = store.pznPathFor('canon', 'published');
check('publish writes published .pzn', fs.existsSync(pubFile));
let page = getPageByFullPath('canon');
check('published blocks come through', page.blocks.length === 2 && page.blocks[0].data.text === 'שלום מהקובץ');

// 3. THE FLIP — edit the file on disk, CMS must see it
const edited = fs.readFileSync(draftFile, 'utf8')
  .replace('שלום מהקובץ', 'נערך ישירות בקובץ');
fs.writeFileSync(draftFile, edited, 'utf8');
page = getPageByFullPath('canon');
check('file edit is visible in CMS draft (file is canonical)', page.draft_blocks[0].data.text === 'נערך ישירות בקובץ');
check('DB index still holds the old value (proving overlay, not DB)', (() => {
  const raw = db.prepare('SELECT draft_blocks FROM pages WHERE full_path = ?').get('canon');
  return JSON.parse(raw.draft_blocks)[0].data.text === 'שלום מהקובץ';
})());

// 4. revisions stored as .pzn text; restore works
updatePage('canon', { blocks: [{ type: 'text', data: { content: 'גרסה שנייה' } }] });
const revs = listRevisions('canon');
check('revisions exist', revs.length >= 2);
const latest = getRevision(revs[0].id);
check('latest revision is stored as .pzn', latest.pzn != null && latest.pzn.trim().startsWith('<!DOCTYPE'));
check('revision parses back to blocks', latest.blocks.length === 1 && latest.blocks[0].data.content === 'גרסה שנייה');
const older = revs.find((r) => getRevision(r.id).blocks.some((b) => b.type === 'heading'));
check('older revision found', !!older);
restoreRevision('canon', older.id);
page = getPageByFullPath('canon');
check('restore brings back heading (through the file)', page.draft_blocks.some((b) => b.type === 'heading'));
check('restore rewrote the draft file', fs.readFileSync(draftFile, 'utf8').includes('<bent-heading'));

// 5. rename moves files
updatePage('canon', { slug: 'canon-renamed' });
check('rename moved draft file', fs.existsSync(store.pznPathFor('canon-renamed', 'draft')) && !fs.existsSync(draftFile));
check('rename moved published file', fs.existsSync(store.pznPathFor('canon-renamed', 'published')) && !fs.existsSync(pubFile));

// 6. legacy fallback — delete the file, DB JSON must still serve
fs.rmSync(store.pznPathFor('canon-renamed', 'draft'));
page = getPageByFullPath('canon-renamed');
check('no file → DB fallback serves draft blocks', Array.isArray(page.draft_blocks) && page.draft_blocks.length > 0);

// migration backfills the file we deleted
const { spawnSync } = require('child_process');
const mig = spawnSync(process.execPath, [path.join(__dirname, 'migrate-pzn-store.js')], {
  env: process.env, encoding: 'utf8'
});
check('migration script exits 0', mig.status === 0);
check('migration backfilled the missing draft file', fs.existsSync(store.pznPathFor('canon-renamed', 'draft')));

// delete removes files
deletePage('canon-renamed');
check('delete removes files', !fs.existsSync(store.pznPathFor('canon-renamed', 'draft')) && !fs.existsSync(store.pznPathFor('canon-renamed', 'published')));

console.log('');
console.log(fail ? 'SMOKE PZN STORE: FAIL' : 'SMOKE PZN STORE: PASS');
process.exit(fail ? 1 : 0);
