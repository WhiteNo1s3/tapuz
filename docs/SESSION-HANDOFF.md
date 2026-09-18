# Session handoff — Tapuziel (read this if the chat died)

> **Purpose:** survive a lost Claude/Grok/Cursor chat, a crash, or a night's sleep.
> Refresh it whenever a milestone lands or the direction changes (§12).
> **Last updated:** 2026-09-18 — v2.43-alpha, main at `dbdaf30`, live and deploying from main.

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
| Package / ROADMAP | **`2.43.0-alpha`** — the Version Log's top row must name it (`smoke-version`) |
| Main tip | `dbdaf30` |
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

Opt-in, not in CI: `node scripts/smoke-bridge-reload.js` needs a real Chrome (`CHROME=…`, and `SMOKE_LM_PORT=1299` to run beside a live model runtime).

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
| 2 | The compact briefing's safety net | The injection-awareness rule is full-tier only — the compact tier sits at the edge of an 8K window (`smoke-ai-window`). Its net is the server-side scrub. |
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
