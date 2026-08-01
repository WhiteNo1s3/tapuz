'use strict';

/**
 * Tapuz Block Registry — the single source of truth describing every block
 * type for UI generation (toolbox, settings forms, defaults).
 *
 * Ben's ask C: "blocks as modular classes" — every block type is a
 * self-describing module. The admin generates its settings UI from this
 * registry instead of hand-writing per-type forms.
 *
 * Alignment rules
 * ---------------
 * - Param names describe the JSON `data` fields the renderer / compiler
 *   actually consume (src/renderer.js, src/bentml/compile.js). When BenTML
 *   spells a param differently (docs/bentml-v0.md §10, src/bentml/keywords.js),
 *   the entry carries `bentmlParam` with the BenTML spelling.
 * - `bentmlParam: null` means the field has NO BenTML param equivalent —
 *   it is carried via the keyword body or child blocks (e.g. hero title =
 *   HEADING child, gallery images = IMAGE children).
 * - `valueAliases` maps JSON enum values to their BenTML spelling when they
 *   differ (e.g. button variant `outline` ⇄ BenTML style `ghost`).
 * - Types/defaults align EXACTLY with src/bentml/keywords.js. As of v0.44
 *   every spec param is stored and rendered — HERO overlay/parallax (spec
 *   §11.1) included; the old "parsed but never stored" drift is closed.
 *
 * Entry shape
 * -----------
 * {
 *   type:        string   — JSON block type ({ type, id, data })
 *   keyword:     string   — BenTML keyword (docs/bentml-v0.md §10)
 *   labelHe:     string   — Hebrew label (toolbox / settings header)
 *   icon:        string   — short emoji/char for the toolbox
 *   category:    string   — one of BLOCK_CATEGORIES
 *   bodyClass:   'text' | 'blocks' | 'none' | 'raw'
 *                          (TEXT-BODY / BLOCK-BODY / NO-BODY / HTML)
 *   childrenOf:  string|null — parent keyword when child-only (null for all
 *                          top-level block types in this registry)
 *   params:      [{ name, labelHe, type, enum?, min?, max?, default?,
 *                   required?, hint?, bentmlParam?, valueAliases?,
 *                   itemFields?, omitDefault? }]
 *     param.type ∈ 'string'|'enum'|'integer'|'boolean'|'ratio'|'list'|
 *                  'media'|'url'|'textarea'
 *     - 'media' = image path → the admin offers the media-library picker
 *     - 'url'   = link field
 *     - 'list'  = repeating sub-items; `itemFields` describes one item
 *     - omitDefault: true → the compiler only writes this field when it
 *       differs from the default; defaultDataFor() skips it too, so fresh
 *       blocks match compile.js output exactly.
 *   textField:   string|null — which data field holds the keyword's body
 *                          text (null when the body is blocks / no body)
 *   textFieldLabelHe / textFieldType ('input'|'textarea') — UI hints for
 *                          rendering the body-text control
 *   childrenKey: string   — (BLOCK-BODY only) data key holding nested
 *                          blocks: 'columns' | 'blocks'
 *   hintHe:      string   — short toolbox hint
 *   seed:        object   — extra Hebrew-default data merged into
 *                          defaultDataFor() for a freshly added block
 * }
 */

const BLOCK_CATEGORIES = ['תוכן', 'מבנה', 'מדיה', 'אפקטים', 'שילובים'];

const ALIGN_PARAM = {
  name: 'align',
  labelHe: 'יישור',
  type: 'enum',
  enum: ['start', 'center', 'end'],
  default: 'start',
  omitDefault: true,
  hint: 'התחלה / מרכז / סוף — לוגי, מתהפך אוטומטית ב-RTL'
};

const BLOCK_REGISTRY = [
  // ─────────────────────────── תוכן ───────────────────────────
  {
    type: 'hero',
    keyword: 'HERO',
    labelHe: 'פתיח (Hero)',
    icon: '★',
    category: 'תוכן',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'כותרת גדולה בראש הדף',
    // HERO is BLOCK-BODY in BenTML (HEADING/TEXT/BUTTON children) but the
    // JSON model is flat — the child content lives in data fields below.
    params: [
      {
        name: 'title', labelHe: 'כותרת', type: 'string', bentmlParam: null,
        hint: 'ב-BenTML: HEADING(level: 1) בתוך HERO'
      },
      {
        name: 'subtitle', labelHe: 'תת כותרת', type: 'string', bentmlParam: null,
        hint: 'ב-BenTML: TEXT בתוך HERO'
      },
      {
        name: 'buttonText', labelHe: 'טקסט כפתור', type: 'string', bentmlParam: null,
        hint: 'ריק = בלי כפתור. ב-BenTML: BUTTON בתוך HERO'
      },
      {
        name: 'buttonUrl', labelHe: 'קישור הכפתור', type: 'url', bentmlParam: null,
        hint: 'לאן הכפתור בפתיח מוביל'
      },
      {
        name: 'image', labelHe: 'תמונת רקע', type: 'media', omitDefault: true,
        hint: 'תמונה מספריית המדיה לרקע הפתיח'
      },
      {
        name: 'height', labelHe: 'גובה', type: 'enum',
        enum: ['sm', 'md', 'lg', 'full'], default: 'md', omitDefault: true,
        hint: 'full = מסך מלא'
      },
      {
        name: 'overlay', labelHe: 'כהות שכבת רקע', type: 'integer',
        min: 0, max: 80, default: 0, omitDefault: true,
        hint: '0–80 — מכהה את תמונת הרקע כדי שהטקסט יבלוט'
      },
      {
        name: 'parallax', labelHe: 'רקע קבוע (פרלקסה)', type: 'boolean',
        default: false, omitDefault: true,
        hint: 'הרקע נשאר קבוע והתוכן גולל מעליו'
      }
    ],
    textField: null,
    seed: { title: 'כותרת ראשית', subtitle: '', buttonText: '', buttonUrl: '' }
  },
  {
    type: 'heading',
    keyword: 'HEADING',
    labelHe: 'כותרת',
    icon: 'H',
    category: 'תוכן',
    bodyClass: 'text',
    childrenOf: null,
    hintHe: 'H1–H6',
    params: [
      {
        name: 'level', labelHe: 'רמה', type: 'integer',
        min: 1, max: 6, default: 2, hint: 'H1 עד H6 — H2 לרוב הכותרות'
      },
      ALIGN_PARAM,
      {
        name: 'animate', labelHe: 'אנימציית כניסה', type: 'enum',
        enum: ['none', 'fade', 'rise'], default: 'none', omitDefault: true,
        hint: 'fade = הופעה הדרגתית, rise = עולה תוך כדי גלילה'
      }
    ],
    textField: 'text',
    textFieldLabelHe: 'טקסט',
    textFieldType: 'input',
    seed: { text: 'כותרת' }
  },
  {
    type: 'text',
    keyword: 'TEXT',
    labelHe: 'טקסט',
    icon: '¶',
    category: 'תוכן',
    bodyClass: 'text',
    childrenOf: null,
    hintHe: 'מיכל מתקדם — פסקאות + @B @I @LINK',
    /** Only TEXT is "advanced container" depth for authors */
    complexity: 'advanced',
    params: [
      ALIGN_PARAM,
      {
        name: 'size', labelHe: 'גודל טקסט', type: 'enum',
        enum: ['sm', 'md', 'lg'], default: 'md', omitDefault: true,
        hint: 'sm / md / lg — התבנית קובעת את המידה בפועל'
      },
      {
        name: 'lead', labelHe: 'פסקת פתיח (lead)', type: 'boolean', default: false,
        omitDefault: true,
        hint: 'מדגיש את הפסקה הראשונה כמו ליד במאמר'
      },
      {
        name: 'dropcap', labelHe: 'אות פתיחה גדולה', type: 'boolean', default: false,
        omitDefault: true,
        hint: 'האות הראשונה מוגדלת (CSS drop-cap)'
      },
      {
        name: 'maxWidth', bentmlParam: 'maxwidth', labelHe: 'רוחב מקסימלי', type: 'enum',
        enum: ['sm', 'md', 'lg', 'full'], default: 'full', omitDefault: true,
        hint: 'מגביל רוחב קריאות לטקסט ארוך'
      },
      {
        name: 'animate', labelHe: 'אנימציית כניסה', type: 'enum',
        enum: ['none', 'fade', 'rise'], default: 'none', omitDefault: true,
        hint: 'fade = הופעה הדרגתית, rise = עולה תוך כדי גלילה'
      }
    ],
    textField: 'content',
    textFieldLabelHe: 'תוכן (תומך @B{מודגש} @I{נטוי} @LINK(url:"…"){טקסט})',
    textFieldType: 'textarea',
    seed: { content: 'טקסט חדש...\n\nשורה ריקה = פסקה חדשה. אפשר @B{הדגשה}.' }
  },
  {
    type: 'button',
    keyword: 'BUTTON',
    labelHe: 'כפתור',
    icon: '◉',
    category: 'תוכן',
    bodyClass: 'text',
    childrenOf: null,
    hintHe: 'קישור / CTA',
    params: [
      {
        name: 'url', labelHe: 'קישור', type: 'url', required: true,
        hint: 'לאן הכפתור מוביל (E306 כשחסר ב-BenTML)'
      },
      {
        name: 'variant', bentmlParam: 'style', labelHe: 'סגנון', type: 'enum',
        enum: ['primary', 'secondary', 'outline'],
        valueAliases: { outline: 'ghost' },
        default: 'primary',
        hint: 'ראשי / משני / מתאר (ghost ב-BenTML)'
      },
      ALIGN_PARAM,
      { name: 'rel', labelHe: 'יחס קישור (rel)', type: 'string', default: '', hint: 'nofollow / sponsored / ugc — לבקרת קישורים ו-SEO' },
      { name: 'target', labelHe: 'פתיחה', type: 'enum', enum: ['_self', '_blank'], default: '_self', hint: '_blank = חלון חדש (מקבל noopener אוטומטית)' },
      { name: 'title', labelHe: 'כותרת קישור (SEO)', type: 'string', default: '' }
    ],
    textField: 'text',
    textFieldLabelHe: 'טקסט הכפתור',
    textFieldType: 'input',
    seed: { text: 'לחץ כאן', url: '#' }
  },
  {
    type: 'quote',
    keyword: 'QUOTE',
    labelHe: 'ציטוט',
    icon: '❞',
    category: 'תוכן',
    bodyClass: 'text',
    childrenOf: null,
    hintHe: 'ציטוט מובלט',
    params: [
      {
        name: 'author', labelHe: 'מקור', type: 'string',
        hint: 'מי אמר — בלי מירכאות, העיצוב מגיע מהתבנית'
      }
    ],
    textField: 'text',
    textFieldLabelHe: 'טקסט הציטוט',
    textFieldType: 'textarea',
    seed: { text: '', author: '' }
  },
  {
    type: 'testimonial',
    keyword: 'TESTIMONIAL',
    labelHe: 'המלצה',
    icon: '❝',
    category: 'תוכן',
    bodyClass: 'text',
    childrenOf: null,
    hintHe: 'ציטוט + שם',
    params: [
      { name: 'author', labelHe: 'שם הממליץ', type: 'string' },
      { name: 'role', labelHe: 'תפקיד', type: 'string', hint: 'למשל: בעלת סטודיו' }
    ],
    textField: 'quote',
    textFieldLabelHe: 'ציטוט',
    textFieldType: 'textarea',
    seed: { quote: '', author: '', role: '' }
  },
  {
    type: 'list',
    keyword: 'LIST',
    labelHe: 'רשימה',
    icon: '≡',
    category: 'תוכן',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'נקודות / ממוספרת',
    params: [
      {
        name: 'ordered', bentmlParam: 'type', labelHe: 'רשימה ממוספרת',
        type: 'boolean', default: false,
        valueAliases: { 'false': 'bullet', 'true': 'number' },
        hint: 'מסומן = 1, 2, 3… (number ב-BenTML), אחרת נקודות (bullet)'
      },
      {
        name: 'items', bentmlParam: null, labelHe: 'פריטים', type: 'list',
        itemFields: [
          { name: 'text', labelHe: 'טקסט', type: 'string' }
        ],
        hint: 'ב-BenTML: צאצאי ITEM'
      }
    ],
    textField: null,
    seed: { items: [{ text: 'פריט ראשון' }] }
  },
  {
    type: 'features',
    keyword: 'FEATURES',
    labelHe: 'תכונות',
    icon: '▦',
    category: 'תוכן',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'רשת כרטיסי תכונות',
    params: [
      {
        name: 'columns', labelHe: 'עמודות', type: 'integer',
        min: 1, max: 4, default: 3
      },
      {
        name: 'items', bentmlParam: null, labelHe: 'פריטים', type: 'list',
        itemFields: [
          { name: 'title', labelHe: 'כותרת', type: 'string', required: true },
          { name: 'icon', labelHe: 'אייקון', type: 'string', hint: 'אימוג׳י בודד או נתיב ‎/uploads‎ ל-svg/png' },
          { name: 'description', labelHe: 'תיאור', type: 'textarea' },
          { name: 'url', labelHe: 'קישור (אופציונלי)', type: 'url', hint: 'הכרטיס כולו נהיה לחיץ' }
        ],
        hint: 'ב-BenTML: צאצאי FEATURE (הכותרת פרמטר, התיאור גוף, url פרמטר)'
      }
    ],
    textField: null,
    seed: { items: [{ title: 'פריט', description: '', icon: '' }] }
  },
  {
    type: 'article-list',
    keyword: 'ARTICLES',
    labelHe: 'מאמרים',
    icon: '⊞',
    category: 'תוכן',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'קוביות מאמרים דינמיות',
    params: [
      {
        name: 'tag', labelHe: 'תגית', type: 'string', default: 'article',
        hint: 'אילו דפים מפורסמים להציג — לפי תגית'
      },
      {
        name: 'limit', labelHe: 'כמות מקסימלית', type: 'integer',
        min: 1, max: 48, default: 6
      },
      {
        name: 'columns', labelHe: 'עמודות', type: 'integer',
        min: 1, max: 4, default: 3
      }
    ],
    textField: null,
    seed: {}
  },
  {
    type: 'category',
    keyword: 'CATEGORY',
    labelHe: 'קטגוריה',
    icon: '🗂',
    category: 'תוכן',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'כותרת קטגוריה ממותגת + רשת הכתבות שלה — מנוהל במסך "קטגוריות"',
    params: [
      {
        name: 'slug', labelHe: 'קטגוריה (slug)', type: 'string', required: true,
        hint: 'ה-slug מתוך מסך הקטגוריות; דפים משויכים דרך תגיות הדף (E306 כשחסר)'
      },
      {
        name: 'limit', labelHe: 'כמות מקסימלית', type: 'integer',
        min: 1, max: 48, default: 6
      },
      {
        name: 'showheader', labelHe: 'הצג כותרת קטגוריה', type: 'boolean', default: true
      }
    ],
    textField: null,
    seed: { slug: '' }
  },

  // ─────────────────────────── מדיה ───────────────────────────
  {
    type: 'image',
    keyword: 'IMAGE',
    labelHe: 'תמונה',
    icon: '▣',
    category: 'מדיה',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'תמונה בודדת',
    params: [
      {
        name: 'src', labelHe: 'תמונה', type: 'media', required: true,
        hint: 'נתיב תחת ‎/uploads‎ או URL מלא (E306 כשחסר)'
      },
      {
        name: 'alt', labelHe: 'טקסט חלופי (Alt)', type: 'string', default: '',
        hint: 'חשוב לנגישות ול-SEO — אזהרת W401 כשריק'
      },
      { name: 'title', labelHe: 'כותרת תמונה (SEO)', type: 'string', default: '', hint: 'מופיע ברחיפה ומחזק SEO לתמונה' },
      { name: 'caption', labelHe: 'כיתוב', type: 'string', hint: 'מוצג מתחת לתמונה' },
      {
        name: 'link', labelHe: 'קישור בלחיצה', type: 'url', default: '',
        hint: 'התמונה נהיית לחיצה — לדף באתר (‎/about‎) או לכתובת מלאה'
      },
      {
        name: 'width', labelHe: 'רוחב', type: 'enum',
        enum: ['sm', 'md', 'lg', 'full'], default: 'full'
      }
    ],
    textField: null,
    seed: { src: '', alt: '', caption: '' }
  },
  {
    type: 'gallery',
    keyword: 'GALLERY',
    labelHe: 'גלריה',
    icon: '▤',
    category: 'מדיה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'רשת תמונות',
    params: [
      {
        name: 'columns', labelHe: 'עמודות', type: 'integer',
        min: 1, max: 4, default: 3
      },
      {
        name: 'images', bentmlParam: null, labelHe: 'תמונות', type: 'list',
        itemFields: [
          { name: 'src', labelHe: 'תמונה', type: 'media', required: true },
          { name: 'alt', labelHe: 'טקסט חלופי', type: 'string' },
          { name: 'caption', labelHe: 'כיתוב', type: 'string' }
        ],
        hint: 'ב-BenTML: צאצאי IMAGE (רק src / alt / caption מותרים)'
      }
    ],
    textField: null,
    seed: { images: [] }
  },
  {
    // The escape hatch, graduated to a real tool in v1.49. It existed in the
    // pzn registry since v0.49 but never here — so it had no toolbox entry and
    // no editor, and the only way to get one was the importer parking markup in
    // it. Authors and agents now reach for it on purpose: when the CMS has no
    // module for the thing you want, you write the thing.
    //
    // bodyClass 'raw' (↔ the HTML keyword's 'HTML' body) means the payload is
    // the body, not an escaped attribute — so it reads as real HTML in the .pzn.
    // NOTE: content compiles UNSANITIZED, script included, by design — see the
    // security note in src/renderer.js and src/pzn/modules/registry.js.
    type: 'html',
    keyword: 'HTML',
    labelHe: 'HTML גולמי',
    icon: '<>',
    category: 'שילובים',
    bodyClass: 'raw',
    childrenOf: null,
    hintHe: 'הדבק HTML משלך — לכל דבר שאין לו מודול',
    /** Not a beginner tool: it is the hatch you take when the toolbox runs out. */
    complexity: 'advanced',
    params: [
      {
        name: 'note', labelHe: 'הערה', type: 'string', default: '', omitDefault: true,
        hint: 'למה נדרש כאן HTML גולמי — עוזר להמיר אותו למודול אמיתי בהמשך'
      },
      {
        name: 'provisional', labelHe: 'זמני (להמרה למודולים)', type: 'boolean',
        default: false, omitDefault: true,
        hint: 'מסומן אוטומטית כשייבוא חיצוני לא הצליח להתפרק למודולים'
      }
    ],
    textField: 'content',
    textFieldLabelHe: 'קוד HTML — נכתב לדף כמו שהוא',
    textFieldType: 'textarea',
    seed: { content: '<div class="my-thing">\n  <!-- כאן כותבים HTML חופשי -->\n</div>' }
  },
  {
    type: 'embed',
    keyword: 'EMBED',
    labelHe: 'וידאו',
    icon: '▶',
    category: 'מדיה',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'YouTube / הטמעת קישור',
    params: [
      {
        name: 'url', labelHe: 'קישור', type: 'url', required: true,
        hint: 'קישור YouTube הופך לנגן מוטמע; כל קישור אחר מוצג כקישור יוצא'
      }
    ],
    textField: null,
    seed: { url: '' }
  },
  {
    type: 'video',
    keyword: 'VIDEO',
    labelHe: 'וידאו',
    icon: '🎬',
    category: 'מדיה',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'נגן וידאו מתארח (mp4/webm) — קישור יוטיוב הופך אוטומטית להטמעה',
    params: [
      {
        name: 'src', labelHe: 'קובץ וידאו / קישור', type: 'media', required: true,
        hint: 'קובץ תחת ‎/uploads‎ או קישור יוטיוב (E306 כשחסר)'
      },
      { name: 'poster', labelHe: 'תמונת שער', type: 'media', hint: 'תמונה שמוצגת לפני הניגון' },
      { name: 'caption', labelHe: 'כיתוב', type: 'string', hint: 'מוצג מתחת לנגן' },
      { name: 'controls', labelHe: 'פקדי נגן', type: 'boolean', default: true },
      {
        name: 'autoplay', labelHe: 'ניגון אוטומטי', type: 'boolean', default: false, omitDefault: true,
        hint: 'ניגון אוטומטי מחייב השתקה (מדיניות דפדפן) — נאכף אוטומטית'
      },
      { name: 'loop', labelHe: 'לולאה', type: 'boolean', default: false, omitDefault: true },
      { name: 'muted', labelHe: 'מושתק', type: 'boolean', default: false, omitDefault: true }
    ],
    textField: null,
    seed: { src: '', controls: true }
  },
  {
    type: 'audio',
    keyword: 'AUDIO',
    labelHe: 'שמע',
    icon: '🎧',
    category: 'מדיה',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'נגן שמע (mp3/ogg) — פודקאסט, מוזיקה, קטע רדיו; קישור יוטיוב הופך להטמעה',
    params: [
      {
        name: 'src', labelHe: 'קובץ שמע / קישור', type: 'media', required: true,
        hint: 'קובץ תחת ‎/uploads‎ או קישור יוטיוב (E306 כשחסר)'
      },
      { name: 'caption', labelHe: 'כיתוב', type: 'string', hint: 'מוצג מתחת לנגן' },
      { name: 'loop', labelHe: 'לולאה', type: 'boolean', default: false, omitDefault: true }
    ],
    textField: null,
    seed: { src: '' }
  },

  // ─────────────────────────── מבנה ───────────────────────────
  {
    type: 'columns',
    keyword: 'ROW',
    labelHe: 'עמודות',
    icon: '▥',
    category: 'מבנה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: '2–4 טורים זה לצד זה',
    childrenKey: 'columns',
    params: [
      {
        name: 'ratio', labelHe: 'יחס רוחב', type: 'ratio', omitDefault: true,
        hint: 'למשל "2:1" — ריק = חלוקה שווה'
      },
      {
        name: 'gap', labelHe: 'מרווח בין טורים', type: 'enum',
        enum: ['none', 'sm', 'md', 'lg'], default: 'md'
      },
      {
        name: 'collapse', labelHe: 'קריסה במובייל', type: 'enum',
        enum: ['sm', 'md', 'lg', 'never'], default: 'md',
        hint: 'מאיזה רוחב מסך הטורים נערמים זה מעל זה'
      },
      {
        name: 'valign', labelHe: 'יישור אנכי', type: 'enum',
        enum: ['top', 'center', 'bottom', 'stretch'], default: 'top',
        hint: 'stretch = כרטיסים בגובה אחיד'
      }
    ],
    textField: null,
    // data.columns = [{ blocks: [...] }, ...] — the structural container,
    // edited via canvas drag & drop, not a form param.
    seed: { columns: [{ blocks: [] }, { blocks: [] }] }
  },
  {
    type: 'spacer',
    keyword: 'SPACE',
    labelHe: 'רווח',
    icon: '↕',
    category: 'מבנה',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'מרווח אנכי',
    params: [
      {
        name: 'size', labelHe: 'גודל', type: 'enum',
        enum: ['sm', 'md', 'lg', 'xl'], default: 'md',
        hint: 'שדה height הישן נגזר מהגודל (md = ‎1.5rem)'
      }
    ],
    textField: null,
    // legacy renderer input: compile.js emits height alongside size
    // (sm 0.75rem / md 1.5rem / lg 2.5rem / xl 4rem)
    seed: { height: '1.5rem' }
  },
  {
    type: 'divider',
    keyword: 'DIVIDER',
    labelHe: 'קו מפריד',
    icon: '—',
    category: 'מבנה',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'קו אופקי',
    params: [
      {
        // compile.js stores the BenTML value in data.bentStyle and a mapped
        // legacy value in data.style (line→solid, dots→dashed, thick→solid);
        // decompile round-trips from bentStyle.
        name: 'bentStyle', bentmlParam: 'style', labelHe: 'סגנון', type: 'enum',
        enum: ['line', 'dots', 'thick'], default: 'line',
        hint: 'קו / נקודות / עבה'
      }
    ],
    textField: null,
    seed: { style: 'solid' }
  },
  {
    type: 'card',
    keyword: 'CARD',
    labelHe: 'כרטיס',
    icon: '▢',
    category: 'מבנה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'קבוצת מודולים בקופסה',
    childrenKey: 'blocks',
    params: [],
    textField: null,
    seed: { blocks: [] }
  },
  {
    // container-as-tool (v0.75): a block container that is legitimate EMPTY.
    // Drop it to reserve blank space; it publishes as a sized empty section
    // and gets filled in a future release. Deleting a tool also leaves one
    // of these behind (the shape survives the content).
    type: 'section',
    keyword: 'SECTION',
    labelHe: 'מיכל',
    icon: '▣',
    category: 'מבנה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'שטח שמור — מלאו עכשיו או אחרי הפרסום',
    childrenKey: 'blocks',
    params: [
      {
        name: 'size', labelHe: 'גובה כשריק', type: 'enum',
        enum: ['sm', 'md', 'lg', 'xl'], default: 'md',
        hint: 'כמה מקום המיכל שומר כשהוא עדיין ריק'
      }
    ],
    textField: null,
    seed: { blocks: [], size: 'md' }
  },

  // ─────────────────────────── שילובים ───────────────────────────
  {
    // NEW in BenTML 0.2 (MINOR addition per docs/bentml-v0.md §17; MAP is
    // not in the RESERVED set). Render contract:
    //   <figure class="map-embed"><iframe
    //     src="https://www.google.com/maps?q=<encodeURIComponent(address)>&z=<zoom>&output=embed&hl=he"
    //     loading="lazy" title="מפה: <escaped address>" allowfullscreen>
    //   </iframe></figure>
    // No API key needed; the height class is resolved by theme CSS and the
    // iframe must stay responsive (max-width: 100%).
    type: 'map',
    keyword: 'MAP',
    labelHe: 'מפה',
    icon: '📍',
    category: 'שילובים',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'מפת Google לפי כתובת',
    params: [
      {
        name: 'address', labelHe: 'כתובת', type: 'string', required: true,
        hint: 'כתובת או שם מקום כפי שמחפשים ב-Google Maps (E306 כשחסר)'
      },
      {
        name: 'zoom', labelHe: 'זום', type: 'integer',
        min: 1, max: 20, default: 15,
        hint: '1 = עולם, 15 = רחוב, 20 = בניין'
      },
      {
        name: 'height', labelHe: 'גובה', type: 'enum',
        enum: ['sm', 'md', 'lg'], default: 'md'
      }
    ],
    textField: null,
    seed: { address: '' }
  },

  // ─────────────────────────── אפקטים ───────────────────────────
  {
    type: 'marquee',
    keyword: 'MOTION',
    aliases: ['MARQUEE'],
    labelHe: 'טקסט נע',
    icon: '〰',
    category: 'אפקטים',
    bodyClass: 'text',
    childrenOf: null,
    hintHe: 'טקסט שזז — נע לרוחב או נכנס באנימציה',
    params: [
      {
        name: 'effect', labelHe: 'אפקט', type: 'enum',
        enum: ['marquee', 'fade', 'slide', 'typewriter'], default: 'marquee', omitDefault: true,
        hint: 'marquee = נע לרוחב, fade = הופעה, slide = החלקה, typewriter = הקלדה'
      },
      {
        name: 'speed', labelHe: 'מהירות', type: 'enum',
        enum: ['slow', 'md', 'fast'], default: 'md', omitDefault: true,
        hint: 'slow = איטי ומכובד, fast = אנרגטי'
      }
    ],
    textField: 'text',
    textFieldLabelHe: 'הטקסט הנע',
    textFieldType: 'input',
    seed: { text: 'ברוכים הבאים ✦ ברוכים הבאים ✦' }
  },
  {
    type: 'parallax',
    keyword: 'BACKDROP',
    aliases: ['PARALLAX'],
    labelHe: 'רקע קבוע (Backdrop)',
    icon: '🏔',
    category: 'אפקטים',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'תמונה קבועה — התוכן גולל מעליה',
    childrenKey: 'blocks',
    params: [
      {
        name: 'image', labelHe: 'תמונת רקע', type: 'media',
        hint: 'התמונה שנשארת קבועה בזמן הגלילה — מומלץ מאוד'
      },
      {
        name: 'overlay', labelHe: 'כהות שכבת רקע', type: 'integer',
        min: 0, max: 80, default: 0, omitDefault: true,
        hint: '0–80 — מכהה את התמונה כדי שהטקסט יבלוט'
      },
      {
        name: 'tint', labelHe: 'גוון שכבת הרקע', type: 'enum',
        enum: ['none', 'dark', 'light', 'brand'], default: 'none', omitDefault: true,
        hint: 'צבע שכבת הכיסוי מעל התמונה — dark/light/brand'
      },
      {
        name: 'fade', labelHe: 'הופעה הדרגתית', type: 'boolean', default: false, omitDefault: true,
        hint: 'התוכן נכנס בהופעה רכה כשמגיעים אליו בגלילה'
      },
      {
        name: 'height', labelHe: 'גובה', type: 'enum',
        enum: ['sm', 'md', 'lg', 'full'], default: 'md', omitDefault: true,
        hint: 'full = מסך מלא'
      }
    ],
    textField: null,
    seed: { image: '', blocks: [] }
  },

  // ─────────────────── enterprise / company pages ───────────────────
  {
    type: 'cta',
    keyword: 'CTA',
    labelHe: 'פסקת קריאה לפעולה',
    icon: '➤',
    category: 'תוכן',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'כותרת + טקסט + כפתור — שורת CTA ארגונית',
    params: [
      { name: 'title', labelHe: 'כותרת', type: 'string', required: true },
      { name: 'text', labelHe: 'טקסט', type: 'textarea' },
      {
        name: 'buttonText', bentmlParam: 'buttontext', labelHe: 'טקסט כפתור', type: 'string', default: 'לפרטים'
      },
      { name: 'url', labelHe: 'קישור', type: 'url', required: true, default: '#' },
      {
        name: 'variant', bentmlParam: 'style', labelHe: 'סגנון כפתור', type: 'enum',
        enum: ['primary', 'secondary', 'outline'],
        valueAliases: { outline: 'ghost' },
        default: 'primary'
      },
      {
        name: 'tone', labelHe: 'רקע הפס', type: 'enum',
        enum: ['brand', 'dark', 'light'], default: 'brand'
      },
      ALIGN_PARAM
    ],
    textField: null,
    seed: {
      title: 'מוכנים להתחיל?',
      text: 'צוות Shaltiel Enterprises כאן בשבילכם.',
      buttonText: 'צרו קשר',
      url: '/contact',
      variant: 'primary',
      tone: 'brand'
    }
  },
  {
    type: 'stats',
    keyword: 'STATS',
    labelHe: 'מספרים / מדדים',
    icon: '＃',
    category: 'תוכן',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'שורה של מדדים (לקוחות, פרויקטים…)',
    params: [
      {
        name: 'columns', labelHe: 'עמודות', type: 'integer',
        min: 2, max: 4, default: 3
      },
      {
        name: 'items', bentmlParam: null, labelHe: 'מדדים', type: 'list',
        itemFields: [
          { name: 'value', labelHe: 'מספר / ערך', type: 'string', required: true },
          { name: 'label', labelHe: 'תווית', type: 'string', required: true }
        ]
      }
    ],
    textField: null,
    seed: {
      columns: 3,
      items: [
        { value: '120+', label: 'לקוחות' },
        { value: '15', label: 'שנות ניסיון' },
        { value: '98%', label: 'שביעות רצון' }
      ]
    }
  },
  {
    type: 'logos',
    keyword: 'LOGOS',
    labelHe: 'לוגואים / לקוחות',
    icon: '▣▣',
    category: 'מדיה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'רצועת לוגואים — PLACEHOLDER עד העלאת קבצים',
    params: [
      {
        name: 'items', bentmlParam: null, labelHe: 'לוגואים', type: 'list',
        itemFields: [
          { name: 'src', labelHe: 'תמונה', type: 'media', required: true },
          { name: 'alt', labelHe: 'שם', type: 'string' },
          { name: 'url', labelHe: 'קישור (אופציונלי)', type: 'url' }
        ]
      }
    ],
    textField: null,
    seed: {
      items: [
        { src: '/uploads/PLACEHOLDER-logo-1.svg', alt: 'לקוח 1' },
        { src: '/uploads/PLACEHOLDER-logo-2.svg', alt: 'לקוח 2' },
        { src: '/uploads/PLACEHOLDER-logo-3.svg', alt: 'לקוח 3' }
      ]
    }
  },
  {
    type: 'faq',
    keyword: 'FAQ',
    labelHe: 'שאלות נפוצות',
    icon: '?',
    category: 'תוכן',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'רשימת שאלה / תשובה',
    params: [
      {
        name: 'items', bentmlParam: null, labelHe: 'שאלות', type: 'list',
        itemFields: [
          { name: 'question', labelHe: 'שאלה', type: 'string', required: true },
          { name: 'answer', labelHe: 'תשובה', type: 'textarea', required: true }
        ]
      }
    ],
    textField: null,
    seed: {
      items: [
        { question: 'איך מתחילים?', answer: 'יוצרים אתר, בונים דף, מפרסמים.' },
        { question: 'צריך תוסף לבניית דפים?', answer: 'לא — הבונה מובנה בחבילה.' }
      ]
    }
  },
  {
    type: 'table',
    keyword: 'TABLE',
    labelHe: 'טבלה',
    icon: '📋',
    category: 'תוכן',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'שעות פתיחה, מחירון, לו"ז — שורות מופרדות ב-| (ללא JS)',
    params: [
      {
        name: 'header', bentmlParam: 'header', labelHe: 'שורה ראשונה = כותרת', type: 'boolean',
        default: true
      },
      {
        name: 'rows', bentmlParam: null, labelHe: 'שורות', type: 'list',
        itemFields: [
          { name: 'cells', labelHe: 'תאים (מופרדים ב-|)', type: 'string', required: true }
        ],
        hint: 'ב-BenTML: צאצאי TROW — הגוף הוא השורה: TROW { יום | שעות }'
      }
    ],
    textField: null,
    seed: {
      header: true,
      rows: [
        { cells: 'יום | שעות' },
        { cells: 'ראשון–חמישי | 9:00–17:00' },
        { cells: 'שישי | 9:00–13:00' }
      ]
    }
  },
  {
    type: 'tabs',
    keyword: 'TABS',
    labelHe: 'טאבים',
    icon: '❐',
    category: 'מבנה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'תוכן בלשוניות (CSS בלבד)',
    params: [
      {
        name: 'items', bentmlParam: null, labelHe: 'לשוניות', type: 'list',
        itemFields: [
          { name: 'label', labelHe: 'כותרת הלשונית', type: 'string', required: true },
          { name: 'content', labelHe: 'תוכן', type: 'textarea' }
        ],
        hint: 'ב-BenTML: צאצאי TAB (הכותרת פרמטר, התוכן גוף)'
      }
    ],
    textField: null,
    seed: { items: [{ label: 'לשונית 1', content: '' }, { label: 'לשונית 2', content: '' }] }
  },
  {
    type: 'accordion',
    keyword: 'ACCORDION',
    labelHe: 'אקורדיון',
    icon: '☰',
    category: 'מבנה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'מגירות נפתחות (CSS בלבד)',
    params: [
      {
        name: 'items', bentmlParam: null, labelHe: 'מגירות', type: 'list',
        itemFields: [
          { name: 'title', labelHe: 'כותרת', type: 'string', required: true },
          { name: 'content', labelHe: 'תוכן', type: 'textarea' }
        ],
        hint: 'ב-BenTML: צאצאי FOLD (הכותרת פרמטר, התוכן גוף)'
      }
    ],
    textField: null,
    seed: { items: [{ title: 'מגירה 1', content: '' }, { title: 'מגירה 2', content: '' }] }
  },
  {
    type: 'form',
    keyword: 'FORM',
    labelHe: 'טופס',
    icon: '✉',
    category: 'שילובים',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'טופס יצירת קשר / הרשמה (מודול #1 שהמפרק ביקש)',
    params: [
      {
        name: 'action', bentmlParam: 'action', labelHe: 'יעד שליחה (URL)', type: 'url', default: '',
        hint: 'ריק = תיבת הפניות המובנית (ניהול → תיבת פניות)'
      },
      { name: 'method', bentmlParam: 'method', labelHe: 'שיטה', type: 'enum', enum: ['post', 'get'], default: 'post' },
      { name: 'submit', bentmlParam: 'submit', labelHe: 'כפתור שליחה', type: 'string', default: 'שליחה' },
      {
        name: 'fields', bentmlParam: null, labelHe: 'שדות', type: 'list',
        itemFields: [
          { name: 'label', labelHe: 'תווית', type: 'string', required: true },
          { name: 'name', labelHe: 'שם השדה', type: 'string' },
          { name: 'type', labelHe: 'סוג', type: 'enum', enum: ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'], default: 'text' },
          { name: 'placeholder', labelHe: 'רמז', type: 'string' },
          { name: 'required', labelHe: 'חובה', type: 'boolean', default: false },
          { name: 'options', labelHe: 'אפשרויות (מופרד בפסיק)', type: 'string' }
        ],
        hint: 'ב-BenTML: צאצאי FIELD (label/name/type/placeholder/required/options)'
      }
    ],
    textField: null,
    seed: {
      action: '', method: 'post', submit: 'שליחה',
      fields: [
        { label: 'שם', name: 'name', type: 'text', required: true },
        { label: 'אימייל', name: 'email', type: 'email', required: true },
        { label: 'הודעה', name: 'message', type: 'textarea', required: false }
      ]
    }
  },
  {
    type: 'cards',
    keyword: 'CARDS',
    labelHe: 'רשת כרטיסים',
    icon: '▦',
    category: 'מדיה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'רשת כרטיסי תוכן (תמונה + כותרת + קישור) — היחידה של אתר תוכן',
    params: [
      {
        name: 'items', bentmlParam: null, labelHe: 'כרטיסים', type: 'list',
        itemFields: [
          { name: 'image', labelHe: 'תמונה', type: 'media' },
          { name: 'tag', labelHe: 'תגית', type: 'string' },
          { name: 'title', labelHe: 'כותרת', type: 'string', required: true },
          { name: 'excerpt', labelHe: 'תקציר', type: 'string' },
          { name: 'href', labelHe: 'קישור', type: 'url' }
        ],
        hint: 'ב-BenTML: צאצאי MEDIACARD'
      }
    ],
    textField: null,
    seed: {
      items: [
        { image: '', tag: 'חדשות', title: 'כותרת הכתבה', excerpt: 'תקציר קצר של הכתבה.', href: '#' },
        { image: '', tag: 'ספורט', title: 'כותרת שנייה', excerpt: 'תקציר קצר נוסף.', href: '#' }
      ]
    }
  },
  {
    type: 'carousel',
    keyword: 'CAROUSEL',
    labelHe: 'קרוסלה',
    icon: '🎠',
    category: 'מדיה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'שקופיות בגלילה אופקית (ללא JS) — כרטיסי תוכן שמחליקים',
    params: [
      {
        name: 'height', bentmlParam: 'height', labelHe: 'גובה', type: 'enum',
        enum: ['sm', 'md', 'lg'], default: 'md'
      },
      {
        name: 'peek', bentmlParam: 'peek', labelHe: 'הצצה לשקופית הבאה', type: 'boolean',
        default: true, hint: 'קצה השקופית הבאה נשאר גלוי — רואים שיש עוד'
      },
      {
        name: 'items', bentmlParam: null, labelHe: 'שקופיות', type: 'list',
        itemFields: [
          { name: 'image', labelHe: 'תמונה', type: 'media' },
          { name: 'tag', labelHe: 'תגית', type: 'string' },
          { name: 'title', labelHe: 'כותרת', type: 'string' },
          { name: 'excerpt', labelHe: 'תקציר', type: 'string' },
          { name: 'href', labelHe: 'קישור', type: 'url' }
        ],
        hint: 'ב-BenTML: צאצאי SLIDE (התקציר גוף, השאר פרמטרים)'
      }
    ],
    textField: null,
    seed: {
      items: [
        { image: '', tag: 'חדש', title: 'שקופית ראשונה', excerpt: 'גררו הצידה — אין צורך ב-JS.', href: '#' },
        { image: '', tag: '', title: 'שקופית שנייה', excerpt: 'כל שקופית היא כרטיס תוכן.', href: '#' },
        { image: '', tag: '', title: 'שקופית שלישית', excerpt: 'תמונה, כותרת, תקציר וקישור.', href: '#' }
      ]
    }
  },
  {
    type: 'pricing',
    keyword: 'PRICING',
    labelHe: 'טבלת מחירים',
    icon: '💳',
    category: 'מבנה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'רשת תוכניות מחיר — עד תוכנית אחת מודגשת',
    params: [
      {
        name: 'items', bentmlParam: null, labelHe: 'תוכניות', type: 'list',
        itemFields: [
          { name: 'title', labelHe: 'שם התוכנית', type: 'string', required: true },
          { name: 'price', labelHe: 'מחיר', type: 'string' },
          { name: 'period', labelHe: 'תדירות', type: 'string' },
          { name: 'features', labelHe: 'תכונות (שורה לכל תכונה)', type: 'textarea' },
          { name: 'ctaLabel', labelHe: 'טקסט כפתור', type: 'string' },
          { name: 'ctaUrl', labelHe: 'קישור כפתור', type: 'string' },
          { name: 'highlighted', labelHe: 'תוכנית מומלצת', type: 'boolean' }
        ],
        hint: 'ב-BenTML: צאצאי PLAN'
      }
    ],
    textField: null,
    seed: {
      items: [
        { title: 'בסיסי', price: '49', period: '/חודש', features: 'תכונה אחת\nתכונה שנייה', ctaLabel: 'התחילו', ctaUrl: '#', highlighted: false },
        { title: 'מקצועי', price: '99', period: '/חודש', features: 'הכל בבסיסי\nעוד תכונה\nתמיכה מהירה', ctaLabel: 'התחילו', ctaUrl: '#', highlighted: true },
        { title: 'עסקי', price: '199', period: '/חודש', features: 'הכל במקצועי\nללא הגבלה\nתמיכה ייעודית', ctaLabel: 'צרו קשר', ctaUrl: '#', highlighted: false }
      ]
    }
  },
  {
    type: 'nav',
    keyword: 'NAV',
    labelHe: 'תפריט ניווט',
    icon: '≡',
    category: 'מבנה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'שורת ניווט עם צבעים (רקע + טקסט)',
    params: [
      { name: 'background', bentmlParam: 'background', labelHe: 'צבע רקע', type: 'string', default: '' },
      { name: 'color', bentmlParam: 'color', labelHe: 'צבע טקסט', type: 'string', default: '' },
      { name: 'align', bentmlParam: 'align', labelHe: 'יישור', type: 'enum', enum: ['start', 'center', 'end'], default: 'start' },
      {
        name: 'items', bentmlParam: null, labelHe: 'קישורים', type: 'list',
        itemFields: [
          { name: 'label', labelHe: 'טקסט', type: 'string', required: true },
          { name: 'href', labelHe: 'קישור', type: 'url' }
        ],
        hint: 'ב-BenTML: צאצאי NAVITEM'
      }
    ],
    textField: null,
    seed: {
      background: '', color: '', align: 'start',
      items: [
        { label: 'בית', href: '/' },
        { label: 'אודות', href: '/about' },
        { label: 'צור קשר', href: '/contact' }
      ]
    }
  },
  {
    type: 'ticker',
    keyword: 'TICKER',
    labelHe: 'מבזקים נעים',
    icon: '📰',
    category: 'מדיה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'שורת מבזקים נעה — כותרות עם קישורים (סגנון וואלה), עם צבעים ומהירות',
    params: [
      { name: 'label', labelHe: 'תווית קבועה', type: 'string', default: '' },
      {
        name: 'speed', labelHe: 'מהירות', type: 'enum',
        enum: ['slow', 'md', 'fast'], default: 'md',
        hint: 'slow = איטי, fast = מהיר'
      },
      { name: 'background', bentmlParam: 'background', labelHe: 'צבע רקע', type: 'string', default: '' },
      { name: 'color', bentmlParam: 'color', labelHe: 'צבע טקסט', type: 'string', default: '' },
      {
        name: 'items', bentmlParam: null, labelHe: 'מבזקים', type: 'list',
        itemFields: [
          { name: 'text', labelHe: 'כותרת', type: 'string', required: true },
          { name: 'href', labelHe: 'קישור', type: 'url' }
        ],
        hint: 'ב-BenTML: צאצאי TICKERITEM'
      }
    ],
    textField: null,
    seed: {
      label: 'מבזק', speed: 'md', background: '', color: '',
      items: [
        { text: 'כותרת מבזק ראשונה', href: '#' },
        { text: 'כותרת מבזק שנייה', href: '#' },
        { text: 'כותרת מבזק שלישית', href: '#' }
      ]
    }
  },
  {
    type: 'newspop',
    keyword: 'NEWSPOP',
    labelHe: 'מבזקים עם שעות',
    icon: '🕐',
    category: 'מדיה',
    bodyClass: 'blocks',
    childrenOf: null,
    hintHe: 'מבזקי חדשות עם שעות — עמודה קבועה של "שעה · כותרת" (סגנון וואלה, לא נעה)',
    params: [
      { name: 'label', labelHe: 'תווית', type: 'string', default: '' },
      {
        name: 'items', bentmlParam: null, labelHe: 'עדכונים', type: 'list',
        itemFields: [
          { name: 'time', labelHe: 'שעה', type: 'string' },
          { name: 'text', labelHe: 'כותרת', type: 'string', required: true },
          { name: 'href', labelHe: 'קישור', type: 'url' }
        ],
        hint: 'ב-BenTML: צאצאי NEWSPOPITEM'
      }
    ],
    textField: null,
    seed: {
      label: 'מבזקים',
      items: [
        { time: '12:00', text: 'עדכון ראשון', href: '#' },
        { time: '11:30', text: 'עדכון שני', href: '#' },
        { time: '11:00', text: 'עדכון שלישי', href: '#' }
      ]
    }
  },
  {
    type: 'contact-info',
    keyword: 'CONTACT',
    labelHe: 'פרטי קשר',
    icon: '☎',
    category: 'שילובים',
    bodyClass: 'none',
    childrenOf: null,
    hintHe: 'טלפון · מייל · כתובת',
    params: [
      { name: 'phone', labelHe: 'טלפון', type: 'string' },
      { name: 'email', labelHe: 'אימייל', type: 'string' },
      { name: 'address', labelHe: 'כתובת', type: 'string' },
      { name: 'hours', labelHe: 'שעות פעילות', type: 'string' }
    ],
    textField: null,
    seed: {
      phone: '',
      email: 'hello@example.com',
      address: '',
      hours: ''
    }
  },
  {
    type: 'banner',
    keyword: 'BANNER',
    labelHe: 'באנר',
    icon: '▬',
    category: 'מבנה',
    bodyClass: 'text',
    childrenOf: null,
    hintHe: 'פס הודעה עליון / מבצע',
    params: [
      {
        name: 'tone', labelHe: 'סגנון', type: 'enum',
        enum: ['brand', 'dark', 'light', 'warn'], default: 'brand'
      },
      ALIGN_PARAM
    ],
    textField: 'text',
    textFieldLabelHe: 'הודעה',
    textFieldType: 'input',
    seed: { text: 'הודעה חשובה ללקוחותינו', tone: 'brand' }
  }
];

/**
 * Universal styling params every block's data may carry
 * (BenTML §7.4 universal params; renderer.js reads data.className / data.id).
 * The admin renders these once in a shared "advanced" section — they are not
 * repeated per entry.
 */
const UNIVERSAL_PARAMS = [
  {
    name: 'className', bentmlParam: 'class', labelHe: 'CSS class',
    type: 'string', hint: 'מחלקות עיצוב מהתבנית, מופרדות ברווח'
  },
  {
    name: 'id', bentmlParam: 'id', labelHe: 'מזהה (id)',
    type: 'string', hint: 'לעוגנים ולקישורים פנימיים (#מזהה)'
  },
  {
    name: 'animate', bentmlParam: 'animate', labelHe: 'אנימציית כניסה',
    type: 'enum', enum: ['none', 'fade', 'rise', 'zoom'], default: 'none',
    hint: 'כל מודול יכול להיכנס באנימציה — fade / rise / zoom'
  }
];

/**
 * Site-level integrations defaults (NOT a block) — config/site.json shape
 * for the integrations settings screen. WhatsApp float contract: when
 * enabled and phone is non-empty, every rendered/exported public page gets
 *   <a class="whatsapp-float pos-start|pos-end"
 *      href="https://wa.me/<digits-only phone>?text=<encodeURIComponent(message)>"
 *      target="_blank" rel="noopener" aria-label="WhatsApp">…svg…</a>
 * injected in the shared layout path (serve AND static export). `position`
 * is logical: start = right on RTL pages, left on LTR.
 */
const INTEGRATIONS_DEFAULTS = {
  whatsapp: {
    enabled: false,
    phone: '',
    message: '',
    position: 'start' // enum: 'start' | 'end' (logical inline side)
  }
};

const REGISTRY_BY_TYPE = {};
for (const entry of BLOCK_REGISTRY) REGISTRY_BY_TYPE[entry.type] = entry;

/**
 * @param {string} type JSON block type (e.g. 'heading', 'map')
 * @returns {object|null} the registry entry, or null when unknown
 */
function getBlockDef(type) {
  return REGISTRY_BY_TYPE[type] || null;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Build a sensible Hebrew-default data object for a freshly added block:
 * param defaults (skipping omitDefault params, mirroring compile.js's
 * "only write when non-default" fields) merged with the entry's seed.
 *
 * @param {string} type JSON block type
 * @returns {object} data object for { type, id, data }
 */
function defaultDataFor(type) {
  const def = getBlockDef(type);
  if (!def) return {};
  const data = {};
  for (const p of def.params || []) {
    if (p.omitDefault) continue;
    if (p.default !== undefined) data[p.name] = deepClone(p.default);
  }
  if (def.seed) {
    for (const key of Object.keys(def.seed)) {
      data[key] = deepClone(def.seed[key]);
    }
  }
  return data;
}

// v1.97: entrance animation is UNIVERSAL — the language accepts animate= on
// every module (grok's game wrote it on anything), so the builder offers the
// select on every block. Injected here rather than thirty hand-edits; the
// per-def copies heading/text used to carry are replaced by this one, which
// keeps a single source of truth (and adds zoom everywhere at once).
const ANIMATE_PARAM = {
  name: 'animate', labelHe: 'אנימציית כניסה', type: 'enum',
  enum: ['none', 'fade', 'rise', 'zoom'], default: 'none', omitDefault: true,
  hint: 'fade = הופעה הדרגתית · rise = עולה בגלילה · zoom = מתקרב'
};
for (const def of BLOCK_REGISTRY) {
  if (!Array.isArray(def.params)) def.params = [];
  const i = def.params.findIndex((p) => p && p.name === 'animate');
  if (i >= 0) def.params[i] = ANIMATE_PARAM;
  else def.params.push(ANIMATE_PARAM);
}

module.exports = {
  BLOCK_REGISTRY,
  BLOCK_CATEGORIES,
  UNIVERSAL_PARAMS,
  INTEGRATIONS_DEFAULTS,
  getBlockDef,
  defaultDataFor
};
