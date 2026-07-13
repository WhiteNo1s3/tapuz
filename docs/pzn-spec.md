# The `.pzn` page format — standard

**Spec version 0.1** · generated from `tapuziel@0.53.0-alpha` · regenerate with `node scripts/gen-pzn-spec.js`

`.pzn` is an open, constrained-HTML page format. A `.pzn` file **is** HTML —
but the body may contain **only registered `bent-*` module tags**, never raw
HTML. That single rule is what makes the format safe for AI agents to write
and safe for tools to render: the vocabulary is fixed, typed, and validated.

Machine-readable catalog: [`pzn-schema.json`](pzn-schema.json) — the same
module/prop data this document is generated from. Implement a reader/writer
from it directly.

## Document shape

```html
<!DOCTYPE html>
<html lang="he" dir="rtl" bent-version="0.1">
  <head>
    <meta charset="utf-8" />
    <title>Page title</title>
    <meta name="bent-slug" content="page-slug" />
    <!-- optional: bent-tags, bent-teaser, bent-card-image -->
  </head>
  <body>
    <!-- only bent-* module tags here -->
  </body>
</html>
```

## Rules (normative)

1. The document is well-formed HTML with `<html>`, `<head>`, `<body>`.
2. `<html>` SHOULD carry `lang`, `dir` (`rtl`|`ltr`), and `bent-version`.
3. The `<body>` MUST contain only registered `bent-*` tags. Raw HTML in the
   body is a validation error (`E_RAW_HTML`); raw text is `E_RAW_TEXT`.
4. An unknown `bent-*` tag is `E_UNKNOWN_MODULE`.
5. Every module SHOULD have a unique `id`; duplicate ids are `E_DUP_ID`.
6. Container modules may contain only their declared `accept` children
   (`E_CHILD` otherwise); non-containers may not contain modules.
7. Prop values are typed (integer ranges, enums, booleans) and validated.
8. Page identity is the `bent-slug`; head meta carry title/tags/teaser/card.
9. **Escaping (security):** text and attributes are HTML-escaped on render.
   URL props on clickable links (`href`, `url`) MUST reject the
   `javascript:`, `data:`, and `vbscript:` schemes. Background-image URLs are
   escaped for the CSS `url()` context, not just HTML. `class="…"` is the
   only styling escape hatch; there is no raw-style injection.
10. Compilation is deterministic: a `.pzn` document maps to one HTML output.

## Modules (33)

### Category: content

#### `<bent-heading>` — כותרת / Heading · leaf

  - `level` · integer · 1–6 · default `2`
  - `align` · enum · start \| center \| end · default `start`
  - `animate` · enum · none \| fade \| rise · default `none`
  - `text` · text · default `כותרת חדשה` · **(body text, not an attribute)**

#### `<bent-text>` — טקסט / Text · leaf

  - `text` · text · default `פסקה חדשה` · **(body text, not an attribute)**
  - `align` · enum · start \| center \| end · default `start`
  - `size` · enum · sm \| md \| lg · default `md`
  - `lead` · boolean · default `false`
  - `dropcap` · boolean · default `false`
  - `maxwidth` · enum · sm \| md \| lg \| full · default `full`
  - `animate` · enum · none \| fade \| rise · default `none`

#### `<bent-image>` — תמונה / Image · leaf

  - `src` · url
  - `alt` · string
  - `caption` · string
  - `align` · enum · left \| center \| right · default `center`
  - `width` · enum · sm \| md \| lg \| full · default `full`

#### `<bent-button>` — כפתור / Button · leaf

  - `href` · url · default `#`
  - `variant` · enum · primary \| secondary \| outline · default `primary`
  - `align` · enum · start \| center \| end · default `start`
  - `text` · text · default `לחץ כאן` · **(body text, not an attribute)**

#### `<bent-item>` — פריט רשימה / List item · leaf

  - `text` · text · default `פריט` · **(body text, not an attribute)**

#### `<bent-list>` — רשימה / List · container (children: `bent-item`)

  - `ordered` · boolean · default `false`

#### `<bent-quote>` — ציטוט / Quote · leaf

  - `author` · string
  - `text` · text · default `ציטוט` · **(body text, not an attribute)**

#### `<bent-spacer>` — רווח / Spacer · leaf

  - `height` · string · default `2rem`
  - `size` · enum · sm \| md \| lg \| xl · default `md`

#### `<bent-divider>` — קו מפריד / Divider · leaf

  - `style` · enum · solid \| dashed \| none · default `solid`
  - `bentstyle` · enum · line \| dots \| thick · default `line`

#### `<bent-embed>` — הטמעה / Embed · leaf

  - `url` · url

#### `<bent-testimonial>` — המלצה / Testimonial · leaf

  - `author` · string
  - `role` · string
  - `text` · text · **(body text, not an attribute)**

#### `<bent-feature>` — תכונה / Feature · leaf

  - `title` · string
  - `icon` · string
  - `text` · text · **(body text, not an attribute)**

#### `<bent-features>` — תכונות / Features · container (children: `bent-feature`)

  - `columns` · integer · 1–4 · default `3`

#### `<bent-cta>` — קריאה לפעולה / CTA · leaf

  - `title` · string
  - `buttontext` · string
  - `url` · url · default `#`
  - `variant` · enum · primary \| secondary \| outline · default `primary`
  - `tone` · enum · brand \| dark \| light · default `brand`
  - `align` · enum · start \| center \| end · default `start`
  - `text` · text · **(body text, not an attribute)**

#### `<bent-stat>` — מדד / Stat · leaf

  - `value` · string
  - `label` · string

#### `<bent-stats>` — מספרים / מדדים / Stats · container (children: `bent-stat`)

  - `columns` · integer · 2–4 · default `3`

#### `<bent-qa>` — שאלה ותשובה / Q&A · leaf

  - `question` · string
  - `text` · text · **(body text, not an attribute)**

#### `<bent-faq>` — שאלות נפוצות / FAQ · container (children: `bent-qa`)

#### `<bent-banner>` — באנר הודעה / Banner · leaf

  - `tone` · enum · brand \| dark \| light \| warn · default `brand`
  - `align` · enum · start \| center \| end · default `start`
  - `text` · text · **(body text, not an attribute)**

### Category: layout

#### `<bent-section>` — סקשן / Section · container

  - `kind` · string · default `content`

#### `<bent-col>` — עמודה / Column · container

  - `width` · enum · 1/1 \| 1/2 \| 1/3 \| 2/3 \| 1/4 \| 3/4 · default `1/2`

#### `<bent-columns>` — עמודות / Columns · container (children: `bent-col`)

  - `gap` · enum · none \| sm \| md \| lg \| small \| medium \| large · default `medium`
  - `ratio` · string
  - `collapse` · enum · sm \| md \| lg \| never · default `md`
  - `valign` · enum · top \| center \| bottom \| stretch · default `top`

#### `<bent-hero>` — הירו / Hero · container

  - `image` · url
  - `height` · enum · sm \| md \| lg \| full · default `md`
  - `overlay` · integer · 0–80 · default `0`
  - `parallax` · boolean · default `false`

#### `<bent-card>` — כרטיס / Card · container

### Category: data

#### `<bent-gallery>` — גלריה / Gallery · container (children: `bent-image`)

  - `columns` · integer · 1–4 · default `3`

#### `<bent-article-list>` — רשימת מאמרים / Article list · leaf

  - `tag` · string · default `article`
  - `limit` · integer · 1–48 · default `6`
  - `columns` · integer · 1–4 · default `3`

#### `<bent-map>` — מפה / Map · leaf

  - `address` · string
  - `zoom` · integer · 1–20 · default `15`
  - `height` · enum · sm \| md \| lg · default `md`

#### `<bent-contact-info>` — פרטי קשר / Contact info · leaf

  - `phone` · string
  - `email` · string
  - `address` · string
  - `hours` · string

### Category: media

#### `<bent-logo>` — לוגו / Logo · leaf

  - `src` · url
  - `alt` · string
  - `url` · url

#### `<bent-logos>` — לוגואים / לקוחות / Logos · container (children: `bent-logo`)

### Category: effects

#### `<bent-marquee>` — טקסט נע / Marquee · leaf

  - `speed` · enum · slow \| md \| fast · default `md`
  - `text` · text · default `ברוכים הבאים ✦` · **(body text, not an attribute)**

#### `<bent-parallax>` — רקע קבוע (פרלקסה) / Parallax · container

  - `image` · url
  - `overlay` · integer · 0–80 · default `0`
  - `height` · enum · sm \| md \| lg \| full · default `md`

### Category: advanced

#### `<bent-html>` — HTML גולמי (זמני) / Raw HTML (provisional) · leaf

  - `content` · text
  - `provisional` · boolean · default `true`
  - `note` · string

## Versioning

The spec version (`bent-version`) is independent of the Tapuziel product
version. New modules and props are MINOR, additive changes; a removed or
re-typed prop is a MAJOR change. Readers SHOULD ignore unknown head meta and
MUST error on unknown body modules (fail closed).
