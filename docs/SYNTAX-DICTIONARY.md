# BenTML Syntax Dictionary

> **Single source of truth for modules + agent syntax.**
> Generated from `src/block-registry.js`. Do not hand-edit module tables — change the registry, then run:
> `node scripts/gen-syntax-dictionary.js`

Agents write BenTML. Builder shows modules. TEXT is the only deep container (paragraphs + inline marks).

## Document shape

```
BENTML 0.1
META { title: "..."  …page metadata / SEO… }
BODY: KEYWORD(params) { … } | KEYWORD(params)
```

## TEXT is the advanced container

Other modules stay sharp and simple. **TEXT** carries paragraphs + inline marks:

- `@B{…}` — bold
- `@I{…}` — italic
- `@LINK(url: "…"){…}` — link
- `@CODE{…}` — monospace
- `@BREAK` — line break

- Blank line = new paragraph
- Marks only inside TEXT, HEADING, QUOTE, TESTIMONIAL, ITEM bodies
- No Markdown ** or [x](url)

## Modules (40)

### תוכן

#### `HERO` → `hero`

★ **פתיח (Hero)** — כותרת גדולה בראש הדף

Shape: `HERO(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `title` | `—` | string |  |  |
| `subtitle` | `—` | string |  |  |
| `buttonText` | `—` | string |  |  |
| `buttonUrl` | `—` | url |  |  |
| `image` | `image` | media |  |  |
| `height` | `height` | enum sm\|md\|lg\|full |  | "md" |
| `overlay` | `overlay` | integer |  | 0 |
| `parallax` | `parallax` | boolean |  | false |

```bentml
HERO {
  HEADING(level: 1) { כותרת }
  TEXT { משנה }
  BUTTON(url: "#") { CTA }
}
```

#### `HEADING` → `heading`

H **כותרת** — H1–H6

Shape: `HEADING(params) { text body }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `level` | `level` | integer |  | 2 |
| `align` | `align` | enum start\|center\|end |  | "start" |
| `animate` | `animate` | enum none\|fade\|rise |  | "none" |

```bentml
HEADING(level: 2) {
  כותרת
}
```

#### `TEXT` → `text` · **advanced**

¶ **טקסט** — מיכל מתקדם — פסקאות + @B @I @LINK

Shape: `TEXT(params) { text body }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `align` | `align` | enum start\|center\|end |  | "start" |
| `size` | `size` | enum sm\|md\|lg |  | "md" |
| `lead` | `lead` | boolean |  | false |
| `dropcap` | `dropcap` | boolean |  | false |
| `maxWidth` | `maxwidth` | enum sm\|md\|lg\|full |  | "full" |
| `animate` | `animate` | enum none\|fade\|rise |  | "none" |

```bentml
TEXT(size: md) {
  פסקה ראשונה עם @B{הדגשה}.

  פסקה שנייה.
}
```

#### `BUTTON` → `button`

◉ **כפתור** — קישור / CTA

Shape: `BUTTON(params) { text body }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `url` | `url` | url | yes |  |
| `variant` | `style` | enum primary\|secondary\|outline |  | "primary" |
| `align` | `align` | enum start\|center\|end |  | "start" |
| `rel` | `rel` | string |  | "" |
| `target` | `target` | enum _self\|_blank |  | "_self" |
| `title` | `title` | string |  | "" |

```bentml
BUTTON(url: "/contact", style: primary) {
  לחץ כאן
}
```

#### `QUOTE` → `quote`

❞ **ציטוט** — ציטוט מובלט

Shape: `QUOTE(params) { text body }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `author` | `author` | string |  |  |

```bentml
QUOTE {
  …
}
```

#### `TESTIMONIAL` → `testimonial`

❝ **המלצה** — ציטוט + שם

Shape: `TESTIMONIAL(params) { text body }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `author` | `author` | string |  |  |
| `role` | `role` | string |  |  |

```bentml
TESTIMONIAL {
  …
}
```

#### `LIST` → `list`

≡ **רשימה** — נקודות / ממוספרת

Shape: `LIST(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `ordered` | `type` | boolean |  | false |
| `items` | `—` | list |  |  |

```bentml
LIST {
  ITEM { - פריט }
  ITEM { - פריט }
}
```

#### `FEATURES` → `features`

▦ **תכונות** — רשת כרטיסי תכונות

Shape: `FEATURES(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `columns` | `columns` | integer |  | 3 |
| `items` | `—` | list |  |  |

```bentml
FEATURES(columns: 2) {
  FEATURE(title: "יתרון") { תיאור }
}
```

#### `ARTICLES` → `article-list`

⊞ **מאמרים** — קוביות מאמרים דינמיות

Shape: `ARTICLES(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `tag` | `tag` | string |  | "article" |
| `limit` | `limit` | integer |  | 6 |
| `columns` | `columns` | integer |  | 3 |

```bentml
ARTICLES(tag: "article", limit: 6, columns: 3)
```

#### `CATEGORY` → `category`

🗂 **קטגוריה** — כותרת קטגוריה ממותגת + רשת הכתבות שלה — מנוהל במסך "קטגוריות"

Shape: `CATEGORY(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `slug` | `slug` | string | yes |  |
| `limit` | `limit` | integer |  | 6 |
| `showheader` | `showheader` | boolean |  | true |

```bentml
CATEGORY(slug: "...")
```

### מדיה

#### `IMAGE` → `image`

▣ **תמונה** — תמונה בודדת

Shape: `IMAGE(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `src` | `src` | media | yes |  |
| `alt` | `alt` | string |  | "" |
| `title` | `title` | string |  | "" |
| `caption` | `caption` | string |  |  |
| `width` | `width` | enum sm\|md\|lg\|full |  | "full" |

```bentml
IMAGE(src: "/uploads/photo.jpg", alt: "תיאור")
```

#### `GALLERY` → `gallery`

▤ **גלריה** — רשת תמונות

Shape: `GALLERY(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `columns` | `columns` | integer |  | 3 |
| `images` | `—` | list |  |  |

```bentml
GALLERY(columns: 3) {
  IMAGE(src: "/uploads/1.jpg", alt: "")
}
```

### שילובים

#### `HTML` → `html`

<> **HTML גולמי** — הדבק HTML משלך — לכל דבר שאין לו מודול

Shape: `HTML {{{ raw }}}`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `note` | `note` | string |  | "" |
| `provisional` | `provisional` | boolean |  | false |

```bentml
HTML {
  …
}
```

### מדיה

#### `EMBED` → `embed`

▶ **וידאו** — YouTube / הטמעת קישור

Shape: `EMBED(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `url` | `url` | url | yes |  |

```bentml
EMBED(url: "https://www.youtube.com/watch?v=XXXXXXXX")
```

#### `VIDEO` → `video`

🎬 **וידאו** — נגן וידאו מתארח (mp4/webm) — קישור יוטיוב הופך אוטומטית להטמעה

Shape: `VIDEO(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `src` | `src` | media | yes |  |
| `poster` | `poster` | media |  |  |
| `caption` | `caption` | string |  |  |
| `controls` | `controls` | boolean |  | true |
| `autoplay` | `autoplay` | boolean |  | false |
| `loop` | `loop` | boolean |  | false |
| `muted` | `muted` | boolean |  | false |

```bentml
VIDEO(src: "...")
```

#### `AUDIO` → `audio`

🎧 **שמע** — נגן שמע (mp3/ogg) — פודקאסט, מוזיקה, קטע רדיו; קישור יוטיוב הופך להטמעה

Shape: `AUDIO(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `src` | `src` | media | yes |  |
| `caption` | `caption` | string |  |  |
| `loop` | `loop` | boolean |  | false |

```bentml
AUDIO(src: "...")
```

### מבנה

#### `ROW` → `columns`

▥ **עמודות** — 2–4 טורים זה לצד זה

Shape: `ROW(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `ratio` | `ratio` | ratio |  |  |
| `gap` | `gap` | enum none\|sm\|md\|lg |  | "md" |
| `collapse` | `collapse` | enum sm\|md\|lg\|never |  | "md" |
| `valign` | `valign` | enum top\|center\|bottom\|stretch |  | "top" |

```bentml
ROW(ratio: "1:1") {
  COL {
    TEXT { טור }
  }
  COL {
    TEXT { טור }
  }
}
```

#### `SPACE` → `spacer`

↕ **רווח** — מרווח אנכי

Shape: `SPACE(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `size` | `size` | enum sm\|md\|lg\|xl |  | "md" |

```bentml
SPACE(size: md)
```

#### `DIVIDER` → `divider`

— **קו מפריד** — קו אופקי

Shape: `DIVIDER(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `bentStyle` | `style` | enum line\|dots\|thick |  | "line" |

```bentml
DIVIDER
```

#### `CARD` → `card`

▢ **כרטיס** — קבוצת מודולים בקופסה

Shape: `CARD(params) { nested modules }`

```bentml
CARD {
  HEADING(level: 3) { כרטיס }
  TEXT { תוכן }
}
```

#### `SECTION` → `section`

▣ **מיכל** — שטח שמור — מלאו עכשיו או אחרי הפרסום

Shape: `SECTION(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `size` | `size` | enum sm\|md\|lg\|xl |  | "md" |

```bentml
SECTION(size: md) {
  …
}
```

### שילובים

#### `MAP` → `map`

📍 **מפה** — מפת Google לפי כתובת

Shape: `MAP(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `address` | `address` | string | yes |  |
| `zoom` | `zoom` | integer |  | 15 |
| `height` | `height` | enum sm\|md\|lg |  | "md" |

```bentml
MAP(address: "תל אביב", zoom: 14)
```

### אפקטים

#### `MOTION` → `marquee`

〰 **טקסט נע** — טקסט שזז — נע לרוחב או נכנס באנימציה

Shape: `MOTION(params) { text body }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `effect` | `effect` | enum marquee\|fade\|slide\|typewriter |  | "marquee" |
| `speed` | `speed` | enum slow\|md\|fast |  | "md" |

```bentml
MOTION {
  …
}
```

#### `BACKDROP` → `parallax`

🏔 **רקע קבוע (Backdrop)** — תמונה קבועה — התוכן גולל מעליה

Shape: `BACKDROP(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `image` | `image` | media |  |  |
| `overlay` | `overlay` | integer |  | 0 |
| `tint` | `tint` | enum none\|dark\|light\|brand |  | "none" |
| `fade` | `fade` | boolean |  | false |
| `height` | `height` | enum sm\|md\|lg\|full |  | "md" |

```bentml
BACKDROP {
  …
}
```

### תוכן

#### `CTA` → `cta`

➤ **פסקת קריאה לפעולה** — כותרת + טקסט + כפתור — שורת CTA ארגונית

Shape: `CTA(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `title` | `title` | string | yes |  |
| `text` | `text` | textarea |  |  |
| `buttonText` | `buttontext` | string |  | "לפרטים" |
| `url` | `url` | url | yes | "#" |
| `variant` | `style` | enum primary\|secondary\|outline |  | "primary" |
| `tone` | `tone` | enum brand\|dark\|light |  | "brand" |
| `align` | `align` | enum start\|center\|end |  | "start" |

```bentml
CTA(title: "...", url: "...", align: start)
```

#### `STATS` → `stats`

＃ **מספרים / מדדים** — שורה של מדדים (לקוחות, פרויקטים…)

Shape: `STATS(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `columns` | `columns` | integer |  | 3 |
| `items` | `—` | list |  |  |

```bentml
STATS {
  …
}
```

### מדיה

#### `LOGOS` → `logos`

▣▣ **לוגואים / לקוחות** — רצועת לוגואים — PLACEHOLDER עד העלאת קבצים

Shape: `LOGOS(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
LOGOS {
  …
}
```

### תוכן

#### `FAQ` → `faq`

? **שאלות נפוצות** — רשימת שאלה / תשובה

Shape: `FAQ(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
FAQ {
  …
}
```

#### `TABLE` → `table`

📋 **טבלה** — שעות פתיחה, מחירון, לו"ז — שורות מופרדות ב-| (ללא JS)

Shape: `TABLE(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `header` | `header` | boolean |  | true |
| `rows` | `—` | list |  |  |

```bentml
TABLE {
  …
}
```

### מבנה

#### `TABS` → `tabs`

❐ **טאבים** — תוכן בלשוניות (CSS בלבד)

Shape: `TABS(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
TABS {
  …
}
```

#### `ACCORDION` → `accordion`

☰ **אקורדיון** — מגירות נפתחות (CSS בלבד)

Shape: `ACCORDION(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
ACCORDION {
  …
}
```

### שילובים

#### `FORM` → `form`

✉ **טופס** — טופס יצירת קשר / הרשמה (מודול #1 שהמפרק ביקש)

Shape: `FORM(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `action` | `action` | url |  | "" |
| `method` | `method` | enum post\|get |  | "post" |
| `submit` | `submit` | string |  | "שליחה" |
| `fields` | `—` | list |  |  |

```bentml
FORM {
  …
}
```

### מדיה

#### `CARDS` → `cards`

▦ **רשת כרטיסים** — רשת כרטיסי תוכן (תמונה + כותרת + קישור) — היחידה של אתר תוכן

Shape: `CARDS(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
CARDS {
  …
}
```

#### `CAROUSEL` → `carousel`

🎠 **קרוסלה** — שקופיות בגלילה אופקית (ללא JS) — כרטיסי תוכן שמחליקים

Shape: `CAROUSEL(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `height` | `height` | enum sm\|md\|lg |  | "md" |
| `peek` | `peek` | boolean |  | true |
| `items` | `—` | list |  |  |

```bentml
CAROUSEL {
  …
}
```

### מבנה

#### `PRICING` → `pricing`

💳 **טבלת מחירים** — רשת תוכניות מחיר — עד תוכנית אחת מודגשת

Shape: `PRICING(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
PRICING {
  …
}
```

#### `NAV` → `nav`

≡ **תפריט ניווט** — שורת ניווט עם צבעים (רקע + טקסט)

Shape: `NAV(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `background` | `background` | string |  | "" |
| `color` | `color` | string |  | "" |
| `align` | `align` | enum start\|center\|end |  | "start" |
| `items` | `—` | list |  |  |

```bentml
NAV(align: start) {
  …
}
```

### מדיה

#### `TICKER` → `ticker`

📰 **מבזקים נעים** — שורת מבזקים נעה — כותרות עם קישורים (סגנון וואלה), עם צבעים ומהירות

Shape: `TICKER(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `label` | `label` | string |  | "" |
| `speed` | `speed` | enum slow\|md\|fast |  | "md" |
| `background` | `background` | string |  | "" |
| `color` | `color` | string |  | "" |
| `items` | `—` | list |  |  |

```bentml
TICKER {
  …
}
```

#### `NEWSPOP` → `newspop`

🕐 **מבזקים עם שעות** — מבזקי חדשות עם שעות — עמודה קבועה של "שעה · כותרת" (סגנון וואלה, לא נעה)

Shape: `NEWSPOP(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `label` | `label` | string |  | "" |
| `items` | `—` | list |  |  |

```bentml
NEWSPOP {
  …
}
```

### שילובים

#### `CONTACT` → `contact-info`

☎ **פרטי קשר** — טלפון · מייל · כתובת

Shape: `CONTACT(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `phone` | `phone` | string |  |  |
| `email` | `email` | string |  |  |
| `address` | `address` | string |  |  |
| `hours` | `hours` | string |  |  |

```bentml
CONTACT
```

### מבנה

#### `BANNER` → `banner`

▬ **באנר** — פס הודעה עליון / מבצע

Shape: `BANNER(params) { text body }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `tone` | `tone` | enum brand\|dark\|light\|warn |  | "brand" |
| `align` | `align` | enum start\|center\|end |  | "start" |

```bentml
BANNER(align: start) {
  …
}
```

## Style (not a keyword)

Module style = builder Style panel. class/id advanced. No STYLE{} block.

Universal on most keywords: `class`, `id`.

## Reserved (future advanced modules)

`INPUT`, `FOOTER`, `HEADER`, `CODE`

These are **not** implemented yet. Using them in BenTML is an error today.
