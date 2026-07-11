# Tapuz Block Schemas (Structured)

All blocks are **structured data**. No raw HTML for regular content.

## Page-level fields (relevant to blocks)

- `direction`: "rtl" | "ltr"
- `lang`: "he" (default for now)

---

## Block Definitions

### 1. heading

```json
{
  "type": "heading",
  "id": "blk_xxx",
  "data": {
    "level": 2,
    "text": "כותרת משנה"
  }
}
```

### 2. text

For paragraphs and multi-line content.

```json
{
  "type": "text",
  "id": "blk_yyy",
  "data": {
    "content": "זה טקסט רגיל. אפשר להוסיף כאן כמה משפטים."
  }
}
```

Later we can evolve `content` to support inline formatting (bold, links, etc.) using runs if needed.

### 3. image

```json
{
  "type": "image",
  "id": "blk_zzz",
  "data": {
    "src": "/uploads/hero.jpg",
    "alt": "תמונה ראשית של האתר",
    "caption": "תיאור התמונה",
    "alignment": "center"   // left | center | right (will respect RTL)
  }
}
```

### 4. button

```json
{
  "type": "button",
  "id": "blk_btn",
  "data": {
    "text": "למידע נוסף",
    "url": "/contact",
    "variant": "primary"     // primary | secondary | outline
  }
}
```

### 5. columns

```json
{
  "type": "columns",
  "id": "blk_cols",
  "data": {
    "gap": "medium",
    "columns": [
      {
        "width": "1/2",
        "blocks": [ /* array of blocks */ ]
      },
      {
        "width": "1/2",
        "blocks": [ /* array of blocks */ ]
      }
    ]
  }
}
```

### 6. spacer

```json
{
  "type": "spacer",
  "id": "blk_spc",
  "data": {
    "height": "2rem"     // or number in px
  }
}
```

### 7. divider

```json
{
  "type": "divider",
  "id": "blk_div",
  "data": {
    "style": "solid"     // solid | dashed | none
  }
}
```

### 8. article-list

Shows published pages tagged `tag` as clickable cards ("cubes"): image + title + teaser, newest first.

```json
{
  "type": "article-list",
  "id": "blk_articles",
  "data": {
    "tag": "article",      // which pages count as articles
    "limit": 6,            // max cards (1-48)
    "columns": 3           // grid columns (1-4)
  }
}
```

Per-article card data comes from the article page itself:
- Image: `meta.cardImage`, or auto-extracted from the page's first image/gallery block
- Teaser: `meta.teaser`, or auto-extracted from the page's first text block (truncated)
- A page becomes an article by carrying the tag (builder: page properties → "דף מאמר")

---

## Rules

- Every block **must** have `type` and `data`.
- No freeform `html` block in normal pages (we can add a special "raw" block later for power users).
- All text is stored as plain strings (the theme/renderer decides how to output it).
- Direction (RTL) is handled at the Page + Theme level, not per block.

This structure is very friendly for CLI and AI agents to generate.
