'use strict';

/**
 * v1.85 QA — BenTML repair telemetry.
 *
 * The instrument exists to answer "is the syntax a problem for models?", so the
 * tests care that the numbers are trustworthy: clean documents are counted (the
 * denominator), fixes aggregate by (code, element), nothing about CONTENT is
 * ever stored, and a telemetry failure can never break the parse it measures.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-repair-stats-'));
process.env.TAPUZ_ROOT = ROOT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const stats = require('../src/pzn-repair-stats');
const { pznSourceToBlocks } = require('../src/pzn-source');
const { db } = require('../src/db');

const CLEAN_DOC = `<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
  <head><meta charset="utf-8" /><title>נקי</title><meta name="bent-slug" content="clean-p" /></head>
  <body><bent-hero id="h"><bent-heading id="hh" level="1">שלום</bent-heading></bent-hero></body>
</html>`;

// url= instead of href= — the classic PROP_ALIAS the models actually make
const ALIAS_DOC = CLEAN_DOC
  .replace('<bent-hero id="h">', '<bent-hero id="h"><bent-button id="b" url="/contact">צרו קשר</bent-button>')
  .replace('content="clean-p"', 'content="alias-p"');

// ── the pipeline records both outcomes ───────────────────────────────
check('a clean document is counted as CLEAN (the denominator)', (() => {
  const before = stats.summary().clean;
  pznSourceToBlocks(CLEAN_DOC);
  const s = stats.summary();
  return s.clean === before + 1 && s.documents >= 1;
})());

check('a document needing a fix records the code AND the element', (() => {
  pznSourceToBlocks(ALIAS_DOC);
  const s = stats.summary();
  return s.topFixes.some((f) => f.code === 'PROP_ALIAS' && f.element === 'button');
})());

check('repeats aggregate rather than duplicate', (() => {
  const before = (stats.summary().byCode.PROP_ALIAS || 0);
  pznSourceToBlocks(ALIAS_DOC.replace('alias-p', 'alias-p2'));
  return (stats.summary().byCode.PROP_ALIAS || 0) === before + 1 &&
    stats.summary().topFixes.filter((f) => f.code === 'PROP_ALIAS' && f.element === 'button').length === 1;
})());

check('the clean rate is arithmetic, not vibes', (() => {
  const s = stats.summary();
  return s.cleanRate === Math.round((s.clean / s.documents) * 100);
})());

// ── privacy: the language is measured, never the author or the content ──
check('NOTHING from the document body is stored', (() => {
  const rows = db.prepare('SELECT code, element FROM pzn_repair_stats').all();
  const dump = JSON.stringify(rows);
  return !dump.includes('שלום') && !dump.includes('צרו קשר') && !dump.includes('/contact');
})());
check('the schema physically cannot hold content (two short text columns)', (() => {
  const cols = db.prepare('PRAGMA table_info(pzn_repair_stats)').all().map((c) => c.name).sort();
  return cols.join(',') === 'code,count,element,last_seen';
})());

// ── telemetry can never break the thing it measures ──────────────────
check('a broken stats table does not break parsing', (() => {
  db.exec('DROP TABLE pzn_repair_stats');
  let threw = false;
  let out = null;
  try { out = pznSourceToBlocks(CLEAN_DOC.replace('clean-p', 'clean-p3')); } catch (e) { threw = true; }
  return !threw && out && out.view.blocks.length > 0;
})());
check('summary degrades to zeros, never throws', (() => {
  const s = stats.summary();
  return s.documents === 0 && s.cleanRate === null && Array.isArray(s.topFixes);
})());
check('the table self-heals on the next initialize', (() => {
  require('../src/db').initialize();
  stats.record({ changes: [], repaired: false });
  return stats.summary().clean === 1;
})());

// ── element extraction ───────────────────────────────────────────────
check('the element is parsed from the message, not guessed',
  stats.elementOf({ message: '<bent-carousel> "img" → "src"' }) === 'carousel' &&
  stats.elementOf({ message: 'dir "ltr" → "rtl"' }) === '' &&
  stats.elementOf({}) === '');

console.log('');
console.log(fail ? 'SMOKE REPAIR-STATS: FAIL' : 'SMOKE REPAIR-STATS: PASS');
try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit(fail ? 1 : 0);
