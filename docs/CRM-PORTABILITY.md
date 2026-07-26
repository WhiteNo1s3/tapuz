# Can another CMS use this CRM? — a measured answer

**Tested:** v1.84, live, three systems running at once ·
**Question (Ben):** *"I plan this CRM to be adjusted by community to make it work
on other CMSs, we might want to standardize this."*

This is not a design discussion. A **foreign page** — 40 lines of plain Node on
`localhost:3200`, no Express, not one line of Tapuziel code — was pointed at a
live Tapuziel CRM on `localhost:3000` and told to behave like a third-party CMS.
Everything below is what the browser and the database actually did.

---

## The verdict

**The CRM is write-portable today, and read-portable never.** A foreign system
can *feed* it without any code from us. It cannot *query* it, and — the finding
that matters — it cannot **attribute** or **honour consent** without a CORS
contract we have not built yet.

| What a foreign CMS tried | Result | Why |
|---|---|---|
| `POST /_tapuz/collect` — pageview beacon | **works** | CORS "simple request": no preflight, no credentials needed |
| `POST /api/form` — lead capture | **works** | same; form-urlencoded is a simple request |
| `<img src="/crm/o/<token>.gif">` — open pixel | **works** | images are exempt from CORS |
| Reimplementing the consent contract locally | **works** | it is just `tz_consent` = `granted\|denied` in localStorage + cookie |
| `GET /crm/cs/v1/config` — read anything | **blocked** | no `Access-Control-Allow-Origin` on any endpoint |
| Attributing a visit to a known person | **blocked** | cross-origin `fetch` omits cookies by default, so `tz_v` never arrives |
| Retrying with `credentials:'include'` | **blocked** | CORS rejects it outright — we send no allow-credentials header |

### Proof the writes are real, not just accepted

The foreign page submitted one lead. Server-side, in Tapuziel's database:

```
pageview from foreign system: 1
contact created: { id: 6, name: 'מבקר ממערכת זרה',
                   email: 'foreign@example.com', source: 'foreign-cms' }
form submissions: 1
timeline: [{"type":"form","path":"foreign-cms"}]
```

A person was resolved, sourced and given a timeline — from a system that has
never heard of us. That is the part worth standardising.

### Proof of the attribution gap

Same foreign page, same browser, immediately after:

```
anonymous pageview recorded: 1
attributed to a PERSON:      0   (cookie did NOT travel)
```

Then, isolating the cause rather than guessing: `mode:'no-cors'` delivers the
request but omits cookies, and `credentials:'include'` is refused by CORS before
it leaves. So the blocker is **not** the cookie's `SameSite` attribute — it is
that we publish no CORS policy at all. Two different failures, one missing
feature.

**This currently fails in the safe direction.** With no consent cookie visible,
phase-3b server-side conversions refuse to send anything (`no-consent`). A
foreign integration therefore under-reports rather than tracking someone who
refused — correct, but **silent**, which is its own problem.

---

## What standardising would mean

The honest split is that this CRM already has two very different surfaces, and
only one of them should ever be portable.

### 1. The ingest contract — portable today, worth writing down

Three endpoints and one storage convention, all of which already work from a
foreign origin with zero shared code:

- `POST /_tapuz/collect` — `{path, ref}`, `Content-Type: text/plain` to stay a
  simple request. Honours DNT/GPC. Never attributes an anonymous visitor.
- `POST /api/form` — form-urlencoded; field names are matched loosely and in
  Hebrew (`email`/`mail`/`אימייל`, `phone`/`טלפון`, `name`/`שם`), so a foreign
  form needs no renaming.
- `GET /crm/o/<token>.gif`, `/crm/c/<token>/<index>`, `/crm/u/<token>` — email
  tracking, already origin-independent because mail clients are foreign systems
  by definition.
- Consent convention: `tz_consent` = `granted` | `denied`, in localStorage **and**
  a cookie, with `window.tapuzConsent.grant()/.deny()` as the API. Any CMS can
  implement this in ten lines — the foreign probe did.

This is a small, stable contract. It is what a community port should target, and
documenting it costs nothing because it is already true.

### 2. The attribution + consent path — needs one deliberate feature

To let a foreign page attribute visits and have the server honour the visitor's
consent, we would need:

- `crm.allowedOrigins` — an explicit allowlist, **empty by default**.
- `Access-Control-Allow-Origin` echoed only for a listed origin (never `*`, which
  is incompatible with credentials anyway), plus
  `Access-Control-Allow-Credentials: true` and a `Vary: Origin`.
- The `tz_v` and `tz_consent` cookies re-issued as `SameSite=None; Secure`, which
  means **HTTPS becomes mandatory** for cross-site attribution. Worth saying out
  loud: a community integration on plain HTTP cannot have attribution, and
  should not be told otherwise.

That is a genuinely small feature. It is also a real widening of the CRM's
surface, so it belongs behind its own flag and its own review — not bolted onto
the ingest contract above.

### 3. What must never be portable

Reads. Contacts, segments, transcripts and campaign results are `requireAdmin`
and same-origin, and that should not change. A CRM that lets a foreign origin
*read* customer data is a data-breach generator, however convenient. If a
community CMS needs to display CRM data, the answer is a scoped **agent token**
(the mechanism already exists for the Chrome extension) — server-to-server, never
browser-to-browser.

---

## Recommendation

1. **Write down the ingest contract** (§1) as the public standard. It works now,
   it is small, and it is what a port actually needs. No code required.
2. **Treat cross-origin attribution as a separate, flagged feature** (§2) — worth
   building when someone actually asks, with HTTPS stated as a precondition.
3. **Keep reads same-origin forever** (§3); point integrators at agent tokens.
4. **Make the silent failure loud:** when server-side conversions refuse for
   `no-consent`, that count is already recorded — surface it in the admin so an
   owner can tell "nobody consented" apart from "my integration cannot see
   consent".

Item 4 is the only defect this exercise found in what we have shipped. The rest
is a decision about how much surface to expose, which is Ben's call, not a bug.

## Addendum (v1.92) — the transfer format is SQLite, forever

Ben's decision, after the v1.91 JSON package experiment: *"it's brickable, the
fact it's in parts — we move to sqlite forever now."* The rule for every port
and for the community CRM builds:

- **`tapuz-db` = a SQLite 3 database file**, stamped
  `PRAGMA application_id = 0x5450555A` (`'TPUZ'`) in the header, downloadable
  as `.pzn`. SQLite is the open, archival-grade standard every language reads
  — a better "anyone can implement" story than any JSON shape we could design.
- Transfers are **whole-file, single-artifact** — a snapshot via `VACUUM INTO`
  (consistent under WAL). Nothing chunked, nothing that can half-land.
- An importer MUST verify `quick_check` **and** identity (the `TPUZ`
  application_id, or the presence of the expected schema) *before* touching
  its own data — accepting a healthy-but-foreign file is a wipe.
