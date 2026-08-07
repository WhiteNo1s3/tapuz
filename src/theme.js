// Theme overrides — site-level knobs that don't fork the theme.
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');

const OVERRIDES_PATH = path.join(require('./paths').CONFIG_DIR, 'theme-overrides.json');

const DEFAULT_OVERRIDES = {
  // The DEFAULT is the תפוז look (v0.72, Ben's order): a new Tapuziel site is
  // warm tangerine with gradient accents — never a colorless white page. The
  // clean-white palette lives on as the 'naki' look, one click away.
  colors: {
    primary: '#ea580c',
    secondary: '#f59e0b',   // gradient partner + secondary accents (v0.72)
    text: '#1c1917',
    muted: '#78716c',
    border: '#ece5df',
    bg: '#fffbf7',
    lightBg: '#fdf1e6',
    surface: '#ffffff'      // cards/panels — separate from page bg (v0.72)
  },
  fonts: {
    family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Hebrew", sans-serif',
    headingFamily: '',      // '' = inherit body family (v0.72 font pairing)
    baseSize: '17px'
  },
  // The personality knobs (v0.72) — radius/shadow/accent change the whole
  // feel of every component without forking the theme CSS.
  style: {
    radius: 'soft',         // sharp | soft | round
    shadow: 'soft',         // flat | soft | deep
    accent: 'gradient'      // solid | gradient (primary → secondary)
  },
  layout: {
    maxWidth: '900px',
    menuPlacement: 'top' // top | side
  }
};

// ── Looks (v0.72) — one-click whole personalities: a curated bundle of
//    palette + fonts + style knobs. Applying a look = merging its overrides;
//    everything stays hand-tunable afterwards. 'naki' resets to the default.
const LOOKS = {
  tapuz: {
    label: 'תפוז', emoji: '🍊',
    overrides: {
      colors: { primary: '#ea580c', secondary: '#f59e0b', text: '#1c1917', muted: '#78716c', border: '#ece5df', bg: '#fffbf7', lightBg: '#fdf1e6', surface: '#ffffff' },
      fonts: { headingFamily: '' },
      style: { radius: 'soft', shadow: 'soft', accent: 'gradient' }
    }
  },
  layla: {
    label: 'לילה', emoji: '🌙',
    overrides: {
      colors: { primary: '#22d3ee', secondary: '#8b5cf6', text: '#e6edf6', muted: '#8fa3bd', border: '#22304a', bg: '#0b1220', lightBg: '#0e1729', surface: '#131f36' },
      fonts: { headingFamily: '' },
      style: { radius: 'soft', shadow: 'deep', accent: 'gradient' }
    }
  },
  magazin: {
    label: 'מגזין', emoji: '📰',
    overrides: {
      colors: { primary: '#dc2626', secondary: '#0f172a', text: '#0a0a0a', muted: '#525252', border: '#e5e5e5', bg: '#ffffff', lightBg: '#fafafa', surface: '#ffffff' },
      fonts: { headingFamily: '"Arial Black", "Segoe UI", Arial, "Noto Sans Hebrew", sans-serif' },
      style: { radius: 'sharp', shadow: 'flat', accent: 'solid' }
    }
  },
  yam: {
    label: 'ים', emoji: '🌊',
    overrides: {
      colors: { primary: '#0e7490', secondary: '#06b6d4', text: '#164e63', muted: '#64748b', border: '#dbeafe', bg: '#f8fdff', lightBg: '#eef8fc', surface: '#ffffff' },
      fonts: { headingFamily: '' },
      style: { radius: 'round', shadow: 'soft', accent: 'solid' }
    }
  },
  boutique: {
    label: 'בוטיק', emoji: '💎',
    overrides: {
      colors: { primary: '#9d174d', secondary: '#d97706', text: '#292524', muted: '#78716c', border: '#e7e0d8', bg: '#fdfbf8', lightBg: '#f7f1ea', surface: '#ffffff' },
      fonts: { headingFamily: 'Georgia, "Times New Roman", "Noto Serif Hebrew", serif' },
      style: { radius: 'round', shadow: 'soft', accent: 'solid' }
    }
  },
  naki: {
    label: 'נקי', emoji: '⬜',
    overrides: {
      // the pre-v0.72 clean-white palette, kept as an explicit choice
      // (surface #f8fafc = the old subtle card tint against the white page)
      colors: { primary: '#0a66c2', secondary: '#0ea5e9', text: '#111827', muted: '#6b7280', border: '#e5e7eb', bg: '#ffffff', lightBg: '#f8fafc', surface: '#f8fafc' },
      fonts: { headingFamily: '' },
      style: { radius: 'soft', shadow: 'soft', accent: 'solid' }
    }
  }
};

// radius/shadow scales — one knob, consistent across every component
const RADIUS_SCALE = {
  sharp: { sm: '3px', md: '4px', lg: '6px', pill: '6px' },
  soft: { sm: '6px', md: '8px', lg: '12px', pill: '999px' },
  round: { sm: '10px', md: '14px', lg: '20px', pill: '999px' }
};
const SHADOW_SCALE = {
  flat: { s1: 'none', s2: 'none' },
  soft: { s1: '0 1px 3px rgba(2, 8, 23, 0.06)', s2: '0 10px 30px rgba(2, 8, 23, 0.12)' },
  deep: { s1: '0 2px 8px rgba(0, 0, 0, 0.25)', s2: '0 18px 50px rgba(0, 0, 0, 0.45)' }
};

/** Keep an override value safe to interpolate into CSS — no rule breakout
 *  ({ } ;) and no tag breakout (< >): this CSS is inlined into a <style>. */
function cssValue(v) {
  return String(v == null ? '' : v).replace(/[{};<>]/g, '').trim();
}

function loadOverrides() {
  try {
    if (fs.existsSync(OVERRIDES_PATH)) {
      const data = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
      return mergeDeep(DEFAULT_OVERRIDES, data || {});
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_OVERRIDES));
}

function saveOverrides(overrides) {
  const dir = path.dirname(OVERRIDES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const merged = mergeDeep(DEFAULT_OVERRIDES, overrides || {});
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function mergeDeep(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  Object.keys(extra).forEach((k) => {
    if (
      extra[k] &&
      typeof extra[k] === 'object' &&
      !Array.isArray(extra[k]) &&
      base[k] &&
      typeof base[k] === 'object' &&
      !Array.isArray(base[k])
    ) {
      out[k] = mergeDeep(base[k], extra[k]);
    } else if (extra[k] !== undefined) {
      out[k] = extra[k];
    }
  });
  return out;
}

/** CSS custom properties injected after theme CSS. */
function overridesToCss(overrides) {
  const o = mergeDeep(DEFAULT_OVERRIDES, overrides || {});
  const radius = RADIUS_SCALE[o.style.radius] || RADIUS_SCALE.soft;
  const shadow = SHADOW_SCALE[o.style.shadow] || SHADOW_SCALE.soft;
  const primary = cssValue(o.colors.primary);
  const secondary = cssValue(o.colors.secondary) || primary;
  // one accent surface every button/badge uses — solid or a real gradient
  const accentBg = o.style.accent === 'gradient'
    ? `linear-gradient(135deg, ${primary}, ${secondary})`
    : primary;
  const lines = [
    `--font-family: ${cssValue(o.fonts.family)};`,
    `--font-heading: ${cssValue(o.fonts.headingFamily) || cssValue(o.fonts.family)};`,
    `--max-width: ${cssValue(o.layout.maxWidth)};`,
    `--color-text: ${cssValue(o.colors.text)};`,
    `--color-muted: ${cssValue(o.colors.muted)};`,
    `--color-text-muted: ${cssValue(o.colors.muted)};`,
    `--color-primary: ${primary};`,
    // components historically read --color-accent — it IS the primary now,
    // so the theme builder finally reaches every bent-* component (v0.72)
    `--color-accent: ${primary};`,
    `--color-secondary: ${secondary};`,
    `--color-border: ${cssValue(o.colors.border)};`,
    `--color-bg: ${cssValue(o.colors.bg)};`,
    `--color-light-bg: ${cssValue(o.colors.lightBg)};`,
    `--color-surface: ${cssValue(o.colors.surface)};`,
    `--radius-sm: ${radius.sm};`,
    `--radius-md: ${radius.md};`,
    `--radius-lg: ${radius.lg};`,
    `--radius-pill: ${radius.pill};`,
    `--shadow-1: ${shadow.s1};`,
    `--shadow-2: ${shadow.s2};`,
    `--accent-bg: ${accentBg};`
  ];
  let css = `:root {\n  ${lines.join('\n  ')}\n}\n`;
  if (o.fonts.baseSize) {
    css += `html { font-size: ${cssValue(o.fonts.baseSize)}; }\n`;
  }
  if (cssValue(o.fonts.headingFamily)) {
    css += `h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading); }\n`;
  }
  // menuPlacement:side no longer emits layout CSS from here — the REAL sidebar
  // layout lives in the theme (themes/default/css/main.css, body.menu-side).
  // The renderer stamps the body class; the theme owns the geometry. The old
  // inline block just stacked the top header and pushed the page down, and —
  // being injected AFTER the theme stylesheet — would also override the
  // theme's narrow-screen fallback.
  return css;
}

function getThemeSettings() {
  const config = loadConfig();
  return {
    overrides: loadOverrides(),
    logo: config.logo || { type: 'text', text: config.title || 'Site', image: '', width: 180, height: 50 },
    siteTitle: config.title || 'Tapuz',
    description: config.description || '',
    defaultTheme: config.defaultTheme || 'default'
  };
}

function saveThemeSettings(payload) {
  const config = loadConfig();
  if (payload.siteTitle !== undefined) config.title = String(payload.siteTitle || '').trim() || config.title;
  if (payload.description !== undefined) config.description = String(payload.description || '');
  if (payload.logo) {
    config.logo = {
      type: payload.logo.type === 'image' ? 'image' : 'text',
      text: payload.logo.text != null ? String(payload.logo.text) : (config.logo?.text || config.title || ''),
      image: payload.logo.image != null ? String(payload.logo.image) : (config.logo?.image || ''),
      width: Number(payload.logo.width) || 180,
      height: Number(payload.logo.height) || 50
    };
  }
  saveConfig(config);

  const overrides = saveOverrides(payload.overrides || payload);
  return getThemeSettings();
}

// ── Theme packages (v0.99) — the ".pzn is our RPM" North Star pillar,
// first step: a theme becomes a portable file. Deliberately its own small
// format (not raw .pzn/BenTML, which is page-markup shaped) — unifying
// site/theme/plugin packages under one container is a real design decision
// for a future version, not something to redecide unilaterally here. This
// gives theme sharing SOMETHING concrete today: export what you built,
// import it into another Tapuz install, both directions validated.
const THEME_PACKAGE_FORMAT = 'tapuz-theme';
const THEME_PACKAGE_VERSION = 1;

/** The current theme as a portable, versioned, self-describing package. */
function exportThemePackage(name) {
  return {
    format: THEME_PACKAGE_FORMAT,
    version: THEME_PACKAGE_VERSION,
    name: String(name || '').trim().slice(0, 120) || 'ערכת נושא מותאמת',
    exportedAt: new Date().toISOString(),
    overrides: loadOverrides()
  };
}

/**
 * Validate + apply an uploaded/pasted theme package. Never trusts the input
 * shape — a malformed or foreign JSON file throws a clear error rather than
 * silently corrupting theme-overrides.json. Unknown keys inside `overrides`
 * are dropped by saveOverrides' mergeDeep (it only ever merges onto
 * DEFAULT_OVERRIDES's known shape), so a hostile/garbage package can't
 * inject arbitrary config.
 */
function importThemePackage(pkg) {
  if (!pkg || typeof pkg !== 'object') throw new Error('קובץ ערכת הנושא אינו תקין (לא JSON)');
  if (pkg.format !== THEME_PACKAGE_FORMAT) {
    throw new Error('זה לא קובץ ערכת נושא של Tapuz (format שגוי)');
  }
  if (typeof pkg.version !== 'number' || pkg.version > THEME_PACKAGE_VERSION) {
    throw new Error('גרסת קובץ ערכת הנושא חדשה מדי לגרסת Tapuz הזו');
  }
  if (!pkg.overrides || typeof pkg.overrides !== 'object') {
    throw new Error('קובץ ערכת הנושא לא מכיל overrides');
  }
  return saveOverrides(pkg.overrides);
}

module.exports = {
  DEFAULT_OVERRIDES,
  LOOKS,
  loadOverrides,
  saveOverrides,
  overridesToCss,
  getThemeSettings,
  saveThemeSettings,
  // theme packages (v0.99)
  THEME_PACKAGE_FORMAT,
  THEME_PACKAGE_VERSION,
  exportThemePackage,
  importThemePackage
};
