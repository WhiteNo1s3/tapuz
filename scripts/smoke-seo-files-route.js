'use strict';

/**
 * v1.27 QA — proves src/routes/seo-files.js works end-to-end as a mounted
 * Express Router: the PUBLIC sitemap.xml + robots.txt, unauthenticated,
 * derived live from published pages. The property that matters most and had
 * NO prior HTTP-level coverage: these routes must answer BEFORE the
 * express.static mounts (a static file must never shadow them), so the test
 * boots a real server and fetches them over the wire, not through the seo
 * module directly.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-seo-files-route-'));
const PORT = 3986;
const BASE = `http://127.0.0.1:${PORT}`;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath) {
  return new Promise((resolve, reject) => {
    const r = http.request(BASE + urlPath, { method, headers: { Accept: '*/*' } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: buf }));
    });
    r.on('error', reject);
    r.end();
  });
}

function waitUp(tries = 40) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + '/', () => resolve()).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start'));
        setTimeout(() => tick(n - 1), 150);
      });
    };
    tick(tries);
  });
}

(async () => {
  process.env.TAPUZ_ROOT = ROOT;
  require('../src/db');
  const { runSetup } = require('../src/setup');
  runSetup({
    title: 'אתר בדיקה', description: 'seo-files-route smoke',
    colors: { primary: '#0a66c2', bg: '#fff', lightBg: '#f0f9ff', text: '#0f172a' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  // set a baseUrl so absolute URLs are deterministic
  const { loadConfig, saveConfig } = require('../src/config');
  const cfg = loadConfig(); cfg.baseUrl = 'https://site.example'; saveConfig(cfg);
  // a real published page so the sitemap has a URL beyond home
  const { createPage, savePageSource } = require('../src/pages');
  createPage({ title: 'עמוד ציבורי', slug: 'public-page', blocks: [] });
  savePageSource('public-page', '<bent-heading level="1">שלום</bent-heading>', { publish: true });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
    stdio: 'ignore'
  });
  try {
    await waitUp();

    // ── sitemap.xml (public, no auth) ──
    const sm = await req('GET', '/sitemap.xml');
    check('GET /sitemap.xml → 200 application/xml, no auth needed', sm.status === 200 && /xml/.test(sm.headers['content-type'] || ''));
    check('sitemap is a real urlset carrying the published page', /<urlset/.test(sm.text) && /public-page/.test(sm.text));
    check('sitemap uses the configured absolute baseUrl', /https:\/\/site\.example/.test(sm.text));

    // ── robots.txt (public, no auth) ──
    const rb = await req('GET', '/robots.txt');
    check('GET /robots.txt → 200 text/plain, no auth needed', rb.status === 200 && /text\/plain/.test(rb.headers['content-type'] || ''));
    check('robots points crawlers at the sitemap', /Sitemap:\s*https:\/\/site\.example\/sitemap\.xml/.test(rb.text));
    check('robots disallows the admin surface', /Disallow:\s*\/admin/.test(rb.text));

    // ── the load-bearing property: these are NOT shadowed by a real static
    //    file of the same name. Plant one, confirm the ROUTE still wins. ──
    fs.writeFileSync(path.join(ROOT, 'public', 'robots.txt'), 'STATIC-FILE-SHOULD-NOT-WIN', 'utf8');
    const rb2 = await req('GET', '/robots.txt');
    check('a static robots.txt does NOT shadow the live route (order is load-bearing)', rb2.status === 200 && !/STATIC-FILE-SHOULD-NOT-WIN/.test(rb2.text) && /Sitemap:/.test(rb2.text));
  } finally {
    child.kill();
  }

  console.log('');
  console.log(fail ? 'SMOKE SEO-FILES-ROUTE: FAIL' : 'SMOKE SEO-FILES-ROUTE: PASS');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
