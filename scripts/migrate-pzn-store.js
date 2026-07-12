'use strict';

/**
 * v0.41 migration — backfill canonical .pzn files from the DB index.
 *
 * Idempotent: existing files are left alone (they are the truth) unless
 * --force is passed. Run against any site with TAPUZ_ROOT.
 *
 * Usage:
 *   node scripts/migrate-pzn-store.js [--force]
 */

const fs = require('fs');
const { db } = require('../src/db');
const store = require('../src/pzn-store');

const force = process.argv.includes('--force');
const rows = db.prepare('SELECT * FROM pages').all();

let written = 0;
let skipped = 0;

for (const row of rows) {
  const tags = JSON.parse(row.tags || '[]');
  const meta = JSON.parse(row.meta || '{}');
  const pageLike = {
    title: row.title,
    full_path: row.full_path,
    direction: row.direction || 'rtl',
    tags,
    meta
  };

  const jobs = [];
  const draft = row.draft_blocks != null ? row.draft_blocks : row.blocks;
  jobs.push(['draft', draft]);
  if (row.status === 'published') jobs.push(['published', row.blocks]);

  for (const [kind, blocksJson] of jobs) {
    let blocks;
    try {
      blocks = JSON.parse(blocksJson || '[]');
    } catch {
      console.log(`SKIP ${row.full_path} [${kind}] — unparseable JSON in DB`);
      skipped++;
      continue;
    }
    const file = store.pznPathFor(row.full_path, kind);
    if (!force && fs.existsSync(file)) {
      console.log(`KEEP ${row.full_path} [${kind}] — file exists (canonical)`);
      skipped++;
      continue;
    }
    store.writePagePzn(pageLike, blocks, kind);
    console.log(`WROTE ${row.full_path} [${kind}] → ${file}`);
    written++;
  }
}

console.log('');
console.log(`pages: ${rows.length} | files written: ${written} | kept/skipped: ${skipped}`);
