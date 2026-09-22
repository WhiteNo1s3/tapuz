# Tapuziel — send to Geppetto (Figma plugin, development mode)

A tiny Figma plugin that exports the current page — or the frames you
selected — as one JSON file for Tapuziel's Figma import. Your own Figma does
the reading, so **no access token is needed** and nothing leaves your computer
until you upload the file. It is never published; you load it from this folder.

## Install (once)

1. Open Figma **desktop** (the plugin menu below is not in the browser app).
2. Menu → **Plugins → Development → Import plugin from manifest…**
3. Pick `integrations/figma-plugin/manifest.json` from your Tapuziel checkout.
   Figma may rewrite the `id` in the manifest — that is fine.

## Export

1. Open the design file and the page you want, optionally select the frames
   (nothing selected = every top-level frame of the page).
2. Menu → **Plugins → Development → Tapuziel — send to Geppetto**.
3. Click **Export page** (or **Export selection**), then **Download JSON**
   (or **Copy JSON** for small exports).
4. In Tapuziel's admin: **ייבוא → ג׳פטו** (`/admin/geppetto`), the **קובץ שמור**
   tab, upload the file. Geppetto gives it a life — sections, headings, cards,
   a menu, a theme — and shows you a preview before anything changes.

## What travels

* Every frame as the REST API describes it (same field names, children nested):
  auto-layout, fills, strokes, radii, effects, texts with their styled runs,
  links (URLs and jumps to other frames), rotation.
* Pictures as embedded data URLs, keyed by the image hash: a JPG no wider than
  1600 px, or a PNG when the picture needs transparency (rounded corners,
  opacity, a PNG/GIF/WebP source). Vectors as SVG.
* Local colour variables as the palette.

## Limits

* The import door accepts 12 MB, so the export stops adding pictures at
  **11 MB** and says so in its `notes`; a single picture over 5 MB is skipped.
  The frames are still exported — add the missing pictures in Tapuziel.
* Videos are not exported (Figma gives plugins no video bytes).
* Frames narrower than 900 px are treated as phone variants when their name
  matches a desktop frame ("Home" / "Home — Mobile"); otherwise they are noted
  and skipped.

`code.js` runs in Figma's sandbox; its serializer is a pure function, so
`scripts/smoke-geppetto-figma.js` exercises it in Node with a mocked tree.
