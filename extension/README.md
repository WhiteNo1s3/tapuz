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

## Setup

1. In Tapuziel admin → **גשר סוכן** (`/admin/agent`), mint a token (write scope).
2. `chrome://extensions` → enable Developer mode → **Load unpacked** → pick this
   `extension/` folder. (Add a 128×128 `icon.png` first, or remove the `icons`
   key from `manifest.json`.)
3. Click the extension icon: enter your CMS URL (e.g. `http://localhost:3000`)
   and paste the token → **שמור** → **בדוק חיבור** (should say "מחובר").
4. Click **📋 העתק מדריך ל‑AI** and paste the primer into your LLM chat.

## Use

1. Ask your LLM (in its normal tab) to build a page. It replies with `.pzn`.
2. Click the floating **🍊 → תפוזיאל** button on the chat page.
3. The extension extracts the `.pzn` and publishes it to your CMS; a toast links
   to the live page. Target a specific page or "new page" from the popup.

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
