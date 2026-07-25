# CRM integration plan — `tapuziel-crm-lab` → Tapuziel

**Status:** **complete, including the held-back chat** (v1.77–v1.83) · **Lab reviewed at:** `9350fd9`

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

### ~~The one blocker~~ · **resolved in v1.83**

`POST /crm/cs/v1/message` was a **public, unauthenticated endpoint calling
`ai.generate()` on the owner's API key**, rate-limited 30/min per IP with **no
global cap**, defaulting to enabled — so distributed abuse spent the owner's
money. Per-IP limits are not an answer when the caller has many IPs.

Rebuilt with the bill as the starting point (see Phase 4 below): a **hard daily
cap reserved atomically before any spend**, a per-session cap, a question-length
cap, hard ceilings the owner cannot configure past, **no tools at all**, and off
by default. The owner sees the cap expressed as worst-case money, not as a
message count.

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

### ~~Phase 3c — campaigns~~ · **shipped v1.81**
Named-list sends over SMTP with open/click tracking, plus the three obligations
that come with marketing email:

- **Consent is the recipient list**, not the list. Only contacts with
  `consent = 1` and an address are sent to; the skips are counted and shown, so
  the owner sees *why* their audience is smaller than their list.
- **Every message carries an unsubscribe** — in the body and in the RFC 8058
  `List-Unsubscribe` / `List-Unsubscribe-Post` headers mail clients turn into a
  one-click button. Unsubscribing clears consent, which also stops phase-3b
  conversion reporting for that person: one refusal, honoured everywhere.
- **Click tracking cannot become an open redirect.** Links are extracted at send
  time and frozen onto the campaign; the tracked URL carries an *index* into
  that list, never a destination, so a request cannot name where it wants to go.
  A `?u=https://evil.example` on a tracked link is ignored.

Also: each recipient gets their own unguessable token (one value serves the open
pixel, every tracked link and the unsubscribe URL — no address or id in a URL);
the open pixel returns a **byte-identical** response for real and fake tokens so
it cannot be used to discover which tokens exist; a sent campaign is frozen
against edits because it is the record of what actually went out; sending runs
in the background with a gap between messages, so a slow SMTP server never holds
a request open; and SMTP stays owned by `notify.js` — campaigns never touch
nodemailer.

**Acceptance (met):** `smoke-crm-campaigns` (40 checks, fake transport — nothing
leaves the machine) + `smoke-crm-track-route` (19 HTTP checks against the public
endpoints). Verified live: the send panel reports "1 will receive · 1 on the list
did not consent". *En route, one real defect: `parseInt('0x0', 10)` returns `0`,
so a malformed link index silently resolved to a valid link — not exploitable
(the destination still came from the frozen list) but sloppy; the index is now
required to be a clean digit string.*

### ~~Phase 4 — customer-service chat~~ · **shipped v1.83** · *public + paid*

The module held back through the whole integration, because it is the only CRM
surface where an **anonymous visitor can spend the owner's money**.

**The cap is the feature.** `crm.cs.dailyMessageCap` is enforced by an *atomic*
reserve-before-you-spend step — the check and the increment are one transaction,
so simultaneous visitors cannot both take the last slot (a read-then-decide cap
leaks under exactly the load that matters). Over the cap the model is **never
called**; the visitor gets a human sentence and an invitation to leave details.
A failed or empty model call **refunds** its slot — an error is not a sale.
Layered on top: a per-session cap so one chat cannot eat the day, a
question-length cap, a bounded history replay so cost per call cannot grow with
conversation length, a tighter per-IP window than the tracking pixels, and hard
ceilings (2000/day, 100/session) the owner cannot configure past — a mis-typed
`100000` must not become a five-figure invoice.

**Least power.** It calls plain `generate`, never the tool-running `converse`:
this bot returns text and cannot read pages, write drafts, change settings or
send anything. Its prompt is written defensively — told what it may discuss,
told to refuse rather than invent prices or promises, and told that instructions
arriving inside a visitor's message are questions, not instructions. The widget
writes every remote string with `textContent`, so a reply is never parsed as
markup. `/crm/cs/v1/config` exposes only the greeting: revealing the remaining
budget would tell an abuser when to strike.

**The owner sees money.** The admin screen leads with a usage bar and the
worst-case daily cost in dollars, because "100 messages" means nothing until it
is a number on an invoice. Refusals are counted and shown.

**What the drift guard caught.** Adding `crm_cs_conversations.contact_id` made
`smoke-crm-privacy` fail immediately — a new table of personal data that erasure
did not know about. Worth more than the catch itself: that FK is
`ON DELETE SET NULL`, which is right for merging a contact away but **wrong for
an erasure request**, because nulling the link leaves a transcript full of the
person's own words (quite possibly the phone number they typed). Erasure now
deletes support chats explicitly rather than trusting the cascade.

**Acceptance (met):** `smoke-crm-cs` (41 checks, stubbed model — nothing spends)
including the cap holding when 50 requests race for 10 slots, plus
`smoke-crm-cs-route` (24 HTTP checks). Verified live: enabling it republished the
site with the widget; with no provider configured a question returned a polite
refusal that leaked no provider detail **and consumed no budget**; with the
budget filled the endpoint refused without calling the model, and the admin bar
showed 3/3 in red with 2 refusals.

**Also fixed here:** toggling the chat (and pixels) now **republishes the site**,
because both inject at render time — an owner who flips a site-wide switch and
sees nothing change on their live site concludes it is broken.

### ~~Phase 5 — hygiene~~ · **shipped v1.82**

**Retention.** `crm.retention.eventDays` (0 = keep everything, the default —
silently deleting an owner's history would be worse than growth). Enforced on
boot and once a day (`unref()`ed, so housekeeping can never hold the process
open) and immediately when the policy is saved. Events that anchor a real record
— a form submission — are never pruned, whatever the number says.

**Full-text search.** `LIKE '%term%'` cannot use an index and scans every row.
An external-content FTS5 table over `search_blob` with `unicode61` replaces it,
kept in step by insert/update/delete triggers. Hebrew prefix search works
(`דנ` → דנה כהן). User input is reduced to quoted prefix tokens, so FTS5's own
operators (`"`, `*`, `-`, `:`, `NEAR`, `OR`) can neither throw a syntax error nor
silently change the query. If FTS5 is ever missing, everything degrades to LIKE
rather than failing to start.

**Subject rights.** Per-contact `export.json` (the person's whole record, their
submissions included, as a downloadable file the owner can actually send) and an
erase that verifies itself: it counts what existed, deletes, then re-checks every
personal table and reports leftovers instead of trusting the cascade. Form
submissions survive by default as business records; deleting them too is an
explicit tick-box.

**The guard that keeps it true.** `smoke-crm-privacy` reads the LIVE SCHEMA for
every `crm_*` table with a `contact_id`/`from_id`/`to_id` column and fails if
`subject.PERSONAL_TABLES` does not list it. A future phase cannot add personal
data and quietly leave it behind when someone asks to be forgotten.

**A real bug this phase found — on the upgrade path only.** `SELECT COUNT(*) FROM
crm_contacts_fts` does **not** count the index: on an external-content table that
query is answered from the *content* table. So the "have we indexed everything?"
guard compared `crm_contacts` to itself, always agreed, and the rebuild never
ran — leaving the index empty on exactly the databases that needed it, while a
fresh install looked perfect because the triggers fill it as rows arrive. Caught
by searching the live dev site and getting nothing. The check now reads the
index's own `_docsize` shadow table, and a regression test reproduces the
pre-upgrade database (verified to fail without the fix: *"index has 0 docs for
3 contacts"*).

**Acceptance (met):** `smoke-crm-privacy` (36 checks). Verified live: Hebrew
prefix search returns both matching contacts, `contact-1.json` downloads as an
attachment with the timeline and submission included, and the privacy screen
reports "5 events, 1 anchored to a real enquiry — never pruned".

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
