# Analytics in Tapuz

Tapuz gives you two independent ways to measure traffic. You can use either, both, or neither.

1. **First-party analytics (S6)** — Tapuz collects its own privacy-respecting
   pageview stats and shows them in the CMS at **Admin → אנליטיקס**. No third
   party, no cookies, no raw IP addresses.
2. **Google Analytics 4 (S5)** — inject Google's `gtag` snippet so Google
   collects data. Optionally (advanced) read those stats back into Tapuz via
   the GA Data API.

All of this is configured under **Admin → אינטגרציות**.

---

## 1. First-party analytics (privacy-respecting)

### How it works

* When enabled, every public page rendered by Tapuz (both live-served pages and
  statically exported ones) includes a tiny inline `<script>` beacon at the end
  of `<body>`. On load it POSTs `{ path, ref }` to the **collector** endpoint,
  `POST /_tapuz/collect`, on the Tapuz origin.
* The collector derives everything sensitive **server-side** and stores only:

  | column          | what it is                                             |
  | --------------- | ------------------------------------------------------ |
  | `path`          | the page path (e.g. `/about`)                          |
  | `referrer_host` | the **host only** of the referrer (no path, no query)  |
  | `device_class`  | a coarse bucket: `mobile` / `tablet` / `desktop`       |
  | `visitor_hash`  | `HMAC-SHA256(daily-salt, ip + '\|' + userAgent)`, 16 hex |
  | `created_at`    | timestamp                                              |

* **No raw IP address and no full User-Agent are ever stored.** The visitor
  hash uses a random salt that rotates every UTC day; prior days' salts are
  discarded, so a hash is non-reversible and cannot be linked across days. This
  gives an honest "unique-ish daily visitors" count without identifying anyone.

### Privacy & abuse protections built into the collector

* **Do-Not-Track / Global Privacy Control** — if the browser sends `DNT: 1` or
  `Sec-GPC: 1`, nothing is recorded (the beacon also checks `navigator.doNotTrack`
  client-side and skips the request entirely).
* **Bot filter** — obvious crawlers (by User-Agent) are dropped.
* **Admin surface excluded** — pageviews to `/admin` (or your custom admin
  base) are never tracked.
* **Request size cap** — the collector parses at most a 2 KB JSON body (its own
  tight limit, independent of the 12 MB admin upload limit).
* **Per-IP rate limit** — a fixed-window per-IP cap (default 120 req/min,
  override with the `TAPUZ_COLLECT_MAX` env var) returns `429` when exceeded.

### ⚠️ The static-export caveat (read this)

Tapuz serves public pages as **static HTML**. When you click **בנה אתר**
(export), you get standalone `.html` files you can host anywhere.

* If the site is **served by the Tapuz server**, the default relative collector
  URL `/_tapuz/collect` just works.
* If you **export the site and host it elsewhere** (Netlify, S3, GitHub Pages,
  nginx, …), the Tapuz server is *not* part of that deployment. A relative
  `/_tapuz/collect` POST would hit the static host and be dropped. To keep
  first-party analytics working you must set the **collector URL** (Admin →
  אינטגרציות → אנליטיקס פנימי) to an **absolute URL of a still-running Tapuz
  instance**, e.g. `https://cms.example.co.il/_tapuz/collect`. That instance
  must stay up and allow the request (CORS / same box).
* **Google Analytics is not affected** by this — GA4 always POSTs to Google's
  own collectors, so it keeps working on a purely static host even when
  first-party analytics record nothing.

If you host the exported site off-box and don't set an absolute collector URL,
first-party stats simply stay empty. That is expected, not a bug.

---

## 2. Google Analytics 4 (GA4) — injection (active)

1. In Google Analytics, create a GA4 property and copy its **Measurement ID**
   (looks like `G-XXXXXXXXXX`).
2. Admin → אינטגרציות → **Google Analytics 4** → paste the ID → save.
3. Rebuild the site (**בנה אתר**). Every public page now includes the standard
   `gtag.js` snippet high in `<head>`.

The Measurement ID is **public, not a secret** — it is safe to store in
`config/site.json` and to inline into pages. Leave the field empty to inject
nothing.

---

## 3. GA Data API read-back (S5b) — DISABLED scaffold (advanced)

Reading your GA stats *back* into Tapuz is fundamentally different from
injection: it requires a **secret** and an extra dependency, so it ships as a
documented, disabled scaffold. Tapuz never hardcodes, invents, or transmits a
credential for you.

To enable it yourself:

1. **Install the optional dependency** (deliberately not in `package.json`):

   ```
   npm install @google-analytics/data
   ```

2. **Create a Google Cloud service account** and download its **JSON key**.
   In the Google Analytics Admin, add that service account's email as a user
   with at least **Viewer** on the GA4 property.

3. **Store the JSON key file OUTSIDE the web root and OUTSIDE any export
   directory** (so it can never be served or exported). For example
   `/secure/ga-service-account.json`.

4. **Find your numeric GA4 Property ID** (Admin → Property Settings — this is a
   number like `123456789`, distinct from the `G-` Measurement ID).

5. In Admin → אינטגרציות → **קריאת נתוני GA בחזרה**, fill in the Property ID and
   the path to the key file, and tick "enable".

6. Open `src/ga-data.js` and un-comment the reference `runReport` block. The
   `status()` helper there validates each prerequisite and returns a clear
   reason string until everything is in place; `fetchGaReport()` throws a
   `notConfigured` error until you activate the code path.

Until you do all of the above, the CMS dashboard shows a clear "not configured"
status for read-back, and no credential handling code runs.

---

## Config shape

Stored in `config/site.json` (all public-safe — **no secrets**; the GA Data API
key lives only on disk at the path you configure, never in this file):

```json
{
  "analytics": {
    "firstParty": { "enabled": true, "collectorUrl": "/_tapuz/collect" },
    "ga4": { "measurementId": "" },
    "gaDataApi": {
      "enabled": false,
      "propertyId": "",
      "serviceAccountPath": "",
      "note": "Disabled. Requires @google-analytics/data + a service-account JSON key."
    }
  }
}
```

## Files

* `src/analytics.js` — privacy-safe pageview record + dashboard aggregations.
* `src/ga-data.js` — disabled, documented GA Data API scaffold.
* `src/renderer.js` — `renderGa4Snippet()` (into `<head>`) and
  `renderAnalyticsBeacon()` (before `</body>`).
* `src/server.js` — `POST /_tapuz/collect` collector + `GET /admin/analytics`
  dashboard.
* `src/db.js` — `pageviews` and `analytics_salt` tables.
* `scripts/smoke-analytics.js` — end-to-end + unit smoke tests.
