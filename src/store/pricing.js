'use strict';

/**
 * The quote — the ONE place a cart becomes money.
 *
 * The browser only ever holds identifiers and quantities (sku, variant,
 * qty). Every price, line total, shipping fee, discount and VAT line a
 * shopper sees comes from here, computed from the database as it is right
 * now — the cart page, the checkout summary and the order itself all call
 * quote(), so a price edited in the admin (or a price tampered with in a
 * browser) can never be what an order is charged at.
 *
 * Issues are sentences a shopper can act on ("נשארו 2 במלאי — עדכנו את
 * הכמות"); `blocking` lists what stands between this cart and an order.
 */

const money = require('./money');
const catalog = require('./catalog');
const coupons = require('./coupons');
const settingsMod = require('./settings');

const MAX_LINES = 50;

const BLOCKING = new Set(['EMPTY', 'MIN_ORDER', 'SHIPPING_REQUIRED', 'PAYMENT_REQUIRED', 'CLOSED']);
// what placing an order refuses on top of BLOCKING — the cart changed under
// the shopper, and they must see the new cart before they are charged for it
const CHANGED = new Set(['GONE', 'SOLD_OUT', 'STOCK_LIMIT', 'QTY_LIMIT', 'VARIANT_REQUIRED', 'VARIANT_GONE']);

function cleanItems(items) {
  const merged = new Map();
  for (const raw of Array.isArray(items) ? items.slice(0, 200) : []) {
    if (!raw || typeof raw !== 'object') continue;
    const sku = String(raw.sku || '').trim().toLowerCase().slice(0, 80);
    if (!sku) continue;
    const variant = String(raw.variant || '').trim().toLowerCase().slice(0, 40);
    const qty = Math.min(Math.max(parseInt(raw.qty, 10) || 0, 0), catalog.MAX_QTY);
    if (!qty) continue;
    const key = sku + '|' + variant;
    const prev = merged.get(key);
    merged.set(key, { sku, variant, qty: Math.min((prev ? prev.qty : 0) + qty, catalog.MAX_QTY) });
    if (merged.size >= MAX_LINES) break;
  }
  return [...merged.values()];
}

/**
 * @param {{ items:Array<{sku:string, variant?:string, qty:number}>, shipping?:string, coupon?:string, payment?:string }} input
 * @param {{ settings?:object, urlFor?:(sku:string)=>string, now?:Date }} [opts]
 */
function quote(input = {}, opts = {}) {
  const s = opts.settings || settingsMod.loadSettings();
  const cur = s.currency;
  const fmt = (n) => money.formatMoney(n, cur);
  const urlFor = typeof opts.urlFor === 'function' ? opts.urlFor : () => '';
  const issues = [];
  const lines = [];

  // resolve first, then merge by what the item REALLY is: a product without
  // options that arrives twice under stray variant codes is one line, or two
  // lines could each pass the stock check and together oversell it
  const resolved = new Map();
  for (const item of cleanItems(input.items)) {
    const p = catalog.getProduct(item.sku);
    if (!p || p.status !== 'active') {
      issues.push({ sku: item.sku, variant: item.variant, code: 'GONE', message: 'מוצר שהיה בעגלה כבר לא זמין והוסר ממנה' });
      continue;
    }
    let variant = null;
    if (p.variants.length) {
      if (!item.variant) {
        issues.push({ sku: p.slug, variant: '', code: 'VARIANT_REQUIRED', message: `יש לבחור אפשרות עבור "${p.title}"` });
        continue;
      }
      variant = p.variants.find((v) => v.code === item.variant) || null;
      if (!variant) {
        issues.push({ sku: p.slug, variant: item.variant, code: 'VARIANT_GONE', message: `האפשרות שנבחרה ל-"${p.title}" כבר לא קיימת` });
        continue;
      }
    }
    const key = p.slug + '|' + (variant ? variant.code : '');
    const prev = resolved.get(key);
    resolved.set(key, { p, variant, qty: Math.min((prev ? prev.qty : 0) + item.qty, catalog.MAX_QTY) });
  }

  for (const item of resolved.values()) {
    const { p, variant } = item;
    const stock = variant ? variant.stock : p.stock;
    const name = p.title + (variant ? ' — ' + variant.label : '');
    let qty = item.qty;
    if (stock !== null && stock !== undefined && stock <= 0) {
      issues.push({ sku: p.slug, variant: variant ? variant.code : '', code: 'SOLD_OUT', message: `"${name}" אזל מהמלאי והוסר מהעגלה` });
      continue;
    }
    if (stock !== null && stock !== undefined && qty > stock) {
      issues.push({ sku: p.slug, variant: variant ? variant.code : '', code: 'STOCK_LIMIT', message: `נשארו ${stock} יחידות של "${name}" — הכמות עודכנה` });
      qty = stock;
    }
    if (p.maxPerOrder && qty > p.maxPerOrder) {
      issues.push({ sku: p.slug, variant: variant ? variant.code : '', code: 'QTY_LIMIT', message: `אפשר להזמין עד ${p.maxPerOrder} יחידות של "${p.title}" בהזמנה` });
      qty = p.maxPerOrder;
    }
    const unit = variant && variant.price !== null && variant.price !== undefined ? variant.price : p.price;
    const maxQty = Math.min(p.maxPerOrder || catalog.MAX_QTY, stock === null || stock === undefined ? catalog.MAX_QTY : stock);
    lines.push({
      productId: p.id,
      sku: p.slug,
      variant: variant ? variant.code : '',
      variantLabel: variant ? variant.label : '',
      title: p.title,
      image: p.images[0] || '',
      url: urlFor(p.slug) || '',
      unit,
      unitText: fmt(unit),
      qty,
      maxQty,
      total: unit * qty,
      totalText: fmt(unit * qty),
      delivery: p.delivery
    });
  }

  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const count = lines.reduce((a, l) => a + l.qty, 0);

  // coupon — evaluated on the subtotal; a code that does not apply is said, never blocking
  let couponResult = null;
  let discount = 0;
  let freeShipping = false;
  if (input.coupon) {
    const ev = coupons.evaluate(input.coupon, { subtotal, currency: cur, now: opts.now });
    couponResult = { code: ev.code, ok: ev.ok, message: ev.message || (ev.ok ? '' : 'הקוד אינו בתוקף') };
    if (ev.ok) { discount = ev.discount; freeShipping = ev.freeShipping; }
  }
  const afterDiscount = Math.max(0, subtotal - discount);

  // shipping — only when something in the cart travels
  const needsShipping = lines.some((l) => l.delivery);
  const shippingOptions = needsShipping ? s.shipping.map((m) => {
    const free = freeShipping || (m.freeOver !== null && m.freeOver !== undefined && afterDiscount >= m.freeOver);
    const price = free ? 0 : m.price;
    return {
      id: m.id, label: m.label, price, priceText: price ? fmt(price) : 'חינם',
      free: free && m.price > 0, address: !!m.address, note: m.note || '',
      freeOver: m.freeOver, freeOverText: m.freeOver ? fmt(m.freeOver) : ''
    };
  }) : [];
  let shippingMethod = '';
  if (needsShipping) {
    const want = String(input.shipping || '');
    const hit = shippingOptions.find((o) => o.id === want);
    if (hit) shippingMethod = hit.id;
    else if (shippingOptions.length === 1) shippingMethod = shippingOptions[0].id;
  }
  const chosen = shippingOptions.find((o) => o.id === shippingMethod) || null;
  const shipping = chosen ? chosen.price : 0;

  // VAT — Israel's retail default is VAT-inclusive prices
  const vatRate = s.vatExempt ? 0 : s.vatRate;
  const net = afterDiscount + shipping;
  let total;
  let vat;
  if (!vatRate) { total = net; vat = 0; }
  else if (s.pricesIncludeVat) { total = net; vat = money.vatInside(net, vatRate); }
  else { vat = money.vatOnTop(net, vatRate); total = net + vat; }

  const payments = s.payments.map((p) => ({ id: p.id, kind: p.kind, label: p.label, details: p.details, phone: p.phone }));
  let payment = '';
  const wantPay = String(input.payment || '');
  if (payments.some((p) => p.id === wantPay)) payment = wantPay;
  else if (payments.length === 1) payment = payments[0].id;

  const blocking = [];
  if (!lines.length) blocking.push('EMPTY');
  if (lines.length && s.minOrder && subtotal < s.minOrder) {
    blocking.push('MIN_ORDER');
    issues.push({ sku: '', variant: '', code: 'MIN_ORDER', message: 'הזמנת מינימום: ' + fmt(s.minOrder) });
  }
  if (lines.length && needsShipping && !shippingMethod) blocking.push('SHIPPING_REQUIRED');
  if (lines.length && !payment) blocking.push('PAYMENT_REQUIRED');
  if (!s.open) blocking.push('CLOSED');

  return {
    ok: blocking.length === 0,
    open: !!s.open,
    currency: cur,
    lines,
    issues,
    blocking,
    changed: issues.some((i) => CHANGED.has(i.code)),
    count,
    subtotal, subtotalText: fmt(subtotal),
    discount, discountText: discount ? '-' + fmt(discount) : '',
    coupon: couponResult,
    freeShipping,
    needsShipping,
    shippingOptions,
    shippingMethod,
    shipping, shippingText: needsShipping ? (chosen ? (shipping ? fmt(shipping) : 'חינם') : '—') : '',
    vatRate,
    vatIncluded: !!s.pricesIncludeVat,
    vatExempt: !!s.vatExempt,
    vat, vatText: vat ? fmt(vat) : '',
    total, totalText: fmt(total),
    payments,
    payment,
    minOrder: s.minOrder,
    minOrderText: s.minOrder ? fmt(s.minOrder) : ''
  };
}

/** The shopper-facing shape (no product ids). */
function publicQuote(q) {
  return { ...q, lines: q.lines.map(({ productId, ...rest }) => rest) };
}

module.exports = { quote, publicQuote, cleanItems, BLOCKING, CHANGED };
