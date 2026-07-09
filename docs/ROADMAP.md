# Tapuz — Roadmap & Idea Pool

**Current version: v0.30-alpha**

## How versions work

- Every working session that ships = **+0.01** (v0.31-alpha, v0.32-alpha, ...)
- Each bump gets a row in the Version Log below: what shipped, whose idea it was
- Ideas come from three brains: **Ben**, **Claude**, **Grok** — all go in the Idea Pool, best ones win
- When the builder + import + themes feel complete → v1.0-beta

## Version Log

| Version | Shipped | Source |
|---|---|---|
| v0.30-alpha | Undo/redo (Ctrl+Z), autosave + unsaved guard, list & YouTube modules, Hebrew toasts, HTML escaping fix (XSS), semantic HTML5 output (section/article/blockquote/figure), skip-link + aria nav, theme comfort pass (focus rings, hover lift, video aspect-ratio, mobile nav) | Claude + Ben |
| v0.2 | Smart module replace, clearer RTL UX | Ben |
| v0.1 | Initial CMS: Elementor import, RTL visual builder, static export | Ben |

## Idea Pool

### Builder (editor UX)
- [ ] Expose gallery + quote + card modules in toolbox (renderer already supports them — same trick as list/embed)
- [ ] Column width ratios (50/50, 33/67, 25/75) with visual handles
- [ ] Mobile/tablet preview toggle in the canvas header
- [ ] Keyboard: Ctrl+D duplicate, Alt+arrows to move selected block
- [ ] Block templates: save a group of blocks as a reusable "section" (hero+features+cta)
- [ ] Inline text editing on the canvas itself (click text, type) instead of the side panel

### CMS core
- [ ] Page list: search, sort, duplicate page, draft/published badge
- [ ] Media library: folders, delete, alt-text editing, image resize on upload
- [ ] SEO panel per page: meta description, og:image, slug editing
- [ ] Auto sitemap.xml + RSS on build
- [ ] Scheduled publish (build skips future-dated pages)

### Themes
- [ ] Dark mode via prefers-color-scheme (CSS vars are ready for it)
- [ ] Second built-in theme (grokskin-style cyberpunk?)
- [ ] theme.json options surfaced in admin (colors, fonts, max-width)

### Import
- [ ] Elementor import: map more widget types to Tapuz modules
- [ ] Markdown import (folder of .md files → pages)

### Ben's ideas
- (add here)

### Grok's ideas
- (add here)
