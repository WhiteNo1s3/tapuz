# Session handoff — Tapuziel (read this if the chat died)

> **Purpose:** survive a lost Claude/Grok/Cursor chat, a crash, or a night's sleep.
> Refresh it whenever a milestone lands or the direction changes (§12).
> **IN FLIGHT (2026-09-20, evening):** the Mac's MLX re-run is RUNNING — two passes, 10–14 hours, a click by Ben between them. It ends as ONE PR from the Mac that adds `eval/battery/SCORECARD-<date>-mac-mlx-rerun.md`. Nothing on the 5090 side waits for it. **What to do when that PR arrives: §10, row 2א2.**
> **NEW TIER (2026-09-20):** **v2.51 opens the premium tier** — the owner's API key as the brain, measured the same way the local one is. The battery takes `--provider=claude|openai|xai|openrouter`, every response carries what it cost, and a spending cap is the DEFAULT ($5) rather than a flag. What to run and in what order: `eval/battery/RUN-CLOUD.md`; why the prefix cache is most of the price: `docs/CLOUD-LLM.md` §2. **Nothing has been run against a real key yet** — §10, row 2כ.
> **Last updated:** 2026-09-22 — **v2.56-alpha** (Geppetto: a published Canva site or Figma Site, pasted as one address, becomes a living Tapuziel site — BenTML pages of real modules, a menu, a `<bent-theme>`, the media at home — previewed, landed live or as drafts, undone in one click; plus the stretch band `width` on SECTION/BACKDROP/HERO and a Latin font shelf — `docs/bent-geppetto.md`), before it **v2.55-alpha** (the card gateway: Grow or Cardcom behind one driver — a card order is marked paid only after the provider confirmed it to our server; test mode never looks like money; the keys live in gitignored `config/payments.json`, never the `.pzn` — `docs/bent-store.md` §The card gateway), before it **v2.54-alpha** (a block's class, animation and "hide on mobile" land on every module), before it v2.53-alpha (the store: one flip makes the site a shop — BenTML pages and five storefront modules, the catalog as one `<bent-store>` document with preview/apply/undo and an AI catalog pack, cart → checkout → orders with the server's own quote, and the whole shop inside the `.pzn` backup/hot swap — `docs/bent-store.md`), before it **v2.52-alpha** (the premium tier, second pass: keys are filed per supplier — one stored key used to follow the owner to the next supplier; `gemini` joins with the owner's own AI Studio key; OpenAI's list and field names are current; optional wire fields are revocable on a 400; Claude's cache cuts at the situation's head and gets a moving second breakpoint; the chat shows the meter), before it v2.51-alpha (the premium tier: a price table with dates, a cached briefing prefix, a battery that refuses before it spends and stops at its cap), before it v2.50-alpha, then two PRs that ship nothing (#34: the recommendation by card is DECIDED; #35: the Mac's re-run orders + `mlx-survey.sh variants`) (a thinking model gets the lowest reasoning level it allows and one larger-budget retry, `THOUGHT_OUT` says the rest; the Mac script knows LM Studio cannot load a variant by name; before it: `LOCAL_LLM_WINDOW_CAP` — an MLX row can mean 32K; the Mac survey script finds staff picks, resumes downloads and cannot be lied to about its window; before it: `style` is also a real attribute — the dead-styling door only judges CSS declarations; before it: the human dreams D9–D14 and `--briefs=dreams`; styling that does nothing goes back once, and the briefing says where the look lives), live and deploying from main.

---

## 0. Where to work

| Path | Role |
|------|------|
| the repo checkout | `main` — **the product** (`WhiteNo1s3/tapuz`) |
| `.claude/worktrees/<name>` | where an agent session actually works: an isolated copy on its own branch |
| the QA machine's install dir | the tester's harness, batteries and letters — **outside** this repo on purpose |

**Worktree rule.** A session started in a worktree edits only that worktree. Its file tools refuse the base checkout, because those edits would not be on the session's branch. Work lands through a branch → PR → main, and the base checkout catches up with `git pull`. Files that are not in git (the QA logs) are written with shell commands instead.

**Ship rule.** Branch, PR, green CI, merge. A green PR **auto-merges** (`.github/workflows/automerge.yml`), and a merge to `main` **deploys the live site**. Never commit into `main` directly.

**Language rule.** Hebrew first for product UI and owner docs; English for code, comments and these notes.

---

## 1. Product north star

**Tapuziel** (תפוזיאל) — a Hebrew-first RTL CMS: BenTML (`.pzn`) → compile → visual builder → publish → decompile, with an agent loop and a CRM/WhatsApp surface beside it. `docs/NORTH-STAR.md` is the long version.

The part that makes it different from a page builder: **the owner's own model does the work**, locally and for free, and nothing reaches the site without the owner pressing approve.

**Never in this repo** (it is public): a real hostname, hosting or account ids, machine names, personal paths, credentials of any kind. gitleaks blocks most of it; the rest is discipline.

---

## 2. State of main (as of this write)

| | |
|---|---|
| Package / ROADMAP | **`2.56.0-alpha`** — the Version Log's top row must name it (`smoke-version`) |
| Main tip | v2.56 (Geppetto — PR #46; the independent review's findings are fixed and pinned, the PR leaves draft once the reviewer confirms the fixes) on top of v2.55 (the card gateway), v2.54 (class names on every module) and v2.53 (the store) — `git log -1 origin/main` |
| Geppetto (v2.56) | `/admin/geppetto` (admin only): a Canva / Figma Sites address, a saved page, a Figma file + the owner's token (one request, never stored) or the Figma plugin's JSON → a plan (nothing changes) → preview in its own theme → land live or as drafts → undo. Engine `src/geppetto/` (decoders → the puppet → life.js → look.js → land.js). Canva's app export: an element's `A` is its TOP and `B` its LEFT. A Figma **Make** site is code, not a design — refused with that reason |
| The store (v2.53) | ships **closed** everywhere, the live site included — opening it is the owner's click on `/admin/store`, never an agent's. `docs/bent-store.md` |
| The card gateway (v2.55) | ships **unconnected** — no provider, no keys. Connecting Grow or Cardcom (`/admin/store/gateway`), the first real sandbox run and going live are the owner's: an agent never types a key or switches a live gateway on. Needs an https `baseUrl` in the site settings (empty on the live site today) |
| In flight | **the Mac's MLX re-run**, started 2026-09-20 by the Mac's agent under `eval/battery/RUN-ON-MAC.md`. Do NOT edit that file or `scripts/mlx-survey.sh` while it runs — pass 2 must follow the orders pass 1 started under; a fix waits for the card (or for a refusal sent back). §10 2א2 |
| Open product calls | **none** — the three the survey left were decided by Ben on 2026-09-20 (the row below). Do not reopen them, and do not add models to the survey unless Ben names one |
| Recommended local model | **Gemma 4**, by card (Ben's decisions, 2026-09-20): 12–24 GB → 12B (Google's QAT 4-bit) — on 24 GB the 26B-A4B is the faster alternative for an owner who types specs; 32 GB → 31B; the E-models run the one-shot packs only. Named option for a card the 12B does not fit: Qwen 3.5 9B — not the default. Muse-Glimmer 30B: supported, not recommended (`docs/LOCAL-LLM.md` §1א, §5) |
| Live | deploys from `main` on merge; the generator meta carries version + stamp + sha |
| CI | `.github/workflows/security.yml` — gitleaks, the test suite, npm audit (high+, prod deps); Node 24 |
| Version rule | every shipped session is **+0.01** with a Version Log row; docs-only PRs bump nothing |
| Premium tier (v2.51, v2.52) | provider `claude` / `openai` / `gemini` / `xai` / `openrouter` with the owner's key, **filed per supplier** (an agent never types, reads or handles a key — the owner sets it in her own shell or pastes it into the setup screen herself) — the CMS fetches it itself. Every chat response carries `spend` (tokens, cache split, money); the price table with its read-date is `src/ai-cost.js`; the Anthropic briefing prefix rides with `cache_control` (a tenth of the input price after the first hop). `docs/CLOUD-LLM.md`, orders in `eval/battery/RUN-CLOUD.md`. **No real key has been run yet** |
| Local model | provider `local` (a loopback runtime) or `browser` — **Bridge V2 0.5.5**, the extension in `extension-v2a/` |
| The Bridge, for a developer | `npm run bridge:update -- --site <host>` writes it into a folder **outside** any checkout, with an updater beside it (`scripts/update-bridge.js`) |
| QA | a separate tester agent; its logs and letters are git-ignored (`ai-qa/`, `docs/TAPUZ-TESTER-BUGS.md`, `docs/BEYOND-ALPHA-GATES-DRAFT.md`) |

---

## 3. The arc since v2.12 (what a new session should know)

**BenTML at every door.** Pages are `.pzn` documents; the same parser, validator and repair pass stand behind the builder, the paste flow, the agent API and the copilot. Leaf modules (`bent-mediacard` and friends) take props, not children — the briefing and the primer both say so, because a model that guesses puts children in a leaf.

**The owner's model does the work.** `/admin/ai-setup` connects either a loopback runtime or **Bridge V2**, a dev-mode extension that relays the page's request to a local model. The ZIP the site serves arrives already wired to that site (`src/bridge-manifest.js`). The Bridge streams, survives its worker dying, picks its timeout by what has actually flowed, and after a Reload it puts a fresh copy into the open tab (0.5.5).

**Nothing ships without approval.** The copilot's tools read freely and stop for approval on every write: `create_page` / `edit_page` land in a **draft**; `organize_menu` is the one live write, so it takes a backup first and offers the undo. A refusal writes nothing and the model is told so in those words. A proposal that the door refuses goes back to the model, never to the owner (`src/ai-tools.js` preflight).

**A local model is never asked without its briefing.** `assertBriefed` (`src/ai.js`) gates every local/Bridge path — the tool loop, the injection runner, the relay body, the worker queue — because a model with no briefing invents a dialect. The visitor support chat is the single declared exception (`prose: true`).

**A model's HTML is untrusted.** `src/ai-html-guard.js` scrubs script, `on…=` and `javascript:` out of every `bent-html` a model wrote, on every AI door; admin previews render in a sandboxed iframe without same-origin. `docs/security.md` §5.

**The copilot is measured, not assumed (v2.44).** `scripts/battery-copilot.js` asks a REAL local model thirteen things the way an owner asks them and judges by what landed in the pages and menus tables (`docs/LOCAL-LLM.md` §3א, results §5). It is how the 30-second socket, the shared window, the unreadable-own-page at 8K, the page-dropping menu and the `PZN_READY` reply were found — every one of them invisible to a canned smoke. One GPU job at a time: LM Studio's window is a pool (`--parallel 1`, §1ד).

**Test with an owner's words, not a spec (v2.46).** Ben's rule: the customer brings DREAMS, so a check must start from a reasonable human sentence and be judged the way that person would judge — and against the page builder (does it open, render, survive a save). `node scripts/battery-copilot.js --track=dreams` is that; its first run found nine invented pictures in one page. When you add a copilot feature, add a dream for it, not only a T-scenario — and when a model's answer surprises the judge, ask whether a person would have accepted it before calling it a miss.

**Do not talk robot to the robot (v2.47).** Ben, sharper: *"we cannot make his life easy 'hero <XXXX> bla bla' … think about humans, what they ask you to do all the time — that is the attitude."* A test sentence names no module, no count and no attribute. It is a wish ("warm, the side in purple, a moving message I can change"), a pile of her own material ("here is my doc — make it beautiful, with chapters"), a complaint, a change of heart ("put it back"), somebody else's words, a fact that changed. The judge asks what SHE would ask: are MY facts on it (the ones no model knows from training), is it what I said, did you tell me the truth about what you did. The same goes for the one-shot packs: `eval-injections.js --briefs=dreams`. The first such sentence found the copilot claiming colours and a fixed background it had written as Tailwind classes — a lie no spec-shaped test could have heard.

**Try a new door on the models that FAIL, not only on the one that passes (v2.48).** The v2.47 door was proven on Gemma 31B — which never writes `<bent-divider style="dashed">`. The 26B-A4B does, the door bounced it for a legitimate attribute, and that model does not recover from a bounce: the false positive cost it at least four of the thirteen scenarios it lost in the first survey run. A door's proof run is the recommended model AND the weakest model that can still drive the copilot.

**A wait needs a deadline, and a word you have SEEN (2026-09-20).** A background watcher polled a finished log for seventeen hours: it waited for `PASS|passed` in the output of `node --test`, which ends `ℹ pass 158` — and guarded itself with `pgrep`, which Git Bash on the Windows box does not have ("command not found" negated to *true*: the guard guarded nothing). A loop that never exits never reports, so nothing said it was stuck. Wait on the process itself, or on an exit marker you write; bound every loop and print the give-up; use only tools that exist on the box. The same disease as the check that could never pass (below).

**Ask the runtime what it can do before telling it what to do (v2.50).** Two assumptions died the same day, both about LM Studio: that `reasoning_effort: "none"` switches thinking off (for a model without an "off" level it means the DEFAULT — "high"), and that a variant LM Studio itself prints as `google/gemma-4-31b@8bit` can be loaded by that name (it cannot — not by `lms load`, not by the REST API). `GET /api/v1/models` answers both: `capabilities.reasoning.allowed_options`, `variants`, `selected_variant`. Probe, then act; and when the runtime cannot do what the row needs, the row says so and names the click.

**A check that can never pass gets shimmed (v2.49).** `mlx-survey.sh` demanded `loaded_context_length == 32768`; the MLX engine loads at 262,144 whatever it is asked. The check refused — correctly — and somebody put a fake `curl` on PATH to get past it. Before writing a hard check for a machine you cannot see, find out whether it CAN pass there; make the instrument record what is true (configured → effective → what the battery itself saw) instead of demanding what you hoped; and give a script for another machine a smoke with fixtures from that machine (`smoke-mlx-survey.js`) — it had none, and measured 3 models of 12.

**The door helps a model that is almost right (v2.45).** A document the model PRINTED instead of calling the write tool is adopted as that call — same preflight, same approval card — but only for a page or a menu it READ this turn; a closing tag that almost matches is read as the open element; `E_CHILD` names what the container accepts; a refused proposal followed by plain words gets "nothing was saved" beside it (`docs/LOCAL-LLM.md` §3ב). When a smaller model fails a scenario, run the battery with `--courier=relay` first: the transcript shows what the door told it.

**One LM Studio, two machines.** With LM Link on, `lms unload --all` reaches the other machine and an unknown model name can be served by it. Scripts unload by identifier and stop when someone else's model is on the GPU (`docs/LOCAL-LLM.md` §5).

**Geppetto (v2.56).** Ben: *"we need to get canva sites and make them our own in BenTML … swallow it whole with no salt … they are imported nonsense, we make a life in them, like pinocchio and jeppetto."* A design tool publishes a poster; Geppetto reads the design's INTENT out of its geometry (`src/geppetto/life.js`: backgrounds → full-width bands, side-by-side → rows with the designer's ratio, pills → buttons, repeats → cards/team/stats/gallery, the top band's links → the menu, one h1 by the design's own scale, pieces of one heading read as one, echoes and decorations dropped and COUNTED). Two decoder families feed one contract (`src/geppetto/puppet.js`): Canva ships two export shapes that coexist on one site; Figma Sites ships a bundle in the REST node schema (`/_json/<bundle>/_index.json`, one more JSON per page). Rules to keep: a decoder never writes BenTML and Geppetto never reads Canva/Figma; every color that reaches a `style` attribute is rebuilt from parsed numbers; every fetch goes through `assertPublicUrl`; the life pass runs in the request thread, so every pass must stay near-linear (six quadratic passes and a recursive union-find were found and fixed across two review rounds — the worst 31 s on crafted input — every pass has a work budget, a design past 20,000 boxes is refused, and `smoke-geppetto` times a crowded design); every link the design brings passes the control-aware scheme gate twice (at emission and in `finish()`), and the renderer, the menus and logo links share the PZN escaper's gate. Undo takes back the import and nothing else (`takeBack` in `land.js`): pages are found by their stamp (a renamed page too) and an edited one is kept, media stay while anything the site stores still names them (every DB text column and settings/content file — `mediaUser`), the ledger is written ahead of each change (`saveProvisional`), a look changed since is filed in the library first, stacked imports splice only onto the import's own untouched values (what the owner changed in between is what comes back), one landing runs at a time, the ledger knows a landing from the moment its pages are reserved, and a half-way failure rolls back — keep those guarantees when touching landing. Before changing the heuristics, run the corpus harness idea from the PR (the real samples live outside the repo — never commit a real person's site).

**The flip (v2.53).** Ben: *"make the flip and the site behave as a store … write it in BenTML … compressed to PZN when you pack up the site for backup or hot swap."* The store is written the way the rest of the site is: its pages are BenTML pages made of five storefront modules (`<bent-shop>`, `<bent-buy>`, `<bent-cart>`, `<bent-checkout>`, `<bent-order>`), and the catalog is one `<bent-store>` document that exports, pastes, previews, applies with a BenTML backup, and undoes — the same door an AI pack (**כותב/ת הקטלוג**) reaches. Everything it knows lives in the SQLite file, so the `.pzn` export, the backup shelf and a live restore carry the whole shop, and the storefront is rebuilt from what was restored. Two rules to keep: **the browser never holds a price** (every sum is `pricing.quote()` on the server), and **an order is one immediate transaction** (guarded stock and coupon updates). A store module added to the COMPACT grammar will break the lite pack's and the 8K briefing's gates (`COMPACT_SKIP`).

**Guards worth knowing before you change anything:** the version smoke, the route-map guard, gitleaks' custom rules, the login brute-force guard (5 attempts, then a doubling lockout), and the origin CSRF gate.

---

## 4. QA — what to run after a crash

```bash
npm install            # if node_modules is missing (better-sqlite3 builds natively)
npm run test:pzn       # 158 language tests
npm run test:smoke     # ~157 suites, the real gate
npm run qa:quick       # the checklist's fast path
npm run qa             # the full report
```

Opt-in, not in CI: `node scripts/smoke-bridge-reload.js` needs a real Chrome (`CHROME=…`, and `SMOKE_LM_PORT=1299` to run beside a live model runtime). Needs a model, so also opt-in: `npm run battery:copilot` (`LOCAL_LLM_BASE`, `LOCAL_LLM_MODEL`; `--courier=relay` for the hosted path) and `npm run eval:inject`.

A smoke that writes into the tracked tree is a bug in the smoke: set `TAPUZ_ROOT` to a temp dir **before** requiring anything from `src/`.

---

## 5. Important paths

| Area | Path |
|------|------|
| Server assembly | `src/server.js` |
| BenTML language + validator | `src/pzn/` (`index.js`, `repair.js`, `registry.js`) |
| The briefing a model reads | `src/pzn/agent-roleplay.js`, `src/pzn/agent-primer.js` |
| The copilot: loop, tools, guards | `src/ai.js`, `src/ai-tools.js`, `src/ai-window.js`, `src/ai-html-guard.js` |
| Menus + the organizer | `src/menus.js`, `src/menu-organizer.js`, `src/bentml/menu-dialect.js` |
| The Bridge extension + its build | `extension-v2a/`, `src/extension-build.js`, `src/bridge-manifest.js`, `scripts/update-bridge.js` |
| Admin chat / builder / drawer | `public/admin-chat.js`, `public/admin-builder.js`, `public/admin-copilot-panel.js`, `public/admin-bridge.js` |
| Security write-up | `docs/security.md` |
| Geppetto (import Canva / Figma) | `src/geppetto/*` (puppet = the contract, canva / figma / font-name = the decoders, fetch = the doors, life = the life pass, look + fonts = the theme, land + index = plans, preview, landing, undo), `src/routes/geppetto.js`, `public/admin-geppetto.js`, `integrations/figma-plugin/`, `docs/bent-geppetto.md` |
| The store | `src/store/*` (money, settings, catalog, coupons, pricing, orders, pages = the flip, render, document, `gateway/` = the card gateway: index = the flow, config = the keys file, cardcom, grow), `src/bentml/store-dialect.js`, `public/tz-store.js`, `src/routes/store-*.js`, `src/injections/store-catalog.js`, `docs/bent-store.md` |
| CRM | `src/crm/*`, `src/routes/crm.js`, `src/routes/crm-track.js` |
| WhatsApp | `src/crm/whatsapp.js`, `wa-ledger.js`, `wa-send.js`, `wa-webhook.js`, `src/routes/wa-webhook.js` |
| Specs | `docs/WHATSAPP-INTEGRATION.md`, `docs/ROADMAP.md`, `docs/ROUTE-MAP.md` |
| Smokes | `scripts/smoke-*.js` (CRM + `smoke-wa-*` + `smoke-whatsapp.js`) |
| Secrets (gitignored) | `config/whatsapp.json`, `config/auth.json`, `config/ai.json`, … |
| CI | `.github/workflows/security.yml` |

### Lab-only (not necessarily on main)

| Area | Path |
|------|------|
| Pixel embed admin | `/admin/crm/pixel-embed` |
| Loader | `public/tz-pixel.js` |
| Spec | `docs/PIXEL-EMBED-SPEC.md` |
| WP plugin | `integrations/wordpress/tapuziel-pixel/` |
| Builder recipe | `integrations/builder.io/README.md` |

---

## 6–9. History: the CRM/WhatsApp arc (v1.92 → v2.12)

> The sections below are kept as written when they shipped. They are history, not current state — check the code before trusting a detail.

### 6. Progressive customer cards (shipped this session)

**Idea:** legit first-party pixel/visit → open a **customer card**; email/name/pages enrich **one** card; stitch with first-party cookie `tz_v` (no raw IP store); quiet provisional → garbage → erase. Service, not surveillance.

| Piece | Path |
|-------|------|
| Core | `src/crm/cards.js` |
| Statuses | `provisional`, `garbage` on `crm_contacts` |
| Seam | `capturePageview` opens/touches card when progressive on; needs `res` for cookie |
| Form | enriches same card or merges ghost → known identity |
| Lifecycle | `quietDays` default **5** → garbage; `garbageDays` default **3** → hard erase |
| Config | `config.crm.cards.{ progressive, quietDays, garbageDays }` |
| Smoke | `npm run test:crm-cards` / `scripts/smoke-crm-cards.js` |

Reachable people (email/phone) are **not** auto-deleted by the quiet timer — only empty provisional ghosts.

## 7. Cards admin + interest segments (shipped after 1.92)

| Surface | What owners see |
|---------|-----------------|
| CRM enable offer | Hebrew copy: site → CRM, no shady tracking |
| `/admin/crm` | Tiles: כרטיס זמני / ליד / … / ממתין למחיקה; interest pills |
| Contact sheet | Status pills HE, interests block, provisional/garbage explainers |
| `/admin/crm/privacy` | progressive toggle + quietDays + garbageDays |
| `/admin/crm/segments` | **interest** + hasInterest rules for relevant mail |

## 8. Campaign → live segment (shipped)

| Piece | Detail |
|-------|--------|
| Schema | `crm_campaigns.segment_id` (additive) |
| Audience | Segment evaluated at send time; consent + email required; provisional/garbage skipped |
| Admin | Campaign form: segment OR list; segments page: **דיוור לפילוח** |
| Smoke | `smoke-crm-campaigns` covers interest segment audience |

Obligations unchanged: consent, unsubscribe, no open redirect.

## 9. SMTP hardening (v1.95)

| Guard | Detail |
|-------|--------|
| `isSmtpReady` | campaigns need host/user/pass/enabled (not lead `to`) |
| Timeouts | connection / greeting / socket |
| Header injection | CR/LF stripped; address validated |
| Daily cap | `maxPerDay` (default 500), `notify-usage.json` |
| Campaign queue | refuses if SMTP not ready or cap too small |
| Admin | verify connection + test send; reputation counter |

## 9b. Interest map (v1.98)

Closes the loop: pageview → interest tag → **site-wide map** → live segment → campaign.

| Piece | Path |
|-------|------|
| Core | `cards.listInterestStats`, `addInterest`, `removeInterest`, `normalizeInterestLabel` |
| Admin | `/admin/crm/interests` (+ nav **תחומי עניין**) |
| Contact | interest add/remove; manual tags no longer wipe `interest:*` |
| List | `?interest=` filter + hot-topic pills |
| Campaign | `?interest=` ensures segment with hasEmail and preselects it |
| Smoke | `npm run test:crm-interests` |

## 9c. Pixel embed + identity claims (v1.99) — serious security

**Do not reintroduce** `identify → upsertContact` on the public collector.

| Piece | Path |
|-------|------|
| Collect | `src/crm/collect-handler.js` — no upsertContact |
| Registry | `crm_sites` / `src/crm/sites.js` — unknown → 204 |
| Claims | `crm_identity_claims` / `src/crm/identity-claims.js` — approve in admin |
| Analytics | foreign anonymous → `pageviews.site_id`, not `crm_events` |
| Loader | `public/tz-pixel.js` — claim-only identify, HTTPS snippets |
| Flag | `config.crm.pixelEmbed.enabled` default **off** |
| Admin | `/admin/crm/sites`, `/admin/crm/claims` |
| Smoke | `npm run test:pixel-embed` |
| Spec | `docs/PIXEL-EMBED-INTEGRATION.md` |

## 9d. Sales tasks (v2.00) — vs HubSpot "next action"

| Piece | Path |
|-------|------|
| Core | `src/crm/tasks.js` — create / due board / complete / cancel |
| Schema | `crm_tasks` (CASCADE on contact) |
| Admin | `/admin/crm/tasks` + card quick-add |
| Smoke | `npm run test:crm-tasks` |

## 9e. Kanban + task reminders (v2.02)

| Piece | Path |
|-------|------|
| Board | `/admin/crm/board` — drag or select status move |
| Reminders | `src/crm/task-reminders.js` + tasks page form |
| Config | `crm.tasks.reminders.{ enabled, to }` |
| SMTP | same `notify.js` as campaigns / lead alerts |
| Schedule | daily with `runRetention` (dedupe by day) |
| Smokes | `test:crm-board`, `test:crm-task-reminders` |

## 9f. Email sequences (v2.03)

| Piece | Path |
|-------|------|
| Core | `src/crm/sequences.js` |
| Admin | `/admin/crm/sequences` + contact enroll |
| Rules | consent + email; no provisional/garbage; unsub stops drip |
| Schedule | `runRetention` → `maybeProcessDaily` |
| Smoke | `npm run test:crm-sequences` |

## 9g. Customer task reminders (v2.04)

| Piece | Path |
|-------|------|
| Config | `crm.tasks.customerReminders.enabled` |
| Send | `sendCustomerTaskReminders` in `task-reminders.js` |
| Dedupe | `crm_tasks.customer_reminded_on` |
| Admin | משימות → תזכורת ללקוח + שלח ללקוחות עכשיו |

## 9h. Unified inbox (v2.07)

| Piece | Path |
|-------|------|
| Projector | `src/crm/unified-inbox.js` |
| Entity | `Customer.inboxItems()` |
| Admin | `/admin/crm/inbox` |
| Rule | channels stay systems of record; no dual body store |
| Smoke | `npm run test:crm-unified-inbox` |

## 9i. Actionable inbox (v2.08)

| Action | Effect |
|--------|--------|
| 🔗 כרטיס | `ensureContactForItem` → Customer |
| ✅ משימה | task on that contact |
| 📝 הערה | timeline note on entity |
| טופל | channel-native close/ack |

## 9j. Replies + companies/deals (v2.09)

| Piece | Path |
|-------|------|
| Reply | `unifiedInbox.replyFromItem` — chat / WA |
| Companies | `src/crm/companies.js` |
| Deals | `src/crm/deals.js` |
| Entity | `Customer.companies()` / `deals()` |
| Smoke | `test:crm-companies-deals` |

## 10. Open / next (when resuming)

| # | Next step | Notes |
|---|-----------|--------|
| 1 | Beyond-alpha gates | The criteria draft lives on the QA machine (git-ignored). Promote the agreed ones into ROADMAP/NORTH-STAR when they hold. |
| 2 | The compact briefing's safety net | The injection-awareness rule is full-tier only — the compact tier sits at the edge of an 8K window (`smoke-ai-window`). Its net is the server-side scrub. The v2.44 sentence "a question is answered in words" is full-tier only for the same reason. |
| 2א | The visitor chat on a slow local model | `src/crm/cs.js` still rides `server.js`'s 30 s idle cap. It is a PUBLIC route, so the cap was left alone on purpose (slow-loris); a local model that needs more than 30 s for a visitor's answer loses the socket. Stream it, or answer async. |
| 2א2 | The MLX rows (the Mac node) | The recommendation per card is 5090 **GGUF Q4** numbers. The Mac (128 GB) answers two questions the PC cannot: do more bits change the verdict (8-bit against 4-bit MLX of the same Gemma), and is a model that does not fit a 32 GB card the better helper (gpt-oss-120b, Mistral Small 4 119B, Qwen3-Coder-Next). One command there: `bash scripts/mlx-survey.sh` — fifteen models, fixed, dreams first; the orders and the cluster rules (main is the sync point, one owned path, one PR at the end, only `tapuz-mlx-*` models are its own) are `eval/battery/RUN-ON-MAC.md`. Results come back as `eval/battery/SCORECARD-<date>-mac-mlx.md`. Its first night (2026-09-20) measured 3 of 12 models, mislabelled — the map is `eval/battery/BREAKAGE-2026-09-20-mlx-survey.md`, the fix is v2.49: the MLX engine loads at 262,144 whatever is asked, so the CMS budgets at 32K itself (`LOCAL_LLM_WINDOW_CAP`) and every row records configured → effective → what the battery's own probe saw; the recommended models get one more row uncapped. `scripts/smoke-mlx-survey.js` verifies the script without MLX. **The re-run is two passes** (the orders say how): LM Studio files a staff pick's 8-bit and 4-bit under ONE key and loads only the *selected* build (v2.50), so a pair needs a click by Ben between the passes — `mlx-survey.sh variants` (read-only) says what to click BEFORE the night, a tag as an argument (`mlx-survey.sh gemma-31b-4bit`) runs one unblocked row instead of a whole tier, and the card drops a not-measured row once the same tag is measured. Results come back as `SCORECARD-<date>-mac-mlx-rerun.md`. **IN PROGRESS since 2026-09-20 (evening)** — not yet verified on MLX; `variants`, tag arguments and the card's row filter were tested on the Mac's fixtures and on the 5090's real LM Studio (a GGUF two-variant model), never on macOS itself. **When the Mac's PR arrives, in this order:** (a) **the windows first** — every row must read configured 32768 → effective ≥ 32768 → budgeted 32768 → battery saw 32768, and a `+autofit` row budgeted = effective; a `WINDOW MISMATCH`, a "via wrap", or a header that names a window the rows did not run at voids the night: say so, quote nothing. (b) **both builds of each pair** (Gemma 31B, Gemma 12B) must be measured rows; a card that still has `THE OTHER VARIANT IS SELECTED` rows is pass 1 only — ask Ben for the click and pass 2, do not publish half a comparison. (c) **the two `variants` reports** pasted in the card become fixtures in `scripts/smoke-mlx-survey.js` — the script for a machine we cannot see is tested on that machine's own words. (d) the MLX rows go into `docs/LOCAL-LLM.md` §5 as NEW rows (an MLX row never corrects a 5090 row), with the answer to the two questions: do more bits change the verdict, and is a tier-C model the better helper. (e) **the recommendation by card is decided** (§2); an MLX number changes it only if Ben says so — bring it to him as one finding with its number, not as a new survey. (f) if the run REFUSED or broke instead: the refusal is the result. Fix the script here with a smoke case built from what the Mac printed; never ask the Mac to work around it. A 7/13 measured there on 2026-09-19 was withdrawn: an interrupted battery had left its server on the port, so the run talked to yesterday's site and judged a fresh one — the battery now refuses an occupied port. |
| 2כ | **The premium tier has never met a real key** | v2.51 built the instrument; nothing has been measured with it. The order is in `eval/battery/RUN-CLOUD.md` and it starts with a PROBE, not a night: one dream on the cheapest model with a $1 cap, because nobody knows yet what this battery costs. What §2 of `docs/CLOUD-LLM.md` does know, measured: the copilot's full briefing is **~21,700 tokens on every model call** (49,904 chars), so an uncapped Sonnet run pays ~$0.045 a call before anything else — which is why the Anthropic prefix now rides with `cache_control` and why the run prints what the cache saved. Open with it: **(a)** the estimate in §2 ($2–4 a dreams run on Sonnet, $1–2 on Haiku) is arithmetic, not a measurement — the probe replaces it; **(b)** no price is held for xai/openrouter on purpose (nobody read their pricing page — `--price-in`/`--price-out` until someone does, then a dated row in `QUOTES`); **(c)** only the system prefix is cached — the growing tool-result history is re-sent whole every hop and is the next lever; **(d)** the habits in `LOCAL-LLM.md` §5 were all found on local weights, so a cloud row is a NEW row and never corrects one; **(e)** RAG — the other half of Ben's sentence — is not built and is its own phase. |
| 2ב | The battery over the real extension | `--courier=relay` plays the Bridge from Node. The same thirteen sentences through Chrome + Bridge V2 would also cover the stream accumulator (does LM Studio's mid-stream pool error reach the page as `WINDOW_SHARED`?). Never against production: the battery approves its own proposals, and an approved menu is LIVE. |
| 2ג | What the model survey left open | The survey is done (`docs/LOCAL-LLM.md` §5: the QAT builds of the big sizes, Dicta's Hebrew models, gpt-oss-20b, and the dreams track per model). Three habits it found that the tool loop does not answer yet: **(a) silence after a read** — gemma-4-26B-A4B (its QAT build most of all) sometimes returns an empty reply right after `read_page`; one "you read the page — now answer" retry is the untried idea. **(b) a printed tool CALL** — DictaLM-12B writes `{"name": "read_page", "arguments": …}` as text; v2.45 adopts a printed *document*, not a printed call. **(c) the runtime's own parse error** — gpt-oss-20b loses about one turn in six to LM Studio's `500 … does not match the expected peg-native format` (with the six-tool request; none with the lean four-tool one); asking again works, the copilot does not retry. None of the three models is a recommendation, so none of this is urgent. |
| 2ו | A picture slot the owner can fill | With an empty library the copilot now builds WITHOUT images. What an owner may want instead is a slot: an image module with no source that the builder shows as "choose a picture" and the published page simply omits. Today the renderer prints `<img src="">` for an empty source — a product decision (renderer + builder), not a door. |
| 2ה | Read-before-edit, enforced | The briefing says "חובה לקרוא דף לפני שעורכים אותו"; only the v2.45 ADOPTION enforces it. A real `edit_page` call for a page the model did not `read_page` this turn still reaches the card (battery T6, gemma-4-26B-A4B: the paragraph beside the edited heading vanished). Send it back once ("קרא/י את הדף קודם"), like `PAGES_LOST`; the scripted smokes that edit without reading need a `read_page` first. |
| 2ד | The E-models in the copilot | gemma-4-E2B/E4B *describe* the tool they are about to call and stop (12–13/26). The packs work on them; the copilot does not. A nudge ("you said you would call read_menus — call it") is the untried idea. |
| 2ט | A thinking model — what is left after v2.50 | Done: the lowest reasoning level a model ALLOWS (`/api/v1/models`), one larger-budget retry on every courier, `THOUGHT_OUT` when that is not enough (Muse-Glimmer: organizer 2/27 → 27/27). Left: (a) over the **browser courier** the server cannot probe the owner's runtime, so that path still sends "none" and leans on the retry — the page could send the level with its window hint (a Bridge change); (b) Muse still stops at the hop limit on "update the hours wherever it belongs" (it reads page after page looking for hours that are nowhere) — a manners problem, not a budget one; (c) **decided 2026-09-20: Muse is supported, not recommended** — it is slower than Gemma at the same memory even at "low". |
| 2י | What else the human survey left | (a) **Decided 2026-09-20 — the 24 GB default is the 12B QAT** (25/28 on owner sentences against the 26B-A4B's 22/28, at less than half the memory); the 26B-A4B stays as the faster alternative for spec-shaped requests. No product screen names a model today, so nothing in the UI had to follow; if a setup screen ever suggests one, it reads LOCAL-LLM §1א. (b) **Decided 2026-09-20 — Qwen 3.5 9B** (11/14, 7.5 GB) **is a named option, not the default**: the first small model that drives the copilot, for a card the 12B QAT does not fit; the recommendation stays inside Gemma 4. (c) **Qwen 3.8 + the LITE paste pack + a human brief**: four of five refused by the door; the pack is one line per tool and a vague brief leaves more to invent. (d) **Granite's tokenizer**: the compact briefing is 8,314 tokens for it — no 8K mode; the CMS says so correctly. (e) The 26B-A4B's **silence** (2ג a) now also ends the pasted-document dream: `EMPTY_REPLY` on both runs. |
| 2ז | A look-and-feel wish in the copilot | An owner tells the HELPER "warm, the side in purple, a background that stays still" — she does not know the theme is another screen. From v2.47 the copilot does the page part (the moving message), says plainly that the rest is **עיצוב ← ערכת נושא** and drafts the sentence for the AI designer there. What a person expects is one more step: a gated `propose_theme` tool that hands her wish to the theme designer and shows the result on the theme canvas for ✓. A seventh tool arrives with its own gate checks (`smoke-copilot-tools` pins "exactly six"). |
| 2ח | What the human dreams still hear | (a) "Shorten it" keeps what she named (phone, prices) and, since the v2.47 sentence, her name — but still drops her **street address** (D11, gemma-4-31B ×2). (b) For "warm, and the SIDE in purple" the theme designer paints the *whole site* lavender and leaves the rail white (theme dream 1). Both are soft today; both are prompt work, not doors. |
| 3 | The theme studio canvas | Still a same-origin iframe; the other admin previews are sandboxed (`docs/security.md` §5). |
| 4 | The host strips the preview's CSP | On the live host only the iframe's own `sandbox` attribute protects; the header does not survive the proxy. |
| 5 | OSS packaging / support SKU | Free core; money on support, hosting and modules. |
| 6 | English product surface | Only once Hebrew is solid. |

**Decided, not open:** GitHub is the one remote for both machines. A LAN hub was tried on 2026-09-18 and dropped the same day — every change has to reach GitHub anyway for CI and the live deploy, so a second sync point only adds a place to forget to push.

**Owner actions that agents must not take:** deleting pages (permanent — no trash), changing the admin password, publishing test drafts, removing an extension from the browser.

Avoid: multi-feature sprawl; a real hostname in a commit; claiming a live verification that was actually a local one.

---

## 11. Honesty log (don't overclaim)

| Claim | Truth |
|-------|--------|
| The live site runs what `main` holds | **Yes** — merge deploys; the generator meta names version, stamp and sha |
| The copilot writes pages without approval | **No** — every write waits for the owner; refusals write nothing |
| An approved menu sort changes the live menu | **Yes** — measured end to end with a real local model (v2.43 row), backup taken, undo restores |
| A local model is ever asked without its briefing | **No** on every CMS/Bridge path (`assertBriefed`); a raw call to a model runtime from outside the CMS is not ours to gate |
| The Bridge survives a Reload with the tab open | **Yes** from 0.5.5 — measured in a real Chrome; a tab opened under 0.5.4 needs one refresh |
| A model's raw HTML can run on the admin origin | **No** — scrubbed on every AI door; previews are sandboxed |
| The copilot does the right thing when an owner types a sentence | **Measured** — the battery's numbers are in `docs/LOCAL-LLM.md` §5, per model and per window; a PASS is read from the tables, never from the model's words |
| A copilot turn longer than 30 s reaches the owner on a server-side courier | **Yes** from v2.44 — it did not before (the socket was dropped and the turn ran on alone); `smoke-inject-route` holds a slow model on both routes |
| Two requests can share a local model's window | **No** — LM Studio's context is one pool; concurrent big requests all die. The door says so in Hebrew (`WINDOW_SHARED`); the cure is `--parallel 1` |
| A local model under 31B can drive the copilot | **Yes from 12B** — measured per size and per card in `docs/LOCAL-LLM.md` §5; the 2B/4B-effective models cannot, and the doc says so |
| A model's page can show a broken picture or a dead call-to-action | **Much less** from v2.46 — an empty library is said in the briefing, and new image paths / internal links that do not exist go back to the model once; what it insists on is written beside the card for the owner. A draft is still the owner's to read before publishing |
| The copilot can change how the site LOOKS | **No** — it writes pages and menus; colours, fonts, the background and a side menu are the theme screen. Before v2.47 it *said* it had (Tailwind classes and `style=` that do nothing here); now those go back to the model once, the briefing names the screen, and what a model insists on is flagged to the owner beside the card |
| The battery ran against the live site or the real extension | **No** — a scratch CMS on localhost; `relay` plays the Bridge's part from Node. Production was only ever checked for its version stamp |
| The Mac's MLX rows exist | **Not yet** — the first night's card (`SCORECARD-2026-09-20-mac-mlx.md`) is uncapped rows from the first script and says so in its banner; the re-run started 2026-09-20 and is unverified until its card passes §10 2א2 (a)–(b) |
| `mlx-survey.sh` is proven on a Mac | **No** — proven on the Mac's fixtures in CI and on the 5090's real LM Studio; `card_rows` / `known` are plain POSIX awk but have never run under macOS's awk |
| The survey's raw transcripts are safe | **Yes, outside the repo** — they are git-ignored on purpose (the repo is public; raw runs confuse the next robot). The 2026-09-19/20 transcripts and logs are backed up on the 5090 box on two other drives; Ben knows where, and the path is deliberately not written here. Transcripts written inside a worktree die with it — copy them out first |
| A key can reach a supplier that did not issue it | **No** from v2.52 — keys are filed per supplier and a call takes only its own (`smoke-byok`, `smoke-copilot-route`: a switch without a new key leaves no request). Before v2.52 it could |
| Two sessions can build the same release without knowing | **Yes — it happened on 2026-09-20** (v2.51 and what became v2.52). The second one noticed only because it fetched `main` before pushing. Fetch before you START a release too, not only before you push; and when another session's work is already on `main`, build on it — do not merge around it |
| The store takes card payments | **Yes, in code (v2.55)** — Grow or Cardcom, hosted page, paid only after the provider confirmed it to our server (`smoke-store-gateway`, 166 checks, fake transports). **Never run against a real provider yet**: the first sandbox run needs the owner's keys (Cardcom: terminal 1000 + the test API name from Cardcom support; Grow: sandbox ids from Grow). No card number ever reaches the store; the keys stay in `config/payments.json` |
| A price the browser sends can change what an order costs | **No** — the browser keeps sku + option + qty; every sum is the server's quote (`smoke-store`, `smoke-store-route` send a tampered price) |
| Two shoppers can both buy the last unit | **No** — one `BEGIN IMMEDIATE` transaction with a guarded stock update; proven with two processes on one file |
| The `.pzn` backup / live restore carries the store | **Yes** — catalog, orders, settings and the open flip are in the SQLite file; after a restore the store pages and the static site follow (`smoke-store`) |
| The store was verified in a real browser | **Yes, locally** — a scratch site on this machine: flip → shop → filter → options → cart → coupon → checkout → order page → paid/shipped → BenTML apply → phone width. The live site ships it closed; nobody opened a store there |
| Chat context is permanent | **No** — this file and `docs/ROADMAP.md` are the memory |

---

## 12. Update protocol (future agents / future you)

When a real chunk of work lands:

1. Bump **Last updated** and refresh **§2 State of main**.
2. Add the Version Log row in `docs/ROADMAP.md` (+0.01) — the version smoke fails without it.
3. Move anything finished out of **§10**, and add a line to **§11** for anything you verified or chose not to.
4. Commit as `docs: session handoff — <why>` on a branch, and let the PR merge it.

If a conversation dies mid-task: read this file, then `git log -15 --oneline`, then `npm run test:smoke`.

---

## 13. Quick identity

- **Product name users see:** Tapuziel (not “Tapuz” in UI).
- **Org credit:** Shaltiel Industries · made by WhiteNo1se / WhiteNo1s3 on GitHub.
- **Repos:** `WhiteNo1s3/tapuz` (the product), `WhiteNo1s3/tapuziel-crm-lab` (an older CRM lab).

*End of handoff. Prefer updating over inventing history.*
