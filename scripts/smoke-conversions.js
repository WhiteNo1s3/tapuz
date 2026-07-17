'use strict';

/**
 * v0.84 QA gate — conversion analytics: form submissions joined to pageviews
 * per page, across the two stores' different path shapes (percent-encoded
 * pathname vs decoded slug). Throwaway site via TAPUZ_ROOT. Exit 1 on failure.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// BEFORE any src require — src/paths.js resolves TAPUZ_ROOT at require time
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-conv-'));
process.env.TAPUZ_ROOT = tmpRoot;

const analytics = require('../src/analytics');
const forms = require('../src/forms');

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// ── normalization: both stores meet on one key ──
check(analytics.normalizePagePath('/%D7%A6%D7%95%D7%A8-%D7%A7%D7%A9%D7%A8.html') === 'צור-קשר',
  'percent-encoded pathname normalizes to the decoded slug');
check(analytics.normalizePagePath('צור-קשר') === 'צור-קשר', 'decoded slug is already canonical');
check(analytics.normalizePagePath('/') === '', 'root path → empty key (the homepage)');
check(analytics.normalizePagePath('/%zz') === '/%zz'.replace(/^\/+/, ''), 'malformed percent survives raw');

// ── seed views + submissions with the REAL store shapes ──
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120';
for (let i = 0; i < 8; i++) {
  analytics.recordPageview({ path: '/%D7%A6%D7%95%D7%A8-%D7%A7%D7%A9%D7%A8', ip: '10.0.0.' + i, userAgent: ua });
}
for (let i = 0; i < 4; i++) {
  analytics.recordPageview({ path: '/about', ip: '10.0.1.' + i, userAgent: ua });
}
forms.saveSubmission({ page: 'צור-קשר', fields: { שם: 'א' } });
forms.saveSubmission({ page: 'צור-קשר', fields: { שם: 'ב' } });
forms.saveSubmission({ page: '', fields: { שם: 'מדף הבית' } }); // unattributed/homepage

const conv = analytics.conversions(30);
check(conv.total === 3, 'total submissions counted');
const contact = conv.pages.find((p) => p.page === 'צור-קשר');
check(!!contact, 'contact page appears in conversions');
check(contact && contact.views === 8, 'encoded pageviews joined to the decoded slug');
check(contact && contact.submissions === 2, 'submissions per page counted');
check(contact && Math.abs(contact.rate - 0.25) < 1e-9, 'rate = submissions / views (2/8)');
check(conv.pages[0].page === 'צור-קשר', 'sorted by submissions desc');
const home = conv.pages.find((p) => p.page === '(דף הבית)');
check(!!home && home.views === 0 && home.rate === null, 'pageless submission shows with — rate, never divides by zero');
check(Math.abs(conv.rate - 3 / 12) < 1e-9, 'overall rate = total submissions / total views');

// dashboardData carries it
check(typeof analytics.dashboardData(30).conversions === 'object', 'dashboardData exposes conversions');

// ── CSV export (v0.87) — every dashboard card leaves as a spreadsheet ──
const { csvTable } = require('../src/csv');
const daily = analytics.exportTable('daily', 30);
check(daily && daily.head.join() === 'day,views,visitors' && daily.rows.length === 30,
  'daily table: one row per calendar day, gap-filled');
const pages = analytics.exportTable('pages', 30);
check(pages && pages.rows.some((r) => r[0] === 'צור-קשר' && r[1] === 8),
  'pages table: decoded slugs with view counts');
const convT = analytics.exportTable('conversions', 30);
check(convT && convT.head.join() === 'page,views,submissions,rate_percent' &&
  convT.rows.some((r) => r[0] === 'צור-קשר' && r[2] === 2 && r[3] === 25),
  'conversions table: rate as a percent number (25 for 2/8)');
check(convT.rows.some((r) => r[0] === '(דף הבית)' && r[3] === ''),
  'zero-view page exports an empty rate, not NaN');
check(analytics.exportTable('nope', 30) === null, 'unknown table name → null (route 400s)');
const sheet = csvTable(convT.head, convT.rows);
check(sheet.charCodeAt(0) === 0xfeff && sheet.includes('\r\n') && sheet.includes('"צור-קשר"'),
  'csvTable output is Excel-ready (BOM, CRLF, quoted Hebrew)');
check(require('../src/csv').cell('=SUM(A1)') === '"\'=SUM(A1)"',
  'shared cell() keeps the formula-injection guard');

try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

console.log('');
if (failures) {
  console.log('SMOKE CONVERSIONS: FAIL (' + failures + ')');
  process.exit(1);
}
console.log('SMOKE CONVERSIONS: PASS');
