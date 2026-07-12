# Tapuziel — Roadmap & Idea Pool

**Current version: v0.43-alpha**

## How versions work

- Every working session that ships = **+0.01** (v0.32-alpha, v0.33-alpha, ...)
- Each bump gets a row in the Version Log: what shipped, whose idea
- Ideas from three brains: **Ben**, **Claude**, **Grok** — all land in this file, best ones win
- When builder + media + pages + theme builder feel complete → v1.0-beta
- Long game: a real open-source CMS competitor, community-driven once Ben sets the direction. Security hardening gets its own phase before beta.

## North Star (Ben, 2026-07-10)

**Become the Red Hat of CMSs.** Fully open source, community-driven, no DRM, no vendor lock-in — the business is the ecosystem and the mastery, not gatekeeping. Competition is absurd, so we plan big and hard; the edge is knowing what people actually want in their sites and how they want them made (Ben = CMS master), plus being **more AI-friendly than any other CMS**.

Pillars:
1. **Ideas flow from mind to website.** The wizard + page builder turn intent into a live site with minimal friction. We advise building in *our language* (page-builder blocks), but never trap anyone — overrides (classes, custom CSS) always possible in the editor, like every serious CMS.
2. **Import as a first-class citizen.** Elementor / WordPress export imports feed the wizard; an import can *skip* wizard steps it already answers (e.g. homepage creation — our generic homepage scheme with page-builder cuts/sections is only for from-scratch sites). Test-drive on an existing server or a fresh one.
3. **Theme & plugin ecosystem.** Theme *maker* (colors, gradients, palette-from-image) + theme *import type* so people build and share themes. Selling is allowed but not our advice; we take zero liability for piracy of sold themes and will never add DRM — it's open source, it's all gitted, +0.01 versioning is our method. Plugin install support.
4. **`.pzn` file format** — one portable container for imports/exports (sites, themes, plugins), same pipeline as the WordPress/Elementor import. This is a NEW packing/file system of ours and the first step of making a mark — same as Red Hat, whose mark was **RPM**, their own package format. `.pzn` is our RPM.
5. **Agents are users too.** Mini-API so agents recognize page-builder parts and know what they're editing (see docs/cli-agent-support.md). The human face of that same API is an in-admin **chatbot that looks and feels like ChatGPT** — see "Module language & AI copilot" below.
6. **Your AI subscription, not our tokens (the ace).** The *brain* of the copilot is the user's own subscription — no middleman charging tokens and reselling API. Already made with Grokin. How it works without API keys (the Grokin trick):
   - The LLM runs where the user's subscription lives — the **web browser environment**, where LLMs are confident to work — or we use conversation tricks: the bot acts from a chat by emitting instructions.
   - We set up **a chat with our syntax, `.pzn`-ready**: the user gets a primer (instructions to paste) that teaches *their* bot (ChatGPT / Claude / Grok…) Tapuziel syntax and `.pzn` syntax.
   - A **translator inside Tapuziel** parses what the bot says in our syntax and executes it through the agent mini-API. The conversation *is* the protocol.
   - API keys stay an option (already proven with ChatGPT + keys), but the goal is universal across providers. `C:\Dev\Grokin-V2` (WordPress bot + Chrome extension) is the sophisticated prior art to port in.

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

### v0.36 — Article system ✅ (shipped) + Wizard v2 (next)
- **article-list module** ✅: shows articles as "cubes" (cards) — image + title + teaser
  - Card image: set manually (page properties), OR auto-extracted from the article's first image block
  - Teaser: manual or auto from first text block; clicking a cube opens the article page
  - A page becomes an article via the new **page properties** panel (deselect → side panel): article checkbox + teaser + card image
- **Wizard v2** ✅ (shipped v0.37) — a real guided setup, not 3 questions:
  1. Site name
  2. Coloring — walks the user *through the theme creator* (teaches the tool while using it)
  3. Creates default pages: home, contact, about, articles (articles page uses article-list module)
  4. Menu step: pick from the pages just created ("the menu's menu") or href to external sites — typed links already support this
- Theme creator: evolve toward drag & drop

### Module language & AI copilot (Ben's spec, 2026-07-10)

**Modules are the type system of the page.** Each module is its own class — primitive like `int`: text, heading, image, button, youtube (paste a URL — already the pattern since v0.30), gallery, list… Containers (sections, columns) get *filled* with modules. Goal: as many modules/tools as possible — the vocabulary of our language.

- **Side options panel**: selecting a module already placed on the page opens its options in a panel at the side of the screen (not inline clutter). Every module declares its own options — one panel, schema-driven, so a new module gets its UI for free.
- **The language must be sound for agents**: an agent should be able to place a text block, take an article it co-wrote with the user and *make it real* on the page, or write into the page in real time. Structured blocks (docs/block-schemas.md) are already this — the mini-API exposes read/insert/update/move per module.
- **AI text operations**: correct, expand, shrink, rewrite. Could be offered as select-text → AI menu (keep as secondary option), **but the chosen direction is a chatbot**:
- **The copilot chatbot**: an in-admin chat that *resembles the LLM UIs people already trust*. The user who is "so confident with their ChatGPT" has a blast — the bot they "know so much about" is operational here: it understands the builder and takes real actions — halving the page into columns, making a hero, coloring text inside a text block, filling a section with the article you wrote together. Chat is the human skin over the same agent mini-API; every chatbot ability is an API ability first.

### The long game (Ben)
1. **CMS** — finish the builder, articles, themes (we are here)
2. **CRM properties** — contacts, forms that feed them, leads from the published site (Ben's mastery: CMS/CRM)
3. **Security phase** — see below; "bundle that no one can deny"
4. **Open source, community-driven** — led by whiteno1se
5. **Ecosystem** — `.pzn` import/export format, theme sharing, plugin installs, agent mini-API
6. **BYO AI subscription** — Grokin-V2 functions ported in, agents talk directly to the system (the Red Hat endgame)

### Later (pre-beta) — Security phase (Ben: features first, security before beta)
Deliberately deferred. When we get here, in order:
1. **Admin auth**: password (bcrypt/argon2) + session cookie; wizard sets it on first run
2. **Database encryption at rest**: encryption key (env var / key file outside repo) using SQLite cipher (better-sqlite3-multiple-ciphers) — "not let anyone near the database"
3. **Request hardening**: CSRF tokens on all admin POSTs, rate limiting, JSON body size limits (exists: 12mb — tighten)
4. **Upload validation**: magic-byte checks (not just mime), SVG sanitization, size caps
5. **Output**: CSP headers on admin + published site, X-Frame-Options
6. **Secrets hygiene**: gitleaks in CI; key never committed

### Community (after security)
- CONTRIBUTING.md, plugin/module API for third-party modules

## Version Log

| Version | Shipped | Source |
|---|---|---|
| v0.43-alpha | **The paste flow — BYO AI, zero keys** (Phase 2 piece 1, North Star pillar 6 goes live). New `/admin/ai` screen: copy the primer → paste the bot's reply → live preview → apply. `src/pzn/agent-primer.js` generates the paste-into-any-AI primer from the live registry (all 30 modules, reply contract, worked example — can never drift). `src/pzn-extract.js` pulls the .pzn document out of prose/code fences (```/~~~/bare). API: GET `/admin/api/pzn/primer`, POST `/admin/api/pzn/preview` (compile without saving), `loose` flag on POST source, POST `/admin/api/pzn/create-from-source` (bot invents a page: slug from bent-slug, 409 on collision). Publish from the paste flow runs exportAll — "צפה בדף החי" is live immediately. **QA**: smoke-pzn-paste.js (15 checks) in test:smoke; full REAL-BROWSER E2E on a throwaway root — login, paste a bot reply with prose around the fence, live preview rendered, new page created+published, live page served with hero/features/stats/cta. Browser QA caught two real bugs pre-ship: pages API shape mismatch in the picker, and publish-without-export 404ing the live link | Ben (vision) + Claude |
| v0.42-alpha | **The canonical editing path — .pzn source + AST ops** (Phase 1 step 4, Phase 1 complete). pages.js gains `getPageSource` (canonical .pzn, legacy fallback), `savePageSource` (validate → save → author formatting preserved byte-for-byte → title/tags/teaser/cardImage/direction sync to DB index → optional publish), `applyPageOps` (builder-standard ops: insert/update/move/replace/duplicate/remove/document via src/pzn/builder/ops, serialized back through savePageSource). New admin API (behind auth like all admin routes): GET+POST `/admin/api/pzn/source`, POST `/admin/api/pzn/ops`, GET `/admin/api/pzn/toolbox` (module schemas for agents). The visual canvas's JSON is now formally a wire projection of the file (v0.40 bridge over v0.41 store); agents/tools edit the canonical form directly. **QA**: scripts/smoke-pzn-ops.js (22 checks: formatting preservation, invalid source rejected without touching the file, every op kind, revision trail) joined test:smoke; live boot verified new routes answer 401 unauth exactly like existing admin API; full suite green (88 tests + all smokes + wizard + 1138 registry checks). **Phase 1 (unification) done — one language, one file, one model.** Next: Phase 2 the moat — signature visuals (parallax/animated text), unified agent pack, Grokin-V2 BYO-subscription translator, copilot chat | Ben (direction) + Claude |
| v0.41-alpha | **The storage flip — the .pzn file IS the page** (Phase 1 step 3, the one-data-model moment). New src/pzn-store.js: every save writes `pages/drafts/<path>.pzn`, every publish writes `pages/published/<path>.pzn` (SITE_ROOT-relative, TAPUZ_ROOT-aware). parsePageRow overlays blocks from the file when present — every reader (admin, renderer, export, article cubes) is file-first automatically; DB JSON stays as index + legacy fallback. Revisions now store canonical .pzn text (legacy JSON revisions still readable); restore flows through the file. Rename moves files, delete removes them. scripts/migrate-pzn-store.js backfills files idempotently (existing files win — they are the truth). **QA**: scripts/smoke-pzn-store.js on a throwaway root proves the flip — 18 checks incl. "edit the file on disk → CMS serves the edit while the DB still holds the old value"; full suite green (88 pzn tests, all smokes incl. round-trip, wizard E2E, 1138 registry checks); joined test:smoke. Scope note: content is file-canonical; status/theme/extended meta (redirect) stay DB-owned until the .pzn head covers them. Next: v0.42 = builder edits the AST via ops | Ben (direction) + Claude |
| v0.40-alpha | **Registry unification — every Tapuz block speaks .pzn, losslessly** (Phase 1 step 2). The pzn module registry grew from 16 to 30 modules: all 10 missing Tapuz types added (testimonial, features+feature, card, map, cta, stats+stat, logos+logo, faq+qa, contact-info, banner) with compile HTML matching src/renderer.js contracts (theme CSS keeps working), plus prop parity on existing modules (heading/text/button align, text size/lead/dropcap/maxwidth, image width, hero image+height, gallery columns, columns ratio/collapse/valign + Tapuz gap vocab, spacer size, divider bentstyle). Bridge is now two-way: `toTapuzPage`/`moduleToBlock` join `fromTapuzPage`, rule = only carry what exists (no invented defaults/ids). **QA in the way**: gate 1 = 27 synthetic round-trip tests, all 23 types + edge cases (test/pzn/tapuz-roundtrip.test.js); gate 2 = scripts/smoke-pzn-roundtrip.js proves JSON→.pzn→JSON lossless on the real DB read-only AND on a full wizard-generated site (5 pages, 24 blocks); gate 3 = 88 pzn tests + full smoke suite + 1138 registry checks green. smoke-pzn-roundtrip joined test:smoke. Next: v0.41 flips canonical storage to the page file | Ben (direction) + Claude |
| v0.39-alpha | **The merge begins — Grok language core lands in Tapuz** (Phase 1 step 1 of the unification plan). `C:\Dev\grokTapuziel`'s `.pzn`/benTML implementation ported wholesale into `src/pzn/` (language: tokenizer/AST/parse/compile/validate/serialize; modules registry with i18n labels + prop schemas; immutable builder ops; site build/publish; tapuz-json bridge; loader). All 61 node:test tests ported to `test/pzn/` and green inside Tapuz (`npm run test:pzn`); example fixtures at `examples/pzn/` + demo site at `examples/pzn-site/`. Full existing smoke suite still green (registry 1138 checks, wizard, render, drafts, articles, bentml, map, analytics). Nothing wired into the CMS yet by design — v0.40 unifies the 23-block registry with the module defs and round-trips real pages via the bridge; v0.41 flips canonical storage to the page file; v0.42 points the visual builder at the AST ops. Grounding decision: `.pzn` (constrained-HTML benTML) is the canonical standard — one data model, Red Hat play, `.pzn` is our RPM | Ben (vision) + Grok (implementation) + Claude (port & verification) |
| v0.38-alpha | BenTML v0.1 spec (`docs/bentml-v0.md`, multi-agent designed + blind-verified), registry-driven builder, admin auth, site chrome, analytics | Ben + Claude |
| v0.37-alpha | **Wizard v2**: 4 guided steps (name → coloring that *teaches the theme creator* with palettes + live mini-preview → default pages home/about/contact/articles with article-list + sample article → menu step with page picks + external links). Setup engine extracted to src/setup.js (runSetup — agents/CLI can bootstrap a site in one call). **TAPUZ_ROOT** env var via new src/paths.js — all data (db/config/public) can live in any directory (npm-publish blocker step 1). Fix: home exported only as index.html so menu links to /home.html 404'd — now writes both. Docs ecosystem aligned to version (README, next-steps, mvp-scope, implementation-plan, cli-agent-support, package.json 0.37.0-alpha). smoke-wizard E2E (32 checks, runs on throwaway root) | Ben (spec) + Claude |
| v0.36-alpha | **article-list module** (cubes: image + title + teaser, tag-driven, 1-4 columns, newest first), page properties in side panel (article toggle, manual teaser + card image with auto-extraction fallback), live article preview in builder canvas via new /admin/api/articles, canvas background click = deselect → page properties, tags/meta flow through save/publish, article-cubes theme CSS (responsive grid), smoke-articles E2E (15 checks), block-schemas.md documents article-list for agents | Ben (spec) + Claude |
| v0.32-alpha | Draft/Publish split + automatic revision backups, page navigator modal (search/jump), theme overrides system (colors, fonts, logo, menu placement) with live preview + API, menu entity in DB with editor, publish flow in builder, revisions modal with restore | Ben + Grok |
| v0.35-alpha | Renamed to **Tapuziel** (Tapuz + Shaltiel's ־יאל — free on npm), npm packaging (bin: tapuziel + tapuz alias, engines, repository, npm pack verified 81 files), full E2E: wizard → published site → static serve all verified. TODO before real npm publish: cwd-based paths refactor (db/config/public should live in the user's project dir, not inside node_modules) | Ben + Claude |
| v0.34-alpha | Admin section identity (subtle accent color per area: pages blue, menus purple, theme green, sitemap orange), first-run setup wizard for newcomers (3 questions → site + home page + menu + build), security phase spec'd in roadmap (deferred by design) | Ben + Claude |
| v0.33-alpha | Typed menu links (existing page picker, custom URL, tel: click-to-call, mailto:, anchor), /admin/sitemap tree derived from menus with published/draft/missing badges + orphan-page detection, redirect pages via meta.redirect, menu editor rewrite with live URL preview | Ben + Claude |
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
- **Palette from image**: in the theme maker, drop in images that *feel like the color you want* — extract a palette (+ gradients) from them
- **Gradient support** in theme coloring, not just flat colors
- **`.pzn` format**: single-file import/export container (site / theme / plugin), shares the import pipeline with WordPress/Elementor exports
- **Theme import type**: anyone can package a theme as an import and share it; selling allowed, no DRM, no piracy liability on us
- **Plugin install**: install plugins from a file (`.pzn`) — third-party module API is the foundation (see Community section)
- **Import skips wizard steps**: importing a site auto-answers wizard questions it can (homepage, pages, menu) — wizard only asks what's still missing
- **Generic homepage scheme**: from-scratch sites get a homepage pre-cut into page-builder sections (hero / content / CTA…) so there's never a blank page
- **Agent mini-API**: endpoint/spec that lets agents identify page-builder blocks and edit them safely — make Tapuziel the most AI-friendly CMS
- **Copilot chatbot in admin**: ChatGPT-style chat that operates the builder for real (halve page, make hero, color text, place the co-written article) — human skin over the agent mini-API
- **Select-text AI actions**: correct / expand / shrink / rewrite on selected text — secondary entry point alongside the chatbot
- **Side options panel**: module options appear in a side panel when a placed module is selected; schema-driven so every new module gets its panel for free
- **BYO AI subscription**: user's own AI subscription powers the in-CMS assistant (no token middleman); port the Grokin-V2 bot + Chrome extension functions (`C:\Dev\Grokin-V2`), universal across providers
- **Syntax primer + translator**: user pastes a primer into their own bot to teach it Tapuziel/`.pzn` syntax; the bot replies in our syntax and a translator in Tapuziel parses + executes via the mini-API — BYO subscription with zero API keys (the Grokin trick)

### Grok's ideas
- (add here)
