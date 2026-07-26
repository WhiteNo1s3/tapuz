# Tapuziel Pixel on Builder.io

The wrapper for Builder is a paste, because Builder's injection surface is
**Custom Code**. Same universal loader as every CMS; no collect logic here.

## Setup

1. In Tapuziel: לקוחות → אתרים → register a site slug (e.g. `builder-acme`).
   The collector silently drops unregistered ids — that is the multi-tenant
   guard, not an error.
2. In Builder.io: **Settings → Custom Code → Head** (or a global Symbol that
   renders on every page), paste:

```html
<!-- Tapuziel Pixel — docs/PIXEL-EMBED-INTEGRATION.md -->
<script
  src="https://YOUR-CRM-HOST/tz-pixel.js"
  data-tz-pixel-base="https://YOUR-CRM-HOST"
  data-tz-pixel-site="builder-acme"
  data-tz-pixel-spa="1"
  defer></script>
```

`data-tz-pixel-spa="1"` matters on Builder: route changes are pushState, and
the SPA hook fires a pageview per route instead of one per hard load.

HTTPS only — the loader and collector refuse to be wired over plain http
outside localhost.

## Optional API on your pages

```js
TapuzielPixel.track('Lead', { value: 1 });
TapuzielPixel.identify({ email: 'a@b.com' }); // lands as a CLAIM awaiting admin approval
TapuzielPixel.page();                          // manual SPA route (if spa attr off)
```
