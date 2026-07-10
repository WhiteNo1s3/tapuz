// E2E: create → draft save → publish → revise → restore
const { createPage, updatePage, publishPage, getPageByFullPath, deletePage } = require('../src/pages');
const { listRevisions } = require('../src/revisions');

const P = 'smoke-test-page';
try { deletePage(P); } catch (e) {}

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

createPage({ title: 'בדיקה', slug: P, blocks: [{ type: 'text', data: { content: 'v1' } }], status: 'draft' });

// draft save should NOT touch published
updatePage(P, { blocks: [{ type: 'text', data: { content: 'v2-draft' } }] });
let p = getPageByFullPath(P);
check('draft updated', p.draft_blocks[0].data.content === 'v2-draft');
check('published empty before first publish', Array.isArray(p.blocks) && p.blocks.length === 0);
check('status still draft', p.status === 'draft');

// publish copies draft -> published
publishPage(P);
p = getPageByFullPath(P);
check('publish copied draft', p.blocks[0].data.content === 'v2-draft');
check('status published', p.status === 'published');

// further draft edit after publish
updatePage(P, { blocks: [{ type: 'text', data: { content: 'v3-draft' } }] });
p = getPageByFullPath(P);
check('new draft on top of published', p.draft_blocks[0].data.content === 'v3-draft');
check('published still v2', p.blocks[0].data.content === 'v2-draft');

// revisions exist
const revs = listRevisions(P);
check('revisions recorded (>=3)', revs.length >= 3);
check('publish revision kind present', revs.some(r => r.kind === 'publish'));

deletePage(P);
check('cleanup ok', !getPageByFullPath(P));

process.exit(fail ? 1 : 0);
