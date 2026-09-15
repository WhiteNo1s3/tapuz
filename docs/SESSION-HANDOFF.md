# Session handoff — Tapuziel (read this if the chat died)

> **Purpose:** Survive lost Grok/Claude/Cursor chats, sleep, crashes.
> Update this file whenever a big milestone lands or direction changes.
> **Last updated:** 2026-09-15 (v2.33.2-alpha — the repo went PUBLIC; history rewritten).

---

## 0. Where to work (worktrees)

| Path | Branch | Role |
|------|--------|------|
| `<repo>` | `main` | **Main gig — Tapuziel CMS** (`WhiteNo1s3/tapuz`) |
| `<handoff-worktree>` | `session/handoff` | Crash-recovery worktree (same tip as main when created) |
| `<crm-lab-repo>` | `main` | CRM lab prototype (`WhiteNo1s3/tapuziel-crm-lab`) |
| `<crm-lab-worktree>` | `lab/continue` | Older lab worktree (may lag main) |

```bash
# Resume Tapuz main
cd <repo> && git pull && npm run qa:quick

# Resume from this handoff worktree
cd <handoff-worktree> && git fetch && git merge origin/main
```

**Product rule:** Tapuz main is the source of truth. Lab ideas return *rebuilt*, not raw-merged.

**Language rule:** **Hebrew first, English later** — product UI, owner docs, and cookbooks. Same maker / same company (Shaltiel Industries · WhiteNo1se): CMS + CRM + lab are one family of apps.

---

## 1. Product north star

**Tapuziel** (תפוזיאל) — Hebrew-first RTL CMS with visual builder, `.pzn`, agents, and growing CRM/WhatsApp surfaces.

**Two-product competition story (Ben):**

1. **Tapuziel CMS** — beat Elementor / theme grind (authoring).
2. **Tapuziel CRM** — pixel + contacts + messaging that can ride **on** WordPress/Builder until sites migrate.

Hostinger WP sandbox (portfolio):  
`https://<wp-sandbox>`  
- Site title **WhiteNo1se**, Elementor + Pro, **Coming Soon** when logged out.  
- Themes: WhiteNo1se Child (active), Grokskin, Paz Sketch, PazView, …  
- **Tapuziel Pixel plugin was NOT installed there** when last checked.  
- Its admin password is not in this repo and must never be.

**Brand:** citrus orange `#f97316` / `#ea580c`, fruit icon (`public/tapuziel-icon.png` on lab; extension icons on main), credit **Shaltiel Industries · made by WhiteNo1se**.

---

## 2. Git tips (as of handoff write — 2026-09-15)

### Tapuz main (`WhiteNo1s3/tapuz`) — **now a PUBLIC repo**

| | |
|---|---|
| Repo | `WhiteNo1s3/tapuz` — name unchanged, **public** since 2026-09-15, MIT |
| Tip when handoff written | `c719acf` — *Merge pull request #101 … cloud-agent-docs* |
| Package version field | **`2.33.2-alpha`** |
| Branches | `main`, plus a stale `cursor/chrome-whatsapp-modules-8704` (2 ahead, 89 behind) |
| Tags / releases | **none** — the version lives in `package.json` + the ROADMAP Version Log |
| CI | `.github/workflows/security.yml` — gitleaks + `test:pzn` + `test:smoke` + registry + wizard + audit high+ |
| Automerge | `.github/workflows/automerge.yml` lands **any** PR the moment `security` goes green — open a **draft** PR if you do not want that yet |
| Node in CI | **24** (`engines` says `>=24`) |

**The history was rewritten for the public push.** Every commit kept its content
but got a **new hash**; the scrub removed a hosting account id, a personal
mailbox, machine paths and a 1.1 MB `tapuziel-skeleton.zip`. Two consequences a
future agent will trip over:

- **PR numbers in commit subjects are dead links.** `#101`, `#72`, … belong to the
  pre-public repo. The public repo has no PRs of its own yet.
- **Any old local clone has diverged.** Its `main` is not an ancestor of the new
  one. Re-clone rather than merge.

`.gitleaks.toml` now carries custom rules so CI **refuses** the hosting account id
(`u` + 9 digits) and a `*.hostingersite.com` hostname. Placeholders like
`example.hostingersite.com` are fine; the real one is not.

### CRM lab (`WhiteNo1s3/tapuziel-crm-lab`)

| | |
|---|---|
| Tip | `c1682fc` — ROUTE-MAP regen (fixed CI drift after pixel routes) |
| Pixel embed | `docs/PIXEL-EMBED-SPEC.md`, `/tz-pixel.js`, WP plugin under `integrations/wordpress/tapuziel-pixel/` |
| Live wire proof | `npm run test:pixel-live` (Builder + WP **shaped** beacons → `crm_events.site_id`) — **not** a real WP activation |
| Branding | Lab admin shell uses Tapuziel icon + Shaltiel credit |
| Caveat | Not re-checked at this handoff write — the lab is a separate repo, treat the row above as of 2026-07-26 |

---

## 3. What was built / decided this multi-session arc

### A. CRM lab (then partly ported to main)

- Contacts, lists, campaigns, pixels, CAPI, GA MP, segments, social gadget, CS chat, enterprise pixel.
- **WhatsApp Cloud API spike (lab):** `docs/WHATSAPP-SPEC.md`, `src/crm/whatsapp*.js`, send + webhook + opt-in.
- **Pixel embed (any CMS):** golden path `tz-pixel.js` + CORS collect + `site_id`; thin WP plugin + Builder README.
- Lesson: **one deep integration at a time** (don’t ship four toys before the spine works).

### B. Tapuz main (current focus)

WhatsApp phases W0–W3 (config/ledger/webhook/send), CRM phases on main, CS widget, premium DB, restore-as-.pzn, etc.  
**Do not re-port lab blindly** — main has its own modules (`wa-ledger`, `wa-send`, `wa-webhook`, smokes).

**v2.10 (named customers + portal):**
- Dual lifecycle: provisional ghosts short path; **named/reachable** → erase only after `namedQuietDays` (default **365**) or owner delete (`0` = never auto).
- List: `?kind=real` + «אמיתיים» tile; last-seen on rows.
- Portal: `src/crm/portal.js` + `src/routes/portal.js` (`/account/*`); flags `crm.portal.enabled` + `allowSelfRegister` **both default false**. Owner mints from contact card (`POST /admin/crm/:id/portal`). Cookie `tapuz_portal` ≠ admin. Privacy UI owns cards + portal.

**v2.12 (enterprise expand spine — Ben: not a closed script):**
- `src/crm/hooks.js` — bus for verticals; core emits stable event names.
- `src/crm/attrs.js` — open namespaced attributes on contacts; public → portal.
- `events.registerType` / open slugs — timeline not a sealed enum.
- Restaurant (etc.) packages: `hooks.on(...)` + `attrs.define(...)` + custom event types — **no second identity system, no CRM fork**.

### B2. v2.13 → v2.33.2 — the arc this handoff had missed (written 2026-09-15)

The handoff stood still at v2.12 while ~21 sessions shipped. Grouped, newest last;
every full row lives in `docs/ROADMAP.md`.

| Arc | Versions | What it means |
|-----|----------|----------------|
| **BenTML at every door** | v2.15 → v2.20 | AI connection settings + extension downloads; the user-build feedback round; local hybrid-thinkers made to ANSWER and the copilot to CALL; the copy-companion extension (per-browser builds, AMO "we collect none"); inline HTML becomes marks instead of a build failure; then **one extractor** (`src/bentml/extract.js`) at every door — a fenced or `<html>`-wrapped LLM reply can no longer land in a `.pzn`. |
| **Themes become artifacts** | v2.21 → v2.27 | The theme LIBRARY (the WordPress attitude), effects as part of the theme, master-page chrome, the theme **STUDIO**, the bench, the `.bent` theme dialect (a theme is BenTML too), then the studio redone with the effect guard + misfire matrix so nothing leaks. |
| **The owner’s own model does the work** | v2.28 → v2.30 | The menu that never breaks + the Menu Organizer **injection**, the injection runner and a local-model eval loop; **Bridge V2** so the hosted site drives the owner’s own model; `tapuz-worker`, a pack that runs with nothing open. |
| **Admin + builder polish** | v2.31 → v2.33.2 | The site’s theme stops reaching the admin; the copilot fits its window, keeps its thread and builds beside you; the builder tour shows **once**, is modal and the status oval is gone; every admin asset URL carries a build stamp so a deploy actually reaches the browser. |

Two guards were added along the way and both are in `npm run qa`:

- `scripts/smoke-version.js` — the **version rule**, enforced. An agent PR once bumped
  2.31 → 3.32; now package.json, the lockfile, the README line, the ROADMAP current
  line and the Version Log’s top row must agree, and the newest step must be +0.01.
- `.gitleaks.toml` custom rules — see §2.

**Known gap, not invented here:** the Version Log has **no rows for v2.12 → v2.19**
(it jumps from v2.20 straight back to v2.11). Those sessions shipped — the commits
name them — but their rows were never written. `smoke-version` only judges the newest
step, so the gap does not fail CI. Fill it from `git log` if you ever want the log whole.

### C. Explicitly parked

- **Israeli invoicing** (Green Invoice / iCount / Rivhit, חשבונית מס vs קבלה, allocation numbers) = **finance surface**, own round later. Not CRM.

---

## 4. QA — one command (do this first after crash)

```bash
cd <repo>
npm install          # if node_modules missing; allow better-sqlite3 native build
npm run qa           # full report (~70s) — mirrors CI + CRM/WA spots
npm run qa:quick     # faster path (~7s)
```

**Green at this handoff write (2026-09-15, every gate):** `test:pzn` 158/158 ·
`test:smoke` 144 packs · registry · wizard · CRM/WA spot 16/16 · route-map in sync ·
version rule · `npm audit` (prod, high+) clean.

Script: `scripts/qa-checklist.js`  
Report gates: `test:pzn`, `test:smoke`, registry, wizard, CRM/WA spot (7), route-map, npm audit high+.

```bash
# Lab only if needed
cd <crm-lab-repo>
npm run test:pixel-embed
npm run test:pixel-live
npm run test:crm
```

---

## 5. Important paths (Tapuz main)

| Area | Path |
|------|------|
| Server assembly | `src/server.js` |
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

## 6. Progressive customer cards (shipped this session)

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

Full Hebrew cookbook: **`docs/SMTP-PRODUCTION.md`**.

### Housekeeping the public move left behind

| # | Item | Notes |
|---|------|-------|
| A | Version Log rows **v2.12 → v2.19** are missing | See §3.B2. The commits name them; the rows were never written |
| B | Stale branch `cursor/chrome-whatsapp-modules-8704` | 2 ahead / 89 behind main — rebase what is worth keeping, then delete |
| C | Commit subjects cite **pre-public PR numbers** | Nothing to fix in history; just do not chase the links |
| D | Node | `engines` wants **24**; CI runs 24. QA also passes on 22, do not rely on it |

### Product

| # | Next step | Notes |
|---|-----------|--------|
| 1 | Real SMTP on staging | Follow SMTP-PRODUCTION.md (Gmail / SES / Resend / cPanel) |
| 2 | Pixel on real WP | Hostinger WhiteNo1se + public CRM `site_id` |
| 3 | Production campaign → live segment | Consent + unsubscribe war story |
| 4 | OSS packaging | CONTRIBUTING, release, paid support SKU — **the repo is public now, so this is live** |
| 5 | Premium / support (sales = father) | Free core; money on support/hosting/modules |
| 6 | Israeli invoicing | Separate finance round |
| 7 | English product surface | Only after Hebrew is solid |

**Company:** Ben builds (behind the scenes). Father sells (face). OSS community + paid support. Long exit optional.

Avoid: multi-feature sprawl; pushing secrets; claiming WP/Builder verified without browser/CMS install.

---

## 11. Honesty log (don’t overclaim)

| Claim | Truth |
|-------|--------|
| WP Hostinger explored | **Yes** — logged into admin, themes/plugins/pages listed |
| Tapuziel Pixel live on that WP | **No** |
| Builder.io space tested | **No** — recipes + HTTP wire only |
| Pixel `site_id` → CRM | **Yes** via `test:pixel-live` simulated Origins |
| Tapuz CI green after QA tooling | **Yes** at handoff write |
| body-parser ≥ 1.20.6 | **Yes** |
| Chat context permanent | **No** — **this file is the memory** |
| Repo is public | **Yes** — `WhiteNo1s3/tapuz`, created public 2026-09-15, MIT, name unchanged |
| History rewritten for that push | **Yes** — every commit has a new hash; content identical apart from the scrub |
| Scrub reached the whole history | **Yes** — no hosting account id, personal mailbox or skeleton zip anywhere in the new history |
| Old PR numbers in commit subjects | **Dead** — they belong to the pre-public repo |
| Tags / releases on the public repo | **None** |
| v2.12–v2.19 Version Log rows | **Missing** — those sessions shipped, the rows were never written |
| QA green at this handoff write | **Yes** — `npm run qa`, all gates (see §4) |
| This handoff verified against the repo | **Yes** — §2, §3.B2, §4, §10, §11 re-checked 2026-09-15; §5–§9j left as written |

---

## 12. Update protocol (future agents / future you)

When you finish a real chunk of work:

1. Bump the **Last updated** date at the top.
2. Refresh **§2 Git tips** (commit hash + one-line version log).
3. Move done items out of **§6 Open/next** into **§3 What was built**.
4. Add any new **Honesty log** lines.
5. Commit: `docs: session handoff — <short why>` and push `main` (or update `session/handoff` then merge).

If the conversation dies mid-task: read this file first, then `git log -15 --oneline`, then `npm run qa:quick`.

---

## 13. Quick identity

- **Product name users see:** Tapuziel (not “Tapuz” in UI).
- **Org credit:** Shaltiel Industries · made by WhiteNo1se / WhiteNo1s3 on GitHub.
- **Repos:** `WhiteNo1s3/tapuz` (main, **public**), `WhiteNo1s3/tapuziel-crm-lab` (lab).
- **Repo name:** `tapuz` — short name for the repo, `tapuziel` for the package and the product UI. Unchanged by the public move.

*End of handoff. Prefer updating over inventing history.*
