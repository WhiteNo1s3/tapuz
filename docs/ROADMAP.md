# Tapuz — Roadmap & Idea Pool

**Current version: v0.32-alpha**

## How versions work

- Every working session that ships = **+0.01** (v0.32-alpha, v0.33-alpha, ...)
- Each bump gets a row in the Version Log: what shipped, whose idea
- Ideas from three brains: **Ben**, **Claude**, **Grok** — all land in this file, best ones win
- When builder + media + pages + theme builder feel complete → v1.0-beta
- Long game: a real open-source CMS competitor, community-driven once Ben sets the direction. Security hardening gets its own phase before beta.

## The Plan (Ben's vision, phased)

### v0.31 — Media & Gallery (this version)
- Media library wired to the database (was: raw folder listing)
- Folder system, Windows-Explorer look: folders + files grid, breadcrumb, create folder, right-click → delete / open / copy URL
- Gallery module exposed in toolbox: picks multiple images from the library
- Toolbox buttons for list + video modules (were replace-only)

### v0.32 — Pages, Draft/Publish, Backups
- Page navigator inside the builder: see all pages, search, jump to edit
- Save ≠ Publish: draft blocks live separately from published blocks; "שמור" keeps a draft, "פרסם" copies draft → published; build renders published only
- Automatic backup revisions on every save (keep last N, restore from list)

### v0.33 — Menu entity + Theme Builder v1
- "menu" becomes a real entity (DB table): items, order, nesting
- Menu module lives in the header — editable in the THEME builder, not the page builder
- Theme builder: colors, logo, menu placement variations (top / side), fonts

### v0.34 — Site-map & Structure
- Visual site-map: page tree, drag to re-parent, status badges
- More separator/section modules (banner, CTA strip, section with background)

### v0.35 — Responsive everything
- Admin + output audited on all resolutions, window-resize safe
- Mobile/tablet preview toggle in builder

### Later (pre-beta)
- Security phase: auth, CSRF, rate limits, upload validation
- Community: CONTRIBUTING.md, plugin/module API for third-party modules

## Version Log

| Version | Shipped | Source |
|---|---|---|
| v0.32-alpha | Draft/Publish split + automatic revision backups, page navigator modal (search/jump), theme overrides system (colors, fonts, logo, menu placement) with live preview + API, menu entity in DB with editor, publish flow in builder, revisions modal with restore | Ben + Grok |
| v0.32-alpha | Draft/publish separation (save keeps draft, publish snapshots), auto revisions (30/page) with restore, pages navigator with search + unpublished badges, menu entity in DB with nesting, theme overrides (colors/fonts/layout/menu top-side) + theme & menus admin pages. Fixes: db.js circular-dependency (schema silently failing), revision restore loaded published instead of draft, removed leftover patch script | Grok + Ben, review & fixes Claude |
| v0.31-alpha | DB-wired media library (folders, Explorer UI, right-click delete/copy, create folder), gallery module with multi-select picker, toolbox buttons for list/video/gallery | Ben + Claude |
| v0.30-alpha | Undo/redo, autosave + unsaved guard, list & YouTube modules, Hebrew toasts, XSS fix, semantic HTML5 output, skip-link + aria, theme comfort pass | Claude + Ben |
| v0.2 | Smart module replace, clearer RTL UX | Ben |
| v0.1 | Initial CMS: Elementor import, RTL visual builder, static export | Ben |

## Idea Pool (unscheduled)

- Column width ratios with visual handles
- Keyboard: Ctrl+D duplicate, Alt+arrows move block
- Block templates: save a group as reusable "section"
- Inline text editing on canvas
- SEO panel per page (meta, og:image, slug)
- Auto sitemap.xml + RSS on build
- Scheduled publish
- Dark mode (prefers-color-scheme)
- Second theme (cyberpunk grokskin-style)
- Elementor import: map more widget types
- Markdown import (folder of .md → pages)
- Media: alt-text editing, image resize on upload, drag file into folder

### Ben's ideas
- (add here)

### Grok's ideas
- (add here)
