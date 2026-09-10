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
    baseSize: '17px',
    // Web fonts (v2.24) — Google Fonts families to LOAD (see GOOGLE_FONTS for
    // the Hebrew-capable shelf). A family listed here can then be named in
    // family/headingFamily. Empty = system fonts only, no external request.
    google: []
  },
  // The personality knobs (v0.72) — radius/shadow/accent change the whole
  // feel of every component without forking the theme CSS.
  style: {
    radius: 'soft',         // sharp | soft | round
    shadow: 'soft',         // flat | soft | deep
    accent: 'gradient',     // solid | gradient (primary → secondary)
    buttons: 'filled'       // filled | outline | soft | glow (v2.24)
  },
  layout: {
    maxWidth: '900px',
    menuPlacement: 'top' // top | side
  },
  // Page background (v2.24) — "few boring colors" was the complaint: a flat
  // color is one option, not the only one. Patterns are drawn from the
  // palette (bg/lightBg/border/primary), so they re-tint with every look.
  background: {
    kind: 'solid',          // solid | gradient | glow | dots | grid | lines
    angle: 160              // gradient / lines direction, degrees
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
    headerText: '',         // '' = the text color (v2.24 — a dark header needs light links)
    headerGlass: false,     // translucent, blurred header over the page
    footerBg: '',           // '' = theme default
    footerText: ''          // '' = theme default
  },
  // Theme SKIN (v2.24) — free-form CSS against the theme's documented
  // skeleton (see theme-roleplay.js skeletonSelectors): what makes a theme a
  // THEME rather than a palette. The AI designer writes it from the owner's
  // imagination; the owner can hand-edit it. Same trust line as effects.
  skin: {
    css: '',
    note: ''
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

// ── Google Fonts shelf (v2.24) — Hebrew-capable families and the weights
//    each one actually ships. css2 answers 400 Bad Request to a weight the
//    family does not have, so the request is built from THIS table; an
//    unknown family is requested without axes (regular only).
const GOOGLE_FONTS = {
  'Heebo': '400;700;800',
  'Rubik': '400;700;800',
  'Assistant': '400;700;800',
  'Varela Round': '',
  'Frank Ruhl Libre': '400;700;900',
  'Secular One': '',
  'Suez One': '',
  'Alef': '400;700',
  'Amatic SC': '400;700',
  'Karantina': '400;700',
  'Miriam Libre': '400;700',
  'David Libre': '400;700',
  'Noto Sans Hebrew': '400;700;800',
  'Noto Serif Hebrew': '400;700;800',
  'Noto Rashi Hebrew': '400;700',
  'Bellefair': '',
  'Arimo': '400;700',
  'Tinos': '400;700',
  'Bona Nova': '400;700'
};

// ── Looks (v0.72) — one-click whole personalities: a curated bundle of
//    palette + fonts + style knobs. Applying a look = merging its overrides;
//    everything stays hand-tunable afterwards. 'naki' resets to the default.
const SYSTEM_FONT = DEFAULT_OVERRIDES.fonts.family;
const LOOKS = {
  tapuz: {
    label: 'תפוז', emoji: '🍊',
    overrides: {
      colors: { primary: '#ea580c', secondary: '#f59e0b', text: '#1c1917', muted: '#78716c', border: '#ece5df', bg: '#fffbf7', lightBg: '#fdf1e6', surface: '#ffffff' },
      fonts: { headingFamily: '' },
      style: { radius: 'soft', shadow: 'soft', accent: 'gradient', buttons: 'filled' }
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
  },
  // ── v2.24: looks that use the WHOLE model — web fonts, a page background,
  // a button style, a header palette, a skin — so the shelf reads as
  // different THEMES, not one theme in ten colors (Ben: "we offer only 1
  // theme with few boring colors?").
  yeladim: {
    label: 'ילדים', emoji: '🎈',
    overrides: {
      colors: { primary: '#e11d48', secondary: '#f59e0b', text: '#1f2937', muted: '#6b7280', border: '#fde2e4', bg: '#fff7f9', lightBg: '#fff0f3', surface: '#ffffff' },
      fonts: { family: '"Varela Round", ' + SYSTEM_FONT, headingFamily: '', google: ['Varela Round'] },
      style: { radius: 'round', shadow: 'soft', accent: 'gradient', buttons: 'glow' },
      background: { kind: 'dots', angle: 160 },
      chrome: { menuHover: 'pill', menuHoverColor: '', menuWeight: 'bold', headerGlass: false, headerBg: '', headerText: '', footerBg: '#e11d48', footerText: '#fff0f3' },
      skin: { css: 'h1, h2, h3 { letter-spacing: -0.01em; }\n.btn-primary, .bent-form-submit { border-radius: 999px; }', note: 'כפתורים עגולים, כותרות צפופות' }
    }
  },
  vintage: {
    label: 'וינטג׳', emoji: '📜',
    overrides: {
      colors: { primary: '#7c2d12', secondary: '#b45309', text: '#292524', muted: '#6b5d52', border: '#dccbb0', bg: '#f6efe3', lightBg: '#efe4d0', surface: '#fbf7ef' },
      fonts: { family: '"David Libre", Georgia, "Noto Serif Hebrew", serif', headingFamily: '"Frank Ruhl Libre", Georgia, "Noto Serif Hebrew", serif', google: ['Frank Ruhl Libre', 'David Libre'] },
      style: { radius: 'sharp', shadow: 'flat', accent: 'solid', buttons: 'outline' },
      background: { kind: 'lines', angle: 135 },
      chrome: { menuHover: 'underline', menuHoverColor: '', menuWeight: 'normal', headerGlass: false, headerBg: '', headerText: '', footerBg: '#292524', footerText: '#dccbb0' },
      skin: { css: '.site-header { border-bottom: 3px double var(--color-border); }\n.site-footer { border-top: 3px double var(--color-border); }\nh1, h2 { font-weight: 700; }', note: 'קווים כפולים, סריפים' }
    }
  },
  studio: {
    label: 'סטודיו', emoji: '🎬',
    overrides: {
      colors: { primary: '#111111', secondary: '#ef4444', text: '#111111', muted: '#555555', border: '#e5e5e5', bg: '#ffffff', lightBg: '#f5f5f5', surface: '#ffffff' },
      fonts: { family: '"Heebo", ' + SYSTEM_FONT, headingFamily: '"Suez One", "Heebo", serif', google: ['Suez One', 'Heebo'] },
      style: { radius: 'sharp', shadow: 'flat', accent: 'solid', buttons: 'filled' },
      background: { kind: 'grid', angle: 160 },
      chrome: { menuHover: 'underline', menuHoverColor: '#ef4444', menuWeight: 'bold', headerGlass: false, headerBg: '#111111', headerText: '#ffffff', footerBg: '#111111', footerText: '#d4d4d4' },
      skin: { css: 'h1 { font-size: 3.2rem; line-height: 1.1; }\n.btn-primary { text-transform: none; letter-spacing: 0.02em; }', note: 'שחור-לבן, כותרות ענק' }
    }
  },
  midbar: {
    label: 'מדבר', emoji: '🏜',
    overrides: {
      colors: { primary: '#c2410c', secondary: '#ca8a04', text: '#3b2f2f', muted: '#7a675b', border: '#ead9c4', bg: '#fbf3e8', lightBg: '#f5e9d8', surface: '#fffaf3' },
      fonts: { family: '"Heebo", ' + SYSTEM_FONT, headingFamily: '', google: ['Heebo'] },
      style: { radius: 'soft', shadow: 'soft', accent: 'gradient', buttons: 'filled' },
      background: { kind: 'gradient', angle: 180 },
      chrome: { menuHover: 'glow', menuHoverColor: '', menuWeight: 'normal', headerGlass: true, headerBg: '', headerText: '', footerBg: '#3b2f2f', footerText: '#ead9c4' },
      skin: { css: '', note: '' }
    }
  },
  pastel: {
    label: 'פסטל', emoji: '🧁',
    overrides: {
      colors: { primary: '#7c3aed', secondary: '#db2777', text: '#312e81', muted: '#6b6b99', border: '#e9e3ff', bg: '#fbfaff', lightBg: '#f3efff', surface: '#ffffff' },
      fonts: { family: '"Assistant", ' + SYSTEM_FONT, headingFamily: '', google: ['Assistant'] },
      style: { radius: 'round', shadow: 'soft', accent: 'gradient', buttons: 'soft' },
      background: { kind: 'glow', angle: 160 },
      chrome: { menuHover: 'pill', menuHoverColor: '', menuWeight: 'normal', headerGlass: true, headerBg: '', headerText: '', footerBg: '', footerText: '' },
      skin: { css: '', note: '' }
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

// every "button" surface the theme draws — the button-style knob restyles
// them together (the .btn-primary rule, form submits, pricing CTAs)
const BUTTON_SELECTORS = '.btn-primary, .bent-form-submit, .bent-plan-cta, .bent-flipbox-button';

/** Keep an override value safe to interpolate into CSS — no rule breakout
 *  ({ } ;) and no tag breakout (< >): this CSS is inlined into a <style>. */
function cssValue(v) {
  return String(v == null ? '' : v).replace(/[{};<>]/g, '').trim();
}

/** Raw author CSS (skin/effects) is emitted as-is by design — only the one
 *  sequence that could end the inline <style> early is defused. */
function rawCss(v) {
  return String(v == null ? '' : v).replace(/<\/style/gi, '<\\/style').trim();
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

// ── Web fonts (v2.24) ────────────────────────────────────────────────

/** The Google families a theme asks to load — cleaned, deduped, capped. */
function googleFontFamilies(overrides) {
  const o = mergeDeep(DEFAULT_OVERRIDES, overrides || {});
  const raw = Array.isArray(o.fonts.google) ? o.fonts.google
    : String(o.fonts.google || '').split(',');
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const name = String(item || '').replace(/["']/g, '').replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= 4) break;
  }
  return out;
}

/** One css2 request for every family, with the weights the family really has. */
function googleFontsHref(overrides) {
  const families = googleFontFamilies(overrides);
  if (!families.length) return '';
  const parts = families.map((f) => {
    const weights = GOOGLE_FONTS[f];
    return 'family=' + f.replace(/ /g, '+') + (weights ? ':wght@' + weights : '');
  });
  return 'https://fonts.googleapis.com/css2?' + parts.join('&') + '&display=swap';
}

/** <link> tags for the theme's web fonts, or '' — head material on the
 *  served page AND the export (links survive externalizeStyles). */
function renderThemeFontLinks(overrides) {
  const href = googleFontsHref(overrides);
  if (!href) return '';
  return '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    `  <link rel="stylesheet" id="tapuz-theme-fonts" href="${href}">`;
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

  // Page background (v2.24) — patterns are drawn from the palette so they
  // re-tint with every look. Painted on <body> (later than the theme's own
  // body rule, so it wins; it propagates to the canvas, and html's min-height
  // keeps it covering the viewport). On body rather than html on purpose:
  // the admin shell links the exported main.css too, and its own body rule
  // (admin.css, loaded after) must keep winning there. 'solid' emits
  // nothing: a site that never touched this is byte-for-byte unchanged.
  const bgKind = String((o.background && o.background.kind) || 'solid');
  const angle = Math.round(Number(o.background && o.background.angle)) || 160;
  const bg = cssValue(o.colors.bg);
  const light = cssValue(o.colors.lightBg);
  const border = cssValue(o.colors.border);
  let pageBg = '';
  if (bgKind === 'gradient') {
    pageBg = `linear-gradient(${angle}deg, ${bg}, ${light})`;
  } else if (bgKind === 'glow') {
    pageBg = `radial-gradient(1100px 600px at 85% -10%, color-mix(in srgb, ${primary} 18%, transparent), transparent 60%), ` +
      `radial-gradient(900px 520px at -10% 100%, color-mix(in srgb, ${secondary} 16%, transparent), transparent 60%), ${bg}`;
  } else if (bgKind === 'dots') {
    pageBg = `radial-gradient(${border} 1.2px, transparent 1.2px) 0 0 / 22px 22px, ${bg}`;
  } else if (bgKind === 'grid') {
    pageBg = `linear-gradient(${border} 1px, transparent 1px) 0 0 / 28px 28px, ` +
      `linear-gradient(90deg, ${border} 1px, transparent 1px) 0 0 / 28px 28px, ${bg}`;
  } else if (bgKind === 'lines') {
    pageBg = `repeating-linear-gradient(${angle}deg, transparent 0 14px, color-mix(in srgb, ${border} 55%, transparent) 14px 15px), ${bg}`;
  }
  if (pageBg) {
    css += `html { min-height: 100%; }\nbody { background: ${pageBg}; }\n`;
  }

  // Master-page chrome (v2.23) — emitted before the skin/effect css so a
  // custom rule can still override the chrome. Selectors are the theme's own
  // (.site-header/.main-nav/.site-footer, themes/default/css/main.css).
  const ch = o.chrome || {};
  const hoverColor = cssValue(ch.menuHoverColor) || primary;
  const headerBg = cssValue(ch.headerBg);
  if (headerBg) css += `.site-header { background: ${headerBg}; }\n`;
  if (ch.headerGlass === true || ch.headerGlass === 'true') {
    css += `.site-header { background: color-mix(in srgb, ${headerBg || 'var(--color-surface, #fff)'} 78%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }\n`;
  }
  const headerText = cssValue(ch.headerText);
  if (headerText) {
    css += `.site-header, .site-header .site-logo, .site-header .main-nav a, .site-header .site-tagline { color: ${headerText}; }\n`;
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

  // Button style (v2.24) — 'filled' is what the theme already draws, so it
  // emits nothing; the others restyle every button surface together.
  const buttons = String((o.style && o.style.buttons) || 'filled');
  if (buttons === 'outline') {
    css += `${BUTTON_SELECTORS} { background: transparent; color: ${primary}; border: 2px solid ${primary}; box-shadow: none; }\n` +
      `${BUTTON_SELECTORS.split(', ').map((s) => s + ':hover').join(', ')} { background: ${primary}; color: #fff; filter: none; }\n`;
  } else if (buttons === 'soft') {
    css += `${BUTTON_SELECTORS} { background: color-mix(in srgb, ${primary} 14%, transparent); color: ${primary}; border-color: transparent; }\n` +
      `${BUTTON_SELECTORS.split(', ').map((s) => s + ':hover').join(', ')} { background: ${primary}; color: #fff; filter: none; }\n`;
  } else if (buttons === 'glow') {
    css += `${BUTTON_SELECTORS} { box-shadow: 0 8px 24px color-mix(in srgb, ${primary} 45%, transparent); }\n` +
      `${BUTTON_SELECTORS.split(', ').map((s) => s + ':hover').join(', ')} { transform: translateY(-1px); box-shadow: 0 12px 30px color-mix(in srgb, ${primary} 55%, transparent); }\n`;
  }

  // Theme skin (v2.24) — free-form author CSS against the documented
  // skeleton. After every knob so it can override any of them; before the
  // effects so an effect still wins over the skin.
  const skinCss = rawCss(o.skin && o.skin.css);
  if (skinCss) {
    css += `\n/* ── theme skin (trusted-author, see DEFAULT_OVERRIDES.skin) ── */\n${skinCss}\n`;
  }

  // Theme effect CSS (v2.22) rides HERE, last, so an effect can override
  // anything — and because both the serve path (renderPage's inline style)
  // and the static export (copyThemeAssets → css/main.css) already funnel
  // through this function, the effect ships everywhere with no extra wiring.
  const effectCss = rawCss(o.effects && o.effects.css);
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
 *
 * v2.24: the snippet runs inside try/catch. A snippet that throws at load
 * used to die silently — the owner saw "נקלט ✓" in the editor and nothing on
 * the site. Now the error is logged under a findable tag and parked on
 * window.__tapuzThemeEffectError, where the theme canvas reads it.
 */
function renderThemeEffectsJs(overrides) {
  const o = mergeDeep(DEFAULT_OVERRIDES, overrides || {});
  const js = String((o.effects && o.effects.js) || '').trim();
  if (!js) return '';
  // </script> inside the payload would end our tag mid-snippet and leak the
  // rest as text — split the closer the standard way.
  const safe = js.replace(/<\/script/gi, '<\\/script');
  return `<script id="tapuz-theme-effects">\ntry {\n${safe}\n} catch (e) { window.__tapuzThemeEffectError = String(e && e.message || e); console.error('[tapuz-theme-effects]', e); }\n</script>`;
}

/** First fenced block matching one of the language tags, or ''. */
function extractFence(text, langs) {
  for (const lang of langs) {
    const m = String(text).match(new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'i'));
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

/** EVERY fenced block whose info string is one of the tags, in order. */
function allFences(text, langs) {
  const out = [];
  const re = /```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let m;
  const want = langs.map((l) => l.toLowerCase());
  while ((m = re.exec(String(text || '')))) {
    if (want.includes((m[1] || '').toLowerCase()) && m[2].trim()) out.push(m[2].trim());
  }
  return out;
}

/**
 * The effect's css + js out of a chat reply. The prompt asks for a css fence
 * and a js fence, but chats answer the way they like: an ```html fence with
 * <style>/<script> inside, bare <style>…</style> + <script>…</script>, or
 * only one of the two. Ben's mouse effect "did work with the roleplay but
 * failed to show" — a reply the fence-only parser rejected or half-read is
 * exactly that. Everything the owner pastes is trusted-author (see
 * DEFAULT_OVERRIDES.effects); an external <script src> is dropped on purpose
 * (rule 1 of the prompt: no CDN, no external addresses).
 */
function extractEffectParts(reply) {
  const text = String(reply || '');
  let css = extractFence(text, ['css']);
  let js = extractFence(text, ['js', 'javascript']);
  if (!css) {
    const m = text.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    if (m && m[1].trim()) css = m[1].trim();
  }
  if (!js) {
    const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter((m) => !/\ssrc\s*=/i.test(m[1]) && m[2].trim());
    if (scripts.length) js = scripts.map((m) => m[2].trim()).join('\n');
  }
  return { css, js };
}

// ── Validation (v2.24) — "the code received and said it's good and in
//    effect it didn't work". The paste doors used to accept any text that
//    had a fence. Now the JS is COMPILED before it is accepted (a syntax
//    error, a stray `import`, an unclosed brace all surface as the error
//    they are), and the CSS is brace-balanced.

/** '' when the snippet compiles, else the SyntaxError message. */
function checkEffectJs(js) {
  const src = String(js || '').trim();
  if (!src) return '';
  try {
    // compile only — never run. A top-level `import` fails here too, which
    // is right: the effect prompt forbids modules and CDNs.
    new (require('vm').Script)(src, { filename: 'theme-effect.js' });
    return '';
  } catch (e) {
    return (e && e.message) ? String(e.message) : 'JavaScript לא תקין';
  }
}

/** '' when the css looks whole, else a plain-language problem. */
function checkCss(css) {
  const src = String(css || '');
  if (!src.trim()) return '';
  const open = (src.match(/{/g) || []).length;
  const close = (src.match(/}/g) || []).length;
  if (open !== close) return `סוגריים מסולסלים לא מאוזנים ב-CSS (${open} נפתחים, ${close} נסגרים)`;
  return '';
}

// ── "Take only the theme" (v2.24) — the BenTML attitude for themes. A chat
//    answers with prose, fences of any flavour, a package echoed back, or a
//    bare JSON object; the doors below take the theme out of all of it.

const THEME_SECTIONS = ['colors', 'fonts', 'style', 'layout', 'background', 'chrome', 'skin', 'effects'];

/** Balanced {…} candidates that JSON.parse accepts, largest first. Only
 *  braces followed by a quoted key are tried — CSS braces never are. */
function jsonObjectsIn(text) {
  const t = String(text || '').replace(/[\u200b\u2060\ufeff]/g, '');
  const found = [];
  let tries = 0;
  for (let i = 0; i < t.length && tries < 400; i++) {
    if (t[i] !== '{' || !/^\{\s*"/.test(t.slice(i, i + 40))) continue;
    tries++;
    let depth = 0; let inStr = false; let esc = false; let end = -1;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) continue;
    try {
      const obj = JSON.parse(t.slice(i, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) found.push({ obj, len: end - i });
    } catch (e) { /* not this one */ }
    // skip past this object — nested candidates are part of it
    if (end > i) i = end;
  }
  return found.sort((a, b) => b.len - a.len).map((f) => f.obj);
}

/** The first JSON object in a reply that is a theme package or carries a
 *  theme section — out of a ```json fence, prose, or nothing at all. */
function extractThemeJson(text) {
  const isTheme = (o) => o && typeof o === 'object' &&
    (o.format === THEME_PACKAGE_FORMAT || THEME_SECTIONS.some((k) => o[k] && typeof o[k] === 'object'));
  for (const fence of allFences(text, ['json', 'json5', ''])) {
    try {
      const obj = JSON.parse(fence.replace(/[\u200b\u2060\ufeff]/g, ''));
      if (isTheme(obj)) return obj;
    } catch (e) { /* the fence held something else */ }
  }
  const direct = jsonObjectsIn(text).find(isTheme);
  return direct || null;
}

/** Only the known sections of an object, deep-copied. */
function pickSections(obj) {
  const out = {};
  for (const k of THEME_SECTIONS) {
    if (obj[k] && typeof obj[k] === 'object' && !Array.isArray(obj[k])) out[k] = JSON.parse(JSON.stringify(obj[k]));
  }
  return out;
}

/**
 * A whole theme out of a chat reply (the theme-designer roleplay's move):
 *   ```json  → the knobs (or a full tapuz-theme package)
 *   ```css   → the skin (every css fence, joined)
 *   ```js    → the effect (every js fence, joined)
 * Any of the three may be missing; prose around them is ignored. Returns
 * { name, overrides, parts } or throws a plain-language error.
 */
function extractThemeReply(reply, fallbackName) {
  const text = String(reply || '');
  const json = extractThemeJson(text);
  let name = '';
  let overrides = {};
  if (json) {
    if (json.format === THEME_PACKAGE_FORMAT && json.overrides && typeof json.overrides === 'object') {
      name = String(json.name || '');
      overrides = pickSections(json.overrides);
    } else {
      name = String(json.name || json.title || '');
      overrides = pickSections(json);
    }
  }
  const cssFences = allFences(text, ['css']);
  const jsFences = allFences(text, ['js', 'javascript']);
  // a reply that skipped the fences and answered with bare <style>/<script>
  if (!cssFences.length && !jsFences.length && !json) {
    const parts = extractEffectParts(text);
    if (parts.css) cssFences.push(parts.css);
    if (parts.js) jsFences.push(parts.js);
  }
  if (cssFences.length) overrides.skin = { ...(overrides.skin || {}), css: cssFences.join('\n\n') };
  if (jsFences.length) overrides.effects = { ...(overrides.effects || {}), js: jsFences.join('\n\n') };
  if (!Object.keys(overrides).length) {
    throw new Error('לא נמצאה ערכת נושא בתשובה — צריך fence של json (ההגדרות) ו/או css (העור). ודאו שהעתקתם את כל התשובה, ושביקשתם אותה בצ׳אט חדש (FRESH)');
  }
  const jsErr = checkEffectJs(overrides.effects && overrides.effects.js);
  if (jsErr) throw new Error('ה-JS של האפקט לא מתקמפל: ' + jsErr + ' — בקשו מהצ׳אט לתקן ולהחזיר את ה-fence מחדש');
  const cssErr = checkCss(overrides.skin && overrides.skin.css);
  if (cssErr) throw new Error(cssErr + ' — בקשו מהצ׳אט לתקן');
  name = name.trim().slice(0, 120) || String(fallbackName || '').trim().slice(0, 120) || 'ערכה מה-AI';
  return {
    name,
    overrides,
    parts: {
      json: !!json,
      cssChars: (overrides.skin && overrides.skin.css || '').length,
      jsChars: (overrides.effects && overrides.effects.js || '').length
    }
  };
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
//
// v2 (v2.24) adds fonts.google / style.buttons / background / chrome.headerText
// / skin. A v1 file still imports (the new sections simply default).
const THEME_PACKAGE_FORMAT = 'tapuz-theme';
const THEME_PACKAGE_VERSION = 2;

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
 * Whatever an owner pasted or uploaded, as a package object — or a clear
 * error. Accepts: the package object itself, its JSON text, the JSON inside
 * a ```json fence with chat prose around it, or a bare theme JSON (the
 * sections only) which is wrapped into a package on the spot. A theme
 * reply with css/js fences works too (it goes through extractThemeReply).
 */
function parseThemePackage(input) {
  if (input && typeof input === 'object') return input;
  const text = String(input == null ? '' : input);
  if (!text.trim()) throw new Error('קובץ ערכת הנושא ריק');
  const json = extractThemeJson(text);
  const hasFences = allFences(text, ['css', 'js', 'javascript']).length > 0;
  if (json && json.format === THEME_PACKAGE_FORMAT && !hasFences) return json;
  let theme;
  try {
    theme = extractThemeReply(text);
  } catch (e) {
    // a JSON that parsed but is no theme, or nothing at all → the classic error
    throw new Error(json ? 'זה לא קובץ ערכת נושא של Tapuz (format שגוי)' : 'קובץ ערכת הנושא אינו תקין (לא JSON)');
  }
  return {
    format: THEME_PACKAGE_FORMAT,
    version: THEME_PACKAGE_VERSION,
    name: theme.name,
    exportedAt: new Date().toISOString(),
    overrides: theme.overrides
  };
}

/** The shared gate: a package object that is really ours, or a thrown error. */
function validateThemePackage(pkg) {
  if (!pkg || typeof pkg !== 'object') throw new Error('קובץ ערכת הנושא אינו תקין (לא JSON)');
  if (pkg.format !== THEME_PACKAGE_FORMAT) {
    throw new Error('זה לא קובץ ערכת נושא של Tapuz (format שגוי)');
  }
  const version = Number(pkg.version);
  if (!Number.isFinite(version) || version > THEME_PACKAGE_VERSION) {
    throw new Error('גרסת קובץ ערכת הנושא חדשה מדי לגרסת Tapuz הזו');
  }
  if (!pkg.overrides || typeof pkg.overrides !== 'object') {
    throw new Error('קובץ ערכת הנושא לא מכיל overrides');
  }
  const jsErr = checkEffectJs(pkg.overrides.effects && pkg.overrides.effects.js);
  if (jsErr) throw new Error('ה-JS של האפקט בערכה לא מתקמפל: ' + jsErr);
  return pkg;
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
  const valid = validateThemePackage(typeof pkg === 'string' ? parseThemePackage(pkg) : pkg);
  return saveOverrides(valid.overrides);
}

module.exports = {
  DEFAULT_OVERRIDES,
  LOOKS,
  GOOGLE_FONTS,
  THEME_SECTIONS,
  loadOverrides,
  saveOverrides,
  mergeDeep,
  overridesToCss,
  renderThemeEffectsJs,
  renderThemeFontLinks,
  googleFontFamilies,
  googleFontsHref,
  extractEffectParts,
  extractThemeJson,
  extractThemeReply,
  checkEffectJs,
  checkCss,
  getThemeSettings,
  saveThemeSettings,
  // theme packages (v0.99)
  THEME_PACKAGE_FORMAT,
  THEME_PACKAGE_VERSION,
  exportThemePackage,
  parseThemePackage,
  validateThemePackage,
  importThemePackage
};
