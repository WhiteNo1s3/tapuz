'use strict';

/**
 * v0.40 QA gate 2 — real-data lossless round-trip.
 *
 * Opens the site database READ-ONLY, takes every page's draft and published
 * blocks, and proves:
 *   Tapuz JSON → fromTapuzPage → serialize (.pzn) → parse → toTapuzPage
 * loses nothing.
 *
 * Usage:
 *   node scripts/smoke-pzn-roundtrip.js            # db/tapuz.db
 *   node scripts/smoke-pzn-roundtrip.js path/to/site.db
 *
 * Exit 1 on any diff, with field-level details.
 */

const path = require('path');
const Database = require('better-sqlite3');
const { fromTapuzPage, toTapuzPage, serialize, parse, validate } = require('../src/pzn/index');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'db', 'tapuz.db');

// ─── canonical compare (same rules as test/pzn/tapuz-roundtrip.test.js) ──

function isEmpty(v) {
  return v === undefined || v === null || v === '';
}

function normalizeScalar(v, key) {
  if (key === 'ratio' && Array.isArray(v)) return v.join(':');
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
}

function diff(a, b, p, out) {
  const an = isEmpty(a) ? undefined : a;
  const bn = isEmpty(b) ? undefined : b;
  if (an === undefined && bn === undefined) return;
  if (an === undefined || bn === undefined) {
    out.push(`${p}: ${JSON.stringify(an)} -> ${JSON.stringify(bn)}`);
    return;
  }
  if (Array.isArray(an) || Array.isArray(bn)) {
    if (p.endsWith('ratio')) {
      diff(normalizeScalar(an, 'ratio'), normalizeScalar(bn, 'ratio'), p, out);
      return;
    }
    const aa = Array.isArray(an) ? an : [an];
    const ba = Array.isArray(bn) ? bn : [bn];
    if (aa.length !== ba.length) {
      out.push(`${p}.length: ${aa.length} -> ${ba.length}`);
      return;
    }
    for (let i = 0; i < aa.length; i++) diff(aa[i], ba[i], `${p}[${i}]`, out);
    return;
  }
  if (typeof an === 'object' || typeof bn === 'object') {
    if (typeof an !== 'object' || typeof bn !== 'object') {
      out.push(`${p}: type ${typeof an} -> ${typeof bn}`);
      return;
    }
    const keys = new Set([...Object.keys(an), ...Object.keys(bn)]);
    for (const key of keys) diff(an[key], bn[key], `${p}.${key}`, out);
    return;
  }
  const key = p.split('.').pop();
  if (normalizeScalar(an, key) !== normalizeScalar(bn, key)) {
    out.push(`${p}: ${JSON.stringify(an)} -> ${JSON.stringify(bn)}`);
  }
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// ─── run ─────────────────────────────────────────────────────────────

let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (e) {
  console.error(`Cannot open DB read-only at ${dbPath}: ${e.message}`);
  process.exit(1);
}

const rows = db.prepare(
  'SELECT id, slug, title, direction, theme, status, tags, meta, blocks, draft_blocks FROM pages'
).all();
db.close();

let checked = 0;
let failed = 0;
let blockCount = 0;
const typeCounts = {};

for (const row of rows) {
  const tags = parseJson(row.tags, []);
  const meta = parseJson(row.meta, {});
  for (const [kind, blocksJson] of [['published', row.blocks], ['draft', row.draft_blocks]]) {
    const blocks = parseJson(blocksJson, null);
    if (!Array.isArray(blocks)) continue;
    checked++;
    blockCount += blocks.length;
    for (const b of blocks) typeCounts[b?.type || '?'] = (typeCounts[b?.type || '?'] || 0) + 1;

    const page = {
      title: row.title || '',
      slug: row.slug || '',
      direction: row.direction || 'rtl',
      lang: 'he',
      tags: Array.isArray(tags) ? tags : [],
      meta: meta && typeof meta === 'object' ? meta : {},
      blocks
    };

    try {
      const doc = fromTapuzPage(page);
      const src = serialize(doc);
      const reparsed = parse(src);
      const errors = validate(reparsed, { strict: false }).filter((i) => i.severity === 'error');
      if (errors.length) {
        failed++;
        console.log(`FAIL ${row.slug} [${kind}] — .pzn does not validate:`);
        for (const e of errors) console.log(`     ${e.code} ${e.message} (${e.path || ''})`);
        continue;
      }
      const back = toTapuzPage(reparsed);
      const diffs = [];
      diff(page.blocks, back.blocks, 'blocks', diffs);
      if (diffs.length) {
        failed++;
        console.log(`FAIL ${row.slug} [${kind}] — ${diffs.length} diff(s):`);
        for (const d of diffs.slice(0, 10)) console.log(`     ${d}`);
      } else {
        console.log(`OK   ${row.slug} [${kind}] — ${blocks.length} blocks lossless`);
      }
    } catch (e) {
      failed++;
      console.log(`FAIL ${row.slug} [${kind}] — threw: ${e.message}`);
    }
  }
}

console.log('');
console.log(`pages checked: ${rows.length} | block sets: ${checked} | blocks: ${blockCount}`);
console.log(`block types seen: ${Object.entries(typeCounts).map(([t, n]) => `${t}×${n}`).join(', ') || '(none)'}`);
if (failed) {
  console.log(`SMOKE PZN ROUNDTRIP: FAIL (${failed})`);
  process.exit(1);
}
console.log('SMOKE PZN ROUNDTRIP: PASS');
