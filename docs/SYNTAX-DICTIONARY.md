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

## Modules (34)

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

#### `MARQUEE` → `marquee`

〰 **טקסט נע** — שורת טקסט שנעה לרוחב המסך

Shape: `MARQUEE(params) { text body }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `speed` | `speed` | enum slow\|md\|fast |  | "md" |

```bentml
MARQUEE {
  …
}
```

#### `PARALLAX` → `parallax`

🏔 **רקע קבוע (פרלקסה)** — תמונה קבועה — התוכן גולל מעליה

Shape: `PARALLAX(params) { nested modules }`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `image` | `image` | media |  |  |
| `overlay` | `overlay` | integer |  | 0 |
| `height` | `height` | enum sm\|md\|lg\|full |  | "md" |

```bentml
PARALLAX {
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

Shape: `STATS(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `columns` | `columns` | integer |  | 3 |
| `items` | `—` | list |  |  |

```bentml
STATS
```

### מדיה

#### `LOGOS` → `logos`

▣▣ **לוגואים / לקוחות** — רצועת לוגואים — PLACEHOLDER עד העלאת קבצים

Shape: `LOGOS(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
LOGOS
```

### תוכן

#### `FAQ` → `faq`

? **שאלות נפוצות** — רשימת שאלה / תשובה

Shape: `FAQ(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
FAQ
```

### מבנה

#### `TABS` → `tabs`

❐ **טאבים** — תוכן בלשוניות (CSS בלבד)

Shape: `TABS(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
TABS
```

#### `ACCORDION` → `accordion`

☰ **אקורדיון** — מגירות נפתחות (CSS בלבד)

Shape: `ACCORDION(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
ACCORDION
```

### שילובים

#### `FORM` → `form`

✉ **טופס** — טופס יצירת קשר / הרשמה (מודול #1 שהמפרק ביקש)

Shape: `FORM(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `action` | `action` | url |  | "" |
| `method` | `method` | enum post\|get |  | "post" |
| `submit` | `submit` | string |  | "שליחה" |
| `fields` | `—` | list |  |  |

```bentml
FORM
```

### מדיה

#### `CARDS` → `cards`

▦ **רשת כרטיסים** — רשת כרטיסי תוכן (תמונה + כותרת + קישור) — היחידה של אתר תוכן

Shape: `CARDS(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `items` | `—` | list |  |  |

```bentml
CARDS
```

### מבנה

#### `NAV` → `nav`

≡ **תפריט ניווט** — שורת ניווט עם צבעים (רקע + טקסט)

Shape: `NAV(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `background` | `background` | string |  | "" |
| `color` | `color` | string |  | "" |
| `align` | `align` | enum start\|center\|end |  | "start" |
| `items` | `—` | list |  |  |

```bentml
NAV(align: start)
```

### מדיה

#### `TICKER` → `ticker`

📰 **מבזקים נעים** — שורת מבזקים נעה — כותרות עם קישורים (סגנון וואלה), עם צבעים ומהירות

Shape: `TICKER(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `label` | `label` | string |  | "" |
| `speed` | `speed` | enum slow\|md\|fast |  | "md" |
| `background` | `background` | string |  | "" |
| `color` | `color` | string |  | "" |
| `items` | `—` | list |  |  |

```bentml
TICKER
```

#### `NEWSPOP` → `newspop`

🕐 **מבזקים עם שעות** — מבזקי חדשות עם שעות — עמודה קבועה של "שעה · כותרת" (סגנון וואלה, לא נעה)

Shape: `NEWSPOP(params)`

| Param (JSON) | BenTML | Type | Required | Default |
|---|---|---|---|---|
| `label` | `label` | string |  | "" |
| `items` | `—` | list |  |  |

```bentml
NEWSPOP
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

`SECTION`, `INPUT`, `FOOTER`, `HEADER`, `CODE`, `TABLE`, `AUDIO`, `SLIDER`

These are **not** implemented yet. Using them in BenTML is an error today.
