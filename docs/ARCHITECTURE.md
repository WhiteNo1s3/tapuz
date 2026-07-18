# Architecture — breaking up the monolith, one safe extraction at a time

`src/server.js` grew organically across 95 versions into one ~5,000-line file:
every admin route, every inline HTML template, business logic, and the auth
gate all in one module. That's real technical debt against the North Star's
own words — "modular," "everyone to enjoy editing this code as
professionals." This doc is the plan for paying it down, and the standard
future extractions should follow.

## Why not a big-bang rewrite

`server.js` is the live surface for a real, currently-deployed site. A
sweeping rewrite risks silent breakage across dozens of routes at once with
no way to bisect what broke. Instead: **extract one cohesive, low-risk piece
at a time, verify against the full smoke suite before moving on, and give
the extracted piece its own smoke test.** Small, reversible, always green —
the same discipline this codebase already applies to every feature.

## The pattern

1. **Identify a self-contained piece** — a set of functions/routes whose
   dependencies are limited to other `src/*` modules (never `app`, `PORT`,
   or other server.js-local closures). Pure UI/logic helpers are the easiest
   first cut; stateful route groups (their own DB access, their own request
   handling) come next.
2. **Move it to its own file** under `src/` (or `src/routes/` once route
   groups start moving, not just helpers). It requires only what it needs —
   no reaching back into `server.js`.
3. **`server.js` imports what it needs** via destructuring
   (`const { x, y } = require('./the-new-module')`), same as it already does
   for `./auth`, `./pages`, `./config`, etc. — this was already the norm for
   business logic; the gap was the UI shell and route bodies staying inline.
4. **Give the extraction its own smoke test** (`scripts/smoke-<name>.js`,
   the established pattern — throwaway `TAPUZ_ROOT`, `OK`/`FAIL` lines, exit
   1 on failure) that exercises the module directly, independent of
   `server.js` wiring it in.
5. **Run the full `test:smoke` suite** before and after. Zero regressions
   is the bar — an extraction that changes behavior isn't a refactor.

## Extracted so far

- **`src/admin-ui.js`** (v0.96) — the admin UI shell: `layout()` (the HTML
  skeleton every admin page renders into), `adminNav()` (the persistent
  nav), `ADMIN_NAV_GROUPS`/`ADMIN_ACCENTS`/`accentFor` (the nav's data +
  per-section color), `paletteBootJson()` (Ctrl+K command data), and
  `escapeAdmin()` (the HTML-escape every admin template uses). Depends only
  on `./auth` (for the logout form's `getAdminBase()`). Verified by
  `scripts/smoke-admin-ui.js`.
- **`src/http-util.js`** (v0.97) — `clientIp()`, `wantsJson()`,
  `isStateChanging()`: pure request helpers used by the rate limiters, the
  CSRF check, and content negotiation. Zero dependencies.
- **`src/admin-guard.js`** (v0.97) — `requireAdmin()`, the role gate for
  security-sensitive routes (v0.95). Depends only on `./http-util`. Moving
  this out (not just `admin-ui.js`) is what actually unblocks route-group
  extraction — every gated route needs it, and it can't live inside
  `server.js` once routes move out.
- **`src/routes/team.js`** (v0.97) — the first full **route-group**
  extraction (not just a shared helper): every `/admin/team*` route as a
  mounted Express `Router`. `server.js` shrinks to one line —
  `app.use(require('./routes/team'))`. Verified twice: `smoke-team.js`
  (the `auth.js` data-layer contract, already existed) plus new
  `smoke-team-routes.js` (boots a real server, proves the role gate
  actually 403s an editor and 200s an admin through real HTTP — the router
  wiring itself, not just the underlying functions).
- **`src/routes/integrations.js`** (v1.01) — the second route-group
  extraction, following the exact `routes/team.js` template: every
  `/admin/integrations*` page + API route AND the `/admin/api/notify/*`
  routes (shown on the same admin page, natural to move together) —
  WhatsApp float, site search toggle, lead email notifications, GA4/first-
  party analytics/the disabled GA Data API skeleton. Verified by
  `smoke-integrations-routes.js` (role gate through real HTTP, a full
  settings round-trip via the mounted router, notify settings never
  echoing the password over the wire).
- **`src/routes/seo.js`** (v1.02) — the third route-group extraction:
  site-wide SEO defaults (title pattern, default description/og:image, base
  URL). Proving the template scales down as well as up. Verified by
  `smoke-seo-routes.js` (the settings round-trip AND the one real piece of
  logic here — baseUrl validation: a schemeless domain gets `https://`
  auto-prefixed, garbage input is rejected with 400 and leaves the
  previously-saved value untouched, an explicit empty string clears it
  without being treated as invalid).
- **`src/routes/sitemap.js`** (v1.03) — the fourth route-group extraction,
  and the simplest yet: one read-only GET, no API endpoint, structure
  entirely derived from `src/sitemap.js`'s `buildSitemap()`, nothing to
  round-trip. Verified by `smoke-sitemap-route.js` — not just a 200 check,
  but that the actual rendered structure is right: menu items link
  correctly, an orphan page (published but in no menu) surfaces in the
  orphans section with the right published/draft badge, and an
  unauthenticated request never leaks the page.
- **`src/routes/site-chrome.js`** (v1.04) — the fifth route-group
  extraction, and the largest single-page one yet (~250 lines): header
  tagline/logo/sticky/CTA + footer text/credit/link-columns/social-links.
  Verified by `smoke-site-chrome-route.js` — the settings round-trip
  through real HTTP AND the actual complexity in this page (the
  filter/dedupe logic: a fully-empty footer column is dropped, a blank
  link inside a real column is dropped while the real one survives, a
  social row with no URL is dropped) survived the move intact, plus a
  partial-update check (saving only `header` must not wipe a
  previously-saved `footer`).
- **`src/routes/menus.js`** (v1.07) — the sixth route-group extraction:
  menu entities (name → nestable items) + the location map (which menu
  renders in the header vs footer). The editor's client logic already
  lived in a pre-existing external `public/admin-menus.js` (same pattern
  as `admin-theme.js`), so this move was routes + page shell only.
  `menusLib`/`loadMenus`/`saveMenus`/`saveMenu` — now unused in
  `server.js` — were removed from its top-level requires (dead-import
  cleanup, not just a move). Verified by `smoke-menus-route.js` (create,
  nested items, location assignment, delete — all through real HTTP against
  the mounted router).
- **`src/routes/translations.js`** (v1.08) — built directly as a route
  module (not inline-then-extracted) for the new multilingual-pairing
  admin page — the pattern is now the default way to add a new admin
  screen, not just a refactor applied after the fact.
- **`src/routes/storage.js`** + **`src/routes/categories.js`** (v1.09) —
  the seventh and eighth extractions, done together (two small,
  independent admin pages). `server.js` crossed below 4,000 lines
  (3,974) for the first time this session. Verified by
  `smoke-storage-route.js` / `smoke-categories-route.js`.
- **`src/routes/media.js`** (v1.10) — the ninth extraction, and the last
  named same-shaped candidate: folder CRUD, upload (magic-byte validation
  lives inside `src/media.js`'s `saveBase64`, unaffected by the move), the
  legacy root-scope `/admin/assets` list, and the library browser page —
  three non-contiguous blocks in the original file, unified into one
  route module. A fully dead, already-commented-out `/admin/upload-legacy`
  block ("unused after v0.31" per its own comment) was dropped rather than
  relocated. `server.js` dropped another 223 lines (3,974 → 3,751).
  Verified by `smoke-media-route.js` — a real upload with a real
  magic-byte-valid PNG (not a placeholder string), folder move, delete,
  and the root-vs-subfolder scoping distinction between `/admin/media` and
  the legacy `/admin/assets` (the first draft of this test assumed
  `/admin/assets` was a recursive all-folders list; it isn't — root-scope
  only, same as `/admin/media` with no folder param — caught and fixed
  before the test shipped).

- **`src/admin-gate.js`** (v1.11) — the auth/CSRF gate itself: the single
  middleware that gates the entire `/admin` namespace (rate limit → CSRF →
  session → role resolution). The highest-stakes extraction this session —
  unlike every route-group move, this one changes what runs on EVERY
  request, not just a handful of specific paths. The safety rule that made
  it low-risk anyway: **only the logic moved, never the registration
  point** — `server.js` still calls `app.use(require('./admin-gate').adminGate)`
  at the exact same line, after the same static mounts, before the same
  routes; ordering relative to body-parsers and `express.static` was never
  touched. `adminLimiter` (the per-IP flood cap `FixedWindowLimiter`
  instance) moved into the new module too, since it existed solely to
  serve this gate. Verified by `smoke-admin-gate.js` (16 checks, all
  security properties, not features): public routes untouched, the
  HTML-vs-JSON response-shape branch on unauthenticated requests (302
  redirect vs. 401 JSON), CSRF rejection for both a forged cross-origin
  `Origin` and a missing one entirely (fail closed), that GET requests are
  correctly CSRF-exempt, real login issuing a real session, the gate's
  role resolution feeding `requireAdmin` correctly downstream for both an
  admin and an editor, and the rate limiter actually tripping after 305
  requests (which also proves it runs *before* the `/admin/login` session
  exemption, not after). A test-script bug (defaulting `Accept` to
  `application/json` for every call, including the one checking the HTML
  redirect path) was caught and fixed before the suite shipped.

- **`src/pzn-source.js`** + **`src/routes/pzn-tools.js`** (v1.13) — the
  first sub-concern split of the page-builder/pzn API surface itself.
  `pzn-source.js` holds `looksLikePzn`/`pznSourceToBlocks`, the shared
  forgiving-import pipeline used by every paste door (still referenced by
  the decompile route that stayed in `server.js`, so it had to become a
  real shared module, not just move wholesale). `routes/pzn-tools.js`
  carries every STATELESS pzn endpoint — repair (dry-run), graduate,
  to-blocks, toolbox, primer, preview — deliberately chosen because none
  of them ever touch a page file on disk, unlike `source`/`decompile`/
  `create-from-source`/`ops` (which stay in `server.js` for a later,
  separate cut — split by risk, not moved wholesale). Verified by
  `smoke-pzn-tools-route.js` (11 checks) — genuinely new HTTP-level
  coverage; no prior smoke test exercised these six endpoints over the
  wire before, only their underlying logic indirectly. A test-script
  assumption about `toolbox`'s response shape (assumed a flat array;
  it's `{categories: [...]}`) was caught and fixed before the suite
  shipped.

- **`src/routes/pzn-pages.js`** (v1.14) — the second and last sub-concern
  split of the page-builder/pzn API surface, closing the gap v1.13 left
  open. Every page-MUTATING pzn endpoint — `source` (GET/POST), `decompile`
  (URL/HTML input, async image ingestion via `media-ingest.js`, the
  BenTML-paste-vs-HTML-shredder branch from v0.69), `ops` (builder-standard
  AST mutations via `pzn/builder/ops.js`), `create-from-source` (the
  bot-authored-reply flow, including the v0.72 empty-placeholder guard and
  slug-collision 409) — moved together as one router, since they share the
  same risk profile (real disk writes) that the v1.13 stateless cluster
  deliberately excluded itself from. `pzn-source.js`'s
  `looksLikePzn`/`pznSourceToBlocks` stayed exactly where v1.13 put it —
  still required by the unrelated "advanced code tab" route that remains in
  `server.js`, proving it earned its status as a real shared module rather
  than something that should have moved wholesale with this cut.
  `server.js` dropped another 242 lines (3,647 → 3,405), crossing below
  3,500 for the first time this session. Verified by
  `smoke-pzn-pages-route.js` (24 checks) — genuinely new HTTP-level
  coverage for a cluster only ever exercised indirectly before, including
  the draft/published divergence contract itself (an unpublished save must
  never touch the live copy; `publish:true` must converge them) and a
  strict-save failure returning a usable repair suggestion without
  mutating the existing draft. A test-fixture bug (guessed `ops`'s insert
  overrides used an `html` key for content; the real module schema uses
  `text`) was caught and fixed before the suite shipped.

- **`src/routes/theme.js`** (v1.15) — the tenth route-group extraction, and
  the first one found by re-scanning `server.js` after every previously
  named candidate had already shipped: the theme settings API (GET/POST
  overrides, export, import) plus the `/admin/theme` page itself — one
  cohesive page-and-its-API pair, same template as `site-chrome.js` and
  `seo.js`. Not gated by `requireAdmin`, matching every other editor-level
  settings page. A genuine dead-import cleanup came with the move:
  `getThemeSettings`/`saveThemeSettings`/`loadOverrides`/`overridesToCss`
  were destructured at the top of `server.js` but, once the route bodies
  moved out, only `LOOKS` (used by the unrelated setup-wizard page) was
  still referenced — trimmed to just that. `server.js` dropped another 163
  lines (3,405 → 3,242). Verified by `smoke-theme-route.js` (11 checks) —
  the page rendering with its real script tags intact, a color-override
  round-trip through the mounted router, an unset field falling back to
  its default rather than being wiped, and both the export package shape
  and the import validation (wrong-format package rejected, a real one
  applied and immediately live on a follow-up GET).

- **`src/routes/analytics.js`** (v1.16) — the eleventh route-group
  extraction: the analytics dashboard page (per-day SVG chart, top pages/
  referrers, device breakdown, form-conversion-by-page) and its CSV export,
  one cohesive reporting page matching the established page+API template.
  Deliberately left behind: the pageview *collection* endpoint
  (`POST /_tapuz/collect`, public-facing, unauthenticated, rate-limited) —
  a different concern (write path vs. this read/report path) with its own
  risk profile, so it stays in `server.js` rather than being dragged along
  for topical proximity. `gaData` (the GA Data API read-back status,
  referenced nowhere else in `server.js`) moved fully into the new route
  file; `analytics` itself stays a top-level `server.js` require too, since
  the collector endpoint still calls `analytics.isBot`/`recordPageview`.
  `server.js` dropped another 201 lines (3,242 → 3,041), the first time
  this session under 3,100. Verified by `smoke-analytics-route.js` (10
  checks) — seeded with REAL pageviews through the actual public collector
  endpoint rather than fixture rows inserted straight into the database, so
  this proves the collector → storage → dashboard pipeline still connects
  correctly through the extraction: the seeded views and referrer surface
  in the rendered dashboard, an admin-path pageview is confirmed never
  recorded (the defense-in-depth check surviving the move), the days-range
  selector and its invalid-value fallback both still work, and the CSV
  export carries the real seeded numbers in the quoted-cell format
  `csvTable` actually produces (the first draft of this test assumed
  unquoted CSV cells and failed honestly — fixed before the suite shipped).

- **`src/routes/import.js`** (v1.17) — the twelfth route-group extraction:
  the import wizard (`/admin/import`, picking a source system + uploading
  its export file) plus the API that actually runs the import through
  `src/importers.js` and lands real `.pzn` pages. A small, fully
  self-contained pair — WordPress/Elementor is the one live adapter today,
  the rest render as "coming soon" placeholders per `docs/COMPETITIVE.md`'s
  own import roadmap. `server.js` dropped another 99 lines (3,041 → 2,946).
  Verified by `smoke-import-route.js` (8 checks) — a REAL WordPress WXR
  export run through the mounted router (not a mocked importer call):
  Gutenberg-block content lands as real `.pzn` source, a draft item and a
  non-content nav item are both correctly skipped, and the collision-
  suffixing rule (never clobber an existing slug) is verified by importing
  the same file twice and confirming the first import's page is untouched
  on the second pass. One fixture bug (the WXR sample page's slug
  collided with the `home` page the test's own `runSetup` fixture already
  creates, so the first two assertions on it were actually reading the
  WRONG page) was caught and fixed before the suite shipped.

- **`src/routes/mission.js`** (v1.18) — the thirteenth route-group
  extraction: the copilot-mission ADMIN API (`/admin/api/mission/*` —
  list providers, produce a teach pack, create a mission, activate one).
  This is the admin-facing half of the BYO-AI copilot flow (mint the
  roleplay teach-pack + build-quest an external AI runs). Deliberately
  left in `server.js`: the copilot's own PULL side —
  `/agent/v1/mission` and `/agent/v1/mission/:id/step`, bearer-token
  authenticated, on the public `/agent` surface — because it's the same
  feature but a genuinely different surface with different auth (agent
  token vs. admin session), and splitting by surface is the same
  principle that kept `/_tapuz/collect` out of the analytics route in
  v1.16. Every handler already used local `require()` calls, so nothing
  reached back into `server.js`. `server.js` dropped another 67 lines
  (2,946 → 2,879). Verified by `smoke-mission-route.js` (11 checks) —
  genuinely new HTTP-level coverage for the admin mission API (only the
  copilot PULL side had prior coverage, via `smoke-agent-bridge`): the
  provider list carrying real destination URLs for the named AIs while
  the catch-all `generic` entry intentionally has none, the teach pack
  reporting a real module count, a full mission create → activate
  round-trip proving it persisted through `mission-store` (not just
  echoed), and both the blank-description 400 and unknown-id 404 error
  paths. A test-assertion bug (asserted EVERY provider carries a non-
  empty URL; the `generic`/"Any AI" provider deliberately has an empty
  one) was caught and fixed before the suite shipped.

- **`src/routes/agent-tokens.js`** (v1.19) — the fourteenth route-group
  extraction: the admin-only API that mints/lists/revokes the bearer
  tokens gating the public `/agent` surface (`/admin/api/agent-tokens*`,
  all `requireAdmin` since a minted token is site access at credential
  tier — v0.95). Deliberately staying in `server.js`: the token
  VERIFICATION path (`agentTokens.verifyAgentToken`), because it's
  middleware wiring on the `/agent` surface, not a route — the same
  surface/auth split as v1.18's mission cut. `agentTokens` remains a
  top-level `server.js` require for exactly that reason. `server.js`
  dropped another 17 lines (2,879 → 2,862). Verified by
  `smoke-agent-tokens-route.js` (13 checks, security-focused, all passing
  first try): the `requireAdmin` gate actually 403s an editor for both
  list and mint, the secret is returned exactly ONCE at mint and never
  appears in the list (checked by substring, not just field-shape), a
  minted token genuinely authenticates a real `/agent/v1/ping` while a
  tampered one is 401'd, and — the property that matters most — revoking
  a token actually KILLS its `/agent` access (a follow-up ping with the
  revoked secret 401s), not just removes the list row.

- **`src/routes/symbols.js`** (v1.20) — the fifteenth route-group
  extraction: the saved-reusable-block library API behind the builder's 💠
  panel (`/admin/api/symbols*` — list / save / delete, v0.91). A small,
  fully self-contained CRUD trio; every handler already called
  `require('./symbols')` locally, and the builder's client panel (the
  `symbols-fold`/`symbols-list` toolbox UI that lives on the `/admin/edit`
  page, plus `public/admin-builder.js`) is untouched, so only the API
  moved. `server.js` dropped another 25 lines (2,862 → 2,837). Verified by
  a new `smoke-symbols-route.js` (9 checks — list/save/delete round-trip,
  the nameless-and-typeless 400 guards, the detached-snapshot round-trip,
  and the unknown-id clean `{ok:false}`) AND by fixing the PRE-EXISTING
  `smoke-symbols.js`, whose source-assert (`app.get('/admin/api/symbols'…`
  must appear in `server.js`) correctly went red the moment the routes
  moved — updated to assert the routes on the new router module and that
  `server.js` mounts it, the same stale-source-assert fix pattern used for
  `smoke-palette.js` in v1.05. That red test is the extraction working as
  intended: a wiring assertion catching that the wiring changed.

- **`src/routes/content-api.js`** (v1.21) — the sixteenth route-group
  extraction: the read/history content API — the page-navigator list
  (`/admin/api/pages`, with `?q=` search + `?status=` filter), the
  article-cube list (`/admin/api/articles`), and the revision history +
  restore (`/admin/api/revisions/:fullPath`, `/admin/api/revisions/
  restore`). Grouped by DATA concern — all four read (and one restores)
  page data through `src/pages.js` — rather than by URL prefix; the page-
  MUTATING routes (create/save/publish/delete) stay in `server.js` as a
  heavier, higher-risk cut for their own pass. A real dead-import cleanup
  rode along: `listArticles`/`listRevisions`/`restoreRevision` were each
  used in exactly one place (the routes that just moved), so they were
  trimmed from `server.js`'s top-level `require('./pages')` destructure —
  `listPages`/`getPageByFullPath`/etc. stay, being used across many other
  routes. `server.js` dropped another 30 lines (2,837 → 2,807). Verified
  by `smoke-content-api-route.js` (7 checks) — seeded with REAL pages, a
  REAL published+tagged article, and REAL saved revisions (two saves →
  real history), then exercising the list/search/status-filter, the
  article cube, and a genuine revision restore + the foreign-id 400. A
  test-seed bug (set the article tag via `meta.tags`; `listArticles`
  reads the top-level `tags` page field, set by `updatePage({tags})`)
  was caught and fixed before the suite shipped.

- **`src/routes/inbox.js`** (v1.22) — the seventeenth route-group
  extraction, and the largest single-page one this session (~246 lines):
  the forms-inbox / lead-pipeline CRM surface. The inbox page itself (leads
  as an expandable list, the pipeline summary tiles — open value / won
  value / due-today count, the `?status=` stage filter), its CSV export,
  and every lead mutation — read/delete plus the CRM fields
  status/notes/value/follow-up (v1.00 + v1.12) — moved as one router.
  Squarely the "advanced CRM pipeline" concern the North Star names.
  Every handler already used `require('./forms')` locally; only the
  `admin-ui`/`http-util` display helpers are imported at the top of the
  new module. To move ~246 lines of hand-written HTML+JS faithfully, the
  block was extracted programmatically (slice the exact line range,
  rewrite `app.get/post` → `router.get/post` and `./forms` → `../forms`)
  rather than retyped — no transcription drift. `server.js` dropped 246
  lines (2,807 → 2,561), the biggest single-cut drop of the session and
  under 2,600 for the first time — a 51% reduction from the session-start
  ~5,252. Verified by `smoke-inbox-route.js` (13 checks) — two real seeded
  leads, then the page render with the summary tiles, the CSV export, and
  EVERY mutation round-tripped through the mounted router with persistence
  confirmed on a fresh re-render (a saved ₪5,000 value showing in the
  open-pipeline tile), plus the `?status=` filter and the reject paths
  (non-numeric value, malformed date → clean `{ok:false}`). The existing
  `smoke-forms-inbox.js` tests the `forms` MODULE directly, not the
  routes, so it needed no change — this is genuinely new HTTP-level
  coverage for the CRM surface.

- **`src/routes/settings.js`** (v1.23) — the eighteenth route-group
  extraction: the site-settings page (name / description / homepage /
  baseUrl / language) + its save API, AND the whole-site package
  export/import — the ".pzn is our RPM" pillar one level up from theme
  packages (v0.99), a portable versioned file bundling every page
  (draft + published), the theme, and the menus. Every route is
  `requireAdmin`, since import creates/overwrites pages and site config —
  the strongest reason to keep this group intact and gated. Extracted
  programmatically (same slice-and-rewrite approach as the inbox) to move
  the ~140-line settings page HTML faithfully. `server.js` dropped 139
  lines (2,561 → 2,422). Verified by `smoke-settings-route.js` (11 checks)
  — the `requireAdmin` gate 403s an editor on both the page and every API
  (settings save AND site-package export), a real settings round-trip
  persisting on a fresh render, the homepage-must-exist guard (400 on a
  missing page), and a genuine whole-site export → import CYCLE proving
  the collision policy: re-importing the same package skips existing pages
  by default (no clobber), `overwrite:true` updates them instead, and a
  wrong-format package is rejected 400.

- **`src/routes/dashboard.js`** (v1.24) — the nineteenth route-group
  extraction: the admin dashboard landing hub (stat cards, the tool-family
  grid derived from `ADMIN_NAV_GROUPS`, recent pages, quick actions) plus
  the `/admin/build-redirect` shortcut the dashboard's "build the site"
  button posts to — they belong together, so they moved together. One
  design note worth recording: `needsSetup()` (a 3-line server.js-local
  guard — `!loadConfig().setupDone && no pages`) is used by the dashboard
  AND by three other routes still in `server.js` (the setup screens, the
  admin index). Rather than create a shared module for a trivial
  three-liner OR reach back into `server.js`, its one-liner is inlined in
  the dashboard module with a comment — the pragmatic call; if a third
  consumer outside `server.js` ever needs it, THAT is when it earns its own
  module. `server.js` dropped 123 lines (2,422 → 2,299). Verified by
  `smoke-dashboard-route.js` (9 checks) — the hub renders real seeded
  counts + the tool grid + recent pages with edit links, the unread-inbox
  card links to the inbox, and `/admin/build-redirect` genuinely REBUILDS
  (a published page appears as static HTML on disk afterward, checked by
  fetching `/pub.html`) then redirects back to the dashboard.

- **`src/routes/homepage.js`** (v1.25) — the twentieth route-group
  extraction: homepage crowning (v0.78) — set which published page is
  served at `/`. Two doors onto one `setHomepage()` helper that moved with
  them (used nowhere else): `POST /admin/homepage` (form → redirect, from
  the pages screen) and `POST /admin/api/homepage` (JSON, the builder's
  publish-flow toast). The business rule that makes this its own concern:
  only a PUBLISHED page can be crowned, and the site is rebuilt on the spot
  so `/` is live immediately (the "publish MEANS live" contract from v0.69).
  The pages-screen's HTML form still POSTs to `/admin/homepage` — that's a
  reference to the now-mounted route, not a leftage. `server.js` dropped 33
  lines (2,299 → 2,266). Verified by `smoke-homepage-route.js` (6 checks) —
  BOTH doors (JSON crowning returns the homepage; the form door redirects),
  the on-the-spot rebuild proven by fetching `/` and finding the crowned
  page's content, and the "published only" guard on both doors (a draft
  page → JSON 400 / form 400-error-page, not a silent crowning).

- **`src/routes/sitemap.js`** (v1.26) — a consolidation rather than a fresh
  cut: the JSON twin `GET /admin/api/sitemap` had stayed inline in
  `server.js` when the sitemap PAGE was extracted back in v1.03, so the two
  halves of one feature lived in two files. Moving the ~7-line JSON route
  into `routes/sitemap.js` reunites them — same `buildSitemap()` data,
  same module, one place to edit the sitemap surface. A reminder that the
  goal isn't just "shrink server.js" but "each feature in one coherent
  home": some cuts create a module, some finish one. `server.js` dropped 9
  lines (2,266 → 2,257). Verified by EXTENDING the existing
  `smoke-sitemap-route.js` (now 10 checks, +3) rather than adding a new
  test file — the JSON twin returns the real menus+orphans structure and
  is behind auth, checked through the same mounted router as its page.
  No new `package.json` test entry needed: it's the same suite entry,
  now covering both halves.

- **`src/routes/seo-files.js`** (v1.27) — the twenty-first route-group
  extraction, and the first PUBLIC (non-admin) one: `/sitemap.xml` and
  `/robots.txt`, derived live from published pages (v0.71), plus the
  `siteBaseUrl(req)` helper they share (used nowhere else). What makes this
  cut different from the admin-page moves: **registration ORDER is
  load-bearing.** These routes must answer BEFORE the `express.static`
  mounts, or a static file of the same name would shadow them — so the
  mount sits at the exact same pre-static line the inline routes held, the
  same "only the logic moves, never the registration point" discipline the
  v1.11 auth-gate cut established. `server.js` dropped 19 lines
  (2,257 → 2,238). Verified by `smoke-seo-files-route.js` (7 checks) —
  genuinely new HTTP-level coverage (the prior `smoke-seo` tests the
  `src/seo.js` builders directly, never over the wire): both files served
  200 without auth with the right content-types, the sitemap carrying a
  real published page at the configured absolute baseUrl, robots pointing
  at the sitemap and disallowing `/admin`, and — the check that proves the
  ordering held — planting a real `public/robots.txt` on disk and
  confirming the LIVE ROUTE still wins (the static file does not shadow it).

- **`src/routes/form-capture.js`** (v1.28) — the twenty-second route-group
  extraction, second public cut: the FORM module's default action
  (`POST /api/form` → forms inbox, v0.81) and its RTL thank-you page
  (`GET /form-sent`). The per-IP `formLimiter` (a `FixedWindowLimiter`,
  `TAPUZ_FORM_MAX`-configurable, used nowhere else) moved WITH the routes,
  so this was a NON-contiguous extraction — limiter def near the top of
  `server.js`, routes 90 lines below — done as two splices plus a rebuild,
  not one slice. Ordering is load-bearing again: the mount sits AFTER the
  global urlencoded body-parser (so the POST body is parsed) and BEFORE the
  static mounts, exactly where the inline routes were. `server.js` dropped
  63 lines (2,238 → 2,175). Verified by `smoke-form-capture-route.js` (9
  checks) — genuinely new HTTP-level coverage (prior form tests exercise
  `forms.saveSubmission` at the module level, never the endpoint): a real
  submission persists with `_`-key stripping and explicit-`_page`
  attribution, the honeypot returns ok:true while storing NOTHING, missing
  `_page` falls back to the Referer path, an HTML post redirects to
  `/form-sent` while an `Accept: json` one gets `{ok,id}`, and the moved
  `formLimiter` still trips 429 after its per-minute cap. **A test-writing
  bug taught a real middleware-chain fact:** the first draft sent JSON
  request bodies, which failed — because `/api/form` is mounted before the
  JSON body-parser, so it only ever parses URLENCODED bodies (a real form
  post); `Accept: application/json` selects the RESPONSE shape, not the
  request encoding. Fixed to send urlencoded forms, and documented the
  reason inline so the next reader doesn't repeat it.

- **`src/routes/auth-screens.js`** (v1.29) — the twenty-third route-group
  extraction, security-relevant: the entire login / logout / first-admin
  create-account surface, its page-shell helpers (`authCard` / `authErr` /
  `authInput`), AND the escalating brute-force `loginGuard` (a `LoginGuard`
  from `../ratelimit`, used nowhere else). Non-contiguous again — the guard
  lived near the top of `server.js`, the routes far below — done as two
  splices plus a rebuild. Mounted AFTER the admin gate (which path-exempts
  `/admin/login` and `/admin/create-account` so they stay reachable without
  a session; logout is NOT exempt and stays gated), at the same position the
  inline routes held. `LoginGuard` was then dead in `server.js`'s top import
  and trimmed. `server.js` dropped 163 lines (2,238-ish → 2,075), under
  2,100 for the first time. **This cut is the strongest case yet for
  HTTP-level route tests over source-asserts.** New `smoke-auth-screens-route`
  (9 checks) drove the whole flow — first-admin bootstrap, wrong-password
  redirect, real login, logout, and the lockout — and the lockout check went
  RED with a 500. The cause: `authErr()` calls `escapeAdmin(msg)`, but
  `escapeAdmin` wasn't in the module's imports. Every happy path dodged it
  (`authErr('')` short-circuits before `escapeAdmin`), so a syntax check and
  the login-page render both passed — but EVERY error-message render (the
  `?err=1` wrong-password page, create-account errors, the lockout page)
  would have thrown a 500 in production. A module-level or source-assert
  test never touches that branch; only exercising the locked path over real
  HTTP surfaced it. Fixed by importing `escapeAdmin`, re-verified 429. Also
  fixed the pre-existing `smoke-palette.js`, whose source-assert counting the
  three `authCard(..., { bare: true })` calls in `server.js` correctly went
  red when they moved — repointed at `auth-screens.js` (the same
  stale-source-assert fix as v1.20's symbols cut).

- **`src/routes/setup-wizard.js`** (v1.30) — the twenty-fourth route-group
  extraction: the first-run onboarding wizard (`GET /admin/setup`, the
  four-step name → colors → pages → menu flow) + its `POST` that runs
  `src/setup.js` and builds the site skeleton. This cut came WITH a
  duplication cleanup worth doing first: `needsSetup()` was a server.js-local
  helper AND (since v1.24) an inline copy in `dashboard.js` — three call
  sites heading toward a fourth. Rather than add a third copy, it was
  **promoted to `src/setup.js`** (the single source of truth, sitting next
  to `runSetup` — the state it guards), and `server.js` + `dashboard.js`
  now import it; dashboard's now-dead `loadConfig` import was trimmed too.
  Then the wizard moved out, and `runSetup` + `LOOKS` — dead in `server.js`
  once the wizard left — were trimmed from its top imports. `server.js`
  dropped 259 lines (2,075 → 1,816), UNDER 1,900 for the first time — a
  65% reduction from the session-start ~5,252. Verified by the promotion
  passing the full suite as its own checkpoint BEFORE the extraction (a
  3-file change gets its own green gate), then `smoke-setup-wizard-route.js`
  (8 checks) — genuinely new HTTP coverage (prior `smoke-wizard` tests the
  `runSetup` ENGINE at the module level, never the routes): the wizard
  renders on a pristine install with the shared LOOKS fed as `WIZ_LOOKS`,
  `/admin` bounces to it while setup is pending, the POST builds real pages,
  and — the guard's whole point — after setup both routes flip (GET
  redirects to `/admin`, POST returns 409, no double-run).

- **`src/routes/pages-builder.js`** (v1.31) — the twenty-fifth route-group
  extraction and the LARGEST single cut of the session (~477 lines): the
  site-builder surface itself — `/admin/new` (template picker) + create,
  delete, server-side `/admin/preview`, the visual builder page
  (`/admin/edit`), and the save/publish/build lifecycle. Every dependency
  is a clean module import (the page store, the BenTML engine, the block
  registry, the renderer, the admin-ui shell), so nothing reached back into
  `server.js`; `bentml`/`blockRegistry`/the page functions all stay top-level
  imports there too, since the still-inline bentml + registry routes use
  them. `server.js` dropped 473 lines (1,816 → 1,343) — a **74% reduction**
  from the session-start ~5,252. Because the builder PAGE moved, FOUR
  pre-existing tests with source-asserts against `server.js` for builder
  markup (`smoke-layers`, `smoke-responsive`, `smoke-symbols`,
  `smoke-templates`) correctly went red and were repointed at
  `pages-builder.js` — the routine consequence of moving a page that
  several tests assert on, the same stale-source-assert fix as v1.20/v1.29.
  New `smoke-pages-builder-route.js` (12 checks) drives the FULL lifecycle
  over real HTTP: new → create (→ editor redirect) → the builder renders →
  save a draft → preview shows the draft with SAMEORIGIN framing → publish
  → the page is served as static HTML with the real content → build
  regenerates → delete. A test-fixture bug taught the block contract
  (heading renders `data.text`, not `html`) and the save contract (`title`
  is a NOT NULL column the builder always sends — omitting it 400s at the
  DB layer, pre-existing behavior, not a regression); both fixed and
  documented inline.

- **`src/routes/admin-home.js`** (v1.32) — the twenty-sixth route-group
  extraction: `GET /admin`, the pages-list landing (also the post-build
  "your site is live" screen and the v0.78 homepage-status banner — who
  owns `/`, or the warning when nobody does). Redirects to the setup wizard
  on a pristine install via the shared `needsSetup()`. With this and the
  wizard (v1.30) both out, `needsSetup` had NO remaining caller in
  `server.js`, so its import was trimmed there too — the promotion to
  `src/setup.js` in v1.30 has now fully paid off (server.js neither defines
  nor imports it). `server.js` dropped 88 lines (1,343 → 1,256), under
  1,300 for the first time. Verified by `smoke-admin-home-route.js` (6
  checks) across the states the page reasons about: the pristine-install
  redirect to setup (exercising the shared guard end-to-end), the normal
  pages list with edit links, both status banners (`?built=1` "site is
  live", `?homeset=1` homepage-updated), and that an unauthenticated
  request never renders the list.

- **`src/routes/agent-bridge.js`** (v1.33) — the twenty-seventh route-group
  extraction and the most intricate surgery of the session: the whole
  public `/agent/v1` API ("agents are users too" — the North Star pillar),
  15 bearer-token read/write endpoints an AI or the extension uses to read
  the site vocabulary and author pages, PLUS the three things they all
  share that lived scattered across `server.js` — the CORS/preflight
  middleware, the per-IP `agentLimiter`, and the `requireAgent(scope)`
  guard. A genuinely non-contiguous cut: helpers at the top of the file,
  routes 200 lines below, and the PUBLIC `/pzn-schema.json` sitting IN THE
  MIDDLE of the route run. That public schema endpoint is unauthenticated
  and not agent-scoped, so it stayed in `server.js` (relocated to just
  above the mount) — it never belonged in an "agent bridge." Two footguns
  handled deliberately: `require('../package.json')` became
  `require('../../package.json')` (the file moved a directory deeper), and
  the `/agent` JSON body-parser stayed in `server.js` mounted BEFORE the
  router (order is load-bearing — the router's POST handlers need a parsed
  body). `agentTokens`, used only by the `requireAgent` guard that moved,
  was then dead in `server.js` and trimmed. `server.js` dropped 267 lines
  (1,256 → 989), UNDER 1,000 for the first time — an 81% reduction from the
  session-start ~5,252. Verified by the PRE-EXISTING `smoke-agent-bridge`
  (the comprehensive HTTP-level suite for this surface — real bearer auth,
  scope enforcement, every endpoint, path-traversal rejection, CORS, the
  oversized-body 413): all green, no new test needed because the surface
  was already thoroughly covered end-to-end. The full suite passed too, so
  moving the CORS/preflight middleware later in the chain (now inside the
  mounted router) changed nothing observable.

- **`src/routes/bentml-api.js`** (v1.34) — the twenty-eighth route-group
  extraction: the BenTML language API — the doc/primer endpoints (primer,
  chat-snippet, agent-pack) and the language OPERATIONS the advanced code
  tab runs (compile / preview / decompile / apply, BenTML source ⟷ builder
  blocks). The ".pzn / BenTML is our RPM" surface, directly on-theme.
  DELIBERATELY EXCLUDED: the two `/admin/api/syntax-dictionary` routes that
  sit between `modules` and `primer` in `server.js` — they're entangled in
  the v1.19 shadowed-route bug awaiting a product decision, so they (and the
  small `bentml-engine.js` + `modules` routes around them) stay inline,
  untouched. (That decision landed later — see "A latent bug found while
  scoping the BYOK/AI cluster" below; one registration survives now.) Extracting only the contiguous primer→apply run keeps the
  flagged decision fully deferred rather than forcing it. A `__dirname`
  footgun handled deliberately: primer/chat-snippet read files via
  `path.join(__dirname, '..', 'docs'|'public', …)` — moving the file from
  `src/` to `src/routes/` needed one more `'..'`, verified by probing both
  endpoints and confirming they return the real 6.6KB cheatsheet + snippet,
  not the tiny fallback a wrong path would yield. `looksLikePzn`/
  `pznSourceToBlocks`, used only by the compile route that moved, were then
  dead in `server.js` and trimmed. `server.js` dropped 165 lines (989 →
  824) — an **84% reduction** from the session-start ~5,252. Verified by
  the pre-existing `smoke-bentml`/`smoke-bentml-engine`/`smoke-decompile`
  suites (which cover this surface) plus a direct probe of the file-reading
  endpoints for the `__dirname` fix.

- **`src/routes/ai-paste.js`** (v1.35) — the twenty-ninth route-group
  extraction: the two BYO-AI paste-flow pages (`GET /admin/ai`, the keyless
  "teach your own AI subscription the .pzn syntax then paste its reply
  back" flow, and `GET /admin/inject`, the copy-the-pack screen). The
  North Star's "your AI subscription, not our tokens" ace, rendered as two
  cohesive onboarding pages off the admin-ui shell (no state, no secrets;
  only `layout`/`adminNav`/`accentFor`). This is a DELIBERATELY SCOPED cut
  of the larger BYOK/AI cluster: the cluster is wedged around two things
  that must stay in `server.js` — the `require('./routes/import')` MOUNT
  (which sits between `/admin/agent` and `/admin/ai`) and the two shadowed
  `/admin/api/syntax-dictionary` routes — so rather than force a fragmented
  extraction around both, only the clean CONTIGUOUS chunk between them was
  taken. The rest of the copilot cluster (`/admin/agent`, `/admin/chat`,
  the ai/settings + ai/chat + inject-pack APIs) stays put for now, still
  gated behind the v1.19 decision on the wedged syntax-dictionary (since
resolved — see below, so this cluster is now unblocked). `server.js`
  dropped 120 lines (824 → 704), UNDER 750 for the first time — an 87%
  reduction from the session-start ~5,252. Verified by
  `smoke-ai-paste-route.js` (4 checks) — genuinely new route coverage (no
  prior test hit these two screens): both render behind the admin gate with
  their client scripts (`admin-ai.js`/`admin-inject.js`) and mount points,
  and neither is reachable unauthenticated. A wrong marker id in the first
  draft (`copy-primer`, which is actually in a different page) was caught
  and fixed against the real rendered ids.

## Beyond extraction: keeping the `.pzn` standard honest (v1.36)

With route extraction at its clean limit (what remains inline is the
middleware chain plus the BYOK/AI cluster that's blocked on the v1.19
decision), v1.36 pivoted to a different, non-blocked correctness concern
the North Star names directly — the `.pzn`/RPM standard. The published
`docs/pzn-schema.json` (generated from the module registry by
`scripts/gen-pzn-spec.js`, and served live at `GET /pzn-schema.json`) had
silently gone STALE: it was stamped `tapuziel@0.66.0-alpha` and missing 7
modules the registry had gained. A published standard that drifts from the
code isn't a standard, so it was regenerated (all 56 modules) and a
guardrail added — `scripts/smoke-pzn-spec.js` fails the build if the
committed schema ever falls out of sync with `buildCatalog()` again. The
same "the code is the single source of truth, and a test proves the
generated artifact matches it" discipline the smoke suite already applies
to the registry, now applied to the public standard.

v1.37 finished the audit that fix implied: of Tapuziel's four `gen:`
scripts, the human syntax reference `docs/SYNTAX-DICTIONARY.md` (from
block-registry via `gen:dictionary`) was ALSO ~9% stale and was
regenerated + folded into the same `smoke-pzn-spec` guard. The
`public/chat-snippet.*` artifacts were within a cosmetic newline of their
source (left alone). All generated-standard artifacts are now both current
and drift-guarded — "our RPM" no longer silently lies to an implementer.

v1.38 took the "does the code match the standard?" lens one step further —
from *documentation* drift to *behavioral* drift. `docs/pzn-spec.md` rule 9
promises link props reject `javascript:`/`data:`/`vbscript:`; testing the
actual `safeHref` guard against bypass vectors found a real XSS hole — it
only trimmed whitespace, so `\x01javascript:` (leading control char) and
`java\tscript:` (control smuggled into the scheme) executed. Fixed by
normalizing control chars the way a browser does before the scheme check,
and locked in with a `safeHref` unit-test suite in `test/pzn/escape.test.js`
(which CI runs). The lesson generalizes: a written standard is only as good
as the test that proves the code enforces it — the same drift-guard
discipline, now applied to a security invariant rather than a generated doc.

## A latent bug found while scoping the BYOK/AI cluster (v1.19)

While mapping the last big cluster, a genuine shadowed-route bug surfaced
and was flagged (not silently "fixed," since it's a product call): both
`/admin/api/syntax-dictionary` and its `.md` variant are registered TWICE
in `server.js` — once against the older `src/syntax-dictionary.js` (built
from `block-registry.js` + `bentml/keywords.js`, 39 block-vocabulary
modules), and again against the newer `src/pzn/syntax-dictionary.js`
(richer, also returns `tools` = agent tool defs). Express matches the
first, so the second pair is dead code.

**Precise impact (traced in v1.43, to de-risk the decision).** The
consumer is `public/admin-inject.js`, and its use of the shadow is
NARROWER than "the inject page gets the wrong dictionary" first implied:
- Its tool list + module count come from `cache = api('/admin/api/inject-pack')`,
  which uses the NEWER `pzn/syntax-dictionary` DIRECTLY — unaffected by the
  shadow, already correct.
- The ONLY thing the shadowed route feeds is the `btn-dict` "copy dictionary"
  button (`api('/admin/api/syntax-dictionary.md')` → clipboard): today it
  copies the older block-registry markdown (≈15.4KB, 39 modules) instead of
  the newer pzn markdown (≈19.9KB). BOTH are valid, current, drift-guarded
  dictionaries (v1.36–37) — they describe the vocabulary from different
  angles (block-builder tags vs pzn+agent-tools), so which better serves a
  human pasting into a chat is a genuine DESIGN call, not a correctness bug.

So: the duplicate registration is objectively wrong code, but the two safe
resolutions differ only in one button's clipboard payload — (a) delete the
dead second registration (keeps today's behavior: older markdown copied),
or (b) swap the surviving route's `require` to the newer dictionary (richer
markdown copied).

**Resolved (option b).** The older block-registry pair was deleted; the pzn
pair — the dictionary `inject-pack`, `agent-bridge` and `agent-roleplay`
already use — is now the single registration, so `/admin/inject`'s "copy
dictionary" button hands over the same vocabulary as the tool list rendered
beside it (≈19.9KB, with agent tool defs) instead of a second, differently-
angled one. `src/syntax-dictionary.js` is untouched and still generates
`docs/SYNTAX-DICTIONARY.md` via `npm run gen:dictionary` (guarded by
`smoke-pzn-spec`); it simply is no longer an HTTP surface. To stop the
shadow re-forming silently, `smoke-ai-paste-route.js` now PINS which
dictionary answers the endpoint — asserting the `.md` body equals the pzn
`toMarkdown()` and the JSON carries `tools[]` — so a re-added registration
that wins by first-match fails the build rather than quietly downgrading the
pack. (That test's HTTP helper also gained `res.setEncoding('utf8')`: the
Hebrew bodies it compares can otherwise be corrupted by a chunk boundary
splitting a multi-byte character.) With the wedge gone, the BYOK/AI cluster
noted in v1.19/v1.34/v1.35 as "blocked on this decision" is now extractable.

- **`src/routes/copilot.js`** (v1.47) — the thirtieth and FINAL route-group
  extraction: the AI copilot surface, taken as the considered group this
  document called for rather than a page at a time. Four sibling admin
  screens off one shared concern (how a user's AI reaches this CMS) plus the
  APIs their client scripts call — `/admin/agent`, `/admin/ai`,
  `/admin/inject`, `/admin/chat`, `inject-pack`, `syntax-dictionary[.md]`,
  `ai/settings` (GET+POST), `ai/chat`. Both AI tiers deliberately live in one
  module: BYOT/keyless (copy the pack into your own chat) and BYOK/key-in-the-
  CMS are one product decision seen from two sides, and the old split hid
  that. Done as a `git mv` of v1.35's `ai-paste.js` — which already held two
  of the four pages — so the large Hebrew HTML blocks moved byte-for-byte
  rather than being retyped. This group was only movable because v1.37
  resolved the shadowed-dictionary bug two of its routes were entangled in;
  the blocker named in v1.19/v1.34/v1.35 was real, and clearing it was what
  unlocked the finish. `server.js` dropped 690 → **508 lines** (a **90%**
  reduction from the session-start ~5,252), and with the last admin renderer
  gone it no longer imports `admin-ui` or `admin-guard` at all — it renders no
  admin HTML of its own. Verified by `smoke-copilot-route.js`, grown from 4
  checks to 14: all four screens render with their client scripts and mount
  points, all four (plus the AI settings API) are unreachable
  unauthenticated, `inject-pack` answers in both JSON and roleplay-markdown
  form, the dictionary pin from v1.37 still holds, and `ai/settings` never
  echoes the stored `apiKey` back to the browser. Route count held at 146
  across 33 files — nothing lost or duplicated in the move.

## What's next (candidates, not yet done)

Twenty-nine route-group extractions (including one consolidation in v1.26,
two public-route cuts in v1.27–v1.28, the needsSetup promotion in v1.30,
the marquee site-builder surface in v1.31, the admin home in v1.32, the
public /agent bridge in v1.33, the BenTML language API in v1.34, and the
BYO-AI paste-flow pages in v1.35), the auth/CSRF gate, and the pzn/builder
API surface split (stateless in v1.13, page-mutating in v1.14) are done.
`server.js` is down to **508 lines** from a session-start ~5,252 — a **90%**
reduction — and the copilot cluster that was the last named blocker went in
v1.47. **Route extraction is done.** What remains inline is the middleware
chain (app assembly — legitimately stays) plus five strays that belong near
it: `/_tapuz/collect`, `/pzn-schema.json`, `/admin/api/registry`,
`/admin/bentml-engine.js`, `/admin/api/bentml/modules`. Pulling those would
be motion, not progress.

The honest next candidates are no longer architectural:
- **Product QA on the builder** — the flows Ben's sister actually hits.
- **AI tier realignment** — now that both tiers sit in one module, what BYOT
  (keyless, media by reference) vs BYOK (key, can create media) may each do
  is a design question with the code finally in one place to answer it.
