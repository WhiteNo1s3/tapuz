# Hebrew & RTL Support in Tapuz

**RTL is not an afterthought.** It is a core requirement.

## Requirements

- All public pages must render correctly in RTL by default
- Admin panel should support Hebrew UI (at minimum labels + directions)
- Content is primarily Hebrew (we may add English later)
- Direction should be easy to control per page or per theme if needed
- No broken layouts when using Hebrew text

## Technical Approach

### 1. HTML Direction
- Use `dir="rtl"` and `lang="he"` on the `<html>` tag for Hebrew pages
- Themes must respect `dir="rtl"`
- CSS should use logical properties where possible:
  - `margin-inline-start` instead of `margin-left`
  - `padding-inline-end` instead of `padding-right`
  - `text-align: start` / `end`
  - `flex-direction` with care

### 2. Theme Standard Updates (RTL)
Themes **must** support RTL properly. `theme.json` should declare RTL support:

```json
{
  "name": "...",
  "rtl": true,
  "supports": {
    "rtl": true,
    "ltr": false
  }
}
```

Base CSS should include RTL overrides using `[dir="rtl"]` selectors or CSS logical properties.

### 3. Admin Interface
- Admin should default to Hebrew
- All form labels, buttons, navigation should be translatable
- For MVP: Hardcode Hebrew labels first (we can make it properly i18n later)
- Keep English as a secondary option

### 4. Content Direction
- Each page can have a `direction` field (`rtl` or `ltr`)
- Blocks should inherit the page direction
- Rich text / content areas must handle mixed content gracefully (Hebrew + numbers + English)

### 5. Fonts
- Good Hebrew font stack is required (e.g. "Noto Sans Hebrew", "Assistant", system fonts)
- Themes should include proper Hebrew typography defaults

## CLI / Programmatic Considerations

When building content via CLI or agents:
- The system should make it easy to set `direction: "rtl"`
- Slugs should support Hebrew (or we decide on transliteration strategy)
- Text content should be stored as normal UTF-8 (no special escaping needed)

## Testing
We need to test:
- Mobile + desktop RTL
- Mixed LTR/RTL content (English words inside Hebrew sentences)
- Forms in admin
- Theme components

## An English site (v2.58)

Ben (2026-09-23), on an English site that came out right-to-left with Hebrew words in its header: *"lets make it not rtl automatically when it selects english, we can do rtl jobs in english interface, we can also do the same with hebrew to english — I think it's fair to assume our system will handle this."*

`src/site-language.js` is the one place that answers which way the site reads and what its chrome says:

- **The site's language sets the default direction** — `config.language` `he` → `rtl`, `en` → `ltr` (the settings screen's language switch). Every new page is born the site's way: `pages.createPage`, the builder's create route, the JSON bridge (`fromTapuzPage` / `toTapuzPage`), the keyword compiler at its door (`pzn-source.lineToPzn`; the parser itself is bundled for the browser and stays Hebrew by default), the paste shell for a bare fragment.
- **A page keeps its own direction when it says one.** A BenTML head counts only when it carries `dir=`; a document that never says keeps the page's own. On an English site `<html lang="he" dir="rtl">` is a Hebrew page — exported as such, with Hebrew chrome words — "we can do rtl jobs" either way. `lang` follows: the site's language when the page reads the site's way, the other one when it does not (`languageFor`).
- **Switching the language turns the pages around.** `pages.flipSiteDirection(from, to)` runs from the settings route: every page that read the old site's way now reads the new one (its canonical .pzn re-serialized with the new head, the way a builder save writes it); a page that declares its own language (`meta.lang`, the translations screen) keeps its direction. The export is rebuilt, because every page's chrome moved.
- **The chrome speaks the page's language** — `{{t.skip}}`, `{{t.mainNav}}`, `{{t.menu}}`, `{{t.footerNav}}` in the layout, the "More" fold, the credit line, a contact card's labels, the search box, the map title, a tab's default name, the consent bar's default words, the redirect page. A custom layout without the placeholders keeps its bytes.
- **The copilot is told which site it drives.** `buildCopilotBriefing({ siteLanguage })`: on an English site the Hebrew briefing says the site is English and LTR, shows an English example document, and asks for English answers to the owner. The battery's `--track=english` (E1–E10) measures it.

Pinned by `scripts/smoke-site-language.js`: the Hebrew site byte-for-byte, the flip both ways over the real settings route, the paired page that stays, the modules' words, the briefing.

---
This document will evolve as we build.
