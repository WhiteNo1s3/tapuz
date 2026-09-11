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
               footer-bg="#292524" footer-text="#dccbb0" />
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
| `bent-layout` | `max-width` `menu=top\|side` | |
| `bent-background` | `kind=solid\|gradient\|glow\|dots\|grid\|lines` `angle` | תבניות נצבעות מהפלטה |
| `bent-chrome` | `menu-hover=color\|underline\|pill\|glow` `menu-hover-color` `menu-weight=normal\|bold` `header-bg` `header-text` `header-glass=true\|false` `footer-bg` `footer-text` | ריק = ברירת המחדל |
| `bent-skin` | `note` + `<style>` | CSS חופשי על השלד (`.site-header`, `.main-nav a`, `.hero`, `.btn-primary`, `.card`, `.bent-*`, `.site-footer`) |
| `bent-effect` | `note` + `<style>` + `<script>` | ה-JS מקומפל לפני שהוא נקלט; רץ מוגן על האתר |
| `bent-canvas` | — | הבנץ׳: מודולי `bent-*` (הדקדוק המלא ב-[SYNTAX-DICTIONARY.md](SYNTAX-DICTIONARY.md)); נשמר לצד הערכה, לא בתוכה |

כל מקטע אופציונלי; מקטע חסר משאיר את ברירת המחדל. הפרסר סלחני
(מירכאות בודדות/כפולות, שמות kebab או camel, כל סדר, פרוזה או fence מסביב),
והסריאליזציה דטרמיניסטית — `serialize(parse(doc)) === doc`.

## שורות (`bent-columns`)

שורה היא מודול העמודות של בונה הדפים — אותו מודול, אותם מאפיינים:

- `ratio="2:1:1"` — חלק לכל תא (0.2–12); ריק = חלוקה שווה
- `width=content|wide|full` — רוחב התוכן · עד 1400px · כל המסך (חורג מעמוד התוכן)
- `gap=none|sm|md|lg` · `valign=top|center|bottom|stretch`
- `collapse=sm|md|lg|never` — מאיזה רוחב מסך התאים נערמים (640 · 768 · 1024 · אף פעם)
- 1–6 תאים (`bent-col`); חמישה-שישה תאים נעטפים לרשת של 3 בטאבלט לפני שהם נערמים

## איפה זה חי

- `config/theme-overrides.json` — הערכה החיה (המודל הפנימי; ה-`.bent` הוא המעטפת החיצונית שלו)
- `config/theme-canvas.bent` — הבנץ׳ של הסטודיו, מסמך BenTML מלא
- `config/theme-library.json` — הספרייה; ערכה שהגיעה עם `bent-canvas` שומרת אותו לצדה
- קוד: [`src/bentml/theme-dialect.js`](../src/bentml/theme-dialect.js) (parse/serialize), [`src/theme.js`](../src/theme.js) (הדלתות), [`src/theme-canvas.js`](../src/theme-canvas.js) (הבנץ׳), [`src/theme-roleplay.js`](../src/theme-roleplay.js) (הפרומפט)
- שער: `npm run test:theme-studio`
