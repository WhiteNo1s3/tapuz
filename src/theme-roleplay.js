'use strict';

/**
 * Theme Designer roleplay (v2.24) — the "injection" for a theme built from
 * the owner's imagination.
 *
 * The site-builder game (pzn/agent-roleplay.js) hands a chat the BenTML
 * vocabulary and gets a PAGE back. This is its sibling for THEMES: the
 * player describes the site they imagine ("חנות פרחים וינטג׳ פריזאית,
 * פסטל, סריפים, תחושת נייר") and the model answers with one complete
 * theme — the knobs as JSON, the skin as CSS against the theme's documented
 * skeleton, an optional effect as JS. The owner pastes the reply back into
 * /admin/theme; extractThemeReply (theme.js) takes only the theme out of it,
 * it lands in the library, the canvas shows it, one click applies it.
 *
 * Same rule as the effects prompt: a FRESH chat. A chat primed with the
 * site-builder game answers in .pzn — the wrong language for a theme.
 */

const fs = require('fs');
const path = require('path');
const theme = require('./theme');

/** The skeleton an author can style — selector → what it is. Curated, not
 *  scraped: the model needs meaning, not 400 class names. */
const SKELETON = [
  ['html / body', 'הדף כולו — רקע, גופן, צבע טקסט (הרקע מצויר על html)'],
  ['.site-header', 'הכותרת העליונה (דביקה) — לוגו + תפריט'],
  ['.header-inner', 'הפריסה הפנימית של הכותרת (flex)'],
  ['.site-logo', 'הלוגו (טקסט או תמונה)'],
  ['.site-tagline', 'משפט המותג ליד הלוגו'],
  ['.main-nav a', 'קישורי התפריט הראשי (ו-:hover)'],
  ['.header-cta .btn', 'כפתור הקריאה-לפעולה בכותרת'],
  ['.main-content', 'עמוד התוכן (max-width מהמשתנה --max-width)'],
  ['h1, h2, h3', 'כותרות — גופן מ---font-heading'],
  ['p, a', 'פסקאות וקישורים בתוכן'],
  ['.hero', 'מודול Hero — כותרת ענק + תת-כותרת + כפתור'],
  ['.btn, .btn-primary, .btn-secondary', 'כפתורים (ראשי = --accent-bg)'],
  ['.card', 'כרטיס כללי (מסגרת --color-border, רקע --color-surface)'],
  ['.bent-cards, .bent-card', 'רשת כרטיסי תוכן/מאמרים'],
  ['.article-cubes, .article-cube', 'קוביות מאמרים אוטומטיות'],
  ['.gallery', 'גלריית תמונות'],
  ['.features, .feature', 'רשת יתרונות עם אייקונים'],
  ['.testimonial', 'המלצה'],
  ['.cta-strip', 'רצועת קריאה-לפעולה (tone-brand = --accent-bg)'],
  ['.faq-list, .faq-item', 'שאלות ותשובות'],
  ['.bent-form, .bent-field, .bent-form-submit', 'טפסים ושדות'],
  ['.bent-carousel, .bent-slide', 'קרוסלה'],
  ['.bent-tabs, .bent-accordion', 'לשוניות ואקורדיון'],
  ['.bent-pricing, .bent-plan, .bent-plan-cta', 'טבלת מחירים'],
  ['.bent-team, .bent-member', 'צוות'],
  ['.bent-ticker', 'מבזקים / טקסט נע'],
  ['.site-footer', 'התחתית — עמודות, טקסט, קרדיט'],
  ['.footer-columns, .footer-col, .footer-col-title', 'עמודות התחתית'],
  ['.footer-nav a, .footer-social a', 'קישורי התחתית'],
  ['.whatsapp-float', 'כפתור וואטסאפ צף'],
  ['.skip-link', 'קישור דילוג לתוכן (נגישות) — לא לגעת']
];

const CSS_VARS = [
  ['--color-primary / --color-accent', 'הצבע הראשי (זהים)'],
  ['--color-secondary', 'הצבע המשלים (הגרדיאנט)'],
  ['--accent-bg', 'משטח הכפתורים — צבע אחיד או גרדיאנט ראשי→משלים'],
  ['--color-text / --color-muted', 'טקסט ראשי / משני'],
  ['--color-bg / --color-light-bg / --color-surface', 'רקע הדף / רקע בהיר / משטח כרטיסים'],
  ['--color-border', 'מסגרות'],
  ['--font-family / --font-heading', 'גופן טקסט / גופן כותרות'],
  ['--radius-sm / --radius-md / --radius-lg / --radius-pill', 'סולם פינות'],
  ['--shadow-1 / --shadow-2', 'סולם צללים'],
  ['--max-width', 'רוחב עמוד התוכן']
];

let moduleRootsCache = null;
/** Every .bent-* root the theme stylesheet knows — the module vocabulary,
 *  read once from the CSS so the prompt can never drift from the theme. */
function moduleRoots() {
  if (moduleRootsCache) return moduleRootsCache;
  const roots = new Set();
  try {
    const css = fs.readFileSync(path.join(require('./paths').THEMES_DIR, 'default', 'css', 'main.css'), 'utf8');
    for (const m of css.matchAll(/(?:^|[\s,])\.(bent-[a-z]+)/g)) roots.add('.' + m[1]);
  } catch (e) { /* no theme css → no roots; the curated list still stands */ }
  moduleRootsCache = [...roots].sort();
  return moduleRootsCache;
}

/** The knobs, documented one line each — the model's JSON vocabulary. */
function knobsDoc() {
  return [
    '```',
    '{',
    '  "name": "שם הערכה (חובה — קצר, בעברית)",',
    '  "colors": { "primary": "#hex", "secondary": "#hex", "text": "#hex", "muted": "#hex", "border": "#hex", "bg": "#hex", "lightBg": "#hex", "surface": "#hex" },',
    '  "fonts": { "family": "\\"Heebo\\", system-ui, sans-serif", "headingFamily": "\\"Suez One\\", serif", "baseSize": "17px", "google": ["Heebo", "Suez One"] },',
    '  "style": { "radius": "sharp|soft|round", "shadow": "flat|soft|deep", "accent": "solid|gradient", "buttons": "filled|outline|soft|glow" },',
    '  "layout": { "maxWidth": "900px|1100px", "menuPlacement": "top|side" },',
    '  "background": { "kind": "solid|gradient|glow|dots|grid|lines", "angle": 160 },',
    '  "chrome": { "menuHover": "color|underline|pill|glow", "menuHoverColor": "", "menuWeight": "normal|bold", "headerBg": "", "headerText": "", "headerGlass": false, "footerBg": "", "footerText": "" }',
    '}',
    '```',
    '',
    '- `colors`: שמונה צבעי hex. `text` על `bg` וגם על `surface` חייבים ניגודיות ≥ 4.5 (AA). `secondary` הוא בן-הזוג של `primary` בגרדיאנט.',
    '- `fonts.google`: רק משמות המדף למטה. כל גופן שמופיע ב-`family`/`headingFamily` חייב להופיע גם כאן (אחרת לא ייטען). `[]` = גופני מערכת.',
    '- `background.kind`: `solid` רקע אחיד · `gradient` מעבר bg→lightBg · `glow` הילות ראשי/משלים · `dots`/`grid`/`lines` תבניות בצבע המסגרת.',
    '- `chrome`: ריק (`""`) = ברירת המחדל של הערכה. `headerBg` כהה מחייב `headerText` בהיר.',
    '- `style.buttons`: `filled` מלא · `outline` מסגרת · `soft` רקע מוחלש · `glow` הילה.'
  ].join('\n');
}

/**
 * The whole pack.
 * @param {{ brief?: string, siteTitle?: string, description?: string, current?: object|null }} opts
 *   current — the live overrides, when the player wants to iterate ON the
 *   current theme ("make it warmer") instead of designing from scratch.
 */
function buildThemePrompt(opts = {}) {
  const brief = String(opts.brief || '').trim().slice(0, 1500);
  const lines = [];

  lines.push('# ⚠️ צ׳אט חדש בלבד (FRESH CHAT)');
  lines.push('');
  lines.push('את הבקשה הזו מדביקים ב**צ׳אט חדש לגמרי** — לא בצ׳אט שבו נבנו דפים עם');
  lines.push('תפוזיאל. צ׳אט שכבר למד את שפת ה-`.pzn` יענה במסמך דפים — וכאן מבקשים');
  lines.push('**ערכת נושא** לאתר, לא דף.');
  lines.push('');
  lines.push('# 🎨 משחק: מעצב/ת ערכות הנושא של תפוזיאל (Theme Designer Roleplay)');
  lines.push('');
  lines.push('## התפקיד שלך');
  lines.push('');
  lines.push('את/ה **מעצב/ת ערכות נושא** של אתר אמיתי. השחקן מתאר את האתר שבדמיונו —');
  lines.push('אווירה, מותג, קהל, השראות, צבעים שהוא אוהב. את/ה מתרגם/ת את הדמיון הזה');
  lines.push('לערכת נושא שלמה: פלטה, גופנים, אופי, רקע, שלד (כותרת/תפריט/תחתית), עור');
  lines.push('ב-CSS, ואם מתבקש — אפקט. ערכה, לא פלטה: הבדל שרואים מקצה לקצה.');
  lines.push('');

  lines.push('## האתר');
  lines.push('');
  lines.push(`- שם האתר: **${String(opts.siteTitle || 'האתר').trim()}**`);
  if (opts.description) lines.push(`- תיאור: ${String(opts.description).trim().slice(0, 300)}`);
  lines.push('- שפה וכיוון: **עברית, RTL** — הכול מימין לשמאל; להשתמש ב-`inset-inline-start`/`margin-inline` ולא ב-left/right.');
  if (opts.current && typeof opts.current === 'object') {
    const cur = theme.mergeDeep(theme.DEFAULT_OVERRIDES, opts.current);
    const knobs = {};
    for (const k of ['colors', 'fonts', 'style', 'layout', 'background', 'chrome']) knobs[k] = cur[k];
    lines.push('');
    lines.push('### הערכה הנוכחית — נקודת המוצא (ערכו אותה, אל תתחילו מאפס)');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(knobs, null, 2));
    lines.push('```');
    const skin = String((cur.skin && cur.skin.css) || '').trim();
    if (skin && skin.length <= 2500) {
      lines.push('');
      lines.push('העור הנוכחי (CSS):');
      lines.push('```css');
      lines.push(skin);
      lines.push('```');
    }
  }
  lines.push('');

  lines.push('## שפת הערכה — ה-JSON (המפתחות והערכים המותרים)');
  lines.push('');
  lines.push(knobsDoc());
  lines.push('');

  lines.push('## מדף הגופנים (Google Fonts עם עברית) — רק מכאן');
  lines.push('');
  lines.push(Object.keys(theme.GOOGLE_FONTS).map((f) => '`' + f + '`').join(' · '));
  lines.push('');
  lines.push('התאמה: Heebo/Rubik/Assistant לטקסט רץ · Suez One/Secular One/Karantina/Amatic SC לכותרות בעלות אופי · Frank Ruhl Libre/David Libre/Noto Serif Hebrew לסריפים · Varela Round לרך וידידותי.');
  lines.push('');

  lines.push('## השלד — הסלקטורים שהעור (CSS) מעצב');
  lines.push('');
  lines.push('| סלקטור | מה זה |');
  lines.push('|---|---|');
  for (const [sel, what] of SKELETON) lines.push(`| \`${sel}\` | ${what} |`);
  lines.push('');
  lines.push('משתני ה-CSS (ה-JSON כבר קובע אותם — ב-CSS משתמשים בהם, לא דורסים אותם):');
  lines.push('');
  for (const [v, what] of CSS_VARS) lines.push(`- \`${v}\` — ${what}`);
  const roots = moduleRoots();
  if (roots.length) {
    lines.push('');
    lines.push('שורשי המודולים (כל מודול תוכן הוא `.bent-<שם>`): ' + roots.join(' '));
  }
  lines.push('');

  lines.push('## חוקים קשיחים');
  lines.push('');
  lines.push('1. **הערכה היא כל התשובה.** בדיוק שלושה fences — `json`, `css`, `js` — בסדר הזה, ושום מילה לפניהם, ביניהם או אחריהם.');
  lines.push('2. ה-JSON חייב להיות תקין (מפתחות במירכאות כפולות, בלי הערות, בלי פסיק אחרון). רק המפתחות מהשפה למעלה.');
  lines.push('3. ה-CSS הוא **עור**: מעצב את השלד דרך הסלקטורים למעלה ומשתני ה-CSS. בלי `@import`, בלי `url(` חיצוני, בלי כתובות. 20–80 שורות — מספיק כדי שהערכה תיראה שונה, לא כדי לבנות מחדש את הדף.');
  lines.push('4. ה-JS (רק אם השחקן ביקש אפקט) הוא IIFE עצמאי, Vanilla, מחכה ל-`DOMContentLoaded`, מכבד `prefers-reduced-motion`, לא חוסם קליקים. אין ספריות, אין CDN. אם לא ביקשו — fence ריק.');
  lines.push('5. ניגודיות: `text` על `bg` ועל `surface` ≥ 4.5. כותרת כהה ⇒ `headerText` בהיר. הכפתור (לבן על `primary`) חייב להיקרא.');
  lines.push('6. RTL: שום `left`/`right` קשיח — רק ערכים לוגיים. הגופנים חייבים לתמוך בעברית (מהמדף).');
  lines.push('7. בלי `</style>` ו-`</script>` בתוך מחרוזות.');
  lines.push('8. לא לגעת ב-`.skip-link`, ולא להסתיר את התפריט או את התחתית.');
  lines.push('');

  lines.push('## פורמט התשובה — בדיוק כך');
  lines.push('');
  lines.push('```json');
  lines.push('{ "name": "…", "colors": { … }, "fonts": { … }, "style": { … }, "layout": { … }, "background": { … }, "chrome": { … } }');
  lines.push('```');
  lines.push('');
  lines.push('```css');
  lines.push('/* העור — הסלקטורים מהשלד */');
  lines.push('```');
  lines.push('');
  lines.push('```js');
  lines.push('/* ריק, או IIFE של אפקט אם התבקש */');
  lines.push('```');
  lines.push('');

  lines.push('## מהלך לדוגמה (קצר — רק כדי להראות את הצורה)');
  lines.push('');
  lines.push('```json');
  lines.push('{ "name": "לילה כחול", "colors": { "primary": "#38bdf8", "secondary": "#818cf8", "text": "#e2e8f0", "muted": "#94a3b8", "border": "#1e293b", "bg": "#0f172a", "lightBg": "#111c33", "surface": "#162036" }, "fonts": { "family": "\\"Heebo\\", system-ui, sans-serif", "headingFamily": "", "baseSize": "17px", "google": ["Heebo"] }, "style": { "radius": "soft", "shadow": "deep", "accent": "gradient", "buttons": "glow" }, "layout": { "maxWidth": "1000px", "menuPlacement": "top" }, "background": { "kind": "glow", "angle": 160 }, "chrome": { "menuHover": "glow", "menuHoverColor": "", "menuWeight": "normal", "headerBg": "", "headerText": "", "headerGlass": true, "footerBg": "#0b1220", "footerText": "#94a3b8" } }');
  lines.push('```');
  lines.push('');
  lines.push('```css');
  lines.push('.hero h1 { font-size: 3.4rem; letter-spacing: -0.02em; }');
  lines.push('.card, .bent-card { border-color: color-mix(in srgb, var(--color-primary) 30%, transparent); }');
  lines.push('.site-footer { border-top: 1px solid var(--color-border); }');
  lines.push('```');
  lines.push('');
  lines.push('```js');
  lines.push('```');
  lines.push('');

  if (brief) {
    lines.push('---');
    lines.push('');
    lines.push('## הדמיון של השחקן — עצב/י את זה עכשיו');
    lines.push('');
    lines.push(brief);
    lines.push('');
    lines.push('התשובה שלך היא הערכה בלבד — שלושת ה-fences, בלי מילה לפניהם או אחריהם.');
  } else {
    lines.push('## המשחק מתחיל עכשיו');
    lines.push('');
    lines.push('התגובה הראשונה שלך: שורה אחת בלבד — "מוכן/ה. תארו את האתר שבדמיונכם." בלי לסכם את החוקים, בלי הצעות. מהתיאור הראשון והלאה, כל תשובה שלך היא ערכה: שלושת ה-fences בלבד.');
  }

  const text = lines.join('\n');
  return { text, chars: text.length };
}

module.exports = { buildThemePrompt, SKELETON, CSS_VARS, moduleRoots };
