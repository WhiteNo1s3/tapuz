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

/** The welcome page's stand-in art (public/demo/) — abstract, tiny, and
 *  meant to be swapped for the site's own photos. */
const TILE = (n) => '/demo/tile-' + n + '.svg';

/**
 * The showcase page (v1.56) — what a brand-new site opens with.
 *
 * A new install used to land on a hero and one paragraph: correct, and
 * completely silent about what the CMS can actually do. This page is the
 * opposite — a guided tour where every section IS a working module, already
 * filled in, already colourful. Nothing here is a screenshot or a mock: drag
 * it, edit it, or delete it, and the page is yours.
 *
 * Every section carries its own "this is what you're looking at" line, so the
 * page teaches the toolbox while it demonstrates it.
 */
function showcaseBlocks(title) {
  const tip = (text) => blk('text', { content: text });

  return [
    // ── the welcome ──
    blk('hero', {
      title: title,
      subtitle: 'האתר שלכם כבר חי. כל מה שאתם רואים כאן הוא מודול אמיתי — גררו, ערכו או מחקו. זה שלכם.',
      buttonText: 'התחילו לערוך',
      buttonUrl: '#tools',
      height: 'lg'
    }),
    blk('marquee', { text: 'גררו ✦ ערכו ✦ מחקו ✦ פרסמו ✦ הכל בעברית ✦ הכל שלכם ✦' }),

    // ── what you can do ──
    blk('heading', { level: 2, text: '👋 ברוכים הבאים — הנה מה שיש בארגז', id: 'tools' }),
    tip('כל קטע בדף הזה הוא דוגמה חיה למודול מארגז הכלים. אהבתם? השאירו. לא? לחצו על הקטע ואז על ✕ והוא נעלם.\n\nרוצים להתחיל מדף נקי? צרו @B{דף חדש} ובחרו בתבנית "ריק לגמרי".'),
    blk('features', {
      columns: 3,
      items: [
        { title: 'בונה ויזואלי', description: 'גוררים מודול, משחררים איפה שרוצים — הדף נבנה מול העיניים', icon: '🧱' },
        { title: 'עברית מלאה', description: 'RTL אמיתי מהיסוד, לא תוסף שהודבק בסוף', icon: '🇮🇱' },
        { title: 'הקבצים שלכם', description: 'כל דף הוא קובץ .pzn אמיתי על הדיסק — אתם הבעלים', icon: '📂' }
      ]
    }),
    blk('stats', {
      columns: 4,
      items: [
        { value: '40+', label: 'מודולים בארגז' },
        { value: '100%', label: 'עברית ו-RTL' },
        { value: '0', label: 'תוספים להתקין' },
        { value: '∞', label: 'דפים שתבנו' }
      ]
    }),

    // ── containers: the idea that everything nests ──
    blk('heading', { level: 2, text: '📦 מיכלים — הדף מורכב מקופסאות' }),
    blk('section', {
      size: 'md',
      blocks: [
        blk('heading', { level: 3, text: 'זהו מיכל' }),
        blk('text', { content: 'מיכל מחזיק מודולים אחרים. גררו לתוכו כל דבר מארגז הכלים — טקסט, תמונה, אפילו מיכל נוסף.\n\nרוצים שני טורים? יש מודול @B{עמודות} בדיוק לזה.' }),
        blk('button', { text: 'כפתור בתוך מיכל', url: '#', variant: 'primary' })
      ]
    }),
    blk('columns', {
      gap: 'md',
      collapse: 'md',
      valign: 'top',
      columns: [
        { blocks: [
          blk('heading', { level: 3, text: 'טור ימין' }),
          blk('text', { content: 'שני טורים, כל אחד עם התוכן שלו. במסך צר הם נערמים אוטומטית — לא צריך לעשות כלום.' })
        ] },
        { blocks: [blk('image', { src: TILE(2), alt: 'דוגמה', width: 'full', caption: 'תמונה בתוך טור' })] }
      ]
    }),

    // ── media ──
    blk('heading', { level: 2, text: '🖼️ מדיה — גלריה, קרוסלה, כרטיסים' }),
    tip('התמונות כאן הן ממלאי מקום. לחצו על גלריה ← @B{בחר מהספרייה} כדי לשים את התמונות שלכם.'),
    blk('gallery', {
      columns: 3,
      images: [1, 2, 3, 4, 5, 6].map((n) => ({ src: TILE(n), alt: 'תמונת דוגמה ' + n }))
    }),
    blk('carousel', {
      height: 'md',
      peek: true,
      items: [
        { image: TILE(7), tag: 'גררו הצידה', title: 'קרוסלה בלי שורת JavaScript', excerpt: 'גלילה חלקה, עובדת גם בנייד.', href: '#' },
        { image: TILE(4), tag: 'תמונות', title: 'כל תמונה מהספרייה שלכם', excerpt: 'החליפו בשתי לחיצות.', href: '#' },
        { image: TILE(6), tag: 'טקסט', title: 'כותרת ותקציר לכל שקופית', excerpt: 'ערכו ישירות על הדף.', href: '#' }
      ]
    }),
    blk('cards', {
      items: [
        { image: TILE(3), tag: 'מדריך', title: 'איך מוסיפים דף', excerpt: 'דפים ← + דף חדש ← בוחרים תבנית. זהו.', href: '/admin' },
        { image: TILE(5), tag: 'עיצוב', title: 'איך משנים צבעים', excerpt: 'עיצוב ← ערכת נושא ← בוחרים מראה.', href: '/admin/theme' },
        { image: TILE(8), tag: 'תפריט', title: 'איך מסדרים תפריט', excerpt: 'עיצוב ← תפריטים ← גוררים פריטים.', href: '/admin/menus' }
      ]
    }),

    // ── the second menu ──
    blk('heading', { level: 2, text: '🧭 תפריטים — יש לכם יותר מאחד' }),
    blk('section', {
      size: 'md',
      blocks: [
        tip('התפריט @B{הראשי} כבר יושב בראש האתר — הוא נבחר אוטומטית בהתקנה. אבל תפריט הוא פשוט רשימה, ואפשר להחזיק כמה שרוצים.\n\nלמטה יושב תפריט @B{שני} עם פריטים אחרים לגמרי. רוצים שהוא יהיה זה שבראש? עיצוב ← @B{תפריטים} ← משנים איזה תפריט יושב במיקום "ראשי".'),
        blk('nav', {
          align: 'center',
          items: [
            { label: '✨ מה חדש', href: '#' },
            { label: '📚 מדריכים', href: '#' },
            { label: '💬 שאלות נפוצות', href: '#faq' },
            { label: '📬 דברו איתנו', href: '#cta' }
          ]
        })
      ]
    }),

    // ── moving text ──
    blk('heading', { level: 2, text: '📰 טקסט נע — מבזקים ורצועות' }),
    blk('ticker', {
      label: 'מבזק',
      speed: 'md',
      items: [
        { text: 'הדף הזה נוצר אוטומטית כשהאתר נולד', href: '#' },
        { text: 'כל מודול כאן ניתן לעריכה או למחיקה', href: '#' },
        { text: 'רוצים להתחיל מאפס? צרו דף חדש ריק', href: '/admin' }
      ]
    }),
    blk('newspop', {
      label: 'עדכונים',
      items: [
        { time: '09:00', text: 'האתר שלכם עלה לאוויר', href: '#' },
        { time: '09:01', text: 'הדף הזה מחכה שתערכו אותו', href: '#' },
        { time: '09:02', text: 'התפריט הראשי כבר מסודר', href: '#' }
      ]
    }),

    // ── answers ──
    blk('heading', { level: 2, text: '💬 שאלות שכולם שואלים', id: 'faq' }),
    blk('faq', {
      items: [
        { question: 'איך אני מוחק את הדוגמאות האלה?', answer: 'לוחצים על הקטע בבונה ואז על ✕ בסרגל שנפתח מעליו. אפשר גם למחוק את כל הדף ולהתחיל מחדש.' },
        { question: 'אפשר להשתמש בדף הזה כדף הבית שלי?', answer: 'בהחלט. החליפו את הטקסטים והתמונות בשלכם — המבנה כבר עובד.' },
        { question: 'איפה משנים צבעים וגופנים?', answer: 'עיצוב ← ערכת נושא. בוחרים מראה מוכן או מכווננים ידנית, עם תצוגה חיה.' },
        { question: 'איך מוסיפים דף נוסף?', answer: 'דפים ← + דף חדש. בוחרים תבנית (דף נחיתה, מאמר, צור קשר או ריק) ומתחילים.' }
      ]
    }),
    blk('testimonial', {
      quote: 'בניתי אתר שלם בערב אחד, בעברית, בלי לגעת בשורת קוד.',
      author: 'המשתמש הבא',
      role: 'זה יכול להיות אתם'
    }),

    // ── the send-off ──
    blk('cta', {
      title: 'מוכנים להפוך את זה לאתר שלכם?',
      text: 'החליפו את הטקסטים, שימו את התמונות שלכם, ומחקו כל מה שלא צריך.',
      buttonText: 'לעריכת הדף',
      url: '/admin',
      variant: 'primary',
      tone: 'brand',
      id: 'cta'
    }),
    blk('banner', {
      tone: 'brand',
      text: 'טיפ אחרון: כל מה שבדף הזה נמחק בלחיצה אחת — אל תפחדו להתנסות.'
    })
  ];
}

// ORDER MATTERS: the first entry is the picker's pre-checked option AND the
// fallback for an unknown key, so it stays 'basic' — a new page should open
// quiet. The showcase is the SETUP page (runSetup asks for it by name); it
// sits second here so it's the first thing offered without being imposed on
// every page someone adds later.
const TEMPLATES = [
  {
    key: 'basic',
    name: 'דף פשוט',
    icon: '📄',
    desc: 'פתיח אחד — הדרך המהירה להתחיל',
    blocks: (title) => [blk('hero', { title, subtitle: '' })]
  },
  {
    key: 'showcase',
    name: 'סיור בארגז הכלים',
    icon: '🎉',
    desc: 'דף צבעוני שמדגים את כל המודולים — גלריה, קרוסלה, מבזקים, מיכלים ותפריט שני. זה הדף שהאתר נולד איתו; הכל בו ניתן לעריכה או למחיקה',
    blocks: (title) => showcaseBlocks(title)
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
    desc: 'כותרת, פסקאות, תמונה וציטוט — מוכן לכתיבה. מסומן אוטומטית כדף מאמר ומופיע בקוביות המאמרים',
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
