# Architecture Decisions for Tapuz

## Core Philosophy
- Public site = clean, semantic, high-quality HTML/CSS/JS (as close to hand-coded as possible)
- Admin can be more "app-like" (we don't care if admin uses modern conveniences)
- Export to pure static HTML should always be possible

## Key Questions (to be answered)

- [ ] Backend runtime?
- [ ] Static generation vs lightweight dynamic server?
- [ ] Database choice (SQLite first?)
- [ ] Auth strategy
- [ ] How visual is the page builder?
- [ ] Component/Block system design

## Initial Tech Leanings

**Preferred for now:**
- Node.js (easy to work with in this environment)
- SQLite (via better-sqlite3 or similar)
- Vanilla JS + Tailwind in admin
- Alpine.js or minimal custom JS for builder interactions

## Theme Standard (to be designed)

Every theme should have:
- `theme.json` manifest
- Defined regions/slots (header, footer, sidebar, main content areas)
- Component library (reusable blocks)
- Responsive breakpoints contract
- CSS variables for theming

## Security Priorities
- Strong input sanitization on all content
- CSRF protection
- Rate limiting on admin
- Media upload validation
- Principle of least privilege for admin accounts
- Regular "export clean site" capability

## Migration Considerations
- We need a good WordPress importer eventually
- Start by supporting basic pages + posts + media
- Tags / categories / taxonomies

---
Last updated: 2026-07-08
