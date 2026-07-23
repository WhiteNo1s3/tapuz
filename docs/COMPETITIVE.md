# Where Tapuz stands — the parity map (v1.67)

The goal: **the easiest CMS of the AI era** — end-to-end, with or without an
API key, better than what an Israeli SMB gets from WordPress, Drupal, Joomla,
or Camilyo/Mobeart-style site builders. This map is the honest scoreboard:
what we already do better, where we're at parity, and the gaps that feed the
module/feature hunt. Update it every version batch.

## Builder.io — the named competitor (benchmarked 2026-07)

Ben's goal names builder.io as competition #1, so it gets its own honest
section, grounded in what they actually ship in mid-2026 (not what their
name suggests). **Builder.io is a visual development platform for dev
teams**: Fusion (an AI agent that edits a visual canvas, writes real code
against your design system, and opens PRs), Figma-to-code, a headless CMS,
and A/B testing — priced by **seats + metered "agent credits"** (free ≈75
credits/mo; Pro ≈$19/user/mo + $25 per 500 extra credits; Enterprise custom).
It presumes you HAVE a frontend codebase, a design system, and a Git review
loop.

**Where they win — and we don't chase (different customer):**

- **Fusion-class codegen into YOUR repo** — design-to-PR against an existing
  React/Vue codebase. Our customer has no repo; Tapuz IS the site.
- **Figma-to-code** — no Figma story in Tapuz today (see hunt list).
- **A/B testing** — real experimentation engine; we have first-party
  analytics + conversions but no split testing (hunt list).
- **Enterprise headless delivery** — multi-framework SDKs, CDN-edge content
  API. Deliberately not our fight at alpha.

**Where we win — the actual wedge:**

| Axis | Tapuz | builder.io |
|---|---|---|
| **What you get** | a complete, running site + CMS + CRM inbox, self-hosted, one `node src/server.js` | a platform that plugs into the site your devs must already have |
| **AI cost model** | keyless tier (BYOT roleplay / extension / paste) = **no meter, ever**; BYOK = your key, your rate | seats + metered agent credits — the better it works, the more you pay |
| **Who can drive it** | a business owner, walked through by the builder itself (v1.66 guided tour; drop-by-intent; inline text edit) | tuned for product/design/dev teams with a Git workflow |
| **Hebrew/RTL** | first-class: RTL renderer, Hebrew slugs, logical CSS, Hebrew admin | generic i18n |
| **Openness** | `.pzn` published as a machine-readable standard ("our RPM") + full site/theme export — leave any time, take everything | proprietary platform; content lives in their cloud |
| **Published-page weight** | static export, zero-JS modules, escaped-by-construction | SDK runtime + content API calls |
| **Data** | your server, your SQLite file, first-party analytics with no IP stored | their cloud, their telemetry |

**Positioning sentence (draft for Ben):** builder.io sells AI-assisted
development to teams that own code; Tapuz gives the site itself — walked
through in Hebrew, AI-authored without a meter, exportable to a standard —
to owners who never want to see code. We do not out-Fusion them; we make
their entire category unnecessary for the SMB.

Sources: [builder.io Fusion launch](https://www.builder.io/news/fusion),
[visual development platform explainer](https://www.builder.io/m/explainers/visual-development-platform),
[2026 pricing guide](https://vitara.ai/builder-io-pricing-explained/),
[UI Bakery 2026 overview](https://uibakery.io/blog/builder-io-overview).

## Where we're ahead

| Capability | Tapuz | WordPress | Drupal / Joomla | Camilyo-style builders |
|---|---|---|---|---|
| **AI authoring without an API key** | BYOT: hand any chat the BenTML dictionary once, paste replies; extension injects/publishes; forgiving repair pipeline; **lite pack fits FREE chat plans** (v0.86) | plugins, each wanting a paid key | none native | walled-garden AI, their key, their meter |
| **A page language an LLM writes correctly first try** | BenTML — one way per construct, errors carry the literal fix, cheatsheet = the whole language on one screen | shortcode/Gutenberg JSON soup | Twig/templates — dev territory | no exposed language at all |
| **Visual builder ⇄ code, live both ways** | the canvas and the BenTML source are one page — drag rewrites code, typing recompiles the canvas, click syncs selection | Gutenberg hides its JSON | none | none |
| **Analytics out of the box** | first-party, private (no IP stored, daily-salted visitor hash), **form-conversion tracking per page**, every card exports as CSV (v0.87) | none — needs Jetpack/plugins + usually GA | none native | basic hit counters |
| **Leads land in the CMS — and get worked** | forms inbox (תיבת פניות) with honeypot + rate-limit, dashboard tile, **CSV export** (v0.87), **email notification on every new lead** (v0.94), **a real lead pipeline** — status (new→contacted→qualified→won/lost) + private notes (v1.00), **deal value + follow-up dates** with a pipeline-value summary and an overdue/due-today tile, right in the inbox (v1.12) | Contact Form 7 + a storage plugin (no pipeline, no forecast without a CRM plugin) | webform modules | yes — their strongest suit |
| **Hebrew/RTL first-class** | RTL-first renderer, Hebrew slugs, logical CSS everywhere | RTL as an afterthought | partial | localized but generic |
| **Zero-JS published pages** | tabs/accordion/carousel/table/ticker all CSS-only; JS only for opt-in analytics | plugin JS soup | theme-dependent | heavy runtime |
| **Security posture of published sites** | static export, escaped-by-construction, one audited raw-HTML door | the world's most attacked runtime | runtime + patch treadmill | opaque |
| **OS-grade admin ergonomics** | Ctrl+K command palette on every screen (v0.88) — jump to any page, section, or action from the keyboard, Hebrew or English | none native | none | none |
| **Portable, open standard — "our RPM"** | a whole site, a theme, or a page is a portable versioned file: site export/import (v1.06), theme export/import (v0.99), and the `.pzn` page format published as a machine-readable standard anyone can implement (`docs/pzn-schema.json` + `docs/pzn-spec.md`, served live at `/pzn-schema.json`) — regenerated from the module registry and drift-guarded so it never lies to an implementer (v1.36–1.37). No lock-in, no proprietary DB dump. | `.xml`/`.wxr` export (lossy, plugin-shaped, no published page-format standard) | config/entity exports, dev-only | proprietary formats, no portability |

## At parity (good enough, keep polishing)

- Page building (drag-drop, containers, undo, inline edit), menus with
  locations, media library, revisions, SEO (canonical/OG/JSON-LD/sitemap),
  themes with LOOKS, categories/article flows, scheduled-free publish loop
  ("publish MEANS live").

## The gaps — the hunt list, in priority order

1. ~~**Email notification on new lead**~~ — shipped in v0.94: `/admin/integrations`
   gets an "התראת אימייל" section (SMTP host/port/user/pass, gitignored
   `config/notify.json`, the ai.js key-storage pattern), a "שלח בדיקה" test
   button, and every successful `/api/form` submission fires a best-effort,
   never-blocking notification (`src/notify.js`). Bring-your-own-SMTP —
   Tapuz never operates a shared mail relay.
2. ~~**User roles**~~ — shipped in v0.95: `auth.js` accounts now carry a
   `role` (`admin` | `editor`); a new `/admin/team` page (admin-only) invites
   teammates, changes roles, and removes accounts, guarded so the site can
   never demote/remove its last admin. `admin` keeps every surface; `editor`
   is blocked (403, via a new `requireAdmin` middleware) from the
   security-sensitive ones — integrations/SMTP, AI keys, agent bridge
   tokens, team management, site settings — everything else (pages, media,
   menus, forms inbox, analytics, categories, storage) stays open. Legacy
   single-admin installs upgrade transparently (`roleOf()` treats a
   role-less stored account as admin). Not done: hiding admin-only nav links
   from an editor's sidebar (they 403 on click today, correct but not
   polished) and a finer editor-vs-author split — that's the agency-tier
   follow-up.
3. **FOOTER/HEADER as modules vs site-chrome** — design fork, Ben's call.
4. ~~**Search on the published site**~~ — shipped in v0.98: a build-time
   `search-index.json` (`pages.listSearchable()`, written by `exportAll()`
   only when turned on) + a floating client-side search widget
   (`renderer.js` `renderSearchWidget`, wired the same way the WhatsApp
   float is — `config.integrations.search.enabled`, toggled on
   `/admin/integrations`). Substring match over title+excerpt, no server
   round-trip after the initial index fetch — works on a fully static
   export (Netlify/S3), not just when Tapuz itself serves the site. The one
   deliberate JS-by-necessity feature among "zero-JS published pages" —
   there's no way to search a static export without a client-side index.
   Not done: fuzzy/typo-tolerant matching (lunr-style) — plain substring is
   the v1, good enough for a small-SMB page count.
5. ~~**Multilingual**~~ — shipped in v1.08: `/admin/translations` links two
   existing pages as translations of each other (`meta.translationGroup` +
   `meta.lang` on each page — no per-string translation, no URL-prefix
   routing, WPML's complexity minus ~95% of its surface, exactly as
   scoped). Ships hreflang `<link>` tags automatically + a zero-JS visible
   language switcher that appears only on pages that actually have linked
   siblings. A third+ page can join an existing pair (the group grows,
   never forks). Not done: auto-suggesting which pages might be
   translations of each other, RTL/LTR mixed-direction menu rendering
   polish.
6. **Builder.io-class builder extras** (Ben's goal, 2026-07-18) — ALL SHIPPED:
   Ctrl+K palette (v0.88), layers/outline panel (v0.89), responsive device
   preview (v0.90), symbols (v0.91), OS keyboard set (v0.92), starter
   templates gallery (v0.93 — /admin/new picks a layout; templates compose
   from registry defaults so they can't drift; neutral placeholder copy
   awaiting Ben's voice). Future tier: synced (live-linked) symbols.
7. **Module hunt continues** — timeline, steps remain; ~~pricing-table
   sugar~~ shipped in v1.05 (`pricing`/`plan`, both the canonical `.pzn`
   system and the legacy BentML keyword dialect, zero-JS, highlighted-tier
   support). CODE stays reserved; INPUT stays a FIELD child.
8. **From the builder.io benchmark (2026-07, Ben to prioritize):**
   - **A/B split testing** — we track conversions per page already; the
     missing half is serving variant A/B and attributing. Feasible on the
     static export via a tiny opt-in script (same pattern as search).
   - **Figma import** — likely via the decompiler road (Figma → HTML export
     → our HTML shredder) rather than a native plugin. Unscoped.
   - **Design tokens as a first-class concept** — our themes have LOOKS;
     builder.io's token-aware editing suggests exposing theme tokens inside
     the builder's properties panel (pick "primary" not "#0ea5e9").

(~~CSV export~~ — shipped whole in v0.87: `/admin/inbox.csv` +
`/admin/analytics.csv?what=daily|pages|referrers|devices|conversions`,
one shared Excel-proofed core in `src/csv.js`.)

## Rules of engagement

- **ToS-respect is a feature**: BYOT carries the user's own chat replies —
  no scraping, no automation against any provider's terms, no keys we hold.
- **Ideas from the grok lab are rebuilt, never copied.**
- Every module lands across all layers or not at all — `smoke-registry`,
  `smoke-bentml-engine`, and the pzn module contract enforce it in CI.
