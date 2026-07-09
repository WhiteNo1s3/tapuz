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

## Planned Capabilities (future but design for them now)

- `tapuz create-page --title "..." --slug "..." --content '...'`
- `tapuz edit-page <slug>`
- `tapuz build` (generate static version)
- Direct database access for power users
- Simple REST endpoints or just direct DB for agents (with auth)
- Ability to import/export pages as clean JSON

## Current Implications (MVP)

- Store page content as structured JSON (blocks array) — easy to generate from agents
- Use slugs as the primary key for humans + scripts
- Make the public renderer work from command line too (for static builds)
- Keep block types simple and well-documented

We will design the block system with "easy to generate programmatically" in mind.

---
This is a first-class requirement, not a nice-to-have.
