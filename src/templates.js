'use strict';

/**
 * Starter templates (v0.93) — the Builder.io "start from a layout" answer.
 *
 * A template = a named block composition built ONLY from the registry's own
 * defaults (defaultDataFor) with placeholder copy on top — so a template can
 * never drift from what the validator/renderer accept, and every block lands
 * in the builder fully editable like any hand-placed one.
 *
 * Neutral by design: structure is the product, the copy is placeholder the
 * user overwrites. Swapping/adding templates = editing this one file.
 */

const { defaultDataFor } = require('./block-registry');

let seq = 0;
function blk(type, data) {
  seq += 1;
  return {
    id: type + '_tpl' + Date.now().toString(36) + '_' + seq,
    type,
    data: Object.assign(defaultDataFor(type), data || {})
  };
}

const TEMPLATES = [
  {
    key: 'basic',
    name: 'דף פשוט',
    icon: '📄',
    desc: 'פתיח אחד — הדרך המהירה להתחיל (ברירת המחדל עד היום)',
    blocks: (title) => [blk('hero', { title, subtitle: '' })]
  },
  {
    key: 'landing',
    name: 'דף נחיתה',
    icon: '🚀',
    desc: 'פתיח עם קריאה לפעולה, שלוש נקודות חוזק, ציטוט לקוח וטופס לידים',
    blocks: (title) => [
      blk('hero', { title, subtitle: 'משפט אחד שמסביר למה כדאי להישאר', buttonText: 'דברו איתנו', buttonUrl: '#form' }),
      blk('features', {
        columns: 3,
        items: [
          { title: 'מהירים', description: 'ספרו כאן מה אתם עושים הכי טוב', icon: '⚡' },
          { title: 'אמינים', description: 'הוכחה קצרה — מספר, שנה, לקוח', icon: '🛡️' },
          { title: 'קרובים', description: 'איפה מוצאים אתכם ומתי', icon: '📍' }
        ]
      }),
      blk('quote', { text: 'ציטוט קצר מלקוח מרוצה — חברתי ומשכנע', author: 'שם הלקוח' }),
      blk('heading', { level: 2, text: 'רוצים לשמוע עוד?' }),
      blk('form', {})
    ]
  },
  {
    key: 'article',
    name: 'מאמר',
    icon: '📰',
    desc: 'כותרת, פסקאות, תמונה וציטוט — מוכן לכתיבה',
    blocks: (title) => [
      blk('heading', { level: 1, text: title }),
      blk('text', { content: 'פסקת פתיחה שמושכת פנימה — על מה המאמר ולמה עכשיו.' }),
      blk('image', { alt: 'תמונה ראשית למאמר' }),
      blk('text', { content: 'גוף המאמר.\n\nשורה ריקה = פסקה חדשה. אפשר @B{הדגשה} בתוך הטקסט.' }),
      blk('quote', { text: 'שורה אחת ששווה לזכור מהמאמר', author: '' })
    ]
  },
  {
    key: 'contact',
    name: 'צור קשר',
    icon: '📬',
    desc: 'טופס שמגיע לתיבת הפניות, פרטי התקשרות ומפה',
    blocks: (title) => [
      blk('heading', { level: 1, text: title }),
      blk('text', { content: 'נשמח לשמוע מכם — הטופס מגיע ישירות לתיבת הפניות בניהול.' }),
      blk('form', {}),
      blk('contact-info', { phone: '050-0000000', email: 'hello@example.com', address: 'הרחוב שלכם 1, העיר' }),
      blk('map', { address: 'תל אביב' })
    ]
  },
  {
    key: 'blank',
    name: 'ריק לגמרי',
    icon: '⬜',
    desc: 'קנבס נקי — מתחילים מגרירת המודול הראשון',
    blocks: () => []
  }
];

function listTemplates() {
  return TEMPLATES.map((t) => ({ key: t.key, name: t.name, icon: t.icon, desc: t.desc }));
}

/** Blocks for a template key (unknown key → the basic seed, never a crash). */
function templateBlocks(key, title) {
  const t = TEMPLATES.find((x) => x.key === key) || TEMPLATES[0];
  return t.blocks(String(title || 'דף חדש'));
}

module.exports = { listTemplates, templateBlocks, TEMPLATES };
