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
  const direct = attrOf(a, 'src', 'data-src', 'data-lazy-src', 'data-original', 'data-bg', 'data-lazy-bg', 'data-image', 'data-url');
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
  const lazyBg = attrOf(attrs, 'data-lazy-bg', 'data-bg', 'data-background');
  if (lazyBg && !/^data:/i.test(lazyBg)) return lazyBg.startsWith('//') ? 'https:' + lazyBg : lazyBg;
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
    } else if (!card.title && (HEADING.test(tk.name)
      || /(?:^|\s)(?:title|headline|arttitle|slot-?title|item-title|card-title|teaser-title)(?:\s|$)/i.test((tk.attrs && tk.attrs.class) || ''))) {
      const e = matchClose(tokens, j);
      const title = unescapeHtml(textOf(tokens, j + 1, e - 1)).replace(/\s+/g, ' ').trim().slice(0, 200);
      if (title) card.title = title;
      j = e - 1;
    } else if (!card.excerpt && (tk.name === 'time' || /slot-?sub-?title|slotSubTitle/i.test((tk.attrs && tk.attrs.class) || ''))) {
      const e = matchClose(tokens, j);
      if (tk.name === 'time') {
        const when = timeText(tokens, j, e, tk);
        if (when) card.excerpt = when;
      } else {
        const sub = unescapeHtml(textOf(tokens, j + 1, e - 1)).replace(/\s+/g, ' ').trim().slice(0, 300);
        if (sub) card.excerpt = sub;
      }
      j = e - 1;
    } else if (!card.tag && /authorInfo|authorField|articleAuthor|author/i.test((tk.attrs && tk.attrs.class) || '')) {
      const e = matchClose(tokens, j);
      const who = unescapeHtml(textOf(tokens, j + 1, e - 1)).replace(/\s+/g, ' ').trim().slice(0, 60);
      if (who) card.tag = who;
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
  const cap = /slotView|slot-view|post-item|tie-standard/i.test((root.attrs && root.attrs.class) || '')
    ? 900 : CARD_TEXT_CAP;
  if (textOf(tokens, from, to).length > cap) return null;
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
function isChromeTextBlock(b) {
  if (!b || b.type !== 'text') return false;
  const c = String((b.data && b.data.content) || '').trim();
  if (!c) return true;
  return /window\.|googletag|YITSiteWidgets|function\s*\(|^\s*if\s*\(\s*window/.test(c);
}

function isBylineTextBlock(b) {
  if (!b || b.type !== 'text') return false;
  const c = String((b.data && b.data.content) || '').replace(/\s+/g, ' ').trim();
  if (!c || c.length > 48) return false;
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(c)) return true;
  if (/\|$/.test(c)) return true;
  return /^(?:ynet|[\u0590-\u05FFA-Za-z][\u0590-\u05FFA-Za-z.\s]{0,36})$/.test(c);
}

function isTeaserGlue(b) {
  return isChromeTextBlock(b) || isBylineTextBlock(b);
}

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
    else if (run.length && isTeaserGlue(b)) continue;
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
  return collectFormFields(tokens, i + 1, end - 1);
}

function collectFormFields(tokens, from, to) {
  const fields = [];
  let pendingLabel = '';
  for (let j = from; j < to; j++) {
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

/**
 * ASP.NET and many news CMSes wrap the WHOLE page in <form>. Hidden-only
 * or page-sized forms must descend — dumping them as leftover html is how
 * Globes lost 140KB of headlines. A small contact/search form still maps.
 */
function isPageForm(tokens, i, end, fields) {
  let headings = 0;
  let articles = 0;
  let imgs = 0;
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    if (HEADING.test(tk.name)) headings += 1;
    if (tk.name === 'article' || tk.name === 'section') articles += 1;
    if (tk.name === 'img') imgs += 1;
  }
  if (headings >= 3 || articles >= 2 || imgs >= 4) return true;
  return fields.length === 0;
}

/** Consecutive sibling label/input/textarea/select → one form, or null. */
function parseFieldRun(tokens, i, parentEnd) {
  let j = i;
  let last = i;
  while (j < parentEnd) {
    const tk = tokens[j];
    if (tk.kind === 'text' && !String(tk.value || '').trim()) { j += 1; continue; }
    if (tk.kind === 'open' && /^(label|input|textarea|select)$/.test(tk.name)) {
      const e = matchClose(tokens, j);
      if (e == null) break;
      last = e;
      j = e;
      continue;
    }
    break;
  }
  const fields = collectFormFields(tokens, i, last);
  if (!fields.length) return null;
  return { fields, next: last };
}

/** <time> body, else datetime/dateTime/data-wcmdate — never leftover chrome. */
function timeText(tokens, i, end, t) {
  const body = unescapeHtml(textOf(tokens, i + 1, end - 1)).replace(/\s+/g, ' ').trim();
  if (body) return body;
  const raw = (t.attrs && (t.attrs.datetime || t.attrs.dateTime || t.attrs['data-wcmdate'] || t.attrs['data-date'])) || '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
  if (m) return `${Number(m[3])}.${Number(m[2])}.${m[1]}`;
  return String(raw).trim();
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

const STEPS_CLASS = /\b(?:steps?|process|how-it-works|howitworks|workflow|stepper|elementor-steps)\b/i;
const TIMELINE_CLASS = /\b(?:timeline|milestones?|chrono|elementor-timeline)\b/i;

function classHay(t) {
  return `${(t && t.attrs && t.attrs.class) || ''} ${(t && t.attrs && t.attrs.id) || ''}`;
}

function looksLikeSteps(t) {
  return STEPS_CLASS.test(classHay(t));
}

function looksLikeTimeline(t) {
  return TIMELINE_CLASS.test(classHay(t));
}

/**
 * Pull title / body / optional time-or-icon out of one item wrapper
 * (an <li> or a step/event container).
 */
function extractProcessItem(tokens, s, e, kind) {
  let title = '';
  let text = '';
  let time = '';
  let icon = '';
  let image = '';
  for (let j = s + 1; j < e - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const close = matchClose(tokens, j);
    const cls = (tk.attrs && tk.attrs.class) || '';
    if (!time && (tk.name === 'time' || /date|year|when|time/i.test(cls))) {
      time = unescapeHtml(textOf(tokens, j + 1, close - 1));
      j = close - 1;
      continue;
    }
    if (!icon && tk.name === 'img' && kind === 'steps') {
      const src = imageSrcOf(tk.attrs);
      if (src) icon = src;
      j = close - 1;
      continue;
    }
    if (!image && tk.name === 'img' && kind === 'timeline') {
      const src = imageSrcOf(tk.attrs);
      if (src) image = src;
      j = close - 1;
      continue;
    }
    if (!title && HEADING.test(tk.name)) {
      title = unescapeHtml(textOf(tokens, j + 1, close - 1));
      j = close - 1;
      continue;
    }
    if (!title && (tk.name === 'strong' || tk.name === 'b')) {
      title = unescapeHtml(textOf(tokens, j + 1, close - 1));
      j = close - 1;
      continue;
    }
    if (tk.name === 'p') {
      const p = unescapeHtml(textOf(tokens, j + 1, close - 1));
      text = text ? `${text}\n${p}` : p;
      j = close - 1;
      continue;
    }
  }
  if (!title && !text && !time) {
    const all = unescapeHtml(textOf(tokens, s + 1, e - 1));
    if (!all) return null;
    if (kind === 'timeline') {
      const m = /^(\d{4}|[\d./-]{4,12})\s+(.+)$/.exec(all);
      if (m) return { time: m[1], title: m[2], text: '', image: '' };
    }
    title = all;
  }
  if (kind === 'timeline') {
    if (!time && !title && !text) return null;
    return { time, title, text, image };
  }
  if (!title) return null;
  return { title, text, icon };
}

function collectProcessItems(tokens, from, to, kind, depth = 0) {
  const kids = [];
  // Best nested-list candidate: an <ol> beats a <ul> (a hinted container's
  // real sequence is the numbered list, not an intro bullet list), then more
  // items beat fewer, then the first one seen wins.
  let bestList = null;
  let j = from;
  while (j < to) {
    const tk = tokens[j];
    if (tk.kind !== 'open') { j++; continue; }
    const e = matchClose(tokens, j);
    if (tk.name === 'li') {
      kids.push([j, e]);
    } else if (tk.name === 'ol' || tk.name === 'ul') {
      const inner = collectProcessItems(tokens, j + 1, e - 1, kind, depth);
      if (inner && inner.length) {
        const ordered = tk.name === 'ol';
        if (!bestList
          || (ordered && !bestList.ordered)
          || (ordered === bestList.ordered && inner.length > bestList.items.length)) {
          bestList = { ordered, items: inner };
        }
      }
    } else if (CONTAINERS.has(tk.name)) {
      kids.push([j, e]);
    }
    j = e;
  }
  if (bestList) return bestList.items;
  if (kids.length === 1 && depth < 3) {
    const [s, e] = kids[0];
    const inner = collectProcessItems(tokens, s + 1, e - 1, kind, depth + 1);
    if (inner && inner.length >= 2) return inner;
  }
  const items = [];
  for (const [s, e] of kids) {
    const it = extractProcessItem(tokens, s, e, kind);
    if (it) items.push(it);
  }
  return items;
}

/**
 * How-it-works / process steps. Class hint, or a rich <ol> (heading + body
 * per item) so a plain numbered list stays a list. Timeline-hinted containers
 * refuse here so parseTimelineData (which runs after) can claim them.
 * @returns {{ items: object[] } | null}
 */
function parseStepsData(tokens, i, end, t) {
  const hinted = looksLikeSteps(t);
  if (!hinted && looksLikeTimeline(t)) return null;
  const isOl = t && t.name === 'ol';
  const items = collectProcessItems(tokens, i + 1, end - 1, 'steps');
  if (!items || items.length < 2) return null;
  if (!hinted) {
    if (!isOl) return null;
    if (items.filter((it) => it.title && it.text).length < 2) return null;
  }
  return { items: items.map((it) => ({ title: it.title || '', text: it.text || '', icon: it.icon || '' })) };
}

function parseDlTimeline(tokens, i, end) {
  const items = [];
  let time = '';
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const e = matchClose(tokens, j);
    if (tk.name === 'dt') {
      time = unescapeHtml(textOf(tokens, j + 1, e - 1));
      j = e - 1;
    } else if (tk.name === 'dd') {
      const inner = extractProcessItem(tokens, j, e, 'timeline');
      items.push({
        time,
        title: (inner && inner.title) || '',
        text: (inner && inner.text) || unescapeHtml(textOf(tokens, j + 1, e - 1)),
        image: (inner && inner.image) || ''
      });
      time = '';
      j = e - 1;
    } else {
      j = e - 1;
    }
  }
  return items.length >= 2 ? { items } : null;
}

/**
 * Company-history rail. Class hint, or a <dl> of dt/dd pairs.
 * @returns {{ items: object[] } | null}
 */
function parseTimelineData(tokens, i, end, t) {
  if (t && t.name === 'dl') return parseDlTimeline(tokens, i, end);
  if (!looksLikeTimeline(t)) return null;
  const items = collectProcessItems(tokens, i + 1, end - 1, 'timeline');
  if (!items || items.length < 2) return null;
  return { items: items.map((it) => ({
    time: it.time || '',
    title: it.title || '',
    text: it.text || '',
    image: it.image || ''
  })) };
}

// ── inbound mappers for modules we already publish (copy-this-site) ──
// Pricing / carousel / FAQ / tabs / hero already exist outbound. Real sites
// ship Swiper, Bootstrap tabs, classed FAQ, pricing HTML and CSS-background
// heroes. If we recognise the shape we map it; if we only guess, the walk
// MUST put the tool on suggestedTools — silent flatten is a false success.

function hintHay(t) {
  return `${(t && t.name) || ''} ${classHay(t)}`;
}

const PRICING_CLASS = /\b(?:pricing|price-table|price-cards?|pricing-table|bent-pricing|elementor-price)\b/i;
const CAROUSEL_CLASS = /\b(?:swiper|slick[-_]?slider|tie-slick-slider|owl-carousel|splide|keen-slider|glide|bent-carousel|carousel|slider)\b/i;
const FAQ_CLASS = /\b(?:faqs?|frequently-asked|bent-faq|faq-list|dsm-faq|stattic-faq|elementor-widget-faq|elementor-accordion)\b/i;
const FAQ_ITEM_CLASS = /\b(?:faq-item|faq-entry|dsm-faq--faq-content|elementor-accordion-item|e-faq-item)\b/i;
const FAQ_CONTENT_CLASS = /\b(?:dsm-faq--faq-content|faq-body|faq-answer|elementor-tab-content|elementor-accordion-content)\b/i;
const FAQ_TITLE_SKIP = /\b(?:dsm-faq--title)\b/i;
const FAQ_LOOP_ITEM = /\be-loop-item\b/i;
const TESTIMONIAL_CLASS = /\b(?:testimonial|review-card|bent-testimonial|elementor-testimonial)\b/i;
const SOCIAL_CLASS = /\b(?:social-icons?|social-links?|share-icons?|share-links?|share-buttons?|elementor-social-icons(?:-wrapper)?|elementor-widget-social-icons|bent-social)\b/i;
const TABS_CLASS = /\b(?:nav-tabs|nav-pills|tab-content|tab-pane|elementor-tabs|bent-tabs|is-flex-tabs|mag-box-filter|filter-links|\btabs\b)\b/i;
const HERO_CLASS = /\b(?:hero|jumbotron|masthead|splash|bent-hero)\b/i;
const CRUMBS_CLASS = /\b(?:breadcrumbs?|crumbs|bent-crumbs)\b/i;
const STATS_CLASS = /\b(?:stats|counters?|metrics|kpis?|bent-stats|stats-row|numbers-row|stat-cells?)\b/i;
const LOGOS_CLASS = /\b(?:logos|logo-strip|logo-wall|logo-cloud|logos-strip|bent-logos|clients|brands|partners|customer-logos|logo-list)\b/i;
const PRICE_RE = /([$€£₪]\s*\d[\d.,]*|\d[\d.,]*\s*[$€£₪]|\b\d[\d.,]{0,8}\s*(?:\/\s*)?(?:mo|yr|month|year|wk|שנה|חודש)\b)/i;
const STAT_VALUE_RE = /([+]?\d[\d,.]{0,12}\s*[%+kKmMbB+]?)/;

function looksLikePricing(t) { return PRICING_CLASS.test(hintHay(t)); }
function looksLikeCarousel(t) { return CAROUSEL_CLASS.test(hintHay(t)) || /^swiper/i.test((t && t.name) || ''); }
function looksLikeFaq(t) { return FAQ_CLASS.test(hintHay(t)); }
function looksLikeTestimonial(t) { return TESTIMONIAL_CLASS.test(hintHay(t)); }
function looksLikeSocial(t) { return SOCIAL_CLASS.test(hintHay(t)); }
function looksLikeTabs(t) { return TABS_CLASS.test(hintHay(t)); }
function looksLikeHero(t) { return HERO_CLASS.test(hintHay(t)); }
function looksLikeCrumbs(t) {
  if (!t) return false;
  if (CRUMBS_CLASS.test(hintHay(t))) return true;
  const aria = (t.attrs && t.attrs['aria-label']) || '';
  return /breadcrumb/i.test(aria);
}
function looksLikeStats(t) { return STATS_CLASS.test(hintHay(t)); }
function looksLikeLogos(t) { return LOGOS_CLASS.test(hintHay(t)); }

/**
 * A class/tag that names a module we speak — or a landmark we refuse to
 * invent (header/footer). Used when the mapper declines so the flatten
 * is never a silent success.
 * @returns {string|null}
 */
function looksLikeHeader(t) {
  if (!t) return false;
  if (t.name === 'header') return true;
  return /site-header|page-header|topbar|navbar|nav-bar|bent-header/i.test(hintHay(t));
}

function looksLikeFooter(t) {
  if (!t) return false;
  if (t.name === 'footer') return true;
  return /site-footer|page-footer|bent-footer/i.test(hintHay(t));
}

function collectChromeLinks(tokens, from, to) {
  const items = [];
  const seen = new Set();
  for (let j = from; j < to; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open' || tk.name !== 'a') continue;
    const close = matchClose(tokens, j);
    const href = (tk.attrs && tk.attrs.href) || '';
    if (!href || href === '#' || /^(javascript|data|vbscript):/i.test(href)) {
      j = close - 1;
      continue;
    }
    let pictured = false;
    for (let k = j + 1; k < close - 1; k++) {
      if (tokens[k].kind === 'open' && (tokens[k].name === 'img' || tokens[k].name === 'source')) {
        pictured = true;
        break;
      }
    }
    if (pictured) {
      j = close - 1;
      continue;
    }
    let label = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
    if (!label) label = attrOf(tk.attrs, 'aria-label', 'title').trim();
    if (!label || label.length > LINK_LABEL_MAX) {
      j = close - 1;
      continue;
    }
    const key = href + '|' + label;
    if (seen.has(key)) {
      j = close - 1;
      continue;
    }
    seen.add(key);
    items.push({ label, href });
    j = close - 1;
  }
  return items.slice(0, 24);
}

function parseHeaderData(tokens, i, end, t) {
  if (!looksLikeHeader(t)) return null;
  const headings = countHeadings(tokens, i + 1, end - 1);
  const blob = unescapeHtml(textOf(tokens, i + 1, end - 1));
  if (headings > 8 || blob.length > 3000) return null;
  let logo = '';
  let logoAlt = '';
  let url = '';
  let title = '';
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const close = matchClose(tokens, j);
    if (!logo && (tk.name === 'img' || tk.name === 'source')) {
      logo = imageSrcOf(tk.attrs);
      logoAlt = (tk.attrs && tk.attrs.alt) || '';
      j = close - 1;
      continue;
    }
    if (!logo) {
      const bg = bgOfAttrs(tk.attrs, null);
      if (bg && /logo/i.test(classHay(tk))) logo = bg;
    }
    if (!title && HEADING.test(tk.name)) {
      title = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim().slice(0, 80);
      j = close - 1;
      continue;
    }
    if (!url && tk.name === 'a' && tk.attrs && tk.attrs.href) {
      const href = tk.attrs.href;
      if (href && href !== '#' && !/^(javascript|data):/i.test(href)) {
        let pictured = false;
        for (let k = j + 1; k < close - 1; k++) {
          if (tokens[k].kind === 'open' && (tokens[k].name === 'img' || tokens[k].name === 'source')) {
            pictured = true;
            break;
          }
        }
        if (pictured || href === '/') url = href;
      }
    }
  }
  const items = collectChromeLinks(tokens, i + 1, end - 1);
  if (!logo && !title && items.length < 2) return null;
  const out = { items };
  if (logo) out.logo = logo;
  if (logoAlt) out.logoAlt = logoAlt;
  if (title) out.title = title;
  if (url) out.url = url;
  return out;
}

function parseFooterData(tokens, i, end, t) {
  if (!looksLikeFooter(t)) return null;
  const headings = countHeadings(tokens, i + 1, end - 1);
  const blob = unescapeHtml(textOf(tokens, i + 1, end - 1));
  if (headings > 8 || blob.length > 4000) return null;
  const items = collectChromeLinks(tokens, i + 1, end - 1);
  let copy = '';
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const close = matchClose(tokens, j);
    const tcls = (tk.attrs && tk.attrs.class) || '';
    if (/copyright|copy|site-info|legal/i.test(tcls) || tk.name === 'small' || tk.name === 'p') {
      const text = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
      if (text && (text.length <= 160 || /©|copyright|\d{4}/i.test(text))) {
        copy = text.slice(0, 200);
        if (/©|copyright|\d{4}/i.test(text)) break;
      }
    }
    j = close - 1;
  }
  if (!copy && items.length < 2) return null;
  const out = { items };
  if (copy) out.copy = copy;
  return out;
}

function guessedTool(t) {
  if (!t) return null;
  const hay = hintHay(t);
  const name = t.name || '';
  if (name === 'header' || /site-header|page-header/i.test(hay)) return 'header';
  if (name === 'footer' || /site-footer|page-footer/i.test(hay)) return 'footer';
  if (looksLikeCarousel(t)) return 'carousel';
  if (looksLikeTabs(t)) return 'tabs';
  if (looksLikeFaq(t)) return 'faq';
  if (looksLikeTestimonial(t)) return 'testimonial';
  if (looksLikeSocial(t)) return 'social';
  if (looksLikePricing(t)) return 'pricing';
  if (looksLikeHero(t)) return 'hero';
  if (looksLikeCrumbs(t)) return 'crumbs';
  if (looksLikeStats(t)) return 'stats';
  if (looksLikeLogos(t)) return 'logos';
  if (/\b(?:product|shop-item|woocommerce|product-card)\b/i.test(hay)) return 'cards';
  return null;
}

function splitPricePeriod(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s*(\/(?:mo|yr|month|year|חודש|שנה)|per\s+\w+)$/i.exec(s);
  if (m) return { price: m[1].trim(), period: m[2].trim() };
  return { price: s, period: '' };
}

function extractPlan(tokens, s, e) {
  let title = '';
  let price = '';
  let period = '';
  let features = '';
  let ctaLabel = '';
  let ctaUrl = '';
  const root = tokens[s];
  const rootCls = (root && root.attrs && root.attrs.class) || '';
  const highlighted = /highlight|featured|popular|recommended|bent-plan-highlighted/i.test(rootCls);
  for (let j = s + 1; j < e - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const close = matchClose(tokens, j);
    const tcls = (tk.attrs && tk.attrs.class) || '';
    if (!title && (HEADING.test(tk.name) || /bent-plan-title/i.test(tcls))) {
      title = unescapeHtml(textOf(tokens, j + 1, close - 1));
      j = close - 1;
      continue;
    }
    if (!period && /bent-plan-period|period/i.test(tcls)) {
      period = unescapeHtml(textOf(tokens, j + 1, close - 1));
      j = close - 1;
      continue;
    }
    if (!price && (tk.name === 'span' || tk.name === 'div' || tk.name === 'p' || tk.name === 'strong')
      && /price|amount|cost|bent-plan-amount/i.test(tcls)) {
      const parsed = splitPricePeriod(unescapeHtml(textOf(tokens, j + 1, close - 1)));
      price = parsed.price;
      if (!period && parsed.period) period = parsed.period;
      j = close - 1;
      continue;
    }
    if ((tk.name === 'ul' || tk.name === 'ol') && (!features || /feature/i.test(tcls))) {
      const lines = [];
      for (let k = j + 1; k < close - 1; k++) {
        if (tokens[k].kind === 'open' && tokens[k].name === 'li') {
          const le = matchClose(tokens, k);
          const line = unescapeHtml(textOf(tokens, k + 1, le - 1)).trim();
          if (line) lines.push(line);
          k = le - 1;
        }
      }
      if (lines.length) features = lines.join('\n');
      j = close - 1;
      continue;
    }
    if (!ctaLabel && (tk.name === 'a' || tk.name === 'button')) {
      const label = unescapeHtml(textOf(tokens, j + 1, close - 1)).trim();
      if (label) {
        ctaLabel = label;
        ctaUrl = (tk.attrs && (tk.attrs.href || tk.attrs.formaction)) || '';
      }
      j = close - 1;
    }
  }
  if (!price) {
    const m = PRICE_RE.exec(unescapeHtml(textOf(tokens, s + 1, e - 1)));
    if (m) {
      const parsed = splitPricePeriod(m[0]);
      price = parsed.price;
      if (!period) period = parsed.period;
    }
  }
  if (!title) return null;
  const out = { title, highlighted };
  if (price) out.price = price;
  if (period) out.period = period;
  if (features) out.features = features;
  if (ctaLabel) out.ctaLabel = ctaLabel;
  if (ctaUrl) out.ctaUrl = ctaUrl;
  return out;
}

function parsePricingData(tokens, i, end, t) {
  const hinted = looksLikePricing(t);
  const items = [];
  for (const [s, e] of childSpans(tokens, i + 1, end - 1)) {
    if (!CONTAINERS.has(tokens[s].name) && tokens[s].name !== 'li') continue;
    const plan = extractPlan(tokens, s, e);
    if (plan) items.push(plan);
  }
  if (items.length < 2) return null;
  if (!hinted && items.filter((it) => it.price).length < 2) return null;
  return { items };
}

function extractSlide(tokens, s, e, bgMap) {
  const card = extractCard(tokens, s, e, bgMap);
  if (card) return card;
  let image = '';
  let title = '';
  let href = '';
  let excerpt = '';
  for (let j = s; j < e; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const close = matchClose(tokens, j);
    if (!image && (tk.name === 'img' || tk.name === 'source')) image = imageSrcOf(tk.attrs);
    if (!image) image = bgOfAttrs(tk.attrs, bgMap) || image;
    if (!title && HEADING.test(tk.name)) {
      title = unescapeHtml(textOf(tokens, j + 1, close - 1));
      j = close - 1;
      continue;
    }
    if (!href && tk.name === 'a' && tk.attrs && tk.attrs.href) href = tk.attrs.href;
    if (!excerpt && tk.name === 'p') {
      excerpt = unescapeHtml(textOf(tokens, j + 1, close - 1));
      j = close - 1;
    }
  }
  if (!image && !title) return null;
  const out = {};
  if (image) out.image = image;
  if (title) out.title = title;
  if (href) out.href = href;
  if (excerpt) out.excerpt = excerpt;
  return out;
}

const SLIDE_CLASS = /\b(?:swiper-slide|slick-slide|splide__slide|glide__slide|owl-item|tie-slide-\d+|slide)\b/i;

function collectSlides(tokens, from, to, bgMap) {
  const items = [];
  for (let j = from; j < to; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const close = matchClose(tokens, j);
    if (close == null) continue;
    if (SLIDE_CLASS.test(classHay(tk))) {
      const slide = extractSlide(tokens, j, close, bgMap);
      if (slide) items.push(slide);
      j = close - 1;
    }
  }
  return items;
}

function parseCarouselData(tokens, i, end, t, bgMap) {
  if (!looksLikeCarousel(t)) return null;
  let from = i + 1;
  let to = end - 1;
  const kids = childSpans(tokens, from, to);
  if (kids.length === 1) {
    const wrap = tokens[kids[0][0]];
    if (/wrapper|track|inner|swiper-wrapper|slick-list|slick-track|bent-carousel-track|tie-slick-slider/i.test(classHay(wrap))) {
      from = kids[0][0] + 1;
      to = kids[0][1] - 1;
    }
  }
  let items = collectSlides(tokens, from, to, bgMap);
  if (items.length < 2) {
    items = [];
    for (const [s, e] of childSpans(tokens, from, to)) {
      if (/loader|spinner|nav/i.test(classHay(tokens[s]))) continue;
      const slide = extractSlide(tokens, s, e, bgMap);
      if (slide) items.push(slide);
    }
  }
  return items.length >= 2 ? { items } : null;
}

function extractQaPlain(tokens, s, e) {
  let question = '';
  let answer = '';
  for (let j = s + 1; j < e - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const close = matchClose(tokens, j);
    const tcls = (tk.attrs && tk.attrs.class) || '';
    if (FAQ_TITLE_SKIP.test(tcls)) {
      j = close - 1;
      continue;
    }
    if (tk.name === 'summary' || HEADING.test(tk.name) || tk.name === 'dt'
      || /question|faq-q|faq-question|elementor-tab-title|accordion-title/i.test(tcls)) {
      if (!question) question = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
      j = close - 1;
      continue;
    }
    if (tk.name === 'p' || tk.name === 'dd'
      || /answer|faq-a|faq-answer|elementor-tab-content|accordion-content/i.test(tcls)) {
      const p = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
      if (p) answer = answer ? `${answer}\n${p}` : p;
      j = close - 1;
    }
  }
  if (!question) return null;
  return { question, answer };
}

function extractQa(tokens, s, e) {
  for (let j = s + 1; j < e - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    if (FAQ_CONTENT_CLASS.test(classHay(tk))) {
      const close = matchClose(tokens, j);
      const inner = extractQaPlain(tokens, j, close);
      if (inner) return inner;
      j = close - 1;
    }
  }
  return extractQaPlain(tokens, s, e);
}

function isFaqItemToken(tk) {
  if (!tk) return false;
  if (tk.name === 'details') return true;
  const hay = classHay(tk);
  if (FAQ_ITEM_CLASS.test(hay) || FAQ_CONTENT_CLASS.test(hay)) return true;
  return FAQ_LOOP_ITEM.test(hay) && /\bfaq\b/i.test(hay);
}

function collectQaDeep(tokens, from, to) {
  const items = [];
  for (let j = from; j < to; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    if (!isFaqItemToken(tk)) continue;
    const close = matchClose(tokens, j);
    if (close == null) continue;
    const qa = extractQa(tokens, j, close);
    if (qa) items.push(qa);
    j = close - 1;
  }
  return items;
}

function collectQaItems(tokens, from, to) {
  const deep = collectQaDeep(tokens, from, to);
  if (deep.length >= 2) return deep;
  const spans = childSpans(tokens, from, to);
  if (spans.length === 1 && CONTAINERS.has(tokens[spans[0][0]].name)) {
    const inner = collectQaItems(tokens, spans[0][0] + 1, spans[0][1] - 1);
    if (inner.length >= 2) return inner;
  }
  const wrapped = [];
  for (const [s, e] of spans) {
    const name = tokens[s].name;
    if (name === 'details' || name === 'dl' || CONTAINERS.has(name) || name === 'li') {
      if (name === 'dl') {
        const inner = collectQaItems(tokens, s + 1, e - 1);
        if (inner.length >= 2) return inner;
      }
      const qa = extractQa(tokens, s, e);
      if (qa) wrapped.push(qa);
    }
  }
  if (wrapped.length >= 2) return wrapped;
  const pairs = [];
  for (let n = 0; n < spans.length; n++) {
    const [s, e] = spans[n];
    const tk = tokens[s];
    if (tk.name === 'dt') {
      const q = unescapeHtml(textOf(tokens, s + 1, e - 1));
      let a = '';
      if (n + 1 < spans.length && tokens[spans[n + 1][0]].name === 'dd') {
        const [ds, de] = spans[n + 1];
        a = unescapeHtml(textOf(tokens, ds + 1, de - 1));
        n += 1;
      }
      if (q) pairs.push({ question: q, answer: a });
      continue;
    }
    if (!HEADING.test(tk.name)) continue;
    const q = unescapeHtml(textOf(tokens, s + 1, e - 1));
    let a = '';
    if (n + 1 < spans.length && tokens[spans[n + 1][0]].name === 'p') {
      const [ps, pe] = spans[n + 1];
      a = unescapeHtml(textOf(tokens, ps + 1, pe - 1));
      n += 1;
    }
    if (q) pairs.push({ question: q, answer: a });
  }
  return pairs.length >= 2 ? pairs : deep;
}

function countHeadings(tokens, from, to) {
  let n = 0;
  for (let j = from; j < to; j++) {
    if (tokens[j].kind === 'open' && HEADING.test(tokens[j].name)) n += 1;
  }
  return n;
}

function parseFaqData(tokens, i, end, t) {
  if (!looksLikeFaq(t) && !(t && t.name === 'dl' && looksLikeFaq(t))) return null;
  const items = collectQaItems(tokens, i + 1, end - 1);
  if (items.length < 2) return null;
  // A page-sized wrapper that merely CONTAINS a FAQ (Elementor section
  // chrome, loop templates) must descend — otherwise two Q&As steal the
  // rest of the marketing page. Allow a title/subtitle above the list.
  const headings = countHeadings(tokens, i + 1, end - 1);
  if (headings > items.length + 2) return null;
  return { items };
}

function collectTabLabels(tokens, i, end) {
  const labels = [];
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const tcls = (tk.attrs && tk.attrs.class) || '';
    if (tk.name === 'a' || tk.name === 'button' || tk.name === 'label'
      || /nav-link|tab-title|tab-label|bent-tab-label/i.test(tcls)) {
      const close = matchClose(tokens, j);
      const label = unescapeHtml(textOf(tokens, j + 1, close - 1)).trim();
      const href = (tk.attrs && (tk.attrs.href || tk.attrs['data-bs-target'] || tk.attrs['data-target'])) || '';
      const forId = (tk.attrs && tk.attrs.for) || '';
      const id = String(href || forId).replace(/^#/, '');
      if (label && !/bent-tab-radio/i.test(tcls)) labels.push({ label, id });
      j = close - 1;
    }
  }
  return labels;
}

function collectTabPanes(tokens, i, end) {
  const panes = [];
  for (const [s, e] of childSpans(tokens, i + 1, end - 1)) {
    const tk = tokens[s];
    const hay = classHay(tk);
    if (/nav-tabs|nav-pills|tab-list/i.test(hay)) continue;
    const isPane = /tab-pane|bent-tab-panel|elementor-tab-content/i.test(hay);
    if (!isPane && !CONTAINERS.has(tk.name)) continue;
    if (!isPane && /nav-tabs|tabs-nav/i.test(hay)) continue;
    const content = unescapeHtml(textOf(tokens, s + 1, e - 1)).replace(/\s+/g, ' ').trim();
    let label = '';
    for (let j = s + 1; j < e - 1; j++) {
      if (tokens[j].kind === 'open' && HEADING.test(tokens[j].name)) {
        const c = matchClose(tokens, j);
        label = unescapeHtml(textOf(tokens, j + 1, c - 1));
        break;
      }
    }
    if (content || label) {
      panes.push({ id: (tk.attrs && tk.attrs.id) || '', content, label });
    }
  }
  return panes;
}

function pairTabItems(labels, panes) {
  if (labels.length >= 2 && panes.length >= 1) {
    return labels.map((lb, idx) => {
      const byId = lb.id && panes.find((p) => p.id && (p.id === lb.id || lb.id.endsWith(p.id) || p.id.endsWith(lb.id)));
      const pane = byId || panes[idx] || {};
      return { label: lb.label, content: pane.content || '' };
    }).filter((it) => it.label);
  }
  if (panes.length >= 2) {
    return panes.map((p, idx) => ({
      label: p.label || (labels[idx] && labels[idx].label) || ('טאב ' + (idx + 1)),
      content: p.content || ''
    }));
  }
  return [];
}

/**
 * Bootstrap / Elementor / our own bent-tabs. May consume a sibling
 * `.tab-content` after a `ul.nav-tabs` — `next` is the index past both.
 * @returns {{ items: object[], next: number } | null}
 */
function parseFilterTabsData(tokens, i, end, t, parentTo) {
  const hay = hintHay(t);
  if (!/is-flex-tabs|mag-box-filter|filter-links/i.test(hay)) return null;
  const labels = collectTabLabels(tokens, i, end);
  if (labels.length < 2) return null;
  let content = '';
  const limit = parentTo == null ? tokens.length : parentTo;
  let j = end;
  while (j < limit && tokens[j] && tokens[j].kind === 'text' && !tokens[j].value.trim()) j++;
  if (j < limit && tokens[j] && tokens[j].kind === 'open') {
    const se = matchClose(tokens, j);
    const h = classHay(tokens[j]);
    if (/mag-box-container|posts-items|posts-list|tab-content/i.test(h) || CONTAINERS.has(tokens[j].name)) {
      content = unescapeHtml(textOf(tokens, j + 1, se - 1)).replace(/\s+/g, ' ').trim().slice(0, 800);
    }
  }
  if (!content) content = unescapeHtml(textOf(tokens, i + 1, end - 1)).replace(/\s+/g, ' ').trim().slice(0, 200);
  const items = labels.map((lb, idx) => ({
    label: lb.label,
    content: idx === 0 ? content : ''
  }));
  if (!items.some((it) => String(it.content || '').trim())) return null;
  return { items, next: end };
}

function parseTabsData(tokens, i, end, t, parentTo) {
  if (!looksLikeTabs(t)) return null;
  const filterTabs = parseFilterTabsData(tokens, i, end, t, parentTo);
  if (filterTabs) return filterTabs;
  const hay = hintHay(t);
  const isNavTabs = /nav-tabs|nav-pills/i.test(hay);
  const isTabContent = /tab-content/i.test(hay) && !/nav-tabs/i.test(hay);
  let labels = [];
  let panes = [];
  let next = end;
  if (isNavTabs) {
    labels = collectTabLabels(tokens, i, end);
    let j = end;
    const limit = parentTo == null ? tokens.length : parentTo;
    while (j < limit && tokens[j] && tokens[j].kind === 'text' && !tokens[j].value.trim()) j++;
    if (j < limit && tokens[j] && tokens[j].kind === 'open') {
      const se = matchClose(tokens, j);
      if (/tab-content/i.test(classHay(tokens[j]))) {
        panes = collectTabPanes(tokens, j, se);
        next = se;
      }
    }
  } else if (isTabContent) {
    panes = collectTabPanes(tokens, i, end);
  } else {
    for (const [s, e] of childSpans(tokens, i + 1, end - 1)) {
      const h = classHay(tokens[s]);
      if (/nav-tabs|nav-pills/i.test(h)) labels = collectTabLabels(tokens, s, e);
      if (/tab-content/i.test(h)) panes = collectTabPanes(tokens, s, e);
    }
    if (!labels.length) labels = collectTabLabels(tokens, i, end);
    if (!panes.length) panes = collectTabPanes(tokens, i, end);
  }
  const items = pairTabItems(labels, panes);
  if (items.length < 2) return null;
  if (!items.some((it) => String(it.content || '').trim())) return null;
  return { items, next };
}

function measureHero(tokens, i, end) {
  let headings = 0;
  let paragraphs = 0;
  let links = 0;
  let images = 0;
  let textLen = 0;
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind === 'text') { textLen += tk.value.trim().length; continue; }
    if (tk.kind !== 'open') continue;
    if (HEADING.test(tk.name)) headings++;
    else if (tk.name === 'p') paragraphs++;
    else if (tk.name === 'a' || tk.name === 'button') links++;
    else if (tk.name === 'img') images++;
  }
  return { headings, paragraphs, links, images, textLen };
}

function heroShapeOk(shape, relaxed) {
  if (shape.headings < 1) return false;
  if (relaxed) {
    return shape.headings <= 3 && shape.paragraphs <= 3 && shape.links <= 5
      && shape.images <= 3 && shape.textLen <= 800;
  }
  return shape.headings <= 2 && shape.paragraphs <= 2 && shape.links <= 3
    && shape.images <= 2 && shape.textLen <= 400;
}

function extractHero(tokens, i, end, bgMap) {
  const data = {};
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    if (!data.title && HEADING.test(tk.name)) {
      const e = matchClose(tokens, j);
      data.title = unescapeHtml(textOf(tokens, j + 1, e - 1));
      j = e - 1;
    } else if (!data.subtitle && tk.name === 'p') {
      const e = matchClose(tokens, j);
      data.subtitle = unescapeHtml(textOf(tokens, j + 1, e - 1));
      j = e - 1;
    } else if (!data.buttonText && (tk.name === 'a' || tk.name === 'button')) {
      const e = matchClose(tokens, j);
      const label = unescapeHtml(textOf(tokens, j + 1, e - 1));
      if (label) {
        data.buttonText = label;
        data.buttonUrl = (tk.attrs && (tk.attrs.href || tk.attrs.formaction)) || '#';
      }
      j = e - 1;
    } else if (!data.image && (tk.name === 'img' || tk.name === 'source')) {
      data.image = imageSrcOf(tk.attrs);
    } else if (!data.image) {
      const bg = bgOfAttrs(tk.attrs, bgMap);
      if (bg) data.image = bg;
    }
  }
  if (!data.image) {
    const bg = bgOfAttrs(tokens[i].attrs, bgMap);
    if (bg) data.image = bg;
  }
  return data.title ? data : null;
}

function parseHeroData(tokens, i, end, t, bgMap) {
  const hinted = looksLikeHero(t);
  const selfBg = bgOfAttrs(t && t.attrs, bgMap);
  const data = extractHero(tokens, i, end, bgMap);
  if (!data) return null;
  const shape = measureHero(tokens, i, end);
  if (hinted) {
    // a classed hero may carry its picture as an <img> or a CSS background
    return heroShapeOk(shape, !!(selfBg || data.image)) ? data : null;
  }
  // unclassed: only a CSS-background band with a tight hero shape — never
  // a card wall that happens to contain pictures
  if (!selfBg) return null;
  return heroShapeOk(shape, false) ? data : null;
}

/**
 * Shared inbound try for both walks. `next` may jump past a sibling
 * (Bootstrap tab-content after nav-tabs).
 * @returns {{ type: string, data: object, next: number } | null}
 */
function extractCrumb(tokens, s, e) {
  let label = '';
  let url = '';
  const root = tokens[s];
  if (root && root.name === 'a') {
    url = (root.attrs && root.attrs.href) || '';
    label = unescapeHtml(textOf(tokens, s + 1, e - 1)).trim();
  } else {
    for (let j = s + 1; j < e - 1; j++) {
      const tk = tokens[j];
      if (tk.kind !== 'open') continue;
      const close = matchClose(tokens, j);
      if (tk.name === 'a') {
        url = (tk.attrs && tk.attrs.href) || '';
        label = unescapeHtml(textOf(tokens, j + 1, close - 1)).trim();
        break;
      }
    }
    if (!label) label = unescapeHtml(textOf(tokens, s + 1, e - 1)).trim();
  }
  if (!label) return null;
  const out = { label };
  if (url && url !== '#') out.url = url;
  return out;
}

function parseCrumbsData(tokens, i, end, t) {
  if (!looksLikeCrumbs(t)) return null;
  const items = [];
  function collect(from, to) {
    for (let j = from; j < to; j++) {
      const tk = tokens[j];
      if (tk.kind !== 'open') continue;
      const e = matchClose(tokens, j);
      if (tk.name === 'ol' || tk.name === 'ul') {
        collect(j + 1, e - 1);
        j = e - 1;
        continue;
      }
      if (tk.name === 'li' || tk.name === 'a' || tk.name === 'span') {
        const item = extractCrumb(tokens, j, e);
        if (item && !/^[/\u203A>»·•]+$/.test(item.label)) items.push(item);
        j = e - 1;
      }
    }
  }
  collect(i + 1, end - 1);
  return items.length >= 2 ? { items } : null;
}

function extractStat(tokens, s, e) {
  let value = '';
  let label = '';
  for (let j = s; j < e; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const close = matchClose(tokens, j);
    const tcls = (tk.attrs && tk.attrs.class) || '';
    if (!value && /stat-value|counter-number|count-number|metric-value|kpi-value|\bnumber\b|\bcount\b/i.test(tcls)) {
      value = unescapeHtml(textOf(tokens, j + 1, close - 1)).trim();
      j = close - 1;
      continue;
    }
    if (!label && /stat-label|counter-label|metric-label|kpi-label|\bcaption\b/i.test(tcls)) {
      label = unescapeHtml(textOf(tokens, j + 1, close - 1)).trim();
      j = close - 1;
      continue;
    }
    if (!value && HEADING.test(tk.name)) {
      const txt = unescapeHtml(textOf(tokens, j + 1, close - 1)).trim();
      if (STAT_VALUE_RE.test(txt)) value = txt;
      else if (!label) label = txt;
      j = close - 1;
      continue;
    }
    if (tk.name === 'p' || tk.name === 'span' || tk.name === 'strong') {
      const txt = unescapeHtml(textOf(tokens, j + 1, close - 1)).trim();
      if (!value && STAT_VALUE_RE.test(txt) && txt.length <= 16) value = txt;
      else if (!label && txt && !STAT_VALUE_RE.test(txt)) label = txt;
      j = close - 1;
    }
  }
  if (!value) {
    const all = unescapeHtml(textOf(tokens, s + 1, e - 1)).replace(/\s+/g, ' ').trim();
    const m = STAT_VALUE_RE.exec(all);
    if (m) {
      value = m[1].trim();
      const rest = all.replace(m[1], '').replace(/\s+/g, ' ').trim();
      if (!label) label = rest;
    }
  }
  if (!value) return null;
  return { value, label };
}

function parseStatsData(tokens, i, end, t) {
  if (!looksLikeStats(t)) return null;
  const items = [];
  for (const [s, e] of childSpans(tokens, i + 1, end - 1)) {
    const name = tokens[s].name;
    if (!CONTAINERS.has(name) && name !== 'li') continue;
    const stat = extractStat(tokens, s, e);
    if (stat) items.push(stat);
  }
  if (items.length < 2) return null;
  const columns = Math.min(Math.max(items.length, 2), 4);
  return { items, columns };
}

function extractLogo(tokens, s, e) {
  let src = '';
  let alt = '';
  let url = '';
  const root = tokens[s];
  if (root && root.name === 'a' && root.attrs && root.attrs.href) url = root.attrs.href;
  for (let j = s; j < e; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    if (!src && (tk.name === 'img' || tk.name === 'source')) {
      src = imageSrcOf(tk.attrs);
      alt = (tk.attrs && tk.attrs.alt) || alt;
    }
    if (!src) src = bgOfAttrs(tk.attrs, null);
    if (!url && tk.name === 'a' && tk.attrs && tk.attrs.href) url = tk.attrs.href;
  }
  if (!src && root) src = bgOfAttrs(root.attrs, null);
  if (!src) return null;
  const out = { src };
  if (alt) out.alt = alt;
  if (url && url !== '#') out.url = url;
  return out;
}

function parseLogosData(tokens, i, end, t) {
  if (!looksLikeLogos(t)) return null;
  let from = i + 1;
  let to = end - 1;
  const kids = childSpans(tokens, from, to);
  if (kids.length === 1 && /list|strip|track|row|inner|wrap/i.test(classHay(tokens[kids[0][0]]))) {
    from = kids[0][0] + 1;
    to = kids[0][1] - 1;
  }
  const items = [];
  for (const [s, e] of childSpans(tokens, from, to)) {
    const name = tokens[s].name;
    if (name === 'img' || name === 'a' || name === 'li' || name === 'figure' || CONTAINERS.has(name)) {
      const logo = extractLogo(tokens, s, e);
      if (logo) items.push(logo);
    }
  }
  return items.length >= 2 ? { items } : null;
}

function networkFromHref(href) {
  const h = String(href || '').toLowerCase();
  if (/facebook\.com|\bfb\.com\b/.test(h)) return 'facebook';
  if (/instagram\.com/.test(h)) return 'instagram';
  if (/(?:^|\/\/)(?:www\.)?(?:x\.com|twitter\.com)/.test(h)) return 'twitter';
  if (/linkedin\.com/.test(h)) return 'linkedin';
  if (/youtube\.com|youtu\.be/.test(h)) return 'youtube';
  if (/tiktok\.com/.test(h)) return 'tiktok';
  if (/github\.com/.test(h)) return 'github';
  if (/wordpress\.org|wordpress\.com/.test(h)) return 'wordpress';
  if (/wa\.me|whatsapp/.test(h)) return 'whatsapp';
  if (/(?:^|\/\/)(?:t\.me|telegram\.)/.test(h)) return 'telegram';
  if (/pinterest\.com/.test(h)) return 'pinterest';
  if (/mailto:/.test(h)) return 'email';
  return '';
}

function networkFromClass(cls) {
  const m = /(?:elementor-social-icon-|fa(?:[brs])?-|icon-|social-)([a-z0-9-]+)/i.exec(String(cls || ''));
  if (!m) return '';
  const name = m[1].toLowerCase().replace(/-square|-official|-f$|-in$/i, '');
  if (!name || name === 'icon' || name === 'link') return '';
  return name;
}

function extractSocialLink(tokens, s, e, tk) {
  const href = (tk.attrs && tk.attrs.href) || '';
  if (!href || href === '#') return null;
  let network = networkFromClass((tk.attrs && tk.attrs.class) || '') || networkFromHref(href);
  let label = ((tk.attrs && (tk.attrs['aria-label'] || tk.attrs.title)) || '').trim();
  if (!label) {
    const raw = unescapeHtml(textOf(tokens, s + 1, e - 1)).replace(/\s+/g, ' ').trim();
    if (raw && raw.length < 40 && !/^[Mm]\s/.test(raw)) label = raw;
  }
  if (!network && !label) return null;
  if (!network) network = 'link';
  if (!label) label = network;
  return { network, url: href, label };
}

function parseSocialData(tokens, i, end, t) {
  if (!looksLikeSocial(t)) return null;
  const items = [];
  const seen = new Set();
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open' || tk.name !== 'a') continue;
    const close = matchClose(tokens, j);
    const item = extractSocialLink(tokens, j, close, tk);
    if (item && !seen.has(item.url)) {
      seen.add(item.url);
      items.push(item);
    }
    j = close - 1;
  }
  return items.length >= 2 ? { items } : null;
}

function parseTestimonialData(tokens, i, end, t) {
  if (!looksLikeTestimonial(t)) return null;
  let quote = '';
  let author = '';
  let role = '';
  for (let j = i + 1; j < end - 1; j++) {
    const tk = tokens[j];
    if (tk.kind !== 'open') continue;
    const close = matchClose(tokens, j);
    const tcls = (tk.attrs && tk.attrs.class) || '';
    if (!quote && (/testimonial-content|testimonial-text|review-text|bent-testimonial-quote/i.test(tcls)
      || tk.name === 'p' || tk.name === 'q')) {
      const text = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
      if (text) quote = text.replace(/^["“]+|["”]+$/g, '');
      j = close - 1;
      continue;
    }
    if (!author && (/testimonial-name|review-author|author-name|bent-testimonial-author/i.test(tcls)
      || tk.name === 'cite')) {
      author = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
      j = close - 1;
      continue;
    }
    if (!role && /testimonial-job|testimonial-role|review-role|author-role/i.test(tcls)) {
      role = unescapeHtml(textOf(tokens, j + 1, close - 1)).replace(/\s+/g, ' ').trim();
      j = close - 1;
    }
  }
  if (!quote) {
    quote = unescapeHtml(textOf(tokens, i + 1, end - 1)).replace(/\s+/g, ' ').trim();
    if (author) quote = quote.replace(author, '').trim();
    if (role) quote = quote.replace(role, '').trim();
    quote = quote.replace(/^["“]+|["”]+$/g, '').trim();
  }
  if (!quote) return null;
  const out = { quote };
  if (author) out.author = author;
  if (role) out.role = role;
  return out;
}

function tryStructuralModules(tokens, i, end, t, bgMap, parentTo) {
  const header = parseHeaderData(tokens, i, end, t);
  if (header) return { type: 'header', data: header, next: end };
  const footer = parseFooterData(tokens, i, end, t);
  if (footer) return { type: 'footer', data: footer, next: end };
  const crumbs = parseCrumbsData(tokens, i, end, t);
  if (crumbs) return { type: 'crumbs', data: crumbs, next: end };
  const stats = parseStatsData(tokens, i, end, t);
  if (stats) return { type: 'stats', data: stats, next: end };
  const social = parseSocialData(tokens, i, end, t);
  if (social) return { type: 'social', data: social, next: end };
  const logos = parseLogosData(tokens, i, end, t);
  if (logos) return { type: 'logos', data: logos, next: end };
  const pricing = parsePricingData(tokens, i, end, t);
  if (pricing) return { type: 'pricing', data: pricing, next: end };
  const carousel = parseCarouselData(tokens, i, end, t, bgMap);
  if (carousel) return { type: 'carousel', data: carousel, next: end };
  const faq = parseFaqData(tokens, i, end, t);
  if (faq) return { type: 'faq', data: faq, next: end };
  const tabs = parseTabsData(tokens, i, end, t, parentTo);
  if (tabs) return { type: 'tabs', data: { items: tabs.items }, next: tabs.next };
  const hero = parseHeroData(tokens, i, end, t, bgMap);
  if (hero) return { type: 'hero', data: hero, next: end };
  const stepData = parseStepsData(tokens, i, end, t);
  if (stepData) return { type: 'steps', data: stepData, next: end };
  const tlData = parseTimelineData(tokens, i, end, t);
  if (tlData) return { type: 'timeline', data: tlData, next: end };
  const testimonial = parseTestimonialData(tokens, i, end, t);
  if (testimonial) return { type: 'testimonial', data: testimonial, next: end };
  return null;
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
      // JS crumbs tokenized as tags (`<date2_end)`) are not HTML — skip, don't leftover
      if (!/^[a-z][a-z0-9:-]*$/i.test(name)) { i += 1; continue; }
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
      if (name === 'time') {
        const when = timeText(tokens, i, end, t);
        if (when) {
          sink.push({ type: 'text', id: nid('t'), data: { content: when } });
          mapped += 1;
        }
        i = end; continue;
      }
      if (name === 'input' || name === 'textarea' || name === 'select' || name === 'label') {
        const run = parseFieldRun(tokens, i, to);
        if (run) {
          sink.push({ type: 'form', id: nid('form'), data: { action: '', method: 'post', submit: 'שליחה', fields: run.fields } });
          mapped += 1; i = run.next; continue;
        }
        i = end; continue;
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
        const structuralList = tryStructuralModules(tokens, i, end, t, bgMap, to);
        if (structuralList) {
          sink.push({ type: structuralList.type, id: nid(structuralList.type), data: structuralList.data });
          mapped += 1; i = structuralList.next; continue;
        }
        if (guessedTool(t)) suggested.add(guessedTool(t));
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
      if (name === 'dl') {
        const faqDl = parseFaqData(tokens, i, end, t);
        if (faqDl) {
          sink.push({ type: 'faq', id: nid('faq'), data: faqDl });
          mapped += 1; i = end; continue;
        }
        const tlData = parseTimelineData(tokens, i, end, t);
        if (tlData) {
          sink.push({ type: 'timeline', id: nid('tl'), data: tlData });
          mapped += 1; i = end; continue;
        }
        suggested.add(looksLikeFaq(t) ? 'faq' : 'timeline');
        let frag = '';
        for (let j = i; j < end; j++) frag += tokenToHtml(tokens[j]);
        raw += frag;
        i = end; continue;
      }
      // form → the form module (v0.58 closed this gap). Parse label/input/
      // textarea/select children into fields; skip submit/hidden controls
      // (the module renders its own submit button).
      if (name === 'form') {
        const fields = parseFormFields(tokens, i, end);
        if (isPageForm(tokens, i, end, fields)) {
          suggested.add('form');
          walk(i + 1, end - 1, sink);
          i = end; continue;
        }
        if (fields.length) {
          const method = /get/i.test((t.attrs && t.attrs.method) || '') ? 'get' : 'post';
          sink.push({ type: 'form', id: nid('form'), data: { action: (t.attrs && t.attrs.action) || '', method, submit: 'שליחה', fields } });
          mapped += 1;
        } else {
          suggested.add('form');
        }
        i = end; continue;
      }

      // nav → the nav module (v0.60 closed this gap). Its <a> children become
      // nav links; drop wrapper <ul>/<li> (we read the anchors directly).
      if (name === 'nav' || name === 'menu') {
        const crumbNav = parseCrumbsData(tokens, i, end, t);
        if (crumbNav) {
          sink.push({ type: 'crumbs', id: nid('crumbs'), data: crumbNav });
          mapped += 1; i = end; continue;
        }
        const socialNav = parseSocialData(tokens, i, end, t);
        if (socialNav) {
          sink.push({ type: 'social', id: nid('social'), data: socialNav });
          mapped += 1; i = end; continue;
        }
        if (looksLikeCrumbs(t)) suggested.add('crumbs');
        if (looksLikeSocial(t)) suggested.add('social');
        const items = parseNavItems(tokens, i, end);
        if (items.length) {
          sink.push({ type: 'nav', id: nid('nav'), data: { items } });
          mapped += 1;
        } else {
          suggested.add('nav');
          walk(i + 1, end - 1, sink);
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
          suggested.add('video');
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
        const structural = tryStructuralModules(tokens, i, end, t, bgMap, to);
        if (structural) {
          sink.push({ type: structural.type, id: nid(structural.type), data: structural.data });
          mapped += 1; i = structural.next; continue;
        }
        const lost = guessedTool(t);
        if (lost) suggested.add(lost);
        else {
          if (looksLikeSteps(t)) suggested.add('steps');
          if (looksLikeTimeline(t)) suggested.add('timeline');
        }
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
      // never keep framework wrappers as raw blobs. Swiper 9+ is
      // <swiper-container>; if we flatten it, report carousel.
      if (name.includes('-')) {
        const custom = tryStructuralModules(tokens, i, end, t, bgMap, to);
        if (custom) {
          sink.push({ type: custom.type, id: nid(custom.type), data: custom.data });
          mapped += 1; i = custom.next; continue;
        }
        const lostCustom = guessedTool(t);
        if (lostCustom) suggested.add(lostCustom);
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
  isPageForm,
  parseFieldRun,
  timeText,
  parseNavItems,
  parseVideoData,
  parseAudioData,
  parseTableData,
  parseStepsData,
  parseTimelineData,
  parsePricingData,
  parseCarouselData,
  parseFaqData,
  parseTabsData,
  parseHeroData,
  parseCrumbsData,
  parseStatsData,
  parseLogosData,
  parseSocialData,
  parseTestimonialData,
  parseHeaderData,
  parseFooterData,
  tryStructuralModules,
  guessedTool,
  parseDetailsRun,
  mapsAddressOf,
  looksLikeCarousel,
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
