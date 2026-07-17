# Where Tapuz stands — the parity map (v0.87)

The goal: **the easiest CMS of the AI era** — end-to-end, with or without an
API key, better than what an Israeli SMB gets from WordPress, Drupal, Joomla,
or Camilyo/Mobeart-style site builders. This map is the honest scoreboard:
what we already do better, where we're at parity, and the gaps that feed the
module/feature hunt. Update it every version batch.

## Where we're ahead

| Capability | Tapuz | WordPress | Drupal / Joomla | Camilyo-style builders |
|---|---|---|---|---|
| **AI authoring without an API key** | BYOT: hand any chat the BenTML dictionary once, paste replies; extension injects/publishes; forgiving repair pipeline; **lite pack fits FREE chat plans** (v0.86) | plugins, each wanting a paid key | none native | walled-garden AI, their key, their meter |
| **A page language an LLM writes correctly first try** | BenTML — one way per construct, errors carry the literal fix, cheatsheet = the whole language on one screen | shortcode/Gutenberg JSON soup | Twig/templates — dev territory | no exposed language at all |
| **Visual builder ⇄ code, live both ways** | the canvas and the BenTML source are one page — drag rewrites code, typing recompiles the canvas, click syncs selection | Gutenberg hides its JSON | none | none |
| **Analytics out of the box** | first-party, private (no IP stored, daily-salted visitor hash), **form-conversion tracking per page**, every card exports as CSV (v0.87) | none — needs Jetpack/plugins + usually GA | none native | basic hit counters |
| **Leads land in the CMS** | forms inbox (תיבת פניות) with honeypot + rate-limit, dashboard tile, **one-click Excel-ready CSV export** (v0.87 — BOM for Hebrew, formula-injection guarded) | Contact Form 7 + a storage plugin | webform modules | yes — their strongest suit |
| **Hebrew/RTL first-class** | RTL-first renderer, Hebrew slugs, logical CSS everywhere | RTL as an afterthought | partial | localized but generic |
| **Zero-JS published pages** | tabs/accordion/carousel/table/ticker all CSS-only; JS only for opt-in analytics | plugin JS soup | theme-dependent | heavy runtime |
| **Security posture of published sites** | static export, escaped-by-construction, one audited raw-HTML door | the world's most attacked runtime | runtime + patch treadmill | opaque |
| **OS-grade admin ergonomics** | Ctrl+K command palette on every screen (v0.88) — jump to any page, section, or action from the keyboard, Hebrew or English | none native | none | none |

## At parity (good enough, keep polishing)

- Page building (drag-drop, containers, undo, inline edit), menus with
  locations, media library, revisions, SEO (canonical/OG/JSON-LD/sitemap),
  themes with LOOKS, categories/article flows, scheduled-free publish loop
  ("publish MEANS live").

## The gaps — the hunt list, in priority order

1. **Email notification on new lead** — the inbox is silent until visited.
   Needs SMTP config (product decision: whose SMTP). WordPress does this via
   wp_mail out of the box.
2. **User roles** — one admin account today. WP/Drupal have editors/authors.
   For the Red Hat-style support model this matters at the agency tier.
3. **FOOTER/HEADER as modules vs site-chrome** — design fork, Ben's call.
4. **Search on the published site** — static export has no search; a tiny
   client-side index (lunr-style, build-time) fits the zero-runtime model.
5. **Multilingual** — Hebrew-first is the moat, but he↔en paired pages would
   beat WPML's complexity with a fraction of the surface.
6. **Builder.io-class builder extras** (Ben's goal, 2026-07-18) — saved
   reusable blocks ("symbols"), starter templates gallery. Done so far: the
   Ctrl+K palette (v0.88), the layers/outline panel (v0.89), responsive
   device preview (v0.90 — the REAL rendered draft at 375/768/1024/full).
7. **Module hunt continues** — timeline, steps, pricing-table sugar
   (CODE stays reserved; INPUT stays a FIELD child).

(~~CSV export~~ — shipped whole in v0.87: `/admin/inbox.csv` +
`/admin/analytics.csv?what=daily|pages|referrers|devices|conversions`,
one shared Excel-proofed core in `src/csv.js`.)

## Rules of engagement

- **ToS-respect is a feature**: BYOT carries the user's own chat replies —
  no scraping, no automation against any provider's terms, no keys we hold.
- **Ideas from the grok lab are rebuilt, never copied.**
- Every module lands across all layers or not at all — `smoke-registry`,
  `smoke-bentml-engine`, and the pzn module contract enforce it in CI.
