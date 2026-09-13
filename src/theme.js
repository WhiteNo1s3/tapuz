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
    menuPlacement: 'top', // top | side
    // the header may be wider than the content column (v2.28): a ten-item
    // Hebrew menu needs ~1130px; 'content' = the column, 'wide' = 1140px,
    // 'full' = edge to edge
    headerWidth: 'wide'   // content | wide | full
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
    footerText: '',         // '' = theme default
    // the menu's geometry (v2.28 — "the menu breaks from the amount of
    // content"): what a long bar does, how it sits, how dense it is
    menuOverflow: 'wrap',   // wrap | scroll | drawer
    menuAlign: 'start',     // start | center | end | between
    menuGap: 'md',          // sm | md | lg
    menuSize: 'md',         // sm | md | lg
    // v2.28b — the organizer's three extra knobs: how many top-level items
    // before an "עוד" fold (0 = off), where the bar collapses into the
    // drawer (sm 560px · md 720px · lg 1024px · never), how the current
    // page is marked. Every default is what the theme css already does.
    menuFold: 0,            // 0..12
    menuCollapse: 'md',     // sm | md | lg | never
    menuCurrent: 'underline' // underline | pill | bold | none
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

// every "menu link" surface the chrome dresses (v2.28b): the links AND the
// fold's <summary class="nav-more-sum"> ("עוד"), which is not an <a> but
// sits in the same row and must take the same colour/weight/hover
const MENU_LINKS = '.main-nav a, .main-nav .nav-more-sum';
const MENU_LINKS_HOVER = '.main-nav a:hover, .main-nav .nav-more-sum:hover';

// the menu's geometry (v2.28) — one knob, one custom property, the theme
// css does the rest (themes/default/css/main.css "Menu capacity")
const HEADER_WIDTH = { content: 'var(--max-width)', wide: '1140px', full: '100%' };
const MENU_GAP = { sm: '1rem', md: '1.75rem', lg: '2.5rem' };
const MENU_SIZE = { sm: '0.85rem', md: '0.95rem', lg: '1.08rem' };
const MENU_ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' };
const MENU_OVERFLOW = ['wrap', 'scroll', 'drawer'];
const MENU_COLLAPSE = ['sm', 'md', 'lg', 'never'];
const MENU_CURRENT = ['underline', 'pill', 'bold', 'none'];
const MENU_FOLD = { min: 0, max: 12 };

/**
 * The menu's geometry as ONE flat object (v2.28b) — what the organizer's
 * `<bent-menu-layout>` tag, the studio card and the capacity estimate all
 * read. Storage stays where it landed (layout.menuPlacement/headerWidth,
 * chrome.menu*): this is a view, not a second home.
 *   { placement, width, flow, fold, collapse, align, gap, size, current }
 */
function menuKnobs(overrides) {
  const o = overrides || {};
  const l = o.layout || {};
  const c = o.chrome || {};
  const d = DEFAULT_OVERRIDES;
  const pick = (v, list, fallback) => (list.indexOf(v) >= 0 ? v : fallback);
  const fold = Math.max(MENU_FOLD.min, Math.min(MENU_FOLD.max, parseInt(c.menuFold, 10) || 0));
  return {
    placement: l.menuPlacement === 'side' ? 'side' : 'top',
    width: pick(l.headerWidth, Object.keys(HEADER_WIDTH), d.layout.headerWidth),
    flow: pick(c.menuOverflow, MENU_OVERFLOW, d.chrome.menuOverflow),
    fold: fold === 1 ? 0 : fold,             // a fold that hides one item is no fold
    collapse: pick(c.menuCollapse, MENU_COLLAPSE, d.chrome.menuCollapse),
    align: pick(c.menuAlign, Object.keys(MENU_ALIGN), d.chrome.menuAlign),
    gap: pick(c.menuGap, Object.keys(MENU_GAP), d.chrome.menuGap),
    size: pick(c.menuSize, Object.keys(MENU_SIZE), d.chrome.menuSize),
    current: pick(c.menuCurrent, MENU_CURRENT, d.chrome.menuCurrent)
  };
}

/** The inverse of menuKnobs: a (partial) knob object → the override
 *  fragment to mergeDeep over loadOverrides(). Unknown keys are ignored,
 *  unknown values reset to the default with a Hebrew warning. */
function knobsToOverrides(knobs) {
  const k = knobs || {};
  const warnings = [];
  const out = { layout: {}, chrome: {} };
  const d = DEFAULT_OVERRIDES;
  const put = (section, key, value, list, label) => {
    if (value === undefined || value === null || value === '') return;
    if (list.indexOf(value) >= 0) { out[section][key] = value; return; }
    out[section][key] = d[section][key];
    warnings.push(`ערך לא מוכר ל-${label}: "${String(value).slice(0, 20)}" — הוחזר לברירת המחדל (${d[section][key]}).`);
  };
  put('layout', 'menuPlacement', k.placement, ['top', 'side'], 'placement');
  put('layout', 'headerWidth', k.width, Object.keys(HEADER_WIDTH), 'width');
  put('chrome', 'menuOverflow', k.flow, MENU_OVERFLOW, 'flow');
  put('chrome', 'menuCollapse', k.collapse, MENU_COLLAPSE, 'collapse');
  put('chrome', 'menuAlign', k.align === 'spread' ? 'between' : k.align, Object.keys(MENU_ALIGN), 'align');
  put('chrome', 'menuGap', k.gap, Object.keys(MENU_GAP), 'gap');
  put('chrome', 'menuSize', k.size, Object.keys(MENU_SIZE), 'size');
  put('chrome', 'menuCurrent', k.current, MENU_CURRENT, 'current');
  if (k.fold !== undefined && k.fold !== null && k.fold !== '') {
    const n = parseInt(k.fold, 10);
    if (Number.isNaN(n) || n < MENU_FOLD.min || n > MENU_FOLD.max) {
      out.chrome.menuFold = 0;
      warnings.push(`fold חייב להיות מספר בין ${MENU_FOLD.min} ל-${MENU_FOLD.max} — "${String(k.fold).slice(0, 12)}" בוטל.`);
    } else out.chrome.menuFold = n === 1 ? 0 : n;
  }
  if (!Object.keys(out.layout).length) delete out.layout;
  if (!Object.keys(out.chrome).length) delete out.chrome;
  return { overrides: out, warnings };
}

/** Body classes the theme css keys on (v2.28): [] for an untouched site.
 *  Order: placement, flow, collapse, current. */
function menuBodyClasses(overrides) {
  const k = menuKnobs(overrides);
  const out = [];
  if (k.placement === 'side') out.push('menu-side');
  if (k.flow === 'drawer') out.push('menu-drawer');
  else if (k.flow === 'scroll') out.push('menu-scroll');
  if (k.collapse !== 'md') out.push('nav-collapse-' + k.collapse);
  if (k.current !== 'underline') out.push('nav-current-' + k.current);
  return out;
}

// the storage key ↔ knob name map, so the door and the organizer speak
// through ONE validator (knobsToOverrides) — never a second list of enums
const MENU_KNOB_KEYS = {
  layout: { menuPlacement: 'placement', headerWidth: 'width' },
  chrome: { menuOverflow: 'flow', menuFold: 'fold', menuCollapse: 'collapse', menuAlign: 'align', menuGap: 'gap', menuSize: 'size', menuCurrent: 'current' }
};

/**
 * The menu knobs inside an override fragment (a pasted theme, the studio
 * form, a package) made safe IN PLACE: an unknown value is reset to its
 * default and said in Hebrew, `fold` becomes a clamped number. Only the keys
 * the fragment carries are touched — an absent knob stays absent, so a
 * partial save still merges onto the live theme. Returns the warnings.
 */
function sanitizeMenuKnobs(overrides) {
  const o = overrides || {};
  const knobs = {};
  for (const section of Object.keys(MENU_KNOB_KEYS)) {
    const data = o[section];
    if (!data || typeof data !== 'object') continue;
    for (const [key, knob] of Object.entries(MENU_KNOB_KEYS[section])) {
      if (data[key] !== undefined && data[key] !== null && data[key] !== '') knobs[knob] = data[key];
    }
  }
  if (!Object.keys(knobs).length) return [];
  const { overrides: safe, warnings } = knobsToOverrides(knobs);
  for (const section of Object.keys(MENU_KNOB_KEYS)) {
    if (!safe[section]) continue;
    for (const [key, value] of Object.entries(safe[section])) o[section][key] = value;
  }
  return warnings;
}

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

/**
 * CSS custom properties injected after theme CSS.
 *
 * `opts.scope === 'admin'` (v2.27) — the admin shell links the theme
 * stylesheet too (so builder previews read the palette), and until now that
 * carried the owner's SKIN and EFFECT css into every admin screen: an AI
 * skin that says `h1 { font-size: 3.2rem }` or `.card { … }` restyled the
 * dashboard. The admin scope stops after the variables — palette, fonts,
 * radii, shadows — and emits none of the page background, chrome, button
 * styles, skin or effects. Those are the SITE's, never the admin's.
 */
function overridesToCss(overrides, opts = {}) {
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
    `--accent-bg: ${accentBg};`,
    // the menu's geometry (v2.28) — read by themes/default/css/main.css
    `--header-max-width: ${HEADER_WIDTH[(o.layout || {}).headerWidth] || HEADER_WIDTH.wide};`,
    `--menu-gap: ${MENU_GAP[(o.chrome || {}).menuGap] || MENU_GAP.md};`,
    `--menu-size: ${MENU_SIZE[(o.chrome || {}).menuSize] || MENU_SIZE.md};`,
    `--menu-align: ${MENU_ALIGN[(o.chrome || {}).menuAlign] || MENU_ALIGN.start};`
  ];
  let css = `:root {\n  ${lines.join('\n  ')}\n}\n`;
  if (o.fonts.baseSize) {
    css += `html { font-size: ${cssValue(o.fonts.baseSize)}; }\n`;
  }
  if (cssValue(o.fonts.headingFamily)) {
    css += `h1, h2, h3, h4, h5, h6 { font-family: var(--font-heading); }\n`;
  }
  // the admin shell wants the palette, not the page (see the doc above)
  if (opts.scope === 'admin') return css;
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
  // v2.28b: the fold's "עוד" is a <summary class="nav-more-sum">, not an <a>
  // — every rule that dresses a menu link dresses it too, or the last item
  // of a folded bar looks like a stranger (MENU_LINKS = link + summary).
  const headerText = cssValue(ch.headerText);
  if (headerText) {
    css += `.site-header, .site-header .site-logo, .site-header .main-nav a, .site-header .main-nav .nav-more-sum, .site-header .site-tagline { color: ${headerText}; }\n`;
  }
  if (ch.menuWeight === 'bold') css += `${MENU_LINKS} { font-weight: 700; }\n`;
  const hover = ['color', 'underline', 'pill', 'glow'].includes(ch.menuHover) ? ch.menuHover : 'color';
  if (hover === 'underline') {
    css += `${MENU_LINKS} { transition: color 0.15s, box-shadow 0.15s; }\n` +
      `${MENU_LINKS_HOVER} { color: ${hoverColor}; box-shadow: inset 0 -2px 0 ${hoverColor}; }\n`;
  } else if (hover === 'pill') {
    css += `${MENU_LINKS} { padding: 5px 12px; border-radius: 999px; transition: color 0.15s, background 0.15s; }\n` +
      `${MENU_LINKS_HOVER} { color: ${hoverColor}; background: color-mix(in srgb, ${hoverColor} 14%, transparent); }\n`;
  } else if (hover === 'glow') {
    css += `${MENU_LINKS_HOVER} { color: ${hoverColor}; text-shadow: 0 0 12px ${hoverColor}; }\n`;
  } else if (cssValue(ch.menuHoverColor)) {
    css += `${MENU_LINKS_HOVER} { color: ${hoverColor}; }\n`;
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
  return `<script id="tapuz-theme-effects">\n${EFFECT_GUARD_OPEN}\ntry {\n${safe}\n} catch (e) { window.__tapuzThemeEffectError = String(e && e.message || e); console.error('[tapuz-theme-effects]', e); }\n${EFFECT_GUARD_CLOSE}\n</script>`;
}

// ── The effect GUARD (v2.27) — a padded room for a stranger's script.
//    Ben: "it built a theme using bentml and made a mouse — it freezes and
//    looks sloppy, we cannot allow that." A chat-written mouse effect that
//    creates a DOM node on every mousemove meets a 1000Hz mouse in Firefox
//    and the page dies; the only thing the old wrapper caught was a throw.
//    The effect now runs with its globals SHADOWED (window / document /
//    addEventListener / requestAnimationFrame / setTimeout / setInterval are
//    proxies and wrappers), which buys four guarantees with no change to the
//    snippet itself:
//      1. reduced motion — a visitor who asked for less motion never runs it
//      2. a budget — elements the effect creates are counted (rate + live
//         total); a runaway creator is stopped, its elements removed
//      3. a pace — mousemove/pointermove/touchmove reach the page at most
//         once per animation frame; intervals cannot tick faster than 16ms
//      4. a watchdog — a handler or frame that keeps taking >50ms, or frames
//         that stall, stop the effect; the reason is parked on
//         window.__tapuzFx.killed and posted to the theme studio's canvas
//    Stopping is total: listeners registered through the shadowed globals go
//    silent, scheduled callbacks stop, and the guard's own capture listener
//    swallows motion events so an unshadowed listener starves too.
const EFFECT_GUARD_OPEN = `(function () {
var W = window, D = document, G = W.__tapuzFx = W.__tapuzFx || {};
var MAX_LIVE = 400, MAX_PER_SEC = 240, SLOW_MS = 50, SLOW_HITS = 3, GAP_MS = 250, GAP_HITS = 4, WINDOW_MS = 10000;
try { if (W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches) { G.skipped = 'reduced-motion'; return; } } catch (e) {}
var alive = true, created = [], total = 0, slowHits = 0, gaps = [], lastFrame = 0, frameSeen = false;
G.stop = kill;
function tell() { try { if (W.parent !== W) W.parent.postMessage({ type: 'tapuz-theme-preview', killed: G.killed || '' }, location.origin); } catch (e) {} }
function sweep() { try { var dead = D.querySelectorAll('[data-tapuz-fx]'); for (var i = 0; i < dead.length; i++) if (dead[i].parentNode) dead[i].parentNode.removeChild(dead[i]); } catch (e) {} }
function kill(reason) {
  if (!alive) return;
  alive = false; G.killed = String(reason || 'stopped');
  try { console.warn('[tapuz-theme-effects] האפקט נעצר: ' + G.killed); } catch (e) {}
  sweep();
  // the element whose creation tripped the budget is appended AFTER this
  // returns — sweep again once the handler that made it has finished
  try { W.setTimeout(sweep, 0); W.setTimeout(sweep, 500); } catch (e) {}
  tell();
}
function timed(fn, label) {
  return function () {
    if (!alive) return;
    var t0 = W.performance && W.performance.now ? W.performance.now() : 0;
    try { return fn.apply(this, arguments); }
    finally {
      var dt = t0 ? W.performance.now() - t0 : 0;
      if (dt > SLOW_MS && ++slowHits >= SLOW_HITS) kill(label + ' לוקח יותר מ-' + SLOW_MS + 'ms שוב ושוב (' + Math.round(dt) + 'ms) — האפקט כבד מדי לדף');
    }
  };
}
function budget() {
  var now = W.performance && W.performance.now ? W.performance.now() : Date.now();
  created.push(now); total++;
  while (created.length && now - created[0] > 1000) created.shift();
  if (created.length > MAX_PER_SEC) return kill('האפקט יוצר יותר מ-' + MAX_PER_SEC + ' אלמנטים בשנייה — אלמנט על כל תזוזת עכבר במקום מאגר קבוע');
  if (total % 25 === 0) { var live = D.querySelectorAll('[data-tapuz-fx]').length; if (live > MAX_LIVE) kill('יותר מ-' + MAX_LIVE + ' אלמנטים של האפקט חיים בדף בו-זמנית — האפקט לא מנקה אחריו'); }
}
var gAdd = function (target) {
  return function (type, fn, opt) {
    if (typeof fn !== 'function' || !alive) return;
    var wrapped = timed(fn, 'המאזין ל-' + type);
    try { fn.__tapuzFxWrapped = wrapped; } catch (e) {}
    return target.addEventListener(type, wrapped, opt);
  };
};
var gRemove = function (target) {
  return function (type, fn, opt) { return target.removeEventListener(type, (fn && fn.__tapuzFxWrapped) || fn, opt); };
};
function gRaf(cb) { if (!alive) return 0; return W.requestAnimationFrame(timed(cb, 'פריים של האפקט')); }
function gTimeout(cb, ms) { if (!alive) return 0; var a = [].slice.call(arguments, 2); return W.setTimeout(typeof cb === 'function' ? timed(function () { cb.apply(this, a); }, 'setTimeout של האפקט') : function () {}, ms); }
function gInterval(cb, ms) { if (!alive) return 0; var a = [].slice.call(arguments, 2); var id = W.setInterval(function () { if (!alive) { W.clearInterval(id); return; } if (typeof cb === 'function') timed(function () { cb.apply(this, a); }, 'setInterval של האפקט')(); }, Math.max(16, Number(ms) || 0)); return id; }
function gCreate(tag, o) { var el = D.createElement(tag, o); try { el.setAttribute('data-tapuz-fx', ''); } catch (e) {} budget(); return el; }
function proxy(target, extra) {
  if (typeof Proxy !== 'function') return target;
  return new Proxy(target, {
    get: function (t, k) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) return extra[k];
      var v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set: function (t, k, v) { Reflect.set(t, k, v, t); return true; },
    has: function (t, k) { return k in t; }
  });
}
var docP = proxy(D, { addEventListener: gAdd(D), removeEventListener: gRemove(D), createElement: gCreate });
var winExtra = { addEventListener: gAdd(W), removeEventListener: gRemove(W), requestAnimationFrame: gRaf, setTimeout: gTimeout, setInterval: gInterval, document: docP };
var winP = proxy(W, winExtra);
winExtra.window = winP; winExtra.self = winP; winExtra.globalThis = winP;
// the pace: motion events reach the page once per frame, and never after a stop
['mousemove', 'pointermove', 'touchmove'].forEach(function (type) {
  W.addEventListener(type, function (ev) {
    if (!alive || frameSeen) { ev.stopImmediatePropagation(); return; }
    frameSeen = true;
  }, true);
});
// the watchdog: a stalled frame (not a hidden tab) counts; four inside ten seconds is a freeze
(function tick(t) {
  if (!alive) return;
  frameSeen = false;
  if (lastFrame && !D.hidden && t - lastFrame > GAP_MS && t - lastFrame < 4000) {
    gaps.push(t); while (gaps.length && t - gaps[0] > WINDOW_MS) gaps.shift();
    if (gaps.length >= GAP_HITS) return kill('הדף קפא ' + gaps.length + ' פעמים בעשר שניות (פריים של יותר מ-' + GAP_MS + 'ms) — האפקט מקפיא את הדף');
  }
  lastFrame = t;
  W.requestAnimationFrame(tick);
})(0);
(function (window, document, self, globalThis, addEventListener, removeEventListener, requestAnimationFrame, setTimeout, setInterval) {`;

const EFFECT_GUARD_CLOSE = `}).call(winP, winP, docP, winP, winP, gAdd(W), gRemove(W), gRaf, gTimeout, gInterval);
})();`;

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

// ── Hygiene at the door (v2.27) — what the misfire matrix taught.
//    Every shape below came out of a real chat reply and reached the site
//    unchanged: a curly-quoted colour, an @import of Google Fonts inside the
//    skin, a background image fetched from a stranger's server, a font
//    declared but never loaded, a mouse effect that makes a node per event.
//    Each is now either read the way it was meant (fonts, quotes) or taken
//    out and SAID (external reach) — and what remains is linted so the studio
//    can warn before the owner learns it from a frozen tab.

/**
 * Author CSS (skin / effect) with its external reach removed. `@import` and
 * `url(http…)` are the two ways a stylesheet leaves the site: the prompt
 * forbids both, the door enforces it. A Google-Fonts @import is the one
 * case with a meaning worth keeping — its families move to fonts.google.
 * @returns {{ css: string, changes: string[], fonts: string[] }}
 */
function cleanAuthorCss(css) {
  let s = String(css == null ? '' : css);
  const changes = [];
  const fonts = [];
  const takeImport = (href) => {
    const h = String(href || '').replace(/["']/g, '').trim();
    if (/fonts\.googleapis\.com/i.test(h)) {
      const fam = [...h.matchAll(/family=([^&:]+)/g)].map((x) => {
        try { return decodeURIComponent(x[1]).replace(/\+/g, ' ').trim(); } catch (e) { return x[1].replace(/\+/g, ' ').trim(); }
      }).filter(Boolean);
      fonts.push(...fam);
      changes.push(fam.length ? `@import של Google Fonts הוסר מה-CSS — הגופנים (${fam.join(', ')}) עברו ל-bent-fonts google` : '@import של Google Fonts הוסר מה-CSS');
    } else {
      changes.push('@import חיצוני הוסר מה-CSS: ' + h.slice(0, 80));
    }
    return '';
  };
  s = s.replace(/@import\s+url\(([^)]*)\)[^;]*;?/gi, (m, href) => takeImport(href));
  s = s.replace(/@import\s+(["'])([^"']+)\1[^;]*;?/gi, (m, q, href) => takeImport(href));
  s = s.replace(/url\(\s*(["']?)((?:https?:)?\/\/[^"')\s]+)\1\s*\)/gi, (m, q, href) => {
    changes.push('כתובת חיצונית הוסרה מה-CSS (משאבים רק מהאתר עצמו): ' + href.slice(0, 80));
    return 'none';
  });
  return { css: s.trim(), changes, fonts };
}

/** A colour the theme model accepts — hex (3/6/8), rgb()/rgba() folded to
 *  hex, a plain colour keyword kept; anything else is not a colour. */
function normalizeColor(v) {
  const s = String(v == null ? '' : v).replace(/["'“”‘’]/g, '').trim();
  if (!s) return '';
  const h3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (h3) return ('#' + h3[1] + h3[1] + h3[2] + h3[2] + h3[3] + h3[3]).toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(s) || /^#[0-9a-f]{8}$/i.test(s)) return s.toLowerCase();
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(s);
  if (rgb) return '#' + [rgb[1], rgb[2], rgb[3]].map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('');
  if (/^[a-z]{3,20}$/i.test(s)) return s.toLowerCase();
  return null;
}

/** The colour section, every value a colour — or dropped, with a word. */
function sanitizeColors(colors) {
  const out = {};
  const warnings = [];
  for (const [k, v] of Object.entries(colors || {})) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_OVERRIDES.colors, k)) continue;
    const c = normalizeColor(v);
    if (c) out[k] = c;
    else if (String(v || '').trim()) warnings.push(`הצבע "${k}" (${String(v).slice(0, 30)}) לא תקין — הושמט, נשאר צבע הערכה`);
  }
  return { colors: out, warnings };
}

// the shelf's display faces — the ones a designer reaches for in a heading
const HEADING_FACES = new Set(['Suez One', 'Secular One', 'Karantina', 'Amatic SC', 'Frank Ruhl Libre', 'Bellefair', 'Bona Nova', 'Noto Serif Hebrew', 'David Libre']);

/** A shelf family named inside a CSS font stack, or ''. */
function shelfFamilyIn(stack) {
  const s = String(stack || '');
  for (const f of Object.keys(GOOGLE_FONTS)) {
    if (new RegExp('(^|["\'\\s,])' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(["\'\\s,]|$)', 'i').test(s)) return f;
  }
  return '';
}

/**
 * The fonts section made whole: a family named in the stack but missing
 * from `google` is loaded; a `google` list with an empty stack is used.
 * Both are what the model MEANT — the old behaviour was a request for a
 * font that never reached the page, or a page that never asked for it.
 */
function deriveFonts(fonts, extraGoogle) {
  const f = { ...(fonts || {}) };
  const warnings = [];
  const google = [];
  const add = (name) => {
    const n = String(name || '').replace(/["']/g, '').trim();
    if (!n || google.some((g) => g.toLowerCase() === n.toLowerCase())) return;
    // hasOwnProperty, not truthiness: a regular-only face (Suez One, Varela
    // Round) is on the shelf with an EMPTY weight list
    if (!Object.prototype.hasOwnProperty.call(GOOGLE_FONTS, n)) { warnings.push(`הגופן "${n}" אינו במדף הגופנים העבריים — לא ייטען`); return; }
    google.push(n);
  };
  (Array.isArray(f.google) ? f.google : String(f.google || '').split(',')).forEach(add);
  (extraGoogle || []).forEach(add);
  const inFamily = shelfFamilyIn(f.family);
  const inHeading = shelfFamilyIn(f.headingFamily);
  if (inFamily && !google.some((g) => g.toLowerCase() === inFamily.toLowerCase())) { add(inFamily); warnings.push(`הגופן "${inFamily}" הוזכר ב-family בלי google — נוסף לטעינה`); }
  if (inHeading && !google.some((g) => g.toLowerCase() === inHeading.toLowerCase())) { add(inHeading); warnings.push(`הגופן "${inHeading}" הוזכר ב-heading בלי google — נוסף לטעינה`); }
  if (google.length && !String(f.family || '').trim()) {
    const body = google.find((g) => !HEADING_FACES.has(g)) || google[0];
    f.family = `"${body}", ${SYSTEM_FONT}`;
    warnings.push(`family היה ריק — נקבע ל-"${body}" מהגופנים שביקשת לטעון`);
  }
  if (google.length > 1 && !String(f.headingFamily || '').trim()) {
    const head = google.find((g) => HEADING_FACES.has(g) && !new RegExp(g, 'i').test(f.family || ''));
    if (head) { f.headingFamily = `"${head}", ${SYSTEM_FONT}`; warnings.push(`heading היה ריק — נקבע ל-"${head}"`); }
  }
  f.google = google.slice(0, 4);
  return { fonts: f, warnings };
}

/**
 * What the effect guard will have to do to this snippet, said up front.
 * Warnings, never refusals — the guard on the page is the safety; this is
 * the studio telling the owner what it saw before the visitors do.
 */
function lintEffect(js, css) {
  const s = String(js || '');
  const c = String(css || '');
  const out = [];
  if (!s.trim()) return out;
  if (/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(s)) out.push('לולאה אינסופית (while(true)) — השומר יעצור את האפקט');
  for (const m of s.matchAll(/setInterval\s*\([^,]+,\s*(\d+)/g)) if (Number(m[1]) < 16) out.push(`setInterval כל ${m[1]}ms — מהיר מדי, יוגבל ל-16ms`);
  if (/document\.write\s*\(/.test(s)) out.push('document.write מוחק את הדף — לא ירוץ כמצופה');
  if (/\balert\s*\(|\bconfirm\s*\(|\bprompt\s*\(/.test(s)) out.push('alert/confirm/prompt מפריעים לגולשים — להסיר');
  if (/\bimport\s*\(|\brequire\s*\(|https?:\/\//i.test(s)) out.push('כתובת או ספרייה חיצונית בקוד — האפקט חייב להיות עצמאי (Vanilla, בלי CDN)');
  const perMove = /(mousemove|pointermove|touchmove)[\s\S]{0,600}?(createElement|appendChild|insertAdjacentHTML|innerHTML\s*\+?=|cloneNode)/i.test(s);
  const capped = /(\.length\s*(>=?|<=?)\s*\d|MAX|LIMIT|POOL|cap\b|slice\(\s*-|shift\(\)|splice\()/i.test(s);
  if (perMove && !capped) out.push('יוצר אלמנט בכל תזוזת עכבר בלי תקרה — השומר יעצור אחרי 400 אלמנטים חיים; עדיף מאגר קבוע (pool) של 20–30 נקודות שממוחזרות');
  if (!/prefers-reduced-motion/i.test(s + c)) out.push('לא מכבד prefers-reduced-motion — השומר מכבה את האפקט לגולשים שביקשו להפחית תנועה');
  if (/createElement|appendChild|insertAdjacentHTML/i.test(s) && !/pointer-events\s*:\s*none/i.test(s + c)) out.push('האלמנטים של האפקט בלי pointer-events:none — עלולים לחסום קליקים על הדף');
  if (/\.style\.(top|left)\s*=/.test(s) && !/transform/i.test(s)) out.push('מזיז אלמנטים עם top/left במקום transform — כבד יותר לדפדפן');
  return out;
}

/** The skin is cosmetics on the skeleton — a rule that hides or reflows the
 *  skeleton is a broken site, not a theme. Warnings only. */
function lintSkin(css) {
  const s = String(css || '');
  const out = [];
  if (!s.trim()) return out;
  if (/(\.main-nav|\.site-footer|\.site-header|\.skip-link)[^{]*\{[^}]*display\s*:\s*none/i.test(s)) out.push('העור מסתיר את התפריט/הכותרת/התחתית (display:none) — אסור לפי חוקי הערכה');
  if (/\bbody\s*[^{]*\{[^}]*overflow\s*:\s*hidden/i.test(s)) out.push('overflow:hidden על body — הדף לא יגלול');
  if (/\bbody\s*[^{]*\{[^}]*position\s*:\s*(fixed|absolute)/i.test(s)) out.push('position:fixed/absolute על body — שובר את הפריסה');
  const important = (s.match(/!important/g) || []).length;
  if (important > 12) out.push(`${important} פעמים !important — עור צריך לעצב דרך הסלקטורים, לא לכפות`);
  if (/@keyframes[\s\S]{0,400}?(width|height|top|left|margin)\s*:/i.test(s)) out.push('אנימציה על width/height/top/left — כבדה; עדיף transform/opacity');
  return out;
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
 *   ```html  → the specimen: BenTML for the bench (v2.26), returned apart
 * Any of the four may be missing; prose around them is ignored. Returns
 * { name, overrides, specimen, parts } or throws a plain-language error.
 */
function extractThemeReply(reply, fallbackName) {
  const text = String(reply || '');
  const warnings = [];
  const notes = [];
  let name = '';
  let overrides = {};
  let specimen = '';
  let bent = false;
  let json = null;
  const cssFences = allFences(text, ['css']);
  const jsFences = allFences(text, ['js', 'javascript']);

  // v2.26: a <bent-theme> document (the BenTML theme dialect) is THE format —
  // one fence, sections as tags, css/js as <style>/<script>, the bench as
  // <bent-canvas>. The JSON path below stays for older replies and files.
  const dialect = require('./bentml/theme-dialect');
  if (dialect.isThemeBent(text)) {
    const t = dialect.parseTheme(text);
    bent = true;
    name = t.name;
    overrides = pickSections(t.overrides);
    specimen = t.canvas;
    notes.push(...t.notes);
    if (t.notes.includes('SEVERAL_DOCUMENTS')) warnings.push('התשובה הכילה כמה מסמכי <bent-theme> — נלקח העשיר שבהם');
    if (t.notes.includes('BARE_STYLE')) warnings.push('ה-CSS נכתב ישירות ב-<style> בלי <bent-skin> — נקרא כעור');
    if (t.notes.includes('BARE_SCRIPT')) warnings.push('ה-JS נכתב ישירות ב-<script> בלי <bent-effect> — נקרא כאפקט');
    // the skin/effect written as fences BESIDE the document (D in the matrix)
    if (cssFences.length && !(overrides.skin && overrides.skin.css)) { overrides.skin = { ...(overrides.skin || {}), css: cssFences.join('\n\n') }; warnings.push('העור הגיע ב-fence של css מחוץ למסמך — צורף לערכה'); }
    if (jsFences.length && !(overrides.effects && overrides.effects.js)) { overrides.effects = { ...(overrides.effects || {}), js: jsFences.join('\n\n') }; warnings.push('האפקט הגיע ב-fence של js מחוץ למסמך — צורף לערכה'); }
    if (!Object.keys(overrides).length && !specimen) throw new Error('מסמך ה-<bent-theme> ריק — אין בו אף מקטע (colors/fonts/style/…) ולא קנבס');
  } else {
    json = extractThemeJson(text);
    if (json) {
      if (json.format === THEME_PACKAGE_FORMAT && json.overrides && typeof json.overrides === 'object') {
        name = String(json.name || '');
        overrides = pickSections(json.overrides);
      } else {
        name = String(json.name || json.title || '');
        overrides = pickSections(json);
      }
    }
    // the SPECIMEN (v2.26): an html/pzn fence of BenTML — the bench the model
    // composed to show its theme off. Kept OUTSIDE overrides: the bench is
    // beside the theme, never inside it (theme-canvas.js).
    specimen = allFences(text, ['html', 'pzn', 'bentml']).find((f) => /<bent-[a-z]/i.test(f)) || '';
    // a reply that skipped the fences and answered with bare <style>/<script>
    if (!cssFences.length && !jsFences.length && !json) {
      const parts = extractEffectParts(text);
      if (parts.css) cssFences.push(parts.css);
      if (parts.js) jsFences.push(parts.js);
    }
    if (cssFences.length) overrides.skin = { ...(overrides.skin || {}), css: cssFences.join('\n\n') };
    if (jsFences.length) overrides.effects = { ...(overrides.effects || {}), js: jsFences.join('\n\n') };
    if (!Object.keys(overrides).length) {
      // a PAGE, not a theme (I in the matrix): the site-builder habit of a
      // chat that was not FRESH. Naming it is the whole fix — the old door
      // "succeeded" with an empty theme named after the brief.
      if (specimen || /<bent-[a-z]/i.test(text)) {
        const e = new Error('זו תשובה של בונה-הדפים — מסמך .pzn עם מודולים, לא ערכת נושא. הצ׳אט כנראה לא היה חדש (FRESH) וענה בשפת הדפים. אפשר להדביק את המודולים האלה בקנבס (למטה), ולבקש את הערכה עצמה בצ׳אט חדש עם פרומפט המעצב/ת');
        e.code = 'PAGE_NOT_THEME';
        throw e;
      }
      throw new Error('לא נמצאה ערכת נושא בתשובה — צריך מסמך <bent-theme> (או fence של json/css). ודאו שהעתקתם את כל התשובה, ושביקשתם אותה בצ׳אט חדש (FRESH)');
    }
  }

  // hygiene: colours that are colours, fonts that load, css that stays home
  if (overrides.colors) {
    const c = sanitizeColors(overrides.colors);
    overrides.colors = c.colors;
    warnings.push(...c.warnings);
    if (!Object.keys(overrides.colors).length) delete overrides.colors;
  }
  let importedFonts = [];
  if (overrides.skin && overrides.skin.css) {
    const cleaned = cleanAuthorCss(overrides.skin.css);
    overrides.skin.css = cleaned.css;
    warnings.push(...cleaned.changes);
    importedFonts = importedFonts.concat(cleaned.fonts);
    if (!overrides.skin.css) delete overrides.skin;
  }
  if (overrides.effects && overrides.effects.css) {
    const cleaned = cleanAuthorCss(overrides.effects.css);
    overrides.effects.css = cleaned.css;
    warnings.push(...cleaned.changes);
    importedFonts = importedFonts.concat(cleaned.fonts);
  }
  if (overrides.fonts || importedFonts.length) {
    const f = deriveFonts(overrides.fonts || {}, importedFonts);
    overrides.fonts = f.fonts;
    warnings.push(...f.warnings);
  }
  if (overrides.effects && !String(overrides.effects.js || '').trim() && !String(overrides.effects.css || '').trim()) delete overrides.effects;
  // the menu knobs (v2.28b): a value the theme css has no rule for would
  // land as a body class nothing answers — reset it and say so
  warnings.push(...sanitizeMenuKnobs(overrides));

  const jsErr = checkEffectJs(overrides.effects && overrides.effects.js);
  if (jsErr) throw new Error('ה-JS של האפקט לא מתקמפל: ' + jsErr + (bent ? ' — בקשו מהצ׳אט לתקן ולהחזיר את המסמך מחדש' : ' — בקשו מהצ׳אט לתקן ולהחזיר את ה-fence מחדש'));
  const cssErr = checkCss(overrides.skin && overrides.skin.css);
  if (cssErr) throw new Error(cssErr + ' — בקשו מהצ׳אט לתקן');
  warnings.push(...lintEffect(overrides.effects && overrides.effects.js, overrides.effects && overrides.effects.css));
  warnings.push(...lintSkin(overrides.skin && overrides.skin.css));

  name = String(name || '').trim().slice(0, 120) || String(fallbackName || '').trim().slice(0, 120) || 'ערכה מה-AI';
  return {
    name,
    overrides,
    specimen,
    warnings,
    parts: {
      bent,
      json: !!json,
      notes,
      cssChars: (overrides.skin && overrides.skin.css || '').length,
      jsChars: (overrides.effects && overrides.effects.js || '').length,
      specimenChars: specimen.length
    }
  };
}

function getThemeSettings() {
  const config = loadConfig();
  const overrides = loadOverrides();
  return {
    overrides,
    logo: config.logo || { type: 'text', text: config.title || 'Site', image: '', width: 180, height: 50 },
    siteTitle: config.title || 'Tapuz',
    description: config.description || '',
    defaultTheme: config.defaultTheme || 'default',
    menuFit: menuFitFor(overrides, config)
  };
}

/**
 * How the main menu fits its row under these knobs (v2.28b) — the studio's
 * capacity hint. The estimate lives in menus.js (the organizer's home);
 * required lazily because menus.js opens the database at load and may
 * itself require this module. Null when the estimate is unavailable — the
 * studio simply shows no hint, it never fails.
 */
function menuFitFor(overrides, config) {
  try {
    const menus = require('./menus');
    if (typeof menus.estimateMenuFit !== 'function') return null;
    return menus.estimateMenuFit(menus.getMenuForLocation('main'), overrides, config) || null;
  } catch (e) {
    return null;
  }
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
  const incoming = payload.overrides || payload;
  // the menu knobs go through the one validator (v2.28b): an unknown value
  // is stored as its default and reported in `warnings` for the door to show
  const warnings = sanitizeMenuKnobs(incoming);
  saveOverrides(mergeDeep(loadOverrides(), incoming));
  return { ...getThemeSettings(), warnings };
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

/** The current theme as a `.bent` document (v2.26) — with the bench when
 *  asked, so a shared theme carries the specimen that shows it off. */
function exportThemeBent(name, opts = {}) {
  const canvas = opts.withCanvas === false ? '' : (() => { try { return require('./theme-canvas').loadSource(); } catch (e) { return ''; } })();
  return require('./bentml/theme-dialect').serializeTheme({
    name: String(name || '').trim().slice(0, 120) || 'ערכת נושא מותאמת',
    overrides: loadOverrides(),
    canvas: canvas && /<bent-[a-z]/i.test(canvas) ? benchBody(canvas) : ''
  });
}

/** The <body> of a bench document as a fragment for <bent-canvas>. */
function benchBody(source) {
  const m = String(source || '').match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const inner = (m ? m[1] : String(source || '')).trim();
  // drop the common indentation the serializer added
  const lines = inner.split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

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
  if (require('./bentml/theme-dialect').isThemeBent(text)) {
    const t = extractThemeReply(text);
    return { format: THEME_PACKAGE_FORMAT, version: THEME_PACKAGE_VERSION, name: t.name, exportedAt: new Date().toISOString(), overrides: t.overrides, canvas: t.specimen, warnings: t.warnings };
  }
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
    overrides: theme.overrides,
    warnings: theme.warnings
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
  // the menu knobs walk through the one validator here too (v2.28b) — an
  // unknown value (menuCollapse:'huge') is stored as its default, never
  // verbatim, and said in Hebrew on the package's own `warnings`: that list
  // is what the import route already forwards to the studio
  const knobWarnings = sanitizeMenuKnobs(valid.overrides);
  if (knobWarnings.length) valid.warnings = (Array.isArray(valid.warnings) ? valid.warnings : []).concat(knobWarnings);
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
  // the menu's geometry (v2.28)
  HEADER_WIDTH,
  MENU_GAP,
  MENU_SIZE,
  MENU_ALIGN,
  MENU_OVERFLOW,
  MENU_COLLAPSE,
  MENU_CURRENT,
  MENU_FOLD,
  menuKnobs,
  knobsToOverrides,
  menuBodyClasses,
  sanitizeMenuKnobs,
  menuFitFor,
  // hygiene at the door (v2.27)
  cleanAuthorCss,
  normalizeColor,
  sanitizeColors,
  deriveFonts,
  lintEffect,
  lintSkin,
  getThemeSettings,
  saveThemeSettings,
  // theme packages (v0.99)
  THEME_PACKAGE_FORMAT,
  THEME_PACKAGE_VERSION,
  exportThemePackage,
  exportThemeBent,
  benchBody,
  parseThemePackage,
  validateThemePackage,
  importThemePackage
};
