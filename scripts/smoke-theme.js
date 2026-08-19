'use strict';

/**
 * v0.72 QA — the theme awakening: looks, personality knobs (radius/shadow/
 * accent), var unification, and WCAG contrast on every shipped look.
 */

const fs = require('fs');
const path = require('path');
const { DEFAULT_OVERRIDES, LOOKS, overridesToCss } = require('../src/theme');

let fail = false;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail = true;
}

// ── overridesToCss: the new var vocabulary ───────────────────────────
const css = overridesToCss({});
for (const v of ['--color-surface', '--color-accent', '--color-secondary', '--color-text-muted',
  '--radius-md', '--radius-lg', '--radius-pill', '--shadow-1', '--shadow-2', '--accent-bg', '--font-heading']) {
  check(`emits ${v}`, css.includes(v + ':'));
}
check('--color-accent equals primary (components finally obey the builder)',
  /--color-accent: #ea580c;/.test(css) && /--color-primary: #ea580c;/.test(css));
check('THE DEFAULT IS THE TAPUZ LOOK — warm bg + gradient accent, never a white page',
  /--color-bg: #fffbf7;/.test(css) && css.includes('--accent-bg: linear-gradient(135deg, #ea580c, #f59e0b);'));
check('solid accent → plain color', /--accent-bg: #0a66c2;/.test(overridesToCss({ colors: { primary: '#0a66c2' }, style: { accent: 'solid' } })));

const grad = overridesToCss({ style: { accent: 'gradient' }, colors: { primary: '#ea580c', secondary: '#f59e0b' } });
check('gradient accent → linear-gradient(primary, secondary)',
  grad.includes('--accent-bg: linear-gradient(135deg, #ea580c, #f59e0b);'));

check('sharp radius scale', /--radius-lg: 6px;/.test(overridesToCss({ style: { radius: 'sharp' } })));
check('round radius scale', /--radius-lg: 20px;/.test(overridesToCss({ style: { radius: 'round' } })));
check('flat shadow scale', /--shadow-2: none;/.test(overridesToCss({ style: { shadow: 'flat' } })));
check('unknown radius falls back to soft', /--radius-lg: 12px;/.test(overridesToCss({ style: { radius: 'weird' } })));

check('heading font rule only when headingFamily set',
  !/h1, h2, h3/.test(overridesToCss({})) &&
  /h1, h2, h3, h4, h5, h6 \{ font-family: var\(--font-heading\); \}/.test(overridesToCss({ fonts: { headingFamily: 'Georgia, serif' } })));

const hostile = overridesToCss({ colors: { primary: '#fff;} body{background:red' } });
check('css values are scrubbed (no rule breakout via } { ;)', !hostile.includes('} body{') && !hostile.includes(';}'));
// the override CSS is inlined into a <style> tag on every page — a value must
// never close it (review finding: stored XSS via </style><img onerror>)
const breakout = overridesToCss({ fonts: { family: '</style><img src=x onerror=alert(1)>' } });
check('css values cannot break out of the <style> tag (< > stripped)',
  !breakout.includes('</style') && !breakout.includes('<img'));

// ── LOOKS integrity ──────────────────────────────────────────────────
const HEX = /^#[0-9a-fA-F]{6}$/;
const looksKeys = Object.keys(LOOKS);
// v2.23 widened the shelf ("if we present a slim choice of themes, what are
// we worth as a company?") — pin a floor, not an exact count, so adding a
// look never breaks CI while losing one still does.
check('the gallery ships at least ten looks', looksKeys.length >= 10);
for (const key of looksKeys) {
  const look = LOOKS[key];
  const c = look.overrides.colors || {};
  const complete = ['primary', 'secondary', 'text', 'muted', 'border', 'bg', 'lightBg', 'surface'].every((k) => HEX.test(c[k]));
  const st = look.overrides.style || {};
  const validStyle = ['sharp', 'soft', 'round'].includes(st.radius) && ['flat', 'soft', 'deep'].includes(st.shadow) && ['solid', 'gradient'].includes(st.accent);
  check(`look "${key}" is complete (8 valid hex colors + valid style enums)`, complete && validStyle && look.label);
}
check('tapuz look IS the default (one source of truth for the brand default)',
  JSON.stringify(LOOKS.tapuz.overrides.colors) === JSON.stringify(DEFAULT_OVERRIDES.colors) &&
  JSON.stringify(LOOKS.tapuz.overrides.style) === JSON.stringify(DEFAULT_OVERRIDES.style));
check('naki look is the explicit clean-white choice', LOOKS.naki.overrides.colors.bg === '#ffffff' && LOOKS.naki.overrides.colors.primary === '#0a66c2');
check('radius scale includes sm', /--radius-sm: 6px;/.test(overridesToCss({})));

// ── WCAG contrast on every look (a beautiful theme must be readable) ──
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function contrast(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
for (const key of looksKeys) {
  const c = LOOKS[key].overrides.colors;
  check(`look "${key}": text/bg contrast ≥ 4.5 (AA) — got ${contrast(c.text, c.bg).toFixed(1)}`, contrast(c.text, c.bg) >= 4.5);
  check(`look "${key}": text/surface contrast ≥ 4.5 — got ${contrast(c.text, c.surface).toFixed(1)}`, contrast(c.text, c.surface) >= 4.5);
  check(`look "${key}": muted/bg contrast ≥ 3 — got ${contrast(c.muted, c.bg).toFixed(1)}`, contrast(c.muted, c.bg) >= 3);
}

// ── the theme CSS actually listens (var unification landed) ──────────
const themeCss = fs.readFileSync(path.join(__dirname, '..', 'themes', 'default', 'css', 'main.css'), 'utf8');
check('theme css uses --color-surface', themeCss.includes('var(--color-surface'));
check('theme css uses the radius scale', themeCss.includes('var(--radius-lg') && themeCss.includes('var(--radius-md'));
check('theme css uses the shadow scale', themeCss.includes('var(--shadow-2'));
check('buttons ride the accent surface (gradient-capable)', themeCss.includes('var(--accent-bg'));
check('no bare white panels left', !/background: #fff;|background: #ffffff;/.test(themeCss));
// intentional two-level fallbacks: --bent-* per-block colors and the
// accent surface (--accent-bg → --color-primary). Anything else is a bug.
check('no unintended nested var fallbacks', !/var\(--(?!bent-|accent-bg)[\w-]+, var\(/.test(themeCss));
// review finding: the ticker bar is dark CHROME — it must never ride the
// always-emitted --color-surface (white-on-white)
check('ticker bar has its own dark var, not --color-surface', themeCss.includes('var(--bent-ticker-bg, #0f172a)'));

// ── an empty banner ships NOTHING to readers (pzn compile path, pure) ─
const pzn = require('../src/pzn/index');
const emptyBanner = { title: 't', slug: 't', direction: 'rtl', tags: [], meta: {}, blocks: [
  { type: 'banner', id: 'bn1', data: { text: '', tone: 'brand' } },
  { type: 'banner', id: 'bn2', data: { text: 'מבצע אמיתי!', tone: 'brand' } }
] };
const bannerHtml = pzn.compile(pzn.parse(pzn.serialize(pzn.fromTapuzPage(emptyBanner))));
check('empty banner renders nothing', (bannerHtml.match(/site-banner/g) || []).length === 1);
check('real banner still renders', bannerHtml.includes('מבצע אמיתי!'));

console.log('');
console.log(fail ? 'SMOKE THEME: FAIL' : 'SMOKE THEME: PASS');
process.exit(fail ? 1 : 0);
