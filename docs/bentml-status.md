# BenTML status — the language is real and it dances

## v2.20 (2026-09-08) — take only the BenTML, any time, anywhere

Ben's rule, now a law of the system: whatever a model wrapped around its page,
Tapuziel keeps **only the BenTML**. One extractor — `src/bentml/extract.js`,
dependency-free, bundled into the browser engine as `BentmlEngine.extract` —
runs first at every door, in front of both parsers and in front of the store.

| Door | What runs |
|------|-----------|
| Builder source panel (`admin-bentml-ui.js` → `compileText`) | `E.extract` → line dialect stays local, `.pzn` goes to the server; error lines mapped back via `lineOffset` |
| 🤖 ייבא מ‑AI modal, `/admin/ai` paste page | `POST /admin/api/pzn/to-blocks` · `preview` · `repair` · `source` · `create-from-source` — all extract, both dialects |
| Copilot chat "🪄 צור דף" + `create_page` / `edit_page` tools | `pzn-source.toPznSource` |
| Extension paste box, any agent | `/agent/v1/source`, `/agent/v1/create-from-source` |
| `/admin/new` import box | `pzn/decompile` sniffs the dialect first — a fenced or chatty reply is BenTML, a real page is HTML |
| CLI `tapuz bentml-compile` / `bentml-preview` | extract, then compile |
| **The store** — `pages.savePageSource` | extract + compile a keyword document to `.pzn`; a clean file passes byte-for-byte |

What is stripped: prose before/after (incl. `PZN_READY`) · fences of any flavour
(``` / ~~~, any info string, 4-backtick outer fence, code glued to the opener,
an unclosed fence) · `<html>/<body>/<pre>/<code>/<!DOCTYPE>` wrappers around the
keyword dialect · entity-escaped copies · zero-width / BOM · a missing
`BENTML 0.2` line (added) · a tag document that forgot `<body>` (added). Several
candidates (the empty template echoed first, then the real page) → the richest
wins. Both dialects land everywhere; `toPznSource` compiles `BENTML 0.2` to the
tag document the `.pzn` store speaks, META description/author reach the page index.

Laws, pinned by test: **identity** on every shipped `.pzn` / `.btml` (CRLF
checkouts included) · **idempotent** · **browser ≡ server**.
`node --test test/pzn/extract.test.js` · `npm run test:extract` · new cases in
`smoke-pzn-paste`, `smoke-bentml`, `smoke-pzn-tools-route`, `smoke-pzn-pages-route`,
`smoke-agent-bridge`, `smoke-copilot-tools`.

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
cd <repo>
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
