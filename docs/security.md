# Tapuz Security Model

This document is an **honest** description of what the Tapuz application protects
against on its own, and — just as importantly — what it **cannot** protect
against and therefore delegates to the infrastructure you deploy it behind.

Tapuz is a static-export CMS. The public site is plain, pre-built HTML served by
`express.static`. The Express server exists mainly to run the **admin/builder**.
Everything below is about protecting that admin surface and being clear about the
limits of an app-level defense.

---

## 1. Authentication (S1)

- **Real accounts.** The admin area requires a logged-in session. There is no
  default/anonymous access and **no hardcoded password**.
- **First-run flow.** When no admin account exists, every admin URL redirects to
  a *create admin account* screen where the operator sets their own username and
  password. Passwords must be at least 8 characters.
- **Password storage.** Passwords are hashed with **scrypt** (`crypto.scryptSync`)
  using a random 16-byte per-user salt. Only `salt:hash` is stored — never the
  plaintext. Verification is constant-time (`crypto.timingSafeEqual`).
- **Sessions.** Stateless, signed cookies: `base64url(payload).HMAC-SHA256(secret,
  payload)`. The signature is verified in constant time. The cookie is
  `HttpOnly`, `SameSite=Lax`, and `Secure` when the request arrives over HTTPS.
  - **Idle timeout:** 1 hour (the cookie slides forward on each authenticated
    request).
  - **Absolute cap:** 12 hours from issue, regardless of activity.
- **Secret + credential storage.** The session signing secret and the scrypt
  password hashes live in `config/auth.json`, which is **gitignored** and written
  with `0600` permissions (POSIX). The signing secret can instead be supplied via
  the `TAPUZ_ADMIN_SECRET` environment variable, which takes precedence and is
  never written to disk. Keep `auth.json` out of the web root and out of exports.
- **Single gate.** One `app.use` middleware gates the entire admin namespace
  (`/admin` and `/admin/*`). Only the login and create-account screens are exempt.
  Every admin page and every `/admin/api/*` mutation passes through it exactly
  once — there is no per-route opt-in to forget.

## 2. Configurable admin URL (S2)

The admin base path is configurable so the login screen isn't sitting at the
obvious `/admin`:

- Set it via the **`TAPUZ_ADMIN_PATH`** env var (recommended — keeps it out of
  git), or via `config/site.json` → `admin.path`.
- Default is `/admin`. A malformed value falls back to `/admin` so a typo can
  never brick the server.
- Internally all routes remain `/admin/...`; a top-of-stack rewrite maps the
  custom base onto them. When a custom base is set, the literal `/admin` path
  returns **404 to unauthenticated callers**, so scanners can't discover the
  login screen there.

> **This is security-by-obscurity — a layer ON TOP of authentication, never a
> replacement for it.** It raises the noise floor against automated scanning; it
> is not a real access control.

## 3. Abuse / brute-force resistance (S4)

Implemented at the application (L7) layer, in-memory, zero dependencies:

- **Per-IP admin flood cap.** A fixed-window limiter caps requests to the admin
  surface per IP (default 300 / minute) and returns `429` with `Retry-After`.
- **Login brute-force lockout.** Failed logins are tracked by **IP** and by
  **IP + username**. After 5 failures the account/IP is locked with an
  **escalating** delay (30s, then doubling, capped at 1 hour). A successful login
  clears the counter.
- **Request size caps.** URL-encoded bodies are capped at `256kb`. The JSON body
  cap is `12mb` — intentionally generous because base64 media uploads flow
  through it — and that endpoint is behind auth + rate limiting.
- **Slow-loris timeouts.** The HTTP server sets `setTimeout(30s)`,
  `headersTimeout=20s`, `requestTimeout=60s`, and `keepAliveTimeout=15s` so a
  client cannot hold sockets open by trickling bytes. Two admin-gated routes
  lift the 30 s idle cap **for their own socket only**, and put it back when the
  response is out (`src/socket-timeout.js`): the injection runner and — since
  v2.44 — the copilot's chat turn. Both wait on a model that legitimately says
  nothing for longer than that; the intake timeouts still apply to them.

### What the app CANNOT do — you MUST put infrastructure in front

The in-memory limiter runs **inside the Node process**. It cannot help with a
true **volumetric / L3–L4 DDoS**: a flood large enough to saturate the network
link or the OS socket backlog overwhelms the box before any of this code runs,
and the counters reset on restart and are not shared across processes/hosts.

**For real DDoS resistance you must deploy a CDN / reverse proxy in front of
Tapuz** — e.g. **Cloudflare**, a cloud WAF, or **nginx** with connection/rate
limits. That layer absorbs volumetric floods, terminates TLS, and should also be
configured to set a correct `X-Forwarded-For`. The application defenses above are
the *last* line, not the first.

**Per-IP identity and `X-Forwarded-For`.** By default the app keys every rate
limit and login lockout on the real socket peer address and **ignores**
`X-Forwarded-For` — that header is client-controllable, so trusting it blindly
would let an attacker rotate it to defeat every per-IP limit. Only when you run
Tapuz behind a trusted proxy that sets `X-Forwarded-For` itself should you set
**`TAPUZ_TRUST_PROXY=1`**; the app then reads the *rightmost* hop (the address
your proxy appended), never the client-forgeable leftmost one.

## 4. CSRF

**Chosen mechanism: `SameSite=Lax` session cookie + strict `Origin`/`Referer`
verification** on every state-changing admin request (`POST`/`PUT`/`PATCH`/
`DELETE`). A request whose `Origin` (or, absent that, `Referer`) host does not
match the request `Host` — or that carries neither header — is rejected with
`403`.

Why this instead of a double-submit token: the admin UI already issues ~50
same-origin XHRs from client scripts we don't want to rewrite. `SameSite=Lax`
stops the session cookie from riding along on cross-site POSTs, and the
Origin/Referer check is a hard same-origin gate that covers **all** of those
requests with no client changes. Modern browsers always send `Origin` on `fetch`
POSTs and `Referer` on form POSTs, so legitimate same-origin traffic is
unaffected.

---

## 5. Model-written raw HTML (v2.39)

`<bent-html>` renders **raw** by design — it is the owner's escape hatch, script included (`src/renderer.js`). A **model's** document is different: its output can be steered by what it read, so it is untrusted input. Found in the live hard tests: a copilot proposal carrying `<script>`, `onerror=` and a `javascript:` link passed every check, was approved (the proposal preview is sandboxed, so nothing showed) and saved; the builder's 👁 live preview then ran it on the admin origin, inside the owner's session, and the paste flow's "save and publish" would have served it to visitors.

- **Every AI door scrubs** `bent-html` content with `src/html-sanitize.js` (`src/ai-html-guard.js`): the copilot proposal (so the owner approves exactly what will be saved, with a Hebrew notice), `create_page` / `edit_page`, `POST /admin/api/pzn/create-from-source`, `POST /agent/v1/create-from-source`, and the paste flow's `POST /admin/api/pzn/source` (marked `from: 'ai'`). The owner's own source editor and builder keep raw HTML exactly as written.
- **The admin previews run in an opaque origin**: the builder's live preview iframe and the paste preview iframe are `sandbox` without `allow-same-origin` (scripts still run, so the preview is faithful, but they cannot reach the admin session), and `/admin/preview/:page` sends `Content-Security-Policy: sandbox allow-scripts allow-popups` for the page opened on its own.
- **Residual:** the theme studio canvas renders the site same-origin (its effect guard reports through `postMessage` with an origin check, and site scripts that touch storage would fail in an opaque origin). Model-written page HTML no longer reaches it through the AI doors; a theme's effect JS is the owner-approved theme and runs there by design.

Pinned by `scripts/smoke-ai-html-guard.js`.

### 5א. The copilot's menu write (v2.43)

`organize_menu` is the one copilot write that is **live, not a draft** (a site has no draft menu), so its gate carries more weight than the page tools':

- **Nothing a model writes reaches the menus without the owner's ✓.** The write is `mutates:true` — the tool loop stops, the conversation state stays on the server under a single-use id, and the browser holds only that id. A refusal writes nothing and takes no backup. (Checked by hand while building it: with `organize_menu` flipped to `mutates:false` the smoke goes red exactly at "NOTHING was written … while the proposal waits" — the checks can fail.)
- **The document goes through the organizer's door** (`parseMenuReply`) at the proposal *and again* at the moment of writing: a url allowlist, not a blocklist (`javascript:` split by a tab, a newline or a bidi mark is dropped — see [bent-menus.md](bent-menus.md) "Warnings"); a link to a page that does not exist is refused to the model, never shown to the owner; labels are text and reach every admin surface through `textContent`.
- **The way back is not a tool.** `applyMenuPlan` snapshots the menus, the locations and the layout knobs first (`config/menu-backups`, newest 10); undo is the owner's own click on the existing restore route, which snapshots again before restoring. The copilot cannot restore, delete or publish.
- **The previews are framed without scripts.** The menu canvas and the proposal frame load `/admin/menus/preview/:id` in `sandbox="allow-same-origin"` — no `allow-scripts` — the same rule as the page proposal frame; the route answers `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`.

Pinned by `scripts/smoke-copilot-tools.js` and the numbered gate in `scripts/smoke-copilot-route.js`.

## 6. The store's public doors (v2.53)

The store adds the one public write a shop needs — placing an order — and
keeps it narrow (`src/routes/store-public.js`, `docs/bent-store.md`):

- **No price is trusted from a browser.** The cart in `localStorage` is
  sku + option + qty; the quote, the checkout summary and the order are all
  computed on the server from the database (`pricing.quote`). A tampered
  price is ignored — pinned by `smoke-store` and `smoke-store-route`.
- **Stock and coupon uses cannot be double-spent.** An order is one
  `BEGIN IMMEDIATE` transaction with guarded `UPDATE … WHERE stock >= qty`
  and `… WHERE used < max_uses`; two processes racing for the last unit get
  one order.
- **Each door has its own 32 KB JSON parser** (mounted before the admin's
  12 MB one), a per-IP limit (checkout 8/min, quote 120/min, order view
  60/min, `TAPUZ_STORE_*_MAX` to override), a honeypot on checkout, and
  replies with no stack or internal id. JSON only: a cross-site form cannot
  post `application/json` without a preflight, so a foreign page cannot
  place an order from a visitor's browser.
- **The order page is a capability link** (a 24-character random token) and
  shows no phone, email or street — a shared screenshot of it hands out
  nothing personal. `no-store` + `noindex`.
- **No card number exists to leak.** Payment methods are instructions
  and the address of the owner's own payment page (`https` only, filled with
  `{total}` / `{order}` — never personal data); a card is entered on the
  gateway's hosted page, never on ours. The gateway's keys are the one
  payment secret, and §6א says where they live.

### 6א. The card gateway (Grow / Cardcom — `src/store/gateway`, `docs/bent-store.md`)

The gateway is the door that moves money, so its threat model is written
down, threat by threat:

- **A forged callback ("this order is paid").** Never believed as such. The
  row is found by the provider's *session id* only, then: *Cardcom* sends
  no signature, so its callback is a hint and the verdict is our own
  `GetLpResult` with the stored ids and the terminal's keys — PAID needs the
  top `ResponseCode` 0 (anything else is inconclusive, whatever sits
  inside), our `LowProfileId` / terminal / `ReturnValue`, `Operation`
  "ChargeOnly", `TranzactionInfo.ResponseCode` 0 (700/701 are J5/J2 holds —
  no money), `IsRefund` false, `DealType` "Debit", a real transaction id
  from inside `TranzactionInfo`, and the amount and coin of the order.
  *Grow* asks that inquiries not run per transaction, so its callback is
  **token-anchored**: the sha256 of `data[processToken]` must equal the
  hash we stored when Grow gave us the token (constant-time compare of the
  two digests), plus `processId`, `statusCode` "2", a transaction id that is
  not "0", and our reference in `cField1` (a correlation check only — Grow
  shows the cFields to the buyer). *Residual risk, stated:* the anchor is a
  documented secret that never leaves our server; if it ever reached a
  buyer, a forged callback could mark that one order paid. Grow's hosted
  URL does not carry it (and the driver refuses one that does); the owner
  can cross-check the approval number in Grow's back office. A body with
  no `processToken` gets a quiet 200 and no action. Keys that are gone do
  not lose a real callback: Grow's settles by hash (no acknowledgement,
  noted on the row); Cardcom's is said once on the order and answered 503
  so Cardcom retries.
- **The proof at rest.** The database is the `.pzn` the owner downloads and
  hands around, so a Grow `processToken` is never in it in the clear: the
  row keeps its sha256 (what a callback is checked against) and a copy
  sealed with AES-256-GCM — a fresh 12-byte IV per seal, the auth tag
  stored and verified on open — under `_tokenKey`, 32 random bytes made
  once in `config/payments.json` and kept through every provider save and
  "ניתוק"; the seal is cleared the moment the row is settled. The key never
  appears in the database, an API, the admin view or a log line (asserted
  by the smoke). A backup restored on another install therefore still
  verifies callbacks by hash and only loses the inquiry fallback for its
  old rows, with a clear admin message and no crash.
- **Amount tampering.** The session is created with the amount *from the
  database* (`order.total`), never from a request; `settle()` compares the
  provider's amount and currency to the order in the same transaction, and
  a difference is `mismatch` — an event, an owner mail, and the order is not
  marked paid. `mismatch` rows are final: no refund action, because the
  charged amount is not ours to guess.
- **Replay and races.** `settle()` is a guarded `UPDATE … WHERE status IN
  ('pending','failed')` inside `BEGIN IMMEDIATE`, and `UNIQUE (provider,
  mode, transaction_id)` makes one provider transaction settle at most one
  row per mode (Grow's sandbox and production number transactions
  independently): a duplicate callback or a concurrent order-page verify
  changes nothing, and the same transaction replayed against another order
  is refused with an owner-visible event and mail ("העסקה כבר נרשמה בתשלום
  אחר"). The order page checks every unpaid session of the order, newest
  first, each behind its own throttle (the first poll only starts the clock
  — Grow's callback gets 20 s, Cardcom's 5 — then ≥ that gap, ≤ 60 times,
  ≤ 24 h per row) and at most two provider calls per page load; the
  callback and the admin's own per-row check are bounded per row and per
  IP.
- **Refunds cannot double-spend.** The sum is reserved on the row — and
  the row locked for the call — with one guarded `UPDATE … WHERE refunded
  + ? <= amount AND (refund_lock IS NULL OR stale)` before the provider is
  asked, so two clicks — or two processes — cannot both send a refund, and
  only one refund of a row is ever in flight. The reservation is recorded
  AS an unknown sum until the provider answers, so a crash mid-call
  surfaces as a decision for the owner rather than a silent "refunded";
  a definite refusal releases the reservation, an unknown outcome
  (timeout, 5xx) keeps it as an
  "unknown" sum the owner resolves after a look in the provider's panel
  (no further refund touches the row until then), and a refund names its
  row. The order's `paid_at` is cleared in the same transaction as the
  books only when the gateway itself had set it and no live row holds
  money any more — an order marked paid by hand keeps its mark.
- **Exfiltration via a redirectable host.** Hosts are constants inside each
  driver (Cardcom: one host, test = terminal 1000; Grow: sandbox /
  production), and the transport a driver receives refuses any other host
  before bytes leave. No setting, env var or request field names a host;
  the smoke greps the drivers for it. TLS is never relaxed.
- **Secrets at rest and in transit to the owner.** The keys live in
  gitignored `config/payments.json` (mode 0600) — never the database (which
  IS the `.pzn` the owner downloads, restores and hot-swaps), never the site
  package, never `<bent-store>`. Every admin surface sees readiness and a
  last-4 tail; a value is typed in and never read back. Provider error text
  reaches the admin only after every stored key and token is redacted; the
  shopper gets a Hebrew sentence. Grow's `processId` / `processToken` /
  `transactionToken` and Cardcom's `LowProfileId` stay on the payment row:
  no browser JSON, HTML, event, CSV or log line carries them (asserted by
  the smoke).
- **The hook door itself.** Mounted before the body parsers with its own
  `express.raw` (64 KB), parsed by us (JSON whatever the Content-Type,
  urlencoded, or multipart through the platform's `Response.formData()`),
  per-IP limited, and uninformative: a refusal, an unknown id and a settled
  outcome all get the provider's expected 200 "OK"; a 5xx only when *our*
  inquiry failed for a known pending row, so Cardcom retries. A provider
  whose keys we do not hold gets 404.
- **Return addresses.** Built only from an https `config.baseUrl`, in both
  modes; there is no request-origin fallback, so a spoofed `Host` header can
  never choose where the provider sends the buyer or the callback.
- **Test mode is never money.** A test confirmation records the row and an
  event but never `paid_at`; the storefront says so; the dashboard shows a
  red line while the store is open in test mode. Cardcom has one host, and
  only terminal 1000 clears without charging: test mode refuses every
  other terminal, live mode refuses 1000. Switching test → live needs
  `confirmLive: true` on the wire (the screen sends it only after its own
  confirm), and the ₪1 connection test hands back a payable page address in
  test mode only.
- **Refunds** are explicit admin actions behind `requireAdmin` and a typed
  confirmation (the order number); nothing is refunded automatically, and
  the manual "paid" checkbox cannot un-pay money the gateway still holds.
- **Every store screen and API is `requireAdmin`** — an editor gets 403
  (prices, and customers' names and addresses). The orders CSV guards against
  spreadsheet formula injection.
- **The storefront script writes remote text with `textContent` only**
  (`public/tz-store.js` has no `innerHTML`, no `eval`) — a product name is
  data, never markup; the server-rendered modules escape every field and
  the Product JSON-LD escapes `<`.

## Operator checklist

- [ ] Serve Tapuz **behind HTTPS** (so `Secure` cookies engage) via a reverse proxy.
- [ ] Put a **CDN/WAF (Cloudflare/nginx)** in front for volumetric DDoS + TLS.
- [ ] Set **`TAPUZ_ADMIN_SECRET`** (a long random string) in the environment.
- [ ] Set a non-obvious **`TAPUZ_ADMIN_PATH`**.
- [ ] If (and only if) behind a trusted proxy that sets **`X-Forwarded-For`**, set **`TAPUZ_TRUST_PROXY=1`** so per-IP limits key on the real client, not the proxy.
- [ ] Keep **`config/auth.json`** off version control and outside the web root/exports.
- [ ] Rotate the admin password if the dev/default credential was ever used.
