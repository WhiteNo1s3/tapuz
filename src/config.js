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
    enabled: false,
    // Marketing pixels (v1.79, phase 3). Every one of these ships OFF, and
    // `requireConsent` defaults ON: a tracker that loads before the visitor
    // agrees is the default we refuse to ship, whatever the law says this week.
    pixels: {
      enabled: false,
      requireConsent: true,
      banner: true,            // use our built-in consent bar (off = wire your own)
      meta: { pixelId: '' },
      googleAds: { conversionId: '', conversionLabel: '' },
      tiktok: { pixelId: '' },
      linkedin: { partnerId: '' }
    },
    // Server-side conversions (v1.80, phase 3b). The browser pixel can be
    // blocked; a server-to-server event cannot. Both fire for the SAME
    // conversion and carry the same eventId so the vendor deduplicates them.
    // Off by default, and gated on the visitor's consent exactly like the
    // browser side — a refusal must mean refused everywhere.
    conversions: {
      enabled: false,
      meta: { pixelId: '', accessToken: '', testEventCode: '' },
      ga4: { measurementId: '', apiSecret: '' }
    },
    // Retention (v1.82, phase 5). Behaviour data grows without limit, and
    // keeping it forever is a liability rather than an asset. 0 = keep
    // everything (the default, because silently deleting an owner's data would
    // be worse than growth); set a day count to prune older behaviour events.
    // Events that anchor a record elsewhere — a form submission — are never
    // pruned, whatever this says.
    retention: {
      eventDays: 0
    },
    // Customer-service chat (v1.83). The ONLY CRM surface where an anonymous
    // visitor can spend the owner's money, so it ships off and every limit has
    // a conservative default. `dailyMessageCap` is the hard stop: exact,
    // countable, and enforced before the model is ever called.
    cs: {
      enabled: false,
      dailyMessageCap: 100,
      perSessionCap: 20,
      greeting: 'שלום! אני העוזר של האתר. איך אפשר לעזור?',
      businessInfo: ''
    }
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
      // CRM: its own stanza per this file's rule, so a site.json written before
      // a future crm subkey existed still exposes the full default shape.
      // `pixels` needs a nested stanza of its own for the same reason — and
      // each vendor block below it, so a partial write can never leave a vendor
      // key undefined where the renderer would read it.
      const dc = data.crm || {};
      const dp = dc.pixels || {};
      const dv = dc.conversions || {};
      merged.crm = {
        ...clone(DEFAULT_CONFIG.crm),
        ...dc,
        pixels: {
          ...clone(DEFAULT_CONFIG.crm.pixels),
          ...dp,
          meta: { ...clone(DEFAULT_CONFIG.crm.pixels.meta), ...(dp.meta || {}) },
          googleAds: { ...clone(DEFAULT_CONFIG.crm.pixels.googleAds), ...(dp.googleAds || {}) },
          tiktok: { ...clone(DEFAULT_CONFIG.crm.pixels.tiktok), ...(dp.tiktok || {}) },
          linkedin: { ...clone(DEFAULT_CONFIG.crm.pixels.linkedin), ...(dp.linkedin || {}) }
        },
        conversions: {
          ...clone(DEFAULT_CONFIG.crm.conversions),
          ...dv,
          meta: { ...clone(DEFAULT_CONFIG.crm.conversions.meta), ...(dv.meta || {}) },
          ga4: { ...clone(DEFAULT_CONFIG.crm.conversions.ga4), ...(dv.ga4 || {}) }
        },
        retention: { ...clone(DEFAULT_CONFIG.crm.retention), ...(dc.retention || {}) },
        cs: { ...clone(DEFAULT_CONFIG.crm.cs), ...(dc.cs || {}) }
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
