'use strict';

/**
 * Graduation (v0.51) — turn a provisional bent-html block's raw HTML into real
 * Tapuz modules (blocks), best-effort. This is the reverse of the repair
 * engine's quarantine: repair wraps off-vocabulary HTML into bent-html so a
 * page never fails to save; graduation lifts that HTML back into first-class,
 * visually-editable modules once the admin is ready.
 *
 * It is deliberately best-effort (a real page's markup is messy). Anything it
 * can confidently map becomes a module; anything left over stays in a smaller
 * bent-html block so nothing is lost. The admin approves the result.
 *
 * v0.57 — the vocabulary engine (Ben's Red Hat line, idea from the grok lab):
 * every unmappable PATTERN (form, table, video, nav…) is also *reported* as a
 * suggested tool. Decompiling real pages returns a `suggestedTools` list — the
 * backlog of modules the palette is missing. The decompiler is how the
 * vocabulary grows: seen on the web → toolGap → we build it → next decompile
 * maps cleaner and every agent's dictionary gets richer.
 *
 * v0.65 — card-cluster recognition (the walla lesson, deferred from v0.59):
 * a content site is a wall of repeated img+heading+link siblings. When a
 * container's children repeat that shape, the whole cluster becomes ONE
 * `cards` block with `mediacard` items instead of provisional html. Guards
 * against false positives: homogeneous root tags only (article/li/a/div/
 * figure — never section), per-card text cap (a hero SECTION is not a card),
 * a minimum count, and a match ratio.
 */

const { tokenize } = require('./language/parse');
const { unescapeHtml } = require('./language/escape');

/** Reconstruct a token's HTML (for leftover fragments). */
function tokenToHtml(t) {
  if (t.kind === 'text') return t.value;
  if (t.kind === 'doctype') return t.value;
  if (t.kind === 'close') return `</${t.name}>`;
  if (t.kind === 'open') {
    const attrs = Object.entries(t.attrs || {})
      .map(([k, v]) => (v === '' ? k : `${k}="${v}"`))
      .join(' ');
    return `<${t.name}${attrs ? ' ' + attrs : ''}${t.selfClosing ? ' /' : ''}>`;
  }
  return '';
}

/** Collect visible text from a token slice (drops tags, keeps text). */
function textOf(tokens, from, to) {
  let s = '';
  for (let i = from; i < to; i++) {
    if (tokens[i].kind === 'text') s += tokens[i].value;
  }
  return s.replace(/\s+/g, ' ').trim();
}

// HTML void elements never have a close tag, slash or not.
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

/** Find the index just after the element opened at `open` (matched close). */
function matchClose(tokens, openIdx) {
  const name = tokens[openIdx].name;
  if (tokens[openIdx].selfClosing || VOID.has(name)) return openIdx + 1;
  let depth = 1;
  let i = openIdx + 1;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'open' && t.name === name && !t.selfClosing) depth++;
    else if (t.kind === 'close' && t.name === name) { depth--; if (depth === 0) return i + 1; }
  }
  return i;
}

let uid = 0;
function nid(p) { uid += 1; return `${p}-g${uid}`; }

// ─── image sight (v0.67) ────────────────────────────────────────────────
// Real sites almost never put the picture in a plain src: it hides in
// data-src (lazy loaders), srcset (responsive), or a CSS background-image.
// The walla census: 74 <img src>, 5 srcset-only, 60 CSS backgrounds.

/** Case-blind attribute get — React DOM dumps say srcSet, data-Original… */
function attrOf(attrs, ...keys) {
  if (!attrs) return '';
  for (const key of keys) {
    const v = attrs[key];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  const lower = {};
  for (const [k, v] of Object.entries(attrs)) lower[k.toLowerCase()] = v;
  for (const key of keys) {
    const v = lower[key.toLowerCase()];
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return '';
}

/**
 * Largest candidate out of a srcset (the lab's walla lesson, rebuilt): CDN
 * URLs carry bare commas (f_auto,q_auto,w_500/…), so a srcset must be read
 * by its width descriptors — NEVER split on ','.
 */
function pickFromSrcset(set) {
  const s = String(set || '');
  if (!s.trim()) return '';
  let best = '';
  let bestW = -1;
  const re = /(\S+)\s+(\d+(?:\.\d+)?)[wx](?=\s*,|\s|$)/g;
  let m;
  while ((m = re.exec(s))) {
    // "…300w,https://next" glues the separator comma onto the next candidate
    const u = m[1].replace(/^,+/, '');
    if (!u || u.startsWith('data:')) continue;
    const w = parseFloat(m[2]);
    if (w > bestW) { best = u; bestW = w; }
  }
  if (best) return best;
  // no descriptors — fall back to comma-space candidates
  for (const part of s.split(/,\s+/)) {
    const u = part.trim().split(/\s+/)[0];
    if (u && !u.startsWith('data:')) return u;
  }
  return '';
}

/** The true image URL of an <img>/<source> token's attributes. */
function imageSrcOf(attrs) {
  const a = attrs || {};
  const direct = attrOf(a, 'src', 'data-src', 'data-lazy-src', 'data-original', 'data-bg', 'data-image', 'data-url');
  let src = direct && !/^data:/i.test(direct) && direct !== 'about:blank' ? direct : '';
  if (!src) src = pickFromSrcset(attrOf(a, 'srcset', 'srcSet', 'data-srcset', 'data-src-set'));
  if (!src) src = direct; // a data: URL beats nothing
  src = String(src).trim();
  if (src.startsWith('//')) src = 'https:' + src; // protocol-relative CDN
  return src;
}

/** background-image URL from an inline style attribute ('' when none). */
function styleImageOf(attrs) {
  const m = /background(?:-image)?\s*:[^;]*url\(\s*(?:&quot;|['"])?([^'")&]+)/i.exec((attrs || {}).style || '');
  return m ? m[1].trim() : '';
}

/**
 * CSS-in-JS sites (walla is emotion) put the picture in a <style> block:
 * `.css-ibqk57{background-image:url(…)}` — invisible to inline-style sight.
 * Scan every <style> once and map class → background URL; the walks look
 * elements up by their class list.
 */
function classBgMap(html) {
  const map = new Map();
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(String(html || '')))) {
    const ruleRe = /\.([A-Za-z0-9_-]+)[^{}]*\{[^{}]*?background(?:-image)?\s*:[^};]*?url\(\s*['"]?([^'")]+)/gi;
    let r;
    while ((r = ruleRe.exec(m[1]))) {
      const url = r[2].trim();
      if (url && !/^data:/i.test(url)) map.set(r[1], url);
    }
  }
  return map;
}

/** Lookup: the background URL an element's class list carries ('' if none). */
function bgOfAttrs(attrs, bgMap) {
  const inline = styleImageOf(attrs);
  if (inline) return inline;
  if (!bgMap || !bgMap.size) return '';
  for (const cls of String((attrs || {}).class || '').split(/\s+/)) {
    if (cls && bgMap.has(cls)) return bgMap.get(cls);
  }
  return '';
}

const HEADING = /^h([1-6])$/;
// tags we descend INTO (their children become blocks) rather than map directly
const CONTAINERS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'figure']);
const INLINE = new Set(['strong', 'b', 'em', 'i', 'u', 'small', 'span', 'code', 'mark', 'br', 'sup', 'sub']);
// never content: a walla dump carries 356KB of <script> state — skipping it
// is the difference between a page and a blob (v0.68; hunt always did this)
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'template', 'canvas', 'link', 'meta']);

// ─── card-cluster recognition (v0.65) ──────────────────────────────────
// Roots a repeated card may live in. Deliberately NOT section/main/header —
// a landing page made of hero sections must never collapse into a card grid.
const CARD_ROOTS = new Set(['article', 'li', 'a', 'div', 'figure']);
// A card is a TEASER: if a child carries more visible text than this it is a
// content section, not a card.
const CARD_TEXT_CAP = 400;

/** Direct child element spans [openIdx, endIdx) inside a token range. */
function childSpans(tokens, from, to) {
  const spans = [];
  let j = from;
  while (j < to) {
    if (tokens[j].kind === 'open') {
      const e = matchClose(tokens, j);
      spans.push([j, e]);
      j = e;
    } else j++;
  }
  return spans;
}

/** Try to read ONE media card out of an element span (null = not a card). */
function extractCard(tokens, from, to, bgMap) {
  const root = tokens[from];
  const card = {};
  let bgImage = '';
  if (root.name === 'a' && root.attrs && root.attrs.href) card.href = root.attrs.href;
  for (let j = from; j < to; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    // a CSS background on any wrapper is the card picture when no <img> shows
    if (!bgImage) bgImage = bgOfAttrs(tk.attrs, bgMap);
    if (!card.image && (tk.name === 'img' || tk.name === 'source')) {
      // real sites lazy-load: the true URL hides in data-src/srcset
      card.image = imageSrcOf(tk.attrs);
    } else if (!card.title && HEADING.test(tk.name)) {
      const e = matchClose(tokens, j);
      card.title = unescapeHtml(textOf(tokens, j + 1, e - 1)).slice(0, 200);
      j = e - 1;
    } else if (!card.href && tk.name === 'a' && tk.attrs && tk.attrs.href) {
      card.href = tk.attrs.href;
    } else if (!card.excerpt && tk.name === 'p') {
      const e = matchClose(tokens, j);
      card.excerpt = unescapeHtml(textOf(tokens, j + 1, e - 1)).slice(0, 300);
      j = e - 1;
    } else if (!card.tag && tk.name === 'span' && /tag|label|kicker|category|badge/i.test((tk.attrs && tk.attrs.class) || '')) {
      const e = matchClose(tokens, j);
      card.tag = unescapeHtml(textOf(tokens, j + 1, e - 1)).slice(0, 60);
      j = e - 1;
    }
  }
  if (!card.image && bgImage) card.image = bgImage;
  // a real card = a headline plus a picture or a destination, teaser-sized
  if (!card.title || !(card.image || card.href)) return null;
  if (textOf(tokens, from, to).length > CARD_TEXT_CAP) return null;
  const out = { title: card.title };
  if (card.image) out.image = card.image;
  if (card.tag) out.tag = card.tag;
  if (card.excerpt) out.excerpt = card.excerpt;
  if (card.href) out.href = card.href;
  return out;
}

/**
 * The walla lesson: repeated img+heading+link siblings ARE a card grid.
 * Returns the mediacard items, or null when the range is not a cluster.
 */
function detectCardCluster(tokens, from, to, bgMap) {
  const candidates = childSpans(tokens, from, to)
    .filter(([s]) => CARD_ROOTS.has(tokens[s].name) && !tokens[s].selfClosing);
  if (candidates.length < 2) return null;
  const cards = [];
  let rootName = null;
  for (const [s, e] of candidates) {
    const c = extractCard(tokens, s, e, bgMap);
    if (!c) continue;
    // homogeneous repetition is the essence of a cluster — mixed roots are a
    // page layout, not a card wall
    if (rootName === null) rootName = tokens[s].name;
    else if (tokens[s].name !== rootName) return null;
    cards.push(c);
  }
  // article/li/a repetition is card-intent by markup; generic div/figure needs
  // a stronger signal
  const minCount = (rootName === 'article' || rootName === 'li' || rootName === 'a') ? 2 : 3;
  if (cards.length >= minCount && cards.length / candidates.length >= 0.6) return cards;
  return null;
}

/**
 * A run of ≥4 consecutive sibling anchors with short labels IS a menu, not
 * a pile of buttons (the walla lesson v0.67: the flat read turned the
 * portal's section menus into 85 stacked primary buttons). Links carrying
 * pictures or long labels are content — the run stops there. Returns the
 * items plus the index just past the run so the walk can jump it.
 */
const LINK_RUN_MIN = 4;
const LINK_LABEL_MAX = 40;

/**
 * A link wrapping a picture or a headline is a TEASER, not a button (the
 * lab's walla training, rebuilt): read the anchor's children into ONE media
 * card so the picture survives. Returns null when the link is simple.
 */
const TEASER_CHILD = /^(img|picture|figure|h[1-6])$/;

function anchorCard(tokens, i, end, bgMap) {
  let complex = false;
  for (let j = i + 1; j < end - 1; j++) {
    if (tokens[j].kind === 'open' && TEASER_CHILD.test(tokens[j].name)) { complex = true; break; }
  }
  if (!complex) return null;
  return extractCard(tokens, i, end, bgMap);
}

/**
 * Wrapper-blind menu sight: real menus wrap each link in its own div/li, so
 * the walk meets one anchor per range and the run detector never fires.
 * After a sink level is built, ≥4 CONSECUTIVE short-label button blocks
 * collapse into one nav — the shape survives no matter how it was nested.
 */
function coalesceButtonRuns(blocks) {
  const out = [];
  let run = [];
  const isShort = (b) => String(b.data.text || '').length <= LINK_LABEL_MAX;
  const flushSegment = (seg) => {
    if (!seg.length) return;
    if (isShort(seg[0]) && seg.length >= LINK_RUN_MIN) {
      out.push({
        type: 'nav', id: nid('nav'),
        data: { items: seg.map((b) => ({ label: b.data.text, href: b.data.url })) }
      });
    } else if (!isShort(seg[0]) && seg.length >= 3) {
      // a stack of headline-length links is an article wall, not buttons
      out.push({
        type: 'cards', id: nid('cards'),
        data: { items: seg.map((b) => ({ title: String(b.data.text || '').slice(0, 200), href: b.data.url })) }
      });
    } else out.push(...seg);
  };
  const flush = () => {
    let seg = [];
    for (const b of run) {
      if (seg.length && isShort(seg[0]) !== isShort(b)) { flushSegment(seg); seg = []; }
      seg.push(b);
    }
    flushSegment(seg);
    run = [];
  };
  for (const b of blocks) {
    const label = b.type === 'button' ? String((b.data || {}).text || '').trim() : '';
    if (b.type === 'button' && label) run.push(b);
    else { flush(); out.push(b); }
  }
  flush();
  // finally: adjacent card walls fuse into ONE grid (teaser links arrive as
  // single-item cards — siblings belong together)
  const fused = [];
  for (const b of out) {
    const prev = fused[fused.length - 1];
    if (b.type === 'cards' && prev && prev.type === 'cards') prev.data.items.push(...b.data.items);
    else fused.push(b);
  }
  return fused;
}

/** A ul whose items are single short links is a MENU — keep the hrefs. */
function navItemsFromList(tokens, i, end) {
  let liCount = 0;
  const items = [];
  for (let j = i + 1; j < end - 1; j++) {
    if (tokens[j].kind === 'open' && tokens[j].name === 'li') {
      liCount += 1;
      const liEnd = matchClose(tokens, j);
      const anchors = [];
      for (let k = j + 1; k < liEnd - 1; k++) {
        if (tokens[k].kind === 'open' && tokens[k].name === 'a' && tokens[k].attrs && tokens[k].attrs.href) {
          const aEnd = matchClose(tokens, k);
          anchors.push({ label: unescapeHtml(textOf(tokens, k + 1, aEnd - 1)).trim(), href: tokens[k].attrs.href });
          k = aEnd - 1;
        }
      }
      if (anchors.length === 1 && anchors[0].label && anchors[0].label.length <= LINK_LABEL_MAX) {
        items.push(anchors[0]);
      }
      j = liEnd - 1;
    }
  }
  if (liCount >= LINK_RUN_MIN && items.length >= liCount * 0.8) return items;
  return null;
}

function collectLinkRun(tokens, i, to) {
  const items = [];
  let j = i;
  while (j < to) {
    const t = tokens[j];
    if (t.kind === 'text') {
      if (t.value.trim()) break; // real text between links = content, not menu
      j++; continue;
    }
    if (t.kind !== 'open' || t.name !== 'a' || !(t.attrs && t.attrs.href)) break;
    const e = matchClose(tokens, j);
    const label = unescapeHtml(textOf(tokens, j + 1, e - 1)).trim();
    if (!label || label.length > LINK_LABEL_MAX) break;
    let hasImg = false;
    for (let k = j; k < e; k++) {
      if (tokens[k].kind === 'open' && (tokens[k].name === 'img' || tokens[k].name === 'picture')) { hasImg = true; break; }
    }
    if (hasImg) break;
    items.push({ label, href: t.attrs.href });
    j = e;
  }
  return { items, end: j };
}

// ─── shared leaf parsers (used by the flat walk AND the v2 hunt) ────────

/** <form> children → form-module fields (skips submit/hidden controls). */
function parseFormFields(tokens, i, end) {
  const fields = [];
  let pendingLabel = '';
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind === 'open' && tk.name === 'label') {
      const lend = matchClose(tokens, j);
      pendingLabel = unescapeHtml(textOf(tokens, j + 1, lend - 1));
      j = lend - 1;
      continue;
    }
    if (tk.kind === 'open' && (tk.name === 'input' || tk.name === 'textarea' || tk.name === 'select')) {
      const a = tk.attrs || {};
      const inType = String(a.type || '').toLowerCase();
      if (tk.name === 'input' && /^(submit|button|hidden|image|reset)$/.test(inType)) {
        const cend = matchClose(tokens, j); j = cend - 1; pendingLabel = ''; continue;
      }
      let ftype = 'text';
      if (tk.name === 'textarea') ftype = 'textarea';
      else if (tk.name === 'select') ftype = 'select';
      else ftype = (inType === 'email' || inType === 'tel' || inType === 'checkbox') ? inType : 'text';
      const field = {
        label: pendingLabel || a.placeholder || a.name || '',
        name: a.name || '',
        type: ftype,
        placeholder: a.placeholder || '',
        required: 'required' in a
      };
      const cend = matchClose(tokens, j);
      if (ftype === 'select') {
        const opts = [];
        for (let k = j + 1; k < cend - 1; k++) {
          if (tokens[k].kind === 'open' && tokens[k].name === 'option') {
            const oend = matchClose(tokens, k);
            const label = unescapeHtml(textOf(tokens, k + 1, oend - 1));
            if (label) opts.push(label);
            k = oend - 1;
          }
        }
        field.options = opts.join(', ');
      }
      j = cend - 1;
      pendingLabel = '';
      fields.push(field);
    }
  }
  return fields;
}

/** <nav> anchors → nav-module items (wrapper ul/li dropped). */
function parseNavItems(tokens, i, end) {
  const items = [];
  for (let j = i + 1; j < end - 1; j++) {
    if (tokens[j].kind === 'open' && tokens[j].name === 'a') {
      const aEnd = matchClose(tokens, j);
      const label = unescapeHtml(textOf(tokens, j + 1, aEnd - 1));
      if (label) items.push({ label, href: (tokens[j].attrs && tokens[j].attrs.href) || '#' });
      j = aEnd - 1;
    }
  }
  return items;
}

/** <video> → video-module data, or null when no src is found. */
function parseVideoData(tokens, i, end, t) {
  const a = t.attrs || {};
  let src = a.src || '';
  if (!src) {
    for (let j = i + 1; j < end - 1; j++) {
      if (tokens[j].name === 'source' && tokens[j].attrs && tokens[j].attrs.src) {
        src = tokens[j].attrs.src; break;
      }
    }
  }
  if (!src) return null;
  const data = { src };
  if (a.poster) data.poster = a.poster;
  if ('controls' in a) data.controls = true;
  if ('autoplay' in a) data.autoplay = true;
  if ('loop' in a) data.loop = true;
  if ('muted' in a) data.muted = true;
  return data;
}

// ── v2.22: the decompiler catches up to its own language ────────────────
// table, audio, accordion and map got first-class modules over v0.8–v1.x,
// but the decompiler still reported them as toolGaps and shipped verbatim
// HTML. These parsers close the loop: seen on the web → mapped to the
// module. Each REFUSES (returns null) when the source is richer than the
// module can hold — the caller keeps the verbatim HTML, so nothing is lost.

// Content that makes a table cell / fold body too rich for a text mapping.
const RICH_CONTENT = new Set(['img', 'table', 'iframe', 'video', 'audio', 'form', 'ul', 'ol', 'picture', 'svg']);

/** <audio> → the native audio block: src from the attr or the first <source>. */
function parseAudioData(tokens, i, end, t) {
  const a = t.attrs || {};
  let src = a.src || '';
  if (!src) {
    for (let j = i + 1; j < end - 1; j++) {
      if (tokens[j].name === 'source' && tokens[j].attrs && tokens[j].attrs.src) {
        src = tokens[j].attrs.src; break;
      }
    }
  }
  if (!src) return null;
  const data = { src };
  if ('loop' in a) data.loop = true;
  return data;
}

/**
 * <table> → the native table block: rows of ' | '-joined cell text,
 * header:true when the first row is <th>-based. Layout wrappers (div/span/p)
 * inside cells are fine — their text is the cell; genuinely rich content
 * (images, nested tables, forms) refuses the mapping.
 */
function parseTableData(tokens, i, end) {
  const rows = [];
  let header = false;
  let cells = null;
  let rowIsTh = false;
  let cellStart = -1;
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind === 'open' && RICH_CONTENT.has(tk.name)) return null;
    if (tk.kind === 'open' && tk.name === 'tr') { cells = []; rowIsTh = false; continue; }
    if (tk.kind === 'close' && tk.name === 'tr') {
      if (cells && cells.length && cells.some((c) => c.trim())) {
        rows.push({ cells: cells.join(' | ') });
        if (rowIsTh && rows.length === 1) header = true;
      }
      cells = null; continue;
    }
    if (tk.kind === 'open' && (tk.name === 'td' || tk.name === 'th')) {
      cellStart = j + 1;
      if (tk.name === 'th') rowIsTh = true;
      continue;
    }
    if (tk.kind === 'close' && (tk.name === 'td' || tk.name === 'th')) {
      if (cells) cells.push(textOf(tokens, cellStart, j));
      continue;
    }
  }
  if (rows.length < 1) return null;
  return { header, rows };
}

/**
 * A run of sibling <details> elements → ONE accordion block (the FAQ shape
 * real sites ship). <summary> is the fold title, the rest of the fold is its
 * text content. Any rich fold refuses the whole run.
 * @returns {{ items: {title:string,content:string}[], next: number } | null}
 */
function parseDetailsRun(tokens, i, parentEnd) {
  const items = [];
  let j = i;
  while (j < parentEnd && tokens[j].kind === 'open' && tokens[j].name === 'details') {
    const dEnd = matchClose(tokens, j);
    if (dEnd == null || dEnd > parentEnd) return null;
    let title = '';
    let sumFrom = -1;
    let sumTo = -1;
    for (let k = j + 1; k < dEnd - 1; k++) {
      const tk = tokens[k];
      if (tk.kind === 'open' && RICH_CONTENT.has(tk.name)) return null;
      if (tk.kind === 'open' && tk.name === 'summary' && sumFrom === -1) sumFrom = k + 1;
      if (tk.kind === 'close' && tk.name === 'summary' && sumTo === -1) sumTo = k;
    }
    if (sumFrom !== -1 && sumTo !== -1) title = textOf(tokens, sumFrom, sumTo);
    const body = sumTo !== -1
      ? textOf(tokens, sumTo + 1, dEnd - 1)
      : textOf(tokens, j + 1, dEnd - 1);
    items.push({ title: title || 'סעיף', content: body });
    j = dEnd;
    // hop whitespace-only text between sibling <details>
    while (j < parentEnd && tokens[j].kind === 'text' && !tokens[j].value.trim()) j++;
  }
  if (!items.length) return null;
  return { items, next: j };
}

/** A Google-Maps embed src → the map block's address, or null (stay an embed). */
function mapsAddressOf(src) {
  const s = String(src || '');
  if (!/google\.[a-z.]{2,10}\/maps/i.test(s)) return null;
  const q = s.match(/[?&](?:q|query)=([^&]+)/);
  if (q) {
    try { return decodeURIComponent(q[1].replace(/\+/g, ' ')).trim() || null; } catch (e) { return null; }
  }
  const place = s.match(/\/maps\/place\/([^/?#]+)/);
  if (place) {
    try { return decodeURIComponent(place[1].replace(/\+/g, ' ')).trim() || null; } catch (e) { return null; }
  }
  return null;
}

/**
 * @param {string} html
 * @param {{ bgMap?: Map<string,string> }} [opts]  class → CSS background URL
 *        (decompile.js builds it from the FULL page's <style> blocks; when
 *        absent we scan the fragment itself)
 * @returns {{ blocks: object[], mapped: number, leftover: number, suggestedTools: string[] }}
 */
function htmlToBlocks(html, opts = {}) {
  uid = 0;
  const bgMap = opts.bgMap != null ? opts.bgMap : classBgMap(html);
  let tokens;
  try {
    // lenient: graduation always faces real-world HTML (yahoo-class attribute
    // soup) — malformed markup degrades to text instead of aborting the map
    tokens = tokenize(String(html == null ? '' : html), { lenient: true });
  } catch (e) {
    // Real-world HTML (yahoo.com, etc.) can break the tokenizer on malformed
    // attributes. NEVER hard-fail — keep the whole fragment as one sanitized
    // provisional block so nothing is lost and the admin can graduate/edit it.
    const { sanitizeHtmlFragment } = require('../html-sanitize');
    return {
      blocks: [{
        type: 'html', id: nid('html'),
        data: { content: sanitizeHtmlFragment(String(html || '')).slice(0, 20000), provisional: true, note: 'לא ניתן היה לפרק אוטומטית — נשמר כ‑HTML גולמי' }
      }],
      mapped: 0, leftover: 1, suggestedTools: []
    };
  }
  const out = [];
  let mapped = 0;
  let leftover = 0;
  const suggested = new Set();

  function flushRaw(buf, sink) {
    const trimmed = buf.trim();
    if (!trimmed) return;
    leftover += 1;
    sink.push({ type: 'html', id: nid('html'), data: { content: trimmed, provisional: true } });
  }

  function walk(from, to, sink) {
    // the whole range repeating the card shape? → ONE cards block (v0.65).
    // Fires for wrapped clusters (via the CONTAINERS descend) and for bare
    // top-level sibling clusters alike.
    const cluster = detectCardCluster(tokens, from, to, bgMap);
    if (cluster) {
      sink.push({ type: 'cards', id: nid('cards'), data: { items: cluster } });
      mapped += 1;
      return;
    }
    let raw = '';
    let i = from;
    while (i < to) {
      const t = tokens[i];
      if (t.kind === 'text') {
        // bare text that isn't only whitespace becomes a text block
        if (t.value.trim()) { raw += t.value; }
        i++;
        continue;
      }
      if (t.kind !== 'open') { i++; continue; }

      const name = t.name;
      const end = matchClose(tokens, i);

      if (SKIP_TAGS.has(name)) { i = end; continue; }
      if (INLINE.has(name)) { raw += textOf(tokens, i, end) + ' '; i = end; continue; }

      // pending raw becomes a block before we emit a real module: plain text →
      // text block; anything with markup → provisional html (NOT text, or the
      // tags would show as visible garbage on the page)
      if (raw.trim()) {
        if (/<[a-z]/i.test(raw)) { flushRaw(raw, sink); }
        else { sink.push({ type: 'text', id: nid('t'), data: { content: unescapeHtml(raw).replace(/\s+/g, ' ').trim() } }); mapped += 1; }
        raw = '';
      }

      const hm = HEADING.exec(name);
      if (hm) {
        sink.push({ type: 'heading', id: nid('h'), data: { level: Number(hm[1]), text: unescapeHtml(textOf(tokens, i + 1, end - 1)) } });
        mapped += 1; i = end; continue;
      }
      if (name === 'p') {
        sink.push({ type: 'text', id: nid('t'), data: { content: unescapeHtml(textOf(tokens, i + 1, end - 1)) } });
        mapped += 1; i = end; continue;
      }
      if (name === 'blockquote' || name === 'q' || name === 'cite') {
        const qt = unescapeHtml(textOf(tokens, i + 1, end - 1));
        if (qt) { sink.push({ type: 'quote', id: nid('q'), data: { text: qt } }); mapped += 1; }
        i = end; continue;
      }
      if (name === 'img') {
        sink.push({ type: 'image', id: nid('img'), data: { src: imageSrcOf(t.attrs), alt: t.attrs.alt || '' } });
        mapped += 1; i = end; continue;
      }
      // <picture> — the true URL hides in the inner img/source srcsets
      if (name === 'picture') {
        let src = '', alt = '';
        for (let j = i + 1; j < end - 1; j++) {
          const tk = tokens[j];
          if (tk.kind !== 'open') continue;
          if (tk.name === 'img') {
            src = imageSrcOf(tk.attrs) || src;
            alt = (tk.attrs && tk.attrs.alt) || alt;
          } else if (tk.name === 'source' && !src) {
            src = imageSrcOf(tk.attrs);
          }
        }
        if (src) { sink.push({ type: 'image', id: nid('img'), data: { src, alt } }); mapped += 1; }
        i = end; continue;
      }
      // a bare <button> with visible text is a CTA (textless ones are chrome)
      if (name === 'button') {
        const btnLabel = unescapeHtml(textOf(tokens, i + 1, end - 1)).trim();
        if (btnLabel) {
          sink.push({ type: 'button', id: nid('b'), data: { text: btnLabel, url: (t.attrs && t.attrs.formaction) || '#' } });
          mapped += 1;
        }
        i = end; continue;
      }
      if (name === 'a') {
        // a picture/headline teaser link IS a card — the picture survives
        const teaser = anchorCard(tokens, i, end, bgMap);
        if (teaser) {
          sink.push({ type: 'cards', id: nid('cards'), data: { items: [teaser] } });
          mapped += 1; i = end; continue;
        }
        // a run of ≥4 short bare links is a menu, not a button pile
        const run = collectLinkRun(tokens, i, to);
        if (run.items.length >= LINK_RUN_MIN) {
          sink.push({ type: 'nav', id: nid('nav'), data: { items: run.items } });
          mapped += 1; i = run.end; continue;
        }
        const href = t.attrs.href || '#';
        let label = unescapeHtml(textOf(tokens, i + 1, end - 1)).trim();
        if (!label) {
          // a textless link is an icon or a picture link — keep the picture,
          // or fall back to the aria name; never a nameless "קישור" button
          let pictured = false;
          for (let j = i + 1; j < end - 1; j++) {
            if (tokens[j].kind === 'open' && (tokens[j].name === 'img' || tokens[j].name === 'source')) {
              const src = imageSrcOf(tokens[j].attrs);
              if (src) { sink.push({ type: 'image', id: nid('img'), data: { src, alt: tokens[j].attrs.alt || '' } }); mapped += 1; pictured = true; }
              break;
            }
          }
          if (pictured) { i = end; continue; }
          label = attrOf(t.attrs, 'aria-label', 'title').trim().slice(0, LINK_LABEL_MAX);
          if (!label) { i = end; continue; }
        }
        if (/youtube\.com|youtu\.be/i.test(href)) {
          // a YouTube link is better as an embed (renderer auto-embeds the player)
          sink.push({ type: 'embed', id: nid('em'), data: { url: href } });
        } else {
          if (/wa\.me|whatsapp/i.test(href)) suggested.add('whatsapp'); // real sites want a first-class whatsapp module
          sink.push({ type: 'button', id: nid('b'), data: { text: label, url: href } });
        }
        mapped += 1; i = end; continue;
      }
      if (name === 'iframe') {
        // a Google-Maps embed with a readable address → the native map module
        // (v2.22); youtube or any other src → embed (renderer auto-embeds
        // youtube, links out otherwise)
        const mapsAddr = mapsAddressOf(t.attrs.src);
        if (mapsAddr) {
          sink.push({ type: 'map', id: nid('map'), data: { address: mapsAddr } });
        } else {
          sink.push({ type: 'embed', id: nid('em'), data: { url: t.attrs.src || '' } });
        }
        mapped += 1; i = end; continue;
      }
      if (name === 'hr') { sink.push({ type: 'divider', id: nid('d'), data: {} }); mapped += 1; i = end; continue; }
      if (name === 'ul' || name === 'ol') {
        // card-shaped <li>s are a card GRID, not a text list (walla renders
        // its card walls as ul>li) — try the cluster first, list as fallback
        const liCluster = detectCardCluster(tokens, i + 1, end - 1, bgMap);
        if (liCluster) {
          sink.push({ type: 'cards', id: nid('cards'), data: { items: liCluster } });
          mapped += 1; i = end; continue;
        }
        // a ul of single short links is a menu — keep the hrefs (v0.67)
        const menu = navItemsFromList(tokens, i, end);
        if (menu) {
          sink.push({ type: 'nav', id: nid('nav'), data: { items: menu } });
          mapped += 1; i = end; continue;
        }
        const items = [];
        for (let j = i + 1; j < end - 1; j++) {
          if (tokens[j].kind === 'open' && tokens[j].name === 'li') {
            const liEnd = matchClose(tokens, j);
            items.push({ text: unescapeHtml(textOf(tokens, j + 1, liEnd - 1)) });
            j = liEnd - 1;
          }
        }
        if (items.length) { sink.push({ type: 'list', id: nid('list'), data: { ordered: name === 'ol', items } }); mapped += 1; }
        i = end; continue;
      }
      // form → the form module (v0.58 closed this gap). Parse label/input/
      // textarea/select children into fields; skip submit/hidden controls
      // (the module renders its own submit button).
      if (name === 'form') {
        const fields = parseFormFields(tokens, i, end);
        if (fields.length) {
          const method = /get/i.test((t.attrs && t.attrs.method) || '') ? 'get' : 'post';
          sink.push({ type: 'form', id: nid('form'), data: { action: (t.attrs && t.attrs.action) || '', method, submit: 'שליחה', fields } });
          mapped += 1;
        } else {
          let frag = '';
          for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
          raw += frag;
        }
        i = end; continue;
      }

      // nav → the nav module (v0.60 closed this gap). Its <a> children become
      // nav links; drop wrapper <ul>/<li> (we read the anchors directly).
      if (name === 'nav') {
        const items = parseNavItems(tokens, i, end);
        if (items.length) {
          sink.push({ type: 'nav', id: nid('nav'), data: { items } });
          mapped += 1;
        } else {
          let frag = '';
          for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
          raw += frag;
        }
        i = end; continue;
      }

      // video → the native video module (v0.62 closed this gap). src from the
      // <video src> attr or the first child <source>; poster + boolean flags
      // (controls/autoplay/loop/muted) carried over as present.
      if (name === 'video') {
        const data = parseVideoData(tokens, i, end, t);
        if (data) {
          sink.push({ type: 'video', id: nid('video'), data });
          mapped += 1;
        } else {
          let frag = '';
          for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
          raw += frag;
        }
        i = end; continue;
      }

      // v2.22: table and audio STOPPED being toolGaps — the modules landed
      // (v0.83 table, v1.x audio) and the decompiler now maps them. Only a
      // source too rich for the module (images in cells, nested tables, a
      // srcless <audio>) falls back to verbatim HTML + the gap report.
      if (name === 'table') {
        const data = parseTableData(tokens, i, end);
        if (data) {
          sink.push({ type: 'table', id: nid('tbl'), data });
          mapped += 1; i = end; continue;
        }
        suggested.add('table');
        let frag = '';
        for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
        raw += frag;
        i = end; continue;
      }
      if (name === 'audio') {
        const data = parseAudioData(tokens, i, end, t);
        if (data) {
          sink.push({ type: 'audio', id: nid('au'), data });
          mapped += 1; i = end; continue;
        }
        suggested.add('audio');
        let frag = '';
        for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
        raw += frag;
        i = end; continue;
      }

      // a run of sibling <details> → ONE accordion (the FAQ shape); the run
      // parser consumes every consecutive fold, so i jumps to its `next`
      if (name === 'details') {
        const run = parseDetailsRun(tokens, i, tokens.length);
        if (run) {
          sink.push({ type: 'accordion', id: nid('acc'), data: { items: run.items } });
          mapped += 1; i = run.next; continue;
        }
        let frag = '';
        for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
        raw += frag;
        i = end; continue;
      }

      if (CONTAINERS.has(name)) {
        // descend: its children become blocks (the wrapper itself is dropped).
        // A grid/flex wrapper with several children hints at a columns layout.
        const before = sink.length;
        walk(i + 1, end - 1, sink);
        if (sink.length - before > 1 && /col|grid|row|flex/i.test(t.attrs.class || '')) {
          suggested.add('columns');
        }
        // an empty wrapper whose CSS carries a background IS a picture
        if (sink.length === before) {
          const bg = bgOfAttrs(t.attrs, bgMap);
          if (bg) { sink.push({ type: 'image', id: nid('img'), data: { src: bg, alt: '' } }); mapped += 1; }
        }
        i = end; continue;
      }

      // custom elements / SPA shells (devsite-*, react-*) — walk children,
      // never keep framework wrappers as raw blobs
      if (name.includes('-')) {
        walk(i + 1, end - 1, sink);
        i = end; continue;
      }

      // unmappable element → keep verbatim as leftover raw HTML
      let frag = '';
      for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
      raw += frag;
      i = end;
    }
    if (raw.trim()) {
      // trailing raw: text if it's plain, else a small html block
      if (/<[a-z]/i.test(raw)) flushRaw(raw, sink);
      else { sink.push({ type: 'text', id: nid('t'), data: { content: unescapeHtml(raw).replace(/\s+/g, ' ').trim() } }); mapped += 1; }
    }
  }

  walk(0, tokens.length, out);
  return { blocks: coalesceButtonRuns(out), mapped, leftover, suggestedTools: [...suggested] };
}

module.exports = {
  htmlToBlocks,
  // shared internals for the v2 structure hunt (src/pzn/hunt.js)
  parseFormFields,
  parseNavItems,
  parseVideoData,
  parseAudioData,
  parseTableData,
  parseDetailsRun,
  mapsAddressOf,
  detectCardCluster,
  collectLinkRun,
  coalesceButtonRuns,
  navItemsFromList,
  anchorCard,
  attrOf,
  pickFromSrcset,
  LINK_RUN_MIN,
  LINK_LABEL_MAX,
  imageSrcOf,
  styleImageOf,
  classBgMap,
  bgOfAttrs,
  childSpans,
  matchClose,
  textOf,
  tokenToHtml,
  HEADING,
  CONTAINERS,
  INLINE
};
