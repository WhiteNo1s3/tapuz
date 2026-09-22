'use strict';

/**
 * v2.53 QA — the store through real HTTP, on a scratch site.
 *
 *   closed        checkout refuses (403 CLOSED), the quote says CLOSED, no
 *                 page carries the cart
 *   the gate      store screens need a session AND the admin role — an
 *                 editor gets 403 (prices and customers' orders)
 *   the flip      over HTTP: the shop page is served with real products, the
 *                 header cart and the storefront script
 *   the shopper   a tampered price is ignored; the form answers field by
 *                 field (422); the honeypot refuses (400); a 40 KB body is
 *                 refused before it is parsed (413); an order places and its
 *                 page shows no phone/email; a guessed token is 404; the
 *                 order door rate-limits (429 + Retry-After)
 *   the owner     every store screen renders; the order page, the printable
 *                 slip, the CSV; cancelling returns the stock; the BenTML
 *                 door previews, applies and undoes
 *   the script    /tz-store.js is served and writes remote text as text
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-store-route-'));
const PORT = 3971;
const BASE = `http://127.0.0.1:${PORT}`;

let failed = 0;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) failed++;
}

function req(method, urlPath, { body, raw, cookie, headers: extra } = {}) {
  return new Promise((resolve, reject) => {
    let data = null;
    const headers = { Accept: 'application/json', Origin: BASE, ...(extra || {}) };
    if (raw != null) {
      data = raw;
      headers['Content-Type'] = 'application/json';
    } else if (body != null) {
      data = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers.Cookie = cookie;
    const r = http.request(BASE + encodeURI(urlPath).replace(/%25/g, '%'), { method, headers }, (res) => {
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

function waitUp(tries = 60) {
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
    title: 'הסטודיו של נועה', description: 'נרות',
    colors: { primary: '#7c2d12', bg: '#ffffff', lightBg: '#fef3c7', text: '#1c1917' },
    menuPlacement: 'top', pages: ['home'], menuPages: ['home'], external: []
  });
  const auth = require('../src/auth');
  const owner = auth.createAdmin('owner', 'owner-pass-1');
  const editor = auth.addTeamMember('ed', 'editor-pass-12', 'editor');
  const OWNER = auth.COOKIE_NAME + '=' + auth.makeToken(owner.id);
  const EDITOR = auth.COOKIE_NAME + '=' + auth.makeToken(editor.id);
  const store = require('../src/store');
  store.settings.saveSettings({
    shipping: [{ id: 'pickup', label: 'איסוף עצמי', price: '0', address: false }, { id: 'delivery', label: 'משלוח', price: '30', address: true }],
    payments: [{ id: 'bank', kind: 'bank', label: 'העברה בנקאית', details: 'חשבון 12345' },
      { id: 'card', kind: 'link', label: 'כרטיס אשראי', url: 'https://pay.example.com/p?sum={total}&ref={order}' }]
  });
  store.catalog.createProduct({ title: 'נר לבנדר', slug: 'lavender', price: '89.90', stock: 3 });

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, TAPUZ_ROOT: ROOT, PORT: String(PORT), TAPUZ_STORE_ORDER_MAX: '6' },
    stdio: 'ignore'
  });

  try {
    await waitUp();

    // ── closed ────────────────────────────────────────────────────────
    const closedCheckout = await req('POST', '/api/store/checkout', { body: { items: [{ sku: 'lavender', qty: 1 }] } });
    check('closed: checkout refuses with 403 CLOSED', closedCheckout.status === 403 && closedCheckout.json && closedCheckout.json.code === 'CLOSED');
    const closedQuote = await req('POST', '/api/store/quote', { body: { items: [{ sku: 'lavender', qty: 1 }] } });
    check('closed: the quote still answers, and says CLOSED', closedQuote.status === 200 && closedQuote.json.quote.blocking.includes('CLOSED'));
    check('closed: the home page carries no cart', !/tz-cart-link/.test((await req('GET', '/')).text));

    // ── the gate ──────────────────────────────────────────────────────
    const anon = await req('GET', '/admin/store', { headers: { Accept: 'text/html' } });
    check('gate: no session → no store screen', anon.status === 302 || anon.status === 401 || anon.status === 403);
    check('gate: an editor gets 403 on the store screens and APIs',
      (await req('GET', '/admin/store', { cookie: EDITOR })).status === 403 &&
      (await req('POST', '/admin/api/store/flip', { cookie: EDITOR, body: { open: true } })).status === 403 &&
      (await req('GET', '/admin/store/orders', { cookie: EDITOR })).status === 403);

    // ── the owner builds, then flips ───────────────────────────────────
    const made = await req('POST', '/admin/api/store/products', { cookie: OWNER, body: { title: 'סבון זית', price: '25', stock: '', trackStock: false, images: [] } });
    check('owner: a product is created over HTTP (typed price "25" = ₪25)', made.status === 200 && made.json.ok && made.json.product.price === 2500);
    const flip = await req('POST', '/admin/api/store/flip', { cookie: OWNER, body: { open: true } });
    check('flip: over HTTP — the store pages are created', flip.status === 200 && flip.json.ok && flip.json.report.pages.created.includes('shop'));
    const shop = await req('GET', '/shop', { headers: { Accept: 'text/html' } });
    check('flip: /shop is served with real products, the header cart and the script',
      shop.status === 200 && /נר לבנדר/.test(shop.text) && /₪89.90/.test(shop.text) && /tz-cart-link/.test(shop.text) && /\/tz-store\.js\?v=/.test(shop.text));
    const script = await req('GET', '/tz-store.js', { headers: { Accept: '*/*' } });
    check('the storefront script is served', script.status === 200 && /javascript/.test(script.headers['content-type'] || '') && /tz_cart_v1/.test(script.text));

    // ── the shopper ───────────────────────────────────────────────────
    const tampered = await req('POST', '/api/store/quote', { body: { items: [{ sku: 'lavender', qty: 1, price: 1, unit: 1, total: 1 }], shipping: 'pickup' } });
    check('quote: a tampered price is ignored (₪89.90 stands)', tampered.json.quote.lines[0].unit === 8990 && tampered.json.quote.totalText === '₪89.90');
    const bad = await req('POST', '/api/store/checkout', { body: { items: [{ sku: 'lavender', qty: 1 }], shipping: 'delivery', payment: 'bank', customer: { name: '', phone: '' }, address: {} } });
    check('checkout: 422 with the fields to fix', bad.status === 422 && bad.json.code === 'FIELDS' && bad.json.fields.some((f) => f.field === 'street'));
    const bot = await req('POST', '/api/store/checkout', { body: { items: [{ sku: 'lavender', qty: 1 }], _hp: 'http://spam', customer: { name: 'בוט', phone: '0500000000' } } });
    check('checkout: the honeypot refuses (400), and nothing is ordered', bot.status === 400 && bot.json.code === 'REJECTED' && store.orders.countByStatus().all === 0);
    const form = await new Promise((resolve, reject) => {
      const data = new URLSearchParams({
        'items[0][sku]': 'lavender', 'items[0][qty]': '1', shipping: 'pickup', payment: 'bank',
        'customer[name]': 'טופס זר', 'customer[phone]': '0501112222'
      }).toString();
      const r = http.request(BASE + '/api/store/checkout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' } }, (res) => {
        let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ status: res.statusCode, text: buf }));
      });
      r.on('error', reject); r.write(data); r.end();
    });
    check('checkout: a cross-site HTML form (urlencoded) cannot place an order (415), nothing is ordered',
      form.status === 415 && store.orders.countByStatus().all === 0);
    const huge = await req('POST', '/api/store/checkout', { raw: JSON.stringify({ items: [], note: 'x'.repeat(40000) }) });
    check('checkout: a 40 KB body is refused before it is parsed (413)', huge.status === 413);
    const good = await req('POST', '/api/store/checkout', {
      body: {
        items: [{ sku: 'lavender', qty: 2 }, { sku: 'סבון-זית', qty: 1 }], shipping: 'delivery', payment: 'card',
        customer: { name: 'דנה כהן', phone: '050-1234567', email: 'dana@example.com' },
        address: { city: 'חיפה', street: 'הנביאים 3' }, note: 'תודה'
      }
    });
    check('checkout: the order is placed', good.status === 200 && good.json.ok && good.json.order.number === '1001');
    check('checkout: next = the order page with its token; pay = the owner\'s payment page with the sum (2×89.90 + 25 + 30 delivery) and the order number, no personal data',
      /\/order\.html\?o=[A-Za-z0-9_-]{20,}$/.test(good.json.next) && good.json.pay === 'https://pay.example.com/p?sum=234.80&ref=1001' &&
      !/dana|050|חיפה/.test(good.json.pay));
    const token = good.json.order.token;
    const view = await req('GET', '/api/store/order/' + token);
    check('order page: the order and how to pay — no phone, no email, no street',
      view.status === 200 && view.json.order.number === '1001' && view.json.order.payment.url.startsWith('https://pay.example.com') &&
      !/050-1234567|dana@example\.com|הנביאים/.test(view.text));
    check('order page: a guessed token is 404', (await req('GET', '/api/store/order/' + 'A'.repeat(24))).status === 404);
    check('the order page itself is live', (await req('GET', '/order', { headers: { Accept: 'text/html' } })).status === 200);

    // ── the owner's screens ───────────────────────────────────────────
    const screens = ['/admin/store', '/admin/store/products', '/admin/store/products/new', '/admin/store/orders',
      '/admin/store/orders/1001', '/admin/store/coupons', '/admin/store/settings', '/admin/store/bentml'];
    const rendered = [];
    for (const s of screens) rendered.push(await req('GET', s, { cookie: OWNER, headers: { Accept: 'text/html' } }));
    check('owner: every store screen renders (' + screens.length + ')', rendered.every((r) => r.status === 200 && /st-tabs/.test(r.text)));
    check('owner: the order screen names the customer and the address', /דנה כהן/.test(rendered[4].text) && /הנביאים 3/.test(rendered[4].text));
    check('owner: the BenTML screen mounts the AI catalog writer', /TapuzInjectCard\.mount\(el, 'store-catalog'/.test(rendered[7].text));
    const slip = await req('GET', '/admin/store/orders/1001?print=1', { cookie: OWNER, headers: { Accept: 'text/html' } });
    check('owner: the printable slip says it is not a tax invoice', slip.status === 200 && /אינו חשבונית מס/.test(slip.text));
    const csv = await req('GET', '/admin/store/orders.csv', { cookie: OWNER, headers: { Accept: 'text/csv' } });
    check('owner: the CSV downloads with the order', csv.status === 200 && /text\/csv/.test(csv.headers['content-type']) && /1001/.test(csv.text));
    const cancel = await req('POST', '/admin/api/store/orders/1001/status', { cookie: OWNER, body: { status: 'cancelled' } });
    check('owner: cancelling returns the stock (lavender 1 → 3)', cancel.status === 200 && store.catalog.getProduct('lavender').stock === 3);

    // ── the BenTML door over HTTP ─────────────────────────────────────
    const exp = await req('GET', '/admin/api/store/export.bent', { cookie: OWNER, headers: { Accept: 'text/plain' } });
    check('BenTML: the store exports as <bent-store>', exp.status === 200 && /^<bent-store version="1"/.test(exp.text) && /id="lavender"/.test(exp.text));
    const edited = exp.text.replace('price="89.90"', 'price="79"');
    const pv = await req('POST', '/admin/api/store/preview', { cookie: OWNER, body: { text: edited } });
    check('BenTML: the preview names the price change and writes nothing',
      pv.status === 200 && pv.json.preview.changed.some((c) => c.id === 'lavender') && store.catalog.getProduct('lavender').price === 8990);
    const ap = await req('POST', '/admin/api/store/apply', { cookie: OWNER, body: { text: edited } });
    check('BenTML: apply lands (backup first)', ap.status === 200 && ap.json.ok && ap.json.backupId > 0 && store.catalog.getProduct('lavender').price === 7900);
    const empty = await req('POST', '/admin/api/store/apply', { cookie: OWNER, body: { text: '<bent-store version="1"></bent-store>' } });
    check('BenTML: an empty catalog is NOT applied without confirmation (400 NEEDS_CONFIRM)', empty.status === 400 && empty.json.code === 'NEEDS_CONFIRM' && store.catalog.countProducts().active === 2);
    const undo = await req('POST', '/admin/api/store/undo', { cookie: OWNER });
    check('BenTML: undo puts the price back', undo.status === 200 && store.catalog.getProduct('lavender').price === 8990);

    // ── the rate limit on the order door ──────────────────────────────
    let limited = null;
    for (let i = 0; i < 8 && !limited; i++) {
      const r = await req('POST', '/api/store/checkout', { body: { items: [] } });
      if (r.status === 429) limited = r;
    }
    check('the order door rate-limits per visitor (429 + Retry-After)', !!limited && !!limited.headers['retry-after']);

    // ── the script's own discipline ──────────────────────────────────
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'tz-store.js'), 'utf8');
    let parses = true;
    try { new Function(js); } catch (e) { parses = false; }
    check('tz-store.js parses, never evals, never writes innerHTML, keeps no price in the cart',
      parses && !/\beval\(|new Function/.test(js) && !/innerHTML/.test(js) && /textContent/.test(js) &&
      /\{ sku: l\.sku, variant: l\.variant \|\| '', qty: l\.qty \}/.test(js));
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    child.kill();
  }
  console.log('\nSMOKE STORE-ROUTE: ' + (failed ? 'FAIL (' + failed + ')' : 'PASS'));
  process.exit(failed ? 1 : 0);
})();
