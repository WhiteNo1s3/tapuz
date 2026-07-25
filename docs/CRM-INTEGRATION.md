# CRM integration plan — `tapuziel-crm-lab` → Tapuziel

**Status:** phase 0–3b **shipped** (v1.77–v1.80) · **Lab reviewed at:** `9350fd9` · **Next:** phase 3c (campaigns), then phase 5 hygiene

The lab is a **specification and reference implementation**, not a merge source.
Every module lands here rebuilt to our bar — the rule the lab's own README states.

---

## 1. What the review found

Measured by diffing the lab against the exact skeleton it forked from
(`23c9ead` = our v1.74 `7966b15`):

| Metric | Result |
|---|---|
| Total change | **+6,355 / −19** across 39 files |
| Lines deleted from our code | **19** — all extension points, no rewrites |
| New dependencies | **0** — the zero-required-deps rule held |
| Schema changes | **+232 / −0** — purely additive, `crm_`-namespaced, indexed, `IF NOT EXISTS` |
| Conflicts with our v1.75–v1.76 work | **none** (we touched builder frontend, the lab touched backend; only `package.json` overlaps) |
| Lab smoke suite | green except `SMOKE ROUTE-MAP` — a stale generated doc, our own drift guard doing its job |

**Reused our primitives rather than reinventing:** `FixedWindowLimiter`,
`requireAdmin` (30 call sites in `routes/crm.js`), the escape helpers, our
smoke-script conventions (4 new suites).

**Correct on the fiddly external specs:** Meta CAPI hashes PII with
trim→lowercase→SHA-256 and digits-only phones, sharing `event_id` with the
browser pixel for dedup; GA4 MP pairs with the public gtag; geo comes from CDN
headers, never raw IP; pixel IDs are character-class-filtered, length-capped,
and `</script` is escaped.

### The one blocker

`POST /crm/cs/v1/message` is a **public, unauthenticated endpoint that calls
`ai.generate()` on the owner's API key** (`src/routes/cs-chat.js:364`).
It is rate-limited to 30/min **per IP** with **no global or daily cap**, and
defaults to enabled. Distributed abuse spends the owner's money.
**This module ships last, and only behind a budget guard (below).**

### Lesser findings

1. `crm_events` grows unbounded — needs a retention policy.
2. Contact search is `LIKE` over a denormalized `search_blob` — fine at lab
   scale; use FTS5 on rebuild.
3. It is a PII store with no subject-export/delete path — required before any
   real customer data lands in it.

---

## 2. Architectural stance

Ben's framing — *"CRM as a different product… we will handle both ends"* —
sets the boundary. `src/crm/` must be a **self-contained subsystem with a narrow
seam into the CMS**, so it can be enabled, sold, or disabled as a unit:

- The CMS calls **into** the CRM through a handful of hook points, never the reverse.
- Every hook is wrapped so a CRM failure **can never** break a form submission,
  a pageview, or a page render.
- One feature flag (`config.crm.enabled`) turns the whole subsystem off; with it
  off, the CMS behaves exactly as it does today.

That seam is what makes the "different product" claim real rather than a label.

---

## 3. Phases (lowest risk first)

Each phase ends green on **both** suites plus its own new smoke script, and is a
separate commit. Nothing in a later phase is needed to make an earlier one useful.

### ~~Phase 0 — pre-flight~~ · **shipped v1.77**
- `config.crm.enabled`, default **off**, added before any code read it.
- `ROUTE-MAP.md` regenerated (24 CRM routes registered, drift guard green).

### ~~Phase 1 — the spine~~ · **shipped v1.77** · *no public surface, no external calls*
`src/db.js` schema (+7 tables, additive), then `src/crm/`: `contacts`,
`Customer`, `events`, `relations`, `segments`, `lists`, and `index.js` — **the
seam**. Admin screens `/admin/crm/*`, all `requireAdmin`.

Rebuilt, not copied. What we changed from the lab's shape:

- **The seam is explicit.** `src/crm/index.js` is the only module the CMS may
  call, and every hook on it is wrapped by `safe()`: flag off → returns null and
  touches nothing; anything throws → logged, returns null. A test proves it by
  breaking `upsertContact` and asserting the hook still does not throw.
- **Identity is non-destructive.** A blank incoming field can never erase a
  stored one (a later form that omits the name keeps the name); tags accumulate;
  consent is a latch. Admin edits *can* clear, because a human meant it.
- **Identity is Hebrew-first.** `+972-50-…` and `050-…` resolve to one person.
- **An address is never stolen.** If an incoming identity already belongs to
  someone else, the upsert resolves to its owner rather than violating the
  partial unique index.
- **Segment rules compile from a whitelist**, values always bound — a rule is
  admin-authored JSON that becomes SQL, so it is the one place injection could
  live. Tested with a hostile value.
- **Retention exists from day one** (`events.pruneOlderThan`), keeping any event
  that anchors a record elsewhere.

**Acceptance (met):** `smoke-crm-contacts` (48 checks) + `smoke-crm-route`
(19 HTTP checks), both in the CI chain; full suite green.

### ~~Phase 2 — passive capture~~ · **shipped v1.78** · *touches our hot paths*
Two call sites, three lines each: `routes/form-capture.js` (a submission
resolves the person behind it) and the `/_tapuz/collect` beacon in `server.js`
(a linked visit joins their timeline). Both call the guarded seam, both run
*after* the CMS's own write, so neither can cost a lead or a pageview.

**Attribution needed a mechanism, and the obvious one was refused.** The
`pageviews` table re-salts its visitor hash daily and destroys the old salt, so
it cannot follow anyone across days — a deliberate privacy property, and not
something to trade away for a CRM feature. So attribution got its own narrower
link (`crm_visitors`): a random token in a first-party `HttpOnly` cookie, minted
**only** when someone voluntarily identifies themselves by sending a form, and
**only** while the CRM is on. An anonymous visitor stays anonymous forever; a
person who wrote to you gets a timeline — which is what they already expected
when they typed their phone number in. A cookie already bound to someone else
(shared computer) is never reassigned: the new person earns a fresh token.

**Acceptance (met):** `smoke-form`, `smoke-forms-inbox`, `smoke-analytics`,
`smoke-conversions`, `smoke-form-capture-route` all unchanged and green, plus
`smoke-crm-capture` (24 checks) — whose centrepiece drops `crm_contacts` out
from under the running server and proves a form submission **still succeeds and
is still saved**. Also pinned: DNT/GPC wins even for a known person, a forged
token resolves to nobody, and with the flag off there is no contact, no cookie
and no event.

Phase 3 split in delivery — the browser-side and server-side halves are
independently useful and independently risky:

### ~~Phase 3a — marketing pixels~~ · **shipped v1.79**
Meta / Google Ads / TikTok / LinkedIn, rendered into the body-end extras.
Opt-in, default off, **consent-required by default**: until the visitor agrees
the vendor code is not live markup at all — it waits as a JSON string the
loader injects on consent. DNT/GPC outranks consent. Ids are charset-filtered
per vendor and length-capped; a built-in RTL consent bar ships, and a site with
its own banner can suppress ours and drive `window.tapuzConsent.grant()/.deny()`.

**What live testing caught that unit tests could not.** The site's own CSP
withholds `'unsafe-eval'`, so the obvious loader — `eval` a snippet string —
was **silently blocked in production while appearing to work in DevTools**,
which is exempt from CSP. Two real defects, both fixed: the loader now injects
a `<script>` *element* (covered by the existing `'unsafe-inline'`), and the CSP
is widened by **exactly the origins the configured vendors need** — Meta alone
adds only `connect.facebook.net` + `www.facebook.com`, and an unconfigured
vendor adds nothing. `'unsafe-eval'` is never granted. The silent `catch` that
hid the failure now logs one console warning per failing vendor.

**Acceptance (met):** `smoke-crm-pixels` (25 checks) including the plan's bar —
a real `renderPage` with pixels off is **byte-identical** to the pre-feature
output — plus id-injection resistance and the CSP minimal-privilege rules.
Verified live: consent bar → grant → Facebook's script actually loads, zero CSP
violations; toggling pixels off restores the original CSP header character for
character.

### ~~Phase 3b — server-side conversions~~ · **shipped v1.80**
Meta CAPI + GA4 Measurement Protocol. A form submission mints one `eventId`:
the server reports the conversion with it, the redirect carries it to
`/form-sent`, and the thank-you page fires the browser pixel with the **same**
id — so the vendor collapses two reports into one event. Better measurement,
not double counting.

**Consent had to become server-readable.** The browser's answer lived only in
`localStorage`, which the server cannot see — so a "refuse" would have stopped
the pixel while the server kept reporting. That is not consent, it is theatre.
The loader now mirrors the decision into a cookie, and the server refuses to
send for anyone who did not grant. DNT/GPC outranks even a granted consent.

**Rules held:** PII hashed to Meta's spec (verified against digests computed
independently with `openssl`, not with the code under test); ip/user-agent sent
raw because Meta requires them so for matching, and nothing else is; vendor
hosts are **hardcoded constants** so no setting can redirect an access token;
every call is `AbortSignal.timeout`-bounded and fire-and-forget; secrets are
never echoed back to the browser (readiness + last-4 only), and an empty secret
field means *keep*, never *clear*.

**Acceptance (met):** `smoke-crm-conversions` (30 checks, fully offline — every
path is gated or unconfigured, so nothing hits a real vendor in CI). Verified
live: settings round-trip with the token never appearing in the page, the
thank-you page carries the same event id the redirect issued, a forged `?e=`
renders nothing, and a submission with a real outbound call to Meta on a bogus
token returned in **94 ms** with the lead saved — the visitor never waits.

### Phase 3c — campaigns
Named-list sends over SMTP with open/click tracking.

### Phase 4 — customer-service chat · *public + paid*
`cs-chat` + `tz-cs-chat.js` widget, **last**, and only with:
- a **global daily token/message budget** that hard-stops at the cap,
- default **off**,
- per-session message cap on top of the per-IP window,
- the owner shown a live spend counter in admin.

**Risk:** high (cost, abuse). This is the one place where the lab's prototype
posture is not shippable as-is.

### Phase 5 — hygiene
`crm_events` retention, FTS5 contact search, subject export/delete.

---

## 4. What we do *not* take

- The lab's `package.json` test chain (ours is authoritative).
- Any generated artifact — all regenerate from our code.
- The `enabled`-by-default posture on anything that costs money or leaves the box.

---

## 5. In-house vs. lab — the call

**From here: in-house, with the lab as the spec.**

The lab earned its cost as a *spike*. It de-risked exactly the parts worth
spiking: the external integrations whose difficulty is specification, not
design — Meta's hashing and dedup rules, GA4 MP's payload, four vendors' pixel
snippets. Getting those right on paper is most of the work, and the lab got them
right.

But it also proved the failure mode Ben named: it built the AI chat widget, the
social gadget and the enterprise pixel before the contacts↔forms wiring was
proven. A fresh context does not feel the weight of an existing architecture, so
it optimizes for breadth. That is fine in a lab and fatal in the product.

The deciding factor is ownership. This code is about to live inside our CMS
permanently, on our hot paths, holding our users' customer data. Everything that
makes the manifest real — OOP, modular, *"everyone enjoys editing this code as
professionals"* — is applied at rebuild time, not at merge time. A raw merge
would import 6,355 lines nobody here reasoned through.

**On the "perfect smoke test" insight:** correct, and it is the strongest
argument in the message. A CRM whose whole job is integrating foreign systems is
a genuine rehearsal of integration discipline — but only if we integrate it the
way we would want a third party to integrate with us: through a narrow seam,
behind a flag, failure-isolated, with the existing suite green at every step.
Done that way the integration validates the architecture. Done as a merge it
just moves code.
