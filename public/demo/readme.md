# public/demo — the welcome page's stand-in art

Eight small, hand-written SVG tiles used by the **showcase** starter template
(`src/templates.js`) — the page a brand-new site opens with.

Why files and not data-URIs: a `.pzn` page stays readable, the tiles show up in
the media picker like any other image, and swapping one for a real photo is a
two-click edit instead of a hunt through base64.

Why SVG and not photos: a few hundred bytes each, no licensing question, no
broken-image risk offline, and they scale to any container without blurring.
They are deliberately abstract — no text, so they need no translation, and
nobody mistakes them for the site's real content.

Safe to delete once a site has its own images; the showcase page is meant to be
edited apart or thrown away.
