// GA Data API read-back (S5b) — DISABLED, DOCUMENTED SCAFFOLD.
//
// Injecting GA4 into public pages (S5a) is public and trivial. READING stats
// BACK from Google is a different animal and is intentionally NOT active yet:
//
//   1. It needs an OPTIONAL npm dependency, `@google-analytics/data`, which is
//      deliberately NOT in package.json (Tapuz's rule is zero required deps).
//      It is lazy-`require`d inside a try/catch so the app never crashes when
//      the package is absent.
//   2. It needs a Google Cloud SERVICE-ACCOUNT JSON key — a genuine SECRET the
//      user creates in GCP and grants Viewer on their GA4 property. Tapuz never
//      hardcodes, invents, or transmits this key. Store it OUTSIDE the web root
//      and OUTSIDE any export directory. Point config.analytics.gaDataApi
//      .serviceAccountPath at that file.
//   3. It needs the numeric GA4 PROPERTY ID (distinct from the G- Measurement
//      ID) in config.analytics.gaDataApi.propertyId.
//
// Until the user supplies all three AND flips gaDataApi.enabled to true, every
// entry point below is a guarded no-op that returns a clear "not configured"
// reason. Full setup steps live in docs/analytics.md.

const fs = require('fs');
const { loadConfig } = require('./config');

/**
 * Report whether GA Data API read-back is usable. NEVER throws.
 * @returns {{ enabled: boolean, reason: string, api?: object, lib?: object }}
 */
function status() {
  let cfg;
  try { cfg = loadConfig(); } catch (e) { return { enabled: false, reason: 'Config unavailable.' }; }
  const api = (cfg.analytics && cfg.analytics.gaDataApi) || {};

  if (!api.enabled) {
    return { enabled: false, reason: 'GA Data API read-back is disabled in settings.' };
  }
  if (!api.propertyId) {
    return { enabled: false, reason: 'Missing GA4 numeric property ID.' };
  }
  if (!api.serviceAccountPath || !fs.existsSync(api.serviceAccountPath)) {
    return { enabled: false, reason: 'Service-account JSON key file not found at the configured path.' };
  }
  // Optional dependency — probe without hard-failing.
  let lib = null;
  try {
    lib = require('@google-analytics/data');
  } catch (e) {
    return {
      enabled: false,
      reason: 'Optional dependency "@google-analytics/data" is not installed. Run: npm install @google-analytics/data'
    };
  }
  return { enabled: true, reason: 'Configured.', api, lib };
}

/**
 * Fetch a GA4 report. Currently a documented, DISABLED code path: it throws a
 * `notConfigured` error rather than contacting Google, so nothing can leak a
 * credential by accident. To activate, the user supplies credentials, flips
 * gaDataApi.enabled, installs the optional dep, and un-comments the block below.
 *
 * @param {{ startDate?: string, endDate?: string }} [range]
 */
async function fetchGaReport(range = {}) {
  const st = status();
  if (!st.enabled) {
    const err = new Error(st.reason);
    err.notConfigured = true;
    throw err;
  }

  // --- DISABLED reference implementation (enable after supplying credentials):
  //
  // const { BetaAnalyticsDataClient } = st.lib;
  // const client = new BetaAnalyticsDataClient({ keyFilename: st.api.serviceAccountPath });
  // const [resp] = await client.runReport({
  //   property: `properties/${st.api.propertyId}`,
  //   dateRanges: [{ startDate: range.startDate || '28daysAgo', endDate: range.endDate || 'today' }],
  //   dimensions: [{ name: 'date' }],
  //   metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }]
  // });
  // return resp;

  const err = new Error('GA Data API code path is intentionally disabled. See docs/analytics.md to enable it.');
  err.notConfigured = true;
  throw err;
}

module.exports = { status, fetchGaReport };
