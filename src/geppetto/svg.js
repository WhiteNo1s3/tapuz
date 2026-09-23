'use strict';

/**
 * The SVG door — a Figma SVG export (and, later, any vector export) → the puppet.
 *
 * Figma exports a frame as one SVG; a site of N frames is N files, and the
 * person hands them over in order (the first is the home page). Everything a
 * decoder must carry (src/geppetto/puppet.js) is read here from the geometry
 * alone: boxes with their fills, words with their sizes and faces, pictures as
 * the data URIs the export embeds, the designer's layer names as hints. No
 * links (an SVG has none), no phone layout, no roles beyond the names.
 * Geppetto never reads SVG; this file never writes BenTML.
 *
 * Two halves, both exported:
 *   fromSvg(files)                 SVG text → puppet: the walk (a current transform) into
 *                                  primitives, then the second half
 *   primitivesToPuppet(pages)      primitives → puppet (the PDF reader will reuse it)
 *
 * Facts about real Figma exports this reader is built on (read off a real
 * 1440×4811 landing page; do not "improve" them without a file that says so):
 *   - the root is `<svg width="1226" height="4096" viewBox="0 0 1226 4096"
 *     fill="none">`: Figma caps the exported pixel size, so the content is
 *     SCALED. The tree, in order: a canvas backdrop OUTSIDE the frame
 *     (`<rect width="1225.99" height="4096" fill="#1E1E1E"/>` — the export's
 *     size, Figma's canvas colour; dropped), then the frame group
 *     `<g id="Landing page" clip-path="url(#clip0_0_1)">` (its id is the
 *     frame's layer name, its children are the page) whose FIRST child is the
 *     frame's own background `<rect width="1440" height="4811"
 *     transform="scale(0.851382)" fill="white"/>` — the DESIGN size, carrying
 *     the root scale — and EVERY child of the group carries that same
 *     `scale(0.851382)` (a `<g transform>`, a `<text transform>`), so the
 *     numbers inside are design px; the clipPath's rect is the export size.
 *     Backdrop and background are told apart by their PLACE in the tree
 *     (outside vs inside the frame), never by order or colour; the puppet's
 *     page width is the DESIGN width (1440), every length divided back;
 *   - layer names live in `id` (when "Include id attribute" was ticked), with
 *     numeric suffixes on duplicates (`Subheading_2`, `Text_4`) — stripped;
 *   - text, when "Outline text" was UNTICKED: `<text fill font-family font-size
 *     font-weight letter-spacing>` with one `<tspan x y>` per line, x/y being
 *     the line's BASELINE, and Figma's `&#10;` at the end of a broken line;
 *   - text, by default, is OUTLINED: zero `<text>`, dozens of `<path id="…">`
 *     that kept the text layers' names ("Section heading") and hold a subpath
 *     per glyph. detect() refuses that with E_SVG_OUTLINED — the owner exports
 *     again — but only on evidence of words: a text-free illustration or an
 *     icon sheet ("Vector_7", "leaf-left") goes through with a note;
 *   - images are pattern fills, not `<image>` in place: `fill="url(#patternN)"`
 *     → `<pattern><use xlink:href="#imageN" transform="translate scale"/>` →
 *     `<image data-name="photo.png" width height xlink:href="data:…"/>`. The
 *     use's scale tells whether the picture covers its box; `data-name` is the
 *     original file name;
 *   - also present: circle, ellipse, line, use, filter (drop shadows —
 *     ignored), clipPath (a crop hint, never content), `<defs>` at the END;
 *   - hidden layers never appear, so there is nothing to filter;
 *   - the real file was 154 MB (every photo at full resolution): the reader
 *     refuses over MAX_TEXT_BYTES and skips a single picture over
 *     MAX_IMAGE_BASE64 with a note instead of dying.
 *
 * Other exporters, as far as the reader goes: Illustrator's default writes every
 * fill and font as a <style> class rule (read here — inline style, then the
 * sheet, then the attribute, as CSS ranks them) and font faces as PostScript
 * names ('Inter-Bold'); Inkscape sizes the page in mm (scaled to px) and, like
 * any hand-edited file, pretty-prints, so whitespace between tags is layout,
 * never words. A file is untrusted input read in the request thread: a work
 * budget counts every element LOOKED AT (MAX_VISITS), not only the nodes it
 * yields — a fan of <use> over empty groups emits nothing and would otherwise
 * run branch^depth — beside the text cap, the picture cap and the node cap.
 *
 * Coordinates: the walk keeps a current transform (matrix / translate / scale /
 * rotate / skew nest through groups and <use>), so every node comes out
 * absolute within its one section, in design px. A rotated box keeps its
 * unrotated size centred on its footprint plus `rotate`, as figma.js does.
 *
 * Optional fields this decoder adds beyond puppet.js (all safe to ignore):
 *   node.crop           { x, y, w, h } — the visible window of a covered picture, fractions of it
 *   node.natural        { w, h } — the embedded picture's own pixel size
 *   run.letterSpacing   tracking in em
 *   run.weight          the numeric font-weight when it is not 400
 *   paragraph.dir       'rtl' when the line runs right-to-left
 *   puppet.door         'figma-svg' — the puppet's format stays one puppet.js knows
 *
 * Text width: an SVG stores no text box, only baselines. The width of a line is
 * ESTIMATED from its characters and size (see estimateWidth) — good enough to
 * place a heading, never a measurement.
 *
 * Pure: no network, no filesystem. Hebrew is the admin language: every error
 * message says, in one sentence, what to do. Codes are E_SVG_*.
 */

const { makePuppet, parseColor, toHex, unionBox, eachNode } = require('./puppet');
const { parseHtml, decodeEntities } = require('./markup');

const MAX_TEXT_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024;
const MAX_NODES = 20000; // the life pass refuses more (index.js) — stop walking there
const MAX_USE_DEPTH = 12;
const MAX_VISITS = 300000; // elements looked at in one file, <use> expansions included — see walkEl
const OUTLINED_MIN_PATHS = 5;
const SOURCE = 'figma';
const FORMAT = 'figma-file';
const DOOR = 'figma-svg';

// ── small helpers ─────────────────────────────────────────────────────────

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d = 0) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : d; };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const compact = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '' || o[k] === false) delete o[k]; return o; };
/** 1440.004 → 1440 (a scale undone leaves float dust on round design sizes). */
const snap = (n) => (Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : r2(n));

const UNIT_PX = { px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6 };
/** A length with a unit → px ('210mm' → 793.7, '1440px' → 1440, '12' → 12); a percentage or nothing → NaN. */
function lengthPx(v) {
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(String(v == null ? '' : v));
  if (!m) return NaN;
  const unit = m[2].toLowerCase();
  const f = unit ? UNIT_PX[unit] : 1;
  return f ? parseFloat(m[1]) * f : NaN;
}

// Built with fromCharCode so no editor ever turns an escape into a raw byte.
const RTL_LETTERS = new RegExp('[' + String.fromCharCode(0x0590) + '-' + String.fromCharCode(0x08ff) + ']', 'g');
const LTR_LETTERS = /[A-Za-z]/g;

function slug(name, fallback = 'page') {
  const s = String(name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}
function humanize(s) {
  return String(s || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function uniqueIn(used, base) {
  let s = base;
  let i = 2;
  while (used.has(s)) s = base + '-' + i++;
  used.add(s);
  return s;
}
/** 'Home' → 'Home', then 'Home 2', 'Home 3' — pages that share a name stay apart. */
function uniqueName(used, base) {
  let s = base;
  let i = 2;
  while (used.has(s.toLowerCase())) s = base + ' ' + i++;
  used.add(s.toLowerCase());
  return s;
}
/** 'Subheading_2' → 'Subheading' (Figma's suffix on a duplicate layer name). */
function stripSuffix(id) {
  return String(id || '').replace(/_\d+$/, '').trim();
}
/** A name that says nothing about a picture: Figma's own ('Rectangle 12', 'Vector', 'Frame 3') or a generic 'Photo'. */
function isDefaultName(name) {
  return /^(rectangle|ellipse|vector|frame|group|layer|image|img|photo|picture|pic|line|polygon|star|text|arrow|union|subtract|intersect|exclude|mask group)(\s*\d+)?$/i.test(String(name || '').trim());
}
function coded(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
const mb = (n) => (n / (1024 * 1024)).toFixed(1);

// ── 1. detect ─────────────────────────────────────────────────────────────

const DEFS_ID = /^(pattern|image|clip|filter|paint|mask|gradient)/i;

/**
 * A cheap sniff of one file's text: is it an SVG this reader can read?
 * → { ok: true, note? } | { ok: false, code, message }
 */
function detect(text) {
  const s = typeof text === 'string' ? text : text == null ? '' : String(text);
  const head = s.slice(0, 8192);
  if (!/<svg[\s>]/i.test(head)) {
    return { ok: false, code: 'E_SVG_NOT_SVG', message: 'הקובץ אינו SVG — ייצאו את המסגרת מ-Figma בפורמט SVG (Export → SVG) וטענו אותו שוב' };
  }
  if (s.length > MAX_TEXT_BYTES) {
    return { ok: false, code: 'E_SVG_TOO_BIG', message: 'קובץ ה-SVG גדול מדי (' + mb(s.length) + ' MB, המגבלה ' + mb(MAX_TEXT_BYTES) + ' MB) — הקטינו את התמונות המוטמעות או ייצאו כל מסגרת בנפרד' };
  }
  if (/<text[\s>/]/i.test(s)) return { ok: true };
  // no <text> at all. Outlined words are paths that kept the TEXT layer's name
  // (Figma names a text by its words: "Section heading") and hold one subpath
  // per glyph in a wide, short box; an illustration's paths are "Vector_7",
  // "leaf-left", "Cloud", a few subpaths each. Refuse only on evidence of
  // words; otherwise the file goes through and the note says what was seen.
  const ev = outlineEvidence(s);
  if ((ev.strong >= 3 && ev.shaped >= 1) || (ev.strong + ev.weak >= OUTLINED_MIN_PATHS && ev.shaped >= 3) || ev.shaped >= 6) {
    return { ok: false, code: 'E_SVG_OUTLINED', message: 'הטקסט בקובץ הומר לקווי מתאר (Outline text) — ייצאו שוב מ-Figma עם האפשרות "Outline text" כבויה כדי שהמילים יישמרו' };
  }
  if (ev.named >= OUTLINED_MIN_PATHS) return { ok: true, note: 'בקובץ אין טקסט, רק ' + ev.named + ' צורות ווקטוריות עם שמות — אם אלה מילים שיוצאו כקווי מתאר, ייצאו שוב מ-Figma עם "Outline text" כבוי; אם זה איור, הכול בסדר' };
  return { ok: true, note: 'בקובץ אין טקסט — יובאו צורות ותמונות בלבד' };
}

// a vector layer's default name (Figma, Illustrator, Inkscape): a path so named says nothing about words
const VECTOR_NAME = /^(vector|path|shape|layer|boolean|compound path|mask|clip|icon|logo|stroke|fill|outline|artwork|symbol|group|frame|rectangle|ellipse|polygon|star|line|arrow|union|subtract|intersect|exclude|image)(\s*\d+)?$/i;

/** How much a path's id reads like a text layer's name: 2 = several words, 1 = one word, 0 = a vector's name. */
function wordsInName(id) {
  const s = stripSuffix(id).trim();
  if (!s || VECTOR_NAME.test(s)) return 0;
  if (s.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length >= 2) return 2;
  return /^\p{Lu}?\p{Ll}{3,}$/u.test(s) || /^\p{L}{4,}$/u.test(s) ? 1 : 0;
}

/** A path shaped like a line of glyphs: many subpaths (one per letter) in a wide, short box. */
function textShaped(d) {
  if (!d || d.length > 400000) return false;
  const moves = (d.match(/[Mm]/g) || []).length;
  if (moves < 6) return false;
  const b = pathBox(d);
  if (!b || !(b.h > 0)) return false;
  const aspect = b.w / b.h;
  return aspect >= 2.5 || (moves >= 20 && aspect >= 1.2);
}

/** The evidence of outlined words among a text-free file's named paths (the first 60 read closely, 2,000 tags at most). */
function outlineEvidence(s) {
  const ev = { named: 0, strong: 0, weak: 0, shaped: 0 };
  let seen = 0;
  for (const m of s.matchAll(/<path\b([^>]*)>/gi)) {
    if (++seen > 2000) break;
    const id = /\sid\s*=\s*"([^"]*)"/i.exec(m[1]);
    if (!id || DEFS_ID.test(id[1])) continue;
    ev.named++;
    if (ev.named > 60) continue;
    const w = wordsInName(id[1]);
    if (w === 2) ev.strong++;
    else if (w === 1) ev.weak++;
    const d = /\sd\s*=\s*"([^"]*)"/i.exec(m[1]);
    if (d && textShaped(d[1])) ev.shaped++;
  }
  return ev;
}

// ── 2. transforms ─────────────────────────────────────────────────────────
// A matrix is [a, b, c, d, e, f]: (x, y) → (a·x + c·y + e, b·x + d·y + f).

const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];
const scaleM = (sx, sy) => [sx, 0, 0, sy, 0, 0];
const rotateM = (deg) => { const r = deg * Math.PI / 180; const c = Math.cos(r); const s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
/** The uniform size factor of a matrix (√|det|): what a font size or a stroke width scales by. */
const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
/** Clockwise degrees in (−180, 180], 0 when the matrix does not turn. */
function rotationOf(m) {
  let deg = Math.atan2(m[1], m[0]) * 180 / Math.PI;
  if (!Number.isFinite(deg)) return 0;
  deg = ((deg % 360) + 540) % 360 - 180;
  return Math.abs(deg) < 0.05 || Math.abs(Math.abs(deg) - 180) < 0.05 ? 0 : deg;
}

const NUMBERS = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const nums = (s) => (String(s || '').match(NUMBERS) || []).map(parseFloat);

/** `translate(10 20) scale(0.85) rotate(45 100 100) matrix(…)` → one matrix. */
function parseTransform(str) {
  let m = IDENTITY;
  for (const t of String(str || '').matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const a = nums(t[2]);
    const name = t[1].toLowerCase();
    let n = null;
    if (name === 'matrix' && a.length === 6) n = a;
    else if (name === 'translate') n = translate(a[0] || 0, a[1] || 0);
    else if (name === 'scale') n = scaleM(a[0] == null ? 1 : a[0], a[1] == null ? (a[0] == null ? 1 : a[0]) : a[1]);
    else if (name === 'rotate') {
      n = rotateM(a[0] || 0);
      if (a.length >= 3) n = mul(mul(translate(a[1], a[2]), n), translate(-a[1], -a[2]));
    } else if (name === 'skewx') n = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0];
    else if (name === 'skewy') n = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    if (n) m = mul(m, n);
  }
  return m;
}

/**
 * A local box through a matrix → the puppet box. Rotated: the unrotated size
 * centred on the footprint plus `rotate` (figma.js does the same).
 */
function place(b, m) {
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map((p) => apply(m, p[0], p[1]));
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  const rot = rotationOf(m);
  if (rot) {
    const w = b.w * Math.hypot(m[0], m[1]);
    const h = b.h * Math.hypot(m[2], m[3]);
    return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h, rotate: r2(rot) };
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ── 3. colours ────────────────────────────────────────────────────────────

/** { hex, alpha } → '#rrggbb' | 'rgba(r,g,b,a)' — both pass life.js's safeColor. */
function cssColor(c) {
  if (!c || !(c.alpha > 0)) return null;
  if (c.alpha >= 0.995) return c.hex;
  const h = c.hex.slice(1);
  return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + r2(c.alpha) + ')';
}
/** An SVG paint value with its opacity → a CSS colour, or null (none / transparent / a url()). */
function colorOf(value, opacity = 1) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s === 'none' || /^url\(/i.test(s) || s === 'currentcolor') return null;
  const c = parseColor(s);
  if (!c) return null;
  return cssColor({ hex: c.hex, alpha: c.alpha * (Number.isFinite(opacity) ? opacity : 1) });
}
/** `url(#paint0_linear_0_1)` → 'paint0_linear_0_1', else null. */
function urlRef(value) {
  const m = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/i.exec(String(value == null ? '' : value).trim());
  return m ? m[1] : null;
}
const hrefRef = (value) => { const s = String(value || '').trim(); return s[0] === '#' ? s.slice(1) : null; };

// ── 4. attributes ─────────────────────────────────────────────────────────

/** `a: b; c: d` → { prop: value } — the few presentation properties an export puts in style="". */
function parseStyle(s) {
  const out = {};
  for (const part of String(s || '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}
/** A presentation property of an element: the inline style wins over a stylesheet rule, which wins over the attribute (CSS does). */
function prop(el, name) {
  if (!el._style) el._style = el.attrs && el.attrs.style ? parseStyle(el.attrs.style) : {};
  let v = el._style[name];
  if (v != null && v !== '') return v;
  if (el._css && (v = el._css[name]) != null && v !== '') return v;
  const a = el.attrs ? el.attrs[name] : undefined;
  return a == null || a === '' ? undefined : a;
}
const elements = (n) => (n && n.children ? n.children.filter((c) => c.tag !== '#text') : []);
const hrefOf = (el) => el.attrs['xlink:href'] || el.attrs.href || '';

/** Every element with an id, by id, first in document order wins (patterns, images, gradients, clips, symbols, layers). */
function indexIds(root) {
  const byId = new Map();
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    const kids = n.children || [];
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i];
      if (c.tag === '#text') continue;
      if (c.attrs.id != null && c.attrs.id !== '' && !byId.has(c.attrs.id)) byId.set(c.attrs.id, c);
      stack.push(c);
    }
  }
  return byId;
}

/**
 * The file's <style> sheets → the declarations each element gets from them.
 * Illustrator's default export ("CSS Properties: Style Elements") writes every
 * fill and font as a class rule (`.st0{fill:#FFF}` + class="st0"), so a reader
 * that only sees attributes paints a black page. Simple selectors only —
 * `.class`, `#id`, `tag`, grouped with commas; at-rules and anything nested
 * are skipped — and a sheet is read up to a budget.
 */
function readStylesheet(root) {
  const sheet = { cls: new Map(), id: new Map(), tag: new Map() };
  const texts = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    for (const c of n.children || []) {
      if (c.tag === 'style') texts.push((c.children || []).map((t) => t.text || '').join(''));
      else if (c.tag !== '#text') stack.push(c);
    }
  }
  if (!texts.length) return null;
  const css = texts.join('\n').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\/\*[\s\S]*?\*\//g, '').slice(0, 200000);
  const merge = (map, key, decls) => map.set(key, Object.assign(map.get(key) || {}, decls));
  let k = 0;
  let rules = 0;
  while (k < css.length && rules++ < 5000) {
    const open = css.indexOf('{', k);
    if (open < 0) break;
    const head = css.slice(k, open).trim();
    let depth = 0;
    let close = open;
    for (; close < css.length; close++) {
      if (css[close] === '{') depth++;
      else if (css[close] === '}') { depth--; if (!depth) break; }
    }
    const body = css.slice(open + 1, close);
    k = close + 1;
    if (!head || head[0] === '@') continue;
    const decls = parseStyle(body.replace(/\s*!important/gi, ''));
    if (!Object.keys(decls).length) continue;
    for (const sel of head.split(',')) {
      const t = sel.trim();
      let m;
      if ((m = /^\.([A-Za-z_][\w-]*)$/.exec(t))) merge(sheet.cls, m[1], decls);
      else if ((m = /^#([A-Za-z_][\w:.-]*)$/.exec(t))) merge(sheet.id, m[1], decls);
      else if ((m = /^([A-Za-z][\w-]*)$/.exec(t))) merge(sheet.tag, m[1].toLowerCase(), decls);
    }
  }
  return sheet.cls.size || sheet.id.size || sheet.tag.size ? sheet : null;
}

/** Give every element the declarations its tag, classes and id select (tag < class < id). */
function applyStylesheet(root, sheet) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    for (const c of n.children || []) {
      if (c.tag === '#text') continue;
      stack.push(c);
      const d = {};
      let any = false;
      const byTag = sheet.tag.get(c.tag);
      if (byTag) { Object.assign(d, byTag); any = true; }
      for (const cls of String(c.attrs.class || '').split(/\s+/)) {
        const r = cls ? sheet.cls.get(cls) : null;
        if (r) { Object.assign(d, r); any = true; }
      }
      const byIdRule = c.attrs.id != null ? sheet.id.get(String(c.attrs.id)) : null;
      if (byIdRule) { Object.assign(d, byIdRule); any = true; }
      if (any) c._css = d;
    }
  }
}

// ── 5. paint servers: gradients and pattern pictures ──────────────────────

/**
 * <linearGradient> / <radialGradient> → a CSS gradient life.js's safeGradient
 * lets through (linear/radial, colours and numbers only). Figma writes
 * userSpaceOnUse handles — x1 y1 x2 y2 in the element's own space (a
 * gradientTransform on the unit radial) — and the CSS angle is the handle
 * vector's: 0deg points up, 90deg right. `box` is the element's LOCAL box
 * (objectBoundingBox handles are fractions of it); `m` its transform (a turned
 * element turns its gradient too).
 */
function gradientCss(g, box, m, ctx) {
  let holder = g;
  let hops = 0;
  while (holder && !elements(holder).some((c) => c.tag === 'stop') && hops++ < 4) {
    const ref = hrefRef(hrefOf(holder));
    holder = ref ? ctx.byId.get(ref) : null;
  }
  const stops = [];
  for (const s of elements(holder || g)) {
    if (s.tag !== 'stop') continue;
    const c = parseColor(prop(s, 'stop-color') || '#000000');
    if (!c) continue;
    const alpha = c.alpha * num(prop(s, 'stop-opacity'), 1);
    const h = c.hex.slice(1);
    const color = alpha >= 0.995 ? c.hex : 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + r2(Math.max(0, alpha)) + ')';
    const raw = String(prop(s, 'offset') || '0');
    const off = Math.max(0, Math.min(100, /%$/.test(raw) ? parseFloat(raw) : parseFloat(raw) * 100));
    stops.push(color + ' ' + r2(Number.isFinite(off) ? off : 0) + '%');
  }
  if (!stops.length) return null;
  if (stops.length === 1) stops.push(stops[0]);
  if (g.tag === 'radialgradient') return 'radial-gradient(circle, ' + stops.join(', ') + ')';
  const user = String(g.attrs.gradientunits || '').toLowerCase() === 'userspaceonuse';
  const pct = (v, d) => { const s = String(v == null ? '' : v).trim(); if (!s) return d; return /%$/.test(s) ? parseFloat(s) / 100 : parseFloat(s); };
  let p1 = [pct(g.attrs.x1, 0), pct(g.attrs.y1, 0)];
  let p2 = [pct(g.attrs.x2, user ? 0 : 1), pct(g.attrs.y2, 0)];
  if (g.attrs.gradienttransform) {
    const gt = parseTransform(g.attrs.gradienttransform);
    p1 = apply(gt, p1[0], p1[1]);
    p2 = apply(gt, p2[0], p2[1]);
  }
  const dx = (p2[0] - p1[0]) * (user ? 1 : Math.max(1, box.w));
  const dy = (p2[1] - p1[1]) * (user ? 1 : Math.max(1, box.h));
  let deg = Math.atan2(dx, -dy) * 180 / Math.PI + rotationOf(m);
  if (!Number.isFinite(deg)) deg = 180;
  deg = ((Math.round(deg) % 360) + 360) % 360;
  return 'linear-gradient(' + deg + 'deg, ' + stops.join(', ') + ')';
}

const IMAGE_FILE = /^image\.(png|jpe?g|webp|gif|avif)$/i;

/**
 * fill="url(#patternN)" → { src, natural?, fit, crop?, dataName?, svg? } or
 * { error: 'nopicture' | 'toobig', bytes? }. The pattern's <use> maps picture
 * pixels into the box's unit square: translate(tx ty) scale(sx sy) puts the
 * picture at (tx, ty) with size (W·sx, H·sy) in box fractions — over 1 means
 * the picture overflows the box (Figma's FILL: cover) and the translate says
 * which window shows; under 1 on an axis is a letterbox (contain).
 */
function patternImage(pat, ctx) {
  let holder = pat;
  let use = null;
  let img = null;
  for (let hops = 0; holder && hops < 4; hops++) {
    use = elements(holder).find((c) => c.tag === 'use') || null;
    img = elements(holder).find((c) => c.tag === 'image') || null;
    if (use || img) break;
    const ref = hrefRef(hrefOf(holder));
    holder = ref ? ctx.byId.get(ref) : null;
  }
  let m = IDENTITY;
  if (use) {
    const ref = hrefRef(hrefOf(use));
    img = ref ? ctx.byId.get(ref) : null;
    m = mul(translate(num(use.attrs.x), num(use.attrs.y)), parseTransform(use.attrs.transform));
  } else if (img) m = mul(translate(num(img.attrs.x), num(img.attrs.y)), parseTransform(img.attrs.transform));
  if (!img || img.tag !== 'image') return { error: 'nopicture' };
  const href = hrefOf(img);
  if (!href) return { error: 'nopicture' };
  if (href.length > MAX_IMAGE_BASE64) return { error: 'toobig', bytes: href.length };
  const W = num(img.attrs.width);
  const H = num(img.attrs.height);
  const out = { src: href, fit: 'cover' };
  if (W > 0 && H > 0) out.natural = { w: W, h: H };
  if (/^data:image\/svg/i.test(href) || /\.svg(\?|$)/i.test(href)) out.svg = true;
  const units = String(pat.attrs.patterncontentunits || 'userspaceonuse').toLowerCase();
  const pw = num(pat.attrs.width, 1) || 1;
  const ph = num(pat.attrs.height, 1) || 1;
  if (W > 0 && H > 0 && units === 'objectboundingbox') {
    const [x0, y0] = apply(m, 0, 0);
    const [x1, y1] = apply(m, W, H);
    const fw = (x1 - x0) / pw;
    const fh = (y1 - y0) / ph;
    if (fw > 0 && fh > 0) {
      out.fit = fw < 0.98 || fh < 0.98 ? 'contain' : 'cover';
      if (fw > 1.02 || fh > 1.02) {
        const crop = { x: r2(Math.max(0, -x0 / pw / fw)), y: r2(Math.max(0, -y0 / ph / fh)), w: r2(Math.min(1, 1 / fw)), h: r2(Math.min(1, 1 / fh)) };
        if (crop.x > 0.005 || crop.y > 0.005 || crop.w < 0.995 || crop.h < 0.995) out.crop = crop;
      }
    }
  }
  const dn = String(img.attrs['data-name'] || '').trim();
  if (dn && !IMAGE_FILE.test(dn)) out.dataName = humanize(dn);
  return out;
}

// ── 6. path geometry ──────────────────────────────────────────────────────

const PATH_TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/** The t in (0, 1) where a cubic's coordinate turns (its derivative's roots). */
function cubicTurns(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const out = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}
const cubicAt = (p0, p1, p2, p3, t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; };
function cubicBox(x0, y0, x1, y1, x2, y2, x3, y3, add) {
  add(x3, y3);
  for (const t of cubicTurns(x0, x1, x2, x3)) add(cubicAt(x0, x1, x2, x3, t), cubicAt(y0, y1, y2, y3, t));
  for (const t of cubicTurns(y0, y1, y2, y3)) add(cubicAt(x0, x1, x2, x3, t), cubicAt(y0, y1, y2, y3, t));
}
function quadBox(x0, y0, cx, cy, x1, y1, add) {
  // a quadratic is the cubic with controls a third of the way
  cubicBox(x0, y0, x0 + 2 / 3 * (cx - x0), y0 + 2 / 3 * (cy - y0), x1 + 2 / 3 * (cx - x1), y1 + 2 / 3 * (cy - y1), x1, y1, add);
}
/** An elliptical arc, sampled: the endpoint form → centre form (SVG F.6.5), then 16 points. */
function arcBox(x0, y0, rx, ry, rotDeg, large, sweep, x1, y1, add) {
  add(x1, y1);
  if (!(rx > 0) || !(ry > 0)) return;
  const phi = rotDeg * Math.PI / 180;
  const cp = Math.cos(phi); const sp = Math.sin(phi);
  const dx = (x0 - x1) / 2; const dy = (y0 - y1) / 2;
  const x1p = cp * dx + sp * dy; const y1p = -sp * dx + cp * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const n = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const d = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let k = d > 0 ? Math.sqrt(Math.max(0, n / d)) : 0;
  if (large === sweep) k = -k;
  const cxp = k * rx * y1p / ry; const cyp = -k * ry * x1p / rx;
  const cx = cp * cxp - sp * cyp + (x0 + x1) / 2; const cy = sp * cxp + cp * cyp + (y0 + y1) / 2;
  const ang = (ux, uy, vx, vy) => { const s = ux * vy - uy * vx < 0 ? -1 : 1; const dot = ux * vx + uy * vy; return s * Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1)))); };
  const th = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  for (let i = 1; i < 16; i++) {
    const t = th + dth * i / 16;
    const ex = rx * Math.cos(t); const ey = ry * Math.sin(t);
    add(cp * ex - sp * ey + cx, sp * ex + cp * ey + cy);
  }
}

/** The bounding box of a path's `d` (curves included, exactly for Béziers), or null. */
function pathBox(d) {
  const toks = String(d || '').match(PATH_TOKEN) || [];
  let i = 0;
  let cmd = '';
  let x = 0; let y = 0; let sx = 0; let sy = 0;
  let px = null; let py = null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const add = (X, Y) => { if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; };
  const isNum = () => i < toks.length && !/^[A-Za-z]$/.test(toks[i]);
  const next = () => { const v = parseFloat(toks[i++]); return Number.isFinite(v) ? v : 0; };
  const flag = () => { const t = toks[i]; if (t.length > 1) { toks[i] = t.slice(1); return t[0] === '1'; } i++; return t === '1'; };
  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { x = sx; y = sy; cmd = ''; continue; }
    if (!isNum()) { cmd = ''; continue; }
    if (C === 'M') {
      const nx = next(); const ny = next();
      x = rel ? x + nx : nx; y = rel ? y + ny : ny; sx = x; sy = y; add(x, y); px = py = null;
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      const nx = next(); const ny = next();
      x = rel ? x + nx : nx; y = rel ? y + ny : ny; add(x, y); px = py = null;
    } else if (C === 'H') { const nx = next(); x = rel ? x + nx : nx; add(x, y); px = py = null; }
    else if (C === 'V') { const ny = next(); y = rel ? y + ny : ny; add(x, y); px = py = null; }
    else if (C === 'C' || C === 'S') {
      let c1x; let c1y;
      if (C === 'C') { c1x = next(); c1y = next(); if (rel) { c1x += x; c1y += y; } } else { c1x = px == null ? x : 2 * x - px; c1y = py == null ? y : 2 * y - py; }
      let c2x = next(); let c2y = next(); let ex = next(); let ey = next();
      if (rel) { c2x += x; c2y += y; ex += x; ey += y; }
      cubicBox(x, y, c1x, c1y, c2x, c2y, ex, ey, add);
      px = c2x; py = c2y; x = ex; y = ey;
    } else if (C === 'Q' || C === 'T') {
      let cx; let cy;
      if (C === 'Q') { cx = next(); cy = next(); if (rel) { cx += x; cy += y; } } else { cx = px == null ? x : 2 * x - px; cy = py == null ? y : 2 * y - py; }
      let ex = next(); let ey = next();
      if (rel) { ex += x; ey += y; }
      quadBox(x, y, cx, cy, ex, ey, add);
      px = cx; py = cy; x = ex; y = ey;
    } else if (C === 'A') {
      const rx = Math.abs(next()); const ry = Math.abs(next()); const rot = next();
      if (!isNum()) { cmd = ''; continue; }
      const large = flag();
      if (!isNum()) { cmd = ''; continue; }
      const sweep = flag();
      let ex = next(); let ey = next();
      if (rel) { ex += x; ey += y; }
      arcBox(x, y, rx, ry, rot, large, sweep, ex, ey, add);
      x = ex; y = ey; px = py = null;
    } else i++;
  }
  if (x0 === Infinity || !(x1 >= x0) || !(y1 >= y0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 'rect' (four straight sides), 'ellipse' (four arcs, nothing straight) or 'path'. */
function pathKind(d) {
  const s = String(d || '');
  const curves = (s.match(/[CcSsQqTtAa]/g) || []).length;
  const straights = (s.match(/[LlHhVv]/g) || []).length;
  if (curves === 4 && !straights) return 'ellipse';
  if (curves) return 'path';
  const toks = s.match(PATH_TOKEN) || [];
  const xs = new Set(); const ys = new Set();
  let x = 0; let y = 0; let cmd = ''; let n = 0;
  for (let i = 0; i < toks.length;) {
    if (/^[A-Za-z]$/.test(toks[i])) { cmd = toks[i++]; if (cmd === 'Z' || cmd === 'z') continue; }
    if (!cmd || i >= toks.length) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const a = parseFloat(toks[i++]);
    if (C === 'H') x = rel ? x + a : a;
    else if (C === 'V') y = rel ? y + a : a;
    else { const b = parseFloat(toks[i++]); x = rel ? x + a : a; y = rel ? y + (b || 0) : (b || 0); if (C === 'M') cmd = rel ? 'l' : 'L'; }
    xs.add(Math.round(x * 100)); ys.add(Math.round(y * 100)); n++;
    if (n > 64) return 'path';
  }
  return n >= 4 && xs.size <= 2 && ys.size <= 2 ? 'rect' : 'path';
}

// ── 7. inherited style and text ───────────────────────────────────────────

const RTL_LETTER = new RegExp('[' + String.fromCharCode(0x0590) + '-' + String.fromCharCode(0x08ff) + ']');
const NBSP = String.fromCharCode(160);

function weightOf(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s || s === 'normal') return 400;
  if (s === 'bold' || s === 'bolder') return 700;
  if (s === 'lighter') return 300;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? Math.max(100, Math.min(900, n)) : 400;
}
/** '"Inter", sans-serif' → 'Inter' */
function firstFamily(v) {
  return String(v || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '').trim();
}

const FACE_WEIGHT = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, heavy: 900, black: 900 };
/**
 * A font-family value → { family, weight, italic }. Illustrator writes the
 * PostScript name ('Inter-Bold', 'PlayfairDisplay-SemiBoldItalic'): the style
 * words after the dash are the weight and the slant, the head is the family.
 */
function fontFace(v) {
  const fam = firstFamily(v);
  const m = /^([A-Za-z][A-Za-z0-9]*)-((?:Extra|Ultra|Semi|Demi)?(?:Thin|Hairline|Light|Regular|Book|Medium|Bold|Heavy|Black)?(?:Italic|Oblique)?)$/.exec(fam);
  if (!m || !m[2]) return { family: fam, weight: 0, italic: false };
  const style = m[2].toLowerCase();
  return { family: m[1].replace(/([a-z])([A-Z])/g, '$1 $2'), weight: FACE_WEIGHT[style.replace(/italic|oblique/, '')] || 0, italic: /italic|oblique/.test(style) };
}
/** letter-spacing → em: '-0.02em' as is, '1.5' / '1.5px' against the size, 'normal' → 0. */
function letterSpacingEm(value, size) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  if (!s || s === 'normal') return 0;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  if (/em$/.test(s)) return n;
  return size > 0 ? n / size : 0;
}

/**
 * The presentation properties a child inherits, this element's own on top:
 * paint (fill, stroke) and text (face, size, weight, anchor…). Everything an
 * export writes on a <g> and means for what is inside.
 */
function inheritStyle(el, st) {
  const o = Object.assign({}, st);
  const pick = (name) => prop(el, name);
  let v;
  if ((v = pick('fill')) != null) { o.fill = v; o.fillExplicit = true; }
  if ((v = pick('fill-opacity')) != null) o.fillOpacity = Math.max(0, Math.min(1, num(v, 1)));
  if ((v = pick('stroke')) != null) o.stroke = v;
  if ((v = pick('stroke-opacity')) != null) o.strokeOpacity = Math.max(0, Math.min(1, num(v, 1)));
  if ((v = pick('stroke-width')) != null) o.strokeWidth = num(v, 1);
  if ((v = pick('font-family'))) {
    const face = fontFace(v);
    o.fontFamily = face.family;
    if (face.weight && pick('font-weight') == null) o.fontWeight = face.weight;
    if (face.italic && !pick('font-style')) o.italic = true;
  }
  if ((v = pick('font-size')) != null) o.fontSize = num(v, o.fontSize);
  if ((v = pick('font-weight')) != null) o.fontWeight = weightOf(v);
  if ((v = pick('font-style'))) o.italic = /italic|oblique/i.test(v);
  if ((v = pick('letter-spacing')) != null) o.letterSpacing = v;
  if ((v = pick('text-anchor'))) o.textAnchor = String(v).toLowerCase();
  if ((v = pick('text-decoration'))) { o.underline = /underline/i.test(v); o.strike = /line-through/i.test(v); }
  if ((v = pick('text-transform'))) o.upper = /uppercase/i.test(v);
  if ((v = pick('direction'))) o.rtl = String(v).toLowerCase() === 'rtl';
  const ws = pick('white-space') || (el.attrs['xml:space'] === 'preserve' ? 'pre' : null);
  if (ws) o.pre = /pre/.test(ws);
  return o;
}

/**
 * The width of a line, ESTIMATED — an SVG keeps no text box, only where a
 * line starts and its baseline. Average advances of a UI face (Inter, Roboto,
 * Arimo) in em: capitals ~0.66, lowercase ~0.53, digits ~0.56, spaces and thin
 * punctuation ~0.28, Hebrew letters ~0.55; letter-spacing adds once per gap.
 * A heading lands within about a tenth of its real width: enough to centre it
 * and to tell a column from a full row, never a measurement.
 */
function estimateWidth(text, size, lsEm = 0) {
  const chars = Array.from(String(text || ''));
  let em = 0;
  for (const ch of chars) {
    if (ch === ' ' || ch === NBSP || ch === '\t') em += 0.28;
    else if (/[A-Z]/.test(ch)) em += 0.66;
    else if (/[0-9]/.test(ch)) em += 0.56;
    else if (/[ijl!.,:;'|`]/.test(ch)) em += 0.28;
    else if (/[a-z]/.test(ch)) em += 0.53;
    else if (RTL_LETTER.test(ch)) em += 0.55;
    else em += 0.6;
  }
  return Math.max(0, em * size + Math.max(0, chars.length - 1) * lsEm * size);
}

const RUN_KEYS = ['size', 'font', 'weight', 'bold', 'italic', 'underline', 'strike', 'upper', 'color', 'letterSpacing'];
function sameRun(a, b) {
  for (const k of RUN_KEYS) if (a[k] !== b[k]) return false;
  return true;
}
function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameRun(last, r)) last.text += r.text;
    else out.push(r);
  }
  return out;
}

/** One run of characters in a style → a puppet run (size in the walk's units). */
function makeRun(text, style, k) {
  const run = { text };
  const size = num(style.fontSize) > 0 ? style.fontSize * k : 0;
  if (size) run.size = size;
  if (style.fontFamily) run.font = style.fontFamily;
  const weight = num(style.fontWeight, 400) || 400;
  if (weight !== 400) run.weight = weight;
  if (weight >= 600) run.bold = true;
  if (style.italic) run.italic = true;
  if (style.underline) run.underline = true;
  if (style.strike) run.strike = true;
  if (style.upper) run.upper = true;
  const color = colorOf(style.fill, style.fillOpacity == null ? 1 : style.fillOpacity);
  if (color) run.color = color;
  const ls = letterSpacingEm(style.letterSpacing, num(style.fontSize));
  if (Math.abs(ls) >= 0.001) run.letterSpacing = Math.round(ls * 1000) / 1000;
  return run;
}

const firstNum = (v, d = 0) => { const a = nums(v); return a.length ? a[0] : d; };

/**
 * <text> → one text node. Lines come from the tspans (x/y = the line's
 * BASELINE; Figma writes one tspan per line and ends a broken line with
 * &#10;), one paragraph per line with its runs, alignment from text-anchor.
 * The box: from the first baseline minus 0.8 em to the last plus 0.25 em,
 * widths estimated (see estimateWidth), then placed through the transform.
 */
function textNode(el, st, ctx) {
  const m = st.m;
  const k = scaleOf(m);
  const tx = firstNum(el.attrs.x, 0);
  const ty = firstNum(el.attrs.y, 0);
  const lines = [];
  let cur = null;
  const startLine = (x, y, style) => {
    cur = { x, y, style, runs: [] };
    lines.push(cur);
  };
  const pushText = (raw, style) => {
    // lines come from the tspans, never from a newline: Figma's &#10; at a
    // line's end and a pretty-printer's indentation both fold into spaces (SVG
    // renders them so), and whitespace between tags is layout, not words —
    // kept as ONE space only inside a line that already holds words
    const text = decodeEntities(raw);
    const t = style.pre ? text.replace(/[\r\n\t]+/g, ' ') : text.replace(/\s+/g, ' ');
    if (!t.trim()) {
      if (cur && cur.runs.length) cur.runs.push({ text: ' ', style });
      return;
    }
    if (!cur) startLine(tx, ty, style);
    cur.runs.push({ text: t, style });
  };
  const visit = (node, style) => {
    for (const c of node.children || []) {
      if (c.tag === '#text') { pushText(c.text, style); continue; }
      if (c.tag !== 'tspan' && c.tag !== 'a' && c.tag !== 'textpath') continue;
      const s2 = inheritStyle(c, style);
      const hasX = c.attrs.x != null && c.attrs.x !== '';
      const hasY = c.attrs.y != null && c.attrs.y !== '';
      if (hasX || hasY) startLine(hasX ? firstNum(c.attrs.x) : cur ? cur.x : tx, hasY ? firstNum(c.attrs.y) : cur ? cur.y : ty, s2);
      else if (cur && (c.attrs.dy != null || c.attrs.dx != null)) startLine(cur.x + firstNum(c.attrs.dx), cur.y + firstNum(c.attrs.dy), s2);
      visit(c, s2);
    }
  };
  visit(el, st.style);
  for (const ln of lines) {
    if (!ln.runs.length) continue;
    ln.runs[0].text = ln.runs[0].text.replace(/^\s+/, '');
    ln.runs[ln.runs.length - 1].text = ln.runs[ln.runs.length - 1].text.replace(/\s+$/, '');
    ln.runs = ln.runs.filter((r) => r.text);
  }
  while (lines.length && !lines[lines.length - 1].runs.length) lines.pop();
  while (lines.length && !lines[0].runs.length) lines.shift();
  if (!lines.length) return null;

  const paragraphs = [];
  let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity;
  for (const ln of lines) {
    const size = ln.runs.reduce((s, r) => Math.max(s, num(r.style.fontSize)), 0) || num(ln.style.fontSize) || 16;
    const w = ln.runs.reduce((s, r) => s + estimateWidth(r.text, num(r.style.fontSize) || size, letterSpacingEm(r.style.letterSpacing, num(r.style.fontSize) || size)), 0);
    const text = ln.runs.map((r) => r.text).join('');
    const rtl = ln.style.rtl || (text.match(RTL_LETTERS) || []).length > (text.match(LTR_LETTERS) || []).length;
    const anchor = ln.style.textAnchor;
    const align = anchor === 'middle' ? 'center' : anchor === 'end' ? 'end' : 'start';
    // in a right-to-left line the 'start' anchor sits at the right edge
    const atRight = (align === 'end') !== rtl;
    const x0 = align === 'center' ? ln.x - w / 2 : atRight ? ln.x - w : ln.x;
    if (x0 < left) left = x0;
    if (x0 + w > right) right = x0 + w;
    if (ln.y - size * 0.8 < top) top = ln.y - size * 0.8;
    if (ln.y + size * 0.25 > bottom) bottom = ln.y + size * 0.25;
    const p = { align, list: null, runs: mergeRuns(ln.runs.map((r) => makeRun(r.text, r.style, k))) };
    if (rtl) p.dir = 'rtl';
    paragraphs.push(p);
  }
  const box = place({ x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }, m);
  ctx.count('text');
  return newNode('text', el, box, st, ctx, { paragraphs });
}

// ── 8. the walk ───────────────────────────────────────────────────────────

const SKIP_TAGS = new Set(['defs', 'clippath', 'mask', 'pattern', 'lineargradient', 'radialgradient', 'filter', 'style', 'title', 'desc', 'metadata', 'symbol', 'marker', 'script', 'font', 'font-face', 'cursor', 'view', 'animate', 'animatetransform', 'animatemotion', 'set']);
const GROUP_TAGS = new Set(['g', 'a', 'switch', 'svg']);

function nameOf(el) {
  const id = el.attrs && el.attrs.id;
  return id ? stripSuffix(id) || undefined : undefined;
}

/** A node with the fields every kind shares; `box` is already in the walk's units. */
function newNode(type, el, box, st, ctx, extra) {
  const node = { id: ctx.nodeId(el), type, x: box.x, y: box.y, w: box.w, h: box.h, z: 0 }; // raw floats: finishNodes rounds once, after the root scale is undone
  if (box.rotate) node.rotate = box.rotate;
  const name = nameOf(el);
  if (name) node.name = name;
  if (st.opacity < 0.995) node.opacity = r2(Math.max(0, st.opacity));
  if (st.href) node.link = { href: st.href };
  Object.assign(node, extra);
  ctx.emitted++;
  ctx.byEl.set(el, node);
  return compact(node);
}

/** A clip on a group: the shape it cuts, as a crop hint for a lone picture inside. */
/**
 * An element's own `d`, `points` or `transform` parses to the same answer every
 * time — and a fan of `<use>` can look at the same fat leaf thousands of times.
 * The budget bounds HOW MANY elements are looked at; these bound what each look
 * costs, so a 20,000-segment path behind 4,096 expansions is parsed once.
 */
function boxOf(el) {
  if (el._box === undefined) el._box = pathBox(el.attrs.d);
  return el._box;
}

function kindOf(el) {
  if (el._kind === undefined) el._kind = pathKind(el.attrs.d);
  return el._kind;
}

function matOf(el) {
  if (el._m === undefined) el._m = parseTransform(el.attrs.transform);
  return el._m;
}

function ptsOf(el) {
  if (el._pts === undefined) el._pts = nums(el.attrs.points);
  return el._pts;
}

/**
 * How much there is to read in this element itself: the length of the data a
 * look at it has to chew (a path's `d`, a polygon's points, a transform list,
 * and the words inside a `<text>`). Measured once per element, so charging the
 * budget by it is free — and a fat element behind a fan of `<use>` then costs
 * what it really costs instead of counting as one cheap look.
 */
function costOf(el) {
  if (el._weight !== undefined) return el._weight;
  let n = (el.attrs.d || '').length + (el.attrs.points || '').length + (el.attrs.transform || '').length;
  if (el.tag === 'text' || el.tag === 'tspan') {
    const walk = (k) => {
      if (k.tag === '#text') { n += (k.text || '').length; return; }
      for (const c of k.children || []) walk(c);
    };
    walk(el);
  }
  el._weight = n;
  return n;
}

function clipHint(id, m, ctx) {
  const cp = ctx.byId.get(id);
  if (!cp || cp.tag !== 'clippath') return null;
  const shape = elements(cp)[0];
  if (!shape) return null;
  const mm = mul(m, matOf(shape));
  const k = scaleOf(mm);
  if (shape.tag === 'rect') {
    const box = place({ x: num(shape.attrs.x), y: num(shape.attrs.y), w: num(shape.attrs.width), h: num(shape.attrs.height) }, mm);
    const rx = Math.max(num(prop(shape, 'rx')), num(prop(shape, 'ry')));
    return rx > 0 ? { box, mask: 'rounded', radius: rx * k } : { box };
  }
  if (shape.tag === 'circle' || shape.tag === 'ellipse') {
    const rx = shape.tag === 'circle' ? num(shape.attrs.r) : num(shape.attrs.rx);
    const ry = shape.tag === 'circle' ? rx : num(shape.attrs.ry);
    return { box: place({ x: num(shape.attrs.cx) - rx, y: num(shape.attrs.cy) - ry, w: 2 * rx, h: 2 * ry }, mm), mask: 'circle' };
  }
  if (shape.tag === 'path') {
    const b = boxOf(shape);
    if (!b) return null;
    const kind = kindOf(shape);
    return { box: place(b, mm), mask: kind === 'ellipse' ? 'circle' : kind === 'rect' ? undefined : 'shape' };
  }
  return null;
}

/** The state a child of `el` walks with: transform, style, opacity, link, clip, depth. */
function childState(el, st, ctx) {
  let m = st.m;
  if (el.tag === 'svg' && st.depth > 0) {
    m = mul(m, translate(num(el.attrs.x), num(el.attrs.y)));
    const vb = nums(el.attrs.viewbox);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      const w = num(el.attrs.width, vb[2]) || vb[2];
      const h = num(el.attrs.height, vb[3]) || vb[3];
      m = mul(mul(m, scaleM(w / vb[2], h / vb[3])), translate(-vb[0], -vb[1]));
    }
  }
  if (el.attrs.transform) m = mul(m, matOf(el));
  const o = { m, style: inheritStyle(el, st.style), opacity: st.opacity, href: st.href, clip: st.clip, depth: st.depth + 1 };
  const op = prop(el, 'opacity');
  if (op != null) o.opacity = st.opacity * Math.max(0, Math.min(1, num(op, 1)));
  if (el.tag === 'a') { const h = hrefOf(el); if (h) o.href = h; }
  const clipRef = urlRef(prop(el, 'clip-path'));
  if (clipRef) { const hint = clipHint(clipRef, m, ctx); if (hint) o.clip = hint; }
  return o;
}

/** A picture under a clipped group takes the clip's mask when it fills the clip. */
function applyClip(node, st) {
  const c = st.clip;
  if (!c || !c.box || node.mask || !c.mask) return;
  const ix = Math.max(0, Math.min(node.x + node.w, c.box.x + c.box.w) - Math.max(node.x, c.box.x));
  const iy = Math.max(0, Math.min(node.y + node.h, c.box.y + c.box.h) - Math.max(node.y, c.box.y));
  if (c.box.w > 0 && c.box.h > 0 && ix * iy >= 0.9 * c.box.w * c.box.h) {
    node.mask = c.mask;
    if (c.radius && !node.radius) node.radius = c.radius;
  }
}

/**
 * A closed shape with its paint: a colour or gradient → `shape`, a pattern
 * picture → `image`, nothing visible → nothing. `local` is the shape's box in
 * its own space (gradients are written against it), `info` its kind.
 */
function emitFilled(el, st, ctx, local, info, out) {
  const m = st.m;
  const k = scaleOf(m);
  const box = place(local, m);
  const name = nameOf(el);
  const fillRaw = st.style.fill;
  const ref = urlRef(fillRaw);
  let fill = null;
  let picture = null;
  if (ref) {
    const def = ctx.byId.get(ref);
    if (def && def.tag === 'pattern') {
      const pic = patternImage(def, ctx);
      if (pic.error === 'toobig') ctx.skip('התמונה "' + (name || ref) + '" (' + mb(pic.bytes) + ' MB) דולגה — גדולה מ-' + mb(MAX_IMAGE_BASE64) + ' MB; להעלות אותה לאתר בנפרד');
      else if (pic.error) ctx.count('nopicture');
      else picture = pic;
    } else if (def && (def.tag === 'lineargradient' || def.tag === 'radialgradient')) {
      const g = gradientCss(def, local, m, ctx);
      if (g) fill = { gradient: g };
    } else ctx.count('nopaint');
  } else {
    const c = colorOf(fillRaw, st.style.fillOpacity == null ? 1 : st.style.fillOpacity);
    if (c) fill = { color: c };
  }
  const strokeColor = colorOf(st.style.stroke, st.style.strokeOpacity == null ? 1 : st.style.strokeOpacity);
  const stroke = strokeColor ? { color: strokeColor, width: Math.max(0.5, num(st.style.strokeWidth, 1) * k) } : undefined;
  if (picture) {
    const node = newNode('image', el, box, st, ctx, {
      src: picture.src,
      alt: name && !isDefaultName(name) ? name : picture.dataName || name || '',
      fit: picture.fit,
      natural: picture.natural,
      crop: picture.crop,
      svg: picture.svg,
      radius: info.radius,
      mask: info.mask || (info.kind === 'path' ? 'shape' : undefined)
    });
    applyClip(node, st);
    ctx.count('image');
    out.push(node);
    return;
  }
  if (!fill && !stroke) { ctx.count('empty'); return; }
  ctx.count('shape');
  const node = newNode('shape', el, box, st, ctx, { shape: info.kind, fill: fill || undefined, stroke, radius: info.radius });
  if (fill && !st.style.fillExplicit) ctx.implicit.add(node); // painted by SVG's default black, not by the file
  out.push(node);
}

function lineNode(el, st, ctx, p1, p2, out) {
  const m = st.m;
  const a = apply(m, p1[0], p1[1]);
  const b = apply(m, p2[0], p2[1]);
  const color = colorOf(st.style.stroke, st.style.strokeOpacity == null ? 1 : st.style.strokeOpacity);
  if (!color) { ctx.count('empty'); return; }
  const width = Math.max(0.5, num(st.style.strokeWidth, 1) * scaleOf(m));
  const box = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
  if (box.h < 0.5) box.h = width;
  if (box.w < 0.5) box.w = width;
  ctx.count('line');
  out.push(newNode('line', el, box, st, ctx, { color, width }));
}

function imageNode(el, st, ctx, out) {
  const href = hrefOf(el);
  const name = nameOf(el);
  if (!href) { ctx.count('nopicture'); return; }
  if (href.length > MAX_IMAGE_BASE64) { ctx.skip('התמונה "' + (name || 'image') + '" (' + mb(href.length) + ' MB) דולגה — גדולה מ-' + mb(MAX_IMAGE_BASE64) + ' MB; להעלות אותה לאתר בנפרד'); return; }
  const local = { x: num(el.attrs.x), y: num(el.attrs.y), w: num(el.attrs.width), h: num(el.attrs.height) };
  if (!(local.w > 0) || !(local.h > 0)) { ctx.count('empty'); return; }
  const par = String(el.attrs.preserveaspectratio || '').toLowerCase();
  const dn = String(el.attrs['data-name'] || '').trim();
  const node = newNode('image', el, place(local, st.m), st, ctx, {
    src: href,
    alt: name && !isDefaultName(name) ? name : dn && !IMAGE_FILE.test(dn) ? humanize(dn) : name || '',
    fit: par === 'none' || /slice/.test(par) ? 'cover' : 'contain',
    svg: /^data:image\/svg/i.test(href) || /\.svg(\?|$)/i.test(href) || undefined
  });
  applyClip(node, st);
  ctx.count('image');
  out.push(node);
}

function walkChildren(el, st, ctx, out) {
  for (const c of el.children || []) {
    if (!ctx.budgetHit && ctx.emitted >= MAX_NODES) { ctx.budgetHit = true; ctx.budgetWhy = 'nodes'; }
    if (ctx.budgetHit) return;
    if (c.tag !== '#text') walkEl(c, st, ctx, out);
  }
}

/** One element → puppet nodes appended to `out` (a group's members, flattened or grouped). */
function walkEl(el, st, ctx, out) {
  // the work budget counts every element LOOKED AT, <use> expansions included:
  // a tree of empty groups behind a fan of <use> emits nothing, so a budget on
  // emitted nodes alone would let it run branch^depth in the request thread
  ctx.visits += 1 + (costOf(el) >> 6); // a look at a 20,000-character path is not one look
  if (!ctx.budgetHit && ctx.visits > MAX_VISITS) { ctx.budgetHit = true; ctx.budgetWhy = 'visits'; }
  if (ctx.budgetHit) return;
  const tag = el.tag;
  if (SKIP_TAGS.has(tag)) return;
  if (/none/i.test(prop(el, 'display') || '') || /hidden|collapse/i.test(prop(el, 'visibility') || '')) return;
  const s = childState(el, st, ctx);
  const a = el.attrs;
  if (GROUP_TAGS.has(tag)) {
    const kids = [];
    walkChildren(el, s, ctx, kids);
    if (!kids.length) return;
    const name = nameOf(el);
    // the frame: a top-level named group (or the first that covers the page) IS the page — its
    // name goes to the section, its children to the section's own list
    let frame = st.depth === 0;
    if (!frame && name && !ctx.frameName && ctx.viewport.w > 0) {
      const u = unionBox(kids);
      frame = u.w >= ctx.viewport.w * 0.9 && u.h >= ctx.viewport.h * 0.9;
    }
    if (frame) {
      if (name && !ctx.frameName) ctx.frameName = name;
      for (const k of kids) out.push(k);
      return;
    }
    if (name && kids.length > 1) {
      const u = unionBox(kids);
      ctx.count('group');
      out.push(newNode('group', el, u, Object.assign({}, s, { opacity: 1 }), ctx, { children: kids }));
      return;
    }
    for (const k of kids) out.push(k);
    return;
  }
  if (tag === 'rect') {
    const local = { x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height) };
    if (!(local.w > 0) || !(local.h > 0)) return;
    const rx = Math.max(num(prop(el, 'rx')), num(prop(el, 'ry')));
    emitFilled(el, s, ctx, local, { kind: 'rect', radius: rx > 0 ? rx * scaleOf(s.m) : undefined, mask: rx > 0 ? 'rounded' : undefined }, out);
  } else if (tag === 'circle' || tag === 'ellipse') {
    const rx = tag === 'circle' ? num(a.r) : num(a.rx);
    const ry = tag === 'circle' ? rx : num(a.ry);
    if (!(rx > 0) || !(ry > 0)) return;
    emitFilled(el, s, ctx, { x: num(a.cx) - rx, y: num(a.cy) - ry, w: 2 * rx, h: 2 * ry }, { kind: 'ellipse', mask: 'circle' }, out);
  } else if (tag === 'line') {
    lineNode(el, s, ctx, [num(a.x1), num(a.y1)], [num(a.x2), num(a.y2)], out);
  } else if (tag === 'path') {
    const b = boxOf(el);
    if (!b) return;
    const kind = kindOf(el);
    const thin = Math.min(b.w, b.h) < 0.5;
    if (thin && kind !== 'path' && !colorOf(s.style.fill, 1)) return;
    if (thin) { lineNode(el, s, ctx, [b.x, b.y], [b.x + b.w, b.y + b.h], out); return; }
    emitFilled(el, s, ctx, b, { kind, mask: kind === 'ellipse' ? 'circle' : undefined }, out);
  } else if (tag === 'polygon' || tag === 'polyline') {
    const pts = ptsOf(el);
    if (pts.length < 4) return;
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (let i = 0; i + 1 < pts.length; i += 2) { if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i]; if (pts[i + 1] < y0) y0 = pts[i + 1]; if (pts[i + 1] > y1) y1 = pts[i + 1]; }
    if (Math.min(x1 - x0, y1 - y0) < 0.5) { lineNode(el, s, ctx, [x0, y0], [x1, y1], out); return; }
    emitFilled(el, s, ctx, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { kind: 'path' }, out);
  } else if (tag === 'image') {
    imageNode(el, s, ctx, out);
  } else if (tag === 'text') {
    const node = textNode(el, s, ctx);
    if (node) out.push(node);
  } else if (tag === 'use') {
    const ref = hrefRef(hrefOf(el));
    const target = ref ? ctx.byId.get(ref) : null;
    if (!target || (SKIP_TAGS.has(target.tag) && target.tag !== 'symbol')) { ctx.count('nouse'); return; }
    if (ctx.useChain.has(ref) || ctx.useChain.size >= MAX_USE_DEPTH) { ctx.count('nouse'); return; }
    ctx.useChain.add(ref);
    const s2 = Object.assign({}, s, { m: mul(s.m, translate(num(a.x), num(a.y))) });
    if (target.tag === 'symbol' || target.tag === 'svg') {
      const vb = nums(target.attrs.viewbox);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0 && num(a.width) > 0 && num(a.height) > 0) s2.m = mul(mul(s2.m, scaleM(num(a.width) / vb[2], num(a.height) / vb[3])), translate(-vb[0], -vb[1]));
      const kids = [];
      walkChildren(target, s2, ctx, kids);
      for (const k of kids) out.push(k);
    } else walkEl(target, s2, ctx, out);
    ctx.useChain.delete(ref);
  } else if (tag === 'foreignobject') {
    ctx.count('foreignObject');
  } else {
    ctx.count('unknown:' + tag);
  }
}

// ── 9. a file → primitives ────────────────────────────────────────────────

const DEFAULT_STYLE = { fill: 'black', fillOpacity: 1, stroke: 'none', strokeOpacity: 1, strokeWidth: 1, fontFamily: '', fontSize: 16, fontWeight: 400, italic: false, letterSpacing: 'normal', textAnchor: 'start', underline: false, strike: false, upper: false, rtl: false, pre: false, fillExplicit: false };

/** A matrix that only scales, uniformly and not by 1 (b = c = 0, a = d) → a, else 0. */
function uniformScale(m) {
  const ok = Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6 && m[0] > 0 && Math.abs(m[0] - m[3]) <= m[0] * 0.005 && Math.abs(m[0] - 1) >= 0.001;
  return ok ? m[0] : 0;
}
const fullBleed = (w, h, vbW, vbH) => vbW > 0 && vbH > 0 && w >= vbW * 0.97 && h >= vbH * 0.97;

/**
 * The root scale and the design size. Figma capped the export, so the frame's
 * own background — the FIRST child of the frame group — carries
 * `transform="scale(s)"` while its LOCAL size is the design's (1440×4811 under
 * scale(0.851382) in a 1226×4096 export), and every child of the group carries
 * the same scale. Read, in order: that background rect (its size is the
 * design's); the scale most of the frame's children share; the frame group's
 * own transform; a leading top-level rect carrying it (a hand-made file, the
 * background outside). → { s, w, h, el } or null when nothing is scaled.
 */
function designScale(svg, frame, vbW, vbH) {
  const sized = (s, el) => ({ s, w: el ? num(el.attrs.width) : vbW / s, h: el ? num(el.attrs.height) : vbH / s, el: el || null });
  if (frame) {
    const first = elements(frame).find((c) => !SKIP_TAGS.has(c.tag));
    if (first && first.tag === 'rect') {
      const s = uniformScale(parseTransform(first.attrs.transform));
      if (s && fullBleed(num(first.attrs.width) * s, num(first.attrs.height) * s, vbW, vbH)) return sized(s, first);
    }
    const tally = new Map();
    let carrying = 0;
    for (const c of elements(frame)) {
      if (SKIP_TAGS.has(c.tag) || !c.attrs.transform) continue;
      carrying++;
      const s = uniformScale(parseTransform(c.attrs.transform));
      if (s) tally.set(s, (tally.get(s) || 0) + 1);
    }
    let best = 0;
    let n = 0;
    for (const [sc, count] of tally) if (count > n) { best = sc; n = count; }
    if (best && n >= 2 && n >= carrying * 0.6) return sized(best, null);
    const own = uniformScale(parseTransform(frame.attrs.transform));
    if (own) return sized(own, null);
  }
  let seen = 0;
  for (const c of elements(svg)) {
    if (SKIP_TAGS.has(c.tag)) continue;
    if (c.tag !== 'rect' || ++seen > 4) break;
    const s = uniformScale(parseTransform(c.attrs.transform));
    if (s && fullBleed(num(c.attrs.width) * s, num(c.attrs.height) * s, vbW, vbH)) return sized(s, c);
  }
  return null;
}

/** Undo the root scale (every length × k) and round once. */
function finishNodes(nodes, k) {
  eachNode(nodes, (n) => {
    n.x = r2(n.x * k); n.y = r2(n.y * k); n.w = r2(n.w * k); n.h = r2(n.h * k);
    if (n.radius) n.radius = r2(n.radius * k);
    if (n.stroke && n.stroke.width) n.stroke.width = r2(n.stroke.width * k);
    if (n.type === 'line' && n.width) n.width = r2(n.width * k);
    for (const p of n.paragraphs || []) for (const r of p.runs || []) if (r.size) r.size = r2(r.size * k);
  });
}

/** How far the content reaches, full-viewport backdrops left out. */
function contentExtent(nodes, vbW, vbH) {
  let right = 0;
  let bottom = 0;
  for (const n of nodes) {
    if (n.w >= vbW * 0.97 && n.h >= vbH * 0.97) continue;
    if (n.x + n.w > right) right = n.x + n.w;
    if (n.y + n.h > bottom) bottom = n.y + n.h;
  }
  return { right, bottom };
}

/** One SVG file → { name, slug, width, height, nodes, fill } in design px. */
function decodeSvgFile(file, index, shared) {
  const fileName = String((file && file.name) || 'page-' + (index + 1));
  const dom = parseHtml(file.text);
  const svg = elements(dom).find((c) => c.tag === 'svg') || null;
  if (!svg) throw coded('E_SVG_NOT_SVG', fileName + ': הקובץ אינו SVG — ייצאו את המסגרת מ-Figma בפורמט SVG (Export → SVG) וטענו אותו שוב');
  const sheet = readStylesheet(svg);
  if (sheet) applyStylesheet(svg, sheet);
  // the viewport: the viewBox in user units, the width/height in px — a physical
  // size (210mm: an Inkscape A4) scales the user units to px; a percentage says nothing
  const vb = nums(svg.attrs.viewbox);
  const wPx = lengthPx(svg.attrs.width);
  const hPx = lengthPx(svg.attrs.height);
  let vbX = 0; let vbY = 0; let vbW = 0; let vbH = 0;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) [vbX, vbY, vbW, vbH] = vb;
  else { vbW = wPx > 0 ? wPx : 0; vbH = hPx > 0 ? hPx : 0; }
  let unit = 1;
  if (vbW > 0 && wPx > 0 && Math.abs(wPx / vbW - 1) > 0.005) unit = wPx / vbW;
  else if (vbH > 0 && hPx > 0 && Math.abs(hPx / vbH - 1) > 0.005) unit = hPx / vbH;
  const viewW = vbW * unit;
  const viewH = vbH * unit;
  const ctx = {
    byId: indexIds(svg),
    viewport: { w: viewW, h: viewH },
    counts: shared.counts,
    seq: 0,
    ids: new Set(),
    emitted: 0,
    visits: 0,
    budgetHit: false,
    budgetWhy: '',
    useChain: new Set(),
    frameName: '',
    byEl: new Map(),
    implicit: new Set(),
    count(k) { this.counts[k] = (this.counts[k] || 0) + 1; },
    skip(msg) { shared.skipped[msg] = (shared.skipped[msg] || 0) + 1; },
    nodeId(el) {
      const raw = el.attrs && el.attrs.id ? String(el.attrs.id) : '';
      let id = raw || 'n' + (++this.seq);
      if (this.ids.has(id)) id = id + '-' + (++this.seq);
      this.ids.add(id);
      return id;
    }
  };
  const root = { m: mul(scaleM(unit, unit), translate(-vbX, -vbY)), style: inheritStyle(svg, DEFAULT_STYLE), opacity: 1, href: null, clip: null, depth: 0 };
  // the frame is the first top-level group; what sits at the top level before
  // or after it is not the page (Figma's canvas backdrop lives there)
  const frame = elements(svg).find((c) => c.tag === 'g') || null;
  const before = [];
  const inside = [];
  const after = [];
  let bucket = frame ? before : inside;
  for (const c of elements(svg)) {
    if (!ctx.budgetHit && ctx.emitted >= MAX_NODES) { ctx.budgetHit = true; ctx.budgetWhy = 'nodes'; }
    if (ctx.budgetHit) break;
    if (SKIP_TAGS.has(c.tag)) continue;
    if (c === frame) { walkEl(c, root, ctx, inside); bucket = after; continue; }
    walkEl(c, root, ctx, bucket);
  }
  const all = before.concat(inside, after);
  if (ctx.budgetHit) {
    shared.budgetHit = true; // a file that spent its budget has a reason of its own to give
    shared.notes.push(fileName + (ctx.budgetWhy === 'visits'
      ? ': מבנה הקובץ כבד מכדי לקרוא אותו עד הסוף (יותר מ-' + MAX_VISITS.toLocaleString('he-IL') + ' רכיבים והפניות) — נקראו הראשונים בלבד'
      : ': העיצוב מחזיק יותר מ-' + MAX_NODES.toLocaleString('he-IL') + ' רכיבים — נקראו הראשונים בלבד'));
  }
  // the design's own size: the scaled background's LOCAL size (1440×4811 under
  // scale(0.851382)); without a scale, the viewport
  const scaled = designScale(svg, frame, vbW, vbH);
  const s = scaled ? scaled.s : 1;
  let k = scaled ? 1 / s : 1;
  let width = scaled ? snap(scaled.w * unit) : viewW > 0 ? snap(viewW) : 0;
  let height = scaled ? snap(scaled.h * unit) : viewH > 0 ? snap(viewH) : 0;
  if (scaled) {
    // a file whose content already sits in design px next to a scaled backdrop
    // (no export renders that right, a hand-made file may): not scaled twice
    const ext = contentExtent(all, viewW, viewH);
    if (ext.right > viewW * 1.02 || ext.bottom > viewH * 1.02) {
      k = 1;
      shared.notes.push(fileName + ': התוכן כבר בגודל העיצוב (' + width + '×' + height + ') — לא הוקטן שוב');
    } else shared.notes.push(fileName + ': הקובץ יוצא מוקטן (×' + r2(s) + ') — הגאומטריה הוחזרה לגודל העיצוב, ' + width + '×' + height);
  }
  finishNodes(all, k);
  if (!width) { const u = unionBox(all); width = snap(u.x + u.w); height = snap(u.y + u.h); }
  // the page's background, by PLACE in the tree: the first node inside the frame,
  // when it is a full-bleed colour or gradient rect, is the frame's own fill; a
  // full-bleed colour rect OUTSIDE the frame is Figma's canvas backdrop — dropped
  // (unless it is the one that carried the root scale: a background drawn outside);
  // a full-bleed rect the file never coloured (SVG's default black) is nobody's
  // background — an artboard left behind — and goes, with a note
  const box = { x: 0, y: 0, w: width, h: height };
  const fill = { color: null, gradient: null };
  const takeFill = (n) => { if (n.fill.color) fill.color = n.fill.color; else fill.gradient = n.fill.gradient; };
  let unpainted = 0;
  while (inside.length && isBackdrop(inside[0], box)) {
    const n = inside.shift();
    if (ctx.implicit.has(n)) { unpainted++; continue; }
    takeFill(n);
    break;
  }
  const bgNode = scaled && scaled.el ? ctx.byEl.get(scaled.el) : null;
  const canvas = [];
  const keep = (list) => list.filter((n) => {
    if (!isBackdrop(n, box)) return true;
    if (ctx.implicit.has(n)) { unpainted++; return false; }
    if (n === bgNode && !fill.color && !fill.gradient) { takeFill(n); return false; }
    canvas.push(n.fill.color || n.fill.gradient);
    return false;
  });
  const nodes = keep(before).concat(inside, keep(after));
  for (const c of canvas) shared.notes.push(fileName + ': רקע הקנבס של Figma (' + c + ', מלבן בגודל הייצוא מחוץ למסגרת) הושמט');
  if (unpainted) shared.notes.push(fileName + ': מלבן בגודל הדף בלי צבע מוגדר הושמט (ברירת המחדל של SVG הייתה צובעת אותו שחור)' + (unpainted > 1 ? ' ×' + unpainted : ''));
  const frameName = ctx.frameName && !isDefaultName(ctx.frameName) ? ctx.frameName : '';
  return { name: frameName || humanize(fileName) || 'Page ' + (index + 1), slug: fileName, width, height, nodes, fill };
}

// ── 10. primitives → puppet ───────────────────────────────────────────────

/** A plain rect the size of the page: a background layer, not a node. */
function isBackdrop(n, box) {
  if (!n || n.type !== 'shape' || (n.children && n.children.length) || !n.fill || n.fill.image) return false;
  if (!n.fill.color && !n.fill.gradient) return false;
  return n.w >= box.w * 0.97 && n.h >= box.h * 0.97 && n.x <= box.w * 0.02 && n.y <= box.h * 0.02;
}

function textDirection(pages) {
  let rtl = 0;
  let ltr = 0;
  for (const p of pages) for (const s of p.sections) eachNode(s.nodes, (n) => {
    if (n.type !== 'text') return;
    for (const para of n.paragraphs) for (const r of para.runs) {
      rtl += (String(r.text).match(RTL_LETTERS) || []).length;
      ltr += (String(r.text).match(LTR_LETTERS) || []).length;
    }
  });
  if (!rtl && !ltr) return '';
  return rtl > ltr ? 'rtl' : 'ltr';
}

/**
 * The geometry→puppet half, on its own so the PDF reader can reuse it.
 * pages = [{ name, width, height, nodes, slug?, key?, title?, fill? }] with
 * nodes already in puppet shape (design px, absolute, in paint order);
 * meta = { title?, lang?, notes?, counts?, skipped? }.
 *
 * Every page becomes ONE section (`s0`): the life pass cuts the bands itself.
 * A page that arrives without a fill takes its first node as the background
 * when that node is a full-bleed colour or gradient rect; whatever is painted
 * over it stays for life.js to peel. (The SVG door tells Figma's canvas
 * backdrop from the frame's own background itself, by their place in the tree.)
 */
function primitivesToPuppet(pages, meta = {}) {
  const list = (Array.isArray(pages) ? pages : [pages]).filter(isObj);
  if (!list.length) throw coded('E_SVG_EMPTY', 'לא נמצא בקובץ תוכן לייבא — ודאו שייצאתם מסגרת (Frame) עם התוכן ולא שכבה ריקה');
  const notes = Array.isArray(meta.notes) ? meta.notes.slice() : [];
  const counts = isObj(meta.counts) ? meta.counts : {};
  const usedPaths = new Set(['/']);
  const usedKeys = new Set();
  const usedNames = new Set();
  const fonts = {};
  const tally = new Map();
  const addColor = (c, w) => { const hex = toHex(c); if (hex) tally.set(hex, (tally.get(hex) || 0) + w); };
  let any = false;
  const out = list.map((pg, i) => {
    const nodes = Array.isArray(pg.nodes) ? pg.nodes.slice() : [];
    const u = unionBox(nodes);
    const width = num(pg.width) > 0 ? snap(pg.width) : snap(u.x + u.w) || 1;
    const height = num(pg.height) > 0 ? snap(pg.height) : snap(u.y + u.h);
    const box = { x: 0, y: 0, w: width, h: height };
    const given = isObj(pg.fill) ? pg.fill : {};
    const fill = { color: given.color || null, gradient: given.gradient || null, image: given.image || null, video: null };
    if (!fill.color && !fill.gradient && !fill.image && nodes.length && isBackdrop(nodes[0], box)) {
      const n = nodes.shift();
      if (n.fill.color) fill.color = n.fill.color; else fill.gradient = n.fill.gradient;
    }
    let z = 0;
    eachNode(nodes, (n) => {
      n.z = z++;
      any = true;
      if (n.type === 'shape' && n.fill) addColor(n.fill.color, 2);
      if (n.type === 'line') addColor(n.color, 1);
      for (const p of n.paragraphs || []) for (const r of p.runs || []) {
        addColor(r.color, 1);
        if (!r.font) continue;
        const f = fonts[r.font] || (fonts[r.font] = { family: r.font, weights: [], italic: false });
        const w = r.weight || (r.bold ? 700 : 400);
        if (!f.weights.includes(w)) { f.weights.push(w); f.weights.sort((a, b) => a - b); }
        if (r.italic) f.italic = true;
      }
    });
    addColor(fill.color, 5);
    if (fill.color || fill.gradient || fill.image) any = true;
    const name = uniqueName(usedNames, String(pg.name || '').trim() || (i === 0 ? 'Home' : 'Page ' + (i + 1)));
    const path = i === 0 ? '/' : uniqueIn(usedPaths, '/' + slug(pg.slug || name, 'page-' + (i + 1)));
    const key = uniqueIn(usedKeys, String(pg.key || slug(pg.slug || name, 'page-' + (i + 1))));
    return {
      key,
      path,
      title: String(pg.title || name),
      name,
      description: '',
      width,
      sections: [{ key: 's0', anchor: slug(name, 'page'), name, height, fill, layout: null, nodes }]
    };
  });
  // a file whose budget ran out before it drew anything is heavy, not empty:
  // sending the owner to check their frame would be a lie
  if (!any && meta.budgetHit) throw coded('E_SVG_TOO_BIG', 'מבנה הקובץ כבד מכדי לקרוא אותו — הוא מפנה את עצמו שוב ושוב (<use>), ולא נותר ממנו תוכן לייבא');
  if (!any) throw coded('E_SVG_EMPTY', 'לא נמצא בקובץ תוכן לייבא — ודאו שייצאתם מסגרת (Frame) עם התוכן ולא שכבה ריקה');
  // the notes speak to the owner (Hebrew), with the technical handle in parentheses
  if (counts.nopicture) notes.push('מילוי תמונה בלי תמונה מוטמעת — הצורה נשמרה בלי תמונה' + (counts.nopicture > 1 ? ' ×' + counts.nopicture : ''));
  if (counts.nouse) notes.push('הפניה (<use>) לרכיב שאינו בקובץ דולגה' + (counts.nouse > 1 ? ' ×' + counts.nouse : ''));
  if (counts.foreignObject) notes.push('תוכן HTML מוטמע (foreignObject) דולג' + (counts.foreignObject > 1 ? ' ×' + counts.foreignObject : ''));
  const unknown = Object.keys(counts).filter((k) => k.startsWith('unknown:'));
  if (unknown.length) notes.push('אלמנטים מסוג לא נתמך דולגו: ' + unknown.map((k) => k.slice(8) + ' ×' + counts[k]).join(', '));
  for (const [msg, n] of Object.entries(isObj(meta.skipped) ? meta.skipped : {})) notes.push(msg + (n > 1 ? ' ×' + n : ''));
  const palette = [...tally.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, 12);
  const puppet = makePuppet({
    source: SOURCE,
    format: FORMAT,
    origin: '',
    site: { title: String(meta.title || out[0].name || ''), description: '', lang: meta.lang || '', dir: textDirection(out) },
    fonts,
    palette,
    pages: out,
    notes
  });
  puppet.door = DOOR;
  return puppet;
}

// ── 11. the public API ────────────────────────────────────────────────────

/**
 * files = [{ name, text }] — one SVG per page, the home page first; the page
 * path is '/' for it and '/<slug of the file name>' for the rest.
 * opts = { title?, lang? }. → puppet, or a thrown Error with an E_SVG_* code
 * and a Hebrew message (a refused file names itself when there are several).
 */
function fromSvg(files, opts = {}) {
  const list = (Array.isArray(files) ? files : [files]).filter((f) => f && typeof f.text === 'string');
  if (!list.length) throw coded('E_SVG_EMPTY', 'לא התקבל קובץ SVG — ייצאו את המסגרת מ-Figma כ-SVG (Export → SVG, בלי Outline text) וטענו אותה');
  const shared = { counts: {}, skipped: {}, notes: [] };
  const many = list.length > 1;
  const pages = list.map((f, i) => {
    const label = String(f.name || 'קובץ ' + (i + 1));
    const d = detect(f.text);
    if (!d.ok) throw coded(d.code, (many ? label + ': ' : '') + d.message);
    if (d.note) shared.notes.push((many ? label + ': ' : '') + d.note);
    return decodeSvgFile(f, i, shared);
  });
  return primitivesToPuppet(pages, { title: opts.title, lang: opts.lang, notes: shared.notes, counts: shared.counts, skipped: shared.skipped, budgetHit: shared.budgetHit });
}

module.exports = {
  detect,
  fromSvg,
  primitivesToPuppet,
  MAX_TEXT_BYTES,
  MAX_IMAGE_BASE64,
  // exposed for the smoke and the lead's harnesses
  _internals: { parseTransform, mul, apply, place, rotationOf, scaleOf, pathBox, pathKind, gradientCss, patternImage, textNode, estimateWidth, stripSuffix, isDefaultName, designScale, uniformScale, colorOf, wordsInName, textShaped, outlineEvidence, lengthPx, fontFace, readStylesheet, inheritStyle, decodeSvgFile, isBackdrop, DEFAULT_STYLE }
};
