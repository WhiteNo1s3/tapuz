# Tapuziel Bridge (Chrome extension)

Turn **your own** ChatGPT / Claude / Grok / Gemini session into a Tapuziel page
builder. No API keys, no token middleman — the LLM runs in your browser on your
subscription, the extension carries only the reply to your CMS.

## Security model (first-party by design)

- The CMS **bearer token lives only in the background service worker**
  (`chrome.storage`, read only there). It is **never** sent to a content
  script or a web page.
- Content scripts on the LLM sites only **read the latest assistant message**
  and ask the background worker to publish it. They hold no credential.
- The worker fetches **only your configured CMS origin**, with the token in an
  `Authorization: Bearer` header (never a cookie).
- Nothing leaves your browser except the page you asked to build, sent to your
  own CMS.

The server still validates every reply (path/URL/scheme hardening) — not
distrust of you, but because an LLM's output can be steered by content it reads.

## Test it locally in 5 steps (no Apache/nginx — Tapuziel IS the server)

Tapuziel is a Node app; it serves itself. You do **not** need a separate web
server.

1. **Start the CMS** — from the repo root:
   ```bash
   npm run seed:admin          # optional: instant  admin / admin  login (dev only)
   node src/server.js          # → http://localhost:3000/admin
   ```
   First run drops you into the setup wizard — or run `seed:admin` first to skip
   it and log in with `admin` / `admin` (local, gitignored, dev-only).
2. **Mint an agent token** — in admin go to **גשר סוכן** (`/admin/agent`),
   create a token with **write** scope, and copy it (shown once).
3. **Load the extension** — `chrome://extensions` → enable *Developer mode* →
   **Load unpacked** → pick this `extension/` folder. (Icons ship in the repo;
   if you ever see "could not load icon", run `node scripts/gen-extension-icons.js`.)
4. **Connect** — click the extension icon: CMS URL `http://localhost:3000`,
   paste the token → **שמור** → **בדוק חיבור** (should say "מחובר …").
   *If it says "failed to fetch", the server isn't running at that URL.*
5. **Use it** — click **📋 העתק מדריך ל‑AI**, paste the primer into your
   ChatGPT/Claude chat, ask for a page, then on that chat tab click the floating
   **🍊 → תפוזיאל** button. The page publishes to your CMS.

Using a real domain instead of localhost? Just enter it as the CMS URL — the
popup will ask Chrome for permission to reach that origin when you click **שמור**.

## Use

1. Ask your LLM (in its normal tab) to build a page. It replies with `.pzn`.
2. Click the floating **🍊 → תפוזיאל** button on the chat page.
3. The extension extracts the `.pzn` and publishes it to your CMS; a toast links
   to the live page. Target a specific page or "new page" from the popup.

### Delivery modes (per host)

- **Claude / Grok** — the ①/② panel buttons inject the roleplay pack straight
  into the composer and send.
- **ChatGPT / Gemini** (`copyFirst` in `providers.js`) — these sites ignore (or
  freeze on) synthetic composer writes, so ①/② **copy the pack to the
  clipboard** and the panel tells you to paste (Ctrl+V) and send. Everything
  after that — watching the reply, extracting the `.pzn`, publishing to your
  CMS — is identical on all four hosts and needs no injection.

## Tuning selectors

`providers.js` holds per-site CSS selectors for the assistant message. LLM sites
redesign often; if scraping stops working, update the `assistant` selector for
that provider (inspect the newest reply block in the page).

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest (LLM host permissions + optional CMS host) |
| `background.js` | Holds the token; message router; CMS fetch (`/agent/v1/*`) |
| `content-bridge.js` | Floating button + scrape latest reply (no token) |
| `providers.js` | Per-provider scrape selectors (Claude/ChatGPT/Grok/Gemini) |
| `extract.js` | Pull `.pzn` out of the reply |
| `popup.html` / `popup.js` | Configure CMS URL + token, ping, copy primer, target |
