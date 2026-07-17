# BenTML status — the language is real and it dances

## v0.77 (2026-07-17) — BenTML runs in the browser, covers everything, syncs both ways

| Layer | Status |
|-------|--------|
| **Spec** `docs/bentml-v0.md` + cheatsheet | ✅ Source of truth; cheatsheet carries the "SINCE 0.2" vocabulary block |
| **Compiler in `src/bentml/`** | ✅ compile + decompile, **all 35 registry types both ways** |
| **Engine in the browser** | ✅ `/admin/bentml-engine.js` — the real compiler bundled (no build step, mtime-fresh), `window.BentmlEngine` |
| **Builder ⇄ source dance** | ✅ two-way live: drag → code rewrites (~0ms, local); type → compiles → applies to the canvas; click a block ⇄ its lines light up |
| **Source map** | ✅ `decompile(page, blocks, { withMap: true })` → `{ source, map }` with 1-based line ranges per top-level block; nested blocks named by `id:` params |
| **Editor** | ✅ highlighted (textarea + painted layer, dark-desk palette), error line + fix, Tab/Ctrl+Enter, undo integrated (one step per typing burst) |
| **QA gate** | ✅ `scripts/smoke-bentml-engine.js` (in `test:smoke`): bare-context bundle, browser≡server parity, map truth, full-vocabulary round-trip |

### What v0.77 closed

1. **compile silently dropped 10 types** (section/tabs/accordion/form/cards/nav/
   ticker/newspop/video/category → W405 → null). With live-apply that would have
   ERASED blocks. All 10 now have keywords with typed children:
   `TAB(label){}`, `FOLD(title){}`, `FIELD(...)`, `MEDIACARD(title){excerpt}`,
   `NAVITEM(url){label}`, `TICKERITEM(url){text}`, `NEWSPOPITEM(time,url){text}`.
2. **Chrome params were dropped by most compile cases** — `id:`/`class:`/
   `color:`/`background:`/`fontsize:`/`padding:`/`radius:` now `applyChrome` on
   every keyword, so styling survives a source round-trip.
3. **Nested identity**: decompile emits `id:` for every nested block (storage id
   or authored anchor); the builder resolves either — the selection dance works
   for imported `.pzn` ids like `h-v21` too.
4. **`data.style` crossed the pzn bridge as nothing** — now flat `style-*`
   attributes (`style-radius="sm"`), fixing the נסיון round-trip failure.
5. **Registry alignment**: the 7 upgraded containers are `bodyClass: 'blocks'`
   in `src/block-registry.js` (smoke-registry enforces keyword↔registry parity).

### The loop as-built

```
builder canvas ──(every change, ~90ms debounce)──▶ BentmlEngine.decompile
                                                        │ withMap
      ▲                                                 ▼
      │                                    highlighted source (dock + full-screen)
      │                                                 │ typing (350ms idle)
canvas blocks ◀──(_setBlocks keepSelection)── BentmlEngine.compile ── errors → exact line + fix
```

- Selection: canvas block → `BentmlUI.onBlockSelect(id)` → lines glow; caret in
  source → deepest scanned block → `TapuzBuilder._selectBlock(id, {fromSource})`.
- Fallback: no engine (route failed) → the old `/admin/api/bentml/*` fetch path.

## How to test

```bash
cd D:\Dev\Tapuz
node scripts/smoke-bentml-engine.js   # the v0.77 gate
node scripts/smoke-bentml.js
node scripts/smoke-decompile.js
npm run test:smoke                    # everything
```

In the builder: toggle ⚙ מתקדם → the BenTML dock appears under the canvas.
Drag a block — code rewrites. Click a block — lines light. Edit the code —
the page follows; break it — the exact line burns red with the fix.

## Next

- HERO children still compile without ids (synthesized) — selection falls back
  to the HERO range; fine until heroes get real children.
- Inline runs (`@B{}`) round-trip as text, not structured runs, in the builder
  path (spec §8.4 structured runs are the compiler's next depth).
- grokTapuziel `<bent-*>` dialect stays the storage format (`.pzn`); the keyword
  language is the human/AI authoring surface. One vocabulary, two skins.
