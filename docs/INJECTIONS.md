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
| `POST /admin/api/inject/:id/run` · admin | `{step:{id, result}}` | the browser relay's continuation — the same answer, or the next `{ok, relay:true, modelCall:{id, body}, stage, timeoutMs}` |
| `POST /admin/api/inject/:id/undo` · admin | — | `{ok, restored}` |
| `POST /admin/api/inject/:id/job` · admin | `{brief, size, variant?}` | `{ok, job, worker}` — queue it for the owner's worker |
| `GET /admin/api/inject/jobs` · admin | `?packId=&limit=` | `{ok, jobs:[…], worker:{online, seenAt}}` |
| `GET /admin/api/inject/jobs/:jobId` · admin | — | `{ok, job}` (with `reply` + `result` once done) |
| `POST /admin/api/inject/jobs/:jobId/cancel` · admin | — | `{ok, job}` |

Refusals are `{ok:false, error, code}`: 400 for a door code, `NO_PROVIDER`, `BROWSER_RELAY` (the browser relay serves the copilot chat only — copy the prompt instead), `PACK_TOO_BIG` (+ `suggestSize:'lite'`); 502 `PROVIDER_ERROR` / `EMPTY_REPLY`; 504 `TIMEOUT`.

### The run

1. The pack is composed; `estimateTokens(chars) = ceil(chars / 2.3)` + `run.maxTokens` is checked against the provider's context budget (local 20,000 — a 24K window minus headroom) **before** any money is spent.
2. `ai.generateDetailed({system:'', user: pack, maxTokens, timeoutMs})` — one hop, no history, no tools (`generate()` never attaches tools; only the copilot's `converse()` does). Local models get `reasoning_effort:'none'` and up to 4 minutes; cloud keys 90 seconds.
3. The door parses. If it refuses, or raises a warning in `run.repairable`, exactly **one** repair turn is sent with the first exchange as history and "תיקונים נדרשים: …". The reply with fewer hard warnings wins (tie → the repaired one).
4. The response carries the reply, the preview and the warnings; the card puts the reply into the same textarea the paste flow uses, so **apply is always the owner's second click on text they can read**.

### The run on a HOSTED site — the browser relay (v2.29)

A Tapuziel on a real host cannot reach the owner's LM Studio, and the page cannot call it either: LM Studio answers loopback with **no CORS headers at all**. The one context that may is the Bridge V2 extension's background worker — so with provider `browser` the run is not one request but a short conversation with the page:

```
POST …/run {brief,size}          → {ok, relay:true, stage:'first',  modelCall:{id, body}, timeoutMs}
   page → bridge → LM Studio → raw provider JSON
POST …/run {step:{id, result}}   → {ok, relay:true, stage:'repair', modelCall:{id, body}}   ← only when the door asks
POST …/run {step:{id, result}}   → {ok, reply, rounds, repaired, preview, warnings, …}
```

The composed `body` is byte-for-byte what a server-side run would have sent (`ai.relayRequest`), the reply is read back through `ai.readRelayReply`, and the door, the one repair round and the final shape are the **same code** either way — `doorFor()` and `finishRun()` in `src/routes/inject.js` are shared by both paths. The run's state (the pack text, the site state it was built from, the first reply) stays on the server behind an opaque single-use `run_…` id; the browser carries that id and the model's own words, nothing else. `PACK_TOO_BIG` still applies — the relayed model is a local model, so it is held to the same 20,000-token window. Refusal `RELAY_EXPIRED` (400) means the id was replayed, forged, or older than 15 minutes.

Trusting the returned text is the same decision the paste tier already makes: the sender is the authenticated owner behind the admin session and the Origin gate, and **apply is still a separate POST that re-parses**. `public/admin-bridge.js` drives the loop (`TapuzBridge.drive`), shared with the copilot, which speaks the identical two shapes.

Full owner's guide: [LOCAL-LLM.md](LOCAL-LLM.md).

### The run with no browser at all — jobs and the worker (v2.30)

The relay still needs a tab, and a tab is a fragile courier: both browsers evict an idle background script after ~30 seconds, and Chrome caps any single request at five minutes. So there is a third courier, and it is a process:

```
owner (admin)          the site (hosted)                 the owner's machine
  queue a job  ───────► POST …/:id/job   composes the pack, stores it pending
                        GET  /agent/v1/inject/next  ◄───  tapuz-worker claims it
                        POST /agent/v1/inject/:jobId ◄──  the reply (→ {repair} once, at most)
  come back     ◄────── GET  …/jobs/:jobId           the reply + the door's preview
  ✅ apply
```

`src/inject-jobs.js` holds the queue (a gitignored JSON file under `CONFIG_DIR`, newest 30, with a worker heartbeat). The worker is authenticated with an ordinary **agent token** (`/admin/agent`) and needs `read` to claim and `write` to post. It **composes nothing**: the server holds the prompt, decides whether the one repair turn is needed and what it asks for, and judges every reply with the pack's own door — `judgeJobReply()` shares `doorFor()` with the run route, so a job, a relay and a server-side run are the same request with three different couriers.

Two details worth knowing. The site state is rebuilt **fresh** when a reply arrives, so a job queued last night is judged against the site as it is now. And a claim goes stale after 30 minutes and returns to the queue, so a machine that slept mid-pack strands nothing.

The worker API is four routes: `ping` (read) stamps the heartbeat, `next` (**write** — it claims, so it mutates), `POST :jobId` (write) delivers the reply or the worker own failure, and `POST :jobId/release` (write) hands a claimed job back, which is how a dry run leaves the queue as it found it. Every one of them stamps the heartbeat, so a long job does not make the worker look offline. Posting into a job the owner cancelled meanwhile is answered calmly with `{status:'cancelled'}` rather than as an error. The claim carries an explicit empty `system` turn because `src/ai.js` always sends one — a pack must not answer differently through a worker than through the run button.

A job **never applies** — it ends as a reply plus a preview, and apply is still the owner's second click. `PACK_TOO_BIG` is enforced at queue time against the local window, before anything is stored.

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
