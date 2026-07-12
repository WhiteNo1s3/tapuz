'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  fromTapuzPage,
  toTapuzPage,
  serialize,
  parse,
  validate
} = require('../../src/pzn/index');

/**
 * v0.40 QA gate 1 — synthetic lossless round-trip for every Tapuz block type:
 *   Tapuz JSON → fromTapuzPage → serialize (.pzn) → parse → toTapuzPage → Tapuz JSON
 *
 * Lossless means: every meaningful field survives with an equal value.
 * Empty strings, nulls and undefined count as "absent" on both sides
 * (the bridge never carries emptiness). Numbers may come back as numbers
 * even if authored as numeric strings.
 */

// ─── canonical compare ──────────────────────────────────────────────

function isEmpty(v) {
  return v === undefined || v === null || v === '';
}

function normalizeScalar(v, key) {
  if (key === 'ratio' && Array.isArray(v)) return v.join(':');
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
}

function diff(a, b, path, out) {
  const an = isEmpty(a) ? undefined : a;
  const bn = isEmpty(b) ? undefined : b;
  if (an === undefined && bn === undefined) return;
  if (an === undefined || bn === undefined) {
    out.push(`${path}: ${JSON.stringify(an)} → ${JSON.stringify(bn)}`);
    return;
  }
  if (Array.isArray(an) || Array.isArray(bn)) {
    const aa = Array.isArray(an) ? an : [an];
    const ba = Array.isArray(bn) ? bn : [bn];
    if (path.endsWith('ratio')) {
      diff(normalizeScalar(an, 'ratio'), normalizeScalar(bn, 'ratio'), path, out);
      return;
    }
    if (aa.length !== ba.length) {
      out.push(`${path}.length: ${aa.length} → ${ba.length}`);
      return;
    }
    for (let i = 0; i < aa.length; i++) diff(aa[i], ba[i], `${path}[${i}]`, out);
    return;
  }
  if (typeof an === 'object' || typeof bn === 'object') {
    if (typeof an !== 'object' || typeof bn !== 'object') {
      out.push(`${path}: type ${typeof an} → ${typeof bn}`);
      return;
    }
    const keys = new Set([...Object.keys(an), ...Object.keys(bn)]);
    for (const key of keys) diff(an[key], bn[key], `${path}.${key}`, out);
    return;
  }
  const key = path.split('.').pop();
  if (normalizeScalar(an, key) !== normalizeScalar(bn, key)) {
    out.push(`${path}: ${JSON.stringify(an)} → ${JSON.stringify(bn)}`);
  }
}

function assertLossless(page) {
  const doc = fromTapuzPage(page);
  const src = serialize(doc);
  const reparsed = parse(src);
  const errors = validate(reparsed, { strict: false }).filter((i) => i.severity === 'error');
  assert.deepEqual(errors, [], `serialized .pzn must validate:\n${src}`);
  const back = toTapuzPage(reparsed);
  const diffs = [];
  diff(page.blocks, back.blocks, 'blocks', diffs);
  assert.deepEqual(diffs, [], `round-trip diffs:\n${diffs.join('\n')}\n--- .pzn ---\n${src}`);
  // page-level meta
  assert.equal(back.title, page.title || '');
  assert.equal(back.slug, page.slug || '');
}

function page(blocks) {
  return {
    title: 'דף בדיקה',
    slug: 'test-page',
    direction: 'rtl',
    lang: 'he',
    tags: ['article', 'בדיקה'],
    meta: { teaser: 'תקציר קצר', cardImage: '/uploads/card.jpg' },
    blocks
  };
}

// ─── one representative block per type, rich values ─────────────────

const CASES = {
  heading: { type: 'heading', id: 'h1', data: { level: 3, align: 'center', text: 'כותרת עם "מירכאות" ו<סוגריים>' } },
  text: {
    type: 'text', id: 't1',
    data: {
      align: 'end', size: 'lg', lead: true, dropcap: false, maxWidth: 'md',
      content: 'פסקה ראשונה עם @B{הדגשה}.\n\nפסקה שנייה — אחרי שורה ריקה.\nוגם שורה רגילה.',
      className: 'intro fancy'
    }
  },
  button: { type: 'button', id: 'b1', data: { text: 'צרו קשר', url: '/contact?ref=home&x=1', variant: 'outline', align: 'center' } },
  quote: { type: 'quote', id: 'q1', data: { text: 'ציטוט חכם', author: 'בן שאלתיאל' } },
  testimonial: { type: 'testimonial', id: 'tm1', data: { quote: 'שירות מעולה!', author: 'דנה', role: 'בעלת סטודיו' } },
  list: { type: 'list', id: 'l1', data: { ordered: true, items: [{ text: 'ראשון' }, { text: 'שני > ראשון' }, { text: 'שלישי' }] } },
  features: {
    type: 'features', id: 'f1',
    data: { columns: 2, items: [
      { title: 'מהיר', icon: '⚡', description: 'בנייה בשניות' },
      { title: 'בעברית', icon: '🍊', description: 'RTL מלא\nגם רב־שורתי' }
    ] }
  },
  'article-list': { type: 'article-list', id: 'al1', data: { tag: 'article', limit: 12, columns: 4 } },
  image: { type: 'image', id: 'im1', data: { src: '/uploads/hero.jpg', alt: 'תמונת נוף', caption: 'צולם בגליל', width: 'lg' } },
  gallery: {
    type: 'gallery', id: 'g1',
    data: { columns: 2, images: [
      { src: '/uploads/a.jpg', alt: 'א', caption: 'ראשונה' },
      { src: '/uploads/b.jpg', alt: 'ב' }
    ] }
  },
  embed: { type: 'embed', id: 'e1', data: { url: 'https://youtu.be/dQw4w9WgXcQ' } },
  columns: {
    type: 'columns', id: 'c1',
    data: {
      gap: 'lg', ratio: '2:1', collapse: 'sm', valign: 'center',
      columns: [
        { width: '2/3', blocks: [
          { type: 'heading', data: { level: 2, text: 'בטור הרחב' } },
          { type: 'text', data: { content: 'תוכן בטור' } }
        ] },
        { width: '1/3', blocks: [
          { type: 'image', data: { src: '/uploads/side.png', alt: 'צד' } }
        ] }
      ]
    }
  },
  spacer: { type: 'spacer', id: 'sp1', data: { height: '3rem', size: 'lg' } },
  divider: { type: 'divider', id: 'd1', data: { style: 'dashed', bentStyle: 'dots' } },
  card: {
    type: 'card', id: 'cd1',
    data: { blocks: [
      { type: 'heading', data: { level: 3, text: 'בתוך כרטיס' } },
      { type: 'button', data: { text: 'עוד', url: '/more' } }
    ] }
  },
  map: { type: 'map', id: 'mp1', data: { address: 'דיזנגוף 100, תל אביב', zoom: 17, height: 'lg' } },
  cta: {
    type: 'cta', id: 'ct1',
    data: { title: 'מוכנים להתחיל?', text: 'הצוות כאן בשבילכם.', buttonText: 'דברו איתנו', url: '/contact', variant: 'secondary', tone: 'dark', align: 'center' }
  },
  stats: {
    type: 'stats', id: 'st1',
    data: { columns: 3, items: [
      { value: '120+', label: 'לקוחות' },
      { value: '15', label: 'שנות ניסיון' },
      { value: '98%', label: 'שביעות רצון' }
    ] }
  },
  logos: {
    type: 'logos', id: 'lg1',
    data: { items: [
      { src: '/uploads/logo1.svg', alt: 'לקוח 1', url: 'https://one.example' },
      { src: '/uploads/logo2.svg', alt: 'לקוח 2' }
    ] }
  },
  faq: {
    type: 'faq', id: 'fq1',
    data: { items: [
      { question: 'איך מתחילים?', answer: 'יוצרים אתר, בונים דף, מפרסמים.' },
      { question: 'כמה זה עולה?', answer: 'קוד פתוח — חינם.\nתמיכה בתשלום.' }
    ] }
  },
  'contact-info': { type: 'contact-info', id: 'ci1', data: { phone: '03-555-1234', email: 'hello@tapuziel.co.il', address: 'רחוב התפוז 8', hours: 'א׳–ה׳ 9:00–17:00' } },
  banner: { type: 'banner', id: 'bn1', data: { text: 'מבצע השקה — חודש ראשון חינם', tone: 'warn', align: 'center' } },
  hero: {
    type: 'hero', id: 'hr1',
    data: { title: 'תפוזיאל', subtitle: 'ה-CMS שסוכנים אוהבים', buttonText: 'התחילו עכשיו', buttonUrl: '/wizard', image: '/uploads/bg.jpg', height: 'full' }
  }
};

describe('Tapuz JSON ⇄ .pzn lossless round-trip (v0.40 QA gate 1)', () => {
  for (const [type, block] of Object.entries(CASES)) {
    it(`round-trips ${type}`, () => {
      assertLossless(page([block]));
    });
  }

  it('round-trips a full mixed page (all 23 types together)', () => {
    assertLossless(page(Object.values(CASES)));
  });

  it('round-trips minimal blocks (defaults only, no optional fields)', () => {
    assertLossless(page([
      { type: 'heading', data: { text: 'רק טקסט' } },
      { type: 'text', data: { content: 'פסקה' } },
      { type: 'divider', data: {} },
      { type: 'list', data: { items: [] } },
      { type: 'hero', data: { title: 'כותרת' } }
    ]));
  });

  it('round-trips an unknown block type via the section stash', () => {
    assertLossless(page([
      { type: 'weird-plugin', id: 'w1', data: { foo: 'bar', n: 3 } }
    ]));
  });

  it('preserves nested columns-in-card structure', () => {
    assertLossless(page([
      { type: 'card', id: 'outer', data: { blocks: [
        { type: 'columns', data: { gap: 'md', columns: [
          { blocks: [{ type: 'text', data: { content: 'ימין' } }] },
          { blocks: [{ type: 'text', data: { content: 'שמאל' } }] }
        ] } }
      ] } }
    ]));
  });
});
