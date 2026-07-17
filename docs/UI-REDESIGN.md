# v0.75 — the UI redesign

The builder was functional and dead. Every screen since v0.5 was styled ad-hoc:
~1,300 lines of CSS inline in `server.js`, hardcoded hexes, two media queries in
the whole admin, no motion, undo hidden in a 2px button. This version rebuilds
the design as a system. Design language inspired by the grokTapuziel lab —
rebuilt into our code, never copied.

## The seven workstreams

| # | What | Where |
|---|------|-------|
| A | **Design system** — tokens (workspace light + builder dark-desk palettes, radius/motion/shadow scales), motion vocabulary (drop-wobble, rise-in, pulse-ring), all admin CSS extracted to `public/css/admin.css`. The builder is a dark desk around the live white page — the content being built is the brightest thing on screen. | `public/css/admin.css`, `layout()` in `server.js` |
| B | **Responsive builder** — ≤1100px the settings panel becomes a direction-aware slide-over drawer; ≤760px the toolbox becomes a bottom sheet collapsed to a handle. The canvas always wins. | `admin.css` responsive layer, drawer hooks in `admin-builder.js` |
| C | **Drag & drop feel** — edge auto-scroll (the page follows the drag), landing wobble, Escape aborts (native, cleanup verified). Native DnD kept — the drop logic (slots, split zones, rollback) was battle-tested. | `admin-builder.js` |
| D | **Visible cancel** — undo/redo labeled in the topbar; destructive ops raise a toast with an inline ↩ בטל button; Escape closes drawers, then clears selection. | `admin-builder.js` |
| E | **Toolbox folds** — categories are `<details>` folds closed by default (first open), tool-count pills, family accent colors aligned with the admin nav, search that cuts across; selecting a block unfolds its family. | `server.js` toolbox gen, `admin.css`, `admin-builder.js` |
| F | **Container-as-tool** — SECTION graduated from RESERVED. The מיכל block: a container that is legitimate empty, publishes as sized blank space (sm–xl), gets filled in a future release. **Delete = soft erase**: the tool goes, the shape stays (an empty מיכל holds the spot); deleting the empty מיכל removes it. | 8 layers: pzn registry, keywords, bridge, renderer, block-registry, blocks, builder, theme CSS |
| G | **Menu manager v2** — menus are named entities (create/rename/delete); main/footer are *locations* that get a menu assigned (`menu_locations`, `getMenuForLocation`); nesting UI (indent/outdent/sub-item) feeding the `<ul class="sub-menu">` rendering the site already had. | `src/menus.js`, `admin-menus.js`, routes |

## Design tokens (the short version)

- Workspace (light): `--ws-*` — the v0.74 vibrant admin with section accents, kept.
- Builder chrome (dark): `--bc-*` — `#0b1020` desk, `#121a2e` panels, `#2a3a5c` borders.
- Accents: `--accent` = the section's `--admin-accent` (tangerine on the builder);
  `--select` = content-neutral blue for selection/drop targets; publish stays green.
- Motion: `--dur` .16s / `--dur-slow` .3s / `--pop` overshoot bezier. Everything
  respects `prefers-reduced-motion`.

## Deliberately out of scope (next up)

- **Homepage creation flow** — broken in both Tapuz and the lab; the stated
  blocker for QA. Own workstream.
- **AI tier realignment** — key-based AI chat belongs in the CMS (level-1 users
  with a provider key); the extension is the keyless level-2 path. v0.73 put the
  key in the extension; needs rework as its own phase.
- Builder toolbox drag on touch devices (native DnD limitation; pointer-events
  rewrite only if real usage demands it).
