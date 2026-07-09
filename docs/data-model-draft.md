# Tapuz Data Model (Draft)

This is the most important piece for both the web admin **and** CLI/agent usage.

## Page

```json
{
  "id": 1,
  "path_prefix": "home-",                 // optional (e.g. "home-", "about-")
  "slug": "דף-הבית",                     // Hebrew preferred
  "full_path": "home-דף-הבית",           // final URL segment
  "title": "דף הבית",
  "direction": "rtl",
  "theme": "default",
  "status": "published",
  "tags": ["ראשי", "בית"],
  "meta": {
    "description": "...",
    "ogImage": null
  },
  "blocks": [ ... ],
  "created_at": "...",
  "updated_at": "..."
}
```

## Block Types (MVP proposal)

We will start with a small, structured set. No raw HTML for normal content.

### Core Blocks

| Type       | Purpose                        | Key fields in `data`                          |
|------------|--------------------------------|-----------------------------------------------|
| heading    | Titles & subtitles             | `level` (1-6), `text`                         |
| text       | Paragraphs / rich content      | `content` (string or structured runs)         |
| image      | Images                         | `src`, `alt`, `caption`, `width?`             |
| button     | Call to action                 | `text`, `url`, `style` (primary/secondary)    |
| columns    | Layout                         | `columns` (array of block arrays)             |
| spacer     | Vertical spacing               | `height`                                      |
| divider    | Visual separator               | `style`                                       |

**Note**: We avoid a general `html` block in normal use. It can be added later for advanced cases.

Example block:

```json
{
  "type": "heading",
  "id": "blk_abc123",
  "data": {
    "level": 1,
    "text": "ברוכים הבאים"
  }
}
```

## Decisions Made

- **Blocks are structured data** (not raw HTML). Each block has `type` + `data` object.
- Hebrew slugs are preferred (e.g. `דף-הבית`)
- Support optional English prefixes for control/SEO when needed.
- Node.js backend

## Media

```json
{
  "id": 5,
  "filename": "hero-2026.jpg",
  "path": "/uploads/2026/hero-2026.jpg",
  "mime": "image/jpeg",
  "width": 1920,
  "height": 1080,
  "alt": "...",
  "created_at": "..."
}
```

## Tags

Simple many-to-many for now (or just array on page for MVP).

---
This draft is meant to be discussed and changed quickly.
