'use strict';

/**
 * v2.69 QA — the storefront a shopper sees, on a throwaway site.
 *
 * What it holds the storefront to:
 *   the card     every product card is the SAME rows in the same order,
 *                whatever the product has to say (the owner: "align the
 *                product so they all at same level"); the price a sort
 *                reads is minor units; "sold out" is said once
 *   the sheet    the rule that used to beat the button's margin is gone;
 *                subgrid, the clamps and the one media background are in;
 *                the checkout's field rules no longer leak into every form
 *   the params   every new param crosses all seven registration sites —
 *                both dialects, and the JSON bridge both ways
 *   categories   tiles, chips and a page per category that follows the
 *                catalog: created when the store opens, renamed with the
 *                category, taken down when it is hidden or emptied, never
 *                written over an owner's page
 *   products     a renamed product renames its page, its trail and its
 *                search line; a page the owner redesigned is left alone;
 *                a page 2.68 wrote is recognised by its shape
 *   the head     og:type=product with a price; never og:image=""
 *   the script   public/tz-store.js RUN in a small DOM: chips, sort,
 *                search, "show more", deep links, the stock cap, the cart
 *                (focus comes back), the checkout with nothing to pay with,
 *                the demo payment with a faked reply
 *   the review   (round r4, each check fails on the tree before it) the
 *                order is the cart on screen; a strip of chosen products
 *                never publishes a draft; the generated pages follow the
 *                store's name, the shop's address and the home page — asked
 *                of the admin's own route handlers; a bulk action follows the
 *                category pages; an owner's page at a product's address is
 *                never taken for the product's; a rewrite keeps a page's tags
 *
 * Run: node scripts/smoke-storefront.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tapuz-storefront-'));
process.env.TAPUZ_ROOT = ROOT;

let failed = 0;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) failed++;
}
/** One group of checks: a throw inside it is a failure of the group, not the end of the run. */
async function section(name, fn) {
  try { await fn(); } catch (e) { check(name + ' — threw: ' + (e && e.message), false); }
}

require('../src/db');
const { runSetup } = require('../src/setup');
runSetup({
  title: 'הסטודיו של נועה', description: 'נרות וסבונים',
  colors: { primary: '#7c2d12', bg: '#ffffff', lightBg: '#fef3c7', text: '#1c1917' },
  menuPlacement: 'top', pages: ['home', 'about'], menuPages: ['home', 'about'], external: []
});
const configMod = require('../src/config');
configMod.saveConfig({ ...configMod.loadConfig(), baseUrl: 'https://shop.example' });

const store = require('../src/store');
const { catalog, settings, pricing } = store;
const storePages = store.pages;
const pages = require('../src/pages');
const pzn = require('../src/pzn/index');
const bentml = require('../src/bentml');
const render = require('../src/store/render');
const { getBlockDef } = require('../src/block-registry');
const { KEYWORDS } = require('../src/bentml/keywords');
const registry = require('../src/pzn/modules/registry');

const REPO = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const read = (f) => { try { return fs.readFileSync(path.join(PUBLIC, f), 'utf8'); } catch (e) { return ''; } };
const STORE_JS = fs.readFileSync(path.join(REPO, 'public', 'tz-store.js'), 'utf8');
const NO_PAYMENT = 'אין כרגע אמצעי תשלום זמין — אי אפשר להשלים הזמנה.';

// ── a small DOM: just enough of a browser to RUN public/tz-store.js ────
// (no dependency: the storefront script only builds with createElement and
// textContent, and asks for elements with a handful of plain selectors)

const VOID = new Set(['img', 'input', 'br', 'meta', 'link', 'hr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, k) => ENTITIES[k]);

function parseSelector(sel) {
  return String(sel).split(',').map((alt) => alt.trim().split(/\s+/).map((part) => {
    const m = /^([a-zA-Z][\w-]*)?(.*)$/.exec(part);
    const c = { tag: m[1] ? m[1].toUpperCase() : '', classes: [], attrs: [], checked: false };
    const re = /\.([\w-]+)|\[([\w-]+)(?:(\*?=)"([^"]*)")?\]|:(checked)/g;
    let x;
    while ((x = re.exec(m[2]))) {
      if (x[1]) c.classes.push(x[1]);
      else if (x[2]) c.attrs.push({ name: x[2], op: x[3] || '', value: x[4] || '' });
      else if (x[5]) c.checked = true;
    }
    return c;
  }));
}
function matchesCompound(el, c) {
  if (!el || el.tagName === '#text') return false;
  if (c.tag && el.tagName !== c.tag) return false;
  for (const cls of c.classes) if (!el.classList.contains(cls)) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '*=' && v.indexOf(a.value) === -1) return false;
  }
  return !c.checked || el.checked === true;
}
function matchesChain(el, chain) {
  if (!matchesCompound(el, chain[chain.length - 1])) return false;
  let up = el.parentNode;
  for (let i = chain.length - 2; i >= 0; i--) {
    while (up && !matchesCompound(up, chain[i])) up = up.parentNode;
    if (!up) return false;
    up = up.parentNode;
  }
  return true;
}

class El {
  constructor(tag, doc) {
    this.tagName = tag === '#text' ? tag : String(tag).toUpperCase();
    this.doc = doc;
    this.attrs = new Map();
    this.kids = [];
    this.parentNode = null;
    this.data = '';
    this.on = {};
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  hasAttribute(n) { return this.attrs.has(n); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    const api = {
      contains: (c) => list().includes(c),
      add: (c) => { if (!api.contains(c)) el.className = list().concat(c).join(' '); },
      remove: (c) => { el.className = list().filter((x) => x !== c).join(' '); },
      toggle: (c, force) => {
        const want = force === undefined ? !api.contains(c) : !!force;
        if (want) api.add(c); else api.remove(c);
        return want;
      }
    };
    return api;
  }
  get children() { return this.kids.filter((k) => k.tagName !== '#text'); }
  get firstChild() { return this.kids[0] || null; }
  get textContent() { return this.tagName === '#text' ? this.data : this.kids.map((k) => k.textContent).join(''); }
  set textContent(v) {
    for (const k of this.kids) k.parentNode = null;
    this.kids = [];
    if (v !== '' && v != null) {
      const t = new El('#text', this.doc);
      t.data = String(v);
      t.parentNode = this;
      this.kids.push(t);
    }
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.kids = node.parentNode.kids.filter((k) => k !== node);
    node.parentNode = this;
    this.kids.push(node);
    return node;
  }
  insertBefore(node, ref) {
    if (node.parentNode) node.parentNode.kids = node.parentNode.kids.filter((k) => k !== node);
    node.parentNode = this;
    const at = this.kids.indexOf(ref);
    if (at === -1) this.kids.push(node); else this.kids.splice(at, 0, node);
    return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.kids = this.parentNode.kids.filter((k) => k !== this);
    this.parentNode = null;
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  walk(out) {
    for (const k of this.kids) {
      if (k.tagName === '#text') continue;
      out.push(k);
      k.walk(out);
    }
    return out;
  }
  querySelectorAll(sel) {
    const alts = parseSelector(sel);
    return this.walk([]).filter((el) => alts.some((chain) => matchesChain(el, chain)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  matches(sel) { return parseSelector(sel).some((chain) => matchesChain(this, chain)); }
  closest(sel) {
    for (let n = this; n; n = n.parentNode) if (n.tagName !== '#text' && n.matches(sel)) return n;
    return null;
  }
  addEventListener(type, fn) { (this.on[type] = this.on[type] || []).push(fn); }
  focus() { this.doc.activeElement = this; }
  click() { return this.doc.fire('click', this); }
  get options() { return this.querySelectorAll('option'); }
  get selectedIndex() { return this.sel === undefined ? 0 : this.sel; }
  set selectedIndex(i) { this.sel = i; }
  get value() {
    if (this.tagName === 'SELECT') {
      const o = this.options[this.selectedIndex];
      return o ? (o.getAttribute('value') || '') : '';
    }
    return this.val !== undefined ? this.val : (this.getAttribute('value') || '');
  }
  set value(v) {
    if (this.tagName === 'SELECT') {
      const at = this.options.findIndex((o) => (o.getAttribute('value') || '') === String(v));
      this.sel = at === -1 ? 0 : at;
    } else {
      this.val = String(v);
    }
  }
  get checked() { return this.chk !== undefined ? this.chk : this.attrs.has('checked'); }
  set checked(v) { this.chk = !!v; }
}
for (const name of ['id', 'type', 'name', 'min', 'max', 'src', 'alt', 'loading', 'href']) {
  Object.defineProperty(El.prototype, name, {
    get() { return this.getAttribute(name) || ''; },
    set(v) { this.setAttribute(name, v); }
  });
}
for (const name of ['hidden', 'disabled', 'required']) {
  Object.defineProperty(El.prototype, name, {
    get() { return this.attrs.has(name); },
    set(v) { if (v) this.attrs.set(name, ''); else this.attrs.delete(name); }
  });
}

function parseHtml(html, parent, doc) {
  const re = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s"<>\/=]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  const setAttrs = (el, text) => {
    const ar = /([^\s"<>\/=]+)(?:="([^"]*)")?/g;
    let a;
    while ((a = ar.exec(text || ''))) el.setAttribute(a[1], decode(a[2] || ''));
  };
  let cur = parent;
  let m;
  while ((m = re.exec(html))) {
    if (m[2] !== undefined) {
      const s = new El('script', doc);
      setAttrs(s, m[1]);
      s.textContent = m[2];
      cur.appendChild(s);
    } else if (m[3]) {
      const tag = m[3].toUpperCase();
      let up = cur;
      while (up && up !== parent && up.tagName !== tag) up = up.parentNode;
      if (up && up !== parent) cur = up.parentNode;
    } else if (m[4]) {
      const el = new El(m[4], doc);
      setAttrs(el, m[5]);
      cur.appendChild(el);
      if (!VOID.has(m[4].toLowerCase()) && !m[6]) cur = el;
    } else if (m[7] && m[7].trim()) {
      const t = new El('#text', doc);
      t.data = decode(m[7]);
      cur.appendChild(t);
    }
  }
  return parent;
}

/**
 * Load a page into the small DOM and run the storefront script on it.
 * @param {string} html     the page's body
 * @param {object} [o]      { search, fetch, mem } — the address' query, the server, the browser's storage
 */
function browser(html, o = {}) {
  const doc = {
    readyState: 'complete', activeElement: null, on: {},
    currentScript: { dataset: { cart: '/cart.html', checkout: '/checkout.html', order: '/order.html', shop: '/shop.html' } },
    createElement(tag) { return new El(tag, doc); },
    addEventListener(type, fn) { (doc.on[type] = doc.on[type] || []).push(fn); },
    querySelectorAll(sel) { return doc.body.querySelectorAll(sel); },
    querySelector(sel) { return doc.body.querySelector(sel); },
    fire(type, target, extra) {
      const ev = { type, target, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, ...(extra || {}) };
      for (let n = target; n; n = n.parentNode) for (const fn of (n.on[type] || [])) fn.call(n, ev);
      for (const fn of (doc.on[type] || [])) fn(ev);
      return ev;
    }
  };
  doc.body = new El('body', doc);
  doc.head = new El('head', doc);
  parseHtml(html, doc.body, doc);
  const mem = o.mem || {};
  const win = {
    replaced: [],
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } },
    location: { search: o.search || '', pathname: '/shop.html', hash: '', href: '' },
    addEventListener() {},
    getComputedStyle: () => ({ direction: 'rtl' })
  };
  win.history = {
    replaceState(a, b, url) {
      win.replaced.push(String(url));
      win.location.search = String(url).indexOf('?') === -1 ? '' : String(url).slice(String(url).indexOf('?'));
    }
  };
  const calls = [];
  const fetchFake = (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    const reply = o.fetch ? o.fetch(String(url), body) : { ok: false };
    return Promise.resolve({ status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(reply))) });
  };
  vm.runInNewContext(STORE_JS, { window: win, document: doc, fetch: fetchFake, URLSearchParams, setTimeout, clearTimeout, console }, { filename: 'tz-store.js' });
  return { doc, win, mem, calls };
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 20));
const cartOf = (mem) => { try { return JSON.parse(mem.tz_cart_v1 || '{}').items || []; } catch (e) { return []; } };

/**
 * Run a route's OWN handler — the last one on its stack; the admin gate in
 * front of it is another smoke's subject — and answer what it sent. No
 * server is booted: this smoke has no port.
 * @param {string} file  a module under src/routes
 * @param {object} [req] { body, params, query }
 */
function callRoute(file, method, routePath, req) {
  const router = require('../src/routes/' + file);
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error('no such route: ' + method + ' ' + routePath);
  const res = {
    code: 200, body: null, headers: {},
    status(c) { res.code = c; return res; },
    setHeader(k, v) { res.headers[String(k).toLowerCase()] = v; return res; },
    type() { return res; },
    json(b) { res.body = b; return res; },
    send(b) { res.body = b; return res; },
    redirect(to) { res.code = 302; res.body = to; return res; }
  };
  layer.route.stack[layer.route.stack.length - 1].handle({ body: {}, params: {}, query: {}, headers: {}, ...(req || {}) }, res);
  return res;
}

// ── the catalog this run sells ─────────────────────────────────────────

settings.saveSettings({
  lowStock: 3,
  shipping: [{ id: 'pickup', label: 'איסוף עצמי', price: '0', address: false }],
  payments: [{ id: 'bank', kind: 'bank', label: 'העברה בנקאית', details: 'בנק 12, חשבון 345' }]
});
catalog.saveShelf({ slug: 'home', label: 'לבית' });
catalog.saveShelf({ slug: 'candles', label: 'נרות', parent: 'home', summary: 'נרות סויה בעבודת יד' });
catalog.saveShelf({ slug: 'soap', label: 'סבונים' });
catalog.saveShelf({ slug: 'backroom', label: 'סודי', hidden: true });
catalog.saveShelf({ slug: 'bare', label: 'מדף ריק' });
catalog.createProduct({
  title: 'נר לבנדר', price: '89.90', compareAt: '120', slug: 'candle', shelf: 'candles', summary: 'נר סויה בניחוח לבנדר',
  brand: 'נועה', tags: 'מתנה,בית', stock: 1, badge: 'חדש', barcode: '7290000000017', images: ['/demo/tile-1.svg', '/demo/tile-2.svg']
});
catalog.createProduct({ title: 'נר וניל', price: '59', slug: 'vanilla', shelf: 'candles', stock: 0 });
catalog.createProduct({ title: 'סבון זית', price: '27.50', slug: 'soap1', shelf: 'soap', featured: true, stock: 3, summary: 'סבון עדין' });
catalog.createProduct({ title: 'חולצה', price: '100', slug: 'shirt', shelf: 'soap', variants: [{ label: 'S', stock: 1 }, { label: 'M', price: '120' }] });
catalog.createProduct({ title: 'מוצר בלי שום דבר מיוחד ועם שם ארוך מאוד שנשבר לשלוש שורות לפחות בכרטיס צר', price: '10', slug: 'plain' });
catalog.createProduct({ title: 'דבר סודי', price: '5', slug: 'hid', shelf: 'backroom' });

/** The classes of a card's rows, in order: [[card children], [body children]]. */
function cardRows(card) {
  const first = (el) => el.className.split(/\s+/)[0];
  const body = card.children.find((k) => first(k) === 'bent-shop-body');
  return [card.children.map(first).join(' '), body ? body.children.map(first).join(' ') : ''];
}
/**
 * The owner opens a page's source and adds a block of their own. (A source is
 * either the bare modules or, once the page was republished, a whole
 * document — the block goes inside the body either way.)
 */
function ownerAdds(source, block) {
  const src = String(source || '');
  return src.indexOf('</body>') === -1 ? src + '\n' + block : src.replace('</body>', block + '\n</body>');
}
function gridOf(html) {
  const doc = { activeElement: null };
  const root = parseHtml(html, new El('body', doc), doc);
  return root.querySelectorAll('.bent-shop-card');
}

(async () => {
  // ── the card: one geometry ───────────────────────────────────────────
  await section('the card', () => {
    const html = render.renderShop({}, { settings: { ...settings.loadSettings(), open: true } });
    const cards = gridOf(html);
    check('card: six products, six cards', cards.length === 6);
    const rows = cards.map(cardRows);
    check('card: every card has the same three children (media, badges, body)',
      rows.every((r) => r[0] === 'bent-shop-media bent-shop-badges bent-shop-body'));
    check('card: every body has the same six rows in the same order — with or without a brand, a summary, a stock line, options, stock',
      rows.every((r) => r[1] === 'bent-shop-brand bent-shop-name bent-shop-summary bent-shop-price bent-shop-note bent-shop-add'));
    const by = (sku) => cards.find((c) => { const b = c.querySelector('[data-sku]'); return b && b.getAttribute('data-sku') === sku; });
    const candle = by('candle');
    const sold = cards.find((c) => c.classList.contains('is-out'));
    const shirt = cards.find((c) => c.getAttribute('data-title') === 'חולצה');
    check('card: data-price is MINOR units (8990, not "₪89.90"); a product with options carries its lowest',
      candle && candle.getAttribute('data-price') === '8990' && shirt && shirt.getAttribute('data-price') === '10000');
    check('card: data-shelves is the own shelf + its parent; data-tags and data-brand ride along',
      candle.getAttribute('data-shelves') === 'candles home' && candle.getAttribute('data-shelf') === 'candles' &&
      // (review r4 #11, changed on purpose: the tags were joined with "|", which a tag may hold — a comma it never can)
      candle.getAttribute('data-tags') === 'מתנה,בית' && candle.getAttribute('data-brand') === 'נועה');
    check('card: data-rank is the page order, data-title the plain name', cards.map((c) => c.getAttribute('data-rank')).join() === '0,1,2,3,4,5' && candle.getAttribute('data-title') === 'נר לבנדר');
    check('card: the last unit is said in the singular; the add button knows the cap',
      candle.querySelector('.bent-shop-note').textContent === 'נותרה יחידה אחרונה' && candle.querySelector('[data-tz-add]').getAttribute('data-max') === '1');
    check('card: "אזל מהמלאי" is said ONCE on a sold-out card (the disabled button), the note row stays empty',
      !!sold && (sold.textContent.match(/אזל מהמלאי/g) || []).length === 1 && sold.querySelector('button.bent-shop-add').disabled === true &&
      sold.querySelector('.bent-shop-note').textContent === '');
    check('card: the owner\'s badge and the cut ("-25%") are stacked in one box, the cut reads left to right',
      candle.querySelector('.bent-shop-badges').children.length === 2 && candle.querySelector('.is-sale').textContent === '-25%' &&
      candle.querySelector('.is-sale').getAttribute('dir') === 'ltr');
    check('card: the picture link is not a tab stop — the title link is the one',
      /<a class="bent-shop-media" href="[^"]*" tabindex="-1" aria-hidden="true">/.test(html) || /<span class="bent-shop-media">/.test(html));
    check('card: a long name keeps its full text in the title attribute', /title="מוצר בלי שום דבר מיוחד[^"]*צר"/.test(html));
    const noBrand = render.renderShop({ shelf: 'soap' });
    check('card: a grid where nobody has a brand does not reserve the brand row (and says so on the section)',
      /bent-shop-nobrand/.test(noBrand) && !/bent-shop-nobrand/.test(html) && /bent-shop-nosummary/.test(render.renderShop({ skus: 'plain,vanilla' })));
    check('card: without buttons a sold-out product says so in the note row', /<p class="bent-shop-note is-out">אזל מהמלאי<\/p>/.test(render.renderShop({ buttons: false })));
  });

  // ── the sheet ────────────────────────────────────────────────────────
  await section('the sheet', () => {
    const css = fs.readFileSync(path.join(REPO, 'themes', 'default', 'css', 'main.css'), 'utf8');
    const a = css.indexOf('/* ===== The store (v2.53)');
    const b = css.indexOf("/* ===== The header's shape (v2.63)");
    const block = css.slice(a, b);
    check('css: the store block is where it was (between its two markers)', a > 0 && b > a);
    check('css: the rule that beat the button\'s margin on every card is gone', !/\+\s*\.bent-shop-add/.test(css));
    check('css: the subgrid enhancement is in, with the flex fallback under it',
      /@supports \(grid-template-rows: subgrid\)/.test(block) && /grid-template-rows: subgrid; grid-row: span 7/.test(block) && /\.bent-shop-body \.bent-shop-price \{\s*margin: auto 0 0/.test(block));
    check('css: names and summaries are clamped to two lines, reserved in em with a line-height of their own',
      (block.match(/-webkit-line-clamp: 2/g) || []).length >= 2 && /\.bent-shop-name \{[^}]*line-height: 1\.35; min-height: calc\(2 \* 1\.35em\)/.test(block));
    check('css: one background for every picture box of the store', (block.match(/background: var\(--media-bg\)/g) || []).length >= 5 && !/--tz-media-bg/.test(block));
    check('css: the picture is not rounded inside its box', /\.bent-shop-img \{[^}]*border-radius: 0/.test(block));
    check('css: a hidden card stays hidden under flex and subgrid', /\.bent-shop-card\[hidden\][^{]*\{ display: none !important; \}/.test(block));
    check('css: buttons and chips say their own line-height', /\.bent-btn, \.bent-shop-add, \.bent-buy-add, \.bent-checkout-submit \{[^}]*line-height: 1\.25/.test(block) && /\.bent-shop-chip \{[^}]*line-height: 1\.25/.test(block));
    check('css: the checkout\'s field rules are scoped (no bare .bent-field / .bent-hp rule in the store block)',
      !/(^|\n|, )\.bent-field\b/.test(block) && !/(^|\n|, )\.bent-hp\b/.test(block) && /\.bent-checkout \.bent-field \{/.test(block));
    check('css: the checkout cannot be wider than a phone (minmax(0, 1fr), fieldsets may shrink)',
      /\.bent-checkout-form \{ grid-template-columns: minmax\(0, 1fr\); \}/.test(block) && /\.bent-checkout-box \{[^}]*min-inline-size: 0/.test(block));
    check('css: phones keep two columns; one column only under 340px', /@media \(max-width: 339px\)/.test(block) && !/@media \(max-width: 560px\) \{\s*\.bent-shop-grid \{ grid-template-columns: 1fr/.test(block));
    check('css: reduced motion stops the hover zoom and the "added" pulse', /prefers-reduced-motion: reduce[\s\S]*\.bent-shop-card:hover \.bent-shop-img[^{]*\{ transform: none; \}/.test(block));
    check('css: cart lines share their columns (the list is the grid)', /\.bent-cart-line, \.bent-cart-lines\.is-compact \.bent-cart-line \{ grid-template-columns: subgrid; \}/.test(block));
    check('css: on a phone the stepper and the sum each span two columns — a long sum no longer takes the name\'s room or runs into the stepper',
      /\.bent-cart-lines:not\(\.is-compact\) \.bent-cart-line > \.bent-qty \{ grid-area: 2 \/ 1 \/ auto \/ span 2; justify-self: start; \}/.test(block) &&
      /\.bent-cart-lines:not\(\.is-compact\) \.bent-cart-line > \.bent-cart-total \{ grid-area: 2 \/ 2 \/ auto \/ span 2; justify-self: end; \}/.test(block) &&
      !/grid-template-areas/.test(block));
    check('css: the toast (in the page from boot, often empty) is moved off by its own height and more — no sliver at the bottom of the page',
      /\.bent-toast \{[^}]*transform: translate\(-50%, calc\(100% \+ 3rem\)\)/.test(block) && !/translate\(-50%, 150%\)/.test(block));
    // review r4 #5 — the title link is the card's one tab stop, and its ring was clipped away by the name's own two-line clamp
    check('css: the title link\'s focus ring is drawn on the CARD (via :has); the link\'s own ring is taken off ONLY where :has() is supported; the name is underlined either way',
      /\.bent-shop-link:focus-visible \{ text-decoration: underline;[^}]*\}\s*@supports selector\(:has\(a\)\) \{\s*\.bent-shop-link:focus-visible \{ outline: none; \}\s*\.bent-shop-card:has\(\.bent-shop-link:focus-visible\) \{ outline: 3px solid [^}]*outline-offset: 2px; \}\s*\}/.test(block) &&
      (block.match(/\.bent-shop-link:focus-visible \{ outline: none; \}/g) || []).length === 1 &&
      block.indexOf('.bent-shop-link:focus-visible, .bent-shelf-tile:focus-visible') > 0 &&
      block.indexOf('.bent-shop-link:focus-visible, .bent-shelf-tile:focus-visible') < block.indexOf('@supports selector(:has(a))'));
    // review r4 #10 — the toast keeps its last message while parked, and its link stayed in the tab order, unseen
    check('css: a parked toast\'s link is not a tab stop — the LINK is hidden, never the toast (the live region stays in the accessibility tree)',
      /\.bent-toast:not\(\.is-on\) \.bent-toast-link \{ visibility: hidden;/.test(block) &&
      !/\.bent-toast(\.is-on)? \{[^}]*visibility/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')));
    check('css: no physical left/right inset or margin in the cards, tiles, toolbar or cart rules',
      !/\.bent-(shop|shelf|shelves|cart|buy)[^{]*\{[^}]*(margin-left|margin-right|padding-left|padding-right|[^-]left:|[^-]right:)/.test(block));
  });

  // ── every param, through all seven sites ─────────────────────────────
  /**
   * A param with a non-default value must come back through: block-registry,
   * keywords, the keyword dialect (decompile → compile), the module registry,
   * the tag dialect and the JSON bridge BOTH ways (block → module → text →
   * module → block), and the reader in render.js.
   */
  function survives(type, name, value, probe) {
    const label = `param ${type}.${name}`;
    const def = getBlockDef(type);
    const param = def && (def.params || []).find((p) => p.name === name);
    if (!param) return check(label + ': declared in block-registry', false);
    const attr = param.bentmlParam;
    const kw = KEYWORDS[def.keyword] && KEYWORDS[def.keyword].params[attr];
    const mod = registry.getModule(type);
    const block = { type, id: 'k1', data: { [name]: value } };
    let viaKeyword;
    let viaTag;
    let text = '';
    let clean = false;
    try {
      viaKeyword = bentml.compile(bentml.decompile({ title: 'x' }, [block])).blocks[0].data[name];
    } catch (e) { viaKeyword = e; }
    try {
      text = pzn.serialize(pzn.fromTapuzPage({ title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [block] }));
      const doc = pzn.parse(text);
      clean = pzn.validate(doc, { strict: false }).filter((i) => i.severity === 'error').length === 0;
      viaTag = pzn.toTapuzPage(doc).blocks[0].data[name];
    } catch (e) { viaTag = e; }
    const html = render[type === 'shop' ? 'renderShop' : 'renderShelves']({ [name]: value }, { settings: { ...settings.loadSettings(), open: true } });
    check(`${label}: keywords + module registry declare "${attr}"; keyword dialect, tag dialect and the bridge both ways bring ${JSON.stringify(value)} back; render.js reads it`,
      !!kw && kw.type === param.type && !!mod && !!mod.props[attr] &&
      String(viaKeyword) === String(value) && typeof viaKeyword === typeof value &&
      text.indexOf(` ${attr}="`) !== -1 && clean && String(viaTag) === String(value) &&
      !!probe(html));
  }
  await section('params', () => {
    survives('shop', 'empty', 'אין כאן כלום', (h) => /bent-shop-card/.test(h));
    check('param shop.empty: read by render.js on an empty grid', /<p class="bent-shop-empty">אין כאן כלום<\/p>/.test(render.renderShop({ shelf: 'bare', empty: 'אין כאן כלום' })));
    survives('shop', 'media', 'portrait', (h) => /class="bent-shop bent-shop-cols-3 bent-shop-media-portrait/.test(h));
    survives('shop', 'fit', 'contain', (h) => /bent-shop-fit-contain/.test(h));
    survives('shop', 'justify', 'center', (h) => /bent-shop-center/.test(h));
    survives('shop', 'sorter', true, (h) => /<select class="bent-shop-select" data-tz-sort>/.test(h) && /<option value="price-asc">מחיר: מהנמוך לגבוה<\/option>/.test(h));
    survives('shop', 'search', true, (h) => /<input type="search" class="bent-shop-input" data-tz-search/.test(h));
    survives('shop', 'pageSize', 4, (h) => /data-page-size="4"/.test(h) && /מציג 4 מתוך 6/.test(h) && /הצגת עוד \(2\)/.test(h) && (h.match(/<article[^>]* hidden>/g) || []).length === 2);
    survives('shop', 'tag', 'מתנה', (h) => gridOf(h).length === 1 && /נר לבנדר/.test(h));
    survives('shop', 'brand', 'נועה', (h) => gridOf(h).length === 1 && /נר לבנדר/.test(h));
    survives('shop', 'featured', true, (h) => gridOf(h).length === 1 && /סבון זית/.test(h) && /is-featured/.test(h));
    survives('shop', 'skus', 'soap1,candle', (h) => gridOf(h).map((c) => c.getAttribute('data-title')).join('|') === 'סבון זית|נר לבנדר');
    survives('shelves', 'parent', 'home', (h) => /נרות/.test(h) && !/סבונים/.test(h));
    survives('shelves', 'columns', 4, (h) => /bent-shelves-cols-4/.test(h));
    survives('shelves', 'title', 'הקטגוריות שלנו', (h) => /<h2 class="bent-shelves-title">הקטגוריות שלנו<\/h2>/.test(h));
    survives('shelves', 'counts', false, (h) => !/bent-shelf-count/.test(h));
    survives('shelves', 'summaries', true, (h) => /bent-shelf-summary/.test(h));
    survives('shelves', 'justify', 'center', (h) => /bent-shelves-center/.test(h));
    check('params: the shelves module is a block type, a keyword, a tag and a renderer case',
      require('../src/blocks').BLOCK_TYPES.includes('shelves') && !!KEYWORDS.SHELVES && registry.getModule('shelves').tag === 'bent-shelves' &&
      /class="bent-shelves /.test(require('../src/renderer').renderBlock({ type: 'shelves', id: 's', data: {} }, 'rtl')));
    // Changed on purpose in the review round: this check used to pin that
    // `skus` draws a product whatever its status. On a public page that
    // published a draft's name, summary and price as a "sold out" card, so a
    // strip now shows ACTIVE products only ('hid' sits on a hidden category
    // but is itself active — the catalog pick shows it too).
    check('params: skus shows ACTIVE products only — a draft and a hidden product are skipped like one that does not exist',
      (() => {
        catalog.createProduct({ title: 'טיוטה', price: '7', slug: 'draft1', status: 'draft', summary: 'עוד לא הוכרז' });
        catalog.createProduct({ title: 'מוסתר', price: '8', slug: 'hidden1', status: 'hidden' });
        const h = render.renderShop({ skus: 'draft1,nope,hidden1,candle', buttons: false });
        return gridOf(h).map((c) => c.getAttribute('data-title')).join('|') === 'נר לבנדר' && !/טיוטה|עוד לא הוכרז|מוסתר/.test(h) &&
          render.renderShop({ title: 'נבחרים', skus: 'draft1,hidden1' }) === '';
      })());
    check('params: a parent shelf shows its sub-categories\' products', gridOf(render.renderShop({ shelf: 'home' })).length === 2);
    check('params: page-size is held to 4–48 and means nothing while the store is closed',
      /data-page-size="4"/.test(render.renderShop({ pageSize: 2 }, { settings: { ...settings.loadSettings(), open: true } })) &&
      !/data-page-size/.test(render.renderShop({ pageSize: 4 }, { settings: { ...settings.loadSettings(), open: false } })));
  });

  // ── the flip: category pages ─────────────────────────────────────────
  // an owner's own page already lives at /shelf-soap — it must never be taken over
  pages.createPage({ title: 'הדף של סבתא', slug: 'shelf-soap', status: 'published', blocks: [] });
  let opened = null;
  await section('category pages', () => {
    opened = store.flip(true);
    const action = (slug) => ((opened.shelves || []).find((r) => r.path === 'shelf-' + slug) || {}).action;
    check('shelf page: opening the store creates a page per category a shopper is shown and that holds a product',
      action('home') === 'created' && action('candles') === 'created' && pages.getPageByFullPath('shelf-candles').status === 'published');
    check('shelf page: none for a hidden category, none for an empty one', !pages.getPageByFullPath('shelf-backroom') && !pages.getPageByFullPath('shelf-bare'));
    check('shelf page: never written over an owner\'s page at the same address',
      action('soap') === 'foreign' && pages.getPageByFullPath('shelf-soap').title === 'הדף של סבתא' && !(pages.getPageByFullPath('shelf-soap').meta || {}).store &&
      storePages.shelfUrl('soap') === '');
    const page = pages.getPageByFullPath('shelf-candles');
    check('shelf page: it is the store\'s (meta.store / storeShelf), with the category\'s line as its description and a hash of what was written',
      page.meta.store === 'shelf' && page.meta.storeShelf === 'candles' && page.meta.description === 'נרות סויה בעבודת יד' && /^[0-9a-f]{40}$/.test(page.meta.storeSourceHash || ''));
    const src = pages.getPageSource('shelf-candles', 'published') || '';
    check('shelf page: BenTML — the trail (home › shop › parent › category), the heading, the line of text, the grid with a sorter',
      /<bent-crumbs>/.test(src) && /label="לבית" url="\/shelf-home.html"/.test(src) && /<bent-heading level="1">נרות<\/bent-heading>/.test(src) &&
      /<bent-text>נרות סויה בעבודת יד<\/bent-text>/.test(src) && /<bent-shop shelf="candles" sorter="true" columns="3" justify="center">/.test(src));
    // whole rows (v2.69): a generated grid takes the column count that leaves
    // no orphan card — a category of four used to print 3 + 1
    const rows = (n) => { const w = storePages.wholeRows(n); return w.columns + (w.centre ? 'c' : ''); };
    check('whole rows: 1–2 cards keep a normal size, centred; 3 and 4 are one row; more take 4, else 3, else 4 with the last row centred',
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map(rows).join(' ') === '3c 3c 3 4 4c 3 4c 4 3 4');
    check('shelf page: a parent shows its sub-categories as tiles, in a whole row', /<bent-shelves parent="home" columns="3" justify="center">/.test(pages.getPageSource('shelf-home', 'published') || ''));
    check('shelfUrl: the public address when live, \'\' when not', storePages.shelfUrl('candles') === '/shelf-candles.html' && storePages.shelfUrl('backroom') === '' && storePages.shelfUrl('nope') === '');
    const html = read('shelf-home.html');
    check('export: the parent\'s page carries the tile (a link to the child\'s page, "2 מוצרים") and the child\'s products',
      /<a class="bent-shelf-tile" href="\/shelf-candles.html">/.test(html) && /<span class="bent-shelf-count">2 מוצרים<\/span>/.test(html) &&
      /data-title="נר לבנדר"/.test(html) && /data-title="נר וניל"/.test(html) && !/data-title="סבון זית"/.test(html));
    check('export: a category page is titled by the category', /<title>[^<]*נרות[^<]*<\/title>/.test(read('shelf-candles.html')));

    // chips and tiles
    const grid = render.renderShop({ filter: true });
    check('chips: "הכול" + the top-level categories that hold products, in catalog order — no hidden, no empty, no sub-category',
      (grid.match(/data-tz-shelf="[^"]*"/g) || []).join() === 'data-tz-shelf="",data-tz-shelf="home",data-tz-shelf="soap"');
    check('chips: a chip is a LINK to the category\'s live page and keeps data-tz-shelf; without a page it is a button',
      /<a class="bent-shop-chip" href="\/shelf-home.html" data-tz-shelf="home">לבית<\/a>/.test(grid) &&
      /<button type="button" class="bent-shop-chip" data-tz-shelf="soap" aria-pressed="false">סבונים<\/button>/.test(grid));
    const tiles = render.renderShelves({});
    check('tiles: top-level categories with products — the count is the family\'s; no hidden, no empty',
      /לבית/.test(tiles) && /סבונים/.test(tiles) && !/סודי/.test(tiles) && !/מדף ריק/.test(tiles) && (tiles.match(/bent-shelf-tile/g) || []).length === 2);
    check('tiles: a category without a page of its own leads to the shop, filtered', /href="\/shop.html\?shelf=soap"/.test(tiles));
    check('tiles: the picture is the category\'s, else the first product picture in it, else a neutral tile',
      /<img class="bent-shelf-img" src="\/demo\/tile-1.svg"/.test(tiles) && /bent-shelf-noimg/.test(tiles));
    check('tiles: a title with nothing under it disappears', render.renderShelves({ parent: 'soap', title: 'תת-קטגוריות' }) === '');

    // rename
    catalog.saveShelf({ slug: 'candles', label: 'נרות ריחניים' });
    const after = store.afterShelfChange();
    check('afterShelfChange: one rebuild, reported', after && after.rebuilt === true);
    check('rename: the category page follows — title, heading, export',
      pages.getPageByFullPath('shelf-candles').title === 'נרות ריחניים' && /<bent-heading level="1">נרות ריחניים<\/bent-heading>/.test(pages.getPageSource('shelf-candles', 'published') || '') &&
      /נרות ריחניים/.test(read('shelf-candles.html')));
    check('rename: every product trail that names the category follows', /label="נרות ריחניים" url="\/shelf-candles.html"/.test(pages.getPageSource('shop-candle', 'published') || ''));
    check('a second sync finds nothing to do', storePages.syncShelfPages().every((r) => r.action === 'kept' || r.action === 'foreign' || r.action === 'none'));

    // hidden → down, shown → up
    catalog.saveShelf({ slug: 'candles', label: 'נרות ריחניים', hidden: true });
    store.afterShelfChange();
    check('hide: the category\'s page is taken down (a draft, not deleted) and leaves the export, the chips and the tiles',
      pages.getPageByFullPath('shelf-candles').status === 'draft' && !read('shelf-candles.html') && storePages.shelfUrl('candles') === '' &&
      !/נרות ריחניים/.test(render.renderShelves({ parent: 'home' })));
    check('hide: its parent still sells those products, so the parent\'s page stays — rewritten without the tiles nobody would see',
      pages.getPageByFullPath('shelf-home').status === 'published' && !/<bent-shelves/.test(pages.getPageSource('shelf-home', 'published') || '') &&
      !/bent-shelf-tile/.test(read('shelf-home.html')) && /data-title="נר לבנדר"/.test(read('shelf-home.html')));
    check('hide: a product\'s trail no longer names the hidden category', !/נרות ריחניים/.test(pages.getPageSource('shop-candle', 'published') || ''));
    catalog.saveShelf({ slug: 'candles', label: 'נרות ריחניים', hidden: false });
    store.afterShelfChange();
    check('show again: the page is live again, and the parent has its tiles back',
      pages.getPageByFullPath('shelf-candles').status === 'published' && !!read('shelf-candles.html') && /<bent-shelves parent="home" columns="3" justify="center">/.test(pages.getPageSource('shelf-home', 'published') || ''));

    // emptied → down
    catalog.updateProduct('candle', { shelf: 'soap' });
    catalog.updateProduct('vanilla', { shelf: 'soap' });
    store.afterProductChange(catalog.getProduct('vanilla'));
    check('emptied: a category left without a product loses its page', pages.getPageByFullPath('shelf-candles').status === 'draft' && !read('shelf-candles.html'));
    catalog.updateProduct('candle', { shelf: 'candles' });
    catalog.updateProduct('vanilla', { shelf: 'candles' });
    store.afterProductChange(catalog.getProduct('vanilla'));
    store.afterProductChange(catalog.getProduct('candle'));
    check('filled again: the page is back', pages.getPageByFullPath('shelf-candles').status === 'published');

    // an owner's redesign is kept
    const mine = ownerAdds(pages.getPageSource('shelf-home', 'published'), '<bent-text>כתבתי כאן משהו משלי</bent-text>');
    pages.savePageSource('shelf-home', mine, { publish: true });
    catalog.saveShelf({ slug: 'home', label: 'הכול לבית', summary: 'כל מה שהבית צריך' });
    store.afterShelfChange();
    const kept = pages.getPageByFullPath('shelf-home');
    check('a category page the owner redesigned keeps its source (the old heading too); only the title and the search line follow',
      /כתבתי כאן משהו משלי/.test(pages.getPageSource('shelf-home', 'published') || '') && /<bent-heading level="1">לבית<\/bent-heading>/.test(pages.getPageSource('shelf-home', 'published') || '') &&
      kept.title === 'הכול לבית' && kept.meta.description === 'כל מה שהבית צריך');
  });

  // ── product pages follow the product ─────────────────────────────────
  await section('product pages', () => {
    const src = pages.getPageSource('shop-candle', 'published') || '';
    check('product page: the trail carries the category path; the related strip is ONE row of what the category has (limit = the others, columns to match)',
      /label="הכול לבית" url="\/shelf-home.html"/.test(src) && /label="נרות ריחניים" url="\/shelf-candles.html"/.test(src) &&
      /<bent-shop title="עוד מאותה קטגוריה" shelf="candles" limit="([1-4])" columns="[34]"( justify="center")? exclude="candle"><\/bent-shop>/.test(src));
    check('product page: a product alone (no category) gets "עוד מהחנות", also four columns',
      /<bent-shop title="עוד מהחנות" limit="4" columns="4" exclude="plain" sort="new"><\/bent-shop>/.test(pages.getPageSource('shop-plain', 'published') || ''));
    check('export: the strip is a grid of its own column count', /class="bent-shop bent-shop-cols-[34][^"]*"[^>]*>\s*<h2 class="bent-shop-title">עוד מאותה קטגוריה/.test(read('shop-candle.html')));

    // the hash path: a page this code wrote follows a rename
    catalog.updateProduct('candle', { title: 'נר לבנדר גדול', summary: '' });
    const r = store.afterProductChange(catalog.getProduct('candle'));
    const page = pages.getPageByFullPath('shop-candle');
    const html = read('shop-candle.html');
    check('rename: the page is rewritten (its title, its trail) and the export follows',
      r.page && r.page.action === 'updated' && page.title === 'נר לבנדר גדול' && /label="נר לבנדר גדול"><\/bent-crumb>/.test(pages.getPageSource('shop-candle', 'published') || '') &&
      /<title>[^<]*נר לבנדר גדול[^<]*<\/title>/.test(html) && /<span class="bent-crumb-current">נר לבנדר גדול<\/span>/.test(html));
    check('rename: a summary the owner deleted leaves the search line (no stale description)',
      page.meta.description === undefined && !/נר סויה בניחוח לבנדר/.test(html));
    catalog.updateProduct('candle', { seoTitle: 'נר לבנדר — הכי ריחני', seoDescription: 'שורת חיפוש משלי', summary: 'תקציר חדש' });
    store.afterProductChange(catalog.getProduct('candle'));
    check('the owner\'s SEO words win over the name and the summary',
      pages.getPageByFullPath('shop-candle').meta.seoTitle === 'נר לבנדר — הכי ריחני' && pages.getPageByFullPath('shop-candle').meta.description === 'שורת חיפוש משלי' &&
      /<title>[^<]*נר לבנדר — הכי ריחני/.test(read('shop-candle.html')));
    check('a second sync of an unchanged product does nothing', storePages.syncProductPage(catalog.getProduct('candle')).action === 'kept');

    // a page the owner edited is left alone
    const mine = ownerAdds(pages.getPageSource('shop-soap1', 'published'), '<bent-text>הסבר שכתבתי בעצמי</bent-text>');
    pages.savePageSource('shop-soap1', mine, { publish: true });
    catalog.updateProduct('soap1', { title: 'סבון זית כפרי' });
    const r2 = store.afterProductChange(catalog.getProduct('soap1'));
    const kept = pages.getPageSource('shop-soap1', 'published') || '';
    check('a product page the owner edited keeps its source — the old trail label too; the title still follows',
      r2.page && r2.page.action !== 'updated' && /הסבר שכתבתי בעצמי/.test(kept) && /label="סבון זית"><\/bent-crumb>/.test(kept) &&
      pages.getPageByFullPath('shop-soap1').title === 'סבון זית כפרי');

    // a page 2.68 wrote: no hash — recognised by its exact shape, whatever the product was called that day
    const legacy = (slug, was) => [
      '<bent-crumbs>',
      '  <bent-crumb label="דף הבית" url="/"></bent-crumb>',
      '  <bent-crumb label="הסטודיו של נועה" url="/shop.html"></bent-crumb>',
      `  <bent-crumb label="${was}"></bent-crumb>`,
      '</bent-crumbs>',
      `<bent-buy sku="${slug}"></bent-buy>`,
      `<bent-shop title="עוד מהחנות" limit="4" exclude="${slug}" sort="new"></bent-shop>`
    ].join('\n');
    const make268 = (slug, was, extra) => {
      catalog.createProduct({ title: 'מוצר ' + slug, price: '12', slug, shelf: 'soap' });
      pages.createPage({ title: was, slug: 'shop-' + slug, blocks: [], meta: { store: 'product', storeSku: slug }, status: 'draft' });
      pages.savePageSource('shop-' + slug, legacy(slug, was) + (extra || ''), { publish: true });
    };
    make268('old1', 'שם ישן');
    make268('old2', 'שם ישן', '\n<bent-text>המלצה אישית שלי</bent-text>');
    const l1 = storePages.syncProductPage(catalog.getProduct('old1'));
    const l2 = storePages.syncProductPage(catalog.getProduct('old2'));
    const s1 = pages.getPageSource('shop-old1', 'published') || '';
    const s2 = pages.getPageSource('shop-old2', 'published') || '';
    check('2.68 page, untouched: regenerated (new trail, a whole-row strip) and it now carries a hash',
      l1.action === 'updated' && /limit="3" columns="3"/.test(s1) && /label="מוצר old1"><\/bent-crumb>/.test(s1) && pages.getPageByFullPath('shop-old1').title === 'מוצר old1' &&
      /^[0-9a-f]{40}$/.test(pages.getPageByFullPath('shop-old1').meta.storeSourceHash || ''));
    check('2.68 page the owner added to: left exactly as it was, and no hash is invented for it',
      l2.action !== 'updated' && /המלצה אישית שלי/.test(s2) && !/columns="4"/.test(s2) && /label="שם ישן"/.test(s2) &&
      !pages.getPageByFullPath('shop-old2').meta.storeSourceHash);
    check('2.68 page, second sync: nothing to do', storePages.syncProductPage(catalog.getProduct('old1')).action === 'kept');
    store.refreshNow();
  });

  // ── the product page ─────────────────────────────────────────────────
  await section('the buy box', () => {
    const buy = render.renderBuy({ sku: 'candle' });
    const lds = (buy.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [])
      .map((s) => JSON.parse(s.replace(/^<script[^>]*>|<\/script>$/g, '')));
    const product = lds.find((x) => x['@type'] === 'Product');
    const trail = lds.find((x) => x['@type'] === 'BreadcrumbList');
    check('buy: JSON-LD Product has the brand, the GTIN (a 13-digit barcode), the condition, absolute url and image',
      product && product.brand && product.brand.name === 'נועה' && product.gtin === '7290000000017' &&
      product.offers.itemCondition === 'https://schema.org/NewCondition' && product.url === 'https://shop.example/shop-candle.html' &&
      product.image[0] === 'https://shop.example/demo/tile-1.svg' && product.offers.price === '89.90');
    check('buy: JSON-LD BreadcrumbList — shop › parent › category › product, numbered, absolute',
      trail && trail.itemListElement.length === 4 && trail.itemListElement.map((i) => i.position).join() === '1,2,3,4' &&
      trail.itemListElement[2].name === 'נרות ריחניים' && trail.itemListElement[2].item === 'https://shop.example/shelf-candles.html' &&
      trail.itemListElement[3].name === 'נר לבנדר גדול');
    const plain = JSON.parse((/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(render.renderBuy({ sku: 'plain' })) || [])[1] || '{}');
    check('buy: a product that names no brand is the store\'s own; a barcode that is not a GTIN length is not one', plain.brand && plain.brand.name === 'הסטודיו של נועה' && plain.gtin === undefined);
    const shirt = JSON.parse((/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(render.renderBuy({ sku: 'shirt' })) || [])[1] || '{}');
    check('buy: options at different prices are an AggregateOffer with offerCount', shirt.offers && shirt.offers['@type'] === 'AggregateOffer' && shirt.offers.offerCount === 2 && shirt.offers.lowPrice === '100' && shirt.offers.highPrice === '120');
    check('buy: the brand above the name; the category under it as links to their pages',
      buy.indexOf('<p class="bent-buy-brand">נועה</p>') !== -1 && buy.indexOf('bent-buy-brand') < buy.indexOf('<h1 class="bent-buy-title">') &&
      /<a class="bent-buy-shelf-link" href="\/shelf-home.html">הכול לבית<\/a><span class="bent-buy-shelf-sep" aria-hidden="true">›<\/span><a class="bent-buy-shelf-link" href="\/shelf-candles.html">נרות ריחניים<\/a>/.test(buy));
    check('buy: tags are chips that lead to the shop page, filtered', /<a class="bent-buy-tag" href="\/shop.html\?tag=%D7%9E%D7%AA%D7%A0%D7%94">מתנה<\/a>/.test(buy));
    check('buy: the cut beside the price; the SKU and the barcode, read left to right',
      /<p class="bent-buy-price" data-tz-price-box>.*<span class="bent-shop-badge is-sale" dir="ltr">-25%<\/span><\/p>/.test(buy) &&
      /מק״ט: <bdi dir="ltr">candle<\/bdi>/.test(buy) && /ברקוד: <bdi dir="ltr">7290000000017<\/bdi>/.test(buy));
    check('buy: the same − / + stepper the cart has, and the button knows the cap',
      /<span class="bent-qty" role="group" aria-label="כמות"><button type="button" class="bent-qty-btn" data-tz-step="-1"/.test(buy) &&
      /<input id="b[0-9a-f]{8}-q" class="bent-qty-input" type="number" min="1" max="1"/.test(buy) && /class="bent-buy-add" data-tz-add data-sku="candle" data-title="נר לבנדר גדול" data-max="1"/.test(buy));
    check('buy: the first thumb is the current one', /class="bent-buy-thumb is-on"[^>]*aria-label="תמונה 1 מתוך 2" aria-current="true"/.test(buy));
  });

  // ── the head ─────────────────────────────────────────────────────────
  await section('the head', () => {
    const html = read('shop-candle.html');
    check('head: a product page says og:type=product with its price, currency and availability',
      /<meta property="og:type" content="product">/.test(html) && /<meta property="product:price:amount" content="89.90">/.test(html) &&
      /<meta property="product:price:currency" content="ILS">/.test(html) && /<meta property="product:availability" content="in stock">/.test(html));
    check('head: a sold-out product says so', /<meta property="product:availability" content="out of stock">/.test(read('shop-vanilla.html')));
    check('head: its share picture is absolute', /<meta property="og:image" content="https:\/\/shop.example\/demo\/tile-1.svg">/.test(html));
    const files = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));
    check('head: no page of the site ships og:image="" — a page without a picture says nothing',
      files.length > 8 && files.every((f) => !/property="og:image" content=""/.test(read(f))) && !/property="og:image"/.test(read('shop.html')));
    check('head: an ordinary page stays a website', /<meta property="og:type" content="website">/.test(read('shop.html')) && !/product:price/.test(read('shop.html')));
  });

  // ── cart, checkout, order: the static HTML ───────────────────────────
  await section('checkout html', () => {
    const s = settings.loadSettings();
    const none = render.renderCheckout({}, { settings: { ...s, payments: [] } });
    check('checkout: with nothing to pay with the page says so in words, and the button is off with the reason beside it',
      none.indexOf(`<div class="bent-choices" data-tz-pay-choices><p class="bent-pay-none">${NO_PAYMENT}</p></div>`) !== -1 &&
      /<button type="submit" class="bent-checkout-submit" data-tz-submit aria-describedby="tzc-why" disabled>/.test(none) &&
      none.indexOf(`<p class="bent-checkout-why" id="tzc-why" data-tz-why>${NO_PAYMENT}</p>`) !== -1 && render.NO_PAYMENT_NOTE === NO_PAYMENT);
    const some = render.renderCheckout({});
    check('checkout: with a method the button is on and no sentence is printed', /value="bank"/.test(some) && !/bent-pay-none/.test(some) && !/data-tz-submit[^>]* disabled/.test(some));
    check('checkout: every field names its error line (aria-describedby) from the start',
      /<input id="tzc-name" name="name"[^>]*aria-describedby="tzc-name-err"/.test(some) && /<span class="bent-field-error" id="tzc-name-err" aria-live="polite"><\/span>/.test(some));
    check('cart / checkout / order: the part the script fills is marked busy until it is filled',
      /data-tz-cart-body aria-busy="true"/.test(render.renderCart({})) && /data-tz-summary aria-busy="true"/.test(some) && /data-tz-order-body aria-busy="true"/.test(render.renderOrder({})));
    check('cart: where it leads is the store\'s own knowledge (settings.pages), not a module param',
      /data-checkout="\/checkout.html" data-shop="\/shop.html"/.test(render.renderCart({ checkout: '/elsewhere', shop: '/elsewhere' })));
  });

  // ── the script itself ────────────────────────────────────────────────
  await section('tz-store.js: the file', () => {
    let parses = true;
    try { new vm.Script(STORE_JS, { filename: 'tz-store.js' }); } catch (e) { parses = false; }
    check('tz-store.js parses', parses);
    check('tz-store.js: no innerHTML (not even in a comment), no eval, no Function constructor',
      STORE_JS.indexOf('innerHTML') === -1 && STORE_JS.indexOf('eval(') === -1 && STORE_JS.indexOf('new ' + 'Function') === -1);
    check('tz-store.js: the pinned texts stay',
      STORE_JS.indexOf("{ sku: l.sku, variant: l.variant || '', qty: l.qty }") !== -1 && STORE_JS.indexOf('tz_cart_v1') !== -1 &&
      STORE_JS.indexOf('[data-tz-pay-choices]') !== -1 && STORE_JS.indexOf("el('span', 'bent-choice-label', p.label || p.id || '')") !== -1);
    check('tz-store.js: the control-character guard is still an escape, not raw bytes', STORE_JS.indexOf('[\\u0000-\\u001f\\u007f]') !== -1 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(STORE_JS));
    check('tz-store.js says the same no-payment sentence the page prints', STORE_JS.indexOf(NO_PAYMENT) !== -1);
  });

  const shopHtml = () => render.renderShop({ filter: true, sorter: true, search: true, pageSize: 4 });
  const visible = (b) => b.doc.querySelectorAll('.bent-shop-card').filter((c) => !c.hidden);
  const titles = (list) => list.map((c) => c.getAttribute('data-title')).join('|');

  await section('tz-store.js: the toolbar', async () => {
    const b = browser(shopHtml());
    const total = b.doc.querySelectorAll('.bent-shop-card').length;
    check('toolbar: the page opens on the first batch ("מציג 4 מתוך N")', visible(b).length === 4 && total >= 6 && b.doc.querySelector('[data-tz-shop-count]').textContent === `מציג 4 מתוך ${total}`);

    b.doc.querySelector('[data-tz-more]').click();
    check('show more: the next batch appears, the keyboard goes on from its first card, the count line leaves when all are shown',
      visible(b).length === Math.min(8, total) && b.doc.activeElement && b.doc.activeElement.closest('.bent-shop-card') === visible(b)[4] &&
      (total > 8 || b.doc.querySelector('[data-tz-more-row]').hidden === true));

    const chip = b.doc.querySelector('[data-tz-shelf="home"]');
    const ev = chip.click();
    check('chip: a parent\'s chip shows its sub-categories\' products, in place (the link is not followed)',
      ev.defaultPrevented === true && titles(visible(b)) === 'נר לבנדר גדול|נר וניל' && chip.classList.contains('is-on') && chip.getAttribute('aria-current') === 'true');
    check('chip: the address follows (a shared link shows the same view) and the result is announced',
      b.win.replaced[b.win.replaced.length - 1] === '/shop.html?shelf=home' && b.doc.querySelector('[data-tz-shop-live]').textContent === 'נמצאו 2 מוצרים');

    b.doc.querySelector('[data-tz-shelf=""]').click();
    const sorter = b.doc.querySelector('[data-tz-sort]');
    sorter.value = 'price-asc';
    b.doc.fire('change', sorter);
    const prices = b.doc.querySelector('.bent-shop-grid').children.map((c) => Number(c.getAttribute('data-price')));
    check('sort: by price, on the minor units in data-price, moving the nodes that are there',
      prices.length === total && prices.every((p, i) => i === 0 || prices[i - 1] <= p) && visible(b).length === 4 && /sort=price-asc/.test(b.win.replaced[b.win.replaced.length - 1]));
    sorter.value = 'name';
    b.doc.fire('change', sorter);
    const names = b.doc.querySelector('.bent-shop-grid').children.map((c) => c.getAttribute('data-title'));
    check('sort: by name, the Hebrew way', names.join('|') === names.slice().sort((x, y) => x.localeCompare(y, 'he')).join('|'));
    sorter.value = '';
    b.doc.fire('change', sorter);
    check('sort: "מומלץ" is the page\'s own order again', b.doc.querySelector('.bent-shop-grid').children.map((c) => c.getAttribute('data-rank')).join() === Array.from({ length: total }, (x, i) => i).join());

    const box = b.doc.querySelector('[data-tz-search]');
    box.value = 'נועה';
    b.doc.fire('input', box);
    await settle(260);
    check('search: by brand as you type (after a short pause), announced in the singular', titles(visible(b)) === 'נר לבנדר גדול' && b.doc.querySelector('[data-tz-shop-live]').textContent === 'נמצא מוצר אחד');
    box.value = 'אין דבר כזה';
    b.doc.fire('input', box);
    await settle(260);
    check('search: nothing found says so, with a way out', visible(b).length === 0 && b.doc.querySelector('[data-tz-shop-none]').hidden === false && b.doc.querySelector('[data-tz-more-row]').hidden === true);
    b.doc.querySelector('[data-tz-clear]').click();
    check('clear: everything is back, the box is emptied', visible(b).length === 4 && box.value === '' && b.doc.querySelector('[data-tz-shop-none]').hidden === true);

    const deep = browser(shopHtml(), { search: '?shelf=home&sort=price-desc' });
    check('deep link: ?shelf= and ?sort= are applied on load, and the controls show them',
      titles(visible(deep)) === 'נר לבנדר גדול|נר וניל' && deep.doc.querySelector('[data-tz-sort]').value === 'price-desc' && deep.doc.querySelector('[data-tz-shelf="home"]').classList.contains('is-on'));
    const tagged = browser(shopHtml(), { search: '?tag=' + encodeURIComponent('מתנה') });
    const said = tagged.doc.querySelector('[data-tz-unfilter="tag"]');
    check('deep link: ?tag= filters, and a filter no control shows is said in words with its own way out',
      titles(visible(tagged)) === 'נר לבנדר גדול' && !!said && said.textContent === 'תגית: מתנה ✕' && said.getAttribute('aria-label') === 'הסרת הסינון — תגית: מתנה');
    said.click();
    check('deep link: taking the tag off shows the shop again and cleans the address', visible(tagged).length === 4 && tagged.win.replaced[tagged.win.replaced.length - 1] === '/shop.html');
    const hiddenShelf = browser(shopHtml(), { search: '?shelf=candles' });
    check('deep link: a sub-category has no chip — it is named in words', titles(visible(hiddenShelf)) === 'נר לבנדר גדול|נר וניל' && hiddenShelf.doc.querySelector('[data-tz-unfilter="shelf"]').textContent === 'קטגוריה: נרות ריחניים ✕');
    const searched = browser(shopHtml(), { search: '?q=' + encodeURIComponent('זית') });
    check('deep link: ?q= fills the search box', titles(visible(searched)) === 'סבון זית כפרי' && searched.doc.querySelector('[data-tz-search]').value === 'זית');

    // review r4 #7 — a value from the address was looked up on a plain object, so a prototype key passed for a real one
    for (const key of ['__proto__', 'valueOf', 'constructor']) {
      let hostile = null;
      let threw = '';
      try {
        hostile = browser(shopHtml(), { search: '?sort=' + key });
        hostile.doc.querySelector('[data-tz-shelf="home"]').click();
      } catch (e) { threw = e.message; }
      check(`deep link: ?sort=${key} is not a sort — the page keeps its own order, and the chips still work (nothing throws)`,
        !threw && !!hostile && hostile.doc.querySelector('[data-tz-sort]').value === '' && titles(visible(hostile)) === 'נר לבנדר גדול|נר וניל' &&
        !/sort=/.test(hostile.win.replaced[hostile.win.replaced.length - 1]));
    }
    const named = browser(shopHtml(), { search: '?shelf=constructor' });
    check('deep link: ?shelf=constructor is named as the word it is, not as a function\'s source', named.doc.querySelector('[data-tz-unfilter="shelf"]').textContent === 'קטגוריה: constructor ✕');

    // review r4 #9 — "✕" rebuilt the very button the keyboard stood on, and focus fell back to the top of the page
    const kb = browser(shopHtml(), { search: '?tag=' + encodeURIComponent('מתנה') });
    const cross = kb.doc.querySelector('[data-tz-unfilter="tag"]');
    cross.focus();
    cross.click();
    check('unfilter: the keyboard that stood on "✕" goes on from the first card showing — it is not left on a button that is gone',
      visible(kb).length === 4 && kb.doc.activeElement !== cross && kb.doc.body.contains(kb.doc.activeElement) &&
      kb.doc.activeElement.classList.contains('bent-shop-link') && kb.doc.activeElement.closest('.bent-shop-card') === visible(kb)[0]);
    const two = browser(shopHtml(), { search: '?shelf=candles&tag=' + encodeURIComponent('מתנה') });
    const tagCross = two.doc.querySelector('[data-tz-unfilter="tag"]');
    tagCross.focus();
    tagCross.click();
    check('unfilter: with another filter still in force, the keyboard lands on ITS "✕"',
      two.doc.body.contains(two.doc.activeElement) && two.doc.activeElement.getAttribute('data-tz-unfilter') === 'shelf');
    const mouse = browser(shopHtml(), { search: '?tag=' + encodeURIComponent('מתנה') });
    mouse.doc.querySelector('[data-tz-unfilter="tag"]').click();
    check('unfilter: a press that did not hold the focus (a tap, a mouse in Safari) moves no focus', mouse.doc.activeElement === null);
    const none = browser(shopHtml());
    const noneBox = none.doc.querySelector('[data-tz-search]');
    noneBox.value = 'אין דבר כזה';
    none.doc.fire('input', noneBox);
    await settle(260);
    const clearBtn = none.doc.querySelector('[data-tz-clear]');
    clearBtn.focus();
    clearBtn.click();
    check('clear: "ניקוי" is hidden with its box — the keyboard goes on from the first card, not from a hidden button',
      none.doc.querySelector('[data-tz-shop-none]').hidden === true && none.doc.activeElement !== clearBtn &&
      !!none.doc.activeElement && none.doc.activeElement.closest('.bent-shop-card') === visible(none)[0]);

    // review r4 #11 — tags were joined with "|" in data-tags, and a tag may hold one (the catalog splits on commas only)
    catalog.updateProduct('soap1', { tags: ['מבצע|חורף', 'עדין,טבעי'] });
    const piped = browser(shopHtml(), { search: '?tag=' + encodeURIComponent('מבצע|חורף') });
    const soapCard = piped.doc.querySelectorAll('.bent-shop-card').find((c) => c.getAttribute('data-title') === 'סבון זית כפרי');
    check('tags: a comma can never be IN a tag (the catalog splits on it), so it is what joins them on the card',
      catalog.getProduct('soap1').tags.join(' / ') === 'מבצע|חורף / עדין / טבעי' && !!soapCard && soapCard.getAttribute('data-tags') === 'מבצע|חורף,עדין,טבעי');
    check('tags: a tag with "|" in it filters to its product (its chip on the product page used to lead to an empty shop)',
      titles(visible(piped)) === 'סבון זית כפרי' && piped.doc.querySelector('[data-tz-unfilter="tag"]').textContent === 'תגית: מבצע|חורף ✕' &&
      render.renderBuy({ sku: 'soap1' }).indexOf('<a class="bent-buy-tag" href="/shop.html?tag=' + encodeURIComponent('מבצע|חורף') + '">מבצע|חורף</a>') !== -1);
    const half = browser(shopHtml(), { search: '?tag=' + encodeURIComponent('מבצע') });
    check('tags: half of such a tag is not the tag', visible(half).length === 0);
  });

  const mem = {};
  await section('tz-store.js: the cap, the cart', async () => {
    const b = browser(render.renderHeaderCart() + shopHtml(), { mem });
    const addCandle = b.doc.querySelectorAll('[data-tz-add]').find((x) => x.getAttribute('data-sku') === 'candle');
    addCandle.click();
    addCandle.click();
    const toastText = b.doc.querySelector('.bent-toast').textContent;
    check('cap: a grid button never adds past the stock (one unit left → one in the cart) and says why',
      cartOf(mem).length === 1 && cartOf(mem)[0].qty === 1 && /אפשר להזמין רק יחידה אחת מהמוצר הזה/.test(toastText));
    const addPlain = b.doc.querySelectorAll('[data-tz-add]').find((x) => x.getAttribute('data-sku') === 'plain');
    addPlain.click();
    addPlain.click();
    const link = b.doc.querySelector('.tz-cart-link');
    check('header: the cart link\'s name carries the count', link.getAttribute('aria-label') === 'עגלת קניות — 3 פריטים' && b.doc.querySelector('[data-tz-count]').textContent === '3' && !b.doc.querySelector('[data-tz-count]').hidden);

    const quoteFor = (body) => ({ ok: true, quote: pricing.publicQuote(pricing.quote({ items: body.items, shipping: body.shipping, coupon: body.coupon, payment: body.payment }, { urlFor: (slug) => storePages.productUrl(slug) })) });
    const cart = browser(render.renderCart({}), { mem, fetch: (url, body) => (url === '/api/store/quote' ? quoteFor(body) : { ok: false }) });
    await settle();
    const body = cart.doc.querySelector('[data-tz-cart-body]');
    check('cart: two lines beside a summary card with the two ways on; busy is over',
      cart.doc.querySelectorAll('.bent-cart-line').length === 2 && !!cart.doc.querySelector('.bent-cart-layout > .bent-cart-lines'.replace(' > ', ' ')) &&
      !!cart.doc.querySelector('.bent-cart-summary .bent-cart-actions') && cart.doc.querySelectorAll('.bent-cart-summary a.bent-btn').length === 2 && !body.hasAttribute('aria-busy'));
    // review r4 #12 — a quantity change announced nothing: the cart had no live region
    const live = cart.doc.querySelector('[data-tz-cart-live]');
    const sum = () => pricing.publicQuote(pricing.quote({ items: cartOf(mem) })).subtotalText;
    check('cart: a live region BESIDE the body the script rebuilds (never inside it) — polite, and silent on the first paint',
      !!live && !body.contains(live) && cart.doc.querySelector('[data-tz-cart]').contains(live) && live.getAttribute('role') === 'status' &&
      live.getAttribute('aria-live') === 'polite' && live.textContent === '');
    const key = 'plain||plus';
    const plus = cart.doc.querySelectorAll('[data-tz-key]').find((x) => x.getAttribute('data-tz-key') === key);
    const remove = cart.doc.querySelectorAll('.bent-cart-remove')[0];
    check('cart: every control names its product', /^הגדלת הכמות של מוצר בלי שום דבר/.test(plus.getAttribute('aria-label')) && remove.getAttribute('aria-label') === 'הסרת נר לבנדר גדול מהעגלה');
    plus.focus();
    plus.click();
    check('cart: while the new quote is on its way the cart is marked busy', body.getAttribute('aria-busy') === 'true');
    await settle();
    const again = cart.doc.querySelectorAll('[data-tz-key]').find((x) => x.getAttribute('data-tz-key') === key);
    check('cart: after the rebuild the keyboard is back on the SAME control of the same line, and the quantity went up',
      cart.doc.activeElement === again && again !== plus && cartOf(mem).find((i) => i.sku === 'plain').qty === 3 &&
      cart.doc.querySelectorAll('.bent-qty-input').find((x) => x.getAttribute('data-tz-key') === 'plain||qty').value === '3');
    check('cart: the change is SAID — the new count and the new sum, in the same node as before the rebuild',
      !!live && cart.doc.querySelector('[data-tz-cart-live]') === live && /₪/.test(sum()) && live.textContent === 'בעגלה 4 פריטים — סכום ביניים ' + sum());
    const rm = cart.doc.querySelectorAll('[data-tz-key]').find((x) => x.getAttribute('data-tz-key') === 'candle||remove');
    rm.focus();
    rm.click();
    const hushed = !!live && live.textContent === '';
    await settle();
    check('cart: the region is emptied while the quote is on its way (the same sentence twice is still said twice), then says the new state',
      hushed && !!live && live.textContent === 'בעגלה 3 פריטים — סכום ביניים ' + sum());
    check('cart: when the line itself left, focus lands on a control that is still there', cart.doc.querySelectorAll('.bent-cart-line').length === 1 && !!cart.doc.activeElement && cart.doc.activeElement.hasAttribute('data-tz-key') && body.contains(cart.doc.activeElement));
  });

  await section('tz-store.js: the checkout', async () => {
    let mode = 'real';
    const reply = (body) => {
      const q = pricing.publicQuote(pricing.quote({ items: body.items, shipping: body.shipping, coupon: body.coupon, payment: body.payment }));
      if (mode === 'none') return { ok: true, quote: { ...q, payments: [], payment: '', noPayment: true, blocking: ['NO_PAYMENT'] } };
      if (mode === 'large') return { ok: true, quote: { ...q, blocking: ['TOO_LARGE'], issues: [{ code: 'TOO_LARGE', message: 'הסכום גדול מכדי לחייב בהזמנה אחת' }] } };
      return { ok: true, quote: q };
    };
    const b = browser(render.renderCheckout({}), { mem, fetch: (url, body) => (url === '/api/store/quote' ? reply(body) : { ok: false }) });
    await settle();
    const submit = b.doc.querySelector('[data-tz-submit]');
    const why = b.doc.querySelector('[data-tz-why]');
    const ship = b.doc.querySelector('input[name="shipping"]');
    check('checkout: with a way to pay the button is on, the summary is filled and no reason is shown',
      submit.disabled === false && why.textContent === '' && b.doc.querySelectorAll('[data-tz-summary] .bent-cart-line').length === 1 && !b.doc.querySelector('[data-tz-summary]').hasAttribute('aria-busy'));
    mode = 'none';
    b.doc.fire('change', ship);
    await settle();
    check('checkout: the quote says noPayment → the sentence replaces the choices, the button is off, the reason is beside it',
      b.doc.querySelector('[data-tz-pay-choices]').textContent === NO_PAYMENT && !!b.doc.querySelector('[data-tz-pay-choices] .bent-pay-none') && submit.disabled === true && why.textContent === NO_PAYMENT);
    mode = 'large';
    b.doc.fire('change', ship);
    await settle();
    check('checkout: a sum too large to charge switches the button off with the server\'s sentence', submit.disabled === true && why.textContent === 'הסכום גדול מכדי לחייב בהזמנה אחת');
    mode = 'real';
    b.doc.fire('change', ship);
    await settle();
    check('checkout: back to a payable cart, the button is on again', submit.disabled === false && why.textContent === '' && !!b.doc.querySelector('input[name="payment"]'));
    b.doc.fire('submit', b.doc.querySelector('[data-tz-checkout-form]'));
    const nameInput = b.doc.querySelector('[data-field="name"] input');
    check('checkout: a missing field is marked on the field itself (aria-invalid) and described by its error line',
      nameInput.getAttribute('aria-invalid') === 'true' && nameInput.getAttribute('aria-describedby') === 'tzc-name-err' &&
      b.doc.querySelector('#tzc-name-err'.replace('#', '[id="') + '"]').textContent === 'שדה חובה' && b.doc.activeElement === nameInput);
  });

  // review r4 #1 — the checkout used to send whatever cart the browser held
  // at that moment: a second tab adds to the cart, this page still shows the
  // old sum, and the order was placed for the new one without a word
  await section('tz-store.js: the order is the cart on screen', async () => {
    const own = { tz_cart_v1: JSON.stringify({ items: [{ sku: 'plain', variant: '', qty: 1 }] }) };
    const quoteFor = (body) => ({ ok: true, quote: pricing.publicQuote(pricing.quote({ items: body.items, shipping: body.shipping, coupon: body.coupon, payment: body.payment })) });
    const b = browser(render.renderCheckout({}), { mem: own, fetch: (url, body) => (url === '/api/store/quote' ? quoteFor(body) : { ok: false, message: 'נבדק' }) });
    await settle();
    const form = b.doc.querySelector('[data-tz-checkout-form]');
    const errorBox = b.doc.querySelector('[data-tz-error]');
    const shown = () => ({
      lines: b.doc.querySelectorAll('[data-tz-summary] .bent-cart-line').length,
      total: (b.doc.querySelector('[data-tz-summary] .is-total') || { textContent: '' }).textContent
    });
    const sent = () => b.calls.filter((c) => c.url === '/api/store/checkout');
    b.doc.querySelector('[name="name"]').value = 'נועה';
    b.doc.querySelector('[name="phone"]').value = '0501234567';
    const terms = b.doc.querySelector('[name="acceptTerms"]');
    if (terms) terms.checked = true;
    const before = shown();
    // another tab puts two soaps in the same cart
    own.tz_cart_v1 = JSON.stringify({ items: [{ sku: 'plain', variant: '', qty: 1 }, { sku: 'soap1', variant: '', qty: 2 }] });
    b.doc.fire('submit', form);
    check('checkout: a cart that changed behind the page is NOT ordered — the shopper is told beside the button, in words',
      before.lines === 1 && sent().length === 0 && errorBox.textContent === 'העגלה השתנתה — בדקו את הסיכום ואשרו שוב' && errorBox.getAttribute('role') === 'alert');
    await settle();
    const after = shown();
    check('checkout: …and the summary is quoted again, so the sum on screen is the sum of the cart (the message stays until the next press)',
      after.lines === 2 && after.total !== before.total && /₪/.test(after.total) && errorBox.textContent === 'העגלה השתנתה — בדקו את הסיכום ואשרו שוב' &&
      b.doc.querySelector('[data-tz-submit]').disabled === false);
    b.doc.fire('submit', form);
    const order = sent()[0];
    check('checkout: the next press orders exactly the lines on screen',
      sent().length === 1 && !!order && JSON.stringify(order.body.items.map((i) => [i.sku, i.qty])) === '[["plain",1],["soap1",2]]' && order.body.customer.name === 'נועה');
    // a page whose first quote never arrived shows no sum at all — nothing is ordered blind
    const blind = browser(render.renderCheckout({}), { mem: { tz_cart_v1: own.tz_cart_v1 }, fetch: () => ({ ok: false }) });
    await settle();
    blind.doc.querySelector('[name="name"]').value = 'נועה';
    blind.doc.querySelector('[name="phone"]').value = '0501234567';
    const terms2 = blind.doc.querySelector('[name="acceptTerms"]');
    if (terms2) terms2.checked = true;
    blind.doc.fire('submit', blind.doc.querySelector('[data-tz-checkout-form]'));
    check('checkout: without a quote on screen nothing is ordered — the summary is asked for again',
      blind.calls.filter((c) => c.url === '/api/store/checkout').length === 0 && blind.calls.filter((c) => c.url === '/api/store/quote').length === 2 &&
      blind.doc.querySelector('[data-tz-error]').textContent === 'הסיכום עוד לא נטען — בדקו אותו ואשרו שוב');
  });

  await section('tz-store.js: the order page', async () => {
    const order = (over) => ({
      number: 1001, token: 'tok123', status: 'new', statusLabel: 'התקבלה', statusText: '', paid: false,
      items: [{ title: 'סבון זית', variantLabel: '', qty: 1, unitText: '₪27.50', totalText: '₪27.50', image: '' }],
      subtotalText: '₪27.50', discountText: '', coupon: '', shippingLabel: '', shippingText: '', vatText: '', totalText: '₪27.50', tracking: '',
      payment: { kind: 'demo', label: 'תשלום הדגמה', details: 'שום כרטיס לא מחויב', demo: { canPay: true, paid: false, message: 'אפשר לשלם כאן בכסף דמיוני' } },
      thanks: 'תודה!', ...(over || {})
    });
    // builder 4's route is not in this tree: the reply is the contract's, faked here
    const paid = order({ payment: { kind: 'demo', label: 'תשלום הדגמה', details: 'שום כרטיס לא מחויב', demo: { canPay: false, paid: true, message: '' } } });
    const server = (url) => {
      if (url === '/api/store/order/tok123') return { order: order() };
      if (url === '/api/store/demo-pay') return { ok: true, order: paid };
      return { ok: false };
    };
    const b = browser(render.renderOrder({}), { search: '?o=tok123', fetch: server });
    await settle();
    const block = b.doc.querySelector('.bent-demo-pay');
    const btn = block && block.querySelector('button.bent-order-pay-btn');
    check('order: a demo method renders its block — the title, the banner, the details, the button',
      !!block && /תשלום: תשלום הדגמה/.test(block.textContent) && block.querySelector('.bent-test-banner').textContent === 'הדגמה — כסף אמיתי לא עובר' &&
      block.querySelector('.bent-order-pay-details').textContent === 'שום כרטיס לא מחויב' && !!btn && btn.textContent === 'לשלם בכסף דמיוני');
    check('order: a living order wears the tick', b.doc.querySelector('.bent-order-check').textContent === '✓' && !b.doc.querySelector('.bent-order-check').classList.contains('is-cancelled'));
    btn.click();
    await settle();
    const call = b.calls.find((c) => c.url === '/api/store/demo-pay');
    const state = b.doc.querySelector('.bent-demo-pay .bent-order-pay-state');
    check('order: the button POSTs /api/store/demo-pay { token } and the page is repainted from the order it answers with — "שולם (הדגמה) ✓", no button',
      !!call && call.body && call.body.token === 'tok123' && Object.keys(call.body).length === 1 && !!state && state.textContent === 'שולם (הדגמה) ✓' &&
      !b.doc.querySelector('.bent-demo-pay button') && b.doc.querySelectorAll('.bent-order-head').length === 1 && b.doc.activeElement === state);
    const refused = browser(render.renderOrder({}), { search: '?o=tok123', fetch: (url) => (url === '/api/store/demo-pay' ? { ok: false, code: 'NOT_DEMO', message: 'התשלום הדמיוני אינו זמין' } : server(url)) });
    await settle();
    refused.doc.querySelector('.bent-demo-pay button').click();
    await settle();
    check('order: a refusal is said beside the button, which is usable again',
      refused.doc.querySelector('.bent-demo-pay .bent-checkout-error').textContent === 'התשלום הדמיוני אינו זמין' && refused.doc.querySelector('.bent-demo-pay button').disabled === false);
    const gone = browser(render.renderOrder({}), { search: '?o=tok123', fetch: () => ({ order: order({ status: 'cancelled', statusLabel: 'בוטלה', statusText: 'ההזמנה בוטלה' }) }) });
    await settle();
    check('order: a cancelled order wears no green tick and offers no payment',
      gone.doc.querySelector('.bent-order-check').textContent === '✕' && gone.doc.querySelector('.bent-order-check').classList.contains('is-cancelled') && !gone.doc.querySelector('.bent-order-pay'));
  });

  // ── the review round (r4): what the storefront was caught doing ─────────
  // These run last — they rename the store, move the home page and draft
  // products through the admin's own route handlers, and nothing above
  // should see that.
  const src = (p) => pages.getPageSource(p, 'published') || '';
  const trailOf = (file) => (read(file).match(/<nav class="bent-crumbs"[\s\S]*?<\/nav>/) || [''])[0];

  await section('r4 #2: a strip of chosen products on a public page', () => {
    catalog.createProduct({ title: 'מוצר נבחר', price: '15', slug: 'pick1' });
    store.afterProductChange(catalog.getProduct('pick1'));
    pages.savePageSource('about', '<bent-heading level="1">אודות</bent-heading>\n<bent-shop title="נבחרים" skus="pick1,draft1,hidden1"></bent-shop>', { publish: true });
    store.refreshNow();
    const html = read('about.html');
    check('export: a curated strip prints its active product and NOTHING of a draft or a hidden one — no name, no summary, no price',
      /data-title="מוצר נבחר"/.test(html) && (html.match(/<article class="bent-shop-card/g) || []).length === 1 && !/טיוטה|עוד לא הוכרז|מוסתר/.test(html));
    catalog.updateProduct('pick1', { status: 'draft' });
    store.afterProductChange(catalog.getProduct('pick1'));
    check('export: a product that is drafted leaves the strip it was chosen for (and a titled strip left empty disappears whole)',
      !!read('about.html') && !/מוצר נבחר|נבחרים|bent-shop-card/.test(read('about.html')));
    const pv = callRoute('store-products', 'get', '/admin/store/products/:id/preview', { params: { id: String(catalog.getProduct('draft1').id) } });
    check('admin preview: the owner still sees a DRAFT the way it will look — the card and the buy box (the one place a draft is drawn)',
      pv.code === 200 && /<article class="bent-shop-card[^>]*data-title="טיוטה"/.test(String(pv.body)) && /class="bent-buy/.test(String(pv.body)) && /ואינו מוצג בחנות/.test(String(pv.body)));
  });

  await section('r4 #3: the generated pages follow the site around the store', () => {
    const trail = (name, url) => `<bent-crumb label="${name}" url="${url}">`;
    // the owner names the store on its settings screen
    const named = callRoute('store-admin', 'post', '/admin/api/store/settings', { body: { name: 'Noa Studio' } });
    check('store settings: a new store name reaches the trail of every product and category page — the source and the export',
      !!named.body && named.body.ok === true && named.body.rebuilt === true &&
      src('shop-candle').indexOf(trail('Noa Studio', '/shop.html')) !== -1 && src('shelf-candles').indexOf(trail('Noa Studio', '/shop.html')) !== -1 &&
      /Noa Studio/.test(trailOf('shop-candle.html')) && !/הסטודיו של נועה/.test(trailOf('shop-candle.html')) && /Noa Studio/.test(trailOf('shelf-candles.html')));
    check('store settings: a page the owner redesigned still keeps its own words', /label="הסטודיו של נועה"/.test(src('shop-soap1')) && /הסבר שכתבתי בעצמי/.test(src('shop-soap1')));
    // the shop page moves to another address
    const was = settings.loadSettings().pages;
    pages.createPage({ title: 'החנות שלנו', slug: 'store', blocks: [], meta: { store: 'shop' }, status: 'draft' });
    pages.savePageSource('store', '<bent-shop filter="true"></bent-shop>', { publish: true });
    callRoute('store-admin', 'post', '/admin/api/store/settings', { body: { pages: { ...was, shop: 'store' } } });
    check('store settings: a shop page that moved is where every trail leads',
      settings.loadSettings().pages.shop === 'store' && src('shop-candle').indexOf(trail('Noa Studio', '/store.html')) !== -1 && /href="\/store\.html"/.test(trailOf('shop-candle.html')) &&
      !/href="\/shop\.html"/.test(trailOf('shop-candle.html')));
    callRoute('store-admin', 'post', '/admin/api/store/settings', { body: { pages: was } });
    // the shop is crowned home page
    const crowned = callRoute('homepage', 'post', '/admin/api/homepage', { body: { full_path: 'shop' } });
    check('homepage: a shop crowned home page starts every trail AT the shop — not "דף הבית › shop", two steps to one page',
      !!crowned.body && crowned.body.ok === true && src('shop-candle').indexOf(trail('Noa Studio', '/')) !== -1 && !/דף הבית/.test(src('shop-candle')) &&
      !/דף הבית/.test(trailOf('shop-candle.html')) && !/דף הבית/.test(trailOf('shelf-candles.html')));
    callRoute('homepage', 'post', '/admin/api/homepage', { body: { full_path: 'home' } });
    check('homepage: back on its own page, the trail is home › shop again',
      src('shop-candle').indexOf(trail('דף הבית', '/')) !== -1 && src('shop-candle').indexOf(trail('Noa Studio', '/shop.html')) !== -1);
    // a store without a name of its own wears the site's
    callRoute('store-admin', 'post', '/admin/api/store/settings', { body: { name: '' } });
    const site = callRoute('settings', 'post', '/admin/api/settings', { body: { title: 'סטודיו חדש' } });
    check('site settings: the site\'s new name reaches every trail of a store that has no name of its own',
      !!site.body && site.body.ok === true && !site.body.rebuildError && settings.storeName() === 'סטודיו חדש' &&
      src('shop-candle').indexOf(trail('סטודיו חדש', '/shop.html')) !== -1 && /סטודיו חדש/.test(trailOf('shelf-candles.html')));
    const themed = callRoute('theme', 'post', '/admin/api/theme', { body: { siteTitle: 'שם מדף העיצוב', overrides: {} } });
    check('theme save: the same name typed on the design screen follows too',
      !!themed.body && themed.body.ok === true && !themed.body.rebuildError && src('shop-candle').indexOf(trail('שם מדף העיצוב', '/shop.html')) !== -1 &&
      /שם מדף העיצוב/.test(trailOf('shop-candle.html')));

    // a sync that fails is logged and never fails the save; a closed store is not synced at all
    const real = { sync: storePages.syncCatalogPages, error: console.error };
    const logged = [];
    let ran = 0;
    console.error = (...a) => { logged.push(a.join(' ')); };
    storePages.syncCatalogPages = () => { ran++; throw new Error('boom'); };
    let answers = [];
    try {
      answers = [
        callRoute('store-admin', 'post', '/admin/api/store/settings', { body: { name: 'Noa Studio' } }),
        callRoute('homepage', 'post', '/admin/api/homepage', { body: { full_path: 'home' } }),
        callRoute('settings', 'post', '/admin/api/settings', { body: { title: 'הסטודיו של נועה' } }),
        callRoute('theme', 'post', '/admin/api/theme', { body: { siteTitle: 'הסטודיו של נועה', overrides: {} } })
      ];
      check('all four doors: a page sync that throws is logged and the save still answers ok',
        ran === 4 && answers.every((r) => r.code === 200 && r.body && r.body.ok === true) && logged.filter((l) => /\[store\] page sync after .* failed: boom/.test(l)).length === 4 &&
        settings.loadSettings().name === 'Noa Studio' && configMod.loadConfig().title === 'הסטודיו של נועה');
      ran = 0;
      settings.saveSettings({ open: false });
      callRoute('store-admin', 'post', '/admin/api/store/settings', { body: { name: 'Noa Studio' } });
      callRoute('homepage', 'post', '/admin/api/homepage', { body: { full_path: 'home' } });
      callRoute('settings', 'post', '/admin/api/settings', { body: { title: 'הסטודיו של נועה' } });
      callRoute('theme', 'post', '/admin/api/theme', { body: { siteTitle: 'הסטודיו של נועה', overrides: {} } });
      check('all four doors: a closed store\'s pages are not synced (the flip does that when it opens)', ran === 0);
    } finally {
      storePages.syncCatalogPages = real.sync;
      console.error = real.error;
      settings.saveSettings({ open: true });
    }
    storePages.syncCatalogPages();
    store.refreshNow();
  });

  await section('r4 #4: a bulk action follows the category pages', () => {
    const bulk = (slugs, action) => callRoute('store-products', 'post', '/admin/api/store/products/bulk', { body: { ids: slugs.map((s) => catalog.getProduct(s).id), action } });
    const live = (p) => (pages.getPageByFullPath(p) || {}).status === 'published' && !!read(p + '.html');
    const before = live('shelf-candles');
    const drafted = bulk(['candle', 'vanilla'], { status: 'draft' });
    check('bulk draft: the category it emptied loses its page (a draft, out of the export) — it is not left live saying "עוד אין מוצרים בחנות."',
      before && !!drafted.body && drafted.body.ok === true && drafted.body.changed === 2 && drafted.body.rebuilt === true &&
      pages.getPageByFullPath('shelf-candles').status === 'draft' && !read('shelf-candles.html'));
    bulk(['candle', 'vanilla'], { status: 'active' });
    check('bulk active: the category has products again and its page is back', live('shelf-candles') && /data-title="נר וניל"/.test(read('shelf-candles.html')));
    catalog.saveShelf({ slug: 'gifts', label: 'מתנות' });
    store.afterShelfChange();
    const empty = !pages.getPageByFullPath('shelf-gifts');
    bulk(['plain'], { shelf: 'gifts' });
    check('bulk move: a category that just got its first product gets its page, and the product\'s trail leads to it (not to the shop, filtered)',
      empty && live('shelf-gifts') && /label="מתנות" url="\/shelf-gifts.html"/.test(src('shop-plain')) && /href="\/shelf-gifts\.html"/.test(trailOf('shop-plain.html')));
  });

  await section('r4 #6: a product beside an owner\'s page at its address', () => {
    pages.createPage({ title: 'מידע על החנות', slug: 'shop-info', blocks: [], status: 'draft' });
    pages.savePageSource('shop-info', '<bent-heading level="1">שעות פתיחה</bent-heading>', { publish: true });
    catalog.createProduct({ title: 'ערכת מידע', price: '10', slug: 'info', variants: [{ label: 'S' }, { label: 'M' }] });
    const r = store.afterProductChange(catalog.getProduct('info'));
    const card = render.renderShop({ skus: 'info' });
    check('foreign page: the product gets no page there (the sync says foreign) and its card does NOT send the shopper to the owner\'s page to buy',
      !!r.page && r.page.action === 'foreign' && /data-title="ערכת מידע"/.test(card) && !/shop-info/.test(card) &&
      /<span class="bent-shop-link"/.test(card) && /<span class="bent-shop-add is-none"/.test(card) &&
      storePages.productUrl('info') === '' && !storePages.publishedProductPaths().has('shop-info'));
    const variant = catalog.publicProduct(catalog.getProduct('info'), settings.loadSettings()).variants[0].code;
    const line = pricing.publicQuote(pricing.quote({ items: [{ sku: 'info', variant, qty: 1 }] }, { urlFor: (slug) => storePages.productUrl(slug) })).lines[0];
    check('foreign page: its cart line is not a link to that page either', !!line && line.sku === 'info' && !line.url);
    check('foreign page: the owner\'s page is untouched', pages.getPageByFullPath('shop-info').title === 'מידע על החנות' && /שעות פתיחה/.test(read('shop-info.html')));
    // The other way round. A site package carries a page's SOURCE, not its
    // meta, so on an imported site every product page arrives without the
    // store's note. It is still the product's page — it holds its buy box —
    // and a card that stopped linking there could not sell a product with options.
    const noted = pages.getPageByFullPath('shop-vanilla').meta;
    pages.updatePage('shop-vanilla', { meta: {} });
    check('unmarked page: a published page at the product\'s address that holds ITS buy box is still where the card leads',
      !pages.getPageByFullPath('shop-vanilla').meta.store && storePages.syncProductPage(catalog.getProduct('vanilla')).action === 'foreign' &&
      storePages.publishedProductPaths().has('shop-vanilla') && storePages.productUrl('vanilla') === '/shop-vanilla.html' &&
      /<a class="bent-shop-link" href="\/shop-vanilla.html"/.test(render.renderShop({ skus: 'vanilla' })));
    pages.updatePage('shop-vanilla', { meta: noted });
    check('unmarked page: marked again, it is the store\'s again', storePages.syncProductPage(catalog.getProduct('vanilla')).action === 'kept');
  });

  await section('r4 #8: the owner\'s tags on a generated page', () => {
    pages.updatePage('shop-shirt', { tags: ['article', 'מבצע'] });
    const still = storePages.syncProductPage(catalog.getProduct('shirt')).action;
    catalog.updateProduct('shirt', { title: 'חולצה לבנה' });
    const r = store.afterProductChange(catalog.getProduct('shirt'));
    const page = pages.getPageByFullPath('shop-shirt');
    check('tags: tagging a generated page is not an edit of it (the next sync finds nothing to do), and a rewrite of the page keeps the tags',
      still === 'kept' && !!r.page && r.page.action === 'updated' && page.title === 'חולצה לבנה' && /label="חולצה לבנה"><\/bent-crumb>/.test(src('shop-shirt')) &&
      (page.tags || []).join('|') === 'article|מבצע');
    pages.updatePage('shelf-candles', { tags: ['קטגוריה'] });
    catalog.saveShelf({ slug: 'candles', label: 'נרות ונרונים' });
    store.afterShelfChange();
    check('tags: a category page keeps its tags through a rename too',
      pages.getPageByFullPath('shelf-candles').title === 'נרות ונרונים' && (pages.getPageByFullPath('shelf-candles').tags || []).join('|') === 'קטגוריה');
  });

  console.log('\nSMOKE STOREFRONT: ' + (failed ? 'FAIL (' + failed + ')' : 'PASS'));
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  console.log('\nSMOKE STOREFRONT: FAIL');
  process.exit(1);
});
