# Injections — the roleplay packs, the doors, the runner (v2.28)

An **injection** is a prompt the CMS generates for the owner's AI ("the roleplay game"), plus the **door** that receives the reply and turns it into site state. Ben's principle: *"user should tell his ai friend to make it work and we are to present perfect injection"* — every piece of hard labor an owner would do by hand (sorting a menu, designing a theme, writing a page) is a pack: the CMS assembles the site state and the rules, the model answers in a BenTML document, the door validates and previews, the owner applies.

The packs share one contract so a new pack is a descriptor, a grammar and a smoke — not new routes, not a new card.

## Packs today

| id | Kind | Document | Door | Run |
|---|---|---|---|---|
| `menu-organizer` | site | [`<bent-menus>`](bent-menus.md) | `src/menu-organizer.js` `parseMenuReply` → preview → `applyMenuPlan` (backup first) | ✔ |
| `theme-designer` | theme | [`<bent-theme>`](bent-theme.md) | `theme.extractThemeReply` → the theme library (a run never live-applies a theme; the studio does) | ✔ |
| `theme-effects` | theme | effects JS + CSS | `/admin/theme` effects door | prompt + paste only |
| `site-builder` | pages | `.pzn` page source | `/admin/inject` (`pznSourceToBlocks`, the repair engine) | prompt + paste only |

## The descriptor (`src/injections/<id>.js`)

```js
{
  id, kind, family: 'site'|'theme'|'pages', title, blurb,
  budget: { lite: 9000, full: 14000 },                    // chars — lite is the free-chat gate
  buildPrompt({ brief, size, locale, variant, ctx }) → { text, chars, meta },
  parse(reply, ctx, { brief }) → { preview, warnings:[{code,message}], warningTexts, notes, hard } | throws Error{code},
  apply(reply, ctx, { force, brief }) → { landed:{type,id,url}, backupId, changed, rebuildError, warnings },  // re-parses the reply
  undo(ctx) → { restored },
  run: { enabled, maxTokens, timeoutMs:{ local, cloud }, repairable:[codes] },
  ui:  { briefPlaceholder, sizes, applyLabel, mount:['/admin/menus'], hidden }
}
```

`src/injections/index.js` registers the descriptors at boot (`register`, `get`, `list`); `src/injections/site-state.js` builds the `ctx` every pack reads once per request (`pages, config, overrides, menus, locations, media, orphans`); `src/injections/compose.js` is the ten-section skeleton every new pack's prompt is written on (FRESH line → role → not-this → site state → grammar → decision ladder → hard rules → reply format → worked example → the brief); `src/injections/log.js` appends one JSON line per action to `config/inject-log.jsonl` (never the reply text).

## The routes (`src/routes/inject.js`)

| Route | Body / query | Returns |
|---|---|---|
| `GET /admin/api/inject` | — | `{ok, packs:[…]}` |
| `GET /admin/api/inject/:id/prompt` | `?brief=&size=lite\|full&locale=&variant=` | the pack as `text/markdown` (`X-Pack-Chars`, `X-Pack-Tokens-Est`) |
| `POST /admin/api/inject/:id/paste` | `{reply, brief?}` | `{ok, preview, warnings, warningTexts, notes, hard, chars}` — never writes |
| `POST /admin/api/inject/:id/apply` · admin | `{reply, force?, brief?}` | `{ok, applied, landed, backupId, changed, rebuildError, warnings}` · 409 `HARD_WARNINGS` |
| `POST /admin/api/inject/:id/run` · admin | `{brief, size, variant?}` | `{ok, reply, rounds, repaired, preview, warnings, warningTexts, hard, timing:{ms}, usage, provider}` — never applies |
| `POST /admin/api/inject/:id/undo` · admin | — | `{ok, restored}` |

Refusals are `{ok:false, error, code}`: 400 for a door code, `NO_PROVIDER`, `BROWSER_RELAY` (the browser relay serves the copilot chat only — copy the prompt instead), `PACK_TOO_BIG` (+ `suggestSize:'lite'`); 502 `PROVIDER_ERROR` / `EMPTY_REPLY`; 504 `TIMEOUT`.

### The run

1. The pack is composed; `estimateTokens(chars) = ceil(chars / 2.3)` + `run.maxTokens` is checked against the provider's context budget (local 20,000 — a 24K window minus headroom) **before** any money is spent.
2. `ai.generateDetailed({system:'', user: pack, maxTokens, timeoutMs})` — one hop, no history, no tools (`generate()` never attaches tools; only the copilot's `converse()` does). Local models get `reasoning_effort:'none'` and up to 4 minutes; cloud keys 90 seconds.
3. The door parses. If it refuses, or raises a warning in `run.repairable`, exactly **one** repair turn is sent with the first exchange as history and "תיקונים נדרשים: …". The reply with fewer hard warnings wins (tie → the repaired one).
4. The response carries the reply, the preview and the warnings; the card puts the reply into the same textarea the paste flow uses, so **apply is always the owner's second click on text they can read**.

## The card (`public/admin-inject-card.js`)

```html
<section class="card" id="organizer" data-inject="menu-organizer"></section>
<script src="/admin-inject-card.js"></script>
<script>TapuzInjectCard.mount(document.getElementById('organizer'), 'menu-organizer', { onApplied: r => {} });</script>
```

Brief → size toggle (lite for a free chat) → 🧠 copy the prompt → reply box → 👁 preview → ▶ run with the connected AI (only when `/admin/ai` has a provider that can run server-side) → ✅ apply (enabled only while the box holds the previewed text; hard warnings ask) → ↩ undo. Everything the model wrote is rendered with `textContent`, never `innerHTML`.

## Adding a pack

1. Pick the tag names — grep `src/pzn/modules/registry.js` first: a page module's tag (`bent-item`, `bent-nav`, …) is never a document tag.
2. Write the door: a tolerant parser (fence optional, aliases, quotes, unclosed tags), refusal codes, hard/soft warnings, a preview that shows what will change, an apply that backs up first.
3. Write the prompt on `composePack` with the site state computed by the CMS (numbers, never formulas) and numbered hard rules the eval can pin.
4. Register the descriptor; add a smoke with a canned-reply drift matrix (`test/fixtures/inject/<id>/replies/*.txt` + `.expect.json`), and a fixture site for the live eval.
5. Run `node scripts/eval-injections.js <id> 20 --fixtures=all` against the local model; every failing reply becomes a canned fixture.

## The eval loop (`scripts/eval-injections.js`)

Opt-in, never in `test:smoke`. The owner's guide to loading a local model and running the live smoke + the eval is [LOCAL-LLM.md](LOCAL-LLM.md). Every pack × every fixture × N runs through the CMS's own pipeline against the owner's model (LM Studio by default), judged by the real door. PASS for the organizer = valid ∧ no hard warning ∧ every published page placed ∧ fits one row (or a fold/side/drawer was chosen) ∧ not an echo. Reports: `docs/INJECTION-EVAL.md` (latest), `eval/runs/*.jsonl` (one line per run), `eval/failures/<pack>/*.txt` (every non-passing reply, verbatim). The 99.9% headline is written only after ≥ 3,000 scored runs with ≤ 3 non-passes.

## Hard labor still waiting for a pack (roadmap)

| Pack | Document | Blocker |
|---|---|---|
| SEO meta (titles, descriptions, OG) | `<bent-seo>` per page | decide sidecar vs `meta.seo` head fields |
| Alt text for the media library | `<bent-alts>` | a `media.alt` setter |
| Teasers + tags for articles | `<bent-teasers>` | none — next |
| Footer columns / chrome content | `<bent-chrome-content>` | site-chrome setter shape |
| Categories from the page inventory | `<bent-categories>` | none — next |
| Redirects after a rename | `<bent-redirects>` | a `meta.redirect` setter |
| CRM sequences (drafts only) | `<bent-sequence>` | never sends, never enrolls — preview only |
