// Simple site config for Tapuz
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(require('./paths').CONFIG_DIR, 'site.json');

const DEFAULT_CONFIG = {
  title: "Tapuziel",
  description: "אתר בנוי עם Tapuziel CMS",
  baseUrl: "",
  defaultTheme: "default",
  language: "he",
  // The page that owns '/' (full_path). Empty = automatic ranked detection
  // (scoreHomeCandidate) — the pre-v0.78 behavior. Set explicitly by the
  // wizard, the pages screen (קבע כדף הבית), or site settings.
  homepage: "",
  integrations: {
    whatsapp: {
      enabled: false,
      phone: "",
      message: "",
      position: "start" // logical: start = right on RTL pages
    }
  },
  seo: {
    titlePattern: "",     // e.g. "{page} · {site}" — empty = page title only
    defaultOgImage: ""    // fallback og:image when a page has none
  },
  // CRM (v1.77). A SEPARATE PRODUCT that integrates, not a CMS feature: the
  // CMS calls into it through a handful of hooks and never the reverse, and
  // this single flag turns the whole subsystem off. Off = the CMS behaves
  // exactly as it did before the CRM existed. See docs/CRM-INTEGRATION.md.
  crm: {
    enabled: false
  },
  // S3: CMS-managed site chrome. The header/footer belong to the whole website
  // and wrap EVERY public page (serve + static export). Empty values fall back
  // to today's behavior so nothing regresses.
  header: {
    tagline: "",          // small text beside the logo
    showLogo: true,       // hide the logo if false
    sticky: true,         // sticky header on scroll
    ctaLabel: "",         // header call-to-action button label (empty = no CTA)
    ctaUrl: ""            // header CTA target URL
  },
  footer: {
    text: "",             // free footer text (line breaks preserved)
    columns: [],          // [{ title, links: [{ label, url }] }]
    social: [],           // [{ network, url }]
    showCredit: true      // show the small "נבנה עם Tapuziel" credit line
  },
  admin: {
    // URL path of the admin area (S2). Change to a hard-to-guess value for a
    // security-by-obscurity layer ON TOP of authentication — never instead of
    // it. The TAPUZ_ADMIN_PATH env var overrides this. Secrets (session key,
    // password hashes) are NOT stored here — they live in config/auth.json.
    path: "/admin"
  },
  // S5 + S6: analytics. Everything here is PUBLIC-safe config — no secrets.
  analytics: {
    // S6 — Tapuz's own privacy-respecting pageview collector. Beacons only
    // reach the collector while a Tapuz server is live at collectorUrl. For
    // exported sites hosted off-box, set collectorUrl to an ABSOLUTE URL of a
    // running Tapuz instance (or first-party stats silently stop — GA4 still
    // works since it POSTs to Google). See docs/analytics.md.
    firstParty: {
      enabled: true,
      collectorUrl: "/_tapuz/collect"
    },
    // S5a — Google Analytics 4. The Measurement ID (G-XXXX) is PUBLIC, not a
    // secret; safe to store here and inline into public pages.
    ga4: {
      measurementId: ""
    },
    // S5b — reading GA stats BACK via the GA Data API. DISABLED scaffold only.
    // Needs the optional @google-analytics/data dependency + a service-account
    // JSON SECRET the user supplies (path kept OUTSIDE the web root/exports) +
    // the numeric GA4 property ID. See docs/analytics.md and src/ga-data.js.
    gaDataApi: {
      enabled: false,
      propertyId: "",
      serviceAccountPath: "",
      note: "Disabled. Requires @google-analytics/data + a service-account JSON key. See docs/analytics.md."
    }
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      const merged = { ...clone(DEFAULT_CONFIG), ...data };
      // Deep-merge integrations so older site.json files (or partial writes)
      // still expose the full default shape.
      merged.integrations = {
        ...clone(DEFAULT_CONFIG.integrations),
        ...(data.integrations || {}),
        whatsapp: {
          ...clone(DEFAULT_CONFIG.integrations.whatsapp),
          ...((data.integrations || {}).whatsapp || {})
        }
      };
      merged.seo = {
        ...clone(DEFAULT_CONFIG.seo),
        ...(data.seo || {})
      };
      // Each nested default needs its own merge stanza (the top-level spread is
      // shallow), otherwise a partial site.json drops new default subkeys.
      merged.admin = {
        ...clone(DEFAULT_CONFIG.admin),
        ...(data.admin || {})
      };
      // Site chrome (S3). Arrays (footer.columns/social) are replaced wholesale
      // by the spread when present — element-wise merge is NOT wanted here.
      merged.header = {
        ...clone(DEFAULT_CONFIG.header),
        ...(data.header || {})
      };
      merged.footer = {
        ...clone(DEFAULT_CONFIG.footer),
        ...(data.footer || {})
      };
      // Analytics (S5/S6): deep-merge each nested block so older/partial
      // site.json files still expose the full default shape — otherwise the
      // renderer injection reads `undefined` and crashes.
      const da = data.analytics || {};
      merged.analytics = {
        ...clone(DEFAULT_CONFIG.analytics),
        ...da,
        firstParty: {
          ...clone(DEFAULT_CONFIG.analytics.firstParty),
          ...(da.firstParty || {})
        },
        ga4: {
          ...clone(DEFAULT_CONFIG.analytics.ga4),
          ...(da.ga4 || {})
        },
        gaDataApi: {
          ...clone(DEFAULT_CONFIG.analytics.gaDataApi),
          ...(da.gaDataApi || {})
        }
      };
      return merged;
    }
  } catch (e) {}
  return clone(DEFAULT_CONFIG);
}

function saveConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG
};
