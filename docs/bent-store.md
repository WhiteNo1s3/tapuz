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
  <bent-pay id="link" kind="link" label="דף התשלום שלנו" url="https://pay.example.com/?sum={total}&amp;ref={order}" />
  <bent-pay id="card" kind="card" label="כרטיס אשראי" max-payments="3" />
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
| `bent-pay` | `id`, `kind=call\|bank\|bit\|paybox\|cash\|link\|card`, `label`, `phone`, `url` (https, `{total}` `{order}` `{currency}`), `max-payments` (1–36, `card` only) | body text = the instructions the shopper reads. `card` = the [card gateway](#the-card-gateway--grow-and-cardcom): the document says only what the shopper sees and how many installments; the provider, the mode and the keys are never in it. A `card` method in a document while no gateway is connected is accepted with the note `CARD_NOT_CONNECTED` and stays off the checkout until one is |
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
- Nothing secret is in either: a payment method holds instructions a shopper reads (bank details, a Bit number, the address of the owner's own payment page, a card method's label and installments). No card number ever reaches the store, and the card gateway's keys live in gitignored `config/payments.json` — outside the `.pzn`, outside the package — so a restored shop shows its card method as "not connected" until they are typed again on that install. `store_payments` (the gateway's rows: amounts, approvals, last-4, the provider's ids) does travel in the database `.pzn` with its orders.

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
| `GET /api/store/order/:token` | the order page's data (a pending card payment is verified first, throttled) | 60/min, `no-store`, `noindex` |
| `POST /api/store/pay/:token` | open (or reuse) the card gateway's hosted page → `{ url }` | 12/min, 32 KB, JSON only, ≤ 10 sessions per order |
| `POST\|GET /api/store/gateway/:provider/hook` | the provider's callback (never believed — see below) | 120/min, raw body ≤ 64 KB, mounted before the body parsers |

## Privacy

With the CRM on, a buyer becomes (or enriches) a person — status `customer`, tag `store`, the order on the timeline (`store.order`). A subject export lists their orders (by contact **and** by email/phone — an order placed while the CRM was off has no contact link). An erasure request strips the person from every order and keeps the sale (`erased = 1`): a business keeps its sales records, and they are no longer about anyone. No server-side "Purchase" conversion is sent.

## Mail

Through the site's SMTP (`src/notify.js`): the owner hears about every order (`notifyEmail`, else the site's notification address); the shopper gets a confirmation and, when the order ships or is cancelled, a note. Nothing is sent before the order is saved, and a mail failure never costs an order.

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

- **Other gateways** (PayPlus, Tranzila, Stripe, PayPal): not built — the driver interface in `src/store/gateway/index.js` is the door. The `link` method still sends the shopper to the owner's own payment page with the sum and the order number, and the owner marks the order paid.
- **Tax invoices** (חשבונית מס / קבלה): not issued — neither by us nor through the providers (Cardcom's `Document` needs its Documents module; Grow's invoice fields are not sent). The printable slip says it is an order summary, not a tax invoice. A follow-up.
- **Grow's account-level "webhooks"** (a different JSON shape with a `webhookKey`, no `processToken`) are ignored on purpose: only the per-process server update carries the trust anchor.
- **Server-side Purchase conversions** to Meta / Google: not sent.
- **Shipping zones and weights**: a method has one price and an optional free-over threshold.
