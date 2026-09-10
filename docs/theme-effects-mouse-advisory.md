# Advisory — Theme EFFECTS mouse effect: does it take effect on the live site?

_Status: **RESOLVED — the mouse effect works end-to-end on `main`.** No code fix was
required in the effect-execution path. This note records how a new theme + mouse
effect were built with the product's own tools, how the effect travels through the
render/serve/export pipeline, the empirical verification that `effects.js` actually
**executes** in the browser on a live page, and the (peripheral) conditions under
which an owner could still perceive an effect as "not taking effect" — each with a
root cause and a recommendation._

Ben's request, paraphrased: _"Make a new theme using the tools. Do the mouse effect
and make sure it's working. If it is NOT working, state why and note it. Use an
advisor and make a file. If you can fix it, fix it."_

---

## 1. What was built (with the product's own tools)

- **New theme:** `תפוז עם עקבת עכבר` ("Tangerine with a mouse trail"), created through the
  **Theme Library** tool (`saveCurrentAsTheme` → `POST /admin/api/theme/library`,
  `src/theme-library.js`). It is a library artifact and reaches the live site only via
  `applyTheme` — the intended door (`POST /admin/api/theme/library/apply`).
- **Mouse effect:** an orange **cursor trail** — 18 easing dots that follow the pointer
  with a soft orange radial glow (`--color-primary`), added through the **Theme EFFECTS**
  feature (v2.22) using the real FRESH-chat paste flow
  (`POST /admin/api/theme/effects/paste`, `src/routes/theme.js`). The snippet is a
  self-contained IIFE that waits for the DOM on its own and honours
  `prefers-reduced-motion`, exactly as the generated prompt contracts.

The effect lives inside `config/theme-overrides.json` under `effects: { css, js, note }`,
so it rides theme packages and the library with no extra plumbing
(`src/theme.js`, `DEFAULT_OVERRIDES.effects`).

## 2. How a mouse effect is supposed to reach a live page

| Stage | Code | What happens to the effect |
| --- | --- | --- |
| Effect stored | `src/theme.js` | `effects.css` / `effects.js` inside the site overrides. |
| Effect CSS | `overridesToCss()` (`src/theme.js`) | Appended **last** so it can override anything. Funnels through both the serve path and the static export. |
| Effect JS | `renderThemeEffectsJs()` (`src/theme.js`) | Wrapped in `<script id="tapuz-theme-effects">…</script>`, `</script>`-split for safety, emitted **raw** (trusted-author) — not HTML-escaped. |
| Page assembly | `renderPage()` (`src/renderer.js`) | Effect CSS goes into `<style id="tapuz-theme-overrides">`; effect JS is concatenated into `siteExtras` (last, after WhatsApp/search/consent/pixels) and dropped at the `{{site_extras}}` slot just before `</body>`. |
| Static export | `externalizeStyles()` + `copyThemeAssets()` (`src/export.js`) | `<style>` blocks are stripped and the effect CSS is re-homed into `/css/main.css` (fingerprinted `?v=<hash>` so caches can't serve a stale theme). The effect **`<script>` is NOT stripped** — only `<style>` is — so `effects.js` survives into `public/*.html`. |
| Live serve | `express.static(PUBLIC_DIR)` + CSP middleware (`src/server.js`) | The front-end site is served **statically** from `public/`. The public Content-Security-Policy sets `script-src 'self' 'unsafe-inline' …`, so the inline effect script is **allowed to run**. |

The key nuance Ben flagged — _"is the effect JS injected only into export but not live
serve, or escaped so it never executes?"_ — resolves cleanly: the site root **is** the
static export, the effect `<script>` is emitted verbatim into it, and the CSP permits
inline scripts. There is no escaping and no serve/export asymmetry.

## 3. Verification — does `effects.js` actually EXECUTE? (Yes.)

All checks were run under **Node 24** against the live dev server on
`http://127.0.0.1:3000` with the effect applied and a published homepage.

1. **DOM + real pointer (Chrome DevTools Protocol).** On loading `/`, 18 `.tz-trail-dot`
   elements are created by `effects.js`. After a synthetic `Input.dispatchMouseEvent`
   (`mouseMoved` to 600,450), all 18 dots are visible and the lead dot's transform eased to
   `matrix(1,0,0,1,592.9,442.96)` — i.e. it **follows the cursor**. The orange radial
   gradient is applied. No console errors related to the effect (only an unrelated
   `favicon.ico` 404). This proves the script parsed, ran, bound `mousemove`, and animates.
2. **Accessibility gate.** With `prefers-reduced-motion: reduce` emulated, the effect
   **self-disables** (0 dots) — by design (the snippet and the CSS `@media` block both
   respect it). With `no-preference`, 18 dots. See §4a.
3. **Served HTML/CSS inspection.** `GET /` contains `<script id="tapuz-theme-effects">`
   with the un-escaped IIFE; `GET /css/main.css` contains `.tz-trail-dot { … }`; response
   CSP is the full public policy with `'unsafe-inline'` scripts.
4. **Tool round-trip.** Clearing the effect (`POST /admin/api/theme/effects`) removes it
   from `/` (auto-rebuild); applying the library theme (`…/library/apply`) restores it and
   rebuilds. Both the effects-paste and library-apply routes call `exportAll()`.
5. **Smoke tests (Node 24):** `test:theme-effects`, `test:theme`, `test:theme-route` all
   **PASS**.
6. **Manual browser recording:** the orange trail visibly follows the pointer across the
   live Hebrew/RTL page (see artifacts).

**Conclusion:** the mouse effect takes effect on the live front-end page.

## 4. Where an owner could still perceive "it doesn't take effect" (root causes + recommendations)

These are the honest edge cases. None of them is a defect in the effect-execution path;
they are the realistic ways the _perception_ of a broken effect arises.

### 4a. Visitor (or environment) has reduced motion enabled — **by design**
A visitor with `prefers-reduced-motion: reduce` (an OS/browser accessibility setting, and
the default in many automated/headless environments) sees **no** trail: the snippet bails
early and the CSS hides `.tz-trail-dot`. Verified empirically (0 dots under `reduce`).
**Recommendation:** keep this behaviour (it is correct accessibility). Document it for
owners so a reduced-motion tester does not mistake it for a bug; the effects editor could
surface a one-line hint.

### 4b. Editing the theme via the main "שמור ערכת נושא" button does not rebuild the site — **footgun, not the effect path**
The front-end is served from the **static export** (`public/`). The effects panel, library
apply, and package import all call `exportAll()` after saving, so an effect added that way
goes live immediately. But the primary theme-form save (`POST /admin/api/theme` →
`saveThemeSettings`, `src/routes/theme.js`) **persists overrides without rebuilding**, so
edits made through the main colour/font form are invisible on the live front-end until a
separate build (the "שמור + בנה אתר" button, `npm run export:static`, or `tapuz build`).
Verified: a plain save changed `config/theme-overrides.json` but the served
`/css/main.css` override block was unchanged until a rebuild.
**Recommendation:** this split appears deliberate (a dedicated save-and-build button
exists), so behaviour was left unchanged. Consider either rebuilding on plain save too, or
making the "needs build" state explicit in the UI, to remove the footgun.

### 4c. CDN/host HTML cache — **deploy-time**
The theme stylesheet is cache-busted (`/css/main.css?v=<hash>`), but the effect JS is
inline in the page HTML. A CDN/host that caches the HTML (or the shadowing `public_html`
layer described in `docs/DEPLOY.md`) can keep serving a pre-effect page until purged.
**Recommendation:** purge HTML cache / clear the shadow layer on deploy (already covered by
`scripts/deploy-decoy.js` and the `main.css?v=` fingerprint check in `docs/DEPLOY.md`).

### 4d. Snippet pasted from a non-FRESH chat — **guarded**
If an owner pastes an AI reply that lacks proper ` ```css ` / ` ```js ` fences (e.g. from a
chat already primed on the `.pzn` page language), `POST /admin/api/theme/effects/paste`
returns **400** with guidance to use a FRESH chat, and nothing is saved — so no effect
appears. This is the intended guardrail, not a failure.

## 5. Fix applied

**None required in the effect-execution path** — `effects.css`/`effects.js` are injected on
both the live serve and the static export, the JS is emitted un-escaped, and the public CSP
permits it to run; this is proven by the verification in §3. The peripheral items in §4 are
documented with recommendations; §4b (plain-save-does-not-rebuild) is the only genuine
footgun and is intentionally left as a product decision rather than a silent behaviour
change.

## 6. Evidence (walkthrough artifacts)

- `mouse_cursor_trail_effect_live_site_clean.mp4` — the orange trail following the pointer
  across the live Hebrew/RTL page.
- `screenshot_mouse_trail_spread_live.png` — the 18-dot comet trail strung out along a fast
  cursor path.
- `screenshot_mouse_effect_single_dot_live.png` — the glowing dot resting at the pointer.
