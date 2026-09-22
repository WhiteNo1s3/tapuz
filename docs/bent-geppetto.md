# Geppetto — a Canva or Figma site, swallowed whole and given a life (v2.56)

Ben's ask: *"we need to get canva sites and make them our own in BenTML, they have a way of making "sites" we should be able to swallow it whole with no salt … the users using this shit canva to create a living breathing site (with more feature than required, overengineered over the top we are proud of) … if I think on it we can handle figma? if so we should make them same PR — they are imported nonsense, we make a life in them, like pinocchio and jeppetto."*

A site built in **Canva** (Canva Websites, `*.my.canva.site` or the owner's domain) or in **Figma** (Figma Sites, `*.figma.site`, or a Figma design file) is a *design*: words and pictures placed at coordinates on a 1366- or 1440-pixel canvas. It looks like a site and behaves like a poster — nothing reflows on a phone, nothing is editable as a module, there is no menu, no SEO, and it lives on the tool's hosting. **Geppetto** reads that design and carves a Tapuziel site out of it: real BenTML pages made of real modules, a menu, a theme, the pictures in the site's own media library, the links alive — previewed before anything changes, landed with one click, undone with another.

**Where:** `/admin/geppetto` (also a card on `/admin/import`). Admin only.

## The doors

| Paste / upload | What is read | Needs |
|---|---|---|
| A published **Canva** site address | the page, **and every other page of the same site the design links to** (up to 12), and the names of the fonts the export uses | nothing |
| A published **Figma Sites** address | the site's bundle JSON (`/_json/<bundle>/_index.json`) and one JSON per other page of the site (`guidToUrl`) | nothing |
| A saved page (`Ctrl+S` of a Canva / Figma Sites page) | the same, from the file; with the original address beside it the linked pages and relative pictures come too | nothing |
| A **Figma design file** address (`figma.com/design/…`) | the Figma REST API (`GET /v1/files/:key`, `…/images`) | the owner's personal access token — used for that one request, never stored |
| The JSON exported by the **Figma plugin** (`integrations/figma-plugin`) | the frames the owner selected in Figma, pictures included | nothing (a development-mode plugin, no token) |

Canva publishes a site in two shapes, and both occur on the same live site: the older **app** export (an empty `<div id="root">` and the whole design as a JSON literal in `window['bootstrap']`) and the newer **static** export (server-rendered sections placed by a CSS grid per breakpoint). Figma Sites always publishes the bundle JSON — the same node schema as Figma's REST API, which is why one Figma decoder serves the Sites door, the file door and the plugin door. A **Figma Make** site is a React program, not a design: its code components are skipped with a note, and what is read is the text and pictures outside the code.

## The pipeline

```
fetch.js ─→ decoders ─→ the PUPPET ─→ life.js (Geppetto) ─→ look.js ─→ a PLAN ─→ preview ─→ land.js ─→ undo
            canva.js     puppet.js     rows, heroes,          the         (nothing     (the site    (records
            figma.js     boxes, runs,  buttons, cards,        theme)      changed)     changes)     every
            font-name.js pictures      menu, anchors                                                 change)
```

* **The puppet** (`src/geppetto/puppet.js`) is the one shape every decoder emits: pages → sections → nodes (text with styled runs, images, videos, shapes, lines, groups, auto-layout frames, embeds), coordinates absolute within the section, the source's own hints kept (role, layer name, alt text, entrance animation, the phone layout, links to a page or a section). A decoder never writes BenTML; Geppetto never reads Canva or Figma.
* **The life pass** (`src/geppetto/life.js`) reads the design's *intent* out of its geometry — below.
* **The look** (`src/geppetto/look.js`) writes the design's habits as a `<bent-theme>` document.
* **The plan** waits on disk (`config/geppetto/plans/`, 24 hours) until the owner lands it or walks away. The preview route renders a planned page with the plan's own theme and menu — exactly the page the live site would show.

## What becomes what

| In the design | In Tapuziel |
|---|---|
| a page of a Canva design / a top-level frame of a Figma page | a **SECTION** band, edge to edge (`width: full`), with the design's color |
| a photo under everything in a section | the section becomes a **BACKDROP** with that photo |
| a semi-transparent slab over that photo | the backdrop's **overlay** |
| the opening screen (one title, a line, a button, centered or on a photo) | a full-width **HERO** |
| boxes side by side | a **ROW** with the designer's own ratio (`45:55`), gap and vertical alignment |
| Figma auto-layout row / column / grid | read as written — row → ROW, column → the column's flow, grid → rows of the grid |
| a pill (or a group of shape + word, or Canva's text-in-a-shape) | a **BUTTON** wearing the pill's color, text color and radius |
| a picture + title + words, repeated in a row or a grid | **CARDS** |
| round portraits + a name + a role, repeated | **TEAM** |
| a big number + a label, repeated | **STATS** |
| small linked icons pointing at social profiles | **SOCIAL** |
| pictures only, in a row or a grid | **GALLERY** (small ones: **LOGOS**) |
| a colored panel with things on it | a **CARD** with the panel's color, radius and border |
| the words, by size | **one h1** per page, then h2/h3 by the design's own scale, body text with its size, small caps as a kicker, a bullet run as a **LIST** — an address, a phone or an email is never a title, a one-sentence promise at 1.2× is a lead paragraph |
| bold / italic / linked runs inside a text | BenTML inline marks (`@B{}`, `@I{}`, `@LINK(url: …){}`) |
| a video (Canva's clip, Figma's video fill) | **VIDEO** (autoplaying clips stay muted and looping) |
| an embed | **EMBED** |
| a long horizontal line | **DIVIDER** |
| Canva's and Figma's entrance animations | the module's `animate` (fade / rise / zoom) |
| a node the phone layout hides | `hideOn: mobile` |
| the row of links at the top of the home page | the site's **MENU** (removed from the page), its anchors named after the menu labels (`/#about`) |
| the name or logo beside that row | the **site's title** (and the home page's name and address) |
| links between the design's pages and to its sections (`#page-2`) | links between the new pages and their anchors |

What cannot live is dropped and **counted** in the report: an unlinked decorative icon smaller than ~60px, a rotated sticker, a stray shape, a vertical line. The owner sees what Geppetto chose.

## The look

`look.js` writes a `<bent-theme>` (see `docs/bent-theme.md`):

* **colors** — the page color is the fill with the most area (near-identical fills count as one), the words' color is what the text on it mostly wears, the accent comes from the button pills and colored titles first, and the quiet shades are derived;
* **fonts** — the titles' face and the body's face, answered with Google Fonts (`src/geppetto/fonts.js`): the same family when Google has it, the closest cousin when it does not (*Canva Sans* → DM Sans, *The Seasons* → Playfair Display, *Glacial Indifference* → Didact Gothic), a Hebrew-capable face for a Hebrew design. Canva's own font files are licensed to Canva and are never copied into the site; the static export only names a font by an opaque id, so its real family name is read from the font file's `name` table (`src/geppetto/font-name.js`, WOFF2/WOFF/TTF/OTF);
* **style** — pill / soft / square buttons from the design's buttons, flat shadows and solid accents (design tools draw flat);
* **layout** — the content column as wide as the design's content;
* **chrome** — the header in the menu band's color, the footer in the footer band's;
* **skin** — the design's title sizes, fluid (`clamp()` + `vw`), so a 96px Canva title is a big title here too, and still fits a phone.

The theme lands in the **theme library** (never straight on the site); landing live applies it through the library's own door, which backs the current look up first.

## Landing — and taking it back

**✨ "הכנס חיים" (live):** every page gets an address still free on this site (an existing page is never overwritten — the slug moves aside), the links are resolved against those final addresses, every picture and clip is downloaded into the media library (one folder per import, `/assets/geppetto/<site>-<id>/`, pictures as webp), the pages are written as BenTML through `savePageSource` and published, the theme is applied, the menu is backed up and replaced, the home page becomes the site's root and the brand its title, and the static export is rebuilt.

**"רק כטיוטות" (drafts):** the pages are written as drafts and the theme is filed in the library — the live look, the menu, the home page and the title are left alone, because a menu pointing at drafts would send visitors to 404s.

A landing runs as a **background job** the screen follows (a site with dozens of pictures and a few clips takes a while; a proxy would cut a request that long), one landing at a time — a second one waits for the first (`409 BUSY`).

Every landing leaves a record (`config/geppetto/imports.json`) — from the moment its pages are reserved (empty drafts wearing the import's stamp), before the slow part begins. A landing that fails half-way takes itself back (no orphan page, file, look or record); a landing cut off by a restart stays in the history as "נקטע", and its undo takes it back whole.

**Undo** takes back the import and nothing else:

* its pages go — found by their `meta.geppetto` stamp (a renamed page still carries it), and only while they are where and as the import left them: a page the owner edited or renamed since (even an unpublished draft save) is **kept**;
* its media folder goes — unless something on the site still shows a file from it (a kept page, a picture the owner copied into another page, the logo);
* the look goes back to the one before the import — a look changed since is first filed in the theme library ("ג׳פטו — המראה לפני ביטול …"), so no tuning is ever lost; the menu's knobs come back with the look (the menu snapshot is taken before the look changes);
* the menu goes back — the menu as it is goes to the menu backups first;
* the crown moves only off a page that is going away; the name goes back only if it is still the design's (an empty name comes back empty);
* **stacked imports:** undoing an older import under a newer one leaves the newer one's look, menu, crown and name on the site, and splices the older one out — the newer one's undo then brings back what the owner had before both, never a ghost of the older import; and when the owner changed the look, the menu, the crown or the name between the two imports, that is what the newer one's undo gives back.

## A new page-builder primitive: the stretch band

A design is a stack of color bands; a Tapuziel page lived inside a content column. **`SECTION`, `BACKDROP` and `HERO` now take `width: content | wide | full`** (Elementor's *stretch section*, the same breakout `ROW width` got in v2.26): the band runs edge to edge while its content keeps the site's column (`.sec-inner`), and full bands butt against the header and the footer. Both BenTML dialects, the `.pzn` bridge, the builder's settings form (from the registry), the renderer and the theme stylesheet carry it. Wiring it found an old drift: BACKDROP's `tint` and `fade` were registry params the bridge never carried — every save through the file dropped them. They cross now.

```
SECTION(width: full, background: "#2f3543", color: "#f4f4f4") { … }
BACKDROP(image: "/assets/geppetto/olive/bg.webp", overlay: 45, width: full) { … }
HERO(width: full, height: lg) { HEADING(level: 1) { … } }
```

## Security

* Reading makes this server fetch a stranger's site: every request goes through the decompiler's SSRF guard (public http(s) hosts only, re-checked on every redirect hop), is size-capped (6 MB of HTML, 16 MB of JSON, 2 MB per font, 8 MB per picture, 80 MB per clip) and timed out; the read route is rate-limited.
* A Figma token is used for the one request it came with and is never written anywhere.
* Every route is `requireAdmin`: landing rewrites the theme, the menu, the home page and the site's name.
* A design's text is untrusted: Geppetto never emits a raw-HTML block, every word goes through the renderer's escaping, a literal `@B{` in design text is defused, links pass a scheme gate that first strips control characters the way a browser does (`\x01javascript:` and `java⏎script:` run in a browser — they die here, in the plan, in the menu and in the renderer, which shares the PZN escaper's gate), colors reach a `style` attribute only as `#rrggbb`, and a gradient only as a plain `linear-/radial-gradient(…)` of colors and numbers.
* Pictures pass the media library's magic-byte gate (SVG sanitized as always); clips are saved only as MP4/WebM by their magic bytes.

## Honest limits

* A design past 20,000 boxes is refused with that reason (the biggest real site sampled had about 430) — the life pass runs in the request, and every pass in it is kept near-linear with a work budget.
* Overlap art that only works at 1366px (a word half over a photo, a collage) is reflowed, not reproduced — the page reads in the design's order, and the report names what was dropped.
* Canva's phone layout is read (order, hidden elements) but a Tapuziel row stacks in its desktop order.
* Fonts are substituted with their Google cousins, never copied.
* Figma Sites never publishes a clip's poster frame (the live site shows none either): a clip lands without a poster rather than with a broken one.
* Figma Make's code components are programs, not designs.
* Canva's forms and Figma's interactive components land as their visible parts (a form becomes its words) — build the form with the FORM module.

## Files

| Path | Role |
|---|---|
| `src/geppetto/puppet.js` | the contract every decoder emits + color/geometry/text helpers |
| `src/geppetto/canva.js` | Canva: the app blob and the static export → puppet |
| `src/geppetto/figma.js` | Figma: Sites bundle, REST file, plugin export → puppet |
| `src/geppetto/font-name.js` | a font file's family name (WOFF2/WOFF/TTF/OTF) |
| `src/geppetto/fetch.js` | the doors: guarded fetch, the crawl, the fonts, the Figma API |
| `src/geppetto/life.js` | Geppetto: XY-cut + auto-layout → modules, roles, patterns, menu, links |
| `src/geppetto/look.js`, `fonts.js` | the theme, the font map |
| `src/geppetto/land.js`, `index.js` | plans, preview, landing, records, undo |
| `src/routes/geppetto.js`, `public/admin-geppetto.js` | the screen and its API |
| `integrations/figma-plugin/` | the token-free Figma export (development-mode plugin) |
| `scripts/smoke-geppetto*.js` | the gates |

**QA:** `smoke-geppetto` (the life pass, the look, landing with a fake network and undo, the stretch band in both dialects, untrusted text), `smoke-geppetto-canva` and `smoke-geppetto-figma` (the decoders over synthetic fixtures), `smoke-geppetto-route` (the screen and its API end to end, the background landing job included, no network).
