'use strict';

/**
 * The design's LOOK, as a Tapuziel theme (v2.56).
 *
 * Geppetto's pages carry their colors where a designer put them (a section's
 * slab, a button's pill); the site around them — the header, the menu, the
 * footer, the next page the owner adds by hand — needs the same voice. This
 * reads the design's habits out of the life pass's facts and writes them as
 * a `<bent-theme>` document (src/bentml/theme-dialect.js), which lands in the
 * theme LIBRARY and is applied through the library's own door (the live look
 * is backed up first, so switching back is one click).
 *
 *   colors      the page color (the fill with the most area), the words'
 *               color on it, the accent (button pills and colored titles
 *               first), a second accent, and the quiet shades derived
 *   fonts       the titles' face and the body's face (fonts.js maps them to
 *               Google families), the body size
 *   style       button shape (pill / soft / square) and filled vs outline,
 *               flat shadows and solid accents (design tools draw flat)
 *   layout      the content column as wide as the design's content
 *   chrome      header / footer colors when the design's menu band or
 *               footer band wore their own color
 *   skin        the title sizes of the design, fluid (clamp + vw), so a
 *               96px Canva title is a big title here too, and still fits a
 *               phone
 */

const P = require('./puppet');
const F = require('./fonts');

function weightedTop(entries, keyFn, weightFn) {
  const tally = new Map();
  for (const e of entries) {
    const k = keyFn(e);
    if (!k) continue;
    tally.set(k, (tally.get(k) || 0) + weightFn(e));
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]);
}

/** Chroma-ish: how far a color is from its own gray. */
function saturation(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** weightedTop, with colors closer than `near` merged into their heaviest member. */
function clusterColors(entries, keyFn, weightFn, near = 28) {
  const top = weightedTop(entries, (e) => P.toHex(keyFn(e)), weightFn);
  const clusters = [];
  for (const [c, w] of top) {
    const home = clusters.find((k) => P.colorDistance(k[0], c) < near);
    if (home) home[1] += w;
    else clusters.push([c, w]);
  }
  return clusters.sort((a, b) => b[1] - a[1]);
}

function median(list) {
  const a = list.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const round = (n, step = 1) => Math.round(n / step) * step;

/** '5.5000rem' → '5.5rem' */
const rem = (n) => (Math.round(n * 100) / 100) + 'rem';

/**
 * @param {object} life   the result of life.breathe()
 * @param {object} puppet the puppet it breathed
 * @returns {{ overrides: object, bent: string, name: string, fontMap: object[], palette: object }}
 */
function extractLook(life, puppet) {
  const facts = life.facts || {};
  const hebrew = puppet.site.dir === 'rtl' || /^he|^iw/i.test(puppet.site.lang || '');

  // ── colors ──
  // near-identical fills are one color to the eye (#f4f4f4 beside #ffffff):
  // cluster them before asking which color the page mostly wears
  const fills = clusterColors(facts.fills || [], (f) => f.color, (f) => f.area);
  const bg = (fills[0] && fills[0][0]) || '#ffffff';
  const onBg = (facts.texts || []).filter((t) => {
    const s = (facts.sectionsText || [])[t.section];
    return !s || !s.fill || P.colorDistance(s.fill, bg) < 24;
  });
  const textTop = weightedTop(onBg.length ? onBg : facts.texts || [], (t) => t.color, (t) => t.chars);
  let text = (textTop[0] && textTop[0][0]) || (P.isDark(bg) ? '#f5f5f5' : '#1c1917');
  if (P.contrast(text, bg) < 3) text = P.isDark(bg) ? '#f5f5f5' : '#1c1917';

  const accents = [];
  for (const b of facts.buttons || []) if (b.bg) accents.push({ color: b.bg, w: 400 });
  for (const b of facts.buttons || []) if (b.outline && b.fg) accents.push({ color: b.fg, w: 120 });
  for (const t of facts.texts || []) if (t.kind === 'heading' && t.color) accents.push({ color: t.color, w: t.chars * 4 });
  for (const p of facts.panels || []) if (p.bg && P.parseColor(p.bg)) accents.push({ color: p.bg, w: 150 });
  for (const f of fills.slice(1)) accents.push({ color: f[0], w: Math.min(600, f[1] / 4000) });
  for (const c of puppet.palette || []) accents.push({ color: P.toHex(c), w: 50 });
  const ranked = weightedTop(accents, (a) => P.toHex(a.color), (a) => a.w * (0.35 + saturation(a.color)))
    .map(([c]) => c)
    .filter((c) => P.colorDistance(c, bg) > 60 && P.colorDistance(c, text) > 40);
  // a design with no accent at all (black and white) keeps its restraint:
  // the words' own color is the accent, not a color Geppetto made up
  const primary = ranked[0] || text;
  const secondary = ranked.find((c) => P.colorDistance(c, primary) > 50) || P.mix(primary, bg, 0.35);
  const lightFill = fills.map(([c]) => c).find((c) => c !== bg && P.colorDistance(c, bg) < 90 && P.isDark(c) === P.isDark(bg));
  const panelTop = weightedTop(facts.panels || [], (p) => P.toHex(p.bg), () => 1);
  const colors = {
    primary,
    secondary,
    text,
    muted: P.mix(text, bg, 0.42),
    border: P.mix(text, bg, 0.84),
    bg,
    lightBg: lightFill || P.mix(bg, primary, 0.07),
    surface: (panelTop[0] && P.contrast(panelTop[0][0], text) >= 3 && panelTop[0][0]) || (P.isDark(bg) ? P.mix(bg, '#ffffff', 0.06) : '#ffffff')
  };

  // ── fonts ──
  const fontName = (key) => {
    const f = (puppet.fonts || {})[key];
    return (f && f.family) || (typeof key === 'string' && !/^[A-Z0-9_-]{8,}(,\d+)?$/.test(key) ? key : '');
  };
  const headTop = weightedTop((facts.texts || []).filter((t) => t.kind === 'heading'), (t) => fontName(t.font), (t) => t.chars * (t.level === 1 ? 3 : 1));
  const bodyTop = weightedTop((facts.texts || []).filter((t) => t.kind === 'text' || t.kind === 'list'), (t) => fontName(t.font), (t) => t.chars);
  const bodyFamily = (bodyTop[0] && bodyTop[0][0]) || (headTop[0] && headTop[0][0]) || '';
  const headFamily = (headTop[0] && headTop[0][0]) || bodyFamily;
  const fontMap = [];
  const fonts = {};
  const google = [];
  const want = (family) => {
    if (!family) return null;
    const m = F.mapFamily(family, { hebrew });
    if (!fontMap.some((x) => x.from === m.from)) fontMap.push(m);
    if (!google.includes(m.family)) google.push(m.family);
    return m;
  };
  const bodyMapped = want(bodyFamily);
  const headMapped = want(headFamily);
  if (bodyMapped) fonts.family = F.stackFor(bodyMapped);
  if (headMapped && (!bodyMapped || headMapped.family !== bodyMapped.family)) fonts.headingFamily = F.stackFor(headMapped);
  fonts.google = google.slice(0, 4);
  const scale = life.scale || { body: 16 };
  const width = (puppet.pages[0] && puppet.pages[0].width) || 1366;
  const bodyPx = scale.body * (1366 / width);
  fonts.baseSize = Math.max(15, Math.min(19, Math.round(bodyPx * 0.95))) + 'px';

  // ── style ──
  const radii = weightedTop(facts.buttons || [], (b) => b.radius || 'none', () => 1);
  const r0 = radii[0] && radii[0][0];
  const outline = (facts.buttons || []).filter((b) => b.outline).length > (facts.buttons || []).length / 2;
  const style = {
    radius: r0 === 'lg' ? 'round' : r0 === 'md' ? 'soft' : r0 === 'sm' || r0 === 'none' ? 'sharp' : 'soft',
    shadow: 'flat',
    accent: 'solid',
    buttons: outline ? 'outline' : 'filled'
  };

  // ── layout ──
  const content = median(facts.widths || []);
  const layout = {
    maxWidth: Math.max(960, Math.min(1240, round(content || 1140, 20))) + 'px',
    menuPlacement: 'top',
    headerWidth: 'wide'
  };

  // ── chrome ──
  const chrome = { menuHover: 'underline' };
  if (facts.nav && facts.nav.fill && P.colorDistance(facts.nav.fill, bg) > 30) {
    chrome.headerBg = facts.nav.fill;
    chrome.headerText = facts.nav.color && P.contrast(facts.nav.color, facts.nav.fill) >= 3 ? facts.nav.color : (P.isDark(facts.nav.fill) ? '#ffffff' : '#111111');
  } else if (P.isDark(bg)) {
    chrome.headerBg = bg;
    chrome.headerText = text;
  }
  const footerFill = (facts.footer && facts.footer.fill) || ((fills.find(([c]) => (facts.fills || []).some((f) => f.color === c && f.last)) || [])[0]);
  if (footerFill && P.parseColor(footerFill)) {
    chrome.footerBg = P.toHex(footerFill);
    const fc = facts.footer && facts.footer.color;
    chrome.footerText = fc && P.contrast(fc, chrome.footerBg) >= 3 ? fc : (P.isDark(chrome.footerBg) ? '#e5e5e5' : '#1c1917');
  }

  // ── skin: the design's title sizes, fluid ──
  const heads = (facts.texts || []).filter((t) => t.kind === 'heading' && t.size > 0);
  const sizeAt = (lvl) => median(heads.filter((t) => t.level === lvl).map((t) => t.size * (1366 / width)));
  const rules = [];
  const fluid = (sel, px, minRem) => {
    if (!(px > 0)) return;
    const max = Math.min(6.5, px / 16);
    const min = Math.min(max, Math.max(minRem, max * 0.5));
    const vw = Math.round((px / 1366) * 1000) / 10;
    rules.push(`${sel} { font-size: clamp(${rem(min)}, ${vw}vw, ${rem(max)}); line-height: 1.12; }`);
  };
  fluid('h1', sizeAt(1), 2);
  fluid('h2', sizeAt(2), 1.6);
  fluid('h3', sizeAt(3), 1.25);
  const upperHeads = heads.filter((t) => t.upper).length > heads.length * 0.6;
  if (upperHeads) rules.push('h1, h2, h3 { letter-spacing: 0.02em; }');
  rules.push('.bent-text p { line-height: 1.6; }');

  const brand = life.brand && life.brand.text;
  const name = ((brand || puppet.site.title || 'העיצוב').slice(0, 60) + ' · ' + (puppet.source === 'figma' ? 'Figma' : 'Canva')).trim();
  const overrides = {
    colors,
    fonts,
    style,
    layout,
    background: { kind: 'solid', angle: 160 },
    chrome,
    skin: { css: rules.join('\n'), note: 'טיפוגרפיה מהעיצוב המקורי (ג׳פטו)' }
  };
  const { serializeTheme } = require('../bentml/theme-dialect');
  const bent = serializeTheme({ name, overrides });
  return { overrides, bent, name, fontMap, palette: colors };
}

module.exports = { extractLook, saturation };
