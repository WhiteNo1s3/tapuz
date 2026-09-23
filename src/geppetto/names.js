'use strict';

/**
 * Layer names, read as intent (v2.57).
 *
 * A design tool's layers carry the designer's own words for what each box IS:
 * "Navigation", "Site name", "Customer Quote", "Avatar", "Icons / Social / facebook",
 * "Secondary button", "Divider", "Section heading". Geppetto's life pass reads
 * GEOMETRY — where the boxes are, how they repeat, what they hold. This module adds
 * the second reading, and the two are not equal partners:
 *
 *   a name is a HINT. It breaks a tie, it picks the module and its variant, it
 *   rescues something geometry alone would drop (four icons with no links are a
 *   social row when they are named after networks). It never overrules what the
 *   boxes plainly say, and a design with no names at all — every Canva app export,
 *   most hand-made files — behaves exactly as it did before.
 *
 * That asymmetry is deliberate: bought templates name things inconsistently, a
 * designer may call the footer "bottom thing", and half the layers in any real file
 * are `Frame 1321317456`. A hint that cannot be wrong is worth little; a hint that
 * can only help is worth having.
 *
 * `roleOf()` takes a raw layer name and answers with a role (plus the variant,
 * network or heading level the name implies) or null. Hebrew and English both:
 * an Israeli designer names layers "תפריט" and "כותרת", a bought template names
 * them "Navigation" and "Section heading".
 */

/** Figma numbers duplicate layer names: Subheading, Subheading_2, Topic_3. */
function cleanName(raw) {
  return String(raw || '')
    .replace(/_(\d+)$/, '')
    .replace(/[_/\\|>·—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A name the tool made up carries no intent: Frame 1321317456, Rectangle 2, Vector. */
const AUTO_NAME = /^(?:frame|group|rectangle|rect|ellipse|oval|vector|line|union|subtract|intersect|exclude|component|instance|layer|mask|arrow|star|polygon|shape|image|img|picture|clip|path)\s*\d*$/i;

function isAutoName(raw) {
  const n = cleanName(raw);
  return !n || AUTO_NAME.test(n) || /^[\d\s.]+$/.test(n) || /\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(n);
}

/**
 * Hebrew words need their own boundary: JavaScript's \b is built from ASCII word
 * characters, so /\bתפריט\b/ never matches. cleanName() has already collapsed every
 * separator to a single space, so the edges of a word are the string's edges or a space.
 */
function heb(...words) {
  return new RegExp('(?:^| )(?:' + words.join('|') + ')(?:$| )');
}

/**
 * The vocabulary. Each row is [what the name looks like, what it means]. Order
 * matters: the first match wins, so the specific ones ("secondary button") come
 * before the general ones ("button").
 */
const WORDS = [
  // chrome
  [/\b(?:nav(?:bar|igation)?|menu|header|top ?bar|masthead)\b/i, { role: 'nav' }],
  [heb('תפריט', 'ניווט', 'כותרת עליונה', 'הדר'), { role: 'nav' }],
  [/\b(?:footer|foot|bottom bar)\b/i, { role: 'footer' }],
  [heb('פוטר', 'תחתית', 'כותרת תחתונה'), { role: 'footer' }],
  [/\b(?:site ?name|logo(?:type|mark)?|brand(?:mark)?|wordmark)\b/i, { role: 'brand' }],
  [heb('לוגו', 'שם האתר', 'מותג'), { role: 'brand' }],

  // the things a band is made of
  [/\b(?:secondary|ghost|outline|tertiary) ?(?:button|btn|cta)\b/i, { role: 'button', variant: 'secondary' }],
  [heb('כפתור משני', 'כפתור משנה'), { role: 'button', variant: 'secondary' }],
  [/\b(?:button|btn|cta|call to action)\b/i, { role: 'button' }],
  [heb('כפתור', 'קריאה לפעולה'), { role: 'button' }],
  [/\b(?:customer |client |user )?(?:quote|testimonial|review|praise|feedback)s?\b/i, { role: 'quote' }],
  [heb('ציטוט', 'המלצה', 'המלצות', 'חוות דעת', 'ביקורת'), { role: 'quote' }],
  [/\b(?:avatar|profile ?(?:pic|photo|image)?|headshot|portrait)\b/i, { role: 'avatar' }],
  [heb('אווטר', 'תמונת פרופיל', 'דמות'), { role: 'avatar' }],
  [/\b(?:team|member|staff|people|crew)\b/i, { role: 'team' }],
  [heb('צוות', 'חבר צוות', 'העובדים', 'אנשי הצוות'), { role: 'team' }],
  [/\b(?:stat|stats|statistic|metric|kpi|number|counter)s?\b/i, { role: 'stat' }],
  [heb('מספרים', 'נתונים', 'סטטיסטיקה'), { role: 'stat' }],
  [/\b(?:card|tile)s?\b/i, { role: 'card' }],
  [heb('כרטיס', 'כרטיסים'), { role: 'card' }],
  [/\b(?:gallery|photos|images|grid of)\b/i, { role: 'gallery' }],
  [heb('גלריה', 'תמונות'), { role: 'gallery' }],
  [/\b(?:logos?|clients?|partners?|brands)\b/i, { role: 'logos' }],
  [heb('לקוחות', 'שותפים', 'לוגואים'), { role: 'logos' }],
  [/\b(?:faq|questions?|accordion)\b/i, { role: 'faq' }],
  [heb('שאלות', 'שאלות נפוצות'), { role: 'faq' }],
  [/\b(?:pricing|price|plan|package|tier)s?\b/i, { role: 'pricing' }],
  [heb('מחיר', 'מחירון', 'תמחור', 'חבילה', 'מסלול'), { role: 'pricing' }],
  [/\b(?:form|contact ?form|input|field|subscribe|newsletter)\b/i, { role: 'form' }],
  [heb('טופס', 'יצירת קשר', 'הרשמה', 'ניוזלטר'), { role: 'form' }],
  [/\b(?:divider|separator|rule|hairline)\b/i, { role: 'divider' }],
  [heb('קו מפריד', 'מפריד'), { role: 'divider' }],
  [/\b(?:hero|banner|cover|splash)\b/i, { role: 'hero' }],
  [heb('באנר', 'פתיח'), { role: 'hero' }],
  [/\b(?:icons?)\b/i, { role: 'icon' }],
  [heb('אייקון', 'סמל'), { role: 'icon' }],

  // headings, by the name the designer used
  [/\b(?:page|landing page|site|main) ?title\b/i, { role: 'heading', level: 1 }],
  [/\b(?:h1|hero ?(?:title|heading))\b/i, { role: 'heading', level: 1 }],
  [heb('כותרת ראשית', 'כותרת הדף'), { role: 'heading', level: 1 }],
  [/\b(?:section ?(?:heading|title)|h2)\b/i, { role: 'heading', level: 2 }],
  [heb('כותרת מקטע', 'כותרת אזור'), { role: 'heading', level: 2 }],
  [/\b(?:sub ?(?:heading|title)|h3|eyebrow|kicker)\b/i, { role: 'heading', level: 3, weak: true }],
  [heb('כותרת משנה', 'תת כותרת'), { role: 'heading', level: 3, weak: true }],
  [/\b(?:heading|title|headline)\b/i, { role: 'heading', weak: true }],
  [heb('כותרת'), { role: 'heading', weak: true }],
  [/\b(?:body|paragraph|copy|description|text|blurb|caption)\b/i, { role: 'body', weak: true }],
  [heb('טקסט', 'פסקה', 'תיאור'), { role: 'body', weak: true }]
];

/** The networks a social icon can be named after — the name IS the link's meaning. */
const NETWORKS = [
  ['facebook', /\b(?:facebook|fb)\b/i], ['instagram', /\b(?:instagram|insta|ig)\b/i],
  ['linkedin', /\b(?:linked ?in)\b/i], ['youtube', /\b(?:youtube|yt)\b/i],
  ['twitter', /\b(?:twitter|x ?\(twitter\))\b/i], ['tiktok', /\b(?:tik ?tok)\b/i],
  ['whatsapp', /\b(?:whats ?app)\b/i], ['telegram', /\btelegram\b/i],
  ['pinterest', /\bpinterest\b/i], ['email', /\b(?:e-?mail|mail)\b/i],
  ['phone', /\b(?:phone|tel|call)\b/i], ['github', /\bgithub\b/i]
];

/**
 * What a layer's name says it is.
 * @param {string} raw the layer name, as the design tool wrote it
 * @returns {{role: string, variant?: string, network?: string, level?: number, weak?: boolean}|null}
 */
function roleOf(raw) {
  if (isAutoName(raw)) return null;
  const name = cleanName(raw);
  const network = (NETWORKS.find((n) => n[1].test(name)) || [])[0];
  for (const [re, hint] of WORDS) {
    if (!re.test(name)) continue;
    const out = Object.assign({}, hint);
    if (network && (out.role === 'social' || out.role === 'icon' || out.role === 'button')) out.role = 'social';
    if (network) out.network = network;
    return out;
  }
  // "Icons / Social / facebook" matched 'icon' above; a bare "facebook" lands here
  if (network) return { role: 'social', network };
  return null;
}

/** Every role a box and the boxes around it were named — the nearest name wins. */
function roleIn(node, parents) {
  const own = node && roleOf(node.name);
  if (own) return own;
  for (let i = (parents || []).length - 1; i >= 0; i--) {
    const up = roleOf(parents[i] && parents[i].name);
    if (up) return up;
  }
  return null;
}

/**
 * Words a template ships with, waiting to be replaced: "Name", "Description",
 * "Body text for whatever you'd like to add more to the subheading.", "Lorem ipsum".
 * Counted in the report so the owner knows what to sweep — never dropped, because
 * a real sentence can look like a placeholder and only the owner knows.
 */
const PLACEHOLDER = [
  /^(?:lorem ipsum|dolor sit amet)/i,
  /^(?:body|small|large)? ?text (?:for|goes|here)/i,
  /^(?:sub ?heading|heading|title) (?:that|goes|here)/i,
  /^(?:your|the) (?:name|text|title|words|logo|business|company)\b/i,
  /^(?:name|description|topic|page|button|subheading|section heading|site name|label|placeholder)$/i,
  /^(?:כותרת|טקסט|תיאור|שם|כפתור|מלל)(?: כאן| לדוגמה| ראשית)?$/,
  /^(?:טקסט לדוגמה|ישראל ישראלי|שם הלקוח)/
];

function looksPlaceholder(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 140) return false;
  return PLACEHOLDER.some((re) => re.test(s));
}

module.exports = { roleOf, roleIn, cleanName, isAutoName, looksPlaceholder, _internals: { WORDS, NETWORKS, PLACEHOLDER } };
