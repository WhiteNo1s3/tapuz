# WhatsApp integration plan — `tapuziel-crm-lab` → Tapuziel

**Status:** phases W0–W3 **shipped** (v1.84–v1.88) · **Lab commit:** `99274e7` (on lab `main`)
**Prerequisite:** the CRM (v1.77–v1.83) — WhatsApp is a channel *on* the CRM, not
a thing beside it.

Same rule as the CRM: the lab is a **specification and reference**, not a merge
source. Its 786-line `docs/WHATSAPP-SPEC.md` is the most valuable artefact here —
the Cloud API's billing and windowing rules are the hard part, and they are
written down and encoded in tests.

---

## 1. Review

Isolated by diffing the WhatsApp commit against the head I reviewed previously
(`9350fd9` → `99274e7`):

| Metric | Result |
|---|---|
| Change | **+2,687 / −7** across 14 files |
| Lines of existing code touched | **7** (nav entry, seam export, one mount, test chain) |
| New dependencies | **0** |
| Lab WhatsApp suite | **66 checks, all pass** (`npm run test:whatsapp`) |
| Spec written before code | 786 lines |

### What it got right — including the parts that are usually wrong

**The webhook HMAC is textbook.** This is where most implementations fail, in
four distinct ways, and none of them are present:

- The signature is computed over the **raw body**. `express.raw({type:'*/*'})` is
  applied on the webhook route, so the bytes are not re-serialized JSON (a
  re-serialized body produces a different digest and *every* signature fails).
- The router is mounted **before** the global `bodyParser.json`, so `express.raw`
  actually receives the body. Correct mount order, which is easy to get wrong and
  silent when you do.
- Buffer lengths are compared **before** `crypto.timingSafeEqual`, which throws on
  mismatched lengths — so a short forged header is a `false`, not a 500.
- It **fails closed**: a missing app secret or missing header returns false, and a
  bad signature is a `401`.

**The customer-service window fails closed.** A non-template message to a phone
whose window is shut is refused locally with `csw_closed_use_template` — it never
reaches Meta to be rejected there. Marketing templates require an opt-in and
return a distinct `marketing_opt_in_required`. The tier ceiling
(`TIER_250`…) is counted and enforced **before** calling Meta, so we produce our
own `messaging_limit_reached` rather than discovering the limit from a rejection.

**Phone identity is aligned with ours.** `normalizeToWaId` calls
`contacts.normalizePhone` *first*, then applies the E.164/IL rules (trunk-zero
repair, `05X…` → `9725X…`). That is the detail that makes a WhatsApp contact and a
web-form contact resolve to **one person** instead of two — exactly the right
instinct, and it means the CRM spine needs no changes to accept this channel.

**Secrets are handled to our standard.** `config/whatsapp.json` is gitignored;
`getSettings()` returns `hasToken` / `hasAppSecret` / `hasVerifyToken` rather than
values; and `saveSettings()` returns `getSettings()`, so even the write path
cannot echo a secret back. `undefined` = keep, `''` = clear, documented.

**Also present:** the `hub.verify_token` GET handshake with a `403`, a
`FixedWindowLimiter` on the public webhook, and the PMP pricing model implemented
per category (service free, utility free inside the window, marketing/auth
billable, priced at delivery from the status webhook).

### Findings to fix on rebuild

1. **`graphBase` is configurable — this must not ship.** `saveSettings` accepts
   any value starting with `https://` as the Graph host. That is precisely the
   pattern refused in CRM phase 3b: a configuration key that can redirect **where
   an access token is sent**. A mistyped or tampered config becomes credential
   exfiltration. On rebuild the host is a **hardcoded constant** (`apiVersion`
   may stay configurable — it is a path segment, not a destination).

2. **The tier counter lives in memory.** `outsideCswRecipients` is a `Map`, so the
   count of unique outside-window recipients resets on restart and is not shared
   across processes — the lab's own admin screen honestly labels it
   *"(process)"*. Meta's tier limit is an **account-level** ceiling; undercounting
   locally means Meta enforces it instead, and a blocked number is a worse
   outcome than a refused send. Must be DB-backed with a rolling 24h window.

3. **Nothing knows how to forget a WhatsApp contact.** The lab predates our
   `subject` module, so `crm_wa_*` rows are invisible to export and erasure.
   Our v1.82 drift guard **will fail the build** the moment these tables land,
   which is the system working — but note the same trap the chat transcripts had:
   a WhatsApp message body contains the person's own words, so erasure must
   *delete* those rows, not null a link.

4. **Opt-in is a separate consent, and must stay separate.** `crm_wa_optins` is
   the right shape. WhatsApp marketing opt-in is a legally distinct permission
   from email consent: unsubscribing from email must **not** clear it, and
   granting it must **not** imply email consent. The one place they meet is
   erasure, which clears everything.

---

## 2. Phases

Ordered by risk, and — applying the phase-5 lesson — **privacy is not a later
phase**. Every phase that creates a table teaches `subject.PERSONAL_TABLES` about
it in the same commit, because the drift guard will otherwise fail the build.

### ~~Phase W0 — pre-flight~~ · **shipped v1.84**
`config.crm.whatsapp.enabled`, default **off**, under the existing CRM flag (so
turning the CRM off turns this off too). The Graph host becomes a hardcoded
constant. Secrets to `config/whatsapp.json`, gitignored, redaction pattern copied
from `conversions.js`.

### ~~Phase W1 — the ledger and the gate~~ · **shipped v1.86** · *no network, admin-only*
`crm_wa_optins`, `crm_wa_windows`, `crm_wa_messages`, plus the DB-backed tier
counter that replaces the in-memory `Map`. Port `decideSend` as a **pure
function** — it is the best-tested thing in the lab and deserves to stay pure.
Admin screens behind `requireAdmin`.

**Ships with:** the three tables added to `subject.PERSONAL_TABLES`, WhatsApp
rows in the export, and erasure deleting message bodies rather than unlinking.
**Acceptance:** the lab's 66 checks rewritten against our build, plus
`smoke-crm-privacy` still green (it will fail first — that is the point).

### ~~Phase W2 — the webhook~~ · **shipped v1.87** · *public, HMAC-gated, no spend*
`GET` verify handshake + `POST` events. The signature verification ported
essentially as-is (it was correct); the route mounts **before** every body
parser, and the reordering failure — which is silent in production — is caught
two ways: a source-position assertion, and a behavioral proof (a valid
signature over a *non-canonically spaced* body must be accepted; a re-serialized
body can never verify).

**Shipped with:** status callbacks refining ledger rows (PMP pricing lands at
delivery, `failed` records why), inbound messages ledgered through W1's
`recordMessage` (window opened, known contact's timeline joined) with retry
dedup by wamid, and — because W0 built the credential *store* but no UI — the
connection form on `/admin/crm/whatsapp`: channel flag, ids, tier, and the three
secrets with keep-on-empty semantics, plus the webhook URL card.
**Acceptance met:** valid signature accepted, forged `401`, re-serialized body
`401`, short header no-throw, missing app secret refuses everything
(`smoke-wa-webhook`, 27 checks).

### ~~Phase W3 — sending~~ · **shipped v1.88** · *money leaves the building*
`wa-send.js` is the only module with a network path to Meta, and it holds no
URL of its own — the destination comes exclusively from `endpointFor()` on the
hardcoded host (grepped by test). W1's pure gate runs **before** the transport
on every call; the suite proves each refusal fires with zero network by
injecting a recording transport and asserting it stayed empty. Timeout-bounded
and never-throwing like `conversions.js` — a hanging endpoint is cut by
`AbortSignal.timeout`, proven against a real never-answering local server.

**The two books rules W3 added:** a FAILED call sent nothing, so its audit row
carries the why but `outside_csw = 0` and no pricing — a failure can neither
burn tier quota nor look billable; and spend is estimated from **delivered**
billable rows only, because Meta charges at delivery (which is exactly what the
W2 webhook refines). The owner sees it in money: the 💰 card shows this month
and total in USD with per-category rates, labeled an estimate.

**Acceptance met:** free-form outside the window refused locally; marketing
without opt-in refused; the tier ceiling refuses before Meta does; a dead Graph
endpoint cannot hold a request open (`smoke-wa-send`, 25 checks). Admin send
form with per-refusal Hebrew explanations; template variable components are a
later phase.

### Phase W4 — inbound as CRM material
An inbound message becomes a timeline event on the resolved contact, through the
guarded seam, so a WhatsApp conversation and a web enquiry sit on one person's
history. This is the phase that makes the channel worth having.

---

## 3. What we do not take

- `graphBase` as a setting (see finding 1).
- The in-memory tier counter (finding 2).
- The lab's `package.json` test chain, or any generated artefact.
- Anything enabled by default.
