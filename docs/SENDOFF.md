# SENDOFF — state of the world for the next Claude session

**Written:** 2026-08-10, end of the show-and-tell arc (v2.12 → v2.18.1)
**For:** the next Opus/Claude session picking up Tapuziel with Ben
**Read next:** `docs/DEPLOY.md` (§3ב is the deploy recipe), `docs/ARCHITECTURE.md`,
`C:\DevPerm\grokTapuz\PRODUCT-FEEDBACK-USER-BUILD.md` (worked through, see §4)

---

## 1. What this is

Tapuziel (תפוזיאל, "the orange with the wings") — Ben's Hebrew-first CMS+CRM.
Node 24 + Express + better-sqlite3, file-first page store (`pages/*.pzn`),
56-module BenTML language, visual builder, agent bridge, CRM. Zero-JS
published pages by philosophy. Ben (WhiteNo1s3 / Shaltiel Industries) is a
beginner-startup owner; speak plain Hebrew in UI copy, plain English here.

## 2. The three environments

| Where | What | State |
|---|---|---|
| `<repo>` (+ worktree `.claude\worktrees\startup-website-from-pdf-4f41b1`) | git repo, `main` = truth | develop here, merge --ff-only to main, push |
| `C:\DevPerm\grokTapuz\tapuz-sandbox` → http://localhost:3030 | Ben's KEEPER dev home, a NON-git file copy with its own data (his login, the Grok show-and-tell) | sync code by narrow enumerated node-copy (see §6), NEVER touch its `pages/config/db/content` |
| <live-site> | live Hostinger instance, data pinned to `/home/<hostinger-user>/tapuz-data` via `.tapuz-root` | deploy = archive via `hosting_deployJsApplication` (docs/DEPLOY.md §3ב), builds in ~10-60s |

The old Hostinger **git integration is a trap** — a GitHub App fired a broken
`next` pipeline on every push. It is SUSPENDED (github.com/settings/installations,
2026-08-08). Never unsuspend; archive deploys only.

**Content seed:** `seed/manifest.json` id `show-and-tell-v1.8.1` applies once
per id at boot (armed by the `.tapuz-root` pin or `TAPUZ_SEED=1`). Bumping the
id re-applies `replace:true` pages AND the menu — the menu carries every live
addition (חלון ראווה, showcase) precisely so a re-seed loses nothing. Keep it so.

## 3. What the live site contains

The marketing "מראים ומספרים" site: home + 5 מערכות + השוואות + צרו קשר +
3 articles + **חלון ראווה** (built as a human in the live builder, tells the
"command the AI" story) + **showcase-modules / examples** (Grok's wonderful
40-module tour, ported flawlessly — its 8 images never existed anywhere; they
are now generated art under `/demo`). All 56 modules render somewhere on the
site. Menu has 10 items.

## 4. The arc in versions (all merged to main, all deployed, all synced)

- **v2.13** — builder trio: column handle ON the boundary (physical, no isRtl
  branches), split-extends-row (Camilyo style, cap 4), warm toolbar + citrus
  selection chrome. `_testDrop` hook for deterministic drop tests.
- **v1.8/v1.8.1 seed** — Grok showcase ported (BenTML round-trip proven
  type-exact, 40+5 blocks, 0 errors), pricing demo reworked to wordplay
  (הקליפה vs התפוז השלם — Ben sells nothing, demonstrates the rubric option).
- **v2.14** — grey desk (not navy) via the 6 `--bc-*` tokens (+`--bc-well`,
  `--bc-topbar`); citrus editor theme as a FEATURE (persisted toggle in the
  mode-tabs row); canvas + modals stopped inheriting chrome text (`.canvas`
  and `.modal-content` get `color: var(--ws-text)` — this fixed 161 unreadable
  nodes); revisions panel became operable (kind badges, relative Hebrew time,
  ✓ האחרונה, ESC); narrow-width topbar = two slim rows, actions scroll.
- **v2.15** — חיבור AI screen (`/admin/ai-setup`, nav key `ai-setup`):
  Local AI setting (loopback-enforced), connection test (`/admin/api/ai/test`
  hits the runtime's `/models`), per-provider CREATE-KEY links (`keyUrl` —
  distinct from the paste page, Ben insists), 3 generated tutorial images
  (`/demo/ai-tut-*.jpg`), extension ZIP downloads (`src/zip-store.js`, no deps).
  Copilot button renders ONLY when configured (`aiConfigured` in
  pages-builder.js). Citrus re-oranged (#fed7aa/#fb923c/#c2410c family).
- **BenTML fixes** — mark-brace-aware text bodies (a `}` closing `@B{...}`
  never ends the body), `SPACE(height: 106px)` lossless round-trip.
- **v2.16** — the user-build feedback round (PRODUCT-FEEDBACK-USER-BUILD.md):
  T1 add-vs-replace was already true; logout is `type=button` everywhere
  (Enter can't log out); 📱 רספונסיב renamed **👁 תצוגה חיה** (it was always
  the real renderer + saves first — a naming bug); publish confirm gained the
  placeholder section (compares data to each module's OWN registry seed;
  auxiliary fields like buttonText don't convict); media = one story (root
  listing re-adopts disk drift throttled, virtual read-only `__demo__` folder,
  count line); selection breadcrumb דף › מיכל › טור › מודול + exit button;
  category module says the truth when its tag has no published pages.
- **v2.17** — LM Studio live-fire: local/browser openai-chat bodies send
  `reasoning_effort: 'none'` (Qwen3-family hybrid thinkers otherwise burn the
  whole budget and return EMPTY content; `/no_think` does nothing); copilot
  briefing tells the model to CALL `edit_page`, not print the document.
  Full loop verified: Hebrew ask → tools → pending approval → approved →
  draft changed. Model of choice on Ben's PC: **qwen/qwen3.6-35b-a3b**
  (~170 tok/s; gemma-4-31b-qat = quality alt; gemma-4-12b-qat = light).
- **v2.18/.1** — extension realignment, Ben's strategy: the public LLMs are
  **natural partners** — zero presence on their sites. `extension/` is now a
  popup-only "מלווה ההעתקה": copy [roleplay pack + dictionary + real media +
  the user's typed thought] via `/agent/v1/roleplay?brief=` → user pastes and
  sends THEMSELVES → reply pastes back → `create-from-source` → draft + builder
  link. No content scripts, no host permissions (agent bridge speaks CORS *),
  no background, storage+clipboardWrite only. 639 lines of DOM archaeology
  deleted. Per-browser ZIP builds (manifest at ZIP ROOT — browsers reject
  wrapped folders; chrome build strips gecko keys, firefox build carries them),
  browser-detection chip on the matching button. `extension-v2a` (Bridge V2,
  localhost relay for hosted CMS ↔ LM Studio) untouched — already clean.

## 5. Ben's product principles (violate none)

1. **Human-simple, HubSpot/builder.io depth** — never hide tools, one publish
   concept, plain Hebrew (no החפיר-style words), honest empty states.
2. **The LLM sites are partners** — copy/paste only, the user acts there,
   nothing of ours runs on their pages. No maintenance treadmill, no ToS risk.
3. **Approval gates are sacred** — AI writes stop at the owner's button.
4. **Zero-JS published pages** — CSS-only patterns, self-hosted media
   (published-page CSP is `default-src 'self'`; YouTube+Google Maps frames ok).
5. **Orange.** Dark desk = warm grey; citrus mode = REAL orange, not sand.
   When Ben says colors are off, he's right.
6. **He tests as a user and reports "bugs non stop"** — most are real; the
   rest are stale sandbox code. Check what the daemon actually serves first
   (`curl localhost:3030/... | grep <marker>`).

## 6. Operational gotchas (learned the hard way)

- **Classifier (auto-mode):** bulk writes to `C:\DevPerm` are blocked; chat
  permission does NOT unlock; you may not self-edit settings.local.json.
  NARROW enumerated file copies via a node script pass and are the established
  sandbox-sync pattern. Bulk = Ben clicks Run.
- **Sandbox daemon:** plain background `node src/server.js` gets reaped when
  the wrapper exits. Use the detached spawn (recipe in memory file
  `tapuz-sandbox-daemon.md`). Kill = Ben, PowerShell `taskkill /PID x /F`
  (single slashes; `//` is Git-Bash escaping).
- **Sandbox public/ holds the EXPORTS** (`*.html` at root) — never `/MIR` it;
  a wipe = whole site 404s; regenerate with
  `node -e "require('./src/export').exportAll()"` from the sandbox dir.
- **Sim environment:** launch config `tapuz-sim2` (port drifts upward as
  zombies accumulate — 3210/3213/3214 hold orphaned old-code servers; find a
  free port, edit the launcher + launch.json). Dev login `admin`/`admin` is a
  seeded FIXTURE (fine to use); never touch Ben's real credentials.
- **curl + Hebrew on Windows mangles to `???`** — test Hebrew payloads via
  `node -e` fetch, never inline curl -d.
- **`test:pixel-embed` fails in the worktree only** (the `.claude` dot-dir
  breaks sendFile) — passes on the main checkout. Known, not a regression.
- **Hostinger MCP upload sometimes hangs/404s** — check `hosting_listJsDeployments`
  before assuming success; a short backoff + retry works.
- **launch.json is tracked but drifts locally on main** — `git checkout -- .claude/launch.json`
  before merging.

## 7. Open threads (in rough priority)

1. **Firefox permanent install** — needs AMO signing (free, can be unlisted).
   Until then: about:debugging temporary load (the page says so honestly).
2. **P3 from the feedback doc** — page recipes (דף נחיתה/אודות/מחירון/צור
   קשר/אינדקס), then the new-modules pack: steps, team, download,
   whatsapp-cta, countdown. Ben's own doc says modules come AFTER the UX work
   (done) — recipes first.
3. **Toolbox "מתי להשתמש ב…?" hints** (embed vs video, card/cards/features,
   ticker/newspop/marquee) — feedback §3.3, cheap and useful.
4. **Bridge V2 hosted-CMS flow** — works in code, never live-fire tested
   end-to-end (Ben's local test used the sim's direct local provider).
5. **Guided first-site checklist** after the wizard (feedback P2).
6. The **mission/inject server endpoints** still exist but the new extension
   no longer auto-injects; they're dormant, harmless. Clean up someday.

## 8. Where things are (fast map)

- Builder client: `public/admin-builder.js` (5600+ lines) · styles
  `public/css/admin.css` (tokens at top; `--bc-*` = builder chrome).
- Builder route/shell: `src/routes/pages-builder.js` · AI surfaces:
  `src/routes/copilot.js` (incl. `/admin/ai-setup` + per-browser zips).
- AI: `src/ai.js` (settings store `config/ai.json`, converse tool-loop,
  approval pendings) · `src/providers.js` (roster, loopback policy, keyUrl)
  · briefing `src/pzn/agent-roleplay.js` · tools `src/ai-tools.js`.
- BenTML engine: `src/bentml/` (parse/compile/decompile/keywords; browser
  bundle generated on demand) · pzn side: `src/pzn/`, renderer `src/renderer.js`.
- Media: `src/media.js` (DB-indexed, `__demo__` virtual folder, throttled
  disk adoption) · zips: `src/zip-store.js`.
- Extensions: `extension/` (מלווה ההעתקה, popup-only) · `extension-v2a/`
  (Bridge V2).
- Seed: `seed/manifest.json` + `seed/pages/*.pzn` · engine `src/seed-content.js`.
- Smokes: `scripts/smoke-*.js`, chained in `test:smoke`; the ones you'll
  touch most: `smoke-builder-ux.js`, `smoke-ai-setup.js`, `smoke-extension.js`,
  `smoke-bentml.js`, `smoke-seed.js`.

Everything above is merged, pushed, deployed, and synced. Nothing is half-done.
Have fun — and keep it orange. 🍊
