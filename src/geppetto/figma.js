'use strict';

/**
 * Figma → the puppet. Three doors, one node mapper.
 *
 * Figma publishes a design in two shapes and this file reads both into the
 * puppet (src/geppetto/puppet.js) so Geppetto never has to know Figma:
 *
 *   1. Figma Sites. A published site (`*.figma.site` or a custom domain) boots
 *      `new SitesRuntime({ bundleId, assetsVersion: 'v11', videosVersion: 'v1',
 *      fontsVersion: 'v1', isFigmake, … })` and fetches
 *      `/_json/<bundleId>/_index.json` for the page it serves and
 *      `/_json/<bundleId><path>.json` for every other page of the site
 *      (`guidToUrl` lists them). The bundle IS the REST node schema, flattened:
 *      `nodeById` (children are id arrays), `roots` (this page's WEBPAGE),
 *      `assets` (hash → file name, '.svg' for vectors), `fonts`, `siteSettings`,
 *      plus what only Sites has: breakpoint frames (`isBreakpointFrame`, one
 *      WEBPAGE child per width), `accessibleHTMLTag`, an interaction dialect of
 *      its own (`event.interactionType` + `connectionType`), `behaviors.appear`,
 *      GRID auto-layout, and INSTANCE children stored as STABLE PATHS
 *      (`I<instance>;<component child>`) whose nodes live under the main
 *      COMPONENT, with the instance's `overrides` keyed by name-paths
 *      (`['About0']` = the first child named "About"). Every one of those facts
 *      was read off real published bundles, not off the docs.
 *
 *   2. The REST file (GET /v1/files/:key) and the Tapuziel plugin export
 *      (integrations/figma-plugin — same field names, children nested, pictures
 *      as data: URLs): no breakpoints, a page is a top-level frame at least
 *      900 px wide, the phone variant is a narrow frame with a matching name.
 *
 * The mapper is one function for all doors: a node's box is its
 * absoluteBoundingBox minus the SECTION's origin (group transforms are already
 * flat in Figma's absolute coordinates), paint order is array order, and
 * everything the source knows — text runs, links, auto-layout, fills, phone
 * layout, role hints — is written into the puppet, because a fact that stops
 * here is lost for good. What the decoder cannot read it says in
 * `puppet.notes`.
 */

const { makePuppet, parseColor } = require('./puppet');

// ── small helpers ─────────────────────────────────────────────────────────

// Built with fromCharCode so no editor ever turns an escape into a raw byte.
const LINE_SEP = String.fromCharCode(0x2028);
const RTL_LETTERS = new RegExp('[' + String.fromCharCode(0x0590) + '-' + String.fromCharCode(0x08ff) + ']', 'g');
const LTR_LETTERS = /[A-Za-z]/g;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const width = (n) => (n && n.absoluteBoundingBox ? num(n.absoluteBoundingBox.width) : 0);

function slug(name, fallback = 'section') {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

/** '/menu-drinks-spirits' → 'Menu Drinks Spirits' */
function humanize(path) {
  const last = String(path || '').split('/').filter(Boolean).pop() || '';
  return last
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function uniqueIn(used, base) {
  let s = base;
  let i = 2;
  while (used.has(s)) s = base + '-' + i++;
  used.add(s);
  return s;
}

function sameKey(a, b) {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

// ── colors, paints, effects ───────────────────────────────────────────────

/** { hex, alpha } → '#rrggbb' or 'rgba(r,g,b,a)' — the alpha is kept because a
 * 40% black over a hero photo is a tint, and dropping it makes a black box. */
function cssColor(c) {
  if (!c) return null;
  if (c.alpha >= 0.995) return c.hex;
  const h = c.hex.slice(1);
  return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + r2(c.alpha) + ')';
}

function paintColor(paint) {
  if (!paint || paint.type !== 'SOLID') return null;
  const c = parseColor(paint.color);
  if (!c) return null;
  const alpha = c.alpha * num(paint.opacity, 1);
  return alpha > 0 ? cssColor({ hex: c.hex, alpha }) : null;
}

function visiblePaints(list) {
  return (Array.isArray(list) ? list : []).filter((p) => isObj(p) && p.visible !== false && num(p.opacity, 1) > 0);
}

function firstSolid(list) {
  return visiblePaints(list).find((p) => p.type === 'SOLID') || null;
}

/** Inverse of a Figma 2x3 transform, as a point mapper (u, v) → [x, y]. */
function invert(m) {
  if (!Array.isArray(m) || !Array.isArray(m[0]) || !Array.isArray(m[1])) return null;
  const a = num(m[0][0], 1), b = num(m[0][1]), c = num(m[0][2]);
  const d = num(m[1][0]), e = num(m[1][1], 1), f = num(m[1][2]);
  const det = a * e - b * d;
  if (Math.abs(det) < 1e-9) return null;
  return (u, v) => {
    const x = u - c;
    const y = v - f;
    return [(e * x - b * y) / det, (-d * x + a * y) / det];
  };
}

/**
 * A gradient paint → CSS. The REST file gives `gradientHandlePositions` (start,
 * end, width handle in the node's unit square); a Sites bundle gives the
 * layer→gradient `transform` instead, so the handles are its inverse applied
 * to (0, .5) and (1, .5). The pixel box turns the unit vector into a CSS angle.
 */
function gradientCss(paint, w, h) {
  const stops = (paint.gradientStops || [])
    .map((s) => {
      const c = parseColor(s.color);
      return c ? cssColor({ hex: c.hex, alpha: c.alpha * num(paint.opacity, 1) }) + ' ' + r2(num(s.position) * 100) + '%' : null;
    })
    .filter(Boolean);
  if (!stops.length) return null;
  if (stops.length === 1) stops.push(stops[0]);
  if (paint.type === 'GRADIENT_RADIAL' || paint.type === 'GRADIENT_DIAMOND') return 'radial-gradient(circle, ' + stops.join(', ') + ')';
  if (paint.type === 'GRADIENT_ANGULAR') return 'conic-gradient(' + stops.join(', ') + ')';
  let start = [0, 0.5];
  let end = [1, 0.5];
  const handles = paint.gradientHandlePositions;
  const inv = invert(paint.transform || paint.gradientTransform);
  if (Array.isArray(handles) && handles.length >= 2 && isObj(handles[0]) && isObj(handles[1])) {
    start = [num(handles[0].x), num(handles[0].y, 0.5)];
    end = [num(handles[1].x, 1), num(handles[1].y, 0.5)];
  } else if (inv) {
    start = inv(0, 0.5);
    end = inv(1, 0.5);
  }
  const dx = (end[0] - start[0]) * (w > 0 ? w : 1);
  const dy = (end[1] - start[1]) * (h > 0 ? h : 1);
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (!Number.isFinite(deg)) deg = 180;
  deg = ((Math.round(deg) % 360) + 360) % 360;
  return 'linear-gradient(' + deg + 'deg, ' + stops.join(', ') + ')';
}

const FIT = { FILL: 'cover', FIT: 'contain', STRETCH: 'cover', TILE: 'cover' };

/** STRETCH + imageTransform is Figma's "crop": the visible window of the
 * picture as fractions of it (the runtime computes exactly this). */
function cropOf(paint) {
  const m = paint.imageTransform;
  if (paint.scaleMode !== 'STRETCH' || !Array.isArray(m) || !Array.isArray(m[0]) || !Array.isArray(m[1])) return null;
  const sx = num(m[0][0], 1) || 1;
  const sy = num(m[1][1], 1) || 1;
  const crop = { x: r2(-num(m[0][2]) / sx), y: r2(-num(m[1][2]) / sy), w: r2(1 / sx), h: r2(1 / sy) };
  return crop.w === 1 && crop.h === 1 && crop.x === 0 && crop.y === 0 ? null : crop;
}

/**
 * A node's fills → the section/frame fill shape { color, gradient, image, video }.
 * Figma paints stack bottom→top; the bottom solid is the color, the top image is
 * the picture, and a gradient anywhere becomes the overlay tint.
 */
function fillOf(n, ctx, box) {
  const paints = visiblePaints(n.fills);
  const out = { color: null, gradient: null, image: null, video: null };
  for (const p of paints) {
    if (p.type === 'SOLID') { if (!out.color) out.color = paintColor(p); continue; }
    if (typeof p.type === 'string' && p.type.startsWith('GRADIENT')) { out.gradient = gradientCss(p, box ? box.w : 0, box ? box.h : 0); continue; }
    if (p.type === 'IMAGE') {
      const src = ctx.assetUrl(p.imageRef);
      if (src) out.image = { src, fit: FIT[p.scaleMode] || 'cover', opacity: r2(num(p.opacity, 1)) };
      else ctx.count('imageMissing');
      continue;
    }
    if (p.type === 'VIDEO') {
      const src = ctx.videoUrl(p.videoRef);
      if (src) out.video = { src, poster: ctx.posterUrl(p.imageRef) };
      else ctx.count('videoMissing');
    }
  }
  return out;
}

function strokeOf(n) {
  const p = firstSolid(n.strokes);
  if (!p) return null;
  let w = num(n.strokeWeight);
  if (isObj(n.individualStrokeWeights)) w = Math.max(w, ...Object.values(n.individualStrokeWeights).map((v) => num(v)));
  const color = paintColor(p);
  return color && w > 0 ? { color, width: r2(w) } : null;
}

/** → { radius, radii? } — radii only when the corners differ. */
function radiusOf(n) {
  const arr = Array.isArray(n.rectangleCornerRadii) && n.rectangleCornerRadii.length === 4 ? n.rectangleCornerRadii.map((v) => num(v)) : null;
  if (arr && arr.some((v) => v > 0)) {
    const uniform = arr.every((v) => v === arr[0]);
    return uniform ? { radius: r2(arr[0]) } : { radius: r2(Math.max(...arr)), radii: arr.map(r2) };
  }
  const r = num(n.cornerRadius);
  return r > 0 ? { radius: r2(r) } : null;
}

/** DROP_SHADOW → a CSS box-shadow; the blurs → their radii. */
function effectsOf(n) {
  const out = {};
  const shadows = [];
  for (const e of Array.isArray(n.effects) ? n.effects : []) {
    if (!isObj(e) || e.visible === false) continue;
    if (e.type === 'DROP_SHADOW') {
      const c = parseColor(e.color);
      if (c) shadows.push(r2(num(e.offset && e.offset.x)) + 'px ' + r2(num(e.offset && e.offset.y)) + 'px ' + r2(num(e.radius)) + 'px ' + r2(num(e.spread)) + 'px ' + cssColor(c));
    } else if (e.type === 'LAYER_BLUR' && num(e.radius) > 0) out.blur = r2(e.radius);
    else if (e.type === 'BACKGROUND_BLUR' && num(e.radius) > 0) out.backdropBlur = r2(e.radius);
  }
  if (shadows.length) out.shadow = shadows.join(', ');
  return out;
}

// ── layout ────────────────────────────────────────────────────────────────

const ALIGN = { MIN: 'start', CENTER: 'center', MAX: 'end', BASELINE: 'baseline', STRETCH: 'stretch' };
const JUSTIFY = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'between' };
const ALIGN_H = { LEFT: 'start', CENTER: 'center', RIGHT: 'end', JUSTIFIED: 'justify' };

/** Auto-layout → FlowLayout (null when the frame is free-form). */
function layoutOf(n) {
  const mode = n.layoutMode === 'HORIZONTAL' ? 'row' : n.layoutMode === 'VERTICAL' ? 'column' : n.layoutMode === 'GRID' ? 'grid' : null;
  if (!mode) return null;
  const L = { mode };
  const gap = mode === 'grid' ? num(n.gridColumnGap, num(n.itemSpacing)) : num(n.itemSpacing);
  if (gap) L.gap = r2(gap);
  const rowGap = mode === 'grid' ? num(n.gridRowGap) : n.layoutWrap === 'WRAP' ? num(n.counterAxisSpacing) : 0;
  if (rowGap) L.rowGap = r2(rowGap);
  const pad = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((v) => r2(num(v)));
  if (pad.some(Boolean)) L.padding = pad;
  if (n.counterAxisAlignItems in ALIGN) L.align = ALIGN[n.counterAxisAlignItems];
  if (n.primaryAxisAlignItems in JUSTIFY) L.justify = JUSTIFY[n.primaryAxisAlignItems];
  if (n.layoutWrap === 'WRAP') L.wrap = true;
  if (mode === 'grid' && num(n.gridColumnCount) > 0) L.columns = n.gridColumnCount;
  return L;
}

// ── text ──────────────────────────────────────────────────────────────────

// Order matters: "Semi Bold" and "Extra Light" must win over "Bold" / "Light".
const WEIGHT_WORDS = [
  [/hairline|\bthin\b/, 100],
  [/extra ?light|ultra ?light/, 200],
  [/\blight\b/, 300],
  [/\bmedium\b/, 500],
  [/semi ?bold|demi ?bold|semibold/, 600],
  [/extra ?bold|ultra ?bold|\bheavy\b/, 800],
  [/\bblack\b/, 900],
  [/\bbold\b/, 700]
];

/** 'Semi Bold Italic' → 600; the Sites bundle carries no fontWeight, only names. */
function weightFromStyleName(name) {
  const s = String(name || '').toLowerCase();
  for (const [re, w] of WEIGHT_WORDS) if (re.test(s)) return w;
  return 400;
}

function weightOf(style, ctx) {
  if (num(style.fontWeight) > 0) return style.fontWeight;
  const hint = ctx.fontHint(style.fontFamily, style.fontStyle);
  if (hint && num(hint.weight) > 0) return hint.weight;
  if (isObj(style.fontVariations) && num(style.fontVariations.Weight) > 0) return Math.round(style.fontVariations.Weight);
  return weightFromStyleName(style.fontStyle);
}

function italicOf(style, ctx) {
  if (style.italic === true) return true;
  if (/italic|oblique/i.test(String(style.fontStyle || ''))) return true;
  const hint = ctx.fontHint(style.fontFamily, style.fontStyle);
  return !!(hint && hint.italic);
}

/**
 * The font size that applies at this page width. A Sites text style can carry
 * `responsiveTextStyleVariants` (ascending min-width media queries in the
 * runtime); the base `fontSize` is not always the desktop one, so the variant
 * with the largest minWidth ≤ pageWidth wins.
 */
function sizeOf(style, pageWidth) {
  let size = num(style.fontSize);
  const variants = Array.isArray(style.responsiveTextStyleVariants) ? style.responsiveTextStyleVariants : [];
  let best = null;
  for (const v of variants) {
    if (!isObj(v) || !isObj(v.style) || !(num(v.style.fontSize) > 0)) continue;
    if (num(v.minWidth) <= pageWidth && (!best || num(v.minWidth) >= num(best.minWidth))) best = v;
  }
  if (best) size = best.style.fontSize;
  return size > 0 ? r2(size) : 0;
}

/** A text hyperlink → href ('/about' for a page, '#anchor' for a section). */
function hyperlinkHref(h, ctx) {
  if (!isObj(h)) return null;
  if (h.type === 'URL' && h.url) return normalizeUrl(h.url);
  if (h.type === 'NODE' && h.nodeID) {
    const id = String(h.nodeID);
    if (id[0] === '/') return id;
    const path = ctx.pathOfNode(id);
    if (path) return path;
    const anchor = ctx.anchorByNode.get(id);
    return anchor ? '#' + anchor : null;
  }
  return null;
}

function makeRun(text, st, color, ctx) {
  const run = { text };
  const size = sizeOf(st, ctx.pageWidth);
  if (size) run.size = size;
  const weight = weightOf(st, ctx);
  const italic = italicOf(st, ctx);
  if (st.fontFamily) {
    const key = ctx.font(st.fontFamily, weight, italic, st.fontStyle);
    if (key) run.font = key;
  }
  if (weight) run.weight = weight;
  if (weight >= 600) run.bold = true;
  if (italic) run.italic = true;
  if (st.textDecoration === 'UNDERLINE') run.underline = true;
  if (st.textDecoration === 'STRIKETHROUGH') run.strike = true;
  if (st.textCase === 'UPPER') run.upper = true;
  if (color) run.color = color;
  const href = hyperlinkHref(st.hyperlink, ctx);
  if (href) run.href = href;
  return run;
}

/** One line of characters → runs, grouping consecutive characters that share a
 * style-override index (`characterStyleOverrides` is one int per UTF-16 unit). */
function runsOf(text, start, overrides, table, base, baseColor, ctx) {
  const runs = [];
  let i = 0;
  while (i < text.length) {
    const idx = num(overrides[start + i]);
    let j = i + 1;
    while (j < text.length && num(overrides[start + j]) === idx) j++;
    const ov = idx && isObj(table[idx]) ? table[idx] : null;
    const st = ov ? Object.assign({}, base, ov) : base;
    const color = ov && Array.isArray(ov.fills) ? paintColor(firstSolid(ov.fills)) || baseColor : baseColor;
    runs.push(makeRun(text.slice(i, j), st, color, ctx));
    i = j;
  }
  if (!runs.length) runs.push(makeRun('', base, baseColor, ctx));
  return runs;
}

/**
 * TEXT → paragraphs. '\n' ends a paragraph (and indexes `lineTypes`,
 * `lineIndentations`); U+2028 is a soft break inside one, kept as its own
 * paragraph with the same list type so nothing runs together.
 */
function paragraphsOf(n, ctx) {
  const chars = String(n.characters || '');
  const base = isObj(n.style) ? n.style : {};
  const overrides = Array.isArray(n.characterStyleOverrides) ? n.characterStyleOverrides : [];
  const table = isObj(n.styleOverrideTable) ? n.styleOverrideTable : {};
  const baseColor = paintColor(firstSolid(n.fills));
  const lineTypes = Array.isArray(n.lineTypes) ? n.lineTypes : [];
  const indents = Array.isArray(n.lineIndentations) ? n.lineIndentations : [];
  const align = ALIGN_H[base.textAlignHorizontal] || 'start';
  const paras = [];
  let pos = 0;
  chars.split('\n').forEach((line, li) => {
    const list = lineTypes[li] === 'ORDERED' ? 'number' : lineTypes[li] === 'UNORDERED' ? 'bullet' : null;
    const parts = line.split(LINE_SEP);
    parts.forEach((part, pi) => {
      const p = { align, list, runs: runsOf(part, pos, overrides, table, base, baseColor, ctx) };
      if (num(indents[li]) > 0) p.indent = indents[li];
      paras.push(p);
      pos += part.length + (pi < parts.length - 1 ? 1 : 0);
    });
    pos += 1;
  });
  return paras;
}

// ── links ─────────────────────────────────────────────────────────────────

function normalizeUrl(url) {
  const s = String(url || '').trim();
  if (!s) return null;
  if (/^(https?:|mailto:|tel:|sms:|whatsapp:|#|\/)/i.test(s)) return s;
  return 'https://' + s;
}

function tnid(a) {
  const t = a.transitionNodeID;
  if (isObj(t) && t.sessionID != null) return t.sessionID + ':' + t.localID;
  return typeof t === 'string' ? t : null;
}

/** Every action the source runs on a click, in either dialect (Sites: `event` +
 * `connectionType`; REST / plugin: `trigger` + `type`; legacy `transitionNodeID`). */
function clickActions(n) {
  const out = [];
  for (const it of Array.isArray(n.interactions) ? n.interactions : []) {
    if (!isObj(it)) continue;
    const trig = isObj(it.event) ? it.event.interactionType : isObj(it.trigger) ? it.trigger.type : null;
    if (trig !== 'ON_CLICK' && trig !== 'ON_PRESS' && trig !== 'MOUSE_UP') continue;
    const acts = Array.isArray(it.actions) ? it.actions : isObj(it.action) ? [it.action] : [];
    for (const a of acts) if (isObj(a)) out.push(a);
  }
  if (!out.length && typeof n.transitionNodeID === 'string' && n.transitionNodeID) out.push({ type: 'NODE', destinationId: n.transitionNodeID, navigation: 'NAVIGATE' });
  return out;
}

function pageLink(path, ctx) {
  const link = { href: path };
  const key = ctx.pageKeyOf(path);
  if (key) link.page = key;
  return link;
}

/** A scroll-to target is resolved after the page is built (the target may sit
 * in a later section): the link is registered and patched by resolveAnchors. */
function anchorLink(id, ctx) {
  const link = { href: '#' };
  ctx.pendingAnchors.push({ link, id });
  return link;
}

function linkOf(n, ctx) {
  for (const a of clickActions(n)) {
    if (a.connectionType === 'URL') {
      const href = normalizeUrl(a.connectionURL);
      if (href) return a.openUrlInNewTab ? { href, newTab: true } : { href };
      continue;
    }
    if (a.connectionType === 'INTERNAL_NODE') {
      if (a.navigationType === 'NAVIGATE') {
        const url = String(a.connectionURL || '');
        if (/^https?:/i.test(url)) return a.openUrlInNewTab ? { href: url, newTab: true } : { href: url };
        const path = url[0] === '/' ? url : ctx.pathOfNode(tnid(a));
        if (path) return pageLink(path, ctx);
      } else if (a.navigationType === 'SCROLL_TO') {
        const id = tnid(a);
        if (id) return anchorLink(id, ctx);
      }
      continue;
    }
    if (a.type === 'URL' && a.url) {
      const href = normalizeUrl(a.url);
      if (href) return a.openInNewTab ? { href, newTab: true } : { href };
      continue;
    }
    if (a.type === 'NODE' && a.destinationId) {
      const id = String(a.destinationId);
      if (a.navigation === 'SCROLL_TO') return anchorLink(id, ctx);
      if (!a.navigation || a.navigation === 'NAVIGATE') {
        const path = ctx.pathOfNode(id);
        return path ? pageLink(path, ctx) : anchorLink(id, ctx);
      }
    }
  }
  return null;
}

function resolveAnchors(ctx, nodesWithLinks) {
  for (const { link, id } of ctx.pendingAnchors) {
    const anchor = ctx.anchorByNode.get(id);
    if (anchor) {
      link.href = '#' + anchor;
      link.anchor = anchor;
    } else {
      link.href = null;
    }
  }
  for (const node of nodesWithLinks) if (node.link && !node.link.href) delete node.link;
  ctx.pendingAnchors.length = 0;
}

// ── the node mapper ───────────────────────────────────────────────────────

const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET', 'SECTION', 'TRANSFORM_GROUP']);
const VECTOR_TYPES = new Set(['SVG', 'VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON', 'REGULAR_POLYGON']);
const SHAPE_TYPES = new Set(['RECTANGLE', 'ELLIPSE', 'ROUNDED_RECTANGLE']);
const CODE_TYPES = new Set(['CODE_INSTANCE', 'CODE_COMPONENT']);
const SILENT_TYPES = new Set(['VARIABLE', 'VARIABLE_COLLECTION', 'STYLE', 'SLICE']);
const FOREIGN_TYPES = new Set(['STICKY', 'SHAPE_WITH_TEXT', 'CONNECTOR', 'WIDGET', 'EMBED', 'LINK_UNFURL', 'MEDIA', 'TABLE', 'TABLE_CELL', 'WASHI_TAPE', 'CODE_BLOCK', 'TEXT_PATH']);

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'A', 'LI']);
const ROLE_TAGS = { BUTTON: 'button', NAV: 'nav' };
const CHROME_TAGS = new Set(['HEADER', 'FOOTER', 'MAIN', 'SECTION', 'ARTICLE', 'ASIDE', 'NAV', 'DIV', 'UL', 'OL', 'FIGURE']);

/** The CSS rotation (clockwise degrees) a node adds to its parent's. The
 * transform's first column is (cos, sin) of the clockwise angle in Figma's
 * y-down space; the REST `rotation` field is Figma's counter-clockwise degrees. */
function rotationOf(n) {
  const m = n.relativeTransform;
  if (Array.isArray(m) && Array.isArray(m[0]) && Array.isArray(m[1])) {
    const deg = (Math.atan2(num(m[1][0]), num(m[0][0], 1)) * 180) / Math.PI;
    return Math.abs(deg) < 0.05 ? 0 : deg;
  }
  if (typeof n.rotation === 'number' && Number.isFinite(n.rotation) && n.rotation) return -n.rotation;
  return 0;
}

/** The node's box in section coordinates. A rotated node keeps its unrotated
 * size centred on the bounding box, so `rotate` reproduces the footprint. */
function boxOf(n, ctx, parentRot) {
  const bb = n.absoluteBoundingBox;
  if (!isObj(bb)) return null;
  const rot = parentRot + rotationOf(n);
  let x = num(bb.x) - ctx.ox;
  let y = num(bb.y) - ctx.oy;
  let w = num(bb.width);
  let h = num(bb.height);
  if (Math.abs(rot) > 0.5 && isObj(n.size) && num(n.size.x) > 0 && num(n.size.y) > 0) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    w = num(n.size.x);
    h = num(n.size.y);
    x = cx - w / 2;
    y = cy - h / 2;
  }
  return { x: r2(x), y: r2(y), w: r2(w), h: r2(h), rot };
}

function roleOf(n, node) {
  const tag = typeof n.accessibleHTMLTag === 'string' ? n.accessibleHTMLTag : 'AUTO';
  if (HEADING_TAGS.has(tag)) node.role = tag.toLowerCase();
  else if (ROLE_TAGS[tag]) node.role = ROLE_TAGS[tag];
  if (CHROME_TAGS.has(tag)) node.tag = tag.toLowerCase();
  if (n.isDecorativeImage === true && (node.type === 'image' || node.type === 'shape')) node.role = 'decoration';
  const label = n.accessibleLabel || (isObj(n.ariaAttributes) && n.ariaAttributes['aria-label']);
  if (label) node.alt = String(label);
}

/** behaviors.appear → Tapuziel's three entrance names. */
function animOf(n) {
  const a = isObj(n.behaviors) ? n.behaviors.appear : null;
  if (!isObj(a)) return null;
  const s = isObj(a.enterState) ? a.enterState : {};
  const t = isObj(s.transform) ? s.transform : {};
  if (num(t.m00, 1) < 0.98 || num(t.m11, 1) < 0.98) return 'zoom';
  if (Math.abs(num(t.m12)) > 0.5 || Math.abs(num(t.m02)) > 0.5) return 'rise';
  return 'fade';
}

/** The phone layout of this node, when the phone tree has a node at the same
 * name-path: its box in the phone section, its order, or that it is hidden. */
function mobileOf(ctx, st) {
  if (!ctx.phone) return null;
  const m = ctx.phone.get(st.key);
  if (!m) return st.parentMatched ? { hidden: true } : null;
  const out = { x: r2(m.x), y: r2(m.y), w: r2(m.w), h: r2(m.h) };
  if (m.order !== st.idx) out.order = m.order;
  return out;
}

function decorate(node, n, ctx, box, st) {
  if (n.name) node.name = String(n.name);
  if (Math.abs(box.rot) > 0.5) node.rotate = r2(box.rot);
  if (typeof n.opacity === 'number' && n.opacity < 1) node.opacity = r2(Math.max(0, n.opacity));
  const link = linkOf(n, ctx);
  if (link) {
    node.link = link;
    ctx.linked.push(node);
  }
  roleOf(n, node);
  const anim = animOf(n);
  if (anim) node.anim = anim;
  if (n.layoutPositioning === 'ABSOLUTE') node.absolute = true;
  if (num(n.layoutGrow) > 0) node.grow = true;
  if (n.layoutAlign === 'STRETCH') node.stretch = true;
  Object.assign(node, effectsOf(n));
  const mobile = mobileOf(ctx, st);
  if (mobile) node.mobile = mobile;
}

/** Name-paths count VISIBLE siblings only: designers hide one variant per
 * breakpoint ('Card (hidden) | Card' on desktop, the reverse on the phone), so
 * the visible desktop card must meet the visible phone card. */
function visibleKids(n, ctx) {
  return ctx.kids(n).filter((k) => isObj(k) && k.visible !== false);
}

function mapChildren(n, ctx, st) {
  const out = [];
  const seen = {};
  visibleKids(n, ctx).forEach((k, i) => {
    const name = String(k.name || k.type || '');
    const occ = seen[name] || 0;
    seen[name] = occ + 1;
    const key = st.key + '/' + name + '#' + occ;
    const matched = !!(ctx.phone && ctx.phone.has(key));
    const m = mapNode(k, ctx, { rot: st.rot, key, idx: i, parentMatched: st.matched, matched });
    if (m) out.push(m);
  });
  return out;
}

function imageNode(base, n, paint, ctx, box) {
  const src = ctx.assetUrl(paint.imageRef);
  if (!src) {
    ctx.count('imageMissing');
    return null;
  }
  const node = Object.assign(base, { type: 'image', src, fit: FIT[paint.scaleMode] || 'cover' });
  const rad = radiusOf(n);
  if (rad) Object.assign(node, rad);
  if (n.type === 'ELLIPSE') node.mask = 'circle';
  else if (rad) node.mask = 'rounded';
  if (num(paint.originalImageWidth) > 0 && num(paint.originalImageHeight) > 0) node.natural = { w: paint.originalImageWidth, h: paint.originalImageHeight };
  const crop = cropOf(paint);
  if (crop) node.crop = crop;
  if (num(paint.opacity, 1) < 1) node.opacity = r2(num(paint.opacity, 1) * (node.opacity == null ? 1 : node.opacity));
  const above = visiblePaints(n.fills);
  const idx = above.indexOf(paint);
  const overlay = {};
  for (const p of above.slice(idx + 1)) {
    if (p.type === 'SOLID') overlay.color = paintColor(p);
    else if (p.type.startsWith('GRADIENT')) overlay.gradient = gradientCss(p, box.w, box.h);
  }
  if (overlay.color || overlay.gradient) node.overlay = overlay;
  return node;
}

function videoNode(base, n, paint, ctx) {
  const src = ctx.videoUrl(paint.videoRef);
  if (!src) {
    ctx.count('videoMissing');
    return null;
  }
  const node = Object.assign(base, { type: 'video', src, autoplay: !!paint.autoplay, loop: !!paint.mediaLoop, muted: !!paint.muted });
  const poster = ctx.posterUrl(paint.imageRef);
  if (poster) node.poster = poster;
  if (paint.showControls) node.controls = true;
  node.fit = FIT[paint.scaleMode] || 'cover';
  const rad = radiusOf(n);
  if (rad) Object.assign(node, rad);
  return node;
}

function shapeNode(base, n, ctx, box, kind) {
  const fill = fillOf(n, ctx, box);
  const node = Object.assign(base, { type: 'shape', shape: kind });
  const f = {};
  if (fill.color) f.color = fill.color;
  if (fill.gradient) f.gradient = fill.gradient;
  if (fill.image) f.image = { src: fill.image.src, fit: fill.image.fit };
  if (Object.keys(f).length) node.fill = f;
  const stroke = strokeOf(n);
  if (stroke) node.stroke = stroke;
  const rad = radiusOf(n);
  if (rad) Object.assign(node, rad);
  if (!node.fill && !node.stroke) {
    ctx.count('empty');
    return null;
  }
  return node;
}

function lineNode(base, n, box) {
  const stroke = strokeOf(n);
  const node = Object.assign(base, { type: 'line' });
  if (stroke) {
    node.color = stroke.color;
    node.width = stroke.width;
  } else {
    const c = paintColor(firstSolid(n.fills));
    if (c) node.color = c;
  }
  if (node.h === 0) node.h = r2(node.width || 1);
  if (node.w === 0) node.w = r2(node.width || 1);
  return node;
}

/**
 * One Figma node → one puppet node (children included), or null when the
 * source hides it, when it is code, or when nothing of it can be shown.
 */
function mapNode(n, ctx, st) {
  if (!isObj(n)) return null;
  if (n.visible === false) {
    ctx.count('hidden');
    return null;
  }
  const type = String(n.type || '');
  if (SILENT_TYPES.has(type)) return null;
  if (CODE_TYPES.has(type)) {
    ctx.code(n);
    return null;
  }
  if (FOREIGN_TYPES.has(type)) {
    ctx.count('foreign:' + type);
    return null;
  }
  const box = boxOf(n, ctx, st.rot);
  if (!box) {
    ctx.count('nobox');
    return null;
  }
  const base = { id: String(n.id), type: '', x: box.x, y: box.y, w: box.w, h: box.h, z: ctx.z++ };
  let node = null;
  const paints = visiblePaints(n.fills);
  const topImage = paints.filter((p) => p.type === 'IMAGE').pop() || null;
  const topVideo = paints.filter((p) => p.type === 'VIDEO').pop() || null;

  if (type === 'TEXT') {
    node = Object.assign(base, { type: 'text', paragraphs: paragraphsOf(n, ctx) });
    const href = hyperlinkHref(isObj(n.style) ? n.style.hyperlink : null, ctx);
    if (href && !linkOf(n, ctx)) {
      const path = href[0] === '/' ? href : null;
      node.link = path ? pageLink(path, ctx) : { href };
      ctx.linked.push(node);
    }
  } else if (CONTAINER_TYPES.has(type)) {
    const children = mapChildren(n, ctx, { rot: box.rot, key: st.key, matched: st.matched });
    if (!children.length && topVideo) node = videoNode(base, n, topVideo, ctx);
    else if (!children.length && topImage) node = imageNode(base, n, topImage, ctx, box);
    if (!node) {
      node = Object.assign(base, { type: type === 'GROUP' ? 'group' : 'frame', children });
      if (type !== 'GROUP') {
        const layout = layoutOf(n);
        if (layout) node.layout = layout;
        const fill = fillOf(n, ctx, box);
        if (fill.color || fill.gradient || fill.image || fill.video) node.fill = fill;
        const stroke = strokeOf(n);
        if (stroke) node.stroke = stroke;
        const rad = radiusOf(n);
        if (rad) Object.assign(node, rad);
        if (n.clipsContent === true) node.clip = true;
        if (!children.length && !node.fill && !node.stroke) {
          ctx.count('empty');
          return null;
        }
      } else if (!children.length) {
        return null;
      }
    }
  } else if (type === 'LINE' || n.isLine === true) {
    node = lineNode(base, n, box);
  } else if (SHAPE_TYPES.has(type)) {
    if (topVideo) node = videoNode(base, n, topVideo, ctx);
    else if (topImage) node = imageNode(base, n, topImage, ctx, box);
    else node = shapeNode(base, n, ctx, box, type === 'ELLIPSE' ? 'ellipse' : 'rect');
  } else if (VECTOR_TYPES.has(type) || type === 'IMAGE') {
    const ref = n.hash || n.svgRef || (type !== 'IMAGE' && ctx.vectorRef(n));
    const src = ref ? ctx.assetUrl(ref) : null;
    if (src) {
      node = Object.assign(base, { type: 'image', src, fit: 'contain' });
      if (type !== 'IMAGE' && (VECTOR_TYPES.has(type) || /\.svg(\?|$)/i.test(src) || /^data:image\/svg/i.test(src))) node.svg = true;
      const rad = radiusOf(n);
      if (rad) Object.assign(node, rad);
    } else if (type === 'IMAGE') {
      ctx.count('imageMissing');
      return null;
    } else {
      node = shapeNode(base, n, ctx, box, 'path');
    }
  } else {
    ctx.count('foreign:' + (type || '?'));
    return null;
  }
  if (!node) return null;
  decorate(node, n, ctx, box, st);
  return node;
}

// ── sections and pages (shared by the doors) ──────────────────────────────

/** Index the phone tree by name-path: key → { x, y, w, h, order, visible }
 * relative to the phone SECTION it sits in (its depth-1 ancestor). */
function phoneIndex(phoneRoot, ctx) {
  const map = new Map();
  const walk = (n, key, ox, oy, depth) => {
    const seen = {};
    visibleKids(n, ctx).forEach((k, i) => {
      const name = String(k.name || k.type || '');
      const occ = seen[name] || 0;
      seen[name] = occ + 1;
      const k2 = key + '/' + name + '#' + occ;
      const bb = isObj(k.absoluteBoundingBox) ? k.absoluteBoundingBox : { x: ox, y: oy, width: 0, height: 0 };
      const sx = depth === 0 ? num(bb.x) : ox;
      const sy = depth === 0 ? num(bb.y) : oy;
      map.set(k2, { x: num(bb.x) - sx, y: num(bb.y) - sy, w: num(bb.width), h: num(bb.height), order: i });
      if (CONTAINER_TYPES.has(String(k.type)) && depth < 12) walk(k, k2, sx, sy, depth + 1);
    });
  };
  walk(phoneRoot, '', 0, 0, 0);
  return map;
}

/**
 * One top-level child of the page frame → one PuppetSection. A container gives
 * its children; a bare TEXT / RECTANGLE at the top level is a section of one.
 */
function buildSection(s, st, ctx, used, pageTop) {
  const bb = s.absoluteBoundingBox;
  ctx.ox = num(bb.x);
  ctx.oy = num(bb.y);
  ctx.z = 0;
  const anchor = uniqueIn(used, slug(s.name, 'section-' + (st.idx + 1)));
  ctx.anchorByNode.set(String(s.id), anchor);
  const container = CONTAINER_TYPES.has(String(s.type));
  const box = { x: 0, y: 0, w: num(bb.width), h: num(bb.height), rot: 0 };
  const nodes = container ? mapChildren(s, ctx, { rot: rotationOf(s), key: st.key, matched: st.matched }) : [mapNode(s, ctx, { rot: 0, key: st.key, idx: st.idx, parentMatched: true, matched: st.matched })].filter(Boolean);
  const section = {
    key: String(s.id),
    anchor,
    name: String(s.name || ''),
    height: r2(num(bb.height)),
    fill: container ? fillOf(s, ctx, box) : { color: null, gradient: null, image: null, video: null },
    layout: container ? layoutOf(s) : null,
    nodes
  };
  section.y = r2(num(bb.y) - pageTop);
  const anim = container ? animOf(s) : null;
  if (anim) section.anim = anim;
  if (s.scrollBehavior === 'FIXED') section.fixed = true;
  if (s.scrollBehavior === 'STICKY_SCROLLS') section.sticky = true;
  if (typeof s.accessibleHTMLTag === 'string' && CHROME_TAGS.has(s.accessibleHTMLTag)) section.tag = s.accessibleHTMLTag.toLowerCase();
  const mobile = mobileOf(ctx, st);
  if (mobile) section.mobile = mobile.hidden ? { hidden: true } : Object.assign({ order: mobile.order == null ? st.idx : mobile.order }, mobile.h != null ? { height: mobile.h } : {});
  return section;
}

/** The whole page frame as ONE section (an absolute design with no stack). */
function buildWholeSection(frame, ctx, used) {
  const bb = frame.absoluteBoundingBox;
  ctx.ox = num(bb.x);
  ctx.oy = num(bb.y);
  ctx.z = 0;
  const anchor = uniqueIn(used, slug(frame.name, 'page'));
  ctx.anchorByNode.set(String(frame.id), anchor);
  const box = { x: 0, y: 0, w: num(bb.width), h: num(bb.height), rot: 0 };
  return {
    key: String(frame.id),
    anchor,
    name: String(frame.name || ''),
    height: r2(num(bb.height)),
    fill: fillOf(frame, ctx, box),
    layout: layoutOf(frame),
    nodes: mapChildren(frame, ctx, { rot: rotationOf(frame), key: '', matched: !!ctx.phone }),
    y: 0
  };
}

/** Free-form frames built as a stack of full-width bands still read as sections. */
function looksStacked(kids, frameWidth) {
  const vis = kids.filter((k) => k.visible !== false && isObj(k.absoluteBoundingBox));
  if (vis.length < 2 || !vis.every((k) => CONTAINER_TYPES.has(String(k.type)) && width(k) >= frameWidth * 0.9)) return false;
  const sorted = vis.slice().sort((a, b) => num(a.absoluteBoundingBox.y) - num(b.absoluteBoundingBox.y));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].absoluteBoundingBox;
    const cur = sorted[i].absoluteBoundingBox;
    if (num(cur.y) < num(prev.y) + num(prev.height) - Math.max(8, num(prev.height) * 0.1)) return false;
  }
  return true;
}

/** frame → sections (the shared core of both doors). */
function sectionsOf(frame, ctx) {
  const used = new Set();
  const kids = ctx.kids(frame);
  const stacked = frame.layoutMode === 'VERTICAL' || looksStacked(kids, width(frame));
  const tops = stacked ? kids.filter((k) => k.visible !== false && isObj(k.absoluteBoundingBox)) : [];
  if (!tops.length) return [buildWholeSection(frame, ctx, used)];
  if (frame.layoutMode !== 'VERTICAL') ctx.note('page "' + (frame.name || frame.id) + '" has no vertical auto-layout — its full-width children were read as sections');
  const pageTop = num(frame.absoluteBoundingBox.y);
  const seen = {};
  const sections = [];
  tops.forEach((s, i) => {
    const name = String(s.name || s.type || '');
    const occ = seen[name] || 0;
    seen[name] = occ + 1;
    const key = '/' + name + '#' + occ;
    const matched = !!(ctx.phone && ctx.phone.has(key));
    // The breakpoint frame itself always has its phone twin, so a section with
    // no twin is one the designer left out of the phone layout.
    sections.push(buildSection(s, { idx: i, key, matched, parentMatched: !!ctx.phone }, ctx, used, pageTop));
  });
  return sections;
}

/** A per-door context: how to reach children, assets, fonts, pages. */
function baseContext(site, pageWidth) {
  return {
    site,
    pageWidth,
    ox: 0,
    oy: 0,
    z: 0,
    phone: null,
    anchorByNode: new Map(),
    pendingAnchors: [],
    linked: [],
    count: (k) => { site.counts[k] = (site.counts[k] || 0) + 1; },
    note: (s) => { if (!site.notes.includes(s)) site.notes.push(s); },
    code: (n) => {
      const bb = isObj(n.absoluteBoundingBox) ? n.absoluteBoundingBox : null;
      site.code.push(String(n.name || n.codeExportName || 'code') + (bb ? ' ' + Math.round(num(bb.width)) + '×' + Math.round(num(bb.height)) : ''));
    },
    fontHint: () => null,
    vectorRef: () => null,
    videoUrl: () => null,
    posterUrl: () => null,
    pathOfNode: () => null,
    pageKeyOf: (path) => site.pageKeys[path] || null
  };
}

/** puppet.fonts registration shared by the doors (key = the family name). */
function fontRegistrar(site, fileOf) {
  return (family, weight, italic, styleName) => {
    const fam = String(family || '').trim();
    if (!fam) return null;
    const f = site.fonts[fam] || (site.fonts[fam] = { family: fam, weights: [], italic: false });
    if (weight && !f.weights.includes(weight)) {
      f.weights.push(weight);
      f.weights.sort((a, b) => a - b);
    }
    if (italic) f.italic = true;
    const file = fileOf ? fileOf(fam, styleName) : null;
    if (file && file.url) {
      f.files = f.files || [];
      if (!f.files.some((x) => x.url === file.url)) f.files.push(file);
    }
    return fam;
  };
}

function textDirection(pages) {
  let rtl = 0;
  let ltr = 0;
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.type === 'text') {
        for (const p of n.paragraphs) for (const r of p.runs) {
          rtl += (String(r.text).match(RTL_LETTERS) || []).length;
          ltr += (String(r.text).match(LTR_LETTERS) || []).length;
        }
      }
      if (Array.isArray(n.children)) walk(n.children);
    }
  };
  for (const p of pages) for (const s of p.sections) walk(s.nodes);
  if (!rtl && !ltr) return '';
  return rtl > ltr ? 'rtl' : 'ltr';
}

function finishNotes(site) {
  const c = site.counts;
  const notes = site.notes;
  if (site.code.length) {
    const names = site.code.slice(0, 6).join(', ') + (site.code.length > 6 ? ', …' : '');
    notes.push(site.code.length + ' code component' + (site.code.length > 1 ? 's' : '') + ' skipped — a React code component cannot be imported: ' + names);
  }
  if (c.hidden) notes.push(c.hidden + ' hidden layer' + (c.hidden > 1 ? 's' : '') + ' skipped (visible: false in Figma)');
  if (c.imageMissing) notes.push(c.imageMissing + ' picture' + (c.imageMissing > 1 ? 's' : '') + ' skipped — no URL for the image ref');
  if (c.videoMissing) notes.push(c.videoMissing + ' video' + (c.videoMissing > 1 ? 's' : '') + ' skipped — no URL for the video ref');
  if (c.nocomp) notes.push(c.nocomp + ' instance' + (c.nocomp > 1 ? 's' : '') + ' of a component missing from the bundle imported as an empty box');
  if (c.lost) notes.push(c.lost + ' child id' + (c.lost > 1 ? 's' : '') + ' pointed at no node and were skipped');
  const foreign = Object.keys(c).filter((k) => k.startsWith('foreign:'));
  if (foreign.length) notes.push('unsupported node types skipped: ' + foreign.map((k) => k.slice(8) + ' ×' + c[k]).join(', '));
  return notes;
}

// ── door 1: Figma Sites ───────────────────────────────────────────────────

const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * A published page's HTML → the bundle facts the fetch layer needs, or null
 * when the page is not a Figma Sites page (a Figma Make app, Framer, a login
 * page…). The boot block is multi-line, so every field is read on its own.
 */
function detectSites(html) {
  const s = String(html || '');
  const boot = /new\s+SitesRuntime\s*\(\s*\{([\s\S]*?)\}\s*\)\s*;?/.exec(s);
  const body = boot ? boot[1] : '';
  const m = new RegExp('bundleId\\s*:\\s*[\'"](' + UUID_RE + ')[\'"]').exec(body) || new RegExp('/_json/(' + UUID_RE + ')/[^"\'\\s]*\\.json').exec(s);
  if (!m) return null;
  const bundleId = m[1];
  const pick = (k, d) => {
    const r = new RegExp(k + '\\s*:\\s*[\'"]([A-Za-z0-9_.-]+)[\'"]').exec(body);
    return r ? r[1] : d;
  };
  const pre = new RegExp('/_json/' + bundleId + '((?:/[^"\'\\s?#]*?)?)\\.json').exec(s);
  let pagePath = '/';
  if (pre && pre[1] && pre[1] !== '/_index') pagePath = pre[1].replace(/^\/_cms/, '') || '/';
  const runtime = /\/_runtimes\/sites-runtime\.[a-f0-9]+\.js/.exec(s);
  return {
    bundleId,
    indexPath: '/_json/' + bundleId + '/_index.json',
    assetsVersion: pick('assetsVersion', 'v11'),
    videosVersion: pick('videosVersion', 'v1'),
    fontsVersion: pick('fontsVersion', 'v1'),
    codeComponentsVersion: pick('codeComponentsVersion', ''),
    isFigmake: /isFigmake\s*:\s*true/.test(body),
    pagePath,
    runtimePath: runtime ? runtime[0] : ''
  };
}

/** A `*.figma.site` page served by Figma Make (a Vite app, no SitesRuntime):
 * nothing to decode, but worth a clear word to the person who pasted it. */
function detectMakeApp(html) {
  const s = String(html || '');
  if (detectSites(s)) return false;
  return /\/__figma__\//.test(s) || (/figma\.site\//.test(s) && /\/assets\/index-[A-Za-z0-9_-]+\.js/.test(s));
}

/** The OTHER pages of the site (guidToUrl minus '/'), sorted for stable fetches. */
function sitesPagePaths(indexJson) {
  const map = isObj(indexJson) && isObj(indexJson.guidToUrl) ? indexJson.guidToUrl : {};
  const paths = Object.values(map).filter((p) => typeof p === 'string' && p[0] === '/' && p !== '/');
  return Array.from(new Set(paths)).sort();
}

/** '/about' → '/_json/<id>/about.json'; '/' → '/_json/<id>/_index.json';
 * { cms: true } → the CMS sibling '/_json/<id>/_cms/about.json'. */
function sitesPageJsonPath(bundleId, path, opts = {}) {
  const p = !path || path === '/' ? '/_index' : String(path).replace(/\/+$/, '') || '/_index';
  return '/_json/' + bundleId + (opts.cms ? '/_cms' : '') + p + '.json';
}

function sitesCmsJsonPath(bundleId, path) {
  return sitesPageJsonPath(bundleId, path, { cms: true });
}

function parseMaybe(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
}

/** The bundle's assets map turns a hash into an absolute URL (the map's file
 * name carries the right extension; '.png' is the fallback the runtime uses). */
function sitesUrls(origin, versions, assets) {
  const file = (ref) => (isObj(assets[ref]) && assets[ref].url ? assets[ref].url : null);
  return {
    assetUrl: (ref) => (ref ? origin + '/_assets/' + versions.assets + '/' + (file(ref) || ref + '.png') : null),
    videoUrl: (ref) => (ref ? origin + '/_videos/' + versions.videos + '/' + (file(ref) || ref) : null),
    // A VIDEO fill's imageRef names its poster frame, but Figma Sites never
    // publishes it (checked on live sites: every such URL is a 404, and the
    // runtime renders its <video> with no poster) — a poster only when the
    // bundle's assets map really lists the file.
    posterUrl: (ref) => (ref && file(ref) ? origin + '/_assets/' + versions.assets + '/' + file(ref) : null),
    fontFile: (entry) => {
      if (!isObj(entry) || !entry.url) return null;
      const url = entry.source === 2 ? origin + '/_user_fonts/' + versions.fonts + '/' + entry.url : /^https?:/i.test(entry.url) ? entry.url : origin + entry.url;
      return { weight: num(entry.weight, 400), italic: !!entry.italic, url };
    }
  };
}

/**
 * Children of a Sites node. Real children are looked up; an INSTANCE's stable
 * paths are materialized from its main component: the component's subtree is
 * cloned into the instance's box (translated and scaled per axis), the
 * instance's `overrides` are applied by name-path, and instance-specific asset
 * hashes come from `stablePathToAssetInfo`.
 */
function sitesKids(node, pc) {
  const out = [];
  const frame = node.__frame || null;
  const ids = Array.isArray(node.children) ? node.children : [];
  const isInstance = node.type === 'INSTANCE';
  let instFrame = null;
  const seen = {};
  for (let i = 0; i < ids.length; i++) {
    const cid = String(ids[i]);
    const real = frame ? null : pc.nodeById[cid];
    if (real) {
      out.push(real);
      continue;
    }
    if (!instFrame) {
      if (isInstance) {
        instFrame = instanceFrame(node, frame, pc);
        if (!instFrame) {
          pc.count('nocomp');
          break;
        }
      } else if (frame) instFrame = frame;
      else {
        pc.count('lost');
        continue;
      }
    }
    // The path's last segment names the component child. A bundle that holds a
    // LOCAL COPY of a library component keeps the library's ids in the path
    // while the copy has its own, and then the child at the same position is
    // the one meant (every such case on the samples had equal lengths).
    const last = cid.split(';').pop();
    let orig = pc.nodeById[last];
    if (!orig && isInstance && Array.isArray(instFrame.comp.children) && instFrame.comp.children.length === ids.length) orig = pc.nodeById[instFrame.comp.children[i]];
    if (!orig) {
      pc.count('lost');
      continue;
    }
    const name = String(orig.name || '');
    const occ = seen[name] || 0;
    seen[name] = occ + 1;
    const stableId = isInstance ? (cid[0] === 'I' && !frame ? cid : instFrame.prefix + ';' + last) : instFrame.prefix + ';' + orig.id;
    out.push(cloneNode(orig, instFrame, pc, name + occ, stableId));
  }
  return out;
}

function instanceFrame(inst, parentFrame, pc) {
  const comp = pc.nodeById[inst.mainComponentId];
  const chain = parentFrame ? parentFrame.chain : [];
  if (!comp || chain.includes(comp.id) || chain.length >= 10) return null;
  const ib = inst.absoluteBoundingBox;
  const cb = comp.absoluteBoundingBox;
  if (!isObj(ib) || !isObj(cb)) return null;
  const xf = {
    tx: num(ib.x),
    ty: num(ib.y),
    cx: num(cb.x),
    cy: num(cb.y),
    sx: num(cb.width) > 0 ? num(ib.width) / num(cb.width) : 1,
    sy: num(cb.height) > 0 ? num(ib.height) / num(cb.height) : 1
  };
  const keyPath = inst.__frame ? inst.__frame.keyPath : [];
  return {
    prefix: inst.__frame ? String(inst.id) : 'I' + inst.id,
    comp,
    xf,
    chain: chain.concat([comp.id]),
    keyPath,
    sources: (parentFrame ? parentFrame.sources : []).concat([{ base: keyPath, overrides: Array.isArray(inst.overrides) ? inst.overrides : [] }])
  };
}

function cloneNode(orig, frame, pc, seg, stableId) {
  const c = Object.assign({}, orig);
  c.id = stableId || frame.prefix + ';' + orig.id;
  const keyPath = frame.keyPath.concat([seg]);
  for (const src of frame.sources) {
    for (const ov of src.overrides) {
      if (!isObj(ov) || !isObj(ov.value)) continue;
      if (sameKey(src.base.concat(Array.isArray(ov.key) ? ov.key : []), keyPath)) Object.assign(c, ov.value);
    }
  }
  c.__frame = { prefix: frame.prefix, xf: frame.xf, chain: frame.chain, keyPath, sources: frame.sources };
  const bb = orig.absoluteBoundingBox;
  if (isObj(bb)) {
    const size = c.size !== orig.size && isObj(c.size) ? c.size : null;
    c.absoluteBoundingBox = {
      x: frame.xf.tx + (num(bb.x) - frame.xf.cx) * frame.xf.sx,
      y: frame.xf.ty + (num(bb.y) - frame.xf.cy) * frame.xf.sy,
      width: size ? num(size.x) : num(bb.width) * frame.xf.sx,
      height: size ? num(size.y) : num(bb.height) * frame.xf.sy
    };
  }
  const hash = pc.stableHash(c.id);
  if (hash) c.hash = hash;
  return c;
}

/** stablePathToAssetInfo / stablePathToAssetHash lookup, longest path first
 * ('I1:2;3:4;5:6' → 'I3:4;5:6' → '5:6'), the way the runtime resolves it. */
function stableHashLookup(json) {
  const info = isObj(json.stablePathToAssetInfo) ? json.stablePathToAssetInfo : {};
  const hashes = isObj(json.stablePathToAssetHash) ? json.stablePathToAssetHash : {};
  return (id) => {
    const segs = String(id).split(';');
    const cands = [id];
    for (let i = 1; i < segs.length; i++) cands.push(i < segs.length - 1 ? 'I' + segs.slice(i).join(';') : segs[i]);
    for (const c of cands) {
      if (isObj(info[c]) && info[c].hash) return info[c].hash;
      if (typeof hashes[c] === 'string') return hashes[c];
    }
    return null;
  };
}

function palettesOf(json, site, pageWidth) {
  const nb = json.nodeById;
  const collections = {};
  for (const n of Object.values(nb)) if (n && n.type === 'VARIABLE_COLLECTION') collections[n.assetId || n.id] = n;
  for (const n of Object.values(nb)) {
    if (!n || n.type !== 'VARIABLE' || n.resolvedType !== 'COLOR' || !isObj(n.valuesByMode)) continue;
    const coll = collections[n.variableCollectionId];
    const val = (coll && n.valuesByMode[coll.defaultModeId]) || Object.values(n.valuesByMode)[0];
    const c = parseColor(val);
    if (!c) continue;
    if (!site.palette.includes(c.hex)) site.palette.push(c.hex);
    if (!site.tokens.some((t) => t.name === n.name)) site.tokens.push({ name: String(n.name || ''), hex: c.hex });
  }
  for (const n of Object.values(nb)) {
    if (!n || n.type !== 'STYLE' || n.styleType !== 'TEXT' || !isObj(n.style)) continue;
    if (site.textStyles.some((t) => t.name === n.name)) continue;
    const st = n.style;
    site.textStyles.push({ name: String(n.name || ''), family: st.fontFamily || '', size: sizeOf(st, pageWidth), weight: num(st.fontWeight) || weightFromStyleName(st.fontStyle), italic: st.italic === true || /italic/i.test(String(st.fontStyle || '')) });
  }
}

function sitesPage(path, json, site, urls) {
  const nb = json.nodeById;
  const root = nb[(json.roots || [])[0]];
  if (!isObj(root)) {
    site.notes.push('page ' + path + ' has no root node — skipped');
    return null;
  }
  const bps = (root.children || [])
    .map((id) => nb[id])
    .filter((n) => isObj(n) && n.visible !== false && isObj(n.absoluteBoundingBox) && width(n) > 0)
    .sort((a, b) => width(b) - width(a));
  if (!bps.length) {
    site.notes.push('page ' + path + ' has no breakpoint frame — skipped');
    return null;
  }
  const desktop = bps[0];
  const phone = bps.length > 1 ? bps[bps.length - 1] : null;
  const pageWidth = width(desktop);
  const pc = baseContext(site, pageWidth);
  pc.nodeById = nb;
  pc.stableHash = stableHashLookup(json);
  pc.kids = (n) => sitesKids(n, pc);
  pc.assetUrl = urls.assetUrl;
  pc.videoUrl = urls.videoUrl;
  pc.posterUrl = urls.posterUrl;
  const fontsMap = isObj(json.fonts) ? json.fonts : site.fontsMap;
  pc.fontHint = (family, styleName) => fontsMap[family + ':' + styleName] || site.fontsMap[family + ':' + styleName] || null;
  pc.font = fontRegistrar(site, (family, styleName) => urls.fontFile(pc.fontHint(family, styleName)));
  pc.pathOfNode = (id) => (id && typeof site.guidToUrl[id] === 'string' ? site.guidToUrl[id] : null);
  if (phone) pc.phone = phoneIndex(phone, pc);
  palettesOf(json, site, pageWidth);

  const sections = sectionsOf(desktop, pc);
  resolveAnchors(pc, pc.linked);
  const settings = isObj(json.siteSettings) ? json.siteSettings : {};
  const own = settings.title && settings.title !== site.title ? settings.title : '';
  const name = path === '/' ? site.title || 'Home' : humanize(path) || path;
  const page = {
    key: String(root.id),
    path,
    title: own || (path === '/' ? site.title : site.title ? name + ' — ' + site.title : name),
    name: path === '/' ? 'Home' : name,
    description: (settings.description && settings.description !== site.description ? settings.description : '') || '',
    width: r2(pageWidth),
    sections
  };
  page.breakpoints = bps.map((b) => ({ id: String(b.id), name: String(b.name || ''), width: r2(width(b)) }));
  if (phone) page.mobileWidth = r2(width(phone));
  return page;
}

/**
 * The Sites bundle → puppet (format 'figma-sites').
 * @param {object} o
 * @param {string} o.origin        'https://name.figma.site' (asset URLs are built on it)
 * @param {object} o.index         the parsed _index.json of the site
 * @param {object} [o.pages]       { '/about': <parsed about.json>, … } — a page that failed to
 *                                 fetch is simply absent and gets a note
 * @param {string} [o.assetsVersion='v11']
 * @param {string} [o.videosVersion='v1']
 * @param {string} [o.fontsVersion='v1']
 */
function fromSites({ origin = '', index, pages = {}, assetsVersion = 'v11', videosVersion = 'v1', fontsVersion = 'v1' } = {}) {
  const idx = parseMaybe(index);
  if (!isObj(idx) || !isObj(idx.nodeById)) throw new TypeError('fromSites: index is not a Figma Sites bundle (_index.json)');
  const o = String(origin || '').trim().replace(/\/+$/, '');
  const settings = isObj(idx.siteSettings) ? idx.siteSettings : {};
  const guidToUrl = isObj(idx.guidToUrl) ? idx.guidToUrl : {};
  const site = {
    title: settings.title || '',
    description: settings.description || '',
    guidToUrl,
    pageKeys: {},
    fontsMap: isObj(idx.fonts) ? idx.fonts : {},
    fonts: {},
    palette: [],
    tokens: [],
    textStyles: [],
    notes: [],
    counts: {},
    code: []
  };
  const docs = [['/', idx]];
  const missing = [];
  for (const [p, raw] of Object.entries(isObj(pages) ? pages : {})) {
    if (p === '/') continue;
    const j = parseMaybe(raw);
    if (isObj(j) && isObj(j.nodeById)) docs.push([p, j]);
    else missing.push(p);
  }
  const fetched = new Set(docs.map((d) => d[0]));
  for (const [id, p] of Object.entries(guidToUrl)) if (fetched.has(p)) site.pageKeys[p] = id;
  for (const p of sitesPagePaths(idx)) if (!fetched.has(p) && !missing.includes(p)) missing.push(p);
  if (missing.length) site.notes.push(missing.length + ' page' + (missing.length > 1 ? 's were' : ' was') + ' not fetched — the content is missing: ' + missing.sort().join(', '));
  const versions = { assets: assetsVersion || 'v11', videos: videosVersion || 'v1', fonts: fontsVersion || 'v1' };
  const puppetPages = [];
  for (const [p, j] of docs) {
    const urls = sitesUrls(o, versions, Object.assign({}, idx.assets || {}, isObj(j.assets) ? j.assets : {}));
    const page = sitesPage(p, j, site, urls);
    if (page) puppetPages.push(page);
  }
  const isMakeOnly = puppetPages.length && puppetPages.every((p) => p.sections.every((s) => !s.nodes.length)) && site.code.length;
  if (isMakeOnly) site.notes.unshift('this site is a Figma Make app: its page is one code component and holds no design layers to import (the stray TEXT nodes in the bundle are font warm-ups, not content)');
  const assetUrl = sitesUrls(o, versions, idx.assets || {}).assetUrl;
  const puppet = makePuppet({
    source: 'figma',
    format: 'figma-sites',
    origin: o ? o + '/' : '',
    site: {
      title: site.title,
      description: site.description,
      lang: settings.lang || '',
      dir: textDirection(puppetPages),
      favicon: settings.faviconFilename ? o + '/_assets/' + versions.assets + '/' + settings.faviconFilename : '',
      socialImage: settings.socialImageFilename ? o + '/_assets/' + versions.assets + '/' + settings.socialImageFilename : ''
    },
    fonts: site.fonts,
    palette: site.palette,
    pages: puppetPages,
    notes: finishNotes(site)
  });
  if (site.tokens.length) puppet.tokens = site.tokens;
  if (site.textStyles.length) puppet.textStyles = site.textStyles;
  if (typeof assetUrl === 'function' && puppetPages.length === 0) puppet.notes.push('no page could be read from the bundle');
  return puppet;
}

// ── door 2: the REST file (and the plugin export through it) ─────────────

/** 'https://www.figma.com/design/<key>/<name>?node-id=1-2' → { key, nodeId } */
function parseFileUrl(url) {
  const m = /^https?:\/\/(?:www\.)?figma\.com\/(?:design|file|proto|board|slides|make)\/([A-Za-z0-9]{10,})(?:\/[^?#]*)?(?:\?([^#]*))?/i.exec(String(url || '').trim());
  if (!m) return null;
  let nodeId = null;
  if (m[2]) {
    const q = /(?:^|&)node-id=([^&]+)/.exec(m[2]);
    if (q) nodeId = decodeURIComponent(q[1]).replace('-', ':');
  }
  return { key: m[1], nodeId };
}

/** The images option in any of its shapes: the flat map, the REST envelope
 * ({ meta: { images } } / { images }), or nothing. */
function imagesMap(images) {
  if (!isObj(images)) return {};
  if (isObj(images.meta) && isObj(images.meta.images)) return images.meta.images;
  if (isObj(images.images) && !Object.values(images).some((v) => typeof v === 'string')) return images.images;
  return images;
}

function findNode(root, id) {
  if (!isObj(root)) return null;
  if (String(root.id) === id) return root;
  for (const c of Array.isArray(root.children) ? root.children : []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

/** 'Home — Mobile' ~ 'Home': the words that name a breakpoint are dropped. */
function frameStem(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(mobile|phone|desktop|tablet|web|breakpoint|responsive|sm|md|lg|xs|xl|\d{3,4}(px)?)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function phoneFor(frame, phones) {
  const stem = frameStem(frame.name);
  return phones.find((p) => {
    const s = frameStem(p.name);
    return s && (s === stem || (stem && (s.startsWith(stem) || stem.startsWith(s))));
  }) || null;
}

function filePage(frame, path, phone, site, imgMap) {
  const pageWidth = width(frame);
  const pc = baseContext(site, pageWidth);
  pc.kids = (n) => (Array.isArray(n.children) ? n.children : []);
  pc.assetUrl = (ref) => (ref && typeof imgMap[ref] === 'string' ? imgMap[ref] : null);
  pc.posterUrl = pc.assetUrl;
  pc.vectorRef = (n) => (typeof imgMap[String(n.id)] === 'string' ? String(n.id) : null);
  pc.font = fontRegistrar(site, null);
  pc.pathOfNode = (id) => site.pathById[id] || null;
  if (phone) pc.phone = phoneIndex(phone, pc);
  const sections = sectionsOf(frame, pc);
  resolveAnchors(pc, pc.linked);
  const page = {
    key: String(frame.id),
    path,
    title: String(frame.name || ''),
    name: String(frame.name || ''),
    description: '',
    width: r2(pageWidth),
    sections
  };
  if (phone) {
    page.mobileWidth = r2(width(phone));
    page.mobileFrame = String(phone.id);
  }
  return page;
}

/**
 * GET /v1/files/:key → puppet (format 'figma-file').
 * @param {object} fileJson  the REST response ({ name, document: { children: [CANVAS…] } })
 * @param {object} [o]
 * @param {object} [o.images]  { <imageRef>: 'https://…' } from GET /v1/files/:key/images (or its
 *                             envelope); a node id → URL entry (GET /v1/images/:key?format=svg)
 *                             lets a vector be imported as a picture
 * @param {string} [o.key]     the file key (kept in the notes for provenance)
 * @param {string} [o.nodeId]  '12:34' narrows the import to that frame, or to that page's frames
 */
function fromFile(fileJson, { images = {}, key = '', nodeId = null } = {}) {
  const doc = parseMaybe(fileJson);
  if (!isObj(doc) || !isObj(doc.document)) throw new TypeError('fromFile: not a Figma REST file (GET /v1/files/:key)');
  const imgMap = imagesMap(images);
  const site = { fonts: {}, palette: [], tokens: [], textStyles: [], notes: [], counts: {}, code: [], pageKeys: {}, pathById: {} };
  const canvases = (doc.document.children || []).filter((c) => isObj(c) && c.type === 'CANVAS' && c.visible !== false);
  const topLevel = [];
  for (const c of canvases) for (const n of c.children || []) if (isObj(n) && n.visible !== false && isObj(n.absoluteBoundingBox)) topLevel.push(n);
  let candidates = topLevel;
  let scoped = false;
  if (nodeId) {
    const found = findNode(doc.document, String(nodeId));
    if (!found) site.notes.push('node ' + nodeId + ' is not in this file — every page frame was imported instead');
    else if (found.type === 'CANVAS') candidates = (found.children || []).filter((n) => isObj(n) && n.visible !== false && isObj(n.absoluteBoundingBox));
    else {
      candidates = [found];
      scoped = true;
    }
  }
  const frames = candidates.filter((n) => CONTAINER_TYPES.has(String(n.type)));
  const wide = frames.filter((n) => width(n) >= 900);
  const phones = frames.filter((n) => width(n) <= 600);
  let pageFrames = scoped ? frames : wide;
  if (!pageFrames.length && frames.length) {
    const widest = frames.slice().sort((a, b) => width(b) - width(a))[0];
    pageFrames = [widest];
    site.notes.push('no frame is at least 900 px wide — the widest one, "' + (widest.name || widest.id) + '" (' + Math.round(width(widest)) + ' px), was imported as the page');
  }
  if (!pageFrames.length) {
    const e = new Error('בקובץ הזה אין מסגרת (Frame) לייבא — עיצוב לאתר נבנה במסגרות');
    e.code = 'E_EMPTY_DESIGN';
    throw e;
  }
  const usedPaths = new Set();
  const plan = pageFrames.map((f, i) => {
    const path = i === 0 ? '/' : uniqueIn(usedPaths, '/' + slug(f.name, 'page-' + (i + 1)));
    usedPaths.add(path);
    site.pageKeys[path] = String(f.id);
    site.pathById[String(f.id)] = path;
    return { frame: f, path, phone: scoped ? null : phoneFor(f, phones.filter((p) => p !== f)) };
  });
  const usedPhones = new Set(plan.map((p) => p.phone).filter(Boolean));
  for (const p of phones) if (!usedPhones.has(p) && !pageFrames.includes(p)) site.notes.push('phone frame "' + (p.name || p.id) + '" (' + Math.round(width(p)) + ' px) skipped — no desktop frame with a matching name');
  for (const f of frames) if (width(f) > 600 && width(f) < 900 && !pageFrames.includes(f)) site.notes.push('frame "' + (f.name || f.id) + '" (' + Math.round(width(f)) + ' px) skipped — neither a desktop page (≥ 900) nor a phone variant (≤ 600)');
  const pages = plan.map((p) => filePage(p.frame, p.path, p.phone, site, imgMap));
  for (const s of Object.keys(site.counts)) if (s === 'videoMissing') site.notes.push('the REST file names videos by ref only — they need the plugin export or a manual upload');
  const puppet = makePuppet({
    source: 'figma',
    format: 'figma-file',
    origin: '',
    site: { title: doc.name || '', description: '', lang: '', dir: textDirection(pages) },
    fonts: site.fonts,
    palette: site.palette,
    pages,
    notes: finishNotes(site)
  });
  if (key) puppet.fileKey = String(key);
  return puppet;
}

/** The plugin's JSON (integrations/figma-plugin) → puppet, through fromFile. */
function isPluginExport(json) {
  const j = parseMaybe(json);
  return isObj(j) && j.format === 'tapuz-figma' && Array.isArray(j.pages);
}

function fromPluginExport(json) {
  const j = parseMaybe(json);
  if (!isPluginExport(j)) throw new TypeError('fromPluginExport: not a tapuz-figma export');
  const doc = {
    name: j.fileName || '',
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: j.pages.map((p, i) => ({ id: String((isObj(p) && p.id) || 'page:' + i), type: 'CANVAS', name: String((isObj(p) && p.name) || 'Page ' + (i + 1)), children: isObj(p) && Array.isArray(p.frames) ? p.frames : [] }))
    }
  };
  const puppet = fromFile(doc, { images: isObj(j.images) ? j.images : {}, key: j.fileKey || '' });
  for (const n of Array.isArray(j.notes) ? j.notes : []) puppet.notes.push('plugin: ' + n);
  for (const v of Array.isArray(j.variables) ? j.variables : []) {
    const c = isObj(v) ? parseColor(v.hex || v.color) : null;
    if (!c) continue;
    if (!puppet.palette.includes(c.hex)) puppet.palette.push(c.hex);
    puppet.tokens = puppet.tokens || [];
    puppet.tokens.push({ name: String(v.name || ''), hex: c.hex });
  }
  if (j.exportedAt) puppet.exportedAt = String(j.exportedAt);
  return puppet;
}

module.exports = {
  detectSites,
  detectMakeApp,
  sitesPagePaths,
  sitesPageJsonPath,
  sitesCmsJsonPath,
  fromSites,
  parseFileUrl,
  fromFile,
  fromPluginExport,
  isPluginExport,
  _internals: { slug, humanize, gradientCss, weightFromStyleName, sizeOf, paragraphsOf, layoutOf, rotationOf, frameStem }
};
