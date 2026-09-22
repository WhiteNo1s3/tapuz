'use strict';

/**
 * The Canva decoders — a published Canva website (either export format) → the puppet.
 *
 * Ben: "we need to get canva sites and make them our own in BenTML … swallow it
 * whole with no salt." A Canva website is a DESIGN published as a page: every
 * Canva page is one section of the site, every element a box at absolute
 * coordinates on a 1366-wide canvas. Two formats leave Canva's publisher and
 * both live on the same domain, sometimes on the same site:
 *
 *   canva-app     the body is an empty <div id="root">; the whole design is a
 *                 JSON string literal (`window['bootstrap'] = JSON.parse('…')`)
 *                 with minified keys, a font table, a media table, a video table.
 *   canva-static  server-rendered HTML: one <section> per Canva page, a CSS grid
 *                 per breakpoint in <style>, text as <p>/<span>, pictures as <img>.
 *                 Newer publishes are static.
 *
 * Everything the life pass (life.js) needs must leave here: every text with its
 * runs, every picture with an absolute URL and its alt, links (outside / another
 * page / a section anchor), section backgrounds, z-order, the source's own role
 * hints and the phone layout when the source has one. Geppetto never reads Canva.
 *
 * Pure: no network, no database, no filesystem. The fetch layer hands us the
 * documents it downloaded; we hand back one puppet per site.
 *
 * Key facts reverse-engineered from real publishes (the minified keys drift, so
 * the code duck-types where it can — see the notes next to each reader):
 *   element: 'A?' type · A TOP (y) · B LEFT (x) · D w · C h · E rotation° · F TRANSPARENCY
 *            (0 on every visible element; opacity = 1 − F) · G link · N role hint
 *   K text · I media (image / video / plain color) · J shape (+ text in `f`)
 *   H group (children in local coords scaled by D/b × C/a) · U line · O embed · L grid
 *   page: a id · B own label · F SEO title · P anchor number (`#page-<P>`) · C size
 *         · D background { C color, B image { A media ref, B placement, E transparency }, E role }
 *
 * Optional fields this decoder adds beyond puppet.js (all safe to ignore):
 *   node.hint                 the source's raw role string ('heading3', 'photo', 'icon', 'sticker'…)
 *   node.effect               Canva's text effect ('hollow', 'shadow', 'lift', 'echo'…) — echo copies to drop
 *   node.valign               'middle' | 'bottom' for a label set inside a shape
 *   node.crop                 { left, top, width, height } — the visible window of a picture, fractions 0..1
 *   node.recolor              { '#from': '#to' } — Canva's recolor map on a vector
 *   node.spritesheet          { wide, high } — a recolorable icon stored as layer tiles (not a plain picture)
 *   node.path                 { viewBox, d } — the drawing of a 'path' shape
 *   node.natural              { w, h } — the media's own size (images, videos, embeds)
 *   node.hls / video.controls the HLS manifest of a Canva video / the <video controls> flag
 *   node.position             CSS object-position of a static picture when it is not centred
 *   paragraph.lineHeight      leading as a multiplier (1.4 = 140 %)
 *   paragraph.dir             'rtl' when the paragraph runs right-to-left
 *   run.letterSpacing         tracking in em
 *   run.page / run.anchor     a run link resolved to a PuppetPage.key / a section anchor
 *   section.title             the Canva page's SEO title (app format)
 *   section.role              the background's role hint ('hero')
 *   section.width             the page's own width when it is not 1366
 *   section.mobileHeight      the section's height on the 375 px phone grid (static format)
 *   mobile.x/y/w/h            in phone px on a 375-wide canvas (static format)
 *   page.designTitle / lang   the Canva design's title (often the template name) and language
 */

const { makePuppet, toHex } = require('./puppet');

const DESIGN_WIDTH = 1366;
const PHONE_WIDTH = 375;
const REM_AT = (vw) => Math.min(vw / 100, 13.66); // html { font-size: min(1vw, 13.66px) }
const NBSP = String.fromCharCode(160);

// ── small helpers ─────────────────────────────────────────────────────────

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v, d = 0) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : d; };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const compact = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '' || o[k] === false) delete o[k]; return o; };

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: NBSP, hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', laquo: '\u00ab', raquo: '\u00bb', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', bull: '\u2022', middot: '\u00b7', times: '\u00d7', deg: '\u00b0', euro: '\u20ac', pound: '\u00a3', shy: '' };

function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    const k = e.toLowerCase();
    return k in ENTITIES ? ENTITIES[k] : m;
  });
}

function absoluteUrl(rel, base) {
  const r = String(rel || '').trim();
  if (!r) return '';
  try { return new URL(r, base || undefined).href; } catch (e) { return r; }
}
function urlParts(u) {
  try { const x = new URL(u); return { origin: x.origin, path: x.pathname.replace(/\/+$/, '') || '/', hash: x.hash.replace(/^#/, ''), ok: true }; } catch (e) { return { origin: '', path: '/', hash: '', ok: false }; }
}
function humanize(slug) {
  return String(slug || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** A Canva-generated id: 16 mixed-case alphanumerics — never a name a person chose. */
function isGeneratedId(id) {
  return /^[A-Za-z0-9_-]{16}$/.test(id) && /[A-Z]/.test(id) && /[a-z]/.test(id);
}

// ── 1. the HTML head ──────────────────────────────────────────────────────

function attrOf(tag, name) {
  const m = new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  return m ? decodeEntities(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : '';
}
function metaContent(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = attrOf(tag, 'name') || attrOf(tag, 'property');
    if (k.toLowerCase() === key) return attrOf(tag, 'content');
  }
  return '';
}
function linkHref(html, rel) {
  let best = '';
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const r = attrOf(tag, 'rel').toLowerCase().split(/\s+/);
    if (r.includes(rel)) { best = attrOf(tag, 'href'); if (best) break; }
  }
  return best;
}

/** Title, description, lang, favicon … and the design id Canva stamps into every publish. */
function headMeta(html, pageUrl) {
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const baseTag = /<base\b[^>]*>/i.exec(html);
  const baseHref = baseTag ? attrOf(baseTag[0], 'href') : '';
  const baseUrl = absoluteUrl(baseHref || '.', pageUrl) || pageUrl;
  let designId = '';
  const boot = /__canva_website_bootstrap__['"]?\]?\s*=\s*JSON\.parse\(\s*'([^']*)'/.exec(html);
  if (boot) { try { designId = String(JSON.parse(boot[1]).A || ''); } catch (e) { designId = ''; } }
  const favicon = linkHref(html, 'icon') || linkHref(html, 'shortcut');
  return {
    title: title ? decodeEntities(title[1]).trim() : '',
    description: metaContent(html, 'description') || metaContent(html, 'og:description'),
    ogTitle: metaContent(html, 'og:title'),
    socialImage: absoluteUrl(metaContent(html, 'og:image'), baseUrl),
    lang: htmlTag ? attrOf(htmlTag[0], 'lang') : '',
    dir: htmlTag ? attrOf(htmlTag[0], 'dir').toLowerCase() : '',
    favicon: favicon ? absoluteUrl(favicon, baseUrl) : '',
    baseUrl,
    designId
  };
}

// ── 2. the app blob: window['bootstrap'] = JSON.parse('…') ────────────────

/** Body of the JS string literal opening at src[start], escapes kept verbatim. */
function jsStringBody(src, start) {
  const q = src[start];
  let i = start + 1;
  let out = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if (c === q) return out;
    out += c;
    i++;
  }
  return null;
}
function unescapeJs(s) {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, e) => {
    if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
    return e in map ? map[e] : e;
  });
}
/** The parsed bootstrap object, or null when the page is not the app format. */
function extractBootstrap(html) {
  const m = /window\[['"]bootstrap['"]\]\s*=\s*JSON\.parse\(\s*(['"])/.exec(html);
  if (!m) return null;
  const body = jsStringBody(html, m.index + m[0].length - 1);
  if (body == null) return null;
  try { return JSON.parse(unescapeJs(body)); } catch (e) { return null; }
}

// ── 3. a tolerant HTML DOM ────────────────────────────────────────────────

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea']);

function parseAttrs(s) {
  const attrs = {};
  for (const m of s.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '');
  }
  return attrs;
}

/** Minimal DOM: { tag, attrs, children, parent } and text nodes { tag: '#text', text }. */
function parseHtml(html) {
  const src = String(html || '');
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  const pushText = (t) => { if (t) cur.children.push({ tag: '#text', text: t, parent: cur }); };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { pushText(src.slice(i)); break; }
    if (lt > i) pushText(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') { const e = src.indexOf('>', lt); i = e < 0 ? src.length : e + 1; continue; }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt);
      const name = src.slice(lt + 2, e < 0 ? src.length : e).trim().toLowerCase();
      let n = cur;
      while (n && n.tag !== name) n = n.parent;
      if (n && n.parent) cur = n.parent; // an unmatched close tag is ignored
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    // an open tag: find its '>' outside quotes
    let j = lt + 1;
    let quote = '';
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const inner = src.slice(lt + 1, j);
    const nm = /^([^\s/>]+)/.exec(inner);
    if (!nm) { pushText('<'); i = lt + 1; continue; }
    const tag = nm[1].toLowerCase();
    const selfClosed = /\/\s*$/.test(inner);
    const el = { tag, attrs: parseAttrs(inner.slice(nm[1].length)), children: [], parent: cur };
    cur.children.push(el);
    i = j + 1;
    if (RAW.has(tag) && !selfClosed) {
      const close = new RegExp('</' + tag + '\\s*>', 'ig');
      close.lastIndex = i;
      const cm = close.exec(src);
      const end = cm ? cm.index : src.length;
      el.children.push({ tag: '#text', text: src.slice(i, end), parent: el });
      i = cm ? cm.index + cm[0].length : src.length;
      continue;
    }
    if (!VOID.has(tag) && !selfClosed) cur = el;
  }
  return root;
}

const elements = (n) => (n.children || []).filter((c) => c.tag !== '#text');
function findFirst(n, pred) {
  for (const c of n.children || []) {
    if (c.tag === '#text') continue;
    if (pred(c)) return c;
    const r = findFirst(c, pred);
    if (r) return r;
  }
  return null;
}
function findAll(n, pred, out = []) {
  for (const c of n.children || []) {
    if (c.tag === '#text') continue;
    if (pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}
function textContent(n) {
  if (n.tag === '#text') return n.text;
  return (n.children || []).map(textContent).join('');
}

/** Split `a:b;c:d` on semicolons outside parentheses/quotes → { prop: value }. */
function parseDecls(s) {
  const out = {};
  let depth = 0;
  let quote = '';
  let cur = '';
  const flush = () => {
    const i = cur.indexOf(':');
    if (i > 0) out[cur.slice(0, i).trim().toLowerCase()] = cur.slice(i + 1).trim();
    cur = '';
  };
  for (const c of String(s || '')) {
    if (quote) { cur += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (c === ';' && !depth) { flush(); continue; }
    cur += c;
  }
  flush();
  return out;
}
function inlineStyle(el) {
  if (!el._style) el._style = parseDecls(el.attrs && el.attrs.style);
  return el._style;
}

// ── 4. the CSS reader ─────────────────────────────────────────────────────

function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }

/** Top-level blocks of `css`: [{ head, body }] with nesting respected. */
function cssBlocks(css) {
  const out = [];
  let k = 0;
  while (k < css.length) {
    const open = css.indexOf('{', k);
    if (open < 0) break;
    const head = css.slice(k, open).trim();
    let depth = 0;
    let close = open;
    for (; close < css.length; close++) {
      if (css[close] === '{') depth++;
      else if (css[close] === '}') { depth--; if (!depth) break; }
    }
    out.push({ head, body: css.slice(open + 1, close) });
    k = close + 1;
  }
  return out;
}

/**
 * The stylesheet of a static export: rules by media query, the @font-face
 * list and the @keyframes names. Selectors are `#id` (Canva's own) — anything
 * else is kept but never asked for.
 */
class StyleSheet {
  constructor(html) {
    this.global = new Map(); // id → decls
    this.media = new Map(); // query → Map(id → decls)
    this.queries = [];
    this.fontFaces = [];
    this.keyframes = new Set();
    for (const m of String(html || '').matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) this._read(stripComments(m[1]), '');
  }
  _read(css, query) {
    for (const b of cssBlocks(css)) {
      if (b.head.startsWith('@media')) {
        const q = b.head.replace(/^@media\s*/, '').trim();
        if (!this.media.has(q)) { this.media.set(q, new Map()); this.queries.push(q); }
        this._read(b.body, q);
      } else if (b.head.startsWith('@font-face')) {
        this._fontFace(parseDecls(b.body));
      } else if (b.head.startsWith('@keyframes') || b.head.startsWith('@-webkit-keyframes')) {
        this.keyframes.add(b.head.split(/\s+/)[1] || '');
      } else if (b.head.startsWith('@')) {
        // @supports / @layer: read the inside as if it applied everywhere
        if (/\{/.test(b.body)) this._read(b.body, query);
      } else {
        const decls = parseDecls(b.body);
        const table = query ? this.media.get(query) : this.global;
        for (const sel of b.head.split(',')) {
          const s = sel.trim();
          if (!s) continue;
          const prev = table.get(s) || {};
          table.set(s, Object.assign(prev, decls));
        }
      }
    }
  }
  _fontFace(d) {
    const fam = String(d['font-family'] || '').replace(/^['"]|['"]$/g, '').trim();
    const src = String(d.src || '');
    const url = (/url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(src) || [])[1] || '';
    if (!fam || !url) return;
    const w = String(d['font-weight'] || '400').trim().toLowerCase();
    const weight = w === 'bold' ? 700 : w === 'normal' ? 400 : num(w.split(/\s+/)[0], 400);
    this.fontFaces.push({ key: fam, url, weight, style: /italic|oblique/i.test(String(d['font-style'] || '')) ? 'italic' : 'normal' });
  }
  /** The media block whose range holds `width` px, preferring the narrowest range; '' when none. */
  mediaFor(width) {
    let best = '';
    let bestSpan = Infinity;
    for (const q of this.queries) {
      const mn = /min-width:\s*([\d.]+)px/.exec(q);
      const mx = /max-width:\s*([\d.]+)px/.exec(q);
      if (!mn && !mx) continue;
      const lo = mn ? parseFloat(mn[1]) : 0;
      const hi = mx ? parseFloat(mx[1]) : Infinity;
      if (width < lo || width > hi) continue;
      // an open-ended block ("min-width: 1024.05px") still counts — cap it so the spans compare
      const span = Math.min(hi, 100000) - lo;
      if (span < bestSpan) { bestSpan = span; best = q; }
    }
    return best;
  }
  /** Declarations for `#id` at a media block: global first, the block's on top. */
  declsFor(id, query) {
    const sel = '#' + id;
    const g = this.global.get(sel);
    const m = query ? (this.media.get(query) || new Map()).get(sel) : null;
    if (!g && !m) return null;
    return Object.assign({}, g || {}, m || {});
  }
  hasAnyRule(id) {
    const sel = '#' + id;
    if (this.global.has(sel)) return true;
    for (const t of this.media.values()) if (t.has(sel)) return true;
    return false;
  }
}

/**
 * Canva declares a @font-face for EVERY weight 100…900 (and both styles) and
 * points the ones it lacks at the nearest file it has. The real faces are the
 * distinct files: one entry per url, weight 400 if that file is declared at
 * 400, else 700, else the declared weight nearest 400; italic only when a file
 * serves italic alone.
 */
function canonicalFaces(faces) {
  const byUrl = new Map();
  for (const f of faces) {
    const cur = byUrl.get(f.url) || { key: f.key, url: f.url, weights: new Set(), styles: new Set() };
    cur.weights.add(f.weight);
    cur.styles.add(f.style);
    byUrl.set(f.url, cur);
  }
  const out = [];
  for (const g of byUrl.values()) {
    const ws = [...g.weights];
    const weight = ws.includes(400) ? 400 : ws.includes(700) ? 700 : ws.sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400))[0];
    out.push({ key: g.key, url: g.url, weight, style: g.styles.has('normal') ? 'normal' : 'italic' });
  }
  return out;
}

// ── 5. CSS lengths ────────────────────────────────────────────────────────

/**
 * Evaluate a CSS length expression to px for one breakpoint.
 * ctx = { vw (viewport px), em (font px of the element), pct (the % base),
 *         vars(name) → expression|null }.
 * Handles calc()/min()/max()/clamp()/minmax()/var() and px/rem/em/vw/vh/%;
 * anything it cannot read is 0 — a wrong geometry is better than a crash.
 */
function evalLength(expr, ctx) {
  const s = String(expr == null ? '' : expr).trim();
  if (!s) return 0;
  let i = 0;
  const peek = () => s[i];
  const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const ident = () => { const m = /^[-a-zA-Z_][-a-zA-Z0-9_]*/.exec(s.slice(i)); if (!m) return ''; i += m[0].length; return m[0]; };
  function args() { // after '(' : comma-separated expressions, until ')'
    const out = [];
    skip();
    if (peek() === ')') { i++; return out; }
    for (;;) {
      out.push(expression());
      skip();
      if (peek() === ',') { i++; continue; }
      if (peek() === ')') { i++; break; }
      break; // malformed: stop
    }
    return out;
  }
  function factor() {
    skip();
    const c = peek();
    if (c === '(') { i++; const v = expression(); skip(); if (peek() === ')') i++; return v; }
    if (c === '-' || c === '+') { i++; const v = factor(); return c === '-' ? -v : v; }
    const numM = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(s.slice(i));
    if (numM) {
      i += numM[0].length;
      const n = parseFloat(numM[0]);
      const unit = /^[a-zA-Z%]+/.exec(s.slice(i));
      if (!unit) return n;
      i += unit[0].length;
      return withUnit(n, unit[0].toLowerCase());
    }
    const name = ident();
    if (!name) { i++; return 0; }
    skip();
    if (peek() === '(') {
      i++;
      const lower = name.toLowerCase();
      if (lower === 'var') {
        // var(--name, fallback) — the name is not an expression
        skip();
        const vn = ident();
        skip();
        let fb = null;
        if (peek() === ',') { i++; fb = expression(); }
        skip();
        if (peek() === ')') i++;
        const def = ctx.vars ? ctx.vars(vn) : null;
        if (def != null && def !== '') return evalLength(def, Object.assign({}, ctx, { depth: (ctx.depth || 0) + 1 }));
        return fb == null ? 0 : fb;
      }
      const a = args();
      if (lower === 'calc') return a[0] || 0;
      if (lower === 'max') return a.length ? Math.max(...a) : 0;
      if (lower === 'min') return a.length ? Math.min(...a) : 0;
      if (lower === 'clamp') return a.length === 3 ? Math.min(Math.max(a[1], a[0]), a[2]) : (a[0] || 0);
      if (lower === 'minmax') return a[0] || 0;
      return a[0] || 0;
    }
    // keywords: auto, max-content, min-content, none, inherit …
    return 0;
  }
  function withUnit(n, unit) {
    const vw = ctx.vw || DESIGN_WIDTH;
    if (unit === 'px') return n;
    if (unit === 'rem') return n * REM_AT(vw);
    if (unit === 'em') return n * (ctx.em || REM_AT(vw));
    if (unit === 'vw') return n * vw / 100;
    if (unit === 'vh') return n * (vw * 768 / DESIGN_WIDTH) / 100;
    if (unit === '%') return n * (ctx.pct || 0) / 100;
    if (unit === 'pt') return n * 4 / 3;
    return n;
  }
  function term() {
    let v = factor();
    for (;;) {
      skip();
      const c = peek();
      if (c === '*') { i++; v *= factor(); } else if (c === '/') { i++; const d = factor(); v = d ? v / d : 0; } else return v;
    }
  }
  function expression() {
    let v = term();
    for (;;) {
      skip();
      const c = peek();
      if (c === '+') { i++; v += term(); } else if (c === '-') { i++; v -= term(); } else return v;
    }
  }
  if ((ctx.depth || 0) > 8) return 0;
  const v = expression();
  return Number.isFinite(v) ? v : 0;
}

/** Split a track list on top-level whitespace (`minmax(a, b)` stays whole). */
function splitTracks(value) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of String(value || '')) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (/\s/.test(c) && !depth) { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** grid-template-* → track sizes in px; `fr` tracks share what fixed tracks leave of `total`. */
function trackSizes(value, ctx, total) {
  const parts = splitTracks(value).flatMap((p) => {
    const rep = /^repeat\(\s*(\d+)\s*,(.*)\)$/.exec(p);
    return rep ? Array(parseInt(rep[1], 10)).fill(rep[2].trim()) : [p];
  });
  const sizes = parts.map((p) => {
    const fr = /^([\d.]+)fr$/.exec(p);
    if (fr) return { fr: parseFloat(fr[1]) };
    return { px: Math.max(0, evalLength(p, ctx)) };
  });
  const fixed = sizes.reduce((s, t) => s + (t.px || 0), 0);
  const frs = sizes.reduce((s, t) => s + (t.fr || 0), 0);
  const free = Math.max(0, (total || 0) - fixed);
  return sizes.map((t) => (t.fr ? (frs ? free * t.fr / frs : 0) : t.px));
}
function lines(sizes) {
  const out = [0];
  for (const s of sizes) out.push(out[out.length - 1] + s);
  return out;
}

/** `grid-area: r1 / c1 / r2 / c2` (or grid-row/grid-column) → 1-based lines, or null. */
function gridArea(d) {
  if (!d) return null;
  const parseLine = (v, from) => {
    const s = String(v == null ? '' : v).trim();
    const span = /^span\s+(\d+)/.exec(s);
    if (span) return from + parseInt(span[1], 10);
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };
  let parts = null;
  if (d['grid-area']) parts = d['grid-area'].split('/').map((x) => x.trim());
  else if (d['grid-row'] || d['grid-column']) {
    const r = String(d['grid-row'] || '').split('/').map((x) => x.trim());
    const c = String(d['grid-column'] || '').split('/').map((x) => x.trim());
    parts = [r[0], c[0], r[1], c[1]];
  }
  if (!parts) return null;
  const r1 = parseLine(parts[0]);
  const c1 = parseLine(parts[1]);
  if (r1 == null || c1 == null) return null;
  const r2 = parts[2] != null && parts[2] !== '' ? parseLine(parts[2], r1) : r1 + 1;
  const c2 = parts[3] != null && parts[3] !== '' ? parseLine(parts[3], c1) : c1 + 1;
  return { r1, c1, r2: r2 == null ? r1 + 1 : r2, c2: c2 == null ? c1 + 1 : c2 };
}

// ── 6. text helpers shared by both formats ────────────────────────────────

const ALIGN = { left: 'start', start: 'start', center: 'center', right: 'end', end: 'end', justify: 'justify' };
function alignOf(v, dir) {
  const a = ALIGN[String(v || '').trim().toLowerCase()];
  if (!a) return 'start';
  if (dir === 'rtl' && (v === 'left' || v === 'right')) return a === 'start' ? 'end' : 'start';
  return a;
}
function listOf(marker) {
  const m = String(marker || '').trim().toLowerCase();
  if (!m || m === 'none') return null;
  if (m === 'disc' || m === 'circle' || m === 'square' || m === 'bullet') return 'bullet';
  return 'number';
}
function weightOf(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s || s === 'normal') return 400;
  if (s === 'bold') return 700;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 400;
}
function sameRun(a, b) {
  for (const k of ['bold', 'italic', 'underline', 'strike', 'upper', 'color', 'size', 'font', 'href', 'weight', 'letterSpacing']) if (a[k] !== b[k]) return false;
  return true;
}
/** Merge neighbouring runs that carry the same style; drop empty ones. */
function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameRun(last, r)) last.text += r.text;
    else out.push(Object.assign({}, r));
  }
  return out;
}
function textLength(paragraphs) {
  return paragraphs.reduce((s, p) => s + p.runs.reduce((t, r) => t + r.text.replace(/\s+/g, '').length, 0), 0);
}

// ── 7. the app format ─────────────────────────────────────────────────────

const FONT_STYLE_WEIGHT = { THIN: 100, EXTRA_LIGHT: 200, LIGHT: 300, REGULAR: 400, MEDIUM: 500, SEMI_BOLD: 600, BOLD: 700, EXTRA_BOLD: 800, BLACK: 900 };
function faceWeight(style) {
  const s = String(style || 'REGULAR').toUpperCase().replace(/_?ITALICS?$/, '');
  return FONT_STYLE_WEIGHT[s] || 400;
}
/** A font key that both formats agree on: the static CSS writes `<id>-<n>`, the app blob `<id>,<n>`. */
const fontKey = (id, n) => id + '-' + (n == null ? 0 : n);

function readFontTable(list, fonts) {
  for (const f of list || []) {
    if (!f || !f.A) continue;
    const faces = Array.isArray(f.D) ? f.D : [];
    const key = fontKey(f.A, f.B);
    const weights = [...new Set(faces.map((d) => faceWeight(d.style)))].sort((a, b) => a - b);
    fonts[key] = { family: String(f.C || ''), weights: weights.length ? weights : [400], italic: faces.some((d) => /ITALIC/i.test(String(d.style))) };
  }
}

/** Media table (bootstrap.page.E): id → the file to use (largest, never a spritesheet when a plain one exists). */
function readMediaTable(list) {
  const byId = new Map();
  for (const m of list || []) {
    if (!m || !m.id) continue;
    for (const f of m.files || []) {
      if (!f || !f.url) continue;
      const cur = byId.get(m.id) || { type: m.type, files: [], sheet: m.spritesheetMetadata || null };
      cur.files.push(f);
      byId.set(m.id, cur);
    }
  }
  const out = new Map();
  for (const [id, m] of byId) {
    const plain = m.files.filter((f) => !f.spritesheet);
    const pool = plain.length ? plain : m.files;
    const best = pool.reduce((a, b) => (num(b.width) > num(a.width) ? b : a));
    out.set(id, { url: best.url, width: num(best.width), height: num(best.height), mime: best.mimeType || '', svg: m.type === 'VECTOR' && /svg/i.test(best.mimeType || best.url), sheet: best.spritesheet ? m.sheet : null });
  }
  return out;
}
/** Video table (bootstrap.page.F): id → { mp4, gif, poster, kind, hls }. */
function readVideoTable(list) {
  const out = new Map();
  for (const v of list || []) {
    if (!v || !v.id) continue;
    const files = (v.files || []).filter((f) => f && f.url);
    const mp4s = files.filter((f) => /\.mp4(\?|$)/i.test(f.url) || f.container === 'A');
    const gifs = files.filter((f) => /\.gif(\?|$)/i.test(f.url) || f.container === 'B');
    const largest = (l) => (l.length ? l.reduce((a, b) => (num(b.width) > num(a.width) ? b : a)) : null);
    out.set(v.id, {
      mp4: largest(mp4s) ? largest(mp4s).url : '',
      gif: largest(gifs) ? largest(gifs).url : '',
      poster: v.posterframes && v.posterframes[0] ? (v.posterframes[0].A || v.posterframes[0].url || '') : '',
      hls: v.hlsManifestUrl || '',
      kind: v.contentType || 'VIDEO',
      width: num(v.width),
      height: num(v.height),
      duration: num(v.durationSeconds)
    });
  }
  return out;
}
/** A media reference anywhere in the blob: { A: 'MA…', B: 1 } (sometimes with 'A?': 'd'). */
function mediaId(ref) {
  if (!isObj(ref)) return typeof ref === 'string' ? ref : '';
  return typeof ref.A === 'string' ? ref.A : '';
}

/**
 * Text runs from Canva's delta stream. `a.A` = the chunks of text, `a.B` = a
 * stream where { 'A?': 'A', A: { prop: { B: value } } } sets props at the
 * cursor (a `{}` value UNSETS), and { 'A?': 'B', A: n } moves the cursor n
 * characters. Verified on texts that change color, link and list level
 * mid-stream: the effective style of a character is the accumulation so far.
 * Paragraph-level props (align, list marker, leading) usually ride on the
 * paragraph's own characters but sometimes only on its closing '\n'.
 */
function appParagraphs(textObj, ctx, scale) {
  const text = (Array.isArray(textObj && textObj.A) ? textObj.A : []).map((c) => (isObj(c) && typeof c.A === 'string' ? c.A : '')).join('');
  const spans = [];
  let pos = 0;
  let style = {};
  for (const d of (textObj && textObj.B) || []) {
    if (!isObj(d)) continue;
    if (d['A?'] === 'A' && isObj(d.A)) {
      for (const [k, v] of Object.entries(d.A)) {
        if (isObj(v) && 'B' in v) style[k] = v.B; else delete style[k];
      }
    } else if (d['A?'] === 'B') {
      const n = num(d.A);
      if (n > 0) { spans.push({ start: pos, end: pos + n, style: Object.assign({}, style) }); pos += n; }
    }
  }
  if (pos < text.length) spans.push({ start: pos, end: text.length, style: Object.assign({}, style) });
  const styleAt = (idx) => { for (const s of spans) if (idx >= s.start && idx < s.end) return s.style; return {}; };

  const paragraphs = [];
  let pStart = 0;
  for (let k = 0; k <= text.length; k++) {
    const atEnd = k === text.length;
    if (!atEnd && text[k] !== '\n') continue;
    if (atEnd && pStart === text.length) break; // the text ended with '\n': no dangling empty paragraph
    const terminator = atEnd ? styleAt(Math.max(0, k - 1)) : styleAt(k);
    const first = styleAt(pStart);
    const para = Object.assign({}, first, terminator);
    const runs = [];
    for (const s of spans) {
      const a = Math.max(s.start, pStart);
      const b = Math.min(s.end, k);
      if (b <= a) continue;
      runs.push(appRun(text.slice(a, b), s.style, ctx, scale));
    }
    paragraphs.push(compact({
      align: alignOf(para['text-align'], para.direction),
      list: listOf(para['list-marker']) || (num(para['list-level']) >= 1 && para['list-marker'] == null ? null : null),
      runs: mergeRuns(runs),
      lineHeight: para.leading != null ? round2(num(para.leading) / 1000) : undefined,
      dir: para.direction === 'rtl' ? 'rtl' : undefined
    }));
    pStart = k + 1;
  }
  for (const p of paragraphs) { if (p.list === null) delete p.list; if (!('list' in p)) p.list = null; }
  return paragraphs;
}
function appRun(text, st, ctx, scale) {
  const fam = String(st['font-family'] || '');
  const fm = /^([^,]+),(\d+)$/.exec(fam);
  const font = fm ? fontKey(fm[1], fm[2]) : (fam ? fontKey(fam, 0) : undefined);
  const weight = weightOf(st['font-weight']);
  const size = st['font-size'] != null ? round2(num(st['font-size']) * scale) : undefined;
  if (font) ctx.usedFonts.add(font);
  return compact({
    text,
    bold: weight >= 600 || undefined,
    weight: weight !== 400 && weight !== 700 ? weight : undefined,
    italic: /italic|oblique/i.test(String(st['font-style'] || '')) || undefined,
    underline: String(st.decoration || '') === 'underline' || undefined,
    strike: st.strikethrough && st.strikethrough !== 'none' ? true : undefined,
    upper: st['text-transform'] === 'uppercase' || undefined,
    color: toHex(st.color) || undefined,
    size,
    font,
    href: st.link ? String(st.link) : undefined,
    letterSpacing: st.tracking != null && num(st.tracking) !== 0 ? round2(num(st.tracking) / 1000) : undefined
  });
}

const ROLE_HINT = { title: 'title', subtitle: 'subtitle', heading: 'heading', paragraph: 'paragraph', decorative: 'decoration', 'websites:decorative': 'decoration', caption: 'caption', button: 'button', logo: 'logo', nav: 'nav' };
function roleOf(hint) {
  const h = String(hint || '').toLowerCase();
  if (!h) return undefined;
  if (ROLE_HINT[h]) return ROLE_HINT[h];
  if (/^heading\d*$/.test(h)) return 'heading';
  if (/^paragraph\d*$/.test(h)) return 'paragraph';
  if (/^(sub)?title\d*$/.test(h)) return h.startsWith('sub') ? 'subtitle' : 'title';
  return undefined;
}

/**
 * Element box → section coordinates through the current group transform.
 * Canva's box is { A: top, B: left, D: width, C: height } — verified on the
 * live render: a centred button reads B + D/2 = 683 on the 1366 canvas.
 */
function placeBox(el, t) {
  const w = num(el.D) * t.sx;
  const h = num(el.C) * t.sy;
  let x = t.ox + num(el.B) * t.sx;
  let y = t.oy + num(el.A) * t.sy;
  const rot = num(el.E) + t.rot;
  if (t.rot) {
    // the parent group is rotated: spin the child's centre around the group's centre
    const rad = t.rot * Math.PI / 180;
    const cx = x + w / 2 - t.cx;
    const cy = y + h / 2 - t.cy;
    const nx = t.cx + cx * Math.cos(rad) - cy * Math.sin(rad);
    const ny = t.cy + cx * Math.sin(rad) + cy * Math.cos(rad);
    x = nx - w / 2;
    y = ny - h / 2;
  }
  return { x: round2(x), y: round2(y), w: round2(w), h: round2(h), rotate: Math.abs(rot) > 0.01 ? round2(rot) : undefined };
}

/** Where an element's link points: '#page-3', a URL, or nothing. */
function linkOf(href, newTab) {
  const h = String(href || '').trim();
  if (!h) return undefined;
  const link = { href: h };
  if (newTab) link.newTab = true;
  const m = /^#(.+)$/.exec(h);
  if (m) link.anchor = m[1];
  return link;
}

function newNode(type, id, box, extra) {
  return compact(Object.assign({ id, type, x: box.x, y: box.y, w: box.w, h: box.h, rotate: box.rotate }, extra));
}

/** One Canva element (and its group children) → puppet nodes appended to `out`. */
function convertAppElement(el, t, ctx, out) {
  if (!isObj(el)) return;
  const type = el['A?'];
  const box = placeBox(el, t);
  const id = String(el._ || ('el' + (++ctx.seq)));
  const common = compact({
    z: out.length,
    opacity: num(el.F) > 0 ? round2(1 - num(el.F)) : undefined,
    link: linkOf(el.G),
    role: roleOf(el.N),
    hint: el.N ? String(el.N) : undefined
  });
  const scale = Math.max(t.sx, t.sy) || 1;
  ctx.count(type);
  if (type === 'K') {
    const paragraphs = appParagraphs(el.a, ctx, scale);
    const node = newNode('text', id, box, Object.assign(common, { paragraphs, effect: textEffect(el.j) }));
    if (!common.role) delete node.role;
    out.push(node);
  } else if (type === 'I') {
    const node = appMediaNode(el, id, box, common, ctx);
    if (node) out.push(node);
  } else if (type === 'J') {
    out.push(appShapeNode(el, id, box, common, ctx, scale));
  } else if (type === 'H') {
    const children = [];
    const localW = num(el.b) || num(el.D) || 1;
    const localH = num(el.a) || num(el.C) || 1;
    const t2 = { ox: box.x, oy: box.y, sx: t.sx * (num(el.D) / localW || 1), sy: t.sy * (num(el.C) / localH || 1), rot: box.rotate || 0, cx: box.x + box.w / 2, cy: box.y + box.h / 2 };
    for (const c of el.c || []) convertAppElement(c, t2, ctx, children);
    out.push(newNode('group', id, box, Object.assign(common, { children })));
  } else if (type === 'U') {
    out.push(newNode('line', id, box, Object.assign(common, { color: toHex(el.d) || undefined, width: num(el.a) > 0 ? round2(num(el.a) * scale) : undefined })));
  } else if (type === 'O') {
    const url = String(el.a || '');
    const meta = ctx.embeds.get(url);
    out.push(newNode('embed', id, box, Object.assign(common, { url, html: meta ? meta.html : undefined, provider: meta ? meta.title : undefined, natural: num(el.b) && num(el.c) ? { w: num(el.b), h: num(el.c) } : undefined })));
  } else if (type === 'L') {
    out.push(appGridNode(el, id, box, common, ctx));
  } else {
    ctx.skip('אלמנט מסוג לא מוכר ' + JSON.stringify(type) + ' דולג');
  }
}

/** Canva's text effect (`j.A[0].A`: hollow, shadow, lift, echo, splice, neon, glitch, outline…) → the effect's name. */
function textEffect(j) {
  if (!isObj(j) || !Array.isArray(j.A)) return undefined;
  const first = j.A.find((e) => isObj(e) && e.A);
  return first ? String(first.A).toLowerCase() : undefined;
}

/** A media fill { A: media ref, B: placement box, E: transparency, C: recolor } → image fields. */
function imageFromFill(fill, elBox, ctx) {
  const id = mediaId(fill && fill.A);
  const m = id ? ctx.media.get(id) : null;
  if (!m) return null;
  const out = {
    src: absoluteUrl(m.url, ctx.baseUrl),
    fit: 'cover',
    svg: m.svg || undefined,
    natural: m.width && m.height ? { w: m.width, h: m.height } : undefined,
    opacity: num(fill.E) > 0 ? round2(1 - num(fill.E)) : undefined,
    recolor: isObj(fill.C) && Object.keys(fill.C).length ? fill.C : undefined,
    spritesheet: m.sheet ? { wide: num(m.sheet.spritesWide), high: num(m.sheet.spritesHigh) } : undefined
  };
  const p = isObj(fill.B) ? fill.B : null;
  if (p && elBox && num(p.D) > 0 && num(p.C) > 0) {
    // the image's own box inside the element ({ A: top, B: left, D: w, C: h }): the visible window, as fractions of the picture
    const left = -num(p.B) / num(p.D);
    const top = -num(p.A) / num(p.C);
    const width = elBox.w / (num(p.D) * (elBox.scale || 1));
    const height = elBox.h / (num(p.C) * (elBox.scale || 1));
    if (Math.abs(left) > 0.005 || Math.abs(top) > 0.005 || Math.abs(width - 1) > 0.005 || Math.abs(height - 1) > 0.005) {
      out.crop = { left: round2(Math.max(0, left)), top: round2(Math.max(0, top)), width: round2(Math.min(1, width)), height: round2(Math.min(1, height)) };
    }
  }
  if (m.sheet) ctx.skip('אייקון בצבע מותאם (spritesheet ' + id + ') — הקובץ מחזיק שכבות ולא תמונה מוכנה');
  return compact(out); // no undefined keys: callers merge this over the element's own fields
}

/** An `I` element: a picture, a video, or (no media at all) a plain colored box. */
function appMediaNode(el, id, box, common, ctx) {
  const a = isObj(el.a) ? el.a : {};
  const scale = 1;
  if (isObj(a.I) && mediaId(a.I)) {
    const v = ctx.videos.get(mediaId(a.I));
    if (v && v.kind === 'STICKER' && !v.mp4 && v.gif) {
      ctx.count('sticker');
      return newNode('image', id, box, Object.assign(common, { src: absoluteUrl(v.gif, ctx.baseUrl), fit: 'contain', natural: v.width ? { w: v.width, h: v.height } : undefined, hint: common.hint || 'sticker' }));
    }
    if (v && (v.mp4 || v.hls)) {
      ctx.count('video');
      return newNode('video', id, box, Object.assign(common, { src: absoluteUrl(v.mp4 || v.hls, ctx.baseUrl), poster: v.poster ? absoluteUrl(v.poster, ctx.baseUrl) : undefined, hls: v.hls ? absoluteUrl(v.hls, ctx.baseUrl) : undefined, autoplay: true, loop: true, muted: true, natural: v.width ? { w: v.width, h: v.height } : undefined }));
    }
    ctx.skip('וידאו ' + mediaId(a.I) + ' חסר בטבלת הווידאו של הדף');
    return null;
  }
  if (isObj(a.B) && mediaId(a.B.A)) {
    const img = imageFromFill(a.B, { w: box.w, h: box.h, scale }, ctx);
    if (!img) { ctx.skip('תמונה ' + mediaId(a.B.A) + ' חסרה בטבלת המדיה של הדף'); return null; }
    if (img.opacity && common.opacity) img.opacity = round2(img.opacity * common.opacity);
    return newNode('image', id, box, Object.assign(common, img, { alt: '' }));
  }
  if (toHex(a.C)) {
    ctx.count('colorbox');
    return newNode('shape', id, box, Object.assign(common, { shape: 'rect', fill: { color: toHex(a.C) } }));
  }
  ctx.skip('מסגרת מדיה ריקה דולגה');
  return null;
}

/**
 * Walk an SVG path (M L H V C Z, absolute or relative) → { points, curves,
 * straight } — enough to tell a box from a pill from a blob.
 */
function walkPath(d) {
  const tokens = String(d || '').match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const points = [];
  const curves = [];
  let straight = 0;
  let x = 0; let y = 0; let sx = 0; let sy = 0;
  let cmd = '';
  let i = 0;
  const nextNum = () => { const v = parseFloat(tokens[i++]); return Number.isFinite(v) ? v : 0; };
  const isNum = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    if (c === 'Z') { x = sx; y = sy; if (!isNum()) continue; }
    if (!isNum() && c !== 'Z') { i++; continue; }
    if (c === 'M') { const nx = nextNum(); const ny = nextNum(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; sx = x; sy = y; points.push([x, y]); cmd = rel ? 'l' : 'L'; }
    else if (c === 'L') { const nx = nextNum(); const ny = nextNum(); x = rel ? x + nx : nx; y = rel ? y + ny : ny; points.push([x, y]); straight++; }
    else if (c === 'H') { const nx = nextNum(); x = rel ? x + nx : nx; points.push([x, y]); straight++; }
    else if (c === 'V') { const ny = nextNum(); y = rel ? y + ny : ny; points.push([x, y]); straight++; }
    else if (c === 'C') {
      const x0 = x; const y0 = y;
      nextNum(); nextNum(); nextNum(); nextNum();
      const ex = nextNum(); const ey = nextNum();
      x = rel ? x + ex : ex; y = rel ? y + ey : ey;
      curves.push({ dx: Math.abs(x - x0), dy: Math.abs(y - y0) });
      points.push([x, y]);
    } else if (c === 'Z') { /* handled */ } else { i++; }
  }
  return { points, curves, straight };
}

/** 'rect' | 'rounded' | 'ellipse' | 'path' for an SVG path, plus the corner radius of a rounded box. */
function pathShape(d) {
  const s = String(d || '').trim();
  if (!s) return { kind: 'path' };
  if (/[^MLHVCZmlhvcz\d\s,.eE+-]/.test(s)) return { kind: 'path' }; // arcs, quadratics: a real drawing
  const { points, curves, straight } = walkPath(s);
  if (!points.length) return { kind: 'path' };
  const xs = new Set(points.map((p) => round2(p[0])));
  const ys = new Set(points.map((p) => round2(p[1])));
  if (!curves.length && xs.size <= 2 && ys.size <= 2 && points.length >= 4) return { kind: 'rect' };
  if (curves.length === 4 && !straight) return { kind: 'ellipse' };
  if (curves.length === 4 && straight >= 2 && curves.every((c) => c.dx > 0 && c.dy > 0)) {
    // four corner arcs joined by straight edges: a rounded box; the arc's reach is the radius
    return { kind: 'rounded', radius: round2(Math.max(...curves.map((c) => Math.max(c.dx, c.dy)))) };
  }
  return { kind: 'path' };
}
function pathKind(d) { return pathShape(d).kind; }

/** A `J` shape: paths in a viewBox with a color or picture fill, optionally text set inside. */
function appShapeNode(el, id, box, common, ctx, scale) {
  const vb = isObj(el.a) ? el.a : { A: 0, B: 0, D: 1, C: 1 };
  const vbW = num(vb.D) || 1;
  const vbH = num(vb.C) || 1;
  const paths = Array.isArray(el.b) ? el.b.filter(isObj) : [];
  const first = paths[0] || {};
  const fillSpec = isObj(first.B) ? first.B : {};
  const shapeInfo = paths.length === 1 ? pathShape(first.A) : { kind: 'path' };
  const kind = shapeInfo.kind === 'rounded' ? 'rect' : shapeInfo.kind;
  const unitScale = Math.min(box.w / vbW, box.h / vbH);
  // the corner radius: the path's own D (a plain box with rounding) or the arcs of a rounded path
  const radiusUnits = num(first.D) || (shapeInfo.kind === 'rounded' ? shapeInfo.radius : 0);
  const radius = radiusUnits > 0 ? round2(radiusUnits * unitScale) : undefined;
  const children = [];
  for (const f of Array.isArray(el.f) ? el.f : []) {
    if (!isObj(f) || !isObj(f.A)) continue;
    const paragraphs = appParagraphs(f.A, ctx, scale);
    if (!paragraphs.length || !textLength(paragraphs)) continue; // an empty text slot
    const tb = isObj(f.D) ? f.D : vb;
    const tbox = {
      x: round2(box.x + (num(tb.B) - num(vb.B)) * box.w / vbW),
      y: round2(box.y + (num(tb.A) - num(vb.A)) * box.h / vbH),
      w: round2((num(tb.D) || vbW) * box.w / vbW),
      h: round2((num(tb.C) || vbH) * box.h / vbH),
      rotate: box.rotate
    };
    children.push(newNode('text', id + '-text', tbox, { z: 0, paragraphs, valign: f.F === 'B' ? 'middle' : f.F === 'C' ? 'bottom' : undefined }));
    ctx.count('K');
  }
  const pathField = kind === 'path' ? { viewBox: [num(vb.A), num(vb.B), vbW, vbH], d: paths.map((p) => String(p.A || '')).join(' ') } : undefined;
  const hasText = children.length > 0;
  const role = common.role || (hasText && common.link ? 'button' : undefined);
  if (fillSpec.A === true && isObj(fillSpec.B)) {
    // the picture's placement is written in the shape's own viewBox units
    const img = imageFromFill(fillSpec.B, { w: vbW, h: vbH }, ctx);
    if (img) {
      if (!hasText) {
        ctx.count('framed-image');
        const mask = shapeInfo.kind === 'ellipse' ? 'circle' : radius ? 'rounded' : kind === 'rect' ? undefined : 'shape';
        return newNode('image', id, box, Object.assign(common, img, { alt: '', mask, radius, path: pathField }));
      }
      return newNode('shape', id, box, Object.assign(common, { shape: kind, fill: { image: { src: img.src, fit: 'cover' } }, radius, path: pathField, children, role }));
    }
  }
  const color = toHex(fillSpec.C);
  const fill = color ? { color } : undefined;
  if (!fill && !hasText && paths.length && fillSpec.A !== false) ctx.skip('צורה ללא מילוי קריא (נשמרה בלי צבע)');
  return newNode('shape', id, box, Object.assign(common, { shape: kind, fill, radius, path: pathField, children: hasText ? children : undefined, role }));
}

/** An `L` photo grid: cells named in `b.A`, tracks in `b.B` (columns) / `b.C` (rows), gaps `b.D` / `b.E`. */
function appGridNode(el, id, box, common, ctx) {
  const spec = isObj(el.b) ? el.b : {};
  const cells = isObj(el.a) && isObj(el.a.a) ? el.a.a : {};
  const areas = Array.isArray(spec.A) ? spec.A.map((r) => (isObj(r) && Array.isArray(r.A) ? r.A : [])) : [];
  const gapX = num(spec.D);
  const gapY = num(spec.E, gapX);
  const cols = trackSizes((spec.B || ['1fr']).join(' '), { vw: DESIGN_WIDTH }, box.w - gapX * Math.max(0, (spec.B || [1]).length - 1));
  const rows = trackSizes((spec.C || ['1fr']).join(' '), { vw: DESIGN_WIDTH }, box.h - gapY * Math.max(0, (spec.C || [1]).length - 1));
  const colAt = (i) => cols.slice(0, i).reduce((s, v) => s + v, 0) + gapX * i;
  const rowAt = (i) => rows.slice(0, i).reduce((s, v) => s + v, 0) + gapY * i;
  const children = [];
  for (const [name, cell] of Object.entries(cells)) {
    let r1 = Infinity; let r2 = -1; let c1 = Infinity; let c2 = -1;
    areas.forEach((row, ri) => row.forEach((n, ci) => { if (n === name) { r1 = Math.min(r1, ri); r2 = Math.max(r2, ri); c1 = Math.min(c1, ci); c2 = Math.max(c2, ci); } }));
    if (r2 < 0) continue;
    const cbox = { x: round2(box.x + colAt(c1)), y: round2(box.y + rowAt(r1)), w: round2(colAt(c2 + 1) - gapX - colAt(c1)), h: round2(rowAt(r2 + 1) - gapY - rowAt(r1)), rotate: box.rotate };
    const fill = isObj(cell) && isObj(cell.A) && isObj(cell.A.B) ? cell.A.B : null;
    if (!fill || !mediaId(fill.A)) continue; // an empty placeholder cell
    const img = imageFromFill(fill, { w: cbox.w, h: cbox.h }, ctx);
    if (!img) continue;
    children.push(newNode('image', id + '-' + name, cbox, Object.assign({ z: children.length, alt: '', hint: cell.A.E ? String(cell.A.E) : undefined }, img)));
    ctx.count('I');
  }
  return newNode('frame', id, box, Object.assign(common, { layout: { mode: 'grid', columns: cols.length, gap: gapX }, children }));
}

/** Page background `D` → section fill (+ a role hint such as 'hero'). */
function appSectionFill(D, ctx) {
  const d = isObj(D) ? D : {};
  const fill = { color: toHex(d.C), gradient: null, image: null, video: null };
  const bg = isObj(d.B) ? d.B : null;
  const id = bg ? mediaId(bg.A) : '';
  if (id && ctx.videos.has(id)) {
    const v = ctx.videos.get(id);
    fill.video = { src: absoluteUrl(v.mp4 || v.hls, ctx.baseUrl), poster: v.poster ? absoluteUrl(v.poster, ctx.baseUrl) : '' };
  } else if (id) {
    const img = imageFromFill(bg, null, ctx);
    if (img) fill.image = compact({ src: img.src, fit: 'cover', opacity: num(bg.E) > 0 ? round2(1 - num(bg.E)) : 1 });
    else ctx.skip('תמונת רקע ' + id + ' חסרה בטבלת המדיה של הדף');
  }
  return fill;
}

function decodeAppPage(html, pageUrl, site, shared) {
  const boot = extractBootstrap(html);
  const page = boot && isObj(boot.page) ? boot.page : null;
  const doc = page && isObj(page.A) ? page.A : null;
  if (!doc || !Array.isArray(doc.A)) { shared.notes.push(pageUrl + ': לא נמצא עיצוב בתוך ה-bootstrap של הדף'); return null; }
  const meta = headMeta(html, pageUrl);
  const ctx = {
    baseUrl: meta.baseUrl,
    media: readMediaTable(page.E),
    videos: readVideoTable(page.F),
    embeds: new Map((page.H || []).filter(isObj).map((h) => [String(h.A || ''), { title: h.B ? String(h.B) : '', html: h.E ? String(h.E) : '' }])),
    usedFonts: shared.usedFonts,
    seq: 0,
    counts: {},
    count(k) { this.counts[k] = (this.counts[k] || 0) + 1; },
    skip(msg) { shared.skipped[msg] = (shared.skipped[msg] || 0) + 1; }
  };
  readFontTable(page.B, shared.fonts);
  const defaultW = num(doc.C && doc.C.A, DESIGN_WIDTH) || DESIGN_WIDTH;
  const defaultH = num(doc.C && doc.C.B, 768) || 768;
  const sections = [];
  doc.A.forEach((pg, i) => {
    if (!isObj(pg)) return;
    const elementsList = Array.isArray(pg.E) ? pg.E : [];
    if (pg.S === true && !elementsList.length) { ctx.skip('עמוד ריק שסומן כמוסתר (S=true) דולג'); return; }
    const nodes = [];
    const t = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0, cx: 0, cy: 0 };
    for (const el of elementsList) convertAppElement(el, t, ctx, nodes);
    nodes.forEach((n, z) => { n.z = z; });
    const width = num(pg.C && pg.C.A, defaultW) || defaultW;
    const height = num(pg.C && pg.C.B, defaultH) || defaultH;
    const D = isObj(pg.D) ? pg.D : {};
    sections.push(compact({
      key: String(pg.a || ('page' + i)),
      anchor: pg.P != null && pg.P !== '' ? 'page-' + pg.P : undefined,
      name: pg.B ? String(pg.B) : undefined,
      title: pg.F ? String(pg.F) : undefined,
      height: round2(height),
      width: width !== DESIGN_WIDTH ? width : undefined,
      fill: appSectionFill(D, ctx),
      role: D.E ? roleOf(D.E) || String(D.E) : undefined,
      layout: null,
      nodes
    }));
  });
  const brand = isObj(page.K) ? [toHex(page.K.B), toHex(page.K.C)].filter(Boolean) : [];
  return {
    format: 'canva-app',
    meta,
    page: compact({
      key: meta.designId || '',
      path: urlParts(pageUrl).path,
      title: meta.title || String(doc.D || ''),
      name: '',
      description: String(doc.E || '') || meta.description,
      width: defaultW,
      designTitle: doc.D ? String(doc.D) : undefined,
      lang: doc.P ? String(doc.P) : undefined,
      sections
    }),
    brand,
    counts: ctx.counts
  };
}

// ── 8. the static format ──────────────────────────────────────────────────

const CONTENT_TAGS = new Set(['p', 'ul', 'ol', 'img', 'video', 'svg', 'iframe']);
const ANIM = [[/fade/i, 'fade'], [/zoom|scale|breathe|grow/i, 'zoom'], [/pop|slide|pan|wipe|rise|drift|fly|tumble|ascend|neon|baseline|block|burst|stomp|roll|spin|shift|skate|bounce|clarify|disco|tectonic|typewriter|instant|ripple|animate/i, 'rise']];
function animOf(animation) {
  const a = String(animation || '');
  if (!a || /infinite/.test(a)) return undefined; // the infinite pulse is a hover decoration
  for (const [re, name] of ANIM) if (re.test(a)) return name;
  return undefined;
}

/** Everything about one static page the section readers need. */
function staticContext(html, pageUrl, shared) {
  const sheet = new StyleSheet(html);
  const meta = headMeta(html, pageUrl);
  const desktopQ = sheet.mediaFor(DESIGN_WIDTH);
  const phoneQ = sheet.mediaFor(PHONE_WIDTH);
  const ctx = {
    sheet,
    meta,
    baseUrl: meta.baseUrl,
    pageUrl,
    desktopQ,
    phoneQ: phoneQ && phoneQ !== desktopQ ? phoneQ : '',
    counts: {},
    usedFonts: shared.usedFonts,
    seq: 0,
    count(k) { this.counts[k] = (this.counts[k] || 0) + 1; },
    skip(msg) { shared.skipped[msg] = (shared.skipped[msg] || 0) + 1; }
  };
  /** Cascaded declarations of an element at a breakpoint: its CSS rule under its inline style. */
  ctx.decls = (el, query) => {
    const id = el.attrs && el.attrs.id;
    const fromCss = id ? sheet.declsFor(id, query) : null;
    return Object.assign({}, fromCss || {}, inlineStyle(el));
  };
  /** A custom property (`--first-font-size`) the way CSS inherits it: nearest ancestor that defines it. */
  ctx.varLookup = (el, query) => (name) => {
    for (let n = el; n && n.tag !== '#root'; n = n.parent) {
      const d = ctx.decls(n, query);
      if (d[name] != null) return d[name];
    }
    return null;
  };
  return ctx;
}

/** grid-template-columns/rows of the content grid at one breakpoint → { cols, rows } line offsets. */
function gridLines(gridEl, ctx, query, vw) {
  const d = ctx.decls(gridEl, query);
  const lctx = { vw, em: REM_AT(vw), pct: vw, vars: ctx.varLookup(gridEl, query) };
  const cols = trackSizes(d['grid-template-columns'] || '100rem', lctx, vw);
  const rows = trackSizes(d['grid-template-rows'] || '', lctx, 0);
  return { cols: lines(cols), rows: lines(rows), width: cols.reduce((s, v) => s + v, 0), height: rows.reduce((s, v) => s + v, 0) };
}

/** The wrapper's box on a breakpoint grid: grid-area lines, then margins, then the design min-width / aspect. */
function wrapperBox(wrapper, d, grid, ctx, query, vw) {
  const area = gridArea(d);
  if (!area) return null;
  const clampLine = (arr, i) => arr[Math.max(0, Math.min(arr.length - 1, i - 1))];
  let x = clampLine(grid.cols, area.c1);
  let y = clampLine(grid.rows, area.r1);
  let w = clampLine(grid.cols, area.c2) - x;
  let h = clampLine(grid.rows, area.r2) - y;
  const lctx = { vw, em: REM_AT(vw), pct: w, vars: ctx.varLookup(wrapper, query) };
  const ml = evalLength(d['margin-left'], lctx);
  const mr = evalLength(d['margin-right'], lctx);
  const mt = evalLength(d['margin-top'], lctx);
  const mb = evalLength(d['margin-bottom'], lctx);
  x += ml; w -= ml + mr; y += mt; h -= mt + mb;
  // the designer's own box rides on the inner wrappers: min-width (text) and padding-top (aspect)
  let minW = 0;
  let aspect = 0;
  let rotate = 0;
  let opacity = 1;
  let anim;
  let clip = false;
  const walkInner = (n, depth) => {
    if (depth > 8) return;
    for (const c of elements(n)) {
      if (CONTENT_TAGS.has(c.tag)) continue;
      const cd = ctx.decls(c, query);
      if (cd['grid-template-columns'] || cd['grid-template-rows']) continue; // a group's inner grid: its members size themselves
      if (!minW && cd['min-width']) minW = evalLength(cd['min-width'], lctx);
      if (!aspect && cd['padding-top'] && /%/.test(cd['padding-top'])) aspect = parseFloat(cd['padding-top']) / 100;
      const rot = /rotate\(\s*(-?[\d.]+)deg/.exec(cd.transform || '');
      if (rot && Math.abs(parseFloat(rot[1])) > 0.01) rotate += parseFloat(rot[1]);
      if (cd.opacity != null && cd.opacity !== '') opacity *= num(cd.opacity, 1);
      if (!anim) anim = animOf(cd.animation);
      if (cd['clip-path']) clip = true;
      walkInner(c, depth + 1);
    }
  };
  walkInner(wrapper, 0);
  if (minW > 0) w = minW;
  if (aspect > 0 && w > 0) h = w * aspect;
  return { x: round2(x), y: round2(y), w: round2(Math.max(0, w)), h: round2(Math.max(0, h)), rotate: Math.abs(rotate) > 0.01 ? round2(rotate) : undefined, opacity: opacity < 0.999 ? round2(opacity) : undefined, anim, area, clip };
}

/** The font size of a <p>/<li> at the desktop breakpoint, in design px. */
function fontSizeOf(el, ctx) {
  for (let n = el; n && n.tag !== '#root'; n = n.parent) {
    const d = ctx.decls(n, ctx.desktopQ);
    if (d['font-size']) {
      const v = evalLength(d['font-size'], { vw: DESIGN_WIDTH, em: REM_AT(DESIGN_WIDTH), pct: REM_AT(DESIGN_WIDTH), vars: ctx.varLookup(n, ctx.desktopQ) });
      if (v > 0) return round2(v);
    }
  }
  return undefined;
}

function staticRunStyle(el, inherited, ctx) {
  const d = inlineStyle(el);
  const st = Object.assign({}, inherited);
  if (d.color) st.color = toHex(d.color) || st.color;
  if (d['font-weight']) st.weight = weightOf(d['font-weight']);
  if (d['font-style']) st.italic = /italic|oblique/.test(d['font-style']);
  if (d['text-decoration-line'] || d['text-decoration']) {
    const td = d['text-decoration-line'] || d['text-decoration'];
    st.underline = /underline/.test(td);
    st.strike = /line-through/.test(td);
  }
  if (d['text-transform']) st.upper = d['text-transform'] === 'uppercase';
  if (d['font-family']) st.font = d['font-family'].replace(/^['"]|['"]$/g, '').split(',')[0].trim();
  if (d['letter-spacing']) st.letterSpacing = round2(num(d['letter-spacing']));
  if (el.tag === 'a' && el.attrs.href) st.href = el.attrs.href;
  return st;
}
function staticRun(text, st, ctx) {
  if (st.font) ctx.usedFonts.add(st.font);
  return compact({
    text,
    bold: st.weight >= 600 || undefined,
    weight: st.weight && st.weight !== 400 && st.weight !== 700 ? st.weight : undefined,
    italic: st.italic || undefined,
    underline: st.underline || undefined,
    strike: st.strike || undefined,
    upper: st.upper || undefined,
    color: st.color || undefined,
    size: st.size,
    font: st.font,
    href: st.href,
    letterSpacing: st.letterSpacing || undefined
  });
}

/**
 * One <p>/<li> → paragraphs. A <br> inside the text is a line break Canva
 * stores as '\n' — a new paragraph in the puppet, exactly like the app format;
 * the trailing <br> every Canva paragraph ends with is only the terminator.
 */
function staticParagraphs(p, ctx, base) {
  const d = inlineStyle(p);
  const dir = d.direction === 'rtl' ? 'rtl' : base.dir;
  const align = alignOf(d['text-align'], dir);
  const list = p.tag === 'li' ? (listOf(d['list-style-type']) || 'bullet') : null;
  const lineHeight = d['line-height'] && /em$/.test(d['line-height']) ? round2(num(d['line-height'])) : undefined;
  const pre = /pre/.test(d['white-space'] || '');
  const pStyle = staticRunStyle(p, Object.assign({}, base, { size: fontSizeOf(p, ctx) }), ctx);
  const paragraphs = [];
  let runs = [];
  const flush = () => { paragraphs.push(compact({ align, list, runs: mergeRuns(runs), lineHeight, dir: dir === 'rtl' ? 'rtl' : undefined })); runs = []; };
  const visit = (n, st) => {
    for (const c of n.children || []) {
      if (c.tag === '#text') {
        const raw = decodeEntities(c.text);
        const t = pre ? raw : raw.replace(/\s+/g, ' ');
        if (t) runs.push(staticRun(t, st, ctx));
      } else if (c.tag === 'br') {
        const trailing = !c.parent.children.slice(c.parent.children.indexOf(c) + 1).some((s) => s.tag !== '#text' || s.text.trim());
        if (trailing && n === p) continue; // the terminator
        flush();
      } else if (c.tag === 'script' || c.tag === 'style') {
        continue;
      } else {
        visit(c, staticRunStyle(c, st, ctx));
      }
    }
  };
  visit(p, pStyle);
  flush();
  for (const para of paragraphs) { if (!('list' in para)) para.list = null; if (para.list === undefined) para.list = null; }
  // an empty <p><br></p> stays as one empty paragraph (a blank line the designer left)
  return paragraphs;
}

/** The flex column holding <p>/<ul> → one text node. */
function staticTextNode(container, id, box, ctx, extra) {
  const base = { dir: ctx.meta.dir === 'rtl' ? 'rtl' : 'ltr' };
  const paragraphs = [];
  const blocks = findAll(container, (n) => n.tag === 'p' || n.tag === 'li').filter((n) => !findFirst(n, (m) => m.tag === 'p' || m.tag === 'li'));
  for (const b of blocks) paragraphs.push(...staticParagraphs(b, ctx, base));
  // the same effects the app format names: a stroked, unfilled text is Canva's "hollow", a text-shadow its "shadow"
  const hollow = blocks.some((b) => /text-stroke/.test(b.attrs.style || '') && /fill-color:\s*transparent/.test(b.attrs.style || ''));
  const shadow = blocks.some((b) => /text-shadow/.test(b.attrs.style || ''));
  ctx.count('text');
  return newNode('text', id, box, Object.assign({}, extra, { paragraphs, effect: hollow ? 'hollow' : shadow ? 'shadow' : undefined }));
}

function largestSrc(img, baseUrl) {
  const set = String(img.attrs.srcset || '');
  let best = '';
  let bestW = -1;
  for (const cand of set.split(',')) {
    const m = /^\s*(\S+)\s+([\d.]+)w\s*$/.exec(cand);
    if (m && parseFloat(m[2]) > bestW) { bestW = parseFloat(m[2]); best = m[1]; }
  }
  return absoluteUrl(best || img.attrs.src || '', baseUrl);
}

function staticImageNode(img, id, box, ctx, extra, clip) {
  const src = largestSrc(img, ctx.baseUrl);
  if (!src) { ctx.skip('תמונה (<img>) ללא כתובת דולגה'); return null; }
  const d = inlineStyle(img);
  ctx.count('image');
  return newNode('image', id, box, Object.assign({}, extra, {
    src,
    alt: decodeEntities(img.attrs.alt || ''),
    // `fill` only appears on a picture already cropped by its frame — that is a cover, not a letterbox
    fit: /contain|none/.test(d['object-fit'] || '') ? 'contain' : 'cover',
    svg: /\.svg(\?|$)/i.test(src) || undefined,
    mask: clip ? clip : undefined,
    position: d['object-position'] && d['object-position'] !== '50% 50%' ? d['object-position'] : undefined
  }));
}

function staticVideoNode(video, id, box, ctx, extra) {
  const src = absoluteUrl(video.attrs.src || (findFirst(video, (n) => n.tag === 'source') || { attrs: {} }).attrs.src || '', ctx.baseUrl);
  if (!src) { ctx.skip('וידאו (<video>) ללא כתובת דולג'); return null; }
  ctx.count('video');
  return newNode('video', id, box, Object.assign({}, extra, {
    src,
    poster: video.attrs.poster ? absoluteUrl(video.attrs.poster, ctx.baseUrl) : undefined,
    autoplay: 'autoplay' in video.attrs || undefined,
    loop: 'loop' in video.attrs || undefined,
    muted: 'muted' in video.attrs || undefined,
    controls: 'controls' in video.attrs || undefined
  }));
}

function staticEmbedNode(iframe, id, box, ctx, extra) {
  const src = String(iframe.attrs.src || '');
  if (!src) { ctx.skip('הטמעה (<iframe>) ללא כתובת דולגה'); return null; }
  let url = src;
  try { const u = new URL(src); const real = u.searchParams.get('url'); if (real) url = real; } catch (e) { /* keep src */ }
  let provider;
  try { provider = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { provider = undefined; }
  const attrs = Object.entries(iframe.attrs).map(([k, v]) => k + '="' + String(v).replace(/"/g, '&quot;') + '"').join(' ');
  const holder = iframe.parent && iframe.parent.attrs ? iframe.parent.attrs : {};
  ctx.count('embed');
  return newNode('embed', id, box, Object.assign({}, extra, {
    url,
    html: '<iframe ' + attrs + '></iframe>',
    provider,
    natural: holder['data-content-width'] ? { w: num(holder['data-content-width']), h: num(holder['data-content-height']) } : undefined
  }));
}

/** A shape's clip path: is it a circle / a rounded box / an arbitrary path? */
function clipKind(svg) {
  const cp = findFirst(svg, (n) => n.tag === 'clippath');
  const p = cp ? findFirst(cp, (n) => n.tag === 'path') : null;
  let d = p ? p.attrs.d : '';
  if (!d) {
    // the newer export clips with CSS: clip-path: path('M…') on the div inside the foreignObject
    const clipped = findFirst(svg, (n) => /path\(/.test(inlineStyle(n)['clip-path'] || ''));
    const m = clipped ? /path\(\s*['"]?([^'")]+)/.exec(inlineStyle(clipped)['clip-path']) : null;
    if (m) d = m[1];
  }
  const kind = pathKind(d);
  if (kind === 'ellipse') return 'circle';
  if (kind === 'rounded') return 'rounded';
  if (kind === 'rect') return undefined;
  return 'shape';
}

/** An inline <svg>: a framed picture, a line, or a shape. */
function staticSvgNode(svg, id, box, ctx, extra) {
  const inner = findFirst(svg, (n) => n.tag === 'img' || n.tag === 'image' || n.tag === 'video');
  if (inner) {
    const mask = clipKind(svg);
    if (inner.tag === 'video') return staticVideoNode(inner, id, box, ctx, Object.assign({}, extra, { mask }));
    if (inner.tag === 'image') {
      const src = absoluteUrl(inner.attrs.href || inner.attrs['xlink:href'] || '', ctx.baseUrl);
      if (!src) return null;
      ctx.count('image');
      return newNode('image', id, box, Object.assign({}, extra, { src, alt: '', fit: 'cover', mask: mask || 'shape', svg: /\.svg(\?|$)/i.test(src) || undefined }));
    }
    return staticImageNode(inner, id, box, ctx, extra, mask || 'shape');
  }
  const svgStyle = inlineStyle(svg);
  const paths = findAll(svg, (n) => n.tag === 'path' && !(n.parent && n.parent.tag === 'clippath'));
  const linesEls = findAll(svg, (n) => n.tag === 'line');
  const vb = String(svg.attrs.viewbox || svg.attrs.viewBox || '').trim().split(/[\s,]+/).map(parseFloat);
  const vbW = vb.length === 4 && vb[2] > 0 ? vb[2] : box.w || 1;
  const vbH = vb.length === 4 && vb[3] > 0 ? vb[3] : box.h || 1;
  const styleOf = (n) => Object.assign({}, inlineStyle(svg), inlineStyle(n));
  const strokePx = (n) => {
    const s = styleOf(n);
    const sw = s['stroke-width'] || n.attrs['stroke-width'];
    const scale = Math.min(box.w / vbW, box.h / vbH) || 1;
    return sw ? round2(num(sw) * (/px$/.test(String(sw)) ? 1 : scale)) : undefined;
  };
  const strokeColor = (n) => { const s = styleOf(n); return toHex(s.stroke || n.attrs.stroke) || undefined; };
  const opacityOf = (n) => { const o = num(styleOf(n).opacity, 1); return o < 0.999 ? round2(o) : undefined; };
  // a line: <line> or a stroke-only straight path
  const straight = (n) => /^M\s*-?[\d.]+[ ,]-?[\d.]+\s*L\s*-?[\d.]+[ ,]-?[\d.]+\s*$/.test(String(n.attrs.d || '').trim());
  const lineEl = linesEls[0] || paths.find((p) => straight(p) && /fill:\s*none/.test(inlineStyle(p).fill ? 'fill:' + inlineStyle(p).fill : '') );
  if (lineEl || (paths.length && paths.every((p) => straight(p)))) {
    const n = lineEl || paths[0];
    ctx.count('line');
    const thickness = strokePx(n) || Math.min(box.w, box.h) || 1;
    return newNode('line', id, box, Object.assign({}, extra, { color: strokeColor(n) || toHex(svgStyle.fill) || undefined, width: round2(thickness), opacity: extra.opacity || opacityOf(n) }));
  }
  const filled = paths.filter((p) => { const s = styleOf(p); return s.fill && s.fill !== 'none' && s.fill !== 'transparent'; });
  const stroked = paths.filter((p) => { const s = styleOf(p); return s.stroke && s.stroke !== 'none' && s.stroke !== 'transparent'; });
  const main = filled[0] || stroked[0] || paths[0];
  if (!main) { ctx.skip('צורה (<svg>) ללא נתיבים דולגה'); return null; }
  // one drawing per path is the rule; several paths of the same simple kind (the outline twins) stay that kind
  const shapes = paths.map((p) => pathShape(p.attrs.d));
  const uniform = shapes.every((s) => s.kind === shapes[0].kind);
  const info = uniform ? shapes[0] : { kind: 'path' };
  const kind = info.kind === 'rounded' ? 'rect' : info.kind;
  const radius = info.kind === 'rounded' ? round2(info.radius * (Math.min(box.w / vbW, box.h / vbH) || 1)) : undefined;
  const color = filled.length ? toHex(styleOf(filled[0]).fill) : null;
  const opacity = opacityOf(main);
  ctx.count('shape');
  return newNode('shape', id, box, Object.assign({}, extra, {
    shape: kind,
    fill: color ? { color } : undefined,
    stroke: stroked.length ? compact({ color: strokeColor(stroked[0]), width: strokePx(stroked[0]) || 1 }) : undefined,
    radius,
    path: kind === 'path' ? { viewBox: vb.length === 4 ? vb : [0, 0, vbW, vbH], d: (filled.length ? filled : paths).map((p) => String(p.attrs.d || '')).join(' ') } : undefined,
    opacity: extra.opacity != null ? extra.opacity : opacity
  }));
}

/**
 * The content items inside one wrapper, in document order. Canva emits one
 * variant of a shape per breakpoint (four <svg>s, `display:none` on all but
 * one) — only what the desktop shows is content; a member hidden on the phone
 * alone is flagged so the node's mobile layout can say so.
 */
function collectContent(wrapper, ctx) {
  const items = [];
  const hiddenAt = (el, query) => /none/.test(ctx.decls(el, query).display || '');
  // parents that hold a phone-only twin: a member hidden there on the phone is swapped, not removed
  const swapped = new Set();
  if (ctx.phoneQ) findAll(wrapper, (el) => hiddenAt(el, ctx.desktopQ) && !hiddenAt(el, ctx.phoneQ)).forEach((el) => swapped.add(el.parent));
  const visit = (n, link, phoneHidden) => {
    for (const c of elements(n)) {
      if (hiddenAt(c, ctx.desktopQ)) { if (ctx.phoneQ && !hiddenAt(c, ctx.phoneQ)) ctx.skip('גרסת-טלפון של אלמנט (מוצגת רק במובייל) לא הומרה'); continue; }
      const ph = phoneHidden || (ctx.phoneQ && !swapped.has(c.parent) ? hiddenAt(c, ctx.phoneQ) : false);
      let l = link;
      if (c.tag === 'a' && c.attrs.href) l = c;
      if (c.tag === 'p' || c.tag === 'ul' || c.tag === 'ol') {
        // the text container is the flex column holding the paragraphs
        const holder = c.parent && c.parent.tag !== 'a' ? c.parent : c;
        if (!items.some((it) => it.kind === 'text' && it.el === holder)) items.push({ kind: 'text', el: holder, link: l, phoneHidden: ph });
        continue;
      }
      if (c.tag === 'img') { items.push({ kind: 'img', el: c, link: l, phoneHidden: ph }); continue; }
      if (c.tag === 'video') { items.push({ kind: 'video', el: c, link: l, phoneHidden: ph }); continue; }
      if (c.tag === 'svg') { items.push({ kind: 'svg', el: c, link: l, phoneHidden: ph }); continue; }
      if (c.tag === 'iframe') { items.push({ kind: 'iframe', el: c, link: l, phoneHidden: ph }); continue; }
      if (c.attrs['data-lottie-src'] || /vector-sticker/.test(c.attrs.class || '')) { items.push({ kind: 'lottie', el: c, link: l, phoneHidden: ph }); continue; }
      visit(c, l, ph);
    }
  };
  visit(wrapper, null, false);
  return items;
}

/** A grouped wrapper carries an inner grid of its own; find it (before any content). */
function innerGridOf(wrapper, ctx) {
  const isGrid = (el) => { const d = ctx.decls(el, ctx.desktopQ); return !!(d['grid-template-columns'] || d['grid-template-rows']); };
  const search = (n, depth) => {
    if (depth > 4) return null;
    for (const c of elements(n)) {
      if (CONTENT_TAGS.has(c.tag)) continue;
      if (isGrid(c)) return c;
      const r = search(c, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return search(wrapper, 0);
}

/** Move a node (and its children) by dx/dy — a group's members are laid out in the group's own grid. */
function shiftNode(node, dx, dy, mdx, mdy) {
  node.x = round2(node.x + dx);
  node.y = round2(node.y + dy);
  if (node.mobile && node.mobile.x != null) { node.mobile.x = round2(node.mobile.x + mdx); node.mobile.y = round2(node.mobile.y + mdy); }
  for (const c of node.children || []) shiftNode(c, dx, dy, mdx, mdy);
}

/** Paint order: array order must agree with z (stable sort), then the phone order among siblings. */
function finishNodes(nodes) {
  nodes.forEach((n, i) => { n._i = i; });
  nodes.sort((a, b) => (num(a.z) - num(b.z)) || (a._i - b._i));
  nodes.forEach((n, i) => { n.z = i; delete n._i; });
  const withMobile = nodes.filter((n) => n.mobile && n.mobile._row != null);
  withMobile.sort((a, b) => (a.mobile._row - b.mobile._row) || (a.mobile._col - b.mobile._col));
  withMobile.forEach((n, i) => { n.mobile.order = i + 1; });
  for (const n of nodes) {
    if (n.mobile) { delete n.mobile._row; delete n.mobile._col; }
    if (n.children && n.type === 'group') finishNodes(n.children);
  }
}

/**
 * One wrapper of a grid → a node (or null when nothing renders). A wrapper
 * either holds content (text / picture / video / shape / embed) or an inner
 * grid of member wrappers — a Canva group — which is read the same way,
 * recursively, and comes back as a `group` with its members in section
 * coordinates.
 */
function convertWrapper(wrapper, grid, phoneGrid, ctx) {
  const d = ctx.decls(wrapper, ctx.desktopQ);
  const box = wrapperBox(wrapper, d, grid, ctx, ctx.desktopQ, DESIGN_WIDTH);
  if (!box) { ctx.skip('אלמנט ללא מיקום ברשת (grid-area) דולג'); return null; }
  if (/none/.test(d.display || '')) return null; // hidden on the desktop itself
  const id = String(wrapper.attrs.id || ('w' + (++ctx.seq)));
  const extra = compact({ z: num(d['z-index']), opacity: box.opacity, anim: box.anim });
  let mobile;
  let pbox = null;
  if (ctx.phoneQ && phoneGrid) {
    const pd = ctx.decls(wrapper, ctx.phoneQ);
    pbox = wrapperBox(wrapper, pd, phoneGrid, ctx, ctx.phoneQ, PHONE_WIDTH);
    if (pbox) mobile = compact({ hidden: /none/.test(pd.display || '') || undefined, _row: pbox.area.r1, _col: pbox.area.c1, x: pbox.x, y: pbox.y, w: pbox.w, h: pbox.h });
  }
  const inner = innerGridOf(wrapper, ctx);
  if (inner) {
    const innerGrid = gridLines(inner, ctx, ctx.desktopQ, DESIGN_WIDTH);
    const innerPhone = ctx.phoneQ ? gridLines(inner, ctx, ctx.phoneQ, PHONE_WIDTH) : null;
    const children = [];
    for (const w of elements(inner)) {
      const n = convertWrapper(w, innerGrid, innerPhone, ctx);
      if (n) children.push(n);
    }
    if (!children.length) return null;
    for (const c of children) shiftNode(c, box.x, box.y, pbox ? pbox.x : 0, pbox ? pbox.y : 0);
    ctx.count('group');
    const node = newNode('group', id, box, Object.assign({}, extra, { children }));
    if (mobile) node.mobile = mobile;
    return node;
  }
  const items = collectContent(wrapper, ctx);
  const link = (it) => (it.link ? linkOf(it.link.attrs.href, it.link.attrs.target === '_blank') : undefined);
  const nodes = [];
  for (const it of items) {
    const nid = nodes.length ? id + '-' + nodes.length : id;
    const ex = Object.assign({}, extra, { link: link(it) });
    let n = null;
    if (it.kind === 'text') n = staticTextNode(it.el, nid, box, ctx, ex);
    else if (it.kind === 'img') n = staticImageNode(it.el, nid, box, ctx, ex, box.clip ? 'shape' : undefined);
    else if (it.kind === 'video') n = staticVideoNode(it.el, nid, box, ctx, ex);
    else if (it.kind === 'svg') n = staticSvgNode(it.el, nid, box, ctx, ex);
    else if (it.kind === 'iframe') n = staticEmbedNode(it.el, nid, box, ctx, ex);
    else if (it.kind === 'lottie') ctx.skip('סטיקר מונפש (Lottie JSON) הושמט — אין לו תמונה');
    if (n && it.phoneHidden && ctx.phoneQ) n.mobile = Object.assign({}, n.mobile, { hidden: true });
    if (n) nodes.push(n);
  }
  if (!nodes.length) return null;
  let node;
  if (nodes.length === 1) node = nodes[0];
  else if (nodes.length === 2 && nodes[0].type === 'shape' && nodes[1].type === 'text') {
    // a button: the shape with its label set inside (the link may sit on the label's runs)
    node = nodes[0];
    node.children = [nodes[1]];
    const runLink = (nodes[1].paragraphs || []).flatMap((p) => p.runs).map((r) => r.href).find(Boolean);
    if (node.link || nodes[1].link || runLink) node.role = 'button';
    if (!node.link) node.link = nodes[1].link || linkOf(runLink);
  } else node = newNode('group', id, box, Object.assign({}, extra, { children: nodes }));
  if (mobile) node.mobile = Object.assign({}, mobile, node.mobile || {});
  return node;
}

/**
 * The section's backdrop layer → fill. Older exports put the color on the
 * layer itself; the middle generation nests it a few wrappers down, so the
 * first element carrying a background-color anywhere inside the layer wins.
 */
function staticSectionFill(bg, ctx) {
  const fill = { color: null, gradient: null, image: null, video: null };
  if (!bg) return fill;
  const colored = inlineStyle(bg)['background-color'] ? bg : findFirst(bg, (n) => !!inlineStyle(n)['background-color']);
  const d = colored ? inlineStyle(colored) : inlineStyle(bg);
  fill.color = toHex(d['background-color']) || null;
  if (/gradient\(/.test(d['background-image'] || d.background || '')) fill.gradient = d['background-image'] || d.background;
  const layerOpacity = num(inlineStyle(bg).opacity, 1) * (colored && colored !== bg ? num(d.opacity, 1) : 1);
  const withImage = findFirst(bg, (n) => /url\(/.test(inlineStyle(n)['background-image'] || ''));
  const img = findFirst(bg, (n) => n.tag === 'img');
  const video = findFirst(bg, (n) => n.tag === 'video');
  if (video && (video.attrs.src || findFirst(video, (n) => n.tag === 'source'))) {
    const src = video.attrs.src || findFirst(video, (n) => n.tag === 'source').attrs.src;
    fill.video = { src: absoluteUrl(src, ctx.baseUrl), poster: video.attrs.poster ? absoluteUrl(video.attrs.poster, ctx.baseUrl) : '' };
  } else if (withImage) {
    const s = inlineStyle(withImage);
    const m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(s['background-image']);
    if (m) fill.image = { src: absoluteUrl(m[1], ctx.baseUrl), fit: /contain/.test(s['background-size'] || '') ? 'contain' : 'cover', opacity: round2(num(s.opacity, 1) * layerOpacity) };
  } else if (img) {
    fill.image = { src: largestSrc(img, ctx.baseUrl), fit: /contain/.test(inlineStyle(img)['object-fit'] || '') ? 'contain' : 'cover', opacity: round2(num(inlineStyle(img).opacity, 1) * layerOpacity) };
  }
  return fill;
}

function decodeStaticSection(sec, anchorHint, ctx, index) {
  const kids = elements(sec);
  const isBackdrop = (el) => { const d = ctx.decls(el, ctx.desktopQ); return /absolute/.test(d.position || '') || (/100%/.test(d.width || '') && /100%/.test(d.height || '')); };
  const bg = kids.find(isBackdrop) || null;
  const gridEl = kids.find((k) => k !== bg && (ctx.decls(k, ctx.desktopQ)['grid-template-columns'] || ctx.decls(k, ctx.desktopQ)['grid-template-rows'])) || kids.find((k) => k !== bg) || null;
  const grid = gridEl ? gridLines(gridEl, ctx, ctx.desktopQ, DESIGN_WIDTH) : { cols: [0, DESIGN_WIDTH], rows: [0], width: DESIGN_WIDTH, height: 0 };
  const phoneGrid = gridEl && ctx.phoneQ ? gridLines(gridEl, ctx, ctx.phoneQ, PHONE_WIDTH) : null;
  const nodes = [];
  for (const w of gridEl ? elements(gridEl) : []) {
    const n = convertWrapper(w, grid, phoneGrid, ctx);
    if (n) nodes.push(n);
  }
  finishNodes(nodes);
  const id = String(sec.attrs.id || ('section' + index));
  const anchor = !isGeneratedId(id) ? id : anchorHint;
  return compact({
    key: id,
    anchor: anchor || undefined,
    name: anchor && !/^page-\d+$/.test(anchor) ? humanize(anchor) : undefined,
    height: round2(grid.height),
    fill: staticSectionFill(bg, ctx),
    layout: null,
    mobileHeight: phoneGrid ? round2(phoneGrid.height) : undefined,
    nodes
  });
}

function decodeStaticPage(html, pageUrl, shared) {
  const ctx = staticContext(html, pageUrl, shared);
  const dom = parseHtml(html);
  const root = findFirst(dom, (n) => n.attrs && n.attrs.id === 'root');
  if (!root) { shared.notes.push(pageUrl + ': לא נמצא <div id="root"> בדף'); return null; }
  const sections = [];
  let pendingAnchor = '';
  let index = 0;
  for (const c of elements(root)) {
    if (c.tag === 'a' && c.attrs.id && !c.attrs.href) { pendingAnchor = c.attrs.id; continue; }
    if (c.tag !== 'section') continue;
    sections.push(decodeStaticSection(c, pendingAnchor, ctx, index++));
    pendingAnchor = '';
  }
  for (const f of canonicalFaces(ctx.sheet.fontFaces)) {
    const cur = shared.fonts[f.key] || { family: '', weights: [], italic: false, faces: [] };
    if (!cur.weights.includes(f.weight)) cur.weights.push(f.weight);
    cur.weights.sort((a, b) => a - b);
    if (f.style === 'italic') cur.italic = true;
    const abs = absoluteUrl(f.url, ctx.baseUrl);
    cur.faces = cur.faces || [];
    if (!cur.faces.some((x) => x.url === abs)) cur.faces.push({ url: abs, weight: f.weight, style: f.style });
    shared.fonts[f.key] = cur;
  }
  return {
    format: 'canva-static',
    meta: ctx.meta,
    page: compact({
      key: ctx.meta.designId || '',
      path: urlParts(pageUrl).path,
      title: ctx.meta.title || ctx.meta.ogTitle,
      name: '',
      description: ctx.meta.description,
      width: DESIGN_WIDTH,
      sections
    }),
    brand: [],
    counts: ctx.counts
  };
}

// ── 9. the public API ─────────────────────────────────────────────────────

/** 'canva-app' | 'canva-static' | null */
function detect(html) {
  const s = String(html || '');
  if (!s) return null;
  const canva = /__canva_website_bootstrap__|canva_installFooter|_footer\?lang=|\.my\.canva\.site\//.test(s) || /<meta\s+name="app-name"\s+content="export_(fixed_)?website"/.test(s);
  if (/window\[['"]bootstrap['"]\]\s*=\s*JSON\.parse\(/.test(s) && (canva || /<div id="root"><\/div>/.test(s))) return 'canva-app';
  if (!canva) return null;
  const rootAt = s.search(/<div\s+id="root"/);
  if (rootAt >= 0 && /<section\b/.test(s.slice(rootAt))) return 'canva-static';
  return null;
}

const ASSET_RE = /\.(png|jpe?g|gif|webp|svg|avif|ico|mp4|webm|m3u8?|json|css|js|woff2?|otf|ttf|pdf|zip)(\?|$)/i;

/** Absolute URLs of OTHER pages of the same Canva site this page links to. */
function pageLinks(html, pageUrl) {
  const me = urlParts(pageUrl);
  const format = detect(html);
  const hrefs = new Set();
  if (format === 'canva-app') {
    const boot = extractBootstrap(html);
    const s = boot ? JSON.stringify(boot.page && boot.page.A) : '';
    for (const m of s.matchAll(/"(?:G|link)":(?:\{"B":)?"(https?:[^"]+)"/g)) hrefs.add(m[1]);
  }
  for (const m of String(html || '').matchAll(/href="([^"]+)"/g)) hrefs.add(decodeEntities(m[1]));
  const out = [];
  const seen = new Set();
  for (const h of hrefs) {
    const abs = absoluteUrl(h, pageUrl);
    const p = urlParts(abs);
    if (!p.ok || !me.ok || p.origin !== me.origin) continue;
    if (p.path === me.path) continue; // same page (an anchor)
    if (ASSET_RE.test(p.path) || /\/_/.test(p.path)) continue;
    const clean = p.origin + (p.path === '/' ? '/' : p.path);
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

/** The static export's @font-face list: [{ key, url, weight, style }] — [] for the app format. */
function fontFaces(html, pageUrl) {
  if (detect(html) !== 'canva-static') return [];
  const sheet = new StyleSheet(html);
  const base = headMeta(html, pageUrl).baseUrl;
  return canonicalFaces(sheet.fontFaces).map((f) => ({ key: f.key, url: absoluteUrl(f.url, base), weight: f.weight, style: f.style }));
}

/** Resolve every link against the decoded pages: same-site path → page key, '#page-N' → anchor. */
function resolveLinks(pages, origin) {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const fix = (link, page) => {
    if (!link || !link.href) return;
    const h = link.href;
    if (h[0] === '#') { link.anchor = h.slice(1); return; }
    const p = urlParts(absoluteUrl(h, origin + page.path));
    if (!p.ok || p.origin !== origin) return;
    const target = byPath.get(p.path);
    if (target) {
      if (target !== page) link.page = target.key;
      if (p.hash) link.anchor = p.hash;
    }
  };
  const fixRun = (r, page) => {
    if (!r.href) return;
    if (r.href[0] === '#') { r.anchor = r.href.slice(1); return; }
    const p = urlParts(absoluteUrl(r.href, origin + page.path));
    if (!p.ok || p.origin !== origin) return;
    const target = byPath.get(p.path);
    if (!target) return;
    if (target !== page) r.page = target.key;
    if (p.hash) r.anchor = p.hash;
  };
  const walk = (nodes, page) => {
    for (const n of nodes || []) {
      fix(n.link, page);
      for (const para of n.paragraphs || []) for (const r of para.runs || []) fixRun(r, page);
      if (n.children) walk(n.children, page);
    }
  };
  for (const page of pages) for (const s of page.sections) walk(s.nodes, page);
}

/** The colors the design leans on, most used first (section fills, shape fills, text). */
function palette(pages, brand) {
  const tally = new Map();
  const add = (hex, w) => { if (hex) tally.set(hex, (tally.get(hex) || 0) + w); };
  for (const page of pages) for (const s of page.sections) {
    add(s.fill && s.fill.color, 5);
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (n.type === 'shape' && n.fill && n.fill.color) add(n.fill.color, 2);
        if (n.type === 'line') add(n.color, 1);
        for (const p of n.paragraphs || []) for (const r of p.runs || []) add(r.color, 1);
        walk(n.children);
      }
    };
    walk(s.nodes);
  }
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  return [...new Set([...brand, ...sorted])].slice(0, 12);
}

/**
 * docs = [{ url, html }] — every page of ONE site, the pasted page first;
 * opts = { fontNames: { '<fontKey>': 'Family' } } (the fetch layer's names for
 * the static export's opaque font ids). → puppet.
 */
function decode(docs, opts = {}) {
  const list = (Array.isArray(docs) ? docs : [docs]).filter((d) => d && d.html);
  const shared = { fonts: {}, notes: [], skipped: {}, usedFonts: new Set() };
  const decoded = [];
  const formats = new Set();
  for (const d of list) {
    const format = detect(d.html);
    const url = String(d.url || '');
    let res = null;
    if (format === 'canva-app') res = decodeAppPage(d.html, url, null, shared);
    else if (format === 'canva-static') res = decodeStaticPage(d.html, url, shared);
    else { shared.notes.push(url + ': לא דף Canva — דולג'); continue; }
    if (res) { formats.add(format); decoded.push(res); }
  }
  const first = decoded[0];
  const origin = first ? urlParts(list[0].url).origin : '';
  const pages = decoded.map((r) => r.page);
  // stable, unique keys: the design id, else the path
  const seen = new Set();
  for (const p of pages) {
    let key = p.key || p.path;
    while (seen.has(key)) key += '-';
    seen.add(key);
    p.key = key;
    if (!p.name) p.name = p.path === '/' ? 'home' : humanize(p.path.split('/').pop());
  }
  resolveLinks(pages, origin);
  // fonts: name the static ids from opts, then from any app page of the same site, then leave the key
  const names = opts.fontNames || {};
  for (const [key, f] of Object.entries(shared.fonts)) {
    if (!f.family && names[key]) f.family = names[key];
    if (!f.family) {
      const stem = key.replace(/-\d+$/, '');
      const twin = Object.entries(shared.fonts).find(([k, g]) => k !== key && g.family && k.replace(/-\d+$/, '') === stem);
      if (twin) f.family = twin[1].family;
    }
    if (!f.family) f.family = names[key.replace(/-\d+$/, '')] || '';
  }
  for (const key of shared.usedFonts) if (!shared.fonts[key]) shared.fonts[key] = { family: names[key] || '', weights: [400], italic: false };
  const brand = first ? first.brand : [];
  // the notes speak to the owner (Hebrew), with the technical handle in parentheses
  const notes = shared.notes.slice();
  if (formats.size > 1) {
    const which = decoded.map((r) => r.page.path + (r.format === 'canva-app' ? ' בגרסת האפליקציה' : ' סטטי')).join(', ');
    notes.push('האתר מעורב — חלק מהדפים פורסמו בגרסת האפליקציה וחלק סטטיים: ' + which);
  }
  for (const [msg, n] of Object.entries(shared.skipped)) notes.push(msg + (n > 1 ? ' ×' + n : ''));
  const unnamed = Object.entries(shared.fonts).filter(([, f]) => !f.family).map(([k]) => k);
  if (unnamed.length) notes.push('גופנים בלי שם משפחה (להוריד את קובץ הגופן ולזהות עם font-name.js): ' + unnamed.join(', '));
  const meta = first ? first.meta : { title: '', description: '', lang: '', dir: '', favicon: '', socialImage: '' };
  return makePuppet({
    source: 'canva',
    format: first ? first.format : 'canva-static',
    origin: origin ? origin + '/' : '',
    site: { title: meta.title || meta.ogTitle, description: meta.description, lang: meta.lang || (first && first.page.lang) || '', dir: meta.dir, favicon: meta.favicon, socialImage: meta.socialImage },
    fonts: shared.fonts,
    palette: palette(pages, brand),
    pages,
    notes
  });
}

module.exports = {
  detect,
  pageLinks,
  fontFaces,
  decode,
  // exposed for the smoke and the lead's harnesses
  _internals: { extractBootstrap, parseHtml, StyleSheet, evalLength, trackSizes, gridArea, headMeta, decodeEntities, pathKind, appParagraphs }
};
