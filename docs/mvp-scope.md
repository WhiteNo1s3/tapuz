# Tapuz MVP Scope

## Goal for first usable version
Be able to:
1. Create and edit pages through a simple interface
2. Apply a basic modular theme
3. Have responsive output by default
4. Manage media
5. Have basic tagging
6. Serve the site securely
7. Export the site as static files

## Must Have for MVP

- [ ] Database (SQLite)
- [ ] User authentication (at least one admin user)
- [ ] Page model (title, slug, content blocks, status, tags, direction: rtl/ltr)
- [ ] Basic block system (text, heading, image, button, columns, html)
- [ ] Simple page builder (form-based at first) with strong RTL support
- [ ] Media upload + library (images at minimum)
- [ ] Theme system with at least 1 working RTL-first theme
- [ ] Theme standard (theme.json + slot system)
- [ ] Responsive + RTL base layout
- [ ] Public site renderer that outputs clean HTML with proper `dir="rtl"` and `lang="he"`
- [ ] Admin interface with Hebrew support (protected)
- [ ] Basic security (auth, sanitization)
- [ ] Excellent support for CLI / AI agents to create and edit content

## Nice to Have (post-MVP or stretch)
- Visual drag & drop builder
- Posts / blog functionality
- Multiple themes
- Menu builder
- SEO fields
- Version history
- Full WordPress importer
- Static site export tool

## Out of Scope for MVP
- Multi-user with roles (start with single admin)
- Complex e-commerce
- Headless API (unless trivial to add)
- Advanced theming (keep it focused)

---
Status: Draft — needs your input
