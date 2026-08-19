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
  },
  // Master-page CHROME (v2.23) — the skeleton's look and behavior as THEME
  // state (Ben: "the whole theme is a page builder for a master page —
  // header and footer + effects on the menu with colors, hover effects,
  // complete control"). Content lives in site-chrome (tagline/CTA/columns);
  // the LOOK lives here, so it rides packages, the library, and effects.
  chrome: {
    menuHover: 'color',     // color | underline | pill | glow
    menuHoverColor: '',     // '' = the primary color
    menuWeight: 'normal',   // normal | bold
    headerBg: '',           // '' = the surface color
    headerGlass: false,     // translucent, blurred header over the page
    footerBg: '',           // '' = theme default
    footerText: ''          // '' = theme default
  },
  // Theme EFFECTS (v2.22) — site-wide custom CSS/JS as part of the theme
  // itself (Ben's mouse-effect flow: an LLM in a FRESH chat writes the
  // snippet, the owner pastes it here). Living inside overrides means
  // effects ride overridesToCss (serve AND static export), theme packages,
  // and the theme library with zero extra plumbing.
  //
  // TRUST, stated plainly (same line the html block draws in renderer.js):
  // effect JS/CSS is trusted-author raw — it RUNS on the live site. Anyone
  // who can edit the theme can therefore run script on visitors. Content
  // from OUTSIDE stays scrubbed; what the OWNER pastes on purpose does not.
  effects: {
    css: '',
    js: '',
    note: ''   // what the effect is, in the owner's words — shown in the editor
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
  },
  // ── v2.23: the shelf widens (Ben: "if we present a slim choice of themes,
  // what are we worth as a company?") — four looks that also exercise the
  // master-page chrome, so a preset is a whole skeleton, not just a palette.
  zahav: {
    label: 'זהב', emoji: '🏆',
    overrides: {
      colors: { primary: '#d4a017', secondary: '#f59e0b', text: '#ede9e3', muted: '#a8a29e', border: '#3f3a33', bg: '#191612', lightBg: '#211d17', surface: '#242019' },
      fonts: { headingFamily: 'Georgia, "Times New Roman", "Noto Serif Hebrew", serif' },
      style: { radius: 'soft', shadow: 'deep', accent: 'gradient' },
      chrome: { menuHover: 'glow', menuHoverColor: '#d4a017', menuWeight: 'normal', headerGlass: true, headerBg: '', footerBg: '#12100d', footerText: '#a8a29e' }
    }
  },
  sadot: {
    label: 'שדות', emoji: '🌿',
    overrides: {
      colors: { primary: '#166534', secondary: '#84cc16', text: '#1a2e1a', muted: '#6b7c6b', border: '#dbe7d5', bg: '#fbfdf8', lightBg: '#f0f7e9', surface: '#ffffff' },
      fonts: { headingFamily: '' },
      style: { radius: 'round', shadow: 'soft', accent: 'solid' },
      chrome: { menuHover: 'pill', menuHoverColor: '', menuWeight: 'normal', headerGlass: false, headerBg: '', footerBg: '#1a2e1a', footerText: '#f0f7e9' }
    }
  },
  neon: {
    label: 'ניאון', emoji: '🕹',
    overrides: {
      colors: { primary: '#e11d90', secondary: '#a3e635', text: '#f3f0ff', muted: '#9089b0', border: '#312a52', bg: '#120f24', lightBg: '#181336', surface: '#1c1740' },
      fonts: { headingFamily: '' },
      style: { radius: 'sharp', shadow: 'deep', accent: 'gradient' },
      chrome: { menuHover: 'glow', menuHoverColor: '#a3e635', menuWeight: 'bold', headerGlass: true, headerBg: '', footerBg: '#0c0a1a', footerText: '#9089b0' }
    }
  },
  hitech: {
    label: 'הייטק', emoji: '💠',
    overrides: {
      colors: { primary: '#4f46e5', secondary: '#06b6d4', text: '#0f172a', muted: '#64748b', border: '#e2e8f0', bg: '#ffffff', lightBg: '#f1f5f9', surface: '#f8fafc' },
      fonts: { headingFamily: '' },
      style: { radius: 'soft', shadow: 'soft', accent: 'gradient' },
      chrome: { menuHover: 'underline', menuHoverColor: '', menuWeight: 'normal', headerGlass: true, headerBg: '', footerBg: '#0f172a', footerText: '#cbd5e1' }
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

  // Master-page chrome (v2.23) — emitted before the effect css so a custom
  // effect can still override the chrome. Selectors are the theme's own
  // (.site-header/.main-nav/.site-footer, themes/default/css/main.css).
  const ch = o.chrome || {};
  const hoverColor = cssValue(ch.menuHoverColor) || primary;
  const headerBg = cssValue(ch.headerBg);
  if (headerBg) css += `.site-header { background: ${headerBg}; }\n`;
  if (ch.headerGlass === true || ch.headerGlass === 'true') {
    css += `.site-header { background: color-mix(in srgb, ${headerBg || 'var(--color-surface, #fff)'} 78%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }\n`;
  }
  if (ch.menuWeight === 'bold') css += `.main-nav a { font-weight: 700; }\n`;
  const hover = ['color', 'underline', 'pill', 'glow'].includes(ch.menuHover) ? ch.menuHover : 'color';
  if (hover === 'underline') {
    css += `.main-nav a { transition: color 0.15s, box-shadow 0.15s; }\n` +
      `.main-nav a:hover { color: ${hoverColor}; box-shadow: inset 0 -2px 0 ${hoverColor}; }\n`;
  } else if (hover === 'pill') {
    css += `.main-nav a { padding: 5px 12px; border-radius: 999px; transition: color 0.15s, background 0.15s; }\n` +
      `.main-nav a:hover { color: ${hoverColor}; background: color-mix(in srgb, ${hoverColor} 14%, transparent); }\n`;
  } else if (hover === 'glow') {
    css += `.main-nav a:hover { color: ${hoverColor}; text-shadow: 0 0 12px ${hoverColor}; }\n`;
  } else if (cssValue(ch.menuHoverColor)) {
    css += `.main-nav a:hover { color: ${hoverColor}; }\n`;
  }
  const footerBg = cssValue(ch.footerBg);
  const footerText = cssValue(ch.footerText);
  if (footerBg) css += `.site-footer { background: ${footerBg}; }\n`;
  if (footerText) {
    css += `.site-footer, .site-footer a, .footer-col-title { color: ${footerText}; }\n`;
  }

  // Theme effect CSS (v2.22) rides HERE, last, so an effect can override
  // anything — and because both the serve path (renderPage's inline style)
  // and the static export (copyThemeAssets → css/main.css) already funnel
  // through this function, the effect ships everywhere with no extra wiring.
  const effectCss = String((o.effects && o.effects.css) || '').trim();
  if (effectCss) {
    css += `\n/* ── theme effects (trusted-author, see DEFAULT_OVERRIDES.effects) ── */\n${effectCss}\n`;
  }
  return css;
}

/**
 * The effect's JS as a ready-to-embed script tag, or '' when no effect.
 * Emitted into siteExtras (every served page AND the static export — inline
 * scripts survive the export's style-strip). Trusted-author raw, same stance
 * as the html block; the FRESH-chat prompt contracts the snippet to be a
 * self-contained IIFE that waits for DOMContentLoaded on its own.
 */
function renderThemeEffectsJs(overrides) {
  const o = mergeDeep(DEFAULT_OVERRIDES, overrides || {});
  const js = String((o.effects && o.effects.js) || '').trim();
  if (!js) return '';
  // </script> inside the payload would end our tag mid-snippet and leak the
  // rest as text — split the closer the standard way.
  return `<script id="tapuz-theme-effects">\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
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

  // Merge the editor's sections ONTO THE CURRENT overrides, not implicitly
  // onto the defaults. Before v2.22 the editor form covered every section so
  // the distinction was invisible; now effects (and chrome) live OUTSIDE the
  // form, and a plain "שמור ערכת נושא" must not silently wipe them.
  const overrides = saveOverrides(mergeDeep(loadOverrides(), payload.overrides || payload));
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
  renderThemeEffectsJs,
  getThemeSettings,
  saveThemeSettings,
  // theme packages (v0.99)
  THEME_PACKAGE_FORMAT,
  THEME_PACKAGE_VERSION,
  exportThemePackage,
  importThemePackage
};
