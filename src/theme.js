// Theme overrides — site-level knobs that don't fork the theme.
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');

const OVERRIDES_PATH = path.join(require('./paths').CONFIG_DIR, 'theme-overrides.json');

const DEFAULT_OVERRIDES = {
  colors: {
    primary: '#0a66c2',
    text: '#111827',
    muted: '#6b7280',
    border: '#e5e7eb',
    bg: '#ffffff',
    lightBg: '#f8fafc'
  },
  fonts: {
    family: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Hebrew", sans-serif',
    baseSize: '17px'
  },
  layout: {
    maxWidth: '900px',
    menuPlacement: 'top' // top | side
  }
};

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
  const lines = [
    `--font-family: ${o.fonts.family};`,
    `--max-width: ${o.layout.maxWidth};`,
    `--color-text: ${o.colors.text};`,
    `--color-muted: ${o.colors.muted};`,
    `--color-primary: ${o.colors.primary};`,
    `--color-border: ${o.colors.border};`,
    `--color-bg: ${o.colors.bg};`,
    `--color-light-bg: ${o.colors.lightBg};`
  ];
  let css = `:root {\n  ${lines.join('\n  ')}\n}\n`;
  if (o.fonts.baseSize) {
    css += `html { font-size: ${o.fonts.baseSize}; }\n`;
  }
  if (o.layout.menuPlacement === 'side') {
    css += `
body.menu-side .site-header .header-inner {
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
}
body.menu-side .main-nav ul {
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}
`;
  }
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

module.exports = {
  DEFAULT_OVERRIDES,
  loadOverrides,
  saveOverrides,
  overridesToCss,
  getThemeSettings,
  saveThemeSettings
};
