'use strict';

/**
 * v2.69 QA — what the review of the admin screens and the catalog found,
 * each finding held by the case that showed it.
 *
 *   options    a MERGE document that names some of a product's options adds
 *              and updates those — the options it does not name stay, with
 *              their prices and their stock. A whole-catalog document's list
 *              is still the whole truth (and keep="…" does not change that)
 *   stock      a stock nobody can read as a whole number ("1O", "3 units",
 *              "12.5") never turns counting off on a product that exists: the
 *              store's number stays and a note says so. "5.00" and "1,000" ARE
 *              whole numbers (a sheet formats them that way)
 *   status     a status the document does not know never publishes a draft;
 *              the words the CSV door reads are read here too
 *   CSV        the same child category under two parents is two categories;
 *              a SKU that repeats in one file is skipped by its line; a cost
 *              is written only for a product the import really wrote
 *   lookups    a sort key or a category id that is also a member of every
 *              object ("constructor") is just a word
 *   line()     a 150 KB one-line cell is cleaned in milliseconds
 *   schema     a picture address 2.68 accepted as "//host/x.png" is rewritten
 *              to https:// once, at boot — nothing else is touched
 *   the doors  (HTTP, port 4240) the editor's "+ קטגוריה חדשה" never rewrites a
 *              category that exists; the AI catalog writer is the manager's
 *              alone; the delete dialogs say what restoring a backup rolls back
 *
 * Run: node scripts/smoke-store-review.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-review-'));
const PORT = 4240;
const BASE = `http://127.0.0.1:${PORT}`;
const REPO = path.join(__dirname, '..');
process.env.TAPUZ_ROOT = ROOT;

// The throwaway root has no site, and the store rebuilds the site after
// every apply — the exporter's "no published pages" notice is expected here.
const realWarn = console.warn;
console.warn = (...a) => { if (!/^\[export\] no published pages/.test(String(a[0]))) realWarn(...a); };

let failed = 0;
function ok(cond, label) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + label);
  if (!cond) failed++;
}
function throws(fn, re) {
  try { fn(); } catch (e) { return re.test(String(e && e.message)); }
  return false;
}

const { db } = require('../src/db');
const { initializeStore } = require('../src/store/schema');
const store = require('../src/store');
const { catalog, document: doc } = store;
const csvIo = require('../src/store/csv-io');

const sku = (slug) => catalog.getProductBySlug(slug);
/** A product's options as one line: code:label:price:stock, in their order. */
const options = (slug) => sku(slug).variants.map((v) => [v.code, v.label, String(v.price), String(v.stock)].join(':')).join(' ');
const soft = (plan, re) => (plan.warnings || []).some((w) => !w.hard && re.test(w.message));

function catalogFacts() {
  // ── options: a merge only adds and updates ───────────────────────────
  const three = [{ code: 's', label: 'S', stock: 3 }, { code: 'm', label: 'M', stock: 4 }, { code: 'l', label: 'L', stock: 5 }];
  catalog.createProduct({ slug: 'tee', title: 'Tee', price: '50', description: 'כותנה סרוקה', variants: three });

  // first, what must NOT change: in a whole-catalog document the tag's list is the whole list
  const whole = '<bent-store keep="description"><bent-sku id="tee" title="Tee" price="50"><bent-variant id="l" label="L" price="70" /><bent-variant id="s" label="S" stock="9" /></bent-sku></bent-store>';
  const wholePlan = doc.planDocument(whole);
  doc.applyDocument(whole, { force: true });
  ok(options('tee') === 'l:L:7000:5 s:S:null:9',
    'options: in a whole-catalog document the tag\'s option list is still the whole list (and a stock it does not write is kept)');
  ok(wholePlan.ok && sku('tee').description === 'כותנה סרוקה', 'options: keep="description" still keeps the description, and covers no option');
  catalog.updateProduct('tee', { variants: three });

  const oneOption = '<bent-sku id="tee"><bent-variant id="l" price="70" /></bent-sku>';
  const onePlan = doc.planDocument(oneOption);
  doc.applyDocument(oneOption);
  ok(options('tee') === 'l:L:7000:5 s:S:null:3 m:M:null:4',
    'options: a merge that names ONE option of three changes that one — the other two stay, with their stock');
  ok(onePlan.ok && !onePlan.hard && onePlan.preview.changed.length === 1 && onePlan.preview.changed[0].fields.join() === 'אפשרויות',
    'options: …and its plan is one soft "אפשרויות" line (nothing is removed, so nothing asks)');
  doc.applyDocument('<bent-sku id="tee"><bent-variant id="xl" label="XL" stock="2" /></bent-sku>');
  ok(options('tee') === 'xl:XL:null:2 l:L:7000:5 s:S:null:3 m:M:null:4', 'options: a merge that names a NEW option adds it beside the ones the product has');
  doc.applyDocument('<bent-sku id="tee"><bent-variant label="M" price="55" /></bent-sku>');
  ok(options('tee') === 'm:M:5500:4 xl:XL:null:2 l:L:7000:5 s:S:null:3',
    'options: an option tag with a label and no id finds the option that has that code — its stock stays, and no twin appears');
  doc.applyDocument('<bent-store mode="merge"><bent-sku id="tee"><bent-variant id="s" stock="9" /></bent-sku></bent-store>');
  ok(options('tee') === 's:S:null:9 m:M:5500:4 xl:XL:null:2 l:L:7000:5', 'options: the same under <bent-store mode="merge">');
  doc.applyDocument('<bent-store mode="merge" keep="description, summary"><bent-sku id="tee"><bent-variant id="xl" stock="6" /></bent-sku></bent-store>');
  ok(options('tee') === 'xl:XL:null:6 s:S:null:9 m:M:5500:4 l:L:7000:5' && sku('tee').description === 'כותנה סרוקה',
    'options: …and under the root the AI writer is shown (mode="merge" keep="…") — the options it did not name and the description all stay');

  const fifty = Array.from({ length: 50 }, (_, i) => ({ code: 'o' + (i + 1), label: 'O' + (i + 1), stock: i + 1 }));
  catalog.createProduct({ slug: 'many', title: 'Many', price: '5', variants: fifty });
  const full = '<bent-sku id="many"><bent-variant id="o7" stock="70" /><bent-variant id="n1" label="N1" /><bent-variant id="n2" label="N2" /></bent-sku>';
  const fullPlan = doc.planDocument(full);
  doc.applyDocument(full);
  const manyNow = sku('many').variants;
  ok(manyNow.length === 50 && fifty.every((o) => manyNow.some((v) => v.code === o.code && v.stock === (o.code === 'o7' ? 70 : o.stock))) &&
    soft(fullPlan, /Many/) && soft(fullPlan, /50/),
  'options: a product that is full (50 options) loses none of them to a merge — the new ones do not fit, and a note says so');

  // ── stock: a typo never turns counting off ───────────────────────────
  catalog.createProduct({ slug: 'lav', title: 'Lav', price: '10', stock: 3 });
  let held = true;
  for (const typo of ['1O', '3 units', '12.5']) {
    const text = `<bent-sku id="lav" stock="${typo}" />`;
    const plan = doc.planDocument(text);
    doc.applyDocument(text);
    if (!(plan.ok && !plan.hard && plan.preview.changed.length === 0 && sku('lav').stock === 3 &&
      plan.warnings.some((w) => !w.hard && w.message.includes(typo) && /נשאר כפי שהוא/.test(w.message)))) held = false;
  }
  ok(held, 'stock: stock="1O" / "3 units" / "12.5" on a product that exists changes nothing — the 3 stays, and a soft note says "נשאר כפי שהוא"');
  const typoSheet = csvIo.csvToDocument('sku,stock\r\nlav,1O\r\n');
  const typoPlan = doc.planDocument(typoSheet.source, { trusted: true });
  doc.applyDocument(typoSheet.source, { trusted: true, reason: 'csv' });
  ok(sku('lav').stock === 3 && !typoPlan.hard && soft(typoPlan, /1O/) && soft(typoPlan, /נשאר כפי שהוא/), 'stock: the same typo in a sheet\'s stock cell leaves the 3 where it is');

  const stockAfter = (cell) => {
    const sheet = csvIo.csvToDocument('sku,stock\r\nlav,' + cell + '\r\n');
    const r = doc.applyDocument(sheet.source, { trusted: true, reason: 'csv' });
    return r.ok ? sku('lav').stock : 'refused';
  };
  ok(stockAfter('5.00') === 5 && stockAfter('"1,000"') === 1000 && stockAfter('"1,250.00"') === 1250 && stockAfter('7') === 7,
    'stock: "5.00", "1,000" and "1,250.00" are whole numbers — a sheet that formats its numbers imports them');
  const whole5 = catalog.normalizeProduct({ title: 't', price: '1', stock: '5.00', weight: '320.0' });
  const half = catalog.normalizeProduct({ title: 't', price: '1', stock: '12.50' });
  ok(whole5.product.stock === 5 && whole5.product.weight === 320 && whole5.warnings.length === 0 && half.product.stock === null && half.warnings.some((w) => /המלאי/.test(w)),
    'stock: the whole-number reader takes an all-zero decimal part and still refuses "12.50"');
  ok(stockAfter('') === null && stockAfter('3') === 3, 'stock: an empty stock cell is still "not counted"');
  doc.applyDocument('<bent-sku id="lav" stock="unlimited" />');
  const unlimited = sku('lav').stock;
  catalog.setStock('lav', '', 3);
  ok(unlimited === null && throws(() => catalog.setStock('lav', '', '12.5'), /מספר שלם/) && sku('lav').stock === 3,
    'stock: stock="unlimited" still turns counting off, and the quick stock edit still refuses "12.5"');

  const fresh = '<bent-sku id="fresh" title="Fresh" price="5" stock="1O" />';
  const freshPlan = doc.planDocument(fresh);
  doc.applyDocument(fresh);
  ok(freshPlan.preview.added.length === 1 && sku('fresh').stock === null && soft(freshPlan, /Fresh/) && soft(freshPlan, /1O/) && soft(freshPlan, /בלי ספירת מלאי/),
    'stock: on a NEW product an unreadable stock is "not counted", and the note says exactly that');

  const optionTypo = '<bent-sku id="tee"><bent-variant id="s" stock="1O" /><bent-variant id="xxl" label="XXL" stock="many" /></bent-sku>';
  const optionPlan = doc.planDocument(optionTypo);
  doc.applyDocument(optionTypo);
  ok(options('tee') === 's:S:null:9 xxl:XXL:null:null xl:XL:null:6 m:M:5500:4 l:L:7000:5' && soft(optionPlan, /נשאר כפי שהוא/) && soft(optionPlan, /XXL/),
    'stock: an option\'s unreadable stock keeps that option\'s number (9); a new option\'s is "not counted" — both said');
  const cellTypo = csvIo.csvToDocument('sku,variants\r\ntee,s|S||3 units;l|L|70|4.00\r\n');
  doc.applyDocument(cellTypo.source, { trusted: true, reason: 'csv' });
  ok(options('tee') === 's:S:null:9 l:L:7000:4 xxl:XXL:null:null xl:XL:null:6 m:M:5500:4',
    'stock: the same in a sheet\'s variants cell — "3 units" keeps the 9, "4.00" is 4, and the options the cell left out stay');

  // ── status: a word nobody knows never publishes a draft ──────────────
  catalog.createProduct({ slug: 'dr', title: 'Draft', price: '10', status: 'draft' });
  const soon = '<bent-sku id="dr" status="soon" />';
  const soonPlan = doc.planDocument(soon);
  doc.applyDocument(soon);
  ok(sku('dr').status === 'draft' && soonPlan.ok && !soonPlan.hard && soonPlan.preview.changed.length === 0 && soft(soonPlan, /soon/) && soft(soonPlan, /נשאר כפי שהוא/),
    'status: status="soon" on a draft leaves it a draft, with a soft note that names the word');
  const archived = doc.planDocument('<bent-sku id="dr" status="archived" />');
  ok(archived.preview.changed.length === 1 && archived.preview.changed[0].fields.join() === 'סטטוס: טיוטה → מוסתר' && !soft(archived, /סטטוס לא מוכר/),
    'status: status="archived" hides (it used to publish) — the words the CSV door reads are read by the document too');
  const statusAfter = (word) => { doc.applyDocument(`<bent-sku id="dr" status="${word}" />`); return sku('dr').status; };
  ok(statusAfter('Published') === 'active' && statusAfter('מוסתר') === 'hidden' && statusAfter('טיוטה') === 'draft' && statusAfter('hidden') === 'hidden' && statusAfter('draft') === 'draft',
    'status: published / מוסתר / טיוטה / hidden / draft each land where they say');
  const newSoon = '<bent-sku id="nw" title="Nw" price="3" status="soon" />';
  const newSoonPlan = doc.planDocument(newSoon);
  doc.applyDocument(newSoon);
  ok(sku('nw').status === 'draft' && soft(newSoonPlan, /soon/) && soft(newSoonPlan, /טיוטה/), 'status: a NEW product with a status nobody knows lands as a draft, and is told so');
  doc.applyDocument('<bent-sku id="nw2" title="Nw2" price="3" />');
  ok(sku('nw2').status === 'active', 'status: a new product that names no status is still active');
  const sheetStatus = csvIo.csvToDocument('sku,status\r\ndr,whatever\r\nnw,archived\r\n');
  ok(sheetStatus.warnings.some((w) => w.line === 2 && /סטטוס לא מוכר/.test(w.message)) && /<bent-sku id="nw"[^>]* status="hidden"/.test(sheetStatus.source) &&
    !/<bent-sku id="dr"[^>]* status=/.test(sheetStatus.source),
  'status: the CSV door still maps "archived" and still leaves an unknown word alone, by its line');

  // ── CSV: the same child name under two parents ───────────────────────
  const two = csvIo.csvToDocument('sku,title,price,category\r\nm1,Mens shirt,10,Men > Shirts\r\nw1,Womens shirt,10,Women > Shirts\r\nw2,Womens top,10,Women > Shirts\r\n');
  const twoPlan = doc.planDocument(two.source, { trusted: true });
  const landsOn = (plan, id) => (plan.plan.products.find((p) => p.slug === id) || {}).shelf;
  const plannedShelf = (plan, slug) => plan.plan.shelves.find((s) => s.slug === slug) || {};
  ok(landsOn(twoPlan, 'm1') === 'shirts' && landsOn(twoPlan, 'w1') === 'women-shirts' && landsOn(twoPlan, 'w2') === 'women-shirts' &&
    plannedShelf(twoPlan, 'shirts').parent === 'men' && plannedShelf(twoPlan, 'women-shirts').parent === 'women' && plannedShelf(twoPlan, 'women-shirts').label === 'Shirts',
  'csv: "Men > Shirts" and "Women > Shirts" are two categories — each product lands under its own parent');
  doc.applyDocument(two.source, { trusted: true, reason: 'csv' });
  const third = csvIo.csvToDocument('sku,title,price,category\r\nk1,Kids shirt,10,Kids > Shirts\r\nm2,Mens polo,10,Men > Shirts\r\nx1,Any shirt,10,Shirts\r\n');
  const thirdPlan = doc.planDocument(third.source, { trusted: true });
  ok(landsOn(thirdPlan, 'k1') === 'kids-shirts' && plannedShelf(thirdPlan, 'kids-shirts').parent === 'kids' && landsOn(thirdPlan, 'm2') === 'shirts' &&
    landsOn(thirdPlan, 'x1') === 'shirts' && thirdPlan.plan.shelves.length === 2,
  'csv: a shop that already has Men > Shirts gives "Kids > Shirts" its own category; "Men > Shirts" and a bare "Shirts" find the one that is there');
  const back = doc.planDocument(csvIo.csvToDocument(csvIo.exportCsv()).source, { trusted: true });
  ok(back.ok && back.preview.changed.length === 0 && back.preview.added.length === 0 && back.preview.shelvesAdded.length === 0 && back.preview.shelvesChanged.length === 0 &&
    landsOn(back, 'w1') === 'women-shirts' && landsOn(back, 'm1') === 'shirts',
  'csv: the shop\'s own export → import changes nothing — two categories called Shirts each get their products back');

  // ── CSV: a repeated SKU, and what the apply says it wrote ────────────
  const dup = csvIo.csvToDocument('sku,title,price,cost\r\ndup,First,10,5\r\ndup,Second,20,9\r\nother,Other,5,2\r\n');
  ok(dup.ok && dup.count === 2 && dup.costs.dup === 500 && dup.costs.other === 200 && !/Second/.test(dup.source) &&
    dup.warnings.some((w) => w.line === 3 && /dup/.test(w.message)),
  'csv: a SKU that repeats in one file is skipped with a warning on ITS line — the first row wins, and so does its cost');
  const dupApplied = doc.applyDocument(dup.source, { trusted: true, reason: 'csv' });
  ok(dupApplied.ok && dupApplied.changed.products === 2 && JSON.stringify(dupApplied.changed.slugs) === '["dup","other"]' && sku('dup').title === 'First',
    'document: an apply answers changed.slugs — the SKUs it wrote (changed.products is still the count)');

  // ── lookups: "constructor" is just a word ────────────────────────────
  let sorted = true;
  for (const key of ['constructor', '__proto__', 'toString', 'valueOf', 'nope']) {
    try {
      if (JSON.stringify(catalog.listProducts({ sort: key }).map((p) => p.slug)) !== JSON.stringify(catalog.listProducts({ sort: 'manual' }).map((p) => p.slug))) sorted = false;
    } catch (e) { sorted = false; }
  }
  ok(sorted && catalog.listProducts({ sort: 'name' })[0].title <= catalog.listProducts({ sort: 'name' })[1].title,
    'lookups: a sort key nobody defined — "constructor", "__proto__", "toString" — is the manual order, not a broken query');
  catalog.saveShelf({ slug: 'constructor', label: 'בנייה' });
  catalog.saveShelf({ slug: 'bricks', label: 'לבנים', parent: 'constructor' });
  const built = catalog.listShelves().find((s) => s.slug === 'constructor');
  ok(built.count === 0 && built.total === 0 && built.all === 0, 'lookups: a category whose id is "constructor" counts 0 products (it used to count a function)');
  catalog.deleteShelf('bricks');
  catalog.deleteShelf('constructor');

  // ── line(): one pass, whatever the length ────────────────────────────
  const title = (v) => catalog.normalizeProduct({ title: v, price: '1' }).product.title;
  ok(title('a \n b') === 'a b' && title('\n\tabc\r\n') === 'abc' && title('a\n\n\nb') === 'a b' && title('a\n \t \nb') === 'a b' &&
    title('  a  b  ') === 'a  b' && title('a\tb\r\nc') === 'a b c' && catalog.normalizeProduct({ title: ' \n\t ', price: '1' }).errors.length === 1,
  'line(): a line break or a tab is one space, the ends are trimmed, spaces inside a line are left alone');
  const bigSheet = 'sku,title,price\r\nq1,"a' + ' '.repeat(150000) + 'b",5\r\n';
  const t0 = Date.now();
  const bigPlan = doc.planDocument(csvIo.csvToDocument(bigSheet).source, { trusted: true });
  const ms = Date.now() - t0;
  ok(bigPlan.ok && ms < 1500, `line(): a sheet whose title cell is 150 KB of spaces is planned in ${ms} ms (it held the server for seconds)`);

  // ── schema: a 2.68 picture address ───────────────────────────────────
  db.prepare("UPDATE store_products SET images = ? WHERE slug = 'lav'").run(JSON.stringify(['//cdn.example/a.png', '/assets/b.png', '//cdn.example/c.png']));
  db.prepare("UPDATE store_products SET images = ? WHERE slug = 'dr'").run(JSON.stringify(['/assets/d.png', 'https://shop.example/e.png']));
  const rows = () => JSON.stringify(db.prepare('SELECT id, images, updated_at FROM store_products ORDER BY id').all());
  const lavStamp = db.prepare("SELECT updated_at FROM store_products WHERE slug = 'lav'").get().updated_at;
  const others = () => JSON.stringify(db.prepare("SELECT * FROM store_products WHERE slug != 'lav' ORDER BY id").all());
  const othersBefore = others();
  initializeStore(db);
  const once = rows();
  ok(JSON.stringify(sku('lav').images) === JSON.stringify(['https://cdn.example/a.png', '/assets/b.png', 'https://cdn.example/c.png']),
    'schema: a picture saved by 2.68 as //host/x.png is https://host/x.png after boot');
  ok(others() === othersBefore && db.prepare("SELECT updated_at FROM store_products WHERE slug = 'lav'").get().updated_at === lavStamp,
    'schema: …no row without such an address is touched, and nothing looks edited');
  initializeStore(db);
  ok(rows() === once, 'schema: …and booting again changes nothing');
  const saved = catalog.updateProduct('lav', { title: 'Lav 2' });
  ok(saved.product.images.length === 3 && saved.warnings.length === 0, 'schema: the next save of that product keeps all three pictures');
}

// ── the doors, through real HTTP ────────────────────────────────────────

function req(method, urlPath, { body, cookie, headers: extra } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE, ...(extra || {}) };
    if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers.Cookie = cookie;
    const r = http.request(BASE + encodeURI(urlPath), { method, headers }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { /* html or text */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitUp(tries = 80) {
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
  let child = null;
  try {
    catalogFacts();

    const { runSetup } = require('../src/setup');
    runSetup({
      title: 'הסטודיו של נועה', description: 'נרות',
      colors: { primary: '#7c2d12', bg: '#ffffff', lightBg: '#fef3c7', text: '#1c1917' },
      menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
    });
    const auth = require('../src/auth');
    const owner = auth.createAdmin('owner', 'owner-pass-1');
    const editor = auth.addTeamMember('ed', 'editor-pass-12', 'editor');
    const OWNER = auth.COOKIE_NAME + '=' + auth.makeToken(owner.id);
    const EDITOR = auth.COOKIE_NAME + '=' + auth.makeToken(editor.id);
    store.settings.saveSettings({
      shipping: [{ id: 'pickup', label: 'איסוף עצמי', price: '0', address: false }],
      payments: [{ id: 'bank', kind: 'bank', label: 'העברה בנקאית', details: 'BANK-LINE-12345' }]
    });
    store.coupons.saveCoupon({ code: 'QUIETCODE', kind: 'percent', value: 50 });
    catalog.saveShelf({ slug: 'holidays', label: 'חגים' });
    catalog.saveShelf({ slug: 'gifts', label: 'מתנות לחג', parent: 'holidays', summary: 'טקסט', image: '/assets/g.png', hidden: true });
    catalog.saveShelf({ slug: 'מתנות', label: 'מתנות', parent: 'holidays', seoTitle: 'כותרת' });
    catalog.createProduct({ slug: 'keep', title: 'Keep', price: '50', cost: '30' });
    catalog.createProduct({ slug: 'unreleased', title: 'Unreleased', price: '999', status: 'draft' });

    child = spawn(process.execPath, [path.join(REPO, 'src', 'server.js')], {
      env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT) },
      stdio: 'ignore'
    });
    await waitUp();
    const page = (p, cookie = OWNER) => req('GET', p, { cookie, headers: { Accept: 'text/html' } });
    const post = (p, body, cookie = OWNER) => req('POST', p, { cookie, body: body === undefined ? {} : body });

    // ── the editor's "+ קטגוריה חדשה" ──────────────────────────────────
    const giftsBefore = JSON.stringify(catalog.getShelf('gifts'));
    const hebBefore = JSON.stringify(catalog.getShelf('מתנות'));
    const again = await post('/admin/api/store/shelves', { label: 'Gifts', parent: '' });
    ok(again.status === 200 && again.json.ok === true && again.json.existed === true && again.json.shelf.slug === 'gifts' &&
      again.json.shelf.label === 'מתנות לחג' && again.json.shelf.parent === 'holidays' && JSON.stringify(catalog.getShelf('gifts')) === giftsBefore,
    'new-category door: a name whose id is taken answers the category AS IT IS (existed: true) — its name, parent, picture and hidden switch untouched');
    const againHeb = await post('/admin/api/store/shelves', { label: 'מתנות ', parent: '' });
    ok(againHeb.status === 200 && againHeb.json.existed === true && againHeb.json.shelf.parent === 'holidays' && JSON.stringify(catalog.getShelf('מתנות')) === hebBefore,
      'new-category door: …the same for a Hebrew name typed with a stray space');
    const made = await post('/admin/api/store/shelves', { label: 'חדש לגמרי', parent: 'holidays' });
    const nameless = await post('/admin/api/store/shelves', { label: '  ', parent: '' });
    ok(made.status === 200 && made.json.ok === true && !made.json.existed && made.json.shelf.parent === 'holidays' && !!catalog.getShelf(made.json.shelf.slug) &&
      nameless.status === 400 && /שם/.test(nameless.json.error || ''),
    'new-category door: a new name still creates the category, and no name is still refused with a sentence');
    const blank = await page('/admin/store/products/new');
    ok(blank.status === 200 && /if \(d\.existed\) TS\.toast\('[^']*כבר קיימת[^']*'/.test(blank.text),
      'new-category door: the product editor selects the category that was there and says so in a toast');

    // ── the AI catalog writer is the manager's ─────────────────────────
    const tells = /BANK-LINE-12345|QUIETCODE|Unreleased|unreleased/;
    const editorPrompt = await req('GET', '/admin/api/inject/store-catalog/prompt', { cookie: EDITOR });
    ok(editorPrompt.status === 403 && !tells.test(editorPrompt.text) && !!editorPrompt.json && editorPrompt.json.ok === false && /מנהל/.test(editorPrompt.json.error || ''),
      'catalog writer: an editor asking for its prompt (the whole store: payment details, coupons, drafts) gets 403 and a Hebrew sentence');
    const editorPaste = await post('/admin/api/inject/store-catalog/paste', { reply: '<bent-store><bent-sku id="keep" title="Keep" price="1"/></bent-store>' }, EDITOR);
    ok(editorPaste.status === 403 && !/₪/.test(editorPaste.text) && /מנהל/.test((editorPaste.json || {}).error || ''),
      'catalog writer: …and its preview door (a diff against the live prices) is closed to an editor too');
    const editorList = await req('GET', '/admin/api/inject', { cookie: EDITOR });
    const ownerList = await req('GET', '/admin/api/inject', { cookie: OWNER });
    const ids = (r) => ((r.json && r.json.packs) || []).map((p) => p.id);
    ok(editorList.status === 200 && !ids(editorList).includes('store-catalog') && ids(ownerList).includes('store-catalog') &&
      ids(editorList).length === ids(ownerList).length - 1 && ids(editorList).length >= 1,
    'catalog writer: the list of packs does not offer it to an editor; every other pack is still there');
    const otherPrompt = await req('GET', '/admin/api/inject/' + ids(editorList)[0] + '/prompt', { cookie: EDITOR });
    const ownerPrompt = await req('GET', '/admin/api/inject/store-catalog/prompt', { cookie: OWNER });
    const ownerPaste = await post('/admin/api/inject/store-catalog/paste', { reply: '<bent-sku id="keep" price="49" />' });
    ok(otherPrompt.status !== 403 && ownerPrompt.status === 200 && /QUIETCODE/.test(ownerPrompt.text) && ownerPaste.status === 200 && ownerPaste.json.ok === true,
      'catalog writer: an editor still reads the other packs, and the manager still gets the prompt and the preview');

    // ── CSV: a cost is written only for a product the import wrote ─────
    const sheet = 'sku,title,price,cost\r\nkeep,Keep,abc,1\r\nbrandnew,Brand new,5,2\r\n';
    const seen = await post('/admin/api/store/import-csv', { csv: sheet });
    ok(seen.status === 200 && seen.json.hard === true && seen.json.costs === 1, 'csv door: the preview counts ONE cost — not the refused row\'s');
    const landed = await post('/admin/api/store/import-csv', { csv: sheet, apply: true, force: true });
    ok(landed.status === 200 && landed.json.ok === true && landed.json.costs === 1 && sku('keep').price === 5000 && sku('keep').cost === 3000 && sku('brandnew').cost === 200,
      'csv door: a row that was refused (a price nobody can read) keeps its product\'s cost — only the row that landed writes one');
    const twice = await post('/admin/api/store/import-csv', { csv: 'sku,title,price,cost\r\ntwin,First,10,5\r\ntwin,Second,20,9\r\n', apply: true, force: true });
    ok(twice.status === 200 && sku('twin').title === 'First' && sku('twin').price === 1000 && sku('twin').cost === 500 &&
      twice.json.warnings.some((w) => /שורה 3/.test(w.message) && /twin/.test(w.message)),
    'csv door: a repeated SKU lands as its FIRST row — title, price and cost — and the answer names the skipped line');

    // ── the delete dialogs ─────────────────────────────────────────────
    const ROLLBACK = /מחזיר את כל הקטלוג לרגע הגיבוי/;
    const list = await page('/admin/store/products');
    const one = await page('/admin/store/products/' + sku('keep').id);
    ok(list.status === 200 && ROLLBACK.test(list.text) && /מוצרים שנוספו מאז יוסתרו/.test(list.text),
      'delete dialog (the list): says that restoring the backup rolls the WHOLE catalog back — later products hidden, stock as it was');
    ok(one.status === 200 && ROLLBACK.test(one.text) && /מוצרים שנוספו מאז יוסתרו/.test(one.text), 'delete dialog (the editor): says the same');
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    if (child) child.kill();
  }
  console.log('\nSMOKE STORE-REVIEW: ' + (failed ? 'FAIL (' + failed + ')' : 'PASS'));
  process.exit(failed ? 1 : 0);
})();
