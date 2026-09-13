'use strict';

/**
 * v2.31 QA — the version rule, enforced.
 *
 * docs/ROADMAP.md "How versions work": every working session that ships is
 * +0.01, and each bump gets a row in the Version Log. The number is a count
 * of shipped sessions — v2.31 means we passed through every step from v0.01.
 * Ben (2026-09-13), on an agent PR that bumped 2.31.0-alpha to 3.32.0-alpha:
 * "it ruined the version by increasing +1.0 — it's not correct, still alpha;
 * it shows how many versions we pass through because we started 0.01
 * increments". Nothing checked it, so a chore PR could jump a hundred
 * versions, or bump with nothing shipped and no row.
 *
 * Pinned, no DB, no server:
 *   1. package.json is X.YY.Z-alpha — still alpha, the patch digit is the
 *      rare hotfix (v1.59.1), the session count lives in YY
 *   2. package-lock.json, the ROADMAP "Current version" line, the README line
 *      and the Version Log's TOP row all name that same version — a bump
 *      without its row (what shipped, whose idea) fails here
 *   3. the top row is exactly +0.01 over the row under it (or its hotfix) —
 *      no +1.0, no skipped sessions, no going backwards
 * The log's old gaps (rows written late or merged) are history; only the
 * newest step is judged.
 */

const fs = require('fs');
const path = require('path');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const pkg = JSON.parse(read('package.json')).version;
const lock = JSON.parse(read('package-lock.json'));
const roadmap = read('docs/ROADMAP.md');
const readme = read('README.md');

// 1. the shape
const m = /^(\d+)\.(\d{2})\.(\d+)-alpha$/.exec(pkg);
check(`package.json version "${pkg}" is X.YY.Z-alpha (still alpha, two-digit session count)`, !!m);

/** "2.31.0-alpha" → "v2.31-alpha", "1.59.1-alpha" → "v1.59.1-alpha" */
const label = m ? `v${m[1]}.${m[2]}${m[3] !== '0' ? '.' + m[3] : ''}-alpha` : '';

// 2. every place that names the version agrees
check(`package-lock.json mirrors it (root + packages[""]) — ${lock.version} / ${(lock.packages && lock.packages[''] || {}).version}`,
  lock.version === pkg && lock.packages && lock.packages[''] && lock.packages[''].version === pkg);
const current = (roadmap.match(/\*\*Current version: (v[^*]+)\*\*/) || [])[1] || '';
check(`ROADMAP "Current version" (${current || 'missing'}) is ${label}`, current === label);
const readmeCurrent = (readme.match(/\*\*גרסה נוכחית: (v[^*]+)\*\*/) || [])[1] || '';
check(`README "גרסה נוכחית" (${readmeCurrent || 'missing'}) is ${label}`, readmeCurrent === label);

const rows = [...roadmap.matchAll(/^\| v(\d+)\.(\d+)(?:\.(\d+))?(-[a-z]+)? \|/gm)]
  .map((r) => ({ label: r[0].slice(2, -2).trim(), count: Number(r[1]) * 100 + Number(r[2]), patch: Number(r[3] || 0) }));
const [top, prev] = rows;
check(`the Version Log's top row (${top ? top.label : 'missing'}) is ${label} — a bump carries its row: what shipped, whose idea`,
  !!top && top.label === label);

// 3. the step
/** +0.01, or a hotfix (.1, .2 …) of the same session — nothing else. */
function stepOk(newer, older) {
  const d = newer.count - older.count;
  return (d === 1 && newer.patch === 0) || (d === 0 && newer.patch === older.patch + 1);
}
check(`the newest step ${prev ? prev.label : '?'} → ${top ? top.label : '?'} is +0.01 (or a hotfix of the same session) — never +1.0, never a skip or a step back`,
  !!top && !!prev && stepOk(top, prev));

// the rule itself, on the steps that matter
const v = (maj, min, patch = 0) => ({ count: maj * 100 + min, patch });
check('the rule refuses 2.31 → 3.32 (the +1.0 an agent PR shipped), a skipped session (2.31 → 2.33) and a step back (2.31 → 2.30)',
  !stepOk(v(3, 32), v(2, 31)) && !stepOk(v(2, 33), v(2, 31)) && !stepOk(v(2, 30), v(2, 31)));
check('the rule accepts 2.31 → 2.32, the century roll 1.99 → 2.00, and a hotfix 1.59 → 1.59.1',
  stepOk(v(2, 32), v(2, 31)) && stepOk(v(2, 0), v(1, 99)) && stepOk(v(1, 59, 1), v(1, 59)));

console.log(fail ? '\nSMOKE VERSION: FAIL' : '\nSMOKE VERSION: PASS');
process.exit(fail ? 1 : 0);
