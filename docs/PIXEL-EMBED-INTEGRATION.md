# Universal pixel embed — `tapuziel-crm-lab` → Tapuziel

**Status:** **complete** — core shipped v1.99 (all four findings fixed — never
the lab path); P4 wrappers shipped v2.01 (`integrations/`, inject-only enforced
by `smoke-wrappers`); P5 stitching shipped v2.21 (§4 — found by the live
WordPress ↔ CRM test).
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

### ~~Phase P5 — stitching~~ · **shipped v2.21**
The gap the live WordPress test exposed (§4): a foreign browser had no way to
be recognised again, so approval created the person and attached nothing.
The loader now carries a site-local pseudonymous `vid`; a form submission or
an approved claim binds it (`crm_visitors`, `f:<site>:<vid>`); linked beacons
append to the timeline tagged with the site. `smoke-pixel-embed` covers it.

---

## 3. What we do not take

- The `identify → upsertContact` path (finding 1) — replaced by claims.
- Unregistered `site_id` acceptance (finding 2).
- Foreign anonymous traffic in `crm_events` (finding 3).
- http bases in public snippets (finding 4).
- `identify({email})` auto-**linking** a browser to an existing contact whose
  email matches (v2.21). It looks harmless — "the person already exists" —
  but it is finding 1's worse half verbatim: anyone who knows your customer's
  address attaches their own browsing to that customer's record. A link needs
  an authenticated channel: the form the person typed into, or an admin.

---

## 4. The stitching path (v2.21) — foreign site → CRM timeline

### 4.1 What the live test found

Setup: WordPress with `tapuziel-pixel` (inject-only) + a companion form
bridge that on Contact submit called `identify({email,name})`,
`track('contact_us')`, then `fetch(CRM + '/api/form', {mode:'no-cors'})`.

Observed: the contact existed with a `form` event; the site's analytics
showed the WordPress pageviews; the claims inbox was empty; **no WordPress
pageview ever reached the contact's timeline.** Reproduced locally against
`main` with the same beacons — two independent causes:

1. **The claim was dropped, by design.** The site was registered with
   claims *off* (`claims_enabled = 0`); `collect-handler` records a claim
   only when `resolved.site.claimsEnabled`. Correct behaviour, surprising
   outcome — turn the toggle on in לקוחות → אתרים if you want the inbox.

2. **Even with claims on and approved, nothing could stitch.** Three
   reasons, all structural:
   - `approveClaim` upserted the contact and stopped. The only browser field
     on a claim was `visitor_hash` — the analytics hash, re-salted daily and
     *designed* not to follow anyone across days. There was nothing to bind.
   - The first-party link (`tz_v`, set by `captureForm` on `/api/form`) never
     reaches a foreign page: a `no-cors` POST discards `Set-Cookie`, and the
     loader posts with `credentials: 'omit'` — the only safe pairing with
     `ACAO: *`. So even a cookie that *was* set would never ride a beacon.
   - The collector's foreign branch never called `capturePageview` at all
     ("anonymous foreign → analytics only"). With no way to tell a linked
     browser from an anonymous one, every foreign browser was anonymous.

   Provisional cards / the interest board only populate from
   `capturePageview`, which is why they stayed at zero for the foreign site.

### 4.2 How it works now

```
WordPress page                      Tapuziel
─────────────                       ────────
tz-pixel.js mints vid (32 hex,      /_tapuz/collect
  localStorage tz_vid, first-party    site registry → origin allowlist
  on the WP origin; none under DNT)   token = f:<site>:<vid>   (looked up, never stored)
every beacon body carries vid  ───►  linked?  no → pageviews(site_id) only     [as before]
                                              yes → pageviews + crm_events{meta.site_id}
                                                    + touch + interest tag

identify({email})              ───►  claims_enabled? → pending claim REMEMBERS the token
                                     admin «אשר» → upsert (existing or new) + linkToken

form bridge POST /api/form      ───►  saveSubmission (underscore fields stripped)
  fields + _page                      captureForm → upsert / resolve existing person
  + _tz_site + _tz_vid                  → registry + origin gate → linkToken
```

Two channels bind a browser, both already trusted to name a person:

| Channel | Who authenticates | What it binds |
|---|---|---|
| Form submission with `_tz_site` + `_tz_vid` | the person typing into the owner's form (same trust as the native `tz_v` cookie set on `/api/form`) | `f:<site>:<vid>` → resolved contact, immediately |
| Identity claim approved in לקוחות → תביעות זהות | the admin | `f:<site>:<vid>` remembered on the claim → approved contact |

Rules that hold (all pinned by `smoke-pixel-embed`):

- An **anonymous vid is never written** anywhere. Only `linkToken` stores it.
- Tokens are **site-scoped**: the same vid under another `site_id` is anonymous.
- The `f:` namespace means a client-chosen id can never equal, or replay as,
  a server-minted first-party `tz_v` token (`readToken` only accepts bare hex).
- Form linkage is gated exactly like the collector: `pixelEmbed.enabled`,
  site registered + active, Origin in the allowlist when one is set. When the
  gate fails the submission still lands — linkage is a bonus, never a condition.
- Linked foreign rows carry `meta.site_id`; the contact page shows it as a pill.
- Erasure reaches the binding (`crm_visitors` is a `PERSONAL_TABLE`).
- `identify()` still never creates, merges, **or links** anything by itself.

### 4.3 What a WordPress form bridge must do (recipe)

The pixel plugin stays inject-only. A *separate* bridge plugin (or theme
snippet) is the right place for this, and it needs exactly three things on
submit — nothing else changes from the setup that already works:

```js
// after a successful Contact submit (Elementor: `submit_success` jQuery
// event; CF7: `wpcf7mailsent`; plain forms: the submit handler)
var BASE = 'https://<live-site>';
var SITE = 'wp-whiteno1se';                       // the registered slug
var px   = window.TapuzielPixel;

if (px) {
  px.identify({ email: email, name: name });      // claim (needs claims ON to land)
  px.track('contact_us');
}

var body = new URLSearchParams({
  email: email, name: name, message: message,
  _page: location.pathname,
  _tz_site: SITE,                                  // 1. which registered site
  _tz_vid: (px && px.visitorId()) || ''            // 2. this browser's pixel id
});
fetch(BASE + '/api/form', {                        // 3. same no-cors POST as today
  method: 'POST', mode: 'no-cors', keepalive: true,
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: body.toString()
});
```

Notes for the bridge author:

- `visitorId()` returns `''` under DNT/GPC — send the form anyway; the person
  is still recorded, just not stitched. Never invent a vid on the bridge side.
- Keep the pixel loaded **before** the bridge runs (the plugin's `defer` tag
  is fine; guard with `if (window.TapuzielPixel)` as above).
- `_tz_*` and `_page` are internal fields: they are stripped from the stored
  submission, so they never appear in the inbox or the lead e-mail.
- On the Tapuziel side the site must be **registered and active**; if you set
  an origin allowlist, it must contain the WordPress origin. Turning claims on
  is optional — the form channel links without any admin step.
- Elementor's own AJAX submit and this POST are independent; ordering does
  not matter as long as the pixel has minted the vid (it does on page load).

### 4.4 Ops checklist for `wp-whiteno1se`

1. Deploy this Tapuziel version to the CRM host (the loader is served from
   there — the WordPress plugin picks the new `tz-pixel.js` up automatically).
2. לקוחות → אתרים: site `wp-whiteno1se` active; add the WordPress origin to the
   allowlist if you want the tighter gate; optionally enable claims.
3. Update the bridge per §4.3 (`_tz_site`, `_tz_vid`).
4. Submit Contact on WordPress, then open two more pages. The contact's
   timeline shows the `form` event, then `pageview` rows with the
   `wp-whiteno1se` pill, and the interest card learns the paths.
