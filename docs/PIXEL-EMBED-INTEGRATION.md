# Universal pixel embed — `tapuziel-crm-lab` → Tapuziel

**Status:** **complete** — core shipped v1.99 (all four findings fixed — never
the lab path); P4 wrappers shipped v2.01 (`integrations/`, inject-only enforced
by `smoke-wrappers`).
**Prerequisite:** the CRM (v1.77+). This is the *write-portability* direction
docs/CRM-PORTABILITY.md measured and recommended: our collector already accepts
foreign beacons; the lab turned that into a product surface.

Same rule as ever: the lab is a **specification and reference**, not a merge
source.

---

## 1. Review

The thesis is right, and it is the strongest strategic move in the lab so far:
**the CRM value is events + identity + audiences that work even when the
customer's site runs on someone else's CMS.** One universal loader
(`tz-pixel.js`); CMS packages are thin wrappers that only know how to *inject*
it — a new CMS is a 20-line recipe, not a rewrite. The WordPress plugin proves
the discipline: it enqueues the same file with settings-driven attributes and
contains **zero** collect logic.

### What it got right

- **The transport lesson is encoded, from live evidence.** One transport per
  event (double-firing recorded everything twice); `fetch(keepalive)` primary
  because `sendBeacon` returns true on queue and then drops the event —
  observed live through the CF tunnel during the WP validation. The client
  comment cites the evidence. This is exactly how we want lessons captured.
- **The CORS pairing is correct.** `Access-Control-Allow-Origin: *` with
  `credentials: 'omit'` — the only safe wildcard. Identity rides the body,
  never cookies.
- **Privacy posture carried to foreign origins**: client skips on DNT/GPC,
  server skips again, bot-UA drop, per-IP rate limit, no raw IP. The native
  rules did not get "relaxed for compatibility".
- **`site_id` as first-class multi-tenancy**: normalized slug, real column on
  the event stream, admin filter. This is the seed of the community/multi-CMS
  CRM.
- Live-proven end to end: Builder + WP wire → events with `site_id` in the
  admin (`smoke-pixel-live`).

### Findings to fix on rebuild

1. **`identify({email})` flows into `upsertContact` from an unauthenticated,
   cross-origin body** (lab server.js:152). This must not ship. Anyone on the
   internet can POST any email to the public collector: fake contacts at will,
   and — worse — **attaching arbitrary browsing history to a real person's
   existing record** by claiming their email. On rebuild, a foreign
   `identify` lands as an unverified **claim** in its own table, surfaced for
   admin approval — never an automatic upsert, never an automatic merge. Same
   gate philosophy as the copilot's stop-for-approval.

2. **Any origin can invent any `site_id`.** ACAO:* is right for transport, but
   tenancy needs a registry: sites are *created in the admin* (slug, label,
   optional origin allowlist, active flag); an unknown `site_id` is dropped
   with an uninformative 204. The lab's spec itself anticipates this
   ("allowlist origins per site_id when abuse appears") — we build it on day
   one, because a polluted tenant stream is a support nightmare later.

3. **Anonymous foreign traffic lands in `crm_events`.** Our v1.77 spine
   separates the anonymous analytics stream (`pageviews`, daily-salted hash)
   from the CRM timeline (linked people only). The lab writes foreign
   pageviews into `crm_events` with a visitor hash and no contact — an
   analytics stream inside the CRM table. On rebuild: anonymous foreign
   events go to the analytics side (with `site_id`), and only LINKED
   identities touch a timeline.

4. **HTTPS is a precondition, not a suggestion.** Per CRM-PORTABILITY: the
   public snippet builder refuses plain-http bases outside localhost.

5. *(Optimization, not a defect)* The custom headers force a CORS preflight on
   every event — two requests per beacon. Our collector already accepts
   `text/plain`; a "simple request" mode (event_id in body, no custom headers)
   halves the traffic. Worth doing on rebuild since the body already carries
   everything.

---

## 2. Phases (each lands with its tests; nothing enabled by default)

### Phase P0 — the site registry · *no network surface*
`crm_sites` (slug PK, label, allowed_origins, active, created_at) + admin
screen under לקוחות. `config.crm.pixelEmbed.enabled`, default **off**, under
the CRM flag. No personal data — the drift guard is unaffected.

### Phase P1 — the collector accepts foreign · *flagged*
CORS preflight + ACAO:* (credentials omit) on `/_tapuz/collect`; `site_id`
validated against the registry (unknown → silent 204); origin allowlist
enforced when set; anonymous events → analytics stream with `site_id`, linked
events → timeline. **No email field accepted in this phase.**
**Acceptance:** foreign-origin beacon with a registered site lands; unknown
site drops silently; DNT/GPC/bot/rate-limit behavior identical to native;
the pageviews/timeline separation holds.

### Phase P2 — the loader + snippet admin
Rebuild `tz-pixel.js` (transport lesson, DNT client-side, SPA hooks,
simple-request mode); serve at `/tz-pixel.js`; snippet page fed by the
registry; HTTPS-only snippets outside localhost.
**Acceptance:** raw HTML file on a foreign origin → event in admin; zero
preflights in simple mode; reduced privacy never below native.

### Phase P3 — claimed identity · *the dangerous one, deliberately last*
`identify()` lands in `crm_identity_claims` (site_id, claimed email/phone,
visitor link, count, first/last seen) — an inbox, per-site toggle default
off. Admin approves a claim → THEN it becomes contact linkage through the
normal seam. Erasure/export learn the claims table in the same commit.
**Acceptance:** a forged identify cannot create or merge a contact; approval
does; the drift guard sees the new table; erasure reaches claims.

### ~~Phase P4 — the wrappers~~ · **shipped v2.01**
`integrations/wordpress/tapuziel-pixel/` (plugin + readme) and
`integrations/builder.io/README.md`, rebuilt inject-only with the four-findings
discipline carried in: HTTPS-only base (loopback excepted), the registry's own
site-id normalization, nothing injected until base AND site are set, and the
docs state plainly that `identify()` is a claim. `smoke-wrappers` (16 checks)
makes the rule executable: no HTTP of the wrapper's own, no collect endpoint in
code, and a drift guard — a wrapper may only speak `data-tz-pixel-*` attributes
the loader actually reads.

---

## 3. What we do not take

- The `identify → upsertContact` path (finding 1) — replaced by claims.
- Unregistered `site_id` acceptance (finding 2).
- Foreign anonymous traffic in `crm_events` (finding 3).
- http bases in public snippets (finding 4).
