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
 *
 * v2.21 — foreign visitor stitching (found by the live WordPress ↔ CRM test:
 * the person existed, the form event landed, and NOT ONE WordPress pageview
 * reached the timeline — approval bound no browser, and the collector never
 * looked for one):
 *   - an anonymous vid is never stored; unlinked foreign traffic is analytics only
 *   - identify() carries the vid on the claim; approve binds it; later beacons land
 *   - a form POST with _tz_site/_tz_vid binds the browser (registry + origin gated)
 *   - tokens are site-scoped and can never replay as a first-party cookie token
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
check('loader exposes visitorId() for form bridges', /visitorId:\s*function/.test(loader));
check('loader rides the vid on every beacon body', /payload\.vid\s*=\s*vid/.test(loader));
check('loader mints no vid under DNT/GPC or when disabled', /if\s*\(!cfg\.vid\s*\|\|\s*dnt\(\)\)\s*return\s*''/.test(loader));
check('loader never sets the vid on the CRM host (first-party storage only)', !/document\.domain|domain=/i.test(loader));

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

    // ── v2.02: the native stream belongs to THIS site ────────────────
    // Found by the live WordPress test: an unregistered site_id was
    // correctly dropped, but omitting site_id entirely let a foreign page
    // write into the owner's OWN analytics.
    const beforeForeign = db.prepare('SELECT COUNT(*) n FROM pageviews').get().n;
    const foreignNoSite = await req('POST', '/_tapuz/collect', {
      body: { path: '/injected-by-a-stranger', type: 'pageview' },
      origin: 'https://evil.example.com'
    });
    check('a FOREIGN-origin beacon with no site_id is refused (silent 204)',
      foreignNoSite.status === 204 &&
      db.prepare("SELECT COUNT(*) n FROM pageviews WHERE path = '/injected-by-a-stranger'").get().n === 0 &&
      db.prepare('SELECT COUNT(*) n FROM pageviews').get().n === beforeForeign);

    const sameOrigin = await req('POST', '/_tapuz/collect', {
      body: { path: '/native-same-origin', type: 'pageview' },
      origin: BASE
    });
    check('a SAME-origin native beacon still records (nothing first-party broke)',
      sameOrigin.status === 204 &&
      db.prepare("SELECT COUNT(*) n FROM pageviews WHERE path = '/native-same-origin'").get().n === 1);

    const noOriginHeader = await req('POST', '/_tapuz/collect', {
      body: { path: '/native-no-origin', type: 'pageview' }
    });
    check('a beacon with NO Origin header keeps working (server-side / old clients)',
      noOriginHeader.status === 204 &&
      db.prepare("SELECT COUNT(*) n FROM pageviews WHERE path = '/native-no-origin'").get().n === 1);

    const foreignRegistered = await req('POST', '/_tapuz/collect', {
      body: { path: '/still-fine', type: 'pageview', site_id: 'wp-local' },
      origin: 'https://shop.example.com'
    });
    check('a REGISTERED foreign site is unaffected by the new native guard',
      foreignRegistered.status === 204 &&
      db.prepare("SELECT COUNT(*) n FROM pageviews WHERE path = '/still-fine' AND site_id = 'wp-local'").get().n === 1);

    // approve claim
    const claim = claims.listClaims({ status: 'pending' }).find((c) => c.email === 'real-person@example.com');
    const approved = claims.approveClaim(claim.id);
    check('admin approve creates the contact',
      approved.ok && contacts.findByEmail('real-person@example.com'));
    check('a claim without a vid approves with linked:false (nothing to bind)', approved.linked === false);

    // ── v2.21: foreign visitor stitching ─────────────────────────────
    const visitors = require('../src/crm/visitors');
    const VID_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const VID_B = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
    const VID_C = 'deadbeefdeadbeefdeadbeefdeadbeef';
    const evCount = () => db.prepare('SELECT COUNT(*) AS n FROM crm_events').get().n;
    const visCount = () => db.prepare('SELECT COUNT(*) AS n FROM crm_visitors').get().n;
    const evFor = (id) => db.prepare('SELECT * FROM crm_events WHERE contact_id = ? ORDER BY id').all(id);

    check('foreignToken is site-scoped and namespaced',
      visitors.foreignToken('Open-Claims', VID_A) === 'f:open-claims:' + VID_A);
    check('foreignToken refuses anything that is not 32 hex',
      visitors.foreignToken('open-claims', 'not-hex') === '' &&
      visitors.foreignToken('open-claims', VID_A + 'ff') === '' &&
      visitors.foreignToken('', VID_A) === '');
    check('a first-party cookie token is never a foreign token',
      visitors.contactIdForToken(VID_A) === null && visitors.linkToken(VID_A, 1) === '');

    // anonymous vid → analytics only, never stored
    const ev0 = evCount();
    const vis0 = visCount();
    await req('POST', '/_tapuz/collect', {
      origin: 'https://foreign.test',
      body: { path: '/anon-with-vid', type: 'pageview', site_id: 'open-claims', vid: VID_A }
    });
    check('anonymous foreign pageview WITH vid still lands in analytics',
      !!db.prepare("SELECT 1 FROM pageviews WHERE path = '/anon-with-vid' AND site_id = 'open-claims'").get());
    check('anonymous vid opens no timeline row and stores no visitor', evCount() === ev0 && visCount() === vis0);

    // identify with vid → claim remembers the token, binds nothing yet
    await req('POST', '/_tapuz/collect', {
      origin: 'https://foreign.test',
      body: {
        path: '/contact/', type: 'identify', site_id: 'open-claims',
        email: 'wp-visitor@example.com', person_name: 'WP Visitor', vid: VID_A
      }
    });
    const stitchClaim = claims.listClaims({ status: 'pending', siteId: 'open-claims' })
      .find((c) => c.email === 'wp-visitor@example.com');
    check('identify with vid → pending claim carrying the site-scoped token',
      !!stitchClaim && stitchClaim.visitor_token === 'f:open-claims:' + VID_A);
    check('identify with vid still creates no contact and binds no browser',
      contacts.findByEmail('wp-visitor@example.com') == null && visCount() === vis0);

    // still anonymous until approval
    await req('POST', '/_tapuz/collect', {
      origin: 'https://foreign.test',
      body: { path: '/before-approve', type: 'pageview', site_id: 'open-claims', vid: VID_A }
    });
    check('pageview from the claiming browser BEFORE approval stays anonymous', evCount() === ev0);

    // approve → contact + bound browser
    const stitchApproved = claims.approveClaim(stitchClaim.id);
    const wpContact = contacts.findByEmail('wp-visitor@example.com');
    check('approve creates the contact AND binds the claiming browser',
      stitchApproved.ok && stitchApproved.linked === true && !!wpContact &&
      visitors.contactIdForToken('f:open-claims:' + VID_A) === wpContact.id);

    // now the same browser's beacons land on the timeline, tagged with the site
    await req('POST', '/_tapuz/collect', {
      origin: 'https://foreign.test',
      body: { path: '/pricing/', type: 'pageview', site_id: 'open-claims', vid: VID_A }
    });
    const linkedEv = evFor(wpContact.id).filter((e) => e.type === 'pageview');
    check('pageview from the approved browser lands on the timeline',
      linkedEv.length === 1 && linkedEv[0].path === '/pricing/');
    check('the timeline row is tagged with the foreign site_id',
      linkedEv.length === 1 && JSON.parse(linkedEv[0].meta || '{}').site_id === 'open-claims');
    check('the linked pageview still counts on the analytics spine',
      !!db.prepare("SELECT 1 FROM pageviews WHERE path = '/pricing/' AND site_id = 'open-claims'").get());

    await req('POST', '/_tapuz/collect', {
      origin: 'https://foreign.test',
      body: { path: '/pricing/', type: 'pixel', name: 'contact_us', site_id: 'open-claims', vid: VID_A, props: {} }
    });
    const trackEv = evFor(wpContact.id).filter((e) => e.type === 'track');
    check('track() from the approved browser lands as a named timeline event',
      trackEv.length === 1 && trackEv[0].title === 'contact_us');

    // a different browser on the same site: anonymous
    const evLinked = evCount();
    await req('POST', '/_tapuz/collect', {
      origin: 'https://foreign.test',
      body: { path: '/other-browser', type: 'pageview', site_id: 'open-claims', vid: VID_C }
    });
    check('a different vid on the same site stays anonymous', evCount() === evLinked);

    // the same vid on ANOTHER registered site: token is site-scoped → anonymous
    await req('POST', '/_tapuz/collect', {
      origin: 'https://shop.example.com',
      body: { path: '/replayed-elsewhere', type: 'pageview', site_id: 'wp-local', vid: VID_A }
    });
    check('the same vid replayed under another site_id is NOT attributed (site-scoped)', evCount() === evLinked);

    // ── form bridge path: _tz_site + _tz_vid bind the browser ────────
    const formPost = (fields, origin) => req('POST', '/api/form', {
      origin,
      body: new URLSearchParams(fields).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // the live scenario: the person ALREADY exists (earlier form / import) …
    const existing = contacts.upsertContact({ email: 'ben@example.com', name: 'Ben', status: 'lead', source: 'import' }).contact;
    const evBen0 = evFor(existing.id).length;
    // … and now writes in from the WordPress contact form via the bridge
    const fr = await formPost(
      { email: 'ben@example.com', name: 'Ben', message: 'שלום', _page: 'contact', _tz_site: 'wp-local', _tz_vid: VID_B },
      'https://shop.example.com'
    );
    check('foreign form POST with _tz_site/_tz_vid is accepted', fr.status === 302 || fr.status === 200);
    check('the form resolves to the EXISTING contact (no duplicate)',
      db.prepare("SELECT COUNT(*) AS n FROM crm_contacts WHERE email = 'ben@example.com'").get().n === 1);
    check('the form binds the WordPress browser to that contact',
      visitors.contactIdForToken('f:wp-local:' + VID_B) === existing.id);
    check('the form event itself is on the timeline', evFor(existing.id).length === evBen0 + 1);
    const lastSub = db.prepare('SELECT fields FROM form_submissions ORDER BY id DESC LIMIT 1').get();
    check('_tz_* bridge fields are stripped from the stored submission',
      !!lastSub && !/_tz_vid|_tz_site/.test(lastSub.fields) && /ben@example\.com/.test(lastSub.fields));

    await req('POST', '/_tapuz/collect', {
      origin: 'https://shop.example.com',
      body: { path: '/products/shoes', type: 'pageview', site_id: 'wp-local', vid: VID_B }
    });
    const benViews = evFor(existing.id).filter((e) => e.type === 'pageview');
    check('the NEXT WordPress pageview is attributed to the existing contact',
      benViews.length === 1 && benViews[0].path === '/products/shoes' &&
      JSON.parse(benViews[0].meta || '{}').site_id === 'wp-local');
    check('interest learned from the foreign path',
      (contacts.getContact(existing.id).tags || '').includes('interest:shoes'));

    // gates: the submission always lands, the LINK only when the registry says so.
    // (Every form POST also mints the native tz_v row, so count FOREIGN bindings.)
    const foreignBindings = (id) =>
      db.prepare("SELECT COUNT(*) AS n FROM crm_visitors WHERE token LIKE 'f:%' AND contact_id = ?").get(id).n;
    await formPost(
      { email: 'gate1@example.com', _tz_site: 'wp-local', _tz_vid: VID_C },
      'https://not-allowed.example'
    );
    const gate1 = contacts.findByEmail('gate1@example.com');
    check('form from an origin outside the site allowlist: contact saved, browser NOT bound',
      !!gate1 && foreignBindings(gate1.id) === 0 && visitors.contactIdForToken('f:wp-local:' + VID_C) === null);
    await formPost(
      { email: 'gate2@example.com', _tz_site: 'never-registered', _tz_vid: VID_C },
      'https://shop.example.com'
    );
    const gate2 = contacts.findByEmail('gate2@example.com');
    check('form naming an unregistered site: contact saved, browser NOT bound',
      !!gate2 && foreignBindings(gate2.id) === 0);
    await formPost(
      { email: 'gate3@example.com', _tz_site: 'wp-local', _tz_vid: 'not-a-real-vid' },
      'https://shop.example.com'
    );
    const gate3 = contacts.findByEmail('gate3@example.com');
    check('form with a malformed vid: contact saved, browser NOT bound',
      !!gate3 && foreignBindings(gate3.id) === 0);

    // forge: a foreign beacon presenting a NATIVE cookie token as its vid
    const nativeForm = await formPost({ email: 'native-person@example.com', name: 'Native' }, BASE);
    const setCookie = String((nativeForm.headers['set-cookie'] || []).join(';'));
    const nativeToken = (setCookie.match(/tz_v=([a-f0-9]{32})/) || [])[1] || '';
    const nativeContact = contacts.findByEmail('native-person@example.com');
    check('native form still mints the first-party tz_v cookie', !!nativeToken && !!nativeContact);
    const evNative0 = evFor(nativeContact.id).length;
    await req('POST', '/_tapuz/collect', {
      origin: 'https://shop.example.com',
      body: { path: '/stolen-token', type: 'pageview', site_id: 'wp-local', vid: nativeToken }
    });
    check('a foreign beacon presenting a native tz_v token as vid attributes NOTHING',
      evFor(nativeContact.id).length === evNative0);

    // erasure reaches the foreign binding (crm_visitors is a PERSONAL_TABLE)
    require('../src/crm/subject').eraseContact(existing.id);
    check('erasing the contact removes the foreign browser binding',
      visitors.contactIdForToken('f:wp-local:' + VID_B) === null);

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
