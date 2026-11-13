# The store — `<bent-store>` and the flip (v2.53)

Ben's ask: *"we are to make the flip and the site behave as a store, with cart and everything in between, we are to write it in BenTML and it must be compressed to PZN at the end when you pack up the site for backup or hot swap … we offer the whole plate."*

A Tapuziel site becomes a shop with one button (**חנות → 🛍️ פתיחת החנות**). Everything the shop is, is BenTML: its pages are `.pzn` pages built from six storefront modules, and the catalog itself is one `<bent-store>` document. Everything it knows lives in the site's SQLite file, so the `.pzn` export, the backup shelf and a live restore carry the whole shop.

v2.69 made the catalog a real one — categories with a level of nesting, a picture and a page of their own; products with a brand, tags, a barcode, a weight, a cost price and search fields; a shopper's toolbar on the grid; CSV in and out — and closed the holes an audit found in the document, the backups and the checkout. This page describes the store as it is after that release.

## The flip

| | Opening (`flip(true)`) | Closing (`flip(false)`) |
|---|---|---|
| Store pages | `shop`, `cart`, `checkout`, `order` are created **in BenTML** — only what is missing. A page the owner already has at one of those addresses is never taken over: the store uses `store-<kind>` and remembers it (`settings.pages`). | stay |
| Product pages | every active product gets `shop-<sku>`: a `<bent-crumbs>` trail that carries its category path, `<bent-buy>`, and a four-column strip — "עוד מאותה קטגוריה" when its category has other products, else "עוד מהחנות". A hidden/draft/deleted product's page is taken down to a draft, never deleted | stay |
| Category pages | every category a shopper may see that holds at least one active product (its sub-categories count) gets `shelf-<id>`: the trail, the name, its line of text, its sub-categories as tiles, its products with a sorter. A category that is hidden, emptied or deleted has its page taken down to a draft | stay — except the page of a category the owner hid, which leaves the site even while the store is closed |
| Menu | "חנות" joins the menu in the main slot, once, after a menu backup | stays |
| Header | the cart button (`.tz-cart-link`) with the live count | removed |
| Every page | `/tz-store.js` (the storefront script) | removed |
| Checkout | open | refuses (`403 CLOSED`) |

Pages the store created carry `meta.store` (`shop` / `cart` / `checkout` / `order` / `product` / `shelf`, plus `meta.storeSku` or `meta.storeShelf`) — that is how it knows which pages are its own to publish or take down. The owner can open any of them in the builder and redesign it: they are ordinary pages.

A product page and a category page **follow the catalog**. A rename, a new summary, a new first picture or new search fields reach the page's title, its description and its share picture on the next save, and a field the owner emptied is cleared on the page too. The page's *content* is rewritten only while it is still the page the store wrote: the store remembers the blocks it generated (`meta.storeSourceHash`), and a page the owner has redesigned keeps its design and gets only the title and the head facts. Every catalog write — the product editor, a bulk action, a category save, a document apply — syncs the pages it touched and rebuilds the site once.

## The storefront modules (page BenTML — both dialects)

| Tag | Keyword | Props | What it renders |
|---|---|---|---|
| `<bent-shop>` | `SHOP` | see the table below | the catalog grid — picture, brand, a two-line name, the summary, price and "was" price, a sale percentage, badges, sold-out and "נותרו N" marks, add-to-cart (or "לבחירת אפשרות" for a product with options). Every card of a row has its name, its price and its button on one level |
| `<bent-shelves>` | `SHELVES` | `parent` (empty = the top-level categories; an id = that category's sub-categories), `columns=2..6` (3), `title`, `counts` (on), `summaries` (off), `justify=start\|center` | the categories as tiles — picture, name, the number of products — each linking to its category page. Hidden and empty categories are not drawn |
| `<bent-buy>` | `BUY` | `sku` (required), `gallery`, `description` | one product: gallery (arrow keys move through it), brand, name, links to its categories, price and "was" price, options with their own price and stock, quantity, add-to-cart, the SKU line, tag chips that lead to the shop filtered by that tag, the VAT line, the description, `Product` JSON-LD |
| `<bent-cart>` | `CART` | `empty` | the cart — lines, steppers, removal, subtotal, "to checkout" |
| `<bent-checkout>` | `CHECKOUT` | — | contact, delivery (the address only when the chosen method needs it), payment, the customer's note, the coupon, the summary, and the order |
| `<bent-order>` | `ORDER` | — | the order page (`?o=<token>`): status, items, totals, how to pay, tracking |

`<bent-shop>` in full:

| Param | Values | What it does |
|---|---|---|
| `shelf` | a category id | that category **and its sub-categories**; empty = everything |
| `tag`, `brand` | text | only products with that tag / of that brand |
| `featured` | boolean | only products marked "מוצר מומלץ" |
| `skus` | SKUs, comma-separated | exactly those products, in that order — a curated strip |
| `exclude` | a SKU | leave one product out (a product page's own strip) |
| `limit` | 0–48 (0 = all) | how many the grid holds at most |
| `sort` | `manual` \| `new` \| `price-asc` \| `price-desc` \| `name` | the order the page is published in |
| `columns` | 2–4 (3) | columns on a wide screen; two on a phone, one on a very narrow one |
| `media` | `square` \| `portrait` (4:5) \| `landscape` (4:3) | the shape of every picture box |
| `fit` | `cover` \| `contain` | fill the box, or show the whole picture with a margin |
| `justify` | `start` \| `center` | where a last row that is not full sits |
| `title` | text | a heading over the grid; with no products the heading goes too |
| `empty` | text | what to say when there is nothing to show |
| `buttons` | boolean (on) | the add-to-cart buttons |
| `filter` | boolean | category chips above the grid |
| `sorter` | boolean | a sort list for the shopper |
| `search` | boolean | a search box (name, brand, tags) |
| `page-size` | 0, or 4–48 | show that many and a "הצגת עוד" button for the rest |

The shop page the flip writes starts with `filter`, `sorter`, `search` and `page-size="24"`. The chips, the sorter, the search and "הצגת עוד" work in the shopper's browser on the products the page already carries, and the page's address remembers them — `?shelf=<id>`, `?tag=<tag>`, `?q=<words>`, `?sort=<order>` — so a filtered shop is a link that can be sent. The toolbar is printed only while the store is open: the script that runs it is not on the page otherwise.

The grid, the tiles and the buy box are rendered on the server at publish time — the static export carries real products and prices. The cart, the checkout and the order page are filled by `/tz-store.js` in the shopper's browser. A product page's head says `og:type=product` with the price, the currency and the availability, its body carries `Product` and `BreadcrumbList` JSON-LD, and a page with no picture has no `og:image` at all. The storefront is styled inside the site's own stylesheet with the theme's variables — one of them, `--media-bg`, is the ground behind every picture box, the store's and the site's — so a shop wears whatever the site wears.

The compact grammar (the lite paste pack, the 8K copilot briefing) leaves the whole store category out (`COMPACT_SKIP` in `src/pzn/syntax-dictionary.js`): both were ~50 characters from their gates before the store existed, and the flip writes the store pages itself. The full dictionary, the spec and the schema carry all six.

## The document

```html
<bent-store version="1" name="הסטודיו של נועה" currency="ILS">
  <bent-store-rules vat="18" vat-included="true" min-order="0" />
  <bent-shelf id="home" label="לבית" image="/assets/home.webp" summary="כל מה שהבית צריך" />
  <bent-shelf id="candles" label="נרות" parent="home" />
  <bent-sku id="lavender-candle" title="נר לבנדר" price="89.90" was="120" stock="12"
            shelf="candles" brand="נועה" tags="סויה, מתנה" featured="true" barcode="7290001234567" weight="320"
            image="/assets/lavender.webp" images="/assets/2.webp" badge="מבצע" summary="נר סויה"
            seo-title="נר לבנדר בעבודת יד" seo-description="נר סויה טבעי, 40 שעות בעירה">
    נר סויה בעבודת יד, 40 שעות בעירה.

    פסקה שנייה.
    <bent-variant id="small" label="קטן" price="69.90" stock="5" />
  </bent-sku>
  <bent-ship id="pickup" label="איסוף עצמי" price="0" address="false" />
  <bent-ship id="delivery" label="משלוח עד הבית" price="30" free-over="300" />
  <bent-pay id="bit" kind="bit" label="ביט" phone="050-0000000">העבירו וציינו את מספר ההזמנה</bent-pay>
  <bent-pay id="link" kind="link" label="דף התשלום שלנו" url="https://pay.example.com/?sum={total}&amp;ref={order}" />
  <bent-pay id="card" kind="card" label="כרטיס אשראי" max-payments="3" />
  <bent-coupon code="WELCOME10" percent="10" min="100" until="2026-12-31" uses="100" />
</bent-store>
```

| Tag | Attributes | Notes |
|---|---|---|
| `bent-store` | `version="1"`, `name`, `currency=ILS\|USD\|EUR\|GBP`, `mode="merge"`, `keep` (see [a partial view](#a-partial-view--keep)), `note` | the root. **Never** the open/closed switch — a pasted document can fill a store, not open one |
| `bent-store-rules` | `vat`, `vat-included`, `vat-exempt`, `min-order`, `low-stock`, `order-start`, `require-email`, `terms` (a page), `thanks` | absent = unchanged |
| `bent-shelf` | `id`, `label`, `parent` (the id of a top-level category), `image`, `summary`, `hidden="true"`, `seo-title`, `seo-description` | a category — see [Categories](#categories) |
| `bent-sku` | `id` (the SKU — identity), `title`, `price`, `was`, `stock`, `shelf`, `status=active\|hidden\|draft`, `brand`, `tags` (comma-separated, up to 12), `featured="true"`, `barcode`, `weight` (grams; `1.2kg` is read too), `image`, `images` (space-separated), `badge`, `summary`, `delivery="false"` (digital / service), `max` (per order), `seo-title`, `seo-description` | body text = the description (a blank line starts a paragraph) |
| `bent-variant` | `id`, `label`, `price` (absent = the product's), `stock` | an option, inside its product; with options, stock is counted per option |
| `bent-ship` | `id`, `label`, `price`, `free-over`, `address="false"`, `note` | any `<bent-ship>` replaces the list; none = unchanged |
| `bent-pay` | `id`, `kind=call\|bank\|bit\|paybox\|cash\|link\|card\|paypal\|demo`, `label`, `phone`, `url` (https, `{total}` `{order}` `{currency}`), `max-payments` (1–36, `card` only) | body text = the instructions the shopper reads. `card` = the [card gateway](#the-card-gateway--grow-and-cardcom). `paypal` = [PayPal](#paypal): the document says only the label; the client id and the secret are never in it. `demo` = the [demo payment](#the-demo-payment). A method is accepted while it cannot be offered (`CARD_NOT_CONNECTED`, `PAYPAL_NOT_CONNECTED`, `DEMO_NOT_OFFERED`) and stays off the checkout until it can |
| `bent-coupon` | `code`, `percent` \| `amount` \| `free-shipping="true"`, `min`, `starts`, `until` (YYYY-MM-DD, inclusive), `uses`, `active="false"`, `note` | |

Money is written as a person writes it (`89.90`, no symbol). The serializer is deterministic and `serialize(parse(serialize(x))) === serialize(x)`. Only what is not the default is written: default rules, a category that is not hidden, a product that is not featured all stay out of an exported document, so a 2.68 store exports the document it always did. The version is still 1 — every addition is an attribute an older build does not read.

**There is no `cost` attribute, on purpose.** What a product costs the owner is a column in the database and a field in the product editor ("מחיר עלות"), and it is in no document: the site package is a file people share and it carries the document word for word. A `cost="…"` in a pasted document is answered `ATTR_UNKNOWN` and not read. The catalog's own backups remember costs another way — see [backups](#backups).

**The store's own export always reads back.** A stock that is not counted is written `stock="unlimited"` (absent would mean "keep"). A line break inside an attribute travels as `&#10;`, and a curly quote inside a title as its number, so neither can cut a value short. The size ceilings — 400,000 characters, 500 products, 16,000 characters for one tag — bound what a stranger can paste; text the store wrote itself (a backup, an undo, the site package's document, the document a CSV import becomes) is read with `{ trusted: true }` and has none. A backup is parsed again, product for product, before the apply it protects may start.

**Why these tags:** `bent-product` and `bent-category` are page modules — a chat that learned the page language must never mistake a catalog for a page. Inside a `<bent-store>` the parser still reads those spellings (and `bent-option`, `bent-shipping`, `bent-payment`, `bent-discount`, `sku=`, `name=`, `compare-at=`, `qty=`, `category=`, `vendor=` / `manufacturer=` for the brand, `gtin=` / `ean=` / `upc=` for the barcode, `keywords=` for the tags, `meta-title=`, `meta-description=`; on a category `description=`, `picture=`, `parent-id=` …) and says so in the notes. An attribute it does not know at all is said too (`ATTR_UNKNOWN`) instead of vanishing. `bent-shop` is deliberately **not** read as the root: it is the storefront page module, and a pasted page must never read as an empty catalog.

### What applying means (a person can predict it)

- A product is matched by its `id`; a new id is a new product.
- **A whole document** (with `<bent-store>`) is the whole catalog: a product it does not mention is **hidden** — never deleted, so its orders and its page stay — and a coupon it does not mention is switched off.
- **A fragment** (no wrapper) or `mode="merge"` only adds and updates — and on a product, an option or a category that already exists, **an attribute the tag does not carry keeps its value**: `<bent-sku id="lavender-candle" price="59" />` changes one price and nothing else. An attribute that is there and empty (`badge=""`) clears the field. A product tag with no `<bent-variant>` inside keeps the product's options, and one that names some of them adds or updates those and **keeps the others** — a merge never deletes an option (removing one is the editor's job, or a whole-catalog document's). An option tag with a name and no id is matched to the existing option of that name. A stock the document cannot read as a whole number (`1O`, `3 units`, `12.5`) leaves an existing product's stock as it is, with a note; `5.00` and `1,000` are whole numbers. A status word the document does not know keeps an existing product's status and makes a new product a draft — it never publishes.
- In a whole document an absent attribute still means "clear it" — the document is the whole truth there — with two exceptions: `stock` (below), and whatever the root lists in `keep`.
- `stock` absent on a product that exists **keeps today's stock** in either mode (a rewritten catalog must not reset what orders have moved); `stock="unlimited"` turns counting off.
- A section that is absent (no `<bent-ship>`, no `<bent-pay>`, no rules) leaves that part of the store as it is.
- Order is the document's: categories and products of a whole document take its order. A merge leaves the order of what exists alone and puts what is new at the end.
- A product is found by its SKU and by nothing else — `<bent-sku id="1001">` is the product whose SKU is 1001, never the database's row 1001.

### A partial view — `keep`

A document that was written from a view of the store that did not show everything says so on its root: `<bent-store mode="merge" keep="description,summary,image">`. `keep` is a list of attribute names as `<bent-sku>` and `<bent-shelf>` spell them (`description` is a product's body). On a product or a category that already exists, a listed attribute its tag does not carry **keeps the store's value, in either mode** — an empty body no longer erases a description the writer was never shown. An attribute the tag does carry is what it says, empty included (`description=""` still clears), and a new product is not touched by `keep`. In a merge document every absent attribute is kept anyway; `keep` is what still holds when a reply comes back without `mode="merge"`. Such a document is partial by its own word, so if it would hide even one product the preview asks first (`MANY_HIDDEN`). A word in the list that names no attribute is said (`KEEP_UNKNOWN`).

The AI catalog writer is where this comes from — see [the doors](#the-doors).

### Backups

Every apply is preceded by a backup of the store as it stood — **as a `<bent-store>` document** (`store_backups`, newest 10) — and so is every delete from the admin: one product, a bulk delete, a category whose products move. A backup that does not read back whole refuses to be taken, and the apply or delete it was for writes nothing (`BACKUP_FAILED`). "↩ ביטול החלה אחרונה" puts the newest one back and backs up the state it replaces, so an undo can be undone; any backup on the list can be restored or downloaded as `.bent`.

A backup also remembers the one thing its document cannot say: **what each product cost**. The costs sit in their own column of `store_backups`, beside the document and never inside it, and an undo or a restore hands them back after the document has landed — a product a delete removed comes back with its cost, and a cost a CSV import changed goes back to what it was. A product created after the backup keeps its own. A backup taken before 2.69 has no such note, and restoring it leaves every cost as it is. The `.bent` download of a backup is the document alone.

A backup also puts back what its document leaves unsaid: the document drops a rule that stands at its default and a list with nothing in it, so a backup keeps beside it — in a column of its own, like the costs — every rule with its value, the store's name, its shipping and payment methods, and which coupons existed and were on, and an undo or a restore puts exactly that back (a minimum order returns to none, a terms page clears, a coupon the store did not have is switched off). Whether the store is open, the gateway's and PayPal's keys, `demoPayments` and `holdHours` are not part of a backup, and a backup taken before this column existed puts back what its document says and no more.

### Refusals (nothing written)

`NO_STORE`, `PAGE_NOT_STORE` ("זה דף, לא חנות"), `MENU_NOT_STORE`, `THEME_NOT_STORE`, `REPLY_TOO_LONG` (over 400,000 characters), `TOO_MANY_PRODUCTS` (over 500), `NO_VALID_PRODUCTS`, `BACKUP_FAILED`.

### Warnings

**Hard** — apply asks for a confirmation (`NEEDS_CONFIRM`): `PRODUCT_INVALID` (that product is skipped), `EMPTY_STORE` (a whole document with no products would hide them all), `MANY_HIDDEN` (more than half the active products would be hidden — or any at all, under a root that says `keep`), `BLANKED` (more than two existing products would be left without the description, the summary or the whole picture set they have today — in either mode), `TAG_SKIPPED` in a whole document (one of the store's tags could not be read: it never closed, it is too long, or a quoted value broke across lines — and a product nobody read is a product about to be hidden), `COUPON_INVALID`, `SETTINGS`, `CURRENCY_CHANGE` (a store that already has orders).
**Soft** — shown in the preview: `PRODUCT_FIXED`, `DUPLICATE_SKU`, `PRICE_ZERO`, `SHELF_CREATED`, `SHELF_INVALID`, `SHELF_DUPLICATE`, `SHELF_PARENT_MISSING` and `SHELF_TOO_DEEP` (the category becomes a top-level one), `SHELF_FIXED` (a picture with a bad address was dropped), `STOCK_UNREADABLE` (the stock stays as it was), `STATUS_UNKNOWN`, `OPTIONS_FULL` (a product already at 50 options takes no new one), `RULE_INVALID`, `CURRENCY`, `CARD_NOT_CONNECTED`, `PAYPAL_NOT_CONNECTED`, `DEMO_NOT_OFFERED`, and the parser's notes (`NO_WRAPPER`, `TAG_ALIAS`, `ATTR_ALIAS`, `ATTR_UNKNOWN`, `KEEP_UNKNOWN`, `VERSION_NEWER`, `TAG_SKIPPED` in a merge, `CURLY_QUOTES`, `UNCLOSED_SKU`, `ORPHAN_VARIANT`, `SEVERAL_DOCUMENTS`).

The preview lists what would be added, changed (field by field: מותג, תגיות, מומלץ, ברקוד, משקל, SEO beside the older ones), hidden and left alone, the categories that would be added or changed, the settings and the coupons.

### The doors

- `/admin/store/bentml` (**החנות ב-BenTML**) — the live document, a textarea, ⬇ `store.bent`, ⬆ a file, 👁 preview (writes nothing), ✅ apply (only the previewed text), the CSV card, the backups with ⬇ and restore.
- **🛍 כותב/ת הקטלוג** (`src/injections/store-catalog.js`) — the injection pack on the same screen, for managers only (`adminOnly`: its prompt shows payment details, coupon codes and drafts, so an editor is answered 403 `ADMIN_ONLY` and is not shown the card): a prompt carrying the grammar, the store as it is today and the site's real pictures; the owner pastes the reply back (or runs it with the connected AI); the same preview → apply → undo. A store that fits the prompt is shown whole. One that does not is shown as a **partial view**: first without descriptions, then without the back-office details (search fields, extra pictures, barcode, weight), then field by field down to a price list, and only then without its last products — every product is worth a line before any product's summary is, because a model that cannot see a product exists writes it again under a new id. A partial view is rooted `mode="merge" keep="<what was left out>"` and one line tells the model to return only what it adds or changes, so a reply that merely echoes the view changes nothing. Before 2.69 the view kept a whole-catalog root: a model echoed it back and the apply blanked every description it had not been shown and hid the products that had not fitted. `BLANKED` and `TAG_SKIPPED` are among the pack's hard codes, so the chat door asks for the same confirmation the paste door does.
- **CSV** — see [CSV](#csv).
- `GET /admin/api/store/export.bent`, `POST /admin/api/store/preview`, `/apply`, `/undo`, `/import-csv`, `GET /admin/api/store/backups`, `/backups/:id.bent`, `POST /backups/:id/restore`.

## Categories

In the code and in the document a category is a *shelf*; the owner's screens say **קטגוריות**. A category has an id, a name, a line of text (`summary`), a picture, search fields, and may be hidden.

- **One level of nesting.** A category may have a parent, and the parent must be a top-level category; one that has sub-categories cannot be given a parent. Asking for a parent's products (`<bent-shop shelf="home">`, the category filter of the admin's product list) answers with its sub-categories' products too.
- **A product sits in one category.** What cuts across categories — a material, a season, "gift" — is a tag.
- **A page each.** A category gets `shelf-<id>` as described under [the flip](#the-flip); its page takes its description and its share picture from the category's own.
- **Hidden** means no shopper sees it: not on the chips, not as a tile, not in the public catalog, and its page is taken down. Hiding a parent hides its sub-categories with it. Its products are still sold — they are in the shop grid and their pages stay.
- **Order** is the owner's: drag the rows on the categories screen (or use ↑ ↓), and a document's order of `<bent-shelf>` tags is written back as that order. A new category goes last.
- **Deleting** a category never deletes a product: its products move to the category the owner picks (or to none), and its sub-categories become top-level. When a delete moves anything, the catalog is backed up first.

## CSV

**מוצרים → ⬇ CSV** downloads every product as a sheet; **⬆ ייבוא CSV** leads to the CSV card on the BenTML screen ("📄 ייבוא וייצוא CSV"), which previews a file and applies it.

The columns are `sku`, `title`, `price`, `compare_at`, `cost`, `stock`, `category`, `brand`, `tags`, `status`, `featured`, `barcode`, `weight`, `badge`, `summary`, `description`, `image`, `images`, `delivery`, `max_per_order`, `seo_title`, `seo_description`, `variants`. A sheet does not have to use those names: the Hebrew a shop owner types (מזהה, שם, מחיר, מחיר לפני, עלות, מלאי, קטגוריה, מותג, תגיות, סטטוס) and the names Shopify and WooCommerce export are read as well, and a category is found by its name as well as its id — under the parent the cell names, so `Men > Shirts` and `Women > Shirts` are two categories. A SKU that repeats in one file is read once (the first row wins, the others are named in a warning), cost prices are written only for the rows the import really took, and the `variants` cell is a merge like any other: it adds and updates options and cannot remove one. The export opens in Excel as it is — a BOM, every cell quoted, a formula guard on cells that begin with `=`, `+`, `-` or `@`.

**There is one write path.** A sheet is turned into a `mode="merge"` document and goes through the document's door — the same preview, the same warnings, a backup first, the same undo. So a column the file does not have is left alone on every product. A cell that is there and empty clears its field — except the price, the status and the yes/no cells, where empty can only mean "as it is", and the stock, where empty is "not counted". A row is matched by its `sku`, or by the id its title makes when it has none; a row without a name is reported by its line and skipped. At most 500 rows and 2 MB.

**Cost prices travel beside the document.** The `cost` column cannot go into a document, so the import applies the document and then writes the costs; the preview counts them ("מחירי עלות שיתעדכנו") so a sheet that changes only costs does not read as "no changes". An undo puts them back with everything else.

## The admin

The store's screens are in the sidebar under **החנות**: מוצרים, קטגוריות מוצרים, הזמנות, קופונים, משלוח ותשלום, and — from the hub — סליקת אשראי and החנות ב-BenTML.

- **החנות** (the hub) — open or closed; "✅ מוכנות", which is green for payments only when the checkout really offers a method, and says in the payment wiring's own words why a configured one is not offered; the day's and the month's orders with the part of them that was paid; "🩺 בריאות הקטלוג" — products without a picture, with a price of 0, without a category, drafts, sold out, low stock — each line naming its products, or "הקטלוג נקי ✓"; the latest orders.
- **מוצרים** — tabs by status with their counts (הכול / פעיל / מוסתר / טיוטה); one bar of filters (search by name, SKU, brand, tag or barcode; category with its sub-categories, or "ללא קטגוריה"; brand; stock; sort); 100 to a page. A row shows the picture, the name with its SKU and brand, the price, the stock (editable in place), the category, the status and a ★ for "מומלץ". The order is the owner's: drag a row, or use ↑ ↓, while the list is unfiltered and in manual order. Ticking rows opens the bulk bar — status, category, "מומלץ ✓" / "הסרת מומלץ", "הוספת תגית", "מחיקה" (which offers "הסתרה במקום") — and a bulk action is one request, one backup when it deletes, one site rebuild.
- **The product editor** — cards for פרטים, תמונות (up to 12, the first is the main one; from the library, by upload or by address), מחיר (price, the price before, "מחיר עלות" and the profit it leaves), מלאי (SKU, barcode, "ספירת מלאי"), אפשרויות (with a generator of combinations, up to 50), משלוח and "תצוגה בגוגל" (the two search fields with a live snippet); beside them סטטוס with "מוצר מומלץ", ארגון (category, brand, tags) and "תצוגה מקדימה" — the product's card and buy box as the site draws them, for a draft too. "שכפול" opens a filled form and writes nothing until it is saved. A delete backs the catalog up first and refuses if it cannot.
- **קטגוריות** — the tree, with a panel to add or edit one (name, id, parent, picture, the line of text, hidden, the search fields), drag or ↑ ↓ to reorder, "באתר ↗" on a category whose page is live, and a delete that asks where its products go.
- **משלוח ותשלום** — the rules, the shipping methods, the payment methods and the store's pages. A save answers `notes`: one sentence for each configured payment method the checkout will not offer, and why. Two settings live only here and are in no document: the hours after which an unpaid order is cancelled, and whether to offer the demo payment.
- **הזמנות** — 50 to a page; the CSV carries every matching order, not the first page.

Every product and category name is printed escaped, in the page, its title and the top bar.

## The pack — backup, hot swap, another install

- **The database `.pzn`** (אחסון → ייצוא ‎.pzn, the daily backup shelf, שחזור מקובץ) is the site's SQLite file, and the store lives in it: `store_meta` (settings, the open flip, the store pages), `store_products` / `store_variants` / `store_shelves`, `store_coupons`, `store_orders` / `store_order_items` / `store_order_events`, `store_backups`. A live restore brings back the whole shop, and `afterRestore()` puts the store pages and the static site in step with it.
- **The site package** (הגדרות → ייצוא האתר) carries the catalog as its `<bent-store>` document (`pkg.store.source`) — never the orders, which are records about people, and never a cost price, which the document cannot hold. An import applies it through the same door, as a merge unless the import overwrites, and never opens the store. The costs of the importing shop are left as they are.
- Nothing secret is in either: a payment method holds instructions a shopper reads (bank details, a Bit number, the address of the owner's own payment page, a card method's label and installments). No card number ever reaches the store, and the keys — the card gateway's and PayPal's — live in gitignored `config/payments.json` (or the server's environment), outside the `.pzn` and outside the package, so a restored shop shows those methods as "not connected" until the keys are typed again on that install. `store_payments` (the payment rows: amounts, approvals, last-4, the provider's ids) does travel in the database `.pzn` with its orders, and so do the cost prices — the `.pzn` is the owner's own backup, not a file to hand around.

## Money and orders

- Integer minor units (agorot) end to end; `money.js` parses what a person types (`89.90`, `₪89,90`, `1,234.50`, `1.234,50`) and refuses what is ambiguous (`1.234`). One formatter everywhere.
- **The browser holds identifiers and quantities only.** Every sum comes from `pricing.quote()` on the server — the cart page, the checkout summary and the order itself — so a price edited in the admin, or tampered with in a browser, is never what an order is charged.
- VAT: inside the price by default (Israel's retail rule, 18%); on top for a B2B shop; none for an exempt business (עוסק פטור).
- An order is one `BEGIN IMMEDIATE` transaction: re-quote, take the stock (`… WHERE stock >= qty`), take a coupon use (`… WHERE used < max_uses`), write. Two shoppers — in this process or another on the same file — racing for the last unit: one order, one "העגלה השתנתה".
- An order copies what it sold (title, option, unit price) and how it was to be paid — the method's id, its label and its kind (`payment_kind`) — so editing or deleting a product never rewrites history, and an order still knows it is a PayPal order after the owner renames or removes the method.
- **A checkout with nothing to pay with says so.** When the store lists payment methods and none can be offered right now (a PayPal method without keys, a card method without a gateway, a demo method outside a demo shop), the quote carries `noPayment` and blocks with `NO_PAYMENT`, the checkout page prints "אין כרגע אמצעי תשלום זמין — אי אפשר להשלים הזמנה." and switches its button off, and `POST /api/store/checkout` refuses with that code. It used to ask the shopper to "choose a payment method" from an empty list. A cart whose total is above what one order can hold (₪10,000,000) blocks with `TOO_LARGE` the same way.
- Cancelling returns the stock and the coupon use; restoring a cancelled order takes them again or names what is missing.
- **Unpaid orders can expire.** Stock is taken when an order is placed, so an abandoned checkout holds its units. With "ביטול אוטומטי של הזמנות שלא שולמו אחרי (שעות)" set on the settings screen (`holdHours`, 0 = never, the default), the server cancels `new`, unpaid orders older than that — hourly, through the same cancel a person presses, so the stock and the coupon use come back — and sends no mail. It leaves alone an order with a confirmed payment in any mode, one whose sum did not match, one whose payment page was opened in the last three hours, one whose provider gave an unclear answer in the last day, one whose PayPal capture was tried in the last three hours, and — however old — one with a PayPal capture whose outcome is still unknown. `holdHours` is a setting, not a document attribute: a shared file must not be able to start cancelling another shop's orders.
- Order numbers start at `order-start` (1001) and only go up. The order page is reached by a random 24-character token; it shows the payment instructions and the first name, never the phone, the email or the street.

## The public doors

| Route | What | Guard |
|---|---|---|
| `GET /api/store/catalog` | the live catalog (for integrations): active products without their cost, and the categories a shopper may see | 120/min per IP |
| `POST /api/store/quote` | a cart → the server's totals | 120/min, 32 KB, JSON only |
| `POST /api/store/checkout` | place the order | 8/min, 32 KB, honeypot, JSON only (a cross-site form cannot forge one) |
| `GET /api/store/order/:token` | the order page's data (a pending card or PayPal payment is verified first, throttled) | 60/min, `no-store`, `noindex` |
| `POST /api/store/pay/:token` | open (or reuse) the card gateway's hosted page → `{ url }` | 12/min, 32 KB, JSON only, ≤ 10 sessions per order |
| `POST\|GET /api/store/gateway/:provider/hook` | the provider's callback (never believed — see below) | 120/min, raw body ≤ 64 KB, mounted before the body parsers |
| `POST /api/store/paypal/create`, `/capture`, `/cancel` | PayPal's three doors, by the order's token | 30/min, 32 KB, JSON only |
| `POST /api/store/demo-pay` | the demo payment, by the order's token | 20/min, 32 KB, JSON only |

A request that is not JSON is turned away before it is counted, so it cannot spend the budget of the shopper who is paying.

## Privacy

With the CRM on, a buyer becomes (or enriches) a person — status `customer`, tag `store`, the order on the timeline (`store.order`). A subject export lists their orders (by contact **and** by email/phone — an order placed while the CRM was off has no contact link). An erasure request strips the person from every order and keeps the sale (`erased = 1`): a business keeps its sales records, and they are no longer about anyone. No server-side "Purchase" conversion is sent.

## Mail

Through the site's SMTP (`src/notify.js`): the owner hears about every order (`notifyEmail`, else the site's notification address); the shopper gets a confirmation and, when the order ships or is cancelled, a note. Nothing is sent before the order is saved, and a mail failure never costs an order. Every attempt leaves a line in the order's history — sent, or not sent and why — and that line never holds the shopper's address, because the history outlives an erasure request.

## PayPal

A `kind="paypal"` method pays through PayPal's own button. The shopper's order is stored first, at the server's totals. The order page then shows the button. `POST /api/store/paypal/create` builds the PayPal order from `store_orders` and its lines — a price in the browser is ignored — and `POST /api/store/paypal/capture` marks the `store_payments` row only when the amount PayPal reports equals the order. A second capture is a no-op, and an order that is already paid or cancelled is refused (`409 PAID` / `409 CANCELLED`) before PayPal is called at all.

Sandbox is the default (`https://api-m.sandbox.paypal.com`, the SDK from `https://www.sandbox.paypal.com`). A test capture is recorded and told to the shopper as a test; `paid_at` stays empty, so it is not revenue. Live mode can be asked for in two places — `PAYPAL_MODE=live` in the environment, or `mode: "live"` under `paypal` in `config/payments.json` (what the admin's gateway screen writes; the environment wins) — and is armed in only one: `TAPUZ_PAYPAL_LIVE=1` in the server's environment. Asked for and not armed is a refusal: PayPal is not offered at all, never a quiet downgrade.

Keys: `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in the environment, or typed on **חנות → סליקת אשראי** — the PayPal part of that screen has the mode, the two key fields (a saved key shows only its last four characters; an empty field on save means "no change") and "בדיקת חיבור", which asks PayPal whether it accepts them. The screen writes gitignored `config/payments.json`. Keys that come from the environment are shown read-only as "מוגדר במשתני הסביבה של השרת", and the environment wins. The secret is never in a page, a log line, or an API response. Do not set `TAPUZ_PAYPAL_LIVE` for a demo.

**The browser needs permission too.** The site's Content-Security-Policy allows its own origin, so PayPal's script and its button frame were blocked on the real order page. While PayPal is ready and a `paypal` method exists, the policy of every page is widened by exactly two origins for scripts, frames and connections — `https://www.sandbox.paypal.com` (or `https://www.paypal.com` in live mode) and `https://www.paypalobjects.com` — and by nothing otherwise: a site without PayPal sends the header it always sent, character for character.

**There is no webhook.** A capture that got no clear answer is asked about again — from the order page when the shopper returns, and by the owner with "🔎 בדיקה מול PayPal" on the order — and only PayPal's own answer settles the row. The order page stops offering the button after ten attempts on one order, and when PayPal is not ready it says "תשלום ב-PayPal אינו זמין כרגע — צרו איתנו קשר" instead of promising one. A capture that was attempted and has no clear answer — no reply, a restart in the middle of the call, or a capture PayPal holds as pending — leaves its payment row *in doubt*: until PayPal has been asked and has answered clearly, the order page offers no button and never says "nothing was charged", no second PayPal order is opened for that order, the order is not cancelled for being unpaid however old it is, its history says "תוצאת החיוב ב-PayPal לא ידועה — נבדקת", and the server's own hourly round keeps asking (five rows a round, an old doubt less often than a fresh one, a hundred asks a row; past that the row waits for the owner's "🔎 בדיקה מול PayPal").

The checkout page is exported with whatever PayPal keys the process already has. If the keys arrive on a later restart, that boot republishes `checkout.html`; saving them on the gateway screen rebuilds the site at once. The storefront script also rebuilds the payment choices from the live quote, so a copy of the page exported before the keys existed still offers PayPal once the server has them.

## The demo payment

A shop that exists to be tried needs an order that can reach its end without anybody's keys and without anybody's money. `kind="demo"` ("תשלום לדוגמה") is that: the order page shows "לשלם בכסף דמיוני", the button posts the order's token to `POST /api/store/demo-pay`, and the payment is recorded the way every test payment is — a `store_payments` row (provider `demo`, mode `test`, status `paid`) and the order event "תשלום לדוגמה התקבל — כסף אמיתי לא עבר". `paid_at` stays empty: a demo payment is not revenue, the same rule a PayPal sandbox capture and a card gateway test follow.

**A real shop never offers it by accident.** One gate decides (`demo-pay.allowed`), asked by the checkout, by the order page and once more by the pay door: the site is a demo site — the demo seed's marker in `config/seeded.json` — or the owner ticked 'להציע "תשלום לדוגמה" בקופה' on the settings screen (`demoPayments`). Anywhere else a `demo` method is listed and not offered, the settings save and the hub say why, and a document that lists one is told `DEMO_NOT_OFFERED`. `demoPayments` is a setting and never a document attribute — a shared file must not be able to switch on a checkout that takes no money. The door answers `404 NOT_FOUND`, `403 NOT_DEMO` (the order is not a demo order), `403 NOT_ALLOWED`, `409 CANCELLED` and `409 PAID`.

## The demo shop

The demo catalog runs on boot when `TAPUZ_DEMO_STORE=1` and the data root is confidently empty — the path a Hostinger archive deploy can take, because that host has environment variables and no shell. A `.tapuz-root` pin only names the data directory; it does not arm the demo. A second boot sees `demo-store` in `config/seeded.json` and does not seed again. Any sign of a site, or an inventory that fails, is logged and left untouched. `node scripts/seed-demo-store.js --apply` is the same catalog for a machine that has a shell; it still requires `TAPUZ_ROOT` and `--apply`.

### Version 2

`TAPUZ_DEMO_STORE=1` turns an empty data root into a live fake shop at boot: 24 invented products in six categories (two of them sub-categories), a home page, a shop page with search, sort and category chips, a page per category and per product, three shipping methods, four coupons and two payments. The first payment is the `demo` kind: the order page shows "לשלם בכסף דמיוני", the payment is recorded as a test and never as revenue, and no keys are needed. PayPal's sandbox is the second and appears once sandbox keys exist. `scripts/seed-demo-store.js --apply` seeds the same shop from a shell. A demo is marked in `config/seeded.json` with `demo-store` and `demo-store-v2`.

**Upgrading a version 1 demo.** A root that carries `demo-store` but not `demo-store-v2` is moved to version 2 at the next boot with the flag, part by part, and only where the part is still exactly what version 1 wrote. The catalog counts as untouched when planning version 1's document against the store (stock left out, because orders move it) finds nothing to add, change or hide, and the store holds no other product, category or coupon and the same shop rules, shipping and payments. The home and shop pages move only with the catalog, and only while the shop page is byte for byte version 1's and still the home page. The menu moves only with the pages, and only while it is version 1's two links. The site description moves while it is version 1's sentence, and the footer line is set while the footer is empty. Whatever the owner changed is kept and named in the log (`[demo-store] v2: catalog kept — the owner edited it`). One exception: an open shop whose checkout offers no payment at all is given the demo payment — a shop that cannot take an order is a broken shop, and adding a method removes nothing. The eight old products keep their ids, prices and orders; stock returns to the catalog's numbers. The second marker is written once the step has run, so a kept part is never asked about again.

**A demo without a marker.** Before v2.69 the seed script wrote no marker. At boot with the flag, such a root is adopted (`[demo-store] adopted: an unmarked v1 demo`) only when its catalog is exactly version 1's by the rule above; it is then upgraded like any version 1 demo. Any other root — one product renamed, a ninth product, another site entirely — is left byte for byte as it was.

**Housekeeping.** A public fake shop sells itself out and collects whatever names and phone numbers visitors type. On a demo site with the flag set, the server (shortly after boot and every hour) cancels orders older than `TAPUZ_DEMO_RESET_HOURS` (default 24), which returns their stock and coupon use; clears the name, mail, phone, address and note of those orders while keeping the number, the items and the sums; and puts back to its catalog number the stock of any demo product or option that is below it and that no open order holds. Unpaid orders give their stock back after two hours (the store setting `holdHours`, set by the seed). It never runs on a site that is not a demo, and never without the flag.

| Variable | Meaning | Default |
|---|---|---|
| `TAPUZ_DEMO_STORE` | `1` arms the demo seed, the upgrade, the adoption and the housekeeping | unset — nothing is read or written |
| `TAPUZ_DEMO_RESET_HOURS` | age in hours after which a demo order is cancelled and scrubbed | `24` |

A demo site is public, and a root with no account belongs to whoever reaches it first — so the first account of any site now needs the setup code; see `docs/DEPLOY.md`.

## The card gateway — Grow and Cardcom

Ben's ask: *"build the card gateway, grow or cardcom"*. The owner picks **Grow** (formerly Meshulam) or **Cardcom**; both sit behind one driver interface (`src/store/gateway/`), and an order is marked paid **by us, automatically, only after our server confirmed the payment against something only the provider and we hold** — never from what a browser or a callback says.

### The method

A payment method of `kind="card"` (**חנות → משלוח ותשלום**, or `<bent-pay kind="card" max-payments="3">` in the document) is what the shopper sees: its label, its text ("התשלום מתבצע בדף המאובטח של חברת הסליקה. פרטי הכרטיס לא עוברים דרכנו."), its installments. It is **offered at checkout — and accepted by `placeOrder` — only while the gateway is ready**: a provider chosen, its keys present, the store's currency one the provider charges (Grow: ILS only; Cardcom: ILS / USD / EUR / GBP), the driver's own rule about the keys (Cardcom: **test mode is terminal 1000 and nothing else** — any other terminal on Cardcom's one host charges real cards; live mode refuses 1000), and an **https `baseUrl`** in the site settings, in both modes — both providers refuse localhost, and a callback sent to an http address meets a redirect that turns the POST into an empty GET. Grow also requires a two-word name and an Israeli mobile: the checkout says so, field by field.

### Where the keys live

**`config/payments.json`, gitignored, owner-only on disk — never the database.** Every other store table travels in the `.pzn` export, the backup shelf, a live restore and (as `<bent-store>`) the site package; a terminal key must not. So a restored or hot-swapped shop on another install shows its card method as **"not connected" until the keys are typed there** — that is correct. The admin (**חנות → 💳 סליקת אשראי**) sees readiness, the mode, the provider and a last-4 tail per key; a value is typed in and never read back (`undefined` keeps, `''` clears); the storage screen does not list the file. Hosts are constants inside each driver, and the transport a driver gets refuses any other host: no setting, env var or request field decides where a credential is sent.

The same file holds `_tokenKey` — 32 random bytes made once, on the first Grow session, kept through every save and every "ניתוק", and read by nothing but the seal below. It is not a provider key and no screen or API shows it.

### The flow

1. Checkout places the order exactly as for any other method (stock and the coupon use in the same immediate transaction). The reply's `pay` for a card order is the **first-party** action `/api/store/pay/<token>` — never a provider URL.
2. The order page (`?o=<token>&pay=1`) POSTs it. `startSession()` reuses a fresh session (8 minutes — Grow's page lives 10) or writes a `store_payments` row with **the amount from the database**, our random hex `reference`, and asks the driver for the hosted page. At most 10 sessions per order, and 30 rows in all (a provider that keeps refusing to open a page cannot grow the table). The shopper is sent to the `https:` URL the provider returned — a full page, never an iframe.
3. The shopper pays on the provider's page and comes back to the order page (`?paid=back`), which says "מאמתים את התשלום…" and asks the server every 3 seconds, up to 12 times.
4. Two independent triggers, one `settle()`:
   - **The provider's callback** `POST /api/store/gateway/<provider>/hook`. The row is found by the provider's **session id only** (Cardcom `LowProfileId`, Grow `processId`); our `reference`, echoed back, is a correlation check, never a lookup key. *Cardcom* sends no signature, so its callback is only a hint: we run `GetLpResult` ourselves with the stored ids and the terminal's keys, and PAID needs every check (top `ResponseCode` 0 — anything else is inconclusive whatever sits inside — our `LowProfileId` / terminal / `ReturnValue`, `Operation` "ChargeOnly", `TranzactionInfo.ResponseCode` 0 — 700/701 are J5/J2 holds with no money — `IsRefund` false, `DealType` "Debit", a real transaction id from inside `TranzactionInfo`, the amount in agorot and the coin). An inconclusive answer stays pending with the provider's reason on the row; a decline is a failed attempt a later confirmation still overturns. *Grow* asks that inquiries not run per transaction, so its callback is **token-anchored**: it settles when the sha256 of `data[processToken]` equals the hash we stored at creation (constant-time compare of the digests), `processId` is the row's, `statusCode` is "2", the transaction id is real (not "0"), `cField1` is our reference — and then `approveTransaction` echoes every documented field as received, empty ones included (Grow's acknowledgement; its failure never un-settles). Keys that are gone never lose a real callback: Grow's still settles by hash (the acknowledgement is skipped and noted on the row); Cardcom's is said once on the order and answered 503 so Cardcom retries for about a day.
   - **The order page** (`GET /api/store/order/:token`): the inquiry (`GetLpResult` / `getPaymentProcessInfo`) over **every** unpaid session of the order, newest first, each behind its own throttle. The first poll of a row only starts its clock — the provider's callback deserves its chance (Grow: 20 seconds; Cardcom: 5) — then ≥ 5 s (or that grace) apart, ≤ 60 times, ≤ 24 h, and at most two provider calls per page load. So a missed callback still settles the order when the buyer lands back, even when they paid on an older tab's session. The admin has a per-row **בדיקה מול חברת הסליקה** for the rest (no page throttle; bounded per row).
5. `settle()` is one immediate transaction: a guarded `UPDATE store_payments … WHERE status IN ('pending','failed')`, the amount and the currency compared to the order (else `mismatch` — an event, an owner mail, and the order is **not** marked paid), then `paid_at` on the order and one event that says how the payment was confirmed ("שולם בכרטיס אשראי (Cardcom) · אישור 123456 · כרטיס ····1234 · 3 תשלומים · אושר בבירור מול Cardcom" / "אושר בהודעת Grow"). A duplicate callback or a concurrent verify changes nothing; one provider transaction settles one row (`UNIQUE (provider, mode, transaction_id)` — Grow's sandbox and production number their transactions independently), and a replay of an id that already settled another row is refused with the event "העסקה כבר נרשמה בתשלום אחר — ההזמנה לא סומנה כשולמה; בדקו בממשק החברה" and an owner mail. A confirmation for an order that is already paid or cancelled is still recorded on its row — money moved — with the event and mail "יש להחזיר" and the refund action. `mismatch` rows are final: the charged amount is not ours to guess, and the event says to check the provider's panel.
6. After the commit: the owner's mail, and the shopper's "התשלום התקבל" (when `customerEmails`).

### Test mode never looks like money

In **מצב בדיקות** the drivers talk to what each provider calls a test: *Cardcom* — its public test terminal **1000** on the same host (deals clear without charging; every other terminal charges real cards, so test mode refuses it); *Grow* — the sandbox host with the separate sandbox ids. The checkout and the order page carry the banner "מצב בדיקות — לא יחויב כסף אמיתי"; a test confirmation records the row (mode `test`) and the event "תשלום בדיקה אושר — לא התקבל כסף" but **never sets `paid_at`**, never shows "שולם" and never counts as revenue; the dashboard shows a red line while the store is open in test mode. Grow's Bit / Apple Pay / Google Pay / PayBox have no sandbox — a test-mode confirmation from one of them is flagged loudly ("ייתכן שזה חיוב אמיתי").

### The owner's side

- **חנות → 💳 סליקת אשראי**: the provider, the mode (switching to live asks for a confirm in the browser, and the save carries `confirmLive: true` — without it the API refuses the switch), the keys as password inputs showing "שמור · ••••1234", **בדיקת חיבור** (a ₪1 page in the current mode — charges nothing; its address is shown in test mode only, since a live ₪1 page is a payable link), the readiness list (an https site address is needed in both modes), and the provider's own notes. The dashboard's readiness list gains a gateway line.
- **An order**: every payment row (provider, mode, state, approval, last-4, installments, transaction id, refunds), a refund form on each row that still holds money and a **בדיקה מול חברת הסליקה** on each that the provider has not settled; the "התשלום התקבל" checkbox cannot un-pay money the gateway still holds; cancelling restocks and says the money must be refunded separately.
- **Refunds** are explicit, never automatic, and of a **specific row**: a typed confirmation (the order number), full by default, partial where the provider allows (Cardcom needs the separate `ApiPassword`; Grow: at most two API refunds per transaction, and a same-day refund is a full cancellation). The sum is **reserved on the row — and the row locked — before the provider is asked**: one refund per row at a time (a second one, concurrent or not, is refused until the first completes; a lock older than two minutes is a crash's leftover and no longer counts), released on a definite refusal. The sum is reserved **as unknown** from the moment it leaves and becomes a plain refund only when the provider says yes — so a process that dies mid-call leaves the owner's decision on the order screen (once the lock ages out), never a silent "refunded"; while the call is still out, the row says "בדרך אל חברת הסליקה" and cannot be decided. When the outcome is **unknown** (a timeout, a 5xx) the sum stays reserved as "unknown", the order keeps its mark, and the row waits for the owner: "החזר של ₪X בתוצאה לא ידועה — בדקו בממשק החברה" with two typed-confirm actions — **ההחזר בוצע** (the books stand) or **ההחזר לא בוצע — שחרור** (the sum goes back to the row); no further refund touches the row until then. The order's `paid_at` is cleared ("סימון התשלום הוסר — הכסף הוחזר במלואו") only when **the gateway itself** had marked it paid and no live row holds money any more — an order the owner marked paid by hand (the buyer paid another way) keeps its mark whatever happens to a stray card payment.
- **Privacy**: `store_payments` travels with its orders in the `.pzn`; a subject export lists the payment lines; an erasure clears the card's last-4 and brand (the sums and the provider's transaction ids stay — sales records). Grow's `processId` / `processToken` / `transactionToken` and Cardcom's `LowProfileId` live on the row and never reach a browser, an event, the CSV or a log line. The processToken — the callback's only proof — is kept as its sha256 plus a copy **sealed** (AES-256-GCM, a fresh IV per seal) under `_tokenKey`, and the seal leaves the row once it is settled; so a backup handed around carries no usable proof. A `.pzn` restored on **another install** still verifies Grow's callbacks by hash and only loses the inquiry fallback for its old rows — the row then says "הטוקן של התהליך אינו ניתן לפתיחה במתקן הזה".
- **Going live with Grow**: Grow reviews the integration (its logs, the 200 replies, `approveTransaction`) and the site (a terms checkbox, a phone, an address, policies) — set a terms page in the store settings before asking for production ids.

Pinned by `scripts/smoke-store-gateway.js` (`npm run test:store-gateway`): both providers through fake transports; no real endpoint is ever called.

## Not done (said plainly)

- **The storefront speaks Hebrew only.** The words the store itself prints — the buttons, the cart, the checkout form, the order page, the sold-out and stock marks, the toolbar — are Hebrew on an English site too. The layout mirrors for a left-to-right page; the copy does not translate.
- **Options are a flat list.** A product has up to 50 options, each with a name, a price and a stock. There are no axes (size × colour as two choices), and an option has no picture and no barcode of its own. The editor's generator writes the combinations out as rows; it does not model them.
- **One category per product.** A product sits in one category (and so in its parent). Tags are the answer for groups that cut across.
- **No customer accounts in the checkout.** A shopper types their details each time; the order page is reached by its link. The customer portal and the store do not know each other.
- **No reviews, no gift cards, no multi-currency.** A store has one currency, and a coupon is a percentage, a sum or free shipping.
- **Shipping zones and weights**: a method has one price and an optional free-over threshold. A product's weight is recorded and shown; no shipping price is computed from it.
- **Tax invoices** (חשבונית מס / קבלה): not issued — neither by us nor through the providers (Cardcom's `Document` needs its Documents module; Grow's invoice fields are not sent). The printable slip says it is an order summary, not a tax invoice. A follow-up.
- **Server-side Purchase conversions** to Meta / Google: not sent.
- **PayPal has no webhook.** A capture whose outcome is unknown is asked about by the server's own hourly round, by the order page and by the owner's button, and the order is held until PayPal answers. A PayPal order the shopper approved and nobody tried to capture is not asked about: it waits for the shopper to return to the order page.
- **Other gateways** (PayPlus, Tranzila, Stripe): not built — the driver interface in `src/store/gateway/index.js` is the door. The `link` method still sends the shopper to the owner's own payment page with the sum and the order number, and the owner marks the order paid.
- **Grow's account-level "webhooks"** (a different JSON shape with a `webhookKey`, no `processToken`) are ignored on purpose: only the per-process server update carries the trust anchor.
- **The admin lists read the whole catalog.** The product list pages in the server's memory (100 to a page from one read) and a catalog sync parses every generated page; both are fine at hundreds of products and were not timed at many thousands.
