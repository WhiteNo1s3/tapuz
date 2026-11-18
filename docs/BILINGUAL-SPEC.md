# Tapuziel bilingual site: pages-only import + per-language menus

Owner: Ben Shaltiel · Spec: Morris (Nov 18, 2026) · Builder: Tomer (Grok Build, local)
Delivery: **draft PRs only** on WhiteNo1s3/tapuz. No merge, no push to main, never mark ready (green CI on a ready PR auto-merges and redeploys both live sites).

## Why
The Hebrew site (cyan-barracuda) becomes the one real bilingual site and gets the domain.
The English twin (lightpink-goshawk) stays the English working copy, later inactive.
The v1.08 pairing already exists (`/admin/translations`, `meta.translationGroup` + `meta.lang`,
`getTranslations` / `linkTranslations` in `src/pages.js`, `renderLangSwitcher` + hreflang in `src/renderer.js`).
Two pieces are missing to make it practical.

## Today's behaviour (verified in code)
- `importSitePackage` (`src/site-package.js`) skips existing paths when overwrite is off (good),
  but **always** replaces theme (`saveOverrides`), menus (`saveMenus`) and config
  (`title, description, language, logo, seo, homepage`), and merges the store. A package from the
  English site therefore turns cyan's chrome English.
- The package carries page sources only. No `/assets` files, so image paths break on another site.
- Menus are one site-wide set (`menus` table keyed by name, `getMenu('main')`). The renderer calls
  `renderMainMenu(mainMenu, currentUrl, knobs, lang)` with the same menu on every page, so English
  pages in an RTL site get the Hebrew RTL menu. This is the "RTL/LTR mixed-direction menu" gap in docs/COMPETITIVE.md item 5.
- The language switcher is a floating pill, shown only when a page has linked siblings.

## Feature 1: pages-only import
Export side (`GET /admin/api/site-package/export`):
- Add `?assets=1`, which bundles every `/assets/...` file referenced by exported pages (hero backgrounds,
  image blocks, gallery tiles, cards, og:image) as `{ path, mime, base64 }` plus a manifest.

Import side (`POST` site-package import + UI in `src/routes/settings.js`), new options:
| option | effect |
|---|---|
| `mode: "pages"` | skip theme, menus, config and store entirely |
| `prefix: "en/"` | `bridge` becomes `en/bridge`; rewrite internal links/hrefs between imported pages to the prefixed paths; home `/` becomes `en/` (or `en/home`) |
| `lang: "en"` | set `meta.lang` on every imported page (page keeps its own LTR direction, per docs/hebrew-rtl.md) |
| `assets` | restore bundled files; same name + same bytes means reuse, same name + different bytes means rename and rewrite references |
| `translations: { "en/bridge": "הגשר", ... }` | call `linkTranslations(prefixed, lang, target, siteLang)` per pair; skip missing targets with a warning |
| `dryRun: true` | return created / skipped / linked / assets-added lists, change nothing |
| `overwrite` | unchanged rule: never clobber unless checked; reserved paths keep the `-2` suffix rule |

UI: a "pages only" checkbox, a prefix field, a language field, an optional mapping (textarea or auto-suggest
by matching translationGroup ids when both sites share them), and a **Preview** button before Import.

## Feature 2: per-language menus
- Storage: allow language-scoped menu names, e.g. `main`, `main@en`, `footer`, `footer@en`
  (or a `lang` column). The default (no suffix) = site language.
- `/admin/menus`: a language selector; edit, save and "שמור + בנה" per language; .bent menu export/import per language.
- Renderer: pick `main@<page.meta.lang>` when it exists, otherwise `main`. Same for footer.
- Header direction follows the page: an LTR page in an RTL site gets `dir="ltr"` on header/nav, mirrored
  alignment, sub-menus and dropdowns opening the right way, and the mobile menu too.
- EN/HE switch: render `renderLangSwitcher` inside the header (top), zero-JS, linking to each sibling's
  real URL; keep the floating pill as an option (theme knob) and hide it when the header switch is on.
- Static build (`שמור + בנה` / export) outputs the correct menu + direction per page.

## Acceptance / smoke tests
1. Pages-only import into a Hebrew site leaves theme, menus, config and store byte-identical.
2. Prefix + link rewrite: imported `en/bridge` links to `en/geppetto`, not `/geppetto`.
3. Asset round-trip: images render on the target site with no broken src; dedup works.
4. Translation mapping links pairs; both pages show the switcher and correct hreflang.
5. Dry run changes nothing and lists accurately.
6. Mixed direction: Hebrew page gets RTL Hebrew menu; `en/` page gets LTR English menu with header switch;
   fallback to the site menu when no `@en` menu exists.
7. Static export matches the live render for both.

## Notes
- Expect version/ROADMAP conflicts with open drafts #65 to #69; rebase after whichever merges first.
- Don't touch the peachpuff WordPress site or happynotch.
