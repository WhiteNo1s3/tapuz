=== Tapuziel Pixel ===
Contributors: whiteno1se
Tags: analytics, crm, pixel, first-party
Requires at least: 6.0
Tested up to: 6.6
Stable tag: 1.0.0
License: MIT

First-party Tapuziel CRM pixel. Injects the universal tz-pixel.js loader — nothing else.

== Description ==

This plugin is a wrapper: it only knows where WordPress puts scripts and which
settings to pass. All event logic, privacy handling (DNT/GPC, no raw IP) and
identity live in the loader and the Tapuziel collector, not here. The plugin
performs no HTTP requests of its own.

Setup:

1. In your Tapuziel admin, open לקוחות → אתרים and register a site slug
   (e.g. `wp-acme`). Unregistered ids are silently dropped by the collector.
2. Activate this plugin, open Settings → Tapuziel Pixel.
3. Base URL = your Tapuziel origin (HTTPS; plain http is allowed for
   localhost only). Site ID = the slug you registered.

Identity note: calling `TapuzielPixel.identify({email})` on your pages creates
an unverified *claim* in Tapuziel that an admin must approve — it never
creates or merges a contact by itself.

== Changelog ==

= 1.0.0 =
* First release: settings page + loader injection. Inject-only by design.
