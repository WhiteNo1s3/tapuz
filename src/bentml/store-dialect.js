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
 */

const { straightenQuotes } = require('./theme-dialect');

const VERSION = 1;
const MAX_CHARS = 400000;
const MAX_PRODUCTS = 500;
const BODY_MAX = 4000;

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
    'max-per-order': 'max', maxperorder: 'max', picture: 'image', img: 'image'
  },
  'bent-variant': { code: 'id', sku: 'id', name: 'label', title: 'label', qty: 'stock', inventory: 'stock' },
  'bent-shelf': { slug: 'id', name: 'label', title: 'label' },
  'bent-ship': { name: 'label', title: 'label', 'free-from': 'free-over', freeover: 'free-over', free: 'free-over' },
  'bent-pay': { name: 'label', title: 'label', type: 'kind', link: 'url', href: 'url' },
  'bent-coupon': { name: 'code', id: 'code', from: 'starts', start: 'starts', 'starts-on': 'starts', to: 'until', 'ends-on': 'until', end: 'until', expires: 'until', 'max-uses': 'uses', limit: 'uses', 'min-subtotal': 'min' },
  'bent-store-rules': { 'vat-rate': 'vat', 'prices-include-vat': 'vat-included', exempt: 'vat-exempt' }
};

function escAttr(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escText(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function unesc(v) {
  return String(v == null ? '' : v)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function parseAttrs(body) {
  const out = {};
  const src = String(body || '').replace(/\/\s*$/, '');
  const re = /([A-Za-z][\w-]*)\s*(?:=\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'>]+)))?/g;
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
 */
const NAME_RE = /^[A-Za-z][\w-]*/;
function tokenize(src) {
  const s = String(src || '');
  const n = s.length;
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
    while (k < n) {
      const c = s.charCodeAt(k);
      if (q) {
        if (c === q) q = 0;
        else if (c === 10) break;
      } else if (c === 62) {
        const body = s.slice(bodyStart, k);
        if (lt > textFrom) out.push({ text: s.slice(textFrom, lt) });
        out.push({ tag: nm[0].toLowerCase(), close, self: /\/\s*$/.test(body), attrs: close ? {} : parseAttrs(body) });
        textFrom = k + 1;
        next = k + 1;
        break;
      } else if (c === 34 || c === 39) q = c;
      else if (c === 60) { next = k; break; }
      if (k - bodyStart >= BODY_MAX) break;
      k++;
    }
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
  const out = {};
  for (const [k0, v] of Object.entries(attrs)) {
    const k = k0.replace(/_/g, '-');
    const to = map[k] || map[k.replace(/-/g, '')] || k;
    if (to !== k0) noteOnce('ATTR_ALIAS', `<${tag}> ${k0} → ${to}`);
    if (out[to] === undefined) out[to] = v;
  }
  return out;
}

/** Is there a store document in this text at all? */
function isStoreBent(text) {
  return /<\s*bent-(store|sku)\b/i.test(String(text || ''));
}

/**
 * Parse a reply / file / paste into a store document.
 * @returns {{ doc: object|null, notes: Array<{code,message}>, errors: Array<{code,message}> }}
 */
function parseStoreDoc(input) {
  const notes = [];
  const errors = [];
  let text = String(input == null ? '' : input);
  if (text.length > MAX_CHARS) {
    return { doc: null, notes, errors: [{ code: 'REPLY_TOO_LONG', message: 'הטקסט ארוך מדי — הדביקו רק את מסמך <bent-store>' }] };
  }
  if (/[“”„‟″«»‘’‚‛′]/.test(text)) {
    const straight = straightenQuotes(text);
    if (straight !== text) { notes.push({ code: 'CURLY_QUOTES', message: 'מירכאות מסולסלות תוקנו' }); text = straight; }
  }
  const tokens = tokenize(text);
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
    version: VERSION, name: '', currency: '', note: '', mode: 'replace',
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
  const closeSku = () => {
    if (sku) { sku.description = cleanBody(sku.__text.join('')); delete sku.__text; sku = null; }
  };
  const closePay = () => {
    if (pay) { const b = cleanBody(pay.__text.join('')); if (b && !pay.details) pay.details = b; delete pay.__text; pay = null; }
  };

  for (const t of tokens) {
    if (t.text !== undefined) {
      if (pay) pay.__text.push(t.text);
      else if (sku) sku.__text.push(t.text);
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
        break;
      case 'bent-store-rules':
        doc.rules = { ...(doc.rules || {}), ...a };
        break;
      case 'bent-shelf':
        doc.shelves.push({ id: String(a.id || '').trim(), label: String(a.label || '').trim() });
        break;
      case 'bent-sku': {
        closePay();
        if (sku) { notes.push({ code: 'UNCLOSED_SKU', message: `מוצר "${sku.title || sku.id}" לא נסגר — נסגר אוטומטית` }); closeSku(); }
        const p = {
          id: String(a.id || '').trim(),
          title: String(a.title || '').trim(),
          price: a.price !== undefined ? String(a.price).trim() : '',
          was: a.was !== undefined ? String(a.was).trim() : '',
          stock: a.stock !== undefined ? String(a.stock).trim() : '',
          shelf: String(a.shelf || '').trim(),
          image: String(a.image || '').trim(),
          images: String(a.images || '').trim(),
          badge: String(a.badge || '').trim(),
          status: String(a.status || '').trim().toLowerCase(),
          summary: String(a.summary || '').trim(),
          delivery: a.delivery !== undefined ? String(a.delivery).trim().toLowerCase() : '',
          max: a.max !== undefined ? String(a.max).trim() : '',
          description: '',
          variants: [],
          __text: a.description ? [a.description] : []
        };
        doc.products.push(p);
        if (!t.self) sku = p; else { p.description = cleanBody(p.__text.join('')); delete p.__text; }
        break;
      }
      case 'bent-variant': {
        const v = {
          id: String(a.id || '').trim(),
          label: String(a.label || '').trim(),
          price: a.price !== undefined ? String(a.price).trim() : '',
          stock: a.stock !== undefined ? String(a.stock).trim() : ''
        };
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

  if (doc.products.length > MAX_PRODUCTS) {
    errors.push({ code: 'TOO_MANY_PRODUCTS', message: `יותר מ-${MAX_PRODUCTS} מוצרים במסמך אחד — פצלו אותו` });
  }
  return { doc: errors.length ? null : doc, notes, errors };
}

// ── serialize ──────────────────────────────────────────────────────────

function attrList(pairs) {
  return pairs.filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
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
  out.push(`<bent-store${attrList([['version', String(VERSION)], ['name', s.name], ['currency', s.currency], ['note', s.note]])}>`);
  if (s.rules) {
    const r = s.rules;
    out.push(`  <bent-store-rules${attrList([
      ['vat', r.vat], ['vat-included', r.vatIncluded], ['vat-exempt', r.vatExempt], ['min-order', r.minOrder],
      ['low-stock', r.lowStock], ['order-start', r.orderStart], ['require-email', r.requireEmail],
      ['terms', r.terms], ['thanks', r.thanks]
    ])} />`);
  }
  for (const sh of s.shelves || []) out.push(`  <bent-shelf${attrList([['id', sh.id], ['label', sh.label]])} />`);
  for (const p of s.products || []) {
    const head = `  <bent-sku${attrList([
      ['id', p.id], ['title', p.title], ['price', p.price], ['was', p.was], ['stock', p.stock],
      ['shelf', p.shelf], ['status', p.status && p.status !== 'active' ? p.status : ''],
      ['image', p.image], ['images', p.images], ['badge', p.badge], ['summary', p.summary],
      ['delivery', p.delivery === 'false' || p.delivery === false ? 'false' : ''], ['max', p.max]
    ])}`;
    const variants = (p.variants || []).map((v) => `    <bent-variant${attrList([['id', v.id], ['label', v.label], ['price', v.price], ['stock', v.stock]])} />`);
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
    const head = `  <bent-pay${attrList([['id', m.id], ['kind', m.kind], ['label', m.label], ['phone', m.phone], ['url', m.url]])}`;
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
  TAG_ALIASES,
  isStoreBent,
  parseStoreDoc,
  serializeStore,
  tokenize,
  cleanBody
};
