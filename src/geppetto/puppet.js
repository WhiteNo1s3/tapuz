'use strict';

/**
 * The puppet — what a design tool's site is before Geppetto gives it a life.
 *
 * Ben: "they are imported nonsense, we make a life in them, like Pinocchio and
 * Geppetto." A Canva website and a Figma site both publish a DESIGN: boxes at
 * coordinates, runs of styled text, pictures behind pictures. Every decoder in
 * src/geppetto/ (canva.js: the app blob and the static export; figma.js: the
 * Sites bundle and the REST file) reads its source into this ONE shape, and
 * life.js (Geppetto) turns that shape into real Tapuziel modules — sections,
 * rows, heroes, buttons, cards, a menu, a theme. A decoder never emits
 * BenTML; Geppetto never reads Canva or Figma.
 *
 * Units: design pixels of the source canvas (Canva: 1366 wide; Figma: the
 * desktop breakpoint / frame width). Coordinates of every node are ABSOLUTE
 * within its section (top-left of the section = 0,0) — group transforms are
 * already flattened by the decoder, so geometry is one coordinate system.
 *
 * puppet = {
 *   kind: 'puppet', version: 1,
 *   source: 'canva' | 'figma',
 *   format: 'canva-app' | 'canva-static' | 'figma-sites' | 'figma-file',
 *   origin: 'https://name.my.canva.site/'        (where it was read from; '' for a file)
 *   site: { title, description, lang, dir: 'ltr'|'rtl', favicon, socialImage },
 *   fonts: { <fontKey>: { family: 'Arimo', weights: [400, 700], italic: bool } },
 *   palette: ['#hex', …]                          (design tokens when the source has them)
 *   pages: [PuppetPage],
 *   notes: ['…']                                  (what a decoder skipped or guessed)
 * }
 *
 * PuppetPage = {
 *   key,                   stable id (the source's page / document id)
 *   path: '/' | '/about',  where the page lives on the source site
 *   title, name,           title = <title>/SEO; name = the page's own label
 *   description,
 *   width,                 design canvas width in px
 *   sections: [PuppetSection]
 * }
 *
 * PuppetSection = {
 *   key,                   stable id
 *   anchor,                what the source's own links call it ('page-2', a frame name…)
 *   name,                  the section's label, when the source has one
 *   height,                px
 *   fill: { color: '#hex'|null, gradient: 'linear-gradient(…)'|null,
 *           image: { src, fit: 'cover'|'contain', opacity }|null,
 *           video: { src, poster }|null },
 *   layout: FlowLayout|null   (Figma: the section frame's auto-layout)
 *   nodes: [Node]           paint order = array order (last is on top)
 * }
 *
 * Node — every kind carries:
 *   { id, type, x, y, w, h,             absolute within the section
 *     z,                                paint order across the section (higher = on top)
 *     rotate?,                          degrees
 *     opacity?,                         0..1 (absent = 1)
 *     link?: { href, newTab?, page?, anchor? }   page = a PuppetPage.key on this site,
 *                                                 anchor = a PuppetSection.anchor
 *     role?,                            the source's own hint: 'title' | 'subtitle' | 'heading'
 *                                       | 'paragraph' | 'caption' | 'button' | 'nav' | 'logo'
 *                                       | 'decoration' | 'h1'…'h6' | 'p' | 'li' | 'a'
 *     name?, alt?,                      layer name, alternative text
 *     anim?: 'fade' | 'rise' | 'zoom',  entrance animation (Tapuziel's own names)
 *     mobile?: { order?, hidden?, x?, y?, w?, h? }   the source's own phone layout
 *   }
 *
 *   type 'text':   paragraphs: [{ align: 'start'|'center'|'end'|'justify', list: null|'bullet'|'number',
 *                                 runs: [{ text, bold?, italic?, underline?, strike?, upper?,
 *                                          color?, size?, font?, href?, weight? }] }]
 *                  (size in design px; font = a key of puppet.fonts)
 *   type 'image':  src (absolute URL), fit?: 'cover'|'contain', radius?, mask?: 'circle'|'rounded'|'shape',
 *                  svg?: bool, natural?: { w, h }
 *   type 'video':  src, poster?, autoplay?, loop?, muted?
 *   type 'shape':  fill?: { color?, gradient?, image?: { src, fit } }, stroke?: { color, width },
 *                  radius?, shape?: 'rect'|'ellipse'|'path', children?: [Node] (text set inside the shape)
 *   type 'line':   color?, width? (stroke px)
 *   type 'group':  children: [Node]   (a designer's grouping — a card, a button, a logo lockup)
 *   type 'frame':  children: [Node], layout?: FlowLayout, fill?, radius?, stroke?, clip?
 *   type 'embed':  url, html?, provider?
 *
 * FlowLayout = { mode: 'row'|'column'|'grid'|'none', gap?, padding?: [t, r, b, l],
 *                align?: 'start'|'center'|'end'|'stretch'|'baseline',
 *                justify?: 'start'|'center'|'end'|'between', wrap?, columns? }
 */

const PUPPET_VERSION = 1;
const NODE_TYPES = new Set(['text', 'image', 'video', 'shape', 'line', 'group', 'frame', 'embed']);
const SOURCES = new Set(['canva', 'figma']);
const FORMATS = new Set(['canva-app', 'canva-static', 'figma-sites', 'figma-file']);

function makePuppet({ source, format, origin = '', site = {}, fonts = {}, palette = [], pages = [], notes = [] } = {}) {
  return {
    kind: 'puppet',
    version: PUPPET_VERSION,
    source,
    format,
    origin,
    site: {
      title: site.title || '',
      description: site.description || '',
      lang: site.lang || '',
      dir: site.dir === 'rtl' ? 'rtl' : site.dir === 'ltr' ? 'ltr' : '',
      favicon: site.favicon || '',
      socialImage: site.socialImage || ''
    },
    fonts,
    palette,
    pages,
    notes
  };
}

// ── colors ────────────────────────────────────────────────────────────────

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/**
 * Any color a design tool writes → { hex: '#rrggbb', alpha } or null.
 * Accepts '#rgb', '#rgba', '#rrggbb', '#rrggbbaa', 'rgb()', 'rgba()', a
 * Figma { r, g, b, a } in 0..1, and a few CSS names design exports use.
 */
function parseColor(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'object') {
    const { r, g, b } = input;
    if ([r, g, b].some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
    const a = typeof input.a === 'number' ? input.a : 1;
    return { hex: '#' + hex2(r * 255) + hex2(g * 255) + hex2(b * 255), alpha: a };
  }
  const s = String(input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const alpha = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return { hex: '#' + h.slice(0, 6), alpha };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    let a = 1;
    if (m[4] != null) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex: '#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]), alpha: a };
  }
  const NAMED = { white: '#ffffff', black: '#000000', transparent: null };
  if (s in NAMED) return NAMED[s] ? { hex: NAMED[s], alpha: 1 } : { hex: '#000000', alpha: 0 };
  return null;
}

/** '#rrggbb' or null — the alpha dropped (callers that care use parseColor). */
function toHex(input) {
  const c = parseColor(input);
  return c && c.alpha > 0 ? c.hex : null;
}

function rgbOf(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return [0, 0, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Blend a toward b by t (0..1). */
function mix(a, b, t) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return '#' + A.map((v, i) => hex2(v + (B[i] - v) * t)).join('');
}

/** Straight-line RGB distance, 0..441. */
function colorDistance(a, b) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return Math.sqrt(A.reduce((s, v, i) => s + (v - B[i]) * (v - B[i]), 0));
}

function isDark(hex) {
  return luminance(hex) < 0.35;
}

// ── geometry ──────────────────────────────────────────────────────────────

const right = (n) => n.x + n.w;
const bottom = (n) => n.y + n.h;
const area = (n) => Math.max(0, n.w) * Math.max(0, n.h);

function intersection(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(right(a), right(b)) - x;
  const h = Math.min(bottom(a), bottom(b)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Share of b's area that lies inside a (0..1). */
function coverage(a, b) {
  const i = intersection(a, b);
  const ab = area(b);
  return i && ab ? area(i) / ab : 0;
}

/** Does a contain b, allowing `tol` px of slack on every side? */
function contains(a, b, tol = 2) {
  return b.x >= a.x - tol && b.y >= a.y - tol && right(b) <= right(a) + tol && bottom(b) <= bottom(a) + tol;
}

function unionBox(list) {
  const items = (list || []).filter((n) => n && n.w > 0 && n.h > 0);
  if (!items.length) return { x: 0, y: 0, w: 0, h: 0 };
  // loops, not Math.min(...spread): a spread of 200,000 numbers overflows the stack
  let x = Infinity; let y = Infinity; let r = -Infinity; let b = -Infinity;
  for (const n of items) {
    if (n.x < x) x = n.x;
    if (n.y < y) y = n.y;
    if (right(n) > r) r = right(n);
    if (bottom(n) > b) b = bottom(n);
  }
  return { x, y, w: r - x, h: b - y };
}

// ── text ──────────────────────────────────────────────────────────────────

function plainText(node) {
  if (!node) return '';
  if (node.type === 'text') {
    return (node.paragraphs || [])
      .map((p) => (p.runs || []).map((r) => r.text || '').join(''))
      .join('\n')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  }
  const kids = node.children || [];
  return kids.map(plainText).filter(Boolean).join('\n');
}

/**
 * The run that "is" the text: the style carried by the most characters.
 * → { size, color, font, bold, italic, upper, weight }
 */
function dominantStyle(node) {
  const tally = new Map();
  for (const p of node.paragraphs || []) {
    for (const r of p.runs || []) {
      const len = String(r.text || '').replace(/\s+/g, '').length;
      if (!len) continue;
      const key = [r.size || 0, r.color || '', r.font || '', r.bold ? 1 : 0, r.italic ? 1 : 0, r.upper ? 1 : 0, r.weight || 0].join('|');
      const cur = tally.get(key) || { n: 0, run: r };
      cur.n += len;
      tally.set(key, cur);
    }
  }
  let best = null;
  for (const v of tally.values()) if (!best || v.n > best.n) best = v;
  const r = best ? best.run : {};
  return {
    size: r.size || 0,
    color: r.color || null,
    font: r.font || null,
    bold: !!r.bold || (r.weight || 0) >= 600,
    italic: !!r.italic,
    upper: !!r.upper,
    weight: r.weight || (r.bold ? 700 : 400)
  };
}

function dominantAlign(node) {
  const n = { start: 0, center: 0, end: 0, justify: 0 };
  for (const p of node.paragraphs || []) {
    const len = (p.runs || []).reduce((s, r) => s + String(r.text || '').length, 0);
    n[p.align in n ? p.align : 'start'] += len;
  }
  return Object.keys(n).reduce((a, b) => (n[b] > n[a] ? b : a), 'start');
}

// ── walking ───────────────────────────────────────────────────────────────

/** Visit every node, children included (depth-first, paint order). */
function eachNode(nodes, fn, depth = 0, parent = null) {
  for (const n of nodes || []) {
    fn(n, depth, parent);
    if (Array.isArray(n.children)) eachNode(n.children, fn, depth + 1, n);
  }
}

function countNodes(puppet) {
  let n = 0;
  for (const p of puppet.pages || []) for (const s of p.sections || []) eachNode(s.nodes, () => { n += 1; });
  return n;
}

/**
 * Structural sanity check used by the smokes and by the import door before
 * Geppetto runs: a decoder bug should say what is wrong, not crash later.
 * @returns {string[]} issues (empty = a sound puppet)
 */
function validatePuppet(p) {
  const issues = [];
  if (!p || p.kind !== 'puppet') return ['not a puppet'];
  if (p.version !== PUPPET_VERSION) issues.push('version ' + p.version + ' ≠ ' + PUPPET_VERSION);
  if (!SOURCES.has(p.source)) issues.push('source "' + p.source + '"');
  if (!FORMATS.has(p.format)) issues.push('format "' + p.format + '"');
  if (!Array.isArray(p.pages) || !p.pages.length) issues.push('no pages');
  const pageKeys = new Set();
  (p.pages || []).forEach((page, pi) => {
    const at = 'pages[' + pi + ']';
    if (!page.key) issues.push(at + ' has no key');
    if (pageKeys.has(page.key)) issues.push(at + ' duplicate key ' + page.key);
    pageKeys.add(page.key);
    if (typeof page.path !== 'string' || page.path[0] !== '/') issues.push(at + ' path "' + page.path + '"');
    if (!(page.width > 0)) issues.push(at + ' width ' + page.width);
    if (!Array.isArray(page.sections)) { issues.push(at + ' sections missing'); return; }
    page.sections.forEach((s, si) => {
      const sat = at + '.sections[' + si + ']';
      if (!(s.height >= 0)) issues.push(sat + ' height ' + s.height);
      if (!s.fill || typeof s.fill !== 'object') issues.push(sat + ' fill missing');
      eachNode(s.nodes, (n) => {
        if (!NODE_TYPES.has(n.type)) issues.push(sat + ' node type "' + n.type + '"');
        for (const k of ['x', 'y', 'w', 'h']) {
          if (typeof n[k] !== 'number' || !Number.isFinite(n[k])) issues.push(sat + ' node ' + (n.id || '?') + ' ' + k + '=' + n[k]);
        }
        if (n.type === 'text' && !Array.isArray(n.paragraphs)) issues.push(sat + ' text ' + n.id + ' without paragraphs');
        if ((n.type === 'image' || n.type === 'video') && !n.src) issues.push(sat + ' ' + n.type + ' ' + n.id + ' without src');
        if ((n.type === 'group' || n.type === 'frame') && !Array.isArray(n.children)) issues.push(sat + ' ' + n.type + ' ' + n.id + ' without children');
      });
    });
  });
  return issues;
}

module.exports = {
  PUPPET_VERSION,
  NODE_TYPES,
  makePuppet,
  validatePuppet,
  parseColor,
  toHex,
  luminance,
  contrast,
  mix,
  colorDistance,
  isDark,
  right,
  bottom,
  area,
  intersection,
  coverage,
  contains,
  unionBox,
  plainText,
  dominantStyle,
  dominantAlign,
  eachNode,
  countNodes
};
