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
  'kind של תשלום: call | bank | bit | paybox | cash | link | card (ל-link: url="https://…?sum={total}&ref={order}"; card = סליקה בכרטיס אשראי דרך חברת הסליקה שהבעלים חיבר/ה — אפשר max-payments="3" לתשלומים, ובלי מפתחות או שם חברה במסמך) ·',
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
  'Payment kinds: call | bank | bit | paybox | cash | link (url="https://…?sum={total}&ref={order}") | card (the owner\'s connected card gateway; optional max-payments="3"; never any key or provider name in the document).',
  'Rules: an existing product keeps its exact id; a full <bent-store> is the whole catalog (a product left out is hidden) — use mode="merge" to only add/update;',
  'never invent prices, stock, payment details or image paths; prices are plain decimals ("24.90").'
];

function mediaLines(ctx, max) {
  const media = (ctx && Array.isArray(ctx.media) ? ctx.media : []).slice(0, max);
  if (!media.length) return ['(אין תמונות בספריית המדיה — מוצרים יהיו בלי תמונה עד שיעלו)'];
  return media.map((m) => '- ' + m.url + (m.alt ? '  (' + m.alt + ')' : ''));
}

/** The store today, trimmed to fit a budget: descriptions go first, then product lines from the bottom. */
function storeToday(budget) {
  const doc = store().document;
  let text = doc.exportDocument();
  if (text.length <= budget) return { text, trimmed: [] };
  const st = doc.currentState();
  st.products = st.products.map((p) => ({ ...p, description: '' }));
  text = dialect.serializeStore(st);
  const trimmed = ['descriptions'];
  while (text.length > budget && st.products.length > 3) {
    st.products.pop();
    text = dialect.serializeStore(st);
    if (trimmed[trimmed.length - 1] !== 'products') trimmed.push('products');
  }
  return { text, trimmed };
}

function buildPrompt({ brief = '', size = 'lite', locale = 'he', ctx } = {}) {
  const budget = size === 'full' ? descriptor.budget.full : descriptor.budget.lite;
  const he = locale !== 'en';
  const head = (he ? GRAMMAR_HE : GRAMMAR_EN).join('\n');
  const wish = String(brief || '').trim().slice(0, size === 'full' ? 5000 : 2500) ||
    (he ? '(אין בקשה מיוחדת — סדרו וטייבו את הקטלוג הקיים: כותרות ברורות, תקצירים קצרים, מדפים הגיוניים. לא לשנות מחירים.)'
      : '(No specific request — tidy the existing catalog: clear titles, short summaries, sensible shelves. Do not change prices.)');
  const media = mediaLines(ctx, size === 'full' ? 60 : 25).join('\n');
  const fixed = head.length + wish.length + media.length + 200;
  const today = storeToday(Math.max(1200, budget - fixed));
  const text = [
    head,
    '',
    he ? '── החנות היום ──' : '── The store today ──',
    today.text.trim(),
    '',
    he ? '── תמונות באתר ──' : '── Pictures on the site ──',
    media,
    '',
    he ? '── מה הבעלים ביקש/ה ──' : '── What the owner asked ──',
    wish,
    '',
    he ? 'החזירו עכשיו את מסמך <bent-store> בלבד.' : 'Now return the <bent-store> document only.'
  ].join('\n');
  return { text, chars: text.length, meta: { degraded: today.trimmed, budget } };
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

  hardCodes: ['PRODUCT_INVALID', 'EMPTY_STORE', 'MANY_HIDDEN', 'COUPON_INVALID', 'SETTINGS', 'CURRENCY_CHANGE'],

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
