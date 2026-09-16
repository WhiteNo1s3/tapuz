# Tapuziel — מלווה ההעתקה (BYOT companion)

The whole philosophy: **the extension does nothing on the LLM sites.**
No content scripts, no DOM reading, no auto-send, no host permissions —
the public chats are our natural partners; the user is the only one who
acts there. Their UI can change every week and nothing here breaks.

## The flow

1. Type your thought in the popup ("דף נחיתה לחנות פרחים…")
2. **📋 העתק** — one click copies [roleplay pack + BenTML dictionary +
   your site's real media + your thought], fetched live from YOUR Tapuziel
3. Paste into any chat you're logged into (ChatGPT / Claude / Grok /
   Gemini) and press send **yourself**
4. Copy the reply, paste it into the popup, **📥 צור דף** — the server
   extracts/repairs and it becomes a real draft, one click from the builder

## Install

- **Chrome/Edge**: `chrome://extensions` → Developer mode → Load unpacked
  (this folder), or drag the ZIP from האתר → ניהול → חיבור AI
- **Firefox** (115+): `about:debugging` → This Firefox → Load Temporary
  Add-on → pick `manifest.json` (permanent install needs AMO signing)

**0.4.2 — Firefox works.** Up to 0.4.1 the popup read and wrote its settings
with callbacks (`storage.local.get(keys, cb)`). Chrome accepts that; Firefox's
promise-only `browser.*` refuses it, so the Firefox build never loaded its site
address or token and every button said "connect first". Storage is now
promise-style, the one shape both browsers take, and `smoke-extension` runs the
popup against a strict Firefox-like `browser` that throws on a callback.
Reload the extension after updating (download the ZIP again from חיבור AI).

## Connect

Create an agent token in ניהול → גשר סוכן, paste it in the popup with your
site's address. The token is stored in extension storage and sent only to
that address (the /agent/v1 API speaks CORS, so no host permissions at all).
