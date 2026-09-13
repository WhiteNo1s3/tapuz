# `<bent-menus>` — the menu organizer document (v2.28)

The site's menus are BenTML too. One document describes every named menu, where each sits (main bar / footer), and the bar's geometry — and the same document is what the **Menu Organizer** roleplay asks an AI to hand back. The owner never sorts a twelve-item menu by hand again: they describe what they want (or nothing), the organizer computes the bar's real capacity, and the AI returns this document; the door parses it, validates every link against the page inventory, shows a preview with a diff and the real header, and only then — on a second, explicit click — applies it with a backup.

Ben's ask: *"we have problem with menu breaking from the amounts of content on the menu so we need to make organizer injection for menu orientation, sub-menus, the limits the space, horizontal or vertical … user should tell his ai friend to make it work and we are to present perfect injection."*

## The document

```html
<bent-menus version="1" note="שירותים קובצו תחת הורה אחד כדי להיכנס בשורה">
  <bent-menu-layout placement="top" flow="wrap" fold="0" width="wide" />
  <bent-menu name="main" location="main">
    <bent-link label="הבית" page="home" />
    <bent-link label="שירותים" page="services">
      <bent-link label="עיצוב" page="services/design" />
      <bent-link label="בניית אתרים" page="services/web" />
    </bent-link>
    <bent-link label="מאמרים">
      <bent-link label="מדריך RTL" page="blog/rtl-guide" />
      <bent-link label="למה תפוז" page="blog/why-tapuz" />
    </bent-link>
    <bent-link label="מחירון" anchor="pricing" />
    <bent-link label="חייגו" tel="+972501234567" />
    <bent-link label="כתבו לנו" mailto="hi@studio.co.il" />
    <bent-link label="צרו קשר" page="contact" />
  </bent-menu>
  <bent-menu name="footer" location="footer">
    <bent-link label="פרטיות" page="privacy" />
    <bent-link label="תנאים" page="terms" />
  </bent-menu>
</bent-menus>
```

| Tag | Attributes | Meaning |
|---|---|---|
| `bent-menus` | `version="1"`, `note=""` | The root (0..1 — several documents in one reply → the one with the most resolvable links wins). `note` is one sentence for the owner: shown in the preview, never applied. |
| `bent-menu-layout` | `placement=top\|side` `flow=wrap\|scroll\|drawer` `fold=0..12` `collapse=sm\|md\|lg\|never` `width=content\|wide\|full` `align=start\|center\|end\|between` `gap=sm\|md\|lg` `size=sm\|md\|lg` `current=underline\|pill\|bold\|none` | The bar's geometry (0..1, anywhere). Every attribute is optional; an absent attribute leaves that knob untouched; an absent tag leaves the geometry untouched. The values are the theme's own knobs (`layout.menuPlacement`, `layout.headerWidth`, `chrome.menuOverflow/menuAlign/menuGap/menuSize/menuFold/menuCollapse/menuCurrent`) — see [bent-theme.md](bent-theme.md). |
| `bent-menu` | `name="main\|footer\|[a-z0-9_-]{1,40}"` (required), `location="main\|footer"` | One named menu. A name that does not exist yet creates it (warning `NEW_MENU`); `location` re-assigns which slot shows it; menus not named in the reply are untouched. |
| `bent-link` | `label="…"` (required, 1–40 chars) + at most ONE of `page="full_path"`, `url="…"`, `tel="…"`, `mailto="…"`, `anchor="id"` | One item. `page` is a page's `full_path` copied verbatim from the inventory. A leaf self-closes; a parent wraps its children and closes with `</bent-link>`; **one nesting level**. No target + children = a group (renders as a `#` parent). |

Why `bent-link` and `bent-menu-layout` and not `bent-item` / `bent-nav`: those two are page modules in the builder's registry. A chat that learned the page language must never confuse a menu document with a page.

## What the door tolerates (every tolerance is recorded as a note)

Prose and fences around the document (or no fence at all — the local model returns bare documents), `~~~` fences, curly quotes, BOM/zero-width characters, kebab or camelCase attribute names in any order, single/double/unquoted values, tag aliases (`bent-item`, `bent-menu-item`, `item`, `li`, `a` → `bent-link`), attribute aliases (`href|link|to` → `url`, `slug|path` → `page`, `title|text|name` → `label`, `phone` → `tel`, `email` → `mailto`, `hash` → `anchor`, `type="page" target="x"` → `page`), page values with a leading `/`, a trailing `.html` or `/`, an absolute URL in `page=` (retyped to `url`), a `url=/x.html` that matches a page (retyped to `page`), a `page` that misses but equals a page title, a missing label with inner text, an unclosed link at the end of a menu, grandchildren (lifted after their parent — never dropped), stray closers, `fold="all"` (reset to 0), and a JSON reply (`{menus:{main:[…]}}` or a bare items array). Values are cleaned of zero-width and bidi marks (a chat sometimes wraps Hebrew in RLM/LRM). Two deliberate limits keep the parser linear on hostile input: a quoted value cannot span lines (a raw newline inside a quote ends that one tag — the link is lost, never the document), and a tag body over 2,000 characters is not a tag.

## Refusals (HTTP 400, nothing written)

| Code | When |
|---|---|
| `NO_MENU` | no `<bent-menu>` and no JSON fallback |
| `PAGE_NOT_MENU` | a page document (`<!DOCTYPE>`, `<bent-hero>`, `<bent-section>`, `<bent-text>`, `<bent-nav>`) and no menu — "זה דף, לא תפריט — הדביקו אותו בבונה" |
| `THEME_NOT_MENU` | a `<bent-theme>` and no menu — "זו ערכת נושא — הדביקו אותה בסטודיו" |
| `EMPTY_MENU` | zero links survive validation |
| `TOO_MANY_ITEMS` | more than 40 links in total |
| `TOO_MANY_UNKNOWN` | more than 30% of the links point at pages that do not exist |
| `BAD_MENU_NAME` | a name outside `[a-z0-9_-]{1,40}` |
| `REPLY_TOO_LONG` | the pasted text is over 60,000 characters — "הדביקו רק את מסמך `<bent-menus>`, לא את כל הצ׳אט" (checked before parsing, so a pasted transcript costs nothing) |

## Warnings

**Hard** (block apply unless the owner forces it): `UNKNOWN_PAGE` (the link is dropped — the site never gets a broken link), `UNSAFE_URL` (an allowlist, not a blocklist: `http://`, `https://`, `//`, `/path`, `#anchor`, `./`, `../`, `mailto:`, `tel:` or a bare relative path with no scheme; control characters and bidi marks are stripped before the check, so a scheme split by a tab or a zero-width mark is dropped too), `BAD_TEL`.

**Soft** (shown in the preview): `PAGE_BY_TITLE`, `URL_TO_PAGE`, `DUPLICATE_DROPPED`, `DEPTH_FLATTENED`, `UNCLOSED_LINK`, `LABEL_TRIMMED`, `LABEL_EMPTY`, `NAV_VALUE_RESET`, `SUBMENU_HIDDEN_IN_SCROLL` (children on a scroll strip are invisible), `FOLD_WITH_SIDE`, `OVERFLOW_LIKELY` (the new top row will not fit one line — carries the numbers), `PAGES_MISSING` (published pages left out of every menu), `DRAFT_LINKED`, `ARTICLE_LINKED`, `NEW_MENU`, `NO_CHANGE` (the reply is the current menu echoed back), `LAYOUT_UNASKED` (placement/flow changed although the brief did not ask), `SEVERAL_DOCUMENTS`, `NO_WRAPPER`, `TAG_ALIAS`, `ATTR_ALIAS`, `LABEL_FROM_TEXT`, `JSON_FALLBACK`, `CURLY_QUOTES`, `TARGET_RETYPED`, `LAYOUT_DUPLICATE`, `MENU_NAME_DEFAULTED`, `EMPTY_GROUP` (a parent with no target and no surviving children is dropped and listed under the removed links — never kept as a dead `#` link), `PARENT_TO_GROUP` (a parent that repeats one of its own children's page becomes a group; the child keeps the page), `LOCATION_IGNORED` (a `location` other than `main`/`footer` leaves the location as it is), `EXTRA_TARGET_IGNORED` (more than one of `page`/`url`/`tel`/`mailto`/`anchor` on one link — the first wins).

## The capacity rule — computed by the CMS, never guessed by the model

`estimateMenuFit(items, overrides, config)` in `src/menus.js` estimates the bar from the theme's own numbers: the header width (`content` = the column, `wide` = max(column, 1140px), `full` = 1280px assumed), the logo (image width, or the title's characters), the CTA, the menu font (`fonts.baseSize` × the size knob), 0.55em per Hebrew character (measured on the live site: 9.3px at 17px bold), 1.35em per emoji, the ▾ caret on parents, the gap knob. It returns the capacity **N** (top-level items that fit one row), the character budget **C**, today's row count, and the side rail's capacity (~14). The prompt embeds these as sentences; the validator raises `OVERFLOW_LIKELY` when the planned top row would wrap.

The estimate is ±15% with wide Google fonts or emoji-heavy labels — which is why `OVERFLOW_LIKELY` is soft and the preview shows the real header in an iframe before anything is applied.

**The ladder** the prompt teaches and the validator checks: fits → keep the order; else shorten labels (2–12 chars, no emoji unless the current menu uses them) → group into ≤ N parents with 2–6 children → `<bent-menu-layout fold="N−1" />` (an "עוד" disclosure — written as the layout tag, never as a number in the note) or `width="wide"` (the bar stays) → `placement="side"` / `flow="scroll"` / `flow="drawer"` **only when the owner's brief asks for it**.

## The flow in the admin

1. `/admin/menus` → the **🧭 מסדר/ת התפריטים** card. Write a brief (or leave it empty), pick lite (free chat, ≤ 9,000 chars) or full (≤ 14,000). On a large site the pack trims itself to the budget, in this order: the brief to 1,500 characters → the current menus shown labels-only → the drafts line → the articles line → page-table rows from the bottom (never below 3); `meta.degraded` lists what was trimmed.
2. **🧠 צור פרומפט והעתק** → paste into any chat (a FRESH one — a chat that learned the page language answers in pages), paste the reply back → **👁 תצוגה מקדימה**. Or **▶ הרץ עם ה-AI המחובר** when a provider is connected (`/admin/ai`): the CMS sends the prompt itself, one repair round when the door asks for it, and the reply lands in the same box. A run never applies.
3. The preview: the tree with ✓ / ⚠ / ✗ per link, what was added / removed / moved / relabeled, the knob diff, the fit line ("שורה אחת: 742px מתוך 796px ✓"), and the real header rendered with the candidate menus.
4. **✅ החל על התפריטים** — enabled only while the box still holds the previewed text; hard warnings ask for confirmation. Apply takes a backup first (`config/menu-backups/<ISO>.json`, newest 10), saves the menus, the locations and the knobs, and rebuilds the static site.
5. **↩ בטל החלה אחרונה** restores the newest backup (and takes a `pre-restore` backup of the current state first). `GET /admin/api/menus/backups` lists them; `POST /admin/api/menus/restore {backupId}` restores one.

`GET /admin/api/menus/export.bent` returns the live state as this document — the same text the prompt shows the model as "the menus today".

## Zero-JS limits (published pages ship no script)

- Sub-menus open on hover and on keyboard focus (`:focus-within`); on touch the first tap on a parent opens it (WebKit/Android hover emulation).
- The "עוד" fold is a native `<details>` — click/tap/Enter/Space toggles it; it stays open until toggled again; there is no Escape-to-close.
- The drawer is a checkbox: the burger label toggles it; no `aria-expanded` sync.
- A scroll strip cannot show dropdowns (an absolute box inside an overflow container is clipped) — the validator warns `SUBMENU_HIDDEN_IN_SCROLL`.
