# Session handoff — Tapuziel (read this if the chat died)

> **Purpose:** Survive lost Grok/Claude/Cursor chats, sleep, crashes.
> Update this file whenever a big milestone lands or direction changes.
> **Last updated:** 2026-07-26 (מדריך SMTP בעברית + מפת צעדים; עברית קודם).

---

## 0. Where to work (worktrees)

| Path | Branch | Role |
|------|--------|------|
| `/home/<user>/projects/tapuz` | `main` | **Main gig — Tapuziel CMS** (`WhiteNo1s3/tapuz`) |
| `/home/<user>/.grok/worktrees/tapuz/handoff` | `session/handoff` | Crash-recovery worktree (same tip as main when created) |
| `/home/<user>/projects/tapuziel-crm-lab` | `main` | CRM lab prototype (`WhiteNo1s3/tapuziel-crm-lab`) |
| `/home/<user>/.grok/worktrees/tapuziel-crm-lab/continue` | `lab/continue` | Older lab worktree (may lag main) |

```bash
# Resume Tapuz main
cd /home/<user>/projects/tapuz && git pull && npm run qa:quick

# Resume from this handoff worktree
cd /home/<user>/.grok/worktrees/tapuz/handoff && git fetch && git merge origin/main
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
- Password was shared in chat once → **user if not already**.

**Brand:** citrus orange `#f97316` / `#ea580c`, fruit icon (`public/tapuziel-icon.png` on lab; extension icons on main), credit **Shaltiel Industries · made by WhiteNo1se**.

---

## 2. Git tips (as of handoff write)

### Tapuz main (`WhiteNo1s3/tapuz`)

| | |
|---|---|
| Tip when handoff written | `ac86870` — *v1.88.1: one-command QA report, body-parser 1.20.6, Actions Node 24* |
| Recent line | v1.77 CRM spine → v1.83 CS chat → v1.84–1.88 WhatsApp W0–W3 → v1.90 premium DB → v1.91 restore/.pzn DB → **v1.88.1 QA tooling** (on top of 1.91 tree after rebase) |
| Package version field | Was `1.91.0-alpha` in package.json at merge time |
| CI | `.github/workflows/security.yml` — gitleaks + `test:pzn` + `test:smoke` + registry + wizard + audit high+ |
| Node in CI | **24** (setup-node); deprecation warnings about action runtimes may still appear |

### CRM lab (`WhiteNo1s3/tapuziel-crm-lab`)

| | |
|---|---|
| Tip | `c1682fc` — ROUTE-MAP regen (fixed CI drift after pixel routes) |
| Pixel embed | `docs/PIXEL-EMBED-SPEC.md`, `/tz-pixel.js`, WP plugin under `integrations/wordpress/tapuziel-pixel/` |
| Live wire proof | `npm run test:pixel-live` (Builder + WP **shaped** beacons → `crm_events.site_id`) — **not** a real WP activation |
| Branding | Lab admin shell uses Tapuziel icon + Shaltiel credit |

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

### C. Explicitly parked

- **Israeli invoicing** (Green Invoice / iCount / Rivhit, חשבונית מס vs קבלה, allocation numbers) = **finance surface**, own round later. Not CRM.

---

## 4. QA — one command (do this first after crash)

```bash
cd /home/<user>/projects/tapuz
npm install          # if node_modules missing; allow better-sqlite3 native build
npm run qa           # full report (~50s) — mirrors CI + CRM/WA spots
npm run qa:quick     # faster path
```

Script: `scripts/qa-checklist.js`  
Report gates: `test:pzn`, `test:smoke`, registry, wizard, CRM/WA spot (7), route-map, npm audit high+.

```bash
# Lab only if needed
cd /home/<user>/projects/tapuziel-crm-lab
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

## 10. Open / next (when resuming)

Full Hebrew cookbook: **`docs/SMTP-PRODUCTION.md`**.

| # | Next step | Notes |
|---|-----------|--------|
| 1 | Real SMTP on staging | Follow SMTP-PRODUCTION.md (Gmail / SES / Resend / cPanel) |
| 2 | Pixel on real WP | Hostinger WhiteNo1se + public CRM `site_id` |
| 3 | Production campaign → live segment | Consent + unsubscribe war story |
| 4 | OSS packaging | CONTRIBUTING, release, paid support SKU |
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
- **Repos:** `WhiteNo1s3/tapuz` (main), `WhiteNo1s3/tapuziel-crm-lab` (lab).

*End of handoff. Prefer updating over inventing history.*
