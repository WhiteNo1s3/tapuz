# Session handoff — Tapuziel (read this if the chat died)

> **Purpose:** survive a lost Claude/Grok/Cursor chat, a crash, or a night's sleep.
> Refresh it whenever a milestone lands or the direction changes (§12).
> **Last updated:** 2026-09-20 — v2.50-alpha (a thinking model gets the lowest reasoning level it allows and one larger-budget retry, `THOUGHT_OUT` says the rest; the Mac script knows LM Studio cannot load a variant by name; before it: `LOCAL_LLM_WINDOW_CAP` — an MLX row can mean 32K; the Mac survey script finds staff picks, resumes downloads and cannot be lied to about its window; before it: `style` is also a real attribute — the dead-styling door only judges CSS declarations; before it: the human dreams D9–D14 and `--briefs=dreams`; styling that does nothing goes back once, and the briefing says where the look lives), live and deploying from main.

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
| Package / ROADMAP | **`2.50.0-alpha`** — the Version Log's top row must name it (`smoke-version`) |
| Main tip | the v2.50 merge — `git log -1 origin/main` |
| Recommended local model | **Gemma 4**, by card: 12–16 GB → 12B (Google's QAT 4-bit), 24 GB → 26B-A4B, 32 GB → 31B; the E-models run the one-shot packs only (`docs/LOCAL-LLM.md` §1א, §5) |
| Live | deploys from `main` on merge; the generator meta carries version + stamp + sha |
| CI | `.github/workflows/security.yml` — gitleaks, the test suite, npm audit (high+, prod deps); Node 24 |
| Version rule | every shipped session is **+0.01** with a Version Log row; docs-only PRs bump nothing |
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

**Ask the runtime what it can do before telling it what to do (v2.50).** Two assumptions died the same day, both about LM Studio: that `reasoning_effort: "none"` switches thinking off (for a model without an "off" level it means the DEFAULT — "high"), and that a variant LM Studio itself prints as `google/gemma-4-31b@8bit` can be loaded by that name (it cannot — not by `lms load`, not by the REST API). `GET /api/v1/models` answers both: `capabilities.reasoning.allowed_options`, `variants`, `selected_variant`. Probe, then act; and when the runtime cannot do what the row needs, the row says so and names the click.

**A check that can never pass gets shimmed (v2.49).** `mlx-survey.sh` demanded `loaded_context_length == 32768`; the MLX engine loads at 262,144 whatever it is asked. The check refused — correctly — and somebody put a fake `curl` on PATH to get past it. Before writing a hard check for a machine you cannot see, find out whether it CAN pass there; make the instrument record what is true (configured → effective → what the battery itself saw) instead of demanding what you hoped; and give a script for another machine a smoke with fixtures from that machine (`smoke-mlx-survey.js`) — it had none, and measured 3 models of 12.

**The door helps a model that is almost right (v2.45).** A document the model PRINTED instead of calling the write tool is adopted as that call — same preflight, same approval card — but only for a page or a menu it READ this turn; a closing tag that almost matches is read as the open element; `E_CHILD` names what the container accepts; a refused proposal followed by plain words gets "nothing was saved" beside it (`docs/LOCAL-LLM.md` §3ב). When a smaller model fails a scenario, run the battery with `--courier=relay` first: the transcript shows what the door told it.

**One LM Studio, two machines.** With LM Link on, `lms unload --all` reaches the other machine and an unknown model name can be served by it. Scripts unload by identifier and stop when someone else's model is on the GPU (`docs/LOCAL-LLM.md` §5).

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
| 2א2 | The MLX rows (the Mac node) | The recommendation per card is 5090 **GGUF Q4** numbers. The Mac (128 GB) answers two questions the PC cannot: do more bits change the verdict (8-bit against 4-bit MLX of the same Gemma), and is a model that does not fit a 32 GB card the better helper (gpt-oss-120b, Mistral Small 4 119B, Qwen3-Coder-Next). One command there: `bash scripts/mlx-survey.sh` — fifteen models, fixed, dreams first; the orders and the cluster rules (main is the sync point, one owned path, one PR at the end, only `tapuz-mlx-*` models are its own) are `eval/battery/RUN-ON-MAC.md`. Results come back as `eval/battery/SCORECARD-<date>-mac-mlx.md`. Its first night (2026-09-20) measured 3 of 12 models, mislabelled — the map is `eval/battery/BREAKAGE-2026-09-20-mlx-survey.md`, the fix is v2.49: the MLX engine loads at 262,144 whatever is asked, so the CMS budgets at 32K itself (`LOCAL_LLM_WINDOW_CAP`) and every row records configured → effective → what the battery's own probe saw; the recommended models get one more row uncapped. `scripts/smoke-mlx-survey.js` verifies the script without MLX. Still NOT verified on MLX: the re-run. A 7/13 measured there on 2026-09-19 was withdrawn: an interrupted battery had left its server on the port, so the run talked to yesterday's site and judged a fresh one — the battery now refuses an occupied port. |
| 2ב | The battery over the real extension | `--courier=relay` plays the Bridge from Node. The same thirteen sentences through Chrome + Bridge V2 would also cover the stream accumulator (does LM Studio's mid-stream pool error reach the page as `WINDOW_SHARED`?). Never against production: the battery approves its own proposals, and an approved menu is LIVE. |
| 2ג | What the model survey left open | The survey is done (`docs/LOCAL-LLM.md` §5: the QAT builds of the big sizes, Dicta's Hebrew models, gpt-oss-20b, and the dreams track per model). Three habits it found that the tool loop does not answer yet: **(a) silence after a read** — gemma-4-26B-A4B (its QAT build most of all) sometimes returns an empty reply right after `read_page`; one "you read the page — now answer" retry is the untried idea. **(b) a printed tool CALL** — DictaLM-12B writes `{"name": "read_page", "arguments": …}` as text; v2.45 adopts a printed *document*, not a printed call. **(c) the runtime's own parse error** — gpt-oss-20b loses about one turn in six to LM Studio's `500 … does not match the expected peg-native format` (with the six-tool request; none with the lean four-tool one); asking again works, the copilot does not retry. None of the three models is a recommendation, so none of this is urgent. |
| 2ו | A picture slot the owner can fill | With an empty library the copilot now builds WITHOUT images. What an owner may want instead is a slot: an image module with no source that the builder shows as "choose a picture" and the published page simply omits. Today the renderer prints `<img src="">` for an empty source — a product decision (renderer + builder), not a door. |
| 2ה | Read-before-edit, enforced | The briefing says "חובה לקרוא דף לפני שעורכים אותו"; only the v2.45 ADOPTION enforces it. A real `edit_page` call for a page the model did not `read_page` this turn still reaches the card (battery T6, gemma-4-26B-A4B: the paragraph beside the edited heading vanished). Send it back once ("קרא/י את הדף קודם"), like `PAGES_LOST`; the scripted smokes that edit without reading need a `read_page` first. |
| 2ד | The E-models in the copilot | gemma-4-E2B/E4B *describe* the tool they are about to call and stop (12–13/26). The packs work on them; the copilot does not. A nudge ("you said you would call read_menus — call it") is the untried idea. |
| 2ט | A thinking model — what is left after v2.50 | Done: the lowest reasoning level a model ALLOWS (`/api/v1/models`), one larger-budget retry on every courier, `THOUGHT_OUT` when that is not enough (Muse-Glimmer: organizer 2/27 → 27/27). Left: (a) over the **browser courier** the server cannot probe the owner's runtime, so that path still sends "none" and leans on the retry — the page could send the level with its window hint (a Bridge change); (b) Muse still stops at the hop limit on "update the hours wherever it belongs" (it reads page after page looking for hours that are nowhere) — a manners problem, not a budget one; (c) whether Muse becomes a recommendation for 24 GB cards is Ben's call — it is slower than Gemma at the same memory even at "low". |
| 2י | What else the human survey left | (a) **The 24 GB recommendation**: on owner sentences the 12B QAT (25/28) is at least the 26B-A4B's equal (22/28) — LOCAL-LLM §1א now says so; Ben decides whether the product's setup screen follows. (b) **Qwen 3.5 9B** (11/14, 7.5 GB) is the first small model that drives the copilot — Ben's "we recommend Gemma 4" has no Gemma for that card. (c) **Qwen 3.8 + the LITE paste pack + a human brief**: four of five refused by the door; the pack is one line per tool and a vague brief leaves more to invent. (d) **Granite's tokenizer**: the compact briefing is 8,314 tokens for it — no 8K mode; the CMS says so correctly. (e) The 26B-A4B's **silence** (2ג a) now also ends the pasted-document dream: `EMPTY_REPLY` on both runs. |
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
