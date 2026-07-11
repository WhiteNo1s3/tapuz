# BenTML status — what was wrong, what is wired

## Diagnosis (2026-07-11)

| Layer | Status before | Status now |
|-------|---------------|------------|
| **Spec** `docs/bentml-v0.md` + cheatsheet | ✅ Coherent keyword language | ✅ Still source of truth |
| **Compiler in `src/`** | ❌ Missing (pipedream risk) | ✅ `src/bentml/*` |
| **Preview via renderer** | ❌ | ✅ `compile → JSON blocks → renderPage` |
| **Page builder storage** | JSON blocks only | ✅ same JSON — BenTML is the *source* shape |
| **API for builder** | ❌ | ✅ `/admin/api/bentml/*` |
| **CLI** | ❌ | ✅ `tapuz bentml-compile|preview|decompile|modules` |
| **Source panel UI in admin-builder.js** | ❌ not yet | Next: call compile/apply APIs |
| **grokTapuziel `<bent-*>` HTML dialect** | Parallel experiment | **Different language** — Tapuz BenTML is the product dialect |

### What we got wrong earlier

1. **Assumed wiring existed** because the spec and page-builder previews exist — the **compiler was never in `src/`**.  
2. **Built HTML-tag “benTML” in `C:\Dev\grokTapuziel`** while Tapuz’s real language is the **keyword form** (`HEADING(level: 1) { … }`).  
3. **Node upgrade** broke `better-sqlite3` until rebuild — smokes failed for the wrong reason.

### What is bonafide now

```
.btml / BenTML source
        ↓ compile (src/bentml)
Tapuz JSON blocks  ←── page builder canvas already understands these
        ↓ renderPage / export
HTML site
        ↑ decompile
canonical BenTML
```

Common modules implemented (keyword → JSON type):

| Keyword | JSON type | Notes |
|---------|-----------|--------|
| HEADING | heading | text / photo / video path |
| TEXT | text | multi-paragraph |
| IMAGE | image | photo |
| EMBED | embed | video (YouTube) — VIDEO is reserved future |
| BUTTON | button | style→variant |
| ROW/COL | columns | layout |
| SPACE | spacer | |
| DIVIDER | divider | |
| LIST/ITEM | list | |
| QUOTE | quote | |
| CARD | card | |
| HERO | hero | children → flat fields |
| TESTIMONIAL | testimonial | |
| GALLERY | gallery | IMAGE children |
| FEATURES/FEATURE | features | |
| ARTICLES | article-list | |

## How to test

```bash
cd D:\Dev\Tapuz
node scripts/smoke-bentml.js
node scripts/smoke-render.js
node bin/tapuz.js bentml-compile examples/savta.btml
node bin/tapuz.js bentml-preview examples/savta.btml > /tmp/prev.html
node bin/tapuz.js bentml-modules
```

## Builder UI next step

`admin-builder.js` should:

1. **Decompile** current draft blocks → show BenTML in a **Source** tab (not HTML).  
2. On Apply: `POST /admin/api/bentml/compile` → replace canvas blocks.  
3. Optional: `POST /admin/api/bentml/apply` with `fullPath` to save draft.

Canvas stays visual; source stays BenTML; modules stay the type system.
