# Tapuz Theme Standard (Draft)

## Goals
- Make themes truly modular and reusable
- Allow non-developers to use them well
- Allow developers to create powerful themes easily
- Keep the public output clean and semantic

## Theme Folder Structure

```
themes/my-theme/
├── theme.json              # Manifest + configuration
├── layout.html             # Main layout template
├── components/             # Reusable blocks/components
│   ├── hero.html
│   ├── card.html
│   └── ...
├── css/
│   └── main.css
├── js/
│   └── main.js
├── assets/                 # Theme-specific images, fonts, etc.
└── preview.png
```

## theme.json (required)

```json
{
  "name": "Clean Slate",
  "slug": "clean-slate",
  "version": "1.0.0",
  "author": "You",
  "description": "Minimal, fast, and beautiful",
  "rtl": true,
  "supports": {
    "rtl": true,
    "ltr": false
  },
  "slots": {
    "header": true,
    "footer": true,
    "sidebar": false,
    "hero": true
  },
  "breakpoints": {
    "sm": "640px",
    "md": "768px",
    "lg": "1024px",
    "xl": "1280px"
  },
  "defaultComponents": ["text", "image", "heading"]
}
```

## How Pages Use Themes

Each page stores:
- `theme_slug`
- `layout` (optional override)
- Array of blocks

The renderer combines:
1. Theme layout
2. Block components from the theme (or global fallback)
3. Page-specific data

## Component Standard (Blocks)

Components should accept data and output clean HTML.

Example component signature idea:
```html
<!-- components/heading.html -->
<h{{level}} class="...">{{text}}</h{{level}}>
```

Or with more structure later.

## Principles
- Themes should **not** assume specific page types
- CSS should use a clear variable system
- Everything must be responsive by default
- Avoid heavy JS unless the theme really needs it
- Provide good defaults + easy customization

This is a starting draft. We will refine it heavily.
