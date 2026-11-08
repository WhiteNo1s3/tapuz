# Live Hostinger + Bridge V2 — how to test (2026-09-21)

A Cloud Agent pass on 2026-09-21. **No Hostinger terminate, recreate, or deploy of the live addon.** Recreate of the live addon remains a later turn, and only after Ben has a whole-site `.pzn` **and** an explicit yes in that conversation.

A **second** pass the same day created a **new** Hostinger Node.js lab addon (same Cloud Economy order, free preview hostname, git auto-deploy from `WhiteNo1s3/tapuz` `main` / `d44c9e7` / 2.52). It does not share the live `TAPUZ_ROOT`. Details: [`docs/HOSTINGER-LAB.md`](HOSTINGER-LAB.md). Hostnames live in walkthrough artifacts, not this repo (`.gitleaks.toml`).

The public repo must not name the preview hostname (`.gitleaks.toml`). The live URL is the Hostinger Node addon Ben already uses; walkthrough artifacts from this pass hold the hostname and the files.

## What is actually live (do not recreate from this branch)

| Surface | This git branch (`cursor/battery-copilot-2-45-scorecard-198e`) | Live Hostinger addon |
|---|---|---|
| Package | `2.45.0-alpha` | **`2.52.0-alpha`** |
| Code | this PR (scorecard / battery docs) | `origin/main` tip `d44c9e7` (merge of PR #38, 2026-09-20T20:14:56Z) |
| Generator meta | n/a (not deployed) | `Tapuziel 2.52.0-alpha+20260920-201525Z.d44c9e7` |
| Hostinger | — | Node.js addon, enabled, Node **24**, `app_type` express, `entry_file` `src/server.js`, `build_script` `build`, git auto-deploy from `WhiteNo1s3/tapuz` **`main`** |

The homepage *copy* still says "גרסה נוכחית: v2.12-alpha" in a banner. That is page content, not the CMS build. The fingerprint that matters is `<meta name="generator">`.

**A recreate/deploy from this 2.45 branch would down-grade the live site.** If a recreate is ever wanted, it must be from current `main` (2.52+), after the `.pzn` is in Ben's hands, after an explicit yes.

The live process is Express (`x-powered-by: Express`), Hostinger panel/hcdn in front. Homepage and `/admin/login` returned HTTP 200 on 2026-09-21. `/admin` redirects to login. Admin APIs without a session return `{"ok":false,"error":"לא מחובר"}` (401) or 302 to `/admin/login`.

## Two product doors that "save the site as PZN"

The game is ".pzn is our RPM". There are **two** admin-only doors. Neither is a scrape.

1. **Pages / theme / menus package (JSON, format `tapuz-site`)**
   - Owner: **הגדרות אתר** → `/admin/settings` → **⬇ ייצוא האתר**
   - HTTP: `GET /admin/api/site-package/export` (cookie `tapuz_sess`, `requireAdmin`)
   - Bytes: `src/site-package.js` `exportSitePackage()` — every page's draft + published `.pzn` source, theme overrides, menus, and a non-secret config subset (`title`, `description`, `language`, `logo`, `seo`, `homepage`). Never `admin.path`, never SMTP/AI keys.
   - Filename the product writes: `tapuz-site-YYYY-MM-DD.json`
   - Import: paste JSON on the same settings card (`POST /admin/api/site-package/import`). Default **skips** colliding pages; overwrite is an explicit checkbox.

2. **The database as `.pzn` (SQLite snapshot — this is the file that is actually named `.pzn`)**
   - Owner: **אחסון** → `/admin/storage` → **ייצוא .pzn**
   - HTTP: `GET /admin/db/export.pzn`
   - Bytes: `VACUUM INTO` (`src/db.js` `snapshotTo`), stamped `application_id = 0x5450555A` (`TPUZ`). One file, nothing chunked.
   - Filename the product writes: `tapuziel-db-YYYY-MM-DD.pzn`
   - Restore: same storage card, upload (streams the body; refuses a healthy-but-foreign sqlite with `not_a_tapuz_db` before touching live data).

This Cloud Agent **could not log in** to the live admin (no `config/auth.json`, no admin password in the Cloud env, 1Password MCP in error, Hostinger env-var values are masked). Live `GET /admin/api/site-package/export` → 401; live `GET /admin/db/export.pzn` → 302 `/admin/login`.

**What Ben should click on the live site, once, before any recreate talk:** log in → download **both** files above. Keep the `.pzn` extension on the database snapshot. That is the product saving itself.

**What this pass proved without live auth:** a scratch CMS in the VM, real login, both HTTP doors. The `.pzn` was SQLite 3, `application_id` TPUZ. `npm run test:site-package` (module round-trip, draft vs published not collapsed) **PASS**. Those files are walkthrough artifacts, named `local-scratch-*` so they are not mistaken for the live site. A public-HTML zip of the published pages is a **fallback scrape**, not a site-package.

## Bridge V2 (latest in this repo and on `main`: **0.5.5**)

Source: `extension-v2a/` (`manifest.json` and `content-bridge.js` both `0.5.5`; the smoke pins they agree). `origin/main` is the same 0.5.5, so the live 2.52 ZIP is this version.

**Preferred install (owner, Windows Chrome, against the live origin):**

1. Log into the live admin.
2. **חיבור AI** `/admin/ai-setup` → card **Bridge V2** → **⬇ ל-Chrome / Edge** (`GET /admin/ai-setup/extension-bridge-chrome.zip`). That ZIP is built by `src/extension-build.js` and **already wired** to the host it was downloaded from (`src/bridge-manifest.js`: `content_scripts` + `host_permissions` for `*://<that-host>/*`). Manifest sits at the ZIP root (no wrapping folder).
3. Unzip **outside** any git checkout.
4. `chrome://extensions` → Developer mode → Load unpacked → that folder (or drag the ZIP). Edge is the same.
5. Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `manifest.json` (temporary until AMO signing).

**Developer copy (same bytes as the ZIP):** `npm run bridge:update -- --site <the live host>` writes `~/Tapuziel Bridge/extension` plus `Update Bridge.command`. Never load `extension-v2a/` from a checkout — the tracked manifest names no site on purpose.

This VM cannot install an extension into Ben's Windows Chrome. A Chrome-wired ZIP was built here as a smoke of the zip (manifest 0.5.5, host already granted). Loading it in *this* VM's browser would still not reach Ben's LM Studio.

## Owner loop (this is the product — not a new network hack)

```
live admin page  --postMessage-->  Bridge content script  -->  background worker  --fetch-->  LM Studio 127.0.0.1:1234
(hosted CMS, has internet)         (opt-in per origin)          (tokens stay on the PC)
```

The Hostinger process **cannot** see `127.0.0.1:1234` on the Windows box. The admin page cannot either (LM Studio returns no CORS headers; Chrome Private Network Access would also block). Only the extension worker may. Provider in the CMS is **"מקומי — דרך הדפדפן (Bridge V2)"** / `browser`, not the server-side `local` box (that box is loopback-only by design).

On the Windows GPU PC (internet **required** so Chrome can open the live admin):

1. LM Studio: model loaded, Developer → **Start Server** on port **1234**. Context length **32768**, Max Concurrent Predictions **1**. Do **not** run `lms unload --all` (that command can reach another machine via LM Link).
2. Chrome: Bridge 0.5.5 installed from the live `/admin/ai-setup` ZIP (step above). Refresh the admin. Popup → the live origin should already show as connected (*מההורדה*). If it does not: **"חבר את האתר הפתוח"** and approve the host permission.
3. `/admin/ai-setup` → pick the loaded model → **חבר דרך הדפדפן**.
4. Copilot (`/admin/chat`) and **▶ הרץ עם ה-AI המחובר** on inject/menus then send `modelCall` envelopes; the page relays them; the site never holds the GPU.

LM Studio does **not** need a cyan origin allowlist. The worker talks to loopback only. The origin grant is the extension's, not LM Studio's.

## What the "lab test" docs get wrong on a Windows PC with no internet

Those notes were written as if the CMS and the model share a machine, or as if Claude Code on that PC can reach the hosted site. A box with **no internet** cannot open the live Hostinger admin, cannot download the Bridge ZIP from it, and cannot be the Bridge client. What those docs actually measure:

| Doc / path | What it assumes | Breaks without internet / off-box |
|---|---|---|
| `docs/LOCAL-LLM.md` §1–2, provider **מודל מקומי** | CMS process `GET`s `http://127.0.0.1:1234/api/v0/models` and `/v1/chat/completions` | True only when CMS **and** LM Studio are the same machine. On Hostinger the server-side probe never sees the 5090. |
| `docs/LOCAL-LLM.md` §1א window probe | Trusted window from LM Studio's native `/api/v0/models` | Hosted path: the **Bridge** makes that GET (since 0.5.0) and the page sends `window` with the turn. No bridge → advisory 24K, compact tier, never full dictionary. |
| `npm run eval:inject`, `docs/INJECTION-EVAL.md` | `LOCAL_LLM_BASE=http://127.0.0.1:1234/v1`, provider cms, server-side | Measures the local courier against a scratch/local CMS, not Bridge on the live origin. |
| `npm run battery:copilot` without `--courier=relay` | Same: the spawned scratch CMS calls the model itself | `--courier=relay` is the hosted shape (page plays the extension). Still needs a CMS the battery can spawn, not the live Hostinger login. |
| `docs/LOCAL-LLM.md` §1ו / `scripts/lmstudio-probe-shim.js` | llama.cpp has no `/api/v0/models`; the shim fakes the probe | Harness only. Product answer for "not LM Studio" remains compact/advisory. |
| `docs/USER-TEST-1.md` | Sister walkthrough of the **builder UI** on a running CMS | Does not measure Bridge, window, or inject. Needs a CMS in the browser; the live site needs internet. |
| `ai-qa/` (gitignored), Claude Code "lab" notes | Local checkout + local model | Cannot hit the hosted CMS or download models/ZIPs if the PC is offline. |
| SESSION-HANDOFF "One LM Studio, two machines" / `lms unload --all` | LM Link can unload a model on the **other** machine | Out of scope here; never run `lms unload --all` against Ben's 5090. |

**What the cyan + Bridge loop actually measures:** briefing composition and doors on the hosted CMS (the site has internet); token generation on the owner's GPU via Bridge `modelCall` / `step`; window hint from `/api/v0/models` through the extension; copilot + inject **▶** with provider `browser`. No tunnel, no `lms` from this VM, no Hostinger-side GPU.

## Recreate (stopped)

Ben allowed a Hostinger terminate/recreate **only after** a whole-site PZN, and Hostinger destructive MCP requires an explicit **yes** in that conversation. This pass saved what it could, then **stopped**. No `hosting_deployJsApplication`, no `hosting_createNodeJSBuildFromArchiveV1`, no `hosting_deployStaticWebsite`, no delete/restart/PHP/DB tools.
