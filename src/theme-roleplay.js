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
 *
 * v2.27 — sharpened after the misfires (Ben: "it built a theme using bentml
 * and made a mouse — it freezes and looks sloppy … trying to use bentml to
 * make a module but didn't make it right"). Two causes, both in this prompt:
 *   • it handed the model the WHOLE page vocabulary (96 tools) for the bench,
 *     so the model built pages and invented modules; now the bench speaks a
 *     curated KIT — the modules a theme is judged on, with their exact
 *     grammar generated from the registry and worked examples
 *   • it asked for an effect with no performance contract; now the effect
 *     rules are the ones the runtime guard (theme.js) enforces — a pool, one
 *     rAF loop, transform/opacity, coalesced mousemove — and the example
 *     shows the shape, so the first reply is the safe one
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
  ['.main-nav .sub-menu', 'תפריט משנה — נפתח מתחת לפריט-הורה בריחוף/מקלדת'],
  ['.nav-more-sum', 'כפתור "עוד" של הקיפול (summary) — מתלבש כמו קישור בתפריט'],
  ['.nav-burger', 'כפתור ☰ של המגירה במסכים צרים'],
  ['body.menu-side', 'האתר במצב מסילה צדית (menu="side") — התפריט אנכי'],
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
  ['--max-width', 'רוחב עמוד התוכן'],
  ['--menu-gap / --menu-size / --menu-align', 'רווח, גודל ויישור פריטי התפריט (מ-menu-gap/menu-size/menu-align)'],
  ['--header-max-width', 'רוחב הכותרת העליונה (מ-header-width)']
];

/** The bench KIT — the modules a theme is judged on. Grammar lines are
 *  generated from the registry (never hand-typed), so they cannot drift. */
const BENCH_KIT = [
  'hero', 'heading', 'text', 'button', 'image', 'divider', 'spacer',
  'columns', 'col', 'card', 'section',
  'features', 'feature', 'stats', 'stat', 'cta', 'banner',
  'testimonial', 'quote', 'faq', 'qa', 'list', 'item',
  'form', 'field', 'pricing', 'plan', 'steps', 'step', 'team', 'member',
  'gallery', 'tabs', 'tab', 'accordion', 'fold', 'logos', 'logo'
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

/** The kit's grammar, one line per tool, in the compact-dictionary format —
 *  the same renderer the site-builder's lite pack uses, on a filtered set. */
function benchKitMarkdown() {
  try {
    const dict = require('./pzn/syntax-dictionary');
    const d = dict.buildDictionary();
    const keep = new Set(BENCH_KIT);
    const categories = {};
    for (const [cat, list] of Object.entries(d.categories || {})) {
      const sub = list.filter((m) => keep.has(m.name));
      if (sub.length) categories[cat] = sub;
    }
    return dict.toCompactMarkdown({ ...d, categories }, { locale: 'he', ranges: true })
      .replace(/^## [^\n]*\n/, '')
      .trim();
  } catch (e) {
    return '';
  }
}

/** The theme document, documented one line each — the model's vocabulary. */
function knobsDoc() {
  return [
    '```html',
    '<bent-theme name="שם הערכה (חובה — קצר, בעברית)" version="2">',
    '  <bent-colors primary="#hex" secondary="#hex" text="#hex" muted="#hex" border="#hex" bg="#hex" light-bg="#hex" surface="#hex" />',
    '  <bent-fonts family=\'"Heebo", system-ui, sans-serif\' heading=\'"Suez One", serif\' base-size="17px" google="Heebo, Suez One" />',
    '  <bent-style radius="sharp|soft|round" shadow="flat|soft|deep" accent="solid|gradient" buttons="filled|outline|soft|glow" />',
    '  <bent-layout max-width="900px|1100px|1200px" menu="top|side" header-width="content|wide|full" />',
    '  <bent-background kind="solid|gradient|glow|dots|grid|lines" angle="160" />',
    '  <bent-chrome menu-hover="color|underline|pill|glow" menu-hover-color="" menu-weight="normal|bold" menu-overflow="wrap|scroll|drawer" menu-align="start|center|end|between" menu-gap="sm|md|lg" menu-size="sm|md|lg" menu-fold="0" menu-collapse="sm|md|lg|never" menu-current="underline|pill|bold|none" header-bg="" header-text="" header-glass="true|false" footer-bg="" footer-text="" />',
    '  <bent-skin note="מה העור עושה"><style>/* CSS על השלד */</style></bent-skin>',
    '  <bent-effect note="מה האפקט"><style>/* css */</style><script>/* IIFE */</script></bent-effect>',
    '  <bent-canvas>',
    '    <!-- הקנבס: מודולי bent-* מהערכה למטה, בשורות, שמציגים את הערכה במיטבה -->',
    '  </bent-canvas>',
    '</bent-theme>',
    '```',
    '',
    '- `bent-colors`: שמונה צבעי hex (רק `#rrggbb` — לא שמות, לא rgb). `text` על `bg` וגם על `surface` חייבים ניגודיות ≥ 4.5 (AA). `secondary` הוא בן-הזוג של `primary` בגרדיאנט.',
    '- `bent-fonts google`: רק משמות המדף למטה, מופרדים בפסיק. כל גופן שמופיע ב-`family`/`heading` חייב להופיע גם ב-`google` (אחרת לא ייטען). בלי `google` = גופני מערכת. ערכי משפחה עם מירכאות כפולות עוטפים במירכאות **בודדות** — `family=\'"Heebo", sans-serif\'`.',
    '- `bent-background kind`: `solid` אחיד · `gradient` מעבר bg→light-bg · `glow` הילות ראשי/משלים · `dots`/`grid`/`lines` תבניות בצבע המסגרת.',
    '- `bent-chrome`: ערך ריק (`""`) = ברירת המחדל של הערכה. `header-bg` כהה מחייב `header-text` בהיר. **התפריט**: `menu="side"` ב-`bent-layout` = מסילה אנכית (מתאימה ל-8+ פריטים); `header-width` = כמה רחבה הכותרת (`wide` = 1140px, `full` = מקצה לקצה); `menu-overflow` = מה קורה לתפריט ארוך: `wrap` נשבר לשורה שנייה · `scroll` רצועה אחת שנגללת · `drawer` כפתור ☰ בכל רוחב; `menu-align` יישור; `menu-gap`/`menu-size` צפיפות וגודל; `menu-fold` = כמה פריטים עליונים לפני קיפול "עוד" (0 = בלי; מתאים ל-8+ פריטים); `menu-collapse` = מאיזה רוחב מסך התפריט הופך למגירה ☰ (`sm` 560px · `md` 720px · `lg` 1024px · `never`); `menu-current` = איך הדף הנוכחי מסומן (קו תחתון · גלולה · מודגש · בלי). תפריטי משנה נפתחים בריחוף/מקלדת מעצמם.',
    '- `bent-style buttons`: `filled` מלא · `outline` מסגרת · `soft` רקע מוחלש · `glow` הילה.',
    '- `bent-skin`: ה-CSS חי בתוך `<style>` **בתוך `bent-skin`** — לא `<style>` חופשי, לא fence נפרד. `bent-effect`: css ב-`<style>`, JS ב-`<script>` (IIFE). בלי `</style>`/`</script>` בתוך מחרוזות.',
    '- `bent-canvas`: הבנץ׳ — מודולים מהערכה למטה (ורק ממנה). שורה = `<bent-columns ratio="2:1:1" width="content|wide|full" gap="none|sm|md|lg" valign="top|center|bottom|stretch" collapse="sm|md|lg|never">` עם `<bent-col>` לכל תא (2–6). `width="wide"` חורג מעמוד התוכן עד 1400px, `full` = כל המסך. חמישה מודולים בשורה = 5 תאים.',
    '',
    '(פורמט JSON ישן עם אותם מפתחות עדיין מתקבל בהדבקה — אבל המסמך `<bent-theme>` הוא מה שמוחזר.)'
  ].join('\n');
}

/** Worked examples of the containers models get wrong — the exact child
 *  tag each one takes, because "cards" holding "card" is the misfire. */
function benchExamples() {
  return [
    '```html',
    '<bent-hero id="h1" height="md"><bent-heading level="1">כותרת</bent-heading><bent-text>משפט אחד</bent-text><bent-button href="#" variant="primary">כפתור</bent-button></bent-hero>',
    '<bent-columns id="r1" ratio="1:1:1" width="wide" valign="stretch">',
    '  <bent-col><bent-card id="c1"><bent-heading level="3">כרטיס</bent-heading><bent-text>טקסט קצר</bent-text></bent-card></bent-col>',
    '  <bent-col><bent-card id="c2"><bent-heading level="3">כרטיס</bent-heading><bent-text>טקסט קצר</bent-text></bent-card></bent-col>',
    '  <bent-col><bent-card id="c3"><bent-heading level="3">כרטיס</bent-heading><bent-text>טקסט קצר</bent-text></bent-card></bent-col>',
    '</bent-columns>',
    '<bent-features id="f1" columns="3"><bent-feature icon="⚡" title="מהיר">משפט</bent-feature><bent-feature icon="🔒" title="בטוח">משפט</bent-feature><bent-feature icon="❤" title="קרוב">משפט</bent-feature></bent-features>',
    '<bent-pricing id="p1"><bent-plan title="בסיסי" price="₪99" period="לחודש" features="דף אחד|תמיכה" ctaLabel="בחרו" ctaUrl="#" /><bent-plan title="מקצועי" price="₪199" period="לחודש" features="הכול|עדיפות" ctaLabel="בחרו" ctaUrl="#" highlighted="true" /></bent-pricing>',
    '<bent-form id="fm1" submit="שלחו"><bent-field label="שם" name="name" type="text" required="true" /><bent-field label="אימייל" name="email" type="email" required="true" /><bent-field label="הודעה" name="msg" type="textarea" /></bent-form>',
    '<bent-faq id="q1"><bent-qa question="שאלה?">תשובה קצרה.</bent-qa><bent-qa question="עוד שאלה?">תשובה.</bent-qa></bent-faq>',
    '<bent-testimonial id="t1" author="דנה" role="לקוחה">משפט המלצה.</bent-testimonial>',
    '<bent-cta id="cta1" title="מוכנים?" buttontext="דברו איתנו" url="#" tone="brand">משפט קצר.</bent-cta>',
    '```'
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
  lines.push('## מה זה **לא**');
  lines.push('');
  lines.push('לא דף ולא אתר. אם מצאת את עצמך כותב/ת `<!DOCTYPE html>`, `<div>`, `<section>`, `class="…"` או `<style>` חופשי — עצור/י: זו שפת הדפים, לא ערכה. ערכה = הידיות (`bent-colors`…`bent-chrome`) + עור (`bent-skin`) + אפקט אופציונלי (`bent-effect`) + בנץ׳ (`bent-canvas`) שמורכב **רק** מהמודולים שבערכה למטה, בדיוק בדקדוק שלהם. מודול שלא ברשימה — לא קיים. מאפיין שלא ברשימה — לא קיים.');
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

  lines.push('## שפת הערכה — המסמך (המפתחות והערכים המותרים)');
  lines.push('');
  lines.push(knobsDoc());
  lines.push('');

  lines.push('## מדף הגופנים (Google Fonts עם עברית) — רק מכאן');
  lines.push('');
  lines.push(Object.keys(theme.GOOGLE_FONTS).map((f) => '`' + f + '`').join(' · '));
  lines.push('');
  lines.push('התאמה: Heebo/Rubik/Assistant לטקסט רץ · Suez One/Secular One/Karantina/Amatic SC לכותרות בעלות אופי · Frank Ruhl Libre/David Libre/Noto Serif Hebrew לסריפים · Varela Round לרך וידידותי.');
  lines.push('');

  lines.push('## ערכת המודולים של הבנץ׳ — למסמך ה-`bent-canvas` (זה כל המילון, שורה לכלי)');
  lines.push('');
  const kit = benchKitMarkdown();
  if (kit) lines.push(kit);
  lines.push('');
  lines.push('שימו לב לילדים: `bent-features` ⊃ `bent-feature` · `bent-faq` ⊃ `bent-qa` · `bent-pricing` ⊃ `bent-plan` · `bent-form` ⊃ `bent-field` · `bent-stats` ⊃ `bent-stat` · `bent-steps` ⊃ `bent-step` · `bent-team` ⊃ `bent-member` · `bent-list` ⊃ `bent-item` · `bent-columns` ⊃ `bent-col` (ובתוך `bent-col`: כל מודול, למשל `bent-card`). כרטיס בודד הוא `bent-card` בתוך `bent-col` — לא `bent-cards`.');
  lines.push('');
  lines.push('### דוגמאות מדויקות (מודולים שנוטים להישבר)');
  lines.push('');
  lines.push(benchExamples());
  lines.push('');
  lines.push('## השלד — הסלקטורים שהעור (CSS) מעצב');
  lines.push('');
  lines.push('| סלקטור | מה זה |');
  lines.push('|---|---|');
  for (const [sel, what] of SKELETON) lines.push(`| \`${sel}\` | ${what} |`);
  lines.push('');
  lines.push('משתני ה-CSS (הידיות כבר קובעות אותם — ב-CSS משתמשים בהם, לא דורסים אותם):');
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
  lines.push('1. **הערכה היא כל התשובה.** fence אחד של `html` עם מסמך `<bent-theme>` שלם — ושום מילה לפניו או אחריו. הדבקה של התשובה כמו-שהיא חייבת להתקבל. לא להחזיר את התבנית הריקה — רק את הערכה.');
  lines.push('2. רק התגיות והמאפיינים מהשפה למעלה. מאפיין שלא רלוונטי — משמיטים (לא ממציאים). מירכאות ישרות בלבד (`"`), לא מסולסלות. ערך שכתוב בשפה כ-`a|b|c` הוא רשימת אפשרויות — כותבים אחת בלבד, לא את הרשימה.');
  lines.push('3. ה-CSS ב-`bent-skin` הוא **עור — קוסמטיקה על השלד**: צבעים, מסגרות, צללים, פינות, גופנים, ריווח, טיפוגרפיה. לא `display`/`position`/`float`/`width` על השלד, לא `display:none` על תפריט/כותרת/תחתית, לא `overflow:hidden` על body. בלי `@import`, בלי `url(` חיצוני, בלי כתובות. 20–80 שורות — מספיק כדי שהערכה תיראה שונה, לא כדי לבנות מחדש את הדף.');
  lines.push('4. `bent-effect` רק אם השחקן ביקש אפקט — ואז **קל כמו נוצה**: IIFE עצמאי, Vanilla, מחכה ל-`DOMContentLoaded`, מכבד `prefers-reduced-motion`, לא חוסם קליקים (`pointer-events:none` על האלמנטים שלו). **מאגר קבוע** של עד 30 אלמנטים שנוצרים פעם אחת וממוחזרים — לעולם לא אלמנט חדש בכל `mousemove`. `mousemove` רק שומר את המיקום האחרון; הציור קורה ב-**לולאת `requestAnimationFrame` אחת**, עם `transform`/`opacity` בלבד (לא top/left, לא width/height). בלי `setInterval` מתחת ל-16ms, בלי לולאות אינסופיות, בלי ספריות, בלי CDN. עד 60 שורות. לא ביקשו — משמיטים את התגית.');
  lines.push('5. ניגודיות: `text` על `bg` ועל `surface` ≥ 4.5. כותרת כהה ⇒ `header-text` בהיר. הכפתור (לבן על `primary`) חייב להיקרא.');
  lines.push('6. RTL: שום `left`/`right` קשיח — רק ערכים לוגיים. הגופנים חייבים לתמוך בעברית (מהמדף).');
  lines.push('7. בלי `</style>` ו-`</script>` בתוך מחרוזות.');
  lines.push('8. לא לגעת ב-`.skip-link`, ולא להסתיר את התפריט או את התחתית.');
  const benchHasModules = Array.isArray(opts.canvasModules) && opts.canvasModules.filter(Boolean).length > 0;
  lines.push(benchHasModules
    ? '9. **הקנבס כבר מלא** במודולים של השחקן (למעלה) — לא להחזיר `bent-canvas` אלא אם ביקשו במפורש קנבס חדש.'
    : '9. **`bent-canvas` חובה**: 4–8 מודולים אמיתיים מערכת הבנץ׳ בלבד, בשורות (`bent-columns` עם 2–5 תאים כשמתאים), עם תוכן עברי קצר ואמין — כרטיסים, יתרונות, מחירון, טופס, המלצה — שמראים את הערכה במיטבה. `id` קצר וייחודי לכל מודול. זה מה שהשחקן יראה בקנבס.');
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

  lines.push('## מהלך לדוגמה (קצר — רק כדי להראות את הצורה, כולל אפקט קל)');
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
  lines.push('  <bent-effect note="הילה רכה אחרי העכבר"><style>');
  lines.push('.tz-glow { position: fixed; inset-inline-start: 0; top: 0; width: 18px; height: 18px; border-radius: 50%; pointer-events: none; z-index: 9999; background: radial-gradient(var(--color-primary), transparent 70%); opacity: 0; will-change: transform, opacity; }');
  lines.push('@media (prefers-reduced-motion: reduce) { .tz-glow { display: none; } }');
  lines.push('  </style><script>');
  lines.push('(function () {');
  lines.push('  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;');
  lines.push('  var N = 12, dots = [], x = 0, y = 0, ready = false;');
  lines.push('  document.addEventListener("DOMContentLoaded", function () {');
  lines.push('    for (var i = 0; i < N; i++) { var d = document.createElement("span"); d.className = "tz-glow"; document.body.appendChild(d); dots.push({ el: d, x: 0, y: 0 }); }');
  lines.push('    document.addEventListener("mousemove", function (e) { x = e.clientX; y = e.clientY; ready = true; });');
  lines.push('    requestAnimationFrame(loop);');
  lines.push('  });');
  lines.push('  function loop() {');
  lines.push('    var tx = x, ty = y;');
  lines.push('    for (var i = 0; i < dots.length; i++) { var d = dots[i]; d.x += (tx - d.x) * 0.35; d.y += (ty - d.y) * 0.35; d.el.style.transform = "translate(" + (d.x - 9) + "px," + (d.y - 9) + "px)"; d.el.style.opacity = ready ? String(1 - i / N) : "0"; tx = d.x; ty = d.y; }');
  lines.push('    requestAnimationFrame(loop);');
  lines.push('  }');
  lines.push('})();');
  lines.push('  </script></bent-effect>');
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

module.exports = { buildThemePrompt, SKELETON, CSS_VARS, BENCH_KIT, moduleRoots, benchKitMarkdown };
