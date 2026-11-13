'use strict';

/**
 * v2.69 QA — the demo shop, version 2 (src/store/demo-seed.js).
 *
 * What it holds the demo to:
 *   the catalog   twenty-four products, four to a category, the lead's copy
 *                 read by the parser without a note; every picture is one of
 *                 the thirty in src/store/demo-art.js
 *   a fresh root  TAPUZ_DEMO_STORE=1 seeds version 2: a home page of its own,
 *                 a shop page with the toolbar, a menu that lists no address
 *                 twice, both markers — and a checkout that works with
 *                 nobody's keys (the demo payment, paid to the end)
 *   version 1     a root 2.68 seeded moves to version 2 part by part, and a
 *                 part its owner changed is kept and named in the log
 *   unmarked      a version 1 demo the 2.68 SCRIPT seeded (no marker) is
 *                 adopted by its content; anything else is left byte for byte
 *   nothing       no flag → nothing; somebody's site + the flag → nothing;
 *                 a second boot → nothing
 *   housekeeping  a day-old order is cancelled and forgets its visitor, a
 *                 sold-out demo product is restocked, a young order is left
 *
 * Every root is a throwaway directory and every boot is a child process, the
 * way scripts/smoke-store-paypal.js tests the seed. No port is used.
 *
 * Run: node scripts/smoke-store-demo.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-demo-'));
// the parent never opens a database; this only keeps ../src/paths away from the package root
process.env.TAPUZ_ROOT = path.join(HOME, 'parent');
fs.mkdirSync(process.env.TAPUZ_ROOT);

const REPO = path.join(__dirname, '..');
let failed = 0;
function ok(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failed++;
}

// ── roots and children ─────────────────────────────────────────────────

let rootCount = 0;
function newRoot(name) {
  const p = path.join(HOME, String(++rootCount).padStart(2, '0') + '-' + name);
  fs.mkdirSync(p);
  return p;
}
function copyRoot(from, name) {
  const p = path.join(HOME, String(++rootCount).padStart(2, '0') + '-' + name);
  fs.cpSync(from, p, { recursive: true });
  return p;
}

/** Every file under a root as "sha1  path" lines: two equal strings are two byte-identical roots. */
function tree(root) {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.push(crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex') + '  ' + path.relative(root, p));
    }
  })(root);
  return out.join('\n');
}

const STRIP = ['TAPUZ_ROOT', 'TAPUZ_DEMO_STORE', 'TAPUZ_DEMO_RESET_HOURS', 'TAPUZ_PIN_FILE', 'TAPUZ_SEED',
  'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MODE', 'TAPUZ_PAYPAL_LIVE', 'TAPUZ_PAYPAL_FAKE'];
const FLAG = { TAPUZ_DEMO_STORE: '1' };
const KEYS = { PAYPAL_CLIENT_ID: 'AWdemoSandboxClientId0001', PAYPAL_CLIENT_SECRET: 'sandbox-demo-not-a-real-secret' };

/**
 * Run `body` in a child process whose data root is `root`. The body fills
 * `out`; `seed` is the demo module (loading it opens no database), `store()`
 * and `db()` load the store and the database only when the body asks.
 */
function child(root, env, body) {
  const childEnv = Object.assign({}, process.env);
  for (const k of STRIP) delete childEnv[k];
  childEnv.TAPUZ_ROOT = root;
  Object.assign(childEnv, env || {});
  const code = [
    'const out = {};',
    "const seed = require('./src/store/demo-seed');",
    "const store = () => require('./src/store');",
    "const db = () => require('./src/db').db;",
    body,
    "console.log('@@' + JSON.stringify(out));"
  ].join('\n');
  const r = spawnSync(process.execPath, ['-e', code], { cwd: REPO, env: childEnv, encoding: 'utf8' });
  let out = null;
  const m = /^@@(.*)$/m.exec(r.stdout || '');
  if (m) { try { out = JSON.parse(m[1]); } catch (e) { out = null; } }
  return { status: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '', out: out || {} };
}

const BOOT = 'out.r = seed.maybeDemoStore();';

// what a root holds, as plain data for the parent to judge
const INSPECT = `
{
  const st = store();
  const pages = require('./src/pages');
  const cfg = require('./src/config').loadConfig();
  const s = st.settings.loadSettings();
  out.products = st.catalog.listProducts({ status: 'all', limit: 1000 })
    .map((p) => ({ id: p.id, slug: p.slug, title: p.title, price: p.price, stock: p.stock, shelf: p.shelf, status: p.status,
      brand: p.brand, tags: p.tags, featured: p.featured, image: p.images[0] || '', max: p.maxPerOrder || 0, options: p.variants.length }))
    .sort((a, b) => a.id - b.id);
  out.shelves = st.catalog.listShelves().map((x) => ({ slug: x.slug, parent: x.parent, image: x.image, total: x.total }));
  out.coupons = st.coupons.listCoupons().filter((c) => c.active).map((c) => c.code).sort();
  out.payments = s.payments.map((m) => m.id + ':' + m.kind);
  out.offered = st.paypal.offeredPayments(s).map((m) => m.id + ':' + m.kind);
  out.shipping = s.shipping.map((m) => m.id);
  out.holdHours = s.holdHours;
  out.open = s.open;
  out.homepage = cfg.homepage;
  out.description = cfg.description;
  out.footer = (cfg.footer || {}).text || '';
  out.menu = require('./src/menus').getMenu('main').map((i) => ({ label: i.label, url: i.url, kids: (i.children || []).map((c) => c.url) }));
  out.pages = pages.listPages().map((p) => p.full_path + ':' + p.status);
  out.source = {};
  for (const p of ['shop', 'home', 'shop-left-sock', 'shop-pet-stone']) out.source[p] = pages.getPageSource(p, 'published');
  out.hashed = db().prepare("SELECT COUNT(*) AS n FROM pages WHERE full_path LIKE 'shop-%' AND json_extract(meta, '$.storeSourceHash') IS NOT NULL").get().n;
  out.orders = db().prepare('SELECT * FROM store_orders ORDER BY id').all();
  out.version = seed.demoVersion();
  out.isDemo = seed.isDemoSite();
}
`;

const BUYER = "{ name: 'דנה לדוגמה', phone: '050-1234567', email: 'dana@example.com' }";

// A root built with THIS code holds product pages in today's shape. A root
// 2.68 really seeded holds them in 2.68's shape and without the "generated"
// hash, so the fixture writes them that way — the upgrade must recognise a
// page 2.68 wrote. One sandbox order is placed too: version 1's stock has
// moved, the way a public shop's does.
const AS_268_LEFT_IT = `
{
  const st = store();
  const pages = require('./src/pages');
  for (const p of st.catalog.listProducts({ status: 'all' })) {
    pages.savePageSource('shop-' + p.slug, [
      '<bent-crumbs>',
      '  <bent-crumb label="דף הבית" url="/"></bent-crumb>',
      '  <bent-crumb label="חנות הדברים שאינם" url="/shop.html"></bent-crumb>',
      '  <bent-crumb label="' + p.title.replace(/"/g, '&quot;') + '"></bent-crumb>',
      '</bent-crumbs>',
      '<bent-buy sku="' + p.slug + '"></bent-buy>',
      '<bent-shop title="עוד מהחנות" limit="4" exclude="' + p.slug + '" sort="new"></bent-shop>'
    ].join('\\n'), { publish: true });
  }
  db().prepare("UPDATE pages SET meta = json_remove(meta, '$.storeSourceHash') WHERE full_path LIKE 'shop-%'").run();
  const placed = st.orders.placeOrder({ items: [{ sku: 'left-sock', qty: 1 }], shipping: 'pickup', payment: 'paypal', customer: ${BUYER} });
  out.placed = placed.ok;
  require('./src/export').exportAll();
}
`;

function markers(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'config', 'seeded.json'), 'utf8')); } catch (e) { return null; }
}
function html(root, name) {
  try { return fs.readFileSync(path.join(root, 'public', name), 'utf8'); } catch (e) { return ''; }
}
/** The <section> of a page that carries this h2, or ''. */
function sectionOf(page, title) {
  return page.split('<section').find((part) => part.includes('>' + title + '</h2>')) || '';
}
const count = (text, needle) => text.split(needle).length - 1;
const bySlug = (list, slug) => (list || []).find((p) => p.slug === slug) || {};

// ── 1. the catalog and the art, read without a database ────────────────

const seedMod = require('../src/store/demo-seed');
const { ART } = require('../src/store/demo-art');
const dialect = require('../src/bentml/store-dialect');

const EIGHT = ['left-sock', 'named-cloud', 'mountain-air', 'pet-stone', 'bottled-quiet', 'blank-card', 'chair-manual', 'nowhere-map'];
const TOPS = ['huge', 'small', 'quiet', 'weather', 'timeplace', 'home'];

{
  const read = dialect.parseStoreDoc(seedMod.CATALOG);
  const doc = read.doc || { products: [], shelves: [], payments: [], shipping: [], coupons: [] };
  ok(!!read.doc && read.errors.length === 0 && read.notes.length === 0, 'the catalog is read by the parser without an error or a note');
  ok(doc.products.length === 24 && new Set(doc.products.map((p) => p.id)).size === 24, 'twenty-four products, each its own id');
  ok(EIGHT.every((id) => doc.products.some((p) => p.id === id)), "version 1's eight products are all still in the catalog");
  const parents = Object.fromEntries(doc.shelves.map((s) => [s.id, s.parent]));
  ok(doc.shelves.length === 8 && TOPS.every((id) => parents[id] === '') && parents.time === 'timeplace' && parents.place === 'timeplace',
    'eight categories: six on top, "זמן" and "מקום" under "זמן ומקום"');
  ok(TOPS.every((id) => { const s = doc.shelves.find((x) => x.id === id); return s.image && s.summary; }), 'every top category has a picture and a line');
  const family = (id) => doc.products.filter((p) => p.shelf === id || parents[p.shelf] === id).length;
  ok(TOPS.every((id) => family(id) === 4), 'four products to a category — a grid of two or four columns is whole rows');
  ok(doc.products.filter((p) => p.featured === 'true').length === 4, 'four featured products (one full row of four)');
  ok(doc.products.every((p) => p.brand && p.tags), 'every product has a brand and tags');
  ok(doc.products.filter((p) => p.variants.length).length === 5, 'five products come with options');
  ok(doc.products.some((p) => p.was) && doc.products.some((p) => p.stock === '0'), 'sale prices and one sold-out product');
  const dearest = doc.products.map((p) => ({ id: p.id, top: Math.max(Number(p.price), ...p.variants.map((v) => Number(v.price) || 0)) }))
    .sort((a, b) => b.top - a.top).slice(0, 3).map((p) => p.id).sort();
  const capped = doc.products.filter((p) => p.max === '1').map((p) => p.id).sort();
  ok(capped.join() === dearest.join() && capped.length === 3, 'the three dearest products are one to an order: ' + capped.join(', '));
  ok(doc.payments.length === 2 && doc.payments[0].kind === 'demo' && doc.payments[0].label === 'כסף של משחק קופסה' && doc.payments[1].kind === 'paypal',
    'two payments: the demo kind first (the lead\'s label kept), PayPal sandbox second');
  ok(doc.shipping.length === 3 && doc.coupons.length === 4, 'three shipping methods and four coupons');

  const keys = Object.keys(ART);
  ok(keys.length === 30 && keys.every((k) => /^demo-[a-z-]+\.svg$/.test(k)), 'demo-art.js has exactly thirty pictures');
  const wanted = doc.products.map((p) => p.image).concat(doc.shelves.map((s) => s.image).filter(Boolean));
  const names = wanted.map((src) => src.replace('/assets/demo2-', 'demo-'));
  ok(wanted.length === 30 && wanted.every((src) => src.startsWith('/assets/demo2-')) && names.every((n) => ART[n]) && new Set(names).size === 30,
    'every picture the catalog names is one of the thirty, under its demo2- name, and each is used once');
  const square = (svg) => /viewBox="0 0 240 240"/.test(svg) && !/<rect[^>]*width="240"/.test(svg) && !/<text/.test(svg) && !/https?:\/\/(?!www\.w3\.org)/.test(svg);
  ok(keys.every((k) => square(ART[k])), 'every picture is square, has no background rect, no lettering and no outside address');

  // version 1's catalog is what "untouched" is asked against: it must stay 2.68's string to the character
  ok(crypto.createHash('sha256').update(seedMod.CATALOG_V1).digest('hex') === '81f3b38111c4f5c130f2b9e13871083c3bcf891392adf404d5d23c0aa28f29bb',
    "the kept version 1 catalog is 2.68's, character for character");
  ok(seedMod.DEMO_VERSION === 2 && seedMod.DEMO_MARKER_ID === 'demo-store' && seedMod.DEMO_V2_MARKER_ID === 'demo-store-v2', 'version 2, and the two marker names');

  const server = fs.readFileSync(path.join(REPO, 'src', 'server.js'), 'utf8');
  const demoAt = server.indexOf("require('./store/demo-seed').maybeDemoStore()");
  const seedAt = server.indexOf("require('./seed-content').maybeSeed()");
  ok(demoAt > 0 && seedAt > demoAt, 'the server runs the demo gate BEFORE the pin-armed content seed');
  ok(server.includes("if (typeof d.housekeeping === 'function') d.housekeeping();") && typeof seedMod.housekeeping === 'function' && typeof seedMod.isDemoSite === 'function',
    'the server calls housekeeping(), and the module exports it with isDemoSite()');
}

// ── 2. an empty root + the flag → version 2 ────────────────────────────

const fresh = newRoot('fresh');
{
  // planned the way the seed plans it: armed. Without the flag, on a root that
  // is no demo, the document door rightly notes that the demo payment will
  // not be offered (DEMO_NOT_OFFERED) — pinned just below.
  const planEmpty = child(newRoot('plan-empty'), Object.assign({}, FLAG, KEYS), "const p = store().document.planDocument(seed.CATALOG); out.ok = p.ok; out.hard = p.hard; out.warnings = p.warnings.map((w) => w.code); out.added = p.preview.added.length;");
  ok(planEmpty.out.ok === true && planEmpty.out.hard === false && planEmpty.out.added === 24 && planEmpty.out.warnings.length === 0,
    'the catalog plans against an empty store with ZERO warnings (sandbox keys present)');
  const planUnarmed = child(newRoot('plan-unarmed'), KEYS, "const p = store().document.planDocument(seed.CATALOG); out.ok = p.ok; out.hard = p.hard; out.warnings = p.warnings.map((w) => w.code);");
  ok(planUnarmed.out.ok === true && planUnarmed.out.hard === false && planUnarmed.out.warnings.join() === 'DEMO_NOT_OFFERED',
    'pasted into somebody\'s own shop (no flag, no marker) the same catalog carries ONE soft note: the demo payment will not be offered there');

  const boot = child(fresh, FLAG, BOOT);
  ok(boot.status === 0 && boot.out.r && boot.out.r.ran === true && boot.out.r.version === 2 && boot.out.r.products === 24 && boot.out.r.homepage === 'home',
    'an empty root with the flag is seeded with version 2');
  const m = markers(fresh) || {};
  ok(!!m['demo-store'] && !!m['demo-store-v2'], 'both markers are written');
  ok(!fs.existsSync(path.join(fresh, 'config', 'payments.json')), 'no payment credentials are written');

  const seen = child(fresh, {}, INSPECT).out;
  const P = seen.products || [];
  ok(P.length === 24 && P.every((p) => p.status === 'active'), 'twenty-four active products');
  ok(bySlug(P, 'left-sock').price === 13 && bySlug(P, 'named-cloud').price === 100000100, 'the sock is 13 agorot and the cloud 100000100');
  ok(P.filter((p) => p.featured).length === 4 && P.every((p) => p.brand && p.tags.length), 'four featured; every product has its brand and tags');
  ok(['diy-mountain', 'named-cloud', 'starter-black-hole'].every((id) => bySlug(P, id).max === 1), 'the three dearest are one to an order in the store too');
  const sh = seen.shelves || [];
  ok(sh.length === 8 && sh.filter((s) => !s.parent).map((s) => s.slug).join() === TOPS.join()
    && sh.filter((s) => s.parent === 'timeplace').map((s) => s.slug).join() === 'time,place' && sh.filter((s) => !s.parent).every((s) => s.total === 4 && s.image),
    'eight categories with the right parents; each top one holds four and has its picture');
  const art = (src) => { try { return fs.readFileSync(path.join(fresh, 'public', src), 'utf8'); } catch (e) { return null; } };
  ok(P.map((p) => p.image).concat(sh.map((s) => s.image).filter(Boolean)).every((src) => art(src) !== null && art(src) === ART[src.replace('/assets/demo2-', 'demo-')]),
    'every picture file exists in the root and is one of the thirty');
  ok(fs.readdirSync(path.join(fresh, 'public', 'assets')).filter((n) => n.endsWith('.svg')).every((n) => n.startsWith('demo2-')), 'no version 1 picture name is written');
  ok((seen.coupons || []).join() === 'HALFJOKE,PAZ10,SIMHA,WHITENO1SE' && (seen.shipping || []).join() === 'pickup,thought,pigeon', 'four coupons, three shipping methods');
  ok((seen.payments || []).join() === 'pretend:demo,paypal:paypal' && (seen.offered || []).join() === 'pretend:demo',
    'with no keys in the environment the checkout offers the demo payment (PayPal waits for keys)');
  ok(seen.holdHours === 2 && seen.open === true, 'the shop is open and an unpaid order holds its stock for two hours (holdHours)');
  ok(seen.homepage === 'home' && seen.version === 2 && seen.isDemo === true, 'the home page is `home`; demoVersion() 2; isDemoSite() true');
  ok(seen.footer === 'חנות הדגמה של Tapuziel — Shaltiel Enterprises', 'the footer line is the demo\'s');
  const menu = seen.menu || [];
  const links = menu.map((i) => i.url).concat(...menu.map((i) => i.kids));
  ok(menu.map((i) => i.label).join(' · ') === 'דף הבית · כל המוצרים · קטגוריות' && menu[2].kids.join() === TOPS.map((t) => '/shelf-' + t + '.html').join(),
    'the menu: דף הבית · כל המוצרים · קטגוריות (the six category pages)');
  ok(new Set(links).size === links.length && menu[0].url === '/' && menu[1].url === '/shop.html', 'no address is in the menu twice');
  const pg = seen.pages || [];
  ok(pg.length === 37 && pg.every((p) => p.endsWith(':published')) && pg.includes('home:published')
    && pg.filter((p) => p.startsWith('shelf-')).length === 8 && pg.filter((p) => p.startsWith('shop-')).length === 24,
    'thirty-seven live pages: home, shop, cart, checkout, order, eight categories, twenty-four products');

  const home = html(fresh, 'index.html');
  const tiles = sectionOf(home, 'קטגוריות');
  ok(tiles.includes('bent-shelves-cols-3') && count(tiles, 'class="bent-shelf-tile"') === 6, 'home: six category tiles in three columns — two full rows');
  const featured = sectionOf(home, 'הנבחרים');
  ok(featured.includes('bent-shop-cols-4') && count(featured, '<article class="bent-shop-card') === 4 && count(featured, 'is-featured') === 4, 'home: the featured strip is one full row of four');
  const fresher = sectionOf(home, 'חדשים בחנות');
  ok(fresher.includes('bent-shop-cols-4') && count(fresher, '<article class="bent-shop-card') === 4, 'home: "חדשים בחנות" is one full row of four');
  ok(home.includes('מחירים מומצאים') && home.includes('כסף אמיתי לא עובר') && home.includes('class="hero') && count(home, '<article class="feature">') === 3 && home.includes('cta-strip'),
    'home: the banner says the prices are invented and the payment pretend; hero, three info cards, closing call');
  ok(/<title>חנות הדברים שאינם[^<]*<\/title>/.test(home) && home.includes('id="categories"'), 'home: the tab names the shop, and the tiles are where the menu\'s "קטגוריות" leads');
  ok(!home.includes('תפוזיאל') && !home.includes('בלי מותגים') && !home.includes('ארגז חול'), 'home: no version 1 copy is left');
  const shop = html(fresh, 'shop.html');
  ok(shop.includes('bent-shop-toolbar') && shop.includes('data-tz-search') && shop.includes('data-tz-sort') && count(shop, 'class="bent-shop-chip') === 7,
    'shop: the toolbar — six category chips and "הכול", search, sort');
  ok(shop.includes('bent-shop-cols-4') && shop.includes('data-page-size="12"') && count(shop, '<article class="bent-shop-card') === 24
    && count(shop, ' hidden>') >= 12 && shop.includes('מציג 12 מתוך 24'),
    'shop: twenty-four cards in four columns, twelve to a load — three full rows at a time');
  ok(html(fresh, 'home.html') !== '' && shop !== home, 'the home page and the shop page are two different pages');
  const checkout = html(fresh, 'checkout.html');
  ok(/name="payment" value="pretend" data-kind="demo" checked/.test(checkout) && !checkout.includes('value="paypal"'), 'checkout: the demo payment is on the exported page, chosen');
  const files = fs.readdirSync(path.join(fresh, 'public')).filter((n) => n.endsWith('.html'));
  const bad = files.filter((n) => /undefined|\[object Object\]|="null"|>null<|>NaN<|http:\/\//.test(html(fresh, n)));
  ok(files.length === 38 && bad.length === 0, 'no "undefined", "null", "[object Object]" or http:// address in any exported page' + (bad.length ? ' — ' + bad.join(', ') : ''));

  const planSeeded = child(fresh, KEYS, "const p = store().document.planDocument(seed.CATALOG); const v = p.preview; out.warnings = p.warnings.map((w) => w.code); out.same = v.added.length + v.changed.length + v.hidden.length + v.shelvesAdded.length + v.shelvesChanged.length + v.settings.length + v.coupons.added.length + v.coupons.changed.length + v.coupons.off.length; out.unchanged = v.unchanged;");
  ok(planSeeded.out.warnings && planSeeded.out.warnings.length === 0 && planSeeded.out.same === 0 && planSeeded.out.unchanged === 24,
    'the catalog plans against its own store with zero warnings and nothing to change');
  const planBare = child(fresh, {}, "out.warnings = store().document.planDocument(seed.CATALOG).warnings.map((w) => w.code);");
  ok((planBare.out.warnings || []).join() === 'PAYPAL_NOT_CONNECTED', 'without keys the only thing the plan says is that PayPal waits for them');
}

// ── 3. a second boot is nothing at all ─────────────────────────────────

{
  const before = tree(fresh);
  const again = child(fresh, FLAG, BOOT);
  ok(again.out.r && again.out.r.ran === false && again.out.r.reason === 'already applied' && tree(fresh) === before,
    'a second boot at version 2 is a no-op: database, markers and every exported page byte-identical');
  const bare = copyRoot(fresh, 'fresh-no-flag');
  const was = tree(bare);
  const noFlag = child(bare, {}, BOOT + ' out.h = seed.housekeeping();');
  ok(noFlag.out.r.reason === 'not armed' && noFlag.out.h.cancelled + noFlag.out.h.scrubbed + noFlag.out.h.restocked === 0 && tree(bare) === was,
    'without the flag a demo root is not read and not written');
  const empty = newRoot('empty-no-flag');
  child(empty, {}, BOOT);
  ok(fs.readdirSync(empty).length === 0, 'without the flag an empty root stays empty');

  const closedCheckout = copyRoot(fresh, 'checkout-draft');
  const drafted = child(closedCheckout, Object.assign({}, FLAG, KEYS), "require('./src/pages').updatePage('checkout', { status: 'draft' }); const at = require('path').join(process.env.TAPUZ_ROOT, 'public', 'checkout.html'); const had = require('fs').existsSync(at); out.r = seed.maybeDemoStore(); out.wrote = !had && require('fs').existsSync(at);");
  ok(drafted.out.r && drafted.out.r.checkout && drafted.out.r.checkout.refreshed === false && /not published/.test(drafted.out.r.checkout.reason) && drafted.out.wrote === false,
    'an unpublished checkout page is not republished by the boot');
}

// ── 4. the demo payment, to the end, with nobody's keys ────────────────

{
  const root = copyRoot(fresh, 'pay');
  const paid = child(root, FLAG, `
    const st = store();
    const q = st.pricing.quote({ items: [{ sku: 'left-sock', qty: 1 }], shipping: 'pickup' }, {});
    out.quote = { ok: q.ok, noPayment: q.noPayment, blocking: q.blocking, payments: q.payments.map((p) => p.id), payment: q.payment };
    const placed = st.orders.placeOrder({ items: [{ sku: 'left-sock', qty: 1 }], shipping: 'pickup', payment: 'pretend', customer: ${BUYER} });
    out.placed = placed.ok;
    out.before = placed.ok ? placed.order.payment : null;
    const pay = require('./src/store/demo-pay');
    const first = pay.payForOrder(placed.order.token);
    const second = pay.payForOrder(placed.order.token);
    out.first = { ok: first.ok, already: first.already, demo: first.order && first.order.payment.demo };
    out.second = { ok: second.ok, already: second.already };
    const row = st.orders.getOrder(placed.order.number);
    out.paidAt = row.paid_at;
    out.rows = db().prepare("SELECT provider, mode, status, amount FROM store_payments WHERE order_id = ?").all(row.id);
    out.total = row.total;
    const big = st.pricing.quote({ items: [{ sku: 'starter-black-hole', qty: 2 }], shipping: 'pickup' }, {});
    out.bigQty = big.lines.map((l) => l.qty);
  `).out;
  ok(paid.quote && paid.quote.ok === true && paid.quote.noPayment === false && paid.quote.payments.join() === 'pretend' && paid.quote.payment === 'pretend',
    'a quote for one product offers the demo payment with NO keys in the environment');
  ok(paid.placed === true && paid.before && paid.before.kind === 'demo' && paid.before.demo && paid.before.demo.canPay === true && paid.before.demo.paid === false,
    'an order is placed with it, and its page may press "לשלם בכסף דמיוני"');
  ok(paid.first && paid.first.ok === true && paid.first.demo.paid === true && paid.first.demo.canPay === false && paid.second.ok === true && paid.second.already === true,
    'the demo payment goes through, and a second press changes nothing');
  ok(paid.paidAt === null && paid.rows.length === 1 && paid.rows[0].provider === 'demo' && paid.rows[0].mode === 'test' && paid.rows[0].status === 'paid' && paid.rows[0].amount === paid.total,
    'it is recorded as a test payment of the order\'s sum, and never as revenue (paid_at stays empty)');
  ok((paid.bigQty || []).join() === '1', 'two of a ₪9,999,999 product cannot be in one order: the cart holds one');
}

// ── 5. version 1 → version 2 ───────────────────────────────────────────

const v1 = newRoot('v1');
let v1Order = null;
{
  const built = child(v1, Object.assign({}, FLAG, KEYS), 'out.r = seed.applyDemoV1({ marker: true });' + AS_268_LEFT_IT + INSPECT);
  const seen = built.out;
  const m = markers(v1) || {};
  ok(built.status === 0 && seen.r && seen.r.ok === true && seen.r.version === 1 && !!m['demo-store'] && !m['demo-store-v2'] && seen.version === 1,
    'a version 1 root can still be built (applyDemoV1): the first marker only');
  ok((seen.products || []).length === 8 && seen.homepage === 'shop' && seen.hashed === 0 && seen.placed === true && bySlug(seen.products, 'left-sock').stock === 39
    && (seen.payments || []).join() === 'paypal:paypal' && !fs.existsSync(path.join(v1, 'public', 'home.html')),
    'it is version 1: eight products, the shop is the home page, 2.68\'s product pages, PayPal only — and one order has moved the stock');
  v1Order = (seen.orders || [])[0] || null;
  const bare = child(copyRoot(v1, 'v1-keyless'), {}, INSPECT).out;
  ok((bare.offered || []).length === 0, 'version 1 without keys offers no way to pay at all (the hole version 2 closes)');
}

const upgraded = copyRoot(v1, 'v1-upgraded');
{
  const boot = child(upgraded, FLAG, BOOT);
  const parts = (boot.out.r && boot.out.r.parts) || {};
  ok(boot.status === 0 && boot.out.r.ran === true && boot.out.r.upgraded === true
    && ['catalog', 'pages', 'menu', 'description', 'footer'].every((k) => parts[k] === 'upgraded') && !parts.payment,
    'a version 1 root + the flag is upgraded: catalog, pages, menu, description and footer');
  ok(!/ kept /.test(boot.stdout), 'nothing was kept, and the log says so by saying nothing');
  const m = markers(upgraded) || {};
  ok(!!m['demo-store'] && !!m['demo-store-v2'], 'both markers after the upgrade');
  const before = child(v1, {}, INSPECT).out;
  const seen = child(upgraded, {}, INSPECT).out;
  const P = seen.products || [];
  ok(P.length === 24 && EIGHT.every((id) => bySlug(P, id).id === bySlug(before.products, id).id && bySlug(P, id).price === bySlug(before.products, id).price),
    'the eight old products keep their ids and their prices');
  ok(bySlug(P, 'left-sock').price === 13 && bySlug(P, 'named-cloud').price === 100000100 && P.filter((p) => !EIGHT.includes(p.slug)).length === 16 && P.every((p) => p.status === 'active'),
    'sock 13 agorot, cloud 100000100, and sixteen new products beside them');
  ok(bySlug(P, 'left-sock').stock === 40, 'stock is back at the catalog\'s number');
  ok(JSON.stringify(seen.orders) === JSON.stringify(before.orders) && seen.orders.length === 1 && v1Order && seen.orders[0].number === v1Order.number,
    'the order placed under version 1 is untouched, column for column');
  const sock = seen.source['shop-left-sock'] || '';
  ok(sock.includes('label="דף הבית" url="/"') && sock.includes('url="/shelf-small.html"') && sock.includes('title="עוד מאותה קטגוריה"') && sock.includes('shelf="small"') && seen.hashed === 24,
    'the old product pages come out in the new shape: the category in the trail, a strip from the same category');
  const pg = seen.pages || [];
  ok(pg.filter((p) => p.startsWith('shop-') && p.endsWith(':published')).length === 24 && pg.filter((p) => p.startsWith('shelf-') && p.endsWith(':published')).length === 8,
    'twenty-four product pages and eight category pages are live');
  ok(seen.homepage === 'home' && pg.includes('home:published') && seen.source.home.includes('<bent-shelves') && seen.source.shop.includes('page-size="12"'),
    'the home page is its own page now, and the shop page is version 2\'s');
  ok(seen.menu.map((i) => i.label).join(' · ') === 'דף הבית · כל המוצרים · קטגוריות' && seen.menu[2].kids.length === 6, 'the menu is version 2\'s');
  ok((seen.offered || []).join() === 'pretend:demo' && seen.holdHours === 2 && seen.footer.includes('Shaltiel Enterprises') && !seen.description.includes('PayPal'),
    'the demo payment is offered, orders hold stock two hours, the description and the footer are version 2\'s');
  ok(fs.existsSync(path.join(upgraded, 'public', 'assets', 'demo2-left-sock.svg')) && fs.existsSync(path.join(upgraded, 'public', 'assets', 'demo-left-sock.svg')),
    'the new art is beside the old (nothing of version 1 is deleted)');
  const home = html(upgraded, 'index.html');
  ok(count(sectionOf(home, 'קטגוריות'), 'class="bent-shelf-tile"') === 6 && count(sectionOf(home, 'הנבחרים'), '<article class="bent-shop-card') === 4 && home.includes('מחירים מומצאים'),
    'the exported home page of the upgraded root is version 2\'s');

  const was = tree(upgraded);
  const again = child(upgraded, FLAG, BOOT);
  ok(again.out.r.reason === 'already applied' && tree(upgraded) === was, 'a second boot after an upgrade: database, markers and exported pages byte-identical');
  const direct = child(upgraded, FLAG, 'out.r = seed.upgradeDemo();');
  ok(direct.out.r.ok === false && tree(upgraded) === was, 'upgradeDemo() called on a version 2 root refuses and writes nothing');
}

// ── 6. a version 1 demo whose owner changed something ──────────────────

{
  const root = copyRoot(v1, 'v1-renamed');
  child(root, {}, "const st = store(); const p = st.catalog.getProductBySlug('pet-stone'); st.afterProductChange(st.catalog.updateProduct(p.id, { title: 'אבן מחמד, בשם שבעל האתר נתן' }));");
  const boot = child(root, FLAG, BOOT);
  const parts = (boot.out.r && boot.out.r.parts) || {};
  ok(parts.catalog === 'kept' && boot.stdout.includes('[demo-store] v2: catalog kept — the owner edited it'), 'an owner renamed one product → the catalog is kept, and the log says why');
  ok(parts.pages === 'kept' && parts.menu === 'kept' && boot.stdout.includes('[demo-store] v2: pages kept') && boot.stdout.includes('[demo-store] v2: menu kept'),
    '…and the pages and the menu, which are written for the version 2 catalog, are kept with it');
  const seen = child(root, {}, INSPECT).out;
  ok(seen.products.length === 8 && bySlug(seen.products, 'pet-stone').title === 'אבן מחמד, בשם שבעל האתר נתן' && seen.homepage === 'shop' && !seen.pages.includes('home:published'),
    'the owner\'s catalog and pages are exactly as he left them');
  ok(parts.payment === 'added' && boot.stdout.includes('[demo-store] v2: demo payment added') && seen.payments.join() === 'pretend:demo,paypal:paypal' && seen.offered.join() === 'pretend:demo',
    'but the checkout offered nothing, so the demo payment was added — and is offered');
  ok(/name="payment" value="pretend" data-kind="demo"/.test(html(root, 'checkout.html')), 'the exported checkout of that root now has a way to pay');
  const m = markers(root) || {};
  const was = tree(root);
  const again = child(root, FLAG, BOOT);
  ok(!!m['demo-store-v2'] && again.out.r.reason === 'already applied' && tree(root) === was, 'the second marker is written all the same: the next boot does not ask again');

  const keyed = copyRoot(v1, 'v1-renamed-with-keys');
  child(keyed, {}, "const st = store(); const p = st.catalog.getProductBySlug('pet-stone'); st.catalog.updateProduct(p.id, { title: 'שם אחר' });");
  const withKeys = child(keyed, Object.assign({}, FLAG, KEYS), BOOT + INSPECT);
  ok(withKeys.out.r.parts.catalog === 'kept' && !withKeys.out.r.parts.payment && withKeys.out.payments.join() === 'paypal:paypal',
    'a kept catalog whose checkout DOES offer a payment is given nothing');
}

// The same kind of root, booted by the REAL server after a deploy. The demo
// step re-exports the whole site when it writes anything (here: the demo
// payment and the footer line), so an export that was the old build's a
// moment ago carries this build's stamp by the time the server asks whether
// a new build arrived. Asked then, the answer was "no": the product pages
// kept 2.68's shape and no category page was ever made — seen on the live
// demo shop, the day 2.69 was deployed to it. The server asks FIRST.
{
  const root = copyRoot(v1, 'v1-renamed-real-boot');
  child(root, {}, "const st = store(); const p = st.catalog.getProductBySlug('pet-stone'); st.afterProductChange(st.catalog.updateProduct(p.id, { title: 'אבן מחמד, בשם שבעל האתר נתן' }));");
  // 2.68 made no category pages; the fixture root was built by today's code, which does
  child(root, {}, "const pages = require('./src/pages'); for (const p of pages.listPages()) if (/^shelf-/.test(p.full_path)) pages.deletePage(p.full_path); require('./src/export').exportAll();");
  for (const f of fs.readdirSync(path.join(root, 'public'))) if (/^shelf-.*\.html$/.test(f)) fs.unlinkSync(path.join(root, 'public', f));
  fs.writeFileSync(path.join(root, 'public', '.built-by'), '2.68.0-alpha+dev\n');
  const was = child(root, {}, INSPECT).out;
  const wasFile = fs.existsSync(path.join(root, 'public', 'shelf-small.html'));
  const env = Object.assign({}, process.env);
  for (const k of STRIP) delete env[k];
  Object.assign(env, FLAG, { TAPUZ_ROOT: root, PORT: '3948' });
  // the server never ends by itself: it is given seven seconds, then asked to close
  const run = spawnSync(process.execPath, ['src/server.js'], { cwd: REPO, env, encoding: 'utf8', timeout: 7000, killSignal: 'SIGTERM' });
  const log = (run.stdout || '') + (run.stderr || '');
  const seen = child(root, {}, INSPECT).out;
  const serverSrc = fs.readFileSync(path.join(REPO, 'src', 'server.js'), 'utf8');
  ok(serverSrc.indexOf('exp.exportIsStale()') > 0 && serverSrc.indexOf('exp.exportIsStale()') < serverSrc.indexOf("require('./store/demo-seed').maybeDemoStore()"),
    'the server asks whether a new build arrived BEFORE the demo step rewrites the export');
  ok(was.hashed === 0 && !was.pages.some((x) => /^shelf-/.test(x)) && !wasFile && /title="עוד מהחנות"/.test(was.source['shop-left-sock'] || ''),
    'before the boot: 2.68\'s product pages, no category page');
  ok(log.includes('[demo-store] v2: catalog kept') && log.includes('footer upgraded') && /\[store\] \d+ generated page\(s\) follow the new build/.test(log),
    'a real boot on a kept catalog: the demo step writes (and re-exports), and the generated pages STILL follow the build');
  ok(seen.products.length === 8 && bySlug(seen.products, 'pet-stone').title === 'אבן מחמד, בשם שבעל האתר נתן' && seen.homepage === 'shop',
    '…the owner\'s catalog and home page are still his');
  ok(seen.hashed === 8 && !/title="עוד מהחנות"/.test(seen.source['shop-left-sock'] || '') && ['shelf-small', 'shelf-huge', 'shelf-quiet'].every((x) => seen.pages.includes(x + ':published')),
    '…every product page is today\'s shape, and each category has its page');
  ok(fs.existsSync(path.join(root, 'public', 'shelf-small.html')) && !html(root, 'shop-left-sock.html').includes('עוד מהחנות')
    && fs.readFileSync(path.join(root, 'public', '.built-by'), 'utf8').trim() !== '2.68.0-alpha+dev',
    '…and they reached the exported files, not only the database');
}

{
  const root = copyRoot(v1, 'v1-home-edited');
  child(root, {}, "const pages = require('./src/pages'); pages.savePageSource('shop', pages.getPageSource('shop', 'draft') + '\\n<bent-text>שורה שבעל האתר הוסיף</bent-text>', { publish: true });");
  const boot = child(root, FLAG, BOOT);
  const parts = (boot.out.r && boot.out.r.parts) || {};
  const seen = child(root, {}, INSPECT).out;
  ok(parts.catalog === 'upgraded' && seen.products.length === 24 && seen.offered.join() === 'pretend:demo', 'an owner edited the home page → the catalog is still upgraded');
  ok(parts.pages === 'kept' && boot.stdout.includes('[demo-store] v2: pages kept — the owner edited the home page')
    && seen.source.shop.includes('שורה שבעל האתר הוסיף') && seen.source.shop.includes('columns="3"') && seen.homepage === 'shop' && !seen.pages.some((p) => p.startsWith('home:')),
    '…and that page is kept: his line is there, it is still the home page, and no `home` page was made');
  ok(parts.menu === 'kept' && seen.menu.map((i) => i.label).join(' · ') === 'דף הבית · חנות', '…and so is the menu (version 2\'s would list his one page twice)');
  ok(html(root, 'index.html').includes('שורה שבעל האתר הוסיף') && count(html(root, 'index.html'), '<article class="bent-shop-card') === 24, 'his home page now shows the twenty-four products');
}

{
  const root = copyRoot(v1, 'v1-menu-edited');
  child(root, {}, "const menus = require('./src/menus'); menus.saveMenu('main', menus.getMenu('main').concat([{ label: 'צור קשר', type: 'custom', url: '/contact.html' }]));");
  const boot = child(root, FLAG, BOOT + INSPECT);
  ok(boot.out.r.parts.catalog === 'upgraded' && boot.out.r.parts.pages === 'upgraded' && boot.out.r.parts.menu === 'kept' && boot.stdout.includes('[demo-store] v2: menu kept — the owner edited it')
    && boot.out.menu.map((i) => i.label).join(' · ') === 'דף הבית · חנות · צור קשר',
    'an owner added a menu link → the menu is kept, everything else is upgraded');

  const words = copyRoot(v1, 'v1-words-edited');
  child(words, {}, "const c = require('./src/config'); const cfg = c.loadConfig(); cfg.description = 'התיאור של בעל האתר'; cfg.footer = Object.assign({}, cfg.footer, { text: 'שורת הפוטר שלו' }); c.saveConfig(cfg);");
  const kept = child(words, FLAG, BOOT + INSPECT);
  ok(kept.out.r.parts.description === 'kept' && kept.out.r.parts.footer === 'kept' && kept.out.description === 'התיאור של בעל האתר' && kept.out.footer === 'שורת הפוטר שלו' && kept.out.r.parts.catalog === 'upgraded',
    'an owner\'s own site description and footer line are kept');
}

// ── 7. nothing, byte for byte ──────────────────────────────────────────

{
  const root = copyRoot(v1, 'v1-no-flag');
  const was = tree(root);
  const r = child(root, {}, BOOT);
  ok(r.out.r.reason === 'not armed' && tree(root) === was, 'a version 1 root without the flag: nothing');

  const fake = newRoot('living-fake');
  fs.mkdirSync(path.join(fake, 'config'));
  fs.writeFileSync(path.join(fake, 'config', 'site.json'), '{"title":"אתר קיים"}\n', 'utf8');
  fs.mkdirSync(path.join(fake, 'db'));
  fs.writeFileSync(path.join(fake, 'db', 'tapuz.db'), 'not-a-database-but-do-not-touch', 'utf8');
  const fakeWas = tree(fake);
  const refused = child(fake, FLAG, BOOT);
  ok(refused.out.r.ran === false && refused.stdout.includes('NOT applied') && tree(fake) === fakeWas, 'a living root whose database cannot even be read + the flag: byte for byte untouched');
}

const someones = newRoot('someones-shop');
{
  const built = child(someones, {}, `
    const st = store();
    require('./src/pages').createPage({ title: 'אודות', slug: 'about', blocks: [], status: 'published' });
    st.catalog.createProduct({ title: 'נר שעווה', price: '49.90', stock: 3 });
    st.catalog.createProduct({ title: 'סבון', price: '25', stock: 7 });
    st.flip(true);
    const placed = st.orders.placeOrder({ items: [{ sku: st.catalog.listProducts({})[0].slug, qty: 1 }], shipping: 'pickup', payment: 'phone', customer: ${BUYER} });
    db().prepare("UPDATE store_orders SET created_at = datetime('now', '-30 hours')").run();
    out.placed = placed.ok;
  `);
  ok(built.out.placed === true && fs.existsSync(path.join(someones, 'config', 'menus.json')), 'somebody\'s real shop could be prepared (two products, a page, a day-old order)');
  const was = tree(someones);
  const boot = child(someones, FLAG, BOOT);
  ok(boot.out.r.ran === false && boot.stdout.includes('NOT applied') && tree(someones) === was && markers(someones) === null,
    'a living NON-demo shop + the flag: byte for byte untouched, no marker');
  const opened = child(someones, FLAG, "require('./src/db'); " + BOOT + ' out.demo = seed.isDemoSite(); out.h = seed.housekeeping(); out.u = seed.upgradeDemo(); out.order = db().prepare("SELECT status, customer_name FROM store_orders").get();');
  ok(opened.out.r.ran === false && opened.out.demo === false && markers(someones) === null && tree(someones) === was,
    '…also when the database is already open, as it is in the server');
  ok(opened.out.h.cancelled + opened.out.h.scrubbed + opened.out.h.restocked === 0 && opened.out.order.status === 'new' && opened.out.order.customer_name === 'דנה לדוגמה' && opened.out.u.ok === false,
    'housekeeping() and upgradeDemo() do nothing on a site that is not a demo, flag or no flag');
}

// ── 8. an unmarked version 1 demo (the 2.68 script wrote no marker) ────

const unmarked = newRoot('v1-unmarked');
{
  const built = child(unmarked, Object.assign({}, FLAG, KEYS), 'out.r = seed.applyDemoV1({ marker: false });' + AS_268_LEFT_IT + INSPECT);
  ok(built.out.r.ok === true && markers(unmarked) === null && built.out.isDemo === false && built.out.products.length === 8 && bySlug(built.out.products, 'left-sock').stock === 39,
    'a script-seeded version 1 root can be built: the demo, no marker, nothing calls it a demo');

  const adopted = copyRoot(unmarked, 'adopted');
  const boot = child(adopted, FLAG, BOOT);
  const m = markers(adopted) || {};
  const seen = child(adopted, {}, INSPECT).out;
  ok(boot.out.r.ran === true && boot.out.r.adopted === true && boot.stdout.includes('[demo-store] adopted: an unmarked v1 demo'), '(a) an unmarked version 1 demo + the flag is adopted');
  ok(!!m['demo-store'] && !!m['demo-store-v2'] && seen.products.length === 24 && seen.version === 2 && seen.homepage === 'home' && seen.offered.join() === 'pretend:demo',
    '(a) …and upgraded: both markers, twenty-four products, the demo payment offered');

  const viaServer = copyRoot(unmarked, 'adopted-db-open');
  const served = child(viaServer, FLAG, "require('./src/db'); " + BOOT + INSPECT);
  ok(served.out.r.adopted === true && served.out.products.length === 24 && served.out.offered.join() === 'pretend:demo', '(a) the same with the database already open, as the server has it');

  // the 2.68 script ended with process.exit(): its database was never closed, and the whole catalog sat in the write-ahead log
  const hot = newRoot('v1-unmarked-log');
  const killed = child(hot, FLAG, "out.r = seed.applyDemoV1({ marker: false }); process.kill(process.pid, 'SIGKILL');");
  const logSize = (() => { try { return fs.statSync(path.join(hot, 'db', 'tapuz.db-wal')).size; } catch (e) { return 0; } })();
  ok(killed.signal === 'SIGKILL' && logSize > 0 && markers(hot) === null, 'a script-seeded root whose database was never closed could be prepared (its catalog is in the log)');
  const fromLog = child(hot, FLAG, BOOT + INSPECT);
  ok(fromLog.out.r && fromLog.out.r.adopted === true && fromLog.out.products.length === 24, '(a) it is adopted and upgraded too: the first look reads the log');

  const renamed = copyRoot(unmarked, 'unmarked-renamed');
  child(renamed, {}, "const st = store(); const p = st.catalog.getProductBySlug('pet-stone'); st.afterProductChange(st.catalog.updateProduct(p.id, { title: 'אבן אחרת לגמרי' }));");
  let was = tree(renamed);
  let r = child(renamed, FLAG, BOOT);
  ok(r.out.r.ran === false && r.stdout.includes('NOT applied') && tree(renamed) === was && markers(renamed) === null, '(b) the same root with one product renamed + the flag: untouched byte for byte, no marker');

  const reworded = copyRoot(unmarked, 'unmarked-reworded');
  child(reworded, {}, "const st = store(); const p = st.catalog.getProductBySlug('pet-stone'); st.catalog.updateProduct(p.id, { description: 'תיאור שבעל האתר כתב מחדש.' });");
  was = tree(reworded);
  r = child(reworded, FLAG, BOOT);
  ok(r.out.r.ran === false && tree(reworded) === was && markers(reworded) === null, '(b) …one description rewritten (the first look passes, the rule does not): untouched, no marker');

  const ninth = copyRoot(unmarked, 'unmarked-ninth');
  child(ninth, {}, "store().catalog.createProduct({ title: 'מוצר תשיעי', price: '10', status: 'draft' });");
  was = tree(ninth);
  r = child(ninth, FLAG, BOOT);
  ok(r.out.r.ran === false && tree(ninth) === was && markers(ninth) === null, '(b) …a ninth product, even a draft: untouched, no marker');

  const coupon = copyRoot(unmarked, 'unmarked-shipping');
  child(coupon, {}, "const st = store(); const s = st.settings.loadSettings(); s.shipping[1].price = 100; st.settings.saveSettings({ shipping: s.shipping });");
  was = tree(coupon);
  r = child(coupon, FLAG, "require('./src/db'); " + BOOT);
  ok(r.out.r.ran === false && tree(coupon) === was && markers(coupon) === null, '(b) …a shipping price changed: untouched, no marker');

  const damaged = copyRoot(unmarked, 'unmarked-bad-marker');
  fs.writeFileSync(path.join(damaged, 'config', 'seeded.json'), '{ this is not json', 'utf8');
  was = tree(damaged);
  r = child(damaged, FLAG, BOOT);
  ok(r.out.r.ran === false && tree(damaged) === was, 'a marker file that cannot be read is never overwritten: nothing is adopted');

  const quiet = copyRoot(unmarked, 'unmarked-no-flag');
  was = tree(quiet);
  r = child(quiet, {}, BOOT + ' out.demo = seed.isDemoSite();');
  ok(r.out.r.reason === 'not armed' && r.out.demo === false && tree(quiet) === was, '(c) the same root without the flag: untouched');
}

// ── 9. a seed that cannot land leaves the root empty ───────────────────

{
  const root = newRoot('plan-fails');
  const r = child(root, FLAG, `
    const st = store();
    const real = st.document.planDocument;
    st.document.planDocument = () => ({ ok: false, errors: [{ code: 'BROKEN', message: 'broken on purpose' }], warnings: [], hard: true, notes: [], preview: null, plan: null });
    out.refused = seed.maybeDemoStore();
    const fs = require('fs'); const path = require('path');
    out.config = fs.existsSync(path.join(process.env.TAPUZ_ROOT, 'config')) ? fs.readdirSync(path.join(process.env.TAPUZ_ROOT, 'config')) : [];
    out.art = fs.existsSync(path.join(process.env.TAPUZ_ROOT, 'public', 'assets'));
    st.document.planDocument = real;
    out.then = seed.maybeDemoStore();
  `).out;
  ok(r.refused && r.refused.ran === false && r.config.length === 0 && r.art === false, 'a catalog that fails its plan writes no art, no theme and no marker');
  ok(r.then && r.then.ran === true && r.then.products === 24, '…so the same root is seeded by the next boot instead of being refused for ever');
}

// ── 10. the shop restocks itself and forgets its visitors ──────────────

{
  const root = copyRoot(fresh, 'housekeeping');
  const r = child(root, FLAG, `
    const st = store();
    const pay = require('./src/store/demo-pay');
    const order = (sku, shipping, extra) => st.orders.placeOrder(Object.assign({ items: [{ sku, qty: 1 }], shipping, payment: 'pretend', customer: ${BUYER}, note: 'לצלצל פעמיים' }, extra || {}));
    const old = order('left-sock', 'pigeon', { address: { city: 'עיר לדוגמה', street: 'רחוב הדוגמה 1' } });
    const oldPaid = order('chair-manual', 'pickup');
    const young = order('pet-stone', 'pickup');
    out.placed = old.ok && oldPaid.ok && young.ok;
    pay.payForOrder(oldPaid.order.token);
    db().prepare("UPDATE store_orders SET created_at = datetime('now', '-25 hours') WHERE number IN (?, ?)").run(old.order.number, oldPaid.order.number);
    db().prepare("UPDATE store_orders SET created_at = datetime('now', '-1 hours') WHERE number = ?").run(young.order.number);
    st.catalog.setStock('shy-mirror', '', 0);
    st.catalog.setStock('music-cancelling', 'black', 1);
    const stock = (sku, code) => { const p = st.catalog.getProductBySlug(sku); return code ? p.variants.find((v) => v.code === code).stock : p.stock; };
    const row = (o) => { const x = st.orders.getOrder(o.order.number); return { number: x.number, status: x.status, name: x.customer_name, email: x.customer_email, phone: x.customer_phone, address: x.address, note: x.note, total: x.total, erased: x.erased, items: st.orders.listItems(x.id).length, events: st.orders.listEvents(x.id).map((e) => e.kind) }; };
    out.soldOut = stock('chair-manual');
    out.was = { old: row(old), oldPaid: row(oldPaid), young: row(young) };

    delete process.env.TAPUZ_DEMO_STORE;
    out.noFlag = seed.housekeeping();
    process.env.TAPUZ_DEMO_STORE = '1';
    process.env.TAPUZ_DEMO_RESET_HOURS = '48';
    out.longWindow = seed.housekeeping();
    out.untouched = row(old).status + '/' + row(old).name;
    delete process.env.TAPUZ_DEMO_RESET_HOURS;

    st.catalog.setStock('shy-mirror', '', 0);
    st.catalog.setStock('music-cancelling', 'black', 1);
    out.first = seed.housekeeping();
    out.now = { old: row(old), oldPaid: row(oldPaid), young: row(young) };
    out.stock = { sock: stock('left-sock'), chair: stock('chair-manual'), stone: stock('pet-stone'), mirror: stock('shy-mirror'),
      black: stock('music-cancelling', 'black'), clear: stock('music-cancelling', 'clear'), map: stock('nowhere-map') };
    out.second = seed.housekeeping();
  `);
  const o = r.out;
  ok(o.placed === true && o.soldOut === 0 && o.was.old.name === 'דנה לדוגמה' && o.was.old.address.includes('רחוב הדוגמה'), 'three demo orders could be placed (two a day old, one of them demo-paid; one an hour old) and a product sold out');
  ok(o.noFlag.cancelled + o.noFlag.scrubbed + o.noFlag.restocked === 0, 'housekeeping does nothing without the flag');
  ok(o.longWindow.cancelled + o.longWindow.scrubbed === 0 && o.longWindow.restocked === 2 && o.untouched === 'new/דנה לדוגמה',
    'with a 48-hour window a 25-hour-old order is left alone (the shelf is still restocked: that does not wait for the window)');
  ok(o.first.cancelled === 2 && o.first.scrubbed === 2 && r.stdout.includes('[demo-store] housekeeping: cancelled 2, scrubbed 2, restocked'), 'with the default window the two day-old orders are cancelled and scrubbed, in one log line');
  for (const key of ['old', 'oldPaid']) {
    const was = o.was[key];
    const now = o.now[key];
    ok(now.status === 'cancelled' && now.email === '' && now.phone === '' && now.address === '{}' && now.note === '' && !now.name.includes('דנה') && now.erased === 1,
      (key === 'old' ? 'the unpaid one' : 'the demo-paid one') + ': cancelled, and its name, mail, phone, address and note are gone');
    ok(now.number === was.number && now.total === was.total && now.items === was.items && now.events.includes('erased'), '…its number, its items and its sum are kept, and the order says it was scrubbed');
  }
  ok(o.stock.sock === 40 && o.stock.chair === 1, 'their stock is back: the sock at 40, the sold-out chair manual at 1');
  ok(JSON.stringify(o.now.young) === JSON.stringify(o.was.young) && o.stock.stone === 5, 'the hour-old order is untouched, and the stock it holds stays held');
  ok(o.first.restocked === 2 && o.stock.mirror === 5 && o.stock.black === 8, 'a sold-out product and a low option with no open order are put back to the catalog\'s numbers');
  ok(o.stock.clear === 0 && o.stock.map === 0, 'what the catalog itself sells out (the map, the transparent headphones) stays sold out');
  ok(o.second.cancelled + o.second.scrubbed + o.second.restocked === 0, 'a second pass finds nothing to do');
}

fs.rmSync(HOME, { recursive: true, force: true });
console.log(failed ? '\nSMOKE STORE-DEMO: FAIL (' + failed + ')' : '\nSMOKE STORE-DEMO: PASS');
process.exit(failed ? 1 : 0);
