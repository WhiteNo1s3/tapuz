'use strict';

/**
 * Smoke: first-party analytics (S6) + GA4 injection (S5a).
 *
 * Runs against an isolated TAPUZ_ROOT so the repo's real config/db stay
 * untouched. Boots the real Express server on a test port to exercise the
 * POST /_tapuz/collect collector end-to-end (privacy, validation, admin
 * exclusion, bot filter, DNT, per-IP rate limit), and unit-tests the analytics
 * module + renderer injection directly.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

// Isolate BEFORE requiring any src module — paths.js reads TAPUZ_ROOT at require time.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-smoke-analytics-'));
process.env.TAPUZ_ROOT = root;
process.env.PORT = process.env.SMOKE_PORT || '3987';
process.env.TAPUZ_COLLECT_MAX = '5';      // force a deterministic 429 on the 6th hit per IP
fs.mkdirSync(path.join(root, 'config'), { recursive: true });

function writeSiteConfig(analytics) {
  fs.writeFileSync(
    path.join(root, 'config', 'site.json'),
    JSON.stringify({ title: 'אתר בדיקה', description: 'בדיקת אנליטיקס', setupDone: true, analytics }, null, 2),
    'utf8'
  );
}
writeSiteConfig({ firstParty: { enabled: true, collectorUrl: '/_tapuz/collect' }, ga4: { measurementId: '' } });

let fail = 0;
function check(name, cond, detail) {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (detail && !cond ? ' — ' + detail : ''));
  if (!cond) fail++;
}

const PORT = parseInt(process.env.PORT, 10);

function httpPost(urlPath, body, headers = {}) {
  return new Promise((resolve) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: urlPath, method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, headers) },
      (res) => { res.on('data', () => {}); res.on('end', () => resolve({ status: res.statusCode })); }
    );
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.write(payload);
    req.end();
  });
}

function waitForServer(retries = 40) {
  return new Promise((resolve, reject) => {
    const tick = (left) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/_tapuz/collect', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => {
        res.on('data', () => {}); res.on('end', () => resolve());
      });
      req.on('error', () => { if (left <= 0) return reject(new Error('server did not start')); setTimeout(() => tick(left - 1), 50); });
      req.write('{}'); req.end();
    };
    tick(retries);
  });
}

async function main() {
  // -----------------------------------------------------------------------
  // 1. analytics module — privacy-safe primitives
  // -----------------------------------------------------------------------
  const analytics = require('../src/analytics');
  const { db } = require('../src/db');

  check('device: iPhone -> mobile', analytics.deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0) Mobile') === 'mobile');
  check('device: iPad -> tablet', analytics.deviceClass('Mozilla/5.0 (iPad; CPU OS 16_0) Safari') === 'tablet');
  check('device: desktop default', analytics.deviceClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64)') === 'desktop');
  check('bot: Googlebot flagged', analytics.isBot('Mozilla/5.0 (compatible; Googlebot/2.1)') === true);
  check('bot: normal browser not flagged', analytics.isBot('Mozilla/5.0 (Windows NT 10.0) Chrome/120') === false);
  check('referrerHost: host only, drops path+query', analytics.referrerHost('https://news.example.com/a?utm=x') === 'news.example.com');
  check('referrerHost: empty for direct', analytics.referrerHost('') === '');

  const h1 = analytics.visitorHash('1.2.3.4', 'UA-x');
  const h1b = analytics.visitorHash('1.2.3.4', 'UA-x');
  const h2 = analytics.visitorHash('9.9.9.9', 'UA-x');
  check('visitorHash: 16 hex chars', /^[0-9a-f]{16}$/.test(h1));
  check('visitorHash: stable same day for same ip+ua', h1 === h1b);
  check('visitorHash: differs by ip', h1 !== h2);
  check('visitorHash: not the raw ip', h1.indexOf('1.2.3.4') < 0);

  // -----------------------------------------------------------------------
  // 2. renderer — GA4 snippet + beacon injection
  // -----------------------------------------------------------------------
  const { renderGa4Snippet, renderAnalyticsBeacon, renderPage } = require('../src/renderer');

  check('ga4: absent when no id', renderGa4Snippet({ analytics: { ga4: { measurementId: '' } } }) === '');
  check('ga4: absent for malformed id', renderGa4Snippet({ analytics: { ga4: { measurementId: 'UA-123' } } }) === '');
  const ga4 = renderGa4Snippet({ analytics: { ga4: { measurementId: 'G-ABC12345' } } });
  check('ga4: gtag src with id', ga4.includes('googletagmanager.com/gtag/js?id=G-ABC12345'));
  check('ga4: config call with id', ga4.includes("gtag('config','G-ABC12345')"));

  check('beacon: absent when firstParty disabled', renderAnalyticsBeacon({ analytics: { firstParty: { enabled: false } } }) === '');
  const beacon = renderAnalyticsBeacon({ analytics: { firstParty: { enabled: true, collectorUrl: '/_tapuz/collect' } } });
  check('beacon: sendBeacon to collector url', beacon.includes('sendBeacon') && beacon.includes('/_tapuz/collect'));
  check('beacon: respects Do-Not-Track', beacon.includes('doNotTrack'));

  // renderPage integration: GA4 appears only when the id is configured
  const page = { title: 'דף', blocks: [{ type: 'text', id: 't', data: { content: 'שלום' } }] };
  const htmlNoGa = renderPage(page);
  check('renderPage: no gtag when id empty', !htmlNoGa.includes('gtag/js?id='));
  check('renderPage: beacon present (firstParty on)', htmlNoGa.includes('/_tapuz/collect'));

  writeSiteConfig({ firstParty: { enabled: true, collectorUrl: '/_tapuz/collect' }, ga4: { measurementId: 'G-LIVE9999' } });
  const htmlGa = renderPage(page);
  check('renderPage: gtag injected when id set', htmlGa.includes('gtag/js?id=G-LIVE9999'));
  // restore empty id so the booted server config matches the rest of the run
  writeSiteConfig({ firstParty: { enabled: true, collectorUrl: '/_tapuz/collect' }, ga4: { measurementId: '' } });

  // -----------------------------------------------------------------------
  // 3. dashboard aggregations on seeded rows
  // -----------------------------------------------------------------------
  analytics.recordPageview({ path: '/', referrer: 'https://google.com/', ip: '5.5.5.1', userAgent: 'Chrome mobile Mobile' });
  analytics.recordPageview({ path: '/', referrer: '', ip: '5.5.5.2', userAgent: 'Windows Chrome' });
  analytics.recordPageview({ path: '/about', referrer: 'https://google.com/', ip: '5.5.5.1', userAgent: 'Chrome mobile Mobile' });
  const dash = analytics.dashboardData(30);
  check('dashboard: totals views >= 3', dash.totals.views >= 3);
  check('dashboard: unique visitors counted (2)', dash.totals.visitors >= 2, 'got ' + dash.totals.visitors);
  check('dashboard: byDay gap-filled to 30 entries', dash.byDay.length === 30);
  check('dashboard: top page is / with 2 views', dash.topPages[0] && dash.topPages[0].path === '/' && dash.topPages[0].views === 2);
  check('dashboard: referrer google.com present', dash.topReferrers.some(r => r.host === 'google.com'));
  check('dashboard: device breakdown non-empty', dash.devices.length >= 1);

  // -----------------------------------------------------------------------
  // 4. collector endpoint end-to-end (privacy, validation, exclusion, limit)
  // -----------------------------------------------------------------------
  require('../src/server'); // boots app.listen on PORT
  await waitForServer();

  function countRows() {
    return db.prepare('SELECT COUNT(*) AS c FROM pageviews').get().c;
  }

  // valid pageview inserts exactly one privacy-safe row
  const before = countRows();
  const okRes = await httpPost('/_tapuz/collect', { path: '/hello', ref: 'https://ref.example/x?y=1' },
    { 'X-Forwarded-For': '10.0.0.1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' });
  check('collect: valid POST -> 204', okRes.status === 204, 'status ' + okRes.status);
  check('collect: exactly one row inserted', countRows() === before + 1);

  const row = db.prepare("SELECT * FROM pageviews WHERE path = '/hello' ORDER BY id DESC LIMIT 1").get();
  check('collect: path stored', row && row.path === '/hello');
  check('collect: referrer HOST only (no path/query)', row && row.referrer_host === 'ref.example');
  check('collect: device_class derived server-side', row && row.device_class === 'desktop');
  check('collect: visitor_hash is a 16-hex hash', row && /^[0-9a-f]{16}$/.test(row.visitor_hash || ''));
  check('collect: NO raw IP stored in visitor_hash', row && (row.visitor_hash || '').indexOf('10.0.0.1') < 0);

  // schema has no raw-IP column at all
  const cols = db.prepare('PRAGMA table_info(pageviews)').all().map(c => c.name);
  check('schema: pageviews has no ip column', !cols.includes('ip') && !cols.includes('ip_address'));

  // garbage input is ignored (no crash, no row)
  const g1 = countRows();
  const garbage = await httpPost('/_tapuz/collect', 'not json at all}}}', { 'X-Forwarded-For': '10.0.0.2', 'Content-Type': 'application/json' });
  check('collect: malformed body -> 4xx or 204, no crash', garbage.status === 204 || garbage.status === 400);
  await httpPost('/_tapuz/collect', { path: 'no-leading-slash' }, { 'X-Forwarded-For': '10.0.0.2' });
  await httpPost('/_tapuz/collect', { nope: true }, { 'X-Forwarded-For': '10.0.0.2' });
  check('collect: garbage adds no rows', countRows() === g1);

  // admin paths are never tracked
  const a1 = countRows();
  const admRes = await httpPost('/_tapuz/collect', { path: '/admin/dashboard' }, { 'X-Forwarded-For': '10.0.0.3', 'User-Agent': 'Chrome' });
  check('collect: admin path -> 204', admRes.status === 204);
  check('collect: admin path adds no row', countRows() === a1);

  // bot UA is ignored
  const b1 = countRows();
  await httpPost('/_tapuz/collect', { path: '/bot-visit' }, { 'X-Forwarded-For': '10.0.0.4', 'User-Agent': 'Googlebot/2.1' });
  check('collect: bot UA adds no row', countRows() === b1);

  // DNT header suppresses recording
  const d1 = countRows();
  await httpPost('/_tapuz/collect', { path: '/dnt-visit' }, { 'X-Forwarded-For': '10.0.0.5', 'User-Agent': 'Chrome', 'DNT': '1' });
  check('collect: DNT=1 adds no row', countRows() === d1);

  // per-IP rate limit: TAPUZ_COLLECT_MAX=5 -> 6th request from one IP is 429
  const rlIp = '10.9.9.9';
  let got429 = false;
  for (let i = 0; i < 6; i++) {
    const r = await httpPost('/_tapuz/collect', { path: '/rl' + i }, { 'X-Forwarded-For': rlIp, 'User-Agent': 'Chrome' });
    if (r.status === 429) got429 = true;
  }
  check('collect: per-IP rate limit returns 429', got429);

  console.log(fail ? `\n${fail} failure(s)` : '\nAll analytics smoke checks passed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('smoke-analytics crashed:', e); process.exit(1); });
