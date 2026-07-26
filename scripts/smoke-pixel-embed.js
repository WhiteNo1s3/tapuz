'use strict';

/**
 * v1.99 — universal pixel embed, rebuilt safely.
 *
 * The lab finding that must not ship: identify({email}) → upsertContact from an
 * unauthenticated cross-origin body. Here we prove the rebuild:
 *   - unknown site_id → silent 204, no rows
 *   - registered site + anonymous page → pageviews with site_id, zero crm_events
 *   - identify with claims off → no claim, no contact
 *   - identify with claims on → claim inbox only, still no contact until approve
 *   - approve → contact via normal upsert
 *   - forged email on native (no site_id) collector cannot mint a contact
 *   - HTTPS-only snippets outside localhost
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-pixel-'));
process.env.TAPUZ_ROOT = ROOT;
const PORT = 3971;
const BASE = 'http://127.0.0.1:' + PORT;

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

function req(method, urlPath, { body, origin, headers: extra } = {}) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ Accept: '*/*' }, extra || {});
    if (origin) headers.Origin = origin;
    let data = null;
    if (body != null) {
      data = typeof body === 'string' ? body : JSON.stringify(body);
      headers['Content-Type'] = headers['Content-Type'] || 'text/plain';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = http.request(
      BASE + urlPath,
      { method, headers },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, text: buf })
        );
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── pure helpers (no server) ─────────────────────────────────────────
const sites = require('../src/crm/sites');
const claims = require('../src/crm/identity-claims');
const contacts = require('../src/crm/contacts');
const events = require('../src/crm/events');
const config = require('../src/config');
const { db } = require('../src/db');

check('HTTPS snippet accepted', !!sites.buildSnippet({ base: 'https://crm.example.com', siteId: 'shop-il' }));
check('http non-local snippet refused', sites.buildSnippet({ base: 'http://crm.example.com', siteId: 'shop-il' }) === '');
check('http localhost snippet allowed for dev', !!sites.buildSnippet({ base: 'http://127.0.0.1:3000', siteId: 'dev' }));
check('normalizeSlug cleans junk', sites.normalizeSlug(' My Site!! ') === 'my-site');

const loader = fs.readFileSync(path.join(__dirname, '..', 'public', 'tz-pixel.js'), 'utf8');
check('loader has identify that sends type identify', /type:\s*['"]identify['"]/.test(loader));
check('loader never puts email on page()', /page:\s*function[\s\S]{0,800}email:/.test(loader) === false ||
  !/page:\s*function[\s\S]*?return send\(\{[\s\S]*?email:/.test(loader));
check('loader uses credentials omit', /credentials:\s*['"]omit['"]/.test(loader));
check('loader prefers text/plain simple mode', /text\/plain/.test(loader));

// claim module alone
const c0 = claims.recordClaim({ siteId: 'x', email: 'a@b.com', path: '/p' });
check('recordClaim creates pending', c0.ok && c0.claim && c0.claim.status === 'pending');
check('recordClaim did not create a contact', contacts.findByEmail('a@b.com') == null);
const ap = claims.approveClaim(c0.claim.id);
check('approve creates contact', ap.ok && ap.contact && ap.contact.email === 'a@b.com');
check('approve is idempotent-ish', claims.approveClaim(c0.claim.id).already === true);

// ── live server ──────────────────────────────────────────────────────
config.saveConfig(
  Object.assign(config.loadConfig(), {
    crm: {
      enabled: true,
      pixelEmbed: { enabled: true },
      cards: { progressive: true, quietDays: 5, garbageDays: 3 }
    },
    baseUrl: 'https://crm.test'
  })
);

// seed admin for nothing needed — public collect only
const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
  env: Object.assign({}, process.env, { TAPUZ_ROOT: ROOT, PORT: String(PORT) }),
  stdio: ['ignore', 'pipe', 'pipe']
});

function waitUp() {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function tick() {
      http
        .get(BASE + '/', (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - t0 > 8000) reject(new Error('server up timeout'));
          else setTimeout(tick, 100);
        });
    })();
  });
}

(async () => {
  try {
    await waitUp();

    // register a site
    sites.createSite({
      slug: 'wp-local',
      label: 'WP',
      allowedOrigins: ['https://shop.example.com'],
      claimsEnabled: false,
      active: true
    });
    sites.createSite({
      slug: 'open-claims',
      label: 'Claims',
      allowedOrigins: [],
      claimsEnabled: true,
      active: true
    });

    // unknown site → 204, no analytics
    const beforePv = db.prepare('SELECT COUNT(*) AS n FROM pageviews').get().n;
    const beforeEv = db.prepare('SELECT COUNT(*) AS n FROM crm_events').get().n;
    const beforeContacts = db.prepare('SELECT COUNT(*) AS n FROM crm_contacts').get().n;

    const unk = await req('POST', '/_tapuz/collect', {
      origin: 'https://evil.example',
      body: { path: '/hack', type: 'pageview', site_id: 'not-registered', email: 'x@y.com' }
    });
    check('unknown site_id → 204', unk.status === 204);
    check('unknown site leaves pageviews unchanged',
      db.prepare('SELECT COUNT(*) AS n FROM pageviews').get().n === beforePv);
    check('unknown site leaves contacts unchanged',
      db.prepare('SELECT COUNT(*) AS n FROM crm_contacts').get().n === beforeContacts);

    // registered but wrong origin
    const badOrigin = await req('POST', '/_tapuz/collect', {
      origin: 'https://other.example',
      body: { path: '/p', type: 'pageview', site_id: 'wp-local' }
    });
    check('wrong origin → 204', badOrigin.status === 204);
    check('wrong origin no pageview',
      db.prepare('SELECT COUNT(*) AS n FROM pageviews').get().n === beforePv);

    // registered + good origin → analytics with site_id, NOT crm_events
    const okPage = await req('POST', '/_tapuz/collect', {
      origin: 'https://shop.example.com',
      body: { path: '/products/shoes', type: 'pageview', site_id: 'wp-local', ref: 'https://google.com/q?x=1' }
    });
    check('registered foreign page → 204', okPage.status === 204);
    const pv = db.prepare("SELECT * FROM pageviews WHERE site_id = 'wp-local' ORDER BY id DESC LIMIT 1").get();
    check('foreign page landed in pageviews with site_id', pv && pv.path === '/products/shoes');
    check('foreign anonymous did NOT open crm_events',
      db.prepare('SELECT COUNT(*) AS n FROM crm_events').get().n === beforeEv);

    // identify with claims DISABLED on site → no claim, no contact
    const idOff = await req('POST', '/_tapuz/collect', {
      origin: 'https://shop.example.com',
      body: { path: '/', type: 'identify', site_id: 'wp-local', email: 'victim@example.com' }
    });
    check('identify claims-off → 204', idOff.status === 204);
    check('identify claims-off creates no contact',
      contacts.findByEmail('victim@example.com') == null);
    check('identify claims-off creates no pending claim for that site',
      claims.listClaims({ status: 'pending' }).filter((c) => c.email === 'victim@example.com' && c.site_id === 'wp-local').length === 0);

    // identify with claims ON → claim only
    const idOn = await req('POST', '/_tapuz/collect', {
      origin: 'https://foreign.test',
      body: {
        path: '/checkout',
        type: 'identify',
        site_id: 'open-claims',
        email: 'real-person@example.com',
        person_name: 'Real'
      }
    });
    check('identify claims-on → 204', idOn.status === 204);
    check('identify claims-on still no contact',
      contacts.findByEmail('real-person@example.com') == null);
    const pending = claims.listClaims({ status: 'pending', siteId: 'open-claims' });
    check('identify claims-on created pending claim',
      pending.some((c) => c.email === 'real-person@example.com'));

    // even with email on a pageview for claims site — claim, not contact
    await req('POST', '/_tapuz/collect', {
      body: {
        path: '/x',
        type: 'pageview',
        site_id: 'open-claims',
        email: 'sneak@example.com'
      }
    });
    check('email on foreign pageview does not upsert contact',
      contacts.findByEmail('sneak@example.com') == null);
    check('email on foreign pageview is a claim',
      claims.listClaims({ status: 'pending' }).some((c) => c.email === 'sneak@example.com'));

    // native collector: email field must not mint contacts
    const native = await req('POST', '/_tapuz/collect', {
      body: { path: '/home', type: 'pageview', email: 'native-forge@example.com' }
    });
    check('native collect with forged email → 204', native.status === 204);
    check('native collect does not upsert from email field',
      contacts.findByEmail('native-forge@example.com') == null);

    // approve claim
    const claim = claims.listClaims({ status: 'pending' }).find((c) => c.email === 'real-person@example.com');
    const approved = claims.approveClaim(claim.id);
    check('admin approve creates the contact',
      approved.ok && contacts.findByEmail('real-person@example.com'));

    // CORS preflight
    const opt = await req('OPTIONS', '/_tapuz/collect', { origin: 'https://shop.example.com' });
    check('OPTIONS preflight 204', opt.status === 204);
    check('OPTIONS ACAO *', (opt.headers['access-control-allow-origin'] || '') === '*');

    // loader served
    const js = await req('GET', '/tz-pixel.js');
    check('GET /tz-pixel.js 200', js.status === 200 && /TapuzielPixel/.test(js.text));

    // pixelEmbed off → foreign dropped
    config.saveConfig(
      Object.assign(config.loadConfig(), {
        crm: { enabled: true, pixelEmbed: { enabled: false } }
      })
    );
    // force config re-read by hitting after save — sites.pixelEmbedEnabled reads live
    const off = await req('POST', '/_tapuz/collect', {
      origin: 'https://shop.example.com',
      body: { path: '/off', type: 'pageview', site_id: 'wp-local' }
    });
    check('pixelEmbed off → foreign 204', off.status === 204);
    check('pixelEmbed off no new site pageview for /off',
      !db.prepare("SELECT 1 FROM pageviews WHERE path = '/off'").get());

    // source: no upsertContact *call* from collect-handler (comments may name it)
    const ch = fs.readFileSync(path.join(__dirname, '..', 'src', 'crm', 'collect-handler.js'), 'utf8');
    check('collect-handler never calls upsertContact',
      !/\.upsertContact\s*\(/.test(ch) && !/require\([^)]*contacts[^)]*\)\.upsertContact/.test(ch));
  } catch (e) {
    console.error(e);
    fail = true;
  } finally {
    try { server.kill('SIGTERM'); } catch (e) { /* */ }
    console.log(fail ? '\nSMOKE PIXEL-EMBED: FAIL' : '\nSMOKE PIXEL-EMBED: PASS');
    process.exit(fail ? 1 : 0);
  }
})();
