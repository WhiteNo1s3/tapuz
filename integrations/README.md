# Integrations — CMS wrappers for the Tapuziel pixel

**The one rule (docs/PIXEL-EMBED-INTEGRATION.md):** a wrapper only knows how
to *inject* the universal loader. It never reimplements collect logic — no
HTTP calls, no event handling, no identity. If a wrapper needs more than
"put this `<script>` tag where this CMS puts scripts, with these settings",
it is doing too much. `smoke-wrappers` enforces this statically.

The loader itself is served by your Tapuziel at `/tz-pixel.js`; events land at
`/_tapuz/collect`. The `site_id` a wrapper is configured with must be
**registered** in Tapuziel (לקוחות → אתרים) — unregistered ids are silently
dropped by design.

| CMS | Wrapper | Injection surface |
|-----|---------|-------------------|
| WordPress | [`wordpress/tapuziel-pixel/`](wordpress/tapuziel-pixel/) | `wp_enqueue_scripts` plugin |
| Builder.io | [`builder.io/README.md`](builder.io/README.md) | Custom Code (Head) paste |
| anything else | paste the snippet from לקוחות → אתרים | theme `<head>` |
