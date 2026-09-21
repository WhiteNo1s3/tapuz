# Hostinger lab addon — professional testing (2026-09-21)

A Cloud Agent pass created a **new** Hostinger Node.js addon for Tapuziel so professional tests do not touch the live addon. The public repo must not name Hostinger preview hostnames or hosting account ids (`.gitleaks.toml`). Walkthrough artifacts from this pass hold the lab URL, the Hostinger username, and the screenshots.

## Slot count (what the API actually showed)

Ben said he has **5 Hostinger slots**. The Hostinger websites list and orders list (read-only) showed this **before** the lab was created:

| Plan (order) | Sites on that order | Types |
|---|---|---|
| Cloud Economy (`cloud_economy_v3`) | 2 | WordPress **main** (Hostinger preview hostname) + live Node.js **addon** |
| Business (`hostinger_business`) | 1 | WordPress **main** (custom domain, different hosting user) |
| **Account total** | **3** | 1 Node.js + 2 WordPress |

Hostinger's published Cloud limits (2026) are **100 websites** and **10 Node.js apps** on Cloud Economy, not 5. The lab create succeeded, so a free website slot existed either way. After create: **4 websites** on the account (3 on Cloud Economy, 1 on Business). Node.js on Cloud Economy: **2 of 10**.

The billing subscriptions MCP timed out; capacity above is from `listOrders` + `listWebsites` plus Hostinger's public plan table. Nothing was purchased.

## What was created (lab)

| | Live addon (cyan — do not touch) | Lab addon (this pass) |
|---|---|---|
| Role | production CMS | empty professional-test copy |
| Kind | Node.js addon, already running | **new** Node.js addon on the **same Cloud Economy order** |
| Hostname | Hostinger `*.hostingersite.com` preview (named only in artifacts) | a **different** free `*.hostingersite.com` from `generateAFreeSubdomain` |
| Git | `WhiteNo1s3/tapuz` **`main`**, auto-deploy on | **same repo, same branch, same GitHub App installation** attached to the second site |
| Node | 24, `app_type` express, `entry_file` `src/server.js`, `build_script` `build` | identical |
| Data dir | live `TAPUZ_ROOT` (sibling `tapuz-data` under the hosting home) | **`TAPUZ_ROOT` = sibling `tapuz-lab-data`** so the lab cannot open the live SQLite |
| First HTTP | homepage 200, generator `2.52.0-alpha+20260920-201525Z.d44c9e7` | homepage **200** after owner wizard (title `TINKERiNG TApuZ`); `/admin/login` 200; `/admin/create-account` 302 → login |
| Code | `origin/main` `d44c9e7` (PR #38) | **same commit**, build stamp `2.52.0-alpha+20260921-163623Z.d44c9e7` |

Hostinger **can** attach the same GitHub repo to a second site. This pass did that (`Update Git auto-deployment settings` + `Start Node.js build` with `source_type=git`, branch `main`). A push to `main` will auto-deploy **both** addons. To pin the lab to another branch later, change git settings on the **lab** only.

## Version stamp (lab)

Build log (Hostinger Node build, completed):

```
tapuziel@2.52.0-alpha build
[build] fingerprint 2.52.0-alpha+20260921-163623Z.d44c9e7
```

Commit cloned: `d44c9e7e93c618e3c5242f6fa23c691f4d4775cc` (`Merge pull request #38`).

Published homepage `<meta name="generator">` is `Tapuziel 2.52.0-alpha+20260921-163623Z.d44c9e7`. The running process is still this build: `/css/admin.css?v=5ab3853112` is the first 10 hex chars of `sha1("2.52.0-alpha+20260921-163623Z.d44c9e7")`. `Last-Modified` on `GET /`: `Mon, 21 Sep 2026 16:58:41 GMT`.

Live cyan generator (GET `/` after the lab create — **unchanged**): `Tapuziel 2.52.0-alpha+20260920-201525Z.d44c9e7`. `Last-Modified: Sun, 20 Sep 2026 20:15:29 GMT`. Cyan git auto-deploy still `WhiteNo1s3/tapuz` `main`. Cyan's latest Node build is still the 2026-09-20 `d44c9e7` deploy. No cyan restart, delete, or deploy was called.

## Owner setup (done)

The lab **has a first admin**. `GET /admin/create-account` 302 → `/admin/login`. The seed-dev-admin script **refuses** `NODE_ENV=production` and was not run. No password is recorded here.

**Wizard done.** `GET /` is **200**. Published homepage title `TINKERiNG TApuZ` (Hebrew-first public pages: דף הבית / אודות / צור קשר / מאמרים). Runtime logs still show the boot-time line `אין עדיין חשבון מנהל` from the 16:36 deploy because Node was **not** restarted after owner setup — setup writes SQLite/config under `TAPUZ_ROOT`; a restart is not required.

A later agent pass (same day) attempted authenticated whole-site save (`GET /admin/api/site-package/export` and `GET /admin/db/export.pzn`) but **did not obtain an admin session**: same-origin Chrome form POST to `/admin/login` returned `?err=1` (`verifyLogin` reject). Not CSRF (no token; Origin matched). No 2FA in this product. Stopped before LoginGuard lockout. Unauthenticated `GET /admin/` 302 → login. Public homepage + login screenshots are in Cloud Agent artifacts, not this repo.

## Bridge 0.5.5 vs two origins

Repo and live ZIP are still **Bridge V2 0.5.5**. The extension grant is **per origin**. Connecting the live addon does **not** grant the lab.

On Windows Chrome (LM Studio on 1234, do **not** `lms unload --all`):

1. Open the **lab** admin (after owner setup), not the live addon.
2. Preferred: **חיבור AI** → Bridge V2 → download the Chrome ZIP **from the lab**. That ZIP is already wired to the host it was downloaded from.
3. Or, in the already-installed 0.5.5 popup: **חבר את האתר הפתוח** and approve the new origin.
4. Provider in the CMS: **מקומי — דרך הדפדפן (Bridge V2)** / `browser`.

## What this pass did **not** do

- No Hostinger purchase (`billing_createPurchaseOrderV1`, `billing_renewSubscriptionV1`, `domains_purchaseNewDomainV1`, `VPS_purchaseNewVirtualMachineV1`). The lab is an addon on the existing Cloud Economy order plus a free preview hostname.
- No DNS change on any custom domain.
- No delete, restart, redeploy, env replace, or git-settings write on the live Node addon.
- No WordPress changes on the Cloud Economy main site or the Business-plan site.
- No live-cyan PZN, no live admin login, no RTX 5090 / `lms` commands.
