// E2E: create → draft save → publish → revise → restore
const { createPage, updatePage, publishPage, unpublishPage, getPageByFullPath, deletePage } = require('../src/pages');
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

// unpublish returns the page to draft and keeps the published content
unpublishPage(P);
p = getPageByFullPath(P);
check('unpublish sets status draft', p.status === 'draft');
check('unpublish keeps published content in draft_blocks', p.draft_blocks[0].data.content === 'v2-draft');
check('unpublish revision kind present', listRevisions(P).some(r => r.kind === 'unpublish'));

deletePage(P);
check('cleanup ok', !getPageByFullPath(P));

// a database made before 'unpublish' (narrow CHECK) is widened once at boot,
// every old revision copied across — run in a fresh site root
{
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-revkind-'));
  fs.mkdirSync(path.join(root, 'db'), { recursive: true });
  const Database = require('better-sqlite3');
  const old = new Database(path.join(root, 'db', 'tapuz.db'));
  old.exec(`CREATE TABLE page_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, page_id INTEGER, full_path TEXT NOT NULL,
    title TEXT, status TEXT,
    kind TEXT DEFAULT 'draft' CHECK(kind IN ('draft', 'publish', 'restore')),
    blocks TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  old.prepare("INSERT INTO page_revisions (full_path, title, status, kind, blocks) VALUES ('old-page', 'ישן', 'published', 'publish', '[]')").run();
  old.close();
  let out = '';
  try {
    out = execFileSync(process.execPath, ['-e', `
      const { db } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db'))});
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name='page_revisions'").get().sql;
      const kept = db.prepare("SELECT COUNT(*) n FROM page_revisions WHERE full_path='old-page' AND kind='publish'").get().n;
      db.prepare("INSERT INTO page_revisions (full_path, kind, blocks) VALUES ('old-page', 'unpublish', '[]')").run();
      console.log(JSON.stringify({ widened: sql.includes("'unpublish'"), kept }));
    `], { env: Object.assign({}, process.env, { TAPUZ_ROOT: root }), encoding: 'utf8' });
  } catch (e) { out = String(e.stdout || '') + String(e.message || ''); }
  const last = out.trim().split('\n').pop();
  let r = {};
  try { r = JSON.parse(last); } catch (e) {}
  check('an old database is widened to accept kind unpublish', r.widened === true);
  check('the widening keeps every old revision', r.kept === 1);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
}

process.exit(fail ? 1 : 0);
