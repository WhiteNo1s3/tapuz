'use strict';

/**
 * The markup parser — one tolerant DOM for every Geppetto door that reads text.
 *
 * Canva's static export is HTML; Figma's SVG export is XML that looks the same
 * from here: tags, attributes, text, comments, a prolog to skip. One parser
 * serves both doors (src/geppetto/canva.js, src/geppetto/svg.js) so a fix
 * lands once. It is not a browser: no implied tags, no error recovery beyond
 * "an unmatched close tag is ignored", and everything is LOWERCASED — tag
 * names and attribute names alike (`viewBox` reads back as `viewbox`,
 * `clipPath` as `clippath`; `xlink:href` stays `xlink:href`). Attribute
 * VALUES keep their case and come back entity-decoded.
 *
 *   parseHtml(text)  → { tag: '#root', attrs: {}, children, parent: null }
 *       elements { tag, attrs, children, parent }; text nodes { tag: '#text', text }.
 *       Void tags (br, img, …) and self-closed tags (`<rect … />`) never open;
 *       <script>/<style>/<textarea> bodies are one raw text node; nesting stops
 *       deepening past MAX_DEPTH (every walk of the tree recurses).
 *   parseAttrs(s)     the attribute string of one open tag → { name: value }
 *   decodeEntities(s) &amp; &#10; &#x2026; and the named entities design exports use
 *
 * Linear in the input: a page of stray close tags under deep nesting was
 * quadratic once (smoke-geppetto-canva.js keeps the 30,000-deep case).
 */

const NBSP = String.fromCharCode(160);

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

// ── the DOM ──────────────────────────────────────────────────────────────

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const MAX_DEPTH = 400; // a real page nests a few dozen deep
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
  // how many of each tag are open on the current path: a close tag nothing
  // opened is ignored at once instead of walking to the root (a page of
  // stray close tags under deep nesting was quadratic), and nesting stops
  // deepening past MAX_DEPTH (every walk of the tree recurses)
  const open = new Map();
  let depth = 0;
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
      if (open.get(name)) {
        for (;;) {
          const t = cur.tag;
          open.set(t, open.get(t) - 1);
          depth--;
          cur = cur.parent;
          if (t === name) break;
        }
      } // an unmatched close tag is ignored
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
    if (!VOID.has(tag) && !selfClosed && depth < MAX_DEPTH) {
      cur = el;
      open.set(tag, (open.get(tag) || 0) + 1);
      depth++;
    }
  }
  return root;
}

module.exports = { parseHtml, parseAttrs, decodeEntities, ENTITIES, VOID, RAW, MAX_DEPTH };
