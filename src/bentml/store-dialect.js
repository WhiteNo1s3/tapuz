'use strict';

/**
 * The STORE dialect of BenTML (v2.53) — a whole shop as one document:
 *
 *   <bent-store version="1" name="הסטודיו של נועה" currency="ILS">
 *     <bent-store-rules vat="18" vat-included="true" min-order="0" low-stock="3" />
 *     <bent-shelf id="candles" label="נרות" />
 *     <bent-sku id="lavender" title="נר לבנדר" price="89.90" was="120" stock="12"
 *               shelf="candles" image="/assets/lavender.webp" badge="מבצע">
 *       נר סויה בעבודת יד, 40 שעות בעירה.
 *       <bent-variant id="small" label="קטן" price="69.90" stock="5" />
 *       <bent-variant id="large" label="גדול" stock="7" />
 *     </bent-sku>
 *     <bent-ship id="pickup" label="איסוף עצמי" price="0" address="false" />
 *     <bent-ship id="delivery" label="משלוח עד הבית" price="30" free-over="300" />
 *     <bent-pay id="bank" kind="bank" label="העברה בנקאית">בנק לאומי, סניף 800, חשבון 12345</bent-pay>
 *     <bent-pay id="card" kind="card" label="כרטיס אשראי" max-payments="3" />
 *     <bent-coupon code="WELCOME10" percent="10" min="100" until="2026-12-31" />
 *   </bent-store>
 *
 * It is what the store exports (⬇ BenTML), what the AI catalog writer is
 * asked to hand back, what a site package carries, and what every catalog
 * apply is backed up as. Orders are NOT part of it — they are records, not
 * the description of a shop — and neither is the open/closed switch: a
 * pasted document can fill a store, never open one.
 *
 * Its tags never collide with PAGE modules (bent-product, bent-category are
 * page tags): a chat that learned the page language must not mistake a
 * catalog for a page. The parser still accepts those spellings inside a
 * <bent-store> and says so in `notes`.
 *
 * Pure: no database, no site. Money stays the typed string here ("89.90");
 * src/store/document.js validates it against the live store. The serializer
 * is deterministic, and serialize(parse(serialize(x))) === serialize(x).
 *
 * v2.69 — a shelf is a full category and a product carries what a real
 * catalog needs (the version stays 1: every addition is an attribute an
 * older build simply does not read):
 *
 *   <bent-shelf id="gifts" label="מתנות" image="/assets/gifts.webp" summary="…" hidden="true"
 *               seo-title="…" seo-description="…" />
 *   <bent-shelf id="for-her" label="בשבילה" parent="gifts" />
 *   <bent-sku … brand="נועה" tags="סויה, בעבודת יד" featured="true" barcode="7290001234567"
 *             weight="320" seo-title="…" seo-description="…">
 *
 * There is NO cost attribute, on purpose: the site package is a file people
 * share and it carries this document verbatim — what a product costs the
 * owner stays in the database.
 *
 * In a MERGE document (mode="merge", or no <bent-store> around it) an
 * attribute that is absent keeps the product's value, so `<bent-sku id="x"
 * price="59"/>` changes one price and nothing else. The parser therefore
 * records WHICH attributes a tag carried (a hidden `__has` set on the
 * object); the serializer writes an attribute named in that set even when
 * its value is empty, which is how a merge document says "clear this".
 *
 * The root may carry keep="description,summary,…" — a list of attribute
 * names (`description` is a product's body). It is how a document written
 * from a PARTIAL view of the store says so: on a product or a category that
 * already exists, a listed attribute its tag does not carry keeps the
 * store's value, whatever the mode. The AI catalog writer roots its trimmed
 * "the store today" with it, so a model that echoes a view without
 * descriptions cannot blank them (src/injections/store-catalog.js).
 */

const { straightenQuotes } = require('./theme-dialect');

const VERSION = 1;
const MAX_CHARS = 400000;
const MAX_PRODUCTS = 500;
// One tag's attribute text. A product with twelve long picture addresses
// already passed the old 4000, and the tag was dropped without a word — in
// a whole-catalog document that HID the product.
const BODY_MAX = 16000;

const TAG_ALIASES = {
  // NOT bent-shop: that is the storefront PAGE module — a pasted page that
  // holds <bent-shop> must never read as an empty store (which would hide
  // every product on apply)
  'bent-store': 'bent-store',
  'bent-store-rules': 'bent-store-rules', 'bent-rules': 'bent-store-rules', 'bent-store-settings': 'bent-store-rules',
  'bent-shelf': 'bent-shelf', 'bent-category': 'bent-shelf', 'bent-aisle': 'bent-shelf',
  'bent-sku': 'bent-sku', 'bent-product': 'bent-sku', 'bent-item': 'bent-sku',
  'bent-variant': 'bent-variant', 'bent-option': 'bent-variant',
  'bent-ship': 'bent-ship', 'bent-shipping': 'bent-ship', 'bent-delivery': 'bent-ship',
  'bent-pay': 'bent-pay', 'bent-payment': 'bent-pay',
  'bent-coupon': 'bent-coupon', 'bent-discount': 'bent-coupon'
};

const ATTR_ALIASES = {
  'bent-sku': {
    sku: 'id', slug: 'id', name: 'title', label: 'title',
    'compare-at': 'was', compareat: 'was', compare: 'was', 'old-price': 'was', oldprice: 'was',
    category: 'shelf', qty: 'stock', inventory: 'stock', quantity: 'stock',
    'max-per-order': 'max', maxperorder: 'max', picture: 'image', img: 'image',
    vendor: 'brand', manufacturer: 'brand', gtin: 'barcode', ean: 'barcode', upc: 'barcode', keywords: 'tags',
    'meta-title': 'seo-title', metatitle: 'seo-title', seotitle: 'seo-title',
    'meta-description': 'seo-description', metadescription: 'seo-description', seodescription: 'seo-description'
  },
  'bent-variant': { code: 'id', sku: 'id', name: 'label', title: 'label', qty: 'stock', inventory: 'stock' },
  'bent-shelf': {
    slug: 'id', name: 'label', title: 'label',
    description: 'summary', picture: 'image', img: 'image', 'parent-id': 'parent', parentid: 'parent',
    seotitle: 'seo-title', seodescription: 'seo-description'
  },
  'bent-ship': { name: 'label', title: 'label', 'free-from': 'free-over', freeover: 'free-over', free: 'free-over' },
  'bent-pay': { name: 'label', title: 'label', type: 'kind', link: 'url', href: 'url', installments: 'max-payments', payments: 'max-payments', maxpayments: 'max-payments' },
  'bent-coupon': { name: 'code', id: 'code', from: 'starts', start: 'starts', 'starts-on': 'starts', to: 'until', 'ends-on': 'until', end: 'until', expires: 'until', 'max-uses': 'uses', limit: 'uses', 'min-subtotal': 'min' },
  'bent-store-rules': { 'vat-rate': 'vat', 'prices-include-vat': 'vat-included', exempt: 'vat-exempt' }
};

// What each tag can say. An attribute outside its tag's set used to vanish
// without a word (an AI's vendor="…" simply was not there after the apply);
// now the reader is told. `cost` is deliberately in none of them.
const KNOWN_ATTRS = {
  'bent-store': new Set(['version', 'name', 'currency', 'note', 'mode', 'keep']),
  'bent-store-rules': new Set(['vat', 'vat-included', 'vat-exempt', 'min-order', 'low-stock', 'order-start', 'require-email', 'terms', 'thanks']),
  'bent-shelf': new Set(['id', 'label', 'parent', 'image', 'summary', 'hidden', 'seo-title', 'seo-description']),
  'bent-sku': new Set(['id', 'title', 'price', 'was', 'stock', 'shelf', 'status', 'brand', 'tags', 'featured', 'barcode', 'weight',
    'image', 'images', 'badge', 'summary', 'delivery', 'max', 'seo-title', 'seo-description', 'description']),
  'bent-variant': new Set(['id', 'label', 'price', 'stock']),
  'bent-ship': new Set(['id', 'label', 'price', 'free-over', 'address', 'note']),
  'bent-pay': new Set(['id', 'kind', 'label', 'details', 'phone', 'url', 'max-payments']),
  'bent-coupon': new Set(['code', 'percent', 'amount', 'free-shipping', 'min', 'starts', 'until', 'uses', 'active', 'note'])
};

// A quoted value is line-bound for the reader (see tokenize), so the writer
// never puts a raw line break or tab inside one: a two-line "thanks" rule
// used to cost every backup its whole rules tag.
function escAttr(v) {
  return curlyOut(String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;'));
}
function escText(v) {
  return curlyOut(String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
}
// A pasted document has its “curly” quotes straightened before it is read
// (a chat writes them as delimiters). A curly quote that is part of the
// CONTENT — a title with a “quoted” word, an apostrophe a phone typed —
// would be straightened with them, and inside title="…" a straightened
// double quote ends the value early. So content writes them as numbers.
function curlyOut(s) {
  return s.replace(/[“”„‟″«»‘’‚‛′]/g, (c) => '&#' + c.charCodeAt(0) + ';');
}

const NAMED_ENTITIES = { quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', amp: '&' };
/**
 * Entities → characters, in ONE pass (so "&amp;lt;" is the text "&lt;", not
 * "<"). Numeric ones too, decimal and hex — but only a tab, a line break or
 * a printable character: no other control character enters through "&#…;".
 */
function unesc(v) {
  return String(v == null ? '' : v).replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|(quot|apos|lt|gt|nbsp|amp));/g, (m, hex, dec, name) => {
    if (name) return NAMED_ENTITIES[name];
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    const fine = cp === 9 || cp === 10 || cp === 13 ||
      (cp >= 32 && cp !== 127 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff));
    return fine ? String.fromCodePoint(cp) : m;
  });
}

function parseAttrs(body, multiline) {
  const out = {};
  const src = String(body || '').replace(/\/\s*$/, '');
  const re = multiline
    ? /([A-Za-z][\w-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
    : /([A-Za-z][\w-]*)\s*(?:=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    if (!m[1]) { re.lastIndex++; continue; }
    out[m[1].toLowerCase()] = unesc(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '');
  }
  return out;
}

/**
 * Tags and the text between them, in order — one left-to-right scan
 * (a quoted value is line-bound, a body over BODY_MAX is not a tag), so a
 * hostile paste costs O(n).
 *
 * `trusted` is for text the store wrote ITSELF (a backup, an undo, its own
 * export): no length ceiling on a tag, and a quoted value may span lines —
 * a backup taken by an earlier build can hold a raw line break inside
 * thanks="…", and it must still come back whole.
 *
 * A tag that looked like one and could not be read (its quoted value ran
 * into a line break, it never ended, or it passed BODY_MAX) leaves a
 * `{ skipped: name }` token, so the reader can SAY it dropped something.
 */
const NAME_RE = /^[A-Za-z][\w-]*/;
function tokenize(src, opts = {}) {
  const s = String(src || '');
  const n = s.length;
  const trusted = !!(opts && opts.trusted);
  const bodyMax = trusted ? Infinity : BODY_MAX;
  const out = [];
  let i = 0;
  let textFrom = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    let j = lt + 1;
    const close = s.charCodeAt(j) === 47;
    if (close) j++;
    const nm = NAME_RE.exec(s.slice(j, j + 80));
    if (!nm) { i = lt + 1; continue; }
    const bodyStart = j + nm[0].length;
    let k = bodyStart;
    let q = 0;
    let next = -1;
    let cut = false;
    while (k < n) {
      const c = s.charCodeAt(k);
      if (q) {
        if (c === q) q = 0;
        else if (c === 10 && !trusted) { cut = true; break; }
      } else if (c === 62) {
        const body = s.slice(bodyStart, k);
        if (lt > textFrom) out.push({ text: s.slice(textFrom, lt) });
        out.push({ tag: nm[0].toLowerCase(), close, self: /\/\s*$/.test(body), attrs: close ? {} : parseAttrs(body, trusted) });
        textFrom = k + 1;
        next = k + 1;
        break;
      } else if (c === 34 || c === 39) q = c;
      else if (c === 60) { next = k; break; }
      if (k - bodyStart >= bodyMax) { cut = true; break; }
      k++;
    }
    if (!close && next < 0 && (cut || k >= n)) out.push({ skipped: nm[0].toLowerCase() });
    i = next >= 0 ? next : lt + 1;
  }
  if (textFrom < n) out.push({ text: s.slice(textFrom) });
  return out;
}

/** A body of text as a person wrote it: entities decoded, indentation and edge blank lines gone, paragraphs kept. */
function cleanBody(raw) {
  const lines = unesc(raw).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const out = [];
  for (const l of lines) {
    if (!l && (!out.length || out[out.length - 1] === '')) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

function canon(tag, attrs, noteOnce) {
  const map = ATTR_ALIASES[tag] || {};
  const known = KNOWN_ATTRS[tag];
  const out = {};
  for (const [k0, v] of Object.entries(attrs)) {
    const k = k0.replace(/_/g, '-');
    const to = map[k] || map[k.replace(/-/g, '')] || k;
    if (known && !known.has(to)) {
      noteOnce('ATTR_UNKNOWN', `<${tag}>: המאפיין "${k0}" אינו מוכר — לא נקרא`);
      continue;
    }
    if (to !== k0) noteOnce('ATTR_ALIAS', `<${tag}> ${k0} → ${to}`);
    if (out[to] === undefined) out[to] = v;
  }
  return out;
}

/**
 * Record which attributes an object carries, where nothing that copies or
 * prints the object sees it (not enumerable: a spread drops it, JSON skips
 * it). The parser calls this for every product, option and shelf; a writer
 * of a MERGE document (the CSV import) calls it to say "this field is
 * stated, even though it is empty".
 */
function markPresent(obj, names) {
  Object.defineProperty(obj, '__has', { value: new Set(names), enumerable: false, writable: true, configurable: true });
  return obj;
}

/** yes / no as a document writes it; `fallback` for anything else. */
function flag(v, fallback) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'כן') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === 'לא') return false;
  return fallback;
}

/** "a,b ,  c" → "a, b, c": one spelling for a tag list, so parse → serialize settles at once. */
function tagList(v) {
  const list = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
  return list.map((t) => String(t == null ? '' : t).trim()).filter(Boolean).join(', ');
}

/**
 * The root's keep="…" as a list of attribute names, spelled the way a
 * <bent-sku> or a <bent-shelf> spells them (aliases settle: picture →
 * image). `id` can never be kept — it is how a tag is matched at all — and a
 * word that names no attribute is said out loud, not silently dropped.
 */
function keepNames(v, noteOnce) {
  const sku = KNOWN_ATTRS['bent-sku'];
  const shelf = KNOWN_ATTRS['bent-shelf'];
  const out = [];
  for (const raw of (Array.isArray(v) ? v.join(',') : String(v == null ? '' : v)).toLowerCase().split(/[\s,;]+/)) {
    if (!raw) continue;
    const k = raw.replace(/_/g, '-');
    const to = sku.has(k) || shelf.has(k) ? k : (ATTR_ALIASES['bent-sku'][k] || ATTR_ALIASES['bent-shelf'][k] || k);
    if (to === 'id' || !(sku.has(to) || shelf.has(to))) {
      if (noteOnce) noteOnce('KEEP_UNKNOWN', `keep: "${raw}" אינו שם של מאפיין — לא נקרא`);
      continue;
    }
    if (!out.includes(to)) out.push(to);
  }
  return out;
}

/** Is there a store document in this text at all? */
function isStoreBent(text) {
  return /<\s*bent-(store|sku)\b/i.test(String(text || ''));
}

/**
 * Parse a reply / file / paste into a store document.
 *
 * `{ trusted: true }` is for text the store wrote itself — a backup it is
 * about to put back, its own export, the document a CSV import was turned
 * into. The ceilings (MAX_CHARS, MAX_PRODUCTS, one tag's BODY_MAX) exist to
 * bound what a stranger can paste; applied to the store's own words they
 * refused a 450-product backup and hid a product with twelve pictures.
 * @returns {{ doc: object|null, notes: Array<{code,message}>, errors: Array<{code,message}> }}
 */
function parseStoreDoc(input, opts = {}) {
  const trusted = !!(opts && opts.trusted);
  const notes = [];
  const errors = [];
  let text = String(input == null ? '' : input);
  if (!trusted && text.length > MAX_CHARS) {
    return { doc: null, notes, errors: [{ code: 'REPLY_TOO_LONG', message: 'הטקסט ארוך מדי — הדביקו רק את מסמך <bent-store>' }] };
  }
  // a chat writes “curly” delimiters; the store never did — so its own text
  // is left alone (a title that holds a “quoted” word must come back as typed)
  if (!trusted && /[“”„‟″«»‘’‚‛′]/.test(text)) {
    const straight = straightenQuotes(text);
    if (straight !== text) { notes.push({ code: 'CURLY_QUOTES', message: 'מירכאות מסולסלות תוקנו' }); text = straight; }
  }
  const tokens = tokenize(text, { trusted });
  const known = (t) => TAG_ALIASES[t.tag];
  const storeTags = tokens.filter((t) => t.tag && known(t));
  const hasSku = storeTags.some((t) => TAG_ALIASES[t.tag] === 'bent-sku' && !t.close);
  const realRoot = storeTags.some((t) => t.tag === 'bent-store' && !t.close);

  if (!realRoot && !hasSku) {
    if (/<\s*bent-menus\b/i.test(text)) return { doc: null, notes, errors: [{ code: 'MENU_NOT_STORE', message: 'זה מסמך תפריטים — הדביקו אותו במסדר התפריטים' }] };
    if (/<\s*bent-theme\b/i.test(text)) return { doc: null, notes, errors: [{ code: 'THEME_NOT_STORE', message: 'זו ערכת נושא — הדביקו אותה בסטודיו' }] };
    if (/<!doctype|<\s*bent-(hero|section|heading|text|columns)\b/i.test(text)) {
      return { doc: null, notes, errors: [{ code: 'PAGE_NOT_STORE', message: 'זה דף, לא חנות — הדביקו אותו בבונה הדפים' }] };
    }
    return { doc: null, notes, errors: [{ code: 'NO_STORE', message: 'לא נמצא מסמך <bent-store> בטקסט' }] };
  }
  if (!realRoot) notes.push({ code: 'NO_WRAPPER', message: 'אין תגית <bent-store> עוטפת — המוצרים נקראו ויתווספו/יעודכנו בלבד (שום מוצר לא יוסתר)' });

  const doc = {
    version: VERSION, name: '', currency: '', note: '', mode: 'replace', keep: [],
    rules: null, shelves: [], products: [], shipping: null, payments: null, coupons: null
  };
  let rootSeen = 0;
  let sku = null; // the product whose body we are inside
  let pay = null; // the payment whose body we are inside
  const noted = new Set();
  const noteOnce = (code, message) => {
    if (noted.has(code + message)) return;
    noted.add(code + message);
    notes.push({ code, message });
  };
  const noteAlias = (from, to) => { if (from !== to) noteOnce('TAG_ALIAS', `<${from}> נקרא כ-<${to}>`); };
  const endSku = (p) => {
    p.description = cleanBody(p.__text.join(''));
    delete p.__text;
    if (p.description) p.__has.add('description');
  };
  const closeSku = () => {
    if (sku) { endSku(sku); sku = null; }
  };
  // "true" / "false" for a switch the tag carried (a bare `featured` is on), '' when it did not
  const onOff = (v) => (v === undefined ? '' : (flag(v, String(v).trim() === '') ? 'true' : 'false'));
  const closePay = () => {
    if (pay) { const b = cleanBody(pay.__text.join('')); if (b && !pay.details) pay.details = b; delete pay.__text; pay = null; }
  };

  for (const t of tokens) {
    if (t.text !== undefined) {
      if (pay) pay.__text.push(t.text);
      else if (sku) sku.__text.push(t.text);
      continue;
    }
    if (t.skipped !== undefined) {
      // one of OUR tags that could not be read is said out loud: in a
      // whole-catalog document a product nobody read is a product hidden
      if (TAG_ALIASES[t.skipped]) {
        noteOnce('TAG_SKIPPED', `תגית <${t.skipped}> לא נקראה — היא לא נסגרה, ארוכה מדי, או שערך במירכאות נשבר לשורה חדשה`);
      }
      continue;
    }
    const tag = TAG_ALIASES[t.tag];
    if (!tag) {
      // unknown tags inside a body are kept as text (a description may say "<3")
      continue;
    }
    noteAlias(t.tag, tag);
    if (t.close) {
      if (tag === 'bent-sku') closeSku();
      else if (tag === 'bent-pay') closePay();
      else if (tag === 'bent-store') { closePay(); closeSku(); }
      continue;
    }
    const a = canon(tag, t.attrs, noteOnce);
    switch (tag) {
      case 'bent-store':
        rootSeen++;
        if (rootSeen > 1) { notes.push({ code: 'SEVERAL_DOCUMENTS', message: 'נמצאו כמה מסמכי <bent-store> — אוחדו למסמך אחד' }); break; }
        doc.name = String(a.name || '').trim();
        doc.currency = String(a.currency || '').trim().toUpperCase();
        doc.note = String(a.note || '').trim();
        if (a.mode === 'merge' || a.mode === 'add') doc.mode = 'merge';
        doc.keep = keepNames(a.keep, noteOnce);
        if (parseInt(a.version, 10) > VERSION) {
          notes.push({ code: 'VERSION_NEWER', message: `המסמך נכתב בגרסה ${parseInt(a.version, 10)} של השפה — מה שהגרסה הזו (${VERSION}) אינה מכירה לא ייקרא` });
        }
        break;
      case 'bent-store-rules':
        doc.rules = { ...(doc.rules || {}), ...a };
        break;
      case 'bent-shelf':
        doc.shelves.push(markPresent({
          id: String(a.id || '').trim(),
          label: String(a.label || '').trim(),
          parent: String(a.parent || '').trim(),
          image: String(a.image || '').trim(),
          summary: String(a.summary || '').trim(),
          hidden: onOff(a.hidden),
          seoTitle: String(a['seo-title'] || '').trim(),
          seoDescription: String(a['seo-description'] || '').trim()
        }, Object.keys(a)));
        break;
      case 'bent-sku': {
        closePay();
        if (sku) { notes.push({ code: 'UNCLOSED_SKU', message: `מוצר "${sku.title || sku.id}" לא נסגר — נסגר אוטומטית` }); closeSku(); }
        const p = markPresent({
          id: String(a.id || '').trim(),
          title: String(a.title || '').trim(),
          price: a.price !== undefined ? String(a.price).trim() : '',
          was: a.was !== undefined ? String(a.was).trim() : '',
          stock: a.stock !== undefined ? String(a.stock).trim() : '',
          shelf: String(a.shelf || '').trim(),
          brand: String(a.brand || '').trim(),
          tags: tagList(a.tags),
          featured: onOff(a.featured),
          barcode: String(a.barcode || '').trim(),
          weight: a.weight !== undefined ? String(a.weight).trim() : '',
          image: String(a.image || '').trim(),
          images: String(a.images || '').trim(),
          badge: String(a.badge || '').trim(),
          status: String(a.status || '').trim().toLowerCase(),
          summary: String(a.summary || '').trim(),
          delivery: a.delivery !== undefined ? String(a.delivery).trim().toLowerCase() : '',
          max: a.max !== undefined ? String(a.max).trim() : '',
          seoTitle: String(a['seo-title'] || '').trim(),
          seoDescription: String(a['seo-description'] || '').trim(),
          description: '',
          variants: [],
          __text: a.description ? [a.description] : []
        }, Object.keys(a));
        doc.products.push(p);
        if (!t.self) sku = p; else endSku(p);
        break;
      }
      case 'bent-variant': {
        const v = markPresent({
          id: String(a.id || '').trim(),
          label: String(a.label || '').trim(),
          price: a.price !== undefined ? String(a.price).trim() : '',
          stock: a.stock !== undefined ? String(a.stock).trim() : ''
        }, Object.keys(a));
        if (sku) sku.variants.push(v);
        else notes.push({ code: 'ORPHAN_VARIANT', message: `אפשרות "${v.label || v.id}" מחוץ למוצר — דולגה` });
        break;
      }
      case 'bent-ship':
        closePay();
        doc.shipping = doc.shipping || [];
        doc.shipping.push({
          id: String(a.id || '').trim(),
          label: String(a.label || '').trim(),
          price: a.price !== undefined ? String(a.price).trim() : '0',
          freeOver: a['free-over'] !== undefined ? String(a['free-over']).trim() : '',
          address: a.address !== undefined ? String(a.address).trim().toLowerCase() : '',
          note: String(a.note || '').trim()
        });
        break;
      case 'bent-pay': {
        closePay();
        doc.payments = doc.payments || [];
        const pm = {
          id: String(a.id || '').trim(),
          kind: String(a.kind || '').trim().toLowerCase(),
          label: String(a.label || '').trim(),
          details: String(a.details || '').trim(),
          phone: String(a.phone || '').trim(),
          url: String(a.url || '').trim(),
          // a card method's installments (kind="card"); provider, mode and keys are never in a document
          maxPayments: a['max-payments'] !== undefined ? String(a['max-payments']).trim() : '',
          __text: []
        };
        doc.payments.push(pm);
        if (!t.self) pay = pm; else delete pm.__text;
        break;
      }
      case 'bent-coupon':
        doc.coupons = doc.coupons || [];
        doc.coupons.push({
          code: String(a.code || '').trim(),
          percent: a.percent !== undefined ? String(a.percent).trim() : '',
          amount: a.amount !== undefined ? String(a.amount).trim() : '',
          freeShipping: a['free-shipping'] !== undefined ? String(a['free-shipping']).trim().toLowerCase() : '',
          min: a.min !== undefined ? String(a.min).trim() : '',
          starts: String(a.starts || '').trim(),
          until: String(a.until || '').trim(),
          uses: a.uses !== undefined ? String(a.uses).trim() : '',
          active: a.active !== undefined ? String(a.active).trim().toLowerCase() : '',
          note: String(a.note || '').trim()
        });
        break;
      default:
        break;
    }
  }
  closePay();
  if (sku) { notes.push({ code: 'UNCLOSED_SKU', message: `מוצר "${sku.title || sku.id}" לא נסגר — נסגר אוטומטית` }); closeSku(); }
  for (const pm of doc.payments || []) delete pm.__text;
  // a fragment (no <bent-store> around it) can add and update — never hide
  // the products it does not mention
  if (!realRoot) doc.mode = 'merge';

  if (!trusted && doc.products.length > MAX_PRODUCTS) {
    errors.push({ code: 'TOO_MANY_PRODUCTS', message: `יותר מ-${MAX_PRODUCTS} מוצרים במסמך אחד — פצלו אותו` });
  }
  return { doc: errors.length ? null : doc, notes, errors };
}

// ── serialize ──────────────────────────────────────────────────────────

/** An attribute is written when it has a value — or when the object says it carries it (see markPresent). */
function attrList(pairs, has) {
  return pairs.filter(([k, v]) => (v !== undefined && v !== null && v !== '') || (has && has(k)))
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
}

function hasOf(obj) {
  const set = obj && obj.__has;
  return set instanceof Set ? (k) => set.has(k) : null;
}

function bodyLines(text, pad) {
  return String(text || '').split('\n').map((l) => (l ? pad + escText(l) : '')).join('\n');
}

/**
 * A store state → its document. The input is the MAJOR-unit shape
 * src/store/document.js builds from the database (prices as "89.90").
 * @param {{ name, currency, rules, shelves, products, shipping, payments, coupons, note? }} st
 */
function serializeStore(st) {
  const s = st || {};
  const out = [];
  out.push(`<bent-store${attrList([
    ['version', String(VERSION)], ['name', s.name], ['currency', s.currency], ['note', s.note],
    ['mode', s.mode === 'merge' ? 'merge' : ''], ['keep', keepNames(s.keep).join(',')]
  ])}>`);
  if (s.rules) {
    // the store's state names a rule vatIncluded; a PARSED document holds the
    // attribute as written (vat-included) — both are read, so a parsed
    // document serializes back to itself, rules included
    const r = s.rules;
    const rule = (name, attr) => (r[name] !== undefined ? r[name] : r[attr]);
    out.push(`  <bent-store-rules${attrList([
      ['vat', r.vat], ['vat-included', rule('vatIncluded', 'vat-included')], ['vat-exempt', rule('vatExempt', 'vat-exempt')],
      ['min-order', rule('minOrder', 'min-order')], ['low-stock', rule('lowStock', 'low-stock')],
      ['order-start', rule('orderStart', 'order-start')], ['require-email', rule('requireEmail', 'require-email')],
      ['terms', r.terms], ['thanks', r.thanks]
    ])} />`);
  }
  // Only what is not the default is written (a clean page to read and to
  // hand an AI) — unless the object says it CARRIES the attribute: then the
  // default is written too, which is how a merge document clears a field.
  for (const sh of s.shelves || []) {
    const has = hasOf(sh);
    out.push(`  <bent-shelf${attrList([
      ['id', sh.id], ['label', sh.label], ['parent', sh.parent], ['image', sh.image], ['summary', sh.summary],
      ['hidden', flag(sh.hidden, false) ? 'true' : (has && has('hidden') ? 'false' : '')],
      ['seo-title', sh.seoTitle], ['seo-description', sh.seoDescription]
    ], has)} />`);
  }
  for (const p of s.products || []) {
    const has = hasOf(p);
    const said = (k) => !!(has && has(k));
    const head = `  <bent-sku${attrList([
      ['id', p.id], ['title', p.title], ['price', p.price], ['was', p.was], ['stock', p.stock],
      ['shelf', p.shelf], ['status', p.status && p.status !== 'active' ? p.status : (said('status') ? 'active' : '')],
      ['brand', p.brand], ['tags', tagList(p.tags)],
      ['featured', flag(p.featured, false) ? 'true' : (said('featured') ? 'false' : '')],
      ['barcode', p.barcode], ['weight', p.weight],
      ['image', p.image], ['images', p.images], ['badge', p.badge], ['summary', p.summary],
      ['delivery', flag(p.delivery, true) ? (said('delivery') ? 'true' : '') : 'false'], ['max', p.max],
      ['seo-title', p.seoTitle], ['seo-description', p.seoDescription]
    ], has)}` + (!p.description && said('description') ? ' description=""' : '');
    const variants = (p.variants || []).map((v) => `    <bent-variant${attrList([['id', v.id], ['label', v.label], ['price', v.price], ['stock', v.stock]], hasOf(v))} />`);
    if (!p.description && !variants.length) { out.push(head + ' />'); continue; }
    out.push(head + '>');
    if (p.description) out.push(bodyLines(p.description, '    '));
    for (const v of variants) out.push(v);
    out.push('  </bent-sku>');
  }
  for (const m of s.shipping || []) {
    out.push(`  <bent-ship${attrList([
      ['id', m.id], ['label', m.label], ['price', m.price], ['free-over', m.freeOver],
      ['address', m.address === 'false' || m.address === false ? 'false' : ''], ['note', m.note]
    ])} />`);
  }
  for (const m of s.payments || []) {
    const head = `  <bent-pay${attrList([['id', m.id], ['kind', m.kind], ['label', m.label], ['phone', m.phone], ['url', m.url], ['max-payments', m.maxPayments]])}`;
    if (!m.details) out.push(head + ' />');
    else if (!m.details.includes('\n')) out.push(head + '>' + escText(m.details) + '</bent-pay>');
    else out.push(head + '>\n' + bodyLines(m.details, '    ') + '\n  </bent-pay>');
  }
  for (const c of s.coupons || []) {
    out.push(`  <bent-coupon${attrList([
      ['code', c.code], ['percent', c.percent], ['amount', c.amount], ['free-shipping', c.freeShipping],
      ['min', c.min], ['starts', c.starts], ['until', c.until], ['uses', c.uses],
      ['active', c.active === 'false' || c.active === false ? 'false' : ''], ['note', c.note]
    ])} />`);
  }
  out.push('</bent-store>');
  return out.join('\n') + '\n';
}

module.exports = {
  VERSION,
  MAX_CHARS,
  MAX_PRODUCTS,
  BODY_MAX,
  TAG_ALIASES,
  KNOWN_ATTRS,
  isStoreBent,
  parseStoreDoc,
  serializeStore,
  keepNames,
  markPresent,
  tokenize,
  cleanBody
};
