# Tapuziel Implementation Plan

> Historical phase plan — **all three phases are done**.
> The living plan is [ROADMAP.md](ROADMAP.md) (phased versions + version log).

## Phase 1: Foundation ✅

- [x] Project structure + docs
- [x] Hebrew + RTL as first-class
- [x] CLI / Agent support as first-class
- [x] Tech decisions: Node.js + SQLite + structured blocks
- [x] SQLite schema (db.js owns all DDL)
- [x] CLI (`bin/tapuz.js`: create-page, add-block, build, serve, import-wp, ...)
- [x] Page + Block structures (docs/block-schemas.md)
- [x] Renderer (semantic RTL HTML)

## Phase 2: Core Features ✅

- [x] Admin web interface (Hebrew, per-section accent colors)
- [x] First RTL theme (`default`) + theme overrides system
- [x] Media upload + DB-backed library with folders
- [x] Tags support (drives the article system)
- [x] Page creation/editing via web, CLI, and agents

## Phase 3: Polish ✅

- [x] Better block editing (visual builder: drag, split, replace-with-soft-migration, side panel)
- [x] Static export command (+ `TAPUZ_ROOT` for any site directory)
- [x] Improved theme system (overrides, live preview, wizard integration)

## What replaced this plan

From v0.30 onward the plan moved to [ROADMAP.md](ROADMAP.md): +0.01 per shipped session,
version log with attribution, idea pool, and the North Star (Red Hat of CMSs — `.pzn`,
theme/plugin ecosystem, agent mini-API, BYO AI subscription).
