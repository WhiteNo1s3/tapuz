# Tapuziel MVP Scope

> Historical scope doc — kept as the checklist of the original goal.
> Current status lives in [ROADMAP.md](ROADMAP.md). Updated for v0.37-alpha.

## Goal for first usable version — **reached**

1. [x] Create and edit pages through a simple interface (visual builder)
2. [x] Apply a basic modular theme (default theme + overrides)
3. [x] Responsive output by default
4. [x] Manage media (DB-backed library with folders)
5. [x] Basic tagging (tags drive the article system)
6. [ ] Serve the site securely → **deliberately deferred to the Security phase (pre-beta)**
7. [x] Export the site as static files

## Must Have for MVP

- [x] Database (SQLite)
- [ ] User authentication → Security phase (spec'd in ROADMAP, before beta)
- [x] Page model (title, slug, content blocks, status, tags, meta, direction: rtl/ltr)
- [x] Block system (15+ modules; no raw-html block by design — see block-schemas.md)
- [x] Page builder with strong RTL support (drag & drop, split-to-columns, side properties panel)
- [x] Media upload + library
- [x] Theme system with 1 working RTL-first theme
- [x] Theme standard (theme.json + layouts) — overrides system on top
- [x] Responsive + RTL base layout
- [x] Public renderer: clean HTML, `dir="rtl"`, `lang="he"`, semantic HTML5
- [x] Admin interface in Hebrew
- [ ] Basic security (auth, hardening) → Security phase
- [x] Excellent support for CLI / AI agents

## Nice to Have — mostly shipped

- [x] Visual drag & drop builder
- [x] Posts / blog functionality (article system, v0.36)
- [x] Menu builder (menu entity + typed links)
- [x] Version history (revisions with restore)
- [x] WordPress importer
- [x] Static site export
- [x] First-run wizard (v2: guided, teaches the theme creator)
- [ ] Multiple themes (idea pool)
- [ ] SEO fields per page (idea pool)

## Out of Scope for MVP (unchanged)

- Multi-user with roles (single admin until Security phase)
- Complex e-commerce
- Headless API beyond the admin API (agent mini-API is the North Star version of this)
