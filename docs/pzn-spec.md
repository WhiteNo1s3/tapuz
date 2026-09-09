# The `.pzn` page format — standard

**Spec version 0.1** · generated from `tapuziel@2.12.0-alpha` · regenerate with `node scripts/gen-pzn-spec.js`

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

## Modules (68)

### Category: content

#### `<bent-heading>` — כותרת / Heading · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `level` · integer · 1–6 · default `2`
  - `align` · enum · start \| center \| end · default `start`
  - `text` · text · default `כותרת חדשה` · **(body text, not an attribute)**

#### `<bent-text>` — טקסט / Text · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `text` · text · default `פסקה חדשה` · **(body text, not an attribute)**
  - `align` · enum · start \| center \| end · default `start`
  - `size` · enum · sm \| md \| lg · default `md`
  - `lead` · boolean · default `false`
  - `dropcap` · boolean · default `false`
  - `maxwidth` · enum · sm \| md \| lg \| full · default `full`

#### `<bent-image>` — תמונה / Image · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `src` · url
  - `alt` · string
  - `title` · string
  - `caption` · string
  - `align` · enum · left \| center \| right · default `center`
  - `width` · enum · sm \| md \| lg \| full · default `full`

#### `<bent-button>` — כפתור / Button · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `href` · url · default `#`
  - `variant` · enum · primary \| secondary \| outline · default `primary`
  - `align` · enum · start \| center \| end · default `start`
  - `text` · text · default `לחץ כאן` · **(body text, not an attribute)**
  - `rel` · string
  - `target` · enum · _self \| _blank · default `_self`
  - `title` · string

#### `<bent-item>` — פריט רשימה / List item · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `text` · text · default `פריט` · **(body text, not an attribute)**

#### `<bent-list>` — רשימה / List · container (children: `bent-item`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `ordered` · boolean · default `false`

#### `<bent-quote>` — ציטוט / Quote · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `author` · string
  - `text` · text · default `ציטוט` · **(body text, not an attribute)**

#### `<bent-spacer>` — רווח / Spacer · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `height` · string · default `2rem`
  - `size` · enum · sm \| md \| lg \| xl · default `md`

#### `<bent-divider>` — קו מפריד / Divider · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `style` · enum · solid \| dashed \| none · default `solid`
  - `bentstyle` · enum · line \| dots \| thick · default `line`

#### `<bent-embed>` — הטמעה / Embed · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `url` · url

#### `<bent-testimonial>` — המלצה / Testimonial · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `author` · string
  - `role` · string
  - `text` · text · **(body text, not an attribute)**

#### `<bent-feature>` — תכונה / Feature · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `title` · string
  - `icon` · string
  - `text` · text · **(body text, not an attribute)**

#### `<bent-features>` — תכונות / Features · container (children: `bent-feature`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `columns` · integer · 1–4 · default `3`

#### `<bent-cta>` — קריאה לפעולה / CTA · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `title` · string
  - `buttontext` · string
  - `url` · url · default `#`
  - `variant` · enum · primary \| secondary \| outline · default `primary`
  - `tone` · enum · brand \| dark \| light · default `brand`
  - `align` · enum · start \| center \| end · default `start`
  - `text` · text · **(body text, not an attribute)**

#### `<bent-stat>` — מדד / Stat · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `value` · string
  - `label` · string

#### `<bent-stats>` — מספרים / מדדים / Stats · container (children: `bent-stat`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `columns` · integer · 2–4 · default `3`

#### `<bent-qa>` — שאלה ותשובה / Q&A · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `question` · string
  - `text` · text · **(body text, not an attribute)**

#### `<bent-faq>` — שאלות נפוצות / FAQ · container (children: `bent-qa`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

#### `<bent-banner>` — באנר / Banner · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `tone` · enum · brand \| dark \| light \| warn · default `brand`
  - `align` · enum · start \| center \| end · default `start`
  - `text` · text · default `הודעה חדשה` · **(body text, not an attribute)**

#### `<bent-trow>` — שורת טבלה / Table row · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `cells` · text · **(body text, not an attribute)**

#### `<bent-table>` — טבלה / Table · container (children: `bent-trow`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `header` · boolean · default `true`

#### `<bent-event>` — אירוע בציר זמן / Timeline event · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `time` · string
  - `title` · string
  - `image` · url
  - `text` · text · **(body text, not an attribute)**

#### `<bent-timeline>` — ציר זמן / Timeline · container (children: `bent-event`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

### Category: layout

#### `<bent-section>` — מיכל / Section · container

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `kind` · string · default `content`
  - `size` · enum · sm \| md \| lg \| xl · default `md`

#### `<bent-col>` — עמודה / Column · container

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `width` · enum · 1/1 \| 1/2 \| 1/3 \| 2/3 \| 1/4 \| 3/4 · default `1/2`

#### `<bent-columns>` — עמודות / Columns · container (children: `bent-col`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `gap` · enum · none \| sm \| md \| lg \| small \| medium \| large · default `medium`
  - `ratio` · string
  - `collapse` · enum · sm \| md \| lg \| never · default `md`
  - `valign` · enum · top \| center \| bottom \| stretch · default `top`

#### `<bent-hero>` — הירו / Hero · container

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `image` · url
  - `height` · enum · sm \| md \| lg \| full · default `md`
  - `overlay` · integer · 0–80 · default `0`
  - `parallax` · boolean · default `false`

#### `<bent-card>` — כרטיס / Card · container

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

#### `<bent-navitem>` — קישור ניווט / Nav link · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `label` · string
  - `href` · url

#### `<bent-nav>` — תפריט ניווט / Nav menu · container (children: `bent-navitem`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `background` · string
  - `color` · string
  - `align` · enum · start \| center \| end · default `start`

#### `<bent-tab>` — טאב / Tab · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `label` · string · default `טאב`
  - `text` · text · **(body text, not an attribute)**

#### `<bent-tabs>` — טאבים / Tabs · container (children: `bent-tab`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

#### `<bent-fold>` — מגירה / Fold · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `title` · string · default `כותרת`
  - `text` · text · **(body text, not an attribute)**

#### `<bent-accordion>` — אקורדיון / Accordion · container (children: `bent-fold`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

#### `<bent-plan>` — תוכנית מחיר / Pricing plan · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `title` · string
  - `price` · string
  - `period` · string
  - `features` · string
  - `ctaLabel` · string
  - `ctaUrl` · url
  - `highlighted` · boolean · default `false`

#### `<bent-pricing>` — טבלת מחירים / Pricing table · container (children: `bent-plan`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

#### `<bent-step>` — שלב / Step · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `title` · string
  - `icon` · string
  - `text` · text · **(body text, not an attribute)**

#### `<bent-steps>` — שלבי תהליך / Steps · container (children: `bent-step`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

#### `<bent-crumb>` — פירור / Crumb · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `label` · string
  - `url` · url

#### `<bent-headlink>` — קישור כותרת / Header link · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `label` · string
  - `href` · url

#### `<bent-header>` — כותרת עליונה / Header · container (children: `bent-headlink`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `logo` · url
  - `title` · string
  - `url` · url

#### `<bent-footlink>` — קישור כותרת תחתונה / Footer link · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `label` · string
  - `href` · url

#### `<bent-footer>` — כותרת תחתונה / Footer · container (children: `bent-footlink`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `copy` · string

#### `<bent-crumbs>` — פירורי לחם / Breadcrumbs · container (children: `bent-crumb`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

### Category: data

#### `<bent-gallery>` — גלריה / Gallery · container (children: `bent-image`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `columns` · integer · 1–4 · default `3`

#### `<bent-article-list>` — רשימת מאמרים / Article list · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `tag` · string · default `article`
  - `limit` · integer · 1–48 · default `6`
  - `columns` · integer · 1–4 · default `3`

#### `<bent-map>` — מפה / Map · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `address` · string
  - `zoom` · integer · 1–20 · default `15`
  - `height` · enum · sm \| md \| lg · default `md`

#### `<bent-category>` — קטגוריה / Category · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `slug` · string
  - `limit` · integer · 1–48 · default `6`
  - `showheader` · boolean · default `true`

#### `<bent-field>` — שדה טופס / Form field · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `label` · string
  - `name` · string
  - `type` · enum · text \| email \| tel \| textarea \| select \| checkbox · default `text`
  - `placeholder` · string
  - `required` · boolean · default `false`
  - `options` · string

#### `<bent-form>` — טופס / Form · container (children: `bent-field`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `action` · string
  - `method` · enum · post \| get · default `post`
  - `submit` · string · default `שליחה`

#### `<bent-contact-info>` — פרטי קשר / Contact info · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `phone` · string
  - `email` · string
  - `address` · string
  - `hours` · string

### Category: media

#### `<bent-logo>` — לוגו / Logo · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `src` · url
  - `alt` · string
  - `url` · url

#### `<bent-logos>` — לוגואים / לקוחות / Logos · container (children: `bent-logo`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

#### `<bent-mediacard>` — כרטיס תוכן / Media card · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `image` · url
  - `tag` · string
  - `title` · string
  - `excerpt` · string
  - `href` · url

#### `<bent-cards>` — רשת כרטיסים / Card grid · container (children: `bent-mediacard`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

#### `<bent-slide>` — שקופית / Slide · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `image` · url
  - `tag` · string
  - `title` · string
  - `excerpt` · string
  - `href` · url

#### `<bent-carousel>` — קרוסלה / Carousel · container (children: `bent-slide`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `height` · enum · sm \| md \| lg · default `md`
  - `peek` · boolean · default `true`

#### `<bent-tickeritem>` — מבזק / Ticker headline · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `text` · string
  - `href` · url

#### `<bent-ticker>` — מבזקים נעים / News ticker · container (children: `bent-tickeritem`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `label` · string
  - `speed` · enum · slow \| md \| fast · default `md`
  - `background` · string
  - `color` · string

#### `<bent-newspopitem>` — עדכון / News update · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `time` · string
  - `text` · string
  - `href` · url

#### `<bent-newspop>` — מבזקים עם שעות / News feed · container (children: `bent-newspopitem`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `label` · string

#### `<bent-video>` — וידאו / Video · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `src` · url
  - `poster` · url
  - `caption` · string
  - `controls` · boolean · default `true`
  - `autoplay` · boolean · default `false`
  - `loop` · boolean · default `false`
  - `muted` · boolean · default `false`

#### `<bent-audio>` — שמע / Audio · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `src` · url
  - `caption` · string
  - `loop` · boolean · default `false`

#### `<bent-handle>` — רשת / Network · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `network` · string
  - `url` · url
  - `label` · string

#### `<bent-social>` — רשתות חברתיות / Social · container (children: `bent-handle`)

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`

### Category: effects

#### `<bent-marquee>` — טקסט נע / Marquee · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `speed` · enum · slow \| md \| fast · default `md`
  - `text` · text · default `ברוכים הבאים ✦` · **(body text, not an attribute)**

#### `<bent-parallax>` — רקע קבוע (פרלקסה) / Parallax · container

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `image` · url
  - `overlay` · integer · 0–80 · default `0`
  - `height` · enum · sm \| md \| lg \| full · default `md`

### Category: advanced

#### `<bent-html>` — HTML גולמי / Raw HTML · leaf

  - `animate` · enum · none \| fade \| rise \| zoom · default `none`
  - `content` · text
  - `provisional` · boolean · default `false`
  - `note` · string

## Versioning

The spec version (`bent-version`) is independent of the Tapuziel product
version. New modules and props are MINOR, additive changes; a removed or
re-typed prop is a MAJOR change. Readers SHOULD ignore unknown head meta and
MUST error on unknown body modules (fail closed).
