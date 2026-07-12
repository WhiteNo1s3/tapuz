'use strict';

/**
 * v0.42 QA — the .pzn source + AST ops editing path.
 * Runs on a throwaway TAPUZ_ROOT.
 *
 * Proves:
 *  1. getPageSource returns canonical .pzn (file-backed and legacy fallback)
 *  2. savePageSource: validates, saves, preserves the author's exact
 *     formatting byte-for-byte, syncs title/tags to the DB index, publishes
 *  3. savePageSource rejects invalid source (unknown module / parse error)
 *  4. applyPageOps: insert / update / duplicate / move / replace / remove /
 *     document — each observable in the re-read source and blocks
 *  5. every edit leaves a revision trail
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

if (!process.env.TAPUZ_ROOT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-pzn-ops-'));
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TAPUZ_ROOT: tmp },
    stdio: 'inherit'
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  process.exit(r.status == null ? 1 : r.status);
}

require('../src/db');
const {
  createPage, getPageByFullPath, getPageSource, savePageSource, applyPageOps, listRevisions
} = require('../src/pages');
const store = require('../src/pzn-store');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// setup
createPage({
  title: 'דף עריכה',
  slug: 'editme',
  blocks: [{ type: 'heading', id: 'h_main', data: { level: 2, text: 'כותרת מקורית' } }]
});

// 1. source read (file-backed)
let src = getPageSource('editme');
check('getPageSource returns .pzn', typeof src === 'string' && src.includes('<bent-heading'));

// legacy fallback: remove the file — source is generated from DB blocks
fs.rmSync(store.pznPathFor('editme', 'draft'));
src = getPageSource('editme');
check('getPageSource falls back to DB for legacy pages', src.includes('<bent-heading'));

// 2. savePageSource — exact formatting preserved
const authored = `<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
  <head>
    <meta charset="utf-8" />
    <title>כותרת חדשה מהמקור</title>
    <meta name="bent-slug" content="editme" />
    <meta name="bent-tags" content="article,מקור" />
  </head>
  <body>
    <!-- authored by hand — formatting must survive -->
    <bent-heading id="h_main" level="1">נכתב כמקור</bent-heading>

    <bent-text id="t_body">פסקה ראשונה.</bent-text>
  </body>
</html>
`;
const saveResult = savePageSource('editme', authored);
check('savePageSource returns blocks', saveResult.blocks.length === 2);
check('author formatting preserved byte-for-byte',
  fs.readFileSync(store.pznPathFor('editme', 'draft'), 'utf8') === authored);
let page = getPageByFullPath('editme');
check('title synced to DB index', page.title === 'כותרת חדשה מהמקור');
check('tags synced to DB index', page.tags.includes('article') && page.tags.includes('מקור'));
check('draft blocks reflect source', page.draft_blocks[0].data.text === 'נכתב כמקור');

// publish through source
savePageSource('editme', authored, { publish: true });
page = getPageByFullPath('editme');
check('publish via source', page.status === 'published' && page.blocks.length === 2);
check('published file matches authored source',
  fs.readFileSync(store.pznPathFor('editme', 'published'), 'utf8') === authored);

// 3. invalid source rejected
let threw = null;
try {
  savePageSource('editme', authored.replace(/bent-heading/g, 'bent-nonsense'));
} catch (e) { threw = e; }
check('unknown module rejected', threw != null && /E_UNKNOWN_MODULE/.test(threw.code || threw.message));
threw = null;
try {
  savePageSource('editme', '<html><body><div>raw html</div></body></html>');
} catch (e) { threw = e; }
check('raw HTML rejected', threw != null);
check('rejected save did not touch the file',
  fs.readFileSync(store.pznPathFor('editme', 'draft'), 'utf8') === authored);

// 4. AST ops
let r = applyPageOps('editme', [
  { op: 'insert', type: 'button', overrides: { id: 'btn_cta', text: 'לחצו', props: { href: '/go' } } },
  { op: 'update', id: 'h_main', props: { level: 3, text: 'עודכן באופ' } }
]);
check('insert+update ops applied', r.blocks.length === 3 && r.blocks[0].data.level === 3 && r.blocks[0].data.text === 'עודכן באופ');
check('ops result serialized to file', getPageSource('editme').includes('btn_cta'));

r = applyPageOps('editme', [{ op: 'duplicate', id: 'btn_cta' }]);
check('duplicate op', r.blocks.filter((b) => b.type === 'button').length === 2);

r = applyPageOps('editme', [{ op: 'move', id: 'h_main', index: 2 }]);
check('move op', r.blocks[0].type !== 'heading');

r = applyPageOps('editme', [{ op: 'replace', id: 't_body', type: 'quote' }]);
check('replace op keeps id and text', r.blocks.some((b) => b.type === 'quote' && b.id === 't_body' && b.data.text === 'פסקה ראשונה.'));

const before = r.blocks.length;
r = applyPageOps('editme', [{ op: 'remove', id: 'btn_cta' }]);
check('remove op', r.blocks.length === before - 1);

r = applyPageOps('editme', [{ op: 'document', patch: { title: 'כותרת מהאופ' } }]);
page = getPageByFullPath('editme');
check('document op syncs title', page.title === 'כותרת מהאופ');

threw = null;
try { applyPageOps('editme', [{ op: 'levitate', id: 'h_main' }]); } catch (e) { threw = e; }
check('unknown op rejected', threw != null);
threw = null;
try { applyPageOps('editme', [{ op: 'remove', id: 'no_such_id' }]); } catch (e) { threw = e; }
check('op on missing id rejected', threw != null);

// 5. revision trail
const revs = listRevisions('editme');
check('every edit left a revision', revs.length >= 8);

console.log('');
console.log(fail ? 'SMOKE PZN OPS: FAIL' : 'SMOKE PZN OPS: PASS');
process.exit(fail ? 1 : 0);
