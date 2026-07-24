# CRM integration plan — `tapuziel-crm-lab` → Tapuziel

**Status:** phase 0–1 **shipped** (v1.77) · **Lab reviewed at:** `9350fd9` · **Next:** phase 2

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

### Phase 2 — passive capture · *touches our hot paths*
The six surgical edits: `form-capture.js` (upsert a contact on submit),
`analytics.js` + `server.js` (pageview → `crm_events`), `admin-ui.js` (nav).

**Risk:** medium — these are our live paths. Every CRM call goes in a
`try/catch` that swallows and logs; a CRM error must never cost a lead.
**Acceptance:** `smoke-form`, `smoke-forms-inbox`, `smoke-analytics`,
`smoke-conversions` unchanged and green + a new test proving a *throwing* CRM
still lets a form submit succeed.

### Phase 3 — outbound · *external network, PII leaves the box*
Pixels (`renderer.js` head injection), Meta CAPI, GA4 MP, campaigns/SMTP with
open-and-click tracking.

**Risk:** medium-high. Requirements: every integration **opt-in, default off**;
consent-gated; all outbound calls timeout-bounded and failure-isolated (a dead
CAPI endpoint must not slow a page render); PII hashing verified against Meta's
spec with a fixture test.
**Acceptance:** a render with all pixels off is byte-identical to today's output.

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
