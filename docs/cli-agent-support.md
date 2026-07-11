# CLI & Agent-Friendly Design (Tapuz)

We want Tapuz to be **great to work with from the command line and from AI agents** (Claude, OpenClaw, scripts, etc.), not just through the web admin.

## Why This Matters
- You (and I) will build a lot of content programmatically
- Faster iteration than clicking through a UI
- Better for bulk operations, migrations, and automation

## Goals

- Easy to create/edit pages from scripts/CLI
- Content should be addressable and editable without the web UI
- The system should feel "scriptable" by design
- Still have a nice web admin for when needed

## Design Principles for CLI/Agent Support

1. **SQLite first** — Very easy to query and modify directly or via simple scripts
2. **Clear data model** — Pages, blocks, media, tags should have simple, predictable structures
3. **Slug-based addressing** — Easy to target specific pages
4. **JSON-friendly** — Blocks and page data should be easy to generate as JSON
5. **Separate concerns** — The renderer should be callable from scripts too
6. **Minimal magic** — Avoid things that only live inside the web admin

## Current Capabilities (v0.37-alpha)

### CLI — `bin/tapuz.js` (npm bins: `tapuziel`, `tapuz`)

- `create-page <title> [slug]`, `delete-page <slug>`, `list-pages`, `show <slug>`, `preview <slug>`
- `add-block <slug> <type>` — block types in docs/block-schemas.md
- `set-menu <name> '<json>'`, `set-logo`
- `import-wp <export.xml>` — WordPress/Elementor import
- `build` (static export), `serve`, `init-db`

### Programmatic (require from `src/`)

- `pages.js`: createPage / updatePage / publishPage / listPages / listArticles / restoreRevision
- `setup.js`: **runSetup(answers)** — the whole wizard as one call (site name, colors,
  pages, menu → live site). Agents can bootstrap a full site skeleton with it.
- `renderer.js` / `export.js`: render + static build callable from any script
- `TAPUZ_ROOT` env var: point all data (db/, config/, public/) at any directory

### Admin HTTP API (no auth yet — Security phase pre-beta)

- `GET /admin/api/pages`, `GET /admin/api/articles?tag=&limit=`
- `POST /admin/save`, `POST /admin/publish` (blocks + tags + meta), `POST /admin/build`
- `GET/POST /admin/api/theme`, `GET/POST /admin/api/menus`, `GET /admin/api/sitemap`
- `POST /admin/setup` — Wizard v2 payload (see src/setup.js JSDoc)

## The direction (North Star in ROADMAP.md)

This grows into the **agent mini-API**: agents recognize page-builder modules and edit
them safely, an in-admin copilot chatbot rides the same API, and a syntax primer +
translator lets a user's own AI subscription (ChatGPT/Claude/Grok) operate the system
with zero API keys.

---
This is a first-class requirement, not a nice-to-have.
