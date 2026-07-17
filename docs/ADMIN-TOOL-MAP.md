# Admin Tool Map — the A++ teardown

The same move the decompiler makes on pages, applied to admin panels: tear down
the A++ platforms (WordPress, Wix, Webflow, Squarespace), map what they offer
against what we offer, and keep an honest gap list. Two rules:

1. **The nav never lies.** A tool appears in `ADMIN_NAV_GROUPS` (src/server.js)
   only when it actually ships. No "מייל" menu item with a coming-soon page —
   we don't offer mail, so the word doesn't appear in the admin.
2. **The gap list is the backlog, not the UI.** This doc + `config/tool-gap.json`
   (the decompiler's vocabulary engine) decide what we build next.

## Our inventory (v0.69) — as categorized in the admin

| קבוצה | צבע | כלים |
|---|---|---|
| תוכן | `#2563eb` | דפים, ייבוא (URL / HTML / WordPress / AI-paste), קטגוריות |
| מדיה | `#0d9488` | ספריית מדיה (תיקיות, העלאה, webp ingestion), אחסון |
| עיצוב | `#7c3aed` | ערכת נושא, תפריטים, כותרת ותחתית |
| קידום | `#059669` | SEO (meta + sitemap.xml + robots.txt), מפת אתר, אנליטיקס (GA), אינטגרציות (WhatsApp, מפות) |
| AI | `#c026d3` | קופיילוט (BYOT roleplay), גשר סוכן (extension/token) |
| מערכת | `#475569` | הגדרות אתר |

Plus the page builder itself (reached by editing a page), the decompiler
(inside ייבוא), publish/export, and revisions.

## The A++ grid

What the four platforms group their admin into, roughly normalized:

| Category | WordPress | Wix | Webflow | Squarespace | Tapuz |
|---|---|---|---|---|---|
| Content / pages | Posts + Pages | Pages | Pages + CMS collections | Pages | ✅ דפים |
| Media | Media library | Media manager | Assets | Asset library | ✅ מדיה |
| Design / theme | Themes + Customizer | Editor + Site design | Designer + Style panel | Design panel | ✅ עיצוב |
| Navigation | Menus | Menus & pages | Navbar element | Navigation | ✅ תפריטים |
| SEO | Plugins (Yoast) | SEO tools | SEO settings | SEO panel | ✅ SEO (built-in, no plugin needed) |
| Analytics | Plugins / Jetpack | Wix Analytics | — (GA hookup) | Built-in analytics | ✅ אנליטיקס (GA) |
| Import/export | Tools → Import | — (weak) | — | Import | ✅ ייבוא (stronger: decompiler) |
| AI assist | — (plugins) | Wix ADI/AI | AI assistant | Squarespace AI | ✅ AI (BYOT — differentiator) |
| **Forms + inbox** | Plugins (CF7/Gravity) | Wix Forms + inbox | Form block + submissions | Form block + storage | ⚠️ form module renders, **no submissions inbox** |
| **Email / newsletter** | Plugins | Wix Email marketing | — | Email campaigns | ❌ not offered — and not shown |
| **Blog / posts** | Core (Posts) | Wix Blog | CMS collections | Blog | ⚠️ קטגוריות is a seed; no post-type/feed yet |
| **Users & roles** | Users | Team roles | Team members | Contributors | ❌ single admin account |
| **Comments** | Core | Members area | — | Comments | ❌ |
| **E-commerce** | WooCommerce | Wix Stores | Webflow Ecommerce | Commerce | ❌ (deliberately out for now) |
| **Domains / hosting** | (hosted case) | Domains panel | Publishing/hosting | Domains | ❌ (deploy is dev-side) |
| **Backups / versioning** | Plugins | Site history | Backups | Version history | ⚠️ page revisions exist; no whole-site snapshots |
| **Scheduling** | Publish schedule | Schedule posts | — | Scheduled posts | ❌ publish is now-only |
| **App market** | Plugin directory | App market | Apps | Extensions | ❌ (modules are our "apps"; registry is the seam) |
| **Multilingual** | Plugins (WPML) | Wix Multilingual | Localization | — (weak) | ⚠️ per-page direction (RTL/LTR); no locale duplication |

## Gap list, prioritized

Ordered by (customer pain for a small-business site) × (distance from what we
already have):

1. **Form submissions inbox** — the form module (v0.58) renders but submissions
   go to an external `action` or nowhere. A tiny `/admin/forms` inbox + a POST
   endpoint closes the loop every competitor has. Smallest gap, biggest lie
   we're currently telling by shipping a form block.
2. **Publish scheduling** — draft→published is instant-only. Cron-style
   "publish at" is cheap on top of the existing draft/publish split.
3. **Blog on top of categories** — קטגוריות (v0.64) already groups pages; a
   dated post-type + feed page makes it a blog. WordPress's core strength.
4. **Whole-site snapshots** — revisions exist per page; zip the pages/ +
   config/ + uploads into a downloadable snapshot. "Backups" checkbox.
5. **Users & roles** — second admin / editor-only role. Needed before the
   sister-tester becomes a customer-shaped multi-user story.
6. **Email / newsletter** — big and deliberate. When it comes, it's probably
   BYOK-style (customer's own provider key), not us running SMTP.
7. **Multilingual** — Hebrew-first is our edge; locale duplication of a page
   tree is the honest version of this, later.

Out of scope on purpose: e-commerce, app market, domains (deploy stays
dev-side per the Red Hat-style support model).

## The vocabulary engine feed

`config/tool-gap.json` aggregates what the decompiler saw on real sites but
couldn't map. Current state:

```json
{ "columns": 2 }
```

Multi-column free layouts came up twice — that's the carousel/halves/columns
work already queued (v2-halves-demo draft exists). Every A++ teardown run
through ייבוא grows this file; check it before picking the next module.
