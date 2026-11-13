'use strict';

/**
 * The store's catalog writer (v2.53) — an injection pack: the owner hands
 * their OWN AI a price list, a pile of product notes or a wish ("add the
 * winter collection, 10% off candles until Friday"), and gets back a
 * <bent-store> document. The reply goes through exactly the door a pasted
 * document does (src/store/document.js): preview first, apply on a second
 * click, the store as it stood backed up — as BenTML — before anything
 * changes, and undo one click away.
 *
 * The prompt carries "the store today" so the model EDITS instead of
 * rebuilding (every existing product keeps its id), and the site's real
 * pictures so it never invents an image path.
 *
 * v2.69 — a store that does not fit the prompt is shown as a PARTIAL view,
 * and says so in the one place a model copies from: the root tag. The view
 * is rooted <bent-store mode="merge" keep="description,…"> (the attributes
 * it left out), so a reply that echoes it changes nothing — it used to
 * blank every description, and hide the products the view had no room for.
 * Three nets, one under the other: the root, a line that says "return only
 * what you change", and the door's own BLANKED warning (src/store/document.js)
 * for a reply that ignored both.
 */

const dialect = require('../bentml/store-dialect');

function store() {
  return require('../store');
}

const GRAMMAR_HE = [
  'את/ה כותב/ת קטלוג לחנות באתר Tapuziel. מחזירים מסמך BenTML אחד בלבד — <bent-store>…</bent-store> — בלי הסבר לפניו או אחריו.',
  '',
  'הדקדוק (כל תג נסגר: <bent-x …/> או <bent-x …>…</bent-x>):',
  '<bent-store version="1" name="שם החנות" currency="ILS">',
  '  <bent-shelf id="candles" label="נרות" />',
  '  <bent-sku id="lavender-candle" title="נר לבנדר" price="89.90" shelf="candles" summary="שורה אחת" was="120" stock="12" badge="מבצע" image="/assets/x.webp">',
  '    תיאור המוצר. שורה ריקה = פסקה חדשה.',
  '    <bent-variant id="small" label="קטן" price="69.90" stock="5" />',
  '  </bent-sku>',
  '  <bent-ship id="pickup" label="איסוף עצמי" price="0" address="false" />',
  '  <bent-ship id="delivery" label="משלוח עד הבית" price="30" free-over="300" />',
  '  <bent-pay id="bank" kind="bank" label="העברה בנקאית">פרטי החשבון</bent-pay>',
  '  <bent-coupon code="WELCOME10" percent="10" min="100" until="2026-12-31" />',
  '</bent-store>',
  '',
  'שדות: price/was/min/free-over בשקלים עם נקודה ("89.90", בלי ₪ ובלי פסיקים) · was = מחיר לפני (גבוה מ-price) ·',
  'stock = כמה במלאי (unlimited = בלי ספירה; להשמיט = בלי שינוי) · status="hidden" מסתיר · delivery="false" למוצר דיגיטלי/שירות ·',
  'מוצר, רשות: brand · tags="סויה, מתנה" · featured="true" (מומלץ) · barcode · weight (גרם) · seo-title · seo-description · אין cost: מחיר עלות לא נכתב במסמך ·',
  'קטגוריה, רשות: parent="candles" (תת-קטגוריה, רמה אחת) · image · summary · hidden="true" ·',
  'kind של תשלום: call | bank | bit | paybox | cash | link | card | paypal | demo (ל-link: url="https://…?sum={total}&ref={order}"; card = סליקה בכרטיס אשראי דרך חברת הסליקה שהבעלים חיבר/ה — אפשר max-payments="3" לתשלומים, ובלי מפתחות או שם חברה במסמך; paypal = גם בלי מפתחות; demo = תשלום לדוגמה, רק באתר הדגמה) ·',
  'קופון: percent="10" או amount="20" או free-shipping="true"; אופציונלי min, starts, until (YYYY-MM-DD), uses.',
  '',
  'כללים:',
  '1. מוצר שכבר קיים שומר בדיוק את ה-id שלו מ"החנות היום". מוצר חדש מקבל id קצר חדש באנגלית קטנה ומקפים.',
  '2. מסמך עם <bent-store> הוא כל הקטלוג: מוצר שלא יופיע בו יוסתר מהאתר. כשמבקשים רק להוסיף או לעדכן כמה מוצרים — כתבו <bent-store mode="merge"> ורק אותם.',
  '3. לא להמציא: מחיר, מלאי, פרטי חשבון, טלפון או קישור תשלום שלא נמסרו — משאירים את מה שיש, או משמיטים את השדה.',
  '4. תמונות: רק כתובות מהרשימה "תמונות באתר". אין תמונה מתאימה — בלי image.',
  '5. עברית טבעית ומוכרת בכותרות ובתיאורים; בלי HTML אחר ובלי markdown בתוך המסמך.'
];

const GRAMMAR_EN = [
  'You write the catalog of a Tapuziel web store. Return ONE BenTML document — <bent-store>…</bent-store> — and nothing before or after it.',
  '',
  'Grammar (every tag closes: <bent-x …/> or <bent-x …>…</bent-x>):',
  '<bent-store version="1" name="Store name" currency="USD">',
  '  <bent-shelf id="candles" label="Candles" />',
  '  <bent-sku id="lavender-candle" title="Lavender candle" price="24.90" shelf="candles" summary="One line" was="30" stock="12">',
  '    Description. A blank line starts a new paragraph.',
  '    <bent-variant id="small" label="Small" price="19.90" stock="5" />',
  '  </bent-sku>',
  '  <bent-ship id="pickup" label="Pickup" price="0" address="false" />',
  '  <bent-pay id="bank" kind="bank" label="Bank transfer">Account details</bent-pay>',
  '  <bent-coupon code="WELCOME10" percent="10" min="50" until="2026-12-31" />',
  '</bent-store>',
  '',
  'Payment kinds: call | bank | bit | paybox | cash | link (url="https://…?sum={total}&ref={order}") | card (the owner\'s connected card gateway; optional max-payments="3"; never any key or provider name in the document) | paypal (no keys here either) | demo (offered on a demo site only).',
  'Optional — product: brand, tags="soy, gift", featured="true", barcode, weight (grams), seo-title, seo-description; there is no cost attribute. Shelf: parent="candles" (one level), image, summary, hidden="true".',
  'Rules: an existing product keeps its exact id; a full <bent-store> is the whole catalog (a product left out is hidden) — use mode="merge" to only add/update;',
  'never invent prices, stock, payment details or image paths; prices are plain decimals ("24.90").'
];

function mediaLines(ctx, max) {
  const media = (ctx && Array.isArray(ctx.media) ? ctx.media : []).slice(0, max);
  if (!media.length) return ['(אין תמונות בספריית המדיה — מוצרים יהיו בלי תמונה עד שיעלו)'];
  return media.map((m) => '- ' + m.url + (m.alt ? '  (' + m.alt + ')' : ''));
}

// What a view of the store can do without, one field at a time, cheapest
// loss first: [stage, the field as the store's state spells it, the
// attribute a tag spells it (what the root's keep="…" lists), and whether a
// category loses its field of that name too].
const TRIMS = [
  ['descriptions', 'description', 'description', false],
  ['details', 'seoDescription', 'seo-description', true],
  ['details', 'seoTitle', 'seo-title', true],
  ['details', 'images', 'images', false],
  ['details', 'barcode', 'barcode', false],
  ['details', 'weight', 'weight', false],
  ['summaries', 'image', 'image', true],
  ['summaries', 'badge', 'badge', false],
  ['summaries', 'tags', 'tags', false],
  ['summaries', 'brand', 'brand', false],
  ['summaries', 'summary', 'summary', true]
];

/**
 * The store today, to fit a budget. A store that fits is its own export:
 * the whole catalog under a whole-catalog root. One that does not becomes a
 * partial view — first without descriptions, then without the back-office
 * details, then field by field down to what a price list holds (id, title,
 * prices, stock, category, options), and only then without the last
 * products. EVERY product is worth a line before any product's summary is:
 * a model that cannot see that a product exists writes it again under a
 * new id.
 *
 * A partial view is rooted mode="merge" keep="<what it left out>", so the
 * text a model copies from is already a document that changes nothing. The
 * thank-you sentence goes with the descriptions and needs no keep: a rule a
 * document does not state is left alone in either mode.
 * @param {number} budget  characters the whole store may take
 * @param {number} [room]  characters a partial view may take (it shares the
 *                         prompt with the line that says it is partial)
 * @returns {{ text: string, trimmed: string[], keep: string[], shown: number, total: number }}
 */
function storeToday(budget, room = budget) {
  const doc = store().document;
  const whole = doc.exportDocument();
  const st = doc.currentState();
  const total = st.products.length;
  if (whole.length <= budget) return { text: whole, trimmed: [], keep: [], shown: total, total };
  st.mode = 'merge';
  st.keep = [];
  const trimmed = [];
  if (st.rules) st.rules.thanks = '';
  let text = whole;
  for (const [stage, key, attr, shelfToo] of TRIMS) {
    let had = false;
    for (const p of st.products) if (p[key]) { p[key] = ''; had = true; }
    if (shelfToo) for (const sh of st.shelves) if (sh[key]) { sh[key] = ''; had = true; }
    if (!had) continue;
    st.keep.push(attr);
    if (!trimmed.includes(stage)) trimmed.push(stage);
    text = dialect.serializeStore(st);
    if (text.length <= room) break;
  }
  if (text.length > room && st.products.length > 3) {
    trimmed.push('products');
    while (text.length > room && st.products.length > 3) {
      st.products.pop();
      text = dialect.serializeStore(st);
    }
  }
  return { text, trimmed, keep: st.keep.slice(), shown: st.products.length, total };
}

function buildPrompt({ brief = '', size = 'lite', locale = 'he', ctx } = {}) {
  const budget = size === 'full' ? descriptor.budget.full : descriptor.budget.lite;
  const he = locale !== 'en';
  const head = (he ? GRAMMAR_HE : GRAMMAR_EN).join('\n');
  const wish = String(brief || '').trim().slice(0, size === 'full' ? 5000 : 2500) ||
    (he ? '(אין בקשה מיוחדת — סדרו וטייבו את הקטלוג הקיים: כותרות ברורות, תקצירים קצרים, מדפים הגיוניים. לא לשנות מחירים.)'
      : '(No specific request — tidy the existing catalog: clear titles, short summaries, sensible shelves. Do not change prices.)');
  const media = mediaLines(ctx, size === 'full' ? 60 : 25).join('\n');
  // the one line a partial view adds: WHAT is missing is already in the
  // root's keep list, so the line only has to say what to send back
  const partialNote = (unseen) => (he
    ? 'תצוגה חלקית: השדות שב-keep לא מוצגים כאן (באתר הם קיימים)' + (unseen ? `, וגם ${unseen} מוצרים קיימים נוספים` : '') +
      '. החזירו את אותו תג פתיחה, ובתוכו רק מה שמוסיפים או משנים — כל מה שלא תכתבו נשאר כמו שהוא.'
    : 'Partial view: the fields listed in keep are not shown here (the store has them)' + (unseen ? `, and neither are ${unseen} more existing products` : '') +
      '. Return the same opening tag with only what you add or change inside it — whatever you leave out stays as it is.');
  // the prompt around the store view. The view gets exactly what the rest
  // leaves of the budget — measured, not estimated: every character of
  // slack is a product the model was not shown
  const frame = (view, partial, unseen) => [
    head,
    '',
    he ? '── החנות היום ──' : '── The store today ──',
    ...(partial ? [partialNote(unseen)] : []),
    view,
    '',
    he ? '── תמונות באתר ──' : '── Pictures on the site ──',
    media,
    '',
    he ? '── מה הבעלים ביקש/ה ──' : '── What the owner asked ──',
    wish,
    '',
    partial
      ? (he ? 'החזירו עכשיו את מסמך <bent-store mode="merge"> בלבד — רק מה שהשתנה.' : 'Now return the <bent-store mode="merge"> document only — just what changed.')
      : (he ? 'החזירו עכשיו את מסמך <bent-store> בלבד.' : 'Now return the <bent-store> document only.')
  ].join('\n');
  // a store never gets less than 1200 characters, however long the wish is;
  // 99999 = the longest the partial line can be
  const today = storeToday(Math.max(1200, budget - frame('', false, 0).length), Math.max(1200, budget - frame('', true, 99999).length));
  const text = frame(today.text.trim(), today.trimmed.length > 0, today.total - today.shown);
  return { text, chars: text.length, meta: { degraded: today.trimmed, keep: today.keep, shown: today.shown, products: today.total, budget } };
}

function previewOf(planned) {
  const p = planned.preview || {};
  const sections = [];
  for (const a of p.added || []) sections.push('+ ' + a.title + ' · ' + a.priceText);
  for (const c of p.changed || []) sections.push('± ' + c.title + ((c.fields && c.fields.length) ? ' — ' + c.fields.join(' · ') : ''));
  for (const h of p.hidden || []) sections.push('− ' + h.title + ' (יוסתר)');
  const counts = [];
  if ((p.added || []).length) counts.push(p.added.length + ' חדשים');
  if ((p.changed || []).length) counts.push(p.changed.length + ' משתנים');
  if ((p.hidden || []).length) counts.push(p.hidden.length + ' יוסתרו');
  if (p.unchanged) counts.push(p.unchanged + ' בלי שינוי');
  return {
    name: p.name ? '🛍 ' + p.name : '',
    note: (counts.join(' · ') || 'אין שינוי במוצרים') + (p.mode === 'merge' ? ' · הוספה ועדכון בלבד (merge)' : ''),
    sections: sections.slice(0, 40).concat(sections.length > 40 ? ['… ועוד ' + (sections.length - 40)] : []),
    knobs: { changed: (p.settings || []).map((line) => ({ key: 'הגדרה', from: '', to: line })) }
  };
}

function refusal(planned) {
  const first = (planned.errors || [])[0] || { code: 'BAD_REPLY', message: 'התשובה אינה מסמך <bent-store>' };
  const e = new Error(first.message);
  e.code = first.code;
  return e;
}

const descriptor = {
  id: 'store-catalog',
  kind: 'store-catalog',
  family: 'site',
  title: '🛍 כותב/ת הקטלוג',
  blurb: 'ה-AI שלכם מקבל את החנות כפי שהיא היום ומה שביקשתם — מחירון, רשימת מוצרים, מבצע — ומחזיר מסמך <bent-store>. רואים מה ישתנה, ורק אז מחילים (עם גיבוי).',
  budget: { lite: 9000, full: 16000 },
  // its prompt IS the store — payment details, coupon codes, drafts, exact
  // stock — and its preview is a diff against the live prices: the routes
  // (src/routes/inject.js) open this pack to a manager only, like every store screen
  adminOnly: true,

  buildPrompt,

  parse(reply) {
    const planned = store().document.planDocument(String(reply || ''));
    if (!planned.ok) throw refusal(planned);
    const warnings = (planned.warnings || []).map((w) => ({ code: w.code, message: w.message, hard: !!w.hard }));
    return {
      preview: previewOf(planned),
      warnings,
      warningTexts: warnings.map((w) => (w.hard ? '⚠ ' : '') + w.message),
      notes: planned.notes || [],
      hard: !!planned.hard
    };
  },

  apply(reply, ctx, { force = false } = {}) {
    const r = store().document.applyDocument(String(reply || ''), { force: !!force, reason: 'inject:store-catalog' });
    if (!r.ok) {
      if (r.code === 'NEEDS_CONFIRM') {
        const e = new Error('יש אזהרות קשות — אשרו החלה בכל זאת');
        e.code = 'HARD_WARNINGS';
        e.warnings = (r.warnings || []).filter((w) => w.hard);
        throw e;
      }
      const e = new Error(r.message || 'לא הוחל');
      e.code = r.code || 'BAD_REPLY';
      throw e;
    }
    return {
      landed: { type: 'store', id: 'catalog', url: '/admin/store/products' },
      backupId: r.backupId,
      changed: r.changed || {},
      rebuildError: r.rebuilt === false ? 'בניית האתר נכשלה — שמרו שוב מהחנות' : '',
      warnings: r.warnings || []
    };
  },

  undo() {
    const r = store().document.undoLast();
    if (!r.ok) {
      const e = new Error(r.message || 'אין מה לבטל');
      e.code = r.code || 'NO_BACKUP';
      throw e;
    }
    return { restored: r.restored };
  },

  run: {
    enabled: true,
    maxTokens: 6000,
    timeoutMs: { local: 300000, cloud: 120000 },
    repairable: ['NO_STORE', 'PAGE_NOT_STORE', 'NO_VALID_PRODUCTS', 'MENU_NOT_STORE', 'THEME_NOT_STORE']
  },

  hardCodes: ['PRODUCT_INVALID', 'EMPTY_STORE', 'MANY_HIDDEN', 'BLANKED', 'TAG_SKIPPED', 'COUPON_INVALID', 'SETTINGS', 'CURRENCY_CHANGE'],

  ui: {
    briefPlaceholder: 'למשל: הנה המחירון שלי (הדביקו) — צרו מוצר לכל שורה, עם מדפים. או: מבצע 15% על כל הנרות עד סוף החודש.',
    sizes: ['lite', 'full'],
    applyLabel: '✅ החלה על החנות',
    mount: ['/admin/store/bentml'],
    canApply: true,
    renderPreview(preview) {
      return require('./index').genericPreviewHtml(preview);
    }
  }
};

module.exports = descriptor;
