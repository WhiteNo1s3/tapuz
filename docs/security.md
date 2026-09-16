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
  client cannot hold sockets open by trickling bytes.

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

## Operator checklist

- [ ] Serve Tapuz **behind HTTPS** (so `Secure` cookies engage) via a reverse proxy.
- [ ] Put a **CDN/WAF (Cloudflare/nginx)** in front for volumetric DDoS + TLS.
- [ ] Set **`TAPUZ_ADMIN_SECRET`** (a long random string) in the environment.
- [ ] Set a non-obvious **`TAPUZ_ADMIN_PATH`**.
- [ ] If (and only if) behind a trusted proxy that sets **`X-Forwarded-For`**, set **`TAPUZ_TRUST_PROXY=1`** so per-IP limits key on the real client, not the proxy.
- [ ] Keep **`config/auth.json`** off version control and outside the web root/exports.
- [ ] Rotate the admin password if the dev/default credential was ever used.
