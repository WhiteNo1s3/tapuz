'use strict';

/**
 * Theme Designer roleplay (v2.24) — the "injection" for a theme built from
 * the owner's imagination.
 *
 * The site-builder game (pzn/agent-roleplay.js) hands a chat the BenTML
 * vocabulary and gets a PAGE back. This is its sibling for THEMES: the
 * player describes the site they imagine ("חנות פרחים וינטג׳ פריזאית,
 * פסטל, סריפים, תחושת נייר") and the model answers with one complete
 * theme as ONE `.bent` document (bentml/theme-dialect.js): the knobs as
 * section tags, the skin as <style>, an optional effect as <script>, and the
 * bench — the modules that show the theme off — as <bent-canvas>. The owner
 * pastes the reply back into /admin/theme; extractThemeReply (theme.js)
 * takes only the theme out of it, it lands in the library, the canvas shows
 * it, one click applies it.
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

/** The theme document, documented one line each — the model's vocabulary. */
function knobsDoc() {
  return [
    '```html',
    '<bent-theme name="שם הערכה (חובה — קצר, בעברית)" version="2">',
    '  <bent-colors primary="#hex" secondary="#hex" text="#hex" muted="#hex" border="#hex" bg="#hex" light-bg="#hex" surface="#hex" />',
    '  <bent-fonts family=\'"Heebo", system-ui, sans-serif\' heading=\'"Suez One", serif\' base-size="17px" google="Heebo, Suez One" />',
    '  <bent-style radius="sharp|soft|round" shadow="flat|soft|deep" accent="solid|gradient" buttons="filled|outline|soft|glow" />',
    '  <bent-layout max-width="900px|1100px|1200px" menu="top|side" />',
    '  <bent-background kind="solid|gradient|glow|dots|grid|lines" angle="160" />',
    '  <bent-chrome menu-hover="color|underline|pill|glow" menu-hover-color="" menu-weight="normal|bold" header-bg="" header-text="" header-glass="true|false" footer-bg="" footer-text="" />',
    '  <bent-skin note="מה העור עושה"><style>/* CSS על השלד */</style></bent-skin>',
    '  <bent-effect note="מה האפקט"><style>/* css */</style><script>/* IIFE */</script></bent-effect>',
    '  <bent-canvas>',
    '    <!-- הקנבס: מודולי bent-* בשורות שמציגים את הערכה במיטבה -->',
    '  </bent-canvas>',
    '</bent-theme>',
    '```',
    '',
    '- `bent-colors`: שמונה צבעי hex. `text` על `bg` וגם על `surface` חייבים ניגודיות ≥ 4.5 (AA). `secondary` הוא בן-הזוג של `primary` בגרדיאנט.',
    '- `bent-fonts google`: רק משמות המדף למטה, מופרדים בפסיק. כל גופן שמופיע ב-`family`/`heading` חייב להופיע גם ב-`google` (אחרת לא ייטען). בלי `google` = גופני מערכת. ערכי משפחה עם מירכאות כפולות עוטפים במירכאות בודדות.',
    '- `bent-background kind`: `solid` אחיד · `gradient` מעבר bg→light-bg · `glow` הילות ראשי/משלים · `dots`/`grid`/`lines` תבניות בצבע המסגרת.',
    '- `bent-chrome`: ערך ריק (`""`) = ברירת המחדל של הערכה. `header-bg` כהה מחייב `header-text` בהיר.',
    '- `bent-style buttons`: `filled` מלא · `outline` מסגרת · `soft` רקע מוחלש · `glow` הילה.',
    '- `bent-skin`: ה-CSS חי בתוך `<style>`; `bent-effect`: css ב-`<style>`, JS ב-`<script>` (IIFE). בלי `</style>`/`</script>` בתוך מחרוזות.',
    '- `bent-canvas`: הבנץ׳ — מסמך מודולים לפי הדקדוק למטה. שורה = `<bent-columns ratio="2:1:1" width="content|wide|full" gap="none|sm|md|lg" valign="top|center|bottom|stretch" collapse="sm|md|lg|never">` עם `<bent-col>` לכל תא (2–6). `width="wide"` חורג מעמוד התוכן עד 1400px, `full` = כל המסך. חמישה מודולים בשורה = 5 תאים.',
    '',
    '(פורמט JSON ישן עם אותם מפתחות עדיין מתקבל בהדבקה — אבל המסמך `<bent-theme>` הוא מה שמוחזר.)'
  ].join('\n');
}

/**
 * The whole pack.
 * @param {{ brief?: string, siteTitle?: string, description?: string, current?: object|null, canvasModules?: string[] }} opts
 *   canvasModules — the module types on the theme canvas (theme-canvas.js), so
 *   the skin dresses what the owner will actually look at.
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

  lines.push('## דקדוק המודולים — למסמך ה-`bent-canvas` (זה כל המילון, שורה לכלי)');
  lines.push('');
  try {
    const dict = require('./pzn/syntax-dictionary');
    lines.push(dict.toCompactMarkdown(dict.buildDictionary()).replace(/^## [^\n]*\n/, '').trim());
  } catch (e) { /* no dictionary → the skeleton below still stands */ }
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
  const onCanvas = Array.isArray(opts.canvasModules) ? opts.canvasModules.filter(Boolean) : [];
  if (onCanvas.length) {
    lines.push('');
    lines.push('### המודולים שעל הקנבס של השחקן — העור חייב להלביש את אלה (הם מה שיוצג)');
    lines.push('');
    lines.push(onCanvas.map((t) => '`' + t + '`').join(' · '));
    lines.push('');
    lines.push('(מודול `X` מעוצב דרך `.bent-X` — למשל `cards` → `.bent-cards`/`.bent-card`; `hero` → `.hero`; `form` → `.bent-form`; `features` → `.features`/`.feature`.)');
  }
  lines.push('');

  lines.push('## חוקים קשיחים');
  lines.push('');
  lines.push('1. **הערכה היא כל התשובה.** fence אחד של `html` עם מסמך `<bent-theme>` שלם — ושום מילה לפניו או אחריו. הדבקה של התשובה כמו-שהיא חייבת להתקבל.');
  lines.push('2. רק התגיות והמאפיינים מהשפה למעלה. מאפיין שלא רלוונטי — משמיטים (לא ממציאים).');
  lines.push('3. ה-CSS ב-`bent-skin` הוא **עור**: מעצב את השלד דרך הסלקטורים למטה ומשתני ה-CSS. בלי `@import`, בלי `url(` חיצוני, בלי כתובות. 20–80 שורות — מספיק כדי שהערכה תיראה שונה, לא כדי לבנות מחדש את הדף.');
  lines.push('4. `bent-effect` רק אם השחקן ביקש אפקט: IIFE עצמאי, Vanilla, מחכה ל-`DOMContentLoaded`, מכבד `prefers-reduced-motion`, לא חוסם קליקים. אין ספריות, אין CDN. לא ביקשו — משמיטים את התגית.');
  lines.push('5. ניגודיות: `text` על `bg` ועל `surface` ≥ 4.5. כותרת כהה ⇒ `headerText` בהיר. הכפתור (לבן על `primary`) חייב להיקרא.');
  lines.push('6. RTL: שום `left`/`right` קשיח — רק ערכים לוגיים. הגופנים חייבים לתמוך בעברית (מהמדף).');
  lines.push('7. בלי `</style>` ו-`</script>` בתוך מחרוזות.');
  lines.push('8. לא לגעת ב-`.skip-link`, ולא להסתיר את התפריט או את התחתית.');
  const benchHasModules = Array.isArray(opts.canvasModules) && opts.canvasModules.filter(Boolean).length > 0;
  lines.push(benchHasModules
    ? '9. **הקנבס כבר מלא** במודולים של השחקן (למעלה) — לא להחזיר `bent-canvas` אלא אם ביקשו במפורש קנבס חדש.'
    : '9. **`bent-canvas` חובה**: 4–8 מודולים אמיתיים בשורות (`bent-columns` עם 2–5 תאים כשמתאים), עם תוכן עברי קצר ואמין — כרטיסים, יתרונות, מחירון, טופס, המלצה — שמראים את הערכה במיטבה. זה מה שהשחקן יראה בקנבס.');
  lines.push('');

  lines.push('## פורמט התשובה — בדיוק כך: fence אחד, מסמך אחד');
  lines.push('');
  lines.push('```html');
  lines.push('<bent-theme name="…" version="2">');
  lines.push('  <bent-colors … /> <bent-fonts … /> <bent-style … /> <bent-layout … /> <bent-background … /> <bent-chrome … />');
  lines.push('  <bent-skin><style>…</style></bent-skin>');
  lines.push('  <bent-canvas>…</bent-canvas>');
  lines.push('</bent-theme>');
  lines.push('```');
  lines.push('');

  lines.push('## מהלך לדוגמה (קצר — רק כדי להראות את הצורה)');
  lines.push('');
  lines.push('```html');
  lines.push('<bent-theme name="לילה כחול" version="2">');
  lines.push('  <bent-colors primary="#38bdf8" secondary="#818cf8" text="#e2e8f0" muted="#94a3b8" border="#1e293b" bg="#0f172a" light-bg="#111c33" surface="#162036" />');
  lines.push('  <bent-fonts family=\'"Heebo", system-ui, sans-serif\' base-size="17px" google="Heebo" />');
  lines.push('  <bent-style radius="soft" shadow="deep" accent="gradient" buttons="glow" />');
  lines.push('  <bent-layout max-width="1100px" menu="top" />');
  lines.push('  <bent-background kind="glow" angle="160" />');
  lines.push('  <bent-chrome menu-hover="glow" header-glass="true" footer-bg="#0b1220" footer-text="#94a3b8" />');
  lines.push('  <bent-skin note="כותרת ענק, מסגרות זוהרות"><style>');
  lines.push('.hero h1 { font-size: 3.4rem; letter-spacing: -0.02em; }');
  lines.push('.card, .bent-card { border-color: color-mix(in srgb, var(--color-primary) 30%, transparent); }');
  lines.push('  </style></bent-skin>');
  lines.push('  <bent-canvas>');
  lines.push('    <bent-hero id="h1"><bent-heading level="1">לילה כחול</bent-heading><bent-text>ערכה כהה עם הילות</bent-text><bent-button href="#" variant="primary">התחילו</bent-button></bent-hero>');
  lines.push('    <bent-columns id="r1" ratio="1:1:1" valign="stretch" width="wide">');
  lines.push('      <bent-col><bent-card id="c1"><bent-heading level="3">מהיר</bent-heading><bent-text>טקסט קצר</bent-text></bent-card></bent-col>');
  lines.push('      <bent-col><bent-card id="c2"><bent-heading level="3">בטוח</bent-heading><bent-text>טקסט קצר</bent-text></bent-card></bent-col>');
  lines.push('      <bent-col><bent-card id="c3"><bent-heading level="3">קרוב</bent-heading><bent-text>טקסט קצר</bent-text></bent-card></bent-col>');
  lines.push('    </bent-columns>');
  lines.push('  </bent-canvas>');
  lines.push('</bent-theme>');
  lines.push('```');
  lines.push('');
  if (brief) {
    lines.push('---');
    lines.push('');
    lines.push('## הדמיון של השחקן — עצב/י את זה עכשיו');
    lines.push('');
    lines.push(brief);
    lines.push('');
    lines.push('התשובה שלך היא הערכה בלבד — fence אחד של html עם `<bent-theme>` שלם, בלי מילה לפניו או אחריו.');
  } else {
    lines.push('## המשחק מתחיל עכשיו');
    lines.push('');
    lines.push('התגובה הראשונה שלך: שורה אחת בלבד — "מוכן/ה. תארו את האתר שבדמיונכם." בלי לסכם את החוקים, בלי הצעות. מהתיאור הראשון והלאה, כל תשובה שלך היא ערכה: מסמך `<bent-theme>` אחד בלבד.');
  }

  const text = lines.join('\n');
  return { text, chars: text.length };
}

module.exports = { buildThemePrompt, SKELETON, CSS_VARS, moduleRoots };
