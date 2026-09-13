# `.bent` — ערכת נושא כמסמך BenTML (v2.26)

ערכת נושא בתפוזיאל היא **מסמך BenTML**, לא JSON: קובץ אחד שאפשר לקרוא, לערוך,
לשתף, לרשת ולבקש מצ׳אט לכתוב. זה מה שהסטודיו מייצא (`⬇ ייצוא .bent`), מה
שמעצב/ת הערכות ב-AI מחזיר/ה, ומה שכל דלת ייבוא מקבלת (לצד חבילת ה-JSON
הישנה, שעדיין נקראת).

```html
<bent-theme name="פריז" format="tapuz-theme" version="2">
  <bent-colors primary="#7c2d12" secondary="#b45309" text="#292524" muted="#6b5d52"
               border="#dccbb0" bg="#f6efe3" light-bg="#efe4d0" surface="#fbf7ef" />
  <bent-fonts family='"David Libre", serif' heading='"Frank Ruhl Libre", serif'
              base-size="17px" google="Frank Ruhl Libre, David Libre" />
  <bent-style radius="sharp" shadow="flat" accent="solid" buttons="outline" />
  <bent-layout max-width="1100px" menu="top" />
  <bent-background kind="lines" angle="135" />
  <bent-chrome menu-hover="underline" menu-hover-color="" menu-weight="normal"
               header-bg="" header-text="" header-glass="false"
               footer-bg="#292524" footer-text="#dccbb0"
               menu-overflow="wrap" menu-align="start" menu-gap="md" menu-size="md"
               menu-fold="0" menu-collapse="md" menu-current="underline" />
  <bent-skin note="קווים כפולים">
    <style>
.site-header { border-bottom: 3px double var(--color-border); }
    </style>
  </bent-skin>
  <bent-effect note="עקבת עכבר">
    <style>/* css */</style>
    <script>(function () { /* IIFE */ })();</script>
  </bent-effect>
  <bent-canvas>
    <bent-hero id="h1"><bent-heading level="1">פריז</bent-heading></bent-hero>
    <bent-columns id="r1" ratio="2:1:1" width="wide" valign="stretch">
      <bent-col><bent-card id="c1">…</bent-card></bent-col>
      <bent-col><bent-card id="c2">…</bent-card></bent-col>
      <bent-col><bent-form id="f1" /></bent-col>
    </bent-columns>
  </bent-canvas>
</bent-theme>
```

## המקטעים

| תגית | מאפיינים | הערות |
|---|---|---|
| `bent-colors` | `primary secondary text muted border bg light-bg surface` | hex. `text` על `bg` ועל `surface` — ניגודיות ≥ 4.5 |
| `bent-fonts` | `family heading base-size google` | `google` = משפחות Google Fonts (עברית) מופרדות בפסיק; כל גופן שב-`family`/`heading` חייב להופיע בו |
| `bent-style` | `radius=sharp\|soft\|round` `shadow=flat\|soft\|deep` `accent=solid\|gradient` `buttons=filled\|outline\|soft\|glow` | |
| `bent-layout` | `max-width` `menu=top\|side` `header-width=content\|wide\|full` | `header-width`: כרוחב התוכן · 1140px (ברירת מחדל) · מקצה לקצה |
| `bent-background` | `kind=solid\|gradient\|glow\|dots\|grid\|lines` `angle` | תבניות נצבעות מהפלטה |
| `bent-chrome` | `menu-hover=color\|underline\|pill\|glow` `menu-hover-color` `menu-weight=normal\|bold` `header-bg` `header-text` `header-glass=true\|false` `footer-bg` `footer-text` `menu-overflow=wrap\|scroll\|drawer` `menu-align=start\|center\|end\|between` `menu-gap=sm\|md\|lg` `menu-size=sm\|md\|lg` `menu-fold=0..12` `menu-collapse=sm\|md\|lg\|never` `menu-current=underline\|pill\|bold\|none` | ריק = ברירת המחדל; התפריט — ראו למטה |
| `bent-skin` | `note` + `<style>` | CSS חופשי על השלד (`.site-header`, `.main-nav a`, `.main-nav .sub-menu`, `.nav-more-sum`, `.nav-burger`, `body.menu-side`, `.hero`, `.btn-primary`, `.card`, `.bent-*`, `.site-footer`) |
| `bent-effect` | `note` + `<style>` + `<script>` | ה-JS מקומפל לפני שהוא נקלט; רץ מוגן על האתר |
| `bent-canvas` | — | הבנץ׳: מודולי `bent-*` (הדקדוק המלא ב-[SYNTAX-DICTIONARY.md](SYNTAX-DICTIONARY.md)); נשמר לצד הערכה, לא בתוכה |

כל מקטע אופציונלי; מקטע חסר משאיר את ברירת המחדל. הפרסר סלחני
(מירכאות בודדות/כפולות, שמות kebab או camel, כל סדר, פרוזה או fence מסביב),
והסריאליזציה דטרמיניסטית — `serialize(parse(doc)) === doc`.

## התפריט — הידיות על `bent-chrome` (v2.28)

התפריט נשאר CSS בלבד (בלי JavaScript בדפים): המגירה היא checkbox, תפריטי
המשנה נפתחים ב-`:hover`/`:focus-within`, והקיפול הוא `<details>`.

| מאפיין | ערכים | מה זה |
|---|---|---|
| `menu-fold` | `0..12` | כמה פריטים עליונים לפני קיפול "עוד" (`<details>`); `0` = בלי, `1` = בלי (קיפול מסתיר שניים ומעלה) |
| `menu-collapse` | `sm\|md\|lg\|never` | מאיזה רוחב מסך התפריט הופך למגירה ☰ — 560px · 720px (ברירת מחדל) · 1024px · אף פעם |
| `menu-current` | `underline\|pill\|bold\|none` | איך הדף הנוכחי מסומן (`aria-current="page"`) |

ערך לא מוכר מוחזר לברירת המחדל עם הערה בעברית (`warnings`) — אותו
מאמת (`theme.knobsToOverrides`) משרת גם את מסדר/ת התפריטים
(`<bent-menu-layout>`, [bent-menus.md](bent-menus.md)). בסטודיו: השורה
"בתפריט הראשי N פריטים · בשורה אחת נכנסים ~C" ליד הידיות באה מ-`estimateMenuFit`.

השלד שהעור יכול להלביש בתפריט: `.main-nav a` (הקישורים; כל כלל ריחוף/משקל/צבע
של הכותרת חל גם על `.nav-more-sum`), `.main-nav .sub-menu` (תפריט משנה),
`.nav-more-sum` (כפתור "עוד" — ה-`summary` של הקיפול), `.nav-burger` (☰ במסכים
צרים), `body.menu-side` (מצב מסילה צדית). משתני CSS: `--menu-gap`, `--menu-size`,
`--menu-align`, `--header-max-width`.

## שורות (`bent-columns`)

שורה היא מודול העמודות של בונה הדפים — אותו מודול, אותם מאפיינים:

- `ratio="2:1:1"` — חלק לכל תא (0.2–12); ריק = חלוקה שווה
- `width=content|wide|full` — רוחב התוכן · עד 1400px · כל המסך (חורג מעמוד התוכן)
- `gap=none|sm|md|lg` · `valign=top|center|bottom|stretch`
- `collapse=sm|md|lg|never` — מאיזה רוחב מסך התאים נערמים (640 · 768 · 1024 · אף פעם)
- 1–6 תאים (`bent-col`); חמישה-שישה תאים נעטפים לרשת של 3 בטאבלט לפני שהם נערמים

## מה הדלת סולחת (v2.27)

צ׳אטים לא מחזירים מסמכים נקיים. הדלתות (`extractThemeReply`) קוראות את
הצורות האלה כמו שהתכוונו, ומחזירות `warnings` שאומרות מה נעשה:

| מה הגיע | מה קורה |
|---|---|
| מירכאות מסולסלות (`“#7c2d12”`) | נקראות כישרות — הצבע נשאר צבע |
| `family=""Heebo", serif"` (מירכאה בתוך מירכאות) | נקרא כמשפחה מלאה |
| `<style>` ישירות ב-`bent-theme` בלי `bent-skin`, או fence של `css` ליד המסמך | העור |
| `<script>` חופשי או fence של `js` ליד המסמך | האפקט |
| כמה מסמכי `<bent-theme>` (התבנית הריקה ואז הערכה) | העשיר שבהם |
| `@import` של Google Fonts בתוך העור | מוסר; הגופנים עוברים ל-`bent-fonts google` |
| `url(https://…)` בעור או באפקט | מוסר (`none`) — האתר לא מושך משאבים מזרים |
| גופן שמופיע ב-`family` בלי `google` | נטען; `google` בלי `family` — המשפחה נקבעת |
| `rgb(…)` / צבע לא תקין | מקופל ל-hex / מושמט עם הערה |
| **דף** (`<!DOCTYPE html>` עם מודולים) במקום ערכה | נדחה בשם — `PAGE_NOT_THEME` — והסטודיו מציע לשלוח אותו לקנבס |
| בנץ׳ שלא מתקמפל | הערכה נשמרת; הבנץ׳ מדווח (`benchError`) |

## השומר של האפקט (v2.27)

באתר החי האפקט (`bent-effect`) רץ בתוך שומר (`theme.js` › `renderThemeEffectsJs`):
ה-`window`/`document` שהוא רואה הם פרוקסי, ו-`addEventListener` /
`requestAnimationFrame` / `setTimeout` / `setInterval` עטופים. בלי לגעת בקוד
של הצ׳אט זה נותן:

- **הפחתת תנועה** — גולש שביקש פחות תנועה לא מריץ את האפקט בכלל.
- **תקציב** — אלמנטים שהאפקט יוצר נספרים; יותר מ-240 בשנייה או יותר מ-400 חיים
  בו-זמנית = עצירה, והאלמנטים נמחקים.
- **קצב** — `mousemove`/`pointermove`/`touchmove` מגיעים לדף פעם בפריים;
  `setInterval` לא מתחת ל-16ms.
- **כלב שמירה** — מאזין או פריים שלוקח יותר מ-50ms שלוש פעמים, או ארבעה
  פריימים תקועים (‎>250ms) בעשר שניות = עצירה.
- **הדף של עצמו** (v2.29) — בתוך מסגרות התצוגה של האדמין (הקנבס של הסטודיו,
  תצוגת המכשירים של הבונה, תצוגת התפריט) `parent` ו-`top` היו מערכת הניהול
  עצמה. אצל האפקט הם הדף שלו, ו-`opener`/`frameElement` הם `null` — אפקט
  שנכתב מול `top.document` נוחת בדף שהוא מקשט, לא על האדמין. זה מגן מטעות,
  לא ארגז חול: האפקט עדיין קוד של בעל/ת האתר.

עצירה היא מוחלטת: המאזינים מושתקים, התזמונים נפסקים, הסיבה נרשמת ב-`console`,
ב-`window.__tapuzFx.killed`, ונשלחת לקנבס של הסטודיו שמציג אותה באדום. הפרומפט
של המעצב/ת ושל האפקטים מבקשים מראש את הצורה שלא נעצרת: מאגר קבוע של עד 30
אלמנטים, לולאת `requestAnimationFrame` אחת, `transform`/`opacity` בלבד.
שער: `npm run test:theme-guard` (מריץ את השומר בחלון מדומה).

## איפה זה חי

- `config/theme-overrides.json` — הערכה החיה (המודל הפנימי; ה-`.bent` הוא המעטפת החיצונית שלו)
- `config/theme-canvas.bent` — הבנץ׳ של הסטודיו, מסמך BenTML מלא
- `config/theme-library.json` — הספרייה; ערכה שהגיעה עם `bent-canvas` שומרת אותו לצדה
- קוד: [`src/bentml/theme-dialect.js`](../src/bentml/theme-dialect.js) (parse/serialize), [`src/theme.js`](../src/theme.js) (הדלתות), [`src/theme-canvas.js`](../src/theme-canvas.js) (הבנץ׳), [`src/theme-roleplay.js`](../src/theme-roleplay.js) (הפרומפט)
- `public/css/main.css` — האתר: הבסיס + הערכה (פלטה, גופנים, רקע, כרום, עור, אפקטים)

## הערכה היא של האתר, לא של מערכת הניהול (v2.29)

Ben: *"make the effects and fonts not interfere with the management system"*.
מסכי האדמין מקשרים **רק** את `/css/admin.css` (`src/admin-ui.js` › `layout`) —
בלי `main.css`, בלי גופני Google, בלי העור, בלי האפקט, ובלי אף משתנה של הערכה
(`--color-*`, `--font-*`, `--radius-*`). קודם האדמין קישר את `main.css` של
האתר, ובאתר החי האפקט (`html { cursor: none }`, רקע שחור `!important`, שכבת
גרעין קבועה) ישב על כל מסך ניהול; ב-v2.27 `admin-theme.css` עדיין הביא את
גודל הבסיס, גופן הכותרות והפלטה. הבסיס שהאדמין שאל מהאתר (שורש 17px / 1.7,
כותרות, פסקאות, טבעות פוקוס, `.btn`/`.card`) כתוב עכשיו בראש `admin.css`
בערכים קבועים. הערכה מוצגת באדמין רק **בתוך מסגרת תצוגה** — שם היא האתר,
והאפקט רץ בשומר (ראו "הדף של עצמו" למעלה). אם מוסיפים מסך אדמין: `layout()`
ושום `<link>` נוסף; מסך שבאמת צריך להראות את האתר — מסגרת.

- שער: `npm run test:theme-studio` · `npm run test:theme-guard` · `node scripts/smoke-admin-isolation.js` (ערכה רועשת, כל מסכי האדמין)
