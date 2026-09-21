# The store — `<bent-store>` and the flip (v2.53)

Ben's ask: *"we are to make the flip and the site behave as a store, with cart and everything in between, we are to write it in BenTML and it must be compressed to PZN at the end when you pack up the site for backup or hot swap … we offer the whole plate."*

A Tapuziel site becomes a shop with one button (**חנות → 🛍️ פתיחת החנות**). Everything the shop is, is BenTML: its pages are `.pzn` pages built from five storefront modules, and the catalog itself is one `<bent-store>` document. Everything it knows lives in the site's SQLite file, so the `.pzn` export, the backup shelf and a live restore carry the whole shop.

## The flip

| | Opening (`flip(true)`) | Closing (`flip(false)`) |
|---|---|---|
| Store pages | `shop`, `cart`, `checkout`, `order` are created **in BenTML** — only what is missing. A page the owner already has at one of those addresses is never taken over: the store uses `store-<kind>` and remembers it (`settings.pages`). | stay |
| Product pages | every active product gets `shop-<sku>` (`<bent-crumbs>` + `<bent-buy>` + a "עוד מהחנות" strip); a hidden/draft/deleted product's page is taken down to a draft, never deleted | stay |
| Menu | "חנות" joins the menu in the main slot, once, after a menu backup | stays |
| Header | the cart button (`.tz-cart-link`) with the live count | removed |
| Every page | `/tz-store.js` (the storefront script) | removed |
| Checkout | open | refuses (`403 CLOSED`) |

Pages the store created carry `meta.store` (`shop` / `cart` / `checkout` / `order` / `product`, plus `meta.storeSku`) — that is how it knows which pages are its own to publish or take down. The owner can open any of them in the builder and redesign it: they are ordinary pages.

## The storefront modules (page BenTML — both dialects)

| Tag | Keyword | Props | What it renders |
|---|---|---|---|
| `<bent-shop>` | `SHOP` | `shelf`, `columns=2..4`, `limit=0..48` (0 = all), `sort=manual\|new\|price-asc\|price-desc\|name`, `filter` (shelf chips), `title` (the strip disappears when empty), `exclude` (a SKU), `buttons` | the catalog grid — pictures, price and "was" price, badges, sold-out and "נותרו N" marks, add-to-cart (or "לבחירת אפשרות" for a product with options) |
| `<bent-buy>` | `BUY` | `sku` (required), `gallery`, `description` | one product: gallery, options with their own price and stock, quantity, add-to-cart, the VAT line, the description, Product JSON-LD |
| `<bent-cart>` | `CART` | `empty` | the cart — lines, steppers, removal, subtotal, "to checkout" |
| `<bent-checkout>` | `CHECKOUT` | — | contact, delivery (the address only when the chosen method needs it), payment, the customer's note, the coupon, the summary, and the order |
| `<bent-order>` | `ORDER` | — | the order page (`?o=<token>`): status, items, totals, how to pay, tracking |

The grid and the buy box are rendered on the server at publish time — the static export carries real products and prices. The cart, the checkout and the order page are filled by `/tz-store.js` in the shopper's browser. The compact grammar (the lite paste pack, the 8K copilot briefing) leaves these five out (`COMPACT_SKIP` in `src/pzn/syntax-dictionary.js`): both were ~50 characters from their gates before the store existed, and the flip writes the store pages itself. The full dictionary, the spec and the schema carry all of them.

## The document

```html
<bent-store version="1" name="הסטודיו של נועה" currency="ILS">
  <bent-store-rules vat="18" vat-included="true" min-order="0" />
  <bent-shelf id="candles" label="נרות" />
  <bent-sku id="lavender-candle" title="נר לבנדר" price="89.90" was="120" stock="12"
            shelf="candles" image="/assets/lavender.webp" images="/assets/2.webp" badge="מבצע" summary="נר סויה">
    נר סויה בעבודת יד, 40 שעות בעירה.

    פסקה שנייה.
    <bent-variant id="small" label="קטן" price="69.90" stock="5" />
  </bent-sku>
  <bent-ship id="pickup" label="איסוף עצמי" price="0" address="false" />
  <bent-ship id="delivery" label="משלוח עד הבית" price="30" free-over="300" />
  <bent-pay id="bit" kind="bit" label="ביט" phone="050-0000000">העבירו וציינו את מספר ההזמנה</bent-pay>
  <bent-pay id="card" kind="link" label="כרטיס אשראי" url="https://pay.example.com/?sum={total}&amp;ref={order}" />
  <bent-coupon code="WELCOME10" percent="10" min="100" until="2026-12-31" uses="100" />
</bent-store>
```

| Tag | Attributes | Notes |
|---|---|---|
| `bent-store` | `version="1"`, `name`, `currency=ILS\|USD\|EUR\|GBP`, `mode="merge"`, `note` | the root. **Never** the open/closed switch — a pasted document can fill a store, not open one |
| `bent-store-rules` | `vat`, `vat-included`, `vat-exempt`, `min-order`, `low-stock`, `order-start`, `require-email`, `terms` (a page), `thanks` | absent = unchanged |
| `bent-shelf` | `id`, `label` | a category |
| `bent-sku` | `id` (the SKU — identity), `title`, `price`, `was`, `stock`, `shelf`, `status=active\|hidden\|draft`, `image`, `images` (space-separated), `badge`, `summary`, `delivery="false"` (digital / service), `max` (per order) | body text = the description (a blank line starts a paragraph) |
| `bent-variant` | `id`, `label`, `price` (absent = the product's), `stock` | an option, inside its product; with options, stock is counted per option |
| `bent-ship` | `id`, `label`, `price`, `free-over`, `address="false"`, `note` | any `<bent-ship>` replaces the list; none = unchanged |
| `bent-pay` | `id`, `kind=call\|bank\|bit\|paybox\|cash\|link`, `label`, `phone`, `url` (https, `{total}` `{order}` `{currency}`) | body text = the instructions the shopper reads |
| `bent-coupon` | `code`, `percent` \| `amount` \| `free-shipping="true"`, `min`, `starts`, `until` (YYYY-MM-DD, inclusive), `uses`, `active="false"`, `note` | |

Money is written as a person writes it (`89.90`, no symbol). The serializer is deterministic and `serialize(parse(serialize(x))) === serialize(x)`. Default rules stay out of an exported document.

**Why these tags:** `bent-product` and `bent-category` are page modules — a chat that learned the page language must never mistake a catalog for a page. Inside a `<bent-store>` the parser still reads those spellings (and `bent-option`, `bent-shipping`, `bent-payment`, `bent-discount`, `sku=`, `name=`, `compare-at=`, `qty=`, `category=` …) and says so in the notes. `bent-shop` is deliberately **not** read as the root: it is the storefront page module, and a pasted page must never read as an empty catalog.

### What applying means (a person can predict it)

- A product is matched by its `id`; a new id is a new product.
- **A whole document** (with `<bent-store>`) is the whole catalog: a product it does not mention is **hidden** — never deleted, so its orders and its page stay — and a coupon it does not mention is switched off.
- **A fragment** (no wrapper) or `mode="merge"` only adds and updates.
- `stock` absent on a product that exists **keeps today's stock** (a rewritten catalog must not reset what orders have moved); `stock="unlimited"` turns counting off.
- A section that is absent (no `<bent-ship>`, no `<bent-pay>`, no rules) leaves that part of the store as it is.
- Every apply is preceded by a backup of the store as it stood — **as a `<bent-store>` document** (`store_backups`, newest 10). "↩ ביטול החלה אחרונה" puts it back and backs up the state it replaces.

### Refusals (nothing written)

`NO_STORE`, `PAGE_NOT_STORE` ("זה דף, לא חנות"), `MENU_NOT_STORE`, `THEME_NOT_STORE`, `REPLY_TOO_LONG` (over 400,000 characters), `TOO_MANY_PRODUCTS` (over 500), `NO_VALID_PRODUCTS`.

### Warnings

**Hard** — apply asks for a confirmation (`NEEDS_CONFIRM`): `PRODUCT_INVALID` (that product is skipped), `EMPTY_STORE` (a whole document with no products would hide them all), `MANY_HIDDEN` (more than half the active products would be hidden), `COUPON_INVALID`, `SETTINGS`, `CURRENCY_CHANGE` (a store that already has orders).
**Soft** — shown in the preview: `PRODUCT_FIXED`, `DUPLICATE_SKU`, `PRICE_ZERO`, `SHELF_CREATED`, `SHELF_INVALID`, `RULE_INVALID`, `CURRENCY`, and the parser's notes (`NO_WRAPPER`, `TAG_ALIAS`, `ATTR_ALIAS`, `CURLY_QUOTES`, `UNCLOSED_SKU`, `ORPHAN_VARIANT`, `SEVERAL_DOCUMENTS`).

### The doors

- `/admin/store/bentml` — the live document, a textarea, ⬇ `store.bent`, ⬆ a file, 👁 preview (writes nothing), ✅ apply (only the previewed text), the backups with ⬇ and restore.
- **🛍 כותב/ת הקטלוג** (`src/injections/store-catalog.js`) — the injection pack on the same screen: a prompt carrying the grammar, the store as it is today (trimmed to the budget: descriptions first, then products from the bottom) and the site's real pictures; the owner pastes the reply back (or runs it with the connected AI); the same preview → apply → undo.
- `GET /admin/api/store/export.bent`, `POST /admin/api/store/preview`, `/apply`, `/undo`, `/backups/:id/restore`.

## The pack — backup, hot swap, another install

- **The database `.pzn`** (אחסון → ייצוא ‎.pzn, the daily backup shelf, שחזור מקובץ) is the site's SQLite file, and the store lives in it: `store_meta` (settings, the open flip, the store pages), `store_products` / `store_variants` / `store_shelves`, `store_coupons`, `store_orders` / `store_order_items` / `store_order_events`, `store_backups`. A live restore brings back the whole shop, and `afterRestore()` puts the store pages and the static site in step with it.
- **The site package** (הגדרות → ייצוא האתר) carries the catalog as its `<bent-store>` document (`pkg.store.source`) — never the orders, which are records about people. An import applies it through the same door, as a merge unless the import overwrites, and never opens the store.
- Nothing secret is in either: a payment method holds instructions a shopper reads (bank details, a Bit number, the address of the owner's own payment page). No card number and no gateway key ever reaches the store.

## Money and orders

- Integer minor units (agorot) end to end; `money.js` parses what a person types (`89.90`, `₪89,90`, `1,234.50`, `1.234,50`) and refuses what is ambiguous (`1.234`). One formatter everywhere.
- **The browser holds identifiers and quantities only.** Every sum comes from `pricing.quote()` on the server — the cart page, the checkout summary and the order itself — so a price edited in the admin, or tampered with in a browser, is never what an order is charged.
- VAT: inside the price by default (Israel's retail rule, 18%); on top for a B2B shop; none for an exempt business (עוסק פטור).
- An order is one `BEGIN IMMEDIATE` transaction: re-quote, take the stock (`… WHERE stock >= qty`), take a coupon use (`… WHERE used < max_uses`), write. Two shoppers — in this process or another on the same file — racing for the last unit: one order, one "העגלה השתנתה".
- An order copies what it sold (title, option, unit price): editing or deleting a product never rewrites history. Cancelling returns the stock and the coupon use; restoring a cancelled order takes them again or names what is missing.
- Order numbers start at `order-start` (1001) and only go up. The order page is reached by a random 24-character token; it shows the payment instructions and the first name, never the phone, the email or the street.

## The public doors

| Route | What | Guard |
|---|---|---|
| `GET /api/store/catalog` | the live catalog (for integrations) | 120/min per IP |
| `POST /api/store/quote` | a cart → the server's totals | 120/min, 32 KB |
| `POST /api/store/checkout` | place the order | 8/min, 32 KB, honeypot, JSON only (a cross-site form cannot forge one) |
| `GET /api/store/order/:token` | the order page's data | 60/min, `no-store`, `noindex` |

## Privacy

With the CRM on, a buyer becomes (or enriches) a person — status `customer`, tag `store`, the order on the timeline (`store.order`). A subject export lists their orders (by contact **and** by email/phone — an order placed while the CRM was off has no contact link). An erasure request strips the person from every order and keeps the sale (`erased = 1`): a business keeps its sales records, and they are no longer about anyone. No server-side "Purchase" conversion is sent.

## Mail

Through the site's SMTP (`src/notify.js`): the owner hears about every order (`notifyEmail`, else the site's notification address); the shopper gets a confirmation and, when the order ships or is cancelled, a note. Nothing is sent before the order is saved, and a mail failure never costs an order.

## Not done (said plainly)

- **Card gateways with an API** (Grow, Cardcom, PayPlus, Tranzila, Stripe, PayPal): not built. The `link` method sends the shopper to the owner's own payment page with the sum and the order number, and the owner marks the order paid. A gateway integration is a separate door with its own review — it moves money.
- **Tax invoices** (חשבונית מס / קבלה): not issued. The printable slip says it is an order summary, not a tax invoice.
- **Server-side Purchase conversions** to Meta / Google: not sent.
- **Shipping zones and weights**: a method has one price and an optional free-over threshold.
