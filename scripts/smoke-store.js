'use strict';

/**
 * v2.53 QA — the store, module by module, on a throwaway site.
 *
 * What it holds the store to:
 *   money      integers only; what a person types parses; one formatter;
 *              VAT inside / on top / exempt
 *   catalog    validation that speaks Hebrew; slugs; variants; shelves
 *   quote      the server decides every sum: a tampered price is ignored,
 *              stock clamps, sold-out and vanished products leave, coupons
 *              and free shipping apply, the minimum order blocks
 *   orders     stock and coupon uses are taken inside ONE immediate
 *              transaction — two PROCESSES racing for the last unit: one
 *              order, one "the cart changed"; cancel gives stock back,
 *              restore takes it again (or refuses, saying why)
 *   privacy    the shopper's order page shows no phone/email/street; an
 *              erasure request strips the person, keeps the sale
 *   BenTML     <bent-store> parses what a chat writes, refuses a page,
 *              round-trips byte for byte; plan → apply → undo, backups are
 *              BenTML; a whole document hides (never deletes) the missing
 *   storefront server-rendered, escaped, sold-out marked, JSON-LD safe
 *   the flip   BenTML pages + product pages + one menu link + header cart;
 *              a page the owner owns is never taken over; closing removes
 *              the cart and the script from the export
 *   the pack   the site package carries <bent-store>; the database .pzn
 *              (backup / live restore = hot swap) carries the whole shop
 *              and the storefront is rebuilt from it
 *
 * Run: node scripts/smoke-store.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-'));
process.env.TAPUZ_ROOT = ROOT;

let failed = 0;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) failed++;
}

require('../src/db');
const { runSetup } = require('../src/setup');
runSetup({
  title: 'הסטודיו של נועה', description: 'נרות וסבונים',
  colors: { primary: '#7c2d12', bg: '#ffffff', lightBg: '#fef3c7', text: '#1c1917' },
  menuPlacement: 'top', pages: ['home', 'about'], menuPages: ['home', 'about'], external: []
});

const store = require('../src/store');
const { money, catalog, coupons, pricing, orders, settings, document: doc } = store;
const dialect = require('../src/bentml/store-dialect');
const pages = require('../src/pages');
const PUBLIC = path.join(ROOT, 'public');
const read = (f) => { try { return fs.readFileSync(path.join(PUBLIC, f), 'utf8'); } catch (e) { return ''; } };

(async () => {
  // ── money ────────────────────────────────────────────────────────────
  check('money: "89.90" / "₪89,90" / "1,234.50" / "1.234,50" / 89.9 parse to agorot',
    money.toMinor('89.90') === 8990 && money.toMinor('₪89,90') === 8990 && money.toMinor('1,234.50') === 123450 &&
    money.toMinor('1.234,50') === 123450 && money.toMinor(89.9) === 8990 && money.toMinor('25') === 2500);
  check('money: garbage, negatives and the ambiguous "1.234" (1.234 or 1,234?) are not prices — refused, never guessed',
    Number.isNaN(money.toMinor('abc')) && Number.isNaN(money.toMinor('-5')) && Number.isNaN(money.toMinor('')) && Number.isNaN(money.toMinor('1.234')));
  check('money: one formatter — ₪89.90, ₪1,500, -₪10',
    money.formatMoney(8990) === '₪89.90' && money.formatMoney(150000) === '₪1,500' && money.formatMoney(-1000) === '-₪10');
  check('money: VAT inside a total (18% of 118 = 18) and on top of a net',
    money.vatInside(11800, 18) === 1800 && money.vatOnTop(10000, 18) === 1800 && money.vatInside(5000, 0) === 0);

  // ── catalog ──────────────────────────────────────────────────────────
  settings.saveSettings({
    shipping: [
      { id: 'pickup', label: 'איסוף עצמי', price: '0', address: false },
      { id: 'delivery', label: 'משלוח עד הבית', price: '30', freeOver: '300', address: true }
    ],
    payments: [{ id: 'bank', kind: 'bank', label: 'העברה בנקאית', details: 'בנק 12, חשבון 345' }]
  });
  catalog.saveShelf({ slug: 'candles', label: 'נרות' });
  catalog.saveShelf({ slug: 'soaps', label: 'סבונים' });
  const lav = catalog.createProduct({
    title: 'נר לבנדר', price: '89.90', compareAt: '120', stock: 3, shelf: 'candles',
    summary: 'נר סויה', description: 'שורה ראשונה.\n\nפסקה <b>שנייה</b>.', images: ['/demo/tile-1.svg', 'javascript:alert(1)']
  });
  check('catalog: a Hebrew title makes a Hebrew slug', lav.product.slug === 'נר-לבנדר');
  check('catalog: a script-scheme picture is dropped (and said)', lav.product.images.length === 1 && lav.warnings.some((w) => /תמונה/.test(w)));
  const soap = catalog.createProduct({ title: 'סבון זית', price: '25', shelf: 'soaps' });
  const shirt = catalog.createProduct({ title: 'חולצה', price: '100', shelf: 'soaps', variants: [{ label: 'S', stock: 1 }, { label: 'M', price: '120' }] });
  const ebook = catalog.createProduct({ title: 'ספר דיגיטלי', price: '40', delivery: false });
  const dup = catalog.createProduct({ title: 'סבון זית', price: '30' });
  check('catalog: a taken slug gets a suffix, never an overwrite', dup.product.slug === 'סבון-זית-2' && catalog.getProduct(soap.product.slug).price === 2500);
  let refused = null;
  try { catalog.createProduct({ title: '', price: 'abc' }); } catch (e) { refused = e; }
  check('catalog: a product with no name and no price is refused in Hebrew', !!refused && /חסר שם/.test(refused.message) && /מחיר/.test(refused.message));
  check('catalog: variant codes come from labels', shirt.product.variants.map((v) => v.code).join(',') === 's,m');
  const upd = catalog.updateProduct(soap.product.id, { price: '27.50', slug: 'hacked' });
  check('catalog: an update keeps the slug (identity) and takes the price', upd.product.slug === 'סבון-זית' && upd.product.price === 2750);
  catalog.deleteProduct(dup.product.id);

  // ── quote ────────────────────────────────────────────────────────────
  const q1 = pricing.quote({
    items: [
      { sku: 'נר-לבנדר', qty: 5, price: 1 },      // a tampered "price" rides along — and is ignored
      { sku: 'נר-לבנדר', qty: 1 },                // the same line twice merges
      { sku: 'חולצה', qty: 1 },                   // needs an option
      { sku: 'nope', qty: 1 },                    // does not exist
      { sku: 'סבון-זית', variant: 'x', qty: 2 }   // a stray variant on a product without options
    ],
    shipping: 'delivery'
  });
  const lavLine = q1.lines.find((l) => l.sku === 'נר-לבנדר');
  check('quote: the server price wins over anything the browser sends', lavLine && lavLine.unit === 8990);
  check('quote: duplicate lines merge, then clamp to the stock (6 → 3)', lavLine && lavLine.qty === 3 && q1.issues.some((i) => i.code === 'STOCK_LIMIT'));
  check('quote: a product that is gone leaves with a sentence', q1.issues.some((i) => i.code === 'GONE') && !q1.lines.some((l) => l.sku === 'nope'));
  check('quote: an option-less product ignores a stray variant', q1.lines.some((l) => l.sku === 'סבון-זית' && l.variant === '' && l.qty === 2));
  check('quote: a product with options needs one', q1.issues.some((i) => i.code === 'VARIANT_REQUIRED'));
  check('quote: subtotal / free shipping over 300 / VAT inside',
    q1.subtotal === 3 * 8990 + 2 * 2750 && q1.shipping === 0 && q1.vat === money.vatInside(q1.total, 18) && q1.changed === true);
  check('quote: the store is closed → CLOSED blocks, even for a good cart', q1.blocking.includes('CLOSED'));
  const q2 = pricing.quote({ items: [{ sku: 'ספר-דיגיטלי', qty: 1 }] });
  check('quote: a digital product asks for no shipping at all', q2.needsShipping === false && q2.shippingOptions.length === 0 && q2.shipping === 0);
  settings.saveSettings({ open: true });
  coupons.saveCoupon({ code: 'welcome10', kind: 'percent', value: 10, maxUses: 1 });
  coupons.saveCoupon({ code: 'FIVE', kind: 'amount', value: '5' });
  coupons.saveCoupon({ code: 'SHIP', kind: 'shipping', minSubtotal: '50' });
  coupons.saveCoupon({ code: 'OLD', kind: 'percent', value: 50, endsOn: '2020-01-01' });
  const qc = pricing.quote({ items: [{ sku: 'סבון-זית', qty: 2 }], shipping: 'delivery', payment: 'bank', coupon: 'Welcome10' });
  check('quote: a percent coupon (any case) takes 10% of the subtotal', qc.coupon.ok && qc.discount === 550 && qc.total === 5500 - 550 + 3000);
  check('quote: an expired coupon is said, never blocking', pricing.quote({ items: [{ sku: 'סבון-זית', qty: 1 }], coupon: 'old' }).coupon.message === 'תוקף הקוד פג');
  const qs = pricing.quote({ items: [{ sku: 'סבון-זית', qty: 2 }], shipping: 'delivery', coupon: 'SHIP' });
  check('quote: a free-shipping coupon zeroes delivery above its minimum', qs.coupon.ok && qs.shipping === 0);
  check('quote: …and not below it', pricing.quote({ items: [{ sku: 'סבון-זית', qty: 1 }], shipping: 'delivery', coupon: 'SHIP' }).coupon.ok === false);
  settings.saveSettings({ minOrder: '100' });
  check('quote: the minimum order blocks with its sum', pricing.quote({ items: [{ sku: 'סבון-זית', qty: 1 }], shipping: 'pickup', payment: 'bank' }).blocking.includes('MIN_ORDER'));
  settings.saveSettings({ minOrder: '0' });
  settings.saveSettings({ pricesIncludeVat: false });
  const qv = pricing.quote({ items: [{ sku: 'סבון-זית', qty: 2 }], shipping: 'pickup' });
  check('quote: prices without VAT add it on top', qv.vat === 990 && qv.total === 5500 + 990);
  settings.saveSettings({ pricesIncludeVat: true, vatExempt: true });
  check('quote: an exempt business shows no VAT line', pricing.quote({ items: [{ sku: 'סבון-זית', qty: 1 }] }).vat === 0);
  settings.saveSettings({ vatExempt: false });

  // ── orders ───────────────────────────────────────────────────────────
  const customer = { name: 'דנה כהן', phone: '050-1234567', email: 'dana@example.com' };
  const address = { city: 'תל אביב', street: 'הרצל 1', zip: '6100000' };
  const fields = orders.placeOrder({ items: [{ sku: 'סבון-זית', qty: 1 }], shipping: 'delivery', payment: 'bank', customer: { name: 'x', phone: '12' }, address: {} });
  check('order: the form is checked field by field (name, phone, city, street)',
    fields.code === 'FIELDS' && ['name', 'phone', 'city', 'street'].every((f) => fields.fields.some((x) => x.field === f)));
  const o1 = orders.placeOrder({ items: [{ sku: 'נר-לבנדר', qty: 2 }, { sku: 'חולצה', variant: 's', qty: 1 }], shipping: 'delivery', payment: 'bank', coupon: 'WELCOME10', customer, address, note: 'להשאיר ליד הדלת' },
    { orderUrl: (t) => '/order.html?o=' + t });
  check('order: placed, numbered from 1001, with a long random token', o1.ok && o1.order.number === '1001' && /^[A-Za-z0-9_-]{24}$/.test(o1.order.token));
  check('order: stock taken (lavender 3 → 1, shirt S 1 → 0)', catalog.getProduct('נר-לבנדר').stock === 1 && catalog.getProduct('חולצה').variants.find((v) => v.code === 's').stock === 0);
  check('order: the coupon use is taken', coupons.getCoupon('WELCOME10').used === 1);
  check('order: a sold-out option now says so (stockChanged → the storefront is rebuilt)', o1.stockChanged === true);
  const o2 = orders.placeOrder({ items: [{ sku: 'סבון-זית', qty: 1 }], shipping: 'pickup', payment: 'bank', coupon: 'WELCOME10', customer: { name: 'יוסי לוי', phone: '0521112233' } });
  check('order: an exhausted coupon is not applied the second time', o2.ok && o2.order.discountText === '' && coupons.getCoupon('WELCOME10').used === 1);
  check('order: numbers keep counting (1002)', o2.order.number === '1002');
  const sold = orders.placeOrder({ items: [{ sku: 'חולצה', variant: 's', qty: 1 }], shipping: 'pickup', payment: 'bank', customer });
  check('order: a sold-out line comes back as CART_CHANGED with the new cart', sold.ok === false && sold.code === 'CART_CHANGED' && sold.quote && sold.quote.lines.length === 0);
  const pub = orders.publicOrder(orders.getOrder('1001'));
  const pubJson = JSON.stringify(pub);
  check('privacy: the order page carries no phone, email or street', !pubJson.includes('050-1234567') && !pubJson.includes('dana@example.com') && !pubJson.includes('הרצל'));
  check('order page: payment instructions and first name only', pub.payment.details === 'בנק 12, חשבון 345' && pub.firstName === 'דנה' && pub.items.length === 2);

  // two PROCESSES race for the last unit
  catalog.updateProduct(ebook.product.id, { stock: 1 });
  const racer = (tag) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', `
      process.env.TAPUZ_ROOT = ${JSON.stringify(ROOT)};
      const o = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'store', 'orders'))});
      const r = o.placeOrder({ items: [{ sku: 'ספר-דיגיטלי', qty: 1 }], payment: 'bank', customer: { name: 'מתחרה ${tag}', phone: '0500000000' } });
      process.stdout.write(JSON.stringify({ ok: r.ok, code: r.code || '' }));
    `], { env: { ...process.env, TAPUZ_ROOT: ROOT } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch (e) { resolve({ ok: null, raw: out }); } });
  });
  const [ra, rb] = await Promise.all([racer('A'), racer('B')]);
  check('race: two processes, one last unit → exactly one order',
    [ra, rb].filter((r) => r.ok === true).length === 1 && [ra, rb].some((r) => r.ok === false && r.code === 'CART_CHANGED') &&
    catalog.getProduct('ספר-דיגיטלי').stock === 0);

  // cancel / restore
  orders.setStatus('1001', 'cancelled', { notify: false });
  check('cancel: stock and the coupon use come back', catalog.getProduct('נר-לבנדר').stock === 3 &&
    catalog.getProduct('חולצה').variants.find((v) => v.code === 's').stock === 1 && coupons.getCoupon('WELCOME10').used === 0);
  orders.setStatus('1001', 'new', { notify: false });
  check('restore: a cancelled order takes its stock again', catalog.getProduct('נר-לבנדר').stock === 1);
  orders.setStatus('1001', 'cancelled', { notify: false });
  catalog.setStock('נר-לבנדר', '', 1);
  let restoreErr = null;
  try { orders.setStatus('1001', 'processing', { notify: false }); } catch (e) { restoreErr = e; }
  check('restore: refused, naming the product, when the stock is not there', !!restoreErr && /נר לבנדר/.test(restoreErr.message) && orders.getOrder('1001').status === 'cancelled');
  orders.markPaid('1002', true);
  orders.setTracking('1002', 'IL123');
  check('order: paid + tracking + a history line for each', !!orders.getOrder('1002').paid_at && orders.getOrder('1002').tracking === 'IL123' &&
    orders.listEvents(orders.getOrder('1002').id).length >= 3);
  const csv = orders.ordersCsv();
  check('csv: BOM, Hebrew header, every order', csv.charCodeAt(0) === 0xfeff && /מספר,תאריך,סטטוס/.test(csv) && /1001/.test(csv) && /1002/.test(csv));
  orders.placeOrder({ items: [{ sku: 'סבון-זית', qty: 1 }], shipping: 'pickup', payment: 'bank', customer: { name: '=HYPERLINK("x")', phone: '0501231234' } });
  check('csv: a name that starts with = is data, not a spreadsheet formula', /'=HYPERLINK/.test(orders.ordersCsv()));

  // privacy: erasure keeps the sale, drops the person
  const n = orders.eraseForSubject({ email: 'DANA@example.com' });
  const erased = orders.getOrder('1001');
  check('erase: the person leaves the order, the sale stays', n === 1 && erased.erased === 1 && erased.customer_email === '' && erased.customer_phone === '' &&
    erased.total > 0 && orders.listItems(erased.id).length === 2);

  // ── the <bent-store> dialect ─────────────────────────────────────────
  const chat = 'בשמחה! הנה הקטלוג:\n```html\n<bent-store version=“1” name="חנות">\n<bent-category slug="x" name="איקס"/>\n' +
    '<bent-product sku="a1" name="מוצר <א>" price="10" compare-at="12" qty="4" category="x">\n  שורה &amp; עוד\n  <bent-option code="s" label="קטן" price="9"/>\n' +
    '<bent-sku id="b2" title="בלי סגירה" price="5">\n</bent-store>\n```\nמקווה שעזרתי';
  const parsed = dialect.parseStoreDoc(chat);
  const codes = parsed.notes.map((x) => x.code);
  check('dialect: prose, a fence, curly quotes, aliases and an unclosed product are all read',
    parsed.doc && parsed.doc.products.length === 2 && parsed.doc.products[0].id === 'a1' && parsed.doc.products[0].variants.length === 1 &&
    parsed.doc.shelves[0].id === 'x' && codes.includes('CURLY_QUOTES') && codes.includes('TAG_ALIAS') && codes.includes('ATTR_ALIAS') && codes.includes('UNCLOSED_SKU'));
  check('dialect: a page is refused as a page', dialect.parseStoreDoc('<bent-heading>שלום</bent-heading><bent-shop></bent-shop>').errors[0].code === 'PAGE_NOT_STORE');
  check('dialect: a menu and a theme are refused by name', dialect.parseStoreDoc('<bent-menus><bent-menu name="main"/></bent-menus>').errors[0].code === 'MENU_NOT_STORE' &&
    dialect.parseStoreDoc('<bent-theme name="x"></bent-theme>').errors[0].code === 'THEME_NOT_STORE');
  check('dialect: a fragment without <bent-store> can only merge', dialect.parseStoreDoc('<bent-sku id="z" title="ז" price="1"/>').doc.mode === 'merge');
  const exported = doc.exportDocument();
  const again = dialect.serializeStore((() => { const p = dialect.parseStoreDoc(exported).doc; return { ...doc.currentState(), ...{ products: p.products.map((x) => ({ ...x })) } }; })());
  check('dialect: the live store round-trips byte for byte', exported === again);
  check('dialect: a "<" in a description is escaped in the document', /&lt;b&gt;שנייה/.test(exported));

  // ── the document door ────────────────────────────────────────────────
  const edited = exported.replace('price="27.50"', 'price="29"').replace(/  <bent-sku id="ספר-דיגיטלי"[^\n]*\n/, '');
  const plan = doc.planDocument(edited);
  check('plan: a price change and a product that is missing (→ hidden) are both named',
    plan.ok && plan.preview.changed.some((c) => c.id === 'סבון-זית' && c.fields.some((f) => /₪27.50 → ₪29/.test(f))) &&
    plan.preview.hidden.some((h) => h.id === 'ספר-דיגיטלי'));
  const applied = doc.applyDocument(edited);
  check('apply: done, backed up first — as a BenTML document', applied.ok && /^<bent-store/.test(doc.getBackup(applied.backupId).source));
  check('apply: the missing product is hidden, never deleted', catalog.getProduct('ספר-דיגיטלי').status === 'hidden');
  check('apply: stock absent from a product keeps today\'s stock', catalog.getProduct('נר-לבנדר').stock === 1);
  const un = doc.undoLast();
  check('undo: the newest backup is back (price and visibility)', un.ok && catalog.getProduct('סבון-זית').price === 2750 && catalog.getProduct('ספר-דיגיטלי').status === 'active');
  const empty = doc.applyDocument('<bent-store version="1"></bent-store>');
  check('apply: an empty whole-catalog document needs confirmation (EMPTY_STORE)', !empty.ok && empty.code === 'NEEDS_CONFIRM' && empty.warnings.some((w) => w.code === 'EMPTY_STORE'));
  const bad = doc.planDocument('<bent-store><bent-sku id="q" title="שבור" price="abc"/><bent-sku id="w" title="טוב" price="3"/></bent-store>');
  check('plan: a broken product is a hard warning, the good one still counts', bad.ok && bad.hard && bad.warnings.some((w) => w.code === 'PRODUCT_INVALID') && bad.preview.added.some((a) => a.id === 'w'));
  const merged = doc.applyDocument('<bent-store mode="merge"><bent-sku id="vanilla" title="נר וניל" price="59" stock="unlimited"/></bent-store>');
  check('merge: adds without hiding anything', merged.ok && catalog.getProduct('vanilla').stock === null && catalog.getProduct('סבון-זית').status === 'active');

  // ── the storefront ───────────────────────────────────────────────────
  const render = require('../src/store/render');
  catalog.createProduct({ title: 'x</h3><script>alert(1)</script>', price: '1', slug: 'evil' });
  const grid = render.renderShop({ filter: true });
  check('shop: real products, prices and add-to-cart buttons', /נר לבנדר/.test(grid) && /₪89.90/.test(grid) && /data-tz-add/.test(grid));
  check('shop: a product name is escaped (no markup from the catalog)', !/<script>alert/.test(grid) && /&lt;script&gt;/.test(grid));
  check('shop: shelf chips only when asked', /data-tz-shelf="candles"/.test(grid) && !/data-tz-shelf/.test(render.renderShop({})));
  check('shop: a titled strip with nothing in it disappears', render.renderShop({ title: 'עוד', shelf: 'none-such' }) === '');
  const buy = render.renderBuy({ sku: 'חולצה' });
  check('buy: options with a disabled sold-out one? no — S is back in stock; M carries its price', /<option value="m" data-price="₪120"/.test(buy));
  const buyEvil = render.renderBuy({ sku: 'evil' });
  check('buy: the JSON-LD cannot be closed by a product name', !/<\/script><script>alert/.test(buyEvil) && /\\u003c\/h3>/.test(buyEvil));
  check('buy: a missing product says so', /אינו זמין/.test(render.renderBuy({ sku: 'nope' })));

  // ── the flip ─────────────────────────────────────────────────────────
  // an owner's own page already lives at /cart — it must never be taken over
  pages.createPage({ title: 'העגלה של סבתא', slug: 'cart', status: 'published', blocks: [] });
  const opened = store.flip(true);
  check('flip: the store pages are created in BenTML, the owner\'s /cart kept (store-cart instead)',
    opened.pages.created.includes('shop') && opened.pages.created.includes('store-cart') && opened.pages.moved.cart &&
    pages.getPageByFullPath('cart').title === 'העגלה של סבתא' && settings.loadSettings().pages.cart === 'store-cart');
  check('flip: the shop page source is BenTML (<bent-shop>)', /<bent-shop filter="true"/.test(pages.getPageSource('shop', 'published') || ''));
  check('flip: every active product has its page; the hidden one does not',
    !!pages.getPageByFullPath('shop-נר-לבנדר') && pages.getPageByFullPath('shop-נר-לבנדר').status === 'published');
  check('flip: "חנות" joins the main menu once', opened.menu.added === true && store.flip(true).menu.added === false);
  const shopHtml = read('shop.html');
  check('export: the live shop is a shop (products, header cart, storefront script)',
    /bent-shop-card/.test(shopHtml) && /class="tz-cart-link" href="\/store-cart.html"/.test(shopHtml) && /<script src="\/tz-store.js\?v=[^"]*" defer data-cart="\/store-cart.html"/.test(shopHtml));
  check('export: a product page carries its buy box and SEO line', /data-tz-buy data-sku="נר-לבנדר"/.test(read('shop-נר-לבנדר.html')) && /content="נר סויה"/.test(read('shop-נר-לבנדר.html')));
  catalog.updateProduct('vanilla', { status: 'hidden' });
  store.afterProductChange(catalog.getProduct('vanilla'));
  check('a hidden product\'s page is taken down (kept as a draft)', pages.getPageByFullPath('shop-vanilla').status === 'draft' && !read('shop-vanilla.html'));
  const closed = store.flip(false);
  const closedHtml = read('shop.html');
  check('flip off: the cart and the script leave the site; pages, products and orders stay',
    closed.open === false && !/tz-cart-link/.test(closedHtml) && !/tz-store.js/.test(closedHtml) && /bent-shop-card/.test(closedHtml) &&
    /סגורה כרגע/.test(closedHtml) && orders.countByStatus().all >= 3);
  check('flip off: checkout refuses', orders.placeOrder({ items: [{ sku: 'סבון-זית', qty: 1 }], shipping: 'pickup', payment: 'bank', customer }).code === 'CLOSED');
  store.flip(true);

  // ── the pack: site package + the database .pzn ─────────────────────
  const sitePackage = require('../src/site-package');
  const pkg = sitePackage.exportSitePackage('גיבוי');
  check('site package: the store travels as its <bent-store> document (no orders inside)',
    pkg.store && /^<bent-store/.test(pkg.store.source) && /נר לבנדר/.test(pkg.store.source) && !JSON.stringify(pkg).includes('dana@example.com'));

  const dbm = require('../src/db');
  const snap = path.join(ROOT, 'snapshot.pzn');
  dbm.snapshotTo(snap);
  const before = { products: catalog.countProducts().total, orders: orders.countByStatus().all, open: store.isOpen() };
  // the shop "changes hands": wipe the store tables, then hot-swap the .pzn back in
  dbm.db.exec('DELETE FROM store_order_items; DELETE FROM store_order_events; DELETE FROM store_orders; DELETE FROM store_variants; DELETE FROM store_products; DELETE FROM store_meta;');
  check('(the store is gone before the restore)', catalog.countProducts().total === 0 && !store.isOpen());
  const restored = require('../src/db-restore').restoreFromSnapshot(snap);
  check('hot swap: the .pzn brings the whole shop back — products, orders, settings, the open flip',
    restored.ok && catalog.countProducts().total === before.products && orders.countByStatus().all === before.orders && store.isOpen() === before.open &&
    catalog.getProduct('חולצה').variants.length === 2);
  check('hot swap: the storefront is rebuilt from the restored shop', /bent-shop-card/.test(read('shop.html')) && /נר לבנדר/.test(read('shop.html')));

  // a second install: the site package's store lands through the same door
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-b-'));
  const res = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', `
      process.env.TAPUZ_ROOT = ${JSON.stringify(other)};
      require(${JSON.stringify(path.join(__dirname, '..', 'src', 'db'))});
      const sp = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'site-package'))});
      const r = sp.importSitePackage(${JSON.stringify(pkg)}, { overwrite: false });
      const st = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'store'))});
      process.stdout.write(JSON.stringify({ store: r.store, products: st.catalog.countProducts(), open: st.isOpen() }));
    `], { env: { ...process.env, TAPUZ_ROOT: other } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch (e) { resolve({ raw: out }); } });
  });
  check('site package → another install: the catalog arrives, the store stays closed (a package never opens a shop)',
    res.store && res.store.ok && res.products && res.products.total >= 5 && res.open === false);

  console.log('\nSMOKE STORE: ' + (failed ? 'FAIL (' + failed + ')' : 'PASS'));
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  console.log('\nSMOKE STORE: FAIL');
  process.exit(1);
});
